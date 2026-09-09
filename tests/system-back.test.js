/*
  Regresjonstest: SYSTEMETS TILBAKEKNAPP (Android).

  Det native skallet (`android/.../MainActivity.java`) spør web-laget først, og
  lar OS ta trykket når svaret er false. Denne testen kjører den funksjonen
  skallet kaller — `window.__huskisSystemBack()` — i ekte nettleser, og dekker:

    1. Gaten: i en vanlig nettleser finnes broen IKKE. Den settes bare opp når
       `window.Capacitor.isNativePlatform()` sier at vi kjører i skallet
       (docs/mobilapp-plan.md, arkitekturregel 2).
    2. Ingenting åpent ⇒ false. Det er dette som gjør at appen fortsatt kan
       forlates med tilbakeknappen; en stige som alltid svarer true ville låst
       brukeren inne.
    3. Ett lag per trykk, ovenfra og ned: objektmenyen over nav-modalen lukkes
       først, nav-modalen står igjen, neste trykk tar den.
    4. Søppelkasse- og konto-modalen lukkes av ett trykk.
    5. Del-modalen er den ene forskjellen mot Escape: med `backTo` går
       tilbakeknappen ETT NIVÅ tilbake (nav-modalen åpnes igjen), mens Escape
       fortsatt lukker helt — «lukk = ferdig» (docs/menus.md). Varsel-
       innstillingene er det samme mønsteret ett hakk ned: et nivå INNE i
       varselmodalen, ikke en egen modal (docs/varsler.md).
    6. En pågående inline-redigering avbrytes, og trykket når ikke laget bak:
       uten dette ville appen kunne avsluttes midt i en navngiving.
    7. Demonstrasjonen: tilbakeknappen rører den ikke (samme regel som Escape i
       `demoGate`) — den svarer false, så trykket blir et vanlig «forlat appen».
    8. Notat-editoren og panelene i den: et åpent lenke-/spesialtegnpanel er
       ETT TRINN over editoren, ikke ved siden av den. Regresjon: panelene sto
       kun i editorens egen Escape-lytter, så tilbakeknappen hoppet rett forbi
       dem og lukket hele bildet med panelet åpent (docs/notater-plan.md,
       docs/tilgjengelighet.md).

  Kjør:
    python3 -m http.server 8000                     # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/system-back.test.js
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
  }, null, { timeout: 15000, polling: 200 });
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForTimeout(150);
}

// Ett område, én mappe, én liste med ett listepunkt, og en liste i søpla så
// søppelkasse-knappen finnes.
async function seed(p) {
  await p.evaluate(() => {
    const H = window.__huskis, st = H.state;
    const mk = (o) => Object.assign({ ts: 1, org: 't', pos: 0, posTs: 1, posOrg: 't',
      trashed: false, _role: 'owner' }, o);
    st.universes.length = 0;
    const u = mk({ id: 'UNI', name: 'Hjemme', collapsed: false, groups: [] });
    const g = mk({ id: 'GRP', uni: 'UNI', name: 'Ukesplan', cat: null, isCat: false, collapsed: false, cards: [] });
    const c1 = mk({ id: 'L1', group: 'GRP', title: 'Handleliste', collapsed: false, items: [] });
    c1.items.push(mk({ id: 'I1', home: 'L1', text: 'Melk', cat: null, isCat: false }));
    g.cards.push(c1);
    g.cards.push(mk({ id: 'L2', group: 'GRP', title: 'Kastet', collapsed: false, items: [], pos: 1,
      trashed: true, trashedAt: Date.now() }));
    u.groups.push(g);
    st.universes.push(u);
    st.activeUniverse = 'UNI'; st.activeGroup = 'GRP';
    H.render();
  });
  await p.waitForTimeout(350);
}

// Broen slik skallet kaller den. Returnerer true når Huskis tok trykket.
const back = (p) => p.evaluate(() => window.__huskisSystemBack());
// Hva som står åpent nå.
const lag = (p) => p.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden; };
  return {
    nav: vis('nav-modal'), konto: vis('account-modal'), soppel: vis('trash-modal'),
    del: vis('share-modal'), meny: vis('obj-menu'),
    editor: vis('note-editor'), lenkepanel: vis('note-link-panel'),
    symbolpanel: vis('note-symbol-panel'),
    redigerer: !!document.querySelector('.edit-input'),
  };
});
const ingenting = (s) => !s.nav && !s.konto && !s.soppel && !s.del && !s.meny
  && !s.editor && !s.redigerer;

async function run(label, viewport, touchMode) {
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({ viewport }, touchMode ? { hasTouch: true, isMobile: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await register(p);

  /* ---------- 1) Gaten ---------- */
  const iBrowser = await p.evaluate(() => ({
    bro: typeof window.__huskisSystemBack,
    cap: typeof window.Capacitor,
    // Selve stigen finnes uansett — det er BROEN som er plattformspesifikk.
    fn: typeof window.__huskis.systemBack,
  }));
  log(label + ': nettleseren har ingen Capacitor-runtime', iBrowser.cap === 'undefined', iBrowser.cap);
  log(label + ': broen settes IKKE opp i nettleseren', iBrowser.bro === 'undefined', iBrowser.bro);
  log(label + ': stigen finnes likevel i appen', iBrowser.fn === 'function', iBrowser.fn);

  // Last på nytt som «native»: skallet injiserer sin egen bro før sidens
  // skript kjører, akkurat som `addInitScript` gjør her. Sesjonen ligger i
  // sessionStorage, så vi er fortsatt innlogget.
  await ctx.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true };
  });
  await p.reload();
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 15000, polling: 200 });
  await p.waitForTimeout(200);
  const iSkallet = await p.evaluate(() => ({
    bro: typeof window.__huskisSystemBack,
    samme: window.__huskisSystemBack === window.__huskis.systemBack,
  }));
  log(label + ': broen settes opp i det native skallet', iSkallet.bro === 'function', iSkallet.bro);
  log(label + ': broen ER stigen (ingen egen kopi)', iSkallet.samme === true, String(iSkallet.samme));

  await seed(p);

  /* ---------- 2) Ingenting åpent ⇒ OS tar trykket ---------- */
  const tomt = await back(p);
  const etterTomt = await lag(p);
  log(label + ': ingenting åpent ⇒ false (OS forlater appen)', tomt === false, String(tomt));
  log(label + ': og ingenting ble åpnet av trykket', ingenting(etterTomt), JSON.stringify(etterTomt));

  /* ---------- 3) Ett lag per trykk ---------- */
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(200);
  await p.locator('#nav-board .card[data-id="UNI"] .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  const stablet = await lag(p);
  log(label + ': objektmenyen ligger over nav-modalen', stablet.meny && stablet.nav,
    JSON.stringify(stablet));

  const t1 = await back(p); await p.waitForTimeout(200);
  const etter1 = await lag(p);
  log(label + ': første trykk lukker bare objektmenyen', t1 === true && !etter1.meny && etter1.nav,
    JSON.stringify(etter1));

  const t2 = await back(p); await p.waitForTimeout(200);
  const etter2 = await lag(p);
  log(label + ': andre trykk lukker nav-modalen', t2 === true && !etter2.nav, JSON.stringify(etter2));

  const t3 = await back(p);
  log(label + ': tredje trykk faller gjennom til OS', t3 === false, String(t3));

  /* ---------- 4) Søppelkassen og konto-modalen ---------- */
  await p.locator('#trash-btn').click();
  await p.waitForTimeout(300);
  const soppelApen = (await lag(p)).soppel;
  const t4 = await back(p); await p.waitForTimeout(200);
  log(label + ': søppelkasse-modalen lukkes av ett trykk',
    soppelApen && t4 === true && !(await lag(p)).soppel, String(soppelApen));

  await p.evaluate(() => window.__huskis.openAccount());
  await p.waitForTimeout(200);
  const t5 = await back(p); await p.waitForTimeout(200);
  log(label + ': konto-modalen lukkes av ett trykk', t5 === true && !(await lag(p)).konto);

  /* ---------- 5) Del-modalen: ett nivå tilbake, ikke helt ut ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    const u = H.state.universes[0];
    H.openShare('universe', u.id, u, () => H.openNavModal());
  });
  await p.waitForTimeout(300);
  const delApen = await lag(p);
  const t6 = await back(p); await p.waitForTimeout(250);
  const etterDel = await lag(p);
  log(label + ': tilbakeknappen tar del-modalen ETT nivå tilbake (nav-modalen igjen)',
    delApen.del && t6 === true && !etterDel.del && etterDel.nav, JSON.stringify(etterDel));
  await back(p); await p.waitForTimeout(200); // rydd: lukk nav-modalen

  // Escape beholder sin egen oppførsel: lukk = ferdig, helt ut til hovedsiden.
  await p.evaluate(() => {
    const H = window.__huskis;
    const u = H.state.universes[0];
    H.openShare('universe', u.id, u, () => H.openNavModal());
  });
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const etterEsc = await lag(p);
  log(label + ': Escape lukker del-modalen HELT (ingen nav-modal bak)',
    !etterEsc.del && !etterEsc.nav, JSON.stringify(etterEsc));

  /* ---------- 5b) Varselinnstillingene: ETT nivå tilbake, som del-modalen ----------
     Innstillingene er et nivå INNE i varselmodalen, ikke en egen modal, så et
     tilbaketrykk der hører hjemme på varslene. Escape lukker fortsatt helt. */
  await p.evaluate(() => window.__huskis.openNotifModal());
  await p.waitForTimeout(250);
  await p.locator('#notif-settings-btn').click();
  await p.waitForTimeout(250);
  const iInnstillinger = await p.evaluate(() => ({
    åpen: !document.getElementById('notif-modal').hidden,
    tittel: document.getElementById('notif-title-text').textContent,
  }));
  const t6b = await back(p); await p.waitForTimeout(250);
  const etterInnst = await p.evaluate(() => ({
    åpen: !document.getElementById('notif-modal').hidden,
    tittel: document.getElementById('notif-title-text').textContent,
  }));
  log(label + ': tilbakeknappen tar varselinnstillingene ETT nivå tilbake (varslene igjen)',
    iInnstillinger.tittel === 'Varselinnstillinger' && t6b === true &&
    etterInnst.åpen === true && etterInnst.tittel === 'Varsler', JSON.stringify(etterInnst));
  const t6c = await back(p); await p.waitForTimeout(250);
  log(label + ': neste trykk lukker varselmodalen',
    t6c === true && (await p.evaluate(() => document.getElementById('notif-modal').hidden)) === true);

  // Escape fra innstillingene lukker HELT, som i del-modalen.
  await p.evaluate(() => window.__huskis.openNotifModal());
  await p.waitForTimeout(250);
  await p.locator('#notif-settings-btn').click();
  await p.waitForTimeout(250);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  log(label + ': Escape lukker varselmodalen HELT, også fra innstillingene',
    (await p.evaluate(() => document.getElementById('notif-modal').hidden)) === true);

  /* ---------- 6) Inline-redigering ---------- */
  await p.locator('.item[data-id="I1"] .item-text').click();
  await p.waitForTimeout(250);
  const redigerer = (await lag(p)).redigerer;
  await p.evaluate(() => { const i = document.querySelector('.edit-input'); i.value = 'Melk og brød'; });
  const t7 = await back(p); await p.waitForTimeout(250);
  const etterRed = await p.evaluate(() => ({
    redigerer: !!document.querySelector('.edit-input'),
    tekst: (window.__huskis.state.universes[0].groups[0].cards[0].items[0] || {}).text,
  }));
  log(label + ': redigering pågår før trykket', redigerer === true, String(redigerer));
  log(label + ': trykket avbryter redigeringen og stopper der',
    t7 === true && !etterRed.redigerer && etterRed.tekst === 'Melk',
    JSON.stringify(etterRed));

  /* ---------- 7) Demonstrasjonen ---------- */
  await p.evaluate(() => window.__huskis.tour.start());
  await p.waitForTimeout(400);
  const demoFor = await p.evaluate(() => window.__huskis.tour.active);
  const t8 = await back(p); await p.waitForTimeout(200);
  const demoEtter = await p.evaluate(() => window.__huskis.tour.active);
  log(label + ': demonstrasjonen kjører før trykket', demoFor === true, String(demoFor));
  log(label + ': tilbakeknappen rører ikke demonstrasjonen (false, demoen står)',
    t8 === false && demoEtter === true, 'aktiv etter: ' + demoEtter);
  await p.evaluate(() => window.__huskis.tour.end());
  await p.waitForTimeout(200);

  /* ---------- 8) Notat-editoren: panelet er ett trinn over bildet ---------- */
  const nyttNotat = await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const pr = H.addNoteProject();
    H.setActiveProject(pr.id);
    H.setActiveNoteFolder(null);
    const n = H.addNote();          // åpner editoren med det samme
    return n.id;
  });
  await p.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  await p.waitForTimeout(200);

  for (const [navn, cmd, felt] of [['lenke', 'link', 'lenkepanel'], ['spesialtegn', 'symbol', 'symbolpanel']]) {
    await p.evaluate((c) => window.__huskis.runNoteCommand(c), cmd);
    await p.waitForTimeout(250);
    const før = await lag(p);
    log(label + ': ' + navn + '-panelet står åpent i editoren før trykket',
      før.editor === true && før[felt] === true, JSON.stringify(før));
    const tA = await back(p); await p.waitForTimeout(250);
    const etterA = await lag(p);
    log(label + ': første trykk lukker BARE ' + navn + '-panelet — editoren står',
      tA === true && etterA[felt] === false && etterA.editor === true, JSON.stringify(etterA));
  }
  const tB = await back(p); await p.waitForTimeout(400);
  const etterB = await lag(p);
  log(label + ': neste trykk lukker editoren', tB === true && etterB.editor === false,
    JSON.stringify(etterB));
  const tC = await back(p); await p.waitForTimeout(250);
  log(label + ': og deretter faller trykket gjennom til OS igjen', tC === false, String(tC));
  await p.evaluate((id) => window.__huskis.deleteNoteObject('note', id), nyttNotat);
  await p.evaluate(() => window.__huskis.setMainTab('lists'));
  await p.waitForTimeout(250);

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await b.close();
}

(async () => {
  // Stigen er ren logikk, men tilbakeknappen ER en mobilfunksjon: begge
  // viewportene kjøres, så en popover som blir et ark på mobil ikke endrer
  // hvilket lag som lukkes.
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);

  const fail = results.filter((r) => !r).length;
  console.log('\n==== ' + (results.length - fail) + '/' + results.length + ' PASS ====');
  process.exit(fail === 0 ? 0 : 1);
})();
