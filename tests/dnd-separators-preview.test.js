/*
  Regresjonstest: forhåndsvisning av kategori-skillelinjene under DnD.

  Skillelinjene rundt en kategori (i hvile: .category::before/::after) skal under
  et drag vise hvordan linjene BLIR hvis man slipper der placeholderen står:
    - kategori-drag  → linjer rundt kategori-placeholderen,
    - listepunkt-drag → linje der placeholderen er nærmeste nabo til en kategori
      over og/eller under,
    - og ingen «fantom-linje» der det LØFTEDE objektet fortsatt ligger i DOM-en.
  JS setter `.sep-above` på den nedre raden i hver grense som skal ha en linje, og
  `.seps-managed` slår av hvile-reglene i containeren (se applyDragSeparators).

  Touch-gestene er EKTE input (`tests/dnd-gestures.js`); muse-gestene var det
  allerede.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-separators-preview.test.js
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

// Seed: én liste med nivå-1-radene topp, Kategori 1 (2 medlemmer), midt, bunn.
async function seed(p) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h, extra) => Object.assign({ id, text: t, home: h, cat: null, isCat: false, trashed: false, done: false, collapsed: false }, mk(), extra || {});
    const mkCard = (id, title, pos) => Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', collapsed: false, items: [] }, mk(), { pos });
    const A = mkCard('card-A', 'Liste A', 0);
    A.items.push(mkI('topp', 'Topp', 'card-A', { pos: 0 }));
    A.items.push(mkI('cat-1', 'Kategori 1', 'card-A', { isCat: true, pos: 1 }));
    A.items.push(mkI('m1', 'Medlem 1', 'card-A', { cat: 'cat-1', pos: 0 }));
    A.items.push(mkI('m2', 'Medlem 2', 'card-A', { cat: 'cat-1', pos: 1 }));
    A.items.push(mkI('midt', 'Midt', 'card-A', { pos: 2 }));
    A.items.push(mkI('bunn', 'Bunn', 'card-A', { pos: 3 }));
    g.cards = [A];
    H.render();
  });
  await p.waitForTimeout(300);
}

/* Nivå-1-radene i lista, i DOM-rekkefølge: hva slags rad, og har den en linje
   over seg (klassen + at linja faktisk males)?

   Radnivået kjøres av dnd-kit: det LØFTEDE objektet merkes `[data-dnd-dragging]`
   (og ligger i top layer, ute av flyten), mens plassen holdes av en KLONE med
   `[data-dnd-placeholder]` — samme klasser som raden den er en kopi av, men uten
   id (Smett tar identiteten fra den). Klonen er «plassen som kommer». */
const rows = (p) => p.evaluate(() => {
  const cont = document.querySelector('.card[data-id="card-A"] .items-container');
  return [...cont.children].map((c) => {
    const painted = getComputedStyle(c, '::before').content !== 'none' &&
                    getComputedStyle(c, '::before').position === 'absolute';
    const clone = c.hasAttribute('data-dnd-placeholder');
    return {
      what: clone ? (c.classList.contains('category') ? 'cat-ph' : 'item-ph')
        : c.classList.contains('category') ? 'cat' : 'item',
      id: clone ? '' : (c.dataset.id || ''),
      dragging: c.hasAttribute('data-dnd-dragging'),
      /* I EKSTRAHERINGSMODUS er raden på vei ut av lista — den skal bli sin
         egen — så hullet er ikke «plassen som kommer» lenger, og
         `applyDragSeparators` teller det ikke som en rad. Klonen blir liggende
         (dnd-kits, ikke vår), men den er ute av regnestykket. */
      hidden: clone && !!document.querySelector('.new-list-placeholder'),
      sep: c.classList.contains('sep-above') && painted,
    };
  });
});
// Kompakt signatur av de SYNLIGE radene (det dratte objektet er ute av flyten):
// «rad|rad» uten linje, «rad—rad» med.
const sig = (list) => list.filter((r) => !r.dragging && !r.hidden)
  .map((r, i) => (i === 0 ? '' : (r.sep ? '—' : '|')) + (r.id || r.what)).join('');

// Er hvile-reglene (pseudo-linjene på kategorien) i kraft igjen?
const restingSeps = (p) => p.evaluate(() => {
  const cont = document.querySelector('.card[data-id="card-A"] .items-container');
  const cat = cont.querySelector('.category');
  return {
    managed: cont.classList.contains('seps-managed'),
    sepClasses: [...cont.children].filter((c) => c.classList.contains('sep-above')).length,
    catAfter: !!cat && getComputedStyle(cat, '::after').content !== 'none',
  };
});

/* Én bevegelse, to hendelser.

   dnd-kit lar av og til ETT `pointermove` falle på gulvet — posisjonen
   oppdateres, men verken `dragmove` eller `dragover` fyrer, så politikken
   (hvilken liste/kategori raden er i) blir stående på forrige punkt. Med en
   strøm av punkter fra en finger eller en mus merkes det aldri; en test som
   ender gesten på ett enkelt punkt gjør det. Derfor går siste bit av hver
   bevegelse to ganger, som `travel()` i `dnd-gestures.js` gjør av samme grunn. */
async function moveTo(p, x, y, steps = 8) {
  await p.mouse.move(x, y + 1, { steps });
  await p.waitForTimeout(16);
  await p.mouse.move(x, y, { steps: 1 });
}
/* Samme bevegelse med finger. CDP sender ett punkt per kall, så veien må
   skrives ut — og den MÅ skrives ut: plasseringen underveis er dnd-kits
   overlapp-hysterese, som tar nærmeste godkjente nabo. Et sprang rett til målet
   lander derfor et annet sted enn en bevegelse dit, siden en høy kategori-blokk
   aldri overlappes nok av en lav rad til å telle som nabo. (Sluttplasseringen
   ved SLIPPET er punktbasert og upåvirket — se `insertByPoint` i Smett.) */
async function moveTouch(p, from, x, y, steps = 8) {
  for (let i = 1; i <= steps; i++) {
    await G.touchMove(p, from.x + (x - from.x) * (i / steps), from.y + (y - from.y) * (i / steps));
    await p.waitForTimeout(16);
  }
  await G.touchMove(p, x, y);
}

const centerOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, sel);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ============ 1) Desktop: KATEGORI-drag → linjer rundt kategori-placeholderen ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);

    log('1 hvile: kategorien har pseudo-linjer, ingen JS-styring',
      JSON.stringify(await restingSeps(p)) === JSON.stringify({ managed: false, sepClasses: 0, catAfter: true }),
      JSON.stringify(await restingSeps(p)));

    // Løft kategorien (mus = umiddelbart drag) og dra den til NEDERST i lista.
    const src = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    await p.mouse.move(src.x, src.y);
    await p.mouse.down();
    await moveTo(p, src.x, src.y + 20, 4); await p.waitForTimeout(350); // la kategorien kollapse ferdig
    const start = sig(await rows(p));
    log('1 ved løft: linjer rundt kategori-placeholderen', start === 'topp—cat-ph—midt|bunn', start);

    // Nederst INNE i lista (ikke ut i board-lufta — der ville draget blitt en
    // ekstrahering til en ny liste i stedet for en reorder).
    // Nederst INNE i lista (ikke ut i board-lufta — der ville draget blitt en
    // ekstrahering til en ny liste i stedet for en reorder). Helt nede ved kanten
    // av listepunkt-området: det er den trangeste plassen etter at lista slutter
    // ved knapperaden, og skal fortsatt være en reorder (se slarken i cardBand).
    // Nederst blant radene, men ikke klistret til kanten: lista KRYMPER mens man
    // drar (skillelinjene rundt kategori-hullet forsvinner etter hvert som det
    // blir siste rad), så et punkt målt på forhånd ligger lenger nede i lista
    // enn man tror. Hvor nøyaktig ut-terskelen går er `dnd-extract-thresholds`
    // sitt emne; her handler det om LINJENE når kategorien er siste rad.
    const end = await p.evaluate(() => {
      const r = document.querySelector('.card[data-id="card-A"] .items-container').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 30) };
    });
    await moveTo(p, end.x, end.y, 8); await p.waitForTimeout(200);
    const moved = sig(await rows(p));
    log('1 dratt nederst: linje kun over placeholderen (ingen etter siste rad)',
      moved === 'topp|midt|bunn—cat-ph', moved);

    await p.mouse.up(); await p.waitForTimeout(600);
    const after = await restingSeps(p);
    log('1 etter slipp: hvile-reglene tilbake (ingen JS-klasser)',
      after.managed === false && after.sepClasses === 0 && after.catAfter === false, JSON.stringify(after));
    log('1 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 2) Desktop: LISTEPUNKT-drag → linje der placeholderen naboer kategorien ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);

    /* Løft «bunn» (nederste rad, ingen kategori-nabo) … NEDOVER, og bare så
       langt at draget aktiveres (musterskelen er 5 px). «Ved løft» skal måle
       plassen raden kom fra: «bunn» er siste rad, så et lite nedslag kan ikke
       bytte plass med noe — mens et oppslag ville flyttet raden en plass opp
       før noe ble målt (det løftede objektet er kompakt og sentrert på grepet,
       og bytter derfor plass ved Smetts egen `swapRatio` på 0.2, se
       docs/drag-and-drop.md). */
    const src = await centerOf(p, '.item[data-id="bunn"]');
    await p.mouse.move(src.x, src.y);
    await p.mouse.down();
    await moveTo(p, src.x, src.y + 10, 4); await p.waitForTimeout(120);
    const lifted = sig(await rows(p));
    log('2 ved løft: ingen linje der placeholderen ligger (nabo er et listepunkt)',
      lifted === 'topp—cat-1—midt|item-ph', lifted);

    // … og dra det opp mellom «topp» og kategorien: nå skal linja ligge UNDER
    // placeholderen (mot kategorien), ikke over «topp».
    const topp = await centerOf(p, '.item[data-id="topp"]');
    await moveTo(p, topp.x, topp.y + 18, 10); await p.waitForTimeout(250);
    const between = sig(await rows(p));
    log('2 mellom topp og kategori: linje mellom placeholderen og kategorien, ikke over den',
      between === 'topp|item-ph—cat-1—midt', between);

    await p.mouse.up(); await p.waitForTimeout(600);
    const after = await restingSeps(p);
    log('2 etter slipp: hvile-reglene tilbake', after.managed === false && after.sepClasses === 0 && after.catAfter === true,
      JSON.stringify(after));
    log('2 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 3) Desktop: ingen fantom-linje der det løftede objektet lå ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    // «midt» ligger rett under kategorien. Dra det til ØVERST: kategorien er da
    // fulgt av «bunn» — linja under kategorien skal fortsatt vises, men ingen
    // ekstra linje der det løftede listepunktet fortsatt ligger i DOM-en.
    const src = await centerOf(p, '.item[data-id="midt"]');
    await p.mouse.move(src.x, src.y);
    await p.mouse.down();
    await moveTo(p, src.x, src.y - 20, 4); await p.waitForTimeout(100);
    const topp = await centerOf(p, '.item[data-id="topp"]');
    // Draget starter nå ved AKTUELL pekerposisjon (ikke pointerdown-punktet), så
    // grepet sitter der fingeren/musa faktisk er: dra-boksen følger pekeren uten
    // det gamle offsettet. Sikt derfor tydelig over «topp» sitt senter.
    await moveTo(p, topp.x, topp.y - 24, 10); await p.waitForTimeout(250);
    const s = sig(await rows(p));
    log('3 placeholder øverst: linje over kategorien og under den (mot bunn)',
      s === 'item-ph|topp—cat-1—bunn', s);
    await p.mouse.up(); await p.waitForTimeout(600);
    log('3 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 4) Mobil (touch, énkolonne): samme forhåndsvisning ============ */
  {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    const src = await centerOf(p, '.item[data-id="bunn"]');
    await G.lift(p, src, true); // trykk-og-hold
    await G.touchMove(p, src.x, src.y - 10); await p.waitForTimeout(60);
    const topp = await centerOf(p, '.item[data-id="topp"]');
    await moveTouch(p, { x: src.x, y: src.y - 10 }, topp.x, topp.y + 18); await p.waitForTimeout(80);
    await G.touchMove(p, topp.x, topp.y + 20); await p.waitForTimeout(250);
    const s = sig(await rows(p));
    log('4 mobil: linje mellom placeholderen og kategorien', s === 'topp|item-ph—cat-1—midt', s);
    await G.drop(p, undefined, true); await p.waitForTimeout(600);
    const after = await restingSeps(p);
    log('4 mobil etter slipp: hvile-reglene tilbake', after.managed === false && after.sepClasses === 0,
      JSON.stringify(after));
    log('4 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 5) Ekstrahering: placeholderen forlater lista → linjene der uten den ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p);
    const src = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    await p.mouse.move(src.x, src.y); await p.mouse.down();
    await moveTo(p, src.x, src.y + 20, 4); await p.waitForTimeout(350);
    // Ut i board-lufta til høyre for lista → ny-liste-placeholder.
    await moveTo(p, src.x + 620, src.y, 10); await p.waitForTimeout(200);
    const extracted = sig(await rows(p));
    log('5 placeholderen ute av lista: ingen linjer igjen i kilde-lista',
      extracted === 'topp|midt|bunn', extracted);
    // Tilbake inn i lista → linjene rundt kategori-placeholderen igjen.
    await moveTo(p, src.x, src.y + 20, 10); await p.waitForTimeout(200);
    const back = sig(await rows(p));
    // (Hvor den lander avhenger av at lista er kortere nå — poenget er linjene rundt den.)
    log('5 tilbake i lista: linjene rundt kategori-placeholderen igjen',
      /—cat-ph(—|$)/.test(back), back);
    await p.mouse.up(); await p.waitForTimeout(600);
    log('5 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const fails = results.filter((r) => !r).length;
  console.log('\n' + (results.length - fails) + '/' + results.length + ' OK');
  process.exit(fails ? 1 : 0);
})();
