/*
  Nettlesertest for UTKLIPPSTAVLEN I NOTATER (docs/notater-plan.md,
  «Utklippstavlen») — mot mock-backend (?mock=1).

  Poenget er INTEROPERABILITET, ikke hjelpefunksjonene: et notat skal komme
  helt ut av Huskis og inn i Word, Outlook, Google Docs, en Markdown-editor
  eller et hvilket som helst riktekstfelt — og tilbake igjen — uten at
  formatering går tapt og uten at noe fremmed følger med inn.

  Dekker:
    1. «Kopier alt» og «Kopier som Markdown» ligger i notatets VANLIGE
       objektmeny — på kortet og inne i editoren — og er tastaturnåbare
    2. «Kopier alt» skriver BÅDE `text/html` og `text/plain` i én skriving, og
       HTML-en har riktig semantisk markup for hver støttet formatering
    3. Ingenting Huskis-internt lekker ut: ingen klasser, id-er,
       `data-*`-attributter, delingsinfo eller tidsstempler i noe av det som
       kopieres
    4. Farlige adresser blir ALDRI en aktiv lenke — teksten består
    5. HELE dokumentet kopieres, også når markeringen står midt inne i det
    6. Markdown-formen: overskrifter, avsnitt, lister, fet/kursiv, lenker,
       skillelinje — og understrek/hevet/senket som den inline-HTML-en
       Markdown selv tillater
    7. Randtilfellene: tomt notat, notat uten tittel, norske tegn og annen
       Unicode, og et langt dokument
    8. Fallback: uten `ClipboardItem` (og uten den gamle kopi-veien) faller
       kopieringen ned på ren tekst, og toasten sier fra
   8b. Kopiering tar med det autosaven har KØET, men ikke rukket å skrive
    9. Innliming fra Word, Google Docs, vanlig riktekst, lister, overskrifter,
       lenker og rotete/nøstet markup blir et GYLDIG Huskis-dokument
   10. Innliming er trygg: skript, `onclick`, `javascript:`-lenker, fremmed CSS
       og ukjent styling finnes ikke igjen — verken i dokumentet eller i DOM-et
   11. Markdown limt inn som ren tekst blir struktur; vanlig tekst blir det
       IKKE (en stjerne i et avsnitt betyr fortsatt en stjerne)
   12. Angre tar hele innlimingen tilbake i én operasjon

  Kjøres på BÅDE desktop- og mobil-viewport: kopieringen skjer fra en meny som
  plasserer seg ulikt, og innlimingen går gjennom editoren i begge.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-clipboard.test.js
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

function buildDB() {
  const uid = 'u1';
  const UA = U(), GA = U(), LA = U();
  const base = (x) => Object.assign({ trashed: false, archived: false, locked: false, unlocked: false,
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
      items: [], ideas: [], note_projects: [], note_folders: [], notes: [],
      memberships: [{ id: U(), user_id: uid, universe_id: UA, group_id: null, role: 'owner', pos: 0, created_at: 1 }],
      share_invites: [], tombstones: [],
    },
  };
}

/* Ett notat med ALT Huskis støtter, så hver konvertering måles på det samme
   dokumentet: overskrift 1–3, fet, kursiv, understrek, hevet, senket, lenke,
   punktliste, nummerert liste, skillelinje, linjeskift i en blokk — og en
   adresse som ALDRI skal bli en lenke. */
const RIKT_DOK = {
  v: 1,
  blocks: [
    { t: 'h1', c: [{ s: 'Første nivå' }] },
    { t: 'p', c: [{ s: 'Vanlig, ' }, { s: 'fet', b: 1 }, { s: ', ' }, { s: 'kursiv', i: 1 },
      { s: ', ' }, { s: 'understreket', u: 1 }, { s: ', x' }, { s: '2', sup: 1 },
      { s: ' og H' }, { s: '2', sub: 1 }, { s: 'O.' }] },
    { t: 'h2', c: [{ s: 'Andre nivå' }] },
    { t: 'p', c: [{ s: 'En ' }, { s: 'lenke', url: 'https://eksempel.no/side?a=1&b=2' },
      { s: ' og en ' }, { s: 'farlig', url: 'javascript:alert(1)' }, { s: '.' }] },
    { t: 'h3', c: [{ s: 'Tredje nivå' }] },
    { t: 'ul', items: [[{ s: 'punkt én' }], [{ s: 'punkt to', b: 1 }]] },
    { t: 'ol', items: [[{ s: 'først' }], [{ s: 'deretter' }]] },
    { t: 'hr' },
    { t: 'p', c: [{ s: 'Linje én\nLinje to' }] },
    { t: 'p', c: [{ s: 'Æ, ø, å — «sitat», 100 % og en emoji: 🐈' }] },
  ],
};

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

/* Et notat med et gitt dokument, uten å gå veien om editoren: editoren lukkes
   FØR innholdet settes, ellers ville autosaven skrevet det tomme arket over. */
async function nyttNotat(p, doc, tittel) {
  const id = await p.evaluate(({ doc, tittel }) => {
    const H = window.__huskis;
    const n = H.addNote();
    H.closeNoteEditor();
    const live = H.state.notes.find((x) => x.id === n.id);
    live.title = tittel;
    live.doc = H.sanitizeNoteDoc(doc);
    H.save();
    H.renderNotes();
    return n.id;
  }, { doc, tittel });
  await p.waitForFunction(() => document.getElementById('note-editor').hidden, null, { timeout: 5000, polling: 50 });
  return id;
}

// Radene i et objekts meny, funnet på id.
async function menyRader(p, sel) {
  await p.locator(sel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  const rader = await p.locator('#obj-menu-panel .obj-menu-row .obj-menu-label').allTextContents();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  return rader;
}

const lesUtklipp = (p) => p.evaluate(async () => {
  const ut = {};
  const items = await navigator.clipboard.read();
  for (const it of items) {
    for (const t of it.types) ut[t] = await (await it.getType(t)).text();
  }
  return ut;
});

/* Innliming skjer gjennom en EKTE `paste`-hendelse med de formatene et
   riktekstprogram faktisk legger på utklippstavlen. Editoren tømmes først, så
   hver sak måles for seg. */
async function limInn(p, html, tekst) {
  return p.evaluate(({ html, tekst }) => {
    const doc = document.getElementById('note-doc');
    const H = window.__huskis;
    doc.textContent = '';
    const tom = document.createElement('p');
    tom.appendChild(document.createElement('br'));
    doc.appendChild(tom);
    const r = document.createRange();
    r.selectNodeContents(tom);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    doc.focus();
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    if (tekst) dt.setData('text/plain', tekst);
    doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const d = H.noteDocFromEl(doc);
    return {
      blokker: d.blocks,
      typer: d.blocks.map((b) => b.t).join(','),
      tekst: H.noteDocText(d),
      // DOM-et etter innlimingen: her skal det ikke finnes noe fremmed.
      ankere: doc.querySelectorAll('a').length,
      skript: doc.querySelectorAll('script, style, iframe, object, embed, img').length,
      hendelser: [...doc.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => /^on/i.test(a.name))).length,
      fremmedeKlasser: [...doc.querySelectorAll('[class]')]
        .map((el) => el.getAttribute('class'))
        .filter((c) => c !== 'note-link').length,
    };
  }, { html, tekst });
}

const GYLDIG = (typer) => typer.split(',').filter(Boolean).every((t) => /^(p|h1|h2|h3|ul|ol|hr)$/.test(t));

async function run(navn, viewport, touch) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport },
    touch ? { isMobile: true, hasTouch: true } : {}));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const { db, uid } = buildDB();
  await seed(p, db, uid);

  await p.evaluate(() => {
    const H = window.__huskis;
    H.setMainTab('notes');
    const pr = H.addNoteProject('Bokhylla');
    H.setActiveProject(pr.id);
  });
  const id = await nyttNotat(p, RIKT_DOK, 'Tittelen på notatet');
  const sel = '.note-card[data-id="' + id + '"]';

  /* ---------- 1. Radene ligger i den vanlige objektmenyen ---------- */
  const rader = await menyRader(p, sel);
  log(navn + ' 1: notatkortets meny har «Kopier alt» og «Kopier som Markdown»',
    rader.some((r) => /^Kopier alt$/.test(r)) && rader.some((r) => /^Kopier som Markdown$/.test(r)),
    rader.join(' | '));

  // Tastatur: menyknappen fokuseres og aktiveres uten mus, og raden nås med
  // piltastene — som resten av menyen (docs/tilgjengelighet.md).
  const tast = await p.evaluate(async (sel) => {
    const btn = document.querySelector(sel + ' .obj-menu-btn');
    btn.focus();
    const fokusertFør = document.activeElement === btn;
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const rader = [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')];
    const i = rader.findIndex((r) => /Kopier alt/.test(r.textContent));
    return { fokusertFør, funnet: i, fokuserbar: i > -1 && rader[i].tabIndex >= 0 };
  }, sel);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  log(navn + ' 1: menyknappen og kopieringsraden er tastaturnåbare',
    tast.fokusertFør && tast.funnet > -1 && tast.fokuserbar, JSON.stringify(tast));

  // Den samme menyen finnes INNE i editoren.
  const iEditor = await p.evaluate(async (id) => {
    const H = window.__huskis;
    H.openNoteEditor(id);
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('note-menu-btn').click();
    await new Promise((r) => setTimeout(r, 250));
    const rader = [...document.querySelectorAll('#obj-menu-panel .obj-menu-label')].map((x) => x.textContent);
    return rader;
  }, id);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  log(navn + ' 1: den samme menyen finnes inne i editoren',
    iEditor.some((r) => /Kopier alt/.test(r)) && iEditor.some((r) => /Kopier som Markdown/.test(r)),
    iEditor.join(' | '));

  /* ---------- 2. «Kopier alt» skriver begge formatene ----------
     Markeringen settes MIDT i dokumentet først: kopieringen skal ta hele
     notatet uansett hvor markøren står. */
  const midt = await p.evaluate(() => {
    const doc = document.getElementById('note-doc');
    const blokk = doc.querySelectorAll('h2')[0] || doc.children[1];
    const r = document.createRange();
    r.selectNodeContents(blokk);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return (s.toString() || '').trim();
  });
  const hvordan = await p.evaluate((id) => window.__huskis.copyNoteAll(id), id);
  const utklipp = await lesUtklipp(p);
  const html = utklipp['text/html'] || '';
  const ren = utklipp['text/plain'] || '';
  log(navn + ' 2: kopieringen skriver både text/html og text/plain',
    hvordan === 'rich' && !!html && !!ren, hvordan + ' — ' + Object.keys(utklipp).join(', '));
  log(navn + ' 2: HTML-en har riktig semantisk markup for hver støttet formatering',
    /<h1>Tittelen på notatet<\/h1>/.test(html) &&
    /<h1>Første nivå<\/h1>/.test(html) && /<h2>Andre nivå<\/h2>/.test(html) &&
    /<h3>Tredje nivå<\/h3>/.test(html) &&
    /<strong>fet<\/strong>/.test(html) && /<em>kursiv<\/em>/.test(html) &&
    /<u>understreket<\/u>/.test(html) && /<sup>2<\/sup>/.test(html) &&
    /<sub>2<\/sub>/.test(html) &&
    /<ul><li>punkt én<\/li><li><strong>punkt to<\/strong><\/li><\/ul>/.test(html) &&
    /<ol><li>først<\/li><li>deretter<\/li><\/ol>/.test(html) &&
    /<hr>/.test(html) && /Linje én<br>Linje to/.test(html),
    html.slice(0, 220));
  log(navn + ' 2: lenken blir et vanlig anker, med adressen escapet',
    /<a href="https:\/\/eksempel\.no\/side\?a=1&amp;b=2">lenke<\/a>/.test(html),
    (html.match(/<a [^>]*>/g) || []).join(' '));
  log(navn + ' 2: den rene teksten har hele notatet, med kulepunkt og nummer',
    /^Tittelen på notatet\n\n/.test(ren) && /• punkt én/.test(ren) &&
    /1\. først/.test(ren) && /2\. deretter/.test(ren) &&
    /Linje én\nLinje to/.test(ren) && /🐈/.test(ren),
    JSON.stringify(ren.slice(0, 120)));
  log(navn + ' 2: markeringen sto midt i dokumentet, og hele notatet ble likevel kopiert',
    /Andre nivå/.test(midt) && /Første nivå/.test(ren) && /Æ, ø, å/.test(ren),
    'markert: ' + JSON.stringify(midt));

  /* ---------- 2b. EKTE copy → paste mot et vanlig riktekstfelt ----------
     Beviset for at interoperabiliteten faktisk virker, ikke bare at strengen
     ble skrevet: utklippstavlen limes inn i et helt vanlig `contenteditable`
     med nettleserens egen innliming (Ctrl/Cmd+V), slik Word, Outlook og
     Google Docs tar imot den. Feltet er en midlertidig node UTENFOR appen, og
     ryddes bort igjen. */
  const rundtur = await p.evaluate(async () => {
    const felt = document.createElement('div');
    felt.id = 'hk-test-rikttekst';
    felt.contentEditable = 'true';
    document.body.appendChild(felt);
    felt.focus();
    return !!document.activeElement && document.activeElement.id === 'hk-test-rikttekst';
  });
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await p.waitForTimeout(300);
  const limt = await p.evaluate(() => {
    const felt = document.getElementById('hk-test-rikttekst');
    const ut = {
      fet: felt.querySelectorAll('strong, b').length,
      kursiv: felt.querySelectorAll('em, i').length,
      understrek: felt.querySelectorAll('u').length,
      hevet: felt.querySelectorAll('sup').length,
      senket: felt.querySelectorAll('sub').length,
      overskrifter: felt.querySelectorAll('h1, h2, h3').length,
      lister: felt.querySelectorAll('ul, ol').length,
      lenker: [...felt.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      tekst: felt.innerText,
    };
    felt.remove();
    return ut;
  });
  log(navn + ' 2b: en EKTE innliming i et vanlig riktekstfelt beholder formateringen',
    rundtur && limt.fet >= 1 && limt.kursiv >= 1 && limt.understrek >= 1 &&
    limt.hevet >= 1 && limt.senket >= 1 && limt.overskrifter >= 3 && limt.lister >= 2 &&
    limt.lenker.length === 1 && /eksempel\.no/.test(limt.lenker[0]) &&
    /Blåbær|Æ, ø, å/.test(limt.tekst),
    JSON.stringify(Object.assign({}, limt, { tekst: limt.tekst.slice(0, 60) })));

  /* ---------- 3. Ingenting Huskis-internt lekker ut ---------- */
  const lekkasje = [html, ren].map((s) => ({
    klasser: /class\s*=/i.test(s),
    dataAttr: /data-[a-z-]+\s*=/i.test(s),
    idAttr: /\bid\s*=/i.test(s),
    noteLink: /note-link/.test(s),
    objektId: s.indexOf(id) > -1,
    metadata: /"ts"|"org"|_caps|posTs|owner_id/.test(s),
    skript: /<script|onclick|javascript:/i.test(s),
  }));
  log(navn + ' 3: verken HTML-en eller teksten bærer klasser, id-er, data-attributter eller metadata',
    lekkasje.every((x) => Object.keys(x).every((k) => x[k] === false)),
    JSON.stringify(lekkasje));

  /* ---------- 4. Farlige adresser blir aldri en aktiv lenke ---------- */
  const farlig = await p.evaluate(() => {
    const H = window.__huskis;
    // Adressene tvinges HELT rått inn i modellen, forbi normaliseringen, slik
    // at det er serialiseringen selv som må stå imot.
    const doc = { v: 1, blocks: [{ t: 'p', c: [
      { s: 'js', url: 'javascript:alert(1)' },
      { s: ' data', url: 'data:text/html,<script>alert(1)</script>' },
      { s: ' vbs', url: 'vbscript:msgbox(1)' },
      { s: ' fil', url: 'file:///etc/passwd' },
    ] }] };
    return {
      html: H.noteDocToHtml(doc, ''),
      md: H.noteDocToMarkdown(doc, ''),
      plain: H.noteDocToPlain(doc, ''),
    };
  });
  log(navn + ' 4: farlige adresser eksporteres aldri som lenker — teksten består',
    !/<a /i.test(farlig.html) && !/javascript:|data:|vbscript:|file:/i.test(farlig.html + farlig.md) &&
    /js data vbs fil/.test(farlig.html) && /js data vbs fil/.test(farlig.md) &&
    /js data vbs fil/.test(farlig.plain),
    JSON.stringify(farlig));

  /* ---------- 5. og 6. Markdown ---------- */
  const md = await p.evaluate(async (id) => {
    const hvordan = await window.__huskis.copyNoteMarkdown(id);
    return { hvordan, tekst: await navigator.clipboard.readText() };
  }, id);
  log(navn + ' 6: «Kopier som Markdown» legger ryddig Markdown på utklippstavlen',
    md.hvordan === 'plain' &&
    /^# Tittelen på notatet\n\n/.test(md.tekst) &&
    /\n# Første nivå\n/.test(md.tekst) && /\n## Andre nivå\n/.test(md.tekst) &&
    /\n### Tredje nivå\n/.test(md.tekst) &&
    /\*\*fet\*\*/.test(md.tekst) && /\*kursiv\*/.test(md.tekst) &&
    /- punkt én\n- \*\*punkt to\*\*/.test(md.tekst) &&
    /1\. først\n2\. deretter/.test(md.tekst) &&
    /\n---\n/.test(md.tekst) &&
    /\[lenke\]\(https:\/\/eksempel\.no\/side\?a=1&b=2\)/.test(md.tekst),
    JSON.stringify(md.tekst.slice(0, 160)));
  log(navn + ' 6: understrek, hevet og senket får den inline-HTML-en Markdown tillater',
    /<u>understreket<\/u>/.test(md.tekst) && /<sup>2<\/sup>/.test(md.tekst) &&
    /<sub>2<\/sub>/.test(md.tekst),
    (md.tekst.match(/<[a-z]+>[^<]*<\/[a-z]+>/g) || []).join(' '));
  log(navn + ' 6: Markdown-en bærer ingen Huskis-interne detaljer',
    !/class=|data-|note-link/.test(md.tekst) && md.tekst.indexOf(id) === -1,
    md.tekst.length + ' tegn');

  /* ---------- 7. Randtilfellene ---------- */
  const rand = await p.evaluate(() => {
    const H = window.__huskis;
    const tom = H.emptyNoteDoc();
    const langt = { v: 1, blocks: [] };
    for (let i = 0; i < 400; i++) langt.blocks.push({ t: 'p', c: [{ s: 'Avsnitt ' + i + ' — æøå' }] });
    const uni = { v: 1, blocks: [{ t: 'p', c: [{ s: 'Тест 中文 🐈‍⬛ «Blåbærsyltetøy» — 100 %' }] }] };
    return {
      tomHtml: H.noteDocToHtml(tom, ''),
      tomMd: H.noteDocToMarkdown(tom, ''),
      tomPlain: H.noteDocToPlain(tom, ''),
      tomMedTittel: H.noteDocToHtml(tom, 'Bare tittel'),
      utenTittel: H.noteDocToMarkdown({ v: 1, blocks: [{ t: 'h2', c: [{ s: 'Rett på' }] }] }, ''),
      langtSiste: H.noteDocToPlain(langt, '').split('\n').pop(),
      langtLinjer: H.noteDocToPlain(langt, '').split('\n').length,
      uniHtml: H.noteDocToHtml(uni, ''),
      uniMd: H.noteDocToMarkdown(uni, ''),
    };
  });
  log(navn + ' 7: et tomt notat gir tomme, men gyldige utklipp — og en tittel alene blir en overskrift',
    rand.tomHtml === '' && rand.tomMd === '' && rand.tomPlain === '' &&
    rand.tomMedTittel === '<h1>Bare tittel</h1>', JSON.stringify(rand.tomMedTittel));
  log(navn + ' 7: et notat uten tittel starter rett på innholdet',
    rand.utenTittel === '## Rett på', JSON.stringify(rand.utenTittel));
  log(navn + ' 7: et langt dokument kommer komplett ut',
    rand.langtLinjer === 400 && rand.langtSiste === 'Avsnitt 399 — æøå', rand.langtSiste);
  log(navn + ' 7: norske tegn og annen Unicode overlever begge formatene',
    /Тест 中文 🐈‍⬛ «Blåbærsyltetøy» — 100 %/.test(rand.uniHtml) &&
    /Тест 中文 🐈‍⬛ «Blåbærsyltetøy» — 100 %/.test(rand.uniMd), rand.uniMd);

  /* ---------- 8. Fallback der plattformen ikke kan riktekst ---------- */
  const fall = await p.evaluate(async (id) => {
    const ekte = window.ClipboardItem;
    const ekteExec = document.execCommand;
    // En plattform UTEN ClipboardItem, og der den gamle kopi-veien svarer nei.
    delete window.ClipboardItem;
    document.execCommand = function (cmd) {
      if (cmd === 'copy') return false;
      return ekteExec.apply(document, arguments);
    };
    let hvordan = '';
    try { hvordan = await window.__huskis.copyNoteAll(id); }
    finally { window.ClipboardItem = ekte; document.execCommand = ekteExec; }
    const toast = document.querySelector('#toast .toast-msg');
    return { hvordan, toast: toast ? toast.textContent : '', tekst: await navigator.clipboard.readText() };
  }, id);
  log(navn + ' 8: uten riktekst-støtte kopieres notatet som ren tekst, og toasten sier fra',
    fall.hvordan === 'plain' && /ren tekst/i.test(fall.toast) &&
    /Tittelen på notatet/.test(fall.tekst) && /punkt én/.test(fall.tekst),
    JSON.stringify({ hvordan: fall.hvordan, toast: fall.toast }));

  /* ---------- 8b. Kopiering tar det som står på skjermen NÅ ----------
     Autosaven har en pause på et halvsekund. Kopieres notatet i mellomtiden,
     skal den siste setningen likevel være med: `copyNoteAll` tømmer køen
     først når editoren står i det notatet. */
  const fersk = await p.evaluate(async (id) => {
    const H = window.__huskis;
    H.openNoteEditor(id);
    await new Promise((r) => setTimeout(r, 200));
    const doc = document.getElementById('note-doc');
    doc.focus();
    const blokk = document.createElement('p');
    blokk.appendChild(document.createTextNode('Skrevet akkurat nå'));
    doc.appendChild(blokk);
    doc.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'å' }));
    // Autosaven er KØET, ikke kjørt: notatet i tilstanden vet ennå ingenting.
    const rakk = JSON.stringify((H.state.notes.find((n) => n.id === id) || {}).doc)
      .indexOf('Skrevet akkurat nå') === -1;
    await H.copyNoteAll(id);
    const tekst = await navigator.clipboard.readText();
    H.closeNoteEditor();
    await new Promise((r) => setTimeout(r, 200));
    return { rakk, tekst };
  }, id);
  log(navn + ' 8b: kopiering tar med det autosaven ikke har rukket å skrive ennå',
    fersk.rakk && /Skrevet akkurat nå/.test(fersk.tekst),
    JSON.stringify({ køetIkkeSkrevet: fersk.rakk, hale: fersk.tekst.slice(-40) }));

  /* ---------- 9.–11. Innliming ---------- */
  await p.evaluate(async (id) => {
    window.__huskis.openNoteEditor(id);
    await new Promise((r) => setTimeout(r, 200));
  }, id);
  await p.waitForFunction(() => !document.getElementById('note-editor').hidden, null, { timeout: 5000 });

  const enkel = await limInn(p,
    '<p>Hei <b>der</b> og <i>her</i></p><h2>En overskrift</h2>'
    + '<ul><li>ett</li><li>to</li></ul><ol><li>en</li></ol>'
    + '<p>Med <a href="https://eksempel.no/x">lenke</a>.</p>', 'Hei der');
  log(navn + ' 9: vanlig riktekst-HTML blir avsnitt, overskrift, lister og lenke',
    GYLDIG(enkel.typer) && enkel.typer === 'p,h2,ul,ol,p' &&
    JSON.stringify(enkel.blokker[0].c) === JSON.stringify([{ s: 'Hei ' }, { s: 'der', b: 1 }, { s: ' og ' }, { s: 'her', i: 1 }]) &&
    enkel.blokker[2].items.length === 2 &&
    enkel.blokker[4].c.some((r) => r.url === 'https://eksempel.no/x'),
    enkel.typer + ' — ' + JSON.stringify(enkel.blokker));
  log(navn + ' 9: … og editorens DOM er fortsatt uten anker, skript og fremmede klasser',
    enkel.ankere === 0 && enkel.skript === 0 && enkel.hendelser === 0 && enkel.fremmedeKlasser === 0,
    JSON.stringify(enkel));

  const word = await limInn(p,
    "<html xmlns:o='urn:schemas-microsoft-com:office:office'><head>"
    + '<style>p.MsoNormal{margin:0;font-family:Calibri}</style></head><body lang=NO>'
    + "<div class=WordSection1><p class=MsoNormal><span style='font-size:11.0pt'>Vanlig "
    + "<b style='mso-bidi-font-weight:normal'>fet</b> og "
    + "<span style='text-decoration:underline'>understreket</span><o:p></o:p></span></p>"
    + "<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'>"
    + "<span style='mso-list:Ignore'>&middot;<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp; </span></span>Punkt en</p>"
    + "<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'>"
    + "<span style='mso-list:Ignore'>&middot;<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp; </span></span>Punkt to</p>"
    + '</div></body></html>', 'Vanlig fet og understreket');
  log(navn + ' 9: Word beholder fet, understrek og kulepunktlista — og mister CSS-en sin',
    GYLDIG(word.typer) && word.typer === 'p,ul' &&
    word.blokker[0].c.some((r) => r.s === 'fet' && r.b) &&
    word.blokker[0].c.some((r) => r.s === 'understreket' && r.u) &&
    word.blokker[1].items.length === 2 &&
    !/Calibri|margin|MsoNormal/.test(word.tekst) && !/·/.test(word.tekst),
    word.typer + ' — ' + JSON.stringify(word.blokker));

  const gdocs = await limInn(p,
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">'
    + '<p dir="ltr" style="line-height:1.38;margin-top:0pt;">'
    + '<span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;">Vanlig og </span>'
    + '<span style="font-weight:700;">fet</span><span style="font-style:italic;">kursiv</span></p>'
    + '<ol style="margin-top:0"><li dir="ltr"><p dir="ltr"><span>ett</span></p></li>'
    + '<li><p><span>to</span></p></li></ol></b>', 'Vanlig og fetkursiv');
  log(navn + ' 9: Google Docs — `font-weight:700` blir fet, og innpakningens «normal» blir det IKKE',
    GYLDIG(gdocs.typer) && gdocs.typer === 'p,ol' &&
    JSON.stringify(gdocs.blokker[0].c) === JSON.stringify([{ s: 'Vanlig og ' }, { s: 'fet', b: 1 }, { s: 'kursiv', i: 1 }]) &&
    gdocs.blokker[1].items.length === 2 &&
    !gdocs.blokker[1].items.some((it) => it.some((r) => r.b)),
    gdocs.typer + ' — ' + JSON.stringify(gdocs.blokker));

  const rot = await limInn(p,
    '<div><div><span>løs tekst<div>i en div</div></span></div>'
    + '<table><tr><td>celle 1</td><td>celle 2</td></tr></table>'
    + '<ul><li>ytre<ul><li>indre</li></ul></li></ul>'
    + '<h7>ukjent tagg</h7><p style="font-family:Comic Sans MS;color:red;font-size:48px">stygg styling</p></div>',
    'rot');
  log(navn + ' 9: nøstet og rotete markup degraderes trygt til støttet struktur',
    GYLDIG(rot.typer) && /løs tekst/.test(rot.tekst) && /i en div/.test(rot.tekst) &&
    /celle 1\tcelle 2/.test(rot.tekst) && /ytre/.test(rot.tekst) && /indre/.test(rot.tekst) &&
    /ukjent tagg/.test(rot.tekst) && /stygg styling/.test(rot.tekst) &&
    !/Comic Sans|48px|red/.test(JSON.stringify(rot.blokker)),
    rot.typer + ' — ' + JSON.stringify(rot.tekst));

  const ondsinnet = await limInn(p,
    '<div onclick="alert(1)" onmouseover="alert(2)">'
    + '<script>window.__hkKapret = true;<\/script>'
    + '<style>body{display:none}</style>'
    + '<p>Trygg tekst med <a href="javascript:alert(3)">farlig lenke</a> '
    + '<a href="data:text/html,<h1>x">og en til</a> '
    + '<a href="https://ok.no/side">og en ekte</a></p>'
    + '<img src="x" onerror="alert(4)"><iframe src="https://fremmed.no"></iframe></div>',
    'Trygg tekst');
  const kapret = await p.evaluate(() => !!window.__hkKapret);
  log(navn + ' 10: skript, `on*`-attributter, `javascript:`/`data:`-lenker og fremmed CSS kommer aldri inn',
    GYLDIG(ondsinnet.typer) && !kapret &&
    ondsinnet.ankere === 0 && ondsinnet.skript === 0 && ondsinnet.hendelser === 0 &&
    !/alert|display:none|fremmed\.no/.test(JSON.stringify(ondsinnet.blokker)) &&
    !ondsinnet.blokker.some((b) => (b.c || []).some((r) => /javascript:|data:/i.test(r.url || ''))) &&
    ondsinnet.blokker[0].c.some((r) => r.url === 'https://ok.no/side') &&
    /farlig lenke/.test(ondsinnet.tekst),
    JSON.stringify(ondsinnet));

  const mdInn = await limInn(p, '',
    '# Overskrift\n\nEn **fet** og *kursiv* tekst med [lenke](https://x.no).\n\n'
    + '- ett\n- to\n\n1. først\n2. så\n\n---\n\n~~strøket~~ og `kode` og <u>under</u>');
  log(navn + ' 11: Markdown limt inn som ren tekst blir struktur',
    GYLDIG(mdInn.typer) && mdInn.typer === 'h1,p,ul,ol,hr,p' &&
    mdInn.blokker[1].c.some((r) => r.s === 'fet' && r.b) &&
    mdInn.blokker[1].c.some((r) => r.s === 'kursiv' && r.i) &&
    mdInn.blokker[1].c.some((r) => r.url === 'https://x.no/') &&
    mdInn.blokker[5].c.some((r) => r.s === 'under' && r.u) &&
    /strøket og kode/.test(mdInn.tekst),
    mdInn.typer + ' — ' + JSON.stringify(mdInn.blokker));

  /* Vanlig tekst limes inn som FØR: som tekst, der markøren står. Stjerner,
     bindestreker og tall blir stående som de tegnene de er. (Linjeskiftet blir
     en ny blokk — det er nettleserens egen `insertText`, uendret.) */
  const vanlig = await limInn(p, '', 'Et vanlig avsnitt med 2*3 = 6 og en e-post.\nAndre linje.');
  log(navn + ' 11: vanlig tekst blir IKKE tolket som Markdown',
    GYLDIG(vanlig.typer) && !/h1|h2|h3|ul|ol|hr/.test(vanlig.typer) &&
    /2\*3 = 6/.test(vanlig.tekst) && /Andre linje/.test(vanlig.tekst),
    vanlig.typer + ' — ' + JSON.stringify(vanlig.tekst));

  /* ---------- 12. Angre tar hele innlimingen ---------- */
  const angret = await p.evaluate(async () => {
    const H = window.__huskis;
    const doc = document.getElementById('note-doc');
    doc.textContent = '';
    const blokk = document.createElement('p');
    blokk.appendChild(document.createTextNode('før'));
    doc.appendChild(blokk);
    const r = document.createRange();
    r.selectNodeContents(blokk);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    doc.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', '<h2>limt</h2><p>inn</p>');
    doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const etter = H.noteDocText(H.noteDocFromEl(doc));
    H.runNoteCommand('undo');
    await new Promise((x) => setTimeout(x, 150));
    return { etter, angret: H.noteDocText(H.noteDocFromEl(doc)) };
  });
  log(navn + ' 12: angre tar innlimingen tilbake i én operasjon',
    /limt/.test(angret.etter) && !/limt/.test(angret.angret) && /før/.test(angret.angret),
    JSON.stringify(angret));

  log(navn + ': ingen JS-feil under løpet', errs.length === 0, errs.join(' | '));
  await browser.close();
}

(async () => {
  await run('desktop', { width: 1200, height: 900 }, false);
  await run('mobil', { width: 390, height: 780 }, true);
  const ok = results.filter(Boolean).length;
  console.log('\n==== ' + ok + '/' + results.length + ' PASS ====');
  process.exit(ok === results.length ? 0 : 1);
})();
