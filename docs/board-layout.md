# Listevisningen (board): kolonner + luft-system

Les denne når oppgaven berører kolonnefordelingen eller avstander/padding/gap i
selve listevisningen (kolonnene med lister/kort), IKKE menyene rundt (se
`docs/menus.md`).

**Notatfanen bruker det samme board-et.** `#notes-board` er et `.board` med
`.board-col`-containere og `.note-card`-kort, og går gjennom nøyaktig den samme
`relayoutBoard`/`packBoardColumns`-motoren (scopet `notesScope`). Notatkortene
er derfor flere kolonner på desktop og én på mobil av samme grunn og etter samme
regnestykke som listene — ingen egen grid, ingen egne terskler, og SAMME
pakkerekkefølge: venstre kolonne fylles først (se under). Det eneste notatene
har for seg selv er minstebredden (`notesScope.colMin`): et notatkort er
lesbart på mindre plass enn en liste med rader og chips. Bare ETT av de to
board-ene er synlig om gangen, og fordelingen hoppes over for et skjult board:
alt måler 0 der. Se [`notater-plan.md`](notater-plan.md).

## Kolonner: fyll venstre kolonne først

Board-et er **ikke** CSS multi-column. Kolonnene er ekte containere
(`.board > .board-col`), og JS fordeler kortene i dem (`relayoutBoard` i app.js).

**Regelen:** fyll kolonne 1 til kolonnebudsjettet er brukt opp, så kolonne 2, osv.
En ny kolonne tas altså i bruk først når den forrige ikke har plass til neste
liste. Multi-column gjorde det motsatte — den BALANSERER: tre lister ble tre
kolonner med én liste hver, og en fjerde liste havnet i kolonne 2 mens kolonne 1
fortsatt hadde masse plass.

- **Kolonneantall** = `max(1, floor((boardbredde + gap) / (380 + gap)))` —
  `BOARD_COL_MIN` (380 px) er den samme terskelen den gamle `column-width` hadde,
  så kolonnene dukker opp ved samme vindusbredde som før. Kolonnene er alltid
  til stede som `flex: 1 1 0`-elementer, også de tomme: da har et kort samme
  bredde uansett hvilken kolonne det havner i, og høydene vi måler før
  fordelingen holder etterpå. (Å variere kolonneantallet med FYLLINGEN ville gitt
  en tilbakekobling: færre kolonner → bredere kort → lavere kort → plass i færre
  kolonner …) En tom kolonne til høyre er derfor forventet når listene får plass
  til venstre — men den er ingen PLASS: pakkingen er grådig, så et kort sluppet
  der faller tilbake til den siste kolonnen som har innhold. Et drag kan derfor
  ikke legge en plassholder i den (`dndLiveColumns`, se
  [`drag-and-drop.md`](drag-and-drop.md)).
- **Kolonnebudsjettet** = skjermhøyden under toppmenyen (minus luften over og
  under, og minus `--safe-bottom` — gestelinjens strimmel er ikke skjerm man kan
  bruke). Får ikke alt plass i de kolonnene vinduet har rom til, økes budsjettet
  til det MINSTE som holder (binærsøk over en monoton grådig pakking) — kolonnene
  blir høyere, siden scroller, og den øverste lista i kolonne 2 glir ned som den
  nederste i kolonne 1.
- **Leserekkefølgen** (kolonne 1 topp→bunn, så kolonne 2 …) er DOM-rekkefølgen og
  er den rekkefølgen `pos` lagres i. Naboen over den første raden i en kolonne
  ligger nederst i kolonnen FØR — bruk `boardRows()`/`boardRowSibling()`, ikke
  `previousElementSibling`, når du regner ut `pos` på board-nivå.

**Når kjøres fordelingen?** Etter `render()`, ved vindus-resize, og ellers av en
`ResizeObserver` på board-et og hvert kort (korthøyder endres av kollaps,
listepunkter inn/ut, tekst som brytes om). Den skriver bare når fordelingen
faktisk endrer seg, så observatøren kan ikke gå i løkke med seg selv.

**Nav-modalens board** (`#nav-board`, områder som kort — se `docs/menus.md`)
bruker det SAMME maskineriet, bare med `navScope.singleColumn = true`: alltid én
`.board-col`, uansett bredde. Da kan en høyde-endring aldri endre fordelingen, så
det scopet observeres ikke (`observeBoardRows` hopper over det) — `renderNav()`
kaller `relayoutBoard(navScope)` selv når den bygger kortene. Kolonnebudsjettet/
`fixBoardBottomGap` gjelder kun hovedsidens board; i modalen er det modalens egen
padding som er bunn-luften.

`observeBoardRows` holder observatørens mål i takt med kortene som faktisk står på
board-et: `render()` river alle kortnodene og `refreshCard()` bytter ut enkeltnoder,
så uten opprydding ville observasjonene av de frakoblede nodene hopet seg opp for
hver eneste re-render (appen re-rendrer ved hver synk). Board-et selv observeres
permanent — det er bredde-endringene som avgjør kolonneantallet.

To ting relayouten IKKE gjør:

- **Ikke under et drag** (`drag.active`) — kortene skal ligge i ro under fingeren,
  og en omfordeling midt i et drag ville gitt tilbake nettopp den tilbakekoblingen
  ekte kolonner fjerner (se `docs/drag-and-drop.md`). Den kjøres ved slipp.
- **Ikke mens et navnefelt i board-et har fokus** — en node som flyttes i DOM
  mister fokus (og markøren). Den venter til feltet forlates (`focusout`).

## Luft

**Ett tall, `--board-gap` (`clamp(12px, 4vw, 40px)`), styrer ALL luft i board-et**
— venstre/høyre-padding på `.app-main`, kolonne-gap (`.board`s `gap`), og
kort-til-kort-avstand (`.card`s `margin-bottom`). Samme variabel overalt → luften
er alltid identisk, uansett viewport-bredde (verdien er responsiv, men leses fra
ÉN kilde). Endres `--board-gap`, følger ALT automatisk med — ikke hardkod en egen
verdi noe sted i board-et.

Side-paddingen legger i tillegg på `--safe-left`/`--safe-right`. Det er ikke
luft, men den strimmelen av skjermen et hakk eller en avrundet kant gjør
ubrukelig; den er 0 i en nettleser, så luft-regelen over er uendret der.

## Bunn

`.app-main` har `padding-bottom: var(--safe-bottom)` — luften under SISTE kort
kommer fra kortets EGEN `margin-bottom` (samme `--board-gap`), ikke fra en egen
bunn-padding (det ville lagt gap oppå gap). Kolonnene er flex-containere, så
marginen kollapser ikke bort: den høyeste kolonnen ender med nøyaktig ett gap
etter siste kort. Bunn-paddingen er derfor bare den delen av viewportet
systemets gestelinje dekker — 0 i en nettleser, se
[`design-system.md`](design-system.md) («Den sikre sonen»).

`fixBoardBottomGap()` i app.js MÅLER likevel utfallet per render (nullstiller
`.board`s `padding-bottom`, tvinger reflow, sammenligner board- og siste-korts
bunnkant) og legger på akkurat nok padding til at total bunn-luft alltid blir
nøyaktig `--board-gap`. Den ble skrevet mot en multi-column-kvirk (`column-fill:
balance` kunne ignorere siste korts margin ved ujevnt balanserte kolonner) og er
i praksis en no-op med flex-kolonnene — men den er billig og fanger opp
avrundinger, så den blir stående som sikkerhetsnett.

## Topp

`.app-main`s `padding-top` settes IKKE via CSS `calc()`, men regnes ut i JS
(`syncTopChrome`, med `ResizeObserver` på både toppmenyen og
toppkontrollgruppen): den laveste underkanten av det faste chromet
**+ `--board-gap`**, satt som `--board-pad-top`. Chromet er to ting, og begge
kan vokse: `.topbar` (breadcrumb + listefunksjoner, på én linje eller to rader
etter bredden) og `.corner-controls` (søk/drakt/konto, som brytes til flere
rader når raden ikke rekker) — se [`menus.md`](menus.md).

Samme funksjon måler to ting til: `--corner-btns-w` (bredden på gruppens
BREDESTE rad — plassen hver av toppmenyens rader holder av til den) og
`--corner-btns-overflow` (høyden gruppen har utover toppmenyens egne rader, som
legges på toppmenyens `padding-top` så en gruppe-rad aldri dekker menyens
kontroller). Se [`menus.md`](menus.md).

At det MÅLES er det som gjør at klaringen tåler at chromet selv vokser med den
sikre sonen (`--safe-top`, se [`design-system.md`](design-system.md)) eller med
en knapp til i hjørnet: det er ett tall, og det er alltid det faktiske.

`--board-pad-top` er samtidig sidens `scroll-padding-top`. En rulling som skal
«ta noe fram» — nettleserens egen rulling når et navnefelt får fokus, og den
skjermtastaturet utløser når det krymper viewportet — vet ellers ikke at det
faste panelet dekker toppen, og kan legge feltet rett under det. Paddingen må
ligge på RULLEBOKSEN (siden): kortene har `overflow: hidden`, så en
`scroll-margin` på feltet inne i et kort når aldri ut til sidens rulling.

`--board-gap` kan IKKE leses direkte fra `:root` i JS (en `clamp()`/`vw`-custom-
property gir tilbake selve uttrykket som streng, ikke tallet den løses til) —
den leses derfor fra `.board`s FAKTISK OPPLØSTE `column-gap`
(`getComputedStyle(board).columnGap`; `gap` på en flex-container oppløses til
`column-gap`), som ER et vanlig, oppløst tall. Resultat: avstanden fra menyenes
nedre kant til første kort er PIKSELNØYAKTIG lik gapet ellers, ikke en tilnærmet
verdi fra en separat `clamp()`.

## Mobil, én kolonne

Kolonneformelen gir 1 av seg selv så smalt. Mobil-media-regelen (`max-width:
560px`) setter derfor bare `--board-single-column: 1` — CSS-sidens svar på
«er board-et i énkolonne-modus?», som `tests/dnd-layout-modes.test.js` leser for
å vise at CSS og JS er enige om modus. Grensen må derfor følge JS-utregningen,
og ikke slås sammen med toppmenyens stable-grense (620 px), som avhenger av noe
helt annet — hvor bred hjørnegruppen er ([`menus.md`](menus.md)). Kortene (`width: 100%`, base-regelen)
fyller hele den ene kolonnen → jevn luft på alle sider siden `--board-gap`
uansett brukes konsekvent.
