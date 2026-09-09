/*
  Regresjonstest: NÅR ER DRAGET LÅST TIL DEN LODDRETTE AKSEN — og rotasjonen?

  Et vannrett drag har bare mening når det finnes noe vannrett å sikte på: en
  NABOKOLONNE. Låsen (`dndLockAxis` → `drag.oneAxis`) spør derfor det samme
  regnestykket som layouten fordeler kortene etter, og den gjelder ALLE fem
  nivåene:

    • nav-modalen («Områder og mapper») har alltid nøyaktig én kolonne — låst
      uansett skjermbredde;
    • idémodalen likeså (dekket av `ideas-modal.test.js`);
    • hovedsidens board er låst når det FAKTISK står i én kolonne, og fritt når
      kortene er fordelt på flere;
    • notatfanens to scope er ALDRI låst: de har et arkiv OG en søppelkasse side
      om side (`sideTargets`), og da betyr sidelengs noe også i én kolonne.

  INGENTING ROTERES LENGER. Den dynamiske rotasjonen (±5° etter horisontal
  posisjon) er fjernet: et rotert lag rasteriseres og resamples av
  kompositoren, og teksten i det som dras ble merkbart uklar. Filen vokter
  fraværet — også i flerkolonne, der vinkelen slo hardest ut.

  Låsen er en LEDESNOR, ikke en spiker: det løftede objektet er kompakt og
  sentrert på grepet (`dndCompactLift`), og en ren nulling av x slapp fingeren ut
  av objektet så snart den flyttet seg en halv objektbredde sidelengs. Snoren gir
  det samme som før for det låsen er til for — fingerskjelvet flytter ingenting —
  og gir etter først når fingeren ellers ville forlatt objektet.

  Dekker:
    1. Hovedsiden i FLERKOLONNE: objektet følger fingeren sidelengs, og bærer
       rotasjonen. Både liste- og listepunktnivå. (Kontrollen for resten av
       fila: det er den samme koden med låsen av.)
    2. Hovedsiden i ÉN KOLONNE (mobil): en liten sidelengs gest flytter
       INGENTING, en stor lar objektet henge etter uten å slippe fingeren, og
       `rotate` er ikke satt. Både liste og listepunkt.
    3. Regelen følger KOLONNETALLET, ikke skjermbredden eller pekertypen: en
       bred skjerm som likevel bare får plass til én kolonne er låst.
    4. Nav-modalen er låst også på en bred skjerm, der modalen har rikelig
       vannrett rom å bevege seg i. Både område- og mapperad.
    5. Notatenes to scope har `sideTargets` — et arkiv OG en søppelkasse side om
       side — og er derfor ALDRI låst: sidelengs er hele forskjellen på «legg
       bort» og «slett».

  Gestene er EKTE input (`tests/dnd-gestures.js`). Se `docs/drag-and-drop.md`.

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-vertical-axis.test.js
*/
'use strict';
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : ''));
};

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
  // Introduksjonen legger seg over appen og slipper bare gjennom klikkene sine.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

/* Lister med listepunkter i den aktive mappen. Skrives rett i `state`: det er
   geometrien testen handler om, ikke opprettelsesflyten. */
async function seedCards(p, cards) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(180);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(180);
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
        it.pos = i;
        c.items.push(it);
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

/* Notater: én bokhylle med to notater. Notatfanens to scope har `sideTargets` —
   et arkiv OG en søppelkasse side om side — og skal derfor ALDRI være låst. */
async function seedNotes(p) {
  await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject();
    proj.name = 'Fagstoff';
    H.setActiveProject(proj.id);
    H.setActiveNoteFolder(null);
    for (const t of ['Blodprøver', 'Timeplan']) {
      const n = H.addNote();
      H.closeNoteEditor();
      n.title = t;
      n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: t }] }] };
    }
    H.save();
    H.renderNotes();
  });
  await p.waitForTimeout(400);
}

/* Områder og mapper for nav-modalen. De opprettes gjennom UI-et: rekkefølgen på
   områder er PERSONLIG, og en rad som aldri har vært på serveren har ingen
   personlig posisjon å skrive til (samme grunn som i `dnd-nav-engine`). */
async function seedNav(p, universes, groups) {
  for (let i = 0; i < universes; i++) {
    await p.evaluate(() => window.__huskis.addUniverse());
    await p.waitForTimeout(220);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(180);
  }
  for (let i = 0; i < groups; i++) {
    await p.evaluate(() => window.__huskis.addGroup());
    await p.waitForTimeout(220);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(180);
  }
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(400);
}

// Antall FAKTISKE kolonner på hovedsidens board (`relayoutBoard` fordeler dem).
const boardCols = (p) => p.evaluate(() => document.querySelectorAll('#board > .board-col').length);

/* Det løftede objektets SENTER langs x, og rotasjonen det males med.
   Senteret måles, ikke venstrekanten: en rotert boks har en akse-justert `left`
   som vandrer et par piksler, mens senteret står stille gjennom både rotasjonen
   og løfte-skaleringen. */
const dragged = (p, root) => p.evaluate((r) => {
  const el = document.querySelector(r + ' [data-dnd-dragging]');
  if (!el) throw new Error('ingenting er løftet i ' + r);
  const b = el.getBoundingClientRect();
  return { x: Math.round((b.left + b.right) / 2), w: Math.round(b.width),
    l: Math.round(b.left), r: Math.round(b.right), rot: el.style.rotate || '' };
}, root);

async function cancel(p, touch) {
  if (touch) await G.touchCancel(p);
  else { await p.keyboard.press('Escape'); await p.mouse.up(); }
  await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
  await p.waitForTimeout(250);
}

/* Løft objektet, flytt fingeren REN SIDELENGS, og se hva som fulgte med.
   `y` står stille gjennom hele gesten, så en x som flytter seg er den vannrette
   komponenten og ingenting annet. Draget avbrytes til slutt: målingen skal ikke
   etterlate seg et slipp som flytter noe. */
async function sidelengs(p, sel, root, touch, dx) {
  const lifted = await G.lift(p, await G.centre(p, sel), touch);
  const før = await dragged(p, root);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = lifted.x + dx * (i / steps);
    if (touch) await G.touchMove(p, x, lifted.y);
    else await p.mouse.move(x, lifted.y, { steps: 2 });
  }
  await p.waitForTimeout(220);
  const etter = await dragged(p, root);
  await cancel(p, touch);
  return {
    flyttet: etter.x - før.x, rot: etter.rot, spor: før.x + ' → ' + etter.x,
    bredde: etter.w,
    // Slapp objektet fingeren? Ledesnoren i `dndLockAxis` finnes for at svaret
    // alltid skal være nei — se filhodet.
    holder: lifted.x + dx >= etter.l && lifted.x + dx <= etter.r,
  };
}

(async () => {
  const b = await chromium.launch();

  /* ---------- 1) Hovedsiden i FLERKOLONNE: fritt, og med rotasjon ---------- */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seedCards(p, [['A', 4], ['B', 4], ['C', 4], ['D', 4], ['E', 4], ['F', 4]]);
    const cols = await boardCols(p);
    log('1 flerkolonne: board-et står faktisk i flere kolonner', cols >= 2, 'kolonner=' + cols);

    const kort = await sidelengs(p, '#board .card[data-id="card-A"] .card-head', '#board', false, 250);
    log('1 flerkolonne: lista følger fingeren sidelengs',
      kort.flyttet >= 200, kort.spor + ' (Δ ' + Math.round(kort.flyttet) + ')');
    /* INGENTING ROTERES — heller ikke her, der draget faktisk KAN gå sidelengs
       og den gamle dynamiske rotasjonen slo hardest ut. Et rotert lag
       rasteriseres og resamples av kompositoren, og teksten i det som dras ble
       merkbart uklar; vinkelen er derfor fjernet. Den lange gesten er med med
       vilje: den ville gitt fullt utslag før. */
    const lengre = await sidelengs(p, '#board .card[data-id="card-A"] .card-head', '#board', false, 700);
    log('1 flerkolonne: … men INGEN rotasjon, uansett hvor langt ut man drar',
      kort.rot === '' && lengre.rot === '',
      'rotate=' + JSON.stringify(kort.rot) + ' → ' + JSON.stringify(lengre.rot));

    const rad = await sidelengs(p, '#board .card[data-id="card-A"] .item', '#board', false, 250);
    log('1 flerkolonne: listepunktet følger fingeren sidelengs',
      rad.flyttet >= 200, rad.spor + ' (Δ ' + Math.round(rad.flyttet) + ')');
    log('1 flerkolonne: … og males uten rotasjon det òg',
      rad.rot === '', 'rotate=' + JSON.stringify(rad.rot));
    log('1 flerkolonne: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 2) Hovedsiden i ÉN KOLONNE (mobil): låst, uten rotasjon ----------
     Det er den samme koden som over, bare med låsen på: står senteret stille
     mens fingeren går sidelengs, er den vannrette komponenten borte. */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seedCards(p, [['A', 3], ['B', 3], ['C', 3]]);
    const cols = await boardCols(p);
    log('2 mobil: board-et står i ÉN kolonne', cols === 1, 'kolonner=' + cols);

    // En STOR gest: objektet HENGER ETTER (det følger ikke fingeren piksel for
    // piksel, som i flerkolonne over), men slipper den aldri.
    const kort = await sidelengs(p, '#board .card[data-id="card-A"] .card-head', '#board', true, 120);
    log('2 mobil: lista henger etter fingeren i stedet for å følge den',
      Math.abs(kort.flyttet) < 120, kort.spor + ' (Δ ' + Math.round(kort.flyttet) + ')');
    log('2 mobil: … men slipper den aldri (ledesnoren)',
      kort.holder === true, 'bredde=' + kort.bredde + ' Δ ' + Math.round(kort.flyttet));
    log('2 mobil: … og males uten rotasjon', kort.rot === '', 'rotate=' + JSON.stringify(kort.rot));

    /* Fingerskjelvet: en gest godt innenfor snorens slakk skal ikke flytte noe i
       det hele tatt — det er hele grunnen til at låsen finnes. Slakken er halve
       bredden på det LØFTEDE objektet, som er kompakt og dermed avhenger av hvor
       langt navnet er; gesten måles derfor mot bredden vi nettopp så. */
    const skjelv = await sidelengs(p, '#board .card[data-id="card-A"] .card-head', '#board', true,
      Math.max(3, Math.round(kort.bredde / 2) - 14));
    log('2 mobil: en liten sidelengs gest flytter ingenting',
      Math.abs(skjelv.flyttet) <= 1, skjelv.spor + ' (Δ ' + Math.round(skjelv.flyttet) + ')');

    // Kortere utslag på radnivå: en finger utenfor kortets vannrette kant betyr
    // «ekstraher til ny liste», og det er en annen sak enn aksen.
    const rad = await sidelengs(p, '#board .card[data-id="card-A"] .item', '#board', true, 60);
    log('2 mobil: listepunktet henger etter og slipper ikke fingeren',
      Math.abs(rad.flyttet) < 60 && rad.holder === true,
      rad.spor + ' (Δ ' + Math.round(rad.flyttet) + ', bredde=' + rad.bredde + ')');
    log('2 mobil: … og males uten rotasjon', rad.rot === '', 'rotate=' + JSON.stringify(rad.rot));
    log('2 mobil: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 3) Regelen følger KOLONNETALLET ----------
     700 px er ingen mobilskjerm og har ingen berøringsskjerm, men det er for
     smalt til to kolonner — og da er det ingen nabokolonne å sikte på. */
  {
    const p = await b.newPage({ viewport: { width: 700, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seedCards(p, [['A', 3], ['B', 3], ['C', 3]]);
    const cols = await boardCols(p);
    log('3 bred énkolonne: board-et står i ÉN kolonne på 700 px', cols === 1, 'kolonner=' + cols);
    const kort = await sidelengs(p, '#board .card[data-id="card-A"] .card-head', '#board', false, 180);
    log('3 bred énkolonne: lista henger etter fingeren (låsen er ikke en mobilregel)',
      Math.abs(kort.flyttet) < 180 && kort.holder === true,
      kort.spor + ' (Δ ' + Math.round(kort.flyttet) + ', bredde=' + kort.bredde + ')');
    log('3 bred énkolonne: … og males uten rotasjon', kort.rot === '', 'rotate=' + JSON.stringify(kort.rot));
    log('3 bred énkolonne: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 4) Nav-modalen er låst uansett bredde ----------
     Modalen er smalere enn skjermen, så et ulåst drag ville hatt rikelig
     vannrett rom å følge fingeren i — nettopp derfor er dette den strengeste
     målingen i fila. */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seedNav(p, 3, 3);
    /* Escape avbryter draget — og lukker samtidig modalen (den er øverste lag).
       Åpne den igjen før hver måling, så den neste gesten har noe å ta tak i. */
    const åpen = async () => {
      await p.evaluate(() => {
        if (document.getElementById('nav-modal').hidden) window.__huskis.openNavModal();
      });
      await p.waitForTimeout(400);
    };

    const uniId = await p.evaluate(() =>
      document.querySelector('#nav-board .board-col > .card').dataset.id);
    const kort = await sidelengs(p, '#nav-board .card[data-id="' + uniId + '"] .card-head', '#nav-board', false, 250);
    log('4 nav-modalen: området henger etter fingeren, og slipper den aldri',
      Math.abs(kort.flyttet) < 250 && kort.holder === true,
      kort.spor + ' (Δ ' + Math.round(kort.flyttet) + ', bredde=' + kort.bredde + ')');
    log('4 nav-modalen: … og males uten rotasjon', kort.rot === '', 'rotate=' + JSON.stringify(kort.rot));

    await åpen();
    const rad = await sidelengs(p, '#nav-board .card .items-container > .item', '#nav-board', false, 250);
    log('4 nav-modalen: mapperaden henger etter fingeren, og slipper den aldri',
      Math.abs(rad.flyttet) < 250 && rad.holder === true,
      rad.spor + ' (Δ ' + Math.round(rad.flyttet) + ', bredde=' + rad.bredde + ')');
    log('4 nav-modalen: … og males uten rotasjon', rad.rot === '', 'rotate=' + JSON.stringify(rad.rot));
    log('4 nav-modalen: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---------- 5) Notatfanen er ALDRI låst: to slippmål side om side ----------
     Én kolonne på mobil, men arkivet og søppelkassen står ved siden av hverandre
     nederst — og sidelengs er hele forskjellen på «legg bort» og «slett». */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);
    await seedNotes(p);
    const cols = await p.evaluate(() => document.querySelectorAll('#notes-board > .board-col').length);
    log('5 notatfanen står i ÉN kolonne på mobil', cols === 1, 'kolonner=' + cols);
    const notat = await sidelengs(p, '#notes-board .note-card', '#notes-board', true, 120);
    log('5 notatkortet følger fingeren sidelengs likevel',
      notat.flyttet >= 100, notat.spor + ' (Δ ' + Math.round(notat.flyttet) + ')');
    log('5 notatkortet ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
