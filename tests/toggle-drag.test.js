/*
  Regresjonstest: BRYTERNE KAN DRAS, IKKE BARE KLIKKES.

  Begge bryterformene er den samme kontrollen sett to ganger — én akse med n
  gyldige stopp og én flate som står på et av dem. Den segmenterte (`.seg`,
  hovedbryteren Lister ↔ Notater, søkets scopevelger og tidshorisonten i
  «Kommende hendelser») har n segmenter;
  av/på-bryteren (`.toggle-switch`, varseltypene) har to. Gesten er derfor delt:
  ta tak, følg fingeren, slipp, snap til nærmeste stopp.

  Dekker:
    1. SEGMENTERT: et drag fra det ene segmentet til det andre bytter fane —
       og indikatoren følger fingeren underveis (en BRØKDELS posisjon, ikke et
       hopp mellom to hele stillinger).
    2. … og et drag TILBAKE virker like godt (begge retninger).
    3. Et drag som slippes NÆRMEST der det startet, snapper tilbake og endrer
       ingenting — og etterlater ingen overstyring på elementet.
    4. AV/PÅ: et drag over knotten slår bryteren, og valget lagres på kontoen
       på nøyaktig samme vis som et klikk gjør.
    5. Et vanlig KLIKK virker fortsatt — gesten skal ikke ha spist det.
    6. Et drag teller ÉN gang: det etterfølgende ekte klikket svelges, så
       bryteren ikke slår tilbake igjen med det samme.
    7. TASTATUR er urørt.
    8. TIDSHORISONTEN i «Kommende hendelser» er den SAMME bryteren: `.seg` med
       den grønne, glidende flaten og den samme gesten — men fortsatt med
       radiogruppens `aria-checked`, ikke fane-rekkens `aria-selected`.

  Kjøres på BÅDE desktop- og mobil-viewport (mus og finger er den samme
  pekerkoden, men terskelen og `touch-action` er ikke det).

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/toggle-drag.test.js
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
  }, null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(200);
}

/* Et EKTE pekerdrag langs bryterens akse. `steps` gjør at `pointermove` fyrer
   flere ganger — indikatoren skal følge med underveis, ikke bare ved slipp.
   `midtveis` leses etter halve reisen. */
async function dragToggle(p, sel, fraX, tilX, { midtveisVar = null } = {}) {
  const box = await p.locator(sel).boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + fraX * box.width;
  const x1 = box.x + tilX * box.width;
  await p.mouse.move(x0, y);
  await p.mouse.down();
  await p.mouse.move(x0 + (x1 - x0) * 0.5, y, { steps: 6 });
  await p.waitForTimeout(60);
  let midtveis = null;
  if (midtveisVar) {
    midtveis = await p.evaluate(({ s, v }) => {
      const el = document.querySelector(s);
      return { verdi: el.style.getPropertyValue(v).trim(), klasse: el.classList.contains('is-tog-drag') };
    }, { s: sel, v: midtveisVar });
  }
  await p.mouse.move(x1, y, { steps: 6 });
  await p.waitForTimeout(60);
  await p.mouse.up();
  await p.waitForTimeout(400);
  return midtveis;
}

const aktivFane = (p) => p.evaluate(() =>
  (document.querySelector('#main-tabs .main-tab.is-active') || {}).dataset?.tab || null);
const segRest = (p) => p.evaluate(() => {
  const el = document.getElementById('main-tabs');
  return { drag: el.style.getPropertyValue('--seg-drag').trim(), klasse: el.classList.contains('is-tog-drag') };
});

async function run(label, viewport, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    mobile ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  console.log('\n== ' + label + ' ==');
  await register(p);

  /* ---------- 1) Segmentert: dra fra Lister til Notater ---------- */
  log(label + ' 1: står på Lister til å begynne med', (await aktivFane(p)) === 'lists', String(await aktivFane(p)));
  const midt = await dragToggle(p, '#main-tabs', 0.25, 0.85, { midtveisVar: '--seg-drag' });
  const etter1 = await aktivFane(p);
  log(label + ' 1: et drag mot høyre bytter til Notater', etter1 === 'notes', String(etter1));
  const brøk = parseFloat(midt && midt.verdi);
  log(label + ' 1: … og indikatoren følger fingeren underveis, i en BRØKDELS posisjon',
    !!midt && midt.klasse === true && brøk > 0 && brøk < 1, JSON.stringify(midt));
  const hvile1 = await segRest(p);
  log(label + ' 1: … og overstyringen er borte ved slipp',
    hvile1.drag === '' && hvile1.klasse === false, JSON.stringify(hvile1));

  /* ---------- 2) … og tilbake igjen ---------- */
  await dragToggle(p, '#main-tabs', 0.85, 0.15);
  const etter2 = await aktivFane(p);
  log(label + ' 2: et drag mot venstre bytter tilbake til Lister', etter2 === 'lists', String(etter2));

  /* ---------- 3) Et drag som ender der det startet, endrer ingenting ---------- */
  await dragToggle(p, '#main-tabs', 0.2, 0.4);       // fortsatt nærmest segment 0
  const etter3 = await aktivFane(p);
  const hvile3 = await segRest(p);
  log(label + ' 3: et drag som snapper tilbake bytter ingen fane',
    etter3 === 'lists' && hvile3.drag === '' && hvile3.klasse === false,
    JSON.stringify({ fane: etter3, hvile: hvile3 }));

  /* ---------- 5) Et vanlig klikk virker fortsatt ---------- */
  await p.click('#main-tabs .main-tab[data-tab="notes"]');
  await p.waitForTimeout(350);
  log(label + ' 5: et vanlig klikk bytter fane som før', (await aktivFane(p)) === 'notes', String(await aktivFane(p)));

  /* ---------- 7) Tastatur er urørt ---------- */
  await p.evaluate(() => document.querySelector('#main-tabs .main-tab.is-active').focus());
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(350);
  log(label + ' 7: piltast flytter fortsatt mellom segmentene', (await aktivFane(p)) === 'lists',
    String(await aktivFane(p)));

  /* ---------- 4 + 6) Av/på-bryteren ---------- */
  await p.evaluate(() => window.__huskis.openNotifModal());
  await p.waitForTimeout(350);
  await p.click('#notif-settings-btn');
  await p.waitForTimeout(300);
  const bryter = '#notif-body .toggle-switch[data-pref="dueSoon"]';
  const før = await p.evaluate((s) => document.querySelector(s).getAttribute('aria-checked'), bryter);
  const midtB = await dragToggle(p, bryter, 0.15, 0.9, { midtveisVar: '--knob-drag' });
  const etterB = await p.evaluate((s) => {
    const el = document.querySelector(s);
    const db = window.HK_MOCK._loadDB();
    const row = db.notification_prefs.find((r) => r.user_id === window.__huskis.authUser.id);
    return { aria: el.getAttribute('aria-checked'), lagret: row ? row.due_soon : null,
      drag: el.style.getPropertyValue('--knob-drag').trim(),
      klasse: el.classList.contains('is-tog-drag') };
  }, bryter);
  // Bryteren står PÅ som standard, så et drag mot høyre lander der den alt er:
  // det er nettopp poenget med å måle begge retninger.
  const brøkB = parseFloat(midtB && midtB.verdi);
  log(label + ' 4: knotten følger fingeren under draget, i en BRØKDEL av vandringen',
    !!midtB && midtB.klasse === true && brøkB >= 0 && brøkB <= 1, JSON.stringify(midtB));
  const midtB2 = await dragToggle(p, bryter, 0.9, 0.1, { midtveisVar: '--knob-drag' });
  const av = await p.evaluate((s) => {
    const el = document.querySelector(s);
    const db = window.HK_MOCK._loadDB();
    const row = db.notification_prefs.find((r) => r.user_id === window.__huskis.authUser.id);
    return { aria: el.getAttribute('aria-checked'), lagret: row ? row.due_soon : null,
      drag: el.style.getPropertyValue('--knob-drag').trim(),
      klasse: el.classList.contains('is-tog-drag') };
  }, bryter);
  log(label + ' 4: et drag mot venstre slår bryteren AV, og valget lagres på kontoen',
    før === 'true' && av.aria === 'false' && av.lagret === false,
    JSON.stringify({ før: før, etterHøyre: etterB.aria, etterVenstre: av }));
  log(label + ' 6: draget teller ÉN gang — ingen overstyring og ingen tilbakeslag',
    av.drag === '' && av.klasse === false && !!midtB2, JSON.stringify(av));

  /* ---------- 5) … og et klikk på av/på virker fortsatt ---------- */
  await p.click(bryter);
  await p.waitForTimeout(500);
  const klikket = await p.evaluate((s) => document.querySelector(s).getAttribute('aria-checked'), bryter);
  log(label + ' 5: et vanlig klikk slår bryteren på igjen', klikket === 'true', String(klikket));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  /* ---------- 8) Tidshorisonten er den SAMME bryteren ----------
     «Kommende hendelser» hadde sin egen kontroll som lignet: grå markering i
     stedet for den grønne flaten, og ingen gest. En bryter som ser ut som de
     andre, men verken bærer markeringen eller lar seg dra, leser som den samme
     kontrollen i ustand. Den er nå `.seg`, og arver derfor begge deler
     (docs/kommende-hendelser.md). Semantikken er fortsatt radiogruppens:
     `paintSeg` melder `aria-checked` her, `aria-selected` der bruksstedet er en
     fane-rekke. */
  await p.evaluate(() => window.__huskis.openEventsModal());
  await p.waitForSelector('#events-modal:not([hidden])');
  await p.waitForTimeout(300);
  const horisontFør = await p.evaluate(() => window.__huskis.eventsHorizon());
  const form = await p.evaluate(() => {
    const el = document.getElementById('events-horizon');
    const på = el.querySelector('.events-horizon-btn[aria-checked="true"]');
    return {
      seg: el.classList.contains('seg'),
      segBtn: [...el.children].every((b) => b.classList.contains('seg-btn')),
      // Markeringen er ÉN flate på beholderen, og den er den grønne.
      flate: getComputedStyle(el, '::before').backgroundImage,
      // Radiogruppen melder `aria-checked`, ikke `aria-selected`.
      aria: !!på && !på.hasAttribute('aria-selected'),
      aktiv: !!på && på.classList.contains('is-active'),
    };
  });
  log(label + ' 8: tidshorisonten er `.seg` med den grønne, glidende flaten',
    form.seg && form.segBtn && /gradient/.test(form.flate) && form.aktiv,
    JSON.stringify(form));
  log(label + ' 8: … og melder fortsatt radiogruppens `aria-checked`', form.aria,
    JSON.stringify(form));
  const midtH = await dragToggle(p, '#events-horizon', 0.85, 0.16, { midtveisVar: '--seg-drag' });
  const horisontEtter = await p.evaluate(() => ({
    valgt: window.__huskis.eventsHorizon(),
    aria: [...document.querySelectorAll('.events-horizon-btn')]
      .map((b) => b.dataset.horizon + '=' + b.getAttribute('aria-checked')),
    drag: document.getElementById('events-horizon').style.getPropertyValue('--seg-drag').trim(),
  }));
  const brøkH = parseFloat(midtH && midtH.verdi);
  log(label + ' 8: et drag bytter tidshorisont, og flaten følger fingeren underveis',
    horisontFør === 'all' && horisontEtter.valgt === 'week' &&
    !!midtH && midtH.klasse === true && brøkH > 0 && brøkH < 2.001,
    JSON.stringify({ før: horisontFør, etter: horisontEtter, midtveis: midtH }));
  log(label + ' 8: … og overstyringen er borte ved slipp, med `aria-checked` flyttet',
    horisontEtter.drag === '' &&
    horisontEtter.aria.join(',') === 'week=true,month=false,all=false',
    JSON.stringify(horisontEtter));
  await p.evaluate(() => window.__huskis.closeEventsModal());
  await p.waitForTimeout(250);

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
