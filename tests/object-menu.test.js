/*
  Regresjonstest: OBJEKTMENYEN.

  Alle seks objekttypene (område, mappe, mappekategori, liste, listepunkt,
  kategori) har NØYAKTIG én knapp til høyre — objektmenyen. Testen dekker:

    1. Én knapp per objekt; de gamle knappene (✕, tannhjul, del, forlat,
       oppløs) finnes ikke i DOM-en lenger.
    2. Menyens rader per type, i riktig rekkefølge, med sletting SIST.
    3. Trekkspillet: kun ÉN undermeny åpen om gangen, og «Tidsplan» inneholder
       tids-editoren fra den avviklede innstillingsmodalen.
    4. «Flytt opp/ned» sorterer og lar menyen stå åpen; «Flytt til …» åpner
       velger-modalen.
    5. «Endre navn» åpner navneredigereren på plassen — på alle nivåer.
    6. Klikk på navnet: listepunkt/kategori omdøper fortsatt, mens område/
       liste kollapser og mappe navigerer (konflikten som ble fjernet).
    7. Skillelinjer MELLOM alle radene — også der det ikke står en skuff — og
       at de er FLATE (en linje tegnet som `border-top` på en avrundet rad buer
       i endene). Alle radene deler dessuten ÉN polstring, hentet fra
       `--menu-row-pad-*`, og rader uten hint er like høye.
    9. Escape lukker menyen og fokus går tilbake til menyknappen.
   10. «Endre navn» overlever at board-et rendres mens menyen står åpen
       (callbacken må slå opp tittelen på nytt, ikke holde på den gamle noden).
   11. En FROSSEN (låst for meg) liste får ingen «Ansvarlig»-rader — serveren
       ville avvist ansvaret, og UI-et skal ikke vise noe som rulles tilbake.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/object-menu.test.js
*/
const { chromium } = require('playwright');

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
  }, null, { timeout: 15000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Ett område med én mappe, én mappekategori, to lister og en liste med to
// listepunkter + en kategori med ett medlem. Nok til å nå alle seks typene.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    u.groups.push(mk({ id: 'GCAT', uni: 'UNI', name: 'Prosjekter', cat: null, isCat: true, collapsed: false, cards: [], pos: 1 }));
    const c1 = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    c1.items.push(mk({ id: 'I1', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    c1.items.push(mk({ id: 'I2', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    c1.items.push(mk({ id: 'C1', home: 'L1', text: 'Frukt', cat: null, isCat: true, collapsed: false, pos: 2 }));
    c1.items.push(mk({ id: 'I3', home: 'L1', text: 'Eple', cat: 'C1', isCat: false, pos: 3 }));
    g.cards.push(c1);
    g.cards.push(mk({ id: 'L2', group: 'GRP', title: 'Huskeliste', collapsed: false, items: [], pos: 1 }));
    // En mappe til, så «Flytt til …» faktisk har et sted å flytte lista.
    u.groups.push(mk({ id: 'GRP2', uni: 'UNI', name: 'Jobb', cat: null, isCat: false, collapsed: false, cards: [], pos: 2 }));
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);
}

const openMenu = async (p, hostSel) => {
  await p.locator(hostSel + ' > .obj-menu-btn, ' + hostSel + ' > .card-head > .obj-menu-btn, ' +
    hostSel + ' > .cat-head > .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
};
const menuLabels = (p) => p.locator('#obj-menu-panel .obj-menu-row .obj-menu-label').allTextContents();
const closeMenu = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(200); };

async function run(label, viewport, touchMode) {
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({ viewport }, touchMode ? { hasTouch: true, isMobile: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);
  await seed(p);

  /* ---------- 1) Én knapp per objekt ---------- */
  const shape = await p.evaluate(() => {
    const own = (el, sel) => [].slice.call(el.querySelectorAll(sel))
      .filter((b2) => !b2.hidden).length;
    const card = document.querySelector('.card[data-id="L1"]');
    const item = document.querySelector('.item[data-id="I1"]');
    const cat = document.querySelector('.category[data-id="C1"]');
    return {
      cardBtns: own(card.querySelector('.card-head'), ':scope > button'),
      itemBtns: own(item, ':scope > button'),
      catBtns: own(cat.querySelector('.cat-head'), ':scope > button'),
      cardMenu: !!card.querySelector('.card-head > .obj-menu-btn'),
      itemMenu: !!item.querySelector(':scope > .obj-menu-btn'),
      catMenu: !!cat.querySelector('.cat-head > .obj-menu-btn'),
      // Avmerkingsboksen er den ene ekstra knappen et listepunkt beholder.
      itemCheck: own(item, ':scope > .item-check'),
      legacy: document.querySelectorAll('.card-delete, .item-delete, .cat-dissolve,' +
        ' .uni-share, .group-share, .uni-leave, .group-leave, #settings-modal,' +
        ' .swipe-zone, .swipe-trash').length,
      badgeIsButton: card.querySelector('.share-badge').tagName === 'BUTTON',
    };
  });
  log(label + ' 1: listekortet har kun menyknappen',
    shape.cardBtns === 1 && shape.cardMenu === true, JSON.stringify(shape));
  log(label + ' 1: listepunktet har avmerkingsboks + menyknapp, ingenting mer',
    shape.itemBtns === 2 && shape.itemMenu === true && shape.itemCheck === 1);
  log(label + ' 1: kategorien har kun menyknappen', shape.catBtns === 1 && shape.catMenu === true);
  log(label + ' 1: de gamle knappene og innstillingsmodalen finnes ikke lenger',
    shape.legacy === 0 && shape.badgeIsButton === false);

  /* ---------- 2) Radene per type, sletting sist ---------- */
  await openMenu(p, '.card[data-id="L1"]');
  const cardRows = await menuLabels(p);
  log(label + ' 2: listens meny har navn, tidsplan, flytt og sletting SIST',
    cardRows[0] === 'Endre navn' && cardRows.includes('Tidsplan') &&
    cardRows.includes('Flytt') &&
    cardRows[cardRows.length - 1] === 'Slett listen', JSON.stringify(cardRows));
  // Bare område og mappe kan deles; en delerad her ville lest som om det er
  // LISTA man deler (docs/rettigheter-og-deling.md).
  log(label + ' 2: listens meny har INGEN delerad',
    !cardRows.some((r) => /Deling/i.test(r)), JSON.stringify(cardRows));
  log(label + ' 2: sletteraden er markert som destruktiv',
    await p.locator('#obj-menu-panel .obj-menu-row.is-danger').count() === 1);
  log(label + ' 2: menyen sier hvilket objekt den gjelder',
    (await p.locator('#obj-menu-panel .obj-menu-head-name').textContent()) === 'Handleliste');
  await closeMenu(p);

  await openMenu(p, '.category[data-id="C1"]');
  const catRows = await menuLabels(p);
  log(label + ' 2: kategorien har «Løs opp kategorien» i stedet for «Slett»',
    catRows[catRows.length - 1] === 'Løs opp kategorien' &&
    !catRows.some((r) => /^Slett/.test(r)), JSON.stringify(catRows));
  await closeMenu(p);

  await openMenu(p, '.item[data-id="I1"]');
  const itemRows = await menuLabels(p);
  log(label + ' 2: listepunktet har ingen delings- eller låserad',
    !itemRows.some((r) => /Deling|Lås|Forlat/.test(r)) &&
    itemRows[itemRows.length - 1] === 'Slett listepunktet', JSON.stringify(itemRows));
  await closeMenu(p);

  /* ---------- 3) Trekkspillet: kun ÉN skuff åpen ---------- */
  await openMenu(p, '.card[data-id="L1"]');
  await p.locator('#obj-menu-panel .obj-menu-toggle', { hasText: 'Tidsplan' }).click();
  await p.waitForTimeout(400);
  const timeOpen = await p.evaluate(() => ({
    apne: document.querySelectorAll('#obj-menu-panel .obj-menu-sub:not(.is-closed)').length,
    datofelt: document.querySelectorAll('#obj-menu-panel .obj-menu-sub input[type="date"]').length,
    lasTider: !!document.querySelector('#obj-menu-panel .obj-menu-sub .time-lock'),
  }));
  log(label + ' 3: «Tidsplan» åpner tids-editoren (start + frist + tidslås)',
    timeOpen.apne === 1 && timeOpen.datofelt === 2 && timeOpen.lasTider === true,
    JSON.stringify(timeOpen));
  await p.locator('#obj-menu-panel .obj-menu-toggle', { hasText: 'Flytt' }).click();
  await p.waitForTimeout(400);
  const oneOpen = await p.evaluate(() => ({
    apne: [].slice.call(document.querySelectorAll('#obj-menu-panel .obj-menu-sub:not(.is-closed)'))
      .map((s) => s.dataset.sub),
    aria: [].slice.call(document.querySelectorAll('#obj-menu-panel .obj-menu-toggle'))
      .map((t) => t.querySelector('.obj-menu-label').textContent + '=' + t.getAttribute('aria-expanded')),
  }));
  log(label + ' 3: å åpne «Flytt» lukker «Tidsplan» — kun én skuff av gangen',
    oneOpen.apne.length === 1 && oneOpen.apne[0] === 'move' &&
    oneOpen.aria.includes('Tidsplan=false') && oneOpen.aria.includes('Flytt=true'),
    JSON.stringify(oneOpen));

  /* ---------- 4) Flytt ---------- */
  const orderBefore = await p.evaluate(() => window.__huskis.state.universes[0].groups[0]
    .cards.slice().sort((a, c) => a.pos - c.pos).map((c) => c.id).join(','));
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: 'Flytt ned' }).click();
  await p.waitForTimeout(450);
  const afterMove = await p.evaluate(() => ({
    order: window.__huskis.state.universes[0].groups[0].cards.slice()
      .sort((a, c) => a.pos - c.pos).map((c) => c.id).join(','),
    menyApen: !document.getElementById('obj-menu').hidden,
  }));
  log(label + ' 4: «Flytt ned» sorterer listen og lar menyen stå åpen',
    orderBefore === 'L1,L2' && afterMove.order === 'L2,L1' && afterMove.menyApen === true,
    JSON.stringify(afterMove) + ' før=' + orderBefore);
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: 'Flytt til …' }).click();
  await p.waitForTimeout(450);
  log(label + ' 4: «Flytt til …» åpner velger-modalen og lukker menyen',
    await p.evaluate(() => !document.getElementById('place-modal').hidden &&
      document.getElementById('obj-menu').hidden));
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  /* ---------- 5) «Endre navn» på alle nivåer ---------- */
  for (const [what, host, editSel] of [
    ['listen', '.card[data-id="L1"]', '.card[data-id="L1"] .card-head .edit-input'],
    ['listepunktet', '.item[data-id="I1"]', '.item[data-id="I1"] .edit-input'],
    ['kategorien', '.category[data-id="C1"]', '.category[data-id="C1"] .cat-head .edit-input'],
  ]) {
    await openMenu(p, host);
    await p.locator('#obj-menu-panel .obj-menu-row', { hasText: 'Endre navn' }).click();
    await p.waitForTimeout(350);
    log(label + ' 5: «Endre navn» åpner navneredigereren på ' + what,
      await p.locator(editSel).count() === 1);
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  }

  /* ---------- 6) Klikk på navnet: hurtig-omdøping kun der den ikke kolliderer ---------- */
  await p.locator('.item[data-id="I1"] .item-text').click();
  await p.waitForTimeout(300);
  log(label + ' 6: klikk på et LISTEPUNKT-navn omdøper fortsatt',
    await p.locator('.item[data-id="I1"] .edit-input').count() === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  await p.locator('.category[data-id="C1"] .cat-title').click();
  await p.waitForTimeout(300);
  log(label + ' 6: klikk på et KATEGORI-navn omdøper fortsatt',
    await p.locator('.category[data-id="C1"] .cat-head .edit-input').count() === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  await p.locator('.card[data-id="L1"] .card-title').click();
  await p.waitForTimeout(350);
  const cardTitleClick = await p.evaluate(() => ({
    redigerer: !!document.querySelector('.card[data-id="L1"] .edit-input'),
    kollapset: document.querySelector('.card[data-id="L1"]').classList.contains('collapsed'),
  }));
  log(label + ' 6: klikk på et LISTE-navn kollapser i stedet for å omdøpe',
    cardTitleClick.redigerer === false && cardTitleClick.kollapset === true,
    JSON.stringify(cardTitleClick));
  await p.locator('.card[data-id="L1"] .card-title').click(); await p.waitForTimeout(300);

  await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(350);
  await p.locator('#nav-board .card[data-id="UNI"] .card-title').click();
  await p.waitForTimeout(350);
  const uniTitleClick = await p.evaluate(() => ({
    redigerer: !!document.querySelector('#nav-board .card[data-id="UNI"] .edit-input'),
    kollapset: document.querySelector('#nav-board .card[data-id="UNI"]').classList.contains('collapsed'),
  }));
  log(label + ' 6: klikk på et OMRÅDE-navn kollapser i stedet for å omdøpe',
    uniTitleClick.redigerer === false && uniTitleClick.kollapset === true,
    JSON.stringify(uniTitleClick));
  await p.locator('#nav-board .card[data-id="UNI"] .card-title').click(); await p.waitForTimeout(300);

  await p.locator('#nav-board .item[data-id="GRP"] .item-text').click();
  await p.waitForTimeout(450);
  const grpTitleClick = await p.evaluate(() => ({
    redigerer: !!document.querySelector('#nav-board .item[data-id="GRP"] .edit-input'),
    lukket: document.getElementById('nav-modal').hidden,
    aktiv: window.__huskis.state.activeGroup,
  }));
  log(label + ' 6: klikk på et MAPPE-navn navigerer i stedet for å omdøpe',
    grpTitleClick.redigerer === false && grpTitleClick.lukket === true &&
    grpTitleClick.aktiv === 'GRP', JSON.stringify(grpTitleClick));

  /* ---------- 9) Escape lukker og fokus går tilbake ---------- */
  await openMenu(p, '.item[data-id="I2"]');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const closed = await p.evaluate(() => ({
    hidden: document.getElementById('obj-menu').hidden,
    focus: document.activeElement === document.body ? 'BODY'
      : (document.activeElement.closest('[data-id]') || {}).dataset ?
        document.activeElement.closest('[data-id]').dataset.id + ':' + document.activeElement.className
        : document.activeElement.className,
  }));
  log(label + ' 9: Escape lukker menyen og fokus går tilbake til menyknappen',
    closed.hidden === true && /I2:.*obj-menu-btn/.test(closed.focus), JSON.stringify(closed));

  /* ---------- 10) «Endre navn» etter en rendring under åpen meny ---------- */
  // En synk-pull (eller ensureShareGroup når medlemscachen fylles) kaller
  // render() mens menyen står åpen. Holdt menyen på tittel-noden fra forrige
  // bygging, ville «Endre navn» redigert et frakoblet element.
  await openMenu(p, '.item[data-id="I2"]');
  await p.evaluate(() => window.__huskis.render());
  await p.waitForTimeout(300);
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: 'Endre navn' }).click();
  await p.waitForTimeout(400);
  log(label + ' 10: «Endre navn» virker også etter en rendring med menyen åpen',
    await p.locator('.item[data-id="I2"] .edit-input').count() === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  /* ---------- 11) «Ansvarlig» finnes i en DELT mappe, men ikke i en LÅST ---------- */
  // `frozen()` går oppover via `_parent`, som normalt settes av applyMyDoc.
  // Fiksturen er håndsådd, så lenken må knyttes her for at låsen skal arves.
  const setGroupShare = (locked) => p.evaluate((l) => {
    const H = window.__huskis, u = H.state.universes[0], g = u.groups[0];
    g._parent = u;
    g.cards.forEach((c) => { c._parent = g; c.items.forEach((it) => { it._parent = c; }); });
    // `privilegedLocal` omgår låsen for eiere — også via OMRÅDET. Begge
    // nivåene må derfor være «medlem» for at lista faktisk skal være frossen.
    u._role = l ? 'member' : 'owner';
    g._shared = true; g._role = l ? 'member' : 'owner'; g._locked = l;
    g._caps = l ? { editContent: false, leave: true, delete: false } : null;
    H.render();
  }, locked);

  await setGroupShare(false);
  await p.waitForTimeout(350);
  await openMenu(p, '.card[data-id="L1"]');
  const sharedMenu = await menuLabels(p);
  log(label + ' 11: en liste i en delt mappe FÅR «Ansvarlig»',
    sharedMenu.includes('Ansvarlig'), JSON.stringify(sharedMenu));
  await closeMenu(p);

  await setGroupShare(true);
  await p.waitForTimeout(350);
  await openMenu(p, '.card[data-id="L1"]');
  const lockedMenu = await menuLabels(p);
  log(label + ' 11: en FROSSEN liste får ingen «Ansvarlig»-rad (serveren ville avvist den)',
    !lockedMenu.includes('Ansvarlig') && !lockedMenu.includes('Endre navn'),
    JSON.stringify(lockedMenu));
  await closeMenu(p);

  await p.evaluate(() => {
    const H = window.__huskis, u = H.state.universes[0], g = u.groups[0];
    u._role = 'owner';
    g._shared = false; g._role = 'owner'; g._locked = false; g._caps = null;
    H.render();
  });
  await p.waitForTimeout(350);

  /* ---------- 7) Skillelinjer rundt trekkspill-skuffene ---------- */
  /* Linjen over et element tegnes enten som `border-top` (skuffene) eller som et
     eget strøk i ::before (raden under en skuff — radene er avrundet, så en kant
     på DEM ville buet i endene). Begge måles her, og `buet` fanger opp at en
     linje har arvet radens hjørner i stedet for å ligge flat. */
  const maalLinjer = (pg) => pg.evaluate(() => {
    const linje = (el) => {
      const cs = getComputedStyle(el);
      if ((parseFloat(cs.borderTopWidth) || 0) > 0) {
        return { finnes: true, buet: (parseFloat(cs.borderTopLeftRadius) || 0) > 0 };
      }
      const b = getComputedStyle(el, '::before');
      if (b.content !== 'none' && (parseFloat(b.height) || 0) > 0 &&
          b.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        return { finnes: true, buet: (parseFloat(b.borderTopLeftRadius) || 0) > 0 };
      }
      return { finnes: false, buet: false };
    };
    const rows = [].slice.call(document.querySelectorAll('#obj-menu-panel .obj-menu-list > *'));
    return rows.map((el) => Object.assign({
      type: el.classList.contains('obj-menu-group') ? 'skuff'
        : el.classList.contains('obj-menu-sep') ? 'linje' : 'rad',
      navn: (el.querySelector('.obj-menu-label') || {}).textContent || '',
    }, { linjeOver: linje(el).finnes, buet: linje(el).buet }));
  });

  // Listens meny: to skuffer etter hverandre, skilt fra raden over.
  await openMenu(p, '.card[data-id="L1"]');
  const seps = await maalLinjer(p);
  const tidsplan = seps.find((r) => r.navn === 'Tidsplan');
  const flytt = seps.find((r) => r.navn === 'Flytt');
  log(label + ' 7: skuffene er skilt fra hverandre og fra raden over',
    !!tidsplan && tidsplan.linjeOver === true &&
    !!flytt && flytt.linjeOver === true, JSON.stringify(seps));
  await closeMenu(p);

  /* Raden UNDER en skuff finnes bare på område/mappe — «Deling og medlemmer»,
     og det er nettopp den raden som fikk buet linje da den lå som `border-top`
     på en avrundet rad. Området har den, så menyen måles i nav-modalen. */
  await p.evaluate(() => window.__huskis.openNavModal()); await p.waitForTimeout(400);
  await openMenu(p, '#nav-board .card[data-id="UNI"]');
  const uniSeps = await maalLinjer(p);
  const uniFlytt = uniSeps.find((r) => r.type === 'skuff' && r.navn === 'Flytt');
  const etterSkuff = uniSeps[uniSeps.indexOf(uniFlytt) + 1];
  log(label + ' 7: raden under siste skuff har linje over seg',
    !!uniFlytt && !!etterSkuff && etterSkuff.type === 'rad' &&
    etterSkuff.linjeOver === true, JSON.stringify(uniSeps));
  log(label + ' 7: alle skillelinjene er flate — ingen arver radenes avrundede hjørner',
    seps.concat(uniSeps).every((r) => r.buet === false),
    JSON.stringify(seps.concat(uniSeps).filter((r) => r.buet)));
  /* HVER rad er skilt fra naboen over seg, ikke bare de som tilfeldigvis står
     ved en skuff. Linjene fulgte tidligere bare skuffene, og da rant rader
     uten skuff mellom seg sammen til én blokk (docs/menus.md). Unntakene er
     nøyaktig to: den første raden (hodet har sin egen linje under seg) og
     `.obj-menu-sep`, som ER en linje — og raden rett etter den, som allerede
     er skilt av den. */
  const alleSkilt = (rader) => rader.every((r, i) => {
    if (i === 0 || r.type === 'linje' || rader[i - 1].type === 'linje') return true;
    return r.linjeOver === true;
  });
  /* ALLE MENYRADER HAR DEN SAMME POLSTRINGEN, og den kommer fra ETT token
     (`--menu-row-pad-*`) i stedet for å være skrevet om igjen i hver meny.
     Ansvarlig-velgerens rader er med: de står i det samme popover-skallet og
     hadde 7 px der objektmenyen hadde 8 — lite nok til at ingen meny så gal ut
     alene, nok til at to menyer ved siden av hverandre ikke leste likt. */
  const polstring = await p.evaluate(() => {
    const rader = [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')];
    const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return {
      token: { y: token('--menu-row-pad-y'), x: token('--menu-row-pad-x') },
      ulike: [...new Set(rader.map((r) => getComputedStyle(r).padding))],
      // … og rader UTEN hint er alle like høye: en teller eller et ikon skal
      // ikke dytte én rad ut av takt med naboene.
      høyder: [...new Set(rader.filter((r) => !r.querySelector('.obj-menu-hint'))
        .map((r) => Math.round(r.getBoundingClientRect().height)))],
    };
  });
  log(label + ' 7: alle menyrader deler ÉN polstring, fra tokenet',
    polstring.ulike.length === 1 &&
    polstring.ulike[0] === polstring.token.y + ' ' + polstring.token.x,
    JSON.stringify(polstring));
  log(label + ' 7: … og radene uten hint er alle like høye',
    polstring.høyder.length === 1, JSON.stringify(polstring.høyder));

  log(label + ' 7: hver rad er skilt fra naboen over seg',
    alleSkilt(seps) && alleSkilt(uniSeps),
    JSON.stringify([seps.filter((r, i) => i > 0 && r.type !== 'linje'
      && seps[i - 1].type !== 'linje' && !r.linjeOver),
    uniSeps.filter((r, i) => i > 0 && r.type !== 'linje'
      && uniSeps[i - 1].type !== 'linje' && !r.linjeOver)]));
  await closeMenu(p);
  await p.evaluate(() => { const m = document.getElementById('nav-modal'); if (m) m.hidden = true; });
  await p.waitForTimeout(200);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1280, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
