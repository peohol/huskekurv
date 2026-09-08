#!/usr/bin/env bash
# Kjører SQL-testsuiten for users-and-sharing.sql mot en LOKAL PostgreSQL.
# Forutsetter en kjørende server og en tom testdatabase, f.eks.:
#   initdb -D /tmp/hkpg/data -U postgres --auth=trust
#   pg_ctl -D /tmp/hkpg/data -o "-p 5433 -k /tmp/hkpg" start
#   psql -h /tmp/hkpg -p 5433 -U postgres -c 'create database hk_test'
# Bruk:  PGHOST=/tmp/hkpg PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test ./run-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="psql -X -v ON_ERROR_STOP=1 --quiet"

fresh_schema() {
  $PSQL -c 'drop schema if exists public cascade; create schema public;
            grant usage on schema public to public;
            drop schema if exists auth cascade;'
  $PSQL -f tests/local-stub.sql
}

# ---- 1. Vanlig løp: nytt skjema, migreringen kjørt to ganger (idempotens) ----
fresh_schema
$PSQL -f users-and-sharing.sql
$PSQL -f users-and-sharing.sql   # idempotens: må tåle re-kjøring
$PSQL --no-psqlrc --echo-errors -f tests/test-users-and-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-roles-and-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-group-moves.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-email-sharing.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-tombstones.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-ideas.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-notes.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-note-links.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-account-deletion.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-notifications.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-push.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-sessions.sql
$PSQL --no-psqlrc --echo-errors -f tests/test-native-notif.sql

# Låsen i push_subscribe() kan ikke bevises fra ÉN databaseøkt: den handler om
# to samtidige. Denne kjører fornyelse og «slå av» mot hverandre i begge
# rekkefølger, med to ekte tilkoblinger.
tests/test-push-race.sh

# Smoke-testen som produksjonsdeployen henger på (release.yml) må bevises her:
# den skal være GRØNN mot et ferdig migrert skjema. Er den det ikke lokalt,
# blokkerer den deployen i produksjon uten at noe faktisk er galt.
$PSQL --no-psqlrc --echo-errors -f smoke-test.sql

# ---- 2. Oppgraderingsløp: den GAMLE databasefasongen med data, migrert ----
fresh_schema
$PSQL -f tests/legacy-share-fixture.sql
$PSQL -f users-and-sharing.sql
$PSQL -f users-and-sharing.sql   # idempotens også på migreringen av gamle data
$PSQL --no-psqlrc --echo-errors -f tests/test-list-share-migration.sql
# Også en oppgradert gammel database må tilfredsstille deploy-kontrakten.
$PSQL --no-psqlrc --echo-errors -f smoke-test.sql

echo "✅ Alle SQL-tester grønne (roller, capabilities, mappeflytting, e-postvarsel,"
echo "   gravsteiner, idéer, notater, arkiv og koblinger, kontosletting, varsler,"
echo "   web push (òg samtidighet), økter,"
echo "   native varselenheter,"
echo "   migrering av gamle listedelinger og deploy-smoke-testen — begge løp)."
