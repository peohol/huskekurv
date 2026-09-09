/*
  Regresjonstest: MÅLFARGEN ERSTATTER KORTETS EGEN FARGE.

  Holdes et løftet objekt over søppelkassen, skal det lese umiskjennelig RØDT —
  uansett hvilken palettfarge kortet har. Over arkivet: umiskjennelig GULT.
  Før ble bare en halvgjennomsiktig vask malt over det ytterste laget, mens de
  INDRE lagene (korthodet, platene) sto igjen i kortets egen farge. På et
  kompakt løft er hodet hele den synlige flaten, så et grønt kort leste grønt
  over søppelkassen.

  Fargen måles på det som FAKTISK ER MALT: et skjermbilde av det løftede
  objektet, dekodet piksel for piksel. Å lese `getComputedStyle` på
  overlay-laget ville bare gjentatt tokenet vi selv skrev, og ville ikke sett
  at et indre lag maler over det.

  Dekker, for BEGGE draktene og BEGGE målene:
    1. To tydelig ulike originalfarger gir samme mål-farge (fargen kommer fra
       målet, ikke fra paletten).
    2. Fargen er faktisk rød respektive gul — målt som fargetone, ikke som
       likhet med et token.
    3. Teksten på objektet er lesbar mot den nye flaten (kontrast ≥ 4,5:1).

  Kjør:
    python3 -m http.server 8000                       # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-drop-colour.test.js
*/
const { chromium } = require('playwright');
const zlib = require('zlib');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

/* ---- PNG → piksler. Chromium skriver 8-bits RGB eller RGBA uten interlace,
   så dette er hele formatet vi trenger: les IHDR, slå sammen IDAT, pakk ut, og
   fjern radfiltrene (PNG-spesifikasjonen, §9.2). ---- */
function pngPiksler(buf) {
  let w = 0, h = 0, kanaler = 4, off = 8;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      kanaler = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !kanaler) throw new Error('uventet PNG-format');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const rå = zlib.inflateSync(Buffer.concat(idat));
  const bredde = w * kanaler;
  const ut = Buffer.alloc(h * bredde);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = rå[p++];
    for (let x = 0; x < bredde; x++) {
      const a = x >= kanaler ? ut[y * bredde + x - kanaler] : 0;
      const b = y > 0 ? ut[(y - 1) * bredde + x] : 0;
      const c = (x >= kanaler && y > 0) ? ut[(y - 1) * bredde + x - kanaler] : 0;
      const v = rå[p++];
      let ny;
      if (f === 0) ny = v;
      else if (f === 1) ny = v + a;
      else if (f === 2) ny = v + b;
      else if (f === 3) ny = v + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        ny = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      ut[y * bredde + x] = ny & 255;
    }
  }
  return { w, h, kanaler, px: ut };
}
// Medianfargen i utsnittet — robust mot tekst, ikoner og kanter.
function medianFarge(bilde) {
  const { w, h, kanaler, px } = bilde;
  const r = [], g = [], b = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w * kanaler + x * kanaler;
      r.push(px[i]); g.push(px[i + 1]); b.push(px[i + 2]);
    }
  }
  const m = (arr) => { arr.sort((p, q) => p - q); return arr[arr.length >> 1]; };
  return { r: m(r), g: m(g), b: m(b) };
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
// Fargetone i grader (0 = rød, 60 = gul), og metning.
function tone(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const maks = Math.max(r, g, b), min = Math.min(r, g, b), d = maks - min;
  if (!d) return { h: 0, s: 0 };
  let h;
  if (maks === r) h = 60 * (((g - b) / d) % 6);
  else if (maks === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: maks ? d / maks : 0 };
}
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const kontrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
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
  await p.waitForFunction(() => window.__huskis && window.__huskis.authUser && window.__huskis.lastMy,
    null, { timeout: 20000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(200);
}

// Fire notater, så paletten gir kortene tydelig ulike farger.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject(); proj.name = 'Fag';
    H.setActiveProject(proj.id); H.setActiveNoteFolder(null);
    for (let i = 0; i < 4; i++) {
      const n = H.addNote(); H.closeNoteEditor();
      n.title = 'Notat ' + (i + 1);
      n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: 'Tekst ' + (i + 1) }] }] };
    }
    H.save(); H.renderNotes();
  });
  await p.waitForTimeout(500);
}

async function settDrakt(p, drakt) {
  await p.evaluate((d) => { document.documentElement.setAttribute('data-theme', d); }, drakt);
  await p.waitForTimeout(250);
}

/* Løft ETT notat, hold det over målet, og les fargen på det som er malt.
   Utsnittet er en bit av korthodet UNDER tittelen, så tekst og ikoner ikke
   drar medianen. */
async function målFarge(p, indeks, mål, touch) {
  const kort = p.locator('#notes-board .note-card').nth(indeks);
  const hvile = await kort.evaluate((el) => getComputedStyle(el).backgroundColor);
  const b = await kort.boundingBox();
  await G.lift(p, { x: b.x + b.width / 2, y: b.y + 18 }, touch);
  const knapp = await p.locator(mål).boundingBox();
  await G.travel(p, { x: knapp.x + knapp.width / 2, y: knapp.y + knapp.height / 2 }, touch);
  await p.waitForTimeout(200);
  const el = await p.locator('[data-dnd-dragging]').boundingBox();
  // Nederste tredjedel av det løftede objektet, godt innenfor kantene.
  const png = await p.screenshot({ clip: {
    x: Math.round(el.x + el.width * 0.25), y: Math.round(el.y + el.height * 0.62),
    width: Math.max(6, Math.round(el.width * 0.45)), height: Math.max(5, Math.round(el.height * 0.2)),
  } });
  const farge = medianFarge(pngPiksler(png));
  // Tittelens blekk, for lesbarhetssjekken.
  const blekk = await p.evaluate(() => {
    const t = document.querySelector('[data-dnd-dragging] .note-card-title');
    return t ? getComputedStyle(t).color : null;
  });
  /* TILBAKE FØR SLIPPET: et slipp i kassen ville slettet notatet, og de neste
     målingene trenger de samme kortene. Vi måler fargen, ikke handlingen. */
  await G.travel(p, { x: b.x + b.width / 2, y: b.y + 18 }, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(500);
  return { farge, hvile, blekk };
}
const rgb = (s) => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
};

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

  for (const drakt of ['light', 'dark']) {
    await settDrakt(p, drakt);
    for (const [navn, sel, tone0, spenn] of [
      ['søppelkassen', '#note-trash-btn', 0, 40],
      ['arkivet', '#note-archive-btn', 45, 25],
    ]) {
      const a = await målFarge(p, 0, sel, touch);
      const b = await målFarge(p, 2, sel, touch);
      const ulikeHvile = a.hvile !== b.hvile;
      const ta = tone(a.farge), tb = tone(b.farge);
      const nær = Math.abs(a.farge.r - b.farge.r) + Math.abs(a.farge.g - b.farge.g)
        + Math.abs(a.farge.b - b.farge.b);
      log(label + ' ' + drakt + '/' + navn + ': to ulike kortfarger gir samme målfarge',
        ulikeHvile && nær <= 24,
        JSON.stringify({ hvile: [a.hvile, b.hvile], malt: [hex(a.farge), hex(b.farge)], avvik: nær }));
      const treffer = (t) => (Math.min(Math.abs(t.h - tone0), 360 - Math.abs(t.h - tone0)) <= spenn) && t.s >= 0.25;
      log(label + ' ' + drakt + '/' + navn + ': fargen er umiskjennelig ' + (tone0 === 0 ? 'RØD' : 'GUL'),
        treffer(ta) && treffer(tb),
        JSON.stringify({ a: { hex: hex(a.farge), h: Math.round(ta.h), s: +ta.s.toFixed(2) },
          b: { hex: hex(b.farge), h: Math.round(tb.h), s: +tb.s.toFixed(2) } }));
      const blekk = rgb(a.blekk);
      log(label + ' ' + drakt + '/' + navn + ': teksten er lesbar mot den nye flaten',
        !!blekk && kontrast(blekk, a.farge) >= 4.5,
        JSON.stringify({ blekk: a.blekk, flate: hex(a.farge),
          kontrast: blekk ? +kontrast(blekk, a.farge).toFixed(2) : null }));
    }
  }
  await settDrakt(p, 'light');

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
