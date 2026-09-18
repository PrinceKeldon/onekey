from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine, settings
from app.routers import things

Base.metadata.create_all(bind=engine)  # convenience for local dev; use supabase_schema.sql for real deploys

app = FastAPI(title="ONEKEY API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before shipping past MVP
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=settings.local_media_dir), name="media")
app.include_router(things.router)


@app.get("/health")
def health():
    return {"status": "ok"}
