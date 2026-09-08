# Globalt søk og navigering til et objekt

Les denne når oppgaven berører søkeknappen, søkemodalen, rangeringen av
søketreff — eller når noe annet i appen skal kunne **sende brukeren til et
bestemt objekt**.

To ting bor her, og de er bevisst skilt:

1. **Søket** — en indeks over gjeldende klienttilstand og en deterministisk
   rangering av treffene (`buildSearchIndex` / `searchObjects` i `app.js`).
2. **`navigateToObject(target)`** — den ENE veien fra «her er et objekt» til
   «nå står brukeren ved det». Søket var første kaller; «Kommende hendelser»
   ([`kommende-hendelser.md`](kommende-hendelser.md)) og varslene
   ([`varsler.md`](varsler.md)) bruker den samme, og alt annet som skal peke på
   et objekt skal også gjøre det.

Toppkontrollgruppen søkeknappen står i er beskrevet i
[`menus.md`](menus.md) («Toppkontrollene»).

## Søkemodalen (`#search-modal`, søkeknappen)

Vanlig `.modal-overlay`-skall (fokusfelle, Escape via `closeTopLayer`,
`body.modal-open`), med:

- søkefeltet (`#search-input`), som får fokus ved åpning;
- **scopevelgeren** `Alt | Lister | Notater` (`#search-scope`) — se «Ett søk,
  to hoveddeler» under;
- en hint-linje så lenge feltet er tomt, som sier hva søket dekker (den følger
  scopet) — **tomt felt gir ingen treff**, en liste over alt man eier er ikke
  et søkeresultat;
- resultatlisten (`#search-results`);
- en tomtilstand når søket ikke gir treff;
- en notatlinje når listen er kappet (se «Taket» under).

**Feltet er en combobox over listen.** `role="combobox"` +
`aria-controls`/`aria-expanded` på feltet, `role="listbox"` på lista,
`role="option"` + `aria-selected` på radene, og `aria-activedescendant` på
feltet peker på det aktive treffet. Piltastene flytter det aktive treffet uten
at fokus forlater feltet, så man kan skrive videre uten å tabbe tilbake:

| Tast | Virkning |
|---|---|
| `↓` / `↑` | flytt det aktive treffet (listen går rundt) |
| `Enter` | åpne det aktive treffet |
| `Escape` | lukk modalen (den felles stigen) |

**Første treff er aktivt fra start**: «skriv og trykk Enter» er den raskeste
veien til det man søkte etter, og den skal ikke koste et piltrykk. Mus og touch
virker uten særbehandling — et klikk på en rad gjør nøyaktig det Enter gjør.

Fokus går tilbake til søkeknappen når modalen lukkes — bortsett fra når et
treff ble åpnet: da eier navigeringen fokuset og setter det på selve målet.

### Raden

`[typeikon] navn` som primærtekst, og under den en dempet linje med
**kontekststien**: `Arbeid › Klinikk`. Ikonet sier hva slags objekt det er,
men ikke hvor det står — og to lister som heter det samme i hver sin mappe er
ikke til å skille på navnet alene. Stien er FORFEDRENE; objektets eget navn
står allerede over den. Objekttypen står IKKE lenger i klartekst i raden —
ikonet dekker det visuelt — men ligger fortsatt i et `.visually-hidden`-spenn
foran stien, for skjermlesere som ikke ser ikonet
(`docs/tilgjengelighet.md`).

Den aktive raden bæres av mer enn farge (`docs/tilgjengelighet.md`): kant,
flate OG en pilspiss i enden av raden.

## Ett søk, to hoveddeler

Søket er ÉN global Huskis-funksjon, ikke to søkesystemer ved siden av
hverandre: én indeks, én rangering, én resultatliste. Scopevalget
`Alt | Lister | Notater` er et FILTER over den samme indeksen
(`searchObjects(q, index, scope)`), og `Alt` er standard.

Valget nullstilles ikke mellom åpninger, men det lagres heller ikke: det ligger
i minnet så lenge fanen er åpen. Har man snevret inn til Notater, er det som
regel fordi man leter der — men det er en innsnevring av ett søk, ikke en
innstilling som skal følge kontoen.

Selve kontrollen er den samme segmenterte pillen som hovedbryteren øverst
(`.seg`/`.seg-btn`, `role="tablist"` med piltaster), så det finnes bare én
segmentert kontroll i appen.

## Hva som søkes

Alle **levende, tilgjengelige** objekter av disse åtte typene, i denne
rekkefølgen:

| # | Type | Hoveddel | Ikon | Kontekststi |
|---|---|---|---|---|
| 1 | område | Lister | `ICONS.globe` | — |
| 2 | mappe | Lister | `ICONS.folder` | område |
| 3 | liste | Lister | `ICONS.list` | område › mappe |
| 4 | kategori | Lister | `ICONS.category` | område › mappe › liste |
| 5 | listepunkt | Lister | `ICONS.item` | område › mappe › liste (› kategori) |
| 6 | bokhylle | Notater | `ICONS.noteProject` | — |
| 7 | notatbok | Notater | `ICONS.noteFolder` | bokhylle |
| 8 | notat | Notater | `ICONS.note` | bokhylle › notatbok (eller «Frie notater») |

- **Papirkurven er ute** på alle nivåer. Indeksen bruker den samme `live()`-
  vakten som rendringen, så et slettet objekt — og alt som ligger inne i det —
  finnes ikke i søket (`docs/trash.md`).
- **Ferdige listepunkter er MED.** Søk er navigasjon, ikke en
  oppgavelistefiltrering; et avkrysset punkt ligger i «Utført»-seksjonen og
  skal kunne finnes igjen der.
- **Notatenes ARKIV er ute på samme måte som søppelkassen.** Vakten er
  `noteVisible()` — den samme visningen bruker ([`trash.md`](trash.md)) — og den
  gjelder hele veien opp: et notat i en arkivert notatbok er heller ikke i
  indeksen.
- **Mappekategorier er ute.** De er overskrifter i nav-modalen, ikke steder man
  kan navigere til (`activeGroup`/`validateActive` hopper over `isCat`), og de
  er derfor ikke en av de åtte typene.
- **Fri-beholderen** (`FREE_UNI_ID`, mapper delt direkte med meg) er en seksjon
  i nav-modalen, ikke et område — den er ikke et søkbart objekt. Mappene i den
  er det, og får seksjonsnavnet som rot i stien.

Indeksen bygges fra `state`, altså det samme treet UI-et tegner. **Databasen
spørres ikke per tastetrykk** — alt appen kan vise, ligger allerede lokalt.

### Taket

Maks 50 treff TEGNES (`SEARCH_MAX`). Et ett-tegns søk kan treffe alt man eier,
og en liste på tusen rader er verken raskere eller mer lesbar enn en på femti.
Totalen står i notatlinjen under lista, så brukeren vet at det finnes flere.

### Notatets TEKST er med, ikke bare tittelen

Et notat er et dokument, og det man husker fra det er som regel en setning i
det. Notatraden bærer derfor også den lesbare teksten (`noteDocText`, lest ut av
det strukturerte dokumentet — det finnes ingen markup å lese). Det er den ENESTE
typen med et andre felt å matche mot.

Et treff i teksten er en ANDRE-linje: det slår bare til når navnet ikke traff,
og det havner sist i rangeringen (`tier` 2, se under). Raden viser da
setningen i et utdrag rundt treffet (`searchSnippet`), for uten det sier raden
ingenting om hvorfor notatet står i lista.

## Tekstnormalisering

`searchNorm()`: **trim + NFC + små bokstaver**. Ikke mer.

- **NFC** fordi «å» kan komme dekomponert (a + ring) fra en annen plattform. To
  strenger som SER like ut må også matche.
- **Diakritikk beholdes.** «lån» og «lan» er ikke det samme ordet på norsk, og
  en sammenslåing ville gitt treff brukeren ikke ba om.
- **Ingen fuzzy matching.** Prefiks og infiks er hele regelen.

## Rangeringen

Resultatlisten er tre grupper, i denne rekkefølgen:

1. **prefikstreff** — det normaliserte navnet BEGYNNER med søketeksten;
2. **infikstreff** — navnet inneholder søketeksten et annet sted;
3. **teksttreff** — kun i et notats innhold (aldri i et navn).

Grensen er deterministisk, men tegnes ikke som en overskrift: listen leses
bedre som én rekke.

Innenfor hver gruppe:

1. **objekttype** — rekkefølgen i tabellen over (Lister før Notater);
2. **eksakt treff** (navnet ER søketeksten) før lengre navn;
3. **alfabetisk** på det normaliserte navnet;
4. **hele stien**, og til slutt **id-en**.

De to siste er tie-breakere som gjør rekkefølgen FULLSTENDIG bestemt: to
objekter kan hete det samme i to mapper, og rekkefølgen mellom dem skal aldri
hoppe mellom to rendringer.

**Alfabetet er norsk** (`localeCompare(…, 'no')` — æ, ø, å sist), uansett
UI-språk. Det er ÉN rekkefølge, og den skal ikke endre seg når man bytter
språk.

Vokter: `tests/search-ranking.test.js`; notatsiden og scopet i
`tests/notes-lifecycle-links.test.js`.

## `navigateToObject(target, opts)`

```js
navigateToObject({ type: 'item', id: 'abc' })   // → true når navigeringen skjedde
```

`type` er en av de åtte over. **Kalleren trenger bare type + id** — alt annet
(område, mappe, liste, kategori) slås opp i `state` der objektet FAKTISK ligger
nå. En id fra et varsel som er timer eller dager gammelt fører derfor riktig
sted, eller pent til ingen steder: er objektet borte, kommer en beskjed i
stedet for en krasj.

`opts.announce === false` slår av opplesningen (aria-live); ellers sier den hvor
man havnet.

### Hva funksjonen gjør per nivå

| Type | Handling |
|---|---|
| **område** | Folder ut kortet hvis det er kollapset, åpner **nav-modalen** og peker det ut der. Området finnes ikke på hovedsiden — det ER nav-modalen. |
| **mappe** | `goToGroup()` (bytter både område og mappe), lukker nav-modalen, markerer breadcrumben. |
| **liste** | Går til mappen, ruller kortet inn i visningen og markerer det. |
| **kategori / listepunkt** | Går til mappen, folder ut det som må foldes ut, ruller målet inn i visningen og markerer det. |
| **bokhylle** | Speiler området: åpner **notat-nav-modalen** og peker bokhyllen ut der. |
| **notatbok** | Speiler mappen: bytter plassering, lukker modalen, markerer breadcrumben. |
| **notat** | Bytter plassering og ÅPNER EDITOREN. Kortet er en forhåndsvisning; selve notatet er editoren, og «åpne notatet» er det man ba om. |

**FANEBYTTET GJØRES HER**, ikke av kalleren. Et treff i Notater skal virke mens
man står i Lister, og omvendt — og hadde hver kaller (søket, koblingene, et
varsel) måttet bytte fane selv, ville hver av dem hatt sin egen halve
navigering. `navigateToObject` slår opp hvilken hoveddel typen hører til
(`SEARCH_SIDE`) og setter fanen før den gjør noe annet.

Et notatobjekt som er lagt bort — arkivert, i søppelkassen, eller inne i noe som
er det — er ikke noe å navigere til: da kommer den samme beskjeden som for et
slettet objekt, ikke en tom flate.

To valg som er verdt å vite om:

**Et områdetreff velger IKKE en mappe.** Å sette aktivt område ville tatt
brukeren bort fra mappen hen står i, og det er ikke det man ba om ved å søke
opp et område.

**Navigeringen endrer bare data der den MÅ.** Rullgardinen går opp der målet
ellers ikke ville vært å se: et kollapset OMRÅDEKORT (som bare viser
overskriften sin), og en kollapset liste eller kategori målet ligger inne i.
Kollapstilstanden er en visnings-preferanse som synkes som alt annet
(`docs/data-model.md`), og et frosset objekt foldes ut lokalt uten å skrives,
som `toggleCardCollapsed`. Er selve LISTEN målet, foldes den ikke ut: korthodet
er synlig uansett, og det er hele objektet man søkte opp.

### Rulling og markering

Målet finnes igjen med `handleSelector(kind, id)` — den samme selektoren
tastaturflyttingen og fokusgjenopprettingen bruker, så «det man kan dra» og
«det man navigerer til» er det samme elementet.

Rullingen skjer **etter to animasjonsrammer**. `relayoutBoard` FLYTTER
kortnodene mellom kolonnene etter rendringen, og en `ResizeObserver`-runde kan
komme rett etter; sikter man før det, ruller man mot en node som straks står et
annet sted. Den første rammen lar rendringen (og relayouten den kaller) males,
den andre lar en observatør-runde utløst av den første skrive ferdig.

Markeringen (`.nav-flash`, 1,6 s) tegnes som en **innvendig `box-shadow`**, ikke
en outline: kortene har `overflow: hidden`, og fokusringen eier `outline` på det
samme elementet i det samme øyeblikket. Ved `prefers-reduced-motion` pulserer
den ikke — ringen står stille til den fjernes.

Markeringen huskes som en **selektor**, ikke som en node — av samme grunn som
fokusønsket (`keepFocus`): å folde ut en kollapset liste lagrer, lagringen
utløser en synk-runde, og runden rendrer board-et fra bunnen. `paintNavFlash()`
males derfor på nytt sist i `renderBoard()` og `renderNav()`, helt til
tidsvinduet er ute.

Vokter: `tests/search-navigation.test.js`; fanebyttet og notatnivåene i
`tests/notes-lifecycle-links.test.js`.

## Tilgjengelighet

- Dialogsemantikk på modalen, combobox/listbox på feltet og lista (over).
- Autofokus i feltet ved åpning; fokus tilbake til søkeknappen ved lukking.
- Antall treff leses opp fra et visuelt skjult `role="status"`-felt; hvilket
  treff som er aktivt sier combobox-en selv (`aria-activedescendant`).
- Navigeringen leser opp hvor man havnet (`a11y.wentTo`) — en rulling og en
  ring er ellers usynlig for en skjermleser.
- Farge er aldri eneste bærer: typen står i klartekst i raden, og den aktive
  raden har en pilspiss i tillegg til kant og flate.
- `prefers-reduced-motion` slår av både markeringens puls og den myke
  rullingen.

Kravene er de samme som ellers — se [`tilgjengelighet.md`](tilgjengelighet.md).

## Språk

Alle tekstene ligger i ordboken under `search.*` (pluss `kind.card`/`kind.item`
for typenavnene og `a11y.wentTo` for opplesningen). Se [`sprak.md`](sprak.md).
