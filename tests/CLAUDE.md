# CLAUDE.md — tester

Testene er frittstående Node-skript, ikke et testrammeverk: ingen
`package.json`, ingen runner, ingen `npm test`. Hver fil kjøres direkte, skriver
`PASS`/`FAIL`-linjer med evidens, avslutter med `==== n/m PASS ====` og setter
exit-kode 0/1.

## Kjøre testene

Nettlesertester (Playwright + Chromium; serveren må kjøre i en egen terminal):

```bash
python3 -m http.server 8000                        # fra repo-roten
NODE_PATH=$(npm root -g) node tests/<navn>.test.js
```

Rene node-tester (ingen server, ingen nettleser):

```bash
node tests/build-version.test.js      # build.js + vercel.json
node tests/capacitor-android.test.js  # Capacitor-skallet: dist/ som web-assets, ingen server.url
node tests/android-release.test.js    # butikkbinæren: package ID, versionCode/-Name, release-signering
node tests/no-legacy-domain.test.js   # repo-vid vakt mot det pensjonerte domenet
node tests/release-pipeline.test.js   # rekkefølgen migrering → smoke → deploy
node tests/db-contract.test.js        # smoke-test.sql i takt med app.js
node tests/security-headers.test.js   # CSP + sikkerhetsheaderne, låst Supabase-versjon
node tests/i18n.test.js               # språkordboken + at ingen norsk tekst står igjen i koden
node tests/push-crypto.test.js        # VAPID-signaturen + RFC 8291-krypteringen (web push)
```

Hele suiten i én runde (starter en lokal server selv hvis ingen svarer) —
nøyaktig det CI kjører:

```bash
tests/run-all.sh
SHARD_INDEX=1 SHARD_TOTAL=4 tests/run-all.sh   # slik CI deler den opp
```

Én fil her er ikke en test, men en GENERATOR:

```bash
NODE_PATH=$(npm root -g) node tests/lag-varselikoner.js   # varselikonene, av favicon.svg
```

Den skriver `assets/notif/*.png`, `res/drawable-nodpi/ic_huskis_notification.png`
og `res/drawable/ic_stat_huskis.xml`. Geometrien til masken står der, og
`notif-channels.test.js` (10) sjekker at filene og drawable-en ikke har skilt
lag. Den ligger her fordi den deler verktøy med testene og fordi `build.js`
holder `tests/` utenfor `dist/`.

- `NODE_PATH=$(npm root -g)` trengs fordi Playwright er installert globalt.
- `HUSKIS_URL` overstyrer `http://localhost:8000` hvis serveren kjører et annet
  sted.
- Kjør de testene endringen berører — hele mappen tar lang tid, og en full runde
  er sjelden det som gir evidensen. CI kjører den fulle runden på hver PR.

## Sharding

CI kjører suiten parallelt. `tests/shard.js` fordeler filene etter **målt
kjøretid** fra `tests/durations.json`: dyreste fil først, hver i den shard-en
som har minst arbeid så langt. Shardene blir dermed like tunge — spredningen er
et par sekunder, mot 127 s da fordelingen var alfabetisk.

Hvilken shard en enkelt fil havner i er ikke stabilt over tid, og skal ikke
være det: plasseringen følger den løpende summen, så en ny test kan flytte
mange filer. Det er uten betydning — ingen cache eller tilstand henger på en
shard.

Antallet shards står ett sted — `shard:`-matrisen i `.github/workflows/ci.yml`.
`SHARD_TOTAL` utledes av `strategy.job-total`, så matrisen og fordelingen kan
ikke komme i utakt.

`run-all.sh` skriver kjøretid per fil til slutt, og i CI også til
jobbsammendraget. Når fordelingen har blitt skjev, eller nye testfiler har
ligget umålt en stund, hentes ferske tall.

**Beste kilde er en CI-runde**: den kjører på runnerne fordelingen gjelder for,
og gjør det parallelt på noen få minutter. Les shard-tabellene fra
jobbsammendraget og oppdater `durations.json`. Uten en CI-runde å hente fra:

```bash
tests/measure.sh          # full, ushardet runde lokalt → tests/durations.json
```

Tallene er **relative** — fordelingen trenger forholdet mellom filene, ikke
absolutt veggklokke. En fil som mangler i `durations.json` får medianen av de
målte, så en ny test ikke tvinger fram en ny måling.

En invariant kan trenge BEGGE slag test. «Appen produserer ingen utgående
lenker» voktes både av en tekstvakt uten nettleser
(`capacitor-android.test.js` del 12, som ser en lenke før den er rendret) og av
en kjørende (`external-links.test.js`, som ser det ferdige DOM-et og dermed
enhver skrivemåte, også markup satt sammen av strengbiter). Der en tekstvakt
kan omgås av en ny staving, er svaret et annet slag net — ikke et finere
mønster.

Og der et net ikke NÅR fram, er svaret å knytte det utilgjengelige til det
tilgjengelige. Nettlesertesten kan ikke kjøre mot den pakkede APK-builden —
den har ingen mock-backend, så testen kommer ikke forbi innlogging. I stedet
kreves de synkede assetene byte for byte lik kildene (`index.html` modulo
build-ID), og da gjelder alt de to nettene beviser om kildene også for det som
faktisk pakkes.

Et kjørende net må da også nå HELE DOM-et. `querySelectorAll` går ikke inn i en
shadow root, og en lukket rot kan ikke nås utenfra i det hele tatt — så
`external-links.test.js` kroker `attachShadow` med `addInitScript` FØR appen
kjører, og fører opp hver rot uansett modus. Samme slag blindsone: en
SVG-`<a>` har `href` som et `SVGAnimatedString`, ikke en streng, så
destinasjoner leses som ATTRIBUTT og resolveres mot `document.baseURI`.

`tests/shard-distribution.test.js` er vakten: den sjekker at hver testfil havner
i nøyaktig én shard for alle aktuelle shard-antall. En fil som faller ut mellom
to shards gir ellers ingen rød CI — bare en test som stille aldri kjøres igjen.

## Hermetikk: `?mock=1`

Nettlesertestene laster appen med `?mock=1`, som får `dev-mock.js` til å laste
`mock-backend.js`: en in-memory-«database» i `localStorage` (`hk-mock-db`) med
sesjon per fane i `sessionStorage` (`hk-mock-session`). Det er dette
backend-byttet som gjør testene hermetiske — det finnes ingen ruteblokkering av
nettverkskall, og testene stubber ikke fetch.

Begge filene er **kun kildekode**: `build.js` holder dem utenfor `dist/` og river
`kun-dev`-blokken ut av `index.html`, så testmodusen ikke finnes i produksjon
(`docs/sikkerhetsheadere.md`). Alle nettlesertestene kjører dessuten under den
ekte innholdssikkerhetspolicyen, som ligger i en `<meta>`-tagg i `index.html` —
en endring som krever nytt inline-script eller en ny tredjepartsvert vil feile
her før den når produksjon.

`&lag=800` gir kunstig serverforsinkelse og brukes til å vise at UI-et er
umiddelbart og at operasjonskøen serialiserer riktig.

`window.HK_MOCK.setOffline(true)` gir et EKTE nettbrudd i den ene fanen: kallet
nås aldri, løftet avvises med den meldingen `isNetworkError()` kjenner igjen, og
realtime slutter å levere. Det er slik `notes-collab.test.js` måler reconnect
etter et kort brudd — uten å måtte late som.

**Skrivingene er «transaksjoner».** To faner er to ekte prosesser mot den samme
`localStorage`, så en les–endre–skriv kan miste en skriving: begge leser det
samme, begge skriver, den siste vinner. Nettleseren speiler i tillegg
`localStorage` i hver fane og oppdaterer speilet asynkront, så en fersk verdi
kan fortsatt se gammel ut. Hver skriving holder derfor en ekte lås
(`navigator.locks`) fra første lesing til siste skriving. Målt med to faner som
gjorde 200 les–endre–skriv hver: 264 av 400 uten lås, 400 av 400 med. Uten det
ville et flerbrukerscenario med mange skrivinger feilet av harnisket i stedet
for av koden — og feilet flakete, som er verre.

Redigerer TESTEN databasen mens mer enn én fane står oppe, må den inn samme vei:
`await window.HK_MOCK._edit((db) => { … })` tar den samme låsen.
`_loadDB()` + `_saveDB()` er to skritt, og en runde fra den andre fanen imellom
overskriver endringen.

To måter å komme inn i appen på:

1. **Kjør registreringen i UI-et** (som `nav-modal.test.js`) — dekker
   auth-flyten, men er treg.
2. **Seed databasen direkte** (som `roles-and-sections.test.js`): skriv
   `hk-mock-db` + `hk-mock-session` og last siden på nytt. Dette er måten
   flerbrukerscenarioer settes opp på — roller, medeierskap, invitasjoner, låser
   og delt innhold seedes ferdig i stedet for at to faner klikker seg gjennom
   flyten. Test som en annen bruker ved å seede en annen `hk-mock-session`.

**Demonstrasjonen kommer i veien.** En ny konto får den automatisk etter
innlogging (`docs/introduksjon.md`): en simulering der brukeren bygger område →
mappe → liste → listepunkt og rydder alt bort igjen. Den bytter ut hele `state`
mens den står på, og slipper bare gjennom klikkene steget handler om — en test
som ikke slår den av tester ingenting. Gest-tipsene er like mye i veien: de
kommer som en toast NEDERST på skjermen — nøyaktig der et mobil-drag tar tak i
den nederste lista. Tester som ikke handler om introduksjonen skal derfor slå av
BEGGE deler med én gang:

- logger testen inn gjennom UI-et: `await p.evaluate(() => window.__huskis.tour.skipAll())`
  sist i innloggingshjelperen (merket lagres med én gang, så en demo som er på
  vei opp heller ikke rekker å starte);
- seeder testen sesjonen selv: gi den seedede brukeren
  `user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } }`.

**Versjonen betyr noe nå.** Markøren teller bare fra og med `v: 3` (demoen):
en konto som kom gjennom en tidligere runde har aldri sett denne, og skal få
tilbudet. Seeder du `v: 1`, starter demoen midt i testen din. Skal en test
derimot HA demoen, gir `user_metadata: {}` en reelt ny konto.

Mock-backenden speiler serverens regler (roller, capabilities, felt-LWW,
fremmednøkler, gravsteiner), men er ikke en full RLS-implementasjon. Endrer du
en regel i `supabase/users-and-sharing.sql`, må mock-backenden oppdateres i
samme endring — ellers tester nettlesertestene noe annet enn produksjon.

`window.__huskis` eksponerer state og et utvalg funksjoner (`openNavModal`,
`openObjMenu`, `cloudCycle`, `updateSafety`, `authUser`, `showToast` …). Bruk
dem til oppsett og inspeksjon; klikk deg gjennom UI-et der klikkene ER det som
testes.

## Viewport

Testfilene kjører vanligvis samme sjekker to ganger:

```js
await run('desktop', { width: 1200, height: 900 }, false);
await run('mobil',   { width: 390,  height: 780 }, true);   // isMobile + hasTouch
```

Begge kreves når oppførselen avhenger av layout eller pekertype: dra-og-slipp,
board-kolonner (grensen mellom én og flere kolonner går ved 560/561 px), scroll,
trykk-og-hold, plassering og visuell justering. Ett viewport holder for logikk
som ikke avhenger av noe av dette (synk, rettighetsgating, tilstandsendringer).

## Venting

Vent på TILSTAND, ikke på klokka. Suiten brukte tidligere ~279 s på faste
`waitForTimeout`-kall; de tilstandsavhengige er byttet mot `waitForFunction`
på signaler appen faktisk gir:

- **Innlogget og klar**: `window.__huskis.authUser && window.__huskis.lastMy`
  — `lastMy` settes først når `get_my_doc` har svart, så da er dokumentet
  hentet, flettet og rendret. Legg på `state.universes.length > 0` når testen
  trenger innhold.
- **Synk-runde ferdig**: pillen `#sync-status` med `dataset.state !== 'saving'`
  (eller `'saved'` når køen skal være tømt). MERK: `cloudCycle()` no-op-er hvis
  en runde alt er i gang, så et rått `await` på den er IKKE et ferdig-signal.
- **Serverside-effekt**: les mock-databasen direkte (`window.HK_MOCK._loadDB()`
  eller `localStorage['hk-mock-db']`) og vent på selve raden. Skal du ENDRE den
  med flere faner oppe, bruk `window.HK_MOCK._edit()`.
- Bruk `{ polling: 200 }` i filer med flere sider/faner — rAF-polling struper i
  bakgrunnsfaner.

**Et språkbytte laster appen på nytt** (`docs/sprak.md`), og
`tests/language.test.js` gjør det for hvert eneste bytte. Ventingen går derfor
på `document.readyState === 'complete'` PLUSS appens egne signaler, med en raus
timeout. Testmiljøet trenger ikke utgående nett: appen laster ingenting fra en
tredjepart — webfonten ligger i `assets/fonts/`, ikke hos Google
(`docs/sikkerhetsheadere.md`).

Faste ventinger er fortsatt RIKTIG tre steder, og skal ikke «optimaliseres»
bort: **fraværsbevis** (noe skal IKKE skje — fravær kan bare påstås etter at
det ville rukket å skje), **gest- og animasjonsfysikk** (trykk-og-hold,
smooth-scroll, PEEK_MS), og **tidsvindu-observasjon** (ro-vinduet i
sync-status). Slike steder har en kommentar som sier hvorfor.

## Datoer i fiksturer

Nettleserkonteksten har sin EGEN tidssone (`timezoneId`, i praksis
`Europe/Oslo`), og det er den appen daterer etter: «i dag», «i går», bunkene i
varselmodalen, chipene under navnet. Testprosessen står i sin egen sone — UTC i
CI. To regler følger av det:

- **Regn fiksturens datoer i SIDEN, ikke i Node.** `new Date()` i testfilen er
  et annet døgn enn nettleserens i timene mellom det ene døgnskiftet og det
  andre, og da går testen rødt av kalenderen i stedet for av koden. Hent
  datoene med `p.evaluate` (`notif-modal.test.js` har `sideklokke()`,
  `notif-native-devices.test.js` gjør det samme i det små). Å sette
  `process.env.TZ` i stedet virker bare til noen legger en test med en annen
  `timezoneId` ved siden av.
- **En rad som skal ligge i DAGENS bunke må klemmes innenfor døgnet.** «Nå
  minus en time» er i går hver gang testen kjører den første timen etter
  midnatt. Seed «for et øyeblikk siden, men tidligst rett etter midnatt».
- **Et lokalt døgn er ikke 24 timer.** Gjennom en sommertidsovergang er det 23
  eller 25 (`Europe/Oslo`: 29. mars og 25. oktober 2026). Uttrykk derfor et
  tidspunkt som skal ligge i et bestemt døgn fra døgnets EGNE grenser — «en
  halvtime etter at det begynte», «en halvtime før det neste begynner» — aldri
  som et antall millisekunder fra midnatt. «Midnatt + 23,5 t» er 00:30 NESTE
  døgn på den korte dagen, og raden bytter bunke. Regn døgnbytter med
  `setDate` fra et trygt ankerpunkt (kl. 12 finnes hver dag), ikke ved å legge
  til døgn i millisekunder.
- **Løpet må ikke kunne KRYSSE et døgnskifte.** De to reglene over daterer
  fiksturen riktig i det øyeblikket den lages; skifter kalenderen mens løpet
  står på, er radene datert i går mens appen med rette tegner i dag. Pinn
  derfor klokka midt på dagen når konteksten lages — `clock.install` på et
  lokalt kl. 12, og `clock.resume()` rett etter, så timerne (synk,
  nedtellinger, toaster) fortsatt måles på ekte tid. Midnatt er da tolv timer
  unna uansett når suiten startes.

Sonen OG pinningen står ett sted per fil, og kontekstene lages gjennom den
samme fabrikken (`nySide` i `notif-modal.test.js`), slik at et nytt løp verken
kan komme inn med sin egen sone eller uten pinnet klokke. `HUSKIS_TZ`
overstyrer sonen:

```bash
HUSKIS_TZ=Etc/GMT+8 NODE_PATH=$(npm root -g) node tests/notif-modal.test.js
```

Et løp som SKAL over midnatt pinner et annet klokkeslett og spoler forbi
(`clock.fastForward`). Vil du vise at pinningen virker fra en rigg som står
rett før midnatt — eller at kalenderregningen tåler en sommertidsovergang — må
klokka simuleres, ikke ventes på: `nySide` tar en `rigg`-parameter nettopp for
det (et klokkeslett i dag, eller et absolutt øyeblikk for en bestemt dato), og
`notif-modal.test.js` (18 og 19) er mønsteret. Bevis som bare hviler på å kjøre
i mange tidssoner er ikke nok; de er avhengige av hva klokka tilfeldigvis er.

Og en hjelper som fiksturen bruker, skal testes gjennom SEG SELV — ikke ved at
testen skriver om det samme uttrykket. Skrives det om, slipper en feil i
hjelperen unna.

## Konvensjoner i testfilene

- Kommentarblokk øverst: nummerert liste over hva filen dekker, og en
  `Kjør:`-blokk med den faktiske kommandoen.
- Samle `page.on('pageerror')` og avslutt hvert løp med en sjekk på at ingen
  JS-feil oppsto.
- Assertions tar med den faktiske verdien som evidens, slik at en feilende linje
  er lesbar uten å kjøre testen på nytt.
- Én fil per tema eller regresjon, navngitt etter oppførselen
  (`dnd-peek-collapsed`, `sync-resurrection`) — aldri etter PR-nummer eller dato.
- En bugfiks skal ha en sjekk som feiler uten fiksen. Legg den i den filen som
  allerede dekker området hvis det finnes en.
- Skjermbilder tas kun der det visuelle ER påstanden (se
  `dnd-extract-thresholds.test.js`), ikke rutinemessig.

## Rapportering

Oppgi hvilke testfiler som ble kjørt og resultatlinjen deres. Berører endringen
en test du ikke kjørte, si det eksplisitt.
