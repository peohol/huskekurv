# Lys og mørk drakt

Les denne når oppgaven berører fargevalg, `styles.css`-tokens, ikonfarger eller
palettfargene på kort og rader.

Appen har to drakter: **lys** (som før) og **mørk**. Brukeren velger selv, også
før innlogging. Det finnes ingen «følg systemet» — bare de to eksplisitte
valgene.

## Valget

| Verdi | Betyr |
|---|---|
| `light` (standard) | lys drakt |
| `dark` | mørk drakt |

`THEME.MODES` i `theme.js` er `['light', 'dark']` — nøyaktig disse to, i denne
rekkefølgen. Standarden er lys: appen leser IKKE operativsystemets
`prefers-color-scheme` noe sted, verken som standard eller løpende — et
eksplisitt valg er det eneste som styrer.

Valget ligger i `localStorage['huskis-theme']` og **bare der**. Det er
enhetens, ikke kontoens — i motsetning til språket
([`sprak.md`](sprak.md)), som også ligger på kontoen fordi serveren trenger
det til invitasjons-e-postene. Drakten hører til skjermen man sitter foran og
lyset i rommet; den har ingen serverside-effekt, og to enheter kan gjerne stå
forskjellig. Derfor ingen `user_metadata`, ingen synk og ingen fletting.

Kontrollen er SAMME knapp to steder, avhengig av om kontoknappen finnes å stå
ved siden av:

- **Draktknappen** (`.corner-btn.theme-toggle-btn`, `#theme-toggle-btn`) — i
  toppkontrollgruppen i øvre høyre hjørne, utenfor toppmenyens flyt, skjult før
  innlogging (`body.no-auth`) sammen med resten av gruppen
  (`docs/menus.md`).
- **Innloggingsskjermens egen** (`.corner-btn.theme-toggle-btn.auth-theme-toggle-btn`,
  `#auth-theme-toggle-btn`) — den eneste veien inn FØR man har en konto, siden
  toppkontrollene ikke finnes der ennå. Samme klasser og samme ikon som
  headerens knapp, malt av samme `paintThemeToggle()` — bare inline i
  språkraden (`.auth-lang`) i stedet for i hjørnegruppen.

Begge er ÉTT trykk som bytter mellom de to verdiene; ikonet viser drakten som
ER aktiv (sol i lys, måne i mørk), ikke den du bytter til. Dette er appens
eneste kontroll for drakt — se [`menus.md`](menus.md).

Et bytte laster **ikke** siden på nytt — drakten bor i CSS-tokens og i
kortfargene, og begge deler males på plassen sin.

## `theme.js` lastes i `<head>`

Fila er søsteren til `i18n.js`: ren tilstand, ingen avhengigheter, rører bare
`<html data-theme>`, `<meta name="theme-color">` og den lagrede verdien. Den
eksponerer `window.HUSKIS_THEME` (`mode()`, `effective()`, `setMode()`,
`onChange()`).

Den lastes **i `<head>`, ikke nederst i `<body>`**. Fargene velges av
`data-theme` på rot-elementet, så attributtet må stå der før nettleseren maler
første bilde; lastet sist ville skjermen blinket hvitt før den ble mørk.
`tests/dark-mode.test.js` måler dette i den første `requestAnimationFrame`-en,
altså før første maling.

`setMode()` returnerer om valget ble **lagret** — samme kontrakt som
`I18N.setLang()`. I privat modus kaster `setItem`, og drakten ville falt
tilbake ved neste lasting uten at noen sa fra; `app.js` viser en toast i stedet.

## Tokens, og bare tokens — med ett unntak

Alt som skifter er custom properties. `:root` har de lyse verdiene,
`:root[data-theme="dark"]` overstyrer dem. **Den blokken inneholder ingenting
annet enn custom properties** — ingen nye regler, ingen duplisert geometri.
Trenger du en `[data-theme="dark"]`-regel med noe annet i, mangler det et
token i `:root`.

Tokenene er delt i to familier etter hva de ligger på:

- **Flate-familien** (`--surface*`, `--line`, `--wash*`, `--overlay`,
  `--glass-bg`, `--control-bg*`, `--track`, `--count-bg`, `--free-*`) ligger på
  appens egne flater: modaler, toppmeny, paneler. I mørk drakt blir flatene
  mørke og blekket lyst.
- **På-farge-familien** (`--tint*`, `--hairline`, `--on-color-soft`,
  `--item-text-shadow`, `--item-text-stroke`) ligger oppå en **palettfarge**.
  Der snur ikke flaten — palettfargen gjør jobben selv — men lagene oppå: de
  svarte hårstrekene blir hvite, og tekst-borderen på listepunkter/mappetitler
  slår på (av i lys drakt, siden `.item-text` der er vanlig `--ink`-blekk uten
  behov for kant).

**Unntaket:** `--plate*`, `--chip-bg` og de tilhørende kortflate-tokenene
(`--card-face`, `--card-head-face`, `--cat-face`, `--card-stripe`) er OGSÅ
«på-farge», men kan ikke være en flat `:root`-verdi — de skal bære et preg av
NETTOPP flatens EGEN palettfarge (`--card-bg`, satt inline av
`paintCardColor()` i `app.js`), og blandes derfor med `color-mix()` i en egen
`:root[data-theme="dark"]`-blokk rett under token-blokken i `styles.css`. Se
kommentaren der, og «Kortflatene: palettpreg og aksentstripe» under.

**Blokken bor der `--card-bg` bor.** Verdiene er blandinger av flatens egen
farge, så selektorlisten må dekke HVER node som setter den: `.card`,
idébeholderen `.ideas-card` (nøytral flate) og idékategorien `.idea-cat`
(palettfarget, se [`ideer.md`](ideer.md)). Nøstingen går opp av seg selv — en
idékategori inne i idébeholderen redefinerer tokenene fra sin egen `--card-bg`.
En ny flate med egen `--card-bg` som glemmer å bli med hit, arver den LYSE
draktens hvite plater; `tests/a11y-contrast.test.js` sjekker selektorlisten.

Idékategorien er den ene som i tillegg maler en FLATE her (dempet `--card-face`
+ aksentstripe + kontur, som et kort). Den regelen gjelder kun i hvile: den er
like spesifikk som dra-blokken og står etter den, så
`:not([data-dnd-placeholder]):not([data-dnd-dragging])` holder dra-tilstandene
hos dra-blokken der de hører hjemme.

Fire ting snur som ikke er flater:

- **Fokusringen.** `--focus` er mørk i lys drakt (den må lese mot alle lyse
  flater) og **hvit** i mørk. Den mørke gir 1,0:1 mot den mørke
  board-bakgrunnen; den hvite gir ≥ 4,0:1 mot alle 36 mørke palettfarger.
- **Signalfargene som også er tekst.** `--danger`, `--warn` og `--primary-dark`
  er flate- og signalfarger (knappegradienter, prikker) og skal ikke lysne. Der
  de brukes som *tekst* brukes `--danger-ink`, `--primary-ink` og `--note-ink` i
  stedet — identiske med originalene i lys drakt, lyse i mørk.
- **Signaler som tegnes OPPÅ en kortfarge.** Tre av dem er faste farger på et
  underlag som skifter med drakten, og alle falt igjennom da paletten ble mørk:

  | Token | Hva | Hvorfor |
  |---|---|---|
  | `--check-hover` | avkryssingsboksens kant ved hover | `--primary` klarer så vidt 3:1 mot den mørke platen (min 3,13:1) — men med langt mindre margin enn dette dedikerte tokenet gir (min 5,94:1), og en hover-kant skal ikke bli utydeligere enn hvilekanten i det øyeblikket man sikter på den. |
  | `--scrim` | drag-placeholderens flate | en mørkning på en mørk board-bakgrunn er 1,03:1; et *løft* gir 1,45:1. |
  | `--drag-danger-face` / `--drag-archive-face` | flaten et løftet objekt males i når det holdes over søppelkassen respektive arkivet | fargen ERSTATTER palettfargen i alle lagene av objektet, og `--dnd-veil` gir gjennomsikten ([`drag-and-drop.md`](drag-and-drop.md)). Den mørke drakten løfter i stedet for å mørkne, så flatene er de LYSE tonene. |
  | `--drag-danger-ink` / `--drag-archive-ink` | blekket på den flaten | rød bærer hvit tekst i lys drakt og mørk i mørk; gul bærer mørk tekst i begge. Måles i `dnd-drop-colour` (≥ 4,5:1 mot den faktisk malte flaten). |

  `--scrim` når ikke 3:1 — og har aldri gjort det, heller ikke i lys drakt
  (1,22:1). Det er en flate som kommer sammen med andre signaler. Kravet testen
  håndhever er derfor **paritet**: den mørke drakten skal ikke være dårligere
  enn den lyse.

`color-scheme` settes på rot-elementet i begge drakter, så det vi ikke tegner
selv følger med: `<select>`-nedtrekket, dato- og klokkeslettvelgerne i
tidsplanen ([`scheduling.md`](scheduling.md)) og rullefeltene.

## Ikonene snur uten at en eneste SVG endres

Ikonsettet (`icons.js` + de innlimte SVG-ene i `index.html`) har fargene som
**presentasjonsattributter**: `stroke="#111"`, `fill="#ffffff"`,
`fill="#c0c4c9"`. En CSS-regel slår et presentasjonsattributt, så tre
attributt-selektorer maler dem om til `--icon-ink`, `--icon-paper` og
`--icon-grey`. I lys drakt er tokenene identiske med attributtene; i mørk blir
streken lys og «papiret» mørkt, så ikonene leser som strektegninger på mørk
flate i stedet for som hvite blaff.

Unntaket er `.btn-solid`. Gradientene på de fargede knappene er de samme i
begge drakter (de er kontraktsfarger, se
[`tilgjengelighet.md`](tilgjengelighet.md)), så ikonene på dem skal bli stående
svarte — det er nettopp derfor grønnfargen får være lys. Knappen pinner derfor
`--icon-ink`/`--icon-paper` tilbake, og `--ink` med dem: `.btn-yellow` setter
`color: var(--ink)` fordi en gul flate ikke kan bære hvit tekst, og uten
pinningen ville blekket lyst opp i mørk drakt og gjort nettopp det ulovlige.
Custom properties arver, så ett sted dekker hele subtreet.

Regelen bak unntaket er at pinningen hører til **flaten**, ikke til
beholderen: er flaten under glyfen en kontraktsfarge, står glyfen stille. Derfor
pinner gruppeikonet i «Kommende hendelser» (`.event-icon`) sin egen plate, mens
typeikonet i raden ved siden av — som står rett på modalflaten — følger drakten
som alle andre ikoner. Pinner man hele modalen i stedet, tar man med seg ikoner
som ikke har noen kontraktsfarge under seg, og de forsvinner
([`kommende-hendelser.md`](kommende-hendelser.md)).

Statuschipene under navnet (`.meta-chip`, seks toner —
[`scheduling.md`](scheduling.md)) er fargede flater som ikke er `.btn-solid`, og
de fanges derfor ikke av knappenes pinning. Skillet går på hvor LYS flaten er:
på de to mørke er den lyse streken en **forbedring** (blågrønt 3,90 →
3,95/5,54, rødt 3,52 → 4,38/5,56), mens de fire lyse — gul, grønn, lilla, blå —
pinnes mørke. Gult er det tydeligste tilfellet: 1,47:1 med lys strek mot
10,48:1 med mørk. Samme regel som `.btn-yellow`: en lys flate bærer mørke
merker. Streken og «papiret» pinnes **sammen** — ellers ville mørk strek møtt
mørkt papir og ikonet blitt en ulesbar klatt.

**Kalenderikonet** (`calendar`/`calendarDue`) er et tredje slag pinning,
`.icon-pin-light`: her er det MOTIVET, ikke en flate under det, som er
kontraktsfargen — et papirark er hvitt uansett hvor mørkt rommet er, så
kalenderens hvite flate skal IKKE snu med drakten, i motsetning til
klokkeikonets (som følger drakten som alle andre ikoner uten denne klassen).
Streken derimot går MED drakten, men ulikt: `.icon-pin-light` pinner kun
`--icon-paper` (+ `--icon-grey`, ubrukt her) til hvit i begge drakter;
`--icon-ink` pinnes IKKE i den regelen, så i lys drakt er den fortsatt det
vanlige `#111111` (rammen/streken leser som en strektegning på hvitt papir),
mens en egen `:root[data-theme="dark"] .icon-pin-light`-regel overstyrer den
til hvit i mørk drakt. Resultatet: hvitt papir + svart strek i lys drakt
(vanlig kalender), hvitt papir + hvit strek i mørk drakt — streken smelter
sammen med det pinnede papiret, og formen leser i stedet mot den mørke
bakgrunnen rundt, som en helhvit plate med rød/oransje topp. Custom
properties arver, så pinningen dekker hele ikonet fra klassen på selve
`<svg>`-elementet, ingen ekstra selektor per barn.

**Ikonfyllene** — nå for det meste egne motivfarger (manila-tan mappe,
blyantgul, messing-gult bjelle, terrakotta kalendertopp, søkeblå linse,
sol-oransje/himmelblå sol/måne osv.) og for et par ikoner fortsatt palettens
kortfarger (globusens felter, mappene i logoen, kontoikonet/kamera/hånd-opp —
se `design-system.md` → «Fargekart» for hvilket som er hvilket — står ALLE
uendret i begge drakter. Motivfargene er valgt til å lese godt mot mørk flate
på egen hånd (ikke avledet fra et L-sett); palettfyllene er fortsatt den lyse
palettens sett (S=20 %, L=60). Skiftet til den mørke rekka ville gjort
ikonene grumsete uten å vinne noe. Draktknappens eget ikon er et eksempel på
en motivfarge: sola er oransje, halvmånen himmelblå — to ulike, faste farger,
ikke «papir» som snur.

## Palettfargene: samme tone, speilet lyshet

Kort-, mappe- og områdefargene er de eneste fargene som **ikke** bor i CSS — de
utledes av posisjon ved rendring ([`colors-and-labels.md`](colors-and-labels.md)).
Tone og metning er de samme i begge drakter; bare L-settet snur:

```
lys   L = [60, 75, 90]
mørk  L = [42, 32, 22]
```

Den mørke rekka er **ikke** en ren `100 − L` (`[40, 25, 10]`). Kontrastforhold
speiles ikke lineært i L: mot en mørk board-bakgrunn faller L=10 til 1,0–1,1:1,
og de tre settene ville smeltet sammen med bakgrunnen og med hverandre.
`[42, 32, 22]` er speilingen komprimert opp i det området som fortsatt har
spennvidde, og gir målt nesten samme spredning mot board-et som den lyse gir mot
sitt:

| Sett | Lys drakt, mot `--bg` | Mørk drakt, mot `--bg` |
|---|---|---|
| 1 | 1,31–1,99:1 | 2,55–4,37:1 |
| 2 | 2,25–2,82:1 | 1,81–2,80:1 |
| 3 | 3,52–3,84:1 | 1,32–1,74:1 |

Samme gulv (1,3) og samme tak (3,8–4,4), med settene i motsatt rekkefølge — som
er hele poenget med en speiling.

Kortets to avledede farger snur retning med drakten (`paintCardColor` i
`app.js`): korthodet og avkryssingsboksens kant **mørknes** i lys drakt og
**lysnes** i mørk. Mørknet på et allerede mørkt kort ville gitt et korthode som
forsvinner i bakgrunnen og en avkryssingskant som er borte.

Fordi kortfargene settes inline og ikke av CSS, må de males på nytt når drakten
skifter. `app.js` lytter på `THEME.onChange` og maler **kirurgisk, aldri med en
full `render()`**:

1. **`reindexContainerColors`** bytter custom properties på kortene som allerede
   står i DOM-en, i begge scopene.
2. **`repaintAvatars()`** for ansvarssirklene, som `respAvatar` maler inline.
   Sirkelens farge kommer av personens plass i delegruppen — en indeks som ikke
   finnes igjen i DOM-en — så elementet stemples med kilden (`data-pal-index`
   eller `data-pal-id`) når det bygges, og males om derfra.

Til sammen er det hver eneste palettflate som lever i board-et, så en full
`render()` ville ikke tilført noe — men kostet tre ting: den river ned et åpent
`.edit-input` (`captureFocusIn` bevarer det ikke, og en fjernet fokusert node
fyrer ikke pålitelig sin egen `blur`), `renderBoardInner()` kaller `save()` og
ville dermed stemplet dokumentet som endret og køet en synk-runde for et rent
lokalt fargebytte, og å utsette rendringen løser ingenting — `finishDrag()`
kalles av droppene FØR de har committet, så en rendring der ville malt board-et
fra tilstanden før slippet.

Søppelkassens prikker utleder fargen **direkte fra id-en** (`colorForId`) i den
drakten som gjelder når raden bygges — de tar ikke objektets hurtiglagrede
`.color`. Det er ikke bare ryddigere, det er den eneste varianten som holder:

- Et draktbytte MENS appen står åpen kunne vært løst med en opprydding i
  lytteren. En **kaldstart** kan ikke: `theme.js` maler den lagrede drakten før
  `app.js` rekker å registrere lytteren sin, så et bytte tatt i en TIDLIGERE
  økt (eller på en annen fane) når aldri fram til noen opprydding før
  gjeldende side alt har malt kortene sine.
- Og `.color` overlever mellom øktene: `stateReplacer` fjerner bare
  `_`-prefiksede nøkler, så den ligger i den lokale bufferen.

For et trashet objekt er `.color` uansett et levn fra sist det var synlig —
posisjonsfargen fryses idet det forsvinner ut av lista. `colorForId` er
deterministisk per objekt og dermed stabil på tvers av økter og enheter, og er
allerede dokumentert som søppelkassens fargekilde
([`colors-and-labels.md`](colors-and-labels.md)).

## Kontrasten er målt, ikke valgt

`tests/a11y-contrast.test.js` regner ut den mørke halvdelen av kontrakten på
nytt fra `:root[data-theme="dark"]` og fra L-settene i `app.js`, akkurat som den
gjør for den lyse: blekket på de mørke flatene, fokusringen og ikonstreken mot
alle 36 mørke palettfarger, teksten på kortsubtreets flater (som er
blandinger — `color-mix()` av kortets egen palettfarge og en nøytral reserve,
simulert per palettfarge i testen — se «Kortflatene: palettpreg og
aksentstripe» under), trafikklyset mot den mørke statuspillen, og at de to
L-settene faktisk speiler hverandre.

Endrer du en verdi i den mørke blokken eller et L-sett, kjør den testen.
Kravene selv står i [`tilgjengelighet.md`](tilgjengelighet.md).

## Kortflatene: palettpreg og aksentstripe

I stedet for at palettfargen dekker hele kortet, er kortet i mørk drakt en
mørk skiferflate som bærer sin egen palettfarge — 13 % i kortflaten og
korthodet (identitetsflaten), 10 % i platene og kategorifordypningen
(innholdsflatene) — og fargen får i tillegg en 4 px aksentstripe langs venstre
kant, i SAMME farge som avkryssingskanten (`--card-accent`). Lyshet uttrykker
hierarkiet; fargen holder identiteten.

Reglene bor i en egen `:root[data-theme="dark"] .card`-blokk i `styles.css`,
rett under den flate token-blokken — se «Tokens, og bare tokens» over for
hvorfor de MÅ stå der og ikke som en flat `:root`-verdi. To ting styrer den
blokken:

- **Ingen regel der må lage en containing block.** dnd-kit løfter objektet inn i
  top layer og posisjonerer det selv, så en posisjonert eller transformert forfar
  flytter hele dra-geometrien. Et tidligere forsøk satte `position: relative` på
  `.card` for å tegne stripen med `::before`, og det gjorde `.card` til
  containing block for sine absolutt posisjonerte etterkommere OG lot selektoren
  overstyre det løftede objektets egen posisjonering — det la seg langt nedenfor
  fingeren på fire av fem nivåer. Stripen males derfor med en
  BAKGRUNNSGRADIENT; `outline` og `box-shadow` er de eneste andre virkemidlene i
  blokken.
  `tests/dnd-viewport-clamp.test.js` måler pekerforankringen i mørk drakt på
  alle fem nivåer, og `tests/dark-mode.test.js` slår fast at `.card` er
  `static`.
- **Ingen regel der må overdøve en tilstand fra resten av `styles.css`.**
  Selektorene er `(0,3,0)` og slår dermed `.card:hover`,
  `.dnd-surface .card[data-dnd-dragging]` og `.nav-board .card.active`. Flater som
  eies av en tilstand justeres derfor via tokens, ikke direkte; der en flate
  likevel settes direkte, står tilstanden eksplisitt utenfor (`:not(.active)`,
  `:not([data-dnd-dragging])`).

Fargepreget utledes av de eksisterende kortvariablene: `--card-bg` og
`--card-accent` settes allerede inline per kort av `paintCardColor()` i
`app.js`, og blokken blander ut fra dem med `color-mix()`, med en ren hex-verdi
foran som reserve (en nettleser uten `color-mix` beholder den nøytrale
skiferflaten — fullgod, bare uten fargepreg). Det finnes ingen parallell
palett.

Målt over alle 36 mørke palettfarger, som min–maks:

| Trinn | Ratio |
|---|---|
| board → kortflate | 1,15–1,32 |
| kortflate → korthode | 1,19–1,21 |
| kortflate → listepunkt | 1,07–1,10 |
| listepunkt → hover | 1,15–1,16 |
| kortflate → kategorifordypning | 1,09–1,14 |

| Tekst/kontroll | Ratio | Krav |
|---|---|---|
| `--ink` på korthodet | 8,94–10,42 | 4,5 |
| `--ink` på listepunkt-platen | 10,07–11,33 | 4,5 |
| `--ink` på kategorifordypningen | 12,34–13,53 | 4,5 |
| `--ink-soft` på korthodet | 4,58–5,34 | 4,5 |
| `--ink-soft` på platen | 5,16–5,80 | 4,5 |
| avkryssingskanten (`--card-accent`) mot platen | 3,05–5,36 | 3 |
| aksentstripen (`--card-accent`) mot korthodet | 2,80–4,76 | — |
| aksentstripen mot kortflaten | 3,34–5,76 | — |
| `--focus` mot korthodet | 11,04–12,88 | 3 |

Avkryssingskantens 3:1 er det som **binder** trappa: platen kan ikke lysnes mer
uten at `--card-accent` mister kontrakten sin mot fyllet den ligger på. Av
samme grunn følger avkryssingsboksens fyll ikke med opp til `--plate-hover` —
kontrollen skal ikke bli utydeligere i det man sikter på den.

**Stripen ER `--card-accent`, ikke en egen, lysere utgave.** Første runde
blandet den med 18 % hvitt for å vinne kontrast mot det lysnede korthodet, men
det gjorde stripen blekere og mindre mettet enn aksenten lys drakt viser for
samme kort — nettopp det motsatte av hensikten (samme kort skal kjennes igjen
når man bytter drakt). Pikselidentisk med LYS drakts egen aksentformel
(`darken(base, 0.32)` på den lyse, ikke speilede, palettfargen) er ikke trygt:
regnet ut mot de nye platene faller den til 1,9–5,2:1, altså nesten usynlig for
enkelte fargetoner. `--card-accent` er derfor den nærmeste sikre tilnærmingen —
samme verdi appen allerede bruker som «aksentfargen» til akkurat dette kortet i
mørk drakt. Mot korthodet gir den 2,80–4,76:1: under 3:1 i verste hjørne, men
det er en dekorativ stripe uten tekst på seg, og kravet er paritet med
intensjonen (samme presedens som `--scrim` over), ikke et nytt
gulv.

Tekst-borderen fra `--item-text-shadow`/`--item-text-stroke` er på, men tynnere
(0,5 px mot 1 px): blekket klarer flatene med god margin, så streken er
robusthet mot fargepreget, ikke en kontur.

## Android-skallet: systemfeltene følger telefonen, ikke drakten

Appen tegner under systemfeltene (`viewport-fit=cover`, se
[`design-system.md`](design-system.md)), så man skulle tro at flaten bak klokka
er vår og dermed skifter farge med drakten. **Det gjør den ikke.** Målt på
telefon: båndet bak statusfeltet er VINDUSBAKGRUNNEN fra Android-temaet. Med et
permanent lyst tema var båndet lyst også når appen under var mørk.

Derfor er både flaten og glyfene bundet til telefonens nattmodus, ikke til
draktvalget:

- foreldretemaet er `Theme.AppCompat.DayNight.NoActionBar`, så vindusbakgrunnen
  blir mørk om natten;
- `values-night/` og `values-night-v27/` snur `windowLightStatusBar` og
  `windowLightNavigationBar` til `false` i samme slengen;
- `SystemBars.style = "DEFAULT"` lar pluginen lese den samme nattmodusen i
  runtime (pluginen overstyrer temaet etter oppstart, rotasjon og modusbytte).

Én kilde for både bånd og glyfer betyr at de ikke kan komme i utakt. Velger
brukeren en drakt som avviker fra telefonen, blir toppen uvant, men aldri
uleselig: mørkt bånd med lyse glyfer over en lys side, eller omvendt.
Verifisert på fysisk telefon i begge drakter, også med drakten overstyrt mot
telefonens modus.

**Splash-temaet har med vilje ingen night-variant.** `drawable/splash.png` er
hvitt hele døgnet, så der gjelder mørke glyfer også om natten.

**Historikk, fordi den er lett å gjenta:** kombinasjonen «permanent lyst tema»
+ `SystemBars.style = "DEFAULT"` ble prøvd og var uleselig på telefon i begge
modi — lyse glyfer på et lyst bånd. Feilen var ikke `DEFAULT` i seg selv, men at
båndet og glyfene hadde hver sin kilde. Vakten står i
`tests/capacitor-android.test.js`, med begrunnelsen skrevet ut i begge
retninger: låses glyfene igjen, må vindusbakgrunnen låses i samme slengen.

Appens EGEN drakt leser aldri `prefers-color-scheme` — se «Valget» over, det
finnes ingen «følg systemet» i `theme.js`. Fra targetSdk 33 utleder WebView
den CSS-egenskapen av appens tema (`isLightTheme`), ikke av telefonens
nattmodus, men det er uten betydning for oss: DayNight trengs likevel, for
koblingen mellom bånd og glyfer over.

Nettleseren er upåvirket: der er `<meta name="theme-color">` det eneste som sier
noe om rammen, og `theme.js` holder den i takt med `--bg`.

## Hva testene dekker

| Fil | Dekker |
|---|---|
| `tests/a11y-contrast.test.js` | kontraktstallene i begge drakter, inkludert kortsubtreets `color-mix()`-blandede flater (`--plate*`, `--chip-bg`, `--card-face`, `--card-head-face`, `--cat-face`) og avkryssingskanten/aksentstripen (`--card-accent`, speilet fra `paintCardColor()` i `app.js`) |
| `tests/dark-mode.test.js` | attributtet før første maling, begge draktknappene (headeren og innloggingsskjermen), varighet over omlasting, speilingen av kortfargene, `color-scheme` og `theme-color`, at et draktbytte ikke river ned en pågående navngiving, og at kortflaten faktisk males om (en regel som stille slutter å gjelde ser ut som «før») uten å posisjonere kortet |
| `tests/dnd-viewport-clamp.test.js` | at ingen drakt-regel forskyver dra-geometrien: pekerforankringen måles i mørk drakt på alle fem nivåene (område, mappe, liste, kategori, listepunkt) |
| `tests/build-version.test.js` | at `theme.js` versjoneres og langtidscaches som de andre klientfilene |
| `tests/capacitor-android.test.js` | at Android-skallet står på DayNight, at night-variantene snur glyfene, og at `SystemBars.style` er `DEFAULT` |
