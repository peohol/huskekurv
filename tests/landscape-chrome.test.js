/*
  Regresjonstest: CHROMET PÅ EN LAV SKJERM (telefon i landskap).

  I landskap er HØYDE mangelvaren: viewportet er ~360 px høyt, og alt det faste
  chromet spiser av de radene brukeren skal jobbe i. To ting følger av det, og
  begge testes her:

    • Toppmenyen står på ÉN linje der bredden rekker (desktop og telefon i
      landskap) — breadcrumben og listefunksjonene deler linje. Under 620 px
      legges listefunksjonene på raden under, slik at navnene ikke kappes bort
      til ingenting. Grensen er toppmenyens EGEN (620/621 px), ikke board-ets
      én-kolonne-grense (560/561): den avhenger av hvor bred hjørnegruppen er,
      og flytter seg når gruppen får en knapp til.
    • Demonstrasjonens kort holder seg INNENFOR viewportet uansett hvor lavt
      det er. Kortet er en flex-kolonne: teksten ruller, mens knapperaden blir
      stående — «Kom i gang» er eneste vei videre ut av velkomsten, og et kort
      som stikker ut under skjermkanten tar den med seg ut av syne.

  Dekker:
    1. Landskap: breadcrumb og «＋ Liste» på samme linje, og panelet er én
       kontrollhøyde høyt (ikke to).
    2. Den siste kontrollen på linjen kolliderer ikke med kontoknappen i
       hjørnet — i begge oppsettene.
    3. Landskap: velkomsten ligger helt innenfor viewportet, og «Kom i gang»
       kan faktisk treffes.
    4. Kappingen skjer på TEKSTEN, ikke på kortet: `.tour-body` ruller.
    5. Landskap: et tooltip-steg (pilspiss mot et mål) holder seg innenfor
       viewportet og dekker fortsatt ikke målet.
    6. 621 px: én linje. 620 px og telefon i portrett: to rader. Og på
       561 px — der grensen gikk før hjørnegruppen fikk sin sjette knapp —
       skal listefunksjonene fortsatt IKKE ligge oppå breadcrumben.

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/landscape-chrome.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const waitStep = (p, id) => p.waitForFunction((want) => {
  const H = window.__huskis;
  return !!H && !!H.authUser && H.tour.active && H.tour.id === want && H.tour.shown;
}, id, { timeout: 20000, polling: 80 });

// Registrer + logg inn en fersk konto. En tom, ny konto starter demoen selv.
async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => !!window.__huskis, null, { timeout: 10000, polling: 100 });
  const email = 'u' + Math.floor(Math.random() * 1e9) + '@test.no';
  await p.getByText('Registrer deg').click();
  await p.locator('#auth-first-name').waitFor({ state: 'visible' });
  await p.locator('#auth-first-name').fill('Test');
  await p.locator('#auth-last-name').fill('Bruker');
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
  await p.getByText('Tilbake til innlogging').click();
  await p.locator('#auth-email').waitFor({ state: 'visible' });
  await p.locator('#auth-email').fill(email);
  await p.locator('#auth-password').fill('passord123');
  await p.locator('#auth-submit').click();
}

/* Innhold med LANGE navn og en slettet liste: breadcrumben skal være så bred
   som den kan bli, og søppelkassen (den siste kontrollen på linjen) skal
   faktisk være synlig når vi måler avstanden til kontoknappen. */
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Familien Holmens felles planlegging', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan for hele høsten', cat: null, isCat: false, collapsed: false, cards: [] });
    for (let i = 0; i < 4; i++) {
      g.cards.push(mk({ id: 'X' + i, group: 'GRP', title: 'Liste ' + i, collapsed: false, pos: i,
        items: [mk({ id: 'XI' + i, home: 'X' + i, text: 'Punkt ' + i, cat: null, isCat: false })] }));
    }
    g.cards.push(mk({ id: 'DEL', group: 'GRP', title: 'Slettet liste', collapsed: false, pos: 9, trashed: true, items: [] }));
    u.groups.push(g);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForFunction(() => {
    const t = document.getElementById('trash-btn');
    return t && !t.hidden;
  }, null, { timeout: 5000, polling: 100 });
}

// Toppmenyens geometri: står kontrollene på samme linje, og hvor slutter den
// siste av dem i forhold til kontoknappen?
const topbarGeo = (p) => p.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
  const bar = r('#topbar'), crumb = r('#nav-crumb'), add = r('#add-card-btn'), acc = r('#account-btn');
  const faner = r('#main-tabs');
  const trashEl = document.getElementById('trash-btn');
  const trash = trashEl && !trashEl.hidden ? trashEl.getBoundingClientRect() : null;
  const sisteHøyre = Math.max(add.right, trash ? trash.right : 0);
  return {
    barH: Math.round(bar.height),
    faneH: Math.round(faner.height),
    faneTop: Math.round(faner.top),
    kontrollH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-h')),
    sammeLinje: Math.abs(add.top - crumb.top) < 2,
    addTop: Math.round(add.top), crumbTop: Math.round(crumb.top),
    trashVises: !!trash,
    sisteHøyre: Math.round(sisteHøyre),
    kontoVenstre: Math.round(acc.left),
    crumbHøyre: Math.round(crumb.right),
    // Avstanden fra nav-knappen til «＋ Liste» — skal være panelets gap (8 px),
    // ikke all den ledige plassen på linjen.
    avstandTilAdd: Math.round(add.left - crumb.right),
    panelGap: parseFloat(getComputedStyle(document.getElementById('topbar')).columnGap) || 0,
  };
});

const tourGeo = (p) => p.evaluate(() => {
  const card = document.getElementById('tour-card');
  const body = card.querySelector('.tour-body');
  const next = document.getElementById('tour-next');
  const c = card.getBoundingClientRect();
  const n = next.hidden ? null : next.getBoundingClientRect();
  const treff = n ? document.elementFromPoint(n.x + n.width / 2, n.y + n.height / 2) : null;
  return {
    kort: { top: Math.round(c.top), bottom: Math.round(c.bottom), left: Math.round(c.left), right: Math.round(c.right) },
    vw: window.innerWidth, vh: window.innerHeight,
    bodyRuller: body.scrollHeight > body.clientHeight + 1,
    bodyScroll: body.scrollHeight, bodyKlient: body.clientHeight,
    kortRuller: card.scrollHeight > card.clientHeight + 1,
    nesteTreff: !!treff && (next === treff || next.contains(treff)),
  };
});

// Kortet er helt innenfor viewportet?
const innenfor = (g) => g.kort.top >= -0.5 && g.kort.left >= -0.5
  && g.kort.bottom <= g.vh + 0.5 && g.kort.right <= g.vw + 0.5;

// To rektangler som ikke overlapper.
const utenfor = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1
  || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;

/* ---------------- Landskap: hele runden ---------------- */
async function landskap() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await register(p);
  await waitStep(p, 'welcome');

  // 3–4: velkomsten på en lav skjerm.
  const v = await tourGeo(p);
  log('landskap: velkomstkortet ligger helt innenfor viewportet', innenfor(v),
    'kort ' + JSON.stringify(v.kort) + ' i ' + v.vw + '×' + v.vh);
  log('landskap: «Kom i gang» kan treffes', v.nesteTreff, 'treff ' + v.nesteTreff);
  log('landskap: det er TEKSTEN som ruller, ikke kortet', v.bodyRuller && !v.kortRuller,
    'body ' + v.bodyScroll + '/' + v.bodyKlient + ', kort ruller ' + v.kortRuller);

  /* Rullingen må BLI STÅENDE. Plasseringen måler kortet ukappet, og uten klipp
     renner ikke `.tour-body` over — nettleseren klemmer da `scrollTop` til 0.
     Skjer det for hver plassering, spretter teksten tilbake til toppen i det
     brukeren leser: nederste linje vises et øyeblikk, og forsvinner igjen. */
  /* Uten en affordanse ser et kappet kort FERDIG ut: teksten slutter gjerne
     etter et helt punkt, og mobilens rullefelt er usynlig til man drar. */
  const merFør = await p.evaluate(() => document.getElementById('tour-card').classList.contains('has-more'));
  log('landskap: kortet viser at det er mer tekst under kanten', merFør, 'has-more ' + merFør);

  const lesested = await p.evaluate(async () => {
    const body = document.querySelector('#tour-card .tour-body');
    body.scrollTop = body.scrollHeight;          // helt ned
    const etterRulling = body.scrollTop;
    // Kortets EGEN rulling skal ikke gi en ny plassering …
    body.dispatchEvent(new Event('scroll', { bubbles: true }));
    // … og en plassering som likevel kjører (her: en resize) skal ta vare på
    // lesestedet.
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => requestAnimationFrame(r));
    return { etterRulling, naa: body.scrollTop };
  });
  log('landskap: lesestedet i kortet overlever en ny plassering',
    lesested.etterRulling > 0 && lesested.naa === lesested.etterRulling,
    'rullet til ' + lesested.etterRulling + ', står på ' + lesested.naa);
  // …og når man ER nede skal siste linje være skarp, ikke tonet ut.
  const merEtter = await p.evaluate(() => document.getElementById('tour-card').classList.contains('has-more'));
  log('landskap: avtoningen forsvinner når man har rullet til bunnen', !merEtter, 'has-more ' + merEtter);

  // 5: et tooltip-steg med pilspiss mot et mål i toppmenyen.
  await p.locator('#tour-next').click();
  await waitStep(p, 'open_nav');
  const t = await p.evaluate(() => {
    const c = document.getElementById('tour-card').getBoundingClientRect();
    const m = document.getElementById('nav-crumb').getBoundingClientRect();
    return {
      kort: { top: Math.round(c.top), bottom: Math.round(c.bottom), left: Math.round(c.left), right: Math.round(c.right) },
      mål: { top: Math.round(m.top), bottom: Math.round(m.bottom), left: Math.round(m.left), right: Math.round(m.right) },
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });
  log('landskap: tooltip-steget ligger helt innenfor viewportet', innenfor(t),
    'kort ' + JSON.stringify(t.kort) + ' i ' + t.vw + '×' + t.vh);
  log('landskap: kortet dekker fortsatt ikke målet', utenfor(t.kort, t.mål),
    'kort ' + JSON.stringify(t.kort) + ' vs mål ' + JSON.stringify(t.mål));

  // 1–2: toppmenyen med innhold, uten demoen i veien.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForFunction(() => document.getElementById('tour').hidden, null, { timeout: 5000, polling: 100 });
  await seed(p);
  const g = await topbarGeo(p);
  log('landskap: breadcrumb og listefunksjoner på samme linje', g.sammeLinje,
    'crumb topp ' + g.crumbTop + ', ＋ Liste topp ' + g.addTop);
  /* Panelet har hovedfanene på sin egen (kompakte) første rad, og den aktive
     fanens kontroller på den neste (docs/notater-plan.md). Kravet er derfor
     ikke lenger «én kontrollhøyde», men at kontrollraden ikke deler seg i to:
     fanene + ÉN kontrollrad, ikke fanene + to. */
  log('landskap: panelet er fanerad + én kontrollrad, ikke to', g.barH < g.faneH + g.kontrollH * 2,
    'panel ' + g.barH + ' px, fanerad ' + g.faneH + ' px, kontrollhøyde ' + g.kontrollH + ' px');
  log('landskap: hovedfanene ligger over kontrollraden', g.faneTop < g.crumbTop,
    'fanerad topp ' + g.faneTop + ', crumb topp ' + g.crumbTop);
  log('landskap: listefunksjonene står rett til høyre for nav-knappen',
    Math.abs(g.avstandTilAdd - g.panelGap) <= 1,
    'avstand ' + g.avstandTilAdd + ' px, panelets gap ' + g.panelGap + ' px');
  log('landskap: søppelkassen vises (siste kontroll på linjen)', g.trashVises);
  log('landskap: siste kontroll kolliderer ikke med kontoknappen', g.sisteHøyre <= g.kontoVenstre,
    'siste høyre ' + g.sisteHøyre + ' ≤ konto venstre ' + g.kontoVenstre);
  log('landskap: ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

/* ---------------- Bredde-grensen og portrett ---------------- */
async function bredde(navn, vp, énLinje) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await register(p);
  await p.waitForFunction(() => {
    const H = window.__huskis; return H && H.authUser && H.lastMy;
  }, null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForFunction(() => document.getElementById('tour').hidden, null, { timeout: 5000, polling: 100 });
  await seed(p);

  const g = await topbarGeo(p);
  log(navn + ': ' + (énLinje ? 'én linje' : 'to rader'), g.sammeLinje === énLinje,
    'crumb topp ' + g.crumbTop + ', ＋ Liste topp ' + g.addTop + ', panel ' + g.barH + ' px');
  log(navn + ': siste kontroll kolliderer ikke med kontoknappen', g.sisteHøyre <= g.kontoVenstre,
    'siste høyre ' + g.sisteHøyre + ' ≤ konto venstre ' + g.kontoVenstre);
  if (énLinje) {
    log(navn + ': listefunksjonene står rett til høyre for nav-knappen',
      Math.abs(g.avstandTilAdd - g.panelGap) <= 1,
      'avstand ' + g.avstandTilAdd + ' px, panelets gap ' + g.panelGap + ' px');
  }
  if (!énLinje) {
    log(navn + ': breadcrumben holder avstand til kontoknappen', g.crumbHøyre <= g.kontoVenstre,
      'crumb høyre ' + g.crumbHøyre + ' ≤ konto venstre ' + g.kontoVenstre);
  }
  log(navn + ': ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

(async () => {
  await landskap();
  await bredde('621 px', { width: 621, height: 600 }, true);
  await bredde('620 px', { width: 620, height: 600 }, false);
  // Den gamle grensen: her skal panelet være stablet, ikke overlappende.
  await bredde('561 px', { width: 561, height: 600 }, false);
  await bredde('portrett', { width: 390, height: 780 }, false);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
