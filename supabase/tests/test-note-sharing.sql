-- ============================================================
-- Testsuite for DELING AV NOTATER (docs/rettigheter-og-deling.md del 14,
-- docs/notater-plan.md). Kjøres mot en LOKAL PostgreSQL med
-- tests/local-stub.sql + users-and-sharing.sql lastet først. Se run-tests.sh.
--
-- Notatsiden har nå den SAMME rettighetsmodellen som områder og mapper —
-- roller i `memberships`, invitasjoner i `share_invites`, capabilities regnet
-- ut på serveren — men den kan deles på ALLE TRE nivåene. Testen dekker
-- nettopp det som skiller den:
--
--   1. rollen oppretteren får, og at bokhylleeieren er dynamisk supereier
--   2. deling på hvert av de tre nivåene, og at arven bare går NEDOVER
--   3. eier / redaktør / ren leser (låsen er det som lager leseren)
--   4. hvem som kan slette, arkivere, gjenopprette og dele videre
--   5. flytting mellom foreldre med ulike delingsforhold — og at en GODKJENT
--      flytting ikke blir rullet tilbake av søsken-vakten etterpå
--   6. tilbakekalling, og at ingen skjult tilgang blir stående igjen
--   7. uautorisert SELECT/INSERT/UPDATE/DELETE fra en rå klient
--   8. koblinger på tvers av delt og privat innhold
--   9. permanent sletting, gravsteiner og kontosletting
--
-- Fire brukere:
--   A = eier bokhyllen
--   B = medlem (redaktør) av bokhyllen
--   C = får ett enkelt NOTAT delt direkte — og skal ikke se noe annet
--   D = får en NOTATBOK delt direkte — og skal ikke se bokhyllen
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

\set A 'aa000000-5555-0000-0000-0000000000a1'
\set B 'bb000000-5555-0000-0000-0000000000b1'
\set C 'cc000000-5555-0000-0000-0000000000c1'
\set D 'dd000000-5555-0000-0000-0000000000d1'
-- P = bokhylle (A), F = notatbok i P, N1 = notat i F, N2 = fritt notat i P.
\set P  '75000000-5555-0000-0000-000000000001'
\set F  '75000000-5555-0000-0000-000000000002'
\set N1 '75000000-5555-0000-0000-000000000003'
\set N2 '75000000-5555-0000-0000-000000000004'
-- P2 = As andre, PRIVATE bokhylle; F2/N3 = innholdet der.
\set P2 '75000000-5555-0000-0000-000000000005'
\set F2 '75000000-5555-0000-0000-000000000006'
\set N3 '75000000-5555-0000-0000-000000000007'
-- CP = Cs egen bokhylle; U/G/L = As listeside (for koblingene).
\set CP '75000000-5555-0000-0000-000000000008'
\set U  '75000000-5555-0000-0000-00000000000a'
\set G  '75000000-5555-0000-0000-00000000000b'
\set L  '75000000-5555-0000-0000-00000000000c'
\set N4 '75000000-5555-0000-0000-00000000000d'
-- DP = Ds egen bokhylle; F3/N5 = det D eier DIREKTE under As bokhylle.
\set DP '75000000-5555-0000-0000-00000000000e'
\set F3 '75000000-5555-0000-0000-00000000000f'
\set N5 '75000000-5555-0000-0000-000000000010'
\set DP2 '75000000-5555-0000-0000-000000000011'

insert into auth.users (id, email) values
  (:'A', 'del-a@example.com'), (:'B', 'del-b@example.com'),
  (:'C', 'del-c@example.com'), (:'D', 'del-d@example.com')
on conflict (id) do nothing;

-- ---------- 1. Oppretteren får eierrollen; arven går nedover ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'P', :'A', 'Felles bokhylle', 1, 'a', 1, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'F', :'A', :'P', 'Metode', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'N1', :'A', :'P', :'F', 'Utvalg', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'N2', :'A', :'P', 'Løse tanker', 1, 'a', 2, 1, 'a');
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'P2', :'A', 'Privat bokhylle', 1, 'a', 2, 1, 'a');
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'F2', :'A', :'P2', 'Privat notatbok', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, folder_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'N3', :'A', :'P2', :'F2', 'Privat notat', 1, 'a', 1, 1, 'a');

select public.t_check('oppretteren av en bokhylle får rollen owner',
  public.note_project_role(:'P', :'A') = 'owner'
  and public.note_project_owner_count(:'P') = 1);
select public.t_check('bokhylleeieren er dynamisk eier av notatbok og notat uten egne rader',
  public.is_note_folder_owner(:'F', :'A') and public.note_folder_role(:'F', :'A') is null
  and public.is_note_owner(:'N1', :'A') and public.note_role(:'N1', :'A') is null);
select public.t_check('en konto som jobber alene får ÉN rolle-rad per bokhylle, ikke én per notat',
  (select count(*) from public.memberships where user_id = :'A') = 2);

-- ---------- 2. Deling på bokhyllenivå: B blir redaktør ----------
select public.create_share_invite('note_project', :'P', 'del-b@example.com') ->> 'id' as inv_b \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b'::uuid);

select public.t_check('B ser hele den delte bokhyllen — men ikke den private',
  (select count(*) from public.note_projects) = 1
  and (select count(*) from public.note_folders) = 1
  and (select count(*) from public.notes) = 2);
select public.t_check('B kan redigere innholdet (åpen bokhylle = redaktør)',
  public.can_edit_content('note', :'N1', :'B')
  and public.can_edit_content('note_folder', :'F', :'B'));
update public.notes set title = 'Utvalg (rettet av B)', ts = 10, org = 'b' where id = :'N1';
select public.t_check('… og skrivingen står',
  (select title from public.notes where id = :'N1') = 'Utvalg (rettet av B)');
select public.t_check('B kan opprette en notatbok i den delte bokhyllen',
  public.can_create_child('note_project', :'P', :'B'));
select public.t_check('B kan IKKE slette bokhyllen for alle',
  not public.can_delete_object('note_project', :'P', :'B'));
select public.t_check('B kan slette en åpen notatbok/notat for alle (arvet medlemskap)',
  public.can_delete_object('note_folder', :'F', :'B')
  and public.can_delete_object('note', :'N1', :'B'));

-- ---------- 3. Ren leser: låsen er mekanismen ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_locked('note_project', :'P', true);
select public.t_check('A (eier) rammes aldri av sin egen lås',
  public.can_edit_content('note_project', :'P', :'A')
  and public.can_edit_content('note', :'N1', :'A'));
select public.t_check('B er nå en REN LESER: kan lese, ikke redigere',
  public.can_read('note', :'N1', :'B')
  and not public.can_edit_content('note', :'N1', :'B')
  and not public.can_create_child('note_project', :'P', :'B')
  and not public.can_delete_object('note', :'N1', :'B'));
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
update public.notes set title = 'B prøver igjen', ts = 20, org = 'b' where id = :'N1';
select public.t_check('en låst rad ruller tilbake skrivingen fra en leser',
  (select title from public.notes where id = :'N1') = 'Utvalg (rettet av B)');
-- RLS gjør den låste raden uskrivbar for leseren: UPDATE treffer null rader i
-- stedet for å kaste. Beviset er at flagget står uendret etterpå.
update public.notes set trashed = true, ts = 21, org = 'b' where id = :'N1';
select public.t_check('en leser kan ikke legge notatet i søppelkassen',
  (select trashed from public.notes where id = :'N1') = false);
select public.t_fails('en leser kan ikke opprette et notat i den låste bokhyllen',
  format('insert into public.notes (id, owner_id, project_id, title, ts, org) values (%L, %L, ''snik'', 1, ''b'')',
         '75000000-5555-0000-0000-0000000000ee', :'B'));

-- Et UNNTAK på én notatbok åpner nettopp den grenen igjen.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.set_unlocked('note_folder', :'F', true);
select public.t_check('et unntak på notatboken gjør leseren til redaktør igjen — der',
  public.can_edit_content('note', :'N1', :'B')
  and not public.can_edit_content('note', :'N2', :'B'));
select public.set_unlocked('note_folder', :'F', false);
select public.set_locked('note_project', :'P', false);
select public.t_check('låsen er borte igjen',
  not public.is_effectively_locked('note', :'N1'));

-- ---------- 4. Deling på NOTAT-nivå: C ser ett notat og ikke noe mer ----------
select public.create_share_invite('note', :'N1', 'del-c@example.com') ->> 'id' as inv_c \gset
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c'::uuid);

select public.t_check('C ser NØYAKTIG ett notat',
  (select count(*) from public.notes) = 1
  and (select id from public.notes) = :'N1'::uuid);
select public.t_check('C ser verken notatboken eller bokhyllen (ingen metadata-lekkasje)',
  (select count(*) from public.note_folders) = 0
  and (select count(*) from public.note_projects) = 0);
select public.t_check('C står som FRITT notat i doc-et (ingen forelder å vise det i)',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'notes') x
    where x ->> 'id' = :'N1') = true);
select public.t_check('C kan redigere notatet, men ikke slette det for alle',
  public.can_edit_content('note', :'N1', :'C')
  and not public.can_delete_object('note', :'N1', :'C'));
select public.t_fails('C kan ikke slette notatet for alle',
  format('update public.notes set trashed = true, ts = 30, org = ''c'' where id = %L', :'N1'));
select public.t_check('C kan forlate notatet (den direkte rollen er eneste vei inn)',
  public.can_leave('note', :'N1', :'C'));
select public.t_fails('C kan ikke lage et notat i As bokhylle',
  format('insert into public.notes (id, owner_id, project_id, title, ts, org) values (%L, %L, %L, ''snik'', 1, ''c'')',
         '75000000-5555-0000-0000-0000000000ef', :'C', :'P'));
select public.t_fails('C kan ikke hekte sin egen notatbok inn i As bokhylle',
  format('insert into public.note_folders (id, owner_id, project_id, name, ts, org) values (%L, %L, %L, ''snik'', 1, ''c'')',
         '75000000-5555-0000-0000-0000000000f0', :'C', :'P'));

-- ---------- 5. Deling på NOTATBOK-nivå: D ser notatboken, ikke bokhyllen ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('note_folder', :'F', 'del-d@example.com', 'owner') ->> 'id' as inv_d \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d'::uuid);

select public.t_check('D ser notatboken og notatet i den, men ikke bokhyllen',
  (select count(*) from public.note_folders) = 1
  and (select count(*) from public.notes) = 1
  and (select count(*) from public.note_projects) = 0);
select public.t_check('D sin notatbok er FRI i doc-et (bokhyllen er ikke lesbar)',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'noteFolders') x
    where x ->> 'id' = :'F') = true);
select public.t_check('… og notatet under den er IKKE fritt (notatboken er lesbar)',
  (select (x -> 'free')::boolean from jsonb_array_elements(public.get_my_doc() -> 'notes') x
    where x ->> 'id' = :'N1') = false);
select public.t_check('D er eksplisitt notatbokeier og kan dele videre',
  public.is_note_folder_owner(:'F', :'D')
  and public.can_invite_owner('note_folder', :'F', :'D')
  and public.can_manage_members('note_folder', :'F', :'D'));
select public.t_check('D kan IKKE slette notatboken for alle (rent direkte eierskap er ikke arv)',
  public.can_delete_object('note_folder', :'F', :'D'));
select public.t_fails('D kan ikke invitere til bokhyllen hen ikke ser',
  format('select public.create_share_invite(''note_project'', %L, ''del-c@example.com'')', :'P'));

-- Medlemslisten på notatboken: presedens og arv.
select public.t_check('notatbokens medlemsliste har bokhylleeier, bokhyllemedlem og D',
  (select count(*) from jsonb_array_elements(public.get_members('note_folder', :'F') -> 'members')) = 3
  and (select m ->> 'category' from jsonb_array_elements(public.get_members('note_folder', :'F') -> 'members') m
        where m ->> 'id' = :'A') = 'noteProjectOwner'
  and (select m ->> 'category' from jsonb_array_elements(public.get_members('note_folder', :'F') -> 'members') m
        where m ->> 'id' = :'B') = 'noteProjectMember'
  and (select m ->> 'category' from jsonb_array_elements(public.get_members('note_folder', :'F') -> 'members') m
        where m ->> 'id' = :'D') = 'noteFolderOwner');
select public.t_check('arvede bokhyllefolk kan ikke fjernes fra notatboken',
  (select (m -> 'removable')::boolean from jsonb_array_elements(public.get_members('note_folder', :'F') -> 'members') m
    where m ->> 'id' = :'B') = false
  and (select m ->> 'removeHintCode' from jsonb_array_elements(public.get_members('note_folder', :'F') -> 'members') m
    where m ->> 'id' = :'B') = 'inherited');
select public.t_check('notatets medlemsliste har alle fire, uten dubletter',
  (select count(*) from jsonb_array_elements(public.get_members('note', :'N1') -> 'members')) = 4
  and (select count(distinct m ->> 'id') from jsonb_array_elements(public.get_members('note', :'N1') -> 'members') m) = 4
  and (select m ->> 'category' from jsonb_array_elements(public.get_members('note', :'N1') -> 'members') m
        where m ->> 'id' = :'C') = 'noteMember');

-- ---------- 6. Flytting mellom foreldre med ulike delingsforhold ----------
-- A flytter den delte notatboken inn i sin PRIVATE bokhylle: tilgangen regnes
-- om fra den nye forelderen. B (som bare arvet fra den delte bokhyllen) mister
-- den; D beholder sin DIREKTE rolle. Ingenting slettes og ingen id-er endres.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
update public.note_folders set project_id = :'P2', pos_ts = 50, pos_org = 'a' where id = :'F';
select public.t_check('notatboken står i den private bokhyllen nå',
  (select project_id from public.note_folders where id = :'F') = :'P2'::uuid);
select public.t_check('notatet fulgte med (kaskaden holder invarianten)',
  (select project_id from public.notes where id = :'N1') = :'P2'::uuid);
select public.t_check('B mistet den arvede tilgangen til notatboken',
  not public.can_read('note_folder', :'F', :'B')
  and not public.can_read('note', :'N1', :'B'));
select public.t_check('D beholdt sin DIREKTE rolle, og C sin direkte rolle på notatet',
  public.can_read('note_folder', :'F', :'D')
  and public.can_read('note', :'N1', :'C'));
select public.t_check('ingen rader forsvant av flyttingen',
  (select count(*) from public.note_folders where id = :'F') = 1
  and (select count(*) from public.notes where id = :'N1') = 1);
-- … og tilbake igjen.
update public.note_folders set project_id = :'P', pos_ts = 51, pos_org = 'a' where id = :'F';
select public.t_check('B fikk den arvede tilgangen tilbake da notatboken kom tilbake',
  public.can_read('note', :'N1', :'B'));

-- En bruker uten rettigheter i MÅLET kan ikke flytte dit.
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.t_fails('D kan ikke flytte notatboken inn i en bokhylle hen ikke ser',
  format('update public.note_folders set project_id = %L, pos_ts = 60, pos_org = ''d'' where id = %L', :'P2', :'F'));

/* … men til et MÅL hen har rett i, skal flyttingen faktisk STÅ.
   Det er ikke det samme spørsmålet som «kan D ordne rekkefølgen der objektet
   står nå»: en direkte notatbok-/notateier som ikke ser bokhyllen over har med
   rette NEI på det siste. Vakten må derfor skille de to — ellers blir en
   godkjent flytting stille rullet tilbake av søsken-vakten rett etterpå, og
   eieren sitter fast i en forelder hen ikke ser. */
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.note_folders (id, owner_id, project_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'F3', :'A', :'P', 'Ds notatbok', 1, 'a', 5, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'N5', :'A', :'P', 'Ds notat', 1, 'a', 6, 1, 'a');
select public.create_share_invite('note_folder', :'F3', 'del-d@example.com', 'owner') ->> 'id' as inv_d2 \gset
select public.create_share_invite('note', :'N5', 'del-d@example.com', 'owner') ->> 'id' as inv_d3 \gset
reset role; select set_config('request.jwt.claim.sub', :'D', false); set role authenticated;
select public.accept_share_invite(:'inv_d2'::uuid);
select public.accept_share_invite(:'inv_d3'::uuid);
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'DP', :'D', 'Ds bokhylle', 1, 'd', 1, 1, 'd');
select public.t_check('D er direkte eier, men får IKKE ordne rekkefølgen i bokhyllen over',
  public.is_note_folder_owner(:'F3', :'D') and public.is_note_owner(:'N5', :'D')
  and not public.can_reorder_in_parent('note_folder', :'F3', :'D')
  and not public.can_reorder_in_parent('note', :'N5', :'D'));
update public.note_folders set pos = 99, pos_ts = 70, pos_org = 'd' where id = :'F3';
update public.notes set pos = 99, pos_ts = 70, pos_org = 'd' where id = :'N5';
select public.t_check('… så en REN omrokkering blir stille rullet tilbake',
  (select pos from public.note_folders where id = :'F3') = 5
  and (select pos from public.notes where id = :'N5') = 6);
update public.note_folders set project_id = :'DP', pos = 3, pos_ts = 71, pos_org = 'd' where id = :'F3';
select public.t_check('… men FLYTTINGEN til hens egen bokhylle står, med den nye plasseringen',
  (select project_id from public.note_folders where id = :'F3') = :'DP'::uuid
  and (select pos from public.note_folders where id = :'F3') = 3);
update public.notes set project_id = :'DP', pos = 4, pos_ts = 72, pos_org = 'd' where id = :'N5';
select public.t_check('… og et direkte eid NOTAT flyttes på samme vis',
  (select project_id from public.notes where id = :'N5') = :'DP'::uuid
  and (select pos from public.notes where id = :'N5') = 4);
/* Registeret gjelder fortsatt for en flytting: unntaket over sier bare at
   MYNDIGHET til å flytte er et annet spørsmål enn myndighet til å ordne
   rekkefølgen — ikke at en gammel skriving plutselig vinner. D har rett i
   begge bokhyllene sine, så her er registeret det eneste som avgjør. */
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'DP2', :'D', 'Ds andre bokhylle', 1, 'd', 2, 1, 'd');
update public.notes set project_id = :'DP2', pos = 7, pos_ts = 50, pos_org = 'd' where id = :'N5';
select public.t_check('… en flytting med ELDRE register rulles tilbake',
  (select project_id from public.notes where id = :'N5') = :'DP'::uuid
  and (select pos from public.notes where id = :'N5') = 4);
update public.notes set project_id = :'DP2', pos = 7, pos_ts = 73, pos_org = 'd' where id = :'N5';
select public.t_check('… og med NYERE register står den',
  (select project_id from public.notes where id = :'N5') = :'DP2'::uuid);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('A mistet den arvede tilgangen da D flyttet dem ut',
  not public.can_read('note_folder', :'F3', :'A')
  and not public.can_read('note', :'N5', :'A'));

-- ---------- 7. Uautoriserte skrivinger fra en rå klient ----------
select public.t_fails('D kan ikke skrive en rolle direkte inn i memberships',
  format('insert into public.memberships (user_id, note_project_id, role) values (%L, %L, ''owner'')', :'D', :'P'));
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_fails('C kan ikke løfte seg selv til eier med en rå oppdatering',
  format('update public.memberships set role = ''owner'' where user_id = %L and note_id = %L', :'C', :'N1'));
select public.t_fails('C kan ikke flytte medlemskapsraden sin over på et annet notat',
  format('update public.memberships set note_id = %L where user_id = %L and note_id = %L', :'N2', :'C', :'N1'));
delete from public.notes where id = :'N2';
select public.t_check('C kan ikke slette et notat hen ikke ser',
  (select count(*) from public.notes n where n.id = :'N2') = 0);   -- usynlig for C
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('… og notatet står fortsatt for A',
  (select count(*) from public.notes where id = :'N2') = 1);
select public.t_fails('ingen kan endre oppretteren på en notatrad',
  format('update public.notes set owner_id = %L, ts = 70, org = ''a'' where id = %L', :'C', :'N1'));

-- ---------- 8. Koblinger på tvers av delt og privat ----------
insert into public.universes (id, owner_id, name, ts, org, pos) values (:'U', :'A', 'A-område', 1, 'a', 1);
insert into public.groups (id, owner_id, universe_id, name, ts, org) values (:'G', :'A', :'U', 'A-mappe', 1, 'a');
insert into public.cards (id, owner_id, group_id, title, ts, org) values (:'L', :'A', :'G', 'A-liste', 1, 'a');
insert into public.object_links (id, owner_id, note_id, card_id, ts, org)
  values ('75000000-5555-0000-0000-0000000000c9', :'A', :'N1', :'L', 1, 'a');
select public.t_check('A kan koble sitt notat til sin egen liste',
  (select count(*) from public.object_links) = 1);

reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('C ser IKKE As kobling — koblinger er den enkeltes egne',
  (select count(*) from public.object_links) = 0);
select public.t_fails('C kan ikke koble det delte notatet til en liste hen ikke ser',
  format('insert into public.object_links (id, owner_id, note_id, card_id, ts, org) values (%L, %L, %L, %L, 1, ''c'')',
         '75000000-5555-0000-0000-0000000000ca', :'C', :'N1', :'L'));
-- … men til sitt EGET innhold går det fint, og koblingen er hens alene.
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values (:'CP', :'C', 'C sin bokhylle', 1, 'c', 1, 1, 'c');
insert into public.universes (id, owner_id, name, ts, org, pos)
  values ('75000000-5555-0000-0000-0000000000cb', :'C', 'C-område', 1, 'c', 1);
insert into public.object_links (id, owner_id, note_id, universe_id, ts, org)
  values ('75000000-5555-0000-0000-0000000000cc', :'C', :'N1', '75000000-5555-0000-0000-0000000000cb', 1, 'c');
select public.t_check('C kan koble det DELTE notatet til sitt eget område',
  (select count(*) from public.object_links) = 1);

-- Mister C tilgangen til notatet, står koblingen igjen (den ødelegges ikke),
-- men den kan ikke åpnes. Kommer tilgangen tilbake, virker den igjen.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.revoke_share('note', :'N1', :'C');
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.t_check('C mistet notatet',
  (select count(*) from public.notes where id = :'N1') = 0);
select public.t_check('… men koblingen er IKKE borte (bare uåpnelig)',
  (select count(*) from public.object_links where owner_id = :'C') = 1);
select public.t_check('doc-et bærer fortsatt koblingen',
  (select count(*) from jsonb_array_elements(public.get_my_doc() -> 'links')) = 1);
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.create_share_invite('note', :'N1', 'del-c@example.com') ->> 'id' as inv_c2 \gset
reset role; select set_config('request.jwt.claim.sub', :'C', false); set role authenticated;
select public.accept_share_invite(:'inv_c2'::uuid);
select public.t_check('tilgangen tilbake → koblingen virker igjen',
  (select count(*) from public.notes where id = :'N1') = 1
  and (select count(*) from public.object_links where owner_id = :'C') = 1);

-- ---------- 9. Tilbakekalling rydder ALL underliggende tilgang ----------
-- B får i tillegg en direkte EIER-rolle på det frie notatet. (En ren
-- medlemsinvitasjon ville vært redundant og avvist — B har alt tilgang via
-- bokhyllen; et rolleløft er nettopp det som er gyldig.) Kastes B ut av
-- BOKHYLLEN, skal heller ikke notatrollen bli stående igjen som skjult tilgang.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_fails('en redundant MEDLEMS-invitasjon til det samme notatet avvises',
  format('select public.create_share_invite(''note'', %L, ''del-b@example.com'')', :'N2'));
select public.create_share_invite('note', :'N2', 'del-b@example.com', 'owner') ->> 'id' as inv_b2 \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b2'::uuid);
select public.t_check('B har nå både bokhyllerollen og en direkte notatrolle',
  public.note_project_role(:'P', :'B') = 'member'
  and public.note_role(:'N2', :'B') = 'owner');
select public.t_fails_with('B kan ikke forlate notatet så lenge bokhyllen gir tilgang', 'PT409',
  format('select public.leave_share(''note'', %L)', :'N2'));
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.revoke_share('note_project', :'P', :'B');
select public.t_check('utkastelsen fjernet BÅDE bokhyllerollen og den direkte notatrollen',
  public.note_project_role(:'P', :'B') is null
  and public.note_role(:'N2', :'B') is null);
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.t_check('B ser ingenting av As notater lenger',
  (select count(*) from public.note_projects) = 0
  and (select count(*) from public.notes) = 0);

-- Siste eier kan verken forlate eller degraderes.
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_fails_with('siste bokhylleeier kan ikke forlate', 'PT422',
  format('select public.leave_share(''note_project'', %L)', :'P'));
select public.t_fails('… og heller ikke degradere seg selv med rå SQL (rollen er RPC-enes)',
  format('update public.memberships set role = ''member'' where note_project_id = %L and user_id = %L', :'P', :'A'));
-- Grant-en er det ytterste laget: DELETE på memberships er trukket tilbake fra
-- `authenticated`, så en rå sletting stoppes før siste-eier-vakten trengs.
select public.t_fails('… og heller ikke slette rollen sin med en rå DELETE',
  format('delete from public.memberships where note_project_id = %L and user_id = %L', :'P', :'A'));
-- Vakten selv (PT422) treffer også en administrator som går utenom RPC-ene.
reset role;
select public.t_fails_with('siste-eier-vakten stopper også en rå sletting som eier-rollen', 'PT422',
  format('delete from public.memberships where note_project_id = %L and user_id = %L', :'P', :'A'));
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;

-- ---------- 10. Arkivering er INNHOLD, sletting er destruktivt ----------
select public.create_share_invite('note_project', :'P', 'del-b@example.com') ->> 'id' as inv_b3 \gset
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.accept_share_invite(:'inv_b3'::uuid);
update public.notes set archived = true, ts = 80, org = 'b' where id = :'N2';
select public.t_check('et medlem kan arkivere (reversibelt, ikke destruktivt)',
  (select archived from public.notes where id = :'N2') = true);
update public.notes set archived = false, ts = 81, org = 'b' where id = :'N2';
update public.notes set trashed = true, ts = 82, org = 'b' where id = :'N2';
select public.t_check('… og legge et ÅPENT notat i den felles søppelkassen',
  (select trashed from public.notes where id = :'N2') = true);
update public.notes set trashed = false, ts = 83, org = 'b' where id = :'N2';
select public.t_fails('men aldri slette selve bokhyllen',
  format('update public.note_projects set trashed = true, ts = 84, org = ''b'' where id = %L', :'P'));

-- ---------- 11. Permanent sletting: gravsteiner og koblingskaskade ----------
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
insert into public.notes (id, owner_id, project_id, title, ts, org, pos, pos_ts, pos_org)
  values (:'N4', :'A', :'P', 'Kortlevd', 1, 'a', 9, 1, 'a');
insert into public.object_links (id, owner_id, note_id, group_id, ts, org)
  values ('75000000-5555-0000-0000-0000000000cd', :'A', :'N4', :'G', 1, 'a');
delete from public.notes where id = :'N4';
select public.t_check('permanent sletting gravlegger notatet OG koblingen',
  (select count(*) from public.tombstones where resource_id = :'N4' and resource_type = 'note') = 1
  and (select count(*) from public.tombstones
        where resource_id = '75000000-5555-0000-0000-0000000000cd' and resource_type = 'object_link') = 1);
select public.t_fails_with('en utdatert klient kan ikke gjenopplive det gravlagte notatet', 'PT409',
  format('insert into public.notes (id, owner_id, project_id, title, ts, org) values (%L, %L, %L, ''gjenferd'', 9, ''a'')',
         :'N4', :'A', :'P'));
select public.t_check('rollerader for notatet forsvant med det',
  (select count(*) from public.memberships where note_id = :'N4') = 0);

-- ---------- 12. Kontosletting ----------
-- B er medlem (ikke eier) av As bokhylle. Sletter B kontoen sin, står
-- bokhyllen igjen — og As notater røres ikke.
reset role; select set_config('request.jwt.claim.sub', :'B', false); set role authenticated;
select public.delete_account();
reset role; select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.t_check('en medlems kontosletting lot bokhyllen og notatene stå',
  (select count(*) from public.note_projects where id = :'P') = 1
  and (select count(*) from public.notes where id = :'N1') = 1);
select public.t_check('… og fjernet bare rollen',
  (select count(*) from public.memberships where note_project_id = :'P') = 1);

-- A er ENESTE eier: sletter A kontoen, følger bokhyllen med — også for D og C,
-- som hadde direkte roller under den.
select public.delete_account();
reset role;
select public.t_check('eierens kontosletting tok bokhyllen, notatboken og notatene',
  (select count(*) from public.note_projects where id in (:'P', :'P2')) = 0
  and (select count(*) from public.note_folders where id in (:'F', :'F2')) = 0
  and (select count(*) from public.notes where id in (:'N1', :'N2', :'N3')) = 0);
select public.t_check('hver slettet rad fikk gravstein',
  (select count(*) from public.tombstones where resource_id = :'N1') = 1
  and (select count(*) from public.tombstones where resource_id = :'F') = 1
  and (select count(*) from public.tombstones where resource_id = :'P') = 1);
select public.t_check('Cs egen bokhylle overlevde',
  (select count(*) from public.note_projects where id = :'CP') = 1);
select public.t_check('Cs kobling til det slettede notatet forsvant med kaskaden',
  (select count(*) from public.object_links
    where id = '75000000-5555-0000-0000-0000000000cc') = 0);

\echo '✅ test-note-sharing.sql grønn'
