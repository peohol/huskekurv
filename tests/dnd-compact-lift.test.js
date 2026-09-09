/*
  Regresjonstest: DET LØFTEDE OBJEKTET ER KOMPAKT.

  Alt som dras krymper i BEGGE retninger ved løft (`dndCompactLift`): objektet
  ligger oppå det man sikter mot, og alt det dekker er svar man trenger — hullet,
  ny-liste-stripa, skillelinja, søppelkassen. Filen dekker:

    1. Løftet er SMALT og LAVT. Igjen står tittelen og ikonene til VENSTRE for
       den; menyknappen, «sist endret» og hele kortkroppen er borte. Måles på
       et listepunkt, en liste og et notatkort.
    2. Krympingen er ASYMMETRISK: tar man tak nær høyre kant, havner den
       krympede boksen likevel midtstilt under pekeren — og blir liggende der
       gjennom hele draget, ikke bare i første frame.
    3. Bare LODDRETT for naboene: de andre radene/kortene er like brede som før.
       Det er kun objektet man holder i som krymper vannrett.
    4. HULLET er like stort som det som dras. dnd-kit forankrer det løftede
       objektets geometri i klonens boks, så et hull tvunget tilbake til full
       bredde ville blåst objektet opp igjen.
    5. Alt foldes ut igjen ved slipp: ingen `.dnd-compact` og ingen `translate`
       blir liggende igjen på objektet, og kortet er like høyt som før.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-compact-lift.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click(); await p.waitForTimeout(300);
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click(); await p.waitForTimeout(700);
  await p.getByText('Tilbake til innlogging').click(); await p.waitForTimeout(300);
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Ett område, én mappe, to lister med to listepunkter hver.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const c1 = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    c1.items.push(mk({ id: 'I1', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    c1.items.push(mk({ id: 'I2', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    const c2 = mk({ id: 'L2', group: 'GRP', title: 'Huskeliste', collapsed: false, items: [], pos: 1 });
    c2.items.push(mk({ id: 'J1', home: 'L2', text: 'Ringe', cat: null, isCat: false }));
    g.cards.push(c1, c2);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);
}

// To notater i én bokhylle.
async function seedNotes(p) {
  await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject();
    proj.name = 'Fagstoff';
    H.setActiveProject(proj.id);
    H.setActiveNoteFolder(null);
    const nytt = (tittel, tekst) => {
      const n = H.addNote();
      H.closeNoteEditor();
      n.title = tittel;
      n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: tekst }] }] };
      return n;
    };
    nytt('Blodprøver', 'Hemoglobin og ferritin måles på nytt.');
    nytt('Timeplan', 'Uke 12 er full.');
    H.save();
    H.renderNotes();
  });
  await p.waitForTimeout(400);
}

// Boksen til det løftede objektet + hva som fortsatt er synlig i det.
const lifted = (p) => p.evaluate(() => {
  const el = document.querySelector('[data-dnd-dragging]');
  const ph = document.querySelector('[data-dnd-placeholder]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const synlig = (sel) => {
    const n = el.querySelector(sel);
    if (!n) return false;
    const cs = getComputedStyle(n);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && n.getBoundingClientRect().height > 0;
  };
  return {
    // `--dnd-width`/`--dnd-height` er den boksen dnd-kit MÅLTE ved løft, altså
    // den logiske — uten skalaen og rotasjonen vi maler oppå.
    w: Math.round(parseFloat(el.style.getPropertyValue('--dnd-width')) || r.width),
    h: Math.round(parseFloat(el.style.getPropertyValue('--dnd-height')) || r.height),
    senterX: Math.round(r.left + r.width / 2),
    venstre: Math.round(r.left), høyre: Math.round(r.right),
    kompakt: el.classList.contains('dnd-compact'),
    tittel: synlig('.item-text, .card-title'),
    ikon: synlig('.item-check, .kind-icon, .note-card-icon'),
    meny: synlig('.obj-menu-btn'),
    kropp: synlig('.card-body'),
    meta: synlig('.note-card-meta'),
    klonW: ph ? Math.round(ph.getBoundingClientRect().width) : null,
  };
});

const boksAv = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
}, sel);

async function run(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const M = (t) => navn + ': ' + t;
  await register(p);
  await seed(p);

  /* ---------- 1 + 2) LISTEPUNKT: smalt, og midtstilt på grepet ---------- */
  const rad = await boksAv(p, '#board .card[data-id="L1"] .item[data-id="I1"]');
  // Ta tak godt til høyre for midten — men klar av menyknappen ytterst.
  const grep = { x: rad.x + Math.round(rad.w * 0.72), y: rad.y + Math.round(rad.h / 2) };
  const start = await G.lift(p, grep, touch);
  const l1 = await lifted(p);
  log(M('1 listepunktet krymper vannrett ved løft'),
    l1.kompakt === true && l1.w < rad.w * 0.6, JSON.stringify({ rad: rad.w, løftet: l1.w }));
  log(M('1 tittelen og ikonet til venstre for den står igjen; menyknappen er borte'),
    l1.tittel === true && l1.ikon === true && l1.meny === false, JSON.stringify(l1));
  log(M('2 den krympede boksen er midtstilt under grepet'),
    Math.abs(l1.senterX - start.x) <= 3, 'senter=' + l1.senterX + ' grep=' + start.x);
  log(M('4 hullet er like bredt som det som dras'),
    l1.klonW !== null && Math.abs(l1.klonW - l1.w) <= 2, JSON.stringify({ klon: l1.klonW, løftet: l1.w }));

  // 3) Naboen er urørt — bare det man holder i krymper vannrett.
  const nabo = await boksAv(p, '#board .card[data-id="L1"] .item[data-id="I2"]');
  log(M('3 naboraden er like bred som før'),
    Math.abs(nabo.w - rad.w) <= 2, JSON.stringify({ nabo: nabo.w, rad: rad.w }));

  /* 2) … og objektet SLIPPER ALDRI pekeren når den flytter seg. På et board med
     flere kolonner er senteret fortsatt nøyaktig under pekeren; står board-et i
     én kolonne, er draget låst loddrett og objektet henger etter i ledesnorens
     slakk (`dnd-vertical-axis`) — men pekeren blir liggende innenfor uansett. */
  const flyttet = await G.travel(p, { x: start.x - 60, y: start.y + 40 }, touch);
  const l2 = await lifted(p);
  log(M('2 objektet slipper ikke pekeren når den flytter seg'),
    flyttet.x >= l2.venstre && flyttet.x <= l2.høyre,
    'peker=' + flyttet.x + ' objekt=' + l2.venstre + '–' + l2.høyre);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(700);

  /* ---------- 5) Alt foldes ut igjen ---------- */
  const etter = await p.evaluate(() => ({
    kompakte: document.querySelectorAll('.dnd-compact').length,
    translate: [...document.querySelectorAll('#board .item')]
      .filter((el) => el.style.translate).length,
  }));
  log(M('5 ingen kompakt form eller skift blir liggende igjen etter slippet'),
    etter.kompakte === 0 && etter.translate === 0, JSON.stringify(etter));

  /* ---------- 1) LISTE (kort): kroppen er borte, hodet står ---------- */
  const kort = await boksAv(p, '#board .card[data-id="L1"]');
  const hode = await boksAv(p, '#board .card[data-id="L1"] .card-head');
  const kortGrep = { x: hode.x + Math.round(hode.w * 0.7), y: hode.y + Math.round(hode.h / 2) };
  const kortStart = await G.lift(p, kortGrep, touch);
  const lk = await lifted(p);
  log(M('1 lista krymper i begge retninger: bare hodet, og smalere enn kortet'),
    lk.kompakt === true && lk.w < kort.w * 0.6 && lk.h <= hode.h + 2 && lk.kropp === false,
    JSON.stringify({ kort: kort.w, hode: hode.h, løftet: [lk.w, lk.h] }));
  log(M('2 lista er midtstilt under grepet'),
    Math.abs(lk.senterX - kortStart.x) <= 3, 'senter=' + lk.senterX + ' grep=' + kortStart.x);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(700);

  /* ---------- 1) NOTATKORT ---------- */
  await seedNotes(p);
  const nKort = await boksAv(p, '#notes-board .note-card');
  const nGrep = { x: nKort.x + Math.round(nKort.w * 0.7), y: nKort.y + Math.round(nKort.h / 2) };
  const nStart = await G.lift(p, nGrep, touch);
  const ln = await lifted(p);
  log(M('1 notatkortet krymper til tittelen: utdrag, dato og meny er borte'),
    ln.kompakt === true && ln.w < nKort.w * 0.7 && ln.h < nKort.h &&
    ln.kropp === false && ln.meta === false && ln.meny === false,
    JSON.stringify({ kort: [nKort.w, nKort.h], løftet: [ln.w, ln.h] }));
  log(M('2 notatkortet er midtstilt under grepet'),
    Math.abs(ln.senterX - nStart.x) <= 3, 'senter=' + ln.senterX + ' grep=' + nStart.x);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(800);
  const nEtter = await boksAv(p, '#notes-board .note-card');
  log(M('5 notatkortet er like stort som før etter slippet'),
    Math.abs(nEtter.w - nKort.w) <= 2 && Math.abs(nEtter.h - nKort.h) <= 2,
    JSON.stringify({ før: [nKort.w, nKort.h], etter: [nEtter.w, nEtter.h] }));

  log(M('ingen JS-feil'), errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
