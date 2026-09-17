-- AVENORA — Supabase Database Schema
-- Run this in your Supabase project:
--   Dashboard → SQL Editor → paste and run

-- ─── Videos table ────────────────────────────────────────────────────────────
create table if not exists public.videos (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  description        text,
  uploader_uid       text not null,          -- Firebase UID
  uploader_email     text,
  uploader_name      text,
  is_founder         boolean default false,

  original_file_url  text,
  hls_url            text,
  storage_path       text,                   -- Supabase Storage path
  thumbnail_url      text,
  file_size          bigint default 0,
  mime_type          text default 'video/mp4',

  category           text default 'other',
  visibility         text default 'public',  -- public | unlisted | private
  views              integer default 0,
  like_count         integer default 0,

  is_published       boolean default true,
  is_deleted         boolean default false,
  is_flagged         boolean default false,
  is_featured        boolean default false,
  processing_status  text default 'ready',   -- pending | processing | ready | failed

  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Index for listing videos
create index if not exists videos_visibility_created_idx
  on public.videos (visibility, is_deleted, is_published, created_at desc);

-- Index for uploader lookups
create index if not exists videos_uploader_idx
  on public.videos (uploader_uid, is_deleted);

-- Index for storage path (idempotent save-meta check)
create index if not exists videos_storage_path_idx
  on public.videos (storage_path);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.videos enable row level security;

-- Anyone can read public/unlisted videos
create policy "Public videos are readable by everyone"
  on public.videos for select
  using (visibility in ('public', 'unlisted') and is_deleted = false and is_published = true);

-- Service role (used by Edge Functions) can do everything
-- Edge Functions use service_role key → bypasses RLS automatically

-- ─── Posts table (for moderation counts) ─────────────────────────────────────
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_uid  text not null,
  content     text,
  is_deleted  boolean default false,
  is_flagged  boolean default false,
  created_at  timestamptz default now()
);

alter table public.posts enable row level security;
create policy "Public posts readable by everyone"
  on public.posts for select using (is_deleted = false);

-- ─── User profiles table (for user counts) ───────────────────────────────────
create table if not exists public.user_profiles (
  id           uuid primary key default gen_random_uuid(),
  uid          text unique not null,          -- Firebase UID
  username     text,
  display_name text,
  email        text,
  avatar_url   text,
  role         text default 'user',
  is_suspended boolean default false,
  created_at   timestamptz default now()
);

alter table public.user_profiles enable row level security;
create policy "Profiles readable by everyone"
  on public.user_profiles for select using (true);

-- ─── Auto-update updated_at on videos ────────────────────────────────────────
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger videos_updated_at
  before update on public.videos
  for each row execute function public.update_updated_at();
