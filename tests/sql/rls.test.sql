-- Tests de sécurité : isolation des foyers, rôles, codes d'invitation, reçus.
-- Chaque vérification lève une exception en cas d'échec (psql -v ON_ERROR_STOP=1).
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok — %', label;
end $$;
create or replace function pg_temp.refuse(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok — % (refusé : %)', label, sqlerrm; return;
  end;
  raise exception 'ÉCHEC : % a été accepté', label;
end $$;
create temp table affected (n int);
grant all on affected to public;
grant authenticated to current_user;

-- Données : un administrateur historique, un membre, un deuxième foyer
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test.ma', '{"display_name":"ADMIN Test","foyer_nom":"Foyer A"}', now());
select pg_temp.ok('créer un foyer rend administrateur', (select role from public.profiles where email = 'admin@test.ma') = 'admin');
select set_config('t.codeA', (select code_invitation from public.foyers where nom = 'Foyer A'), false);
insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222222222', 'membre@test.ma', jsonb_build_object('display_name', 'MEMBRE Test', 'foyer_code', lower(current_setting('t.codeA')))),
  ('44444444-4444-4444-4444-444444444444', 'b@test.ma', '{"display_name":"ADMIN B","foyer_nom":"Foyer B","devise":"eur"}'),
  ('66666666-6666-6666-6666-666666666666', 'intrus@test.ma', '{"display_name":"ADMIN Test","foyer_code":"ZZZZZZZZ"}');
select pg_temp.ok('rejoindre avec un code : en attente dans le bon foyer',
  (select role = 'attente' and foyer_id = (select id from public.foyers where nom = 'Foyer A') from public.profiles where email = 'membre@test.ma'));
select pg_temp.ok('devise normalisée', (select devise from public.foyers where nom = 'Foyer B') = 'EUR');
select pg_temp.ok('code inconnu : aucun foyer', (select foyer_id is null and role = 'attente' from public.profiles where email = 'intrus@test.ma'));

-- Visiteur anonyme
set role anon;
select pg_temp.ok('anonyme : vérification d''un code', public.foyer_par_code(current_setting('t.codeA')) = 'Foyer A');
select pg_temp.ok('anonyme : code faux', public.foyer_par_code('00000000') is null);
select pg_temp.refuse('anonyme : lecture des transactions', 'select * from public.transactions');
reset role;

-- Administrateur A
set role authenticated; select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.profiles set role = 'membre' where email = 'membre@test.ma';
insert into public.transactions (id, type, person, amount, payload) values ('a1', 'deposit', 'MEMBRE Test', 100, '{}');
insert into public.settings (key, value) values ('target', '{"amount":1000}'), ('budgets', '{"courses":300}');
insert into storage.objects (bucket_id, name) values ('recus', public.my_foyer()::text || '/a.jpg');
select pg_temp.ok('admin A : valide un membre', (select role from public.profiles where email = 'membre@test.ma') = 'membre');
select pg_temp.ok('admin A : ne voit pas l''intrus sans foyer', (select count(*) from public.profiles where email = 'intrus@test.ma') = 0);
select pg_temp.ok('admin A : nouveau code', length(public.regenerer_code_invitation()) = 8);
reset role;

-- Administrateur B : isolation complète
set role authenticated; select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select pg_temp.ok('admin B : ne voit aucune transaction de A', (select count(*) from public.transactions) = 0);
select pg_temp.ok('admin B : ne voit aucun paramètre de A', (select count(*) from public.settings) = 0);
select pg_temp.ok('admin B : ne voit que son foyer', (select string_agg(nom, ',') from public.foyers) = 'Foyer B');
select pg_temp.ok('admin B : ne voit aucun reçu de A', (select count(*) from storage.objects) = 0);
select pg_temp.refuse('admin B : écrire dans le foyer A',
  $$insert into public.transactions (id, type, person, amount, payload, foyer_id) values ('b1', 'deposit', 'ADMIN B', 1, '{}', (select id from public.foyers where nom = 'Foyer A' union all select null limit 1))$$);
select pg_temp.refuse('admin B : déposer un reçu chez A', $$insert into storage.objects (bucket_id, name) values ('recus', '00000000-0000-0000-0000-000000000000/x.jpg')$$);
with u as (update public.profiles set role = 'admin' where email = 'membre@test.ma' returning 1) insert into affected select count(*) from u;
select pg_temp.ok('admin B : ne peut pas modifier un membre de A', (select sum(n) from affected) = 0);
truncate affected;
insert into public.settings (key, value) values ('target', '{"amount":50}');
select pg_temp.ok('admin B : son propre objectif coexiste avec celui de A', (select count(*) from public.settings) = 1);
reset role;
select pg_temp.ok('le membre de A est toujours membre', (select role from public.profiles where email = 'membre@test.ma') = 'membre');
select pg_temp.ok('deux objectifs distincts (clé foyer + paramètre)', (select count(*) from public.settings where key = 'target') = 2);

-- Membre de A
set role authenticated; select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select pg_temp.ok('membre : voit les transactions de son foyer', (select count(*) from public.transactions) = 1);
insert into public.transactions (id, type, person, amount, payload) values ('m1', 'deposit', 'MEMBRE Test', 50, '{}');
select pg_temp.refuse('membre : saisir au nom d''un autre', $$insert into public.transactions (id, type, person, amount, payload) values ('m2', 'deposit', 'ADMIN Test', 50, '{}')$$);
select pg_temp.refuse('membre : nouveau code d''invitation', 'select public.regenerer_code_invitation()');
with u as (update public.foyers set devise = 'USD' returning 1) insert into affected select count(*) from u;
select pg_temp.ok('membre : ne change pas la devise', (select sum(n) from affected) = 0 and (select devise from public.foyers) = 'MAD');
truncate affected;
with u as (delete from public.transactions returning 1) insert into affected select count(*) from u;
select pg_temp.ok('membre : ne supprime rien', (select sum(n) from affected) = 0 and (select count(*) from public.transactions) = 2);
truncate affected;
with u as (update public.profiles set role = 'admin' where id = auth.uid() returning 1) insert into affected select count(*) from u;
select pg_temp.ok('membre : ne se promeut pas', (select sum(n) from affected) = 0 and public.my_role() = 'membre');
truncate affected;
select pg_temp.ok('membre : lit les reçus du foyer', (select count(*) from storage.objects) = 1);
select pg_temp.ok('membre : pas d''accès au journal d''audit', (select count(*) from public.audit_log) = 0);
reset role;

-- Compte sans foyer
set role authenticated; select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select pg_temp.ok('sans foyer : ne voit rien', (select count(*) from public.transactions) = 0 and (select count(*) from public.foyers) = 0);
select pg_temp.refuse('sans foyer : ne peut rien écrire', $$insert into public.transactions (id, type, person, amount, payload) values ('x1', 'deposit', 'ADMIN Test', 1, '{}')$$);
reset role;

select pg_temp.ok('journal d''audit rattaché aux foyers', (select bool_and(foyer_id is not null) from public.audit_log));
\echo 'Tous les tests de sécurité sont passés.'
