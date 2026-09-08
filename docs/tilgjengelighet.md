# Tilgjengelighet

Les denne når oppgaven berører farger, fokus, tastatur, skjermlesere eller
navnene på kontroller. Autoritativ for tilgjengelighetskravene; det visuelle
uttrykket ellers ligger i `design-system.md`.

Målet er **WCAG 2.2 nivå AA**. Kravene under er ikke råd — de er håndhevet av
tester, og der en test ikke rekker, av en manuell sjekkliste.

## Grunnregelen: peker først, tastatur likestilt

Dra-og-slipp er fortsatt den **primære hurtigmekanismen**. Ingenting i dette
dokumentet skal gjøre den vanlige arbeidsflyten tregere:

- Ingen synlige tekstetiketter ved ikonene. Navnet ligger i `aria-label`, som
  koster null piksler. Etiketter ved hvert ikon ville gjort listevisningen mer
  overfylt og tregere å lese for alle andre.
- Hyppige handlinger krever ikke menyen. Sortering er ett tastetrykk
  (`Alt`+pil), omdøping er `F2`, og flytting til en NY forelder er `Alt`+`M` —
  som åpner den samme velgeren draget allerede åpner. Alt dette finnes OGSÅ i
  objektmenyen (`docs/menus.md`), men ingen er nødt til å gå den veien.
- Sletting har to veier, og begge er tastaturuavhengige krav oppfylt: menyens
  «Slett»-rad (tastatur) og et slipp i søppelkassen (peker). Ingen funksjon
  finnes KUN som en gest (WCAG 2.5.1 «Pointer Gestures»).
- Ingen nye kontroller i board-et. Tastaturhåndtaket er nøyaktig den sonen
  musen drar i, så det finnes ingen ekstra knapp å hoppe over.

## Kontrast (`tests/a11y-contrast.test.js`)

Fargetokenene i `styles.css` er en **kontrakt**, ikke smaksvalg. Testen leser
tokenene ut av fila og regner ratioene på nytt, så en endret farge fanges med
én gang.

**Kravet følger av hva som ligger OPPÅ flaten**, ikke av hvor viktig knappen er:

| Krav | Verdi |
|---|---|
| Svart ikon på `.btn-green` | ≥ 3:1 mot **begge** gradient-endene |
| Hvit tekst på `.btn-accent` / `.btn-red` | ≥ 4.5:1 mot **begge** gradient-endene |
| `.btn-yellow` | bærer **mørk** tekst (`--ink`), ikke hvit — se under |
| `--danger` / `--warn` / `--accent` / `--ink-soft` som tekst på hvit | ≥ 4.5:1 |
| `--primary` (kun ikon-/kantfarge) på hvit | ≥ 3:1 |
| `--focus` mot enhver flate ringen kan havne på | ≥ 3:1 |
| `--focus-on-dark` mot toast/oppdateringsbanner | ≥ 3:1 |
| Teksten på en varsel-toast (`docs/varsler.md`) | ≥ 4.5:1 mot flaten **over både hvit og svart bakgrunn** — flaten er halvgjennomsiktig, så den er ikke en kjent verdi |
| Ikonstreken `#111` mot enhver flate | ≥ 3:1 |

**Hvorfor det finnes to grønnaktige farger.** ＋-knappene har ingen tekst — de er
et svart ikon på en flate, og da er det IKONET som må leses. En grønn mørk nok
til hvit tekst presser det svarte ikonet ned mot 3:1-gulvet; en lys grønn gir
det 6.96:1. Grønt er derfor reservert til ikonflate og bærer aldri tekst, mens
alt som har hvit tekst eller en hvit glyf ligger på den blågrønne `--accent` —
kontoikonets egen farge, mørknet til 4.84:1. De to skiller altså to ROLLER, ikke
to smaksvalg. Runtime-testen håndhever grensen: ingen synlig `.btn-green` får ha
tekst.

**Hvorfor gult har mørk tekst.** En gul flate som gir 4.5:1 mot hvit tekst er
ikke gul lenger — den er oliven (`#936e18`). Valget står mellom å miste fargen
eller å bytte tekstfarge; appen beholder gulfargen og setter teksten til
`--ink`. `text-shadow` slås av samtidig: skyggen finnes for å løfte hvit skrift
fra en lys flate, og under mørk tekst gjør den bare bokstavene uskarpe.

**Hvorfor fokusringen ikke er brand-grønn.** Den grønne ringen lå på 1,2:1 mot
board-bakgrunnen og mot de grønne palettfargene — altså usynlig nettopp der den
trengtes. `--focus` (`#10131a`) klarer ≥ 3:1 mot alt: hvit, board-bakgrunnen,
alle seks palettfarger og alle tre knappefarger. De hvite ringene på
korthodene falt gjennom på tre av seks kortfarger og er borte.

Testen vokter i tillegg at **ingen** `:focus-visible`-regel maler ringen i noe
annet enn `--focus`/`--focus-on-dark`, og at de pensjonerte fargeverdiene ikke
finnes noe sted i kildetreet.

### Den mørke drakten har samme kontrakt

Kravene over gjelder uendret i mørk drakt — det er FLATENE som er andre, og
tokenene som snur (se [`mork-drakt.md`](mork-drakt.md)). Samme test regner ut
den mørke halvdelen fra `:root[data-theme="dark"]` og fra L-settene i `app.js`:

| Krav | Verdi |
|---|---|
| `--ink` / `--ink-soft` / `--danger-ink` / `--primary-ink` / `--note-ink` som tekst på de mørke flatene | ≥ 4.5:1 |
| `--focus` (nå **hvit**) mot board-bakgrunnen, panelflatene og alle 36 mørke palettfarger | ≥ 3:1 |
| `--icon-ink` (nå lys) mot de samme flatene | ≥ 3:1 |
| `--ink` på listepunkt-platen, `--ink-soft` på meta-chipen — begge over hver mørke kortfarge | ≥ 4.5:1 |
| Trafikklyset mot den mørke statuspillen | ≥ 3:1 |
| `--check-hover` (avkryssingsboksens hover-kant) mot platen over hver mørk kortfarge | ≥ 3:1 |
| `--scrim` (drag-placeholderen) | **paritet** — se under |

**Paritet der 3:1 aldri har vært mulig.** Drag-placeholderen tegnes rett på
board-bakgrunnen, og hverken lys eller mørk drakt når 3:1 der (den lyse bunner
ut på 1,22:1). Det er en flate som kommer sammen med andre signaler. Testen
krever derfor at den mørke drakten ikke er **dårligere** enn den lyse — ikke et
absolutt tall den lyse drakten selv aldri har holdt.

**Hvorfor fokusringen snur.** `--focus` (`#10131a`) er valgt for å lese mot alle
LYSE flater; mot den mørke board-bakgrunnen gir den 1,0:1. Hvit gir ≥ 4,0:1 mot
alle 36 mørke palettfarger. Ringen ligger alltid UTENFOR kanten på de fargede
knappene (`outline-offset` ≥ 0), altså på flaten bak dem — knappegradientene er
uendret i mørk drakt, og en hvit ring PÅ den lyse grønnen ville vært ulovlig.
Testen låser begge halvdelene: at den lyse ringen er usynlig i mørk drakt, og at
`.btn-solid` pinner ikonstreken og `--ink` tilbake til de lyse verdiene så
ikonene og den gule knappens tekst blir stående mørke.

## Navn på kontroller

Alle ikonknapper har `aria-label`. `title` settes ved siden av som musehjelp,
men teller aldri alene: den leses ikke av alle skjermlesere, og på touch finnes
den ikke.

Navnet er **presist** — det inneholder objektets navn, ikke bare handlingen.
«Meny» tjue ganger på rad forteller ingenting; «Meny for listepunktet
«Kjøp melk»» gjør det. Det samme gjelder selve menypanelet, som får
`aria-label` med objektets navn når den åpnes. Navnene settes i `label*Controls()` i hver `build*`-
funksjon (`app.js`) og settes **på nytt etter omdøping**, så de aldri blir
stående på gammel tekst.

## Språk

`<html lang>` følger språkvalget (`i18n.js` → `applyHtmlLang()`): en
skjermleser skal lese engelsk tekst med engelsk uttale, ikke norsk. Alle navn
på kontroller — `aria-label`, `title`, `placeholder` og opplesningene i
`announce()` — kommer fra den samme ordboken som resten av UI-et, så et
språkbytte treffer dem også. Se `sprak.md`.

Det gjelder også opplesningene UNDER et drag i nav-modalen, som dnd-kit sier
fram i sitt eget live-område: motoren snakker fra `phrases`, en ordbok vi gir
den, og hver setning bygges av `tr()` (`dnd.a11y*`). Biblioteket har engelske
standardsetninger, og ingen av dem når brukeren. Se
[`drag-and-drop.md`](drag-and-drop.md).

## Tastatur

Håndtaket er objektets navn-/tittelsone — det samme elementet draget tar tak i,
koblet med `attachKeyHandle`. Nav-modalens board bygges med `keyboard: false`:
dnd-kits egen tastatursensor ville kjempet om `Enter`/`Mellomrom`, som på et
korthode og en mapperad allerede betyr noe annet. Snarveiene under er
WCAG-alternativet til draget på ALLE nivåer, uansett hvilken motor som drar. Snarveiene virker på det som har fokus, og står
oppført i konto-modalens Tips-skuff (`.menu-keys`, se `docs/menus.md`).

| Tast | Virkning |
|---|---|
| `Alt` + `↑` / `↓` (og `←` / `→`) | flytt objektet ett hakk — **sortering** |
| `Alt` + `M` | «Flytt til …» — ny forelder (for en idé: hvilken idékategori, [`ideer.md`](ideer.md)) |
| `F2` | endre navn — på ALLE nivåer (klikk på navnet omdøper nå bare listepunkter, idéer og kategorier) |
| `Enter` / `Mellomrom` | på et korthode: kollaps/utvid. På en mapperad: naviger. På et listepunkt eller en idé: endre navn. **På et notatkort: åpne editoren** |
| `Escape` | lukk øverste modal — eller avbryt en navneendring. **I notat-editoren: lukk et åpent panel, ellers gå tilbake** |

**Hovedbryteren er en `tablist`.** `Lister ↔ Notater` er tegnet som ÉN
segmentert kontroll, men semantikken er uendret og følger WAI-ARIA-mønsteret:
`role="tablist"`/`role="tab"` med `aria-selected`, `aria-controls` mot hver sin
`role="tabpanel"`, venstre/høyre piltast bytter, og bare den aktive halvdelen er
i tabbrekkefølgen (`tabindex="-1"` på den andre) — så Tab går VIDERE til
innholdet i stedet for mellom to knapper.

**Notatene har de samme snarveiene som alt annet.** `Alt`+pil flytter et
notatkort, en notatbok eller en bokhylle ett hakk (`canReorderObj` svarer
alltid ja der: notatene er kontoens egne, det finnes ingen lås å spørre om).
Bokhyllehodet er et trekkspill som områdekortets: `Enter`/`Mellomrom` åpner og
lukker den, og `aria-expanded` sier hvilken tilstand den står i. Raden «Frie
notater» er en vanlig `role="button"`-rad som fører til bokhyllens egen plass.

Alle tre notatnivåene har den samme objektmenyen som resten av appen — samme
knapp, samme `role="menu"` og samme piltaster — så «Arkiver», «Koblinger» og
«Slett» nås uten en eneste ny gest. Notat-kassene og -arkivene er vanlige
knapper med et navn som TELLER («3 slettede notater»), ikke bare et tall, og de
er skjult når de er tomme: en knapp som ikke gjør noe skal heller ikke stå i
tabbrekkefølgen. Koblingsmodalen er en vanlig modal med to lister av knapper —
en kobling til et mål som ikke er tilgjengelig er en AVSKRUDD knapp med en
forklaring, ikke en rad som forsvinner.
Notatkortets håndtak er hele kortet — det er også dra-sonen — og `Enter`/
`Mellomrom` åpner editoren, så `F2` er ikke bundet der: tittelen redigeres i
editoren.

**I editoren** flytter Tab som vanlig mellom tilbakeknapp, verktøylinje,
idé-/draktknappen, tittel og skrivefeltet. Verktøylinjen BRYTER over flere
linjer i stedet for å rulle vannrett, så hvert verktøy er synlig og treffbart
uten å måtte letes fram — også på telefon. Overskriftsknappene har tre ulike
skriftstørrelser, så rangordenen er synlig og ikke bare navngitt. Verktøyknappene tar ALDRI markeringen fra dokumentet
(`mousedown` er avvist, og den siste markeringen i dokumentet legges tilbake før
hver kommando), så `Cmd/Ctrl`+`B`/`I`/`U`/`K` og knappene gjør nøyaktig det
samme. `Cmd/Ctrl`+`Z` angrer, `Cmd/Ctrl`+`Shift`+`Z` (og `Ctrl`+`Y`) gjør om
igjen. Lagringsstatusen er et `role="status"` med `aria-live="polite"`, så
«Lagrer …»/«Lagret» leses opp uten å avbryte.

**Sortering = bytt plass.** `Alt`+pil bytter objektet med naboen, som er
nøyaktig dra-motorens egen semantikk («≥ 20 % overlapp bytter plass»,
`drag-and-drop.md`). Et listepunkt som passerer en kategorigrense havner derfor
INNE i kategorien, og medlemmet det passerte havner utenfor — de bytter faktisk
plass. Posisjonen skrives med samme regel som ved et slipp: objekter med
`_canon` (områder og frie mapper) har personlig rekkefølge og går via
`cloudPersonalPos`, alt annet stemples i synk-doc'et.

**Rettigheter gates likt som draget.** `canReorderObj` speiler `canDrag` på hvert
nivå, og feiler LUKKET: mangler capability-en, skjer ingenting og brukeren får
beskjed i live-området.

`Alt`+`M` sjekkes på `ev.code === 'KeyM'`, ikke `ev.key` — på macOS gir `Alt`+`M`
tegnet «µ».

## Lister man velger i (søkeresultatene)

Søkemodalens felt er en **combobox over en listbox**: `role="combobox"` +
`aria-controls`/`aria-expanded` på feltet, `role="listbox"` på lista,
`role="option"` + `aria-selected` på radene, og `aria-activedescendant` på
feltet som peker på det aktive treffet. Da flytter piltastene valget uten at
fokus forlater feltet — man kan skrive videre uten å tabbe tilbake, og
skjermleseren sier fram raden av seg selv.

To ting som er lette å glemme i et slikt mønster, og som gjelder alle framtidige
valglister: **antallet treff** må leses opp et sted (et visuelt skjult
`role="status"`), og **den aktive raden kan ikke bæres av farge alene** — i
søket bærer ikonet typen visuelt og den aktive raden har en pilspiss ved siden
av kanten og flaten. Typen er likevel ikke borte for skjermleseren: den ligger
i et `.visually-hidden`-spenn i raden, siden ikonet er `aria-hidden`.

**Scopevelgeren over lista er en `tablist`**, akkurat som hovedbryteren:
`role="tablist"`/`role="tab"` med `aria-selected`, venstre/høyre piltast bytter,
og bare den aktive knappen er i tabbrekkefølgen. Den aktive halvdelen bæres av
flate og skriftvekt, ikke av farge alene. Autoritativt for resten av søket:
`sok-og-navigering.md`.

## Lister man bare trykker i (hendelsesradene)

Modalen «Kommende hendelser» har ingen combobox — radene er vanlige knapper, så
Tab og Enter virker uten særbehandling. Til gjengjeld gjelder de to samme
kravene som over: **antallet** leses opp fra et visuelt skjult `role="status"`,
og **statusfargen kan ikke bære gruppen alene** — hver gruppe har overskrift i
klartekst, glyfene skiller gruppene (varseltrekant, kalender, klokke, start), og
en skillelinje mellom dem er en form, ikke en farge. Start-ikonet er bevisst
ikke en hake: det ville lest som «utført».

Radens objekttype er BARE et ikon visuelt, og må derfor stå i klartekst i
`aria-label` — det gjør den, sammen med navn, tidspunkt og sti.

Ikonene i modalen står på fargede plater som er de samme i begge drakter, og
modalen pinner derfor ikonstreken og «papiret» for hele subtreet. Kravet til
gruppeflatene er at MINST ÉN av de to (den mørke streken eller det lyse
papiret) når 3:1 mot flaten — på de lyse flatene er det streken, på de mørke
papiret. De åtte gruppene deler syv flater: de to som ligger lenger ute enn en
måned har samme nøytrale tone, og skilles av overskrift, ikon og seksjon.
Vokter: `tests/a11y-contrast.test.js`, som også krever at hver tone HAR en
kontraktsflate. Autoritativt for resten: `kommende-hendelser.md`.

**Varselmodalen arver hele dette avsnittet.** Radene der er også vanlige
knapper, statusflatene er de samme `.event-icon`-tonene, og de samme to kravene
gjelder: antallet (og hvor mange som er uleste) leses opp fra et skjult
`role="status"`, og varseltypen står i klartekst i `aria-label` — visuelt er den
bare et ikon. Ulest bæres av både en kant og en prikk, og et varsel hvis mål er
slettet sier det i teksten sin, ikke bare med en dempet farge. Badgen på bjellen
er `aria-hidden`; antallet ligger i knappens navn. Autoritativt: `varsler.md`.

## To bevisste avveininger

**Korthodet er `role="button"`, og det koster `<h2>`-en.** En knapp har
presentasjonelle barn, så overskriften inne i `.card-head`/`.cat-head` er ikke
lenger et hopp-mål for «neste overskrift». Byttet er verdt det: uten rollen kan
man ikke kollapse eller flytte en liste uten peker, og tittelen leses fortsatt —
den ER knappens navn. Strukturnavigeringen er gitt tilbake ved at `<article
class="card">` har `aria-label` («Listen «Handleliste»»), altså en navngitt
region i stedet for en overskrift. Nav-modalen har hatt dette oppsettet hele
tiden; listevisningen følger nå etter, så de to nivåene oppfører seg likt.

**Radene har ingen `aria-label`.** Et `listitem` med navn får innholdet sitt
erstattet av navnet, og da forsvinner indikator-chipene (ansvarlig, start,
frist) fra opplesningen. Teksten i raden er navnet; knappene inni har sine egne.

**To grønnaktige farger i stedet for én.** Én felles grønn kunne ikke tjene både
et svart ikon og hvit tekst: den ene vil ha en lys flate, den andre en mørk.
Fargene er derfor delt etter rolle (se over). Prisen er ett token og én klasse
mer; gevinsten er at begge deler leses godt i stedet for at begge så vidt klarer
gulvet.

## Fokus

- **Modaler og popovere** (`.modal-overlay`, `.switcher-overlay`): fokus flyttes
  INN ved åpning, `Tab` holdes INNE mens de er åpne, og fokus går TILBAKE til
  elementet som åpnet dem. Koblingen er én `MutationObserver` per overlay på
  `hidden` — ikke endringer i de ni åpne-/lukkefunksjonene, som skjuler
  modalene fra for mange steder til at en av dem kan holdes i synk manuelt.
  Åpne-kode som allerede flytter fokus selv (bekreftelsesdialogen, sveipefeltet,
  objektmenyen — som fokuserer sin første rad) får beholde sitt eget valg.
  Fly-i-søpla-klonen (`ghostFrom`) strippes for `id`/`data-id`, ellers ville
  gjenopprettingen funnet KLONEN av det slettede objektet og mistet fokus for
  godt når den fjernes 600 ms senere.
- **Innføringen** styrer fokus selv (`docs/introduksjon.md`) og røres ikke av
  dette; `Tab`-fellen over trekker seg unna mens den er aktiv. Merk at den kun
  har en felle på fortellestegene: på et handlingssteg står fokus på den EKTE
  kontrollen, og `Tab` skal kunne gå ut i appen — det er der handlingen
  utføres.
- **Etter en rendring**: `renderBoard()`/`renderNav()` bygger fra bunnen, så
  `captureFocusIn()` noterer hvor fokus sto FØR nedrivingen og
  `applyFocusIntent()` setter det på den nye noden. Dette gjelder ikke bare
  tastaturflyttinger: hver bakgrunnssynk som lander kaller `render()`, og uten
  dette ville fokus falt til `<body>` med noen sekunders mellomrom mens man
  jobber.
- **Etter sletting/oppløsning**: `focusTargetAfterRemoval()` velger naboen under,
  ellers naboen over, ellers ＋-knappen i containeren. Kalles FØR objektet
  forsvinner.

## Bevegelse

`prefersReducedMotion()` og `@media (prefers-reduced-motion: reduce)` gjelder
alle animasjoner — se `design-system.md`. Ingen `user-scalable=no`.

## Berøringsflater

**Ikonknappene tegnes små og treffes store.** De er 34–36 px i UI-et fordi
listevisningen skal være kompakt, men en finger trenger 44 px (WCAG 2.5.5, og
det samme tallet i Apples og Googles retningslinjer). De to kravene er ikke i
konflikt: knappen ser ut som før, mens et gjennomsiktig `::after` strekker det
KLIKKBARE feltet ut til 44×44 (`--touch` i `styles.css`).

**Ingen to mål får overlappe.** Utvidelsen er nøyaktig halve luften til naboen —
4 px av en 8 px gap — så to nabo-flater møtes uten å dekke hverandre. Det er
grunnen til at kontrollradene (`.item`, `.card-head`, `.cat-head`) har
`gap: 8px` og ikke 6: 8 er tallet som gjør 44 mulig uten overlapp. Overlappende
mål er ikke en teoretisk innvending — mellom «innstillinger» og «slett» ville et
trykk i sonen truffet vilkårlig, og den ene av dem er destruktiv.

Avkryssingsboksen er det ene stedet der knappen og det synlige er skilt: knappen
er 36×36, mens boksen man ser er de samme 26 px som før, tegnet av `::before`.
Uten det skillet måtte enten boksen blitt like stor som knappen (en 36 px rute
ved siden av 19 px tekst tar over hele raden), eller berøringsflaten blitt
liggende igjen på 26.

Unntak, med vilje:

- `.pass-toggle` ligger INNI tekstfeltet. En utvidet flate der ville stjålet
  klikk fra selve feltet, som er et større og viktigere mål.
- `.meta-chip` (26 px) og `.item-text` er stablet med 3 px mellom seg inne i
  raden og kan ikke vokse uten å overlappe hverandre. Begge er over AA-gulvet på
  24 px, og begge er tekstmål, ikke ikonknapper.

`tests/a11y-runtime.test.js` måler dette i nettleseren, i begge viewporter:
den FAKTISKE flaten (unionen av knappen og `::after`) må være ≥ 44×44, ingen to
flater får overlappe — heller ikke mot tekstmålene i samme rad — og ingen
kontroll får bli mindre enn den er i dag. Legger du til en ny ikonknapp, ta den
med i selektorlista i `styles.css` og gi den minst 8 px luft til naboen; testen
sier fra hvis du glemmer det.

## Manuelle kontrollpunkter

Det automatiske dekker navn, tastaturmekanikk, fokusflyt, mål og kontrast.
Det gjør IKKE opplevelsen. Gå gjennom denne lista når endringen berører
navigasjon, en ny kontroll, en ny modal eller dra-og-slipp:

### Tastatur (uten mus, uten skjermleser)

1. `Tab` fra toppen av siden: går fokus gjennom UI-et i den rekkefølgen det
   leses, uten å hoppe bakover?
2. Er fokusringen synlig på **hver eneste** stopp — også over et fargesterkt
   kort, over en grønn knapp og i den gule delen av del-modalen?
3. Kan du opprette, navngi, krysse av, omdøpe, sortere, flytte og slette et
   listepunkt uten å røre musen — både med snarveiene og via objektmenyen?
4. Kan du gjøre det samme på alle fire nivåene (område, mappe, liste,
   listepunkt)?
5. Åpne en modal: havner fokus inni? Kommer du deg IKKE ut med `Tab`? Lander
   fokus tilbake på knappen du åpnet fra når du lukker med `Escape` og med ✕?
6. Med to modaler oppå hverandre (del-modal over nav-modal): lukker `Escape` én
   om gangen, og følger fokus med nedover?
7. Slett den siste raden i en liste: forsvinner fokus, eller lander det et sted
   du kan fortsette fra?
8. Start en omdøping og trykk `Escape`: avbrytes bare redigeringen — ikke også
   modalen bak?

### Skjermleser (VoiceOver på macOS/iOS, NVDA på Windows, TalkBack på Android)

9. Gå gjennom en liste med tjue rader: sier hver menyknapp HVILKEN rad den
   gjelder, eller høres de like ut?
10. Omdøp et objekt og gå tilbake til knappene: leses det NYE navnet?
11. Flytt et objekt med `Alt`+pil: blir flyttingen lest opp, med navn og ny
    plass?
12. Åpne en modal: leses dialogens overskrift, og oppleves innholdet bak som
    borte?
13. Åpne objektmenyen på hvert nivå: leses panelets navn (hvilket objekt), og
    kan du nå «Slett» med piltastene uten å se skjermen?
14. Er alt som bare er dekorasjon (ikoner inne i en navngitt knapp) `aria-hidden`,
    slik at navnet ikke leses dobbelt?

### Syn og farge

15. Sett operativsystemet i høykontrastmodus: forsvinner noe?
16. Zoom nettleseren til 200 %: er alt fortsatt nåbart, uten horisontal scroll?
17. Se på appen i gråtoner: kan du fortsatt skille «gjort» fra «ikke gjort»,
    og en advarsel fra en feil? (Farge skal aldri være eneste bærer av mening —
    statuslinjas prikk har alltid tekst ved siden av.)

## Kjøre testene

```bash
node tests/a11y-contrast.test.js                        # tokens, ingen nettleser
NODE_PATH=$(npm root -g) node tests/a11y-runtime.test.js # navn, tastatur, fokus, mål
```
