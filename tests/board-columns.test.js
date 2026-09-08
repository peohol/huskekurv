/*
  Regresjonstest: board-kolonnene (fyll venstre først) + DnD-plasseringen av
  ny-liste-placeholderen i flerkolonne-layout.

  (1) FYLL-REKKEFØLGE: kolonne 1 fylles helt før kolonne 2 oppstår. Før brukte
      board-et CSS multi-column, som BALANSERER — tre lister ble tre kolonner med
      én liste hver, og en fjerde liste havnet i kolonne 2 mens kolonne 1 fortsatt
      hadde plass. Nå fordeler `relayoutBoard` grådig etter et kolonnebudsjett
      (skjermhøyden), og budsjettet vokser først når alt ikke får plass.

  (2) INGEN FLIMRING: drar man et listepunkt ut i board-lufta mellom to lister,
      skal placeholderen bli stående. Med multi-column dyttet placeholderen et kort
      over i neste kolonne, som endret svaret på «hvilken liste er objektet i?»,
      som fjernet placeholderen, som flyttet kortet tilbake … én runde per piksel.

  (3) RIKTIG KOLONNE: sikter man under den første lista i kolonne 1, skal
      placeholderen dukke opp DER — ikke nederst i siste kolonne (som `appendChild`
      på et flatt board ga: siste plass i DOM = bunnen av siste kolonne).

  (4) TO VEIER TIL SAMME PLASS: bunnen av kolonne 1 og toppen av kolonne 2 er samme
      plass i rekkefølgen. Placeholderen skal vises begge steder — der man sikter —
      og slippet skal gi nøyaktig samme rekkefølge.

  (9) FORDELINGEN ER FERDIG FØR DROP-ANIMASJONEN. Kolonnene er frosset gjennom
      draget, og en liste som bytter kolonne endrer som regel den grådige
      pakkingen. Kjøres fordelingen først ETTER slipp-animasjonen, flyr kortet
      til den frosne sloten og TELEPORTERER så til sin endelige plass — målt til
      ~1000 px. Fordelingen må derfor kjøres ved slippet, og den må regne med det
      løftede kortets HVILEhøyde: dnd-kit pinner den KOLLAPSEDE på det gjennom
      hele animasjonen, så en pakking som leser den fordeler kolonnene på et kort
      som «veier» en korthøyde. Testen følger selve flukten: der animasjonen
      ENDER skal være der kortet blir liggende.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/board-columns.test.js
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

// `sizes` = antall listepunkter per liste. Listene heter L1, L2, … og har id-ene
// card-0, card-1, …
async function seed(p, sizes) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((sizes) => {
    const H = window.__huskis, st = H.state;
    const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h, extra) => Object.assign({ id, text: t, home: h, cat: null, isCat: false, trashed: false, done: false, collapsed: false }, mk(), extra || {});
    const mkCard = (id, title, pos) => Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', collapsed: false, items: [] }, mk(), { pos });
    g.cards = sizes.map((count, i) => {
      const id = 'card-' + i;
      const c = mkCard(id, 'L' + (i + 1), i);
      for (let j = 0; j < count; j++) c.items.push(mkI(id + '-' + j, 'P' + (i + 1) + '.' + (j + 1), id, { pos: j }));
      return c;
    });
    H.render();
  }, sizes);
  await p.waitForTimeout(350);
}

// Kolonnene som lister av rad-navn: kort → tittel, ny-liste-placeholder → «+».
const cols = (p) => p.evaluate(() => [...document.querySelectorAll('.board > .board-col')].map((col) =>
  [...col.children].map((el) => el.classList.contains('new-list-placeholder') ? '+'
    : (el.classList.contains('card-placeholder') ? '_' : (el.querySelector('.card-title') || {}).textContent))));
// Titlene i LESEREKKEFØLGE (= rekkefølgen som lagres som pos).
const order = (p) => p.evaluate(() => {
  const H = window.__huskis, st = H.state;
  const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
  return g.cards.filter((c) => !c.trashed).slice().sort((a, b) => a.pos - b.pos).map((c) => c.title || '(ny)');
});
const rectOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
}, sel);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Løft et listepunkt med mus (ingen hold på desktop — 5 px bevegelse holder).
async function lift(p, sel) {
  const z = await rectOf(p, sel);
  await G.liftMouse(p, { x: z.cx, y: z.cy });
  return z;
}

(async () => {
  const b = await chromium.launch();

  /* ============ 1) Fyll-rekkefølge: venstre kolonne først ============ */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [1, 1, 1]);
    const c1 = await cols(p);
    log('1 tre korte lister: alle i kolonne 1 (ikke én per kolonne)',
      c1[0].join(',') === 'L1,L2,L3' && (c1[1] || []).length === 0, JSON.stringify(c1));
    log('1 board-et har flere KOLONNER tilgjengelig (bredt vindu)', c1.length >= 3, 'kolonner=' + c1.length);

    // Fyll opp med flere lister: en ny kolonne skal først tas i bruk når den
    // forrige ikke har plass til neste liste.
    await seed(p, [6, 6, 1, 1]);
    const c2 = await cols(p);
    const flat = c2.map((c) => c.join(',')).join(' | ');
    log('1 rekkefølgen leses kolonne for kolonne, venstre først',
      c2.flat().join(',') === 'L1,L2,L3,L4', flat);
    // Hver kolonneovergang må være tvungen: den første lista i neste kolonne
    // hadde IKKE fått plass i den forrige (kolonnehøyden er budsjettet, og den
    // høyeste kolonnen er en nedre grense for det).
    const forced = await p.evaluate(() => {
      const gap = parseFloat(getComputedStyle(document.querySelector('.board')).columnGap) || 0;
      const list = [...document.querySelectorAll('.board > .board-col')]
        .map((c) => [...c.children].map((el) => el.offsetHeight))
        .filter((h) => h.length);
      const used = (hs) => hs.reduce((a, h) => a + h, 0) + gap * Math.max(0, hs.length - 1);
      const budget = Math.max(...list.map(used));
      return list.slice(0, -1).every((hs, i) => used(hs) + gap + list[i + 1][0] > budget);
    });
    log('1 en ny kolonne oppstår kun når den forrige er full', forced, flat);
    log('1 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 2) Ingen flimring når et listepunkt dras ut i board-lufta ============ */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [1, 1, 1]); // alle tre i kolonne 1
    const l1 = await rectOf(p, '.card[data-id="card-0"]');
    const z = await lift(p, '.card[data-id="card-1"] .item');
    // Sikt i board-lufta rett under L1 og beveg pekeren én piksel om gangen.
    const snaps = [];
    for (let i = 0; i < 14; i++) {
      await p.mouse.move(Math.round(l1.cx), Math.round(l1.b) + 12 - i);
      await p.waitForTimeout(25);
      snaps.push((await cols(p)).map((c) => c.join(',')).join('|'));
    }
    const uniq = [...new Set(snaps)];
    log('2 layouten står i ro gjennom 14 piksler (ingen veksling)', uniq.length === 1, uniq.join('  ≠  '));
    log('2 placeholderen står mellom L1 og L2 i kolonne 1', /^L1,\+,L2/.test(snaps[snaps.length - 1]), snaps[snaps.length - 1]);
    await p.mouse.move(Math.round(l1.cx), Math.round(l1.b) - 1); await p.mouse.up();
    await p.waitForTimeout(400);
    log('2 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 3) Placeholderen havner i kolonnen man sikter på ============
     Én høy liste per kolonne (kort vindu + fulle lister). Sikter man under L1 i
     kolonne 1, skal placeholderen dukke opp der — ikke nederst i siste kolonne. */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 640 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [5, 5, 5]);
    const start = await cols(p);
    log('3 forutsetning: én liste per kolonne', start.map((c) => c.join(',')).join('|') === 'L1|L2|L3',
      JSON.stringify(start));
    const l1 = await rectOf(p, '.card[data-id="card-0"]');
    await lift(p, '.card[data-id="card-1"] .item');
    await p.mouse.move(Math.round(l1.cx), Math.round(l1.b) + 20); await p.waitForTimeout(60);
    await p.mouse.move(Math.round(l1.cx), Math.round(l1.b) + 24); await p.waitForTimeout(80);
    const during = await cols(p);
    log('3 placeholderen ligger under L1 i KOLONNE 1', (during[0] || []).join(',') === 'L1,+',
      during.map((c) => c.join(',')).join('|'));
    await p.mouse.move(Math.round(l1.cx), Math.round(l1.b) + 24); await p.mouse.up();
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    log('3 den nye lista havnet MELLOM L1 og L2 i rekkefølgen',
      (await order(p)).join(',') === 'L1,(ny),L2,L3', (await order(p)).join(','));
    log('3 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 4) To veier til samme plass: bunn av kolonne 1 / topp av kolonne 2 ============ */
  for (const path of ['bunnen av kolonne 1', 'toppen av kolonne 2']) {
    const p = await b.newPage({ viewport: { width: 1400, height: 640 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [5, 5, 5]);
    const l1 = await rectOf(p, '.card[data-id="card-0"]');
    const l2 = await rectOf(p, '.card[data-id="card-1"]');
    await lift(p, '.card[data-id="card-2"] .item');
    const aim = path === 'bunnen av kolonne 1'
      ? { x: Math.round(l1.cx), y: Math.round(l1.b) + 30 }   // under L1, i kolonne 1
      : { x: Math.round(l2.cx), y: Math.round(l2.t) - 20 };  // over L2, i kolonne 2
    await p.mouse.move(aim.x, aim.y); await p.waitForTimeout(60);
    await p.mouse.move(aim.x, aim.y + 2); await p.waitForTimeout(80);
    const during = (await cols(p)).map((c) => c.join(',')).join('|');
    const want = path === 'bunnen av kolonne 1' ? 'L1,+|L2|L3' : 'L1|+,L2|L3';
    log('4 ' + path + ': placeholderen vises DER man sikter', during === want, during);
    await p.mouse.move(aim.x, aim.y + 2); await p.mouse.up();
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    log('4 ' + path + ': samme sluttrekkefølge', (await order(p)).join(',') === 'L1,(ny),L2,L3',
      (await order(p)).join(','));
    log('4 ' + path + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 5) Alle kolonner fulle → budsjettet vokser, siden scroller ============ */
  {
    const p = await b.newPage({ viewport: { width: 900, height: 700 } }); // 2 kolonner
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [5, 5]);
    const two = await cols(p);
    log('5 to fulle lister fyller de to kolonnene', two.map((c) => c.join(',')).join('|') === 'L1|L2',
      JSON.stringify(two));
    await seed(p, [5, 5, 5]);
    const three = await cols(p);
    log('5 en tredje liste får kolonnene til å VOKSE (ingen tredje kolonne finnes)',
      three.length === 2 && three.flat().join(',') === 'L1,L2,L3', JSON.stringify(three));
    log('5 den øverste i kolonne 2 gled ned som den nederste i kolonne 1',
      three[0].length === 2 && three[0][1] === 'L2' && three[1].join(',') === 'L3', JSON.stringify(three));
    const scrolls = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 4);
    log('5 siden scroller når kolonnene er høyere enn skjermen', scrolls);
    log('5 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 6) Ingen flimring mot en KOLLAPSET liste under kilden ============
     Modusbyttet rykket en gang alt under den gamle plassen OPPOVER: den
     kort-formede ny-liste-placeholderen forlot kolonnen. En kollapset liste har
     en kort sone, så hoppet rakk å legge sonen forbi objektet: det falt ut igjen,
     placeholderen kom tilbake, lista ble dyttet ned … én runde per piksel.
     Stripa tar ingen plass lenger, så hoppet finnes ikke; dette er vakten om
     noen skulle gi den høyde igjen. */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 760 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [2, 2, 2]);
    await p.evaluate(() => {
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards.find((c) => c.id === 'card-1').collapsed = true;
      H.render();
    });
    await p.waitForTimeout(400);
    const z = await lift(p, '.card[data-id="card-0"] .item');
    const seq = [];
    for (let i = 0; i < 160; i++) {
      await p.mouse.move(z.cx, z.cy + 8 + i * 2);
      const now = (await cols(p)).map((c) => c.join(',')).join('|');
      if (seq[seq.length - 1] !== now) seq.push(now);
    }
    await p.mouse.up(); // musen har ingen ekte avbrytelse; her er slippet bare slutten
    await p.waitForTimeout(300);
    const counts = {};
    seq.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    const worst = Math.max(...Object.values(counts));
    // Layouten skal endre seg noen få ganger på veien ned (inn/ut av lister), men
    // ingen tilstand skal komme igjen om og om igjen — det er flimring.
    log('6 ingen tilstand gjentas mer enn to ganger gjennom 320 px', worst <= 2, 'verste=' + worst + '×');
    log('6 få layout-overganger totalt', seq.length <= 8, 'overganger=' + seq.length + ' :: ' + seq.join('  →  '));
    log('6 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 7) Ut-terskelen er den samme linja, også etter en tur innom ============
     Går man INN i en liste underveis og videre ut under den, skal ut-terskelen
     være nøyaktig den dokumenterte: nedre 1/3 forbi kortkanten. Den var en gang
     noe annet — ny-liste-placeholderen skjøv kortene når den kom og gikk, og
     slarken som kompenserte for hoppet ble liggende, så man måtte dra en
     placeholderhøyde EKSTRA for å komme ut igjen. Stripa tar ingen plass lenger,
     så hoppet finnes ikke og slarken er borte; det denne sjekker er at linja da
     er den samme inn og ut. */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seed(p, [3, 3, 3]); // L1 og L2 i kolonne 1
    const z = await lift(p, '.card[data-id="card-0"] .item');
    // Dra nedover gjennom board-lufta, INN i L2, og videre ut under den.
    let entered = null, left = null, prev = null;
    // 240, ikke 200: kassen følger objektet (`retargetDragTrash`), så L2 blir en
    // knapperad høyere i det raden kommer inn i den — og ut-linja flytter seg
    // like langt ned. Det er ikke slark: kassen ER en del av kortet, og
    // regnestykket under måler mot kortets bunn slik den står NÅ.
    for (let i = 0; i < 240; i++) {
      await p.mouse.move(z.cx, z.cy + 8 + i * 3);
      const s = await p.evaluate(() => {
        const d = document.querySelector('#board .item[data-dnd-dragging]');
        const ph = document.querySelector('#board [data-dnd-placeholder]');
        const ar = document.querySelector('.card[data-id="card-1"]');
        /* Den LOGISKE dra-boksen, som treffdeteksjonen bruker — hentet fra
           appen selv (`__huskis.dragBox` → `draggedRect`: pekeren minus grepet,
           uklemt og uten rotasjon/skala). Rekonstruert fra dnd-kits
           `intentRectangle` lå den inntil én frame bak, og et sveip i 3 px steg
           målte da terskelen opp til to steg feil. */
        const db = window.__huskis.dragBox;
        const h = db ? db.height : d.offsetHeight;
        const top = db ? db.top : NaN;
        const r = ar && ar.getBoundingClientRect();
        return {
          mode: document.querySelector('.new-list-placeholder') ? 'extract' : (ph ? 'reorder' : '-'),
          phCard: ph && ph.closest('.card') ? ph.closest('.card').dataset.id : null,
          botThird: top + h - h / 3,
          addMid: r ? r.bottom : null,
        };
      });
      if (!entered && s.mode === 'reorder' && s.phCard === 'card-1') entered = s;
      // Geometrien leses fra prøven FØR overgangen, som terskelen ble målt mot.
      if (entered && s.mode === 'extract') { left = { botThird: s.botThird, addMid: prev.addMid }; break; }
      prev = s;
    }
    await p.mouse.up(); // musen har ingen ekte avbrytelse; her er slippet bare slutten
    await p.waitForTimeout(300);
    log('7 objektet gikk inn i L2 og ut igjen', !!entered && !!left);
    if (left) {
      const over = left.botThird - left.addMid;
      log('7 ut-terskelen er nedre 1/3 forbi kortkanten, også etter en tur innom',
        over >= 0 && over <= 12, 'forbi=' + over.toFixed(1) + ' px');
    }
    log('7 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 8) ResizeObserver-målene hoper seg ikke opp ============
     `relayoutBoard` observerer kortene for å fange høydeendringer, men `render()`
     river alle kortnodene (og appen re-rendrer ved hver synk). Uten opprydding
     ville observasjonene av de frakoblede nodene blitt liggende og vokst i det
     uendelige. */
  {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(() => {
      const RO = window.ResizeObserver;
      window.__roLive = new Set();
      window.ResizeObserver = class extends RO {
        observe(t, o) { window.__roLive.add(t); return super.observe(t, o); }
        unobserve(t) { window.__roLive.delete(t); return super.unobserve(t); }
        disconnect() { window.__roLive.clear(); return super.disconnect(); }
      };
    });
    await register(p);
    await seed(p, [3, 3, 3]);
    const live = () => p.evaluate(() => ({
      total: window.__roLive.size,
      detached: [...window.__roLive].filter((t) => !t.isConnected).length,
    }));
    const first = await live();
    for (let i = 0; i < 15; i++) await p.evaluate(() => window.__huskis.render());
    await p.waitForTimeout(400);
    const after = await live();
    log('8 antall observerte mål er uendret etter 15 re-rendringer',
      after.total === first.total, JSON.stringify({ first, after }));
    log('8 ingen frakoblede noder blir liggende og observeres', after.detached === 0, JSON.stringify(after));
    // Tom mappe: kortene slippes, kun de tre permanente står igjen — board-et,
    // toppmenyen og toppkontrollgruppen (`syncTopChrome`, docs/menus.md).
    await p.evaluate(() => {
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards = []; H.render();
    });
    await p.waitForTimeout(400);
    const empty = await live();
    /* Fire PERMANENTE mål står igjen: toppmenyen, hjørnegruppen og de to
       board-ene (listenes og notatenes — docs/notater-plan.md). Kortene skal
       være meldt av. */
    log('8 tom mappe slipper alle kort-observasjoner', empty.total <= 4 && empty.detached === 0, JSON.stringify(empty));
    log('8 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- (9) Fordelingen er ferdig før drop-animasjonen ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    // Ujevne høyder, så en flytting mellom kolonner faktisk endrer pakkingen.
    await seed(p, [10, 2, 10, 2, 10, 2, 8]);
    const før = await cols(p);
    log('9 board-et har flere kolonner', før.length >= 2, JSON.stringify(før));

    // Løft den ØVERSTE lista i kolonne 1 og slipp den nederst i kolonne 2.
    const h = await G.centre(p, '.board .board-col:first-child .card .card-head');
    await G.lift(p, h, false);
    const to = await p.evaluate(() => {
      const c2 = [...document.querySelectorAll('.board > .board-col')][1];
      const kort = [...c2.children].filter((x) => x.classList.contains('card'));
      const siste = kort[kort.length - 1].getBoundingClientRect();
      return { x: siste.left + siste.width / 2, y: siste.top + siste.height * 0.9 };
    });
    await G.travel(p, to, false);
    /* Følg FLUKTEN, frame for frame, så lenge klonen står. Det er den siste
       posisjonen animasjonen når som avslører om den siktet riktig: en måling
       etterpå ser bare hvileposisjonen, uansett hvor kortet var på vei. */
    await p.evaluate(() => {
      window.__flukt = [];
      const kort = () => document.querySelector('.card[data-id="card-0"]');
      const tikk = () => {
        const a = kort();
        if (a) window.__flukt.push(Math.round(a.getBoundingClientRect().top + window.scrollY));
        if (document.querySelector('.board [data-dnd-placeholder]')) requestAnimationFrame(tikk);
      };
      requestAnimationFrame(tikk);
    });
    await p.mouse.up();
    // MENS klonen står: fordelingen skal allerede være den endelige.
    await p.waitForTimeout(80);
    const under = await p.evaluate(() => ({
      kol: [...document.querySelectorAll('.board > .board-col')].map((col) => [...col.children]
        .filter((el) => !el.hasAttribute('data-dnd-placeholder'))
        .map((el) => (el.querySelector('.card-title') || {}).textContent)),
      klone: document.querySelectorAll('.board [data-dnd-placeholder]').length,
    }));
    log('9 klonen står ennå (drop-animasjonen pågår)', under.klone === 1, 'kloner=' + under.klone);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-placeholder]'), null, { timeout: 4000 });
    await p.waitForTimeout(700);
    const flukt = await p.evaluate(() => window.__flukt);
    const hvile = await p.evaluate(() =>
      Math.round(document.querySelector('.card[data-id="card-0"]').getBoundingClientRect().top + window.scrollY));
    const enden = flukt.length ? flukt[flukt.length - 1] : null;
    log('9 flukten ble faktisk fulgt', flukt.length >= 3, 'målinger=' + flukt.length);
    log('9 animasjonen ender der kortet blir liggende (ingen teleportering)',
      enden !== null && Math.abs(enden - hvile) <= 4,
      'ende=' + enden + ' hvile=' + hvile + ' flukt=' + JSON.stringify(flukt.slice(-4)));
    /* … og den går DIT hele veien. Kjøres fordelingen først etter at dnd-kit har
       regnet ut hvor kortet skal fly, sikter flukten på den frosne sloten: den
       beveger seg BORT fra hvileplassen (målt til ~1000 px) før klonen forsvinner
       og kortet teleporterer tilbake. Slingringsmonnet dekker at første måling
       tas før drop-transformen er satt. */
    const avstand = flukt.map((v) => Math.abs(v - hvile));
    const verst = Math.max(...avstand);
    log('9 flukten beveger seg mot hvileplassen hele veien',
      flukt.length > 0 && verst <= avstand[0] + 60,
      'verst=' + verst + ' først=' + avstand[0]);
    const etter = await cols(p);
    log('9 kolonnefordelingen er den samme før og etter at klonen forsvinner',
      JSON.stringify(under.kol) === JSON.stringify(etter),
      'under=' + JSON.stringify(under.kol) + ' etter=' + JSON.stringify(etter));
    log('9 lista havnet i den andre kolonnen', etter[1].includes('L1'), JSON.stringify(etter));
    log('9 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + (ok === results.length ? ' PASS ====' : ' — NOEN FEILET ===='));
  process.exit(ok === results.length ? 0 : 1);
})();
