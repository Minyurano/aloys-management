-- =====================================================================
-- ALOYS MANAGEMENT — base de données Supabase
-- À coller dans Supabase > SQL Editor, puis cliquer sur "Run".
-- Peut être relancé sans risque (idempotent).
-- =====================================================================

-- ---------- 1. Profils et rôles ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null,
  role         text not null default 'attente' check (role in ('admin','membre','lecture','attente')),
  created_at   timestamptz not null default now()
);

-- Rôle de l'utilisateur connecté (security definer : évite la récursion des règles RLS)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select display_name from public.profiles where id = auth.uid()
$$;

-- Création automatique du profil à l'inscription.
-- Tout nouveau compte est "en attente" : il n'a accès à rien tant que l'administrateur ne l'a pas validé.
-- L'adresse de l'administrateur devient "admin" dès que son e-mail est confirmé.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)),
    case when lower(new.email) = lower('__ADMIN_EMAIL__') and new.email_confirmed_at is not null
         then 'admin' else 'attente' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
     and lower(new.email) = lower('__ADMIN_EMAIL__') then
    update public.profiles set role = 'admin' where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- ---------- 2. Données du registre ----------
create table if not exists public.transactions (
  id         text primary key,
  type       text not null check (type in ('deposit','consumption')),
  person     text not null,
  amount     numeric(14,2) not null check (amount > 0),
  payload    jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.factures (
  id         text primary key,
  nom        text not null,
  montant    numeric(14,2) not null check (montant > 0),
  payload    jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key        text primary key,
  value      jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ---------- 3. Journal d'audit ----------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  user_name  text,
  action     text not null,
  table_name text not null,
  row_id     text,
  details    jsonb
);

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (user_id, user_name, action, table_name, row_id, details)
  values (auth.uid(), public.my_name(), tg_op, tg_table_name,
          coalesce(rec->>'id', rec->>'key'),
          case when tg_op = 'UPDATE' then jsonb_build_object('avant', to_jsonb(old), 'apres', to_jsonb(new)) else rec end);
  return null;
end $$;

drop trigger if exists audit_transactions on public.transactions;
create trigger audit_transactions after insert or update or delete on public.transactions
  for each row execute function public.audit_trigger();
drop trigger if exists audit_factures on public.factures;
create trigger audit_factures after insert or update or delete on public.factures
  for each row execute function public.audit_trigger();
drop trigger if exists audit_settings on public.settings;
create trigger audit_settings after insert or update or delete on public.settings
  for each row execute function public.audit_trigger();
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update or delete on public.profiles
  for each row execute function public.audit_trigger();

-- ---------- 4. Sécurité : Row Level Security ----------
alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;
alter table public.factures     enable row level security;
alter table public.settings     enable row level security;
alter table public.audit_log    enable row level security;

-- Profils : chacun voit son propre profil ; les membres validés voient toute la liste ;
-- seul l'admin change les rôles et les noms
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() in ('admin','membre','lecture'));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.my_role() = 'admin' and id <> auth.uid());

-- Transactions : lecture pour tous les comptes ; ajout par admin (tout nom) ou membre (son nom) ; suppression admin
drop policy if exists tx_select on public.transactions;
create policy tx_select on public.transactions for select to authenticated
  using (public.my_role() in ('admin','membre','lecture'));
drop policy if exists tx_insert on public.transactions;
create policy tx_insert on public.transactions for insert to authenticated
  with check (
    created_by = auth.uid() and (
      public.my_role() = 'admin'
      or (public.my_role() = 'membre' and person = public.my_name())
    )
  );
drop policy if exists tx_delete on public.transactions;
create policy tx_delete on public.transactions for delete to authenticated
  using (public.my_role() = 'admin');

-- Factures : mêmes règles
drop policy if exists fac_select on public.factures;
create policy fac_select on public.factures for select to authenticated
  using (public.my_role() in ('admin','membre','lecture'));
drop policy if exists fac_insert on public.factures;
create policy fac_insert on public.factures for insert to authenticated
  with check (
    created_by = auth.uid() and (
      public.my_role() = 'admin'
      or (public.my_role() = 'membre' and nom = public.my_name())
    )
  );
drop policy if exists fac_delete on public.factures;
create policy fac_delete on public.factures for delete to authenticated
  using (public.my_role() = 'admin');

-- Paramètres (objectif d'épargne) : lecture pour tous, écriture admin
drop policy if exists set_select on public.settings;
create policy set_select on public.settings for select to authenticated
  using (public.my_role() in ('admin','membre','lecture'));
drop policy if exists set_write on public.settings;
create policy set_write on public.settings for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Journal d'audit : lecture admin uniquement (écrit seulement par les déclencheurs)
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.my_role() = 'admin');

-- Droits d'accès de l'API (aucun accès pour les visiteurs non connectés)
revoke all on public.profiles, public.transactions, public.factures, public.settings, public.audit_log from anon;
grant select, update, delete on public.profiles to authenticated;
grant select, insert, delete on public.transactions, public.factures to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant select on public.audit_log to authenticated;

-- ---------- 5. Temps réel ----------
do $$
declare t text;
begin
  foreach t in array array['transactions','factures','settings','profiles'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
