-- =====================================================================
-- ALOYS MANAGEMENT — base de données Supabase (version 4 : plusieurs foyers)
-- À coller dans Supabase > SQL Editor, puis cliquer sur "Run".
-- Idempotent : peut être relancé sans risque. Met aussi à jour une
-- installation existante (les données actuelles rejoignent un premier foyer).
-- =====================================================================

-- ---------- 1. Foyers (chaque colocation a ses propres données) ----------
create table if not exists public.foyers (
  id              uuid primary key default gen_random_uuid(),
  nom             text not null check (char_length(nom) between 2 and 80),
  devise          text not null default 'MAD' check (devise in ('MAD','EUR','USD','BIF','MRU','XOF','CAD')),
  code_invitation text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  created_at      timestamptz not null default now()
);

-- ---------- 2. Profils et rôles ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null,
  role         text not null default 'attente' check (role in ('admin','membre','lecture','attente')),
  created_at   timestamptz not null default now()
);
alter table public.profiles add column if not exists foyer_id uuid references public.foyers(id) on delete set null;

-- Fonctions de contexte (security definer : évite la récursion des règles RLS)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select display_name from public.profiles where id = auth.uid()
$$;
create or replace function public.my_foyer() returns uuid
language sql stable security definer set search_path = public as $$
  select foyer_id from public.profiles where id = auth.uid()
$$;

-- ---------- 3. Données du registre ----------
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
  key        text not null,
  value      jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
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
alter table public.transactions add column if not exists foyer_id uuid references public.foyers(id) on delete cascade;
alter table public.factures     add column if not exists foyer_id uuid references public.foyers(id) on delete cascade;
alter table public.settings     add column if not exists foyer_id uuid references public.foyers(id) on delete cascade;
alter table public.audit_log    add column if not exists foyer_id uuid references public.foyers(id) on delete cascade;

-- ---------- 4. Migration : les données existantes rejoignent un premier foyer ----------
do $$
declare f uuid;
begin
  if not exists (select 1 from public.foyers)
     and (exists (select 1 from public.profiles) or exists (select 1 from public.transactions)) then
    insert into public.foyers (nom, devise) values ('Foyer ALOYS', 'MAD') returning id into f;
    update public.profiles     set foyer_id = f where foyer_id is null;
    update public.transactions set foyer_id = f where foyer_id is null;
    update public.factures     set foyer_id = f where foyer_id is null;
    update public.settings     set foyer_id = f where foyer_id is null;
    update public.audit_log    set foyer_id = f where foyer_id is null;
  end if;
end $$;

alter table public.transactions alter column foyer_id set default public.my_foyer();
alter table public.factures     alter column foyer_id set default public.my_foyer();
alter table public.settings     alter column foyer_id set default public.my_foyer();
alter table public.transactions alter column foyer_id set not null;
alter table public.factures     alter column foyer_id set not null;
alter table public.settings     alter column foyer_id set not null;

-- Clé des paramètres : (foyer, clé) — chaque foyer a son objectif, ses budgets, son seuil d'alerte
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'settings_pkey' and conrelid = 'public.settings'::regclass
             and array_length(conkey, 1) = 1) then
    alter table public.settings drop constraint settings_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_pkey' and conrelid = 'public.settings'::regclass) then
    alter table public.settings add constraint settings_pkey primary key (foyer_id, key);
  end if;
end $$;

create index if not exists transactions_foyer_idx on public.transactions (foyer_id, created_at);
create index if not exists factures_foyer_idx     on public.factures (foyer_id, created_at);
create index if not exists audit_foyer_idx        on public.audit_log (foyer_id, id desc);
create index if not exists profiles_foyer_idx     on public.profiles (foyer_id);

-- ---------- 5. Inscription : créer un foyer (administrateur) ou en rejoindre un (en attente) ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fnom  text  := nullif(trim(meta->>'foyer_nom'), '');
  fcode text  := upper(nullif(trim(meta->>'foyer_code'), ''));
  fdev  text  := upper(coalesce(nullif(trim(meta->>'devise'), ''), 'MAD'));
  f     uuid;
  r     text  := 'attente';
begin
  if fnom is not null then
    if fdev not in ('MAD','EUR','USD','BIF','MRU','XOF','CAD') then fdev := 'MAD'; end if;
    insert into public.foyers (nom, devise) values (left(fnom, 80), fdev) returning id into f;
    r := 'admin';
  elsif fcode is not null then
    select id into f from public.foyers where code_invitation = fcode;
  end if;
  -- Administrateur historique : son adresse confirmée garde le rôle admin du premier foyer
  if lower(new.email) = lower('__ADMIN_EMAIL__') and new.email_confirmed_at is not null then
    r := 'admin';
    if f is null then select id into f from public.foyers order by created_at limit 1; end if;
  end if;
  insert into public.profiles (id, email, display_name, role, foyer_id)
  values (new.id, new.email,
          coalesce(nullif(trim(meta->>'display_name'), ''), split_part(new.email, '@', 1)),
          r, f)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null
     and lower(new.email) = lower('__ADMIN_EMAIL__') then
    update public.profiles
       set role = 'admin',
           foyer_id = coalesce(foyer_id, (select id from public.foyers order by created_at limit 1))
     where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- Vérifier un code d'invitation avant l'inscription (renvoie seulement le nom du foyer)
create or replace function public.foyer_par_code(code text) returns text
language sql stable security definer set search_path = public as $$
  select nom from public.foyers where code_invitation = upper(trim(code))
$$;

-- Nouveau code d'invitation (administrateur du foyer)
create or replace function public.regenerer_code_invitation() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Réservé à l''administrateur'; end if;
  update public.foyers set code_invitation = upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
   where id = public.my_foyer() returning code_invitation into c;
  return c;
end $$;

-- ---------- 6. Journal d'audit ----------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (user_id, user_name, action, table_name, row_id, details, foyer_id)
  values (auth.uid(), public.my_name(), tg_op, tg_table_name,
          coalesce(rec->>'id', rec->>'key'),
          case when tg_op = 'UPDATE' then jsonb_build_object('avant', to_jsonb(old), 'apres', to_jsonb(new)) else rec end,
          coalesce(nullif(rec->>'foyer_id', '')::uuid, public.my_foyer()));
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

-- ---------- 7. Sécurité : chaque foyer ne voit que ses propres données ----------
alter table public.foyers       enable row level security;
alter table public.profiles     enable row level security;
alter table public.transactions enable row level security;
alter table public.factures     enable row level security;
alter table public.settings     enable row level security;
alter table public.audit_log    enable row level security;

drop policy if exists foyers_select on public.foyers;
create policy foyers_select on public.foyers for select to authenticated
  using (id = public.my_foyer());
drop policy if exists foyers_admin_update on public.foyers;
create policy foyers_admin_update on public.foyers for update to authenticated
  using (id = public.my_foyer() and public.my_role() = 'admin')
  with check (id = public.my_foyer() and public.my_role() = 'admin');

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (foyer_id = public.my_foyer() and public.my_role() in ('admin','membre','lecture')));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin' and foyer_id = public.my_foyer())
  with check (public.my_role() = 'admin' and foyer_id = public.my_foyer());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.my_role() = 'admin' and foyer_id = public.my_foyer() and id <> auth.uid());

drop policy if exists tx_select on public.transactions;
create policy tx_select on public.transactions for select to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() in ('admin','membre','lecture'));
drop policy if exists tx_insert on public.transactions;
create policy tx_insert on public.transactions for insert to authenticated
  with check (
    foyer_id = public.my_foyer() and created_by = auth.uid() and (
      public.my_role() = 'admin'
      or (public.my_role() = 'membre' and person = public.my_name())
    )
  );
drop policy if exists tx_delete on public.transactions;
create policy tx_delete on public.transactions for delete to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() = 'admin');

drop policy if exists fac_select on public.factures;
create policy fac_select on public.factures for select to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() in ('admin','membre','lecture'));
drop policy if exists fac_insert on public.factures;
create policy fac_insert on public.factures for insert to authenticated
  with check (
    foyer_id = public.my_foyer() and created_by = auth.uid() and (
      public.my_role() = 'admin'
      or (public.my_role() = 'membre' and nom = public.my_name())
    )
  );
drop policy if exists fac_delete on public.factures;
create policy fac_delete on public.factures for delete to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() = 'admin');

drop policy if exists set_select on public.settings;
create policy set_select on public.settings for select to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() in ('admin','membre','lecture'));
drop policy if exists set_write on public.settings;
create policy set_write on public.settings for all to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() = 'admin')
  with check (foyer_id = public.my_foyer() and public.my_role() = 'admin');

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (foyer_id = public.my_foyer() and public.my_role() = 'admin');

-- Droits de l'API (aucun accès pour les visiteurs non connectés, sauf la vérification d'un code)
revoke all on public.foyers, public.profiles, public.transactions, public.factures, public.settings, public.audit_log from anon;
grant select, update on public.foyers to authenticated;
grant select, update, delete on public.profiles to authenticated;
grant select, insert, delete on public.transactions, public.factures to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant select on public.audit_log to authenticated;
revoke all on function public.foyer_par_code(text) from public;
grant execute on function public.foyer_par_code(text) to anon, authenticated;
revoke all on function public.regenerer_code_invitation() from public, anon;
grant execute on function public.regenerer_code_invitation() to authenticated;

-- ---------- 8. Temps réel ----------
do $$
declare t text;
begin
  foreach t in array array['transactions','factures','settings','profiles','foyers'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- 9. Reçus (photos des tickets), stockage privé par foyer ----------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('recus', 'recus', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
    on conflict (id) do nothing;

    drop policy if exists recus_select on storage.objects;
    create policy recus_select on storage.objects for select to authenticated
      using (bucket_id = 'recus' and (storage.foldername(name))[1] = public.my_foyer()::text
             and public.my_role() in ('admin','membre','lecture'));
    drop policy if exists recus_insert on storage.objects;
    create policy recus_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'recus' and (storage.foldername(name))[1] = public.my_foyer()::text
                  and public.my_role() in ('admin','membre'));
    drop policy if exists recus_delete on storage.objects;
    create policy recus_delete on storage.objects for delete to authenticated
      using (bucket_id = 'recus' and (storage.foldername(name))[1] = public.my_foyer()::text
             and public.my_role() = 'admin');
  end if;
end $$;
