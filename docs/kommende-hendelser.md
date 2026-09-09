# Kommende hendelser

Les denne når oppgaven berører kalenderknappen, modalen «Kommende hendelser»
eller reglene som avgjør hvilke frister og starttider som vises der.

To ting bor her, og de er bevisst skilt:

1. **Hendelsesmotoren** — `collectUpcomingEvents(state, now)` i `app.js`: en ren
   funksjon av tilstand + tidspunkt, uten et eneste DOM-oppslag. Den har to
   kallere: modalen under, og varselgeneratoren
   ([`varsler.md`](varsler.md)), som leser TERSKLER ut av de samme hendelsene.
   Reglene finnes ÉN gang — trenger varslene noe mer, utvides motoren her.
2. **Modalen** (`#events-modal`) — som bare TEGNER det motoren returnerte, og
   navigerer via `navigateToObject()` fra
   [`sok-og-navigering.md`](sok-og-navigering.md).

Tidsverdiene, semantikken for dato uten klokkeslett og den harde
fristinvarianten er beskrevet i [`scheduling.md`](scheduling.md), som er
autoritativ for dem.

## Kalenderknappen

Andre knapp i toppkontrollgruppen, rett til høyre for bjellen
(`.corner-btn.events-btn`, `#events-btn` — se [`menus.md`](menus.md),
«Toppkontrollene»). Den er en `.corner-btn` som de andre og trengte ingen ny
posisjonsutregning: gruppen plasserer knappene med flex, og en ny legges FØRST.
Under 560 px ligger den sammen med varsel- og søkeknappen på en rad UNDER drakt
og konto — se `menus.md`.

## Modalen (`#events-modal`)

Vanlig `.modal-overlay`-skall (fokusfelle, Escape via `closeTopLayer`,
`body.modal-open`, fokus tilbake til kalenderknappen ved lukking) med en fast
horisont-bryter under tittelen og to seksjoner, hver med opptil fire grupper.

**Seksjonsoverskriften bærer feltets eget ikon** til venstre for teksten —
nøyaktig det ikonet start-/fristchipene bruker på lister, kategorier og
listepunkter (`ICONS.calendar` / `ICONS.calendarDue`). Feltet ser dermed likt ut
overalt i appen. Ikonet har ingen plate: seksjonen er ikke en status, den sier
hvilket FELT dette er, og uten plate følger streken drakten slik radenes
typeikon gjør.

| Seksjon | Gruppe | Bøtte | Grense | Ikon/flate |
|---|---|---|---|---|
| **Tidsfrister** | Frist utløpt | `over` | `due < now` | varseltrekant, rød |
| | Frist innen en uke | `soon` | `now <= due < now + 7 døgn` | varseltrekant, gul |
| | Frist innen en måned | `month` | `now + 7 døgn <= due < now + 30 døgn` | kalender m/utropstegn, grønn |
| | Frist om mer enn en måned | `far` | `due >= now + 30 døgn` | kalender m/utropstegn, skifergrå |
| **Starttider** | Har begynt | `started` | `start <= now` | start-/play-ikon, blågrønn |
| | Begynner innen en uke | `soon` | `now < start < now + 7 døgn` | klokke, lilla |
| | Begynner innen en måned | `month` | `now + 7 døgn <= start < now + 30 døgn` | kalender, blå |
| | Begynner om mer enn en måned | `far` | `start >= now + 30 døgn` | kalender, skifergrå |

Grensene er **uttømmende og møtes uten hull**: nøyaktig 7 døgn havner i
«innen en måned», nøyaktig 30 i «om mer enn en måned» — aldri mellom to. Ved
`now` skiller de to seksjonene lag med vilje — en frist som er nøyaktig nå er
ennå ikke oversittet, mens en start som er nøyaktig nå HAR begynt. Ett døgn er
24 timer: uka er `WEEK_MS`, måneden `MONTH_MS` (30 døgn), ikke kalenderuker
eller kalendermåneder.

**Startgruppene bærer ikke varselfargene.** At noe begynner er ingen advarsel,
så startgruppene har sine EGNE flater (`--grad-purple`, `--grad-blue`) i stedet
for å låne gult og grønt. Fristgruppene bruker de samme gradientene som
statuschipene (`docs/design-system.md`).

**De to ytterste gruppene deler flate** (`--grad-slate`), og det er den ene
bevisste gjenbruken: lenger ute enn en måned er ingen grad av hast, og da er
tonen heller ikke en varselfarge. De to står i hver sin seksjon, med hvert sitt
ikon og hver sin overskrift, så de er ikke til å forveksle. Alle syv flatene er
med i kontrastkontrakten (`docs/tilgjengelighet.md`).

Chipene i board-et leser de samme bøttene, men grovere: de slår `month` og `far`
sammen til én tone (`docs/scheduling.md`).

**Pinningen følger platen, ikke modalen.** Gruppeikonet står på en
kontraktsgradient som er den samme i begge drakter, så `.event-icon` pinner
`--icon-ink` og `--icon-paper` for seg selv, slik `.btn-solid` gjør: er flaten
den samme lyst og mørkt, skal streken oppå være det også. Radens typeikon står
derimot rett på modalflaten, og den SNUR med drakten — så streken må snu med
den. Kategori-ikonet er dessuten det eneste av de tre uten «papir» under seg:
pinnet mørkt ble det nesten usynlig i en mørk rad.

Bare grupper som HAR rader tegnes, og finnes ingen hendelser i det hele tatt,
står det én linje om det. Antallet rader i en gruppe telles ikke opp: radene
står der og kan telles.

**Luften skiller gruppene, ikke en strek.** Gapet er 30 px i begge ledd
(`.events-body` mellom seksjonene, `.events-section` mellom overskriften og
gruppene og mellom gruppene), mens luften inne i en gruppe er 8 px mellom
radene. Avstanden er altså i en helt annen størrelsesorden enn den innvendige,
og grupperingen leses uten å telle rader — og uten en skillelinje, som ved siden
av den avstanden bare ble støy.

### Tidshorisonten

Under tittelen står et fast panel med overskriften **«Tidshorisont»** og en
bryter med tre posisjoner (`role="radiogroup"`, rullende tabindex, piltaster).

Bryteren er appens **segmenterte kontroll** (`.seg`, se
[`design-system.md`](design-system.md)) — den samme som hovedbryteren
Lister ↔ Notater og søkets scopevelger. Den arver derfor både den grønne flaten
som GLIR mellom stillingene og dra-gesten: en bryter som så ut som de andre,
men verken bar den grønne markeringen eller lot seg dra, leste som den samme
kontrollen i ustand. `paintSeg` melder `aria-checked` her (og `aria-selected`
der bruksstedet er en fane-rekke) — det er rollen på beholderen som avgjør,
ikke to ulike malere.

Bruksstedet legger til to ting, og bare to. Panelet strekker bryteren ut i full
bredde. Og etiketten BREKKER i stedet for å fylle sporet sitt: segmentene
holder seg like brede uansett bredde (`min-width: 0`, se design-systemet), og
da må teksten vike for noe — her er den ren tekst i en modal med plass nedover,
så «1 måned» over to linjer er svaret. Polstringen er samtidig knappere enn
hovedbryterens, og det er regnet: den lengste etiketten er 65 px («1 month»,
63), sporet er 78 px på en 320 px skjerm, og 6 px på hver side lar de 65 stå på
ÉN linje. Under det brekker den — som den gamle bryteren gjorde allerede fra
320 px. Uten brekkingen spiste teksten hele polstringen og la seg kant i kant
med nabosegmentet (MÅLT på 280 px: 65 px tekst i et 65 px spor).

| Posisjon | Vindu | Virkning |
|---|---|---|
| **1 uke** | avstand til nå `< 7 døgn` | skjuler `month`- og `far`-gruppene, og alt som ligger sju døgn eller mer TILBAKE i tid |
| **1 måned** | avstand til nå `< 30 døgn` | skjuler `far`-gruppene, og alt som ligger tretti døgn eller mer tilbake |
| **Alle** (standard) | ingen | alle åtte gruppene |

Vinduet er **symmetrisk om `now`** og bruker de samme grensene som bøttene: en
hendelse er innenfor når den er MINDRE enn horisonten unna, i begge retninger.
«1 uke» viser dermed nøyaktig det som begynte for under sju døgn siden og det
som skjer om under sju døgn.

Panelet ligger UTENFOR `.events-body`, som er den eneste flaten som ruller:
horisonten er en innstilling FOR listen, ikke en del av den, og skal stå der
også når man har rullet langt ned.

**Filteret bor i modalen, aldri i motoren.** Varslene
([`varsler.md`](varsler.md)) leser de samme hendelsene, og en visningsinnstilling
skal ikke kunne slå av et varsel. Grenseutregningen (`nextEventBoundary`) leser
derimot ALLE hendelsene: en hendelse som er utenfor horisonten nå, er nettopp en
som skal komme inn i den.

**Valget ligger på BRUKEREN, ikke på enheten:** det lagres i kontoens metadata
(`accountPref('events').horizon` / `saveAccountPref`, samme sted som demoen og
gest-tipsene) og følger dermed med til neste enhet. Standarden er «Alle».

Er alt filtrert bort, sier den tomme flaten det — «Ingen hendelser innenfor
denne tidshorisonten» er en annen beskjed enn «ingen hendelser», og bare den ene
er noe brukeren kan gjøre noe med.

### Raden

`[typeikon] navn` med en dempet linje under seg som gir **kontekststien**
(`Arbeid › Klinikk`), og tiden i enden. Typen står ikke i teksten — den er
ikonet: liste, kategori eller listepunkt (`ICONS.list` / `.category` / `.item`;
listepunktets er listens motiv med én rad i stedet for tre). Radene bærer
altså IKKE gruppens statusikon: fargen står én gang, i overskriften. Ikonet har
ingen plate, men kaster en liten skygge, så den lyse streken i mørk drakt
løftes fra raden i stedet for å ligge flatt i den.

**Tiden er to linjer.** Øverst avstanden i tid, under den den konkrete datoen.
Avstanden vises bare innenfor sju døgn hver vei — lenger ut sier datoen alene
mer enn et tall gjør — og teller HELE enheter nedover: «om 3 d» betyr minst tre
hele døgn igjen. Under ett døgn byttes enheten til timer («om 5 t», «3 t
siden»), aldri under 1. Under 560 px legges begge på én linje under teksten,
slik at stien får hele bredden.

At enhetene telles ned til hele har en teknisk side også: teksten bytter da på
eksakte tidspunkter (`at ± n · enhet`), som `nextEventBoundary` kan sove fram
til uten å regne på halve enheter.

Trykk på raden lukker modalen og kaller `navigateToObject({ type, id })` — som
går til riktig mappe, folder ut det som må foldes ut, ruller målet fram,
fokuserer og markerer det.

### Oppdatering mens modalen står åpen

Innholdet regnes ut når modalen åpnes, og på nytt ved enhver endring i
tilstanden: `save()` og `renderBoard()` kaller `refreshEventsModal()`, og en
synk-runde ender i begge. Kallet er en no-op når modalen er lukket, og maler
bare om når SIGNATUREN endrer seg — da mister ikke en fokusert rad fokus av en
bakgrunnssynk som ikke rørte noen av hendelsene.

Gruppene avhenger også av `now`, ikke bare av tilstanden. Modalen PULSER likevel
ikke: hver hendelse har et endelig antall øyeblikk der den kan bytte gruppe eller
falle ut av horisonten — tidspunktet selv og de fire grensene `at ± WEEK_MS` /
`at ± MONTH_MS` — pluss hver hele enhet nedtellingen tikker på, så
`refreshEventsModal()` sover til den FØRSTE av dem (`nextEventBoundary`). En frist som passerer mens
modalen står åpen flytter seg dermed til «Frist utløpt» av seg selv. Søvnen har
et tak på seks timer, og en `visibilitychange` regner ut på nytt med én gang:
`setTimeout` er ikke til å stole på over en fane i bakgrunnen eller en enhet som
har sovet.

## Hva som er aktivt

En hendelse finnes bare for noe det fortsatt er noe å gjøre med:

| Nivå | Aktiv når |
|---|---|
| listepunkt | levende, ikke kategori, `done !== true` |
| kategori | har minst ett aktivt listepunkt som er BARN av den |
| liste | har minst ett aktivt listepunkt, i kategori eller ikke |

En tom liste eller kategori er altså irrelevant, og det samme er en der alt er
krysset av. Ferdige listepunkter vises aldri. Papirkurven er ute på alle nivåer
— motoren bruker den samme `live()`-vakten som rendringen
([`trash.md`](trash.md)).

## Effektiv, egen og arvet tid

Presedensen er den samme som ellers i appen (`timeController`,
[`scheduling.md`](scheduling.md)):

1. en liste med `lockTimes` styrer tidene til ALLE sine listepunkter;
2. ellers styrer en kategori med `lockTimes` sine egne listepunkter;
3. ellers bruker listepunktet sine egne tider.

Motoren skiller mellom **effektiv tid** (den som faktisk gjelder), **egen
eksplisitt tid** og **arvet tid**. Merk at arv KUN oppstår gjennom `lockTimes`:
et listepunkt uten frist har ingen frist, selv om listen over det har en.
Kategorier låses aldri av listen — de har alltid sine egne tider.

## Deduplisering

Målet er å vise det høyeste meningsfulle nivået uten å skjule et barn som
faktisk sier noe nytt. Reglene er per liste, og nivåene behandles ovenfra og
ned: liste → kategori → listepunkt.

**Felles for begge feltene:** en tid som er IDENTISK med en forelders allerede
viste tid gir ingen egen rad. Det dekker både ren arv (låste tider) og en
kategori som tilfeldigvis har satt samme dag som listen.

**Frister har én regel til:** er forelderens frist allerede UTLØPT, dominerer
den alt under seg som er utløpt av samme eller senere grunn. Uten den ville én
oversittet liste tegnet en vegg av røde rader som alle sier det samme. Et barn
som er ENDA MER overskredet enn forelderen bryter ut og står øverst — det er ny
informasjon.

**Starter har ikke den regelen, og skal ikke ha den.** At en liste er påbegynt
betyr ikke at et listepunkt med sin egen, senere start er det. Et barn med
særskilt egen starttid vises derfor alltid, i sin egen gruppe.

Typisk utfall: et listepunkt med egen frist tidligere enn kategoriens/listens
vises ved siden av dem så lenge forelderens frist ennå ikke er utløpt.

## Sortering

Innenfor hver gruppe sorteres det på tid: **lengst overskredet først** og
**nærmest først** er den samme stigende rekkefølgen. Det ene unntaket er «Har
begynt», der den SIST påbegynte står øverst — det er den man nettopp satte i
gang og mest sannsynlig leter etter.

Ties brytes deterministisk videre på objekttype (liste, kategori, listepunkt),
så navn (norsk alfabet, som i søket), så sti, og til slutt id. To visninger av
samme tilstand bytter derfor aldri om på to rader.

## Tilgjengelighet

- Dialogsemantikk på modalen; fokus flyttes inn ved åpning og tilbake til
  kalenderknappen ved lukking (unntatt når en rad ble åpnet — da eier
  navigeringen fokuset).
- Radene er vanlige knapper, så Tab og Enter virker uten særbehandling. Hver
  rad har et `aria-label` med navn, type, tidspunkt (med avstanden når den
  finnes) og sti — typen står der i KLARTEKST, siden den visuelt bare er et
  ikon.
- Antall hendelser leses opp fra et visuelt skjult `role="status"` — og det er
  antallet som faktisk VISES, altså etter horisonten.
- Horisont-bryteren er en `role="radiogroup"` navngitt av sin egen overskrift,
  med rullende tabindex (bare den valgte posisjonen er i tabbrekkefølgen) og
  piltaster mellom posisjonene. Den valgte posisjonen bæres av `aria-checked`,
  ikke bare av flaten under teksten.
- Farge er aldri eneste bærer: gruppen har overskrift i klartekst, glyfene
  skiller gruppene fra hverandre, og avstanden mellom dem er en form, ikke en
  farge. Det gjelder også de to gruppene som DELER flate — de skilles av
  overskrift, ikon og seksjon. Start-ikonet er bevisst IKKE en hake — det ville
  lest som «utført».

Kravene er de samme som ellers — se [`tilgjengelighet.md`](tilgjengelighet.md).

## Språk

Alle tekstene ligger i ordboken under `events.*` (pluss `kind.*` for typenavnene
i opplesningen) — gruppene, horisontens tre posisjoner og de to tomtilstandene.
Tidsenheten i nedtellingen er en EGEN nøkkel — «t» heter «h» på engelsk — så tallet og enheten kan settes sammen av oversettelsen. Se
[`sprak.md`](sprak.md).

## Voktere

- `tests/upcoming-events.test.js` — motoren: aktiv/ufullført, alle fire
  grensene hver vei, arv, deduplisering, sortering, dato-uten-klokke og
  sommertid.
- `tests/time-chips.test.js` — at chipene leser de SAMME bøttene, og at de to
  ytterste ender i én tone.
- `tests/events-modal.test.js` — knappen, modalen, tastatur/fokus,
  navigeringen, oppdatering mens den står åpen, tidshorisonten (panelet,
  vinduet, piltastene og at valget ligger på kontoen), i18n og fargekontrakten.
- `tests/corner-controls.test.js` — at kalenderknappen ikke rørte
  toppkontrollenes geometri.
