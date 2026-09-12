#!/usr/bin/env node
/*
  ANDROID-VARSLENE PÅ EN EKTE ENHET — den MASKINELLE runden.

  Alt Huskis selv gjør med de native varslene er dekket av
  `tests/notif-channels.test.js` mot en fake pluginbro, og omregningen av
  veggtid av `HuskisWallClockTest` på JVM-en. Det ingen av dem kan se er
  ANDROID: om en alarm Huskis ba om faktisk ligger i operativsystemets
  alarmkø, om den står der når prosessen er borte, om den kommer tilbake etter
  en omstart, og om trykket på varselet bærer pekeren inn i appen på en
  kaldstart.

  Denne fila prøver nøyaktig det, gjennom ADB og pluginbroen, på en telefon
  eller en emulator. Den erstatter ikke øyet: heads-up-banneret, lyden og
  låseskjermen er Androids presentasjon, og det må et menneske se. Alt ANNET i
  den fysiske runden er her (docs/mobilapp-plan.md, «Det som MÅ prøves på
  telefon»).

  ── Hvordan den får tak i noe å måle på ───────────────────────────────────
  Debug-APK-en er `debuggable`, og Capacitor slår da på WebView-ens
  devtools-socket. Harnesset snakker derfor Chrome DevTools-protokoll med
  appens egen WebView over `adb forward` — samme vei Chrome selv bruker — og
  leser `window.__huskis`. Det er appens EGEN kode som planlegger; harnesset
  ber bare om runden, og leser svaret ut av Androids egne dumper.

  To modi, og harnesset velger selv:

    LIVE  — telefonen er innlogget og har systemvarsler PÅ. Subjektet er
            brukerens EGEN plan, og det som måles er at `planNotifications` og
            Androids alarmkø sier det samme. Dette er runden som gjelder på
            eierens telefon.
    RIGG  — ingen innlogget plan (en rein installasjon, eller CI-emulatoren).
            Harnesset planlegger tre syntetiske alarmer gjennom den EKTE
            adapteren og måler på dem. Plattformhalvdelen blir bevist; det som
            krever en økt (brukerbyttet) rapporteres som SKIP med grunnen.

  Runden ENDRER enhetens alarmkø, og det er trygt: diffen i adapteren er
  selvhelende. En syntetisk alarm som ikke står i brukerens plan avlyses av
  neste speilingsrunde, og en plan som mangler legges inn igjen. Harnesset
  rydder dessuten etter seg selv, og MÅLER at planen er tilbake (K).

  ── Bruk ──────────────────────────────────────────────────────────────────
    node tests/android-device.js                  # hele runden
    node tests/android-device.js --no-reboot      # uten å restarte telefonen
    node tests/android-device.js --install <apk>  # installer APK-en først
    node tests/android-device.js --plan           # skriv ut hva den gjør, kjør ingenting

  Krever `adb` på PATH og nøyaktig én tilkoblet enhet (`ANDROID_SERIAL` velger
  én av flere). Ingen npm-avhengigheter: WebSocket-klienten er node 22 sin egen.

  Vokteren over denne fila er `tests/android-alarm-queue.test.js`, som kjøres i
  den vanlige node-runden. Selve runden kjøres av
  `.github/workflows/android-device.yml` på en emulator.
*/
'use strict';

const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------------------------------------------------------------- konstanter */

const PKG = 'no.huskis.app';
const ACTIVITY = PKG + '/.MainActivity';

/* Pluginens egen kringkastingsmottaker: DEN er alarmens mål, og derfor det
   eneste stabile kjennetegnet på en Huskis-alarm i `dumpsys alarm`. */
const PUBLISHER = 'com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher';

/* Intenten et TRYKK på varselet leverer. Pluginen bygger den i
   `LocalNotificationManager.buildIntent()`: MAIN/LAUNCHER mot MainActivity,
   SINGLE_TOP|CLEAR_TOP, og tre extras — varsel-ID-en, handlingen («tap») og
   HELE varselet som JSON-tekst. Navnet på den siste har en skrivefeil i
   pluginen (`LocalNotficationObject`), og den skal skrives av her, ikke rettes:
   det er nøkkelen Android faktisk leverer.

   Derfor KAN ADB gjøre det et trykk gjør. Det den ikke kan, er fingeren på
   skjermen — at varselet er synlig og trykkbart er et øyepunkt. */
const TAP = {
  id: 'LocalNotificationId',
  action: 'LocalNotificationUserAction',
  obj: 'LocalNotficationObject',
  flags: '0x24000000',            // FLAG_ACTIVITY_SINGLE_TOP | FLAG_ACTIVITY_CLEAR_TOP
};

/* Pluginversjonen formene over er lest ut av. Et versjonsløft kan flytte
   intent-nøklene eller klassenavnet, og da skal noen lese dem på nytt —
   `tests/android-alarm-queue.test.js` feller en bump som ikke har vært her. */
const PLUGIN_VERSION = '8.3.1';

/* Capacitors broLOGG: hvert kall over broen skrives på dette tagget i en
   debug-build. Det er evidensen for at en oppstart IKKE avlyste og planla på
   nytt — køen alene kan ikke skille «urørt» fra «avlyst og lagt inn igjen». */
const LOG_TAG = 'Capacitor/Plugin';

const REBOOT_MS = 300000;        // en emulator bruker gjerne flere minutter
const RESTORE_MS = 180000;       // … og oppstartsmottakeren kjører etter opplåsing
const POST_MS = 180000;          // alarmen er UPRESIS med vilje: Android får flytte den
const RIG_AHEAD_MIN = [180, 240, 300];
const SOON_S = 25;               // alarmen som skal få forfalle i runden
const TOL_MS = 150000;           // slingring når to tidssett sammenlignes
const RYDD_MS = 45000;           // taket på opprydningen av riggens alarmer
const RYDD_SYS_MS = 25000;       // … og på å få systeminnstillingene tilbake

/* ---------------------------------------------------------------- rapporten */

const results = [];
const check = (navn, ok, x = '') => {
  results.push({ navn, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + navn +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};
const skip = (navn, grunn) => {
  results.push({ navn, ok: null });
  console.log('SKIP — ' + navn + '  [' + grunn + ']');
};
const sier = (s) => console.log('     · ' + s);

/* ---------------------------------------------------------------------- adb */

const SERIAL = process.env.ANDROID_SERIAL || process.env.ADB_SERIAL || '';

function adb(args, { timeout = 120000, tillatFeil = false } = {}) {
  const full = (SERIAL ? ['-s', SERIAL] : []).concat(args);
  try {
    return execFileSync('adb', full, {
      encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (tillatFeil) return (e.stdout || '') + (e.stderr || '');
    throw new Error('adb ' + full.join(' ') + ' feilet: ' +
      String(e.stderr || e.message || '').trim());
  }
}
const sh = (cmd, opts) => adb(['shell', cmd], opts);
const sov = (ms) => new Promise((r) => setTimeout(r, ms));

/* Enhetens EGEN klokke, i millisekunder. Alt som sammenlignes med et
   alarmtidspunkt må regnes i den: vertsmaskinen og telefonen er to klokker, og
   et kvarters avvik er helt vanlig på en emulator. Sekundoppløsning holder —
   slingringen under er i minutter. */
const enhetNå = () => Number(sh('date +%s').trim()) * 1000;

/* Enhetens oppetid i sekunder. Den ene tingen som BEVISER at en omstart skjedde:
   et tall som har falt kan ikke komme fra det samme systemet. */
const oppetid = () => Number((sh('cat /proc/uptime', { tillatFeil: true }).trim()
  .split(/\s+/)[0]) || 0);

async function ventTil(fn, ms, intervall = 1000) {
  const slutt = Date.now() + ms;
  for (;;) {
    let svar = null;
    try { svar = await fn(); } catch (e) { svar = null; }
    if (svar) return svar;
    if (Date.now() > slutt) return null;
    await sov(intervall);
  }
}

/* ------------------------------------------------------------------ alarmkøen */

/* `dumpsys alarm` i ÉN lesning: hvilke Huskis-alarmer står ARMERT, og når.

   Teksten kuttes før statistikkseksjonene. De nevner pakken og pluginens
   klasse på nøyaktig samme form som en armert alarm, og et naivt søk ville
   telt historikk som om den var en framtid. Identiteten leses derfor av
   `tag=`-linjen, som bare den armerte alarmen har.

   Tidspunktet er det vanskelige: Android skriver det som et RELATIVT avvik på
   nyere versjoner (`when=+2h30m0s0ms`) og som et absolutt felt på eldre. Begge
   former leses, og svaret er alltid et absolutt millisekund på ENHETENS klokke.
   Lar tiden seg ikke lese, står den som 0 — da måles antallet, og rapporten
   sier hvorfor. */
function alarmKø(txt, nå, sone) {
  if (txt == null) { nå = enhetNå(); sone = sonen(); txt = sh('dumpsys alarm'); }
  /* Statistikkseksjonene nevner pakken OG pluginens klasse på samme form som en
     armert alarm. De kuttes vekk før noe telles — ellers leses historikk som
     framtid. */
  const etter = txt.match(
    /\n[ \t]*(?:Allow while idle dispatches|Recent problems|Top Alarms|Alarm Stats|Past-due non-wakeup alarms)\b/);
  const linjer = txt.slice(0, etter ? etter.index : txt.length).split('\n');
  const esc = (s) => s.replace(/\./g, '\\.');
  const tagRe = new RegExp('^\\s*tag=\\*\\w*alarm\\*:' + esc(PKG) + '/' + esc(PUBLISHER) + '\\s*$');
  const ut = [];
  for (let i = 0; i < linjer.length; i++) {
    if (!tagRe.test(linjer[i])) continue;
    ut.push({
      at: lesTid(linjer, i, nå, sone), type: lesType(linjer, i), blokk: blokk(linjer, i),
    });
  }
  return ut;
}

const blokk = (linjer, i) => linjer.slice(Math.max(0, i - 1), i + 6).join('\n');

/* Alarmtypen for NETTOPP denne alarmen. Den står to steder — i overskriften
   (`RTC_WAKEUP #0: Alarm{…}`) og på `type=`-linjen — og leses herfra og ikke av
   et søk i blokka: blokka er kontekst for rapporten og kan bære noen linjer fra
   NESTE alarm. Et søk der ville lest naboens `RTC_WAKEUP` som denne alarmens. */
function lesType(linjer, i) {
  const hode = (linjer[i - 1] || '').match(/\b(RTC_WAKEUP|ELAPSED_REALTIME_WAKEUP|RTC|ELAPSED_REALTIME)\b/);
  if (hode) return hode[1];
  for (let j = i + 1; j < Math.min(linjer.length, i + 4); j++) {
    const m = (linjer[j] || '').match(/\btype=(\w+)/);
    if (m) return m[1];
  }
  return '';
}

/* En formatert dato fra `dumpsys` er ENHETENS lokale veggtid — og vertsmaskinen
   står i sin egen sone (UTC i CI, Oslo på en utviklermaskin). `Date.parse()`
   ville tolket den i VERTENS sone og gitt et tidspunkt forskjøvet med
   soneforskjellen: D3 og hver sammenligning før/etter ville målt feil.

   Den regnes derfor om i enhetens sone, med samme to-rundersmetode som
   `HuskisWallClock` på Java-siden: avviket avhenger av øyeblikket, og øyeblikket
   av avviket. Kjenner vi ikke enhetens sone, svarer vi 0 — «uleselig» — i stedet
   for å gjette. Rapporten sier da at tidspunktene ikke ble lest, og sjekken
   hoppes over i stedet for å bestå på et galt tall. */
function veggtidTilMs(tekst, sone) {
  const m = tekst.match(/(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/);
  if (!m || !sone) return 0;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  let t = utc;
  for (let i = 0; i < 2; i++) t = utc - soneAvvik(sone, t);
  return t;
}

/* Tidspunktet for alarmen `tag=`-linja hører til. Blokka er noen få linjer, og
   feltet heter `when` eller `origWhen` — i én av tre former. */
function lesTid(linjer, i, nå, sone) {
  for (let j = Math.max(0, i - 1); j < Math.min(linjer.length, i + 9); j++) {
    const l = linjer[j];
    const rel = l.match(/\b(?:when|origWhen)=([+-])(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?\b/);
    if (rel && (rel[2] || rel[3] || rel[4] || rel[5] || rel[6])) {
      const n = (s, mult) => (s ? parseInt(s, 10) * mult : 0);
      const off = n(rel[2], 86400000) + n(rel[3], 3600000) + n(rel[4], 60000) +
        n(rel[5], 1000) + n(rel[6], 1);
      return nå + (rel[1] === '-' ? -off : off);
    }
    const abs = l.match(/\b(?:when|origWhen)=(\d{12,})\b/);
    if (abs) return Number(abs[1]);
    const dato = l.match(/\b(?:when|origWhen)=(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)/);
    if (dato) return veggtidTilMs(dato[1], sone);
  }
  return 0;
}

/* To tidssett er LIKE når hvert tidspunkt har en motpart innenfor slingringen.
   Slingringen finnes fordi Android selv er upresis, og fordi en relativ
   `when=` leses av en dump som ble tatt et øyeblikk for sent. */
function sammeTider(a, b, tol = TOL_MS) {
  if (a.length !== b.length) return false;
  const rest = b.slice();
  for (const t of a) {
    const i = rest.findIndex((u) => Math.abs(u - t) <= tol);
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}
const tider = (kø) => kø.map((a) => a.at).filter((t) => t > 0).sort((x, y) => x - y);
const lesbar = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '?');

/* ---------------------------------------------------------- prosess og logg - */

const pid = () => sh('pidof ' + PKG, { tillatFeil: true }).trim().split(/\s+/)[0] || '';

/* «Prosessen fjernet fra Recents», så nær som ADB kommer: HOME først (en
   forgrunnsprosess er ikke drepbar), så `am kill`.

   IKKE `force-stop`. Den gjør to ting til: Android AVLYSER appens alarmer, og
   appen settes i «stopped state», der den ikke får kringkastinger i det hele
   tatt. Det ville prøvd Androids regel for en app brukeren har stoppet — ikke
   Huskis' kode, og ikke det en sveip i Recents gjør. */
async function drepApp() {
  if (!pid()) return true;
  sh('input keyevent 3', { tillatFeil: true });       // KEYCODE_HOME
  for (let i = 0; i < 10; i++) {
    await sov(900);
    sh('am kill ' + PKG, { tillatFeil: true });
    if (!pid()) return true;
  }
  return !pid();
}

const startApp = () => sh('am start -n ' + ACTIVITY, { tillatFeil: true });

/* Kommandoen som gjør det TRYKKET gjør. Pluginens `contentIntent` er en
   `PendingIntent.getActivity` over nøyaktig denne intenten, så `am start` med
   de samme extras leverer det samme til appen — også når prosessen var borte,
   som er hele poenget med punktet.

   Den står for seg selv fordi formen er pluginens og ikke vår:
   `tests/android-alarm-queue.test.js` leser den herfra. */
const tapKommando = (id, kildeJson) =>
  'am start -n ' + ACTIVITY +
  ' -a android.intent.action.MAIN -c android.intent.category.LAUNCHER' +
  ' -f ' + TAP.flags +
  ' --ei ' + TAP.id + ' ' + id +
  ' --es ' + TAP.action + ' tap' +
  " --es " + TAP.obj + " '" + kildeJson + "'";
const tømLogg = () => adb(['logcat', '-c'], { tillatFeil: true });

/* HVOR kjeden fra et trykk brøt, lest av Androids egen logg. Tre ledd, og hvert
   av dem har sin egen linje:

     · pluginen fikk intenten      → «LocalNotification received» (tagg Capacitor/LN)
     · pluginen sendte den til JS  → «localNotificationActionPerformed» i brologgen
     · JS-en gjorde noe med den    → observatørene i `window.__huskis`

   Uten denne oppdelingen er «ingen peker» bare et nederlag uten adresse. */
function trykkSpor() {
  /* USTERT logcat, og filtrering i node. Et taggfilter (`-s`) krever at tagen
     treffer EKSAKT, og pluginens egne linjer kommer på
     `Capacitor/LocalNotificationsPlugin` — en tag det er lett å gjette feil på,
     og da svarer sporet «nei» på noe som skjedde. `-t` holder mengden nede. */
  const txt = adb(['logcat', '-d', '-t', '3000'], { tillatFeil: true });
  const linjer = txt.split('\n');
  const treff = (re) => linjer.filter((l) => re.test(l));
  const fikk = treff(/LocalNotification received/);
  const videre = treff(/Notifying listeners for event localNotificationActionPerformed/);
  /* Pluginens egen linje for «intenten kom, men den bar ingen varsel-ID». Det er
     Androids oppgave-semantikk: en MAIN/LAUNCHER-intent mot en oppgave som alt
     finnes kan bli gjenopptatt UTEN at extras leveres. Da har sonden ingenting
     å måle, og det skal rapporteres som nettopp det — ikke som en feil i appen. */
  const utenId = treff(/Activity started without notification attached/);
  return {
    tilPlugin: fikk.length > 0,
    tilJs: videre.length > 0,
    utenId: utenId.length > 0,
    bevis: fikk.concat(videre, utenId).slice(0, 4).map((l) => l.trim().slice(0, 160)),
    jsFeil: treff(/Uncaught|INFO:CONSOLE/).slice(0, 3).map((l) => l.trim().slice(0, 160)),
  };
}

function broKall() {
  const txt = adb(['logcat', '-d', '-s', LOG_TAG + ':V'], { tillatFeil: true });
  return (txt.match(/pluginId: LocalNotifications, methodName: \w+/g) || [])
    .map((s) => s.split('methodName: ')[1]);
}

/* Radioen av og på. Dette er hele «offline»-punktet: en lokal alarm skal
   planlegges og fyre uten at noe når en server. Klarer vi ikke å slå den av,
   sier rapporten det — en runde som stilltiende kjørte på nett ville sagt at
   punktet var prøvd. */
const flymodus = () => sh('settings get global airplane_mode_on', { tillatFeil: true }).trim() === '1';
function settFlymodus(på) {
  sh('cmd connectivity airplane-mode ' + (på ? 'enable' : 'disable'), { tillatFeil: true });
  /* Flagget leses av tilstanden, ikke av hva vi BA om: et «slå av» som ikke tok
     (kommandoen feilet, eller innstillingen henger etter) skal fortsatt stå som
     noe å rydde, ellers slutter opprydningen å prøve og telefonen blir stående i
     flymodus. */
  const nå = flymodus();
  åGjenopprette.flymodus = nå;
  return nå === på;
}

/* Enhetens tidssone, og et bytte av den. `cmd alarm set-timezone` er
   AlarmManagerService sin egen skallkommando, og den kringkaster
   TIMEZONE_CHANGED slik et ekte bytte gjør — som er hele poenget: det er den
   kringkastingen `TimeZoneAlarmReceiver` lever av. */
const sonen = () => sh('getprop persist.sys.timezone', { tillatFeil: true }).trim();

/* Runden skrur på to ting som ikke er appens egne: flymodus og tidssonen. De SKAL
   tilbake uansett hvordan runden ender — en avbrutt runde som etterlot telefonen i
   flymodus eller på Hawaii-tid ville vært en feil harnesset selv laget.
   `ryddEnheten()` kjøres både på veien ut og fra feilgrenen. */
const åGjenopprette = { sone: null, flymodus: false, riggIder: [], harØkt: false };

/* SYSTEMINNSTILLINGENE tilbake — VERIFISERT, og med nye forsøk innen et vindu.

   Ett forsøk er ikke nok: `cmd connectivity airplane-mode disable` kan feile
   eller henge etter, og et flagg som bare BLIR STÅENDE hjelper ikke når
   prosessen avsluttes rett etterpå. Løkken prøver derfor på nytt til tilstanden
   er lest tilbake som riktig, eller til vinduet er ute — og sier det da, i
   stedet for å gå stille.

   Kallene har kort tak: en `adb` som henger skal ikke spise hele vinduet. */
async function ryddEnheten() {
  const frist = Date.now() + RYDD_SYS_MS;
  const kort = { tillatFeil: true, timeout: 15000 };
  for (;;) {
    try {
      if (åGjenopprette.flymodus) {
        sh('cmd connectivity airplane-mode disable', kort);
        åGjenopprette.flymodus = flymodus();
      }
      if (åGjenopprette.sone) {
        sh('cmd alarm set-timezone ' + åGjenopprette.sone, kort);
        if (sonen() === åGjenopprette.sone) åGjenopprette.sone = null;
      }
    } catch (e) { /* opprydningen skal ikke skjule feilen den rydder etter */ }
    if (!åGjenopprette.flymodus && !åGjenopprette.sone) break;
    if (Date.now() >= frist) {
      console.error('     · FIKK IKKE satt tilbake: ' + [
        åGjenopprette.flymodus ? 'FLYMODUS STÅR PÅ' : null,
        åGjenopprette.sone ? 'tidssonen er ikke tilbake til ' + åGjenopprette.sone : null,
      ].filter(Boolean).join(', ') + ' — rett det i telefonens innstillinger.');
      break;
    }
    await sov(1500);
  }
  try {
    sh('svc power stayon false', kort);
    adb(['forward', '--remove', 'tcp:' + CDP_PORT], kort);
  } catch (e) { /* uviktig */ }
}

/* … OG RIGGENS EGNE ALARMER, når runden blir avbrutt med dem armert.

   Å vente på «neste speilingsrunde» duger ikke: alarmen i H ligger ~25 sekunder
   fram, og den rekker å ringe lenge før en synk. «Huskis-rigg forfaller» skal
   ikke komme på noens telefon.

   Derfor avlyses NØYAKTIG de id-ene riggen la inn, gjennom pluginen — brukerens
   egen plan er urørt, for den står ikke i listen. Det krever at appen kjører, så
   den startes. Når broen ikke er å nå, er siste utvei `force-stop`, som avlyser
   ALLE appens alarmer: den brukes bare når enheten ikke har en innlogget bruker,
   for der er køen riggens egen. Er brukeren innlogget, sier vi i stedet presis
   hva som kan ringe én gang — en `force-stop` ville tatt hennes alarmer OG satt
   appen i «stopped state». */
async function ryddRiggAlarmer() {
  const ider = åGjenopprette.riggIder.slice();
  if (!ider.length) return;
  /* Opprydningen skal kjøre UANSETT hvilken bundle appen endte opp med: det er
     riggens alarmer som skal bort, og de er Androids, ikke web-kodens. En vakt
     som kastet her ville etterlatt dem armert. */
  vaktAv = true;

  /* Ett forsøk: avlys, fjern fra panelet, og LES ETTERPÅ hva som står igjen.
     Svaret er det som fortsatt er PLANLAGT (`getAll` med `SCHEDULED`) pluss det
     som fortsatt ligger i varselpanelet. Lar noe av det seg ikke lese, regnes ALT
     som igjen — en opprydning som ikke kan verifiseres er ikke utført. */
  const forsøk = async () => {
    const b = await appenOpp('opprydning');
    const svar = await b.evalJs(
      'const ln = window.Capacitor.Plugins.LocalNotifications;' +
      'const ider = ' + JSON.stringify(ider) + ';' +
      'const feil = [];' +
      'try { await ln.cancel({ notifications: ider.map((id) => ({ id })) }); }' +
      'catch (e) { feil.push("cancel: " + ((e && e.message) || e)); }' +
      'try { await ln.removeDeliveredNotificationsById({ ids: ider }); }' +
      'catch (e) { feil.push("remove: " + ((e && e.message) || e)); }' +
      'let igjen = ider;' +
      'try {' +
      '  const r = await ln.getAll({ state: "SCHEDULED" });' +
      '  const står = ((r && r.notifications) || []).map((n) => Number(n.id));' +
      '  igjen = ider.filter((id) => står.includes(id));' +
      '} catch (e) { feil.push("getAll: " + ((e && e.message) || e)); }' +
      'return { feil, igjen };');
    /* Panelet leses av Android selv, og et ULESELIG svar er ikke «tomt»: kunne vi
       ikke lese det, er ingen levert rad verifisert borte. Da regnes alle id-ene
       som igjen — samme regel som for `getAll`. */
    const panel = varselDump();
    const iPanelet = panel === null
      ? ider
      : ider.filter((id) => new RegExp('\\bid=' + id + '\\b').test(panel));
    if (panel === null) svar.feil.push('varselpanelet lot seg ikke lese');
    return { feil: svar.feil, igjen: svar.igjen.concat(iPanelet.filter((id) => !svar.igjen.includes(id))) };
  };

  let sist = { feil: ['broen var ikke å nå'], igjen: ider };
  for (let i = 0; i < 2; i++) {           // én omgang, og ett nytt forsøk
    try { sist = await forsøk(); } catch (e) { sist = { feil: [String((e && e.message) || e)], igjen: ider }; }
    if (!sist.igjen.length) break;
  }

  if (!sist.igjen.length) {
    åGjenopprette.riggIder = [];
    console.error('     · riggalarmene ' + JSON.stringify(ider) +
      ' er avlyst og VERIFISERT borte; brukerens egen plan er urørt' +
      (sist.feil.length ? '  (merk: ' + sist.feil.join('; ') + ')' : ''));
    return;
  }

  /* Ikke verifisert. Flagget blir stående — det er nettopp nå det betyr noe — og
     siste utvei er `force-stop`, som avlyser ALLE appens alarmer. Den brukes bare
     uten en innlogget bruker, og bare når køen faktisk ble tom etterpå. */
  if (!åGjenopprette.harØkt) {
    sh('am force-stop ' + PKG, { tillatFeil: true });
    /* Og VERIFISER begge sidene: en tom alarmkø (ingenting kan ringe) OG et
       lesbart panel uten id-ene (ingenting kan ses). Et uleselig panel teller
       ikke som bevis. */
    const panel = varselDump();
    const tomKø = alarmKø().length === 0;
    const tomtPanel = panel !== null &&
      !ider.some((id) => new RegExp('\\bid=' + id + '\\b').test(panel));
    if (tomKø && tomtPanel) {
      åGjenopprette.riggIder = [];
      console.error('     · fikk ikke avlyst ' + JSON.stringify(sist.igjen) +
        ' gjennom broen — alarmkøen og panelet er tømt med force-stop i stedet ' +
        '(ingen innlogget bruker)' + (sist.feil.length ? '  [' + sist.feil.join('; ') + ']' : ''));
      return;
    }
    sist.feil.push('force-stop: kø tom=' + tomKø + ', panel tomt=' + tomtPanel);
  }
  console.error('     · FIKK IKKE ryddet riggalarmene ' + JSON.stringify(sist.igjen) +
    ': de kan ringe én gang. Din egen plan er urørt — åpne Huskis, så avlyser diffen resten.' +
    (sist.feil.length ? '  [' + sist.feil.join('; ') + ']' : ''));
}

async function settSone(id) {
  sh('cmd alarm set-timezone ' + id, { tillatFeil: true });
  // Propertyen settes av systemet etterpå, ikke av kommandoen — derfor en kort
  // venting før svaret. Er kommandoen ukjent, endrer den seg aldri.
  return !!(await ventTil(() => sonen() === id, 10000, 1000));
}

/* Sonens avvik fra UTC på et gitt øyeblikk, regnet på VERTEN — enheten kan ikke
   spørres, for appen skal være lukket gjennom hele byttet. `longOffset` gir
   «GMT+02:00»; GMT alene er null. */
function soneAvvik(id, atMs) {
  const tekst = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'longOffset' })
    .formatToParts(new Date(atMs)).find((p) => p.type === 'timeZoneName').value;
  const m = tekst.match(/GMT([+-])(\d\d):(\d\d)/);
  if (!m) return 0;
  const min = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  return (m[1] === '-' ? -min : min) * 60000;
}

/* Varselpanelet, eller `null` når det ikke LOT SEG LESE.

   Forskjellen er hele poenget: et gyldig svar uten våre id-er betyr «ingenting
   ligger i panelet», mens en lesefeil ikke betyr noe som helst. Med `tillatFeil`
   kommer begge ut som tekst, og uten denne vaktlinjen ville en feilet dump blitt
   lest som at riggens varsel var borte. Svaret må derfor SE UT som dumpen den
   later som den er. */
function varselDump() {
  const gyldig = (t) => !!t && (
    /Current Notification Manager state|NotificationRecord|mNotificationList/.test(t) ||
    (t.length > 500 && /otification/.test(t)));
  for (const cmd of ['dumpsys notification --noredact', 'dumpsys notification']) {
    const t = sh(cmd, { tillatFeil: true });
    if (gyldig(t)) return t;
  }
  return null;
}

/* -------------------------------------------------------------- DevTools-broen */

/* WebView-ens devtools-socket heter `webview_devtools_remote_<pid>`. Den listes
   i /proc/net/unix — samme vei Chrome selv finner den. Finner vi den ikke der,
   er prosess-ID-en en god nok gjetning: det er nettopp den navnet bærer. */
function devtoolsSocket() {
  const p = pid();
  if (!p) return null;
  const txt = sh('cat /proc/net/unix', { tillatFeil: true });
  const treff = (txt.match(/@?webview_devtools_remote_\d+/g) || []).map((s) => s.replace(/^@/, ''));
  const mine = treff.filter((s) => s.endsWith('_' + p));
  return mine.length ? mine[0] : 'webview_devtools_remote_' + p;
}

const CDP_PORT = Number(process.env.HUSKIS_CDP_PORT || 9333);

function hentJson(url) {
  return new Promise((res, rej) => {
    const req = http.get(url, { timeout: 8000 }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('tidsavbrudd')));
    req.on('error', rej);
  });
}

/* Én åpen CDP-forbindelse til appens WebView. `evalJs` kjører uttrykket i
   sidens egen kontekst og venter ut et løfte, så adapterens runder kan bes om
   herfra — og ventes på. */
async function koble() {
  const sock = devtoolsSocket();
  if (!sock) throw new Error('appen kjører ikke');
  adb(['forward', '--remove', 'tcp:' + CDP_PORT], { tillatFeil: true });
  adb(['forward', 'tcp:' + CDP_PORT, 'localabstract:' + sock]);
  const liste = await hentJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
  const sider = (liste || []).filter((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!sider.length) throw new Error('devtools svarte uten en side å koble til');
  const side = sider.find((p) => /localhost/.test(p.url || '')) || sider[0];

  const ws = new WebSocket(side.webSocketDebuggerUrl);
  const venter = new Map();
  let neste = 1;
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('fikk ikke åpnet devtools-forbindelsen'));
  });
  ws.onmessage = (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m.id || !venter.has(m.id)) return;
    const { res, rej } = venter.get(m.id);
    venter.delete(m.id);
    if (m.error) rej(new Error(m.error.message || 'CDP-feil'));
    else res(m.result);
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = neste++;
    venter.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  return {
    async evalJs(uttrykk) {
      const params = {
        expression: '(async () => { ' + uttrykk + ' })()',
        awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
      };
      /* Siden kjører under den ekte innholdssikkerhetspolicyen (`script-src
         'self'`), og uten flagget kan en evaluering bli blokkert. Er flagget
         ukjent i WebView-ens protokollversjon, avviser den hele kallet — da
         prøves det samme uten. */
      let r;
      try {
        r = await send('Runtime.evaluate', params);
      } catch (e) {
        delete params.allowUnsafeEvalBlockedByCSP;
        r = await send('Runtime.evaluate', params);
      }
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('JS i appen kastet: ' + ((d.exception && d.exception.description) || d.text));
      }
      return r.result.value;
    },
    lukk() { try { ws.close(); } catch (e) { /* uviktig */ } },
  };
}

/* Appen i forgrunnen, WebView-en oppe og `window.__huskis` på plass. Den
   FORRIGE forbindelsen lukkes: en prosess som er drept etterlater en død
   socket, og `adb forward` skal ikke peke på den. */
let bro = null;

/* Vent på en app som ALLEREDE kjører, uten å sende en eneste intent.

   Det er nødvendig for punkt I: appen skal være startet av TRYKKET, og et
   `am start` oppå det er en ny intent inn i den samme aktiviteten. Måler vi
   pekeren etterpå, vil vi ikke ha rørt den på vei dit. */
async function ventPåBro(ms = 90000, hvor = 'bro') {
  if (bro) { bro.lukk(); bro = null; }
  bro = await ventTil(async () => {
    let b = null;
    try {
      b = await koble();
      if (await b.evalJs('return !!(window.__huskis && window.__huskis.androidChannel);')) return b;
    } catch (e) { /* prøv igjen */ }
    if (b) b.lukk();
    return null;
  }, ms, 1500);
  await krevRiktigBundle(hvor);
  return bro;
}

async function appenOpp(hvor = 'oppstart') {
  if (bro) { bro.lukk(); bro = null; }
  bro = await ventTil(async () => {
    let b = null;
    try {
      // Idempotent: `am start` på en app som alt står framme gjenopptar den bare.
      // Står den inne i løkken, kommer en app som DØDE under oppstart opp igjen.
      startApp();
      b = await koble();
      if (await b.evalJs('return !!(window.__huskis && window.__huskis.androidChannel);')) return b;
    } catch (e) { /* prøv igjen */ }
    if (b) b.lukk();
    return null;
  }, 120000, 2000);
  if (!bro) throw new Error('appen kom ikke opp med window.__huskis innen 120 s');
  await krevRiktigBundle(hvor);
  return bro;
}

/* ------------------------------------------------------- hvilken bundle kjører */

/* OTA-en kan BYTTE web-koden under føttene på runden.

   Appen henter ett manifest per oppstart fra produksjonsadressen, og i en
   emulator med nett betyr det at den kan laste ned og stille opp main sin
   bundle — og så måler runden main, ikke endringen. Det har skjedd: en kjøring
   bygde `9bf8511d446c` inn i APK-en og kjørte `13130ccde176` i WebView-en, og
   felte et punkt på kode som ikke fantes i den bundelen.

   Identiteten leses derfor av SIDEN (`meta[name=huskis-build]`), og
   sammenlignes med den builden APK-en ble bygget av. Driver den, forsøkes OTA-en
   tilbakestilt til den innebygde bundelen; virker ikke det, FEILER runden med én
   gang — å måle videre i feil kode er verre enn ikke å måle. */
const identitet = () => bro.evalJs(
  'const m = (n) => { const e = document.querySelector(\'meta[name="\' + n + \'"]\');' +
  ' return e ? String(e.getAttribute(\'content\') || \'\').trim() : \'\'; };' +
  /* … OG hvilken bundle LiveUpdate mener appen kjører. `null` er den INNEBYGDE,
     altså den som ble pakket i APK-en; alt annet er noe appen har lastet ned. Det
     er evidensen som forklarer en drift, og som gjør den lesbar i rapporten. */
  'let bundle = \'?\';' +
  'try {' +
  '  const lu = window.Capacitor.Plugins.LiveUpdate;' +
  '  const r = lu && lu.getCurrentBundle ? await lu.getCurrentBundle() : null;' +
  '  bundle = r ? (r.bundleId === null ? \'innebygd\' : String(r.bundleId)) : \'ingen plugin\';' +
  '} catch (e) { bundle = \'ulesbar\'; }' +
  'return { build: m(\'huskis-build\'), release: m(\'huskis-release\'), bundle };');

function ventetBuild(args) {
  const i = args.indexOf('--expect-build');
  if (i >= 0 && args[i + 1]) return { id: args[i + 1], kilde: '--expect-build' };
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'version.json'), 'utf8'));
    if (v && v.buildId) return { id: String(v.buildId), kilde: 'dist/version.json' };
  } catch (e) { /* ingen build i arbeidskopien */ }
  return null;
}

/* DEN SENTRALE VAKTEN. Den er ikke noen få håndplasserte sjekker: ENHVER
   oppstart i runden går gjennom `appenOpp()` eller `ventPåBro()`, og ingen av dem
   slipper videre til en måling før appen kjører bundelen vi bygget. To punkter
   ville ikke holdt — appen starter mange ganger i runden (E, G, H, I, J, K), og
   en OTA-oppdatering tas i bruk ved oppstart.

   `ventetBundle` armeres FØRST når A4 har godkjent identiteten, slik at A4 selv
   får forsøke å rette en drift før vakten begynner å felle. `vaktAv` slår den av
   der den ville stått i veien: under A4 sin egen retting, og under opprydningen,
   som skal kjøre uansett hva appen kjører. */
let ventetBundle = null;
let vaktAv = false;

async function krevRiktigBundle(hvor) {
  if (vaktAv || !ventetBundle || !bro) return;
  /* Ett nytt forsøk, og så FAIL CLOSED: en identitet som ikke lar seg lese er
     ikke en identitet som stemmer. Å måle videre da ville vært å gjette på
     hvilken kode som svarte. */
  let id = null;
  for (let i = 0; i < 2 && !id; i++) {
    try { id = await identitet(); } catch (e) { if (i === 0) await sov(1500); }
  }
  if (id && id.build === ventetBundle.id) return;
  check('BUNDLE ' + hvor + ': appen kjører bundelen vi installerte', false,
    { kjører: id ? (id.build || '?') : 'identiteten lot seg ikke lese',
      ventet: ventetBundle.id, liveUpdate: id ? id.bundle : '?' });
  throw new Error('kjører feil bundle ved «' + hvor + '»: ' +
    (id ? (id.build || '?') : 'uleselig') + ' (ventet ' + ventetBundle.id +
    '). Runden stopper — en måling i feil kode er verre enn ingen måling.');
}

async function vaktBundle(navn, ventet) {
  if (!ventet) {
    const id = await identitet();
    skip(navn + ' kjører bundelen vi installerte',
      'ingen forventet build å sammenligne med (kjører ' + (id.build || '?') + ')');
    return true;
  }
  let id = await identitet();
  if (id.build === ventet.id) {
    check(navn + ' kjører bundelen vi installerte', true,
      id.build + ' (LiveUpdate: ' + id.bundle + ')');
    return true;
  }
  /* Drift. Tilbakestill OTA-en til den innebygde bundelen og les på nytt — det er
     den ene handlingen som kan rette det, og den er pluginens egen.

     RADIOEN AV først: er den på, kan appen laste ned den samme bundelen igjen i
     det den starter, og da retter tilbakestillingen ingenting. */
  if (!flymodus()) settFlymodus(true);
  let nullstilt = false;
  try {
    nullstilt = await bro.evalJs(
      'const lu = window.Capacitor.Plugins.LiveUpdate;' +
      'if (!lu || !lu.reset) return false;' +
      'try { await lu.reset(); return true; } catch (e) { return false; }');
  } catch (e) { /* broen svarte ikke */ }
  if (nullstilt) {
    /* Vakten av under rettingen: den leser det samme, og et kast her ville tatt
       fra oss sjekken som nettopp skal rapportere utfallet. */
    vaktAv = true;
    try { await drepApp(); await appenOpp('A4-retting'); id = await identitet(); }
    finally { vaktAv = false; }
  }
  const ok = id.build === ventet.id;
  check(navn + ' kjører bundelen vi installerte', ok,
    { kjører: id.build, ventet: ventet.id, kilde: ventet.kilde,
      liveUpdate: id.bundle, otaNullstilt: nullstilt });
  return ok;
}

/* --------------------------------------------------------------------- planen */

/* Appens EGEN plan framover, som adapteren ville speilet den. Uten en innlogget
   bruker finnes det ingen, og da er svaret en tom liste — ikke en feil. */
const PLAN_JS = `
  try {
    const H = window.__huskis;
    const nå = Date.now();
    const plan = H.planNotifications(H.state, nå, H.notifPrefs) || [];
    return plan.filter((r) => r.at > nå).map((r) => ({
      key: r.key, at: r.at, type: r.type, name: r.name,
      obj_type: r.obj_type, obj_id: r.obj_id,
      id: H.nativeNotifId(H.nativeNotifSig(r)),
    }));
  } catch (e) { return []; }
`;

/* Tre syntetiske rader, og de går gjennom NØYAKTIG den samme adapteren: samme
   diff, samme kanal, samme ikoner, samme `extra`. Nøklene er merket, så de ikke
   kan forveksles med en ekte. */
const riggPlan = (nå) => RIG_AHEAD_MIN.map((min, i) => ({
  key: 'hk-rig:' + i + '@' + nå,
  at: nå + min * 60000,
  type: i % 2 ? 'dueSoon' : 'startSoon',
  name: 'Huskis-rigg ' + (i + 1),
  obj_type: 'card',
  obj_id: '00000000-0000-4000-8000-00000000000' + (i + 1),
}));

const sync = (plan, ned) => bro.evalJs(
  'await window.__huskis.androidChannel.sync(' + JSON.stringify(plan) + ', ' +
  (ned ? 'true' : 'false') + '); return true;');

const medId = (plan) => bro.evalJs(
  'const H = window.__huskis; return ' + JSON.stringify(plan) +
  '.map((r) => Object.assign({}, r, { id: H.nativeNotifId(H.nativeNotifSig(r)) }));');

const pluginPending = () => bro.evalJs(
  'const r = await window.Capacitor.Plugins.LocalNotifications.getPending();' +
  'return ((r && r.notifications) || []).map((n) => Number(n.id));');

/* ------------------------------------------------------------------- runden */

function planUtskrift() {
  console.log(`Runden, i rekkefølge (ingenting kjøres med --plan):

  A  oppsett: adb, én enhet, riktig pakke, varseltillatelse, DevTools-broen — og
     at appen kjører NØYAKTIG den web-bundelen som ble bygget (A4). Radioen slås
     AV for hele runden (A5), og HVER oppstart etterpå voktes: driver identiteten,
     stopper runden der og da
  B  kanalen: huskis-notif-v1 finnes på enheten, med HØY viktighet og vibrasjon
  C  subjektet: enhetens egen plan (LIVE) eller tre riggalarmer (RIGG)
  D  alarmene ligger i Androids kø — én per terskel, på riktig tidspunkt,
     upresise og vekkende, og uten SCHEDULE_EXACT_ALARM i den installerte APK-en
  E  en vanlig appomstart rører dem ikke: samme kø, og ingen cancel/schedule
  F  prosessen fjernet (am kill, ikke force-stop): køen står
  G  telefonen restartet: pluginens oppstartsmottaker stiller dem opp igjen
  L  tidssonebytte MENS APPEN ER LUKKET: alarmene flytter seg til samme veggtid,
     de gamle tidspunktene er borte, og sonen tilbake gir dem tilbake
  H  en alarm som forfaller blir POSTET på Huskis-kanalen, rangert HIGH —
     planlagt og levert med radioen AV
  I  trykk fra KALDSTART: pekeren kommer fram i appen, og varselet forsvinner
  J  brukerbytte: forrige brukers alarmer ryddes bort
  K  opprydning: riggen er borte, eller den ekte planen er tilbake

  Og de tre punktene bare et øye kan svare på, skrevet ut til slutt.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--plan')) { planUtskrift(); return 0; }
  const utenReboot = args.includes('--no-reboot');
  const apkFlagg = args.indexOf('--install');
  const ventet = ventetBuild(args);

  console.log('════════ Huskis — Android-varslene på enhet ════════');
  console.log('pluginen formene er lest av: @capacitor/local-notifications ' +
    PLUGIN_VERSION + '\n');

  /* ---------------------------- A. Oppsett ---------------------------- */
  /* Bare linjer der andre felt er `device`. `adb devices` kan også skrive
     «* daemon not running…» på stdout, og en enhet som er `offline`,
     `unauthorized` eller `recovery` er ikke en enhet vi kan måle på. */
  const enheter = adb(['devices'], { tillatFeil: true }).split('\n').slice(1)
    .map((l) => l.trim()).filter((l) => /^\S+\s+device$/.test(l));
  check('A1 én tilkoblet enhet', enheter.length === 1 || (!!SERIAL && enheter.length > 0),
    enheter.join(' | ') || 'ingen');
  if (!enheter.length) {
    console.log('\nIngen enhet. Koble til telefonen, eller start emulatoren.');
    return 1;
  }

  if (apkFlagg >= 0 && args[apkFlagg + 1]) {
    const apk = path.resolve(args[apkFlagg + 1]);
    sier('installerer ' + path.relative(ROOT, apk));
    adb(['install', '-r', '-g', apk], { timeout: 600000 });
  }

  const sdk = Number(sh('getprop ro.build.version.sdk').trim()) || 0;
  sier('Android API ' + sdk + ' — ' + sh('getprop ro.product.model').trim());
  const installert = sh('pm path ' + PKG, { tillatFeil: true }).includes('package:');
  check('A2 Huskis er installert', installert);
  if (!installert) {
    console.log('\nInstaller debug-APK-en først: --install <apk>');
    return 1;
  }

  /* Skjermen skal stå på hele runden. En alarm er UPRESIS med vilje, og en
     telefon som sovner kan holde den igjen i minutter (dvalekvoten,
     docs/varsler.md) — det er plattformoppførsel, men det gjør ikke en
     testrunde bedre. */
  sh('svc power stayon true', { tillatFeil: true });
  sh('input keyevent 224', { tillatFeil: true });      // KEYCODE_WAKEUP

  /* POST_NOTIFICATIONS er en kjøretidstillatelse fra Android 13. Dialogen hører
     til bryteren i appen og skal ALDRI komme av seg selv (docs/varsler.md), så
     harnesset gir tillatelsen gjennom `pm grant` i stedet for å trykke seg
     gjennom en dialog som ikke skal finnes her. */
  if (sdk >= 33) {
    sh('pm grant ' + PKG + ' android.permission.POST_NOTIFICATIONS', { tillatFeil: true });
  }

  /* RADIOEN AV FØR APPEN STARTER FØRSTE GANG, og det er ikke en detalj: appen
     spør etter en OTA-oppdatering ved oppstart, og finner den en nyere bundle
     laster den den ned og bytter web-koden. Da måler runden en annen kode enn den
     som nettopp ble bygget. Uten nett kan ikke det skje i det hele tatt.

     Den blir stående av HELE runden, i begge modi. Det er ikke forsiktighet for
     sin egen skyld: appen kan bytte bundle ved en senere oppstart (E, G, H, I, J,
     K), og motoren i `update-check.js` kan til og med laste den om MIDT i en økt
     når den finner en nyere. Uten nett kan ingen av dem skje. Telefonen får
     nettet tilbake når runden er over — verifisert, også når den blir avbrutt.

     Appen drepes først, for radioen hjelper ikke mot en prosess som alt kjører
     med en nedlastet bundle: den FØRSTE oppstarten i runden skal være uten nett. */
  await drepApp();
  const radioenAv = settFlymodus(true);

  await appenOpp('A oppsett');
  const tillatelse = await bro.evalJs('return await window.__huskis.androidChannel.state();');
  const tillatt = tillatelse === 'on' || tillatelse === 'off';
  check('A3 DevTools-broen svarer, og varsler er tillatt på enheten', tillatt, tillatelse);
  if (!tillatt) {
    console.log('\nVarsler er ikke tillatt for Huskis på denne enheten (' + tillatelse +
      '). Slå dem på i Huskis, eller gi tillatelsen i Androids appinnstillinger, og kjør igjen.');
    return 1;
  }

  /* A4: KJØRER VI KODEN VI TROR? Før en eneste måling. En runde som måler en
     annen bundle enn den som ble bygget, svarer på et annet spørsmål — og svaret
     ser ut som en feil i endringen. */
  if (!(await vaktBundle('A4', ventet))) {
    console.log('\nAppen kjører en ANNEN web-bundle enn den som ble bygget. ' +
      'Runden stopper her: målinger i feil kode er verre enn ingen målinger. ' +
      'Installer debug-APK-en på nytt (--install) og kjør igjen.');
    return 1;
  }
  /* … og FRA NÅ voktes hver enkelt oppstart. `ventetBundle` er det som armerer
     `krevRiktigBundle()`, og den sitter i `appenOpp()`/`ventPåBro()` — altså i
     hvert eneste sted runden kan få en app i hendene. */
  ventetBundle = ventet;

  /* A5 er forutsetningen for at én vakt per oppstart er NOK: uten nett kan ikke
     bundelen byttes mellom dem heller. Fikk vi ikke slått av radioen, er runden
     rød — da kan vi ikke love at koden sto stille, og det skal synes. Runden
     fortsetter likevel, for vakten ved hver oppstart er fortsatt et net. */
  check('A5 radioen er AV, så ingen oppdatering kan bytte koden under runden',
    radioenAv, { flymodus: flymodus() });
  if (!radioenAv) {
    sier('FIKK IKKE slått av radioen herfra. Vakten ved hver oppstart står, men ' +
      'en oppdatering kan fortsatt komme mellom to av dem — runden rapporteres rød.');
  }

  /* --------------------------- C. Subjektet --------------------------- */
  const eier = await bro.evalJs('return window.__huskis.nativePlanOwner() || null;');
  /* «Innlogget» og «LIVE» er IKKE det samme, og forskjellen avgjør hva en
     opprydning får gjøre. LIVE krever i tillegg at varslene er på og at planen
     framover ikke er tom — en innlogget bruker uten kommende varsler kjører altså
     RIGG. Der ville en `force-stop` ved avbrudd tatt hennes app inn i Androids
     «stopped state» for ingenting. Økten leses derfor av `authUser`, for seg. */
  /* … og «tilhører en konto» er bredere enn «har en levende økt»: et eiermerke
     betyr at alarmene på enheten er en konto sine, og da skal en `force-stop`
     ikke komme på tale. Runden starter dessuten UTEN nett (A), og en økt som må
     fornyes rekker ikke alltid å svare da — merket gjør vurderingen uavhengig av
     det. */
  const harØkt = !!(await bro.evalJs('return !!window.__huskis.authUser;')) || !!eier;
  åGjenopprette.harØkt = harØkt;
  let plan = await bro.evalJs(PLAN_JS);
  const live = tillatelse === 'on' && !!eier && plan.length > 0;
  let rigg = null;

  sier('flymodus står på hele runden: ingenting som måles trenger nett, og da kan ' +
    'ingen oppdatering bytte web-bundelen mellom målingene');
  if (live) {
    check('C1 LIVE: enheten har en innlogget bruker med en plan framover', true,
      plan.length + ' terskler, eier ' + eier.slice(0, 8));
  } else {
    rigg = riggPlan(await bro.evalJs('return Date.now();'));
    /* Id-ene FØRST: fra nå kan et avbrudd etterlate dem armert, og opprydningen
       må vite nøyaktig hvilke som er riggens. */
    plan = await medId(rigg);
    åGjenopprette.riggIder = plan.map((r) => r.id);
    await sync(rigg, false);
    check('C1 RIGG: tre syntetiske alarmer planlagt gjennom den ekte adapteren',
      plan.length === RIG_AHEAD_MIN.length,
      { innlogget: harØkt, eiermerke: !!eier, varsler: tillatelse });
    sier(harØkt ? 'innlogget, men ingen plan framover — brukerbyttet (J3) kan ikke prøves her'
      : 'ingen innlogget bruker — brukerbyttet (J3) kan ikke prøves her');
  }

  /* ---------------------------- B. Kanalen ----------------------------
     ETTER subjektet, og det er ikke en detalj: kanalen opprettes av adapterens
     FØRSTE speilingsrunde (`ensureNativeChannel`), ikke ved oppstart. Spør man
     før den runden har gått, svarer enheten med pluginens egen `default` — og
     det ville sett ut som en manglende kanal i stedet for en sjekk som kom for
     tidlig. */
  const kanalId = await bro.evalJs('return window.__huskis.NATIVE_CH_ID;');
  const kanaler = await bro.evalJs(
    'const ln = window.Capacitor.Plugins.LocalNotifications;' +
    'if (!ln.listChannels) return null;' +
    'try { const r = await ln.listChannels(); return (r && r.channels) || []; }' +
    'catch (e) { return null; }');
  if (sdk < 26 || kanaler === null) {
    skip('B1 kanalen finnes på enheten', 'Android uten kanaler (API ' + sdk + ')');
  } else {
    const k = kanaler.find((c) => c.id === kanalId);
    check('B1 kanalen ' + kanalId + ' finnes på enheten', !!k,
      kanaler.map((c) => c.id).join(', ') || 'ingen');
    check('B2 … med HØY viktighet (4) og vibrasjon',
      !!k && Number(k.importance) === 4 && k.vibration !== false,
      k ? { importance: k.importance, vibration: k.vibration, name: k.name } : '-');
  }


  /* ------------------- D. Alarmene ligger i Androids kø ------------------- */
  const pending = await pluginPending();
  const venteIder = plan.map((r) => r.id);
  check('D1 pluginens lagring holder de ID-ene Huskis regnet ut',
    venteIder.length > 0 && venteIder.every((id) => pending.includes(id)),
    { plan: venteIder.length, lagret: pending.length });

  await drepApp();                 // køen leses UTEN at appen kan endre den
  let kø = alarmKø();
  check('D2 Androids alarmkø har én armert alarm per terskel i planen',
    kø.length === plan.length && kø.length > 0, { kø: kø.length, plan: plan.length });
  const planTider = plan.map((r) => r.at).sort((a, b) => a - b);
  const køTider = tider(kø);
  if (!kø.length || køTider.length !== kø.length) {
    skip('D3 tidspunktene stemmer med planen', 'leste ingen tid i dumpsys på API ' + sdk);
  } else {
    check('D3 … og på de tidspunktene planen sier', sammeTider(køTider, planTider),
      { kø: køTider.map(lesbar), plan: planTider.map(lesbar) });
  }
  check('D4 alarmene er vekkende og UPRESISE (setAndAllowWhileIdle)',
    kø.length > 0 && kø.every((a) => a.type === 'RTC_WAKEUP'),
    kø.map((a) => a.type || '?').join(', ') || '-');
  /* … og at tilbaketrekkingen i manifestet holdt HELE veien: en pakke som ber om
     SCHEDULE_EXACT_ALARM har fått den inn igjen fra et bibliotek. */
  const pmDump = sh('dumpsys package ' + PKG, { tillatFeil: true });
  check('D5 den installerte APK-en ber ikke om SCHEDULE_EXACT_ALARM',
    !/SCHEDULE_EXACT_ALARM/.test(pmDump),
    (pmDump.match(/android\.permission\.(POST_NOTIFICATIONS|SCHEDULE_EXACT_ALARM|RECEIVE_BOOT_COMPLETED)/g) || [])
      .filter((v, i, a) => a.indexOf(v) === i).join(', '));

  const fasit = { antall: kø.length, tider: køTider };

  /* ----------------------- E. En vanlig appomstart ----------------------- */
  tømLogg();
  await appenOpp('E appomstart');
  await sov(8000);                 // la oppstarten få gjøre det den gjør
  const kall = broKall();
  await drepApp();
  kø = alarmKø();
  check('E1 en vanlig appomstart etterlater køen uendret',
    kø.length === fasit.antall && sammeTider(tider(kø), fasit.tider),
    { før: fasit.antall, etter: kø.length });
  if (live && kall.length) {
    check('E2 … og appen verken avlyste eller planla noe over broen',
      !kall.includes('cancel') && !kall.includes('schedule'), kall.join(', '));
  } else if (live) {
    skip('E2 appen avlyste eller planla ingenting over broen',
      'ingen speilingsrunde rakk over broen i vinduet — evidensen mangler, og fravær er ikke bevis');
  } else {
    skip('E2 appen avlyste eller planla ingenting over broen',
      'ingen innlogget plan: oppstarten speiler ingenting å sammenligne med');
  }

  /* ------------------------ F. Prosessen fjernet ------------------------ */
  check('F1 prosessen er borte (am kill, ikke force-stop)', !pid(), pid() || 'ingen pid');
  kø = alarmKø();
  check('F2 … og alarmene står fortsatt i Androids kø',
    kø.length === fasit.antall && sammeTider(tider(kø), fasit.tider), kø.length + ' alarmer');

  /* ------------------------- G. Telefonrestart ------------------------- */
  if (utenReboot) {
    /* Uten en ekte omstart prøves LEDDET i stedet: pluginens
       oppstartsmottaker. Kringkastingen er beskyttet, men adb-skallet får sende
       den. Det er ikke plattformens rydding — det er mottakeren. */
    sh('am broadcast -a android.intent.action.BOOT_COMPLETED -p ' + PKG, { tillatFeil: true });
    await sov(6000);
    kø = alarmKø();
    check('G1 oppstartsmottakeren stiller alarmene opp igjen',
      kø.length === fasit.antall && sammeTider(tider(kø), fasit.tider), kø.length + ' alarmer');
    sier('--no-reboot: at Android TØMMER køen ved en omstart er ikke prøvd her');
  } else {
    sier('restarter enheten — dette tar et par minutter');
    if (bro) { bro.lukk(); bro = null; }
    /* Oppetiden FØR, fordi `wait-for-device` og `sys.boot_completed` kan svare
       fra den ENNÅ KJØRENDE enheten: adb-forbindelsen rekker ikke alltid å dø
       før vi spør. En omstart er bevist først når oppetiden har FALT — uten det
       kunne hele punktet bestått uten at enheten var nede. */
    const oppetidFør = oppetid();
    adb(['reboot'], { tillatFeil: true });
    await sov(8000);
    adb(['wait-for-device'], { timeout: REBOOT_MS, tillatFeil: true });
    const oppe = await ventTil(() => {
      if (sh('getprop sys.boot_completed', { tillatFeil: true }).trim() !== '1') return null;
      const nåOppe = oppetid();
      return nåOppe > 0 && nåOppe < oppetidFør ? nåOppe : null;
    }, REBOOT_MS, 3000);
    check('G1 enheten var FAKTISK nede og kom opp igjen (oppetiden falt)', !!oppe,
      { før: Math.round(oppetidFør) + 's', etter: oppe ? Math.round(oppe) + 's' : '?' });
    if (oppe) {
      sh('input keyevent 82', { tillatFeil: true });   // lås opp en enhet uten PIN
      sh('svc power stayon true', { tillatFeil: true });
      /* Alarmene er tilbake når pluginens mottaker har kjørt. Er enheten
         kryptert og låst, venter den på opplåsingen — derfor en lang frist, og
         en beskjed i stedet for et nederlag. */
      const tilbake = await ventTil(() => {
        const k = alarmKø();
        return k.length === fasit.antall ? k : null;
      }, RESTORE_MS, 5000);
      check('G2 alarmene er stilt opp igjen, på de samme tidspunktene',
        !!tilbake && sammeTider(tider(tilbake), fasit.tider),
        tilbake ? tilbake.length + ' alarmer' :
          alarmKø().length + ' alarmer — lås opp telefonen om den har PIN');
    }
  }

  /* ------------- L. Tidssonebytte MENS APPEN ER HELT LUKKET ------------- */
  /* Det vanskeligste punktet i den fysiske runden, og det eneste som krever et
     bestemt oppsett: appen er borte, sonen endres, og ingen JS kan rette noe.
     Det er `TimeZoneAlarmReceiver` som må gjøre jobben — og den lever av
     kringkastingen, ikke av at appen kjører.

     Retningen er valgt med vilje: VESTOVER, til en sone med mindre avvik, så den
     samme veggtiden peker på et SENERE absolutt tidspunkt. Østover ville flyttet
     alarmene bakover, kanskje forbi «nå» — og en alarm som alt har ringt skal
     ikke røres (`HuskisWallClock`). */
  const sone0 = sonen();
  const MÅLSONE = 'Pacific/Honolulu';          // UTC-10, uten sommertid
  if (!fasit.antall || !sone0 || sone0 === MÅLSONE) {
    skip('L1 et tidssonebytte med appen lukket flytter alarmene',
      'ingen alarmer å flytte, eller ukjent sone (' + (sone0 || '-') + ')');
  } else if ((sier('bytter enhetens tidssone til ' + MÅLSONE + ' en liten stund, og tilbake'),
    tømLogg(), åGjenopprette.sone = sone0, !(await settSone(MÅLSONE)))) {
    skip('L1 et tidssonebytte med appen lukket flytter alarmene',
      'enheten lot seg ikke bytte sone herfra (' + sone0 + ')');
  } else {
    const ventet = fasit.tider.map((t) => t + soneAvvik(sone0, t) - soneAvvik(MÅLSONE, t));
    const flyttet = await ventTil(() => {
      const k = alarmKø();
      return k.length === fasit.antall && sammeTider(tider(k), ventet) ? k : null;
    }, 60000, 4000);
    check('L1 et tidssonebytte med appen lukket flytter alarmene til samme VEGGTID',
      !!flyttet, {
        sone: sone0 + ' → ' + MÅLSONE,
        ventet: ventet.map(lesbar),
        fikk: tider(alarmKø()).map(lesbar),
      });
    const tzKall = broKall();
    check('L2 … og de gamle tidspunktene er BORTE, ikke liggende ved siden av',
      !!flyttet && !tider(flyttet).some((t) => fasit.tider.some((g) => Math.abs(g - t) <= TOL_MS)),
      tider(alarmKø()).length + ' alarmer');
    /* Prosessen er gjerne STARTET av kringkastingen — mottakeren kjører i den —
       men WebView-en og JS-en gjorde ingenting. Evidensen er broLOGGEN: hadde
       adapteren rettet alarmene, ville `getPending` og `schedule` stått der. */
    check('L3 ingen JS rørte alarmene — det var den native mottakeren',
      !tzKall.includes('schedule') && !tzKall.includes('cancel') &&
      !tzKall.includes('getPending'),
      tzKall.join(', ') || 'ingen kall over broen');
    /* … og tilbake. Omregningen skal være symmetrisk: veggtiden i `extra` er
       uendret, så den opprinnelige sonen gir de opprinnelige tidspunktene. */
    const tilbakeSatt = await settSone(sone0);
    if (tilbakeSatt) åGjenopprette.sone = null;
    const tilbakeTider = await ventTil(() => {
      const k = alarmKø();
      return k.length === fasit.antall && sammeTider(tider(k), fasit.tider) ? k : null;
    }, 60000, 4000);
    check('L4 sonen tilbake gir de opprinnelige tidspunktene igjen',
      !!tilbakeTider, tider(alarmKø()).map(lesbar));
  }

  /* ----------------- H. En alarm som forfaller blir POSTET ----------------- */
  await appenOpp('H etter omstart');

  /* Og vakten EN GANG TIL: enheten har vært gjennom en ekte omstart siden A4, og
     en oppstart er nettopp der appen spør etter en OTA-oppdatering. Driver
     identiteten nå, er målingene under målt i feil kode. */
  if (!(await vaktBundle('A4b', ventet))) {
    console.log('\nAppen kjører en ANNEN web-bundle enn den som ble bygget, etter ' +
      'omstarten. Runden stopper her.');
    return 1;
  }

  const nå = await bro.evalJs('return Date.now();');
  const snart = {
    key: 'hk-rig:snart@' + nå,
    at: nå + SOON_S * 1000,
    type: 'dueOver',
    name: 'Huskis-rigg forfaller',
    obj_type: 'card',
    obj_id: '00000000-0000-4000-8000-0000000000ff',
  };
  /* OFFLINE, begge veier: radioen slås av FØR alarmen planlegges, og står av til
     varselet har kommet. Da er både «offline når fristen settes» og «offline ved
     tidspunktet» prøvd i ett — kanalen er lokal, og ingen server er involvert i
     noen av leddene. */
  sier(flymodus() ? 'radioen er alt av — alarmen planlegges og leveres uten nett'
    : 'slår på flymodus mens alarmen planlegges og leveres');
  const offline = settFlymodus(true);
  /* HELE planen, ikke bare den nye raden: `sync` er en diff mot det telefonen
     har, så en plan uten de andre alarmene ville avlyst dem. */
  const medSnart = (live ? await bro.evalJs(PLAN_JS) : rigg).concat([snart]);
  const snartId = (await medId([snart]))[0].id;
  // … og den er syntetisk i BEGGE modi, så opprydningen må kjenne den.
  åGjenopprette.riggIder = åGjenopprette.riggIder.concat([snartId]);
  await sync(medSnart, false);
  await drepApp();                 // varselet skal komme med appen BORTE
  /* NØYAKTIG dette varselet, ikke «et varsel fra Huskis»: på en telefon i bruk
     kan panelet alt ha en Huskis-rad liggende, og da ville et søk på pakkenavnet
     bestått før alarmen i det hele tatt fyrte. Derfor id-en. */
  const postet = await ventTil(() => {
    const d = varselDump();
    if (d === null) return null;            // uleselig dump er ikke et svar
    const idRe = new RegExp('\\bid=' + snartId + '\\b');
    const poster = d.split('NotificationRecord(');
    const min = poster.find((b) => b.includes('pkg=' + PKG) && idRe.test(b));
    if (min) return min.slice(0, 1800);
    const m = idRe.exec(d);                      // en dump uten NotificationRecord-blokker
    if (!m) return null;
    const rundt = d.slice(Math.max(0, m.index - 400), m.index + 1500);
    return rundt.includes('pkg=' + PKG) ? rundt : null;
  }, POST_MS, 5000);
  check('H1 alarmen ble levert som et systemvarsel med appen borte', !!postet,
    postet ? 'varsel ' + snartId + ' står i panelet'
      : 'varsel ' + snartId + ' kom ikke innen ' + (POST_MS / 1000) + ' s');
  if (postet) {
    check('H2 … på Huskis-kanalen', postet.includes('channel=' + kanalId),
      (postet.match(/channel=[\w-]+/) || ['?'])[0]);
    /* Android skriver rangeringen enten som ORD (`importance=HIGH`) eller som
       TALL (`importance=4`) — API 36 gjør det siste. 4 ER IMPORTANCE_HIGH og 5
       IMPORTANCE_MAX, så begge formene må leses; ellers feller sjekken et varsel
       som faktisk ble rangert høyt. */
    check('H3 … og rangert HIGH av Android (forutsetningen for heads-up)',
      /importance=(HIGH|MAX|4|5)\b/.test(postet),
      (postet.match(/importance=\w+/g) || ['leste ingen importance']).join(' '));
  }
  if (offline) {
    check('H4 … planlagt OG levert med radioen av — kanalen er lokal',
      !!postet && flymodus(), { flymodus: flymodus() });
  } else {
    skip('H4 planlagt og levert med radioen av',
      'fikk ikke slått på flymodus herfra — runden gikk med nett');
  }
  /* Radioen blir stående av. Resten av runden er like lokal som dette punktet, og
     opprydningen er den som slår den på igjen — verifisert. */

  /* --------------------- I. Trykk fra KALDSTART --------------------- */
  /* Prosessen drepes på nytt her, og det er ikke overflødig: selve alarmen
     STARTET den (pluginens kringkastingsmottaker kjører i appens prosess, uten
     WebView og uten JS). Et trykk skal prøves mot en prosess som er helt borte —
     det er da pekeren må vente på innlogging og første synk. */
  await drepApp();
  const kaldt = !pid();
  const kilde = JSON.stringify({
    id: snartId,
    extra: { objType: snart.obj_type, objId: snart.obj_id, key: snart.key },
  });
  if (bro) { bro.lukk(); bro = null; }
  tømLogg();
  sh(tapKommando(snartId, kilde), { tillatFeil: true });
  /* TRYKKET skal være det som starter appen. `ventPåBro` sender derfor ingen
     intent — et `am start` oppå dette ville vært en ny intent inn i den samme
     aktiviteten, og da måler vi ikke lenger trykket. Kommer appen likevel ikke
     opp, er DET funnet, og `appenOpp` er bare siste utvei for å få lest noe. */
  const fraTrykket = !!(await ventPåBro(60000, 'I kaldstart fra trykket'));
  if (!fraTrykket) await appenOpp('I siste utvei');
  const truffet = await ventTil(async () => {
    const svar = await bro.evalJs(
      'const H = window.__huskis;' +
      'return { tapped: [...(H.notifChannelTapped || [])], peker: H.notifPendingTarget || null };');
    return (svar.tapped.length || svar.peker) ? svar : null;
  }, 30000, 1000);
  check('I1 appen ble startet av trykket (kaldstart)', kaldt && fraTrykket,
    { prosessenVarBorte: kaldt, komOppAvTrykket: fraTrykket });
  /* Og HVOR kjeden brøt, hvis den brøt: pluginen → JS → appen. Uten sporet er
     «ingen peker» et nederlag uten adresse. */
  const spor = trykkSpor();
  check('I2 pekeren fra varselet kom fram i appen',
    !!truffet && (truffet.tapped.includes(snart.key) ||
      !!(truffet.peker && truffet.peker.id === snart.obj_id)),
    truffet || { pekerIkkeSett: true, sporet: spor });
  if (truffet && truffet.peker) {
    check('I3 … og den PARKERTE pekeren peker på riktig objekt',
      truffet.peker.type === snart.obj_type && truffet.peker.id === snart.obj_id,
      truffet.peker);
  } else {
    skip('I3 den parkerte pekeren peker på riktig objekt',
      'pekeren ble tatt med én gang — appen var innlogget og synket');
  }
  /* … og den VARME veien, som skiller to helt ulike funn fra hverandre: kommer
     pekeren fram når appen ALT kjører, men ikke fra en kaldstart, er det
     kaldstarten som er hullet (den retainede hendelsen fra pluginen). Kommer den
     ikke fram noen av veiene, er det selve koblingen plugin → JS. */
  if (!truffet) {
    tømLogg();
    sh(tapKommando(snartId, kilde), { tillatFeil: true });
    const varmt = await ventTil(async () => {
      const svar = await bro.evalJs(
        'const H = window.__huskis;' +
        'return { tapped: [...(H.notifChannelTapped || [])], peker: H.notifPendingTarget || null };');
      return (svar.tapped.length || svar.peker) ? svar : null;
    }, 20000, 1000);
    const varmtSpor = trykkSpor();
    const traff = !!varmt && (varmt.tapped.includes(snart.key) ||
      !!(varmt.peker && varmt.peker.id === snart.obj_id));
    if (!traff && varmtSpor.utenId) {
      /* Android gjenopptok oppgaven uten å levere intenten vår — pluginen sier
         det selv. Sonden kan da ikke måle noe, og et FAIL ville vært en påstand
         om appen som evidensen ikke bærer. */
      skip('I2b den kommer fram når appen ALT kjører (varm intent)',
        'Android gjenopptok oppgaven uten å levere intenten (launcher-semantikk) — ' +
        'ikke målbart med `am start`');
    } else {
      check('I2b … og den kommer fram når appen ALT kjører (varm intent)', traff,
        varmt || { pekerIkkeSett: true, sporet: varmtSpor });
    }
  }

  const panelEtter = postet ? varselDump() : null;
  if (postet && panelEtter !== null) {
    check('I4 varselet er borte fra panelet etter trykket',
      !new RegExp('\\bid=' + snartId + '\\b').test(panelEtter), 'autoCancel');
  } else {
    skip('I4 varselet er borte fra panelet etter trykket',
      postet ? 'varselpanelet lot seg ikke lese' : 'H1 leverte ingen varsel å trykke på');
  }

  /* --------------------------- J. Brukerbytte --------------------------- */
  if (live) {
    /* Et ekte brukerbytte, uten en andre konto: enhetens eiermerke settes til
       en ANNEN uid — nøyaktig det en innlogging fra en annen konto etterlater.
       Neste oppstart leser merket, ser «en annens», og rigger ned før den nye
       planen gjelder (docs/varsler.md, «Oppstart og brukerbytte»). */
    tømLogg();
    await bro.evalJs('localStorage.setItem(window.__huskis.NATIVE_OWNER_KEY, ' +
      JSON.stringify('00000000-0000-4000-8000-ffffffffffff') + '); return true;');
    await drepApp();
    await appenOpp('J brukerbytte');
    await sov(10000);
    const etter = broKall();
    const nyEier = await bro.evalJs('return window.__huskis.nativePlanOwner() || null;');
    check('J1 en annen brukers merke utløser nedriggingen ved oppstart',
      etter.includes('cancel'), etter.join(', ') || 'ingen kall');
    check('J2 … og enheten står igjen som denne brukerens',
      nyEier === eier, { før: eier, etter: nyEier });
    skip('J3 nedriggingen tømmer Androids alarmkø',
      'måles i RIGG-modus — her ville den tatt brukerens egne alarmer');
  } else {
    /* Uten en økt finnes brukerbyttet ikke — men NEDRIGGINGEN finnes, og det er
       den som rydder. At den faktisk tømmer ANDROIDS kø, og ikke bare pluginens
       lagring, er det eneste enheten kan svare på her. */
    await sync([], true);
    await drepApp();
    const tom = alarmKø();
    await appenOpp('J nedrigging');
    const merke = await bro.evalJs('return window.__huskis.nativePlanOwner() || null;');
    check('J1 nedriggingen tømmer Androids alarmkø', tom.length === 0, tom.length + ' alarmer');
    check('J2 … og enheten står igjen uten eier', merke === null, merke);
    skip('J3 et reelt brukerbytte rydder forrige brukers alarmer',
      'krever en innlogget bruker — dekket av notif-channels 14 mot en fake bro');
  }

  /* --------------------------- K. Opprydning --------------------------- */
  if (live) {
    await bro.evalJs('await window.__huskis.syncNotifChannel(); return true;');
    await sov(4000);
    const ekte = await bro.evalJs(PLAN_JS);
    await drepApp();
    const slutt = alarmKø();
    const iTakt = slutt.length === ekte.length &&
      sammeTider(tider(slutt), ekte.map((r) => r.at).sort((a, b) => a - b));
    if (iTakt) åGjenopprette.riggIder = [];    // ingen syntetisk rad står igjen
    check('K1 den ekte planen står igjen på enheten, og riggen er borte', iTakt,
      { kø: slutt.length, plan: ekte.length });
  } else {
    await sync([], true);
    await drepApp();
    const tom = alarmKø().length === 0;
    if (tom) åGjenopprette.riggIder = [];
    check('K1 riggen er ryddet bort — enheten er som før runden', tom);
  }
  if (bro) { bro.lukk(); bro = null; }
  await ryddEnheten();

  /* ---------------------------- rapporten ---------------------------- */
  const feil = results.filter((r) => r.ok === false);
  const hoppet = results.filter((r) => r.ok === null);
  console.log('\n════════ Oppsummering ════════');
  console.log(results.filter((r) => r.ok === true).length + ' passed, ' + feil.length +
    ' failed, ' + hoppet.length + ' skipped   (' +
    (live ? 'LIVE — enhetens egen plan' : 'RIGG — syntetiske alarmer') + ')');
  feil.forEach((r) => console.log('  ✗ ' + r.navn));

  console.log(`
════════ Og de tre punktene et ØYE må svare på ════════
Android eier presentasjonen, og ingen dump kan bekrefte den:

  1. HEADS-UP. La et varsel forfalle med skjermen på: legger banneret seg over
     skjermen, med lyd eller vibrasjon?
  2. LÅSESKJERM. Lås telefonen og la det neste forfalle: står det slik DU vil ha
     det? (Android bestemmer om navnet vises — innstillingen er telefonens.)
  3. FINGEREN. Trykk på varselet i panelet: åpner Huskis riktig objekt?

Alt annet i den fysiske runden er målt over.`);

  return feil.length ? 1 : 0;
}

/* Lesingen av `dumpsys alarm`, sammenligningen av to tidssett og formen på
   tapp-kommandoen er RENE funksjoner, og de er de eneste delene av runden som
   kan prøves uten en telefon. `tests/android-alarm-queue.test.js` krever derfor
   fila inn og kjører dem mot ekte dumper fra flere Android-versjoner — så en
   formendring i parseren felles av den vanlige node-runden. */
module.exports = {
  alarmKø, lesTid, sammeTider, soneAvvik, tapKommando,
  TAP, PUBLISHER, PKG, PLUGIN_VERSION,
};

if (require.main === module) {
  /* Ctrl-C er den vanligste måten en manuell runde ender på, og den går ikke
     gjennom noen av grenene under: løftet blir aldri oppgjort, og telefonen står
     igjen i flymodus eller på en annen tidssone. Signalene får derfor samme
     opprydning, og avslutter med signalets egen kode (128 + nummer). */
  let rydder = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      // Et andre trykk avslutter straks: opprydningen skal ikke kunne holde en
      // Ctrl-C som gissel.
      if (rydder) process.exit(130);
      rydder = true;
      console.error('\n✗ Avbrutt (' + sig + ') — rydder enheten før jeg går.');
      // Systeminnstillingene FØRST, og de prøves på nytt til de er lest tilbake
      // som riktige. Så alarmene. Hele opprydningen har ett samlet tak, så et
      // avbrudd ikke kan bli hengende.
      Promise.race([
        (async () => { await ryddEnheten(); await ryddRiggAlarmer(); })(),
        sov(RYDD_SYS_MS + RYDD_MS),
      ]).catch(() => {}).then(() => process.exit(sig === 'SIGINT' ? 130 : 143));
    });
  }
  const avslutt = async (kode) => {
    await Promise.race([
      (async () => { await ryddEnheten(); await ryddRiggAlarmer(); })(),
      sov(RYDD_SYS_MS + RYDD_MS),
    ]).catch(() => {});
    process.exit(kode);
  };
  main().then(avslutt).catch((e) => {
    console.error('\n✗ Runden stoppet: ' + ((e && e.message) || e));
    // Telefonen skal ikke bli stående i flymodus, på en annen tidssone eller med
    // riggens alarmer armert fordi runden brøt sammen.
    avslutt(1);
  });
}
