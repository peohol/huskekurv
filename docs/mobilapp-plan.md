# Mobilapper — plan og fremdrift

Dette er den levende arbeidsplanen for å gjøre Huskis til en ordentlig Android-
og iOS-app **uten å splitte produktet i tre frontender**. Webappen forblir
kilden til UI og forretningslogikk; native-prosjektene skal være tynne skall
rundt den samme produksjonsbuilden.

Dokumentet er autoritativt for **rekkefølgen, nåværende fase og hva som gjenstår**
i mobilprosjektet. Ferdig funksjonalitet dokumenteres fortsatt i det ordinære
autoritative dokumentet for fagfeltet.

## Status

| Felt | Nå |
|---|---|
| Målarkitektur | Én HTML/CSS/JS-kodebase + Capacitor for Android/iOS |
| Nåværende fase | **Fase 6 — Android intern distribusjon.** Repo-siden er innført: stabil release-signering, reproducerbar release-AAB fra CI, endelig package ID og butikkregelen for `versionCode`. Det som gjenstår er manuelt i Google Play Console. |
| Native kapabiliteter | Systemets tilbakeknapp, safe areas, lifecycle-/network-signaler, OTA — og **lokale systemvarsler** (`@capacitor/local-notifications`, se «Native varsler» under). Ingen andre native plugins. |
| Status — fase 3 | **Ferdigkriteriet er nådd.** Alle seks punktene er avgjort: systemets tilbakeknapp og safe areas/systemfeltene/skjermtastaturet, begge verifisert på fysisk telefon; eksterne lenker og auth-/e-postlenker, der rutingen er en beslutning uten kode (appens første utgående lenke — adressen i et notat — kom senere, og har sin egen fysiske sekvens i seksjonen); sikker lagring/`android:allowBackup`, der sikkerhetskopien av WebView-lagringen er slått av; og lifecycle-/network-signalene, målt på enhet med sonden. `navigator.onLine` er bekreftet dødt uten `ACCESS_NETWORK_STATE`, og tillatelsen er lagt inn med vakt. Gjenopptakelsen er tilskrevet: et `get_my_doc` står i enhetsloggen merket `by: 'visibilitychange'`. Målingen viste samtidig at hendelsen IKKE leveres når Android har fryst prosessen — der starter pollets forfalte tikk runden i samme øyeblikk som opptiningen. Begge ledd er dermed bærende, hvert i sitt regime (se seksjonen). Ingen native plugin er innført. Automatisk dekket av `tests/safe-area.test.js`, `tests/landscape-chrome.test.js`, `tests/system-back.test.js`, `tests/sync-foreground.test.js` (del 2 og del 6 kjører hvert sitt regime) og `tests/capacitor-android.test.js`. |
| Status — fase 4 | Fase 4s ferdigkriterium er **oppfylt**: en kjørende APK og en Vercel-preview bygget av samme commit rapporterte den samme `releaseId` (`d10867a7c0a6`) med hver sin `buildId`, lest på telefon. Alle sju punktene er avgjort. Fem er implementert: kartleggingen av dagens release-identiteter, `releaseId` er definert og generert i `build.js`, web og Android bygget fra samme commit rapporterer den samme verdien, `version.json` er utvidet additivt uten at cache- eller reload-sikkerheten er rørt, og kompatibilitetsregelen mellom klientrelease og databaseskjema er skrevet ned ([`release-og-deploy.md`](release-og-deploy.md)). De to siste er beslutninger, ikke kode — `minimumSupportedRelease` og valget mellom byte-identisk artifact og separate builds — sto åpne til OTA ga dem en konsekvens, og er nå avgjort i fase 5: ingen nedre grense, og separate builds med samme `releaseId` (se «De to punktene fra fase 4 får sitt svar her»). Automatisk dekket av `tests/build-version.test.js`, `tests/auto-update.test.js` og `tests/capacitor-android.test.js`. |
| Status — fase 5 | **Ferdigkriteriet er oppfylt på fysisk Android.** Installasjon A beviste produksjonskjeden: et `versionCode 3`-skall fra `0ebb737` lastet ned og stilte opp en senere produksjonsbundle, Java godtok produksjonssignaturen, `updateSafety()` blokkerte byttet offline og under synk, origin/sesjon/data overlevde byttet, OTA-aktiveringen var varig, og fire flymodus-kaldstarter nådde `ready()` på 249–314 ms mot `readyTimeout = 10000` ms — også med token nær utløp. Installasjon B beviste fallbacken på måleriggen: både `rig-broken-1` (`throw`) og `rig-broken-2` (`blank`) ble rullet tilbake til innebygd bundle og sperret varig; for `rig-broken-2` ble hele signaturen lest direkte som `rollback: true`, `previousBundleId: 'rig-broken-2'`, klientkarantene og pluginblokkliste. Råmålingene står i fase 5-seksjonen. |
| Status — fase 6 | **Repo-siden er ferdig; butikk-siden er manuell.** Innført og maskinelt dekket: `no.huskis.app` er bekreftet endelig og låst i alle seks stedene som navngir den; release-signeringen tar imot materiale utenfra (miljøvariabler eller en gitignorert properties-fil) og AVVISER et release-bygg uten det, i tre fail-closed-lag; `.github/workflows/android-release.yml` bygger `app-release.aab` reproducerbart av den samme `dist/`-kjeden og laster den opp som artifact; `versionCode` har fått butikkens monotone regel uten å bli et tall nummer to; og appikonet og splash-bildet er Huskis' eget merke, utledet av `favicon.svg`, i stedet for Capacitor-malens logo. Ingen nøkkel, intet passord og ingen Play-konto finnes ennå — det signerte bygget er derfor prøvd bare fra avvisningssiden. Automatisk dekket av `tests/android-release.test.js`. |
| Neste milepæl | Fase 6: første installasjon og oppdatering av Huskis gjennom Google Plays interne testspor, uten sideloading |
| Neste praktiske steg — fase 3 | Ingen. Fasen er ferdig |
| Neste praktiske steg — fase 4 | Ingen. Fasen er ferdig; de to «vurder …»-punktene fikk sitt svar i fase 5 |
| Neste praktiske steg — fase 5 | Ingen. Fasen er ferdig; produksjons-OTA, readiness, rollback og karantene er målt på fysisk Android |
| Neste praktiske steg — fase 6 | Opprett Google Play Developer-kontoen, lag upload-nøkkelen og legg inn de fire `ANDROID_UPLOAD_*`-secretene — så kan «Android release-AAB» kjøres og AAB-en lastes opp til internt testspor (fase 6, «Slik lager du upload-nøkkelen»). Butikkoppføringens egen grafikk (512×512-ikon, screenshots) lages i Play Console; appikonet i binæren er på plass |
| Neste praktiske steg — varsler | Kjør `node tests/android-device.js` én gang mot din egen telefon (den kjører da i LIVE-modus og måler din egen plan), og svar på de tre spørsmålene den skriver ut til slutt: heads-up, låseskjerm og fingeren på varselet. Alt annet i runden er maskinelt bevist |
| OTA | Innført ende til ende og verifisert på fysisk Android: signert produksjonsbundle, manifest per native nivå, native nedlasting, oppstilling, trygg aktivering, varig aktivering, readiness, rollback og karantene. Ferdigkriteriet er oppfylt |
| Varsler | **Innført. Den maskinelle delen av den fysiske runden er AUTOMATISERT og kjøres på en emulator i CI; LIVE-runden på eierens egen telefon og tre øyepunkter står igjen.** Android får lokale systemvarsler planlagt på enheten; nettleseren får web push. Begge leverer den samme planen generatoren allerede logger ([`varsler.md`](varsler.md)) — ingen ny varselmodell. Alarmene følger telefonens tidssone også når appen er lukket, gjennom en `TIMEZONE_CHANGED`-mottaker som regner om de planlagte alarmene og skriver den korrigerte tiden tilbake til pluginens lagring (`varsler.md`, «Når sonen endres mens appen ikke kjører»). `tests/android-device.js` er den maskinelle runden mot en ekte enhet, og `.github/workflows/android-device.yml` kjører den på en emulator på hver PR som rører Android-siden: alarmkøen mot planen, en vanlig appomstart, en drept prosess, en EKTE omstart av enheten, et tidssonebytte med appen helt lukket, en levering med radioen AV, trykket fra kaldstart, og opprydningen ved brukerbytte. Automatisk dekket ellers av `tests/notif-channels.test.js`, `tests/notif-plan.test.js`, `tests/notif-timezone-native.test.js`, `tests/notif-native-devices.test.js`, `tests/android-alarm-queue.test.js`, `tests/push-crypto.test.js`, `tests/push-auth.test.js`, `tests/capacitor-android.test.js` og `android/app/src/test/…/HuskisWallClockTest.java`. Appen står også i «Enheter med varsler» og kan slås av derfra — med den ærlige begrensningen at en LUKKET app først tar ned alarmene sine neste gang den er i bruk ([`varsler.md`](varsler.md), «Android i enhetslisten»). Det som står igjen er presentasjonen Android selv eier — heads-up, lyd/vibrasjon og låseskjerm — og én runde på eierens EGEN telefon, som måler brukerens egen plan i stedet for riggens |
| iOS | Senere fase; ikke en del av første implementering |

### Slik holdes planen levende

Hver PR som flytter mobilprosjektet fremover skal oppdatere denne filen i samme
endring:

- oppdater **nåværende fase**, **status** og **neste milepæl** øverst;
- kryss bare av punkter som faktisk er implementert og verifisert;
- la ett konkret neste steg være tydelig — og er flere faser i luften samtidig,
  ett per åpen fase, med hver sin rad i tabellen. En fase som fortsatt har et
  åpent punkt skal aldri kunne bli usynlig fordi en senere fase er startet;
- endrer vi strategi, oppdater planen før eller samtidig med implementeringen;
- ikke før kronologisk endringslogg her — git og PR-ene er historikken.

En fase er ikke ferdig fordi koden finnes. **Ferdigkriteriene må være
verifisert.**

## Målarkitektur

```text
                        Huskis-kildekode
                     HTML + CSS + JavaScript
                              │
                        node build.js
                              │
                            dist/
                              │
                 ┌────────────┴────────────┐
                 │                         │
              Vercel                  Capacitor
                 │                  ┌──────┴──────┐
             huskis.no           Android        iOS
```

`dist/` forblir den kanoniske web-builden. Capacitor skal kopiere denne inn i
de native prosjektene; mobilappen skal ikke ha sin egen kopi av Huskis-logikken.

## Faste arkitekturregler

1. **Ingen omskriving.** Vanilla HTML/CSS/JS er fortsatt produktkoden. React,
   Flutter eller et annet frontendrammeverk innføres ikke som del av
   mobilprosjektet.
2. **Web er førsteklasses.** Native tilpasninger må ikke gjøre browserutgaven
   avhengig av Capacitor eller native API-er. Plattformspesifikk kode gates
   eksplisitt.
3. **`dist/` er inngangen til native.** `node build.js` skal fortsatt være den
   eneste produksjonsbuilden av webkoden. `dist/` sjekkes ikke inn.
4. **Native skall er kildekode.** `android/` og senere `ios/` sjekkes inn når de
   opprettes, fordi native konfigurasjon skal kunne reviewes og reproduseres.
5. **Ingen ekstern `server.url` i produksjon.** Mobilappen skal pakke lokale
   web-assets; den skal ikke bare være en WebView som peker på `huskis.no`.
6. **Ingen OTA før funksjonell paritet.** Først får vi en stabil innebygd
   Android-versjon. OTA introduseres som et eget lag senere.
7. **Gamle klienter skal tåles.** Databaseendringer forblir additive og
   bakoverkompatible. En telefon kan være offline eller kjøre en eldre release
   lenge etter at webappen er oppdatert.
8. **Oppdateringssikkerheten bevares.** Dagens `updateSafety()` og
   synk-/sletteinvarianter skal gjenbrukes, ikke omgås, når mobiloppdateringer
   innføres.
9. **Tooling skal ikke deployes som web-assets.** `package.json`, lockfil,
   Capacitor-konfigurasjon og native mapper skal eksplisitt holdes utenfor
   `dist/` av `build.js`.
10. **Avhengigheter pinnes.** Native/runtime-versjoner skal være eksplisitte og
    reproduserbare; ingen `@latest` i CI eller produksjonsflyt.

## Beslutninger som allerede er tatt

- **Capacitor** er native runtime.
- **Android først**, iOS etter at Android-baselinen er bevist.
- Første native mål er en **debugbuild på fysisk Android-telefon**, ikke Google
  Play.
- **OTA-løsningen er valgt**: `@capawesome/capacitor-live-update`, selvhostet og
  uten sky-konto. Kravene til signering, rollback, kanaler, staged rollout og
  butikkpolicy er vurdert i fase 5-seksjonen, som er autoritativ for
  begrunnelsen.
- PWA er valgfritt og ligger utenfor denne planen inntil det finnes et konkret
  behov.
- Planlagt app-/bundle-ID er **`no.huskis.app`**. Den skal behandles som en
  langsiktig identitet og bekreftes senest før første butikkopplasting.

### Teknisk baseline

| Ledd | Valgt | Hvorfor |
|---|---|---|
| Capacitor | **8.5.0**, pinnet eksakt for `@capacitor/core`, `@capacitor/cli` og `@capacitor/android` | siste stabile major; krever Node 22+, som Huskis-CI allerede bruker |
| Node | 22 | samme pin som `ci.yml` |
| JDK | 21 | `@capacitor/android` kompilerer med `sourceCompatibility`/`targetCompatibility` 21 |
| Android SDK | `minSdkVersion 24`, `compileSdkVersion`/`targetSdkVersion` 36 | Capacitor 8s egne standardverdier (`android/variables.gradle`) |
| Android Gradle Plugin / Gradle | 8.13.0 / 8.14.3 | følger med Capacitor-malen |

Oppgraderinger gjøres senere som egne, bevisste endringer — ikke som en
sidevirkning av en annen PR.

`package.json` er innført for Capacitor og har **ikke** noe `version`-felt, slik
at `version.json.version` fortsatt er `null`: SemVer skal ikke måtte økes per PR.
Release-identiteten er `releaseId`, og den utledes av commiten, ikke av
`package.json` ([`auto-update.md`](auto-update.md)). Den er `private`, har
ingen bundler eller frontendrammeverk, og `package-lock.json` er sjekket inn.
Vercel hopper over install-steget (`installCommand: ""` i `vercel.json`):
`node build.js` har ingen avhengigheter, så produksjonsdeployen skal ikke
installere Android-toolingen.

---

# Fase 0 — plan og rammer

**Mål:** gjøre mobilprosjektet synlig og styrbart før kodeendringer starter.

- [x] Velg grunnarkitektur: eksisterende webapp + Capacitor.
- [x] Velg Android som første plattform.
- [x] Skill mellom native butikkoppdateringer og senere OTA av web-assets.
- [x] Opprett denne levende planen.
- [x] Legg planen inn i `docs/README.md`.

**Ferdigkriterium:** repoet har én eksplisitt plan som senere PR-er oppdaterer.

---

# Fase 1 — mobilfundament og første Android-debugbuild

**Mål:** samme `dist/` som Vercel bruker skal kunne bygges inn i en installérbar
Android-app, uten OTA og uten å endre funksjonaliteten i webappen.

## Implementasjon

- [x] Opprett en minimal `package.json` og lockfil uten å innføre bundler eller
      frontendrammeverk.
- [x] Installer og pin `@capacitor/core`, `@capacitor/cli` og Android-plattformen
      i kompatible versjoner.
- [x] Opprett Capacitor-konfigurasjon med `appName = Huskis`, planlagt
      `appId = no.huskis.app` og `webDir = dist`.
- [x] Generer og sjekk inn `android/`.
- [x] Legg til små npm-skript for den repeterbare kjeden
      `node build.js` → Capacitor sync/copy → Android-build.
- [x] Oppdater `.gitignore` for `node_modules` og genererte native build-output,
      men **ikke** ignorer native prosjektfiler som skal være kildekode.
- [x] Oppdater `build.js` slik at npm-/Capacitor-/native tooling aldri kopieres
      inn i `dist/`.
- [x] Legg til regresjonssjekk som beviser at `dist/` fortsatt bare inneholder
      web-produksjonsartefakter, og at Capacitor peker på `dist/` uten
      produksjons-`server.url`.
- [x] Lag en enkel GitHub Actions-vei som kan produsere en Android debug-APK som
      artifact, slik at fysisk testing ikke avhenger av lokal Android Studio.
- [x] Ikke innfør iOS, OTA, pushvarsler, biometrikk eller annen native
      funksjonalitet i denne fasen.

### Slik henger delene sammen

```text
node build.js  →  dist/  ──►  Vercel (huskis.no)
                        └──►  npx cap sync android
                                 → android/app/src/main/assets/public/
                                 → ./gradlew assembleDebug
                                 → android/app/build/outputs/apk/debug/app-debug.apk
```

| Fil | Rolle |
|---|---|
| `package.json` / `package-lock.json` | npm-manifest for Capacitor-toolingen. Ikke en del av webappen. |
| `capacitor.config.json` | `appId`, `appName`, `webDir = dist`. Ingen `server`-blokk — appen kjører lokale web-assets. |
| `android/` | Det native skallet, sjekket inn som kildekode. Capacitors egen `android/.gitignore` holder Gradle-output, `local.properties`, den kopierte `dist/`-en og de genererte konfigurasjonsfilene ute; `npm run sync:android` gjenskaper alt det. |
| `.github/workflows/android-debug.yml` | Bygger debug-APK-en og laster den opp som artifact `huskis-debug-apk`. Manuell trigger + `pull_request` avgrenset med `paths`, så vanlige Huskis-PR-er ikke betaler for en Gradle-runde. |
| `tests/capacitor-android.test.js` | Vokter invariantene over. |
| `tests/build-version.test.js` | Vokter at toolingen ikke havner i `dist/`, og at `version.json` beholder `version: null`. |

## Verifisering

- [x] `node build.js` er grønn.
- [x] `node tests/build-version.test.js` er grønn.
- [x] Relevante release-/buildtester er grønne etter at `build.js` er endret
      (`release-pipeline`, `db-contract`, `security-headers`, `no-legacy-domain`,
      `i18n`, `shard-distribution`, `capacitor-android`).
- [x] Capacitor kan synkronisere `dist/` inn i Android-prosjektet.
- [x] Gradle kan produsere en debug-APK fra rent checkout.
- [x] APK-en kan installeres på fysisk Android-enhet.
- [x] Appen starter og viser Huskis uten å hente selve UI-et fra `huskis.no`.
- [x] Innlogging mot ekte Supabase fungerer.

Gradle-steget verifiseres i CI, ikke lokalt: `android-debug.yml` bygger fra et
rent checkout og er derfor den autoritative byggtesten. Et utviklingsmiljø uten
Android SDK kan ikke kjøre `./gradlew assembleDebug` — det er forventet og
blokkerer ingenting.

### Slik får du en debug-APK på telefonen

Samme oppskrift gjelder hver gang mobilen skal testes — også for testmatrisen i
fase 2.

1. Actions → **«Android debug-APK»** → «Run workflow» (eller bruk kjøringen
   workflowen selv startet på en PR som rører mobilfundamentet).
2. Last ned artifactet **`huskis-debug-apk`** og pakk ut `app-debug.apk`.
3. Overfør APK-en til telefonen og installer den. Android spør om lov til å
   installere fra ukjent kilde første gang — debug-APK-en er signert med en
   debug-nøkkel, ikke en butikknøkkel. Workflowen konfigurerer ingen signering og
   tar ikke vare på noe nøkkellager, så nøkkelen er den Gradle lager på runneren:
   to kjøringer kan ikke antas å gi samme sertifikat, og da nekter Android å
   installere den ene APK-en over den andre. **Avinstaller den forrige først** —
   det tømmer samtidig appdataen. Skal en måling sammenligne to APK-er uten å
   miste tilstand, må debug-signeringen først bli stabil; det hører hjemme i
   fase 6, som eier signering.
4. Appen viser Huskis fra sine egne innebygde filer. Flymodus + omstart
   bekrefter at UI-et ikke hentes fra `huskis.no` (innlogging krever selvsagt
   nett).

Lokalt gjør `npm run android:debug` det samme, men krever Android SDK.

**Ferdigkriterium:** en fysisk Android-telefon kan kjøre en installert Huskis-
debugbuild fra repoets vanlige web-build, mens browserversjonen fortsatt bygger
og deployes som før. **Oppfylt.**

---

# Fase 2 — funksjonell paritet på Android

**Mål:** bevise at WebView/runtime-laget ikke bryter Huskis' eksisterende
interaksjons- eller datasikkerhetsinvarianter.

## Hvor WebView-laget faktisk skiller seg

Appen kjører NØYAKTIG den samme koden som `huskis.no`, fra sine egne innebygde
filer. Den eneste tekniske forskjellen som betyr noe for klientlogikken er
**originet**: Capacitor serverer filene fra `https://localhost` i stedet for
`https://huskis.no`. Alt som forgrener på origin må derfor tåle den formen:

| Sted | Regel i appen |
|---|---|
| Guarden i `index.html` | rører kun de tre navngitte hostene → appen navigerer aldri seg selv ut på nett |
| `authRedirectUrl()` (`app.js`) | `https://localhost` er IKKE lokal utvikling → auth-lenker peker kanonisk ([`domains-and-urls.md`](domains-and-urls.md)) |
| `update-check.js` | rot-relativ `/version.json` → leser sin egen innebygde fil, ser sin egen build-ID |
| CSP (`index.html`) | `'self'` = det innebygde originet; Supabase er navngitt eksplisitt ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) |

Alle fire er voktet av tester (tabellen under). Ut over dette kjenner webkoden
native-runtimen på nøyaktig ÉN linje: gaten som setter opp broen for systemets
tilbakeknapp (fase 3). `tests/capacitor-android.test.js` holder det unntaket
avgrenset — én linje, gjennom `window.Capacitor.isNativePlatform()` — og feiler
hvis en Capacitor-referanse sniker seg inn noe annet sted i web-kildefilene.

Én ting til skiller runtimene, og den eier vi ikke: Capacitor limer sin egen
bro inn som et INLINE `<script>` rett etter `<head>` (`JSInjector`), altså foran
både innholdssikkerhetspolicyen og tegnsett-erklæringen i `index.html`. Broen
kjører derfor før policyen er lest og blir ikke blokkert av den; til gjengjeld
havner `<meta charset>` utenfor de første 1024 bytene, og dekodingen hviler på
WebView-ens standard (UTF-8). Praktisk konsekvens: at norsk tekst vises riktig i
appen er en observasjon, ikke noe repoet kan garantere — derfor står det i den
fysiske runden.

## Automatisk dekning

Testene kjører den samme koden APK-en pakker, og avgjør derfor **logikken** i
punktene under uavhengig av runtime. De erstatter ikke den fysiske testen; de
gjør at den kan konsentrere seg om det bare en telefon kan svare på.

| Område | Dekkes automatisk av |
|---|---|
| auth-flyten, returadresser, sesjon | `auth-redirect`, `nav-modal`, `account-password-avatar`, `delete-account` |
| språk og kontoinnstillinger | `language`, `i18n`, `account-menu-accordion`, `account-password-avatar` |
| opprette/endre navn/flytte/omorganisere alle nivåer | `item-creation`, `nav-modal`, `group-move`, `object-menu`, `locked-group-creation` |
| dra-og-slipp og trykk-og-hold, begge scope | `dnd-*` (11 filer, mobil-viewport med `hasTouch`) |
| sletting, angre, gjenoppretting, tømming | `trash-modal-layout`, `dnd-trash`, `restore-all-done` |
| synk- og sletteinvarianter (ingen gjenoppståtte/tapte objekter) | `sync-resurrection`, `sync-shared-resurrection`, `sync-dangling-category`, `sync-schema-error` |
| delt innhold, roller, invitasjoner | `roles-and-sections`, `locked-group-creation`, `sync-shared-resurrection` |
| offline → online, og statusen brukeren ser | `sync-status` |
| modaler, popovere, fokus, smale viewporter | `a11y-runtime`, `board-columns`, `trash-modal-layout`, `collapsed-alignment`, `dnd-viewport-clamp` |
| kontrast og berøringsflater (målt i px) | `a11y-contrast`, `a11y-runtime` |
| ingen reload mens tilstanden er utrygg (`updateSafety()`) | `auto-update` (del A og B) |
| lik build-ID ⇒ ingen banner, ingen reload | `auto-update`, `build-version` |
| appen peker ikke mot og reloader ikke `huskis.no` | `capacitor-android`, `canonical-origin`, `auth-redirect` |
| stoppeklokken skiller readiness-punktet fra avvæpningen | `ota-fetch`, `capacitor-android` |
| ingen nettavhengighet på kritisk vei til readiness-punktet | `ota-fetch` (`?authlag=`), `capacitor-android` (posisjonelt) |

## Testet på fysisk Android

Kjørt på telefon med en browserklient innlogget på samme konto samtidig,
etter sekvensen under:

- [x] registrering/innlogging/utlogging;
- [x] språk og kontoinnstillinger;
- [x] opprette, endre navn, flytte og omorganisere alle objektnivåer;
- [x] drag-and-drop og touch-hold på de to DnD-scope-ene;
- [x] sletting, angre, gjenoppretting og permanent tømming;
- [x] synk mellom mobil og browser uten gjenoppståtte eller tapte objekter;
- [x] delt innhold, roller og invitasjoner;
- [x] offline → online;
- [x] bakgrunn → forgrunn;
- [x] tvungen avslutning → ny oppstart;
- [x] tastatur, fokus, modaler, popovere og smale viewporter;
- [x] tilgjengelighet og berøringsflater;
- [x] ingen uventet reload mens lokal/synkende tilstand er utrygg;
- [x] auto-oppdateringsmekanikken oppfører seg forsvarlig i native runtime:
      `/version.json` er rot-relativ, så i appen leser `update-check.js` den
      INNEBYGDE fila og ser alltid sin egen build-ID. Den viser altså verken
      oppdateringsbanner eller reloader. Å faktisk kunne oppdatere
      web-assetene er fase 5.

**Ingen feil med datatap, synkfeil eller blokkert kjernefunksjon.**

Auth-returadressen fra WebView-originet ble funnet i gjennomgangen før runden,
ikke av runden. Trinn 1 bekreftet at bekreftelseslenken peker kanonisk, men det
trinnet kan ikke alene skille en fikset klient fra en ufikset: sender klienten
en returadresse som ikke står i Supabase' tillatelsesliste, faller den tilbake
til Site URL, og lenken ser riktig ut uansett. Det er
`tests/auth-redirect.test.js` som beviser at appen faktisk SENDER den kanoniske
adressen fra `https://localhost`.

Runden selv fant ett avvik, i demonstrasjonen: instruksen på steget «Slett
listepunktet» er lang, og når objektmenyen åpner seg må kortet vike for både
målet og panelet. Kortet blinket da opp og ned. Årsaken lå i delt kode, ikke i
native runtime — `placeTour()` målte kortets høyde mens forrige rundes
`maxHeight` sto på, altså sin egen forrige beslutning, og vekslet dermed mellom
kappet og ukappet. Browseren hadde den samme løkka, men fyrer ikke
scroll/resize ofte nok til at den ble synlig. Rettet ved å måle ukappet;
regresjonen ligger i `tests/onboarding.test.js` (sjekk 11b), som feiler uten
fiksen på mobil-viewport. Etterkontrollert på telefonen: boblen står stille.

TalkBack leste norsk tekst med engelsk stemme. Det er telefonens
TTS-stemmeutvalg, ikke Huskis: `lang`-håndteringen er på plass
([`tilgjengelighet.md`](tilgjengelighet.md)), og en installert norsk stemme
løser det.

Feil som finnes både i browser og mobil er ordinære Huskis-feil. Feil som bare
finnes i native runtime skal få avgrensede plattformtilpasninger og egne tester.

## Slik kjører du den fysiske runden

Dette er oppskriften runden over ble kjørt etter, og den gjenbrukes ved
etterkontroll og på iOS i fase 7. Én sammenhengende økt dekker hele lista.
Oppsett: debug-APK-en installert
(oppskrift i fase 1), `huskis.no` åpen i en nettleser på en annen maskin, og en
**ny testkonto** (T) som brukes begge steder — registreringen er selv et
testpunkt. Din vanlige konto (P) er motparten når deling skal testes.

| # | Gjør | Forventet | Dekker |
|---|---|---|---|
| 1 | Registrer konto T i appen. Åpne bekreftelseslenken fra e-posten. | Norsk tekst vises riktig (æ, ø, å — se dekodingsnotatet over). Lenken peker på `huskis.no` — aldri `localhost`. Bekreftelse fullfører, og innlogging i appen gir en sesjon. | registrering, auth-lenker, tegnsett |
| 2 | Kjør demonstrasjonen som møter T ved første innlogging. | Alle stegene lar seg utføre med finger: opprette, endre navn, dra, slette. | opprette/endre/flytte, dra-og-slipp, sletting |
| 3 | Bytt språk til engelsk og tilbake i konto-modalen. | Appen laster seg selv på nytt fra de innebygde filene, uten hvit skjerm og uten nettkrav for UI-et. | språk, kontoinnstillinger |
| 4 | Bygg en liten struktur: område → mappe → liste → tre punkter, og endre navn på hvert nivå. | Skjermtastaturet dekker ikke feltet som redigeres, fokus lander riktig, og Enter avslutter. | objektnivåene, tastatur/fokus, smale viewporter |
| 5 | Dra: omorganiser punkter, flytt et punkt til en annen liste, flytt en liste via navigasjonsknappen, og omorganiser områder/mapper i navigasjonsmodalen. | Trykk-og-hold tar tak, siden scroller ikke under gesten, og slippet lander der forhåndsvisningen viste. | begge DnD-scope, berøringsflater |
| 6 | Logg inn som T i nettleseren. Endre navn på noe der, opprett ett objekt til. | Alt fra telefonen er der, og nettleserens endringer dukker opp på telefonen. | synk mobil ↔ browser |
| 7 | På telefonen: slett et punkt og angre. Slett en liste, gjenopprett den fra søppelkassen. Slett en til og tøm kassen. | Angre gir punktet tilbake. Det permanent slettede kommer ALDRI tilbake — heller ikke etter at nettleseren har synket. | sletting/angre/gjenoppretting/tømming, synkinvarianter |
| 8 | Del et område fra telefonen med konto P. Godta invitasjonen som P i nettleseren, og endre noe der. | Rollen og rettighetene er som i web, og endringen når telefonen. | delt innhold, roller, invitasjoner |
| 9 | Slå på flymodus. Opprett og slett noe. Tving appen helt ut av minnet og start den igjen — fortsatt i flymodus. | Statuslinjen sier «Frakoblet – endringene lagres på denne enheten», og endringene er der etter omstart. Du er fortsatt innlogget. | offline, tvungen avslutning → ny oppstart |
| 10 | Slå av flymodus. La appen ligge i forgrunnen et par minutter, send den til bakgrunnen underveis og hent den tilbake. | Statusen går til «Lagret», nettleseren viser det samme, og appen laster seg ALDRI på nytt av seg selv — intet oppdateringsbanner, ingen halvskrevet tekst som forsvinner. | online, bakgrunn → forgrunn, ingen uventet reload, auto-oppdatering i native runtime |
| 11 | Slå på TalkBack og gå gjennom punkt 9, 12 og 13 i den manuelle sjekklista i [`tilgjengelighet.md`](tilgjengelighet.md). Slå den av igjen, logg ut og logg inn på nytt. | Kontrollene leses opp med meningsfulle navn, modaler fanger fokus, og utlogging/innlogging virker som i web. | tilgjengelighet, utlogging/innlogging |

Rapporter et avvik med: trinnummeret, hva som faktisk skjedde, hva statuslinjen
(`#sync-status`) sa, og om det samme skjer i nettleseren på samme konto. Det
siste avgjør om det er en ordinær Huskis-feil eller en native-spesifikk feil.

**Ferdigkriterium:** ingen kjent Android-spesifikk feil kan gi datatap,
synkfeil, blokkert kjernefunksjon eller vesentlig dårligere tilgjengelighet enn
webversjonen. **Oppfylt.**

---

# Fase 3 — nødvendige native integrasjoner

**Mål:** gjøre appen naturlig å bruke som Android-app uten å bygge native
funksjoner bare fordi de er mulige.

- [x] Definer korrekt system-tilbakeoppførsel: lukk øverste popover/modal,
      naviger ett Huskis-nivå tilbake der det er naturlig, og la OS håndtere
      resten.
- [x] Verifiser safe areas, status-/navigasjonsfelt og skjermtastatur.
      Implementert, automatisk dekket, og hele den fysiske sekvensen kjørt —
      inkludert punkt 10, som er kjørt om igjen med rettingen inne og bekreftet
      på telefon (identisk i lys og mørk modus, lesbart i begge).
- [x] Definer hvilke eksterne lenker som åpnes i systembrowser og hvilke som
      forblir i appen. Regelen er skrevet ned og voktet, og selve rutingen
      krevde ingen kode: Capacitors egen ruting gjør nøyaktig det regelen sier.
      Appen har siden fått sin første utgående lenke — adressen i et notat —
      og den går gjennom ÉN funksjon (`openExternalUrl`), som er den samme i
      nettleseren og i skallet. Se seksjonen for den fysiske sekvensen.
- [x] Gjør auth-/e-postlenker robuste; vurder Android App Links og senere iOS
      Universal Links slik at bekreftelse/reset kan returnere til appen.
      Kartlagt og avgjort: lenkene er robuste, App Links utsettes til fase 6.
      Krevde ingen kode i appen — TAPPET i auth-lenkene går til Supabase, ikke
      til `huskis.no`, så et intent-filter ser ikke selve trykket. Om 303-en
      videre havner i appen er et åpent spørsmål som skal prøves på telefon
      (se seksjonen).
- [x] Koble native lifecycle/network-signaler til eksisterende synklogikk bare
      der websignalene ikke er tilstrekkelige. Kartlagt, avgjort og målt på
      fysisk Android: ingen native lifecycle-/network-plugin trengs.
      `visibilitychange` starter synkrunden når prosessen lever; når Android har
      fryst prosessen, leveres hendelsen ikke og det forfalte 5-sekunderspollet
      starter runden straks prosessen tiner. `ACCESS_NETWORK_STATE` er lagt til
      fordi `navigator.onLine` ellers sto permanent `true` i flymodus. Begge
      regimene er låst av `tests/sync-foreground.test.js`.
- [x] Vurder sikker lagring av native-spesifikke secrets/tokens dersom det
      faktisk finnes et behov; ikke flytt data ut av dagens modell uten grunn.
      Ta samtidig stilling til `android:allowBackup`. Kartlagt og avgjort: det
      finnes ingen native-spesifikke secrets, så ingen data flyttes ut av
      dagens modell og intet keystore-lag innføres. `android:allowBackup` er
      derimot slått AV, sammen med regler for datauttrekk: WebView-lagringen
      bærer både Supabase-sesjonen og hele bufferen, og den skal bli på enheten
      (se seksjonen).

## Systemets tilbakeknapp

**Hva den gjorde før:** forlot appen ved FØRSTE trykk, uansett hva som stod
åpent. Ikke en beslutning noen hadde tatt — `@capacitor/android` 8.5.0 har
ingen back-håndtering i det hele tatt (ingen `onBackPressed`, ingen
`OnBackPressedCallback`, ingen `KEYCODE_BACK`; det eneste treffet på
«backButton» i pakken er en Cordova-kompatibilitetsstubbe i `native-bridge.js`).
`BridgeActivity` arver dermed AppCompats standard, og WebView-en får aldri
trykket. Huskis navigerer heller ikke med History API-et, så det fantes ingen
historikk å gå tilbake i.

**Hva den gjør nå:** ett lag per trykk, ovenfra og ned — inline-redigering,
så øverste popover/modal — og faller gjennom til OS når ingenting er åpent.
Del-modalen som ble åpnet fra nav-modalen går ett nivå tilbake dit, i stedet
for å lukke helt. Autoritativt for stigen og hvorfor hovedsiden er bunnen:
[`menus.md`](menus.md) («Systemets tilbakeknapp»).

| Ledd | Rolle |
|---|---|
| `closeTopLayer(viaBack)` (`app.js`) | ÉN stige, to innganger: Escape og tilbakeknappen. |
| `systemBack()` (`app.js`) | Tilbakeknappens inngang. Returnerer true når Huskis tok trykket. |
| gaten (`app.js`, én linje) | Setter `window.__huskisSystemBack` KUN når `window.Capacitor.isNativePlatform()` er sann. Nettleseren får ingen bro. |
| `MainActivity.java` | `OnBackPressedCallback` → spør broen → videresender til `OnBackPressedDispatcher` når svaret er false. Kaller ikke `finish()` selv; OS avgjør hva et tilbaketrykk på rot-aktiviteten betyr. |
| `android/app/build.gradle` | `androidx.activity` eksplisitt på kompileringsstien (Capacitor drar den inn som `implementation`, altså ikke til appmodulen). |
| `tests/system-back.test.js` | Stigen i ekte nettleser, begge viewportene: gaten, ett lag per trykk, del-modalens nivå tilbake, redigering avbrutt, demoen urørt, og at ingenting-åpent gir false. |
| `tests/capacitor-android.test.js` | Gaten er avgrenset til én kodelinje, og skallet spør web-laget før OS. |

### Testet på fysisk Android

Sekvensen under er kjørt i sin helhet på telefon, uten avvik. Den gjenbrukes
ved etterkontroll og på iOS i fase 7.

Debug-APK som i fase 1. Bruk gestenavigasjon ELLER treknappsraden — begge
lander i den samme `OnBackPressedDispatcher`-en, så én av dem holder; kjør
gjerne punkt 1 og 6 i begge for å se at gesten oppfører seg likt.

| # | Gjør | Forventet |
|---|---|---|
| 1 | Åpne nav-modalen. Tilbake. | Modalen lukkes. Appen står fortsatt åpen på hovedsiden. |
| 2 | Åpne nav-modalen → objektmenyen på et områdekort. Tilbake, tilbake. | Først lukkes menyen (nav-modalen står), så nav-modalen. |
| 3 | Åpne objektmenyen på en liste → «Flytt» → «Flytt til …». Tilbake. | Velgeren lukkes, objektmenyen står igjen. |
| 4 | Åpne «Deling og medlemmer» fra en mappe i nav-modalen. Tilbake. | Del-modalen lukkes og nav-modalen kommer tilbake — samme sted som ← i overskriften. |
| 5 | Start en omdøping (menyen → «Endre navn»), skriv litt. Tilbake til tastaturet er borte, så tilbake igjen. | Første trykk lukker tastaturet (Android selv). Neste avbryter redigeringen — det gamle navnet står, og ingen modal bak ble lukket. |
| 6 | Stå på hovedsiden uten noe åpent. Tilbake. | Appen forlates som en vanlig Android-app; oppgaven ligger igjen, og et nytt trykk på ikonet tar deg rett tilbake — fortsatt innlogget, samme sted. |
| 7 | Under demonstrasjonen (ny konto, eller «Vis på nytt»): tilbake. | Demoen avbrytes ikke bakveien; trykket forlater appen. ✕ i kortet er utgangen. |
| 8 | Slå på flymodus, opprett noe, og trykk tilbake til appen forlates. Åpne den igjen. | Ingen tapte endringer, ingen dobbeltlagring, statuslinjen som før. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, og om det
samme skjer i nettleseren med Escape. Er svaret ja, er det en ordinær
Huskis-feil i stigen — ikke en Capacitor-tilpasning.

## Safe areas, systemfeltene og skjermtastaturet

**Hva runtimen faktisk gjør.** `@capacitor/android` 8.5.0 har en innebygd
`SystemBars`-plugin (ingen npm-plugin, ingen konfigurasjon — `insetsHandling`
står på `css`). Den lytter på vinduets insets og har TO utfall, og hvilket vi
får avgjøres av ÉN ting i webkoden: om den siste `meta[name=viewport]`-taggen
inneholder `viewport-fit=cover`.

| Uten `viewport-fit=cover` | Med `viewport-fit=cover` |
|---|---|
| Pluginen SPISER inset-ene (setter dem til 0) og polstrer WebView-ens forelder med dem på Android 15+ | Inset-ene slippes gjennom til WebView-en |
| WebView-en ligger altså MELLOM systemfeltene | WebView-en dekker hele skjermen |
| `env(safe-area-inset-*)` er 0 inne i siden | `env(safe-area-inset-*)` har de faktiske målene |
| Feltene og gestelinjen viser vindusbakgrunnen fra AppCompat-temaet, ikke Huskis' egen flate | Huskis' egen flate når helt ut i skjermkantene |

Ingen av dem KLIPPER noe — det er den samme pluginen som holder innholdet unna
systemflatene i begge. Forskjellen er hvem som gjør jobben, og hvordan det ser
ut. Uten `cover` blir appen stående med to striper i temaets vindusbakgrunn i stedet
for i Huskis' egen flate. Derfor er `cover` valgt: appen tegner selv helt ut, og
holder innholdet innenfor med CSS.

Skjermtastaturet håndteres av den samme lytteren: når IME-en er synlig får
WebView-ens forelder en bunn-polstring like høy som tastaturet, og
`env(safe-area-inset-bottom)` settes samtidig til 0. Tastaturet KRYMPER altså
viewportet — det legger seg ikke oppå det, og det skyver ikke siden opp.
`android:windowSoftInputMode="adjustResize"` i manifestet gjør det samme valget
eksplisitt for de Android-versjonene der pluginen ikke polstrer selv; uten
erklæringen står modusen på «unspecified», og krymp-eller-skyv er systemets valg.

**Hva Huskis gjør.** Fire tokens (`--safe-top`/`-right`/`-bottom`/`-left`) leser
`env(safe-area-inset-*)` ett sted, og alt som ligger fast mot en viewport-kant
legger dem på sin egen avstand. Autoritativt:
[`design-system.md`](design-system.md) («Den sikre sonen»).

| Ledd | Rolle |
|---|---|
| `viewport-fit=cover` (`index.html`) | Ber om å få tegne under systemfeltene — det er det som gir sonen verdier i det hele tatt. |
| `--safe-*` (`styles.css`) | Sonen som fire tall. Toppmenyen, kontoknappen, board-et, modal-/popover-skallet, toasten, lagringsstatusen og oppdateringsbanneret legger dem på. |
| `safeInsets()` (`app.js`) | Det som regnes ut i JS leser sonen herfra: demonstrasjonens kort, popoveren på desktop, kolonnebudsjettet og dra-og-slippets to scroll-grenser klemmer mot den brukbare bunnen i stedet for mot skjermkanten. |
| `scroll-padding-top` (`styles.css`) | Sidens rulling vet at det faste panelet dekker toppen, så et felt som rulles fram ikke havner under det. |
| resize-lytteren (`app.js`) | Tastaturet krymper viewportet ⇒ feltet som redigeres rulles tilbake i syne. |
| `android:windowSoftInputMode` (manifestet) | Tastaturet krymper vinduet, det skyver det ikke. |
| `values/styles.xml` + `values-v27/` | Systemfeltenes UTSEENDE om dagen: DayNight-foreldretema, gjennomsiktige felt og MØRKE glyfer. Uten glyferklæringen ligger klokka som lyse glyfer over Huskis' lyse flate. |
| `values-night/` + `values-night-v27/` | Det samme om natten: vindusbakgrunnen bak feltene er nå mørk, så glyfene snus til LYSE. |
| `SystemBars.style = "DEFAULT"` (`capacitor.config.json`) | Pluginen setter glyffargen i RUNTIME og overstyrer temaet. `DEFAULT` = les telefonens nattmodus — den samme kilden temaet snur vindusbakgrunnen etter, så flaten og glyfene over den ikke kan skille lag. Se avsnittet under. |
| `tests/safe-area.test.js` | Setter sonen i ekte nettleser og måler at chromet flytter seg nøyaktig så mye — begge viewportene, begge board-scopene. Dekker også de to tastatur-tilfellene. |
| `tests/capacitor-android.test.js` | De to erklæringene sonen hviler på, i hver sin fil. |

Runden trengte **ingen native API-er**: `env()` er inert i en nettleser, så
CSS-en gjør hele jobben, og webkoden kjenner fortsatt native-runtimen på
nøyaktig ÉN linje — gaten for tilbakeknappens bro. Unntaket i
`tests/capacitor-android.test.js` er derfor uendret.

### Testet på fysisk Android

Sekvensen under er kjørt i sin helhet på telefon, og punkt 10 en gang til med
rettingen inne. Punkt 1–6 og 9 uten avvik.
Punkt 7–8 (landskap) avdekket to ordinære Huskis-feil — begge var der i
nettleseren på samme viewport, og begge er rettet: toppmenyen står nå på ÉN
linje når bredden rekker ([`menus.md`](menus.md)), og demonstrasjonens kort er
aldri høyere enn skjermen ([`introduksjon.md`](introduksjon.md)). De to
rettingene er verifisert i nettleseren på det samme viewportet, ikke kjørt om
igjen på telefon — de er ren webkode, uten en plattformbit som kan oppføre seg
annerledes der. Vakten er
`tests/landscape-chrome.test.js`. Sekvensen gjenbrukes ved etterkontroll og på
iOS i fase 7.

Punkt 10 kom TIL etter runden: skjermbilder fra telefonen viste at klokka og
statusikonene lå som lyse glyfer over Huskis' lyse flate. Rettingen tok to
runder, og det er verdt å huske hvorfor — systemfeltenes utseende settes to
steder:

1. **temaet** (`values/styles.xml`): lyst foreldretema, gjennomsiktige felt,
   `windowLightStatusBar`. Det fjernet den svarte stripen i mørk modus, men
   glyfene ble fortsatt snudd;
2. **`SystemBars`-pluginen**, som setter utseendet i RUNTIME og dermed
   overstyrer temaet. Med standardverdien leser den telefonens nattmodus, så
   mørk modus ga lyse glyfer. `SystemBars.style = "LIGHT"` i
   `capacitor.config.json` låser den.

Begge voktes i `tests/capacitor-android.test.js`. Utfallet var bekreftet på
telefon: appen så identisk ut i lys og mørk modus, med godt lesbar tekst i
begge.

**Punktet ble utfordret da appen fikk to drakter** ([`mork-drakt.md`](mork-drakt.md)),
og det tok to runder til. Begge er verdt å skrive ned.

**Runde 3 (feilet på telefon).** Resonnementet var: siden appen tegner under
systemfeltene, er flaten bak klokka vår egen — altså `#141922` i mørk drakt, og
da må mørke glyfer bli uleselige. Stilen ble satt til `DEFAULT`, som lar
pluginen følge telefonens nattmodus, mens temaet ble stående permanent lyst.
**På telefon var det uleselig i BEGGE modi:** båndet bak statusfeltet er ikke
sidens flate, men VINDUSBAKGRUNNEN fra temaet, og den var lys uansett drakt.
`DEFAULT` ga dermed lyse glyfer på et lyst bånd — nøyaktig den uleseligheten
punkt 10 fjernet.

**Runde 4 (denne, verifisert på telefon).** Feilen var ikke `DEFAULT` i seg
selv, men at båndet og glyfene hadde hver sin kilde. Foreldretemaet er derfor
`Theme.AppCompat.DayNight` igjen, med `values-night/` + `values-night-v27/` som
snur glyfene, og `SystemBars.style` tilbake på `DEFAULT`. Da leser flaten OG
glyfene den samme nattmodusen og kan ikke skille lag — uavhengig av hvilken
drakt brukeren har valgt i appen, som ikke rører systemfeltene i det hele tatt.
Den «svarte stripen» night-varianten ga i runde 1 er dessuten ikke lenger en
feil: nå ER den flaten, og den skal være mørk når appen er mørk.

Samme endring fikser en annen ting bare temaet kan fikse: fra targetSdk 33
utleder WebView `prefers-color-scheme` av appens eget tema (`isLightTheme`), så
med et permanent lyst tema ga draktens standardvalg «Følg systemet» lys app på
en mørk telefon.

Begge deler er bekreftet på enhet: appen blir mørk av seg selv på en mørk
telefon med drakten på «Følg systemet», og klokka og statusikonene er lesbare i
begge drakter — også når drakten overstyres mot telefonens modus.

Lærdommen er verdt å ta med til iOS i fase 7: **båndet bak systemfeltene er
temaets flate, ikke sidens, og glyfene må ha samme kilde som flaten under dem.**
Runde 1 og 3 så begge riktige ut i koden og feilet på enheten. Bare en telefon
avgjør dette.

Debug-APK som i fase 1, på en telefon med hakk ELLER hull i skjermen og med
**gestenavigasjon** slått på. Kjør punkt 1 og 6 en gang til med treknappsraden,
og punkt 7–8 i landskap.

| # | Gjør | Forventet |
|---|---|---|
| 1 | Start appen og se på toppen. | Huskis' egen flate går helt opp i skjermkanten (ingen grå/svart stripe), men breadcrumben og kontoknappen står HELT under statusfeltet/hakket — ingen tekst eller knapp er delvis dekket. |
| 2 | Se på bunnen med innhold som fyller skjermen. | Nederste listekort kan rulles helt fram; gestelinjen dekker det ikke. Luften under siste kort ser ut som luften ellers. |
| 2b | Dra en liste helt ned til board-et auto-scroller, og slipp den nederst. | Auto-scrollen rekker helt til enden — den slupne lista blir ikke stående delvis under gestelinjen. |
| 3 | Utløs en toast (slett et listepunkt) og se på lagringsstatusen samtidig. | Begge ligger over gestelinjen, og de overlapper ikke hverandre. |
| 4 | Åpne nav-modalen, konto-modalen og en objektmeny. | Overskrift og lukkeknapp er aldri under statusfeltet; nederste rad er aldri under gestelinjen. |
| 5 | Endre navn på et listepunkt NEDERST på skjermen. | Tastaturet kommer opp, og feltet blir stående synlig over det — det havner verken under tastaturet eller under toppmenyen. Enter avslutter. |
| 6 | Endre navn på et listepunkt som ligger like under toppmenyen. | Feltet rulles fram under panelet, ikke bak det. |
| 7 | Snu telefonen til landskap med hakket til venstre. | Ingen knapp eller tekst ligger under hakket; board-ets venstre kolonne starter til høyre for det. |
| 8 | I landskap: åpne objektmenyen på et listepunkt, og kjør «Vis på nytt» av demonstrasjonen. | Popoveren og demo-kortet holder seg innenfor det brukbare feltet — ikke under hakket, statusfeltet eller gestelinjen. |
| 9 | Slå på mørk modus på telefonen og gjenta punkt 1. | Appen er fortsatt lys hele veien ut i kantene; ingen mørk stripe dukker opp øverst eller nederst. |
| 10 | Se på klokka, batteriet og gestelinjen i BEGGE modusene. | Glyfene er mørke og lette å lese mot Huskis' lyse flate — i lys modus like godt som i mørk. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, og om det
samme skjer i nettleseren på samme viewport. Er svaret ja, er det en ordinær
Huskis-feil — ikke en Capacitor-tilpasning.

## Eksterne lenker

**Kartleggingen først.** Huskis' UI har ikke én utgående lenke: null `<a>`-tagger
med absolutt adresse, null `target="_blank"`. De to eneste adressene utenfor
eget origin som står HARDKODET i frontend er Supabase-endepunktet (data over
`fetch`/WebSocket, ikke navigasjon) og `canonicalAppUrl` (går inn i
auth-lenkene Supabase sender på e-post, og navigeres aldri til). Appen
navigerer seg selv nøyaktig ett sted: `location.replace(target)` i guarden
øverst i `index.html` — og den rører kun de tre navngitte redirect-hostene, så
i appen, der verten er `localhost`, gjør den ingenting.

**Regelen som ble valgt:** appens eget origin lastes inne i appen, alt annet
åpnes i systembrowseren. Autoritativt, med begrunnelse og de tre grensetilfellene:
[`domains-and-urls.md`](domains-and-urls.md) («Eksterne lenker»).

**Rutingen krevde ingen kode.** Capacitors `BridgeWebViewClient.shouldOverrideUrlLoading()`
→ `Bridge.launchIntent()` sender allerede hver adresse med et annet skjema+vert
enn appens ut som `Intent.ACTION_VIEW`. Det ER regelen. Å legge en
`@capacitor/browser`-plugin (Custom Tab) oppå ville vært et native API for et
behov som ikke finnes — og fase 1 har med vilje ingen plugins utover kjernen.
Web-laget kjenner derfor fortsatt native-runtimen på nøyaktig ÉN gated linje,
broen for tilbakeknappen; unntaket i `tests/capacitor-android.test.js` er
uendret.

**Appen HAR nå én utgående lenke: adressen i et notat.** Den åpnes gjennom
`openExternalUrl()` i `app.js` — ett kall,
`window.open(url, '_blank', 'noopener')`, med `safeNoteUrl()` foran seg
([`domains-and-urls.md`](domains-and-urls.md), «Lenker i notater»). Det er
BEVISST den samme mekanismen i begge kjøremiljøene, og ikke et nytt plugin:

- WebView-en står med `supportMultipleWindows = false` — Capacitors standard,
  og `BridgeWebChromeClient` har ingen `onCreateWindow`. Da er `window.open`
  ikke et nytt vindu, men en vanlig navigasjon i den samme WebView-en;
- og en vanlig navigasjon går gjennom `shouldOverrideUrlLoading` →
  `launchIntent()`, som sender adressen ut som `ACTION_VIEW` og svarer `true`.
  Siden lastes altså aldri inne i WebView-en, og Huskis blir stående med
  tilstanden sin.

Web-laget kjenner fortsatt ikke native-runtimen her: kallet er det samme i
nettleseren, der det åpner en fane.

| Ledd | Rolle |
|---|---|
| `capacitor.config.json` uten `server.allowNavigation` | Det ene feltet som kan slå regelen av: hver oppføring der er en vert som lastes INNE i WebView-en. Den får ikke Huskis' data — Web Storage er origin-skilt — men den får Capacitor-broen, som injiseres i WebView-en og ikke i et bestemt origin ([`domains-and-urls.md`](domains-and-urls.md)). |
| `MainActivity.java` | Overtar ikke `WebViewClient`/`shouldOverrideUrlLoading`, og navigerer ikke WebView-en direkte med `loadUrl` — rutingen er Capacitors, ikke vår. |
| CSP `default-src 'none'` + `form-action 'self'` (`index.html`) | To av de tre unntakene fra rutingen: en fremmed side kommer ikke inn som `<iframe>`, og et skjema kan ikke sendes til et annet origin — heller ikke med POST, som ikke når `shouldOverrideUrlLoading` ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)). Det tredje er `data:`/`blob:`, som blir i WebView-en — appen bruker dem bare til bilder, og en framtidig NAVIGASJON dit må kreve at nyttelasten er uavhengig etterprøvd ([`domains-and-urls.md`](domains-and-urls.md)). |
| `tests/capacitor-android.test.js` (del 12) | De to måtene å miste regelen på: `allowNavigation`, og web-kildekode som begynner å produsere utgående lenker. Vokter også at den ene selvnavigasjonen fortsatt er guardens, og at den ene tillatte `window.open` står nøyaktig ett sted — i `openExternalUrl`, bak `safeNoteUrl` — i kilden, i `dist/` og i den synkede builden. |

**De to grensetilfellene, avgjort.** Auth-lenkene i e-post kommer fra utsiden og
røres ikke av regelen: e-postklienten gir adressen til telefonens standardapp
for den — browseren — og Huskis har ikke noe intent-filter som gjør krav på
noen vert (neste seksjon). URL-er brukeren selv skriver i et
listepunkt er ren tekst og forblir det: å gjøre dem klikkbare er en
produktendring med egne spørsmål, ikke en native integrasjon. En lenke i et
NOTAT er derimot lagt inn med vilje, og den følger regelen — den forlater
WebView-en som enhver annen fremmed adresse.

### Å prøve på telefon: nå finnes det noe å trykke på

Punktet hadde lenge **ingen fysisk sekvens** — appen hadde ingen lenke som
kunne tappes, så det fantes ingen handling en telefon kunne svart annerledes
på. Det som var verifisert, var kildekoden: Capacitors ruting er LEST i
`node_modules/@capacitor/android`, ikke observert på en enhet.

Med lenker i notater finnes handlingen. Sekvensen, når en debug-APK er på en
telefon:

| # | Handling | Forventet | Dekker |
|---|---|---|---|
| 1 | Lag et notat, marker et ord, sett lenken til `https://huskis.no`, trykk «Åpne». | Telefonens browser åpner adressen. Huskis blir liggende i bakgrunnen. | `window.open` → `shouldOverrideUrlLoading` → `ACTION_VIEW` |
| 2 | Gå tilbake til Huskis med systemets tilbakeknapp/oppgavebytteren. | Editoren står som før, med samme notat, samme markør og uten å ha lastet på nytt. | at WebView-en aldri navigerte |
| 3 | Sett lenken til `mailto:noen@example.com` og åpne den. | E-postklienten åpnes med adressen utfylt. | at «ut av appen» ikke betyr «i browseren» |
| 4 | Sett lenken til `javascript:alert(1)` og trykk «Åpne». | Ingenting åpnes; toasten sier at adressen ikke kan brukes. | `safeNoteUrl` som andre lag |

Skillet mellom lest kode og observert enhet er fortsatt verdt å holde fast på,
av samme grunn som systemfeltene i forrige punkt. Neste punkt gir ikke denne
observasjonen: App Links handler om lenker INN i appen, og det punktet endte
uten kode.

## Auth-/e-postlenker og App Links

**Kartleggingen først.** Huskis sender fem e-poster med en lenke i. Hvilken app
som svarer på telefonen avgjøres av verten i lenken brukeren faktisk trykker på,
og den er ikke `huskis.no` i de tre som bærer en HANDLING: Supabase
Auth-e-postene (bekreft registrering, tilbakestill passord, bekreft ny adresse)
peker på prosjektets egen verify-adresse på `*.supabase.co`, og `huskis.no` er
bare der 303-en LANDER. De to som peker rett på det kanoniske originet —
delingsinvitasjonen fra Resend, og fotnoten i varselet om endret adresse — er
nettopp de to som ikke bærer noen sesjon. Hele tabellen, med hva som skjer i
hvert enkelt tilfelle:
[`domains-and-urls.md`](domains-and-urls.md) («Auth-lenkene i e-post»).

**Konsekvensen i dag:** lenken åpner browseren, og handlingen fullføres DER —
kontoen blir bekreftet, passordet blir satt, adressen blir byttet. For
registrering og passordgjenoppretting står appen igjen ulogget, og prisen er én
ekstra innlogging; adressebyttet koster ikke engang det, siden det starter fra
en app som allerede er innlogget. Ingen av dem er en brutt flyt. At det
ikke er verre henger på at klienten kjører supabase-js' standard `implicit`-flyt:
tokenene kommer i fragmentet, ikke som en `?code=` som må byttes inn med en
PKCE-verifikator lagret i originet som startet flyten. Startet i appen
(`https://localhost`) og fullført i browseren (`huskis.no`) ville en PKCE-flyt
ikke kunnet fullføres i det hele tatt.

**Beslutningen: App Links utsettes til fase 6**, sammen med signeringsnøkkelen.
Fire endringer trengs uansett: intent-filteret på `MainActivity`, statementet på
originet, det selektive unntaket i `copyDir()` som faktisk får statementet
publisert, og lesing av den innkommende adressen (`@capacitor/app` + **en gate
til** i web-koden) — både ved KALDSTART (`getLaunchUrl()`, det vanlige når man
kommer fra e-post) og ved en ny intent (`appUrlOpen`). To andre er BETINGET av et spørsmål
ingen kan svare på herfra: verten i auth-lenkene er `*.supabase.co`, men de
ENDER på `huskis.no` — og om browseren leverer fra seg på slutten av en
redirect-kjede, slik native OAuth-klienter bygger på, avgjøres på en telefon.
Holder den veien, kan malene og `{{ .ConfirmationURL }}` stå som de er; holder
den ikke, kommer e-postmalene og `verifyOtp()` i tillegg. Begrunnelsen i sin
helhet:
[`domains-and-urls.md`](domains-and-urls.md) («Android App Links: hvorfor ikke
ennå»). iOS Universal Links har samme struktur og hører til fase 7.

**Punktet krevde derfor ingen kode.** Web-laget kjenner fortsatt native-runtimen
på nøyaktig ÉN gated linje — broen for tilbakeknappen — og unntaket i
`tests/capacitor-android.test.js` er uendret. Det som ER gjort, er å gjøre den
utsatte innføringen umulig å gjøre halvveis.

| Ledd | Rolle |
|---|---|
| `authRedirectUrl()` (`app.js`) | Sender allerede den kanoniske adressen fra WebView-originet, altså den ene formen App Links en gang kan fange. Voktet av `tests/auth-redirect.test.js`. |
| `AndroidManifest.xml` uten `<data android:scheme="https">` | Manifest-halvdelen. Finnes ikke i dag; innføres den alene, verifiserer Android ingenting. |
| `.well-known/assetlinks.json` (finnes ikke) | Origin-halvdelen: `no.huskis.app` + signeringsnøkkelens SHA-256. Repo-eid — Vercel serverer `dist/`, og `build.js` fyller den. |
| `copyDir()` i `build.js` | Den tredje halvdelen, og den lettest oversette: den hopper over hvert navn som starter med punktum, så en `.well-known/`-katalog havner i dag ikke i `dist/`. Innføres statementet, må dette endres i samme slengen — og fritaket må være SELEKTIVT. Fjernes prikk-regelen helt, publiseres `.gitignore` og hver framtidige skjulte fil på `huskis.no` med det samme. |
| `tests/capacitor-android.test.js` (del 13) | Vakten: halvdelene innføres sammen eller ikke i det hele tatt; filteret er komplett (`VIEW` + `DEFAULT` + `BROWSABLE` + `https`) og ber om verifisering; statementet navngir riktig appId med et fingeravtrykk på riktig form, og det når faktisk `dist/`; og noe leser den innkommende adressen. Manifestene leses uten XML-kommentarer og i ALLE source set-ene — Gradle slår dem sammen, så et filter i `src/release/` teller like fullt. |

### Ikke prøvd på telefon — det finnes ingen lenke som kan fange

Som forrige punkt har dette **ingen fysisk sekvens**, og det er en konsekvens av
beslutningen, ikke en utsettelse: uten et intent-filter finnes det ingen
oppførsel en telefon kunne svart annerledes på enn den allerede gjør i fase 2s
punkt 1 (bekreftelseslenken åpner browseren, og innlogging i appen etterpå gir
en sesjon — kjørt, uten avvik).

**Debugnøkkelen er verdt å si presist.** Debug-APK-en er signert med Androids
automatisk genererte debugnøkkel, og CI-runnerne er flyktige — det finnes altså
ikke ett SHA-256 som er stabilt på tvers av bygg, og derfor ingen nøkkel å
publisere permanent før fase 6.

Men verifiseringen KAN prøves før det: debugkeystoren på én maskin er stabil, så
fingeravtrykket derfra kan legges midlertidig i statementet og hele kjeden kjøres
på en telefon. Prisen er at `huskis.no` da offentlig autoriserer en debugnøkkel
så lenge fila står der — et bevisst, tidsavgrenset eksperiment, ikke noe som blir
stående. (De manuelle omveiene, `adb shell pm set-app-links-user-selection`,
beviser derimot ikke det som skal bevises: at ORIGINET har autorisert appen.)

**Det ene spørsmålet som må avgjøres først** er redirect-veien: tapp en
bekreftelseslenke i e-postklienten på en telefon der appen er installert og
verifisert, og se om Supabase' 303 til `huskis.no` lander i appen eller blir
liggende i browseren — og om `#access_token=…` følger med. Svaret bestemmer om
App Links koster fire eller seks koblede endringer, og det finnes ikke noe annet
sted enn en enhet å hente det fra. Det kan kjøres med det midlertidige
debug-fingeravtrykket beskrevet over, altså før fase 6, dersom svaret trengs for
å planlegge den fasen.

## Lifecycle- og network-signaler

**Kartleggingen først.** Synken hentes fram av seks ting, og bare tre av dem er
hendelser:

| Ledd i `app.js` | Hva det gjør |
|---|---|
| `save()` | en lokal endring → `scheduleCloud()` (300 ms debounce) |
| realtime `postgres_changes` | endring hos en annen enhet → `scheduleCloud(150)` |
| pollet (5 s) | `scheduleCloud(0)` — men `return` mens `document.hidden` |
| `online` (to lyttere) | statusen nullstiller frakoblet-tellingen og ber om en runde straks; operasjonskøen nuller backoffen og pumper |
| `offline` | maler statusen. Ingen synk-effekt |
| `visibilitychange` → SKJULT | `commitAllPending()`: committer buffrede slettinger. Ikke en synk-trigger |

`navigator.onLine` leses tre steder: frakoblet-tilstanden i lagringsstatusen,
`isNetworkError()` og `updateSafety()`.

**Hva som er upålitelig i en WebView — og hva som er lest kontra observert.**

*Lest, ikke observert:* det sammenslåtte manifestet ber bare om `INTERNET`
(`@capacitor/android` 8.5.0 sitt eget bibliotekmanifest er tomt — kontrollert i
pakken). Chromiums nettverksvarsling i WebView-en henger på
`ACCESS_NETWORK_STATE`; uten den er tilstanden UKJENT, og ukjent leses som «på
nett». Da står `navigator.onLine` permanent på `true`, og `online`/`offline`
fyrer aldri.

*Observert — men det avgjør ikke spørsmålet:* fase 2 punkt 9 viste «Frakoblet» i
flymodus, og trinn 3 i sekvensen under synket etter en bakgrunnsperiode med
flymodus på. Ingen av dem skiller de to verdenene: «Frakoblet» har TO kilder —
flagget ELLER to runder som ikke nådde fram — og trinn 3 slår av flymodus FØR
appen hentes fram, så nettet er tilbake uten at noen `online`-hendelse trengs.
Runden er dermed forklart uansett hva flagget sto på.

*Fortsatt ubesvart:* enhetssjekken som avgjør det er IKKE kjørt, og den er ikke
en runde med appen — den krever `chrome://inspect` mot debug-APK-en (Capacitor
slår på WebView-debugging i debugbygg), flymodus på, og lesing av
`navigator.onLine` + `__huskis.syncStatus.snapshot()`. Spørsmålet står altså
åpent.

*Konsekvensen om det stemmer:* de to `online`-lytterne blir aldri kalt. Ingen av
dem eier data. Begge er snarveier forbi en timer som prøver igjen uansett —
pollet hvert 5. sekund, og køens egen backoff med tak på 15 s — og det som
faktisk MELDER frakoblet er terskelen på to runder som ikke nådde fram, som
ikke spør `navigator.onLine` i det hele tatt. Derfor er dette ikke et hull, og
derfor er ikke `ACCESS_NETWORK_STATE` lagt inn: en tillatelse skal ikke inn på
en uprøvd antakelse for å spare sekunder i veier som leger seg selv. Blir
svaret på enhetssjekken «ja, den er død», er den ene manifestlinjen det
naturlige tiltaket — ikke en plugin — og den hører sammen med en ny sjekk i del
6 av `tests/capacitor-android.test.js`, der de andre manifesterklæringene
voktes.

De to andre leserne taper heller ingenting på et flagg som står permanent på
`true`. `isNetworkError()` faller tilbake på meldingsteksten, som er der
uansett. Og `updateSafety()`s offline-arm («ikke trygt å reloade») leses bare av
`update-check.js`, som i appen ser sin egen innebygde `/version.json`, aldri
finner en nyere build-ID og derfor aldri foreslår en reload i det hele tatt
(fase 2).

**Hullet som ER reelt, og det er et web-hull.** Pollet er slått av mens siden er
skjult, og INGENTING hentet appen inn igjen ved gjenopptakelse.
[`accounts.md`](accounts.md) påsto at `visibilitychange`/`focus` gjorde det;
de lytterne fantes ikke i koden. Etter en pause i bakgrunnen var altså
INTERVALLET det eneste som kunne ta appen igjen — og intervallet er nettopp det
en bakgrunnsprosess ikke lover: en skjult side får timerne sine strupet
(Chromium samkjører oppvåkningene, og etter fem minutter skjult ned mot én i
minuttet), og en bakgrunnsapp kan fryses av OS-et. Scenarioet: telefonen ligger
i lomma en time med Huskis i bakgrunnen mens en annen enhet flytter en liste.
Brukeren åpner appen og ser den gamle visningen til en timer vi ikke eier
bestemmer seg for å fyre.

**Fiksen krevde ingen native API-er.** Gjenopptakelsen er en hendelse, ikke en
timer, og `visibilitychange` finnes i WebView-en så vel som i browseren — målt,
med en runde tilskrevet lytteren på fysisk Android (seksjonen «Kjørt med
sonden»). Web-laget kjenner derfor fortsatt native-runtimen på nøyaktig ÉN gated
linje — broen for tilbakeknappen — og unntaket i
`tests/capacitor-android.test.js` er uendret. Det samme gjelder
npm-avhengighetslista og appmodulens `dependencies`-blokk: ingen plugin er
innført.

**Men lytteren rekker ikke inn i begge regimene, og det er målingens andre
funn.** Har Android fryst prosessen — observert fra 103 s i bakgrunnen og
oppover — snur synligheten mens prosessen står stille, og hendelsen blir aldri
levert. Da er det pollets forfalte tikk som starter runden, og det kommer ikke
5 s etter opptiningen: intervallet forfalt for lengst, så event-løkka kjører det
først av alt. De to leddene deler altså jobben etter hvor lenge appen var borte,
og ingen av dem dekker begge regimene alene.

| Ledd | Rolle |
|---|---|
| `visibilitychange`-lytteren (`app.js`, ved `startCloudPoll`) | Synlig igjen + innlogget ⇒ `scheduleCloud(0)`. Fyrer ikke på vei INN i bakgrunnen — en app som ligger i bakgrunnen skal ikke polle. Dekker regimet der prosessen lever. |
| pollet (5 s) | Sikkerhetsnettet mens appen er fremme, og det som tar nettet igjen der `online` aldri kommer — OG det eneste leddet som starter runden etter en frysing, siden hendelsen ikke leveres da. Guarden MÅ derfor lese `document.hidden` på tikket; et flagg satt av en synlighetslytter ville stått på «skjult» for alltid etter en frysing (`tests/sync-foreground.test.js`, del 6). |
| realtime | Uendret, og trenger ingen nudge: dør kanalen, melder den fra selv (`CLOSED`/`CHANNEL_ERROR` → ny subscribe), og pullen over dekker hullet imens. |
| `tests/sync-foreground.test.js` | Kjører begge regimene hver for seg. Del 2: med pollet slått AV henter appen inn det en annen enhet gjorde straks den er synlig. Del 6: speilvendt — synligheten snus UTEN at hendelsen leveres, slik en opptint prosess gjør det, og pollets tikk skal starte runden likevel. Del 4: en endring som ikke nådde fram lander av seg selv uten én eneste `online`-hendelse og uten at `navigator.onLine` noen gang er falsk, altså slik en WebView uten `ACCESS_NETWORK_STATE` oppfører seg. |
| [`accounts.md`](accounts.md) | Autoritativt for hva som starter en synk-runde. |

**Ikke koblet på, og hvorfor:** `@capacitor/app` (`appStateChange`,
`getLaunchUrl`) og `@capacitor/network` gir de samme to signalene som web-laget
allerede har. Prisen ville vært en npm-avhengighet, en Gradle-avhengighet i
appmodulen som merger sitt eget manifest, og en gate til i web-koden — tre
låser fra #122 som alle måtte utvides — for et signal `visibilitychange` gir
gratis. `@capacitor/app` kommer først når fase 6 eventuelt tar App Links opp
igjen, og da for den innkommende ADRESSEN, ikke for lifecycle.

### Kjørt på fysisk Android — og det de fire trinnene ikke avgjør

Sekvensen under er kjørt i sin helhet på telefon, uten avvik. Den gjenbrukes ved
etterkontroll og på iOS i fase 7.

**Det som ER observert** er brukeregenskapen punktet finnes for: appen står med
etterslepet inne praktisk talt straks Android tar den fram igjen — etter en lang
bakgrunnsperiode, og etter en bakgrunnsperiode med flymodus på — og en endring
gjort rett før appen ble skjult ligger allerede hos den andre klienten. Ingen av
scenarioene lot brukeren se en gammel visning mens en timer bestemte seg.

**Det runden IKKE gjør er å isolere hvem som startet runden.** På telefonen er
både pollet (5 s) og realtime i live hele veien, og begge kan starte en runde
straks WebView-en våkner eller kanalen kobler seg opp igjen. Sekvensen slår
ingenting av og teller ingen pulls, så et poll-tikk innen 5 s ser likt ut på
skjermen som gjenopptakelses-lytteren. Observasjonen er altså FORENLIG med
lytteren — og lytteren er regresjonstestet nettopp med pollet slått av
(`tests/sync-foreground.test.js`) — men runden beviser den ikke.

To spørsmål krevde derfor en egen enhetsøkt, og det ble den samme økten:
`chrome://inspect` mot debug-APK-en (Capacitor slår på WebView-debugging i
debugbygg).

| Spørsmål | Hva økten gjør |
|---|---|
| Lever `navigator.onLine` uten `ACCESS_NETWORK_STATE`? | Flymodus på; les `navigator.onLine` og `__huskis.syncStatus.snapshot()`. |
| Var det gjenopptakelsen som startet runden? | Runden må TILSKRIVES, ikke tidfestes: både pollet og realtime kan starte en runde i samme øyeblikk som appen kommer fram, så et lite tidsintervall beviser ingenting. Sonden under gjør realtime inert og merker hver runde med kilden sin (`by`). |

Sonden er den samme teksten `tests/sync-foreground.test.js` (del 5) henter ut av
dette dokumentet og kjører i en ekte nettleser, så den måler det den påstår og
velter ikke appen. Økten ER kjørt, og svarene står under «Kjørt med sonden: hva
enheten svarte». Oppskriften blir stående: den gjenbrukes ved etterkontroll og
på iOS i fase 7.

### Sonden: én innliming, begge spørsmålene

Lim inn i konsollen i `chrome://inspect` mot WebView-en, ETTER innlogging:

```js
window.__probe = window.__probe || (() => {
  const log = [], now = () => Math.round(performance.now());
  const add = (what, extra) => log.push(Object.assign({ t: now(), what }, extra || {}));
  const c = window.__huskis.client, rpc = c.rpc.bind(c), fetch0 = window.fetch.bind(window);
  let inResume = false, by = null;
  /* Realtime ut av bildet — og HOLDT ute. `removeAllChannels()` alene rekker
     ikke: den lukker kanalen, appen ser `CLOSED` og re-subscriber etter 4 s, og
     et `SUBSCRIBED` starter selv en runde. En inert kanal tar imot forsøket. */
  const dead = { on: () => dead, subscribe: () => dead, unsubscribe: () => Promise.resolve('ok'), teardown() {} };
  c.channel = () => dead;
  c.removeAllChannels();
  /* Kilden til runden, uten gjetting: capture på window fyrer FØR appens egen
     visibilitychange-lytter, bobling ETTER den. Alt appen planlegger imens er
     dermed gjenopptakelsens, og merket står mens timeren kjører — `cloudCycle()`
     kaller `get_my_doc` synkront, så runden merkes der den faktisk starter. */
  addEventListener('visibilitychange', () => { inResume = !document.hidden; add('visible', { visible: !document.hidden }); }, true);
  addEventListener('visibilitychange', () => { inResume = false; }, false);
  const st = window.setTimeout;
  window.setTimeout = function (fn) {
    if (!inResume || typeof fn !== 'function') return st.apply(window, arguments);
    const a = [...arguments];
    a[0] = function () { by = 'visibilitychange'; try { return fn.apply(this, arguments); } finally { by = null; } };
    return st.apply(window, a);
  };
  c.rpc = function (name) { add('rpc', { name, by: by || 'annet' }); return rpc.apply(null, arguments); };
  window.fetch = function (u) { add('fetch', { url: String((u && u.url) || u).slice(-48), by: by || 'annet' }); return fetch0.apply(null, arguments); };
  /* Alle kandidatene til «appen er fremme igjen», ikke bare den ene vi tror på:
     fyrer ikke `visibilitychange` på enheten, må loggen vise hva som DA kom. */
  ['focus', 'blur', 'pageshow', 'pagehide', 'online', 'offline'].forEach((n) => addEventListener(n, () => add(n)));
  ['freeze', 'resume'].forEach((n) => document.addEventListener(n, () => add(n)));
  /* Fryser Android prosessen, stopper timerne. Da er hoppet i seg selv et
     signal — og det eneste som finnes hvis ingen hendelse fyrer. */
  let tick = now();
  setInterval(() => { const n = now(); if (n - tick > 2500) add('timer-hopp', { stilleMs: n - tick }); tick = n; }, 1000);
  const meta = (n) => (document.querySelector('meta[name="huskis-' + n + '"]') || {}).content;
  const WAKE = ['visible', 'resume', 'pageshow', 'focus', 'timer-hopp'];
  return {
    log,
    net: () => ({ onLine: navigator.onLine, release: meta('release'), build: meta('build'),
                  channels: c.getChannels().length, sync: window.__huskis.syncStatus.snapshot() }),
    report: () => {
      let i = -1;
      log.forEach((e, n) => { if (WAKE.includes(e.what) && e.visible !== false) i = n; });
      const w = i < 0 ? null : log[i];
      const calls = (i < 0 ? log : log.slice(i + 1))
        .filter((e) => e.what === 'rpc' || e.what === 'fetch')
        .map((e) => ({ what: e.what, name: e.name, by: e.by, etterMs: w ? e.t - w.t : null }));
      return { wokeBy: w && w.what, wokeAt: w && w.t,
               sawVisible: log.some((e) => e.what === 'visible' && e.visible),
               by: calls.length ? calls[0].by : null,
               deltaMs: calls.length && w ? calls[0].etterMs : null,
               calls, tail: log.slice(-10) };
    },
    reset: () => { log.length = 0; tick = now(); },
  };
})();
```

| Kall | Gir |
|---|---|
| `__probe.net()` | `onLine`, hele synk-snapshotet, `channels` (skal være `0` hele økten) — og `release`/`build` fra meta-taggene, altså fase 4s avlesning i samme slengen |
| `__probe.report()` | `wokeBy`/`sawVisible`: HVA som meldte at appen er fremme igjen. `calls`: hver runde etter det, med `by` — hvem som startet den |
| `__probe.reset()` | tømmer loggen mellom rundene |

**Sonden endrer appen til du laster den på nytt:** realtime kommer ikke tilbake
i denne økten. Det er hele poenget — pollet dekker hullet imens, og en reload
gir alt tilbake.

**Q1 — lever `navigator.onLine`?** Slå PÅ flymodus med appen fremme, og kjør
`__probe.net()`. `onLine: true` med flymodus på betyr at flagget står permanent
sant, altså at Chromiums nettverksvarsling er død uten `ACCESS_NETWORK_STATE` —
og da fyrer `online`/`offline` aldri. Slå flymodus AV igjen og se på
`__probe.report().tail`: står det ingen `online`-hendelse der, er svaret
bekreftet fra to kanter. `sync` viser samtidig hvilken av de to kildene til
«Frakoblet» som gjelder (`offline`-flagget kontra `netFailures`).

**Q2 — var det gjenopptakelsen?** `__probe.reset()`, send appen i bakgrunnen,
vent (varier lengden: ti sekunder, ett minutt, ti minutter), hent den fram og
kjør `__probe.report()`. Gjenta tre ganger.

Svaret leses i TO trinn, og rekkefølgen er viktig — det andre trinnet betyr
ingenting hvis det første svarer nei:

1. **Kom signalet?** `sawVisible: true` ⇒ `visibilitychange` fyrte. `false` ⇒ den
   fyrte ikke, og da KAN ikke lytteren ha gjort jobben — uansett hva som ellers
   skjedde. `wokeBy` sier hva som da meldte fra i stedet (`timer-hopp` = ingen
   hendelse i det hele tatt, bare en timer som våknet).
2. **Hvem startet runden?** Les `by` i `calls`, ikke bare den første:
   `'visibilitychange'` ⇒ lytteren. `'annet'` ⇒ noe annet, og med realtime inert
   er det pollet. Står det et `annet`-kall FØRST og et `visibilitychange`-kall
   rett etter, vant pollets forfalte tikk kappløpet med noen millisekunder —
   lytteren virket likevel. Tom `calls` ⇒ ingen runde i det hele tatt, og da er
   hullet ikke lukket.

**Tid alene duger ikke her, og det er verdt å vite hvorfor.** Pollet står på
under målingen, akkurat som i vanlig bruk — og en strupet eller fryst timer har
ikke uniform fase: et forfalt 5-sekunderstikk kan bli kjørbart i samme øyeblikk
som appen kommer fram. Et lite `deltaMs` er derfor forenlig med BEGGE
forklaringene uansett hvor mange ganger det gjentas. `by` skiller dem; `deltaMs`
sier bare hvor raskt det gikk. Sjekk samtidig at `net().channels` fortsatt er
`0` — er den ikke det, har realtime kommet tilbake og runden kan være dens.

Sekvensen er kort, og skal kjøres med en browserklient innlogget på samme konto:

| # | Gjør | Forventet |
|---|---|---|
| 1 | Send appen til bakgrunnen og la telefonen ligge låst i minst ti minutter (gjerne en time). Endre et listenavn i nettleseren imens. | — |
| 2 | Hent appen fram igjen og se på skjermen UTEN å røre noe. | Det nye navnet står der praktisk talt med en gang — ikke etter en pause på titalls sekunder, og uten at du må dra, trykke eller endre noe for å utløse det. |
| 3 | Gjenta med flymodus på telefonen i bakgrunnsperioden, og slå den av FØR du henter appen fram. | Statuslinjen går til «Lagret», og endringen fra nettleseren er der. |
| 4 | Snu det: endre noe i appen, send den til bakgrunnen med en gang, vent, og se i nettleseren. | Endringen er hos den andre klienten. Den ble pushet før appen ble skjult, ikke etter. |

Avvik rapporteres som i fase 2: trinnummer, hva som faktisk skjedde, hva
`#sync-status` sa, og om det samme skjer i nettleseren med fanen i bakgrunnen.
Er svaret ja, er det en ordinær Huskis-feil.

### Kjørt med sonden: hva enheten svarte

Økten er kjørt på fysisk Android, med realtime inert (`channels: 0` gjennom
hele) og pollet på, som i vanlig bruk. Begge spørsmålene er besvart.

**Q1 — `navigator.onLine` er død uten `ACCESS_NETWORK_STATE`.** I flymodus sto
flagget fortsatt på `true`, og det kom ingen `online`/`offline` i loggen da
flymodus ble slått av igjen. Chromiums nettverksvarsling er altså ute av drift i
WebView-en — nøyaktig slik pakken ble lest. Tiltaket er tatt: manifestet ber nå
om tillatelsen, voktet av `tests/capacitor-android.test.js`. Ingen av de tre
leserne eier data, så dette rydder i signalene; det flytter ingen invariant.

**Q2 — ja, lytteren starter runden. Men bare i det ene av to regimer.** Loggen
deler seg rent etter om Android hadde fryst prosessen eller ikke, og de to
halvdelene har hver sin startkilde:

| Fravær (målt fra loggen) | Kom `visible: true`? | Hva som startet runden |
|---|---|---|
| 2,6 s — prosessen levde | ja | `get_my_doc` merket `by: 'visibilitychange'`, 3 ms etter |
| 103 s / 305 s / 1264 s — prosessen fryst | nei, ingen synlighetsvending i det hele tatt | pollets forfalte tikk (`by: 'annet'`), som første linje etter stillheten |

Grensen mellom de to ligger et sted mellom 3 s og 100 s, og økten pinner den
ikke — den trengs ikke: begge sidene av den starter runden.

**Den korte runden er svaret på spørsmålet slik det ble stilt.** Et
`get_my_doc`-kall står i loggen med `by: 'visibilitychange'`. Det er ikke et
tidsintervall som også kunne vært pollets — det er kallets egen kallstack,
merket mens gjenopptakelsens `setTimeout` sto på. Lytteren VIRKER altså i
WebView-en, og det er observert, ikke utledet.

**De tre lange rundene viser regimet lytteren ikke rekker inn i.** Der står hele
loggen stille — 103, 305 og 1264 sekunder uten en eneste linje, altså en fryst
prosess, ikke en strupet timer — og første linje etter stillheten er et
`get_my_doc` merket `annet`. Ingen `visible`-linje ligger foran det. At runden i
det hele tatt kjørte, BEVISER at siden allerede sto som synlig da timerne tinte:
pollets guard leser `document.hidden` på tikket og hadde ellers returnert. Med
andre ord snudde synligheten mens prosessen sto stille, og hendelsen ble aldri
levert.

**Hullet er lukket, men av to ledd, ikke ett:**

| Regime | Lytteren | Pollet |
|---|---|---|
| Kort fravær, prosessen lever | starter runden (målt: 3 ms etter) | ville uansett tatt det innen 5 s |
| Langt fravær, prosessen fryst | fyrer ikke — hendelsen kommer aldri | starter runden som aller første handling etter opptiningen |

Det forfalte tikket venter ikke 5 s på tur: intervallet forfalt for minutter
siden, så event-løkka kjører det først av alt. Brukeregenskapen holder derfor i
begge regimene — og på telefonen er det lange fraværet det vanlige.

**Konsekvensen for koden er at begge ledd er bærende.** Pollet er ikke lenger
bare et sikkerhetsnett bak lytteren; i det frosne regimet er det den eneste
starteren. Det gjør guarden i `startCloudPoll` til en invariant: den må lese
`document.hidden` PÅ TIKKET. Skrives den om til et flagg en
`visibilitychange`-lytter setter — en nærliggende opprydding — står flagget på
«skjult» for alltid etter en frysing, og appen våkner aldri igjen. Del 6 av
`tests/sync-foreground.test.js` kjører nettopp den situasjonen: synligheten snus
uten at hendelsen leveres, og runden skal komme likevel.

**Det økten ikke svarer på, og hvorfor det ikke endrer noe:** hvilket signal —
om noe — Chromium leverer i stedet på opptiningen. Sonden som ble kjørt lyttet
bare etter `visibilitychange`, så loggen kan ikke si om `focus`, `pageshow` eller
`resume` kom. Oppskriften over lytter etter alle fire, så en senere økt kan svare
på det. Svaret ville uansett bare vært en snarvei: pollet starter allerede runden
i samme øyeblikk, så det finnes ikke noe hull et ekstra signal kunne lukket.

## Sikker lagring og sikkerhetskopi

**Kartleggingen først.** Huskis har ingen native-spesifikke secrets. Det eneste
som ligger i frontend er Supabase-endepunktet og `anon`-nøkkelen, som begge er
laget for å stå i klartekst i en klient (`config.js`), og appen har ingen
API-nøkkel, ingen enhetsnøkkel og ingen native integrasjon som kunne hatt en.
Det som ER følsomt ligger i WebView-ens `localStorage`, og er det samme som i
nettleseren — hele lista med poster, innhold og levetid står i
[`accounts.md`](accounts.md) («Hva som ligger i enhetens lagring»). To av dem
betyr noe:

- **sesjonen** (`sb-<prosjekt-ref>-auth-token`), som supabase-js skriver selv:
  `persistSession` og `autoRefreshToken` står på klientens standard `true`
  (lest i `vendor/supabase-js-2.111.0.js`). Posten bærer `refresh_token` ved
  siden av det kortlevde `access_token`-et, og fornyer seg selv. Den er altså
  IKKE kortlevd: den lever til brukeren logger ut. (Hvor lenge et refresh-token
  er gyldig hos serveren er en prosjektinnstilling i Supabase, ikke noe repoet
  kan svare for — og en tidsboks der ville uansett bare forkortet vinduet, ikke
  fjernet det.)
- **bufferen** (`mine-lister-v1:<uid>`), som er hele brukerens innhold i lesbar
  form.

**Sikker lagring: nei.** Et keystore-lag under sesjonen ville
kostet en Capacitor-plugin (altså npm-avhengighetslista OG appmodulens
`dependencies`-blokk), en egen storage-adapter til supabase-js, og en gate til i
web-koden — tre låser fra #122 utvidet på én gang — for å beskytte ÉN av de to
postene mot en angriper som allerede er inne i appens sandkasse, der Androids
egen diskkryptering er den grensen som gjelder. Bufferen ved siden av ville
fortsatt ligget i klartekst. Den ene veien dataene faktisk forlot enheten var en
helt annen, og den lukkes med to erklæringer:

**`android:allowBackup`: slått AV.** Forskjellen i angrepsflate er reell.
Auto Backup tar som standard med filene under appens datakatalog — unntakene er
`cache`, `code_cache` og `no_backup` — og WebView-lagringen ligger i
`app_webview/` under nettopp den. Med Capacitors standard `true` fulgte derfor
BÅDE sesjonen og bufferen med i Googles sikkerhetskopi, og en gjenoppretting på
en annen telefon er innlogget som brukeren uten at noen har logget inn.
Nettleserutgaven har ingen tilsvarende vei ut av enheten. Sesjonen er ikke
kortlevd nok til å redde det: den fornyer seg selv så lenge posten finnes.

Å slå det av koster ingenting. Serveren er kanonisk, så en ny telefon henter alt
ved første innlogging; språk og drakt er bevisst per enhet ([`sprak.md`](sprak.md),
[`mork-drakt.md`](mork-drakt.md)); og `mine-lister-device` SKAL være ny på en ny
enhet — en kopi gir to enheter samme LWW-opphav, som er det `newer()` bryter
uavgjort med.

To erklæringer, fordi de dekker hver sin halvdel:

| Ledd | Rolle |
|---|---|
| `android:allowBackup="false"` (manifestet) | Stenger skykopien, på alle Android-versjoner. |
| `android:dataExtractionRules` → `res/xml/data_extraction_rules.xml` | Stenger enhet-til-enhet-overføringen, som attributtet IKKE rører hos alle produsenter fra Android 12 (vi er på targetSdk 36). Begge modusene må skrives eksplisitt: en manglende — eller tom — seksjon leses som «fullt aktivert», ikke som «ingenting». `cross-platform-transfer` er derimot opt-in og trenger ingen erklæring. |
| `tests/capacitor-android.test.js` (del 6) | Begge halvdelene, koblingen mellom dem (manifestet peker på en fil som faktisk finnes), at hver seksjon utelukker HELE datakatalogen, og at ingen `<include>` har begynt å plukke ut data som skal ut likevel. |
| [`accounts.md`](accounts.md) | Autoritativt for hva som ligger i enhetens lagring, og for at den blir der. |

**Punktet krevde ingen web-kode.** Ingen plugin, ingen npm-avhengighet, ingen
Gradle-avhengighet: web-laget kjenner fortsatt native-runtimen på nøyaktig ÉN
gated linje — broen for tilbakeknappen — og unntaket i
`tests/capacitor-android.test.js` er uendret.

### Ikke prøvd på telefon — og hva en telefon ville lagt til

Dette punktet er to erklæringer og en beslutning, og begge erklæringene er
statiske: testen leser dem, og APK-workflowen kompilerer dem (paths-filteret
`android/**` starter den), så at Android godtar regelfila og at manifestet
merger uten konflikt avgjøres i CI.

At Auto Backup som standard tar med `app_webview/` er LEST i Androids
dokumentasjon, ikke observert på en enhet — men retningen henger ikke på det:
vi vil ikke ha dataene ut i noen av tilfellene, og erklæringene feiler lukket.
Vil man se det på enhet, er `adb shell bmgr backupnow no.huskis.app` runden som
viser at pakken ikke lenger er kvalifisert. Det er en bekreftelse, ikke en
åpen beslutning.

**Ferdigkriterium:** Android-appen oppfører seg som en normal mobilapp i de
plattformtilfellene browseren ikke selv kan håndtere godt nok.

---

# Fase 4 — felles release-identitet

**Mål:** kunne svare entydig på «hvilken Huskis-release kjører denne klienten?»
uavhengig av Vercel, Android eller senere iOS.

Dagens `buildId` identifiserer en konkret build/deploy og beholdes så lenge det
er nyttig. Innfør i tillegg en **plattformuavhengig `releaseId`** som følger den
logiske Huskis-releasen.

- [x] Definer `releaseId` og hvor den genereres. De 12 første tegnene av
      commit-SHA-en, generert i `build.js` (se seksjonene).
- [x] Web og Android kan rapportere samme `releaseId` for samme release.
      Begge bygges av `node build.js` over det samme treet, og identiteten
      følger med `dist/` inn i APK-en.
- [x] Skill `releaseId` fra Vercel-spesifikk `buildId`/deployment-ID.
      `releaseId` leser aldri `VERCEL_DEPLOYMENT_ID`; `buildId` er fortsatt
      deploy-ID-en i produksjon.
- [x] Oppdater `version.json`/mobilmetadata uten å svekke cache- eller
      reload-sikkerheten. Feltet er lagt TIL; `update-check.js` er urørt og
      leser fortsatt bare `buildId`. Androids `versionCode`/`versionName` er
      ikke rørt — de hører til fase 6.
- [x] Dokumenter kompatibilitetsregelen mellom klientrelease og databaseskjema.
      [`release-og-deploy.md`](release-og-deploy.md) («Klientrelease og
      databaseskjema»).
- [x] Vurder `minimumSupportedRelease` bare dersom et konkret behov oppstår;
      gammel klient skal ellers fortsatt fungere. **Vurderingen er gjort:
      innføres ikke nå, og regelen står ved lag** — det er additivt skjema og
      bakoverkompatibel backend som bærer den, mens OTA gjør den vanligste
      grunnen til å ønske seg en grense mindre sannsynlig. Grensen mobilen
      faktisk trenger går på butikkbinæren (`versionCode`) og innføres i
      fase 5. Det som er krysset av er VURDERINGEN, ikke en implementasjon.
- [x] Bestem om web og mobil skal motta samme byte-identiske webartifact eller
      separate builds med samme `releaseId`. Ikke endre dagens sikre
      migrering→smoke→Vercel-rekkefølge uten eksplisitt design og tester.
      **Avgjort i fase 5: separate builds med samme `releaseId`** — altså det
      de allerede er. Et byte-identisk artifact ville krevd en ny kobling
      mellom release-workflowen og web-deployen uten å svare på noe
      `releaseId` ikke allerede svarer på. Det som er krysset av er
      BESLUTNINGEN, ikke en implementasjon.

## Kartleggingen først: hva identifiserer en release i dag

Fire tall er i omløp, og de svarer på fire forskjellige spørsmål. Ingen av dem
svarte på «hvilken Huskis-release er dette?» før `releaseId` kom til.

| Felt | Svarer på | Eies av | Verdi i dag |
|---|---|---|---|
| `buildId` | «hvilken build/deploy kjører denne klienten?» | `build.js`, én gang per bygg | Vercels deploy-ID i produksjon, ellers `<sha12>-<tid i base36>`. Stemplet i `<meta name="huskis-build">` OG `/version.json`, og hektet på JS/CSS-URL-ene som `?b=` |
| `version.json.version` | «hvilken SemVer?» — ingenting, med vilje | `package.json` | `null`. `package.json` finnes kun for Capacitor-skallet og har ikke noe `version`-felt, så SemVer skal ikke måtte økes per PR |
| Vercels deployment-ID | «hvilken deploy i Vercels infrastruktur?» | Vercel | Brukes som `buildId` i produksjonsbygget, og ALDRI til noe annet. Den er leverandørens identitet, ikke produktets |
| `versionCode` / `versionName` | «hvilken butikkbinær?» | `android/app/build.gradle` | `5` / `"1.0.5"` — ett tall i to roller: OTA-ens kompatibilitetsnivå (fase 5) og Google Plays monotone opplastingsnummer (fase 6). `versionName` utledes av det samme tallet. Et krav fra butikken og fra OTA, ikke en produktversjon |

Hullet: `buildId` er unik per BYGG. Web og Android bygges av hver sin kjøring av
`node build.js` over det samme treet, så de kan ikke ha samme `buildId` — og
hadde dermed ingen måte å si at de er den samme releasen.

## `releaseId`

**Definisjonen:** `releaseId` er de 12 første tegnene av commit-SHA-en builden
er laget av. Én commit på `main` ER én Huskis-release: `release.yml` kjører på
hver push dit, og alt som deployes deployes fra en commit.

**Hvor den genereres:** i `build.js`, i den samme kjøringen som `buildId`, fra
den samme kilden som `commit` (`VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` →
`git rev-parse HEAD`). Den skrives til de samme to stedene: klienten
(`<meta name="huskis-release">`) og `/version.json`.

**Forskjellen fra `buildId`,** som er hele poenget: to bygg av samme commit får
FORSKJELLIG `buildId` og LIK `releaseId`. Det gjelder web mot Android, og en
re-deploy mot den forrige. Autoritativt, med tabellen som stiller dem opp mot
hverandre: [`auto-update.md`](auto-update.md) («Release-ID»).

**Vercels deploy-ID misbrukes ikke.** `releaseId` leser aldri
`VERCEL_DEPLOYMENT_ID`. Den fortsetter å være `buildId` i produksjon, der den
hører hjemme: den identifiserer deployen, ikke produktet.

**`buildId` beholder rollen sin, uendret.** Den eier cache- og
reload-sikkerheten alene — `?b=`-URL-ene, sammenligningen i `update-check.js` og
dermed «lik build-ID ⇒ ingen banner, ingen reload». `updateSafety()` avgjør
fortsatt når en reload er trygg. `releaseId` er en identitet som RAPPORTERES,
ikke et signal noe reagerer på; ingen kodelinje i oppdateringsmekanikken leser
den.

**Additivt, fordi gamle klienter leser fila** (arkitekturregel 7). `releaseId`
er et nytt felt ved siden av de gamle — ingen er døpt om eller fjernet. En
klient fra før dette (en telefon som ikke er oppdatert, en fane som har stått
åpen) leser `version.json` som før: `update-check.js` validerer på `buildId`
alene og overser resten. Regelen gjelder framover også: `version.json` utvides,
den skrives ikke om.

| Ledd | Rolle |
|---|---|
| `makeReleaseId()` (`build.js`) | Genererer identiteten. `null` når SHA-en er ukjent — en ukjent release er ikke en oppdiktet en. |
| `stampHtml()` (`build.js`) | Stempler BEGGE meta-taggene. Mangler en av dem i `index.html`, kaster builden i stedet for å deploye en klient uten identitet. |
| `<meta name="huskis-release">` (`index.html`) | Klientens egen kopi, lesbar uten nett — det er den som gjør at en offline Android-app kan sammenlignes med web. `dev` = ubygget kilde eller ukjent commit. |
| `/version.json` | Det klienten spør mot. `releaseId` ligger ved siden av `buildId`; `commit` beholder hele SHA-en. |
| `update-check.js` | **Urørt.** Leser og sammenligner fortsatt bare `buildId`. |
| `tests/build-version.test.js` | De to ID-ene hver for seg: to bygg av samme commit gir lik `releaseId` og ulik `buildId`, formen er 12 heks, og deploy-ID-en blir aldri `releaseId`. |
| `tests/auto-update.test.js` | Reload-sikkerheten: lik `buildId` + en annen `releaseId` + felt klienten ikke kjenner ⇒ ingen mål-build, intet banner, ingen reload. |
| `tests/capacitor-android.test.js` | Androids halvdel: den synkede kopien er byte for byte kilden (`index.html` modulo begge ID-ene), og den innebygde `version.json` bærer den samme releasen som klienten i APK-en. |
| [`auto-update.md`](auto-update.md) | Autoritativt for build-ID, release-ID og oppdateringsmekanikken. |
| [`release-og-deploy.md`](release-og-deploy.md) | Autoritativt for releaseprosessen og for kompatibilitetsregelen mot databaseskjemaet. |

**Rekkefølgen migrering → smoke → Vercel er urørt.** Punktet krevde ingen
endring i `release.yml` eller `vercel.json`: releasen som migreres, smoke-testes
og deployes er allerede én `github.sha`, og det er nettopp den `releaseId`
navngir.

## Det `releaseId` ikke kan svare på

**En «minimum» er en ORDNING** — «denne og alle nyere» — og en commit-SHA har
ingen. `releaseId` er en identitet som sammenlignes med `===`, aldri med `>=`;
en test som `releaseId >= minimumSupportedRelease` ville vært meningsløs uansett
hvordan den ble skrevet. `builtAt` løser det heller ikke: den er byggets
tidspunkt, ikke releasens rekkefølge, og to bygg av samme release har
forskjellig verdi.

Det er denne egenskapen — og ikke et åpent spørsmål — som avgjorde de to siste
punktene i lista over. Ingen nedre støttet release innføres, og web og mobil får
separate builds med samme `releaseId`. Avveiningen som gjorde dem avgjørbare kom
med OTA og står i fase 5-seksjonen, «De to punktene fra fase 4 får sitt svar
her»; den er autoritativ for begge.

### Hvilken commit et artifact faktisk er bygget av

`releaseId` navngir commiten builden ER laget av. Det er en egenskap, ikke en
svakhet — identiteten kan ikke lyve om opphavet sitt — men den betyr at to
artifacts bare har samme `releaseId` hvis de er bygget av samme commit, og det
er de ikke alltid:

| Artifact | Bygger | Blir `releaseId` |
|---|---|---|
| Vercel-preview på en PR | grenas HEAD | grenas HEAD-commit |
| `android-debug.yml` på `pull_request` | GitHubs syntetiske MERGE-commit (`actions/checkout` sin standard der) | merge-commiten |
| `android-debug.yml` på `workflow_dispatch` | HEAD på refen som velges (observert: en manuell kjøring på denne grenen sjekket ut grenas HEAD og stemplet nettopp den) | den commiten |
| Produksjonsdeployen (`release.yml`) | `github.sha` på `main` | main-commiten |

Målt på denne planens egen PR: previewen rapporterte `0427d395315a`, mens
`huskis-debug-apk` rapporterte `9d0a7634a036`. Begge var riktige — de var to
forskjellige commits.

**Workflowen er med vilje ikke endret.** Å pinne APK-jobben til PR-headen ville
gjort de to automatiske artifactene sammenlignbare, men svekket det jobben
finnes for: den bygger og kjører `tests/capacitor-android.test.js` mot det som
faktisk lander etter merge. En sammenligning er ikke verdt en dårligere port.

**Konsekvensen for enhetssjekken:** de to artifactene må komme fra SAMME commit,
og det er to måter å få det på.

1. **Etter merge:** kjør `android-debug.yml` manuelt på `main` og sammenlign
   APK-en med `huskis.no`. Begge er da main-commiten.
2. **Før merge:** kjør `android-debug.yml` manuelt på grenen — et
   `workflow_dispatch` bygger refens HEAD, altså nøyaktig den commiten Vercel
   previewer — og sammenlign APK-en med preview-URL-en.

Den automatiske PR-kjøringen er ikke en av dem, og et avvik derfra er forventet.

### Lest ut av en kjørende APK — hva enheten svarte

Avlesningen er gjort på telefon, i en `chrome://inspect`-økt mot debug-APK-en,
mot en Vercel-preview bygget av SAMME commit:

| | APK (debug-APK fra `android-debug.yml`) | Web (Vercel-preview) |
|---|---|---|
| `releaseId` | `d10867a7c0a6` | `d10867a7c0a6` |
| `buildId` | `d10867a7c0a6-msve6nhe` | `dpl_73Rj6UV3Xk8WHnyzSw8TEmJhfGn9` |

Lik release, ulike bygg — og formen er den tabellen over beskriver: APK-en bærer
`build.js`' egen `<sha12>-<tid i base36>`, mens webklienten bærer Vercels
deploy-ID. Deploy-ID-en er altså `buildId` og bare det; `releaseId` er den samme
identiteten på begge plattformene. Det er nøyaktig det fasen finnes for.

*Verifisert i kjeden fra før:* at `node build.js` skriver den samme `releaseId` i
klienten og i `version.json`, at to bygg av samme commit får lik `releaseId` og
ulik `buildId`, og at oppdateringsmekanikken ikke reagerer på feltet.

*Verifisert i APK-workflowen, med ekte `cap sync`:* Androids halvdel er
kopisteget som legger `dist/` i `android/app/src/main/assets/public`. Det er
kjørt i CI, ikke bare lokalt: `android-debug.yml` kjører
`tests/capacitor-android.test.js` etter synkroniseringen, og der målte den at
kopien er byte for byte kilden (`index.html` modulo de to ID-ene), at den
innebygde `version.json` bærer release-ID-en, og at klienten i APK-en og den
innebygde `version.json` melder den samme releasen. APK-en er altså bygget og
pakket med identiteten inne.

**Ferdigkriterium:** web og mobil kan sammenlignes på én release-identitet uten
at Vercels deploy-ID misbrukes som produktversjon. **Oppfylt** — målt på en
kjørende APK mot en preview av samme commit (tabellen over).

De to siste punktene i lista er «vurder …»-punkter, og vurderingen ER gjort:
ingen `minimumSupportedRelease`, og separate builds med samme `releaseId`.
Grunnlaget står i «De to punktene, og svaret de fikk»; konsekvensen som gjorde
dem avgjørbare kom med OTA, og avveiningen står i fase 5-seksjonen.

---

# Fase 5 — OTA for web-assets

**Mål:** vanlige Huskis-endringer i HTML/CSS/JS/assets skal kunne nå installerte
mobilapper uten butikkrelease, med minst samme sikkerhetsnivå som dagens
auto-update i browser.

Før implementering skal OTA-løsning velges etter disse kravene:

- signering/integritetskontroll av bundles;
- innebygd kjent-god fallback;
- rollback ved mislykket oppstart;
- kanaler/miljøer og staged rollout;
- tydelig skille mellom web-assets og native kode;
- kompatibilitet med App Store-/Play-regler;
- mulighet for automatisering fra GitHub Actions;
- rimelig leverandørlåsing og driftskostnad.

**Valget er tatt og fasen er verifisert:** `@capawesome/capacitor-live-update`, i
selvhostet modus, uten sky-konto. Kartleggingen, sammenligningen og prisen står
under. Fire implementasjonsrunder er innført: pluginen og rollback-veien uten at
noen bundle hentes, den signerte bundelen med manifestet — publisert av
`release.yml` — hentingen, og til slutt oppstillingen og byttet: karantenen,
`setNextBundle()`, klargjøringstilstanden i `update-check.js` og
`LiveUpdate.reload()` gjennom `updateSafety()` (seksjonen «Hva som er innført»).
Kjeden er hel i koden, og enhetsøkten 25. august 2026 verifiserte den på fysisk
Android: produksjons-OTA i installasjon A og rollback/karantene i installasjon
B. Alle punktene i implementasjonslista nederst er derfor krysset av.

## Nåtilstanden: hva som allerede finnes, og nøyaktig hvor hullet var

Fire ledd var på plass fra før, og de er grunnen til at fase 5 ble et lite lag
og ikke et nytt system:

| Ledd | Hva den allerede gjør | Hva OTA trenger av den |
|---|---|---|
| `updateSafety()` (`app.js`) | ett samlet, fail closed «er det trygt å bytte kode nå?» — bygget på tilstander appen allerede fører ([`auto-update.md`](auto-update.md)) | uendret. OTA skal SPØRRE den, ikke få sin egen |
| `update-check.js` | banner, inaktivitetsregel, ett-forsøk-vakt, poll og hendelser — alt med injiserte avhengigheter (`url`, `reload`, `isSafe`) | uendret mekanikk; native får en gren som bytter KILDE og RELOAD |
| `releaseId` | plattformuavhengig identitet på kilden, sammenlignet med `===` ([`auto-update.md`](auto-update.md)) | svaret på «kjører denne telefonen den releasen web kjører?» |
| `buildId` | eier cache og reload alene: `?b=`-URL-ene og sammenligningen i `update-check.js` | identiteten på selve bundelen, én per bygg |

**Hullet ble målt, ikke antatt.** `dist/` ble bygget og servert på sitt eget
origin — nøyaktig APK-situasjonen, der `https://localhost` serverer den
innebygde kopien av den samme builden — og oppdateringsmotoren ble spurt hva den
så:

```json
{ "started": true, "klientBuildId": "62e80375b74c-msyfflyy",
  "serverBuildId": "62e80375b74c-msyfflyy", "checks": 2, "target": null,
  "reloads": 0, "banner": false, "safety": { "safe": true, "reason": "" } }
```

Motoren var altså ikke AV i appen. Den startet av seg selv, den utførte de to
kontrollene sonden ba om i stedet for å vente på oppstartstimeren, og
`updateSafety()` svarte `safe: true` — den var villig. Den fant bare ingenting,
fordi den målte seg mot seg selv: `noteBuild()` returnerer på `id === buildId`,
og i APK-en ER de to alltid like. Fase 5 ga den en signert, nivåbundet motpart
utenfor det innebygde originet.

**Og web-laget kunne ikke bare spørre `huskis.no` i stedet.** CSP-en står som
meta-tag i `index.html` og gjelder derfor også inne i APK-en. Målt i ekte
nettleser mot den bygde `dist/`:

```
Refused to connect to 'https://huskis.no/ota/android.json' because it violates
the following Content Security Policy directive: "connect-src 'self' https://bmky…"
```

Samme forespørsel mot eget origin gikk gjennom. Å hente et OTA-manifest fra
web-laget kostet altså nøyaktig én ny vert i `connect-src`
([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) — en pris, ikke en hindring.
Den prisen er betalt, og målingen er snudd til en vakt:
`tests/csp-enforced.test.js` viser at manifest-oppslaget slipper ut mens en
fremmed vert fortsatt blokkeres. Cross-origin-lesningen
(`https://localhost` → `https://huskis.no`) trenger i tillegg CORS;
`Access-Control-Allow-Origin: *` står derfor på nøyaktig manifest-stien i
`vercel.json`. Installasjon A verifiserte på ekte WebView at dette leddet faktisk
kan lese produksjonsmanifestet.

**Repoet har to porter som er bygget for å stoppe en ny native avhengighet.**
`tests/capacitor-android.test.js` låser hvilke npm-pakker og hvilke
Gradle-avhengigheter som finnes, nettopp fordi et nytt bibliotek merger sitt
eget manifest inn i appens. De ble utvidet bevisst for LiveUpdate-pluginen.

## Kartleggingen: hva som finnes av OTA for Capacitor

| Kandidat | Lisens/modell | Cap 8 | Selvhostet uten konto | Status |
|---|---|---|---|---|
| `@capawesome/capacitor-live-update` | MIT (plugin), sky valgfri | 8.4.0 | **ja** — `downloadBundle({url, bundleId, checksum, signature})` | **valgt** |
| `@capgo/capacitor-updater` | MPL-2.0 (plugin), sky valgfri | 8.51.13 | ja — `download({url, version, checksum, sessionKey})` | reell reserve |
| `@capacitor/live-updates` (Appflow) | `"license": "Commercial"` | 0.5.0 | nei — krever Appflow | **ute** |
| Egen Capacitor-plugin | — | — | ja | **ute** |
| Ikke gjøre noe (kun butikkrelease) | — | — | — | **ute** |

**Appflow er ute fordi den legges ned.** Pakken er fortsatt publisert (0.5.0,
februar 2026) og støtter Capacitor 8, men den er lisensiert `Commercial` og
virker bare mot Appflow, som etter Ionics egen kunngjøring slutter å levere
31\. desember 2027. Å bygge fase 5 på en tjeneste med kjent sluttdato ville vært
å planlegge to migreringer i stedet for én.

**Egen plugin er ute** fordi den koster mest der den er svakest: signaturvakt,
rollback-timer, atomisk bundlebytte og gjenoppretting av den innebygde
versjonen er akkurat den native koden som er dyrest å skrive riktig og umulig å
teste billig. To vedlikeholdte, kvitterte implementasjoner finnes.

**«Ikke gjøre noe» er ute** fordi fase 5 ER kravet: en telefon skal ikke måtte
vente på en butikkrunde for en tekstretting. Alternativet er ikke gratis — det
er arkitekturregel 7 som betaler, ved at eldre klienter blir stadig eldre.

### De to reelle: målt, ikke lest

Begge ble installert i en kopi av repoet og synkronisert med ekte
`npx cap sync android`. Forskjellen er ikke funksjonell — den er hvor mye de
drar med seg inn i APK-en:

| | Capawesome | Capgo |
|---|---|---|
| Eget `AndroidManifest.xml` | tomt | tomt (bare `<application>`) |
| Gradle-avhengigheter den drar inn | `zip4j`, `okhttp`, `okhttp-brotli`, `appcompat` | `androidx.work`, `lifecycle-process`, **`play-services-tasks`**, **`play:app-update`(+ktx)**, `guava`, `versioncompare`, `okhttp`, `brotli`, `appcompat` |
| Native metoder eksponert | 26 | 50 |
| Konfigurasjonsvalg | 9 | ~35 |
| Standard-endepunkter | ingen kontakt: `autoUpdateStrategy` er `"none"`, `appId` tomt | `plugin.capgo.app/updates`, `/channel_self`, `/stats` — tre URL-er som må overstyres for å bli selvhostet |

Capgo drar inn Google Play-tjenester og Play Core i en app som i dag ikke har
noen av delene. Det er ikke en feil ved Capgo — den er bygget for å gjøre mer,
inkludert butikkoppdateringer — men i Huskis er det et helt lag med merget
manifest som ingen har bruk for, i en app som ellers navngir hver eneste
utgående adresse. Og de tre standard-URL-ene betyr at selvhosting hos Capgo er
noe man må huske å slå PÅ; hos Capawesome er det der man starter.

## Valget mot de åtte kravene

**`@capawesome/capacitor-live-update`, selvhostet.** Bundelen er en signert
ZIP-fil Huskis lager selv; skyen brukes ikke, og det finnes ingen konto å ha.

| Krav | Hvordan det dekkes | Kilde |
|---|---|---|
| Signering/integritet | `Signature.getInstance("SHA256withRSA")` over selve filbytene, X.509-nøkkel fra `publicKey` i `capacitor.config.json`. **Fail closed**: er `publicKey` satt og signaturen mangler, kastes `ERROR_SIGNATURE_MISSING` — den faller ikke tilbake til checksum | lest i pluginens Java-kilde + produksjonssignaturen godtatt av fysisk Android i installasjon A |
| Innebygd kjent-god fallback | `reset()`/rollback går tilbake til bundelen som ble pakket i binæren | dokumentert + fysisk observert i begge riggrundene |
| Rollback ved mislykket oppstart | rollback-timeren armeres i pluginens konstruktør og avvæpnes av `ready()`; `readyTimeout` styrer fristen | lest i kilden + fysisk observert med `throw` og `blank` |
| Kanaler/staged rollout | selvhostet er kanalen manifest-URL-en, og utrulling en andel i manifestet som enheten avgjør mot sin egen `getDeviceId()`. Pluginen har også kanaler og rollout — de hører til skyen, og brukes ikke | dokumentert |
| Skille web/native | pluginen bytter KUN de utpakkede web-assetene; native kode og plugins ligger i binæren og kan bare endres gjennom butikken | dokumentert + kompatibilitetsvakten per `versionCode` |
| App Store/Play | Play forbyr nedlastet kjørbar kode (dex/JAR/.so), men unntar eksplisitt kode som kjører i en tolk med indirekte tilgang til Android-API-ene — JavaScript i en WebView. Apples DPLA tillater tolket kode så lenge den ikke endrer appens primære formål eller omgår App Review | Play-policyen og Apples avtaletekst |
| Automatisering fra Actions | bundelen er en ZIP og en JSON. `release.yml` bygger og signerer den på den samme `github.sha` som migreres, smoke-testes og deployes | følger av dagens kjede |
| Leverandørlåsing/driftskostnad | MIT, ingen konto, ingen regning. Låsingen er formatet på ett `downloadBundle`-kall — bytter vi plugin, byttes kallet, ikke bundelen | npm + kilde |

Skyprisene ble ikke avgjørende, siden ingen av dem skal betales: Capgo oppgis
fra ~12 USD/mnd og Capawesome fra ~9 USD/mnd. Begge prissidene er blokkert av
utgående proxy i denne økten, så tallene er lest ut av søketreff og ikke
verifisert mot kilden — de er tatt med for fullstendighet, ikke som grunnlag.

## Prisen, eksplisitt

**Den ville prisen — en bundler — betales ikke.** Det var det åpne spørsmålet:
en Capacitor-plugin brukes normalt som `import { LiveUpdate } from '…'`, og en
`import` i `app.js` ville krevd nettopp det Huskis ikke har. Den veien trengs
ikke. Capacitors Android-bro GENERERER og injiserer JS-en som legger hver
registrerte native plugin på `window.Capacitor.Plugins['<id>']`, med én funksjon
per `@PluginMethod` (`JSExport.getPluginJS()` i `@capacitor/android`). Etter
`cap sync` sto `LiveUpdatePlugin` i den genererte
`android/app/src/main/assets/capacitor.plugins.json`, og pluginen eksponerer 26
native metoder. Web-koden når dem gjennom nøyaktig den samme vakten som
tilbakeknappens bro allerede bruker — `window.Capacitor` finnes ikke i en
nettleser, og da kjører ingenting av det. **Ingen bundler, ingen import, ingen
klientavhengighet i webappen.**

Det som faktisk koster:

| Pris | Hva den er | Hvor den betales |
|---|---|---|
| En fjerde npm-pakke | `@capawesome/capacitor-live-update`, pinnet eksakt. Den er byggeinput for det native skallet, aldri en web-asset — `SKIP`-listen i `build.js` holder `package.json` og `node_modules/` ute av `dist/` som før | `package.json`, lockfila |
| To låser må utvides | målt: en kopi av repoet med pluginen installert og synkronisert gir **134/136** i `tests/capacitor-android.test.js`, mot **129/129** uten. Nøyaktig to navngitte sjekker faller: «ingen andre npm-avhengigheter enn de tre Capacitor-pakkene» og «de applierte Gradle-skriptene legger ikke til avhengigheter». Ingen annen sjekk rører seg — heller ikke `server.url`, den synkede kopiens byte-likhet eller release-ID-ene | `tests/capacitor-android.test.js` |
| Native tredjepartskode i APK-en | `zip4j` og `okhttp`/`okhttp-brotli`. Pluginens eget manifest er tomt, og det BYGDE manifestet er lest: `zip4j` bidrar ingenting, `okhttp` med én `androidx.startup`-initializer og ingenting annet (seksjonen under) | `android/`, `.github/workflows/android-debug.yml` |
| Én ny vert i CSP, og CORS på manifest-stien | `connect-src` navngir `https://huskis.no`, slik at web-laget kan lese OTA-manifestet fra appens origin — i browseren er verten allerede `'self'`, så tillegget endrer ingenting der. Og fordi lesningen er cross-origin inne i APK-en, svarer `/ota/android/*` med `Access-Control-Allow-Origin: *`: offentlige, ukredensierte data | `index.html`, `vercel.json`, [`sikkerhetsheadere.md`](sikkerhetsheadere.md) |
| Et definert readiness-punkt | `ready()` MÅ kalles hver gang appen starter, ellers ruller rollback-timeren tilbake. Timeren armeres i pluginens konstruktør, også når appen kjører den innebygde bundelen. HVOR kallet står er hele vakten, ikke en detalj — se «Readiness-punktet» | web-koden, bak native-vakten |
| Én signeringsnøkkel | privatnøkkelen er en Actions-secret og forlater aldri runneren; den offentlige står i `capacitor.config.json` og pakkes i APK-en | GitHub-secrets |

Signaturen kan lages med Nodes standardbibliotek alene
(`crypto.createSign('sha256')` over ZIP-bytene, base64) — pluginens verifisering
er ren `SHA256withRSA`, uten noe leverandørformat i mellom. Byggesteget får
altså ingen avhengighet.

### Hva de native bibliotekene merger inn i manifestet

Manifestet INNE i en AAR finnes ikke i repoet. `tests/capacitor-android.test.js`
låser derfor hvilke biblioteker som er med, ikke hva hvert av dem erklærer — og
det er en ekte grense, ikke en slapp test. Gradles sammenslåing er den ene filen
som svarer på resten, og den finnes bare der en ekte APK bygges. Spørsmålet
hører altså hjemme i APK-workflowen og ikke på en telefon: `android-debug.yml`
skriver ut det sammenslåtte manifestet etter `assembleDebug`, sammen med
merger-rapporten — som attribuerer hver node til fila den kom fra — og en
oppsummering av hva APK-en faktisk ERKLÆRER. `exported` og `permission` står
sammen på hver komponent, fordi det er de to som TIL SAMMEN avgjør om noe et
bibliotek la inn kan nås utenfra; den ene alene svarer ikke. Begge filene lastes
opp som artifactet `huskis-merged-manifest`.

**Målt** i kjøring 94 av «Android debug-APK» (commit `61fa9e1`, `assembleDebug`,
`no.huskis.app` debug):

| Erklæring i det bygde manifestet | Erklært av |
|---|---|
| `uses-permission android.permission.INTERNET` | appens eget manifest |
| `uses-permission android.permission.ACCESS_NETWORK_STATE` | appens eget manifest |
| `permission` + `uses-permission no.huskis.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core:core:1.17.0` |
| `activity no.huskis.app.MainActivity` — `exported=true`, ingen `permission` | appens eget manifest |
| `provider androidx.core.content.FileProvider` — `exported=false` | appens eget manifest |
| `provider androidx.startup.InitializationProvider` — `exported=false` | startup-mekanismen i androidx; noden alle initializerne under henger på |
| ↳ `meta-data androidx.emoji2.text.EmojiCompatInitializer` | `androidx.emoji2:emoji2:1.3.0` |
| ↳ `meta-data androidx.lifecycle.ProcessLifecycleInitializer` | `androidx.lifecycle:lifecycle-process:2.6.2` |
| ↳ `meta-data androidx.profileinstaller.ProfileInstallerInitializer` | `androidx.profileinstaller:profileinstaller:1.4.0` |
| ↳ `meta-data okhttp3.internal.platform.PlatformInitializer` | `com.squareup.okhttp3:okhttp-android:5.3.2` |
| `receiver androidx.profileinstaller.ProfileInstallReceiver` — `exported=true`, `permission=android.permission.DUMP`, fire intent-filtre | `androidx.profileinstaller:profileinstaller:1.4.0` |

**De to bibliotekene fase 5 betalte for koster nesten ingenting her.** `zip4j`
står ikke i merger-rapporten i det hele tatt — det er et rent Java-arkiv uten
Android-manifest, så det finnes ingenting å slå sammen. `okhttp` bidrar med
NØYAKTIG én node: en `androidx.startup`-initializer inne i den
`InitializationProvider`-en som uansett sto der. Ingen tillatelse, ingen egen
komponent, intet intent-filter. Pluginen erklærer `okhttp 5.3.2` — lest i
`node_modules/@capawesome/capacitor-live-update/android/build.gradle`, sammen med
`zip4j 2.11.5`, `okhttp-brotli` og `appcompat` — og Gradles variantoppløsning
velger `okhttp-android` for et Android-mål; det er den varianten som bærer et
manifest.

**To ting i tabellen er verdt å ha skrevet ned.** `androidx.core` gir appen en
tillatelse den aldri skrev selv — `no.huskis.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
både erklært og brukt; navnet sier hva den er til for. Og `profileinstaller`
legger inn den eneste eksporterte komponenten i APK-en utenom `MainActivity`:
`ProfileInstallReceiver` er `exported="true"`, men bak
`android.permission.DUMP`, som bare skallet og systemet har. Ingen av de fire
intent-filtrene er altså en åpen inngang.

**Det målingen ikke svarer på:** rapporten attribuerer hver node til AAR-en som
ERKLÆRTE den, ikke til avhengigheten som dro AAR-en inn. Om `emoji2`,
`lifecycle-process` og `profileinstaller` kom med appens egen androidx-stakk
eller som transitive av OTA-pluginen, skiller ikke denne kjøringen — det ville
krevd det samme bygget uten pluginen å sammenligne med.

## Readiness-punktet — den ene linjen som ER rollback-vakten

`ready()` avvæpner rollback-timeren. Kalles den for TIDLIG, er vakten borte: en
bundle som laster scriptene, kaller `ready()` og deretter feiler i initen blir
godkjent, og pluginen ruller den aldri tilbake. Kalles den for SENT, ruller en
fungerende bundle tilbake fordi kaldstarten var treg. Plasseringen er derfor
ikke «en linje ved oppstart» — den er selve definisjonen av «denne bundelen
virker».

**Punktet skal ligge etter at appen faktisk er brukbar, og det skal ikke
avhenge av nettet.** Det andre kravet er like hardt som det første: venter
`ready()` på et svar fra serveren, blir en offline kaldstart umulig å skille fra
en ødelagt bundle, og pluginen ruller tilbake en bundle som virker. Det ville
brutt punktet «tåle offline oppstart» i lista nederst.

Huskis har et signal som oppfyller begge: **første skjerm malt fra lokal
tilstand** — innloggingsskjermen, som `initAccounts()` maler ubetinget, også
for en innlogget bruker (der byttes den ut av `cloudStart()` like etterpå).
Den nås uten nettverk; `updateSafety()` har allerede `sync-unknown` for
tilstanden «innlogget, men serveren har ikke svart ennå», altså er det en
tilstand appen kjører i, ikke en feil. Det er sent nok til at en bundle som
feiler i initen aldri kommer dit, og tidlig nok til at det skjer uten nett.

### Hvorfor punktet ligger FØR `getSession()`, ikke etter

Kravet «skal ikke avhenge av nettet» er strengere enn det ser ut, og det ble
brutt av et kall som ikke ser ut som et nettkall. `markAppReady()` nås fra
`initAccounts()`, og der lå det opprinnelig etter `await
client.auth.getSession()`. Lest i den innsjekkede `vendor/supabase-js-2.111.0.js`:

- `__loadSession()` regner en sesjon som utløpt allerede **90 sekunder** før den
  er det (`EXPIRY_MARGIN`, `3 × 30 000`);
- er den «utløpt», hentes et nytt token **før** sesjonen leveres videre — også
  før `INITIAL_SESSION`, som er veien en innlogget bruker når `cloudStart()`;
- offline feiler det kallet som `AuthRetryableFetchError`, og
  `_refreshAccessToken()` prøver på nytt med eksponentiell backoff i opptil
  **30 000 ms**.

Det er tre ganger `readyTimeout`. En offline kaldstart med et token nær utløp
ville dermed rullet tilbake en helt frisk bundle — og siden
`autoBlockRolledBackBundles` er på og klienten har sin egen karantene, ville den
friske bundelen deretter vært **varig sperret** på den enheten. En falsk
rollback er altså ikke en forbigående irritasjon; den er permanent og stille.

Punktet står derfor før `getSession()`. Regelen som følger av det, og som
`tests/capacitor-android.test.js` håndhever posisjonelt: **ingenting som kan
vente på nettet får legges over `markAppReady()` i `initAccounts()`.**

**Prisen, sagt rett ut:** for en innlogget bruker ligger `loadCache()` og
`render()` nå utenfor det voktede vinduet. En bundle som maler
innloggingsskjermen fint og først deretter feiler i board-renderingen blir ikke
rullet tilbake. Avveiningen er bevisst: en uteblitt rollback rettes av neste
release, en falsk rollback er varig.

Svaret var ikke å heve `readyTimeout` — det ville gitt en ekte defekt bundle
like lang tid til å se frisk ut.

**Målt på fysisk Android 25. august 2026.** Tre kaldstarter i flymodus med
ferskt token ga `readyCalledAt` 291, 249 og 314 ms; en fjerde kaldstart etter at
`expires_at` var satt fem sekunder fram i tid og fikk utløpe offline ga 277 ms.
Alle fire lå svært langt under `readyTimeout = 10000` ms, og nær-utløpt token
flyttet ikke readiness-punktet. Riggtesten ga samtidig den andre halvparten av
beviset: `rig-broken-1`, som laster scriptene men kaster før brukbar skjerm, ble
rullet tilbake; `rig-broken-2`, som aldri når `ready()`, ble også rullet tilbake.
Readiness-punktet har dermed både nødvendig plassering og nødvendig tidsmargin
på ekte maskinvare.

## Hva som er innført: hele kjeden, i fire steg

Koden er fire steg forbi valget, og alle er med vilje små nok til å kunne måles
hver for seg.

**Første steg: pluginen og rollback-veien.** Pluginen finnes, rollback-timeren
er PÅ, og ingenting henter en bundle. Da kan rollback-mekanikken måles før det
finnes et bundlebytte å feile i — og feiler den, feiler den mot den innebygde
bundelen, som allerede kjører. Pluginens egen `rollback()` skriver da bare
«Default bundle is already in use» og gjør ingenting.

**Andre steg: den første signerte bundelen og manifestet.** `release.yml`
bygger, signerer og publiserer dem. Steget ble tatt tidlig med vilje, av to
grunner — det var det minste som ga noe å måle, og det var det eneste med en
menneskelig avhengighet (nøkkelparet), som derfor ikke skulle ligge sist.

**Tredje steg: hentingen — uten å bytte.** Den første gangen web-laget får
adgang til noe utenfor sitt eget origin: CSP-verten (med CORS-tvillingen), og
`fetchOtaBundle()` i `app.js`, som leser manifestet på URL-en skallets
`getVersionCode()` bestemmer og laster ned en annen release med
`downloadBundle()`. Bundelen ble liggende ubrukt til steget etter stilte den
opp — og nettopp derfor var en feil der gratis: appen kjørte videre på den
bundelen den hadde, og hvert utfall var et stille no-op som kun syntes i
`window.__huskis.otaFetch`.

**Fjerde steg: stille opp og bytte.** Karantenen spørres, `setNextBundle()`
stiller bundelen opp, og `update-check.js` får sitt ene nye ledd —
klargjøringen — før den bytter med `LiveUpdate.reload()` gjennom de samme
vaktene en nettleser-reload alltid har gått gjennom. Det er her en bundle for
FØRSTE gang kan feile ved oppstart, og derfor også her rollback-timeren og
karantenen kan prøves i praksis.

| Ledd | Hva som står der nå |
|---|---|
| npm | `@capawesome/capacitor-live-update` 8.4.0, pinnet eksakt, i `dependencies` — ikke `devDependencies`: koden pakkes inn i APK-en, i motsetning til `@capacitor/cli`, som bare kjører på byggemaskinen |
| `capacitor.config.json` | `LiveUpdate`-blokken med `readyTimeout: 10000` (standardverdien er `0`, og `0` betyr at automatisk rollback er AV), `autoUpdateStrategy: "none"` og `autoBlockRolledBackBundles: true`. Ingen `appId`, `defaultChannel` eller `serverDomain`: pluginen har ingen adresse å kontakte, og kontakter derfor ingenting av seg selv |
| `app.js` (readiness-punktet) | `markAppReady()` kaller `LiveUpdate.ready()` bak `nativeShell` — den samme gaten tilbakeknappens bro bruker. Kallstedene er de brukbare skjermene: `cloudStart()` rett etter at board-et er brettet fra `localStorage`, og `initAccounts()` når innloggingsskjermen står malt — også i grenen der Supabase mangler og skjermen er alt appen har å vise. Ingen av dem ligger etter noe som venter på serveren. Funksjonen er idempotent — første vei vinner, og et kontobytte senere i økten er ikke en ny oppstart. `window.__huskis.appReady` blir først `true` når `ready()` faktisk har RESOLVERT (eller når det ikke finnes noe native-kall å vente på); en avvist promise fanges i `window.__huskis.liveReadyError` i stedet for å telle som avvæpnet (PR-review #134, punkt P1) |
| `app.js` (hentingen) | `fetchOtaBundle()`, kalt én gang ved oppstart, bak den samme gaten: bygger `<canonicalAppUrl()>ota/android/<getVersionCode()>.json` (nivået er en STRENG — ingen tallparsing), gjør nøyaktig ETT `fetch(…, {cache: 'no-store'})`, validerer svaret ved systemgrensen (`validOtaManifest`: form og typer på `releaseId`/`bundleId`/`url`/`signature`, `url` låst til det kanoniske originet, `versionCode` som selvkontroll), sammenligner `releaseId` med `===` mot `<meta name="huskis-release">`, og kaller `downloadBundle({url, bundleId, signature})` — uten `checksum`, som pluginen bare sjekker når `publicKey` ikke er satt. 404, nettverksfeil, ugyldig manifest og avvist nedlasting er alle stille no-op; utfallet står i `window.__huskis.otaFetch` for enhetsøkten. En bundle som alt ligger i pluginens lager skilles ut som `already-downloaded` og ikke som en feil — se «En allerede hentet bundle er ikke en feilet nedlasting». Manifestets `bundleId` meldes samtidig inn til `update-check.js` som mål-build: inne i appen er `/version.json` klientens egen, innebygde kopi, så motoren kan bare finne seg selv |
| `app.js` (karantenen) | `noteRollback()` leser `ready()`-svaret og fører en rullet-tilbake `bundleId` i en VARIG liste (`localStorage`, `huskis:ota-blocked`). `otaBlockedBundle()` spør både den listen og pluginens egen `getBlockedBundles()` FØR oppstillingen, og er fail closed: kan ingen av dem leses, stilles ingenting opp |
| `app.js` (oppstillingen og byttet) | `prepareOtaBundle()`: karantene → nedlasting (eller en bundle som alt ligger i lageret) → `setNextBundle({bundleId})`. `prepareUpdate()`/`applyUpdate()` er de to krokene `update-check.js` slår opp på `window.__huskis`; `applyUpdate()` kaller `LiveUpdate.reload()` KUN når en bundle faktisk er stilt opp, ellers `location.reload()` |
| `update-check.js` | klargjøringen: et mål er ikke reloadbart før `prepare` har svart ja. En feilet klargjøring brenner ikke ett-forsøk-vakten og prøves igjen ved neste kontroll; banneret vises først når målet er klart, og «Oppdater nå» går utenom trygghetsvakten, men ikke utenom klargjøringen. Reloaden er sen-bundet på samme måte ([`auto-update.md`](auto-update.md)) |
| `index.html` + `vercel.json` (CSP) | `https://huskis.no` i `connect-src`, i BEGGE policyene — meta-taggen er den som gjelder inne i APK-en. Og CORS-headeren på manifest-stien, siden lesningen er cross-origin fra `https://localhost` ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) |
| `tests/capacitor-android.test.js` | de to låsene som måtte utvides, pluss invariantene: at `LiveUpdate`-blokken finnes, at `readyTimeout` er positiv, at `autoUpdateStrategy` ikke er slått på, at `autoBlockRolledBackBundles` ER slått på, at ingen sky-felter er satt, at `ready()` står bak gaten og kalles fra begge skjermene, at `appReady` ikke settes før promisen er avgjort. Og de to native halvdelene av signeringen: at `versionCode` er over `2` (feltet over pakkes inn i APK-en), og at `publicKey` er en RSA-nøkkel som overlever PLUGINENS egen parsing — base64 uten PEM-hoder, lest som `X509EncodedKeySpec`. Fra hente-runden: at broen kalles med kun de seks kjente metodene, at hentingen står bak gaten, at URL-en bygges av `canonicalAppUrl()` + `versionCode` uten tallparsing, ett `fetch` med `no-store`, validering før bruk, `===` mot meta-taggen, og `downloadBundle` uten `checksum`. Fra oppstillingsrunden: at `downloadBundle`/`setNextBundle`/`reload` hver kalles fra nøyaktig ETT sted, at karantenen spørres FØR `setNextBundle` og er fail closed, at «klargjort» dekker en bundle som alt ligger i lageret, at rollback føres i en VARIG liste, at `live.reload()` bare kalles når noe faktisk er stilt opp — og at `update-check.js` fortsatt ikke kjenner et eneste pluginnavn: at ett-forsøk-vakten kun skrives i `autoReload()`, at `evaluate()` returnerer før alt annet når målet ikke er klargjort, og at banneret kun vises fra klargjøringens ja-gren |
| `tests/ota-fetch.test.js` | flyten KJØRT i ekte nettleser, med broen faket slik skallet injiserer den og manifest-URL-en rutet: i nettleser skjer ingenting; 404 og nettverksfeil er stille no-op med nøyaktig ett oppslag på riktig URL; ugyldige manifester (ikke-JSON, fremmed `url`-vert, feil `versionCode`) stopper ved systemgrensen; lik `releaseId` laster ingenting; ulik `releaseId` gir nøyaktig ett `downloadBundle` med nøyaktig de tre feltene, og deretter ett `setNextBundle` med manifestets `bundleId` — etter at karantenen er spurt. En avvist nedlasting stiller ingenting opp; `ERROR_BUNDLE_EXISTS` leses som `already-downloaded` og stilles LIKEVEL opp; en blokkert `bundleId` lastes ikke engang ned; en blokkliste som ikke kan leses er også et nei; en feilet oppstilling er stille. Ingenting kaller `reload()` av seg selv |
| `tests/auto-update.test.js` | klargjøringen KJØRT i ekte nettleser med injisert `prepare`: et uklargjort mål gir verken banner eller reload og brenner ikke ett-forsøk-vakten, en feilet klargjøring prøves igjen ved neste kontroll, en vellykket klargjøring viser banneret og gjennomfører reloaden med nøyaktig ett registrert forsøk, og «Oppdater nå» laster ikke noe som ikke er stilt opp — men gjennomføres straks klargjøringen har lykkes |
| `android/app/build.gradle` | `versionCode 5`. Nivået ble `3` i denne fasen, fordi `autoBlockRolledBackBundles` pakkes inn i APK-en, `4` da varselrunden la egen native kode inn i skallet (lokale varsler, varselikonet, `TimeZoneAlarmReceiver`), og `5` da varselikonene ble tegnet om — native RESSURSER, som ligger i binæren og ikke i OTA-pakken. Tallet ER kompatibilitetsgrensen (se under) |
| `.github/scripts/ota-bundle.js` | pakker `dist/` til `ota/bundles/<buildId>.zip`, signerer ZIP-bytene (`crypto.createSign('sha256')`, base64), VERIFISERER signaturen mot den innebygde `publicKey` før noe skrives, og skriver ett manifest per støttet nivå. Ren Node — `fs`, `path`, `crypto`, `child_process` — så byggesteget får ingen avhengighet |
| `.github/workflows/release.yml` | steget kjører i deployjobben, altså bak `needs: smoke`, på den samme `github.sha` som ble migrert og smoke-testet, og legger utdataene i treet FØR `vercel deploy`. `OTA_MIN_VERSION_CODE` står i workflow-env som det laveste native nivået bundelen støttes i, og er `3` (se under). Mangler `OTA_SIGNING_KEY`, stopper releasen — den publiserer ikke en bundle ingen kan verifisere |
| `vercel.json` | `/ota/android/*.json` → `no-store` (manifestet navngir bundelen som gjelder NÅ), `/ota/bundles/*.zip` → `immutable` (build-ID-en står i navnet) |
| `tests/release-pipeline.test.js` | at rekkefølgen holder, at bundelen bygges før opplastingen, at grensen er over `1` og ikke høyere enn skallet, at `ota/` faktisk publiseres — og signaturen KJØRT: nøkkelparet lages i testen, hele veien zip → signatur → verifisering går gjennom, og en endret byte, feil nøkkel eller et nøkkelpar som ikke henger sammen må gi et NEI |

Gaten i `app.js` er fortsatt gaten, men den er nå to linjer i stedet for én:
`isNativePlatform()`-spørsmålet, og oppslaget av `window.Capacitor.Plugins` BAK
svaret på det. Testen låser begge — at det er nøyaktig to linjer, hva hver av
dem gjør, og hvilke fire steder pluginbroen brukes.

**Ingen kodesteg eller enhetsmålinger gjenstår i fase 5.** Kjeden er prøvd på
fysisk Android mot produksjon og mot den avgrensede rollback-riggen. Detaljene
og råmålingene står under «Enhetsøkten — kjørt 25. august 2026».

### Nøkkelparet: hvor de to halvdelene bor, og hvorfor de aldri møtes

Ett RSA-nøkkelpar, delt i to som aldri ligger samme sted:

| Halvdel | Hvor den bor | Hva som skjer hvis den er feil |
|---|---|---|
| privat | GitHub-secreten `OTA_SIGNING_KEY` (PKCS#8 PEM). Leses ETT sted i `ota-bundle.js`, som miljøvariabel, og skrives aldri ut | mangler den, stopper releasen. Ingen usignert bundle publiseres |
| offentlig | `publicKey` i `capacitor.config.json`, pakket inn i APK-en | passer den ikke privatnøkkelen, kan ingen telefon verifisere bundelen |

Den andre raden er den farlige: feltet kan ikke endres uten en ny butikkbinær,
så et nøkkelpar som ikke henger sammen ville stått uoppdaget helt til en telefon
avviste bundelen — og pluginen er fail closed nettopp her, den faller ikke
tilbake til checksum. Derfor VERIFISERER byggesteget sin egen signatur mot den
innebygde nøkkelen før det skriver et eneste manifest. Er de ikke to halvdeler
av samme par, feiler releasen med den setningen som forklaring.

Nøkkelen er lest maskinelt på begge måter den kan bli lest: som PEM av Node, og
som base64 uten PEM-hoder inn i en `X509EncodedKeySpec` — nøyaktig linjene i
`LiveUpdate.java`. En nøkkel på et annet format (PKCS#1, DER-fil, OpenSSH-linje)
ville sett riktig ut i konfigurasjonen og feilet på telefonen. Installasjon A
lukket siste gap: pluginens Java-verifisering godtok den faktiske
produksjonssignaturen laget av Node.

### `versionCode` er kompatibilitetsgrensen — derfor kunne den ikke bli stående på 1

Den står på `3`. Capacitor-malens `1` kunne ikke brukes, og grunnen er ikke at
`1` er et lavt tall: en APK bygget FØR OTA-pluginen og en bygget ETTER er native
forskjellige — den ene har pluginen, den andre ikke — men begge meldte
`versionCode 1`. En grense på `1` ville sluppet inn begge. Nå faller alle
`versionCode 1`-skall utenfor OTA uansett hvilket av dem det er, som er riktig
svar: ingen av dem er bygget for å hente en bundle.

Fra og med nå har tallet en jobb, og prisen er at det MÅ økes når det native
skallet endres. Repoet holder to tall som må stemme overens, og
`tests/release-pipeline.test.js` sjekker forholdet mellom dem:

- `versionCode` i `android/app/build.gradle` — skallet som bygges nå;
- `OTA_MIN_VERSION_CODE` i `release.yml` — det LAVESTE skallet denne
  web-bundelen fortsatt virker i. Manifestet skrives for hvert nivå i spennet
  mellom de to, så et eldre skall som fortsatt er innenfor får OTA, og et som
  faller utenfor får 404.

**`versionCode` gikk fra `2` til `3` i oppstillingsrunden**, av nøyaktig den
grunnen: `autoBlockRolledBackBundles` kom inn i `capacitor.config.json`, og
konfigurasjonen pakkes inn i APK-en. Et skall med karantenen på og ett uten er
native forskjellige, og kan derfor ikke melde det samme nivået.

**`OTA_MIN_VERSION_CODE` ble hevet til `3` i den samme runden.** Et
`versionCode 2`-skall bærer web-koden fra hente-runden. Den laster ned bundelen
og stopper der — den kaller aldri `setNextBundle()`. Koden som kan stille opp
ligger inne i bundelen og kommer derfor aldri til å kjøre. Regelen som følger:
**det laveste støttede nivået er det laveste skallet som kan TA I BRUK en
bundle**, ikke det laveste skallet der pluginen har metodene.

Installasjon A målte den reelle nivå-3-veien: skallets `getVersionCode()` fant
produksjonsmanifestet for nivå 3, manifestet passerte CORS/systemgrensen, og
bundelen ble både lastet ned og stilt opp. Fail-closed 404-utfallet for et nivå
uten manifest er fortsatt automatisk dekket av `tests/ota-fetch.test.js`.

Det samme tallet er dessuten BUTIKKENS opplastingsnummer. Regelen som holder de
to rollene i ett tall står i fase 6, «`versionCode` og `versionName`: ett tall,
to roller».

### Hva manifestet inneholder

```json
{
  "releaseId": "9f191b3ea1b6",
  "bundleId": "9f191b3ea1b6-msyntpx6",
  "versionCode": 2,
  "url": "https://huskis.no/ota/bundles/9f191b3ea1b6-msyntpx6.zip",
  "signature": "<base64, SHA256withRSA over ZIP-bytene>",
  "commit": "9f191b3ea1b6933dc69a9fde4687ffdb550a45f0",
  "builtAt": "2026-08-18T12:49:43.290Z"
}
```

`releaseId` er signalet klienten sammenligner med sin egen
`<meta name="huskis-release">`; `bundleId` er `buildId` under det navnet
`downloadBundle()` bruker. `versionCode` gjentar nivået filen ER for — ikke som
vakten (den er URL-en), men som en selvkontroll: klienten kan slå fast at filen
den fikk er filen den ba om. `url` er absolutt fordi nedlastingen skjer i NATIV
kode; en rot-relativ sti ville pekt på `https://localhost` inne i appen.

**Ingen `checksum`.** Lest i pluginens kilde: feltet sjekkes kun i `else`-grenen
når `publicKey` IKKE er satt. Et checksum-felt ved siden av signaturen ville
påstått en kontroll som aldri kjører.

## Slik er løsningen tenkt å henge sammen

Fire ledd, med hvert sitt regime — og `updateSafety()` eier fortsatt det ene
spørsmålet den alltid har eid, uendret:

```text
0. AVVIS      manifestet finnes på én URL PER native nivå. Telefonen ber om
              sitt eget (`…/android/<versionCode>.json`); finnes det ikke,
              svarer serveren 404 og INGENTING skjer — verken download eller
              set. Vakten er altså URL-en, ikke en sammenligning i klienten.
1. HENTE      downloadBundle({url, bundleId, signature}) — native nedlasting,
              rører ikke klienten som kjører. Alltid trygt.
2. STILLE OPP setNextBundle() — bundelen tas i bruk ved neste kaldstart.
              Kaldstart er trygt av seg selv: ingen usikret arbeid i lufta.
              FØRST når 1 og 2 har lykkes er målet «reloadbart».
3. BYTTE NÅ   LiveUpdate.reload() — dette ER en reload midt i en økt, og går
              derfor gjennom updateSafety(), banneret, inaktivitetsregelen og
              ett-forsøk-vakten i update-check.js. Uendret regel, ny reload.
```

**Steg 0–2 er et nytt ledd i `update-check.js`, ikke en byttet avhengighet.**
Motoren gikk før rett fra «jeg så en annen build-ID» til `reload()`: `check()`
gjorde fetch → `validBuildId()` → `noteBuild()`, og `autoReload()` kalte
`reload()` uten noe imellom. På native ville det betydd en
`LiveUpdate.reload()` på en bundle som verken er lastet ned eller stilt opp —
altså en reload av nøyaktig den koden som allerede kjører.

Leddet står nå der: en eksplisitt, asynkron **klargjøringstilstand** mellom
`noteBuild()` og `evaluate()`. Et mål er ikke reloadbart før nedlasting og
`setNextBundle()` har lykkes, og begge de to fail closed-reglene som følger av
det er av samme slag som resten av modulen:

- **En feilet klargjøring brenner ikke ett-forsøk-vakten.** `markAttempt()`
  skrives rett før reloaden, og en oppbrukt vakt er permanent for den
  mål-builden i den fanen. Klargjøringen kan derfor feile og prøves igjen ved
  neste kontroll uten å koste forsøket.
- **Banneret lover ikke noe som ikke er klart.** Det vises først når
  klargjøringen har lykkes. «Oppdater nå» går utenom trygghetsvakten med vilje
  — brukeren har bedt om det selv — men ikke utenom klargjøringen: er bundelen
  ikke stilt opp, settes klargjøringen i gang, og reloaden skjer når den har
  lykkes.

Det browser-laget beholder uendret er avgjørelsen: `updateSafety()`, banneret,
inaktivitetsregelen og ett-forsøk-vakten er de samme. Arkitekturregel 8 handler
om at trygghetsvurderingen ikke dupliseres, og den holder — fasen la til et
ledd, den byttet ikke bare to felt.

**Og målet må komme et annet sted fra i native.** Motoren måler seg mot
`/version.json` på sitt eget origin, og inne i APK-en ER den klientens egen,
innebygde kopi: den kan bare finne seg selv. Manifestet er den eneste kilden
som vet at det finnes en nyere release, og det er `app.js` som leser det.
`fetchOtaBundle()` melder derfor bundelens ID inn til motoren
(`HuskisUpdate.instance.noteBuild()`) når manifestet navngir en annen release.
Det er ett signal, ikke en avgjørelse: klargjøringen, `updateSafety()`,
banneret, inaktivitetsregelen og ett-forsøk-vakten ligger fortsatt i motoren
alene, og `bundleId` er den identiteten ett-forsøk-vakten teller på — samme
rolle `buildId` har i nettleseren.

### Hvor hente-koden bor — valgt: `app.js`, bak gaten

Valget måtte tas av runden som skrev hentingen, slik manifestformen ble valgt
av runden som publiserte det første manifestet. To plasser var aktuelle:

| Plass | Kobling | |
|---|---|---|
| Frittstående funksjon i `app.js` (`fetchOtaBundle()`), bak `nativeShell`-gaten, kalt én gang ved oppstart | ingen ny: gaten, pluginbroen og `canonicalAppUrl()` finnes der fra før, og `update-check.js` røres ikke | **valgt** |
| Et nytt ledd i `update-check.js` sin `check()` | broen, gaten og manifest-URL-en måtte vært injisert — og instansen auto-opprettes FØR `app.js` kjører, så injeksjonen hadde krevd at `app.js` konstruerte motoren på nytt. Capacitor-kunnskap i en fil til | ute |

Tre målbare grunner avgjorde:

- **testlåsene peker dit.** `tests/capacitor-android.test.js` feiler på en
  Capacitor-referanse i enhver annen web-kildefil enn `app.js`, og på en
  absolutt URL i `update-check.js`. Begge låsene er riktige, og begge ville
  måttet svekkes for det andre alternativet;
- **runden skal ikke røre ett-forsøk-vakten eller banneret.** Null endring i
  `update-check.js` gjør det trivielt sant;
- **hentingen er ETT fetch per oppstart, ikke en poll.** `check()` fyrer hvert
  tiende minutt og på synlighet/fokus/online, og et ledd der ville arvet den
  rytmen.

Setningen «steg 0–2 er et nytt ledd i `update-check.js`» står fortsatt — den
handler om KLARGJØRINGSTILSTANDEN, som dekker nedlasting og oppstilling
sammen. Formen ble gitt av motorens eget mønster: alt i `update-check.js` er
injiserte avhengigheter (`url`, `reload`, `isSafe`), og de to nye krokene
(`prepare` og reloaden) slås opp på `window.__huskis` ved HVERT kall, nøyaktig
som `defaultIsSafe` allerede gjorde. Native-koden ble derfor stående bak gaten
i `app.js`, og motoren måtte verken konstrueres på nytt eller lære et
pluginnavn — testen låser at den ikke kan ha lært et heller.

`releaseId` er signalet: manifestet navngir releasen web kjører, og enheten
sammenligner med `===` mot sin egen `<meta name="huskis-release">`. `buildId`
beholder rollen sin og blir bundelens identitet mot pluginen (`bundleId`), slik
at to bygg av samme release ikke kolliderer i pluginens lager.

Hvor bundelen ligger er avgjort, og kriteriet den måtte oppfylle var at den
ikke skulle koste en ny leverandør, en ny vert utover den ene i CSP-en, eller en
avhengighet i byggesteget. `release.yml` bygger og signerer ZIP-en på samme
`github.sha` og legger den i treet før `vercel deploy`; Vercel-builden kopierer
`ota/` ut i `dist/`, og filene serveres fra `huskis.no` sammen med resten av
appen. Ingen av de tre kostnadene ble betalt.

To ting følger av at det er Vercel-builden som kopierer dem ut. `ota/` står
IKKE i `SKIP`-listen i `build.js` — havner den der, blir hverken bundelen eller
manifestet publisert, og OTA stopper stille. Og mappen er ikke gitignorert, av
samme grunn: hva Vercel CLI-en laster opp styres ikke av dette repoet, og en
mappe som ikke lastes opp finnes ikke å kopiere. Begge er låst i
`tests/release-pipeline.test.js`.

## Native-kompatibilitet er en vakt i fase 5, ikke et punkt i fase 6

Lista nederst sier «aldri OTA-oppdatere native plugins». Det er en REGEL for hva
vi publiserer — ikke en vakt i klienten, og en regel kan ikke stoppe det som
skjer utilsiktet. Så snart fase 5 publiserer bundles automatisk fra
`release.yml`, er scenariet dette: en senere release endrer en native plugin
eller Capacitor-konfigurasjonen OG web-assetene i samme commit. Butikkbinæren
oppdateres i sitt eget tempo, men web-halvdelen ville nådd hver telefon med én
gang — inkludert de som fortsatt kjører det gamle skallet, og som da får
web-kode som kaller inn i noe som ikke finnes.

**Manifestet bærer derfor kompatibilitetsgrensen fra den første fungerende
OTA-flyten.** Klienten ber om manifestet på URL-en skallets
`getVersionCode()` bestemmer; et skall utenfor spennet får 404 før nedlasting og
oppstilling. Installasjon A verifiserte den ekte nivå-3-veien mot produksjon,
mens 404-grenen er kjørt i ekte nettleser med faket bro
(`tests/ota-fetch.test.js`).

**Formen er valgt: URL-en bærer nivået.** To aktuelle former ble vurdert:

| Form | Hvordan den feiler | Pris | |
|---|---|---|---|
| Manifest-URL-en bærer det native nivået (`…/android/<versionCode>.json`) | fail closed av seg selv: et gammelt skall ber om et manifest som ikke finnes, får 404 og gjør ingenting | én URL-form, og én publisering per støttet nivå | **valgt** |
| Manifestet har et felt med nedre `versionCode` | klienten må selv sammenligne og avvise | ett felt, men vakten ligger i klientkoden | ute |

Prisen er ett manifest per støttet nivå. Spennet er
`OTA_MIN_VERSION_CODE` til og med `versionCode`, og akkurat nå er begge `3`.
Det samme tallet er butikkens opplastingsnummer i tillegg til denne rollen
(fase 6).

### En rullet-tilbake bundle må være varig sperret — ikke bare gjenkjent av timeren

`readyTimeout` beskytter mot at en DÅRLIG bundle blir stående, men neste
kaldstart må også nekte samme `bundleId` å bli stilt opp på nytt. Vakten har to
lag:

1. **Pluginens egen blokkliste** (`getBlockedBundles()`), fylt av
   `autoBlockRolledBackBundles`. Dette er hovedvakten.
2. **Klientens egen varige karantene** (`localStorage`, `huskis:ota-blocked`) —
   ekstra laget for prosessdød mellom rollback og readiness i den innebygde
   bundelen.

Begge er fail closed før `setNextBundle()`. Installasjon B målte dette fysisk.
Etter `rig-broken-1` inneholdt pluginens blokkliste `rig-broken-1`, og neste
kaldstart ga `otaStage: { state: 'blocked', detail: 'rig-broken-1' }`. Etter
`rig-broken-2` viste `liveReady` direkte `rollback: true` og
`previousBundleId: 'rig-broken-2'`; klientkarantenen inneholdt
`rig-broken-2`, pluginens blokkliste inneholdt begge riggbundlene, og
`otaStage` blokkerte `rig-broken-2`. Reload-/oppdateringsløkka er dermed
stoppet på tvers av kalde oppstarter på ekte enhet.

### En allerede hentet bundle er ikke en feilet nedlasting

Pluginen avviser `downloadBundle()` med `ERROR_BUNDLE_EXISTS` når `bundleId`
allerede finnes. Klienten skiller derfor `already-downloaded` fra ekte
`download-failed`, og oppstillingen kan gå videre på en bundle som allerede
ligger i lageret. Dette er kjørt i `tests/ota-fetch.test.js`; den ferske
produksjonsmålingen i installasjon A ga `downloaded`, som var nødvendig for å
bevise signatur og native nedlasting i akkurat den oppstarten.

### Den ødelagte bundelen kan ikke være en produksjonsrelease

Rollback må testes med en bundle som aldri når readiness-punktet, men
OTA-bundelen på produksjonsveien ER den samme produksjonsbuilden som deployes
til `huskis.no`. En bevisst ødelagt produksjonsbundle er derfor uaktuelt.

**Valgt: en målerigg — eget skall, eget nøkkelpar, egen vert.** Riggen bygges av
`.github/scripts/ota-rig.js` på en gren som aldri merges. Nøyaktig fem
konstanter skiller riggskallet fra produksjonsskallet:

1. `canonicalAppUrl` i `config.js` → previewverten;
2. CSP-vert i `index.html` → previewverten;
3. `CANONICAL_ORIGIN` i `index.html` → previewverten;
4. reserveverdien i `canonicalAppUrl()` i `app.js` → previewverten;
5. `LiveUpdate.publicKey` i `capacitor.config.json` → riggens engangsnøkkel.

`readyTimeout`, `autoBlockRolledBackBundles`, rollback-, karantene- og
oppstillingskoden er urørt. `tests/ota-rig.test.js` låser avgrensningen.

Riggen hadde to signerte defekte bundles i samme installasjon:
`rig-broken-1` (`--mode throw`: skriptene laster, så kastes det før brukbar
skjerm) og `rig-broken-2` (`--mode blank`: ingen skript, når aldri `ready()`).
Begge ble rullet tilbake og blokkert på fysisk Android i enhetsøkten.

### Slik bygger og kjører du målerigg-runden

Riggen er et verktøy for måling, ikke del av releasen. Reproduserbar oppskrift:

1. Lag en riggren av `main`; den får egen Vercel-preview.
2. Slå Vercel Authentication av midlertidig mens runden står på, ellers får
   skallet `302`/`no-manifest` i stedet for et måleresultat.
3. Kjør `node build.js`, deretter
   `node .github/scripts/ota-rig.js --host https://<preview-verten>`.
4. Commit rigg-`ota/` og de patchede filene, bygg debug-APK på riggrenen, og
   avinstaller forrige skall før installasjon fordi debug-signaturen ikke er
   stabil mellom Actions-kjøringer.
5. Kaldstart: `otaFetch=downloaded`, `otaStage=staged`. Neste kaldstart bruker
   defekt bundle; etter 10 000 ms skal innebygd bundle være tilbake og samme
   `bundleId` blokkert ved neste oppstilling.
6. Hver defekt må ha egen ID. I økten 25. august 2026 ble `rig-broken-1` og
   `rig-broken-2` brukt i samme installasjon.
7. Slå Vercel Authentication på igjen etter runden og slett riggrenen når
   målerapporten er lagret; riggrenen skal aldri merges.

## De to punktene fra fase 4 fikk sitt svar her

**`minimumSupportedRelease` innføres ikke nå.** Additivt skjema og
bakoverkompatibel backend bærer gamle klienter; OTA flytter den vanligste
klienten framover. Native inkompatibilitet håndteres separat gjennom
`versionCode`-spennet.

**Web og mobil får separate builds med samme `releaseId`.** Byte-identisk
artifact ble valgt bort fordi det ville koblet Actions-pakking og Vercels
produksjonsbuild uten å svare på noe `releaseId` ikke allerede svarer på.

## Hva som er lest, testet og observert

| Påstand | Grunnlag |
|---|---|
| Pluginen finnes i ekte Huskis-APK | **observert på fysisk Android** — `window.Capacitor.Plugins.LiveUpdate` eksponerer metodene |
| Native manifestlesning fra `https://localhost` til produksjon virker | **observert på fysisk Android** — nivå-3-manifestet ble lest og `otaFetch` gikk videre til `downloaded` |
| Native bundle-nedlasting ligger utenfor WebView CSP/CORS | **observert på fysisk Android** — produksjonsbundle ble `downloaded`; bundle-stien har med vilje ingen CORS-header, så lesningen kan ikke ha vært WebView-fetch |
| Produksjonssignaturen verifiseres av pluginens Java-kode | **observert på fysisk Android** — `downloaded` på fersk installasjon med `publicKey` satt fail closed |
| Oppstilling med `setNextBundle()` virker | **observert på fysisk Android** — `otaStage: staged`, og neste kaldstart kjørte den nye releasen |
| `LiveUpdate.reload()`/OTA-bytte beholder origin, sesjon og data | **observert på fysisk Android** — `https://localhost`, innlogging og offline-opprettet listepunkt var bevart etter byttet |
| `updateSafety()` beskytter usynket arbeid | **observert på fysisk Android** — `offline` → `syncing` → `safe: true`; byttet skjedde først etter sikker tilstand |
| Aktiveringen er varig | **observert på fysisk Android** — neste kaldstart ga `same-release` og `otaStage: idle` |
| Readiness har stor margin offline | **observert på fysisk Android** — `readyCalledAt` 291/249/314 ms med ferskt token og 277 ms med utløpt/nær-utløpt token, mot 10 000 ms |
| Rollback til innebygd bundle virker | **observert på fysisk Android-rigg** — både `throw` og `blank` falt tilbake; `blank` ga eksplisitt `rollback: true` |
| Pluginens permanente blokkliste fylles | **observert på fysisk Android-rigg** — `bundleIds` endte med både `rig-broken-1` og `rig-broken-2` |
| Klientens ekstra karantene fylles når rollback-signaturen leses | **observert på fysisk Android-rigg** — `otaBlocked: ['rig-broken-2']` sammen med `previousBundleId: 'rig-broken-2'` |
| En blokkert bundle stilles ikke opp på nytt på neste kaldstart | **observert på fysisk Android-rigg** — `otaStage.state === 'blocked'` for begge rigg-ID-ene |
| Native bibliotekers merged manifest | **observert i APK-workflowen** — `zip4j` ingen noder; `okhttp-android` én `androidx.startup`-initializer |
| Automatiske fail-closed- og systemgrensetilfeller | **kjørt i tester** — `ota-fetch`, `auto-update`, `release-pipeline`, `capacitor-android`, `ota-rig` |

## Enhetsøkten — kjørt 25. august 2026

Økten ble kjørt i to installasjoner fordi hvert debug-skallbytte krever
avinstaller + installer og dermed nullstiller appdata.

### Installasjon A — produksjonsskallet

Skall: debug-APK fra `0ebb737b5bf9` (`versionCode 3`). Første ferske oppstart:

```json
{
  "release": "0ebb737b5bf9",
  "otaFetch": { "state": "downloaded", "detail": "23a5e4cdeaf7-mt8ge5ib" },
  "otaStage": { "state": "staged", "detail": "23a5e4cdeaf7-mt8ge5ib" }
}
```

Dette er den ferske produksjonsnedlastingen: native OkHttp kom utenfor
WebView-CSP/CORS, Java godtok Node-signaturen mot den innebygde
produksjonsnøkkelen, og `setNextBundle()` stilte bundelen opp.

`updateSafety()` ble deretter lest mens et nytt listepunkt ble opprettet
offline:

```text
{ safe: false, reason: 'offline' }
{ safe: false, reason: 'syncing' }
{ safe: true,  reason: '' }
```

Oppdateringsmotoren gjennomførte byttet automatisk etter at tilstanden ble
trygg. Den eksplisitte «før reload»-avlesningen rakk derfor ikke å bli tatt, men
hele sekvensen binder årsaken: APK-en startet på `0ebb737b5bf9`, den nye bundelen
var `staged`, byttet var blokkert offline og under synk, og etter `safe: true`
kjørte den nye releasen. Etter byttet var `origin` fortsatt
`https://localhost`, brukeren fortsatt innlogget og det offline-opprettede
listepunktet fortsatt til stede.

Neste kaldstart:

```json
{
  "release": "23a5e4cdeaf7",
  "otaFetch": { "state": "same-release", "detail": "23a5e4cdeaf7" },
  "otaStage": { "state": "idle", "detail": null },
  "authUser": true,
  "origin": "https://localhost"
}
```

Mens timingmålingen pågikk ble PR #150 merget, og telefonen OTA-oppdaterte seg
videre til `215ee37d5dac`. Det er forventet og ble i seg selv en ekstra
produksjons-OTA-observasjon. Tidsmålingene ble gjort på denne nyere bundelen.

Flymodus, ferskt token — tre kalde oppstarter:

| # | `reachedAt` | `readyCalledAt` | `readyResolvedAt` |
|---|---:|---:|---:|
| 1 | 291 ms | 291 ms | 344 ms |
| 2 | 249 ms | 249 ms | 290 ms |
| 3 | 314 ms | 314 ms | 367 ms |

Flymodus, token satt til å utløpe om fem sekunder og deretter latt utløpe før
kaldstart:

```json
{
  "readyMs": {
    "reachedAt": 277,
    "readyCalledAt": 277,
    "readyResolvedAt": 300
  },
  "appReady": true,
  "liveReadyError": null
}
```

`readyCalledAt` er tallet som sammenlignes med `readyTimeout`; alle fire
målingene er nedre grenser fordi pluginens rollback-timer armeres før WebView-
navigasjonens nullpunkt. Marginen er likevel over 9,6 sekunder selv i den
langsommeste målte starten, og token nær utløp gjorde ingen målbar forskjell.

### Installasjon B — rollback-riggen

Riggskall: `cebe6df46862`, bygget av `claude/ota-rigg-vc3`. Fem konstanter
skiller skallet fra produksjon (de fire vert/origin-konstantene og
`LiveUpdate.publicKey`); `readyTimeout`, `autoBlockRolledBackBundles`, rollback,
karantene og oppstilling er produksjonskoden.

**Runde 1 — `rig-broken-1` / `throw`:**

Før aktivering:

```json
{
  "release": "cebe6df46862",
  "otaFetch": { "state": "downloaded", "detail": "rig-broken-1" },
  "otaStage": { "state": "staged", "detail": "rig-broken-1" }
}
```

Etter defekt oppstart og automatisk retur til innebygd bundle ble det korte
`liveReady.rollback`-signalet ikke fanget i tide; den første avlesningen var:

```json
{
  "release": "cebe6df46862",
  "liveReady": { "currentBundleId": null, "previousBundleId": null, "rollback": false },
  "otaBlocked": [],
  "otaStage": { "state": "blocked", "detail": "rig-broken-1" }
}
```

Den varige native blokkliste-avlesningen viste imidlertid direkte:

```json
{ "bundleIds": ["rig-broken-1"] }
```

Neste kaldstart beholdt `release = ceb...`, `otaStage = blocked` for
`rig-broken-1` og samme pluginblokkliste. Runde 1 beviser derfor faktisk
rollback/fallback og pluginens hovedkarantene, men ikke klientens ekstra
`localStorage`-karantene — det forbigående ReadyResult-et ble ikke observert.

**Runde 2 — `rig-broken-2` / `blank`:**

Manifestet ble byttet til den andre allerede signerte riggbundelen uten ny
installasjon. Før aktivering:

```json
{
  "release": "cebe6df46862",
  "otaFetch": { "state": "downloaded", "detail": "rig-broken-2" },
  "otaStage": { "state": "staged", "detail": "rig-broken-2" },
  "pluginBlocked": { "bundleIds": ["rig-broken-1"] }
}
```

Etter blank bundle, timeout og automatisk rollback:

```json
{
  "release": "cebe6df46862",
  "liveReady": {
    "currentBundleId": null,
    "previousBundleId": "rig-broken-2",
    "rollback": true
  },
  "otaBlocked": ["rig-broken-2"],
  "otaStage": { "state": "blocked", "detail": "rig-broken-2" },
  "pluginBlocked": {
    "bundleIds": ["rig-broken-1", "rig-broken-2"]
  }
}
```

Runde 2 er det komplette direkte beviset: fallback, ReadyResult-signaturen,
klientkarantenen, pluginens permanente blokkliste og avvisning før ny
oppstilling ble observert samtidig.

## Slik kjører du enhetsøkten igjen

Protokollen beholdes fordi den er nyttig ved regresjonskontroll og senere iOS-
arbeid. Produksjonsmålingen må bruke et kompatibelt skall (`versionCode` innen
manifestspennet) som ligger minst én release bak manifestet på produksjon.
Rollback-målingen må bruke en separat riggvert/nøkkel; en ødelagt bundle skal
aldri publiseres på produksjonsveien.

### Installasjon A — produksjon

1. Fersk installasjon av kompatibel produksjons-APK; `chrome://inspect`.
2. Les `otaFetch` og `otaStage`: fersk annen release skal gi `downloaded` og
   `staged`.
3. Gjør en lokal endring offline; bekreft `updateSafety()` false offline, false
   mens synk pågår, true etter synk.
4. La ekte update-check-vei gjennomføre byttet. Bekreft samme origin,
   innlogging og data.
5. Kaldstart på nytt: `same-release`, `otaStage: idle`.
6. Mål minst tre flymodus-kaldstarter med ferskt token og minst én med token nær
   utløp. Sammenlign `readyCalledAt` med `readyTimeout`.

### Installasjon B — rigg

1. Gjør previewverten offentlig midlertidig; installér rigg-APK ferskt.
2. `throw`: `downloaded`/`staged`, aktiver, vent rollback, les ReadyResult,
   klientkarantene og `getBlockedBundles()`; neste kaldstart skal blokkere samme
   ID.
3. Bytt manifestet til en ny, allerede signert `blank`-ID uten reinstallasjon;
   gjenta.
4. Slå previewbeskyttelsen på igjen og slett riggrenen etter at målingen er
   dokumentert.

## Implementasjonen skal

- [x] aldri OTA-oppdatere Swift/Kotlin/native plugins — LiveUpdate bytter bare
      web-assets, og `versionCode`-manifestspennet hindrer webkode som krever et
      annet skall i å bli tilbudt uten riktig native nivå;
- [x] håndheve native-kompatibilitet som en vakt: manifest-URL-en bærer
      `versionCode`, og nivå 3-produksjonsveien er observert på ekte skall;
- [x] verifisere bundle før aktivering — fysisk Android godtok den faktiske
      produksjonssignaturen mot den innebygde `publicKey`;
- [x] beholde den innebygde butikkversjonen som fallback — begge riggdefektene
      falt tilbake til innebygd bundle;
- [x] kalle `ready()` i et definert readiness-punkt etter brukbar lokal skjerm
      og før nettavhengig auth — målt med 249–314 ms i flymodus, også med token
      nær utløp;
- [x] gjenbruke `updateSafety()` slik at bundlebytte ikke skjer midt i usikret
      arbeid — fysisk sekvens `offline` → `syncing` → `safe` og bevart
      offline-endring;
- [x] klargjøre målet (nedlasting + `setNextBundle()`) før reload — fysisk
      `downloaded` + `staged`, deretter varig ny release;
- [x] tåle offline oppstart — fire flymoduskaldstarter nådde readiness uten
      feil og med stor margin;
- [x] unngå reload-/oppdateringsløkker på tvers av kalde oppstarter — begge
      riggbundlene ble permanent blokkert og `otaStage` avviste dem før ny
      oppstilling;
- [x] kunne rulle tilbake en dårlig mobilbundle — både «script kaster før
      brukbar skjerm» og «blank / når aldri ready» er observert på fysisk
      Android-rigg;
- [x] først bevises på Android før den tas til iOS — hele enhetsøkten er kjørt
      på Android før fase 7.

**Ferdigkriterium:** en testrelease kan oppdatere browser og Android til samme
`releaseId` uten butikkoppdatering, og mobilappen kan trygt falle tilbake hvis
OTA-releasen er defekt. **Oppfylt på fysisk Android 25. august 2026.**

---

# Fase 6 — Android intern distribusjon

**Mål:** flytte fra sideloadet debug-APK til en ekte signert Android-app i
Google Plays interne testspor.

Fasen har to halvdeler som ikke kan gjøres i samme runde. Alt som kan bygges,
låses og prøves fra repoet er innført. Resten krever en Google-konto, en
appoppføring og en nøkkel som ikke finnes ennå, og står igjen som navngitte
manuelle steg — ikke som uavklart arbeid.

**Innført i repoet, og maskinelt dekket:**

- [x] Bekreft endelig package ID før første opplasting — `no.huskis.app`, se
      «Package ID-en er endelig».
- [x] Sett opp signing og håndtering av nøkler uten secrets i repoet.
      Gradle tar imot materialet utenfra og AVVISER et release-bygg uten det.
      Den stabile signaturen på testbuildene følger av dette, men først når
      nøkkelen faktisk finnes — den står derfor på den manuelle lista.
- [x] Produser release-AAB reproducerbart fra CI —
      `.github/workflows/android-release.yml`.
- [x] Ta `versionCode` videre fra OTA-vakten (fase 5) til butikkens krav:
      monotont økende per opplasting, og konsistent med grensen OTA-manifestet
      allerede bruker. Det er samme tall i to roller — ikke to ordninger.
- [x] Bytt Capacitor-malens logo mot Huskis' eget merke i appikonet og
      splash-bildet — se «Appikonet og splash-bildet». Det som fortsatt er
      manuelt er butikkoppføringens grafikk, som lastes opp i Play Console og
      ikke ligger i binæren.

**Krever at du gjør noe manuelt, i denne rekkefølgen:**

- [ ] Opprett/verifiser Google Play Developer-konto.
- [ ] Lag upload-nøkkelen og legg inn de fire GitHub-secretene («Slik lager du
      upload-nøkkelen»).
- [ ] Kjør «Android release-AAB» manuelt og last den ned.
- [ ] Opprett appoppføring med butikkgrafikken: 512×512-ikonet, feature-
      grafikken og screenshots. Den grafikken lastes opp i Play Console og
      ligger IKKE i binæren — appikonet i AAB-en er allerede Huskis' eget.
- [ ] Meld appen inn i Play App Signing ved første opplasting, og sett
      repository-variabelen `ANDROID_UPLOAD_CERT_SHA256`.
- [ ] Fullfør privacy/Data Safety-opplysninger basert på faktisk databruk.
- [ ] Gi reviewer/testspor fungerende testkonto der det kreves.
- [ ] Test installasjon, oppgradering og rollback gjennom Play-sporet.
- [ ] Ta App Links opp igjen når nøkkelen finnes: begge halvdelene i samme
      endring (intent-filter + `.well-known/assetlinks.json` som `build.js`
      faktisk kopierer ut). Avgjør FØRST det åpne spørsmålet i fase
      3-seksjonen, på telefon: leverer browseren fra seg på slutten av
      Supabase' 303 til en verifisert App Link? Svaret bestemmer om dette er
      fire eller seks koblede endringer, og dermed om det er verdt gevinsten:
      én spart innlogging i de to auth-flytene som koster en, pluss
      invitasjonen til en registrert mottaker. MERK at fingeravtrykket
      `assetlinks.json` skal inneholde er APP-SIGNING-sertifikatets, ikke
      upload-sertifikatets — se nøkkeltabellen under.

**Ferdigkriterium:** en tester kan installere og oppdatere Huskis gjennom Google
Play uten sideloading.

## Tre nøkler, tre jobber — og bare offentlige halvdeler i repoet

Fra og med denne fasen finnes det tre uavhengige nøkkelpar rundt Huskis. De
signerer hver sin ting, og de kan ikke erstatte hverandre.

| Nøkkel | Signerer | Hvor privatdelen bor | Hvis den er borte eller byttes |
|---|---|---|---|
| **Upload key** | AAB-en som lastes opp til Play | din maskin (`huskis-upload.jks`) + GitHub-secrets. ALDRI i repoet | Play avviser opplastingen. Nøkkelen kan erstattes — Google kan nullstille den mot en ny |
| **App signing key** | APK-ene Google Play leverer til telefonene | hos Google, generert av Google ved påmelding til Play App Signing | kan aldri byttes. Det er DENNE signaturen telefonen ser, og den som avgjør om en oppdatering får lov til å erstatte den installerte appen |
| **OTA-nøkkelen** (fase 5) | web-bundelen OTA leverer | GitHub-secret `OTA_SIGNING_KEY`. Den offentlige halvdelen står som `publicKey` i `capacitor.config.json` | ingen telefon kan verifisere bundelen. Se «Nøkkelparet» i fase 5 |

**Play App Signing er ikke et valg.** En ny app på Google Play må levere AAB og
må være meldt inn i Play App Signing. Konsekvensen er hele grunnen til at
oppsettet ser ut som det gjør: du signerer ALDRI det brukeren installerer. Du
signerer opplastingen, Google verifiserer at den kom fra deg, pakker om og
signerer på nytt med app-signing-nøkkelen.

Det er også hele sikkerhetsgevinsten. Ved påmelding skal Google GENERERE
app-signing-nøkkelen; da finnes den aldri utenfor Googles nøkkellager, og den
ene nøkkelen som ikke kan erstattes kan heller ikke mistes herfra. Upload-
nøkkelen, som du faktisk holder, er den erstattelige av de to.

**Dette skal aldri inn i repoet, i noen form:** keystore-filen (`.jks`,
`.keystore`, `.p12`), passordene, aliaset, og base64-formen av keystoren.
`.gitignore` dekker filmønstrene og `android/keystore.properties` i repo-roten,
og `tests/android-release.test.js` leser hele det sporede treet for å slå fast
at ingen keystore og ingen PEM-privatnøkkel har kommet inn.

Det ENESTE signeringsrelaterte som hører hjemme i repoet er offentlig:
OTA-nøkkelens `publicKey`, og — når den finnes — upload-sertifikatets SHA-256-
fingeravtrykk som repository-VARIABEL. Et fingeravtrykk er offentlig av natur;
Play Console viser det selv.

## Hva GitHub Actions trenger

| Navn | Type | Hvor den hentes | Brukes av |
|---|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | secret | `base64 -w0 huskis-upload.jks` | android-release.yml |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | secret | passordet du satte på keystoren | android-release.yml |
| `ANDROID_UPLOAD_KEY_ALIAS` | secret | aliaset du ga nøkkelen (`huskis-upload`) | android-release.yml |
| `ANDROID_UPLOAD_KEY_PASSWORD` | secret | passordet på selve nøkkelen | android-release.yml |
| `ANDROID_UPLOAD_CERT_SHA256` | **variabel** | skrives ut av workflowen etter første bygg, og står i Play Console | android-release.yml |

De fire første legges inn under Settings → Secrets and variables → Actions →
**Secrets**. Den siste under **Variables** i det samme bildet — den er ikke
hemmelig, og den er maskinsjekken på at signaturidentiteten er STABIL: er den
satt, feiler jobben hvis AAB-en er signert med en annen nøkkel enn sist.

Verdiene brukes **nøyaktig som de er lagret**. Et passord kan lovlig begynne
eller slutte med blanktegn, så Gradle trimmer dem ikke — trimming brukes bare
til å avgjøre om en secret er blank, altså usatt. Prisen er at et linjeskift på
slutten av en secret er en ekte forskjell: `gh secret set X < fil` tar med
linjeskiftet, mens innliming i nettleseren ikke gjør det. Er passordet feil,
sier `keytool`-forsjekken i jobben fra før Gradle i det hele tatt starter.

Gradle leser aldri secretene direkte. Workflowen skriver keystoren til
`$RUNNER_TEMP` (utenfor repoet), setter miljøvariablene
`HUSKIS_UPLOAD_KEYSTORE_FILE`, `HUSKIS_UPLOAD_KEYSTORE_PASSWORD`,
`HUSKIS_UPLOAD_KEY_ALIAS` og `HUSKIS_UPLOAD_KEY_PASSWORD` på det ene steget som
bygger, og sletter keystoren igjen uansett utfall. Passordene går aldri gjennom
`$GITHUB_ENV`, som ville båret dem videre til hvert steg etterpå.

## Slik lager du upload-nøkkelen

Én gang, på din egen maskin. Filen skal ALDRI inn i repoet, og den bør
sikkerhetskopieres et sted du finner den igjen om fem år.

```bash
keytool -genkeypair -v \
  -keystore huskis-upload.jks -storetype PKCS12 \
  -alias huskis-upload \
  -keyalg RSA -keysize 4096 \
  -validity 10000                        # ~27 år; Play krever gyldighet forbi 2033

base64 -w0 huskis-upload.jks             # Linux — innholdet i secreten
base64 -i huskis-upload.jks | tr -d '\n'  # macOS
```

Bruk **samme passord** på keystoren og på nøkkelen. PKCS12 støtter ikke
forskjellige passord for de to; keytool sier fra og bruker keystore-passordet
uansett. Begge secretene fylles likevel ut — formen er standard Android, og
Gradle-siden håndterer også et oppsett der de er forskjellige.

**Lokalt, uten GitHub:** legg `android/keystore.properties` (gitignorert) med
`storeFile`, `storePassword`, `keyAlias` og `keyPassword`, og kjør
`cd android && ./gradlew bundleRelease`. Miljøvariablene vinner over filen der
begge finnes, slik at en glemt lokal fil aldri kan overstyre det CI ble bedt om
å signere med.

## Fail closed i tre lag

Den farlige feilen er ikke at et release-bygg stopper. Den farlige feilen er at
det IKKE stopper: uten en `signingConfig` bygger Gradle glad og fornøyd ferdig
og legger fra seg en **usignert** `app-release.aab` med nøyaktig det vanlige
navnet. En jobb som lastet den opp som artifact ville sett grønn ut, og feilen
ville først vist seg i Play Console.

| Lag | Hvor | Hva det stopper |
|---|---|---|
| 1 | `android-release.yml`, første steg med secrets | mangler én av de fire secretene, feller jobben før noe arbeid er gjort |
| 2 | `android/app/build.gradle`, vakt på task-grafen | mangler signeringsmaterialet, avvises `:app:*Release`-pakking FØR noen oppgave har kjørt — det finnes ingen halvferdig artifact å forveksle med en ekte |
| 3 | `android-release.yml`, etter bygget | `keytool -printcert -jarfile` leser signaturen ut av det FERDIGE artifactet og feiler hardt på en usignert fil. Er `ANDROID_UPLOAD_CERT_SHA256` satt, kreves i tillegg at det er samme nøkkel som sist |

Lag 2 er den ene invarianten som ikke kan leses ut av en fil, og workflowen
prøver den derfor på ekte: den kjører et release-bygg med TOMT signeringsmiljø,
krever at det feiler PÅ VAKTEN (ikke på noe annet), og at det ikke ligger igjen
en AAB etterpå. Prøven kjører også foran hvert signert bygg — hver eneste AAB
som lastes opp herfra har nettopp bevist sin egen fail-closed-vakt.

## `versionCode` og `versionName`: ett tall, to roller

`versionCode` står på `3`. Det er det samme tallet i to jobber, og det skal
fortsette å være ETT tall:

- **OTA-ens kompatibilitetsnivå** (fase 5): manifestet publiseres per nivå, og
  et skall uten et manifest for sitt nivå får 404 og gjør ingenting.
- **Google Plays opplastingsnummer**: Play avviser en opplasting som gjenbruker
  et nummer, og en app kan bare oppdateres til et høyere.

**Regelen: tallet økes med 1 i den endringen som produserer en ny
butikkopplasting, og gjenbrukes eller senkes aldri.**

Det er én regel fordi de to kravene aldri kan komme i konflikt. Hver
butikkopplasting er en ny binær, og hver binær som er native forskjellig må
uansett ha et nytt nivå. En økning som skjer av butikkgrunner alene er
harmløs for OTA: manifestspennet (`OTA_MIN_VERSION_CODE` til og med
`versionCode`) blir ett nivå bredere, og det nye nivået er native identisk med
det forrige — begge skallene kan ta i bruk den samme bundelen.

`OTA_MIN_VERSION_CODE` beveger seg fortsatt uavhengig, og bare oppover: den
heves når web-koden begynner å kreve noe et eldre skall ikke har. Butikken har
ingenting med den grensen å gjøre.

**Vakten mot en senkning** ligger i `android-release.yml`, som på hver PR
sammenligner `versionCode` mot PR-ens base med den SAMME parseren OTA-manifestet
bruker (`readVersionCode` i `.github/scripts/ota-bundle.js`). At tallet skal
ØKES før en ny opplasting er derimot en regel for opplastingen, ikke for hver
PR — og der er Play selv den harde porten.

**`versionName` er `"1.0.4"`, og utledes av det samme tallet.** Play krever
ingenting av feltet — det er en visningsstreng, ikke en nøkkel — men testerne
ser den, og Play navngir releasen i konsollen med den. En konstant `"1.0"`
ville gjort to interne testreleaser umulige å skille fra hverandre. Prefikset
`1.0.` er en fast etikett og økes ikke: **dette er ikke SemVer**, og Huskis har
ingen produktversjon å uttrykke.

Release-identiteten er fortsatt `releaseId` ([`auto-update.md`](auto-update.md)),
og den kan ikke brukes her: den utledes av commiten og BYTTES av OTA, mens
`versionName` er bakt inn i binæren. Et `versionName` satt til `releaseId` ville
ligget og påstått feil release på hver eneste telefon som hadde tatt imot en
OTA-bundle.

## Package ID-en er endelig

`no.huskis.app` er behandlet som **endelig** fra og med nå, og skal ikke endres.

Grunnen er ikke smak. Application ID-en er primærnøkkelen til Play-oppføringen,
til installasjonen på hver telefon og til app-signing-nøkkelen. Etter første
opplasting er den låst for appens levetid: en «ny» ID er en ny app — ny
oppføring, nye testere, ingen oppgradering av den installerte.

Undersøkelsen i repoet fant ingen teknisk grunn til å velge noe annet. Den er
reversert domenenavn for huskis.no, den er en gyldig Android application ID
(minst to segmenter, hvert segment starter med en bokstav, ingen av dem er et
Java-nøkkelord — sjekket maskinelt), og den står allerede likt i alle seks
stedene som navngir den:

| Sted | Felt |
|---|---|
| `capacitor.config.json` | `appId` |
| `android/app/build.gradle` | `applicationId` |
| `android/app/build.gradle` | `namespace` |
| `android/app/src/main/res/values/strings.xml` | `package_name` |
| `android/app/src/main/res/values/strings.xml` | `custom_url_scheme` |
| `android/app/src/main/java/no/huskis/app/MainActivity.java` | pakkeerklæringen + kildestien |

Det ene som ikke kan avgjøres herfra er om ID-en allerede er tatt av en annen
utvikler på Play. Det ses første gang appoppføringen opprettes, og er derfor et
punkt på den manuelle lista.

Malens eksempelklasser under `android/app/src/test` og
`android/app/src/androidTest` ligger fortsatt i `com.getcapacitor.myapp`. De
kompileres aldri inn i appen, og er derfor utenfor vakten med vilje.

## Appikonet og splash-bildet

Begge er Huskis' eget merke — de tre stablede kortene med avkryssingslista på
det fremste, det samme motivet som `favicon.svg` og `.brand-mark` på
innloggingsskjermen (`docs/design-system.md`). Fram til nå var begge
**Capacitor-malens** logo, urørt siden fase 1.

Det var ikke kosmetikk å bytte. Ikonet og splash-bildet er det eneste av appen
en tester ser før web-laget har tegnet noe som helst, og en mal-logo er i samme
familie av feil som resten av denne fasen: den ser grønn ut i et bygg,
den vises først i Play Console eller på en telefon — og etter første opplasting
koster den en ny `versionCode` og en ny opplasting å rette.

| Fil | Hva den er |
|---|---|
| `res/drawable/ic_launcher_foreground.xml` | Merket som VectorDrawable — forgrunnen i adaptive-ikonet, altså det ~alle telefoner faktisk viser (API 26+) |
| `res/values/ic_launcher_background.xml` | Bakgrunnslaget: hvit, samme flate som splash-bildet |
| `res/mipmap-*dpi/ic_launcher{,_round}.png` | Rasterfallbacken for API 24–25, som ikke kjenner adaptive-ikoner. `minSdkVersion` er 24, så de må finnes |
| `res/drawable*/splash.png` | Splash-bildet, én per tetthet og orientering fordi bitmapen strekkes til vinduet |

**Merket ligger i 108-rutenettets trygge sone.** Et adaptive-ikon er 108×108dp,
men launcheren klipper det med sin egen maske — bare de midterste 72dp er
garantert synlige. Merket er 56dp bredt og sentrert, altså 26–82dp, med margin
inn til masken uansett hvilken form telefonen bruker.

**Vektoren står i favicon-ens eget 24-rutenett**, og `<group>` gjør om til
108-rutenettet. Det er med vilje: da kan de to tegningene sammenlignes linje for
linje. SVG-ens `<rect rx>` og `<circle>` finnes ikke i en VectorDrawable og er
skrevet ut som `pathData`; konverteringen er verifisert pikselidentisk med
`favicon.svg`.

**Ett sted skiller de to med vilje: STREKEN.** I webappen er merkets strek 1 px
uansett visningsstørrelse (`docs/design-system.md` → «Ikoner»), fordi den vises
i alt fra en 16 px favicon til en 52 px `.brand-mark`. Appikonet tegnes derimot
ÉN gang, stort — 1 px av 108dp ville ikke vært en kontur, men ingenting — så
vektoren beholder en strek som skalerer med tegningen (`strokeWidth 0.9` i
24-rutenettet). Geometrien er fortsatt den samme; det er bare strekregelen som
er ulik, og av samme grunn som for varselikonene (`docs/varsler.md`).

**Rasterfilene er UTLEDET av `favicon.svg`, ikke tegnet på nytt.** Endres
merket, må de genereres om — og `tests/android-release.test.js` sier fra: den
leser fargene ut av hver enkelt bildefil og krever at merkets tre kortfarger
står der. Et filnavn ville ikke fanget noe, for malens filer heter nøyaktig det
samme som våre.

Splash-bildet er fortsatt **hvitt i begge drakter**. Det er ikke en forglemmelse:
`AppTheme.NoActionBarLaunch` har med vilje ingen night-variant, fordi mørke
glyfer i statusfeltet gjelder hele døgnet over den hvite splash-flaten
(`values/styles.xml` og `values-night/styles.xml` forklarer hvorfor). Bare
motivet er byttet — mekanismen er urørt.

**Ikke innført:** et `<monochrome>`-lag for Androids tematiserte ikoner (API 33+).
Uten det tematiserer launcheren simpelthen ikke Huskis-ikonet; ingenting brekker.
En monokrom utgave av en «papirbunke» der de tre kortene skilles av FARGE er en
egen designoppgave, ikke en mekanisk utledning.

## Slik bygger du release-AAB-en

1. Legg inn de fire secretene (over).
2. Actions → **Android release-AAB** → Run workflow, på `main`.
3. Last ned artifactet `huskis-release-aab`. Jobbsammendraget viser package ID,
   `versionCode`, `versionName`, `releaseId`, commit og sertifikatets SHA-256.
4. Første gang: sett repository-variabelen `ANDROID_UPLOAD_CERT_SHA256` til
   fingeravtrykket i sammendraget. Fra da av er signaturidentiteten låst
   maskinelt.
5. Play Console → Testing → Internal testing → last opp AAB-en.

Workflowen bygger med den samme kjeden som resten av mobilappen —
`node build.js` → `dist/` → `cap sync android` → `gradlew bundleRelease` — og
kjører de rene node-testene FØR artifactet produseres. Den publiserer
ingenting til Google Play; opplastingen er manuell inntil kontoen og
oppføringen finnes.

**Den første Play-installasjonen koster én avinstallering.** Den sideloadede
debug-APK-en er signert med Androids debugnøkkel, og en app kan ikke bytte
signatur på en telefon. Enheten må derfor avinstallere debugbygget før den kan
installere fra Play, og lokal appdata går tapt den ene gangen. Etterpå er
signaturen stabil, og hver ny opplasting oppgraderer den forrige — som er
nettopp det fase 5 måtte klare seg uten.

## Hva som er automatisk dekket

`tests/android-release.test.js` er vakten for hele fasen (`node
tests/android-release.test.js`): package ID-en i alle seks stedene og at ingen
annen ID er erklært i det som pakkes; `versionCode` som ett heltallsliteral den
samme parseren OTA-manifestet bruker kan lese, og `versionName` utledet av det;
at signeringsmaterialet kommer utenfra og at ingen nøkkelfil, alias eller
passord er skrevet inn i Gradle-skriptet; at `signingConfig` settes ett sted og
bak betingelsen; at task-graf-vakten finnes, treffer appmodulens
release-pakking og IKKE debugbygget; at ingen keystore og ingen PEM-privatnøkkel
finnes i det sporede treet; og hele release-workflowen — rekkefølgen på
stegene, riktig variant, testene før artifactet, de tre fail-closed-lagene, at
secretene aldri skrives ut eller går gjennom `$GITHUB_ENV`, og at debugveien er
urørt.

Butikkgrafikken er dekket av den samme fila, og den leser BILDENE, ikke
filnavnene: merkets tre kortfarger må stå i hver eneste rasterfil (ti
launcher-ikoner og elleve splash-bilder, hvert i sitt riktige mål), forgrunnen
må være vektoren i 108-rutenettet, adaptive-ikonet må peke på den og den hvite
flaten, manifestet må fortsatt peke på rasterfallbacken — og malens egne filer
må være FJERNET, ikke bare overskygget: en gjenglemt
`drawable-v24/ic_launcher_foreground.xml` vinner over `drawable/` fra API 24 og
ville stille gitt malens logo tilbake på hver eneste telefon.

Forholdet mellom `versionCode` og OTA-manifestspennet står fortsatt i
`tests/release-pipeline.test.js`, og skallets øvrige invarianter i
`tests/capacitor-android.test.js`.

**Ikke verifisert maskinelt:** at et signert bygg faktisk kommer ut i den andre
enden. Ingen keystore finnes ennå, så `bundleRelease` har aldri kjørt MED
materiale — det er AVVISNINGEN workflowen prøver, på hver PR som rører skallet.
Det siste leddet lukkes første gang workflowen kjøres med secretene på plass;
lag 3 (signaturen lest ut av artifactet) er porten som lukker det.

## Neste PR

Denne runden er repo-siden. Neste tekniske leveranse er ikke kode, men de
manuelle stegene: konto, nøkkel, secrets og første opplasting. Kommer det en PR
før det, er det den som legger inn Play-publisering fra CI — og den kan ikke
skrives før det finnes en appoppføring å publisere til og en service-konto å
gjøre det med.

---

# Fase 7 — iOS og TestFlight

**Mål:** gjenbruke den beviste arkitekturen på iOS, ikke starte et nytt
mobilprosjekt.

Capacitor iOS bygges med Apples verktøykjede; macOS + Xcode kreves for normal
lokal bygging/testing. Dersom arbeidet fortsatt skal være cloud-first, må vi
velge en macOS CI/build-løsning før denne fasen.

- [ ] Installer/pin iOS-plattformen i samme Capacitor-major som Android.
- [ ] Generer og sjekk inn `ios/`.
- [ ] Konfigurer bundle ID, signing og Apple Developer/App Store Connect.
- [ ] Kjør samme funksjonelle paritetsmatrise som på Android.
- [ ] Implementer bare de iOS-spesifikke integrasjonene som faktisk trengs.
- [ ] Konfigurer Universal Links/auth-retur der nødvendig.
- [ ] Produser signert build og distribuer via TestFlight.
- [ ] Bevis OTA og fallback på TestFlight-build før offentlig lansering.

**Ferdigkriterium:** en ekstern TestFlight-tester kan bruke samme Huskis-release
som web/Android med fungerende synk og trygg oppdatering.

---

# Fase 8 — offentlig lansering og samlet releasepipeline

**Mål:** én normal Huskis-endring skal ha én forståelig vei fra PR til alle
plattformene.

- [ ] App Store- og Google Play-oppføringer er komplette og godkjenningsklare.
- [ ] Policy-/personvernopplysninger er konsistente med faktisk appadferd.
- [ ] En vanlig webrelease kan publisere web + OTA-kanaler fra samme
      `releaseId`.
- [ ] En native endring bygger nye butikkbinaries og kan ikke feilaktig gå kun
      gjennom OTA.
- [ ] Releasejobbene respekterer eksisterende databaseport:
      tester → migrering → smoke før inkompatibel frontend kan slippes.
- [ ] Secrets/signing-nøkler ligger i egnet secret store, aldri i repo/logg.
- [ ] Staged rollout og rollback er dokumentert og testet på begge plattformer.
- [ ] Overvåkning/feilrapportering er tilstrekkelig til å oppdage en dårlig
      mobilrelease.

**Ferdigkriterium:** Huskis utvikles fortsatt som **ett produkt**. Web, Android
og iOS deler produktkode og release-identitet; bare reelt native endringer
krever egne butikkbinaries.

---

# Native varsler

**Mål:** levere de samme varslene Huskis allerede genererer også når appen er
lukket — uten en ny varselmodell, og uten en pushserver på Android.

Modellen, tersklene, planen, tillatelsene og teksten er dokumentert i
[`varsler.md`](varsler.md), som er autoritativ. Her står bare det som er
NATIVT, og hva som gjenstår å prøve på en telefon.

## Hva som er innført

`@capacitor/local-notifications` er den fjerde og siste native avhengigheten
(etter `@capacitor/core`, `@capacitor/android` og OTA-pluginen), pinnet eksakt
som de andre. Web-laget kaller den gjennom den samme pluginbroen fase 5 bruker,
bak den samme gaten — `tests/capacitor-android.test.js` låser at broen bare
leses for de to kjente pluginene.

Valget er LOKALE alarmer, ikke push: telefonen har planen selv og vekker seg
selv. Det gir tre ting på én gang — ingen pushserver i kjeden, riktig lokal
veggtid uten en sone å oversette til, og ingenting som må ut av enheten for at
et varsel skal komme fram.

**SCHEDULE_EXACT_ALARM er trukket tilbake** med `tools:node="remove"`.
Pluginen erklærer den i sitt eget manifest, og uten linjen ville
manifest-fletteren tatt den inn i binæren. Tillatelsen er «special access»:
Google Play krever et eget skjema for at en app skal få be om den. Huskis
trenger den ikke — hvert varsel planlegges med `isExactNotification: false`,
som gir `AlarmManager.setAndAllowWhileIdle()`: upresist, men det fyrer også i
dvale, og «fristen er utløpt» tåler noen minutter. Dette er det ENESTE
merger-direktivet i produksjonsmanifestet, og vakten i
`tests/capacitor-android.test.js` er skrevet som en alleliste på nøyaktig den
teksten.

POST_NOTIFICATIONS (Android 13+) flettes derimot INN fra pluginen og skal det:
den er selve varseltillatelsen, og adapteren ber om den bak et brukertrykk i
varselinnstillingene — aldri ved oppstart.

**Varslene har sin egen kanal**, `huskis-notif-v1`, med høy viktighet (4) og
vibrasjon, slik at Android normalt viser dem som heads-up. Låseskjermen ber
appen ikke om: Android nullstiller kanalens lockscreen-visibility for en kanal
appen selv oppretter, så hva som vises på en låst skjerm er brukerens egen
innstilling (med varselets PRIVATE som utgangspunkt). Heads-up er dessuten en
forespørsel, ikke en garanti: brukeren,
«Ikke forstyrr» og produsentens innstillinger har siste ord — og de justeres
der, i Androids varselinnstillinger for appen, ikke i en egen Huskis-bryter.
Android 7 (API 24–25, som minSdk fortsatt slipper inn) har ingen kanaler i det
hele tatt; der bærer varselet høy prioritet i stedet, som er det eneste som
avgjør heads-up på den versjonen. Kanalen og prioriteten er de ENESTE
mekanismene som er tatt i bruk for dette: ingen `fullScreenIntent`, ingen
USE_FULL_SCREEN_INTENT, ingen TURN_SCREEN_ON, ingen wake lock og ingen presise
alarmer. Id-en er versjonert fordi Android låser en
kanals viktighet i det den opprettes; alarmer fra en installasjon som er eldre
enn kanalen planlegges derfor på nytt én gang. Autoritativt:
`docs/varsler.md`, «Varselkanalen».

**En vanlig oppstart rører ikke alarmene som alt ligger på telefonen.** Appen
starter fra en bufret økt, så hver oppstart ser ut som en innlogging — men
alarmene i Androids alarmkø er da brukerens egne, og en «avlys, så planlegg»
ville gitt et vindu der telefonen sto uten dem. Enheten bærer derfor et merke
over HVEM alarmene sist ble speilet for: er det den samme brukeren, står de
urørt; er det en annen (eller ingen: en utlogging), rigges de ned før den nye
planen gjelder. Autoritativt: `docs/varsler.md`, «Oppstart og brukerbytte».

### Varselets to ikoner

Statuslinje-ikonet er `ic_stat_huskis` (`res/drawable/`), og uten et
konfigurert ikon bruker pluginen Androids egen `ic_dialog_info`. Et
statuslinje-ikon er en MASKE: Android kaster fargene og tegner formen i sin
egen, så bare alfakanalen betyr noe. Ikonet er derfor merket tegnet som
KONTURER — det fremste kortet med sine tre punkter og linjer, og to
kortHJØRNER bak det. Målene er favicon-ens motiv tilpasset 24 dp og ikke
favicon-ens egne mål: der dekker de fylte kortene hverandre, her må hvert
synlige ledd tegnes for seg og ha luft rundt seg, ellers går strekene i ett.

Det STORE ikonet er `ic_huskis_notification` (`res/drawable-nodpi/`), merket i
full farge. Det er en PNG og ikke en vector drawable fordi pluginen dekoder
ressursen med `BitmapFactory.decodeResource`, som ikke kan lese en vector.
Uten det viser varselet bare den maskede glyfen, og merket er borte.

Begge er rasterisert fra `favicon.svg` av `tests/lag-varselikoner.js`, som
også skriver `ic_stat_huskis.xml` — geometrien står ETT sted, og
`tests/notif-channels.test.js` (10i–10m) sjekker at drawable-en og web push-
badgen bærer nøyaktig de samme banene. Autoritativt: `docs/varsler.md`.

## Den maskinelle runden: `tests/android-device.js`

Den fysiske runden er delt i to, og skillet er ikke en smaksdom: **ADB kan lese
Androids alarmkø, drepe en prosess, restarte enheten, bytte tidssone og levere
den samme intenten et varseltrykk leverer. Det ADB ikke kan, er å SE.**

Alt i den første halvdelen er automatisert i `tests/android-device.js`, og
`.github/workflows/android-device.yml` kjører den på en ekte emulator på hver PR
som rører Android-siden — så runden ikke bare er en fil noen kunne kjørt.
Harnesset snakker DevTools-protokoll med appens egen WebView over `adb forward`:
det planlegger ingenting selv, det ber ADAPTEREN om runden og leser svaret ut av
`dumpsys`. Mekanikken står i [`varsler.md`](varsler.md), «Hva en ENHET har
svart».

Mot din egen telefon:

```bash
npm run android:debug        # dist/ → android/ → debug-APK
node tests/android-device.js --install android/app/build/outputs/apk/debug/app-debug.apk
```

Er telefonen innlogget med systemvarsler PÅ, kjører runden i **LIVE**-modus og
måler din EGEN plan mot Androids kø. Ellers planlegges tre syntetiske alarmer
gjennom den samme adapteren (**RIGG**) — det er modusen emulatoren i CI kjører,
og den ene tingen den da ikke kan prøve (et reelt brukerbytte) rapporteres som
hoppet over, med grunnen. Runden endrer alarmkøen og rydder etter seg: diffen i
adapteren er selvhelende, og harnesset MÅLER at planen er tilbake til slutt.

`node tests/android-device.js --plan` skriver ut hele rekkefølgen uten å kjøre
noe. `--no-reboot` hopper over omstarten av enheten og prøver pluginens
oppstartsmottaker direkte i stedet.

Runden skrur på tre ting som ikke er appens egne — alarmkøen, flymodus og
tidssonen — og setter alle tilbake, også når den blir avbrutt med Ctrl-C eller
bryter sammen. Blir den avbrutt med RIGGENS alarmer armert, avlyses nøyaktig de
id-ene riggen la inn: «Huskis-rigg forfaller» skal ikke ringe på noens telefon,
og brukerens egen plan står ikke i listen og røres ikke. Å vente på neste
speilingsrunde duger ikke — alarmen som skal få forfalle ligger sekunder fram.
`force-stop` er siste utvei når pluginbroen ikke er å nå, og brukes bare på en
enhet uten innlogget bruker.

### Allerede observert på fysisk Android

- [x] tillatelsesdialogen kommer ved bryteren, og bare der — Android spør ikke
      ved oppstart, dialogen kommer først når systemvarsler slås PÅ i Huskis, og
      tillatelsen beholdes etterpå. Harnesset bekrefter at tillatelsen er gitt før
      det måler noe, og stopper med en beskjed hvis den mangler (A3);
- [x] **med appen i forgrunnen: in-app-toasten leveres; et redundant
      systemvarsel er IKKE påkrevd.** Dette er produktregelen, ikke en mangel:
      terskelen som nettopp passerte er ute av den framtidige native planen, og
      diffen avlyser den armerte alarmen i den samme runden som toasten vises
      ([`varsler.md`](varsler.md), «Én synlig varsling»). Maskinelt låst av
      `tests/notif-channels.test.js` 12.

### Det runden MÅLER, og hvor beviset ligger

Bokstav og tall i parentes er sjekkens navn i harnessets egen rapport, slik at et
FAIL kan leses rett mot listen. **Emulatoren i CI kjører RIGG-modus på hver PR
som rører Android-siden. LIVE-runden på eierens egen telefon måler det samme mot
hans EGEN plan, og legger til brukerbyttet** — status for begge står i
statustabellen øverst.

- de planlagte alarmene ligger faktisk i ANDROIDS alarmkø — én armert alarm per
  terskel, på tidspunktet planen sier (D2–D3) — og de er vekkende og UPRESISE
  (D4). Pluginens lagring holder de samme ID-ene Huskis regnet ut (D1);
- den INSTALLERTE APK-en ber ikke om SCHEDULE_EXACT_ALARM: tilbaketrekkingen i
  manifestet holdt gjennom manifest-fletteren og inn i binæren (D5);
- kanalen «Påminnelser» finnes på enheten, med høy viktighet og vibrasjon, lest
  ut av Androids egen NotificationManager (B1–B2);
- en vanlig OMSTART av appen etterlater alarmene STÅENDE. Køen er identisk før og
  etter (E1), OG Capacitors egen broLOGG viser at appen verken avlyste eller
  planla noe (E2) — køen alene kan ikke skille «urørt» fra «avlyst og lagt inn
  igjen», derfor loggen;
- med PROSESSEN FJERNET står alarmene (F1–F2), og varselet leveres likevel (H1).
  Og merk forskjellen runden er nøye med: `am kill` er en sveip i Recents,
  `force-stop` er noe annet — den AVLYSER appens alarmer og setter appen i
  «stopped state». En runde som brukte `force-stop` ville prøvd Androids regel for
  en app brukeren har stoppet, ikke Huskis' kode;
- etter en TELEFONRESTART stiller pluginens `BOOT_COMPLETED`-mottaker alarmene
  opp igjen, på de samme tidspunktene (G2). At enheten faktisk var NEDE bevises av
  at oppetiden falt (G1), ikke av at adb svarte;
- en alarm som forfaller blir POSTET som systemvarsel med appen borte — på
  Huskis-kanalen (H2) og rangert HIGH av Android (H3), som er forutsetningen for
  heads-up;
- OFFLINE både når fristen settes og når den forfaller: alarmen planlegges og
  fyrer med radioen AV (H4). Kanalen er lokal, og ingen server er involvert i noe
  ledd;
- TRYKK på varselet åpner riktig Huskis-objekt, også fra KALDSTART: runden sender
  pluginens egen tapp-intent mot en prosess som er drept, og leser at pekeren kom
  fram i appen (I1–I3). Varselet forsvinner fra panelet etterpå (I4);
- et TIDSSONEBYTTE MENS APPEN ER HELT LUKKET — punktet som før krevde seks
  manuelle steg. Runden bytter sone med AlarmManagers egen skallkommando, som
  kringkaster `TIMEZONE_CHANGED` slik et ekte bytte gjør, og måler at alarmene
  flyttet seg til SAMME VEGGTID (L1), at de gamle tidspunktene er BORTE og ikke
  liggende ved siden av (L2), at ingen JS rørte dem — det var den native
  mottakeren (L3) — og at sonen tilbake gir de opprinnelige tidspunktene igjen
  (L4). Selve omregningen er dekket av
  `android/app/src/test/…/HuskisWallClockTest.java`, koblingen mellom lagene av
  `tests/notif-timezone-native.test.js`;
- en ENDRET FRIST avlyser den gamle planen og legger en ny, og fullføring avlyser
  den framtidige: det ER diffen, og runden kjører den to ganger på enheten — en
  alarm legges til (H) og tas bort igjen (K), og køen måles etter hver;
- et BRUKERBYTTE rydder forrige brukers alarmer. I LIVE settes enhetens eiermerke
  til en annen uid — nøyaktig det en innlogging fra en annen konto etterlater — og
  runden måler at oppstarten rigger ned (J1) og at enheten står igjen som den
  innloggede brukerens (J2). I RIGG måles den andre halvdelen: at nedriggingen
  faktisk TØMMER Androids kø, og ikke bare pluginens lagring. Hvem den nye planen
  tilhører er ren klientlogikk, dekket av `tests/notif-channels.test.js` 14.

### Det bare et ØYE kan svare på

Android eier presentasjonen, og ingen dump kan bekrefte den. Harnesset skriver
disse tre ut til slutt, og de er de eneste som står igjen:

- [ ] **HEADS-UP.** La et varsel forfalle med skjermen på: legger banneret seg
      over skjermen, med lyd eller vibrasjon?
- [ ] **LÅSESKJERM.** Lås telefonen og la det neste forfalle: står det slik du
      vil ha det? (Android bestemmer om navnet vises — innstillingen er
      telefonens, ikke Huskis'.)
- [ ] **FINGEREN.** Trykk på varselet i panelet: åpner Huskis riktig objekt?

Høy viktighet er en FORESPØRSEL. Brukeren, «Ikke forstyrr» og produsentens egne
regler har siste ord, så et heads-up som ikke kommer er ikke nødvendigvis en
feil — men at kanalen ber om det, og at Android rangerer varselet HIGH, er målt
(B2, H3).

### Det som fortsatt ikke er prøvd, og hvorfor

- [ ] en OPPGRADERING fra en Huskis-versjon uten kanalen: alarmer som alt var
      planlagt kommer fortsatt, nå som heads-up, og bare ÉN gang. Dette krever en
      eldre APK å oppgradere FRA, og den kan ikke rigges fra repoet. Migreringen
      er maskinelt dekket av `tests/notif-channels.test.js` 13, begge veier; og
      tilstanden ETTER en migrering — alarmene på kanalen, rangert HIGH — er målt
      på enhet;
- [ ] en DST-overgang: at et varsel planlagt før overgangen kommer på riktig
      klokkeslett etter den. Dette skal virke UTEN noe ekstra ledd — veggtiden ble
      regnet om til riktig instans allerede da planen ble lagt
      ([`varsler.md`](varsler.md)) — og overgangen er dekket av
      `HuskisWallClockTest`. Å prøve den på enhet krever at kalenderen faktisk
      passerer 29. mars eller 25. oktober;
- [ ] en OTA-oppdatering ødelegger ikke adapteren. Prøves naturlig sammen med
      neste OTA-runde.

---

## Senere muligheter — ikke del av minimumsløypa

Disse vurderes først etter stabil offentlig mobilrelease og bare dersom de gir
konkret brukerverdi:

- haptisk feedback;
- biometrisk opplåsing;
- widgets/shortcuts;
- native share sheet;
- PWA/installasjon fra browser;
- mer avansert offline-funksjonalitet.

De skal ikke snike seg inn i fundamentfasene.

## Neste oppgave

**Fase 6 er halvferdig, og den halvdelen som gjenstår er ikke kode.** Repo-siden
er innført: package ID-en er bekreftet endelig, release-signeringen tar imot
materiale utenfra og avviser et bygg uten det, «Android release-AAB» produserer
`app-release.aab` reproducerbart, og `versionCode` har fått butikkens regel uten
å bli et tall nummer to.

**Neste praktiske steg er ditt, i denne rekkefølgen:**

1. opprett Google Play Developer-kontoen;
2. lag upload-nøkkelen (`keytool`, se fase 6) og legg inn de fire
   `ANDROID_UPLOAD_*`-secretene;
3. kjør «Android release-AAB» manuelt, sett `ANDROID_UPLOAD_CERT_SHA256` til
   fingeravtrykket jobben skriver ut, og last AAB-en opp til internt testspor.

Steg 3 lukker samtidig det siste maskinelle hullet i fasen: at et signert bygg
faktisk kommer ut i den andre enden. Uten en nøkkel kan bare AVVISNINGEN prøves,
og den er prøvd.

Regn med at den første Play-installasjonen krever at debug-APK-en avinstalleres
— en app kan ikke bytte signatur på en telefon. Det skjer én gang; etterpå
oppgraderer hver ny opplasting den forrige.

### Fase 3

Ferdig: tilbakeknapp, safe areas/systemfelt/tastatur, lenkebeslutninger,
lifecycle/network og sikkerhetskopi er avgjort og verifisert der fysisk måling
var meningsfull. Ingen unødvendig lifecycle/network-plugin ble innført.

### Fase 4

Ferdig: `releaseId` er plattformuavhengig identitet; web og Android kan melde
samme release med ulike `buildId`. Ingen `minimumSupportedRelease`; separate
builds med samme `releaseId`.

### Fase 5

Ferdig: selvhostet signert OTA med `@capawesome/capacitor-live-update`,
`versionCode`-bundet kompatibilitet, native nedlasting, staging, trygg reload,
readiness, innebygd fallback og dobbel varig karantene. Produksjonsmålingen og
to forskjellige defekte riggbundler er observert på fysisk Android. iOS arver
arkitekturen først i fase 7.

### Varsler

Den maskinelle delen av den fysiske runden er AUTOMATISERT og kjøres på en
emulator i CI (`tests/android-device.js`). Det som står igjen er tre spørsmål
harnesset stiller til slutt, og som bare et øye kan svare på: heads-up,
låseskjermen og fingeren på varselet. Kjør runden mot din egen telefon én gang,
svar på de tre, og kryss dem av i «Det bare et ØYE kan svare på».

**Ingen «vekk skjermen»-mekanisme er innført, og det er med vilje**: ingen
`fullScreenIntent`, ingen USE_FULL_SCREEN_INTENT, ingen TURN_SCREEN_ON, ingen
wake lock og ingen presise alarmer. Det er neste produktleveranse, og den skal
bygge på en grunnmur som er verifisert — ikke erstatte verifiseringen.
