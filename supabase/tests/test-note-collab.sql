-- ============================================================
-- Testsuite for SANNTIDS SAMSKRIVING I SAMME NOTAT
-- (docs/notater-plan.md → «Sanntids samskriving»,
--  docs/rettigheter-og-deling.md del 14). Kjøres mot en LOKAL PostgreSQL med
-- tests/local-stub.sql + users-and-sharing.sql lastet først. Se run-tests.sh.
--
-- Notatinnholdet har TO lag, og testen holder dem fra hverandre:
--   • `notes.body` er PROJEKSJONEN, og flettes fortsatt per felt (LWW) som
--     resten av innholdet;
--   • `note_updates` er samskrivingsloggen — append-only, én rad per
--     Yjs-oppdatering — og det er DER to samtidige skrivinger overlever
--     hverandre.
--
-- Dekker:
--   1. loggen er append-only for klienten (ingen grant, ingen policy)
--   2. `payload` og `author_id` er ALDRI lesbare rett fra tabellen
--   3. to redaktører skriver samtidig; ingen rad overskriver den andre
--   4. en REN LESER kan lese loggen, men ikke skrive i den
--   5. en utenforstående ser verken loggen eller notatet
--   6. `note_crdt_since` er hullfri: merket er xmin, ikke en sekvens
--   7. komprimering folder EKSAKT de radene den fikk oppgitt
--   8. tilbakekalt tilgang stopper både lesing og skriving umiddelbart
--   9. permanent sletting av notatet tar loggen med seg
--  10. kontosletting nuller forfatteren, men beholder tegnene
--
-- Fire brukere:
--   A = eier bokhyllen (og notatet)
--   B = medlem/redaktør av bokhyllen — den andre samtidige skriveren
--   C = ren leser (medlem av et LÅST notat)
--   D = utenforstående
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
grant execute on function public.t_check(text, boolean) to public;
grant execute on function public.t_fails(text, text) to public;

\set A 'aa000000-7777-0000-0000-0000000000a1'
\set B 'bb000000-7777-0000-0000-0000000000b1'
\set C 'cc000000-7777-0000-0000-0000000000c1'
\set D 'dd000000-7777-0000-0000-0000000000d1'
-- P = bokhylle (A) som deles, N = det delte notatet.
-- PP/NP = As HELT private bokhylle og notat — de skal aldri bli synlige.
\set P  '77000000-7777-0000-0000-000000000001'
\set N  '77000000-7777-0000-0000-000000000002'
\set NP '77000000-7777-0000-0000-000000000003'
\set PP '77000000-7777-0000-0000-000000000005'
\set DP '77000000-7777-0000-0000-000000000004'
-- Faste id-er på loggradene, slik at komprimeringen kan navngi dem.
\set U1 '77000000-7777-0000-0000-0000000000a0'
\set U2 '77000000-7777-0000-0000-0000000000a1'
\set U3 '77000000-7777-0000-0000-0000000000a2'
\set U4 '77000000-7777-0000-0000-0000000000a3'
\set U5 '77000000-7777-0000-0000-0000000000a4'
\set US '77000000-7777-0000-0000-0000000000af'

insert into auth.users (id, email) values
  (:'A', 'sam-a@example.com'), (:'B', 'sam-b@example.com'),
  (:'C', 'sam-c@example.com'), (:'D', 'sam-d@example.com')
on conflict (id) do nothing;

-- ---------- 0. Oppsett: A eier en bokhylle med ett notat ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'P', :'A', 'Samskriving', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, body, ts, org, pos, pos_ts, pos_org)
  values (:'N', :'A', :'P', 'Felles notat',
          '{"v":1,"blocks":[{"t":"p","c":[{"s":"Start"}]}]}'::jsonb, 1, 'a', 1, 1, 'a');
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'PP', :'A', 'Privat bokhylle', 1, 'a', 2, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'NP', :'A', :'PP', 'Privat kladd', 1, 'a', 1, 1, 'a');

-- ---------- 1. Loggen er append-only for klienten ----------
reset role;
select public.t_check('authenticated har INGEN insert/update/delete på note_updates',
  not has_table_privilege('authenticated', 'public.note_updates', 'INSERT')
  and not has_table_privilege('authenticated', 'public.note_updates', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.note_updates', 'DELETE'));
select public.t_check('… og bare ÉN policy, en lesepolicy (realtime trenger den)',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'note_updates') = 1
  and (select cmd from pg_policies
        where schemaname = 'public' and tablename = 'note_updates') = 'SELECT');
select public.t_check('anon slipper ikke til i det hele tatt',
  not has_table_privilege('anon', 'public.note_updates', 'SELECT'));

-- ---------- 2. `payload` og `author_id` er ikke lesbare rett fra tabellen ----------
select public.t_check('authenticated kan lese id/note_id/created_at (det realtime trenger)',
  has_column_privilege('authenticated', 'public.note_updates', 'id', 'SELECT')
  and has_column_privilege('authenticated', 'public.note_updates', 'note_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.note_updates', 'created_at', 'SELECT'));
select public.t_check('… men ALDRI innholdet eller forfatteren',
  not has_column_privilege('authenticated', 'public.note_updates', 'payload', 'SELECT')
  and not has_column_privilege('authenticated', 'public.note_updates', 'author_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.note_updates', 'xid', 'SELECT'));

-- ---------- 3. A skriver i loggen ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.note_crdt_push(:'N',
  jsonb_build_array(jsonb_build_object('id', :'U1', 'u', 'AAEA-fra-A'))) ->> 'written' as w1 \gset
select public.t_check('A fikk skrevet én rad', :'w1' = '1');
select public.t_check('loggen har raden, og den peker på notatet',
  (select count(*) from public.note_updates where note_id = :'N') = 1);

select public.note_crdt_load(:'N') as load_a \gset
select public.t_check('note_crdt_load gir raden tilbake MED innhold',
  (:'load_a'::jsonb -> 'updates' -> 0 ->> 'u') = 'AAEA-fra-A'
  and (:'load_a'::jsonb -> 'updates' -> 0 ->> 'id') = :'U1');
select public.t_check('… og et merke å hente inkrementelt fra',
  (:'load_a'::jsonb ->> 'mark') ~ '^[0-9]+$');
select public.t_check('svaret bærer ALDRI forfatteren videre til klienten',
  not (:'load_a'::jsonb -> 'updates' -> 0 ? 'author_id')
  and not (:'load_a'::jsonb -> 'updates' -> 0 ? 'author'));
reset role;
select public.t_check('… men raden HAR en forfatter i basen',
  (select author_id from public.note_updates where id = :'U1') = :'A'::uuid);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- Den samme id-en to ganger er en no-op: en kø som ble sendt, men der svaret
-- aldri kom fram, skal kunne sendes på nytt.
select public.note_crdt_push(:'N',
  jsonb_build_array(jsonb_build_object('id', :'U1', 'u', 'noe-helt-annet'))) ->> 'written' as w2 \gset
select public.t_check('en gjentatt push legger ikke inn dubletter', :'w2' = '0');
reset role;
select public.t_check('… og rører ikke raden som allerede står',
  (select payload from public.note_updates where id = :'U1') = 'AAEA-fra-A');
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- ---------- 4. B blir redaktør og skriver SAMTIDIG ----------
select public.create_share_invite('note_project', :'P', 'sam-b@example.com') ->> 'id' as inv_b \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b'::uuid);
select public.t_check('B har skriverett i notatet',
  public.can_edit_content('note', :'N', :'B'));
select public.note_crdt_push(:'N',
  jsonb_build_array(jsonb_build_object('id', :'U2', 'u', 'BBEB-fra-B'))) ->> 'written' as w3 \gset
select public.t_check('B fikk skrevet sin egen rad', :'w3' = '1');

select public.note_crdt_load(:'N') as load_b \gset
select public.t_check('BEGGE radene står — den ene overskrev ikke den andre',
  jsonb_array_length(:'load_b'::jsonb -> 'updates') = 2
  and (:'load_b'::jsonb -> 'updates') @> jsonb_build_array(jsonb_build_object('id', :'U1', 'u', 'AAEA-fra-A'))
  and (:'load_b'::jsonb -> 'updates') @> jsonb_build_array(jsonb_build_object('id', :'U2', 'u', 'BBEB-fra-B')));

-- B ser IKKE As private notat, og kan derfor ikke røre loggen der heller.
select public.t_fails('B kan ikke lese loggen i et notat hen ikke ser',
  'select public.note_crdt_load(''' || :'NP' || ''')');

-- ---------- 5. Merket er hullfritt: xmin, ikke en sekvens ----------
select :'load_b'::jsonb ->> 'mark' as mark_b \gset
select public.note_crdt_since(:'N', :'mark_b') as since_b \gset
select public.t_check('en henting fra merket gir ingen NYE rader når ingenting har skjedd',
  jsonb_array_length(:'since_b'::jsonb -> 'updates') <= 2);
select public.note_crdt_push(:'N',
  jsonb_build_array(jsonb_build_object('id', :'U3', 'u', 'CCEC-etter-merket')));
select public.note_crdt_since(:'N', :'mark_b') as since_b2 \gset
select public.t_check('… og raden som kom ETTER merket er med',
  (:'since_b2'::jsonb -> 'updates') @> jsonb_build_array(jsonb_build_object('id', :'U3', 'u', 'CCEC-etter-merket')));
select public.t_check('merket er et xid, ikke et radnummer — det rykker fram av seg selv',
  (:'since_b2'::jsonb ->> 'mark')::numeric >= (:'mark_b')::numeric);

-- ---------- 6. Ren leser: kan lese loggen, aldri skrive i den ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('note', :'N', 'sam-c@example.com') ->> 'id' as inv_c \gset
select public.set_locked('note', :'N', true);
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c'::uuid);
select public.t_check('C er en REN LESER av notatet',
  public.can_read('note', :'N', :'C')
  and not public.can_edit_content('note', :'N', :'C'));
select public.note_crdt_load(:'N') as load_c \gset
select public.t_check('C får live-oppdateringene',
  jsonb_array_length(:'load_c'::jsonb -> 'updates') = 3);
select public.t_fails('C kan IKKE skrive i loggen',
  'select public.note_crdt_push(''' || :'N' || ''', ''[{"id":"' || :'U4' || '","u":"fra-C"}]''::jsonb)');
select public.t_fails('C kan IKKE komprimere loggen heller',
  'select public.note_crdt_compact(''' || :'N' || ''', ''' || :'US' || ''', ''snap'', array[''' || :'U1' || ''']::uuid[])');
select public.t_check('… og ingenting kom inn',
  (select count(*) from public.note_updates where note_id = :'N') = 3);
-- Låsen tok skriveretten fra B også, men ikke lesingen: den er notatets lås.
select public.t_check('en direkte SELECT som C er RLS-filtrert til notater hen kan lese',
  (select count(*) from public.note_updates) = 3);

-- ---------- 7. Utenforstående ser ingenting ----------
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'DP', :'D', 'Ds egen', 1, 'd', 1, 1, 'd');
select public.t_fails('D kan ikke laste loggen i et notat hen ikke har tilgang til',
  'select public.note_crdt_load(''' || :'N' || ''')');
select public.t_fails('D kan ikke hente inkrementelt heller',
  'select public.note_crdt_since(''' || :'N' || ''', null)');
select public.t_fails('D kan ikke skrive i den',
  'select public.note_crdt_push(''' || :'N' || ''', ''[{"id":"' || :'U4' || '","u":"fra-D"}]''::jsonb)');
select public.t_check('en rå SELECT gir D null rader — det er RLS som stopper abonnementet',
  (select count(*) from public.note_updates) = 0);

-- ---------- 8. Komprimering folder EKSAKT de oppgitte radene ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('note', :'N', false);
-- U4 kommer INN etter at øyeblikksbildet er regnet ut, og er derfor ikke med i
-- listen. Den skal overleve — det er hele grunnen til at komprimeringen
-- navngir radene i stedet for å slette «alt eldre enn».
select public.note_crdt_push(:'N',
  jsonb_build_array(jsonb_build_object('id', :'U4', 'u', 'DDED-underveis')));
select public.note_crdt_compact(:'N', :'US', 'SAMMENSLATT',
  array[:'U1', :'U2', :'U3']::uuid[]) ->> 'removed' as removed \gset
select public.t_check('de tre navngitte radene ble borte', :'removed' = '3');
reset role;
select public.t_check('… og ble erstattet av ÉN sammenslått rad',
  (select payload from public.note_updates where id = :'US') = 'SAMMENSLATT');
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('raden som var underveis overlevde komprimeringen',
  (select count(*) from public.note_updates where id = :'U4') = 1);
select public.t_check('loggen er nå to rader: bildet + den som kom etterpå',
  (select count(*) from public.note_updates where note_id = :'N') = 2);
select public.note_crdt_load(:'N') as load_after \gset
select public.t_check('en ny klient laster begge to og mister ingenting',
  jsonb_array_length(:'load_after'::jsonb -> 'updates') = 2
  and (:'load_after'::jsonb -> 'updates') @> jsonb_build_array(jsonb_build_object('id', :'US', 'u', 'SAMMENSLATT'))
  and (:'load_after'::jsonb -> 'updates') @> jsonb_build_array(jsonb_build_object('id', :'U4', 'u', 'DDED-underveis')));

-- ---------- 9. Projeksjonen lever videre med sin egen, avgrensede rolle ----------
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
update public.notes set body = '{"v":1,"blocks":[{"t":"p","c":[{"s":"Projeksjon fra B"}]}]}'::jsonb,
                        ts = 20, org = 'b' where id = :'N';
select public.t_check('`notes.body` flettes fortsatt per felt (LWW) — den er projeksjonen',
  (select body -> 'blocks' -> 0 -> 'c' -> 0 ->> 's' from public.notes where id = :'N') = 'Projeksjon fra B');
update public.notes set body = '{"v":1,"blocks":[{"t":"p","c":[{"s":"eldre"}]}]}'::jsonb,
                        ts = 5, org = 'b' where id = :'N';
select public.t_check('… og en eldre projeksjon ruller tilbake, som før',
  (select body -> 'blocks' -> 0 -> 'c' -> 0 ->> 's' from public.notes where id = :'N') = 'Projeksjon fra B');
select public.t_check('loggen ble ikke rørt av en projeksjons-skriving',
  (select count(*) from public.note_updates where note_id = :'N') = 2);

-- ---------- 10. Tilbakekalling stopper både lesing og skriving ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.revoke_share('note_project', :'P', :'B');
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_fails('B kan ikke lenger laste loggen',
  'select public.note_crdt_load(''' || :'N' || ''')');
select public.t_fails('B kan ikke lenger skrive i den',
  'select public.note_crdt_push(''' || :'N' || ''', ''[{"id":"' || :'U4' || '","u":"etter-tilbakekalling"}]''::jsonb)');
select public.t_check('… og en rå SELECT gir null rader, så realtime slutter å levere',
  (select count(*) from public.note_updates) = 0);

-- ---------- 11. Kontosletting: forfatteren nulles, tegnene blir ----------
-- C får skriverett (låsen er av igjen), skriver en fersk rad og sletter så
-- kontoen sin. Raden skal bli stående — notatet er A sitt, og tegnene C skrev
-- i det er en del av dokumentet, ikke av C sin konto.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('note_project', :'P', 'sam-c@example.com') ->> 'id' as inv_c2 \gset
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c2'::uuid);
select public.note_crdt_push(:'N',
  jsonb_build_array(jsonb_build_object('id', :'U5', 'u', 'fra-C-med-skriverett')));
reset role;
select public.t_check('C skrev én ny rad',
  (select author_id from public.note_updates where id = :'U5') = :'C'::uuid);
select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.delete_account();
reset role;
select public.t_check('kontoslettingen tok ikke tegnene C skrev i As notat',
  (select payload from public.note_updates where id = :'U5') = 'fra-C-med-skriverett');
select public.t_check('… men forfatteren er nullet ut',
  (select author_id from public.note_updates where id = :'U5') is null);
select public.t_check('loggen er tre rader: bildet, den underveis og Cs',
  (select count(*) from public.note_updates where note_id = :'N') = 3);

-- ---------- 12. Permanent sletting av notatet tar loggen med seg ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
delete from public.notes where id = :'N';
reset role;
select public.t_check('loggen forsvant med notatet (kaskade)',
  (select count(*) from public.note_updates where note_id = :'N') = 0);
select public.t_check('… og notatet fikk gravstein som før',
  (select count(*) from public.tombstones where resource_id = :'N') = 1);

\echo '✅ test-note-collab.sql grønn'
