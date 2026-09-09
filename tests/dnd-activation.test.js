/*
  Regresjonstest: AKTIVERING av draget + AUTORITATIV SLUTTPLASSERING.

  1. Draget starter ved AKTUELL pekerposisjon (ikke pointerdown-punktet), så
     objektet ikke rykker tilbake til nedtrykkspunktet ved første bevegelse.
  2. Liten touch-drift FØR holdet er ferdig gir ikke et offset ved løft.
  3. En sekundær peker (isPrimary === false) starter aldri et drag.
  4. Et raskt `pointerup` på en NY plass — uten en siste `pointermove` — lander
     der det ble sluppet, for liste, listepunkt, mappe OG område.
     Slippet er EKTE: et `touchEnd` bærer punktet det slipper i, så gesten er
     ekte input og pekeren har likevel aldri vært innom underveis. Det er
     nettopp fraværet av den siste bevegelsen som gjør at bare slippets egne
     koordinater kan gi riktig plassering.
  5. En RENDRING MENS MOTOREN AVSLUTTER ET SLIPP dreper ikke raden. Rendringen
     bytter ut hver eneste node, og synken mot dnd-kits register lar motoren
     være i fred når den ikke er i ro — men da er synken UTSATT, ikke forkastet.
     Uten det ble raden liggende uløftbar helt til noe annet tilfeldigvis
     rendret på nytt (i praksis: neste lagring).

  Gestene er EKTE input (`tests/dnd-gestures.js`).

  Kjør:
    python3 -m http.server 8000                    # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-activation.test.js
*/
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

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
  // `lastMy` settes først når get_my_doc har svart — da er kontoen innlogget
  // og dokumentet hentet. (En fersk konto har null områder — board er tomt.)
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  // Introduksjonen (docs/introduksjon.md) møter enhver ny konto: omvisningen
  // legger seg over appen, og et gest-tips legger seg nederst på skjermen —
  // ingen av delene er det denne testen handler om.
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

/* Trykk og hold til objektet FAKTISK er løftet — `liftTouch` prøver på nytt
   hvis en synk-runde tegner raden om midt i holdet, slik en bruker ville. */
const holdOn = (p, x, y) => G.liftTouch(p, { x, y });

/* Et lite SIDEVEIS nikk ved KILDEN før et slipp langt unna.
   Det er nikket som gjør påstanden skarp: etter det finnes det en behandlet
   bevegelse, og den ligger ved kilden. Lander objektet likevel nede ved
   slippunktet, kan bare slippets egne koordinater ha bestemt det — motoren har
   ikke sett noen bevegelse dit. Sideveis, fordi det ikke kan endre rekkefølgen
   i en loddrett liste. */
const nudge = (p, at) => G.touchMove(p, at.x + 12, at.y);

// cards = [[tittel, antall listepunkter], …]
async function seed(p, cards) {
  await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate((cards) => {
    const H = window.__huskis, st = H.state;
    const u = st.universes.find((x) => x.id === st.activeUniverse);
    const g = u.groups.find((x) => x.id === st.activeGroup);
    const mk = () => ({ ts: 0, org: 't', pos: 0, posTs: 0, posOrg: 't' });
    g.cards = cards.map(([title, n], pos) => {
      const id = 'card-' + title;
      const c = Object.assign({ id, group: g.id, title, trashed: false, k: true, p: true, labTs: 0, labOrg: 't', items: [] }, mk());
      c.pos = pos;
      for (let i = 0; i < n; i++) {
        const it = Object.assign({ id: 'it-' + title + '-' + i, text: title + ' ' + i, home: id, cat: null, trashed: false, done: false }, mk());
        it.pos = i; c.items.push(it);
      }
      return c;
    });
    H.render();
  }, cards);
  await p.waitForTimeout(300);
}

// Ekte pekerinput, i den steg-for-steg-formen denne fila er skrevet rundt.
const pointer = (p, type, x, y) => G.sendPointer(p, type, x, y, 'touch');

const centerOf = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, h: r.height };
}, sel);

// Avstanden fra pekeren til det løftede objektets SENTER. Senteret er upåvirket
// av rotate/scale (de skjer om senteret), så dette er grepets faktiske offset.
const grabOffset = (p, sel, py) => p.evaluate(({ sel, py }) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return py - (r.top + r.height / 2);
}, { sel, py });

const cardOrder = (p) => p.evaluate(() => [...document.querySelectorAll('.board .card')].map((c) => c.dataset.id));
const itemOrder = (p, cardId) => p.evaluate((id) => [...document.querySelectorAll('.card[data-id="' + id + '"] .items-container > .item')].map((i) => i.dataset.id), cardId);

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

(async () => {
  const b = await chromium.launch();

  /* ===== 1) Mus: draget starter der pekeren ER, ikke der den ble trykket ned ===== */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 6], ['B', 6]]);

    const src = await centerOf(p, '.item[data-id="it-A-3"]');
    await p.mouse.move(src.x, src.y);
    await p.mouse.down();
    // ETT stort hopp: draget starter i dette punktet (terskel 5 px for mus).
    await p.mouse.move(src.x, src.y - 40); await p.waitForTimeout(80);
    const lifted = await p.evaluate(() => document.querySelectorAll('#board .item[data-dnd-dragging]').length);
    // Hendelsen som AKTIVERER draget bærer ikke også flyttingen: dnd-kit maler
    // objektet på hvileplassen den ene framen, og under pekeren fra og med neste.
    // Med en ekte musestrøm er det ett steg på noen få piksler; her er hoppet 40,
    // og målingen må derfor starte etter at draget faktisk er i gang.
    await p.mouse.move(src.x, src.y - 39); await p.waitForTimeout(60);
    const off1 = await grabOffset(p, '#board .item[data-dnd-dragging]', src.y - 39);
    // Én piksel videre: med gammelt grep (målt fra pointerdown) ville objektet
    // hoppet ~39 px her; med nytt grep følger det pekeren.
    await p.mouse.move(src.x, src.y - 41); await p.waitForTimeout(60);
    const off2 = await grabOffset(p, '#board .item[data-dnd-dragging]', src.y - 41);
    log('1 mus: draget er i gang', lifted === 1, 'dragging=' + lifted);
    log('1 mus: ingen rykk tilbake til pointerdown-punktet (grepet er stabilt)',
      Math.abs(off2 - off1) < 2, 'off1=' + off1.toFixed(1) + ' off2=' + off2.toFixed(1));
    await p.mouse.up(); await p.waitForTimeout(400);
    log('1 mus: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 2) Touch: drift under holdet gir ikke offset ved løft ===== */
  {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 6]]);

    const src = await centerOf(p, '.item[data-id="it-A-3"]');
    await pointer(p, 'pointerdown', src.x, src.y);
    // 8 px drift — under HOLD_MOVE (10), så holdet overlever.
    await pointer(p, 'pointermove', src.x, src.y - 8); await p.waitForTimeout(280);
    const lifted = await p.evaluate(() => document.querySelectorAll('#board .item[data-dnd-dragging]').length);
    // Se test 1: første bevegelse etter aktiveringen er den som maler objektet
    // under fingeren. Grepet måles fra og med den.
    await pointer(p, 'pointermove', src.x, src.y - 7); await p.waitForTimeout(60);
    const off1 = await grabOffset(p, '#board .item[data-dnd-dragging]', src.y - 7);
    await pointer(p, 'pointermove', src.x, src.y - 9); await p.waitForTimeout(60);
    const off2 = await grabOffset(p, '#board .item[data-dnd-dragging]', src.y - 9);
    log('2 touch: holdet overlevde driften og løftet objektet', lifted === 1, 'dragging=' + lifted);
    log('2 touch: ingen offset ved løft (grepet følger fingeren)',
      Math.abs(off2 - off1) < 2, 'off1=' + off1.toFixed(1) + ' off2=' + off2.toFixed(1));
    await pointer(p, 'pointerup', src.x, src.y - 9); await p.waitForTimeout(400);
    log('2 touch: ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 3) Sekundær peker (multitouch) starter aldri et drag ===== */
  {
    const p = await b.newPage({ viewport: { width: 420, height: 820 }, hasTouch: true, isMobile: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 6]]);

    const src = await centerOf(p, '.item[data-id="it-A-2"]');
    // Én finger ligger allerede på toppmenyen (som ikke starter noe), så
    // fingeren på raden er nettopp det en sekundær peker ER: nummer to.
    const rest = await centerOf(p, '#topbar');
    await G.touchSecond(p, rest, src);
    await p.waitForTimeout(320); // godt forbi HOLD_MS
    const state = await p.evaluate(() => ({
      dragging: document.querySelectorAll('[data-dnd-dragging]').length,
      hold: document.querySelectorAll('.drag-hold').length,
      ph: document.querySelectorAll('.card-placeholder, .new-list-placeholder, [data-dnd-placeholder]').length,
    }));
    log('3 sekundær peker: ingen drag, ingen press-feedback, ingen placeholder',
      state.dragging === 0 && state.hold === 0 && state.ph === 0, JSON.stringify(state));
    await G.touchEnd(p);
    await p.waitForTimeout(150);
    log('3 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 4) Raskt slipp på en ny plass UTEN en siste pointermove ===== */
  for (const M of [{ n: 'desktop', vw: 1000, vh: 900, mob: false }, { n: 'mobil', vw: 420, vh: 820, mob: true }]) {
    const p = await b.newPage({ viewport: { width: M.vw, height: M.vh }, hasTouch: true, isMobile: M.mob });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p);

    /* --- 4a) LISTEPUNKT: løft, så rett pointerup nede på et annet punkt --- */
    await seed(p, [['A', 6]]);
    const before = await itemOrder(p, 'card-A');
    const src = await centerOf(p, '.item[data-id="it-A-0"]');
    await holdOn(p, src.x, src.y); // holdet fullføres → draget starter i nedtrykkspunktet
    const dst = await centerOf(p, '.item[data-id="it-A-4"]');
    await nudge(p, src);
    await G.touchEnd(p, src.x, dst.y + 4); // INGEN pointermove mot slippunktet
    await p.waitForTimeout(500);
    const after = await itemOrder(p, 'card-A');
    log('4 ' + M.n + ' listepunkt: raskt slipp flyttet punktet ned forbi it-A-4',
      after.indexOf('it-A-0') > after.indexOf('it-A-4') && after.length === before.length,
      before.join(',') + ' → ' + after.join(','));

    /* --- 4b) LISTE --- */
    await seed(p, [['P', 3], ['Q', 3], ['R', 3]]);
    const cBefore = await cardOrder(p);
    const h = await centerOf(p, '.card[data-id="card-P"] .card-head');
    await holdOn(p, h.x, h.y); // hold → draget starter, ALLE lister kollapser
    // Mål mål-listas hode ETTER kollapsen (layouten er en annen nå).
    const target = await centerOf(p, '.card[data-id="card-R"] .card-head');
    await nudge(p, h);
    await G.touchEnd(p, target.x, target.y + 4); // INGEN pointermove mot slippunktet
    await p.waitForTimeout(900);
    const cAfter = await cardOrder(p);
    log('4 ' + M.n + ' liste: raskt slipp flyttet lista forbi card-R',
      cAfter.indexOf('card-P') > cAfter.indexOf('card-R') && cAfter.length === cBefore.length,
      cBefore.join(',') + ' → ' + cAfter.join(','));

    /* --- 4c) MAPPE (rad i et område-kort i nav-modalen) --- */
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addGroup(); }); await p.waitForTimeout(200);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    const uSel = '#nav-board .card[data-id="' + await p.evaluate(() => window.__huskis.state.activeUniverse) + '"]';
    const gIds = await p.evaluate((sel) => [...document.querySelectorAll(sel + ' .items-container > .item')].map((g) => g.dataset.id), uSel);
    const g1 = await centerOf(p, uSel + ' .item[data-id="' + gIds[0] + '"]');
    const g3 = await centerOf(p, uSel + ' .item[data-id="' + gIds[2] + '"]');
    await holdOn(p, g1.x, g1.y);
    await nudge(p, g1);
    await G.touchEnd(p, g1.x, g3.y + 4); // INGEN pointermove mot slippunktet
    await p.waitForTimeout(500);
    // Lest fra STATE, ikke fra DOM: et ekte slipp på en annen rad gir et ekte
    // klikk på den raden etterpå, og dra-sonens klikk-sperre sitter på KILDENS
    // sone — så nav-modalen rekker å navigere bort. Rekkefølgen som betyr noe er
    // den lagrede uansett, og den overlever at modalen lukker seg.
    const gAfter = await p.evaluate(() => {
      const st = window.__huskis.state;
      const u = st.universes.find((x) => x.id === st.activeUniverse);
      return u.groups.filter((g) => !g.trashed).slice().sort((a, b) => a.pos - b.pos).map((g) => g.id);
    });
    log('4 ' + M.n + ' mappe: raskt slipp flyttet raden forbi den tredje',
      gAfter.indexOf(gIds[0]) > gAfter.indexOf(gIds[2]) && gAfter.length === gIds.length,
      gIds.join(',') + ' → ' + gAfter.join(','));

    /* --- 4d) OMRÅDE (kort i nav-modalen) --- */
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => { window.__huskis.addUniverse(); }); await p.waitForTimeout(200);
      await p.keyboard.press('Escape'); await p.waitForTimeout(180);
    }
    await p.evaluate(() => { window.__huskis.openNavModal(); }); await p.waitForTimeout(400);
    // «＋ Område» ruller det nye (siste) området inn i syne — rull tilbake til
    // toppen så de to kortene vi sikter på faktisk ligger i modalens synlige felt.
    await p.evaluate(() => { document.querySelector('#nav-modal .menu-body').scrollTop = 0; });
    await p.waitForTimeout(150);
    const uIds = await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')].map((u) => u.dataset.id));
    const u1 = await centerOf(p, '#nav-board .card[data-id="' + uIds[0] + '"] .card-head');
    await holdOn(p, u1.x, u1.y);
    // Mål mål-kortets hode ETTER løftet, som i 4b: alle kortene kollapser, og
    // modalens fot vokser med søppelkassen, så layouten er en helt annen nå.
    const u3 = await centerOf(p, '#nav-board .card[data-id="' + uIds[2] + '"] .card-head');
    await nudge(p, u1);
    await G.touchEnd(p, u1.x, u3.y + 4); // INGEN pointermove mot slippunktet
    await p.waitForTimeout(500);
    const uAfter = await p.evaluate(() => [...document.querySelectorAll('#nav-board .card')].map((u) => u.dataset.id));
    log('4 ' + M.n + ' område: raskt slipp flyttet raden forbi den tredje',
      uAfter.indexOf(uIds[0]) > uAfter.indexOf(uIds[2]) && uAfter.length === uIds.length,
      uIds.join(',') + ' → ' + uAfter.join(','));

    log('4 ' + M.n + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===== 5) En rendring MENS slippet avsluttes dreper ikke raden ===== */
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await register(p); await seed(p, [['A', 4]]);

    // Løft og slipp på samme sted. I det motoren går inn i `dropped` — altså
    // mens slippanimasjonen kjører — rendrer vi board-et på nytt. Det er
    // nøyaktig det svaret fra skyen gjør når lagringen fra slippet lander:
    // hver node byttes ut mens dnd-kit ennå ikke er i ro.
    const at = await centerOf(p, '.item[data-id="it-A-1"]');
    await G.liftMouse(p, { x: at.x, y: at.y });

    // Vakten armes FØR slippet og rendrer hver frame så lenge motoren står i
    // `dropped`. Én rendring holder ikke som prøve: treffer den den FØRSTE
    // frame-en, rekker sikkerhetsnettet etter slippet
    // (`boardRelayoutAfterRowDrop`) å synke når motoren blir i ro like etter,
    // og hullet lukker seg av seg selv. Det nettet kjører ÉN gang. Feilen er
    // rendringen som kommer ETTER den — og den fanges bare hvis vi holder på
    // ut animasjonen.
    await p.evaluate(() => {
      const H = window.__huskis;
      const m = H.boardRowBoard.manager;
      const t0 = performance.now();
      window.__rendringer = 0;
      const tick = () => {
        if (m.dragOperation.status.current === 'dropped') {
          H.render();
          window.__rendringer++;
        } else if (window.__rendringer) {
          return;                                   // animasjonen er over
        } else if (performance.now() - t0 > 3000) {
          return;                                   // sikkerhetsnett
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await p.mouse.up();
    await p.waitForFunction(() => window.__rendringer > 0, null, { timeout: 4000, polling: 16 })
      .catch(() => {});
    const rendringer = await p.evaluate(() => window.__rendringer);
    log('5 board-et ble rendret mens motoren fortsatt sto i «dropped»',
      rendringer > 0, 'rendringer=' + rendringer);

    // Vent til motoren er i ro OG den utsatte synken har fått kjøre.
    await p.waitForFunction(
      () => window.__huskis.boardRowBoard.manager.dragOperation.status.idle,
      null, { timeout: 4000, polling: 30 });
    await p.waitForTimeout(200);

    const registrert = await p.evaluate(() => {
      const el = document.querySelector('.item[data-id="it-A-1"]');
      const dr = [...window.__huskis.boardRowBoard.manager.registry.draggables];
      return { reg: dr.some((d) => d.element === el), n: dr.length };
    });
    log('5 raden står i dnd-kits register etter rendringen',
      registrert.reg === true, JSON.stringify(registrert));

    // Og det som teller: den lar seg faktisk løfte igjen.
    const at2 = await centerOf(p, '.item[data-id="it-A-1"]');
    await p.mouse.move(at2.x, at2.y);
    await p.mouse.down();
    await p.mouse.move(at2.x, at2.y + G.NUDGE, { steps: 3 });
    await p.waitForTimeout(90);
    const løftet = await G.liftedCount(p);
    await p.mouse.up();
    await p.waitForTimeout(300);
    log('5 raden lar seg løfte igjen uten at noe annet har rendret',
      løftet === 1, 'dragging=' + løftet);

    log('5 ingen JS-feil', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
