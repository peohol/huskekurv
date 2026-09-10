# CLAUDE.md — supabase/

`users-and-sharing.sql` ER databasen: tabeller, RLS-policyer, triggere, vakter
og RPC-er i én idempotent fil. Det finnes ingen migreringsmappe og ingen
versjonerte migreringsfiler — en endring gjøres på riktig sted i fila, og hele
fila kjøres på nytt. `setup.sql` pensjonerer den gamle v1-modellen og er også
idempotent.

`.github/workflows/release.yml` kjører begge filene mot produksjon ved hver push
til `main` — FØR frontenden publiseres, og med `smoke-test.sql` som port mellom
dem. Vercels git-deploy for `main` er slått av, så migrering og deploy kan ikke
kjøre parallelt. Hele rekkefølgen, inkludert feil/retry/rollback:
[`docs/release-og-deploy.md`](../docs/release-og-deploy.md).

## Regler

- **Idempotens er et krav.** `create or replace function`, `add column if not
  exists`, `drop policy if exists` før `create policy`. Testsuiten kjører fila
  to ganger for å bevise det, og workflowen prøver på nytt ved feil — begge
  deler forutsetter at re-kjøring er trygt.
- **Skjemaendringer skal være additive.** Databasen migreres mens den forrige
  klienten fortsatt kjører: nye kolonner må ha default eller være nullable, og
  en kolonne fjernes tidligst en runde etter at klienten sluttet å bruke den.
- **Skjemaet og klienten må følges ad.** Skriver klienten et felt som ikke
  finnes, avviser PostgREST hver skriving og synken stopper — legg
  skjemaendringen i SAMME PR som klientendringen som trenger den. Nye felter og
  RPC-er skal også inn i `smoke-test.sql`, som er porten produksjonsdeployen
  må gjennom; `tests/db-contract.test.js` feiler hvis du glemmer det.
- **Autorisasjon hører hjemme her.** Vurder RLS-policyer, `BEFORE UPDATE`-vakter,
  capability-funksjonene og RPC-ene som ett hele. En ny `security definer`-
  funksjon omgår RLS og må selv sjekke rettighetene.
- **Speil regelendringer i `mock-backend.js`** i samme endring — nettlesertestene
  kjører mot den, ikke mot ekte Supabase.
- **DDL kjører mot en levende database** som klientene poller hvert 5. sekund.
  Hold transaksjonene korte; unngå unødvendig tunge låser (workflowen setter
  `lock_timeout` og prøver på nytt, men en deadlock kan ellers etterlate
  produksjonen halvmigrert — smoke-testen fanger det og stopper deployen).
- Rettighetsmodellen er dokumentert i
  [`docs/rettigheter-og-deling.md`](../docs/rettigheter-og-deling.md)
  (autoritativ) og databasearkitekturen i
  [`docs/arkitektur-brukere-deling.md`](../docs/arkitektur-brukere-deling.md).
  Endrer du en regel, oppdater dokumentet i samme endring.

## Tester

`tests/run-tests.sh` kjører hele SQL-suiten mot en LOKAL PostgreSQL i tre løp:
nytt skjema, det gamle skjemaet med data migrert, og en HALVMIGRERT database
(`tests/partial-migration-fixture.sql`) som migreringen må kunne kjøres ferdig
fra — fila kjøres uten transaksjon rundt, så en feil midt i den etterlater alt
over feilpunktet committet. Kommandoene for å sette opp en midlertidig server
står øverst i skriptet; deretter:

```bash
PGHOST=/tmp/hkpg PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test \
  supabase/tests/run-tests.sh
```

`tests/local-stub.sql` stubber `auth`-skjemaet — inkludert `auth.sessions` og
`auth.refresh_tokens`, som øktlaget leser og sletter i — så fila kan kjøres helt
uten Supabase. En ny serverside-regel skal ha en ny sjekk i den testfilen som
dekker området (roller/deling, mappeflytting, gravsteiner, kontosletting,
e-postvarsel, varsler, web push, native varselenheter, innloggede økter,
samskrivingsloggen og historikken for notater, migrering av gamle
listedelinger, reparasjon av en halvmigrert database).

Én ting kan ikke bevises fra én databaseøkt: at to samtidige operasjoner på den
samme raden ikke kan passere hverandre. `tests/test-push-race.sh` kjører derfor
en automatisk push-fornyelse og et «slå av» mot hverandre med TO ekte
tilkoblinger, i begge rekkefølger — og det samme for den native kanalens
statusrunde mot «slå av varsler på alle andre enheter», som deler den samme
låsen fordi handlingen spenner over begge tabellene. `tests/test-note-version-race.sh`
gjør det samme for notathistorikken: to enheter som tar bilde av den samme
tilstanden samtidig skal ende med ett bilde, ikke to like. Legger du en lås
(`select … for update`, `pg_advisory_xact_lock`) et nytt sted, hører beviset
hjemme der — ikke i en `.sql`-fil.

**Funksjoner som rører `auth`-skjemaet** (i praksis `revoke_my_session()`,
`list_my_devices()` og `native_notif_active()`) er SECURITY DEFINER og kjører
som EIEREN — altså rollen som kjørte migreringen. At den rollen faktisk kan lese og slette i `auth.sessions`
er ikke noe koden kan se; `smoke-test.sql` seksjon 8b sjekker det eksplisitt, og
stopper deployen hvis rettigheten mangler.

Alle løp avsluttes med `smoke-test.sql` — deploy-porten fra
`docs/release-og-deploy.md`. Den skal være grønn mot et ferdig migrert skjema;
er den ikke det lokalt, blokkerer den produksjonsdeployen uten at noe faktisk
er galt.
