/*
  Test for SIKKERHETSHEADERNE — innholdssikkerhetspolicyen (CSP) og de fire
  øvrige headerne, den låste Supabase-versjonen og at testmodusen ikke finnes i
  produksjonsbygget. Ingen nettleser: ren lesing av index.html, vercel.json og
  config.js, pluss én ekte build. Selve håndhevingen i nettleser dekkes av at
  meta-taggen ligger i index.html, som ALLE nettlesertestene laster.

  Autoritativ beskrivelse av policyen og hvert unntak: docs/sikkerhetsheadere.md.

  Verifiserer:
    1. vercel.json setter CSP, X-Content-Type-Options, Referrer-Policy,
       Permissions-Policy og X-Frame-Options på ALLE adresser.
    2. Policyen er restriktiv: default-src 'none', ingen 'unsafe-inline',
       'unsafe-eval', 'strict-dynamic' eller `*`; base-uri/object-src låst.
    3. Framing er umulig: frame-ancestors 'none' (+ X-Frame-Options DENY).
    4. Meta-taggen i index.html og headeren i vercel.json er NØYAKTIG samme
       policy, bortsett fra frame-ancestors, som kun virker som header. (De to
       lagene kan ikke komme i utakt: den lokale serveren sender ingen headere,
       så meta-taggen er det testene og utviklingsmiljøet faktisk kjører under.)
    5. Hash-en i script-src er hash-en av den ENE inline-blokken i index.html —
       regnet ut på nytt her, så guarden ikke kan endres uten at policyen følger
       med.
    6. Ingen andre inline-kilder: ingen flere <script> uten src, ingen on*=,
       ingen style=/<style> (som ellers ville krevd 'unsafe-inline').
    7. connect-src dekker Supabase-prosjektet i config.js — både https og wss
       (realtime) — pluss det kanoniske originet fra samme fil, som er
       OTA-manifestets vert inne i APK-en (der 'self' er https://localhost —
       docs/mobilapp-plan.md, fase 5). Ingen andre verter; drift mellom
       config.js og policyen stopper her.
    8. Supabase-biblioteket ligger i repoet (`vendor/`), på en EKSAKT versjon i
       filnavnet, og innholdet er byte for byte det npm publiserte — sjekksummen
       her regnes ut på nytt fra fila. Appen har ingen eksterne skriptkilder i
       det hele tatt, og produksjonsbygget publiserer kopien.
    9. Webfonten er selvhostet på samme måte: @font-face i styles.css peker på
       innsjekkede filer i assets/fonts/, sjekksummene regnes ut på nytt,
       index.html laster ikke et eneste stilark eller preconnect fra en fremmed
       vert, og produksjonsbygget publiserer fontfilene.
   10. Testmodusen finnes ikke i produksjonsbygget: verken dev-mock.js,
       mock-backend.js eller taggen som laster dem — og build.js sier tydelig
       fra hvis markørene forsvinner. Preview-deployer (VERCEL_ENV=preview)
       BEHOLDER den, fordi ?mock=1 er måten å teste en preview uten å røre
       ekte data på (docs/release-og-deploy.md).

  Kjør:
    node tests/security-headers.test.js
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

/* ---------- Hjelpere ---------- */
// Én policy → { direktiv: [kilder] }. Whitespace er vilkårlig i CSP, og
// meta-taggen er brutt over flere linjer for å være lesbar.
function parseCsp(value) {
  const out = {};
  String(value).split(';').forEach((part) => {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) return;
    out[bits[0].toLowerCase()] = bits.slice(1);
  });
  return out;
}
function cspText(map) {
  return Object.keys(map).sort().map((k) => k + ' ' + map[k].join(' ')).join('; ');
}

/* ================= 1) Headerne i vercel.json ================= */
// Vercel slår sammen alle reglene som matcher, så catch-all-regelen er den som
// gir hver eneste respons (HTML, JS, CSS, version.json) headerne under.
const CATCH_ALL = '/(.*)';
const allRule = (vercel.headers || []).find((h) => h.source === CATCH_ALL);
check('vercel.json har en headerregel for alle adresser (' + CATCH_ALL + ')', !!allRule,
  (vercel.headers || []).map((h) => h.source));

const hdr = {};
((allRule && allRule.headers) || []).forEach((h) => { hdr[h.key] = h.value; });

check('X-Content-Type-Options: nosniff', hdr['X-Content-Type-Options'] === 'nosniff', hdr['X-Content-Type-Options']);
check('Referrer-Policy er satt og lekker ikke adresser på tvers av origin',
  ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin']
    .indexOf(hdr['Referrer-Policy']) > -1, hdr['Referrer-Policy']);
check('X-Frame-Options: DENY (for nettlesere uten frame-ancestors)',
  hdr['X-Frame-Options'] === 'DENY', hdr['X-Frame-Options']);

const pp = hdr['Permissions-Policy'] || '';
check('Permissions-Policy er satt', pp.length > 0);
// Appen ber aldri om noen av disse. Alt som er nevnt skal være slått HELT av
// — `()` er en tom allowlist; `(self)` ville fortsatt gitt appen tilgang.
['camera', 'microphone', 'geolocation', 'payment', 'usb', 'midi', 'magnetometer',
  'gyroscope', 'accelerometer', 'display-capture'].forEach((f) => {
  check('Permissions-Policy slår av ' + f, new RegExp('(^|,\\s*)' + f + '=\\(\\)').test(pp), pp);
});
check('Permissions-Policy gir ingen funksjon en ikke-tom allowlist',
  !/=\(\s*[^)\s]/.test(pp), pp);

/* ================= 2–3) Policyen er restriktiv ================= */
const headerCspRaw = hdr['Content-Security-Policy'] || '';
check('vercel.json setter Content-Security-Policy', headerCspRaw.length > 0);
const headerCsp = parseCsp(headerCspRaw);

check("default-src 'none' (alt som ikke er nevnt er blokkert)",
  String(headerCsp['default-src']) === "'none'", headerCsp['default-src']);
check("base-uri 'none' (ingen injisert <base> kan flytte relative URL-er)",
  String(headerCsp['base-uri']) === "'none'", headerCsp['base-uri']);
check("object-src 'none'", String(headerCsp['object-src']) === "'none'", headerCsp['object-src']);
check("frame-ancestors 'none' (siden kan ikke rammes inn)",
  String(headerCsp['frame-ancestors']) === "'none'", headerCsp['frame-ancestors']);
check('form-action er låst til eget origin',
  String(headerCsp['form-action']) === "'self'", headerCsp['form-action']);

const allSources = Object.keys(headerCsp).reduce((a, k) => a.concat(headerCsp[k]), []);
["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", '*', 'data:', 'http:', 'https:']
  .forEach((bad) => {
    // data: er tillatt i img-src (avatarene), men ingen andre steder.
    const where = Object.keys(headerCsp).filter((k) => headerCsp[k].indexOf(bad) > -1);
    const ok = bad === 'data:' ? where.every((k) => k === 'img-src') : where.length === 0;
    check('ingen ' + bad + ' i policyen' + (bad === 'data:' ? ' utenfor img-src' : ''), ok, where);
  });
check('script-src er egen direktiv (arver ikke default-src)', !!headerCsp['script-src']);
check('img-src tillater data: og blob: (avatarbilder), men ikke fremmede verter',
  (headerCsp['img-src'] || []).slice().sort().join(' ') === "'self' blob: data:",
  headerCsp['img-src']);

/* ================= 4) Meta-taggen === headeren ================= */
const metaMatch = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*\/?>/.exec(html);
check('index.html har CSP-meta-taggen', !!metaMatch);
const metaCsp = parseCsp(metaMatch ? metaMatch[1] : '');

check('CSP-meta-taggen står før den første <script> (dekker også guarden)',
  !!metaMatch && html.indexOf(metaMatch[0]) < html.indexOf('<script'),
  { meta: html.indexOf(metaMatch ? metaMatch[0] : ''), script: html.indexOf('<script') });
check('meta-taggen dropper frame-ancestors (virker kun som HTTP-header)',
  !metaCsp['frame-ancestors'], metaCsp['frame-ancestors']);

const headerWithoutFrame = Object.assign({}, headerCsp);
delete headerWithoutFrame['frame-ancestors'];
check('meta-taggen og vercel.json-headeren er samme policy',
  cspText(headerWithoutFrame) === cspText(metaCsp),
  { header: cspText(headerWithoutFrame), meta: cspText(metaCsp) });

/* ================= 5–6) Inline-kildene ================= */
// Alle <script>-blokker uten src. Guarden for kanonisk origin er den eneste
// som skal finnes; hash-en i policyen regnes ut på nytt fra fila her.
const inline = [];
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
for (let m = scriptRe.exec(html); m; m = scriptRe.exec(html)) {
  if (!/\bsrc\s*=/.test(m[1] || '')) inline.push(m[2]);
}
check('index.html har nøyaktig én inline-<script> (guarden for kanonisk origin)',
  inline.length === 1, inline.length);
const guardHash = inline.length === 1
  ? "'sha256-" + crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64') + "'"
  : null;
check('script-src inneholder hash-en av guarden slik den står i index.html',
  !!guardHash && (headerCsp['script-src'] || []).indexOf(guardHash) > -1,
  { regnet: guardHash, iPolicyen: headerCsp['script-src'] });
check('script-src har ingen hash-er utover den ene guarden',
  (headerCsp['script-src'] || []).filter((s) => /^'sha(256|384|512)-/.test(s)).length === 1,
  headerCsp['script-src']);
check("script-src tillater egne filer ('self')",
  (headerCsp['script-src'] || []).indexOf("'self'") > -1, headerCsp['script-src']);

// Alt annet inline ville krevd 'unsafe-inline' og dermed hullet policyen.
check('ingen inline hendelseshåndterere (on…=) i index.html',
  !/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<!--[\s\S]*?-->/g, '')),
  (html.replace(/<!--[\s\S]*?-->/g, '').match(/\son[a-z]+\s*=\s*["']/ig) || []).slice(0, 5));
check('ingen <style>-blokk eller style="…" i index.html',
  !/<style[\s>]/i.test(html) && !/\sstyle\s*=\s*["']/i.test(html));

/* ================= 7) connect-src === Supabase-prosjektet ================= */
// config.js er en ren tilordning til window.SUPABASE_CONFIG; hent URL-en
// derfra i stedet for å gjenta prosjektreferansen i testen.
const cfgSrc = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const cfgUrl = (/url:\s*'([^']+)'/.exec(cfgSrc) || [])[1];
check('config.js oppgir en Supabase-URL', !!cfgUrl, cfgUrl);
const origin = cfgUrl ? new URL(cfgUrl).origin : '';
const wss = origin.replace(/^https:/, 'wss:');
const conn = headerCsp['connect-src'] || [];
check('connect-src tillater Supabase over https', conn.indexOf(origin) > -1, { origin, conn });
check('connect-src tillater Supabase over wss (realtime)', conn.indexOf(wss) > -1, { wss, conn });
check("connect-src tillater eget origin ('self' — /version.json i oppdateringssjekken)",
  conn.indexOf("'self'") > -1, conn);
// OTA-manifestet (docs/mobilapp-plan.md, fase 5): inne i APK-en er 'self' det
// innebygde originet (https://localhost), så det kanoniske originet må stå
// navngitt for at web-laget skal få lese /ota/android/<versionCode>.json.
// Verten hentes fra config.js — samme ene kilde som appen selv bruker.
const canonicalUrl = (/canonicalAppUrl:\s*'([^']+)'/.exec(cfgSrc) || [])[1];
const canonicalOrigin = canonicalUrl ? new URL(canonicalUrl).origin : '';
check('config.js oppgir det kanoniske originet', !!canonicalOrigin, canonicalUrl);
check('connect-src tillater det kanoniske originet (OTA-manifestet i APK-en)',
  conn.indexOf(canonicalOrigin) > -1, { canonicalOrigin, conn });
check('connect-src tillater ingen andre verter enn Supabase, eget origin og det kanoniske originet',
  conn.length === 4, conn);

/* style-src er eget origin PLUSS én sjekksum: dra-og-slipp-motoren (dnd-kit,
   gjennom Smett) injiserer ett stilark mens et drag pågår — det som posisjonerer
   det løftede objektet i top layer. Det er en inline-stil, og den eneste veien
   forbi `style-src` uten `'unsafe-inline'` er en hash av nøyaktig det arket.
   Selve teksten finnes bare i kjøretid (den settes sammen inne i biblioteket),
   så sjekksummen kan ikke regnes ut her — `tests/csp-enforced.test.js` gjør det
   i en ekte nettleser og feiler hvis den drifter. Her voktes FORMEN: eget
   origin, nøyaktig én hash, og ingenting annet. Se docs/sikkerhetsheadere.md. */
const styleSrc = headerCsp['style-src'] || [];
check("style-src tillater eget origin (webfonten er selvhostet)",
  styleSrc.indexOf("'self'") > -1, styleSrc);
check('style-src har nøyaktig én hash — dra-og-slipp-motorens stilark',
  styleSrc.filter((s2) => /^'sha(256|384|512)-/.test(s2)).length === 1, styleSrc);
check('style-src har ingen andre kilder enn eget origin og den ene hashen',
  styleSrc.length === 2, styleSrc);
check("font-src er låst til eget origin (assets/fonts/)",
  String(headerCsp['font-src']) === "'self'", headerCsp['font-src']);

/* ================= 8) Bibliotekene: lokale, låste kopier ================= */
/* Alle tredjepartsbibliotekene ligger i `vendor/`, med den eksakte versjonen i
   filnavnet og sjekksummen regnet ut på nytt her. Det de IKKE deler er hvor
   bytene kommer fra, og guarden må si det riktige om hvert av dem:

     • Supabase er publisert på npm, så kopien er byte for byte pakken npm
       leverte (`@supabase/supabase-js@<versjon>` → `dist/umd/supabase.js`).
     • Smett er IKKE på npm. Kopien er byte for byte det `npm run build:iife`
       gir i peohol/smett på den commit-en som står her — et esbuild-artefakt,
       ikke en publisert pakke. Derfor er commit-en en del av påstanden: uten
       den finnes det ingen kilde å regne bytene ut fra på nytt. Smett pinner
       esbuild til en eksakt versjon nettopp for at den påstanden skal holde
       over tid (en minifiserer kan endre output i en patch-utgivelse).
     • Yjs er på npm, men publiserer bare ESM/CJS — ingen ferdig IIFE. Kopien
       er derfor esbuild-bunten av pakken, laget av ett enkelt inngangspunkt
       (`export * from 'yjs'`) med de flaggene som står i `origin`. Hele
       pakken re-eksporteres med vilje: en håndplukket eksportliste ville gjort
       bytene avhengige av hvilke navn Huskis tilfeldigvis brukte den dagen.
       Som for Smett er esbuild-versjonen en del av påstanden.

   Oppgraderer du et av dem, må den nye versjonen (og for Smett/Yjs: den nye
   commit-en eller esbuild-versjonen) inn her — en ukjent versjon feiler, så en
   kopi kan verken byttes ut eller redigeres uten at det synes. */
const VENDORED = {
  'supabase-js': {
    what: 'Supabase-biblioteket',
    version: '2.111.0',
    // Byte for byte det npm publiserte for denne versjonen.
    origin: 'npm: @supabase/supabase-js@2.111.0 → dist/umd/supabase.js',
    sha384: 'sha384-faMlYZUtkJj+Sh6Bmu/L0GzPcraRWN6CW+9RH3GUrK/Z0WS9tgaNNt0tHiLxsbdb',
  },
  smett: {
    what: 'dra-og-slipp-motoren (Smett over dnd-kit)',
    version: '0.2.0',
    // Byte for byte det `npm ci && npm run build:iife` gir fra denne commit-en.
    origin: 'peohol/smett@fa94e65 → npm run build:iife → dist/smett.iife.js',
    sha384: 'sha384-QX+eobU8pHXcyy4ZbW2wRiHNRbauZ4gw5tXKSHl5uzhmvHtaYm2tE12GhRgHvhZk',
  },
  yjs: {
    what: 'samskrivings-motoren (Yjs)',
    version: '13.6.32',
    // Byte for byte: esbuild 0.28.2 over ett inngangspunkt med linjen
    //   export * from 'yjs';
    // og flaggene
    //   --bundle --format=iife --global-name=Yjs --minify --target=es2019
    //   --legal-comments=none
    origin: "npm: yjs@13.6.32 → esbuild@0.28.2 --bundle --format=iife "
          + "--global-name=Yjs --minify --target=es2019 --legal-comments=none",
    sha384: 'sha384-cR1+YMOIlUf6N/BgLCwffJbHx/RbVpVRJ8c0tylClvQPFBBxFbhiRnregDdZ28S8',
  },
};

// Alle vendor-skriptene index.html faktisk laster, i rekkefølge.
const vendorScripts = (html.match(/<script src="vendor\/[^"]+"/g) || [])
  .map((m) => /"(vendor\/[^"]+)"/.exec(m)[1]);
check('index.html laster alle bibliotekene fra lokale kopier i vendor/',
  vendorScripts.length === Object.keys(VENDORED).length, vendorScripts);
// Smett MÅ ligge før app.js: den er et klassisk skript som definerer `Smett`,
// og app.js leser den globalen mens den kjører.
check('vendor/smett-0.2.0.js lastes FØR app.js',
  html.indexOf('vendor/smett-0.2.0.js') > -1 &&
  html.indexOf('vendor/smett-0.2.0.js') < html.indexOf('src="app.js"'),
  { smett: html.indexOf('vendor/smett-0.2.0.js'), app: html.indexOf('src="app.js"') });
// Samme krav til Yjs, og av samme grunn: app.js leser den globale `Yjs` mens
// den kjører (docs/notater-plan.md, «Sanntids samskriving»).
check('vendor/yjs-13.6.32.js lastes FØR app.js',
  html.indexOf('vendor/yjs-13.6.32.js') > -1 &&
  html.indexOf('vendor/yjs-13.6.32.js') < html.indexOf('src="app.js"'),
  { yjs: html.indexOf('vendor/yjs-13.6.32.js'), app: html.indexOf('src="app.js"') });
check('app.js er ikke gjort til et modulskript (det ville kjørt etter alle klassiske)',
  !/<script[^>]+type="module"/i.test(html),
  (html.match(/<script[^>]+type="module"[^>]*>/i) || [])[0]);

Object.keys(VENDORED).forEach((key) => {
  const want = VENDORED[key];
  const lib = vendorScripts.find((src) => src.indexOf('vendor/' + key + '-') === 0);
  check('index.html laster ' + want.what + ' fra en lokal kopi i vendor/', !!lib, vendorScripts);
  const libVersion = (/-(\d+\.\d+\.\d+)\.js$/.exec(lib || '') || [])[1];
  check(key + ': filnavnet oppgir en EKSAKT versjon (ikke flytende @2)',
    libVersion === want.version, { fil: lib, forventet: want.version });
  const libPath = lib ? path.join(ROOT, lib) : null;
  check(key + ': kopien er sjekket inn i repoet', !!libPath && fs.existsSync(libPath), lib);
  const libSha = libPath && fs.existsSync(libPath)
    ? 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(libPath)).digest('base64')
    : null;
  check(key + ': kopien er byte for byte ' + want.origin,
    !!libSha && libSha === want.sha384,
    { regnet: libSha, forventet: want.sha384 });
});

// Hele poenget med den lokale kopien: ingenting utenfor eget origin kan kjøre
// kode, og appen laster ikke ned noe som helst fra et CDN.
check('script-src har ingen eksterne kilder i det hele tatt',
  (headerCsp['script-src'] || []).filter((s) => /^https?:/.test(s)).length === 0,
  headerCsp['script-src']);
check('index.html laster ingen skript fra en fremmed vert',
  !/<script[^>]+src="(?:https?:)?\/\//i.test(html),
  (html.match(/<script[^>]+src="(?:https?:)?\/\/[^"]*"/i) || [])[0]);

/* ================= 9) Webfonten: lokal kopi ================= */
// Samme prinsipp som vendor/: fila ligger i repoet, versjonen står i navnet, og
// sjekksummen regnes ut på nytt her. Utsnittene er de to Google Fonts selv
// leverte for denne fonten (latin + latin-ext), hvert av dem det VARIABLE
// snittet — derfor dekker én fil hele vektspennet appen bruker (400–700).
const FONT_SHA384 = {
  'assets/fonts/atkinson-hyperlegible-next-v7-latin.woff2':
    'sha384-trwxfJeLbKJXXCFjfWaVjAar+UYeUZQt1LSkQo+FWdQjPr9NV49u5HDW2Tgfny9p',
  'assets/fonts/atkinson-hyperlegible-next-v7-latin-ext.woff2':
    'sha384-dqgjE834HnKYas4E7qHLTgDhvisF5NRsRB9RLwdm/7qWJn2pZWra4ATev5OScOH8',
};

const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const fontUrls = (css.match(/url\('([^']+\.woff2)'\)/g) || [])
  .map((m) => /url\('([^']+)'\)/.exec(m)[1]);
check('styles.css erklærer @font-face for webfonten', /@font-face/.test(css));
check('styles.css peker på de innsjekkede fontfilene',
  fontUrls.slice().sort().join(' ') === Object.keys(FONT_SHA384).sort().join(' '), fontUrls);
Object.keys(FONT_SHA384).forEach((f) => {
  const p = path.join(ROOT, f);
  const sha = fs.existsSync(p)
    ? 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(p)).digest('base64')
    : null;
  check(f + ' er sjekket inn og uendret', sha === FONT_SHA384[f],
    { regnet: sha, forventet: FONT_SHA384[f] });
});
// Poenget med å selvhoste: ingen tredjepartsvert i det hele tatt. Et gjenglemt
// <link> til Google Fonts ville ellers ligget der uten å virke (CSP blokkerer
// det), og både lekke adressen og koste en rundtur.
check('styles.css henter ingen font fra en fremmed vert',
  !/url\(\s*['"]?(?:https?:)?\/\//i.test(css),
  (css.match(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/i) || [])[0]);
check('index.html laster ingen stilark fra en fremmed vert',
  !/<link[^>]+rel="stylesheet"[^>]+href="(?:https?:)?\/\//i.test(html),
  (html.match(/<link[^>]+rel="stylesheet"[^>]+href="(?:https?:)?\/\/[^"]*"/i) || [])[0]);
check('index.html har ingen preconnect/dns-prefetch til en fremmed vert',
  !/<link[^>]+rel="(?:preconnect|dns-prefetch)"/i.test(html),
  (html.match(/<link[^>]+rel="(?:preconnect|dns-prefetch)"[^>]*>/i) || [])[0]);

/* ================= 10) Testmodus finnes ikke i produksjonsbygget ========= */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huskis-sec-'));
function runBuild(dir, env) {
  const dest = path.join(tmp, dir);
  execFileSync(process.execPath, [path.join(ROOT, 'build.js'), '--out', dest], {
    cwd: ROOT,
    env: Object.assign({}, process.env,
      { VERCEL_DEPLOYMENT_ID: '', VERCEL_GIT_COMMIT_SHA: '', VERCEL_ENV: '' }, env || {}),
    stdio: 'pipe',
  });
  return { html: fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), names: fs.readdirSync(dest) };
}
const out = path.join(tmp, 'prod');
const prod = runBuild('prod');
const built = prod.html;
const names = prod.names;
const TEST_MODE = ['dev-mock.js', 'mock-backend.js'];
check('kildekoden HAR testmodusen (utvikling og nettlesertester bruker den)',
  TEST_MODE.every((f) => fs.existsSync(path.join(ROOT, f))) && html.indexOf('dev-mock.js') > -1);
TEST_MODE.forEach((f) => {
  check('produksjonsbygget publiserer ikke ' + f, names.indexOf(f) === -1, names);
});
check('produksjonsbygget nevner ikke mock i det hele tatt', !/mock/i.test(built),
  (built.match(/.{0,40}mock.{0,40}/i) || [])[0]);
check('kun-dev-blokken er fjernet fra dist/index.html', built.indexOf('kun-dev') === -1);
check('resten av HTML-en er urørt (samme antall <script src>)',
  (built.match(/<script src=/g) || []).length === (html.match(/<script src=/g) || []).length - 1,
  { dist: (built.match(/<script src=/g) || []).length, src: (html.match(/<script src=/g) || []).length });
check('CSP-meta-taggen er med i produksjonsbygget',
  /<meta\s+http-equiv="Content-Security-Policy"/.test(built));
// Uten kopiene i dist/ ville produksjon stått igjen med en 404 der biblioteket
// skulle vært — uten Supabase kommer appen ikke forbi innloggingsskjermen, og
// uten Smett kaster app.js på en global som ikke finnes.
vendorScripts.forEach((src) => {
  check('produksjonsbygget publiserer den lokale kopien ' + src,
    fs.existsSync(path.join(out, src)), src);
});
// Uten fontfilene i dist/ ville @font-face pekt på en 404, og appen falt
// tilbake til systemfonten i produksjon — uten at noe annet feilet.
Object.keys(FONT_SHA384).forEach((f) => {
  check('produksjonsbygget publiserer ' + f, fs.existsSync(path.join(out, f)));
});

// Vercel setter VERCEL_ENV selv. Produksjonsdeployen skal aldri få testmodusen,
// uansett hvordan builden startes.
const prodEnv = runBuild('prod-env', { VERCEL_ENV: 'production' });
check('VERCEL_ENV=production fjerner testmodusen',
  !/mock/i.test(prodEnv.html) && TEST_MODE.every((f) => prodEnv.names.indexOf(f) === -1),
  prodEnv.names);

// Preview-deployer peker på det samme Supabase-prosjektet som produksjon, så
// ?mock=1 ER måten å se en endring uten å røre ekte data (release-og-deploy.md).
// Uten mock-backenden ville ?mock=1 stille falt tilbake til den ekte databasen.
const prev = runBuild('preview', { VERCEL_ENV: 'preview' });
TEST_MODE.forEach((f) => {
  check('preview-bygget BEHOLDER ' + f, prev.names.indexOf(f) > -1, prev.names);
});
check('preview-bygget beholder taggen som laster testmodusen',
  prev.html.indexOf('dev-mock.js') > -1);
check('preview-bygget har den samme CSP-en som produksjon',
  /<meta\s+http-equiv="Content-Security-Policy"/.test(prev.html) &&
  prev.html.indexOf("script-src 'self'") > -1);

// build.js skal STOPPE hvis markørene forsvinner — en stille no-op ville
// deployet testmodusen uten at noe sa fra.
const { stripDevOnly } = require(path.join(ROOT, 'build.js'));
let threw = false;
try { stripDevOnly('<html><body>uten markører</body></html>'); } catch (e) { threw = true; }
check('build.js kaster hvis kun-dev-markørene mangler i index.html', threw);
let threwHalf = false;
try { stripDevOnly('<!-- huskis:kun-dev:start --><script src="x.js"></script>'); } catch (e) { threwHalf = true; }
check('build.js kaster på en uavsluttet kun-dev-blokk', threwHalf);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
