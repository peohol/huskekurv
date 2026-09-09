/*
  Regresjonstest: ÉN PIKSEL STREK I HELE IKONSETTET
  (docs/design-system.md → «Ikoner»).

  Ikonene tegnes i et 24×24-rutenett og vises i alt fra 15 px til 60 px. Før
  skalerte streken med tegningen — samme `stroke-width` ble en hårstrek i det
  minste ikonet og nesten 3 px i det største. Nå står hvert ikon med
  `stroke-width="1"`, og styles.css gir formene `vector-effect:
  non-scaling-stroke`, som måler streken i skjermpiksler i stedet for i
  rutenettet. Da er 1 px 1 px i alle størrelser.

  Filen dekker:

   1. TEKSTVAKT: hver eneste `stroke-width` i `icons.js`, `index.html` og
      `favicon.svg` er nøyaktig «1» — ingen 1.05, ingen 0.9, ingen
      kompensasjon for en <g transform="scale(…)">.
   2. TEKSTVAKT: styles.css bærer regelen (for både `.icon` og `.brand-logo`),
      og `--icon-stroke` er 1px. `favicon.svg` bærer sin egen kopi, fordi den
      også lastes frittstående der stilarket ikke gjelder.
   3. TEKSTVAKT: varselikon-generatoren skrur regelen AV med vilje — en 192 px
      raster trenger en strek som skalerer (tests/lag-varselikoner.js).
   4. KJØRENDE: hver form i hvert ikon i DOM-et — hele `window.ICONS`, alt som
      står inline i `index.html`, og logoen — har `vector-effect:
      non-scaling-stroke` og `stroke-width: 1px`.
   5. MÅLT: ＋-ikonet rastereres i 16 px og i 64 px, og den faktiske
      blekkmengden tvers over streken er 1 px i BEGGE. Det er selve påstanden;
      punkt 4 sier bare at regelen er satt.
   6. MÅLT: bokhylla har ingen dobbel strek. En vannrett skannlinje gjennom
      bøkene treffer nøyaktig FIRE streker (ytterkant, to delte kanter,
      ytterkant), hver på 1 px — ikke 2 px der to bøker møtes.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/icon-stroke.test.js
*/
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const ROOT = path.join(__dirname, '..');
const les = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (navn, ok, evidens) => {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
};

/* ============ 1–3. Tekstvaktene ============ */

for (const fil of ['icons.js', 'index.html', 'favicon.svg']) {
  const bredder = [...les(fil).matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1]);
  const avvik = [...new Set(bredder.filter((b) => b !== '1'))];
  check('hver stroke-width i ' + fil + ' er «1»', bredder.length > 0 && avvik.length === 0,
    bredder.length + ' forekomster' + (avvik.length ? ', avvik: ' + avvik.join(', ') : ''));
}

{
  const css = les('styles.css');
  // Regelen må treffe ETTERKOMMERNE, ikke <svg> selv: vector-effect arves ikke.
  const regel = /\.icon \*,\s*\.brand-logo \*\s*\{[^}]*vector-effect:\s*non-scaling-stroke/;
  check('styles.css gir formene i .icon OG .brand-logo non-scaling-stroke', regel.test(css));
  check('--icon-stroke (CSS-tegnede streker) er 1px', /--icon-stroke:\s*1px;/.test(css));

  const favicon = les('favicon.svg');
  check('favicon.svg bærer sin egen non-scaling-stroke (lastes uten stilarket)',
    /<style>[^<]*vector-effect:\s*non-scaling-stroke/.test(favicon));
}

{
  const gen = les('tests/lag-varselikoner.js');
  check('varselikon-generatoren skrur non-scaling-stroke AV for sin 192 px raster',
    /vector-effect:\s*none/.test(gen) && /const IKON_STREK\s*=\s*0\.9;/.test(gen));
}

/* ============ Bokhyllas delte kanter, lest ut av markup ============
   Måling (punkt 6) viser at resultatet stemmer; her låses ÅRSAKEN: kantene
   som møtes står på nøyaktig samme koordinat. Et halvt hakk fra hverandre
   ville gitt to streker side om side — altså 2 px der det skal være 1. */
{
  const svg = (les('icons.js').match(/noteProject: '[\s\S]*?<\/svg>'/) || [''])[0];
  const rect = (x) => {
    const m = svg.match(new RegExp('<rect x="' + String(x).replace('.', '\\.') +
      '" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"'));
    return m ? { x, y: +m[1], w: +m[2], h: +m[3] } : null;
  };
  const b1 = rect(5), b2 = rect(9.8), b3 = rect(14.3);
  const plate = rect(2.7), brakett = rect(5.4);
  const ok = b1 && b2 && b3 && plate && brakett;
  check('fant de tre bøkene, platen og braketten i bokhylla', !!ok);
  if (ok) {
    check('bok 1 og bok 2 deler kant (ingen 2 px-strek mellom dem)',
      b1.x + b1.w === b2.x, b1.x + '+' + b1.w + ' = ' + b2.x);
    check('bok 2 og bok 3 deler kant', b2.x + b2.w === b3.x, b2.x + '+' + b2.w + ' = ' + b3.x);
    check('bøkene står PÅ platen (bunnen deler kant med platens overkant)',
      [b1, b2, b3].every((b) => b.y + b.h === plate.y),
      [b1, b2, b3].map((b) => b.y + b.h).join(', ') + ' vs. ' + plate.y);
    check('brakettene henger UNDER platen (deler kant med platens underkant)',
      brakett.y === plate.y + plate.h, brakett.y + ' vs. ' + (plate.y + plate.h));
    const bredde = b3.x + b3.w - b1.x;
    check('bøkene fyller brorparten av hyllens bredde',
      bredde / plate.w > 0.7, Math.round((bredde / plate.w) * 100) + ' % av platen');
  }
}

/* ============ 4–6. Kjørende + målt ============ */

/* Blekkmengden i én rad/kolonne av et skjermbilde. Måler DEKNING, ikke antall
   piksler: en 1 px strek som lander midt mellom to piksler tegnes som to
   halvdekkede — summen er 1 uansett hvor den lander, mens en telling ville
   sagt 2. Bakgrunnen er hvit og streken #111. */
const BLEKK = 17;   // #111
function runsAv(dekning) {
  const ut = [];
  let n = null;
  for (let i = 0; i < dekning.length; i++) {
    if (dekning[i] > 0.02) {
      if (!n) { n = { fra: i, sum: 0 }; ut.push(n); }
      n.sum += dekning[i];
      n.til = i;
    } else n = null;
  }
  return ut;
}

async function dekodeRad(p, png, retning, linje) {
  return p.evaluate(async ({ png, retning, linje }) => {
    const im = await new Promise((ok, nei) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = () => nei(new Error('lastet ikke'));
      i.src = 'data:image/png;base64,' + png;
    });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = (x, y) => {
      const i = (y * c.width + x) * 4;
      return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    };
    const n = retning === 'rad' ? c.width : c.height;
    const ut = [];
    for (let i = 0; i < n; i++) ut.push(retning === 'rad' ? lum(i, linje) : lum(linje, i));
    return { lum: ut, bredde: c.width, hoyde: c.height };
  }, { png, retning, linje });
}
/* Luminans → dekning: 255 (hvitt papir) er 0, #111 er 1. */
const dekning = (lumliste) =>
  lumliste.map((l) => Math.max(0, Math.min(1, (255 - l) / (255 - BLEKK))));

(async () => {
  const nettleser = await chromium.launch();
  const ctx = await nettleser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const jsFeil = [];
  p.on('pageerror', (e) => jsFeil.push(String(e)));

  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => !!window.ICONS, null, { timeout: 10000 });
  // Lys drakt: streken er #111 mot hvitt, som målingen forutsetter.
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  /* ---- 4. Regelen gjelder hver eneste form i hvert eneste ikon ---- */
  // Hele settet limes inn i DOM-et — også ikonene som ellers bare bygges
  // dynamisk — slik at målingen dekker alle, ikke bare de auth-skjermen viser.
  await p.evaluate(() => {
    const boks = document.createElement('div');
    boks.id = 'ikon-alle';
    boks.style.cssText = 'position:fixed;left:-4000px;top:0;font-size:24px';
    boks.innerHTML = Object.values(window.ICONS).join('');
    document.body.appendChild(boks);
  });
  const settet = await p.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg.icon, svg.brand-logo')];
    let former = 0;
    const feil = [];
    for (const svg of svgs) {
      for (const el of svg.querySelectorAll('path, rect, circle, line, polyline, polygon, ellipse')) {
        former++;
        const cs = getComputedStyle(el);
        if (cs.vectorEffect !== 'non-scaling-stroke' || cs.strokeWidth !== '1px') {
          feil.push((svg.className.baseVal || '?') + '/' + el.tagName +
            ': ' + cs.vectorEffect + ' ' + cs.strokeWidth);
        }
      }
    }
    return { svgs: svgs.length, former, feil: feil.slice(0, 5), antallFeil: feil.length };
  });
  check('hver form i hvert ikon har non-scaling-stroke og stroke-width 1px',
    settet.antallFeil === 0 && settet.former > 200,
    settet.svgs + ' ikoner, ' + settet.former + ' former' +
    (settet.antallFeil ? ', feil: ' + settet.feil.join(' | ') : ''));
  check('logoen (.brand-logo) er med i målingen',
    await p.evaluate(() => !!document.querySelector('svg.brand-logo')));

  /* ---- 5. Målt: samme 1 px i 16 px og i 64 px ---- */
  await p.evaluate(() => {
    document.getElementById('ikon-alle').remove();
    const boks = document.createElement('div');
    boks.id = 'ikon-maal';
    boks.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;' +
      'background:#fff;line-height:0;display:flex;align-items:flex-start;gap:20px';
    /* Stilene settes gjennom CSSOM, ikke som style-attributter: appens
       innholdssikkerhetspolicy (docs/sikkerhetsheadere.md) tillater ikke
       inline stil, og et blokkert attributt ville gitt begge ikonene samme
       størrelse — altså en måling som ikke målte noe. */
    for (const [id, px] of [['maal-liten', 16], ['maal-stor', 64]]) {
      const sp = document.createElement('span');
      sp.id = id;
      sp.style.display = 'block';
      sp.style.fontSize = px + 'px';
      sp.innerHTML = window.ICONS.plus;
      boks.appendChild(sp);
    }
    document.body.appendChild(boks);
  });

  for (const [navn, sel, px] of [['16 px', '#maal-liten svg', 16], ['64 px', '#maal-stor svg', 64]]) {
    const png = (await p.locator(sel).screenshot()).toString('base64');
    // ＋-ets vannrette strek spenner x=4.5…19.5 i rutenettet; kolonnen legges
    // på 28 % av bredden — godt innenfor streken, klar av den runde enden til
    // venstre og av den loddrette streken på midten.
    const kolonne = Math.round(px * 0.28);
    const rad = await dekodeRad(p, png, 'kolonne', kolonne);
    // Uten dette ville en feilrendret størrelse (f.eks. en blokkert stil) gitt
    // en måling på feil kolonne i stedet for en lesbar årsak.
    check('＋-ikonet i ' + navn + ' er rendret i nettopp den størrelsen',
      rad.bredde === px && rad.hoyde === px, rad.bredde + '×' + rad.hoyde + ' px');
    const r = runsAv(dekning(rad.lum));
    const sum = r.length === 1 ? r[0].sum : 0;
    check('＋-ikonet i ' + navn + ': streken er 1 px tvers over',
      r.length === 1 && sum > 0.8 && sum < 1.35,
      rad.bredde + '×' + rad.hoyde + ' px, ' + r.length + ' strek(er), blekk = ' + sum.toFixed(2) + ' px');
  }

  /* ---- 6. Målt: bokhylla har ingen dobbel strek ---- */
  // Fyllene tas bort før målingen, slik at bare KONTUREN står igjen: da er
  // hver strek utvetydig mot hvitt, og en delt kant som var tegnet to ganger
  // ville vist seg som en bredere (eller dobbel) strek.
  await p.evaluate(() => {
    document.getElementById('ikon-maal').remove();
    const boks = document.createElement('div');
    boks.id = 'ikon-hylle';
    boks.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#fff;line-height:0';
    const sp = document.createElement('span');
    sp.style.display = 'block';
    sp.style.fontSize = '240px';
    sp.innerHTML = window.ICONS.noteProject;
    boks.appendChild(sp);
    document.body.appendChild(boks);
    boks.querySelectorAll('svg [fill]').forEach((el) => el.setAttribute('fill', 'none'));
  });
  {
    const png = (await p.locator('#ikon-hylle svg').screenshot()).toString('base64');
    // y = 10 i rutenettet: midt på bokryggene, over platen og under den
    // laveste boktoppen (5.5), så alle tre bøkene er med.
    const rad = await dekodeRad(p, png, 'rad', Math.round(240 * (10 / 24)));
    const r = runsAv(dekning(rad.lum));
    check('bokhylla: skannlinja gjennom bøkene treffer nøyaktig fire streker',
      r.length === 4, r.map((x) => 'x≈' + x.fra + ' (' + x.sum.toFixed(2) + ' px)').join(', '));
    check('bokhylla: hver av de fire strekene er 1 px — også de to DELTE kantene',
      r.length === 4 && r.every((x) => x.sum > 0.8 && x.sum < 1.35),
      r.map((x) => x.sum.toFixed(2)).join(', '));
  }

  check('ingen JS-feil i løpet', jsFeil.length === 0, jsFeil.join(' | '));

  await nettleser.close();
  console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
  process.exit(fail === 0 ? 0 : 1);
})();
