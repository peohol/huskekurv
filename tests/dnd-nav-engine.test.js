/*
  Regresjonstest: NAV-MODALEN KJØRER PÅ dnd-kit (gjennom Smett).

  Områder, mapper og mappekategorier dras ikke lenger av motoren i app.js, men
  av dnd-kit — mens hovedsidens board fortsatt kjører den gamle. De to
  MOTORENE er byttet; POLITIKKEN skal være den samme. Denne fila dekker det som
  bare kan gå galt fordi motoren er en annen; hva et slipp betyr (flytting
  mellom områder, søppelkassen, ekstrahering, låste mål) er dekket av
  `nav-modal`, `dnd-trash` og `group-move`.

  Dekker:
    1. Nav-modalen har dnd-kits kroker: det løftede objektet får
       `[data-dnd-dragging]`, og klonen som holder plassen
       `[data-dnd-placeholder]` — som gir fra seg id-en, siden Smett tar
       identiteten fra det løftede objektet.
    2. Klonen er ikke en NABO. Den ligger rett etter det løftede objektet og
       bærer de samme klassene, så en `pos` regnet mot den ville alltid blitt
       «sist i lista» uansett hvor man slapp. En mappe sluppet MIDT i lista skal
       få en pos mellom naboenes — både på radnivå og kortnivå.
    3. Klikket etter draget undertrykkes — også når slippet endte på en ANNEN
       rad enn den man tok tak i. En mapperad navigerer ved klikk, så uten dette
       ville et fullført drag lukket modalen og båret brukeren av gårde.
    4. En LÅST mappe kan ikke løftes (`data-dnd-ignore` på raden), og
       menyknappen løfter aldri noe.
    5. Kategoriens hylle og ＋-knappen i den løfter ikke kategorien — bare
       overskriften gjør det.
    6. Opplesningen under draget er NORSK: dnd-kits live-område får setningene
       sine fra ordboken (`dnd.a11y*`), ikke fra bibliotekets egne engelske.
    7. En LÅST mappe kan ikke løftes (`data-dnd-ignore` på raden).
    8. Peek-åpningen virker på den nye motoren også: blir man værende over et
       KOLLAPSET område, folder det seg midlertidig ut, og et slipp der lander i
       det — og lar det stå åpent.
    9. Et ANDRE drag virker rett etter det første. Slippet rendrer modalen på
       nytt mens dnd-kit ennå avslutter draget, og da lar bibliotekets egen
       DOM-overvåking ombyggingen passere: uten en `sync()` etterpå står
       registeret igjen med de gamle kortene, og neste løft finner ingenting.
   10. Det slupne OMRÅDET holdes i sikte. Draget kollapser alle kortene og
       slippet folder dem ut igjen, så et kort som lander under noen høye kort
       havner under folden — og modalen ruller sin EGEN kropp, ikke vinduet.
   11. Grepet holder gjennom løftet. Kollapsen er bare den ene halvdelen:
       område-kassen dukker opp i modalens fot og gjør modalen høyere, og en
       sentrert modal flytter da innholdet oppover under fingeren.

  Kjør:
    python3 -m http.server 8000                         # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-nav-engine.test.js
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

/* Objektene opprettes gjennom UI-et, ikke ved å skrive i `state`: rekkefølgen
   på områder er PERSONLIG (`memberships.pos`), og en rad som aldri har vært på
   serveren får ingen personlig posisjon å skrive til. Escape avbryter
   navneredigereren som ＋-knappen åpner; objektet blir stående. */
async function addUniverses(p, n) {
  for (let i = 0; i < n; i++) {
    await p.evaluate(() => window.__huskis.addUniverse());
    await p.waitForTimeout(220);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(180);
  }
}
async function addGroups(p, n) {
  for (let i = 0; i < n; i++) {
    await p.evaluate(() => window.__huskis.addGroup());
    await p.waitForTimeout(220);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(180);
  }
}
const openNav = async (p) => {
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(400);
};
/* Escape lukker ØVERSTE lag. Et musetrykk på en knapp gir et klikk og åpner
   objektmenyen; en avbrutt berøring gir ingen — og et Escape ville da lukket
   nav-modalen i stedet. Lukk derfor bare menyen, og bare når den faktisk står
   åpen. */
const closeMenuIfOpen = async (p) => {
  const open = await p.evaluate(() => {
    const m = document.getElementById('obj-menu');
    return !!m && !m.hidden;
  });
  if (!open) return;
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
};
const closeNav = async (p) => {
  await p.evaluate(() => window.__huskis.closeNavModal());
  await p.waitForTimeout(250);
};

/* MODALEN HAR LANDET etter et OMRÅDE-slipp.
   To ting skjer etter slippet, i rekkefølge: dnd-kits klone forsvinner når
   drop-animasjonen er ferdig, og DA ruller nav-modalen det slupne kortet i
   sikte (`navScrollAfterDrop`) — mykt. Et punkt målt mens den rullingen pågår
   er utdatert i det fingeren lander, og de to sjekkene som gjør ETT forsøk
   (9: «lar det seg løfte i det hele tatt», 7: «her skal INGENTING løftes»)
   ville da måle noe annet enn det de påstår. MÅLT: modalkroppen sto på
   scrollTop 8 etter slippet i 2b på mobil.

   Klokka duger ikke som bevis: hvor lang tid en drop-animasjon og en myk
   scroll bruker er nettleserens sak, ikke vår, og en treg CI-runner bruker
   lengre tid enn en lokal maskin — nettopp forskjellen som gjorde 9 rød i CI
   og grønn lokalt, og som en firedobbelt struping av CPU-en gjør om til at 10
   måler for tidlig. Vi venter derfor på TILSTANDEN, i samme rekkefølge: først
   at klonen er borte, så at scrollen har stått stille.

   Vinduet på 500 ms er ikke en gjetning på hvor lenge scrollen tar, men på at
   den har rukket å BEGYNNE: den starter et par frames etter at klonen forsvant,
   og uten vinduet ville «står stille» kunne bety «har ikke startet ennå». */
async function modalenHarLandet(p) {
  await p.waitForFunction(
    () => !document.querySelector('#nav-board [data-dnd-dragging], #nav-board [data-dnd-placeholder]'),
    null, { timeout: 10000, polling: 100 });
  const start = Date.now();
  let forrige = null, like = 0;
  for (let i = 0; i < 80; i++) {
    const nå = await p.evaluate(() => {
      const b = document.getElementById('nav-modal-body');
      return b ? Math.round(b.scrollTop) : 0;
    });
    like = nå === forrige ? like + 1 : 0;
    forrige = nå;
    if (like >= 3 && Date.now() - start >= 500) return;
    await p.waitForTimeout(80);
  }
}

const groupRows = (p) => p.evaluate(() => [...document.querySelectorAll(
  '#nav-board .card .items-container > .item')].map((e) => e.dataset.id));
const uniCards = (p) => p.evaluate(() => [...document.querySelectorAll(
  '#nav-board .board-col > .card')].map((e) => e.dataset.id).filter(Boolean));
const posOf = (p, id) => p.evaluate((x) => {
  const o = window.__huskis.state.universes.find((u) => u.id === x) ||
    window.__huskis.state.universes.flatMap((u) => u.groups).find((g) => g.id === x);
  return o ? o.pos : null;
}, id);

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const touch = mobile;

  await register(p);
  await addUniverses(p, 1);
  await addGroups(p, 3);
  await openNav(p);

  /* ---------- 11) Grepet holder gjennom løftet ----------
     Løftet gjør to ting med layouten samtidig: alle områdekortene kollapser, OG
     område-kassen dukker opp i modalens egen fot. Kassen gjør hele modalen
     høyere, og en loddrett sentrert modal flytter da innholdet oppover — kortet
     hoppet 37 px opp under fingeren i det draget startet. `navHoldGrab` måler
     skiftet etter BEGGE deler og legger det tilbake som padding.

     Avstanden fra pekeren til kortets øvre kant måles før løftet og under
     draget: er de like, ligger kortet fortsatt der man tok tak i det.

     Kjøres FØRST, mens modalen fortsatt er kortere enn sin maks-høyde: det er
     bare da den er loddrett sentrert og kan re-sentrere. En full modal ruller
     kroppen i stedet, og skiftet finnes ikke. */
  const grepId = (await uniCards(p))[0];
  const grepSel = '#nav-board .card[data-id="' + grepId + '"]';
  const grepAt = await G.centre(p, grepSel + ' .card-head');
  const grepFør = await p.evaluate((s2) =>
    document.querySelector(s2).getBoundingClientRect().top, grepSel);
  const grepLøft = await G.lift(p, grepAt, touch);
  // Én bevegelse til etter løftet, NEDOVER: et musedrag aktiveres av
  // terskelbevegelsen, og den flyttingen er ikke malt ennå idet draget starter.
  const grepTil = { x: grepLøft.x, y: grepLøft.y + 40 };
  if (touch) await G.touchMove(p, grepTil.x, grepTil.y);
  else await p.mouse.move(grepTil.x, grepTil.y, { steps: 3 });
  await p.waitForTimeout(160);
  const grepUnder = await p.evaluate(() =>
    document.querySelector('#nav-board [data-dnd-dragging]').getBoundingClientRect().top);
  const grep = { før: grepAt.y - grepFør, under: grepTil.y - grepUnder };
  log(label + ' 11: grepet holder gjennom løftet (kollaps + kassen i modalfoten)',
    Math.abs(grep.under - grep.før) <= 2,
    'før=' + grep.før.toFixed(1) + ' under=' + grep.under.toFixed(1));
  if (touch) await G.touchCancel(p); else { await p.keyboard.press('Escape'); await p.mouse.up(); }
  await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging]'), null, { timeout: 5000 });
  await p.waitForTimeout(300);
  // Escape lukker øverste lag: avbruddet over kan ha tatt modalen med seg.
  await p.evaluate(() => {
    if (document.getElementById('nav-modal').hidden) window.__huskis.openNavModal();
  });
  await p.waitForTimeout(400);

  /* ---------- 1) Motorens egne kroker ---------- */
  const rows = await groupRows(p);
  const rowSel = (i) => '#nav-board .item[data-id="' + rows[i] + '"]';
  /* Sikt på SENTERET av sloten mappen skal ende i, målt FØR løftet: klonen
     holder plassen, så geometrien står stille selv om radene bytter plass under
     gesten. Senteret — ikke et punkt FORBI naboen: en rad som bytter plass med
     naboen TAR naboens slot, så et sikte nede ved naboens underkant ligger
     etter byttet i sloten under, og raden fortsetter nedover (se
     tests/dnd-gestures.js, og `swapRatio` i docs/drag-and-drop.md). */
  const target = await G.centre(p, rowSel(1));
  await G.lift(p, await G.centre(p, rowSel(0)), touch);
  const lifted = await p.evaluate(() => {
    const el = document.querySelector('#nav-board [data-dnd-dragging]');
    const ph = document.querySelector('#nav-board [data-dnd-placeholder]');
    return {
      løftet: el && el.dataset.id,
      klone: !!ph,
      kloneEtterLøftet: !!(el && el.nextElementSibling === ph),
      kloneUtenId: !!(ph && !ph.dataset.id),
    };
  });
  log(label + ' 1: det løftede objektet er merket av dnd-kit',
    lifted.løftet === rows[0], JSON.stringify(lifted));
  log(label + ' 1: klonen holder plassen rett etter objektet, og har gitt fra seg id-en',
    lifted.klone === true && lifted.kloneEtterLøftet === true && lifted.kloneUtenId === true,
    JSON.stringify(lifted));

  /* ---------- 2) Klonen er ikke en nabo (rad) ---------- */
  await G.travel(p, target, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);
  const after = await groupRows(p);
  const pos = { a: await posOf(p, rows[0]), b: await posOf(p, rows[1]), c: await posOf(p, rows[2]) };
  log(label + ' 2: mappen havnet mellom de to andre',
    after.indexOf(rows[0]) === 1 && after.indexOf(rows[1]) === 0 &&
    after.indexOf(rows[2]) === 2, after.join(',') + ' (var ' + rows.join(',') + ')');
  log(label + ' 2: … og fikk en pos MELLOM naboenes, ikke bakerst',
    pos.b < pos.a && pos.a < pos.c, JSON.stringify(pos));

  /* ---------- 3) Klikket etter draget ---------- */
  // Slippet endte på en ANNEN rad enn den man tok tak i. Et klikk der ville
  // navigert til den mappen og lukket modalen.
  const navigated = await p.evaluate(() => ({
    lukket: document.getElementById('nav-modal').hidden,
    aktiv: window.__huskis.state.activeGroup,
  }));
  log(label + ' 3: et fullført drag navigerte ikke — modalen står fortsatt åpen',
    navigated.lukket === false, JSON.stringify(navigated));

  /* ---------- 4) Menyknappen løfter aldri noe ---------- */
  // Den ligger midt i dra-sonen på hver eneste rad.
  const menuAt = await G.centre(p, '#nav-board .item[data-id="' + rows[0] + '"] .obj-menu-btn');
  if (touch) {
    await G.touchStart(p, menuAt.x, menuAt.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(menuAt.x, menuAt.y);
    await p.mouse.down();
    await p.mouse.move(menuAt.x, menuAt.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  log(label + ' 4: menyknappen løfter ingenting', (await G.liftedCount(p)) === 0);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(250);
  await closeMenuIfOpen(p);

  /* ---------- 5) Kategoriens hylle løfter ikke kategorien ---------- */
  // Mappekategorien lages med den gule knappen i områdekortet. Den åpner
  // navneredigereren på et TOMT navn, og et avbrutt navn fjerner objektet igjen
  // — så den må navngis.
  await p.locator('#nav-board .card .add-cat-btn').first().click();
  await p.waitForTimeout(300);
  await p.keyboard.type('Prosjekter');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(350);
  const catSel = '#nav-board .category';
  log(label + ' 5: mappekategorien er bygget',
    (await p.locator(catSel).count()) === 1);
  const addAt = await G.centre(p, catSel + ' .cat-add-btn');
  if (touch) {
    await G.touchStart(p, addAt.x, addAt.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(addAt.x, addAt.y);
    await p.mouse.down();
    await p.mouse.move(addAt.x, addAt.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  log(label + ' 5: ＋-knappen i kategorien løfter ikke kategorien',
    (await G.liftedCount(p)) === 0);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(250);
  // Et musetrykk på ＋ oppretter en ny mappe i kategorien og åpner navnefeltet;
  // en avbrutt berøring gjør ingenting. Rydd bare når det faktisk skjedde.
  if (await p.evaluate(() => !!document.querySelector('.edit-input'))) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
  }

  const headAt = await G.centre(p, catSel + ' .cat-head');
  await G.lift(p, headAt, touch);
  log(label + ' 5: … men overskriften gjør det',
    (await p.evaluate(() => {
      const el = document.querySelector('#nav-board [data-dnd-dragging]');
      return !!el && el.classList.contains('category');
    })) === true);

  /* ---------- 6) Opplesningen er norsk ---------- */
  // Live-områdene er små og skjulte; de store `aria-live`-flatene i appen (selve
  // board-et) er ikke det som leses opp under et drag.
  const spoken = await p.evaluate(() => [...document.querySelectorAll('[aria-live="polite"]')]
    .map((e) => (e.textContent || '').trim())
    .filter((t) => t && t.length < 200));
  log(label + ' 6: dnd-kits live-område snakker norsk (fra ordboken)',
    spoken.some((t) => /^Løftet /.test(t)) && !spoken.some((t) => /^Picked up /.test(t)),
    JSON.stringify(spoken.filter((t) => /Løftet|Picked up/.test(t))));
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);

  /* ---------- 2b) Klonen er ikke en nabo (kort) ---------- */
  await closeNav(p);
  await addUniverses(p, 2);   // tre områder til sammen
  await openNav(p);
  const cards = await uniCards(p);
  log(label + ' 2b: tre områdekort å omrokkere', cards.length === 3, cards.join(','));
  const headSel = (i) => '#nav-board .card[data-id="' + cards[i] + '"] .card-head';
  await G.lift(p, await G.centre(p, headSel(0)), touch);
  /* Kortdraget KOLLAPSER alle områdene, så målet måles ETTER løftet — og det er
     SENTERET av den sloten kortet skal ende i, ikke et punkt forbi naboen.
     Et kort som bytter plass med naboen TAR naboens slot, og naboen tar dens:
     sikter man forbi naboen, ligger punktet etter byttet i sloten under, og
     kortet fortsetter nedover. Senteret av målsloten er det ene punktet som
     står stille gjennom byttet. */
  const cardTarget = await G.centre(p, '#nav-board .card[data-id="' + cards[1] + '"]');
  await G.travel(p, cardTarget, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(500);
  const cardsAfter = await uniCards(p);
  const cPos = { a: await posOf(p, cards[0]), b: await posOf(p, cards[1]), c: await posOf(p, cards[2]) };
  log(label + ' 2b: området havnet mellom de to andre',
    cardsAfter.indexOf(cards[0]) === 1 && cardsAfter.indexOf(cards[1]) === 0,
    cardsAfter.join(',') + ' (var ' + cards.join(',') + ')');
  log(label + ' 2b: … og fikk en pos MELLOM naboenes, ikke bakerst',
    cPos.b < cPos.a && cPos.a < cPos.c, JSON.stringify(cPos));
  log(label + ' 2b: områdene er foldet ut igjen etter draget',
    (await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')]
      .filter((c) => c.classList.contains('collapsed')).length)) === 0);
  await modalenHarLandet(p);   // slippet over ruller modalen; 9 måler ETT punkt

  /* ---------- 9) Et ANDRE drag virker rett etter det første ---------- */
  // Draget i 2b rendret nav-modalen på nytt, og de nye kortene er ikke de
  // dnd-kit har i registeret sitt. Ombyggingen skjer mens dnd-kit fortsatt
  // avslutter draget, så bibliotekets egen DOM-overvåking lar den passere — og
  // uten en `sync()` etter rendringen er det ingenting igjen å løfte. Verst på
  // touch, der ingenting annet rakk å rendre imellom: dra ett område på en
  // telefon, og det neste lot seg ikke ta i det hele tatt.
  // Ikke `G.lift` her: den prøver til det lykkes, og hele spørsmålet er om det
  // FØRSTE forsøket finner noe å løfte.
  // Kortet som nå ligger ØVERST: et kort lenger ned kan være under folden, og
  // et punkt der treffer modal-overlayet i stedet for kortet.
  const again = await G.centre(p, '#nav-board .card[data-id="' + cards[1] + '"] .card-title');
  if (touch) {
    await G.touchStart(p, again.x, again.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(again.x, again.y);
    await p.mouse.down();
    await p.mouse.move(again.x, again.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  const lifted9 = await G.liftedCount(p);
  log(label + ' 9: et nytt områdekort kan løftes RETT ETTER at et annet ble sluppet',
    lifted9 === 1, 'løftet: ' + lifted9);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(300);

  /* ---------- 8) Peek-åpning av et kollapset område ---------- */
  // Målet er området som ligger ØVERST etter omrokkeringen i 2b: da er både
  // kilden og målet i visningen samtidig, uten at modalen må scrolle midt i
  // gesten.
  await p.evaluate((uid) => {
    const u = window.__huskis.state.universes.find((x) => x.id === uid);
    u.collapsed = true;
    window.__huskis.render();
  }, cards[1]);
  await p.waitForTimeout(350);
  const peekSel = '#nav-board .card[data-id="' + cards[1] + '"]';
  log(label + ' 8: mål-området er kollapset i utgangspunktet',
    await p.evaluate((s2) => document.querySelector(s2).classList.contains('collapsed'), peekSel));
  const peekRow = '#nav-board .item[data-id="' + rows[1] + '"]';
  await p.evaluate((s2) => document.querySelector(s2).scrollIntoView({ block: 'center' }), peekRow);
  await p.waitForTimeout(200);
  await G.lift(p, await G.centre(p, peekRow), touch);
  // Bli VÆRENDE over det kollapsede kortet: peek-timeren er 200 ms, og
  // `travel` venter godt forbi det i to omganger.
  await G.travel(p, () => G.centre(p, peekSel + ' .card-head'), touch);
  log(label + ' 8: å bli værende over det foldet området midlertidig ut',
    await p.evaluate((s2) => !document.querySelector(s2).classList.contains('collapsed'), peekSel));
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(600);
  const landed = await p.evaluate(({ gid, uid }) => {
    const st = window.__huskis.state;
    const g = st.universes.flatMap((u) => u.groups).find((x) => x.id === gid);
    const u = st.universes.find((x) => x.id === uid);
    return { uni: g && g.uni, collapsed: u && !!u.collapsed };
  }, { gid: rows[1], uid: cards[1] });
  log(label + ' 8: mappen landet i det peek-åpnede området, og det ble stående åpent',
    landed.uni === cards[1] && landed.collapsed === false, JSON.stringify(landed));

  /* ---------- 10) Etter slippet er området I SIKTE ----------
     Draget kollapser alle områdekortene, og slippet folder dem ut igjen. Et kort
     som lander UNDER noen høye kort havner dermed langt under folden i modalens
     rullende kropp — man slipper området, og det forsvinner ut av syne.
     Hovedsiden har alltid holdt den slupne LISTA i sikte; nav-modalen ruller sin
     EGEN kropp, ikke vinduet, og gjorde det ikke.

     Kortene gjøres høye med mapper skrevet rett i `state`: det er geometrien som
     er påstanden her, ikke opprettelsesflyten. */
  await closeNav(p);
  await p.evaluate(() => {
    const H = window.__huskis;
    H.state.universes.forEach((u, ui) => {
      u.collapsed = false;
      for (let i = 0; i < 6; i++) {
        u.groups.push({
          id: 'fyll-' + ui + '-' + i, uni: u.id, name: 'Fyllmappe ' + i,
          trashed: false, cat: null, isCat: false, collapsed: false,
          _type: 'group', _role: 'owner', _createdByMe: true,
          ts: 0, org: 't', pos: 100 + i, posTs: 0, posOrg: 't', cards: [],
        });
      }
    });
    H.render();
  });
  await openNav(p);
  await p.evaluate(() => { document.getElementById('nav-modal-body').scrollTop = 0; });
  await p.waitForTimeout(250);
  const høye = await uniCards(p);
  const slupt = høye[0];
  await G.lift(p, await G.centre(p, '#nav-board .card[data-id="' + slupt + '"] .card-head'), touch);
  // Kortdraget kollapser alle områdene, så målsloten måles ETTER løftet.
  await G.travel(p, () => G.centre(p, '#nav-board .card[data-id="' + høye[høye.length - 1] + '"]'), touch);
  await G.drop(p, undefined, touch);
  await modalenHarLandet(p);
  const sikt = await p.evaluate((id) => {
    const body = document.getElementById('nav-modal-body');
    const el = document.querySelector('#nav-board .card[data-id="' + id + '"]');
    if (!el) return null;
    const b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
    return {
      rullbart: Math.round(body.scrollHeight - body.clientHeight),
      scrollTop: Math.round(body.scrollTop),
      // Hvor kortets topp ligger i forhold til det synlige feltet i modalen.
      overKanten: Math.round(r.top - b.top),
      underKanten: Math.round(r.top - b.bottom),
    };
  }, slupt);
  log(label + ' 10: modalen har noe å rulle (ellers beviser målingen ingenting)',
    !!sikt && sikt.rullbart > 40, JSON.stringify(sikt));
  log(label + ' 10: det slupne området står i sikte i modalkroppen etter slippet',
    !!sikt && sikt.overKanten >= -1 && sikt.underKanten <= 0, JSON.stringify(sikt));

  /* ---------- 7) En LÅST mappe kan ikke løftes ---------- */
  // Låsen settes på OMRÅDET, og gjelder da mappene i det: en eier omgår enhver
  // lås, så både området og mappen må stå som «vanlig medlem» for at låsen skal
  // gjelde for meg (se `privilegedLocal` i app.js).
  const lockedRow = await p.evaluate((gid) => {
    const st = window.__huskis.state;
    const u = st.universes.find((x) => (x.groups || []).some((g) => g.id === gid));
    if (!u) return null;
    u._role = 'member'; u._locked = true;
    u._caps = { editContent: false, createGroup: false, delete: false, leave: true };
    // Låsen settes på mappen SELV også: `frozen()` går oppover og stopper ved
    // nærmeste eksplisitte tilstand, og en lokalt opprettet rad har ikke
    // nødvendigvis fått `_parent` fra serveren ennå.
    u.groups.forEach((g) => {
      g._role = 'member'; g._locked = true; g._caps = { editContent: false };
    });
    window.__huskis.render();
    return gid;
  }, rows[0]);
  await p.waitForTimeout(350);
  const lockSel = '#nav-board .item[data-id="' + lockedRow + '"]';
  log(label + ' 7: den låste mappen er merket som udragbar',
    await p.evaluate((s2) => {
      const el = document.querySelector(s2);
      return !!el && el.hasAttribute('data-dnd-ignore');
    }, lockSel), lockSel);
  // Et ekte forsøk: `G.lift` prøver til det lykkes, så her brukes primitivene
  // og fraværet påstås selv.
  const lockAt = await G.centre(p, lockSel);
  if (touch) {
    await G.touchStart(p, lockAt.x, lockAt.y);
    await p.waitForTimeout(G.HOLD_WAIT);
  } else {
    await p.mouse.move(lockAt.x, lockAt.y);
    await p.mouse.down();
    await p.mouse.move(lockAt.x, lockAt.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(120);
  }
  log(label + ' 7: … og et ekte løft på den starter ingen drag',
    (await G.liftedCount(p)) === 0);
  if (touch) await G.touchCancel(p); else await p.mouse.up();
  await p.waitForTimeout(250);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
