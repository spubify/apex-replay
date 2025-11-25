import pandas as pd
from pathlib import Path
import sys

def convert_csv_to_parquet(csv_path: Path):
    """Convert a single CSV to Parquet"""
    parquet_path = csv_path.with_suffix('.parquet')
    
    print(f"\n📄 {csv_path.name}")
    print(f"  → Reading CSV (this may take a while)...")
    
    # Lire par chunks
    chunks = []
    chunk_size = 500000
    total_rows = 0
    
    for i, chunk in enumerate(pd.read_csv(csv_path, chunksize=chunk_size)):
        chunks.append(chunk)
        total_rows += len(chunk)
        print(f"    Chunk {i+1}: {len(chunk):,} rows (total: {total_rows:,})")
    
    df = pd.concat(chunks, ignore_index=True)
    print(f"  → Total: {len(df):,} rows")
    
    # Sauvegarder en Parquet
    print(f"  → Writing Parquet with compression...")
    df.to_parquet(
        parquet_path,
        engine='pyarrow',
        compression='snappy',
        index=False
    )
    
    # Comparer tailles
    csv_size = csv_path.stat().st_size / (1024**2)  # MB
    parquet_size = parquet_path.stat().st_size / (1024**2)  # MB
    reduction = (1 - parquet_size/csv_size) * 100
    
    print(f"  ✅ Done!")
    print(f"    CSV:     {csv_size:,.1f} MB")
    print(f"    Parquet: {parquet_size:,.1f} MB ({reduction:.1f}% reduction)")
    
    return parquet_path

def convert_circuit(circuit_name: str, data_path: Path):
    """Convert all CSVs for a circuit"""
    circuit_path = data_path / circuit_name
    
    if not circuit_path.exists():
        print(f"❌ Circuit not found: {circuit_path}")
        return
    
    print(f"\n{'='*60}")
    print(f"🏁 Converting {circuit_name.upper()} to Parquet")
    print(f"{'='*60}")
    
    csv_files = sorted(circuit_path.glob("*.csv"))
    
    if not csv_files:
        print(f"  No CSV files found in {circuit_path}")
        return
    
    for csv_file in csv_files:
        try:
            convert_csv_to_parquet(csv_file)
        except Exception as e:
            print(f"  ❌ Error converting {csv_file.name}: {e}")

if __name__ == "__main__":
    # Path to data folder
    data_path = Path(__file__).parent.parent.parent / "data"
    
    print(f"📁 Data path: {data_path.absolute()}")
    
    # Convert Barber circuit
    convert_circuit("barber", data_path)
    
    print("\n" + "="*60)
    print("✅ Conversion complete!")
    print("="*60)