/*
  EKTE pekerinput for dra-og-slipp-testene.

  Ikke en testfil — en delt modul, som `shard.js`. Grunnen til at den finnes:

  Testene drev tidligere draget med `new PointerEvent(...)` + `dispatchEvent`.
  Det virker mot DAGENS motor, som bare leser `clientX/Y` og `pointerId` av
  hendelsen. Det slutter å virke mot dnd-kit, som kaller
  `document.body.setPointerCapture(event.pointerId)` og AVBRYTER draget hvis
  det kaster — og det gjør det alltid for en oppdiktet `pointerId`. En
  syntetisk gest ville dermed dødd stille, og testen ville sluttet å teste noe
  uten å bli rød.

  Derfor: alt her går gjennom nettleserens egen inputkø.

  - Mus: `page.mouse`, som Playwright sender som ekte input.
  - Touch: `Input.dispatchTouchEvent` over CDP. `page.touchscreen` kan bare
    `tap()`, og et drag er ikke et trykk. CDP-hendelsene er ekte input på
    nøyaktig samme måte — de får en ekte `pointerId` som kan fanges.

  Aktiveringstersklene ligger her, ett sted, slik at en test uttrykker HVA den
  gjør og ikke hvor lenge den må vente:

    HOLD_MS        200   touch/pen: holdet som skiller drag fra scroll
    HOLD_MOVE       10   touch/pen: drift som avbryter holdet
    HOLD_MOVE_MOUSE  5   mus: bevegelse som STARTER draget

  Se `docs/drag-and-drop.md`. Endres tallene der, endres de her.
*/

const HOLD_MS = 200;
const HOLD_MOVE_MOUSE = 5;

/** Litt over holdet, så en treg maskin ikke gjør et løft om til en scroll. */
const HOLD_WAIT = HOLD_MS + 140;
/** Godt forbi musterskelen, men innenfor «samme sted». */
const NUDGE = HOLD_MOVE_MOUSE + 4;

/* ------------------------------------------------------------------ måling */

/** Midtpunktet av et element, i viewport-koordinater. */
async function centre(p, selector) {
  return p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('fant ikke ' + sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

/**
 * Et punkt klart FORBI et elements senter langs y.
 *
 * Senterlinjen er nøyaktig grensen plasseringsregelen snur på, så et sikte
 * midt på lar utfallet avgjøres av avrunding. En bruker som mener «etter denne»
 * sikter ikke på grensen heller.
 */
async function past(p, selector, ratio = 0.85) {
  return p.evaluate(({ sel, ratio }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('fant ikke ' + sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * ratio };
  }, { sel: selector, ratio });
}

/* -------------------------------------------------------------------- touch */

/**
 * En berøringspeker over CDP.
 *
 * Sesjonen gjenbrukes per side: `newCDPSession` er ikke gratis, og en test som
 * gjør mange gester ville ellers åpnet en per gest.
 */
const sessions = new WeakMap();
async function cdp(p) {
  let s = sessions.get(p);
  if (!s) { s = await p.context().newCDPSession(p); sessions.set(p, s); }
  return s;
}

/** Der fingeren sist ble satt. En touchEnd bærer ingen koordinat selv. */
const lastTouch = new WeakMap();

async function touchAt(p, type, x, y) {
  const s = await cdp(p);
  /*
   * En AVBRUTT gest er alltid punktløs — CDP avviser den ellers.
   *
   * Et SLIPP kan gå begge veier, og forskjellen er verdt å kjenne: uten punkt
   * betyr det «alle fingre opp», og MED punkt slipper det nøyaktig der. Det
   * siste er det som gjør «slipp på en ny plass uten en siste bevegelse» mulig
   * å uttrykke med ekte input — hendelsen er like ekte, og pekeren har likevel
   * aldri vært innom underveis.
   */
  const ended = type === 'touchCancel' || (type === 'touchEnd' && !Number.isFinite(x));
  await s.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: ended ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  if (!ended) lastTouch.set(p, { x, y });
}

const touchStart = (p, x, y) => touchAt(p, 'touchStart', x, y);

/**
 * En ANDRE finger, mens den første alt ligger nede.
 *
 * Det er slik en sekundær peker oppstår i virkeligheten: `isPrimary` er ikke
 * noe man ber om, det er hva nettleseren kaller finger nummer to. Den første
 * må derfor faktisk ligge et sted — velg et sted som ikke selv starter noe.
 */
async function touchSecond(p, first, second) {
  const s = await cdp(p);
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: first.x, y: first.y, id: 1, radiusX: 12, radiusY: 12, force: 1 },
      { x: second.x, y: second.y, id: 2, radiusX: 12, radiusY: 12, force: 1 },
    ],
  });
  lastTouch.set(p, second);
}
const touchMove = (p, x, y) => touchAt(p, 'touchMove', x, y);
const touchEnd = (p, x, y) => touchAt(p, 'touchEnd', x, y);
const touchCancel = (p) => touchAt(p, 'touchCancel', 0, 0);

/* --------------------------------------------------------------- løft/slipp */

/** Er noe løftet akkurat nå? Motoren merker det løftede objektet. */
const liftedCount = (p) => p.evaluate(
  () => document.querySelectorAll('[data-dnd-dragging]').length,
);

/*
 * Et løft PRØVER TIL DET LYKKES, og kaster hvis det aldri gjør det.
 *
 * Klokka duger ikke som bevis: lander en synk-runde midt i holdet, tegnes raden
 * på nytt, og hold-timeren fyrer på en node som ikke er i dokumentet lenger —
 * draget starter aldri. En bruker ville tatt tak på nytt. Uten den sjekken blir
 * et mislykket løft til en test som stille måler ingenting.
 *
 * Tester som skal vise at et drag IKKE starter — sekundær peker, drift som
 * avbryter holdet — skal derfor bruke primitivene (`touchStart`, `p.mouse`)
 * direkte og påstå fraværet selv.
 */
const TRIES = 6;

/*
 * ET MISLYKKET FORSØK SKAL VERKEN ETTERLATE ET KLIKK ELLER MASE.
 *
 * To ting gjør en naiv retry verre enn ingen retry, og begge er MÅLT i
 * `dnd-drop-colour`, som drar det samme kortet åtte ganger etter hverandre:
 *
 *   • SLIPP PÅ STEDET BLIR ET KLIKK. Trykk ned og opp på samme element er
 *     nettopp det appen tolker som «åpne». I notatfanen åpnet det editoren,
 *     som la seg over brettet — og da var de tre neste forsøkene dømt.
 *     Vi flytter derfor pekeren vekk først: `click` fyrer på den nærmeste
 *     FELLES forfaren, og der sitter ingen slik lytter.
 *
 *   • Å PRØVE IGJEN MED EN GANG HJELPER IKKE. Etter et slipp kan brettet
 *     bruke tid på å bli løftbart igjen, og fire raske forsøk (~1,2 s til
 *     sammen) feilet alle, mens ETT forsøk etter en pause lyktes. Ventetiden
 *     vokser derfor for hvert forsøk, og budsjettet er romslig nok til å dekke
 *     det verste MÅLTE tilfellet: et skjermbilde tatt MIDT I et drag (som
 *     `dnd-drop-colour` må ta for å lese ekte piksler) kan låse pekerkøen i
 *     ~4,5 s etterpå. Det er en artefakt av fjernstyringen, ikke noe en bruker
 *     kan treffe — men testen må tåle den. Til sammen ~7,6 s før vi gir opp.
 */
const AWAY = { x: 3, y: 3 };
const BACKOFF = (i) => 120 + i * 700;

/** Løft med MUS: trykk ned, og flytt forbi terskelen. */
async function liftMouse(p, at) {
  for (let i = 0; i < TRIES; i++) {
    await p.mouse.move(at.x, at.y);
    await p.mouse.down();
    await p.mouse.move(at.x, at.y + NUDGE, { steps: 3 });
    await p.waitForTimeout(60);
    if (await liftedCount(p)) return { x: at.x, y: at.y + NUDGE };
    await p.mouse.move(AWAY.x, AWAY.y, { steps: 2 });
    await p.mouse.up();
    await p.waitForTimeout(BACKOFF(i));
  }
  throw new Error('musen løftet aldri objektet på ' + JSON.stringify(at));
}

/**
 * Løft med FINGER: hold stille til holdet er ferdig.
 *
 * Fingeren står i ro med vilje. Beveger den seg mer enn `HOLD_MOVE` før holdet
 * er fullført, tolker motoren det som scroll og avbryter.
 */
async function liftTouch(p, at) {
  for (let i = 0; i < TRIES; i++) {
    await touchStart(p, at.x, at.y);
    await p.waitForTimeout(HOLD_WAIT);
    if (await liftedCount(p)) return { x: at.x, y: at.y };
    // `touchCancel` gir ingen `click`, så bare ventetiden trengs her.
    await touchCancel(p);
    await p.waitForTimeout(BACKOFF(i));
  }
  throw new Error('holdet løftet aldri objektet på ' + JSON.stringify(at));
}

/** Løft med den pekeren dette løpet handler om. */
const lift = (p, at, touch) => (touch ? liftTouch(p, at) : liftMouse(p, at));

/**
 * Flytt pekeren dit, i to omganger.
 *
 * `to` er enten et PUNKT eller en funksjon som måler ett, og valget mellom dem
 * er den viktigste avgjørelsen i en drag-test:
 *
 * - **Punkt, målt FØR løftet** — for en omrokkering. Placeholderen holder
 *   plassen, så selve geometrien står stille selv om radene i den bytter plass.
 *   Sikter man i stedet på en RAD, sikter man på noe draget flytter: raden
 *   rykker oppover når det løftede objektet nærmer seg, pekeren følger etter
 *   den oppover, og gesten kommer aldri fram. Målt før løftet kan punktet ikke
 *   løpe fra pekeren.
 * - **Funksjon** — for et mål som faktisk ikke flytter seg, men som må måles
 *   sent: en søppelkasse, bunnen av en container, et element etter en scroll.
 *
 * To presiseringer som har kostet tid:
 *
 * - **Løftet kan selv endre layouten.** Et LISTE-/OMRÅDE-drag kollapser alle
 *   kortene idet det starter, så et punkt målt før løftet peker et helt annet
 *   sted etterpå. Der måles målet ETTER løftet — men fortsatt bare én gang.
 * - **Sikt på SENTERET av sloten objektet skal ende i**, ikke forbi naboen. Et
 *   objekt som bytter plass med naboen TAR naboens slot, og naboen tar dens:
 *   sikter man forbi naboen, ligger punktet etter byttet i sloten under, og
 *   objektet fortsetter nedover. Senteret av målsloten står stille gjennom
 *   byttet, og er derfor det ene punktet som uttrykker «hit».
 *
 * To omganger uansett, fordi board-et kan auto-scrolle under pekeren mens den
 * er underveis.
 */
async function travel(p, measure, touch, { steps = 12, settle = 180 } = {}) {
  let point;
  for (const n of [steps, 2]) {
    point = typeof measure === 'function' ? await measure() : measure;
    if (touch) {
      // CDP sender ett punkt per kall; en gest med bare start og slutt gir
      // motoren ingen bevegelse å følge.
      const from = lastTouch.get(p) || point;
      for (let i = 1; i <= n; i++) {
        await touchMove(p, from.x + (point.x - from.x) * (i / n),
          from.y + (point.y - from.y) * (i / n));
      }
    } else {
      await p.mouse.move(point.x, point.y, { steps: n });
    }
    await p.waitForTimeout(settle);
  }
  return point;
}

/**
 * Slipp der pekeren står — eller et annet sted, om testen ber om det.
 *
 * `at` er valgfri, og skal stort sett utelates: slippet hører hjemme der
 * gesten faktisk endte. Sender testen et punkt den målte på nytt, slipper den
 * et annet sted enn den dro til — og motoren lar `pointerup`-posisjonen avgjøre
 * plasseringen, så forskjellen er hele utfallet.
 */
async function drop(p, at, touch) {
  const point = at || lastTouch.get(p);
  if (touch) await touchEnd(p, point ? point.x : 0, point ? point.y : 0);
  else await p.mouse.up();
  await p.waitForTimeout(320);
}

/*
 * Å AVBRYTE en gest er bare mulig for ekte på touch (`touchCancel`).
 *
 * En mus har ingen tilsvarende ekte hendelse, og dagens motor avbryter ikke på
 * Escape — så et musedrag ender med et slipp. En oppdiktet `pointercancel` er
 * nettopp det denne modulen finnes for å bli kvitt, og den ville dessuten ikke
 * matche pekeren dnd-kit har fanget. Tester som trenger en avbrytelse, tar den
 * på touch.
 */

/**
 * Ett steg av en gest, i den formen de eldre testene er skrevet rundt.
 *
 * De uttrykker et drag som en rekke diskrete pekerhendelser, med sine egne
 * ventinger mellom. Formen er grei nok — det var LEVERINGEN som var problemet.
 * Denne sender nøyaktig den samme sekvensen gjennom nettleserens inputkø, så
 * et helt filsett kan bli ekte uten å skrives om setning for setning.
 *
 * Ny kode bør heller bruke `lift`/`travel`/`drop`: de venter på at løftet
 * faktisk skjedde, og de har regelen om å sikte på et punkt målt før løftet.
 */
async function sendPointer(p, type, x, y, kind) {
  const touch = kind !== 'mouse';
  if (type === 'pointerdown') {
    if (touch) return touchStart(p, x, y);
    await p.mouse.move(x, y);
    return p.mouse.down();
  }
  if (type === 'pointermove') {
    return touch ? touchMove(p, x, y) : p.mouse.move(x, y);
  }
  if (type === 'pointerup') {
    if (touch) return touchEnd(p, x, y);
    await p.mouse.move(x, y);
    return p.mouse.up();
  }
  // pointercancel: ekte på touch, og på mus finnes det ikke — der er slippet
  // den eneste ekte måten gesten kan ta slutt på.
  return touch ? touchCancel(p) : p.mouse.up();
}

/**
 * Hele gesten: løft her, dra dit, slipp.
 *
 * `to` kan være et punkt eller en funksjon som måler ett — bruk funksjonen når
 * målet flytter seg under draget, som det stort sett gjør.
 */
async function dragFromTo(p, from, to, { touch = false } = {}) {
  await lift(p, from, touch);
  const at = await travel(p, to, touch);
  await drop(p, undefined, touch);
  return at;
}

module.exports = {
  HOLD_MS, HOLD_MOVE_MOUSE, HOLD_WAIT, NUDGE,
  centre, past,
  touchStart, touchMove, touchEnd, touchCancel, touchSecond,
  liftedCount, lift, liftMouse, liftTouch,
  travel, drop, dragFromTo, sendPointer,
};
