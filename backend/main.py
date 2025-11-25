from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Charger variables d'environnement
load_dotenv()

app = FastAPI(
    title="Apex Replay API",
    description="Driver training through telemetry analysis",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permissif pour le dev local
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "message": "Apex Replay API",
        "status": "running",
        "environment": os.getenv("ENVIRONMENT", "development")
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/clear-cache")
def clear_cache():
    """Clear all caches"""
    from services.data_processor import processor
    processor.clear_cache()
    return {"status": "cache cleared"}

# Import des routers ICI (après création de app)
from routers.circuits import router as circuits_router
from routers.vehicles import router as vehicles_router
from routers.analysis import router as analysis_router
from routers.replay import router as replay_router

app.include_router(circuits_router, prefix="/api/circuits", tags=["Circuits"])
app.include_router(vehicles_router, prefix="/api/vehicles", tags=["Vehicles"])
app.include_router(analysis_router, prefix="/api/analysis", tags=["Analysis"])
app.include_router(replay_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )