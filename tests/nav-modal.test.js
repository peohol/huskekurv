/*
  Regresjonstest: NAVIGASJONSMODALEN (områder + mapper).

  Én nav-knapp i toppmenyen viser hele lokasjonen (🌐 område › 📁 mappe) og
  åpner ÉN modal for begge nivåene. Der er områdene KORT og mappene RADER —
  nøyaktig samme oppsett (og samme dra-og-slipp-motor) som lister og
  listepunkter, bare alltid i én kolonne. Testen dekker:

    1. Én nav-knapp; de gamle to modalene finnes ikke lenger.
    2. Områder rendres som `.card` med mappene som `.item` i `.items-container`,
       i ÉN kolonne.
    3. Alle tre nivåene har NØYAKTIG én knapp: objektmenyen (`.obj-menu-btn`).
       De gamle del-/forlat-/slett-/oppløs-knappene finnes ikke lenger.
    4. Kollaps av et område viser [mappe-ikon] + antall (ikke «(N)»).
    5. Klikk på raden — navnet inkludert — navigerer og lukker; omdøping
       ligger i menyen (og på F2).
    6. DnD: mappe mellom områder, mappe ut i «lufta» → nytt område,
       mappe inn i en mappekategori.
    7. Drar man mappa man STÅR i til et annet område, følger lokasjonen med.
    8. Tastatur: Enter/Mellomrom navigerer og kollapser uten peker.
    9. Slipp i et LÅST område rulles tilbake (DB-guarden ville avvist det), og
       mappe-kassen følger ikke med inn i et område som ikke tar imot mappa.
   10. [område-/mappe-ikon][delt-ikon]Navn, og ingen lys innerkant på kortet.
   11. Mappe-søppelkassen ligger i områdekortet; område-søppelkassen står i
       modalens faste fot, og foten kollapser HELT (ikke bare kassen) når den
       er tom.

  Kjør:
    python3 -m http.server 8000                  # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/nav-modal.test.js
*/
const { chromium } = require('playwright');

// Åpne objektmenyen på et objekt og velg en rad. Alt som før lå på en egen
// ikonknapp (slett, forlat, del, oppløs) ligger nå her.
async function menuPick(p, hostSel, label) {
  await p.locator(hostSel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(220);
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: label }).click();
  await p.waitForTimeout(220);
}

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

// To områder: «Hjemme» (mappe + mappekategori med ett medlem) og «Jobb».
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't', trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const uA = mk({ id: 'uni-A', name: 'Hjemme', collapsed: false, groups: [] });
    const uB = mk({ id: 'uni-B', name: 'Jobb', collapsed: false, groups: [], pos: 1 });
    uA.groups.push(mk({ id: 'g-a1', uni: 'uni-A', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] }));
    uA.groups.push(mk({ id: 'gc-1', uni: 'uni-A', name: 'Prosjekter', cat: null, isCat: true, collapsed: false, cards: [], pos: 1 }));
    uA.groups.push(mk({ id: 'g-a2', uni: 'uni-A', name: 'Hagen', cat: 'gc-1', isCat: false, collapsed: false, cards: [], pos: 2 }));
    uB.groups.push(mk({ id: 'g-b1', uni: 'uni-B', name: 'Møter', cat: null, isCat: false, collapsed: false, cards: [] }));
    st.universes.push(uA, uB);
    st.activeUniverse = 'uni-A'; st.activeGroup = 'g-a1';
    H.render();
  });
  await p.waitForTimeout(300);
}

// Områdene med mappene sine (nivå 1 + kategorimedlemmer), fra STATE.
const model = (p) => p.evaluate(() => window.__huskis.state.universes
  .filter((u) => !u.trashed && !u._pendingDelete)
  .sort((a, b) => a.pos - b.pos)
  .map((u) => u.name + '[' + u.groups
    .filter((g) => !g.trashed && !g._pendingDelete)
    .sort((a, b) => a.pos - b.pos)
    .map((g) => g.name + (g.isCat ? '*' : '') + (g.cat ? '@' + g.cat : ''))
    .join(',') + ']')
  .join(' '));

const open = async (p) => { await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(350); };

/* Står layouten i modalen i RO? Alle boksene måles i hver animasjonsramme, og
   løftet svarer først når `stille` påfølgende rammer er identiske.

   Hvorfor rammer og ikke stikkprøver: layouten flytter seg mens draget står på
   — kassene foldes ut som slippmål, kort kollapser, og modalen er loddrett
   sentrert, så den re-sentrerer hver gang innholdet endrer høyde. To målinger
   med 100 ms mellom kunne være like og boksen likevel i bevegelse. */
async function layoutIRo(p, stille = 3, maksRammer = 120) {
  return p.evaluate(([n, maks]) => new Promise((res) => {
    const snap = () => [].slice.call(document.querySelectorAll(
      '#nav-modal .card, #nav-modal .item, #nav-modal .category, #nav-modal .trashcan'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return [r.top, r.left, r.width, r.height].map(Math.round).join(',');
      }).join('|');
    let forrige = null, like = 0, rammer = 0;
    const tick = () => {
      const naa = snap();
      like = (forrige !== null && naa === forrige) ? like + 1 : 0;
      forrige = naa;
      if (like >= n || ++rammer >= maks) return res({ rammer, iRo: like >= n });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [stille, maksRammer]);
}

// Musedrag (desktop starter draget umiddelbart på bevegelse). `to` kan være en
// funksjon som måler målet på nytt underveis — layouten flytter seg mens man drar.
// `opts.beforeDrop` kjøres når pekeren står på målet og layouten er i ro, rett
// før slippet — der måles tilstanden MIDT i draget.
async function drag(p, fromSel, to, opts = {}) {
  const rounds = opts.rounds || 8;
  // Modalen er høyere enn mobilskjermen (tre seksjoner), så raden man drar fra
  // kan ligge delvis under modal-headeren. Rull den fram først — ellers treffer
  // pointerdown headeren i stedet for raden.
  await p.locator(fromSel).scrollIntoViewIfNeeded();
  await p.waitForTimeout(120);
  const a = await p.locator(fromSel).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 });
  await p.waitForTimeout(90);
  let siste = null;
  for (let i = 0; i < rounds; i++) {
    siste = typeof to === 'function' ? await to() : to;
    await p.mouse.move(siste.x, siste.y, { steps: 5 });
    await p.waitForTimeout(80);
  }
  /* Slipp først når layouten faktisk står stille OG pekeren står på det målet
     har NÅ. Mellom siste måling og slippet lå det før et ventevindu der boksen
     fortsatt kunne bevege seg — og et slipp noen piksler feil betyr noe helt
     annet (en rad over, eller søppelkassen under). */
  for (let i = 0; i < 6; i++) {
    await layoutIRo(p);
    const t = typeof to === 'function' ? await to() : to;
    if (siste && Math.abs(t.x - siste.x) < 1 && Math.abs(t.y - siste.y) < 1) break;
    await p.mouse.move(t.x, t.y, { steps: 2 });
    siste = t;
  }
  if (opts.beforeDrop) await opts.beforeDrop();
  await p.mouse.up();
  await p.waitForTimeout(650);
}

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');
  await register(p);
  await seed(p);

  /* ---------- 1) Én nav-knapp, én modal ----------
     Hver HOVEDFANE har sin egen breadcrumb (docs/notater-plan.md), og bare den
     aktive fanens rad er synlig. Kravet er derfor at LISTEFANEN har nøyaktig
     én — ikke at det finnes én i hele dokumentet. */
  const nav = await p.evaluate(() => ({
    crumbs: document.querySelectorAll('#topbar-row-lists .breadcrumb .crumb-btn').length,
    synlige: [...document.querySelectorAll('.breadcrumb .crumb-btn')]
      .filter((el) => el.getClientRects().length).length,
    oldModals: !!document.getElementById('uni-modal') || !!document.getElementById('group-modal'),
    text: document.getElementById('nav-crumb').innerText.replace(/\s+/g, ' ').trim(),
  }));
  log(label + ' 1: én navigasjonsknapp med hele lokasjonen',
    nav.crumbs === 1 && nav.synlige === 1 && nav.text === 'Hjemme › Ukesplan', JSON.stringify(nav));
  log(label + ' 1: de gamle område-/mappe-modalene er borte', nav.oldModals === false);

  await open(p);
  const title = await p.evaluate(() => {
    const h = document.getElementById('nav-modal-title');
    return { text: h.innerText.replace(/\s+/g, ' ').trim(), icons: h.querySelectorAll('svg.icon').length };
  });
  log(label + ' 1: modaltittelen er «[område] Områder og [mappe] mapper»',
    title.text === 'Områder og mapper' && title.icons === 2, JSON.stringify(title));

  /* ---------- 2) Samme oppsett som lister/listepunkter, én kolonne ---------- */
  const shape = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#nav-board .board-col > .card')];
    const board = document.getElementById('nav-board');
    return {
      cards: cards.map((c) => ({
        id: c.dataset.id,
        title: c.querySelector('.card-title').textContent,
        rows: [...c.querySelectorAll(':scope > .card-body > .items-container > .item')].map((i) => i.querySelector('.item-text').textContent),
        cats: [...c.querySelectorAll(':scope > .card-body > .items-container > .category')].map((k) => k.querySelector('.cat-title').textContent),
        catRows: [...c.querySelectorAll('.category .cat-items > .item')].map((i) => i.querySelector('.item-text').textContent),
        addBtns: c.querySelectorAll('.add-item-row > button').length,
      })),
      // Alle kort ligger på samme venstre kant → én kolonne.
      singleColumn: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size === 1,
      columnCount: board.querySelectorAll('.board-col').length,
    };
  });
  log(label + ' 2: hvert område er et kort med mappene som rader',
    shape.cards.length === 2 &&
    shape.cards[0].title === 'Hjemme' && shape.cards[0].rows.join() === 'Ukesplan' &&
    shape.cards[0].cats.join() === 'Prosjekter' && shape.cards[0].catRows.join() === 'Hagen' &&
    shape.cards[1].rows.join() === 'Møter',
    JSON.stringify(shape.cards));
  log(label + ' 2: alltid ÉN kolonne', shape.singleColumn === true && shape.columnCount === 1,
    'kolonner=' + shape.columnCount);
  log(label + ' 2: ＋-mappe og mappekategori-knapp i hvert område',
    shape.cards.every((c) => c.addBtns === 2));

  /* ---------- 3) Én knapp per objekt: objektmenyen ---------- */
  const btns = await p.evaluate(() => {
    const card = document.querySelector('#nav-board .card[data-id="uni-A"]');
    const row = card.querySelector('.item[data-id="g-a1"]');
    const cat = card.querySelector('.category[data-id="gc-1"]');
    const vis = (el) => [].slice.call(el.querySelectorAll(':scope > button'))
      .filter((b) => !b.hidden).map((b) => b.className);
    return {
      uniBtns: vis(card.querySelector('.card-head')),
      rowBtns: vis(row),
      catBtns: vis(cat.querySelector('.cat-head')),
      rowCheck: row.querySelectorAll('.item-check').length,
      legacy: document.querySelectorAll('#nav-board .uni-share, #nav-board .uni-delete,' +
        ' #nav-board .uni-leave, #nav-board .group-share, #nav-board .group-delete,' +
        ' #nav-board .group-leave, #nav-board .cat-dissolve').length,
    };
  });
  log(label + ' 3: områdekortet har kun objektmenyknappen',
    btns.uniBtns.length === 1 && /obj-menu-btn/.test(btns.uniBtns[0]), JSON.stringify(btns));
  log(label + ' 3: mappa har kun objektmenyknappen og ingen avmerkingsboks',
    btns.rowBtns.length === 1 && /obj-menu-btn/.test(btns.rowBtns[0]) && btns.rowCheck === 0);
  log(label + ' 3: mappekategorien har kun objektmenyknappen, og de gamle knappene er borte',
    btns.catBtns.length === 1 && /obj-menu-btn/.test(btns.catBtns[0]) && btns.legacy === 0);

  // Menyen: én meny for hele nivået, med de handlingene knappene hadde.
  await p.locator('#nav-board .card[data-id="uni-A"] .card-head .obj-menu-btn').click();
  await p.waitForTimeout(250);
  const uniMenu = await p.evaluate(() => ({
    hidden: document.getElementById('obj-menu').hidden,
    rows: [].slice.call(document.querySelectorAll('#obj-menu-panel .obj-menu-row'))
      .map((r) => r.querySelector('.obj-menu-label').textContent),
    navn: (document.querySelector('#obj-menu-panel .obj-menu-head-name') || {}).textContent,
  }));
  log(label + ' 3: menyen har omdøping, flytting, deling og sletting for området',
    uniMenu.hidden === false && uniMenu.navn === 'Hjemme' &&
    uniMenu.rows.includes('Endre navn') && uniMenu.rows.includes('Flytt') &&
    uniMenu.rows.includes('Deling og medlemmer') &&
    uniMenu.rows.includes('Slett området for alle'), JSON.stringify(uniMenu));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  /* ---------- 4) Kollaps viser [mappe-ikon] + antall ---------- */
  // Treff korthodet MELLOM tittelen og menyknappen (klikk på tittelen kollapser
  // også, men vi vil måle «resten» av headeren).
  // Måles på NYTT hver gang: modalen krymper når et område kollapser, og siden
  // den er vertikalt sentrert flytter kortene seg.
  const headHit = async () => p.evaluate(() => {
    const head = document.querySelector('#nav-board .card[data-id="uni-B"] .card-head');
    const t = head.querySelector('.card-title').getBoundingClientRect();
    const s = head.querySelector('.obj-menu-btn').getBoundingClientRect();
    const r = head.getBoundingClientRect();
    return { x: (t.right + s.left) / 2, y: r.top + r.height / 2 };
  });
  const clickHead = async () => { const h = await headHit(); await p.mouse.click(h.x, h.y); };
  await clickHead();
  await p.waitForTimeout(300);
  const cnt = await p.evaluate(() => {
    const c = document.querySelector('#nav-board .card[data-id="uni-B"] .collapse-count');
    return { hidden: c.hidden, text: c.textContent, icons: c.querySelectorAll('svg.icon').length,
      collapsed: !!window.__huskis.state.universes.find((u) => u.id === 'uni-B').collapsed };
  });
  log(label + ' 4: kollapset område viser [mappe-ikon] + antall (ikke «(N)»)',
    cnt.hidden === false && cnt.text === '1' && cnt.icons === 1 && cnt.collapsed === true,
    JSON.stringify(cnt));
  await clickHead(); // åpne igjen
  await p.waitForTimeout(300);

  /* ---------- 5) Klikk navigerer overalt; omdøping ligger i menyen ---------- */
  // Klikk PÅ NAVNET skal ikke lenger omdøpe: omdøping og navigering kjempet om
  // det samme trykket. Menyen er den ene veien inn.
  await p.locator('#nav-board .item[data-id="g-b1"] .item-text').click();
  await p.waitForTimeout(300);
  const nameClick = await p.evaluate(() => ({
    redigerer: !!document.querySelector('#nav-board .item[data-id="g-b1"] .edit-input'),
    lukket: document.getElementById('nav-modal').hidden,
    g: window.__huskis.state.activeGroup,
  }));
  log(label + ' 5: klikk på mappenavnet navigerer (omdøper ikke lenger)',
    nameClick.redigerer === false && nameClick.lukket === true && nameClick.g === 'g-b1',
    JSON.stringify(nameClick));

  await open(p);
  await p.locator('#nav-board .item[data-id="g-b1"] .obj-menu-btn').click();
  await p.waitForTimeout(250);
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: 'Endre navn' }).click();
  await p.waitForTimeout(300);
  log(label + ' 5: «Endre navn» i menyen åpner navneredigering',
    await p.evaluate(() => !!document.querySelector('#nav-board .item[data-id="g-b1"] .edit-input')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  const main = await p.locator('#nav-board .item[data-id="g-b1"] .item-main').boundingBox();
  await p.mouse.click(main.x + main.width - 8, main.y + main.height / 2);
  await p.waitForTimeout(450);
  const navigated = await p.evaluate(() => ({
    closed: document.getElementById('nav-modal').hidden,
    u: window.__huskis.state.activeUniverse, g: window.__huskis.state.activeGroup,
    crumb: document.getElementById('nav-crumb').innerText.replace(/\s+/g, ' ').trim(),
  }));
  log(label + ' 5: klikk ellers på raden navigerer til mappen og lukker modalen',
    navigated.closed === true && navigated.u === 'uni-B' && navigated.g === 'g-b1' &&
    navigated.crumb === 'Jobb › Møter', JSON.stringify(navigated));

  /* ---------- 6-10) DnD og rendring: pull + mappeflytting stubbes ----------
     Fikstur-radene har ikke UUID-er og finnes derfor ALDRI på «serveren». En
     pull ville nullstilt dem midt i scenarioet, og `move_group`-RPC-en (som en
     mappe som bytter område går gjennom) ville ventet forgjeves på at raden
     dukket opp. Begge deler hører til synken, som `sync-*`-testene dekker; her
     handler alt om dra-og-slipp og rendring. */
  await p.evaluate(() => {
    const c = window.__huskis.client;
    window.__navRealRpc = c.rpc.bind(c);
    c.rpc = (name, params) => {
      if (name === 'get_my_doc') return Promise.resolve({ data: null, error: { message: 'pull pauset i test' } });
      if (name === 'move_group') return Promise.resolve({ data: { mode: 'reparent', group: params.p_group, mapping: {} }, error: null });
      return window.__navRealRpc(name, params);
    };
  });

  /* ---------- 6) DnD: samme motor som lister/listepunkter ---------- */
  await open(p);
  // 6a) mappe fra Hjemme → Jobb
  await drag(p, '#nav-board .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .card[data-id="uni-B"] .items-container').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  });
  const m6a = await model(p);
  log(label + ' 6a: mappa flyttet til et annet område',
    m6a.startsWith('Hjemme[Prosjekter*,Hagen@gc-1] Jobb[') &&
    m6a.includes('Ukesplan') && m6a.includes('Møter'), m6a);

  // 6b) mappe ut i board-lufta under kortene → nytt område
  await open(p);
  await drag(p, '#nav-board .item[data-id="g-b1"]', async () => {
    const t = await p.locator('#nav-board').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height + 14 };
  });
  const extracted = await p.evaluate(() => {
    const st = window.__huskis.state;
    const nu = st.universes.find((u) => !['uni-A', 'uni-B'].includes(u.id));
    return nu ? nu.groups.map((g) => g.name).join() : 'INGEN';
  });
  log(label + ' 6b: mappe sluppet utenfor områdene lager et NYTT område',
    extracted === 'Møter', extracted);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250); // avbryt navngivingen

  // 6c) mappe inn i en mappekategori (slipp på overskriften)
  await open(p);
  await drag(p, '#nav-board .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .category[data-id="gc-1"] .cat-head').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  });
  const inCat = await p.evaluate(() => {
    const g = window.__huskis.state.universes.flatMap((u) => u.groups).find((x) => x.id === 'g-a1');
    return g ? (g.uni + '/' + (g.cat || '-')) : 'BORTE';
  });
  log(label + ' 6c: mappa ligger i mappekategorien', inCat === 'uni-A/gc-1', inCat);

  // 6d) hele mappekategorien ut i lufta → nytt område med medlemmene som mapper.
  // Frisk state først: 6a–6c har flyttet mappene rundt, og et kjent utgangspunkt
  // gjør at «under alle kortene» faktisk er board-luft og ikke det siste kortet.
  await seed(p);
  await open(p);
  await drag(p, '#nav-board .category[data-id="gc-1"] .cat-head', async () => {
    const t = await p.locator('#nav-board').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height + 40 };
  });
  const catOut = await p.evaluate(() => {
    const st = window.__huskis.state;
    const old = st.universes.find((u) => u.id === 'uni-A');
    const nu = st.universes.find((u) => u.groups.some((g) => g.id === 'g-a2'));
    return {
      kvar: old ? old.groups.filter((g) => !g.trashed).map((g) => g.name).join() : 'BORTE',
      nytt: nu ? nu.id + '|' + nu.name + ':' + nu.groups.map((g) => g.name + (g.cat ? '@' : '')).join() : 'INGEN',
    };
  });
  // Kategorien tar navnet sitt med seg; medlemmet «Hagen» blir en UKATEGORISERT
  // mappe i det nye området (ingen «@»), og «Ukesplan» blir igjen i uni-A.
  log(label + ' 6d: mappekategori sluppet utenfor områdene blir et NYTT område',
    catOut.nytt.endsWith('|Prosjekter:Hagen') && !catOut.nytt.startsWith('uni-A|') &&
    catOut.kvar === 'Ukesplan', JSON.stringify(catOut));

  /* ---------- 7) Den aktive mappen følger med når den bytter område ---------- */
  // Står man I mappa man drar til et annet område, må hovedsiden og
  // breadcrumben følge etter — ellers leter activeGroupObj() i det gamle
  // området og board-et faller til «Ingen mapper ennå.».
  await seed(p);
  await open(p);
  await drag(p, '#nav-board .card[data-id="uni-A"] .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 + 6 };
  });
  const follow = await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    H.closeNavModal();
    const g = st.universes.flatMap((u) => u.groups).find((x) => x.id === 'g-a1');
    return {
      gUni: g ? g.uni : 'BORTE',
      aktivtOmråde: st.activeUniverse,
      aktivMappe: st.activeGroup,
      crumb: document.getElementById('nav-crumb').innerText.replace(/\s+/g, ' ').trim(),
      // «Ingen mapper ennå.» = board-et fant ikke mappa (den gamle feilen).
      // Mappa er tom for lister, så list-nivåets tomtilstand er RIKTIG her.
      board: (document.querySelector('#board .empty-state') || document.body).innerText
        .replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  });
  log(label + ' 7: den aktive mappen tar med seg lokasjonen til det nye området',
    follow.gUni === 'uni-B' && follow.aktivtOmråde === 'uni-B' && follow.aktivMappe === 'g-a1' &&
    follow.crumb === 'Jobb › Ukesplan' && follow.board.startsWith('Ingen lister i «Ukesplan»'),
    JSON.stringify(follow));

  /* ---------- 8) Tastatur: navigering uten peker ---------- */
  await seed(p);
  await open(p);
  // Enter på en ANNEN mappes rad = naviger dit (og lukk modalen), som et klikk.
  await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const kbNav = await p.evaluate(() => ({
    lukket: document.getElementById('nav-modal').hidden,
    u: window.__huskis.state.activeUniverse,
    g: window.__huskis.state.activeGroup,
  }));
  log(label + ' 8: Enter på en mapperad navigerer dit og lukker modalen',
    kbNav.lukket === true && kbNav.u === 'uni-B' && kbNav.g === 'g-b1', JSON.stringify(kbNav));

  // F2 omdøper — også på mappa man allerede står i. (Enter navigerer overalt nå.)
  await open(p);
  await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').focus();
  await p.keyboard.press('F2');
  await p.waitForTimeout(300);
  const kbRename = await p.evaluate(() => ({
    input: !!document.querySelector('#nav-board .item[data-id="g-b1"] .edit-input'),
    apen: !document.getElementById('nav-modal').hidden,
  }));
  log(label + ' 8: F2 på mappa åpner navneredigering',
    kbRename.input === true && kbRename.apen === true, JSON.stringify(kbRename));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  // Mellomrom på områdehodet kollapser/utvider — det klikk der gjør.
  await p.locator('#nav-board .card[data-id="uni-A"] .card-head').focus();
  await p.keyboard.press(' ');
  await p.waitForTimeout(300);
  const kbCollapse = await p.evaluate(() => {
    const c = document.querySelector('#nav-board .card[data-id="uni-A"]');
    return {
      kollapset: c.classList.contains('collapsed'),
      lagret: window.__huskis.state.universes.find((u) => u.id === 'uni-A').collapsed,
      aria: c.querySelector('.card-head').getAttribute('aria-expanded'),
    };
  });
  log(label + ' 8: Mellomrom på områdehodet kollapser området',
    kbCollapse.kollapset === true && kbCollapse.lagret === true && kbCollapse.aria === 'false',
    JSON.stringify(kbCollapse));

  /* ---------- 9) Slipp i et LÅST område rulles tilbake ---------- */
  // DB-guarden krever redigeringsrett på BÅDE gammel og ny forelder, så en
  // flytting inn i et frosset område ville blitt avvist og snappet tilbake ved
  // neste synk. Klienten må avvise den med en gang i stedet.
  //
  // Fikstur: «vanlig medlem av et låst område» settes direkte på state-objektet
  // (`_role`/`_locked`/`_caps`). Pullen er allerede pauset (se 6-10 over).
  await seed(p);
  await p.evaluate(() => {
    const u = window.__huskis.state.universes.find((x) => x.id === 'uni-B');
    // Vanlig medlem (ikke eier) av et låst område: låsen gjelder for meg.
    u._role = 'member'; u._locked = true;
    u._caps = { editContent: false, createGroup: false, delete: false, leave: true };
    window.__huskis.render();
  });
  await open(p);
  // Mappe-kassen FØLGER raden mellom områdene — men ikke inn i et område som
  // ikke tar imot den. Gjorde den det, foldet den seg ut rett under siktet i
  // nettopp det området slippet blir avvist i, og et slipp som bommet med noen
  // piksler SLETTET mappa i stedet for å si «låst». Måles MIDT i draget.
  let kasser = null;
  await drag(p, '#nav-board .card[data-id="uni-A"] .item[data-id="g-a1"]', async () => {
    const t = await p.locator('#nav-board .card[data-id="uni-B"] .item[data-id="g-b1"]').boundingBox();
    return { x: t.x + t.width / 2, y: t.y + t.height / 2 + 6 };
  }, {
    beforeDrop: async () => {
      kasser = await p.evaluate(() => {
        const synlig = (sel) => { const b = document.querySelector(sel); return !!b && !b.hidden && !b.closest('[hidden]'); };
        return {
          armerte: [].slice.call(document.querySelectorAll('#nav-board .trashcan.drag-trash'))
            .map((t) => (t.closest('.card') || { dataset: {} }).dataset.id || 'MODAL'),
          synligIUniB: synlig('#nav-board .card[data-id="uni-B"] .group-trash-btn'),
        };
      });
    },
  });
  log(label + ' 9: kassen foldes ikke ut i et område som ikke tar imot mappa',
    !!kasser && kasser.armerte.join() === 'uni-A' && kasser.synligIUniB === false,
    JSON.stringify(kasser));
  const locked = await p.evaluate(() => ({
    uni: window.__huskis.state.universes.flatMap((u) => u.groups).find((g) => g.id === 'g-a1').uni,
    iKildekortet: !!document.querySelector('#nav-board .card[data-id="uni-A"] .item[data-id="g-a1"]'),
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }));
  log(label + ' 9: mappe sluppet i et låst område rulles tilbake med beskjed',
    locked.uni === 'uni-A' && locked.iKildekortet === true && /låst/i.test(locked.toast),
    JSON.stringify(locked));

  /* ---------- 10) Type-ikon + delt-merke foran navnet ---------- */
  await seed(p);
  await p.evaluate(() => {
    const u = window.__huskis.state.universes.find((x) => x.id === 'uni-A');
    u._shared = true;
    u.groups.find((g) => g.id === 'g-a1')._shared = true;
    window.__huskis.openNavModal();
  });
  await p.waitForTimeout(350);
  const marks = await p.evaluate(() => {
    const card = document.querySelector('#nav-board .card[data-id="uni-A"]');
    const row = card.querySelector('.item[data-id="g-a1"]');
    const kids = (el) => [...el.children].map((c) => c.className.split(' ')[0]);
    return {
      hode: kids(card.querySelector('.card-head')).slice(0, 3),
      rad: kids(row).slice(0, 3),
      uniIkon: card.querySelectorAll(':scope > .card-head > .uni-icon svg').length,
      mappeIkon: row.querySelectorAll(':scope > .group-icon svg').length,
      delt: !card.querySelector(':scope > .card-head > .share-badge').hidden,
      // Den lyse innerkanten («border» rundt mappelista) skal være borte.
      innerkant: getComputedStyle(card).boxShadow.includes('inset'),
    };
  });
  log(label + ' 10: [område-ikon][delt-ikon]Navn på områdekortet',
    marks.hode.join() === 'kind-icon,share-badge,card-title-wrap' &&
    marks.uniIkon === 1 && marks.delt === true, JSON.stringify(marks));
  log(label + ' 10: [mappe-ikon][delt-ikon]Navn på mapperaden',
    marks.rad.join() === 'kind-icon,share-badge,item-main' && marks.mappeIkon === 1);
  log(label + ' 10: delt område har ingen lys innerkant rundt mappelista',
    marks.innerkant === false);
  await p.evaluate(() => { window.__huskis.client.rpc = window.__navRealRpc; }); // pullen i gang igjen

  /* ---------- 11) Søppelkassene ---------- */
  // Frisk state: dra-testene over har flyttet mappene rundt (og laget nye
  // områder), så søppel-sjekkene får sitt eget kjente utgangspunkt.
  await seed(p);
  await open(p);
  // Fersk state — ingenting i område-søppelkassen ennå. Foten rundt den skal
  // da kollapse HELT (ikke bare knappen inni), ellers står det igjen en tom
  // stripe nederst i modalen hver eneste gang kassen er tom (det vanlige).
  const emptyFoot = await p.evaluate(() => {
    const foot = document.querySelector('.nav-foot');
    return { display: getComputedStyle(foot).display, height: foot.getBoundingClientRect().height };
  });
  log(label + ' 11: den tomme fasit-foten kollapser helt, ikke bare kassen inni',
    emptyFoot.display === 'none' && emptyFoot.height === 0, JSON.stringify(emptyFoot));
  await menuPick(p, '#nav-board .card[data-id="uni-A"] .item[data-id="g-a2"]', 'Slett mappen for alle');
  await p.waitForTimeout(650);
  const trash = await p.evaluate(() => ({
    inUniCard: !!document.querySelector('#nav-board .card[data-id="uni-A"] .group-trash-btn'),
    count: (document.querySelector('#nav-board .card[data-id="uni-A"] .group-trash-btn .trashcan-count') || {}).textContent,
    // Kassen bygges ALLTID (den vises fram som slippmål under et drag), så det
    // er synligheten — ikke om noden finnes — som skiller områdene.
    synligIUniA: (() => {
      const b = document.querySelector('#nav-board .card[data-id="uni-A"] .group-trash-btn');
      return !!b && !b.hidden && !b.closest('[hidden]');
    })(),
    synligIUniB: (() => {
      const b = document.querySelector('#nav-board .card[data-id="uni-B"] .group-trash-btn');
      return !!b && !b.hidden && !b.closest('[hidden]');
    })(),
    // Kassen selv har ikke lenger `hidden` (den lever på `.item-trash`-
    // innpakningen rundt den, som modal-foten kollapser sammen med — se
    // updateTrashBadge i app.js), så synligheten leses av HELE kjeden.
    uniTrashHidden: document.getElementById('uni-trash-btn').closest('[hidden]') !== null,
    uniTrashInModalFooter: !!document.querySelector('#nav-modal .nav-foot #uni-trash-btn'),
  }));
  log(label + ' 11: mappe-søppelkassen ligger i områdekortet mappa hørte til',
    trash.inUniCard === true && trash.count === '1' &&
    trash.synligIUniA === true && trash.synligIUniB === false, JSON.stringify(trash));
  log(label + ' 11: område-søppelkassen ligger i modalens faste fot (skjult når tom)',
    trash.uniTrashInModalFooter === true && trash.uniTrashHidden === true, JSON.stringify(trash));

  await menuPick(p, '#nav-board .card[data-id="uni-A"] .card-head', 'Slett området for alle');
  await p.waitForTimeout(650);
  const uniTrash = await p.evaluate(() => ({
    hidden: document.getElementById('uni-trash-btn').closest('[hidden]') !== null,
    count: document.getElementById('uni-trash-count').textContent,
  }));
  log(label + ' 11: område-søppelkassen dukker opp med antall',
    uniTrash.hidden === false && uniTrash.count === '1', JSON.stringify(uniTrash));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();

