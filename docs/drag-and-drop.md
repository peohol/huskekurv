# Dra-og-slipp-logikk

Les denne når oppgaven berører reorder, overføring mellom lister/mapper/områder,
ekstrahering, peek eller søppelkassene som slippmål.

Dra-og-slipp er delt i to eierskap, og det skillet forklarer nesten alt i dette
dokumentet:

- **Gesten er dnd-kits.** Aktivering, løft, plassering underveis, auto-scroll,
  drop-animasjon og opprydding kommer fra
  [dnd-kit](https://github.com/clauderic/dnd-kit) gjennom
  [Smett](https://github.com/peohol/smett), som ligger i repoet som en
  innsjekket, låst kopi (`vendor/smett-0.2.0.js`, den globale `Smett` — se
  [`sikkerhetsheadere.md`](sikkerhetsheadere.md)).
- **Betydningen er Huskis'.** Hva et slipp GJØR — ny `pos`, hvilken container
  raden havner i, hvem som får lov, hva som slettes, hva som opprettes — ligger
  i `app.js`, i seksjonen «DELT DnD-POLITIKK». Den er DELT av alle nivåene: en
  endring der treffer hovedsiden, nav-modalen OG idémodalen.

Smett er ikke en motor, men et politikklag: hver regel Smett beholdt er en
Huskis-regel, og standardverdiene ER Huskis' egne tall (`swapRatio` 0.2,
`reverseRatio` 0.5, `reverseLockMs` 300, `mouseDistance` 5, `holdMs` 200,
`holdTolerance` 10). Huskis sender derfor ingen av dem inn — de står i Smett.

## De åtte board-ene

Områder og mapper har ingen egen kode: et område ER et kort, en mappe ER en rad,
en mappekategori ER en kategori. Idéene og idékategoriene er de samme radene
igjen ([`ideer.md`](ideer.md)), og notatenes prosjekter og mapper er de samme
kortene og radene en gang til ([`notater-plan.md`](notater-plan.md)). Forskjellen
er hvilket state-tre man slår opp i (`boardScope` / `navScope` / `ideaScope` /
`notesScope` / `notesNavScope`) og hvor draget foregår.

| Board | Elementer | Containere | Dra-sone | Soner |
|---|---|---|---|---|
| `navCardBoard` | `.card` (områder) | `.board-col` | `.card-head` | `#uni-trash-btn` |
| `navRowBoard` | `.item`, `.category` (mapper, mappekategorier) | `.items-container`, `.cat-items` | `.item`, `.cat-head` | `.group-trash-btn` |
| `boardCardBoard` | `#board .card` (lister) | `#board .board-col` | `.card-head` | `#trash-btn`, `#nav-crumb` |
| `boardRowBoard` | `.items-container > .item`, `.items-container > .category`, `.cat-items > .item` | `.items-container`, `.cat-items` | `.item`, `.cat-head` | `.item-trash-btn` |
| `ideaRowBoard` | de samme radene, i idémodalen | `.items-container`, `.cat-items` | `.item`, `.cat-head` | `.item-trash-btn` |
| `notesCardBoard` | `#notes-board .note-card` (notater) | `#notes-board .board-col` | `.note-card` (hele kortet) | ingen |
| `notesNavCardBoard` | `#notes-nav-board .card` (bokhyller) | `#notes-nav-board .board-col` | `.card-head` | ingen |
| `notesNavRowBoard` | `#notes-nav-board .item` (notatbøker) | `#notes-nav-board .items-container` | `.item` | ingen |

**Notat-scopene er de enkleste.** Ingen kategorier, ingen låser, ingen
ekstrahering og — i PR 1 — ingen søppelkasse, så det eneste et slipp kan bety er
ny plass i rekka (og for en notatbok i tillegg en ny bokhylle). NOTATKORTET
er sin egen dra-sone i sin helhet: kortet har ingen indre kontroller å treffe, så
klikk åpner editoren og klikk-og-hold løfter — dnd-kits egen aktiveringsterskel
skiller de to, og klikk-vakten svelger klikket som ellers ville fulgt et slipp.
Notatkortene fordeles av den SAMME kolonnemotoren som listene
([`board-layout.md`](board-layout.md)); `.note-card` bærer derfor også klassen
`.card`, som er det `boardRows` teller.

Flytter en notatbok til en annen bokhylle, følger notatene med: de peker på
notatboken, og `noteFolderMoved` retter `project`-pekeren deres i samme slipp,
slik at plasseringen er hel i begge ender. Serveren gjør det samme uavhengig av
klienten (`note_folders_cascade`), for enheten kan miste nettet mellom de to
skrivingene — se [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md).

Raden «Frie notater» øverst i hver bokhylle er IKKE en rad i modellen: den har
en syntetisk id (`free:<bokhylle>`) som aldri finnes i `rowPool()`, og bærer
`data-dnd-ignore`, så den kan verken løftes eller telles med når rekkefølgen
leses tilbake fra DOM-en.

**Idé-scopet har ingen kortnivå-board**, og trenger ikke ett: det finnes
nøyaktig ÉN beholder (`ideasCont`, id `__ideas__`), og den er ikke en `.card`.
Et kort betyr en liste (eller et område), og den betydningen skal ikke utvannes
av en beholder som ikke er noen av delene — hverken for koden som teller kort
eller for et menneske som leser DOM-en. Den delte politikken spør derfor scopet
om selektoren, `S.contSelector` (`.card` i de to andre, `.ideas-card` her), i
stedet for å anta `.card`. Ekstrahering finnes ikke der (det er ingenting å
ekstrahere TIL), og det eneste et slipp kan bety er ny plass i rekka, inn i
eller ut av en kategori. **Ingen sletting**: idémodalen har ingen `zoneSelector`,
og kassen der er bare veien tilbake (`ideer.md`). Og **bare én akse**, som
nav-modalen: lista er én smal kolonne uten et eneste vannrett slippmål (se
«Én akse» under).

**Ett board per hierarkinivå, hver med sin egen manager.** dnd-kit stempler
`pointerdown` med sensoren som tok den, så det INNERSTE board-et vinner et delt
trykk: et trykk på en mapperad løfter mappen, ikke området den ligger i. Egne
managere gir dessuten hvert nivå sine EGNE soner — område-kassen finnes ikke for
et mappe-drag, og omvendt. Board-ene er dessuten scopet til hver sin ROT
(`#board`, `#notes-board`, nav-modalenes og idémodalens kropper), så to board kan
aldri registrere det samme elementet.

**Roten følger sonene, ikke board-et.** `boardCardBoard` har `document.body` som
rot, fordi liste-søppelkassen og 📁-breadcrumben ligger i toppmenyen, utenfor
`#board`, og Smett registrerer bare soner under board-ets rot. Selektorene er da
scopet til `#board` selv, ellers ville nav-modalens kort havnet i det samme
registeret — to board som registrerer det samme elementet kjemper om det.
`boardRowBoard` har `board` som rot (element-kassene ligger inne i kortene), og
nav-board-ene har HELE nav-modalen (område-kassen ligger i modalens egen fot,
utenfor både `#nav-board` og modalens rullende kropp).

**Dra-tilstandene males på `.dnd-surface`.** Hver dra-rot — nøyaktig de
elementene `scope.root` peker på (`#board`, `#notes-board`, `#nav-board`,
`#notes-nav-board`, `#ideas-body`) — bærer
markørklassen `.dnd-surface`, og HELE dra-blokken i `styles.css` er scopet til
den (det løftede objektet, hullet, søppel-vasken, kategoriens kompakte
løfteform). Reglene sto tidligere på `.board`, og da fantes de bare der et board
fantes: idémodalen er ingen board, så et drag der hadde hverken et malt hull
eller en ugjennomsiktig løftet kategori — bare dnd-kits egne standarder. Får
appen en fjerde dra-flate, er markørklassen det ene den må ha.

**`.items-done` er ikke en container.** Selektorene er barn-selektorer, så
«Utført»-radene registreres aldri: de deltar ikke i rekkefølgen, og et trykk på
dem løfter ingenting.

Identiteten leses fra DOM-en (`idAttribute: 'data-id'`). Containerne bærer
`data-dnd-container`: nav-kolonnen `nav-col`, notat-navigasjonens kolonne
`notes-nav-col` (og hvert prosjekts `.items-container` prosjektets egen id),
board-kolonnene sin INDEKS
(`stampBoardColumns`), hvert områdes/korts `.items-container` sin egen id, hver
kategoris `.cat-items` kategoriens id. Kassene og 📁-breadcrumben bærer
`data-dnd-zone`.

## `drag` — den ene posten om draget som pågår

`drag` fylles fra dnd-kits `dragOperation` (`dndSyncIntent`), og alt Huskis-eid
leser den: `draggedRect`, `dragOverCard`/`cardBand`, peek-lagene, skillelinjene,
søppelkassen, `finishDrag`. Det er også den som holder `relayoutBoard` frosset
gjennom draget og hindrer at et board-drag starter oppå et nav-drag.

`Smett.intentRectangle()` gir den UKLEMTE boksen. **Intensjonsboksen må være
LAYOUT-boksen**: `intentRectangle` er målt på elementet slik det MALES, og vi
skalerer det 1,02/1,03 mens det er løftet. To piksler der er forskjellen på å
være i lista og å falle ut av den — en peek rakk ikke å åpne fordi den nedre 1/3
lå 0,3 px for lavt. `dndSyncIntent` beholder derfor SENTERET (skalaen er
sentrert) og bytter størrelsen mot objektets egen `offsetWidth`/`offsetHeight`,
målt ved løft (`dndNoteLiftedBox`).

## Aktivering: trykk-og-hold på touch, avstand på mus

Dra-håndtakene finnes ikke; draging inviteres på objektets navn-/tittelsone
(`handleSelector`). To modi etter inn-enhet:

- **Touch/pen (mobil)**: trykk og HOLD (200 ms) løfter — nødvendig for å skille
  drag fra scroll på en berøringsskjerm. Beveger fingeren seg mer enn 10 px FØR
  holdet er ferdig, tolkes det som scroll/sveip og avbrytes.
- **Mus (desktop)**: INGEN delay — draget starter idet pekeren beveger seg forbi
  5 px med knappen nede. En mus har ikke fingerens naturlige vandring, så
  terskelen kan være lavere uten at et vanlig klikk blir et drag.

Et rent klikk (ingen bevegelse) gjør fortsatt det klikket pleide — omdøp, bytt,
kryss av, kollaps.

**Sonene og unntakene.** Hvert objekt har nøyaktig én knapp til høyre
(`.obj-menu-btn`, se [`menus.md`](menus.md)), så unntaket er det samme overalt:

| Nivå | Dra-sone |
|---|---|
| område / liste | hele korthodet (`.card-head`) |
| mappe / listepunkt | hele raden (`.item`) |
| kategori / mappekategori | hele overskriftslinjen (`.cat-head`) |

Kategorien drar bare på OVERSKRIFTEN, ikke på hylla under: der ligger medlemmene,
og et trykk der skal ikke løfte kategorien.

**«Skal ikke starte et drag» uttrykkes som `data-dnd-ignore`** på det som ikke
skal løfte noe: menyknappen, avmerkingsboksen, ＋-raden i en kategori,
meta-chipene (`fillMetaRow` — et tregt trykk skal ÅPNE dem), det åpne navnefeltet
(`editText` → `.edit-input`, der et hold ville blokkert caret-plassering og
markering), et avkrysset listepunkt (det ligger i «Utført» og deltar ikke i
rekkefølgen), og hele dra-sonen på et objekt man ikke har lov til å omrokkere:
en låst mappe på raden, en låst mappekategori på `.cat-head` (ikke på hele
kategorien — det ville tatt mappene inni med seg), fri-beholderen på korthodet,
korthodet i en frossen liste.

Gatingen er `canReorderObj`, og den feiler LUKKET: mangler capability, står
`data-dnd-ignore`. Den spør **FORELDEREN** der plasseringen tilhører den — et
listekort krever i tillegg `canAddList(activeGroupObj())`, siden rekkefølgen
blant søskenlistene er mappens struktur, akkurat som mapperadene krever
`reorderInParent` på området. Uten det kunne en liste med lås-unntak i en låst
mappe dras rundt mens serveren forkastet hver posisjons-skriving.

**Cursor:** dra-sonene for listepunkt/kategori får `cursor: grab` (åpen hånd —
«klikk-og-hold/dra drar»), mens område/mappe/liste har `cursor: pointer` (der er
klikk den primære handlingen: bytt/kollaps). Mens holdet registreres (KUN
touch/pen, der holdet tar tid) får objektet et lite «press» (`.drag-hold`, scale)
— hoppes over ved `prefers-reduced-motion`.

**Klikket etter draget.** dnd-kit binder `preventDefault` på `click`, men ikke
`stopPropagation` — og våre egne klikk-lyttere (korthodet kollapser
lista/området, mapperaden navigerer) fyrer likevel. Vakten tar klikket på
DOKUMENTET, i capture-fasen, for det første klikket etter et drag
(`dndInstallClickGuard`, delt av alle board-ene). En vakt på KILDENS sone holder
ikke: et ekte slipp over en ANNEN rad gir et tiltrodd klikk på DEN raden.

## Plassering underveis

Bytte utløses av **overlapp**, ikke av et punkt (Smetts hysterese-detektor). Den
måler hvor mye av NABOEN det løftede objektet dekker langs dra-aksen, og tar den
nærmeste naboen som slipper gjennom:

- **Fremover er ivrig**: ≥ **20 %** av naboen er nok.
- **Å angre siste bytte er det ikke.** Rett etter et bytte ligger geometrien ofte
  slik at det MOTSATTE byttet straks trigges igjen (naboen har nettopp relokert),
  og objektene hopper frem og tilbake. Reverseringen av forrige bytte — samme
  nabo, motsatt side — møter derfor to hindre; vanlige bytter er urørt:
  (a) **tidslås** — reverseringen avvises i 300 ms etter byttet; (b)
  **overlapp-hysterese** — etterpå krever den ≥ 50 % overlapp, ikke bare 20 %.
  Asymmetrien er poenget: én høy terskel ville kjøpt den samme stabiliteten ved å
  gjøre HVER omrokkering treg, mens dette bare krever noe av det tilfellet som
  vanligvis er en rykning. Det er dessuten bevisst mildere enn full
  senter-kryssing (som overskjøt inn i NESTE nabo), så en bevisst tilbakeføring
  er fortsatt lett.
- **Retningen er borte, og reverseringslåsen gjør jobben den gjorde.**
  Detektoren har ingen retningsinngang — den tar nærmeste godkjente nabo. Det er
  en bevisst forenkling i Smett, og den koster ikke noe her: låsen er nettopp det
  som hindret at man byttet tilbake med den man kom fra.
- **Kolonneporten**: en nabo må dele ≥ **50 %** på TVERS av dra-aksen (Smetts
  `crossAxisRatio`) for å telle i det hele tatt. Et kort i nabokolonnen ligger i
  samme loddrette bånd, og uten porten leser dets vertikale overlapp som et
  bytte.

**Board-ets kolonner er ekte containere** (`.board-col`, se
[`board-layout.md`](board-layout.md)), og fordelingen er FROSSET mens et drag
pågår. Det er en DnD-forutsetning, ikke bare layout: med CSS multi-column kunne
en plassholder i én kolonne dytte et kort over i en annen, og siden svaret på
«hvilken liste er objektet i?» leses av nettopp den layouten, vekslet
plasseringen frem og tilbake for hver piksel.

**Plasseringen mellom rader er overlapp-basert hele veien.** Et lavt listepunkt
rekker ikke 20 % av en høy kategori, og da flytter hullet seg ikke — men slippet
lander riktig, se neste avsnitt.

### Forhåndsvisningen når ikke alltid fram; slippet gjør det

dnd-kits optimistiske sortering flytter raden UNDERVEIS bare når den overlapper
en RAD. Er det ingen rad å overlappe — stripen over første rad, stripen under
siste, en kategori som er for høy til at et listepunkt dekker en femtedel av
den — er CONTAINEREN selv slippmålet, og plasseringen avgjøres først ved SLIPPET
(Smetts `AuthoritativeDrop` → `insertByPoint`, som er punktbasert). Slippet
lander riktig; det er bare hullet som ikke rekker å flytte seg først.

Det er derfor kollisjonsdetektorene under finnes: de gjør containeren til et
svar, slik at slippet har et mål å lande i.

**Unntaket er en TOM container** — en tom liste, en tom kategori. Der finnes det
ingen rad å overlappe i det hele tatt, så hullet ville aldri kommet etter, og
draget ga ingen tilbakemelding før man slapp. Smett kjører derfor den samme
`insertByPoint` underveis når slippmålet er en tom container, slik at hullet
ligger der før man slipper.

Og bare der. En container som fortsatt har rader er dnd-kits å sortere i, også i
de rammene der en høy nabo lar containeren vinne runden. To regler på samme
liste er verre enn én: `insertByPoint` leser naboenes sentre i en layout hullet
ennå ikke er en del av, så flyttingen den gjør skyver hvert eneste senter den
nettopp leste — og dnd-kits overlapp-regel fører så raden videre forbi det
punktet ba om. MÅLT: et sikte 18 px under en nabos senter havnet en hel rad OVER
den. Slippet er autoritativt der, og det måles én gang, når ingenting lenger
flytter seg under det (`peohol/smett#9`).

**Sluttplasseringen er autoritativ.** Den løpende plasseringen er
overlapp-basert, og den SISTE bevegelsen før et slipp kan være koalescert bort
eller helt utelatt (rask gest, eller en peker som bare hoppet fra nedtrykk til
slipp) — hullet kunne da bli stående fra nest siste bevegelse. Ved slippet
kjøres derfor én siste plassering fra de FAKTISKE slipp-koordinatene, for alle
fem nivåene. Den er **ren punktbasert** (`insertByPoint`): hverken 20 %-terskelen
eller reverseringslåsen gjelder der — slipp-punktet ER brukerens tydelige
sluttintensjon, og et raskt slipp skal lande der, ikke ett hakk unna.

### Politikken regnes om på BÅDE `dragmove` og `dragover`

dnd-kit oppdaterer sin egen posisjon og kjører sin egen kollisjonsrunde uten
alltid å melde en `dragmove`: etter en peek-utvidelse er pekeren målt å flytte
seg 100–400 px, `dragOperation.position` følge med og `dragover` fyre — men ingen
`dragmove`. Da ville peek-laget og ekstraheringsmodusen blitt stående på forrige
posisjon. `dndRowPolicy` henger derfor på begge krokene.

Testene merker det samme fra utsiden, og sender hver bevegelse som TO punkter —
som `travel()` i `tests/dnd-gestures.js` gjør, av samme grunn.

**Står pekeren stille, står svaret stille.** Det er ikke en optimalisering, det
er hele stabiliteten: vår egen plassering flytter radene, og en ny runde på det
SAMME punktet leser den nye layouten som en ny intensjon (målt: en rad lagt inn
over en kategori dyttet kategorien ned under pekeren, og neste runde leste det
som «legg raden i kategorien i stedet»).

Endrer svaret på «hvilken container?» seg, ber vi om en NY kollisjonsrunde
(`dndSetRowTarget`): dnd-kits runde løper FØR våre lyttere, så runden som nettopp
gikk brukte det forrige svaret — og står pekeren stille etterpå, kommer det ingen
ny.

## `beforedragstart` er den eneste kroken før målingen

dnd-kit måler det løftede objektet ÉN gang (`shape.initial`, som
`intentRectangle` regner ut fra). Alt som endrer objektets størrelse ved løft må
derfor skje FØR den målingen, og `beforedragstart` er den eneste kroken som
kjører der: kollapsen av alle kort, og kategoriens sammenfolding.

**Lister og områdekort kollapser mens ett dras**
(`boardCollapseCardsForDrag` / `navCollapseCardsForDrag` →
`restoreCardsAfterDrag`): BÅDE det dratte kortet og alle de andre foldes til bare
korthodet → board-et blir kompakt og dra-avstanden kort. MOMENTANT, ingen
animasjon (samme som rullgardinen, se `collapseCardBody`/`expandCardBody` i
[`design-system.md`](design-system.md)). `card.collapsed` røres IKKE under draget;
ved slipp gjenopprettes hver liste til sin lagrede lukketilstand — robust mot en
samtidig synk-rebuild, som uansett bygger kortene fra `card.collapsed`.

**Kategorien folder sammen hylla si MOMENTANT** (`dndCollapseCategory`), av samme
grunn: en boks som krymper etter målingen ville latt treffdeteksjonen sikte med
en kategori som ikke lenger er så høy som den ble målt. Ved slipp folder
`dndSettleCategory` den ut igjen — MED MINDRE kategorien er klikk-kollapset
(rullgardin, `item.collapsed`), da beholdes den kollapset. Ekstraheringen bruker
den animerte `expandCategory` i stedet, siden den nye lista bygges opp rundt en
kategori som skal folde seg ut. Dette (drag-kollapsen) er en EGEN mekanikk fra
rullgardin-kollapsen (`collapseCatBody`/`expandCatBody`, se
[`design-system.md`](design-system.md)).

### Board-vakten: grepet holder, og bunnen synker ikke

dnd-kit maler det løftede objektet fra der elementet FAKTISK LÅ da det ble målt —
ikke fra grepet. Kollapsen flytter nettopp det kortet man tok tak i, så uten
kompensasjon løsner kortet fra fingeren med akkurat den avstanden. Vakten gjør
derfor to jobber på én gang, for ALLE inputtyper og ALLE layouter:

1. **Grepet holder.** `padding-top` på board-et legger tilbake nøyaktig det
   kortet flyttet seg: toppen måles FØR kollapsen og skiftet ETTER, så
   regnestykket gjelder uansett kolonne og kolonneantall. Board-et er
   `box-sizing: border-box`, så padding-en spiser av innholdet og totalhøyden står
   stille.
2. **Board-bunnen synker ikke** (`min-height` = board-høyden før kollaps).
   Krymper board-INNHOLDET mens fingeren er nede, faller sidens maks-scroll brått
   under gjeldende `scrollY`; Android Chrome klemmer da `scrollY` oppover, og en
   slik scroll-klemme avbryter touch-en (`pointercancel` → draget dør).

Punkt 2 gjelder RADNIVÅET også, av en annen grunn: en kategori folder sammen
hylla si ved løft, og en full hylle er lett hundrevis av piksler.
`boardFreezeForRowDrag` holder board-høyden på samme måte. Kategorien trenger
derimot ingen padding-kompensasjon — hylla ligger UNDER overskriften, så
kategoriens egen topp flytter seg ikke.

I nav-modalen (`navCollapseCardsForDrag`) er regnestykket det samme, men grunnen
en annen: modalen er loddrett sentrert og re-sentrerer når innholdet blir
kortere, så kortet ville løsnet fra fingeren med opptil ~100 px. Board-høyden
fryses (modalen re-sentrerer da ikke) og kompenseres med `padding-top`.

**Og kollapsen er bare den ene halvdelen der.** Område-kassen ligger i modalens
egen fot og er skjult når den er tom, så et drag som avdekker den gjør HELE
modalen høyere — og en sentrert modal flytter da innholdet oppover. MÅLT: kortet
hoppet 37 px opp under fingeren i det draget startet. Kompensasjonen
(`navHoldGrab`) måles derfor ETTER `armDragTrash`, ikke bare etter kollapsen, og
gjelder både kort- og raddrag. For et raddrag er board-høyden ikke frosset, så
padding-en gjør board-et høyere og den sentrerte modalen gir halvparten tilbake;
målingen gjentas derfor til gapet er lukket (tak: tre runder).
`dnd-nav-engine` sjekk 11 er vakten, og den må kjøre mens modalen er KORTERE enn
sin maks-høyde: en full modal ruller kroppen i stedet, og skiftet finnes ikke.

`boardReleaseBoard` / `navReleaseBoard` (kalt fra `onCommit`/`onZoneDrop`/
`dragend` MOMENTANT rett etter `restoreCardsAfterDrag`) fjerner `min-height` +
`padding-top` i samme oppgave → én reflow maler den ferdige layouten uten et
mellomsteg. `overflowAnchor: none` på `<html>` under draget hindrer at
nettleserens scroll-anchoring rykker siden når kortene kollapser; `finishDrag`
slipper den igjen.

## Politikken som måtte uttrykkes som kollisjonsdetektorer

dnd-kits containere treffes normalt av `pointerIntersection` mot sin egen boks.
Huskis' regler er ikke boks-regler, så containerne har egne detektorer. Tre ting
om mekanikken: en `collisionPriority` på ENTITETEN overstyrer prioriteten
detektoren svarte, så en droppable som trenger to prioriteter får
`collisionPriority = null` og bestemmer selv; radene inne i en container er
dnd-kits egne (hysterese-detektoren, Normal prioritet), så containeren er bare
fallbacken under dem; og detektorene settes på nytt for hver bevegelse
(`dndTuneRowCollisions` fra `dndRowPolicy`), ikke bare ved løft. Det siste er
Smetts: den skriver detektoren på hver RAD ved hver `sync()` — en rad som holder
en container av sitt eget (altså kategorien) får Smetts egen vertsdetektor — og
den synker midt i gesten når den forhåndsviser et slipp i en tom container.
Containernes egne detektorer og prioriteter rører den ikke.

Smetts vertsdetektor sier omtrent det samme som vår, men ikke det samme: den lar
en kategori som er KOLLAPSET konkurrere som en vanlig nabo, og den regner
overskriften som en del av kategori-raden. Begge deler er Huskis-regler den ikke
kan kjenne (peek, og «overskriften er en vei INN»), så vår detektor er den som
skal stå der.

- **KORTET velger container, ikke pekeren** (`dndPickRowContainer`,
  `dndLevel1Collision`). Først «hvilket kort er objektet i?» — avgjort av
  objektets egen boks mot kortets kant (1/3-tersklene under), ikke av
  pekeren — og så, inne i det kortet, velger pekeren mellom nivå 1 og en
  kategoris hylle. Et sikte rett under siste rad, på ＋-knapperaden, er innenfor
  kortet men utenfor `.items-container`; med ren boks-testing traff det
  ingenting, og raden ble liggende igjen.

  Svaret regnes ut ÉN gang per pekerbevegelse: `dragOverCard` har hukommelse
  (`drag.overCard`), og et svar regnet på nytt midt i en frame ville lest en
  annen layout enn den bevegelsen svarte på — da skifter bevegelsen og
  kollisjonen på å ha rett, én gang per frame.

- **Kategoriens OVERSKRIFT er en vei INN i kategorien** (`dndShelfCollision`).
  Pekeren inne i en kategori — overskriften like mye som hylla — betyr «legg
  raden i kategorien». For dnd-kit er overskriften en del av kategori-RADEN, så
  et sikte der ville lest som «bytt plass med kategorien». Hylla svarer derfor på
  overskriften også, med høy prioritet; står pekeren i selve hylla, svarer den
  med lav, slik at radene der bestemmer plassen. En KOLLAPSET kategori er unntatt
  — der er hylla uten høyde, og nivå 1 gjelder til peek har foldet den ut.

- **En kategori pekeren står INNI er ikke en nabo — den er MÅLET**
  (`dndCategoryRowCollision`). Kategorien er den eneste raden som også er en
  container, og hysteresen byttet det løftede listepunktet med kategori-RADEN
  mens pekeren allerede var inne i kategorien: kategorien hoppet en radhøyde
  oppover, siktepunktet ble liggende under den, og raden landet ved siden av
  kategorien i stedet for i den — og var hylla TOM, fantes det ingen rad inni å
  sortere mot som kunne rettet det opp.

  **Svaret må leses av pekeren dnd-kit selv holder**
  (`dragOperation.position.current`), i detektoren. En vakt hengt på `dragmove`
  svarer på FORRIGE bevegelse, siden den kroken løper ETTER kollisjonsrunden — og
  en vakt som leser forrige bevegelse er ikke en sen vakt, den er en gal en. Det
  ble først prøvd med et NOTAT i stedet («radene konkurrerer bare inne i
  containeren totrinnsregelen valgte»), og det gjorde vondt verre: et for gammelt
  svar ble til et VETO, og et slipp nederst i en liste sluttet å bytte plass med
  siste rad. Gjelder bare listepunkt-drag — en kategori kan ikke ligge i en
  kategori.

- **En KOLLAPSET kategori er ingen nabo** — samme detektor, samme grunn. Se
  stabilitets-vakten under [«Peek»](#peek-åpning-av-kollapsede-dra-mål-updatepeek-peek_ms--200-ms).

- **Kolonnen er siste utvei.** Et slipp NEDENFOR alt innhold i en kolonne betyr
  «sist i den kolonnen», ikke «ingenting» — og `pointerIntersection` mot
  kolonnens egen boks sier «ingenting» der, for kolonnen slutter der innholdet
  slutter. Nav-modalen har nøyaktig én kolonne og kan svare ubetinget
  (`navColumnCollision`); hovedsidens board har flere, og bare ÉN av dem kan være
  svaret, ellers ville alle meldt seg samtidig for et slipp i lufta under
  board-et. Hvilken avgjøres av KORTETS EGEN BOKS (`boardPickColumn`, regnet ut
  én gang per bevegelse), ikke av pekeren. Prioriteten er den lavest mulige, så
  kolonnen aldri vinner over et kort eller en sone.

- **Kortet legges tilbake BLANT kortene** (`navSettleCardInColumn`) — ikke en
  detektor, men den samme saken: sluttplasseringen legger kortet sist i
  containeren når slippet er nedenfor alle kort, og sist i nav-kolonnen er etter
  seksjonsoverskriften for neste seksjon.

## Kategorier: to nivåer i en liste ([`data-model.md`](data-model.md))

En liste har nivå 1 (ukategoriserte listepunkter + kategorier, om hverandre) og
nivå 2 (listepunktene inne i hver kategori). DOM: kortets `.items-container`
holder nivå-1-radene (`.item` og `.category`); hver `.category` har en overskrift
på listeflaten + en nøstet `.cat-items`-liste (nivå 2) som er en innrykket
fordypning («hylle», se [`design-system.md`](design-system.md)).

**Ett board, to containernivåer.** `.items-container` og `.cat-items` er
containere i det SAMME board-et. Det er det som gjør at et listepunkt kan dras
fra én liste til en annen, og inn og ut av en kategori, uten å krysse en
board-grense.

**Kategorien er både rad og container.** `itemType` gir den typen `category`
(`groupcat` i nav-scopet), og `containerAccept` sier at `.cat-items` bare tar
`item` (`group`) — kategorier nøstes aldri. Regelen avvises dermed UNDER draget,
av dnd-kits egen `accept`-port, ikke etter slippet.

Ved slipp bygges kortets `items` fra HELE DOM-treet (`reconcileRows`: nivå 1 +
hver kategoris `.cat-items`), og `it.cat` settes; kun det flyttede listepunktets
`home`/`cat`/`pos` stemples (kirurgisk — `cat` rir på posisjonsregisteret som
`home`).

**Utseendet under draging.** Det løftede objektet skal lese som en kompakt rad,
ikke et stort felt: kategori-ikonet (`.cat-drag-icon`, `ICONS.category`, skjult i
hvile) vises til venstre for tittelen; tittelen blir SVART uten skygge
(hvit-på-hvit var uleselig mot den hvite dra-flaten); menyknappen og ＋-raden
skjules `display: none` (ikke bare opacity) så overskriften får element-høyde;
`::before`/`::after`-skillelinjene skjules (`content: none`) så de ikke males på
det løftede objektet; polstring/radius = et listepunkt (6 px / 10 px) + `gap: 0`.
Uten de fire siste leser objektet som en beholder med luft i.

**Oppløs kategori** (`dissolveCategory`, boble-sprekk-knappen): listepunktene blir
ukategoriserte og «arver» kategoriens plass i nivå-1-lista (fordeles jevnt i
pos-gapet mellom kategorien og neste nivå-1-rad, rekkefølge bevart), og selve
kategori-raden tombstones + fjernes.

## «Hvilken liste er objektet i?» — 1/3-terskler (`dragOverCard`)

Grensen mellom lister avgjøres av det LØFTEDE OBJEKTETS boks (`draggedRect()`,
uklemt), ikke av pekeren. Pekeren sitter der man tok tak, så et pekerbasert svar
gjorde ny-liste-placeholderen mye lettere å få frem oppover enn nedover.

Referanselinjen er **kortets egen kant** — de SAMME linjene inn og ut. «1/3 har
passert» = 1/3-linja ligger på andre siden av kanten:

| Bevegelse | Modusen skifter når … |
|---|---|
| INN, nedover | objektets **øvre 1/3** har passert kortets **overkant** |
| UT, oppover | objektets **øvre 1/3** har passert kortets **overkant** |
| INN, oppover | objektets **nedre 1/3** har passert kortets **underkant** |
| UT, nedover | objektets **nedre 1/3** har passert kortets **underkant** |

Det er altså én regel: **objektet er i lista når dets midtre 1/3 ligger innenfor
kortet** (`cardBand` + `inCard` i `dragOverCard`). Sagt motsatt: raden forlater
lista først når en tredjedel av den stikker utenfor kanten. Reglene er rent
loddrette — **flerkolonne** (desktop) håndteres av pekerens x. Innenfor en liste
er det fortsatt PEKEREN som velger rad/kategori. Valget henger igjen i
`drag.overCard`; er flere kort aktuelle, vinner det man alt er i.

**Sonen var en gang INNHOLDSSONEN** — fra midt i listetittelen til midt i
＋-knapperaden — med rammeradene regnet som «ikke innhold» og halve rammeraden som
slark. Det gjorde at raden var utenfor lista mens den fortsatt lå tydelig oppå
den: allerede over knapperaden, og et godt stykke før søppelkassen, sto
ny-liste-stripa og lovet en ny liste. Og kassen er nettopp der man skal kunne
sikte (se [«Kassen slår ekstraheringen»](#kassen-slår-ekstraheringen)). Rammen er
en del av kortet man ser, så den er en del av lista man er i.

**Ingen dødbånd, og ingen hysterese å regne på.** Både inn- og ut-terskelen er den
samme kanten, og et modusbytte flytter ingenting: ny-liste-stripa tar ingen plass
(se under), og dnd-kits klone blir liggende i lista raden kom fra. En monoton
bevegelse gir derfor nøyaktig `reorder(A)` → `extract` → `reorder(B)`, uten at
noe kort rykker.

Slik var det ikke. Ny-liste-placeholderen var kort-formet, altså 72+ px, og hvert
modusbytte skjøv alt under den i kolonnen. Maskineriet som holdt det i sjakk —
`MIN_BAND_SLACK`, `noteOverShift`, `drag.overGrace` — kompenserte for ETT slikt
hopp om gangen, og det holdt ikke: dro man videre ned i lista under, forsvant
placeholderen, kortet smatt oppover, og raden havnet UNDER sonen den nettopp
siktet på. Man måtte dra oppover igjen for å treffe. Med en stripe som ikke tar
plass finnes hoppet ikke, og hele det maskineriet er borte.

Peek-åpning av kollapsede mål bruker samme `dragOverCard`, ellers kunne
plasseringen stå og vente på en peek som aldri startet fordi pekeren ennå ikke var
inne i kortet.

## Dra-ankeret: layouten flytter seg BORT fra siktet

Mens en rad dras, vokser og krymper containerne: kasseraden kommer i lista
objektet er i og forsvinner fra den det forlot, og hullet bytter liste. I normal
flyt absorberes hver slik endring NEDOVER — alt under den flytter seg — og da
smetter nettopp det man sikter på unna fingeren i samme øyeblikk som det ble
laget.

Ankeret snur retningen: **den nærmeste FASTE kanten på eller under siktet skal
stå stille, og board-et gjør jobben OVER den i stedet.** Sagt som regelen
brukeren ser: det som kommer, kommer MOT deg; resten av siden — det du uansett
ikke sikter på — forskyver seg og lager rommet.

- **Siktet** er objektets eget senter (`draggedRect`), samme referanse som
  1/3-tersklene. Objektet ligger i top layer og følger pekeren, så siktelinjen er
  en VIEWPORT-linje: den flytter seg ikke av at vi scroller.
- **Faste kanter** er de som ikke rører seg av en ren OMROKKERING: kortkantene,
  ＋-raden og kasseraden. Radene selv er ikke med — bytter hullet plass med en
  nabo, er det forhåndsvisningen, ikke et hopp som skal settes av.

**To knapper, i denne rekkefølgen.** `padding-top` på board-et skyver innholdet
NED; den er vår egen, koster ingen scrollposisjon, og er det synlige «ekstra
rommet over lista». Skal innholdet OPP og padding-en er tom, scroller vi i
stedet. Board-toppen går da opp forbi toppmenyen — men `anchorMakeRoom` hever
board-ets `min-height` først, så scrollområdet vokser like mye og toppen er
fortsatt å nå. Gulvet senkes aldri under draget: en side som blir kortere mens
fingeren er nede får scrollen klemt, og en klemt scroll avbryter touchen (se
[Board-vakten](#board-vakten-grepet-holder-og-bunnen-synker-ikke)). Rekkefølgen
gjør turen reversibel — ned fyller padding først, opp tømmer padding først — så
et drag som snur går samme vei tilbake. MÅLT (`dnd-layout-anchor` sjekk 6): fram
og tilbake mellom to lister fire ganger gir en stabil syklus, ikke et board som
vandrer.

**Kompensasjonen måles på ankerets DOKUMENTposisjon** (boks + scroll), som bare
endrer seg av layout. En scroll — brukerens egen eller dnd-kits auto-scroll — går
derfor rett gjennom uten å bli tatt for et hopp.

### To deler, med hver sin rekkevidde

1. **VÅRE EGNE endringer** — kasseraden som dukker opp eller forsvinner — måles
   rundt selve endringen (`withAnchor`) og settes av uansett hvor i layouten de
   skjer, også inne i kortet man svever over. Vi vet hva de er og når de skjer.
2. **dnd-kits egne** — hullet som bytter liste — fanges av en `ResizeObserver`,
   og da BARE for kort som ligger HELT OVER siktet.

Grensen i punkt 2 er målt fram. Endrer kortet man er INNE I høyde, er det
motorens egen forhåndsvisning av slippet, og å kompensere for den flytter radene
under fingeren — som motoren så leser som en ny intensjon neste runde. MÅLT: en
rad dratt opp forbi en kategori landet én plass for lavt, hver eneste gang
(`dnd-separators-preview` sjekk 3). Av samme grunn rører **politikkrunden ikke
ankeret i det hele tatt**: en tvungen layout midt i runden endrer det dnd-kit
selv leser rett etterpå.

### Hva det gir, retning for retning

| Situasjon | Hva som står stille |
|---|---|
| Ned mot neste liste: kasseraden forlater lista over | målkortets overkant, og kildekortets underkant (ekstraher-terskelen) |
| Ned videre: hullet forlater lista over | målkortet — det rykker ikke oppover under fingeren |
| Ned inn i neste liste: kasseraden opprettes der | kortets overkant; kassen vokser nedover, bort fra siktet |
| Opp inn i lista over: kasseraden opprettes der | kortet UNDER; kassen vokser OPPOVER, og siktet lander inni den |

Rommet som blir til overs legger seg øverst i board-et, og rommet som trengs tas
derfra igjen når draget snur. `dnd-layout-anchor` måler alle fire radene, på
desktop og mobil.

**En kompensasjon er et LÅN, og lån skal gjøres opp.** Ankeret holder én kant i
ro, og hvilken kant velges av hvor siktet er akkurat da. Går layouten tilbake til
en tilstand den har vært i før, mens siktet har flyttet seg i mellomtiden, ser
regelen ingen kant som må stå i ro, og skiftet blir stående. MÅLT: uten
bokføring vokste polstringen til 893 px etter fire turer opp og ned — «luften
over den øverste lista» som bare blir større. Hver kilde fører derfor sitt eget
lån og gjør det opp i det tilstanden er tilbake der den startet:

| Kilde | Lånet gjøres opp når |
|---|---|
| Kasseraden bytter kort (`retargetDragTrash`) | kassa er tilbake i lista draget startet i |
| Hullet forlater et kort HELT OVER siktet (motorens egen flytting) | raden er tilbake i det kortet — ett lån per liste, siden raden kan gå L1 → L2 → L3 og tilbake i motsatt rekkefølge |
| Sammentrekningen av et hull (`syncHoleSpace`) | ingen: den er en TILSTAND på kolonnen, ikke et skift, og finnes nøyaktig så lenge hullet er lukket |

Og paret polstring/scroll må være reversibelt: et negativt skift som polstringen
ikke rakk over ble til en scroll nedover, mens et positivt skift bare la seg på
polstringen igjen. Et positivt skift ruller derfor VÅR EGEN scroll tilbake først.
`dnd-layout-anchor` sjekk 11 måler at ankerets eget bidrag holder seg under det
som faktisk kan mangle over siktet, gjennom fire turer over alle listene.

## Ekstrahering til ny container (rad → nytt kort)

Drar man en **kategori** eller et **listepunkt** UT av listene og holder det over,
under eller mellom dem (dvs. i board-luften, ikke over noe kort), males en flat
stripe i gapet mellom kortene (`.new-list-placeholder`) — slipp der oppretter en
NY liste. Det samme gjelder i nav-modalen: en mappe eller mappekategori dratt ut
i lufta blir et nytt OMRÅDE.

**Stripa SVEVER — den tar ingen plass** (`height: 0`, ingen marg; selve stripa
males av `::before`, løftet opp så den ligger midt i gapet som allerede er der).
Avstanden mellom kortene er nøyaktig den samme med og uten den.

Den var en kort-formet slot med et ＋ i, altså 72+ px, og det var selve
problemet: hvert modusbytte skjøv alt under den. Drar man videre ned i lista
under, forsvinner stripa — og med den gamle placeholderen smatt kortet da
oppover, slik at raden havnet UNDER sonen den nettopp siktet på. Man måtte dra
oppover igjen for å treffe det man alt siktet på. ＋-ikonet er borte med samme
begrunnelse: stripa er et sted, ikke en knapp, og på 10 px er det ikke plass til
et ikon som betyr noe. Dekket av sjekk A6 i
`tests/dnd-extract-thresholds.test.js` (gapet er det samme gjennom hele draget).

`drag.phMode` (`'reorder'` | `'extract'`) styrer modusen;
`*SetExtractMode`/`*SetReorderMode` bytter. `dragOverCard()` avgjør modus hver
runde: er objektet «i» en liste → reorder, ingen liste → extract.
`extractionPos` gir den nye containeren en `pos` mellom placeholderens naboer i
leserekkefølge.

**Slik slås reorder av:** mens modusen står på svarer `*RowAccept` med TOM liste
— ingen container tar imot, dnd-kit finner ikke noe mål, sorteringen står stille,
og plasseringen er vår. Det er Smetts eget svar på «slå av reorder akkurat nå».

## Ett malt hull om gangen

**Bare ETT sted får love en plassering av gangen.** Et malt hull sier «her lander
raden»; ny-liste-stripa sier «her blir den sin egen liste»; en markert kasse sier
«her slettes den». To av dem samtidig lover hver sin plassering, og bare den ene
er sann.

**I ekstraheringsmodus** er stripa plassen som kommer, men dnd-kits klone blir
liggende igjen der raden lå: motoren flytter den bare ved å bytte med en RAD, og
i denne modusen tar ingen container imot. Klonen males derfor ikke mens modusen
står på (dnd-kits egen standard, som `styles.css` ellers slår av).

**På kassen** gjelder det samme: der SLETTER slippet, og verken stripa eller
klonen skal love en plassering. `body.is-over-trash` slår av malingen av begge.
Rødvasken på det som dras og et malt hull utelukker dermed hverandre.

**Og hullet males bare DER RADEN LANDER** (`setHoleAstray` →
`body.is-hole-astray`). Sorteringen flytter klonen bare ved å bytte med en RAD,
og over ＋-raden finnes det ingen: drar man en rad ned i lista under og opp igjen,
blir klonen liggende der nede mens slippet lander i lista man er i
(`dragOverCard`, som kollisjonsdetektorene leser via `dndRowTargetCont`). MÅLT:
et vindu på ~35 px over ＋-raden der klonen sto i lista under og slippet la raden
i lista over. Der males den ikke.

`dnd-trash` sjekk 13 måler hele turen — ned i lista under, opp igjen og fram til
knappen: aldri rødvask og malt hull samtidig, og males hullet, ligger det i lista
slippet faktisk lander i. Males det ikke, tar det heller ingen plass (under).

### Et hull som ikke lover noe tar heller ingen plass (`syncHoleSpace`)

**Listene er alltid maksimalt komprimert.** Males hullet ikke, står lista heller
ikke åpen for det: en rad uten en plassholder i lover en plassering som ikke
finnes. Regelen gjelder alle tre tilfellene likt — ekstrahering, sikte på en
kasse, og et hull som ligger igjen i en annen liste.

Plassen tas av en negativ `margin-bottom` på klonen, som en ARVET variabel fra
containeren (`--hole-shrink`) — ikke som en inline-stil på klonen selv. Klonen er
en kopi av raden som dras, og dnd-kit bygger den om fra originalens
`style`-attributt — det samme attributtet Huskis maler rotasjonen i hver frame
(`dndPaintRotation`). MÅLT: attributtet ble skrevet i sin helhet,
«rotate: …deg; margin-bottom: -56px» ble til «rotate: …deg», og lista sto med en
åpen rad til neste runde.

**Klonens boks er DRA-OBJEKTETS GEOMETRI**, og derfor må plassen tas med margin
og ingenting annet. dnd-kit speiler mål, plassering OG viewport-klemme fra
klonens boks hver frame. MÅLT: `display: none` krympet dra-objektet til 12×12 px;
fryser man målene i stedet, slipper klemmen objektet 269 px utenfor skjermkanten
(`dnd-viewport-clamp`).

Marginene på et skjult hull er Huskis' egne: kategoriens skillemarger
(`.sep-above`/`.sep-below`, 25 px) er en del av løftet om hvor raden lander, og
et hull som ikke lover noe bærer dem ikke.

#### Kompensasjonen: kolonnens polstring, målt hver runde

Kortet krymper med en radhøyde, og alt under det ville rykket opp under
fingeren. **Kolonnen** får derfor en `padding-top` på nøyaktig det den ble
kortere: alt over hullet flyttes ned, alt under står stille.

- **Kolonnen, ikke kortet.** En `margin-top` på kortet selv holdt riktig kant i
  ro, men bare kortet flyttet seg: listene OVER ble stående, og gapet mellom dem
  vokste med en hel radhøyde (MÅLT: 28 → 84 px).
- **Kolonnen, ikke board-et.** Kolonnene er ekte containere som lever uavhengig
  ([`board-layout.md`](board-layout.md)), så en liste som krymper i kolonne 2
  flytter ingenting i kolonne 1. Skyver man board-et, flytter man kolonnene man
  ikke rørte — MÅLT: ny-liste-stripa forsvant fordi kortet i NABOkolonnen kom ned
  over siktet (`board-columns` 3 og 4).
- **Beløpet måles, det gjettes ikke** (`holeMissingPx`): hvor mye mindre plass
  hullet tar nå enn om det sto åpent, regnet på containerens INNHOLD mot dens
  min-høyde. Er raden den eneste i lista, stopper containeren på min-høyden, og
  svaret er mindre enn en radhøyde. Gjettet man hele radhøyden, ble kortet 22 px
  for langt ned, kassa gled ut under fingeren, hullet kom tilbake — og så igjen:
  flimring (MÅLT med pekeren i ro).
- **Det er en TILSTAND, ikke et skift.** Polstringen regnes ut på nytt hver
  runde og finnes nøyaktig så lenge sammentrekningen finnes. Legger man delta på
  delta i stedet, teller man med motorens egne flyttinger, og en polstring lagt
  på for forrige liste blir stående som ren luft (MÅLT: kortet man svever over
  rykket 56 px ned, `dnd-layout-anchor` sjekk 4).
- **Mål FØRST, skriv så — og skriv begge i samme omgang.** Måler man MELLOM
  sammentrekningen og polstringen, tvinger man fram en layout der lista er
  krympet og polstringen ennå ikke lagt på: siden er 56 px kortere i det
  øyeblikket, og er man scrollet til bunnen, klemmer nettleseren scrollen ned —
  permanent. MÅLT på den nederste lista: scrollen hoppet 56 px i det kassa ble
  armert, auto-scrollen dro den tilbake ~10 px per frame, kassa vandret under
  fingeren, og markeringen slo av og på 20 ganger på 500 piksler sakte
  innmarsj (`dnd-layout-anchor` sjekk 12).
- **Retningen:** bare når hullet ligger OVER siktet. Ligger det under — man drar
  oppover, bort fra det — krymper lista nedenfra, og alt over siktet står stille
  av seg selv. Kompenserer man likevel, kommer kanten man sikter MOT nærmere
  fingeren, og ekstraher-terskelen slår inn for tidlig (MÅLT: 30 px,
  `dnd-extract-thresholds` B3).

Ankeret ser bort fra denne sammentrekningen når det måler korthøyder
(`anchorOuterH`): den er alt kompensert der den ble gjort. Trakk man den fra ved
å nullstille høydene i stedet, svelget man motorens endring i det samme kortet i
den samme frame-en.

`dnd-layout-anchor` sjekk 8 måler at ingen container har plass som ingen malt rad
fyller, sjekk 9 at kassa står bom stille med pekeren i ro, sjekk 10 at gapene
mellom listene er de samme som i hvile, og sjekk 12 at en sakte innmarsj mot
kassa i den nederste lista verken får markeringen til å vippe eller scrollen til
å hoppe. `dnd-trash` sjekk 13 måler at et skjult
hull ikke tar plass i NOEN liste. Sjekk A5 i `dnd-extract-thresholds.test.js`
måler at bare ett hull males.

`placeNewListPlaceholder` plasserer stripa:

- **KOLONNEN** etter pekerens x (±8 px slingring). Ingen kolonnetreff (pekeren i et
  kolonnegap) → behold kolonnen placeholderen alt står i. Klemmes til siste kolonne
  som har kort: en tom kolonne lenger til høyre finnes bare fordi vinduet er bredt,
  og en ny liste havner aldri der før kolonnene til venstre er fulle
  ([`board-layout.md`](board-layout.md)).
- **PLASSEN i kolonnen** etter det LØFTEDE OBJEKTETS y-senter — ikke pekerens:
  ut-terskelen (1/3) slår inn mens pekeren fortsatt kan være inne i lista man
  forlot, og et pekerbasert y-valg la da stripa på feil side av den. Målt mot den
  layouten man SER.

**To veier til samme plass:** bunnen av kolonne k og toppen av kolonne k+1 er samme
plass i rekkefølgen, men to ulike containere. Sikter man under siste liste i
kolonne k, havner placeholderen der; sikter man over første liste i kolonne k+1,
havner den der. Sluttresultatet er identisk. Dekket av punkt 4 i
`tests/board-columns.test.js`.

Hva slippet gjør:

- **Kategori → ny liste** (`extractCategoryToNewContainer`): ny liste med samme
  tittel; medlemmene flyttes inn ukategorisert (`cat = null`, `home` = ny liste),
  aktive får `pos` 0..n i bevart rekkefølge, avkryssede/slettede løsnes bare fra
  kategorien. Kategori-raden tombstones + fjernes fra kilde-lista. `render()`
  rebygger board-et rent.
- **Listepunkt → ny liste** (`extractRowToNewContainer`): ny liste med BARE dette
  listepunktet (`cat = null`), tittelen **blank og straks fokusert** så den kan
  navngis med en gang.
- **Oppretter = den som ekstraherer**: den nye containeren lages lokalt med ny id
  og pushes som en ny rad eid av gjeldende bruker (`insertPayload` → `owner_id` =
  meg), uansett hvem som eide kilde-containeren.
- **Låst kilde-liste**: umulig — selve draget er avskrudd (`data-dnd-ignore`), så
  ingen egen vakt trengs i drop-flyten.
- **Opprettelsesrett i FORELDEREN** (`S.canExtract(row)`, sjekket via
  `canExtractDragged()`): ekstrahering LAGER en container, og den myndigheten
  ligger på mappen/området, ikke på det løftede objektet. Board-scopet spør
  `canAddList(activeGroupObj())`; nav-scopet svarer `cap(row, 'move')` — det NYE
  området blir alltid mitt, men å ta mappen UT av det gamle er en flytting
  `move_group` krever destruktiv myndighet i kilden for. Uten retten dukker
  ny-liste-placeholderen aldri opp, og et slipp i board-luften legger objektet
  tilbake der det kom fra. Det er ikke bare teoretisk: et **lås-unntak** på én
  liste i en låst mappe gjør nettopp at objektet kan dras (lista er redigerbar)
  uten at en ny søskenliste kan opprettes.

## Kategori → en annen liste (`moveCategoryToCard`)

En kategori kan dras INN i en annen eksisterende liste (ikke bare reorderes i sin
egen eller ekstraheres til en helt ny). Tre-veis, med mål-lista fra
`dragOverCard`: KILDE-lista → reorder på nivå 1; en ANNEN liste → nivå 1 der
(kategorier nøstes aldri, så alltid `.items-container`); board-luft → ekstraher.

Ved slipp i en annen liste (mål-kort ≠ kilde-kort) flytter `moveCategoryToCard`
kategorien OG alle medlemmene (aktive + avkryssede + slettede) til mål-kortet:
medlemmene beholder `cat`-pekeren, både kategori og medlemmer får ny `home`
(= mål-kortet) og stemples (`home` rir på posisjonsregisteret), kategoriens `pos`
settes mellom slipp-naboene. Board-et rebygges rent med `render()`, så
«Utført»-medlemmer i andre DOM-seksjoner følger korrekt med.

## Peek-åpning av kollapsede dra-mål (`updatePeek`, `PEEK_MS` = 200 ms)

Drar man et **listepunkt** over en KOLLAPSET liste eller kategori — eller en hel
**kategori** over en kollapset liste — og BLIR VÆRENDE der i `PEEK_MS`, åpnes målet
MIDLERTIDIG (peek) så man ser hvor objektet vil lande. Flytter man videre uten å
slippe, kollapses målet tilbake. Peek er ren forhåndsvisning: den rører IKKE
`card.collapsed`/`item.collapsed` og lagrer ikke.

- **To lag samtidig** (`drag.peekCard` + `drag.peekCat`, kun kategori-laget for
  listepunkt-drag): «listen OG/ELLER kategorien» åpnes progressivt — først lista, så
  en kollapset kategori inne i den. Hvert lag har en 200 ms-timer (`setPeekLayer`); et
  allerede peek-åpnet mål (ikke lenger `.collapsed`) beholdes så lenge det er målet.
  Liste-laget bruker `dragOverCard()` (samme 1/3-terskler som plasseringen);
  kategori-laget velges av pekeren, som all annen plassering innenfor en liste.
  `peekExpand`/`peekCollapse` bruker de momentane body-veksel-funksjonene
  (`expandCardBody`/`collapseCardBody`, `expandCatBody`/`collapseCatBody`) + skjuler/viser
  «(N)»-telleren (`peekChip`).
- **Stabilitets-vakt**: MENS et kollapset mål (ennå ikke peek-åpnet) hoveres, skal
  ingenting flytte seg — flyttet vi raden inn nå, ville kilden krympet med en
  radhøyde og målet (særlig en liste UNDER kilden i énkolonne) stukket vekk under
  pekeren, så 200 ms-timeren aldri rakk å løpe ut. Det sies to steder, fordi de to
  slagene mål feiler på hver sin måte:

  **(a) en kollapset LISTE tar ikke imot** — `*RowAccept` svarer tomt for
  containere i et kollapset kort (`dndInCollapsedTarget`), og svaret leses på
  hver `sync()`, altså før draget begynner;
  **(b) en kollapset KATEGORI er ingen NABO** — den ligger som en rad på nivå 1,
  og hysteresen byttet plass med den, så kategorien flyktet oppover før pekeren
  nådde den. En vakt hengt på pekeren kommer for sent (kollisjonsrunden løper før
  våre `dragmove`-lyttere), så den sies i en kollisjonsdetektor:
  `dndCategoryRowCollision` er ikke et treff mens kategorien er kollapset.

  Ved selve SLIPPET lander raden i målet uansett (`dndLandInPeekTarget`), så et
  raskt slipp før peek rakk fortsatt havner der.
- **Ved slipp** (`resolvePeekOnDrop`): et peek-åpnet mål slippet LANDET i forblir åpent
  (persisteres `collapsed = false` + stemples), et peek-åpnet mål man IKKE landet i
  kollapses tilbake. Kategori-slipp INN i en annen liste rebygger med `render()` og
  setter mål-listas `collapsed = false` når den var peek-åpnet. `refreshAllCollapseCounts`
  oppdaterer «(N)» på lister/kategorier som fikk et raskt slipp uten peek.
- **Opprydding**: `clearAllPeeks(recollapse)` river ned begge lag (kalt av `finishDrag`
  som sikkerhetsnett → kollapser tilbake ved avbrudd), og hvert board nullstiller
  `drag.peekCard`/`peekCat` ved løft.

## Skillelinjene forhåndsvises under draget (`applyDragSeparators`)

I hvile males linjene rundt en kategoris hylle av pseudo-elementer på selve
kategorien (`.category::before/::after`, se
[`design-system.md`](design-system.md)): en linje mellom to nabo-rader på nivå 1
når minst én av dem er en kategori. De reglene holder ikke under et drag — de
kjenner ikke den KOMMENDE plassen, og de teller det LØFTEDE objektet som nabo
selv om det ligger i top layer, ute av flyten (som ga fantom-linjer).

Under listepunkt- og kategori-draging tar JS derfor over linjene i de
nivå-1-containerne draget berører: containeren får `.seps-managed` (slår av
pseudo-reglene) og hver rad som skal ha en linje OVER seg får `.sep-above`.
Klonen teller som den raden den representerer, så man ser skillelinjene slik de
BLIR hvis man slipper der hullet står.

- Linjene uttrykkes som **klasser på radene**, ikke innsatte linje-elementer:
  radenes DOM-naboskap brukes av pos-logikken (`rowPos`) og av dnd-kits egen
  sortering, og et element mellom radene ville forstyrret den.
- **Klonen speiler det LØFTEDE objektet.** dnd-kit bygger klonen på nytt av
  objektet ved HVER sortering, og den arver klassene og inline-stilene DENS. En
  linje som skal males på hullet må derfor settes på OBJEKTET (`addSep`), som
  klonen kopierer den fra — og der er den skrudd av i CSS, siden objektet ligger i
  top layer og ikke er en rad i lista. Satt på klonen alene overlever den ikke
  neste bevegelse.
- **Linjene tegnes ÉN GANG TIL på neste frame** (`applyDragSeparatorsSoon`):
  dnd-kit avgjør plasseringen i kollisjonsrunden, men SKRIVER den asynkront, så
  `dragover` fyrer mens radene fortsatt står som før.
- **En rad som er FORFAR til det løftede objektet får aldri `.sep-above`** —
  linja males i stedet speilvendt fra raden OVER (`.sep-below`, `margin-bottom:
  25px` + linja 16 px under raden; identisk geometri). `.sep-above` setter
  `position: relative`, og en posisjonert forfar blir containing block for
  absolutt posisjonerte etterkommere; symptomet var at et listepunkt dratt UT av
  en kategori til nivå 1 i samme liste forsvant. Top layer gjør at nettopp det
  symptomet ikke kan gjenta seg, men speilingen står — geometrien er identisk
  uansett hvilken av de to radene som bærer linja, og det er den formen
  `dnd-separators-preview` måler. Raden over er aldri en forfar (det løftede
  objektet hører til nøyaktig én nivå-1-rad), så byttet er trygt.
- Ryddes med `clearAllDragSeparators` i `finishDrag` og i hver commit. Geometrien
  er identisk i hvile og forhåndsvisning (33 px total luft, linja midt i), så
  byttet er usynlig.

## Søppelkassen er et slippmål mens draget varer

Idet et drag starter, vises kassen for NIVÅET fram (`armDragTrash` — den er
ellers skjult når den er tom), den markeres når man sikter på den, og et slipp i
den SLETTER objektet i stedet for å flytte det.

Kassene er **soner** (`zoneSelector` + `onZoneDrop`), og Smett ruller raden
tilbake dit den kom fra FØR handlingen kalles — nøyaktig semantikken vi vil ha:
ingen ny `pos` skrives, slettingen tar over. Treffsonen er knappen selv; sonen er
en droppable, og dnd-kit måler dens egen boks.

**Kassene som har en HEL rad for seg selv er radbrede mens draget står på** —
listepunkt-kassen nederst i lista, mappe-kassen nederst i området, OG
område-kassen i nav-modalens faste fot (`.nav-foot .item-trash` i
`styles.css` gir wrapperen full bredde, siden foten der ikke deler rad med
noe ＋-knapp). Knappen er ~48 px i hvile: den forsvinner under en fingertupp,
og på berøring finnes ingen peker som viser hvor man egentlig sikter. Bare
BREDDEN endres, så høyden — kortets, eller nav-modalens fot — står stille, og
for kortene betyr det at `cardBand` og ekstraher-terskelen står stille. Kun
topplinjas liste-kasse er annerledes: den deler rad med ＋-knappen og har ingen
ledig bredde å ta av. `dnd-trash` sjekk 11 måler bredden og treffer ytterkanten
av raden (kortene) og feltet (nav-modalen).

- **Kassen FØLGER objektet**: for et listepunkt/en mappe står den i containeren
  objektet er i NÅ (`retargetDragTrash` flytter `drag.trashHost` på hver
  politikkrunde), ikke i den det kom fra. Uten det måtte en rad dratt til en
  annen liste dras hele veien tilbake for å slettes.

  **«Hvilken liste er objektet i?» besvares ÉTT sted.** Kassen bruker
  `dragOverCard` — objektets midtre 1/3 innenfor kortet, [samme
  regel](#hvilken-liste-er-objektet-i--13-terskler-dragovercard) som
  plasseringen og ekstraheringen. En egen terskel for kassen ville vært en andre
  regel på det samme spørsmålet, og da kunne knappen stått i en annen liste enn
  raden ville landet i. Svaret kommer altså FØR dnd-kit flytter raden inn blant
  radene i den nye lista — det er DOM-forelderen, og den skifter først når
  objektet svever over selve radene. `dnd-layout-anchor` sjekk 1 måler nettopp
  den forskjellen.

  Det er den SAMME kassen som flytter seg. Hva slippet BETYR er uendret: raden
  slettes i sin EGEN container — `dropIntoTrash` leser `it.home`, og draget er
  rullet tilbake før den kalles — akkurat som menyens «Slett». Verten er bare
  hvor knappen står mens man drar, og derfor er det fortsatt radens egen
  slette-rett som avgjør om noen kasse armes (`draggedCanBeTrashed`), ikke
  rettighetene i containeren man svever over.

  Et slipp på en ANNEN synlig kasse — en man ikke svever over, eller
  mappe-kassen under et kategori-drag — ruller raden tilbake i stedet for å
  omrokkere den. `*ZoneDrop` sammenligner sone-id-en med `dragTrashBtn()`, som
  leser den nye verten, så vakten holder uendret.

  **En container som ikke tar imot raden får heller ingen kasse.** Sikter man
  mot en LÅST liste eller et låst område, blir slippet der avvist og rullet
  tilbake med en beskjed (se [«Slipp i en LÅST
  mål-container»](#slipp-i-en-låst-mål-container)) — men kassen fulgte etter
  dit og foldet seg ut som et slippmål rett under siktet, og et slipp som
  bommet med noen piksler SLETTET raden i stedet. Én gest, to helt
  forskjellige utfall, og ingenting som skilte dem. `retargetDragTrash` spør
  derfor `S.refusesRow` — det SAMME spørsmålet slippet stiller
  (`navRejectTarget` / `boardRejectTarget`: låst, virtuell, uten
  opprettelsesrett). Det er en regel om MÅL-containeren; radens egen
  slette-rett (`draggedCanBeTrashed`) er uendret.

  Verten velges i tre trinn, og spørsmålet stilles på nytt hver politikkrunde —
  også om VERTEN, ikke bare om den man svever over:

  1. containeren raden svever over, når den tar imot raden;
  2. ellers der kassen står — men bare så lenge DEN fortsatt tar imot raden.
     Et mål kan bli låst MENS draget pågår (en synk-runde), og det er nettopp
     det commit-vakten finnes for. Uten trinnet ville en vert som begynte å
     avvise raden ETTER at kassen flyttet dit blitt stående med et slette-mål
     slippet ikke kan lande i — den samme fella, bare med en annen rekkefølge;
  3. ellers hjem til kilden, som aldri avvises (`*RejectTarget` svarer null for
     containeren raden kom fra). Er kilden borte fra DOM-en, svarer
     `dragTrashBtn()` null og ingenting armes: ingen kasse er det riktige
     svaret når ingen container kan ha den.

  Trinn 2 er også regelen om at kassen aldri slippes helt: forlater raden alle
  containere, blir den stående der den er. MÅLT i begge scopene: `dnd-trash`
  sjekk 14 (både mål som er låst på forhånd og vert som låses midt i draget) og
  `nav-modal` sjekk 9.

  **Raden den forlot forsvinner helt** (`hideRevealedTrash`) — den holder ingen
  plass. Kortet krymper med en hel knapperad, og alt under det ville rykket
  OPPOVER midt under fingeren; det er nettopp den bevegelsen
  [dra-ankeret](#dra-ankeret-layouten-flytter-seg-bort-fra-siktet) tar. MÅLT
  (`dnd-layout-anchor` sjekk 2–3): kildekortets underkant og målkortets overkant
  står begge på pikselen gjennom byttet, og de 59 px kasseraden ga fra seg
  legger seg som `padding-top` OVER lista i stedet.

  **En skjult sone må måles på nytt.** dnd-kit måler en droppable én gang og
  beholder boksen; en kasse vi nettopp skjulte står da igjen med boksen den
  HADDE, og et slipp der leses som et slipp i kassen. `refreshTrashZones` ber om
  målingen selv (en skjult knapp måler 0×0). MÅLT i nav-modalen: en mappe sluppet
  på en rad i området UNDER landet i den skjulte kassen til området den kom fra,
  og ble rullet tilbake uten beskjed (`nav-modal` sjekk 9).

  **Kassen slippes aldri helt.** Forlater objektet alle containere
  (ekstraheringsmodus), svarer `dragOverCard` null og kassen blir stående der den
  var — det er ingen container å flytte den til, og en kasse må finnes til enhver
  tid. `dnd-trash` sjekk 12 måler at den står i ro gjennom 60 frames.

  En LISTE og et OMRÅDE har ingen vert å bytte: de slippes i kassen i topplinja
  respektive nav-modalens bunnrad.
- **Kategorier har ingen kasse.** En kategori slettes ikke — den LØSES OPP
  (listepunktene blir stående), fra objektmenyen. `dragTrashBtn()` svarer null for
  dem, og ingenting armes.
- **Feiler LUKKET** (`draggedCanBeTrashed`): samme capabilities som menyens
  «Slett»-rad. Uten rett vises ingen kasse i det hele tatt, så man kan ikke sikte
  på noe serveren ville avvist.

### Kassen og ekstraheringen

Element-kassen ligger nederst i kortet, under ＋-raden. Det gjorde den uråelig så
lenge sonen var listas INNHOLDSSONE: raden var «utenfor alle lister» et stykke FØR
pekeren var framme ved kassen, ekstraheringsmodusen sto alt på når man kom fram,
og siden ingen container tar imot i den modusen lagde et slipp som bommet på
knappen en NY LISTE i stedet for å slette. MÅLT: 34 px under knappens senter.

Sonen er nå kortets egen kant, og kassen ligger inne i kortet. Dermed er modusen
`reorder` hele veien ned til kassen — stripa lover ingen ny liste mens man sikter
på den, uten at noe måtte fryses.

To ting står igjen, og begge handler om RINGEN rundt knappen
(`pointerOnDragTrash` + `DRAG_TRASH_PAD`, 12 px — knappen er et lite mål, og en
finger treffer den ikke på pikselen):

- **Slippet sletter i hele ringen.** Treffer man knappen, er det Smetts sone
  (`onZoneDrop`). Ringen rundt er `*CommitRow`, som spør kassen FØR den spør
  ekstraheringen: draget rulles tilbake som et avbrutt drag, og slettingen tar
  over — samme vei som sone-slippet. Slipp-punktet leses av Smetts operasjon,
  ikke av vår egen mellomlagring, som kan være koalescert bort i en rask gest.
- **Ingen plassholder lover noe i ringen** (`setTrashHold` →
  `body.is-over-trash`). Ringen kan stikke litt utenfor kortkanten, og der ville
  stripa lovet en ny liste et sted slippet sletter. Det samme gjelder HULLET
  raden kom fra — se [«Ett malt hull om
  gangen»](#ett-malt-hull-om-gangen). Kun
  malingen skrus av; stripa er null uansett, og hullets plass beholdes.

**Markeringen settes begge veier fra `dndRowPolicy`.** Smetts `onDropTarget` fyrer
bare når MÅLET endrer seg, og i ringen er målet null hele tiden — ingen ville da
tatt markeringen av igjen, og kassen ble stående som om den var klar til å ta imot
mens raden lå nede ved ny-liste-stripa.

Dekket av sjekk 10 i `tests/dnd-trash.test.js` (egen økt, begge viewportene).

Autoritativt: [`trash.md`](trash.md) («Slett ved å dra objektet i kassen»).

## Slipp i en LÅST mål-container

DB-vaktene (`*_before_update`) krever redigeringsrett på BÅDE gammel og ny
forelder. Uten en klient-sjekk ville et slipp inn i en frossen liste/et frossent
område sett ut til å lykkes og så blitt snappet tilbake ved neste synk.

**Board-scopet avviser UNDER draget.** Der er regelen om CONTAINEREN alene —
radene i en låst liste kan ikke løftes (`data-dnd-ignore`), så kilden er aldri
selv låst, og hovedsiden har ingen virtuell beholder som må kunne omrokkeres
innvendig men ikke tas imot utenfra. `boardRowAccept` svarer derfor tomt for
containere i en frossen liste: hullet dukker aldri opp der, og raden blir liggende
i stedet for å flytte inn og snappe tilbake. Slippet sier likevel HVORFOR
(`boardWarnLockedTarget`) — uten en forklaring ser det bare ut som om det ikke
virket.

**I nav-scopet avgjøres den ved SLIPPET**, fordi regelen der er
KILDE-avhengig: en fri mappe kan omrokkeres i fri-seksjonen, men ingen mappe kan
flyttes INN i den, og `containerAccept` kjenner bare containeren, ikke kilden.
Skal den også bli en drag-tid-regel, krever det et kilde-argument i Smetts
`containerAccept` — en Smett-endring i egen rett.

Commit-sjekken (`navRejectTarget` / `boardRejectTarget`) står uansett igjen som
vakten for containeren som ble låst MENS draget pågikk. Den **kaster**: Smett
ruller da rekkefølgen tilbake til der draget startet, og en toast sier fra —
`S.lockedTargetMsg`, «Listen er låst – du kan ikke flytte noe hit» på board-et og
«Området er låst – du kan ikke flytte noe hit» i nav-modalen.

Det samme svaret gjelder SØPPELKASSEN: en container som avviser raden får ingen
kasse mens draget varer (`S.refusesRow` i `retargetDragTrash`, se [«Søppelkassen
er et slippmål mens draget
varer»](#søppelkassen-er-et-slippmål-mens-draget-varer)). Ellers sto slette-målet
midt i det ene stedet slippet uansett blir avvist.

## `pos`-regnestykket ved slippet

Ny `pos` regnes mellom naboene i leserekkefølge (`between`, `rowPos`,
`navCardNeighbour`, `dndRowSibling`). Tre ting gjør regnestykket vanskeligere enn
det ser ut:

**Klonen er ikke en nabo.** dnd-kit holder plassen med en KLONE av det løftede
objektet, og den ligger rett etter det med de samme klassene.
`previousElementSibling`/`nextElementSibling` leser den da som naboen, og svarer
«ingen nabo på den siden», altså «sist i lista», uansett hvor man faktisk slapp.
`boardRows`/`isBoardRow`, `dndRowSibling`, `sepRows` og `restoreCardsAfterDrag`
hopper derfor over `[data-dnd-placeholder]`.

**Board-ets kolonner er egne containere.** Naboen over den ØVERSTE raden i en
kolonne ligger nederst i kolonnen FØR, ikke i samme container.
`boardRows()`/`boardRowSibling()` leser derfor på tvers av kolonnene, i
leserekkefølge.

**Områdenes `pos` regnes ALLTID innenfor sin egen seksjon.** Nav-modalen deler
områdene i tre seksjoner, og `renderNav` sorterer på seksjon FØR `pos`. En `pos`
hentet over en seksjonsgrense flytter ingenting dit man ser — den importerer bare
en fremmed verdi inn i seksjonen og stokker om på resten. Det virtuelle «Mapper
delt med meg»-kortet er dessuten aldri en nabo: det har `pos: Infinity`, og
`between(Infinity, null)` er `Infinity`, en verdi som ikke overlever JSON —
slippet ville lagret `pos: null` på medlemskapsraden og slettet brukerens egen
rekkefølge. `navCardNeighbour` er regelen ett sted: den går utover i
leserekkefølge og HOPPER OVER både det virtuelle kortet og kort i en annen
seksjon. Både slippet og ekstraheringen bruker den, og tastaturet har alltid
fulgt den samme regelen (`moveCtx`).

**Seksjonsoverskriftene** i nav-modalen ligger i den samme `.board-col` som
kortene, men `boardRows` filtrerer på `.card`/`.card-placeholder`, så de er aldri
dra-mål.

**Posisjonsbasert farge reindekseres alltid ved en fullført omrokkering** (ikke
bare ved add/slett): commit-en kaller `reindexContainerColors`, som går gjennom
den sorterte lista (samme kilde som render bruker) og setter `colorForIndex(i)` +
oppdaterer CSS-variablene direkte på de allerede eksisterende DOM-nodene —
kirurgisk, ingen full re-rendring (som ville kuttet drop-animasjonen).

## En ombygging må meldes til dnd-kit

Et slipp rendrer board-et eller nav-modalen på nytt, og da byttes hvert eneste
kort og hver eneste rad ut. dnd-kit har fortsatt de GAMLE elementene i registeret
sitt, og de finnes ikke i dokumentet lenger — da er det ingenting igjen å løfte.

Smett følger med på DOM-et selv (`MutationObserver`), men bare mens ingen drar:
endringene som skjer mens en gest står på er dnd-kits egne, og den lar dem være i
fred. Ombyggingen etter et slipp faller nøyaktig mellom de to — den kommer mens
dnd-kit ennå avslutter draget (slippanimasjonen), og etterpå kommer det ingen ny
endring å reagere på.

`renderNav` avslutter derfor med `navSyncBoards()`, som kaller Smetts `sync()`
(«public for a render you know about») på begge nav-board-ene; `renderBoard` gjør
det samme med `boardSyncBoards()`. Mens et drag FAKTISK pågår gjør de ingenting —
da er DOM-et dnd-kits.

Uten den virker det neste løftet først når noe annet tilfeldigvis rendrer på
nytt, som en synkrunde. På mus rakk det ofte akkurat; på touch gjorde det ikke
det, og et andre drag var umulig. `dnd-nav-engine` sjekk 9 er vakten.

### En AVVIST synk er utsatt, ikke forkastet

At synken lar motoren være i fred når den ikke er i ro, er halve regelen.
Rendringen som ba om synken HAR allerede byttet ut nodene — blir synken bare
droppet, står registeret igjen med de gamle, og feilen over er tilbake i full
bredde.

MÅLT: slipp en rad, og løft den igjen mens lagringen fra det første slippet er i
lufta. Svaret fra skyen rendrer board-et mens dnd-kit fortsatt står i `dropped`,
den ene synken faller, og raden lar seg ikke løfte igjen før neste lagring
rendrer på nytt. Sikkerhetsnettene etter et slipp (`boardRelayoutAfter*Drop`)
dekker det ikke: de kjører ÉN gang, og rendringen fjernet nettopp den klonen de
venter på.

`noteSyncOwed` husker derfor den avviste synken og tilbyr begge på nytt hver
frame til de går gjennom. Begge, ikke bare den som ble avvist: `sync()` er
idempotent, og to flagg for det samme er to ting som kan komme i utakt.
`dnd-activation` sjekk 5 er vakten — den rendrer hver frame så lenge motoren står
i `dropped`, og krever at raden både står i registeret og lar seg løfte etterpå.

## Etterarbeidet ved slippet

**Fordelingen må kjøres ved SLIPPET.** Kolonnene er frosset gjennom draget, og et
kort som bytter kolonne endrer som regel den grådige pakkingen. `boardCommitCard`
kjører derfor `relayoutBoardNow` (den samme fordelingen uten drag-vakten):
dnd-kit regner ut hvor det løftede kortet skal fly, og sikter på KLONENS boks.
Kjøres fordelingen først etterpå, flyr kortet til den frosne sloten og
teleporterer så til sin endelige plass — målt til ~1000 px.

Fordelingen må da regne med det løftede kortets **hvilehøyde**. dnd-kit pinner
den KOLLAPSEDE høyden på elementet gjennom hele animasjonen, så `offsetHeight`
svarer feil for nettopp den raden: pakkingen ville fordelt kolonnene på et kort
som «veier» et korthode. Hvilehøyden måles rett før kollapsen
(`boardLiftedRow`/`boardLiftedRowH`, lest av `boardRowHeight`) — den eneste
gangen den er å se. `board-columns` sjekk 9 følger selve flukten: den skal gå mot
hvileplassen hele veien, og ende der.

To ting må vente til draget ikke maler noe mer (`dndAfterCloneGone`, som
`boardRelayoutAfterDrop` og `navScrollAfterDrop` deler). Den venter på BEGGE
merkene, ikke bare klonen: `[data-dnd-placeholder]` holder plassen med den
KOLLAPSEDE boksen, og `[data-dnd-dragging]` sitter på det løftede objektet
gjennom hele drop-animasjonen — der det ligger i top layer og ikke har noen plass
i flyten å måle.

- **Scroll til det slupne kortet.** Klonen holder plassen med den KOLLAPSEDE
  boksen, så innholdet er kortere enn det blir — og scrollen klemmes mot nettopp
  den høyden. `scrollDroppedIntoView` kjøres derfor én frame etter at merkene er
  borte, og slår opp kortet på ID: en synk-runde kan ha rendret board-et i
  mellomtiden, og en frakoblet node måler 0 (scrollen ville da sendt siden til
  toppen).
- **Bunn-luften og en siste synk.** `fixBoardBottomGap` måler kortenes bokser, og
  slettingen («dra lista i kassen») kan ha rendret board-et mens dnd-kit ennå
  avsluttet draget. Kun på hovedsiden; nav-modalen har verken kolonnefordeling
  eller bunn-luft å rette opp.

**Scrollen er så lite påtrengende som mulig.** Ligger kortet allerede HELT
innenfor det trygge området, er funksjonen en **no-op** — et kort som var synlig
hele tiden skal ikke rykke rundt bare fordi det ble omrokkert. Ellers scrolles det
KORTEST MULIGE avstanden inn i området, men aldri så langt at toppen forsvinner
over kanten. `behavior: 'smooth'`, `'auto'` ved `prefers-reduced-motion`. Hoppes
over når kortet slippes på nav-knappen eller i kassen (begge er soner og går aldri
gjennom `onCommit`).

**Og den måles av LAYOUTEN, ikke av maleriet.** `getBoundingClientRect()` gir den
malte boksen, og rett etter et slipp er den ikke kortets plass: en FLIP-tween
eller drop-animasjonen kan ha skalert den. `layoutRect` retter opp
forskyvningen, men ikke skalaen. MÅLT på en firedobbelt strupet maskin: kortet
malte 7,5 × 12,6 px, 162 px OVER modalkroppen, mens FLIP-en fløy — regnestykket
leste det som «allerede synlig», gjorde ingenting, og kortet ble liggende 791 px
under folden da flyten tok det tilbake. `layoutTop` (summen av `offsetTop` opp
`offsetParent`-kjeden) og `offsetHeight` er layout og rører ingen transform, og
alt regnes derfor i scrollerens egen innholds-Y.

**Scrolleren er scopets egen**, samme deling som `anchorScroller` gjør under selve
draget:

| Scope | Scroller | Trygt område |
|---|---|---|
| `boardScope` | vinduet | toppmenyen (+ board-gapet) → viewportbunnen − `--safe-bottom` − gapet (gestelinjen dekker de nederste pikslene, og er 0 i en nettleser — [`design-system.md`](design-system.md)) |
| `navScope` | `#nav-modal-body` | modalkroppens egen boks, minus gapet i hver ende |

Nav-modalen trenger den mest: draget kollapser ALLE områdekortene, og slippet
folder dem ut igjen — et kort som lander under noen høye kort havner da langt
under folden. Uten scrollen forsvant området man nettopp flyttet ut av syne
(`dnd-nav-engine` sjekk 10).

## Et avbrutt drag er ikke et slipp

Smett ruller rekkefølgen tilbake selv og kaller aldri `onCommit`, så `pos` skrives
uansett ikke. Men `finishDrag()` teller ETHVERT drag som avsluttes som et slipp
(`dropSeq`), og den telleren er blind for tilstand med vilje: demoen har steg der
selve slippet ER handlingen, også når objektet lander på samme plass, der verken
`pos` eller rekkefølge endrer seg og en tilstandssjekk derfor ikke ville sett noe.

Hvert board sier derfor fra om avbruddet før det rydder (`dndNoteCanceled(event)`
→ `dragRolledBack`), av dnd-kits egen `dragend.canceled`. Uten det kvitterte en
`pointercancel` — typisk Android Chrome som klemmer scrollen — ut «dra
raden»-steget i demoen uten at brukeren hadde flyttet noe
(`tests/onboarding.test.js`, «11 avbrudd»).

`restoreDraggedToOrigin` er rollback-veien Huskis selv tar når en commit ikke lar
seg fullføre (f.eks. ekstrahering uten en aktiv mappe): den setter
`dragRolledBack`, fører elementet tilbake til den registrerte sloten
(`drag.origParent`/`origNext`) og rydder sikte-klassene. Geometrien er dnd-kits og
ryddes av dnd-kit. En node som alt er ute av dokumentet settes IKKE inn igjen —
DOM-en har gått videre uten den, og en re-innsetting ville gitt et
spøkelses-duplikat ved siden av de ferske nodene.

## Én akse: når draget låses loddrett

En vannrett komponent i draget har bare mening når det finnes noe vannrett å
sikte på — en **nabokolonne**. Finnes den ikke, kan sidelengs bevegelse bare
bomme: fingeren som glir litt på en telefon drar objektet ut av kolonnen uten at
det betyr noe.

Låsen spør derfor det SAMME regnestykket som layouten fordeler kortene etter
(`boardColumnCount`), og gjelder alle fem nivåene:

| Board | Låst? |
|---|---|
| `navCardBoard`, `navRowBoard` | alltid — nav-modalen er `singleColumn` |
| `ideaRowBoard` | alltid — idémodalen er `singleColumn` |
| `boardCardBoard`, `boardRowBoard` | når board-et FAKTISK står i én kolonne |

Grensen er altså kolonnetallet, ikke skjermbredden og ikke pekertypen: en bred
skjerm som likevel bare får plass til én kolonne er låst
(`dnd-vertical-axis` sjekk 3).

**Avgjørelsen tas ÉN gang per drag**, i `beforedragstart` (`dndLockAxis` →
`drag.oneAxis`) — før dnd-kit har malt en eneste frame. Selve nullingen av x
gjør en modifikator som leser det flagget, og alle fem board-ene får den samme
listen (`dndModifiers`, installert av `dndTuneManager`). Listen ERSTATTER Smetts
standardliste, så viewport-klemma må skrives ut igjen der; rekkefølgen er
virksom — klemma først, akselåsen sist.

**Låsen er MALINGEN, ikke politikken.** Smetts `intentRectangle` er regnet ut av
`position.delta`, som ingen modifikator rører: `draggedRect()` og `drag.lastX`
beskriver derfor fortsatt fingeren, og 1/3-tersklene, kolonnevalget og sonene
svarer nøyaktig som før. Det er bare objektet som står stille sidelengs.

**Rotasjonen følger låsen.** Den leser objektets vannrette posisjon, og den
finnes ikke når x er nullet — vinkelen ville svingt av en intensjon ingen ser.
`dndPaintRotation` er derfor en no-op når `drag.oneAxis` står, og `rotate` blir
aldri satt (se under).

## Viewport-klemmen og rotasjonen

Det løftede objektet holdes innenfor det BRUKBARE feltet av Smetts
`SafeViewport`, matet med `safeInsets()`. «Brukbart» = viewporten minus den sikre
sonen: et hakk i siden er en del av `innerWidth`, og et objekt som stopper der
ville lagt seg delvis under det mens board-et det kom fra står innenfor
([`design-system.md`](design-system.md)). Sonen er 0 i en nettleser, så klemmen
regner ut nøyaktig det samme der.

**Rotasjonen er ikke med i klemmen, og det er med vilje.** `SafeViewport` klemmer
den boksen dnd-kit har MÅLT, og målingen tar ikke med rotasjonen vi maler
objektet med etterpå (`dndPaintRotation`). En rotert boks er både høyere og
bredere — for en bred, lav rad ved ±5° er forskjellen ~30 px i høyden — og
differansen stikker ut med halvparten på hver kant: et kort dratt til nedre høyre
hjørne på en 390 × 780-skjerm ligger ~13 px under viewportkanten.

Å legge slarken inn i klemmen — enten som ekstra safe insets eller ved å klemme
mot den roterte boksen — koster det som betyr noe: grepet løsner fra fingeren med
nøyaktig den samme slarken hver gang objektet nærmer seg en kant
(`dnd-layout-modes` sjekk 1). Objektet ligger i top layer (`position: fixed`), så
hjørnet utenfor kanten lager verken scrollbar eller overflow — det er kosmetikk;
grepet er det ikke. `dnd-viewport-clamp` regner derfor rotasjons-slarken inn i sin
egen toleranse, og måler den ut fra objektets faktiske `rotate`.

**Rotasjonen er dynamisk** (`cardRotation()`, ±5° ut fra horisontal posisjon: −5°
inntil venstre kant, +5° inntil høyre) og gjelder ALLE objekt-typene — men bare
der draget faktisk KAN gå sidelengs (se «Én akse» over). Den settes fra JS som en
EGEN `rotate`-egenskap, aldri via `transform`: geometrien er dnd-kits og skrives
med `!important` (`position`, `top`, `left`, `width`, `height`, `transform`,
`translate`). Skalaen ligger i CSS av samme grunn.

**Og en regel uten virkning er ingen regel.** `.dnd-surface [data-dnd-placeholder] {
rotate: none }` gjorde ingenting — klonen bærer rotasjonen som en INLINE-stil, og
en inline-stil slår enhver klasseregel, så en bred, lav rad fikk et hull dobbelt
så høyt som seg selv. Med `!important` står den.

### Alt som dras er halvgjennomsiktig

Det løftede objektet ligger oppå det man sikter mot, og det man sikter mot ER
svaret på hvor slippet lander: hullet, ny-liste-stripa, skillelinja,
søppelkassen. Stripa er 10 px og ligger mellom to kort — altså akkurat der
fingeren, og dermed objektet, er. Flaten beholder derfor sin egen farge (kortets
palettfarge, radens plate) og slipper bare lys gjennom; `backdrop-filter:
blur(2px)` gir den et tynt slør, så teksten på objektet ikke leses rett mot
mønsteret under. Det er BAKGRUNNEN som er gjennomsiktig — `opacity` står på 1,
så teksten er like lesbar som i hvile.

Regelen gjelder alle fem nivåene, fra én blokk på `[data-dnd-dragging]`. Den er
Huskis' politikk, ikke Smetts: Smett sier hvor et slipp lander, ikke hvordan det
som dras ser ut.

**Tilstander må derfor uttrykkes i FARGE, ikke i mer gjennomsikt.** Sikter man på
søppelkassen, males en rødvask (`--drag-danger`) over flaten som
`background-image`, altså oppå `background-color`: gjennomsikten og sløret står
urørt, kassen synes fortsatt gjennom objektet, og «her slettes det» leses som en
farge. Uttrykt som enda et lag gjennomsikt ville de to tilstandene lest likt.
Målt i `dnd-drop-animation` (sjekk 6, alle fem nivåene) og `dnd-trash` (sjekk 2).

## Auto-scroll

dnd-kits `AutoScroller` finner scroll-containeren selv: vinduet for et drag på
hovedsiden, modalens `.menu-body` for et nav-drag (den er en forfar til det
løftede objektet). Ingen Huskis-kode er involvert, og to spørsmål som en gang var
våre er dermed upstreams:

- **Den ØVRE sonen rekker under den faste toppmenyen.** `AutoScroller.threshold`
  er en brøkdel av containeren, der Huskis' egen sone ble målt fra toppmenyens
  bunn — man skulle ikke måtte dra lista opp BAK headeren for å få siden til å
  rulle. MÅLT: et sikte rett under toppmenyen (`topbarBottom + 12 px`) scroller
  oppover. `dnd-mobile-autoscroll` sjekk (d) er vakten.
- **Farten er per frame, ikke per millisekund**, så en 120 Hz-skjerm scroller
  fortere enn en 60 Hz-skjerm på samme fysiske tid. En falsk rAF-klokke måler da
  biblioteket, ikke oss — `dnd-recovery-scroll` vokter i stedet at auto-scrollen
  i det hele tatt slår inn for et listepunkt.
- **En nedover-frame reduserer aldri `scrollY`.** Board-vakten holder
  board-bunnen stabil gjennom draget, men påstanden vokter uansett at et
  fortegnsbytte ikke kan skje. `dnd-mobile-autoscroll` sjekk (b).

## Områder og mapper (nav-modalen)

Egen kode for disse to nivåene finnes ikke: områder dras som lister, mapper som
listepunkter, mappekategorier som kategorier — samme komponenter, samme politikk,
bare et annet state-tre (`navScope`). Det som er verdt å merke seg:

- **Alltid én kolonne**: `navScope.singleColumn` gjør at `relayoutBoard` lager
  nøyaktig én `.board-col` (samme kolonnemaskineri som hovedsiden, se
  [`board-layout.md`](board-layout.md)), så kort-draget aldri møter
  flerkolonne-logikken. Draget er dermed alltid låst til den loddrette aksen, og
  males uten rotasjon (se «Én akse» over).
- **Scrollen etter slippet ruller MODALKROPPEN**, ikke vinduet
  (`navScrollAfterDrop`). Se «Etterarbeidet ved slippet».
- **En mappe som bytter område går gjennom `move_group`-RPC-en**
  (`commitGroupMove`) — databasen avviser en direkte skriving av
  `groups.universe_id`. Flyttingen vises optimistisk lokalt og holdes i
  `pendingGroupMoves` til RPC-en har landet (doc-et beholder den GAMLE
  plasseringen så lenge). Krysser flyttingen et **eierskapsdomene** (ulikt sett
  områdeeiere), vises en eksplisitt bekreftelse først, og serveren svarer med en
  id-mapping som `applyIdMapping` bruker til å bytte det lokale treet uten
  flimmer. Avbrutt bekreftelse ruller tilbake (`revertGroupMove`).
- **Fri mappe** («Mapper delt med meg») omrokkert i sin egen seksjon skriver kun
  PERSONLIG rekkefølge (`cloudPersonalPos` → `memberships.pos`) — det andre ser
  endres aldri. Det samme gjelder områdene på toppnivå. Se
  [`rettigheter-og-deling.md`](rettigheter-og-deling.md) del 11 og 12.
- **Den aktive mappen følger med** når den bytter område (dratt dit, ekstrahert
  til et nytt, eller båret med av en mappekategori): `followActiveGroup()` kalles
  først i `renderBoard()` og flytter `state.activeUniverse` etter mappa.
  `activeGroupObj()` leter bare i det aktive området, så uten dette falt
  hovedsiden til «Ingen mapper ennå.» med mappa fortsatt i behold. Den bor i
  render-veien nettopp for å dekke ALLE veiene inn med ett sted.

## Flytting av lister til en annen mappe (innen samme område)

Mappene ligger ikke på hovedsiden. Dra i stedet lista opp på **nav-knappen** i
toppmenyen: knappen er en SONE for kortdraget (`data-dnd-zone="crumb"`), den
markeres (`.drop-target`, kun når det finnes andre mapper), og det løftede kortet
tones ut (`.to-group` — den eneste dra-tilstanden som fortsatt bruker `opacity`
i stedet for en farge). Smett ruller lista tilbake dit den kom fra
FØR handlingen — som for søppelkassen — og så åpnes en velger («Flytt … til:», i
plasserings-modal-skallet via `openPicker`); valget gjør en kirurgisk flytting
(`moveCardToGroup`: `card.group` + `pos` bakerst, kun posisjonsregisteret
stemples) + toast. Avbrytes velgeren, er INGENTING endret — heller ikke
rekkefølgen på board-et, som draget kan ha rukket å endre på veien opp.
`moveCardToGroup` slår opp det LEVENDE kortet på id — en synk-rebuild kan ha
byttet ut objektet mens velgeren sto åpen.

Velgeren viser mappene i det AKTIVE området der man faktisk kan opprette lister
(`cap(g, 'createList')`; mappekategorier er overskrifter og listes ikke). Vil man
flytte lista lenger — til en mappe i et annet område — flytter man i stedet MAPPEN
i nav-modalen. Se [`data-model.md`](data-model.md).

## Tastaturet er Huskis' eget

Alle board-ene bygges med `keyboard: false`. dnd-kits `KeyboardSensor` ville
kjempet om Enter/Mellomrom, som på et korthode og en mapperad allerede betyr
«kollaps» og «naviger». WCAG-alternativet til draget er `attachKeyHandle` — F2,
Alt+piler og «Flytt til …» — se «Rekkefølge og flytting fra tastatur» i `app.js`
og [`tilgjengelighet.md`](tilgjengelighet.md).

## CSP-en har en hash for dnd-kits stilark

dnd-kit injiserer et `<style>`-element mens et drag pågår — det som løfter
objektet inn i top layer og posisjonerer det. `style-src 'self'` blokkerte det, og
feilen var STILLE: draget «virket», men det løftede objektet ble liggende
sentrert i viewporten i stedet for å følge fingeren. Ett element, én hash, og to
av dnd-kits plugins (`Cursor`, `PreventSelection`) er meldt av fordi Huskis maler
det de maler fra `body.is-dragging`. `tests/csp-enforced.test.js` regner hashen ut
på nytt fra et EKTE drag. Se [`sikkerhetsheadere.md`](sikkerhetsheadere.md).
