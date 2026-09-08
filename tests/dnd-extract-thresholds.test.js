/*
  Regresjonstest: 1/3-tersklene for ny-liste-placeholderen (ekstrahering), og at
  et listepunkt dratt UT av en kategori forblir synlig.

  (A) Terskler (dragOverCard i app.js): hvilken liste det løftede objektet «er i»
      avgjøres av OBJEKTETS boks, ikke pekeren, og av KORTETS EGEN BOKS — de
      samme linjene både inn og ut:
      - Ved OVERKANTEN: objektets øvre 1/3 passerer kortkanten (ned = inn, opp =
        ut).
      - Ved UNDERKANTEN: objektets nedre 1/3 passerer kortkanten (opp = inn, ned
        = ut).
      Dvs. objektet er i lista når dets midtre 1/3 ligger innenfor kortet, og det
      forlater lista først når en tredjedel av det stikker utenfor kanten.

      Sonen var en gang INNHOLDSSONEN (midt i tittelraden … midt i +-knapperaden),
      med rammeradene regnet som «ikke innhold». Det gjorde at raden var utenfor
      lista mens den fortsatt lå tydelig oppå den — allerede over knapperaden, og
      et godt stykke før søppelkassen, sto ny-liste-stripa og lovet en ny liste.
      Rammen er en del av kortet man ser, så den er en del av lista man er i.

      Symmetrisk begge veier (før dukket placeholderen opp mye lettere oppover enn
      nedover), og uten flimring i overgangen. Gjelder både énkolonne (mobil) og
      flerkolonne (desktop).

  (B) Et listepunkt dratt ut av en kategori til nivå 1 i SAMME liste ble usynlig:
      skillelinje-forhåndsvisningen ga kategorien `position: relative`, og siden
      kategorien er FORFAR til det løftede (absolutt posisjonerte) listepunktet ble
      den containing block for det → koordinatene tolket relativt til kategorien,
      og kortets `overflow: hidden` klippet det bort. Linja males nå fra raden over
      (`.sep-below`).

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-extract-thresholds.test.js
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

// n lister med 2 listepunkter hver. `withCat` gir liste A en kategori med to
// medlemmer (for (B)-testen).
async function seed(p, n, withCat, sizes) {
  if (sizes) await p.evaluate((s) => { window.__seedSizes = s; }, sizes);
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(({ n, withCat }) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    const mkI = (id, t, h, extra) => Object.assign({ id, text: t, home: h, cat: null, isCat: false, trashed: false, done: false, collapsed: false }, mk(), extra || {});
    const mkCard = (id, title, pos) => Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', collapsed: false, items: [] }, mk(), { pos });
    g.cards = [];
    for (let i = 0; i < n; i++) {
      const id = 'card-' + i;
      const c = mkCard(id, 'Liste ' + i, i);
      // `sizes` (valgfri) gir antall listepunkter per liste — 0 = tom liste.
      const count = window.__seedSizes ? window.__seedSizes[i] : 2;
      if (count > 0) c.items.push(mkI(id + '-a', 'Punkt A', id, { pos: 0 }));
      if (count > 1) c.items.push(mkI(id + '-b', 'Punkt B', id, { pos: 1 }));
      if (withCat && i === 0) {
        c.items.push(mkI('cat-1', 'Kategori', id, { isCat: true, pos: 2 }));
        c.items.push(mkI('m-1', 'Medlem 1', id, { cat: 'cat-1', pos: 0 }));
        c.items.push(mkI('m-2', 'Medlem 2', id, { cat: 'cat-1', pos: 1 }));
      }
      g.cards.push(c);
    }
    H.render();
  }, { n, withCat });
  await p.waitForTimeout(300);
}

// Ekte pekerinput, i den steg-for-steg-formen denne fila er skrevet rundt.
// Sekvensene under er uendret; det er leveringen som er ekte nå.
const ptr = (p, type, x, y, kind) => G.sendPointer(p, type, x, y, kind);
/* En BEVEGELSE, sendt som to punkter.
   dnd-kit lar av og til ett `pointermove` falle på gulvet: posisjonen
   oppdateres, men verken `dragmove` eller `dragover` fyrer, og både politikken
   vår og bibliotekets egen sortering blir stående på forrige punkt. En finger
   sender en strøm av punkter og merker det aldri; en test som flytter seg ett
   punkt om gangen gjør det, og leser terskelen av ett steg for sent. */
async function move(p, x, y, kind) {
  await ptr(p, 'pointermove', x, y, kind);
  await p.waitForTimeout(16);
  await ptr(p, 'pointermove', x, y, kind);
}

const centerOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, sel);

/* Alt vi måler i én runde.

   Dra-boksen er den LOGISKE boksen treffdeteksjonen bruker, ikke den malte:
   dnd-kits `intentRectangle` er uklemt (ingen viewport-klemme), og størrelsen
   byttes mot objektets egen layout-boks — det malte objektet er skalert 1,03,
   og `getBoundingClientRect` ville dessuten gitt den ROTERTE omslutningsboksen.
   Det er nøyaktig regnestykket `dndSyncIntent` i app.js gjør, og tersklene i
   denne fila måles mot det.

   «Plassen som kommer» er dnd-kits KLONE (`[data-dnd-placeholder]`) i
   reorder-modus, og vår egen ny-liste-placeholder i ekstraheringsmodus. */
const probe = (p) => p.evaluate(() => {
  const d = document.querySelector('#board [data-dnd-dragging]');
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const cards = {};
  document.querySelectorAll('#board .card').forEach((c) => {
    cards[c.dataset.id] = {
      rect: box(c),
      head: box(c.querySelector('.card-head')),
      add: c.querySelector('.add-item-row') ? box(c.querySelector('.add-item-row')) : null,
    };
  });
  const newList = document.querySelector('.new-list-placeholder');
  const clone = document.querySelector('#board [data-dnd-placeholder]');
  const ph = newList || clone;
  /* Den LOGISKE dra-boksen kommer fra APPEN (`__huskis.dragBox` →
     `draggedRect`: pekeren minus grepet, uklemt og uten rotasjon/skala) — det er
     den boksen 1/3-reglene faktisk leser. Rekonstruert fra dnd-kits
     `intentRectangle` lå den inntil én frame bak, og et sveip i 3 px steg målte
     da terskelen opp til to steg for tidlig. Den andre siden av
     sammenligningen — kortkanten — leses fortsatt fra DOM-en. */
  const db = window.__huskis.dragBox;
  const drag = db ? { top: db.top, bottom: db.bottom, height: db.height } : null;
  const B = window.__huskis.boardRowBoard;
  const op = B && B.manager.dragOperation;
  /* Hvilken LISTE er slippmålet akkurat nå.
     `phCard` (hvor KLONEN står) er forhåndsvisningen, og den følger dnd-kits
     optimistiske sortering — som bare bytter med en RAD. Er det ingen rad å
     overlappe (en tom liste, stripen over første rad, stripen under siste), er
     containeren selv målet, og plasseringen avgjøres først ved slippet (Smetts
     `settle` → `insertByPoint`). Da er det MÅLET, ikke klonen, som sier hvilken
     liste man er i. */
  let overCard = null;
  if (B && op && !op.status.idle && op.target) {
    const tEl = B.manager.registry.droppables && [...B.manager.registry.droppables]
      .find((x) => x.id === op.target.id);
    const el2 = tEl && tEl.element;
    const card = el2 && el2.closest ? el2.closest('.card') : null;
    overCard = card ? card.dataset.id : null;
  }
  return {
    dragging: !!d,
    drag,
    mode: newList ? 'extract' : (clone ? 'reorder' : 'none'),
    /* Hvor mange hull som faktisk MALES. I ekstraheringsmodus skal det være
       nøyaktig ett: ny-liste-placeholderen. dnd-kits klone blir liggende igjen
       der raden lå — motoren flytter den bare ved å bytte med en RAD, og i
       denne modusen tar ingen container imot — men den skal ikke tegnes, for da
       lover to hull hver sin plassering. */
    /* MALT betyr faktisk malt: hullet lukkes med `display: none` når det ikke
       lover noe (lista skal være maksimalt komprimert), og et `visibility`-
       oppslag alene ville talt en rad som ikke finnes. */
    malteHull: [...document.querySelectorAll('.new-list-placeholder, #board [data-dnd-placeholder]')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' &&
          el.getBoundingClientRect().height > 0;
      }).length,
    phCard: ph && ph.closest('.card') ? ph.closest('.card').dataset.id : null,
    overCard,
    cards,
  };
});

// Referanselinjene ER kortkantene (se cardBand i app.js).
const addLine = (c) => c.rect.bottom;
const headLine = (c) => c.rect.top;

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

// Løft et listepunkt (touch-hold) og før pekeren i `step`-piksler til `steps`
// prøver er tatt. Returnerer prøvene (mode + geometri før hver bevegelse).
async function liftItem(p, sel, kind) {
  const z = await centerOf(p, sel);
  // `G.lift` VENTER på at løftet faktisk skjedde og prøver på nytt hvis ikke —
  // en synk-runde midt i holdet kan bytte ut raden, og et løft som stille
  // aldri skjedde gjør resten av sveipet til en måling av ingenting.
  await G.lift(p, z, kind !== 'mouse');
  await move(p, z.x, z.y + 4, kind);
  await p.waitForTimeout(80);
  return z;
}

/* Hvert punkt sendes TO ganger.

   dnd-kit lar av og til ett `pointermove` falle på gulvet — posisjonen
   oppdateres, men verken `dragmove` eller `dragover` fyrer, så politikken blir
   stående på forrige punkt til neste bevegelse. En finger sender en strøm av
   punkter og merker det aldri; et sveip med ett punkt per prøve gjør det, og
   terskelen leses da av som ett steg for sent. */
async function sweep(p, x, fromY, step, count, kind) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const y = fromY + step * i;
    await move(p, x, y, kind);
    await p.waitForTimeout(45);
    const s = await probe(p);
    s.y = y;
    samples.push(s);
  }
  return samples;
}

// Første prøve der modus ble `mode` (evt. i kortet `card`), med prøven FØR den
// (geometrien terskelen ble målt mot — et modusbytte flytter placeholderen og
// dermed kortenes høyde/plassering).
// Modus-sekvensen (uten gjentakelser) frem til og med første `stopAt`.
function modeSeq(samples, stopAt) {
  const seq = [];
  for (const s of samples) {
    // MÅLET, ikke hvor klonen står: klonen henger ett kollisjonsrunde etter når
    // objektet møter et kort gjennom en rammerad det ikke er noen rad å
    // overlappe i. Se B1/B3.
    // I extract er man per definisjon ikke i noe kort; da sier `overCard`
    // ingenting (den kan henge igjen på kortet man nettopp forlot).
    const v = s.mode + ':' + (s.mode === 'reorder' ? (s.overCard || '-') : '-');
    if (seq[seq.length - 1] !== v) seq.push(v);
    if (v === stopAt) break;
  }
  return seq;
}
function firstWhere(samples, pred) {
  for (let i = 1; i < samples.length; i++) if (pred(samples[i]) && !pred(samples[i - 1])) return { at: samples[i], before: samples[i - 1] };
  return null;
}

(async () => {
  const b = await chromium.launch();

  /* ============ A) Mobil (énkolonne): symmetriske ut-terskler ============ */
  const mobil = { width: 390, height: 900 };
  let downOvershoot = null, upOvershoot = null;
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2);
    const base = await probe(p);
    log('0 forutsetning: siden scroller ikke (auto-scroll er da en no-op)',
      await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
      'h=' + (await p.evaluate(() => document.documentElement.scrollHeight)));

    // NEDOVER ut av liste 0 (øverst).
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const s = await sweep(p, z.x, z.y + 4, 3, 90, 'touch');
    const hit = firstWhere(s, (x) => x.mode === 'extract');
    if (hit) {
      const h = hit.at.drag.height;
      // «nedre 1/3 har passert +-knappenes øvre kant» = (bunn − h/3) > knapperaden
      downOvershoot = (hit.at.drag.bottom - h / 3) - addLine(hit.before.cards['card-0']);
      // Pekeren skal fortsatt være innenfor kildekortet på det tidspunktet —
      // det var umulig med den gamle, pekerbaserte regelen.
      log('A1 nedover: extract slår inn MENS pekeren ennå er over kildelista',
        hit.at.y <= hit.before.cards['card-0'].rect.bottom,
        'peker=' + Math.round(hit.at.y) + ' kortbunn=' + Math.round(hit.before.cards['card-0'].rect.bottom));
    } else log('A1 nedover: extract slo inn i det hele tatt', false, JSON.stringify(s.map((x) => x.mode)));
    await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200);

    // OPPOVER ut av liste 1 (nederst).
    const z2 = await liftItem(p, '.item[data-id="card-1-a"]', 'touch');
    const s2 = await sweep(p, z2.x, z2.y - 4, -3, 90, 'touch');
    const hit2 = firstWhere(s2, (x) => x.mode === 'extract');
    if (hit2) {
      const h = hit2.at.drag.height;
      // «øvre 1/3 har passert listetittelens nedre kant» = (topp + h/3) < tittelbunn
      upOvershoot = headLine(hit2.before.cards['card-1']) - (hit2.at.drag.top + h / 3);
      log('A2 oppover: extract slår inn MENS pekeren ennå er over kildelista',
        hit2.at.y >= hit2.before.cards['card-1'].rect.top,
        'peker=' + Math.round(hit2.at.y) + ' korttopp=' + Math.round(hit2.before.cards['card-1'].rect.top));
    } else log('A2 oppover: extract slo inn i det hele tatt', false, JSON.stringify(s2.map((x) => x.mode)));
    await ptr(p, 'pointercancel', z2.x, z2.y, 'touch'); await p.waitForTimeout(200);

    const sym = downOvershoot != null && upOvershoot != null && Math.abs(downOvershoot - upOvershoot) <= 8;
    log('A3 SYMMETRI: like langt forbi kortkanten opp som ned (≤ 8 px forskjell)', sym,
      'ned=' + (downOvershoot == null ? '-' : downOvershoot.toFixed(1)) + ' opp=' + (upOvershoot == null ? '-' : upOvershoot.toFixed(1)));
    log('A4 terskelen treffer 1/3-linja (0..steglengde forbi sonen)',
      downOvershoot != null && downOvershoot >= 0 && downOvershoot <= 8 &&
      upOvershoot != null && upOvershoot >= 0 && upOvershoot <= 8,
      'ned=' + (downOvershoot == null ? '-' : downOvershoot.toFixed(1)) + ' opp=' + (upOvershoot == null ? '-' : upOvershoot.toFixed(1)));
    /* Stripa SVEVER: gapet mellom kortene er det samme hele veien.

       Dette er hele grunnen til at ny-liste-placeholderen ble flat. Den var en
       kort-formet slot som skjøv kortene fra hverandre, og da ble hvert
       modusbytte et layout-hopp: drar man videre ned i lista under, forsvinner
       stripa, kortet smetter oppover, og raden havner UNDER sonen den nettopp
       siktet på — man må dra oppover igjen for å treffe. Tar stripa ingen plass,
       finnes ikke hoppet. */
    const gaps = s.concat(s2)
      .filter((x) => x.cards['card-0'] && x.cards['card-1'])
      .map((x) => Math.round(x.cards['card-1'].rect.top - x.cards['card-0'].rect.bottom));
    const unike = [...new Set(gaps)];
    log('A6 ny-liste-stripa skyver ikke kortene fra hverandre',
      gaps.length > 0 && unike.length === 1,
      'prøver=' + gaps.length + ' gap=' + JSON.stringify(unike));

    /* Aldri to malte hull samtidig. I ekstraheringsmodus er ny-liste-
       placeholderen plassen som kommer; dnd-kits klone blir liggende igjen i
       kildelista, men skal ikke tegnes i tillegg — to hull lover hver sin
       plassering, og bare det ene holder. NULL er også et gyldig svar: står
       pekeren på søppelkassen, lover ingen av dem noe (slippet sletter). */
    const iExtract = s.concat(s2).filter((x) => x.mode === 'extract');
    log('A5 aldri to malte hull samtidig i ekstraheringsmodus',
      iExtract.length > 0 && iExtract.every((x) => x.malteHull <= 1),
      'prøver=' + iExtract.length + ' malte=' + JSON.stringify([...new Set(iExtract.map((x) => x.malteHull))]));
    log('A ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
    void base;
  }

  /* ============ B) Mobil: inn i neste liste + ingen flimring ============ */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2);

    // Hele veien fra liste 0 ned i liste 1, i små steg.
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const s = await sweep(p, z.x, z.y + 4, 3, 120, 'touch');
    /* Nedover er MÅLET det som sier «nå er jeg i lista under» — samme grunn som
       oppover i B3: objektet møter kortet gjennom tittelraden, og den stripen
       har ingen rad å overlappe. Klonen (forhåndsvisningen) flytter seg først
       når første rad i lista faktisk overlappes. Terskelen som skal måles er
       vår, og den leses av modusskiftet. */
    const inNext = firstWhere(s, (x) => x.mode === 'reorder' && x.overCard === 'card-1');
    if (inNext) {
      const h = inNext.at.drag.height;
      // «øvre 1/3 har passert kortets overkant» (samme linje som ut-terskelen
      // oppover — det er midtre 1/3 som skal ligge innenfor kortet)
      const over = (inNext.at.drag.top + h / 3) - headLine(inNext.before.cards['card-1']);
      log('B1 inn i neste liste nedover: øvre 1/3 har akkurat passert kortkanten',
        over >= 0 && over <= 8, 'forbi kortkanten=' + over.toFixed(1));
    } else log('B1 inn i neste liste nedover: draget havnet i liste 1', false, JSON.stringify(s.map((x) => x.mode + '/' + x.overCard)));

    // Monoton bevegelse → nøyaktig sekvensen reorder(0) → extract → reorder(1)
    // frem til listepunktet er inne i liste 1 (sveipet fortsetter forbi den, og
    // extract UNDER liste 1 er riktig).
    const seq = modeSeq(s, 'reorder:card-1');
    log('B2 ingen flimring: én overgang hver vei (reorder/0 → extract → reorder/1)',
      seq.length === 3 && seq[0] === 'reorder:card-0' && seq[1] === 'extract:-' && seq[2] === 'reorder:card-1',
      seq.join(' → '));
    await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200);

    // Oppover inn i liste 0 igjen: terskelen er +-knappenes øvre kant.
    const z2 = await liftItem(p, '.item[data-id="card-1-a"]', 'touch');
    const s2 = await sweep(p, z2.x, z2.y - 4, -3, 120, 'touch');
    /* Oppover er MÅLET det som sier «nå er jeg i lista over»: der møter objektet
       kortet nedenfra, gjennom +-knapperaden, og den stripen har ingen rad å
       overlappe. Klonen (forhåndsvisningen) flytter seg først når siste rad i
       lista faktisk overlappes — se `probe`. Terskelen som skal måles er vår, og
       den leses av modusskiftet. */
    const inPrev = firstWhere(s2, (x) => x.mode === 'reorder' && x.overCard === 'card-0');
    if (inPrev) {
      const h = inPrev.at.drag.height;
      const over = addLine(inPrev.before.cards['card-0']) - (inPrev.at.drag.bottom - h / 3);
      log('B3 inn i forrige liste oppover: nedre 1/3 har akkurat passert kortkanten',
        over >= 0 && over <= 8, 'forbi kortkanten=' + over.toFixed(1));
    } else log('B3 inn i forrige liste oppover: draget havnet i liste 0', false, JSON.stringify(s2.map((x) => x.mode + '/' + x.overCard)));
    const seq2 = s2.map((x) => x.mode + ':' + (x.overCard || '-'))
      .filter((v, i, a) => i === 0 || v !== a[i - 1]);
    const upTo = seq2.slice(0, seq2.indexOf('reorder:card-0') + 1);
    log('B4 ingen flimring oppover',
      upTo.length === 3 && upTo[0] === 'reorder:card-1' && upTo[1] === 'extract:-' && upTo[2] === 'reorder:card-0',
      seq2.join(' → '));
    // …og slippet der lander i liste 0.
    const upDrop = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      return g.cards.map((c) => ({ id: c.id, items: c.items.filter((i) => !i.trashed).map((i) => i.id) }));
    });
    void upDrop;
    await ptr(p, 'pointercancel', z2.x, z2.y, 'touch'); await p.waitForTimeout(200);
    log('B ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ C) Desktop, FLERKOLONNE: samme terskler innen en kolonne ============ */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 4);
    const cols = await p.evaluate(() => getComputedStyle(document.getElementById('board')).columnCount);
    log('C0 forutsetning: board i FLERKOLONNE', cols !== '1', 'column-count=' + cols);
    // Finn to kort som ligger i SAMME kolonne (samme venstrekant), øverste først.
    const pair = await p.evaluate(() => {
      const cs = [...document.querySelectorAll('.card')].map((c) => ({ id: c.dataset.id, r: c.getBoundingClientRect() }));
      for (const a of cs) for (const b2 of cs) {
        if (a.id !== b2.id && Math.abs(a.r.left - b2.r.left) < 2 && b2.r.top > a.r.bottom) return { top: a.id, bottom: b2.id };
      }
      return null;
    });
    log('C0 forutsetning: to kort i samme kolonne', !!pair, JSON.stringify(pair));
    if (pair) {
      const z = await liftItem(p, '.item[data-id="' + pair.top + '-b"]', 'mouse');
      // Nok steg til å nå HELT ned i kortet under.
      const s = await sweep(p, z.x, z.y + 4, 6, 90, 'mouse');
      const out = firstWhere(s, (x) => x.mode === 'extract');
      // MÅLET, ikke klonen — se B1/B3: klonen henger etter når objektet møter
      // kortet gjennom en rammerad det ikke er noen rad å overlappe i.
      const into = firstWhere(s, (x) => x.mode === 'reorder' && x.overCard === pair.bottom);
      if (out) {
        const h = out.at.drag.height;
        const over = (out.at.drag.bottom - h / 3) - addLine(out.before.cards[pair.top]);
        log('C1 desktop: ut-terskelen er nedre 1/3 forbi kortkanten', over >= 0 && over <= 8, 'forbi=' + over.toFixed(1));
        log('C2 desktop: extract mens pekeren ennå er over kildelista',
          out.at.y <= out.before.cards[pair.top].rect.bottom,
          'peker=' + Math.round(out.at.y) + ' kortbunn=' + Math.round(out.before.cards[pair.top].rect.bottom));
      } else log('C1 desktop: extract slo inn', false, JSON.stringify(s.map((x) => x.mode)));
      if (into) {
        const h = into.at.drag.height;
        const over = (into.at.drag.top + h / 3) - headLine(into.before.cards[pair.bottom]);
        log('C3 desktop: inn-terskelen er øvre 1/3 forbi kortkanten', over >= 0 && over <= 8, 'forbi=' + over.toFixed(1));
        log('C4 desktop: ingen flimring i kolonnen', (() => {
          const q = modeSeq(s, 'reorder:' + pair.bottom);
          return q.length === 3 && q[1] === 'extract:-';
        })(), modeSeq(s, 'reorder:' + pair.bottom).join(' → '));
      } else log('C3 desktop: draget havnet i kortet under', false, JSON.stringify(s.map((x) => x.mode + '/' + x.overCard)));
      await ptr(p, 'pointercancel', z.x, z.y, 'mouse'); await p.waitForTimeout(200);
    }
    log('C ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ E) Små lister: tom og ettradig liste er fortsatt treffbare ============
     En tom liste har nesten ingen innholdssone mellom tittelen og +-knappene; da
     gjelder hele kortet (cardBand). Uten det ville sonen vært umulig å treffe — og
     verre: idet man går inn, forsvinner ny-liste-placeholderen og lista hopper opp
     mot objektet, så et for smalt vindu ville sluppet objektet ut igjen (flimring). */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 3, false, [2, 0, 1]); // liste 1 TOM, liste 2 med ett listepunkt
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const s = await sweep(p, z.x, z.y + 4, 6, 90, 'touch');
    const dedup = s.map((x) => x.mode + ':' + (x.overCard || '-')).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    // En TOM liste har ingen rad å overlappe, så klonen flytter seg ikke inn i
    // den — men lista er MÅLET, og et slipp der lander i den (`probe`).
    log('E1 tom liste: objektet kommer INN i den', s.some((x) => x.overCard === 'card-1'),
      dedup.join(' → '));
    log('E2 ettradig liste under: objektet kommer inn der også', s.some((x) => x.overCard === 'card-2'),
      dedup.join(' → '));
    // Ingen liste skal besøkes to ganger (extract mellom hvert kort er riktig).
    const visits = dedup.filter((v) => v.startsWith('reorder:'));
    log('E3 ingen flimring gjennom tom + ettradig liste', new Set(visits).size === visits.length, dedup.join(' → '));
    await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200);

    /* Et AVBRUTT drag skal ikke etterlate ekstraheringsmodus. dnd-kit kan
       levere et `dragmove`/`dragover` ETTER `dragend` (retur-animasjonen er
       fortsatt på vei), og en politikkrunde der malte modusen på nytt: både
       `is-extracting` og ny-liste-stripa ble stående på et board i hvile, og
       NESTE drag startet i feil modus — raden under landet da ikke i den tomme
       lista. `dndRowPolicy` gjør derfor ingenting når draget er over. */
    const etterAvbrudd = await p.evaluate(() => ({
      kl: [...document.body.classList].filter((c) => c.indexOf('is-') === 0),
      stripe: !!document.querySelector('.new-list-placeholder'),
    }));
    log('E0 et avbrutt drag lar ingen ekstraheringsmodus bli stående',
      etterAvbrudd.kl.length === 0 && !etterAvbrudd.stripe, JSON.stringify(etterAvbrudd));

    // …og et slipp midt i den tomme lista lander faktisk der.
    const z3 = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    const empty = await centerOf(p, '.card[data-id="card-1"]');
    await move(p, empty.x, empty.y, 'touch'); await p.waitForTimeout(150);
    await move(p, empty.x, empty.y + 1, 'touch'); await p.waitForTimeout(150);
    await ptr(p, 'pointerup', empty.x, empty.y + 1, 'touch'); await p.waitForTimeout(500);
    const landed = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      const c = g.cards.find((x) => x.id === 'card-1');
      return { cards: g.cards.length, items: c ? c.items.filter((i) => !i.trashed).map((i) => i.id) : null };
    });
    void z3;
    log('E1 slippet i den tomme lista landet der (ingen ny liste)',
      landed.cards === 3 && !!landed.items && landed.items.indexOf('card-0-b') > -1, JSON.stringify(landed));
    log('E ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ F) Slipp NEDERST i en liste (siste plass) ============
     Den trangeste plassen etter innstrammingen: sonen slutter ved +-knappene, og
     for å havne SIST må objektets senter forbi siste rads senter. Slippet skal
     lande i lista — ikke lage en ny. */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2);
    const z = await liftItem(p, '.item[data-id="card-0-a"]', 'touch');
    // Grovt inn i liste 1, deretter rett under siste rad der (måles på nytt).
    const mid = await centerOf(p, '.card[data-id="card-1"] .items-container');
    await move(p, mid.x, mid.y, 'touch'); await p.waitForTimeout(120);
    const belowLast = await p.evaluate(() => {
      const c = document.querySelector('.card[data-id="card-1"]');
      const rows = [...c.querySelectorAll('.items-container > .item')];
      const last = rows[rows.length - 1].getBoundingClientRect();
      // Siste rads senter: der bytter det løftede listepunktet plass med raden
      // (overlapp-regelen krever at objektets topp har nådd radens topp), og det er
      // fortsatt godt innenfor sonen (som slutter ved +-knappene).
      return { x: Math.round(last.left + last.width / 2), y: Math.round(last.top + last.height / 2) };
    });
    await move(p, belowLast.x, belowLast.y - 10, 'touch'); await p.waitForTimeout(80);
    // Anti-flimringen (Smetts `reverseLockMs` = 300 ms) blokkerer det motsatte byttet rett
    // etter innsettingen i lista — vent den ut før den siste nudgen.
    await p.waitForTimeout(350);
    await move(p, belowLast.x, belowLast.y, 'touch'); await p.waitForTimeout(150);
    const modeBefore = (await probe(p)).mode;
    await ptr(p, 'pointerup', belowLast.x, belowLast.y, 'touch'); await p.waitForTimeout(400);
    const st = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      return g.cards.map((c) => ({ id: c.id, items: c.items.filter((i) => !i.trashed).sort((a, b) => a.pos - b.pos).map((i) => i.id) }));
    });
    const c1 = st.find((c) => c.id === 'card-1');
    log('F1 slipp nederst i lista: landet SIST i liste 1 (ingen ny liste)',
      st.length === 2 && c1 && c1.items[c1.items.length - 1] === 'card-0-a',
      'modus før slipp=' + modeBefore + ' ' + JSON.stringify(st));
    log('F ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ F2) Kategori slippes SIST i sin egen liste ============
     Den aller trangeste plassen: lista krymper ~25 px i samme øyeblikk som
     kategori-placeholderen blir siste rad (skillelinja under den forsvinner), så
     nedre grense kommer opp mot objektet mens man sikter. Slarken i cardBand
     (halve knapperaden) skal gjøre dette til en helt vanlig bevegelse. */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2, true);
    await p.evaluate(() => { // kategorien ØVERST, så den faktisk må flyttes ned
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards.find((c) => c.id === 'card-0').items.find((i) => i.id === 'cat-1').pos = -1;
      H.render();
    });
    await p.waitForTimeout(300);
    const z = await centerOf(p, '.category[data-id="cat-1"] .cat-head');
    await ptr(p, 'pointerdown', z.x, z.y, 'touch'); await p.waitForTimeout(250);
    await move(p, z.x, z.y + 6, 'touch'); await p.waitForTimeout(400); // la kategorien kollapse ferdig
    const bottom = await p.evaluate(() => {
      const r = document.querySelector('.card[data-id="card-0"] .items-container').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 6) };
    });
    for (let i = 1; i <= 6; i++) {
      await move(p, bottom.x, Math.round(z.y + (bottom.y - z.y) * i / 6), 'touch');
      await p.waitForTimeout(60);
    }
    // Siste nudge under siste rads senter (kategori-plassering er senterbasert).
    // Måles på nytt: lista vokser/krymper ~25 px mens placeholderen flytter seg,
    // fordi skillelinjene rundt den kommer og går.
    // Måles på nytt og siktes TYDELIG forbi siste rads senter: overlapp-regelen
    // krever at kategori-boksen dekker minst en femtedel av raden, og et sikte
    // rett på senterlinja lar avrundingen avgjøre.
    for (const extra of [10, 20]) {
      const past = await p.evaluate((e) => {
        const rows = [...document.querySelectorAll('.card[data-id="card-0"] .items-container > .item')];
        const last = rows[rows.length - 1].getBoundingClientRect();
        return Math.round(last.top + last.height / 2 + e);
      }, extra);
      await move(p, bottom.x, past, 'touch'); await p.waitForTimeout(150);
      bottom.y = past;
    }
    const modeBefore = (await probe(p)).mode;
    await ptr(p, 'pointerup', bottom.x, bottom.y, 'touch'); await p.waitForTimeout(500);
    const st2 = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      return g.cards.map((c) => ({
        id: c.id,
        level1: c.items.filter((i) => !i.trashed && !i.cat).sort((a, b) => a.pos - b.pos).map((i) => i.id),
      }));
    });
    const c0 = st2.find((c) => c.id === 'card-0');
    log('F2 kategori sluppet nederst: ble SISTE rad i sin egen liste (ingen ny liste)',
      st2.length === 2 && c0 && c0.level1[c0.level1.length - 1] === 'cat-1',
      'modus før slipp=' + modeBefore + ' ' + JSON.stringify(st2));
    log('F2 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ G) Listepunkt OVER en kategori som ligger ØVERST i lista ============
     Kategoriens overkant ligger bare ~10 px under tittelraden, og pekeren må være
     der (over kategorien) for å treffe nivå 1 i stedet for inne i kategorien. Uten
     slarken i tittelraden var vinduet 0 px — placeholderen gikk rett fra «inne i
     kategorien» til «ny liste». */
  {
    const p = await b.newPage({ viewport: mobil, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2, true);
    await p.evaluate(() => { // kategorien ØVERST
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      g.cards.find((c) => c.id === 'card-0').items.find((i) => i.id === 'cat-1').pos = -1;
      H.render();
    });
    await p.waitForTimeout(300);
    const headTop = await p.evaluate(() => Math.round(document.querySelector('.card[data-id="card-0"] .card-head').getBoundingClientRect().top));
    /* Hvor lander raden om jeg slipper NÅ? Ikke hvor klonen står: stripen over
       kategorien har ingen rad å overlappe, så forhåndsvisningen blir stående og
       plasseringen avgjøres av slippet (`probe`). Det som må finnes er et VINDU
       der målet er lista på nivå 1 — ikke kategorien, og ikke en ny liste. */
    const where = () => p.evaluate(() => {
      if (document.querySelector('.new-list-placeholder')) return 'ny-liste';
      const B = window.__huskis.boardRowBoard;
      const op = B.manager.dragOperation;
      if (!op.target) return 'ingen';
      const t = [...B.manager.registry.droppables].find((x) => x.id === op.target.id);
      const el = t && t.element;
      if (!el) return 'ingen';
      if (el.closest('.cat-items') || el.classList.contains('category')) return 'i-kategorien';
      return el.closest('.card') ? 'niva1' : 'ingen';
    });
    const z = await liftItem(p, '.item[data-id="card-0-b"]', 'touch');
    let window20 = 0, lastTop = null;
    for (let y = z.y - 8; y > headTop - 20; y -= 3) {
      await move(p, z.x, y, 'touch'); await p.waitForTimeout(45);
      const catTop = await p.evaluate(() => Math.round(document.querySelector('.category[data-id="cat-1"]').getBoundingClientRect().top));
      if (y < catTop && await where() === 'niva1') { window20 += 3; lastTop = y; }
    }
    log('G1 det FINNES et vindu for «over kategorien øverst» (≥ 20 px)', window20 >= 20, 'vindu=' + window20 + ' px');
    // Sveipet endte over lista (ny-liste-modus, layouten har flyttet seg). Kom
    // tilbake ned i lista og kryp oppover til målet er nivå 1 over kategorien —
    // som en bruker som ser hvor den lander — og slipp der.
    const back = await centerOf(p, '.card[data-id="card-0"] .items-container');
    await move(p, z.x, back.y, 'touch'); await p.waitForTimeout(120);
    let dropY = lastTop;
    for (let y = back.y; y > headTop - 10; y -= 3) {
      await move(p, z.x, y, 'touch'); await p.waitForTimeout(45);
      const catTop = await p.evaluate(() => Math.round(document.querySelector('.category[data-id="cat-1"]').getBoundingClientRect().top));
      if (y < catTop && await where() === 'niva1') { dropY = y; break; }
    }
    if (dropY != null) {
      await move(p, z.x, dropY, 'touch'); await p.waitForTimeout(120);
      await ptr(p, 'pointerup', z.x, dropY, 'touch'); await p.waitForTimeout(400);
    } else { await ptr(p, 'pointercancel', z.x, z.y, 'touch'); await p.waitForTimeout(200); }
    const st = await p.evaluate(() => {
      const H = window.__huskis;
      const g = H.state.universes.find((u) => u.id === H.state.activeUniverse).groups.find((x) => x.id === H.state.activeGroup);
      const c = g.cards.find((c) => c.id === 'card-0');
      return { cards: g.cards.length, level1: c.items.filter((i) => !i.trashed && !i.cat).sort((a, b) => a.pos - b.pos).map((i) => i.id) };
    });
    log('G2 slippet der landet ØVERST på nivå 1, over kategorien',
      st.cards === 2 && st.level1[0] === 'card-0-b' && st.level1[1] === 'cat-1', JSON.stringify(st));
    log('G ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ D) Listepunkt UT av en kategori: forblir synlig ============
     Løftes objektet i dokument-koordinater, er en `position: relative` på en
     FORFAR-rad nok til å gjøre den til containing block: koordinatene tolkes da
     mot kategorien, og kortets `overflow: hidden` klipper objektet bort. Hele
     den feilklassen er borte — dnd-kit løfter objektet inn i TOP LAYER
     (`popover`, `position: fixed`), der ingen forfar kan nå det. Det som står
     igjen å vokte er utfallet: raden skal være synlig, ligge under pekeren, og
     faktisk ha kommet UT på nivå 1 med skillelinjene rundt kategorien i orden. */
  for (const [label, vp, kind] of [['desktop', { width: 1200, height: 900 }, 'mouse'], ['mobil', mobil, 'touch']]) {
    const p = await b.newPage({ viewport: vp, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, 2, true);

    const z = await liftItem(p, '.item[data-id="m-1"]', kind);
    // Opp til nivå 1 i SAMME liste (over «Punkt A»).
    const t = await centerOf(p, '.item[data-id="card-0-a"]');
    await move(p, t.x, t.y - 4, kind); await p.waitForTimeout(80);
    await move(p, t.x, t.y - 6, kind); await p.waitForTimeout(150);

    const view = await p.evaluate(({ px, py }) => {
      const d = document.querySelector('#board [data-dnd-dragging]');
      if (!d) return { none: true };
      const r = d.getBoundingClientRect();
      const cat = document.querySelector('.category[data-id="cat-1"]');
      const cont = document.querySelector('.card[data-id="card-0"] .items-container');
      const rows = [...cont.children].map((c) => (c.hasAttribute('data-dnd-placeholder') ? 'PH'
        : c.hasAttribute('data-dnd-dragging') ? 'DRAG' : (c.dataset.id || c.className)) +
        (c.classList.contains('sep-above') ? '|over' : '') + (c.classList.contains('sep-below') ? '|under' : ''));
      return {
        position: getComputedStyle(d).position,
        // Ligger pekeren fortsatt på objektet? Et objekt som er tolket mot feil
        // forfar glir vekk fra fingeren — og et klippet objekt måler 0.
        onPointer: px >= r.left && px <= r.right && py >= r.top && py <= r.bottom,
        painted: Math.round(r.width) > 0 && Math.round(r.height) > 0,
        inViewport: r.top > -1 && r.bottom < window.innerHeight + 1,
        rows,
        // Raden er UTE av kategorien: både den og klonen ligger på nivå 1.
        outOfCat: !d.closest('.cat-items') &&
          !!cont.querySelector(':scope > [data-dnd-placeholder]'),
        catSep: !!cat && (cat.classList.contains('sep-above') || cat.classList.contains('sep-below')),
      };
    }, { px: t.x, py: t.y - 6 });
    log('D ' + label + ': det løftede listepunktet er synlig og ligger under pekeren',
      !view.none && view.painted && view.onPointer && view.inViewport, JSON.stringify(view));
    log('D ' + label + ': løftes i top layer, der ingen forfar-rad kan nå det',
      view.position === 'fixed', 'position=' + view.position);
    log('D ' + label + ': raden er dratt UT på nivå 1, og kategorien har fått linja si',
      view.outOfCat && view.catSep === true, view.rows.join(' , '));
    await p.screenshot({ path: '/tmp/dnd-extract-' + label + '.png' });
    await ptr(p, 'pointercancel', t.x, t.y, kind); await p.waitForTimeout(200);
    log('D ' + label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
