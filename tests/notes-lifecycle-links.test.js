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
       et drag i notatfanen kan slippes i kassen på alle tre nivåene
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

  Kjøres på BÅDE desktop- og mobil-viewport der oppførselen avhenger av layout.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-lifecycle-links.test.js
*/
const path = require('path');
const { chromium } = require(path.join(process.env.NODE_PATH ||
  require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { centre, dragFromTo } = require('./dnd-gestures');

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

  /* ---------- 7. Drag til søppelkassen i notatfanen ---------- */
  // Bygg treet på nytt (forrige seksjon tømte det).
  const ids2 = await byggNotater(p);
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForFunction(() => document.querySelectorAll('#notes-board .note-card').length === 2,
    null, { timeout: 5000, polling: 100 });

  const kassenFørDrag = await p.evaluate(() => document.getElementById('note-trash').hidden);
  const kortSel = () => '#notes-board .note-card[data-id="' + ids2.fri1 + '"]';
  await dragFromTo(p, await centre(p, kortSel()),
    () => centre(p, '#note-trash-btn'), { touch });
  await p.waitForTimeout(120);
  const etterDrag = await p.evaluate((ids2) => {
    const H = window.__huskis;
    return {
      synlige: H.notesIn(H.state.activeProject, null).map((n) => n.title),
      søppel: H.trashedNotesIn(H.state.activeProject, null).map((n) => n.title),
    };
  }, ids2);
  log(M('kassen er skjult før draget, og et notat sluppet i den slettes'),
    kassenFørDrag && etterDrag.søppel.join('|') === 'Blodprøver' &&
    !etterDrag.synlige.includes('Blodprøver'), JSON.stringify(etterDrag));
  await p.evaluate((ids2) => window.__huskis.restoreNoteObject('note', ids2.fri1), ids2);

  // … og en notatbok i bokhyllens egen kasse.
  await p.evaluate(() => window.__huskis.openNotesNav());
  await p.waitForFunction(() => !!document.querySelector('#notes-nav-board .note-folder-row'),
    null, { timeout: 5000, polling: 100 });
  const bokSel = '#notes-nav-board .note-folder-row[data-id="' + ids2.bok + '"]';
  await dragFromTo(p, await centre(p, bokSel),
    () => centre(p, '#notes-nav-board .note-folder-trash-btn'), { touch });
  await p.waitForTimeout(120);
  const bokEtterDrag = await p.evaluate(() => {
    const H = window.__huskis;
    return H.trashedNoteFoldersOf(H.state.noteProjects[0]).map((f) => f.name);
  });
  log(M('en notatbok sluppet i bokhyllens kasse slettes'),
    bokEtterDrag.join('|') === 'Anatomi', JSON.stringify(bokEtterDrag));
  await p.evaluate((ids2) => window.__huskis.restoreNoteObject('noteFolder', ids2.bok), ids2);
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
