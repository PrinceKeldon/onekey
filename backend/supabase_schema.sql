-- ONEKEY schema
-- Run this against your Supabase / Postgres instance.

create extension if not exists "pgcrypto";

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    contact text not null unique, -- email or phone, used for magic-link auth
    created_at timestamptz not null default now()
);

create table if not exists things (
    id uuid primary key default gen_random_uuid(),
    onekey_code text not null unique,              -- short public slug, e.g. "8F42K"
    name text not null,
    owner_id uuid not null references users(id),
    status text not null default 'active'
        check (status in ('active', 'transferred', 'archived')),

    identity_type text not null
        check (identity_type in ('serial', 'barcode', 'qr_tag')),

    -- THE CORE FRAUD-PREVENTION CONSTRAINT.
    -- Once a serial/barcode/tag code is bound to a Thing, it can never be
    -- claimed again — enforced by Postgres, not application logic.
    identity_value text not null unique,

    created_at timestamptz not null default now()
);

create index if not exists idx_things_owner on things(owner_id);
create index if not exists idx_things_identity_type on things(identity_type);

create table if not exists photos (
    id uuid primary key default gen_random_uuid(),
    thing_id uuid not null references things(id) on delete cascade,
    url text not null,
    is_primary boolean not null default false,
    phash text not null,          -- perceptual hash, hex string, for similarity checks
    created_at timestamptz not null default now()
);

create index if not exists idx_photos_thing on photos(thing_id);
create index if not exists idx_photos_phash on photos(phash);

create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    thing_id uuid not null references things(id) on delete cascade,
    url text not null,
    label text not null,
    uploaded_at timestamptz not null default now()
);

create table if not exists history_events (
    id uuid primary key default gen_random_uuid(),
    thing_id uuid not null references things(id) on delete cascade,
    type text not null
        check (type in ('created', 'claimed', 'document_added', 'photo_added', 'ownership_transferred')),
    actor_id uuid references users(id),
    detail text,
    created_at timestamptz not null default now()
);

create index if not exists idx_history_thing on history_events(thing_id, created_at);
