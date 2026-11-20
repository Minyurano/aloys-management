-- État d'une installation version 2 (avant les foyers) pour tester la migration
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null, display_name text not null,
  role text not null default 'attente', created_at timestamptz not null default now());
create table public.transactions (id text primary key, type text not null, person text not null, amount numeric(14,2) not null,
  payload jsonb not null, created_by uuid default auth.uid(), created_at timestamptz not null default now());
create table public.factures (id text primary key, nom text not null, montant numeric(14,2) not null, payload jsonb not null,
  created_by uuid default auth.uid(), created_at timestamptz not null default now());
create table public.settings (key text primary key, value jsonb, updated_by uuid, updated_at timestamptz not null default now());
create table public.audit_log (id bigint generated always as identity primary key, at timestamptz not null default now(), user_id uuid,
  user_name text, action text not null, table_name text not null, row_id text, details jsonb);
insert into auth.users (id, email, email_confirmed_at) values ('99999999-9999-9999-9999-999999999999', 'ancien@test.ma', now());
insert into public.profiles (id, email, display_name, role) values ('99999999-9999-9999-9999-999999999999', 'ancien@test.ma', 'ANCIEN Admin', 'admin');
insert into public.transactions (id, type, person, amount, payload) values ('old1', 'deposit', 'ANCIEN Admin', 540, '{}');
insert into public.settings (key, value) values ('target', '{"amount":1000}');
