/*
  Regresjonstest: TEKST KAN IKKE MARKERES MENS ET DRAG PÅGÅR.

  Dra-gesten ER den gesten en nettleser ellers markerer tekst med: knappen er
  nede og pekeren beveger seg. `body.is-dragging` slo av markering på body, men
  tre regler setter `user-select: text` PÅ etterkommere (`.item-text`,
  `.card-title`, `.edit-input`), og en eksplisitt verdi på et barn slår arven —
  så titlene ble markert av selve draget, og markeringen ble stående blå
  etterpå.

  Dekker:
    1. Under et aktivt drag er den brukte `user-select` `none` på nettopp de
       tre elementene som ellers sier `text` — den regelen som faktisk gjelder,
       ikke bare den vi skrev.
    2. En gest som drar over titler etterlater ingen markering.
    3. En markering som alt LÅ der når draget begynner, ryddes.
    4. UTENFOR et drag er markering fortsatt tillatt der den er ment å være:
       regelen skal ikke ha slått den av permanent.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-selection.test.js
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

// Én liste med tre listepunkter — nok tekst til å dra over.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const c = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    ['Melk og brød', 'Kaffe og te', 'Epler og pærer'].forEach((t, i) =>
      c.items.push(mk({ id: 'I' + i, home: 'L1', text: t, cat: null, isCat: false, pos: i })));
    g.cards.push(c);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);
}

// Den BRUKTE verdien, ikke den vi skrev: det er den som avgjør.
const brukt = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return cs.userSelect || cs.webkitUserSelect;
}, sel);
const markering = (p) => p.evaluate(() => (window.getSelection() || { toString: () => '' }).toString());

async function run(label, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  console.log('\n== ' + label + ' ==');
  await register(p);
  await seed(p);

  const rad = '.item[data-id="I0"]';
  const tittel = '.card[data-id="L1"] .card-title';

  /* ---------- 4 (først, som kontroll): utenfor et drag er markering tillatt ---------- */
  const førDrag = {
    tekst: await brukt(p, rad + ' .item-text'),
    tittel: await brukt(p, tittel),
  };
  log(label + ' 4: utenfor et drag er tekst fortsatt markerbar',
    førDrag.tekst === 'text' && førDrag.tittel === 'text', JSON.stringify(førDrag));

  /* ---------- 3: en markering som alt lå der ryddes ved løft ---------- */
  await p.evaluate((s) => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, rad + ' .item-text');
  const merketFør = await markering(p);

  /* ---------- 1 + 2: under draget ---------- */
  const start = await G.centre(p, rad);
  await G.lift(p, start, touch);
  const under = {
    tekst: await brukt(p, rad + ' .item-text'),
    tittel: await brukt(p, tittel),
    body: await brukt(p, 'body'),
    markering: await markering(p),
  };
  log(label + ' 1: `user-select` er `none` på elementene som ellers sier `text`',
    under.tekst === 'none' && under.tittel === 'none' && under.body === 'none',
    JSON.stringify({ tekst: under.tekst, tittel: under.tittel, body: under.body }));
  log(label + ' 3: markeringen som lå der da draget begynte er ryddet',
    merketFør.length > 0 && under.markering === '',
    JSON.stringify({ før: merketFør, under: under.markering }));

  // Dra forbi de to andre radene — nettopp den gesten som ellers markerer.
  await G.travel(p, await G.centre(p, '.item[data-id="I2"]'), touch);
  const underveis = await markering(p);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);
  const etter = await markering(p);
  log(label + ' 2: et drag over titlene markerer ingenting — verken under eller etter',
    underveis === '' && etter === '', JSON.stringify({ underveis, etter }));

  /* ---------- 4 igjen: regelen gjaldt BARE under draget ---------- */
  const etterDrag = {
    tekst: await brukt(p, rad + ' .item-text'),
    tittel: await brukt(p, tittel),
    dragFlagg: await p.evaluate(() => document.body.classList.contains('is-dragging')),
  };
  log(label + ' 4: … og etter slippet er markering tillatt igjen',
    etterDrag.tekst === 'text' && etterDrag.tittel === 'text' && etterDrag.dragFlagg === false,
    JSON.stringify(etterDrag));

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
