-- ============================================================
-- Testsuite for NOTATER (docs/notater-plan.md): tabellene
-- `public.note_projects`, `public.note_folders` og `public.notes`.
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Notatene deles ikke: `owner_id = auth.uid()` ER hele autorisasjonen, som
-- for idéene. De tre tabellene har i tillegg FORELDRE-PEKERE, og nettopp der
-- ligger risikoen ingen av de andre testene dekker: en rad må ikke kunne
-- hektes inn i et prosjekt eller en mappe som tilhører noen andre.
--
-- To brukere:
--   A = eier notatene
--   B = en helt annen konto, som verken skal se eller kunne skrive på dem
-- ============================================================

\set ON_ERROR_STOP on
reset role;

create or replace function public.t_check(name text, cond boolean)
returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', name; end if;
  return 'PASS: ' || name;
end $$;
create or replace function public.t_fails(name text, cmd text)
returns text language plpgsql as $$
begin
  begin execute cmd; exception when others then
    return 'PASS (blokkert): ' || name || ' — ' || sqlerrm; end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;
create or replace function public.t_fails_with(name text, code text, cmd text)
returns text language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlstate is distinct from code then
      raise exception 'FAIL (feil SQLSTATE for %): fikk % (%), ventet %', name, sqlstate, sqlerrm, code;
    end if;
    return 'PASS (blokkert med ' || code || '): ' || name;
  end;
  raise exception 'FAIL (skulle vært blokkert): %', name;
end $$;
grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;
grant execute on function public.t_fails_with(text, text, text) to public;

\set A  'aaaa1111-0000-0000-0000-0000000daa11'
\set B  'bbbb2222-0000-0000-0000-0000000dbb22'
-- P  = prosjekt (A), F = mappe i P, N1 = notat i mappen, N2 = fritt notat,
-- N3 = notat som slettes permanent, BP = B sitt eget prosjekt.
-- (`\set` tar HELE resten av linjen, kommentaren inkludert — derfor står de her.)
\set P  '6b000000-dddd-0000-0000-000000000001'
\set F  '6b000000-dddd-0000-0000-000000000002'
\set N1 '6b000000-dddd-0000-0000-000000000003'
\set N2 '6b000000-dddd-0000-0000-000000000004'
\set N3 '6b000000-dddd-0000-0000-000000000005'
\set BP '6b000000-dddd-0000-0000-000000000006'
\set BN '6b000000-dddd-0000-0000-000000000007'

insert into auth.users (id, email) values
  (:'A', 'notat-a@example.com'), (:'B', 'notat-b@example.com')
on conflict (id) do nothing;

-- ---------- 1. A bygger Prosjekt > Mappe > Notat ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'P', :'A', 'Forskning', 1, 'a', 1, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'F', :'A', :'P', 'Metode', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, body, ts, org, pos, pos_ts, pos_org)
  values (:'N1', :'A', :'P', :'F', 'Utvalg',
          '{"v":1,"blocks":[{"t":"p","c":[{"s":"Femti deltakere"}]}]}'::jsonb, 1, 'a', 1, 1, 'a');
-- Et FRITT notat ligger rett i prosjektet: `folder_id` er null.
insert into public.notes (id, owner_id, project_id, title, body, ts, org, pos, pos_ts, pos_org)
  values (:'N2', :'A', :'P', 'Løse tanker',
          '{"v":1,"blocks":[{"t":"p","c":[{"s":"Sjekk kilden"}]}]}'::jsonb, 1, 'a', 2, 1, 'a');
select public.t_check('A ser prosjektet, mappen og begge notatene',
  (select count(*) from public.note_projects) = 1
  and (select count(*) from public.note_folders) = 1
  and (select count(*) from public.notes) = 2);
select public.t_check('et fritt notat har ingen mappe, men alltid et prosjekt',
  (select folder_id from public.notes where id = :'N2') is null
  and (select project_id from public.notes where id = :'N2') = :'P'::uuid);

-- ---------- 2. B ser ingenting og kan ikke røre noe ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B ser ingen av A sine notatrader',
  (select count(*) from public.note_projects) = 0
  and (select count(*) from public.note_folders) = 0
  and (select count(*) from public.notes) = 0);
-- RLS gjør en fremmed rad usynlig: UPDATE/DELETE treffer null rader i stedet
-- for å kaste. Beviset er at radene står uendret etterpå.
update public.notes set title = 'kapret', ts = 99, org = 'b' where id = :'N1';
delete from public.notes where id = :'N1';
delete from public.note_projects where id = :'P';
select public.t_fails('B kan ikke sette inn et prosjekt i A sitt navn',
  format('insert into public.note_projects (id, owner_id, name, ts, org) values (%L, %L, ''snik'', 9, ''b'')',
         '6b000000-dddd-0000-0000-0000000000ff', :'A'));

-- DEN FARLIGE: B har sitt EGET prosjekt, men prøver å hekte en mappe og et
-- notat inn i A SITT prosjekt. Uten forelder-vilkåret i policyen ville raden
-- vært B sin (og dermed usynlig for A), men fremmednøkkelen ville bundet den
-- til A sitt prosjekt.
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'BP', :'B', 'B sitt prosjekt', 1, 'b', 1, 1, 'b');
select public.t_fails('B kan ikke legge en mappe i A sitt prosjekt',
  format('insert into public.note_folders (id, owner_id, project_id, name, ts, org) values (%L, %L, %L, ''snik'', 9, ''b'')',
         '6b000000-dddd-0000-0000-0000000000fe', :'B', :'P'));
select public.t_fails('B kan ikke legge et notat i A sitt prosjekt',
  format('insert into public.notes (id, owner_id, project_id, title, ts, org) values (%L, %L, %L, ''snik'', 9, ''b'')',
         '6b000000-dddd-0000-0000-0000000000fd', :'B', :'P'));
select public.t_fails('B kan ikke legge et notat i A sin mappe',
  format('insert into public.notes (id, owner_id, project_id, folder_id, title, ts, org) values (%L, %L, %L, %L, ''snik'', 9, ''b'')',
         '6b000000-dddd-0000-0000-0000000000fc', :'B', :'BP', :'F'));
-- B sitt eget notat i sitt eget prosjekt går derimot fint.
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'BN', :'B', :'BP', 'B sitt notat', 1, 'b', 1, 1, 'b');
select public.t_check('B ser kun sitt eget prosjekt og notat',
  (select count(*) from public.note_projects) = 1
  and (select count(*) from public.notes) = 1);
-- … og kan ikke FLYTTE det inn i A sitt prosjekt etterpå heller.
select public.t_fails('B kan ikke flytte sitt notat inn i A sitt prosjekt',
  format('update public.notes set project_id = %L, pos_ts = 500, pos_org = ''b'' where id = %L', :'P', :'BN'));

reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A sitt notat er urørt etter B sine forsøk',
  (select title from public.notes where id = :'N1') = 'Utvalg'
  and (select count(*) from public.notes where id = :'N1') = 1);
select public.t_check('A ser ikke B sine rader',
  (select count(*) from public.note_projects where id = :'BP') = 0
  and (select count(*) from public.notes where id = :'BN') = 0);

-- ---------- 3. get_my_doc() leverer KUN mine notater ----------
select public.t_check('get_my_doc() gir A sitt prosjekt, mappen og de to notatene',
  jsonb_array_length(public.get_my_doc() -> 'noteProjects') = 1
  and jsonb_array_length(public.get_my_doc() -> 'noteFolders') = 1
  and jsonb_array_length(public.get_my_doc() -> 'notes') = 2);
select public.t_check('doc-et bærer forelder-pekerne og selve dokumentet',
  (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'notes') e
    where e ->> 'folder' = :'F') = 1
  and (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'notes') e
    where e ->> 'folder' is null) = 1
  and (select e -> 'body' -> 'blocks' -> 0 ->> 't'
       from jsonb_array_elements(public.get_my_doc() -> 'notes') e
       where e ->> 'id' = :'N1') = 'p');
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('get_my_doc() for B gir bare B sine egne rader',
  jsonb_array_length(public.get_my_doc() -> 'noteProjects') = 1
  and jsonb_array_length(public.get_my_doc() -> 'noteFolders') = 0
  and jsonb_array_length(public.get_my_doc() -> 'notes') = 1);

-- ---------- 4. Felt-nivå-LWW: en eldre skriving taper ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.notes set title = 'Utvalg og rekruttering',
       body = '{"v":1,"blocks":[{"t":"h1","c":[{"s":"Utvalg"}]}]}'::jsonb, ts = 50, org = 'a'
 where id = :'N1';
select public.t_check('en NYERE innholdsskriving lander (tittel OG dokument)',
  (select title from public.notes where id = :'N1') = 'Utvalg og rekruttering'
  and (select body -> 'blocks' -> 0 ->> 't' from public.notes where id = :'N1') = 'h1');
update public.notes set title = 'gammel enhet',
       body = '{"v":1,"blocks":[]}'::jsonb, ts = 20, org = 'a' where id = :'N1';
select public.t_check('en ELDRE innholdsskriving rulles tilbake av vakten',
  (select title from public.notes where id = :'N1') = 'Utvalg og rekruttering'
  and (select jsonb_array_length(body -> 'blocks') from public.notes where id = :'N1') = 1
  and (select ts from public.notes where id = :'N1') = 50);
-- Posisjonsregisteret er sitt eget: begge forelder-pekerne rir på det.
update public.notes set folder_id = null, pos = 9, pos_ts = 60, pos_org = 'a' where id = :'N1';
select public.t_check('en NYERE posisjonsskriving gjør notatet fritt',
  (select folder_id from public.notes where id = :'N1') is null
  and (select pos from public.notes where id = :'N1') = 9);
update public.notes set folder_id = :'F', pos = 1, pos_ts = 30, pos_org = 'a' where id = :'N1';
select public.t_check('en ELDRE posisjonsskriving rulles tilbake',
  (select folder_id from public.notes where id = :'N1') is null
  and (select pos from public.notes where id = :'N1') = 9);
-- Registrene er UAVHENGIGE: en fersk tekstskriving skal ikke dra med seg en
-- foreldet plassering.
update public.notes set title = 'Utvalget', ts = 70, org = 'a',
       folder_id = :'F', pos = 0, pos_ts = 1, pos_org = 'a' where id = :'N1';
select public.t_check('innholdet lander mens den foreldede plasseringen forkastes',
  (select title from public.notes where id = :'N1') = 'Utvalget'
  and (select folder_id from public.notes where id = :'N1') is null);
-- Prosjektet og mappen har den samme vakten.
update public.note_projects set name = 'Forskningsprosjekt', ts = 40, org = 'a' where id = :'P';
update public.note_projects set name = 'gammel', ts = 10, org = 'a' where id = :'P';
select public.t_check('prosjektnavnet forsvares av innholdsregisteret',
  (select name from public.note_projects where id = :'P') = 'Forskningsprosjekt');
update public.note_folders set name = 'Metodekapittel', ts = 40, org = 'a' where id = :'F';
update public.note_folders set name = 'gammel', ts = 10, org = 'a' where id = :'F';
select public.t_check('mappenavnet forsvares av innholdsregisteret',
  (select name from public.note_folders where id = :'F') = 'Metodekapittel');

-- ---------- 5. Oppretteren er uforanderlig ----------
select public.t_fails('owner_id kan ikke endres på et notat',
  format('update public.notes set owner_id = %L where id = %L', :'B', :'N1'));
select public.t_fails('owner_id kan ikke endres på et notatprosjekt',
  format('update public.note_projects set owner_id = %L where id = %L', :'B', :'P'));

-- ---------- 6. En slettet mappe tar ALDRI notatene med seg ----------
-- `folder_id` er `on delete set null`, ikke cascade: notatene i en slettet
-- mappe skal bli FRIE notater i prosjektet, ikke forsvinne. (Skrivevakten
-- forsvarer posisjonsregisteret mot en oppdatering uten nyere stempel, så
-- pekeren kan bli hengende — klienten leser en mappe som ikke finnes som
-- «fritt notat» og nuller pekeren ved neste stemplede skriving, nøyaktig som
-- for `items.cat_id`.)
update public.notes set folder_id = :'F', pos_ts = 200, pos_org = 'a' where id = :'N1';
select public.t_check('notatet ligger i mappen igjen', 
  (select folder_id from public.notes where id = :'N1') = :'F'::uuid);
delete from public.note_folders where id = :'F';
select public.t_check('mappen er borte',
  (select count(*) from public.note_folders where id = :'F') = 0);
select public.t_check('notatene står igjen (ingen kaskade fra mappen)',
  (select count(*) from public.notes where id in (:'N1', :'N2')) = 2);
update public.notes set folder_id = null, pos_ts = 300, pos_org = 'a' where id = :'N1';
select public.t_check('en stemplet skriving nuller den hengende mappepekeren',
  (select folder_id from public.notes where id = :'N1') is null);

-- ---------- 7. Et slettet PROSJEKT tar innholdet sitt med seg ----------
-- Et notat uten prosjekt finnes ikke (kolonnen er `not null`), så her ER
-- kaskade riktig — og hver kaskaderte rad får sin egen gravstein.
insert into public.note_projects (id, owner_id, name, ts, org) values
  ('6b000000-dddd-0000-0000-00000000000a', :'A', 'Kortlevd prosjekt', 1, 'a');
insert into public.notes (id, owner_id, project_id, title, ts, org) values
  (:'N3', :'A', '6b000000-dddd-0000-0000-00000000000a', 'Kortlevd notat', 1, 'a');
delete from public.note_projects where id = '6b000000-dddd-0000-0000-00000000000a';
select public.t_check('notatet under prosjektet fulgte med',
  (select count(*) from public.notes where id = :'N3') = 0);

-- ---------- 8. Gravstein + insert-vakt ----------
select public.t_check('slettingen skrev gravsteiner av typene «note_folder» og «note»',
  (select count(*) from public.tombstones where resource_type = 'note_folder' and resource_id = :'F') = 1
  and (select count(*) from public.tombstones where resource_type = 'note' and resource_id = :'N3') = 1
  and (select count(*) from public.tombstones where resource_type = 'note_project'
        and resource_id = '6b000000-dddd-0000-0000-00000000000a') = 1);
select public.t_fails_with('en utdatert klient kan ikke gjenopplive et gravlagt notat', 'PT409',
  format('insert into public.notes (id, owner_id, project_id, title, ts, org) values (%L, %L, %L, ''Kortlevd notat'', 1, ''a'')',
         :'N3', :'A', :'P'));
select public.t_fails_with('gjentatt forsøk avvises likt (idempotent vakt)', 'PT409',
  format('insert into public.notes (id, owner_id, project_id, title, ts, org) values (%L, %L, %L, ''Kortlevd notat'', 1, ''a'')',
         :'N3', :'A', :'P'));
select public.t_fails_with('… og heller ikke en gravlagt mappe', 'PT409',
  format('insert into public.note_folders (id, owner_id, project_id, name, ts, org) values (%L, %L, %L, ''Metode'', 1, ''a'')',
         :'F', :'A', :'P'));

-- ---------- 9. Kontosletting tar notatene med seg ----------
select public.t_check('A har notater før kontoslettingen',
  (select count(*) from public.notes) = 2);
select public.delete_account();
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B sitt notat overlevde A sin kontosletting',
  (select count(*) from public.notes where id = :'BN') = 1
  and (select count(*) from public.note_projects where id = :'BP') = 1);
reset role;
select public.t_check('A sine notatrader er borte fra tabellene',
  (select count(*) from public.notes where owner_id = :'A'::uuid) = 0
  and (select count(*) from public.note_projects where owner_id = :'A'::uuid) = 0
  and (select count(*) from public.note_folders where owner_id = :'A'::uuid) = 0);
select public.t_check('… og de er gravlagt, så ingen gammel klient kan legge dem inn igjen',
  (select count(*) from public.tombstones where resource_type = 'note' and resource_id in (:'N1', :'N2')) = 2
  and (select count(*) from public.tombstones where resource_type = 'note_project' and resource_id = :'P') = 1);

-- ---------- 10. Rettighetene ----------
select public.t_check('authenticated har full CRUD på de tre notattabellene',
  has_table_privilege('authenticated', 'public.note_projects', 'SELECT, INSERT, UPDATE, DELETE')
  and has_table_privilege('authenticated', 'public.note_folders', 'SELECT, INSERT, UPDATE, DELETE')
  and has_table_privilege('authenticated', 'public.notes', 'SELECT, INSERT, UPDATE, DELETE'));
select public.t_check('anon har ingen tilgang til notatene',
  not has_table_privilege('anon', 'public.notes', 'SELECT')
  and not has_table_privilege('anon', 'public.note_projects', 'SELECT')
  and not has_table_privilege('anon', 'public.note_folders', 'SELECT'));
reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;
select public.t_fails('anon kan ikke lese notater', 'select count(*) from public.notes');

reset role;
select 'ALLE NOTAT-TESTER GRØNNE' as resultat;
