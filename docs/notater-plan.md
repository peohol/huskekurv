# Notater — produkt- og implementeringsplan

Dette dokumentet er den levende planen for den nye hoveddelen **Notater** i Huskis.
Det beskriver målbildet, viktige produktvalg, leveransesteg og fremdrift. Når
implementeringen endrer en eksisterende invariant, skal det autoritative
dokumentet for det aktuelle området oppdateres i samme PR.

## Målbilde

Huskis deles i to hovedfaner helt øverst i visningsområdet:

- **Lister** — dagens Huskis.
- **Notater** — et nytt system for strukturerte notater.

Fanene ligger over dagens rad med toppkontroller. Toppkontrollene tilhører hele
Huskis og skal ikke dupliseres per fane. Lys/mørk drakt, språk, idéer, søk og
konto gjelder derfor på tvers av Lister og Notater. Andre globale kontroller skal
fortsette å fungere etter eksisterende regler med mindre funksjonen eksplisitt
avgrenses senere.

## Notathierarki

Notater organiseres i:

**Bokhylle > Notatbok > Notat**

Bokhylle og notatbok skal så langt det er hensiktsmessig oppføre seg som Område
og Mappe i listefanen (identifikatorene i koden og databasen heter fortsatt
`note_projects`/`note_folders` — se «Navn» nederst). Navigasjon, omdøping, rekkefølge, DnD, aktiv plassering,
responsiv oppførsel og øvrige kjente interaksjonsmønstre skal gjenbrukes fremfor
å innføre et parallelt designspråk.

Et notat kan ligge i en notatbok eller være et fritt notat uten notatbok. En
bokhylle kan dermed inneholde både notatbøker og frie notater. Notatbøker nøstes
ikke i notatbøker i første versjon.

Bokhyllen ER et kort med et trekkspill-hode, som områdekortet: hodet åpner og
lukker bokhyllen og lukker ikke navigasjonen. Bokhyllens egen plass — de frie
notatene — nås fra raden «Frie notater», som alltid står først inne i den.

## Notatoversikt

Når brukeren åpner en bokhylle eller en notatbok i Notater, vises notatene som
kort — de SAMME kortene som listene, ikke en egen korttype:

- flere kolonner på desktop, tilpasset tilgjengelig bredde;
- én kolonne på mobil;
- samme kolonnepakking som listene (venstre kolonne fylles først), og samme
  posisjonsbaserte palettfarge;
- hvert kort viser tittel med notatikonet foran, «sist endret» øverst til høyre,
  og et tekstutdrag i «…» på en plate i kortkroppen;
- klikk på kortet åpner editoren;
- klikk-og-hold / eksisterende pekersemantikk starter DnD;
- omrokering skal bruke samme grunnprinsipp som omrokering av lister i en mappe.

Notatkortet har den SAMME menyknappen som resten av appen (tre prikker,
`.obj-menu-btn` → `#obj-menu`): der ligger «Endre navn», «Flytt», «Koblinger»,
«Arkiver» og «Slett». Ingen egen popover-type ble innført —
[`menus.md`](menus.md) er autoritativ for radene. Har notatet koblinger, står
det en liten chip med antallet i kortkroppen, under utdraget.

## Oppretting

Oppretting skal være rask:

- `＋ [bokhylle]` oppretter en bokhylle;
- `＋ [notatbok]` oppretter en notatbok i den bokhyllen knappen står i;
- `＋ [notat]` oppretter et nytt notat og åpner editoren direkte.

Knappene bærer ＋ og typens eget ikon, som «＋ Liste» og «＋ Mappe» i
listefanen — ikke en tekstetikett.

Tomt notat skal ikke kreve en eksplisitt lagrehandling før brukeren kan gå
videre.

## Editor

Editoren åpnes som et eget fullskjermsbilde over den vanlige appflaten. Øverst
ligger en verktøylinje og en tydelig tilbakeknapp. Tilbakeknappen skal returnere
brukeren til nøyaktig kontekst før editoren ble åpnet, inkludert aktiv fane,
bokhylle/notatbok og så langt praktisk mulig scrollposisjon.

Linjen er delt i tre: tilbakeknappen alene til venstre (med Huskis' vanlige
knappeflate, ikke verktøyenes), verktøygruppen sentrert, og til høyre
lagringsstatusen sammen med idé- og draktknappen — de to tilhører HELE Huskis
og skal finnes også her. Verktøyene BRYTES over flere linjer når de ikke får
plass; de ruller aldri vannrett. Et verktøy man må lete etter er et verktøy man
ikke bruker.

Skriveflaten er et tydelig avgrenset ark som vokser med innholdet. Notatets
tittel ligger OVER arket, med notatikonet foran seg, så den ikke leses som
dokumentets første overskrift.

Editoren festes til det SYNLIGE feltet (`visualViewport`), ikke til
layoutviewporten: mobiltastaturet krymper det ene uten å røre det andre, og
verktøylinjen skal bli stående synlig. Markøren rulles fram igjen når feltet
krymper.

Første versjon skal støtte:

- tittel;
- overskrift nivå 1–3;
- fet;
- kursiv;
- understrek;
- hevet skrift;
- senket skrift;
- lenker;
- spesialsymboler;
- punktlister;
- nummererte lister;
- horisontal skillelinje;
- angre / gjør om igjen;
- vanlige tastatursnarveier for grunnleggende formatering der dette er naturlig.

Aktuelle editorfunksjoner og UX-mønstre kan gjenbrukes fra `peohol/mdeditz`, men
Huskis skal ikke få unødvendig teknisk kompleksitet eller en egen tung editor-
arkitektur dersom enklere gjenbruk er tilstrekkelig.

## Lagring og synk

Brukeren skal oppleve hvert notat som et selvstendig dokument, men notater skal
ikke lagres som faktiske HTML-/Markdown-filer i Supabase Storage som primær
persistensmodell.

Notater skal integreres i Huskis' eksisterende konto-, lokalbuffer- og
Supabase-synk på en måte som er konsistent med resten av appen. Innholdet skal
lagres i et stabilt, strukturert riktekstformat som egner seg for:

- videre redigering uten tap av struktur;
- tekstuttrekk til globalt søk;
- sikker rendring;
- fremtidig deling;
- eventuell senere eksport/import.

HTML kan genereres for visning ved behov, men rå editor-HTML skal ikke være den
autoritative datamodellen hvis en tryggere strukturert representasjon passer
arkitekturen bedre.

Editoren bruker **autosave**. Endringer lagres optimistisk lokalt og synkes uten
egen Lagre-knapp. En diskret status kan vise `Lagrer …` / `Lagret` når det gir
nyttig informasjon.

Første versjon trenger ikke Google Docs-lignende samtidig tegn-for-tegn-
redigering. Samtidig redigering av samme notat kan følge en dokumentbasert
konfliktmodell som passer eksisterende synk. En eventuell CRDT-/sanntidseditor er
et eget senere prosjekt.

## Globalt søk

Det globale søket dekker BEGGE hoveddelene, og det er fortsatt ÉN funksjon:
én indeks, én rangering, én resultatliste. Scopevalget **Alt | Lister |
Notater** er et filter over den samme indeksen, ikke en andre søkemotor. `Alt`
er standard.

Notatsiden bidrar med tre typer — bokhylle, notatbok og notat — og notatet er
den eneste typen med et ANDRE felt å matche mot: den lesbare teksten i
dokumentet. Et teksttreff rangeres etter alle navnetreff og viser setningen i
et utdrag, så raden forklarer seg selv.

Et treff åpner riktig objekt uansett hvilken fane man står i: `navigateToObject`
bytter hoveddel selv. Et notattreff åpner EDITOREN — kortet er en
forhåndsvisning, notatet er editoren.

Autoritativt: [`sok-og-navigering.md`](sok-og-navigering.md).

## Koblinger mellom Lister og Notater

En **kobling** er en RELASJON mellom ett objekt på notatsiden (bokhylle,
notatbok, notat) og ett på listesiden (område, mappe, liste). Den flytter
ingenting og eier ingenting: begge objektene beholder foreldrene sine, og begge
kan inngå i vilkårlig mange koblinger — mange-til-mange, begge veier.

**Modellen er (type, id) på hver side**, ikke et felt på objektet. Det er dét
som gjør den utvidbar: en ny koblingsbar type senere er ett ord i
`LINK_NOTE_KINDS`/`LINK_LIST_KINDS` og én kolonne i databasen, ikke en
ombygging av koblingssystemet.

I databasen er hver side sin EGEN fremmednøkkel (`object_links`, seks nullbare
kolonner med nøyaktig én satt per side og `on delete cascade` på alle). Det
koster tre kolonner per side, men gir noe et tekstpar aldri kan gi: databasen
selv garanterer at et koblingsmål finnes, og en kobling til noe som slettes for
godt forsvinner i samme øyeblikk — med sin egen gravstein. Det finnes derfor
ingen hengende koblinger å rydde, verken i klienten eller på serveren.
Autoritativt: [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md).

**Koblingen har ingen mutable felter**: den finnes eller den finnes ikke.
Derfor ingen UPDATE-policy, ingen UPDATE-grant og ingen konfliktfletting —
konflikten avgjøres av gravsteinene, som for et permanent slettet objekt. Det
finnes heller ingen unik indeks på paret: to enheter som lager den samme
koblingen offline ville ellers fått den ene skrivingen permanent avvist. Klienten
viser og fjerner koblinger PER PAR, så en dublett er usynlig.

**UI-et er én modal og én rad.** «Koblinger» i objektmenyen (på begge sider)
åpner `#links-modal`: øverst koblingene som finnes — trykk åpner målet, ✕
fjerner koblingen — og under dem det GLOBALE SØKET scopet til den andre siden.
Å velge et treff lager koblingen. Ingen egen søkemotor, ingen ny modaltype. En
chip med antallet står på objektet når det har koblinger.

**Oppførsel ved livssyklus:**

| Hendelse | Hva som skjer med koblingen |
|---|---|
| målet **flyttes** | ingenting — koblingen peker på id-en, ikke på plasseringen |
| målet **arkiveres** eller **legges i søppelkassen** | koblingen består, men raden vises som «Ikke tilgjengelig» og kan ikke åpnes; den kommer tilbake når målet gjør det |
| målet **gjenopprettes** | koblingen virker igjen, uendret |
| målet **slettes for godt** | koblingen slettes av databasens kaskade, og id-en gravlegges |
| målet er **utilgjengelig for meg** (et delt område jeg har mistet tilgangen til) | samme visning som over — raden står, men kan ikke åpnes |
| **samtidige endringer** | opprett vinner over ingenting; en fjerning gravlegger id-en, og en enhet som fortsatt har den lokalt får PT409 og gravlegger den selv |

En innsetting som likevel skulle møte et mål som er borte (kappløpet mellom to
synk-runder) avvises av fremmednøkkelen (23503). Klienten behandler DET som et
endelig svar for en kobling — den gravlegger raden lokalt i stedet for å prøve
igjen i det uendelige, nøyaktig som for en gravlagt id.

## Arkiv og søppelkasse

Alle tre nivåene — bokhylle, notatbok og notat — har BEGGE deler, som to
uavhengige tilstander på den samme raden (`archived` og `trashed`, begge på
innholdsregisteret):

- **Arkiver** legger objektet til side. Det er fortsatt levende innhold; det
  står bare ikke i normalvisningen. Veien tilbake er arkivet, som ligger som en
  egen knapp rett ved siden av søppelkassen på samme nivå.
- **Slett** følger Huskis' etablerte søppelkassemodell uendret: optimistisk
  sletting med angre-toast, gjenoppretting, og gravstein først ved tømming.

De to kan stå samtidig: et arkivert notat kan legges i søppelkassen og
gjenopprettes tilbake til arkivet det lå i.

**Flaggene arves ikke nedover.** En bortlagt bokhylle skjuler notatbøkene og
notatene sine uten å flagge dem — akkurat som en slettet mappe skjuler listene
sine — og gir dem tilbake ved gjenoppretting. Derfor er hver kasse og hvert
arkiv scopet til en LEVENDE forelder, så en gjenoppretting alltid gjør objektet
synlig igjen. Et notat i en bortlagt notatbok blir heller ikke et fritt notat:
det følger notatboken ut av visningen.

**Tømmingen er det ene stedet hierarkiet er rekursivt**, og den følger
databasens kaskader: en tømt bokhylle tar notatbøkene og notatene med seg, mens
en tømt NOTATBOK etterlater notatene som frie notater i bokhyllen. Et notat er
et dokument brukeren har skrevet; notatboken er hylla det sto i.

Autoritativt for hele mekanikken: [`trash.md`](trash.md).

## Deling og rettigheter

Datamodellen skal fra starten unngå valg som gjør fremtidig deling vanskelig.
Full deling av bokhyller, notatbøker og notater trenger likevel ikke inngå i
første leveranse.

Når deling implementeres, skal autorisasjon følge Huskis' eksisterende
serverhåndhevede rettighetsmodell. Deling og samtidig redigering av riktekst må
vurderes som et eget risikoområde og testes eksplisitt.

## Leveranseplan

### PR 1 — Fundament + fungerende Notater-fane

**Mål:** Etter merging kan en innlogget bruker bruke Huskis til reelle,
grunnleggende notater end-to-end.

Omfang:

- hovedbryteren `Lister ↔ Notater` som ÉN segmentert kontroll, sentrert på en
  egen linje øverst i panelet, over dagens toppkontroller;
- dagens Lister-fane skal være funksjonelt uendret;
- datamodell og Supabase-skjema for Bokhylle > Notatbok > Notat;
- lokal persistens, synk og nødvendige gravsteiner/konfliktregistre;
- bokhylle- og notatboknavigasjon med samme grunnmønster som Område/Mappe,
  inkludert trekkspill på bokhyllehodet og raden «Frie notater»;
- støtte for frie notater;
- oppretting og omdøping;
- responsiv notatoversikt med kort, tekstutdrag og sist endret;
- DnD/rekkefølge for notatkort, med eksisterende DnD-mekanisme som utgangspunkt;
- fullskjermseditor med tilbake til forrige kontekst;
- alle formatteringsfunksjonene listet i Editor-seksjonen;
- autosave;
- norsk og engelsk brukerrettet tekst;
- lys/mørk drakt;
- relevante enhets-, synk-, nettleser- og responsive tester;
- oppdatering av autoritative dokumenter for datamodell, database, konto/synk,
  menyer, DnD, design, språk og tilgjengelighet der implementeringen faktisk
  endrer kontraktene.

**Akseptanse:**

En bruker kan åpne Huskis, velge Notater, opprette bokhylle/notatbok/notat, skrive
og formatere innhold, gå tilbake, se notatkortet, omrokere det, reloade appen og
finne igjen korrekt innhold og struktur. Det samme skal fungere etter normal
synk mot konto. Mobilvisningen skal være reelt brukbar.

**Ikke i PR 1:** arkiv, søppelkasse for notater, globalt notatsøk,
koblinger Lister ↔ Notater og full notatdeling, med mindre en liten del er
teknisk nødvendig for å etablere en trygg datamodell.

Status: **gjennomført**.

Slik ble det:

- **Datamodellen** er tre nye kontotabeller — `note_projects`, `note_folders`,
  `notes` — med samme to registre, gravsteiner og insert-vakter som resten av
  innholdet, og `owner_id = auth.uid()` som hele autorisasjonen (som idéene).
  Klienten holder bokhyllene nøstet (notatbøkene i dem) og notatene FLATT med to
  forelder-pekere: `project` (alltid) og `folder` (null = fritt notat). De to
  kan ikke motsi hverandre: serveren UTLEDER bokhyllen av notatboken, og
  flyttes en notatbok, følger notatene med — også når enheten mister nettet
  midt i. Autoritativt: [`data-model.md`](data-model.md) og
  [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md).
- **Innholdet** er et strukturert riktekstdokument (`{v, blocks}` med
  inline-kjøringer), ikke rå editor-HTML: det kan redigeres videre uten
  formattap, gjøres om til lesbar tekst for søk, og rendres node for node — aldri
  som markup. Hele dokumentet rir på innholdsregisteret, så konflikter avgjøres
  per DOKUMENT.
- **Editoren** er én `contenteditable` med nettleserens egen `execCommand`
  (tagger, ikke inline-stiler), og alt som kommer inn — innliming inkludert —
  leses tilbake gjennom den samme trakten. Autosave, ingen Lagre-knapp.
- **Lenker i notatteksten** er merket tekst med adressen i `data-url`, ikke
  ankere: Huskis' UI produserer fortsatt ingen utgående lenker
  ([`domains-and-urls.md`](domains-and-urls.md)). Å ÅPNE en slik lenke hører
  til PR 3, sammen med mobilskallets ruting. (Det er noe helt annet enn
  KOBLINGENE i PR 2, som peker på Huskis' egne objekter.)
- **Notatkortene er LISTEKORT**: samme kolonnemotor, samme pakkerekkefølge
  (venstre kolonne først) og samme posisjonsbaserte palettfarge — ingen
  særregler for notater ([`board-layout.md`](board-layout.md)).
- **Sletting av notater/notatbøker/bokhyller var IKKE med.** Den hørte sammen
  med arkivet og søppelkassen, og en «slett» uten en kasse å hente fra igjen
  ville vært tap av data uten vei tilbake. Begge kom i PR 2.

Dekket av `tests/notes-tab.test.js` (nettleser, desktop + mobil) og
`supabase/tests/test-notes.sql` (RLS, LWW, forelder-invarianten, gravsteiner,
kontosletting).

### PR 2 — Livssyklus + integrasjon mellom hoveddelene

**Mål:** Notater blir integrert i Huskis som helhet, ikke bare en separat editor.

Omfang:

- arkiv, gjenoppretting og sletting for ALLE TRE NIVÅENE — bokhylle, notatbok
  og notat;
- notatsøppelkasse etter eksisterende Huskis-prinsipper;
- globalt søk med `Alt | Lister | Notater`;
- søk i notattittel og tekstinnhold;
- direkte navigasjon fra søkeresultat til notat;
- mange-til-mange-koblinger mellom Notater og område/mappe/liste;
- oppretting og navigering av koblinger fra begge faner;
- verifisering av at globale Huskis-funksjoner fungerer konsistent uavhengig av
  aktiv hovedfane;
- nødvendig dokumentasjon og regresjonstesting.

Status: **gjennomført**.

Slik ble det:

- **To uavhengige tilstander per notatobjekt**, begge på innholdsregisteret:
  `archived` (lagt til side) og `trashed` (søppelkassen). Et arkivert notat kan
  legges i søppelkassen og komme tilbake til arkivet det lå i. Ingen av
  flaggene arves nedover — en bortlagt forelder skjuler innholdet sitt uten å
  flagge det, og gir det tilbake ved gjenoppretting, akkurat som en slettet
  mappe skjuler listene sine.
- **Tømmingen følger databasens kaskader, ikke omvendt.** En tømt bokhylle tar
  notatbøkene og notatene med seg (`notes.project_id` er `not null` + cascade);
  en tømt NOTATBOK etterlater notatene som frie notater (`folder_id` er
  `on delete set null`). Et notat er et dokument brukeren har skrevet, og en
  notatbok er hylla det sto i.
- **Ingen nye kontrollmønstre.** Kassene og arkivene er `.trashcan` på de samme
  tre plassene listenes kasser står ([`trash.md`](trash.md)), arkivet låner
  søppelkasse-modalen, og alle tre notatnivåene fikk den eksisterende
  objektmenyen ([`menus.md`](menus.md)). Dra-til-kassen virker på alle tre.
- **Søket er fortsatt ÉN funksjon.** Scopevalget er et filter over den samme
  indeksen, og `navigateToObject` bytter hoveddel selv — et treff virker
  uansett hvilken fane man står i.
- **Koblingene er en egen tabell med én fremmednøkkel per side**
  (`object_links`), ikke et felt på objektene. Databasen garanterer dermed at et
  koblingsmål finnes, og `on delete cascade` gjør en hengende kobling umulig.
  Raden har ingen mutable felter, så den har verken UPDATE-policy eller
  konfliktfletting — gravsteinene avgjør.
- **Deling er fortsatt ikke med.** Notatene hører til kontoen alene, og
  koblingene er den enkelte brukerens egne krysshenvisninger.

Dekket av `tests/notes-lifecycle-links.test.js` (nettleser, desktop + mobil),
`supabase/tests/test-note-links.sql` (arkivregisteret, RLS mellom to brukere,
kaskadene, gravsteinene, kontosletting) og
`tests/notes-tab.test.js` som regresjonsvern for PR 1.

### PR 3 — Deling, robusthet og polering

**Mål:** Gjøre Notater til en moden del av den delte og mobile Huskis-opplevelsen.

Omfang vurderes mot faktisk produktbehov etter PR 1–2, men forventes å omfatte:

- deling/rettigheter for bokhylle, notatbok og notat — og hva en kobling betyr
  når det ene objektet er delt og det andre ikke er det;
- flerbruker- og konfliktatferd;
- offline/redigering under nettverksbrudd;
- Android/Capacitor-regresjoner;
- tilgjengelighet og tastaturnavigasjon;
- endelig mobilpolering;
- å ÅPNE en lenke i et notat, sammen med mobilskallets ruting (PR 1 lot
  adressen ligge i `data-url` uten en vei ut);
- eventuell import/eksport av enkeltstående notater som filer.

Sanntids samarbeid i samme dokument inngår ikke automatisk i dette steget.

Status: **ikke startet**.

## Prinsipper for gjennomføring

- Bygg vertikale leveranser som kan testes end-to-end.
- Gjenbruk eksisterende Huskis-mekanismer der semantikken faktisk er den samme;
  ikke kopier kode bare for å få et parallelt Notes-system.
- Samtidig skal eksisterende Liste-funksjonalitet beskyttes mot regresjoner.
- Klient og database endres sammen når datakontrakten endres.
- Rettigheter håndheves serverside.
- Søk, DnD, sletting, språk, drakt og tilgjengelighet skal følge sine eksisterende
  autoritative dokumenter.
- Nye tekniske valg som ikke krever et produktvalg tas autonomt ut fra repoets
  arkitektur og dokumenteres i PR-en.
- Sikkerhet, personvern og datatap prioriteres over bekvemmelighet.

## Navn

De norske ordene i UI-et og dokumentasjonen er **bokhylle**, **notatbok** og
**notat**. Identifikatorene i koden og databasen heter fortsatt `note_projects`,
`note_folders`, `notes`, `project_id`, `folder_id`, `activeProject` og
`activeFolder` — nøyaktig som «område»/«mappe» heter `universe`/`group`. Det er
databasekontrakten; døp dem ikke om.

## Fremdrift

| Leveranse | Status |
|---|---|
| PR 1 — Fundament + fungerende Notater-fane | **Gjennomført** |
| PR 2 — Livssyklus + integrasjon | **Gjennomført** |
| PR 3 — Deling, robusthet og polering | Ikke startet |

**Neste steg:** PR 3 — deling, robusthet og polering. Notatene er nå en hel del
av appen for ÉN bruker: de kan legges bort og hentes fram igjen, de finnes i
søket, og de henger sammen med listene. Det som står igjen er å slippe andre
til — og da må det avgjøres hva en kobling betyr når det ene objektet er delt
og det andre ikke er det.

**Datamodellen forbereder ting som IKKE er implementert.** Det er ikke det
samme som ferdig:

- `object_links` kan bære flere typer per side enn de seks som finnes i dag —
  men bare de seks er koblingsbare nå.
- Notatradene har `owner_id` og de samme registrene som delt innhold — men det
  finnes ingen roller, ingen capabilities og ingen delings-UI for dem.
- Lenker i et notat lagres med adressen i `data-url` — men UI-et åpner dem
  fortsatt ikke.
