/*
  Nettlesertest for NOTATER — Huskis' andre hoveddel (docs/notater-plan.md),
  mot mock-backend (?mock=1).

  Dekker:
    1. Hovedbryteren: ÉN segmentert kontroll `Lister ↔ Notater`, sentrert på
       panelets øverste linje med hjørnegruppen UNDER seg, fanevalget huskes
       på enheten, og toppkontrollene finnes i BEGGE fanene
   1b. … og den er en EKTE bryter: markeringen er ÉN flate som GLIR mellom to
       like brede segmenter, i samme egenskap og timing som konto-modalens
       av/på-brytere — og tastatur, `aria-selected` og rullende `tabIndex`
       følger med
    2. Lister-fanen er funksjonelt uendret (ingen regresjon): kort, rader og
       nav-modalen står som før når man kommer tilbake
    3. Bokhylle > Notatbok > Notat: oppretting og omdøping fra navigasjonen,
       bokhyllehodet som TREKKSPILL (modalen lukkes ikke), og «Frie notater»
       som den eksplisitte veien til bokhyllens egen plass
    4. «＋ Notat» oppretter notatet OG åpner editoren med det samme
    5. Editoren: tittel, overskrifter, fet/kursiv/understrek, hevet/senket,
       punkt- og nummerliste, skillelinje, lenke, spesialtegn, angre/gjør om
       — og at dokumentet leses tilbake til den strukturerte modellen
    6. Autosave: ingen Lagre-knapp, «Lagrer …» → «Lagret»
    7. Tilbakeknappen fører tilbake til riktig fane, bokhylle/notatbok og
       scrollposisjon
    8. Notatkortet: tittel, utdrag og «sist endret»
    9. Reload: innhold og struktur er intakt, og fanen er den samme
   10. Synk: radene ligger i mock-databasen med riktig forelder, og en endring
       fra «en annen enhet» flettes inn
   11. DnD: notatkort omrokeres, og rekkefølgen persisteres
   12. Tastatur: Alt+piler flytter et notatkort
   13. Dokumentmodellen: `javascript:`-lenker slipper aldri gjennom, og
       rendringen bygger noder (ingen markup fra innhold)
   14. Kortene pakkes venstre-først som listene, og bærer den samme
       posisjonsbaserte palettfargen
   15. Verktøylinjen BRYTER og ruller aldri — alle verktøyene er synlige, og
       H1/H2/H3 viser tre nivåer
   16. Overskriftshierarkiet vises som innrykk, med reset ved samme/høyere nivå
   17. Tegnreglene « - »→« – », «...»→«…», « * »→« · » — og at de IKKE tar
       «e-post», «2*3» eller en bindestrek først på linjen
   18. contenteditable: lister lages/avsluttes, Enter/Backspace rundt
       overskrifter gir gyldig struktur, innlimt markup blir tekst
   19. Idéer og drakt finnes i editoren, og tilbaketrykket tar modalen over
       editoren først
   20. Spesialtegn-panelet forankres under knappen, innenfor skjermen
   21. Editoren festes til det synlige feltet (`visualViewport`)
   22. Forelder-invarianten: flyttes en notatbok, følger notatene med — ingen
       blir igjen i en bokhylle som kan slettes under dem

  Kjøres på BÅDE desktop- og mobil-viewport der oppførselen avhenger av layout.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-tab.test.js
*/
const path = require('path');
const { chromium } = require(path.join(process.env.NODE_PATH ||
  require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { dragFromTo } = require('./dnd-gestures');

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

/* Én liste med ett listepunkt, så Lister-fanen har noe å bevise at den
   fortsatt rendrer. Notattabellene starter tomme — testen bygger dem. */
function buildDB() {
  const uid = 'u1';
  const UA = U(), GA = U(), LA = U(), IA = U();
  const base = (x) => Object.assign({ trashed: false, locked: false, unlocked: false,
    invite_policy: 'inherit', collapsed: false, is_cat: false, cat_id: null,
    ts: 1, org: 'a', pos: 0, pos_ts: 1, pos_org: 'a' }, x);
  return {
    uid,
    db: {
      _rolesBackfilled: true,
      profiles: [{ id: uid, email: 'a@x.no', display_name: 'Alice', user_metadata: {} }],
      passwords: { 'a@x.no': 'x' },
      universes: [base({ id: UA, owner_id: uid, name: 'Området' })],
      groups: [base({ id: GA, owner_id: uid, universe_id: UA, name: 'Mappa' })],
      cards: [base({ id: LA, owner_id: uid, group_id: GA, title: 'Lista', k: true, p: true, lab_ts: 0, lab_org: '' })],
      items: [base({ id: IA, owner_id: uid, card_id: LA, text: 'Et listepunkt' })],
      ideas: [], note_projects: [], note_folders: [], notes: [],
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
  // Demonstrasjonen og gest-tipsene ville ellers stått i veien (tests/CLAUDE.md).
  await p.evaluate(() => window.__huskis.tour.skipAll());
  await p.waitForFunction(() => document.getElementById('tour').hidden, null, { timeout: 5000, polling: 100 });
}

const editorÅpen = (p) => p.waitForFunction(() => !document.getElementById('note-editor').hidden,
  null, { timeout: 5000, polling: 50 });
const editorLukket = (p) => p.waitForFunction(() => document.getElementById('note-editor').hidden,
  null, { timeout: 5000, polling: 50 });

async function run(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const { db, uid } = buildDB();
  await seed(p, db, uid);

  /* ---------- 1. Hovedbryteren ---------- */
  const faner = await p.evaluate(() => {
    const tabs = document.getElementById('main-tabs');
    const bar = document.getElementById('topbar').getBoundingClientRect();
    const t = tabs.getBoundingClientRect();
    const rad = document.getElementById('topbar-row-lists').getBoundingClientRect();
    const hj = document.getElementById('corner-controls').getBoundingClientRect();
    const knapper = [...tabs.querySelectorAll('.main-tab')].map((b) => b.getBoundingClientRect());
    return {
      antall: knapper.length,
      rolle: tabs.getAttribute('role'),
      øverst: Math.round(t.top) <= Math.round(rad.top),
      iPanelet: t.top >= bar.top && t.bottom <= bar.bottom,
      // ÉN kontroll: begge halvdelene ligger inntil hverandre i den samme
      // flaten, ikke som to frittstående knapper med luft mellom.
      sammenhengende: knapper.length === 2 &&
        Math.round(knapper[1].left - knapper[0].right) <= 4,
      // Sentrert i HELE headerens bredde — ikke forskjøvet av hjørnegruppen.
      avvikFraMidten: Math.abs(Math.round((t.left + t.right) / 2 - window.innerWidth / 2)),
      // Hjørnegruppen ligger UNDER bryteren, ikke ved siden av den.
      hjørneUnder: Math.round(hj.top) >= Math.round(t.bottom) - 1,
      hjørne: !document.getElementById('corner-controls').hidden,
    };
  });
  log(navn + ': ÉN segmentert hovedbryter, sentrert på panelets øverste linje',
    faner.antall === 2 && faner.rolle === 'tablist' && faner.øverst && faner.iPanelet &&
    faner.sammenhengende && faner.avvikFraMidten <= 2 && faner.hjørneUnder,
    JSON.stringify(faner));
  log(navn + ': toppkontrollene er felles og synlige i listefanen', faner.hjørne);

  /* ---------- 1b. Bryteren er en EKTE bryter ----------
     Markeringen skal være ÉN flate som GLIR mellom segmentene — ikke en
     bakgrunn som tones inn på det ene og ut på det andre. Den måles derfor på
     det som faktisk står malt: flaten er nøyaktig ett segment bred, den
     flyttes med `transform`, og den flytter seg i samme egenskap og timing som
     knotten i konto-modalens av/på-brytere (`--switch-motion`). Flaten er den
     grønne ＋-knappens (`--grad-green`), i begge drakter. */
  const bryter = await p.evaluate(() => {
    const seg = document.getElementById('main-tabs');
    const cs = getComputedStyle(seg, '::before');
    const knapper = [...seg.querySelectorAll('.main-tab')];
    const rot = getComputedStyle(document.documentElement);
    return {
      markørW: Math.round(parseFloat(cs.width)),
      segmentW: Math.round(knapper[0].getBoundingClientRect().width),
      likeBrede: new Set(knapper.map((b) => Math.round(b.getBoundingClientRect().width))).size === 1,
      flate: cs.backgroundImage,
      grønn: rot.getPropertyValue('--grad-green').trim(),
      egenskap: cs.transitionProperty,
      varighet: cs.transitionDuration,
      knott: getComputedStyle(document.querySelector('.toggle-switch .toggle-knob') || document.body).transitionDuration,
      før: cs.transform,
      n: seg.style.getPropertyValue('--seg-n'),
      i: seg.style.getPropertyValue('--seg-i'),
    };
  });
  log(navn + ': markøren er ÉN flate, nøyaktig ett segment bred',
    bryter.markørW === bryter.segmentW && bryter.likeBrede && bryter.n === '2' && bryter.i === '0',
    JSON.stringify(bryter));
  log(navn + ': markøren flyttes med `transform`, i bryter-timingen',
    bryter.egenskap === 'transform' && bryter.varighet === '0.16s',
    bryter.egenskap + ' / ' + bryter.varighet);

  await p.click('#tab-notes');
  // ANIMASJONSFYSIKK: markøren GLIR (0,16 s), så en lesing i samme øyeblikk som
  // klikket ville lest startverdien. Fast venting er riktig her (tests/CLAUDE.md).
  await p.waitForTimeout(320);
  const glidd = await p.evaluate(() => {
    const seg = document.getElementById('main-tabs');
    const cs = getComputedStyle(seg, '::before');
    const aktiv = seg.querySelector('.main-tab.is-active');
    const ak = getComputedStyle(aktiv);
    return { transform: cs.transform, markørW: parseFloat(cs.width),
      i: seg.style.getPropertyValue('--seg-i'),
      aktivId: aktiv.id, aktivFarge: ak.color,
      // Segmentet maler ingen egen flate: markøren ER flaten.
      egenFlate: ak.backgroundColor,
      tabIndex: [...seg.querySelectorAll('.main-tab')].map((b) => b.tabIndex).join(','),
    };
  });
  const reist = (t) => {
    const m = /matrix\(1, 0, 0, 1, ([-\d.]+), 0\)/.exec(t || '');
    return m ? Math.abs(Number(m[1])) : 0;
  };
  log(navn + ': markøren GLIR til det andre segmentet (én flate, ikke to)',
    glidd.i === '1' && Math.abs(reist(glidd.transform) - glidd.markørW) < 1 &&
    glidd.aktivId === 'tab-notes' && glidd.egenFlate === 'rgba(0, 0, 0, 0)' &&
    glidd.aktivFarge === 'rgb(55, 52, 63)',
    JSON.stringify(glidd));
  log(navn + ': rullende tabIndex følger med (0 på den aktive)',
    glidd.tabIndex === '-1,0', glidd.tabIndex);

  // Piltastene bytter fortsatt fane, og markøren følger.
  await p.locator('#tab-notes').focus();
  await p.keyboard.press('ArrowLeft');
  const medTast = await p.evaluate(() => {
    const seg = document.getElementById('main-tabs');
    return { i: seg.style.getPropertyValue('--seg-i'),
      valgt: document.getElementById('tab-lists').getAttribute('aria-selected'),
      fokus: document.activeElement.id };
  });
  log(navn + ': piltast bytter fane, flytter markøren og tar fokus med seg',
    medTast.i === '0' && medTast.valgt === 'true' && medTast.fokus === 'tab-lists',
    JSON.stringify(medTast));

  await p.click('#tab-notes');
  const iNotater = await p.evaluate(() => ({
    tab: window.__huskis.mainTab,
    listerSkjult: document.getElementById('board').hidden,
    notaterSynlig: !document.getElementById('notes-board').hidden,
    radLister: document.getElementById('topbar-row-lists').hidden,
    radNotater: !document.getElementById('topbar-row-notes').hidden,
    hjørne: !document.getElementById('corner-controls').hidden,
    valgt: document.getElementById('tab-notes').getAttribute('aria-selected'),
  }));
  log(navn + ': Notater-fanen bytter flate, rad og markering',
    iNotater.tab === 'notes' && iNotater.listerSkjult && iNotater.notaterSynlig &&
    iNotater.radLister && iNotater.radNotater && iNotater.valgt === 'true',
    JSON.stringify(iNotater));
  log(navn + ': toppkontrollene er de samme i notatfanen (ikke duplisert per fane)',
    iNotater.hjørne);

  /* ---------- 3. Bokhylle > Notatbok > Notat ---------- */
  // Navngivingen på plassen: ＋ Bokhylle lager kortet og åpner navnefeltet.
  await p.click('#notes-crumb');
  await p.waitForSelector('#notes-nav-board .notes-add-project button', { timeout: 5000 });
  await p.click('.notes-add-project button');
  const navnefelt = await p.evaluate(() => {
    const el = document.querySelector('#notes-nav-board .card .edit-input');
    return el ? { finnes: true, fokus: document.activeElement === el } : { finnes: false };
  });
  log(navn + ': «＋ Bokhylle» lager bokhyllen og åpner navnefeltet på den',
    navnefelt.finnes && navnefelt.fokus, JSON.stringify(navnefelt));
  await p.keyboard.type('Forskning');
  await p.keyboard.press('Enter');
  const prosjekt = await p.evaluate(() => window.__huskis.state.noteProjects.map((x) => x.name));
  log(navn + ': bokhyllen fikk navnet', prosjekt.join(',') === 'Forskning', prosjekt.join(','));

  await p.click('#notes-nav-board .card .add-item-btn');
  await p.keyboard.type('Metode');
  await p.keyboard.press('Enter');
  const mapper = await p.evaluate(() => window.__huskis.state.noteProjects[0].folders.map((f) => f.name));
  log(navn + ': notatboken ble lagt i bokhyllen', mapper.join(',') === 'Metode', mapper.join(','));

  /* BOKHYLLEHODET ER ET TREKKSPILL, ikke navigasjon: det åpner og lukker
     bokhyllen, og modalen skal IKKE lukkes av det. */
  await p.click('#notes-nav-board .card .card-head');
  const kollapset = await p.evaluate(() => {
    const card = document.querySelector('#notes-nav-board .card');
    return {
      kollapset: card.classList.contains('collapsed'),
      aria: card.querySelector('.card-head').getAttribute('aria-expanded'),
      modalÅpen: !document.getElementById('notes-nav-modal').hidden,
      lagret: !!window.__huskis.state.noteProjects[0].collapsed,
    };
  });
  log(navn + ': klikk på bokhyllehodet kollapser bokhyllen og lar modalen stå',
    kollapset.kollapset && kollapset.aria === 'false' && kollapset.modalÅpen && kollapset.lagret,
    JSON.stringify(kollapset));
  await p.click('#notes-nav-board .card .card-head');
  const utvidet = await p.evaluate(() => ({
    kollapset: document.querySelector('#notes-nav-board .card').classList.contains('collapsed'),
    aria: document.querySelector('#notes-nav-board .card-head').getAttribute('aria-expanded'),
    modalÅpen: !document.getElementById('notes-nav-modal').hidden,
  }));
  log(navn + ': et nytt klikk åpner den igjen — fortsatt uten å lukke modalen',
    !utvidet.kollapset && utvidet.aria === 'true' && utvidet.modalÅpen, JSON.stringify(utvidet));

  // Naviger inn i notatboken fra raden.
  await p.click('#notes-nav-board .note-folder-row:not(.note-free-row)');
  const iMappe = await p.evaluate(() => ({
    folder: window.__huskis.state.activeFolder,
    crumb: document.getElementById('crumb-note-folder-name').textContent,
    modalLukket: document.getElementById('notes-nav-modal').hidden,
  }));
  log(navn + ': klikk på notatbok-raden navigerer inn i notatboken',
    !!iMappe.folder && iMappe.crumb === 'Metode' && iMappe.modalLukket, JSON.stringify(iMappe));

  /* … og «Frie notater» er den EKSPLISITTE veien til bokhyllens egen plass.
     Raden er ingen rad i modellen: den har en syntetisk id og kan ikke løftes. */
  await p.click('#notes-crumb');
  await p.waitForSelector('#notes-nav-board .note-free-row', { timeout: 5000 });
  const friRad = await p.evaluate(() => {
    const el = document.querySelector('#notes-nav-board .items-container > *');
    return {
      først: !!el && el.classList.contains('note-free-row'),
      id: el && el.dataset.id,
      uløftbar: !!el && el.hasAttribute('data-dnd-ignore'),
      ukjentForModellen: !window.__huskis.state.noteProjects[0].folders
        .some((f) => f.id === (el && el.dataset.id)),
    };
  });
  log(navn + ': «Frie notater» står først i bokhyllen og er ingen notatbok',
    friRad.først && /^free:/.test(friRad.id || '') && friRad.uløftbar && friRad.ukjentForModellen,
    JSON.stringify(friRad));
  await p.click('#notes-nav-board .note-free-row');
  const friPlass = await p.evaluate(() => ({
    folder: window.__huskis.state.activeFolder,
    crumb: document.getElementById('crumb-note-folder-name').textContent,
    modalLukket: document.getElementById('notes-nav-modal').hidden,
  }));
  log(navn + ': «Frie notater» fører til bokhyllens egen plass',
    friPlass.folder === null && friPlass.crumb.length > 0 && friPlass.modalLukket,
    JSON.stringify(friPlass));

  /* ---------- 4. «＋ Notat» åpner editoren ---------- */
  await p.click('#add-note-btn');
  await editorÅpen(p);
  const åpnet = await p.evaluate(() => ({
    notater: window.__huskis.state.notes.length,
    fritt: window.__huskis.state.notes[0].folder,
    prosjekt: window.__huskis.state.notes[0].project === window.__huskis.state.activeProject,
    lagreknapp: !!document.querySelector('#note-editor button[data-save], #note-editor .note-save-btn'),
  }));
  log(navn + ': «＋ Notat» oppretter notatet og åpner editoren straks',
    åpnet.notater === 1 && åpnet.fritt === null && åpnet.prosjekt, JSON.stringify(åpnet));
  log(navn + ': editoren har INGEN Lagre-knapp (autosave)', !åpnet.lagreknapp);
  // Fullskjermsbildet er ikke en modal, så fokusfella der gjelder det ikke:
  // resten av appen gjøres `inert` i stedet, ellers vandrer Tab ned i
  // toppmenyen og board-et bak bildet (docs/tilgjengelighet.md).
  const bak = await p.evaluate(() => ({
    topbar: document.getElementById('topbar').inert === true,
    main: document.querySelector('.app-main').inert === true,
    hjørne: document.getElementById('corner-controls').inert === true,
  }));
  log(navn + ': appflaten bak editoren er inert (fokus kan ikke vandre dit)',
    bak.topbar && bak.main && bak.hjørne, JSON.stringify(bak));

  /* ---------- 5. Formatering ---------- */
  await p.fill('#note-title-input', 'Utvalg');
  await p.click('#note-doc');
  await p.keyboard.type('Vanlig tekst');
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="h2"]');
  await p.keyboard.type('Overskrift');
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="ul"]');
  await p.keyboard.type('Punkt en');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Punkt to');
  const doc1 = await p.evaluate(() => window.__huskis.noteDocFromEl(document.getElementById('note-doc')));
  log(navn + ': blokkene leses tilbake som modellens typer',
    doc1.blocks.map((b) => b.t).join(',') === 'p,h2,ul',
    doc1.blocks.map((b) => b.t).join(','));
  log(navn + ': punktlista har begge punktene',
    (doc1.blocks[2].items || []).map((i) => i.map((r) => r.s).join('')).join('|') === 'Punkt en|Punkt to',
    JSON.stringify(doc1.blocks[2].items));

  // Tegnmarkeringene: hver av dem på sitt eget ord, så de kan leses hver for seg.
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="ul"]');            // ut av lista igjen
  for (const [cmd, ord] of [['bold', 'fet'], ['italic', 'kursiv'], ['underline', 'strek'],
                            ['superscript', 'hevet'], ['subscript', 'senket']]) {
    await p.click('.note-tool[data-cmd="' + cmd + '"]');
    await p.keyboard.type(ord);
    await p.click('.note-tool[data-cmd="' + cmd + '"]');
    await p.keyboard.type(' ');
  }
  const merker = await p.evaluate(() => {
    const d = window.__huskis.noteDocFromEl(document.getElementById('note-doc'));
    const siste = d.blocks[d.blocks.length - 1];
    const ut = {};
    (siste.c || []).forEach((r) => {
      ['b', 'i', 'u', 'sup', 'sub'].forEach((m) => { if (r[m]) ut[m] = r.s; });
    });
    return ut;
  });
  log(navn + ': fet, kursiv, understrek, hevet og senket bæres av modellen',
    merker.b === 'fet' && merker.i === 'kursiv' && merker.u === 'strek' &&
    merker.sup === 'hevet' && merker.sub === 'senket', JSON.stringify(merker));

  // Nummerert liste og skillelinje.
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="ol"]');
  await p.keyboard.type('Først');
  // To Enter forlater lista slik nettleseren selv gjør det (tomt punkt).
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.click('.note-tool[data-cmd="hr"]');
  const doc2 = await p.evaluate(() => window.__huskis.noteDocFromEl(document.getElementById('note-doc')));
  log(navn + ': nummerert liste og skillelinje er egne blokktyper',
    doc2.blocks.some((b) => b.t === 'ol') && doc2.blocks.some((b) => b.t === 'hr'),
    doc2.blocks.map((b) => b.t).join(','));

  // Spesialtegn.
  await p.click('.note-tool[data-cmd="symbol"]');
  await p.waitForSelector('#note-symbol-panel button', { timeout: 3000 });
  await p.click('#note-symbol-panel button:nth-child(3)');   // «…»
  const tegn = await p.evaluate(() => window.__huskis.noteDocText(
    window.__huskis.noteDocFromEl(document.getElementById('note-doc'))));
  log(navn + ': spesialtegnet ble satt inn i teksten', tegn.indexOf('…') > -1,
    JSON.stringify(tegn.slice(-30)));

  // Lenke: marker et ord og legg adressen på det.
  await p.evaluate(() => {
    const doc = document.getElementById('note-doc');
    const p1 = doc.querySelector('p');
    const r = document.createRange();
    r.selectNodeContents(p1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await p.click('.note-tool[data-cmd="link"]');
  await p.fill('#note-link-input', 'eksempel.no/side');
  await p.click('#note-link-apply');
  const lenke = await p.evaluate(() => {
    const d = window.__huskis.noteDocFromEl(document.getElementById('note-doc'));
    const run = d.blocks[0].c.find((r) => r.url);
    return { url: run && run.url, tekst: run && run.s,
             anker: document.querySelectorAll('#note-doc a').length };
  });
  log(navn + ': lenken lagres som en normalisert adresse på kjøringen',
    !!lenke.url && lenke.url.indexOf('eksempel.no/side') > -1 && lenke.tekst === 'Vanlig tekst',
    JSON.stringify(lenke));
  log(navn + ': lenken er MERKET tekst, ikke et anker (ingen utgående lenke)',
    lenke.anker === 0, 'a-elementer: ' + lenke.anker);

  // Angre/gjør om igjen.
  await p.click('#note-doc');
  await p.keyboard.type('SLETTMEG');
  const førAngre = await p.evaluate(() => document.getElementById('note-doc').textContent);
  await p.click('.note-tool[data-cmd="undo"]');
  const etterAngre = await p.evaluate(() => document.getElementById('note-doc').textContent);
  await p.click('.note-tool[data-cmd="redo"]');
  const etterGjørOm = await p.evaluate(() => document.getElementById('note-doc').textContent);
  log(navn + ': angre og gjør om igjen virker i editoren',
    førAngre.indexOf('SLETTMEG') > -1 && etterAngre.indexOf('SLETTMEG') === -1 &&
    etterGjørOm.indexOf('SLETTMEG') > -1,
    'før/etter/omigjen: ' + [førAngre.indexOf('SLETTMEG') > -1, etterAngre.indexOf('SLETTMEG') > -1,
      etterGjørOm.indexOf('SLETTMEG') > -1].join(','));

  /* ---------- 6. Autosave ---------- */
  await p.click('#note-doc');
  await p.keyboard.type('.');
  const lagrer = await p.evaluate(() => document.getElementById('note-save-status').textContent);
  await p.waitForFunction(() => document.getElementById('note-save-status').textContent === 'Lagret',
    null, { timeout: 4000, polling: 100 });
  log(navn + ': autosave viser «Lagrer …» og så «Lagret»',
    /Lagrer/.test(lagrer), JSON.stringify(lagrer));

  /* ---------- 7. Tilbake til samme kontekst ---------- */
  // Escape lukker først et åpent panel, deretter editoren — og lukker ikke
  // begge i ett trykk (systemBack tar den samme stigen på Android).
  await p.click('.note-tool[data-cmd="symbol"]');
  await p.waitForSelector('#note-symbol-panel button', { timeout: 3000 });
  await p.keyboard.press('Escape');
  const etterEnEsc = await p.evaluate(() => ({
    panel: document.getElementById('note-symbol-panel').hidden,
    editor: document.getElementById('note-editor').hidden,
  }));
  log(navn + ': Escape lukker panelet, ikke hele editoren',
    etterEnEsc.panel && !etterEnEsc.editor, JSON.stringify(etterEnEsc));
  const viaBack = await p.evaluate(() => {
    const tatt = window.__huskis.systemBack();
    return { tatt, editor: document.getElementById('note-editor').hidden };
  });
  log(navn + ': Androids tilbakeknapp lukker editoren i stedet for appen',
    viaBack.tatt === true && viaBack.editor, JSON.stringify(viaBack));
  // …og åpne den igjen, så resten av flyten står som før.
  await p.click('#notes-board .note-card');
  await editorÅpen(p);
  await p.click('#note-back');
  await editorLukket(p);
  const tilbake = await p.evaluate(() => ({
    tab: window.__huskis.mainTab,
    prosjekt: !!window.__huskis.state.activeProject,
    mappe: window.__huskis.state.activeFolder,
    kort: document.querySelectorAll('#notes-board .note-card').length,
  }));
  log(navn + ': tilbakeknappen lander i riktig fane og plassering',
    tilbake.tab === 'notes' && tilbake.prosjekt && tilbake.mappe === null && tilbake.kort === 1,
    JSON.stringify(tilbake));
  const bakEtter = await p.evaluate(() => ({
    topbar: document.getElementById('topbar').inert === true,
    main: document.querySelector('.app-main').inert === true,
  }));
  log(navn + ': appflaten er brukbar igjen etter tilbake',
    !bakEtter.topbar && !bakEtter.main, JSON.stringify(bakEtter));

  /* ---------- 8. Notatkortet ---------- */
  const kort = await p.evaluate(() => {
    const el = document.querySelector('#notes-board .note-card');
    return {
      tittel: el.querySelector('.note-card-title').textContent,
      utdrag: el.querySelector('.note-card-excerpt-text').textContent,
      meta: el.querySelector('.note-card-meta').textContent,
    };
  });
  log(navn + ': kortet viser tittel, utdrag og sist endret',
    kort.tittel === 'Utvalg' && kort.utdrag.indexOf('Vanlig tekst') > -1 && kort.meta.length > 3,
    JSON.stringify(kort));

  /* ---------- 10. Synk mot mock-backenden ---------- */
  /* Vent på at DOKUMENTET er pushet, ikke bare at raden finnes: insert-en kan
     ha gått av gårde før autosaven skrev innholdet, og oppdateringen kommer da
     i neste runde. */
  await p.waitForFunction(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    const n = (db.notes || [])[0];
    return !!n && (db.note_projects || []).length === 1 &&
      !!n.body && (n.body.blocks || []).length > 3;
  }, null, { timeout: 12000, polling: 200 });
  const server = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const n = db.notes[0];
    return {
      prosjekt: n.project_id === db.note_projects[0].id,
      fritt: n.folder_id === null,
      mappeIProsjektet: db.note_folders[0].project_id === db.note_projects[0].id,
      blokker: (n.body.blocks || []).length,
      eier: n.owner_id,
    };
  });
  log(navn + ': radene ligger på serveren med riktig forelder og dokument',
    server.prosjekt && server.fritt && server.mappeIProsjektet && server.blokker > 3 &&
    server.eier === 'u1', JSON.stringify(server));

  // «En annen enhet» endrer tittelen med et nyere stempel → flettes inn.
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    db.notes[0].title = 'Endret et annet sted';
    db.notes[0].ts = Date.now() + 60000;
    db.notes[0].org = 'annen-enhet';
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
  });
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => window.__huskis.state.notes[0].title === 'Endret et annet sted',
    null, { timeout: 8000, polling: 200 });
  const flettet = await p.evaluate(() => ({
    tittel: window.__huskis.state.notes[0].title,
    kort: (document.querySelector('#notes-board .note-card .note-card-title') || {}).textContent,
    blokker: window.__huskis.state.notes[0].doc.blocks.length,
  }));
  log(navn + ': en nyere fjern-endring flettes inn og males på kortet',
    flettet.tittel === 'Endret et annet sted' && flettet.kort === 'Endret et annet sted' &&
    flettet.blokker > 3, JSON.stringify(flettet));

  /* ---------- 9. Reload ---------- */
  await p.reload();
  await klar(p);
  await p.waitForFunction(() => document.querySelectorAll('#notes-board .note-card').length === 1,
    null, { timeout: 10000, polling: 200 });
  const etterReload = await p.evaluate(() => {
    const H = window.__huskis;
    const n = H.state.notes[0];
    return {
      tab: H.mainTab,
      tittel: n.title,
      blokker: n.doc.blocks.map((b) => b.t).join(','),
      tekst: H.noteDocText(n.doc),
      prosjekt: H.state.noteProjects[0].name,
      mappe: H.state.noteProjects[0].folders[0].name,
    };
  });
  log(navn + ': fanevalget huskes over en reload', etterReload.tab === 'notes', etterReload.tab);
  log(navn + ': innhold og struktur er intakt etter reload',
    etterReload.tittel === 'Endret et annet sted' &&
    /p,h2,ul/.test(etterReload.blokker) && etterReload.tekst.indexOf('Punkt to') > -1 &&
    etterReload.prosjekt === 'Forskning' && etterReload.mappe === 'Metode',
    JSON.stringify(etterReload));

  /* ---------- 2. Lister-fanen er uendret ---------- */
  await p.click('#tab-lists');
  const lister = await p.evaluate(() => ({
    kort: document.querySelectorAll('#board .card').length,
    rader: document.querySelectorAll('#board .items-container > .item').length,
    tittel: (document.querySelector('#board .card-title') || {}).textContent,
    knapp: !document.getElementById('add-card-btn').disabled,
  }));
  log(navn + ': Lister-fanen rendrer fortsatt kortene og radene sine',
    lister.kort === 1 && lister.rader === 1 && lister.tittel === 'Lista' && lister.knapp,
    JSON.stringify(lister));
  await p.evaluate(() => window.__huskis.openNavModal());
  await p.waitForFunction(() => !document.getElementById('nav-modal').hidden, null, { timeout: 4000 });
  const navOk = await p.evaluate(() => document.querySelectorAll('#nav-board .uni-card').length);
  await p.evaluate(() => window.__huskis.closeNavModal());
  log(navn + ': nav-modalen for områder/mapper virker som før', navOk === 1, 'områdekort: ' + navOk);

  /* ---------- 11. DnD: omrokering av notatkort ---------- */
  await p.click('#tab-notes');
  await p.evaluate(() => {
    const H = window.__huskis;
    ['Nummer to', 'Nummer tre'].forEach((t) => {
      const n = H.addNote();
      n.title = t;
      H.closeNoteEditor();
    });
    H.save();
    H.renderNotes();
  });
  await p.waitForFunction(() => document.querySelectorAll('#notes-board .note-card').length === 3,
    null, { timeout: 5000, polling: 100 });
  const førDrag = await p.evaluate(() => [...document.querySelectorAll('#notes-board .note-card .note-card-title')]
    .map((e) => e.textContent));
  /* Kortene fordeles på flere kolonner (docs/board-layout.md), så en
     `:first-child`-selektor treffer det FØRSTE kortet i HVER kolonne. Punktene
     regnes derfor ut av dokumentrekkefølgen, som ER leserekkefølgen. */
  const kortPunkt = (i, ratio) => p.evaluate(({ i, ratio }) => {
    const els = document.querySelectorAll('#notes-board .note-card');
    const r = els[i < 0 ? els.length + i : i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * (ratio == null ? 0.5 : ratio) };
  }, { i, ratio });
  await dragFromTo(p, await kortPunkt(0), () => kortPunkt(-1, 0.85), { touch });
  await p.waitForTimeout(400);
  const etterDrag = await p.evaluate(() => [...document.querySelectorAll('#notes-board .note-card .note-card-title')]
    .map((e) => e.textContent));
  log(navn + ': et notatkort kan dras til en ny plass i rekka',
    etterDrag.join('|') !== førDrag.join('|') && etterDrag.length === 3,
    førDrag.join('|') + ' → ' + etterDrag.join('|'));
  const persistert = await p.evaluate(() => {
    const H = window.__huskis;
    return H.notesIn(H.state.activeProject, H.state.activeFolder).map((n) => n.title);
  });
  log(navn + ': rekkefølgen fra draget er den samme i tilstanden',
    persistert.join('|') === etterDrag.join('|'), persistert.join('|'));
  await p.waitForFunction(() => {
    const el = document.getElementById('sync-status');
    return !el || el.dataset.state !== 'saving';
  }, null, { timeout: 8000, polling: 200 });
  const påServer = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    return db.notes.slice().sort((a, b) => a.pos - b.pos).map((n) => n.title);
  });
  log(navn + ': rekkefølgen er synket (samme rekkefølge på serveren)',
    påServer.join('|') === persistert.join('|'), påServer.join('|'));

  /* ---------- 12. Tastatur ---------- */
  const førTast = await p.evaluate(() => {
    const H = window.__huskis;
    return H.notesIn(H.state.activeProject, H.state.activeFolder).map((n) => n.title);
  });
  await p.evaluate(() => {
    const els = document.querySelectorAll('#notes-board .note-card');
    els[els.length - 1].focus();
  });
  await p.keyboard.down('Alt');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.up('Alt');
  await p.waitForTimeout(200);
  const etterTast = await p.evaluate(() => {
    const H = window.__huskis;
    return H.notesIn(H.state.activeProject, H.state.activeFolder).map((n) => n.title);
  });
  log(navn + ': Alt+Pil opp flytter et notatkort ett hakk',
    etterTast[etterTast.length - 2] === førTast[førTast.length - 1],
    førTast.join('|') + ' → ' + etterTast.join('|'));

  /* ---------- 13. Trygg modell og rendring ---------- */
  const trygg = await p.evaluate(() => {
    const H = window.__huskis;
    const farlig = H.sanitizeNoteDoc({ v: 1, blocks: [
      { t: 'script', c: [{ s: 'x' }] },
      { t: 'p', c: [{ s: 'a', url: 'javascript:alert(1)' }, { s: 'b', url: 'data:text/html,x' },
                    { s: 'c', url: 'https://ok.example/side' }] },
    ] });
    const holder = document.createElement('div');
    H.noteDocIntoEl(holder, H.sanitizeNoteDoc({ v: 1, blocks: [
      { t: 'p', c: [{ s: '<img src=x onerror=alert(1)>' }] },
    ] }));
    return {
      typer: farlig.blocks.map((b) => b.t),
      // Naboer med samme markering slås sammen, så de to farlige adressene blir
      // ÉN kjøring uten url — teksten er beholdt, adressen er borte.
      urler: farlig.blocks[1].c.map((r) => r.url || ''),
      tekst2: farlig.blocks[1].c.map((r) => r.s).join(''),
      js: H.safeNoteUrl('javascript:alert(1)'),
      // Kontrolltegn midt i skjemaet skal ikke slippe gjennom.
      jsSkjult: H.safeNoteUrl('java script:alert(1)'),
      elementer: holder.querySelectorAll('img, script').length,
      tekst: holder.textContent,
    };
  });
  log(navn + ': ukjente blokktyper blir avsnitt, og bare trygge skjemaer overlever',
    trygg.typer.join(',') === 'p,p' &&
    trygg.urler.filter(Boolean).length === 1 &&
    trygg.urler.filter(Boolean)[0].indexOf('ok.example') > -1 &&
    trygg.tekst2 === 'abc' && trygg.js === '' && trygg.jsSkjult === '',
    JSON.stringify(trygg.urler) + ' tekst=' + JSON.stringify(trygg.tekst2) +
    ' js=' + JSON.stringify(trygg.js) + '/' + JSON.stringify(trygg.jsSkjult));
  log(navn + ': innhold rendres som TEKST, aldri som markup',
    trygg.elementer === 0 && trygg.tekst.indexOf('<img') === 0,
    'elementer: ' + trygg.elementer + ', tekst: ' + JSON.stringify(trygg.tekst));

  /* ---------- 14. Samme kolonnepakking og fargesyklus som listene ---------- */
  const pakking = await p.evaluate(() => {
    const kort = [...document.querySelectorAll('#notes-board .note-card')];
    const kolonnerMedKort = [...document.querySelectorAll('#notes-board .board-col')]
      .filter((c) => c.querySelector('.note-card')).length;
    return {
      antall: kort.length,
      kolonnerMedKort,
      // Fyll-venstre-først: småkort som får plass på én skjermhøyde skal ligge
      // i ÉN kolonne, ikke spres jevnt utover (det var den gamle særregelen).
      farger: kort.map((el) => el.style.getPropertyValue('--card-bg')),
      hode: kort.map((el) => el.style.getPropertyValue('--card-head')).filter(Boolean).length,
    };
  });
  log(navn + ': notatkortene pakkes venstre-først, som listene',
    pakking.kolonnerMedKort === 1, JSON.stringify({ kol: pakking.kolonnerMedKort, n: pakking.antall }));
  log(navn + ': hvert notatkort bærer sin egen palettfarge (posisjonsbasert)',
    pakking.farger.every((f) => /^#[0-9a-f]{6}$/i.test(f.trim())) &&
    new Set(pakking.farger).size === pakking.farger.length &&
    pakking.hode === pakking.antall,
    JSON.stringify(pakking.farger));
  // Fargen følger POSISJONEN: bytter to kort plass, bytter fargene også.
  const førFarge = pakking.farger[0];
  await p.evaluate(() => {
    const H = window.__huskis;
    const liste = H.notesIn(H.state.activeProject, H.state.activeFolder);
    const a = liste[0].pos; liste[0].pos = liste[1].pos; liste[1].pos = a;
    H.renderNotes();
  });
  const etterFarge = await p.evaluate(() =>
    document.querySelector('#notes-board .note-card').style.getPropertyValue('--card-bg'));
  log(navn + ': fargen henger på plassen, ikke på notatet',
    etterFarge === førFarge, førFarge + ' → ' + etterFarge);

  /* ---------- 15. Editorens verktøylinje: bryter, ruller ALDRI ---------- */
  await p.click('#notes-board .note-card');
  await editorÅpen(p);
  const linja = await p.evaluate(() => {
    const tools = document.getElementById('note-tools');
    const t = tools.getBoundingClientRect();
    const knapper = [...tools.querySelectorAll('[data-cmd]')];
    return {
      antall: knapper.length,
      ruller: tools.scrollWidth > tools.clientWidth + 1,
      overflowX: getComputedStyle(tools).overflowX,
      utenfor: knapper.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width === 0 || r.left < t.left - 1 || r.right > t.right + 1;
      }).length,
      // Tilbakeknappen er en Huskis-knapp, ikke et verktøy.
      tilbakeErKnapp: document.getElementById('note-back').classList.contains('btn'),
      // De tre overskriftsknappene viser tre forskjellige nivåer.
      hStørrelser: ['h1', 'h2', 'h3'].map((c) => parseFloat(getComputedStyle(
        document.querySelector('.note-tool[data-cmd="' + c + '"] .note-tool-text')).fontSize)),
    };
  });
  log(navn + ': alle verktøyene er synlige uten vannrett rulling',
    linja.antall >= 14 && !linja.ruller && linja.overflowX !== 'auto' &&
    linja.overflowX !== 'scroll' && linja.utenfor === 0, JSON.stringify(linja));
  log(navn + ': H1/H2/H3 viser tre nivåer, og tilbake er en vanlig knapp',
    linja.tilbakeErKnapp && linja.hStørrelser[0] > linja.hStørrelser[1] &&
    linja.hStørrelser[1] > linja.hStørrelser[2], JSON.stringify(linja.hStørrelser));

  /* ---------- 16. Overskriftshierarkiet som innrykk ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    const n = H.notesIn(H.state.activeProject, H.state.activeFolder)[0];
    const T = (t, s) => ({ t, c: [{ s }] });
    H.closeNoteEditor();   // FØR doc settes: lukkingen skyller editorens DOM tilbake
    n.doc = { v: 1, blocks: [
      T('h1', 'Én'), T('p', 'under én'),
      T('h2', 'To'), T('p', 'under to'),
      T('h3', 'Tre'), T('p', 'under tre'),
      T('h2', 'To igjen'), T('p', 'under to igjen'),
    ] };
    H.openNoteEditor(n.id);
  });
  await editorÅpen(p);
  const innrykk = await p.evaluate(() => {
    const doc = document.getElementById('note-doc');
    const nivå = [...doc.children].map((el) => el.tagName.toLowerCase() + ':' + (el.dataset.lvl || '0'));
    const steg = parseFloat(getComputedStyle(doc).getPropertyValue('--note-indent'));
    const margin = [...doc.children].map((el) => Math.round(parseFloat(getComputedStyle(el).marginLeft)));
    return { nivå: nivå.join(','), steg, margin };
  });
  log(navn + ': hver overskrift eier innholdet under seg, og nivåene rykkes inn',
    innrykk.nivå === 'h1:0,p:1,h2:1,p:2,h3:2,p:3,h2:1,p:2', innrykk.nivå);
  log(navn + ': innrykket er ETT felles trinn per nivå',
    innrykk.steg > 0 && innrykk.margin[1] === Math.round(innrykk.steg) &&
    innrykk.margin[3] === Math.round(innrykk.steg * 2) &&
    innrykk.margin[5] === Math.round(innrykk.steg * 3) &&
    innrykk.margin[6] === Math.round(innrykk.steg),
    JSON.stringify(innrykk));

  /* ---------- 17. Automatiske tegnregler ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    const n = H.notesIn(H.state.activeProject, H.state.activeFolder)[0];
    H.closeNoteEditor();   // FØR doc settes: lukkingen skyller editorens DOM tilbake
    n.doc = { v: 1, blocks: [{ t: 'p', c: [] }] };
    H.openNoteEditor(n.id);
  });
  await editorÅpen(p);
  await p.click('#note-doc');
  await p.keyboard.type('to - tre og x * y og vent... e-post 2*3 ferdig');
  const tegnregler = await p.evaluate(() =>
    window.__huskis.noteDocText(window.__huskis.noteDocFromEl(document.getElementById('note-doc'))));
  log(navn + ': « - » blir tankestrek, «...» blir ellipse og « * » blir midtprikk',
    /to – tre/.test(tegnregler) && /x · y/.test(tegnregler) && /vent…/.test(tegnregler),
    JSON.stringify(tegnregler));
  log(navn + ': og de tar IKKE bindestreken i «e-post» eller stjernen i «2*3»',
    /e-post/.test(tegnregler) && /2\*3/.test(tegnregler) && !/e–post/.test(tegnregler),
    JSON.stringify(tegnregler));
  // Markøren står der den skal etter et bytte: neste tegn havner etter strekene.
  log(navn + ': markøren blir stående etter tegnbyttet', /ferdig$/.test(tegnregler.trim()),
    JSON.stringify(tegnregler.slice(-20)));
  // Regelen skal heller ikke ta et listepunkt som BEGYNNER med «- ».
  await p.keyboard.press('Enter');
  await p.keyboard.type('- start');
  const iStart = await p.evaluate(() =>
    window.__huskis.noteDocText(window.__huskis.noteDocFromEl(document.getElementById('note-doc'))));
  log(navn + ': en bindestrek FØRST på linjen står urørt',
    /- start/.test(iStart) && !/– start/.test(iStart), JSON.stringify(iStart.slice(-12)));

  /* ---------- 18. contenteditable: lister, Enter/Backspace, innliming ---------- */
  await p.evaluate(() => {
    const H = window.__huskis;
    const n = H.notesIn(H.state.activeProject, H.state.activeFolder)[0];
    H.closeNoteEditor();   // FØR doc settes: lukkingen skyller editorens DOM tilbake
    n.doc = { v: 1, blocks: [{ t: 'p', c: [] }] };
    H.openNoteEditor(n.id);
  });
  await editorÅpen(p);
  await p.click('#note-doc');
  await p.click('.note-tool[data-cmd="ul"]');
  await p.keyboard.type('ett');
  await p.keyboard.press('Enter');
  await p.keyboard.type('to');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');            // tomt punkt = ut av lista
  await p.keyboard.type('etter lista');
  const listeflyt = await p.evaluate(() => {
    const d = window.__huskis.noteDocFromEl(document.getElementById('note-doc'));
    const ul = d.blocks.find((b) => b.t === 'ul');
    return {
      typer: d.blocks.map((b) => b.t).join(','),
      punkter: ul ? ul.items.map((i) => i.map((r) => r.s).join('')).join('|') : '',
      tekst: window.__huskis.noteDocText(d),
    };
  });
  log(navn + ': lista lages, fylles og avsluttes — teksten etter havner utenfor',
    listeflyt.punkter === 'ett|to' && /etter lista/.test(listeflyt.tekst) &&
    /ul/.test(listeflyt.typer) && listeflyt.typer.split(',').every((t) => /^(p|h1|h2|h3|ul|ol|hr)$/.test(t)),
    JSON.stringify(listeflyt));

  // Backspace i starten av en blokk rett etter en overskrift skal ikke gi
  // ugyldig struktur (nettleseren slår sammen blokkene selv).
  await p.click('.note-tool[data-cmd="h2"]');
  await p.keyboard.press('Enter');
  await p.keyboard.type('brød');
  await p.keyboard.press('Home');
  await p.keyboard.press('Backspace');
  const etterBackspace = await p.evaluate(() => {
    const d = window.__huskis.noteDocFromEl(document.getElementById('note-doc'));
    return { typer: d.blocks.map((b) => b.t).join(','), tekst: window.__huskis.noteDocText(d) };
  });
  log(navn + ': Enter/Backspace rundt overskrifter gir fortsatt gyldig struktur',
    etterBackspace.typer.split(',').every((t) => /^(p|h1|h2|h3|ul|ol|hr)$/.test(t)) &&
    /brød/.test(etterBackspace.tekst), JSON.stringify(etterBackspace));

  // Innliming: markup fra utsiden blir TEKST, aldri elementer.
  await p.evaluate(() => {
    const doc = document.getElementById('note-doc');
    doc.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '<b>limt</b> tekst');
    doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const limt = await p.evaluate(() => ({
    elementer: document.querySelectorAll('#note-doc b, #note-doc strong, #note-doc script').length,
    tekst: window.__huskis.noteDocText(window.__huskis.noteDocFromEl(document.getElementById('note-doc'))),
  }));
  log(navn + ': innlimt markup blir ren tekst i modellen',
    limt.elementer === 0 && /<b>limt<\/b> tekst/.test(limt.tekst), JSON.stringify(limt));

  /* ---------- 19. Idéer og drakt er med i editoren ---------- */
  const førDrakt = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await p.click('#note-theme-btn');
  const etterDrakt = await p.evaluate(() => ({
    tema: document.documentElement.getAttribute('data-theme'),
    lagret: localStorage.getItem('huskis-theme'),
    editorÅpen: !document.getElementById('note-editor').hidden,
  }));
  log(navn + ': draktknappen i editoren bytter drakt for hele appen',
    etterDrakt.tema !== førDrakt && etterDrakt.tema === etterDrakt.lagret && etterDrakt.editorÅpen,
    førDrakt + ' → ' + JSON.stringify(etterDrakt));
  await p.click('#note-theme-btn');   // tilbake
  await p.click('#note-ideas-btn');
  await p.waitForFunction(() => !document.getElementById('ideas-modal').hidden,
    null, { timeout: 4000, polling: 50 });
  const medIdeer = await p.evaluate(() => ({
    ideer: !document.getElementById('ideas-modal').hidden,
    editor: !document.getElementById('note-editor').hidden,
  }));
  log(navn + ': idéknappen i editoren åpner den samme idémodalen',
    medIdeer.ideer && medIdeer.editor, JSON.stringify(medIdeer));
  // Idémodalen ligger OVER editoren, så tilbaketrykket skal ta modalen først.
  const stigen = await p.evaluate(() => {
    const tatt = window.__huskis.systemBack();
    return { tatt, ideer: !document.getElementById('ideas-modal').hidden,
             editor: !document.getElementById('note-editor').hidden };
  });
  log(navn + ': tilbaketrykket lukker idémodalen først, ikke editoren under',
    stigen.tatt === true && !stigen.ideer && stigen.editor, JSON.stringify(stigen));

  /* ---------- 20. Spesialtegn-panelet forankres under knappen ---------- */
  await p.click('.note-tool[data-cmd="symbol"]');
  await p.waitForSelector('#note-symbol-panel button', { timeout: 3000 });
  const anker = await p.evaluate(() => {
    const panel = document.getElementById('note-symbol-panel');
    const knapp = document.querySelector('.note-tool[data-cmd="symbol"]');
    const pr = panel.getBoundingClientRect();
    const kr = knapp.getBoundingClientRect();
    return {
      fast: getComputedStyle(panel).position === 'fixed',
      under: pr.top >= kr.bottom - 1,
      // Midtstilt på knappen, eller klemt inn mot en kant.
      avvik: Math.round(Math.abs((pr.left + pr.right) / 2 - (kr.left + kr.right) / 2)),
      innenfor: pr.left >= -1 && pr.right <= window.innerWidth + 1 &&
                pr.top >= -1 && pr.bottom <= window.innerHeight + 1,
      klemt: Math.round(pr.left) <= 10 || Math.round(pr.right) >= window.innerWidth - 10,
    };
  });
  log(navn + ': symbolpanelet henger under knappen og holder seg innenfor skjermen',
    anker.fast && anker.under && anker.innenfor && (anker.avvik <= 4 || anker.klemt),
    JSON.stringify(anker));
  await p.keyboard.press('Escape');
  await p.click('#note-back');
  await editorLukket(p);

  /* ---------- 21. Editoren er festet til det SYNLIGE feltet ---------- */
  const festet = await p.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('note-editor'));
    const root = getComputedStyle(document.documentElement);
    return {
      top: cs.top,
      // Verdiene finnes som tokens uansett om nettleseren har visualViewport.
      h: root.getPropertyValue('--viewport-h').trim(),
      t: root.getPropertyValue('--viewport-top').trim(),
      inset: root.getPropertyValue('--keyboard-inset').trim(),
      sporet: typeof window.visualViewport === 'undefined' ||
        root.getPropertyValue('--viewport-h').trim() !== '100dvh',
    };
  });
  log(navn + ': editoren festes til det synlige feltet (mobiltastaturet)',
    festet.h.length > 0 && festet.t.length > 0 && festet.inset.length > 0 && festet.sporet,
    JSON.stringify(festet));

  /* ---------- 22. Forelder-invarianten: notatboken bestemmer bokhyllen ---------- */
  /* «En annen enhet» flytter NOTATBOKEN til en ny bokhylle. Serveren (og
     mock-backenden, som speiler den) tar notatene med seg; klienten skal lese
     det samme, ikke bli stående med et notat i en bokhylle notatboken har
     forlatt — den bokhyllen kan slettes, og `project_id` er ON DELETE CASCADE. */
  await p.evaluate(() => {
    const H = window.__huskis;
    // Legg først notatet i notatboken, og la det synke.
    const n = H.notesIn(H.state.activeProject, null)[0];
    const f = H.state.noteProjects[0].folders[0];
    n.folder = f.id;
    n.posTs = Date.now() + 1000;
    n.posOrg = 'denne-enheten';
    H.save();
  });
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db') || '{}');
    return (db.notes || []).some((n) => n.folder_id);
  }, null, { timeout: 10000, polling: 200 });
  const flyttet = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('hk-mock-db'));
    const nyBokhylle = 'aaaa0000-0000-4000-8000-00000000f001';
    db.note_projects.push({
      id: nyBokhylle, owner_id: 'u1', name: 'Ny bokhylle', collapsed: false, trashed: false,
      ts: Date.now() + 5000, org: 'annen-enhet', pos: 9,
      pos_ts: Date.now() + 5000, pos_org: 'annen-enhet',
    });
    const bok = db.note_folders[0];
    bok.project_id = nyBokhylle;
    bok.pos_ts = Date.now() + 5000;
    bok.pos_org = 'annen-enhet';
    // Serveren kaskaderer til notatene (note_folders_cascade); her gjør vi det
    // samme, slik en ekte runde ville sett ut.
    db.notes.forEach((n) => {
      if (n.folder_id !== bok.id) return;
      n.project_id = nyBokhylle;
      n.pos_ts = bok.pos_ts;
      n.pos_org = bok.pos_org;
    });
    localStorage.setItem('hk-mock-db', JSON.stringify(db));
    return { nyBokhylle, bok: bok.id };
  });
  await p.evaluate(() => window.__huskis.cloudCycle());
  await p.waitForFunction((id) => window.__huskis.state.noteProjects.some((x) => x.id === id),
    flyttet.nyBokhylle, { timeout: 10000, polling: 200 });

  /* Og SERVERREGELEN selv: `(pos_ts, pos_org)` er ETT register — hele paret
     velges atomisk når en notatbok flyttes, aldri tidsstempelet fra det ene og
     `org` fra det andre. Mock-backenden speiler note_folders_cascade, og her
     kjøres den gjennom sin egen skrivevei (`update`), ikke gjennom en håndlagd
     kopi i localStorage. */
  const register = await p.evaluate(async () => {
    const c = window.HK_MOCK.createClient();
    const db = window.HK_MOCK._loadDB();
    const bok = db.note_folders[0];
    if (!bok) return { hoppet: true };
    /* Notatbokens NYE register må være nyere enn dens eget, ellers avviser
       felt-LWW-en flyttingen før kaskaden i det hele tatt blir aktuell. */
    const stempel = (bok.pos_ts || 0) + 1000;
    // Tre notater i den samme notatboken: eldre, nyere og uavgjort register.
    const lag = (id, ts, org) => ({
      id, owner_id: 'u1', project_id: bok.project_id, folder_id: bok.id,
      title: id, body: { v: 1, blocks: [] }, trashed: false,
      ts: 1, org: 'a', pos: 0, pos_ts: ts, pos_org: org,
    });
    db.notes.push(lag('aaaa0000-0000-4000-8000-00000000e001', stempel - 100, 'a'));
    db.notes.push(lag('aaaa0000-0000-4000-8000-00000000e002', stempel + 100, 'm'));
    db.notes.push(lag('aaaa0000-0000-4000-8000-00000000e003', stempel, 'b'));
    const nyId = 'aaaa0000-0000-4000-8000-00000000f002';
    db.note_projects.push({
      id: nyId, owner_id: 'u1', name: 'Enda en bokhylle', collapsed: false, trashed: false,
      ts: 1, org: 'a', pos: 20, pos_ts: 1, pos_org: 'a',
    });
    window.HK_MOCK._saveDB(db);
    // Notatbokens eget register: `stempel` med org 'z'.
    await c.from('note_folders').update({
      project_id: nyId, pos: bok.pos, pos_ts: stempel, pos_org: 'z',
    }).eq('id', bok.id);
    const etter = window.HK_MOCK._loadDB();
    const hent = (id) => etter.notes.find((n) => n.id === id);
    return {
      eldre: hent('aaaa0000-0000-4000-8000-00000000e001'),
      nyere: hent('aaaa0000-0000-4000-8000-00000000e002'),
      likt: hent('aaaa0000-0000-4000-8000-00000000e003'),
      nyId, stempel,
    };
  });
  const regKort = (n) => (n ? n.pos_ts + '/' + n.pos_org + '@' + (n.project_id || '').slice(-4) : 'mangler');
  log(navn + ': posisjonsregisteret flyttes som ETT par, aldri halvt',
    !!register.eldre &&
    // eldre register → BEGGE feltene byttes til notatbokens
    register.eldre.pos_ts === register.stempel && register.eldre.pos_org === 'z' &&
    // nyere register → BEGGE feltene beholdes
    register.nyere.pos_ts === register.stempel + 100 && register.nyere.pos_org === 'm' &&
    // likt stempel → `org` bryter uavgjorten, og paret følger vinneren
    register.likt.pos_ts === register.stempel && register.likt.pos_org === 'z' &&
    // … og bokhyllen følger notatboken uansett hvem som vant registeret
    [register.eldre, register.nyere, register.likt].every((n) => n.project_id === register.nyId),
    [register.eldre, register.nyere, register.likt].map(regKort).join(' | ') +
      ' (notatbok ' + register.stempel + '/z)');
  const konsistent = await p.evaluate(() => {
    const H = window.__huskis;
    const mappeAv = {};
    H.state.noteProjects.forEach((pr) => (pr.folders || []).forEach((f) => { mappeAv[f.id] = f.project; }));
    const uenige = H.state.notes.filter((n) => n.folder && mappeAv[n.folder] &&
      mappeAv[n.folder] !== n.project);
    return { uenige: uenige.length, bokhyller: H.state.noteProjects.length,
             notater: H.state.notes.map((n) => ({ f: !!n.folder, p: n.project })) };
  });
  log(navn + ': ingen notater er igjen i en bokhylle notatboken har forlatt',
    konsistent.uenige === 0 && konsistent.bokhyller === 2, JSON.stringify(konsistent));

  log(navn + ': ingen JS-feil', errs.length === 0, errs.join(' | ') || 'ingen');
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
