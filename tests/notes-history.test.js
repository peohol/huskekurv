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
  await runFlere();
  console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
