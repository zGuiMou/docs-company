-- Execute this once in Supabase: SQL Editor > New query > Run.
-- The site server stores active sessions and a private legacy archive in one
-- JSONB record. The archive is not exposed through public API routes.
create table if not exists public.docs_company_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.docs_company_state enable row level security;

-- No public policies are intentionally created. The Render server accesses this
-- table using the SUPABASE_SERVICE_ROLE_KEY, which must remain server-side.
