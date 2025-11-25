import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Any
import os
import re
import math
import pyarrow as pa
import pyarrow.parquet as pq

class RaceDataProcessor:
    FILE_PATTERNS = {
        "telemetry": [r"telemetry"],
        "lap_time": [r"lap[_ ]?time"],
        "lap_start": [r"lap[_ ]?start"],
        "lap_end": [r"lap[_ ]?end"],
    }
    AUTO_CONVERT_KEYS = ("telemetry", "lap_time", "lap_start", "lap_end")
    AUTO_CONVERT_KEYWORDS = AUTO_CONVERT_KEYS

    def __init__(self, data_path: str = None):
        """Initialize processor with data path"""
        if data_path is None:
            data_path = os.getenv("DATA_PATH", "../data")
        
        self.data_path = Path(data_path)
        self.telemetry_cache = {}
        self.lap_times_cache = {}
        self.lap_events_cache = {}
        self.vehicles_cache = {}
        self.golden_laps = {}
        self.race_results_cache = {}
        self.weather_cache = {}
        
        print(f"📁 Data path: {self.data_path.absolute()}")
        self._bootstrap_data()

    def _bootstrap_data(self):
        """Convert pending CSV files to Parquet for every circuit directory."""
        if not self.data_path.exists():
            print(f"⚠️  Data directory {self.data_path} not found. Skipping bootstrap.")
            return

        for circuit_dir in sorted(self.data_path.iterdir()):
            if not circuit_dir.is_dir() or circuit_dir.name.startswith('.'):
                continue
            self._convert_csv_directory(circuit_dir)

    def _get_patterns(self, key: str):
        return self.FILE_PATTERNS.get(key, [key])

    def _matches_patterns(self, name: str, patterns) -> bool:
        return any(re.search(pattern, name, re.IGNORECASE) for pattern in patterns)

    def _should_convert_file(self, filename: str) -> bool:
        return any(self._matches_patterns(filename, self._get_patterns(key)) for key in self.AUTO_CONVERT_KEYS)

    def _convert_csv_directory(self, circuit_dir: Path):
        csv_files = [
            path for path in circuit_dir.iterdir()
            if path.is_file() and path.suffix.lower() == '.csv' and self._should_convert_file(path.name)
        ]

        if not csv_files:
            return

        print(f"🛠️  Preparing {circuit_dir.name}: {len(csv_files)} CSV file(s) to convert")
        for csv_file in sorted(csv_files):
            try:
                self._convert_csv_file(csv_file)
            except Exception as exc:
                print(f"   ⚠️  Failed to convert {csv_file.name}: {exc}")

    def _convert_csv_file(self, csv_path: Path):
        parquet_path = csv_path.with_suffix('.parquet')

        if parquet_path.exists() and parquet_path.stat().st_mtime >= csv_path.stat().st_mtime:
            print(f"   ↪ {csv_path.name} already converted. Removing CSV copy.")
            try:
                csv_path.unlink()
            except OSError as exc:
                print(f"     ⚠️  Could not remove {csv_path.name}: {exc}")
            return

        temp_path = parquet_path.parent / f".{parquet_path.name}.tmp"
        chunk_size = 250_000
        total_rows = 0
        writer = None

        print(f"   → Converting {csv_path.name} → {parquet_path.name}")
        try:
            for chunk in pd.read_csv(csv_path, chunksize=chunk_size):
                table = pa.Table.from_pandas(chunk, preserve_index=False)
                if writer is None:
                    writer = pq.ParquetWriter(temp_path, table.schema, compression='snappy')
                writer.write_table(table)
                total_rows += len(chunk)

            if writer is None:
                pq.write_table(
                    pa.Table.from_pandas(pd.DataFrame()),
                    temp_path,
                    compression='snappy'
                )
            else:
                writer.close()
                writer = None

            temp_path.replace(parquet_path)
            csv_path.unlink()
            print(f"   ✅ {csv_path.name}: {total_rows:,} rows converted")
        except Exception as exc:
            print(f"   ❌ Conversion failed for {csv_path.name}: {exc}")
            raise
        finally:
            if writer is not None:
                writer.close()
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass

    def _load_lap_events(self, circuit: str, race: str) -> pd.DataFrame:
        cache_key = f"{circuit}_{race}_lap_events"
        if cache_key in self.lap_events_cache:
            return self.lap_events_cache[cache_key]

        lap_file = self._find_data_file(circuit, race, "lap_time", prefer_parquet=True)
        if lap_file is None:
            raise FileNotFoundError(f"Lap time file not found for {circuit} {race}")

        if lap_file.suffix.lower() == '.parquet':
            df = pd.read_parquet(lap_file)
        else:
            df = pd.read_csv(lap_file)

        timestamp_col = None
        for candidate in ['timestamp', 'meta_time', 'time']:
            if candidate in df.columns:
                timestamp_col = candidate
                break
        if not timestamp_col:
            raise ValueError(f"No timestamp column found in {lap_file}")
        df['timestamp'] = pd.to_datetime(df[timestamp_col])

        if 'vehicle_id' not in df.columns:
            raise ValueError(f"No vehicle_id column found in {lap_file}")

        df['chassis'] = df['vehicle_id'].str.split('-').str[1]
        df['car_number'] = df['vehicle_id'].str.split('-').str[2].astype(int)

        if 'lap' in df.columns:
            df['lap'] = pd.to_numeric(df['lap'], errors='coerce').fillna(0).astype(int)
            if df['lap'].max() > 1000:
                df['lap'] = df['lap'] & 0x7FFF
            df = df[df['lap'] > 0]
        else:
            df['lap'] = 0

        df = df[['timestamp', 'vehicle_id', 'chassis', 'car_number', 'lap']].copy()
        self.lap_events_cache[cache_key] = df
        return df
    
    def load_telemetry(self, circuit: str, race: str = "R1", vehicle_id: str = None, lap: int = None) -> pd.DataFrame:
        """Load telemetry - Parquet if available, CSV fallback"""
        cache_key = f"{circuit}_{race}"
        if vehicle_id:
            cache_key += f"_{vehicle_id}"
        if lap:
            cache_key += f"_lap{lap}"
        
        # Check cache
        if cache_key in self.telemetry_cache:
            print(f"✅ Loaded from cache: {cache_key}")
            return self.telemetry_cache[cache_key]
        
        data_file = self._find_data_file(circuit, race, "telemetry", prefer_parquet=True)
        if not data_file:
            raise FileNotFoundError(f"No telemetry data found for {circuit} {race}")
        
        if data_file.suffix.lower() == '.parquet':
            df = self._load_from_parquet(data_file, vehicle_id, lap)
        else:
            print("⚠️  Telemetry Parquet not found, using CSV (slower)")
            df = self._load_from_csv(data_file, vehicle_id, lap)
        
        if len(df) == 0:
            return pd.DataFrame()
        
        # Process data
        df = self._process_telemetry(df)
        
        # Cache
        self.telemetry_cache[cache_key] = df
        
        return df

    def _load_from_parquet(self, file_path: Path, vehicle_id: str = None, lap: int = None) -> pd.DataFrame:
        """Load from Parquet with predicate pushdown"""
        import time
        start = time.time()
        
        print(f"📊 Loading telemetry (Parquet): {file_path.name}")
        
        # Build filters - SEULEMENT lap, pas vehicle_id
        filters = []
        if lap is not None:
            filters.append(('lap', '==', lap))
        
        # Ne PAS filtrer par vehicle_id car le format exact peut varier
        # On filtrera après par chassis/car_number
        
        # Load with filters
        df = pd.read_parquet(
            file_path,
            engine='pyarrow',
            filters=filters if filters else None
        )
        
        elapsed = time.time() - start
        print(f"  → {len(df):,} measurements in {elapsed:.2f}s ⚡")
        
        return df

    def _load_from_csv(self, file_path: Path, vehicle_id: str = None, lap: int = None) -> pd.DataFrame:
        """Load from CSV with chunked filtering"""
        import time
        start = time.time()
        
        print(f"📊 Loading telemetry (CSV): {file_path.name}")
        
        chunks = []
        chunk_size = 100000
        
        for chunk in pd.read_csv(file_path, chunksize=chunk_size):
            if vehicle_id:
                chunk = chunk[chunk['vehicle_id'] == vehicle_id]
            if lap is not None:
                chunk = chunk[chunk['lap'] == lap]
            
            if len(chunk) > 0:
                chunks.append(chunk)
        
        if not chunks:
            return pd.DataFrame()
        
        df = pd.concat(chunks, ignore_index=True)
        
        elapsed = time.time() - start
        print(f"  → {len(df):,} measurements in {elapsed:.2f}s")
        
        return df

    def _process_telemetry(self, df: pd.DataFrame) -> pd.DataFrame:
        """Process raw telemetry to wide format"""
        
        # Extract vehicle info if not present
        if 'chassis' not in df.columns:
            df['chassis'] = df['vehicle_id'].str.split('-').str[1]
        if 'car_number' not in df.columns:
            df['car_number'] = df['vehicle_id'].str.split('-').str[2].astype(int)
        
        # Pivot to wide format
        print("🔄 Transforming to wide format...")
        df_wide = df.pivot_table(
            index=['timestamp', 'lap', 'vehicle_id', 'chassis', 'car_number'],
            columns='telemetry_name',
            values='telemetry_value',
            aggfunc='first'
        ).reset_index()
        
        df_wide.columns.name = None
        df_wide['timestamp'] = pd.to_datetime(df_wide['timestamp'])
        df_wide = df_wide.sort_values(['vehicle_id', 'lap', 'timestamp']).reset_index(drop=True)
        
        print(f"  ✅ {len(df_wide):,} telemetry points")
        
        # Normalize Speed column
        if 'speed' in df_wide.columns and 'Speed' not in df_wide.columns:
            df_wide['Speed'] = df_wide['speed']
        elif 'Speed' not in df_wide.columns and 'speed' not in df_wide.columns:
            print("  ⚠️  Speed not found, calculating from GPS...")
            df_wide = self._calculate_speed_from_gps(df_wide)

        df_wide = self._normalize_telemetry_columns(df_wide)
        df_wide = self._ensure_distance_column(df_wide)

        return df_wide
    
    def _calculate_speed_from_gps(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate speed from GPS coordinates if not available"""
        from math import radians, cos, sin, asin, sqrt
        
        def haversine(lon1, lat1, lon2, lat2):
            if pd.isna(lon1) or pd.isna(lat1) or pd.isna(lon2) or pd.isna(lat2):
                return 0
            lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
            c = 2 * asin(sqrt(a))
            return c * 6371000
        
        df = df.copy()
        df['prev_lon'] = df.groupby('vehicle_id')['VBOX_Long_Minutes'].shift(1)
        df['prev_lat'] = df.groupby('vehicle_id')['VBOX_Lat_Min'].shift(1)
        df['prev_time'] = df.groupby('vehicle_id')['timestamp'].shift(1)
        
        df['distance_m'] = df.apply(
            lambda row: haversine(
                row['prev_lon'], row['prev_lat'],
                row['VBOX_Long_Minutes'], row['VBOX_Lat_Min']
            ), axis=1
        )
        
        df['time_delta'] = (df['timestamp'] - df['prev_time']).dt.total_seconds()
        df['Speed'] = np.where(
            df['time_delta'] > 0,
            (df['distance_m'] / df['time_delta']) * 3.6,
            0
        )
        
        df['Speed'] = df['Speed'].clip(0, 250).fillna(0)
        df = df.drop(['prev_lon', 'prev_lat', 'prev_time', 'distance_m', 'time_delta'], axis=1)

        return df

    def _normalize_telemetry_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        rename_map = {}
        if 'ath' in df.columns and 'aps' not in df.columns:
            rename_map['ath'] = 'aps'
        if rename_map:
            df = df.rename(columns=rename_map)
        return df

    def _ensure_distance_column(self, df: pd.DataFrame) -> pd.DataFrame:
        target_col = 'Laptrigger_lapdist_dls'
        if target_col in df.columns:
            return df

        distance_candidates = [col for col in df.columns if 'lap' in col.lower() and 'dist' in col.lower()]
        if distance_candidates:
            df[target_col] = pd.to_numeric(df[distance_candidates[0]], errors='coerce')
            return df

        if 'Speed' not in df.columns:
            return df

        print("  ⚠️  Distance column missing; integrating speed to estimate Laptrigger_lapdist_dls")
        df = df.sort_values(['vehicle_id', 'lap', 'timestamp']).copy()
        df['__delta_t'] = df.groupby(['vehicle_id', 'lap'])['timestamp'].diff().dt.total_seconds().fillna(0)
        df['__delta_t'] = df['__delta_t'].clip(lower=0)
        df[target_col] = (df['Speed'] / 3.6) * df['__delta_t']
        df[target_col] = df.groupby(['vehicle_id', 'lap'])[target_col].cumsum()
        df.drop(columns=['__delta_t'], inplace=True, errors='ignore')
        return df
    
    def calculate_lap_times(self, circuit: str, race: str = "R1") -> pd.DataFrame:
        """Calculate lap times from lap_time.csv (contains only timestamps)"""
        cache_key = f"{circuit}_{race}_laptimes"
        
        if cache_key in self.lap_times_cache:
            return self.lap_times_cache[cache_key]
        
        lap_events = self._load_lap_events(circuit, race).copy()

        if lap_events.empty:
            raise ValueError(f"No lap data available for {circuit} {race}")

        lap_events = lap_events.sort_values(['vehicle_id', 'lap'])
        lap_events['prev_timestamp'] = lap_events.groupby('vehicle_id')['timestamp'].shift(1)
        lap_events['lap_time'] = (lap_events['timestamp'] - lap_events['prev_timestamp']).dt.total_seconds()

        lap_events = lap_events[(lap_events['lap_time'] >= 60) & (lap_events['lap_time'] <= 200)].copy()

        print(f"  ✅ {len(lap_events)} valid laps calculated")

        self.lap_times_cache[cache_key] = lap_events
        return lap_events
    
    def find_golden_lap(self, circuit: str, race: str = "R1") -> Dict:
        """Find the fastest lap (golden lap)"""
        cache_key = f"{circuit}_{race}"
        
        if cache_key in self.golden_laps:
            return self.golden_laps[cache_key]
        
        lap_times = self.calculate_lap_times(circuit, race)
        
        if len(lap_times) == 0:
            raise ValueError("No valid lap times found")
        
        lap_candidates = lap_times.sort_values('lap_time').reset_index(drop=True)
        golden_row = None
        for _, candidate in lap_candidates.iterrows():
            lap_number = int(candidate['lap'])
            if self._lap_has_telemetry(
                circuit,
                candidate['chassis'],
                int(candidate['car_number']),
                lap_number,
                race
            ):
                golden_row = candidate
                break

        if golden_row is None:
            raise ValueError("No lap with telemetry available for golden comparison")
        
        golden_lap = {
            'circuit': circuit,
            'race': race,
            'chassis': golden_row['chassis'],
            'car_number': int(golden_row['car_number']),
            'lap': int(golden_row['lap']),
            'time': float(golden_row['lap_time']),
            'formatted_time': self._format_lap_time(golden_row['lap_time'])
        }
        
        print(f"\n🏆 GOLDEN LAP FOUND")
        print(f"  Circuit: {circuit}")
        print(f"  Chassis: {golden_lap['chassis']}")
        print(f"  Car #: {golden_lap['car_number']}")
        print(f"  Lap: {golden_lap['lap']}")
        print(f"  Time: {golden_lap['formatted_time']}\n")
        
        self.golden_laps[cache_key] = golden_lap
        return golden_lap
    
    def get_vehicles(self, circuit: str, race: str = "R1") -> List[Dict]:
        """Get list of vehicles - optimized to read only necessary data"""
        cache_key = f"{circuit}_{race}_vehicles"
        if cache_key in self.vehicles_cache:
            return self.vehicles_cache[cache_key]

        lap_events = self._load_lap_events(circuit, race)
        if lap_events.empty:
            raise FileNotFoundError(f"No lap data available for {circuit} {race}")

        print(f"📋 Loading vehicles from lap events...")

        vehicles = lap_events.groupby(['chassis', 'car_number']).agg({
            'lap': 'nunique'
        }).reset_index()
        vehicles.columns = ['chassis', 'car_number', 'total_laps']

        print(f"  ✅ {len(vehicles)} vehicles found")

        result = vehicles.to_dict('records')
        self.vehicles_cache[cache_key] = result
        return result
    
    def get_laps(self, circuit: str, chassis: str, car_number: int, race: str = "R1") -> List[Dict]:
        """Get all laps for a specific vehicle"""
        lap_times = self.calculate_lap_times(circuit, race)
        
        vehicle_laps = lap_times[
            (lap_times['chassis'] == chassis) &
            (lap_times['car_number'] == car_number)
        ].copy()
        
        vehicle_laps = vehicle_laps.sort_values('lap')
        
        laps = []
        for _, row in vehicle_laps.iterrows():
            laps.append({
                'lap_number': int(row['lap']),
                'lap_time': float(row['lap_time']),
                'formatted_time': self._format_lap_time(row['lap_time'])
            })
        
        return laps
    
    def _format_lap_time(self, seconds: float) -> str:
        """Format lap time as MM:SS.mmm"""
        minutes = int(seconds // 60)
        secs = seconds % 60
        return f"{minutes}:{secs:06.3f}"
    
    def get_lap_telemetry(self, circuit: str, chassis: str, car_number: int, lap: int, race: str = "R1") -> pd.DataFrame:
        """Extract telemetry for a specific lap - optimized"""
        
        # NE PAS filtrer par vehicle_id dans load_telemetry
        # À la place, charger tout le lap puis filtrer
        
        print(f"🔍 Looking for chassis: {chassis}, car: {car_number}, lap: {lap}")
        
        # Charger SEULEMENT par lap (pas vehicle_id)
        telemetry = self.load_telemetry(circuit, race, vehicle_id=None, lap=lap)
        
        if len(telemetry) == 0:
            raise ValueError(f"No telemetry found for lap {lap}")
        
        # Filtrer par chassis et car_number APRÈS chargement
        telemetry = telemetry[
            (telemetry['chassis'] == chassis) &
            (telemetry['car_number'] == car_number)
        ]
        
        if len(telemetry) == 0:
            raise ValueError(f"No telemetry found for chassis {chassis}, car {car_number}, lap {lap}")
        
        print(f"  ✅ Found {len(telemetry)} telemetry points")
        
        return telemetry.sort_values('timestamp')

    def _lap_has_telemetry(self, circuit: str, chassis: str, car_number: int, lap: int, race: str) -> bool:
        try:
            telemetry = self.get_lap_telemetry(circuit, chassis, car_number, lap, race)
            return len(telemetry) > 0
        except Exception as exc:
            print(f"⚠️  No telemetry for lap {lap} ({chassis}/{car_number}) on {circuit} {race}: {exc}")
            return False
    
    def compare_laps(
        self,
        circuit: str,
        chassis: str,
        car_number: int,
        lap: int,
        race: str = "R1",
        sector_size: int = 200
    ) -> Dict:
        """Compare a lap with the golden lap"""
        
        # Get golden lap info
        golden_info = self.find_golden_lap(circuit, race)
        
        print(f"🔍 Comparing lap {lap} vs golden lap {golden_info['lap']}")
        
        # Get telemetry for both laps
        user_data = self.get_lap_telemetry(circuit, chassis, car_number, lap, race)
        golden_data = self.get_lap_telemetry(
            circuit,
            golden_info['chassis'],
            golden_info['car_number'],
            golden_info['lap'],
            race
        )
        
        print(f"  Raw data: User {len(user_data)} points, Golden {len(golden_data)} points")
        
        # Ensure required columns exist
        for df in (user_data, golden_data):
            if 'aps' not in df.columns:
                df['aps'] = 0.0
            if 'pbrake_f' not in df.columns:
                df['pbrake_f'] = 0.0
            if 'Laptrigger_lapdist_dls' not in df.columns:
                df['Laptrigger_lapdist_dls'] = np.nan
            if 'Speed' not in df.columns:
                df['Speed'] = np.nan

        cols_to_fill = ['Laptrigger_lapdist_dls', 'Speed', 'aps', 'pbrake_f']
        for col in cols_to_fill:
            user_data[col] = user_data[col].ffill().bfill().fillna(0)
            golden_data[col] = golden_data[col].ffill().bfill().fillna(0)

        print(f"  After fill - User NaN in Speed: {user_data['Speed'].isna().sum()}")
        print(f"  After fill - User NaN in distance: {user_data['Laptrigger_lapdist_dls'].isna().sum()}")
        
        # Maintenant dropna seulement sur les colonnes critiques (devrait être ~0 maintenant)
        user_clean = user_data.dropna(subset=['Laptrigger_lapdist_dls', 'Speed'])
        golden_clean = golden_data.dropna(subset=['Laptrigger_lapdist_dls', 'Speed'])
        
        if len(user_clean) == 0:
            raise ValueError("No valid telemetry data for user lap after cleaning")
        if len(golden_clean) == 0:
            raise ValueError("No valid telemetry data for golden lap after cleaning")
        
        print(f"  After cleaning: User {len(user_clean)} points, Golden {len(golden_clean)} points")
        
        # Divide into sectors
        user_clean['sector'] = (user_clean['Laptrigger_lapdist_dls'] // sector_size).astype(int)
        golden_clean['sector'] = (golden_clean['Laptrigger_lapdist_dls'] // sector_size).astype(int)
        
        # Aggregate by sector
        agg_dict = {
            'Speed': 'mean',
            'Laptrigger_lapdist_dls': 'first',
            'aps': 'mean',
            'pbrake_f': 'max'
        }
        
        user_sectors = user_clean.groupby('sector').agg(agg_dict).reset_index()
        golden_sectors = golden_clean.groupby('sector').agg(agg_dict).reset_index()
        
        # Merge
        comparison = user_sectors.merge(
            golden_sectors,
            on='sector',
            suffixes=('_user', '_golden'),
            how='inner'
        )
        
        if len(comparison) == 0:
            raise ValueError("No overlapping sectors between laps")
        
        # Calculate differences
        comparison['speed_diff'] = comparison['Speed_user'] - comparison['Speed_golden']
        comparison['throttle_diff'] = comparison['aps_user'] - comparison['aps_golden']
        comparison['brake_diff'] = comparison['pbrake_f_user'] - comparison['pbrake_f_golden']
        
        # Find worst 3 sectors
        worst_3 = comparison.nsmallest(3, 'speed_diff')
        
        # Generate recommendations
        recommendations = []
        for _, sector in worst_3.iterrows():
            issue, suggestion = self._generate_recommendation(sector)
            
            recommendations.append({
                'sector': int(sector['sector']),
                'distance': int(sector['Laptrigger_lapdist_dls_user']),
                'speed_loss': abs(float(sector['speed_diff'])),
                'issue': issue,
                'suggestion': suggestion,
                'estimated_gain': abs(float(sector['speed_diff'])) * 0.04
            })
        
        # Get lap times
        lap_times = self.calculate_lap_times(circuit, race)
        vehicle_lap_times = lap_times[
            (lap_times['chassis'] == chassis) &
            (lap_times['car_number'] == car_number) &
            (lap_times['lap'] == lap)
        ]
        user_lap_time = float(vehicle_lap_times['lap_time'].values[0]) if len(vehicle_lap_times) > 0 else None

        vehicle_history = lap_times[
            (lap_times['chassis'] == chassis) &
            (lap_times['car_number'] == car_number)
        ].sort_values('lap')
        consistency = self._build_consistency_metrics(vehicle_history)
        progression = self._build_progression_metrics(vehicle_history)
        hot_zones = self._build_hot_zone_metrics(
            circuit,
            chassis,
            car_number,
            vehicle_history['lap'].tolist(),
            race,
            sector_size
        )
        
        # Préparer télémétrie
        print(f"  Preparing telemetry: User {len(user_clean)} points, Golden {len(golden_clean)} points")
        
        sample_base = ['Speed', 'Laptrigger_lapdist_dls']
        user_cols = sample_base + [col for col in ['VBOX_Long_Minutes', 'VBOX_Lat_Min'] if col in user_clean.columns]
        golden_cols = sample_base + [col for col in ['VBOX_Long_Minutes', 'VBOX_Lat_Min'] if col in golden_clean.columns]

        user_telemetry_sample = user_clean[user_cols].copy()
        user_telemetry_sample['timestamp'] = user_clean['timestamp'].astype(str)
        
        golden_telemetry_sample = golden_clean[golden_cols].copy()
        golden_telemetry_sample['timestamp'] = golden_clean['timestamp'].astype(str)
        
        print(f"  Telemetry to send: User {len(user_telemetry_sample)}, Golden {len(golden_telemetry_sample)}")

        ghost_laps = self._build_ghost_laps(
            circuit,
            chassis,
            car_number,
            race,
            vehicle_history,
            exclude_lap=lap
        )
        race_timeline = self._build_race_timeline(vehicle_history, lap_times, golden_info)

        session_results = self.get_race_results_summary(circuit, race)
        weather = self.get_weather_summary(circuit, race)

        result = {
            'user_lap_time': user_lap_time,
            'user_lap_formatted': self._format_lap_time(user_lap_time) if user_lap_time else None,
            'golden_lap_time': golden_info['time'],
            'golden_lap_formatted': golden_info['formatted_time'],
            'time_diff': user_lap_time - golden_info['time'] if user_lap_time else None,
            'sectors': comparison.to_dict('records'),
            'recommendations': recommendations,
            'consistency': consistency,
            'progression': progression,
            'hot_zones': hot_zones,
            'session_context': {
                'race_results': session_results,
                'weather': weather
            },
            'race_timeline': race_timeline,
            'ghost_laps': ghost_laps,
            'telemetry': {
                'user': user_telemetry_sample.to_dict('records'),
                'golden': golden_telemetry_sample.to_dict('records')
            }
        }
        return self._to_native(result)
    
    def _generate_recommendation(self, sector: pd.Series) -> tuple:
        """Generate issue and suggestion based on sector data"""
        
        # Vérifier si les colonnes existent
        has_brake = 'brake_diff' in sector and pd.notna(sector.get('brake_diff', 0))
        has_throttle = 'throttle_diff' in sector and pd.notna(sector.get('throttle_diff', 0))
        
        if has_brake and sector['brake_diff'] > 20:
            issue = "Braking too aggressively"
            suggestion = f"Bleed off ~{int(sector['brake_diff'])} bar of brake pressure"
        elif has_throttle and sector['throttle_diff'] < -10:
            issue = "Hesitant throttle application"
            suggestion = f"Increase throttle by ~{abs(int(sector['throttle_diff']))}% exiting the corner"
        else:
            issue = "Suboptimal corner speed"
            suggestion = "Tighten the line and release the brake earlier to carry more speed"
        
        return issue, suggestion

    def _serialize_lap_telemetry(self, df: pd.DataFrame, sample_size: int = 250) -> List[Dict[str, float]]:
        required_cols = ['Laptrigger_lapdist_dls', 'Speed', 'VBOX_Long_Minutes', 'VBOX_Lat_Min']
        if not all(col in df.columns for col in required_cols):
            return []
        clean = df.dropna(subset=['Laptrigger_lapdist_dls'])
        if clean.empty:
            return []
        if len(clean) > sample_size:
            idx = np.linspace(0, len(clean) - 1, sample_size).astype(int)
            clean = clean.iloc[idx]
        rows = []
        for _, row in clean.iterrows():
            rows.append({
                'distance': float(row['Laptrigger_lapdist_dls']),
                'speed': float(row['Speed']) if 'Speed' in row and not pd.isna(row['Speed']) else None,
                'lon': float(row['VBOX_Long_Minutes']) if 'VBOX_Long_Minutes' in row and not pd.isna(row['VBOX_Long_Minutes']) else None,
                'lat': float(row['VBOX_Lat_Min']) if 'VBOX_Lat_Min' in row and not pd.isna(row['VBOX_Lat_Min']) else None,
                'timestamp': str(row['timestamp']) if 'timestamp' in row else None
            })
        return rows

    def _build_ghost_laps(
        self,
        circuit: str,
        chassis: str,
        car_number: int,
        race: str,
        vehicle_history: pd.DataFrame,
        exclude_lap: int,
        limit: int = 3
    ) -> List[Dict]:
        if vehicle_history is None or len(vehicle_history) == 0:
            return []

        lap_candidates = []
        fastest = vehicle_history.dropna(subset=['lap_time']).sort_values('lap_time')
        slowest = vehicle_history.dropna(subset=['lap_time']).sort_values('lap_time', ascending=False)
        recent = vehicle_history.sort_values('lap', ascending=False)

        for label, df in [('Best Lap', fastest), ('Slowest Lap', slowest), ('Most Recent Lap', recent)]:
            if df.empty:
                continue
            lap_num = int(df.iloc[0]['lap'])
            if lap_num != exclude_lap:
                lap_candidates.append((label, df.iloc[0]))

        ghosts = []
        seen = set()
        for label, row in lap_candidates:
            lap_num = int(row['lap'])
            if lap_num in seen:
                continue
            try:
                telemetry = self.get_lap_telemetry(circuit, chassis, car_number, lap_num, race)
            except Exception:
                continue
            serialized = self._serialize_lap_telemetry(telemetry)
            if not serialized:
                continue
            ghosts.append({
                'label': label,
                'lap': lap_num,
                'lap_time': self._format_lap_time(float(row['lap_time'])),
                'telemetry': serialized
            })
            seen.add(lap_num)
            if len(ghosts) >= limit:
                break
        return ghosts

    def _build_race_timeline(
        self,
        vehicle_history: pd.DataFrame,
        lap_times_df: pd.DataFrame,
        golden_info: Dict[str, Any]
    ) -> List[Dict]:
        if vehicle_history is None or len(vehicle_history) == 0:
            return []

        user_hist = vehicle_history.sort_values('lap')
        golden_hist = lap_times_df[
            (lap_times_df['chassis'] == golden_info['chassis']) &
            (lap_times_df['car_number'] == golden_info['car_number'])
        ].sort_values('lap')

        golden_lookup = {int(row['lap']): float(row['lap_time']) for _, row in golden_hist.iterrows()}
        user_cum = 0.0
        golden_cum = 0.0
        timeline = []

        for _, row in user_hist.iterrows():
            lap_num = int(row['lap'])
            lap_time = float(row['lap_time'])
            user_cum += lap_time
            golden_time = golden_lookup.get(lap_num)
            if golden_time is not None:
                golden_cum += golden_time
                gap = user_cum - golden_cum
            else:
                gap = None
            timeline.append({
                'lap': lap_num,
                'lap_time': lap_time,
                'formatted': self._format_lap_time(lap_time),
                'cumulative': user_cum,
                'gap_to_golden': gap
            })

        return timeline
    def _build_consistency_metrics(self, laps_df: pd.DataFrame) -> Optional[Dict]:
        if laps_df is None or len(laps_df) == 0:
            return None

        laps_df = laps_df.sort_values('lap')
        times = laps_df['lap_time'].tolist()
        if not times:
            return None

        avg_time = float(np.mean(times))
        std_dev = float(np.std(times)) if len(times) > 1 else 0.0
        best_time = float(np.min(times))
        worst_time = float(np.max(times))
        score = max(0.0, 100.0 - ((std_dev / avg_time) * 100.0 if avg_time else 0.0))
        threshold = std_dev * 2
        outliers = []
        lap_breakdown = []

        for _, row in laps_df.iterrows():
            lap_num = int(row['lap'])
            lap_time = float(row['lap_time'])
            delta = lap_time - avg_time

            if std_dev > 0 and abs(delta) > threshold:
                outliers.append(lap_num)

            if lap_time == best_time:
                status = "Personal best"
                icon = "🏆"
            elif lap_time == worst_time:
                status = "Slowest lap"
                icon = "❌"
            elif delta < -std_dev * 0.5:
                status = "Excellent push"
                icon = "✅"
            elif delta > std_dev * 1.5:
                status = "Major drop"
                icon = "⚠️"
            else:
                status = "Consistent"
                icon = "✅"

            lap_breakdown.append({
                'lap': lap_num,
                'time': lap_time,
                'formatted': self._format_lap_time(lap_time),
                'delta_to_avg': delta,
                'status': status,
                'icon': icon
            })

        recommendation = "Great consistency overall. Keep building rhythm."
        if outliers:
            recommendation = f"Watch laps {', '.join(map(str, outliers))}: pace dropped well below the average."

        return {
            'average_time': avg_time,
            'average_formatted': self._format_lap_time(avg_time),
            'best_time': best_time,
            'best_formatted': self._format_lap_time(best_time),
            'worst_time': worst_time,
            'worst_formatted': self._format_lap_time(worst_time),
            'std_dev': std_dev,
            'score': round(score, 1),
            'outliers': outliers,
            'laps': lap_breakdown,
            'recommendation': recommendation
        }

    def _build_progression_metrics(self, laps_df: pd.DataFrame) -> Optional[Dict]:
        if laps_df is None or len(laps_df) == 0:
            return None

        laps_df = laps_df.sort_values('lap')
        times = laps_df['lap_time'].tolist()
        if not times:
            return None

        start_time = times[0]
        best_time = float(np.min(times))
        total_improvement = start_time - best_time
        lap_points = []
        plateau_start = None
        plateau_detected = None

        for idx, row in enumerate(laps_df.itertuples()):
            previous_time = times[idx - 1] if idx > 0 else None
            lap_time = float(row.lap_time)
            delta_prev = (previous_time - lap_time) if previous_time else 0.0
            improvement_from_start = start_time - lap_time

            if idx > 0:
                if abs(delta_prev) < 0.1:
                    plateau_start = plateau_start or row.lap
                else:
                    plateau_start = None

            if plateau_start and abs(delta_prev) < 0.1:
                plateau_detected = plateau_start

            lap_points.append({
                'lap': int(row.lap),
                'time': lap_time,
                'formatted': self._format_lap_time(lap_time),
                'delta_prev': delta_prev,
                'improvement_from_start': improvement_from_start
            })

        insights = []
        if total_improvement > 0:
            insights.append(f"Improved {total_improvement:.2f}s from lap 1 to best lap.")
        else:
            insights.append("Pace stayed flat versus the opening lap.")
        if plateau_detected:
            insights.append(f"Pace plateau detected around lap {int(plateau_detected)}.")

        return {
            'total_improvement': total_improvement,
            'laps': lap_points,
            'insights': insights
        }

    def _build_hot_zone_metrics(
        self,
        circuit: str,
        chassis: str,
        car_number: int,
        laps: List[int],
        race: str,
        sector_size: int
    ) -> Optional[Dict]:
        if not laps:
            return None

        recent_laps = laps[-6:]
        sector_speeds = {}

        for lap_num in recent_laps:
            try:
                lap_data = self.get_lap_telemetry(circuit, chassis, car_number, lap_num, race)
            except Exception:
                continue

            if 'Laptrigger_lapdist_dls' not in lap_data or 'Speed' not in lap_data:
                continue

            segment = lap_data[['Laptrigger_lapdist_dls', 'Speed']].dropna()
            if len(segment) == 0:
                continue

            segment['sector'] = (segment['Laptrigger_lapdist_dls'] // sector_size).astype(int)
            sector_means = segment.groupby('sector')['Speed'].mean()

            for sector, speed in sector_means.items():
                sector_speeds.setdefault(int(sector), []).append(float(speed))

        if not sector_speeds:
            return None

        sector_stats = []
        for sector, speeds in sector_speeds.items():
            speeds_arr = np.array(speeds)
            variance = float(np.var(speeds_arr)) if len(speeds_arr) > 1 else 0.0
            sector_stats.append({
                'sector': sector,
                'samples': len(speeds),
                'variance': variance,
                'avg_speed': float(np.mean(speeds_arr)),
                'rating': self._classify_variance(variance)
            })

        sector_stats.sort(key=lambda x: x['variance'], reverse=True)
        weak = [s for s in sector_stats if s['rating'] == 'weak'][:3]
        strong = [s for s in sector_stats if s['rating'] == 'excellent'][:3]

        return {
            'sectors': sector_stats,
            'weak': weak,
            'strong': strong
        }

    def _classify_variance(self, variance: float) -> str:
        if variance < 1.5:
            return 'excellent'
        if variance < 3.5:
            return 'good'
        if variance < 7.0:
            return 'ok'
        return 'weak'

    def get_race_results_summary(self, circuit: str, race: str = "R1") -> Optional[Dict]:
        cache_key = f"{circuit}_{race}"
        if cache_key in self.race_results_cache:
            return self.race_results_cache[cache_key]

        path = self._find_support_file(circuit, race, ["results by class", "provisional results", "results"])
        if not path:
            self.race_results_cache[cache_key] = None
            return None

        try:
            if path.suffix.lower() == '.parquet':
                df = pd.read_parquet(path)
            else:
                df = pd.read_csv(path, sep=';', engine='python', encoding_errors='ignore')
        except Exception as exc:
            print(f"⚠️  Could not parse race results file {path.name}: {exc}")
            self.race_results_cache[cache_key] = None
            return None

        class_col = None
        for candidate in ['CLASS_TYPE', 'CLASS', 'CLASS NAME']:
            if candidate in df.columns:
                class_col = candidate
                break

        if class_col is None or 'POS' not in df.columns:
            self.race_results_cache[cache_key] = None
            return None

        df['POS'] = pd.to_numeric(df['POS'], errors='coerce')
        df = df.dropna(subset=['POS']).sort_values('POS')
        if df.empty:
            self.race_results_cache[cache_key] = None
            return None

        def build_row(row):
            return {
                'pos': int(row.get('POS', 0)),
                'number': row.get('NUMBER'),
                'laps': int(row.get('LAPS')) if 'LAPS' in row and not pd.isna(row['LAPS']) else None,
                'elapsed': row.get('ELAPSED'),
                'gap_first': row.get('GAP_FIRST'),
                'best_lap': row.get('BEST_LAP_TIME'),
                'best_kph': row.get('BEST_LAP_KPH')
            }

        overall = build_row(df.iloc[0])
        if 'BEST_LAP_TIME' in df.columns:
            df['best_secs'] = df['BEST_LAP_TIME'].apply(self._parse_time_string)
            best_lap_row = df.dropna(subset=['best_secs']).sort_values('best_secs').iloc[0] if df['best_secs'].notna().any() else None
        else:
            best_lap_row = None
        best_lap = None
        if best_lap_row is not None:
            best_lap = {
                'number': best_lap_row.get('NUMBER'),
                'time': best_lap_row.get('BEST_LAP_TIME'),
                'kph': best_lap_row.get('BEST_LAP_KPH')
            }

        classes = []
        for class_name, group in df.groupby(class_col):
            class_rows = group.sort_values('POS').head(3)
            classes.append({
                'class': class_name,
                'top': [build_row(row) for _, row in class_rows.iterrows()]
            })

        summary = {
            'source': path.name,
            'overall': overall,
            'classes': classes,
            'best_lap': best_lap
        }

        self.race_results_cache[cache_key] = summary
        return summary

    def get_weather_summary(self, circuit: str, race: str = "R1") -> Optional[Dict]:
        cache_key = f"{circuit}_{race}"
        if cache_key in self.weather_cache:
            return self.weather_cache[cache_key]

        path = self._find_support_file(circuit, race, ["weather"])
        if not path:
            self.weather_cache[cache_key] = None
            return None

        try:
            if path.suffix.lower() == '.parquet':
                df = pd.read_parquet(path)
            else:
                df = pd.read_csv(path, sep=';', engine='python', encoding_errors='ignore')
        except Exception as exc:
            print(f"⚠️  Could not parse weather file {path.name}: {exc}")
            self.weather_cache[cache_key] = None
            return None

        # Some weather Parquet files store the entire row as a single semicolon-separated column.
        if len(df.columns) == 1 and ';' in df.columns[0]:
            raw_column = df.columns[0]
            split_names = [part.strip() for part in raw_column.split(';')]
            expanded = df.iloc[:, 0].astype(str).str.split(';', expand=True)
            if expanded.shape[1] == len(split_names):
                expanded.columns = split_names
                df = expanded
            else:
                # Fallback: try using the first row as header
                first_row = expanded.iloc[0].tolist()
                if len(first_row) == expanded.shape[1]:
                    df = expanded
                    df.columns = [f'col_{idx}' for idx in range(expanded.shape[1])]
                else:
                    print(f"⚠️  Weather file {path.name} has unexpected format.")

        df.columns = [col.strip().upper() for col in df.columns]
        
        for col in ['AIR_TEMP', 'TRACK_TEMP', 'HUMIDITY', 'PRESSURE', 'WIND_SPEED', 'WIND_DIRECTION', 'RAIN']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')

        if 'TRACK_TEMP' in df.columns:
            df['TRACK_TEMP'].replace(0, np.nan, inplace=True)

        def stats(col_name):
            if col_name not in df:
                return None
            series = df[col_name].dropna()
            if series.empty:
                return None
            return {
                'min': round(series.min(), 2),
                'max': round(series.max(), 2),
                'avg': round(series.mean(), 2)
            }

        summary = {
            'air_temp': stats('AIR_TEMP'),
            'track_temp': stats('TRACK_TEMP'),
            'humidity': stats('HUMIDITY'),
            'pressure': stats('PRESSURE'),
            'wind_speed': stats('WIND_SPEED'),
            'wind_direction': round(df['WIND_DIRECTION'].dropna().median(), 1) if 'WIND_DIRECTION' in df and df['WIND_DIRECTION'].notna().any() else None,
            'rain': bool(df['RAIN'].dropna().gt(0).any()) if 'RAIN' in df else False,
            'samples': len(df)
        }

        self.weather_cache[cache_key] = summary
        return summary

    def _find_support_file(self, circuit: str, race: str, keywords: List[str]) -> Optional[Path]:
        directory = self.data_path / circuit
        if not directory.exists():
            return None

        race_tokens = self._build_race_tokens(race)
        lowered_patterns = [kw.lower() for kw in keywords]

        def matches(name: str) -> bool:
            lname = name.lower()
            return any(pattern in lname for pattern in lowered_patterns) and self._name_matches_race(lname, race_tokens)

        for ext in ("*.parquet", "*.csv", "*.CSV"):
            candidates = sorted([p for p in directory.glob(ext) if matches(p.name)], key=lambda x: x.name)
            if candidates:
                return candidates[0]
        return None

    def _parse_time_string(self, value: Optional[str]) -> Optional[float]:
        if not isinstance(value, str):
            return None
        value = value.strip()
        if not value:
            return None
        try:
            parts = value.replace(',', '.').split(':')
            parts = [p.strip() for p in parts]
            if len(parts) == 1:
                return float(parts[0])
            total = 0.0
            for idx, part in enumerate(reversed(parts)):
                factor = 60 ** idx
                total += float(part) * factor
            return total
        except ValueError:
            return None

    def get_available_circuits(self) -> List[Dict[str, Any]]:
        """Return a list of circuit directories that have usable Parquet data."""
        circuits = []
        if not self.data_path.exists():
            return circuits

        for entry in sorted(self.data_path.iterdir(), key=lambda p: p.name):
            if not entry.is_dir() or entry.name.startswith('.'):
                continue

            telemetry_exists = self._directory_has_keyword(entry, "telemetry")
            lap_time_exists = self._directory_has_keyword(entry, "lap_time")
            if not telemetry_exists or not lap_time_exists:
                continue

            circuit_id = entry.name
            circuits.append({
                "id": circuit_id,
                "name": self._format_circuit_name(circuit_id),
                "path": str(entry),
                "races": self._discover_races(entry)
            })
        return circuits

    def _discover_races(self, circuit_dir: Path) -> List[str]:
        races = set()
        pattern = re.compile(r'(R\d+)', re.IGNORECASE)
        for file_path in circuit_dir.glob("*.*"):
            match = pattern.search(file_path.stem)
            if match:
                races.add(match.group(1).upper())
        return sorted(races)

    def _format_circuit_name(self, slug: str) -> str:
        cleaned = slug.replace('_', ' ').replace('-', ' ')
        return cleaned.title()

    def _directory_has_keyword(self, directory: Path, keyword: str) -> bool:
        patterns = self._get_patterns(keyword)
        for ext in ("*.parquet", "*.csv"):
            for file_path in directory.glob(ext):
                if self._matches_patterns(file_path.name, patterns):
                    return True
        return False

    def _build_race_tokens(self, race: str) -> List[str]:
        race = (race or "").strip()
        if not race:
            return []
        tokens = [
            f"race {race[1:]}".lower() if len(race) > 1 else race.lower(),
            race.lower(),
            race.replace("R", "race").lower()
        ]
        return list(dict.fromkeys(tokens))  # dedupe while preserving order

    def _name_matches_race(self, name: str, race_tokens: List[str]) -> bool:
        if not race_tokens:
            return True
        return any(token in name for token in race_tokens)

    def _find_data_file(self, circuit: str, race: str, keyword: str, prefer_parquet: bool = True) -> Optional[Path]:
        directory = self.data_path / circuit
        if not directory.exists():
            return None

        race_tokens = self._build_race_tokens(race)
        patterns = self._get_patterns(keyword)

        def match(path: Path) -> bool:
            name = path.name
            if not self._matches_patterns(name, patterns):
                return False
            if not self._name_matches_race(name.lower(), race_tokens):
                return False
            return True

        if prefer_parquet:
            candidates = sorted([p for p in directory.glob("*.parquet") if match(p)], key=lambda x: x.name)
            if candidates:
                return candidates[0]

        candidates = sorted([p for p in directory.glob("*.csv") if match(p)], key=lambda x: x.name)
        return candidates[0] if candidates else None

    def _to_native(self, value):
        if isinstance(value, dict):
            return {k: self._to_native(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._to_native(v) for v in value]
        if isinstance(value, tuple) or isinstance(value, set):
            return [self._to_native(v) for v in value]
        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, pd.Timestamp):
            return value.isoformat()
        if isinstance(value, pd.Series):
            return self._to_native(value.to_dict())
        if isinstance(value, float):
            if not math.isfinite(value):
                return None
        return value
    
    def clear_cache(self):
        """Clear all caches"""
        self.telemetry_cache = {}
        self.lap_times_cache = {}
        self.lap_events_cache = {}
        self.vehicles_cache = {}
        self.golden_laps = {}
        print("🗑️  Cache cleared")

# Global instance
processor = RaceDataProcessor()
