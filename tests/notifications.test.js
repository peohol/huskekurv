/*
  Regresjonstest: VARSELGENERATOREN (docs/varsler.md). Modalen har sin egen fil
  (`notif-modal.test.js`); her testes reglene og synkingen.

  `collectNotifications(state, now, prefs, cursor)` er en ren funksjon — `now`,
  preferansene og markøren er alle EKSPLISITTE, så terskler, grenser og
  catch-up kan testes uten systemklokken og uten å vente på noe.

  Fikstur og «nå»: nettleseren står i Europe/Oslo, og NÅ er 2026-06-15 kl.
  12:00 lokal tid. Hver liste isolerer én regel.

  Dekker:
     1. De fire tersklene, med de EKSAKTE grensene fra PR 2: en frist som
        utløper nøyaktig nå, en frist nøyaktig sju døgn fram (der
        «under en uke»-terskelen er nøyaktig nå), og en som ligger lenger ute.
     2. Dato uten klokkeslett: frist = døgnets slutt, start = døgnets
        begynnelse — den samme `timeMs()`-semantikken som resten av appen.
     3. Markøren: vinduet er (markør, nå]. En terskel som allerede ligger bak
        markøren gir ingen rad, og markør = null (første runde) gir ingenting.
     4. Catch-up: markøren tretti døgn tilbake logger BEGGE tersklene til en
        frist som først kom innenfor uka og siden gikk ut — hver med sin egen
        faktiske terskeltid.
     5. De fire preferansene, hver for seg: en avslått type lager ingen rad.
     6. Fullføring: alt avkrysset før terskelen → ingen rad; krysses av etter
        at raden finnes → raden blir stående.
     7. Arv og deduplisering er hendelsesmotorens, ikke en ny kopi: et
        listepunkt med rent arvet tid får ingen egen rad.
     8. Identitet: nøkkelen bærer tidsverdien, så en ENDRET frist er et nytt
        logisk varsel — og den gamle verdien varsler ikke om igjen.
     9. Hele veien gjennom serveren: første runde setter bare markøren, en
        runde logger radene, og en ny runde med samme tilstand gir ingen
        duplikater.
    10. To enheter (to faner mot den samme databasen) som genererer samtidig
        gir ÉN rad — den unike nøkkelen (bruker + nøkkel) er andre lag.
    11. Sletting av historikken gjenskaper den ikke: markøren står foran
        tersklene, så «Tøm varsler» er permanent.
    13. Levetiden: en rad som ble historikk for mer enn 30 døgn siden slettes
        automatisk og vises ikke. Den måles fra det SENESTE av `createdAt` og
        `at`, så verken en plan framover, en fersk rad om en gammel hendelse
        eller en planlagt rad som nettopp ringte rammes.

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notifications.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x !== '' ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const KEYS = ['UA', 'GA',
  'LUTLØPT', 'LNÅ', 'LSJU', 'LSENERE', 'LSTART', 'LSTARTSJU', 'LDATO', 'LSTARTDATO',
  'LFERDIG', 'LLÅS', 'LENDRET',
  'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'I09', 'I10', 'I11', 'I12'];

/* Fikstur. NÅ = 2026-06-15 kl. 12:00.
     08.06 kl. 12:00 = nøyaktig sju døgn TILBAKE
     22.06 kl. 12:00 = nøyaktig sju døgn FRAM */
function buildDB() {
  const uid = 'uV';
  const id = {};
  KEYS.forEach((k) => { id[k] = U(); });
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    start_at: null, due_at: null, lock_times: false,
    ts: 1, org: 'v', pos: 0, pos_ts: 1, pos_org: 'v',
  }, x);
  const card = (i, t, e) => base(Object.assign(
    { id: i, owner_id: uid, group_id: id.GA, title: t, k: true, p: true, lab_ts: 0, lab_org: '' }, e || {}));
  const item = (i, c, t, e) => base(Object.assign(
    { id: i, owner_id: uid, card_id: c, text: t, done: false }, e || {}));

  return { id, uid, db: {
    _rolesBackfilled: true,
    profiles: [{ id: uid, email: 'v@x.no', display_name: 'Varsel', user_metadata: {} }],
    passwords: { 'v@x.no': 'x' },
    universes: [base({ id: id.UA, owner_id: uid, name: 'Arbeid' })],
    groups: [base({ id: id.GA, owner_id: uid, universe_id: id.UA, name: 'Klinikk' })],
    cards: [
      // Fristen gikk ut i går kl. 18: BEGGE tersklene ligger bak oss.
      card(id.LUTLØPT, 'Utløpt', { due_at: '2026-06-14T18:00' }),
      // Utløper NØYAKTIG nå.
      card(id.LNÅ, 'Nøyaktig nå', { pos: 1, due_at: '2026-06-15T12:00' }),
      // Nøyaktig sju døgn fram → «under en uke»-terskelen er nøyaktig nå.
      card(id.LSJU, 'Nøyaktig sju', { pos: 2, due_at: '2026-06-22T12:00' }),
      // Åtte døgn fram → terskelen ligger ett døgn FRAM i tid.
      card(id.LSENERE, 'Senere', { pos: 3, due_at: '2026-06-23T12:00' }),
      // Starter nøyaktig nå, og nøyaktig sju døgn fram.
      card(id.LSTART, 'Start nå', { pos: 4, start_at: '2026-06-15T12:00' }),
      card(id.LSTARTSJU, 'Start sju', { pos: 5, start_at: '2026-06-22T12:00' }),
      // Dato UTEN klokkeslett: fristen varer ut døgnet, starten begynner 00:00.
      card(id.LDATO, 'Fristdato', { pos: 6, due_at: '2026-06-15' }),
      card(id.LSTARTDATO, 'Startdato', { pos: 7, start_at: '2026-06-15' }),
      // Alt avkrysset → ingen hendelse, altså heller ikke noe varsel.
      card(id.LFERDIG, 'Ferdig', { pos: 8, due_at: '2026-06-14T12:00' }),
      // Listen låser tidene → listepunktets tid er ren arv.
      card(id.LLÅS, 'Listelås', { pos: 9, due_at: '2026-06-14T12:00', lock_times: true }),
      // Til identitetstesten: fristen flyttes underveis.
      card(id.LENDRET, 'Endret', { pos: 10, due_at: '2026-06-14T12:00' }),
    ],
    items: [
      item(id.I01, id.LUTLØPT, 'Punkt'),
      item(id.I02, id.LNÅ, 'Punkt'),
      item(id.I03, id.LSJU, 'Punkt'),
      item(id.I04, id.LSENERE, 'Punkt'),
      item(id.I05, id.LSTART, 'Punkt'),
      item(id.I06, id.LSTARTSJU, 'Punkt'),
      item(id.I07, id.LDATO, 'Punkt'),
      item(id.I08, id.LSTARTDATO, 'Punkt'),
      item(id.I09, id.LFERDIG, 'Gjort', { done: true }),
      item(id.I10, id.LLÅS, 'Arvet punkt'),
      item(id.I11, id.LENDRET, 'Punkt'),
      item(id.I12, id.LUTLØPT, 'Punkt to', { pos: 1 }),
    ],
    memberships: [{ id: U(), user_id: uid, universe_id: id.UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
    share_invites: [], tombstones: [], notifications: [], notification_prefs: [],
  } };
}

async function seed(p, db, uid) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'v@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  /* `lastMy` alene er ikke nok her. Preferanseraden lages av den FØRSTE
     genereringen (`notify_record`), så det aller første `get_my_doc` svarer med
     `notify_prefs: null` — helt riktig, men en tilstand ingen av sjekkene i
     denne filen handler om. Ventingen går derfor på selve preferansene, som er
     signalet på at varselveien har vært hele runden gjennom. */
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0 && !!H.notifPrefs;
  }, null, { timeout: 15000, polling: 200 });
}

// Én synk-runde, og vent til den har landet i klientens varselliste.
async function cycle(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return !el || el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 100 }).catch(() => {});
  await p.waitForTimeout(350);
}

/* Setter markøren i mock-databasen til et ABSOLUTT tidspunkt. Fiksturens
   tider er faste (juni 2026), mens serverveien kjører på den ekte klokka —
   en markør «N døgn tilbake» ville derfor blitt meningsløs etter hvert som
   kalenderen går videre. `1` er så langt tilbake som det går. */
async function setCursor(p, at) {
  // `_edit` og ikke `_loadDB`+`_saveDB`: del 10 har to faner oppe samtidig, og
  // en runde derfra imellom de to skrittene ville skrevet markøren tilbake.
  await p.evaluate(async (v) => {
    await window.HK_MOCK._edit((db) => {
      db.notification_prefs.forEach((r) => { r.cursor_at = v; });
    });
  }, at);
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const { id, uid, db } = buildDB();
  await seed(p, db, uid);

  // NÅ regnes i SIDEN, så det er den samme lokale veggtiden motoren bruker.
  const NOW = await p.evaluate(() => new Date(2026, 5, 15, 12, 0, 0, 0).getTime());
  const DAY = 24 * 3600 * 1000;
  const ALLE = { dueOver: true, dueSoon: true, startNow: true, startSoon: true };

  // Generatoren med et gitt vindu → «type:navn», sortert som den returnerer.
  const gen = (cursorBack, prefs) => p.evaluate(({ now, back, prefs }) =>
    window.__huskis.collectNotifications(null, now, prefs, now - back)
      .map((r) => r.type + ':' + r.name),
  { now: NOW, back: cursorBack, prefs: prefs || ALLE });

  /* ---------- 1) De fire tersklene og de eksakte grensene ---------- */
  // Ett døgn tilbake: bare det som passerte det siste døgnet.
  const siste = await gen(DAY);
  log('1a: en frist som utløp i går ligger i vinduet',
    siste.includes('dueOver:Utløpt'), JSON.stringify(siste));
  log('1b: en frist som utløper NØYAKTIG nå er passert (terskel <= nå)',
    siste.includes('dueOver:Nøyaktig nå'), JSON.stringify(siste));
  log('1c: nøyaktig sju døgn fram → «under en uke»-terskelen er nøyaktig nå',
    siste.includes('dueSoon:Nøyaktig sju'), JSON.stringify(siste));
  log('1d: åtte døgn fram gir INGEN terskel ennå — ingen hull, ingen forskudd',
    !siste.some((x) => x.indexOf('Senere') > -1), JSON.stringify(siste));
  log('1e: en start nøyaktig nå har begynt',
    siste.includes('startNow:Start nå'), JSON.stringify(siste));
  log('1f: en start nøyaktig sju døgn fram gir «begynner om mindre enn en uke»',
    siste.includes('startSoon:Start sju'), JSON.stringify(siste));

  /* ---------- 2) Dato uten klokkeslett ---------- */
  log('2a: en FRISTDATO uten klokkeslett varer ut døgnet — den er ikke utløpt kl. 12',
    !siste.includes('dueOver:Fristdato'), JSON.stringify(siste));
  log('2b: … men «under en uke»-terskelen for den passerte for en uke siden',
    !siste.includes('dueSoon:Fristdato'), JSON.stringify(siste));
  const uke = await gen(8 * DAY);
  log('2c: … og den fanges når vinduet er åtte døgn',
    uke.includes('dueSoon:Fristdato'), JSON.stringify(uke));
  log('2d: en STARTDATO uten klokkeslett begynner 00:00, altså tidligere i dag',
    siste.includes('startNow:Startdato'), JSON.stringify(siste));

  /* ---------- 3) Markøren er vinduets nedre kant ---------- */
  const ingen = await gen(0);
  log('3a: markør = nå gir ingen varsler (vinduet er tomt)', eq(ingen, []), JSON.stringify(ingen));
  const førsteRunde = await p.evaluate(({ now, prefs }) =>
    window.__huskis.collectNotifications(null, now, prefs, null).length, { now: NOW, prefs: ALLE });
  log('3b: markør = null (første runde på kontoen) genererer ingenting',
    førsteRunde === 0, String(førsteRunde));
  const time = await gen(3600 * 1000);
  log('3c: et vindu på én time tar med det som utløp nøyaktig nå, men ikke i går',
    time.includes('dueOver:Nøyaktig nå') && !time.includes('dueOver:Utløpt'), JSON.stringify(time));

  /* ---------- 4) Catch-up ---------- */
  const lenge = await gen(30 * DAY);
  const utløpt = lenge.filter((x) => x.indexOf(':Utløpt') > -1).sort();
  log('4a: tretti døgn tilbake logger BEGGE tersklene til den utløpte fristen',
    eq(utløpt, ['dueOver:Utløpt', 'dueSoon:Utløpt']), JSON.stringify(utløpt));
  const tider = await p.evaluate(({ now, prefs }) => {
    const rows = window.__huskis.collectNotifications(null, now, prefs, now - 30 * 86400000);
    const r = rows.filter((x) => x.name === 'Utløpt');
    return r.map((x) => x.type + '=' + (x.at - new Date(2026, 5, 14, 18, 0, 0, 0).getTime()));
  }, { now: NOW, prefs: ALLE });
  log('4b: hver rad bærer sin EGEN faktiske terskeltid (fristen, og uka før den)',
    eq(tider.sort(), ['dueOver=0', 'dueSoon=' + (-7 * DAY)]), JSON.stringify(tider));

  /* ---------- 5) De fire preferansene ---------- */
  for (const type of ['dueOver', 'dueSoon', 'startNow', 'startSoon']) {
    const av = Object.assign({}, ALLE); av[type] = false;
    const rows = await gen(30 * DAY, av);
    const medAlt = await gen(30 * DAY, ALLE);
    log('5: «' + type + '» slått av fjerner nøyaktig den typen',
      !rows.some((x) => x.indexOf(type + ':') === 0) &&
      medAlt.some((x) => x.indexOf(type + ':') === 0) &&
      rows.length < medAlt.length,
      rows.length + ' av ' + medAlt.length);
  }
  const ingenting = await gen(30 * DAY, { dueOver: false, dueSoon: false, startNow: false, startSoon: false });
  log('5e: alle fire av gir ingen varsler i det hele tatt', eq(ingenting, []), JSON.stringify(ingenting));

  /* ---------- 6) Fullføring ---------- */
  log('6a: en liste der ALT er avkrysset gir ingen varsler',
    !lenge.some((x) => x.indexOf('Ferdig') > -1), JSON.stringify(lenge.filter((x) => x.indexOf('Ferdig') > -1)));

  /* ---------- 7) Arv og deduplisering er motorens ---------- */
  const arv = lenge.filter((x) => x.indexOf('Listelås') > -1 || x.indexOf('Arvet punkt') > -1);
  log('7: et listepunkt med rent ARVET frist gir ingen egen rad — bare listen',
    eq(arv.sort(), ['dueOver:Listelås', 'dueSoon:Listelås']), JSON.stringify(arv));

  /* ---------- 8) Identiteten bærer tidsverdien ---------- */
  const nøkler = await p.evaluate(({ now, prefs, cardId }) => {
    const H = window.__huskis;
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.id === cardId);
    const før = H.collectNotifications(null, now, prefs, now - 30 * 86400000)
      .filter((r) => r.name === 'Endret').map((r) => r.key);
    kort.due_at = undefined;
    kort.due = '2026-06-13T12:00';   // flyttet ETT døgn tidligere
    const etter = H.collectNotifications(null, now, prefs, now - 30 * 86400000)
      .filter((r) => r.name === 'Endret').map((r) => r.key);
    kort.due = '2026-06-14T12:00';
    return { før: før, etter: etter };
  }, { now: NOW, prefs: ALLE, cardId: id.LENDRET });
  log('8a: nøkkelen inneholder tidsverdien',
    nøkler.før.every((k) => k.indexOf('|2026-06-14T12:00') > -1), JSON.stringify(nøkler.før));
  log('8b: en ENDRET frist gir nye nøkler — altså et nytt logisk varsel',
    nøkler.etter.length === nøkler.før.length &&
    !nøkler.etter.some((k) => nøkler.før.includes(k)), JSON.stringify(nøkler.etter));

  /* ---------- 9) Hele veien gjennom serveren ---------- */
  const etterFørsteRunde = await p.evaluate(() => ({
    rows: window.__huskis.notifRows.length,
    cursor: window.__huskis.notifCursor,
    prefs: window.__huskis.notifPrefs,
  }));
  log('9a: første runde setter bare markøren — historikken er tom',
    etterFørsteRunde.rows === 0 && etterFørsteRunde.cursor > 0,
    JSON.stringify(etterFørsteRunde));
  log('9b: preferansene kommer fra serveren med alle fire PÅ',
    eq(etterFørsteRunde.prefs, ALLE), JSON.stringify(etterFørsteRunde.prefs));

  await setCursor(p, 1);
  await cycle(p);
  await cycle(p);
  const logget = await p.evaluate(() => window.__huskis.notifRows.map((r) => r.type + ':' + r.name));
  log('9c: en runde med markøren helt tilbake logger radene',
    logget.length > 0 && logget.includes('dueOver:Utløpt'), JSON.stringify(logget));
  const antall = logget.length;
  await cycle(p);
  await cycle(p);
  const igjen = await p.evaluate(() => window.__huskis.notifRows.length);
  log('9d: en ny runde med samme tilstand gir INGEN duplikater',
    igjen === antall, antall + ' → ' + igjen);

  /* ---------- 6b) Fullført ETTER at varselet finnes ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.title === 'Utløpt');
    kort.items.forEach((it) => { it.done = true; });
    H.save();
  });
  await cycle(p);
  await cycle(p);
  const etterAvkryssing = await p.evaluate(() => window.__huskis.notifRows.map((r) => r.type + ':' + r.name));
  log('6b: et varsel blir stående i historikken selv om objektet fullføres etterpå',
    etterAvkryssing.includes('dueOver:Utløpt'), JSON.stringify(etterAvkryssing));

  /* ---------- 10) To enheter genererer ikke duplikater ---------- */
  // Ny fikstur i en ren kontekst, så tellingen er entydig.
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 },
    timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
  const a = await ctx2.newPage();
  a.on('pageerror', (e) => errs.push('fane A: ' + e.message));
  const f2 = buildDB();
  await seed(a, f2.db, f2.uid);
  const b = await ctx2.newPage();
  b.on('pageerror', (e) => errs.push('fane B: ' + e.message));
  // Fane B deler localStorage (databasen) med A, men har sin egen sesjon.
  await b.evaluate(() => {}).catch(() => {});
  await b.goto(BASE + '/?mock=1');
  await b.evaluate((uid) => {
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'v@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' }, tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, f2.uid);
  await b.goto(BASE + '/?mock=1');
  await b.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });

  await setCursor(a, 1);
  // Begge fanene kjører en runde «samtidig» — de leser den samme markøren.
  await Promise.all([
    a.evaluate(() => window.__huskis.cloudCycle()),
    b.evaluate(() => window.__huskis.cloudCycle()),
  ]);
  await a.waitForTimeout(900);
  await cycle(a);
  const nøkkelTelling = await a.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    const keys = db.notifications.map((n) => n.user_id + '|' + n.key);
    return { rader: db.notifications.length, unike: new Set(keys).size };
  });
  log('10: to enheter som genererer samtidig gir ÉN rad per logisk varsel',
    nøkkelTelling.rader > 0 && nøkkelTelling.rader === nøkkelTelling.unike,
    JSON.stringify(nøkkelTelling));

  /* ---------- 11) En tømt historikk kommer ikke tilbake ---------- */
  const førTømming = await a.evaluate(() => window.__huskis.notifRows.length);
  await a.evaluate(() => {
    const db = window.HK_MOCK._loadDB();
    db.notifications = [];
    window.HK_MOCK._saveDB(db);
  });
  await cycle(a);
  await cycle(a);
  const etterTømming = await a.evaluate(() => window.__huskis.notifRows.length);
  log('11: markøren står foran tersklene, så en tømt historikk gjenskapes ikke',
    førTømming > 0 && etterTømming === 0, førTømming + ' → ' + etterTømming);

  /* ---------- 12) Markøren rykker fram også på en TOM runde ---------- */
  /* Uten det ville markøren blitt stående der siste logging skjedde, og vinduet
     (markør, nå] dekket hele perioden siden. En frist som SETTES til et
     tidspunkt i den perioden ville da blitt varslet med det samme — stikk i
     strid med regelen om at varsler gjelder terskler appen har SETT passere. */
  await setCursor(a, Date.now() - 10 * 60 * 1000);   // eldre enn taket (5 min)
  await cycle(a);
  await cycle(a);
  const markør = await a.evaluate(() => ({
    markør: window.__huskis.notifCursor,
    nå: Date.now(),
    rader: window.__huskis.notifRows.length,
  }));
  log('12a: en runde uten noe å logge rykker likevel markøren fram når den er gammel',
    markør.nå - markør.markør < 60 * 1000 && markør.rader === 0,
    'markøren er ' + Math.round((markør.nå - markør.markør) / 1000) + ' s gammel, ' +
      markør.rader + ' rader');

  // …og da varsler ikke en frist som settes til et tidspunkt FØR den.
  await a.evaluate(() => {
    const H = window.__huskis;
    const kort = H.state.universes[0].groups[0].cards.find((c) => c.title === 'Endret');
    const d = new Date(Date.now() - 7 * 60 * 1000);
    const to = (n) => String(n).padStart(2, '0');
    H.setObjectTime({ obj: kort, card: kort }, 'due',
      d.getFullYear() + '-' + to(d.getMonth() + 1) + '-' + to(d.getDate()) +
      'T' + to(d.getHours()) + ':' + to(d.getMinutes()));
  });
  await cycle(a);
  await cycle(a);
  const etterFortid = await a.evaluate(() => window.__huskis.notifRows.map((r) => r.type + ':' + r.name));
  log('12b: en frist satt til et tidspunkt som ALT var passert varsler ikke',
    etterFortid.length === 0, JSON.stringify(etterFortid));

  /* ---------- 13) Levetiden: 30 døgn, og ikke valgfritt ----------
     Radene skrives rett i mock-databasen, som serveren gjør: poenget er en rad
     som har fått LIGGE og bli gammel. Levetiden måles fra det SENESTE av
     `created_at` og `at` — fra da raden ble historikk — og de tre siste radene
     her er hver sin grunn til at ingen av de to tidene duger alene.

     Radene peker på EKTE lister med de tidene de faktisk har, ellers ville
     opprydningen av «varsler som ikke gjelder lenger» tatt dem før levetiden
     rakk å si noe (docs/varsler.md). */
  const MND = 30 * 24 * 3600 * 1000;
  await a.evaluate(({ ids, mnd }) => {
    const db = window.HK_MOCK._loadDB();
    const nå = Date.now();
    const uid = db.profiles[0].id;
    const rad = (key, name, type, objId, value, at, created, snoozed) => ({
      id: key, user_id: uid, key: key, type: type, obj_type: 'card',
      obj_id: objId, name: name, path: 'x', value: value,
      at: at, snoozed: !!snoozed, created_at: created, read_at: null,
    });
    db.notifications = [
      // Ringte for lenge siden OG ble skrevet for lenge siden → skal bort.
      rad('gammel', 'Gammel', 'dueOver', ids.LUTLØPT, '2026-06-14T18:00',
        nå - mnd - 2000, nå - mnd - 2000),
      // Så vidt innenfor levetiden → blir stående.
      rad('nesten', 'Nesten', 'dueSoon', ids.LUTLØPT, '2026-06-14T18:00',
        nå - mnd + 3600000, nå - mnd + 3600000),
      // Gammel rad som ennå ikke har ringt (et utsatt varsel) → ikke historikk.
      rad('planlagt', 'Planlagt', 'dueOver', ids.LNÅ, '2026-06-15T12:00',
        nå + 3600000, nå - mnd - 2000, true),
      /* Fersk rad om en 90 døgn gammel hendelse → skal vises, den er ny for meg.
         Bare `at` ville slettet den i den samme runden den ble logget. */
      rad('etterslep', 'Etterslep', 'dueSoon', ids.LNÅ, '2026-06-15T12:00',
        nå - 90 * 24 * 3600 * 1000, nå - 1000),
      /* Planen legges opp en måned fram, så en rad ved horisontens ytterkant er
         allerede en måned gammel i det den ringer. Bare `created_at` ville
         ryddet den bort i nøyaktig det øyeblikket den ble relevant. */
      rad('nyringt', 'Nyringt', 'dueOver', ids.LUTLØPT, '2026-06-14T18:00',
        nå - 2000, nå - mnd - 2000),
    ];
    window.HK_MOCK._saveDB(db);
  }, { ids: { LUTLØPT: f2.id.LUTLØPT, LNÅ: f2.id.LNÅ }, mnd: MND });
  // Markøren gammel nok til at runden faktisk SKRIVER — opprydningen skjer i
  // den samme operasjonen som loggingen.
  await setCursor(a, Date.now() - 10 * 60 * 1000);
  await cycle(a);
  await cycle(a);
  const levetid = await a.evaluate(() => ({
    vist: window.__huskis.notifRows.map((r) => r.name).sort(),
    iBasen: window.HK_MOCK._loadDB().notifications.map((n) => n.name).sort(),
  }));
  log('13a: en rad som ble historikk for mer enn 30 døgn siden vises ikke',
    !levetid.vist.includes('Gammel'), JSON.stringify(levetid.vist));
  log('13b: … og den er faktisk SLETTET på serveren, ikke bare skjult',
    !levetid.iBasen.includes('Gammel'), JSON.stringify(levetid.iBasen));
  log('13c: en rad så vidt innenfor levetiden blir stående',
    levetid.vist.includes('Nesten'), JSON.stringify(levetid.vist));
  log('13d: en rad som ennå ikke har ringt er ikke historikk og røres ikke, uansett alder',
    levetid.iBasen.includes('Planlagt'), JSON.stringify(levetid.iBasen));
  log('13e: en fersk rad om en GAMMEL hendelse blir stående — den er ikke sett ennå',
    levetid.vist.includes('Etterslep'), JSON.stringify(levetid.vist));
  log('13f: en PLANLAGT rad som nettopp ringte overlever at den ble LAGT for en måned siden',
    levetid.vist.includes('Nyringt') && levetid.iBasen.includes('Nyringt'),
    JSON.stringify(levetid.iBasen));

  log('ingen JS-feil', errs.length === 0, errs.join(' | '));
  await ctx2.close();
  await browser.close();
}

run().then(() => {
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
