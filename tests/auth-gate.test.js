/*
  Regresjonstest: INNLOGGINGSMUREN VED OPPSTART.

  Appen har ingen anonym modus (docs/accounts.md): den som ikke er innlogget
  skal ALDRI se noe annet enn innloggingsskjermen. Det gjelder også glimtet
  mellom første maling og at app.js er ferdig lastet — fila er over 1 MB, så
  på en treg linje er det glimtet langt nok til å lese toppmenyen i.

  Gaten er `body.no-auth` (regelen i styles.css skjuler .topbar, .app-main og
  .corner-controls), og den står i markupen fra første maling i stedet for å
  bli satt av `initAccounts()`. Stilarket lastes i <head> og er dermed på plass
  før noe males; app.js er det ikke. Gaten feiler LUKKET: bare `cloudStart()`
  — som kjører med en innlogget bruker — fjerner klassen.

  Dekker:
     1. Markupen: <body> i index.html har klassen, så gaten er lukket i kilden
        og ikke bare når JS-en rekker fram.
     2. Før app.js har kjørt: verken toppmeny, board eller hjørnekontroller er
        malt, og ingen piksel i viewportet tilhører appen (rutenettprøve med
        elementFromPoint — «hva ville et klikk her truffet?»).
     3. Uten sesjon, etter at app.js har kjørt: innloggingsskjermen er den
        eneste flaten, app-innholdet er fortsatt skjult.
     4. Treg sesjonshenting (`?authlag=`, samme tilfelle som en kaldstart
        offline med et token nær utløp): gaten holder HELE veien til sesjonen
        er på plass — appen vises aldri «i påvente av» et svar.
     5. Innlogget: gaten åpnes — den er ikke låst for godt.
     6. Utlogging lukker gaten igjen.

  Kjøres på både desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/auth-gate.test.js
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const ROOT = path.join(__dirname, '..');

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

/* Hvor lenge app.js holdes tilbake i sjekk 2. Den skal være romslig lengre enn
   prøvetidspunktet: poenget er å måle tilstanden FØR JS-en har kjørt, og en
   knapp margin ville gjort testen til en tidsmåling i stedet for en invariant.
   Sjekk 2a slår uansett fast at fila faktisk ikke hadde kjørt. */
const APP_JS_HOLD_MS = 6000;
const PROBE_MS = 900;

/* Appens tilstand sett utenfra: hva er malt, og hva ville et klikk truffet?
   Rutenettet er testens egentlige spørsmål — «er det noe som helst av appen på
   skjermen?» — og det stiller det uten å måtte kjenne hvert enkelt element:
   ethvert element som ligger over bakgrunnen dukker opp her, også et som blir
   lagt til senere uten å bli tenkt på i denne fila. */
const probe = () => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'mangler';
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0)
      ? 'SYNLIG ' + Math.round(r.width) + 'x' + Math.round(r.height) : 'skjult';
  };
  // 7×7 punkter jevnt fordelt, med innrykk fra kantene så prøven ikke lander
  // utenfor viewportet (elementFromPoint svarer null der).
  const auth = document.getElementById('auth-screen');
  const traff = [], utenforAuth = [];
  for (let i = 1; i <= 7; i++) {
    for (let j = 1; j <= 7; j++) {
      const el = document.elementFromPoint(
        Math.round(innerWidth * i / 8), Math.round(innerHeight * j / 8));
      if (!el || el === document.body || el === document.documentElement) continue;
      const navn = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + (el.className || ''));
      traff.push(navn);
      // Innloggingsskjermen OG alt inni den er det ene som har lov til å ligge
      // over bakgrunnen før man er innlogget. Resten er appen.
      if (!auth || !auth.contains(el)) utenforAuth.push(navn);
    }
  }
  return {
    appJsRan: typeof window.__huskis !== 'undefined',
    noAuth: document.body.classList.contains('no-auth'),
    topbar: vis('.topbar'), appMain: vis('.app-main'), corner: vis('#corner-controls'),
    authScreen: vis('#auth-screen'),
    traff: [...new Set(traff)], utenforAuth: [...new Set(utenforAuth)],
  };
};
// Alt appen viser BAK muren.
const bakMuren = (s) => [s.topbar, s.appMain, s.corner].join(' | ');

async function register(p) {
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
  // Introduksjonen legger seg over appen for enhver ny konto (docs/introduksjon.md).
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
  return email;
}

async function run(label, viewport) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  /* ---------- 2) Før app.js har kjørt ----------
     app.js holdes tilbake på nettverket: nøyaktig det som skjer på en treg
     linje, der HTML og stilark er framme lenge før den 1 MB store fila.
     Holdet får sin EGEN side, som lukkes etterpå — ellers ville den ventende
     forespørselen fulgt med inn i resten av testen. */
  const pBoot = await ctx.newPage();
  await pBoot.route('**/app.js', async (route) => {
    await new Promise((r) => setTimeout(r, APP_JS_HOLD_MS));
    try { await route.continue(); } catch (e) { /* siden er lukket — holdet er over */ }
  });
  pBoot.goto(BASE + '/?mock=1', { waitUntil: 'commit' }).catch(() => {});
  await pBoot.waitForTimeout(PROBE_MS);
  const boot = await pBoot.evaluate(probe);
  log(label + ' 2a: målingen er gjort FØR app.js rakk å kjøre', !boot.appJsRan,
    'app.js holdt tilbake ' + APP_JS_HOLD_MS + ' ms, målt ved ' + PROBE_MS + ' ms');
  log(label + ' 2b: gaten står lukket allerede ved første maling', boot.noAuth,
    'body.no-auth = ' + boot.noAuth);
  log(label + ' 2c: verken toppmeny, board eller hjørnekontroller er malt',
    boot.topbar === 'skjult' && boot.appMain === 'skjult' && boot.corner === 'skjult',
    bakMuren(boot));
  log(label + ' 2d: ingen piksel i viewportet tilhører appen',
    boot.utenforAuth.length === 0, JSON.stringify(boot.traff));

  /* ---------- 3) Uten sesjon, etter at app.js har kjørt ---------- */
  await pBoot.close();
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(BASE + '/?mock=1');
  await p.waitForSelector('#auth-screen:not([hidden])', { timeout: 15000 });
  const utlogget = await p.evaluate(probe);
  log(label + ' 3a: innloggingsskjermen er framme', /^SYNLIG/.test(utlogget.authScreen),
    utlogget.authScreen);
  log(label + ' 3b: app-innholdet er fortsatt skjult',
    utlogget.noAuth && utlogget.topbar === 'skjult' && utlogget.appMain === 'skjult'
    && utlogget.corner === 'skjult', bakMuren(utlogget));
  log(label + ' 3c: innloggingsskjermen er det ENESTE som ligger over bakgrunnen',
    utlogget.utenforAuth.length === 0, JSON.stringify(utlogget.traff));

  /* ---------- 5) Innlogget: gaten åpnes ---------- */
  await register(p);
  const inne = await p.evaluate(probe);
  log(label + ' 5: innlogget åpnes gaten (app-innholdet vises)',
    !inne.noAuth && /^SYNLIG/.test(inne.topbar) && /^SYNLIG/.test(inne.appMain)
    && /^SYNLIG/.test(inne.corner) && inne.authScreen === 'skjult', bakMuren(inne));

  /* ---------- 4) Treg sesjonshenting: gaten holder hele veien ----------
     Sesjonen ligger i fanen fra innloggingen over; `?authlag=` forsinker BEGGE
     veiene mocken leverer den (getSession + INITIAL_SESSION), slik supabase-js
     gjør offline med et token nær utløp. Appen skal ikke vises før svaret er
     der — den vet ennå ikke hvem som er innlogget. */
  const LAG = 2500;
  await p.goto(BASE + '/?mock=1&authlag=' + LAG, { waitUntil: 'commit' });
  let holdt = true;
  const prøver = [];
  for (let i = 0; i < 5; i++) {
    await p.waitForTimeout(Math.round(LAG / 6));
    const s = await p.evaluate(probe);
    prøver.push(bakMuren(s));
    if (!s.noAuth || s.utenforAuth.length) holdt = false;
  }
  log(label + ' 4a: gaten holder mens sesjonen hentes', holdt, prøver.join(' ; '));
  await p.waitForFunction(() => window.__huskis && window.__huskis.authUser,
    null, { timeout: 20000, polling: 100 });
  await p.waitForFunction(() => !document.body.classList.contains('no-auth'),
    null, { timeout: 10000, polling: 100 });
  const etterLag = await p.evaluate(probe);
  log(label + ' 4b: … og åpnes når sesjonen er på plass',
    !etterLag.noAuth && /^SYNLIG/.test(etterLag.topbar), bakMuren(etterLag));

  /* ---------- 6) Utlogging lukker gaten igjen ---------- */
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.evaluate(() => window.__huskis.openAccount());
  await p.click('#acc-session-head');
  await p.click('#logout-btn');
  await p.waitForSelector('#confirm-modal:not([hidden]) #confirm-ok', { timeout: 5000 });
  await p.click('#confirm-modal #confirm-ok');
  await p.waitForFunction(() => !window.__huskis.authUser, null, { timeout: 15000, polling: 100 });
  await p.waitForTimeout(300);
  const ute = await p.evaluate(probe);
  log(label + ' 6a: gaten er lukket igjen etter utlogging',
    ute.noAuth && ute.topbar === 'skjult' && ute.appMain === 'skjult'
    && ute.corner === 'skjult', bakMuren(ute));
  log(label + ' 6b: … og innloggingsskjermen er det eneste som står igjen',
    /^SYNLIG/.test(ute.authScreen) && ute.utenforAuth.length === 0,
    ute.authScreen + ' / ' + JSON.stringify(ute.traff));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  /* ---------- 1) Markupen (ingen nettleser: gaten skal stå i KILDEN) ---------- */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // Taggen står i venstremargen; nevnes <body> i en kommentar er den innrykket.
  const bodyTag = (/^<body[^>]*>/mi.exec(html) || [''])[0];
  log('1a: <body> i index.html bærer `no-auth`',
    /\bclass\s*=\s*"[^"]*\bno-auth\b/i.test(bodyTag), bodyTag || 'fant ingen <body>-tagg');
  // Regelen som gjør klassen til noe: uten den er klassen bare et navn.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const regel = /body\.no-auth\s+\.topbar,\s*body\.no-auth\s+\.app-main,\s*body\.no-auth\s+\.corner-controls\s*\{\s*display:\s*none;?\s*\}/
    .test(css);
  log('1b: styles.css skjuler toppmeny, board og hjørnekontroller for klassen', regel);

  await run('desktop', { width: 1200, height: 900 });
  await run('mobil', { width: 390, height: 780 });
  const pass = results.filter(Boolean).length;
  console.log('\n==== ' + pass + '/' + results.length + ' PASS ====');
  process.exit(pass === results.length ? 0 : 1);
})();
