/*
  Regresjonstest: DROP-ANIMASJONEN.

  5. Slippes objektet ved (eller utenfor) viewportkanten, skal fly-inn-animasjonen
     starte fra objektets FAKTISK RENDREDE boks — ikke fra den UKLEMTE
     `drag.lastX - grabX`, som ligger utenfor skjermen når klemmen har slått inn
     (ga et synlig hopp idet man slapp). Alle fem nivåene kjører på dnd-kit
     (`docs/drag-and-drop.md`), så drop-animasjonen er bibliotekets og klemmen
     Smetts `SafeViewport`. Påstanden måles derfor som den gjelder: objektet
     holder seg innenfor viewporten, og slippet lar ingen dra-maling bli igjen.
  6. Løftets MALING følger objekttypen, og ikke en hardkodet verdi for alt:
     skala 1.02 for en liste og et område, 1.03 for et listepunkt, en mappe og en
     kategori, og kategorien males i tillegg KOMPAKT som en rad (hylla er foldet
     sammen ved løft). Skalaen ligger i CSS på `[data-dnd-dragging]`, så det som
     måles er det som faktisk STÅR MALT under draget — og at INGENTING roteres:
     vinkelen er fjernet. Skalaen ligger fortsatt i en EGEN egenskap, for
     dnd-kit skriver `transform` selv, med
     `!important`, så en rotasjon lagt der ville forsvunnet uten at noe annet
     feilet. Nav-modalens to nivåer måles motsatt: der er draget låst til én
     akse, og da males det UTEN rotasjon (`dnd-vertical-axis`).
     Og løftet gjelder HELE den malte flaten, ikke bare det ytterste laget:
     notatkortet er tre flater oppå hverandre (kortfargen, korthodet, platen
     utdraget står på), og med bare den ytterste sluppet gjennom leser det
     løftede kortet som ugjennomsiktig. Måles på notatkortet i BEGGE drakter og
     på BEGGE viewportene — hodet er ugjennomsiktig i lys drakt uten regelen,
     platen i mørk.
  7. To hvile-regler må vike for det LØFTEDE objektet, og de sier det med
     dnd-kits krok — ikke med en klasse:
       a) MØRK drakt gir et hvilende listepunkt en svak inset-kant
          (`:root[data-theme="dark"] .item:not([data-dnd-dragging])`). Selektoren
          er sterkere enn løfte-regelen, så uten unntaket ville det løftede
          listepunktet mistet sin egen `--shadow-lg` — i mørk drakt alene.
       b) En KLIKK-kollapset kategori har `margin-top: -4px` på hylla si
          (`.category.collapsed:not([data-dnd-dragging]) > .cat-items`). Det
          løftede objektet har allerede `gap: 0`, så margen ville gjort det 4px
          lavere enn klonen som holder plassen.
     Begge er usynlige for enhver annen sjekk i suiten: de gjelder bare mens noe
     er løftet, og bare i den ene drakten / den ene kollaps-tilstanden.

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-drop-animation.test.js
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
    g.cards = cards.map(([title, n], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) {
        const it = Object.assign({ id: 'it-' + title + '-' + i, text: title + ' ' + i, home: id, cat: null, trashed: false, done: false }, mk());
        it.pos = i; c.items.push(it);
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

/* Ett notatkort med utdrag: notatfanens kort er det eneste stedet der alle tre
   malte lagene (kortflaten, hodet, platen) står oppå hverandre på ett objekt. */
async function seedNote(p) {
  const id = await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject();
    proj.name = 'Fagstoff';
    H.setActiveProject(proj.id);
    H.setActiveNoteFolder(null);
    const n = H.addNote();
    H.closeNoteEditor();
    n.title = 'Blodprøver';
    n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: 'Hemoglobin og ferritin måles på nytt.' }] }] };
    H.save();
    H.renderNotes();
    return n.id;
  });
  await p.evaluate(() => window.__huskis.closeNotesNav());
  // Utdraget MÅ stå malt: uten det finnes ikke platen denne sjekken måler.
  await p.waitForFunction((id) => {
    const el = document.querySelector('#notes-board .note-card[data-id="' + id + '"] .note-card-excerpt');
    return !!el && !el.hidden;
  }, id, { timeout: 6000, polling: 100 });
  return id;
}

const centerOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

// Slipp pekeren og les AV SAMME SYNKRONE TASK hvor drop-animasjonen starter:
// dropIntoPlaceholder setter start-transformen før nettleseren maler igjen.
// `from` = objektets faktiske (u-roterte) boks der det stod malt under draget,
// `rest` = hvileboksen etter slippet. Start-transformens translate skal føre
// hvileboksen NØYAKTIG tilbake til `from` — da starter animasjonen der objektet
// faktisk var, uansett om klemmen holdt det innenfor viewporten.
/*
  Slippet må måles i SAMME øyeblikk som det skjer: drop-animasjonen setter
  transformen i pointerup-håndtereren, og den er ryddet bort igjen når
  animasjonen er ferdig. Med ekte input kan ikke testen måle inni hendelsen, så
  den armerer en lytter først. Den registreres etter appens egen, og kjører
  derfor etter den — nøyaktig der den gamle syntetiske dispatchen målte.
*/

/* Malingen av det løftede objektet på dnd-kit-nivåene: dnd-kit eier geometrien,
   vi eier skala og rotasjon — og de må ligge i egenskaper dnd-kit IKKE skriver. */
const paintOf = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    scale: cs.scale, rotate: el.style.rotate, position: cs.position,
    // Kategoriens kompakte rad-form (se 6 kategori): hylla er foldet sammen, og
    // resten skal lese som ett listepunkt — ikke som en beholder med luft i.
    gap: cs.gap, padding: cs.padding, radius: cs.borderRadius, overflow: cs.overflow,
    // ALT SOM DRAS ER HALVGJENNOMSIKTIG, med et tynt bakgrunnsslør. Objektet
    // ligger oppå det man sikter mot — hullet, ny-liste-stripa, skillelinja,
    // søppelkassen — og skal ikke gjemme svaret. `alfa` er bakgrunnens
    // alfakanal (ikke elementets `opacity`: teksten skal stå i full styrke).
    alfa: alphaOf(cs.backgroundColor), opacity: cs.opacity,
    slor: cs.backdropFilter || cs.webkitBackdropFilter,
  };

  // Chrome serialiserer en color-mix() mot `transparent` som `color(srgb r g b / a)`
  // og en vanlig farge som `rgba(...)`. Vi vil bare ha alfaen, fra begge former.
  function alphaOf(v) {
    const m = /\/\s*([\d.]+)\s*\)/.exec(v) || /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(v);
    return m ? Number(m[1]) : 1;
  }
}, sel);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ===== 5) Slipp ved/utenfor viewportkanten (klemmen aktiv) ===== */
  for (const M of [{ n: 'mobil', vw: 420, vh: 820, mob: true }, { n: 'desktop', vw: 1200, vh: 900, mob: false }]) {
    const p = await b.newPage({ viewport: { width: M.vw, height: M.vh }, hasTouch: true, isMobile: M.mob });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 4], ['B', 4], ['C', 4]]);

    const farX = M.vw + 260;

    /* LISTEPUNKT — klemmen er Smetts `SafeViewport`.

       Grepet tas ved radens VENSTRE kant og pekeren føres til kortets HØYRE
       kant. Den uklemte boksen stikker da langt ut av viewporten (klemmen er
       aktiv), mens PEKEREN fortsatt står inne i kortet — og det er pekerens x
       `dragOverCard` leser. Uten det hadde raden falt ut av lista og draget
       vært i ekstraheringsmodus, som ikke har noen drop-tween å måle. */
    const grip = await p.evaluate(() => {
      // Teksten, ikke hele raden: avmerkingsboksen til venstre er unntatt fra
      // dra-sonen, og et grep der løfter ingenting.
      const t = document.querySelector('.item[data-id="it-B-1"] .item-text');
      const el = t.closest('.item');
      const r = t.getBoundingClientRect();
      const cr = el.closest('.card').getBoundingClientRect();
      return { x: r.left + 10, y: r.top + r.height / 2, edgeX: cr.right - 3 };
    });
    await G.lift(p, { x: grip.x, y: grip.y }, true);
    await G.travel(p, { x: grip.edgeX, y: grip.y }, true, { steps: 6, settle: 140 });
    const clamped = await p.evaluate(() => {
      const r = document.querySelector('#board .item[data-dnd-dragging]').getBoundingClientRect();
      return { right: Math.round(r.right), vw: window.innerWidth, extract: !!document.querySelector('.new-list-placeholder') };
    });
    log('5 ' + M.n + ': listepunktet er klemt innenfor viewporten før slippet',
      clamped.right <= clamped.vw + 2 && !clamped.extract, JSON.stringify(clamped));

    /* Drop-animasjonen er dnd-kits, som for lista under: den flyr fra der
       objektet FAKTISK ble malt (klemt) til hvileplassen, og påstanden er at
       ingenting av dra-malingen blir liggende igjen. Selve tweenen er
       bibliotekets og kan ikke leses av ved `pointerup`. */
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
    log('5 ' + M.n + ': slippet lot ingen dra-maling bli igjen på listepunktet',
      (await p.evaluate(() => {
        const el = document.querySelector('.item[data-id="it-B-1"]');
        return !!el && !el.style.rotate && getComputedStyle(el).position === 'static';
      })) === true);
    await p.waitForTimeout(300);

    /* LISTE — dnd-kit: klemmen er Smetts `SafeViewport`, drop-animasjonen
       bibliotekets. Samme påstand, målt der den nå gjelder. Kortet kan dras helt
       ut av board-et uten å skifte modus (det finnes ingen ekstrahering på
       kortnivå), så her holder det å føre pekeren langt utenfor kanten.
       `travel` går i to omganger med en pause imellom: klemmen leser den FAKTISK
       MALTE boksen, og rotasjonen settes av oss etter at dnd-kit har regnet ut
       flyttingen — ett enkelt hopp ville derfor klemt mot forrige frames boks. */
    const ch = await centerOf(p, '.card[data-id="card-B"] .card-head');
    await G.lift(p, { x: ch.x, y: ch.y }, true);
    await G.travel(p, { x: farX, y: ch.y }, true);
    const cClamped = await p.evaluate(() => {
      const r = document.querySelector('#board [data-dnd-dragging]').getBoundingClientRect();
      return { right: Math.round(r.right), vw: window.innerWidth };
    });
    log('5 ' + M.n + ': lista er klemt innenfor viewporten før slippet',
      cClamped.right <= cClamped.vw + 2, JSON.stringify(cClamped));
    await G.drop(p, undefined, true);
    // Vent på TILSTANDEN: dnd-kit bærer `[data-dnd-dragging]` gjennom hele
    // drop-animasjonen, så et fast tall ville målt midt i den.
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
    log('5 ' + M.n + ': slippet lot ingen dra-maling bli igjen på lista',
      (await p.evaluate(() => {
        const el = document.querySelector('.card[data-id="card-B"]');
        return !!el && !el.style.rotate && getComputedStyle(el).position === 'static';
      })) === true);

    log('5 ' + M.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 6) Startskala per objekttype ===== */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 6], ['B', 6]]);

    // LISTE → 1.02, malt av dnd-kit (kortnivået kjører på det nå), så skalaen
    // og rotasjonen måles på det som faktisk står malt under draget.
    const ch = await centerOf(p, '.card[data-id="card-A"] .card-head');
    await G.lift(p, { x: ch.x, y: ch.y }, true);
    await G.touchMove(p, ch.x - 40, ch.y + 30); await p.waitForTimeout(120);
    const cPaint = await paintOf(p, '#board [data-dnd-dragging]');
    log('6 liste: løftes med skala 1.02', !!cPaint && cPaint.scale === '1.02', JSON.stringify(cPaint));
    // INGENTING ROTERES: `rotate` skal aldri stå på det som males. Vinkelen ble
    // fjernet fordi et rotert lag gjør teksten i det som dras uklar.
    log('6 liste: males UTEN rotasjon',
      !!cPaint && cPaint.rotate === '', JSON.stringify(cPaint));
    log('6 liste: løftes i top layer (dnd-kits `position: fixed`)',
      !!cPaint && cPaint.position === 'fixed', JSON.stringify(cPaint));
    log('6 liste: flaten er halvgjennomsiktig med bakgrunnsslør, teksten i full styrke',
      !!cPaint && cPaint.alfa > 0.3 && cPaint.alfa < 0.9 &&
      cPaint.opacity === '1' && /blur\(2px\)/.test(cPaint.slor), JSON.stringify(cPaint));
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });

    // LISTEPUNKT → 1.03
    const it = await centerOf(p, '.item[data-id="it-A-2"]');
    await G.lift(p, { x: it.x, y: it.y }, true);
    await G.touchMove(p, it.x, it.y + 40); await p.waitForTimeout(120);
    const iPaint = await paintOf(p, '#board .item[data-dnd-dragging]');
    log('6 listepunkt: løftes med skala 1.03', !!iPaint && iPaint.scale === '1.03', JSON.stringify(iPaint));
    log('6 listepunkt: løftes i top layer (dnd-kits `position: fixed`)',
      !!iPaint && iPaint.position === 'fixed', JSON.stringify(iPaint));
    log('6 listepunkt: flaten er halvgjennomsiktig med bakgrunnsslør, teksten i full styrke',
      !!iPaint && iPaint.alfa > 0.3 && iPaint.alfa < 0.9 &&
      iPaint.opacity === '1' && /blur\(2px\)/.test(iPaint.slor), JSON.stringify(iPaint));
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
    await p.waitForTimeout(300);

    // KATEGORI → samme skala som et listepunkt (den ER en rad), og en KOMPAKT
    // rad-form: hylla er foldet sammen ved løft, så gap, polstring, radius og
    // klipping må matche et listepunkt. Uten det leser det løftede objektet som
    // en beholder med luft i.
    await p.evaluate(() => {
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      const c = g.cards.find((x) => x.id === 'card-A');
      const mk = () => ({ ts: 0, org: 't', posTs: 0, posOrg: 't' });
      c.items.push(Object.assign({ id: 'cat-A', text: 'Kategori', home: 'card-A', cat: null, isCat: true, trashed: false, done: false, collapsed: false, pos: 9 }, mk()));
      for (let i = 0; i < 3; i++) {
        c.items.push(Object.assign({ id: 'catm-' + i, text: 'M' + i, home: 'card-A', cat: 'cat-A', isCat: false, trashed: false, done: false, pos: i }, mk()));
      }
      H.render();
    });
    await p.waitForTimeout(300);
    const kh = await centerOf(p, '.category[data-id="cat-A"] .cat-head');
    await G.lift(p, { x: kh.x, y: kh.y }, true);
    await G.touchMove(p, kh.x, kh.y + 40); await p.waitForTimeout(120);
    const kPaint = await paintOf(p, '#board .category[data-dnd-dragging]');
    log('6 kategori: løftes med skala 1.03 (den er en rad)',
      !!kPaint && kPaint.scale === '1.03', JSON.stringify(kPaint));
    log('6 kategori: males kompakt som en rad (gap 0, polstring 6px, radius 10px, klippet)',
      !!kPaint && kPaint.gap === '0px' && kPaint.padding === '6px' &&
      kPaint.radius === '10px' && kPaint.overflow === 'hidden', JSON.stringify(kPaint));
    log('6 kategori: flaten er halvgjennomsiktig med bakgrunnsslør, teksten i full styrke',
      !!kPaint && kPaint.alfa > 0.3 && kPaint.alfa < 0.9 &&
      kPaint.opacity === '1' && /blur\(2px\)/.test(kPaint.slor), JSON.stringify(kPaint));
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
    await p.waitForTimeout(300);

    // MAPPE (rad i et område-kort) → samme skala som et listepunkt (1.03)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(200);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    const uSel = '#nav-board .card[data-id="' + await p.evaluate(() => window.__huskis.state.activeUniverse) + '"]';
    const gIds = await p.evaluate((sel) => [...document.querySelectorAll(sel + ' .items-container > .item')].map((g) => g.dataset.id), uSel);
    const g0 = await centerOf(p, uSel + ' .item[data-id="' + gIds[0] + '"]');
    await G.lift(p, { x: g0.x, y: g0.y }, true);
    await G.touchMove(p, g0.x - 90, g0.y + 30); await p.waitForTimeout(120);
    const gPaint = await paintOf(p, '#nav-board [data-dnd-dragging]');
    log('6 mappe: løftes med skala 1.03',
      !!gPaint && gPaint.scale === '1.03', JSON.stringify(gPaint));
    /* … men UTEN rotasjon. Nav-modalen har alltid én kolonne, og et drag som er
       låst til den loddrette aksen står stille i x — en vinkel som fulgte den
       ville svingt av en intensjon ingen ser (`dnd-vertical-axis`). Bevegelsen
       over går 90 px til venstre nettopp for at en rotasjon SKULLE slått ut. */
    log('6 mappe: males UTEN rotasjon (draget er låst til én akse)',
      !!gPaint && gPaint.rotate === '', JSON.stringify(gPaint));
    log('6 mappe: flaten er halvgjennomsiktig med bakgrunnsslør, teksten i full styrke',
      !!gPaint && gPaint.alfa > 0.3 && gPaint.alfa < 0.9 &&
      gPaint.opacity === '1' && /blur\(2px\)/.test(gPaint.slor), JSON.stringify(gPaint));
    await G.drop(p, undefined, true);
    await p.waitForTimeout(600);
    log('6 mappe: dra-malingen er ryddet etter slippet',
      (await p.evaluate(() => {
        const el = document.querySelector('#nav-board .items-container > .item');
        return !!el && !el.style.rotate && !el.hasAttribute('data-dnd-dragging');
      })) === true);

    // OMRÅDE (kort) → samme skala som en liste (1.02)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(200);
      await p.keyboard.press('Escape'); await p.waitForTimeout(180);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    await p.evaluate(() => { document.querySelector('#nav-modal .menu-body').scrollTop = 0; });
    await p.waitForTimeout(150);
    const uIds = await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')].map((u) => u.dataset.id));
    const u0 = await centerOf(p, '#nav-board .card[data-id="' + uIds[0] + '"] .card-head');
    await G.lift(p, { x: u0.x, y: u0.y }, true);
    await G.touchMove(p, u0.x - 90, u0.y + 30); await p.waitForTimeout(120);
    const uPaint = await paintOf(p, '#nav-board [data-dnd-dragging]');
    log('6 område: løftes med skala 1.02',
      !!uPaint && uPaint.scale === '1.02', JSON.stringify(uPaint));
    log('6 område: løftes i top layer (dnd-kits `position: fixed`)',
      !!uPaint && uPaint.position === 'fixed', JSON.stringify(uPaint));
    log('6 område: males UTEN rotasjon (draget er låst til én akse)',
      !!uPaint && uPaint.rotate === '', JSON.stringify(uPaint));
    log('6 område: flaten er halvgjennomsiktig med bakgrunnsslør, teksten i full styrke',
      !!uPaint && uPaint.alfa > 0.3 && uPaint.alfa < 0.9 &&
      uPaint.opacity === '1' && /blur\(2px\)/.test(uPaint.slor), JSON.stringify(uPaint));
    await G.drop(p, undefined, true);
    await p.waitForTimeout(600);

    log('6 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 6 notat) HELE den malte flaten slipper lys gjennom =====

     Notatkortet er tre flater oppå hverandre — kortfargen, korthodets eget hakk
     og platen utdraget står på — og hodet + platen dekker nesten hele kortet.
     Slipper bare den ytterste gjennom, er løftet i praksis ugjennomsiktig og
     man ser ikke hvor slippet lander. Begge drakter måles: uten regelen er
     HODET ugjennomsiktig i lys drakt og PLATEN i mørk (`--plate` er hvitt med
     alfa i lys, en solid tone i mørk). Begge viewportene måles fordi
     notatfanen er det ene board-et som også står alene på mobil. */
  for (const M of [{ n: 'desktop', vw: 1200, vh: 900, mob: false },
                   { n: 'mobil', vw: 390, vh: 780, mob: true }]) {
    const p = await b.newPage({ viewport: { width: M.vw, height: M.vh }, hasTouch: true, isMobile: M.mob });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    const nid = await seedNote(p);
    const sel = '#notes-board .note-card[data-dnd-dragging]';

    for (const drakt of ['light', 'dark']) {
      // Eksplisitt valg, ikke systemets (docs/mork-drakt.md).
      await p.evaluate((d) => document.documentElement.setAttribute('data-theme', d), drakt);
      await p.waitForTimeout(180);
      const c = await centerOf(p, '#notes-board .note-card[data-id="' + nid + '"] .note-card-head');
      await G.lift(p, { x: c.x, y: c.y }, true);
      await G.touchMove(p, c.x, c.y + 40); await p.waitForTimeout(120);
      const lag = {
        kort: await paintOf(p, sel),
        hode: await paintOf(p, sel + ' .card-head'),
        plate: await paintOf(p, sel + ' .note-card-excerpt'),
      };
      const gjennom = (x) => !!x && x.alfa > 0.3 && x.alfa < 0.9 && x.opacity === '1';
      log('6 notat ' + M.n + ' ' + drakt + ': kortflaten er halvgjennomsiktig med bakgrunnsslør',
        gjennom(lag.kort) && /blur\(2px\)/.test(lag.kort.slor), JSON.stringify(lag.kort));
      log('6 notat ' + M.n + ' ' + drakt + ': korthodet slipper lys gjennom (ikke via `opacity`)',
        gjennom(lag.hode), JSON.stringify(lag.hode));
      log('6 notat ' + M.n + ' ' + drakt + ': utdragsplaten slipper lys gjennom (ikke via `opacity`)',
        gjennom(lag.plate), JSON.stringify(lag.plate));
      await G.drop(p, undefined, true);
      await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
      await p.waitForTimeout(250);
      // … og i HVILE er lagene tilbake på sin egen farge.
      const hvile = await paintOf(p, '#notes-board .note-card[data-id="' + nid + '"] .card-head');
      log('6 notat ' + M.n + ' ' + drakt + ': hodet er ugjennomsiktig igjen etter slippet',
        !!hvile && hvile.alfa === 1, JSON.stringify(hvile));
    }

    log('6 notat ' + M.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 7) Hvile-regler som må vike for det LØFTEDE objektet ===== */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true, colorScheme: 'dark' });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 4]]);
    // Eksplisitt valg, ikke systemets: testen skal måle den mørke drakten
    // uansett hva runneren har satt (docs/mork-drakt.md).
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await p.waitForTimeout(200);
    log('7 drakten er mørk',
      (await p.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark');

    // (a) Det løftede listepunktet eier sin egen --shadow-lg, også i mørk drakt.
    const restShadow = await p.evaluate(() =>
      getComputedStyle(document.querySelector('.item[data-id="it-A-0"]')).boxShadow);
    const it = await centerOf(p, '.item[data-id="it-A-1"]');
    await G.lift(p, { x: it.x, y: it.y }, true);
    await G.touchMove(p, it.x, it.y + 40); await p.waitForTimeout(120);
    const liftShadow = await p.evaluate(() => {
      const el = document.querySelector('#board .item[data-dnd-dragging]');
      return el ? getComputedStyle(el).boxShadow : '(intet løftet)';
    });
    log('7a mørk drakt: hvilende listepunkt har den svake inset-kanten',
      /inset/.test(restShadow), restShadow);
    log('7a mørk drakt: det LØFTEDE listepunktet har løfte-skyggen, ikke inset-kanten',
      liftShadow !== restShadow && !/inset/.test(liftShadow), liftShadow);
    await G.drop(p, undefined, true);
    await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 4000 });
    await p.waitForTimeout(300);

    // (b) En KLIKK-kollapset kategori: hylle-margen gjelder ikke det løftede
    // objektet. `collapsed: true` seedes direkte — et klikk ville lagret.
    await p.evaluate(() => {
      const H = window.__huskis, st = H.state;
      const g = st.universes.find((u) => u.id === st.activeUniverse).groups.find((x) => x.id === st.activeGroup);
      const c = g.cards.find((x) => x.id === 'card-A');
      const mk = () => ({ ts: 0, org: 't', posTs: 0, posOrg: 't' });
      c.items.push(Object.assign({ id: 'cat-K', text: 'Kollapset', home: 'card-A', cat: null, isCat: true, trashed: false, done: false, collapsed: true, pos: 9 }, mk()));
      c.items.push(Object.assign({ id: 'catm-K', text: 'M', home: 'card-A', cat: 'cat-K', isCat: false, trashed: false, done: false, pos: 0 }, mk()));
      H.render();
    });
    await p.waitForTimeout(300);
    const shelf = '.category[data-id="cat-K"] > .cat-items';
    const restMargin = await p.evaluate((s) => getComputedStyle(document.querySelector(s)).marginTop, shelf);
    const kh = await centerOf(p, '.category[data-id="cat-K"] .cat-head');
    await G.lift(p, { x: kh.x, y: kh.y }, true);
    await G.touchMove(p, kh.x, kh.y - 40); await p.waitForTimeout(120);
    const liftMargin = await p.evaluate(() => {
      const el = document.querySelector('#board .category[data-dnd-dragging] > .cat-items');
      return el ? getComputedStyle(el).marginTop : '(intet løftet)';
    });
    log('7b kollapset kategori i hvile: hylla spiser det ene gapet (-4px)',
      restMargin === '-4px', restMargin);
    log('7b … men den LØFTEDE kategorien gjør ikke det (den har alt gap: 0)',
      liftMargin === '0px', liftMargin);
    await G.drop(p, undefined, true);
    await p.waitForTimeout(400);

    log('7 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
