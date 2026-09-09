-- ============================================================
-- Testsuite for MIGRERINGEN AV DIREKTE LISTEDELINGER.
--
-- Forutsetter at tests/legacy-share-fixture.sql (den gamle databasefasongen
-- med data) er lastet FØRST, og deretter users-and-sharing.sql (gjerne to
-- ganger, for idempotens). Se run-tests.sh.
--
-- Kravet: den tidligere EFFEKTIVE tilgangen skal bevares NØYAKTIG — ingen får
-- tilgang til søskenlister de ikke kunne lese før.
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

\set O '01000000-3333-0000-0000-00000000000a'
\set M '01000000-3333-0000-0000-00000000000b'
\set X '01000000-3333-0000-0000-00000000000c'
\set Y '01000000-3333-0000-0000-00000000000d'
\set W '01000000-3333-0000-0000-00000000000e'
\set Z '01000000-3333-0000-0000-00000000000f'
\set U  '11000000-3333-0000-0000-000000000001'
\set G1 '12000000-3333-0000-0000-000000000001'
\set G2 '12000000-3333-0000-0000-000000000002'
\set C1 '13000000-3333-0000-0000-000000000001'
\set CY '13000000-3333-0000-0000-000000000002'
\set CS '13000000-3333-0000-0000-000000000003'
\set G3 '12000000-3333-0000-0000-000000000003'
\set CZ '13000000-3333-0000-0000-000000000004'
\set CZS '13000000-3333-0000-0000-000000000005'
\set NP '15000000-3333-0000-0000-000000000001'
\set NF '16000000-3333-0000-0000-000000000001'
\set N1 '17000000-3333-0000-0000-000000000001'
\set N2 '17000000-3333-0000-0000-000000000002'

-- ---------- 1. Roller er backfillet fra oppretterne ----------
select public.t_check('områdets oppretter ble områdeeier',
  public.universe_role(:'U', :'O') = 'owner' and public.universe_owner_count(:'U') = 1);
select public.t_check('eksisterende direkte områdemedlemskap ble rollen member',
  public.universe_role(:'U', :'M') = 'member');
select public.t_check('mappens oppretter fikk INGEN ekstra rad (allerede områdeeier)',
  public.group_role(:'G1', :'O') is null and public.is_group_owner(:'G1', :'O'));
select public.t_check('eksisterende direkte mappemedlemskap ble rollen member',
  public.group_role(:'G2', :'W') = 'member');

-- ---------- 2. Alle listedelinger er borte, og nye avvises ----------
select public.t_check('ingen medlemskap eller invitasjoner på listenivå igjen',
  (select count(*) from public.memberships where card_id is not null) = 0
  and (select count(*) from public.share_invites where card_id is not null) = 0);
select public.t_fails('nye liste-medlemskap avvises av databasen',
  format('insert into public.memberships (user_id, card_id, role) values (%L, %L, ''member'')', :'X', :'C1'));
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_fails('nye liste-invitasjoner avvises av RPC-en',
  format('select public.create_share_invite(''card'', %L, ''noen@example.com'')', :'C1'));

-- ---------- 3. Redundant listedeling ble bare fjernet ----------
select public.t_check('M (områdemedlem) har ingen egen rad for søskenlista',
  (select count(*) from public.memberships
    where user_id = :'M' and group_id = :'G2') = 0);
select public.t_check('… men har fortsatt tilgang via området',
  public.is_group_member(:'G2', :'M') and public.can_read_card(:'CS', :'M'));

-- ---------- 4. Én-liste-mappe: mottakeren ble direkte mappemedlem ----------
select public.t_check('X ble direkte mappemedlem i én-liste-mappen',
  public.group_role(:'G1', :'X') = 'member');
select public.t_check('lista ble liggende der den var',
  (select group_id from public.cards where id = :'C1') = :'G1'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'X', false); set role authenticated;
select public.t_check('X ser lista, men ikke området',
  (select count(*) from public.cards where id = :'C1') = 1
  and (select count(*) from public.universes where id = :'U') = 0);
select public.t_check('X ser mappen som FRI (Mapper delt med meg)',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'G1') = true);

-- ---------- 5. Flerliste-mappe: lista ble splittet ut i en NY søskenmappe ----------
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select id as newg from public.groups
 where universe_id = :'U' and name = 'Y-lista' and not is_cat \gset
select public.t_check('en ny søskenmappe med listetittelen ble opprettet i samme område',
  (select count(*) from public.groups where id = :'newg'::uuid) = 1
  and (select universe_id from public.groups where id = :'newg'::uuid) = :'U'::uuid);
select public.t_check('lista ble flyttet dit med UENDRET id',
  (select group_id from public.cards where id = :'CY') = :'newg'::uuid);
select public.t_check('søskenlista ble liggende igjen i den gamle mappen',
  (select group_id from public.cards where id = :'CS') = :'G2'::uuid);
select public.t_check('Y ble direkte mappemedlem i den NYE mappen — ikke i den gamle',
  public.group_role(:'newg'::uuid, :'Y') = 'member'
  and public.group_role(:'G2', :'Y') is null);
select public.t_check('W (direkte mappemedlem i den gamle mappen) fulgte med til den nye',
  public.group_role(:'newg'::uuid, :'W') = 'member'
  and public.group_role(:'G2', :'W') = 'member');
select public.t_check('den ventende listeinvitasjonen ble en mappeinvitasjon',
  (select count(*) from public.share_invites
    where group_id = :'newg'::uuid and status = 'pending'
      and lower(invitee_email) = 'mig-ny@example.com') = 1);

reset role; select set_config('request.jwt.claim.sub', :'Y', false); set role authenticated;
select public.t_check('Y ser sin liste og innholdet i den',
  (select count(*) from public.cards where id = :'CY') = 1
  and (select count(*) from public.items where card_id = :'CY') = 1);
select public.t_check('Y får IKKE tilgang til søskenlista',
  (select count(*) from public.cards where id = :'CS') = 0
  and not public.can_read_card(:'CS', :'Y'));
select public.t_check('Y ser den nye mappen i «Mapper delt med meg»',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'groups') x
    where x ->> 'id' = :'newg') = true
  and jsonb_array_length(public.get_my_doc() -> 'universes') = 0);

reset role; select set_config('request.jwt.claim.sub', :'W', false); set role authenticated;
select public.t_check('W beholder tilgangen til BEGGE mappene sine lister',
  (select count(*) from public.cards where id in (:'CY', :'CS')) = 2);

reset role; select set_config('request.jwt.claim.sub', :'M', false); set role authenticated;
select public.t_check('områdemedlemmet ser alt i området, inkludert den nye mappen',
  (select count(*) from public.cards where id in (:'C1', :'CY', :'CS')) = 3);

-- ---------- 5b. En TRASHET delt liste promoterer ikke mottakeren ----------
-- Lista selv ligger i søpla, men mappen har en AKTIV søskenliste. Promotering
-- ville gitt mottakeren tilgang til nettopp den søskenlista.
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_check('en trashet delt liste ble splittet ut, ikke promotert',
  public.group_role(:'G3', :'Z') is null
  and (select group_id from public.cards where id = :'CZ') <> :'G3'::uuid
  and (select group_id from public.cards where id = :'CZS') = :'G3'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'Z', false); set role authenticated;
select public.t_check('Z ser sin egen (trashede) liste …',
  (select count(*) from public.cards where id = :'CZ') = 1);
select public.t_check('… men IKKE den aktive søskenlista',
  (select count(*) from public.cards where id = :'CZS') = 0
  and not public.can_read_card(:'CZS', :'Z'));

-- ---------- 5c. Den GAMLE, ANONYME MÅL-SJEKKEN ER RYDDET BORT ----------
-- Regresjonsvakten for produksjonsfeilen etter PR 3A: `memberships_check` og
-- `share_invites_check` (PostgreSQL-navn på `check (num_nonnulls(universe_id,
-- group_id, card_id) = 1)` i den opprinnelige `create table`) kjenner ikke
-- notatnivåene. Står de igjen, avvises HVER medlemskapsrad for en bokhylle —
-- og migreringen stopper midt i backfillen, slik den gjorde i produksjon.
reset role;
select public.t_check('ingen pensjonert card_id-mål-sjekk står igjen',
  (select count(*) from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname in ('memberships', 'share_invites')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%num_nonnulls%'
      and pg_get_constraintdef(con.oid) like '%card_id%') = 0);
select public.t_check('den nye mål-sjekken dekker alle fem delbare objektene',
  (select count(*) from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and con.conname in ('memberships_target_chk', 'share_invites_target_chk')
      and pg_get_constraintdef(con.oid)
          like '%num_nonnulls(universe_id, group_id, note_project_id, note_folder_id, note_id) = 1%') = 2);
-- Og den slipper faktisk igjennom en notatrad — beviset som ikke hviler på
-- hvordan sjekken er formulert.
select public.t_check('en medlemskapsrad på bokhyllenivå godtas av databasen',
  public.note_project_role(:'NP', :'O') = 'owner');
-- Listesiden er urørt: mål-sjekken avviser fortsatt en rad uten mål, og
-- listenivået er fortsatt stengt.
select public.t_fails('en medlemskapsrad HELT uten mål avvises fortsatt',
  format('insert into public.memberships (user_id, role) values (%L, ''member'')', :'X'));
select public.t_fails('en medlemskapsrad med TO mål avvises fortsatt',
  format('insert into public.memberships (user_id, universe_id, group_id, role) values (%L, %L, %L, ''member'')',
         :'X', :'U', :'G1'));

-- ---------- 5d. Eksisterende notatdata fikk eierrolle av backfillen ----------
-- Bokhyllen fantes FØR PR 3A og hadde ingen medlemskapsrad. RLS-en på
-- notatsiden spør utelukkende `memberships`, så uten denne backfillen ville
-- eieren mistet sin egen bokhylle av syne i det de nye policyene ble
-- installert.
select public.t_check('bokhyllens oppretter ble bokhylleeier',
  public.note_project_role(:'NP', :'O') = 'owner'
  and public.note_project_owner_count(:'NP') = 1);
select public.t_check('notatboken og notatene fikk INGEN egne rader …',
  public.note_folder_role(:'NF', :'O') is null
  and public.note_role(:'N1', :'O') is null
  and public.note_role(:'N2', :'O') is null);
select public.t_check('… men arver eierskapet fra bokhyllen',
  public.is_note_folder_owner(:'NF', :'O')
  and public.is_note_owner(:'N1', :'O')
  and public.is_note_owner(:'N2', :'O'));
select public.t_check('ingen andre fikk tilgang til bokhyllen',
  not public.can_read_note_project(:'NP', :'M')
  and not public.can_read_note(:'N1', :'X'));

-- Gjennom de NYE rettighetsfunksjonene og RLS-modellen, som eieren selv.
reset role; select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_check('eieren LESER bokhylle, notatbok og begge notatene gjennom RLS',
  (select count(*) from public.note_projects where id = :'NP') = 1
  and (select count(*) from public.note_folders where id = :'NF') = 1
  and (select count(*) from public.notes where id in (:'N1', :'N2')) = 2);
select public.t_check('capability-funksjonene sier at eieren kan redigere alle tre nivåene',
  public.can_edit_content('note_project', :'NP', :'O')
  and public.can_edit_content('note_folder', :'NF', :'O')
  and public.can_edit_content('note', :'N1', :'O')
  and public.can_edit_content('note', :'N2', :'O'));
update public.note_projects set name = 'Bokhylla etter migrering', ts = 1 where id = :'NP';
update public.note_folders  set name = 'Notatboka etter migrering', ts = 1 where id = :'NF';
update public.notes set title = 'Notatet etter migrering', ts = 1 where id = :'N1';
select public.t_check('… og skrivingen gikk faktisk gjennom',
  (select name  from public.note_projects where id = :'NP') = 'Bokhylla etter migrering'
  and (select name  from public.note_folders where id = :'NF') = 'Notatboka etter migrering'
  and (select title from public.notes where id = :'N1') = 'Notatet etter migrering');
select public.t_check('eieren kan invitere til bokhyllen med den nye modellen',
  public.can_invite_to('note_project', :'NP', :'O')
  and public.can_delete_object('note_project', :'NP', :'O'));

-- ---------- 6. Idempotens ----------
-- users-and-sharing.sql er allerede kjørt to ganger av run-tests.sh; her
-- kontrollerer vi at det ikke ble duplikater av noe slag.
reset role;
select public.t_check('ingen dupliserte roller etter dobbel kjøring',
  (select count(*) from (
     select user_id, coalesce(universe_id::text, group_id::text,
                              note_project_id::text, note_folder_id::text, note_id::text) k,
            count(*) n
       from public.memberships group by 1, 2 having count(*) > 1) d) = 0);
select public.t_check('bokhylle-backfillen ga NØYAKTIG én rad etter dobbel kjøring',
  (select count(*) from public.memberships where note_project_id = :'NP'::uuid) = 1
  and (select count(*) from public.memberships
        where note_folder_id is not null or note_id is not null) = 0);
select public.t_check('ingen dupliserte mapper etter dobbel kjøring',
  (select count(*) from public.groups where universe_id = :'U' and name = 'Y-lista') = 1
  and (select count(*) from public.groups where universe_id = :'U') = 5);

select 'ALLE MIGRERINGSTESTER FOR LISTEDELING GRØNNE' as resultat;
