/*
  Regresjonstest: ET OMRÅDEKORTS `pos` REGNES ALLTID INNENFOR SIN EGEN SEKSJON.

  Nav-modalen deler områdene i tre seksjoner — «Mine områder», «Områder delt
  med meg» og «Mapper delt med meg». Den siste er et VIRTUELT kort som samler
  mapper man har en direkte rolle i, og det har `pos: Infinity` fordi det alltid
  skal ligge sist.

  Rekkefølgen er personlig og lagres på min egen medlemskapsrad. `renderNav`
  sorterer på seksjon FØR pos, så en pos hentet over en seksjonsgrense flytter
  ingenting dit man ser — den importerer bare en fremmed verdi inn i seksjonen.
  Og en pos regnet mot det virtuelle kortet blir `between(Infinity, null)` =
  `Infinity`, som ikke overlever JSON: medlemskapet lagres med `pos: null` og
  brukerens egen rekkefølge er borte. Tastaturet (`moveCtx`) har alltid fulgt
  seksjonsregelen; draget gjør det nå også.

  Dekker:
    1. Et eget område dratt NEDENFOR ALT (forbi det virtuelle kortet) får en
       endelig pos, lagres på medlemskapsraden, og havner sist i sin EGEN
       seksjon — ikke etter det virtuelle kortet.
    2. Et delt område dratt helt til toppen blir først blant DE DELTE, ikke
       plassert etter en pos lånt fra «Mine områder».
    3. En mappe dratt ut i lufta lager et nytt område med en endelig pos, også
       når det virtuelle kortet ligger nederst i kolonnen.

  Kjøres på BÅDE desktop- og mobil-viewport: plassering under et drag avhenger
  av layout og pekertype.

  Kjør:
    python3 -m http.server 8000                          # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/dnd-nav-sections.test.js
*/
'use strict';
const { chromium } = require('playwright');
const G = require('./dnd-gestures.js');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : ''));
};

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur: A eier alt som deles.
     UA   — A eier; JEG har ingen rolle i området, bare i mappen GB
            (direkte mapperolle → den frie, VIRTUELLE beholderen)
     US1  — A eier; jeg er medlem  → «Områder delt med meg»
     US2  — A eier; jeg er medlem  → «Områder delt med meg»
     UD1  — jeg eier               → «Mine områder»
     UD2  — jeg eier               → «Mine områder»
   Rollene ligger i memberships, slik databasen ville hatt dem. */
function buildDB() {
  const uA = U(), me = U();
  const UA = U(), GB = U(), US1 = U(), US2 = U(), UD1 = U(), UD2 = U();
  const GS1 = U(), GS2 = U(), GD1 = U(), GD2 = U();
  const base = (x) => Object.assign({
    trashed: false, locked: false, unlocked: false, invite_policy: 'inherit',
    collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const mem = (user, on, role, pos) => Object.assign(
    { id: U(), user_id: user, universe_id: null, group_id: null, role, pos: pos || 0, created_at: 1 }, on);
  return {
    ids: { me, UA, GB, US1, US2, UD1, UD2, GD1 },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: me, email: 'meg@x.no', display_name: 'Mia Meg', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'meg@x.no': 'x' },
      // Alle kortene UNNTATT det som skal ekstraheres fra står kollapset, slik
      // at hele kolonnen får plass i begge viewport — et kort som ligger under
      // folden kan ikke løftes med ekte pekerinput.
      universes: [
        base({ id: UA, owner_id: uA, name: 'Alices område', collapsed: true }),
        base({ id: US1, owner_id: uA, name: 'Delt ett', collapsed: true }),
        base({ id: US2, owner_id: uA, name: 'Delt to', collapsed: true }),
        base({ id: UD1, owner_id: me, name: 'Mitt ett' }),
        base({ id: UD2, owner_id: me, name: 'Mitt to', collapsed: true }),
      ],
      groups: [
        base({ id: GB, owner_id: uA, universe_id: UA, name: 'Fri mappe' }),
        base({ id: GS1, owner_id: uA, universe_id: US1, name: 'Mappe i delt ett' }),
        base({ id: GS2, owner_id: uA, universe_id: US2, name: 'Mappe i delt to' }),
        base({ id: GD1, owner_id: me, universe_id: UD1, name: 'Mappe i mitt ett' }),
        base({ id: GD2, owner_id: me, universe_id: UD2, name: 'Mappe i mitt to' }),
      ],
      cards: [], items: [],
      memberships: [
        mem(uA, { universe_id: UA }, 'owner', 0),
        mem(uA, { universe_id: US1 }, 'owner', 0),
        mem(uA, { universe_id: US2 }, 'owner', 0),
        mem(uA, { universe_id: UD1 }, 'member', 0),
        mem(uA, { universe_id: UD2 }, 'member', 0),
        mem(me, { universe_id: UD1 }, 'owner', 0),
        mem(me, { universe_id: UD2 }, 'owner', 1),
        mem(me, { universe_id: US1 }, 'member', 0),
        mem(me, { universe_id: US2 }, 'member', 1),
        mem(me, { group_id: GB }, 'member', 0),   // DIREKTE mapperolle → fri seksjon
      ],
      share_invites: [], tombstones: [],
    },
  };
}

async function load(p, db, uid, viewport) {
  await p.setViewportSize(viewport);
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    // Kontoen har sett hele introduksjonen: verken omvisningen eller et
    // gest-tips skal legge seg over det som dras.
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'meg@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await p.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy && H.state.universes.length > 0;
  }, null, { timeout: 15000, polling: 200 });
}

const openNav = async (p) => {
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForTimeout(400);
};

/* Kortene i kolonnen, i lesefølge — inkludert det virtuelle. */
const cardOrder = (p) => p.evaluate(() => [...document.querySelectorAll(
  '#nav-board .board-col > .card')].map((e) => e.dataset.id));

/* Både klientens `pos` og den LAGREDE: `Infinity` overlever ikke JSON, så
   feilen synes bare på medlemskapsraden — der blir den `null`. */
const posOf = (p, id) => p.evaluate((x) => {
  const u = window.__huskis.state.universes.find((o) => o.id === x);
  const raw = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  const me = window.__huskis.authUser;
  const m = (raw.memberships || []).find((r) => r.universe_id === x && r.user_id === (me && me.id));
  return { pos: u ? u.pos : null, finite: Number.isFinite(u ? u.pos : NaN),
    stored: m ? m.pos : '(ingen rad)' };
}, id);

async function run(label, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  console.log('\n== ' + label + ' ==');

  const { ids, db } = buildDB();
  await load(p, db, ids.me, viewport);
  await openNav(p);

  const start = await cardOrder(p);
  log(label + ' 0: kolonnen har begge egne, begge delte og det virtuelle kortet sist',
    start.join() === [ids.UD1, ids.UD2, ids.US1, ids.US2, '__free__'].join(), start.join());

  /* ---------- 1) Eget område dratt nedenfor ALT ---------- */
  // Punktet er nederste kant av viewporten: under hele kolonnen, altså også
  // under det virtuelle kortet. Der fantes det ingen nabo å regne mot før —
  // og det virtuelle kortets `Infinity` ble svaret.
  // Ta tak i TITTELEN, ikke midt i hodet: på et smalt viewport ligger senteret
  // av hodet på en ikonknapp, og menyknappen løfter aldri noe (`data-dnd-ignore`).
  const c1 = await G.centre(p, '#nav-board .card[data-id="' + ids.UD1 + '"] .card-title');
  await G.lift(p, c1, touch);
  await G.travel(p, { x: c1.x, y: viewport.height - 8 }, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(800);

  const after1 = await posOf(p, ids.UD1);
  log(label + ' 1: pos er en ENDELIG verdi (ikke Infinity fra det virtuelle kortet)',
    after1.finite, JSON.stringify(after1));
  log(label + ' 1: den lagrede posisjonen er et tall (ikke null fra en Infinity som ikke overlevde JSON)',
    typeof after1.stored === 'number', JSON.stringify(after1));
  const order1 = await cardOrder(p);
  log(label + ' 1: kortet havnet sist i SIN EGEN seksjon, ikke etter det virtuelle',
    order1.join() === [ids.UD2, ids.UD1, ids.US1, ids.US2, '__free__'].join(), order1.join());

  /* ---------- 2) Delt område dratt helt til toppen ---------- */
  // Over alle kortene ligger «Mine områder». Naboen skal likevel være det
  // andre DELTE kortet — ellers arver det en pos fra en fremmed seksjon.
  const c2 = await G.centre(p, '#nav-board .card[data-id="' + ids.US2 + '"] .card-title');
  await G.lift(p, c2, touch);
  await G.travel(p, { x: c2.x, y: 4 }, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(800);

  const after2 = await posOf(p, ids.US2);
  log(label + ' 2: det delte områdets pos er endelig og lagret',
    after2.finite && typeof after2.stored === 'number', JSON.stringify(after2));
  const order2 = await cardOrder(p);
  log(label + ' 2: det ble først blant DE DELTE — seksjonene står urørt',
    order2.join() === [ids.UD2, ids.UD1, ids.US2, ids.US1, '__free__'].join(), order2.join());

  /* ---------- 3) Ekstrahering med det virtuelle kortet nederst ---------- */
  // Mappa slippes i lufta under kolonnen → nytt område. Placeholderen ligger
  // sist i kolonnen, altså etter det virtuelle kortet.
  const before3 = await p.evaluate(() => window.__huskis.state.universes.map((u) => u.id));
  const c3 = await G.centre(p, '#nav-board .item[data-id="' + ids.GD1 + '"]');
  /* Lufta måles FØR løftet, og brukes som et FAST punkt. Board-et vokser mens
     draget står på — ny-liste-stripa legger seg sist i kolonnen — så et punkt
     som måles på nytt underveis vandrer nedover, og til slutt inn i kassen som
     folder seg ut nederst i kildekortet. Det er nettopp den fella
     `tests/dnd-gestures.js` beskriver: et mål som draget selv flytter, kan
     man ikke sikte på. */
  const luft = await p.evaluate(() => {
    const r = document.getElementById('nav-board').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom + 14) };
  });
  await G.lift(p, c3, touch);
  await G.travel(p, luft, touch);
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(800);

  const made = await p.evaluate((known) => {
    const u = window.__huskis.state.universes.find((x) => known.indexOf(x.id) < 0 && !x._virtual);
    return u ? { id: u.id, pos: u.pos, finite: Number.isFinite(u.pos), role: u._role } : null;
  }, before3);
  log(label + ' 3: mappa i lufta lagde et nytt område', !!made, JSON.stringify(made));
  log(label + ' 3: det nye områdets pos er endelig (ikke Infinity fra det virtuelle kortet)',
    !!made && made.finite, JSON.stringify(made));
  await p.keyboard.press('Escape');   // avbryt navngivingen
  await p.waitForTimeout(250);

  log(label + ': ingen ukontrollerte JS-feil på siden', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
