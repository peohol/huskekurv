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

Et notatkort skal få en `×`-knapp som åpner en liten popover med **Arkiver** og
**Slett** (PR 2). Sletting bruker Huskis' søppelkassemodell. Arkivering flytter
notatet til et arkiv hvor det kan gjenopprettes eller slettes videre. I PR 1
finnes ingen av dem: `trashed` ligger i modellen, men det er ingen vei til den
fra UI-et.

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

Dagens globale søk utvides slik at det kan søke i både Lister og Notater.

Søkemodalen får et enkelt scopevalg:

**Alt | Lister | Notater**

`Alt` er standard. Notatsøk skal minst indeksere tittel og lesbar tekst fra
innholdet. Treffer skal navigere direkte til riktig objekt eller åpne riktig
notat. Det skal ikke bygges en separat søkemotor for Notater dersom dagens
søkemotor kan utvides.

## Koblinger mellom Lister og Notater

Lister og Notater skal kunne kobles på tvers.

Et notat eller en notatbok skal kunne kobles til relevante objekter i
listefanen, minst område, mappe og liste. Koblinger skal kunne opprettes fra
begge retninger.

Koblinger er ekte objektrelasjoner, ikke bare tekst-URL-er. Modellen skal være
mange-til-mange:

- ett notat kan kobles til flere listeobjekter;
- ett listeobjekt kan kobles til flere notater/notatbøker;
- koblingen endrer ikke notatets faktiske plassering i notathierarkiet;
- klikk på en kobling navigerer til det koblede objektet.

Detaljert UI for koblinger avgjøres under implementering med gjenbruk av
Huskis' eksisterende menyer og navigasjonsmønstre som førstevalg.

## Arkiv og søppelkasse

Notater får både arkiv og søppelkasse:

- **Arkiver** skjuler notatet fra normalvisningen og gjør det tilgjengelig i et
  eget arkiv;
- fra arkivet kan notatet gjenopprettes eller slettes;
- **Slett** følger Huskis' etablerte søppelkassemodell, inkludert trygg
  gjenoppretting og permanent sletting etter eksisterende prinsipper.

Livssyklusen gjelder ALLE TRE NIVÅENE — bokhylle, notatbok og notat. Ingen av
dem kan fjernes i dag, og PR 2 skal dekke dem alle: arkiv og søppelkasse for
notatet, og en konsistent sletting/gjenoppretting for de to foreldrenivåene.
Implementeringen må unngå foreldreløse notater og uklare regler ved
sletting/gjenoppretting av en forelder.

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
- **Lenker** er merket tekst med adressen i `data-url`, ikke ankere: Huskis'
  UI produserer fortsatt ingen utgående lenker
  ([`domains-and-urls.md`](domains-and-urls.md)). Å ÅPNE en notatlenke hører til
  PR 3, sammen med mobilskallets ruting.
- **Notatkortene er LISTEKORT**: samme kolonnemotor, samme pakkerekkefølge
  (venstre kolonne først) og samme posisjonsbaserte palettfarge — ingen
  særregler for notater ([`board-layout.md`](board-layout.md)).
- **Sletting av notater/notatbøker/bokhyller er IKKE med.** Den hører sammen med
  arkivet og søppelkassen i PR 2, og en «slett» uten en kasse å hente fra igjen
  ville vært tap av data uten vei tilbake.

Dekket av `tests/notes-tab.test.js` (nettleser, desktop + mobil) og
`supabase/tests/test-notes.sql` (RLS, LWW, forelder-invarianten, gravsteiner,
kontosletting).

### PR 2 — Livssyklus + integrasjon mellom hoveddelene

**Mål:** Notater blir integrert i Huskis som helhet, ikke bare en separat editor.

Omfang:

- arkiv, gjenoppretting og sletting for ALLE TRE NIVÅENE — bokhylle, notatbok
  og notat. Ingen av dem kan fjernes i dag;
- notatsøppelkasse etter eksisterende Huskis-prinsipper;
- globalt søk med `Alt | Lister | Notater`;
- søk i notattittel og tekstinnhold;
- direkte navigasjon fra søkeresultat til notat;
- mange-til-mange-koblinger mellom Notater og område/mappe/liste;
- oppretting og navigering av koblinger fra begge faner;
- verifisering av at globale Huskis-funksjoner fungerer konsistent uavhengig av
  aktiv hovedfane;
- nødvendig dokumentasjon og regresjonstesting.

Status: **ikke startet**.

### PR 3 — Deling, robusthet og polering

**Mål:** Gjøre Notater til en moden del av den delte og mobile Huskis-opplevelsen.

Omfang vurderes mot faktisk produktbehov etter PR 1–2, men forventes å omfatte:

- deling/rettigheter for bokhylle, notatbok og notat;
- flerbruker- og konfliktatferd;
- offline/redigering under nettverksbrudd;
- Android/Capacitor-regresjoner;
- tilgjengelighet og tastaturnavigasjon;
- endelig mobilpolering;
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
| PR 2 — Livssyklus + integrasjon | Ikke startet |
| PR 3 — Deling, robusthet og polering | Ikke startet |

**Neste steg:** PR 2 — livssyklus og integrasjon. Det første som mangler for en
bruker er å kunne FJERNE noe: arkiv og søppelkasse hører sammen, og PR 1 lot
begge stå ute med vilje. Livssyklusen i PR 2 gjelder alle tre nivåene — bokhylle,
notatbok og notat.
