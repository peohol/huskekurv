/*
  Nettlesertest for VERSJONSSAMMENLIGNING i notathistorikken — «hva er
  annerledes nå?» (docs/notater-plan.md → «Versjonssammenligning»), mot
  mock-backend (?mock=1).

  Historikken svarte på hva notatet INNEHOLDT. Denne runden svarer på hva som
  er FORSKJELLIG fra notatet slik det er nå — det man faktisk lurer på rett før
  man gjenoppretter. Diffen er en visning: den leser to dokumenter og skriver
  ingenting.

  Dekker:
    1. Identiske dokumenter → ingen endringer
    2. Rent tillegg
    3. Ren sletting
    4. Tekstendring inne i samme blokk
    5. Tittelendring
    6. Formateringsendring — også når markeringen deler en kjøring i tre uten
       å endre ett eneste tegn — og en lenke som ble byttet. Merknaden sier
       hvilken VEI: lagt til, fjernet eller byttet
    7. Listeendringer — punktliste og nummerert
    8. Flere endringer samtidig, og en blokk som ble FLYTTET
    9. Tomt dokument på én eller begge sider
   10. En liten endring tidlig skal ikke male resten av notatet som endret
   11. Overskrifter og skillelinje, inkludert en blokk som byttet type
   12. UI-et: bryteren i den åpne raden, endringene tegnet som noder
   13. … med 44 px berøringsflate, piltaster og fokus som overlever ommalingen
   14. Diffen er SKRIVEBESKYTTET: verken CRDT, projeksjon, logg eller
       historikk rører seg av å se på den
   15. Gjenoppretting gjenoppretter fortsatt nøyaktig den valgte versjonen
   16. Lys og mørk drakt: markeringene henter fargen fra drakten
   17. Historikk åpnet fra et LUKKET notat
   18. … og «Nå» teller enhetens egne, usendte endringer
   19. Samskriving mens historikken er åpen: «Nå» leses på nytt når brukeren ber
       om sammenligningen, uten at listen hentes
   20. En REN LESER ser diffen, men får ingen skriverettigheter — og ser også
       det som kom til etter at modalen åpnet
   21. Tilbakekalt tilgang lukker historikken — også midt i en sammenligning
   22. De to endringene man ikke kan SE i teksten — en blokk som byttet type og
       en som bare byttet plass — bærer det med ord

  Kjør:
    python3 -m http.server 8000                        # fra repo-roten, i egen terminal
    NODE_PATH=$(npm root -g) node tests/notes-version-diff.test.js
*/
const { chromium } = require('playwright');
const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';

let pass = 0, fail = 0;
const check = (navn, ok, evidens) => {
  const e = evidens === undefined ? '' : '  [' + (typeof evidens === 'string' ? evidens : JSON.stringify(evidens)) + ']';
  if (ok) { pass++; console.log('PASS — ' + navn + e); }
  else { fail++; console.log('FAIL — ' + navn + e); }
};
const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
});

function buildDB() {
  const P = U(), N = U(), NR = U();
  const base = (x) => Object.assign({
    trashed: false, archived: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a',
  }, x);
  const mem = (user, on, role) => Object.assign({
    id: U(), user_id: user, universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: null,
    role, pos: 0, created_at: 1,
  }, on);
  const doc = (s) => ({ v: 1, blocks: [{ t: 'p', c: [{ s }] }] });
  return {
    ids: { P, N, NR },
    db: {
      _rolesBackfilled: true,
      profiles: [
        { id: 'uA', email: 'a@x.no', display_name: 'Alice Eier', user_metadata: {} },
        { id: 'uB', email: 'b@x.no', display_name: 'Bo Medlem', user_metadata: {} },
        { id: 'uC', email: 'c@x.no', display_name: 'Cato Leser', user_metadata: {} },
      ],
      passwords: { 'a@x.no': 'x', 'b@x.no': 'x', 'c@x.no': 'x' },
      universes: [], groups: [], cards: [], items: [], ideas: [],
      note_projects: [base({ id: P, owner_id: 'uA', name: 'Felles bokhylle' })],
      note_folders: [],
      notes: [
        base({ id: N, owner_id: 'uA', project_id: P, folder_id: null,
          title: 'Felles notat', body: doc('OPPRINNELIG') }),
        base({ id: NR, owner_id: 'uA', project_id: P, folder_id: null, locked: true,
          title: 'Kun lesing', body: doc('Leses'), pos: 1 }),
      ],
      object_links: [],
      memberships: [
        mem('uA', { note_project_id: P }, 'owner'),
        mem('uB', { note_project_id: P }, 'member'),
        mem('uC', { note_id: NR }, 'member'),
      ],
      share_invites: [], tombstones: [],
      note_updates: [], note_mark: 1, note_versions: [],
      auth_sessions: [], device_sessions: [],
      notifications: [], notification_prefs: [],
      push_subscriptions: [], push_deliveries: [], native_notif_devices: [],
    },
  };
}

async function loadAs(page, db, uid, email, seed) {
  await page.goto(BASE + '/?mock=1');
  await page.evaluate(({ db, uid, email, seed }) => {
    sessionStorage.clear();
    if (seed) { localStorage.clear(); localStorage.setItem('hk-mock-db', JSON.stringify(db)); }
    sessionStorage.setItem('hk-mock-session', JSON.stringify({ id: uid, email,
      user_metadata: { onboarding: { v: 3, status: 'done' },
        tips: { drag: true, trash: true, moveList: true, dragTrash: true } } }));
  }, { db, uid, email, seed });
  await page.goto(BASE + '/?mock=1');
  await page.waitForFunction(() => {
    const H = window.__huskis;
    return !!(H && H.authUser && H.lastMy);
  }, null, { timeout: 15000, polling: 200 });
  await page.evaluate(() => window.__huskis.setMainTab('notes'));
  await page.waitForTimeout(150);
}

const åpneEditor = async (p, id) => {
  await p.evaluate((x) => window.__huskis.openNoteEditor(x), id);
  await p.waitForFunction(() => !document.getElementById('note-editor').hidden,
    null, { timeout: 5000, polling: 50 });
  await p.waitForFunction(() => !window.__huskis.noteLiveInfo.seedPending,
    null, { timeout: 5000, polling: 50 });
  await p.waitForTimeout(80);
};
const lukkEditor = async (p) => {
  await p.evaluate(() => window.__huskis.closeNoteEditor());
  await p.waitForTimeout(200);
};
async function skrivSlutt(p, tekst) {
  await p.evaluate(() => {
    const d = document.getElementById('note-doc');
    d.focus();
    const r = document.createRange();
    r.selectNodeContents(d); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await p.keyboard.type(tekst, { delay: 8 });
  await p.waitForTimeout(200);
}
async function åpneHistorikk(p, id) {
  await p.evaluate((x) => window.__huskis.openNoteHistory(x), id);
  await p.waitForFunction(() => {
    const i = window.__huskis.noteHistoryInfo;
    return i.open && i.status !== 'loading';
  }, null, { timeout: 8000, polling: 100 });
}
async function åpneRad(p, i) {
  await p.evaluate((n) => {
    const rows = [...document.querySelectorAll('.note-history-row')];
    rows[n].querySelector('.note-history-head').click();
  }, i);
  await p.waitForFunction(() => {
    const info = window.__huskis.noteHistoryInfo;
    if (!info.openId) return false;
    const el = document.querySelector('.note-history-doc');
    return !!el && el.textContent !== '' && !el.textContent.startsWith('Henter');
  }, null, { timeout: 8000, polling: 100 });
}
// Bytt visning ved å KLIKKE segmentet, ikke ved å kalle funksjonen: bryteren er
// det som testes.
async function velgVisning(p, view) {
  await p.evaluate((v) => {
    const b = document.querySelector('.note-history-views .seg-btn[data-view="' + v + '"]');
    if (b) b.click();
  }, view);
  await p.waitForFunction((v) => window.__huskis.noteHistoryInfo.view === v,
    view, { timeout: 8000, polling: 60 });
  await p.waitForTimeout(120);
}
// Diffen slik den faktisk står i DOM-et: én rad per linje, med merkingen.
const diffLinjer = (p) => p.evaluate(() => [...document.querySelectorAll('.note-diff-doc .note-diff-line')]
  .map((el) => ({
    kind: el.dataset.diff,
    tag: el.tagName.toLowerCase(),
    ins: [...el.querySelectorAll('ins')].map((x) => x.textContent).join('|'),
    del: [...el.querySelectorAll('del')].map((x) => x.textContent).join('|'),
    fmt: [...el.querySelectorAll('.note-diff-fmt')].map((x) => x.textContent).join('|'),
    tag2: (el.querySelector('.note-diff-kind') || {}).textContent || '',
    // Merkelappen skjermleseren leser først i linjen.
    merke: (el.querySelector('.note-diff-tag') || {}).textContent || '',
    tekst: el.textContent,
  })));
const oppsummering = (p) => p.evaluate(() => {
  const el = document.querySelector('.note-diff-summary');
  return el ? el.textContent : null;
});
const versjoner = (p, id) => p.evaluate((x) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db'));
  return (db.note_versions || []).filter((v) => v.note_id === x)
    .sort((a, b) => a.created_at - b.created_at)
    .map((v) => ({ chars: v.chars, excerpt: v.excerpt, pinned: !!v.pinned, title: v.title }));
}, id);
const loggRader = (p, id) => p.evaluate((x) => {
  const db = JSON.parse(localStorage.getItem('hk-mock-db'));
  return (db.note_updates || []).filter((u) => u.note_id === x).length;
}, id);
const crdtTekst = (p) => p.evaluate(() => window.__huskis.noteLiveInfo.text);
async function sync(p) {
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => window.__huskis.cloudCycle());
    await p.waitForTimeout(200);
  }
}

/* Dokumentene randtilfellene stilles med. De sendes inn i siden og
   sammenlignes med den RENE funksjonen — én diff er en funksjon av to
   dokumenter, og hvert tilfelle skal kunne felles for seg. */
const FIKSTUR = (() => {
  const p = (s) => ({ t: 'p', c: [{ s }] });
  const doc = (...b) => ({ v: 1, blocks: b });
  const tom = { v: 1, blocks: [] };
  const grunn = doc(p('Første avsnitt'), p('Andre avsnitt'), p('Tredje avsnitt'));
  return {
    tom,
    grunn,
    likt: doc(p('Første avsnitt'), p('Andre avsnitt'), p('Tredje avsnitt')),
    tillegg: doc(p('Første avsnitt'), p('Andre avsnitt'), p('Helt nytt'), p('Tredje avsnitt')),
    sletting: doc(p('Første avsnitt'), p('Tredje avsnitt')),
    iBlokken: doc(p('Første avsnitt'), p('Andre avsnitt er skrevet om'), p('Tredje avsnitt')),
    flyttet: doc(p('Tredje avsnitt'), p('Første avsnitt'), p('Andre avsnitt')),
    mangeEndringer: doc(p('Første avsnitt'), p('Helt nytt'), p('Andre avsnitt er skrevet om')),
    // To TOMME avsnitt er like uten å ha noe med hverandre å gjøre.
    medTom1: doc(p('Alfa'), p(''), p('Beta'), p('Gamma')),
    medTom2: doc(p('Alfa'), p('Beta'), p('Gamma'), p('')),
    klar: doc({ t: 'p', c: [{ s: 'et helt vanlig avsnitt' }] }),
    fet: doc({ t: 'p', c: [{ s: 'et helt ' }, { s: 'vanlig', b: 1 }, { s: ' avsnitt' }] }),
    /* Å gjøre ETT ord fett deler én kjøring i tre uten å endre ett eneste
       tegn. Leses markeringen som en egenskap ved kjøringen, blir «nøkkelen.»
       og «nøkkelen» + «.» to ulike ord — og en ren formateringsendring ville
       stått som slettet og lagt til igjen. */
    slutt1: doc({ t: 'p', c: [{ s: 'Husk å ta med nøkkelen.' }] }),
    slutt2: doc({ t: 'p', c: [{ s: 'Husk å ta med ' }, { s: 'nøkkelen', b: 1 }, { s: '.' }] }),
    lenke1: doc({ t: 'p', c: [{ s: 'gå til ' }, { s: 'stedet', url: 'https://en.no/' }] }),
    lenke2: doc({ t: 'p', c: [{ s: 'gå til ' }, { s: 'stedet', url: 'https://to.no/' }] }),
    /* To korte blokker uten noe med hverandre å gjøre. De deler nok BOKSTAVER
       til at en ren tegnlikhet ville lest dem som den samme blokken (MÅLT:
       0,42) — og da ville en sletting og et tillegg blitt til «skrevet om». */
    ulike1: doc(p('Denne skal flyttes.')),
    ulike2: doc(p('Melkesjokolade')),
    kort1: doc(p('OPPRINNELIG')),
    kort2: doc(p('OPPRINNELIG MED MER')),
    punkt1: doc({ t: 'ul', items: [[{ s: 'Melk' }], [{ s: 'Brød' }]] }),
    punkt2: doc({ t: 'ul', items: [[{ s: 'Melkesjokolade' }], [{ s: 'Brød' }], [{ s: 'Smør' }]] }),
    nummer1: doc({ t: 'ol', items: [[{ s: 'Ett' }], [{ s: 'To' }]] }),
    nummer2: doc({ t: 'ol', items: [[{ s: 'Ett' }], [{ s: 'Halvannet' }], [{ s: 'To' }]] }),
    strek: doc(p('Over'), { t: 'hr' }, p('Under')),
    utenStrek: doc(p('Over'), p('Under')),
    somAvsnitt: doc(p('En tittel her'), p('Brødtekst')),
    somOverskrift: doc({ t: 'h2', c: [{ s: 'En tittel her' }] }, p('Brødtekst')),
    lang: doc(...Array.from({ length: 40 }, (_, i) => p('Linje nummer ' + i))),
    langPluss: doc(p('En setning aller først'),
      ...Array.from({ length: 40 }, (_, i) => p('Linje nummer ' + i))),
  };
})();

// Diffen som en KORT form, så en feilende linje er lesbar uten å kjøre om.
const kortDiff = (p, a, b) => p.evaluate(({ x, y }) => {
  const r = window.__huskis.noteDocDiff(x, y);
  return {
    counts: r.counts,
    lines: r.lines.map((l) => l.kind + ':' + l.t + ':'
      + l.parts.map((q) => q.k + '[' + q.s + ']').join('')),
  };
}, { x: a, y: b });

/* ============================================================
   Løp 1 — algoritmen, UI-et, tastaturet og draktene
   ============================================================ */
async function run(navn, viewport, mobil) {
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport, isMobile: mobil, hasTouch: mobil });
  const feil = [];
  const p = await ctx.newPage();
  p.on('pageerror', (e) => feil.push(e.message));
  await loadAs(p, db, 'uA', 'a@x.no', true);

  /* ---- 1–11. Algoritmen, tilfelle for tilfelle ---- */
  const F = FIKSTUR;

  const identisk = await kortDiff(p, F.grunn, F.likt);
  check(navn + ' 1: identiske dokumenter gir ingen endringer',
    identisk.counts.add + identisk.counts.del + identisk.counts.chg
    + identisk.counts.fmt + identisk.counts.move === 0
    && identisk.lines.every((l) => l.indexOf('same:') === 0), identisk);

  const tillegg = await kortDiff(p, F.grunn, F.tillegg);
  check(navn + ' 2: rent tillegg — én linje lagt til, resten står stille',
    tillegg.counts.add === 1 && tillegg.counts.del === 0 && tillegg.counts.chg === 0
    && tillegg.lines.filter((l) => l.indexOf('same:') === 0).length === 3, tillegg);

  const sletting = await kortDiff(p, F.grunn, F.sletting);
  check(navn + ' 3: ren sletting — én linje fjernet, resten står stille',
    sletting.counts.del === 1 && sletting.counts.add === 0 && sletting.counts.chg === 0
    && sletting.lines.some((l) => l === 'del:p:-[Andre avsnitt]'), sletting);

  const iBlokken = await kortDiff(p, F.grunn, F.iBlokken);
  check(navn + ' 4: en endring INNE i et avsnitt er én endret linje, ikke en sletting og et tillegg',
    iBlokken.counts.chg === 1 && iBlokken.counts.add === 0 && iBlokken.counts.del === 0,
    iBlokken);
  check(navn + ' 4b: … og bare ordene som faktisk er nye er merket',
    iBlokken.lines.some((l) => l === 'chg:p:=[Andre avsnitt]+[ er skrevet om]'),
    iBlokken.lines);

  const tittel = await p.evaluate(() => {
    const d = window.__huskis.noteTitleDiff('Gammel tittel', 'Gammel og bedre tittel');
    return {
      lik: window.__huskis.noteTitleDiff('Samme', 'Samme'),
      deler: d ? d.map((q) => q.k + '[' + q.s + ']').join('') : null,
    };
  });
  check(navn + ' 5: en uendret tittel gir ingen tittel-diff', tittel.lik === null, tittel.lik);
  check(navn + ' 5b: … og en endret tittel merker bare det nye',
    tittel.deler === '=[Gammel ]+[og bedre ]=[tittel]', tittel.deler);

  const fmt = await kortDiff(p, F.klar, F.fet);
  check(navn + ' 6: bare formatering endret — ingen tekst lagt til eller fjernet',
    fmt.counts.fmt === 1 && fmt.counts.add === 0 && fmt.counts.del === 0
    && fmt.counts.chg === 0 && fmt.lines.some((l) => /~\[vanlig\]/.test(l)), fmt);
  const lenke = await kortDiff(p, F.lenke1, F.lenke2);
  check(navn + ' 6b: en lenke som peker et nytt sted er også en formateringsendring',
    lenke.counts.fmt === 1 && lenke.lines.some((l) => /~\[stedet\]/.test(l)), lenke);

  /* REGRESJON: markeringen er en egenskap ved TEGNENE. Uten det ville det å
     gjøre siste ord i en setning fett stått som «nøkkelen. fjernet, nøkkelen
     lagt til» — kjøringen ble delt, teksten ble det ikke. */
  const slutt = await kortDiff(p, F.slutt1, F.slutt2);
  check(navn + ' 6c: et ord som ble fett midt i en kjøring er BARE en formateringsendring',
    slutt.counts.fmt === 1 && slutt.counts.chg === 0 && slutt.counts.add === 0
    && slutt.counts.del === 0
    && slutt.lines.some((l) => l === 'fmt:p:=[Husk å ta med ]~[nøkkelen]=[.]'), slutt);

  const punkt = await kortDiff(p, F.punkt1, F.punkt2);
  check(navn + ' 7: i en punktliste er ETT punkt endringen — ikke hele lista',
    punkt.counts.chg === 1 && punkt.counts.add === 1 && punkt.counts.del === 0
    && punkt.lines.some((l) => /^same:ul:=\[Brød\]$/.test(l)), punkt);
  const kortere = await kortDiff(p, F.kort1, F.kort2);
  check(navn + ' 7c: ett ord som ble til en setning er den SAMME blokken, skrevet om',
    kortere.counts.chg === 1 && kortere.counts.add === 0 && kortere.counts.del === 0, kortere);
  const ulike = await kortDiff(p, F.ulike1, F.ulike2);
  check(navn + ' 7d: … men to korte blokker som bare deler bokstaver pares ikke',
    ulike.counts.chg === 0 && ulike.counts.add === 1 && ulike.counts.del === 1, ulike);

  const nummer = await kortDiff(p, F.nummer1, F.nummer2);
  check(navn + ' 7b: … og et nytt punkt i en nummerert liste er ett tillegg',
    nummer.counts.add === 1 && nummer.counts.del === 0 && nummer.counts.chg === 0
    && nummer.lines.filter((l) => l.indexOf('same:ol:') === 0).length === 2, nummer);

  const mange = await kortDiff(p, F.grunn, F.mangeEndringer);
  check(navn + ' 8: flere endringer samtidig telles hver for seg',
    mange.counts.add === 1 && mange.counts.del === 1 && mange.counts.chg === 1, mange);
  const flyttet = await kortDiff(p, F.grunn, F.flyttet);
  check(navn + ' 8b: en blokk som bare BYTTET PLASS er flyttet — ikke slettet og lagt til',
    flyttet.counts.move === 1 && flyttet.counts.add === 0 && flyttet.counts.del === 0
    && flyttet.lines.filter((l) => l.indexOf('move:') === 0).length === 2, flyttet);

  const tommeLike = await kortDiff(p, F.medTom1, F.medTom2);
  check(navn + ' 8c: … men et TOMT avsnitt påstås aldri å ha blitt flyttet',
    tommeLike.counts.move === 0, tommeLike);

  const tomBegge = await kortDiff(p, F.tom, F.tom);
  const tomFør = await kortDiff(p, F.tom, F.grunn);
  const tomNå = await kortDiff(p, F.grunn, F.tom);
  check(navn + ' 9: to tomme dokumenter er ingen endring',
    tomBegge.lines.length === 0 && tomBegge.counts.add === 0, tomBegge);
  check(navn + ' 9b: fra tomt til fullt er bare tillegg',
    tomFør.counts.add === 3 && tomFør.counts.del === 0, tomFør.counts);
  check(navn + ' 9c: fra fullt til tomt er bare sletting',
    tomNå.counts.del === 3 && tomNå.counts.add === 0, tomNå.counts);

  const tidlig = await kortDiff(p, F.lang, F.langPluss);
  check(navn + ' 10: en setning lagt til ØVERST maler ikke resten av notatet som endret',
    tidlig.counts.add === 1 && tidlig.counts.chg === 0 && tidlig.counts.del === 0
    && tidlig.lines.filter((l) => l.indexOf('same:') === 0).length === 40, tidlig.counts);

  const strek = await kortDiff(p, F.utenStrek, F.strek);
  check(navn + ' 11: en skillelinje som kom til er ett tillegg',
    strek.counts.add === 1 && strek.lines.some((l) => l.indexOf('add:hr:') === 0), strek);
  const type = await kortDiff(p, F.somAvsnitt, F.somOverskrift);
  check(navn + ' 11b: et avsnitt som ble en OVERSKRIFT er én endret linje, med den nye typen',
    type.counts.chg === 1 && type.lines.some((l) => l.indexOf('chg:h2:') === 0), type);

  /* ---- 12. UI-et: bryteren og endringene tegnet som noder ----
     Notatet får en historikk, og så endres det: da har «Nå» noe å skille seg
     fra. */
  await åpneEditor(p, ids.N);
  await p.waitForTimeout(250);
  await skrivSlutt(p, ' MED MER');
  await lukkEditor(p);
  await p.waitForTimeout(300);

  await åpneHistorikk(p, ids.N);
  await åpneRad(p, 1);                      // den eldste raden: «OPPRINNELIG»
  const førBytte = await p.evaluate(() => ({
    view: window.__huskis.noteHistoryInfo.view,
    segmenter: [...document.querySelectorAll('.note-history-views .seg-btn')]
      .map((b) => b.textContent),
    valgt: (document.querySelector('.note-history-views .seg-btn.is-active') || {}).dataset,
    harDiff: !!document.querySelector('.note-diff-doc'),
  }));
  check(navn + ' 12: den åpne raden har en bryter med to visninger, og starter på hele versjonen',
    førBytte.view === 'full' && førBytte.segmenter.length === 2
    && førBytte.valgt.view === 'full' && førBytte.harDiff === false, førBytte);

  await velgVisning(p, 'diff');
  const linjer = await diffLinjer(p);
  const sum = await oppsummering(p);
  check(navn + ' 12b: «Endringer» viser hva som kom til siden versjonen',
    linjer.length === 1 && linjer[0].kind === 'chg' && linjer[0].ins === ' MED MER',
    linjer);
  check(navn + ' 12c: … og oppsummeringen sier hvor mye som er endret',
    /1/.test(sum || '') && /om/.test(sum || ''), sum);
  check(navn + ' 12d: … med en merkelapp skjermleseren leser før innholdet',
    linjer[0].merke.indexOf('Endret') === 0, linjer[0].merke);
  const somNoder = await p.evaluate(() => {
    const el = document.querySelector('.note-diff-doc');
    return { barn: el.children.length, harInnhold: el.innerHTML.indexOf('&lt;') === -1 };
  });
  check(navn + ' 12e: … rendret NODE FOR NODE, aldri som markup',
    somNoder.barn > 0 && somNoder.harInnhold, somNoder);

  // Den NYESTE raden ER «Nå» — da skal sammenligningen si nettopp det.
  await p.evaluate(() => {
    const åpen = document.querySelector('.note-history-row.is-open');
    if (åpen) åpen.querySelector('.note-history-head').click();
  });
  await p.waitForTimeout(120);
  await åpneRad(p, 0);
  const ingen = await oppsummering(p);
  check(navn + ' 12f: den ferskeste versjonen har ingen forskjeller fra «Nå»',
    /Ingen forskjeller/.test(ingen || ''), ingen);
  check(navn + ' 12g: … og visningsvalget følger med til neste rad',
    (await p.evaluate(() => window.__huskis.noteHistoryInfo.view)) === 'diff');

  /* ---- 12h. RETNINGEN på en formateringsendring ----
     Den stiplede streken sier AT noe ble annerledes, ikke HVA eller hvilken
     vei. Den som ikke ser skjermen har bare merknaden — og «fet» under en
     overskrift som sier «ny formatering» ville sagt det motsatte når
     uthevingen faktisk ble FJERNET. */
  const fmtRetning = await p.evaluate(() => {
    const H = window.__huskis;
    const p2 = (c) => ({ v: 1, blocks: [{ t: 'p', c }] });
    const ren = p2([{ s: 'et ord her' }]);
    const fet = p2([{ s: 'et ' }, { s: 'ord', b: 1 }, { s: ' her' }]);
    const lenke = p2([{ s: 'et ' }, { s: 'ord', url: 'https://en.no/' }, { s: ' her' }]);
    const lenke2 = p2([{ s: 'et ' }, { s: 'ord', url: 'https://to.no/' }, { s: ' her' }]);
    const les = (a, b) => {
      // Rendret gjennom den EKTE funksjonen modalen bruker, ikke en gjenskrivning.
      const el = document.createElement('div');
      H.noteDiffIntoEl(el, H.noteDocDiff(a, b));
      const merke = el.querySelector('.note-diff-note');
      return {
        merke: merke ? merke.textContent : null,
        title: (el.querySelector('.note-diff-fmt') || {}).title || null,
      };
    };
    return { lagtTil: les(ren, fet), fjernet: les(fet, ren), byttet: les(lenke, lenke2) };
  });
  check(navn + ' 12h: en markering som ble LAGT TIL sier det',
    /lagt til/.test(fmtRetning.lagtTil.merke || '') && /fet/.test(fmtRetning.lagtTil.merke || ''),
    fmtRetning.lagtTil);
  check(navn + ' 12i: … og en som ble FJERNET sier det motsatte, ikke det samme',
    /fjernet/.test(fmtRetning.fjernet.merke || '') && /fet/.test(fmtRetning.fjernet.merke || '')
    && !/lagt til/.test(fmtRetning.fjernet.merke || ''), fmtRetning.fjernet);
  check(navn + ' 12j: … og en lenke som peker et nytt sted er byttet, ikke lagt til eller fjernet',
    /endret/.test(fmtRetning.byttet.merke || '') && /lenke/.test(fmtRetning.byttet.merke || '')
    && !/lagt til/.test(fmtRetning.byttet.merke || '')
    && !/fjernet/.test(fmtRetning.byttet.merke || ''), fmtRetning.byttet);
  check(navn + ' 12k: … og den samme teksten står i hjelpeteksten for den som peker',
    (fmtRetning.fjernet.title || '').indexOf('fjernet') > -1, fmtRetning.fjernet.title);

  /* ---- 13. Berøringsflate, piltaster og fokus ---- */
  const flater = await p.evaluate(() => [...document.querySelectorAll('.note-history-views .seg-btn')]
    .map((e) => ({
      h: Math.round(e.getBoundingClientRect().height),
      klippet: e.scrollWidth > e.clientWidth + 1,
      brytes: getComputedStyle(e).whiteSpace !== 'nowrap',
    })));
  check(navn + ' 13: hvert segment i bryteren har minst 44 px berøringsflate',
    flater.length === 2 && flater.every((f) => f.h >= 44), flater);
  /* ETIKETTEN SKAL IKKE KLIPPES. Ordene er lengre her enn i appens andre
     segmenterte brytere, og de er ULIKE på hvert språk — på telefon brytes de
     derfor over to linjer i stedet for å bli kappet på midten. */
  check(navn + ' 13f: … og etiketten står helt, ikke kappet',
    flater.every((f) => !f.klippet), flater);
  if (mobil) {
    check(navn + ' 13g: … og en lengre oversettelse brytes i stedet for å klippes',
      flater.every((f) => f.brytes), flater);
  }

  const fokus = await p.evaluate(() => {
    const b = document.querySelector('.note-history-views .seg-btn[data-view="full"]');
    b.focus();
    b.click();                                 // bytter visning og maler listen om
    const nå = document.activeElement;
    return {
      view: window.__huskis.noteHistoryInfo.view,
      erSegment: !!(nå && nå.dataset && nå.dataset.fkey === 'view-full'),
      tab: nå ? nå.tabIndex : null,
    };
  });
  check(navn + ' 13b: fokus blir stående på segmentet man trykket, ikke på radhodet',
    fokus.view === 'full' && fokus.erSegment && fokus.tab === 0, fokus);

  const piltast = await p.evaluate(() => {
    const b = document.querySelector('.note-history-views .seg-btn[data-view="full"]');
    b.focus();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const nå = document.activeElement;
    return {
      view: window.__huskis.noteHistoryInfo.view,
      fkey: nå && nå.dataset ? nå.dataset.fkey : null,
      tab: nå ? nå.tabIndex : null,
    };
  });
  check(navn + ' 13c: piltast høyre bytter visning, som i de andre segmenterte bryterne',
    piltast.view === 'diff', piltast);
  check(navn + ' 13e: … og fokus følger VALGET, ikke segmentet man kom fra',
    piltast.fkey === 'view-diff' && piltast.tab === 0, piltast);
  const semantikk = await p.evaluate(() => {
    const seg = document.querySelector('.note-history-views');
    const btns = [...seg.querySelectorAll('.seg-btn')];
    return {
      rolle: seg.getAttribute('role'),
      navn: !!seg.getAttribute('aria-label'),
      valgt: btns.map((b) => b.getAttribute('aria-selected')).join(','),
      tabs: btns.map((b) => b.tabIndex).join(','),
    };
  });
  check(navn + ' 13d: bryteren er en tablist med ett valgt segment og rullende tabIndex',
    semantikk.rolle === 'tablist' && semantikk.navn
    && semantikk.valgt === 'false,true' && semantikk.tabs === '-1,0', semantikk);

  /* ---- 14. Å SE på en diff endrer ingenting ---- */
  await p.evaluate(() => {
    const åpen = document.querySelector('.note-history-row.is-open');
    if (åpen) åpen.querySelector('.note-history-head').click();
  });
  await p.waitForTimeout(120);
  const før14 = {
    logg: await loggRader(p, ids.N),
    versjoner: (await versjoner(p, ids.N)).length,
    doc: await p.evaluate((x) => JSON.stringify(
      (window.__huskis.state.notes.find((m) => m.id === x) || {}).doc), ids.N),
  };
  await åpneRad(p, 1);
  await velgVisning(p, 'full');
  await velgVisning(p, 'diff');
  await p.waitForTimeout(400);
  const etter14 = {
    logg: await loggRader(p, ids.N),
    versjoner: (await versjoner(p, ids.N)).length,
    doc: await p.evaluate((x) => JSON.stringify(
      (window.__huskis.state.notes.find((m) => m.id === x) || {}).doc), ids.N),
  };
  check(navn + ' 14: å bla og sammenligne skriver verken i loggen, i historikken eller i notatet',
    etter14.logg === før14.logg && etter14.versjoner === før14.versjoner
    && etter14.doc === før14.doc, { før: før14, etter: etter14 });

  /* ---- 15. Gjenoppretting gjenoppretter fortsatt den VALGTE versjonen ----
     Diffen er en visning; den skal ikke ha noe med hva som skrives tilbake. */
  const raderFør = await loggRader(p, ids.N);
  await p.evaluate(() => document.querySelector('.note-history-restore').click());
  await p.waitForFunction(() => {
    const H = window.__huskis;
    const n = H.state.notes.find((m) => m.id === H.noteHistoryInfo.id);
    return n && JSON.stringify(n.doc).indexOf('MED MER') === -1;
  }, null, { timeout: 8000, polling: 100 });
  await p.waitForTimeout(300);
  const etterGjen = { crdt: await crdtTekst(p), rader: await loggRader(p, ids.N) };
  check(navn + ' 15: gjenoppretting gir nøyaktig den valgte versjonen, gjennom CRDT-en',
    etterGjen.crdt === 'OPPRINNELIG' && etterGjen.rader > raderFør, etterGjen);
  await p.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(p);

  /* ---- 16. Lys og mørk drakt ----
     Et nytt ord etter gjenopprettingen, så den samme linjen bærer BÅDE noe
     lagt til og noe fjernet: begge markeringene skal måles. */
  await åpneEditor(p, ids.N);
  await skrivSlutt(p, ' NYTT ORD');
  await lukkEditor(p);
  await p.waitForTimeout(300);
  await åpneHistorikk(p, ids.N);
  const medBegge = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.note-history-row')];
    const i = rows.findIndex((r) => /MED MER/.test(r.textContent));
    return i;
  });
  check(navn + ' 16a: det finnes en versjon som skiller seg på begge måter (forutsetningen)',
    medBegge > -1, { rad: medBegge });
  await åpneRad(p, medBegge);
  await velgVisning(p, 'diff');
  const begge = await diffLinjer(p);
  check(navn + ' 16b: … og linjen bærer både det som kom til og det som falt bort',
    begge.some((l) => /NYTT/.test(l.ins) && /ORD/.test(l.ins)
      && /MED/.test(l.del) && /MER/.test(l.del)),
    begge.map((l) => l.kind + ' +' + l.ins + ' -' + l.del));
  const farger = async () => p.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).color : null;
    };
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      ins: g('.note-diff-ins'),
      del: g('.note-diff-del'),
    };
  });
  const lys = await farger();
  await p.evaluate(() => window.HUSKIS_THEME.setMode('dark'));
  await p.waitForTimeout(300);
  const mørk = await farger();
  check(navn + ' 16c: markeringene har farge i begge draktene …',
    !!lys.ins && !!lys.del && !!mørk.ins && !!mørk.del, { lys, mørk });
  check(navn + ' 16d: … og fargen er draktens egen, ikke en fast verdi',
    lys.ins !== mørk.ins && lys.del !== mørk.del, { lys, mørk });
  await p.evaluate(() => window.HUSKIS_THEME.setMode('light'));
  await p.waitForTimeout(200);
  await p.evaluate(() => window.__huskis.closeNoteHistory());

  /* ---- 22. De to endringene man ikke kan SE i teksten ----
     En blokk som byttet type og en blokk som bare byttet plass står ordrett i
     diffen. Uten en etikett ville den eneste ledetråden vært en kantstripe. */
  const DOC_A = { v: 1, blocks: [
    { t: 'h1', c: [{ s: 'Tittelen' }] },
    { t: 'p', c: [{ s: 'Alfa' }] },
    { t: 'p', c: [{ s: 'Beta beta beta' }] },
    { t: 'p', c: [{ s: 'Gamma gamma gamma' }] },
  ] };
  const DOC_B = { v: 1, blocks: [
    { t: 'h1', c: [{ s: 'Tittelen' }] },
    { t: 'h2', c: [{ s: 'Alfa' }] },
    { t: 'p', c: [{ s: 'Gamma gamma gamma' }] },
    { t: 'p', c: [{ s: 'Beta beta beta' }] },
  ] };
  await åpneEditor(p, ids.N);
  await p.evaluate(({ id, d }) => window.__huskis.setNoteDoc(id, d), { id: ids.N, d: DOC_A });
  await p.waitForTimeout(200);
  await lukkEditor(p);
  await p.waitForTimeout(300);
  await åpneEditor(p, ids.N);
  await p.evaluate(({ id, d }) => window.__huskis.setNoteDoc(id, d), { id: ids.N, d: DOC_B });
  await p.waitForTimeout(200);
  await lukkEditor(p);
  await p.waitForTimeout(300);

  await åpneHistorikk(p, ids.N);
  const radA = await p.evaluate(() => [...document.querySelectorAll('.note-history-row')]
    .findIndex((r) => /Alfa/.test(r.textContent) && !/Gamma gamma gamma Beta/.test(r.textContent)));
  check(navn + ' 22a: versjonen fra før omrokeringen finnes (forutsetningen)', radA > -1, { rad: radA });
  await åpneRad(p, radA);
  await velgVisning(p, 'diff');
  const etiketter = await diffLinjer(p);
  check(navn + ' 22: en blokk som byttet TYPE bærer det med ord',
    etiketter.some((l) => /avsnitt/.test(l.tag2) && /overskrift 2/.test(l.tag2)),
    etiketter.map((l) => l.kind + ':' + l.tag2));
  check(navn + ' 22b: … og en blokk som bare byttet PLASS står som flyttet, ikke som borte',
    etiketter.filter((l) => l.kind === 'move').length === 2
    && etiketter.every((l) => l.kind !== 'del'),
    etiketter.map((l) => l.kind + ':' + l.tag2));
  await p.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(p);

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 2 — historikk fra et LUKKET notat, og enhetens egen kø

   «Nå»-siden skal være den samme autoritative tilstanden resten av
   historikksystemet bygger på: loggens rader PLUSS enhetens lokale kopi og det
   som ennå ligger i køen — aldri projeksjonen alene.
   ============================================================ */
async function runLukket() {
  const navn = 'lukket';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);

  // En historikk å sammenligne mot, og et notat som er ENDRET etterpå.
  await åpneEditor(a, ids.N);
  await a.waitForTimeout(250);
  await skrivSlutt(a, ' SKREVET FØRST');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(300);

  // ---- 17. Historikken åpnes rett fra kortet, uten at editoren åpnes ----
  await åpneHistorikk(a, ids.N);
  const editorLukket = await a.evaluate(() => document.getElementById('note-editor').hidden);
  await åpneRad(a, 1);
  await velgVisning(a, 'diff');
  const lukketDiff = await diffLinjer(a);
  check(navn + ' 17: historikken kan sammenligne uten at editoren åpnes',
    editorLukket === true
    && (await a.evaluate(() => document.getElementById('note-editor').hidden)) === true,
    { editorLukket });
  check(navn + ' 17b: … og diffen viser det som kom til siden versjonen',
    lukketDiff.length === 1 && /SKREVET FØRST/.test(lukketDiff[0].ins), lukketDiff);
  await a.evaluate(() => window.__huskis.closeNoteHistory());

  /* ---- 18. «Nå» teller enhetens egne, USENDTE endringer ----
     Nettet er tilbake, men leveringen av rader nektes: køen blir stående mens
     historikken kan hentes. Uten enhetens egen kø ville «Nå» vært serverens
     eldre dokument, og diffen ville vist en endring som ikke finnes. */
  await a.evaluate(() => window.HK_MOCK.setOffline(true));
  await åpneEditor(a, ids.N);
  await skrivSlutt(a, ' BARE PÅ ENHETEN');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await lukkEditor(a);
  await a.waitForTimeout(250);
  await a.evaluate(() => {
    window.HK_MOCK.setOffline(false);
    const c = window.__huskis.client;
    const ekte = c.rpc.bind(c);
    c.rpc = function (n2, params) {
      if (n2 === 'note_crdt_push') {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      return ekte(n2, params);
    };
  });
  const iKøen = await a.evaluate((x) => {
    const k = Object.keys(localStorage).find((n2) => n2.indexOf('hk-note-ops:') === 0);
    return JSON.parse(localStorage.getItem(k) || '[]').filter((o) => o.note === x).length;
  }, ids.N);
  check(navn + ' 18a: raden ligger fortsatt i køen (forutsetningen)', iKøen > 0, { rader: iKøen });

  await åpneHistorikk(a, ids.N);
  const nåTekst = await a.evaluate(() => window.__huskis.noteHistoryInfo.nowText);
  check(navn + ' 18: «Nå»-siden av sammenligningen er enhetens egen tilstand, ikke serverens eldre',
    /BARE PÅ ENHETEN/.test(nåTekst || ''), nåTekst);
  await åpneRad(a, 1);
  await velgVisning(a, 'diff');
  const køDiff = await diffLinjer(a);
  check(navn + ' 18b: … så diffen mot en eldre versjon tar med det som ennå ikke er levert',
    køDiff.some((l) => /BARE PÅ ENHETEN/.test(l.ins)), køDiff.map((l) => l.kind + ':' + l.ins));

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

/* ============================================================
   Løp 3 — flere brukere: samskriving, ren leser og tilbakekalling
   ============================================================ */
async function runFlere() {
  const navn = 'flerbruker';
  const { ids, db } = buildDB();
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  const feil = [];
  const a = await ctx.newPage();
  a.on('pageerror', (e) => feil.push('A: ' + e.message));
  await loadAs(a, db, 'uA', 'a@x.no', true);
  const b = await ctx.newPage();
  b.on('pageerror', (e) => feil.push('B: ' + e.message));
  await loadAs(b, db, 'uB', 'b@x.no', false);

  await åpneEditor(a, ids.N);
  await åpneEditor(b, ids.N);
  await a.waitForTimeout(150);

  // A skriver noe begge ser, og B tar et bilde av DEN tilstanden.
  await skrivSlutt(a, ' FELLES GRUNN');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await b.evaluate(async () => { await window.__huskis.noteLivePull(); });
  await b.waitForTimeout(200);
  check(navn + ' 19a: B ser det A skrev (forutsetningen)',
    (await crdtTekst(b)) === 'OPPRINNELIG FELLES GRUNN', await crdtTekst(b));
  await b.evaluate((x) => window.__huskis.captureNoteVersion(x, {}), ids.N);
  await b.waitForTimeout(200);

  /* ---- 19. A skriver videre MENS B står i sammenligningen ----
     REGRESJON: listen hentes bare på nytt av en SKRIVING (gjenoppretting,
     merking), og en ren leser har ingen av delene. Uten at «Nå» leses på nytt
     når brukeren ber om sammenligningen, ville B fortsatt målt mot bildet fra
     da modalen åpnet — og aldri sett det A nettopp skrev.

     Testen rører derfor ALDRI `loadNoteHistory`: den bytter visning, som en
     bruker gjør. */
  await åpneHistorikk(b, ids.N);
  const radB = await b.evaluate(() => document.querySelectorAll('.note-history-row').length);
  await åpneRad(b, radB - 1);          // den eldste raden, fra før A skrev noe
  await velgVisning(b, 'diff');
  const førA = await diffLinjer(b);
  check(navn + ' 19a: B sammenligner mot tilstanden da modalen åpnet (forutsetningen)',
    førA.some((l) => /FELLES GRUNN/.test(l.ins)) && !førA.some((l) => /ENDA MER/.test(l.ins)),
    førA.map((l) => l.kind + ':' + l.ins));

  await skrivSlutt(a, ' OG ENDA MER');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await b.evaluate(async () => { await window.__huskis.noteLivePull(); });
  await b.waitForFunction(() => /ENDA MER/.test(window.__huskis.noteLiveInfo.text || ''),
    null, { timeout: 8000, polling: 100 });

  await velgVisning(b, 'full');
  await velgVisning(b, 'diff');
  await b.waitForTimeout(200);
  const diffB = await diffLinjer(b);
  check(navn + ' 19: samskrivingen er med i «Nå» — uten at listen hentes på nytt',
    diffB.some((l) => /ENDA MER/.test(l.ins)) && diffB.some((l) => /FELLES GRUNN/.test(l.ins)),
    diffB.map((l) => l.kind + ':' + l.ins));
  check(navn + ' 19b: … og «Nå»-siden er lest på nytt, ikke bare tegnet om',
    /ENDA MER/.test(await b.evaluate(() => window.__huskis.noteHistoryInfo.nowText || '')),
    await b.evaluate(() => window.__huskis.noteHistoryInfo.nowText));
  await b.evaluate(() => window.__huskis.closeNoteHistory());
  await lukkEditor(a);
  await lukkEditor(b);

  /* ---- 20. En REN LESER ---- */
  const c = await ctx.newPage();
  c.on('pageerror', (e) => feil.push('C: ' + e.message));
  await loadAs(c, db, 'uC', 'c@x.no', false);
  await åpneEditor(a, ids.NR);
  await a.waitForTimeout(250);
  await skrivSlutt(a, ' MER TEKST');
  await lukkEditor(a);
  await a.waitForTimeout(300);

  await åpneHistorikk(c, ids.NR);
  await åpneRad(c, 1);
  const leserFull = await c.evaluate(() => ({
    bryter: document.querySelectorAll('.note-history-views .seg-btn').length,
    gjenopprett: !!document.querySelector('.note-history-restore'),
    behold: !!document.querySelector('.note-history-keep'),
    lagre: !document.getElementById('note-history-snapshot').hidden,
  }));
  await velgVisning(c, 'diff');
  const leserDiff = await diffLinjer(c);
  const leserEtter = await c.evaluate(() => ({
    gjenopprett: !!document.querySelector('.note-history-restore'),
    behold: !!document.querySelector('.note-history-keep'),
    lagre: !document.getElementById('note-history-snapshot').hidden,
  }));
  check(navn + ' 20: en ren leser får den samme bryteren og kan se endringene',
    leserFull.bryter === 2 && leserDiff.length > 0
    && leserDiff.some((l) => /MER TEKST/.test(l.ins)),
    { bryter: leserFull.bryter, linjer: leserDiff.map((l) => l.kind + ':' + l.ins) });
  check(navn + ' 20b: … men får ingen skriverettigheter av å se dem',
    leserFull.gjenopprett === false && leserFull.behold === false && leserFull.lagre === false
    && leserEtter.gjenopprett === false && leserEtter.behold === false
    && leserEtter.lagre === false, { før: leserFull, etter: leserEtter });
  // Og leseren har ikke lagt igjen et eneste bilde ved å bla.
  const leserBilder = await c.evaluate((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (d.note_versions || []).filter((v) => v.note_id === x).length;
  }, ids.NR);
  const eierBilder = await a.evaluate((x) => {
    const d = JSON.parse(localStorage.getItem('hk-mock-db'));
    return (d.note_versions || []).filter((v) => v.note_id === x).length;
  }, ids.NR);
  check(navn + ' 20c: … og å sammenligne legger ikke igjen et bilde på kontoen',
    leserBilder === eierBilder, { sett: leserBilder, faktisk: eierBilder });

  /* ---- 20d. … og en ren leser ser en endring som kom ETTER at modalen åpnet.
     Leserens editor er lukket, så «Nå» bygges av loggens rader — og leseren har
     ingen skrivehandling som kunne hentet listen på nytt. Bytter hun visning,
     skal sammenligningen likevel være mot notatet slik det er NÅ. */
  await åpneEditor(a, ids.NR);
  await skrivSlutt(a, ' ENDA SENERE');
  await a.evaluate(async () => { window.__huskis.noteLiveFlush(); await window.__huskis.pushNoteOps(); });
  await a.waitForTimeout(200);
  await velgVisning(c, 'full');
  await velgVisning(c, 'diff');
  await c.waitForTimeout(250);
  const leserSenere = await diffLinjer(c);
  check(navn + ' 20d: en ren leser ser også det som kom til etter at modalen åpnet',
    leserSenere.some((l) => /ENDA SENERE/.test(l.ins)),
    leserSenere.map((l) => l.kind + ':' + l.ins));
  await lukkEditor(a);

  /* ---- 21. Tilbakekalt tilgang MIDT I en sammenligning ---- */
  await a.evaluate(async (x) => {
    await window.__huskis.client.rpc('revoke_share',
      { p_type: 'note', p_id: x, p_user: 'uC' });
  }, ids.NR);
  await sync(c);
  const etterTilbakekall = await c.evaluate(() => ({
    åpen: window.__huskis.noteHistoryInfo.open,
    diffIDom: !!document.querySelector('.note-diff-doc'),
  }));
  check(navn + ' 21: tilbakekalt tilgang lukker historikken — også midt i en sammenligning',
    etterTilbakekall.åpen === false && etterTilbakekall.diffIDom === false, etterTilbakekall);

  check(navn + ': ingen JS-feil', feil.length === 0, feil.join(' | '));
  await br.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  await runLukket();
  await runFlere();
  console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
