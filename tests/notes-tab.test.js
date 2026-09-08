/*
  Nettlesertest for NOTATER — Huskis' andre hoveddel (docs/notater-plan.md),
  mot mock-backend (?mock=1).

  Dekker:
    1. Hovedfanene: `Lister | Notater` ligger over toppkontrollene, fanevalget
       huskes på enheten, og toppkontrollene finnes i BEGGE fanene
    2. Lister-fanen er funksjonelt uendret (ingen regresjon): kort, rader og
       nav-modalen står som før når man kommer tilbake
    3. Prosjekt > Mappe > Notat: oppretting og omdøping fra notat-navigasjonen,
       og at frie notater ligger rett i prosjektet
    4. «＋ Notat» oppretter notatet OG åpner editoren med det samme
    5. Editoren: tittel, overskrifter, fet/kursiv/understrek, hevet/senket,
       punkt- og nummerliste, skillelinje, lenke, spesialtegn, angre/gjør om
       — og at dokumentet leses tilbake til den strukturerte modellen
    6. Autosave: ingen Lagre-knapp, «Lagrer …» → «Lagret»
    7. Tilbakeknappen fører tilbake til riktig fane, prosjekt/mappe og
       scrollposisjon
    8. Notatkortet: tittel, utdrag og «sist endret»
    9. Reload: innhold og struktur er intakt, og fanen er den samme
   10. Synk: radene ligger i mock-databasen med riktig forelder, og en endring
       fra «en annen enhet» flettes inn
   11. DnD: notatkort omrokeres, og rekkefølgen persisteres
   12. Tastatur: Alt+piler flytter et notatkort
   13. Dokumentmodellen: `javascript:`-lenker slipper aldri gjennom, og
       rendringen bygger noder (ingen markup fra innhold)

  Kjøres på BÅDE desktop- og mobil-viewport der oppførselen avhenger av layout.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-tab.test.js
*/
const path = require('path');
const { chromium } = require(path.join(process.env.NODE_PATH ||
  require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { dragFromTo } = require('./dnd-gestures');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Én liste med ett listepunkt, så Lister-fanen har noe å bevise at den
   fortsatt rendrer. Notattabellene starter tomme — testen bygger dem. */
function buildDB() {
  const uid = 'u1';
  const UA = U(), GA = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  return {
    uid,
    db: {
      _rolesBackfilled: true,
      profiles: [{ id: uid, email: 'a@x.no', display_name: 'Alice', user_metadata: {} }],
      passwords: { 'a@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uid, name: 'Området' })],
      groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Mappa' })],
      cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Lista', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: IA, owner_id: uid, card_id: LA, text: 'Et listepunkt' })],
      ideas: [], note_projects: [], note_folders: [], notes: [],
      memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

const klar = (p) => p.waitForFunction(() => {
  const H = window.__huskis;
  return H && H.authUser && H.lastMy && H.state.universes.length > 0;
}, null, { timeout: 20000, polling: 200 });

async function seed(p, db, uid) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'a@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await klar(p);
  // Demonstrasjonen og gest-tipsene ville ellers stått i veien (tests/CLAUDE.md).
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForFunction(() => document.getElementById('tour').hidden, null, { timeout: 5000, polling: 100 });
}

const editorÅpen = (p) => p.waitForFunction(() => !document.getElementById('note-editor').hidden,
  null, { timeout: 5000, polling: 50 });
const editorLukket = (p) => p.waitForFunction(() => document.getElementById('note-editor').hidden,
  null, { timeout: 5000, polling: 50 });

async function run(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const { db, uid } = buildDB();
  await seed(p, db, uid);

  /* ---------- 1. Hovedfanene ---------- */
  const faner = await p.evaluate(() => {
    const tabs = document.getElementById('main-tabs');
    const bar = document.getElementById('topbar').getBoundingClientRect();
    const t = tabs.getBoundingClientRect();
    const rad = document.getElementById('topbar-row-lists').getBoundingClientRect();
    return {
      antall: tabs.querySelectorAll('.main-tab').length,
      rolle: tabs.getAttribute('role'),
      øverst: Math.round(t.top) <= Math.round(rad.top),
      iPanelet: t.top >= bar.top && t.bottom <= bar.bottom,
      hjørne: !!document.getElementById('corner-controls') &&
        !document.getElementById('corner-controls').hidden,
    };
  });
  log(navn + ': to hovedfaner øverst i visningsområdet, over kontrollraden',
    faner.antall === 2 && faner.rolle === 'tablist' && faner.øverst && faner.iPanelet,
    JSON.stringify(faner));
  log(navn + ': toppkontrollene er felles og synlige i listefanen', faner.hjørne);

  await p.click('#tab-notes');
  const iNotater = await p.evaluate(() => ({
    tab: window.__huskis.mainTab,
    listerSkjult: document.getElementById('board').hidden,
    notaterSynlig: !document.getElementById('notes-board').hidden,
    radLister: document.getElementById('topbar-row-lists').hidden,
    radNotater: !document.getElementById('topbar-row-notes').hidden,
    hjørne: !document.getElementById('corner-controls').hidden,
    valgt: document.getElementById('tab-notes').getAttribute('aria-selected'),
  }));
  log(navn + ': Notater-fanen bytter flate, rad og markering',
    iNotater.tab === 'notes' && iNotater.listerSkjult && iNotater.notaterSynlig &&
    iNotater.radLister && iNotater.radNotater && iNotater.valgt === 'true',
    JSON.stringify(iNotater));
  log(navn + ': toppkontrollene er de samme i notatfanen (ikke duplisert per fane)',
    iNotater.hjørne);

  /* ---------- 3. Prosjekt > Mappe > Notat ---------- */
  // Navngivingen på plassen: ＋ Prosjekt lager kortet og åpner navnefeltet.
  await p.click('#notes-crumb');
  await p.waitForSelector('#notes-nav-board .notes-add-project button', { timeout: 5000 });
  await p.click('.notes-add-project button');
  const navnefelt = await p.evaluate(() => {
    const el = document.querySelector('#notes-nav-board .card .edit-input');
    return el ? { finnes: true, fokus: document.activeElement === el } : { finnes: false };
  });
  log(navn + ': «＋ Prosjekt» lager prosjektet og åpner navnefeltet på det',
    navnefelt.finnes && navnefelt.fokus, JSON.stringify(navnefelt));
  await p.keyboard.type('Forskning');
  await p.keyboard.press('Enter');
  const prosjekt = await p.evaluate(() => window.__huskis.state.noteProjects.map((x) => x.name));
  log(navn + ': prosjektet fikk navnet', prosjekt.join(',') === 'Forskning', prosjekt.join(','));

  await p.click('#notes-nav-board .card .add-item-btn');
  await p.keyboard.type('Metode');
  await p.keyboard.press('Enter');
  const mapper = await p.evaluate(() => window.__huskis.state.noteProjects[0].folders.map((f) => f.name));
  log(navn + ': mappen ble lagt i prosjektet', mapper.join(',') === 'Metode', mapper.join(','));

  // Naviger inn i mappen fra raden, og tilbake til de frie notatene fra hodet.
  await p.click('#notes-nav-board .note-folder-row');
  const iMappe = await p.evaluate(() => ({
    folder: window.__huskis.state.activeFolder,
    crumb: document.getElementById('crumb-note-folder-name').textContent,
    modalLukket: document.getElementById('notes-nav-modal').hidden,
  }));
  log(navn + ': klikk på mapperaden navigerer inn i mappen',
    !!iMappe.folder && iMappe.crumb === 'Metode' && iMappe.modalLukket, JSON.stringify(iMappe));
  await p.click('#notes-crumb');
  await p.waitForSelector('#notes-nav-board .card .card-head', { timeout: 5000 });
  await p.click('#notes-nav-board .card .card-head');
  const friPlass = await p.evaluate(() => ({
    folder: window.__huskis.state.activeFolder,
    crumb: document.getElementById('crumb-note-folder-name').textContent,
  }));
  log(navn + ': klikk på prosjekthodet går til de FRIE notatene',
    friPlass.folder === null && friPlass.crumb.length > 0, JSON.stringify(friPlass));

  /* ---------- 4. «＋ Notat» åpner editoren ---------- */
  await p.click('#add-note-btn');
  await editorÅpen(p);
  const åpnet = await p.evaluate(() => ({
    notater: window.__huskis.state.notes.length,
    fritt: window.__huskis.state.notes[0].folder,
    prosjekt: window.__huskis.state.notes[0].project === window.__huskis.state.activeProject,
    lagreknapp: !!document.querySelector('#note-editor button[data-save], #note-editor .note-save-btn'),
  }));
  log(navn + ': «＋ Notat» oppretter notatet og åpner editoren straks',
    åpnet.notater === 1 && åpnet.fritt === null && åpnet.prosjekt, JSON.stringify(åpnet));
  log(navn + ': editoren har INGEN Lagre-knapp (autosave)', !åpnet.lagreknapp);
  // Fullskjermsbildet er ikke en modal, så fokusfella der gjelder det ikke:
  // resten av appen gjøres `inert` i stedet, ellers vandrer Tab ned i
  // toppmenyen og board-et bak bildet (docs/tilgjengelighet.md).
  const bak = await p.evaluate(() => ({
    topbar: document.getElementById('topbar').inert === true,
    main: document.querySelector('.app-main').inert === true,
    hjørne: document.getElementById('corner-controls').inert === true,
  }));
  log(navn + ': appflaten bak editoren er inert (fokus kan ikke vandre dit)',
    bak.topbar && bak.main && bak.hjørne, JSON.stringify(bak));

  /* ---------- 5. Formatering ---------- */
  await p.fill('#note-title-input', 'Utvalg');
  await p.click('#note-doc');
  await p.keyboard.type('Vanlig tekst');
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="h2"]');
  await p.keyboard.type('Overskrift');
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="ul"]');
  await p.keyboard.type('Punkt en');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Punkt to');
  const doc1 = await p.evaluate(() => window.__huskis.noteDocFromEl(document.getElementById('note-doc')));
  log(navn + ': blokkene leses tilbake som modellens typer',
    doc1.blocks.map((b) => b.t).join(',') === 'p,h2,ul',
    doc1.blocks.map((b) => b.t).join(','));
  log(navn + ': punktlista har begge punktene',
    (doc1.blocks[2].items || []).map((i) => i.map((r) => r.s).join('')).join('|') === 'Punkt en|Punkt to',
    JSON.stringify(doc1.blocks[2].items));

  // Tegnmarkeringene: hver av dem på sitt eget ord, så de kan leses hver for seg.
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="ul"]');            // ut av lista igjen
  for (const [cmd, ord] of [['bold', 'fet'], ['italic', 'kursiv'], ['underline', 'strek'],
                            ['superscript', 'hevet'], ['subscript', 'senket']]) {
    await p.click('.note-tool[data-cmd="' + cmd + '"]');
    await p.keyboard.type(ord);
    await p.click('.note-tool[data-cmd="' + cmd + '"]');
    await p.keyboard.type(' ');
  }
  const merker = await p.evaluate(() => {
    const d = window.__huskis.noteDocFromEl(document.getElementById('note-doc'));
    const siste = d.blocks[d.blocks.length - 1];
    const ut = {};
    (siste.c || []).forEach((r) => {
      ['b', 'i', 'u', 'sup', 'sub'].forEach((m) => { if (r[m]) ut[m] = r.s; });
    });
    return ut;
  });
  log(navn + ': fet, kursiv, understrek, hevet og senket bæres av modellen',
    merker.b === 'fet' && merker.i === 'kursiv' && merker.u === 'strek' &&
    merker.sup === 'hevet' && merker.sub === 'senket', JSON.stringify(merker));

  // Nummerert liste og skillelinje.
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="ol"]');
  await p.keyboard.type('Først');
  // To Enter forlater lista slik nettleseren selv gjør det (tomt punkt).
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="hr"]');
  const doc2 = await p.evaluate(() => window.__huskis.noteDocFromEl(document.getElementById('note-doc')));
  log(navn + ': nummerert liste og skillelinje er egne blokktyper',
    doc2.blocks.some((b) => b.t === 'ol') && doc2.blocks.some((b) => b.t === 'hr'),
    doc2.blocks.map((b) => b.t).join(','));

  // Spesialtegn.
  await p.click('.note-tool[data-cmd="symbol"]');
  await p.waitForSelector('#note-symbol-panel button', { timeout: 3000 });
  await p.click('#note-symbol-panel button:nth-child(3)');   // «…»
  const tegn = await p.evaluate(() => window.__huskis.noteDocText(
    window.__huskis.noteDocFromEl(document.getElementById('note-doc'))));
  log(navn + ': spesialtegnet ble satt inn i teksten', tegn.indexOf('…') > -1,
    JSON.stringify(tegn.slice(-30)));

  // Lenke: marker et ord og legg adressen på det.
  await p.evaluate(() => {
    const doc = document.getElementById('note-doc');
    const p1 = doc.querySelector('p');
    const r = document.createRange();
    r.selectNodeContents(p1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await p.click('.note-tool[data-cmd="link"]');
  await p.fill('#note-link-input', 'eksempel.no/side');
  await p.click('#note-link-apply');
  const lenke = await p.evaluate(() => {
    const d = window.__huskis.noteDocFromEl(document.getElementById('note-doc'));
    const run = d.blocks[0].c.find((r) => r.url);
    return { url: run && run.url, tekst: run && run.s,
             anker: document.querySelectorAll('#note-doc a').length };
  });
  log(navn + ': lenken lagres som en normalisert adresse på kjøringen',
    !!lenke.url && lenke.url.indexOf('eksempel.no/side') > -1 && lenke.tekst === 'Vanlig tekst',
    JSON.stringify(lenke));
  log(navn + ': lenken er MERKET tekst, ikke et anker (ingen utgående lenke)',
    lenke.anker === 0, 'a-elementer: ' + lenke.anker);

  // Angre/gjør om igjen.
  await p.click('#note-doc');
  await p.keyboard.type('SLETTMEG');
  const førAngre = await p.evaluate(() => document.getElementById('note-doc').textContent);
  await p.click('.note-tool[data-cmd="undo"]');
  const etterAngre = await p.evaluate(() => document.getElementById('note-doc').textContent);
  await p.click('.note-tool[data-cmd="redo"]');
  const etterGjørOm = await p.evaluate(() => document.getElementById('note-doc').textContent);
  log(navn + ': angre og gjør om igjen virker i editoren',
    førAngre.indexOf('SLETTMEG') > -1 && etterAngre.indexOf('SLETTMEG') === -1 &&
    etterGjørOm.indexOf('SLETTMEG') > -1,
    'før/etter/omigjen: ' + [førAngre.indexOf('SLETTMEG') > -1, etterAngre.indexOf('SLETTMEG') > -1,
      etterGjørOm.indexOf('SLETTMEG') > -1].join(','));

  /* ---------- 6. Autosave ---------- */
  await p.click('#note-doc');
  await p.keyboard.type('.');
  const lagrer = await p.evaluate(() => document.getElementById('note-save-status').textContent);
  await p.waitForFunction(() => document.getElementById('note-save-status').textContent === 'Lagret',
    null, { timeout: 4000, polling: 100 });
  log(navn + ': autosave viser «Lagrer …» og så «Lagret»',
    /Lagrer/.test(lagrer), JSON.stringify(lagrer));

  /* ---------- 7. Tilbake til samme kontekst ---------- */
  // Escape lukker først et åpent panel, deretter editoren — og lukker ikke
  // begge i ett trykk (systemBack tar den samme stigen på Android).
  await p.click('.note-tool[data-cmd="symbol"]');
  await p.waitForSelector('#note-symbol-panel button', { timeout: 3000 });
  await p.keyboard.press('Escape');
  const etterEnEsc = await p.evaluate(() => ({
    panel: document.getElementById('note-symbol-panel').hidden,
    editor: document.getElementById('note-editor').hidden,
  }));
  log(navn + ': Escape lukker panelet, ikke hele editoren',
    etterEnEsc.panel && !etterEnEsc.editor, JSON.stringify(etterEnEsc));
  const viaBack = await p.evaluate(() => {
    const tatt = window.__huskis.systemBack();
    return { tatt, editor: document.getElementById('note-editor').hidden };
  });
  log(navn + ': Androids tilbakeknapp lukker editoren i stedet for appen',
    viaBack.tatt === true && viaBack.editor, JSON.stringify(viaBack));
  // …og åpne den igjen, så resten av flyten står som før.
  await p.click('#notes-board .note-card');
  await editorÅpen(p);
  await p.click('#note-back');
  await editorLukket(p);
  const tilbake = await p.evaluate(() => ({
    tab: window.__huskis.mainTab,
    prosjekt: !!window.__huskis.state.activeProject,
    mappe: window.__huskis.state.activeFolder,
    kort: document.querySelectorAll('#notes-board .note-card').length,
  }));
  log(navn + ': tilbakeknappen lander i riktig fane og plassering',
    tilbake.tab === 'notes' && tilbake.prosjekt && tilbake.mappe === null && tilbake.kort === 1,
    JSON.stringify(tilbake));
  const bakEtter = await p.evaluate(() => ({
    topbar: document.getElementById('topbar').inert === true,
    main: document.querySelector('.app-main').inert === true,
  }));
  log(navn + ': appflaten er brukbar igjen etter tilbake',
    !bakEtter.topbar && !bakEtter.main, JSON.stringify(bakEtter));

  /* ---------- 8. Notatkortet ---------- */
  const kort = await p.evaluate(() => {
    const el = document.querySelector('#notes-board .note-card');
    return {
      tittel: el.querySelector('.note-card-title').textContent,
      utdrag: el.querySelector('.note-card-excerpt').textContent,
      meta: el.querySelector('.note-card-meta').textContent,
    };
  });
  log(navn + ': kortet viser tittel, utdrag og sist endret',
    kort.tittel === 'Utvalg' && kort.utdrag.indexOf('Vanlig tekst') > -1 && kort.meta.length > 3,
    JSON.stringify(kort));

  /* ---------- 10. Synk mot mock-backenden ---------- */
  /* Vent på at DOKUMENTET er pushet, ikke bare at raden finnes: insert-en kan
     ha gått av gårde før autosaven skrev innholdet, og oppdateringen kommer da
     i neste runde. */
  await p.waitForFunction(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    const n = (db.notes || [])[0];
    return !!n && (db.note_projects || []).length === 1 &&
      !!n.body && (n.body.blocks || []).length > 3;
  }, null, { timeout: 12000, polling: 200 });
  const server = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const n = db.notes[0];
    return {
      prosjekt: n.project_id === db.note_projects[0].id,
      fritt: n.folder_id === null,
      mappeIProsjektet: db.note_folders[0].project_id === db.note_projects[0].id,
      blokker: (n.body.blocks || []).length,
      eier: n.owner_id,
    };
  });
  log(navn + ': radene ligger på serveren med riktig forelder og dokument',
    server.prosjekt && server.fritt && server.mappeIProsjektet && server.blokker > 3 &&
    server.eier === 'u1', JSON.stringify(server));

  // «En annen enhet» endrer tittelen med et nyere stempel → flettes inn.
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    db.notes[0].title = 'Endret et annet sted';
    db.notes[0].ts = Date.now() + 60000;
    db.notes[0].org = 'annen-enhet';
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
  });
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => window.__huskis.state.notes[0].title === 'Endret et annet sted',
    null, { timeout: 8000, polling: 200 });
  const flettet = await p.evaluate(() => ({
    tittel: window.__huskis.state.notes[0].title,
    kort: (document.querySelector('#notes-board .note-card .note-card-title') || {}).textContent,
    blokker: window.__huskis.state.notes[0].doc.blocks.length,
  }));
  log(navn + ': en nyere fjern-endring flettes inn og males på kortet',
    flettet.tittel === 'Endret et annet sted' && flettet.kort === 'Endret et annet sted' &&
    flettet.blokker > 3, JSON.stringify(flettet));

  /* ---------- 9. Reload ---------- */
  await p.reload();
  await klar(p);
  await p.waitForFunction(() => document.querySelectorAll('#notes-board .note-card').length === 1,
    null, { timeout: 10000, polling: 200 });
  const etterReload = await p.evaluate(() => {
    const H = window.__huskis;
    const n = H.state.notes[0];
    return {
      tab: H.mainTab,
      tittel: n.title,
      blokker: n.doc.blocks.map((b) => b.t).join(','),
      tekst: H.noteDocText(n.doc),
      prosjekt: H.state.noteProjects[0].name,
      mappe: H.state.noteProjects[0].folders[0].name,
    };
  });
  log(navn + ': fanevalget huskes over en reload', etterReload.tab === 'notes', etterReload.tab);
  log(navn + ': innhold og struktur er intakt etter reload',
    etterReload.tittel === 'Endret et annet sted' &&
    /p,h2,ul/.test(etterReload.blokker) && etterReload.tekst.indexOf('Punkt to') > -1 &&
    etterReload.prosjekt === 'Forskning' && etterReload.mappe === 'Metode',
    JSON.stringify(etterReload));

  /* ---------- 2. Lister-fanen er uendret ---------- */
  await p.click('#tab-lists');
  const lister = await p.evaluate(() => ({
    kort: document.querySelectorAll('#board .card').length,
    rader: document.querySelectorAll('#board .items-container > .item').length,
    tittel: (document.querySelector('#board .card-title') || {}).textContent,
    knapp: !document.getElementById('add-card-btn').disabled,
  }));
  log(navn + ': Lister-fanen rendrer fortsatt kortene og radene sine',
    lister.kort === 1 && lister.rader === 1 && lister.tittel === 'Lista' && lister.knapp,
    JSON.stringify(lister));
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForFunction(() => !document.getElementById('nav-modal').hidden, null, { timeout: 4000 });
  const navOk = await p.evaluate(() => document.querySelectorAll('#nav-board .uni-card').length);
  await p.evaluate(() => window.__huskis.closeNavModal());
  log(navn + ': nav-modalen for områder/mapper virker som før', navOk === 1, 'områdekort: ' + navOk);

  /* ---------- 11. DnD: omrokering av notatkort ---------- */
  await p.click('#tab-notes');
  await p.evaluate(() => {
    const H = window.__huskis;
    ['Nummer to', 'Nummer tre'].forEach((t) => {
      const n = H.addNote();
      n.title = t;
      H.closeNoteEditor();
    });
    H.save();
    H.renderNotes();
  });
  await p.waitForFunction(() => document.querySelectorAll('#notes-board .note-card').length === 3,
    null, { timeout: 5000, polling: 100 });
  const førDrag = await p.evaluate(() => [...document.querySelectorAll('#notes-board .note-card .note-card-title')]
    .map((e) => e.textContent));
  /* Kortene fordeles på flere kolonner (docs/board-layout.md), så en
     `:first-child`-selektor treffer det FØRSTE kortet i HVER kolonne. Punktene
     regnes derfor ut av dokumentrekkefølgen, som ER leserekkefølgen. */
  const kortPunkt = (i, ratio) => p.evaluate(({ i, ratio }) => {
    const els = document.querySelectorAll('#notes-board .note-card');
    const r = els[i < 0 ? els.length + i : i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * (ratio == null ? 0.5 : ratio) };
  }, { i, ratio });
  await dragFromTo(p, await kortPunkt(0), () => kortPunkt(-1, 0.85), { touch });
  await p.waitForTimeout(400);
  const etterDrag = await p.evaluate(() => [...document.querySelectorAll('#notes-board .note-card .note-card-title')]
    .map((e) => e.textContent));
  log(navn + ': et notatkort kan dras til en ny plass i rekka',
    etterDrag.join('|') !== førDrag.join('|') && etterDrag.length === 3,
    førDrag.join('|') + ' → ' + etterDrag.join('|'));
  const persistert = await p.evaluate(() => {
    const H = window.__huskis;
    return H.notesIn(H.state.activeProject, H.state.activeFolder).map((n) => n.title);
  });
  log(navn + ': rekkefølgen fra draget er den samme i tilstanden',
    persistert.join('|') === etterDrag.join('|'), persistert.join('|'));
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return !el || el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 200 });
  const påServer = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    return db.notes.slice().sort((a, b) => a.pos - b.pos).map((n) => n.title);
  });
  log(navn + ': rekkefølgen er synket (samme rekkefølge på serveren)',
    påServer.join('|') === persistert.join('|'), påServer.join('|'));

  /* ---------- 12. Tastatur ---------- */
  const førTast = await p.evaluate(() => {
    const H = window.__huskis;
    return H.notesIn(H.state.activeProject, H.state.activeFolder).map((n) => n.title);
  });
  await p.evaluate(() => {
    const els = document.querySelectorAll('#notes-board .note-card');
    els[els.length - 1].focus();
  });
  await p.keyboard.down('Alt');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.up('Alt');
  await p.waitForTimeout(200);
  const etterTast = await p.evaluate(() => {
    const H = window.__huskis;
    return H.notesIn(H.state.activeProject, H.state.activeFolder).map((n) => n.title);
  });
  log(navn + ': Alt+Pil opp flytter et notatkort ett hakk',
    etterTast[etterTast.length - 2] === førTast[førTast.length - 1],
    førTast.join('|') + ' → ' + etterTast.join('|'));

  /* ---------- 13. Trygg modell og rendring ---------- */
  const trygg = await p.evaluate(() => {
    const H = window.__huskis;
    const farlig = H.sanitizeNoteDoc({ v: 1, blocks: [
      { t: 'script', c: [{ s: 'x' }] },
      { t: 'p', c: [{ s: 'a', url: 'javascript:alert(1)' }, { s: 'b', url: 'data:text/html,x' },
                    { s: 'c', url: 'https://ok.example/side' }] },
    ] });
    const holder = document.createElement('div');
    H.noteDocIntoEl(holder, H.sanitizeNoteDoc({ v: 1, blocks: [
      { t: 'p', c: [{ s: '<img src=x onerror=alert(1)>' }] },
    ] }));
    return {
      typer: farlig.blocks.map((b) => b.t),
      // Naboer med samme markering slås sammen, så de to farlige adressene blir
      // ÉN kjøring uten url — teksten er beholdt, adressen er borte.
      urler: farlig.blocks[1].c.map((r) => r.url || ''),
      tekst2: farlig.blocks[1].c.map((r) => r.s).join(''),
      js: H.safeNoteUrl('javascript:alert(1)'),
      // Kontrolltegn midt i skjemaet skal ikke slippe gjennom.
      jsSkjult: H.safeNoteUrl('java script:alert(1)'),
      elementer: holder.querySelectorAll('img, script').length,
      tekst: holder.textContent,
    };
  });
  log(navn + ': ukjente blokktyper blir avsnitt, og bare trygge skjemaer overlever',
    trygg.typer.join(',') === 'p,p' &&
    trygg.urler.filter(Boolean).length === 1 &&
    trygg.urler.filter(Boolean)[0].indexOf('ok.example') > -1 &&
    trygg.tekst2 === 'abc' && trygg.js === '' && trygg.jsSkjult === '',
    JSON.stringify(trygg.urler) + ' tekst=' + JSON.stringify(trygg.tekst2) +
    ' js=' + JSON.stringify(trygg.js) + '/' + JSON.stringify(trygg.jsSkjult));
  log(navn + ': innhold rendres som TEKST, aldri som markup',
    trygg.elementer === 0 && trygg.tekst.indexOf('<img') === 0,
    'elementer: ' + trygg.elementer + ', tekst: ' + JSON.stringify(trygg.tekst));

  log(navn + ': ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
