/*
  Regresjonstest: DE EKSTERNE VARSELKANALENE (docs/varsler.md).

  De samme varslene, levert ut av appen. To kanaler, én per enhet: Android
  planlegger LOKALE varsler på telefonen, nettleseren melder seg på web push og
  får dem fra serveren. Ingen av dem er en generator — begge leverer planen
  (`planNotifications`), som `notif-plan.test.js` dekker for seg.

  Ingen ekte telefon og ingen ekte pushtjeneste finnes i en testrunde. Det som
  fakes er derfor NØYAKTIG plattformen — pluginbroen, `Notification`,
  `serviceWorker` — mens alt Huskis selv gjør er ekte kode: tilstandsmaskinen,
  diffen, RPC-ene, panelet og rutingen.

  Dekker:
     1. Den deterministiske native ID-en: den er hashen av SIGNATUREN — nøkkel,
        terskeltid og tekst — så samme alarm gir samme heltall, mens en ny tid
        eller et nytt navn gir et nytt. Tallet er alltid et positivt 31-bits int
        (Androids varsel-ID er et Java-`int`).
     2. Android-adapteren: tillatelse spørres kun etter et brukertrykk, planen
        speiles som en DIFF (ingen dubletter ved gjentatt synk), en avlyst
        terskel kanselleres, alarmen er UPRESIS — appen ber aldri om
        SCHEDULE_EXACT_ALARM — og en alarm som har flyttet seg ERSTATTES: et
        tidssonebytte gir samme varsel en ny absolutt tid, et nytt objektnavn gir
        det ny tekst, og i begge tilfeller er den gamle alarmen borte etterpå.
     3. Trykk på et native varsel navigerer til objektet.
     4. Web push-kanalen: uten avsendernøkkel finnes den ikke; med nøkkel kan
        den slås på, den skriver et abonnement, den fornyer seg selv, og den
        slås av igjen — abonnementet forsvinner fra serveren. Og grensene for
        hva et abonnement får være (endepunkt, nøkkelform, taket på antall
        enheter) er speilet i mock-backenden, ikke bare i SQL-en.
     5. Blokkert tillatelse: bryteren maser ikke, den forklarer.
     6. Panelet: bryteren og statusteksten for hver av tilstandene, og at de
        fire typebryterne er urørt.
     7. Service workeren (`sw.js`): en push blir et varsel med navnet som
        overskrift og typeteksten som kropp, nøkkelen er `tag` (så det samme
        varselet ikke stabler seg), og et klikk fokuserer en åpen fane med
        pekeren — eller åpner appen med `?notif=<type>:<id>`.
     8. `?notif=` i adressen navigerer til objektet og fjernes fra adressen.
     9. Trykk på et SYSTEMvarsel gir ingen redundant in-app-toast for nettopp
        det varselet — appen navigerte dit i det samme trykket. Gjelder begge
        kanalene, og bare det ene varselet: et annet nytt varsel, om det samme
        objektet, toaster fortsatt.
    10. Varselikonene, som er TO og ikke ett: `icon` er merket i farge,
        rasterisert fra `favicon.svg`, gjennomsiktig og skalert slik at en
        sirkulær maske ikke klipper hjørnene av kortene; `badge` er en egen
        MONOKROM tegning, fordi Android bruker den som alfamaske. Og at
        Androids `ic_stat_huskis` er nøyaktig den samme masken — det fremste
        kortet med tre punkter og linjer, og to kort bak.
    11. Den native planen er TELEFONENS: et varsel som har ringt blir stående i
        pluginens lagring, og det neste skal likevel bli en alarm — også når
        serveren ikke svarer, og uten at noe manuelt kjøres. To overlappende
        speilinger etterlater nøyaktig planen, ikke én alarm for mye.
    12. ÉN synlig varsling, ikke to. Er appen åpen når terskelen passerer, er
        in-app-toasten varslingen, og den armerte Android-alarmen avlyses av
        diffen — et systemvarsel i tillegg er IKKE et ferdigkriterium. Er appen
        ikke åpen, er alarmen sikkerhetsnettet, og den skal være armert på
        forhånd. Klokka får faktisk passere terskelen her.
    13. Androids egen varselkanal: den opprettes med HØY viktighet, offentlig
        låseskjerm og vibrasjon, hvert varsel planlegges eksplisitt på den, og
        den finnes FØR den første alarmen armeres. Og migreringen: en
        installasjon med alarmer fra før kanalen fantes får dem planlagt på nytt
        — uten dubletter, uten en mistet framtid — mens gjentatt synk og nye
        omstarter ikke gjør noe mer. Til slutt at heads-up ikke har dratt med
        seg en eneste ny tillatelse: ingen fullskjerm, ingen skjerm-på, ingen
        presise alarmer.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notif-channels.test.js
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n +
    (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
};

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const uid = 'uK';
const id = {};
['UA', 'GA', 'LA', 'IA'].forEach((k) => { id[k] = U(); });

function buildDB(due) {
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'v', pos: 0, pos_ts: 1, pos_org: 'v',
  }, x);
  return {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'k@x.no', display_name: 'Kanal', user_metadata: {} }],
    passwords: { 'k@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Kanalområde' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Mappe' })],
    cards: [base({ id: id.LA, owner_id: uid, group_id: id.GA, title: 'Tannlegetime',
      k: true, p: true, lab_ts: 0, lab_org: '', due_at: due })],
    items: [base({ id: id.IA, owner_id: uid, card_id: id.LA, text: 'Punkt', done: false })],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
    push_subscriptions: [], push_deliveries: [],
  };
}

/* Plattformen, og bare den. `?ch=native` gir pluginbroen, `?ch=web` gir
   Notification + serviceWorker. `?nokkel=0` tvinger avsendernøkkelen tom;
   ellers setter testen inn sin egen faste nøkkel. Dermed tester begge grenene
   eksplisitt og uavhengig av hvilken nøkkel som står i produksjons-config.js. */
function fakePlattform() {
  const q = new URLSearchParams(location.search);
  const ch = q.get('ch');
  /* `pending` er pluginens LAGRING (det `getPending()` svarer med), `alarmer`
     er de faktisk armerte alarmene, og `levert` er de som har ringt.

     De tre er ikke det samme, og det er ikke en detalj:
     @capacitor/local-notifications BEHOLDER en rad i lagringen etter at den
     har ringt (`TimedNotificationPublisher` skriver ikke, og `cancel()` gjør
     `setCancelled` i stedet for å slette når varselet er levert). Et levert
     varsel står altså igjen i `getPending()` mens alarmen er borte, og
     adapterens diff må tåle det. Fakes den bort, beviser en test noe
     telefonen ikke gjør. */
  /* LAGRINGEN OVERLEVER EN OMSTART, som pluginens egen gjør: alarmer,
     lagrede rader, leverte varsler, kanalene telefonen har fått — og
     tillatelsen. Uten det ville en «appoppgradering» (en ny sidelasting) sett
     ut som en helt ny telefon, og en test av MIGRERING bevist ingenting.
     `sessionStorage`, så konteksten fortsatt er testens egen. */
  const LN_LAGER = 'hk-fake-ln';
  const lagret = (() => {
    try { return JSON.parse(sessionStorage.getItem(LN_LAGER) || 'null'); } catch (e) { return null; }
  })() || {};
  window.__kanal = { schedule: [], cancel: [], pending: [], alarmer: [], levert: [],
    /* Kanalene som er opprettet på «telefonen», og en logg over kallene i den
       rekkefølgen de kom — testen bruker den til å se at kanalen fantes FØR
       det første varselet ble planlagt. Loggen er øktens, ikke telefonens. */
    kanaler: [], logg: [],
    perm: q.get('perm') || 'prompt', spurt: 0, vist: [], meldt: [] };
  ['pending', 'alarmer', 'levert', 'kanaler'].forEach((k) => {
    if (Array.isArray(lagret[k])) window.__kanal[k] = lagret[k];
  });
  if (lagret.kanalFeil) window.__kanal.kanalFeil = lagret.kanalFeil;
  if (!q.get('perm') && lagret.perm) window.__kanal.perm = lagret.perm;
  window.__kanal.lagre = function () {
    try {
      sessionStorage.setItem(LN_LAGER, JSON.stringify({
        pending: window.__kanal.pending, alarmer: window.__kanal.alarmer,
        levert: window.__kanal.levert, kanaler: window.__kanal.kanaler,
        perm: window.__kanal.perm, kanalFeil: window.__kanal.kanalFeil || null,
      }));
    } catch (e) { /* full lagring: testen mister bare omstart-troverdigheten */ }
  };
  // Kalles av testen: alarmen ringte. Raden blir stående i lagringen.
  window.__kanal.lever = function (id) {
    window.__kanal.levert.push(id);
    window.__kanal.alarmer = window.__kanal.alarmer.filter((n) => n.id !== id);
    window.__kanal.lagre();
  };

  /* Ett RPC-kall kan tvinges til å feile: `window.__kanal.rpcFeil = '<navn>'`.
     Klienten app.js bruker lages ved oppstart, så innpakningen må sitte på
     `createClient` FØR mock-backenden blir tatt i bruk. */
  Object.defineProperty(window, 'HK_MOCK', {
    configurable: true,
    set(v) {
      const lagKlient = v.createClient;
      v.createClient = function () {
        const c = lagKlient.apply(this, arguments);
        const ekte = c.rpc.bind(c);
        c.rpc = function (navn, params) {
          if (window.__kanal && window.__kanal.rpcFeil === navn) {
            return Promise.resolve({ data: null, error: { message: 'nettverksfeil (test)' } });
          }
          return ekte(navn, params);
        };
        return c;
      };
      Object.defineProperty(window, 'HK_MOCK', { value: v, writable: true, configurable: true });
    },
    get() { return undefined; },
  });

  // config.js setter HUSKIS_CONFIG; testen eier nøkkeltilstanden FØR app.js
  // leser den, slik at «med nøkkel» og «uten nøkkel» ikke avhenger av prod.
  Object.defineProperty(window, 'HUSKIS_CONFIG', {
    configurable: true,
    set(v) {
      v.pushPublicKey = q.get('nokkel') === '0'
        ? ''
        : 'BKf-0z47jqWLUVd_3r4-JbyhdGwgWERsrt1l0Cfur7vPXM7644P_EyKSDC1aGhvm7kr5plt9zOpvdaz_WTuJoII';
      Object.defineProperty(window, 'HUSKIS_CONFIG', { value: v, writable: true, configurable: true });
    },
    get() { return undefined; },
  });

  if (ch === 'native') {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LocalNotifications: {
          checkPermissions: async () => ({ display: window.__kanal.perm }),
          requestPermissions: async () => {
            window.__kanal.spurt++;
            window.__kanal.perm = window.__kanal.svar || 'granted';
            window.__kanal.lagre();
            return { display: window.__kanal.perm };
          },
          /* `getPending()` er NOTIFICATION_STORE gjengitt slik pluginen selv
             gjør det (`buildLocalNotificationPendingList`): id, tekst, tidspunkt,
             `extra` og de to exact-flaggene. INGEN `channelId` — pluginen lagrer
             det appen sendte inn, og feltet er ikke med i svaret. Det er hele
             grunnen til at migreringen ikke kan plukke ut «alarmene på den gamle
             kanalen»: telefonen kan ikke svare på spørsmålet. */
          getPending: async () => ({
            notifications: window.__kanal.pending.map((n) => ({
              id: n.id, title: n.title, body: n.body,
              schedule: { at: n.at, repeats: false },
              extra: n.extra, isExactNotification: n.isExactNotification,
            })),
          }),
          createChannel: async (ch) => {
            window.__kanal.logg.push('createChannel:' + ch.id);
            /* Broen kan feile. `kanalFeil = true` er et hikst, mens
               `kanalFeil = 'UNAVAILABLE'` er Android UNDER 8: der finnes
               kanaler ikke, og pluginen svarer `call.unavailable()`, som
               native-broen gjør om til en Error med `code` satt. */
            if (window.__kanal.kanalFeil) {
              const e = new Error('kanal-feil (test)');
              if (typeof window.__kanal.kanalFeil === 'string') e.code = window.__kanal.kanalFeil;
              throw e;
            }
            const finnes = window.__kanal.kanaler.find((k) => k.id === ch.id);
            /* ANDROID LÅSER KANALEN: `createNotificationChannel` på en kanal som
               allerede finnes oppdaterer BARE navn og beskrivelse. Viktighet,
               låseskjerm og vibrasjon står som de ble opprettet — og det er
               nettopp derfor en heving av viktigheten krever en NY kanal-id. */
            if (finnes) {
              finnes.name = ch.name;
              finnes.description = ch.description;
            } else {
              window.__kanal.kanaler.push({
                id: ch.id, name: ch.name, description: ch.description,
                importance: ch.importance == null ? 3 : ch.importance,
                visibility: ch.visibility == null ? 1 : ch.visibility,
                vibration: !!ch.vibration,
                /* Pluginen rører aldri kanalens lyd når `sound` er tom, og en
                   Android-kanal har systemets vanlige varsellyd fra fødselen. */
                sound: ch.sound ? ch.sound : 'default',
              });
            }
            window.__kanal.lagre();
          },
          schedule: async (o) => {
            window.__kanal.logg.push('schedule:' + o.notifications.length);
            window.__kanal.schedule.push(o.notifications);
            o.notifications.forEach((n) => {
              /* Samme id igjen ERSTATTER: pluginen skriver lagringsraden på
                 id-en (`appendNotifications`) og avlyser den gamle alarmen før
                 den armerer den nye (`cancelTimerForNotification`). Ingen
                 dublett — og det er det som gjør en ny planlegging til en trygg
                 migrering. */
              window.__kanal.pending = window.__kanal.pending.filter((x) => x.id !== n.id);
              window.__kanal.alarmer = window.__kanal.alarmer.filter((x) => x.id !== n.id);
              window.__kanal.levert = window.__kanal.levert.filter((x) => x !== n.id);
              window.__kanal.pending.push({ id: n.id, title: n.title, body: n.body,
                at: n.schedule.at, extra: n.extra,
                isExactNotification: n.isExactNotification });
              /* KANALEN BAKES INN NÅR ALARMEN ARMERES: pluginen bygger hele
                 `Notification`-objektet i `schedule()` og legger det ferdige
                 objektet i alarmen. Kanalen til en armert alarm kan derfor ikke
                 endres — den må settes på nytt. */
              window.__kanal.alarmer.push({ id: n.id, at: n.schedule.at,
                kanal: n.channelId || 'default' });
            });
            window.__kanal.lagre();
          },
          cancel: async (o) => {
            window.__kanal.logg.push('cancel:' + o.notifications.length);
            window.__kanal.cancel.push(o.notifications);
            const vekk = new Set(o.notifications.map((n) => n.id));
            window.__kanal.alarmer = window.__kanal.alarmer.filter((n) => !vekk.has(n.id));
            // Et LEVERT varsel blir stående i lagringen (`setCancelled`); bare
            // et som ennå ikke har ringt slettes.
            const levert = new Set(window.__kanal.levert);
            window.__kanal.pending = window.__kanal.pending.filter(
              (n) => !vekk.has(n.id) || levert.has(n.id));
            window.__kanal.lagre();
          },
          addListener: async (navn, fn) => {
            if (navn === 'localNotificationActionPerformed') window.__kanal.trykk = fn;
            return { remove() {} };
          },
        },
        // OTA-pluginen finnes i det ekte skallet; uten stubbene ville
        // oppstarten feilet på noe som ikke er det denne testen handler om.
        LiveUpdate: {
          ready: async () => ({}),
          getVersionCode: async () => ({ versionCode: '3' }),
          getBlockedBundles: async () => ({ bundleIds: [] }),
        },
      },
    };
    return;
  }

  if (ch !== 'web') return;
  // Nettleserens tre ledd. `PushManager` finnes allerede i Chromium.
  class FakeNotification {
    static get permission() { return window.__kanal.perm; }
    static async requestPermission() {
      window.__kanal.spurt++;
      window.__kanal.perm = window.__kanal.svar || 'granted';
      return window.__kanal.perm;
    }
  }
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

  const nøkkel = (n) => new Uint8Array(n === 'auth' ? 16 : 65).fill(n === 'auth' ? 7 : 4).buffer;
  let abo = null;
  const reg = {
    pushManager: {
      getSubscription: async () => abo,
      subscribe: async (o) => {
        window.__kanal.subscribe = { userVisibleOnly: o.userVisibleOnly,
          nøkkelLengde: o.applicationServerKey.length };
        abo = { endpoint: 'https://push.test/' + (window.__kanal.endepunkt || 'abc'),
          getKey: nøkkel, unsubscribe: async () => { abo = null; return true; } };
        return abo;
      },
    },
    unregister: async () => { window.__kanal.avregistrert = true; return true; },
  };
  let registrert = null;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: async (url) => { window.__kanal.registrerte = url; registrert = reg; return reg; },
      getRegistration: async () => registrert,
      get ready() { return Promise.resolve(registrert || reg); },
      /* Meldingen `sw.js` sender ved et klikk kommer inn her i ekte drift.
         Lytteren tas vare på, så testen kan levere den samme meldingen. */
      addEventListener(navn, fn) { if (navn === 'message') window.__kanal.swMelding = fn; },
    },
  });
}

async function seed(p, url, db) {
  await p.goto(url);
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'k@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(url);
  /* Preferanseraden er signalet på at varselgenereringen har vært hele runden
     gjennom: den lages av den FØRSTE genereringen. Uten den kunne en måling av
     historikken like gjerne truffet før den første raden fantes — og da ville
     en senere runde sett ut som om kanalen la noe til. */
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0 && !!H.notifPrefs;
  }, null, { timeout: 15000, polling: 200 });
}

async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return !el || el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await p.waitForTimeout(400);
}

const db = (p) => p.evaluate(() => window.HK_MOCK._loadDB());

/* Rader rett i «databasen» — som om generatoren hadde logget dem. Brukt av 9:
   der er poenget hva FLATEN gjør med en rad som ankommer, ikke hvordan raden
   ble til (det dekker `notifications.test.js` og `notif-plan.test.js`). */
async function leggVarsler(p, rows) {
  await p.evaluate((rows) => {
    const d = window.HK_MOCK._loadDB();
    const uid = window.__huskis.authUser.id;
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    rows.forEach((r) => d.notifications.push(Object.assign({
      id: uuid(), user_id: uid, snoozed: false, path: 'Kanalområde › Mappe',
      created_at: Date.now(), read_at: null,
    }, r)));
    window.HK_MOCK._saveDB(d);
  }, rows);
}

/* Objektet må BÆRE tiden varselet handler om: en rad hvis verdi ikke lenger
   stemmer med objektets tid ryddes bort av appen selv (docs/varsler.md). */
async function settTid(p, objId, field, value) {
  await p.evaluate(({ objId, field, value }) => {
    const H = window.__huskis;
    for (const u of H.state.universes) {
      for (const g of (u.groups || [])) {
        for (const c of (g.cards || [])) {
          if (c.id === objId) { H.setObjectTime({ kind: 'card', obj: c, card: c }, field, value); return; }
          for (const it of (c.items || [])) {
            if (it.id === objId) { H.setObjectTime({ kind: 'item', obj: it, card: c }, field, value); return; }
          }
        }
      }
    }
  }, { objId, field, value });
  await p.waitForTimeout(250);
}

/* ---------- 9) Trykk på et systemvarsel skal ikke gi en toast i tillegg ----
   Varselet ble VIST utenfor appen, og brukeren trykket på det. Appen navigerer
   til objektet — og en toast om nøyaktig det varselet ville pekt på det
   brukeren nettopp trykket på og allerede står i.

   Rekkefølgen er den fra virkeligheten: pushen kom fra SERVEREN, så fanen har
   som regel ikke sett raden ennå når trykket kommer. Suppresjonen må derfor
   holde til raden lander i en senere pull.

   Kjøres for BEGGE kanalene — det eneste kanalspesifikke er hvordan trykket
   kommer inn (`trykk`). */
async function ingenRedundantToast(p, prefiks, iid, trykk) {
  const verdi = await p.evaluate(() => {
    const d = new Date();
    const to = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) + 'T07:00';
  });
  await settTid(p, iid, 'start', verdi);
  const trykket = 'startNow|item|' + iid + '|' + verdi;
  const annet = 'startSoon|item|' + iid + '|' + verdi;

  await trykk({ objType: 'item', objId: iid, key: trykket });
  await p.waitForTimeout(300);
  await leggVarsler(p, [{ type: 'startNow', obj_type: 'item', obj_id: iid, name: 'Punkt',
    key: trykket, value: verdi, at: Date.now() - 30000 }]);
  await cycle(p);
  await p.waitForTimeout(500);
  /* Raden MÅ ha kommet fram, og ingen lag stå åpent — ellers ville fraværet av
     en toast bevist ingenting (den samme rigorøsiteten som 15j i
     notif-modal.test.js). */
  const etterTrykk = await p.evaluate((k) => ({
    levert: window.__huskis.notifRows.some((r) => r.key === k),
    lag: document.body.classList.contains('modal-open'),
    toaster: document.querySelectorAll('.notif-toast').length,
  }), trykket);
  log(prefiks + 'a: varselet brukeren nettopp trykket på i systemet toaster ikke i appen',
    etterTrykk.levert === true && etterTrykk.lag === false && etterTrykk.toaster === 0,
    JSON.stringify(etterTrykk));

  await leggVarsler(p, [{ type: 'startSoon', obj_type: 'item', obj_id: iid, name: 'Punkt',
    key: annet, value: verdi, at: Date.now() - 20000 }]);
  await cycle(p);
  await p.waitForSelector('.notif-toast', { timeout: 4000 }).catch(() => {});
  const etterAnnet = await p.evaluate(() => [...document.querySelectorAll('.notif-toast')]
    .map((t) => t.querySelector('.notif-toast-msg').textContent));
  log(prefiks + 'b: … men et ANNET nytt varsel om det samme objektet toaster som før',
    etterAnnet.length === 1, JSON.stringify(etterAnnet));
  await p.evaluate(() => {
    [...document.querySelectorAll('.notif-toast')].forEach((t) => t.remove());
  });
}

/* `utenSone` lar tidssonen settes over CDP i stedet. Playwrights egen
   `timezoneId` ER en `Emulation.setTimezoneOverride`, og Chromium tar bare én:
   skal en test flytte enheten underveis (2n–2r), må den eie overriden selv. */
async function nyKontekst(browser, opts) {
  const o = { viewport: { width: 1200, height: 900 }, locale: 'nb-NO' };
  if (!(opts && opts.utenSone)) o.timezoneId = 'Europe/Oslo';
  const ctx = await browser.newContext(o);
  await ctx.addInitScript(fakePlattform);
  return ctx;
}

/* Service workeren kjøres i NODE, ikke i siden: appens
   innholdssikkerhetspolicy forbyr `unsafe-eval` (docs/sikkerhetsheadere.md), så
   en `new Function(kildekoden)` inne i nettleseren blir — helt riktig —
   blokkert. `sw.js` trenger uansett ingen DOM: den snakker bare med
   `self.registration` og `self.clients`, og begge fakes her. */
async function swSjekker() {
  const ventet = [];
  const ferdig = () => { const p = Promise.all(ventet); ventet.length = 0; return p; };
  const vent = (x) => { ventet.push(x); return x; };
  const vist = [];
  const meldt = [];
  let åpnet = null;
  let klienter = [];
  const lyttere = {};
  const scope = 'https://huskis.no/';
  const self_ = {
    addEventListener: (n, f) => { lyttere[n] = f; },
    skipWaiting: () => {},
    registration: {
      scope,
      showNotification: (t, o) => { vist.push({ t, o }); return Promise.resolve(); },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(klienter),
      openWindow: (u) => { åpnet = u; return Promise.resolve(); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'),
    vm.createContext({ self: self_, console, URL, encodeURIComponent }));

  const kropp = { k: 'dueOver|card|abc|2026-01-01', t: 'dueOver', n: 'Tannlegetime',
    b: 'Frist utløpt', ot: 'card', oi: 'abc' };
  lyttere.push({ data: { json: () => kropp }, waitUntil: vent });
  await ferdig();
  const data = vist[0].o.data;
  lyttere.notificationclick({ notification: { close() {}, data }, waitUntil: vent });
  await ferdig();
  const utenFane = åpnet;
  let fokusert = false;
  klienter = [{ url: scope, focus: () => { fokusert = true; }, postMessage: (m) => meldt.push(m) }];
  åpnet = null;
  lyttere.notificationclick({ notification: { close() {}, data }, waitUntil: vent });
  await ferdig();
  const medFane = åpnet;
  lyttere.push({ data: null, waitUntil: vent });
  await ferdig();

  log('7a: service workeren har INGEN fetch-lytter (oppdateringsmodellen er urørt)',
    Object.keys(lyttere).indexOf('fetch') === -1, Object.keys(lyttere).join(', '));
  log('7b: en push blir et varsel med navnet som overskrift og typeteksten som kropp',
    vist[0].t === 'Tannlegetime' && vist[0].o.body === 'Frist utløpt',
    JSON.stringify({ t: vist[0].t, b: vist[0].o.body }));
  log('7c: nøkkelen er `tag`, så det samme varselet ikke stabler seg',
    vist[0].o.tag === 'dueOver|card|abc|2026-01-01', vist[0].o.tag);
  log('7d: varselet bærer pekeren, og ingen sti eller token',
    JSON.stringify(data) === JSON.stringify(
      { objType: 'card', objId: 'abc', key: 'dueOver|card|abc|2026-01-01' }), JSON.stringify(data));
  log('7e: uten en åpen fane åpnes appen med pekeren i adressen',
    utenFane === scope + '?notif=card%3Aabc', utenFane);
  /* Nøkkelen er MED i meldingen: fanen bruker den til å la være å toaste
     nettopp det varselet en gang til (9 under). */
  log('7f: med en åpen fane fokuseres DEN, og får pekeren og nøkkelen som en melding',
    fokusert === true && medFane === null &&
    JSON.stringify(meldt) === JSON.stringify(
      [{ type: 'huskis-notif-open', objType: 'card', objId: 'abc',
        key: 'dueOver|card|abc|2026-01-01' }]), JSON.stringify(meldt));
  log('7g: en push uten lesbar kropp blir likevel et synlig varsel',
    vist.length === 2 && vist[1].t === 'Huskis' && vist[1].o.tag === 'huskis',
    JSON.stringify(vist[1] && { t: vist[1].t, tag: vist[1].o.tag }));
}

async function run() {
  const browser = await chromium.launch();
  const errs = [];

  /* ================= Android ================= */
  const ctxN = await nyKontekst(browser, { utenSone: true });
  const pn = await ctxN.newPage();
  pn.on('pageerror', (e) => errs.push('native: ' + e.message));
  const sonebytte = { fra: 'Europe/Oslo', til: 'Pacific/Kiritimati' };   // +02 → +14
  const cdp = await ctxN.newCDPSession(pn);
  const settSone = async (tz) => {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' });
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: tz });
  };
  await settSone(sonebytte.fra);
  const NURL = BASE + '/?mock=1&ch=native';
  await pn.goto(NURL);
  const due = await pn.evaluate(() => {
    const d = new Date(Date.now() + 10 * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T12:00';
  });
  await seed(pn, NURL, buildDB(due));

  /* ---------- 1) Den deterministiske ID-en ---------- */
  const ider = await pn.evaluate(() => {
    const H = window.__huskis;
    const f = H.nativeNotifId;
    const rad = (x) => Object.assign({ key: 'dueOver|card|abc|2026-01-01', type: 'dueOver',
      at: 1767200000000, name: 'Tannlegetime' }, x);
    const a = f(H.nativeNotifSig(rad()));
    return {
      stabil: a === f(H.nativeNotifSig(rad())),
      ulik: a !== f(H.nativeNotifSig(rad({ key: 'dueSoon|card|abc|2026-01-01' }))) &&
        a !== f(H.nativeNotifSig(rad({ key: 'dueOver|card|abd|2026-01-01' }))),
      // Samme nøkkel, ny terskeltid → en annen alarm. Dette ER tidssonebyttet.
      tid: a !== f(H.nativeNotifSig(rad({ at: 1767200000000 + 12 * 3600000 }))),
      // … og samme nøkkel, nytt objektnavn, likeså.
      tekst: a !== f(H.nativeNotifSig(rad({ name: 'Legetime' }))),
      heltall: Number.isInteger(a) && a >= 0 && a <= 0x7fffffff,
      spredning: new Set([...Array(500)].map((_, i) =>
        f(H.nativeNotifSig(rad({ key: 'dueOver|item|x' + i + '|2026-01-01' }))))).size,
    };
  });
  log('1a: samme signatur gir samme native ID', ider.stabil);
  log('1b: ulike nøkler gir ulike ID-er', ider.ulik);
  log('1c: samme nøkkel med NY terskeltid gir en annen ID', ider.tid);
  log('1d: samme nøkkel med nytt objektnavn gir en annen ID', ider.tekst);
  log('1e: ID-en er et positivt 31-bits heltall (Androids varsel-ID er et int)', ider.heltall);
  log('1f: 500 nøkler gir 500 ulike ID-er', ider.spredning === 500, ider.spredning);

  /* ---------- 2) Adapteren ---------- */
  log('2a: kanalen er den native når pluginbroen finnes',
    (await pn.evaluate(() => window.__huskis.notifChannel().id)) === 'native');
  log('2b: ingen tillatelse er spurt om av seg selv ved oppstart',
    (await pn.evaluate(() => window.__kanal.spurt)) === 0);
  log('2c: … og ingenting er planlagt før brukeren har slått kanalen på',
    (await pn.evaluate(() => window.__kanal.schedule.length)) === 0);

  await pn.evaluate(() => window.__huskis.setNotifChannel(true));
  await pn.waitForFunction(() => window.__kanal.schedule.length > 0, null, { timeout: 8000, polling: 100 });
  const s1 = await pn.evaluate(() => window.__kanal.schedule[0]);
  log('2d: bryteren er det som utløser systemdialogen — nøyaktig én gang',
    (await pn.evaluate(() => window.__kanal.spurt)) === 1);
  log('2e: planen ble speilet ut som native varsler', s1.length > 0, s1.length + ' varsler');
  log('2f: overskriften er objektets navn, kroppen er varseltypen i klartekst',
    s1.every((n) => n.title === 'Tannlegetime') &&
    s1.some((n) => n.body === 'Frist utløpt') && s1.some((n) => n.body === 'Frist om mindre enn en uke'),
    JSON.stringify(s1.map((n) => n.title + ' / ' + n.body)));
  log('2g: teksten bærer ingen sti og ingen id-er',
    s1.every((n) => !/›/.test(n.title + n.body) && !/[0-9a-f]{8}-/.test(n.title + n.body)));
  log('2h: alarmen er UPRESIS — appen ber aldri om SCHEDULE_EXACT_ALARM',
    s1.every((n) => n.isExactNotification === false && n.schedule.allowWhileIdle === true),
    JSON.stringify(s1[0].schedule));
  log('2i: tidspunktet er terskelens, som ISO-streng (pluginens eget format)',
    s1.every((n) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(n.schedule.at) &&
      new Date(n.schedule.at).getTime() > Date.now()), s1[0].schedule.at);
  log('2j: varselet bærer pekeren til objektet og sin egen veggtid, ikke noe mer',
    s1.every((n) => n.extra.objId && n.extra.objType && n.extra.key && n.extra.wall &&
      Object.keys(n.extra).length === 4), JSON.stringify(s1[0].extra));
  /* `wall` er alarmens tiltenkte LOKALE veggtid, og den er der for det ene
     tilfellet JS ikke kan nå: at telefonen bytter tidssone mens Huskis er helt
     lukket. Da leser `TimeZoneAlarmReceiver` nøyaktig dette feltet og regner om
     (docs/varsler.md). Her prøves bare at feltet er RIKTIG — at det beskriver
     den samme alarmen som `schedule.at`, sett med rendererens klokke. */
  log('2j2: veggtiden er den lokale klokka for alarmens eget tidspunkt',
    await pn.evaluate((ns) => ns.every((n) =>
      n.extra.wall === window.__huskis.notifWallClock(new Date(n.schedule.at).getTime())), s1),
    s1[0].extra.wall + ' ↔ ' + s1[0].schedule.at);
  log('2j3: veggtiden bærer ingen sone — det er hele poenget',
    s1.every((n) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(n.extra.wall)),
    s1[0].extra.wall);
  /* ID-en er hashen av SIGNATUREN — nøkkelen, terskeltiden og teksten — ikke av
     nøkkelen alene. Det er den forskjellen som gjør at et varsel som flytter seg
     i tid (en ny tidssone) blir en ANNEN alarm og dermed faktisk erstattes;
     2n–2r under viser hele veien. */
  log('2k: ID-en er den deterministiske hashen av nøkkel + tid + tekst',
    await pn.evaluate((ns) => ns.every((n) => n.id === window.__huskis.nativeNotifId(
      n.extra.key + '@' + new Date(n.schedule.at).getTime() + '|' + n.title + '|' + n.body)), s1));

  // Ny runde med samme plan: ingenting skal skje.
  await pn.evaluate(() => { window.__kanal.schedule.length = 0; window.__kanal.cancel.length = 0; });
  await cycle(pn);
  await pn.waitForTimeout(300);
  log('2l: en ny synk-runde med uendret plan planlegger ingenting på nytt',
    (await pn.evaluate(() => window.__kanal.schedule.length)) === 0 &&
    (await pn.evaluate(() => window.__kanal.cancel.length)) === 0);

  // Fullfør listepunktet: planen forsvinner, og de native varslene avlyses.
  await pn.evaluate((iid) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards[0];
    c.items.find((i) => i.id === iid).done = true;
    H.save();
  }, id.IA);
  await cycle(pn);
  await cycle(pn);
  await pn.waitForTimeout(300);
  const avlyst = await pn.evaluate(() => ({ cancel: window.__kanal.cancel.flat().length,
    pending: window.__kanal.pending.length }));
  log('2m: fullføring avlyser den native planen', avlyst.cancel > 0 && avlyst.pending === 0,
    JSON.stringify(avlyst));

  /* ---------- 2n–2r) TIDSSONEBYTTE: samme varsel, ny absolutt tid ----------
     Terskeltiden er lokal veggtid gjort om til et absolutt millisekund, så den
     følger enhetens tidssone. Nøkkelen gjør den ikke: den bærer objektets
     tidsVERDI, som står stille. En telefon som reiser får derfor det SAMME
     logiske varselet på et NYTT tidspunkt — og det er nøyaktig tilfellet der en
     diff på nøkkelen alene ville latt den gamle alarmen bli stående og ringt
     på gammelt klokkeslett.

     Her er hele veien: planlegg i sone A, flytt enheten til sone B (ekte
     tidssonebytte i renderer-en, ikke et påklistret `Intl`), la sonen hevdes,
     og se etter at den gamle alarmen er BORTE og bare den nye står igjen. */
  await pn.evaluate((iid) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards[0];
    c.items.find((i) => i.id === iid).done = false;
    H.save();
  }, id.IA);
  await cycle(pn);
  await cycle(pn);
  await pn.waitForFunction(() => window.__kanal.pending.length > 0, null,
    { timeout: 8000, polling: 100 });
  const førSone = await pn.evaluate(() => ({
    tz: window.__huskis.deviceTz(),
    planTz: window.__huskis.notifPlanTz,
    pending: window.__kanal.pending.map((n) => n.id).sort(),
    alarmer: window.__kanal.schedule.flat().map((n) => ({
      id: n.id, key: n.extra.key, at: new Date(n.schedule.at).getTime() })),
  }));

  /* Hevdelsen av en ny sone har en ventetid på serveren (seks timer), og den
     er meningen: uten den ville to enheter i hver sin sone planlagt om
     hverandre i hver runde. Her er reisen gjort — hevdelsen er gammel nok. */
  await pn.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    db.notification_prefs.forEach((r) => { r.tz_at = Date.now() - 7 * 3600 * 1000; });
    window.HK_MOCK._saveDB(db);
  });
  await settSone(sonebytte.til);
  await pn.evaluate(() => { window.__kanal.schedule.length = 0; window.__kanal.cancel.length = 0; });
  log('2n: enheten står nå i en annen tidssone enn den planen ble lagt i',
    (await pn.evaluate(() => window.__huskis.deviceTz())) === sonebytte.til &&
    førSone.tz === sonebytte.fra, førSone.tz + ' → ' + sonebytte.til);

  // Første runde hevder sonen, de neste planlegger og speiler i den.
  for (let i = 0; i < 5; i++) await cycle(pn);
  await pn.waitForFunction((gamle) => {
    const nå = window.__kanal.pending.map((n) => n.id).sort();
    return nå.length > 0 && JSON.stringify(nå) !== JSON.stringify(gamle);
  }, førSone.pending, { timeout: 15000, polling: 200 }).catch(() => {});

  const etter = await pn.evaluate(() => ({
    planTz: window.__huskis.notifPlanTz,
    pending: window.__kanal.pending.map((n) => n.id).sort(),
    lagt: window.__kanal.schedule.flat().map((n) => ({
      id: n.id, key: n.extra.key, at: new Date(n.schedule.at).getTime() })),
    avlyst: window.__kanal.cancel.flat().map((n) => n.id),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => ({ key: r.key, at: r.at,
        id: window.__huskis.nativeNotifId(window.__huskis.nativeNotifSig(r)) })),
  }));
  const parvis = etter.lagt.map((n) => {
    const gammel = førSone.alarmer.find((g) => g.key === n.key);
    return gammel ? { key: n.key, gammelAt: gammel.at, nyAt: n.at, gammelId: gammel.id } : null;
  }).filter(Boolean);

  log('2o: serveren har gitt planen til den nye sonen', etter.planTz === sonebytte.til,
    etter.planTz);
  log('2p: det SAMME logiske varselet har fått en ny absolutt tid',
    parvis.length > 0 && parvis.every((x) => x.nyAt !== x.gammelAt),
    JSON.stringify(parvis.map((x) => (x.nyAt - x.gammelAt) / 3600000 + ' t')));
  log('2q: den gamle alarmen er AVLYST, ikke bare liggende ved siden av',
    parvis.length > 0 && parvis.every((x) => etter.avlyst.indexOf(x.gammelId) !== -1) &&
    førSone.pending.every((gid) => etter.pending.indexOf(gid) === -1),
    JSON.stringify({ avlyst: etter.avlyst.length, gamleIgjen:
      førSone.pending.filter((g) => etter.pending.indexOf(g) !== -1) }));
  log('2r: bare den nye planen står igjen på telefonen',
    etter.plan.length > 0 &&
    JSON.stringify(etter.pending) === JSON.stringify(etter.plan.map((r) => r.id).sort()),
    JSON.stringify({ pending: etter.pending.length, plan: etter.plan.length }));

  /* ---------- 2s–2v) NORMALTILFELLET: en fersk lease, og telefonen reiser ----
     Over ble hevdelsen gjort gammel med vilje, så serverplanen kunne overtas.
     Det er ikke det som skjer når noen tar et fly: da er hevdelsen FERSK, og
     serveren nekter overtakelse i opptil seks timer. Dempingen er riktig — to
     enheter i hver sin sone ville ellers skrevet om hverandres plan i hver
     eneste synk-runde — men den skal ikke ramme telefonens EGNE alarmer.

     Her flyttes enheten en gang til, uten at `tz_at` røres. Forventningen:
     serverplanen blir stående i den forrige sonen (leasen holder), mens de
     lokale alarmene følger klokka der telefonen faktisk er — med det samme, og
     uten et hull. */
  const tredjeSone = 'America/Sao_Paulo';                       // UTC−3
  const førReise = await pn.evaluate(() => ({
    planTz: window.__huskis.notifPlanTz,
    tzAt: window.HK_MOCK._loadDB().notification_prefs.map((r) => r.tz_at),
    pending: window.__kanal.pending.map((n) => n.id).sort(),
    serverAt: window.HK_MOCK._loadDB().notifications.map((n) => n.at).sort(),
  }));
  await pn.evaluate(() => { window.__kanal.schedule.length = 0; window.__kanal.cancel.length = 0; });
  await settSone(tredjeSone);
  for (let i = 0; i < 4; i++) await cycle(pn);
  await pn.waitForFunction((gamle) => {
    const nå = window.__kanal.pending.map((n) => n.id).sort();
    return nå.length > 0 && JSON.stringify(nå) !== JSON.stringify(gamle);
  }, førReise.pending, { timeout: 15000, polling: 200 }).catch(() => {});

  const reise = await pn.evaluate(() => ({
    tz: window.__huskis.deviceTz(),
    planTz: window.__huskis.notifPlanTz,
    tzAt: window.HK_MOCK._loadDB().notification_prefs.map((r) => r.tz_at),
    pending: window.__kanal.pending.map((n) => n.id).sort(),
    lagt: window.__kanal.schedule.flat().map((n) => ({
      key: n.extra.key, at: new Date(n.schedule.at).getTime() })),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => ({ key: r.key, at: r.at,
        id: window.__huskis.nativeNotifId(window.__huskis.nativeNotifSig(r)) })),
    serverAt: window.HK_MOCK._loadDB().notifications.map((n) => n.at).sort(),
  }));
  log('2s: serverplanen blir stående i den forrige sonen — leasen er fersk',
    reise.tz === tredjeSone && reise.planTz === sonebytte.til &&
    JSON.stringify(reise.tzAt) === JSON.stringify(førReise.tzAt),
    JSON.stringify({ enhet: reise.tz, plan: reise.planTz }));
  log('2t: … og serverradene er urørt, så den andre enheten planlegger videre',
    JSON.stringify(reise.serverAt) === JSON.stringify(førReise.serverAt),
    JSON.stringify({ før: førReise.serverAt.length, nå: reise.serverAt.length }));
  log('2u: MEN telefonen står ikke uten alarmer mens den venter på leasen',
    reise.pending.length > 0 && reise.plan.length > 0, JSON.stringify(
      { pending: reise.pending.length, plan: reise.plan.length }));
  log('2v: … de er lagt på nytt etter klokka der telefonen faktisk er',
    JSON.stringify(reise.pending) === JSON.stringify(reise.plan.map((r) => r.id).sort()) &&
    reise.lagt.length > 0 &&
    reise.lagt.every((n) => {
      const p = reise.plan.find((x) => x.key === n.key);
      return p && p.at === n.at;
    }) &&
    førReise.pending.every((g) => reise.pending.indexOf(g) === -1),
    JSON.stringify(reise.lagt.map((n) => new Date(n.at).toISOString())));

  /* ---------- 2w) Nytt navn på objektet: alarmen skal si det nye ----------
     Teksten i et native varsel er objektets navn. Det navnet kan endre seg uten
     at hverken nøkkelen eller terskeltiden gjør det — og da skal alarmen som
     alt ligger på telefonen erstattes, ikke bli stående og si det gamle. */
  await pn.evaluate(() => { window.__kanal.schedule.length = 0; window.__kanal.cancel.length = 0; });
  const førNavn = await pn.evaluate(() => window.__kanal.pending.map((n) => n.id).sort());
  await pn.evaluate(() => {
    const H = window.__huskis;
    H.state.universes[0].groups[0].cards[0].title = 'Legetime';
    H.save();
  });
  for (let i = 0; i < 3; i++) await cycle(pn);
  const navn = await pn.evaluate(() => ({
    lagt: window.__kanal.schedule.flat().map((n) => n.title),
    avlyst: window.__kanal.cancel.flat().map((n) => n.id),
    pending: window.__kanal.pending.map((n) => n.id).sort(),
  }));
  log('2w: et nytt objektnavn erstatter alarmen i stedet for å fryse teksten',
    navn.lagt.length > 0 && navn.lagt.every((t) => t === 'Legetime') &&
    førNavn.every((g) => navn.avlyst.indexOf(g) !== -1) &&
    førNavn.every((g) => navn.pending.indexOf(g) === -1),
    JSON.stringify({ lagt: navn.lagt, avlyst: navn.avlyst.length }));
  await pn.evaluate(() => {
    const H = window.__huskis;
    H.state.universes[0].groups[0].cards[0].title = 'Tannlegetime';
    H.save();
  });
  await cycle(pn);

  await settSone(sonebytte.fra);
  await cdp.detach();

  /* ---------- 3) Trykk på et native varsel ---------- */
  await pn.evaluate((iid) => {
    const H = window.__huskis;
    const c = H.state.universes[0].groups[0].cards[0];
    c.items.find((i) => i.id === iid).done = false;
    H.save();
  }, id.IA);
  const truffet = await pn.evaluate(async (lid) => {
    window.__kanal.trykk({ notification: { extra: { objType: 'card', objId: lid } } });
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('.nav-flash, [data-id="' + lid + '"]');
    return { flash: !!document.querySelector('.nav-flash'), finnes: !!el };
  }, id.LA);
  log('3: et trykk på varselet navigerer til objektet', truffet.finnes, JSON.stringify(truffet));

  /* 9 for den native kanalen: nøkkelen ligger i `extra` og følger med trykket. */
  await ingenRedundantToast(pn, '9n', id.IA, (peker) => pn.evaluate((x) => {
    window.__kanal.trykk({ notification: { extra:
      { objType: x.objType, objId: x.objId, key: x.key } } });
  }, peker));

  await ctxN.close();

  /* ================= 11) Den native planen er TELEFONENS ==================
     Scenariet er det fra den fysiske testen på Android: et varsel kom, det
     forfalt — og det neste kom aldri.

     Kanalen er LOKAL. Alarmene ligger på telefonen, ingen server leser dem, og
     ingen server trengs for å legge dem (docs/varsler.md, «De eksterne
     kanalene»). Speilingen kjørte likevel bare fra `applyNotifications`, altså
     først etter en VELLYKKET pull: var nettet borte eller svarte serveren
     feil, ble en nyopprettet eller endret frist aldri en alarm, og telefonen
     ble stående med den forrige planen — helt stille.

     Hele veien prøves her, og med vilje UTEN et eneste manuelt `cloudCycle()`:
     appen skal ordne dette selv. Web push finnes ikke i denne konteksten (det
     er en native runtime), så ingenting av det som virker kan komme derfra. */
  const ctxR = await nyKontekst(browser);
  const pr = await ctxR.newPage();
  pr.on('pageerror', (e) => errs.push('lokal: ' + e.message));
  const RURL = BASE + '/?mock=1&ch=native';
  await seed(pr, RURL, buildDB(null));

  // Klokkeslettet «om N minutter», i det tekstformatet tidsfeltene har.
  const omMin = (n) => pr.evaluate((m) => {
    const d = new Date(Date.now() + m * 60000);
    const to = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) +
      'T' + to(d.getHours()) + ':' + to(d.getMinutes());
  }, n);
  const alarmer = () => pr.evaluate(() => ({
    armert: window.__kanal.alarmer.map((n) => n.at).sort(),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => new Date(r.at).toISOString()).sort(),
    lagring: window.__kanal.pending.length,
  }));

  log('11a: i appen finnes bare den native kanalen — web push kan ikke redde noe her',
    (await pr.evaluate(() => window.__huskis.notifChannel().id)) === 'native' &&
    (await pr.evaluate(() => window.HK_MOCK._loadDB().push_subscriptions.length)) === 0);

  await pr.evaluate(() => window.__huskis.setNotifChannel(true));
  await pr.waitForFunction(() => window.__huskis.notifChState === 'on',
    null, { timeout: 8000, polling: 100 });

  // (1) Varsel A: en frist noen minutter fram. Ingen manuell synk-runde.
  await settTid(pr, id.LA, 'due', await omMin(4));
  await pr.waitForFunction(() => window.__kanal.alarmer.length > 0,
    null, { timeout: 8000, polling: 100 }).catch(() => {});
  const a11 = await alarmer();
  log('11b: en ny frist blir en alarm på telefonen, uten at noe manuelt kjøres',
    a11.armert.length > 0 && JSON.stringify(a11.armert) === JSON.stringify(a11.plan),
    JSON.stringify(a11));

  // (2) A RINGER. Pluginen beholder raden i lagringen etterpå — den er borte
  //     som alarm, men står igjen i `getPending()`.
  await pr.evaluate(() => window.__kanal.alarmer.slice().forEach((n) => window.__kanal.lever(n.id)));
  // (3) … og terskelen er passert.
  await settTid(pr, id.LA, 'due', await omMin(-3));
  await pr.waitForTimeout(1800);
  const a12 = await alarmer();
  log('11c: … og etter at den har ringt står ingen alarm igjen',
    a12.armert.length === 0 && a12.plan.length === 0 && a12.lagring > 0,
    JSON.stringify(a12));

  /* (4) NYTT FORSØK — og nå er serveren utilgjengelig. Det er nettopp her den
         gamle koden ble stille: `applyNotifications` kjøres først etter en
         vellykket pull, så speilingen kjørte aldri. */
  await pr.evaluate(() => {
    window.__kanal.rpcFeil = 'get_my_doc';
    window.__kanal.schedule.length = 0;
    window.__kanal.cancel.length = 0;
  });
  await settTid(pr, id.LA, 'due', await omMin(6));
  await pr.waitForFunction(() => window.__kanal.alarmer.length > 0,
    null, { timeout: 8000, polling: 100 }).catch(() => {});
  const a13 = await pr.evaluate(() => ({
    armert: window.__kanal.alarmer.map((n) => n.at).sort(),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => new Date(r.at).toISOString()).sort(),
    lagt: window.__kanal.schedule.flat().length,
    // Ingen runde nådde serveren: rådataene er urørt siden forrige forsøk.
    serverrader: window.HK_MOCK._loadDB().notifications.length,
  }));
  // (5) B SKAL ligge på telefonen.
  log('11d: en ny terskel blir en alarm SELV NÅR serveren ikke svarer',
    a13.lagt > 0 && a13.armert.length > 0 &&
    JSON.stringify(a13.armert) === JSON.stringify(a13.plan), JSON.stringify(a13));
  log('11e: … og den gamle, leverte raden blokkerer den ikke',
    a13.armert.length === a13.plan.length && a13.plan.length > 0,
    JSON.stringify({ armert: a13.armert.length, plan: a13.plan.length }));

  /* 11f) SPEILINGEN ER SERIALISERT.

     To runder kan ligge i pluginbroen samtidig — poll-runden, og runden
     brukerens egen endring utløste rett etterpå. Begge leser `getPending()`
     FØR noen av dem har skrevet, så begge tror alarmen sin mangler og legger
     den inn, mens ingen av dem ser den andres. Telefonen sitter da igjen med
     ÉN alarm for mye: den som ble tatt ut av planen ringer likevel. Og fordi
     den runden som svarer sist skriver signaturen sin, står vakten etterpå og
     sier «uendret» — den overflødige alarmen blir aldri ryddet bort.

     Her tvinges nøyaktig den rekkefølgen: broen svarer på den FØRSTE
     planleggingen før den andre, mens begge har lest lagringen på forhånd. */
  await pr.evaluate(() => {
    const ln = window.Capacitor.Plugins.LocalNotifications;
    const ekte = ln.schedule;
    window.__kanal.ekteSchedule = ekte;      // 11g legger tregheten tilbake
    let n = 0;
    ln.schedule = function () {
      const vent = n++ === 0 ? 100 : 200;   // første inn, første ut
      const args = arguments;
      return new Promise((ok) => setTimeout(() => ok(ekte.apply(ln, args)), vent));
    };
    window.__kanal.schedule.length = 0;
  });
  const treg = await pr.evaluate(async (lid) => {
    const H = window.__huskis;
    let kort = null;
    for (const u of H.state.universes) for (const g of (u.groups || []))
      for (const c of (g.cards || [])) if (c.id === lid) kort = c;
    const to = (x) => String(x).padStart(2, '0');
    const klokke = (m) => {
      const d = new Date(Date.now() + m * 60000);
      return d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) +
        'T' + to(d.getHours()) + ':' + to(d.getMinutes());
    };
    /* To ULIKE planer i lufta samtidig. Planen beregnes synkront, før første
       await, så tiden endres mellom de to kallene: runde 1 bærer den ene,
       runde 2 den andre, og begge har lest lagringen før noen av dem skriver. */
    H.setObjectTime({ kind: 'card', obj: kort, card: kort }, 'due', klokke(9));
    const r1 = H.syncNotifChannel();
    H.setObjectTime({ kind: 'card', obj: kort, card: kort }, 'due', klokke(14));
    const r2 = H.syncNotifChannel();
    await Promise.all([r1, r2]);
    // Godt forbi både broen og den lokale etterspeilingen (600 ms).
    await new Promise((r) => setTimeout(r, 1500));
    return {
      armert: window.__kanal.alarmer.map((n) => n.at).sort(),
      plan: H.planNotifications(H.state, Date.now(), H.notifPrefs)
        .map((r) => new Date(r.at).toISOString()).sort(),
    };
  }, id.LA);
  log('11f: to overlappende speilinger etterlater telefonen med NØYAKTIG planen',
    treg.plan.length > 0 && JSON.stringify(treg.armert) === JSON.stringify(treg.plan),
    JSON.stringify(treg));

  /* 11g) EN KØET RUNDE FALLER IKKE MED DEN SOM FEILET.

     Broen kan feile forbigående. Signaturen står da urørt, så «neste runde»
     gjør hele jobben — men uten nett FINNES det ingen neste runde: ingen pull
     kommer fram, og debouncen til endringen som køet seg har allerede fyrt.
     Falt den køede runden bort sammen med den som feilet, kostet ett hikst i
     broen nøyaktig den alarmen.

     Her feiler den første runden med vilje, mens en annen står i kø bak den.
     Tidene settes rett i `state` — uten `save()`, så ingen debounce kan komme
     og redde det som skal prøves. */
  await pr.evaluate(() => {
    const ln = window.Capacitor.Plugins.LocalNotifications;
    ln.schedule = window.__kanal.ekteSchedule || ln.schedule;   // fjern tregheten fra 11f
    const ekte = ln.getPending;
    let n = 0;
    ln.getPending = function () {
      const args = arguments;
      // Første runde: svar sent, og feil. De neste går som normalt.
      if (n++ === 0) {
        return new Promise((_, nei) => setTimeout(() => nei(new Error('bro-hikst (test)')), 200));
      }
      return ekte.apply(ln, args);
    };
    window.__kanal.schedule.length = 0;
  });
  const hikst = await pr.evaluate(async (lid) => {
    const H = window.__huskis;
    let kort = null;
    for (const u of H.state.universes) for (const g of (u.groups || []))
      for (const c of (g.cards || [])) if (c.id === lid) kort = c;
    const to = (x) => String(x).padStart(2, '0');
    const klokke = (m) => {
      const d = new Date(Date.now() + m * 60000);
      return d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) +
        'T' + to(d.getHours()) + ':' + to(d.getMinutes());
    };
    kort.due = klokke(19);
    const r1 = H.syncNotifChannel();        // denne feiler i broen
    kort.due = klokke(24);
    const r2 = H.syncNotifChannel();        // denne står i kø bak den
    await Promise.all([r1, r2]);
    await new Promise((r) => setTimeout(r, 800));
    return {
      armert: window.__kanal.alarmer.map((n) => n.at).sort(),
      plan: H.planNotifications(H.state, Date.now(), H.notifPrefs)
        .map((r) => new Date(r.at).toISOString()).sort(),
    };
  }, id.LA);
  log('11g: en runde som står i kø bak en som FEILET blir likevel kjørt',
    hikst.plan.length > 0 && JSON.stringify(hikst.armert) === JSON.stringify(hikst.plan),
    JSON.stringify(hikst));

  await ctxR.close();

  /* ================= 12) ÉN SYNLIG VARSLING, IKKE TO ==================
     PRODUKTREGEL, ikke en tilfeldighet: står Huskis åpen når terskelen
     passerer, er IN-APP-TOASTEN varslingen. Er appen ikke åpen, er den
     lokale Android-alarmen det.

     Mekanismen er tettere enn den ser ut. `applyNotifications()` tar ÉTT
     øyeblikk (`nå`) for hele runden og bruker det to steder, tre linjer fra
     hverandre:

       announceNotifs(nå)   → `notifVisible` er radene med `at <= nå`
                              ⇒ den nettopp passerte terskelen er SYNLIG, og toaster
       syncNotifChannel(nå) → `planNotifications` er tersklene med `at > nå`
                              ⇒ den samme terskelen er UTE av framtidsplanen,
                                og Android-diffen avlyser den armerte alarmen

     Det samme millisekundet legger altså terskelen på hver sin side av de to
     vinduene. Toasten «spiser» ikke alarmen — begge deler følger av at
     terskelen er passert, og appen kjører.

     Om Android likevel rekker å vise systemvarselet før runden avlyser det, er
     et kappløp: alarmene er UPRESISE med vilje (`setAndAllowWhileIdle`), mens
     runden går hvert femte sekund i forgrunnen. Derfor prøver denne testen
     TILSTANDEN, ikke Androids UI: at toasten kom, og at den passerte terskelen
     er ute av den framtidige native planen. **Et systemvarsel i tillegg er
     IKKE et ferdigkriterium** — det er nettopp det regelen skal unngå.

     Klokka får faktisk passere terskelen her. Terskeltidene ligger på hele
     minutter (`timeMs` av et `HH:MM`-felt), så testen venter på det neste
     minuttskiftet i stedet for å jukse med tiden — det er den ene måten den
     SAMME terskelen kan gå fra framtid til fortid uten å bytte nøkkel. */
  const ctxF = await nyKontekst(browser);
  const pf = await ctxF.newPage();
  pf.on('pageerror', (e) => errs.push('forgrunn: ' + e.message));
  const FURL = BASE + '/?mock=1&ch=native';
  await seed(pf, FURL, buildDB(null));
  await pf.evaluate(() => window.__huskis.setNotifChannel(true));
  await pf.waitForFunction(() => window.__huskis.notifChState === 'on',
    null, { timeout: 8000, polling: 100 });

  /* Toastene står i tre sekunder. En observatør fanger dem når de kommer, så
     et poll ikke kan gå glipp av en som rakk å forsvinne. */
  await pf.evaluate(() => {
    window.__toaster = [];
    new MutationObserver((muts) => muts.forEach((m) => [...m.addedNodes].forEach((n) => {
      if (n.nodeType !== 1 || !n.classList || !n.classList.contains('notif-toast')) return;
      const msg = n.querySelector('.notif-toast-msg');
      window.__toaster.push((n.getAttribute('aria-label') || '') + ' | ' +
        (msg ? msg.textContent : n.textContent));
    }))).observe(document.body, { childList: true, subtree: true });
  });

  // Neste hele minutt, med klaring nok til at alarmen rekker å bli armert.
  const grense = await pf.evaluate(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    if (d.getTime() - Date.now() < 9000) d.setMinutes(d.getMinutes() + 1);
    const to = (n) => String(n).padStart(2, '0');
    return {
      verdi: d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) +
        'T' + to(d.getHours()) + ':' + to(d.getMinutes()),
      at: d.getTime(),
    };
  });

  /* ---------- SCENARIO B: alarmen er armert FØR appen kan forsvinne ----------
     Ferdigkriteriet er ikke at JS gjør noe når tiden kommer — det gjør den
     ikke når appen er borte. Det er at Android HAR alarmen på forhånd, og kan
     levere den helt alene. */
  await settTid(pf, id.LA, 'due', grense.verdi);
  await pf.waitForFunction(() => window.__kanal.alarmer.length > 0,
    null, { timeout: 10000, polling: 100 });
  const armert = await pf.evaluate(() => ({
    alarmer: window.__kanal.alarmer.map((n) => ({ id: n.id, at: new Date(n.at).getTime() })),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => ({
        at: r.at, key: r.key,
        id: window.__huskis.nativeNotifId(window.__huskis.nativeNotifSig(r)),
      })),
    nå: Date.now(),
  }));
  log('12a: terskelen ligger som armert Android-alarm mens den ennå er i framtiden',
    armert.alarmer.length === 1 && armert.plan.length === 1 &&
    armert.alarmer[0].id === armert.plan[0].id && armert.nå < grense.at,
    JSON.stringify({ alarmer: armert.alarmer.length, plan: armert.plan.length,
      igjen: Math.round((grense.at - armert.nå) / 1000) + ' s' }));
  log('12b: … på nøyaktig terskelens tidspunkt, så Android kan levere den uten JS',
    armert.alarmer.length === 1 && armert.alarmer[0].at === grense.at &&
    armert.plan[0].at === grense.at,
    JSON.stringify({ alarm: armert.alarmer[0] && armert.alarmer[0].at, terskel: grense.at }));
  const armertId = armert.alarmer[0] && armert.alarmer[0].id;
  const armertKey = armert.plan[0] && armert.plan[0].key;

  /* ---------- SCENARIO A: terskelen passerer med appen i forgrunnen ---------- */
  await pf.evaluate(() => { window.__kanal.cancel.length = 0; });
  // Klokka får gå. Dette er en TIDSVINDU-observasjon (tests/CLAUDE.md): det
  // er nettopp klokkeskiftet som er hendelsen.
  await pf.waitForFunction((t) => Date.now() > t + 300, grense.at,
    { timeout: 90000, polling: 500 });
  // Runden som logger den passerte terskelen, og runden som henter den ned.
  for (let i = 0; i < 3; i++) await cycle(pf);
  await pf.waitForFunction((k) => window.__huskis.notifRows.some((r) => r.key === k),
    armertKey, { timeout: 10000, polling: 200 }).catch(() => {});
  await pf.waitForTimeout(600);

  const etterpå = await pf.evaluate(({ k, id }) => ({
    toaster: window.__toaster.slice(),
    rad: window.__huskis.notifRows.filter((r) => r.key === k)
      .map((r) => ({ at: r.at, name: r.name })),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => r.key),
    alarmer: window.__kanal.alarmer.map((n) => n.id),
    avlyst: window.__kanal.cancel.flat().map((n) => n.id),
    lag: document.body.classList.contains('modal-open'),
  }), { k: armertKey, id: armertId });

  log('12c: terskelen passerte, og varselet ble presentert som IN-APP-TOAST',
    etterpå.rad.length === 1 && etterpå.toaster.length >= 1 &&
    etterpå.toaster.some((t) => /Tannlegetime/.test(t)) && etterpå.lag === false,
    JSON.stringify({ rad: etterpå.rad, toaster: etterpå.toaster }));
  log('12d: … den passerte terskelen er ikke lenger i den framtidige native planen',
    etterpå.plan.indexOf(armertKey) === -1, JSON.stringify(etterpå.plan));
  /* DETTE er regelen, og den er bevisst: den armerte alarmen avlyses av
     diffen, så brukeren ikke får BÅDE toast og systemvarsel for det samme.
     Et systemvarsel i tillegg er ikke et ferdigkriterium — fraværet av det er
     produktregelen. */
  log('12e: … og den armerte alarmen ble AVLYST — ingen toast + systemvarsel for det samme',
    etterpå.alarmer.indexOf(armertId) === -1 && etterpå.avlyst.indexOf(armertId) !== -1,
    JSON.stringify({ armertId: armertId, alarmerIgjen: etterpå.alarmer,
      avlyst: etterpå.avlyst }));
  /* Ingenting er tapt: raden står i historikken, så badgen og modalen har
     varselet selv om ingen systemvarsel ble vist. */
  log('12f: … mens raden står i historikken, så varselet ikke er tapt',
    etterpå.rad.length === 1 && etterpå.rad[0].at === grense.at,
    JSON.stringify(etterpå.rad));
  /* 12g) OG REGELEN HOLDER MED HØYPRIORITETSKANALEN. Alarmen som ble avlyst
     her sto på Huskis' egen kanal, den som ber Android om et heads-up. Det er
     nettopp derfor avlysningen er regelen: kanalen gjør systemvarselet MER
     synlig, og et som kom i tillegg til toasten ville vært to varslinger om
     det samme. Heads-up gjelder når appen ikke er der til å vise noe selv. */
  const forgrunnsKanal = await pf.evaluate(() => ({
    lagt: window.__kanal.schedule.flat().map((n) => n.channelId),
    prio: window.__kanal.schedule.flat().map((n) => n.foreground),
    ch: window.__huskis.NATIVE_CH_ID,
  }));
  log('12g: … og regelen holder selv om alarmen sto på høyprioritetskanalen',
    forgrunnsKanal.lagt.length > 0 &&
    forgrunnsKanal.lagt.every((c) => c === forgrunnsKanal.ch) &&
    etterpå.toaster.length === 1 && etterpå.avlyst.indexOf(armertId) !== -1,
    JSON.stringify({ kanaler: forgrunnsKanal.lagt, toaster: etterpå.toaster.length }));
  /* `foreground: true` er Androids PRIORITET, ikke iOS-ens «vis selv om appen
     er åpen»: pluginen gjør bare `setPriority(PRIORITY_HIGH)` av det. Alarmen
     her bar flagget — og ble likevel avlyst da appen selv presenterte
     varselet. Regelen ligger i diffen, ikke i et stille varsel. */
  log('12h: … og heller ikke fordi varselet bærer høy prioritet',
    forgrunnsKanal.prio.length > 0 && forgrunnsKanal.prio.every((f) => f === true) &&
    etterpå.avlyst.indexOf(armertId) !== -1 && etterpå.toaster.length === 1,
    JSON.stringify({ prioritet: forgrunnsKanal.prio, toaster: etterpå.toaster.length }));

  await ctxF.close();

  /* ================= 13) ANDROIDS EGEN VARSELKANAL ==================
     Et varsel som bare legger seg stille i varselpanelet er ikke et varsel om
     at en frist har utløpt. Alarmene har derfor sin EGEN Android-kanal, med
     høy viktighet, offentlig låseskjerm og vibrasjon — alt Android trenger for
     å vise varselet som et heads-up.

     Det er en FORESPØRSEL, ikke en garanti: brukeren, «Ikke forstyrr» og
     produsentens innstillinger har siste ord, og det er meningen. Det som
     prøves her er derfor Huskis' halvdel — at kanalen ber om det den skal, at
     hvert varsel faktisk planlegges på den, og at kanalen finnes FØR den
     første alarmen armeres.

     Og migreringen, som er det egentlige arbeidet: en installasjon som
     allerede har alarmer, fikk dem armert før kanalen fantes. Android låser en
     kanals viktighet i det den opprettes, så de gamle alarmene kan ikke løftes
     over — de må planlegges på nytt. `getPending()` kan ikke fortelle hvilken
     kanal en alarm står på (svaret bærer ikke feltet), så migreringen tar hele
     planen, én gang per kanal-id, og må tåle å bli kjørt om igjen. */
  const ctxK = await nyKontekst(browser);
  const pk = await ctxK.newPage();
  pk.on('pageerror', (e) => errs.push('kanal: ' + e.message));
  const KURL = BASE + '/?mock=1&ch=native';
  await seed(pk, KURL, buildDB(due));

  log('13a: ingen kanal opprettes av seg selv — først når brukeren slår varslene på',
    (await pk.evaluate(() => window.__kanal.kanaler.length)) === 0,
    await pk.evaluate(() => JSON.stringify(window.__kanal.logg)));

  await pk.evaluate(() => window.__huskis.setNotifChannel(true));
  await pk.waitForFunction(() => window.__kanal.schedule.length > 0,
    null, { timeout: 8000, polling: 100 });
  await pk.waitForTimeout(300);

  const k1 = await pk.evaluate(async () => {
    const ln = window.Capacitor.Plugins.LocalNotifications;
    const pending = await ln.getPending();
    return {
      chId: window.__huskis.NATIVE_CH_ID,
      kanaler: window.__kanal.kanaler,
      logg: window.__kanal.logg.slice(),
      lagt: window.__kanal.schedule.flat().map((n) => ({
        id: n.id, kanal: n.channelId,
        fullScreen: n.fullScreenIntent, forgrunn: n.foreground, lyd: n.sound })),
      alarmer: window.__kanal.alarmer.map((n) => ({ id: n.id, kanal: n.kanal })),
      pendingFelter: (pending.notifications || []).map((n) => Object.keys(n).sort().join(',')),
      merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
    };
  });
  const kanal = k1.kanaler[0];
  log('13b: kanalen er ÉN, med Huskis’ egen stabile id',
    k1.kanaler.length === 1 && !!kanal && kanal.id === k1.chId && /\S/.test(k1.chId),
    JSON.stringify(k1.kanaler.map((k) => k.id)));
  log('13c: … med HØY viktighet (4), offentlig låseskjerm (1) og vibrasjon',
    !!kanal && kanal.importance === 4 && kanal.visibility === 1 && kanal.vibration === true,
    JSON.stringify(kanal));
  /* Ingen medbrakt lydfil: pluginen rører aldri kanalens lyd når `sound` er
     tom, og en Android-kanal har systemets vanlige varsellyd fra fødselen. */
  log('13d: … og Androids vanlige varsellyd, ikke en egen lydfil',
    !!kanal && kanal.sound === 'default' &&
    k1.lagt.every((n) => n.lyd === undefined), JSON.stringify({ kanal: kanal && kanal.sound }));
  log('13e: kanalen har et navn og en beskrivelse — teksten brukeren ser i systeminnstillingene',
    !!kanal && /\S/.test(kanal.name || '') && /\S/.test(kanal.description || ''),
    JSON.stringify({ navn: kanal && kanal.name, tekst: kanal && kanal.description }));
  log('13f: HVERT native varsel planlegges eksplisitt på den kanalen',
    k1.lagt.length > 0 && k1.lagt.every((n) => n.kanal === k1.chId),
    JSON.stringify(k1.lagt.map((n) => n.kanal)));
  /* Kanalen bakes inn i alarmen når den armeres, og kan ikke endres etterpå.
     Derfor er REKKEFØLGEN et krav, ikke en detalj. */
  log('13g: kanalen fantes FØR det første varselet ble planlagt',
    k1.logg.indexOf('createChannel:' + k1.chId) === 0 &&
    k1.logg.filter((x) => /^schedule:/.test(x)).length > 0 &&
    k1.logg.findIndex((x) => /^createChannel:/.test(x)) <
      k1.logg.findIndex((x) => /^schedule:/.test(x)), JSON.stringify(k1.logg));
  /* Prioriteten er MED, og den er for Android 7 (API 24–25): der finnes ikke
     kanaler, så det er notifikasjonens egen prioritet som avgjør heads-up.
     Feltet heter `foreground` etter iOS-betydningen; på Android gjør det kun
     `setPriority(PRIORITY_HIGH)`, som Android 8+ ser bort fra. Fullskjerm er
     det fortsatt ingenting som ber om. */
  log('13h: … varselet bærer høy prioritet for Android 7, og ingenting ber om fullskjerm',
    k1.lagt.length > 0 && k1.lagt.every((n) => n.forgrunn === true) &&
    k1.lagt.every((n) => n.fullScreen === undefined),
    JSON.stringify(k1.lagt.map((n) => n.forgrunn)));
  /* PREMISSET for migreringen: telefonen kan ikke svare på hvilken kanal en
     alarm står på. `getPending()` bærer ikke feltet — pluginen lagrer det appen
     sendte inn, og en gammel Huskis sendte ingen kanal i det hele tatt. */
  log('13i: `getPending()` bærer INGEN channelId — kanalen kan ikke leses av telefonen',
    k1.pendingFelter.length > 0 && k1.pendingFelter.every((f) => f.indexOf('channelId') === -1),
    JSON.stringify(k1.pendingFelter[0]));
  log('13j: enheten er merket med kanalen alarmene står på',
    k1.merke === k1.chId, String(k1.merke));

  /* ---------- 13k–13n) MIGRERING: en installasjon fra før kanalen ----------
     Riggen er telefonen slik en eldre Huskis etterlot den: de samme alarmene,
     armert på pluginens `default`-kanal, uten at Huskis-kanalen finnes og uten
     merket som sier hvor alarmene står.

     Først uten omstart, så migreringen kan måles ALENE: hva gjør Huskis med en
     telefon som har alarmer på feil kanal? */
  const rigg = (slettKanal) => pk.evaluate((slett) => {
    window.__kanal.alarmer.forEach((n) => { n.kanal = 'default'; });
    // Kanalen selv finnes bare i den riggen som også starter appen på nytt: en
    // gammel installasjon har den ikke, og økten som alt har opprettet den
    // husker det.
    if (slett) window.__kanal.kanaler.length = 0;
    window.__kanal.logg.length = 0;
    window.__kanal.schedule.length = 0;
    window.__kanal.cancel.length = 0;
    window.__kanal.lagre();
    localStorage.removeItem(window.__huskis.NATIVE_CH_KEY);
    return {
      alarmer: window.__kanal.alarmer.map((n) => n.id).sort(),
      tider: window.__kanal.alarmer.map((n) => n.at).sort(),
      kanaler: window.__kanal.alarmer.map((n) => n.kanal),
    };
  }, slettKanal);
  const førMig = await rigg(false);
  log('13k: riggen er en telefon med alarmer på den GAMLE kanalen',
    førMig.alarmer.length > 0 && førMig.kanaler.every((k) => k === 'default'),
    JSON.stringify({ alarmer: førMig.alarmer.length, kanaler: førMig.kanaler }));

  await pk.evaluate(() => window.__huskis.syncNotifChannel());
  await pk.waitForTimeout(400);
  const mig1 = await pk.evaluate(() => ({
    chId: window.__huskis.NATIVE_CH_ID,
    logg: window.__kanal.logg.slice(),
    alarmer: window.__kanal.alarmer.map((n) => ({ id: n.id, at: n.at, kanal: n.kanal })),
    lagt: window.__kanal.schedule.flat().map((n) => ({ id: n.id, kanal: n.channelId })),
    avlyst: window.__kanal.cancel.flat().map((n) => n.id),
    kanaler: window.__kanal.kanaler,
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
  }));
  log('13l: en uendret plan er IKKE «ingenting å gjøre» når kanalen er en annen',
    mig1.lagt.length === førMig.alarmer.length && mig1.lagt.every((n) => n.kanal === mig1.chId),
    JSON.stringify({ lagt: mig1.lagt.length, av: førMig.alarmer.length }));
  /* Alarmen settes PÅ NYTT, den avlyses ikke først: pluginen erstatter den
     gamle alarmen på den samme id-en selv, og et «avlys, så planlegg» ville
     mistet alarmen om appen døde imellom. */
  log('13m: … alarmene flyttes ved å planlegges på nytt, og det er HELE operasjonen',
    mig1.avlyst.length === 0 && mig1.logg.length === 1 &&
    /^schedule:/.test(mig1.logg[0] || ''), JSON.stringify(mig1.logg));
  log('13n: … og telefonen står igjen med NØYAKTIG de samme alarmene, på den nye kanalen',
    JSON.stringify(mig1.alarmer.map((n) => n.id).sort()) === JSON.stringify(førMig.alarmer) &&
    JSON.stringify(mig1.alarmer.map((n) => n.at).sort()) === JSON.stringify(førMig.tider) &&
    mig1.alarmer.every((n) => n.kanal === mig1.chId) &&
    mig1.kanaler.length === 1 && mig1.kanaler[0].importance === 4 &&
    mig1.merke === mig1.chId,
    JSON.stringify({ før: førMig.alarmer.length, etter: mig1.alarmer.length,
      merke: mig1.merke }));

  /* ---------- 13o–13p) … og den samme migreringen over en APPOPPGRADERING ----
     Det er slik den faktisk kommer: en ny versjon starter for første gang, med
     telefonens alarmer allerede liggende fra den forrige. */
  const førOmstart = await rigg(true);
  await pk.goto(KURL);                       // appoppgradering: appen starter på nytt
  await pk.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.state.universes.length > 0 && !!H.notifPrefs;
  }, null, { timeout: 15000, polling: 200 });
  await pk.waitForFunction((n) => window.__kanal.alarmer.length === n &&
    window.__kanal.alarmer.every((a) => a.kanal !== 'default'),
    førOmstart.alarmer.length, { timeout: 15000, polling: 200 }).catch(() => {});
  await pk.waitForTimeout(500);

  const mig = await pk.evaluate(() => ({
    chId: window.__huskis.NATIVE_CH_ID,
    kanaler: window.__kanal.kanaler,
    logg: window.__kanal.logg.slice(),
    alarmer: window.__kanal.alarmer.map((n) => ({ id: n.id, at: n.at, kanal: n.kanal })),
    pending: window.__kanal.pending.map((n) => n.id).sort(),
    lagt: window.__kanal.schedule.flat().map((n) => ({ id: n.id, kanal: n.channelId })),
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).map((r) => window.__huskis.nativeNotifId(
        window.__huskis.nativeNotifSig(r))).sort(),
  }));
  log('13o: en oppgradert installasjon får alarmene over på den nye kanalen ved oppstart',
    mig.alarmer.length > 0 && mig.alarmer.every((n) => n.kanal === mig.chId) &&
    mig.lagt.length > 0 && mig.lagt.every((n) => n.kanal === mig.chId) &&
    mig.merke === mig.chId, JSON.stringify(mig.alarmer.map((n) => n.kanal)));
  // … og kanalen ble laget FØR den første alarmen — også her, der den ikke
  // fantes fra før.
  log('13o2: … og kanalen ble opprettet før migreringen planla noe',
    mig.logg.indexOf('createChannel:' + mig.chId) !== -1 &&
    mig.logg.findIndex((x) => /^createChannel:/.test(x)) <
      mig.logg.findIndex((x) => /^schedule:/.test(x)), JSON.stringify(mig.logg));
  log('13p: … de SAMME alarmene, uten dubletter og uten en mistet framtid',
    JSON.stringify(mig.alarmer.map((n) => n.id).sort()) === JSON.stringify(førOmstart.alarmer) &&
    JSON.stringify(mig.alarmer.map((n) => n.at).sort()) === JSON.stringify(førOmstart.tider) &&
    JSON.stringify(mig.pending) === JSON.stringify(mig.plan) &&
    mig.alarmer.length === mig.plan.length && mig.kanaler.length === 1,
    JSON.stringify({ før: førOmstart.alarmer.length, etter: mig.alarmer.length,
      plan: mig.plan.length }));

  /* ---------- 13q–13r) GJENTATT SYNK OG OMSTART ER IDEMPOTENT ---------- */
  await pk.evaluate(() => {
    window.__kanal.schedule.length = 0;
    window.__kanal.cancel.length = 0;
    window.__kanal.logg.length = 0;
  });
  for (let i = 0; i < 3; i++) await cycle(pk);
  await pk.evaluate(() => window.__huskis.syncNotifChannel());
  await pk.waitForTimeout(400);
  const idem1 = await pk.evaluate(() => ({
    lagt: window.__kanal.schedule.flat().length,
    avlyst: window.__kanal.cancel.flat().length,
    kanaler: window.__kanal.kanaler.length,
    alarmer: window.__kanal.alarmer.map((n) => n.id).sort(),
  }));
  log('13q: gjentatt synk etter migreringen rører ingenting — den kjøres ÉN gang',
    idem1.lagt === 0 && idem1.avlyst === 0 && idem1.kanaler === 1 &&
    JSON.stringify(idem1.alarmer) === JSON.stringify(mig.alarmer.map((n) => n.id).sort()),
    JSON.stringify(idem1));

  await pk.goto(KURL);                       // og en omstart til, nå uten noe å migrere
  await pk.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.state.universes.length > 0 && !!H.notifPrefs;
  }, null, { timeout: 15000, polling: 200 });
  for (let i = 0; i < 2; i++) await cycle(pk);
  await pk.waitForTimeout(600);
  const idem2 = await pk.evaluate(() => ({
    alarmer: window.__kanal.alarmer.map((n) => ({ id: n.id, at: n.at, kanal: n.kanal })),
    kanaler: window.__kanal.kanaler.length,
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
  }));
  log('13r: … og en ny omstart etterlater de samme alarmene på den samme kanalen',
    idem2.kanaler === 1 && idem2.merke === mig.chId &&
    JSON.stringify(idem2.alarmer.map((n) => n.id).sort()) ===
      JSON.stringify(mig.alarmer.map((n) => n.id).sort()) &&
    JSON.stringify(idem2.alarmer.map((n) => n.at).sort()) ===
      JSON.stringify(mig.alarmer.map((n) => n.at).sort()) &&
    idem2.alarmer.every((n) => n.kanal === mig.chId), JSON.stringify(idem2));

  /* ---------- 13s–13t) EN KANAL SOM IKKE BLE OPPRETTET STOPPER RUNDEN ----
     Et varsel planlagt mot en kanal som ikke finnes, vises aldri på Android
     8+. En feilet kanal må derfor ikke bli en stille suksess: da ville
     telefonen fått stumme alarmer, og både merket og signaturen sagt «ferdig».
     Runden skal feile, signaturen stå — og neste runde gjøre hele jobben. */
  const førFeil = await rigg(true);
  await pk.evaluate(() => { window.__kanal.kanalFeil = true; window.__kanal.lagre(); });
  /* Appen startes på nytt, som etter en oppgradering: en økt som alt HAR
     opprettet kanalen spør ikke om den igjen, og da ville feilen aldri blitt
     prøvd. */
  await pk.goto(KURL);
  await pk.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.state.universes.length > 0 && !!H.notifPrefs;
  }, null, { timeout: 15000, polling: 200 });
  await pk.waitForTimeout(1200);
  const feilet = await pk.evaluate(() => ({
    lagt: window.__kanal.schedule.flat().length,
    kanaler: window.__kanal.kanaler.length,
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
    alarmer: window.__kanal.alarmer.map((n) => n.kanal),
  }));
  log('13s: en kanal som ikke lot seg opprette gir verken varsler eller et merke',
    feilet.lagt === 0 && feilet.kanaler === 0 && feilet.merke === null &&
    !feilet.alarmer.some((k) => k === k1.chId), JSON.stringify(feilet));

  await pk.evaluate(() => { window.__kanal.kanalFeil = null; window.__kanal.lagre(); });
  await pk.evaluate(() => window.__huskis.syncNotifChannel());
  await pk.waitForTimeout(600);
  const berget = await pk.evaluate(() => ({
    chId: window.__huskis.NATIVE_CH_ID,
    kanaler: window.__kanal.kanaler.length,
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
    alarmer: window.__kanal.alarmer.map((n) => ({ id: n.id, kanal: n.kanal })),
  }));
  log('13t: … og neste runde gjør hele jobben, med det samme',
    berget.kanaler === 1 && berget.merke === berget.chId &&
    JSON.stringify(berget.alarmer.map((n) => n.id).sort()) === JSON.stringify(førFeil.alarmer) &&
    berget.alarmer.every((n) => n.kanal === berget.chId), JSON.stringify(berget));

  /* ---------- 13u) SPRÅKBYTTE NÅR DET IKKE FINNES NOEN ALARM ----------
     Navnet og beskrivelsen står i Androids systeminnstillinger, og er
     brukerrettet tekst som alt annet. En telefon uten en eneste framtidig
     terskel har ingenting å planlegge — og skal likevel få kanalnavnet på det
     nye språket. */
  await settTid(pk, id.LA, 'due', '');
  await pk.waitForTimeout(600);
  const tomPlan = await pk.evaluate(() => ({
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).length,
    navn: (window.__kanal.kanaler[0] || {}).name,
  }));
  await pk.evaluate(() => window.HUSKIS_I18N.setLang('en'));
  await pk.goto(KURL);                       // språkbyttet laster appen på nytt
  await pk.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.state.universes.length > 0 && !!H.notifPrefs;
  }, null, { timeout: 15000, polling: 200 });
  await pk.waitForFunction((gammelt) => window.__kanal.kanaler[0] &&
    window.__kanal.kanaler[0].name !== gammelt, tomPlan.navn,
    { timeout: 15000, polling: 200 }).catch(() => {});
  const språk = await pk.evaluate(() => ({
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).length,
    kanaler: window.__kanal.kanaler.length,
    kanal: window.__kanal.kanaler[0],
    ventet: { navn: window.HUSKIS_I18N.t('notif.android.channelName'),
      tekst: window.HUSKIS_I18N.t('notif.android.channelDesc') },
  }));
  log('13u: et språkbytte når navnet i systeminnstillingene — også uten en eneste alarm',
    tomPlan.plan === 0 && språk.plan === 0 && språk.kanaler === 1 &&
    språk.kanal.name === språk.ventet.navn && språk.kanal.name !== tomPlan.navn &&
    språk.kanal.description === språk.ventet.tekst,
    JSON.stringify({ før: tomPlan.navn, nå: språk.kanal.name }));
  /* … og resten av kanalen står som den ble laget: Android oppdaterer bare
     navn og beskrivelse, og det er nettopp derfor id-en er versjonert. */
  log('13v: … mens viktighet, låseskjerm og vibrasjon står urørt',
    språk.kanal.importance === 4 && språk.kanal.visibility === 1 &&
    språk.kanal.vibration === true, JSON.stringify(språk.kanal));

  await ctxK.close();

  /* ---------- 13w–13y) ET OS UTEN KANALER STOPPER INGENTING ----------
     Android under 8 (minSdk er 24) har ikke kanaler i det hele tatt, og
     pluginen svarer `unavailable`. Der er `channelId` et felt pluginen ser bort
     fra, mens den høye PRIORITETEN på varselet er det som gjelder — og
     varselet skal komme fram som før.

     EGEN KONTEKST, og det er ikke pynt: `ensureNativeChannel` memoiserer en
     kanal som er opprettet, så en økt som alt har lyktes spør ikke igjen. Kjørt
     der ville testen aldri nådd `UNAVAILABLE`-grenen, og vært grønn uansett hva
     den grenen gjorde. Her er appen fersk, og sjekken krever at
     `createChannel` faktisk BLE forsøkt. */
  const ctxG = await nyKontekst(browser);
  const pg = await ctxG.newPage();
  pg.on('pageerror', (e) => errs.push('gammeltOS: ' + e.message));
  await seed(pg, KURL, buildDB(due));
  await pg.evaluate(() => { window.__kanal.kanalFeil = 'UNAVAILABLE'; window.__kanal.lagre(); });
  await pg.evaluate(() => window.__huskis.setNotifChannel(true));
  await pg.waitForFunction(() => window.__kanal.alarmer.length > 0,
    null, { timeout: 10000, polling: 100 }).catch(() => {});
  await pg.waitForTimeout(400);
  const gammeltOS = await pg.evaluate(() => ({
    chId: window.__huskis.NATIVE_CH_ID,
    logg: window.__kanal.logg.slice(),
    kanaler: window.__kanal.kanaler.length,
    lagt: window.__kanal.schedule.flat().map((n) => ({ kanal: n.channelId, prio: n.foreground })),
    alarmer: window.__kanal.alarmer.length,
    plan: window.__huskis.planNotifications(window.__huskis.state, Date.now(),
      window.__huskis.notifPrefs).length,
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
  }));
  log('13w: kanalen BLE forsøkt opprettet, og OS-et svarte at den ikke finnes',
    gammeltOS.logg.indexOf('createChannel:' + gammeltOS.chId) !== -1 &&
    gammeltOS.logg.findIndex((x) => /^createChannel:/.test(x)) <
      gammeltOS.logg.findIndex((x) => /^schedule:/.test(x)) &&
    gammeltOS.kanaler === 0, JSON.stringify(gammeltOS.logg));
  log('13x: … og varslene legges likevel, med kanal og prioritet på seg',
    gammeltOS.plan > 0 && gammeltOS.lagt.length === gammeltOS.plan &&
    gammeltOS.alarmer === gammeltOS.plan && gammeltOS.merke === gammeltOS.chId &&
    gammeltOS.lagt.every((n) => n.kanal === gammeltOS.chId && n.prio === true),
    JSON.stringify({ plan: gammeltOS.plan, lagt: gammeltOS.lagt.length,
      merke: gammeltOS.merke }));
  /* Svaret kan ikke endre seg mens appen kjører, så det huskes: neste runde
     skal ikke koste en tur over broen for å få det samme svaret igjen. */
  await pg.evaluate(() => {
    window.__kanal.logg.length = 0;
    window.__kanal.schedule.length = 0;
    localStorage.removeItem(window.__huskis.NATIVE_CH_KEY);   // tvinger en full runde
  });
  await pg.evaluate(() => window.__huskis.syncNotifChannel());
  await pg.waitForTimeout(400);
  const igjen = await pg.evaluate(() => ({
    logg: window.__kanal.logg.slice(),
    alarmer: window.__kanal.alarmer.length,
    merke: localStorage.getItem(window.__huskis.NATIVE_CH_KEY),
  }));
  log('13y: … og «finnes ikke» spørres ikke om på nytt i den samme økten',
    igjen.logg.every((x) => !/^createChannel:/.test(x)) &&
    igjen.alarmer === gammeltOS.plan && igjen.merke === gammeltOS.chId,
    JSON.stringify(igjen));

  await ctxG.close();

  /* ---------- 13z1–13z3) INGEN NY TILLATELSE HAR SNEKET SEG INN ----------
     Heads-up er en kanal med høy viktighet — og på Android 7, som ikke har
     kanaler, varselets egen prioritet. INGENTING mer. De mekanismene
     som eier skjermen — fullskjerm-varsler, «slå på skjermen», presise alarmer
     — hører til alarmklokker og innkommende anrop, koster hver sin gjennomgang
     i Google Play, og skal ikke inn bakveien med denne endringen. */
  const manifest = fs.readFileSync(
    path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  log('13z1: Huskis ber ikke om USE_FULL_SCREEN_INTENT eller TURN_SCREEN_ON',
    !/USE_FULL_SCREEN_INTENT/.test(manifest) && !/TURN_SCREEN_ON/.test(manifest) &&
    !/WAKE_LOCK/.test(manifest));
  log('13z2: SCHEDULE_EXACT_ALARM er fortsatt trukket tilbake, og varslene er upresise',
    /SCHEDULE_EXACT_ALARM"\s*\n?\s*tools:node="remove"/.test(manifest) &&
    /isExactNotification:\s*false/.test(appSrc));
  log('13z3: koden setter ingen fullScreenIntent og tar ingen wake lock',
    !/fullScreenIntent\s*:/.test(appSrc) && !/wakeLock|WakeLock|requestWakeLock/.test(appSrc));

  /* ================= Nettleser: uten avsendernøkkel ================= */
  const ctxU = await nyKontekst(browser);
  const pu = await ctxU.newPage();
  pu.on('pageerror', (e) => errs.push('utenNøkkel: ' + e.message));
  await seed(pu, BASE + '/?mock=1&ch=web&nokkel=0', buildDB(due));
  log('4a: uten avsendernøkkel finnes web push-kanalen ikke',
    (await pu.evaluate(() => window.__huskis.notifChannel())) === null);
  const utenNøkkelPanel = await pu.evaluate(async () => {
    window.__huskis.openNotifModal();
    document.getElementById('notif-settings-btn').click();
    await window.__huskis.refreshNotifChannelState();
    await new Promise((r) => setTimeout(r, 150));
    return {
      bryter: !!document.getElementById('notif-channel-toggle'),
      note: document.getElementById('notif-channel-note').textContent,
    };
  });
  log('4b: panelet sier fra i stedet for å vise en bryter som ikke kan virke',
    utenNøkkelPanel.bryter === false &&
    /kan ikke vise varsler utenfor Huskis/.test(utenNøkkelPanel.note), JSON.stringify(utenNøkkelPanel));
  await ctxU.close();

  /* ================= Nettleser: web push ================= */
  const ctxW = await nyKontekst(browser);
  const pw = await ctxW.newPage();
  pw.on('pageerror', (e) => errs.push('web: ' + e.message));
  const WURL = BASE + '/?mock=1&ch=web';
  await seed(pw, WURL, buildDB(due));

  log('4c: kanalen er nettleserens når det ikke finnes en native runtime',
    (await pw.evaluate(() => window.__huskis.notifChannel().id)) === 'web');
  log('4d: ingen tillatelse er spurt om av seg selv, og ingen service worker er registrert',
    (await pw.evaluate(() => window.__kanal.spurt)) === 0 &&
    (await pw.evaluate(() => window.__kanal.registrerte)) === undefined);

  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.HK_MOCK._loadDB().push_subscriptions.length > 0,
    null, { timeout: 8000, polling: 100 });
  const w1 = await db(pw);
  log('4e: bryteren spør om tillatelse og registrerer service workeren',
    (await pw.evaluate(() => window.__kanal.spurt)) === 1 &&
    (await pw.evaluate(() => window.__kanal.registrerte)) === 'sw.js');
  log('4f: påmeldingen lover et SYNLIG varsel og bruker avsendernøkkelen',
    await pw.evaluate(() => window.__kanal.subscribe.userVisibleOnly === true &&
      window.__kanal.subscribe.nøkkelLengde === 65));
  const sub = w1.push_subscriptions[0];
  log('4g: abonnementet ligger på brukeren, med endepunkt og nøkler',
    sub.user_id === uid && /^https:\/\/push\.test\//.test(sub.endpoint) && !!sub.p256dh && !!sub.auth,
    JSON.stringify({ endpoint: sub.endpoint, tz: sub.tz }));
  log('4h: … og bærer de fire typetekstene på brukerens språk (service workeren har ingen ordbok)',
    sub.labels.dueOver === 'Frist utløpt' && sub.labels.startSoon === 'Begynner om mindre enn en uke',
    JSON.stringify(sub.labels));
  log('4i: utboksen fikk en levering per planlagt varsel',
    w1.push_deliveries.length === w1.notifications.filter((n) => n.at > Date.now()).length,
    w1.push_deliveries.length + ' leveringer');

  // Fornyelse: en ny runde skal ikke lage et abonnement til.
  await cycle(pw);
  log('4j: en ny synk-runde fornyer abonnementet i stedet for å lage et nytt',
    (await db(pw)).push_subscriptions.length === 1);

  // Av igjen.
  await pw.evaluate(() => window.__huskis.setNotifChannel(false));
  await pw.waitForFunction(() => window.HK_MOCK._loadDB().push_subscriptions.length === 0,
    null, { timeout: 8000, polling: 100 });
  const w2 = await db(pw);
  log('4k: å slå av fjerner abonnementet fra serveren og avregistrerer service workeren',
    w2.push_subscriptions.length === 0 && (await pw.evaluate(() => window.__kanal.avregistrert)) === true);
  log('4l: … og leveringene som lå og ventet forsvinner med det',
    w2.push_deliveries.length === 0, w2.push_deliveries.length);
  log('4m: historikken og planen er urørt — kanalen er en LEVERING, ikke modellen',
    w2.notifications.length === w1.notifications.length,
    w2.notifications.length + ' av ' + w1.notifications.length);

  /* ---------- 4n) Å slå av OFFLINE rigger likevel ned lokalt ----------
     Det er avmeldingen i nettleseren som faktisk stopper et varsel. Svarer
     serveren feil — en utlogging uten nett er nettopp det tilfellet — skal den
     lokale nedriggingen skje likevel; ellers ville en utlogget nettleser
     fortsatt vist varsler med objektnavn. */
  await pw.evaluate(() => { window.__kanal.avregistrert = false; });
  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.HK_MOCK._loadDB().push_subscriptions.length > 0,
    null, { timeout: 8000, polling: 100 });
  await pw.evaluate(() => { window.__kanal.rpcFeil = 'push_unsubscribe'; });
  // `setNotifChannel` returnerer et promise, og evaluate venter på det — så
  // avslåingen er FERDIG når linjen under er det, uansett hvordan den gikk.
  await pw.evaluate(() => window.__huskis.setNotifChannel(false));
  const offline = await pw.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      avregistrert: window.__kanal.avregistrert,
      abo: reg ? await reg.pushManager.getSubscription() : null,
      serverrad: window.HK_MOCK._loadDB().push_subscriptions.length,
      kanal: window.__huskis.notifChState,
      vil: window.__huskis.notifChannelWanted(),
    };
  });
  log('4n: en avslåing der serveren svarer feil melder likevel av lokalt',
    offline.abo === null && offline.avregistrert === true, JSON.stringify(offline));
  log('4o: … kanalen er av her, for uten service worker finnes det ingen som kan vise et varsel',
    offline.kanal === 'off' && offline.vil === false, JSON.stringify(offline));
  log('4p: … og at serverraden ble stående er nettopp det som gjorde sjekken ekte',
    offline.serverrad === 1, offline.serverrad);
  // Ryddet: i drift gjør første sending det (410 → raden slås av).
  await pw.evaluate(() => {
    window.__kanal.rpcFeil = null;
    const d = window.HK_MOCK._loadDB();
    d.push_subscriptions = [];
    d.push_deliveries = [];
    window.HK_MOCK._saveDB(d);
  });

  /* ---------- 4q–4s) Hva et abonnement FÅR være ----------
     Reglene håndheves på serveren (`supabase/tests/test-push.sql` er fasiten),
     men nettlesertestene kjører mot mock-backenden — og en mock som ikke
     speiler regelen ville stille latt en test bevise noe databasen forbyr.
     Her prøves speilingen direkte: et endepunkt som ikke er en pushtjeneste,
     en nøkkel av feil form, og taket på antall enheter. */
  const grenser = await pw.evaluate(async () => {
    const c = window.HK_MOCK.createClient();
    const k = 'BP' + 'k'.repeat(85), a = 's'.repeat(22);
    const prøv = async (ep, p256, auth) => {
      const { error } = await c.rpc('push_subscribe',
        { p_endpoint: ep, p_p256dh: p256 == null ? k : p256, p_auth: auth == null ? a : auth });
      return !!error;
    };
    const ut = {
      ip: await prøv('https://10.0.0.5/x'),
      local: await prøv('https://localhost:8000/x'),
      utenHttps: await prøv('http://push.test/x'),
      kortNøkkel: await prøv('https://push.test/k1', 'kort'),
      raddenNøkkel: await prøv('https://push.test/k2', 'a'.repeat(86) + '!'),
      gyldig: !(await prøv('https://push.test/ok')),
    };
    // Taket: langt flere enn en bruker har nettlesere.
    for (let i = 0; i < 30; i++) {
      await c.rpc('push_subscribe', { p_endpoint: 'https://push.test/tak-' + i,
        p_p256dh: k, p_auth: a });
    }
    const db = window.HK_MOCK._loadDB();
    ut.antall = db.push_subscriptions.length;
    ut.sisteStårIgjen = db.push_subscriptions.some((x) => x.endpoint === 'https://push.test/tak-29');
    ut.foreldreløseLeveringer = db.push_deliveries.filter((d) =>
      !db.push_subscriptions.some((x) => x.id === d.subscription_id)).length;
    return ut;
  });
  log('4q: mocken avviser et endepunkt som ikke er en pushtjeneste',
    grenser.ip && grenser.local && grenser.utenHttps && grenser.gyldig,
    JSON.stringify(grenser));
  log('4r: … og en nøkkel som ikke har RFC 8291-formen',
    grenser.kortNøkkel && grenser.raddenNøkkel);
  log('4s: … og taket på antall enheter per bruker holder, med den siste i behold',
    grenser.antall === 20 && grenser.sisteStårIgjen &&
    grenser.foreldreløseLeveringer === 0, JSON.stringify(
      { antall: grenser.antall, siste: grenser.sisteStårIgjen }));
  await pw.evaluate(() => {
    const d = window.HK_MOCK._loadDB();
    d.push_subscriptions = [];
    d.push_deliveries = [];
    window.HK_MOCK._saveDB(d);
  });

  /* ---------- 5) Blokkert tillatelse ---------- */
  await pw.evaluate(() => { window.__kanal.svar = 'denied'; });
  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.__huskis.notifChState === 'denied',
    null, { timeout: 8000, polling: 100 });
  const blokkert = await pw.evaluate(async () => {
    const spurtFør = window.__kanal.spurt;
    window.__huskis.openNotifModal();
    document.getElementById('notif-settings-btn').click();
    await window.__huskis.refreshNotifChannelState();
    await new Promise((r) => setTimeout(r, 150));
    const t = document.getElementById('notif-channel-toggle');
    t.click();                                   // et nytt trykk skal ikke mase
    await new Promise((r) => setTimeout(r, 200));
    return { deaktivert: t.disabled, note: document.getElementById('notif-channel-note').textContent,
      nyeSpørsmål: window.__kanal.spurt - spurtFør, abo: window.HK_MOCK._loadDB().push_subscriptions.length };
  });
  log('5a: en avvist tillatelse gir ikke et abonnement', blokkert.abo === 0);
  log('5b: bryteren er deaktivert og teksten peker på enhetens innstillinger',
    blokkert.deaktivert === true && /[Bb]lokkert/.test(blokkert.note), JSON.stringify(blokkert.note));
  log('5c: … og et nytt trykk maser ikke med en ny systemdialog',
    blokkert.nyeSpørsmål === 0, blokkert.nyeSpørsmål);

  /* ---------- 6) Panelet ---------- */
  await pw.evaluate(() => { window.__kanal.svar = 'granted'; window.__kanal.perm = 'prompt'; });
  const panel = await pw.evaluate(async () => {
    await window.__huskis.refreshNotifChannelState();
    await new Promise((r) => setTimeout(r, 150));
    const rader = [...document.querySelectorAll('#notif-body .menu-setting')];
    return {
      antall: rader.length,
      siste: rader[rader.length - 1].querySelector('.menu-setting-label span:last-child').textContent,
      note: document.getElementById('notif-channel-note').textContent,
      typer: rader.slice(0, 4).map((r) => r.querySelector('.toggle-switch').getAttribute('aria-checked')),
      beskriver: document.getElementById('notif-channel-toggle').getAttribute('aria-describedby'),
    };
  });
  log('6a: kanalen er en femte rad under de fire typene',
    panel.antall === 5 && panel.siste === 'Varsler på denne enheten', JSON.stringify(panel.siste));
  log('6b: teksten under bryteren forklarer tillatelsen FØR den spørres om',
    /Enheten spør om tillatelse når du slår det på/.test(panel.note), JSON.stringify(panel.note));
  log('6c: … og er knyttet til bryteren for skjermlesere',
    panel.beskriver === 'notif-channel-note');
  log('6d: de fire typebryterne er urørt av kanalen',
    panel.typer.every((v) => v === 'true'), JSON.stringify(panel.typer));

  await pw.evaluate(() => window.__huskis.setNotifChannel(true));
  await pw.waitForFunction(() => window.__huskis.notifChState === 'on', null, { timeout: 8000, polling: 100 });
  const påTekst = await pw.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 200));
    return document.getElementById('notif-channel-note').textContent;
  });
  log('6e: er kanalen på, sier teksten hva den faktisk gjør',
    /når Huskis er lukket/.test(påTekst), JSON.stringify(påTekst));
  await pw.evaluate(() => window.__huskis.closeNotifModal());

  await swSjekker();

  /* ---------- 8) `?notif=` i adressen ---------- */
  await pw.goto(WURL + '&notif=' + encodeURIComponent('card:' + id.LA));
  await pw.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await pw.waitForTimeout(600);
  const rute = await pw.evaluate((lid) => ({
    adresse: location.search,
    fant: !!document.querySelector('[data-id="' + lid + '"]'),
  }), id.LA);
  log('8a: pekeren i adressen navigerer til objektet', rute.fant, JSON.stringify(rute));
  log('8b: … og fjernes fra adressen, så en reload ikke navigerer igjen',
    rute.adresse.indexOf('notif=') === -1, rute.adresse);

  /* 9 for web push: `sw.js` gir den åpne fanen pekeren OG nøkkelen som en
     melding — nøyaktig den meldingen leveres her. */
  await ingenRedundantToast(pw, '9w', id.IA, (peker) => pw.evaluate((x) => {
    window.__kanal.swMelding({ data: Object.assign({ type: 'huskis-notif-open' }, x) });
  }, peker));

  /* ---------- 10) VARSELIKONENE ----------
     Et varsel har TO ikoner, og de er ikke det samme bildet:

       `icon`  — det store, fargelagte merket. Android (og Samsungs One UI
                 særlig) maskerer det til en SIRKEL, så merket må ligge
                 innenfor den innskrevne sirkelen. Ellers klippes hjørnene av
                 kortene bort.
       `badge` — det lille i statuslinjen, og der er bildet en ALFAMASKE:
                 Android kaster fargene og tegner formen i sin egen. Den
                 fargelagte logoen ble derfor en hvit klump — alt som ikke var
                 gjennomsiktig ble hvitt, og de mørke konturene som BÆRER
                 motivet forsvant.

     Begge er rasterisert fra `favicon.svg` av `tests/lag-varselikoner.js`, og
     den samme masken er `ic_stat_huskis` på Android. Det er de to tingene som
     prøves her: at bildene faktisk ER det de skal være, og at de to
     plattformene tegner det SAMME motivet. */
  const ikoner = require('./lag-varselikoner.js');
  const swKilde = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const stier = {
    icon: (swKilde.match(/var IKON = '([^']+)'/) || [])[1],
    badge: (swKilde.match(/var BADGE = '([^']+)'/) || [])[1],
  };
  log('10a: service workeren peker på to ULIKE filer for `icon` og `badge`',
    !!stier.icon && !!stier.badge && stier.icon !== stier.badge &&
    fs.existsSync(path.join(__dirname, '..', stier.icon)) &&
    fs.existsSync(path.join(__dirname, '..', stier.badge)) &&
    /icon: IKON/.test(swKilde) && /badge: BADGE/.test(swKilde),
    JSON.stringify(stier));
  /* Fasiten på hva merket ER: fyllfargene i favicon.svg. Byttes PNG-en ut med
     en annen logo — den gamle e-postlogoen med flate bak, for eksempel — vil
     de ikke lenger finnes i bildet. */
  const faviconKilde = fs.readFileSync(path.join(__dirname, '..', 'favicon.svg'), 'utf8');
  const merkefarger = [...new Set((faviconKilde.match(/fill="#[0-9a-f]{6}"/g) || [])
    .map((f) => f.slice(6, -1)))];
  /* Leser bildet piksel for piksel: målene, hvor mye som er gjennomsiktig,
     hvor langt inn fra kanten den ytterste ugjennomsiktige pikselen ligger
     (padding), hvor mange piksler som har hver av merkefargene, og om noe i
     det hele tatt er farget (en maske skal være hvit). */
  const les = (sti) => pw.evaluate(async ({ sti, farger }) => {
    const im = await new Promise((ok, nei) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = () => nei(new Error('lastet ikke'));
      i.src = sti;
    });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const px = (x, y) => [...d.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4)];
    let gjennomsiktige = 0, kulørt = 0, blekk = 0;
    let minX = c.width, maxX = -1, minY = c.height, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] === 0) { gjennomsiktige++; continue; }
        if (d[i + 3] > 128) {
          blekk++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          // Kulørt = ikke gråtone. En alfamaske skal bare ha hvitt.
          if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 12) kulørt++;
        }
      }
    }
    const treff = farger.map((f) => {
      const r = parseInt(f.slice(1, 3), 16), g = parseInt(f.slice(3, 5), 16),
        b = parseInt(f.slice(5, 7), 16);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 255 && Math.abs(d[i] - r) < 8 && Math.abs(d[i + 1] - g) < 8
          && Math.abs(d[i + 2] - b) < 8) n++;
      }
      return { farge: f, piksler: n };
    });
    return { w: c.width, h: c.height, andel: gjennomsiktige / (c.width * c.height),
      hjørner: [px(0, 0), px(c.width - 1, 0), px(0, c.height - 1), px(c.width - 1, c.height - 1)],
      boks: { minX, maxX, minY, maxY }, kulørt, blekk, treff };
  }, { sti, farger: merkefarger });

  const ikon = await les(stier.icon);
  log('10b: `icon` er 192×192 — størrelsen Notification API-et vil ha',
    ikon.w === 192 && ikon.h === 192, ikon.w + '×' + ikon.h);
  log('10c: bakgrunnen er gjennomsiktig, ikke en flate bak merket',
    ikon.hjørner.every((p) => p[3] === 0) && ikon.andel > 0.2,
    JSON.stringify({ hjørner: ikon.hjørner.map((p) => p[3]),
      andel: Math.round(ikon.andel * 100) + '%' }));
  log('10d: … og det ER dagens logo: fyllfargene fra favicon.svg finnes i bildet',
    merkefarger.length >= 3 && ikon.treff.every((t) => t.piksler > 200),
    JSON.stringify(ikon.treff));
  /* Merket må ligge innenfor den INNSKREVNE SIRKELEN, ikke bare innenfor
     kvadratet: One UI maskerer det store varselikonet rundt. Halve diagonalen
     av merkets egen boks må derfor være kortere enn radien. Uten denne vakten
     kan noen legge inn en logo som fyller flaten, og hjørnene av kortene blir
     klippet vekk uten at en eneste test sier fra. */
  const radius = ikon.w / 2;
  const halvDiagonal = Math.hypot(
    Math.max(radius - ikon.boks.minX, ikon.boks.maxX + 1 - radius),
    Math.max(radius - ikon.boks.minY, ikon.boks.maxY + 1 - radius));
  log('10e: hele merket ligger innenfor den innskrevne sirkelen (One UI maskerer rundt)',
    halvDiagonal < radius,
    'halv diagonal ' + Math.round(halvDiagonal) + ' px < radius ' + radius + ' px');

  const badge = await les(stier.badge);
  log('10f: `badge` er en egen fil i 96×96 — ikke den samme PNG-en som `icon`',
    badge.w === 96 && badge.h === 96, badge.w + '×' + badge.h);
  log('10g: … og den er MONOKROM: Android bruker den som alfamaske',
    badge.kulørt === 0 && badge.blekk > 0 && badge.hjørner.every((p) => p[3] === 0),
    JSON.stringify({ kulørt: badge.kulørt, blekk: badge.blekk }));
  /* En maske av fylte flater blir en klump. Andelen blekk sier at motivet er
     konturer og punkter, ikke tre solide firkanter: merket spenner over
     ~60 % av flaten, og fylt ville det gitt langt over 30 % dekning. */
  log('10h: … og den er tegnet som konturer, ikke som fylte flater',
    badge.blekk / (badge.w * badge.h) > 0.02 && badge.blekk / (badge.w * badge.h) < 0.30,
    Math.round(1000 * badge.blekk / (badge.w * badge.h)) / 10 + '% dekning');

  /* Androids statuslinje-ikon er den SAMME masken, som vector drawable.
     Banene kommer fra ett sted (`tests/lag-varselikoner.js`), og her prøves at
     drawable-en faktisk bærer dem — tre kort OG tre punkter OG tre linjer. Den
     forrige utgaven hadde bare kortkonturene, og ble tre sammenfiltrede
     firkanter på skjerm. */
  const statXml = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src',
    'main', 'res', 'drawable', 'ic_stat_huskis.xml'), 'utf8');
  const baner = ikoner.badgeBaner();
  const alle = baner.kort.concat(baner.prikker, baner.linjer);
  log('10i: Androids `ic_stat_huskis` er nøyaktig den samme masken som badgen',
    alle.every((d) => statXml.indexOf('android:pathData="' + d + '"') !== -1),
    alle.filter((d) => statXml.indexOf('android:pathData="' + d + '"') === -1).join(' | ') ||
      alle.length + ' baner');
  log('10j: … altså det fremste kortet MED tre punkter og linjer, og to kort bak',
    baner.kort.length === 3 && baner.prikker.length === 3 && baner.linjer.length === 3 &&
    (statXml.match(/android:pathData/g) || []).length === 9,
    (statXml.match(/android:pathData/g) || []).length + ' baner i drawable-en');
  log('10k: … og ingen fylte kortflater — Android tegner en maske, ikke en logo',
    !/android:fillColor="#FFFFFF"[\s\S]{0,80}?A3,3/.test(statXml) &&
    baner.kort.every((d) => statXml.indexOf('android:pathData="' + d + '"\n' +
      '        android:strokeColor=') !== -1));
  const capCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'capacitor.config.json'), 'utf8'));
  log('10l: capacitor.config.json peker fortsatt på den — ellers blir det Androids eget ikon',
    capCfg.plugins.LocalNotifications.smallIcon === 'ic_stat_huskis',
    capCfg.plugins.LocalNotifications.smallIcon);
  /* Det STORE ikonet i et native varsel. Pluginen dekoder det med
     `BitmapFactory.decodeResource`, som ikke kan lese en vector drawable —
     derfor en PNG, og `nodpi` fordi den skal brukes som den er. */
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const stort = (appJs.match(/largeIcon: '([^']+)'/) || [])[1];
  log('10m: det native varselet har også merket i farge som stort ikon',
    !!stort && fs.existsSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main',
      'res', 'drawable-nodpi', stort + '.png')), stort || 'mangler');

  await ctxW.close();
  log('ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

run().then(() => {
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
