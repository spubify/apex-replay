import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any
from services.data_processor import RaceDataProcessor

class ReplayProcessor:
    def __init__(self, data_processor: RaceDataProcessor):
        self.data_processor = data_processor
        self.max_points = 4500

    def normalize_lap_to_timeline(self, circuit: str, chassis: str, car_number: int, lap: int, race: str = "R1") -> Dict[str, Any]:
        """
        Convert distance-based telemetry to time-based timeline for replay
        """
        try:
            telemetry_df = self.data_processor.get_lap_telemetry(circuit, chassis, car_number, lap, race)
        except Exception as e:
            print(f"Error fetching telemetry: {e}")
            return None

        if telemetry_df.empty:
            return None

        # Ensure required columns
        required_cols = ['Laptrigger_lapdist_dls', 'Speed', 'VBOX_Long_Minutes', 'VBOX_Lat_Min', 'aps', 'pbrake_f']
        for col in required_cols:
            if col not in telemetry_df.columns:
                telemetry_df[col] = np.nan
            
            # Interpolate missing values, then forward/backward fill edges
            telemetry_df[col] = telemetry_df[col].interpolate(method='linear', limit_direction='both')
            telemetry_df[col] = telemetry_df[col].ffill().bfill().fillna(0) # Fallback to 0 only if ALL are NaN

        # Sort by distance - REMOVED to preserve time order and avoid zig-zags from noisy distance data
        # telemetry_df = telemetry_df.sort_values('Laptrigger_lapdist_dls').reset_index(drop=True)
        telemetry_df = telemetry_df.reset_index(drop=True)

        # Basic bounds used by the frontend to normalize the track in 3D space
        bounds = {
            'min_x': float(telemetry_df['VBOX_Long_Minutes'].min()),
            'max_x': float(telemetry_df['VBOX_Long_Minutes'].max()),
            'min_z': float(telemetry_df['VBOX_Lat_Min'].min()),
            'max_z': float(telemetry_df['VBOX_Lat_Min'].max()),
        }

        max_distance = float(telemetry_df['Laptrigger_lapdist_dls'].max())

        timeline = []
        cumulative_time = 0
        
        # Initial point
        timeline.append({
            'time': 0.0,
            'position': {
                'x': self._clean_number(telemetry_df.iloc[0]['VBOX_Long_Minutes']),
                'y': 0,
                'z': self._clean_number(telemetry_df.iloc[0]['VBOX_Lat_Min'])
            },
            'speed': self._clean_number(telemetry_df.iloc[0]['Speed']),
            'throttle': self._clean_number(telemetry_df.iloc[0]['aps']),
            'brake': self._clean_number(telemetry_df.iloc[0]['pbrake_f']),
            'distance': self._clean_number(telemetry_df.iloc[0]['Laptrigger_lapdist_dls'])
        })

        for i in range(len(telemetry_df) - 1):
            current = telemetry_df.iloc[i]
            next_point = telemetry_df.iloc[i + 1]
            
            # Calculate time to next point
            distance = next_point['Laptrigger_lapdist_dls'] - current['Laptrigger_lapdist_dls']
            
            # Skip if distance is negative (data artifact) or zero
            if distance <= 0:
                continue

            # --- Spatial Glitch Filter ---
            # Calculate Euclidean distance in "minutes" (approx 1852m per minute)
            d_lat = next_point['VBOX_Lat_Min'] - current['VBOX_Lat_Min']
            d_long = next_point['VBOX_Long_Minutes'] - current['VBOX_Long_Minutes']
            eucl_dist_min = (d_lat**2 + d_long**2)**0.5
            eucl_dist_m = eucl_dist_min * 1852

            # Case 1: GPS Glitch (Teleport)
            # Physical jump is huge, but lap distance is reasonable.
            if eucl_dist_m > 50 and eucl_dist_m > distance * 5:
                 continue
            
            # Case 2: Distance Glitch (Spike in lap dist)
            # Lap distance jump is huge, but physical jump is small.
            # We trust the physical position more for the path shape, but we need time step.
            # If distance is huge, time step will be huge -> slow motion.
            # We can cap the distance to eucl_dist_m if it's way off.
            if distance > 50 and distance > eucl_dist_m * 5:
                distance = eucl_dist_m
            # -----------------------------

            avg_speed_ms = (current['Speed'] + next_point['Speed']) / 2 / 3.6  # km/h → m/s
            
            if avg_speed_ms > 1: # Avoid division by zero or very low speeds
                time_step = distance / avg_speed_ms
            else:
                # Fallback for very slow speeds (e.g. pit lane or stop)
                # Assume a slow constant speed or cap time_step
                time_step = distance / 1.0 # 1 m/s fallback
            
            cumulative_time += time_step
            
            timeline.append({
                'time': self._clean_number(cumulative_time),
                'position': {
                    'x': self._clean_number(next_point['VBOX_Long_Minutes']),
                    'y': 0,
                    'z': self._clean_number(next_point['VBOX_Lat_Min'])
                },
                'speed': self._clean_number(next_point['Speed']),
                'throttle': self._clean_number(next_point['aps']),
                'brake': self._clean_number(next_point['pbrake_f']),
                'distance': self._clean_number(next_point['Laptrigger_lapdist_dls'])
            })

        timeline = self._downsample_timeline(timeline, self.max_points)
        duration = float(cumulative_time) if cumulative_time else float(timeline[-1]['time'])

        return {
            'circuit': circuit,
            'chassis': chassis,
            'car_number': car_number,
            'lap': lap,
            'duration': duration,
            'timeline': timeline,
            'bounds': bounds,
            'max_distance': max_distance,
            'point_count': len(timeline)
        }

    def _clean_number(self, value: float) -> float:
        """Ensure JSON-safe finite floats; fallback to 0."""
        try:
            number = float(value)
        except Exception:
            return 0.0
        if not np.isfinite(number):
            return 0.0
        return number

    def _downsample_timeline(self, timeline: List[Dict[str, Any]], max_points: int) -> List[Dict[str, Any]]:
        """
        Reduce timeline density to keep payloads light for the frontend renderer.
        Preserves start/end and samples uniformly across the lap.
        """
        if len(timeline) <= max_points:
            return timeline

        indices = np.linspace(0, len(timeline) - 1, max_points, dtype=int)
        selected = []
        seen = set()
        for idx in indices:
            if idx in seen:
                continue
            selected.append(timeline[idx])
            seen.add(idx)
        return selected

    def generate_commentary(self, race_state: Dict[str, Any]) -> Optional[str]:
        """
        Generate commentary based on race state
        race_state = {
            'cars': [{'name': 'Golden', 'position': 1, 'distance': 1000, 'speed': 150}, ...],
            'current_time': 45.0
        }
        """
        import random
        
        cars = race_state.get('cars', [])
        if len(cars) < 2:
            return None

        # Sort by position (distance)
        cars.sort(key=lambda x: x.get('distance', 0), reverse=True)
        
        leader = cars[0]
        second = cars[1]
        gap = leader.get('distance', 0) - second.get('distance', 0)
        
        # Random chance to comment to avoid spam
        if random.random() > 0.3:
            return None

        templates = []
        
        # Gap commentary
        if gap > 50:
            templates.append(f"{leader['name']} is building a solid lead, {int(gap)}m ahead.")
            templates.append(f"{leader['name']} is running away with it!")
        elif gap < 10:
            templates.append(f"{second['name']} is right on the gearbox of {leader['name']}!")
            templates.append(f"Tight battle for the lead! Only {int(gap)}m separates them.")
        
        # Speed commentary
        if leader.get('speed', 0) > 160:
             templates.append(f"{leader['name']} hitting top speeds of {int(leader['speed'])} km/h.")

        if templates:
            return random.choice(templates)
        
        return None
