\set ON_ERROR_STOP 1
do $$ begin
  if (select count(*) from public.foyers) <> 1 then raise exception 'ÉCHEC : un foyer doit être créé pour les données existantes'; end if;
  if exists (select 1 from public.transactions where foyer_id is null) then raise exception 'ÉCHEC : transaction sans foyer'; end if;
  if exists (select 1 from public.profiles where foyer_id is null) then raise exception 'ÉCHEC : profil sans foyer'; end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'settings_pkey') <> 'PRIMARY KEY (foyer_id, key)' then
    raise exception 'ÉCHEC : clé des paramètres non migrée'; end if;
  if (select role from public.profiles where email = 'ancien@test.ma') <> 'admin' then raise exception 'ÉCHEC : rôle perdu'; end if;
  raise notice 'ok — migration depuis la version 2';
end $$;
