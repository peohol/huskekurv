/*
  Test for KANONISK ORIGIN: https://huskis.no er den eneste adressen appen
  kjører på. www.huskis.no og huskis.vercel.app (og det pensjonerte
  huskekurv.vercel.app) svarer permanent redirect dit — med path, query og
  fragment i behold.

  To lag verifiseres, fordi de dekker hver sin situasjon:

    A) vercel.json — HTTP 308 på kanten, altså FØR noe av appen lastes. Dette
       er den virkelige mekanismen i produksjon. Ren fillesing (Vercels
       `has: host`-regler kan ikke kjøres lokalt).
    B) Guarden øverst i index.html — for en fane som allerede var lastet fra et
       alternativt domene (bfcache, en HTML-kopi i cache) og som derfor aldri
       møter 308-en. Kjøres i ekte nettleser.

  Verifiserer:
    1. vercel.json har én 308-regel per alternativt domene, med hele pathen
       bevart (`/:path*` → `https://huskis.no/:path*`) — og ingen regel som
       redirecter huskis.no selv eller preview-deployenes egne verter.
       Reglene KANONISERER, og gjør ingenting annet: hver av dem flytter hele
       `/:path*` til det kanoniske originet med pathen i behold — ingen
       plukker ut én enkelt path, ingen lander på et fremmed origin, og ingen
       kaster bort adressen brukeren ba om.
    2. Guarden i index.html står FØR alt som kjører (config.js, app.js,
       mock-backenden, update-check.js) — redirecten skal skje før appen,
       en service worker eller lokal tilstand initialiseres.
    3. Hostene guarden dekker er en delmengde av dem vercel.json redirecter
       (de to lagene kan ikke komme i utakt).
    4. redirectUrlFor() i ekte nettleser: alternative domener → kanonisk URL
       med path + query + fragment bevart (auth-parametere kommer i begge:
       `?code=` for PKCE, `#access_token=…&type=recovery` for implicit);
       kanonisk origin, localhost (både utviklingsserveren og mobilappens
       WebView-origin `https://localhost`) og ukjente verter → null (ingen
       redirect).
    5. Ekte navigasjon: en side lastet fra https://www.huskis.no/… havner på
       https://huskis.no/… med path/query/fragment i behold, uten å legge igjen
       en historikk-oppføring (location.replace), og uten at app.js kjørte på
       det alternative domenet.

  Nettleserdelen er ren logikk uten layout-avhengighet → én viewport.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/canonical-origin.test.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const CANONICAL = 'https://huskis.no';

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

/* ================= A) vercel.json — 308 på kanten ================= */
const vercelCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const redirects = Array.isArray(vercelCfg.redirects) ? vercelCfg.redirects : [];

// Hostene hver regel gjelder for, slik Vercel matcher dem: alle `has`-vilkår
// må slå til samtidig, så en regel med ett host-vilkår gjelder nøyaktig én host.
function ruleHost(rule) {
  const has = Array.isArray(rule.has) ? rule.has : [];
  const hosts = has.filter((h) => h && h.type === 'host').map((h) => h.value);
  return has.length === 1 && hosts.length === 1 ? hosts[0] : null;
}
const byHost = new Map();
for (const r of redirects) {
  const h = ruleHost(r);
  if (h) byHost.set(h, r);
}

const REDIRECTED_HOSTS = ['www.huskis.no', 'huskis.vercel.app', 'huskekurv.vercel.app'];
for (const host of REDIRECTED_HOSTS) {
  const rule = byHost.get(host);
  check('vercel.json: ' + host + ' har en egen redirect-regel', !!rule, [...byHost.keys()]);
  if (!rule) continue;
  check('vercel.json: ' + host + ' svarer 308 (permanent, metode og kropp beholdt)',
    rule.statusCode === 308, { statusCode: rule.statusCode, permanent: rule.permanent });
  check('vercel.json: ' + host + ' matcher hele pathen', rule.source === '/:path*', rule.source);
  check('vercel.json: ' + host + ' → ' + CANONICAL + ' med pathen i behold',
    rule.destination === CANONICAL + '/:path*', rule.destination);
  // Query strings videreføres automatisk av Vercel så lenge destinasjonen ikke
  // selv har en query — en «?…» her ville slukt brukerens parametere.
  check('vercel.json: ' + host + ' sin destinasjon har ingen egen query (parametere bevares)',
    rule.destination.indexOf('?') === -1, rule.destination);
}

check('vercel.json: ingen regel redirecter huskis.no selv (evig løkke)',
  !byHost.has('huskis.no'), [...byHost.keys()]);
check('vercel.json: preview-deployenes egne verter er urørt',
  ![...byHost.keys()].some((h) => /-peohols-projects\.vercel\.app$/.test(h)), [...byHost.keys()]);
check('vercel.json: hver redirect-regel er bundet til nøyaktig én host',
  redirects.every((r) => ruleHost(r) !== null), redirects.map((r) => r.has));

/* REDIRECTENE KANONISERER, OG GJØR INGENTING ANNET.

   Løkken over sjekker de tre hostene ved navn. Disse to sjekkene er den
   GENERISKE regelen som også dekker en regel ingen har skrevet ennå: hver
   regel flytter HELE pathen fra én alternativ host til det kanoniske
   originet. Ingen regel plukker ut én enkelt path, og ingen regel sender
   trafikken videre til et fremmed origin.

   En path-spesifikk videresending UT av Huskis er nettopp det som ikke skal
   snike seg inn: da er adressen brukeren ser Huskis' egen, mens siden som
   svarer er en annens — og `huskis.no` blir inngangsdør for noe Huskis ikke
   eier, kontrollerer eller kan rette. Det som trenger sin egen adresse, skal
   ha sin egen adresse.

   Destinasjonen sammenlignes HELT, ikke bare på originet: `https://huskis.no/
   login` ligger på riktig origin og kaster likevel bort hver adresse brukeren
   ba om. En ny host som slipper unna løkken over — den sjekker de tre ved
   navn — må derfor fortsatt gjennom denne. */
check('vercel.json: ingen regel plukker ut én enkelt path (alle flytter hele `/:path*`)',
  redirects.every((r) => r.source === '/:path*'), redirects.map((r) => r.source));
check('vercel.json: hver regel lander på ' + CANONICAL + ' med pathen i behold '
  + '(aldri et fremmed origin, aldri en fast path)',
  redirects.every((r) => r.destination === CANONICAL + '/:path*'),
  redirects.map((r) => r.destination));

/* ================= B) Guarden i index.html ================= */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const guardAt = html.indexOf('__huskisCanonical');
check('index.html: guarden finnes', guardAt > -1);
// Alt annet som KJØRER må komme etter den. (Tegnsett-erklæringen står foran —
// den er en parser-direktiv, ikke kode, og må ligge i de første 1024 bytene.)
for (const later of ['config.js', 'app.js', 'icons.js', 'dev-mock.js', 'update-check.js', 'styles.css']) {
  const at = html.indexOf('"' + later + '"');  // selve taggen, ikke navnet i en kommentar
  check('index.html: guarden står før ' + later, at > -1 && guardAt < at, { guardAt, at });
}
const firstScript = html.indexOf('<script');
const secondScript = html.indexOf('<script', firstScript + 1);
check('index.html: guarden ER dokumentets første <script>',
  firstScript > -1 && guardAt > firstScript && guardAt < secondScript,
  { firstScript, guardAt, secondScript });
check('index.html: <meta charset> ligger innenfor de første 1024 bytene',
  html.indexOf('<meta charset') > -1 && html.indexOf('<meta charset') < 1024,
  html.indexOf('<meta charset'));
// index.html står i ALLOWLIST i tests/no-legacy-domain.test.js fordi guardens
// hostliste MÅ navngi det pensjonerte domenet. Den fritagelsen skal ikke gi
// resten av fila fritt leide: navnet får kun stå inne i guarden — som
// redirect-KILDE, aldri som en lenke i markupen.
const guardEnd = html.indexOf('</script>', firstScript);
const legacyAt = [];
for (let i = html.toLowerCase().indexOf('huskekurv'); i > -1; i = html.toLowerCase().indexOf('huskekurv', i + 1)) legacyAt.push(i);
check('index.html: det pensjonerte domenet nevnes KUN inne i guarden',
  legacyAt.length > 0 && legacyAt.every((i) => i > firstScript && i < guardEnd),
  { treff: legacyAt, guard: [firstScript, guardEnd] });
check('index.html: guardens hostliste inneholder det pensjonerte domenet',
  /REDIRECT_HOSTS\s*=\s*\[[^\]]*huskekurv\.vercel\.app/.test(html));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => window.__huskisCanonical && typeof window.__huskisCanonical.redirectUrlFor === 'function');

  // ---------- 3) De to lagene navngir de samme domenene ----------
  // De to lagene skal dekke NØYAKTIG de samme hostene: en host bare på kanten
  // slipper unna i en fane som aldri møter 308-en, og en host bare i guarden
  // ville vært en redirect vi ikke faktisk har.
  const guardHosts = await page.evaluate(() => window.__huskisCanonical.redirectHosts);
  const edgeHosts = [...byHost.keys()];
  check('guarden og vercel.json dekker nøyaktig de samme hostene',
    Array.isArray(guardHosts) && guardHosts.length === edgeHosts.length &&
    edgeHosts.every((h) => guardHosts.includes(h)),
    { guardHosts, edgeHosts });
  check('begge lagene dekker de alternative produksjonsdomenene',
    Array.isArray(guardHosts) &&
    ['www.huskis.no', 'huskis.vercel.app'].every((h) => guardHosts.includes(h) && byHost.has(h)),
    guardHosts);
  const guardOrigin = await page.evaluate(() => window.__huskisCanonical.origin);
  check('guardens kanoniske origin === ' + CANONICAL, guardOrigin === CANONICAL, guardOrigin);

  // ---------- 4) redirectUrlFor(): path, query og fragment bevares ----------
  const table = [
    // [inn, forventet ut]  — null = ingen redirect
    ['https://www.huskis.no/', CANONICAL + '/'],
    ['https://huskis.vercel.app/', CANONICAL + '/'],
    ['https://www.huskis.no/index.html', CANONICAL + '/index.html'],
    // det pensjonerte domenet: en fane som fortsatt kjører der skal også hjem
    ['https://huskekurv.vercel.app/?code=abc', CANONICAL + '/?code=abc'],
    // path + query
    ['https://www.huskis.no/en/under/side?a=1&b=to%20ord',
      CANONICAL + '/en/under/side?a=1&b=to%20ord'],
    // auth-callback, PKCE: ?code= i query
    ['https://www.huskis.no/?code=abc123&type=signup', CANONICAL + '/?code=abc123&type=signup'],
    // auth-callback, implicit: tokens i fragmentet
    ['https://www.huskis.no/#access_token=xyz&refresh_token=r&type=recovery',
      CANONICAL + '/#access_token=xyz&refresh_token=r&type=recovery'],
    // begge deler samtidig, på en underside
    ['https://huskis.vercel.app/liste?signup=a%40b.no#access_token=t',
      CANONICAL + '/liste?signup=a%40b.no#access_token=t'],
    // versal host — nettleseren normaliserer, men regelen skal ikke være case-følsom
    ['https://WWW.HUSKIS.NO/x?y=1', CANONICAL + '/x?y=1'],
    // allerede kanonisk → ingen redirect (ingen løkke)
    [CANONICAL + '/', null],
    [CANONICAL + '/x?y=1#z', null],
    // lokal utvikling og preview-deployer skal ALDRI flyttes
    ['http://localhost:8000/?mock=1', null],
    ['http://127.0.0.1:5500/', null],
    // Mobilappens WebView-origin (docs/mobilapp-plan.md). En redirect herfra
    // ville tatt appen ut av sine egne innebygde filer og over på nett — og
    // dermed gjort butikkbinæren meningsløs første gang telefonen er offline.
    ['https://localhost/', null],
    ['https://localhost/?code=abc123', null],
    ['http://localhost/', null],
    ['https://huskis-qiq3qh44v-peohols-projects.vercel.app/?mock=1', null],
    // ukjent host: fail closed betyr «rør den ikke» — vi eier den ikke
    ['https://en-helt-ukjent-host.example/', null],
    // ikke en URL i det hele tatt
    ['tull', null],
  ];
  for (const [href, want] of table) {
    const got = await page.evaluate((h) => window.__huskisCanonical.redirectUrlFor(h), href);
    check('redirectUrlFor(' + href + ') === ' + want, got === want, got);
  }
  check('ingen ukontrollerte JS-feil på siden', pageErrors.length === 0, pageErrors);

  // ---------- 5) Ekte navigasjon fra det alternative domenet ----------
  // Produksjonens 308 ligger på Vercels kant og kan ikke kjøres lokalt, så her
  // serveres begge domenene fra den lokale serveren og vi ser hvor nettleseren
  // FAKTISK ender opp når guarden er det eneste som flytter den. Appens egne
  // adresser (undersider uten filendelse) svarer index.html, slik
  // produksjonsoriginet ville gjort.
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx2.route(/^https:\/\/(www\.huskis\.no|huskis\.no)\//, async (route) => {
    const u = new URL(route.request().url());
    const local = /\.[a-z0-9]+$/i.test(u.pathname) ? u.pathname : '/index.html';
    const res = await route.fetch({ url: BASE + local + u.search });
    await route.fulfill({ response: res });
  });
  const page2 = await ctx2.newPage();

  const from = 'https://www.huskis.no/en/under/side?mock=1&a=1&b=to%20ord#access_token=tok';
  await page2.goto(from);
  await page2.waitForURL(/^https:\/\/huskis\.no\//, { timeout: 10000 }).catch(() => {});
  const landed = page2.url();
  check('navigasjon: www.huskis.no/… havner på huskis.no med path, query og fragment i behold',
    landed === CANONICAL + '/en/under/side?mock=1&a=1&b=to%20ord#access_token=tok', landed);
  await page2.goBack().catch(() => {});
  check('navigasjon: det alternative domenet ble ikke lagt i historikken (location.replace)',
    !/www\.huskis\.no/.test(page2.url()), page2.url());

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
