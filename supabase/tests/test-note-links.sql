-- ============================================================
-- Testsuite for NOTATENES LIVSSYKLUS og KOBLINGENE mellom de to
-- hoveddelene (docs/notater-plan.md): `archived`-flagget på de tre
-- notattabellene, og `public.object_links`.
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først (IKKE mot Supabase). Se run-tests.sh.
--
-- Det som ikke kan bevises noe annet sted:
--   * `archived` rir på INNHOLDS-registeret, som `trashed` — en eldre
--     skriving kan ikke flippe det tilbake.
--   * En kobling kan bare peke på et notatobjekt jeg EIER og et listeobjekt
--     jeg får LESE. Begge sidene håndheves serverside, ikke av klienten.
--   * Nøyaktig ÉN kolonne per side er satt.
--   * Fremmednøklene gjør en hengende kobling umulig: slettes målet,
--     forsvinner koblingen — med sin egen gravstein.
--   * Koblingen har ingen UPDATE-vei: den finnes eller den finnes ikke.
--
-- To brukere:
--   A = eier notatene, området, mappen og listen
--   B = en helt annen konto, uten tilgang til noe av A sitt
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

\set A  'aaaa1111-0000-0000-0000-00000000aa11'
\set B  'bbbb2222-0000-0000-0000-00000000bb22'
-- A sin listeside: område > mappe > liste.
\set U  '7c000000-eeee-0000-0000-000000000001'
\set G  '7c000000-eeee-0000-0000-000000000002'
\set C  '7c000000-eeee-0000-0000-000000000003'
-- A sin notatside: bokhylle > notatbok > notat.
\set P  '7c000000-eeee-0000-0000-000000000011'
\set F  '7c000000-eeee-0000-0000-000000000012'
\set N  '7c000000-eeee-0000-0000-000000000013'
-- Koblingene.
\set L1 '7c000000-eeee-0000-0000-000000000021'
\set L2 '7c000000-eeee-0000-0000-000000000022'
\set L3 '7c000000-eeee-0000-0000-000000000023'
-- B sitt eget.
\set BP '7c000000-eeee-0000-0000-000000000031'
\set BN '7c000000-eeee-0000-0000-000000000032'
\set BU '7c000000-eeee-0000-0000-000000000033'
\set BG '7c000000-eeee-0000-0000-000000000034'
\set BC '7c000000-eeee-0000-0000-000000000035'

insert into auth.users (id, email) values
  (:'A', 'kobling-a@example.com'), (:'B', 'kobling-b@example.com')
on conflict (id) do nothing;

-- ---------- 1. A bygger begge sider ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.universes (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'U', :'A', 'Klinikken', 1, 'a', 1, 1, 'a');
insert into public.groups (id, owner_id, universe_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'G', :'A', :'U', 'Timeboka', 1, 'a', 1, 1, 'a');
insert into public.cards (id, owner_id, group_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'C', :'A', :'G', 'Prøvesvar', 1, 'a', 1, 1, 'a');
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'P', :'A', 'Fagstoff', 1, 'a', 1, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'F', :'A', :'P', 'Anatomi', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'N', :'A', :'P', :'F', 'Skjelettet', 1, 'a', 1, 1, 'a');

-- ---------- 2. `archived` finnes, er av som standard, og rir på innholdsregisteret ----------
select public.t_check('archived finnes på alle tre notattabellene og er av som standard',
  (select archived from public.note_projects where id = :'P') = false
  and (select archived from public.note_folders where id = :'F') = false
  and (select archived from public.notes where id = :'N') = false);

update public.notes set archived = true, ts = 10, org = 'a' where id = :'N';
select public.t_check('en NYERE skriving arkiverer notatet',
  (select archived from public.notes where id = :'N') = true);
-- En eldre skriving fra en annen enhet skal ikke kunne hente det ut igjen.
update public.notes set archived = false, title = 'Snik', ts = 5, org = 'b' where id = :'N';
select public.t_check('en ELDRE skriving ruller tilbake BÅDE arkiv-flagget og tittelen',
  (select archived from public.notes where id = :'N') = true
  and (select title from public.notes where id = :'N') = 'Skjelettet');
-- … og at det er ETT register: `trashed` og `archived` er uavhengige TILSTANDER,
-- men de skrives av det samme stempelet.
update public.notes set trashed = true, ts = 20, org = 'a' where id = :'N';
select public.t_check('arkivert og slettet er uavhengige tilstander på samme rad',
  (select archived and trashed from public.notes where id = :'N') = true);
update public.notes set trashed = false, archived = false, ts = 30, org = 'a' where id = :'N';

update public.note_folders set archived = true, ts = 10, org = 'a' where id = :'F';
update public.note_folders set archived = false, name = 'Snik', ts = 5, org = 'b' where id = :'F';
select public.t_check('samme vakt på notatboken',
  (select archived from public.note_folders where id = :'F') = true
  and (select name from public.note_folders where id = :'F') = 'Anatomi');
update public.note_folders set archived = false, ts = 20, org = 'a' where id = :'F';

update public.note_projects set archived = true, ts = 10, org = 'a' where id = :'P';
update public.note_projects set archived = false, name = 'Snik', ts = 5, org = 'b' where id = :'P';
select public.t_check('samme vakt på bokhyllen',
  (select archived from public.note_projects where id = :'P') = true
  and (select name from public.note_projects where id = :'P') = 'Fagstoff');
update public.note_projects set archived = false, ts = 20, org = 'a' where id = :'P';

-- ---------- 3. Koblinger: begge retninger, alle tre nivåene ----------
insert into public.object_links (id, owner_id, note_id, card_id, ts, org)
  values (:'L1', :'A', :'N', :'C', 1, 'a');
insert into public.object_links (id, owner_id, note_folder_id, group_id, ts, org)
  values (:'L2', :'A', :'F', :'G', 1, 'a');
insert into public.object_links (id, owner_id, note_project_id, universe_id, ts, org)
  values (:'L3', :'A', :'P', :'U', 1, 'a');
select public.t_check('A har tre koblinger, én per nivå',
  (select count(*) from public.object_links where owner_id = :'A'::uuid) = 3);

-- ---------- 4. Nøyaktig ÉN kolonne per side ----------
select public.t_fails('to notatsider i samme kobling avvises',
  format('insert into public.object_links (id, owner_id, note_id, note_folder_id, card_id, ts, org) values (%L, %L, %L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', :'N', :'F', :'C'));
select public.t_fails('ingen notatside avvises',
  format('insert into public.object_links (id, owner_id, card_id, ts, org) values (%L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', :'C'));
select public.t_fails('to listesider i samme kobling avvises',
  format('insert into public.object_links (id, owner_id, note_id, card_id, group_id, ts, org) values (%L, %L, %L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', :'N', :'C', :'G'));
select public.t_fails('ingen listeside avvises',
  format('insert into public.object_links (id, owner_id, note_id, ts, org) values (%L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', :'N'));

-- ---------- 5. Et mål som ikke finnes er umulig å koble til ----------
-- For en KLIENT stopper RLS den først: policyen spør om notatet er mitt og om
-- listen er lesbar for meg, og et objekt som ikke finnes er ingen av delene.
select public.t_fails('en kobling til et notat som ikke finnes blir avvist',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', gen_random_uuid(), :'C'));
select public.t_fails('… og en kobling til en liste som ikke finnes',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', :'N', gen_random_uuid()));
-- Og UNDER RLS ligger fremmednøkkelen, som gjelder uansett hvem som skriver
-- (psql, vedlikehold, en fremtidig SECURITY DEFINER-vei): det er DEN som gjør
-- en hengende kobling umulig, ikke policyen. Nøklene er DEFERRABLE INITIALLY
-- DEFERRED (som notatenes egne forelder-pekere: doc-rekkefølgen er vilkårlig),
-- så bruddet kommer normalt først ved commit — utenfor rekkevidde for
-- unntaksfangeren i `t_fails_with`. `set constraints all immediate` flytter
-- sjekken til selve INSERT-en, som er nøyaktig det klienten møter når hver
-- skriving er sin egen transaksjon.
reset role;
begin;
set constraints all immediate;
select public.t_fails_with('fremmednøkkelen avviser et notat-mål som ikke finnes', '23503',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', gen_random_uuid(), :'C'));
select public.t_fails_with('… og et liste-mål som ikke finnes', '23503',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''a'')',
         gen_random_uuid(), :'A', :'N', gen_random_uuid()));
rollback;

-- ---------- 6. B ser ingenting, og kan ikke koble seg inn i A sitt ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'BP', :'B', 'B sin hylle', 1, 'b', 1, 1, 'b');
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'BN', :'B', :'BP', 'B sitt notat', 1, 'b', 1, 1, 'b');
insert into public.universes (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'BU', :'B', 'B sitt område', 1, 'b', 1, 1, 'b');
insert into public.groups (id, owner_id, universe_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'BG', :'B', :'BU', 'B sin mappe', 1, 'b', 1, 1, 'b');
insert into public.cards (id, owner_id, group_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'BC', :'B', :'BG', 'B sin liste', 1, 'b', 1, 1, 'b');

select public.t_check('B ser ingen av A sine koblinger (RLS)',
  (select count(*) from public.object_links) = 0);
select public.t_fails('B kan ikke koble fra A sitt notat',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''b'')',
         gen_random_uuid(), :'B', :'N', :'BC'));
select public.t_fails('B kan ikke koble sitt eget notat til A sin liste',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''b'')',
         gen_random_uuid(), :'B', :'BN', :'C'));
select public.t_fails('B kan ikke sette en kobling i A sitt navn',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''b'')',
         gen_random_uuid(), :'A', :'BN', :'BC'));
-- B kan koble sitt EGET — det er ikke koblingen som er sperret, det er A sitt.
insert into public.object_links (id, owner_id, note_id, card_id, ts, org)
  values ('7c000000-eeee-0000-0000-0000000000b1', :'B', :'BN', :'BC', 1, 'b');
select public.t_check('B kan koble sitt eget notat til sin egen liste',
  (select count(*) from public.object_links) = 1);
-- En DELETE som RLS filtrerer bort er ikke en FEIL — den treffer bare ingen
-- rader. Beviset er derfor at A sin kobling fortsatt står etterpå.
delete from public.object_links where id = :'L1';
reset role;
select public.t_check('B sin sletting rørte ikke A sin kobling',
  (select count(*) from public.object_links where id = :'L1') = 1);
select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;

-- ---------- 7. Koblingen har ingen UPDATE-vei ----------
reset role;
select public.t_check('authenticated har SELECT/INSERT/DELETE, men IKKE UPDATE på koblingene',
  has_table_privilege('authenticated', 'public.object_links', 'SELECT, INSERT, DELETE')
  and not has_table_privilege('authenticated', 'public.object_links', 'UPDATE'));
select public.t_check('anon har ingen tilgang til koblingene',
  not has_table_privilege('anon', 'public.object_links', 'SELECT'));
select public.t_check('det finnes ingen update-policy på object_links',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'object_links' and cmd = 'UPDATE') = 0);

-- ---------- 8. get_my_doc() leverer koblingene med type per side ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('doc-et har tre koblinger for A',
  jsonb_array_length(public.get_my_doc() -> 'links') = 3);
select public.t_check('notat-koblingen kommer med noteType/listType og id per side',
  (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'links') l
    where l ->> 'id' = :'L1'
      and l ->> 'noteType' = 'note' and (l ->> 'noteId')::uuid = :'N'::uuid
      and l ->> 'listType' = 'card' and (l ->> 'listId')::uuid = :'C'::uuid) = 1);
select public.t_check('… og nivåene over får sine egne ord',
  (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'links') l
    where l ->> 'noteType' in ('noteFolder', 'noteProject')
      and l ->> 'listType' in ('group', 'universe')) = 2);
select public.t_check('doc-et bærer arkiv-flagget på alle tre notatnivåene',
  (public.get_my_doc() -> 'noteProjects' -> 0 ? 'archived')
  and (public.get_my_doc() -> 'noteFolders' -> 0 ? 'archived')
  and (public.get_my_doc() -> 'notes' -> 0 ? 'archived'));

-- ---------- 9. Slettes målet, forsvinner koblingen — med gravstein ----------
delete from public.cards where id = :'C';
select public.t_check('koblingen til den slettede listen er borte',
  (select count(*) from public.object_links where id = :'L1') = 0);
select public.t_check('… og den fikk sin egen gravstein av typen «object_link»',
  (select count(*) from public.tombstones
    where resource_type = 'object_link' and resource_id = :'L1') = 1);
select public.t_check('de to andre koblingene er urørt',
  (select count(*) from public.object_links where owner_id = :'A'::uuid) = 2);

-- Samme fra NOTATSIDEN: sletter vi notatboken, går koblingen dens med.
delete from public.note_folders where id = :'F';
select public.t_check('koblingen fra den slettede notatboken er borte, med gravstein',
  (select count(*) from public.object_links where id = :'L2') = 0
  and (select count(*) from public.tombstones
        where resource_type = 'object_link' and resource_id = :'L2') = 1);

-- ---------- 10. Gravsteinen stenger døren ----------
select public.t_fails_with('en utdatert klient kan ikke sette den gravlagte koblingen inn igjen', 'PT409',
  format('insert into public.object_links (id, owner_id, note_project_id, universe_id, ts, org) values (%L, %L, %L, %L, 1, ''a'')',
         :'L2', :'A', :'P', :'U'));

-- ---------- 11. Kontosletting tar koblingene med seg ----------
select public.t_check('A har én kobling igjen før kontoslettingen',
  (select count(*) from public.object_links where owner_id = :'A'::uuid) = 1);
select public.delete_account();
reset role;
select public.t_check('A sine koblinger er borte etter kontoslettingen',
  (select count(*) from public.object_links where owner_id = :'A'::uuid) = 0);
select public.t_check('B sin kobling overlevde',
  (select count(*) from public.object_links where owner_id = :'B'::uuid) = 1);

reset role;
select 'ALLE KOBLINGS- OG ARKIV-TESTER GRØNNE' as resultat;
