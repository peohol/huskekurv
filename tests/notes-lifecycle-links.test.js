/*
  Nettlesertest for NOTATENES LIVSSYKLUS, DET FELLES SØKET og KOBLINGENE
  mellom Lister og Notater (docs/notater-plan.md), mot mock-backend (?mock=1).

  Dekker:
    1. Arkivering på alle tre nivåene (bokhylle, notatbok, notat): objektet
       forsvinner fra normalvisningen, står i arkivet, og kommer tilbake
    2. Sletting til søppelkassen på alle tre nivåene, med angre-toast, og
       gjenoppretting både fra angre-vinduet og etter at det er utløpt
    3. Hierarkiet: en bortlagt bokhylle/notatbok tar innholdet ut av visningen
       uten å flagge det, og gir det tilbake ved gjenoppretting
    4. Tømming setter gravsteiner rekursivt for bokhyllen (som serverens
       kaskade), mens en tømt NOTATBOK etterlater notatene som frie notater
       (`notes.folder_id` er `on delete set null`)
    5. Gravsteinene stopper en gjenoppstandelse: en fjern-rad med gravlagt id
       settes aldri inn igjen
    6. LWW: to enheter som skriver `archived`/`trashed` i motsatt rekkefølge
       ender likt, og posisjonsregisteret flettes for seg
    7. Kassene og arkivene som knapper: skjult når tomme, teller riktig, og
       et drag i notatfanen kan slippes i kassen på alle tre nivåene — og
       notatfanens to kasser står i en FAST FOT nederst i viewportet, med halve
       bredden hver, mens en ETIKETT over det løftede objektet sier «Arkiver»
       — og bytter riktig BEGGE veier mellom de to kassene i det samme draget
    8. Det felles søket: `Alt | Lister | Notater`, treff på notattittel,
       notattekst, bokhylle og notatbok — og at scopet filtrerer
    9. Navigering fra et søketreff til riktig objekt OG riktig hovedfane,
       begge veier
   10. Koblinger: opprettes fra begge sider, navigeres begge veier, overlever
       flytting, og forsvinner når målet slettes for godt
   11. Dangling-sikkerhet: en kobling til et bortlagt/utilgjengelig mål vises
       som utilgjengelig og kan fjernes — den krasjer ikke og blokkerer ikke
       synken
   12. Synk: `archived` og koblingsradene lander i mock-databasen, og en
       kobling som fjernes blir borte der også
   13. Mock-backenden speiler DB-kontrakten: en koblingsrad med null eller to
       id-er på en side avvises, som produksjonens to `check`-vilkår
   14. Fokus overlever at et objekt LEGGES BORT: å arkivere tar raden ut av
       visningen akkurat som å slette, og fokus skal lande på naboen — ellers
       på ＋-knappen — aldri på `<body>` (docs/tilgjengelighet.md, «Fokus»)
   15. Raden «Frie notater» er bokhyllens egen plass, ikke en notatbok: den har
       ingen objektmeny, og malens menyknapp står derfor ikke igjen som et
       navnløst tabbstopp
   16. Utdraget i en kasse-/arkivrad er KORT. Med kortets 160 tegn ble raden
       fire linjer høy på telefon, og radens to knapper havnet midt i teksten
   17. MODALEN EIER FOKUS mens den er åpen: en gjenoppretting (eller et
       «Slett») derfra legger ikke fokus på objektet BAK dialogen, som er
       `aria-modal` og dermed ikke finnes for tastaturet — det blir i modalen

  Kjøres på BÅDE desktop- og mobil-viewport der oppførselen avhenger av layout.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-lifecycle-links.test.js
*/
const path = require('path');
const { chromium } = require(path.join(process.env.NODE_PATH ||
  require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const G = require('./dnd-gestures');
const { centre } = G;

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Ett område > én mappe > én liste, så listesiden har noe å koble til og noe
   søket kan finne. Notattabellene starter tomme — testen bygger dem. */
function buildDB() {
  const uid = 'u1';
  const UA = U(), GA = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  return {
    uid, UA, GA, LA,
    db: {
      _rolesBackfilled: true,
      profiles: [{ id: uid, email: 'a@x.no', display_name: 'Alice', user_metadata: {} }],
      passwords: { 'a@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uid, name: 'Klinikken' })],
      groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Timeboka' })],
      cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Prøvesvar', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: IA, owner_id: uid, card_id: LA, text: 'Ring laben' })],
      ideas: [], note_projects: [], note_folders: [], notes: [], object_links: [],
      memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

const klar = (p) => p.waitForFunction(() => {
  const H = window.__huskis;
  return H && H.authUser && H.lastMy && H.state.universes.length > 0;
}, null, { timeout: 20000, polling: 200 });

async function seed(p, db, uid) {
  await p.goto(BASE + '/?mock=1');
  await p.evaluate(({ db, uid }) => {
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({
      id: uid, email: 'a@x.no',
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } },
    }));
  }, { db, uid });
  await p.goto(BASE + '/?mock=1');
  await klar(p);
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForFunction(() => document.getElementById('tour').hidden, null, { timeout: 5000, polling: 100 });
}

/* Bygger et lite notattre: én bokhylle, én notatbok, to frie notater og ett
   notat i notatboken. Returnerer id-ene. */
async function byggNotater(p) {
  return p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject();
    const bok = H.addNoteFolder(proj.id);
    proj.name = 'Fagstoff';
    bok.name = 'Anatomi';
    H.setActiveProject(proj.id);
    H.setActiveNoteFolder(null);
    const nyttNotat = (tittel, tekst) => {
      const n = H.addNote();
      H.closeNoteEditor();
      n.title = tittel;
      n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: tekst }] }] };
      return n;
    };
    const fri1 = nyttNotat('Blodprøver', 'Hemoglobin og ferritin måles på nytt.');
    const fri2 = nyttNotat('Timeplan', 'Uke 12 er full.');
    H.setActiveNoteFolder(bok.id);
    const iBok = nyttNotat('Skjelettet', 'Lårbeinet er kroppens lengste knokkel.');
    H.setActiveNoteFolder(null);
    H.save();
    H.renderNotes();
    return { proj: proj.id, bok: bok.id, fri1: fri1.id, fri2: fri2.id, iBok: iBok.id };
  });
}

const mockDb = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hk-mock-db')));
const synkeRo = (p) => p.waitForFunction(() => {
  const el = document.getElementById('sync-status');
  return !el || el.dataset.state !== 'saving';
}, null, { timeout: 15000, polling: 100 });

async function run(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const jsFeil = [];
  p.on('pageerror', (e) => jsFeil.push(String(e)));
  const M = (t) => navn + ': ' + t;

  const { uid, db, UA, GA, LA } = buildDB();
  await seed(p, db, uid);
  const ids = await byggNotater(p);

  /* ---------- 1. Arkivering på alle tre nivåene ---------- */
  const arkNotat = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.setNoteArchived('note', ids.fri2, true);
    return {
      synlige: H.notesIn(H.state.activeProject, null).map((n) => n.title),
      arkiv: H.archivedNotesIn(H.state.activeProject, null).map((n) => n.title),
      knapp: !document.getElementById('note-archive').hidden,
      tall: document.getElementById('note-archive-count').textContent,
    };
  }, ids);
  log(M('et arkivert notat forsvinner fra flaten og står i arkivet'),
    arkNotat.synlige.join('|') === 'Blodprøver' && arkNotat.arkiv.join('|') === 'Timeplan',
    JSON.stringify(arkNotat));
  log(M('arkivknappen dukker opp med riktig antall'),
    arkNotat.knapp && arkNotat.tall === '1', JSON.stringify(arkNotat));

  const arkTilbake = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.setNoteArchived('note', ids.fri2, false);
    return {
      synlige: H.notesIn(H.state.activeProject, null).map((n) => n.title),
      knapp: !document.getElementById('note-archive').hidden,
    };
  }, ids);
  log(M('notatet kommer tilbake fra arkivet, og knappen skjules igjen'),
    arkTilbake.synlige.length === 2 && !arkTilbake.knapp, JSON.stringify(arkTilbake));

  const arkBok = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.setNoteArchived('noteFolder', ids.bok, true);
    H.openNotesNav();
    return {
      rader: [...document.querySelectorAll('#notes-nav-board .note-folder-row .item-text')]
        .map((e) => e.textContent),
      arkiv: H.archivedNoteFoldersOf(H.state.noteProjects[0]).map((f) => f.name),
      // Notatet i den arkiverte notatboken skal IKKE sprette opp blant de frie.
      frie: H.notesIn(ids.proj, null).map((n) => n.title),
      knapp: !!document.querySelector('#notes-nav-board .note-folder-archive-btn:not([hidden])'),
    };
  }, ids);
  log(M('en arkivert notatbok forsvinner fra bokhyllen'),
    !arkBok.rader.includes('Anatomi') && arkBok.arkiv.join('|') === 'Anatomi',
    JSON.stringify(arkBok.rader));
  log(M('notatet i den arkiverte notatboken blir IKKE et fritt notat'),
    !arkBok.frie.includes('Skjelettet'), JSON.stringify(arkBok.frie));
  log(M('notatbok-arkivet får sin egen knapp i bokhyllekortet'),
    arkBok.knapp, String(arkBok.knapp));

  const arkBokTilbake = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.setNoteArchived('noteFolder', ids.bok, false);
    H.openNotesNav();
    return [...document.querySelectorAll('#notes-nav-board .note-folder-row .item-text')]
      .map((e) => e.textContent);
  }, ids);
  log(M('notatboken kommer tilbake fra arkivet'),
    arkBokTilbake.includes('Anatomi'), JSON.stringify(arkBokTilbake));

  const arkHylle = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.setNoteArchived('noteProject', ids.proj, true);
    H.openNotesNav();
    return {
      kort: [...document.querySelectorAll('#notes-nav-board .note-project-card .card-title')]
        .map((e) => e.textContent),
      arkiv: H.archivedNoteProjects().map((x) => x.name),
      aktiv: H.state.activeProject,
      knapp: !document.getElementById('note-project-archive').hidden,
    };
  }, ids);
  log(M('en arkivert bokhylle forsvinner fra navigasjonen og gir fra seg plassen'),
    !arkHylle.kort.includes('Fagstoff') && arkHylle.arkiv.join('|') === 'Fagstoff' &&
    arkHylle.aktiv === null, JSON.stringify(arkHylle));
  log(M('bokhylle-arkivet får sin egen knapp i modalens fot'),
    arkHylle.knapp, String(arkHylle.knapp));

  await p.evaluate((ids) => {
    window.__huskis.setNoteArchived('noteProject', ids.proj, false);
    window.__huskis.setActiveProject(ids.proj);
    window.__huskis.closeNotesNav();
  }, ids);

  /* ---------- 2. Sletting, angre-toast og gjenoppretting ---------- */
  const slett = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.deleteNoteObject('note', ids.fri2);
    return {
      synlige: H.notesIn(H.state.activeProject, null).map((n) => n.title),
      søppel: H.trashedNotesIn(H.state.activeProject, null).map((n) => n.title),
      toast: (document.getElementById('toast') || {}).textContent || '',
      kasse: !document.getElementById('note-trash').hidden,
      tall: document.getElementById('note-trash-count').textContent,
    };
  }, ids);
  log(M('et slettet notat ligger i kassen, ikke på flaten'),
    slett.synlige.join('|') === 'Blodprøver' && slett.søppel.join('|') === 'Timeplan',
    JSON.stringify(slett));
  log(M('slettingen gir en angre-toast og viser kassen'),
    /Timeplan/.test(slett.toast) && slett.kasse && slett.tall === '1',
    JSON.stringify({ toast: slett.toast, kasse: slett.kasse, tall: slett.tall }));

  // Gjenoppretting FØR angre-vinduet er ute: ren lokal tilstand, ingen skriving.
  const angre = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.restoreNoteObject('note', ids.fri2);
    return H.notesIn(H.state.activeProject, null).map((n) => n.title).sort();
  }, ids);
  log(M('«Gjenopprett» på en buffret sletting angrer bufferet'),
    angre.join('|') === 'Blodprøver|Timeplan', JSON.stringify(angre));

  // … og etter at bufferet er committet (trashed = true er skrevet).
  const committed = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.deleteNoteObject('note', ids.fri2);
    H.commitAllPending();
    const n = H.state.notes.find((x) => x.id === ids.fri2);
    return { trashed: !!n.trashed, pending: !!n._pendingDelete };
  }, ids);
  log(M('når angre-vinduet er ute, er slettingen skrevet (trashed = true)'),
    committed.trashed && !committed.pending, JSON.stringify(committed));

  const gjenopprettet = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.restoreNoteObject('note', ids.fri2);
    const n = H.state.notes.find((x) => x.id === ids.fri2);
    return { trashed: !!n.trashed, synlige: H.notesIn(H.state.activeProject, null).length };
  }, ids);
  log(M('en committet sletting gjenopprettes med trashed = false'),
    !gjenopprettet.trashed && gjenopprettet.synlige === 2, JSON.stringify(gjenopprettet));

  /* ---------- 3. Hierarkiet ved sletting av en forelder ---------- */
  const hierarki = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.deleteNoteObject('noteFolder', ids.bok);
    H.commitAllPending();
    const iBok = H.state.notes.find((x) => x.id === ids.iBok);
    return {
      frie: H.notesIn(ids.proj, null).map((n) => n.title),
      notatFlagget: !!iBok.trashed,
      iKassen: H.trashedNoteFoldersOf(H.state.noteProjects[0]).map((f) => f.name),
    };
  }, ids);
  log(M('en slettet notatbok tar notatene ut av visningen uten å flagge dem'),
    !hierarki.frie.includes('Skjelettet') && hierarki.notatFlagget === false &&
    hierarki.iKassen.join('|') === 'Anatomi', JSON.stringify(hierarki));

  const hierarkiTilbake = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.restoreNoteObject('noteFolder', ids.bok);
    return H.notesIn(ids.proj, ids.bok).map((n) => n.title);
  }, ids);
  log(M('gjenoppretting av notatboken gir notatene tilbake'),
    hierarkiTilbake.join('|') === 'Skjelettet', JSON.stringify(hierarkiTilbake));

  /* ---------- 4. Tømming: gravsteiner og set-null ---------- */
  const tømBok = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.deleteNoteObject('noteFolder', ids.bok);
    H.emptyNoteFoldersTrash(ids.proj);
    const n = H.state.notes.find((x) => x.id === ids.iBok);
    const t = H.tombIds();
    return {
      bokBorte: !H.state.noteProjects[0].folders.some((f) => f.id === ids.bok),
      bokGravlagt: t.has(ids.bok),
      notatLever: !!n,
      notatGravlagt: t.has(ids.iBok),
      notatFritt: !!n && n.folder === null,
      frie: H.notesIn(ids.proj, null).map((x) => x.title).sort(),
    };
  }, ids);
  log(M('en tømt notatbok gravlegges, men notatene BLIR som frie notater'),
    tømBok.bokBorte && tømBok.bokGravlagt && tømBok.notatLever && !tømBok.notatGravlagt &&
    tømBok.notatFritt && tømBok.frie.join('|') === 'Blodprøver|Skjelettet|Timeplan',
    JSON.stringify(tømBok));

  const tømHylle = await p.evaluate((ids) => {
    const H = window.__huskis;
    H.deleteNoteObject('noteProject', ids.proj);
    H.emptyNoteProjectsTrash();
    const t = H.tombIds();
    return {
      hylleBorte: !H.state.noteProjects.some((x) => x.id === ids.proj),
      notaterBorte: H.state.notes.filter((n) => n.project === ids.proj).length,
      gravlagt: [ids.proj, ids.fri1, ids.fri2, ids.iBok].filter((id) => t.has(id)).length,
    };
  }, ids);
  log(M('en tømt bokhylle tar notatene med seg, og alt får gravstein'),
    tømHylle.hylleBorte && tømHylle.notaterBorte === 0 && tømHylle.gravlagt === 4,
    JSON.stringify(tømHylle));

  /* ---------- 5. Gravsteinene stopper en gjenoppstandelse ---------- */
  const gjenoppstandelse = await p.evaluate((ids) => {
    const H = window.__huskis;
    const base = H.emptyDoc();
    const fjern = Object.assign(H.emptyDoc(), {
      noteProjects: [{ id: ids.proj, name: 'Fagstoff', collapsed: false, trashed: false,
        archived: false, ts: 5, org: 'z', pos: 0, posTs: 5, posOrg: 'z' }],
    });
    const r = H.reconcile(base, H.emptyDoc(), fjern, { tombs: H.tombIds() });
    return { rader: r.merged.noteProjects.length, ops: r.ops.map((o) => o.op + ':' + o.t) };
  }, ids);
  log(M('en gravlagt bokhylle settes aldri inn igjen — den slettes på serveren'),
    gjenoppstandelse.rader === 0 && gjenoppstandelse.ops.join('|') === 'delete:note_project',
    JSON.stringify(gjenoppstandelse));

  /* ---------- 6. LWW på `archived` og posisjonsregisteret ---------- */
  const lww = await p.evaluate(() => {
    const H = window.__huskis;
    const rad = (over) => Object.assign({
      id: 'n-lww', project: 'p1', folder: null, title: 'A', doc: H.emptyNoteDoc(),
      trashed: false, archived: false, ts: 10, org: 'a', pos: 0, posTs: 10, posOrg: 'a',
    }, over);
    const lokal = Object.assign(H.emptyDoc(), { notes: [rad({ archived: true, ts: 20, org: 'a' })] });
    const fjern = Object.assign(H.emptyDoc(), { notes: [rad({ trashed: true, ts: 30, org: 'b', pos: 5, posTs: 5, posOrg: 'b' })] });
    const enVei = H.reconcile(H.emptyDoc(), lokal, fjern, {}).merged.notes[0];
    const andreVei = H.reconcile(H.emptyDoc(), fjern, lokal, {}).merged.notes[0];
    return {
      likt: JSON.stringify(enVei) === JSON.stringify(andreVei),
      arkivert: enVei.archived, slettet: enVei.trashed,
      // Posisjonsregisteret er sitt eget: den ELDRE `pos`-skrivingen taper.
      pos: enVei.pos, posTs: enVei.posTs,
    };
  });
  log(M('to enheter i motsatt rekkefølge gir samme rad (innholdsregisteret vinner)'),
    lww.likt && lww.slettet === true && lww.arkivert === false, JSON.stringify(lww));
  log(M('posisjonsregisteret flettes for seg — den nyeste posisjonen står'),
    lww.pos === 0 && lww.posTs === 10, JSON.stringify({ pos: lww.pos, posTs: lww.posTs }));

  /* ---------- 7. Drag til kassen OG til arkivet, på alle tre nivåene ---------- */
  // Bygg treet på nytt (forrige seksjon tømte det).
  const ids2 = await byggNotater(p);

  // Er knappen malt akkurat nå? Måles på BOKSEN, ikke på `hidden`: en knapp i
  // en skjult beholder er like usynlig som en skjult knapp.
  const synlig = (sel) => p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);

  const åpneNav = async () => {
    await p.evaluate(() => window.__huskis.openNotesNav());
    await p.waitForFunction(() => !!document.querySelector('#notes-nav-board .note-folder-row'),
      null, { timeout: 5000, polling: 100 });
  };
  const lukkNav = async () => {
    await p.evaluate(() => window.__huskis.closeNotesNav());
    await p.waitForFunction(() => document.querySelectorAll('#notes-board .note-card').length === 2,
      null, { timeout: 5000, polling: 100 });
  };

  // Hva ligger i kassen og i arkivet på ETT nivå — samme spørsmål, tre svar.
  const bortlagt = (kind) => p.evaluate((k) => {
    const H = window.__huskis;
    if (k === 'note') {
      const pid = H.state.activeProject;
      return { søppel: H.trashedNotesIn(pid, null).map((n) => n.title),
        arkiv: H.archivedNotesIn(pid, null).map((n) => n.title) };
    }
    if (k === 'noteFolder') {
      const pr = H.state.noteProjects[0];
      return { søppel: H.trashedNoteFoldersOf(pr).map((f) => f.name),
        arkiv: H.archivedNoteFoldersOf(pr).map((f) => f.name) };
    }
    return { søppel: H.trashedNoteProjects().map((x) => x.name),
      arkiv: H.archivedNoteProjects().map((x) => x.name) };
  }, kind);

  /* De tre nivåene er den SAMME påstanden tre ganger: to kasser, skjult når de
     er tomme, foldet ut av draget, og et slipp som betyr nøyaktig det menyens
     «Arkiver»/«Slett» betyr. Derfor én tabell og én løkke — ikke tre kopier. */
  const nivåer = [
    { kind: 'note', navn: 'notat', tittel: 'Blodprøver', forbered: lukkNav,
      id: () => ids2.fri1,
      fra: () => '#notes-board .note-card[data-id="' + ids2.fri1 + '"]',
      kasse: '#note-trash-btn', arkiv: '#note-archive-btn' },
    { kind: 'noteFolder', navn: 'notatbok', tittel: 'Anatomi', forbered: åpneNav,
      id: () => ids2.bok,
      fra: () => '#notes-nav-board .note-folder-row[data-id="' + ids2.bok + '"]',
      kasse: '#notes-nav-board .note-folder-trash-btn',
      arkiv: '#notes-nav-board .note-folder-archive-btn' },
    { kind: 'noteProject', navn: 'bokhylle', tittel: 'Fagstoff', forbered: åpneNav,
      id: () => ids2.proj,
      fra: () => '#notes-nav-board .card[data-id="' + ids2.proj + '"] .card-head',
      kasse: '#note-project-trash-btn', arkiv: '#note-project-archive-btn' },
  ];

  for (const n of nivåer) {
    await n.forbered();
    const før = { kasse: await synlig(n.kasse), arkiv: await synlig(n.arkiv) };
    log(M('7 ' + n.navn + ': kassen og arkivet er skjult når de er tomme'),
      !før.kasse && !før.arkiv, JSON.stringify(før));

    // (a) Draget folder ut BEGGE — også det tomme arkivet — og et slipp som
    //     ikke traff noen av dem rydder dem bort igjen.
    await G.lift(p, await centre(p, n.fra()), touch);
    const under = { kasse: await synlig(n.kasse), arkiv: await synlig(n.arkiv) };
    await G.drop(p, undefined, touch);
    await p.waitForTimeout(200);
    const etter = { kasse: await synlig(n.kasse), arkiv: await synlig(n.arkiv),
      rester: await p.evaluate(() => document.querySelectorAll(
        '.trashcan.drag-trash, [data-drag-revealed], .to-trash, .to-archive').length) };
    log(M('7 ' + n.navn + ': draget folder ut både kassen og arkivet'),
      under.kasse && under.arkiv, JSON.stringify(under));
    log(M('7 ' + n.navn + ': et drag som ikke endte i en kasse rydder opp etter seg'),
      !etter.kasse && !etter.arkiv && etter.rester === 0, JSON.stringify(etter));

    // (b) Slipp i ARKIVET arkiverer.
    await n.forbered();
    await G.dragFromTo(p, await centre(p, n.fra()), () => centre(p, n.arkiv), { touch });
    await p.waitForTimeout(200);
    const arkivert = await bortlagt(n.kind);
    log(M('7 ' + n.navn + ': sluppet i arkivet blir objektet arkivert'),
      arkivert.arkiv.join('|') === n.tittel && !arkivert.søppel.length,
      JSON.stringify(arkivert));
    await p.evaluate(([k, id]) => window.__huskis.setNoteArchived(k, id, false), [n.kind, n.id()]);

    // (c) Slipp i KASSEN sletter — den samme gesten, den andre knappen.
    await n.forbered();
    await G.dragFromTo(p, await centre(p, n.fra()), () => centre(p, n.kasse), { touch });
    await p.waitForTimeout(200);
    const slettet = await bortlagt(n.kind);
    log(M('7 ' + n.navn + ': sluppet i kassen blir objektet slettet'),
      slettet.søppel.join('|') === n.tittel && !slettet.arkiv.length,
      JSON.stringify(slettet));
    await p.evaluate(([k, id]) => window.__huskis.restoreNoteObject(k, id), [n.kind, n.id()]);
    await p.waitForTimeout(150);
  }
  await p.evaluate(() => window.__huskis.closeNotesNav());

  /* ---------- 8. Det felles søket ---------- */
  const søk = await p.evaluate(() => {
    const H = window.__huskis;
    return {
      tittel: H.searchObjects('Blodprøver').map((h) => h.type + ':' + h.name),
      tekst: H.searchObjects('ferritin').map((h) => h.type + ':' + h.name),
      hylle: H.searchObjects('Fagstoff').map((h) => h.type + ':' + h.name),
      bok: H.searchObjects('Anatomi').map((h) => h.type + ':' + h.name),
      listeSide: H.searchObjects('Prøvesvar').map((h) => h.type + ':' + h.name),
      scopetLister: H.searchObjects('ferritin', null, 'lists').length,
      scopetNotater: H.searchObjects('Prøvesvar', null, 'notes').length,
      // «Alt» tar begge sider i ett søk.
      alt: H.searchObjects('e', null, 'all').map((h) => h.type).filter((t, i, a) => a.indexOf(t) === i),
    };
  });
  log(M('søket finner notattittel, notattekst, bokhylle og notatbok'),
    søk.tittel.join('|') === 'note:Blodprøver' && søk.tekst.join('|') === 'note:Blodprøver' &&
    søk.hylle.join('|') === 'noteProject:Fagstoff' && søk.bok.join('|') === 'noteFolder:Anatomi',
    JSON.stringify(søk));
  log(M('scopet filtrerer: notattekst finnes ikke i Lister, og omvendt'),
    søk.scopetLister === 0 && søk.scopetNotater === 0,
    JSON.stringify({ l: søk.scopetLister, n: søk.scopetNotater }));
  log(M('«Alt» gir treff fra BEGGE hoveddelene i ett søk'),
    søk.alt.some((t) => ['universe', 'group', 'card', 'item'].includes(t)) &&
    søk.alt.some((t) => ['noteProject', 'noteFolder', 'note'].includes(t)),
    JSON.stringify(søk.alt));

  const arkivertUteAvSøket = await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.setNoteArchived('note', ids2.fri2, true);
    const arkivert = H.searchObjects('Timeplan').length;
    H.setNoteArchived('note', ids2.fri2, false);
    H.deleteNoteObject('note', ids2.fri2);
    H.commitAllPending();
    const slettet = H.searchObjects('Timeplan').length;
    H.restoreNoteObject('note', ids2.fri2);
    return { arkivert, slettet, tilbake: H.searchObjects('Timeplan').length };
  }, ids2);
  log(M('arkivet og søppelkassen er ute av søket, og treffet kommer tilbake'),
    arkivertUteAvSøket.arkivert === 0 && arkivertUteAvSøket.slettet === 0 &&
    arkivertUteAvSøket.tilbake === 1, JSON.stringify(arkivertUteAvSøket));

  // Scopevelgeren i modalen — den ekte veien gjennom UI-et.
  await p.evaluate(() => window.__huskis.openSearchModal());
  await p.fill('#search-input', 'e');
  await p.waitForTimeout(150);
  const modalAlt = await p.evaluate(() =>
    [...document.querySelectorAll('#search-results .search-result')].map((li) => li.dataset.type));
  await p.click('#search-scope .seg-btn[data-scope="notes"]');
  await p.waitForTimeout(150);
  const modalNotater = await p.evaluate(() => ({
    typer: [...document.querySelectorAll('#search-results .search-result')].map((li) => li.dataset.type),
    aktiv: document.querySelector('#search-scope .seg-btn.is-active').dataset.scope,
  }));
  log(M('scopevelgeren i søkemodalen snevrer resultatlisten inn til Notater'),
    modalAlt.some((t) => t === 'card' || t === 'item' || t === 'universe') &&
    modalNotater.typer.every((t) => ['noteProject', 'noteFolder', 'note'].includes(t)) &&
    modalNotater.aktiv === 'notes',
    JSON.stringify({ alt: modalAlt, notater: modalNotater.typer }));
  await p.evaluate(() => { window.__huskis.setSearchScope('all'); window.__huskis.closeSearchModal(); });

  /* ---------- 9. Navigering fra søketreff, begge veier ---------- */
  const navTilNotat = await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.setMainTab('lists');
    const ok = H.navigateToObject({ type: 'note', id: ids2.iBok });
    return { ok, fane: H.mainTab, editor: !document.getElementById('note-editor').hidden,
      bok: H.state.activeFolder === ids2.bok };
  }, ids2);
  log(M('et notattreff åpner riktig notat, også fra Lister-fanen'),
    navTilNotat.ok && navTilNotat.fane === 'notes' && navTilNotat.editor && navTilNotat.bok,
    JSON.stringify(navTilNotat));
  await p.evaluate(() => window.__huskis.closeNoteEditor());

  const navTilListe = await p.evaluate((LA) => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const ok = H.navigateToObject({ type: 'card', id: LA });
    return { ok, fane: H.mainTab, kort: !!document.querySelector('#board .card[data-id="' + LA + '"]') };
  }, LA);
  log(M('et listetreff bytter tilbake til Lister-fanen og viser kortet'),
    navTilListe.ok && navTilListe.fane === 'lists' && navTilListe.kort,
    JSON.stringify(navTilListe));

  const navTilHylle = await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.setMainTab('lists');
    const ok = H.navigateToObject({ type: 'noteProject', id: ids2.proj });
    return { ok, fane: H.mainTab, modal: !document.getElementById('notes-nav-modal').hidden };
  }, ids2);
  log(M('et bokhylletreff åpner notat-navigasjonen'),
    navTilHylle.ok && navTilHylle.fane === 'notes' && navTilHylle.modal,
    JSON.stringify(navTilHylle));
  await p.evaluate(() => window.__huskis.closeNotesNav());

  /* ---------- 10. Koblinger begge veier ---------- */
  const koblet = await p.evaluate(({ ids2, LA, GA, UA }) => {
    const H = window.__huskis;
    // Fra NOTATSIDEN: notat → liste.
    const a = H.addLink('note', ids2.fri1, 'card', LA);
    // Fra LISTESIDEN: mappe → notatbok (samme funksjon, motsatt rekkefølge).
    const b = H.addLink('group', GA, 'noteFolder', ids2.bok);
    // … og område → bokhylle.
    const c = H.addLink('universe', UA, 'noteProject', ids2.proj);
    // Samme kobling to ganger skal ikke lage to.
    const d = H.addLink('card', LA, 'note', ids2.fri1);
    return {
      a, b, c, d,
      fraNotat: H.linksFor('note', ids2.fri1).length,
      fraListe: H.linksFor('card', LA).length,
      fraMappe: H.linksFor('group', GA).length,
      fraBok: H.linksFor('noteFolder', ids2.bok).length,
      fraOmråde: H.linksFor('universe', UA).length,
      fraHylle: H.linksFor('noteProject', ids2.proj).length,
    };
  }, { ids2, LA, GA, UA });
  log(M('koblinger opprettes fra begge sider, og en dublett lages ikke'),
    koblet.a && koblet.b && koblet.c && !koblet.d &&
    koblet.fraNotat === 1 && koblet.fraListe === 1 && koblet.fraMappe === 1 &&
    koblet.fraBok === 1 && koblet.fraOmråde === 1 && koblet.fraHylle === 1,
    JSON.stringify(koblet));

  /* ANTALLET STÅR I RADEN, ikke under den. «Koblinger» viste tallet som HINT,
     og et hint legger en linje til under etiketten: raden ble halvannen gang
     så høy som naboene sine, for ett siffer (docs/menus.md, «Radene»).
     Telleren er derfor en dempet pille i enden av raden, og radhøyden er
     nøyaktig den samme som en rad uten teller. */
  await p.evaluate(() => window.__huskis.setMainTab('lists'));
  await p.waitForTimeout(250);
  await p.locator('#board .card[data-id="' + LA + '"] .obj-menu-btn').first().click();
  await p.waitForTimeout(300);
  const teller = await p.evaluate(() => {
    const rader = [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')];
    const kobling = rader.find((r) => /^Koblinger/.test(
      (r.querySelector('.obj-menu-label') || {}).textContent || ''));
    const uten = rader.filter((r) => r !== kobling && !r.querySelector('.obj-menu-hint'));
    return {
      tall: kobling ? (kobling.querySelector('.obj-menu-count') || {}).textContent : null,
      hint: kobling ? !!kobling.querySelector('.obj-menu-hint') : null,
      h: kobling ? Math.round(kobling.getBoundingClientRect().height) : null,
      naboer: [...new Set(uten.map((r) => Math.round(r.getBoundingClientRect().height)))],
    };
  });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  log(M('12b antallet koblinger står som teller i raden, ikke som en hintlinje'),
    teller.tall === '1' && teller.hint === false &&
    teller.naboer.length === 1 && teller.h === teller.naboer[0],
    JSON.stringify(teller));

  // Navigering via koblingen, begge veier.
  await p.evaluate((ids2) => { window.__huskis.setMainTab('notes'); window.__huskis.openLinksModal('note', ids2.fri1); }, ids2);
  await p.waitForFunction(() => !document.getElementById('links-modal').hidden, null, { timeout: 5000, polling: 50 });
  const koblingsrad = await p.evaluate(() => ({
    navn: [...document.querySelectorAll('#links-list .link-name')].map((e) => e.textContent),
    sti: [...document.querySelectorAll('#links-list .link-meta')].map((e) => e.textContent),
  }));
  log(M('koblingsmodalen viser målet med navn og kontekststi'),
    koblingsrad.navn.join('|') === 'Prøvesvar' && /Klinikken/.test(koblingsrad.sti.join('')),
    JSON.stringify(koblingsrad));
  await p.click('#links-list .link-open');
  await p.waitForTimeout(200);
  const etterKoblingsklikk = await p.evaluate((LA) => ({
    fane: window.__huskis.mainTab,
    kort: !!document.querySelector('#board .card[data-id="' + LA + '"]'),
    modalLukket: document.getElementById('links-modal').hidden,
  }), LA);
  log(M('et klikk på koblingen tar deg til listen — i Lister-fanen'),
    etterKoblingsklikk.fane === 'lists' && etterKoblingsklikk.kort &&
    etterKoblingsklikk.modalLukket, JSON.stringify(etterKoblingsklikk));

  await p.evaluate((LA) => window.__huskis.openLinksModal('card', LA), LA);
  await p.waitForFunction(() => !document.getElementById('links-modal').hidden, null, { timeout: 5000, polling: 50 });
  await p.click('#links-list .link-open');
  await p.waitForTimeout(250);
  const etterMotsattKlikk = await p.evaluate(() => ({
    fane: window.__huskis.mainTab,
    editor: !document.getElementById('note-editor').hidden,
  }));
  log(M('… og motsatt vei: fra listen åpnes notatet i Notater-fanen'),
    etterMotsattKlikk.fane === 'notes' && etterMotsattKlikk.editor,
    JSON.stringify(etterMotsattKlikk));
  await p.evaluate(() => window.__huskis.closeNoteEditor());

  // Velgeren i modalen bruker det globale søket, scopet til den andre siden.
  await p.evaluate((ids2) => window.__huskis.openLinksModal('note', ids2.fri2), ids2);
  await p.fill('#links-pick-input', 'Prøvesvar');
  await p.waitForTimeout(150);
  const velger = await p.evaluate(() =>
    [...document.querySelectorAll('#links-pick-list .link-row')].map((r) => r.dataset.type + ':' + r.dataset.id));
  await p.click('#links-pick-list .link-open');
  await p.waitForTimeout(150);
  const etterVelger = await p.evaluate((ids2) => ({
    antall: window.__huskis.linkCount('note', ids2.fri2),
    rader: [...document.querySelectorAll('#links-list .link-name')].map((e) => e.textContent),
  }), ids2);
  log(M('velgeren finner listesiden og lager koblingen ved klikk'),
    velger.length === 1 && velger[0].startsWith('card:') &&
    etterVelger.antall === 1 && etterVelger.rader.join('|') === 'Prøvesvar',
    JSON.stringify({ velger, etterVelger }));

  // Fjerning.
  await p.click('#links-list .link-remove');
  await p.waitForTimeout(150);
  const etterFjerning = await p.evaluate((ids2) => ({
    antall: window.__huskis.linkCount('note', ids2.fri2),
    tom: !document.getElementById('links-empty').hidden,
  }), ids2);
  log(M('✕ fjerner koblingen, og tomtilstanden vises'),
    etterFjerning.antall === 0 && etterFjerning.tom, JSON.stringify(etterFjerning));
  await p.evaluate(() => window.__huskis.closeLinksModal());

  /* ---------- 11. Koblinger og livssyklus ---------- */
  const flyttet = await p.evaluate(({ ids2, GA }) => {
    const H = window.__huskis;
    // Flytt notatboken til en NY bokhylle: koblingen skal følge objektet.
    const ny = H.addNoteProject();
    const bok = H.state.noteProjects.find((x) => x.id === ids2.proj).folders.find((f) => f.id === ids2.bok);
    const fra = H.state.noteProjects.find((x) => x.id === ids2.proj);
    fra.folders = fra.folders.filter((f) => f.id !== ids2.bok);
    bok.project = ny.id;
    H.state.noteProjects.find((x) => x.id === ny.id).folders.push(bok);
    H.state.notes.forEach((n) => { if (n.folder === bok.id) n.project = ny.id; });
    H.save();
    return { antall: H.linksFor('noteFolder', ids2.bok).length,
      fraMappe: H.linksFor('group', GA).length, nyHylle: ny.id };
  }, { ids2, GA });
  log(M('en flyttet notatbok beholder koblingen sin'),
    flyttet.antall === 1 && flyttet.fraMappe === 1, JSON.stringify(flyttet));

  const koblingArkivert = await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.setNoteArchived('noteFolder', ids2.bok, true);
    const rader = H.linksFor('noteFolder', ids2.bok).length;
    H.openLinksModal('group', H.state.universes[0].groups[0].id);
    const gone = !!document.querySelector('#links-list .link-row.is-gone');
    const knapp = document.querySelector('#links-list .link-open').disabled;
    H.closeLinksModal();
    H.setNoteArchived('noteFolder', ids2.bok, false);
    return { rader, gone, knapp };
  }, ids2);
  log(M('en kobling til et ARKIVERT mål blir stående, men vises som utilgjengelig'),
    koblingArkivert.rader === 1 && koblingArkivert.gone && koblingArkivert.knapp,
    JSON.stringify(koblingArkivert));

  const koblingSlettet = await p.evaluate(({ ids2, LA }) => {
    const H = window.__huskis;
    const før = H.linkCount('note', ids2.fri1);
    // Slett LISTEN for godt: koblingen skal gå med (databasens kaskade), og
    // id-en skal være gravlagt så en utdatert kopi ikke setter den inn igjen.
    const link = H.linksFor('note', ids2.fri1)[0];
    const card = H.state.universes[0].groups[0].cards.find((c) => c.id === LA);
    H.state.universes[0].groups[0].cards = H.state.universes[0].groups[0].cards.filter((c) => c.id !== LA);
    H.state._tomb.cards[LA] = Date.now();
    H.tombLinksTo(LA);
    H.save();
    return { før, etter: H.linkCount('note', ids2.fri1),
      gravlagt: H.tombIds().has(link.id), fantes: !!card };
  }, { ids2, LA });
  log(M('en kobling forsvinner når målet slettes for godt, og id-en gravlegges'),
    koblingSlettet.før === 1 && koblingSlettet.etter === 0 && koblingSlettet.gravlagt,
    JSON.stringify(koblingSlettet));

  /* ---------- 12. Synk ---------- */
  const synk = await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.setNoteArchived('note', ids2.fri1, true);
    H.addLink('noteProject', ids2.proj, 'universe', H.state.universes[0].id);
    H.save();
    return { linkId: H.linksFor('noteProject', ids2.proj)[0].id };
  }, ids2);
  await p.evaluate(() => window.__huskis.cloudCycle());
  await synkeRo(p);
  const iDb = await mockDb(p);
  const dbNotat = (iDb.notes || []).find((n) => n.id === ids2.fri1);
  const dbLink = (iDb.object_links || []).find((l) => l.id === synk.linkId);
  log(M('`archived` synkes til serveren'), !!dbNotat && dbNotat.archived === true,
    JSON.stringify(dbNotat && { id: dbNotat.id, archived: dbNotat.archived }));
  log(M('koblingsraden lander med én kolonne per side'),
    !!dbLink && dbLink.note_project_id === ids2.proj &&
    dbLink.universe_id === iDb.universes[0].id && !dbLink.note_id && !dbLink.card_id,
    JSON.stringify(dbLink));

  await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.removeLink('noteProject', ids2.proj, 'universe', H.state.universes[0].id);
    H.save();
  }, ids2);
  await p.evaluate(() => window.__huskis.cloudCycle());
  await synkeRo(p);
  const iDb2 = await mockDb(p);
  log(M('en fjernet kobling blir borte på serveren også'),
    !(iDb2.object_links || []).some((l) => l.id === synk.linkId),
    String((iDb2.object_links || []).length));

  // En kobling hvis MÅL er borte på serveren skal ikke låse synken.
  const dangling = await p.evaluate((ids2) => {
    const H = window.__huskis;
    H.state.links.push({ id: 'aaaaaaaa-0000-4000-8000-00000000dead',
      noteType: 'noteProject', noteId: ids2.proj,
      listType: 'card', listId: 'bbbbbbbb-0000-4000-8000-0000000000ff',
      ts: Date.now(), org: 'test' });
    H.save();
    return H.state.links.length;
  }, ids2);
  await p.evaluate(() => window.__huskis.cloudCycle());
  await synkeRo(p);
  await p.evaluate(() => window.__huskis.cloudCycle());
  await synkeRo(p);
  const etterDangling = await p.evaluate(() => ({
    igjen: window.__huskis.state.links.filter((l) => l.id === 'aaaaaaaa-0000-4000-8000-00000000dead').length,
    gravlagt: window.__huskis.tombIds().has('aaaaaaaa-0000-4000-8000-00000000dead'),
    status: (document.getElementById('sync-status') || {}).dataset || {},
  }));
  log(M('en kobling til et mål som ikke finnes gravlegges i stedet for å låse synken'),
    etterDangling.igjen === 0 && etterDangling.gravlagt &&
    etterDangling.status.state !== 'rejected',
    JSON.stringify({ start: dangling, etter: etterDangling }));

  /* ---------- 13. Mock-backenden speiler DB-kontrakten for koblingene ----------
     Produksjonen har to `check`-vilkår på `object_links`: NØYAKTIG én kolonne
     på notatsiden og nøyaktig én på listesiden. Godtok mocken null eller to,
     ville en nettlesertest kunne bevise en skriving produksjonen avviser. */
  const kontrakt = await p.evaluate(async (ids2) => {
    const c = window.HK_MOCK.createClient();
    const H = window.__huskis;
    const uni = H.state.universes[0];
    const rad = (x) => Object.assign({
      id: 'cccccccc-0000-4000-8000-' + String(Date.now()).slice(-12),
      owner_id: 'u1', ts: Date.now(), org: 'test',
      note_project_id: null, note_folder_id: null, note_id: null,
      universe_id: null, group_id: null, card_id: null,
    }, x);
    const feil = async (x) => {
      const r = await c.from('object_links').insert(rad(x));
      return r.error ? r.error.message : null;
    };
    return {
      ingenNotatside: await feil({ universe_id: uni.id }),
      toNotatsider: await feil({ note_project_id: ids2.proj, note_id: ids2.fri1, universe_id: uni.id }),
      ingenListeside: await feil({ note_project_id: ids2.proj }),
      toListesider: await feil({ note_project_id: ids2.proj, universe_id: uni.id, group_id: uni.groups[0].id }),
      rader: (JSON.parse(localStorage.getItem('hk-mock-db')).object_links || []).length,
    };
  }, ids2);
  const avvist = (m) => typeof m === 'string' && /check constraint/.test(m);
  log(M('mocken avviser en koblingsrad uten eller med to id-er på notatsiden'),
    avvist(kontrakt.ingenNotatside) && avvist(kontrakt.toNotatsider), JSON.stringify(kontrakt));
  log(M('mocken avviser en koblingsrad uten eller med to id-er på listesiden'),
    avvist(kontrakt.ingenListeside) && avvist(kontrakt.toListesider), JSON.stringify(kontrakt));

  /* ---------- 7d) Foten: to kasser side om side, og etiketten ----------
     Måles TIL SLUTT: seksjonen setter arkiv- og slette-flagg for å få begge
     kassene fram samtidig, og det ville stått i veien for koblingsseksjonene
     over (en kobling til et bortlagt notat er en annen sak, med sin egen
     sjekk). Her er det kun geometrien og etiketten som måles. */
  await p.evaluate(() => {
    const H = window.__huskis;
    H.closeNotesNav();
    H.closeNoteEditor();
    H.setMainTab('notes');
  });
  await p.waitForFunction(() => !document.getElementById('notes-board').hidden,
    null, { timeout: 5000, polling: 100 });
  /* Begge kassene skal ha innhold samtidig — det er da foten har TO felt å dele
     bredden mellom. Plasseringen settes eksplisitt (kassene er scopet til den
     man står i), og flaggene skrives direkte: her handler det om geometrien, og
     en buffret sletting ville dessuten committet seg selv midt i målingen. */
  await p.evaluate((ids) => {
    const H = window.__huskis;
    H.setActiveProject(ids.proj);
    H.setActiveNoteFolder(null);
    H.state.notes.forEach((n) => { n.archived = false; n.trashed = false; n._pendingDelete = false; });
    const frie = H.state.notes.filter((n) => n.project === ids.proj && !n.folder);
    if (frie[0]) frie[0].archived = true;
    if (frie[1]) frie[1].trashed = true;
    H.renderNotes();
  }, ids2);
  await p.waitForFunction(() => {
    const a = document.getElementById('note-archive'), t = document.getElementById('note-trash');
    return !!a && !a.hidden && !!t && !t.hidden;
  }, null, { timeout: 5000, polling: 100 });
  const fot = await p.evaluate(() => {
    const R = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top),
        b: Math.round(b.bottom), w: Math.round(b.width) }; };
    return { dokk: R('#notes-dock'), arkiv: R('#note-archive'), kasse: R('#note-trash'),
      vh: window.innerHeight, vw: window.innerWidth,
      fast: getComputedStyle(document.getElementById('notes-dock')).position };
  });
  log(M('7 foten står fast nederst i viewportet'),
    !!fot.dokk && fot.fast === 'fixed' && fot.dokk.b === fot.vh && fot.dokk.w === fot.vw,
    JSON.stringify(fot.dokk) + ' vh=' + fot.vh);
  /* Halve bredden hver, med luft rundt og mellom — som bokhyllenes egen fot i
     nav-modalen. Måles som «omtrent like brede, og til sammen nesten hele
     bredden». */
  const halv = fot.arkiv && fot.kasse
    && Math.abs(fot.arkiv.w - fot.kasse.w) <= 4
    && fot.arkiv.w + fot.kasse.w >= fot.vw - 60
    && fot.kasse.l > fot.arkiv.r;
  log(M('7 arkivet og kassen deler bredden likt, med luft mellom seg'), !!halv,
    JSON.stringify({ arkiv: fot.arkiv, kasse: fot.kasse, vw: fot.vw }));

  // Etiketten over det løftede objektet sier hva slippet betyr.
  await p.evaluate(() => {
    const H = window.__huskis;
    H.state.notes.forEach((n) => { n.archived = false; n.trashed = false; n._pendingDelete = false; });
    H.renderNotes();
  });
  await p.waitForTimeout(300);
  const notatSel = '#notes-board .note-card';
  await G.lift(p, await centre(p, notatSel), touch);
  await G.travel(p, () => centre(p, '#note-archive-btn'), touch);
  const etikett = await p.evaluate(() => {
    const el = document.querySelector('[data-dnd-dragging]');
    return { tekst: el && el.dataset.dropLabel,
      farge: !!el && el.classList.contains('to-archive'),
      malt: !!el && getComputedStyle(el, '::after').content !== 'none' };
  });
  /* ETIKETTEN MÅ BYTTE BEGGE VEIER I DET SAMME DRAGET. De to siktesetterne
     kalles etter hverandre i samme politikkrunde, og da de skrev etiketten hver
     for seg, vant den som kjørte SIST: arkiv → søppel tømte «Slett» i samme
     åndedrag som den ble satt, mens søppel → arkiv virket. Begge retningene
     måles derfor her, uten å slippe imellom. */
  await G.travel(p, () => centre(p, '#note-trash-btn'), touch);
  const tilKassen = await p.evaluate(() => {
    const el = document.querySelector('[data-dnd-dragging]');
    return { tekst: el && el.dataset.dropLabel,
      slett: !!el && el.classList.contains('to-trash'),
      arkiv: !!el && el.classList.contains('to-archive') };
  });
  await G.travel(p, () => centre(p, '#note-archive-btn'), touch);
  const tilbakeTilArkivet = await p.evaluate(() => {
    const el = document.querySelector('[data-dnd-dragging]');
    return { tekst: el && el.dataset.dropLabel,
      slett: !!el && el.classList.contains('to-trash'),
      arkiv: !!el && el.classList.contains('to-archive') };
  });
  // … og ut av begge: ingen etikett når man ikke sikter på noe.
  await G.travel(p, () => centre(p, notatSel), touch);
  const utenfor = await p.evaluate(() => {
    const el = document.querySelector('[data-dnd-dragging]');
    return { tekst: el && el.dataset.dropLabel,
      slett: !!el && el.classList.contains('to-trash'),
      arkiv: !!el && el.classList.contains('to-archive') };
  });
  await G.drop(p, undefined, touch);
  await p.waitForTimeout(400);
  log(M('7 etiketten over det løftede notatet sier «Arkiver»'),
    etikett.tekst === 'Arkiver' && etikett.farge === true && etikett.malt === true,
    JSON.stringify(etikett));
  log(M('7 arkiv → søppelkasse bytter etiketten til «Slett»'),
    tilKassen.tekst === 'Slett' && tilKassen.slett === true && tilKassen.arkiv === false,
    JSON.stringify(tilKassen));
  log(M('7 … og søppelkasse → arkiv bytter den tilbake til «Arkiver»'),
    tilbakeTilArkivet.tekst === 'Arkiver' && tilbakeTilArkivet.arkiv === true
    && tilbakeTilArkivet.slett === false, JSON.stringify(tilbakeTilArkivet));
  log(M('7 … og ut av begge forsvinner etiketten helt'),
    !utenfor.tekst && utenfor.slett === false && utenfor.arkiv === false,
    JSON.stringify(utenfor));

  /* ---------- 14. Fokus når noe arkiveres ---------- */
  /* Sletting har alltid flyttet fokus FØR raden forsvant; arkivet gjorde det
     ikke, og fokus falt til `<body>` — nettopp der man trenger et sted å
     fortsette fra. Måles på begge utfallene: med en nabo igjen, og på det
     SISTE notatet, der ＋-knappen er stedet. */
  await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    (H.state.notes || []).slice().forEach((n) => { n.archived = false; n.trashed = false; });
    H.renderNotes();
  });
  await p.waitForTimeout(300);
  const arkivFokus = await p.evaluate(async () => {
    const H = window.__huskis;
    const kort = [...document.querySelectorAll('#notes-board .note-card')];
    if (kort.length < 2) return { for_få: kort.length };
    const første = kort[0].dataset.id;
    kort[0].focus();
    H.setNoteArchived('note', første, true);
    await new Promise((r) => setTimeout(r, 250));
    const a = document.activeElement;
    const medNabo = { erBody: a === document.body, hva: a ? (a.id || a.className) : 'ingen' };
    // …og så det siste som står igjen.
    const igjen = [...document.querySelectorAll('#notes-board .note-card')];
    const alle = igjen.map((el) => el.dataset.id);
    alle.forEach((id, i) => { if (i < alle.length - 1) H.setNoteArchived('note', id, true); });
    await new Promise((r) => setTimeout(r, 200));
    const sisteEl = document.querySelector('#notes-board .note-card');
    const siste = sisteEl && sisteEl.dataset.id;
    if (sisteEl) sisteEl.focus();
    if (siste) H.setNoteArchived('note', siste, true);
    await new Promise((r) => setTimeout(r, 250));
    const b = document.activeElement;
    return { medNabo, sisteHva: b ? (b.id || b.className) : 'ingen', sisteErBody: b === document.body };
  });
  log(M('14 fokus lander på NABOKORTET når et notat arkiveres, ikke på <body>'),
    !arkivFokus.for_få && arkivFokus.medNabo && arkivFokus.medNabo.erBody === false
    && /note-card/.test(arkivFokus.medNabo.hva || ''),
    JSON.stringify(arkivFokus.medNabo || arkivFokus));
  log(M('14 … og det SISTE notatet sender fokus til ＋-knappen'),
    arkivFokus.sisteHva === 'add-note-btn', JSON.stringify({ hva: arkivFokus.sisteHva, body: arkivFokus.sisteErBody }));

  /* ---------- 15. «Frie notater» har ingen objektmeny ---------- */
  await p.evaluate(() => window.__huskis.openNotesNav());
  await p.waitForTimeout(400);
  const friRad = await p.evaluate(() => {
    const rad = document.querySelector('#notes-nav-board .note-free-row');
    if (!rad) return null;
    const knapp = rad.querySelector('.obj-menu-btn');
    return {
      finnes: !!knapp,
      skjult: !!(knapp && knapp.hidden),
      // Et navnløst tabbstopp er det egentlige problemet: en knapp uten navn
      // leses som «knapp» og gjør ingenting.
      navnløseTabbstopp: [...document.querySelectorAll('#notes-nav-board button')]
        .filter((b) => b.offsetParent && !b.getAttribute('aria-label') && !(b.textContent || '').trim())
        .length,
    };
  });
  log(M('15 raden «Frie notater» har ingen objektmeny — og ingen navnløs knapp står igjen'),
    !!friRad && friRad.skjult === true && friRad.navnløseTabbstopp === 0, JSON.stringify(friRad));
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(250);

  /* ---------- 16. Utdraget i en kasse-/arkivrad ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    const n = (H.state.notes || [])[0];
    if (!n) return;
    n.archived = true;
    n.doc = { v: 1, blocks: [{ t: 'p', c: [{ s: 'Hemoglobin, ferritin, CRP og SR måles på nytt om fjorten dager, og svaret ringes inn til pasienten samme dag.' }] }] };
    H.renderNotes();
    H.openNotesArchive();
  });
  await p.waitForTimeout(400);
  const radMål = await p.evaluate(() => {
    const rad = document.querySelector('#trash-modal .trash-row');
    if (!rad) return null;
    const meta = rad.querySelector('.trash-meta');
    const knapper = [...rad.querySelectorAll('button')];
    const rr = rad.getBoundingClientRect();
    const modal = rad.closest('.modal').getBoundingClientRect();
    return {
      tekst: meta ? meta.textContent : '',
      lengde: meta ? meta.textContent.length : 0,
      høyde: Math.round(rr.height),
      knapper: knapper.length,
      innenfor: rr.right <= modal.right + 1 && rr.left >= modal.left - 1,
      overlapp: knapper.some((b) => {
        if (!meta) return false;
        const a = b.getBoundingClientRect(), m = meta.getBoundingClientRect();
        return Math.min(a.right, m.right) - Math.max(a.left, m.left) > 0.5
          && Math.min(a.bottom, m.bottom) - Math.max(a.top, m.top) > 0.5;
      }),
    };
  });
  log(M('16 utdraget i en arkivrad er kort, og raden holder seg innenfor modalen'),
    !!radMål && radMål.lengde > 0 && radMål.lengde <= 50 && radMål.innenfor === true,
    JSON.stringify(radMål));
  log(M('16 … og radens knapper ligger ikke oppå teksten'),
    !!radMål && radMål.overlapp === false && radMål.knapper === 2, JSON.stringify(radMål));

  /* ---------- 17. Fokus blir i modalen ---------- */
  /* To arkiverte notater, så det finnes en rad igjen å gå til. Deretter
     trykkes «Hent ut av arkivet» på den FØRSTE — med ekte klikk, for det er
     nettopp knappen i modalen som er handlingen. */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  await p.evaluate(() => {
    const H = window.__huskis;
    (H.state.notes || []).slice(0, 2).forEach((n) => { n.archived = true; n.trashed = false; });
    H.renderNotes();
    H.openNotesArchive();
  });
  await p.waitForTimeout(400);
  const førAntall = await p.evaluate(() => document.querySelectorAll('#trash-modal .trash-row').length);
  await p.locator('#trash-modal .trash-row').first().locator('.btn').last().click();
  await p.waitForTimeout(400);
  const etterHent = await p.evaluate(() => {
    const a = document.activeElement;
    const modal = document.getElementById('trash-modal');
    return {
      modalÅpen: !modal.hidden,
      fokusIModalen: !!(a && modal.contains(a)),
      hva: a ? (a.id || a.className || a.tagName) : 'ingen',
      rader: document.querySelectorAll('#trash-modal .trash-row').length,
    };
  });
  log(M('17 en gjenoppretting fra arkivmodalen lar fokus bli INNE i dialogen'),
    førAntall === 2 && etterHent.modalÅpen === true && etterHent.fokusIModalen === true,
    JSON.stringify(Object.assign({ førAntall: førAntall }, etterHent)));
  // … og når siste rad er borte, er det fortsatt modalens egne kontroller.
  const sisteKnapp = p.locator('#trash-modal .trash-row .btn').last();
  if (await sisteKnapp.count()) {
    await sisteKnapp.click();
    await p.waitForTimeout(400);
  }
  const etterSiste = await p.evaluate(() => {
    const a = document.activeElement;
    const modal = document.getElementById('trash-modal');
    return { modalÅpen: !modal.hidden, fokusIModalen: !!(a && modal.contains(a)),
      hva: a ? (a.id || a.className || a.tagName) : 'ingen',
      rader: document.querySelectorAll('#trash-modal .trash-row').length };
  });
  log(M('17 … også når den siste raden er hentet ut'),
    etterSiste.modalÅpen === true && etterSiste.fokusIModalen === true && etterSiste.rader === 0,
    JSON.stringify(etterSiste));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);

  log(M('ingen JS-feil'), jsFeil.length === 0, jsFeil.join(' | ') || 'ingen');
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
