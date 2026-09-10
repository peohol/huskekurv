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
  og et tekstutdrag i «…» på en plate i kortkroppen. «Sist endret» er KORT og
  kommer fra appens egen datoordbok — klokkeslettet i dag, «i går» i går, ellers
  datoen — fordi hodet deler bredden med tittelen, og en full dato med
  klokkeslett presset tittelen ned i en smal søyle; hele tidspunktet ligger i
  chipens hjelpetekst. Ikonet står på tittelens
  FØRSTE LINJE og i samme størrelse som type-ikonene ellers i appen: hodet her er
  topp-justert fordi tittelen kan gå over flere linjer, så ikonet får høyden til
  den første linjeboksen og sentreres i den (vakt: `notes-tab` punkt 8);
- klikk på kortet åpner editoren;
- klikk-og-hold / eksisterende pekersemantikk starter DnD;
- omrokering skal bruke samme grunnprinsipp som omrokering av lister i en mappe.

Arkivet og søppelkassen for notatene står i en FAST FOT nederst på siden, side
om side og med halve bredden hver — ikke i topplinjas knapperad. Det er den samme
foten listefanen har for sin kasse; begge er beskrevet i
[`trash.md`](trash.md).

Notatkortet har den SAMME menyknappen som resten av appen (tre prikker,
`.obj-menu-btn` → `#obj-menu`): der ligger «Endre navn», «Flytt», «Koblinger»,
«Kopier alt», «Kopier som Markdown», «Arkiver» og «Slett». Ingen egen popover-type ble innført —
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
- lenker — med adresse, og med en vei UT: «Åpne» i lenke-panelet,
  `Cmd`/`Ctrl`-klikk på lenken, og et vanlig klikk i et skrivebeskyttet notat;
- spesialsymboler;
- punktlister;
- nummererte lister;
- horisontal skillelinje;
- angre / gjør om igjen;
- vanlige tastatursnarveier for grunnleggende formatering der dette er naturlig.

Aktuelle editorfunksjoner og UX-mønstre kan gjenbrukes fra `peohol/mdeditz`, men
Huskis skal ikke få unødvendig teknisk kompleksitet eller en egen tung editor-
arkitektur dersom enklere gjenbruk er tilstrekkelig.

## Utklippstavlen

Et notat skal kunne flyttes HELT ut av Huskis og inn i et annet program — og
tilbake igjen — uten å miste formatering. Utklippstavlen er veien, ikke filer:
den finnes overalt, den krever ingen nedlasting, og den treffer Word, Outlook,
Google Docs, Markdown-editorer og ethvert riktekstfelt i en nettleser.

Notatets objektmeny har derfor to rader, på kortet OG inne i editoren:

- **«Kopier alt»** — hele notatet, uavhengig av hva som er markert;
- **«Kopier som Markdown»** — det samme dokumentet som ryddig Markdown.

Begge er LESING, og krever ingen skriverett: de står også i et skrivebeskyttet
notat, der verktøylinjen er borte.

### Formatene som skrives

«Kopier alt» skriver **`text/html` og `text/plain` i samme skriving**, slik at
mottakeren velger selv. HTML-en er ren og portabel — `<h1>`–`<h3>`, `<p>`,
`<strong>`, `<em>`, `<u>`, `<sup>`, `<sub>`, `<ul>`/`<ol>`/`<li>`, `<hr>`,
`<br>` og `<a href>` — og ingenting annet. Ingen klasser, ingen id-er, ingen
`data-*`, ingen metadata: den bygges av den STRUKTURERTE modellen, ikke av
editorens DOM, og modellen inneholder ikke noe av det.

Notatets tittel følger med som dokumentets første `<h1>` (og som første linje i
ren tekst / `# ` i Markdown). Et notat uten tittel starter rett på innholdet.

Om `<a href>` i clipboard-HTML-en: se
[`domains-and-urls.md`](domains-and-urls.md) → «Ankeret som forlater appen».
Kort sagt: strengen går rett til utklippstavlen og settes aldri inn i Huskis'
eget DOM, og adressen normaliseres av `safeNoteUrl()` først — en adresse med et
skjema som kan kjøre kode blir aldri en lenke, bare tekst.

### Markdown

`noteDocToMarkdown()` skriver dokumentet linje for linje: `#`/`##`/`###` for
overskriftene, `**fet**`, `*kursiv*`, `-` for punktlister, `1.`, `2.`, `3.` for
nummererte, `---` for skillelinjen og `[tekst](adresse)` for lenker. Tegn som
ellers ville betydd noe i Markdown escapes, og et linjeskift inne i en blokk
blir et hardt linjeskift (to mellomrom).

Tre av Huskis' markeringer har ingen universell Markdown-form. De skrives som
den **inline-HTML-en Markdown selv tillater** — `<u>`, `<sup>`, `<sub>` — fordi
den er lesbar for et menneske, forstås av Pandoc, GitHub og de fleste editorer,
og aldri mister tekst. Gjennomstreking finnes ikke i modellen og skrives derfor
ikke.

### Innliming

Fremmed markup havner **aldri** i editorens DOM. Den tolkes i et DØDT dokument
(`DOMParser`, uten browsing context: ingen skript kjører, ingen ressurser
lastes), oversettes til Huskis' modell, og går gjennom `sanitizeNoteDoc()` før
noe settes inn. Det som settes inn er modellen bygget opp igjen med appens
EGNE noder.

Underveis:

- **Word** og **Google Docs** leses på formateringen de faktisk skriver:
  `<b>`/`<i>`/`<u>` OG inline-stilene `font-weight`, `font-style`,
  `text-decoration` og `vertical-align`. Den NÆRMESTE definisjonen vinner, så
  Google Docs' innpakning `<b style="font-weight:normal">` ikke gjør hele
  utklippet fett. Words listeavsnitt (`mso-list`) blir en ekte liste, og de
  falske kulepunkttegnene forsvinner.
- **Struktur som ikke finnes i modellen** degraderes trygt: nøstede lister
  flates til ett nivå, `h4`–`h6` blir `h3`, en tabellrad blir ett avsnitt med
  cellene skilt av tabulator, og ukjente tagger blir avsnitt eller tekst.
- **Alt farlig faller bort:** `<script>`, `<style>`, `<iframe>`, `<img>`,
  `on*`-attributter, fremmed CSS og klassenavn — og `javascript:`/`data:`-
  adresser mister lenken, men beholder teksten.
- **Ren tekst** limes inn som tekst, som før. Ser den ut som Markdown, tolkes
  kodene Huskis selv skriver ut; ellers står tegnene som de er (`2*3` er
  fortsatt `2*3`).

Selve innsettingen er nettleserens egen (`insertHTML`) med markup Huskis har
bygget fra sin egen modell — den deler blokken markøren står i, flytter
markøren og legger innlimingen på angre-stabelen. Uten støtte for kommandoen
faller innlimingen ned på ren tekst.

### Når plattformen ikke kan alt

Utklippstavlen er ulik i hver nettleser og hver WebView, så kopieringen har tre
trinn: `ClipboardItem` (begge formatene), den gamle `copy`-hendelsen (også
begge), og til slutt `writeText` (ren tekst). Toasten sier hva som faktisk
skjedde — «Notatet er kopiert.» eller at formateringen ikke fulgte med. En
plattformbegrensning gjør aldri funksjonen ubrukelig.

### Filer

Import og eksport av notater som **filer** (JSON, PDF, DOCX) er IKKE prioritert.
Utklippstavlen dekker det brukeren faktisk trenger — å få notatet ut i et annet
program og inn igjen — uten et nytt dokumentformat, en nedlastingsflyt eller en
filvelger å vedlikeholde.

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
egen Lagre-knapp. Statusen i verktøylinjen er ingen påstand noen setter, men en
AVLEDNING av det som faktisk står igjen: en ventende skriving, eller rader i
samskrivingskøen som ennå ikke har nådd kontoen. Kommer køen ikke fram, sier den
«Lagret på denne enheten» i stedet for å love noe den ikke vet.

## Sanntids samskriving

To personer med skriverett kan ha det SAMME notatet åpent og skrive samtidig —
også i det samme avsnittet — uten at den enes tegn forsvinner.

**Innholdet har to lag, og bare det ene avgjør konflikter:**

- **Dokumentet** er en CRDT (Yjs, `vendor/yjs-13.6.32.js`), og loggen den lever
  i er `note_updates`: append-only, én rad per oppdatering. Ingen skriving kan
  overskrive en annen — verken i databasen eller mellom to enheter — og den
  samme raden kan brukes to ganger uten virkning.
- **`notes.body` er PROJEKSJONEN** av dokumentet: lesbar tekst til søk, utdrag
  på kortet, utklippstavlen og offline-kopien. Den skrives fortsatt ved hver
  lagring, og den flettes fortsatt per felt (LWW) som alt annet innhold — men
  den er ikke lenger stedet innholdskonflikter avgjøres. Det gamle
  dokumentregisteret (`ts`/`org`) har dermed en klar og AVGRENSET rolle igjen:
  det styrer tittel, `trashed`/`archived` og projeksjonen. To konkurrerende
  konfliktmodeller lever ikke side om side.

**Tittelen er et navn**, og flettes som alle andre navn i appen (felt-LWW), ikke
i CRDT-en. Den kan endres fra kortet uten at editoren er åpen, og en slik
omdøping ville vært umulig å få inn i dokumentet uten å laste det først.

**Editoren er den samme som før.** Broen legger seg UNDER den: etter hver
endring leses DOM-et til modellen gjennom `noteDocFromEl()` som før, modellen
sammenlignes med CRDT-ens innhold, og bare FORSKJELLEN skrives inn. Derfor
virker formatering, innliming, utklippstavle, spesialtegn og lesemodus uendret
— de kjenner ikke CRDT-en. **Angre/gjør om** er derimot CRDT-ens egen: en fjern
endring maler editoren på nytt og river nettleserens angre-stabel, og en angring
skal uansett bare ta MINE endringer tilbake, ikke den andres.

**Fasongen i CRDT-en er flat**: én blokk per avsnitt, overskrift, skillelinje —
og per LISTEPUNKT. To som skriver i hvert sitt punkt i den samme lista rører da
hver sin tekst og kan ikke komme i veien for hverandre. Markeringene (fet,
kursiv, understrek, hevet, senket, lenke) er attributter med de samme navnene
som i dokumentmodellen.

**Et notat fra før denne runden har bare `body`.** Første klient som åpner det
sår CRDT-en fra dokumentet, og frøet er DETERMINISTISK: to klienter som sår fra
det samme dokumentet lager bit-identiske operasjoner, så de to frøene er den
samme operasjonen og flettes til én — ikke til to kopier av notatet.
Migreringen krever derfor ingen backfill og ingen nedetid.

**Offline er bedre enn før, ikke dårligere.** Oppdateringene legges i en kø i
enhetens lagring, ved siden av en lokal kopi av CRDT-en, og køen tømmes ved
første synk-runde etter at nettet er tilbake. Enheten som var borte mister
ingenting og overskriver ingenting.

**Loggen klappes sammen** når den blir lang: den sammenslåtte tilstanden legges
inn som ÉN ny rad, og radene den inneholder slettes i samme transaksjon.
Komprimeringen navngir radene den folder inn, så en rad som var underveis
overlever.

**Tilgangen håndheves serverside, som alt annet.** Loggen har én policy — en
lesepolicy på `can_read_note` — og klienten har ikke engang kolonne-rettighet
til innholdet: alt går gjennom fire SECURITY DEFINER-RPC-er som sjekker
`can_read_note`/`can_edit_content` selv. En ren LESER får live-oppdateringene og
kommer ikke forbi editoren heller: serveren sier nei. Trekkes tilgangen tilbake,
stopper både realtime og RPC-ene i samme øyeblikk, editoren lukkes, og verken
køen eller den lokale kopien blir liggende igjen på enheten. Autoritativt for
tabellen, policyen og RPC-ene:
[`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md).

**Tilstedeværelse er ÉN diskret indikasjon** — «Andre redigerer nå» i
verktøylinjen — og den leses av samskrivingen selv: kommer det en endring vi
ikke laget, er noen andre i gang. Det finnes ingen egen tilstedeværelseskanal og
ingen fjernmarkører. Indikasjonen navngir heller ingen: hvem som skriver er mer
enn lesetilgangen lover, og `note_updates.author_id` når aldri klienten.

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

**Koblingen er den ENKELTE brukerens egen.** Nå som notatene kan deles, kan
flere se det samme notatet — men koblingene fra det vises bare for den som lagde
dem. Den andre siden er ofte et privat område eller en privat liste, og en delt
kobling ville røpet både at objektet finnes og hva det heter. Å opprette en
kobling krever lesetilgang til BEGGE sider i det øyeblikket; den gir aldri
tilgang i seg selv.

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

**Begge er slippmål.** Drar man et objekt, folder BEGGE kassene seg ut — også
den tomme — og et slipp i arkivet arkiverer akkurat som et slipp i kassen
sletter. Det er det samme maskineriet med to betydninger og to farger
([`drag-and-drop.md`](drag-and-drop.md)).

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

Notatsiden har den SAMME rettighetsmodellen som områder og mapper — samme
rolletabell, samme invitasjonsflyt, samme capability-funksjoner, samme
delemodal. Autoritativt:
[`rettigheter-og-deling.md`](rettigheter-og-deling.md) **del 14**.

Det korte:

- **Alle tre nivåene kan deles.** Det er den ene bevisste forskjellen fra
  listesiden, og grunnen er at objektene ikke er de samme: en liste er en del av
  mappens struktur, mens et NOTAT er dokumentet — enheten folk faktisk vil dele.
- **Arven går én vei, nedover.** En rolle på bokhyllen gjelder notatbøkene og
  notatene i den; en rolle på notatboken gjelder notatene i den. Motsatt vei gir
  en rolle ingenting: den som har fått ett notat delt med seg, ser verken
  notatboken, bokhyllen eller navnene deres.
- **To roller, ikke tre.** `owner` og `member`. En ren LESER er et medlem av et
  LÅST objekt, akkurat som i listefanen — låsen er mekanismen, og den har den
  samme tretilstandsmodellen langs kjeden notat → notatbok → bokhylle.
- **Å arkivere er innhold, å slette er destruktivt.** Arkivet krever
  redigeringsrett; søppelkassen krever sletterett. Et rent DIREKTE medlem av et
  objekt kan aldri slette det for alle.
- **Flytting reparenter, den kopierer aldri.** Id-ene består, innholdet består,
  direkte roller består; tilgangen regnes om fra den nye forelderen. Det finnes
  ingen kryssdomene-kopiering på notatsiden.
- **«Delt med meg».** En notatbok eller et notat som er delt direkte uten at
  bokhyllen er lesbar, vises i én virtuell bokhylle — som frie mapper i
  listefanen. Bokhyllens navn lekker aldri.
- **En kobling er den enkelte brukerens egen.** Den gir aldri tilgang, den
  vises bare for eieren sin, og den blir stående (uåpnelig) hvis man mister
  tilgang til målet.

Rettighetene gjelder samskrivingen på nøyaktig samme måte som resten av
innholdet: den som kan redigere notatet kan skrive i loggen, den som bare kan
lese får live-oppdateringene og ingenting mer. Se «Sanntids samskriving».

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
  objektmenyen ([`menus.md`](menus.md)). Dra-til-kassen OG dra-til-arkivet
  virker på alle tre.
- **Søket er fortsatt ÉN funksjon.** Scopevalget er et filter over den samme
  indeksen, og `navigateToObject` bytter hoveddel selv — et treff virker
  uansett hvilken fane man står i.
- **Koblingene er en egen tabell med én fremmednøkkel per side**
  (`object_links`), ikke et felt på objektene. Databasen garanterer dermed at et
  koblingsmål finnes, og `on delete cascade` gjør en hengende kobling umulig.
  Raden har ingen mutable felter, så den har verken UPDATE-policy eller
  konfliktfletting — gravsteinene avgjør.
- **Deling var ikke med i dette steget.** Notatene hørte til kontoen alene, og
  koblingene var den enkelte brukerens egne krysshenvisninger. Delingen kom i
  PR 3A; koblingen er fortsatt den enkeltes egen.

Dekket av `tests/notes-lifecycle-links.test.js` (nettleser, desktop + mobil),
`supabase/tests/test-note-links.sql` (arkivregisteret, RLS mellom to brukere,
kaskadene, gravsteinene, kontosletting) og
`tests/notes-tab.test.js` som regresjonsvern for PR 1.

### PR 3A — Deling og rettigheter

**Mål:** Notatsystemet får en komplett, serverhåndhevet delingsmodell.

Omfang:

- deling av bokhylle, notatbok og notat, med roller, invitasjoner og
  capabilities i den EKSISTERENDE modellen;
- eksplisitt arv nedover, og ingen lekkasje oppover;
- eier / redaktør / ren leser;
- flytting mellom foreldre med ulike delingsforhold;
- tilbakekalling som rydder all underliggende tilgang;
- hva en kobling betyr når det ene objektet er delt og det andre ikke er det;
- flerbruker- og konfliktatferd, offline og synk;
- SQL-tester for serverkontrakten og nettlesertester på desktop og mobil;
- oppdatert autoritativ dokumentasjon.

Status: **gjennomført**.

Slik ble det:

- **Én modell, ikke to.** Notatsidens tre nivåer bruker den SAMME
  `memberships`-tabellen, de samme `share_invites`, de samme
  capability-funksjonene (`can_read`, `can_edit_content`, `can_delete_object`,
  `can_leave`, `can_manage_members` …) og den samme `#share-modal`-en. Utvidelsen
  er nye grener i de eksisterende funksjonene, ikke et parallelt system.
- **Alle tre nivåene kan deles**, og deling ligger i den VANLIGE objektmenyen på
  hvert av dem — ingen ny menytype ([`menus.md`](menus.md)).
- **Låsen lager leseren.** Ingen tredje rolle ble innført: notatobjektene fikk
  `locked`/`unlocked` og `invite_policy` som områder og mapper, og et medlem av
  et låst objekt ER en ren leser. Editoren blir da skrivebeskyttet, verktøylinjen
  skjult, og ＋-knappene og menyens skrive-rader forsvinner.
- **Å opprette spør FORELDEREN.** `can_create_child`/`can_create_note` er
  vilkåret i `notes_insert`/`note_folders_insert`, ikke eierskapet på raden —
  ellers kunne et medlem av en låst bokhylle lagt inn rader ingen kunne redigere.
- **Flytting reparenter.** `note_folders_before_update`/`notes_before_update`
  krever destruktiv myndighet i kilden og opprettelsesrett i målet; ingenting
  kopieres og ingen id endres. Kaskaden som drar notatene etter en flyttet
  notatbok er invarianten, ikke en flytting, og krever derfor ingen egen
  myndighet per notat.
- **«Delt med meg»** er én virtuell bokhylle for notatbøker og notater delt
  direkte, bygget av nøyaktig den samme mekanikken som «Mapper delt med meg».
  Den pushes aldri, og den kanoniske plasseringen skrives tilbake uendret.
- **Koblingen er brukerens egen.** Nå som flere kan se det samme notatet, kunne
  en delt kobling røpet både at et privat område finnes og hva det heter. Den
  vises derfor bare for sin egen eier; å opprette den krever lesetilgang til
  BEGGE sider, og tap av tilgang lar raden stå (uåpnelig) i stedet for å ødelegge
  den.
- **Ingen gjenoppstandelse.** En rad som forsvinner fra `get_my_doc` står i
  synk-basen og dropper derfor stille lokalt — den leses aldri som «laget her» og
  settes aldri inn igjen. Editoren lukkes hvis notatet var åpent.
- **Migrering:** hver bokhylle uten EN ENESTE rolle får oppretteren som eier.
  Kriteriet gjør backfillen naturlig idempotent og hindrer at en bevisst fjernet
  rolle kommer tilbake. Den pensjonerte, anonyme mål-sjekken på `memberships`
  og `share_invites` (den som bare teller område, mappe og liste) må være
  droppet FØR backfillen — se `docs/rettigheter-og-deling.md` del 14.

Dekket av `supabase/tests/test-note-sharing.sql` (fire brukere: roller og arv på
tre nivåer, ren leser, sletterett, flytting, tilbakekalling, uautoriserte
skrivinger, koblinger, gravsteiner, kontosletting) og
`tests/notes-sharing.test.js` (nettleser, desktop + mobil).

### PR 3B — Robusthet og polering

**Mål:** Gjøre Notater til en moden del av den mobile Huskis-opplevelsen.

Omfang:

- Android/Capacitor-regresjoner;
- tilgjengelighet og tastaturnavigasjon;
- endelig mobilpolering;
- å ÅPNE en lenke i et notat, sammen med mobilskallets ruting (PR 1 lot
  adressen ligge i `data-url` uten en vei ut).

Sanntids samarbeid i samme dokument inngår ikke. Import/eksport av notater som
filer inngår heller ikke: det er en faglig uavhengig funksjon med egne
produktspørsmål, og den viste seg ikke å være nødvendig for robusthetsarbeidet.
(Behovet den skulle dekke — å få notatet inn og ut av andre programmer — er nå
dekket av utklippstavlen; se PR 4 og «Utklippstavlen».)

Status: **gjennomført**.

Slik ble det:

- **Lenken har fått en vei ut, og det er ÉN vei.** `openExternalUrl()` i
  `app.js` er appens eneste utgående handling: `safeNoteUrl()` normaliserer på
  nytt, og `window.open(url, '_blank', 'noopener')` gjør resten. Kallet er
  BEVISST det samme i nettleseren og i mobilskallet — der står WebView-en uten
  støtte for flere vinduer, så `window.open` blir en vanlig navigasjon som
  Capacitors ruting sender ut som `ACTION_VIEW` og aldri laster inne i appen.
  Vakten mot utgående lenker er justert, ikke fjernet: den tillater nøyaktig
  denne ene forekomsten, på dette ene stedet, og KREVER at den finnes — i
  kilden, i `dist/` og i den synkede builden.
  Autoritativt: [`domains-and-urls.md`](domains-and-urls.md).
- **Escape og systemets tilbakeknapp går i den SAMME stigen.** Editoren hadde
  sin egen Escape-lytter i tillegg til `closeTopLayer`, og de to trakk i hver
  sin retning: et Escape i lenkefeltet lukket panelet, hendelsen boblet videre,
  og editorens lytter så to lukkede paneler og lukket hele bildet. Nå er
  panelet ett trinn i den felles stigen — så tilbakeknappen, som tidligere
  hoppet rett forbi panelene, gjør nøyaktig det samme som Escape.
- **Fokus overlever at noe forsvinner.** Editoren lukkes tilbake til
  NOTATKORTET man åpnet (ikke til breadcrumben), og å ARKIVERE flytter fokus
  som å slette alltid har gjort — til naboen, ellers til ＋-knappen. Notatkortet
  navngir seg selv i stedet for å la `role="button"` regne navnet ut av hele
  innholdet, og raden «Frie notater» har mistet malens navnløse menyknapp.
- **Berøringsflatene i editoren er 44 px**, som overalt ellers. Knappene tegnes
  fortsatt små (38 og 40 px) — seksten verktøy og femti tegn skal få plass uten
  å rulle — men luften mellom dem er nå nøyaktig det utvidelsen krever, så
  nabo-flatene møtes uten å dekke hverandre.
- **Panelene klemmes mot den SIKRE SONEN**, ikke mot skjermkanten, og både
  høyden og BREDDEN begrenses av det brukbare feltet. Et trykk utenfor lukker
  dem: på en kort skjerm legger spesialtegnpanelet seg over verktøylinjen, og
  da er knappen man åpnet det med ikke en vei ut.
- **«Sist endret» er blitt kort og norsk.** Chipen gikk utenom ordboken
  (`toLocaleString`) og tok en tredjedel av korthodet, så tittelen ble presset
  ned i en smal søyle. Nå leser den appens egen datovokabular: klokkeslettet i
  dag, «i går» i går, «9. sep» ellers — med hele tidspunktet i hjelpeteksten.
  Utdraget i en kasse-/arkivrad er kortet ned av samme grunn.

Dekket av `tests/note-link-open.test.js` (ny: alle tre veiene ut,
skjemavakten, lesemodus, at DOM-et fortsatt er uten `<a href>`),
og av nye seksjoner i `tests/notes-tab.test.js` (berøringsflater,
fokusgjenoppretting, kortets navn, datoformatet, trykk utenfor et panel),
`tests/notes-lifecycle-links.test.js` (fokus ved arkivering, «Frie notater»
uten meny, radutdraget), `tests/system-back.test.js` (panelet som eget trinn i
stigen) og `tests/safe-area.test.js` (editoren og panelene mot alle fire
kantene, og festet til det synlige feltet).

### PR 4 — Kopiering og innliming mellom Huskis og andre programmer

**Mål:** Få hele notatet ut av Huskis og inn i Word, Outlook, Google Docs, en
Markdown-editor eller et hvilket som helst riktekstfelt — og tilbake igjen —
uten å miste formatering.

Omfang: «Kopier alt» (`text/html` + `text/plain`), «Kopier som Markdown», og en
gjennomgang av innlimingen den andre veien. Filimport/-eksport inngår ikke, og
er ikke lenger et planlagt neste steg — se «Utklippstavlen» → «Filer».

Status: **gjennomført**. Hvordan det virker står i «Utklippstavlen», som er den
autoritative beskrivelsen; her er bare det som er verdt å vite om VALGENE:

- **Konverteringene er fire, hver med én retning**: dokument → HTML, dokument →
  ren tekst, dokument → Markdown, og fremmed HTML/tekst → dokument. Alle går ut
  fra den strukturerte modellen. Editorens DOM er verken lagrings- eller
  eksportformat, og det er grunnen til at ingenting Huskis-internt kan lekke ut:
  klassene, id-ene og `data-*`-attributtene finnes ikke i det som serialiseres.
- **Ett anker, ett sted.** Clipboard-HTML-en har `<a href>` fordi Word og
  Google Docs trenger det. Strengen settes aldri inn i appens eget DOM, og
  tekstvakten i `tests/capacitor-android.test.js` fritar nøyaktig denne ene
  forekomsten — og KREVER at den finnes, som fritaket for `window.open`
  ([`domains-and-urls.md`](domains-and-urls.md)).
- **Innsettingen ved innliming er nettleserens egen** (`insertHTML`), med markup
  Huskis har bygget fra sin egen modell. Det er derfor angre tar hele
  innlimingen i én operasjon, og derfor blokken markøren står i deles riktig.
- **Ingen Markdown-motor.** Innlimt tekst tolkes bare når den faktisk ser ut som
  Markdown, og bare på de kodene Huskis selv skriver ut.

Dekket av `tests/notes-clipboard.test.js` (ny: begge formatene, den semantiske
markupen, at ingenting internt lekker, farlige adresser, Markdown-formen,
randtilfellene, fallback-trinnene, innliming fra Word/Google Docs/rotete
markup/skript, og en EKTE kopier → lim inn-runde i et vanlig riktekstfelt), av
en ny sjekk i `tests/notes-sharing.test.js` (en ren leser beholder begge
kopieringsradene) og av de to nye påstandene i `tests/capacitor-android.test.js`
(ankeret finnes, står i `noteHtmlAnchor`, og normaliseres først).

### PR 5 — Sanntids samskriving i samme notat

**Mål:** To eller flere med skriverett kan ha det samme notatet åpent og skrive
samtidig, uten at den enes endringer overskriver den andres.

Omfang: en CRDT under den eksisterende editoren, en append-only logg i
databasen med serverhåndhevet tilgang, realtime + poll, offline-kø, komprimering
og en diskret tilstedeværelses-indikasjon.

Status: **gjennomført**. Hvordan det virker står i «Sanntids samskriving», som
er den autoritative beskrivelsen; her er bare det som er verdt å vite om
VALGENE:

- **Yjs, ikke en hjemmelaget tekst-CRDT.** Flettingen av samtidig tekst er den
  ene delen av dette som er lett å gjøre nesten riktig og vanskelig å gjøre
  riktig. Biblioteket ligger i `vendor/` som de to andre — en innsjekket kopi
  med versjonen i filnavnet, uten CDN og uten bundler for resten av appen
  ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)).
- **En BRO, ikke en ny editor.** Editoren er den samme `contenteditable`-en, og
  `noteDocFromEl()` er fortsatt den ene trakten inn. Broen leser modellen,
  sammenligner med CRDT-ens innhold og skriver bare forskjellen. Derfor er
  formatering, innliming, utklippstavle og lesemodus uendret, og derfor kunne
  hele runden gjøres uten å bygge om editoren.
- **Dokumentformatet består.** `{v, blocks}` er fortsatt appens dokument;
  CRDT-en er en FLAT utgave av det samme (ett listepunkt = én blokk), og
  konverteringen går begge veier uten tap. Et notat fra før runden sås
  deterministisk, så to klienter som åpner det samtidig ikke lager to kopier —
  ingen backfill, ingen nedetid.
- **Loggen er append-only.** Det er dét som gjør både samtidighet og reconnect
  trygt: en skriving kan aldri overskrive en annen, og en oppdatering kan brukes
  to ganger uten virkning. Den inkrementelle hentingen bruker
  `pg_snapshot_xmin`, ikke en sekvens, nettopp for at en rad som var underveis
  ikke kan hoppes permanent over.
- **Projeksjonen fikk en avgrenset rolle** i stedet for å bli fjernet:
  `notes.body` bærer søk, utdrag, utklippstavle og offline-kopi, og
  innholdsregisteret styrer tittel og livssyklusflaggene. Det er ikke to
  konkurrerende konfliktmodeller — det er ett dokument og én projeksjon av det.
- **Angre ble CRDT-ens.** Nettleserens egen angre-stabel overlever ikke at
  editoren males om når den andre skriver, og den ville uansett tatt tilbake
  endringer som ikke er mine.
- **Tilstedeværelse uten et tilstedeværelses-system.** Indikasjonen leses av
  samskrivingen selv, og navngir ingen: hvem som skriver er mer enn
  lesetilgangen lover.

Dekket av `tests/notes-collab.test.js` (ny: to nettleserkontekster som skriver
samtidig, ulike steder og overlappende, formatering samtidig med tekst, kort
nettbrudd + reconnect, lagringsstatusen, angre, ren leser, tilbakekalling,
sletting fra en annen klient, komprimering og migreringen av et notat fra før
runden — desktop og mobil), `supabase/tests/test-note-collab.sql`
(serverkontrakten) og en ny vakt i `tests/db-contract.test.js` for at
samskrivingsloggen faktisk ligger i realtime-publikasjonen.

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
| PR 3A — Deling og rettigheter | **Gjennomført** |
| PR 3B — Robusthet og polering | **Gjennomført** |
| PR 4 — Kopiering og innliming | **Gjennomført** |
| PR 5 — Sanntids samskriving | **Gjennomført** |

**Leveranseplanen er gjennomført.** Notatene er en hel del av appen: de kan
deles på alle tre nivåene med den samme serverhåndhevede modellen som listene,
flere kan skrive i det samme notatet samtidig, de har arkiv og søppelkasse, de
finnes i det felles søket, de kan kobles til listesiden, og de oppfører seg som
resten av appen på telefon — tastatur, fokus, berøringsflater, den sikre sonen
og systemets tilbakeknapp.

**Det som gjenstår er egne leveranser, ikke restarbeid:**

- `object_links` kan bære flere typer per side enn de seks som finnes i dag —
  men bare de seks er koblingsbare nå.
- Samskrivingen viser AT noen andre skriver, ikke HVOR. Fjernmarkører med navn
  og farge ville krevd en egen tilstedeværelseskanal og en avklaring av hvem som
  får se hvem — et eget produktvalg, ikke restarbeid.

**Import/eksport av notater som filer er IKKE et neste steg.** Utklippstavlen
dekker det brukeren faktisk trenger — notatet ut i et annet program og inn igjen
— og en filflyt ville lagt til et dokumentformat, en nedlasting og en filvelger
uten å løse mer. Se «Utklippstavlen» → «Filer».
