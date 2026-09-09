/*
  Regresjonstest: SORTERINGEN ER REVERSIBEL I SAMME DRAG.

  Det løftede objektet krymper til hodet sitt (`dndCompactLift`), mens målet
  står i full høyde. Smetts egen terskel måler overlappet langs sorteringsaksen
  mot MÅLETS utstrekning, så det HØYESTE oppnåelige forholdet blir
  `kompaktHøyde / målHøyde`. For et notatkort med utdrag er det ~0,23 — over
  `swapRatio` (0,2), men under `reverseRatio` (0,5). Bytte den ene veien gikk;
  bytte TILBAKE i samme drag var umulig, og hvilken vei som virket avhang av
  hvor høyt det andre kortet var. MÅLT før fiksen: 0,197 ned, 0,232 opp.

  Dekker:
    1. To notater med bevisst svært ulik kompakt form (tittel OG utdrag).
    2. Løft det SMALE/LAVE: A→B→A i ett sammenhengende drag.
    3. Løft det BREDE/HØYE: samme, motsatt vei.
    4. REVERSERINGSLÅSEN, i to ledd som svarer på hver sin fare.
       a) HUKOMMELSEN, målt i et ekte drag (`dndSortProbe`): kjennes naboen
          igjen som reversering etter byttet? 104 ms-regresjonen var nettopp
          at kolonne-mål overskrev hukommelsen, så `reversing` sto usant og
          låsen forsvant stille.
       b) SELVE LÅSEN, med klokken satt i tilstanden (`dndSortAdmits`, den
          samme funksjonen sorteringen kjører). Ekte pekertiming kan ikke
          fremtvinge et avslag på under 300 ms — én CDP-berøring pluss en
          avlesning tar lengre tid enn det på touch — så tiden mates inn i
          stedet. Da kan kravet være eksakt: reversering innenfor vinduet
          AVVISES, utenfor GODTAS når overlappet holder, og en senket
          retur-terskel (uoppnåelig tak) endrer ikke tiden.
    5. Terskelen står: en liten bevegelse bytter fortsatt ingenting.
    6. `pos` etter slippet stemmer med rekkefølgen på skjermen.

  DEN TILSIKTEDE 300 ms-LÅSEN kan ikke leses av DOM-en, og det er verdt å vite
  hvorfor: så lenge låsen holder igjen, godtas INGEN mål — og da faller
  forhåndsvisningen tilbake til utgangspunktet, som er nøyaktig den samme
  rekkefølgen et fullført bytte tilbake ville gitt. De to er derfor umulige å
  skille utenfra. De funksjonelle sjekkene (2 og 3) venter derfor låsen ut der
  returen skal skje, mens sjekk 4 går rett på avgjørelsen.

  Kjøres på desktop og touch. Notatfanen er aldri låst til én akse
  (`sideTargets`), så begge pekertypene måler den samme sorteringen.

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-sort-reversible.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const KORT = 'Kort';
const LANG = 'Et betydelig lengre notat med lang tittel';

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
  await p.waitForFunction(() => window.__huskis && window.__huskis.authUser && window.__huskis.lastMy,
    null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(200);
}

// To notater med bevisst svært ulik form etter kompakt løft.
async function seed(p) {
  await p.evaluate(({ kort, lang }) => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject(); proj.name = 'Fag';
    H.setActiveProject(proj.id); H.setActiveNoteFolder(null);
    const ny = (t, tekst) => {
      const n = H.addNote(); H.closeNoteEditor();
      n.title = t;
      n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: tekst }] }] };
      return n;
    };
    ny(kort, 'Kort.');
    ny(lang, 'Dette notatet har et langt utdrag som går over flere linjer og gjør kortet '
      + 'vesentlig høyere enn det andre, slik at forskjellen i geometri blir tydelig. '
      + 'Enda mer tekst her for å fylle tre linjer.');
    H.save(); H.renderNotes();
  }, { kort: KORT, lang: LANG });
  await p.waitForTimeout(500);
}

// Titlene i den rekkefølgen de STÅR på skjermen (plassholderen talt som seg selv).
const rekke = (p) => p.evaluate(() =>
  [...document.querySelectorAll('#notes-board .note-card')]
    .filter((e) => !e.hasAttribute('data-dnd-dragging'))
    .map((e) => e.querySelector('.note-card-title').textContent));
// … og etter slippet: rekkefølgen `pos` faktisk gir.
const posRekke = (p) => p.evaluate(() => window.__huskis.state.notes
  .slice().sort((a, b) => (a.pos || 0) - (b.pos || 0)).map((n) => n.title));

/* Ett sammenhengende drag: løft, gå forbi den andre, og tilbake igjen — uten å
   slippe. `hvil` er ventetiden før returen, så en TILSIKTET 300 ms
   reverseringslås kan skilles fra en varig, asymmetrisk feil. */
// Forrige drag skal være HELT ryddet før neste løft: `dndReleaseCompact` tar
// `.dnd-compact` av først når dnd-kit har sluppet objektet, og et kort som
// fortsatt er kompakt har en annen boks enn den vi sikter på.
async function iRo(p) {
  await p.waitForFunction(() => !document.querySelector('[data-dnd-dragging], .dnd-compact'),
    null, { timeout: 8000, polling: 100 });
}
async function framOgTilbake(p, tittel, touch, opts) {
  const { retning = 1, hvil = 450 } = opts || {};
  await iRo(p);
  const kort = p.locator('#notes-board .note-card', { hasText: tittel }).first();
  await kort.scrollIntoViewIfNeeded();
  const b = await kort.boundingBox();
  const x = b.x + Math.min(60, b.width / 2);
  const y0 = b.y + 20;
  await G.lift(p, { x, y: y0 }, touch);
  const start = await rekke(p);

  // 16 px av gangen, så byttet skjer der en finger faktisk ville utløst det.
  const STEG = 16, N = 14;
  const gå = async (fra, til) => {
    const d = fra < til ? 1 : -1;
    for (let i = fra; d > 0 ? i <= til : i >= til; i += d) {
      await G.travel(p, { x, y: y0 + retning * i * STEG }, touch, { steps: 1, settle: 40 });
    }
  };
  await gå(1, N);
  const etterBytte = await rekke(p);
  // Vent låsen ut FØR returen: de 300 ms er en tilsiktet forsinkelse, og en
  // test som ikke lot dem løpe ut ville lest forsinkelsen som feilen.
  if (hvil) await p.waitForTimeout(hvil);
  await gå(N - 1, 0);
  await p.waitForTimeout(250);
  const etterRetur = await rekke(p);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(600);
  return { start, etterBytte, etterRetur, etterSlipp: await rekke(p), pos: await posRekke(p) };
}

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

  /* ---------- 1) Formene er faktisk tydelig forskjellige ---------- */
  const former = await p.evaluate((t) => {
    const kort = [...document.querySelectorAll('#notes-board .note-card')];
    const a = kort.find((e) => e.querySelector('.note-card-title').textContent === t);
    const b = kort.find((e) => e !== a);
    return { lav: Math.round(a.getBoundingClientRect().height),
      høy: Math.round(b.getBoundingClientRect().height) };
  }, KORT);
  log(label + ' 1: de to notatene har tydelig ulik høyde',
    former.høy > former.lav * 1.6, JSON.stringify(former));

  /* ---------- 2) Løft det LAVE (står først): ned forbi det høye, og tilbake ---------- */
  const lavt = await framOgTilbake(p, KORT, touch, { retning: 1 });
  log(label + ' 2: det lave notatet bytter plass forbi det høye',
    lavt.etterBytte[0] === LANG, JSON.stringify(lavt.etterBytte));
  log(label + ' 2: … og bytter TILBAKE i det samme draget',
    lavt.etterRetur[0] === KORT, JSON.stringify(lavt.etterRetur));
  log(label + ' 2: … og `pos` etter slippet stemmer med skjermen',
    lavt.pos.join('|') === lavt.etterSlipp.join('|') && lavt.pos[0] === KORT,
    JSON.stringify({ skjerm: lavt.etterSlipp, pos: lavt.pos }));

  /* ---------- 3) Løft det HØYE (står sist): opp forbi det lave, og tilbake ---------- */
  const høyt = await framOgTilbake(p, LANG, touch, { retning: -1 });
  log(label + ' 3: det høye notatet bytter plass forbi det lave',
    høyt.etterBytte[0] === LANG, JSON.stringify(høyt.etterBytte));
  log(label + ' 3: … og bytter TILBAKE i det samme draget',
    høyt.etterRetur[0] === KORT, JSON.stringify(høyt.etterRetur));
  log(label + ' 3: … og `pos` etter slippet stemmer med skjermen',
    høyt.pos.join('|') === høyt.etterSlipp.join('|') && høyt.pos[0] === KORT,
    JSON.stringify({ skjerm: høyt.etterSlipp, pos: høyt.pos }));

  /* ---------- 4) REVERSERINGSLÅSEN, lest direkte ----------
     Hysteresen er Huskis' egen nå (`dndSwapMemo`), ikke Smetts plugin, så den
     må voktes for seg. Den kan ikke leses av DOM-en — mens låsen holder igjen
     godtas ingen mål, og forhåndsvisningen faller da tilbake til
     utgangspunktet, som er nøyaktig den samme rekkefølgen et fullført bytte
     tilbake ville gitt. Testen leser derfor tilstanden (`dndSortProbe`).
     Uten dette leddet ville 104 ms-regresjonen — der kolonne-mål overskrev
     hukommelsen, så låsen forsvant stille — vært grønn. */
  const lås = await (async () => {
    await iRo(p);
    const kort = p.locator('#notes-board .note-card', { hasText: KORT }).first();
    const naboId = await p.locator('#notes-board .note-card', { hasText: LANG })
      .first().getAttribute('data-id');
    const b = await kort.boundingBox();
    const x = b.x + Math.min(60, b.width / 2), y0 = b.y + 20;
    await G.lift(p, { x, y: y0 }, touch);
    for (let i = 1; i <= 14; i++) {
      await G.travel(p, { x, y: y0 + i * 16 }, touch, { steps: 1, settle: 40 });
    }
    const byttet = await rekke(p);
    /* ETT raskt steg tilbake, uten ventetid: låsen er 300 ms, og en vanlig
       `travel` (som sender mange punkter med opphold) ville brukt dem opp før
       vi rakk å lese. */
    const tilbake = y0 + 7 * 16;
    if (touch) await G.touchMove(p, x, tilbake);
    else await p.mouse.move(x, tilbake, { steps: 2 });
    const iLåsen = await p.evaluate((id) => window.__huskis.dndSortProbe(id), naboId);
    /* Samme sted, bare senere: pekeren står HELT stille, så geometrien er
       identisk og `dragover` ikke fyrer på nytt. Én bevegelse til ville
       nullstilt hukommelsen om målet skiftet, og da måler vi tiden fra feil
       øyeblikk (målt: 101 ms i stedet for 420). */
    await p.waitForTimeout(420);
    const etterLåsen = await p.evaluate((id) => window.__huskis.dndSortProbe(id), naboId);
    // Tilbake til utgangspunktet før slippet, så neste sjekk starter i ro.
    await G.travel(p, { x, y: y0 }, touch);
    await G.drop(p, undefined, touch);
    await p.waitForTimeout(500);
    return { byttet, iLåsen, etterLåsen };
  })();
  log(label + ' 4a: naboen kjennes igjen som REVERSERING etter byttet',
    !!lås.iLåsen && lås.iLåsen.reversing === true, JSON.stringify(lås.iLåsen));
  log(label + ' 4a: … og hukommelsen holder mens pekeren står stille',
    !!lås.etterLåsen && lås.etterLåsen.reversing === true
    && lås.etterLåsen.sinceSwapMs > lås.iLåsen.sinceSwapMs,
    JSON.stringify({ i: lås.iLåsen && lås.iLåsen.sinceSwapMs,
      etter: lås.etterLåsen && lås.etterLåsen.sinceSwapMs }));
  /* DEN EKTE GEOMETRIEN, MED KLOKKEN SATT. Samme tilstand som ble målt i
     draget over, bare med tiden byttet ut: så lenge vi er innenfor vinduet
     skal returen avvises uansett hvor godt overlappet er. Uten låsen ville
     dette svaret vært sant. */
  const settTid = async (t, ms) => p.evaluate(
    ([s, n]) => window.__huskis.dndSortAdmits(Object.assign({}, s, { sinceSwapMs: n })),
    [t, ms]);
  const ekteIVinduet = lås.iLåsen
    ? await settTid(Object.assign({}, lås.iLåsen, { ratio: 1, crossRatio: 1 }),
      lås.iLåsen.lockMs - 1)
    : null;
  log(label + ' 4b: ekte geometri + FULLT overlapp INNENFOR vinduet avvises',
    ekteIVinduet === false, JSON.stringify({ lockMs: lås.iLåsen && lås.iLåsen.lockMs,
      admits: ekteIVinduet }));

  /* SELVE LÅSEN, punkt for punkt. `dndSortAdmits` er den samme funksjonen
     `dndSortCollision` kjører, og den er ren: tilstanden inn, svaret ut. Da
     kan tiden settes eksakt, og kravet blir deterministisk på begge
     pekertypene — det var nettopp det ekte touch-timing ikke klarte. */
  const admit = (t) => p.evaluate((s) => window.__huskis.dndSortAdmits(s), t);
  const grunn = { crossRatio: 1, maks: 1 };
  const saker = [
    ['reversering med rikelig overlapp AVVISES innenfor 300 ms',
      { ratio: 0.9, reversing: true, sinceSwapMs: 299 }, false],
    ['reversering på grensen (299,9 ms) avvises fortsatt',
      { ratio: 1, reversing: true, sinceSwapMs: 299.9 }, false],
    ['reversering GODTAS etter 300 ms når overlappet er over 0,5',
      { ratio: 0.51, reversing: true, sinceSwapMs: 301 }, true],
    ['… men ikke med for lite overlapp, selv lenge etterpå',
      { ratio: 0.49, reversing: true, sinceSwapMs: 5000 }, false],
    ['et FØRSTE bytte trenger bare 0,2, og venter ikke',
      { ratio: 0.21, reversing: false, sinceSwapMs: 0 }, true],
    ['… men ikke under 0,2',
      { ratio: 0.19, reversing: false, sinceSwapMs: 0 }, false],
    /* UOPPNÅELIG TAK: retur-terskelen senkes til `maks * 0,9`, men TIDEN
       røres ikke. Uten det siste leddet ville den senkede terskelen ha
       åpnet for en øyeblikkelig retur. */
    ['uoppnåelig tak senker retur-terskelen …',
      { ratio: 0.22, reversing: true, sinceSwapMs: 301, maks: 0.234 }, true],
    ['… men ikke tidslåsen',
      { ratio: 0.22, reversing: true, sinceSwapMs: 299, maks: 0.234 }, false],
  ];
  for (const [navn, tilstand, vent] of saker) {
    const svar = await admit(Object.assign({}, grunn, tilstand));
    log(label + ' 4b: ' + navn, svar === vent,
      JSON.stringify({ inn: tilstand, fikk: svar, ventet: vent }));
  }

  /* ---------- 5) Terskelen står: en liten bevegelse bytter ingenting ---------- */
  const smått = await p.evaluate(() => null).then(async () => {
    await iRo(p);
    // Utgangspunktet leses AV SKJERMEN, ikke antatt: de foregående sjekkene
    // slipper der de slipper, og påstanden her er «ingenting endret seg».
    const før = await rekke(p);
    const kort = p.locator('#notes-board .note-card', { hasText: KORT }).first();
    await kort.scrollIntoViewIfNeeded();
    const b = await kort.boundingBox();
    const x = b.x + Math.min(60, b.width / 2), y0 = b.y + 20;
    await G.lift(p, { x, y: y0 }, touch);
    await G.travel(p, { x, y: y0 + 10 }, touch, { steps: 2, settle: 120 });
    const under = await rekke(p);
    await G.drop(p, undefined, touch);
    await p.waitForTimeout(500);
    return { før, under, etter: await posRekke(p) };
  });
  log(label + ' 5: en liten bevegelse bytter fortsatt ingenting',
    smått.under.join('|') === smått.før.join('|')
    && smått.etter.join('|') === smått.før.join('|'), JSON.stringify(smått));

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('touch', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
