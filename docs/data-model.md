# Datamodell og arkitektur

Les denne når oppgaven berører state-strukturen, foreldre-peker-logikk, eller
per-enhet-minnet for aktiv mappe/område.

## Arkitektur

- **Ren statisk app**: `index.html` + `styles.css` + `app.js`. Ingen bundler og
  ingen rammeverk; `node build.js` stempler kun en build-ID inn i produksjons-
  kopien (`docs/auto-update.md`).
- **Vanilla JS**, uten klientavhengigheter i appkoden. Dra-og-slipp er det ene
  unntaket: gesten kjøres av dnd-kit gjennom Smett (`vendor/smett-0.2.0.js`, en
  innsjekket, låst kopi), mens hva et slipp BETYR ligger i `app.js` — se
  `docs/drag-and-drop.md`.
- **Persistens** i `localStorage` (offline-buffer per konto); sanntids-synk mot
  Supabase (Auth + relasjonelle tabeller) — se `docs/accounts.md`.

## State-form (nøstet i minnet for rendring, flat i synk-doc'et)

```js
state = {
  activeUniverse: <uniId>,     // aktiv posisjon (se under)
  activeGroup: <groupId>,      // aktiv posisjon (se under)
  activeGroups: { uniId: groupId }, // per enhet: sist aktive mappe per område
  universes: [
    { id, name, trashed, collapsed, pos,  // + registre: ts/org (innhold), posTs/posOrg (rekkefølge)
      groups: [
        { id, uni, name, trashed, pos, cat, isCat, collapsed,  // uni = område-forelder; cat/isCat = mappekategori
          cards: [                        // «lister»
            { id, group, title, color, trashed, k, p, // k/p: legacy, se docs/colors-and-labels.md
              responsible, start, due, lockTimes,     // ansvarlig + tidsplan for hele listen (docs/scheduling.md)
              collapsed,                              // rullgardin-kollaps av lista (innholds-register, se docs/design-system.md)
              items: [ { id, text, trashed, done, responsible, start, due, home, cat, isCat, lockTimes } ] } ] } ] } // done: avkrysset; responsible: ansvarlig bruker-id (delte lister); start/due: tidsplan; cat/isCat/lockTimes: kategorier (se under)
  ],
  ideas: [ { id, text, cat, isCat, collapsed, trashed } ],  // KONTOENS idéer, flatt — se docs/ideer.md
  // NOTATER (docs/notater-plan.md): kontoens andre hoveddel, Bokhylle > Notatbok > Notat
  // (identifikatorene heter fortsatt note_projects/note_folders — se planen)
  noteProjects: [ { id, name, trashed, collapsed, folders: [ { id, project, name, trashed } ] } ],
  notes: [ { id, project, folder, title, doc, trashed } ], // folder = null → fritt notat i bokhyllen
  activeProject: <projId>, activeFolder: <folderId|null>,  // aktiv posisjon i Notater (per enhet)
  activeFolders: { projId: folderId|null },                // per enhet: sist aktive notatbok per bokhylle
  _tomb: { universes:{}, groups:{}, cards:{}, items:{}, ideas:{},
           noteProjects:{}, noteFolders:{}, notes:{} },    // gravsteiner: id → ts (permanent slettet)
  _base: { universes:[], groups:[], cards:[], items:[] }, // synk-base: forrige serverkjente doc
  _baseV: 1,                                              // basens versjon (BASE_VERSION)
}
```

`_tomb` og `_base`/`_baseV` er de eneste `_`-feltene (utenom `_hlc`/`_createdByMe`) som
lagres i cachen — de hører til synken, ikke til visningen. `_base` MÅ ligge i
samme localStorage-post som innholdet, ellers kan de to komme i utakt og
fletteren lese basens rader som «slettet lokalt». Se «Gjenoppstandelse» i
`docs/accounts.md` og `docs/trash.md`.

Forelder-peker på hvert nivå: `listepunkt.home → kort`, `kort.group → mappe`,
`mappe.uni → område`.

**`noteProjects`/`notes` står også utenfor hierarkiet.** Notatene er Huskis'
ANDRE hoveddel, ved siden av listene, og har sitt eget tre: **Bokhylle >
Notatbok > Notat**. Bokhyllene er nøstet (notatbøkene ligger i dem), mens
notatene er en FLAT liste med to forelder-pekere — `project` (alltid satt) og
`folder` (null = et fritt notat rett i bokhyllen). Et fritt notat har ingen
notatbok å ligge under, så nøsting ville krevd en syntetisk beholder på hver
bokhylle. Begge pekerne rir på posisjonsregisteret, som `home`/`cat` på et
listepunkt; et notat hvis notatbok ikke finnes leses som fritt, nøyaktig som et
listepunkt med en hengende `cat` leses som nivå 1.

**DE TO PEKERNE KAN IKKE MOTSI HVERANDRE.** Ligger notatet i en notatbok, ER
bokhyllen notatbokens. Invarianten håndheves SERVERSIDE, ikke bare i klienten:
`notes_fix_parent` utleder `project_id` av `folder_id` ved hver skriving, og
`note_folders_cascade` tar notatene med når en notatbok flyttes til en annen
bokhylle. Uten den kunne et notat blitt liggende i en bokhylle notatboken hadde
forlatt — og `notes.project_id` er `on delete cascade`, så notatet ville blitt
SLETTET når den bokhyllen forsvant. Klienten leser den samme regelen
(`pruneNoteParents`: notatbokens bokhylle vinner), så de to er aldri uenige.

Innholdet (`doc`) er et strukturert riktekstdokument, ikke HTML, og rir på
innholdsregisteret som ÉN verdi — konfliktmodellen er altså per DOKUMENT.
Notatene deles ikke, har ingen roller, låser eller kategorier, og
`activeProject`/`activeFolder` huskes per enhet (og på kontoen, se under).
Autoritativt: [`notater-plan.md`](notater-plan.md).

**`ideas` står UTENFOR hierarkiet.** Idéene hører til kontoen, ikke til et
område eller en mappe, så de har ingen forelder-peker — bare `cat` innen sin
egen liste. De er den femte radtypen i synk-doc'et og har sin egen tabell
(`ideas`), sin egen gravsteinsbøtte og sin egen søppelkasse. Autoritativt:
[`ideer.md`](ideer.md).

**Rolle- og capability-metadata (kontomodus)** legges på objektene av
`applyMyDoc`, utenfor synk-doc'et: `_type`, `_parent`, `_creator`,
`_createdByMe`, `_role` (`'owner'`/`'member'`/`null` — kun områder og mapper),
`_free`, `_caps`, `_shared`, `_locked`, `_unlocked`, `_invitePolicy`,
`_ownerKey`, `_memberCount`, `_ownerCount`. Myndighet kommer fra `_role`/`_caps`
— `_creator` er ren historikk. Se `docs/rettigheter-og-deling.md`.

**Personlig vs. kanonisk `pos`.** For områder (alltid) og FRIE mapper er
`.pos` brukerens PERSONLIGE rekkefølge (fra medlemskapsraden), mens den kanoniske
verdien ligger i `_canon` og skrives tilbake uendret. For alt annet er `.pos` den
delte, kanoniske posisjonen.

**Den virtuelle fri-beholderen.** Mapper som er delt direkte med meg uten at jeg
har noen rolle i deres kanoniske område (`_free`) samles i ett syntetisk
«område» med id `'__free__'` (`FREE_UNI_ID`, `_virtual: true`). Det finnes ikke i
databasen, pushes aldri (`flattenNested` hopper over det), og mappene i det
beholder sitt kanoniske `uni` i doc-et — områdets navn lekkes aldri.

Aktiv mappe settes ALLTID via `setActiveGroup()` /
`setActiveUniverse()` / `goToGroup()` så per-område-minnet (`activeGroups`)
holdes i takt (`goToGroup` brukes fra nav-modalen, der et mappevalg også kan
bytte område).

**Aktiv posisjon huskes på kontoen (kontomodus).** `activeUniverse`/`activeGroup`
lagres på selve brukerkontoen (Supabase Auth `user_metadata.nav = {u,g,np,nf}`
— `np`/`nf` er notatfanens bokhylle og notatbok), ikke i synk-doc'et. Skrives debouncet fra `setActiveGroup()` (`saveNavPref`), og
gjenopprettes én gang ved første sky-pull etter innlogging (`restoreNavPref`, kalt
fra `applyMyDoc` bak `navRestored`-flagget). Da lander man på samme område/mappe
neste gang appen lastes — også på en ny enhet. Løpende synk flytter IKKE
visningen (restore skjer kun på første pull), så to åpne enheter kan stå i hver
sin mappe. `activeGroups`-minnet er alltid per enhet (synkes aldri).

**Hovedbryteren (`Lister ↔ Notater`) er per ENHET og synkes ikke** — den ligger i
`localStorage['huskis-tab']`. Hvilken fane man sist så på er ikke innhold.

## Hierarkiet: Område > Mappe > Liste > Listepunkt

De to øverste nivåene speiler de to nederste: **et område oppfører seg som en
liste og en mappe som et listepunkt** — samme rendring, samme kategori-modell og
samme dra-og-slipp-motor (se `docs/menus.md` og `docs/drag-and-drop.md`). Mapper
kan derfor flyttes fritt mellom områder, og en mappe sluppet utenfor alle
områder oppretter et NYTT område (som listepunkt-ekstrahering lager en ny
liste) — og mappen flyttes dit med `move_group`, ikke ved å skrive
`universe_id` direkte.
Alt liste-/listepunkt-UI er fortsatt scopet til den AKTIVE mappen.

- **Områder**: bytt/opprett/omdøp/slett/omrokkér i nav-modalen. Se `docs/menus.md`.
- **Mapper** (samme modal, som rader i områdekortet): samme CRUD + dra-og-slipp,
  inkl. overføring til et annet område og til/fra mappekategorier. Se `docs/menus.md`.
- **Mappekategorier** (`group.isCat` / `group.cat`): et område har TO nivåer,
  nøyaktig som en liste. En mappekategori lagres SOM en mappe (markert
  `isCat: true`, med `cards: []`), og vanlige mapper peker på den via `cat`
  (null = ukategorisert, nivå 1). Reglene er identiske med listepunkt-kategoriene
  under: nøstes aldri, `cat` rir på posisjonsregisteret (som `uni`), `isCat`/
  `collapsed` på innholds-registeret, og en mappe hvis `cat` peker på en
  kategori som ikke finnes rendres som ukategorisert. En mappekategori er ingen
  navigerbar plassering — `activeGroup`/`validateActive` hopper over `isCat`.
- **Lister** («kort», tidl. «kategorier») i hver mappe: samme CRUD + dra-og-slipp,
  inkl. overføring til annen mappe. Se `docs/drag-and-drop.md`.
- **Listepunkter** i hvert kort: samme CRUD + dra-og-slipp, inkl. overføring mellom
  lister i samme mappe. Se `docs/drag-and-drop.md`.
- Klikk på **tittelen** (område/mappe/liste/listepunkt/kategori) = omdøp inline.
  Global hover-affordans (bakgrunnen bak tittelen mørkner) + klikkflaten følger
  teksten (`align-self: flex-start`), så det er kun tittelen — ikke hele raden —
  som redigerer. I område-/mappe-modalene: tittel-klikk redigerer, klikk ellers
  på raden navigerer (se `docs/menus.md`). Se `docs/design-system.md`.
- **Lukketilstand for lister** (`card.collapsed`): klikk på korthodet (ikke
  meny/meta-chip) folder listen sammen som en rullgardin. Rir på innholds-
  registeret (`ts`/`org`, som `lockTimes`); lagres og synkes i DB via `save()`
  (optimistisk, ingen synlig forsinkelse). I kontomodus egen kolonne
  (`cards.collapsed`). Se `docs/design-system.md`.
  **Områder og mappekategorier har det samme feltet** (`universe.collapsed` /
  `group.collapsed`, kolonnene `universes.collapsed`/`groups.collapsed`) — et
  kollapset område viser [mappe-ikon] + antall mapper i stedet for «(N)».
- Søppelkasse på alle fire nivåer + idéene (`trashed`-flagg) — se `docs/trash.md`.
- **Avkryssing av listepunkter** (`item.done`): rir på innholds-registeret (`ts`/`org`,
  som `text`/`trashed`) — LWW ved samtidig endring. Avkryssede listepunkter flyttes
  (med FLIP, se `toggleItemDone`) til en egen **«Utført»-seksjon** nederst i kortet
  (skilt med en linje), med lavere bakgrunns-opacity + gjennomstreking. `pos`
  endres IKKE, så et reaktivert listepunkt sorterer tilbake til nøyaktig sin gamle
  plass blant de aktive (og skyver den som nå står der, ett hakk ned). ⟲-knappen
  på «Utført»-linja (`restoreAllDone`) gjør det samme for ALLE utførte i lista på
  én gang — samme semantikk per listepunkt (`pos` urørt, kategoriserte tilbake INN
  i kategorien sin via `placeItemBySection`), men i én felles FLIP. I kontomodus
  er `done` en egen kolonne (`items.done`, se `supabase/users-and-sharing.sql`).
- **Ansvarlig** (`item.responsible` og `card.responsible`): bruker-id-en til den
  som «tar oppgaven» i delt kontekst — nå både per listepunkt og for HELE listen.
  Rir på innholds-registeret (`ts`/`org`, som `text`/`done`) — LWW ved samtidig
  endring. Settes fra objektmenyens «Ansvarlig»-skuff eller ansvarlig-chipen
  (`docs/scheduling.md`); se `docs/accounts.md` for delegruppen. I kontomodus
  egne kolonner (`items.responsible`/`cards.responsible`, FK til `profiles`,
  `on delete set null`).
- **Tidsplan** (`start`/`due` på listepunkter og lister + `card.lockTimes`): lokal
  vegg-tid som tekst (`'YYYY-MM-DD'` evt. + `'THH:MM'`), rir på innholds-
  registeret. Se `docs/scheduling.md` for semantikk, chips og DB-kolonner.
- **`_pendingDelete`** (lokalt, `_`-prefiks → ikke synket): buffret sletting —
  objektet er skjult og «på vei til søppel», men ennå ikke `trashed`/skrevet til
  DB. Se `docs/trash.md` (delete-buffer).
- **Kategorier** (`item.isCat` / `item.cat`): en liste har nå TO nivåer. En
  kategori er en nivå-1-«rad» som grupperer listepunkter under en felles overskrift,
  men den **lagres som et listepunkt** i kortets `items` (markert `isCat: true`), så
  den rir på hele listepunkt-synken gratis. En kategori har navn (`text`), egen
  tidsplan (`start`/`due`) og kan låse tidene til listepunktene sine (`lockTimes`,
  som lister). Leaf-listepunkter peker på kategorien sin via `cat` (kategori-id;
  null/undefined = ukategorisert, nivå 1). Regler: kategorier nøstes ALDRI
  (`cat` alltid falsy på en `isCat`), krysses aldri av (`done`), og et listepunkt
  hvis `cat` peker på en kategori som ikke finnes (f.eks. oppløst på en annen
  enhet) rendres som ukategorisert (nivå 1). Nivå 1 = aktive listepunkter med `cat`
  falsy (ukategoriserte + kategorier), sortert på `pos`; en kategoris medlemmer =
  aktive leaf-listepunkter med `cat === kategori.id`. Begge nivåer deler samme
  `pos`-rom (filtreres til søskenmappen FØR sortering, så absolutte pos-verdier
  trenger ikke være globalt monotone). `cat` er et forelder-medlemskap → rir på
  posisjonsregisteret (som `home`); `isCat`/`lockTimes` på innholds-registeret.
  Opprettes via en egen **gul kategori-knapp** ved siden av ＋-knappen; se
  `docs/drag-and-drop.md` for nivå-2-dra-og-slipp og `docs/scheduling.md` for
  kategoriens tidsskuff i objektmenyen. En kategori kan **kollapses** som en rullgardin
  (klikk på overskriftslinjen, `item.collapsed` — som `card.collapsed`); en grønn
  **＋-knapp nederst i kategorien** legger til et nytt (tomt, straks-fokusert)
  listepunkt direkte i den. Se `docs/design-system.md`.
- **Ekstrahering til ny liste** (`docs/drag-and-drop.md`): drar man en kategori
  eller et listepunkt UT av listene og slipper det i board-luften, opprettes en NY
  liste (kategori → samme tittel + medlemmene ukategorisert; listepunkt → bare seg
  selv, blank straks-fokusert tittel). Den som ekstraherer blir **oppretter**
  (`owner_id`) av den nye lista — den lages lokalt med ny id og pushes som en ny rad
  eid av gjeldende bruker, uansett hvem som eide kilde-lista. Umulig fra en låst
  (frosset) liste (selve draget er da avskrudd).
- **Kategori inn i en annen liste** (`moveCategoryToCard`, `docs/drag-and-drop.md`):
  en kategori kan dras inn i en annen eksisterende liste — den blir en nivå-1-kategori
  der (nøstes aldri), og medlemmene følger med (`cat` bevart, ny `home` = mål-lista).
  Dette er den ENESTE måten en kategori bytter liste på (utover ekstrahering til en ny).
- **Lukketilstand for kategorier** (`item.collapsed`): rir på innholds-registeret
  (`ts`/`org`, som `isCat`/`lockTimes`). Kun meningsfullt for `isCat`-rader. I
  kontomodus egen kolonne (`items.collapsed`).

Gotcha: den programmatiske `addGroup()` (feilsøking/tester) skal alltid bare
virke, selv uten område — standard-området opprettes i farten
(`ensureUniverse`). Dette bruker en NY tilfeldig id, ikke den faste
`uni-standard`-id-en (som kan ha gravstein fra migrering). UI-veien er ＋-knappen
i områdekortet, som i stedet oppretter mappen tom og navngir den på plassen
(`nameNewRow`, som listepunkter).
