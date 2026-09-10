/*
  Nettlesertest for SANNTIDS SAMSKRIVING I SAMME NOTAT
  (docs/notater-plan.md → «Sanntids samskriving») — mot mock-backenden
  (?mock=1), med FLERE KLIENTER: én kontekst deler mock-«serveren»
  (localStorage), og hver fane har sin egen sesjon (sessionStorage). To faner
  er derfor to brukere mot den samme databasen, slik de andre
  flerbrukertestene gjør det.

  Dekker:

     1. To med skriverett har det samme notatet åpent samtidig
     2. Samtidige innsettinger på ULIKE steder — begge overlever, i riktig
        rekkefølge
     3. Overlappende redigering i det SAMME avsnittet — ingen av tegnene
        forsvinner, og det er ikke last-write-wins på dokumentet
     4. Endringen vises hos den andre UTEN reload
     5. Formatering samtidig med en tekstendring
     6. Kort nettbrudd + reconnect: den som var borte mister ingenting, og
        overskriver ikke den andres arbeid
     7. Lagringsstatusen er ærlig: den sier ikke «Lagret» mens køen står
     8. Angre tar MINE endringer tilbake, ikke den andres
     9. En REN LESER får live-oppdateringene, men kan ikke skrive — verken i
        editoren eller forbi den, rett mot serveren
    10. Tilgangen trekkes tilbake mens editoren står åpen: bildet lukkes, og
        verken køen eller den lokale kopien av innholdet blir liggende igjen
    11. Notatet slettes fra en annen klient: det samme, konsistent med
        livssyklusreglene
    12. Et notat fra FØR denne runden (bare `body`, ingen logg) åpnes uten tap
        — også når to klienter sår CRDT-en i samme øyeblikk: frøet er
        deterministisk, så teksten blir stående ÉN gang
    13. Loggen klappes sammen uten å miste et tegn
    14. «Andre redigerer nå» vises når det faktisk skjer

  Kjøres på BÅDE desktop- og mobil-viewport: editoren er pekeravhengig, og
  verktøylinjen bryter annerledes på en telefon.

  Kjør (fra repo-roten, med `python3 -m http.server 8000` i egen terminal):
    NODE_PATH=$(npm root -g) node tests/notes-collab.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur:
     A eier bokhyllen P. B er MEDLEM av P — altså redaktør, siden bokhyllen er
     åpen. N er det frie notatet de to skriver i sammen.
     NR er et LÅST notat der C har en direkte rolle: låsen er det som lager en
     ren leser (docs/rettigheter-og-deling.md del 14).
     NG er et notat «fra før»: det har `body`, men ingen rad i loggen — slik
     hvert eneste eksisterende notat ser ut den dagen denne runden ruller ut. */
function buildDB() {
  const P = U(), N = U(), NR = U(), NG = U();
  const base = (x) => Object.assign({
    trashed: false, archived: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const mem = (user, on, role) => Object.assign({
    id: U(), user_id: user,
    universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: null,
    role, pos: 0, created_at: 1,
  }, on);
  const doc = (s) => ({ v: 1, blocks: [{ t: 'p', c: [{ s }] }] });
  return {
    ids: { uA: 'uA', uB: 'uB', uC: 'uC', P, N, NR, NG },
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
          title: 'Felles notat', body: doc('MIDT') }),
        base({ id: NR, owner_id: 'uA', project_id: P, folder_id: null, locked: true,
          title: 'Kun lesing', body: doc('Leses'), pos: 1 }),
        base({ id: NG, owner_id: 'uA', project_id: P, folder_id: null,
          title: 'Gammelt notat', body: doc('Skrevet før samskrivingen'), pos: 2 }),
      ],
      object_links: [],
      memberships: [
        mem('uA', { note_project_id: P }, 'owner'),
        mem('uB', { note_project_id: P }, 'member'),
        mem('uC', { note_id: NR }, 'member'),
      ],
      share_invites: [], tombstones: [], note_updates: [], note_mark: 1,
      /* Øktbordet må være med i fiksturen: uten `auth_sessions` finner ikke
         mocken raden for fanens egen økt, og appen leser det som en
         FJERN-UTLOGGING og logger seg selv ut midt i testen. */
      auth_sessions: [], device_sessions: [],
      notifications: [], notification_prefs: [],
      push_subscriptions: [], push_deliveries: [], native_notif_devices: [],
    },
  };
}

/* `seed` er sant BARE for den første fanen. `localStorage` er delt mellom
   fanene i konteksten — det er nettopp dét som gjør dem til to klienter mot
   den samme «serveren» — så en `clear()` fra fane nummer to ville revet vekk
   øktbordet under den første, og appen der ville logget seg selv ut. */
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

const åpne = async (p, id) => {
  await p.evaluate((x) => window.__huskis.openNoteEditor(x), id);
  await p.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  await p.waitForTimeout(120);
};
const lukk = async (p) => {
  await p.evaluate(() => window.__huskis.closeNoteEditor());
  await p.waitForTimeout(150);
};

/* Én runde av samskrivingen, drevet EKSPLISITT i stedet for å vente ut
   debouncene: les DOM-et inn i CRDT-en, send køen, hent inn det andre har
   sendt. To omganger, slik at det den ene sender i første omgang er inne hos
   den andre før runden er over. */
async function slipp(p) {
  await p.evaluate(async () => {
    const H = window.__huskis;
    H.noteLiveFlush();
    await H.pushNoteOps();
  });
}
async function hent(p) {
  await p.evaluate(async () => { await window.__huskis.noteLivePull(); });
}
async function runde(a, b) {
  for (let i = 0; i < 2; i++) {
    await slipp(a); await slipp(b);
    await hent(a); await hent(b);
    await a.waitForTimeout(60); await b.waitForTimeout(60);
  }
}

/* Skriv i EDITOREN, med markøren satt der teksten skal inn. Ekte tastetrykk —
   det er nettopp `contenteditable`-veien inn i modellen som skal testes. */
async function skrivVed(p, blokk, offset, tekst) {
  await p.evaluate(({ b, o }) => {
    const doc = document.getElementById('note-doc');
    const el = doc.children[b];
    if (!el) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = walker.nextNode(), igjen = o;
    while (n && igjen > n.nodeValue.length) { igjen -= n.nodeValue.length; n = walker.nextNode(); }
    const r = document.createRange();
    if (n) r.setStart(n, Math.min(igjen, n.nodeValue.length));
    else r.setStart(el, 0);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    doc.focus();
  }, { b: blokk, o: offset });
  await p.keyboard.type(tekst, { delay: 8 });
}
// Markér et område i en blokk (for formatering).
async function markerIBlokk(p, blokk, fra, til) {
  await p.evaluate(({ b, f, t }) => {
    const doc = document.getElementById('note-doc');
    const el = doc.children[b];
    const n = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    if (!n) return;
    const r = document.createRange();
    r.setStart(n, Math.min(f, n.nodeValue.length));
    r.setEnd(n, Math.min(t, n.nodeValue.length));
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    doc.focus();
  }, { b: blokk, f: fra, t: til });
  await p.waitForTimeout(60);
}

const crdtTekst = (p) => p.evaluate(() => window.__huskis.noteLiveInfo.text);
const arkTekst = (p) => p.evaluate(() => document.getElementById('note-doc').innerText);
const info = (p) => p.evaluate(() => window.__huskis.noteLiveInfo);
const status = (p) => p.evaluate(() => document.getElementById('note-save-status').textContent);
const loggRader = (p, id) => p.evaluate((x) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db'));
  return (db.note_updates || []).filter((u) => u.note_id === x).length;
}, id);

async function sync(p, pred) {
  for (let i = 0; i < 20; i++) {
    await p.evaluate(() => window.__huskis.cloudCycle());
    await p.waitForTimeout(250);
    if (!pred) return true;
    if (await p.evaluate(pred)) return true;
  }
  return false;
}

async function run(label, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport }, touch ? { isMobile: true, hasTouch: true } : {}));
  const errs = [];
  const { ids, db } = buildDB();

  const A = await ctx.newPage();
  A.on('pageerror', (e) => errs.push('A: ' + e.message));
  await loadAs(A, db, ids.uA, 'a@x.no', true);
  const B = await ctx.newPage();
  B.on('pageerror', (e) => errs.push('B: ' + e.message));
  await loadAs(B, db, ids.uB, 'b@x.no');

  /* ---------- 1. Begge har det samme notatet åpent ---------- */
  await åpne(A, ids.N);
  await åpne(B, ids.N);
  await runde(A, B);
  const åpent = {
    a: await p1(A), b: await p1(B),
  };
  async function p1(p) {
    return p.evaluate(() => ({
      åpen: !document.getElementById('note-editor').hidden,
      skrivbar: document.getElementById('note-doc').contentEditable === 'true',
      verktøy: !document.getElementById('note-tools').hidden,
      tekst: document.getElementById('note-doc').innerText.trim(),
    }));
  }
  log(label + ' 1: begge med skriverett har notatet åpent og skrivbart',
    åpent.a.åpen && åpent.a.skrivbar && åpent.a.verktøy
    && åpent.b.åpen && åpent.b.skrivbar && åpent.b.verktøy
    && åpent.a.tekst === 'MIDT' && åpent.b.tekst === 'MIDT',
    JSON.stringify(åpent));

  /* ---------- 2. Samtidige innsettinger på ULIKE steder ----------
     A skriver FORAN, B skriver BAK — uten at noen av dem har sett den andre
     ennå. Det er nettopp dét felt-LWW ikke kan: der ville den ene skrivingen
     vunnet hele dokumentet. */
  await skrivVed(A, 0, 0, 'FOR ');
  await skrivVed(B, 0, 4, ' BAK');
  await runde(A, B);
  const iA = await info(A), iB = await info(B);
  const ulike = { a: iA.text, b: iB.text, ark: await arkTekst(B),
    // Evidens når det ryker: står det rader igjen i køen, eller kom de fram?
    køA: iA.ops, køB: iB.ops, raderA: iA.rows, raderB: iB.rows,
    markA: iA.mark, markB: iB.mark, iLoggen: await loggRader(A, ids.N) };
  log(label + ' 2: samtidige innsettinger på ulike steder overlever begge',
    ulike.a === 'FOR MIDT BAK' && ulike.b === 'FOR MIDT BAK',
    JSON.stringify(ulike));
  log(label + ' 3: endringen vises hos den andre uten reload',
    ulike.ark.trim() === 'FOR MIDT BAK', JSON.stringify(ulike.ark));

  /* ---------- 3. Overlappende redigering i SAMME avsnitt ---------- */
  await skrivVed(A, 0, 3, 'A');     // «FORA MIDT BAK»
  await skrivVed(B, 0, 8, 'B');     // «FOR MIDTB BAK»
  await runde(A, B);
  const overlapp = { a: await crdtTekst(A), b: await crdtTekst(B) };
  const beggeTegn = (t) => /A/.test(t.slice(0, 5)) && t.indexOf('B ') > -1;
  log(label + ' 4: overlappende redigering flettes — ingen av tegnene forsvinner',
    overlapp.a === overlapp.b && beggeTegn(overlapp.a)
    && overlapp.a.replace(/[^A-Z ]/g, '').indexOf('FOR') === 0
    && /MIDT/.test(overlapp.a) && /BAK/.test(overlapp.a),
    JSON.stringify(overlapp));

  /* ---------- 4. Formatering samtidig med en tekstendring ---------- */
  await markerIBlokk(A, 0, 0, 4);
  await A.evaluate(() => window.__huskis.runNoteCommand('bold'));
  await skrivVed(B, 0, (await crdtTekst(B)).length, ' HALE');
  await runde(A, B);
  // Markeringen leses ut av CRDT-en, ikke av projeksjonen: `body` skrives
  // først av autosaven, og påstanden her gjelder samskrivingen.
  const fmt = await B.evaluate(() => {
    const info = window.__huskis.noteLiveInfo;
    return { fet: JSON.stringify(info.doc.blocks[0].c.filter((r) => r.b).map((r) => r.s)),
      tekst: info.text };
  });
  const fmtA = await A.evaluate(() => {
    const info = window.__huskis.noteLiveInfo;
    return { fetA: JSON.stringify(info.doc.blocks[0].c.filter((r) => r.b).map((r) => r.s)),
      køA: info.ops, raderA: info.rows,
      domA: document.getElementById('note-doc').querySelectorAll('b, strong').length };
  });
  Object.assign(fmt, fmtA);
  log(label + ' 5: formatering og tekstendring samtidig — begge blir stående',
    /FOR/.test(fmt.fet) && /HALE/.test(fmt.tekst) && (await crdtTekst(A)) === fmt.tekst,
    JSON.stringify(fmt));

  /* ---------- 5. Kort nettbrudd + reconnect ----------
     B mister nettet, skriver videre, og kommer tilbake. A skriver hele tiden.
     Ingen av dem skal overskrive den andre — og B skal ikke ha mistet noe. */
  const førBrudd = await crdtTekst(A);
  await B.evaluate(() => window.HK_MOCK.setOffline(true));
  await skrivVed(B, 0, 0, 'OFFLINE ');
  await slipp(B);                                   // køen blir stående
  await skrivVed(A, 0, førBrudd.length, ' NETT');
  await slipp(A);
  const iBruddet = { køB: (await info(B)).ops, statusB: await status(B), aTekst: await crdtTekst(A) };
  log(label + ' 6: en kø som ikke kommer fram blir stående, og statusen sier fra',
    iBruddet.køB > 0 && /enheten/i.test(iBruddet.statusB), JSON.stringify(iBruddet));
  log(label + ' 7: den andre skriver videre uten å bli hindret',
    / NETT$/.test(iBruddet.aTekst), JSON.stringify(iBruddet.aTekst));

  await B.evaluate(() => window.HK_MOCK.setOffline(false));
  await runde(A, B);
  await runde(A, B);
  const iA2 = await info(A), iB2 = await info(B);
  const etterBrudd = { a: iA2.text, b: iB2.text, køB: iB2.ops, køA: iA2.ops,
    raderA: iA2.rows, raderB: iB2.rows, markA: iA2.mark, markB: iB2.mark,
    iLoggen: await loggRader(A, ids.N) };
  log(label + ' 8: reconnect fletter begge veier — ingen stille datatap',
    etterBrudd.a === etterBrudd.b && /^OFFLINE /.test(etterBrudd.a)
    && / NETT/.test(etterBrudd.a) && /MIDT/.test(etterBrudd.a) && etterBrudd.køB === 0,
    JSON.stringify(etterBrudd));
  await B.evaluate(() => window.__huskis.flushNoteSave());
  await B.waitForTimeout(200);
  log(label + ' 9: statusen sier «Lagret» først når køen faktisk er tom',
    /Lagret$/.test((await status(B)) || 'Lagret'), JSON.stringify(await status(B)));

  /* ---------- 6. «Andre redigerer nå» ---------- */
  const chip = await A.evaluate(() => {
    const el = document.getElementById('note-live');
    return { finnes: !!el, synlig: el ? !el.hidden : false,
      navn: el ? (el.textContent || '').trim() : '' };
  });
  log(label + ' 10: «Andre redigerer nå» vises når det faktisk skjer, uten å navngi noen',
    chip.finnes && chip.synlig && !/Bo|Medlem|b@x/.test(chip.navn), JSON.stringify(chip));

  /* ---------- 7. Angre tar MINE endringer, ikke den andres ---------- */
  const førAngre = await crdtTekst(A);
  await skrivVed(A, 0, førAngre.length, ' MIN');
  await A.evaluate(() => window.__huskis.noteLiveFlush());
  await skrivVed(B, 0, 0, 'DIN ');
  await runde(A, B);
  await A.evaluate(() => window.__huskis.runNoteCommand('undo'));
  await A.waitForTimeout(250);
  await runde(A, B);
  await runde(A, B);
  const angret = { a: await crdtTekst(A), b: await crdtTekst(B) };
  log(label + ' 11: angre tar MIN endring tilbake og lar den andres stå',
    !/ MIN/.test(angret.a) && /^DIN /.test(angret.a) && angret.a === angret.b,
    JSON.stringify(angret));

  /* ---------- 8. Loggen klappes sammen uten tap ---------- */
  const førKomp = await crdtTekst(A);
  const raderFør = await loggRader(A, ids.N);
  // Tving en komprimering nå: øktens egen terskel er 30 rader.
  await A.evaluate(async () => { await window.__huskis.noteLiveCompactNow(); });
  await A.waitForTimeout(200);
  await runde(A, B);
  const etterKomp = { rader: await loggRader(A, ids.N), a: await crdtTekst(A), b: await crdtTekst(B) };
  log(label + ' 12: komprimering korter ned loggen uten å miste et tegn',
    etterKomp.rader < raderFør && etterKomp.a === førKomp && etterKomp.b === førKomp,
    JSON.stringify({ raderFør, etterKomp }));

  // En NY klient som laster notatet etter komprimeringen skal få alt.
  const nyKlient = await ctx.newPage();
  nyKlient.on('pageerror', (e) => errs.push('N: ' + e.message));
  await loadAs(nyKlient, db, ids.uB, 'b@x.no');
  await åpne(nyKlient, ids.N);
  await hent(nyKlient);
  await nyKlient.waitForTimeout(200);
  const frisk = await crdtTekst(nyKlient);
  log(label + ' 13: en klient som åpner notatet etter komprimeringen får hele teksten',
    frisk === førKomp, JSON.stringify({ frisk, førKomp }));
  await nyKlient.close();

  /* ---------- 9. Ren leser ---------- */
  const C = await ctx.newPage();
  C.on('pageerror', (e) => errs.push('C: ' + e.message));
  await loadAs(C, db, ids.uC, 'c@x.no');
  await åpne(C, ids.NR);
  await lukk(A);
  await åpne(A, ids.NR);
  await runde(A, C);
  const leserFør = await C.evaluate(() => ({
    skrivbar: document.getElementById('note-doc').contentEditable === 'true',
    verktøy: !document.getElementById('note-tools').hidden,
    tekst: document.getElementById('note-doc').innerText.trim(),
  }));
  log(label + ' 14: en ren leser får notatet skrivebeskyttet, uten verktøylinje',
    !leserFør.skrivbar && !leserFør.verktøy && leserFør.tekst === 'Leses',
    JSON.stringify(leserFør));

  await skrivVed(A, 0, 5, ' videre');
  await runde(A, C);
  const leserEtter = await C.evaluate(() => document.getElementById('note-doc').innerText.trim());
  log(label + ' 15: leseren får live-oppdateringene uten reload',
    leserEtter === 'Leses videre', JSON.stringify(leserEtter));

  const leserSkriv = await C.evaluate(async (id) => {
    const c = window.__huskis.client;
    const res = await c.rpc('note_crdt_push', { p_note: id, p_updates: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', u: 'AAAA' }] });
    return { feil: res && res.error ? String(res.error.message || '') : '' };
  }, ids.NR);
  const raderNR = await loggRader(C, ids.NR);
  log(label + ' 16: leseren kommer ikke forbi editoren heller — serveren sier nei',
    /skriverett/i.test(leserSkriv.feil), JSON.stringify(leserSkriv));
  await C.close();

  /* ---------- 10. Tilgangen trekkes tilbake mens editoren står åpen ---------- */
  await lukk(A);
  await åpne(A, ids.N);
  await åpne(B, ids.N);
  await skrivVed(B, 0, 0, 'SISTE ');
  await B.evaluate(() => window.__huskis.noteLiveFlush());
  await B.evaluate(() => window.HK_MOCK.setOffline(true));   // køen rekker ikke fram
  await B.waitForTimeout(50);
  await A.evaluate(async ({ p, b }) => {
    await window.__huskis.client.rpc('revoke_share', { p_type: 'note_project', p_id: p, p_user: b });
  }, { p: ids.P, b: ids.uB });
  await B.evaluate(() => window.HK_MOCK.setOffline(false));
  const lukket = await sync(B, () => document.getElementById('note-editor').hidden);
  const sporB = await B.evaluate((id) => {
    const uid = window.__huskis.authUser.id;
    const ops = JSON.parse(localStorage.getItem('hk-note-ops:' + uid) || '[]');
    const snap = JSON.parse(localStorage.getItem('hk-note-crdt:' + uid) || '{}');
    return {
      editorÅpen: !document.getElementById('note-editor').hidden,
      opsForNotatet: ops.filter((o) => o.note === id).length,
      kopi: !!snap[id],
      serNotatet: window.__huskis.state.notes.some((n) => n.id === id),
    };
  }, ids.N);
  log(label + ' 17: mistet tilgang lukker editoren og etterlater ingen spor på enheten',
    lukket && !sporB.editorÅpen && sporB.opsForNotatet === 0 && !sporB.kopi && !sporB.serNotatet,
    JSON.stringify(sporB));

  /* ---------- 11. Notatet slettes fra en annen klient ---------- */
  await lukk(A);
  await åpne(A, ids.NG);
  await A.evaluate((id) => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    db2.notes = db2.notes.filter((n) => n.id !== id);
    db2.note_updates = (db2.note_updates || []).filter((u) => u.note_id !== id);
    db2.tombstones.push({ id: 'tg-' + id, resource_type: 'note', resource_id: id, deleted_at: Date.now() });
    localStorage.setItem('hk-mock-db', JSON.stringify(db2));
  }, ids.NG);
  const lukket2 = await sync(A, () => document.getElementById('note-editor').hidden);
  const sporA = await A.evaluate((id) => {
    const uid = window.__huskis.authUser.id;
    const snap = JSON.parse(localStorage.getItem('hk-note-crdt:' + uid) || '{}');
    const ops = JSON.parse(localStorage.getItem('hk-note-ops:' + uid) || '[]');
    return { kopi: !!snap[id], ops: ops.filter((o) => o.note === id).length };
  }, ids.NG);
  log(label + ' 18: et slettet notat lukker editoren og ryddes bort lokalt',
    lukket2 && !sporA.kopi && sporA.ops === 0, JSON.stringify(sporA));

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

/* Et notat fra FØR denne runden: bare `body`, ingen rad i loggen. To klienter
   åpner det i samme øyeblikk, hver på sin side av nettet, og sår CRDT-en. Frøet
   er deterministisk, så de to frøene er den SAMME operasjonen — teksten skal bli
   stående én gang, ikke to. Egen runde med sin egen database, slik at «ingen
   rader i loggen» er sant når begge åpner. */
async function migreringsløp(label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  const { ids, db } = buildDB();
  const A = await ctx.newPage();
  A.on('pageerror', (e) => errs.push('A: ' + e.message));
  const B = await ctx.newPage();
  B.on('pageerror', (e) => errs.push('B: ' + e.message));
  await loadAs(A, db, ids.uA, 'a@x.no', true);
  await loadAs(B, db, ids.uB, 'b@x.no');

  const rader0 = await loggRader(A, ids.NG);
  // Begge går offline FØR de åpner, så ingen av dem kan se den andres frø.
  await A.evaluate(() => window.HK_MOCK.setOffline(true));
  await B.evaluate(() => window.HK_MOCK.setOffline(true));
  await åpne(A, ids.NG);
  await åpne(B, ids.NG);
  const åpnet = { a: await arkTekst(A), b: await arkTekst(B) };
  log(label + ' 19: et notat fra før denne runden åpnes uten tap',
    rader0 === 0 && åpnet.a.trim() === 'Skrevet før samskrivingen'
    && åpnet.b.trim() === 'Skrevet før samskrivingen',
    JSON.stringify({ rader0, åpnet }));

  await skrivVed(A, 0, 0, 'A: ');
  await skrivVed(B, 0, (await crdtTekst(B)).length, ' (B)');
  await A.evaluate(() => window.HK_MOCK.setOffline(false));
  await B.evaluate(() => window.HK_MOCK.setOffline(false));
  await runde(A, B);
  await runde(A, B);
  const etter = { a: await crdtTekst(A), b: await crdtTekst(B) };
  const enGang = (etter.a.match(/Skrevet før samskrivingen/g) || []).length;
  log(label + ' 20: to samtidige frø gir ÉN tekst, ikke to (deterministisk frø)',
    enGang === 1 && etter.a === etter.b && /^A: /.test(etter.a) && / \(B\)$/.test(etter.a),
    JSON.stringify({ enGang, etter }));

  // …og notatet er fortsatt redigerbart etterpå.
  await skrivVed(A, 0, (await crdtTekst(A)).length, '!');
  await runde(A, B);
  const videre = { a: await crdtTekst(A), b: await crdtTekst(B) };
  log(label + ' 21: notatet kan redigeres videre av begge etter migreringen',
    videre.a === videre.b && /!$/.test(videre.b), JSON.stringify(videre));

  log(label + ' (migrering): ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await migreringsløp('migrering');
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
