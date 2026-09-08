/*
  Regresjonstest: DELT INNHOLD SKAL IKKE GJENOPPSTÅ — OG ALDRI MED FEIL EIER.

  To brukere i samme «server» (to faner deler mock-databasen, men har hver sin
  sesjon). Mottakeren har en lokal kopi av eierens delte liste. Når eieren
  sletter listen permanent — eller bare trekker delingen tilbake — måtte
  mottakerens utdaterte kopi ikke skrives inn igjen: `insertPayload` setter
  `owner_id` til den innloggede, så en gjeninnsetting ville gjort MOTTAKEREN til
  oppretter av eierens innhold.

  Testen dekker:

    1. To samtidige klienter: eieren sletter mens mottakeren har gamle data.
    2. Mottakeren åpner senere med en utdatert cache (uten base) → ingen
       gjenoppstandelse, verken lokalt eller på serveren.
    3. Mottakerens rå INSERT med den gravlagte id-en avvises (PT409).
    4. Tilbaketrukket deling (objektet lever hos eieren): mottakerens gamle kopi
       skal heller ikke da settes inn på nytt — eierens rad skal stå urørt med
       eieren som `owner_id`.
    5. Eierens eget innhold er upåvirket av det hele.

  Kjør (fra repo-roten, med `python3 -m http.server 8000` i egen terminal):
    NODE_PATH=$(npm root -g) node tests/sync-shared-resurrection.test.js
*/
const { chromium } = require('playwright');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const CACHE_PREFIX = 'mine-lister-v1:';

const ID = {
  shared: 'a1000000-0000-4000-8000-000000000001', // deles, slettes permanent
  sharedItem: 'a1000000-0000-4000-8000-000000000002',
  revoked: 'a2000000-0000-4000-8000-000000000001', // deles, delingen trekkes tilbake
  revokedItem: 'a2000000-0000-4000-8000-000000000002',
  // Deling skjer på MAPPE-nivå: lister arver tilgangen fra mappen sin, så hver
  // av de to listene ligger i sin egen delte mappe.
  gShared: 'b1000000-0000-4000-8000-000000000001',
  gRevoked: 'b2000000-0000-4000-8000-000000000001',
};

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

async function register(p) {
  await p.goto(BASE + '/?mock=1');
  await p.waitForTimeout(500);
  const email = 'd' + Math.floor(Math.random() * 1e9) + '@test.no';
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
  return email;
}

// Den pågående synk-runden er ferdig når pillen ikke lenger sier «Lagrer …».
// (`cloudCycle` no-op-er hvis en runde alt er i gang, så et rått await på den
// er ikke et ferdig-signal — pillen er det.) Intervall-polling, ikke rAF:
// rAF struper i bakgrunnsfaner, og denne fila kjører to faner samtidig.
const syncIdle = (p) => p.waitForFunction(() => {
  const el = document.getElementById('sync-status');
  return el && el.dataset.state !== 'saving';
}, null, { timeout: 6000, polling: 200 }).catch(() => {});

// Registrerer HVILKE id-er klienten forsøker å sette inn. En avvist insert (PK-
// konflikt fordi eierens rad fortsatt finnes, eller insert-vakten) etterlater
// ingen spor på «serveren», så forsøket i seg selv må observeres: mot en database
// UTEN insert-vakten er det nettopp det forsøket som ville lyktes og gjort
// mottakeren til oppretter av eierens innhold.
function recordInsertAttempts(page) {
  return page.addInitScript(() => {
    window.__insertAttempts = [];
    let real;
    Object.defineProperty(window, 'HK_MOCK', {
      configurable: true,
      get() { return real; },
      set(v) {
        const origCreate = v.createClient;
        v.createClient = function () {
          const c = origCreate.apply(this, arguments);
          const origFrom = c.from.bind(c);
          c.from = function (t) {
            const q = origFrom(t);
            const origInsert = q.insert.bind(q);
            q.insert = function (payload) {
              [].concat(payload).forEach((r) => window.__insertAttempts.push(t + ':' + r.id));
              return origInsert(payload);
            };
            return q;
          };
          return c;
        };
        real = v;
      },
    });
  });
}
const insertAttempts = (p) => p.evaluate(() => window.__insertAttempts.slice());

const serverCards = (p) => p.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
  return (db.cards || []).map((c) => ({ id: c.id, owner_id: c.owner_id, title: c.title }));
});
const cardOnServer = async (p, id) => (await serverCards(p)).find((c) => c.id === id) || null;
const localCard = (p, id) => p.evaluate((x) => !!window.__huskis.docFromMyState().cards.find((c) => c.id === x), id);

// Én mappe med én liste i — mappen er delings-enheten.
const addGroupWithCard = (p, groupId, cardId, itemId, title) =>
  p.evaluate(({ groupId, cardId, itemId, title }) => {
    const H = window.__huskis, now = Date.now();
    const mk = (o) => Object.assign({ ts: now, org: 'test', pos: 0, posTs: now, posOrg: 'test', trashed: false, _role: 'owner' }, o);
    const u = H.state.universes[0];
    const g = mk({ id: groupId, uni: u.id, name: title, cat: null, isCat: false, collapsed: false, cards: [] });
    const c = mk({ id: cardId, group: groupId, title: title, collapsed: false, k: true, p: true, items: [] });
    c.items.push(mk({ id: itemId, home: cardId, text: 'Punkt', done: false, cat: null, isCat: false }));
    g.cards.push(c);
    u.groups.push(g);
    H.render();
  }, { groupId, cardId, itemId, title });

async function settle(p, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await p.evaluate(() => window.__huskis.cloudCycle());
    await syncIdle(p);
  }
}
/* Vent til klienten FAKTISK har raden, ikke bare til pillen står stille.
   `syncIdle` svelger sin egen timeout (6 s) med vilje — den er en «gi runden en
   sjanse», ikke et bevis — så på en travel CI-runner kan alle tre rundene i
   `settle` ende som «ventet forgjeves» og la påstanden kjøre før den andre
   delte mappen har landet. Det er akkurat den forvekslingen tests/CLAUDE.md
   advarer mot: vent på TILSTAND, ikke på klokka. Runder kjøres videre til
   raden er der. Selve påstanden står urørt — er raden aldri der, går den rødt
   som før. */
async function waitForLocalCard(p, id, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    if (await localCard(p, id)) return true;
    if (Date.now() - t0 > ms) return false;
    await settle(p, 1);
  }
}
async function waitForServerRow(p, id, ms = 14000) {
  const t0 = Date.now();
  for (;;) {
    if (await cardOnServer(p, id)) return true;
    if (Date.now() - t0 > ms) return false;
    await p.waitForTimeout(400);
  }
}

async function run(label, vp, mobile) {
  const b = await chromium.launch();
  // ÉN kontekst = én delt «server» (mock-databasen i localStorage); sesjonen
  // ligger i sessionStorage, som er per fane → to faner = to brukere.
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  const owner = await ctx.newPage();
  const errs = [];
  owner.on('pageerror', (e) => errs.push('eier: ' + e.message));
  console.log('\n== ' + label + ' ==');

  await register(owner);
  await owner.evaluate(() => window.__huskis.addGroup());
  await settle(owner, 1);
  await addGroupWithCard(owner, ID.gShared, ID.shared, ID.sharedItem, 'Delt liste');
  await addGroupWithCard(owner, ID.gRevoked, ID.revoked, ID.revokedItem, 'Trukket tilbake');
  await waitForServerRow(owner, ID.shared);
  await waitForServerRow(owner, ID.revoked);
  const ownerId = await owner.evaluate(() => window.__huskis.authUser.id);

  const recip = await ctx.newPage();
  await recordInsertAttempts(recip);
  recip.on('pageerror', (e) => errs.push('mottaker: ' + e.message));
  const recipEmail = await register(recip);
  await recip.evaluate(() => window.__huskis.addGroup());
  await settle(recip, 1);
  const recipId = await recip.evaluate(() => window.__huskis.authUser.id);

  // Eieren inviterer til begge MAPPENE; mottakeren godtar (uten å velge noen
  // forelder — de havner i «Mapper delt med meg»). RPC-ene kalles direkte;
  // UI-flyten er dekket av andre tester.
  const invites = await owner.evaluate(async ({ email, a, c }) => {
    const H = window.__huskis;
    const one = await H.client.rpc('create_share_invite', { p_type: 'group', p_id: a, p_email: email });
    const two = await H.client.rpc('create_share_invite', { p_type: 'group', p_id: c, p_email: email });
    return [one.data && one.data.id, two.data && two.data.id];
  }, { email: recipEmail, a: ID.gShared, c: ID.gRevoked });
  await recip.evaluate(async (ids) => {
    const H = window.__huskis;
    for (const id of ids) await H.client.rpc('accept_share_invite', { p_invite: id });
  }, invites);
  await settle(recip);
  await waitForLocalCard(recip, ID.shared);
  await waitForLocalCard(recip, ID.revoked);
  log(label + ' 0: mottakeren ser begge de delte listene',
    await localCard(recip, ID.shared) && await localCard(recip, ID.revoked));
  log(label + ' 0: … og vet at de tilhører en annen (_createdByMe = false)',
    await recip.evaluate((id) => {
      const c = window.__huskis.state.universes.flatMap((u) => u.groups).flatMap((g) => g.cards).find((x) => x.id === id);
      return !!c && c._createdByMe === false;
    }, ID.shared));

  // Mottakerens cache slik den er NÅ — «den gamle kopien».
  const staleCache = await recip.evaluate((pfx) => localStorage.getItem(pfx + window.__huskis.authUser.id), CACHE_PREFIX);

  /* ---------- 1) To samtidige klienter: eieren sletter permanent ---------- */
  await owner.evaluate((id) => {
    const H = window.__huskis;
    const c = H.state.universes.flatMap((u) => u.groups).flatMap((g) => g.cards).find((x) => x.id === id);
    c.trashed = true; c.ts = Date.now(); c.org = 'test';
    H.render();
  }, ID.shared);
  await settle(owner);
  await owner.evaluate((gid) => {
    // «Tøm papirkurv» gjelder den AKTIVE mappen — stå i den delte mappen først.
    window.__huskis.state.activeGroup = gid;
    window.__huskis.render();
  }, ID.gShared);
  await owner.waitForTimeout(200);
  await owner.evaluate(() => window.__huskis.emptyCardsTrash());
  await settle(owner);
  log(label + ' 1: eieren slettet den delte listen permanent', !await cardOnServer(owner, ID.shared));

  // Mottakerens fane har fortsatt listen i minnet fra før slettingen.
  await settle(recip, 4);
  log(label + ' 1: mottakerens kjørende klient gjenoppliver den ikke',
    !await cardOnServer(recip, ID.shared), JSON.stringify(await cardOnServer(recip, ID.shared)));
  log(label + ' 1: … og den forsvinner fra mottakerens visning', !await localCard(recip, ID.shared));

  /* ---------- 2) Mottakeren åpner senere med utdatert cache ---------- */
  await recip.evaluate(({ pfx, uid, raw }) => {
    const s = JSON.parse(raw);
    delete s._base; delete s._baseV; delete s._tomb;  // gammel klient / annet domene
    localStorage.setItem(pfx + uid, JSON.stringify(s));
  }, { pfx: CACHE_PREFIX, uid: recipId, raw: staleCache });
  await recip.reload();
  await recip.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  await syncIdle(recip);
  await settle(recip, 4);
  const after = await cardOnServer(recip, ID.shared);
  log(label + ' 2: utdatert cache gjenoppliver ikke den slettede delte listen',
    after === null, JSON.stringify(after));
  log(label + ' 2: … heller ikke lokalt', !await localCard(recip, ID.shared));

  /* ---------- 3) Rå INSERT fra mottakeren ---------- */
  const raw = await recip.evaluate(async ({ id, uid, gid }) => {
    const H = window.__huskis;
    const res = await H.client.from('cards').insert({
      id: id, owner_id: uid, group_id: gid, title: 'Kapret', trashed: false,
      ts: Date.now(), org: 'raw', pos: 0, pos_ts: Date.now(), pos_org: 'raw',
    });
    return { err: res && res.error ? { code: res.error.code, message: res.error.message } : null };
  }, { id: ID.shared, uid: recipId, gid: ID.gShared });
  log(label + ' 3: mottakerens rå INSERT med gravlagt id avvises',
    !!raw.err && raw.err.code === 'PT409', JSON.stringify(raw.err));
  log(label + ' 3: … og ingen rad med mottakeren som eier dukket opp',
    !(await serverCards(recip)).some((c) => c.id === ID.shared));

  /* ---------- 4) Tilbaketrukket deling (objektet LEVER hos eieren) ---------- */
  await owner.evaluate(async ({ id, user }) => {
    await window.__huskis.client.rpc('revoke_share', { p_type: 'group', p_id: id, p_user: user });
  }, { id: ID.gRevoked, user: recipId });
  await settle(owner);
  // Mottakerens cache husker fortsatt listen (som en annens). Den skal slippes,
  // ikke settes inn på nytt med mottakeren som oppretter.
  await recip.evaluate(({ pfx, uid, raw }) => {
    const s = JSON.parse(raw);
    delete s._base; delete s._baseV; delete s._tomb;
    localStorage.setItem(pfx + uid, JSON.stringify(s));
  }, { pfx: CACHE_PREFIX, uid: recipId, raw: staleCache });
  await recip.reload();
  await recip.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 10000, polling: 200 });
  await syncIdle(recip);
  await settle(recip, 4);
  const revoked = await cardOnServer(recip, ID.revoked);
  log(label + ' 4: den tilbaketrukne listen finnes fortsatt hos EIEREN',
    !!revoked && revoked.owner_id === ownerId, JSON.stringify(revoked));
  log(label + ' 4: mottakeren tok ikke over eierskapet med sin gamle kopi',
    !!revoked && revoked.owner_id !== recipId);
  log(label + ' 4: … og listen er borte fra mottakerens visning',
    !await localCard(recip, ID.revoked));
  // Kjernen i fellen: den tilbaketrukne listen er FREMMED, mens listepunktet
  // under den er «mitt» og dermed en uavklart rad som utløser en ANDRE fletting
  // etter gravsteins-oppslaget. Leses «fremmed» av et da-tømt tvilssett i den
  // andre runden, glir listen gjennom som en lokal nyopprettelse. Den skal
  // fortsatt være droppet — og ingen skriving skal ha blitt forsøkt på den.
  await settle(recip, 3);
  log(label + ' 4: den blir ikke merget inn igjen av den andre flettingen',
    !await localCard(recip, ID.revoked));
  const stillOwner = await cardOnServer(recip, ID.revoked);
  log(label + ' 4: … og eieren står urørt etter flere runder',
    !!stillOwner && stillOwner.owner_id === ownerId, JSON.stringify(stillOwner));
  const tried = await insertAttempts(recip);
  log(label + ' 4: ingen skriving ble i det hele tatt FORSØKT på de fremmede listene',
    !tried.includes('cards:' + ID.revoked) && !tried.includes('cards:' + ID.shared),
    tried.filter((x) => x.startsWith('cards:')).join(',') || 'ingen');

  /* ---------- 5) Eierens eget innhold er urørt ---------- */
  await settle(owner, 3);
  log(label + ' 5: eieren har fortsatt sin egen liste',
    await localCard(owner, ID.revoked) && !!await cardOnServer(owner, ID.revoked));
  log(label + ' 5: eieren har ikke fått den slettede listen tilbake',
    !await localCard(owner, ID.shared) && !await cardOnServer(owner, ID.shared));

  log(label + ': ingen JS-feil', errs.length === 0, errs.join(' | '));
  await recip.close();
  await owner.close();
  await ctx.close();
  await b.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const failed = results.filter((x) => !x).length;
  console.log('\n==== ' + (results.length - failed) + '/' + results.length + ' PASS ====');
  process.exit(failed ? 1 : 0);
})();
