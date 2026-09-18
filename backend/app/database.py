from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from pydantic_settings import BaseSettings
from supabase import create_client, Client


class Settings(BaseSettings):
    database_url: str
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    storage_bucket: str = "onekey-media"
    phash_warning_threshold: int = 8

    class Config:
        env_file = ".env"


settings = Settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def ensure_schema_compatibility():
    """
    Apply the small forward-only schema changes needed by the current API.
    This is intentionally idempotent so existing Supabase databases are upgraded
    without requiring a separate migration runner.
    """
    with engine.begin() as conn:
        # Older ONEKEY databases may predate the identity fields.
        conn.execute(text("""
            ALTER TABLE things
            ADD COLUMN IF NOT EXISTS identity_type text
        """))
        conn.execute(text("""
            ALTER TABLE things
            ADD COLUMN IF NOT EXISTS identity_value text
        """))

        # Preserve existing records by treating their ONEKEY code as the
        # identity when no physical serial/barcode was recorded yet.
        conn.execute(text("""
            UPDATE things
            SET identity_type = COALESCE(identity_type, 'qr_tag'),
                identity_value = COALESCE(identity_value, onekey_code)
            WHERE identity_type IS NULL OR identity_value IS NULL
        """))

        conn.execute(text("""
            ALTER TABLE things
            ALTER COLUMN identity_type SET NOT NULL
        """))
        conn.execute(text("""
            ALTER TABLE things
            ALTER COLUMN identity_value SET NOT NULL
        """))

        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_things_identity_value
            ON things(identity_value)
        """))



def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_storage_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for file storage")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
