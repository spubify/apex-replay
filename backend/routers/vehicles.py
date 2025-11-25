from fastapi import APIRouter, HTTPException
from services.data_processor import processor

router = APIRouter()

@router.get("/{circuit}")
def list_vehicles(circuit: str, race: str = "R1"):
    """List all vehicles for a circuit"""
    try:
        vehicles = processor.get_vehicles(circuit, race)
        return vehicles
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{circuit}/{chassis}/{car_number}/laps")
def list_laps(circuit: str, chassis: str, car_number: int, race: str = "R1"):
    """List all laps for a specific vehicle"""
    try:
        laps = processor.get_laps(circuit, chassis, car_number, race)
        return laps
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))