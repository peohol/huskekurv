/*
  Regresjonstest: ENHETSRUNDEN FOR DE NATIVE VARSLENE (tests/android-device.js).

  Harnesset kjører mot en ekte telefon eller emulator og kan ikke kjøres her.
  Men to ting i det KAN prøves uten en enhet, og de er nettopp de to som ville
  gjort en grønn runde verdiløs om de var feil:

    · LESINGEN av `dumpsys alarm`. Android skriver tidspunktet i minst tre
      former, og statistikkseksjonene nevner både pakken og pluginens klasse på
      samme form som en armert alarm. En parser som teller historikk som
      framtid, eller som leser null alarmer og kaller det «uendret», ville
      bestått hver runde uten å måle noe. Den kjøres derfor mot ekte dumper her.
    · FORMEN på tapp-intenten. Den er PLUGINENS, ikke vår: tre extras, en
      skrivefeil i den ene nøkkelen, MAIN/LAUNCHER og SINGLE_TOP|CLEAR_TOP. Er
      én av dem feil, starter appen uten peker — og punktet «trykk åpner riktig
      objekt» ville stått som bevist uten å ha prøvd noe.

  Resten av fila låser at kjeden faktisk finnes: at appen eksponerer de to
  observatørene harnesset leser, at runden kjøres av CI på en emulator, og at
  dokumentasjonen skiller maskinelt bevist fra fysisk observert.

  Dekker:
     1. `dumpsys alarm` leses riktig i alle tre tidsformene — og den formaterte
        datoen i ENHETENS sone, ikke vertens — mens statistikkseksjonene ikke
        telles med.
     2. En annen apps alarmer telles ikke, og en tom kø er tom — ikke «uendret».
     3. Sammenligningen av to tidssett: rekkefølge betyr ikke noe, slingringen
        er i minutter, og ulik lengde er aldri likt.
     4. Tapp-intenten bærer pluginens egne nøkler, handlingen og flaggene.
     5. Harnesset er pinnet til pluginversjonen formene er lest av.
     6. `am kill`, aldri `force-stop` — og grunnen står i fila. Og at runden setter
        tilbake det den skrudde på enheten (flymodus, tidssone) uansett utfall.
     7. Appen eksponerer pekeren og de trykkede nøklene, og den siste settes FØR
        innloggingssjekken (ellers er en kaldstart ikke observerbar).
     8. CI kjører runden på en emulator, med en ekte APK — og på app.js, der
        adapteren runden prøver faktisk bor.
     9. Dokumentasjonen skiller maskinelt bevist fra det et øye må se — og
        opprydningen melder seg aldri ferdig uten å ha VERIFISERT at riggens
        alarmer er borte.
    10. Runden måler den bundelen som ble bygget, HELE veien: nettet er av fra
        før den første oppstarten til opprydningen, hver oppstart vokter
        identiteten mot den builden som ble bygget, og en drift STOPPER runden i
        stedet for å bli tolket som en feil i koden.
    11. «Offline» er MÅLT, ikke lest av et flagg — og hver telefoninnstilling
        runden endrer, settes tilbake til den verdien enheten HADDE.
    12. Rekkefølgen etter en ekte omstart (nettet av FØR appen starter), at
        ingenting røres når originaltilstanden er ULESELIG, og at en manglende
        offline-forutsetning FELLER runden i RIGG i stedet for å hoppes over.

  Kjør:
    node tests/android-alarm-queue.test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const les = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const results = [];
const check = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const H = require('./android-device.js');
const harness = les('tests', 'android-device.js');
const appJs = les('app.js');
const wf = les('.github', 'workflows', 'android-device.yml');
const pkgJson = JSON.parse(les('package.json'));

const TAGG = 'tag=*walarm*:no.huskis.app/' +
  'com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher';

/* ---- 1. Lesingen av `dumpsys alarm` ----
   Dumpene under er ekte former, ikke oppdiktede: et moderne Android skriver
   tidspunktet som et RELATIVT avvik (`origWhen=+2h59m…`), et eldre som
   `when=+59m…`, et annet som absolutte millisekunder, og de eldste som en
   formatert dato. Alle fire må gi det samme svaret: et absolutt millisekund. */

const NÅ = 1789300000000;

const MODERNE = `Current Alarm Manager state:
  nowRTC=1789300000000 nowELAPSED=+1d2h
Pending alarm batches: 3
Batch{4f1a2b3 num=1 start=+2h59m59s863ms end=+3h59m59s863ms flgs=0x1}:
  RTC_WAKEUP #0: Alarm{7c9e1d2 type 0 origWhen 1789310799863 whenElapsed +2h59m59s863ms no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP origWhen=+2h59m59s863ms window=+1h0m0s0ms
    policyWhenElapsed: requester=+2h59m59s863ms app_standby=-4h0m0s0ms device_idle=-1ms
    whenElapsed=+2h59m59s863ms maxWhenElapsed=+3h59m59s863ms
    operation=PendingIntent{a1b2c3: PendingIntentRecord{d4e5f6 no.huskis.app broadcastIntent}}
Batch{9a8b7c6 num=1 start=+3h59m59s900ms end=+4h59m59s900ms flgs=0x1}:
  RTC_WAKEUP #0: Alarm{11223344 type 0 origWhen 1789314399900 whenElapsed +3h59m59s900ms no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP origWhen=+3h59m59s900ms window=+1h0m0s0ms
    whenElapsed=+3h59m59s900ms maxWhenElapsed=+4h59m59s900ms
    operation=PendingIntent{bbb: PendingIntentRecord{ccc no.huskis.app broadcastIntent}}
Batch{deadbeef num=1 start=+1h0m0s0ms end=+2h0m0s0ms flgs=0x1}:
  RTC_WAKEUP #0: Alarm{55667788 type 0 origWhen 1789303600000 whenElapsed +1h0m0s0ms com.android.vending}
    tag=*walarm*:com.android.vending/com.google.android.finsky.scheduler.AlarmReceiver
    type=RTC_WAKEUP origWhen=+1h0m0s0ms window=+1h0m0s0ms
    operation=PendingIntent{eee: PendingIntentRecord{fff com.android.vending broadcastIntent}}
  Allow while idle dispatches:
    +1h2m3s4ms = 1 = no.huskis.app
  Top Alarms:
    +5m0s0ms running, 9 wakeups, 42 alarms: no.huskis.app
      ${TAGG}
  Alarm Stats:
  no.huskis.app +1s234ms running, 4 wakeups:
    4 alarms: flg=0x1 ${TAGG}
    7 alarms: flg=0x1 ${TAGG}
`;

const moderne = H.alarmKø(MODERNE, NÅ);
check('1a to armerte Huskis-alarmer leses ut av en moderne dump',
  moderne.length === 2, moderne.length);
check('1b … med tidspunktene regnet ut av det RELATIVE avviket',
  moderne.map((a) => a.at).sort().join(',') ===
    [NÅ + 10799863, NÅ + 14399900].join(','),
  moderne.map((a) => a.at - NÅ));
check('1c statistikkseksjonene er kuttet vekk — historikk er ikke framtid',
  moderne.length === 2 && !moderne.some((a) => /Alarm Stats|Top Alarms/.test(a.blokk)));
check('1d en annen apps alarm telles ikke med — tagget, ikke pakkenavnet, avgjør',
  moderne.length === 2 && !moderne.some((a) => a.at === NÅ + 3600000),
  moderne.map((a) => a.at - NÅ));

const GAMMEL = `Pending alarm batches: 1
Batch{1 num=1 start=+59m59s958ms end=+59m59s958ms flgs=0x0}:
  RTC_WAKEUP #0: Alarm{aaa type 0 when +59m59s958ms no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP whenElapsed=+59m59s958ms when=+59m59s958ms window=-1
    operation=PendingIntent{123: PendingIntentRecord{456 no.huskis.app broadcastIntent}}
  Alarm Stats:
  no.huskis.app +0ms running, 0 wakeups:
    1 alarms: flg=0x0 ${TAGG}
`;
const gammel = H.alarmKø(GAMMEL, NÅ);
check('1e `when=` med relativt avvik leses like godt som `origWhen=`',
  gammel.length === 1 && gammel[0].at === NÅ + 3599958, gammel.map((a) => a.at - NÅ));
check('1f … og «Alarm Stats» uten foranstilte seksjoner kuttes også',
  gammel.length === 1, gammel.length);

const ABSOLUTT = `Pending alarm batches: 1
Batch{1 num=1}:
  RTC_WAKEUP #0: Alarm{bbb type 0 no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP when=1789310799863 window=0 repeatInterval=0 count=0
    operation=PendingIntent{1: PendingIntentRecord{2 no.huskis.app broadcastIntent}}
`;
check('1g absolutte millisekunder leses som de står',
  H.alarmKø(ABSOLUTT, NÅ).map((a) => a.at).join() === '1789310799863',
  H.alarmKø(ABSOLUTT, NÅ).map((a) => a.at));

const DATO = `Pending alarm batches: 1
Batch{1 num=1}:
  RTC_WAKEUP #0: Alarm{ccc type 0 no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP whenElapsed=+1h0m0s0ms when=2026-09-12 09:00:00
    window=0 repeatInterval=0 count=0
`;
/* En formatert dato er ENHETENS veggtid. Verten står i sin egen sone — UTC i CI,
   Oslo på en utviklermaskin — så en `Date.parse()` her ville gitt et tidspunkt
   forskjøvet med soneforskjellen. Forventningen regnes derfor av sonen, ikke av
   vertens klokke: det er nettopp det som gjør at testen KAN se feilen. */
const vent = (sone, Y, M, D, h, m) => {
  const utc = Date.UTC(Y, M - 1, D, h, m, 0);
  let t = utc;
  for (let i = 0; i < 2; i++) t = utc - H.soneAvvik(sone, t);
  return t;
};
check('1h en formatert dato leses i ENHETENS sone (de eldste Android-versjonene)',
  H.alarmKø(DATO, NÅ, 'Europe/Oslo')[0].at === vent('Europe/Oslo', 2026, 9, 12, 9, 0),
  [H.alarmKø(DATO, NÅ, 'Europe/Oslo')[0].at, vent('Europe/Oslo', 2026, 9, 12, 9, 0)]);
check('1i … og den SAMME dumpen gir et annet tidspunkt i en annen sone',
  H.alarmKø(DATO, NÅ, 'Pacific/Honolulu')[0].at ===
    vent('Pacific/Honolulu', 2026, 9, 12, 9, 0) &&
  H.alarmKø(DATO, NÅ, 'Pacific/Honolulu')[0].at -
    H.alarmKø(DATO, NÅ, 'Europe/Oslo')[0].at === 12 * 3600000,
  (H.alarmKø(DATO, NÅ, 'Pacific/Honolulu')[0].at -
    H.alarmKø(DATO, NÅ, 'Europe/Oslo')[0].at) / 3600000 + ' t forskjell');
check('1j uten kjent sone er tiden ULESELIG (0), ikke en gjetning i vertens sone',
  H.alarmKø(DATO, NÅ).map((a) => a.at).join() === '0',
  H.alarmKø(DATO, NÅ).map((a) => a.at));

/* ---- 2. Det som IKKE skal telles ---- */
check('2a en tom kø er tom, ikke «uendret»', H.alarmKø('Pending alarm batches: 0\n', NÅ).length === 0);
check('2b en dump uten Huskis-alarmer gir null treff',
  H.alarmKø(`Pending alarm batches: 1
Batch{1 num=1}:
  RTC_WAKEUP #0: Alarm{ddd type 0 com.whatsapp}
    tag=*walarm*:com.whatsapp/com.whatsapp.alarm.Receiver
    type=RTC_WAKEUP origWhen=+1h0m0s0ms
`, NÅ).length === 0);
check('2c en ikke-vekkende alarm finnes fortsatt — men typen er RTC, ikke RTC_WAKEUP',
  (() => {
    const k = H.alarmKø(`Pending alarm batches: 1
Batch{1 num=1}:
  RTC #0: Alarm{eee type 1 no.huskis.app}
    tag=*alarm*:no.huskis.app/com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher
    type=RTC when=+1h0m0s0ms
`, NÅ);
    return k.length === 1 && k[0].type === 'RTC';
  })());
check('2e typen leses for NETTOPP sin egen alarm, ikke av naboens linjer',
  (() => {
    const k = H.alarmKø(`Pending alarm batches: 2
Batch{1 num=1}:
  RTC #0: Alarm{eee type 1 no.huskis.app}
    tag=*alarm*:no.huskis.app/com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher
    type=RTC when=+1h0m0s0ms
Batch{2 num=1}:
  RTC_WAKEUP #0: Alarm{fff type 0 no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP when=+2h0m0s0ms
`, NÅ);
    return k.length === 2 && k[0].type === 'RTC' && k[1].type === 'RTC_WAKEUP';
  })(), 'naboens RTC_WAKEUP skal ikke smitte');
check('2d et tidspunkt som ikke lar seg lese blir 0, ikke en gjetning',
  H.alarmKø(`Pending alarm batches: 1
Batch{1 num=1}:
  RTC_WAKEUP #0: Alarm{fff type 0 no.huskis.app}
    ${TAGG}
    type=RTC_WAKEUP window=0
`, NÅ)[0].at === 0);

/* ---- 3. Sammenligningen av to tidssett ---- */
check('3a rekkefølgen betyr ingenting', H.sammeTider([3, 1, 2], [2, 3, 1]));
check('3b slingringen tåler at Android flytter alarmen noen sekunder',
  H.sammeTider([NÅ], [NÅ + 12000]));
check('3c … men ikke et helt annet tidspunkt',
  !H.sammeTider([NÅ], [NÅ + 3600000]));
check('3d ulik lengde er aldri likt', !H.sammeTider([1, 2], [1, 2, 3]));
check('3e to tomme sett er like (og det er ikke et bevis — D2 krever > 0)',
  H.sammeTider([], []));

/* ---- 3f–3j. Sonens avvik, regnet på VERTEN ----
   Tidssonebyttet prøves med appen LUKKET, så enheten kan ikke spørres om hva
   avviket ble. Forventningen regnes derfor her, og da må regningen stemme — også
   gjennom en sommertidsovergang og i en sone med halvtimesavvik. */
const SOMMER = Date.UTC(2026, 6, 1);
const VINTER = Date.UTC(2026, 0, 1);
check('3f en sone uten sommertid har ett avvik hele året',
  H.soneAvvik('Pacific/Honolulu', SOMMER) === -10 * 3600000 &&
  H.soneAvvik('Pacific/Honolulu', VINTER) === -10 * 3600000,
  H.soneAvvik('Pacific/Honolulu', SOMMER) / 3600000);
check('3g … mens Oslo har to, og avviket leses på ALARMENS øyeblikk',
  H.soneAvvik('Europe/Oslo', SOMMER) === 2 * 3600000 &&
  H.soneAvvik('Europe/Oslo', VINTER) === 1 * 3600000,
  [H.soneAvvik('Europe/Oslo', SOMMER) / 3600000, H.soneAvvik('Europe/Oslo', VINTER) / 3600000]);
check('3h halve timer regnes også riktig',
  H.soneAvvik('Asia/Kathmandu', SOMMER) === 5.75 * 3600000);
check('3i UTC er null, ikke en feil', H.soneAvvik('UTC', SOMMER) === 0);
check('3j retningen er VESTOVER, så alarmene flytter seg FRAMOVER i tid',
  H.soneAvvik('Pacific/Honolulu', SOMMER) < H.soneAvvik('Europe/Oslo', SOMMER) &&
  /Pacific\/Honolulu/.test(harness) && /VESTOVER/.test(harness));

/* ---- 4. Tapp-intenten ----
   Formen er lest ut av pluginens `LocalNotificationManager.buildIntent()`.
   Skrivefeilen i `LocalNotficationObject` er PLUGINENS, og skal stå. */
const cmd = H.tapKommando(1234567, '{"id":1234567,"extra":{"objId":"x"}}');
check('4a intenten går til MainActivity med MAIN/LAUNCHER',
  /am start -n no\.huskis\.app\/\.MainActivity/.test(cmd) &&
  /-a android\.intent\.action\.MAIN/.test(cmd) &&
  /-c android\.intent\.category\.LAUNCHER/.test(cmd), cmd);
check('4b … med SINGLE_TOP|CLEAR_TOP (0x24000000)', / -f 0x24000000 /.test(cmd));
check('4c … og pluginens tre extras, skrivefeilen inkludert',
  / --ei LocalNotificationId 1234567 /.test(cmd) &&
  / --es LocalNotificationUserAction tap /.test(cmd) &&
  /--es LocalNotficationObject '\{"id":1234567/.test(cmd), cmd);
check('4d nøklene står ETT sted i harnesset',
  H.TAP.id === 'LocalNotificationId' && H.TAP.action === 'LocalNotificationUserAction' &&
  H.TAP.obj === 'LocalNotficationObject' &&
  (harness.replace(/\/\*[\s\S]*?\*\//g, '').match(/LocalNotficationObject/g) || []).length === 1);
check('4e alarmen kjennes igjen på pluginens egen publisher-klasse',
  H.PUBLISHER === 'com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher');

/* ---- 5. Pinnet til pluginversjonen ----
   Et versjonsløft kan flytte intent-nøklene eller klassenavnet. Da skal noen
   lese dem på nytt, ikke oppdage det på en telefon. */
check('5a harnesset er pinnet til den pluginversjonen formene er lest av',
  H.PLUGIN_VERSION === pkgJson.dependencies['@capacitor/local-notifications'],
  { harness: H.PLUGIN_VERSION, pakke: pkgJson.dependencies['@capacitor/local-notifications'] });

/* ---- 6. `am kill`, aldri `force-stop` ----
   `force-stop` gjør to ting til: Android AVLYSER appens alarmer, og appen
   settes i «stopped state» der den ikke får kringkastinger. Da prøver man
   Androids regel for en stoppet app — ikke Huskis' kode, og ikke det en sveip i
   Recents gjør. */
check('6a harnesset dreper prosessen med `am kill`', /am kill /.test(harness));
/* `force-stop` avlyser appens alarmer. Den skal derfor ALDRI brukes til å fjerne
   prosessen under runden — da prøver man Androids regel for en stoppet app — mens
   den er nøyaktig riktig verktøy i opprydningen, der avlysningen ER poenget. */
const drepKropp = (() => {
  const i = harness.indexOf('async function drepApp()');
  return i < 0 ? '' : harness.slice(i, harness.indexOf('\n}', i));
})();
check('6b `drepApp` bruker aldri force-stop — den ville avlyst alarmene',
  drepKropp !== '' && !/force-stop/.test(drepKropp) && /am kill /.test(drepKropp));
check('6b2 … og den ENESTE force-stop i fila er siste utvei i riggopprydningen',
  (harness.match(/am force-stop/g) || []).length === 1 &&
  /function ryddRiggAlarmer[\s\S]*am force-stop/.test(harness));
check('6c grunnen står i fila, ikke bare i dokumentasjonen',
  /force-stop/.test(harness) && /stopped state/.test(harness));
check('6d varseltillatelsen gis med `pm grant`, ikke ved å trykke i en dialog',
  /pm grant .*POST_NOTIFICATIONS/.test(harness));
check('6e runden leser BÅDE alarmkøen og de postede varslene fra Android selv',
  /dumpsys alarm/.test(harness) && /dumpsys notification/.test(harness));
check('6f … og at den installerte APK-en ikke ber om SCHEDULE_EXACT_ALARM',
  /dumpsys package/.test(harness) && /SCHEDULE_EXACT_ALARM/.test(harness));
check('6g en ekte omstart av enheten er med, og kan slås av med --no-reboot',
  /adb'?,? ?\[?'reboot'/.test(harness.replace(/\s+/g, ' ')) || /\['reboot'\]/.test(harness));
check('6h --no-reboot prøver i stedet oppstartsmottakeren direkte',
  /BOOT_COMPLETED/.test(harness) && /--no-reboot/.test(harness));
check('6i tidssonebyttet gjøres med AlarmManagers egen skallkommando, som kringkaster',
  /cmd alarm set-timezone/.test(harness) && /persist\.sys\.timezone/.test(harness));
check('6j … og evidensen er at JS IKKE rørte alarmene: ingen kall over broen',
  /L3 ingen JS rørte alarmene/.test(harness) && /tzKall/.test(harness));
check('6k en omstart er bevist med OPPETIDEN, ikke med at adb svarte',
  /\/proc\/uptime/.test(harness) && /oppetidFør/.test(harness));
check('6l offline prøves med ekte radioer AV, og en runde som gikk på nett sier det',
  /cmd connectivity airplane-mode/.test(harness) &&
  /airplane_mode_on/.test(harness) &&
  /skip\('H4 planlagt og levert uten at appen kunne nå noen server'/.test(harness));
check('6m1 gjenopprettingen nulles først når tilstanden er LEST TILBAKE som riktig',
  /const nå = nettTilstand\(\);\s*\n\s*const likt = \(k\) =>/.test(harness) &&
  /if \(likt\('flymodus'\) && likt\('wifi'\) && likt\('data'\)\) åGjenopprette\.nett = null;/.test(harness) &&
  /if \(gi\('stay_on_while_plugged_in'\) === åGjenopprette\.stayon\)/.test(harness) &&
  /if \(varselTillatelseGitt\(\) === false\) åGjenopprette\.varselTillatelse = null;/.test(harness),
  'et «sett tilbake» som ikke tok skal fortsatt stå som noe å rydde');
check('6m2 Ctrl-C og SIGTERM rydder enheten før de avslutter',
  /process\.on\(sig/.test(harness) && /SIGINT/.test(harness) && /SIGTERM/.test(harness) &&
  /process\.on\(sig, \(\) => \{[\s\S]{0,600}await ryddEnheten\(\);/.test(harness));
check('6m flymodus og tidssone settes TILBAKE uansett hvordan runden ender',
  /async function ryddEnheten/.test(harness) &&
  /main\(\)\.then\(avslutt\)\.catch\([\s\S]{0,400}avslutt\(1\);/.test(harness) &&
  (harness.match(/await ryddEnheten\(\);/g) || []).length >= 3,
  (harness.match(/await ryddEnheten\(\);/g) || []).length + ' kall');
/* Ett forsøk er ikke nok: et «slå av flymodus» som feiler eller henger etter må
   prøves på nytt FØR prosessen går, ikke bare etterlate et flagg. */
check('6m3 systemopprydningen prøver på nytt til tilstanden er lest tilbake',
  /const frist = Date\.now\(\) \+ RYDD_SYS_MS;/.test(harness) &&
  /if \(!igjen\(\)\.length\) break;/.test(harness) &&
  /await sov\(1500\);/.test(harness));
check('6m4 … og sier det tydelig hvis vinduet gikk ut',
  /FIKK IKKE satt tilbake/.test(harness) && /nettet er ikke satt tilbake/.test(harness));
check('6m5 hele opprydningen har ett samlet tak, så et avbrudd ikke kan henge',
  (harness.match(/sov\(RYDD_SYS_MS \+ RYDD_MS\)/g) || []).length === 2);

/* ---- 6n–6q. Sporet fra trykk til peker ----
   «Ingen peker» må ha en ADRESSE: fikk pluginen intenten, sendte den den til JS,
   og gjorde JS noe med den? Uten oppdelingen er et FAIL bare et nederlag. */
check('6n trykket måles på en app som ble startet AV trykket, uten en ny intent',
  /async function ventPåBro/.test(harness) &&
  /const fraTrykket = !!\(await ventPåBro\(60000, '[^']+'\)\);/.test(harness));
check('6o … og sporet plugin → JS leses av Androids egen logg, USTERT',
  /function trykkSpor/.test(harness) && /LocalNotification received/.test(harness) &&
  /tilPlugin:/.test(harness) && /tilJs:/.test(harness) &&
  /logcat', '-d', '-t', '3000'/.test(harness) && /bevis:/.test(harness));
check('6o2 … og en intent Android gjenopptok UTEN extras rapporteres som ikke målbar',
  /Activity started without notification attached/.test(harness) &&
  /launcher-semantikk/.test(harness));
check('6p en varm intent skiller kaldstart-hullet fra koblingen plugin → JS',
  /I2b … og den kommer fram når appen ALT kjører/.test(harness));
check('6q viktigheten leses både som ord OG som tall (API 36 skriver 4)',
  /importance=\(HIGH\|MAX\|4\|5\)/.test(harness));
check('6r kanalen sjekkes ETTER første speilingsrunde, som er den som lager den',
  harness.indexOf('C1 RIGG: tre syntetiske alarmer') <
    harness.indexOf('B1 kanalen ' ) &&
  /ikke ved oppstart/.test(harness));

/* ---- 7. Observatørene appen må eksponere ----
   Pekeren fra et varsel er ikke synlig i DOM-en på en kaldstart: objektet den
   viser til er ikke lastet ennå. Uten disse to er trykket det ene punktet bare
   et øye kan bekrefte. */
const huskisBlokk = appJs.slice(appJs.indexOf('window.__huskis = {'));
check('7a appen eksponerer den parkerte pekeren',
  /get notifPendingTarget\(\) \{ return notifPendingTarget; \}/.test(huskisBlokk));
check('7b … og nøklene til varslene som nettopp ble trykket',
  /get notifChannelTapped\(\) \{ return notifChannelTapped; \}/.test(huskisBlokk));
const åpne = appJs.slice(appJs.indexOf('function openNotifTargetFromChannel'));
const kropp = åpne.slice(0, åpne.indexOf('\n  }') + 4);
check('7c nøkkelen registreres FØR innloggingssjekken (ellers er en kaldstart usynlig)',
  kropp.indexOf('notifChannelTapped.add(key)') > 0 &&
  kropp.indexOf('notifChannelTapped.add(key)') < kropp.indexOf('if (!authUser'),
  [kropp.indexOf('notifChannelTapped.add(key)'), kropp.indexOf('if (!authUser')]);
check('7d harnesset leser nøyaktig de to',
  /notifPendingTarget/.test(harness) && /notifChannelTapped/.test(harness));
/* FEILEN som kom fram mens enhetsrunden ble bygget: `cloudStart()` kjører på hver innlogging — også den
   bufrede ved kaldstart — og `resetNotifications()` nullstilte pekeren fra
   varseltrykket FØR `flushNotifPendingTarget()` kunne bruke den. Et trykk åpnet
   derfor ingenting på en kaldstart. Oppførselen er dekket kjørende av
   `notif-channels` 3d–3e; her låses at nullstillingen ikke kommer tilbake. */
const resetKropp = (() => {
  const i = appJs.indexOf('function resetNotifications(nesteEier) {');
  return i < 0 ? '' : appJs.slice(i, appJs.indexOf('\n  }', i));
})();
check('7e innloggingen nullstiller IKKE pekeren fra et varseltrykk',
  resetKropp !== '' && !/notifPendingTarget = null/.test(resetKropp) &&
  !/notifChannelTapped\.clear\(\)/.test(resetKropp));
check('7f … og grunnen står der, så den ikke blir «ryddet bort» igjen',
  /PEKEREN FRA ET TRYKK BLIR STÅENDE/.test(resetKropp) &&
  /kaldstart/.test(resetKropp));

/* ---- 8. CI kjører runden ---- */
check('8a det finnes en workflow som kjører harnesset',
  /node tests\/android-device\.js/.test(wf));
check('8b … på en ekte emulator, med KVM', /emulator/.test(wf) && /\/dev\/kvm/.test(wf));
check('8c … mot en APK bygget av den vanlige kjeden',
  /node build\.js/.test(wf) && /cap sync android/.test(wf) && /assembleDebug/.test(wf));
check('8d APK-en installeres av harnesset selv (--install)',
  /--install android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/.test(wf));
check('8e plattformnivået leses fra variables.gradle, så de ikke kan drifte',
  /compileSdkVersion/.test(wf) && /variables\.gradle/.test(wf));
check('8f loggene lastes opp også når runden feiler',
  /if: always\(\)/.test(wf) && /logcat/.test(wf));
check('8g workflowen kjøres på PR-er som rører Android-siden',
  /pull_request:/.test(wf) && /'android\/\*\*'/.test(wf) &&
  /'tests\/android-device\.js'/.test(wf));
/* app.js ER produksjonskoden runden prøver — adapteren og
   `window.__huskis.androidChannel` bor der. Uten den i triggeren kunne en
   endring i adapteren brekke native varsler uten at runden kjørte. */
check('8h … OG på app.js, der varseladapteren faktisk bor',
  /^\s+- 'app\.js'$/m.test(wf));
check('8i opprydningen avlyser NØYAKTIG riggens id-er gjennom pluginen',
  /åGjenopprette\.riggIder/.test(harness) && /ln\.cancel\(\{ notifications: ider/.test(harness) &&
  /removeDeliveredNotificationsById/.test(harness));
check('8j … ikke ved å vente på «neste synk»: alarmen i H ligger sekunder fram',
  !/avlyses av diffen neste gang Huskis synker/.test(harness) &&
  /~25 sekunder/.test(harness));
check('8k force-stop er SISTE utvei, og bare uten en innlogget bruker',
  /if \(!åGjenopprette\.harØkt\) \{[\s\S]{0,200}am force-stop/.test(harness));
/* «Innlogget» og «LIVE» er ikke det samme: LIVE krever i tillegg varsler PÅ og en
   ikke-tom plan. En innlogget bruker uten kommende varsler kjører altså RIGG, og
   der ville en force-stop tatt hennes app inn i «stopped state» for ingenting. */
check('8l økten leses av `authUser`, ikke av LIVE-vilkåret',
  /window\.__huskis\.authUser/.test(harness) &&
  /åGjenopprette\.harØkt = harØkt/.test(harness) &&
  !/åGjenopprette\.live/.test(harness));
check('8m avbrudd rydder BÅDE innstillingene og alarmene, i den rekkefølgen',
  /await ryddEnheten\(\); await ryddRiggAlarmer\(\);/.test(harness) &&
  /if \(rydder\) process\.exit\(130\);/.test(harness));
check('8n emulatorjobben har tak på BEGGE ventingene, og skriver loggen ved feil',
  /timeout 300 adb wait-for-device/.test(wf) && /timeout 600 bash -c/.test(wf) &&
  (wf.match(/tail -100 emulator\.log/g) || []).length === 2);
check('8o … og emulatoren får RAM og kjerner eksplisitt',
  /-memory 4096/.test(wf) && /-cores 2/.test(wf));
/* En emulator uten brukbar KVM feiler ikke — den KRABBER, og ser ut som en enhet
   som aldri blir ferdig å boote. Det skal sies med én gang, ikke etter tolv
   minutters venting. */
check('8p akselerasjonen sjekkes FØR oppstarten, og kreves',
  /emulator -accel-check/.test(wf) && /-accel on/.test(wf));
/* `avdmanager` og `emulator` er ikke enige om hvor en AVD bor: den første skriver
   til $ANDROID_USER_HOME/avd, den andre leter i $ANDROID_AVD_HOME,
   $ANDROID_SDK_HOME/avd og $HOME/.android/avd. Uten en avtalt sti lages en AVD
   emulatoren aldri finner — og feilen ser ut som en emulator som ikke vil starte. */
check('8q1 AVD-stien er AVTALT mellom avdmanager og emulator',
  /ANDROID_AVD_HOME=\$HOME\/\.android\/avd/.test(wf) && /GITHUB_ENV/.test(wf));
check('8q2 … og emulatoren spørres SELV om den ser AVD-en før oppstart',
  /emulator -list-avds \| grep -qx huskis/.test(wf));
check('8q emulatorloggen skrives ut etter 20 s, uansett utfall',
  /tail -40 emulator\.log/.test(wf) && /pgrep -af qemu-system/.test(wf));
check('8r … og hvert adb-kall i loggsamlingen har tak (uten enhet kan de henge)',
  (wf.match(/timeout 60 adb/g) || []).length === 3);
check('8s systembibliotekene emulatoren lenker mot installeres, og får ikke felle jobben',
  /libpulse0/.test(wf) && /apt-get install/.test(wf) &&
  /timeout 180 apt-get update/.test(wf));

/* Opprydningen får IKKE melde seg ferdig på et kall som feilet: fraværet må
   verifiseres, ellers mister vi recovery-tilstanden og en syntetisk alarm står
   igjen. */
check('9f opprydningen VERIFISERER at riggalarmene er borte før flagget nulles',
  /getAll\(\{ state: "SCHEDULED" \}\)/.test(harness) &&
  /if \(!sist\.igjen\.length\) \{\s*\n\s*åGjenopprette\.riggIder = \[\];/.test(harness));
check('9g … og en feil i cancel/remove kan ikke leses som suksess',
  /feil\.push\("cancel: /.test(harness) && /feil\.push\("remove: /.test(harness) &&
  /let igjen = ider;/.test(harness));
check('9h … og et uleselig svar regner ALT som igjen',
  /catch \(e\) \{ feil\.push\("getAll: /.test(harness));
check('9i varselpanelet sjekkes også — en levert rad er ikke borte av en cancel',
  /const iPanelet = panel === null/.test(harness));
/* Et ULESELIG panel er ikke «tomt». Med `tillatFeil` kommer en lesefeil ut som
   tekst, og uten vakten ville den blitt lest som at riggens varsel var borte. */
check('9i2 `varselDump()` svarer null når dumpen ikke lot seg lese',
  /const gyldig = \(t\) =>/.test(harness) &&
  /return null;\n\}/.test(harness) &&
  /Current Notification Manager state\|NotificationRecord/.test(harness));
check('9i3 … og et uleselig panel regner ALLE id-ene som igjen',
  /panel === null\s*\n\s*\? ider/.test(harness) &&
  /varselpanelet lot seg ikke lese/.test(harness));
check('9i4 H venter videre på et uleselig panel i stedet for å lese det som «kom ikke»',
  /if \(d === null\) return null;/.test(harness));
check('9j force-stop-fallbacken verifiserer BÅDE køen og panelet før flagget nulles',
  /const tomKø = alarmKø\(\)\.length === 0;/.test(harness) &&
  /const tomtPanel = panel !== null &&/.test(harness) &&
  /if \(tomKø && tomtPanel\) \{/.test(harness));

/* ---- 9. Dokumentasjonen skiller bevist fra observert ---- */
const plan = les('docs', 'mobilapp-plan.md');
const varsler = les('docs', 'varsler.md');
check('9a planen peker på harnesset som den maskinelle runden',
  /tests\/android-device\.js/.test(plan));
check('9b … og varsler.md gjør det samme', /tests\/android-device\.js/.test(varsler));
check('9c planen har en egen liste over det bare et ØYE kan svare på',
  /heads-up/i.test(plan) && /øye/i.test(plan));
check('9d de tre øyepunktene står i harnessets egen sluttrapport',
  /HEADS-UP\./.test(harness) && /LÅSESKJERM\./.test(harness) && /FINGEREN\./.test(harness));
check('9e tester/CLAUDE.md nevner enhetsrunden, så den ikke blir en glemt fil',
  /android-device\.js/.test(les('tests', 'CLAUDE.md')));

/* ---- 10. Runden måler den bundelen som ble bygget ----

   Dette er den vakten som mangler mest: en emulatorrunde bygde én bundle inn i
   APK-en og kjørte en ANNEN i WebView-en, fordi appen spør etter en
   OTA-oppdatering ved oppstart og fant main sin. Runden målte da main, og felte
   et punkt på kode som ikke fantes i den bundelen. To lag skal hindre det —
   radioen av før appen starter i det hele tatt, og en identitet som leses av
   siden og sammenlignes — og et tredje skal hindre at en drift blir tolket:
   runden STOPPER. */
check('10a identiteten leses av SIDEN, ikke av noe harnesset selv har skrevet',
  /meta\[name=/.test(harness) && /huskis-build/.test(harness) &&
  /huskis-release/.test(harness));
check('10b den forventede builden kommer fra --expect-build eller dist/version.json',
  /--expect-build/.test(harness) && /dist['"], ['"]version\.json/.test(harness));
/* Og sammenligningen MÅ være mellom to størrelser som er den samme når alt er
   riktig: `build.js` stempler samme id inn i `<meta name="huskis-build">` og i
   `version.json`. Gjorde den ikke det, ville vakten feilet på hver runde. */
check('10c build.js stempler samme id i meta-taggen og i version.json',
  /stampMeta\(stripped, 'huskis-build', ids\.buildId\)/.test(les('build.js')) &&
  /\n\s*buildId,\n/.test(les('build.js')));
check('10d nettet slås av FØR appen starter første gang',
  /const radioenAv = nettAv\(\);\n\n  await appenOpp\(/.test(harness));
/* … og den blir stående av. Det er forutsetningen for at ÉN vakt per oppstart er
   nok: `update-check.js` kan laste appen om midt i en økt når den finner en nyere
   build, og da ville to faste vakter ikke sett byttet. Uten nett kan det ikke
   skje. Derfor skal ingen del av runden slå nettet på igjen — bare
   opprydningen, som gjør det gjennom `cmd connectivity`, ikke gjennom
   `settFlymodus(false)`. */
/* Bare OPPRYDNINGEN slår nettet på igjen, og den gjør det gjennom
   gjenopprettingen — ikke gjennom et «slå på»-kall noe annet sted i runden. */
check('10d2 ingen del av runden slår nettet på igjen underveis',
  (harness.match(/airplane-mode ' \+ \(mål\.flymodus \? 'enable' : 'disable'\)/g) || []).length === 1 &&
  !/airplane-mode enable'\s*,\s*kort/.test(harness) &&
  (harness.match(/svc wifi ' \+ \(mål\.wifi/g) || []).length === 1);
check('10d3 … og returverdien fra «slå av» blir RAPPORTERT, ikke ignorert',
  /const radioenAv = nettAv\(\)/.test(harness) &&
  /check\('A5 appen kan ikke NÅ serveren/.test(harness) &&
  /radioenAv && !nådde/.test(harness));
check('10e vakten kjøres før målingene, og EN GANG TIL etter den ekte omstarten',
  /vaktBundle\('A4', ventet\)/.test(harness) && /vaktBundle\('A4b', ventet\)/.test(harness) &&
  harness.indexOf("vaktBundle('A4', ventet)") <
    harness.indexOf('D1 pluginens lagring') &&
  harness.indexOf("vaktBundle('A4b', ventet)") >
    harness.indexOf('G1 enheten var FAKTISK nede'));
check('10f en drift STOPPER runden i stedet for å måle videre i feil kode',
  (harness.match(/ANNEN web-bundle/g) || []).length >= 2 &&
  /if \(!\(await vaktBundle\('A4', ventet\)\)\) \{/.test(harness) &&
  /if \(!\(await vaktBundle\('A4b', ventet\)\)\) \{/.test(harness));
check('10g … og forsøket på å rette den slår av nettet først, ellers laster appen ' +
  'den samme bundelen ned igjen',
  /nettAv\(\);\n  let nullstilt = false;/.test(harness) &&
  /LiveUpdate/.test(harness) && /lu\.reset\(\)/.test(harness));
/* DEN SENTRALE VAKTEN, og det er den som gjør pinningen sann gjennom HELE runden:
   appen starter mange ganger (E, G, H, I, J, K), og en OTA tas i bruk ved
   oppstart. To faste vakter ville bare målt to øyeblikk. Derfor sitter vakten i
   de to — og bare de to — funksjonene som kan skaffe runden en app å måle på.
   Låses strukturelt: hver funksjon som knytter broen (`bro = await ventTil(`)
   skal kalle `krevRiktigBundle` før den svarer. */
const broFester = harness.split('bro = await ventTil(').slice(1);
check('10h hver funksjon som knytter broen vokter bundelen før den svarer',
  broFester.length === 2 &&
  broFester.every((etter) => {
    const slutt = etter.indexOf('\n}');
    return slutt > 0 && /await krevRiktigBundle\(/.test(etter.slice(0, slutt));
  }), broFester.length + ' steder fester broen');
check('10h2 … og hver oppstart i runden sier HVOR, så en drift har adresse',
  (harness.match(/appenOpp\('[^']+'\)/g) || []).length >= 6 &&
  /ventPåBro\(60000, 'I kaldstart/.test(harness));
check('10h3 vakten KASTER — den rapporterer ikke bare og måler videre',
  /throw new Error\('kjører feil bundle ved/.test(harness));
check('10h4 … og en identitet som ikke lar seg lese er ikke en som stemmer',
  /if \(id && id\.build === ventetBundle\.id\) return;/.test(harness) &&
  /identiteten lot seg ikke lese/.test(harness));
check('10h5 vakten armeres FØRST når A4 har godkjent, så A4 får rette en drift',
  /ventetBundle = ventet;/.test(harness) &&
  harness.indexOf("vaktBundle('A4', ventet)") < harness.indexOf('ventetBundle = ventet;') &&
  harness.indexOf('ventetBundle = ventet;') < harness.indexOf('D1 pluginens lagring'));
check('10h6 … og opprydningen kan ikke blokkeres av den',
  /vaktAv = true;/.test(harness) &&
  /Opprydningen skal kjøre UANSETT hvilken bundle/.test(harness));
check('10i CI pinner bundelen eksplisitt med --expect-build', /--expect-build/.test(wf));
/* Og rapporten skal kunne LESES: `getCurrentBundle()` sier om appen kjører den
   innebygde APK-bundelen eller en nedlastet. Det var nettopp den linjen i
   artifactet som avslørte driften. */
check('10k rapporten sier hvilken bundle LiveUpdate mener appen kjører',
  /getCurrentBundle/.test(harness) && /innebygd/.test(harness) &&
  /liveUpdate: id\.bundle/.test(harness));
/* Et eiermerke betyr at alarmene på enheten tilhører en konto, og da skal
   `force-stop` ikke komme på tale. Runden starter uten nett, og en økt som må
   fornyes rekker ikke alltid å svare da — derfor merket ved siden av økten. */
check('10j «tilhører en konto» leses av økten ELLER eiermerket',
  /authUser;'\)\) \|\| !!eier;/.test(harness));

/* ---- 11. «Offline» er målt, og telefonen settes tilbake til sin egen tilstand ----

   Tre hull gjelder den FYSISKE telefonen, og emulatoren kan ikke avsløre dem: den
   starter i en rein, forventet tilstand. Derfor låses de her.

   1. `airplane_mode_on=1` er IKKE «ingen nett». Wi-Fi er en egen radio som kan stå
      på i flymodus — nyere Android husker til og med at den skal. Da kan appen
      fortsatt laste ned og aktivere en bundle midt i samme WebView-økt, som er
      nøyaktig vinduet pinningen finnes for å lukke.
   2. En telefon som ALT sto i flymodus skal stå i flymodus etterpå. Et flagg som
      betyr «slå av» kan ikke uttrykke det.
   3. Varseltillatelsen og «hold skjermen våken» er brukerens valg, ikke rundens. */
check('11a «offline» MÅLES av appen selv, mot adressen OTA-en bruker',
  /const nåddeNettet = \(\) => bro\.evalJs\(/.test(harness) &&
  /canonicalAppUrl\(\)/.test(harness) &&
  /fetch\(base \+ "version\.json\?probe="/.test(harness) &&
  /catch \(e\) \{ return false; \}/.test(harness));
check('11a2 … og A5 krever at den IKKE kom fram — ikke bare at et flagg står på',
  /radioenAv && !nådde/.test(harness) &&
  /check\('A5 appen kan ikke NÅ serveren den ville hentet en ny bundle fra'/.test(harness));
check('11a3 … og appens EGEN dom over manifesthentingen står som evidens',
  /const otaDom = \(\) => bro\.evalJs\(/.test(harness) &&
  /otaFetch: ota/.test(harness));
check('11a4 offline MÅLES på nytt etter omstarten, i stedet for å anta A5',
  /const nåddeNå = await nåddeNettet\(\);/.test(harness) &&
  /const offline = radioerAvEtterOmstart && !nåddeNå;/.test(harness) &&
  harness.indexOf('const nåddeNå = await nåddeNettet();') <
    harness.indexOf("await drepApp();                 // varselet skal komme med appen BORTE"));
check('11b Wi-Fi og mobildata slås av for seg — flymodus alene er ikke nok',
  /svc wifi disable/.test(harness) && /svc data disable/.test(harness) &&
  /wifi: gi\('wifi_on'\)/.test(harness) && /data: gi\('mobile_data'\)/.test(harness));
check('11b2 … men bare når den opprinnelige verdien lot seg LESE',
  /if \(før\.wifi !== null\) sh\('svc wifi disable'/.test(harness) &&
  /if \(før\.data !== null\) sh\('svc data disable'/.test(harness));
check('11c nettet settes tilbake til den tilstanden enheten HADDE, ikke til «på»',
  /if \(!åGjenopprette\.nett\) åGjenopprette\.nett = nettTilstand\(\);/.test(harness) &&
  /const mål = åGjenopprette\.nett;/.test(harness) &&
  /\(mål\.flymodus \? 'enable' : 'disable'\)/.test(harness) &&
  /const likt = \(k\) => mål\[k\] === null \|\| nå\[k\] === mål\[k\];/.test(harness));
check('11d «hold skjermen våken» settes tilbake til den opprinnelige bitmasken',
  /åGjenopprette\.stayon = gi\('stay_on_while_plugged_in'\);/.test(harness) &&
  /settings put global stay_on_while_plugged_in ' \+ åGjenopprette\.stayon/.test(harness) &&
  !/sh\('svc power stayon false'/.test(harness));
check('11e varseltillatelsen gis BARE når den mangler, og tas tilbake etterpå',
  /if \(sdk >= 33 && varselTillatelseGitt\(\) === false\)/.test(harness) &&
  /åGjenopprette\.varselTillatelse = 'revoke'/.test(harness) &&
  /pm revoke ' \+ PKG \+ ' android\.permission\.POST_NOTIFICATIONS/.test(harness));
check('11f alt fire meldes eksplisitt hvis det IKKE lot seg sette tilbake',
  /const igjen = \(\) => \[/.test(harness) &&
  /nettet er ikke satt tilbake/.test(harness) &&
  /skjermen står fortsatt våken/.test(harness) &&
  /varseltillatelsen står igjen PÅ/.test(harness) &&
  /FIKK IKKE satt tilbake/.test(harness));
/* Og gjenopprettingen må kjøre fra BEGGE veiene ut, ellers hjelper den ikke på en
   runde som brøt sammen eller ble avbrutt med Ctrl-C. */
check('11g gjenopprettingen kjøres både fra avslutningen og fra signalene',
  (harness.match(/await ryddEnheten\(\); await ryddRiggAlarmer\(\);/g) || []).length === 2);

/* ---- 12. Omstarten, det uleselige, og et SKIP som ikke får skjule noe ----

   1. En omstart er nettopp der en radio kan komme tilbake av seg selv. Skjer det,
      kan oppdateringsmotoren bytte bundelen i den FØRSTE økten etter omstarten —
      før bundelvakten rakk å se noe, og midt i en WebView-økt der ingen
      oppstartsvakt treffer. Rekkefølgen må derfor være låst.
   2. «Det vi ikke kan sette tilbake, endrer vi ikke» må gjelde ALLE
      innstillingene, også hovedbryteren og de to som ikke er radioer.
   3. Et SKIP teller ikke som en feil, så en manglende offline-forutsetning kunne
      gjort hele jobben grønn samtidig som punktet aldri ble prøvd. */
const iHarness = (t) => harness.indexOf(t);
check('12a rekkefølgen etter omstarten er låst: nettet av FØR appen starter',
  iHarness("adb(['reboot']") < iHarness('const radioerAvEtterOmstart = nettAv();') &&
  iHarness('const radioerAvEtterOmstart = nettAv();') < iHarness("appenOpp('H etter omstart')") &&
  iHarness("appenOpp('H etter omstart')") < iHarness("vaktBundle('A4b', ventet)"),
  'reboot → nettAv → appenOpp → bundlevakt');
check('12a2 … og offline MÅLES på nytt etter omstarten, før målingene i H',
  /check\('A5b appen kan fortsatt ikke nå serveren etter omstarten'/.test(harness) &&
  iHarness("vaktBundle('A4b', ventet)") < iHarness('const nåddeNå = await nåddeNettet();') &&
  iHarness('const nåddeNå = await nåddeNettet();') < iHarness('H1 alarmen ble levert'));
check('12b hovedbryteren røres BARE når den opprinnelige verdien lot seg lese',
  /if \(før\.flymodus !== null\) sh\('cmd connectivity airplane-mode enable'/.test(harness) &&
  /return før\.flymodus !== null && nettTilstand\(\)\.flymodus === 1;/.test(harness));
check('12c «hold skjermen våken» røres bare når snapshotet lot seg lese — begge steder',
  (harness.match(/if \(åGjenopprette\.stayon !== null\) sh\('svc power stayon true'/g) || []).length === 2 &&
  !/^\s*sh\('svc power stayon true'/m.test(harness));
check('12d varseltillatelsen leses TRI-STATE, og en uleselig dump rører ingenting',
  /return m \? m\[1\] === 'true' : null;/.test(harness) &&
  /if \(sdk >= 33 && varselTillatelseGitt\(\) === false\)/.test(harness) &&
  /if \(varselTillatelseGitt\(\) === true\) åGjenopprette\.varselTillatelse = 'revoke';/.test(harness) &&
  /if \(varselTillatelseGitt\(\) === false\) åGjenopprette\.varselTillatelse = null;/.test(harness));
check('12e en manglende offline-forutsetning FELLER runden i RIGG, ikke hopper over den',
  /\} else if \(!live\) \{/.test(harness) &&
  /check\('H4 … planlagt OG levert UTEN at appen kunne nå noen server', false,/.test(harness) &&
  /forutsetningen for punktet mangler/.test(harness));
check('12e2 … og SKIP-en finnes bare for LIVE, der plattformen kan nekte oppsettet',
  (harness.match(/skip\('H4 planlagt og levert uten at appen kunne nå noen server'/g) || []).length === 1 &&
  /plattformen nektet testoppsettet/.test(harness));

const feil = results.filter((r) => !r).length;
console.log('\n' + (results.length - feil) + ' passed, ' + feil + ' failed');
process.exit(feil ? 1 : 0);
