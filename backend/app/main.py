from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine, ensure_schema_compatibility
from app.routers import things

ensure_schema_compatibility()
Base.metadata.create_all(bind=engine)

app = FastAPI(title="ONEKEY API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(things.router)


@app.get("/health")
def health():
    return {"status": "ok"}
