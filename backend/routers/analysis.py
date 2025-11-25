import os
import traceback
from collections import OrderedDict
from copy import deepcopy
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ai_coach import ai_coach
from services.data_processor import processor

router = APIRouter()


class CompareRequest(BaseModel):
    circuit: str
    chassis: str
    car_number: int
    lap: int
    race: str = "R1"


_CACHE_LIMIT = int(os.getenv("ANALYSIS_CACHE_LIMIT", "32"))
_analysis_cache: "OrderedDict[str, dict]" = OrderedDict()


def _make_cache_key(request: CompareRequest) -> str:
    return f"{request.circuit}:{request.chassis}:{request.car_number}:{request.lap}:{request.race}:v2"


def _cache_get(key: str) -> Optional[dict]:
    cached = _analysis_cache.get(key)
    if cached is not None:
        _analysis_cache.move_to_end(key)
        return deepcopy(cached)
    return None


def _cache_set(key: str, payload: dict) -> None:
    _analysis_cache[key] = deepcopy(payload)
    _analysis_cache.move_to_end(key)
    while len(_analysis_cache) > _CACHE_LIMIT:
        _analysis_cache.popitem(last=False)


@router.get("/golden/{circuit}")
def get_golden_lap(circuit: str, race: str = "R1"):
    """Get golden lap information"""
    try:
        golden = processor.find_golden_lap(circuit, race)
        return golden
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare")
def compare_lap(request: CompareRequest):
    """Compare a lap against the golden lap"""
    try:
        cache_key = _make_cache_key(request)
        cached = _cache_get(cache_key)
        if cached:
            return cached

        result = processor.compare_laps(
            request.circuit,
            request.chassis,
            request.car_number,
            request.lap,
            request.race
        )
        ai_result = ai_coach.generate_insights(result)
        result.update(ai_result)  # Merge AI results (summary, recommendations, track_insights) into top level
        result["ai_coach"] = ai_result # Keep nested for backward compat if needed, or just for clarity
        _cache_set(cache_key, result)
        return result
    except ValueError as e:
        print(f"❌ ValueError: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        print(f"❌ FileNotFoundError: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
