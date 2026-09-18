from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from pydantic_settings import BaseSettings
from supabase import create_client, Client


class Settings(BaseSettings):
    database_url: str
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_anon_key: str = ""  # used to verify user session tokens (auth), NOT for storage
    storage_bucket: str = "onekey-media"
    phash_warning_threshold: int = 8

    class Config:
        env_file = ".env"


settings = Settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def ensure_schema_compatibility():
    """Apply idempotent forward migrations required by the current API."""
    with engine.begin() as conn:
        conn.execute(text("""
            ALTER TABLE things
            ADD COLUMN IF NOT EXISTS identity_type text
        """))
        conn.execute(text("""
            ALTER TABLE things
            ADD COLUMN IF NOT EXISTS identity_value text
        """))
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

        # Contact is now the proof-of-ownership key for document uploads
        # (and will be for transfer). Normalize existing rows to
        # trim+lowercase so an owner whose contact was stored with different
        # casing before this change doesn't get locked out of their own
        # records. Collisions (two rows differing only by case/whitespace)
        # are left as-is rather than silently merged — that needs a human
        # to confirm they're really the same person.
        conn.execute(text("""
            UPDATE users
            SET contact = lower(trim(contact))
            WHERE contact <> lower(trim(contact))
              AND lower(trim(contact)) NOT IN (
                  SELECT lower(trim(contact)) FROM users AS u2
                  WHERE u2.id <> users.id
              )
        """))

        # Ownership transfers are two-party confirmations. Keep requests
        # separate from the Thing until both email identities have confirmed.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ownership_transfers (
                id uuid PRIMARY KEY,
                thing_id uuid NOT NULL REFERENCES things(id) ON DELETE CASCADE,
                current_owner_id uuid NOT NULL REFERENCES users(id),
                new_owner_id uuid NOT NULL REFERENCES users(id),
                current_owner_confirmed_at timestamp NULL,
                new_owner_confirmed_at timestamp NULL,
                status text NOT NULL DEFAULT 'pending',
                created_at timestamp NOT NULL DEFAULT now(),
                completed_at timestamp NULL,
                CONSTRAINT ck_transfer_status
                    CHECK (status IN ('pending','completed','cancelled','expired'))
            )
        """))

        # Documents can now be a written note instead of / in addition to a
        # file. Older databases have url NOT NULL from before this change —
        # relax that and add the "must have something" check constraint.
        conn.execute(text("""
            ALTER TABLE documents
            ADD COLUMN IF NOT EXISTS body text
        """))
        conn.execute(text("""
            ALTER TABLE documents
            ALTER COLUMN url DROP NOT NULL
        """))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'ck_document_has_content'
                ) THEN
                    ALTER TABLE documents
                    ADD CONSTRAINT ck_document_has_content
                    CHECK (url IS NOT NULL OR body IS NOT NULL);
                END IF;
            END $$;
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


def get_auth_client() -> Client:
    # Deliberately the anon key, not the service role key: this client is
    # only used to ask "is this session token valid, and whose is it" —
    # it should never carry admin privileges.
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY are required for auth verification")
    return create_client(settings.supabase_url, settings.supabase_anon_key)
