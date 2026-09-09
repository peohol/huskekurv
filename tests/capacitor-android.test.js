#!/usr/bin/env node
/* ============================================================
   Vakt for mobilfundamentet: Capacitor-skallet skal pakke NØYAKTIG den samme
   `dist/` som Vercel deployer, og ingenting av toolingen rundt skal lekke
   verken inn i webbuilden eller ut av repoet.

   Bakgrunn og faseinndeling: `docs/mobilapp-plan.md`. Reglene som testes her er
   de arkitekturreglene fasene hviler på — de er billige å bryte ved et uhell og
   dyre å oppdage sent (en app som viser huskis.no i en WebView ser helt riktig
   ut helt til telefonen er offline eller Vercel er nede).

   Dekker:
     1. capacitor.config.json: `webDir = dist`, riktig appId/appName, og INGEN
        `server`-blokk — appen skal kjøre lokale web-assets, ikke laste UI-et fra
        huskis.no.
     2. package.json: privat, uten `version` (SemVer-semantikken i
        `version.json` er uendret), uten bundler/frontendrammeverk, og med
        Capacitor-versjonene pinnet EKSAKT.
     3. package-lock.json er sjekket inn og peker på de samme versjonene.
     4. build.js holder npm-/Capacitor-/native tooling utenfor `dist/`
        (utfallet testes i tests/build-version.test.js — her testes at regelen
        står i SKIP-listen, altså at invarianten uttrykkes ett sted).
     5. .gitignore: node_modules og genererte native buildoutputs er ignorert,
        mens de native prosjektfilene som MÅ være kildekode ikke er det.
     6. Android-prosjektet har den identiteten planen har bestemt, og
        INTERNET-tillatelsen synken trenger.
     7. Fase 1 er avgrenset: ingen iOS, ingen ekstra native plugins.
     8. .github/workflows/android-debug.yml bygger debug-APK-en via den samme
        kjeden (node build.js → cap sync → assembleDebug), uten å signere en
        release eller røre release-kjeden. Og den leser ut det SAMMENSLÅTTE
        Android-manifestet etterpå: hva et native bibliotek erklærer kan ikke
        leses fra repoet (del 7), bare fra Gradles egen sammenslåing.
     9. Native runtime: webkoden kjenner Capacitor på TO gated linjer (broen for
        systemets tilbakeknapp og oppslaget av de native pluginene) og ingen
        andre steder, og ingenting i den peker appen ut av sine egne innebygde
        filer. Og (9b) OTA-pluginen fase 5 innfører: rollback er PÅ
        (`readyTimeout` > 0), pluginen henter ingenting av seg selv
        (`autoUpdateStrategy` er ikke slått på), og `ready()` — det ene kallet
        som avvæpner rollback-timeren — står bak den samme gaten. Og (9c) de to
        native halvdelene signeringsrunden legger inn: `versionCode`, som ER
        OTA-ens kompatibilitetsgrense, og `publicKey`, som er den eneste
        halvdelen av nøkkelparet som noensinne skal ligge i repoet. Og (9d)
        hele OTA-flyten: manifest-URL-en bygges av det kanoniske originet +
        skallets `getVersionCode()`, manifestet valideres ved systemgrensen, og
        `setNextBundle`/`reload` — de to som faktisk BYTTER kode — står bak
        karantenen og bak motorens klargjøring, ikke løst i koden. Og (9e)
        klargjøringstilstanden i update-check.js: ett-forsøk-vakten kan ikke
        brennes av en feilet klargjøring, og banneret vises ikke før målet er
        stilt opp.
    10. Safe areas og skjermtastaturet: erklæringene sonen hviler på —
        `viewport-fit=cover` i index.html, `adjustResize` i manifestet, og
        systemfeltenes utseende i temaet (lyst tema, gjennomsiktige felt,
        mørke glyfer) som gjør klokka lesbar over Huskis' lyse flate.
    11. Systemets tilbakeknapp: skallet spør web-laget først og lar OS ta
        trykket når web-laget ikke tok det.
    12. Eksterne lenker: bare appens eget origin lastes INNE i appen, alt annet
        hører hjemme i systembrowseren (docs/domains-and-urls.md, «Eksterne
        lenker»).
    13. Auth-/e-postlenker: App Links har to halvdeler i hvert sitt system
        (intent-filteret og assetlinks.json på det kanoniske originet), og en
        halv innføring feiler STILLE. De innføres sammen, eller ingen av dem.

   `/version.json` i den innebygde builden er en KJEDE av invarianter som
   allerede er dekket hver for seg, og som derfor ikke gjentas her:
   `build.js` skriver samme build-ID i `index.html` og `version.json`
   (tests/build-version.test.js), Capacitor pakker nøyaktig den mappa
   (`webDir` under), og `update-check.js` som møter sin egen ID gjør ingenting
   — ingen mål-build, intet banner, ingen reload (tests/auto-update.test.js).
   Appen leser altså alltid seg selv, og oppdaterer aldri web-assetene sine.
   Selve OTA-en er fase 5.

   Release-ID-en (fase 4) er det ene som IKKE er dekket av den kjeden: den skal
   være LIK på tvers av to builds, og bare den synkede kopien viser at Androids
   halvdel faktisk bærer den. Den sjekkes derfor der kopien måles, sammen med
   byte-for-byte-sammenligningen.

   Ren node-test — ingen server, ingen nettleser, ingen Android SDK.

   Kjør:
     node tests/capacitor-android.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(navn, ok, evidens) {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
}
const les = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(les(...p));
const finnes = (...p) => fs.existsSync(path.join(ROOT, ...p));
/* `git check-ignore` er fasiten på hva som faktisk blir ignorert — den tar med
   alle .gitignore-filene i kjeden, inkludert den Capacitor legger i `android/`.

   MERK skråstreken på katalogene under. Et mønster som slutter på `/` (`dist/`,
   `node_modules/`, `build/`) treffer bare kataloger, og `--no-index` leser en
   sti UTEN skråstrek som en fil når den ikke finnes på disk. I et rent checkout
   finnes ingen av de genererte katalogene, så uten skråstreken ville sjekken
   svart «ikke ignorert» — og bestått lokalt, der katalogene tilfeldigvis
   finnes. Katalog skrives derfor som katalog. */
function ignorert(rel) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT }).status === 0;
}
/* Linjene med KJØRENDE kode, kommentarene fjernet. Sjekkene under handler om
   hva koden gjør; hva kommentarene omtaler er de likegyldige til (og
   Capacitor-broen omtales i flere av dem). Blokkkommentarene i denne kodebasen
   fortsetter på linjer uten `*`, så blokken må spores — den kan ikke
   gjenkjennes linje for linje. Forenkling: en `//` inne i en streng (`https://`)
   kapper resten av linja. Det gjør ingen av sjekkene her falskt grønne, de
   leter etter navn som ikke står i noen URL. Brukes både på JS og Java. */
function kodeLinjer(src) {
  let iBlokk = false;
  return src.split('\n').map((raw, i) => {
    let kode = raw;
    if (iBlokk) {
      const slutt = kode.indexOf('*/');
      if (slutt === -1) return { nr: i + 1, l: '' };
      kode = kode.slice(slutt + 2);
      iBlokk = false;
    }
    for (;;) {
      const start = kode.indexOf('/*');
      if (start === -1) break;
      const slutt = kode.indexOf('*/', start + 2);
      if (slutt === -1) { kode = kode.slice(0, start); iBlokk = true; break; }
      kode = kode.slice(0, start) + kode.slice(slutt + 2);
    }
    return { nr: i + 1, l: kode.replace(/\/\/.*$/, '') };
  });
}
const kode = (src) => kodeLinjer(src).map((x) => x.l).join('\n');

/* ---- 1. Capacitor peker på dist/, og ikke på huskis.no ---- */
const cfg = json('capacitor.config.json');
check('capacitor.config.json bruker dist/ som web-assets', cfg.webDir === 'dist', cfg.webDir);
check('appId er no.huskis.app', cfg.appId === 'no.huskis.app', cfg.appId);
check('appName er Huskis', cfg.appName === 'Huskis', cfg.appName);
/* En `server.url` ville gjort appen til en WebView som henter UI-et over nett:
   ingen offline oppstart, og butikkbinæren ville sluttet å bety noe.
   `docs/mobilapp-plan.md` — «Ingen ekstern server.url i produksjon». */
check('ingen produksjons-server.url i Capacitor-konfigurasjonen',
  !cfg.server || (!cfg.server.url && !cfg.server.hostname),
  JSON.stringify(cfg.server || null));
/* Konfigurasjonen kopieres inn i APK-en ved hver sync. Den kopien er
   gitignorert generert utdata, men når den finnes lokalt skal den bevise at det
   faktisk er dette som ender opp i appen. */
const APK_CFG = 'android/app/src/main/assets/capacitor.config.json';
if (finnes(APK_CFG)) {
  const innebygd = json(APK_CFG);
  check('den innebygde konfigurasjonen i APK-en har heller ingen server.url',
    !innebygd.server || (!innebygd.server.url && !innebygd.server.hostname),
    JSON.stringify(innebygd.server || null));
  check('den innebygde konfigurasjonen har samme appId', innebygd.appId === cfg.appId);
} else {
  console.log('(hopper over den innebygde konfigurasjonen — kjør `npm run sync:android` først)');
}

/* ---- 2. package.json ---- */
const pkg = json('package.json');
check('package.json er privat (publiseres aldri til npm)', pkg.private === true);
/* build.js leser `version` herfra. Uten feltet forblir version.json.version
   null: SemVer skal ikke måtte økes per PR, og release-identiteten utledes av
   commiten (`releaseId`, docs/auto-update.md) — ikke av denne fila.
   Testes også fra utfallssiden i build-version.test.js. */
check('package.json har ikke et version-felt', !('version' in pkg));

const CAP = ['@capacitor/core', '@capacitor/cli', '@capacitor/android'];
const alleDeps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
for (const p of CAP) {
  check(p + ' er en avhengighet', typeof alleDeps[p] === 'string', alleDeps[p] || 'mangler');
  check(p + ' er pinnet eksakt (ingen ^, ~ eller latest)',
    /^\d+\.\d+\.\d+$/.test(alleDeps[p] || ''), alleDeps[p] || '');
}
check('core, cli og android står i samme versjon',
  new Set(CAP.map((p) => alleDeps[p])).size === 1, CAP.map((p) => alleDeps[p]).join(', '));
check('Capacitor-majoren er 8', /^8\./.test(alleDeps['@capacitor/core'] || ''),
  alleDeps['@capacitor/core']);

/* Fase 5s OTA-plugin. Den er en RUNTIME-avhengighet for det native skallet og
   skal stå i `dependencies`, ikke i `devDependencies`: koden pakkes inn i
   APK-en, i motsetning til `@capacitor/cli` som bare kjører på byggemaskinen.
   Pinnet eksakt av samme grunn som Capacitor-pakkene — en patch-drift ville
   byttet NATIV kode i appen uten at noe i repoet endret seg. */
const OTA = '@capawesome/capacitor-live-update';
check(OTA + ' er en runtime-avhengighet (dependencies, ikke devDependencies)',
  typeof (pkg.dependencies || {})[OTA] === 'string',
  (pkg.dependencies || {})[OTA] || 'mangler i dependencies');
check(OTA + ' er pinnet eksakt (ingen ^, ~ eller latest)',
  /^\d+\.\d+\.\d+$/.test(alleDeps[OTA] || ''), alleDeps[OTA] || '');
check(OTA + ' står på majoren som er verifisert mot Capacitor 8',
  /^8\./.test(alleDeps[OTA] || ''), alleDeps[OTA] || 'mangler');

/* PR 3Bs varselplugin. Samme krav som OTA-pluginen: runtime-avhengighet, pinnet
   eksakt, og på majoren som er verifisert mot Capacitor 8. Den er kanalen som
   leverer varslene på Android — LOKALE alarmer planlagt på selve enheten, ingen
   pushserver (docs/varsler.md). */
const LOKALVARSLER = '@capacitor/local-notifications';
check(LOKALVARSLER + ' er en runtime-avhengighet (dependencies, ikke devDependencies)',
  typeof (pkg.dependencies || {})[LOKALVARSLER] === 'string',
  (pkg.dependencies || {})[LOKALVARSLER] || 'mangler i dependencies');
check(LOKALVARSLER + ' er pinnet eksakt (ingen ^, ~ eller latest)',
  /^\d+\.\d+\.\d+$/.test(alleDeps[LOKALVARSLER] || ''), alleDeps[LOKALVARSLER] || '');
check(LOKALVARSLER + ' står på majoren som er verifisert mot Capacitor 8',
  /^8\./.test(alleDeps[LOKALVARSLER] || ''), alleDeps[LOKALVARSLER] || 'mangler');

/* Huskis er fortsatt vanilla HTML/CSS/JS. Mobilprosjektet skal ikke være
   bakveien inn for en bundler eller et frontendrammeverk
   (docs/mobilapp-plan.md, arkitekturregel 1). */
const FORBUDT = /^(vite|webpack|rollup|esbuild|parcel|typescript|react|react-dom|vue|svelte|@angular\/|@ionic\/|@babel\/|next)/;
const smugling = Object.keys(alleDeps).filter((d) => FORBUDT.test(d));
check('ingen bundler, transpiler eller frontendrammeverk blant avhengighetene',
  smugling.length === 0, smugling.join(', ') || 'ingen');

check('npm-skriptet for webbuilden kjører build.js',
  (pkg.scripts || {}).build === 'node build.js', (pkg.scripts || {}).build);
check('npm-skriptet for sync bygger først og synker så til android',
  /build/.test((pkg.scripts || {})['sync:android'] || '')
    && /cap sync android/.test((pkg.scripts || {})['sync:android'] || ''),
  (pkg.scripts || {})['sync:android']);
check('npm-skriptet for Android-builden kjører gradlew assembleDebug',
  /assembleDebug/.test((pkg.scripts || {})['android:debug'] || ''),
  (pkg.scripts || {})['android:debug']);

/* ---- 3. Lockfila ---- */
check('package-lock.json er sjekket inn', finnes('package-lock.json') && !ignorert('package-lock.json'));
const lock = json('package-lock.json');
for (const p of CAP.concat([OTA])) {
  const node = (lock.packages || {})['node_modules/' + p];
  check('lockfila låser ' + p + ' til den samme versjonen',
    !!node && node.version === alleDeps[p], (node && node.version) || 'mangler');
}

/* ---- 4. Invarianten står i build.js, ikke bare i utfallet ---- */
const build = les('build.js');
const skipBlokk = (build.match(/const SKIP = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
for (const n of ['package.json', 'package-lock.json', 'capacitor.config.json', 'android', 'ios', 'node_modules']) {
  check('build.js SKIP-listen holder ' + n + ' utenfor dist/',
    skipBlokk.indexOf("'" + n + "'") > -1);
}

/* ---- 5. .gitignore: kildekode inn, generert utdata ut ---- */
for (const g of ['node_modules/', 'dist/']) {
  check(g + ' er gitignorert', ignorert(g));
}
/* Uten disse kan ikke et rent checkout bygge APK-en — de ER den native
   kildekoden (docs/mobilapp-plan.md, arkitekturregel 4). */
const NATIV_KILDE = [
  'android/build.gradle',
  'android/settings.gradle',
  'android/variables.gradle',
  'android/gradle.properties',
  'android/gradlew',
  'android/gradle/wrapper/gradle-wrapper.jar',
  'android/gradle/wrapper/gradle-wrapper.properties',
  'android/app/build.gradle',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/no/huskis/app/MainActivity.java',
  // Tidssonebytte mens appen er lukket (docs/varsler.md). Uten disse to ringer
  // en alarm som var ment kl. 09:00 på det gamle klokkeslettet etter en reise.
  'android/app/src/main/java/no/huskis/app/TimeZoneAlarmReceiver.java',
  'android/app/src/main/java/no/huskis/app/HuskisWallClock.java',
  'android/app/src/test/java/no/huskis/app/HuskisWallClockTest.java',
  'android/app/src/main/res/values/strings.xml',
  'android/app/src/main/res/xml/data_extraction_rules.xml',
];
for (const f of NATIV_KILDE) {
  check('native kildefil finnes og er IKKE ignorert: ' + f, finnes(f) && !ignorert(f));
}
/* Generert eller maskinspesifikt. Alt her gjenskapes av `npm run sync:android`
   + Gradle, og skal aldri havne i git. */
const NATIV_GENERERT = [
  'android/app/build/',
  'android/local.properties',
  'android/app/src/main/assets/public/',
  'android/app/src/main/assets/capacitor.config.json',
  'android/capacitor-cordova-android-plugins/',
];
for (const f of NATIV_GENERERT) {
  check('generert/maskinspesifikk sti er ignorert: ' + f, ignorert(f));
}

/* ---- 6. Android-prosjektets identitet ---- */
const strings = les('android/app/src/main/res/values/strings.xml');
check('android: app_name er Huskis', /<string name="app_name">Huskis<\/string>/.test(strings));
check('android: package_name er no.huskis.app',
  /<string name="package_name">no\.huskis\.app<\/string>/.test(strings));
const appGradle = les('android/app/build.gradle');
check('android: applicationId er no.huskis.app', /applicationId "no\.huskis\.app"/.test(appGradle));
check('android: namespace er no.huskis.app', /namespace = "no\.huskis\.app"/.test(appGradle));
/* XML-kommentarene fjernes FØR noe leses. En utkommentert erklæring er ikke i
   kraft — Android ser den aldri — så en sjekk som leser den står grønn på noe
   som ikke finnes i appen. Det gjelder like mye `adjustResize` under som
   App Links-filteret i del 13.

   Det ene ikke-grådige mønsteret er nok her, og det er hele XML-regelen: en
   kommentar starter på `<!--`, slutter på det FØRSTE `-->`, og kan verken
   nestes eller inneholde `--`. `kodeLinjerStreng()` lenger nede er bygget for
   JS/HTML med strenger, regex og skriptområder — overkill for et manifest, og
   den er dessuten definert først et godt stykke etter dette punktet. */
const utenXmlKommentarer = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
/* Prefikset `android:` er en KONVENSJON, ikke navnet. XML binder navnerom med
   `xmlns:`, og `xmlns:a="http://schemas.android.com/apk/res/android"` +
   `<data a:scheme="https">` er nøyaktig det samme manifestet for Android — men
   usynlig for et mønster som leter etter `android:`. Da ville et aktivt filter
   sett ut som fravær, og koblingen i del 13 stått grønn på en halv innføring.

   I stedet for å tre en prefiksvariabel gjennom hvert eneste mønster,
   NORMALISERES teksten én gang: det prefikset som faktisk er bundet til
   Android-navnerommet skrives om til `android:`. Attributtnavn står alltid
   etter blanktegn inne i en tagg, så den ene erstatningen er nok — elementene i
   et manifest er uprefiksede. */
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
function xmlNormalisert(tekst) {
  let ut = tekst;
  for (const m of tekst.matchAll(/xmlns:([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const prefiks = m[1];
    if ((m[2] !== undefined ? m[2] : m[3]) !== ANDROID_NS || prefiks === 'android') continue;
    ut = ut.replace(new RegExp('(\\s)' + prefiks.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':', 'g'), '$1android:');
  }
  return ut;
}
const manifestTekst = (rel) => xmlNormalisert(utenXmlKommentarer(les(rel)));
const manifest = manifestTekst('android/app/src/main/AndroidManifest.xml');
/* Uten INTERNET når appen verken Supabase eller /version.json. */
check('android: manifestet ber om INTERNET',
  /android\.permission\.INTERNET/.test(manifest));

/* ACCESS_NETWORK_STATE er det Chromiums nettverksvarsling i WebView-en henger
   på. Uten den er tilstanden ukjent, ukjent leses som «på nett», og da står
   `navigator.onLine` permanent på true mens `online`/`offline` aldri fyrer —
   målt på enhet i flymodus (docs/mobilapp-plan.md, «Lifecycle- og
   network-signaler»). Ingen av de tre leserne eier data, så dette er en
   opprydding i signalene, ikke en datavei. */
check('android: manifestet ber om ACCESS_NETWORK_STATE (navigator.onLine er død uten)',
  /android\.permission\.ACCESS_NETWORK_STATE/.test(manifest));

/* Sikkerhetskopi. WebView-lagringen bærer BÅDE Supabase-sesjonen (med
   refresh-tokenet) og hele den lokale bufferen i klartekst, og med Androids
   standard `allowBackup="true"` følger de med ut av enheten — en gjenoppretting
   på en annen telefon er da innlogget uten at noen har logget inn. Nettleseren
   har ingen slik vei ut, og appen skal ikke ha en.
   docs/mobilapp-plan.md, «Sikker lagring og sikkerhetskopi».

   Erklæringen er ikke ÉN, men to, og de dekker hver sin halvdel: attributtet
   stenger skykopien, regelfila stenger enhet-til-enhet-overføringen på
   Android 12+ (targetSdk 36), som attributtet ikke rører hos alle produsenter.
   Halve innføringen ser riktig ut og lekker fortsatt, så begge leses her —
   sammen med koblingen mellom dem. */
check('android: sikkerhetskopi av appdata er slått AV',
  /android:allowBackup\s*=\s*"false"/.test(manifest));
const regelRef = (manifest.match(/android:dataExtractionRules\s*=\s*"@xml\/([\w.]+)"/) || [, ''])[1];
check('android: manifestet peker på regler for datauttrekk', !!regelRef, regelRef);
const REGELFIL = 'android/app/src/main/res/xml/' + (regelRef || 'data_extraction_rules') + '.xml';
check('android: regelfila finnes der manifestet peker', finnes(REGELFIL), REGELFIL);
const regler = finnes(REGELFIL) ? utenXmlKommentarer(les(REGELFIL)) : '';
/* En manglende — eller tom — seksjon er ikke «ingenting»: Android leser fravær
   av regler som «fullt aktivert for alt utenom cache». Begge modusene må derfor
   stenges med et eksplisitt exclude av HELE den private datakatalogen
   (`domain="root"`, `path="."`), som er der `app_webview/` ligger. */
function ekskluderer(kropp, domene, sti) {
  return (kropp.match(/<exclude\b[^>]*?\/?>/g) || []).some((tagg) => {
    const attr = (n) => (tagg.match(new RegExp(n + '\\s*=\\s*"([^"]*)"')) || [, ''])[1];
    return attr('domain') === domene && attr('path') === sti;
  });
}
for (const modus of ['cloud-backup', 'device-transfer']) {
  const kropp = (regler.match(new RegExp('<' + modus + '\\b[^>]*>([\\s\\S]*?)</' + modus + '>')) || [, ''])[1];
  check('android: ' + modus + ' utelukker hele appens datakatalog',
    ekskluderer(kropp, 'root', '.'), kropp.trim());
}
/* Et `<include>` kan ikke slå excluden over (exclude vinner i Android), men det
   ville betydd at noen har begynt å plukke ut data som SKAL kopieres ut. Da er
   beslutningen en annen enn den som står i planen, og skal tas der først. */
check('android: ingenting er plukket ut for kopiering', !/<include\b/.test(regler));

/* ---- 7. Fase 1 er avgrenset ---- */
check('iOS-plattformen er ikke innført ennå',
  !finnes('ios') && !alleDeps['@capacitor/ios']);
/* Fase 1 skal ikke ha pushvarsler, biometrikk, haptics eller andre native
   plugins. Alt utover kjernen + plattformen er derfor en regresjon her, og skal
   komme som en bevisst endring i en senere fase. */
/* npm-lista over holder Capacitor-plugins i sjakk, men den sier ingenting om
   GRADLE-avhengigheter. Et hvilket som helst bibliotek på appmodulens
   `implementation`-liste bidrar med sitt eget manifest, som Gradle merger inn i
   appens — inkludert intent-filtre. Manifestet inne i en AAR kan ikke leses
   herfra (den lastes ned ved bygg), så det som kan låses er HVILKE biblioteker
   som finnes. Da må et nytt innom denne sjekken, og den som legger det inn må
   ta stilling til hva det bidrar med. `testImplementation`/`androidTest…`
   er utenfor: de pakkes ikke i appen. */
/* HELE `dependencies`-blokken leses, ikke bare linjer som starter med
   `implementation`. Gradle har en konfigurasjon per variant og rolle —
   `releaseImplementation`, `api`, `runtimeOnly` — og alle havner i release-APK-en
   med hvert sitt manifest. Å liste konfigurasjonsnavnene ville vært en ny liste
   å glemme noe fra; å låse LINJENE lukker dem alle på én gang. */
const AVHENGIGHETER = [
  "implementation fileTree(include: ['*.jar'], dir: 'libs')",
  'implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"',
  'implementation "androidx.activity:activity:$androidxActivityVersion"',
  'implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"',
  'implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"',
  "implementation project(':capacitor-android')",
  'testImplementation "junit:junit:$junitVersion"',
  // Kun testklassestien: android.jar-stubben lar hver org.json-metode kaste
  // «not mocked», og HuskisWallClockTest leser ekte JSON. Pakkes ikke i appen
  // og bidrar med intet manifest.
  'testImplementation "org.json:json:$orgJsonVersion"',
  'androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"',
  'androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"',
  "implementation project(':capacitor-cordova-android-plugins')",
];
const depBlokk = (kode(appGradle).match(/dependencies\s*\{([\s\S]*?)\n\}/) || [, ''])[1];
const depLinjer = depBlokk.split('\n').map((l) => l.trim()).filter(Boolean);
const nyeDep = depLinjer.filter((l) => AVHENGIGHETER.indexOf(l) === -1);
check('ingen nye Gradle-avhengigheter i appmodulen (et nytt bibliotek merger sitt eget manifest inn)',
  depLinjer.length === AVHENGIGHETER.length && nyeDep.length === 0,
  nyeDep.join(', ') || depLinjer.length + ' kjente avhengighetslinjer');
/* Og de APPLIERTE skriptene. `apply from:` kan legge til avhengigheter uten å
   røre blokken over — Capacitor bruker nettopp den veien selv
   (`capacitor.build.gradle`), og `cap sync` GENERERER én linje der per
   installert native plugin. Blokken var tom så lenge det ikke fantes noen; fra
   fase 5 bærer den nøyaktig én, og lista under er fasiten. Kommer det en linje
   til, er det en plugin som er kommet inn — og den merger sitt eget manifest
   inn i appens.

   Den ene linjen ble betalt bevisst (docs/mobilapp-plan.md, «Prisen»):
   `@capawesome/capacitor-live-update` drar med seg `zip4j` og `okhttp` som
   transitive Gradle-avhengigheter. Hva AAR-ene faktisk merger inn i det BYGDE
   manifestet kan fortsatt ikke leses herfra — men det er lest, i den ene jobben
   der en sammenslåing finnes: `zip4j` bidrar ingenting, `okhttp` én
   `androidx.startup`-initializer (docs/mobilapp-plan.md, «Hva de native
   bibliotekene merger inn i manifestet»). Steget som leser den ut er låst i
   del 8. */
const APPLIERT_DEP = {
  'android/app/capacitor.build.gradle': [
    "implementation project(':capacitor-local-notifications')",
    "implementation project(':capawesome-capacitor-live-update')",
  ],
};
const applierteAvvik = [];
for (const rel of Object.keys(APPLIERT_DEP)) {
  if (!finnes(rel)) continue;
  const kjente = APPLIERT_DEP[rel];
  const linjer = ((kode(les(rel)).match(/dependencies\s*\{([\s\S]*?)\n\}/) || [, ''])[1] || '')
    .split('\n').map((l) => l.trim()).filter(Boolean);
  if (linjer.length !== kjente.length || linjer.some((l) => kjente.indexOf(l) === -1)) {
    applierteAvvik.push(rel + ': ' + (linjer.join(', ') || 'tom'));
  }
}
check('de applierte Gradle-skriptene legger ikke til andre avhengigheter enn OTA-pluginen',
  applierteAvvik.length === 0,
  applierteAvvik.join(' | ') || APPLIERT_DEP['android/app/capacitor.build.gradle'].join(', '));
/* Og HELE avhengighetslista, ikke bare `@capacitor/*`-navnene. En Cordova-
   plugin heter `cordova-plugin-…`, og `cap sync` genererer den inn i
   `:capacitor-cordova-android-plugins` — et modulnavn som allerede står i
   Gradle-lista, så ingen `implementation`-linje endres. Filteret ville da
   havnet i APK-en uten at noen av de to låsene over så det. Lista må derfor
   være uttømmende. */
const KJENTE_PAKKER = ['@capacitor/android', '@capacitor/cli', '@capacitor/core',
  LOKALVARSLER, OTA];
const ukjentePakker = Object.keys(alleDeps).filter((d) => KJENTE_PAKKER.indexOf(d) === -1);
check('ingen andre npm-avhengigheter enn Capacitor-pakkene, varselpluginen og OTA-pluginen (en Cordova-plugin merger sitt eget manifest)',
  ukjentePakker.length === 0, ukjentePakker.join(', ') || KJENTE_PAKKER.join(', '));
const capPakker = Object.keys(alleDeps).filter((d) => d.startsWith('@capacitor/'));
check('ingen native Capacitor-plugins utover kjerne, cli, android og lokalvarsler',
  capPakker.every((d) => CAP.indexOf(d) > -1 || d === LOKALVARSLER), capPakker.join(', '));

/* ---- 8. Workflowen som produserer debug-APK-en ---- */
const WF = path.join(ROOT, '.github', 'workflows', 'android-debug.yml');
check('.github/workflows/android-debug.yml finnes', fs.existsSync(WF));
const wf = fs.existsSync(WF) ? fs.readFileSync(WF, 'utf8') : '';
const utenKommentarer = (y) => y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const wfKode = utenKommentarer(wf);
check('workflowen kan startes manuelt', /\n {2}workflow_dispatch:/.test(wfKode));
/* En Gradle-runde på hver eneste PR ville gjort alle ordinære Huskis-endringer
   tregere uten å teste noe nytt: de endrer `dist/`, som APK-en bare pakker inn.
   Derfor er pull_request-triggeren avgrenset med `paths`. */
check('pull_request-triggeren er avgrenset med paths',
  /\n {2}pull_request:\s*\n {4}paths:/.test(wfKode));
for (const p of ['android/**', 'capacitor.config.json', 'package.json', 'package-lock.json', 'build.js']) {
  check('workflowen kjører når ' + p + ' endres', wfKode.indexOf("'" + p + "'") > -1);
}
check('workflowen bruker den samme pinnede Node-versjonen som ci.yml',
  /node-version: '22'/.test(wfKode));
check('workflowen installerer avhengighetene reproduserbart (npm ci)',
  /npm ci/.test(wfKode));
check('workflowen kjører den vanlige webbuilden', /node build\.js/.test(wfKode));
check('workflowen synkroniserer dist/ til Android', /cap sync android/.test(wfKode));
check('workflowen bygger debug-APK-en med Gradle', /gradlew[^\n]*assembleDebug/.test(wfKode));
check('workflowen laster opp APK-en som artifact',
  /actions\/upload-artifact/.test(wfKode)
    && /app\/build\/outputs\/apk\/debug\/app-debug\.apk/.test(wfKode));
check('workflowen feiler hvis APK-en mangler (ingen tom artifact)',
  /if-no-files-found: error/.test(wfKode));
/* Signering, release-AAB og butikkopplasting hører til fase 6. Kommer de inn
   her, gjør de det uten nøkkelhåndteringen den fasen krever. */
check('workflowen signerer ikke en release',
  !/assembleRelease|bundleRelease|signingConfig|KEYSTORE/.test(wfKode));
check('workflowen har kun lesetilgang til repoet', /permissions:\s*\n\s*contents: read/.test(wfKode));

/* Det SAMMENSLÅTTE manifestet. Del 7 låser hvilke biblioteker som finnes, men
   ikke hva hvert av dem erklærer — manifestet inne i en AAR kan ikke leses fra
   repoet. Gradle slår dem sammen, og resultatet er en fil som finnes NØYAKTIG
   her, i den ene jobben som kjører en ekte Android-build. Uten dette steget er
   spørsmålet «hva drar `zip4j`/`okhttp` med seg inn i appens manifest?» ikke
   besvarbart uten å pakke opp en APK for hånd.

   Rekkefølgen er hele poenget: før `assembleDebug` har kjørt finnes ingen
   sammenslåing, så et steg som havnet foran ville lest en fil som ikke er der —
   eller, verre, en gammel en fra en tidligere kjøring.

   Og rekkefølgen leses av STEG, ikke av fila som tekst. `wfKode` fjerner
   riktignok heltlinje-kommentarer, men den beskyttelsen er indirekte: den
   holder bare så lenge omtalen av `assembleDebug` står på sin egen
   kommentarlinje. Står den i et STEG-NAVN, eller bak en avsluttende kommentar
   på en YAML-linje, fester et rått `indexOf` seg på omtalen — og da står
   sjekken grønn med manifest-steget plassert FØR byggingen (målt: den gjorde
   nettopp det). Samme grunn som del 9 leser `cap sync`-rekkefølgen av kjørende
   steg. Gradle-steget kjennes derfor igjen på `run:`-linjen sin, ikke på at
   navnet nevnes; manifest-steget på `merged_manifest`, som bare finnes i
   `find`-glob-en (artifactstien staves med bindestrek). Feiler oppdelingen i
   steg, blir begge indeksene 0 og sjekken rød — den feiler lukket. */
const wfSteg = wfKode.split(/\n(?=[ \t]{2,}- (?:name|uses|run):)/);
const iByggSteg = wfSteg.findIndex((s) => /^\s*(?:-\s*)?run:[^\n]*gradlew[^\n]*assembleDebug/m.test(s));
const iMergetSteg = wfSteg.findIndex((s) => s.indexOf('merged_manifest') > -1);
check('workflowen leser det sammenslåtte manifestet ETTER Gradle-runden',
  iByggSteg > -1 && iMergetSteg > iByggSteg,
  'assembleDebug: steg #' + iByggSteg + ', merged_manifest: steg #' + iMergetSteg);
/* Merger-rapporten er provenansen: den attribuerer hver node i det
   sammenslåtte manifestet til fila den kom fra. Uten den er manifestet et
   resultat uten avsender, og et nytt bibliotek kan ikke skilles fra appens egne
   erklæringer. */
check('workflowen tar med merger-rapporten (hvilken fil som la inn hva)',
  /manifest-merger-debug-report\.txt/.test(wfKode));
check('workflowen laster opp det sammenslåtte manifestet som artifact',
  /name: huskis-merged-manifest/.test(wfKode)
    && /path: android\/app\/build\/outputs\/merged-manifest/.test(wfKode));

/* ---- 9. Native runtime: appen kjører seg selv, og webkoden er uavhengig ----

   Capacitor serverer de innebygde filene fra `https://localhost`. To ting kan
   ryke der uten at noen test i dag sier fra:

     a) webkoden begynner å kalle Capacitor-API-er, og browserutgaven blir
        avhengig av en runtime den ikke har (arkitekturregel 2);
     b) noe i klienten sender appen til huskis.no — da slutter den innebygde
        builden å bety noe, og appen blir en WebView med et nettkrav.

   Auth-siden av (b) — at `authRedirectUrl()` ikke tar WebView-originet for en
   utviklingsserver — testes i ekte nettleser (tests/auth-redirect.test.js),
   det samme gjør guardens oppførsel (tests/canonical-origin.test.js). */
/* `sw.js` lastes ikke av index.html — den registreres i kjøretid, og bare når
   brukeren har slått på varsler i nettleseren (docs/varsler.md). Den KOPIERES
   likevel ut av build.js og kjører i produksjon, så den skal skannes som
   enhver annen produksjonskilde. */
const WEB_KILDE = ['index.html', 'app.js', 'config.js', 'i18n.js', 'theme.js', 'icons.js', 'update-check.js', 'styles.css', 'sw.js'];
const NEVNER_CAP = /\bCapacitor\b|@capacitor|capacitor\.js|cordova/i;
/* Alle andre web-kildefiler enn app.js skal fortsatt være helt uvitende om at
   det finnes en native runtime. */
const capBruk = WEB_KILDE.filter((f) => f !== 'app.js' && NEVNER_CAP.test(les(f)));
check('webkoden nevner ikke Capacitor — browserutgaven er ikke avhengig av native runtime',
  capBruk.length === 0, capBruk.join(', ') || 'ingen');

/* Unntaket (fase 3, docs/mobilapp-plan.md): app.js SKAL kjenne native-runtimen
   ett sted — gaten, som setter opp broen for systemets tilbakeknapp OG leser
   pluginbroen fase 5 kaller `ready()` gjennom. Unntaket er avgrenset, ikke
   opphevet: to kodelinjer som står ved siden av hverandre, den første spør
   `isNativePlatform()`, den andre leser `window.Capacitor.Plugins` BAK svaret.
   Da kan ikke et Capacitor-kall snike seg inn i vanlig app-logikk uten at denne
   testen sier fra, og browserutgaven kan ikke bli avhengig av en runtime den
   ikke har (arkitekturregel 2). Kommentarer får omtale broen fritt — de kjører
   ikke. */
const capKode = kodeLinjer(les('app.js')).filter(({ l }) => NEVNER_CAP.test(l));
check('app.js nevner Capacitor i kjørende kode kun på TO linjer',
  capKode.length === 2, capKode.map((x) => 'linje ' + x.nr).join(', ') || 'ingen');
check('den første linjen er gaten: window.Capacitor + isNativePlatform()',
  capKode.length === 2
    && /window\.Capacitor\b/.test(capKode[0].l)
    && /isNativePlatform/.test(capKode[0].l),
  (capKode[0] ? capKode[0].l.trim() : 'mangler'));
/* Pluginbroen er GENERERT av Capacitor i den native runtimen, og finnes ikke i
   en nettleser. Leses den uten `nativeShell` foran seg, blir den `undefined`
   der — og gaten er igjen pynt: en senere `nativePlugins.X.y()` ville kastet i
   browseren i stedet for å la være å kjøre. */
check('den andre linjen leser pluginbroen bak gaten (nativeShell && window.Capacitor.Plugins)',
  capKode.length === 2
    && /nativeShell\s*&&\s*window\.Capacitor\.Plugins/.test(capKode[1].l),
  (capKode[1] ? capKode[1].l.trim() : 'mangler'));
/* Broen skal bare finnes når gaten slipper den gjennom. Står tilordningen
   utenfor en `if`, får browserutgaven den også — og da er gaten pynt.
   Oppførselen i seg selv testes i ekte nettleser (tests/system-back.test.js). */
check('broen tilordnes bak gaten, ikke ubetinget',
  /if \(nativeShell\) window\.__huskisSystemBack = systemBack;/.test(les('app.js'))
    && (les('app.js').match(/window\.__huskisSystemBack\s*=/g) || []).length === 1);

/* At forespørselen faktisk går rot-relativt til eget origin, testes i ekte
   nettleser (tests/auto-update.test.js). Det som ikke fanges der, er en
   absolutt URL skrevet inn her: appen ville da målt seg mot huskis.no og
   reloadet seg selv til en build den ikke har (docs/auto-update.md). */
const absolutt = les('update-check.js').match(/https?:\/\/[^\s'")]*/g) || [];
check('update-check.js navngir ingen vert — den måler seg alltid mot sitt eget origin',
  absolutt.length === 0, absolutt.join(', ') || 'ingen');

/* Guarden i index.html flytter en fane til det kanoniske originet. Står
   WebView-verten på den lista, navigerer appen seg selv ut på nett ved
   oppstart. Hostene som ER der, testes i tests/canonical-origin.test.js. */
const guardHosts = (les('index.html').match(/REDIRECT_HOSTS\s*=\s*\[([^\]]*)\]/) || [, ''])[1];
check('guardens hostliste navngir ingen localhost-vert (appen redirecter ikke seg selv ut)',
  !/localhost|127\.0\.0\.1/.test(guardHosts), guardHosts.trim());

/* ---- 9b. OTA-pluginen: innført, men ikke slått på (fase 5, første runde) ----
   Runden innfører `@capawesome/capacitor-live-update` og ROLLBACK-veien uten å
   hente noen bundle, slik at rollback-mekanikken kan prøves på telefon før det
   finnes et bundlebytte å feile i. Tre invarianter bærer det, og alle tre er
   stille å bryte — appen ser helt riktig ut i alle tre tilfellene.

   Konfigurasjonen står i `capacitor.config.json` og pakkes inn i APK-en; den
   kan ikke endres uten en ny butikkbinær, og det er nettopp derfor den skal
   voktes her og ikke bare leses. */
const lu = (cfg.plugins || {}).LiveUpdate || null;
check('capacitor.config.json har en LiveUpdate-blokk',
  !!lu, lu ? JSON.stringify(lu) : 'mangler');
/* Pluginens standardverdi er 0, og 0 betyr at automatisk rollback er AV.
   En konfigurasjon som «har pluginen» uten denne verdien har altså ingen vakt:
   rollback-timeren armeres aldri, og en bundle som ikke når readiness-punktet
   blir stående. Verdien er leverandørens egen anbefaling (10000 ms), og
   marginen mot en treg kaldstart skal måles på enhet. */
check('readyTimeout er satt til et positivt antall ms (0 = rollback AV)',
  !!lu && typeof lu.readyTimeout === 'number' && lu.readyTimeout > 0,
  lu ? String(lu.readyTimeout) : 'mangler');
/* `background` ville fått pluginen til å hente OG bytte bundle av seg selv, ved
   oppstart og ved resume — utenom `updateSafety()`, banneret, inaktivitets-
   regelen og ett-forsøk-vakten i update-check.js. Hele fase 5 hviler på at
   avgjørelsen blir liggende der den ligger (docs/auto-update.md). */
check('autoUpdateStrategy er ikke slått på (pluginen henter ingenting av seg selv)',
  !!lu && (lu.autoUpdateStrategy === undefined || lu.autoUpdateStrategy === 'none'),
  lu ? String(lu.autoUpdateStrategy) : 'mangler');
/* Karantenen pluginen selv fører, og HOVEDVAKTEN mot at en rullet-tilbake
   bundle stilles opp igjen: standardverdien er `false`, og feltet har først noe
   å føre opp fra og med runden som stiller opp en bundle — før den fantes
   ingen rollback som kunne fylle listen. Feltet pakkes inn i APK-en, og
   `versionCode` under er derfor økt i den samme endringen. Klientens egen
   karantene i app.js er ETT lag til, for det ene tilfellet pluginens ikke
   dekker (docs/mobilapp-plan.md, «En rullet-tilbake bundle må være varig
   sperret»). */
check('autoBlockRolledBackBundles er slått PÅ (standard er false)',
  !!lu && lu.autoBlockRolledBackBundles === true,
  lu ? String(lu.autoBlockRolledBackBundles) : 'mangler');
/* Selvhostet, uten sky-konto: `appId`, `defaultChannel` og `serverDomain` er
   Capawesome Cloud-felter, og et utfylt felt her ville gitt appen en utgående
   adresse ingen har navngitt (docs/sikkerhetsheadere.md). */
const SKY_FELT = ['appId', 'defaultChannel', 'serverDomain'];
const skySatt = lu ? SKY_FELT.filter((f) => lu[f]) : [];
check('ingen Capawesome Cloud-konto i konfigurasjonen (selvhostet, uten sky)',
  skySatt.length === 0, skySatt.join(', ') || 'ingen av ' + SKY_FELT.join('/'));
/* ---- 9c. De to native halvdelene av signeringen ----

   Begge er BAKT INN i binæren og kan ikke endres uten en ny butikkrelease. Det
   er nettopp derfor de voktes her: en feil i en av dem oppdages ellers først
   når en telefon avviser en bundle — eller, verre, når den godtar en den ikke
   skulle godtatt.

   `versionCode` ER kompatibilitetsgrensen (docs/mobilapp-plan.md,
   «Native-kompatibilitet er en vakt i fase 5»). Manifestet publiseres per nivå,
   og et skall uten et manifest for sitt nivå får 404 og gjør ingenting. Nivået
   kan derfor aldri være Capacitor-malens `1`: skallet FØR OTA-pluginen og
   skallet ETTER er native forskjellige, men begge meldte `1`, og grensen ville
   sluppet inn begge. Spennet manifestene faktisk skrives for sjekkes mot dette
   tallet i tests/release-pipeline.test.js. */
const versionCode = Number((kode(appGradle).match(/^\s*versionCode\s+(\d+)\s*$/m) || [])[1]);
check('android: versionCode er et helt tall over 1 (grensen kan ikke være 1)',
  Number.isInteger(versionCode) && versionCode > 1, String(versionCode));
/* Og over 2: `autoBlockRolledBackBundles` ble slått på i konfigurasjonen over,
   og konfigurasjonen pakkes inn i APK-en. Et skall med karantenen på og ett
   uten er native forskjellige og kan ikke melde det samme nivået — nøyaktig
   samme resonnement som gjorde at `1` ikke kunne bli stående. Hvor lavt et
   nivå som fortsatt FÅR bundelen er en egen avgjørelse (OTA_MIN_VERSION_CODE i
   release.yml, voktet i tests/release-pipeline.test.js). */
check('android: versionCode er økt etter at karantenefeltet kom inn i konfigurasjonen',
  versionCode > 2, String(versionCode));
/* Og over 3: varselrunden la EGEN native kode inn i skallet — lokale varsler,
   varselikonet `ic_stat_huskis`, tillatelsen POST_NOTIFICATIONS og
   `TimeZoneAlarmReceiver`/`HuskisWallClock`, som regner om planlagte alarmer
   når telefonen bytter tidssone mens appen er lukket (docs/varsler.md). Alt
   sammen er bakt inn i APK-en, og et skall uten det er native forskjellig.
   Sjekken har to halvdeler, så den ikke kan bli stående og passere av seg selv
   om koden en dag tas ut igjen: FINNES den native varselkoden, MÅ nivået være
   over 3. */
const NATIV_VARSELKODE = [
  'android/app/src/main/java/no/huskis/app/TimeZoneAlarmReceiver.java',
  'android/app/src/main/java/no/huskis/app/HuskisWallClock.java',
  'android/app/src/main/res/drawable/ic_stat_huskis.xml',
];
const nativVarsler = NATIV_VARSELKODE.filter((f) => finnes(f));
check('android: den native varselkoden ligger i skallet',
  nativVarsler.length === NATIV_VARSELKODE.length, nativVarsler.length + ' av ' + NATIV_VARSELKODE.length);
check('android: versionCode er økt etter at den native varselkoden kom inn',
  nativVarsler.length < NATIV_VARSELKODE.length || versionCode > 3, String(versionCode));

/* `publicKey` er den OFFENTLIGE halvdelen, og er FRA OG MED signeringsrunden et
   krav, ikke et valgfritt felt — den runden la den inn sammen med
   `versionCode`-økningen og GitHub-secreten med privatnøkkelen
   (OTA_SIGNING_KEY). Uten den kan ingen telefon verifisere en bundle, og
   `release.yml` stopper allerede releasen i signeringssteget — men den feilen
   skal synes HER også, ikke bare oppdages i en logg. Privatnøkkelen skal aldri
   kunne bli pakket inn i en APK — derfor sjekkes det eksplisitt at det ikke
   står en privatnøkkel her. Pluginen er fail closed på feltet: er det satt og
   signaturen mangler, kastes ERROR_SIGNATURE_MISSING, og den faller IKKE
   tilbake til checksum. */
const publicKeySatt = !!lu && typeof lu.publicKey === 'string' && lu.publicKey.length > 0;
check('publicKey er satt (kreves fra og med signeringsrunden, ikke lenger valgfritt)',
  publicKeySatt, publicKeySatt ? 'satt' : 'MANGLER');
check('publicKey er en offentlig nøkkel — aldri en privatnøkkel',
  publicKeySatt && /BEGIN PUBLIC KEY/.test(lu.publicKey) && !/PRIVATE KEY/.test(lu.publicKey),
  publicKeySatt ? 'ok' : 'mangler');

let nokkel = null;
if (publicKeySatt) {
  try { nokkel = crypto.createPublicKey(lu.publicKey); } catch (e) { nokkel = null; }
}
check('publicKey er en RSA-nøkkel som lar seg lese',
  !!nokkel && nokkel.asymmetricKeyType === 'rsa',
  nokkel ? nokkel.asymmetricKeyType : 'mangler eller lot seg ikke lese');
check('nøkkelen er minst 2048 bit',
  !!nokkel && (nokkel.asymmetricKeyDetails || {}).modulusLength >= 2048,
  nokkel ? String((nokkel.asymmetricKeyDetails || {}).modulusLength) : '');
/* Og den må overleve PLUGINENS egen parsing, ikke bare Nodes. Lest i
   LiveUpdate.java: PEM-hodene og linjeskiftene strippes, resten base64-dekodes
   og leses som en X509EncodedKeySpec (SubjectPublicKeyInfo). En nøkkel på et
   annet format — PKCS#1 («BEGIN RSA PUBLIC KEY»), DER-fil, en OpenSSH-linje —
   ville stått grønn på mønstersjekken over og feilet på telefonen. */
let somPluginen = null;
if (publicKeySatt) {
  const raa = lu.publicKey
    .replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
  try {
    somPluginen = crypto.createPublicKey({ key: Buffer.from(raa, 'base64'), format: 'der', type: 'spki' });
  } catch (e) { somPluginen = null; }
}
const derAv = (k) => (k ? k.export({ type: 'spki', format: 'der' }) : Buffer.alloc(0));
check('nøkkelen overlever pluginens EGEN parsing (base64 uten PEM-hoder → X509EncodedKeySpec)',
  !!somPluginen && !!nokkel && derAv(somPluginen).equals(derAv(nokkel)),
  somPluginen ? 'samme nøkkel begge veier' : 'mangler eller lot seg ikke lese som X.509/SPKI');
if (finnes(APK_CFG)) {
  const innebygdLu = (json(APK_CFG).plugins || {}).LiveUpdate || null;
  check('den innebygde konfigurasjonen i APK-en bærer den samme LiveUpdate-blokken',
    !!innebygdLu && JSON.stringify(innebygdLu) === JSON.stringify(lu),
    innebygdLu ? JSON.stringify(innebygdLu) : 'mangler');
}

/* Readiness-punktet ER rollback-vakten (docs/mobilapp-plan.md,
   «Readiness-punktet»). `ready()` avvæpner timeren pluginen armerer i sin egen
   konstruktør; kalles den aldri, gjenopprettes den innebygde bundelen. Det som
   voktes her er ikke at kallet finnes, men HVOR og BAK HVA det står. */
const appKode = kode(les('app.js'));
const readyKropp = (appKode.match(/function markAppReady\(\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('readiness-punktet finnes som én navngitt funksjon (markAppReady)',
  readyKropp !== '' && /\.ready\(\)/.test(readyKropp),
  readyKropp ? 'markAppReady' : 'fant ikke funksjonen');
check('ready() står bak native-gaten og bak pluginbroen, ikke ubetinget',
  /if \(!nativeShell\) \{ appReady = true; return; \}/.test(readyKropp)
    && /nativePlugins\.LiveUpdate/.test(readyKropp)
    && readyKropp.indexOf('nativeShell') < readyKropp.indexOf('.ready('),
  readyKropp.trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ') || 'ingen kropp');
/* [P1, PR-review #134] `appReady` skal IKKE settes før `ready()` faktisk har
   lyktes — en avvist promise skal ikke kunne lese seg selv som «avvæpnet», og
   en mislykket avvæpning skal være retrybar, ikke låst av et svelget avslag.
   De to early-return-grenene (ingen native runtime / ingen plugin) har
   ingenting å vente på og setter `appReady` med det samme; den tredje — det
   faktiske native-kallet — setter den kun inne i `.then()`, og en `.catch()`
   fanger feilen i stedet for å late som suksess. */
check('appReady venter på at ready() faktisk resolverer (og en avvist promise er retrybar)',
  (readyKropp.match(/appReady = true;/g) || []).length === 3
    && /if \(!live \|\| typeof live\.ready !== 'function'\) \{ appReady = true; return; \}/.test(readyKropp)
    && /readyInFlight = true;[\s\S]*\.then\(\(res\) => \{ appReady = true;[^}]*liveReadyError = null; noteRollback\(res\); \}\)/.test(readyKropp)
    && /\.catch\(\(e\) => \{ liveReadyError = /.test(readyKropp)
    && /\.then\(\(\) => \{ readyInFlight = false; \}\);/.test(readyKropp),
  readyKropp.trim());
/* Stoppeklokken mot `readyTimeout` (docs/mobilapp-plan.md, «Tidsmålingen mot
   readyTimeout»). Tallet som måles mot de 10 000 er `readyCalledAt`, og det er
   plasseringen som gjør det til en ekte nedre grense: `stopRollbackTimer()` er
   det FØRSTE `ready()` gjør nativt (LiveUpdate.java 8.4.0), så avvæpningen
   ligger etter at kallet krysset broen — men før `callback.success()`, som er
   det `readyResolvedAt` ser. Settes `readyCalledAt` etter broen, eller leses
   `readyResolvedAt` som avvæpningstidspunktet, påstår instrumentet en
   presisjon det ikke har.

   `reachedAt` skal settes FØR de to early-return-grenene (ellers mangler
   tallet på de to veiene som ikke venter på noe), og de to andre skal settes
   KUN i native-grenen — et skall uten plugin skal ikke rapportere en
   avvæpning som aldri skjedde. */
check('stoppeklokken: reachedAt før gatene, de to andre kun i native-grenen',
  /noteReadyMs\('reachedAt'\);[\s\S]*if \(!nativeShell\)/.test(readyKropp)
    && (readyKropp.match(/noteReadyMs\('readyCalledAt'\)/g) || []).length === 1
    && (readyKropp.match(/noteReadyMs\('readyResolvedAt'\)/g) || []).length === 1,
  readyKropp.trim());
check('stoppeklokken: readyCalledAt står FØR broen, readyResolvedAt i .then()',
  /noteReadyMs\('readyCalledAt'\);\s*Promise\.resolve\(live\.ready\(\)\)/.test(readyKropp)
    && /\.then\(\(res\) => \{[^}]*noteReadyMs\('readyResolvedAt'\)/.test(readyKropp),
  readyKropp.trim());

/* Punktet nås fra BEGGE de brukbare skjermene: innloggingsskjermen for en
   utlogget bruker, board-et brettet fra localStorage for en innlogget. Bare ett
   av kallstedene ville gjort rollback avhengig av hvilken av dem brukeren
   traff — og for den andre halvparten ville en fungerende bundle blitt rullet
   tilbake. */
const kropp = (navn) =>
  (appKode.match(new RegExp('async function ' + navn + '\\(\\) \\{([\\s\\S]*?)\\n  \\}')) || [, ''])[1] || '';
/* [P1, PR-review #141] INVARIANTEN: ingenting som kan vente på NETTET får ligge
   på kritisk vei til readiness-punktet. Lest i den innsjekkede supabase-js
   regner `__loadSession()` en sesjon som utløpt 90 sekunder før den er det og
   fornyer tokenet før den leveres — offline med retry i opptil 30 000 ms, tre
   ganger `readyTimeout`. Lå `markAppReady()` bak den ventingen, ville en frisk
   bundle blitt rullet tilbake og deretter varig sperret av karantenen.

   Sjekken er posisjonell fordi feilen er posisjonell: i `initAccounts` skal
   kallet stå FØR den første `await client.auth.…`. Den kjørende halvdelen av
   invarianten ligger i tests/ota-fetch.test.js (sjekk 13, med ?authlag=). */
const initKropp = kropp('initAccounts');
const iPunkt = initKropp.indexOf('markAppReady();');
const iAuthAwait = initKropp.search(/await\s+client\.auth\./);
check('readiness-punktet står FØR det første auth-kallet som kan vente på nettet',
  iPunkt > -1 && iAuthAwait > -1 && iPunkt < iAuthAwait,
  'markAppReady@' + iPunkt + ', første await client.auth.@' + iAuthAwait);

const utenPunkt = ['cloudStart', 'initAccounts'].filter((f) => !/markAppReady\(\);/.test(kropp(f)));
check('readiness-punktet settes fra begge de brukbare skjermene (cloudStart + initAccounts)',
  utenPunkt.length === 0, utenPunkt.join(', ') || 'cloudStart, initAccounts');
/* ---- 9d. OTA-flyten: hente, klargjøre og bytte ----
   Fase 5 i sin helhet (docs/mobilapp-plan.md): manifestet leses på URL-en det
   NATIVE nivået bestemmer, valideres ved systemgrensen, bundelen lastes ned,
   stilles opp — og byttes. De to siste er de eneste kallene som faktisk endrer
   hvilken kode enheten kjører, og de er derfor ikke låst til «finnes ikke»
   lenger, men til HVOR og BAK HVA de står. Selve oppførselen kjøres i ekte
   nettleser med faket bro: tests/ota-fetch.test.js. Her låses KILDEN. */
const OTA_METODER = ['ready', 'getVersionCode', 'downloadBundle',
  'getBlockedBundles', 'setNextBundle', 'reload'];
const otaKall = (appKode.match(/\blive\.(\w+)\(/g) || []).map((m) => m.slice(5, -1));
const ukjenteKall = otaKall.filter((m) => OTA_METODER.indexOf(m) === -1);
check('pluginbroen kalles kun med de seks kjente metodene',
  otaKall.length > 0 && ukjenteKall.length === 0,
  ukjenteKall.join(', ') || otaKall.join(', '));
/* Hver av de tre som RØRER en bundle skal finnes nøyaktig én gang. To
   kallsteder for det samme ville betydd to veier gjennom vaktene, og bare den
   ene ville blitt lest her. */
['downloadBundle', 'setNextBundle', 'reload'].forEach((m) => {
  check('live.' + m + ' kalles fra nøyaktig ett sted',
    otaKall.filter((k) => k === m).length === 1,
    otaKall.filter((k) => k === m).length + ' kall');
});
/* Hvilke PLUGINER broen i det hele tatt leses for. Et rått antall ville måtte
   økes hver gang en linje flyttet seg; navnene er det som betyr noe — en ny
   plugin er en ny native avhengighet, og den skal ikke kunne snike seg inn
   bak en telling. To er kjent: OTA-pluginen (fase 5) og varselpluginen
   (PR 3B, docs/varsler.md). */
const KJENTE_BROER = { LiveUpdate: 4, LocalNotifications: 5 };
const broOppslag = (appKode.match(/nativePlugins\.(\w+)/g) || []).map((m) => m.slice(14));
const ukjenteBroer = [...new Set(broOppslag)].filter((n) => !(n in KJENTE_BROER));
check('pluginbroen leses kun for de kjente pluginene',
  ukjenteBroer.length === 0, ukjenteBroer.join(', ') || [...new Set(broOppslag)].join(', '));
Object.keys(KJENTE_BROER).forEach((navn) => {
  const n = broOppslag.filter((x) => x === navn).length;
  check('nativePlugins.' + navn + ' leses fra nøyaktig ' + KJENTE_BROER[navn] + ' steder',
    n === KJENTE_BROER[navn], n + ' forekomster');
});
check('broen deklareres ett sted, og leses ellers bare gjennom de oppslagene',
  (appKode.match(/nativePlugins/g) || []).length === broOppslag.length + 1,
  (appKode.match(/nativePlugins/g) || []).length + ' forekomster i kjørende kode');

/* Oppstillingen: `setNextBundle()` konsulterer ALDRI pluginens blokkliste selv
   — den leses kun i pluginens egen `sync()`-flyt, som Huskis ikke bruker (lest
   i LiveUpdate.java 8.4.0, docs/mobilapp-plan.md «En rullet-tilbake bundle må
   være varig sperret»). Karantenen må derfor spørres FØR oppstillingen, og
   fail closed: kan vi ikke lese listene, stiller vi ingenting opp. Uten dette
   ville et manifest som blir stående på en dårlig bundle gitt én ødelagt
   kaldstart annenhver gang, i det uendelige. */
const stageKropp = (appKode.match(/async function prepareOtaBundle\(\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('oppstillingen finnes som én navngitt funksjon (prepareOtaBundle)',
  stageKropp !== '' && /live\.setNextBundle\(/.test(stageKropp),
  stageKropp ? 'prepareOtaBundle' : 'fant ikke funksjonen');
check('karantenen spørres FØR setNextBundle, og et sperret mål stilles ikke opp',
  /otaBlockedBundle\(/.test(stageKropp)
    && stageKropp.indexOf('otaBlockedBundle(') < stageKropp.indexOf('live.setNextBundle(')
    && /catch \(e\) \{ sperret = true; \}/.test(stageKropp)
    && /if \(sperret\) \{[^}]*'blocked'[\s\S]*?return false;/.test(stageKropp),
  stageKropp ? 'karantene før oppstilling' : 'ingen kropp');
/* «Klargjort» må dekke BEGGE veier. Pluginen avviser en `bundleId` den har fra
   før (ERROR_BUNDLE_EXISTS), og det treffer hver kaldstart etter den første —
   en oppstilling som krevde en FERSK nedlasting ville derfor aldri kommet
   videre dagen etter. */
check('en bundle som alt ligger i lageret regnes som klargjort, ikke som en feil',
  /otaFetch\.state !== 'downloaded' && otaFetch\.state !== 'already-downloaded'/.test(stageKropp),
  (stageKropp.match(/otaFetch\.state !== [^)]*/) || ['fant ikke sjekken'])[0]);
const blockKropp = (appKode.match(/async function otaBlockedBundle\([^)]*\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('karantenen leser BÅDE vår egen varige liste og pluginens blokkliste',
  /egen\.indexOf\(bundleId\) > -1/.test(blockKropp)
    && /live\.getBlockedBundles\(/.test(blockKropp),
  blockKropp.trim() || 'fant ikke funksjonen');
/* Fail closed hele veien: en liste som ikke kan LESES er ikke det samme som en
   tom liste, en rollback som ikke kunne FØRES OPP er ikke det samme som ingen
   rollback, og et svar fra broen som ikke er en liste er ikke ingen sperre.
   Hver av dem betyr «vi vet ikke», og da stilles ingenting opp. */
const NEI = [
  ['en rollback som ikke kunne føres opp', /if \(otaQuarantineBroken\) return true;/],
  ['en liste som ikke kan leses', /if \(egen === null\) return true;/],
  ['en bro uten getBlockedBundles', /typeof live\.getBlockedBundles !== 'function'\) return true;/],
  ['et svar som ikke er en liste', /!Array\.isArray\(r\.bundleIds\)\) return true;/],
];
NEI.forEach(([navn, re]) => {
  check('karantenen er fail closed: ' + navn + ' er et NEI',
    re.test(blockKropp), blockKropp.trim() || 'fant ikke funksjonen');
});
/* Lesningen må skille «tom» fra «uleselig», ellers er fail closed-sjekken over
   pynt: en blokkert lagring ville lest som en tom liste. */
const lesKropp = (appKode.match(/function otaQuarantine\(\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('en uleselig karanteneliste skilles fra en tom (null vs [])',
  /catch \(e\) \{ return null; \}/.test(lesKropp)
    && /if \(raa == null\) return \[\];/.test(lesKropp)
    && /return null;/.test(lesKropp),
  lesKropp.trim() || 'fant ikke funksjonen');
/* Og skrivingen leses tilbake — samme regel som ett-forsøk-vakten i
   update-check.js. En rollback vi ikke klarte å føre opp skal stoppe
   oppstillingen, ikke forsvinne stille. */
const skrivKropp = (appKode.match(/function otaQuarantineAdd\([^)]*\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('skrivingen til karantenen leses tilbake, og en feilet skriving sperrer oppstillingen',
  /catch \(e\) \{ otaQuarantineBroken = true; return; \}/.test(skrivKropp)
    && /if \(!igjen \|\| igjen\.indexOf\(id\) === -1\) otaQuarantineBroken = true;/.test(skrivKropp),
  skrivKropp.trim() || 'fant ikke funksjonen');
/* Vår egen karantene dekker det ene tilfellet pluginens ikke kan: dør
   prosessen mellom rollbacken og readiness-punktet i den innebygde bundelen,
   er `rollbackPerformed` borte ved neste kaldstart (det bor i minnet). Da står
   `previousBundleId` igjen alene, og `ready()` melder `currentBundleId == null`
   sammen med den. Den signaturen ER rollbacken. */
const rollbackKropp = (appKode.match(/function noteRollback\([^)]*\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('en rullet-tilbake bundle føres i en VARIG karantene (localStorage), ikke bare i minnet',
  /liveReady\.rollback === true \|\| liveReady\.currentBundleId == null/.test(rollbackKropp)
    && /otaQuarantineAdd\(forrige\)/.test(rollbackKropp)
    && /localStorage\.setItem\(OTA_BLOCK_KEY/.test(appKode),
  rollbackKropp.trim() || 'fant ikke funksjonen');

/* Byttet: pluginens `reload()` tar i bruk bundelen som er stilt opp som NESTE.
   Den skal aldri kunne kalles på et mål som ikke ER stilt opp — da ville den
   lastet den koden som allerede kjører — og den skal stå bak den samme gaten
   som resten. Avgjørelsen om NÅR (updateSafety, banneret, inaktivitetsregelen,
   ett-forsøk-vakten) ligger fortsatt i update-check.js; dette er bare veien. */
const applyKropp = (appKode.match(/function applyUpdate\(\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('byttet finnes som én navngitt funksjon (applyUpdate), bak gaten',
  applyKropp !== '' && /nativeShell \? nativePlugins\.LiveUpdate : null/.test(applyKropp),
  applyKropp.trim() || 'fant ikke funksjonen');
check('live.reload() kalles kun når en bundle FAKTISK er stilt opp — ellers location.reload()',
  /otaStage\.state === 'staged'\) \{ live\.reload\(\); return; \}/.test(applyKropp)
    && /location\.reload\(\);/.test(applyKropp),
  applyKropp.trim());

/* Hentingen selv: bak den samme gaten som ready(), URL-en bygget av det
   kanoniske originet + skallets eget nivå, og manifestet validert FØR noe av
   det brukes. Alt her er stille å bryte — en hardkodet vert eller et hopp over
   valideringen ser helt riktig ut helt til feil telefon laster ned feil kode. */
const otaKropp = (appKode.match(/async function fetchOtaBundle\(\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
const lastKropp = (appKode.match(/async function downloadOtaBundle\([^)]*\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('OTA-hentingen finnes som én navngitt funksjon (fetchOtaBundle)',
  otaKropp !== '' && /prepareOtaBundle\(\)/.test(otaKropp),
  otaKropp ? 'fetchOtaBundle' : 'fant ikke funksjonen');
check('hentingen står bak native-gaten og bak pluginbroen, ikke ubetinget',
  /if \(!nativeShell\) return;/.test(otaKropp)
    && /nativePlugins\.LiveUpdate/.test(otaKropp)
    && otaKropp.indexOf('nativeShell') < otaKropp.indexOf('live.getVersionCode('),
  otaKropp ? 'gate før getVersionCode' : 'ingen kropp');
/* getVersionCode() gir en STRENG, og URL-formen er valgt nettopp for å slippe
   tallparsing og sammenligningsoperator — en parseInt her ville vært den
   valgte formen forlatt i det stille. */
check('manifest-URL-en bygges av canonicalAppUrl() og skallets versionCode — ingen egen vert, ingen tallparsing',
  /canonicalAppUrl\(\)/.test(otaKropp)
    && /base \+ 'ota\/android\/' \+ versionCode \+ '\.json'/.test(otaKropp)
    && !/parseInt|Number\(/.test(otaKropp),
  (otaKropp.match(/base \+ [^;]+/) || ['fant ikke URL-byggingen'])[0]);
check('nøyaktig ETT fetch, med cache: no-store (manifestet navngir det som gjelder NÅ)',
  (otaKropp.match(/\bfetch\(/g) || []).length === 1 && /\{ cache: 'no-store' \}/.test(otaKropp),
  (otaKropp.match(/\bfetch\(/g) || []).length + ' fetch-kall');
check('manifestet valideres ved systemgrensen før noe av det brukes',
  /validOtaManifest\(/.test(otaKropp)
    && otaKropp.indexOf('validOtaManifest(') < otaKropp.indexOf('otaTarget = m;'),
  'validOtaManifest før målet settes');
check('manifestets releaseId sammenlignes med === mot egen meta-tagg (identitet, aldri rangering)',
  /meta\[name="huskis-release"\]/.test(otaKropp) && /m\.releaseId === egen/.test(otaKropp),
  (otaKropp.match(/m\.releaseId[^;]*/) || ['fant ikke sammenligningen'])[0]);
/* Pluginen sjekker checksum-feltet KUN når publicKey ikke er satt (lest i
   kilden, docs/mobilapp-plan.md «Hva manifestet inneholder»). Et checksum-felt
   her ville påstått en kontroll som aldri kjører. */
check('downloadBundle får url, bundleId og signature — og INGEN checksum',
  /live\.downloadBundle\(\{ url: m\.url, bundleId: m\.bundleId, signature: m\.signature \}\)/.test(lastKropp)
    && appKode.indexOf('checksum') === -1,
  (lastKropp.match(/live\.downloadBundle\([^)]*\)/) || ['fant ikke kallet'])[0]);
/* Valideringen låser url til det kanoniske originet: den native nedlastingen
   går i OkHttp, UTENFOR WebView-ens CSP, så dette er den ene vakten som sier
   hvilken vert appen i det hele tatt henter kode fra. */
const validKropp = (appKode.match(/function validOtaManifest\([^)]*\) \{([\s\S]*?)\n  \}/) || [, ''])[1] || '';
check('valideringen låser url til det kanoniske originet (nedlastingen skjer utenfor CSP-en)',
  /m\.url\.indexOf\(base\) !== 0/.test(validKropp),
  (validKropp.match(/m\.url[^;]*/) || ['fant ikke url-sjekken'])[0]);

/* ---- 9e. Klargjøringstilstanden i update-check.js ----

   Motoren gikk før rett fra «jeg så en annen build-ID» til `reload()`. På
   native ville det betydd en reload av nøyaktig den koden som allerede kjører:
   bundelen må være lastet ned OG stilt opp først. Leddet er lagt til i motoren,
   ikke i trygghetsvurderingen (arkitekturregel 8) — og det bærer to fail
   closed-regler som er stille å bryte.

   Native-kunnskapen blir liggende i app.js: begge krokene slås opp på
   `window.__huskis` ved HVERT kall, nøyaktig som `defaultIsSafe` allerede
   gjør. Står et pluginnavn i denne fila, har kunnskapen lekket. */
const uc = kode(les('update-check.js'));
const PLUGIN_ORD = ['LiveUpdate', 'setNextBundle', 'downloadBundle', 'getBlockedBundles', 'bundleId'];
const lekket = PLUGIN_ORD.filter((w) => new RegExp('\\b' + w + '\\b').test(uc));
check('update-check.js kjenner ingen plugin — krokene slås opp på window.__huskis',
  lekket.length === 0 && /win\.__huskis;[\s\S]*prepareUpdate/.test(uc)
    && /win\.__huskis;[\s\S]*applyUpdate/.test(uc),
  lekket.join(', ') || 'ingen');
/* Regel 1: en FEILET klargjøring skal ikke brenne ett-forsøk-vakten.
   `markAttempt()` skrives i dag rett før reloaden, og en oppbrukt vakt er
   permanent for den mål-builden i den fanen. Vakten skrives derfor kun i
   `autoReload()`, og `evaluate()` returnerer FØR den når målet ikke er
   klargjort. */
const evalKropp = (uc.match(/function evaluate\(\) \{([\s\S]*?)\n    \}/) || [, ''])[1] || '';
check('evaluate() returnerer før alt annet når målet ikke er klargjort',
  /if \(prepared !== target\) return;/.test(evalKropp)
    && evalKropp.indexOf('prepared !== target') < evalKropp.indexOf('isSafe()'),
  evalKropp.trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ') || 'ingen kropp');
check('ett-forsøk-vakten skrives kun i autoReload(), som kun evaluate() når fram til',
  (uc.match(/markAttempt\(/g) || []).length === 2   // definisjonen + det ene kallet
    && /function autoReload\(\) \{[\s\S]*?markAttempt\(target\)/.test(uc)
    && (uc.match(/autoReload\(\);/g) || []).length === 1,
  (uc.match(/markAttempt\(/g) || []).length + ' forekomster');
/* Regel 2: banneret skal ikke love noe som ikke er klart. Det vises først når
   klargjøringen har lykkes, og «Oppdater nå» — som med vilje går utenom
   trygghetsvakten — går IKKE utenom klargjøringen. */
const prepKropp = (uc.match(/function prepareTarget\(\) \{([\s\S]*?)\n    \}/) || [, ''])[1] || '';
check('banneret vises først når klargjøringen har lykkes',
  (uc.match(/showBanner\(\);/g) || []).length === 1 && /showBanner\(\);/.test(prepKropp)
    && /prepared !== id\) return;/.test(prepKropp),
  prepKropp.trim() ? 'showBanner kun i prepareTarget' : 'ingen kropp');
check('«Oppdater nå» går utenom trygghetsvakten, men ikke utenom klargjøringen',
  /btn\.addEventListener\('click', function \(\) \{ manualReload\(\); \}\);/.test(uc)
    && /function manualReload\(\) \{\s*if \(target && prepared === target\) \{ reload\(\); return; \}/.test(uc),
  (uc.match(/function manualReload\(\) \{[\s\S]*?\n    \}/) || ['fant ikke knappen'])[0]);

/* ---- 10. Safe areas, systemfeltene og skjermtastaturet ----

   Runtimen rapporterer systemflatenes mål som `env(safe-area-inset-*)` KUN når
   siden ber om å få tegne under dem, altså med `viewport-fit=cover`. Uten den
   krymper skallet i stedet WebView-en, `env()` er 0, og appen står med en
   fremmedfarget stripe øverst og nederst. Selve sonen (at chromet faktisk
   flytter seg) testes i ekte nettleser: tests/safe-area.test.js. Her voktes de
   to erklæringene den hviler på — de står i hver sin fil og kan ellers komme i
   utakt uten at noe sier fra. */
const indexHtml = les('index.html');
const viewportTag = (indexHtml.match(/<meta name="viewport"[^>]*>/) || [''])[0];
check('index.html ber om å få tegne under systemfeltene (viewport-fit=cover)',
  /viewport-fit\s*=\s*cover/.test(viewportTag), viewportTag.trim() || 'ingen viewport-tagg');
/* Uten en eksplisitt modus står den på «unspecified», og om tastaturet krymper
   eller skyver vinduet er da systemets valg. Web-laget regner med krymping:
   resize-lytteren i app.js ruller feltet som redigeres tilbake i syne. */
check('android: skjermtastaturet krymper vinduet (adjustResize)',
  /android:windowSoftInputMode="adjustResize"/.test(manifest));

/* Systemfeltenes GLYFER hører til den samme mekanismen, og de er MÅLT på
   telefon: båndet bak klokka er ikke sidens flate, men VINDUSBAKGRUNNEN fra
   appens tema. Da temaet var permanent lyst, var båndet lyst også når appen
   var mørk — og glyfer som fulgte telefonens nattmodus ble hvite oppå det.

   Derfor er hele oppsettet bundet til ÉN kilde: telefonens nattmodus.
   DayNight-foreldretemaet gjør vindusbakgrunnen mørk om natten, night-
   variantene snur glyfene med den, og `SystemBars.style: DEFAULT` lar
   pluginen lese den samme nattmodusen i runtime. Båndet og glyfene kan da
   ikke komme i utakt, uansett hvilken drakt brukeren velger i appen —
   draktvalget rører ikke systemfeltene i det hele tatt.

   Ingenting av dette kan ses fra web-laget — derfor voktes erklæringene her. */
/* XML-KOMMENTARER TÅLER IKKE «--». Standarden forbyr to bindestreker på rad
   inne i en kommentar, og Gradles `mergeDebugResources` avviser fila med
   «The string "--" is not permitted within comments» — altså et RØDT BYGG,
   ikke en advarsel. Fella er lett å gå i her: kommentarene i disse filene
   forklarer hvorfor systemfeltene ser ut som de gjør, og da er det nærliggende
   å referere en CSS-variabel ved navn. Sjekken er billig og fanger det i
   node-suiten i stedet for etter et par minutter med Gradle. */
for (const f of ['android/app/src/main/res/values/styles.xml',
  'android/app/src/main/res/values-v27/styles.xml',
  'android/app/src/main/res/values-night/styles.xml',
  'android/app/src/main/res/values-night-v27/styles.xml',
  'android/app/src/main/res/values/colors.xml']) {
  const kommentarer = les(f).match(/<!--[\s\S]*?-->/g) || [];
  const ulovlige = kommentarer
    .map((k) => k.slice(4, -3))          // uten selve markørene
    .filter((innhold) => innhold.includes('--'));
  check(f + ': ingen «--» inne i en XML-kommentar (Gradle avviser fila)',
    ulovlige.length === 0,
    ulovlige.map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80)));
}

const styles = les('android/app/src/main/res/values/styles.xml');
const stylesV27 = les('android/app/src/main/res/values-v27/styles.xml');
const stylesNight = les('android/app/src/main/res/values-night/styles.xml');
const stylesNightV27 = les('android/app/src/main/res/values-night-v27/styles.xml');
/* Kjøretidstemaet MÅ være DayNight, av to grunner som begge bare kan ses
   nativt: fra targetSdk 33 utleder WebView `prefers-color-scheme` av appens
   eget tema (isLightTheme), ikke av telefonens nattmodus — med et permanent
   lyst tema svarte den alltid «light», og draktens standardvalg «Følg
   systemet» ga lys app på en mørk telefon (bekreftet på enhet). Og vindus-
   bakgrunnen, som er flaten bak statusfeltet, må kunne bli mørk.

   `AppTheme` (det ubrukte AppCompat-basetemaet Capacitor genererer) telles
   ikke med — det er `AppTheme.NoActionBar` aktiviteten faktisk kjører på. */
const runtimeParent = (s) =>
  ((s.match(/name="AppTheme\.NoActionBar"\s+parent="([^"]*)"/) || [])[1] || 'mangler');
check('android: kjøretidstemaet er DayNight (prefers-color-scheme + mørk vindusbakgrunn)',
  [styles, stylesV27, stylesNight, stylesNightV27]
    .every((s) => runtimeParent(s) === 'Theme.AppCompat.DayNight.NoActionBar'),
  [styles, stylesV27, stylesNight, stylesNightV27].map(runtimeParent).join(' | '));
check('android: statusfeltet er gjennomsiktig (Huskis-flaten når skjermkanten)',
  /android:statusBarColor">@android:color\/transparent/.test(styles));
/* Bunnfeltet er unntaket på API 24–26: der finnes ikke
   `windowLightNavigationBar`, og runtime-veien er en no-op, så treknappsradens
   glyfer er LYSE uansett. Et gjennomsiktig felt ville lagt hvite knapper oppå
   vår lyse flate — de versjonene får derfor en mørk stripe å ligge på, og først
   values-v27 gjør feltet gjennomsiktig. */
check('android: bunnfeltet er en mørk stripe før API 27, ikke gjennomsiktig',
  /android:navigationBarColor">@color\/systemNavScrim/.test(styles)
  && !/android:navigationBarColor">@android:color\/transparent/.test(styles)
  && /name="systemNavScrim"/.test(les('android/app/src/main/res/values/colors.xml')));
check('android: bunnfeltet blir gjennomsiktig fra API 27 (der glyfene kan snus)',
  /android:navigationBarColor">@android:color\/transparent/.test(stylesV27));
/* Glyfene skal snu MED vindusbakgrunnen: mørke over den lyse dagflaten, lyse
   over den mørke nattflaten. Uten night-varianten arver natten `true` fra
   values/ og gir mørke glyfer på mørk flate. */
check('android: statusfeltets glyfer snur med nattmodus (windowLightStatusBar)',
  /android:windowLightStatusBar">true/.test(styles)
  && /android:windowLightStatusBar">false/.test(stylesNight)
  && /android:windowLightStatusBar">false/.test(stylesNightV27));
/* Splash-bildet er hvitt i BEGGE modi (drawable/splash.png), så splash-temaet
   skal IKKE ha en night-variant — der gjelder mørke glyfer hele døgnet.
   Kommentarene strippes først: de NEVNER stilen for å forklare fraværet, og
   skal ikke felle sin egen test. */
const utenKommentar = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
check('android: splash-temaet er uendret om natten (splash.png er hvitt i begge modi)',
  !/AppTheme\.NoActionBarLaunch/.test(utenKommentar(stylesNight))
  && !/AppTheme\.NoActionBarLaunch/.test(utenKommentar(stylesNightV27)));
/* Temaet er ikke nok alene: `SystemBars`-pluginen SETTER utseendet i runtime
   (`setAppearanceLightStatusBars`) og overstyrer det etter oppstart, rotasjon
   og modusbytte. `DEFAULT` betyr «følg telefonen» — altså nøyaktig den samme
   nattmodusen som DayNight-temaet snur vindusbakgrunnen etter, så flaten og
   glyfene over den kan ikke skille lag.

   DENNE MÅ IKKE LÅSES TIL `LIGHT` (mørke glyfer). Det var riktig så lenge
   appen var permanent lys, men med DayNight blir båndet mørkt om natten, og
   låste mørke glyfer ville da vært uleselige — speilbildet av feilen #119
   fjernet. Skal den låses igjen, må vindusbakgrunnen låses lys i samme slengen
   (docs/mobilapp-plan.md). */
check('capacitor.config.json lar systemfeltene følge telefonen (SystemBars.style = DEFAULT)',
  !!cfg.plugins && !!cfg.plugins.SystemBars && cfg.plugins.SystemBars.style === 'DEFAULT',
  JSON.stringify((cfg.plugins || {}).SystemBars || null));
/* Attributten finnes først fra API 27, og hører derfor hjemme i v27-variantene
   — i values/ ville den vært død kode med lint-støy på kjøpet. */
check('android: gestelinjens glyfer snur med nattmodus fra API 27 (windowLightNavigationBar)',
  /android:windowLightNavigationBar">true/.test(stylesV27)
  && /android:windowLightNavigationBar">false/.test(stylesNightV27)
  && !/android:windowLightNavigationBar/.test(styles)
  && !/android:windowLightNavigationBar/.test(stylesNight));

/* ---- 11. Systemets tilbakeknapp ----

   Capacitor gjør ingenting med tilbakeknappen selv: `@capacitor/android` har
   ingen back-håndtering, så BridgeActivity arver AppCompats standard og første
   trykk forlater appen — uansett hva som står åpent. Det native skallet skal
   derfor spørre web-laget først, og bare la OS ta trykket når web-laget sier at
   det ikke tok det. Selve stigen (hvilket lag som lukkes når) testes i ekte
   nettleser: tests/system-back.test.js. */
const mainAct = les('android/app/src/main/java/no/huskis/app/MainActivity.java');
check('MainActivity registrerer en OnBackPressedCallback',
  /OnBackPressedCallback/.test(mainAct) && /getOnBackPressedDispatcher\(\)\.addCallback/.test(mainAct));
check('MainActivity spør web-laget via __huskisSystemBack',
  /window\.__huskisSystemBack/.test(mainAct));
/* Uten videresendingen ville et «nei» fra web-laget blitt et dødt tilbaketrykk:
   appen ville aldri kunne forlates med tilbakeknappen. */
check('et ubesvart trykk sendes videre til OS, ikke svelges',
  /setEnabled\(false\)/.test(mainAct)
    && /getOnBackPressedDispatcher\(\)\.onBackPressed\(\)/.test(mainAct)
    && /setEnabled\(true\)/.test(mainAct));
/* `finish()` ville avgjort på OS-ets vegne hva et tilbaketrykk på rot-
   aktiviteten betyr (Android bærer i dag oppgaven i bakgrunnen i stedet for å
   rive den ned). Videresending til dispatcheren beholder plattformens egen
   oppførsel. */
check('skallet kaller ikke finish() selv', !/\bfinish\(\)/.test(kode(mainAct)));
/* androidx.activity kommer inn i Capacitor som `implementation`, altså ikke på
   appmodulens kompileringssti. MainActivity bruker API-et direkte. */
check('android/app/build.gradle har androidx.activity på kompileringsstien',
  /implementation "androidx\.activity:activity:\$androidxActivityVersion"/.test(appGradle));

/* ---- 12. Eksterne lenker ----

   Regelen (docs/domains-and-urls.md, «Eksterne lenker»): appens eget origin
   lastes INNE i appen, alt annet åpnes i systembrowseren. Den håndheves av
   Capacitors egen `BridgeWebViewClient.shouldOverrideUrlLoading()` →
   `Bridge.launchIntent()`, som sender enhver adresse med et annet
   skjema+vert enn appens ut som en `Intent.ACTION_VIEW`. Huskis skriver altså
   ingen kode for dette — og nettopp derfor er det de to måtene å MISTE regelen
   på som må voktes:

     a) `server.allowNavigation` slipper navngitte verter INN i WebView-en. Web
        Storage er origin-skilt, så en slik side ser IKKE Huskis' localStorage
        eller Supabase-sesjonen — men Capacitor-broen injiseres i WebView-en og
        ikke i et bestemt origin, så den kan kalle appens native plugin-er. En
        side som lastes der er ikke et faneskifte, den er innsiden av appen;
     b) web-kildekoden begynner å produsere utgående lenker uten at noen har
        tatt stilling til hvor de skal havne.

   Alt her er tekstsjekker på kildekoden — hvor Android faktisk sender en
   ACTION_VIEW er telefonens sak, og kan bare ses der. */
const srv = cfg.server || {};
check('ingen server.allowNavigation (ingen fremmed vert lastes inne i appen)',
  !srv.allowNavigation || srv.allowNavigation.length === 0,
  JSON.stringify(srv.allowNavigation || null));
if (finnes(APK_CFG)) {
  const innebygdSrv = json(APK_CFG).server || {};
  check('den innebygde konfigurasjonen har heller ingen allowNavigation',
    !innebygdSrv.allowNavigation || innebygdSrv.allowNavigation.length === 0,
    JSON.stringify(innebygdSrv.allowNavigation || null));
}
/* Sjekken over hopper over seg selv i et rent utsjekk: den innebygde
   konfigurasjonen er generert utdata, og `cap sync` har ikke kjørt i den
   vanlige node-runden. Da er det ingen CI-jobb som noen gang ser den PAKKEDE
   konfigurasjonen — og en endring i genereringen ville sluppet gjennom.
   APK-workflowen er det ene stedet filen finnes, så den må kjøre denne testen
   ETTER synkroniseringen. Det er den rekkefølgen som voktes her; selve
   innholdet sjekkes av linjene over, der.

   Rekkefølgen leses av KJØRENDE steg, ikke av fila som tekst: både
   `cap sync android` og testkommandoen står omtalt i kommentarene her (og i
   overskriftsblokken øverst), så et rått tekstsøk ville stått grønt selv om
   selve steget var fjernet eller kommentert ut. */
const apkKjør = les('.github/workflows/android-debug.yml')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .map((l) => (l.match(/^\s*(?:-\s*)?run:\s*(.*)$/) || [, null])[1])
  .filter((x) => x !== null);
const iSync = apkKjør.findIndex((l) => /cap sync android/.test(l));
const iTest = apkKjør.findIndex((l) => /node tests\/capacitor-android\.test\.js/.test(l));
check('APK-workflowen kjører denne testen ETTER cap sync (ellers ser ingen CI den pakkede konfigurasjonen)',
  iSync > -1 && iTest > iSync,
  iTest === -1 ? 'testen kjøres ikke som et run-steg i android-debug.yml'
    : 'run-steg: cap sync #' + iSync + ', testen #' + iTest);
/* Sjekkene under trenger en STRENGBEVISST kommentarfjerner, ikke kodeLinjer().
   Den forenklingen — kapp linja ved første `//` — er grei for navnesjekkene
   lenger oppe, men den blindet disse på to måter: `href="//vert"` forsvant helt,
   og på en kompakt linje som `const u = 'https://x'; window.open(u)` ble alt
   ETTER URL-en usynlig. Denne holder styr på strenger, blokk-kommentarer og
   HTML-kommentarer (index.html leses med den samme funksjonen), så `//` inne i
   en URL ikke kapper noe. Enkle og doble anførselstegn nullstilles ved
   linjeskift — de kan ikke spenne over linjer i JS, og et løsrevet apostrof i
   HTML-tekst skal ikke forgifte resten av fila. */
function kodeLinjerStreng(src, modus) {
  const linjer = src.split('\n');
  let iBlokk = false, iHtml = false, iSkript = false, streng = null;
  /* En `<script …>`-STARTTAGG kan brekke over flere linjer. Uten denne
     tilstanden ga `slutt === -1` opp, `iSkript` ble stående falsk, og kroppen
     under ble lest som markup — der `<!--` er en kommentar som løper til
     `-->`, mens den i et klassisk skript bare er en linjekommentar. Alt
     mellom de to ville da blitt kastet, kall og alt. */
  let iStartTagg = false;
  /* Sist SIGNIFIKANTE tegn, brukt til å skille et regex-literal fra divisjon:
     etter en VERDI (`)`, `]`, et navn, et tall) er `/` deling, ellers starter
     den et regex. Uten det skillet ville `/[/*]/` satt fjerneren i
     blokk-kommentarmodus og slukt resten av fila. Et nøkkelord slutter også på
     et ordtegn, men er ingen verdi — `return /re/` er et regex — så de
     sjekkes for seg.

     Ett tilfelle til krever mer enn forrige tegn: et regex kan starte en
     setning rett etter en BETINGELSE — `if (klar) /re/.test(x)` — og der ser
     `)` nøyaktig ut som slutten på `(a + b) / c`. Forskjellen ligger i hva den
     parentesen var, så parentesene stables: ved `(` noteres om tokenet foran
     var `if`/`while`/`for`/`switch`/`catch`/`with`, og ved `)` husker vi hva
     som nettopp ble lukket. Det er ingen full JS-lexer, men det er den ene
     grammatiske opplysningen valget faktisk trenger.

     `hale` er de siste signifikante tegnene PÅ TVERS av linjer, ikke bare på
     denne. Et nøkkelord eller en betingelse som slutter på forrige linje
     teller like fullt. */
  let forrige = '';
  let hale = '';
  const parenteser = [];
  let lukketBetingelse = false;
  const CTRL = /(?:^|[^\w$])(?:if|while|for|switch|catch|with)\s*$/;
  return linjer.map((raw, i) => {
    /* Backtick og `"""` er de to strengformene som KAN spenne over linjer
       (JS-templat, Kotlins rå streng, Javas tekstblokk). Alle andre nullstilles
       ved linjeskift. Uten `"""` her ville en rå Kotlin-streng som inneholder
       `/*` satt fjerneren i kommentarmodus og slukt resten av fila. */
    if (streng !== '`' && streng !== '"""') streng = null;
    const lav = raw.toLowerCase();
    let ren = '';
    for (let j = 0; j < raw.length; j++) {
      /* Inne i et inline-`<script>` gjelder JS-reglene, ikke markupens — og
         forskjellen er ikke akademisk: `<!--` er en LINJEkommentar der, mens
         markup ville kastet alt fram til en `-->` som kanskje aldri kommer. */
      const m = modus === 'html' && iSkript ? 'js' : modus;
      if (iBlokk) { if (raw.startsWith('*/', j)) { iBlokk = false; j++; } continue; }
      if (iHtml) { if (raw.startsWith('-->', j)) { iHtml = false; j += 2; } continue; }
      if (iStartTagg) {
        ren += raw[j];
        if (raw[j] === '>') { iStartTagg = false; iSkript = true; }
        continue;
      }
      if (streng === '"""') {
        /* Javas tekstblokk kan ESKAPERE avslutteren (`\"""`). Skråstreken
           konsumerer derfor tegnet etter seg, ellers ville blokken blitt
           avsluttet for tidlig og teksten under lest som kode — der en `/*`
           straks setter fjerneren i kommentarmodus. Kotlins rå streng har
           ingen eskaping, så der er dette å bli i strengen for lenge — og det
           er den TRYGGE retningen: strenginnhold beholdes, så ingen kode blir
           borte, mens en for tidlig avslutning kan svelge fila. */
        if (raw[j] === '\\') { ren += raw[j]; if (j + 1 < raw.length) { ren += raw[j + 1]; j++; } continue; }
        if (raw.startsWith('"""', j)) { streng = null; ren += '"""'; j += 2; continue; }
        ren += raw[j];
        continue;
      }
      if (streng) {
        ren += raw[j];
        if (raw[j] === '\\') { if (j + 1 < raw.length) { ren += raw[j + 1]; j++; } continue; }
        if (raw[j] === streng) streng = null;
        continue;
      }
      if (modus === 'html' && lav.startsWith('</script', j)) { iSkript = false; }
      else if (modus === 'html' && !iSkript && lav.startsWith('<script', j)) {
        const slutt = raw.indexOf('>', j);
        if (slutt === -1) { ren += raw.slice(j); iStartTagg = true; break; }
        ren += raw.slice(j, slutt + 1); j = slutt; iSkript = true; continue;
      }
      /* Regex-literal: konsumeres i sin helhet, med tegnklasser, slik at
         `/` og `*` inne i det ikke leses som kommentartegn. */
      const etterNokkelord = /(?:^|[^\w$])(?:return|throw|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|break|continue|debugger)\s*$/.test(hale);
      if (m !== 'css' && raw[j] === '/'
        && (!/[\w$)\]]/.test(forrige) || etterNokkelord || (forrige === ')' && lukketBetingelse))
        && !raw.startsWith('//', j) && !raw.startsWith('/*', j)) {
        let k = j + 1, iKlasse = false, lukket = false;
        for (; k < raw.length; k++) {
          if (raw[k] === '\\') { k++; continue; }
          if (iKlasse) { if (raw[k] === ']') iKlasse = false; continue; }
          if (raw[k] === '[') { iKlasse = true; continue; }
          if (raw[k] === '/') { lukket = true; break; }
        }
        if (lukket) {
          ren += raw.slice(j, k + 1); j = k; forrige = '/';
          hale = (hale + '/').slice(-60); lukketBetingelse = false; continue;
        }
      }
      if (raw.startsWith('/*', j)) { iBlokk = true; j++; continue; }
      /* `<!--` betyr to helt forskjellige ting. I markup åpner den en kommentar
         som løper til `-->`; i et klassisk skript er den en LINJEkommentar
         (samme for `-->` i starten av en linje). Behandles JS som markup, ville
         alt fra en `<!--` og ut fila blitt kastet — og skanningen stått grønn
         på tom tekst. */
      if (m === 'html' && raw.startsWith('<!--', j)) { iHtml = true; j += 3; continue; }
      if (m === 'js' && (raw.startsWith('<!--', j) || raw.startsWith('-->', j))) break;
      if (m !== 'css' && raw.startsWith('//', j)) break;   // `//` er IKKE en kommentar i CSS
      /* `"""` sjekkes FØR det enkle anførselstegnet, ellers ville det første av
         de tre startet en vanlig streng som «lukkes» av det andre. */
      if (m === 'js' && raw.startsWith('"""', j)) { streng = '"""'; ren += '"""'; j += 2; continue; }
      if (raw[j] === '"' || raw[j] === "'" || (m !== 'css' && raw[j] === '`')) streng = raw[j];
      ren += raw[j];
      if (raw[j] === '(') { parenteser.push(CTRL.test(hale)); lukketBetingelse = false; }
      else if (raw[j] === ')') { lukketBetingelse = parenteser.length ? parenteser.pop() : false; }
      else if (!/\s/.test(raw[j])) lukketBetingelse = false;
      hale = (hale + raw[j]).slice(-60);
      if (!/\s/.test(raw[j])) forrige = raw[j];
    }
    return { nr: i + 1, l: ren };
  });
}
/* Kommentarsyntaksen følger filtypen, ikke innholdet. */
const modusFor = (navn) => (/\.(html?|svg|xht?ml|xml)$/i.test(navn) ? 'html'
  : /\.css$/i.test(navn) ? 'css' : 'js');
/* Hele fila som én strippet tekst, med posisjon → linjenummer for evidensen.
   Mønstre som kan spenne over linjeskift kjøres mot denne. */
const strippet = (src, modus) => kodeLinjerStreng(src, modus).map((x) => x.l).join('\n');
/* HTML-attributter kan skrive et hvilket som helst tegn som en tegnreferanse:
   `href="https&#58;//x"` er den samme adressen for nettleseren. Referansene
   dekodes derfor før mønstrene kjøres. Ingen av dem inneholder linjeskift, så
   linjenumrene holder. */
/* Tabulator, linjeskift og vognretur FJERNES i stedet for å dekodes:
   URL-parseren stryker dem overalt i en adresse, så `href="https&#x0A;://x"`
   navigerer til `https://x`. Dekodet til et ekte linjeskift ville skjemaet
   vært delt i to og ingen av mønstrene sett det. Det er bare tegn som
   FORSVINNER — linjetellingen kan ikke forskyves av det. */
const URL_USYNLIG = new Set([0x09, 0x0a, 0x0d]);
const tegn = (kode) => (URL_USYNLIG.has(kode) ? '' : String.fromCodePoint(kode));
const dekodEntiteter = (t) => t
  /* Semikolon er VALGFRITT: nettleseren dekoder `&#58//x` like godt som
     `&#58;//x`, så mønstrene må se det samme. */
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => tegn(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => tegn(parseInt(d, 10)))
  .replace(/&(Tab|NewLine);/g, '')
  /* `bsol` er skråstreken den andre veien, og teller like mye: HTML-parseren
     gjør `&bsol;&bsol;vert` til `\\vert`, som URL-parseren normaliserer til
     `//vert`. Uten den her ville den protokoll-relative sjekken sett på
     entitetene i stedet for tegnene. */
  .replace(/&(colon|sol|bsol|period|lpar|rpar|quot|apos|amp);/gi,
    (_, n) => ({ colon: ':', sol: '/', bsol: '\\', period: '.', lpar: '(', rpar: ')', quot: '"', apos: "'", amp: '&' })[n.toLowerCase()]);
function strippetMedLinjer(src, modus) {
  const tekst = modus === 'html' ? dekodEntiteter(strippet(src, modus)) : strippet(src, modus);
  return { tekst, linjeFor: (idx) => tekst.slice(0, idx).split('\n').length };
}

/* Overtar skallet WebViewClient-en eller `shouldOverrideUrlLoading`, er det
   ikke lenger Capacitors ruting som gjelder, og regelen over er ikke lenger
   den som kjører. Da skal endringen være bevisst — og innom dokumentet.

   HELE den native kildekoden leses, ikke bare MainActivity: en hjelpeklasse
   som kalles derfra (`Navigation.install(bridge)`) kompileres og kjører like
   fullt, og kunne byttet ut rutingen uten at en sjekk på én fil så det. Alle
   source set-ene under `android/app/src` teller — `debug/` og `release/`
   kompileres inn i hver sin variant — men ikke `test/` og `androidTest/`, som
   aldri havner i APK-en.

   Mønsteret dekker to måter, ikke én. Å bytte ut KLIENTEN
   (`setWebViewClient`, `shouldOverrideUrlLoading`) flytter selve avgjørelsen
   bort fra Capacitor. Å navigere WebView-en DIREKTE fra Java (`loadUrl`,
   `postUrl`, `loadData…`) hopper over avgjørelsen: en app-initiert lasting
   spør ikke `shouldOverrideUrlLoading` i det hele tatt, så en fremmed side
   ville havnet inne i appen.

   Kilden leses STRENGBEVISST (se kodeLinjerStreng under), ikke med kode():
   den kapper linja ved første `//`, også inne i en streng, og
   `String u = "https://x"; webView.loadUrl(u);` ville da mistet kallet. Java
   har de samme kommentarformene som JS, så den samme funksjonen holder. */
const NATIV_SRC = path.join(ROOT, 'android', 'app', 'src');
function javaFiler(dir, rot) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    /* Bare source set-RØTTENE `src/test` og `src/androidTest` hoppes over. En
       pakkekatalog som tilfeldigvis heter `test` under `src/main` kompileres
       inn i appen som alt annet, og skal skannes. */
    if (d.isDirectory()) return rot && /^(test|androidTest)$/.test(d.name) ? [] : javaFiler(p, false);
    return /\.(java|kt)$/.test(d.name) ? [p] : [];
  });
}
/* Lastemetodene fanges i TO former. Kallet er den vanlige (`webView.loadUrl(u)`),
   men en metodereferanse — `Consumer<String> gå = webView::loadUrl;` i Java,
   `webView::loadUrl` i Kotlin — laster siden like direkte når den kalles, og
   har ingen parentes på stedet der navnet står. */
/* `webViewClient` med liten w er Kotlins EGENSKAPSform av den samme setteren:
   `webView.webViewClient = klient` kompilerer til `setWebViewClient(…)`, men
   inneholder verken metodenavnet eller typenavnet med stor forbokstav.
   Navnene matches derfor uavhengig av forbokstav. */
const LAST_API = 'loadUrl|postUrl|loadData(?:WithBaseURL)?';
const RUTING = new RegExp('shouldOverrideUrlLoading|[sS]etWebViewClient|[sS]etWebChromeClient'
  + '|[wW]ebViewClient|[wW]ebChromeClient'
  /* Kotlin lar identifikatorer eskaperes med backtick — `webView.`+'`loadUrl`'+`(u)`
     kaller nøyaktig det samme API-et. Backtickene godtas derfor rundt navnet,
     både i kallet og i metodereferansen.

     Punktum er IKKE med i klassen foran. Mottakeren er den vanlige formen
     (`webView.loadUrl(u)`), og et mønster som utelukker den fanger bare det
     ukvalifiserte kallet inne i WebView-klassen selv. Klassen finnes for å
     kreve en ordgrense — `preloadUrl(` skal ikke telle — ikke for å si noe om
     hva som står til venstre for punktumet. */
  + '|(?:^|[^\\w$])`?(?:' + LAST_API + ')`?\\s*\\('
  + '|::\\s*`?(?:' + LAST_API + ')`?\\b');
/* Inventaret er FAST på `android/app/src`, og det holder bare så lenge Gradle
   ikke er fortalt noe annet. `sourceSets { main.java.srcDirs += '../shared' }`
   kompilerer `android/shared/*.java` inn i APK-en uten at én eneste fil under
   `src/` endrer seg — og rutingsjekken ville aldri sett dem.

   Å utlede kataloglista fra Gradle-konfigurasjonen krever å tolke Groovy, og
   ville vært en ny tolk i en vakt. Regelen er derfor at det ikke SKAL finnes
   egendefinerte produksjonskilderøtter: legges det inn en, feiler denne, og den
   som legger den inn må utvide skanningen bevisst. */
/* Ingen ledende ordgrense: Gradle har både `srcDirs += …` og setteren
   `setSrcDirs([...])`, og i den siste står navnet midt inne i et ord.

   Og ALLE byggeskriptene leses, ikke bare app/build.gradle: `apply from:` er
   Gradles egen måte å flytte konfigurasjon ut i en annen fil på (Capacitor
   bruker den fire steder selv), og en kilderot lagt inn DER ville vært like
   virksom. Derfor kreves i tillegg at hver `apply from` peker innenfor
   `android/` — ellers er det et skript skanningen ikke leser. */
const gradleFiler = (function les(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const q = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'build' || d.name === '.gradle' ? [] : les(q);
    return /\.gradle$/.test(d.name) ? [q] : [];
  });
}(path.join(ROOT, 'android')));
/* `srcFile` teller like mye som `srcDirs`. Gradle kan peke MANIFESTET et annet
   sted — `sourceSets { release { manifest.srcFile '…' } }` — og da leser både
   rutingsjekken her og App Links-sjekken i del 13 en fil som ikke er den APK-en
   pakker. Samme regel, samme begrunnelse: overstyringen forbys, så den som
   trenger den må utvide skanningen bevisst. */
const medSrcDirs = gradleFiler
  .filter((q) => /(srcdirs?|srcfile)\b/i.test(strippet(fs.readFileSync(q, 'utf8'), 'js')))
  .map((q) => path.relative(ROOT, q));
check('ingen av byggeskriptene overstyrer kilderøtter eller manifest-sti (skanningen dekker alt som kompileres)',
  gradleFiler.length > 0 && medSrcDirs.length === 0,
  medSrcDirs.join(', ') || gradleFiler.length + ' gradle-filer uten srcDirs/srcFile');
/* applicationId er det statementet navngir. En `applicationIdSuffix` på
   release — eller en flavor som setter en annen id — gir en APK med et annet
   pakkenavn enn `assetlinks.json` peker på, og verifiseringen faller. Én
   erklæring, ingen suffikser. */
const idOverstyring = gradleFiler
  .filter((q) => /applicationIdSuffix|flavorDimensions|productFlavors/.test(strippet(fs.readFileSync(q, 'utf8'), 'js')))
  .map((q) => path.relative(ROOT, q));
check('ingen applicationId-suffiks eller produktvarianter (statementet navngir det APK-en heter)',
  idOverstyring.length === 0 && (kode(appGradle).match(/applicationId\s/g) || []).length === 1,
  idOverstyring.join(', ') || 'én applicationId, ingen suffikser');
const utenfor = gradleFiler.flatMap((q) => [...strippet(fs.readFileSync(q, 'utf8'), 'js')
  .matchAll(/apply\s+from:\s*["']([^"']+)["']/g)]
  .map((m) => path.resolve(path.dirname(q), m[1]))
  .filter((mål) => path.relative(path.join(ROOT, 'android'), mål).startsWith('..'))
  .map((mål) => path.relative(ROOT, q) + ' → ' + path.relative(ROOT, mål)));
check('alle `apply from`-skript ligger under android/ (og blir dermed lest av sjekken over)',
  utenfor.length === 0, utenfor.join(', ') || 'ingen utenfor');
const nativeFiler = javaFiler(NATIV_SRC, true);
const ruter = nativeFiler.filter((p) => RUTING.test(strippet(fs.readFileSync(p, 'utf8'), 'js')));
check('det native skallet overtar ikke og hopper ikke over navigasjonsrutingen',
  nativeFiler.length > 0 && ruter.length === 0,
  ruter.map((p) => path.relative(ROOT, p)).join(', ') || 'ingen av ' + nativeFiler.length + ' native kildefiler');

/* WEB_KILDE er en fast liste, og både sjekkene under og del 9 leser kun den.
   En produksjonsfil utenfor lista ville havnet i `dist/` og kjørt i appen uten
   noen gang å bli skannet, så lista låses fra TO kanter:

     a) alt index.html laster — dekker det vanlige tilfellet, og sier hvilken
        fil som mangler;
     b) alt `build.js` faktisk kopierer ut. Den fanger også en fil ingen
        `<script>`-tagg nevner: `import('./hjelper.js')` på kjøretid, en
        `<script>` bygget i JS, en `importScripts()`. Uansett hvordan den
        lastes MÅ den ligge i repo-roten og bli kopiert, ellers finnes den ikke
        i produksjon.

   Utenfor med vilje: tredjepartskopiene i `vendor/` (låst byte for byte i
   tests/security-headers.test.js) og testmodus-filene, som build.js river ut av
   produksjonsbygget.

   Alle tre attributtformene HTML tillater godtas — doble, enkle og helt uten
   anførselstegn — og `<link>` leses tagg for tagg, slik at rekkefølgen på
   `rel`/`href` heller ikke betyr noe. En gyldig variant skal ikke kunne snike
   en fil forbi skanningen. */
/* Fritaket gjelder de PINNEDE tredjepartskopiene, ikke katalogen `vendor/`.
   En ny `vendor/hjelper.js` ville kjørt i appen uten at noen skanner leste den
   — og det er tests/security-headers.test.js som stenger den døren: den krever
   at index.html laster NØYAKTIG de vendor-filene som står registrert der, hver
   med sin egen sjekksum og sin egen anvisning på hvor bytene kommer fra. En
   uregistrert fil feiler der, ikke her. Navnene leses ut av index.html, så
   lista ikke kan komme i utakt med det som faktisk lastes. */
const utenKunDev = indexHtml.replace(/huskis:kun-dev:start[\s\S]*?huskis:kun-dev:slutt/g, '');
const VENDOR_PINNET = [...utenKunDev.matchAll(/<script\b[^>]*\ssrc=["'](vendor\/[^"']+)["']/gi)]
  .map((m) => m[1]);
const attributt = (tag, navn) => {
  const m = tag.match(new RegExp('\\s' + navn + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i'));
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
};
const lastet = [
  ...[...utenKunDev.matchAll(/<script\b[^>]*>/gi)].map((m) => attributt(m[0], 'src')),
  ...[...utenKunDev.matchAll(/<link\b[^>]*>/gi)]
    .filter((m) => /stylesheet/i.test(attributt(m[0], 'rel') || ''))
    .map((m) => attributt(m[0], 'href')),
].filter((s) => s && VENDOR_PINNET.indexOf(s) === -1);
const uskannet = lastet.filter((s) => WEB_KILDE.indexOf(s) === -1);
check('alle produksjonskildene index.html laster står i WEB_KILDE (og blir dermed skannet)',
  lastet.length > 0 && uskannet.length === 0, uskannet.join(', ') || lastet.join(', '));

/* Samme lås fra byggsiden: SKIP-listen og testmodus-filene leses ut av
   build.js, så de to kan ikke komme i utakt. */
const buildSkip = new Set(((build.match(/const SKIP = new Set\(\[([\s\S]*?)\]\);/) || [, ''])[1]
  .match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
const testModus = ((build.match(/const TEST_MODE_FILES = \[([^\]]*)\]/) || [, ''])[1]
  .match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
const buildSkipExt = new Set(((build.match(/const SKIP_EXT = new Set\(\[([^\]]*)\]\)/) || [, ''])[1]
  .match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
/* build.js kopierer REKURSIVT (copyDir), så en `assets/hjelper.js` ville blitt
   med ut like fullt som en fil i roten. Inventaret går derfor samme vei:
   SKIP-listen gjelder bare øverste nivå, akkurat som i build.js. `vendor/` er
   tredjepartskopien, voktet i tests/security-headers.test.js. */
function utsendteFiler(dir, topp, typer) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    /* Nøyaktig build.js' egen semantikk: SKIP-navnene, utelatte filtyper OG
       testmodus-filene gjelder bare ØVERSTE nivå. En `assets/dev-mock.js`
       kopieres altså ut, og skal derfor skannes. */
    if (topp && (buildSkip.has(d.name) || buildSkipExt.has(path.extname(d.name))
      || testModus.indexOf(d.name) > -1)) return [];
    if (topp && d.name === 'vendor') {
      /* Kun den pinnede bunten hoppes over — resten av katalogen skannes,
         REKURSIVT. build.js kopierer `vendor/` med copyDir som alt annet, så
         en `vendor/sub/hjelper.js` havner i dist og kjører hvis noe importerer
         den. En flat lesing her ville sluppet den forbi begge inventarene. */
      return (function vendorFiler(v, prefiks) {
        return fs.readdirSync(v, { withFileTypes: true }).flatMap((e) => {
          const s = path.join(v, e.name);
          if (e.isDirectory()) return vendorFiler(s, prefiks + e.name + '/');
          if (VENDOR_PINNET.indexOf(prefiks + e.name) > -1) return [];
          return (typer || /\.(html?|[mc]?js|css)$/i).test(e.name) ? [path.relative(ROOT, s)] : [];
        });
      }(path.join(dir, d.name), 'vendor/'));
    }
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return utsendteFiler(p, false, typer);
    /* Filtypene som KAN inneholde en lenke eller en navigasjon. En fontfil
       eller et rasterbilde kopieres også ut, men har ingen kode å skanne. */
    return (typer || /\.(html?|[mc]?js|css)$/i).test(d.name) ? [path.relative(ROOT, p)] : [];
  });
}
const utsendt = utsendteFiler(ROOT, true);
const utsendtUskannet = utsendt.filter((n) => WEB_KILDE.indexOf(n) === -1);
check('alle web-kildefilene build.js kopierer ut står i WEB_KILDE',
  testModus.length > 0 && utsendt.length > 0 && utsendtUskannet.length === 0,
  utsendtUskannet.join(', ') || utsendt.join(', '));


/* Web-siden av regelen. Kjørende kode i ALLE web-kildefilene: kommentarer og
   dokumentasjon får omtale lenker fritt.

   Mønstrene kjøres mot HELE den strippede fila, ikke linje for linje. Et kall
   formatert over to linjer — `el.setAttribute(` og `'href', …)` på neste — har
   ellers verken metode eller attributt på samme linje, og ville sluppet forbi
   alle sammen. `\s` i mønstrene dekker linjeskiftet; treffets posisjon regnes
   om til linjenummer for evidensen.

   To slag av sjekk, med vilje forskjellig strenge:

   a) i MARKUP kreves et skjema, fordi `href` der også brukes helt legitimt
      (`href="favicon.svg"`, `href="#…"`). `geo:`, `sms:`, `intent:` og
      `market:` teller like mye som `https:` — skjemaet listes derfor ikke opp.
      `formaction` er med fordi en knapp med den navigerer når skjemaet sendes,
      og ordgrensen foran `action` ville ellers hoppet over den;
   b) gjennom DOM-API-et flagges destinasjonen UANSETT verdi. Appen setter ikke
      én eneste `href`/`action` fra JS i dag, så regelen kan være absolutt — og
      bare da fanger den `setAttribute('href', enVariabel)`, som ingen
      verdibasert sjekk kan se. `src` er ikke med: et bilde er en ressurs, ikke
      en navigasjon, og styres av CSP-ens `img-src`. */
/* `[\s\x00-\x1f]*` foran adressen, ikke `\s*`: URL-parseren FJERNER alle
   ledende (og etterfølgende) C0-kontrolltegn og mellomrom før den tolker
   adressen, så `href="&#1;https://x"` navigerer til `https://x`. Bare de
   LEDENDE — et kontrolltegn midt i skjemaet blir prosentkodet i stedet, og
   `htt&#1;ps://x` er dermed ingen https-navigasjon. Derfor står klassen her og
   ikke i dekoderen, som bare fjerner de tre tegnene URL-parseren stryker
   overalt (tab, linjeskift, vognretur). */
const MARKUP = '\\b(?:href|(?:form)?action)\\s*=\\s*\\\\?["\']?[\\s\\x00-\\x1f]*';
const UT_MØNSTRE = [
  ['_blank', /target\s*=\s*["']?_blank/gi],
  /* Alle tre skrivemåtene av det samme: `window.open(`, klammenotasjonen
     `window['open'](` og den globale, ukvalifiserte `open(`. Foranstilt
     `[^.\w$]` holder `api.open()` og `step.reopen()` utenfor.

     Den KVALIFISERTE formen krever ingen parentes etter seg. En funksjon som
     åpner et nytt browsing context åpner det like fullt gjennom et mellomledd
     — `const gå = window.open.bind(window)` og senere `gå(adresse)` — og
     kallstedet har da verken `window` eller `open` i seg. Mellomleddet kan
     ikke spores uten å tolke JS, men det MÅ hente funksjonen én gang, og det
     stedet står her. Regelen kan være absolutt fordi appen ikke rører
     `window.open` i det hele tatt: både kallet og referansen er null treff i
     dag. Det bare navnet `open` krever fortsatt parentes — ukvalifisert er det
     et altfor vanlig ord til å flagges som referanse. */
  ['open()', /(?:^|[^.\w$])(?:(?:window|self|globalThis|top|parent)\s*(?:\??\.\s*open|(?:\?\.)?\s*\[\s*["'`]open["'`]\s*\])|open(?:\?\.)?\s*\()/gm],
  /* `setAttributeNS(null, 'href', …)` setter den samme navigerbare
     egenskapen. Navnerom-argumentet står FØRST, så attributtnavnet er andre
     argument — derfor den valgfrie ledeparameteren i mønsteret. */
  /* `target` er med av samme grunn som destinasjonene: `_blank`-mønsteret ser
     bare skrivemåten `target=…`, og `el.setAttribute('target', v)` har ingen
     slik form — verdien kan dessuten være en variabel. Appen setter ingen
     `target` noe sted, så attributtet flagges uansett verdi. */
  ['setAttribute', /(?:\??\.\s*setAttribute(?:NS)?|\[\s*["'`]setAttribute(?:NS)?["'`]\s*\])(?:\?\.)?\s*\(\s*(?:[^,()]*,\s*)?["'`](?:xlink:)?(?:href|(?:form)?action|http-equiv|target)["'`]\s*,/gi],
  ['.href =', /(?:^|[^.\w$])(?!location\b)[\w$\])]+\s*(?:\.\s*(?:href|formAction|action)|\[\s*["'`](?:href|formaction|action)["'`]\s*\])\s*(?:\*\*|<<|>>>?|\|\||&&|\?\?|[-+*/%|&^])?=(?!=)/gim],
  /* `[\t\n\r]*` mellom hvert tegn: URL-parseren stryker de tre tegnene overalt
     i en adresse, så `href="ht\ttps://x"` er den samme utgående lenken. Den
     KODEDE formen (`&#x0A;`) er allerede borte når dekoderen har gått, dette
     dekker den rå. */
  ['skjema i markup', new RegExp(MARKUP + '[a-z](?:[\\t\\n\\r]*[a-z0-9+.\\-])*[\\t\\n\\r]*:', 'gi')],
  /* Protokoll-relativ, med begge skråstrekene. URL-parseren normaliserer
     omvendt skråstrek til vanlig for spesialskjemaer, så `href="\\\\vert"`
     lander på `//vert` — samme utgående lenke. */
  ['protokoll-relativ', new RegExp(MARKUP + '(?:[\\t\\n\\r]*[\\\\/]){2}', 'gi')],
  /* Deklarativ navigasjon uten en eneste lenke: nettleseren drar av gårde selv.
     Huskis har ÉN http-equiv, og det er innholdssikkerhetspolicyen. */
  ['meta refresh', /http-equiv\s*=\s*["']?refresh/gi],
  /* Samme navigasjon, bygget fra JS: `m.httpEquiv = 'refresh'` og
     `m.content = '0;url=…'`, så `append`. Markup-mønsteret over ser bare
     taggen slik den STÅR i fila, og ingen av destinasjonsmønstrene dekker
     `http-equiv`. Som med `href` flagges egenskapen uansett verdi — appen
     setter den ikke ett eneste sted. */
  ['meta refresh (DOM)', /(?:^|[^.\w$])[\w$\])]+\s*(?:\.\s*httpEquiv|\[\s*["'`]http-?equiv["'`]\s*\])\s*(?:\*\*|<<|>>>?|\|\||&&|\?\?|[-+*/%|&^])?=(?!=)/gim],
  /* Vendor-API-er som NAVIGERER for oss. supabase-js sender nettleseren til
     leverandøren med `location.assign()` inne i biblioteket, så kallstedet
     her har ingen navigasjon å se — men appen forlater WebView-en like fullt.
     Huskis bruker e-post + passord og ingen av disse i dag
     (docs/domains-and-urls.md); tas OAuth i bruk, er det en beslutning som
     hører hjemme i det dokumentet, ikke en stille tilføyelse.

     Lista er lest UT AV den innsjekkede bunten, ikke gjettet: hvert
     `skipBrowserRedirect`-sted i vendor/supabase-js-2.111.0.js står rett ved en
     `window.location.assign(…)`, og de offentlige inngangene som havner der er
     `signInWithOAuth`, `signInWithSSO`, `linkIdentity`, `linkIdentityOAuth` og
     samtykkeflytens `approveAuthorization`/`denyAuthorization`. Oppgraderes
     buntten, er det her lista skal etterprøves på nytt. */
  ['vendor-API som navigerer', /\??\.\s*(?:signInWithOAuth|signInWithSSO|linkIdentity|linkIdentityOAuth|approveAuthorization|denyAuthorization)(?:\?\.)?\s*\(/g],
  /* Destinasjonen satt som OBJEKTNØKKEL, ikke med likhetstegn:
     `Object.assign(a, { href: adresse })` skriver den samme egenskapen, men
     står som `href:` og går klar av både tilordnings- og markup-mønstrene.
     Nøkkelformen finnes ikke i noen kildefil i dag, så regelen kan være
     absolutt — og den gjelder alle filtyper, siden `href:` heller ikke er
     gyldig markup. `action` er ikke med: det er et vanlig variabelnavn. */
  ['destinasjon som objektnøkkel', /\b(?:href|formAction|httpEquiv)\s*:/g],
];
/* Markup BYGGET i JS er en helt egen vei til en lenke: `el.innerHTML = '<a
   href="' + adresse + '">'` lager en ekte utgående lenke, men har verken et
   skjema rett etter `href="` (der står en apostrof og en variabel) eller noen
   `.href`-tilordning å se. Mønstrene over ser derfor ingenting.

   Skanningen kan ikke flagge `innerHTML` i seg selv — app.js bruker den 74
   steder til vanlig innhold. Men den kan flagge ANKERET: `<a` og `href=` finnes
   ikke i én eneste JS-kildefil i dag (det eneste `href`-treffet er
   fokus-selektoren `a[href]`, uten likhetstegn). Regelen kan derfor være
   absolutt, og den fanger enhver `innerHTML`/`outerHTML`/`insertAdjacentHTML`/
   `document.write` som bygger en lenke — uansett hvor adressen kommer fra.

   Kun JS-filer: i `index.html` er `href=` helt legitimt, og der gjelder
   markup-mønstrene med krav om skjema i stedet.

   GRENSEN, og den er ekte: en lenke satt sammen av biter
   (`'<' + 'a hr' + 'ef="' + adresse + '">'`) har ingen av tokenene i behold.
   Jeg skrev tidligere her at URL-sjekken under ville tatt den — det stemmer
   IKKE når adressen er `canonicalAppUrl`, som nettopp er tillatt der. En
   tekstvakt kan alltid omgås av en ny oppdeling, og å jage det videre er å
   skrive en JS-tolk.

   Derfor er svaret et ANNET slag net, ikke et finere mønster:
   `tests/external-links.test.js` laster appen i en ekte nettleser og ser i det
   FERDIGE DOM-et etter destinasjoner utenfor eget origin. Der spiller
   stavemåten ingen rolle — en `<a href>` er en `<a href>` når nettleseren har
   tolket den. De to nettene dekker hver sin svakhet: dette fanger en lenke som
   ikke er rendret ennå, det andre fanger enhver skrivemåte. */
const JS_MARKUP = [
  ['lenke bygget i JS', /<a[\s>/]|\bhref\s*=/gi],
];
/* JS_MARKUP gjelder JS-KODE, ikke filtypen. Et inline-`<script>` i index.html
   er JS like fullt, og `el.innerHTML = '<a href="' + adresse + '">'` der ville
   gått klar av alt: markup-mønstrene ser en apostrof i stedet for et skjema, og
   filtypen er html. Skriptområdene skjæres derfor ut og skannes for seg, med
   posisjonen i fila beholdt så linjenummeret i evidensen stemmer. */
function jsOmråder(tekst, modus) {
  if (modus === 'js') return [{ del: tekst, fra: 0 }];
  if (modus !== 'html') return [];
  return [...tekst.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script/gi)]
    .map((m) => ({ del: m[1], fra: m.index + m[0].indexOf(m[1]) }));
}
/* DEN ENE VEIEN UT, og bare den. Appen har fått ÉN utgående handling: en lenke
   i et notat kan åpnes (docs/domains-and-urls.md, «Lenker i notater»). Da må
   adressen forlate appen ett sted, og `open()` kan ikke lenger være forbudt
   uansett form.

   Unntaket er derfor knyttet til STEDET, ikke til et mønster: én forekomst, i
   app.js, skrevet nøyaktig slik, med den normaliserte variabelen som argument.
   En annen fil, en annen skrivemåte, en forekomst til — alt feller testen som
   før. `_blank` som ATTRIBUTT er fortsatt forbudt overalt: det er markup, og
   den er det nettleseren følger selv.

   Og unntaket er en PÅSTAND, ikke en unnskyldning. Sjekkene rett under krever
   at det faktisk ble brukt, at kallet står inne i `openExternalUrl`, og at den
   funksjonen normaliserer gjennom `safeNoteUrl` FØRST. En vakt som bare kan
   frita, uten å kreve, ville stått grønn den dagen åpningen forsvant ut av
   koden. */
const ÅPNE_FIL = 'app.js';
const ÅPNE_FORM = "window.open(url, '_blank', 'noopener')";
/* DET ENE ANKERET, og det ankrer ingenting i Huskis. «Kopier alt» legger
   notatet på utklippstavlen som `text/html`, slik at Word, Outlook og Google
   Docs får lenkene med seg (docs/notater-plan.md, «Utklippstavlen»). Strengen
   går RETT til utklippstavlen: den settes aldri inn i appens eget DOM, og
   `tests/external-links.test.js` beviser fra den andre kanten at DOM-et
   fortsatt er uten `<a href>` — også etter en kopiering.

   Fritaket er knyttet til STEDET, som `window.open`-fritaket over: én
   forekomst, i app.js, inne i `noteHtmlAnchor()`. Mønsteret treffer formen to
   ganger (`<a ` og `href=`), så begge posisjonene godtas — treffet på `href=`
   begynner tre tegn ute i formen. Og fritaket er en PÅSTAND: sjekkene under
   krever at formen finnes, at den står i den funksjonen, og at adressen har
   vært gjennom `safeNoteUrl` FØRST. */
const ANKER_FIL = 'app.js';
const ANKER_FORM = '<a href="';
const erAnkeret = (tekst, i) =>
  tekst.startsWith(ANKER_FORM, i) || tekst.startsWith(ANKER_FORM, i - 3);
/* Treffet begynner PÅ formen når mønsteret matchet linjestart, ellers på tegnet
   foran den — `open()`-mønsteret spiser ett ledetegn. Begge posisjonene godtas,
   så en omformatering ikke gjør fritaket til en gåte. */
const erÅpningen = (tekst, i) =>
  tekst.startsWith(ÅPNE_FORM, i) || tekst.startsWith(ÅPNE_FORM, i + 1);
const utLenker = [];
let åpneFritatt = 0;
let ankerFritatt = 0;
for (const f of WEB_KILDE) {
  const { tekst, linjeFor } = strippetMedLinjer(les(f), modusFor(f));
  for (const [navn, re] of UT_MØNSTRE) {
    re.lastIndex = 0;
    for (const m of tekst.matchAll(re)) {
      if (navn === 'open()' && f === ÅPNE_FIL && erÅpningen(tekst, m.index)) { åpneFritatt++; continue; }
      utLenker.push(f + ':' + linjeFor(m.index) + ' (' + navn + ')');
    }
  }
  for (const { del, fra } of jsOmråder(tekst, modusFor(f))) {
    for (const [navn, re] of JS_MARKUP) {
      re.lastIndex = 0;
      for (const m of del.matchAll(re)) {
        if (f === ANKER_FIL && erAnkeret(del, m.index)) { ankerFritatt++; continue; }
        utLenker.push(f + ':' + linjeFor(fra + m.index) + ' (' + navn + ')');
      }
    }
  }
}
check('web-kildekoden produserer ingen utgående lenke (ingen _blank, DOM-satt destinasjon, meta refresh eller href/action med skjema)',
  utLenker.length === 0, utLenker.join(', ') || 'ingen');
check('nøyaktig ÉN `window.open` i hele web-kilden, og den står i ' + ÅPNE_FIL,
  åpneFritatt === 1, åpneFritatt + ' forekomst(er) på den fritatte formen');

/* Stedet, ikke bare tallet: kallet må ligge inne i `openExternalUrl`, og
   adressen må ha vært gjennom `safeNoteUrl` før den brukes. Uten dette kunne
   den ene tillatte forekomsten flyttes hvor som helst i app.js og åpne hva som
   helst. Avstanden holdes kort med vilje — funksjonen er ti linjer. */
const åpneKode = strippet(les(ÅPNE_FIL), 'js');
const iFn = åpneKode.indexOf('function openExternalUrl(');
/* Søket starter i funksjonen: `safeNoteUrl(raw)` er også dens EGEN signatur
   lenger opp i fila, og et rått indexOf ville truffet definisjonen i stedet
   for bruken. */
const iSafe = iFn < 0 ? -1 : åpneKode.indexOf('safeNoteUrl(raw)', iFn);
const iOpen = åpneKode.indexOf(ÅPNE_FORM);
check('åpningen ligger i openExternalUrl, og adressen normaliseres av safeNoteUrl først',
  iFn > -1 && iSafe > iFn && iOpen > iSafe && iOpen - iFn < 1200,
  'openExternalUrl@' + iFn + ' safeNoteUrl@' + iSafe + ' open@' + iOpen);

/* Det samme kravet til ankeret. Mønsteret treffer formen to ganger, så to
   fritak er nøyaktig ÉN forekomst — og den skal ligge i `noteHtmlAnchor`, med
   adressen normalisert først. Avstanden holdes kort: funksjonen er fire
   linjer. */
const ankerKode = strippet(les(ANKER_FIL), 'js');
const iAnkerFn = ankerKode.indexOf('function noteHtmlAnchor(');
const iAnkerSafe = iAnkerFn < 0 ? -1 : ankerKode.indexOf('safeNoteUrl(url)', iAnkerFn);
const iAnker = ankerKode.indexOf(ANKER_FORM);
check('nøyaktig ÉTT anker i hele web-kilden, og det står i ' + ANKER_FIL,
  ankerFritatt === 2, (ankerFritatt / 2) + ' forekomst(er) på den fritatte formen');
check('ankeret ligger i noteHtmlAnchor, og adressen normaliseres av safeNoteUrl først',
  iAnkerFn > -1 && iAnkerSafe > iAnkerFn && iAnker > iAnkerSafe && iAnker - iAnkerFn < 400,
  'noteHtmlAnchor@' + iAnkerFn + ' safeNoteUrl@' + iAnkerSafe + ' anker@' + iAnker);

/* VAKT FOR VAKTEN. Alle sjekkene over hviler på at kommentarfjerneren faktisk
   etterlater koden. Hver feil den har hatt — `<!--` lest som markup i JS, `//`
   inne i en URL, `/*` inne i et regex-literal — har samme signatur: teksten
   BLIR TOM fra et punkt og ut, og mønstrene finner selvsagt ingenting. Da står
   sjekkene grønne på ingenting, som er verre enn å ikke ha dem.

   Kanariet er derfor uavhengig av hvilken feil det er: koden må fortsatt være
   der. Slutter en fil å ha kjørende kode nær slutten, har fjerneren spist noe
   den ikke skulle. */
/* Den NATIVE kilden går gjennom den samme fjerneren, og hadde nøyaktig samme
   svakhet: en rå Kotlin-streng eller Java-tekstblokk med `/*` i seg slukte
   resten av fila, og rutingsjekken sto grønn på tom tekst. Kanariet dekker
   derfor begge kildesettene. */
const svelget = [];
for (const [navn, kilde, modus] of [
  ...WEB_KILDE.map((f) => [f, les(f), modusFor(f)]),
  ...nativeFiler.map((p) => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8'), 'js']),
]) {
  const L = kodeLinjerStreng(kilde, modus);
  const sisteKode = L.length - 1 - [...L].reverse().findIndex((x) => x.l.trim());
  const andel = L.filter((x) => x.l.trim()).length / L.length;
  if (L.length - sisteKode > 5 || andel < 0.15) {
    svelget.push(navn + ' (siste kode på linje ' + (sisteKode + 1) + ' av ' + L.length
      + ', ' + Math.round(andel * 100) + '% kodelinjer)');
  }
}
check('kommentarfjerneren spiser ikke kode — hver fil har kjørende kode helt ut',
  svelget.length === 0,
  svelget.join('; ') || (WEB_KILDE.length + nativeFiler.length) + ' filer intakte');

/* Ryggraden bak alle formene over: hvilke FREMMEDE adresser frontend i det
   hele tatt navngir. Et tekstsøk kan aldri se en adresse som kommer inn som en
   variabel, men det kan holde lista over hardkodede adresser på nøyaktig de to
   dokumentet lover — og da må enhver ny utgående adresse, uansett hvilken
   API-form den brukes gjennom, innom denne sjekken først.

   Verdiene UTLEDES av config.js, så et bytte av Supabase-prosjekt eller
   kanonisk domene ikke feller testen. CSP-ens egne verter står i et flerlinjes
   attributt og dekkes av tests/security-headers.test.js. */
const cfgTekst = les('config.js');
const TILLATTE_URL = [
  (cfgTekst.match(/url:\s*'([^']+)'/) || [, ''])[1],
  (cfgTekst.match(/canonicalAppUrl:\s*'([^']+)'/) || [, ''])[1],
].filter(Boolean).flatMap((u) => [u.replace(/\/+$/, ''), u.replace(/\/+$/, '') + '/']);
const fremmedeUrl = [];
for (const f of WEB_KILDE) {
  for (const { nr, l } of kodeLinjerStreng(les(f), modusFor(f))) {
    for (const m of l.matchAll(/["'`][\x00-\x1f]*(https?:\/\/[^"'`\s]*)/gi)) {
      if (TILLATTE_URL.indexOf(m[1]) === -1) fremmedeUrl.push(f + ':' + nr + ' → ' + m[1]);
    }
  }
}
check('kjørende webkode navngir ingen andre absolutte adresser enn Supabase-endepunktet og det kanoniske originet',
  TILLATTE_URL.length === 4 && fremmedeUrl.length === 0,
  fremmedeUrl.join(', ') || 'tillatt: ' + TILLATTE_URL.join(', '));

/* Appen navigerer seg selv nøyaktig ett sted, og det er guarden for kanonisk
   origin. Kommer det et sted til, kan appen sende seg selv ut av sine egne
   innebygde filer — og i WebView-en ville den navigasjonen dessuten blitt en
   ACTION_VIEW, altså en app som blir stående igjen på siden sin mens
   browseren åpner. `location.reload()` er ikke med: den går til den samme
   adressen, og dekkes av tests/auto-update.test.js. Lesing av
   `location.href`/`location.origin` er heller ikke navigasjon.

   Alle formene teller, ikke bare `location.href = …`: en tilordning rett til
   Location-objektet (`location = …`, `document.location = …`) navigerer like
   fullt, og ville dessuten gått klar av lenkesjekken over. Foranstilt
   `[^.\w$]` holder `elem.location = …` og lignende egenskaper utenfor, og den
   valgfrie `.href`-halen gjør at `redirectUrlFor(location.href)` — en LESING —
   ikke telles.

   `=(?!=)` og ikke `=[^=]`: en tilordning som brekker linja rett etter
   likhetstegnet («location.href =» + adressen på neste linje) har ingenting
   ETTER `=` å matche på, og ville sluppet unna. Lookahead-en skiller den
   likevel fra `==`/`===`. */
/* `location.assign/replace`, KLAMMENOTASJONEN av de samme
   (`location['assign'](…)`), og den moderne Navigation API-en
   (`navigation.navigate(…)`) — alle tre navigerer dokumentet. */
/* Klammenotasjonen gjelder BEGGE ledd, ikke bare metoden: `location['assign']`
   var dekket, men `window['location']['assign']` ikke — selve Location-objektet
   kan hentes like godt med klammer. Holderen navngis her fordi et bart
   `x['location']` er en hvilken som helst egenskap, ikke nødvendigvis
   dokumentets. */
const HOLDER = '(?:window|document|self|globalThis|top|parent)';
const LOC_OBJ = '(?:\\blocation|' + HOLDER + '\\s*(?:\\?\\.)?\\s*\\[\\s*["\'`]location["\'`]\\s*\\])';
/* Ingen avsluttende parentes i noen av de to: som med `window.open` navigerer
   en referanse like mye som et kall. `const gå = location.assign.bind(location)`
   har ingen `(` etter `assign`, men `gå(adresse)` laster siden. Referansen må
   hentes ett sted, og det stedet fanges her. Appen har null av begge former, så
   kravet kan være absolutt — det ene navigasjonsstedet som SKAL finnes er
   `location.replace(target)`, og det treffes av kall-formen uansett. */
const NAV_KALL = new RegExp(
  LOC_OBJ + '\\s*(?:\\??\\.\\s*(?:assign|replace)|(?:\\?\\.)?\\s*\\[\\s*["\'`](?:assign|replace)["\'`]\\s*\\])'
  + '|(?:^|[^.\\w$])(?:' + HOLDER + '\\s*(?:\\??\\.\\s*navigation|(?:\\?\\.)?\\s*\\[\\s*["\'`]navigation["\'`]\\s*\\])|navigation)\\s*'
  + '(?:\\??\\.\\s*navigate|(?:\\?\\.)?\\s*\\[\\s*["\'`]navigate["\'`]\\s*\\])', 'gm');
/* Ikke bare `.href`: HVER skrivbar del av Location navigerer. Setter du
   `location.host`, `.protocol`, `.pathname` eller `.search`, laster siden på
   nytt mot en ny adresse — like mye en navigasjon som å sette hele href-en.
   `.hash` er med selv om den er same-document: den er også et sted appen
   flytter seg selv, og det finnes ingen i dag. */
const LOC_DEL = 'href|host|hostname|protocol|port|pathname|search|hash';
/* Også SAMMENSATT tilordning: `location.search += '&x=1'` kaller setteren og
   navigerer like fullt. `=(?!=)` alene godtok bare den bare formen. */
const TILDEL = '(?:\\*\\*|<<|>>>?|\\|\\||&&|\\?\\?|[-+*/%|&^])?=(?!=)';
const NAV_TILDEL = new RegExp(
  '(?:^|[^.\\w$])(?:' + HOLDER + '\\s*(?:\\??\\.\\s*location|(?:\\?\\.)?\\s*\\[\\s*["\'`]location["\'`]\\s*\\])|location)\\s*'
  + '(?:(?:\\.\\s*(?:' + LOC_DEL + ')|\\[\\s*["\'`](?:' + LOC_DEL + ')["\'`]\\s*\\])\\s*)?' + TILDEL, 'gm');
/* Som lenkesjekkene: mot HELE den strippede fila. Et uttrykk som brekker foran
   egenskapen — `location` på én linje, `.assign(…)` på neste — har ellers ikke
   begge delene på samme linje. */
const navSkriv = [];
for (const f of WEB_KILDE) {
  const { tekst, linjeFor } = strippetMedLinjer(les(f), modusFor(f));
  for (const re of [NAV_KALL, NAV_TILDEL]) {
    re.lastIndex = 0;
    for (const m of tekst.matchAll(re)) {
      const nr = linjeFor(m.index);
      navSkriv.push({ sted: f + ':' + nr, l: (tekst.split('\n')[nr - 1] || '').trim() });
    }
  }
}
/* ---- Det som FAKTISK pakkes ----

   Alt over leser repoets kildefiler. Men det er `dist/` Capacitor kopierer inn
   i APK-en, og `build.js` transformerer på veien: den stempler build-ID,
   river ut testmodus-blokken, og kunne i prinsippet lagt inn hva som helst.
   En lenke som oppstår i byggesteget ville aldri vist seg i kilden.

   Derfor kjøres en ekte build, og utfallet skannes med NØYAKTIG de samme
   mønstrene. `vendor/` er utenfor: den er tredjepartskoden, byte for byte
   verifisert i tests/security-headers.test.js, og den har sine egne
   `window.open`-forekomster som ikke er Huskis' lenker. */
const byggUt = spawnSync('node', ['build.js'], { cwd: ROOT, encoding: 'utf8' });
check('node build.js kjører (grunnlaget for skanningen av dist/)', byggUt.status === 0,
  (byggUt.stderr || '').trim().slice(0, 120) || 'ok');
function distFiler(dir, topp) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    /* Fritaket gjelder `dist/vendor/` og ingenting annet — samme avgrensning
       som inventaret over. En generert `dist/assets/vendor/hjelper.js` er ikke
       den innsjekkede tredjepartskopien, og skal skannes som all annen kode
       som havner i APK-en. */
    if (topp && d.name === 'vendor') {
      /* Rekursivt, av samme grunn som i utsendteFiler: `dist/vendor/sub/` er
         kopiert ut og kjørbar, og bare den PINNEDE bunten er unntatt. */
      return (function vendorFiler(v, prefiks) {
        return fs.readdirSync(v, { withFileTypes: true }).flatMap((e) => {
          const s = path.join(v, e.name);
          if (e.isDirectory()) return vendorFiler(s, prefiks + e.name + '/');
          if (VENDOR_PINNET.indexOf(prefiks + e.name) > -1) return [];
          return /\.(html?|[mc]?js|css|svg|xht?ml|xml)$/i.test(e.name) ? [s] : [];
        });
      }(path.join(dir, d.name), 'vendor/'));
    }
    const q = path.join(dir, d.name);
    return d.isDirectory() ? distFiler(q, false)
      : /\.(html?|[mc]?js|css|svg|xht?ml|xml)$/i.test(d.name) ? [q] : [];
  });
}
const DIST = path.join(ROOT, 'dist');
const distTreff = [];
let distAntall = 0;
let guardFritatt = false;
let distÅpne = 0;
let distAnker = 0;
if (byggUt.status === 0 && fs.existsSync(DIST)) {
  for (const q of distFiler(DIST, true)) {
    distAntall++;
    const rel = path.relative(ROOT, q);
    const { tekst, linjeFor } = strippetMedLinjer(fs.readFileSync(q, 'utf8'), modusFor(q));
    for (const [navn, re] of UT_MØNSTRE) {
      re.lastIndex = 0;
      for (const m of tekst.matchAll(re)) {
        /* Den ene tillatte åpningen skal OGSÅ overleve byggesteget, og bare
           den: fritaket gjelder per treff, i dist/app.js, på nøyaktig samme
           form som i kilden — og telles, så en injisert forekomst nummer to
           felles her. */
        if (navn === 'open()' && rel === path.join('dist', ÅPNE_FIL) && erÅpningen(tekst, m.index)) {
          distÅpne++; continue;
        }
        distTreff.push(rel + ':' + linjeFor(m.index) + ' (' + navn + ')');
      }
    }
    for (const { del, fra } of jsOmråder(tekst, modusFor(q))) {
      for (const [navn, re] of JS_MARKUP) {
        re.lastIndex = 0;
        for (const m of del.matchAll(re)) {
          // Ankeret skal OGSÅ overleve byggesteget, og bare det: fritaket
          // gjelder per treff, i dist/app.js, på nøyaktig samme form.
          if (rel === path.join('dist', ANKER_FIL) && erAnkeret(del, m.index)) { distAnker++; continue; }
          distTreff.push(rel + ':' + linjeFor(fra + m.index) + ' (' + navn + ')');
        }
      }
    }
    for (const m of tekst.matchAll(/["'`][\x00-\x1f]*(https?:\/\/[^"'`\s]*)/gi)) {
      /* `xmlns="http://www.w3.org/2000/svg"` er en NAVNEROMSIDENTIFIKATOR, ikke
         en adresse: den hentes aldri og navigeres aldri til. Uten dette ville
         enhver SVG blitt flagget for sin egen navneromserklæring. */
      if (/xmlns(?::[\w-]+)?\s*=\s*$/i.test(tekst.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (TILLATTE_URL.indexOf(m[1]) === -1) distTreff.push(rel + ' → ' + m[1]);
    }
    /* Også navigasjonsmønstrene: byggesteget kunne like gjerne lagt inn en
       `location.assign(…)` som en `<a>`.

       Guardens ene egne navigasjon er ventet i dist, og fritas — men per
       TREFF, ikke per linje. Fritas hele linja, ville en ekstra navigasjon
       lagt inntil den (`{ location.replace(target); location.assign(target); }`)
       blitt fritatt på kjøpet. Selve treffet må altså BEGYNNE på guardens
       form, og bare det første. */
    for (const re of [NAV_KALL, NAV_TILDEL]) {
      re.lastIndex = 0;
      for (const m of tekst.matchAll(re)) {
        const etter = tekst.slice(m.index, m.index + 40);
          /* Fritaket gjelder ÉN gang, i dist/index.html — ikke én gang per fil.
           Ellers ville en injisert `location.replace(target)` i dist/app.js
           fått sitt eget fritak. */
        if (!guardFritatt && rel === path.join('dist', 'index.html')
          && /location\.replace\(\s*target\s*\)/.test(etter)) { guardFritatt = true; continue; }
        distTreff.push(rel + ':' + linjeFor(m.index) + ' (navigasjon) ' + etter.split('\n')[0].trim());
      }
    }
  }
}
/* SVG er ikke bare et bilde. Lastet som et `\u003cimg\u003e` er den inert, men navigeres
   den til direkte — `href="ikon.svg"`, samme origin, altså INNE i appen — blir
   den et aktivt dokument, og en `\u003ca href="https://…"\u003e` inni er klikkbar. Derfor
   skannes SVG/XML som markup, med de samme mønstrene, både i kilden og i
   `dist/`. De står ikke i WEB_KILDE (det er lista over kjørende kode), så de
   får sin egen runde her. */
const svgKilder = utsendteFiler(ROOT, true, /\.(svg|xht?ml|xml)$/i);
const svgTreff = [];
for (const f of svgKilder) {
  const { tekst, linjeFor } = strippetMedLinjer(les(f), 'html');
  for (const [navn, re] of UT_MØNSTRE) {
    re.lastIndex = 0;
    for (const m of tekst.matchAll(re)) svgTreff.push(f + ':' + linjeFor(m.index) + ' (' + navn + ')');
  }
}
check('SVG/XML som kan navigeres til har ingen utgående lenke',
  svgTreff.length === 0, svgTreff.join(', ') || svgKilder.join(', ') || 'ingen slike filer');

check('den BYGDE dist/ har ingen utgående lenke heller (byggesteget legger ingen inn)',
  byggUt.status === 0 && distAntall > 0 && distTreff.length === 0,
  distTreff.join(', ') || distAntall + ' filer skannet');
check('den ene tillatte åpningen overlevde byggesteget — og fikk ingen selskap',
  byggUt.status === 0 && distÅpne === 1, distÅpne + ' i dist/' + ÅPNE_FIL);
check('det ene tillatte ankeret overlevde byggesteget — og fikk ingen selskap',
  byggUt.status === 0 && distAnker === 2, (distAnker / 2) + ' i dist/' + ANKER_FIL);
/* Fritaket er en PÅSTAND, ikke bare en unnskyldning. Sjekken over feller det
   uventede, men ville stått grønn også hvis guarden FORSVANT ut av bygget —
   ingen treff er ingen treff. Kildesjekkene under ser fortsatt originalen, så
   ingenting annet i suiten hadde sagt fra om `stampHtml()` en dag skrev om
   eller mistet redirecten. Den ene ventede navigasjonen må altså finnes. */
check('guardens navigasjon overlevde byggesteget (fritaket ble faktisk brukt)',
  byggUt.status === 0 && guardFritatt,
  guardFritatt ? 'location.replace(target) funnet i dist/index.html'
    : 'ikke funnet — er den fjernet eller omskrevet av build.js?');

/* Det APK-en faktisk pakker er ikke `dist/`, men kopien `cap sync` la i
   `android/app/src/main/assets/public`. De to er normalt like — men denne
   testen kjører selv `node build.js`, som river og bygger `dist/` på nytt, så
   etter en sync er den skannede `dist/` en ANNEN build enn den som ble
   kopiert (build-ID-en alene gjør dem observerbart forskjellige). Finnes
   kopien, skannes derfor DEN, med nøyaktig de samme mønstrene. I et rent
   utsjekk finnes den ikke, og da er dist-skanningen over det nærmeste vi
   kommer; APK-workflowen er stedet begge deler finnes. */
const SYNKET = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');
const synketTreff = [];
let synketAntall = 0;
let synketGuard = false;
let synketÅpne = 0;
if (fs.existsSync(SYNKET)) {
  for (const q of distFiler(SYNKET, true)) {
    synketAntall++;
    const rel = path.relative(ROOT, q);
    const { tekst, linjeFor } = strippetMedLinjer(fs.readFileSync(q, 'utf8'), modusFor(q));
    for (const [navn, re] of UT_MØNSTRE) {
      re.lastIndex = 0;
      for (const m of tekst.matchAll(re)) {
        if (navn === 'open()' && rel === path.join(path.relative(ROOT, SYNKET), ÅPNE_FIL)
          && erÅpningen(tekst, m.index)) { synketÅpne++; continue; }
        synketTreff.push(rel + ':' + linjeFor(m.index) + ' (' + navn + ')');
      }
    }
    for (const { del, fra } of jsOmråder(tekst, modusFor(q))) {
      for (const [navn, re] of JS_MARKUP) {
        re.lastIndex = 0;
        for (const m of del.matchAll(re)) synketTreff.push(rel + ':' + linjeFor(fra + m.index) + ' (' + navn + ')');
      }
    }
    /* Og adressesjekken. Den manglet her, og det er nettopp den som fanger en
       lenke satt sammen av strengbiter: `'<' + 'a hr' + 'ef="https://…"'` har
       ingen av tokenene UT_MØNSTRE og JS_MARKUP ser etter, men adressen står
       der hel. Uten den var den KOPIERTE builden — den APK-en faktisk pakker —
       skannet svakere enn `dist/`, som testen bygger på nytt selv. */
    for (const m of tekst.matchAll(/["'`][\x00-\x1f]*(https?:\/\/[^"'`\s]*)/gi)) {
      if (/xmlns(?::[\w-]+)?\s*=\s*$/i.test(tekst.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (TILLATTE_URL.indexOf(m[1]) === -1) synketTreff.push(rel + ' → ' + m[1]);
    }
    /* Og NAVIGASJONSmønstrene — de manglet her, så en `location.assign(…)` i
       den kopierte builden var usynlig selv om dist-skanningen ville tatt den.
       Guardens ene egne navigasjon fritas på samme måte som i dist. */
    for (const re of [NAV_KALL, NAV_TILDEL]) {
      re.lastIndex = 0;
      for (const m of tekst.matchAll(re)) {
        const etter = tekst.slice(m.index, m.index + 40);
        if (!synketGuard && rel === path.join('android', 'app', 'src', 'main', 'assets', 'public', 'index.html')
          && /location\.replace\(\s*target\s*\)/.test(etter)) { synketGuard = true; continue; }
        synketTreff.push(rel + ':' + linjeFor(m.index) + ' (navigasjon) ' + etter.split('\n')[0].trim());
      }
    }
  }
  check('web-assetene cap sync KOPIERTE inn i APK-en har ingen utgående lenke',
    synketAntall > 0 && synketTreff.length === 0,
    synketTreff.join(', ') || synketAntall + ' filer skannet');
  check('… og nøyaktig ÉN tillatt åpning i den kopierte builden',
    synketÅpne === 1, synketÅpne + ' i den synkede ' + ÅPNE_FIL);

  /* Sterkere enn å skanne kopien med de samme mønstrene: å BEVISE at kopien er
     bygget. `build.js` kopierer hver fil uendret og rører bare to av dem —
     index.html (build-ID + `?b=`) og den genererte version.json. Alt annet i
     APK-en skal derfor være byte for byte kilden i repoet.

     Da trenger ingen skrivemåte å gjenkjennes. En lenke satt sammen av
     strengbiter, en endret vendor-bunt, hva som helst injisert i den PAKKEDE
     builden er en byte-forskjell — mønstrene over kan omgås, dette kan ikke.
     Det er også det eneste som faktisk etterprøver vendor-fritaket: skanningen
     hopper over den pinnede bunten på NAVN, med den begrunnelsen at den er
     byte for byte det npm publiserte, og her måles det.

     Filer UTEN kilde i repoet felles IKKE: Capacitor legger selv runtime-filer
     i den kopierte katalogen (`cordova.js`, `cordova_plugins.js` …). De dekkes
     av mønsterskanningen over, som før — en ukjent fil skal ikke gi rød CI bare
     for å være Capacitors egen. */
  const GENERERT = new Set(['index.html', 'version.json']);
  const avvik = [];
  let sammenlignet = 0;
  const alleSynkede = (function les(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? les(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  }(SYNKET));
  for (const q of alleSynkede) {
    const rel = path.relative(SYNKET, q);
    if (GENERERT.has(rel)) continue;
    const kilde = path.join(ROOT, rel);
    if (!fs.existsSync(kilde)) continue;
    sammenlignet++;
    if (!fs.readFileSync(q).equals(fs.readFileSync(kilde))) avvik.push(rel);
  }
  /* index.html sammenlignes mot build.js' EGEN stempling, med BEGGE ID-ene
     lest ut av den pakkede fila. `keep` prøves begge veier: en preview-deploy
     beholder testmodusen, en produksjonsbuild river den ut. */
  const synketHtml = path.join(SYNKET, 'index.html');
  let pakketRelease = null;
  if (fs.existsSync(synketHtml)) {
    const pakket = fs.readFileSync(synketHtml, 'utf8');
    const id = (pakket.match(/<meta\s+name="huskis-build"\s+content="([^"]*)"/) || [, null])[1];
    pakketRelease = (pakket.match(/<meta\s+name="huskis-release"\s+content="([^"]*)"/) || [, null])[1];
    const { stampHtml } = require(path.join(ROOT, 'build.js'));
    sammenlignet++;
    const passer = id !== null && pakketRelease !== null && [false, true].some((keep) => {
      try { return stampHtml(indexHtml, { buildId: id, releaseId: pakketRelease }, keep) === pakket; }
      catch (e) { return false; }
    });
    if (!passer) avvik.push('index.html (er ikke stampHtml(kilden, "' + id + '"/"' + pakketRelease + '"))');
  }
  check('de synkede web-assetene er byte for byte kildene (index.html modulo build- og release-ID)',
    sammenlignet > 0 && avvik.length === 0,
    avvik.join(', ') || sammenlignet + ' filer identiske med kilden');

  /* Fase 4 (docs/mobilapp-plan.md): APK-en skal kunne rapportere den SAMME
     release-identiteten som web. Kjeden er `node build.js` → `dist/` →
     `cap sync`, så det som må holde her er at kopien faktisk bærer identiteten
     videre, i klienten OG i den innebygde `/version.json` — de to stedene den
     leses fra. Build-ID-ene er derimot forskjellige med vilje: det er to
     builds av samme release. */
  const synketVersjon = path.join(SYNKET, 'version.json');
  if (fs.existsSync(synketVersjon) && pakketRelease !== null) {
    const v = JSON.parse(fs.readFileSync(synketVersjon, 'utf8'));
    check('den innebygde version.json bærer release-ID-en',
      'releaseId' in v && (v.releaseId === null || /^[0-9a-f]{12}$/.test(v.releaseId)),
      String(v.releaseId));
    check('klienten og den innebygde version.json melder samme release',
      pakketRelease === (v.releaseId || 'dev'), pakketRelease + ' / ' + String(v.releaseId));
  }
} else {
  console.log('(hopper over de synkede web-assetene — kjør `npm run sync:android` først)');
}

check('web-kildekoden navigerer seg selv på nøyaktig ÉN linje',
  navSkriv.length === 1, navSkriv.map((x) => x.sted).join(', ') || 'ingen');
check('den ene linjen er guardens location.replace(target) i index.html',
  navSkriv.length === 1
    && navSkriv[0].sted.startsWith('index.html:')
    && /location\.replace\(target\)/.test(navSkriv[0].l),
  navSkriv.length === 1 ? navSkriv[0].sted + '  ' + navSkriv[0].l : 'mangler');

/* ---- 13. Auth-/e-postlenker: App Links innføres i to halvdeler, eller ingen ----

   Kartleggingen står i docs/domains-and-urls.md («Auth-lenkene i e-post»): de
   tre Supabase Auth-e-postene lenker til prosjektets egen verify-adresse på
   `*.supabase.co`, og `huskis.no` er bare der 303-en LANDER. Et intent-filter
   for `huskis.no` ser derfor ikke én eneste av dem, og App Links er utsatt til
   fase 6, der signeringsnøkkelen finnes (docs/mobilapp-plan.md).

   Det som voktes her er derfor ikke at App Links mangler, men at halvdelene
   aldri kommer i UTAKT. En App Link er én mekanisme spredt over to systemer:

     • manifestet: et `<intent-filter>` med en `http(s)`-`<data>`-vert;
     • originet:   `https://huskis.no/.well-known/assetlinks.json`, som må
       navngi den samme `applicationId`-en og signeringsnøkkelens SHA-256.

   Feilmodusen når bare den ene finnes er STILL: Android verifiserer ingenting,
   lenken åpner browseren nøyaktig som før, og ingen logg, ingen build og ingen
   test sier fra — det ses bare ved å trykke på en lenke på en telefon. Det er
   den samme lærdommen som systemfeltene i fase 3: koden er ikke fasit for hva
   enheten gjør, så det som KAN voktes herfra må voktes.

   Og en tredje halvdel som er lett å overse: fila må faktisk bli PUBLISERT.
   `build.js` hopper over hvert navn som starter med punktum (`copyDir`), så en
   `.well-known/`-katalog i repoet havner i dag ikke i `dist/` i det hele tatt.
   Statementet ville blitt liggende i repoet mens `huskis.no` svarte 404 — igjen
   uten at noe sa fra. Den dagen halvdelene innføres, må `build.js` slippe
   katalogen gjennom i samme endring; sjekken under er stedet det oppdages. */
const STATEMENT = path.join('.well-known', 'assetlinks.json');
/* Manifestene i RELEASE-varianten, ikke bare `main` og ikke alle. Gradle slår
   sammen source set-ene: et filter lagt i `src/release/AndroidManifest.xml` —
   en nærliggende plassering nettopp når fase 6 innfører release-signering —
   havner i den bygde appen uten at `main` endrer seg, så `main` alene er for
   lite.

   Men `debug/` er for MYE, og på en måte som gjør vakten uriktig i begge
   retninger: source set-ene er gjensidig utelukkende, så et filter som bare
   står i `src/debug/` er ALDRI med i det som publiseres. Talte det med, ville
   et debug-filter kunnet «parre seg» med et publisert statement og gjøre
   koblingen grønn for en release som ikke har noe filter. Utelatt derimot —
   som her — ser koblingen riktig at statementet står alene. `debug/` hører
   altså i samme bås som `test/` og `androidTest/`: ikke produksjon.

   Et filter som kommer fra en AVHENGIGHET kan ikke leses herfra, men
   avhengighetene er selv låst — del 7 låser BÅDE npm-plugin-lista og appmodulens
   `implementation`-liste, så et bibliotek som kunne bidra med et filter må innom
   en sjekk først. Grensen er ekte: manifestet INNE i en AAR kan ikke leses fra
   repoet, så det som er låst er hvilke biblioteker som finnes — ikke hva hvert
   av dem erklærer. */
/* En ALLELISTE, ikke en nektliste. Med «alt unntatt debug/test/androidTest»
   ville et hvilket som helst nytt source set — en `staging`-buildtype, en
   produktvariant — blitt talt med i release-varianten uten å være det. Kun
   `main` og `release` er publisert; alt annet må erklæres bevisst.

   Og lista over KJENTE source set-er voktes for seg: dukker det opp et navn
   ingen har tatt stilling til, feiler sjekken under i stedet for at innholdet
   stilltiende ignoreres. Samme grep som «ingen egendefinerte kilderøtter» i
   del 12 — vakten tolker ikke Gradle, den krever at ingen utvider den uten å
   si fra. */
const RELEASE_SETT = new Set(['main', 'release']);
const KJENTE_SETT = new Set([...RELEASE_SETT, 'debug', 'test', 'androidTest']);
const sourceSett = fs.readdirSync(NATIV_SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);
const ukjenteSett = sourceSett.filter((n) => !KJENTE_SETT.has(n));
check('bare kjente source set-er under android/app/src (et nytt må tas stilling til)',
  ukjenteSett.length === 0, ukjenteSett.join(', ') || sourceSett.join(', '));
const iRelease = (p) => RELEASE_SETT.has(path.relative(NATIV_SRC, p).split(path.sep)[0]);
/* NØYAKTIG Gradles standardsti, ikke et rekursivt søk. Et source set konsumerer
   bare `src/<sett>/AndroidManifest.xml`; en ubrukt kopi under
   `src/main/arkiv/AndroidManifest.xml` er ingenting for byggingen, men et
   rekursivt søk ville talt den — og latt den parre seg med et publisert
   statement. Stien kan låses slik nettopp fordi overstyring av manifest-stien
   er forbudt i del 12 (`srcFile`). */
const manifestFiler = [...RELEASE_SETT]
  .map((sett) => path.join(NATIV_SRC, sett, 'AndroidManifest.xml'))
  .filter((p) => fs.existsSync(p));
/* Manifestene leses som TEKST, ikke slås sammen. Gradles manifest-merger har
   sine egne direktiver (`tools:node="removeAll"`, `tools:remove`,
   `tools:replace`), og med dem kan et overlay fjerne eller bytte ut et filter
   som står i `main` — da lyver teksten om hva APK-en inneholder. Å tolke dem
   her ville vært å skrive en merger inne i en vakt, på samme måte som å tolke
   Groovy ville vært det i del 12. Samme svar som der: direktivene FORBYS i
   stedet, så en som trenger dem må utvide vakten bevisst. Selve sammenslåingen
   skjer i APK-workflowen, som er stedet en merget manifest finnes. */
/* Prefikset `tools:` er bare en KONVENSJON. XML lar hvilket som helst navn
   bindes til navnerommet (`xmlns:m="http://schemas.android.com/tools"` og så
   `m:node="remove"`), og et mønster som bare kjenner det vanlige prefikset
   ville sett rett forbi. Prefiksene leses derfor ut av bindingene i hver fil,
   med `tools` som standard hvis ingen binding finnes. */
const MERGER_ATTR = '(?:node|remove|removeAll|replace|strict|overrideLibrary|selector)\\b';
const TOOLS_NS = 'http://schemas.android.com/tools';
function mergerDirektiv(tekst) {
  const prefikser = new Set(['tools']);
  for (const m of tekst.matchAll(/xmlns:([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if ((m[2] !== undefined ? m[2] : m[3]) === TOOLS_NS) prefikser.add(m[1]);
  }
  return [...prefikser].some((p) =>
    new RegExp('(?:^|[^\\w.-])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':' + MERGER_ATTR).test(tekst));
}
/* ÉN dokumentert unntak, og den er en ALLELISTE på nøyaktig én tekst:
   varselpluginen erklærer SCHEDULE_EXACT_ALARM i sitt eget manifest, og Huskis
   trekker den tilbake fordi appen ikke bruker eksakte alarmer
   (docs/varsler.md). Unntaket rører ingen komponent og intet intent-filter —
   det er nettopp DET forbudet over finnes for — så det klippes ut av teksten
   før den leses, og kreves samtidig å stå der. Faller unntaket bort, feiler
   sjekken under; kommer det et direktiv til, feiler den over. */
const TILLATT_DIREKTIV =
  /<uses-permission\s+android:name="android\.permission\.SCHEDULE_EXACT_ALARM"\s+tools:node="remove"\s*\/>/;
const raaManifest = (p) => utenXmlKommentarer(fs.readFileSync(p, 'utf8'));
const hovedManifest = path.join(NATIV_SRC, 'main', 'AndroidManifest.xml');
check('SCHEDULE_EXACT_ALARM trekkes tilbake fra varselpluginens manifest (appen bruker upresise alarmer)',
  fs.existsSync(hovedManifest) && TILLATT_DIREKTIV.test(raaManifest(hovedManifest)));
const medDirektiv = manifestFiler
  .filter((p) => mergerDirektiv(raaManifest(p).replace(TILLATT_DIREKTIV, '')))
  .map((p) => path.relative(ROOT, p));
check('ingen andre merger-direktiver i produksjonsmanifestene (teksten er da det APK-en får)',
  medDirektiv.length === 0,
  medDirektiv.join(', ') || manifestFiler.length + ' manifest uten andre tools:-direktiver');
/* Hvilken KOMPONENT filteret sitter på avgjør om lenken i det hele tatt når
   Huskis. Et komplett filter på en annen aktivitet, en `activity-alias`, en
   receiver eller en service tilfredsstiller hver eneste sjekk under uten at
   WebView-en noen gang ser adressen. Filtrene bæres derfor med eieren sin. */
/* `(?<!\/)>` er ikke pynt: en SELVLUKKENDE `<activity … />` har ingen
   `</activity>`, og uten lookbehind ville mønsteret startet der og slukt fram
   til den NESTE komponentens sluttagg — filteret i den ville da blitt tilskrevet
   feil eier. Med lookbehind hopper mønsteret over den selvlukkende taggen og
   finner riktig komponent. */
/* `activity-alias` MÅ stå først. Alternasjonen prøves i rekkefølge, og etter
   «activity» kommer en bindestrek — et ikke-ordtegn, så `\b` slår til. En
   `<activity-alias>` ble dermed lest som en `activity` som løp helt til den
   NESTE aktivitetens sluttagg: aliaset fikk feil type og ble avvist, og
   blokken slukte alt imellom. */
const KOMPONENT_TAG = 'activity-alias|activity|service|receiver|provider';
const KOMPONENT = new RegExp('<(' + KOMPONENT_TAG + ')\\b[^>]*(?<!/)>[\\s\\S]*?</\\1>', 'g');
/* Og den selvlukkende formen finnes fortsatt — den bærer bare attributter, ikke
   filtre. Den må leses, for `android:exported` kan være erklært nettopp der
   (et overlay som bare setter et attributt). */
const KOMPONENT_TOM = new RegExp('<(' + KOMPONENT_TAG + ')\\b[^>]*/>', 'g');
/* `.MainActivity` og `no.huskis.app.MainActivity` er SAMME komponent for
   Gradle: et navn som starter med punktum — eller ikke inneholder ett — er
   relativt til pakken. Uten normalisering ville et overlay som bruker den
   fullkvalifiserte formen fått sin egen rad i attributt-tabellen, og `exported`
   fra `main` ville ikke blitt arvet. Navnene kanoniseres derfor før de
   sammenlignes eller slås sammen. */
const kanoniskKomp = (n) => (n == null ? null
  : n.startsWith('.') ? cfg.appId + n
    : n.indexOf('.') === -1 ? cfg.appId + '.' + n : n);
/* `<application>`-attributtene slås sammen på tvers av manifestene FØR de arves
   ned. `android:permission` og `android:enabled` der gjelder hver komponent som
   ikke setter sitt eget — og Gradle merger de to `<application>`-taggene til én,
   så en `permission` erklært i `main` gjelder også et alias som først dukker opp
   i `release`. Leses hver fil for seg, ville aliaset fått `null` og sluppet
   forbi. */
const manifestTekster = manifestFiler.map((p) => ({
  p, tekst: xmlNormalisert(utenXmlKommentarer(fs.readFileSync(p, 'utf8'))),
}));
const appAttrFelles = (navn) => {
  for (const { tekst } of manifestTekster) {
    const tagg = (tekst.match(/<application\b[^>]*>/) || [''])[0];
    const m = tagg.match(new RegExp(navn + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')'));
    const v = m ? m.slice(1).find((x) => x !== undefined) : null;
    if (v != null) return v;
  }
  return null;
};
const appTillatelse = appAttrFelles('android:permission');
const appAktivert = appAttrFelles('android:enabled');
const komponenter = manifestTekster.flatMap(({ p, tekst }) => {
  const fil = path.relative(ROOT, p);
  return [...tekst.matchAll(KOMPONENT), ...tekst.matchAll(KOMPONENT_TOM)].map((k) => {
    /* Attributtene leses av ÅPNINGSTAGGEN alene. Leste vi hele blokken, ville
       en komponent uten `android:name` fått navnet til den første `<action>`
       inni seg — altså feil eier på filteret. */
    const åpning = (k[0].match(/^<[^>]*>/) || [''])[0];
    const attributt = (navn) => {
      const m = åpning.match(new RegExp(navn + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')'));
      return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
    };
    return {
      fil,
      type: k[1],
      navn: kanoniskKomp(attributt('android:name') || '(uten navn)'),
      /* En `activity-alias` ER ikke aktiviteten; den PEKER på den med
         `android:targetActivity`. Sammenlignes aliasets eget navn med
         MainActivity, avvises en helt gyldig plassering. */
      mål: kanoniskKomp(attributt('android:targetActivity')),
      eksportert: attributt('android:exported'),
      /* En komponent med `android:enabled="false"` er utelatt fra
         intent-oppslag. Filteret ville sett komplett ut her og aldri blitt
         truffet på telefonen. */
      aktivert: attributt('android:enabled') != null ? attributt('android:enabled') : appAktivert,
      /* Komponentens egen overstyrer `<application>`s. */
      tillatelse: attributt('android:permission') != null
        ? attributt('android:permission') : appTillatelse,
      /* Samme lookbehind som på komponenten, og av samme grunn: et TOMT filter
         (`<intent-filter android:autoVerify="true" />`) har ingen sluttagg, og
         uten den ville mønsteret slått det sammen med det NESTE filteret til én
         blokk. Da kunne `autoVerify` kommet fra det tomme og
         `VIEW`/kategoriene/`data` fra det andre — grønt her, to separate og
         uverifiserte filtre på telefonen. */
      filtre: k[0].match(/<intent-filter\b[^>]*(?<!\/)>[\s\S]*?<\/intent-filter>/g) || [],
    };
  });
});
/* Attributtene SLÅS SAMMEN per komponentnavn, ikke leses per fil. Et overlay
   som legger et filter på `.MainActivity` uten å gjenta `android:exported`
   arver verdien fra `main` når Gradle merger — å kreve at hvert overlay
   duplikerer den ville felt en helt gyldig release og blokkert nettopp den
   plasseringen inventaret over åpner for. Første eksplisitte erklæring vinner;
   den kan bare stå ett sted uten at merger-direktiver er i bruk, og de er
   forbudt av sjekken over. */
const komponentAttr = new Map();
for (const k of komponenter) {
  const før = komponentAttr.get(k.navn) || {};
  komponentAttr.set(k.navn, {
    eksportert: før.eksportert != null ? før.eksportert : k.eksportert,
    aktivert: før.aktivert != null ? før.aktivert : k.aktivert,
    tillatelse: før.tillatelse != null ? før.tillatelse : k.tillatelse,
  });
}
const intentFiltre = komponenter.flatMap((k) => k.filtre.map((blokk) => ({
  fil: k.fil,
  type: k.type,
  komponent: k.navn,
  peker: k.mål,
  eksportert: (komponentAttr.get(k.navn) || {}).eksportert,
  aktivert: (komponentAttr.get(k.navn) || {}).aktivert,
  tillatelse: (komponentAttr.get(k.navn) || {}).tillatelse,
  blokk,
})));
/* XML tillater BEGGE anførselstegn: `android:scheme='https'` er nøyaktig like
   gyldig som den doble formen Capacitor selv genererer, og Android pakker den
   like fullt. Et mønster som bare kjenner den ene skrivemåten ville sett et
   aktivt filter som fravær — altså igjen grønt på noe som finnes. Attributtene
   leses derfor uavhengig av anførselstegn. */
const xmlAttr = (navn, verdi) => new RegExp(navn + '\\s*=\\s*(?:"' + verdi + '"|\'' + verdi + '\')');
const xmlVerdier = (blokk, navn) =>
  [...blokk.matchAll(new RegExp(navn + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'g'))]
    .map((m) => (m[1] !== undefined ? m[1] : m[2]));
/* En plassholder (`android:scheme="${linkScheme}"`) fylles først av Gradle, så
   TEKSTEN her sier ingenting om hva APK-en inneholder — filteret ville sett ut
   som fravær. Å slå opp `manifestPlaceholders` ville vært å tolke Gradle igjen;
   svaret er det samme som for merger-direktivene: plassholdere i de
   URL-relevante attributtene forbys. */
const URL_ATTR = 'scheme|host|port|path|pathPrefix|pathPattern|pathAdvancedPattern|pathSuffix|mimeType';
const medPlassholder = intentFiltre.filter(({ blokk }) =>
  new RegExp('android:(?:' + URL_ATTR + ')\\s*=\\s*(?:"[^"]*\\$\\{|\'[^\']*\\$\\{)').test(blokk));
check('ingen manifest-plassholdere i URL-attributtene (teksten er da det APK-en får)',
  medPlassholder.length === 0,
  medPlassholder.map((f) => f.fil + ' / ' + f.komponent).join(', ') || intentFiltre.length + ' filtre uten ${…}');
const nettFiltre = intentFiltre.filter(({ blokk }) =>
  xmlAttr('<data\\b[^>]*android:scheme', 'https?').test(blokk));
const harFilter = nettFiltre.length > 0;
const filterSteder = [...new Set(nettFiltre.map((f) => f.fil))].join(', ');
const harStatement = finnes(STATEMENT);
check('App Links: manifestet og assetlinks.json innføres SAMMEN — eller ingen av dem',
  harFilter === harStatement,
  harFilter === harStatement
    ? (harFilter ? nettFiltre.length + ' http(s)-intent-filter + ' + STATEMENT
      : 'ingen av halvdelene — App Links er ikke innført (docs/mobilapp-plan.md, fase 3)')
    : (harFilter ? nettFiltre.length + ' http(s)-intent-filter, men ingen ' + STATEMENT
      : STATEMENT + ' finnes, men manifestet har ikke noe http(s)-intent-filter'));
/* Verten i statementet og verten i filteret er den samme ene: det kanoniske
   originet. Verdien utledes av config.js, som alt annet her. */
const kanoniskVert = (function () {
  try { return new URL(TILLATTE_URL[2] || '').host; } catch (e) { return ''; }
}());
if (harFilter) {
  /* Uten `autoVerify` er filteret ingen App Link, men en vanlig
     lenkehåndterer: Android spør brukeren i stedet for å verifisere mot
     originet, og assetlinks.json blir aldri lest. */
  check('App Links: hvert http(s)-intent-filter ber om verifisering (autoVerify)',
    nettFiltre.every(({ blokk }) => xmlAttr('android:autoVerify', 'true').test(blokk)),
    nettFiltre.length + ' filtre i ' + filterSteder);
  /* Verten kreves PER FILTER, ikke som en samlet liste. Et `<data>` uten
     `android:host` matcher hvilken som helst vert, og en samlet sjekk ville
     latt et slikt filter passere så lenge et ANNET filter i manifestet
     tilfeldigvis navnga `huskis.no`. Da hadde appen gjort krav på vilkårlige
     https-adresser — det motsatte av regelen. */
  const vertAvvik = nettFiltre
    .map((f) => ({ f, verter: xmlVerdier(f.blokk, 'android:host') }))
    .filter(({ verter }) => verter.length === 0 || !verter.every((h) => h === kanoniskVert));
  check('App Links: HVERT http(s)-filter navngir kun det kanoniske originets vert',
    kanoniskVert !== '' && vertAvvik.length === 0,
    vertAvvik.length
      ? vertAvvik.map(({ f, verter }) => f.fil + ': ' + (verter.join('/') || 'ingen android:host')).join(', ')
      : kanoniskVert + ' i alle ' + nettFiltre.length + ' filtre');
  /* Koblingen over spør bare om det FINNES et http(s)-filter — med vilje, for
     et `http`-only filter er like mye en halv innføring som et fullt. Men et
     filter kan også være halvt i seg selv, og da ruter Android ingenting:
     mangler `VIEW`, `DEFAULT` eller `BROWSABLE` blir intenten fra browseren
     aldri levert, og et `http`-only filter dekker ikke `https`-lenkene
     dokumentet handler om. Alle fire delene må stå i det SAMME filteret — et
     `BROWSABLE` i én blokk hjelper ikke en annen. */
  const KOMPLETT = [
    ['android.intent.action.VIEW', xmlAttr('<action\\b[^>]*android:name', 'android\\.intent\\.action\\.VIEW')],
    ['category.DEFAULT', xmlAttr('<category\\b[^>]*android:name', 'android\\.intent\\.category\\.DEFAULT')],
    ['category.BROWSABLE', xmlAttr('<category\\b[^>]*android:name', 'android\\.intent\\.category\\.BROWSABLE')],
    ['scheme https', xmlAttr('<data\\b[^>]*android:scheme', 'https')],
  ];
  const komplette = nettFiltre.filter(({ blokk }) => KOMPLETT.every(([, re]) => re.test(blokk)));
  check('App Links: minst ett filter er komplett (VIEW + DEFAULT + BROWSABLE + https)',
    komplette.length > 0,
    komplette.length > 0 ? komplette.length + ' av ' + nettFiltre.length + ' filtre er komplette'
      : 'ingen komplette; beste filter mangler: ' + KOMPLETT
        .filter(([, re]) => !nettFiltre.some(({ blokk }) => re.test(blokk))).map(([n]) => n).join(', '));
  /* Og det komplette filteret må sitte på AKTIVITETEN som viser Huskis. Et
     filter på en annen komponent kan ikke levere adressen til WebView-en —
     appen ville gjort krav på lenken og så ikke hatt noe sted å gjøre av den. */
  /* TYPEN teller like mye som navnet. En `<receiver>` eller `<service>` kan
     hete `.MainActivity` uten å være en aktivitet, og Android løser aldri en
     browsable VIEW-intent til en slik komponent — filteret ville sett riktig ut
     her og vært dødt på telefonen. */
  const MAIN = cfg.appId + '.MainActivity';
  const erMain = (f) => (f.type === 'activity-alias'
    ? f.peker === MAIN
    : f.type === 'activity' && f.komponent === MAIN);
  const påMain = komplette.filter(erMain);
  check('App Links: det komplette filteret sitter på MainActivity (der WebView-en er)',
    påMain.length > 0,
    påMain.length > 0 ? påMain.length + ' filter på ' + påMain[0].komponent
      : 'komplette filtre kun på: ' + [...new Set(komplette.map((f) => '<' + f.type + '> ' + f.komponent))].join(', '));
  /* En aktivitet som ikke er eksportert kan ikke startes utenfra — og en App
     Link kommer nettopp utenfra, fra browseren eller e-postklienten. Med
     `android:exported="false"` er manifestet fullt gyldig og lar seg bygge,
     mens hver eneste lenke blir liggende i browseren. */
  check('App Links: MainActivity er eksportert (ellers kan ingen browser starte den)',
    påMain.length > 0 && påMain.every((f) => f.eksportert === 'true'),
    påMain.map((f) => f.komponent + ': android:exported=' + JSON.stringify(f.eksportert)).join(', ') || 'ingen');
  check('App Links: komponenten er ikke låst bak en tillatelse (browseren har den ikke)',
    påMain.length > 0 && påMain.every((f) => f.tillatelse == null),
    påMain.map((f) => f.komponent + ': android:permission=' + JSON.stringify(f.tillatelse)).join(', ') || 'ingen');
  /* Bare utelatt eller en literal `true` godtas. En ressurs
     (`@bool/app_links_enabled`) eller en plassholder resolveres av byggingen,
     ikke av teksten — og kan like gjerne bli `false` i release. */
  /* For en `activity-alias` teller BEGGE: Android krever at både aliaset og
     aktiviteten det peker på er påslått. Et alias som står riktig foran en
     avslått MainActivity kan ikke startes. */
  const påslått = (v) => v == null || v === 'true';
  const målAktivert = (f) => (f.type === 'activity-alias'
    ? (komponentAttr.get(f.peker) || {}).aktivert : null);
  check('App Links: komponenten er påslått (android:enabled utelatt eller literal true)',
    påMain.length > 0 && påMain.every((f) => påslått(f.aktivert) && påslått(målAktivert(f))),
    påMain.map((f) => f.komponent + ': android:enabled=' + JSON.stringify(f.aktivert)
      + (f.type === 'activity-alias' ? ' → ' + f.peker + '=' + JSON.stringify(målAktivert(f)) : ''))
      .join(', ') || 'ingen');
  /* STIEN teller også. Et filter kan begrenses med `android:pathPrefix="/auth"`
     og er da fortsatt «komplett» etter sjekken over — men det matcher ikke
     adressene Huskis faktisk får: delingsinvitasjonen er `/?signup=<e-post>`
     og varselets fotnote er `/`, begge med stien `/` (spørrestrengen er ikke
     med i Androids sti-matching). Minst ett kvalifiserende filter må derfor
     enten stå UTEN sti-begrensning eller eksplisitt dekke roten. Trengs en
     smalere sti en dag, er det en beslutning som hører hjemme i
     docs/domains-and-urls.md — ikke en stille innsnevring her. */
  const STI_ATTR = ['android:path', 'android:pathPrefix', 'android:pathPattern',
    'android:pathAdvancedPattern', 'android:pathSuffix'];
  /* Typen beholdes, ikke bare verdien. Et EKSAKT `android:path=""` matcher ikke
     `https://huskis.no/`, hvis sti er `/` — bare `path="/"` og `pathPrefix="/"`
     dekker roten. Å godta den tomme strengen uansett attributt var min egen
     slurv, og ville sluppet et filter som lar lenken bli i browseren. */
  const stiPar = (blokk) => STI_ATTR.flatMap((a) => xmlVerdier(blokk, a).map((v) => [a, v]));
  const stiene = (blokk) => stiPar(blokk).map(([, v]) => v);
  const dekkerRot = (blokk) => {
    const par = stiPar(blokk);
    return par.length === 0
      || par.some(([a, v]) => (a === 'android:path' || a === 'android:pathPrefix') && v === '/');
  };
  /* PORTEN er den samme fellen som stien: `android:port="8443"` binder filteret
     til én port, og `https://huskis.no/` (port 443, underforstått) treffer det
     ikke. Kravet gjelder samme filter som dekker roten. */
  /* Fra Android 15 kan et filter ha `<uri-relative-filter-group android:allow="false">`
     som EKSKLUDERER stier fra det ytre scheme/host-filteret. En flat lesing av
     stiattributtene ville sett `/` der og trodd roten var dekket — mens den
     nettopp er unntatt. Semantikken modelleres ikke; et filter med en slik
     gruppe teller rett og slett ikke som rot-kandidat. */
  const harEkskludering = (blokk) =>
    /<uri-relative-filter-group\b[^>]*android:allow\s*=\s*(?:"false"|'false')/.test(blokk);
  const rotFiltre = påMain.filter((f) => {
    if (harEkskludering(f.blokk)) return false;
    return dekkerRot(f.blokk)
      && xmlVerdier(f.blokk, 'android:port').length === 0
      /* `android:mimeType` gjør filteret AVHENGIG av en MIME-type, og en
         App Link-VIEW bærer bare URI-en — den treffer da ikke. */
      && xmlVerdier(f.blokk, 'android:mimeType').length === 0;
  });
  check('App Links: minst ett kvalifiserende filter dekker roten, uten sti-, port- eller MIME-begrensning',
    påMain.length > 0 && rotFiltre.length > 0,
    rotFiltre.length > 0 ? rotFiltre.length + ' filter uten innsnevring'
      : 'begrenset til sti ' + (påMain.flatMap((f) => stiene(f.blokk)).join('/') || '—')
        + ', port ' + (påMain.flatMap((f) => xmlVerdier(f.blokk, 'android:port')).join('/') || '—')
        + ', mimeType ' + (påMain.flatMap((f) => xmlVerdier(f.blokk, 'android:mimeType')).join('/') || '—'));
  /* Et filter er heller ikke nok i seg selv: det bringer bare intenten til
     aktiviteten. NOEN må lese adressen ut av den og gi den til web-laget.
     `@capacitor/android` tar vare på den (`Bridge.getIntentUri()`) og varsler
     plugins ved `onNewIntent`, men ingen kjerneplugin leser den — uten
     `@capacitor/app` eller egen native kode åpner App Link-en bare Huskis på
     startsiden sin, og HELE adressen forsvinner.

     Det er et TAP mot i dag, ikke bare en uteblitt gevinst: delingsinvitasjonen
     lenker til `/?signup=<e-post>`, og `applySignupInvite()` i app.js leser den
     verdien fra `location.search`. Fanger appen lenken uten å videreformidle
     URI-en, mister en invitert bruker registreringsflyten sin — noe browseren
     håndterer riktig i dag.

     At `@capacitor/app` STÅR i package.json er ikke bevis: pluginen kopierer
     ikke adressen inn i WebView-en av seg selv, den fyrer en `appUrlOpen` som
     noen må lytte på og rute videre. Derfor kreves bruken, ikke pakken — enten
     lytteren i web-koden (som da også må gjennom gaten i del 9) eller native
     kode som leser intent-URI-en selv.

     Formen kreves, ikke bare navnet: en REGISTRERT lytter
     (`addListener('appUrlOpen', …)`) i web-koden, eller native kode som faktisk
     HENTER adressen — enten Capacitors `getIntentUri()` eller Androids egne
     `intent.getData()`/`getDataString()`, som en egen implementasjon like gjerne
     kan bruke. Et bart `onNewIntent`-overstyr teller ikke: det kan slippe
     intenten på gulvet uten å lese den.

     GRENSEN, og den er ekte: at lytteren finnes beviser IKKE at adressen rutes
     riktig — at `?signup=` havner der `applySignupInvite()` leser den. Det kan
     ingen tekstvakt avgjøre uten å tolke koden, og det er samme grense som del
     12 allerede har skrevet ned for lenker satt sammen av strengbiter. Denne
     sjekken sier at noen har tatt et bevisst steg; om steget virker, avgjøres
     på en telefon — den fysiske runden i fase 6.

     Og leseren må ligge i den varianten som PUBLISERES. `nativeFiler` (del 12)
     dekker med vilje alle source set-ene, men en `getIntentUri()` som bare
     finnes under `src/debug/java` kompileres ikke inn i release-APK-en — den
     ville altså «bevist» en lesing den utgitte appen ikke har. Samme
     avgrensning som manifestene: `debug/` er ikke produksjon. */
  const webKode = WEB_KILDE.map((f) => strippet(les(f), modusFor(f))).join('\n');
  const releaseKilder = nativeFiler.filter(iRelease);
  /* KALDSTART er det vanlige tilfellet her: brukeren tapper lenken i
     e-postklienten mens appen er stoppet, og adressen kommer da i aktivitetens
     FØRSTE intent — ikke gjennom `onNewIntent`. En `appUrlOpen`-lytter alene
     ser den aldri, og appen åpner på startsiden uten `?signup=`. Web-veien må
     derfor ha begge: lytteren for senere intents OG `getLaunchUrl()` ved
     oppstart. Native `getIntentUri()` leser nettopp launch-intenten, og dekker
     kaldstarten i seg selv. */
  const leserUri = (/addListener\s*\(\s*["'`]appUrlOpen/.test(webKode) && /getLaunchUrl\s*\(/.test(webKode))
    || releaseKilder.some((p) => {
      const src = strippet(fs.readFileSync(p, 'utf8'), 'js');
      /* `getData()` alene er et altfor vanlig navn — en modellklasse eller et
         databaselag har det like gjerne. Den formen godtas derfor bare i en fil
         som i det hele tatt kjenner `Intent`; Capacitors egen `getIntentUri()`
         er entydig og trenger ingen slik kontekst. */
      return /getIntentUri\s*\(/.test(src)
        || (/\bIntent\b/.test(src) && /(getDataString|getData)\s*\(/.test(src));
    });
  check('App Links: noe LESER den innkommende adressen (ellers mistes ?signup= og alt annet i URL-en)',
    leserUri,
    leserUri ? 'URI-en hentes — om den rutes riktig avgjøres på telefon'
      : 'web-koden mangler appUrlOpen-lytter og/eller getLaunchUrl (kaldstart), og ingen native lesing av intent-dataen'
        + (typeof alleDeps['@capacitor/app'] === 'string' ? ' (@capacitor/app installert, men ubrukt)' : ''));
}
if (harStatement) {
  let st = null;
  try { st = json(STATEMENT); } catch (e) { st = null; }
  const oppf = Array.isArray(st) ? st : [];
  const mål = oppf.map((o) => (o && o.target) || {});
  check(STATEMENT + ' er en JSON-liste med målobjekter',
    oppf.length > 0 && oppf.every((o) => o && typeof o === 'object' && o.target
      && typeof o.target === 'object'),
    oppf.length + ' oppføringer');
  /* HUSKIS' APP LINK-oppføring må finnes — ikke at ALLE oppføringene er den.
     Digital Asset Links er en LISTE nettopp fordi ett origin kan autorisere
     flere apper OG flere relasjoner: en fremmed app, eller en
     `common.get_login_creds` ved siden av, er gyldig og ikke vår sak å avvise.
     Vi plukker derfor ut vår egen `android_app` + `handle_all_urls` og leser
     resten av kravene fra den. */
  const HANDLE_ALL = 'delegate_permission/common.handle_all_urls';
  const våre = oppf.filter((o) => {
    const t = o.target || {};
    return t.namespace === 'android_app' && t.package_name === cfg.appId
      && Array.isArray(o.relation) && o.relation.indexOf(HANDLE_ALL) > -1;
  });
  check(STATEMENT + ' har en App Link-oppføring for appens egen applicationId',
    våre.length > 0,
    våre.length ? våre.length + ' oppføring(er) for ' + cfg.appId
      : 'fant kun: ' + (mål.map((t) => t.package_name).filter(Boolean).join(', ') || 'ingen'));
  /* Uten et fingeravtrykk er statementet en påstand om ingenting: Android
     sammenligner signaturen på den installerte APK-en mot denne lista.

     FORMEN kreves, ikke bare at lista er ikke-tom. En plassholder (`"TODO"`,
     `""`) er nøyaktig den samme stille feilen som en manglende fil: Android
     matcher den aldri mot et sertifikat, verifiseringen faller, og lenken
     åpner browseren som før. Et SHA-256-avtrykk er 32 heksbyte skilt med
     kolon — den formen kan sjekkes her, mens om det er RIKTIG nøkkel bare kan
     avgjøres av en enhet. */
  const SHA256 = /^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/i;
  const våreMål = våre.map((o) => o.target || {});
  const avtrykk = våreMål.flatMap((t) => (Array.isArray(t.sha256_cert_fingerprints)
    ? t.sha256_cert_fingerprints : []));
  /* Ingen `trim()`: det er den PUBLISERTE strengen Android leser, og
   byte-for-byte-sjekken bevarer et mellomrom inne i JSON-verdien. Trimmet vi
   her, ville vakten godtatt et avtrykk som aldri matcher sertifikatet. */
  const ugyldige = avtrykk.filter((f) => typeof f !== 'string' || !SHA256.test(f));
  check(STATEMENT + ' oppgir minst ett SHA-256-fingeravtrykk for ' + cfg.appId + ', på riktig form',
    våreMål.length > 0
      && våreMål.every((t) => Array.isArray(t.sha256_cert_fingerprints)
        && t.sha256_cert_fingerprints.length > 0)
      && ugyldige.length === 0,
    ugyldige.length ? 'ikke et SHA-256-avtrykk: ' + ugyldige.map((f) => JSON.stringify(f)).join(', ')
      : avtrykk.length + ' avtrykk');
  /* Den halvdelen som ikke ligger i noen av de to filene: at originet faktisk
     SERVERER den. `build.js` dropper prikk-kataloger — se blokken over.

     Og det er den PUBLISERTE fila Android leser, ikke kilden sjekkene over
     leste. At en sti finnes i `dist/` sier ingenting om innholdet: et
     byggesteg kunne skrevet om, generert eller tømt den, og alle de semantiske
     kravene ville fortsatt stått grønne på kilden. Byte for byte er derfor
     kravet — samme grep som de synkede web-assetene i del 12, og av samme
     grunn: da gjelder alt som er bevist om kilden også for det som serveres. */
  const publisert = path.join(DIST, STATEMENT);
  const finnesUt = byggUt.status === 0 && fs.existsSync(publisert);
  const likKilde = finnesUt
    && fs.readFileSync(publisert).equals(fs.readFileSync(path.join(ROOT, STATEMENT)));
  check(STATEMENT + ' publiseres til dist/, byte for byte lik kilden',
    likKilde,
    !finnesUt ? 'mangler i dist/ — copyDir i build.js hopper over navn som starter med punktum'
      : likKilde ? 'dist/' + STATEMENT + ' er identisk med kilden'
        : 'dist/' + STATEMENT + ' avviker fra kilden — byggesteget har rørt den');
}
/* Og BAKSIDEN av den samme medaljen. Den letteste måten å få statementet
   publisert på er å fjerne `name.startsWith('.')`-linjen i `copyDir()` — og da
   følger hver eneste andre skjulte fil med ut på `huskis.no`. `.gitignore`
   ligger i repo-roten allerede og ville blitt publisert med det samme; en
   framtidig lokal konfigurasjonsfil ville fulgt etter uten at noe sa fra,
   siden verken denne sjekken eller inventaret i del 12 leser skjulte navn.

   Kravet er derfor at fritaket må være SELEKTIVT: `.well-known/` kan
   publiseres, ingenting annet som starter med punktum. Sjekken er ikke tom i
   dag — den slår fast at `dist/` ikke inneholder én eneste skjult fil, og den
   blir rød i samme øyeblikk som noen løsner regelen for bredt. */
if (byggUt.status === 0 && fs.existsSync(DIST)) {
  const SKJULT_TILLATT = new Set(['.well-known']);
  const skjulte = [];
  (function les(dir, topp) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const q = path.join(dir, d.name);
      if (d.name.startsWith('.')) {
        /* Den tillatte katalogen slipper gjennom SEG SELV, men ikke sitt
           innhold: en `.well-known/.env` ville ellers blitt publisert like
           stille som `.gitignore`. Det er derfor unntaket er en KATALOG, ikke
           et fritak for alt under den. */
        if (topp && SKJULT_TILLATT.has(d.name)) { if (d.isDirectory()) les(q, false); continue; }
        skjulte.push(path.relative(DIST, q));
        continue;
      }
      if (d.isDirectory()) les(q, false);
    }
  }(DIST, true));
  check('dist/ publiserer ingen andre skjulte filer enn ' + [...SKJULT_TILLATT].join('/') + ' (fritaket må være selektivt)',
    skjulte.length === 0, skjulte.join(', ') || 'ingen skjulte filer i dist/');
}

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
