#!/usr/bin/env node
/* ============================================================
   Regresjonstest: FARGENE I IKONSETTET (docs/design-system.md → «Ikoner»,
   docs/mork-drakt.md → «Ikonene snur uten at en eneste SVG endres»).

   Fargene er PRESENTASJONSATTRIBUTTER i markup — `fill="…"` i `icons.js` og i
   de innlimte SVG-ene i `index.html` — og CSS maler om nøyaktig tre av dem
   (`#ffffff` → --icon-paper, `#c0c4c9` → --icon-grey, `#111` → --icon-ink).
   Alt annet fyll står stille i begge draktene. Det gjør fyllfargen til en
   KONTRAKT, ikke en detalj: et fyll utenfor det tillatte settet snur ikke med
   drakten og er ikke målt mot noen flate.

   Ikonfargene er PER MOTIV, ikke lenger låst til appens seks kortfarger — se
   docs/design-system.md → «Fargekart». To unntak beholder en delt farge med
   vilje: (1) globus/del-ikon/tre-personer/logoen, som allerede er internt
   flerfargede og derfor ikke trenger en egen ikke-palett-tone, og (2)
   kontoikonet (person) + kamera-linsa + hånd-opp-personen, som alle bruker
   palettens blågrønne `#85adad` fordi `--accent`/`--grad-accent` i
   styles.css er AVLEDET av nettopp den fargen (se «Kontrast-kontrakt»).

   Derfor tre slag sjekk her:

     1. HVERT motiv har den fargen det skal ha — bjella messing-gull,
        kalenderens øverste felt terrakotta over en hvit hovedflate,
        søkelinsa søkeblå, sol oransje og måne himmelblå (to ULIKE farger,
        ikke lenger samme). Motivene finnes i FLERE eksemplarer
        (toppkontrollene, modalhodene, `icons.js`), og alle skal males likt.
     2. To ikoner som tidligere delte NØYAKTIG samme hex på tvers av ulike
        motiver (sol/måne; mappe/blyant/bjelle/lyspære) har nå hver sin farge.
     3. INGEN fyllfarge utenfor det tillatte settet finnes noe sted. Uten den
        vakten kan et nytt ikon komme inn med sin egen hex uten at noe sier fra
        — den ville sett riktig ut i lys drakt og feil i mørk.

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/icon-colors.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const icons = fs.readFileSync(path.join(ROOT, 'icons.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let pass = 0, fail = 0;
const check = (navn, ok, evidens) => {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
};

/* Palettens seks kortfarger (S=20 %, L=60 %) — fortsatt lovlige, fordi globus/
   del-ikon/tre-personer/logoen bruker dem med vilje (se filhodet). */
const PALETTE = ['#ad8585', '#adad85', '#85ad85', '#85adad', '#8585ad', '#ad85ad'];

/* De nye, ikke-palettbundne motivfargene (docs/design-system.md → «Fargekart»). */
const BJELLE = '#c99a3f';       // messing-gull
const KALENDER_ROD = '#c96b45'; // kalenderens øverste felt, terrakotta
const SOKELINSE = '#6fa8e0';    // søkeblå
const SOL = '#f0a83a';          // sol-oransje
const MAANE = '#9db3d9';        // himmelblå
const MAPPE = '#c9a06a';        // manila-tan
const BLYANT = '#e8bd3e';       // blyantgul
const LYSPAERE = '#f0d772';     // bleik glødegul
const SPRAK = '#4a94a3';        // språkvelgerens klode, blågrønn-teal
const LAAST = '#c15c56';        // hengelås, låst
const APEN = '#5da172';         // hengelås, åpen
const SKJERM = '#7a90ab';       // enheter: skjerm
const TELEFON = '#a8967a';      // enheter: telefon
const HYLLETRE = '#b07d4a';     // bokhyllens treplate + braketter, eik
const KONTO_BLAGRONN = '#85adad'; // kontoikon/kamera-linse/hånd-opp — palettfarge 4, med vilje

const LOVLIGE = new Set([
  ...PALETTE,
  BJELLE, KALENDER_ROD, SOKELINSE, SOL, MAANE, MAPPE, BLYANT, LYSPAERE,
  SPRAK, LAAST, APEN, SKJERM, TELEFON, HYLLETRE,
  '#ffffff', '#c0c4c9', '#111', '#111111', 'none',
]);

/* ---- 1. Bjella (varsler) ---- */
// Klokkeflaten, i alle eksemplarer. Den ENE bjella som IKKE er med er
// «varsler av»-glyfen på en massiv fargeknapp: den er `.btn-glyph` med
// currentColor og har ingen fyllflate i det hele tatt.
{
  const alle = [...html.matchAll(/<path d="M6\.8 16\.4v-4\.6a5\.2 5\.2 0 0 1 10\.4 0v4\.6z"([^>]*)>/g)]
    .map((m) => m[1]);
  check('fant bjelle-motivet i index.html', alle.length >= 3, alle.length + ' forekomster');
  const fylte = alle.filter((a) => /fill=/.test(a));
  check('bjellene med fyllflate er MESSING-GULL (' + BJELLE + ')',
    fylte.length >= 2 && fylte.every((a) => a.includes('fill="' + BJELLE + '"')),
    fylte.join(' | '));
  const glyf = alle.filter((a) => !/fill=/.test(a));
  check('«varsler av»-glyfen på fargeknappen har fortsatt ingen fyllflate',
    glyf.length === 1, glyf.length + ' uten fill');
}

/* ---- 2. Kalenderen (alle: starttid, frist, hendelser, toppkontrollen) ---- */
{
  // Toppfeltets bane MÅ dekke rammens fulle toppseksjon: rect x=3.5 width=17
  // rx=2.5 → høyre kant x=20.5, så det rette stykket øverst går fra x=6 (der
  // venstre hjørnebue slutter) til x=18 (der høyre hjørnebue begynner) — en
  // bredde på 12, altså "h12". Et "h11" (den gamle, feil verdien) stopper ett
  // hakk for tidlig, og den påfølgende buen treffer da (19.5, 7.5) i stedet
  // for hjørnet (20.5, 7.5) — et lite hvitt (upigmentert) hakk øverst til
  // høyre i feltet, der «papiret» under skinner gjennom det røde.
  const BAND = '<path d="M3.5 9.5V7.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V9.5Z" fill="' + KALENDER_ROD + '" stroke="none">';
  const iHtml = html.split(BAND).length - 1;
  const iIcons = icons.split(BAND).length - 1;
  check('kalenderens øverste felt er TERRAKOTTA i index.html', iHtml >= 2, iHtml + ' forekomster');
  check('kalenderens øverste felt er TERRAKOTTA i icons.js (calendar + calendarDue)',
    iIcons === 2, iIcons + ' forekomster');
  check('ingen kalenderkopi har den gamle, hakkete "h11"-banen igjen',
    !icons.includes('h11a2.5 2.5 0 0 1 2.5 2.5V9.5Z') &&
    !html.includes('h11a2.5 2.5 0 0 1 2.5 2.5V9.5Z'));
  // Hovedflaten er fortsatt «papir» i markup — men se pinning-sjekken under:
  // for KALENDEREN skal --icon-paper/--icon-ink ikke faktisk snu med drakten.
  const flate = /<rect x="3\.5" y="5" width="17" height="16" rx="2\.5" fill="#ffffff" stroke="none"><\/rect>/g;
  check('kalenderens hovedflate er hvit i markup, i icons.js',
    (icons.match(flate) || []).length === 2);
  check('kalenderens hovedflate er hvit i markup, i index.html',
    (html.match(flate) || []).length >= 2);
  // Rammen tegnes PÅ NYTT etter fyllet, ellers spiser det fargede feltet den
  // indre halvdelen av rammestreken (samme mønster som `trash`).
  const ramme = /<rect x="3\.5" y="5" width="17" height="16" rx="2\.5"><\/rect>/g;
  check('kalenderrammen strekes opp etter fyllet (icons.js)',
    (icons.match(ramme) || []).length === 2);
  check('kalenderrammen strekes opp etter fyllet (index.html)',
    (html.match(ramme) || []).length >= 2);
  // Kalenderens PAPIR er pinnet hvitt i begge drakter (papir er hvitt uansett
  // rom) — ulikt de fleste andre hvite ikonflatene, som følger drakten. I
  // mørk drakt går STREKEN i tillegg hvit (smelter sammen med det pinnede
  // papiret; formen leser mot den mørke bakgrunnen i stedet). Se
  // docs/mork-drakt.md → «Kalenderikonet er et tredje slag pinning».
  const pinnetSvg = /<svg class="icon icon-pin-light" viewBox="0 0 24 24"[^>]*>/g;
  check('kalender-SVG-en bærer .icon-pin-light i icons.js',
    (icons.match(pinnetSvg) || []).length === 2);
  check('kalender-SVG-en bærer .icon-pin-light i index.html',
    (html.match(pinnetSvg) || []).length >= 2);
  check('.icon-pin-light pinner --icon-paper til hvit i begge drakter (ikke --icon-ink der)',
    /(?<!dark"\] )\.icon-pin-light\s*\{[^}]*--icon-paper:\s*#ffffff;[^}]*\}/.test(css) &&
    !/(?<!dark"\] )\.icon-pin-light\s*\{[^}]*--icon-ink:/.test(css));
  check('mørk drakt overstyrer kalenderens strek til hvit, IKKE papiret på nytt',
    /:root\[data-theme="dark"\]\s*\.icon-pin-light\s*\{[^}]*--icon-ink:\s*#ffffff;[^}]*\}/.test(css) &&
    !/:root\[data-theme="dark"\]\s*\.icon-pin-light\s*\{[^}]*--icon-paper:/.test(css));
}

/* ---- 3. Søkelinsa ---- */
{
  const alle = [...html.matchAll(/<circle cx="10\.5" cy="10\.5" r="6\.5"([^>]*)>/g)].map((m) => m[1]);
  check('fant forstørrelsesglasset i index.html', alle.length >= 2, alle.length + ' forekomster');
  check('linsa er SØKEBLÅ (' + SOKELINSE + ')',
    alle.length >= 2 && alle.every((a) => a.includes('fill="' + SOKELINSE + '"')),
    alle.join(' | '));
}

/* ---- 4. Sol og måne (draktknappen) — to ULIKE farger ---- */
{
  check('solskiven er SOL-ORANSJE (' + SOL + ')',
    icons.includes('<circle cx="12" cy="12" r="5" fill="' + SOL + '"></circle>'));
  check('halvmånen er HIMMELBLÅ (' + MAANE + ')',
    icons.includes('A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="' + MAANE + '"'));
  check('sol og måne har IKKE lenger samme farge', SOL !== MAANE, SOL + ' ≠ ' + MAANE);
  // Draktknappen bruker ICONS.sun/moon; ingen egen kopi i index.html skal ha
  // blitt liggende igjen med det gamle «papir»-fyllet.
  check('ingen sol-/månekopi i index.html med gammelt papirfyll',
    !/r="5" fill="#ffffff"/.test(html) && !/11\.21 3 7 7 0 0 0 21 12\.79Z" fill="#ffffff"/.test(html));
}

/* ---- 5. Mappe / blyant / bjelle / lyspære — fire ulike gulnyanser ---- */
// De delte tidligere ÉN palettfarge (#adad85); nå har hvert motiv sin egen,
// og ingen to av dem er like.
{
  const gulfarger = { mappe: MAPPE, blyant: BLYANT, bjelle: BJELLE, lyspaere: LYSPAERE };
  const unike = new Set(Object.values(gulfarger));
  check('mappe/blyant/bjelle/lyspære har fire DISTINKTE farger',
    unike.size === 4, Object.entries(gulfarger).map(([n, c]) => n + '=' + c).join(', '));

  const mappeMotiv = 'M3.5 19V6.5a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z';
  const mappeTreff = [...(icons + html).matchAll(new RegExp('<path d="' + mappeMotiv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" fill="([^"]+)"', 'g'))];
  check('fant mappe-motivet flere steder (folder + groupCategory)', mappeTreff.length >= 4, mappeTreff.length + ' forekomster');
  check('alle mappe-forekomster er MANILA-TAN (' + MAPPE + ')',
    mappeTreff.every((m) => m[1] === MAPPE), [...new Set(mappeTreff.map((m) => m[1]))].join(', '));

  const lyspaereMotiv = 'M12 3.2a5.8 5.8 0 0 0-3.4 10.5c.5.36.8.95.8 1.57v.51h5.2v-.51c0-.62.3-1.21.8-1.57A5.8 5.8 0 0 0 12 3.2Z';
  const lyspaereTreff = [...html.matchAll(new RegExp('<path d="' + lyspaereMotiv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '" fill="([^"]+)"', 'g'))];
  check('fant lyspære-motivet flere steder', lyspaereTreff.length >= 5, lyspaereTreff.length + ' forekomster');
  check('alle lyspære-forekomster er BLEIK GLØDEGUL (' + LYSPAERE + ')',
    lyspaereTreff.every((m) => m[1] === LYSPAERE), [...new Set(lyspaereTreff.map((m) => m[1]))].join(', '));
}

/* ---- 6. Hengelås: låst rødt, åpen grønt ---- */
{
  check('hengelåsen LÅST er RØD (' + LAAST + ')',
    icons.includes('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="' + LAAST + '"></rect>'));
  check('hengelåsen ÅPEN er GRØNN (' + APEN + ')',
    icons.includes('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="' + APEN + '"></rect>'));
}

/* ---- 7. Kontoikonet (person) og alt som bevisst speiler det ---- */
// Kamera-linsa og hånd-opp-personen skal FORTSATT dele kontoikonets
// blågrønne — den fargen er forankringen for --accent/--grad-accent.
{
  const profil = icons.includes('<circle cx="12" cy="8" r="3.4" fill="' + KONTO_BLAGRONN + '"></circle>');
  const kamera = icons.includes('<circle cx="12" cy="13.4" r="3.7" fill="' + KONTO_BLAGRONN + '"></circle>');
  const handOpp = icons.includes('<circle cx="10.5" cy="8" r="3.2" fill="' + KONTO_BLAGRONN + '"></circle>');
  check('kontoikonet (person) er fortsatt palettens blågrønne (' + KONTO_BLAGRONN + ')', profil);
  check('kamera-linsa speiler fortsatt kontoikonet', kamera);
  check('hånd-opp-personen speiler fortsatt kontoikonet', handOpp);
}

/* ---- 8. Språkvelgerens klode — egen tone, ulik kontoikon og globus ---- */
{
  check('språk-kloden er egen blågrønn-teal (' + SPRAK + ')',
    icons.includes('<circle cx="12" cy="12" r="8.5" fill="' + SPRAK + '"></circle>'));
  check('språk-kloden er ulik kontoikonets farge', SPRAK !== KONTO_BLAGRONN);
}

/* ---- 9. Enheter (kontomodalens «Enheter og økter») ---- */
{
  check('enhets-ikonets skjerm er slate-blå (' + SKJERM + ')',
    html.includes('<rect x="2.5" y="5" width="13" height="9.5" rx="1.6" fill="' + SKJERM + '"></rect>'));
  check('enhets-ikonets telefon er varm grå-tan (' + TELEFON + ')',
    html.includes('<rect x="17" y="9" width="4.5" height="10" rx="1.2" fill="' + TELEFON + '"></rect>'));
}

/* ---- 9b. Bokhylla: tre bøker i tre ULIKE farger på en treplate ---- */
// Motivet er beskrevet i icons.js og docs/design-system.md: én hylle (plate +
// to braketter) og nøyaktig tre bøker. Her sjekkes FARGENE; geometrien — de
// delte kantene som holder streken på 1 px — vaktes av
// tests/icon-stroke.test.js. Flatene plukkes ut på farge, ikke på koordinat,
// så en justert tegning ikke feiler her uten grunn.
{
  const BOKFARGER = [LAAST, SOKELINSE, BLYANT];  // rød, blå, gul
  const hylla = (kilde) => {
    const svgs = kilde.match(/<svg[\s\S]*?<\/svg>/g) || [];
    return svgs.filter((v) => v.includes(HYLLETRE));
  };
  for (const [navn, kilde] of [['icons.js', icons], ['index.html', html]]) {
    const treff = hylla(kilde);
    check('fant bokhylla i ' + navn, treff.length === 1, treff.length + ' forekomster');
    if (treff.length !== 1) continue;
    const flater = [...treff[0].matchAll(/fill="(#[0-9a-f]{6})" stroke="none"/g)].map((m) => m[1]);
    const tre = flater.filter((f) => f === HYLLETRE);
    const boker = flater.filter((f) => f !== HYLLETRE);
    check('bokhylla i ' + navn + ' har platen + to braketter i EIK (' + HYLLETRE + ')',
      tre.length === 3, tre.length + ' flater');
    check('bokhylla i ' + navn + ' har nøyaktig tre bokrygger', boker.length === 3,
      boker.join(', '));
    check('bokryggene i ' + navn + ' har tre ULIKE farger', new Set(boker).size === 3,
      boker.join(', '));
    check('bokryggene i ' + navn + ' er de tre motivfargene',
      BOKFARGER.every((c) => boker.includes(c)), boker.join(', '));
  }
  check('hylletreet er ulikt mappens manila-tan', HYLLETRE !== MAPPE, HYLLETRE + ' ≠ ' + MAPPE);
}

/* ---- 10. Ingen fyllfarge utenfor det tillatte settet ---- */
for (const [navn, kilde] of [['icons.js', icons], ['index.html', html]]) {
  const ukjente = [...new Set(
    [...kilde.matchAll(/fill="([^"]+)"/g)]
      .map((m) => m[1].toLowerCase())
      .filter((v) => v !== 'currentcolor' && !LOVLIGE.has(v)),
  )];
  check('alle fyllfarger i ' + navn + ' er fra det tillatte settet',
    ukjente.length === 0,
    ukjente.length ? 'ukjente: ' + ukjente.join(', ') : 'ok');
}

/* ---- 11. De tre CSS maler om, står fortsatt ---- */
check('CSS maler om «papir», «grå» og streken (og dermed snur ikonene med drakten)',
  /\[fill="#ffffff"\]\s*\{\s*fill:\s*var\(--icon-paper\)/.test(css) &&
  /\[fill="#c0c4c9"\]\s*\{\s*fill:\s*var\(--icon-grey\)/.test(css) &&
  /\[stroke="#111"\]\s*\{\s*stroke:\s*var\(--icon-ink\)/.test(css));
// … og at ingen av motivfargene gjør det: de skal stå stille i begge draktene.
const OMMALT = new Set(['#ffffff', '#c0c4c9', '#111', '#111111', 'none']);
check('ingen CSS-regel maler om et motiv- eller palettfyll',
  [...LOVLIGE].filter((c) => !OMMALT.has(c))
    .some((c) => new RegExp('\\[fill="' + c + '"\\]').test(css)) === false);

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
