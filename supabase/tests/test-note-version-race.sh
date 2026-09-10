#!/usr/bin/env bash
# ============================================================
# SAMTIDIGHET: to enheter som tar bilde av det SAMME notatet samtidig skal
# ende med ÉTT bilde, ikke to like.
#
# Resten av SQL-suiten kjører i ÉN databaseøkt, og en enkelt økt kan ikke vise
# det som er farlig her. `note_version_save()` avviser en dublett ved å
# sammenligne fingeravtrykket mot det FERSKESTE bildet — men «det ferskeste» er
# ikke en fast størrelse under samtidighet:
#
#   A  leser «ferskeste bilde» (ingen), regner fingeravtrykk
#   B  leser «ferskeste bilde» (ingen — A har ikke committet), regner det samme
#   A  setter inn sin rad og committer
#   B  setter inn SIN rad og committer   ← to like bilder
#
# Id-en er klientgenerert, så `on conflict (id) do nothing` fanger dem ikke, og
# uttynningen lar dem stå: den siste timen er unntatt. Og det er nettopp når to
# har det samme notatet åpent at det skjer — altså akkurat det historikken
# finnes for.
#
# `note_version_save()` tar derfor en RÅDGIVENDE lås på notatet
# (`pg_advisory_xact_lock`) før den leser «det ferskeste». Den varer
# transaksjonen ut, så lesingen og innsettingen hører sammen. Låsen er
# rådgivende og ikke en radlås på `notes`, slik at den ikke kommer i veien for
# innholdsskrivingene.
#
# Testen kjører kappløpet i begge rekkefølger, og krever ÉN rad hver gang.
# Deretter: to ULIKE tilstander samtidig skal fortsatt gi to rader — låsen skal
# serialisere, ikke svelge.
#
# SAMME SLAG KAPPLØP GJELDER TAKET PÅ MERKEDE BILDER. Taket er en TELLING, og
# en telling uten lås kan to kall passere samtidig: med ett merke igjen kan
# begge se «det er plass» og ende ett over. Låsen tas derfor FØR tellingen i
# `note_version_save()`, og `note_version_pin()` tar den samme. Scenario 4 og 5
# kjører de to veiene inn — to merkinger, og én merking mot ett nytt merket
# bilde.
#
# Kjøres av run-tests.sh mot den samme databasen som resten av suiten.
# Autoritativt for modellen: docs/notater-plan.md → «Historikk».
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet --no-psqlrc -t -A"

A='aaaa000c-0000-0000-0000-0000000000aa'
B='bbbb000c-0000-0000-0000-0000000000bb'
P='cccc000c-0000-0000-0000-000000000001'
N='cccc000c-0000-0000-0000-000000000002'
DOC='{"v":1,"blocks":[{"t":"p","c":[{"s":"Samme tilstand"}]}]}'
DOC2='{"v":1,"blocks":[{"t":"p","c":[{"s":"En annen tilstand"}]}]}'

feil() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "PASS: $1"; }

# Hvor mange bilder notatet har NÅ. Leses som eier, utenom RLS — testen skal se
# sannheten, ikke det klienten får se.
antall() { $PSQL -c "select count(*) from public.note_versions where note_id = '$N'"; }
tom()    { $PSQL >/dev/null -c "delete from public.note_versions where note_id = '$N'"; }

# Ett bilde, tatt som en av de to brukerne — nøyaktig kallet klienten gjør.
# `$1` = bruker, `$2` = dokument. Id-en er klientgenerert, som i appen.
bilde() {
  $PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$1', false);
                       set role authenticated;
                       select public.note_version_save('$N'::uuid, gen_random_uuid(),
                         'Felles notat', '$2'::jsonb, 'utdrag', 14, false)"
}

# Det samme, men i en transaksjon som holdes åpen en stund FØR den committer.
# Det er dette som gjør kappløpet reproduserbart i stedet for tilfeldig.
bilde_treigt() {
  $PSQL >/dev/null <<SQL
begin;
select set_config('request.jwt.claim.sub', '$1', false);
set local role authenticated;
select public.note_version_save('$N'::uuid, gen_random_uuid(),
  'Felles notat', '$2'::jsonb, 'utdrag', 14, false);
select pg_sleep(1.5);
commit;
SQL
}

# ---------- fikstur: A eier bokhyllen, B er redaktør ----------
$PSQL >/dev/null <<SQL
insert into auth.users (id, email) values
  ('$A', 'ver-race-a@example.com'), ('$B', 'ver-race-b@example.com')
on conflict (id) do nothing;
-- Fiksturen skal kunne kjøres om igjen mot den samme databasen. En sletting
-- legger igjen en GRAVSTEIN, og insert-vakten avviser da id-en for godt — så
-- gravsteinene må bort sammen med radene.
delete from public.note_projects where id = '$P';
delete from public.tombstones where resource_id in ('$P', '$N');
select set_config('request.jwt.claim.sub', '$A', false);
set role authenticated;
insert into public.note_projects (id, owner_id, name, ts, org, pos, pos_ts, pos_org)
  values ('$P', '$A', 'Kappløp', 1, 'a', 1, 1, 'a');
insert into public.notes (id, owner_id, project_id, title, body, ts, org, pos, pos_ts, pos_org)
  values ('$N', '$A', '$P', 'Felles notat', '$DOC'::jsonb, 1, 'a', 1, 1, 'a');
SQL
INV=$($PSQL -c "select set_config('request.jwt.claim.sub', '$A', false);
                set role authenticated;
                select public.create_share_invite('note_project', '$P'::uuid,
                  'ver-race-b@example.com') ->> 'id'" | tail -n 1)
[ -n "$INV" ] || feil "fiksturen fikk ikke laget en invitasjon"
$PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$B', false);
                     set role authenticated;
                     select public.accept_share_invite('$INV'::uuid)"
[ "$($PSQL -c "select public.can_edit_content('note', '$N'::uuid, '$B'::uuid)")" = "t" ] \
  || feil "fiksturen ga ikke B skriverett"

# ---------- 1. A er treig, B kommer inn mens A er uavklart ----------
tom
( bilde_treigt "$A" "$DOC" ) &
treig=$!
sleep 0.4
bilde "$B" "$DOC"
wait $treig
n=$(antall)
[ "$n" = "1" ] || feil "to samtidige bilder av samme tilstand ga $n rader (ventet 1)"
ok "A treig, B rask: ett bilde, ikke to  [rader=$n]"

# ---------- 2. Motsatt rekkefølge ----------
tom
( bilde_treigt "$B" "$DOC" ) &
treig=$!
sleep 0.4
bilde "$A" "$DOC"
wait $treig
n=$(antall)
[ "$n" = "1" ] || feil "omvendt rekkefølge ga $n rader (ventet 1)"
ok "B treig, A rask: fortsatt ett bilde  [rader=$n]"

# ---------- 3. Låsen serialiserer, den svelger ikke ----------
# To ULIKE tilstander samtidig er to reelle bilder, og begge skal stå.
tom
( bilde_treigt "$A" "$DOC" ) &
treig=$!
sleep 0.4
bilde "$B" "$DOC2"
wait $treig
n=$(antall)
[ "$n" = "2" ] || feil "to ULIKE tilstander ga $n rader (ventet 2)"
ok "to ulike tilstander samtidig gir to bilder — låsen serialiserer, den svelger ikke  [rader=$n]"

# ---------- 4. Taket på merker: to MERKINGER samtidig ----------
# Fyll opp til ETT under taket, og la to bilder bli merket i det samme
# øyeblikket. Uten låsen ser begge «det er plass», og notatet ender ett over.
tom
TAK=$($PSQL -c "select public.note_versions_pin_max()")
$PSQL >/dev/null -c "insert into public.note_versions
    (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned)
  select gen_random_uuid(), '$N', '$A', 'fyll', jsonb_build_object('n', i),
         '', i, 'fyll' || i, true
    from generate_series(1, $TAK - 1) i"
V1=$($PSQL -c "insert into public.note_versions
    (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned)
  values (gen_random_uuid(), '$N', '$A', 'kandidat', '{\"n\":101}'::jsonb, '', 1, 'k1', false)
  returning id")
V2=$($PSQL -c "insert into public.note_versions
    (id, note_id, author_id, title, doc, excerpt, chars, fingerprint, pinned)
  values (gen_random_uuid(), '$N', '$A', 'kandidat', '{\"n\":102}'::jsonb, '', 1, 'k2', false)
  returning id")

# Én merking holdes åpen; den andre kommer inn mens den er uavklart.
(
  $PSQL >/dev/null <<SQL || true
begin;
select set_config('request.jwt.claim.sub', '$A', false);
set local role authenticated;
select public.note_version_pin('$N'::uuid, '$V1'::uuid, true);
select pg_sleep(1.5);
commit;
SQL
) &
treig=$!
sleep 0.4
$PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$B', false);
                     set role authenticated;
                     select public.note_version_pin('$N'::uuid, '$V2'::uuid, true)" 2>/dev/null || true
wait $treig
merket=$($PSQL -c "select count(*) from public.note_versions where note_id = '$N' and pinned")
[ "$merket" = "$TAK" ] || feil "to samtidige merkinger på grensen ga $merket merker (taket er $TAK)"
ok "to samtidige merkinger på grensen bryter ikke taket  [merker=$merket av $TAK]"

# ---------- 5. Én merking mot ett NYTT merket bilde ----------
# Den andre veien inn til den samme tellingen: `note_version_pin` mot
# `note_version_save(..., pinned = true)`. Ett merke tas AV først, slik at det
# igjen er nøyaktig én ledig plass — det er grensen som skal testes.
$PSQL >/dev/null -c "update public.note_versions set pinned = false
                      where id = (select id from public.note_versions
                                   where note_id = '$N' and pinned and title = 'fyll'
                                   order by fingerprint limit 1)"
$PSQL >/dev/null -c "update public.note_versions set pinned = false
                      where note_id = '$N' and id = '$V2'"
[ "$($PSQL -c "select count(*) from public.note_versions where note_id = '$N' and pinned")" = "$((TAK - 1))" ] \
  || feil "oppsettet til scenario 5 traff ikke grensen"
# Den ene av de to SKAL avvises — det er nettopp taket som virker — så
# feilmeldingen dempes her og påstanden ligger på tellingen etterpå.
(
  $PSQL >/dev/null 2>&1 <<SQL || true
begin;
select set_config('request.jwt.claim.sub', '$A', false);
set local role authenticated;
select public.note_version_pin('$N'::uuid, '$V2'::uuid, true);
select pg_sleep(1.5);
commit;
SQL
) &
treig=$!
sleep 0.4
$PSQL >/dev/null -c "select set_config('request.jwt.claim.sub', '$B', false);
                     set role authenticated;
                     select public.note_version_save('$N'::uuid, gen_random_uuid(),
                       'Felles notat', '{\"v\":1,\"n\":999}'::jsonb, 'utdrag', 3, true)" 2>/dev/null || true
wait $treig
merket=$($PSQL -c "select count(*) from public.note_versions where note_id = '$N' and pinned")
[ "$merket" = "$TAK" ] || feil "merking mot nytt merket bilde ga $merket merker (taket er $TAK)"
ok "merking mot et nytt merket bilde bryter heller ikke taket  [merker=$merket av $TAK]"

# Radene blir stående: hver runde av suiten starter på et ferskt skjema, og en
# sletting her ville bare lagt igjen en gravstein til neste kjøring.
echo "──────── test-note-version-race.sh: alle grønne ────────"
