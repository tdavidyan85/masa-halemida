-- מסע הלמידה: packs made from photos (phase 1). NOT applied yet - review, then apply to the project.
-- Everything is reached through the `ingest` Edge Function (service role); the site's public key gets no direct access.

create table if not exists public.packs (
  id          text primary key,                         -- long random id, part of the play link
  edit_hash   text not null,                            -- sha-256 of the secret edit token (the token itself is never stored)
  owner_hash  text not null,                            -- sha-256 of the owner's device token, for the monthly page quota only
  status      text not null default 'draft' check (status in ('draft','approved')),
  title       text not null default '',
  json        jsonb,                                    -- masa-pack/1 (null until the model has produced the draft)
  flags       jsonb not null default '{}'::jsonb,       -- e.g. {"namesRemoved": 2}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.packs enable row level security;     -- no policies: only the service role reads or writes

create table if not exists public.ingest_usage (
  owner_hash  text not null,
  month       text not null,                            -- 'YYYY-MM'
  pages       int  not null default 0,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  primary key (owner_hash, month)
);
alter table public.ingest_usage enable row level security;

-- atomic quota check + count: returns the new page count, or -1 when the owner is over the limit
create or replace function public.ingest_take(p_owner text, p_month text, p_limit int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ingest_usage(owner_hash, month, pages) values (p_owner, p_month, 0) on conflict do nothing;
  update ingest_usage set pages = pages + 1 where owner_hash = p_owner and month = p_month and pages < p_limit returning pages into n;
  return coalesce(n, -1);
end $$;

create or replace function public.ingest_add_tokens(p_owner text, p_month text, p_in int, p_out int)
returns void language sql security definer set search_path = public as $$
  update ingest_usage set tokens_in = tokens_in + p_in, tokens_out = tokens_out + p_out where owner_hash = p_owner and month = p_month;
$$;

-- total pages this month across everyone (global cap, like the TTS one)
create or replace function public.ingest_month_pages(p_month text)
returns bigint language sql security definer set search_path = public as $$
  select coalesce(sum(pages), 0) from ingest_usage where month = p_month;
$$;

revoke all on function public.ingest_take(text, text, int), public.ingest_add_tokens(text, text, int, int), public.ingest_month_pages(text) from public, anon, authenticated;

-- no storage bucket: the photo is only held in the function's memory while the model reads it, and is never stored.
