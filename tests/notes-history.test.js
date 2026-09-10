/*
  Nettlesertest for NOTATHISTORIKKEN — «hva sto det før?» og veien tilbake
  (docs/notater-plan.md → «Historikk»), mot mock-backend (?mock=1).

  Historikken er svaret på det ene samskrivingen gjorde umulig: angre er
  CRDT-ens egen og tar bare MINE endringer, og samskrivingsloggen klappes
  sammen når den blir lang. Uten historikken finnes det ikke noe sted å hente
  fra når en medforfatter sletter et avsnitt.

  Dekker:
    1. Et bilde tas når editoren ÅPNES — tilstanden før man rekker å endre noe
    2. … og når den lukkes, med det man faktisk forlot
    3. Åpne og lukke uten en eneste endring legger ikke igjen en ny rad
       (fingeravtrykket på serveren)
    4. Modalen lister bildene nyeste først, med utdrag, tegntall og «Nå»
    5. En rad åpnes som et trekkspill, og dokumentet rendres NODE FOR NODE
   5b. … med 44 px berøringsflate og fokus som overlever at listen males om
    6. Gjenoppretting går gjennom CRDT-en: loggen vokser, projeksjonen følger
       etter, og arket viser det gamle igjen
    7. … og den kan angres fra toasten
    8. Gjenoppretting midt i samskriving: den andres samtidige endring
       overlever, og hen ser resultatet uten reload
    9. En REN LESER kan bla i historikken, men får verken «Gjenopprett»,
       «Behold denne» eller «Lagre versjon nå» — og serveren sier nei uansett
   10. Tilbakekalt tilgang lukker historikken
   11. Uten nett: modalen sier hvor historikken bor, og det skrives ingen rader
   12. «Lagre versjon nå» merker et bilde, og merket vises i lista
   13. REGRESJON (frøet): en enhet som åpner et allerede samskrevet notat for
       FØRSTE gang skal ikke doble teksten. Frøet er en foreløpig antagelse til
       serveren har sagt om loggen er tom.
   14. REGRESJON (frøet, andre vei): et NYTT notat virker fullt ut lokalt FØR
       serveren har svart — raden ligger i synk-køen, så første henting sier
       «finnes ikke», og det er publiseringen som venter, ikke skrivingen
   15. REGRESJON (frøet, den farlige varianten): er projeksjonen ELDRE enn
       loggen, og brukeren rekker å skrive før første henting svarer, skal den
       andres avsnitt aldri leses som en sletting. Serverens dokument vinner,
       og utkastet legges i historikken
  15e. … og det skjer ikke på håp: FEILER den første lagringen, ligger utkastet
       i en holdbar kø på enheten og kommer inn ved neste runde
   16. Køen kaster ALDRI en ubekreftet kopi: 25 utkast med vedvarende
       lagringsfeil blir alle stående, i minnet og i enhetens lagring
   17. Et forsøk på nytt er EKSAKT idempotent: serveren committer, svaret blir
       borte, en annen historikkrad kommer imellom — og utkastet finnes
       fortsatt bare én gang
   18. REGRESJON (datatap): nekter BÅDE enhetens lagring og serveren, finnes
       det ingen holdbar destinasjon — og da kastes ingenting. Økten blir
       stående foreløpig, teksten står i editoren, loggen får ingen nye rader,
       appen nekter å lukke notatet, og overgangen fullfører seg selv når
       lagringen er tilbake
   22. Er serverloggen tom, beholdes det foreløpige dokumentet — og da må
       åpningsbildet tas av grunnlaget frøet ble sådd fra, ikke av det
       brukeren rakk å skrive
   23. «Nå» for et lukket notat teller enhetens egne, usendte endringer
   24. … og tittelen ved åpning gjelder også når loggen HAR rader: dokumentet
       er serverens, tittelen er den fra åpningen

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notes-history.test.js
*/
const { chromium } = require('playwright');
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let pass = 0, fail = 0;
const check = (navn, ok, evidens) => {
  const e = evidens === undefined ? '' : '  [' + (typeof evidens === 'string' ? evidens : JSON.stringify(evidens)) + ']';
  if (ok) { pass++; console.log('PASS — ' + navn + e); }
  else { fail++; console.log('FAIL — ' + navn + e); }
};
const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
});

function buildDB() {
  const P = U(), N = U(), NR = U();
  const base = (x) => Object.assign({
    trashed: false, archived: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const mem = (user, on, role) => Object.assign({
    id: U(), user_id: user, universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: null,
    role, pos: 0, created_at: 1,
  }, on);
  const doc = (s) => ({ v: 1, blocks: [{ t: 'p', c: [{ s }] }] });
  return {
    ids: { P, N, NR },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: 'uA', email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: 'uB', email: 'b@x.no', display_name: 'Bo Medlem', user_metadata: {} },
        { id: 'uC', email: 'c@x.no', display_name: 'Cato Leser', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x', 'c@x.no': 'x' },
      universes: [], groups: [], cards: [], items: [], ideas: [],
      note_projects: [base({ id: P, owner_id: 'uA', name: 'Felles bokhylle' })],
      note_folders: [],
      notes: [
        base({ id: N, owner_id: 'uA', project_id: P, folder_id: null,
          title: 'Felles notat', body: doc('OPPRINNELIG') }),
        base({ id: NR, owner_id: 'uA', project_id: P, folder_id: null, locked: true,
          title: 'Kun lesing', body: doc('Leses'), pos: 1 }),
      ],
      object_links: [],
      memberships: [
        mem('uA', { note_project_id: P }, 'owner'),
        mem('uB', { note_project_id: P }, 'member'),
        mem('uC', { note_id: NR }, 'member'),
      ],
      share_invites: [], tombstones: [],
      note_updates: [], note_mark: 1, note_versions: [],
      auth_sessions: [], device_sessions: [],
      notifications: [], notification_prefs: [],
      push_subscriptions: [], push_deliveries: [], native_notif_devices: [],
    },
  };
}

async function loadAs(page, db, uid, email, seed) {
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email, seed }) => {
    sessionStorage.clear();
    if (seed) { localStorage.clear(); localStorage.setItem('hk-mock-db', JSON.stringify(db)); }
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email,
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid, email, seed });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 15000, polling: 200 });
  await page.evaluate(() => window.__huskis.setMainTab('notes'));
  await page.waitForTimeout(150);
}

const åpneEditor = async (p, id) => {
  await p.evaluate((x) => window.__huskis.openNoteEditor(x), id);
  await p.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  // Frøet er foreløpig til den første hentingen har svart; vent den ut.
  await p.waitForFunction(() => !window.__huskis.noteLiveInfo.seedPending,
    null, { timeout: 5000, polling: 50 });
  await p.waitForTimeout(80);
};
const lukkEditor = async (p) => {
  await p.evaluate(() => window.__huskis.closeNoteEditor());
  await p.waitForTimeout(200);
};
// Skriv på slutten av dokumentet, med ekte tastetrykk.
async function skrivSlutt(p, tekst) {
  await p.evaluate(() => {
    const d = document.getElementById('note-doc');
    d.focus();
    const r = document.createRange();
    r.selectNodeContents(d); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await p.keyboard.type(tekst, { delay: 8 });
  await p.waitForTimeout(200);
}
const versjoner = (p, id) => p.evaluate((x) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db'));
  return (db.note_versions || []).filter((v) => v.note_id === x)
    .sort((a, b) => a.created_at - b.created_at)
    .map((v) => ({ chars: v.chars, excerpt: v.excerpt, pinned: !!v.pinned, title: v.title }));
}, id);
const loggRader = (p, id) => p.evaluate((x) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db'));
  return (db.note_updates || []).filter((u) => u.note_id === x).length;
}, id);
async function åpneHistorikk(p, id) {
  await p.evaluate((x) => window.__huskis.openNoteHistory(x), id);
  await p.waitForFunction(() => {
    const i = window.__huskis.noteHistoryInfo;
    return i.open && i.status !== 'loading';
  }, null, { timeout: 8000, polling: 100 });
}
const historikkRader = (p) => p.evaluate(() => [...document.querySelectorAll('.note-history-row')].map((r) => ({
  when: (r.querySelector('.note-history-when') || {}).textContent || '',
  nå: !!r.querySelector('.note-history-now'),
  size: (r.querySelector('.note-history-size') || {}).textContent || '',
  text: (r.querySelector('.note-history-text') || {}).textContent || '',
  kept: r.classList.contains('is-kept'),
})));
async function åpneRad(p, i) {
  await p.evaluate((n) => {
    const rows = [...document.querySelectorAll('.note-history-row')];
    rows[n].querySelector('.note-history-head').click();
  }, i);
  await p.waitForFunction(() => {
    const el = document.querySelector('.note-history-doc');
    return !!el && !!window.__huskis.noteHistoryInfo.openId
      && el.textContent !== '' && !el.textContent.startsWith('Henter');
  }, null, { timeout: 8000, polling: 100 });
}
const arkTekst = (p) => p.evaluate(() => document.getElementById('note-doc').innerText.trim());
const crdtTekst = (p) => p.evaluate(() => window.__huskis.noteLiveInfo.text);
const notatDoc = (p, id) => p.evaluate((x) => {
  const n = window.__huskis.state.notes.find((m) => m.id === x);
  return n ? JSON.stringify(n.doc) : null;
}, id);
async function sync(p) {
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => window.__huskis.cloudCycle());
    await p.waitForTimeout(200);
  }
}

/* ============================================================
   Løp 1 — én bruker: bildene, modalen, gjenoppretting, merking
   ============================================================ */
async function run(navn, viewport, mobil) {
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport, isMobile: mobil, hasTouch: mobil });
  const feil = [];
  const p = await ctx.newPage();
  p.on('pageerror', (e) => feil.push(e.message));
  await loadAs(p, db, 'uA', 'a@x.no', true);

  // ---- 1–2. Åpning og lukking ----
  await åpneEditor(p, ids.N);
  await p.waitForTimeout(250);
  const etterÅpning = await versjoner(p, ids.N);
  check(navn + ' 1: et bilde tas når editoren åpnes — tilstanden FØR man endrer noe',
    etterÅpning.length === 1 && etterÅpning[0].excerpt === 'OPPRINNELIG', etterÅpning);

  await skrivSlutt(p, ' PLUSS MER');
  await lukkEditor(p);
  await p.waitForTimeout(300);
  const etterLukking = await versjoner(p, ids.N);
  check(navn + ' 2: … og et bilde av det man faktisk forlot ved lukking',
    etterLukking.length === 2 && etterLukking[1].excerpt === 'OPPRINNELIG PLUSS MER', etterLukking);

  // ---- 3. Ingen endring → ingen ny rad ----
  await åpneEditor(p, ids.N);
  await p.waitForTimeout(250);
  await lukkEditor(p);
  await p.waitForTimeout(300);
  const uendret = await versjoner(p, ids.N);
  check(navn + ' 3: åpne og lukke uten en endring legger ikke igjen en ny rad',
    uendret.length === 2, { antall: uendret.length });

  // ---- 4. Modalen ----
  await åpneHistorikk(p, ids.N);
  const rader = await historikkRader(p);
  check(navn + ' 4: modalen lister bildene nyeste først, med «Nå» øverst',
    rader.length === 2 && rader[0].nå === true && rader[1].nå === false
    && /OPPRINNELIG PLUSS MER/.test(rader[0].text) && /OPPRINNELIG/.test(rader[1].text),
    rader);
  check(navn + ' 4b: … og tegntallet står på hver rad',
    /\d/.test(rader[0].size) && /\d/.test(rader[1].size),
    [rader[0].size, rader[1].size]);

  // ---- 5. Trekkspillet og rendringen ----
  await åpneRad(p, 1);
  const forhånd = await p.evaluate(() => {
    const el = document.querySelector('.note-history-doc');
    return { tekst: el.innerText.trim(), html: el.innerHTML, barn: el.children.length };
  });
  check(navn + ' 5: raden åpnes og viser dokumentet som noder',
    forhånd.tekst === 'OPPRINNELIG' && forhånd.barn > 0, forhånd.tekst);

  // ---- 5b. Tilgjengelighet: 44 px berøringsflate og fokus som overlever ----
  const flater = await p.evaluate(() => [...document.querySelectorAll('.note-history-head')]
    .map((e) => Math.round(e.getBoundingClientRect().height)));
  check(navn + ' 5b: hver historikkrad har minst 44 px berøringsflate',
    flater.length > 0 && flater.every((h) => h >= 44), flater);
  const fokus = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.note-history-row')];
    const head = rows[0].querySelector('.note-history-head');
    head.focus();
    head.click();                    // lukker/åpner raden og maler listen om
    const nå = document.activeElement;
    return {
      erHode: !!(nå && nå.classList && nå.classList.contains('note-history-head')),
      sammeRad: !!(nå && nå.closest('.note-history-row')
                   && nå.closest('.note-history-row').dataset.id === rows[0].dataset.id),
    };
  });
  check(navn + ' 5c: fokus blir stående på raden når listen males om',
    fokus.erHode && fokus.sammeRad, fokus);
  // Tilbake til raden vi faktisk skal gjenopprette fra.
  await p.evaluate(() => {
    const åpen = document.querySelector('.note-history-row.is-open');
    if (åpen) åpen.querySelector('.note-history-head').click();
  });
  await p.waitForTimeout(150);
  await åpneRad(p, 1);

  // ---- 6. Gjenoppretting ----
  const raderFør = await loggRader(p, ids.N);
  await p.evaluate(() => document.querySelector('.note-history-restore').click());
  await p.waitForFunction(() => {
    const H = window.__huskis;
    const n = H.state.notes.find((m) => m.id === H.noteHistoryInfo.id);
    return n && JSON.stringify(n.doc).indexOf('PLUSS MER') === -1;
  }, null, { timeout: 8000, polling: 100 });
  await p.waitForTimeout(300);
  const etterGjen = {
    doc: await notatDoc(p, ids.N),
    crdt: await crdtTekst(p),
    ark: await arkTekst(p),
    rader: await loggRader(p, ids.N),
  };
  check(navn + ' 6: gjenoppretting går gjennom CRDT-en — loggen VOKSER, den byttes ikke ut',
    etterGjen.rader > raderFør, { før: raderFør, etter: etterGjen.rader });
  check(navn + ' 6b: … og dokument, CRDT og ark viser det gamle igjen',
    etterGjen.crdt === 'OPPRINNELIG' && etterGjen.ark === 'OPPRINNELIG'
    && etterGjen.doc.indexOf('PLUSS MER') === -1, etterGjen);

  // ---- 7. Angre fra toasten ----
  const harAngre = await p.evaluate(() => {
    const b = document.querySelector('#toast .toast-action');
    return b ? b.textContent : null;
  });
  check(navn + ' 7: toasten tilbyr å angre gjenopprettingen', harAngre === 'Angre', harAngre);
  await p.evaluate(() => document.querySelector('#toast .toast-action').click());
  await p.waitForFunction(() => window.__huskis.noteLiveInfo.text.indexOf('PLUSS MER') > -1,
    null, { timeout: 8000, polling: 100 });
  check(navn + ' 7b: … og angringen tar oss tilbake til det vi hadde',
    (await crdtTekst(p)) === 'OPPRINNELIG PLUSS MER', await crdtTekst(p));

  // ---- 12. «Lagre versjon nå» merker et bilde ----
  await åpneHistorikk(p, ids.N);
  await p.evaluate(() => document.getElementById('note-history-snapshot').click());
  await p.waitForFunction(() => document.querySelectorAll('.note-history-row.is-kept').length > 0,
    null, { timeout: 8000, polling: 100 });
  const merket = (await versjoner(p, ids.N)).filter((v) => v.pinned);
  check(navn + ' 12: «Lagre versjon nå» merker et bilde, og merket vises i lista',
    merket.length === 1, merket);

  await p.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(p);

  // ---- 13. REGRESJON: frøet skal ikke doble et allerede samskrevet notat ----
  // En enhet UTEN lokal kopi er nettopp det: køen og kopien fjernes, og notatet
  // åpnes på nytt. Uten det utsatte frøet ville frøet fra `body` møtt loggen og
  // lagt hele teksten inn en gang til.
  const fasit = await p.evaluate((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return JSON.stringify(n.doc);
  }, ids.N);
  await p.evaluate(() => {
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('hk-note-crdt:') === 0 || k.indexOf('hk-note-ops:') === 0) localStorage.removeItem(k);
    });
  });
  await p.reload();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 15000, polling: 200 });
  await p.evaluate(() => window.__huskis.setMainTab('notes'));
  await åpneEditor(p, ids.N);
  await p.waitForTimeout(300);
  const friskt = { crdt: await crdtTekst(p), ark: await arkTekst(p) };
  check(navn + ' 13: en enhet uten lokal kopi åpner notatet UTEN å doble teksten',
    friskt.crdt === 'OPPRINNELIG PLUSS MER' && friskt.ark === 'OPPRINNELIG PLUSS MER', friskt);
  await lukkEditor(p);
  check(navn + ' 13b: … og projeksjonen står uendret etterpå',
    (await notatDoc(p, ids.N)) === fasit, await notatDoc(p, ids.N));

  // ---- 14. REGRESJON: et NYTT notat virker FØR serveren har svart ----
  // Raden ligger i synk-køen når editoren åpnes, så den første hentingen
  // svarer «finnes ikke». Det lokale dokumentet skal likevel være helt vanlig:
  // det er PUBLISERINGEN som venter på svaret, ikke skrivingen.
  await p.click('#add-note-btn');
  await p.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  await skrivSlutt(p, 'FERSKT NOTAT');
  await p.waitForTimeout(250);
  const ferskt = await p.evaluate(() => {
    const i = window.__huskis.noteLiveInfo;
    return { seedPending: i.seedPending, crdt: i.text };
  });
  check(navn + ' 14: et nytt notat har teksten i CRDT-en med én gang',
    ferskt.crdt === 'FERSKT NOTAT', ferskt);
  await p.evaluate(() => window.__huskis.noteUndoRedo(true));
  await p.waitForTimeout(200);
  check(navn + ' 14b: … og angre virker før serveren har svart',
    (await crdtTekst(p)) !== 'FERSKT NOTAT'
    && (await arkTekst(p)) !== 'FERSKT NOTAT',
    { crdt: await crdtTekst(p), ark: await arkTekst(p) });
  await lukkEditor(p);

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 1b — en UTDATERT projeksjon skal aldri kunne slette den andres avsnitt

   Den farlige varianten av frø-tilfellet: enheten har ingen lokal kopi, og
   `body` er ELDRE enn samskrivingsloggen (en annen har skrevet et avsnitt som
   ennå ikke har nådd oss). Rekker brukeren å skrive før den første hentingen
   svarer, ville en forskjell mellom arket og serverens dokument lest det
   avsnittet som en SLETTING — og neste push ville fjernet det for alle.
   ============================================================ */
async function runUtdatert() {
  const navn = 'utdatert';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);

  // A skriver et avsnitt og lukker. Loggen har nå rader.
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' AVSNITT FRA A');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(250);
  const iLoggen = await loggRader(a, ids.N);
  check(navn + ' 15a: loggen har rader (forutsetningen)', iLoggen > 0, { rader: iLoggen });

  /* PROJEKSJONEN SETTES TILBAKE på SERVEREN, med et ferskere stempel: det er
     nøyaktig det en enhet ser når `body` ligger etter loggen — den andres
     avsnitt finnes i samskrivingen, men ikke i teksten vi sår fra. Og den
     lokale kopien av CRDT-en fjernes, så enheten åpner notatet «første gang». */
  await a.evaluate(async (x) => {
    await window.HK_MOCK._edit((db) => {
      const n = db.notes.find((m) => m.id === x);
      n.body = { v: 1, blocks: [{ t: 'p', c: [{ s: 'OPPRINNELIG' }] }] };
      n.ts = Date.now() + 60000;
      n.org = 'annen-enhet';
    });
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('hk-note-crdt:') === 0 || k.indexOf('hk-note-ops:') === 0) localStorage.removeItem(k);
    });
  }, ids.N);

  /* `&lag=800` holder vinduet åpent: den første hentingen bruker et drøyt
     halvsekund, og tastetrykkene lander MENS frøet ennå er foreløpig. Uten
     forsinkelsen rekker hentingen å svare før man får skrevet et tegn, og
     testen ville målt noe annet enn den tror. */
  await a.goto(BASE + '/?mock=1&lag=800');
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && JSON.stringify(n.doc).indexOf('AVSNITT FRA A') === -1;
  }, ids.N, { timeout: 20000, polling: 200 });

  /* DEN FØRSTE LAGRINGEN AV UTKASTET SKAL FEILE. Det er selve påstanden: på
     det punktet er utkastet den eneste kopien — CRDT-en er byttet ut og
     projeksjonen skrives over — så et enkelt tapt svar ville vært stille
     datatap i nettopp det nettet som skal hindre datatap. Hentingen av loggen
     må derimot LYKKES, ellers avgjøres frøet aldri. */
  await a.evaluate(() => {
    const c = window.__huskis.client;
    const ekte = c.rpc.bind(c);
    let brukt = false;
    window.__hkFeilet = 0;
    c.rpc = function (navn, params) {
      /* Nøyaktig lagringen av UTKASTET, ikke den første lagringen som helhet:
         editoren tar et åpningsbilde også, og en stubb som bare teller kall
         ville felt feil kall og målt noe annet enn den tror. */
      const erUtkastet = navn === 'note_version_save'
        && JSON.stringify((params || {}).p_doc || '').indexOf('MITT UTKAST') > -1;
      if (erUtkastet && !brukt) {
        brukt = true;
        window.__hkFeilet++;
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return ekte(navn, params);
    };
    window.__hkGjenopprett = () => { c.rpc = ekte; };
  });

  await a.evaluate((x) => window.__huskis.openNoteEditor(x), ids.N);
  await a.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  const iVinduet = await a.evaluate(() => window.__huskis.noteLiveInfo.seedPending);
  check(navn + ' 15b: frøet er foreløpig når vi begynner å skrive (forutsetningen)',
    iVinduet === true, { seedPending: iVinduet });
  await skrivSlutt(a, ' MITT UTKAST');
  await a.waitForFunction(() => !window.__huskis.noteLiveInfo.seedPending,
    null, { timeout: 20000, polling: 50 });
  await a.waitForTimeout(400);
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await a.waitForTimeout(300);

  const etter = { crdt: await crdtTekst(a), ark: await arkTekst(a) };
  check(navn + ' 15: den andres avsnitt står — det ble ALDRI lest som en sletting',
    etter.crdt.indexOf('AVSNITT FRA A') > -1 && etter.ark.indexOf('AVSNITT FRA A') > -1, etter);
  check(navn + ' 15c: … og serverens dokument er det arket viser',
    etter.crdt.indexOf('MITT UTKAST') === -1, etter);

  /* Lagringen feilet — og teksten skal likevel finnes, i en holdbar kø på
     enheten. Den overlever at fanen lukkes, og tømmes ved neste synk-runde. */
  const køen = await a.evaluate(() => ({
    feilet: window.__hkFeilet,
    kø: window.__huskis.noteDraftsInfo,
    lagret: JSON.parse(localStorage.getItem(
      Object.keys(localStorage).find((k) => k.indexOf('hk-note-draft:') === 0) || 'x') || 'null'),
  }));
  check(navn + ' 15d: lagringen feilet faktisk (forutsetningen)', køen.feilet === 1, køen.feilet);
  check(navn + ' 15e: utkastet er likevel tatt vare på — i en HOLDBAR kø på enheten',
    køen.kø.count === 1 && /MITT UTKAST/.test(køen.kø.texts[0] || '')
    && Array.isArray(køen.lagret) && køen.lagret.length === 1,
    { kø: køen.kø.texts, iLagringen: (køen.lagret || []).length });

  // …og ved neste runde havner det i historikken, uten at brukeren gjør noe.
  await a.evaluate(() => window.__hkGjenopprett());
  await a.evaluate(async () => { await window.__huskis.pushNoteDrafts(); });
  await a.waitForFunction(() => window.__huskis.noteDraftsInfo.count === 0,
    null, { timeout: 20000, polling: 100 });
  await åpneHistorikk(a, ids.N);
  const rader = await historikkRader(a);
  check(navn + ' 15f: … og neste runde legger det i historikken av seg selv',
    rader.some((r) => /MITT UTKAST/.test(r.text)), rader.map((r) => r.text));
  await a.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(a);

  /* ---- 16. Køen kaster ALDRI en ubekreftet kopi ----
     Hver rad er en tekst som ikke finnes noe annet sted før serveren har
     bekreftet den. Et tak ville måttet kaste den eldste — altså slette den
     eneste kopien av noe, stille. Her legges 25 utkast i køen mens HVER
     lagring feiler, og alle 25 skal fortsatt være å finne, både i minnet og i
     enhetens lagring. */
  await a.evaluate(() => {
    const c = window.__huskis.client;
    const ekte = c.rpc.bind(c);
    c.rpc = function (navn, params) {
      if (navn === 'note_version_save') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return ekte(navn, params);
    };
    window.__hkGjenopprett = () => { c.rpc = ekte; };
  });
  await a.evaluate((x) => {
    for (let i = 1; i <= 25; i++) {
      window.__huskis.queueNoteDraft(x, {
        title: 'Felles notat',
        doc: { v: 1, blocks: [{ t: 'p', c: [{ s: 'UTKAST ' + i }] }] },
      });
    }
  }, ids.N);
  await a.evaluate(async () => { await window.__huskis.pushNoteDrafts(); });
  await a.waitForTimeout(200);
  const mange = await a.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.indexOf('hk-note-draft:') === 0);
    const lagret = JSON.parse(localStorage.getItem(key) || '[]');
    const info = window.__huskis.noteDraftsInfo;
    return {
      iMinnet: info.count,
      iLagringen: lagret.length,
      førsteFinnes: info.texts.some((t) => t === 'UTKAST 1'),
      sisteFinnes: info.texts.some((t) => t === 'UTKAST 25'),
    };
  });
  check(navn + ' 16: 25 ubekreftede utkast blir ALLE stående — ingen kastes for å spare plass',
    mange.iMinnet === 25 && mange.iLagringen === 25
    && mange.førsteFinnes && mange.sisteFinnes, mange);

  /* ---- 17. Et forsøk på nytt er nøyaktig idempotent ----
     Serveren committer bildet, men svaret blir borte, og en ANNEN historikkrad
     kommer imellom før forsøket gjentas. Uten en stabil id ville
     fingeravtrykket da ikke lenger vært mot den samme ferskeste raden, og det
     samme utkastet ville blitt lagt inn en gang til. */
  await a.evaluate(() => window.__hkGjenopprett());
  // Tøm køen fra forrige sjekk: den hører ikke til dette scenariet.
  await a.evaluate(() => {
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('hk-note-draft:') === 0) localStorage.removeItem(k);
    });
  });
  await a.reload();
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));

  await a.evaluate(() => {
    const c = window.__huskis.client;
    const ekte = c.rpc.bind(c);
    let svelget = false;
    window.__hkSvelget = 0;
    c.rpc = async function (navn, params) {
      const erUtkastet = navn === 'note_version_save'
        && JSON.stringify((params || {}).p_doc || '').indexOf('IDEMPOTENT') > -1;
      if (!erUtkastet || svelget) return ekte(navn, params);
      svelget = true;
      window.__hkSvelget++;
      await ekte(navn, params);             // serveren COMMITTER bildet …
      /* … og den ANDRE historikkraden legges inn her, mens svaret ennå ikke
         har kommet tilbake. Da er den på plass uansett HVEM som kjører
         forsøket på nytt — den eksplisitte pushen under, eller synk-runden
         som drenerer den samme køen av seg selv. */
      await ekte('note_version_save', {
        p_note: params.p_note, p_id: crypto.randomUUID(), p_title: params.p_title,
        p_doc: { v: 1, blocks: [{ t: 'p', c: [{ s: 'NOE HELT ANNET' }] }] },
        p_excerpt: 'NOE HELT ANNET', p_chars: 14, p_pinned: false,
      });
      return { data: null, error: { message: 'Failed to fetch' } };   // … svaret blir borte
    };
  });
  await a.evaluate((x) => {
    window.__huskis.queueNoteDraft(x, {
      title: 'Felles notat',
      doc: { v: 1, blocks: [{ t: 'p', c: [{ s: 'IDEMPOTENT UTKAST' }] }] },
    });
  }, ids.N);
  /* Køen leses i det SAMME evaluate-kallet som pushen, uten et opphold
     imellom: synk-runden drenerer den samme køen, og et opphold ville latt
     den rekke forsøket først. */
  const etterTapt = await a.evaluate(async (x) => {
    await window.__huskis.pushNoteDrafts();
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const rader = (db.note_versions || []).filter((v) => v.note_id === x)
      .sort((p1, p2) => p2.created_at - p1.created_at);
    return {
      svelget: window.__hkSvelget,
      iKøen: window.__huskis.noteDraftsInfo.count,
      ferskeste: JSON.stringify((rader[0] || {}).doc || '').indexOf('NOE HELT ANNET') > -1,
    };
  }, ids.N);
  check(navn + ' 17: et tapt svar lar raden bli stående i køen, og en ANNEN rad '
    + 'er kommet imellom (forutsetningen)',
    etterTapt.svelget === 1 && etterTapt.iKøen === 1 && etterTapt.ferskeste, etterTapt);

  await a.evaluate(async () => { await window.__huskis.pushNoteDrafts(); });
  await a.waitForFunction(() => window.__huskis.noteDraftsInfo.count === 0,
    null, { timeout: 20000, polling: 100 });
  const antall = await a.evaluate((x) => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (db.note_versions || []).filter((v) => v.note_id === x)
      .filter((v) => JSON.stringify(v.doc).indexOf('IDEMPOTENT') > -1).length;
  }, ids.N);
  check(navn + ' 17b: … og forsøket på nytt gir ÉN rad, ikke to',
    antall === 1, { rader: antall });

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 1c — HVERKEN enheten eller kontoen tar imot

   Den siste utgangen av den utdaterte projeksjonen: utkastet skal ligge trygt
   FØR det foreløpige dokumentet kastes. Nekter enhetens lagring OG serveren
   samtidig, finnes det ingen holdbar destinasjon — og da skal ingenting
   kastes. Økten blir stående foreløpig, arket beholder teksten, og ingenting
   publiseres. Går lagringen igjen, fullfører overgangen av seg selv.
   ============================================================ */
async function runUtenLagring() {
  const navn = 'uten lagring';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);

  // Den samme oppstillingen som løp 1b: loggen har rader, og projeksjonen
  // settes tilbake på serveren så den ligger ETTER loggen.
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' AVSNITT FRA A');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(250);
  await a.evaluate(async (x) => {
    await window.HK_MOCK._edit((d) => {
      const n = d.notes.find((m) => m.id === x);
      n.body = { v: 1, blocks: [{ t: 'p', c: [{ s: 'OPPRINNELIG' }] }] };
      n.ts = Date.now() + 60000;
      n.org = 'annen-enhet';
    });
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('hk-note-crdt:') === 0 || k.indexOf('hk-note-ops:') === 0) localStorage.removeItem(k);
    });
  }, ids.N);

  await a.goto(BASE + '/?mock=1&lag=800');
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && JSON.stringify(n.doc).indexOf('AVSNITT FRA A') === -1;
  }, ids.N, { timeout: 20000, polling: 200 });

  /* BEGGE holdbare destinasjonene sier nei: enhetens lagring nekter køen (full
     disk, privat modus), og serveren tar ikke imot noe bilde. */
  await a.evaluate(() => {
    const ekteSet = localStorage.setItem.bind(localStorage);
    window.__hkNektet = 0;
    localStorage.setItem = function (k, v) {
      if (String(k).indexOf('hk-note-draft:') === 0) {
        window.__hkNektet++;
        throw new Error('QuotaExceededError');
      }
      return ekteSet(k, v);
    };
    window.__hkLagringTilbake = () => { localStorage.setItem = ekteSet; };

    const c = window.__huskis.client;
    const ekteRpc = c.rpc.bind(c);
    window.__hkAvvist = 0;
    c.rpc = function (n2, params) {
      if (n2 === 'note_version_save') {
        window.__hkAvvist++;
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return ekteRpc(n2, params);
    };
    window.__hkNettTilbake = () => { c.rpc = ekteRpc; };
  });

  await a.evaluate((x) => window.__huskis.openNoteEditor(x), ids.N);
  await a.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  const iVinduet = await a.evaluate(() => window.__huskis.noteLiveInfo.seedPending);
  check(navn + ' 18a: frøet er foreløpig når vi begynner å skrive (forutsetningen)',
    iVinduet === true, { seedPending: iVinduet });
  const førUtkastet = await loggRader(a, ids.N);
  await skrivSlutt(a, ' MITT UTKAST');

  /* Vent på at overgangen faktisk ble FORSØKT — signalet er at lagringen sa
     nei, og det skjer uansett hva appen gjør etterpå. Å vente på toasten ville
     latt testen henge i stedet for å felle en påstand når vakten mangler. */
  await a.waitForFunction(() => window.__hkNektet > 0,
    null, { timeout: 20000, polling: 100 });
  await a.waitForTimeout(900);          // et par runder til, så et tak ville vist seg

  const blokkert = await a.evaluate(() => ({
    nektet: window.__hkNektet > 0,
    seedPending: window.__huskis.noteLiveInfo.seedPending,
    ark: document.getElementById('note-doc').innerText.trim(),
    iKøen: window.__huskis.noteDraftsInfo.count,
  }));
  check(navn + ' 18b: lagringen nektet faktisk (forutsetningen)', blokkert.nektet, blokkert.nektet);
  check(navn + ' 18: teksten står fortsatt der brukeren skrev den — ingenting ble kastet',
    blokkert.ark.indexOf('MITT UTKAST') > -1 && blokkert.seedPending === true,
    { ark: blokkert.ark, seedPending: blokkert.seedPending });
  check(navn + ' 18c: … og køen vokser ikke med en rad for hver runde',
    blokkert.iKøen === 0, { iKøen: blokkert.iKøen });

  /* Og INGENTING ble publisert. Målt på loggen, ikke på projeksjonen: det er
     loggen som avgjør innhold, mens projeksjonen skrives om av den som lagret
     sist uansett. Kom det en rad her, ville det foreløpige dokumentet vært på
     vei ut til de andre — og den andres avsnitt med i dragsuget. */
  const iLoggen = await loggRader(a, ids.N);
  check(navn + ' 18d: … og loggen fikk ingen nye rader — ingenting gikk ut til de andre',
    iLoggen === førUtkastet, { før: førUtkastet, nå: iLoggen });

  /* OG APPEN PÅSTÅR IKKE NOE ANNET. Toasten som sier at teksten er tatt vare
     på skal ikke ha vært vist — den er sann bare når en holdbar destinasjon
     faktisk tok imot. */
  const sagt = await a.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  check(navn + ' 18e: … og appen sier ikke at teksten er lagret',
    sagt.indexOf('tatt vare på') === -1 && sagt.indexOf('ikke lagret ennå') > -1, sagt);

  /* LUKKES NOTATET MENS DET STÅR SLIK, ville arket — den eneste kopien —
     forsvunnet. Da lukker appen ikke: editoren blir stående, og brukeren får
     velge selv. */
  await a.evaluate(() => window.__huskis.closeNoteEditor());
  await a.waitForTimeout(400);
  const etterForsøk = await a.evaluate(() => ({
    åpen: !document.getElementById('note-editor').hidden,
    ark: document.getElementById('note-doc').innerText.trim(),
    toast: (document.getElementById('toast') || {}).textContent || '',
    kø: window.__huskis.noteDraftsInfo.texts,
  }));
  check(navn + ' 18f: appen lukker IKKE notatet når teksten ikke kan lagres noe sted',
    etterForsøk.åpen === true && etterForsøk.ark.indexOf('MITT UTKAST') > -1,
    { åpen: etterForsøk.åpen, ark: etterForsøk.ark });
  check(navn + ' 18g: … og brukeren får valget i stedet for et tap i det stille',
    etterForsøk.toast.indexOf('kan det gå tapt') > -1
    && etterForsøk.toast.indexOf('Lukk likevel') > -1, etterForsøk.toast);

  // Et nytt forsøk skal ikke legge inn utkastet en gang til.
  await a.evaluate(() => window.__huskis.closeNoteEditor());
  await a.waitForTimeout(300);
  const toGanger = await a.evaluate(() => window.__huskis.noteDraftsInfo.texts);
  check(navn + ' 18g2: … og et nytt forsøk legger ikke inn utkastet på nytt',
    toGanger.filter((t) => /MITT UTKAST/.test(t)).length === 1, toGanger);

  /* ARKIVER OG PAPIRKURV GÅR IKKE UTENOM. De legger notatet bort, og skal ikke
     bety «kast det jeg nettopp skrev»: avvises lukkingen, avvises handlingen
     med. */
  await a.evaluate(() => document.getElementById('note-menu-btn').click());
  await a.waitForTimeout(300);
  await a.evaluate(() => {
    const rad = [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')]
      .find((r) => /Arkiver/.test(r.textContent));
    if (rad) rad.click();
  });
  await a.waitForTimeout(500);
  const etterArkiv = await a.evaluate((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return {
      arkivert: !!(n && n.archived),
      åpen: !document.getElementById('note-editor').hidden,
      ark: document.getElementById('note-doc').innerText.trim(),
    };
  }, ids.N);
  check(navn + ' 18g4: «Arkiver» legger ikke notatet bort mens teksten står ulagret',
    etterArkiv.arkivert === false && etterArkiv.åpen === true
    && etterArkiv.ark.indexOf('MITT UTKAST') > -1, etterArkiv);

  /* … men velger brukeren «Lukk likevel», skjer det hen ba om: notatet
     arkiveres, og teksten blir liggende i køen. */
  await a.evaluate(() => {
    const b = document.querySelector('#toast .toast-action');
    if (b) b.click();
  });
  await a.waitForTimeout(500);
  const etterLikevel = await a.evaluate((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return { arkivert: !!(n && n.archived), åpen: !document.getElementById('note-editor').hidden };
  }, ids.N);
  check(navn + ' 18g5: … og «Lukk likevel» utfører arkiveringen brukeren ba om',
    etterLikevel.arkivert === true && etterLikevel.åpen === false, etterLikevel);

  // Notatet hentes ut av arkivet igjen, så resten av løpet står som før.
  await a.evaluate(async (x) => {
    await window.HK_MOCK._edit((d) => {
      const n = d.notes.find((m) => m.id === x);
      n.archived = false; n.ts = Date.now() + 1000; n.org = 'test';
    });
  }, ids.N);
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && !n.archived;
  }, ids.N, { timeout: 20000, polling: 200 });

  /* PAPIRKURVEN ER EN ANNEN KOBLING i menyen (`spec.remove`, ikke
     `spec.extraRows`), så arkivtesten beskytter den ikke. Samme scenario, en
     gang til: overgangen står, og handlingen skal avvises. */
  await a.evaluate((x) => window.__huskis.openNoteEditor(x), ids.N);
  await a.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  const iVinduet2 = await a.evaluate(() => window.__huskis.noteLiveInfo.seedPending);
  check(navn + ' 18g6: frøet er foreløpig igjen (forutsetningen)',
    iVinduet2 === true, { seedPending: iVinduet2 });
  await skrivSlutt(a, ' NOE MER');
  await a.waitForFunction(() => window.__hkNektet > 0,
    null, { timeout: 20000, polling: 100 });
  await a.waitForTimeout(600);
  await a.evaluate(() => document.getElementById('note-menu-btn').click());
  await a.waitForTimeout(300);
  await a.evaluate(() => {
    const rad = [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')]
      .find((r) => /Slett notatet/.test(r.textContent));
    if (rad) rad.click();
  });
  await a.waitForTimeout(600);
  // En sletting ligger først i angre-vinduet (`_pendingDelete`) før flagget
  // skrives, så begge teller som «lagt i papirkurven».
  const etterKurv = await a.evaluate((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return {
      iKurven: !!(n && (n.trashed || n._pendingDelete)),
      åpen: !document.getElementById('note-editor').hidden,
      ark: document.getElementById('note-doc').innerText.trim(),
    };
  }, ids.N);
  check(navn + ' 18g7: «Slett notatet» legger det ikke i papirkurven mens teksten står ulagret',
    etterKurv.iKurven === false && etterKurv.åpen === true
    && etterKurv.ark.indexOf('NOE MER') > -1, etterKurv);

  await a.evaluate(() => {
    const b = document.querySelector('#toast .toast-action');
    if (b) b.click();
  });
  await a.waitForTimeout(600);
  const etterKurvLikevel = await a.evaluate((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return {
      iKurven: !!(n && (n.trashed || n._pendingDelete)),
      åpen: !document.getElementById('note-editor').hidden,
    };
  }, ids.N);
  check(navn + ' 18g8: … og «Lukk likevel» utfører papirkurven brukeren ba om',
    etterKurvLikevel.iKurven === true && etterKurvLikevel.åpen === false, etterKurvLikevel);

  // Angres med det samme, så resten av løpet står som før.
  await a.evaluate((x) => window.__huskis.restoreNoteObject('note', x), ids.N);
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && !n.trashed && !n._pendingDelete;
  }, ids.N, { timeout: 20000, polling: 200 });
  await a.waitForTimeout(400);
  const etterLukking = await a.evaluate(() => ({
    åpen: !document.getElementById('note-editor').hidden,
    kø: window.__huskis.noteDraftsInfo.texts,
  }));
  check(navn + ' 18g3: editoren er lukket, og teksten ligger i køen',
    etterLukking.åpen === false && etterLukking.kø.some((t) => /MITT UTKAST/.test(t)),
    etterLukking);

  /* Går lagringen igjen, blir raden holdbar av seg selv ved neste synk-runde —
     uten at brukeren gjør noe. Serveren tar fortsatt ikke imot bildet. */
  await a.evaluate(() => window.__hkLagringTilbake());
  await a.evaluate(async () => { await window.__huskis.pushNoteDrafts(); });
  const køen = await a.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.indexOf('hk-note-draft:') === 0);
    return {
      kø: window.__huskis.noteDraftsInfo.texts,
      iLagringen: JSON.parse(localStorage.getItem(key) || '[]').length,
    };
  });
  check(navn + ' 18h: med lagringen tilbake blir raden holdbar av seg selv',
    køen.kø.some((t) => /MITT UTKAST/.test(t)) && køen.iLagringen >= 1, køen);

  // … og når serveren tar imot igjen, havner det i historikken ÉN gang.
  await a.evaluate(() => window.__hkNettTilbake());
  await a.evaluate(async () => { await window.__huskis.pushNoteDrafts(); });
  await a.waitForFunction(() => window.__huskis.noteDraftsInfo.count === 0,
    null, { timeout: 20000, polling: 100 });
  const iHistorikken = await a.evaluate((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (d.note_versions || []).filter((v) => v.note_id === x)
      .filter((v) => JSON.stringify(v.doc).indexOf('MITT UTKAST') > -1).length;
  }, ids.N);
  check(navn + ' 18i: … og når serveren tar imot igjen, ligger det i historikken ÉN gang',
    iHistorikken === 1, { rader: iHistorikken });

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 1d — et bilde tas bare av en AVKLART tilstand

   19. Hurtigbufferen som ofres for et strandet utkast er bare en
       hurtigbuffer så lenge alt som er laget mot den har nådd serveren. Et
       notat med rader i køen skal aldri miste sin lokale kopi.
   20. Historikken åpnet fra et LUKKET kort skal ikke legge en utdatert
       projeksjon inn som «Nå» — og en gjenoppretting derfra skal faktisk bli
       gjeldende, ikke tapes i frø-oppgjøret.
   21. Går ikke bildet av tilstanden FØR gjennom, gjennomføres ingen
       gjenoppretting: løftet er at man alltid kan komme tilbake.
   ============================================================ */
async function runAvklart() {
  const navn = 'avklart';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);

  /* ---- 19. Et notat med usendte endringer mister aldri sin lokale kopi ---- */
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' AVSNITT FRA A');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(250);

  // Nå skrives det UTEN nett: raden blir stående i køen, og den lokale kopien
  // er det eneste stedet dokumentet den er laget mot finnes.
  await a.evaluate(() => window.HK_MOCK.setOffline(true));
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' OFFLINE-TILLEGG');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(250);
  const før19 = await a.evaluate((x) => {
    const snapKey = Object.keys(localStorage).find((k) => k.indexOf('hk-note-crdt:') === 0);
    const snaps = JSON.parse(localStorage.getItem(snapKey) || '{}');
    return { harKopi: !!snaps[x], iKøen: window.__huskis.noteLiveInfo ? 0 : 0,
             ops: (JSON.parse(localStorage.getItem(
               Object.keys(localStorage).find((k) => k.indexOf('hk-note-ops:') === 0) || 'x') || '[]')).length };
  }, ids.N);
  check(navn + ' 19a: notatet har en lokal kopi OG rader i køen (forutsetningen)',
    før19.harKopi && før19.ops > 0, før19);

  // Enhetens lagring nekter køen av strandede utkast. Ventilen skal da IKKE
  // finne noe den trygt kan rydde — og skrivingen skal feile.
  const nektet = await a.evaluate((x) => {
    const ekte = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      if (String(k).indexOf('hk-note-draft:') === 0) throw new Error('QuotaExceededError');
      return ekte(k, v);
    };
    const svar = window.__huskis.queueNoteDraft(x, {
      title: 'Felles notat',
      doc: { v: 1, blocks: [{ t: 'p', c: [{ s: 'ET STRANDET UTKAST' }] }] },
    });
    localStorage.setItem = ekte;
    const snapKey = Object.keys(localStorage).find((k) => k.indexOf('hk-note-crdt:') === 0);
    const snaps = JSON.parse(localStorage.getItem(snapKey) || '{}');
    return { holdbar: svar, harKopi: !!snaps[x] };
  }, ids.N);
  check(navn + ' 19: den lokale kopien til et notat med usendte endringer ryddes ALDRI',
    nektet.harKopi === true && nektet.holdbar === false, nektet);

  /* … og når raden er levert, ER kopien bare en hurtigbuffer: da kan den ofres
     for utkastet, som ikke finnes noe annet sted. */
  await a.evaluate(() => window.HK_MOCK.setOffline(false));
  await a.evaluate(async () => { await window.__huskis.pushNoteOps(); });
  await a.waitForFunction(() => {
    const k = Object.keys(localStorage).find((n2) => n2.indexOf('hk-note-ops:') === 0);
    return JSON.parse(localStorage.getItem(k) || '[]').length === 0;
  }, null, { timeout: 20000, polling: 100 });
  const ofret = await a.evaluate((x) => {
    const ekte = localStorage.setItem.bind(localStorage);
    let forsøk = 0;
    localStorage.setItem = function (k, v) {
      // Bare den FØRSTE skrivingen av køen nektes: etter at kopien er ryddet
      // skal den andre gå gjennom.
      if (String(k).indexOf('hk-note-draft:') === 0 && forsøk++ === 0) {
        throw new Error('QuotaExceededError');
      }
      return ekte(k, v);
    };
    const svar = window.__huskis.queueNoteDraft(x, {
      title: 'Felles notat',
      doc: { v: 1, blocks: [{ t: 'p', c: [{ s: 'ET STRANDET UTKAST' }] }] },
    });
    localStorage.setItem = ekte;
    const snapKey = Object.keys(localStorage).find((k) => k.indexOf('hk-note-crdt:') === 0);
    return { holdbar: svar, harKopi: !!JSON.parse(localStorage.getItem(snapKey) || '{}')[x] };
  }, ids.N);
  check(navn + ' 19b: … men er alt levert, er kopien en hurtigbuffer som kan ofres',
    ofret.holdbar === true && ofret.harKopi === false, ofret);
  await a.evaluate(async () => { await window.__huskis.pushNoteDrafts(); });
  await a.waitForFunction(() => window.__huskis.noteDraftsInfo.count === 0,
    null, { timeout: 20000, polling: 100 });

  /* ---- 20. Ingen falsk «Nå» fra en utdatert projeksjon ---- */
  await a.evaluate(async (x) => {
    await window.HK_MOCK._edit((d) => {
      const n = d.notes.find((m) => m.id === x);
      n.body = { v: 1, blocks: [{ t: 'p', c: [{ s: 'UTDATERT PROJEKSJON' }] }] };
      n.ts = Date.now() + 60000;
      n.org = 'annen-enhet';
    });
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('hk-note-crdt:') === 0 || k.indexOf('hk-note-ops:') === 0) localStorage.removeItem(k);
    });
  }, ids.N);
  await a.goto(BASE + '/?mock=1');
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && JSON.stringify(n.doc).indexOf('UTDATERT PROJEKSJON') > -1;
  }, ids.N, { timeout: 20000, polling: 200 });

  // Historikken åpnes DIREKTE fra kortet, uten at editoren har vært innom.
  await åpneHistorikk(a, ids.N);
  const rader20 = await historikkRader(a);
  const nå = rader20.find((r) => r.nå) || rader20[0] || {};
  check(navn + ' 20: «Nå» er loggens dokument, ikke den utdaterte projeksjonen',
    /OFFLINE-TILLEGG/.test(nå.text) && !/UTDATERT PROJEKSJON/.test(nå.text), nå.text);
  check(navn + ' 20b: … og den utdaterte projeksjonen kom ikke inn som en ny rad',
    !rader20.some((r) => /UTDATERT PROJEKSJON/.test(r.text)), rader20.map((r) => r.text));

  // … og en gjenoppretting derfra blir FAKTISK gjeldende.
  const eldst = await a.evaluate((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    const rader = (d.note_versions || []).filter((v) => v.note_id === x)
      .sort((p, q) => p.created_at - q.created_at);
    return rader.length ? { id: rader[0].id, tekst: JSON.stringify(rader[0].doc) } : null;
  }, ids.N);
  check(navn + ' 20c: det finnes en eldre versjon å hente (forutsetningen)', !!eldst, eldst && eldst.tekst);
  await a.evaluate(async (p) => { await window.__huskis.restoreNoteVersion(p.n, p.v); },
    { n: ids.N, v: (eldst || {}).id });
  await a.waitForTimeout(600);
  await sync(a);
  const etter20 = await notatDoc(a, ids.N);
  check(navn + ' 20d: … og det gjenopprettede innholdet er det som gjelder etterpå',
    !!eldst && etter20 === eldst.tekst, { nå: etter20, ba_om: eldst && eldst.tekst });
  await a.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(a);

  /* ---- 21. Ingen gjenoppretting uten bildet av tilstanden FØR ---- */
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' NOE NYTT SIDEN SIST');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  // Projeksjonen skrives med et opphold; les den først når tegnene er inne,
  // ellers måler «før» en tilstand som alt er passert.
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && JSON.stringify(n.doc).indexOf('NOE NYTT SIDEN SIST') > -1;
  }, ids.N, { timeout: 20000, polling: 100 });
  const før21 = await notatDoc(a, ids.N);
  await a.evaluate(() => {
    const c = window.__huskis.client;
    const ekte = c.rpc.bind(c);
    c.rpc = function (n2, params) {
      if (n2 === 'note_version_save') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return ekte(n2, params);
    };
  });
  await a.evaluate(async (p) => { await window.__huskis.restoreNoteVersion(p.n, p.v); },
    { n: ids.N, v: (eldst || {}).id });
  await a.waitForTimeout(400);
  const etter21 = await notatDoc(a, ids.N);
  const sagt21 = await a.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  check(navn + ' 21: gjenopprettingen gjennomføres IKKE når bildet av tilstanden før feiler',
    etter21 === før21, { før: før21, etter: etter21 });
  check(navn + ' 21b: … og beskjeden sier HVORFOR, ikke bare at det feilet',
    sagt21.indexOf('ingenting ble gjenopprettet') > -1, sagt21);

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 1e — åpningsbildet, og hva «Nå» betyr med en kø som venter

   22. Er serverloggen TOM, beholdes det foreløpige dokumentet — og det
       inneholder alt brukeren rakk å skrive mens hentingen sto på.
       Åpningsbildet må derfor tas av grunnlaget frøet ble sådd fra.
   23. «Nå» for et LUKKET notat må ta med enhetens egne, usendte endringer.
       Ellers lagres serverens eldre dokument som en fersk «Nå»-versjon.
   ============================================================ */
async function runÅpningsbilde() {
  const navn = 'åpningsbilde';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);

  /* ---- 22. Loggen er tom, og brukeren rekker å skrive ----
     `&lag=800` holder hentingen åpen. Notatet er aldri sådd, så loggen er tom
     og det foreløpige dokumentet beholdes — men teksten som sto der FØR skal
     likevel finnes i historikken. */
  /* Et romsligere opphold enn ellers: her skal BÅDE dokumentet og tittelen
     rekkes endret mens frøet er foreløpig, og tittelen skrives til
     projeksjonen med en liten forsinkelse. */
  await a.goto(BASE + '/?mock=1&lag=2500');
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.evaluate((x) => window.__huskis.openNoteEditor(x), ids.N);
  await a.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  const iVinduet = await a.evaluate(() => window.__huskis.noteLiveInfo.seedPending);
  check(navn + ' 22a: frøet er foreløpig når vi begynner å skrive (forutsetningen)',
    iVinduet === true, { seedPending: iVinduet });

  // ERSTATT teksten helt, så den opprinnelige bare finnes i historikken.
  await a.evaluate(() => {
    const d = document.getElementById('note-doc');
    d.focus();
    const r = document.createRange();
    r.selectNodeContents(d);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await a.keyboard.type('HELT NY TEKST', { delay: 8 });
  // … og TITTELEN endres i det samme vinduet: åpningsbildet skal ha begge deler
  // fra samme øyeblikk, ikke gammelt dokument med ny tittel.
  await a.evaluate(() => {
    const t = document.getElementById('note-title-input');
    t.focus(); t.select();
  });
  await a.keyboard.type('HELT NY TITTEL', { delay: 8 });
  // Tittelen må FAKTISK være endret i projeksjonen før frøet avgjøres, ellers
  // måler testen ikke det den tror.
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && n.title === 'HELT NY TITTEL' && window.__huskis.noteLiveInfo.seedPending;
  }, ids.N, { timeout: 20000, polling: 50 });
  await a.waitForFunction(() => !window.__huskis.noteLiveInfo.seedPending,
    null, { timeout: 20000, polling: 50 });
  await a.waitForTimeout(500);
  /* Beviset på at loggen var tom: det FORELØPIGE dokumentet ble beholdt, med
     alt brukeren rakk å skrive. Hadde loggen hatt rader, ville økten blitt
     bygget av dem og teksten vært en annen. */
  const beholdt = await crdtTekst(a);
  check(navn + ' 22b: det foreløpige dokumentet ble beholdt — loggen var tom (forutsetningen)',
    beholdt.indexOf('HELT NY TEKST') > -1, beholdt);

  await åpneHistorikk(a, ids.N);
  const rader22 = await historikkRader(a);
  check(navn + ' 22: tilstanden FØR redigeringen finnes i historikken',
    rader22.some((r) => /OPPRINNELIG/.test(r.text) && !/HELT NY TEKST/.test(r.text)),
    rader22.map((r) => r.text));
  const bilder22 = await a.evaluate((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (d.note_versions || []).filter((v) => v.note_id === x)
      .map((v) => ({ tittel: v.title, tekst: JSON.stringify(v.doc) }));
  }, ids.N);
  const åpningen = bilder22.find((v) => v.tekst.indexOf('OPPRINNELIG') > -1
    && v.tekst.indexOf('HELT NY TEKST') === -1);
  check(navn + ' 22c: … med den opprinnelige TITTELEN, ikke den nye',
    !!åpningen && åpningen.tittel === 'Felles notat', åpningen);
  await a.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(a);
  await a.waitForTimeout(250);

  /* ---- 23. «Nå» for et lukket notat teller enhetens egen kø ----
     Uten det kunstige oppholdet fra forrige del: her er det innholdet som er
     poenget, ikke vinduet. */
  await a.goto(BASE + '/?mock=1');
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.evaluate(() => window.HK_MOCK.setOffline(true));
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' BARE PÅ ENHETEN');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(250);

  /* Nettet er tilbake, men køen kommer ikke fram: bare selve leveringen av
     rader nektes, så historikken kan hentes mens køen fortsatt venter. */
  await a.evaluate(() => {
    window.HK_MOCK.setOffline(false);
    const c = window.__huskis.client;
    const ekte = c.rpc.bind(c);
    c.rpc = function (n2, params) {
      if (n2 === 'note_crdt_push') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return ekte(n2, params);
    };
  });
  const iKøen = await a.evaluate((x) => {
    const k = Object.keys(localStorage).find((n2) => n2.indexOf('hk-note-ops:') === 0);
    return JSON.parse(localStorage.getItem(k) || '[]').filter((o) => o.note === x).length;
  }, ids.N);
  check(navn + ' 23a: raden ligger fortsatt i køen (forutsetningen)', iKøen > 0, { rader: iKøen });

  await åpneHistorikk(a, ids.N);
  const rader23 = await historikkRader(a);
  const nå23 = rader23.find((r) => r.nå) || rader23[0] || {};
  check(navn + ' 23: «Nå» er enhetens egen tilstand, ikke serverens eldre dokument',
    /BARE PÅ ENHETEN/.test(nå23.text), nå23.text);
  await a.evaluate(() => window.__huskis.closeNoteHistory());

  /* ---- 24. Tittelen ved åpning, også når loggen HAR rader ----
     Da bygges dokumentet av serverens rader — det er det autoritative — men
     tittelen skal fortsatt være den fra åpningen. */
  await a.evaluate(() => window.__hkNettTilbake && window.__hkNettTilbake());
  await a.reload();
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.evaluate(async () => { await window.__huskis.pushNoteOps(); });
  await a.waitForFunction((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (d.note_updates || []).filter((u) => u.note_id === x).length > 0;
  }, ids.N, { timeout: 20000, polling: 200 });

  // Ingen lokal kopi: enheten åpner notatet «første gang», og loggen har rader.
  await a.evaluate(() => {
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf('hk-note-crdt:') === 0 || k.indexOf('hk-note-ops:') === 0) localStorage.removeItem(k);
    });
  });
  const tittelFør24 = await a.evaluate((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n ? n.title : null;
  }, ids.N);
  await a.goto(BASE + '/?mock=1&lag=2500');
  await a.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 20000, polling: 200 });
  await a.evaluate(() => window.__huskis.setMainTab('notes'));
  await a.evaluate((x) => window.__huskis.openNoteEditor(x), ids.N);
  await a.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  const iVinduet24 = await a.evaluate(() => window.__huskis.noteLiveInfo.seedPending);
  check(navn + ' 24a: frøet er foreløpig, og loggen har rader (forutsetningen)',
    iVinduet24 === true, { seedPending: iVinduet24 });
  await a.evaluate(() => {
    const t = document.getElementById('note-title-input');
    t.focus(); t.select();
  });
  await a.keyboard.type('ENDA EN TITTEL', { delay: 8 });
  await a.waitForFunction((x) => {
    const n = window.__huskis.state.notes.find((m) => m.id === x);
    return n && n.title === 'ENDA EN TITTEL' && window.__huskis.noteLiveInfo.seedPending;
  }, ids.N, { timeout: 20000, polling: 50 });
  await a.waitForFunction(() => !window.__huskis.noteLiveInfo.seedPending,
    null, { timeout: 20000, polling: 50 });
  /* Hvert kall bruker et drøyt to og et halvt sekund her, så bildet må få tid
     til å nå fram før radene leses — ellers måler testen tomrommet. */
  await a.waitForTimeout(6000);
  const bilder24 = await a.evaluate((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (d.note_versions || []).filter((v) => v.note_id === x)
      .sort((p, q) => q.created_at - p.created_at)
      .map((v) => ({ tittel: v.title, tekst: JSON.stringify(v.doc) }));
  }, ids.N);
  check(navn + ' 24: den nye tittelen blir ikke en del av åpningsbildet',
    !bilder24.some((v) => v.tittel === 'ENDA EN TITTEL'),
    bilder24.slice(0, 3));
  check(navn + ' 24b: … og den ferskeste raden bærer tittelen fra åpningen',
    !!bilder24.length && bilder24[0].tittel === tittelFør24,
    { nå: bilder24[0] && bilder24[0].tittel, ved_åpning: tittelFør24 });
  await lukkEditor(a);

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 2 — flere brukere og flere faner
   ============================================================ */
async function runFlere() {
  const navn = 'flerbruker';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);
  const b = await ctx.newPage();
  b.on('pageerror', (e) => feil.push('B: ' + e.message));
  await loadAs(b, db, 'uB', 'b@x.no', false);

  await åpneEditor(a, ids.N);
  await åpneEditor(b, ids.N);
  await a.waitForTimeout(150);

  // A skriver, B ser det, og begge har nå et felles utgangspunkt.
  await skrivSlutt(a, ' FRA A');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await b.evaluate(async () => { await window.__huskis.noteLivePull(); });
  await b.waitForTimeout(200);
  check(navn + ' 8a: B ser det A skrev (forutsetningen)',
    (await crdtTekst(b)) === 'OPPRINNELIG FRA A', await crdtTekst(b));

  // B lagrer et bilde av DENNE tilstanden, og A skriver videre.
  await b.evaluate((x) => window.__huskis.captureNoteVersion(x, {}), ids.N);
  await b.waitForTimeout(200);
  await skrivSlutt(a, ' OG MER');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await b.evaluate(async () => { await window.__huskis.noteLivePull(); });
  await b.waitForTimeout(200);

  // B gjenoppretter bildet MENS A skriver et sted til.
  await skrivSlutt(a, '!');
  await a.evaluate(() => { window.__huskis.noteLiveFlush(); });
  const versjonId = await b.evaluate((x) => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const rows = (db.note_versions || []).filter((v) => v.note_id === x)
      .sort((m, n) => m.created_at - n.created_at);
    return rows[rows.length - 1].id;
  }, ids.N);
  await b.evaluate(({ n, v }) => window.__huskis.restoreNoteVersion(n, v), { n: ids.N, v: versjonId });
  await b.waitForTimeout(400);

  // Én full runde begge veier.
  for (let i = 0; i < 3; i++) {
    await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
    await b.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
    await a.evaluate(async () => { await window.__huskis.noteLivePull(); });
    await b.evaluate(async () => { await window.__huskis.noteLivePull(); });
    await a.waitForTimeout(120); await b.waitForTimeout(120);
  }
  const enige = { a: await crdtTekst(a), b: await crdtTekst(b) };
  check(navn + ' 8: begge ender på nøyaktig den SAMME teksten etter gjenopprettingen',
    enige.a === enige.b, enige);
  check(navn + ' 8b: … og gjenopprettingen har faktisk tatt bort det som kom etter bildet',
    enige.a.indexOf('OG MER') === -1, enige);
  check(navn + ' 8c: … uten at A sitt tegn forsvant i stillhet (ingen tapt CRDT-endring)',
    enige.a.indexOf('!') > -1, enige);

  await lukkEditor(a);
  await lukkEditor(b);

  // ---- 9. Ren leser ----
  const c = await ctx.newPage();
  c.on('pageerror', (e) => feil.push('C: ' + e.message));
  await loadAs(c, db, 'uC', 'c@x.no', false);
  // Eieren gir det låste notatet en historikk å bla i.
  await åpneEditor(a, ids.NR);
  await skrivSlutt(a, ' MER');
  await lukkEditor(a);
  await a.waitForTimeout(300);

  await åpneHistorikk(c, ids.NR);
  const lesersyn = await c.evaluate(() => ({
    status: window.__huskis.noteHistoryInfo.status,
    rader: document.querySelectorAll('.note-history-row').length,
    lagreKnapp: !document.getElementById('note-history-snapshot').hidden,
  }));
  check(navn + ' 9: en ren leser KAN bla i historikken',
    lesersyn.status === 'ok' && lesersyn.rader > 0, lesersyn);
  check(navn + ' 9b: … men får ingen «Lagre versjon nå»', lesersyn.lagreKnapp === false, lesersyn);
  await åpneRad(c, 0);
  const leserKnapper = await c.evaluate(() => ({
    gjenopprett: !!document.querySelector('.note-history-restore'),
    behold: !!document.querySelector('.note-history-keep'),
    tekst: document.querySelector('.note-history-doc').innerText.trim(),
  }));
  check(navn + ' 9c: … og verken «Gjenopprett» eller «Behold denne» i den åpne raden',
    leserKnapper.gjenopprett === false && leserKnapper.behold === false, leserKnapper);
  check(navn + ' 9d: … men innholdet kan leses', leserKnapper.tekst.length > 0, leserKnapper.tekst);
  const serverNei = await c.evaluate(async (x) => {
    const res = await window.__huskis.client.rpc('note_version_save', {
      p_note: x, p_id: '00000000-0000-4000-8000-000000000001', p_title: 'X',
      p_doc: { v: 1, blocks: [] }, p_excerpt: '', p_chars: 0, p_pinned: false,
    });
    return res && res.error ? res.error.message : 'INGEN FEIL';
  }, ids.NR);
  check(navn + ' 9e: … og serveren sier nei på den direkte veien også',
    /skriverett/i.test(serverNei), serverNei);

  // ---- 10. Tilbakekalt tilgang lukker historikken ----
  await a.evaluate(async (x) => {
    await window.__huskis.client.rpc('revoke_share',
      { p_type: 'note', p_id: x, p_user: 'uC' });
  }, ids.NR);
  await sync(c);
  const etterTilbakekall = await c.evaluate(() => ({
    åpen: window.__huskis.noteHistoryInfo.open,
    serNotatet: window.__huskis.state.notes.length,
  }));
  check(navn + ' 10: tilbakekalt tilgang lukker historikken',
    etterTilbakekall.åpen === false, etterTilbakekall);

  // ---- 11. Uten nett ----
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' OFFLINE-TEKST');
  const førOffline = (await versjoner(a, ids.N)).length;
  await a.evaluate(() => window.HK_MOCK.setOffline(true));
  const utfall = await a.evaluate((x) => window.__huskis.captureNoteVersion(x, {}), ids.N);
  await a.waitForTimeout(200);
  check(navn + ' 11: uten nett skrives det ingen bilder — og ingenting kaster',
    utfall === null && (await versjoner(a, ids.N)).length === førOffline,
    { før: førOffline, etter: (await versjoner(a, ids.N)).length });
  await a.evaluate((x) => window.__huskis.openNoteHistory(x), ids.N);
  await a.waitForFunction(() => window.__huskis.noteHistoryInfo.status === 'offline',
    null, { timeout: 8000, polling: 100 });
  const offlineTekst = await a.evaluate(() => document.getElementById('note-history-note').textContent);
  check(navn + ' 11b: … og modalen sier hvor historikken bor',
    /nett/i.test(offlineTekst), offlineTekst);
  await a.evaluate(() => window.__huskis.closeNoteHistory());
  await a.evaluate(() => window.HK_MOCK.setOffline(false));
  await a.evaluate((x) => window.__huskis.captureNoteVersion(x, {}), ids.N);
  await a.waitForTimeout(300);
  const etterNett = await versjoner(a, ids.N);
  check(navn + ' 11c: … og bildet tas så snart nettet er tilbake',
    etterNett.length === førOffline + 1
    && etterNett[etterNett.length - 1].excerpt.indexOf('OFFLINE-TEKST') > -1, etterNett.slice(-1));

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runUtdatert();
  await runUtenLagring();
  await runAvklart();
  await runÅpningsbilde();
  await runFlere();
  console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
