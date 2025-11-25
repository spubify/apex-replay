from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from pydantic import BaseModel
from services.data_processor import RaceDataProcessor
from services.replay_processor import ReplayProcessor

router = APIRouter(prefix="/api/replay", tags=["replay"])

# Dependency to get processors
# In a real app, these might be singletons or injected
_data_processor = None
_replay_processor = None

def get_processors():
    global _data_processor, _replay_processor
    if _data_processor is None:
        _data_processor = RaceDataProcessor()
    if _replay_processor is None:
        _replay_processor = ReplayProcessor(_data_processor)
    return _data_processor, _replay_processor

class ReplayRequest(BaseModel):
    circuit: str
    laps: List[Dict[str, Any]] # [{'chassis': '...', 'car_number': 99, 'lap': 1}, ...]

class CommentaryRequest(BaseModel):
    cars: List[Dict[str, Any]]
    current_time: float

@router.get("/setup/{circuit}")
async def get_replay_setup(circuit: str):
    dp, _ = get_processors()
    try:
        golden_lap = dp.find_golden_lap(circuit)
        vehicles = dp.get_vehicles(circuit)
        return {
            "golden_lap": golden_lap,
            "vehicles": vehicles
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.get("/vehicle/{circuit}/{chassis}/{car}")
async def get_vehicle_laps(circuit: str, chassis: str, car: int):
    dp, _ = get_processors()
    try:
        laps = dp.get_laps(circuit, chassis, car)
        return {"laps": laps}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/prepare")
async def prepare_replay(request: ReplayRequest):
    _, rp = get_processors()
    results = []
    
    for item in request.laps:
        try:
            timeline = rp.normalize_lap_to_timeline(
                request.circuit,
                item['chassis'],
                item['car_number'],
                item['lap']
            )
            if timeline:
                # Add display info
                timeline['name'] = item.get('name', f"Car {item['car_number']}")
                timeline['color'] = item.get('color', '#ffffff')
                results.append(timeline)
        except Exception as e:
            print(f"Failed to prepare lap {item}: {e}")
            continue
            
    return {"timelines": results}

@router.post("/commentary")
async def get_commentary(request: CommentaryRequest):
    _, rp = get_processors()
    comment = rp.generate_commentary(request.dict())
    return {"comment": comment}
