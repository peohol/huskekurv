/*
  Regresjonstest: TOPPKONTROLLGRUPPEN i øvre høyre hjørne
  (`.corner-controls` — varsler, kalender, søk, drakt, konto). Se
  docs/menus.md («Toppkontrollene») og docs/design-system.md.

  Gruppen erstattet to knapper som hver hadde sin egen `right:`-utregning.
  Poenget med denne fila er å låse at den TÅLER FLERE: kalender-, varsel- og
  idéknappen kom til uten en eneste ny utregning, og gruppen er fortsatt
  nøyaktig to rader under 560 px — en sjette knapp koster ikke board-et høyde.

  Dekker:
     1. Gruppen finnes, og knappene ligger i rekkefølgen varsler → kalender →
        søk → idéer → drakt → konto (DOM og visuelt), med kontoknappen ytterst.
     2. Alle knappene har kontrollhøyden, samme overkant og lik luft mellom seg
        — ingen av dem er mindre enn berøringsmålet.
     3. Kontoknappen flukter fortsatt med toppmenyens høyre kant.
     4. `--corner-btns-w` MÅLES av appen (gruppens bredde + luften), og er det
        toppmenyen holder av plass med: `.toolbar`s margin på én linje,
        `.breadcrumb`s padding i det stablede mobiloppsettet.
     5. Ingen kollisjon: verken breadcrumben eller listefunksjonene når inn
        under gruppen.
     6. Board-ets klaring ligger under HELE chromet, også når gruppen er
        lavere/høyere enn toppmenyen.
     7. Den sikre sonen: gruppen legger insetene på sin egen avstand, holder
        seg innenfor det brukbare feltet og flukter fortsatt med toppmenyen.
     8. Gruppen SKALERER: legger man til flere knapper, følger den målte
        bredden med, rekkefølgen holder, ingenting kolliderer, og når raden er
        full brytes gruppen nedover — med board-klaringen etter seg. De ekstra
        radene legger seg ALDRI oppå toppmenyens kontroller: overskuddet
        (`--corner-btns-overflow`) skyves inn i panelets padding-top.
     9. Hele gruppen er skjult før innlogging.

  Kjøres på BÅDE desktop- og mobil-viewport (toppmenyen er én linje over
  560 px og to rader under).

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/corner-controls.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const nær = (a, b, slack = 1) => Math.abs(a - b) <= slack;
// Knappene radvis, øverste rad først — gruppen er ÉN rad på bred skjerm og to
// på smal (drakt+konto øverst, kalender+søk under).
const radvis = (kids) => {
  const byTop = new Map();
  kids.forEach((k) => { if (!byTop.has(k.top)) byTop.set(k.top, []); byTop.get(k.top).push(k); });
  // Sortert på `left`, ikke DOM-rekkefølge: `order` kan flytte en knapp.
  return [...byTop.entries()].sort((a, b) => a[0] - b[0])
    .map(([, v]) => v.sort((a, b) => a.left - b.left));
};

// Fire ULIKE tall, så en regel som bruker feil kant blir synlig.
const SONE = { top: 48, right: 24, bottom: 32, left: 16 };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function buildDB() {
  const uid = 'uC';
  const UA = U(), GA = U();
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'c', pos: 0, pos_ts: 1, pos_org: 'c',
  }, x);
  const cards = [];
  const items = [];
  for (let i = 0; i < 6; i++) {
    const cid = U();
    cards.push(base({ id: cid, owner_id: uid, group_id: GA, title: 'Liste ' + i, pos: i,
      k: true, p: true, lab_ts: 0, lab_org: '' }));
    items.push(base({ id: U(), owner_id: uid, card_id: cid, text: 'Punkt ' + i, done: false }));
  }
  return { uid, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'c@x.no', display_name: 'Kontroll', user_metadata: {} }],
    passwords: { 'c@x.no': 'x' },
    universes: [base({ id: UA, owner_id: uid, name: 'Hjemme' })],
    groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Ukesplan' })],
    cards, items,
    memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [],
  } };
}

// Geometrien til gruppen og knappene i den, pluss tallene toppmenyen bruker.
const geo = (p) => p.evaluate(() => {
  const g = document.getElementById('corner-controls');
  const gr = g.getBoundingClientRect();
  const kids = [...g.children].map((k) => {
    const r = k.getBoundingClientRect();
    return { id: k.id || null, left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      w: Math.round(r.width), h: Math.round(r.height) };
  });
  const bar = document.getElementById('topbar').getBoundingClientRect();
  const barCs = getComputedStyle(document.getElementById('topbar'));
  const toolbar = document.querySelector('.topbar .toolbar');
  const first = document.querySelector('.app-main .card');
  /* Kontrollenes EGNE kanter, ikke beholdernes: i det stablede mobiloppsettet
     strekker både `.breadcrumb` og `.toolbar` seg over hele bredden, og det er
     paddingen/marginen i dem som holder innholdet unna hjørnegruppen. */
  const høyreKant = (sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden || !el.offsetParent) return 0;
    return Math.round(el.getBoundingClientRect().right);
  };
  const rootCs = getComputedStyle(document.documentElement);
  return {
    group: { left: Math.round(gr.left), right: Math.round(gr.right), top: Math.round(gr.top),
      bottom: Math.round(gr.bottom), w: Math.round(gr.width), h: Math.round(gr.height) },
    kids,
    gap: parseFloat(getComputedStyle(g).columnGap) || 0,
    kontrollH: parseFloat(rootCs.getPropertyValue('--control-h')),
    token: parseFloat(rootCs.getPropertyValue('--corner-btns-w')),
    padTop: parseFloat(rootCs.getPropertyValue('--board-pad-top')),
    barBottom: Math.round(bar.bottom),
    /* Panelets INNHOLDSHØYDE (uten padding) MINUS hovedbryterens rad: så mange
       gruppe-rader kan ligge ved siden av panelet uten at noe må skyves ned.
       Bryteren (`Lister ↔ Notater`, docs/notater-plan.md) ligger ALENE på
       panelets øverste linje, sentrert i hele bredden, og hjørnegruppen
       begynner først UNDER den (--main-tabs-h, styles.css) — den raden er
       derfor ikke plass gruppen kan legge seg ved siden av. */
    barContent: Math.round(document.getElementById('topbar').clientHeight
      - parseFloat(barCs.paddingTop) - parseFloat(barCs.paddingBottom)
      - (parseFloat(rootCs.getPropertyValue('--main-tabs-h')) || 0)),
    barPadRight: parseFloat(barCs.paddingRight),
    crumbRight: høyreKant('#nav-crumb'),
    crumbPadRight: parseFloat(getComputedStyle(document.querySelector('.breadcrumb')).paddingRight),
    toolbarRight: Math.max(høyreKant('#add-card-btn'), høyreKant('#trash-btn')),
    toolbarMarginRight: parseFloat(getComputedStyle(toolbar).marginRight),
    overflow: parseFloat(rootCs.getPropertyValue('--corner-btns-overflow')) || 0,
    // Gruppens rader, hver som ett rektangel (radene er høyrestilte).
    rader: (() => {
      const byTop = new Map();
      [...g.children].forEach((k) => {
        const r = k.getBoundingClientRect();
        const key = Math.round(r.top);
        const cur = byTop.get(key) || { top: key, bottom: Math.round(r.bottom), left: Infinity, right: -Infinity };
        cur.left = Math.min(cur.left, Math.round(r.left));
        cur.right = Math.max(cur.right, Math.round(r.right));
        byTop.set(key, cur);
      });
      return [...byTop.values()].sort((a, b) => a.top - b.top);
    })(),
    // Hele rektangler, til kollisjonstesten når gruppen er brutt til flere rader.
    kontroller: ['#nav-crumb', '#add-card-btn', '#trash-btn'].map((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hidden || !el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      return { sel, left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }).filter(Boolean),
    førsteKortTopp: first ? Math.round(first.getBoundingClientRect().top) : null,
    vw: window.innerWidth,
  };
});

// Vent på at ResizeObserver-en har skrevet den målte bredden.
async function ventPåMåling(p, før) {
  await p.waitForFunction((f) => {
    const v = document.documentElement.style.getPropertyValue('--corner-btns-w');
    return v && v !== f;
  }, før, { timeout: 4000, polling: 50 }).catch(() => { /* uendret bredde er lov */ });
  await p.waitForTimeout(120);
}

async function settSone(p, s) {
  await p.evaluate((sone) => {
    const r = document.documentElement.style;
    if (!sone) { ['top', 'right', 'bottom', 'left'].forEach((k) => r.removeProperty('--safe-' + k)); return; }
    Object.keys(sone).forEach((k) => r.setProperty('--safe-' + k, sone[k] + 'px'));
  }, s || null);
  await p.waitForTimeout(200);
}

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport }, mobile ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  const { uid, db } = buildDB();

  /* ---------- 9) Skjult før innlogging ---------- */
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(700);
  log(label + ' 9: hele gruppen er skjult før innlogging',
    !(await p.locator('#corner-controls').isVisible()));

  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email: 'c@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(400);

  /* ---------- 1–2) Rekkefølge, størrelse, luft ---------- */
  const g = await geo(p);
  const ids = g.kids.map((k) => k.id);
  log(label + ' 1a: gruppen holder varsler, kalender, søk, idéer, drakt og konto i den rekkefølgen',
    JSON.stringify(ids) === JSON.stringify(['notif-btn', 'events-btn', 'search-btn', 'ideas-btn', 'theme-toggle-btn', 'account-btn']),
    JSON.stringify(ids));
  const rader0 = radvis(g.kids);
  log(label + ' 1b: kontoknappen ligger ytterst til høyre i sin rad',
    rader0.every((rad) => rad.every((k, i) => i === 0 || k.right >= rad[i - 1].right)) &&
    rader0[0][rader0[0].length - 1].id === 'account-btn',
    JSON.stringify(rader0.map((rad) => rad.map((k) => k.id + '@' + k.right))));
  log(label + ' 2a: alle knappene er kvadratiske og har kontrollhøyden',
    g.kids.every((k) => nær(k.w, g.kontrollH) && nær(k.h, g.kontrollH)),
    JSON.stringify(g.kids.map((k) => k.w + 'x' + k.h)) + ' vs ' + g.kontrollH);
  /* Oppsettet er ULIKT i de to bredene, med vilje: på bred skjerm står alle
     seks på én linje, på smal deles gruppen i to rader. Delingen gjøres av
     `wrap-reverse`, ikke av `order`: flex fyller den første linjen med de tre
     første i DOM-en, og `wrap-reverse` legger den SISTE linjen øverst. */
  const forventet = mobile
    ? [['ideas-btn', 'theme-toggle-btn', 'account-btn'], ['notif-btn', 'events-btn', 'search-btn']]
    : [['notif-btn', 'events-btn', 'search-btn', 'ideas-btn', 'theme-toggle-btn', 'account-btn']];
  log(label + ' 2b: knappene står i forventet rad-oppsett',
    JSON.stringify(rader0.map((rad) => rad.map((k) => k.id))) === JSON.stringify(forventet),
    JSON.stringify(rader0.map((rad) => rad.map((k) => k.id))));
  const gaps = rader0.reduce((a, rad) => a.concat(rad.slice(1).map((k, i) => k.left - rad[i].right)), []);
  log(label + ' 2c: lik luft mellom knappene, og den er gruppens gap',
    gaps.length > 0 && gaps.every((x) => nær(x, g.gap)), JSON.stringify(gaps) + ' vs gap ' + g.gap);
  log(label + ' 2d: ingen knapp er under berøringsmålet på 44 px',
    g.kids.every((k) => k.w >= 44 && k.h >= 44), JSON.stringify(g.kids.map((k) => k.w)));

  /* ---------- 3) Fluktingen med toppmenyen ---------- */
  const flukt = g.vw - g.group.right;
  log(label + ' 3: gruppen flukter med toppmenyens høyre kant',
    nær(flukt, g.barPadRight), 'gruppe ' + Math.round(flukt) + ' vs panel-padding ' + g.barPadRight);

  /* ---------- 4) Den MÅLTE bredden ---------- */
  log(label + ' 4a: --corner-btns-w er gruppens målte bredde + luften',
    nær(g.token, g.group.w + g.gap), g.token + ' vs ' + (g.group.w + g.gap));
  if (mobile) {
    /* BEGGE panelradene holder av plassen her: gruppen er også to rader så
       smalt, og da ligger én gruppe-rad ved siden av hver av dem. */
    log(label + ' 4b: begge panelradene holder av plassen (stablet oppsett)',
      nær(g.crumbPadRight, g.token) && nær(g.toolbarMarginRight, g.token),
      'crumb-padding ' + g.crumbPadRight + ', toolbar-margin ' + g.toolbarMarginRight);
  } else {
    log(label + ' 4b: listefunksjonene holder av plassen (én linje)',
      nær(g.toolbarMarginRight, g.token) && g.crumbPadRight === 0,
      'toolbar-margin ' + g.toolbarMarginRight + ', crumb-padding ' + g.crumbPadRight);
  }

  /* ---------- 5) Ingen kollisjon ---------- */
  const sisteIToppmeny = mobile ? g.crumbRight : Math.max(g.crumbRight, g.toolbarRight);
  log(label + ' 5: toppmenyens innhold når ikke inn under gruppen',
    sisteIToppmeny <= g.group.left + 1, 'toppmeny høyre ' + sisteIToppmeny + ' ≤ gruppe venstre ' + g.group.left);

  /* ---------- 6) Board-klaringen ---------- */
  log(label + ' 6a: klaringen ligger under HELE chromet',
    g.padTop >= Math.max(g.barBottom, g.group.bottom) - 1,
    'pad-top ' + Math.round(g.padTop) + ', meny bunn ' + g.barBottom + ', gruppe bunn ' + g.group.bottom);
  log(label + ' 6b: første kort ligger under gruppen',
    g.førsteKortTopp !== null && g.førsteKortTopp >= g.group.bottom - 1,
    'kort topp ' + g.førsteKortTopp + ', gruppe bunn ' + g.group.bottom);

  /* ---------- 7) Den sikre sonen ---------- */
  const førSone = await p.evaluate(() => document.documentElement.style.getPropertyValue('--corner-btns-w'));
  await settSone(p, SONE);
  const s = await geo(p);
  log(label + ' 7a: gruppen skyves ned forbi statusfeltet',
    nær(s.group.top, g.group.top + SONE.top), g.group.top + ' → ' + s.group.top + ' (sone ' + SONE.top + ')');
  log(label + ' 7b: gruppen tar hakket i høyre side',
    nær(s.vw - s.group.right, (g.vw - g.group.right) + SONE.right),
    'høyre ' + (g.vw - g.group.right) + ' → ' + (s.vw - s.group.right));
  log(label + ' 7c: gruppen ligger innenfor det brukbare feltet',
    s.group.left >= SONE.left - 1 && s.group.right <= s.vw - SONE.right + 1 && s.group.top >= SONE.top - 1,
    JSON.stringify(s.group));
  log(label + ' 7d: gruppen flukter fortsatt med toppmenyens kant',
    nær(s.vw - s.group.right, s.barPadRight),
    'gruppe ' + (s.vw - s.group.right) + ' vs panel-padding ' + s.barPadRight);
  log(label + ' 7e: klaringen følger med', s.padTop >= Math.max(s.barBottom, s.group.bottom) - 1,
    'pad-top ' + Math.round(s.padTop) + ', chrome bunn ' + Math.max(s.barBottom, s.group.bottom));
  await settSone(p, null);
  await p.waitForTimeout(200);
  void førSone;

  /* ---------- 8) Gruppen skalerer ---------- */
  // To knapper til — nøyaktig det kalender- og varselknappen gjorde: en ny
  // `.corner-btn` FØRST i gruppen. Ingen CSS-verdi skal måtte endres.
  const førBredde = await p.evaluate(() => document.documentElement.style.getPropertyValue('--corner-btns-w'));
  await p.evaluate(() => {
    const g = document.getElementById('corner-controls');
    for (let i = 0; i < 2; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'corner-btn';
      b.id = 'fremtid-' + i;
      g.insertBefore(b, g.firstElementChild);
    }
  });
  await ventPåMåling(p, førBredde);
  const f = await geo(p);
  log(label + ' 8a: de nye knappene står først, konto fortsatt ytterst',
    f.kids.length === g.kids.length + 2 && f.kids[0].id === 'fremtid-1' &&
    f.kids[f.kids.length - 1].id === 'account-btn',
    JSON.stringify(f.kids.map((k) => k.id)));
  /* Den målte bredden er alltid gruppens SISTE rad + luften. På bred skjerm
     vokser den med de nye knappene; på smal er siste rad fortsatt kalender +
     søk, så bredden står stille og det er HØYDEN som vokser. */
  log(label + ' 8b: den målte bredden følger fortsatt gruppens siste rad',
    nær(f.token, f.rader[f.rader.length - 1].right - f.rader[f.rader.length - 1].left + f.gap) &&
    (mobile ? nær(f.token, g.token) && f.group.h > g.group.h : f.token > g.token),
    g.token + ' → ' + f.token + ', høyde ' + g.group.h + ' → ' + f.group.h);
  log(label + ' 8c: gruppen flukter fortsatt med toppmenyens kant',
    nær(f.vw - f.group.right, f.barPadRight),
    'gruppe ' + (f.vw - f.group.right) + ' vs panel-padding ' + f.barPadRight);
  const sisteNå = mobile ? f.crumbRight : Math.max(f.crumbRight, f.toolbarRight);
  log(label + ' 8d: toppmenyens innhold viker fortsatt for gruppen',
    sisteNå <= f.group.left + 1, 'toppmeny høyre ' + sisteNå + ' ≤ gruppe venstre ' + f.group.left);
  log(label + ' 8e: gruppen ligger innenfor viewportet',
    f.group.left >= 0 && f.group.right <= f.vw, JSON.stringify(f.group));

  // Fyll raden helt: da skal gruppen BRYTE nedover, ikke krympe knappene eller
  // renne ut av skjermen — og board-klaringen skal følge etter. Antallet
  // avhenger av skjermbredden, så det legges til knapper til raden faktisk er
  // full (med et tak, så en regresjon blir en FAIL og ikke en evig løkke).
  const antallFørBrudd = await p.evaluate(() => {
    const g = document.getElementById('corner-controls');
    const rader = () => new Set([...g.children].map((k) => Math.round(k.getBoundingClientRect().top))).size;
    const start = rader();   // 1 på bred skjerm, 2 på smal (se 2b)
    let n = 0;
    // Stopp ved FØRSTE brudd: da er siste rad delvis fylt, som den ville vært
    // med et realistisk antall knapper. Fyller vi videre til hver rad er full,
    // spiser gruppen hele linjebredden, og da finnes det ingen plass igjen å
    // holde av — et scenario ingen knapperekke faktisk havner i.
    while (rader() === start && n < 40) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'corner-btn';
      b.id = 'fyll-' + n;
      g.insertBefore(b, g.firstElementChild);
      n++;
    }
    return n;
  });
  await p.waitForTimeout(400);
  const w = await geo(p);
  const rader = new Set(w.kids.map((k) => k.top)).size;
  log(label + ' 8f: gruppen brytes til flere rader i stedet for å renne ut',
    rader > 1 && w.group.right <= w.vw && w.group.left >= 0,
    rader + ' rader etter ' + antallFørBrudd + ' ekstra knapper, gruppe '
      + JSON.stringify(w.group) + ', vw ' + w.vw);
  log(label + ' 8g: ingen knapp krympet under kontrollhøyden',
    w.kids.every((k) => nær(k.w, w.kontrollH) && nær(k.h, w.kontrollH)),
    JSON.stringify([...new Set(w.kids.map((k) => k.w + 'x' + k.h))]));
  log(label + ' 8h: board-klaringen følger gruppens nye underkant',
    w.padTop >= Math.max(w.barBottom, w.group.bottom) - 1,
    'pad-top ' + Math.round(w.padTop) + ', gruppe bunn ' + w.group.bottom);
  /* Kontoknappen ender fortsatt sin rad ytterst til høyre — den NEDERSTE raden
     på bred skjerm, den ØVERSTE på smal (der kalender/søk ligger under den). */
  const raderNå = radvis(w.kids);
  const kontoRad = raderNå.find((rad) => rad.some((k) => k.id === 'account-btn'));
  log(label + ' 8i: kontoknappen ender fortsatt sin rad ytterst til høyre',
    !!kontoRad && kontoRad[kontoRad.length - 1].id === 'account-btn'
      && kontoRad[kontoRad.length - 1].right === Math.max(...w.kids.map((k) => k.right))
      && (mobile ? kontoRad === raderNå[0] : kontoRad === raderNå[raderNå.length - 1]),
    JSON.stringify(raderNå.map((rad) => rad.map((k) => k.id))));
  /* Selve poenget med bruddet: de ekstra radene skal ikke legge seg OPPÅ
     toppmenyens kontroller. Den horisontale klaringen (--corner-btns-w) gjelder
     bare den raden menyen selv står på, så overskuddet må skyves inn i panelets
     padding-top — da ligger menyens FØRSTE rad ved siden av gruppens SISTE. */
  /* Overskuddet er de gruppe-radene panelet IKKE har en egen rad ved siden av:
     gruppens høyde minus panelets INNHOLDSHØYDE. Panelet har én rad på bred
     skjerm og to på smal, og hver av dem holder av den samme klaringen. */
  log(label + ' 8j: overskuddet over panelets egne rader er skjøvet inn i panelet',
    nær(w.overflow, Math.max(0, w.group.h - w.barContent), 2),
    'overflow ' + w.overflow + ', gruppe ' + w.group.h + ' - panelinnhold ' + w.barContent);
  const øversteKontroll = Math.min(...w.kontroller.map((k) => k.top));
  log(label + ' 8k: ingen kontroll ligger under gruppens EKSTRA rader',
    øversteKontroll >= w.group.top + w.overflow - 1,
    'øverste kontroll ' + øversteKontroll + ' ≥ gruppens siste rad ' + (w.group.top + w.overflow));
  // RADENE, ikke gruppens omsluttende boks: den siste raden er delvis fylt, og
  // det er den toppmenyens linje ligger ved siden av.
  const dekket = w.kontroller.filter((k) => w.rader.some((r) =>
    k.left < r.right && k.right > r.left && k.top < r.bottom && k.bottom > r.top));
  log(label + ' 8l: ingen toppmeny-kontroll blir dekket av en knapperad',
    dekket.length === 0,
    'rader ' + JSON.stringify(w.rader) + ' vs ' + JSON.stringify(dekket.length ? dekket : w.kontroller));
  const bredest = Math.max(...w.rader.map((r) => r.right - r.left));
  log(label + ' 8m: den målte bredden gjelder gruppens BREDESTE rad',
    nær(w.token, bredest + w.gap),
    'token ' + w.token + ' vs bredeste rad ' + bredest + ' + gap ' + w.gap);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
