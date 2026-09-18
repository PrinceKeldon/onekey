-- ONEKEY schema
create extension if not exists "pgcrypto";

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    contact text not null unique,
    created_at timestamptz not null default now()
);

create table if not exists things (
    id uuid primary key default gen_random_uuid(),
    onekey_code text not null unique,
    name text not null,
    owner_id uuid not null references users(id),
    status text not null default 'active' check (status in ('active', 'transferred', 'archived')),
    identity_type text not null check (identity_type in ('serial', 'barcode', 'qr_tag')),
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
    phash text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_photos_thing on photos(thing_id);
create index if not exists idx_photos_phash on photos(phash);

create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    thing_id uuid not null references things(id) on delete cascade,
    url text,
    body text,
    label text not null,
    uploaded_at timestamptz not null default now(),
    constraint ck_document_has_content check (url is not null or body is not null)
);

create table if not exists history_events (
    id uuid primary key default gen_random_uuid(),
    thing_id uuid not null references things(id) on delete cascade,
    type text not null check (type in ('created', 'claimed', 'document_added', 'photo_added', 'ownership_transferred')),
    actor_id uuid references users(id),
    detail text,
    created_at timestamptz not null default now()
);

create index if not exists idx_history_thing on history_events(thing_id, created_at);

insert into storage.buckets (id, name, public)
values ('onekey-media', 'onekey-media', true)
on conflict (id) do update set public = true;
