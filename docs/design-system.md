# Designsystem og UX-prinsipper

Les denne når oppgaven berører `styles.css`, nye kontroller/knapper, eller
visuell konsistens på tvers av nivåer (område/mappe/liste/listepunkt).

Appen skal føles **visuelt ryddig, konsistent og forutsigbar**.

## Typografi og skala

Fonten er **Atkinson Hyperlegible Next** — valgt for lesbarhet/tilgjengelighet.
Den er selvhostet: `@font-face` øverst i `styles.css` peker på `assets/fonts/`,
ikke på Google Fonts ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)). Alle synlige listepunkter (tekst, ikoner,
knapper, kontroller) er skalert opp ~30 % i forhold til det opprinnelige
designet, mens padding/margin/gap IKKE er skalert tilsvarende — bevisst valg:
større, mer lesbare og lettere treffbare listepunkter i et fortsatt kompakt UI.

Områder, mapper, lister og listepunkter deler **identisk oppsett**: et område
ER et listekort (`.card`) og en mappe ER en listepunkt-rad (`.item`), bare i
nav-modalen (`docs/menus.md`). Dermed er tittel-typografi (20px/600 `.card-title`),
radhøyder, luft og ikonstørrelser like på alle nivåer uten egne regler.

Tekststørrelsene er tokens (`--fs-xs` 15 / `--fs-sm` 17 / `--fs-md` 18 /
`--fs-base` 19 (brødtekst) / `--fs-lg` 20 (titler) / `--fs-xl` 24
(modal-overskrifter)). Bruk et token, ikke en px-verdi — «juster all tekst X %»
skal være én endring. Kun ikon-/en-gangs-geometri (brand-mark, ikon-bokser)
står fortsatt som px.

## Tokens, ikke hardkoding (styles.css, øverst)

`--control-h` (49px), `--control-radius` (14px), `--control-bg`
(rgba(255,255,255,.75)), `--toolbar-pad`, `--text-shadow`,
`--grad-green/-accent/-red/-yellow` (knappe-gradienter, pluss
`--grad-purple/-blue` som bare brukes av startgruppene i «Kommende
hendelser», og `--grad-slate` som er den nøytrale flaten de to gruppene lenger
ute enn en måned deler der), `--danger`/`--warn`
(fare/advarsel som flate- og signalfarge), `--switch-motion` (bevegelsen i
appens brytere), `--dnd-veil` (hvor mye av sin egen farge en LØFTET flate
beholder), skygge- og radius-variablene. Nye
kontroller skal bruke disse — aldri egne ad hoc-verdier. Endres et token, skal
hele appen følge med.

Alle knapper i samme knapperad har identisk høyde/radius/flate (`--control-h`
/ `--control-radius`). Gjelder ＋-knapper, søppelkasser, breadcrumb-knappene,
kontoknappen og draktknappen.

**Ingen hardkodet flate-, linje- eller ikonfarge.** Alt som skifter mellom lys
og mørk drakt er tokens: `--surface*` (paneler/felt), `--line`, `--wash*`
(svak toning på en lys flate), `--overlay`/`--glass-*`, `--plate*` og `--tint*`
(lagene som ligger OPPÅ en palettfarge), `--hairline`, `--chip-bg`,
`--icon-ink`/`--icon-paper`/`--icon-grey`, og `--danger-ink`/`--primary-ink`/
`--note-ink` der en signalfarge brukes som tekst. Skriver du en ny regel med
`#fff`, `rgba(0,0,0,…)` eller `rgba(255,255,255,…)` i seg, er den mørke drakten
allerede ødelagt — bruk et token, eller legg til ett.

Unntaket er hvit tekst/glyfer PÅ en fargeknapp (`.card-cog`, `.btn-solid`):
gradientene er kontraktsfarger i begge drakter, og teksten/ikonet skal fortsatt
stå som `#fff`. Korttittelen (`.card-title`/`.cat-title`) er derimot hvit KUN i
lys drakt — i mørk drakt leser `--ink` bedre på de tonalt varierte
kortflatene, og en `[data-theme="dark"]`-regel overstyrer fargen (se
`:root[data-theme="dark"] .card`-blokken i `styles.css`). Autoritativt for
drakten: [`mork-drakt.md`](mork-drakt.md).

## Den sikre sonen (`--safe-top`/`-right`/`-bottom`/`-left`)

Fire tokens som sier hvor mye av viewportet systemets egne flater dekker:
statusfelt eller hakk øverst, gestelinje nederst, hakk og avrundede hjørner i
sidene. De leses fra `env(safe-area-inset-*)`.

**En vanlig nettleser rapporterer ingenting** — der er alle fire 0, og hver
regel som bruker dem regner ut nøyaktig det samme som før. Verdier finnes bare
i mobilappen, og bare fordi `index.html` ber om å få tegne under systemfeltene
(`viewport-fit=cover`). Uten den ville appen i stedet stått med en
fremmedfarget stripe øverst og nederst.

**Regelen: alt som ligger `position: fixed` mot en viewport-kant legger sonen PÅ
sin egen avstand.** Det gjelder toppmenyen (`padding`), kontoknappen
(`top`/`right`), modal- og popover-skallet (`padding` på overlayet), board-ets
side- og bunn-padding, og de tre bunn-pillene: toasten, lagringsstatusen og
oppdateringsbanneret. Et panel som klemmes mot viewporthøyden
(`.modal`, `.switcher-panel`) tar `100%` inn i sin `max-height` — `vh` måler
hele skjermen, `100%` måler overlayets innholdsboks, altså sonen.

To ting som ser ut som avstand, men er sentrering og bredde: en flate som
**sentreres** mot viewportet må sentreres i det BRUKBARE feltet (toasten flytter
`left` et halvt inset-avvik og tar sonen inn i sin `max-width`), og en flate som
**sentreres i et overflow** må gjøre det med `margin: auto`, ikke `align-items:
center` — en boks som er høyere enn containeren blir da klippet på toppen, og
overflow mot start-kanten kan ikke rulles fram (innloggingsskjermen med
tastaturet oppe).

Det som regnes ut i JS kan ikke få sonen fra CSS, og leser den i stedet fra
`safeInsets()` i `app.js`: demonstrasjonens kort (`placeTour`), popover-skallet
på desktop (`positionSwitcherPanel`), søppelkassens sveipefelt (`openField` —
feltet utvider seg mot HØYRE og stopper ved den brukbare kanten; sveipe-strekket
regnes ut fra bredden og følger med), og de tre stedene som trenger den
BRUKBARE bunnen i stedet for viewportkanten — kolonnebudsjettet
(`docs/board-layout.md`) og dra-og-slippets to scroll-grenser
(`docs/drag-and-drop.md`). `env()` erstattes når custom-propertyen regnes ut, så de fire
løser seg til vanlige px-verdier når de leses — i motsetning til `--board-gap`,
som er en `clamp()` og derfor må leses fra en oppløst egenskap
(`docs/board-layout.md`).

**Båndet bak systemfeltene er IKKE sidens flate — det er vindusbakgrunnen fra
Android-temaet.** Dette er målt på telefon, og det er ikke det man gjetter seg
til fra koden: selv om siden tegner under statusfeltet (`viewport-fit=cover`),
følger flaten bak klokka aldri `--bg`. Den følger temaet.

Derfor er hele oppsettet bundet til ÉN kilde — **telefonens nattmodus**:

| Erklæring | Rolle |
|---|---|
| `values/styles.xml` + `values-v27/`, foreldretema `Theme.AppCompat.DayNight.NoActionBar` | Vindusbakgrunnen (og dermed båndet) blir mørk om natten. Gir også WebView-en riktig `prefers-color-scheme` — se under. |
| `values-night/` + `values-night-v27/` | Snur glyfene med båndet: `windowLightStatusBar`/`windowLightNavigationBar` er `true` om dagen, `false` om natten. |
| `SystemBars.style = "DEFAULT"` (`capacitor.config.json`) | Pluginen SETTER utseendet i runtime og overstyrer temaet. `DEFAULT` = les den samme nattmodusen, også etter rotasjon og modusbytte. |

Fordi båndet og glyfene leser samme kilde, kan de ikke komme i utakt.
**Draktvelgeren i appen rører dem ikke i det hele tatt.** Velger brukeren «Lys»
på en mørk telefon, blir båndet mørkt med lyse glyfer over en lys side: uvant,
men lesbart. Uleseligheten oppstår bare når båndet og glyfene har hver sin
kilde — som da temaet var permanent lyst mens pluginen fulgte telefonen.

`DayNight` er dessuten det som får «Følg systemet» til å virke i mobilappen i
det hele tatt: fra targetSdk 33 utleder WebView `prefers-color-scheme` av appens
eget tema (`isLightTheme`), ikke av telefonens nattmodus. Detaljene og
telefonverifiseringen: [`mork-drakt.md`](mork-drakt.md).

**Unntaket er bunnfeltet på API 24–26.** `windowLightNavigationBar` finnes
først fra API 27, og runtime-veien er en no-op før det: treknappsradens glyfer
er lyse uansett hva vi ber om. De versjonene får derfor en mørk stripe å ligge
på (`@color/systemNavScrim`) i stedet for et gjennomsiktig felt; fra API 27 er
feltet gjennomsiktig og glyfene mørke, så flaten vår når helt ned.

Voktere: `tests/safe-area.test.js` (setter sonen og måler at chromet flytter
seg, begge viewportene) og `tests/capacitor-android.test.js` (erklæringene
sonen og systemfeltenes utseende hviler på).

Skjermtastaturet hører til samme bilde: det krymper viewportet i stedet for å
legge seg oppå det, så feltet som redigeres kan bli liggende under det. Sidens
`scroll-padding-top` og resize-lytteren i `app.js` ruller det fram igjen — se
[`board-layout.md`](board-layout.md) («Topp»).

## Luft-regler (padding/margin/gap)

- **Symmetri per listepunkt**: et listepunkt skal ha samme luft på alle kanter — én
  padding-verdi, ikke ulike topp/høyre/bunn/venstre. (Full-bredde-paneler har
  symmetrisk v/h-par der siden styres av en token, f.eks. `--toolbar-pad`.)
- **Utenfor ≥ inni**: luften rundt/mellom listepunkter (margin/gap) skal alltid
  være minst like stor som paddingen inni dem — trangere inni enn utenfor
  oppleves harmonisk, det motsatte ikke. (F.eks. item-padding 6 / item-gap 8;
  chip-padding 6 / chip-gap 8; kort-seksjonspadding 10 / `--board-gap` ≥ 12.)
- **Headeren har ÉN luft-verdi** (`--topbar-gap`), og den gjelder begge
  retninger: mellom panelets rader, mellom kontrollene på en rad, mellom
  hjørneknappene og mellom hjørnegruppens rader. Panelets egen polstring over og
  under står i `--topbar-pad-y`, som hjørnegruppen leser for å flukte med den
  samme linjen. Ingen kompenserende tall per retning eller breakpoint — se
  [`menus.md`](menus.md).
- Listekortet er en flex-kolonne: `.card-head` øverst + `.card-body` (alt annet).
  `.card-body` bærer luften (`gap: 10px` mellom seksjonene + `padding: 10px 0`
  topp/bunn); seksjonene (items/skjema/listepunkt-kurv) har 10px sidepolstring →
  jevn 10px-luft langs alle kanter inne i kortet. Luften bor i body-en (ikke på
  `.card`) så en **kollaps** (body → høyde/padding 0) gir et nøyaktig header-høyt
  kort. Se listekollaps under.

## Ikoner (`.icon`, `icons.js`)

Egendefinert SVG-ikonsett, **fargelagt**: streker er SVARTE (`stroke="#111"`,
hardkodet — IKKE lenger `currentColor`) og flater fylles med hvit + palettfarger
der motivet tilsier det (kart under). viewBox 0 0 24 24, avrundede
linjer/hjørner. Alle ikoner har klassen `.icon` (`width/height: 1em` — skalerer
med `font-size` på listepunktet de limes inn i).

**ÉN PIKSEL STREK, UANSETT HVOR STORT IKONET VISES.** Hvert ikon står med
`stroke-width="1"`, og `styles.css` gir formene inni `.icon`/`.brand-logo`
`vector-effect: non-scaling-stroke` (se «ÉN PIKSEL STREK» ved `.icon` der).
Streken måles da i SKJERMPIKSLER i stedet for i 24-rutenettet, så «1» er 1 px
enten ikonet vises i 15 px (en chip i hendelseslista) eller i 60 px
(tom-tilstandene). En strek som skalerer med tegningen gir det motsatte: en
hårstrek i den ene enden av størrelsesskalaen og en tykk kontur i den andre, av
det samme settet.

Tre invarianter følger av det:

- **Skriv aldri et annet tall enn 1** i en `stroke-width` i `icons.js`,
  `index.html` eller `favicon.svg`. `tests/icon-stroke.test.js` er vakten.
- **Kompenser ikke for en `<g transform="scale(…)">`** (som `groupCategory`
  har): streken ser ikke skaleringen.
- **To streker som møtes må dele NØYAKTIG samme koordinat**, ikke ligge et
  hakk fra hverandre: én px pluss én px side om side leses som én 2 px strek.
  Bokhylla er mønsteret — se fargekartet under.

`vector-effect` arves ikke, så regelen står på etterkommerne (`.icon *`), ikke
på `<svg>`. `favicon.svg` bærer sin egen kopi i en `<style>`, fordi den også
lastes frittstående (`<link rel="icon">`) der stilarket ikke gjelder.

**Fargekart.** Fyllene er hardkodet hex, valgt PER IKONMOTIV — ikke lenger låst
til appens seks kortfarger (HSL S=20 % L=60 %, `#ad8585 #adad85 #85ad85 #85adad
#8585ad #ad85ad`). To familier av ikoner beholder likevel en delt farge, med
vilje:

- **Globus (område), Del/tre personer (delte) og logoen** bruker fortsatt
  (deler av) de seks kortfargene — de er allerede internt flerfargede motiver
  (flere felt/personer i ÉN tegning), så de lider ikke av «alt ser likt ut»-
  problemet de andre ikonene hadde, og globusen/logoen er dessuten appens mest
  gjenkjennelige merkevareelementer.
- **Kontoikonet (person/`profile`) og alt som bevisst speiler DET** — kamera-
  linsa (samme «dette handler om en person»-motiv) og hånd-opp-personen
  (`handRaise`) — beholder palettens blågrønne `#85adad`. Grunnen er at
  `--accent`/`--grad-accent` i `styles.css` («Kontrast-kontrakt») er AVLEDET av
  nettopp denne fargen (mørknet til den bærer hvit tekst) — endres den,
  mister Lagre/Inviter-knappene, bryterne og statuschipene sin forankring.

Resten av ikonene har egne, ikke-palettbundne motivfarger — valgt for å ligne
det de faktisk forestiller (manilamappe, blyant, gull-bjelle osv.) og for at
beslektede-men-ulike motiver ikke skal dele nøyaktig samme fyll. Grå (søppel/
menyprikker) er uendret, `#c0c4c9`. Ingen av fyllene inverteres mellom drakter
(kun `#ffffff`/`#c0c4c9`/`#111` snur):

| Ikon | Fyll |
|---|---|
| Globus (område) | de seks globusfeltene = palettfarge 1–6 |
| Del (share) / tre personer (delte) | stor/senter-person farge 1, de to andre farge 2 og 3 |
| Søppelkasse (trash/trashSwipe) | kroppen grå |
| Mappe (`folder`, og mappa nedskalert inn i `groupCategory`) | varm manila-tan `#c9a06a` |
| Liste | hvit flate, svarte punkter/linjer |
| Listepunkt (item) | hvit plate, svart punkt + linje — samme motiv som lista, én rad i stedet for tre |
| Notat (`note`) | hvitt ark med brettet hjørne — samme hvite flate som lista, men motivet er et DOKUMENT |
| Notatbok (`noteFolder`) | rød perm `#c15c56` med de hvite sidene stikkende fram til høyre |
| Bokhylle (`noteProject`) | treplaten og de to brakettene under den i eik `#b07d4a` (egen tone, bevisst ulik mappens manila-tan); nøyaktig tre bokrygger oppå, i rødt `#c15c56`, blått `#6fa8e0` og gult `#e8bd3e`. Bøkene fyller ~75 % av platens bredde og **deler kantene sine**: bok 1/2 møtes på x=9.8, bok 2/3 på x=14.3, bøkenes bunn ER platens overkant og brakettenes overkant ER platens underkant — samme koordinat på begge sider, aldri to streker ved siden av hverandre. Ryggene tegnes som ÉN kontur pluss to skillestreker, så hver delte kant finnes bare én gang |
| Arkiv (`archive`, notatenes arkiv) | lokket mappens manila-tan `#c9a06a`, kroppen hvit — ingen NY motivfarge: den skal kjennes igjen som beslektet med mappa, og skille seg fra søppelkassen ved siden av |
| Kobling (`link`, Lister ↔ Notater) | ingen fyllflate — to ledd i strek, som «Flytt» |
| Forstørrelsesglass (søk) | linsen klar «søkeblå» `#6fa8e0`, skaftet kun strek |
| Varseltrekant (alert) | trekanten hvit, utropstegnet svart |
| Start/påbegynt (play) | urskive hvit, trekanten svart — bevisst IKKE en hake |
| Øye (vis) | hornhinne hvit, pupill svart |
| Person (mine) | hode + kropp palettens blågrønne `#85adad` (se «Kontrast-kontrakt» over) |
| Klode (språkvelgeren) | ensfarget blågrønn-teal `#4a94a3` — egen tone fra kontoikonet og globusen, bevisst ulik begge |
| Brev (e-postvarsel) | hvit |
| Objektmeny (menuDots) | tre grå prikker med svart kontur |
| Blyant (endre navn) | skaftet skarp blyantgul `#e8bd3e` |
| Flytt (moveArrows) | ingen fyllflate — kun svarte streker |
| Oppløs (bubbleBurst) | ingen fyllflate — kun svarte streker |
| Dør inn (login) | dørfeltet hvitt |
| Hengelås | låst = klart rødt `#c15c56`, åpen = klart grønt `#5da172` |
| Kalender (alle: starttid, frist, «Kommende hendelser», toppkontrollen) | hovedflaten hvit + det øverste feltet over topplinja terrakotta-rødt `#c96b45` — `.icon-pin-light` (styles.css) holder papiret hvitt i BEGGE drakter; streken er svart i lys og hvit i mørk drakt (smelter sammen med papiret der), se `mork-drakt.md` |
| Klokke | flate hvit |
| Bjelle (varsler: toppkontrollen og varselmodalens tittel) | klokkeflaten messing-gull `#c99a3f`; kolv og kant kun strek |
| Sol/måne (draktknappen) | sol-oransje `#f0a83a` / himmelblå `#9db3d9` — to egne toner, ikke lenger samme farge |
| Hånd-opp (ansvarlig) | person palettens blågrønne `#85adad` (samme som kontoikonet, se over) |
| Lyspære (introduksjon, konto-modalen, idéknappen) | pæra bleik glødegul `#f0d772`, sokkelen kun streker |
| Enheter (kontomodalens «Enheter og økter») | skjermen slate-blå `#7a90ab`, telefonen varm grå-tan `#a8967a` |

Unntak som beholder `currentColor` (rene glyfer på massive fargeknapper):
`.btn-glyph` (dør-ut på «Logg ut» og «Forlat», søppelkasse på «Slett konto» og
«Slett … for alle») og avkryssings-haken (`.item-check`). Søppelkasse-glyfen
finnes i to eksemplarer med SAMME tegning: inline i `index.html` for «Slett
konto» (statisk markup) og som `ICONS.trashGlyph` for del-modalens knapp (bygget
i JS). Endrer du motivet, endre BEGGE — som for logoen. Merk at glyfen er en
annen tegning enn `ICONS.trash`: søppelkasse-KNAPPENE har en grå fyllflate,
glyfen har ingen fyll, bare streker i `currentColor`.
＋-ikonet og kategori-knappens ikon (`.add-cat-btn`) er IKKE unntak — begge er
svarte (`#111`) som resten av settet, også på de fargede knappene.

**Kryss-ikonet** (`ICONS.xmark`, samt inline i `index.html`): lukkeknappenes ✕
er en egen SVG med samme 1 px-strek og runde ender som resten av settet,
`stroke="currentColor"` så CSS styrer farge; de arver `.icon-btn`-fargen
(`--ink-soft`). Objektene har ikke lenger noe ✕ — sletting ligger i
objektmenyen (`docs/menus.md`).

- **Statiske forekomster** (panel-title-ikoner, søppelkasse-knapper,
  del-knapper, logo/brand-mark) limes rett inn som `<svg>`-markup i
  `index.html` — ingen build-steg, så det er enklest å holde dem der de brukes.
- **Dynamiske forekomster** (objektmenyknappen og alle radene i menyen,
  delt/låst-merker, lås-knappen i del-modalen, auth-heading-ikonet,
  sveipefelt-søppelkassen, søppelkassene i kortene, antall-pillene,
  tom-tilstander) bygges fra `window.ICONS` (`icons.js`, lastet før `app.js`)
  via `el.innerHTML = ICONS.xxx`.
- Dra-håndtakene er fjernet: draging inviteres ved trykk-og-hold på et objekts
  navn-/tittelsone (dnd-kits `handleSelector`, se `docs/drag-and-drop.md`).
  Under holdet får det objektet som skal løftes et lite «press» (`.drag-hold`,
  scale).
- **Logo (`favicon.svg` + brand-mark på innloggingsskjermen)**: tre stablede
  lister — samme motiv som `list`-ikonet, men tegnet som tre avrundede kort
  forskjøvet nedover/til høyre; kun det fremste kortet har de tre listepunktene
  (prikk + strek). Logoen er fargelagt: **svarte** streker/prikker, og de tre
  kortene fylles med palettfarge **3/2/1** (bakerst→fremst — det fremste kortet
  har farge 1), slik at det fremste kortet dekker strekene på kortene bak →
  «papirbunke»-effekt. Samme 1 px-strek som resten av settet — den skalerer
  ikke, så listepunktene overlever både i en 16px favicon og i den 52px store
  `.brand-mark`. Logoen finnes tre steder (samme motiv):
  `favicon.svg` (frittstående fil, siden `<link rel="icon">` ikke kan peke på en
  JS-streng), inline i `.brand-mark` (`index.html`) — de to med samme markup —
  og i Android-skallet som appikon og splash-bilde, der den er UTLEDET av
  `favicon.svg` og ikke tegnet på nytt (`docs/mobilapp-plan.md`, «Appikonet og
  splash-bildet»). Endrer du motivet/fargene, oppdater alle tre: de to første
  for hånd, den tredje ved å generere rasterfilene og vektoren om.
- `--icon-stroke` (token, 1px): linjetykkelsen for CSS-tegnede (ikke-SVG)
  streker som skal matche ikonsettets strek — brukt av sveipefeltets pil
  (`.swipe-arrow::before`/`::after`), som tidligere hadde en hardkodet, tykkere
  strek (2.5px). Tallet er nå den samme konstanten som ikonene har, ikke et
  anslag på hvor tykk en skalert strek blir.

## Fargede knapper: `.btn-solid` + `.btn-green`/`.btn-accent`/`.btn-red`/`.btn-yellow`

ÉN felles stil for alle fargede knapper — aldri egne ad hoc-gradienter.
Fargeverdiene er en kontrastkontrakt og er håndhevet av
`tests/a11y-contrast.test.js` — se `docs/tilgjengelighet.md` før du endrer en av
dem.

**Fargen følger av HVA SOM LIGGER OPPÅ FLATEN**, ikke av hvor positiv handlingen
er. Det er derfor det finnes både en grønn og en blågrønn:

| Klasse | Flate | Bærer | Brukes av |
|---|---|---|---|
| `.btn-green` | lys grønn | **svart ikon**, aldri tekst | ＋-knappene (ny liste/mappe/område/listepunkt/kategori) |
| `.btn-accent` | blågrønn | **hvit tekst** | Lagre, Inviter, Godta, Gjenopprett, Neste, Logg inn, Bruk bildet, Plasser |
| `.btn-red` | rød | hvit tekst | tøm-knappen, Forlat deling, Kast ut, Slett … for alle, Slett konto |
| `.btn-yellow` | gul | **mørk tekst** | lås-knappene i del-modalen, og **Logg ut** |

- `.btn-solid`: hvit skrift m/ `--text-shadow`, `--shadow-sm`, og felles
  hover-feedback: flaten **lysner litt** (`filter: brightness(1.09)`) og
  skyggen løftes — tydelig, men ikke dramatisk fargeendring.
- **Lysretning: alle fire gradientene er loddrette (`180deg`) med den lyseste
  enden ØVERST.** Skyggene i appen er forskjøvet nedover — lyset kommer skrått
  ovenfra — og en flate som lysner nedover ville lyssatt seg motsatt av sin
  egen skygge. Loddrett legger dessuten hele fargespranget over knappens
  korteste akse, så gradienten leses like tydelig på en bred tekstknapp som på
  en kvadratisk ＋. Samme retning gjelder alle andre flate-gradienter
  (avatarene, auth-bakgrunnen); de eneste vannrette (`90deg`) er sveipefeltenes
  fyll, som følger fingeren og ikke er lyssetting.
  `tests/a11y-contrast.test.js` håndhever både retningen og at den lyseste
  enden står først.
- **`.btn-green` skal aldri få tekst.** Grønnfargen er LYS med vilje, fordi det
  eneste som ligger på den er et svart ikon (6.96:1 mot den lyse enden). En
  grønn mørk nok til hvit tekst presset ikonkontrasten ned mot 3:1-gulvet — og
  på en ikon-bare knapp ER ikonet hele knappen. Trenger du en grønn knapp med
  tekst, er svaret `.btn-accent`. Runtime-testen håndhever det.
- **`.btn-accent`** er kontoikonets egen blågrønne (`#85adad`), mørknet til den
  bærer hvit tekst (4.84:1). Samme farge brukes av alt annet som har en hvit
  glyf på seg: bryterne, avkryssings-fyllet, avatarene, glidebryter-håndtakene
  og `.meta-chip.is-started`.
- **`.btn-yellow`** bærer **mørk** tekst (`--ink`) uten tekst-skygge. En gul
  flate som gir 4.5:1 mot hvit tekst er ikke gul lenger, den er oliven — så
  knappen beholder fargen og bytter teksten i stedet.
- **`.btn-red`** med tekst innledes med en glyf der handlingen er endelig:
  «Slett konto» og «Slett … for alle» bruker begge søppelkasse-glyfen
  (`.btn-glyph` / `ICONS.trashGlyph`), «Forlat» dør-ut-glyfen. Formen sier hva
  som skjer før etiketten er lest.

Størrelse/form kommer fra egne klasser: `.btn` (modaler), `.btn-small`,
`.btn-add` (knapperadene, + `.icon-only` for kvadratisk ＋), `.switch`.
`.btn-ghost` er den nøytrale hvite varianten (Avslå, Trekk tilbake, Lukk).

## Delte klasser — gjenbruk før du lager nye

- `.panel-head` + `.panel-title` + `.panel-actions`: overskrift («ALLE
  OMRÅDER»/«INVITASJONER» osv., uppercase via CSS) på egen linje + knapperad
  under. Brukes i område-/mappe-/konto-modalen og toppmenyens
  listefunksjoner.
- `.crumb-btn`: navigasjonsknappen i toppmenyen — ÉN knapp med begge nivåene
  (bare navn, uten ikoner, på flate-mønsteret; `.crumb-name` med ellipsis);
  `.crumb-sep` er ›-skilletegnet mellom dem. Notatfanen har sin egen
  (`#notes-crumb`, `[bokhylle] › [notatbok]`) med nøyaktig den samme klassen.
- `.main-tabs` + `.main-tab`: hovedbryteren `Lister ↔ Notater` — `.seg` (under)
  i header-størrelse, sentrert på panelets FØRSTE rad (`.topbar-row-tabs`), i
  hele bredden. Hjørnegruppen skyves ned under den (`--main-tabs-h`, målt i
  `syncTopChrome`), så bryteren ligger alene øverst. Semantisk er den fortsatt
  en `tablist` med to `tab`-er (`docs/tilgjengelighet.md`). `.topbar-row` er
  den aktive fanens egen rad.
- `.note-card`: notatkortet ER et listekort — samme `.card`-flate, samme
  `.card-head` (notatikon + tittel til venstre, «sist endret» som `.meta-chip`
  til høyre) og samme posisjonsbaserte palettfarge fra `paintCardColor`.
  Utdraget står i «…» på en `--plate` i kortkroppen, klippet til tre linjer av
  `-webkit-line-clamp` på en INDRE node (`.note-card-excerpt-text`) — `overflow`
  klipper ved padding-boksen, så en klipping på platen selv ville latt den
  fjerde linjen stå synlig i bunnpolstringen. Hele kortet er klikkflate og
  dra-sone, så det har pekehånd og `:focus-visible`-ring.
- `.seg` + `.seg-btn`: den GENERELLE segmenterte bryteren — hovedbryteren
  (`.main-tabs`) og søkets scopevelger (`Alt | Lister | Notater`) er den samme
  kontrollen i to størrelser. Den er en EKTE bryter: markeringen er ÉN flate
  som GLIR mellom segmentene (`::before` på beholderen), ikke en bakgrunn som
  tones inn på det ene og ut på det andre — da ville den lest som to knapper
  som blinker. Flaten flyttes med `transform` i den samme timingen som knotten
  i konto-modalens av/på-brytere (`--switch-motion`), og reduced-motion slår
  bevegelsen av.

  Segmentene er LIKE BREDE (`display: inline-grid` + `grid-auto-columns: 1fr`),
  og det er dét som gjør reisen til ren regning: flaten er `100% / --seg-n` bred
  og står `--seg-i * 100%` inn. De to tallene settes fra JS (`paintSeg`), som
  også setter `aria-selected` og den rullende `tabIndex`-en — ett sted for
  begge bryterne, så en tredje fane ville virket uten en ny utregning. (Grid og
  ikke flex: med `flex: 1 1 0` blir beholderen bare like bred som innholdet, og
  `min-width: auto` klemmer det lengste segmentet ut av takt.)

  Den aktive flaten er den grønne ＋-knappens (`--grad-green`). Den bærer derfor
  SVARTE ikoner og MØRKT blekk, som `.btn-solid` pinner dem — samme
  kontrakt, samme tokens, i begge drakter. Trenger noe annet et to- eller
  tredelt valg, er det denne som gjenbrukes — ikke en ny knapperad.
- `.trashcan`: ALLE søppelkasse-knapper — hvit avrundet beholder, antall i grå
  sirkel (`.trashcan-count`), **skjult (`hidden`) når tom**. ARKIVET
  ([`notater-plan.md`](notater-plan.md)) er den SAMME knappen med arkivikonet:
  ingen egen knappestil for en knapp som gjør det samme et annet sted.
- `.link-row` + `.link-open` + `.link-remove`: raden i koblingsmodalen —
  `[typeikon] navn + kontekststi` med en ✕ til høyre. Den er bygget som
  søkeresultatraden (navnet i sin helhet, aldri kappet med ellipsis; stien
  dempet under), fordi det er nøyaktig samme oppgave: kjenne igjen ETT objekt
  blant flere med samme navn. Et mål som ikke lenger er tilgjengelig får
  `.is-gone` og en avskrudd knapp — raden skal kunne ses og fjernes, ikke
  forsvinne.
- `.corner-controls` + `.corner-btn`: toppkontrollgruppen i øvre høyre hjørne
  (varsler, kalender, søk, drakt, konto). ÉN fast flex-gruppe med
  flate-mønsteret på hver knapp;
  en ny knapp legges FØRST i gruppen og trenger ingen egen posisjonsregel.
  Bredden gruppen legger beslag på måles i JS (`--corner-btns-w`) — se
  `docs/menus.md` («Toppkontrollene»).
  Variantene: `.notif-btn` (bjelle + `.menu-badge` som ulest-teller, åpner
  varselmodalen, `docs/varsler.md`), `.events-btn` (åpner «Kommende hendelser»,
  `docs/kommende-hendelser.md`), `.search-btn` (åpner søkemodalen,
  `docs/sok-og-navigering.md`),
  `.theme-toggle-btn` (sol-/måneikon for aktiv drakt, `docs/mork-drakt.md`) og
  `.account-btn` (person-ikon + `.menu-badge` som invitasjons-teller).
  Innloggingsskjermens draktknapp bruker den samme `.corner-btn`-flaten inline
  i språkraden.
- `.search-modal` (+ `.search-body`/`-results`/`-result`/`-note`):
  søkemodalen — feltet står i ro og resultatlisten ruller. Den aktive raden
  bæres av kant, flate OG en pilspiss, aldri av farge alene. Se
  `docs/sok-og-navigering.md`.
- `.nav-flash`: den kortvarige markeringen av objektet man nettopp navigerte
  til. Innvendig `box-shadow` i `--focus` — kortene har `overflow: hidden`, og
  fokusringen eier `outline` på det samme elementet. Se
  `docs/sok-og-navigering.md`.
- `.events-body` (+ `-section`/`-group`/`-group-head`/`-list`), `.event-row`
  (+ `-icon`/`-main`/`-meta`/`-when`/`-rel`/`-date`) og `.event-icon`: modalen
  «Kommende hendelser». Arbeidsdelingen: `.event-icon` i gruppens overskrift
  bærer STATUS (farget plate), `.event-row-icon` i raden bærer OBJEKTTYPEN
  (uten flate). Statusflatene er de SAMME seks som `.meta-chip` bruker under
  navnet — `is-over`/`is-soon`/`is-later` for frister, `is-started`/
  `is-startsoon`/`is-startlater` for starter — fordi det er de samme seks
  bøttene (`docs/scheduling.md`); startene låner ikke varselfargene. `.event-icon`
  pinner `--icon-ink`/`--icon-paper` for seg selv, som `.btn-solid` gjør, siden
  platen er den samme i begge drakter; `.event-row-icon` har ingen plate, følger
  drakten og kaster en liten `drop-shadow`. `.events-group + .events-group`
  legger skillelinjen mellom to grupper. Se `docs/kommende-hendelser.md`.
- `.notif-body` (+ `-list`/`-item`/`-line`/`-empty`/`-settings`), `.notif-row`
  (+ `-main`/`-name`/`-dot`/`-meta`/`-when`) og `.notif-snooze-btn`/
  `-snooze-row`: varselmodalen. Radens statusikon er `.event-icon` med gruppens
  tone — GJENBRUKT, ikke kopiert: et varsel om en utløpt frist skal se ut som
  gruppen «Frist utløpt» gjør, og arver dermed pinningen og kontrastkontrakten.
  Ulest bæres av både kant/flate (`is-unread`) og en prikk, aldri av farge
  alene. `.modal-head-actions` holder tannhjulet og lukkeknappen sammen i enden
  av modalhodet. Se `docs/varsler.md`.
- `.account-form` (+ `-label`/`-row`) og `.account-msg`: endre navn/e-post i
  konto-modalen (etikett over felt, Lagre-knapp på samme rad). «Bilde»-seksjonen
  bruker den samme klassen uten å være et `<form>` — mønsteret er etikett over
  innhold, ikke skjemaet.
- `.menu-acc` (+ `-group`/`-head`/`-icon`/`-label`/`-chev`/`-sub`/`-body`):
  trekkspillet i konto-modalen — overskriftsknapp med roterende vinkel og en
  skuff som animerer på høyde. Kun ÉN skuff åpen om gangen, lukkede skuffer er
  `inert`. Objektmenyen har sin egen form på det samme (`.obj-menu-group`), men
  de deler animasjonen (`slideSub`). Se `docs/menus.md`.
- `.lang-select`: språkvelgeren, en `.field`-basert `<select>` (Norsk/English).
  Den finnes to steder med samme klasse — som kontroll i en `.menu-setting`-rad
  i konto-modalen, og i `.auth-lang` nederst på innloggingsskjermen. En
  `<select>` og ikke to knapper: den er tastatur- og skjermlestertilgjengelig
  uten en linje ekstra kode, og den vokser når det kommer et tredje språk. Se
  `sprak.md`.
- `.nav-board`: nav-modalens board (områdekort + mapperader). Alltid ÉN
  kolonne; ellers arves `.card`/`.item`/`.category` uendret fra listedesignet.
  Aktivt område / aktiv mappe = ring i `--focus` trukket innover
  (`outline-offset: -2px`) + `aria-current` — ringen var brand-grønn, men grønt
  ligger på 1,5–2,3:1 mot de seks kortfargene og var altså usynlig nettopp der
  den skulle si hvor man står (`docs/tilgjengelighet.md`). Fokusringen har samme
  farge, men ligger UTENFOR kanten, så de to kan stå samtidig uten å smelte
  sammen. `.uni-count` er en liten, subtil **pill med
  mappe-ikon + antall mapper** som erstatter «(N)» på et kollapset område.
- **Objektmenyknappen (`.obj-menu-btn`) er den ENESTE knappen til høyre på et
  objekt** — på alle seks nivåene. Den erstattet tannhjulet, ✕, del-, forlat- og
  oppløs-knappene, og arver flaten til den kontrollen den avløste: `.card-cog`
  på korthoder, `.item-cog` på rader, `.cat-cog` på kategorioverskrifter. Ingen
  ny knappestil. Innholdet i menyen er autoritativt beskrevet i
  `docs/menus.md`.
- Delt-merket (`.share-badge`) er en ren INDIKATOR på alle nivåer (span,
  `aria-hidden`) — ikke lenger en knapp på listekortet.
- **Type-ikon foran navnet i nav-modalen**: områdekortet og mapperaden
  innleder med `[type-ikon]([delt-ikon])Navn` — `.kind-icon` (globus/mappe),
  så `.share-badge` når objektet er delt, så navnet. Breadcrumben i toppmenyen
  viser derimot bare navnene, uten ikoner.
  Delte områdekort får derfor IKKE den lyse innerkanten delte listekort har
  (`.nav-board .card.is-shared` nullstiller box-shadow-ringen): `.card-body` er
  gjennomsiktig, så ringen lyste gjennom nederst og leste som en ramme rundt
  mappelista.
- **Tastatur i nav-modalen**: områdekortets `.card-head` og mapperaden er
  `role="button" tabindex="0"` (`:focus-visible` = `--focus`, lagt utenfor
  kanten). De er de eneste veiene inn til navigering uten peker; hodet har i
  tillegg `aria-expanded`. Se `docs/menus.md` for hva Enter/Mellomrom gjør på
  hvert nivå, og `docs/tilgjengelighet.md` for Alt-snarveiene som ligger på de
  samme elementene. Listevisningens `.card-head`/`.cat-head` har nå det samme
  oppsettet, så kollaps og flytting er like tilgjengelige der.
- Checkboxes i modaler: rendres alltid som en pille-formet toggle-switch, ren
  CSS på selve `<input type="checkbox">` (`appearance: none` + `::before`-
  håndtak, ingen ekstra DOM/JS). Av = grå spor, på = `--grad-green` (samme
  grønn som `.btn-green`). Delt regel på tvers av `.time-lock input` (tidslås)
  og `.share-policy-label input` (invitasjonspolicy) i `styles.css`.
- Draging (ingen håndtak): på et objekts navn-/tittelsone (`handleSelector`). På
  **touch** løftes det med trykk-og-hold (200 ms; press-scale `.drag-hold`); på
  **mus/desktop** starter draget umiddelbart på bevegelse (ingen delay). **Cursor:**
  listepunkt-/kategori-dra-sonene får `cursor: grab` (åpen hånd), mens område/
  mappe/liste bruker `cursor: pointer` (pekende hånd — klikk er primærhandlingen).
  Se `docs/drag-and-drop.md` for soner/unntak og mekanikk.
- Placeholders: samme uttrykk enten hullet er dnd-kits klone
  (`[data-dnd-placeholder]`) eller vår egen ny-liste-slot
  (`.card-placeholder`) — se `docs/drag-and-drop.md`. Ingen kant (kun mørknet
  flate + innover-skygge).
- `.add-item-row`: de to «legg til»-knappene nederst i en liste, **midtstilt**
  (`justify-content: center`). Det er ingen navne-input her — objektet opprettes
  tomt og navngis på plassen sin (se «Opprettelse …» under).
- `.add-item-btn` (grønn ＋) og `.add-cat-btn` (gul, kategori-ikon):
  ＋ oppretter et listepunkt, kategori-knappen en kategori — begge umiddelbart,
  begge alltid trykkbare (ingen disabled-tilstand).
  Kategori-knappens ikon er `ICONS.category`-tegningen limt inn direkte i
  `index.html` med `stroke/fill="#111"` — svart som resten av ikonsettet, også
  på den gule flaten (ikke lenger et `currentColor`-unntak). Begge de
  kvadratiske icon-only-knappene (listepunkt-＋ og kategori) bærer store,
  tydelige ikoner: `.btn-add.icon-only .icon` settes til **34px** for begge, så
  ＋-en er like stor som kategori-ikonet (kategori-motivet — klammer/prikker/
  linjer — trenger størrelsen for å lese tydelig, og ＋-en matcher det).
- **Delt ＋-ikon** (`ICONS.plus`, samt inline-kopier i `index.html`): ALLE
  «legg til»-knappene (listepunkt/liste/mappe/område) bruker nå samme SVG-tegnede
  ＋ (to rette streker, 1 px, runde ender, `stroke="#111"` —
  svart også på de fargede knappene) i stedet for tekst-glyfen ＋ — som har
  annen linjestil/tykkelse enn resten av ikonsettet og dermed brøt den ellers
  konsekvente streken. De tekst+ikon-
  knappene (liste/mappe/område) beholder `.btn-add .icon`-størrelsen (19px);
  kun de kvadratiske icon-only-knappene skaleres opp til 34px (se over).
- **Kategorier** (`.category` / `.cat-head` / `.cat-title` / `.cat-cog` /
  `.cat-items`): en nivå-1-rad med en header (tittel/meta + objektmenyknapp)
  over en nøstet elementliste. Overskriftslinjen (unntatt menyknappen) er
  trykk-og-hold-sonen for kategori-draging. Kondensert:
  samme 8px-luft som mellom listepunkter, både over overskriften og mellom
  overskriften og listepunktene (`.category` gap 8px; `.cat-items` uten vertikal
  padding). `.cat-title` er **hvit m/ tekst-skygge** (som `.card-title`) —
  lesbar på enhver listefarge. `.cat-cog` bruker den **hvite flate-knappestilen
  fra `.card-cog`** (svakt hvit flate + ring, lysner ved hover) så menyknappen
  er synlig mot den fargede listeflaten. Å løse opp kategorien
  (boble-sprekk-ikonet `ICONS.bubbleBurst`) er menyens siste rad — og den ENESTE
  veien: en kategori slettes ikke, og har derfor ingen søppelkasse å dras i.
  `.cat-head`s 6px sidepolstring stiller tittel/knapper i **samme kolonner** som
  elementenes (som har 6px boks-padding) og kort-hodets — hele lista leser som
  felles kolonner. **«Hylle i veggen»-metafor:** overskriften står på veggen
  (listeflaten), og `.cat-items` er en **fordypning** rett under (4px gap) — litt
  mørkere flate (`rgba(0,0,0,.1)`) + innover-skygge (`inset box-shadow`) + stort
  venstre-innrykk, så listepunktene blir som «bøker» i en hylle som går inn i veggen
  (dette erstattet den tidligere grupperingsstreken). Den LØFTEDE kategorien
  (`.dnd-surface .category[data-dnd-dragging]`) er et hvitt chip med hylla foldet
  sammen (se `docs/drag-and-drop.md`) som skal lese som en **kompakt rad,
  ikke et felt**: kategori-ikonet (`.cat-drag-icon`, skjult i hvile) vises til
  venstre for tittelen, tittelen blir **svart uten skygge** (hvit-på-hvit var
  uleselig mot den hvite flaten), menyknappen skjules (`display:none`) og
  skillelinjene (`::before`/`::after`) males ikke på det løftede kortet. Polstring/
  radius = et listepunkt (6px / 10px) + `gap:0` → **samme høyde som et listepunkt
  under DnD**. Subtile skillelinjer
  (`rgba(0,0,0,.15)`) rammer en kategori mot nabo-radene på nivå 1: **under**
  kategorien (`.category:not(:last-child)::after`) mot det påfølgende listepunktet/
  kategorien — men **ikke** når kategorien er siste rad (`:not(:last-child)`
  følger DOM-rekkefølgen, item OG category som søsken); og **over** kategorien
  (`.item + .category::before`) KUN når raden over er et listepunkt. To kategorier
  på rad får dermed ingen ekstra linje mellom seg utover ::after-en fra den
  øverste. Linjene går **kant-til-kant** (negativ sidemargin `-10px` kansellerer
  `.items-container`s 10px sidepolstring) med **lik luft over og under (16px)**
  hver — margin-verdiene (`::after` 12/8, `::before` 8/12) er ulike fordi de
  kompenserer for forskjellige omkringliggende flex-gap (`.category`s 4px
  topp/bunn vs. `.items-container`s 8px mellom rader), men summerer til samme
  16px på begge sider. **Under DnD** overtar JS linjene i containerne draget
  berører, så man ser hvordan de BLIR ved slipp — `.seps-managed` slår av
  pseudo-reglene over, og hver rad som skal ha en linje over seg får `.sep-above`
  (25px margin-top + en absolutt posisjonert linje 16px over raden = nøyaktig
  samme geometri som i hvile) — eller, når raden UNDER linja er forfar til det
  løftede objektet, males den speilvendt fra raden over (`.sep-below`, se
  `docs/drag-and-drop.md`). Se `docs/drag-and-drop.md`. **Kollaps + ＋-knapp:** en kategori kan **kollapses** som en
  rullgardin (klikk på overskriftslinjen, ikke tittel/meny/meta) —
  `.cat-items` (og `.cat-add`) foldes MOMENTANT (`collapseCatBody`/`expandCatBody`,
  som listekollapsen). Nederst i kategorien sitter en **grønn ＋-knapp** (`.cat-add` /
  `.cat-add-btn`, `.btn-add.btn-green.icon-only`, midtstilt) som legger til et nytt
  (tomt, straks-fokusert) listepunkt direkte i kategorien; skjules når kategorien er
  kollapset.
- **Opprettelse av listepunkter og kategorier — «lag først, navngi på plassen»**:
  det finnes ikke lenger et navnefelt man skriver i før man trykker. Alle tre
  ＋-inngangene (`.add-item-btn`, `.add-cat-btn`, `.cat-add-btn`) legger objektet
  inn MED ÉN GANG, tomt, og åpner navneredigereren på det (blank, fokusert) —
  samme mønster overalt. Avsluttes navngivingen uten tekst (Enter på tomt felt,
  Escape, eller klikk ut), **fjernes det nyopprettede objektet igjen**; et navnløst
  listepunkt er ingenting verdt og skal ikke bli liggende. Alt ligger i
  `nameNewRow()` (app.js), som også tar gravsteinen. Merk: klikk på en dra-sone
  (f.eks. et korthode) `preventDefault`-er pointerdown og flytter derfor ikke
  fokus — da blir navneredigereren stående åpen i stedet, som ved all annen
  inline-redigering.
- **Tittel-redigering ved klikk — kun der den ikke kolliderer**: listepunkter
  (`.item-text`) og kategorier (`.cat-title`, både i en liste og i et område)
  omdøpes fortsatt ved å klikke rett på navnet; raske navnebytter er viktigst
  nettopp der. **Områder, mapper og lister gjør det IKKE lenger**: der
  navigerer eller kollapser et klikk på navnet, og omdøping ligger i
  objektmenyen (og på F2). Signalene er de samme som før der klikk-omdøping
  finnes: klikkflaten følger teksten (`align-self: flex-start`) og en
  **hover-effekt** mørkner bakgrunnen bak tittelen (`background:
  rgba(0,0,0,.12)`).
  Alle tittel-elementene bærer en `__rename`-hook (`setRenameHook`/`startRename`
  i app.js), slik at menyen, F2 og de programmatiske veiene (ny liste, nytt
  område, ny container etter et drag) åpner den SAMME navneredigereren.
- **Flerlinjet redigering — kun der teksten faktisk er lang**: listepunkter og
  idéer redigeres i et `<textarea>` som vokser med innholdet
  (`editText(..., { multiline: true })` → `.edit-input-multi`); alle andre navn
  beholder enlinjefeltet. Grunnen er lesbarhet, ikke pynt: et listepunkt bryter
  gjerne over flere linjer i hvile, og et enlinjes felt rullet resten ut av syne
  nettopp når man skulle lese den. Feltet arver IKKE skriftstørrelsen fra raden
  (`.item-text` har sin egen brødtekst) — `editText` leser `font-size` og
  `line-height` av elementet som byttes ut FØR det tas ut av dokumentet, så
  feltet bryter på samme ord og raden ikke hopper i høyden. Teksten er fortsatt
  én linje som DATA: Enter avslutter redigeringen, bryting er visuell.
- **Listekollaps (rullgardin)**: klikk på korthodet (`.card-head`, ikke på
  menyknappen/meta-chip — tittelen kollapser også) folder `.card-body` sammen MOMENTANT (ingen
  animasjon — `collapseCardBody`/`expandCardBody` setter/fjerner bare høyde/opacity/
  padding; en animasjon gjorde systemet tregere uten å tilføre klarhet). Kortet blir
  da nøyaktig header-høyt, og kortets
  `overflow: hidden` + `border-radius` runder alle fire hjørnene — også nederst på
  headeren. `overflow` settes KUN inline mens/når kollapset (et permanent
  `overflow:hidden` ville klippet et løftet listepunkt under draging). Lukke-
  tilstanden (`card.collapsed`) lagres i DB (`docs/data-model.md`), og alle lister
  kollapser midlertidig mens en liste dras (`docs/drag-and-drop.md`). En **kollapset
  liste/kategori viser antall listepunkter «(N)»** til høyre for navnet (`.title-line`
  omslutter tittel + `.collapse-count`; telleren vises kun kollapset,
  `setCollapseCount`). Liste: alle aktive leaf-elementer, kategorier ikke medregnet
  (`cardLeafCount`). Kategori: dens synlige medlemmer (`catMemberCount`). Telleren har
  mindre skrift enn tittelen og står på SAMME skriftlinje via `.title-line`s
  `align-items: baseline` — derfor må verken `.card-title` eller `.cat-title` sette
  `align-self` (det koblet ut baseline-justeringen og la dem topp-justert, så «(N)»
  leste som hevet skrift). Bredden på klikkflaten følger fortsatt teksten: titlene er
  flex-elementer i `.title-line`.
- **Kollapset kategori = nøyaktig overskriftslinjen**: `.cat-items` har høyde 0 når
  kategorien er kollapset, men lå fortsatt som en flex-rad mellom to av `.category`s
  4px-gap — luften under overskriften ble 4px større enn over (tydeligst rundt
  knappene og mot skillelinjene).
  `.category.collapsed:not([data-dnd-dragging]) > .cat-items` har derfor
  `margin-top: -4px`, som spiser det ene gapet: lik luft (16px) til skillelinja
  over og under, slik en kollapset liste er nøyaktig header-høy. Det LØFTEDE
  objektet er utelatt fordi det allerede har `gap: 0`.
- **Ny-liste-placeholder** (`.new-list-placeholder`, kategori-/listepunkt-
  ekstrahering, `docs/drag-and-drop.md`): en kort-formet slot med et hvitt **＋-ikon**
  i midten (stiplet-hvit inset-ring over den delte placeholder-flaten) som
  signaliserer at slipp oppretter en NY liste.
- `.field`: felles tekstfelt (auth-input + inviter-input) — solid kant, myk
  bakgrunn, grønn fokus-ring. Nye felt trenger bare klassen `.field`.
- `.pass-wrap` + `.pass-toggle`: passordfelt med «vis passordet»-knapp. Øyet
  (`.icon-btn`, dempet i hvile) ligger INNI feltet ved høyre kant; feltet får
  plass med `padding-right`. Ett nytt passordfelt trenger bare wrapperen +
  knappen med `data-pass-toggle="<felt-id>"` — app.js kobler alle ved oppstart.
- `.account-avatar` / `.member-avatar` / `.resp-avatar`: felles avatar-form
  (rund, sentrert hvit initial på gradient/palettfarge); størrelse/farge per
  bruk. Initialene kommer fra `display_name` (`initialsFromName`). Har personen
  et **profilbilde**, fyller et `<img>` (`object-fit: cover`) sirkelen i stedet
  — samme delte regel for alle tre. Konto-avataren er i tillegg selv en KNAPP
  (kamera-merke `.avatar-cam` nederst til høyre) som velger nytt bilde. Se
  `docs/accounts.md`.
- **Bilderedigereren** (`.avatar-modal`/`.avatar-stage`/`.avatar-mask`/
  `.avatar-slider`): scenen er kvadratisk (`aspect-ratio: 1/1`) og er nøyaktig
  det utsnittet som lagres; `.avatar-mask` er en sirkel med en enorm
  `box-shadow`-spredning som demper ALT utenfor + en hårfin hvit innerring — så
  man ser både hva som blir bildet og hvordan det vil se ut i appen.
  Glidebryterne er stilt manuelt (`appearance: none`, nøytralt spor + grønt
  `--grad-green`-håndtak) i stedet for native kontroller, som de eneste
  `input[type=range]` i appen.
- `.item-cog` / `.card-cog` / `.cat-cog`: de tre flatene objektmenyknappen
  (`.obj-menu-btn`) bruker — dempet ikon på en rad, flate-knapp i et korthode
  eller på en kategorioverskrift. `.obj-menu-panel` + `.obj-menu-row` +
  `.obj-menu-sub`: selve menyen (popover/ark + rader + trekkspill-skuffer), se
  `docs/menus.md`. `.trashcan.drag-trash` + `.to-trash`: søppelkassen som
  drop-mål mens et drag pågår (`docs/trash.md`).
  `.meta-row` + `.meta-chip`: indikator-chipene under navnet (delt/ansvarlig/
  start/frist). Seks statustoner via `--grad-*`, de samme bøttene og flatene som
  «Kommende hendelser» — men en grovere lesning: modalens to ytterste grupper
  deler chipens tone (`docs/scheduling.md`); `paintTimeChip` males på nytt av
  seg selv når en grense passeres, uten en rendring. `.is-conflict` legger på en
  stiplet kant i chipens EGEN tekstfarge når fristen bryter invarianten, mens
  glyfen og teksten bærer meningen. `.resp-avatar` / `.resp-row`:
  ansvarlig-sirkler og velger-rader; sirkelfargen settes inline fra paletten
  (`colorForIndex`, personens alfabetiske plass i delegruppen). Se
  `docs/scheduling.md` og `docs/accounts.md`.
- `.item-check`: avkryssingsboks på listepunkter — rund-firkantet boks, grønt
  hake-fyll (`.item.done`) + gjennomstreket tekst + lavere bakgrunn. Avkryssede
  listepunkter flyttes med FLIP til en egen **«Utført»-seksjon** (`.items-done`,
  skilt med `.done-divider`) nederst i kortet; `done` er datamodell (se
  `docs/data-model.md`). Avkryssede rader kan ikke dras (`canDrag` gater på `done`).
- `.done-restore`: ⟲-knappen helt til HØYRE på «Utført»-linja (`ICONS.restoreArrow`
  — sirkel med et 93°-gap som retter seg ut i en tangent og ender i en pilspiss
  mot klokka) som reaktiverer ALLE utførte listepunkter i lista på én gang
  (`restoreAllDone`, én felles FLIP). Den deler flate-knappen på listeflaten med
  kategoriens menyknapp (`.cat-cog, .done-restore`
  — ett felles regelsett, så de ikke kan gli fra hverandre): svakt hvit flate +
  ring som lysner ved hover, 36×36. Ikonet har svart strek (#111) i seg selv, som
  resten av ikonsettet — knappen bruker IKKE `.icon-btn` (den setter
  `color: var(--ink-soft)` senere i fila og vant over et lokalt `color: #111`,
  som gjorde ikonet blekt). Skillelinja er divider-ens `::after` og ligger derfor
  sist i flex-rekkefølgen, så knappen får `order: 1` for å havne etter den, og
  `margin-right: 6px` (listepunktenes egen polstring) stiller den i samme kolonne
  som radenes menyknapp. Skjult i en frosset liste, som avmerkingsboksene er
  deaktiverte der.
- Ingen lasteindikatorer/spinnere: operasjoner utføres optimistisk og
  serialiseres i en bakgrunnskø (se `docs/accounts.md`) — UI-et venter aldri
  synlig på at noe skal lande. (Den gamle `.spinner`-klassen er fjernet.)
- Liste-ikonet (`ICONS.list`): de tre «linjene» er nå **fylte bullets** (små
  sirkler, `r=0.7`, `fill=currentColor`) for tydeligere separasjon.
- Antall-piller (`.chip-count`) og tellere (`.trashcan-count`) samt varsel-
  badgen (`.menu-badge`) holdes **bevisst separate** — de deler visuelt uttrykk
  (avrundet, tabular-nums) men har ulike roller; å tvinge dem inn i én `.pill`
  ville vært prematur abstraksjon.

## Seksjoner i nav-modalen (`.nav-section-head`)

De tre seksjonene («Mine områder», «Områder delt med meg», «Mapper delt med
meg») får hver en overskriftsrad med to ikoner foran navnet
(`[ressursikon][kontekstikon]`) og en skillelinje over (`border-top`, ikke for
den første). Tom seksjon får en dempet `.nav-section-empty`-linje i stedet for
kort. «＋ Nytt område» (`.nav-add-uni`) står nederst i seksjon 1 og bare der.
Den virtuelle beholderen for frie mapper (`.free-groups-card`) har en nøytral
grå kortfarge og ingen del-/slett-/＋-kontroller. Se `docs/menus.md`.

## Del-modalen: én visning, capability-gatede kontroller

Del-modalen har ikke lenger et eier/mottaker-skille. Medlemslisten vises for
alle med tilgang, gruppert etter rollekategori med `.share-section-title`;
`.member-hint` forklarer hvorfor en rad ikke kan fjernes her. Rollevelgeren ved
siden av e-postfeltet (`.share-role-select`) vises kun for den som kan invitere
eiere. «Forlat» og «Slett for alle» ligger sammen i `.share-actions` — begge kan
være aktuelle samtidig. Begge innledes med en glyf, som «Logg ut» og «Slett
konto» i konto-modalen: «Forlat» bruker dør-ut-ikonet (`ICONS.logout`), «Slett
… for alle» søppelkassen (`ICONS.trashGlyph`). Hver har sitt eget `aria-label`,
så skjermlesere aldri forveksler dem — og de fire endelige/reversible
handlingene i appen får samme form uansett hvilken modal de står i.

## Notat-editoren (`.note-editor`)

Et eget fullskjermsbilde OVER hele appflaten — også over toppkontrollene, som er
`z-index: 35`; editoren er 60, og `body.note-editing` skjuler gruppen så den
ikke ligger oppå verktøylinjen. Den sikre sonen legges på editorens egne kanter
(baren og kroppen), ikke på barna.

Editoren festes til det SYNLIGE feltet — `top: var(--viewport-top)` og
`height: var(--viewport-h)`, målt av `visualViewport` — ikke til
layoutviewporten. Mobiltastaturet krymper det ene uten å røre det andre, og med
`100dvh` ville verktøylinjen glidd ut over toppkanten. Verdiene har CSS-hvile
(`100dvh`/`0px`), så en nettleser uten `visualViewport` får riktig oppførsel
likevel.

ARKET er papiret (`.note-sheet`, `--surface` med `--line`-kant og
`--shadow-sm`), ikke hele flaten: editorbakgrunnen er board-flaten (`--bg`).
Brødteksten er `--ink` på arket, og det paret er det som er målt i begge
draktene (`docs/tilgjengelighet.md`). Notatets tittel ligger OVER arket, med
notatikonet foran seg, i hvit skrift med skygge som alt annet på board-flaten —
den er notatets NAVN, ikke dokumentets første overskrift. Verktøylinjen står på
`--surface-2` med en `--line`-kant under.

- Linjen er delt i tre: `.note-back` (Huskis' vanlige `.btn`-flate, ikke
  verktøyenes) alene til venstre, `.note-tools` sentrert i midten, og
  `.note-editor-aside` til høyre med lagringsstatusen, idéknappen og
  draktknappen — de to siste er hjørnegruppens knapper, i editorens egen linje.
- `.note-tools` BRYTER over flere linjer når den ikke får plass. Den ruller
  aldri vannrett: et verktøy man må lete etter er et verktøy man ikke bruker.
  På telefon i portrett får den hele bredden på sin egen rad.
- `.note-tool` er en flat ikon-/tegnknapp; `.is-on` (+ `aria-pressed`) viser at
  markeringen står i den tilstanden. `.note-tool-sep` er den tynne
  gruppeskilleren. `.note-tool-h1/-h2/-h3` er tre ulike skriftstørrelser, så
  knappene VISER rangordenen dokumentets egne overskrifter har.
- `.note-panel` (lenke og spesialtegn) er `position: fixed` og FORANKRES under
  knappen sin av `placeNotePanel()`, som klemmer panelet innenfor det synlige
  feltet og snur det over knappen når det ikke er plass under.
- `.note-doc` er `white-space: pre-wrap` — linjeskift inne i en blokk bæres som
  et tegn i dokumentmodellen. `.note-link` er MERKET tekst med adressen i
  `data-url`, ikke et anker (`docs/domains-and-urls.md`).
- OVERSKRIFTSHIERARKIET VISES SOM INNRYKK: en overskrift eier innholdet fram til
  neste overskrift på samme eller høyere nivå, og hvert nøstede nivå rykkes ett
  `--note-indent` inn (litt mindre på telefon). Nivået er en AVLEDET VISNING —
  `noteApplyIndent()` regner det ut av blokkrekkefølgen og skriver `data-lvl`;
  dokumentmodellen lagrer det ikke.

## Flate-mønsteret

Hvile = halvgjennomsiktig hvit (`--control-bg`), hover = helt ugjennomsiktig
hvit. Gjelder søppelkasser, breadcrumb-knappene, kontoknappen og
draktknappen.

## `[hidden]`-regelen

`[hidden]` har en global `display:none !important`-regel i styles.css — den MÅ
beholdes. Uten den ville klasse-display som `.trashcan`s `inline-flex`
overstyre `hidden`-attributtet, og tomme søppelkasser ville vises likevel.

## Delelinjer i modaler

Delelinjer (f.eks. skillene i område-/mappe-/konto-modalen) skal se ut som
`.modal-head`s `border-bottom` — kant-til-kant, IKKE en innrykket `<hr>` med
vanlig margin (den ville stoppe ved `.modal-body`s side-padding og se kortere
ut enn linja over). Bruk `border-bottom: 1px solid var(--line)` + negativ
side-margin som kansellerer den omsluttende paddingen.

## UX-prinsipper (samme mønster på alle nivåer)

- Klikk = bytt/aktivér. Omdøping ligger i objektmenyen på område/mappe/liste
  (der klikket allerede navigerer eller kollapser) og på selve navnet for
  listepunkter og kategorier — se `docs/menus.md`.
- Slett = `trashed`-flagg → søppelkasse. To veier inn, likt på alle nivåer:
  objektmenyens «Slett»-rad, og **å dra objektet i kassen** — kassen vises fram
  så snart et drag starter (`docs/trash.md`). Søppelkassene er ellers skjult når
  de er tomme; kort trykk = modal (gjenopprett/tøm), klikk-og-hold = sveipefelt
  for tømming.
  Sletting animeres («pakk sammen og fly i søpla», se `docs/trash.md`) så
  brukeren ser hvor objektet havnet. Destruktivt er alltid reversibelt frem
  til tømming (gravstein først da) — derfor ingen bekreftelses-dialog på selve
  slettingen, og heller ikke på tøm-knappen i modalen (sveipe-tømming har
  heller ingen).
- Nytt objekt (område/mappe/liste) aktiveres og går rett i navneredigering.
- Escape lukker øverste modal — men avbryter kun inline-redigering hvis en pågår.
- Del-modalens overskrift er alltid «[objekttype-ikon] [navn] — Innstillinger
  for deling» (gir mening for både eier og mottaker).
- **Bekreftelse**: bruk `askConfirm({title, message, okLabel, danger})` (Promise
  → boolean, app-stilt `#confirm-modal`), ALDRI native `confirm()`. `danger`
  (standard) gir rød OK; `danger:false` grønn. Stables øverst blant modalene.
- **Sveip for å bekrefte** (`.confirm-swipe`): når en handling verken kan angres
  eller gjenopprettes, er bekreftelsen en GEST i stedet for en OK-knapp.
  Foreløpig én bruk: «Slett konto» (`docs/accounts.md`). Feltet gjenbruker
  søppelkassenes sveipe-formspråk — `ICONS.trashSwipe` som roterer 0→180°,
  `.swipe-label`, `.swipe-arrow` og en `--p`-drevet fylling — men i faresonens
  farger (`--danger-soft`/`--danger-soft-hover`) og som et fast felt i modalen,
  ikke en knapp som vokser ut. Sveipet måles fra der fingeren gikk NED (et trykk
  i høyre ende er ikke en bekreftelse), og `role="slider"` + piltastene gir
  tastaturbrukere den samme friksjonen.
- **Angre**: destruktive handlinger som kan angres viser en toast med «Angre»-
  knapp: `showToast(msg, { label, fn })`. Slettinger bruker dette (5 s) sammen
  med fly-i-søpla-animasjonen; gjenopprett-logikken deles med søppel-modalen
  (`restoreUniverse/Group/Card/Item`).
- **Toast** (`.toast`, `showToast`/`hideToast`): halvgjennomsiktig mørk flate
  (`rgba(45,38,70,0.62)`) med `backdrop-filter: blur(14px) saturate(1.3)` og en
  hårfin lys kant — innholdet under skinner gjennom, hvit tekst holder seg
  lesbar. Toasten er `pointer-events: none` i hvile (klikk-gjennom) og `auto`
  mens den vises, slik at hele flaten kan **sveipes til høyre for å lukke den
  med en gang** (`attachToastSwipe`): kun høyre-retning (venstre står stille),
  overveiende vertikal bevegelse gir gesten til siden så den ruller nativt
  (`touch-action: pan-y`), og forbi terskelen (30 % av bredden, minst 56 px)
  kastes toasten ut (`.toast-swipe-out`). Et fullført sveip svelger klikket
  etterpå, så et drag som startet oppå «Angre» ikke også trykker «Angre».
  `opts.onDismiss` lar kalleren gjøre ferdig arbeidet timeren ellers ville gjort
  — slette-toasten committer slettingen (se `docs/trash.md`).
  Teksten brekker over flere linjer i stedet for å kappes: beskjeden sier hva
  som skjedde med brukerens innhold, og en toast som stopper på «Lagt i
  søppelkassen: «Ukens gjø…» har mistet nettopp det den skulle si. Bredden er
  `width: max-content` opp til `max-width`, ellers ville `left: 50%` holdt den
  igjen i en halvbred søyle på mobil. Teksten er kappet til **fire linjer**
  (`-webkit-line-clamp`): den inneholder brukerens egne navn, og uten tak kunne
  toasten vokst opp over lagringsstatusen og skjult den.
- **Kontekstuelt tips** (`.toast-tip`): samme toast, bare litt bredere å brekke
  innenfor — et tips er en setning, ikke en kvittering på tre ord. Toasten er
  dessuten et `role="status"`-live-område, så både tips og kvitteringer når
  skjermlesere. Semantikken (når et tips vises, og alt det aldri skal
  fortrenge) er `docs/introduksjon.md`.
- **Varsel-toast** (`.notif-toast`, `showNotifToast`): et NYTT VARSEL som dukker
  opp mens appen står åpen springer ut fra bjelleknappen, ikke opp fra bunnen —
  den hører til knappen, ikke til noe brukeren nettopp gjorde. Formen er en
  pille som den vanlige toasten og gesten er den samme (`attachToastSwipe`, med
  `opts` fordi stabelen er høyrestilt og ikke har noen sentrering å legge draget
  inn i), men flaten er varseltypens EGEN farge — halvgjennomsiktig med blur, og
  med tekstfargen pinnet per tone. Semantikken (hva som er «dukket opp», hvor
  mange som vises, og hvorfor historikken ikke toaster) er `docs/varsler.md`.
- **Toast eller status?** En toast er en HENDELSE som nettopp skjedde og som
  det er greit å gå glipp av. En TILSTAND som varer — og som brukeren må kunne
  finne igjen etterpå — hører hjemme i lagringsstatusen (under), aldri i en
  toast. Et langvarig problem som melder seg som gjentatte toaster er en feil.
- **Lagringsstatus** (`.sync-status`, `#sync-status`): én diskret, vedvarende
  pille fast nede til venstre som forteller hva som faktisk har skjedd med
  endringene — «Lagret», «Lagrer …», «Frakoblet – endringene lagres på denne
  enheten», «Noen endringer kunne ikke lagres på kontoen din.» eller
  «Endringene lagres ikke på denne enheten.» med en «Prøv igjen»-knapp.
  Semantikken (hva som utløser hvilken tilstand) er `docs/accounts.md`.
  Formspråket er flate-mønsteret (`--control-bg` + blur), ikke toastens mørke
  flate: statusen er bakgrunnsinformasjon, ikke en melding som krever
  oppmerksomhet. Prikken følger **trafikklyset** — grønn (`--primary-dark`) ved
  «Lagret», gul (`--warn`) ved «Lagrer …», rød (`--danger`) ved avvisning og grå
  (`--ink-soft`) ved «Frakoblet», altså «lyset er av»: vi når ikke serveren og
  vet derfor ikke. Teksten sier det samme i klartekst. Grønnfargen er
  `--primary-dark` og ikke `--primary`, fordi pilleflaten er halvgjennomsiktig
  hvit over board-bakgrunnen og den lyse `--primary` faller under 3:1 mot den;
  `tests/a11y-contrast.test.js` håndhever alle fire. Pillen er
  `pointer-events: none` slik at den aldri kommer i veien for board-et — kun
  «Prøv igjen» tar imot klikk. **I ro er pillen usynlig**: «Lagret» fader helt
  ut ett sekund etter at den kom (`QUIET_AFTER_MS` → `.is-quiet` →
  `opacity: 0`), og fader inn igjen ved neste aktivitet. En status som alltid
  står der er visuell støy, og for den som ikke vet hva den er, en gåte —
  kvitteringen skal rekke å bli sett, ikke bli stående og bli lest. Det gjelder
  KUN «Lagret» — «Lagrer …», «Frakoblet» og en avvisning står uendret til de er
  over, så et uløst problem aldri kan forveksles med «ingenting vist». Elementet blir liggende i DOM-en
  hele tiden (bare gjennomsiktig), så fade-in ikke trenger en ny node.
  `role="status"` + `aria-live="polite"` melder hver tilstandsendring, og DOM-en
  røres kun når tilstanden faktisk endrer seg (ellers ville hjerteslaget lest
  opp det samme hvert sekund). Teknisk informasjon (tabell, feilkode) vises aldri
  her — den ligger i konsollen og i `__huskis.syncStatus.snapshot()`.

## Demonstrasjonen: tooltip-kortet (`.tour`)

Demoen for nye brukere har sitt eget lag (`.tour`, z-index 295 — over
lagringsstatusen, under toasten og oppdateringsbanneret). Laget er
`pointer-events: none`: brukeren skal se og bruke HELE appen mens demoen står
på, så det finnes verken mørklegging, uskarphet eller ring rundt kontrollen —
bare `#tour-arrow`, en pilspiss (et kvadrat rotert 45°) som peker på den. Bare
kortet tar imot pekeren.

**Velkomsten er unntaket** (`.tour.narrated`): midtstilt, med både mørklegging
og `backdrop-filter` på flaten bak. Der er det ingenting å peke på ennå.

`.tour-card` er den vanlige hvite modalflaten (radius 20, `--shadow-lg`,
`pop-in`) med `.hint-chip`-ene i den mørke varianten, som i nav-modalen. Den
ruller innvendig når JS kapper høyden (smal skjerm, ingen plass ved siden av
målet). Framdriften er en stolpe (`.tour-progress`), ikke «Steg n av m».

`body.tour-demo` demper kontrollene som ikke er i bruk, med `:not(.tour-live)`
som hele forskjellen: `.tour-live` står på kontrollen steget handler om. Det er
ren affordanse — selve avgrensningen håndheves i JS. Se `docs/introduksjon.md`.

## Bevegelse og tilgjengelighet

Autoritativt for kontrast, navn, tastatur og fokus: `docs/tilgjengelighet.md`.
Det korte som gjelder når du lager en ny kontroll:

- `prefersReducedMotion()` (app.js) hopper over fly-/FLIP-/drop-animasjonene, og
  et `@media (prefers-reduced-motion: reduce)`-blokk nøytraliserer CSS-
  transisjoner/animasjoner. Respekter dette i nye animasjoner.
- Ingen `user-scalable=no` (brukere skal kunne zoome).
- **Berøringsflate**: ikonknappene TEGNES 34–36px (kompakt UI), men et
  gjennomsiktig `::after` gir dem 44×44 å treffe på (`--touch`). Utvidelsen er
  halve luften til naboen, så flatene møtes uten å overlappe — derfor har
  kontrollradene (`.item`, `.card-head`, `.cat-head`) `gap: 8px`. En ny
  ikonknapp må inn i selektorlista i `styles.css` og ha 8px til naboen. Målene
  og fraværet av overlapp er låst i `tests/a11y-runtime.test.js`. Detaljer og
  unntak: `docs/tilgjengelighet.md`.
- **Fokusring**: `outline: var(--focus-w) solid var(--focus)` på lyse flater,
  `var(--focus-on-dark)` på de mørke (toast, oppdateringsbanner). Aldri en egen
  farge — en brand-grønn eller hvit ring forsvinner mot halve paletten.
- **Ikonknapper**: alltid `aria-label`, og navnet skal inneholde objektets navn
  (`quoted(navn)`), ikke bare handlingen. `title` er musehjelp i tillegg, aldri
  i stedet.
- **Nye rader/kort**: koble `attachKeyHandle` på det SAMME elementet som er
  dra-sone, så det som kan dras også kan flyttes med tastatur.
- **Nye modaler**: ingenting å gjøre — fokusfellen kobles automatisk på alt som
  har klassen `.modal-overlay` eller `.switcher-overlay`.
- **Skjult uten `hidden`** (en sammenslått trekkspillskuff: høyde 0 +
  `overflow: hidden`) må ha attributtet `inert`. Elementene i den har fortsatt
  en `offsetParent`, så uten `inert` tabber man rett inn i felter ingen ser.
  `focusablesIn()` filtrerer på `[hidden], [inert]`.
- `.visually-hidden` er den eneste riktige måten å skjule noe som fortsatt skal
  leses opp (`#a11y-live`). `hidden`/`display:none` tar elementet ut av
  tilgjengelighetstreet.

## Fargesystem (HSL, posisjonsbasert) + filter

Se `docs/colors-and-labels.md`.
