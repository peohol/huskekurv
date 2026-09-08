# Menyer: toppmeny (nav-knapp), toppkontrollene, navigasjonsmodalen, konto-modalen

Les denne når oppgaven berører toppmenyen, toppkontrollene i hjørnet (søk,
drakt, konto), navigasjonsknappen/-modalen (områder og mapper) eller
konto-modalen. Selve søket og navigeringen til et objekt ligger i
`docs/sok-og-navigering.md`.

Prinsipp: **all navigering, redigering, omrokkering og deling av områder og
mapper skjer i ÉN felles modal** — hovedsiden har kun nav-knappen (hvor er jeg)
og listefunksjonene.

Nøkkelidé: **områder og mapper bruker nøyaktig samme oppsett som lister og
listepunkter.** Et område er et `.card`, en mappe en `.item`-rad, en
mappekategori en `.category`. Dermed arves hele kort-/rad-designet OG hele
dra-og-slipp-POLITIKKEN. Selve motoren er en annen her enn på hovedsiden mens
migreringen pågår: nav-modalen kjøres av dnd-kit — se `docs/drag-and-drop.md`
(«Nav-scopet kjører på dnd-kit»).

## Objektmenyen (`.obj-menu-btn` → `#obj-menu`)

**Autoritativt for hva et objekt kan gjøre og hvor man finner det.**

Alle seks objekttypene — **område, mappe, mappekategori, liste, listepunkt og
kategori** — har NØYAKTIG én knapp til høyre: menyknappen (tre prikker,
`ICONS.menuDots`). Den erstatter tannhjulet, ✕, del-knappen, forlat-knappen og
oppløs-knappen, og har avviklet den gamle innstillingsmodalen helt. Målet er
færre synlige knapper og ingen kamp mellom to funksjoner om det samme trykket.

Knappen arver flate og størrelse fra kontrollen den erstattet på hvert nivå, så
ingen ny knappestil er innført:

| Nivå | Klasser på menyknappen |
|---|---|
| Område / liste (korthode) | `.card-cog.obj-menu-btn` |
| Mappe / listepunkt (rad) | `.item-cog.obj-menu-btn` |
| Mappekategori / kategori (overskrift) | `.cat-cog.obj-menu-btn` |

### Form

**Popover** forankret i knappen på desktop (`min-width: 561px`), **sentrert ark**
på mobil — samme `.switcher-overlay`/`.switcher-panel`-skall som ansvarlig-
velgeren og tids-popoveren, så det finnes bare én popover-mekanikk i appen.
Panelet innledes med en overskrift som sier hvilket objekt menyen gjelder
(type-ikon + navn); på mobil dekker arket raden det kom fra, og uten navnet er
det ikke mulig å se hva man holder på med.

Popover-varianten forankres med inline `top`/`left` (`positionSwitcherPanel`,
som klemmer mot den sikre sonen). Koordinatene gjelder viewportet panelet ble
åpnet i, så en **åpen** popover plasseres på nytt ved resize
(`repositionOpenPopovers` i resize-lytteren): en rotasjon, delt skjerm eller et
tastatur som krymper viewportet ville ellers latt panelet bli stående utenfor
skjermen — eller under hakket, hvis rotasjonen flyttet det til motsatt side.
Ark-varianten på mobil er `position: static` og plasseres av CSS; den røres
ikke.

### Radene

Rekkefølgen er fast; rader som ikke gjelder objektet **utelates helt** (en
avskrudd rad er verre enn ingen rad). Alt gates av de samme capabilities som
knappene brukte, og feiler LUKKET — se `docs/rettigheter-og-deling.md`.

| # | Rad | Gjelder | Gate |
|---|---|---|---|
| 1 | **Endre navn** | alle | `editContent` / `!frozen` |
| 2 | **Ansvarlig** ▸ | liste, listepunkt, kategori i DELT mappe | mappen er delt |
| 3 | **Tidsplan** ▸ | liste, listepunkt, kategori | — (feltene låses av `timeController`) |
| 4 | **Flytt** ▸ | alle som kan omrokkeres | `canReorderObj` |
| 5 | **Deling og medlemmer** | område, mappe | — (medlemslisten er åpen for alle med tilgang) |
| 6 | **Lås / Åpne** (eller **Gjør/Fjern unntak**) | delt område, delt mappe | `manageLock` / `lockException` |
| 7 | **Forlat …** | delt område, delt mappe | `leave` |
| 8 | **Slett …** / **Løs opp …** | alle man kan fjerne | `delete` / `!frozen` |

**Sletting står SIST**, bak en skillelinje og i rødt (`.obj-menu-row.is-danger`).
Den er den eneste raden som fjerner noe, og den skal ikke ligge der fingeren
treffer først når menyen åpner seg.

**Bare område og mappe har delingsraden.** Det er de to nivåene som kan deles;
lister, listepunkter og kategorier arver tilgangen og har ingen egen
medlemsliste (`docs/rettigheter-og-deling.md`). En delerad i LISTENS meny leses
som om det er lista man deler, og den finnes derfor ikke — delingen gjøres der
myndigheten ligger, i mappens meny. At mappen er delt vises fortsatt på
listekortet med `.share-badge`.

### Trekkspillet

«Flytt», «Ansvarlig» og «Tidsplan» er skuffer (`.obj-menu-sub`) under sin
overskriftsrad. **Kun ÉN skuff kan være åpen om gangen** — å åpne en ny lukker
den forrige, begge med animert høyde (`slideSub`, 180 ms; samme funksjon driver
konto-modalens skuffer). Uten det ville menyen blitt lengre enn skjermen på
mobil.

Skuffene er skilt med hårfine linjer — fra hverandre og fra de vanlige radene
over og under. En fane som kan folde seg ut er en egen blokk, ikke nok en rad i
rekka. Linjene ligger som `border-top` på selve gruppen (ikke som egne
elementer), så nabo-faner deler én linje og ingen ekstra luft snik-legges inn.
Raden UNDER en skuff får linjen som et eget strøk i `::before` i stedet: radene
er avrundet, og en `border-top` på dem buer i endene. Alle skillelinjene i
menyen skal være flate.

Innholdet i en skuff er rykket inn, så nivåene leses uten egne rammer. Radene
(«Flytt opp», ansvarlig-radene) har sin egen polstring og får innrykket gratis;
tids-editoren har det ikke, og får det derfor eksplisitt — samme venstrekant.

- **Flytt** ▸ «Flytt opp» / «Flytt ned» (`keyboardReorder`, ett hakk per trykk,
  menyen blir stående så flere hakk kan tas etter hverandre) og «Flytt til …»
  (`keyboardMoveTo`, åpner velger-modalen). Dette er dra-og-slippets motstykke
  for den som ikke kan eller vil dra — se `docs/tilgjengelighet.md`.
- **Ansvarlig** ▸ de samme radene som ansvarlig-velgeren, men inne i menyen: en
  popover oppå en popover ville lagt to lag over samme knapp.
- **Tidsplan** ▸ hele tids-editoren (`buildTimeEditor`) — se `docs/scheduling.md`.

### Menyen tåler at DOM-en bygges om

Alt slås opp på id (`objMenuLive`), aldri på en fanget objektreferanse, og
ankeret finnes igjen med selektor (`objMenuAnchor`) etter en rendring — en
sortering fra menyen bygger jo board-et om under den. `repaintObjMenu()` maler
radene på nytt (etter lås, ansvar, sortering) uten å lukke, og beholder den åpne
skuffen. Forsvinner objektet, lukker menyen seg.

## Sletting: dra objektet i søppelkassen

Objektmenyens siste rad er den ene måten, dra-og-slipp den andre: løfter man et
objekt, dukker søppelkassen for nivået opp, og et slipp i den sletter. Samme
gest på desktop og mobil, samme motor som all annen flytting.

Kategorier har ingen kasse — de **løses opp** fra menyen (listepunktene blir
stående). Autoritativt: `docs/trash.md` («Slett ved å dra objektet i kassen»).

## Toppmenyen (`.topbar`)

Ett fast panel øverst (`position: fixed`, full bredde, samme DOM på mobil og
desktop). Panelet er en KOLONNE med to rader.

**Headeren har ÉN luft-verdi** (`--topbar-gap`), og den gjelder begge
retninger: mellom panelets rader, mellom kontrollene på en rad, mellom
hjørneknappene og mellom hjørnegruppens rader. Ett tall, ingen kompenserende
unntak — er avstanden mellom to knapper 10 px, er avstanden ned til raden under
det også. `syncTopChrome()` LESER radgapet ut av panelet i stedet for å kjenne
tallet, så høydeutregningen (`--main-tabs-h`) følger med av seg selv.
Panelets egen polstring over og under står i `--topbar-pad-y`, som hjørnegruppen
leser for å flukte med den samme linjen. `tests/corner-controls.test.js` (2e)
måler alle avstandene mot det ene tokenet.

0. **Hovedbryteren** (`.main-tabs`, `#main-tabs`, `role="tablist"`):
   `Lister ↔ Notater` — Huskis' to hoveddeler
   ([`notater-plan.md`](notater-plan.md)). Visuelt er den ÉN segmentert
   kontroll, ikke to frittstående knapper, og den ligger ALENE på panelets
   øverste linje (`.topbar-row-tabs`), sentrert i hele bredden. Hjørnegruppen
   skyves ned under den (`--main-tabs-h`, målt i `syncTopChrome`) i stedet for å
   dele linje med den. Fanen er en VISNING, ikke et eget program:
   toppkontrollene tilhører hele appen og dupliseres ikke per fane. Den aktive
   halvdelen bærer `.is-active` og `aria-selected="true"`; venstre/høyre
   piltast bytter (WAI-ARIA), og bare den aktive er i tabbrekkefølgen.
   Markeringen er ÉN flate som GLIR mellom halvdelene — samme kontroll og
   samme bevegelse som søkets scopevelger, se `.seg` i
   [`design-system.md`](design-system.md). Valget
   er per ENHET (`localStorage['huskis-tab']`) og synkes ikke — hvilken fane
   man sist så på er ikke innhold. Bryteren er kompakt med vilje: raden koster
   høyde, og høyde er det knappeste i landskap.
1. **Den aktive fanens rad** (`.topbar-row`): én per fane, og bare den aktive
   er synlig. Listefanens rad har navigasjonsknappen og listefunksjonene
   (under); notatfanens har sin egen breadcrumb (`#notes-crumb`,
   `[bokhyllenavn] › [notatboknavn]`, der notatboknavnet er «Frie notater» når
   man står rett i bokhyllen) og «＋ Notat» (`#add-note-btn`, avskrudd uten en
   aktiv bokhylle).

Listefanens rad har to deler:

1. **Navigasjonsknappen** (`.crumb-btn.nav-crumb`, `#nav-crumb`): ÉN knapp som
   viser hele lokasjonen som en breadcrumb — bare navnene, uten ikoner —
   `[områdenavn] › [mappenavn]` (`updateCrumbs()`; fallback «Område»/«Mappe» når
   ingenting finnes). Klikk åpner nav-modalen. Navnene kappes med ellipsis. På
   mobil krympes fonten litt (media-query).
2. **Listefunksjonene** (`.panel-actions.toolbar`): «＋ Liste»
   (`#add-card-btn`) og liste-søppelkassen (`#trash-btn`). «＋ Liste» er avskrudd uten
   en aktiv mappe man kan opprette lister i (`canAddList`, `updateToolbarState`)
   — en LÅST mappe gir ingen knapp å trykke på, akkurat som «＋ Mappe» i et
   låst område. Se `docs/rettigheter-og-deling.md` («Å opprette og å plassere
   spør FORELDEREN»).

**Én linje der bredden rekker.** De to delene deler linje på desktop og på en
telefon i LANDSKAP: fanenes rad pluss ÉN kontrollhøyde, og i landskap er høyde
det knappeste vi har (~360 px viewport). Listefunksjonene står **rett til høyre
for nav-knappen**, ikke skjøvet ut til kanten: breadcrumben krymper (`flex: 0 1
auto`, navnene kappes med ellipsis) når linjen blir trang, men vokser aldri.
Under **620 px** legges listefunksjonene på raden UNDER: så smalt er navnene
verdt mer enn de 49 px panelet sparer.

Den grensen er toppmenyens EGEN, ikke board-ets én-kolonne-grense (560 px), og
skal ikke slås sammen med den: den ene handler om plass på én linje og
avhenger av hvor bred hjørnegruppen er, den andre speiler hva `relayoutBoard`
regner ut i JS. Får gruppen en knapp til, flytter toppmenyens grense seg — den
er en KONSEKVENS av gruppebredden, ikke et designvalg. Da gruppen fikk sin
sjette knapp, krympet breadcrumben til null ved 561 px og listefunksjonene la
seg oppå den; `tests/landscape-chrome.test.js` måler begge sidene av grensen,
og at det ikke skjer igjen.

Toppkontrollene (under) ligger fast i hjørnet og er ikke med i panelets flyt,
så plassen til dem må holdes av noe annet: på én linje er det en
`margin-right` i ENDEN av linjen (listefunksjonenes), i det stablede oppsettet
holder BEGGE radene av den samme plassen (breadcrumbens `padding-right` og
listefunksjonenes `margin-right`) — er hjørnegruppen også to rader (under
560 px), ligger én gruppe-rad ved siden av hver av dem. Fanenes rad holder ikke av noe: hjørnegruppen
begynner først UNDER den (`--main-tabs-h`), så de deler ingen linje. De andre
leser
`--corner-btns-w`, som appen MÅLER (`syncTopChrome`) som gruppens BREDESTE rad,
så plassen holder takt med hvor mange knapper gruppen faktisk har. Har gruppen
flere rader enn panelet, skyves overskuddet over panelets egne rader ned i
paddingen (`--corner-btns-overflow`, under). Panelets egen padding er den
samme i begge, så gruppen flukter fortsatt med panelets kant
(`tests/safe-area.test.js`, `tests/corner-controls.test.js`).

Panelets flate når helt ut i skjermkantene, men innholdet holdes innenfor den
sikre sonen: `--safe-top` legges på padding-top og `--safe-left`/`--safe-right`
på sidene, så breadcrumben ikke havner under statusfeltet eller et hakk (0 i en
nettleser — `docs/design-system.md`).

Begge oppsettene og grensen mellom dem er dekket av
`tests/landscape-chrome.test.js`.

Board-ets padding-top settes i JS (`syncTopChrome`: målt underkant av
toppmenyen OG toppkontrollgruppen + `--board-gap`) — se
`docs/board-layout.md`. At det MÅLES er det som gjør at klaringen følger med
når panelet vokser med sonen, og når gruppen brytes til flere rader.

## Toppkontrollene (`.corner-controls`, `#corner-controls`)

ÉN fast gruppe i øvre høyre hjørne av VIEWPORTET (`position: fixed`, 12 px fra
toppen og `--toolbar-pad` fra høyre, begge pluss den sikre sonen slik at den
flukter med toppmenyens kant), utenfor toppmenyens flyt — z-index (35) over det
faste panelet (30) men under modaler (200).

Knappene ligger i DOM-rekkefølge og plasseres av flex. Ingen av dem kjenner
naboens bredde, så en NY knapp legges til ved å sette den først i gruppen —
det finnes ingen `right:`-kjede å regne om:

| Rekkefølge | Knapp | Åpner |
|---|---|---|
| 1 | **Varsler** (`.notif-btn`, `#notif-btn`) | varselmodalen — `docs/varsler.md` |
| 2 | **Kalender** (`.events-btn`, `#events-btn`) | «Kommende hendelser» — `docs/kommende-hendelser.md` |
| 3 | **Søk** (`.search-btn`, `#search-btn`) | søkemodalen — `docs/sok-og-navigering.md` |
| 4 | **Idéer** (`.ideas-btn`, `#ideas-btn`) | idémodalen — `docs/ideer.md` |
| 5 | **Drakt** (`.theme-toggle-btn`, `#theme-toggle-btn`) | ingen; bytter lys ↔ mørk i ETT trykk |
| 6 | **Konto** (`.account-btn`, `#account-btn`) | konto-modalen |

Alle seks bærer `.corner-btn`: samme flate-mønster som søppelkassene
(halvgjennomsiktig hvit → hvit ved hover), samme høyde/radius som resten av
kontrollene, samme fokusring. To av dem har en rød badge (`.menu-badge`):
kontoknappen teller ventende invitasjoner (`#account-badge`), bjellen uleste
varsler (`#notif-badge`, skjult ved 0, `99+` over hundre). Draktknappens ikon
(sol/måne) og tittel viser drakten som ER aktiv, ikke den man bytter til
(`setTheme`, `docs/mork-drakt.md`) — det finnes ingen «følg systemet».

**Hele gruppen skjules før innlogging** (`body.no-auth`). Draktvalget dekkes da
av innloggingsskjermens egen knapp (`#auth-theme-toggle-btn`, samme
`.corner-btn`-flate og samme maling — bare inline i språkraden i stedet for
fast i hjørnet).

**Under 560 px deles gruppen i to rader:** idéer, drakt og konto øverst, de tre
øvrige (varsler, kalender, søk) under. Delingen gjøres av
`flex-wrap: wrap-reverse`, ikke av `order`: flex fyller den første linjen med de
tre første i DOM-rekkefølgen, og `wrap-reverse` legger den SISTE linjen øverst.
Regelen «en ny knapp legges FØRST i gruppen» holder dermed fortsatt, og gruppen
er nøyaktig to rader enten den har fire, fem eller seks knapper — en ny knapp
koster ikke board-et høyde. Et usynlig bruddelement ville kostet en ekstra flex-linje,
altså nettopp den høyden.

Gruppen bryter til **flere rader** mot høyre kant når raden ikke rekker
(`flex-wrap`); knappene krymper aldri under kontrollhøyden. Gruppen er en
høyre KOLONNE oppå panelet, og hver av panelets EGNE rader holder av den samme
klaringen — så én gruppe-rad kan ligge ved siden av hver av dem. Har gruppen
flere rader enn panelet, skyver `syncTopChrome()` overskuddet
(`--corner-btns-overflow`, gruppens høyde minus panelets innholdshøyde) inn i
panelets `padding-top`. Da havner ingen gruppe-rad oppå en panelrad, og
board-ets klaring følger med.

`--corner-btns-w` måler gruppens BREDESTE rad, ikke hele gruppen og ikke bare
den nederste — klaringen må holde for hver rad som kan ligge ved siden av en
panelrad. Radene finnes ved å gruppere knappene på `top`, ikke ved å gå gjennom
DOM-en: en `order` kan legge en knapp på en annen rad enn DOM-rekkefølgen
tilsier. Vokter: `tests/corner-controls.test.js`.

## Navigasjonsmodalen (`#nav-modal`, åpnes fra nav-knappen)

Modalen har **tre seksjoner**, hver med overskrift (`.nav-section-head`) og en
skillelinje over (unntatt den første):

| # | Overskrift | Innhold |
|---|---|---|
| 1 | `[globus][konto] Mine områder` | områder der jeg har rollen `owner` — pluss ＋-knappen «Nytt område» (`.nav-add-uni`), som finnes KUN her |
| 2 | `[globus][personer] Områder delt med meg` | områder der jeg er `member` |
| 3 | `[mappe][personer] Mapper delt med meg` | mapper jeg har en DIREKTE rolle i uten å ha noen rolle i deres kanoniske område |

Seksjon 1 og 2 vises alltid (tomme får en `.nav-section-empty`-linje); seksjon 3
kun når man faktisk har frie mapper. Klassifiseringen følger **nåværende rolle**,
ikke hvem som opprettet objektet — se `docs/rettigheter-og-deling.md`.

Seksjon 3 tegnes som ett **virtuelt områdekort** (`.free-groups-card`,
`FREE_UNI_ID`) uten del-/slett-knapp og uten ＋-rad: mappene i det har allerede
et kanonisk område, og beholderen finnes ikke i databasen.

Alle tre seksjonene ligger i den SAMME `.board-col` som områdekortene, som egne
rader. Dra-og-slipp hopper over dem (`boardRows` filtrerer på
`.card`/`.card-placeholder`, og hopper over dnd-kits klone), så de kan stå der
uten å bli dra-mål, og
`relayoutBoard` returnerer tidlig for énkolonne-scopet slik at kortene aldri
flyttes bort fra overskriften sin.

Overskrift: **«[område-ikon] Områder og [mappe-ikon] mapper»**. Innholdet er
ett `.board` (`#nav-board`, klassen `.nav-board`) med ett kort per område, og
under det område-søppelkassen. («＋ [globus]» ligger inne i seksjon 1.)

- **Alltid ÉN kolonne**, uansett skjermbredde — i motsetning til hovedsidens
  board. Kolonnene lages av det samme `relayoutBoard`-maskineriet
  (`docs/board-layout.md`), men nav-scopet setter `singleColumn`.
- **Bygges bare når modalen er åpen** (`renderNav()` returnerer tidlig når
  `navModal.hidden`): en usett DOM-kopi av alle områder/mapper koster ved hver
  render, og ville dessuten gitt doble treff for `.card`/`.item` på tvers av de to
  board-ene. `openNavModal()` setter derfor `hidden = false` FØR den kaller
  `renderNav()`.

### Område-kortet (`.card.uni-card`, `#uni-card-template`)

Samme oppbygning som et listekort (`.card-head` + `.card-body`), med disse
forskjellene:

| Listekort | Område-kort |
|---|---|
| «(N)» ved navnet når kollapset | **[mappe-ikon] + antall** (`.collapse-count.uni-count`) |
| «Utført»-seksjon + ⟲ | — (mapper krysses ikke av) |
| ＋ listepunkt / gul kategori-knapp | **＋ mappe / gul mappekategori-knapp** (`ICONS.groupCategory`) |
| listepunkt-søppelkasse i body-en | **mappe-søppelkasse** i body-en (`.group-trash-btn`) |

Begge har den samme ene knappen til høyre: **objektmenyen** (`.obj-menu-btn`,
se under).

- Klikk **hvor som helst på korthodet** (unntatt menyknappen) = kollaps/utvid
  (`card.collapsed` ⇒ `universe.collapsed`, lagres og synkes) — også på
  tittelen. Trykk-og-hold (touch) / dra (mus) på korthodet = flytt området.
- **Omdøping går via menyen** (eller F2 på korthodet); et klikk på navnet
  omdøper ikke lenger.
- Det AKTIVE området markeres med ringen i `--focus` (`.card.active`) og med
  `aria-current`, så tilstanden også finnes for en skjermleser.
- **Tastatur:** korthodet er `role="button" tabindex="0"` med `aria-expanded`, og
  Enter/Mellomrom gjør det samme som et klikk der — kollapser/utvider.
  `toggleCardCollapsed` oppdaterer `aria-expanded` når attributtet finnes
  (listekortene på hovedsidens board har ingen tastaturrolle, så der er det no-op).
- Fri-beholderen (`.free-groups-card`) har ingen meny: den er en seksjon, ikke
  et område, og har ingenting å tilby (`menuBtn.hidden = true`).

### Mappe-raden (`.item.group-row`, `#group-row-template`)

Samme rad som et listepunkt, men **uten avmerkingsboks** (mapper krysses ikke
av). Én knapp til høyre: objektmenyen.

- Klikk **hvor som helst på raden** — navnet inkludert — = **gå til mappen**
  (setter aktivt område + mappe, `goToGroup`) og **lukk modalen**.
- **Omdøping går via menyen** (eller F2). Dette er hele grunnen til at klikk på
  navnet ikke lenger omdøper: omdøping og navigering kjempet om det samme
  trykket, og navigering er det man gjør ti ganger oftere.
- Den AKTIVE mappen markeres med ringen i `--focus` (`.item.active`) og med
  `aria-current`. Se `docs/tilgjengelighet.md`.
- **Tastatur:** raden er `role="button" tabindex="0"`; Enter/Mellomrom
  navigerer, F2 omdøper. `ev.target !== el`-vakten lar menyknappen beholde sin
  egen tastaturoppførsel.

### Type-ikon og delt-merke foran navnet

Både områdekortet og mapperaden innleder med **[type-ikon]([delt-ikon])Navn** —
`.kind-icon` (`ICONS.globe` / `ICONS.folder`) først, så `.share-badge` når
objektet er delt, så navnet. Rekkefølgen ligger i malene; byggerne fyller bare
ikonet. Breadcrumben i toppmenyen viser derimot bare navnene, uten ikoner
(`docs/rettigheter-og-deling.md`).

Områdekortet får derfor **ikke** den lyse innerkanten delte listekort har
(`.nav-board .card.is-shared` nullstiller den): `.card-body` er gjennomsiktig, så
ringen lyste gjennom nederst og leste som en ramme rundt mappelista. Delt-merket
ved navnet sier det samme uten kanten.

### Mappekategorien (`.category.group-cat`, `#group-cat-template`)

Samme kategori-rad som i en liste (overskrift på områdeflaten + en innrykket
«hylle» med mappene). Én objektmenyknapp i overskriften (der ligger «Løs opp
mappekategorien») og den grønne ＋-knappen nederst i hylla. Klikk på
overskriftslinjen kollapser/utvider; **klikk på tittelen omdøper** — kategorier
og listepunkter beholder hurtig-omdøpingen, fordi de ikke har noen annen
handling å kollidere med.

### Søppelkassene

- **Mappe-søppelkassen ligger i områdekortet** — akkurat som listepunkt-
  søppelkassen ligger i lista si. Vises kun når området har slettede mapper.
- **Område-søppelkassen ligger nederst i modalen**, i knapperaden ved siden av
  «＋ [globus]». Vises kun når den har innhold.

Gotcha: å bytte mappe lukker modalen (bytt kontekst og gå), men **sletting
lukker den IKKE** — brukeren skal kunne angre fra søppelkassen med én gang
(søppelkasse-modalen ligger over, samme z-index men senere i DOM).

## Notat-navigasjonen (`#notes-nav-modal`, åpnes fra notatfanens breadcrumb)

Samme modal-skall og samme oppsett som nav-modalen over, bare for notatenes
tre: hver BOKHYLLE er et `.card.uni-card.note-project-card`
(`#note-project-template`) med NOTATBØKENE sine som
`.item.group-row.note-folder-row`-rader (`#note-folder-template`) i
`.items-container`, og en `＋ [notatbok]`-knapp i kortets `.add-item-row`.
Nederst i kolonnen ligger `＋ [bokhylle]` (`.notes-add-project`), som «＋
Område» gjør i nav-modalen. Begge knappene bærer ＋ og typens eget ikon, som
resten av Huskis' opprett-knapper.

Klikkdelingen er den samme som for områder og mapper: **tittel-klikk omdøper**
(inline, `editText`), **klikk ellers navigerer** — på en notatbok-rad inn i
notatboken. **BOKHYLLEHODET ER ET TREKKSPILL**, som områdekortets: det åpner og
lukker bokhyllen (`toggleCardCollapsed`, `aria-expanded`, lagret i `collapsed`)
og lukker ALDRI modalen.

Veien til bokhyllens egen plass — de frie notatene — er raden **«Frie notater»**,
som alltid står FØRST inne i bokhyllen. Den er ingen rad i modellen: den har en
syntetisk id (`free:<bokhylle>`) og `data-dnd-ignore`, så den kan verken løftes
eller telles med når rekkefølgen leses tilbake fra DOM-en
([`drag-and-drop.md`](drag-and-drop.md)). Den aktive plasseringen bærer
`.is-active`.

Bokhyllen, notatboken og notatkortet har den SAMME objektmenyen som resten av
appen (`.obj-menu-btn` → `#obj-menu`), med de radene notatsiden faktisk har:

| # | Rad | Gjelder |
|---|---|---|
| 1 | **Endre navn** | alle tre (i editoren peker den på tittelfeltet) |
| 2 | **Flytt** ▸ | alle tre (opp/ned; notatsiden har ingen «Flytt til …») |
| 3 | **Koblinger** | alle tre — åpner koblingsmodalen, med antallet som hint |
| 4 | **Arkiver** / **Hent ut av arkivet** | alle tre |
| 5 | **Slett …** | alle tre (til søppelkassen, i rødt og sist) |

Notatet har menyen både på kortet og i editorens verktøylinje (`#note-menu-btn`),
så et åpent notat ikke er en blindvei. Deling, låser og kategorier finnes
fortsatt ikke her — notatene hører til kontoen alene
([`notater-plan.md`](notater-plan.md)).

**Kassene og arkivene** speiler listenes: notat-kassen og -arkivet står i
notatfanens topplinje (per plassering), notatbokens i bokhyllekortet, og
bokhyllens i modalens egen fot. Alle er `.trashcan` og vises kun når de har
innhold — kassene også når et drag på nivået pågår ([`trash.md`](trash.md)).

## Konto-modalen (`#account-modal`, kontoknappen)

Modalen er et **trekkspill med tre skuffer** (`#account-acc`) — pluss to ting
som står utenfor dem. Prinsippet er at man skal se HVA kontoen tilbyr uten å
lese alt den inneholder: sammenslått er hele modalen tre overskrifter og
språkvalget.

Innhold (ovenfra og ned):

1. **Invitasjons-innboksen** (`#menu-invites`, vises kun med innhold) — UTENFOR
   trekkspillet, øverst. Badgen på kontoknappen sier at det ligger noe her, og
   da skal det ikke måtte letes fram bak en lukket skuff.
2. **«Rediger kontoopplysninger»** (`#acc-profile`) — fire seksjoner skilt med
   hårfine linjer, i denne rekkefølgen:
   - **Bilde** (`#menu-account`): avatar (profilbilde, ellers initialene) + navn
     + knappene «Endre bilde»/«Fjern bilde». Selve avataren er OGSÅ knappen som
     velger bilde (kamera-merke nederst til høyre); valget åpner
     bilderedigereren (`#avatar-modal`). Se `docs/accounts.md`.
   - **Navn** (`#account-name-form`): ett felt for hele navnet →
     `profiles.display_name` (RLS: kun egen rad) + `user_metadata.display_name`
     (fallback før første pull). Se `docs/accounts.md`.
   - **E-post** (`#account-email-form`): `auth.updateUser({ email })` — ekte
     Supabase sender bekreftelseslenke (meldingen sier «sjekk innboksen»);
     mock-backenden endrer direkte. `handle_user_email_change`-triggeren speiler
     til `profiles.email` etter bekreftelse. **E-postvarsel-toggelen**
     (`#email-pref-toggle`, se `docs/accounts.md`) hører til adressen og står i
     samme seksjon.
   - **Passord** (`#account-pass-form`): nåværende + nytt passord (begge med
     «vis passordet»-knapp). Se `docs/accounts.md`.
3. **«Tips»** (`#acc-tips`): **«Demonstrasjon av Huskis»** (`#menu-tour`, med
   `#tour-restart` → «Vis på nytt» — demoen kjører i en simulering og rører aldri
   innholdet på kontoen, se `docs/introduksjon.md`) og **tastatursnarveiene**
   (`.menu-keys`). Det man går hit for å LÆRE, ikke for å endre.
4. **«Logg ut / slett konto»** (`#acc-session`): `.menu-account-actions` med
   **«Logg ut»** (GUL, med bekreftelse) i venstre ende og **«Slett konto»**
   (RØD, med søppelkasse-ikon) i høyre. Fargene skiller det reversible fra det
   endelige; avstanden hindrer feiltrykk. Slett-knappen åpner
   `#delete-account-modal` (advarsel + sveip-for-å-bekrefte) — se
   `docs/accounts.md`. At de to ligger bak en lukket skuff er halve poenget:
   ingen av dem er i veien for noe annet man kom hit for å gjøre.
5. **Språk** (`#menu-language`) — UTENFOR trekkspillet, nederst: en
   `.menu-setting`-rad med en `<select>` (Norsk/English). Etiketten står på
   BEGGE språk («Språk · Language»), og raden er synlig uten å åpne noe. Den som
   har havnet i feil språk skal ikke måtte gjette hvilken skuff valget ligger i,
   eller lese en overskrift på et språk hen ikke kan. Valget gjelder både UI-et
   og e-postene appen sender, og et bytte laster appen på nytt. Den samme
   velgeren finnes nederst på innloggingsskjermen (`#auth-lang-select`) — det
   eneste stedet språket kan velges før man har en konto. Se `docs/sprak.md`.

Drakten (lys/mørk) har IKKE en rad her lenger — den flyttet til en egen knapp
i toppkontrollgruppen (`.theme-toggle-btn`, over) for et raskere bytte. Se
`docs/mork-drakt.md`.

### Skuffene

Samme regel som i objektmenyen: **kun ÉN skuff er åpen om gangen** — å åpne en
ny lukker den forrige, begge med animert høyde (`slideSub`, 180 ms, delt
funksjon). **Modalen åpner alltid sammenslått**: `openAccount()` nullstiller
skuffene FØR den viser modalen (en `display:none`-flate animerer ikke, så
nullstillingen synes ikke), og en skuff man lot stå åpen overlever derfor ikke
at modalen lukkes.

Overskriften er en knapp (`.menu-acc-head`) med ikon, tekst og en vinkel som
roterer 90° når skuffen åpner seg; `aria-expanded` + `aria-controls` peker på
skuffen, som selv er en navngitt `role="region"`.

En **lukket skuff får `inert`**. Uten det ville Tab gått rett gjennom feltene i
den: høyden er 0 og innholdet usynlig, men elementene er fortsatt fokuserbare —
`focusablesIn()` filtrerer derfor på `[inert]` ved siden av `[hidden]`. Se
`docs/design-system.md` («Bevegelse og tilgjengelighet»).

## Del-modalens tilbakeknapp

Overskriften er «[nivå-ikon][navn] — Innstillinger for deling» i VANLIG
tekstflyt: ikonet ligger inline i direkte tilknytning til navnet
(`.share-title-obj`), ikke som egen flex-kolonne til venstre for overskriften.

`openShare(type, id, obj, backTo)`: `backTo` (valgfri funksjon) gjenåpner
modalen del-modalen ble åpnet fra — satt av «Deling og medlemmer» i
objektmenyen på område-kortene og mappe-radene (`openNavModal`). Når satt vises
`#share-back` (pil-venstre) først i `modal-head`; klikk lukker del-modalen og
kaller `backTo`. **✕/overlay/Escape lukker helt** — da havner man på
hovedsiden, ikke i modalen bak (bevisst: lukk = ferdig). Begge veiene inn i
del-modalen går i dag gjennom nav-modalen og sender derfor `backTo`; uten den
vises ingen tilbakeknapp (fortsatt tilfellet for programmatiske kall, f.eks.
fra testene).

## Flytt liste til annen mappe

Dra en liste (trykk-og-hold på korthodet) opp på **nav-knappen**: knappen
markeres (`.drop-target`) når det finnes andre mapper å flytte til; slipp legger
kortet normalt tilbake på board-et og åpner en velger («Flytt … til:») i
plasserings-modal-skallet (`openPicker`). Velgeren viser mappene i det AKTIVE
området (mappekategorier er overskrifter og listes ikke). Avbrytes velgeren
skjer ingenting. Se `docs/drag-and-drop.md`.

## Modal-infrastruktur

- `updateModalOpenClass()` samler alle modalene (nav/konto/søk/søppel/del/
  plasser/bekreft/objektmeny/popovere) → `body.modal-open` (scroll-lås).
- **Stigen** `closeTopLayer(viaBack)` lukker ØVERSTE lag først: tids-popover →
  ansvarlig-velger → bekreftelses-modal → slett konto → avatar → plasser → del
  → objektmeny → søk → søppel → nav-/konto-modal. Den returnerer true når et
  lag faktisk ble lukket. Escape er den ene inngangen, systemets tilbakeknapp den
  andre (under) — én stige, så de to kan ikke komme i utakt.
- Escape lukker ikke midt i en inline-redigering; der avbryter den bare
  redigeringen. Del-modalen lukkes HELT av Escape («lukk = ferdig»).
- `.switcher-overlay`/`.switcher-panel`-skallet (popover på desktop, sentrert
  modal på mobil) brukes av objektmenyen, ansvarlig-velgeren og tids-popoveren.
- Fokus inn/ut av en overlay håndteres av ÉN felles fokusfelle
  (`overlayOpened`/`overlayClosed`, en MutationObserver på `hidden`) — ingen
  åpne-/lukkefunksjon fokuserer «tilbake» selv.

## Systemets tilbakeknapp (Android)

`systemBack()` kjører den samme stigen som Escape, med to tillegg foran:

1. en pågående **inline-redigering** avbrytes (samme vei som Escape i feltet) —
   ellers ville et tilbaketrykk midt i en navngiving truffet laget bak;
2. **del-modalen med `backTo`** går ETT NIVÅ tilbake til modalen den ble åpnet
   fra, altså det `#share-back` gjør. Escape lukker fortsatt helt.

Ett lag per trykk. Er ingenting åpent, svarer web-laget **false**, og OS tar
trykket med den oppførselen plattformen selv har for et tilbaketrykk på
rot-aktiviteten.

**Hovedsiden er bunnen.** Å åpne nav-modalen på et tilbaketrykk ville vært et
lag NED igjen: neste trykk lukket den, trykket etter åpnet den på nytt, og man
kom aldri ut av appen. «Ett Huskis-nivå tilbake» er derfor stigen — inkludert
del-modalens vei tilbake til nav-modalen.

Demonstrasjonen står utenfor, som for Escape (`demoGate`): den bytter ut hele
`state` mens den står på, og ✕ i kortet er den ene utgangen. Tilbakeknappen
svarer false der, så trykket blir et vanlig «forlat appen».

Broen er det **eneste** stedet webkoden kjenner native-runtimen, og den er
eksplisitt gated: `window.__huskisSystemBack` settes bare når
`window.Capacitor.isNativePlatform()` sier at vi kjører i skallet. En nettleser
har ingen Capacitor-runtime, får ingen bro, og oppfører seg nøyaktig som før.
Det native skallet (`android/app/src/main/java/no/huskis/app/MainActivity.java`)
spør broen og lar OS ta trykket når svaret er false — Capacitor gjør ingenting
med tilbakeknappen selv, så uten dette forlot Android appen ved FØRSTE trykk
uansett hva som stod åpent.

Voktere: `tests/system-back.test.js` (stigen, i ekte nettleser, begge
viewportene) og `tests/capacitor-android.test.js` (gaten og skallet).
