-- Execute this once in Supabase: SQL Editor > New query > Run.
-- The site server stores active sessions and a private legacy archive in one
-- JSONB record. The archive is not exposed through public API routes.
create table if not exists public.docs_company_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.minecraft_console_events (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null,
  event_type text not null check (event_type in ('console', 'player_chat', 'player_command')),
  player text,
  message text not null
);

create index if not exists minecraft_console_events_timestamp_idx
  on public.minecraft_console_events (timestamp desc);

alter table public.docs_company_state enable row level security;
alter table public.minecraft_console_events enable row level security;

-- No public policies are intentionally created. The Render server accesses this
-- data using the SUPABASE_SERVICE_ROLE_KEY, which must remain server-side.
