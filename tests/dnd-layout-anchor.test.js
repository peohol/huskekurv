/*
  Regresjonstest: DRA-ANKERET — layouten flytter seg BORT fra siktet.

  Mens en rad dras, kommer og går kasseraden i kortene: den står i den
  containeren objektet er i NÅ, og forsvinner fra den det forlot. I normal flyt
  absorberes hver slik endring nedover — alt under den flytter seg — og da
  smetter det man sikter på unna fingeren i samme øyeblikk som det ble laget.

  Ankeret holder den nærmeste faste kanten på eller under siktet i ro og lar
  board-et gjøre jobben OVER den: `padding-top` skyver innholdet ned, og skal det
  opp, scroller vi i stedet (og lager rommet først, så scrollen ikke klemmes).

  Testen dekker:

    1. Kassen bytter vert på det SAMME svaret som plasseringen bruker
       (`dragOverCard`: objektets midtre 1/3 innenfor kortet) — altså FØR raden
       svever over radene i den nye lista, som er der DOM-forelderen skifter.
    2. Kasseraden i lista man forlot forsvinner HELT. Den holder ingen plass.
    3. Nedover: kortet man kommer inn i står stille, og kortet man forlot
       beholder underkanten sin — det er ekstraher-terskelen. Rommet legger seg
       over lista i stedet (`padding-top`).
    4. Hullet som forlater lista OVER siktet settes også av: kortet man svever
       over rykker ikke oppover når raden bytter liste.
    5. Oppover: kassen som opprettes i lista over kommer MOT fingeren — siktet
       havner INNI den nye kasseraden — kortet under står stille, og
       scrollområdet vokser like mye som board-toppen flyttet seg, så toppen er
       fortsatt å nå.
    6. Ingen drift: fram og tilbake fire ganger gir en stabil syklus, ikke et
       board som vandrer.
    7. Ved slipp er alt ryddet: ingen padding, ingen hevet min-høyde, og
       scrollen tilbake der den var.
    9. INGEN FLIMRING: med pekeren i ro på kassen i en liste med ÉN rad står
       tilstanden og knappen bom stille. Kompensasjonen må være det lista
       FAKTISK krympet — containerens min-høyde gjør at en hel radhøyde er for
       mye, og da glir kassa ut under fingeren og hullet kommer tilbake.
   10. INGEN GAP: når en liste komprimerer, følger listene OVER med nedover.
       Kompensasjonen ligger på kolonnen, ikke på kortet, så avstanden mellom
       kortene er den samme som i hvile.
   12. SAKTE INNMARSJ MOT KASSA i den NEDERSTE lista, med siden scrollet til
       bunnen: markeringen slår ikke av og på, og scrollen hopper ikke. Måler man
       mellom sammentrekningen og kompensasjonen, er siden et øyeblikk 56 px
       kortere, nettleseren klemmer scrollen, og auto-scrollen drar den tilbake —
       kassa vandrer under fingeren og tilstanden hakker.
   11. INGEN LUFT SOM BYGGER SEG OPP: fire turer opp og ned over alle listene
       etterlater like mye polstring som den første. En kompensasjon som ikke kan
       føres tilbake når siktet har flyttet seg, blir ellers stående, og
       tomrommet over den øverste lista vokser for hver tur.
    8. MAKSIMAL KOMPRIMERING: ingen liste står med en åpen rad. Gjennom et helt
       drag — ned gjennom lista under, ut mellom kortene, bort på kassene og
       tilbake opp — skal ingen container ha plass som ingen malt rad fyller.
       Et hull som ikke lover en plassering males ikke, og da tar det heller
       ingen plass. Måles også med en KATEGORI i lista, som har sin egen
       container.

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-layout-anchor.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };
const nær = (a, b, slark = 1.5) => Math.abs(a - b) <= slark;

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
  await p.waitForTimeout(1200);
  // Demoen legger et overlegg over board-et; et drag under det er ikke et drag.
  await p.evaluate(() => { try { window.__huskis.tour.skipAll(); } catch (e) { /* alt sett */ } });
  await p.waitForTimeout(250);
}

/* To lister i ÉN kolonne, over hverandre: hele poenget er den loddrette
   rekkefølgen. Liste B har to rader, så den ikke blir tom og bytter til
   tom-tilstanden midt i målingen. */
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const a = mk({ id: 'L1', group: 'GRP', title: 'Liste A', collapsed: false, items: [] });
    a.items.push(mk({ id: 'A0', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    a.items.push(mk({ id: 'A1', home: 'L1', text: 'Brød', cat: null, isCat: false, pos: 1 }));
    const c = mk({ id: 'L2', group: 'GRP', title: 'Liste B', collapsed: false, items: [], pos: 1 });
    c.items.push(mk({ id: 'B0', home: 'L2', text: 'Sykkel', cat: null, isCat: false }));
    c.items.push(mk({ id: 'B1', home: 'L2', text: 'Sko', cat: null, isCat: false, pos: 1 }));
    g.cards.push(a, c);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(400);
}

// Alt målingen trenger, i ett oppslag.
const snap = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const boks = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; };
  const dratt = q('[data-dnd-dragging]');
  const d = dratt ? dratt.getBoundingClientRect() : null;
  return {
    y: window.scrollY,
    maks: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    pad: parseFloat(getComputedStyle(q('.board')).paddingTop) || 0,
    minH: q('.board').style.minHeight,
    L1: boks(q('.card[data-id="L1"]')), L2: boks(q('.card[data-id="L2"]')),
    L1kasse: boks(q('.card[data-id="L1"] .item-trash')),
    L2kasse: boks(q('.card[data-id="L2"] .item-trash')),
    // Siktelinjen ankeret regner med: objektets eget senter.
    sikte: d ? +(d.top + d.height / 2).toFixed(1) : null,
    // Kortet raden ligger i som DOM-node — dnd-kits sortering, som skifter
    // først når objektet svever over RADENE i den nye lista.
    domVert: dratt ? (dratt.closest('.card') ? dratt.closest('.card').dataset.id : 'LUFT') : null,
    armert: [...document.querySelectorAll('.trashcan.drag-trash')]
      .map((t) => { const c = t.closest('.card'); return c ? c.dataset.id : 'TOPP'; }),
    // Mangler hooken (et bygg uten ankeret), er `on` usann og sjekkene under sier fra.
    anker: window.__huskis.dragAnchor || { on: false, pad: 0, floor: 0, scroll: 0 },
  };
});

const løft = async (p, id) => {
  const r = await p.locator('.item[data-id="' + id + '"]').boundingBox();
  const x = r.x + Math.min(r.width / 2, 120), y = r.y + r.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down(); await p.waitForTimeout(60);
  await p.mouse.move(x + 10, y + 10); await p.waitForTimeout(200);
  return { x, y };
};
const dra = async (p, x, y, steg = 3) => { await p.mouse.move(x, y, { steps: steg }); await p.waitForTimeout(70); };

/* ============ Nedover: A1 fra liste A til liste B ============ */
async function nedover(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p); await seed(p);

  const { x, y } = await løft(p, 'A1');
  const start = await snap(p);

  // Steg nedover til kassen har byttet vert, og hold på det siste bildet FØR
  // byttet: det er referansen alt måles mot.
  let før = start, etter = null;
  for (let dy = 12; dy <= 320 && !etter; dy += 8) {
    await dra(p, x, y + dy);
    const s = await snap(p);
    if (s.armert.join() === 'L2') etter = s; else før = s;
  }
  if (!etter) {
    log(label + ' 1: kassen bytter vert på plasseringens eget svar', false, 'byttet aldri vert');
    await p.close(); await b.close(); return;
  }

  // 1) Byttet skjer FØR dnd-kit flytter raden inn blant radene i liste B.
  log(label + ' 1: kassen bytter vert før raden svever over radene i den nye lista',
    etter.armert.join() === 'L2' && etter.domVert === 'L1',
    JSON.stringify({ armert: etter.armert, domVert: etter.domVert, sikte: etter.sikte, L2topp: etter.L2.top }));

  // 2) Kasseraden i lista man forlot forsvinner HELT (uten fiksen: h = 49).
  log(label + ' 2: kasseraden i lista man forlot holder ingen plass',
    før.L1kasse.h > 20 && etter.L1kasse.h === 0,
    JSON.stringify({ før: før.L1kasse.h, etter: etter.L1kasse.h }));

  // 3) Kortet man kommer inn i står stille, og kortet man forlot beholder
  //    underkanten sin — den er ekstraher-terskelen.
  log(label + ' 3: kortet man kommer inn i står stille gjennom byttet',
    nær(etter.L2.top, før.L2.top),
    JSON.stringify({ før: før.L2.top, etter: etter.L2.top }));
  log(label + ' 3: kortet man forlot beholder underkanten sin (terskelen)',
    nær(etter.L1.bottom, før.L1.bottom),
    JSON.stringify({ før: før.L1.bottom, etter: etter.L1.bottom }));
  // … og rommet la seg OVER lista i stedet (uten fiksen: pad = 0).
  const kasse = før.L1kasse.h;
  log(label + ' 3: rommet kasseraden ga fra seg la seg over lista',
    etter.pad - før.pad > kasse - 2 && etter.pad - før.pad < kasse + 14,
    JSON.stringify({ pad: etter.pad - før.pad, kasserad: kasse }));

  // 4) Hullet som forlater liste A (over siktet) settes også av: fortsett
  //    nedover til dnd-kit har flyttet raden inn i liste B.
  let inne = null;
  for (let dy = 320; dy <= 520 && !inne; dy += 8) {
    await dra(p, x, y + dy);
    const s = await snap(p);
    if (s.domVert === 'L2') inne = s;
  }
  log(label + ' 4: kortet man svever over rykker ikke oppover når hullet bytter liste',
    !!inne && nær(inne.L2.top, etter.L2.top),
    JSON.stringify({ før: etter.L2.top, etter: inne && inne.L2.top }));

  await p.mouse.up(); await p.waitForTimeout(900);

  // 7) Alt ryddet ved slipp.
  const slutt = await snap(p);
  log(label + ' 7: polstring, min-høyde og scroll er ryddet ved slipp',
    slutt.pad === start.pad && !slutt.minH && slutt.y === start.y && slutt.anker.on === false,
    JSON.stringify({ pad: slutt.pad, minH: slutt.minH, y: slutt.y, anker: slutt.anker }));
  log(label + ' nedover: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

/* ============ Oppover: B0 fra liste B til liste A ============ */
async function oppover(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p); await seed(p);

  const { x, y } = await løft(p, 'B0');
  const start = await snap(p);

  let før = start, etter = null;
  for (let dy = -12; dy >= -320 && !etter; dy -= 8) {
    await dra(p, x, y + dy);
    const s = await snap(p);
    if (s.armert.join() === 'L1') etter = s; else før = s;
  }
  if (!etter) {
    log(label + ' 5: kassen som opprettes over kommer mot fingeren', false, 'byttet aldri vert');
    await p.close(); await b.close(); return;
  }

  // 5) Kassen vokser OPPOVER, mot fingeren: siktet havner inni den nye
  //    kasseraden i stedet for et stykke over den (uten fiksen ligger raden
  //    under siktet, og man må snu for å treffe den).
  log(label + ' 5: den nye kasseraden kommer MOT fingeren — siktet lander inni den',
    etter.L1kasse.h > 20 && etter.sikte >= etter.L1kasse.top - 2 && etter.sikte <= etter.L1kasse.bottom + 2,
    JSON.stringify({ sikte: etter.sikte, kasse: [etter.L1kasse.top, etter.L1kasse.bottom] }));
  log(label + ' 5: kortet under står stille mens kortet over vokser',
    nær(etter.L2.top, før.L2.top, 3),
    JSON.stringify({ før: før.L2.top, etter: etter.L2.top }));
  // Board-toppen gikk opp forbi toppmenyen — men scrollområdet vokste like
  // mye, så den er fortsatt å nå (uten det ville scrollen blitt klemt).
  log(label + ' 5: scrollområdet vokste like mye som board-et flyttet seg opp',
    etter.y > før.y && etter.maks >= etter.y,
    JSON.stringify({ y: [før.y, etter.y], maks: etter.maks, minH: etter.minH }));

  /* 6) Fram og tilbake fire ganger: skiftet skal falle inn i en STABIL syklus,
        ikke vandre et hakk for hver runde.

     Både polstringen OG scrollen måles, hver for seg. Differansen alene lyver:
     vokser de i takt, står innholdet stille i ruta mens board-et blir høyere og
     høyere — «luft over den øverste lista» som bare bygger seg opp. MÅLT før
     lånebokføringen: pad 165 → 389 → 669 → 893 med scrollen etter seg, mens
     differansen sto stille på ~116. */
  const skift = [];
  const pad = [];
  for (let runde = 0; runde < 4; runde++) {
    for (let dy = -40; dy >= -260; dy -= 20) await dra(p, x, y + dy, 2);
    for (let dy = -240; dy <= 40; dy += 20) await dra(p, x, y + dy, 2);
    const s = await snap(p);
    skift.push(+(s.anker.pad - s.anker.scroll).toFixed(1));
    pad.push(+s.anker.pad.toFixed(1));
  }
  log(label + ' 6: ingen luft bygger seg opp — polstringen vokser ikke per runde',
    pad.slice(1).every((v) => nær(v, pad[1], 2)), JSON.stringify(pad));
  const sisteTre = skift.slice(1);
  log(label + ' 6: ingen drift — skiftet faller inn i en stabil syklus',
    sisteTre.every((v) => nær(v, sisteTre[0], 2)), JSON.stringify(skift));

  await p.mouse.up(); await p.waitForTimeout(900);
  const slutt = await snap(p);
  log(label + ' 7: polstring, min-høyde og scroll er ryddet ved slipp',
    slutt.pad === start.pad && !slutt.minH && slutt.y === start.y && slutt.anker.on === false,
    JSON.stringify({ pad: slutt.pad, minH: slutt.minH, y: slutt.y }));
  log(label + ' oppover: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

/* ============ 8) Ingen liste står med en åpen rad ============ */

/* Åpen plass i en liste: containerens høyde minus det de MALTE radene fyller.
   Dra-objektet selv er tatt ut av flyten og fyller ingen rad; containerens egen
   min-høyde er tom-listas slippflate og står der like fullt i hvile. */
const åpneRader = (p) => p.evaluate(() => {
  const malt = (el) => {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') return false;
    return cs.visibility === 'visible' && cs.display !== 'none' &&
      +cs.opacity > 0.01 && el.getBoundingClientRect().height > 0.5;
  };
  const åpne = [];
  let radeteller = 0;
  document.querySelectorAll('.items-container').forEach((cont) => {
    const cs = getComputedStyle(cont);
    const gap = parseFloat(cs.rowGap) || 0;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const gulv = (parseFloat(cs.minHeight) || 0) + pad;
    let sum = 0, n = 0;
    [...cont.children].forEach((k) => {
      if (!malt(k)) return;
      const ks = getComputedStyle(k);
      // Marginene teller med: kategoriens skillelinje males i en 25 px marg på
      // raden ved siden av, og den er en malt ting, ikke en åpen rad.
      sum += k.getBoundingClientRect().height +
        (parseFloat(ks.marginTop) || 0) + (parseFloat(ks.marginBottom) || 0);
      n++;
    });
    radeteller += n;
    const brutto = cont.getBoundingClientRect().height;
    const åpen = brutto - Math.max(gulv, pad + sum + gap * Math.max(0, n - 1));
    const kort = cont.closest('.card');
    if (åpen > 4) åpne.push((kort ? kort.dataset.id : '?') + '=' + åpen.toFixed(0) + 'px');
  });
  const ph = document.querySelector('[data-dnd-placeholder]');
  const phMalt = ph ? malt(ph) : false;
  return {
    åpne,
    malteRader: radeteller,
    hull: ph ? (phMalt ? 'malt' : 'skjult') : 'ingen',
    klasser: [...document.body.classList].filter((c) => /^is-/.test(c)).join(','),
  };
});

async function komprimert(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p);

  for (const variant of ['flat', 'kategori']) {
    /* Forrige runde skrev til skyen (et slipp er et slipp). Vent til køen er
       tom før fiksturet settes på nytt, ellers rendrer svaret board-et etterpå
       og tar seeden med seg. */
    await p.waitForFunction(() => {
      const el = document.querySelector('#sync-status');
      return !el || el.dataset.state !== 'saving';
    }, null, { timeout: 15000, polling: 200 });
    await seed(p);
    if (variant === 'kategori') {
      // Liste B får en kategori med ett medlem: en container til, med sin egen
      // min-høyde og sitt eget gap.
      await p.evaluate(() => {
        const H = window.__huskis, st = H.state;
        const l2 = st.universes[0].groups[0].cards.find((c) => c.id === 'L2');
        const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
          trashed: false, _role: 'owner' }, o);
        l2.items.push(mk({ id: 'K1', home: 'L2', text: 'Sport', cat: null, isCat: true, pos: 2 }));
        l2.items.push(mk({ id: 'B2', home: 'L2', text: 'Ski', cat: 'K1', isCat: false, pos: 3 }));
        H.render();
      });
      await p.waitForTimeout(350);
    }
    await p.waitForSelector('.item[data-id="A1"]', { timeout: 15000 });

    const { x, y } = await løft(p, 'A1');
    const L2 = await p.locator('.card[data-id="L2"]').boundingBox();
    const bunn = L2.y + L2.height + 40 - y;   // forbi hele liste B
    const prøver = [];
    for (let dy = 12; dy <= bunn; dy += 12) { await dra(p, x, y + dy, 2); prøver.push(await åpneRader(p)); }
    for (let dy = bunn; dy >= -60; dy -= 12) { await dra(p, x, y + dy, 2); prøver.push(await åpneRader(p)); }
    // Kassene: begge vertene, der hullet før beholdt plassen i sin EGEN liste.
    for (const id of ['L2', 'L1']) {
      const k = await p.locator('.card[data-id="' + id + '"] .item-trash-btn').boundingBox();
      if (!k) continue;
      for (let i = 0; i < 3; i++) {
        await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2, { steps: 2 });
        await p.waitForTimeout(70);
        prøver.push(await åpneRader(p));
      }
    }
    /* Slipp raden der den ble løftet — ikke på kassen: en sletting her ville
       fjernet fiksturet for neste variant. */
    await p.mouse.move(x, y, { steps: 6 }); await p.waitForTimeout(120);
    await p.mouse.up(); await p.waitForTimeout(700);
    prøver.push(await åpneRader(p));

    const med = prøver.filter((s) => s.åpne.length);
    log(label + ' 8 (' + variant + '): ingen liste står med en åpen rad (' + prøver.length + ' prøver)',
      med.length === 0,
      JSON.stringify(med.slice(0, 3).map((s) => ({ åpne: s.åpne, hull: s.hull, kl: s.klasser }))));
    /* Uten dette er sjekken over tom: turen SKAL ha vært innom et skjult hull —
       det er da plassen måtte tas — og et malt hull skal fortsatt fylle en rad. */
    const skjulte = prøver.filter((s) => s.hull === 'skjult').length;
    const malte = prøver.filter((s) => s.hull === 'malt').length;
    log(label + ' 8 (' + variant + '): turen var innom både malt og skjult hull',
      skjulte > 3 && malte > 3, JSON.stringify({ skjulte, malte }));
  }
  log(label + ' 8: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

/* ============ 9) Ingen flimring, og ingen gap mellom listene ============ */

/* Én liste med ÉN rad over en liste med to. Den ene raden er det strengeste
   tilfellet: lukkes hullet, stopper containeren på sin egen min-høyde, og en
   kompensasjon regnet ut fra radhøyden blir for stor. */
async function seedEn(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    const a = mk({ id: 'L0', group: 'GRP', title: 'Liste 0', collapsed: false, items: [] });
    a.items.push(mk({ id: 'X0', home: 'L0', text: 'Over', cat: null, isCat: false }));
    const b2 = mk({ id: 'L1', group: 'GRP', title: 'Liste A', collapsed: false, items: [], pos: 1 });
    b2.items.push(mk({ id: 'A1', home: 'L1', text: 'Brød', cat: null, isCat: false }));
    const c = mk({ id: 'L2', group: 'GRP', title: 'Liste B', collapsed: false, items: [], pos: 2 });
    c.items.push(mk({ id: 'B0', home: 'L2', text: 'Sykkel', cat: null, isCat: false }));
    c.items.push(mk({ id: 'B1', home: 'L2', text: 'Sko', cat: null, isCat: false, pos: 1 }));
    g.cards.push(a, b2, c);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(400);
}

// Kortbokser og gapene mellom dem, i den kolonnen kortene står i.
const bilde = (p) => p.evaluate(() => {
  const kort = [...document.querySelectorAll('.card')].map((c) => ({
    id: c.dataset.id,
    t: +c.getBoundingClientRect().top.toFixed(1),
    b: +c.getBoundingClientRect().bottom.toFixed(1),
  }));
  const gap = [];
  for (let i = 1; i < kort.length; i++) gap.push(+(kort[i].t - kort[i - 1].b).toFixed(1));
  const kn = document.querySelector('.card[data-id="L1"] .item-trash-btn');
  return {
    kort, gap,
    kl: [...document.body.classList].filter((c) => /^is-/.test(c)).join(','),
    knapp: kn ? +kn.getBoundingClientRect().top.toFixed(1) : null,
  };
});

async function iRoOgUtenGap(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p); await seedEn(p);
  const hvile = await bilde(p);

  const { x, y } = await løft(p, 'A1');
  // Kassa slik den står FØR komprimeringen: den skal ikke flytte seg en piksel
  // av at hullet lukkes. Uten fiksen kompenseres hele radhøyden, mens lista bare
  // krympet til sin egen min-høyde, og kortet vokser med differansen.
  const kasse = await p.locator('.card[data-id="L1"] .item-trash-btn').boundingBox();
  const knappFør = +(await bilde(p)).knapp;
  for (let i = 1; i <= 12; i++) {
    await dra(p, x, y + (kasse.y + kasse.height / 2 - y) * i / 12, 1);
  }
  // Pekeren HELT i ro: ingenting skal røre seg. Uten fiksen slår tilstanden
  // fram og tilbake fordi kompensasjonen er større enn det lista faktisk
  // krympet, og kassa glir ut under fingeren.
  const iRo = [];
  for (let i = 0; i < 16; i++) {
    await p.mouse.move(x, kasse.y + kasse.height / 2);
    await p.waitForTimeout(60);
    iRo.push(await bilde(p));
  }
  const tilstander = [...new Set(iRo.map((s) => s.kl))];
  const knapper = [...new Set(iRo.map((s) => s.knapp))];
  log(label + ' 9: pekeren i ro på kassen — ingen flimring (16 prøver)',
    tilstander.length === 1 && knapper.length === 1,
    JSON.stringify({ tilstander, knapper }));
  log(label + ' 9: …og kassa står der den sto før hullet lukket seg',
    iRo[0].kl.includes('is-over-trash') && nær(knapper[0], knappFør, 1.5),
    JSON.stringify({ før: knappFør, nå: knapper[0], kl: iRo[0].kl }));

  // 10) Lista komprimerer: gapene i kolonnen skal være DE SAMME som i hvile —
  //     lista over følger med nedover i stedet for å bli stående igjen.
  const nå = iRo[iRo.length - 1];
  log(label + ' 10: ingen gap åpner seg mellom listene når en liste komprimerer',
    nå.gap.length === hvile.gap.length && nå.gap.every((g, i) => nær(g, hvile.gap[i], 1.5)),
    JSON.stringify({ hvile: hvile.gap, nå: nå.gap }));
  /* 11) Turer opp og ned over ALLE listene, mange ganger: polstringen skal ikke
        vokse. Det er her luften bygger seg opp — hver tur tar opp en
        kompensasjon som ikke kan føres tilbake når siktet har flyttet seg, og
        MÅLT uten lånebokføringen vokste den 56–112 px per tur, i det uendelige. */
  const bunn = (await p.locator('.card[data-id="L2"]').boundingBox());
  const luft = [];
  for (let runde = 0; runde < 4; runde++) {
    for (let ny2 = y; ny2 <= bunn.y + bunn.height + 20; ny2 += 24) await dra(p, x, ny2, 1);
    for (let ny2 = bunn.y + bunn.height + 20; ny2 >= 90; ny2 -= 24) await dra(p, x, ny2, 1);
    await dra(p, x, y, 2);
    const a = await snap(p);
    /* Ankerets EGNE knapper, ikke `window.scrollY`: dra-motorens auto-scroll
       flytter siden når fingeren er nær kanten, og den er ikke drift. */
    luft.push({ pad: +a.anker.pad.toFixed(1), egen: +a.anker.scroll.toFixed(1) });
  }
  /* Grensen er hva som FAKTISK kan mangle over siktet: den løftede raden, den
     komprimerte raden og kasseraden — under 170 px i dette fikstureret. Alt over
     det er drift, og den vokser per tur: MÅLT 893 px etter fire turer før
     lånebokføringen. */
  const tak = 170;
  log(label + ' 11: ingen luft bygger seg opp over listene (4 turer over alle listene)',
    luft.every((v) => v.pad + v.egen <= tak),
    JSON.stringify({ luft, tak }));

  /* Slipp raden INNE i lista igjen: et slipp i lufta mellom kortene lager en ny
     liste, og da er det en annen layout vi sammenligner med. */
  const l1 = await p.locator('.card[data-id="L1"]').boundingBox();
  await dra(p, x, l1.y + l1.height / 2, 4);
  await dra(p, x, l1.y + l1.height / 2, 2);
  await p.mouse.up(); await p.waitForTimeout(600);
  const slutt = await bilde(p);
  log(label + ' 10: gapene er de samme igjen etter slipp',
    slutt.gap.every((g, i) => nær(g, hvile.gap[i], 1.5)),
    JSON.stringify({ hvile: hvile.gap, slutt: slutt.gap }));
  log(label + ' 9–10: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

/* ============ 12) Sakte innmarsj mot kassa i den NEDERSTE lista ============

   Den er det verste tilfellet: siden er scrollet til bunnen, og en liste som
   krymper gjør siden kortere. Måler man MELLOM sammentrekningen og
   kompensasjonen, tvinger man fram en layout der siden er 56 px kortere, og
   nettleseren klemmer scrollen — permanent. Auto-scrollen drar den tilbake,
   kassa vandrer under fingeren, og tilstanden slår av og på. */
async function seedTre(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    u.groups.push(g);
    [0, 1, 2].forEach((i) => {
      const id = 'K' + i;
      const c = mk({ id, group: 'GRP', title: 'Liste ' + i, collapsed: false, items: [], pos: i });
      [0, 1, 2].forEach((r) => c.items.push(mk({ id: id + '-' + r, home: id,
        text: 'Rad ' + i + '.' + r, cat: null, isCat: false, pos: r })));
      g.cards.push(c);
    });
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(400);
}

async function sakteMotKassa(label, viewport) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport, hasTouch: viewport.width < 500, isMobile: viewport.width < 500 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await register(p); await seedTre(p);
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(300);

  const { x, y } = await løft(p, 'K1-0');
  const siste = await p.locator('.card').last().boundingBox();
  const slutt = Math.min(siste.y + siste.height - 20, viewport.height - 10);
  const prøver = [];
  // ETT piksel om gangen: det er den sakte innmarsjen som utløser hakkingen.
  for (let ny = y + 6; ny <= slutt; ny += 1) {
    await p.mouse.move(x, ny, { steps: 1 });
    await p.waitForTimeout(16);
    prøver.push(await p.evaluate(() => ({
      kasse: document.body.classList.contains('is-over-trash'),
      y: window.scrollY,
      // Ankerets EGEN scroll: den delen av bevegelsen som er kompensasjon.
      egen: (window.__huskis.dragAnchor || { scroll: 0 }).scroll,
    })));
  }
  // Hvor mange ganger slår «pekeren er på kassa» av eller på? Én gang per kasse
  // man passerer er riktig; hakkingen viste seg som 15+.
  let vipp = 0;
  prøver.forEach((s, i) => { if (i && s.kasse !== prøver[i - 1].kasse) vipp++; });
  log(label + ' 12: kassemarkeringen slår ikke av og på under sakte innmarsj (' + prøver.length + ' piksler)',
    vipp <= 4, JSON.stringify({ vipp, prøver: prøver.length }));
  /* …og scrollen skal ikke hoppe. Auto-scroll beveger noen få piksler per
     frame; klemmen ga et hopp på en hel radhøyde.

     Målt er det UFORKLARTE skiftet: ankerets egen scroll (`dragAnchor.scroll`)
     ER kompensasjon — flytter innholdet over siktet seg 49 px, skal siden
     følge etter like mye, og siktet står da bom stille selv om `scrollY`
     endret seg. Klemmen er nettopp den som IKKE er bokført: siden ble kortere,
     nettleseren dro scrollen med seg, og ankeret vet ingenting om det. Uten
     dette skillet var sjekken en funksjon av hvor mye ledig høyde viewportet
     tilfeldigvis hadde — den ble rød da toppmenyen fikk fanerad, uten at noe
     hoppet. */
  const hopp = [];
  prøver.forEach((s, i) => {
    if (!i) return;
    const uforklart = (s.y - prøver[i - 1].y) - (s.egen - prøver[i - 1].egen);
    if (Math.abs(uforklart) > 20) hopp.push(prøver[i - 1].y + '→' + s.y + ' (ubokført ' + Math.round(uforklart) + ')');
  });
  log(label + ' 12: scrollen hopper ikke når lista komprimerer',
    hopp.length === 0, JSON.stringify(hopp.slice(0, 4)));
  await p.mouse.up(); await p.waitForTimeout(500);
  log(label + ' 12: ingen JS-feil', errs.length === 0, errs.join(' | '));
  await p.close(); await b.close();
}

/* Toppmenyen har fått ÉN RAD TIL — hovedfanene `Lister | Notater`
   (docs/notater-plan.md) — og den raden koster board-et 48 px av høyden
   (radens egen høyde pluss panelets radgap; les den ut av `--main-tabs-h`).
   Fixturene her er tunet på hvor mye plass board-et har UNDER panelet, ikke på
   viewportets egen høyde: sjekk 4 og 12 måler hvor draget havner i forhold til
   kortene og til viewportets bunn. Viewportene får derfor den plassen tilbake.

   VERIFISERT at det er panelhøyden og ikke noe annet: legger man like mye
   padding på `.topbar` i et ELLERS uendret repo, feiler nøyaktig de samme tre
   sjekkene, med de samme tallene. */
const PANEL_FANERAD = 48;
const vp = (width, height) => ({ width, height: height + PANEL_FANERAD });

(async () => {
  await nedover('desktop', vp(1280, 900));
  await nedover('mobil', vp(390, 780));
  await oppover('desktop', vp(1280, 900));
  await oppover('mobil', vp(390, 780));
  await komprimert('desktop', vp(1280, 900));
  await komprimert('mobil', vp(390, 780));
  await iRoOgUtenGap('desktop', vp(1280, 900));
  await iRoOgUtenGap('mobil', vp(390, 780));
  await sakteMotKassa('mobil', vp(390, 700));
  await sakteMotKassa('desktop', vp(540, 700));
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
