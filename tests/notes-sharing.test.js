/*
  Nettlesertest for DELING AV NOTATER (docs/rettigheter-og-deling.md del 14,
  docs/notater-plan.md) — mot mock-backenden (?mock=1).

  Dekker den klientvendte oppførselen SQL-testene ikke ser:
    1. «Deling og medlemmer» ligger i den VANLIGE objektmenyen på alle tre
       notatnivåene — ingen ny menytype — og hver rad i menyen er skilt fra
       naboen over seg, også der det ikke står en skuff imellom
    2. Delemodalen er den SAMME: medlemsliste med kategorier, invitasjonsfelt,
       rollevelger og «Forlat»/«Slett» etter serverens capabilities — og
       kroppen er fire seksjoner skilt av luft og en linje, ikke én ramse
    3. Eier / redaktør / REN LESER: låsen er det som lager leseren, og en leser
       får verken omdøping, sletting, ＋-knapper eller en skrivbar editor —
       men beholder «Kopier alt»/«Kopier som Markdown», som er lesing
    4. Deling DIREKTE på notatbok og notat: mottakeren ser objektet i den
       virtuelle «Delt med meg»-bokhyllen, og aldri navnet på bokhyllen over
    5. Tilbakekalling: objektet forsvinner ved neste synk, editoren lukkes, og
       en nøktern melding forklarer hva som skjedde
    6. En KOBLING til et notat man mister tilgang til blir stående (den
       ødelegges ikke), men kan ikke åpnes
    7. Ingen evig retry: en endring man ikke hadde rett til å gjøre rulles
       tilbake — BÅDE innholdet og posisjonen/forelderen
    8. En EKTE flytting ut av «Delt med meg» blir godtatt av serveren og
       skriver den nye plasseringen, ikke den gamle kanoniske
    9. Arkivering og sletting er ULIKE rettigheter i dra-og-slipp: et direkte
       medlem som kan redigere, men ikke slette for alle, får arkivmålet og
       ikke søppelkassen

  Kjøres på BÅDE desktop- og mobil-viewport.

  Kjør:
    python3 -m http.server 8000
    NODE_PATH=$(npm root -g) node tests/notes-sharing.test.js
*/
const { chromium } = require(require('path').join(process.env.NODE_PATH || require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const G = require('./dnd-gestures.js');
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
     D er eksplisitt EIER av notatboken F, uten rolle i bokhyllen — og har i
     tillegg sin EGEN bokhylle DP å flytte notatboken til.
     C har i tillegg sitt eget område CU og en kobling fra N1 til det. */
function buildDB() {
  const uA = 'uA', uB = 'uB', uC = 'uC', uD = 'uD';
  const P = U(), F = U(), N1 = U(), N2 = U(), CU = U(), LNK = U(), DP = U(), DF = U();
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
    ids: { uA, uB, uC, uD, P, F, N1, N2, CU, LNK, DP, DF },
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
      note_projects: [
        base({ id: P, owner_id: uA, name: 'Felles bokhylle' }),
        base({ id: DP, owner_id: uD, name: 'Dinas bokhylle' }),
      ],
      note_folders: [
        base({ id: F, owner_id: uA, project_id: P, name: 'Metode', pos: 7 }),
        base({ id: DF, owner_id: uD, project_id: DP, name: 'Dinas metode' }),
      ],
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
        mem(uD, { note_project_id: DP }, 'owner', 0),
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
/* Synk-runder til `pred` slår til. `cloudCycle()` no-op-er hvis en runde alt
   er i gang, og synk-pillen kan stå på «saved» før den nye runden har startet —
   et rått `await` på den er derfor IKKE et ferdig-signal (tests/CLAUDE.md).
   Vi venter på selve TILSTANDEN i stedet. */
async function sync(p, pred) {
  for (let i = 0; i < 15; i++) {
    await p.evaluate(() => window.__huskis.cloudCycle());
    await p.waitForTimeout(350);
    if (!pred) return true;
    if (await p.evaluate(pred)) return true;
  }
  return false;
}
/* Dra en NOTATBOK-rad over i et annet bokhyllekort — samme gest som
   `group-move.test.js` bruker på listesiden, mot notat-navigasjonens board.
   Auto-scrollen henter målet inn mens draget pågår, så pekeren holdes over
   målkortets «legg til»-rad i flere runder. */
async function dragNoteFolderTo(p, folderId, projectId) {
  const rad = '#notes-nav-board .item[data-id="' + folderId + '"]';
  await p.locator(rad).scrollIntoViewIfNeeded();
  await p.waitForTimeout(150);
  const a = await p.locator(rad).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 });
  await p.waitForTimeout(90);
  for (let i = 0; i < 14; i++) {
    const t = await p.locator('#notes-nav-board .card[data-id="' + projectId + '"] .add-item-row').boundingBox();
    await p.mouse.move(t.x + t.width / 2, t.y + 2, { steps: 5 });
    await p.waitForTimeout(80);
  }
  await p.mouse.up();
  await p.waitForTimeout(500);
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

  /* … og radene er SKILT fra hverandre. Notatmenyen er den lengste i appen —
     «Deling og medlemmer», «Lås», «Koblinger» og «Arkiver» står etter
     hverandre uten en eneste skuff imellom — og med linjer bare rundt skuffene
     rant nettopp de fire sammen til én blokk mens radene over dem sto hver for
     seg (docs/menus.md). Linjen måles som malt: enten `border-top` eller
     strøket i `::before`. */
  await p.locator(noteSel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  const skilt = await p.evaluate(() => {
    const linje = (el) => {
      const cs = getComputedStyle(el);
      if ((parseFloat(cs.borderTopWidth) || 0) > 0) return true;
      const b = getComputedStyle(el, '::before');
      return b.content !== 'none' && (parseFloat(b.height) || 0) > 0
        && b.backgroundColor !== 'rgba(0, 0, 0, 0)';
    };
    const rader = [...document.querySelectorAll('#obj-menu-panel .obj-menu-list > *')];
    return rader.map((el, i) => ({
      navn: (el.querySelector('.obj-menu-label') || {}).textContent || '(linje)',
      sep: el.classList.contains('obj-menu-sep'),
      // Første rad trenger ingen linje (hodet har sin egen), og heller ikke
      // raden rett etter `.obj-menu-sep` — den er allerede skilt av den.
      må: i > 0 && !el.classList.contains('obj-menu-sep')
        && !rader[i - 1].classList.contains('obj-menu-sep'),
      har: linje(el),
    }));
  });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const uskilt = skilt.filter((r) => r.må && !r.har);
  log(label + ' 1: … og hver rad i notatmenyen er skilt fra naboen over seg',
    skilt.length > 4 && uskilt.length === 0,
    JSON.stringify(uskilt.length ? uskilt : skilt.map((r) => r.navn)));

  /* HINTET ER FORBEHOLDT RADER SOM TRENGER EN SETNING. Det legger en linje til
     under etiketten og gjør raden halvannen gang så høy som naboene, så et
     tall («Koblinger» viste antallet der) eller en gjentakelse av etiketten
     («Arkiver» sa «Legges til side, ikke slettet») hører ikke hjemme i det.
     I notatmenyen er låseraden den ENESTE som har noe å forklare. */
  await p.locator(noteSel + ' .obj-menu-btn').first().click();
  await p.waitForTimeout(250);
  const hint = await p.evaluate(() => {
    const rad = (navn) => [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')]
      .find((r) => new RegExp(navn, 'i').test((r.querySelector('.obj-menu-label') || {}).textContent || ''));
    const les = (navn) => {
      const r = rad(navn);
      if (!r) return null;
      return { hint: !!r.querySelector('.obj-menu-hint'),
        teller: (r.querySelector('.obj-menu-count') || {}).textContent || null,
        h: Math.round(r.getBoundingClientRect().height) };
    };
    return { arkiver: les('^Arkiver'), koblinger: les('^Koblinger'),
      lås: les('^Lås'),
      // Hver hint-tekst i menyen, så POLICYEN kan prøves og ikke bare antallet:
      // et hint skal si noe etiketten ikke alt sier.
      hint: [...document.querySelectorAll('#obj-menu-panel .obj-menu-row')]
        .map((r) => {
          const h = r.querySelector('.obj-menu-hint');
          return h ? { rad: (r.querySelector('.obj-menu-label') || {}).textContent,
            tekst: h.textContent } : null;
        }).filter(Boolean) };
  });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  log(label + ' 1: «Arkiver» har ingen forklaringslinje, og er like høy som en vanlig rad',
    !!hint.arkiver && hint.arkiver.hint === false && hint.arkiver.h === 40,
    JSON.stringify(hint));
  log(label + ' 1: «Koblinger» er også en vanlig rad — antallet er ingen hintlinje',
    !!hint.koblinger && hint.koblinger.hint === false && hint.koblinger.h === 40,
    JSON.stringify(hint.koblinger));
  /* Hintet er FORBEHOLDT rader som trenger en setning: låsen, og de to
     kopieringsradene som skiller to utfall med nesten samme navn. Prøven er
     ikke ANTALLET — det vokser med nye rader — men om teksten sier noe
     etiketten ikke alt sier: aldri et blott tall, aldri ett ord. */
  const dårligeHint = hint.hint.filter((h) => /^\s*\d+\s*$/.test(h.tekst)
    || h.tekst.trim().split(/\s+/).length < 3);
  log(label + ' 1: … og hvert hint er en setning som forklarer, ikke et tall eller et ord',
    !!hint.lås && hint.lås.hint === true && hint.hint.length > 0 && dårligeHint.length === 0,
    JSON.stringify(dårligeHint.length ? dårligeHint : hint.hint));

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

  /* Kroppen er FIRE seksjoner, ikke én ramse: invitasjon, medlemmer, lås og de
     endelige knappene. De lå tidligere rett etter hverandre med det samme
     lille gapet som skiller to felt INNE i en seksjon, og modalen leste som én
     vegg av kontroller — verst på mobil (docs/design-system.md, «Del-modalen»).
     Grensen er luft PLUSS en linje, og den FØRSTE synlige seksjonen har ingen
     linje over seg: modalhodets egen ligger der allerede. */
  const seksjoner = await p.evaluate(() => {
    const kropp = document.getElementById('share-body');
    const synlige = [...kropp.children].filter((el) => !el.hidden
      && getComputedStyle(el).display !== 'none');
    const luft = parseFloat(getComputedStyle(kropp).getPropertyValue('--share-sec-gap')) || 0;
    return {
      luft,
      seksjoner: synlige.map((el) => {
        const cs = getComputedStyle(el);
        return {
          kl: el.className,
          linje: (parseFloat(cs.borderTopWidth) || 0) > 0,
          over: Math.round((parseFloat(cs.marginTop) || 0) + (parseFloat(cs.paddingTop) || 0)),
          // Luften INNE i seksjonen skal være mindre enn den MELLOM dem.
          inni: Math.round(parseFloat(cs.rowGap) || 0),
        };
      }),
    };
  });
  const s = seksjoner.seksjoner;
  log(label + ' 2: delemodalens kropp er fire seksjoner, hver med sin egen klasse',
    s.length === 4 && s.every((x) => /share-sec/.test(x.kl)), JSON.stringify(s));
  log(label + ' 2: … skilt av en linje og LIK luft, men ikke over den første',
    seksjoner.luft > 0 && s[0].linje === false && s[0].over === 0 &&
    s.slice(1).every((x) => x.linje === true && x.over === seksjoner.luft * 2),
    JSON.stringify(seksjoner));
  log(label + ' 2: … og luften inne i en seksjon er mindre enn den mellom dem',
    s.every((x) => x.inni < seksjoner.luft), JSON.stringify(s.map((x) => x.inni)));

  /* … OG SEKSJONENS POLSTRING ER HELE LUFTEN, på begge sider av linja.
     Boksavstanden var symmetrisk hele tiden (18/18); det som ikke var det, var
     luften slik den SES — bolk-overskriftens halve linjeavstand og siste
     medlemsrads bunnpolstring la seg oppå seksjonsgapet, så det ble 25 px
     under linja mot 18 over, og 28 over mot 19 under (MÅLT på skjermbilde).

     Glyfenes egne kanter kan ikke måles fra DOM-en — et Range over en tekst
     gir linjeboksen, ikke bokstavene — så sjekken går på det som GARANTERER
     lik luft i stedet: ingen boks helt ytterst i en seksjon legger til egen
     høyde utover seksjonens polstring. Overskriften har `line-height: 1` og
     klemmer derfor rundt teksten, og siste medlemsrad har ingen bunnpolstring
     å legge oppå gapet. */
  const kanter = await p.evaluate(() => {
    const kropp = document.getElementById('share-body');
    const synlige = (el) => [...el.children].filter((c) => !c.hidden
      && getComputedStyle(c).display !== 'none');
    const gjennomsiktig = (cs) => /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(cs.backgroundColor)
      && cs.backgroundImage === 'none';
    /* Usynlig luft i en boks: polstringen og den halve linjeavstanden over og
       under teksten. Har boksen en EGEN flate (låsraden, sletteknappen), er
       kanten dens ikke luft men blekk — da teller ingenting av det. */
    const luft = (el, side) => {
      const cs = getComputedStyle(el);
      if (!gjennomsiktig(cs)) return 0;
      const pad = parseFloat(side === 'top' ? cs.paddingTop : cs.paddingBottom) || 0;
      const lh = parseFloat(cs.lineHeight);
      const fs = parseFloat(cs.fontSize);
      // `normal` gir NaN og er nettopp tilfellet med udefinert luft — regn den
      // som nettleserens vanlige ~1.2 i stedet for å la den slippe unna.
      const linje = Number.isFinite(lh) ? lh : fs * 1.2;
      const bærerTekst = el.children.length === 0 && (el.textContent || '').trim();
      return Math.round(pad + (bærerTekst ? Math.max(0, linje - fs) / 2 : 0));
    };
    return synlige(kropp).map((el) => {
      const cs = getComputedStyle(el);
      const barn = synlige(el);
      if (!barn.length) return { kl: el.className, tom: true };
      return { kl: el.className,
        pad: [Math.round(parseFloat(cs.paddingTop)), Math.round(parseFloat(cs.paddingBottom))],
        ekstraTopp: luft(barn[0], 'top'),
        ekstraBunn: luft(barn[barn.length - 1], 'bottom') };
    });
  });
  log(label + ' 2: … og seksjonens polstring er hele luften — ingen kantboks legger til egen',
    kanter.length === 4 && kanter.every((x) => x.tom
      || (x.ekstraTopp <= 1 && x.ekstraBunn <= 1)),
    JSON.stringify(kanter));
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
  await sync(p, () => {
    const pr = (window.__huskis.state.noteProjects || [])[0];
    return !!pr && pr._locked === true;
  });
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
  /* KOPIERING ER LESING. En ren leser mister verktøylinjen og skriveretten,
     men skal fortsatt få hele notatet ut av Huskis: «Kopier alt» og «Kopier
     som Markdown» krever ingen skriverett (docs/notater-plan.md,
     «Utklippstavlen»). */
  await p.evaluate(() => window.__huskis.closeNotesNav());
  await p.waitForTimeout(300);
  await gotoFolder(p, ids.P, ids.F);
  const bLåstKopi = await menuRows(p, noteSel);
  log(label + ' 4: … men «Kopier alt» og «Kopier som Markdown» står igjen — det som kan leses, kan kopieres',
    bLåstKopi.some((r) => /^Kopier alt$/.test(r)) && bLåstKopi.some((r) => /^Kopier som Markdown$/.test(r)),
    bLåstKopi.join(' | '));
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
  /* En LOKAL endring gjort før låsen kom (autosaven rakk den ikke): den kan
     aldri lande, og skal derfor verken bli en evig push-løkke eller bli
     stående som en kopi som ser lagret ut. Serverens verdi vinner ved neste
     runde, og VÅRT doc slutter å avvike fra den. */
  await p.evaluate((id) => {
    const H = window.__huskis;
    const n = H.state.notes.find((x) => x.id === id);
    n.title = 'Skrevet før låsen'; n.ts = 9e12; n.org = 'b';
    H.save();
  }, ids.N1);
  const stopper = await sync(p, () => {
    const H = window.__huskis;
    const mine = H.docFromMyState().notes.find((x) => x.id === H.state.notes[0].id);
    const serv = H.contentDocFromMy(H.lastMy).notes.find((x) => x.id === mine.id);
    return JSON.stringify(mine) === JSON.stringify(serv);
  });
  const etterLås = await p.evaluate((id) => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    return { lokal: (window.__huskis.state.notes.find((x) => x.id === id) || {}).title,
      server: (db2.notes.find((x) => x.id === id) || {}).title };
  }, ids.N1);
  log(label + ' 4: en lokal endring uten skriverett slutter å avvike (ingen evig retry)',
    stopper === true && etterLås.lokal === 'Utvalg' && etterLås.server === 'Utvalg',
    JSON.stringify(etterLås));

  /* Det samme gjelder POSISJONSREGISTERET, og et LÅSUNNTAK er tilfellet som
     viser hvorfor det er et EGET spørsmål: notatet er åpent (jeg KAN redigere
     det), mens notatboken over er låst (jeg kan IKKE ordne rekkefølgen i den).
     En omrokkering gjort før låsen kom kan da aldri lande — og en rollback som
     bare så på innholdet ville ikke kjørt i det hele tatt. */
  await p.evaluate((id) => { window.__hkNote = id; }, ids.N1);
  const unntak = await readDB(p);
  unntak.notes.find((n) => n.id === ids.N1).unlocked = true;
  await writeDB(p, unntak);
  await sync(p, () => {
    const n = (window.__huskis.state.notes || []).find((x) => x.id === window.__hkNote);
    return !!(n && n._caps && n._caps.editContent === true && n._caps.reorderInParent === false);
  });
  const caps = await p.evaluate(() => {
    const n = (window.__huskis.state.notes || []).find((x) => x.id === window.__hkNote) || {};
    return { skriv: n._caps && n._caps.editContent, rekkefølge: n._caps && n._caps.reorderInParent };
  });
  log(label + ' 4: et låsUNNTAK gir skriverett UTEN rett til å ordne rekkefølgen',
    caps.skriv === true && caps.rekkefølge === false, JSON.stringify(caps));
  await p.evaluate(() => {
    const H = window.__huskis;
    const n = H.state.notes.find((x) => x.id === window.__hkNote);
    n.pos = 99; n.posTs = 9e12; n.posOrg = 'b';
    H.save();
  });
  const posStopper = await sync(p, () => {
    const H = window.__huskis;
    const mine = H.docFromMyState().notes.find((x) => x.id === window.__hkNote);
    const serv = H.contentDocFromMy(H.lastMy).notes.find((x) => x.id === window.__hkNote);
    return !!mine && !!serv && JSON.stringify(mine) === JSON.stringify(serv);
  });
  const etterPos = await p.evaluate(() => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    return { lokal: (window.__huskis.state.notes.find((x) => x.id === window.__hkNote) || {}).pos,
      server: (db2.notes.find((x) => x.id === window.__hkNote) || {}).pos };
  });
  log(label + ' 4: en omrokkering uten rett til det ruller også tilbake (ingen evig retry)',
    posStopper === true && etterPos.lokal === 0 && etterPos.server === 0,
    JSON.stringify(etterPos));
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

  /* ARKIVERING ER IKKE SLETTING. C er et rent DIREKTE medlem av notatet: hen
     kan lese og redigere det, men ikke ta det fra alle andre (`can_delete_object`
     spør om en ARVET rolle ovenfra, som C ikke har). Da skal dra-og-slipp gi
     nøyaktig ett av de to slippmålene — arkivet, ikke søppelkassen. Kassene
     spurte tidligere den samme capabilityen, og en redaktør uten sletterett
     mistet dermed arkivet òg. */
  const cRett = await p.evaluate(() => {
    const n = (window.__huskis.state.notes || [])[0] || {};
    return { skriv: n._caps && n._caps.editContent, slett: n._caps && n._caps.delete };
  });
  log(label + ' 5: C kan redigere notatet, men ikke slette det for alle',
    cRett.skriv === true && cRett.slett === false, JSON.stringify(cRett));
  const kortBoks = await p.locator('#notes-board .note-card').first().boundingBox();
  await G.lift(p, { x: kortBoks.x + kortBoks.width / 2, y: kortBoks.y + kortBoks.height / 2 }, mobile);
  const cKasser = await p.evaluate(() => {
    const synlig = (id) => {
      const w = document.getElementById(id);
      return !!w && !w.hidden;
    };
    return { arkiv: synlig('note-archive'), kasse: synlig('note-trash') };
  });
  await G.drop(p, undefined, mobile);
  log(label + ' 5: … så draget folder ut ARKIVET, men ikke søppelkassen',
    cKasser.arkiv === true && cKasser.kasse === false, JSON.stringify(cKasser));
  await p.waitForTimeout(300);

  /* ---------- 6) Tilbakekalling: notatet forsvinner, editoren lukkes ---------- */
  await p.evaluate((id) => { window.__huskis.openNoteEditor(id); }, ids.N1);
  await p.waitForTimeout(250);
  const trukket = await readDB(p);
  trukket.memberships = trukket.memberships.filter((m) => !(m.user_id === 'uC' && m.note_id === ids.N1));
  await writeDB(p, trukket);
  await sync(p, () => window.__huskis.state.notes.length === 0);
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
  await p.evaluate((x) => { window.__hkFolder = x.F; window.__hkShelf = x.DP; },
    { F: ids.F, DP: ids.DP });
  const dState = await p.evaluate(() => {
    const H = window.__huskis;
    const shelf = H.state.noteProjects.find((x) => x._virtual) || {};
    return {
      bokhyller: H.state.noteProjects.map((x) => x.name),
      virtuell: !!shelf._virtual,
      notatbøker: (shelf.folders || []).map((f) => f.name),
      notater: H.state.notes.map((n) => n.title),
    };
  });
  log(label + ' 7: D ser notatboken i den virtuelle bokhyllen, med notatet i',
    dState.bokhyller.length === 2 && dState.virtuell && dState.notatbøker.join() === 'Metode'
    && dState.notater.join() === 'Utvalg', JSON.stringify(dState));
  const dDom = await p.evaluate(() => document.body.innerText);
  log(label + ' 7: bokhyllens navn lekker ikke', !/Felles bokhylle/.test(dDom), '');
  await openNotesNav(p);
  const dRows = await menuRows(p, folderSel);
  log(label + ' 7: D er eksplisitt eier og kan dele notatboken videre',
    dRows.some((r) => /Deling/i.test(r)) && dRows.some((r) => /Forlat/i.test(r)),
    dRows.join(' | '));

  /* En EKTE flytting UT av «Delt med meg»: D drar notatboken over i sin egen
     bokhylle. To ting må holde samtidig.

     Serveren må godta den: D har destruktiv myndighet i kilden (direkte eier)
     og opprettelsesrett i målet — selv om hen IKKE får ordne rekkefølgen i
     bokhyllen hen ikke ser. Det er to forskjellige spørsmål, og søsken-vakten
     skal ikke rulle flyttingen tilbake med svaret på det ene.

     Og klienten må skrive den NYE plasseringen: i den virtuelle bokhyllen var
     rekkefølgen PERSONLIG, og den kanoniske lå til side. Blir den liggende
     etter flyttingen, pushes den gamle plasseringen i stedet for den nye. */
  const førFlytt = await p.evaluate(() => {
    const H = window.__huskis;
    const f = H.state.noteProjects.flatMap((x) => x.folders || [])
      .find((x) => x.id === window.__hkFolder) || {};
    return { canon: !!f._canon, canonProject: !!f._canonProject,
      kanoniskPos: f._canon ? f._canon.pos : null, personligPos: f.pos };
  });
  log(label + ' 7: notatboken står med PERSONLIG rekkefølge og skjult kanonisk bokhylle',
    førFlytt.canon === true && førFlytt.canonProject === true
    && førFlytt.kanoniskPos === 7 && førFlytt.personligPos !== 7,
    JSON.stringify(førFlytt));
  await dragNoteFolderTo(p, ids.F, ids.DP);
  const etterFlytt = await p.evaluate(() => {
    const H = window.__huskis;
    const f = H.state.noteProjects.flatMap((x) => x.folders || [])
      .find((x) => x.id === window.__hkFolder) || {};
    const rad = H.docFromMyState().noteFolders.find((x) => x.id === window.__hkFolder) || {};
    return { prosjekt: f.project, canon: !!f._canon, canonProject: !!f._canonProject,
      lokalPos: f.pos, docProsjekt: rad.project, docPos: rad.pos };
  });
  log(label + ' 7: … og etter flyttingen er BEGGE overstyringene borte',
    etterFlytt.prosjekt === ids.DP && etterFlytt.canon === false
    && etterFlytt.canonProject === false, JSON.stringify(etterFlytt));
  log(label + ' 7: … så doc-et pusher den NYE plasseringen, ikke den gamle kanoniske',
    etterFlytt.docProsjekt === ids.DP && etterFlytt.docPos === etterFlytt.lokalPos
    && etterFlytt.docPos !== førFlytt.kanoniskPos,
    JSON.stringify({ før: førFlytt, etter: etterFlytt }));
  const landet = await sync(p, () => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    const r = db2.note_folders.find((x) => x.id === window.__hkFolder);
    return !!r && r.project_id === window.__hkShelf;
  });
  const serverRad = await p.evaluate(() => {
    const db2 = JSON.parse(localStorage.getItem('hk-mock-db'));
    const f = db2.note_folders.find((x) => x.id === window.__hkFolder) || {};
    const n = db2.notes.find((x) => x.folder_id === window.__hkFolder) || {};
    return { bokhylle: f.project_id, pos: f.pos, notatBokhylle: n.project_id };
  });
  log(label + ' 7: serveren godtar flyttingen — den blir ikke stille rullet tilbake',
    landet === true && serverRad.bokhylle === ids.DP && serverRad.pos === etterFlytt.docPos,
    JSON.stringify(serverRad));
  log(label + ' 7: … og notatet fulgte med (kaskaden holder invarianten)',
    serverRad.notatBokhylle === ids.DP, JSON.stringify(serverRad));
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
  await sync(p, () => window.__huskis.state.notes.length === 0);
  const uten = await p.evaluate(() => window.__huskis.state.notes.length);
  const igjen = await readDB(p);
  igjen.memberships.push({ id: 'm-igjen', user_id: 'uC',
    universe_id: null, group_id: null,
    note_project_id: null, note_folder_id: null, note_id: ids.N1,
    role: 'member', pos: 0, created_at: 1 });
  await writeDB(p, igjen);
  await sync(p, () => window.__huskis.state.notes.length === 1);
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
  await sync(p, () => (window.__huskis.state.notes[0] || {}).title === 'As nyere versjon');
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
