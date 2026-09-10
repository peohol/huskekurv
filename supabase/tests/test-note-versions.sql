-- ============================================================
-- Testsuite for NOTATHISTORIKKEN
-- (docs/notater-plan.md → «Historikk», docs/rettigheter-og-deling.md del 14).
-- Kjøres mot en LOKAL PostgreSQL med tests/local-stub.sql +
-- users-and-sharing.sql lastet først. Se run-tests.sh.
--
-- Historikken er `note_versions`: ett øyeblikksbilde av tittelen og hele
-- dokumentet per rad. Den er notatets innhold, og har derfor nøyaktig
-- notatets rettigheter — lesing på `can_read_note`, skriving på
-- `can_edit_content`. Klienten har INGEN grant på tabellen; alt går gjennom de
-- fire SECURITY DEFINER-RPC-ene.
--
-- Dekker:
--   1. tabellen er utenfor klientens rekkevidde (ingen grant, én lesepolicy)
--   2. forfatteren lagres, men returneres ALDRI av noen av de fire
--   3. et bilde lagres, listes og hentes tilbake med dokumentet intakt
--   4. samme tilstand to ganger blir ÉN rad (fingeravtrykket)
--   5. … men en tilstand som kommer TILBAKE får sin egen rad
--   6. en REN LESER kan bla i historikken, men ikke skrive i den
--   7. en utenforstående kommer ikke til noen av de fire
--   8. et merket bilde overlever uttynningen; taket på merker sier nei
--   9. uttynningen: alt siste time, ett per time siste døgn, ett per døgn før
--      det — og et hardt tak
--  10. tilbakekalt tilgang stopper både lesing og skriving umiddelbart
--  11. permanent sletting av notatet tar historikken med seg
--  12. kontosletting nuller forfatteren, men beholder bildene
--
-- Fire brukere:
--   A = eier bokhyllen (og notatet)
--   B = medlem/redaktør av bokhyllen
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

\set A 'aa000000-8888-0000-0000-0000000000a1'
\set B 'bb000000-8888-0000-0000-0000000000b1'
\set C 'cc000000-8888-0000-0000-0000000000c1'
\set D 'dd000000-8888-0000-0000-0000000000d1'
\set P  '88000000-8888-0000-0000-000000000001'
\set N  '88000000-8888-0000-0000-000000000002'
-- NL = låst notat (C er ren leser), NP/PP = As HELT private notat og bokhylle.
-- MERK: `\set` tar RESTEN av linjen, kommentaren inkludert — verdiene står
-- derfor alene.
\set NL '88000000-8888-0000-0000-000000000003'
\set NP '88000000-8888-0000-0000-000000000004'
\set PP '88000000-8888-0000-0000-000000000005'
\set V1 '88000000-8888-0000-0000-0000000000a1'
\set V2 '88000000-8888-0000-0000-0000000000a2'
\set V3 '88000000-8888-0000-0000-0000000000a3'
\set V4 '88000000-8888-0000-0000-0000000000a4'
\set V5 '88000000-8888-0000-0000-0000000000a5'

insert into auth.users (id, email) values
  (:'A', 'ver-a@example.com'), (:'B', 'ver-b@example.com'),
  (:'C', 'ver-c@example.com'), (:'D', 'ver-d@example.com')
on conflict (id) do nothing;

-- ---------- 0. Oppsett ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'P', :'A', 'Historikk', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, body, ts, org, pos, pos_ts, pos_org)
  values (:'N', :'A', :'P', 'Felles notat',
          '{"v":1,"blocks":[{"t":"p","c":[{"s":"Start"}]}]}'::jsonb, 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, body, ts, org, pos, pos_ts, pos_org)
  values (:'NL', :'A', :'P', 'Kun lesing',
          '{"v":1,"blocks":[{"t":"p","c":[{"s":"Leses"}]}]}'::jsonb, 1, 'a', 2, 1, 'a');
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'PP', :'A', 'Privat bokhylle', 1, 'a', 2, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'NP', :'A', :'PP', 'Privat kladd', 1, 'a', 1, 1, 'a');

-- ---------- 1. Tabellen er utenfor klientens rekkevidde ----------
reset role;
select public.t_check('authenticated har INGEN rettighet på note_versions i det hele tatt',
  not has_table_privilege('authenticated', 'public.note_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.note_versions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.note_versions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.note_versions', 'DELETE'));
select public.t_check('anon heller ikke',
  not has_table_privilege('anon', 'public.note_versions', 'SELECT'));
select public.t_check('RLS er på',
  (select relrowsecurity from pg_class where oid = 'public.note_versions'::regclass));
select public.t_check('… og det finnes nøyaktig ÉN policy, en lesepolicy',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'note_versions') = 1
  and (select cmd from pg_policies
        where schemaname = 'public' and tablename = 'note_versions') = 'SELECT');
-- Uttynningen er en opprydning kallerne bestiller, ikke en RPC.
select public.t_check('note_versions_prune er ikke kallbar som RPC',
  not has_function_privilege('authenticated', 'public.note_versions_prune(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.note_versions_prune(uuid)', 'EXECUTE'));

-- ---------- 2–3. A lagrer et bilde ----------
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.note_version_save(:'N', :'V1', 'Felles notat',
         '{"v":1,"blocks":[{"t":"p","c":[{"s":"Start"}]}]}'::jsonb,
         'Start', 5, false) as s1 \gset
select public.t_check('A fikk lagret bildet', (:'s1'::jsonb ->> 'created') = 'true');

select public.note_versions_list(:'N') as l1 \gset
select public.t_check('listen har bildet, med utdrag og tegntall',
  jsonb_array_length(:'l1'::jsonb -> 'versions') = 1
  and (:'l1'::jsonb -> 'versions' -> 0 ->> 'excerpt') = 'Start'
  and (:'l1'::jsonb -> 'versions' -> 0 ->> 'chars') = '5');
select public.t_check('listen bærer ALDRI dokumentet (60 bilder skal kunne åpnes på en telefon)',
  not (:'l1'::jsonb -> 'versions' -> 0 ? 'doc'));
select public.t_check('listen bærer ALDRI forfatteren',
  not (:'l1'::jsonb -> 'versions' -> 0 ? 'author_id')
  and not (:'l1'::jsonb -> 'versions' -> 0 ? 'author'));

select public.note_version_get(:'N', :'V1') as g1 \gset
select public.t_check('bildet hentes tilbake med dokumentet intakt',
  (:'g1'::jsonb -> 'doc' -> 'blocks' -> 0 -> 'c' -> 0 ->> 's') = 'Start'
  and (:'g1'::jsonb ->> 'title') = 'Felles notat');
select public.t_check('… og heller ikke DET svaret bærer forfatteren',
  not (:'g1'::jsonb ? 'author_id') and not (:'g1'::jsonb ? 'author'));
reset role;
select public.t_check('… men raden HAR en forfatter i basen',
  (select author_id from public.note_versions where id = :'V1') = :'A'::uuid);

-- ---------- 4. Samme tilstand to ganger blir ÉN rad ----------
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.note_version_save(:'N', :'V2', 'Felles notat',
         '{"v":1,"blocks":[{"t":"p","c":[{"s":"Start"}]}]}'::jsonb,
         'Start', 5, false) as s2 \gset
select public.t_check('et bilde av den samme tilstanden lager ingen ny rad',
  (:'s2'::jsonb ->> 'created') = 'false' and (:'s2'::jsonb ->> 'id') = :'V1');
select public.t_check('… og historikken står fortsatt med én rad',
  jsonb_array_length(public.note_versions_list(:'N') -> 'versions') = 1);

-- Nøkkelrekkefølgen i jsonb er kanonisk, så det samme dokumentet skrevet med
-- feltene i motsatt rekkefølge er FORTSATT det samme dokumentet.
select public.note_version_save(:'N', :'V2', 'Felles notat',
         jsonb_build_object('blocks', '[{"t":"p","c":[{"s":"Start"}]}]'::jsonb, 'v', 1),
         'Start', 5, false) as s2b \gset
select public.t_check('feltrekkefølgen i dokumentet endrer ikke fingeravtrykket',
  (:'s2b'::jsonb ->> 'created') = 'false');

-- ---------- 5. En NY tilstand, og en tilstand som kommer tilbake ----------
select public.note_version_save(:'N', :'V2', 'Felles notat',
         '{"v":1,"blocks":[{"t":"p","c":[{"s":"Start og mer"}]}]}'::jsonb,
         'Start og mer', 12, false);
select public.note_version_save(:'N', :'V3', 'Felles notat',
         '{"v":1,"blocks":[{"t":"p","c":[{"s":"Start"}]}]}'::jsonb,
         'Start', 5, false) as s3 \gset
select public.t_check('en tilstand som kommer TILBAKE er en ny tilstand i tid',
  (:'s3'::jsonb ->> 'created') = 'true');
select public.t_check('historikken har tre rader, nyeste først',
  jsonb_array_length(public.note_versions_list(:'N') -> 'versions') = 3
  and (public.note_versions_list(:'N') -> 'versions' -> 0 ->> 'id') = :'V3');

-- ---------- 6. En REN LESER kan bla, men ikke skrive ----------
select public.set_locked('note', :'NL', true);
select public.note_version_save(:'NL', :'V4', 'Kun lesing',
         '{"v":1,"blocks":[{"t":"p","c":[{"s":"Leses"}]}]}'::jsonb, 'Leses', 5, false);
select public.create_share_invite('note', :'NL', 'ver-c@example.com') ->> 'id' as inv_c \gset
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c'::uuid);
select public.t_check('C er en ren leser av det låste notatet',
  public.can_read_note(:'NL', :'C') and not public.can_edit_content('note', :'NL', :'C'));
select public.t_check('C KAN bla i historikken — det er notatets eget innhold',
  jsonb_array_length(public.note_versions_list(:'NL') -> 'versions') = 1);
select public.t_check('… og hente fram et bilde',
  (public.note_version_get(:'NL', :'V4') -> 'doc' -> 'blocks' -> 0 -> 'c' -> 0 ->> 's') = 'Leses');
select public.t_fails('C kan IKKE legge et bilde i historikken',
  'select public.note_version_save(''' || :'NL' || ''', gen_random_uuid(), ''X'',
     ''{"v":1,"blocks":[]}''::jsonb, '''', 0, false)');
select public.t_fails('C kan IKKE merke et bilde heller',
  'select public.note_version_pin(''' || :'NL' || ''', ''' || :'V4' || ''', true)');
select public.t_check('C ser ikke historikken i det andre notatet i bokhyllen',
  not public.can_read_note(:'N', :'C'));
select public.t_fails('… og kommer ikke til den',
  'select public.note_versions_list(''' || :'N' || ''')');

-- ---------- 7. En utenforstående kommer ikke til noen av de fire ----------
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_fails('D kan ikke liste historikken',
  'select public.note_versions_list(''' || :'N' || ''')');
select public.t_fails('D kan ikke hente et bilde',
  'select public.note_version_get(''' || :'N' || ''', ''' || :'V1' || ''')');
select public.t_fails('D kan ikke legge inn et bilde',
  'select public.note_version_save(''' || :'N' || ''', gen_random_uuid(), ''X'',
     ''{"v":1,"blocks":[]}''::jsonb, '''', 0, false)');
select public.t_fails('D kan ikke merke et bilde',
  'select public.note_version_pin(''' || :'N' || ''', ''' || :'V1' || ''', true)');
-- Grant-en er det YTTERSTE laget, og det sier nei før RLS i det hele tatt
-- blir spurt: et direkte oppslag er «permission denied», ikke «null rader».
select public.t_fails('D kommer ikke til tabellen direkte heller',
  'select count(*) from public.note_versions');

-- ---------- 8. Merking, og taket på merker ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.note_version_pin(:'N', :'V1', true) as p1 \gset
select public.t_check('A kan merke et bilde',
  (:'p1'::jsonb ->> 'pinned') = 'true' and (:'p1'::jsonb ->> 'changed') = 'true');
select public.t_check('… og merket står i listen',
  (select v ->> 'pinned' from jsonb_array_elements(public.note_versions_list(:'N') -> 'versions') v
    where v ->> 'id' = :'V1') = 'true');

-- Fyll opp til taket. Radene legges inn direkte (som postgres): poenget er
-- GRENSEN, ikke veien dit.
reset role;
insert into public.note_versions (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned)
select gen_random_uuid(), :'N', :'A', 'fyll', jsonb_build_object('v', 1, 'n', i),
       'fyll', i, 'fyll-' || i, true
  from generate_series(1, public.note_versions_pin_max() - 1) i;
select public.t_check('taket er fylt opp',
  (select count(*) from public.note_versions where note_id = :'N' and pinned)
    = public.note_versions_pin_max());
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_fails('et merke til avvises — brukeren må ta et av dem av først',
  'select public.note_version_pin(''' || :'N' || ''', ''' || :'V3' || ''', true)');
select public.t_fails('… og et NYTT bilde kan heller ikke merkes over taket',
  'select public.note_version_save(''' || :'N' || ''', gen_random_uuid(), ''X'',
     ''{"v":1,"blocks":[{"t":"p","c":[{"s":"over taket"}]}]}''::jsonb, ''over'', 4, true)');
select public.t_check('… men et UMERKET bilde går fortsatt inn',
  (public.note_version_save(:'N', gen_random_uuid(), 'X',
     '{"v":1,"blocks":[{"t":"p","c":[{"s":"under taket"}]}]}'::jsonb,
     'under', 5, false) ->> 'created') = 'true');
select public.t_check('å ta merket AV virker',
  (public.note_version_pin(:'N', :'V1', false) ->> 'pinned') = 'false');

-- ---------- 9. Uttynningen ----------
-- Et eget notat, slik at fyllet over ikke forstyrrer regnestykket.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'V5', :'A', :'P', 'Tynnes', 1, 'a', 3, 1, 'a');
reset role;
-- Tre bilder i den SAMME UTC-timen for fem timer siden, tre i det SAMME
-- UTC-døgnet for tre døgn siden (ett av dem merket), og tre i den siste timen.
--
-- Tidspunktene festes til MIDTEN av bøtta si, ikke til «nå minus fem timer
-- pluss ett minutt»: det uttrykket krysser et timeskifte i nesten hele timen,
-- og da hadde testen feilet av klokkeslettet i stedet for av koden
-- (tests/CLAUDE.md → «Datoer i fiksturer»). Bøttene regnes i UTC, som i
-- `note_versions_prune`.
insert into public.note_versions (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned, created_at)
select gen_random_uuid(), :'V5', :'A', 'g', jsonb_build_object('n', i), '', i, 'g' || i,
       i = 2,
       (date_trunc('day', now() at time zone 'UTC') - interval '3 days'
        + interval '12 hours' + (i * interval '1 second')) at time zone 'UTC'
  from generate_series(1, 3) i;
insert into public.note_versions (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned, created_at)
select gen_random_uuid(), :'V5', :'A', 'i', jsonb_build_object('n', i), '', i, 'i' || i, false,
       (date_trunc('hour', now() at time zone 'UTC') - interval '5 hours'
        + interval '30 minutes' + (i * interval '1 second')) at time zone 'UTC'
  from generate_series(1, 3) i;
insert into public.note_versions (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned, created_at)
select gen_random_uuid(), :'V5', :'A', 'n', jsonb_build_object('n', i), '', i, 'n' || i, false,
       now() - interval '10 minutes' + (i * interval '1 second')
  from generate_series(1, 3) i;
select public.t_check('ni bilder før uttynningen',
  (select count(*) from public.note_versions where note_id = :'V5') = 9);
select public.note_versions_prune(:'V5');
select public.t_check('den siste timen står urørt — der skjer «jeg slettet nettopp noe»',
  (select count(*) from public.note_versions
    where note_id = :'V5' and created_at > now() - interval '1 hour') = 3);
select public.t_check('timen for fem timer siden er tynnet til ett bilde',
  (select count(*) from public.note_versions where note_id = :'V5' and title = 'i') = 1);
select public.t_check('døgnet for tre dager siden er tynnet til ett — pluss det MERKEDE',
  (select count(*) from public.note_versions where note_id = :'V5' and title = 'g') = 2
  and (select count(*) from public.note_versions
        where note_id = :'V5' and title = 'g' and pinned) = 1);
select public.t_check('… og det merkede bildet står igjen selv om det er tre døgn gammelt',
  (select count(*) from public.note_versions
    where note_id = :'V5' and pinned and created_at < now() - interval '2 days') = 1);

-- Det harde taket: fyll langt over, tynn, tell.
insert into public.note_versions (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned, created_at)
select gen_random_uuid(), :'V5', :'A', 'tak', jsonb_build_object('n', i), '', i, 'tak' || i, false,
       now() - interval '30 minutes' + (i * interval '1 second')
  from generate_series(1, public.note_versions_keep() + 20) i;
select public.note_versions_prune(:'V5');
select public.t_check('det harde taket holder antallet UMERKEDE bilder nede',
  (select count(*) from public.note_versions where note_id = :'V5' and not pinned)
    = public.note_versions_keep());
select public.t_check('… og tar aldri et merket bilde med seg',
  (select count(*) from public.note_versions where note_id = :'V5' and pinned) = 1);

-- ---------- 10. Tilbakekalt tilgang stopper alt i samme øyeblikk ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('note_project', :'P', 'ver-b@example.com') ->> 'id' as inv_b \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b'::uuid);
select public.t_check('B kan lagre et bilde mens hen har skriverett',
  (public.note_version_save(:'N', gen_random_uuid(), 'Fra B',
     '{"v":1,"blocks":[{"t":"p","c":[{"s":"Fra B"}]}]}'::jsonb, 'Fra B', 5, false)
   ->> 'created') = 'true');
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.revoke_share('note_project', :'P', :'B');
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_fails('… og kommer ikke til historikken i det hele tatt etterpå',
  'select public.note_versions_list(''' || :'N' || ''')');
select public.t_fails('… heller ikke for å skrive',
  'select public.note_version_save(''' || :'N' || ''', gen_random_uuid(), ''X'',
     ''{"v":1,"blocks":[]}''::jsonb, '''', 0, false)');

-- ---------- 11. Permanent sletting tar historikken med seg ----------
reset role;
select public.t_check('notatet har historikk før slettingen',
  (select count(*) from public.note_versions where note_id = :'N') > 0);
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
delete from public.notes where id = :'N';
reset role;
select public.t_check('historikken forsvant med notatet (on delete cascade)',
  (select count(*) from public.note_versions where note_id = :'N') = 0);
select public.t_check('… og historikken har ingen egen gravstein — notatets holder',
  not exists (select 1 from public.tombstones where resource_type like 'note_version%')
  and exists (select 1 from public.tombstones
               where resource_type = 'note' and resource_id = :'N'::uuid));

-- ---------- 12. Kontosletting nuller forfatteren, men beholder bildene ----------
select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.delete_account();
reset role;
select public.t_check('C er borte',
  (select count(*) from public.profiles where id = :'C') = 0);
select public.t_check('… men bildene i det låste notatet står, som eieren fortsatt eier',
  (select count(*) from public.note_versions where note_id = :'NL') = 1);

select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.note_version_save(:'NL', gen_random_uuid(), 'Kun lesing',
  '{"v":1,"blocks":[{"t":"p","c":[{"s":"etter C"}]}]}'::jsonb, 'etter C', 7, false);
reset role;
update public.note_versions set author_id = :'D'::uuid where note_id = :'NL' and title = 'Kun lesing';
select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.delete_account();
reset role;
select public.t_check('en slettet forfatter river ikke bildene sine med seg (on delete set null)',
  (select count(*) from public.note_versions where note_id = :'NL') = 2
  and (select count(*) from public.note_versions where note_id = :'NL' and author_id is null) = 2);

\echo '──────── test-note-versions.sql: alle grønne ────────'
