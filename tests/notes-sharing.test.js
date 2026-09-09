/*
  Nettlesertest for DELING AV NOTATER (docs/rettigheter-og-deling.md del 15,
  docs/notater-plan.md) — mot mock-backenden (?mock=1).

  Dekker den klientvendte oppførselen SQL-testene ikke ser:
    1. «Deling og medlemmer» ligger i den VANLIGE objektmenyen på alle tre
       notatnivåene — ingen ny menytype
    2. Delemodalen er den SAMME: medlemsliste med kategorier, invitasjonsfelt,
       rollevelger og «Forlat»/«Slett» etter serverens capabilities
    3. Eier / redaktør / REN LESER: låsen er det som lager leseren, og en leser
       får verken omdøping, sletting, ＋-knapper eller en skrivbar editor
    4. Deling DIREKTE på notatbok og notat: mottakeren ser objektet i den
       virtuelle «Delt med meg»-bokhyllen, og aldri navnet på bokhyllen over
    5. Tilbakekalling: objektet forsvinner ved neste synk, editoren lukkes, og
       en nøktern melding forklarer hva som skjedde
    6. En KOBLING til et notat man mister tilgang til blir stående (den
       ødelegges ikke), men kan ikke åpnes

  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-sharing.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Fikstur:
     A eier bokhyllen P (notatbok F med notat N1, og det frie notatet N2).
     B er MEDLEM av P — altså redaktør så lenge bokhyllen er åpen.
     C har en DIREKTE rolle på notatet N1, og ingenting annet.
     D er eksplisitt EIER av notatboken F, uten rolle i bokhyllen.
     C har i tillegg sitt eget område CU og en kobling fra N1 til det. */
function buildDB() {
  const uA = 'uA', uB = 'uB', uC = 'uC', uD = 'uD';
  const P = U(), F = U(), N1 = U(), N2 = U(), CU = U(), LNK = U();
  const doc = { v: 1, blocks: [{ t: 'p', c: [{ s: 'Femti deltakere' }] }] };
  const base = (x) => Object.assign({
    trashed: false, archived: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const mem = (user, on, role, pos) => Object.assign({
    id: U(), user_id: user,
    universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: null,
    role: role, pos: pos || 0, created_at: 1,
  }, on);
  return {
    ids: { uA, uB, uC, uD, P, F, N1, N2, CU, LNK },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: uA, email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: uB, email: 'b@x.no', display_name: 'Bo Medlem', user_metadata: {} },
        { id: uC, email: 'c@x.no', display_name: 'Cato Notat', user_metadata: {} },
        { id: uD, email: 'd@x.no', display_name: 'Dina Notatbok', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x', 'c@x.no': 'x', 'd@x.no': 'x' },
      universes: [Object.assign(base({ id: CU, owner_id: uC, name: 'Catos område' }),
        { is_cat: false, cat_id: null })],
      groups: [], cards: [], items: [], ideas: [],
      note_projects: [base({ id: P, owner_id: uA, name: 'Felles bokhylle' })],
      note_folders: [base({ id: F, owner_id: uA, project_id: P, name: 'Metode' })],
      notes: [
        base({ id: N1, owner_id: uA, project_id: P, folder_id: F, title: 'Utvalg', body: doc }),
        base({ id: N2, owner_id: uA, project_id: P, folder_id: null, title: 'Løse tanker', body: doc, pos: 1 }),
      ],
      object_links: [{ id: LNK, owner_id: uC, note_project_id: null, note_folder_id: null,
        note_id: N1, universe_id: CU, group_id: null, card_id: null, ts: 1, org: 'c' }],
      memberships: [
        mem(uA, { note_project_id: P }, 'owner', 0),
        mem(uB, { note_project_id: P }, 'member', 0),
        mem(uC, { note_id: N1 }, 'member', 0),
        mem(uD, { note_folder_id: F }, 'owner', 0),
        mem(uC, { universe_id: CU }, 'owner', 0),
      ],
      share_invites: [], tombstones: [],
    },
  };
}

async function loadAs(page, db, uid, email, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email }) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email,
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid, email });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return H && H.authUser && H.lastMy;
  }, null, { timeout: 8000, polling: 200 });
  await page.evaluate(() => window.__huskis.setMainTab('notes'));
  await page.waitForTimeout(250);
}

// Stå i den notatboken notatet ligger i, så kortet faktisk er på flaten.
const gotoFolder = async (p, project, folder) => {
  await p.evaluate(({ project, folder }) => {
    window.__huskis.setActiveProject(project);
    window.__huskis.setActiveNoteFolder(folder);
  }, { project, folder });
  await p.waitForTimeout(300);
};
const openNotesNav = async (p) => {
  await p.evaluate(() => window.__huskis.openNotesNav());
  await p.waitForTimeout(400);
};
// Radene i objektmenyen for et objekt, funnet på id.
async function menuRows(p, sel) {
  await p.locator(sel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  const rows = await p.locator('#obj-menu-panel .obj-menu-row .obj-menu-label').allTextContents();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  return rows;
}
async function menuPick(p, sel, label) {
  await p.locator(sel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  await p.locator('#obj-menu-panel .obj-menu-row', { hasText: label }).first().click();
  await p.waitForTimeout(500);
}
// Én synk-runde, og vent til køen er tom.
async function sync(p) {
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return el && el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 150 });
  await p.waitForTimeout(250);
}
const readDB = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('hk-mock-db')));
const writeDB = (p, db) => p.evaluate((d) => {
  localStorage.setItem('hk-mock-db', JSON.stringify(d));
}, db);

async function run(label, viewport, mobile) {
  const { ids, db } = buildDB();
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport }, mobile ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  const projSel = '.note-project-card[data-id="' + ids.P + '"]';
  const folderSel = '.item.note-folder-row[data-id="' + ids.F + '"]';
  const noteSel = '.note-card[data-id="' + ids.N1 + '"]';

  /* ---------- 1) Eieren: deling ligger i den vanlige objektmenyen ---------- */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  await openNotesNav(p);
  const pRows = await menuRows(p, projSel);
  log(label + ' 1: bokhyllens meny har «Deling og medlemmer»',
    pRows.some((r) => /Deling/i.test(r)), pRows.join(' | '));
  const fRows = await menuRows(p, folderSel);
  log(label + ' 1: notatbokens meny har den samme raden',
    fRows.some((r) => /Deling/i.test(r)), fRows.join(' | '));
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(300);
  await gotoFolder(p, ids.P, ids.F);
  const nRows = await menuRows(p, noteSel);
  log(label + ' 1: notatkortets meny har den òg — alle tre nivåene kan deles',
    nRows.some((r) => /Deling/i.test(r)), nRows.join(' | '));

  /* ---------- 2) Delemodalen er den SAMME som for områder og mapper ---------- */
  await menuPick(p, noteSel, 'Deling');
  const modal = await p.evaluate(() => {
    const m = document.getElementById('share-modal');
    return {
      åpen: m && !m.hidden,
      tittel: (document.getElementById('share-title') || {}).textContent || '',
      kategorier: [...document.querySelectorAll('#share-body .share-section-title')].map((x) => x.textContent),
      medlemmer: [...document.querySelectorAll('#share-body .member-row .member-name')].map((x) => x.textContent),
      invitasjonsfelt: !!document.querySelector('#share-body .share-invite-form:not([hidden])'),
      rollevelger: !!document.querySelector('#share-body .share-role-select:not([hidden])'),
      slett: document.querySelectorAll('#share-body .share-delete').length,
    };
  });
  log(label + ' 2: delemodalen åpnes for notatet, med tittel og medlemsliste',
    modal.åpen && /Utvalg/.test(modal.tittel) && modal.medlemmer.length >= 2,
    JSON.stringify(modal));
  log(label + ' 2: kategoriene er notatsidens egne',
    modal.kategorier.some((k) => /bokhyllen/i.test(k)) && modal.kategorier.some((k) => /notatet/i.test(k)),
    modal.kategorier.join(' | '));
  log(label + ' 2: eieren får invitasjonsfelt, rollevelger og «Slett»',
    modal.invitasjonsfelt && modal.rollevelger && modal.slett === 1, JSON.stringify(modal));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  /* ---------- 3) Redaktøren: kan redigere, kan ikke slette bokhyllen ---------- */
  await loadAs(p, db, ids.uB, 'b@x.no', viewport);
  await openNotesNav(p);
  const bProj = await menuRows(p, projSel);
  log(label + ' 3: medlemmet får verken «Slett bokhyllen» eller eierkontroller',
    !bProj.some((r) => /Slett/i.test(r)), bProj.join(' | '));
  log(label + ' 3: … men har «Forlat bokhyllen»',
    bProj.some((r) => /Forlat/i.test(r)), bProj.join(' | '));
  const bAdd = await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const b = el && el.querySelector('.add-item-btn');
    return { finnes: !!b, skjult: !!(b && b.hidden) };
  }, projSel);
  log(label + ' 3: ＋-knappen for notatbøker er synlig for redaktøren',
    bAdd.finnes && !bAdd.skjult, JSON.stringify(bAdd));
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(300);
  const bEdit = await p.evaluate(async (id) => {
    const H = window.__huskis;
    H.openNoteEditor(id);
    await new Promise((r) => setTimeout(r, 200));
    const doc = document.getElementById('note-doc');
    const ut = { redigerbar: doc && doc.isContentEditable, verktøy: !document.getElementById('note-tools').hidden };
    H.closeNoteEditor();
    return ut;
  }, ids.N1);
  log(label + ' 3: editoren er skrivbar for redaktøren',
    bEdit.redigerbar && bEdit.verktøy, JSON.stringify(bEdit));

  /* ---------- 4) Ren leser: låsen er mekanismen ---------- */
  const låst = await readDB(p);
  låst.note_projects.find((x) => x.id === ids.P).locked = true;
  await writeDB(p, låst);
  await sync(p);
  const bLåst = await p.evaluate(async (id) => {
    const H = window.__huskis;
    H.openNoteEditor(id);
    await new Promise((r) => setTimeout(r, 200));
    const doc = document.getElementById('note-doc');
    const ut = {
      redigerbar: doc && doc.isContentEditable,
      verktøySkjult: document.getElementById('note-tools').hidden,
      status: (document.getElementById('note-status') || {}).textContent || '',
    };
    H.closeNoteEditor();
    return ut;
  }, ids.N1);
  log(label + ' 4: en LÅST bokhylle gjør editoren skrivebeskyttet for leseren',
    !bLåst.redigerbar && bLåst.verktøySkjult, JSON.stringify(bLåst));
  await openNotesNav(p);
  const bLåstRows = await menuRows(p, projSel);
  log(label + ' 4: leseren får verken «Endre navn», «Arkiver» eller «Slett»',
    !bLåstRows.some((r) => /Endre navn|Arkiver|Slett/i.test(r)), bLåstRows.join(' | '));
  const bLåstAdd = await p.evaluate((sel) => {
    const b = document.querySelector(sel + ' .add-item-btn');
    return !!(b && b.hidden);
  }, projSel);
  log(label + ' 4: … og ＋-knappen er borte', bLåstAdd === true, String(bLåstAdd));
  // Serveren er autoritativ: et rått skriveforsøk endrer ingenting.
  const bSkriv = await p.evaluate(async (id) => {
    const r = await window.__huskis.client.from('notes')
      .update({ title: 'kapret', ts: 9e12, org: 'b' }).eq('id', id);
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    return { feil: r.error ? r.error.message : null,
      tittel: db2.notes.find((n) => n.id === id).title };
  }, ids.N1);
  log(label + ' 4: serveren ruller tilbake leserens rå skriving',
    bSkriv.tittel === 'Utvalg', JSON.stringify(bSkriv));
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(200);

  /* ---------- 5) Direkte delt NOTAT: C ser ett notat og ingen struktur ---------- */
  await loadAs(p, db, ids.uC, 'c@x.no', viewport);
  const cState = await p.evaluate(() => {
    const H = window.__huskis;
    return {
      bokhyller: H.state.noteProjects.map((x) => ({ id: x.id, navn: x.name, virtuell: !!x._virtual })),
      notatbøker: H.state.noteProjects.reduce((n, x) => n + (x.folders || []).length, 0),
      notater: H.state.notes.map((n) => n.title),
      koblinger: (H.state.links || []).length,
    };
  });
  log(label + ' 5: C ser NØYAKTIG ett notat, i den virtuelle «Delt med meg»-bokhyllen',
    cState.notater.length === 1 && cState.bokhyller.length === 1 && cState.bokhyller[0].virtuell === true,
    JSON.stringify(cState));
  log(label + ' 5: verken notatbokens eller bokhyllens navn finnes i visningen',
    cState.notatbøker === 0 && !cState.bokhyller.some((b) => /Felles bokhylle/.test(b.navn)),
    JSON.stringify(cState.bokhyller));
  const cDom = await p.evaluate(() => document.body.innerText);
  log(label + ' 5: … og de lekker heller ikke ut i DOM-en',
    !/Felles bokhylle/.test(cDom) && !/Metode/.test(cDom), '');
  log(label + ' 5: koblingen fra notatet til Cs eget område er med',
    cState.koblinger === 1, String(cState.koblinger));
  await openNotesNav(p);
  const cShelf = await p.evaluate(() => {
    const card = document.querySelector('.note-project-card');
    return {
      meny: !!(card && card.querySelector('.obj-menu-btn') && !card.querySelector('.obj-menu-btn').hidden),
      addKnapp: !!(card && card.querySelector('.add-item-btn') && !card.querySelector('.add-item-btn').hidden),
      seksjon: !!(card && card.classList.contains('free-groups-card')),
    };
  });
  log(label + ' 5: den virtuelle bokhyllen er en SEKSJON — ingen meny, ingen ＋',
    cShelf.seksjon && !cShelf.meny && !cShelf.addKnapp, JSON.stringify(cShelf));
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(200);

  /* ---------- 6) Tilbakekalling: notatet forsvinner, editoren lukkes ---------- */
  await p.evaluate((id) => { window.__huskis.openNoteEditor(id); }, ids.N1);
  await p.waitForTimeout(250);
  const trukket = await readDB(p);
  trukket.memberships = trukket.memberships.filter((m) => !(m.user_id === 'uC' && m.note_id === ids.N1));
  await writeDB(p, trukket);
  await sync(p);
  const cEtter = await p.evaluate(() => ({
    editor: !document.getElementById('note-editor').hidden,
    notater: window.__huskis.state.notes.length,
    koblinger: (window.__huskis.state.links || []).length,
    toast: (document.getElementById('toast') || {}).textContent || '',
  }));
  log(label + ' 6: notatet er borte og editoren lukket etter tilbakekallingen',
    cEtter.notater === 0 && cEtter.editor === false, JSON.stringify(cEtter));
  log(label + ' 6: … med en nøktern melding om hva som skjedde',
    /tilgang/i.test(cEtter.toast), cEtter.toast);
  log(label + ' 6: KOBLINGEN blir stående — tap av tilgang ødelegger den ikke',
    cEtter.koblinger === 1, String(cEtter.koblinger));
  const cRad = await p.evaluate((id) => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    return { finnes: db2.notes.some((n) => n.id === id),
      kobling: db2.object_links.length };
  }, ids.N1);
  log(label + ' 6: notatet står urørt hos eieren (ingen sletting fra mottakerens side)',
    cRad.finnes === true && cRad.kobling === 1, JSON.stringify(cRad));

  /* ---------- 7) Direkte delt NOTATBOK: D ser boken, ikke bokhyllen ---------- */
  await loadAs(p, db, ids.uD, 'd@x.no', viewport);
  const dState = await p.evaluate(() => {
    const H = window.__huskis;
    const shelf = H.state.noteProjects[0] || {};
    return {
      bokhyller: H.state.noteProjects.length,
      virtuell: !!shelf._virtual,
      notatbøker: (shelf.folders || []).map((f) => f.name),
      notater: H.state.notes.map((n) => n.title),
    };
  });
  log(label + ' 7: D ser notatboken i den virtuelle bokhyllen, med notatet i',
    dState.bokhyller === 1 && dState.virtuell && dState.notatbøker.join() === 'Metode'
    && dState.notater.join() === 'Utvalg', JSON.stringify(dState));
  const dDom = await p.evaluate(() => document.body.innerText);
  log(label + ' 7: bokhyllens navn lekker ikke', !/Felles bokhylle/.test(dDom), '');
  await openNotesNav(p);
  const dRows = await menuRows(p, folderSel);
  log(label + ' 7: D er eksplisitt eier og kan dele notatboken videre',
    dRows.some((r) => /Deling/i.test(r)) && dRows.some((r) => /Forlat/i.test(r)),
    dRows.join(' | '));
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(200);

  /* ---------- 8) Invitasjon fra modalen når hele veien fram ---------- */
  await loadAs(p, db, ids.uA, 'a@x.no', viewport);
  await openNotesNav(p);
  await menuPick(p, projSel, 'Deling');
  await p.locator('#share-body .share-invite-form input.field').fill('ny@x.no');
  await p.locator('#share-body .share-invite-form button[type="submit"]').click();
  await p.waitForTimeout(700);
  const invitasjon = await p.evaluate(() => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    return db2.share_invites.map((s) => ({ e: s.invitee_email, p: s.note_project_id, r: s.role, s: s.status }));
  });
  log(label + ' 8: invitasjonen lander på BOKHYLLEN, ikke på et område',
    invitasjon.length === 1 && invitasjon[0].e === 'ny@x.no'
    && invitasjon[0].p === ids.P && invitasjon[0].s === 'pending',
    JSON.stringify(invitasjon));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  /* ---------- 9) Deling mens mottakeren står i appen ---------- */
  // C mistet notatet i steg 6. Får hen det igjen, skal koblingen virke igjen —
  // og raden komme tilbake uten at noe måtte lastes på nytt.
  await loadAs(p, db, ids.uC, 'c@x.no', viewport);
  const tilbake = await readDB(p);
  tilbake.memberships = tilbake.memberships.filter((m) => !(m.user_id === 'uC' && m.note_id === ids.N1));
  await writeDB(p, tilbake);
  await sync(p);
  const uten = await p.evaluate(() => window.__huskis.state.notes.length);
  const igjen = await readDB(p);
  igjen.memberships.push({ id: 'm-igjen', user_id: 'uC',
    universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: ids.N1,
    role: 'member', pos: 0, created_at: 1 });
  await writeDB(p, igjen);
  await sync(p);
  const med = await p.evaluate(() => ({
    notater: window.__huskis.state.notes.map((n) => n.title),
    koblinger: (window.__huskis.state.links || []).length,
  }));
  log(label + ' 9: en deling som skjer mens mottakeren står i appen kommer inn ved neste synk',
    uten === 0 && med.notater.join() === 'Utvalg', JSON.stringify({ uten: uten, med: med }));
  log(label + ' 9: … og koblingen virker igjen fordi begge objektene fortsatt finnes',
    med.koblinger === 1, String(med.koblinger));

  /* ---------- 10) Samtidige endringer: nyeste register vinner ---------- */
  // C skriver lokalt uten å synke; en annen enhet har alt skrevet NYERE.
  const samtidig = await p.evaluate(async (id) => {
    const H = window.__huskis;
    const n = H.state.notes.find((x) => x.id === id);
    n.title = 'Cs versjon';
    n.ts = 1000; n.org = 'c';
    H.save();
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    const rad = db2.notes.find((x) => x.id === id);
    rad.title = 'As nyere versjon'; rad.ts = 9000; rad.org = 'a';
    localStorage.setItem('hk-mock-db', JSON.stringify(db2));
    return true;
  }, ids.N1);
  await sync(p);
  const etterFlett = await p.evaluate((id) => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    return {
      lokal: (window.__huskis.state.notes.find((x) => x.id === id) || {}).title,
      server: (db2.notes.find((x) => x.id === id) || {}).title,
    };
  }, ids.N1);
  log(label + ' 10: den nyeste skrivingen vinner på begge sider (dokumentbasert LWW)',
    samtidig && etterFlett.lokal === 'As nyere versjon' && etterFlett.server === 'As nyere versjon',
    JSON.stringify(etterFlett));

  log(label + ': ingen JS-feil', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
