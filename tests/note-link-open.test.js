/*
  Regresjonstest: Å ÅPNE EN LENKE I ET NOTAT — appens ENE vei ut av seg selv.

  Autoritativt: docs/domains-and-urls.md («Lenker i notater») og
  docs/mobilapp-plan.md («Eksterne lenker»). Kort: en lenke i et notat er
  MERKET TEKST med adressen i `data-url`, ikke et anker, og åpningen går
  gjennom ÉN funksjon — `openExternalUrl()` → `safeNoteUrl()` →
  `window.open(url, '_blank', 'noopener')`. Den er den samme i nettleseren og i
  mobilskallet, der `window.open` blir en vanlig navigasjon som Capacitors
  ruting sender ut som `ACTION_VIEW`.

  Dekker:
    1. Lenke-panelets «Åpne» åpner adressen i en NY kontekst — appens egen side
       står igjen uendret — og panelet lukkes etterpå
    2. `Cmd/Ctrl`-klikk på en lenke i et REDIGERBART notat går rett ut, og
       åpner ikke panelet
    3. Et vanlig klikk i et redigerbart notat åpner PANELET (ikke adressen):
       der er lenken noe man redigerer
    4. Skjemavakten: `javascript:`, `data:`, `blob:` og en tom adresse åpner
       ingenting og gir en beskjed; `http:`, `https:` og `mailto:` slipper
       gjennom. Målt på `openExternalUrl` selv, som svarer true/false — et
       `mailto:` åpner ingen side å lese
    5. Adressen normaliseres PÅ NYTT i åpningen: en `data-url` som mot
       formodning skulle bære et farlig skjema, åpnes ikke
    6. Ingen `<a href>` og ingen `target="_blank"` kommer inn i DOM-et av
       dette — invarianten i docs/domains-and-urls.md står
    7. Lenken er `role="link"`, og den er tabbstopp KUN i et skrivebeskyttet
       notat: der er verktøylinjen borte, så panelet er ikke en vei til
       adressen. `Enter` på den åpner
    8. Escape i lenke-panelet lukker BARE panelet — ikke hele editoren
       (regresjon: feltets egen Escape-lytter lukket panelet, hendelsen boblet
       videre, og editorens lytter så to lukkede paneler og lukket bildet)

  Den eneste ruteinngripen i suiten står her, og med vilje: testen skal bevise
  at appen faktisk sender nettleseren til en FREMMED adresse, og den adressen
  kan ikke være ekte utgående nett i CI. `context.route` svarer på
  `https://eksempel.test/*` med en tom side, slik at den nye fanens URL er
  nøyaktig den appen ba om. Mock-backenden er uendret hermetikk som ellers.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/note-link-open.test.js
*/
const path = require('path');
const { chromium } = require(path.join(process.env.NODE_PATH ||
  require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));

const BASE = process.env.HUSKIS_URL || 'http://localhost:8000';
const results = [];
const log = (n, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n + (x ? '  [' + x + ']' : '')); };

const U = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

const MÅL = 'https://eksempel.test/side';

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

/* Ett notat med to lenker: én https og én mailto. */
async function byggNotat(p, mål) {
  return p.evaluate((adresse) => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const proj = H.addNoteProject();
    proj.name = 'Fagstoff';
    H.setActiveProject(proj.id);
    H.setActiveNoteFolder(null);
    const n = H.addNote();
    H.closeNoteEditor();
    n.title = 'Blodprøver';
    n.doc = { v: 1, blocks: [
      { t: 'p', c: [{ s: 'Se ' }, { s: 'håndboken', url: adresse }, { s: ' for referanseområder.' }] },
      { t: 'p', c: [{ s: 'Skriv til ' }, { s: 'laben', url: 'mailto:lab@example.com' }] },
    ] };
    H.save();
    H.renderNotes();
    return { proj: proj.id, note: n.id };
  }, mål);
}

const editorÅpen = (p) => p.waitForFunction(() => !document.getElementById('note-editor').hidden,
  null, { timeout: 5000, polling: 50 });

/* Destinasjoner utenfor eget origin i det FERDIGE DOM-et — samme revisjon som
   tests/external-links.test.js gjør, her kjørt i den tilstanden bare denne
   testen kommer i (editor med et notat som HAR lenker, og panelet åpent). */
const utgående = (p) => p.evaluate(() => {
  const her = location.origin;
  const ut = [];
  document.querySelectorAll('*').forEach((el) => {
    for (const a of ['href', 'action', 'formaction']) {
      if (!el.hasAttribute(a)) continue;
      let o = 'ugyldig';
      try { o = new URL(el.getAttribute(a), document.baseURI).origin; } catch (e) { /* ugyldig */ }
      if (o !== her) ut.push(el.tagName.toLowerCase() + '[' + a + '] ' + el.getAttribute(a));
    }
    if (/_blank/i.test(el.getAttribute('target') || '')) ut.push(el.tagName.toLowerCase() + '[target=_blank]');
  });
  return ut;
});

async function run(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  /* Den ene ruteinngripen — se filhodet. Uten den ville den nye fanen prøvd å
     nå ekte nett og landet på en feilside, som ikke bærer adressen appen ba om. */
  await ctx.route('https://eksempel.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }));

  const p = await ctx.newPage();
  const feil = [];
  p.on('pageerror', (e) => feil.push(String(e)));
  const M = (t) => navn + ': ' + t;

  const { uid, db } = buildDB();
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

  const ids = await byggNotat(p, MÅL);
  await p.waitForTimeout(200);

  // Hver nye fane fanges opp; adressen er beviset på hva appen ba om.
  let nye = [];
  ctx.on('page', (np) => nye.push(np));
  const åpnet = async () => {
    /* FAST VENTING, med vilje: en ny browsing context er en hendelse fra
       nettleseren, og «ingen fane ble åpnet» kan bare påstås etter at én ville
       rukket å komme (tests/CLAUDE.md, «fraværsbevis»). */
    await p.waitForTimeout(600);
    const urler = [];
    for (const np of nye) { try { await np.waitForLoadState('domcontentloaded', { timeout: 3000 }); } catch (e) { /* uansett */ } urler.push(np.url()); }
    return urler;
  };
  // Rydder ETTER at etternølere har rukket å melde seg — ellers dukker en fane
  // fra forrige steg opp midt i målingen av det neste.
  const tømFaner = async () => {
    await åpnet();
    for (const np of nye) { try { await np.close(); } catch (e) { /* lukket */ } }
    nye = [];
  };

  await p.evaluate((id) => window.__huskis.openNoteEditor(id), ids.note);
  await editorÅpen(p);
  await p.waitForTimeout(200);

  /* ---------- 3. Vanlig klikk åpner PANELET, ikke adressen ---------- */
  await p.locator('#note-doc .note-link').first().click();
  await p.waitForTimeout(300);
  const etterKlikk = await p.evaluate(() => ({
    panel: !document.getElementById('note-link-panel').hidden,
    felt: document.getElementById('note-link-input').value,
  }));
  log(M('3: et vanlig klikk i et redigerbart notat åpner lenke-panelet med adressen'),
    etterKlikk.panel === true && etterKlikk.felt === MÅL, JSON.stringify(etterKlikk));
  log(M('3: … og åpner ingen ny kontekst'), (await åpnet()).length === 0, nye.length + ' faner');
  await tømFaner();

  /* ---------- 6. Ingen utgående destinasjon i DOM-et, panelet åpent ---------- */
  const dom = await utgående(p);
  log(M('6: ingen `<a href>`/`target="_blank"` i DOM-et — lenken er merket tekst'),
    dom.length === 0, dom.join(', ') || 'ingen');

  /* ---------- 7. Rolle og tabbrekkefølge ---------- */
  const lenkeAttr = await p.evaluate(() => [...document.querySelectorAll('#note-doc .note-link')]
    .map((el) => ({ role: el.getAttribute('role'), tab: el.getAttribute('tabindex'), url: el.dataset.url })));
  log(M('7: lenkene er `role="link"` og UTENFOR tabbrekkefølgen i et redigerbart notat'),
    lenkeAttr.length === 2 && lenkeAttr.every((l) => l.role === 'link' && l.tab === null),
    JSON.stringify(lenkeAttr));

  /* ---------- 1. «Åpne» i panelet ---------- */
  const førAdresse = p.url();
  await p.locator('#note-link-open').click();
  const urler = await åpnet();
  log(M('1: «Åpne» åpner adressen i en ny kontekst'),
    urler.length === 1 && urler[0] === MÅL, JSON.stringify(urler));
  log(M('1: appens egen side står igjen uendret'), p.url() === førAdresse, p.url());
  log(M('1: … og panelet lukkes etterpå'),
    await p.evaluate(() => document.getElementById('note-link-panel').hidden === true));
  await tømFaner();

  /* ---------- 2. Cmd/Ctrl-klikk går rett ut ---------- */
  await p.locator('#note-doc .note-link').first().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  const urler2 = await åpnet();
  log(M('2: Cmd/Ctrl-klikk på lenken går rett ut'),
    urler2.length === 1 && urler2[0] === MÅL, JSON.stringify(urler2));
  log(M('2: … og åpner ikke panelet'),
    await p.evaluate(() => document.getElementById('note-link-panel').hidden === true));
  await tømFaner();

  /* ---------- 4+5. Skjemavakten, målt på funksjonen selv ---------- */
  const skjema = await p.evaluate(() => {
    const H = window.__huskis;
    const prøv = (u) => { try { return H.openExternalUrl(u); } catch (e) { return 'kastet: ' + e; } };
    return {
      js: prøv('javascript:alert(1)'),
      jsSkjult: prøv('java script:alert(1)'),
      data: prøv('data:text/html,<script>1</script>'),
      blob: prøv('blob:https://eksempel.test/abc'),
      tom: prøv('   '),
      mailto: prøv('mailto:lab@example.com'),
      http: prøv('http://eksempel.test/x'),
      utenSkjema: prøv('eksempel.test/x'),
    };
  });
  log(M('4: `javascript:` (også med kontrolltegn), `data:`, `blob:` og tom adresse åpnes ALDRI'),
    skjema.js === false && skjema.jsSkjult === false && skjema.data === false
    && skjema.blob === false && skjema.tom === false, JSON.stringify(skjema));
  log(M('4: `http:`, `mailto:` og en adresse uten skjema slipper gjennom'),
    skjema.mailto === true && skjema.http === true && skjema.utenSkjema === true,
    JSON.stringify(skjema));
  await tømFaner();

  /* 5. Åpningen normaliserer PÅ NYTT: et `data-url` skrevet direkte i DOM-en
     (altså utenom `safeNoteUrl` på vei inn) skal fortsatt ikke kunne åpnes. */
  await p.evaluate(() => {
    document.querySelector('#note-doc .note-link').dataset.url = 'javascript:alert(2)';
  });
  await p.locator('#note-doc .note-link').first().click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  const urler3 = await åpnet();
  log(M('5: en `data-url` med farlig skjema åpnes ikke — åpningen normaliserer selv'),
    urler3.length === 0, JSON.stringify(urler3));
  await tømFaner();

  /* ---------- 8. Escape lukker BARE panelet ---------- */
  await p.evaluate(() => window.__huskis.runNoteCommand('link'));
  await p.waitForTimeout(300);
  log(M('8: lenke-panelet er åpent før Escape'),
    await p.evaluate(() => !document.getElementById('note-link-panel').hidden));
  await p.evaluate(() => document.getElementById('note-link-input').focus());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const etterEsc = await p.evaluate(() => ({
    panel: document.getElementById('note-link-panel').hidden,
    editor: document.getElementById('note-editor').hidden,
    fokus: document.activeElement.id,
  }));
  log(M('8: Escape lukker panelet og lar editoren stå — fokus tilbake i dokumentet'),
    etterEsc.panel === true && etterEsc.editor === false && etterEsc.fokus === 'note-doc',
    JSON.stringify(etterEsc));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  log(M('8: neste Escape lukker editoren'),
    await p.evaluate(() => document.getElementById('note-editor').hidden === true));

  /* ---------- 7b. Skrivebeskyttet notat: lenkene er tabbstopp ---------- */
  /* Låsen er mekanismen som lager en ren leser (docs/rettigheter-og-deling.md).
     Her holder det å låse bokhyllen fra serverens side og la synken bygge
     tilstanden om — eieren beholder redigeringsretten, så testen setter i
     stedet capability-en direkte på notatet, som er det editoren spør om. */
  await p.evaluate((id) => {
    const H = window.__huskis;
    const n = H.state.notes.find((x) => x.id === id);
    n._caps = Object.assign({}, n._caps, { editContent: false });
    H.openNoteEditor(id);
  }, ids.note);
  await editorÅpen(p);
  await p.waitForTimeout(300);
  const lesemodus = await p.evaluate(() => ({
    redigerbar: document.getElementById('note-doc').isContentEditable,
    verktøySkjult: document.getElementById('note-tools').hidden,
    tab: [...document.querySelectorAll('#note-doc .note-link')].map((el) => el.getAttribute('tabindex')),
  }));
  log(M('7b: et skrivebeskyttet notat gjør lenkene til tabbstopp (verktøylinjen er borte)'),
    lesemodus.redigerbar === false && lesemodus.verktøySkjult === true
    && lesemodus.tab.length === 2 && lesemodus.tab.every((t) => t === '0'),
    JSON.stringify(lesemodus));
  if (lesemodus.tab[0] === '0') {
    await p.evaluate(() => document.querySelector('#note-doc .note-link').focus());
    await p.keyboard.press('Enter');
    const urler4 = await åpnet();
    log(M('7b: `Enter` på en fokusert lenke åpner den'),
      urler4.length === 1 && urler4[0] === MÅL, JSON.stringify(urler4));
    await tømFaner();
    const ring = await p.evaluate(() => {
      const el = document.querySelector('#note-doc .note-link');
      el.focus();
      const cs = getComputedStyle(el);
      return { w: cs.outlineWidth, style: cs.outlineStyle };
    });
    log(M('7b: … og den fokuserte lenken har en synlig ring'),
      ring.style !== 'none' && parseFloat(ring.w) > 0, JSON.stringify(ring));
  }
  const domLese = await utgående(p);
  log(M('6b: heller ikke i lesemodus finnes en utgående destinasjon i DOM-et'),
    domLese.length === 0, domLese.join(', ') || 'ingen');

  log(M('ingen JS-feil'), feil.length === 0, feil.join(' | ') || 'ingen');
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
