/*
  Regresjonstest: AUTO-SCROLL-TAKT, AVBRUDDS-SIKKERHETSNETT, EKSTERN SCROLL og
  SCROLL ETTER LISTE-SLIPP.

  7.  Auto-scrollen normaliseres mot faktisk forløpt tid: like lang simulert tid
      ved 60 og 120 RAF-steg gir tilnærmet lik scrollavstand, og et diger `dt`
      (bakgrunnsfane/pause) klemmes så scrollen ikke hopper.
  8a. Draget «glipper» ALDRI av seg selv: verken fokustap (`blur`/
      `visibilitychange`) eller en capture-slipp der objektet står i DOM avbryter
      gesten — for liste, listepunkt OG kategori.
  8b. Rives objektet UT av DOM (synk-rebuild), ryddes draget opp: ingen
      dra-merke, placeholder, auto-scroll, global cursor eller board-vakt igjen.
  9.  Manuelt window-scroll under listepunkt-/kategori-drag holder objektet under
      pekeren (før: bare lister ble reposisjonert).
  10. Et liste-slipp som allerede er fullt synlig flytter ikke viewporten.
  11. Er lista skjult etter gjenutvidelsen, scrolles det bare så langt som trengs
      (nedre kant inn i syne) — ikke helt til toppjustering.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-recovery-scroll.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

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
  // `lastMy` settes først når get_my_doc har svart — da er kontoen innlogget
  // og dokumentet hentet. (En fersk konto har null områder — board er tomt.)
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// cards = [[tittel, antall listepunkter, antallKategorimedlemmer?], …]
async function seed(p, cards) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((cards) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    g.cards = cards.map(([title, n, cat], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      const add = (o) => { c.items.push(Object.assign({ home: id, cat: null, trashed: false, done: false }, mk(), o)); };
      for (let i = 0; i < n; i++) add({ id: 'it-' + title + '-' + i, text: title + ' ' + i, pos: i });
      if (cat) {
        const cid = 'cat-' + title;
        add({ id: cid, text: 'Kategori ' + title, isCat: true, pos: n });
        for (let i = 0; i < cat; i++) add({ id: 'ci-' + title + '-' + i, text: 'K' + i, cat: cid, pos: i });
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

// Ekte pekerinput, i den steg-for-steg-formen denne fila er skrevet rundt.
// Sekvensene under er uendret; det er leveringen som er ekte nå.
const pointer = (p, type, x, y) => G.sendPointer(p, type, x, y, 'touch');

const centerOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, h: r.height };
}, sel);

// Avstanden fra pekeren til det løftede objektets LAYOUT-topp i viewporten.
// For den gamle motorens objekter leses den fra `style.top` (dokument-koordinat)
// − scrollY, ikke fra getBoundingClientRect: kategorien kollapser (animert
// høyde) og roterer under draget, så både senter og omslutningsboks flytter seg
// av andre grunner enn scrollen vi tester.
// dnd-kit løfter i stedet objektet inn i top layer (`position: fixed`), og der
// ER omslutningsboksens topp viewport-koordinaten — bevegelsen i disse
// sjekkene er dessuten rent loddrett, så rotasjonen står stille.
const dragTopOffset = (p, sel, py) => p.evaluate(({ sel, py }) => {
  const el = document.querySelector(sel);
  const t = parseFloat(el.style.top);
  const doc = Number.isFinite(t) && getComputedStyle(el).position === 'absolute';
  return py - (doc ? t - window.scrollY : el.getBoundingClientRect().top);
}, { sel, py });

// Restene et drag ALDRI skal etterlate seg.
const residue = (p) => p.evaluate(() => {
  const dragged = document.querySelector('.card[style*="left"], .item[style*="left"]');
  return {
    // `[data-dnd-dragging]`.
    dragging: document.querySelectorAll('[data-dnd-dragging]').length,
    ph: document.querySelectorAll('.card-placeholder, .new-list-placeholder, [data-dnd-placeholder]').length,
    isDragging: document.body.classList.contains('is-dragging'),
    cursor: getComputedStyle(document.body).cursor,
    inlinePos: dragged ? (dragged.getAttribute('style') || '') : '',
    overflowAnchor: document.documentElement.style.overflowAnchor || '',
    boardGuard: (document.querySelector('.board').style.minHeight || '') + '|' + (document.querySelector('.board').style.paddingTop || ''),
  };
});

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ===== 7) Auto-scroll under et RAD-drag =====
     Fartsnormaliseringen (`frameSteps`: px per 60 Hz-frame, klemt dt) var vår
     egen, og den fulgte med motoren ut — auto-scrollen er dnd-kits `AutoScroller`
     nå, på alle nivåene. At farten er per frame og ikke per millisekund er
     dermed upstreams sak (`docs/drag-and-drop.md`, «Auto-scroll»), og en falsk
     rAF-klokke måler biblioteket, ikke oss.

     Det som fortsatt er VÅRT å vokte er at auto-scrollen i det hele tatt slår
     inn for et listepunkt: holdes fingeren i bunn-sonen, skal siden rulle — det
     er den eneste veien til en liste lenger ned på en høy skjerm. */
  {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 25], ['B', 25], ['C', 25]]);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(150);

    // Løft et listepunkt (ingen kollaps → board-et forblir høyt) og hold fingeren
    // i bunn-sonen så auto-scrollen går kontinuerlig.
    const it = await centerOf(p, '.item[data-id="it-A-2"]');
    await pointer(p, 'pointerdown', it.x, it.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', it.x, 700); await p.waitForTimeout(60);
    await pointer(p, 'pointermove', it.x, 806); await p.waitForTimeout(120);
    const y0 = await p.evaluate(() => window.scrollY);
    // Ekte klokke: 600 ms med fingeren i sonen. Fast venting er RIKTIG her —
    // dette er gest- og animasjonsfysikk, ikke en tilstand å vente på.
    await p.waitForTimeout(600);
    const y1 = await p.evaluate(() => window.scrollY);
    log('7 auto-scroll ruller siden mens et listepunkt holdes i bunn-sonen',
      y1 - y0 > 40, 'scrollY ' + y0 + ' → ' + y1);
    // …og den STOPPER ved slippet.
    await pointer(p, 'pointerup', it.x, 806); await p.waitForTimeout(500);
    const y2 = await p.evaluate(() => window.scrollY);
    await p.waitForTimeout(400);
    const y3 = await p.evaluate(() => window.scrollY);
    log('7 auto-scrollen stopper ved slippet', Math.abs(y3 - y2) <= 2, 'scrollY ' + y2 + ' → ' + y3);
    log('7 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 8a) Draget skal IKKE glippe av seg selv =====
     Sikkerhetsnettet er smalt med vilje. Verken et fokustap (`window.blur`/
     `visibilitychange`) eller en capture-slipp der objektet fortsatt henger i DOM
     skal avbryte gesten: window-lytterne lever videre, og et bredere nett fikk
     lister/listepunkter/kategorier til å «glippe» rett etter løft. */
  for (const K of [{ n: 'liste', sel: '.card[data-id="card-A"] .card-head', drag: '#board .card[data-dnd-dragging]' },
    { n: 'listepunkt', sel: '.item[data-id="it-B-2"]', drag: '#board .item[data-dnd-dragging]' },
    { n: 'kategori', sel: '.category[data-id="cat-A"] .cat-head', drag: '#board .category[data-dnd-dragging]' }]) {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 8, 3], ['B', 8]]);
    await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), K.sel);
    await p.waitForTimeout(250);

    const c = await centerOf(p, K.sel);
    await pointer(p, 'pointerdown', c.x, c.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', c.x, c.y - 20); await p.waitForTimeout(150);
    const alive0 = await p.evaluate((s) => document.querySelectorAll(s).length, K.drag);
    log('8a ' + K.n + ': draget er i gang', alive0 === 1, 'dragging=' + alive0);

    // Fokustap + capture-slipp mens objektet står i DOM — draget skal overleve begge.
    // Disse er og BLIR syntetiske, i motsetning til gestene i denne fila: de er
    // ikke input, men støy motoren skal overse, og en ekte finger kan ikke
    // bestille dem. Å drive dem for hånd er nettopp poenget.
    await p.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      const el = document.querySelector('[data-dnd-dragging]');
      if (el) el.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, composed: true, pointerId: 7, pointerType: 'touch' }));
    });
    await p.waitForTimeout(250);
    const alive1 = await p.evaluate((s) => document.querySelectorAll(s).length, K.drag);
    log('8a ' + K.n + ': fokustap + capture-slipp avbryter IKKE draget', alive1 === 1, 'dragging=' + alive1);

    // … og gesten er fortsatt brukbar: objektet følger pekeren videre.
    const before = await dragTopOffset(p, K.drag, c.y - 20);
    await pointer(p, 'pointermove', c.x, c.y - 60); await p.waitForTimeout(120);
    const after = await dragTopOffset(p, K.drag, c.y - 60);
    log('8a ' + K.n + ': objektet følger fortsatt pekeren etterpå',
      Math.abs(after - before) < 3, 'før=' + before.toFixed(1) + ' etter=' + after.toFixed(1));

    await pointer(p, 'pointerup', c.x, c.y - 60);
    // Vent på TILSTANDEN: dnd-kits drop-animasjon bærer `[data-dnd-dragging]`
    // helt til den er ferdig.
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
    await p.waitForTimeout(200);
    const r = await residue(p);
    log('8a ' + K.n + ': vanlig slipp rydder opp', r.dragging === 0 && r.ph === 0, JSON.stringify(r));
    log('8a ' + K.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 8b) Rives objektet UT av DOM, ryddes draget opp ===== */
  {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 8], ['B', 8], ['C', 8]]);

    // Klonen dnd-kit holder plassen med bærer de samme klassene, men har fått
    // identiteten fjernet — den er ingen rad, og skal ikke telle med.
    const cardIds = () => p.evaluate(() => [...document.querySelectorAll('#board .card')]
      .filter((c) => !c.hasAttribute('data-dnd-placeholder')).map((c) => c.dataset.id));
    const order0 = await cardIds();
    const h = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await pointer(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', h.x, 790); await p.waitForTimeout(200); // auto-scroll i gang
    const lifted = await p.evaluate(() => document.querySelectorAll('#board .card[data-dnd-dragging]').length);
    log('8b draget var aktivt før noden ble revet ut', lifted === 1, 'dragging=' + lifted);

    // Slik en synk-rebuild ville gjort det: noden ut av DOM. Draget kan da aldri
    // fullføres — første bevegelse etterpå skal rydde alt.
    await p.evaluate(() => { document.querySelector('#board .card[data-dnd-dragging]').remove(); });
    await pointer(p, 'pointermove', h.x, 700);
    await p.waitForTimeout(400);
    const r = await residue(p);
    log('8b ingen dra-merke / placeholder igjen', r.dragging === 0 && r.ph === 0, JSON.stringify(r));
    log('8b global dra-cursor fjernet', r.isDragging === false && r.cursor !== 'grabbing', 'cursor=' + r.cursor);
    log('8b board-vakt + overflowAnchor ryddet',
      r.boardGuard === '|' && r.overflowAnchor === '', 'guard=' + r.boardGuard + ' anchor=' + r.overflowAnchor);

    // Auto-scrollen skal være stoppet: scroll-posisjonen står stille etterpå.
    const y1 = await p.evaluate(() => window.scrollY);
    await p.waitForTimeout(400);
    const y2 = await p.evaluate(() => window.scrollY);
    log('8b auto-scroll stoppet', Math.abs(y2 - y1) < 2, 'y1=' + y1 + ' y2=' + y2);

    const order1 = await cardIds();
    log('8b avbrutt drag lagret ingen ny rekkefølge for de gjenværende',
      JSON.stringify(order1) === JSON.stringify(order0.filter((id) => id !== 'card-A')),
      order0.join(',') + ' → ' + order1.join(','));
    // Den døde noden settes ikke inn igjen (ville gitt et spøkelses-duplikat), og
    // et etterfølgende slipp committer ingenting.
    await pointer(p, 'pointerup', h.x, 700); await p.waitForTimeout(300);
    const order2 = await p.evaluate(() => [...document.querySelectorAll('.board .card')].map((c) => c.dataset.id));
    log('8b slipp etter at noden forsvant gjenoppliver den ikke',
      JSON.stringify(order2) === JSON.stringify(order1), order2.join(','));
    log('8b ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 9) Ekstern window-scroll under listepunkt-/kategori-drag ===== */
  for (const K of [{ n: 'listepunkt', sel: '.item[data-id="it-A-3"]', drag: '#board .item[data-dnd-dragging]' },
    { n: 'kategori', sel: '.category[data-id="cat-A"] .cat-head', drag: '#board .category[data-dnd-dragging]' }]) {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 12, 4], ['B', 20]]);
    // Rull målet inn i syne (kategorien ligger langt nede) — og la det være rom
    // igjen under, så den eksterne scrollen under draget faktisk kan skje.
    await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), K.sel);
    await p.waitForTimeout(250);

    const src = await centerOf(p, K.sel);
    await pointer(p, 'pointerdown', src.x, src.y); await p.waitForTimeout(260);
    await pointer(p, 'pointermove', src.x, src.y + 6); await p.waitForTimeout(400); // kategori-kollapsen ferdig
    const off1 = await dragTopOffset(p, K.drag, src.y + 6);
    // Siden scroller UTENFOR draget (momentum/klemme/tastatur) — objektet ligger i
    // dokument-koordinater og må reposisjoneres for å bli liggende under pekeren.
    await p.evaluate(() => window.scrollBy(0, 150)); await p.waitForTimeout(150);
    const off2 = await dragTopOffset(p, K.drag, src.y + 6);
    const scrolled = await p.evaluate(() => Math.round(window.scrollY));
    log('9 ' + K.n + ': siden scrollet faktisk', scrolled > 100, 'scrollY=' + scrolled);
    log('9 ' + K.n + ': objektet ligger fortsatt under pekeren etter ekstern scroll',
      Math.abs(off2 - off1) < 3, 'off1=' + off1.toFixed(1) + ' off2=' + off2.toFixed(1));
    await pointer(p, 'pointerup', src.x, src.y + 6); await p.waitForTimeout(500);
    log('9 ' + K.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 10/11) Scroll etter liste-slipp ===== */
  {
    /* Toppmenyen har fått ÉN RAD TIL — hovedfanene `Lister | Notater`
       (docs/notater-plan.md) — og den koster board-et 48 px. Sjekk 10 hviler
       på at lista er FULLT SYNLIG allerede før slippet, altså på hvor mye
       plass board-et har under panelet; med den samme viewporthøyden ville
       forutsetningen ikke lenger holdt, og en scroll som bringer lista i syne
       hadde vært riktig. Viewporten får derfor plassen tilbake. */
    const p = await b.newPage({ viewport: { width: 500, height: 900 + 48 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 4], ['B', 4], ['C', 4], ['D', 4], ['E', 4]]);

    const geom = () => p.evaluate(() => {
      const bd = document.querySelector('.board');
      const gap = parseFloat(getComputedStyle(bd).columnGap) || 16;
      const tb = document.getElementById('topbar').getBoundingClientRect().height;
      return { gap, safeTop: tb + gap, safeBottom: window.innerHeight - gap, vh: window.innerHeight, y: Math.round(window.scrollY) };
    });

    /* --- 10) Allerede fullt synlig → viewporten står stille --- */
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    const g0 = await geom();
    let h = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await pointer(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260);
    const bHead = await centerOf(p, '.card[data-id="card-B"] .card-head'); // etter kollapsen
    await pointer(p, 'pointermove', h.x, bHead.y + 6); await p.waitForTimeout(120);
    await pointer(p, 'pointerup', h.x, bHead.y + 6); await p.waitForTimeout(900);
    const after10 = await p.evaluate(() => {
      const r = document.querySelector('.card[data-id="card-A"]').getBoundingClientRect();
      return {
        y: Math.round(window.scrollY), top: Math.round(r.top), bottom: Math.round(r.bottom),
        second: [...document.querySelectorAll('.board .card')].map((c) => c.dataset.id)[1] === 'card-A',
      };
    });
    log('10 lista byttet plass (forutsetningen: den ligger nå som nummer to)', after10.second === true);
    log('10 lista er fullt synlig etter slippet',
      after10.top >= g0.safeTop - 2 && after10.bottom <= g0.safeBottom + 2,
      JSON.stringify(after10) + ' safe=' + Math.round(g0.safeTop) + '..' + Math.round(g0.safeBottom));
    log('10 viewporten står stille når lista allerede er synlig',
      Math.abs(after10.y - g0.y) < 2, 'før=' + g0.y + ' etter=' + after10.y);

    /* --- 11) Skjult etter gjenutvidelsen → kortest mulige scroll --- */
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(250);
    const g1 = await geom();
    h = await centerOf(p, '.board .card:first-of-type .card-head');
    const firstId = await p.evaluate(() => document.querySelector('.board .card').dataset.id);
    await pointer(p, 'pointerdown', h.x, h.y); await p.waitForTimeout(260);
    const heads = await p.evaluate(() => [...document.querySelectorAll('.board .card .card-head')]
      .map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));
    const lastHead = heads[heads.length - 1];
    await pointer(p, 'pointermove', h.x, lastHead + 10); await p.waitForTimeout(120);
    await pointer(p, 'pointerup', h.x, lastHead + 10); await p.waitForTimeout(1100);
    const after11 = await p.evaluate((id) => {
      const r = document.querySelector('.card[data-id="' + id + '"]').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.board .card')].map((c) => c.dataset.id);
      return { y: Math.round(window.scrollY), top: Math.round(r.top), bottom: Math.round(r.bottom), last: cards[cards.length - 1] === id };
    }, firstId);
    log('11 lista havnet nederst (forutsetningen for testen)', after11.last === true);
    log('11 lista er synlig etter slippet', after11.top >= g1.safeTop - 2 && after11.bottom <= g1.safeBottom + 4,
      JSON.stringify(after11) + ' safe=' + Math.round(g1.safeTop) + '..' + Math.round(g1.safeBottom));
    log('11 scrollet KORTEST mulig (nedre kant i syne, ikke toppjustert)',
      Math.abs(after11.bottom - g1.safeBottom) < 10 && after11.top > g1.safeTop + 50,
      'bottom=' + after11.bottom + ' safeBottom=' + Math.round(g1.safeBottom) + ' top=' + after11.top);
    log('10/11 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
