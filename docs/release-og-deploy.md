# Release og deploy

Autoritativ for hvordan kode og skjema når produksjon: rekkefølgen, portene
mellom leddene, og hva som skjer når noe feiler.

Grunnregelen: **en frontend som avhenger av nye databaseendringer kan ikke
publiseres før migreringen er kjørt og verifisert.** Alt under er mekanikken
som håndhever det.

## De to workflowene

| Fil | Kjører når | Gjør |
|---|---|---|
| `.github/workflows/ci.yml` | hver pull request (og som ledd 1 i release) | hele testsuiten: JS (node + nettleser, delt på shards etter målt kjøretid — `tests/CLAUDE.md`), SQL (begge løp + smoke-testen) og produksjonsbuilden |
| `.github/workflows/release.yml` | push til `main`, eller manuelt | tester → migrering → smoke-test → produksjonsdeploy |

`ci.yml` rører ingenting utenfor sin egen runner: JS-testene kjører mot
mock-backenden (`?mock=1`), SQL-testene mot en fersk PostgreSQL i en
service-container. Den har ikke tilgang til `SUPABASE_DB_URL`.

Repoet har tre workflows til, og alle står helt utenfor denne kjeden:
`android-debug.yml` pakker `dist/` inn i en Android debug-APK, `android-release.yml`
bygger den signerte butikkbinæren `app-release.aab`, og `android-device.yml`
kjører varselrunden (`tests/android-device.js`) på en ekte Android-emulator. Ingen
av dem migrerer eller deployer noe, og ingen av dem publiserer til Google Play —
se [`mobilapp-plan.md`](mobilapp-plan.md).
`tests/release-pipeline.test.js` holder dem (og enhver annen ny workflow)
utenfor migreringen og produksjonsdeployen.

## Rekkefølgen ved merge til `main`

```
1. tester      ci.yml gjenbrukt via workflow_call
                 ↓ needs
2. migrering   psql: supabase/setup.sql + supabase/users-and-sharing.sql
                 ↓ needs                 (begge idempotente, lock_timeout=15s,
                                          tre forsøk med økende pause)
3. smoke       psql: supabase/smoke-test.sql
                 ↓ needs                 (read-only transaksjon mot produksjon)
                 ├───────────────→ 3b. pushfunksjon (VED SIDEN AV, ikke en port)
                 ↓ needs                    supabase functions deploy push-send
4. deploy      preflight mot Vercels API → OTA-bundle (bygget + signert)
               → vercel deploy --prod
```

Builden i ledd 4 kjører HOS Vercel, ikke på runneren — altså som da
git-integrasjonen deployet `main`, bare startet fra denne jobben i stedet.
Porten er uendret: jobben ligger bak `needs: smoke`, så opplastingen skjer
først etter at migreringen er verifisert.

### Ledd 3b: web push-senderen

Edge-funksjonen `push-send` er senderen for web push
([`varsler.md`](varsler.md)). Den hører til SERVERSIDEN, ikke til frontenden, og
deployes derfor etter smoke-testen: den kaller `push_claim()`/`push_report()`,
som migreringen lager.

Den er bevisst **ikke en port for ledd 4.** Web push er en valgfri kanal som
ingenting annet i appen avhenger av — in-app-varslene virker uansett — og en
feilet funksjonsdeploy skal ikke holde en frontend tilbake. Rekkefølgen
migrering → smoke → deploy er dermed uendret.

Uten `SUPABASE_ACCESS_TOKEN` og `SUPABASE_PROJECT_REF` hopper jobben stille over
og er grønn: web push er ikke satt opp i alle miljøer, og en release skal ikke
kreve det. ER den satt opp, er en feil her ekte og skal være rød.
`tests/release-pipeline.test.js` låser begge halvdelene — at jobben venter på
smoke, og at deployen ikke venter på den.

To detaljer i selve kommandoen er også låst der, for begge er stille feil:

- **CLI-en kjøres med `npx`, ikke `npm install -g`.** Supabase-pakken nekter en
  global installasjon (postinstall kaster), så jobben ville dødd på
  installasjonssteget. Versjonen står fortsatt eksakt.
- **`--no-verify-jwt`.** Kallet inn til funksjonen er service-to-service
  (`pg_cron` → `pg_net`), og Supabases mønster for det er en secret key på
  `apikey`-headeren. En secret key er ikke et JWT, så plattformens
  JWT-verifisering ville avvist tikket før funksjonen fikk se nøkkelen. Porten
  er funksjonens egen sjekk ([`varsler.md`](varsler.md)).

**OTA-bundelen for Android bygges i det samme leddet, rett før opplastingen.**
`.github/scripts/ota-bundle.js` pakker `dist/` til `ota/bundles/<buildId>.zip`,
signerer ZIP-en med `OTA_SIGNING_KEY` (`SHA256withRSA`, base64), verifiserer
signaturen mot den offentlige nøkkelen som er pakket i APK-en, og skriver ett
manifest per støttet native nivå til `ota/android/<versionCode>.json`. Vercel-
builden kopierer `ota/` ut i `dist/`, så filene serveres fra huskis.no. Verifiser
ingen signatur, skrives ingen manifest og releasen stopper. Hva formen betyr og
hvorfor grensen ligger i URL-en: [`mobilapp-plan.md`](mobilapp-plan.md), fase 5.

Dette er mobilbundelens EGET `node build.js`, kjørt på runneren fordi ZIP-en må
pakkes der. Web-builden kjører fortsatt hos Vercel. De to er to builds av samme
release: samme `releaseId`, hver sin `buildId`
([`auto-update.md`](auto-update.md)).

Hvert ledd er en egen jobb med `needs` på det forrige. Stopper ledd 2 eller 3,
kjøres ledd 4 aldri — produksjon fortsetter å servere den forrige frontenden.

Migreringen kjøres på HVER release, ikke bare når SQL-filene er endret. Begge
filene er idempotente, og en betingelse som ikke kjørte er en betingelse som kan
være feil: det er billigere å kjøre en no-op enn å oppdage at skjemaet henger
etter.

### Hvorfor migrering og deploy aldri kjører parallelt

Vercels egen git-deploy for `main` er slått av i `vercel.json`:

```json
"git": { "deploymentEnabled": { "main": false } }
```

Uten dette starter Vercel en produksjonsbuild i samme sekund som mergen lander,
og løper om kapp med migreringen — nøyaktig den situasjonen som brøt
lister/listepunkt-synken (klienten sendte `cards`/`items.collapsed` før kolonnene
fantes). Nå har produksjonsdeployen bare én vei inn: `deploy`-jobben i
`release.yml`, som ligger bak `needs: smoke`.

I tillegg serialiserer én concurrency-gruppe (`huskis-release`,
`cancel-in-progress: false`) hele workflowen, så to raske merger etter hverandre
ikke kan overlappe hverandres DDL.

`tests/release-pipeline.test.js` sjekker at alle disse leddene fortsatt henger
sammen.

### Preview-deploys

Bare `main` er tatt ut av git-deployen. Alle andre grener får preview-deploys
som før, uten å vente på noen migrering — de er ikke koblet til
release-kjeden.

En preview bygges av samme `build.js` og peker på det samme Supabase-prosjektet
som produksjon (`config.js`), så en preview har ikke egne produksjonsdata og
skal ikke brukes til å teste et skjema som ennå ikke er migrert. Vil du se en
endring uten å røre ekte data, bruk mock-backenden: `?mock=1`.

Nettopp derfor er preview-deployen det ene bygget som beholder testmodusen:
`build.js` fjerner den fra alle andre bygg, men lar den stå når Vercel setter
`VERCEL_ENV=preview` (se [`sikkerhetsheadere.md`](sikkerhetsheadere.md)).
Produksjonsdeployen har den aldri, så `?mock=1` gjør ingenting på `huskis.no`.

## Klientrelease og databaseskjema

Kjeden over sikrer rekkefølgen for ÉN release. Regelen under sier hvilke
klientreleaser skjemaet må tåle samtidig — og det er flere enn den nyeste, fordi
en fane kan stå åpen i dagevis og en mobilapp kan bli stående uoppdatert i
ukevis ([`mobilapp-plan.md`](mobilapp-plan.md), arkitekturregel 7).

**Regelen: skjemaet skal alltid tåle den nyeste releasen og alle eldre som
fortsatt kan være i bruk.** To krav følger av den, ett i hver retning:

- **Framover:** et felt klienten skriver må finnes i skjemaet FØR klienten som
  skriver det er publisert. Det er nettopp det rekkefølgen
  migrering → smoke → deploy håndhever, og smoke-testen leser kontrakten ut av
  `app.js` — ikke ut av skjemafila — så en kolonne klienten sender og skjemaet
  mangler stopper deployen i stedet for å bli en usynlig avvist skriving.
- **Bakover:** skjemaendringer er additive. En eldre klient skriver et delsett av
  kolonnene som nå finnes, og leser bort de nye. En kolonne fjernes derfor
  tidligst en runde etter at klienten sluttet å bruke den
  ([`supabase/CLAUDE.md`](../supabase/CLAUDE.md)).

Det er dette som gjør frontend-rollback trygt, og det er den samme regelen som
gjør at en Android-app fra en eldre release fungerer mot dagens database uten
noe eget kompatibilitetslag.

**`releaseId` er identiteten dette snakkes om i** — den plattformuavhengige
release-ID-en i `/version.json` og i klientens `<meta name="huskis-release">`
([`auto-update.md`](auto-update.md)). Web og Android bygget fra samme commit
rapporterer den samme verdien, så «hvilken release kjører denne klienten?» kan
besvares likt begge steder.

Den er en identitet å SAMMENLIGNE med `===`, ikke en versjon å rangere med `>=`
— en commit-SHA har ingen ordning. Appen har **ingen** nedre støttet release
(`minimumSupportedRelease`), og får bare en dersom et konkret
inkompatibilitetsbehov oppstår: så lenge skjemaet er additivt, er en gammel
klient en fungerende klient. OTA gjør den vanligste grunnen til å ville ha en
grense mindre sannsynlig — en klient som er blitt for gammel kan flyttes
FRAMOVER i stedet for å stenges ute — men OTA er en leveringsmekanisme, ikke en
garanti: en telefon kan være offline lenge, kjøre en APK fra før OTA fantes,
eller ha en updater som ikke virker. Det er derfor additiviteten, ikke OTA, som
bærer regelen. Skulle behovet oppstå, kan `releaseId` uansett ikke være grensen
alene — en ordning må designes samtidig.

Den grensen mobilen faktisk trenger går den andre veien: «denne web-bundelen
krever et nyere native skall». Den har allerede en ordnet verdi i `versionCode`,
og innføres som en vakt sammen med OTA
([`mobilapp-plan.md`](mobilapp-plan.md), fase 5).

Releasen som migreres, smoke-testes og deployes er den samme commiten hele
veien: `release.yml` kjører på én `github.sha`, og den er både `commit` og
`releaseId` i `version.json` for deployen som kommer ut.

## Smoke-testen

`supabase/smoke-test.sql` svarer på ett spørsmål: **finnes og virker alt den
nye frontenden trenger?** Kontrakten er hentet fra klienten, ikke fra skjemafila:

1. tabellene i `TABLE`-mappingen i `app.js`
2. hver kolonne `insertPayload()`/`updatePayload()` sender — mangler én,
   avviser PostgREST HVER skriving for radtypen, usynlig
3. at RLS er på, og at alle policyene finnes
4. RPC-ene klienten kaller, med riktig signatur, `execute` for
   `authenticated` og ikke for `anon`
5. capability-funksjonene, vaktene og gravsteinstriggerne
6. tabellrettighetene for `authenticated` og `anon`
7. at de seks tabellene klienten abonnerer på ligger i `supabase_realtime`
8. at migreringsrollen faktisk kan LESE og SLETTE i `auth.sessions` — den
   tabellen er Supabase Auth sin, ikke vår, og fjern-utlogging
   (`revoke_my_session()`) kjører som eieren av funksjonen. Mangler
   rettigheten, finnes funksjonen likevel og granten ser riktig ut, mens hvert
   eneste kall feiler. Ingen annen test kan se det. Dette er den ene sjekken
   som er en **advarsel og ikke en port**: appen kjører uansett (`session_alive()`
   svarer «levende» om den ikke får lese, `native_notif_active()` svarer med de
   samme radene uten øktkravet, og klienten viser en feil på selve knappen), så
   det er én funksjon som mangler — ikke en halvmigrert database
9. **funksjonelt**: `get_my_doc()` kalt som en innlogget, ukjent bruker
   returnerer et komplett, tomt doc — og `anon` avvises på både tabeller og RPC

Den kjører i ÉN `read only`-transaksjon som avsluttes med `rollback`, med
`statement_timeout` og `lock_timeout` satt. Den kan ikke skrive og tar ikke
tyngre låser enn `ACCESS SHARE` — derfor er den trygg mot produksjon med
brukere innlogget.

Alle brudd samles opp og rapporteres SAMLET til slutt, så én kjøring viser alt
som mangler.

To tester holder den ærlig:

- `tests/db-contract.test.js` leser `app.js` og krever at hver kolonne, tabell
  og `.rpc(...)` klienten bruker faktisk sjekkes av smoke-testen — og at hver
  `execute`-grantede RPC i `users-and-sharing.sql` står der med samme signatur.
- `supabase/tests/run-tests.sh` kjører smoke-testen mot et ferdig migrert skjema
  i begge løp (nytt skjema og oppgradert gammelt), så den er bevist grønn før
  den får lov til å blokkere en deploy.

## Feil, retry og rollback

**Testene (ledd 1) feiler** → ingenting er rørt. Fiks og push på nytt.

Feilen trenger ikke være en test. JS-jobbens dyreste avhengighet er
Ubuntu-speilet: `playwright install-deps` henter ~21 MB skriftpakker, og
hastigheten dit svinger kraftig mellom runnere i samme runde — målt fra 21
sekunder til 2min 32s (138 kB/s) for nøyaktig den samme nedlastingen.

To forskjellige feil kommer derfra, og bare den ene er automatisk dekket:

**Speilet slutter å svare** — forbindelsen godtas, headeren kommer, og så blir
det stille. Dette er dekket. `Acquire::http::Timeout` i
`/etc/apt/apt.conf.d/` bryter en overføring som står stille, og prisen per
hengende fil er `(Retries + 1) × Timeout` ≈ 60 sekunder. Timeoutene må stå i
apt-konfigurasjonen og ikke som flagg på et forsteg: `playwright install-deps`
kjører sitt EGET `apt-get update` inne i seg selv, og det er der ventingen
skjer. Feiler kallet, kjøres det inntil tre ganger med 10/20 sekunders pause.
Gir retryen opp, sier loggen det med `::error::`, og annoteringen navngir
apt-linja som skiller et dødt speil (kjør jobben på nytt) fra en avhengighet
som faktisk er borte (en ny kjøring hjelper ikke).

**Speilet er bare tregt** — det kommer bytes hele tiden, men få. Dette er IKKE
dekket, og kan ikke dekkes av apt: `Acquire::*::Timeout` er en
stillhets-timeout, og apt har ingen nedre hastighetsgrense. En slik runde blir
grønn, bare langsom. Blir den for langsom, felles den til slutt av taket på
steget.

Takene på nettstegene er derfor bakstoppere mot en vranglås i DET steget, ikke
budsjetter stegene skal holde seg innenfor — et tak satt etter normaltilfellet
felte en runde som ellers ville blitt grønn. Summen av dem (3 + 12 + 20) er
med vilje større enn jobbens 25, og da må to ting holde:

- **Et gulv til `install-deps`.** Bruker Playwright- og Chromium-stegene hele
  taket sitt (bare mulig ved cache-bom), står det fortsatt igjen 5 minutter av
  jobbens budsjett etter testreserven. Uten det gulvet kunne en cache-bom spise
  budsjettet, og jobbens tak ville slått inn før noe steg rakk å si fra selv.
- **En budsjettstyrt frist.** Retry-løkka regner ut fristen sin av hvor mye av
  jobbens 25 minutter som FAKTISK er igjen — den leser starttiden et eget
  første steg legger i `JOBB_START`. Er budsjettet allerede brukt opp, sier
  steget fra med `::error::` og navngir at det var stegene foran som brukte
  tiden, i stedet for å bli drept anonymt.

Cachesteget står bevisst uten tak: et cachebom skal gi en tregere jobb, ikke en
rød. `tests/release-pipeline.test.js` holder hele regnestykket fast, så det
ikke kan drive fra hverandre når noen justerer ett av tallene.

**Migreringen (ledd 2) feiler** → jobben prøver hver fil inntil tre ganger med
10/20 sekunders pause. `lock_timeout=15s` gjør at en DDL som blir stående og
vente gir opp raskt i stedet for å holde på låsene sine mens køen bygger seg
opp. Holder det ikke, stopper releasen og deployen skjer ikke.
Databasen kan da stå halvmigrert. Fordi begge filene er idempotente, er
responsen å kjøre releasen på nytt (Actions → «Release» → «Re-run failed
jobs»), ikke å rette manuelt. Den forrige frontenden er fortsatt i produksjon
og fungerer, fordi skjemaendringer er additive
([`supabase/CLAUDE.md`](../supabase/CLAUDE.md)).

**Smoke-testen (ledd 3) feiler** → databasen er migrert, men ikke komplett.
Deployen stoppes med vilje. Feilmeldingen lister nøyaktig hva som mangler.
Ingen automatisk retry her: enten er skjemaet riktig, eller så skal deployen
stoppe. Vanligste årsak er en halvfullført migrering — kjør releasen på nytt.
Er det skjemafila som mangler noe klienten sender, er fiksen en ny PR som
legger kolonnen/funksjonen inn, ikke å hoppe over porten.

**Deployen (ledd 4) feiler** → databasen er migrert og verifisert, men den nye
frontenden ble ikke publisert. Produksjon serverer fortsatt den forrige, som
virker mot det migrerte skjemaet. Kjør `deploy`-jobben på nytt.

Jobben starter med et preflight-kall mot Vercels API, fordi CLI-en svarer
«Could not retrieve Project Settings» på alt som går galt — ugyldig token,
token uten tilgang og feil prosjekt-ID gir samme setning. Preflighten skiller
dem: 401 = tokenet er ugyldig eller utløpt, 403 = tokenets scope dekker ikke
prosjektet, 404 = `VERCEL_PROJECT_ID` og `VERCEL_ORG_ID` hører ikke sammen.
Bare statuskoden og Vercels egen feilmelding logges; tokenet forlater aldri
runneren.

Jobben kjører bevisst verken `vercel pull` eller `vercel build`. Begge krever at
runneren har hele prosjektkonfigurasjonen liggende lokalt — `vercel build`
avviser med «No Project Settings found locally» uten `settings`-blokken som kun
`vercel pull` skriver. Å gjette den fasongen selv er en unødvendig feilkilde.
Vercel kjenner sine egne innstillinger, så jobben skriver bare
`.vercel/project.json` med de to ID-ene og lar Vercel bygge.

**Rollback av frontenden**: rull tilbake i Vercel (Deployments → den forrige
produksjonsdeployen → «Promote to Production», eller `vercel rollback`). Det er
trygt fordi skjemaendringer er additive: den forrige klienten skriver et
delsett av kolonnene som nå finnes.

**Rollback av skjemaet** finnes ikke som eget steg, og skal ikke lages. En
kolonne fjernes tidligst en runde etter at klienten sluttet å bruke den — å
droppe den samtidig ville brutt den klienten som fortsatt kjører i folks faner.
Å rette et skjema betyr å rulle FRAMOVER: en ny PR som endrer
`users-and-sharing.sql` og kjører gjennom den samme kjeden.

### Kun migrering, uten deploy

Actions → «Release» → «Run workflow» → huk av «Kjør kun migrering +
smoke-test». Samme concurrency-gruppe, så den kan heller ikke overlappe med en
pågående release.

## Secrets

| Secret | Hvor den hentes | Brukes av |
|---|---|---|
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string → URI, med passordet satt inn | migrering + smoke |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. Scope kan være teamet (`peohols-projects`) ELLER bare prosjektet (`peohols-projects/huskis`) — deployjobben er bygget for at project-scope skal holde | deploy |
| `VERCEL_ORG_ID` | `.vercel/project.json` etter `vercel link` | deploy |
| `VERCEL_PROJECT_ID` | samme fil | deploy |
| `OTA_SIGNING_KEY` | privat RSA-nøkkel, PKCS#8 PEM (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096`). Den offentlige halvdelen står som `publicKey` i `capacitor.config.json` og er pakket inn i APK-en | deploy (OTA-signeringen) |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens | pushfunksjon (**valgfri**) |
| `SUPABASE_PROJECT_REF` | prosjekt-ref-en fra Supabase-URL-en | pushfunksjon (**valgfri**) |

Mangler en av de fem første, feiler jobben med en eksplisitt melding om hvilken
— den feiler ALDRI stille videre til neste ledd. De to siste er unntaket, og
det er bevisst: web push er en valgfri kanal, og uten dem hopper ledd 3b over
med en advarsel i stedet for å stoppe en release som ikke trenger den
([`varsler.md`](varsler.md)). Selve VAPID-privatnøkkelen er ikke en
GitHub-secret i det hele tatt — den bor i Supabase Vault, der senderen leser
den. `OTA_SIGNING_KEY` behandles likt:
uten den stopper releasen, i stedet for å publisere en bundle ingen telefon kan
verifisere (pluginen er fail closed på signatur). Privatnøkkelen forlater aldri
runneren — den leses ett sted, som miljøvariabel, og skrives aldri ut. Merk at siden Vercels git-deploy for
`main` er av, er `VERCEL_TOKEN`/`ORG_ID`/`PROJECT_ID` nå det eneste som kan
publisere til produksjon.

Android-signeringen har sine egne secrets (`ANDROID_UPLOAD_*`). De hører til
butikkdistribusjonen, ikke til denne kjeden, og står i
[`mobilapp-plan.md`](mobilapp-plan.md), fase 6 — sammen med hvilken nøkkel som
er hvilken.

`SUPABASE_DB_URL` må være den DIREKTE tilkoblingen (port 5432), ikke
pooler-URL-en (6543): både migreringen og smoke-testen kjører flerstegs
transaksjoner og `set local role`, som pgbouncer i transaction mode ikke
støtter.

`deploy`-jobben kjører i GitHub-miljøet `production`. Det er ikke nødvendig for
rekkefølgen — den holdes av `needs`-kjeden — men gir et sted å slå på manuell
godkjenning eller egne miljø-secrets senere.

## Se også

- [`auto-update.md`](auto-update.md) — build-ID, release-ID, `/version.json` og
  hvordan åpne faner oppdager en ny deploy
- [`supabase/CLAUDE.md`](../supabase/CLAUDE.md) — reglene for selve
  skjemaendringen (idempotens, additivitet)
- [`tests/CLAUDE.md`](../tests/CLAUDE.md) — hvordan testene kjøres lokalt
