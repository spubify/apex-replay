from fastapi import APIRouter, HTTPException
from services.data_processor import processor

router = APIRouter()

_CIRCUIT_METADATA = {
    "barber": {
        "id": "barber",
        "name": "Barber Motorsports Park",
        "location": "Birmingham, Alabama",
        "length_miles": 2.28,
        "length_km": 3.67,
        "sectors": 3,
        "finish_line_gps": {
            "lat": 33.5326722,
            "lon": -86.6196083
        }
    }
}

def _merge_circuit_payload(entry: dict, extended: bool = False) -> dict:
    meta = _CIRCUIT_METADATA.get(entry["id"], {})
    payload = {
        "id": entry["id"],
        "name": meta.get("name", entry.get("name", entry["id"])),
        "length_miles": meta.get("length_miles"),
        "length_km": meta.get("length_km"),
        "sectors": meta.get("sectors"),
        "races": entry.get("races", [])
    }
    if extended:
        payload.update({
            "location": meta.get("location"),
            "finish_line_gps": meta.get("finish_line_gps")
        })
    return payload

def _get_available_circuit_map():
    available = processor.get_available_circuits()
    return {c["id"]: c for c in available}

@router.get("/")
def list_circuits():
    """List all available circuits"""
    circuit_map = _get_available_circuit_map()
    if not circuit_map:
        return []

    return [
        _merge_circuit_payload(entry)
        for entry in sorted(circuit_map.values(), key=lambda item: item.get("name", item["id"]))
    ]

@router.get("/{circuit}")
def get_circuit_info(circuit: str):
    """Get detailed info about a circuit"""
    circuit_map = _get_available_circuit_map()
    entry = circuit_map.get(circuit)
    if not entry:
        raise HTTPException(status_code=404, detail="Circuit not found")
    return _merge_circuit_payload(entry, extended=True)
