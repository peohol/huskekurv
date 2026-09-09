#!/usr/bin/env node
/* ============================================================
   VARSELIKONENE — generatoren.

   Ikke en test. Dette er skriptet som LAGER rasterfilene systemvarslene
   bruker, og det står her fordi det deler verktøy (Playwright) og
   kjøremønster med testene, og fordi `build.js` ikke skal publisere det.

   Kilden til merket er `favicon.svg`, alltid. Skriptet leser den, og de to
   PNG-ene faller ut av den ene filen:

     assets/notif/huskis-icon-192.png   — `icon` i et web push-varsel.
        Merket i FULL FARGE, gjennomsiktig bakgrunn, og skalert ned om sitt
        eget sentrum slik at HELE merket ligger innenfor den innskrevne
        sirkelen i flaten. Android (og Samsungs One UI særlig) maskerer det
        store varselikonet til en sirkel, og et merke som fyller kvadratet får
        da hjørnene klippet av. 0.86 er valgt fordi merket med strek spenner
        18.3 av 24 enheter, og 18.3 × 0.86 × √2 < 24.

     assets/notif/huskis-badge-96.png   — `badge` i et web push-varsel.
        En ALFAMASKE: Android kaster fargene og tegner formen i statuslinjens
        egen. Den fargelagte logoen ble derfor en hvit klump — alt som ikke var
        gjennomsiktig ble hvitt, og de mørke konturene som BÆRER motivet
        forsvant. Masken er derfor en egen tegning av det samme motivet: bare
        konturer, tykke nok til 24 dp, med de tre punktene og linjene i det
        fremste kortet og to kortHJØRNER bak det.

   Den samme masken er `ic_stat_huskis.xml` på Android. Geometrien står ETT
   sted — `BADGE` under — og `tests/notif-channels.test.js` sjekker at
   nøyaktig de banene finnes i vector-drawable-en. Da kan de to ikke skli fra
   hverandre.

   Android-varselets store ikon (`largeIcon`) er den samme fargelagte
   rasteren, kopiert til `android/app/src/main/res/drawable-nodpi/`. Pluginen
   dekoder den med `BitmapFactory.decodeResource`, som ikke kan lese en
   vector-drawable — derfor en PNG, og `nodpi` fordi den skal brukes som den
   er uansett skjermtetthet.

   Kjør:
     NODE_PATH=$(npm root -g) node tests/lag-varselikoner.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Hvor mye merket krymper i det fargelagte ikonet. Se kommentaren over: nok
   til at en sirkulær maske ikke klipper hjørnene av kortene. */
const IKON_SKALA = 0.86;

/* Strekbredden merket rasteriseres med, i favicon-ens eget 24-rutenett. Se
   `ikonSvg()`: webappens merke har 1 px strek uansett visningsstørrelse, og
   den regelen må skrus av her — en 192 px raster trenger en strek som
   skalerer med tegningen. */
const IKON_STREK = 0.9;

/* MASKEN, i favicon-ens eget 24-rutenett — men med sine egne mål.

   Motivet er det samme: det fremste kortet med tre punkter og tre linjer, og
   to kort delvis synlige bak det. Målene er ikke de samme, og skal ikke være
   det: favicon-ens tre kort er FYLTE, så det fremste dekker de to bak. En
   maske har ingen fyll å dekke med — alt som tegnes blir synlig — så de bakre
   kortene er her de HJØRNENE som ville stukket fram, og det fremste kortet er
   gjort større for at tre rader punkt + linje skal kunne leses ved 24 dp.

   Klaringene er regnet ut for nettopp den størrelsen: 3 enheter mellom
   kortene minus 1.6 i strek gir 1.4 enheters luft, og 3.2 mellom radene minus
   1.5 gir 1.7. Under det går strekene i ett. */
const BADGE = {
  strekKort: 1.6,
  strekRad: 1.5,
  prikkR: 0.85,
  /* Bakerst, midterst, fremst. De to første er hjørner, den siste et helt
     kort. Rekkefølgen er den samme som i favicon.svg. */
  kort: [
    'M10,2 H5 A3,3 0 0 0 2,5 V10',
    'M13,5 H8 A3,3 0 0 0 5,8 V13',
    'M11,8 H19 A3,3 0 0 1 22,11 V19 A3,3 0 0 1 19,22 H11 A3,3 0 0 1 8,19 V11 A3,3 0 0 1 11,8 Z',
  ],
  // De tre radene i det fremste kortet: punktet og linjen ved siden av det.
  radY: [11.8, 15, 18.2],
  prikkX: 11.6,
  linje: [14.2, 19.2],
};

// Et fylt punkt som BANE, ikke som <circle>: den samme strengen skal kunne
// stå både i SVG-en og i Androids `pathData`.
function prikkBane(cx, cy, r) {
  return 'M' + (cx - r) + ',' + cy + ' a' + r + ',' + r + ' 0 1,0 ' + (2 * r) +
    ',0 a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0 Z';
}
function linjeBane(y) {
  return 'M' + BADGE.linje[0] + ',' + y + ' H' + BADGE.linje[1];
}
// Banene i den rekkefølgen begge filene skriver dem.
function badgeBaner() {
  return {
    kort: BADGE.kort.slice(),
    prikker: BADGE.radY.map((y) => prikkBane(BADGE.prikkX, y, BADGE.prikkR)),
    linjer: BADGE.radY.map(linjeBane),
  };
}

function faviconKropp() {
  const svg = fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
  const i = svg.indexOf('>', svg.indexOf('<svg'));
  return svg.slice(i + 1, svg.lastIndexOf('</svg>')).trim();
}

function ikonSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 24 24">' +
    '<g transform="translate(12 12) scale(' + IKON_SKALA + ') translate(-12 -12)">' +
    faviconKropp() + '</g>' +
    /* Skrur AV favicon-ens `non-scaling-stroke` for denne ene rasteren. I
       appen skal merket ha 1 px strek uansett størrelse
       (docs/design-system.md → «Ikoner»), men her tegnes det 192 px bredt og
       skal SES som et varselikon: 1 px av 192 er ikke en kontur, det er
       ingenting. Rasteren vil ha en strek som skalerer med tegningen, og
       IKON_STREK er den bredden i favicon-ens eget 24-rutenett. */
    '<style>* { vector-effect: none; stroke-width: ' + IKON_STREK + '; }</style>' +
    '</svg>';
}

function badgeSvg() {
  const b = badgeBaner();
  const strek = (d, w) => '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="' + w +
    '" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24">' +
    b.kort.map((d) => strek(d, BADGE.strekKort)).join('') +
    b.prikker.map((d) => '<path d="' + d + '" fill="#fff"/>').join('') +
    b.linjer.map((d) => strek(d, BADGE.strekRad)).join('') +
    '</svg>';
}

/* Androids statuslinje-ikon: den samme masken som vector drawable. Skrives
   herfra så de to ikke kan skli fra hverandre. */
function statIkonXml() {
  const b = badgeBaner();
  const strek = (d, w) => '    <path\n        android:pathData="' + d + '"\n' +
    '        android:strokeColor="#FFFFFF"\n        android:strokeWidth="' + w + '"\n' +
    '        android:strokeLineCap="round"\n        android:strokeLineJoin="round" />\n';
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  STATUSLINJE-IKONET for native varsler (docs/varsler.md).

  GENERERT av tests/lag-varselikoner.js — rediger geometrien der, ikke her.
  Den samme masken rasteriseres til assets/notif/huskis-badge-96.png, som web
  push bruker som \`badge\`. Begge steder er motivet det samme, og
  tests/notif-channels.test.js sjekker at banene er identiske.

  Uten dette bruker @capacitor/local-notifications Androids egen
  \`ic_dialog_info\` — et fremmed systemikon i statuslinjen på hvert eneste
  Huskis-varsel.

  Et statuslinje-ikon er en MASKE: Android kaster fargene og tegner formen i
  sin egen. Derfor ingen fyllflater — en fylt logo blir en uformelig klump —
  men KONTURER: det fremste kortet med sine tre punkter og linjer, og to
  kortHJØRNER bak det. Målene er favicon-ens motiv tilpasset 24 dp, ikke
  favicon-ens egne mål: der dekker de fylte kortene hverandre, her må hvert
  synlig ledd tegnes for seg og ha luft rundt seg.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
${b.kort.map((d) => strek(d, BADGE.strekKort)).join('')}${b.prikker.map((d) =>
    '    <path\n        android:pathData="' + d + '"\n        android:fillColor="#FFFFFF" />\n').join('')}${
  b.linjer.map((d) => strek(d, BADGE.strekRad)).join('')}</vector>
`;
}

async function raster(svg, bredde, høyde, ut) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: bredde, height: høyde },
    deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><style>html,body{margin:0;padding:0;' +
    'background:transparent}</style>' + svg);
  const buf = await page.screenshot({ omitBackground: true });
  fs.writeFileSync(ut, buf);
  await browser.close();
  console.log('✓ ' + path.relative(ROOT, ut) + '  (' + buf.length + ' byte)');
}

async function main() {
  const notif = path.join(ROOT, 'assets', 'notif');
  fs.mkdirSync(notif, { recursive: true });
  const ikon = path.join(notif, 'huskis-icon-192.png');
  await raster(ikonSvg(), 192, 192, ikon);
  await raster(badgeSvg(), 96, 96, path.join(notif, 'huskis-badge-96.png'));

  // Androids store varselikon er nøyaktig den samme rasteren.
  const nodpi = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi');
  fs.mkdirSync(nodpi, { recursive: true });
  const stor = path.join(nodpi, 'ic_huskis_notification.png');
  fs.copyFileSync(ikon, stor);
  console.log('✓ ' + path.relative(ROOT, stor));

  const stat = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable',
    'ic_stat_huskis.xml');
  fs.writeFileSync(stat, statIkonXml());
  console.log('✓ ' + path.relative(ROOT, stat));
}

module.exports = { BADGE, badgeBaner, IKON_SKALA };

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
