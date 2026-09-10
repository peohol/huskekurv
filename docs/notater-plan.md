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
«Kopier alt», «Kopier som Markdown», «Historikk», «Arkiver» og «Slett». Ingen egen popover-type ble innført —
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
sår CRDT-en fra dokumentet, og frøet er DETERMINISTISK: klient-id-en er en
funksjon av innholdet, så to klienter som sår fra det samme dokumentet lager
bit-identiske operasjoner. De to frøene er da den samme operasjonen og flettes
til én — ikke til to kopier av notatet. Migreringen krever derfor ingen backfill
og ingen nedetid.

**ET FRØ SÅS BARE I EN TOM LOGG.** Determinismen dekker to som sår det samme;
den kan ikke dekke en enhet som sår et notat noen ALT har sådd og skrevet videre
i, for da er innholdet et annet. Derfor er frøet bare en foreløpig lokal
antagelse til den første hentingen har svart: har loggen rader, kastes frøet og
økten bygges av radene (det som ble skrevet i mellomtiden skrives inn som en
vanlig forskjell); er loggen tom, er frøet det første — med det som er skrevet
oppå det — og køes.

**Det er PUBLISERINGEN som venter, ikke skrivingen.** Lokalt er økten helt
vanlig hele tiden: angre, formatering og lagring virker fra første tastetrykk.
Så lenge svaret ikke har kommet, køes ingenting til loggen og ingen lokal kopi
skrives. Det gjelder også et NYTT notat, der raden ennå ligger i synk-køen og
første henting derfor svarer «finnes ikke» — uten dette ville et ferskt notat
stått uten angre de første sekundene.

**Rakk noen å skrive før svaret kom, er spørsmålet hva tegnene er en forskjell
FRA.** Frøet ble sådd av projeksjonen, og den kan ligge etter loggen: en annen
kan ha skrevet et avsnitt som ennå ikke har nådd oss. Er projeksjonen lik
serverens dokument, ER forskjellen mellom arket og det dokumentet nøyaktig
tastetrykkene, og de skrives inn som en vanlig endring. Er den det IKKE, ville
den samme forskjellen lest den andres avsnitt som en SLETTING — og neste
skriving ville fjernet det for alle. Da vinner serverens dokument, og det som
ble skrevet legges i HISTORIKKEN i stedet for å bli borte. Det er den ene
plassen der de to funksjonene i denne runden henger sammen: historikken er
sikkerhetsnettet under samskrivingen.

**Og det nettet holder også når nettet ikke gjør det.** I det øyeblikket er
utkastet den ENESTE kopien: CRDT-en er byttet ut, og projeksjonen skrives over
av serverens dokument rett etterpå. Å sende det med ett kall og håpe ville gjort
et tapt svar til stille datatap i nettopp det som skal hindre datatap. Utkastet
legges derfor i en HOLDBAR KØ i enhetens lagring FØR noe kastes, køen tømmes på
den vanlige synk-runden, og raden fjernes først når serveren har bekreftet
bildet. Køen har INGEN øvre grense — hver rad er den eneste kopien av noe
brukeren har skrevet, og et tak måtte kastet den eldste — og forsøket på nytt
bruker køradens egen id, så et bilde serveren alt har lagret ikke legges inn en
gang til. Køen ryddes som resten av notatlagringen: ved utlogging, og for et
notat når tilgangen til det forsvinner.

**Og sier enhetens lagring nei, ofres hurtigbufferen for utkastet — men bare
den delen som VIRKELIG er en hurtigbuffer.** En lokal kopi av CRDT-en er noe
serveren har, så lenge alt som er laget mot den har nådd fram. Står det rader
igjen i køen for det notatet, er de laget mot nettopp dette dokumentets
identiteter: kastes dokumentet, peker de på noe ingen har, og de kan aldri
flettes inn. De notatene røres derfor ikke, og et strandet utkast får aldri
koste et annet notats offline-endringer. Finnes det ingenting som trygt kan
ryddes, feiler skrivingen — og da kastes ingenting i det hele tatt.

**Går det fortsatt ikke, kastes INGENTING.** Uten en holdbar destinasjon —
verken enheten eller kontoen — blir hele overgangen stående: økten er fortsatt
foreløpig, arket beholder teksten, ingenting publiseres, og neste runde prøver
igjen. Toasten sier da at teksten ikke er lagret ennå, ikke at den er tatt vare
på. Det er den samme regelen som ellers, tatt helt ut: den eneste kopien slippes
aldri før noe holdbart har tatt imot den.

**Lukkes notatet mens overgangen står, LUKKER APPEN IKKE.** Arket er den eneste
kopien, og å lukke ville vært å kaste den selv. Utkastet legges i køen først;
lot det seg ikke gjøre holdbart, blir editoren stående, og brukeren får velge
«Lukk likevel». Da er tapet et valg, ikke noe som skjer i det stille. Et nytt
forsøk på å lukke legger ikke inn utkastet en gang til. Så snart lagringen
virker igjen, skriver neste synk-runde køen ned av seg selv.

**Arkiver og papirkurv går IKKE utenom.** De legger notatet bort, og skal ikke
bety «kast det jeg nettopp skrev»: begge går gjennom den samme lukkingen — de
henger på hvert sitt sted i objektmenyen, så begge er dekket av hver sin
regresjon — og avvises lukkingen, avvises handlingen med. Velger brukeren «Lukk likevel», kjøres
handlingen etterpå, som hen ba om. Det ene unntaket er reelt tilgangstap — der
har vi ikke lov til å beholde innholdet uansett.

At overgangen kan bli stående, er grunnen til at «er loggen tom?» avgjøres av
ALLE radene økten har sett, ikke av hva den siste hentingen hadde med seg.
Hentingen legger radene i økten og flytter merket før den spør, så en runde som
ikke fullfører ville sett en tom leveranse neste gang — og lest den som en tom
logg. Da ville det foreløpige dokumentet blitt sådd inn i en logg som alt hadde
rader, altså nøyaktig doblingen frøet finnes for å hindre.

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

## Historikk

Samskrivingen gjorde ÉN ting umulig som var mulig før den: å ta tilbake noe.
Angre er CRDT-ens egen og tar per definisjon bare MINE endringer — sletter
medforfatteren min et avsnitt, er det ikke min angring som skal hente det
tilbake — og loggen klappes sammen så snart den blir lang. Historikken er
stedet det finnes igjen.

**Et bilde er dokumentet, ikke CRDT-tilstanden.** Hver rad i `note_versions` er
tittelen og hele dokumentet i appens egen strukturerte form. To grunner: et
bilde skal kunne LESES uten å laste CRDT-en, og en gjenoppretting skal ikke
være en overskriving.

**Bildene tas av tilstander som faktisk fantes** — ved åpning (FØR man rekker å
endre noe), med jevne mellomrom mens man skriver, ved lukking, når historikken
åpnes, og rett før en gjenoppretting. Åpningsbildet er det viktigste: uten det
ville et notat som ble tømt og lukket i løpet av et halvt minutt aldri hatt en
rad å hente fra.

**Og bare av en AVKLART tilstand.** Projeksjonen alene kan ikke svare på hva som
gjelder nå: den kan ligge etter loggen, og et bilde derfra ville lagt gammelt
innhold inn med NÅ-tidspunkt og stått øverst i historikken som «Nå».
Åpningsbildet tas derfor når frøet er avgjort, ikke idet editoren åpnes — og er
loggen TOM, beholdes det foreløpige dokumentet, som da alt inneholder det
brukeren rakk å skrive. Dokumentet hentes i det tilfellet fra grunnlaget frøet
ble sådd FRA; har loggen rader, er serverens dokument det autoritative. TITTELEN
er uansett den fra ÅPNINGEN, uavhengig av hvor dokumentet kommer fra: rakk
brukeren å endre den mens hentingen sto på, ville bildet ellers blitt en
blanding — gammelt dokument, ny tittel.

Er notatet lukket — historikken åpnes rett fra kortet — bygges dokumentet av
loggens rader OG av enhetens egne: den lokale kopien og radene som ennå ikke er
levert. Uten dem ville serverens eldre dokument blitt lagret som en fersk «Nå».
CRDT-oppdateringer er kommutative, så alt legges i det samme dokumentet uten at
rekkefølgen betyr noe. Finnes ingen av delene, er projeksjonen notatet, for det
er aldri sådd. Ved lukking tas bildet av projeksjonen, som nettopp er skrevet:
å lese økten ville betydd en flush, og en flush er en skriving.

**Serveren avviser dubletter.** Et bilde med samme tittel og samme dokument som
det ferskeste blir ingen ny rad — så et notat som åpnes og lukkes uten en eneste
endring legger ikke igjen noe, og to enheter som ber om det samme bildet ender
med ett. Det er dét som gjør at klienten kan be så ofte. Sammenligningen er
serialisert per notat, ellers ville to samtidige forespørsler begge sett den
samme forrige raden og lagt inn hver sin.

**En gjenoppretting har to forutsetninger, og gjøres ikke uten dem.** Økten for
notatet må være AVKLART — står den på et foreløpig frø, ville endringen blitt
lest som strandet når radene kom, serverens dokument ville vunnet, og brukeren
fått «gjenopprettet» uten at noe var gjenopprettet. Og tilstanden slik den er NÅ
må ligge i historikken først, ellers er gjenopprettingen en enveisdør. Går ikke
det bildet gjennom, gjøres ingenting, og beskjeden sier hvorfor.

**En gjenoppretting er ellers en vanlig endring.** Bildet skrives inn ved at
FORSKJELLEN mellom det og dokumentet legges i CRDT-en, som et hvilket som helst
tastetrykk. Derfor fletter den mot en som skriver samtidig, derfor virker den
offline, og derfor kan den angres — fra toasten der og da, eller senere gjennom
historikken, siden tilstanden fra FØR gjenopprettingen alltid tas vare på først.
Står editoren lukket, åpnes den: CRDT-en er dokumentets ene sanne sted, og en
skriving inn i den krever en levende økt.

**Historikken rydder seg selv, og serveren bestemmer.** Alt fra den siste timen
står, det siste døgnet tynnes til ett bilde per time, eldre til ett per døgn, og
til slutt gjelder et hardt tak på antall rader. Et bilde brukeren har MERKET
(«Behold denne») står utenfor alle fire — det er hele meningen med å merke ett —
og taket på antall merker håndheves ved merkingen, der brukeren kan velge hvilket
som skal vike.

**UI-et er én modal og én rad.** «Historikk» i notatets objektmeny åpner
`#note-history-modal`: radene er et trekkspill der hodet er tidspunktet (appens
egen datoordbok), tegntallet og et utdrag, og den åpne raden viser hele
dokumentet skrivebeskyttet — rendret node for node av den samme funksjonen
editoren bruker, aldri som markup. Tegntallet er der for det ene tilfellet
historikken finnes for: raden som er MYE kortere enn den før den er den man
leter etter. Den åpne raden har i tillegg en bryter mellom hele versjonen og
ENDRINGENE mot notatet slik det er nå — se «Versjonssammenligning».

**Historikken er ANONYM**, som loggen: `note_versions.author_id` når aldri
klienten. Hvem som skrev hva i et delt notat er mer enn lesetilgangen lover.

**Tilgangen håndheves serverside.** Klienten har ikke engang en grant på
tabellen; alt går gjennom fire SECURITY DEFINER-RPC-er. Å BLA krever
`can_read_note` — et øyeblikksbilde er notatets eget innhold — og å skrive, merke
eller gjenopprette krever `can_edit_content`. En ren LESER får derfor listen og
forhåndsvisningen og ingenting mer. Autoritativt for tabellen, policyen,
uttynningen og RPC-ene:
[`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md).

**Uten nett tas ingen bilder.** Et bilde er en rad på kontoen, og en kø av dem
ville vært enda en kopi av innholdet i enhetens lagring. Enheten som er borte
mister bare tettheten i historikken, aldri innhold — dokumentet lever i CRDT-en
og i projeksjonen som før — og neste bilde tas så snart nettet er tilbake.
Modalen sier det i klartekst i stedet for å stå tom.

Det ene unntaket er et STRANDET UTKAST (se «Sanntids samskriving»): der er
bildet den eneste kopien, og da køes det på enheten til serveren har bekreftet
det. Regelen over gjelder alt annet — det er forskjellen på et bilde vi kan ta
igjen senere og et vi ikke kan.

## Versjonssammenligning

Historikken svarte på HVA notatet inneholdt. Den svarte ikke på hva som er
ANNERLEDES nå — og det er dét man lurer på rett før man gjenoppretter:
forsvant avsnittet mitt, eller ble det bare flyttet?

**Det er den samme raden og den samme modalen.** Åpner man en historikkrad,
står det en segmentert bryter øverst i den — appens egen `.seg`, den samme som
Lister ↔ Notater og søkets scopevalg — med to visninger: **«Hele versjonen»**,
som før, og **«Endringer»**. Ingen ny modal, ingen ny kontrolltype. Valget
følger MODALEN, ikke raden: den som sammenligner én versjon vil som regel
sammenligne den neste også.

**Endringene vises i HELE notatet, ikke som løsrevne biter.** Det som kom til
siden versjonen er grønt og understreket, det som falt bort er rødt og
gjennomstreket, og det som bare byttet formatering har en stiplet strek i
notatgult. Det uendrede står med, dempet — uten det kunne man ikke se HVOR i
notatet endringen skjedde. Øverst står en oppsummering («2 lagt til, 1 skrevet
om»), fordi tallene sier om det er verdt å lete.

**Retningen er fast:** den valgte versjonen er FØR, notatet slik det er nå er
ETTER. «Lagt til» betyr derfor «kom til etter denne versjonen».

**To endringer kan ikke SES i teksten, og får ord i stedet.** En blokk som
byttet type står med «avsnitt → overskrift 2» — diffen viser den nye siden, så
et avsnitt som ble en overskrift ser bare ut som en overskrift. Og en blokk som
bare byttet PLASS står med «Flyttet» begge steder, dempet i stedet for rødt og
grønt: ingenting ble borte.

**Fargen er aldri den eneste bæreren.** Hver endret linje har en usynlig
merkelapp foran seg som skjermleseren leser først («Lagt til: …»), det som kom
til ligger i `<ins>` og det som falt bort i `<del>`, og strek-under mot
strek-gjennom skiller de to også uten farge. Bryteren er en `tablist` med
piltaster og 44 px berøringsflate, og fokus blir stående på den kontrollen man
trykket når listen males om — ikke på radhodet.

**En formateringsendring sier hvilken VEI den gikk** — «fet lagt til», «lenke
fjernet», «lenke endret» — og den står som en usynlig merknad rett etter biten
den gjelder, ikke bare i hjelpeteksten. Den som ser skjermen kan lese seg til
retningen av at teksten ikke lenger ER fet; den som ikke ser den har bare denne
setningen, og «ny formatering: fet» ville da sagt det motsatte av det som
skjedde.

### Hvordan diffen regnes ut

**Sammenligningen går på DOKUMENTMODELLEN** (`{v, blocks}`), aldri på editorens
DOM eller på generert HTML. Modellen er den ene formen begge sidene finnes i:
et bilde i historikken ER modellen. En diff på markup ville dessuten sett
formatering og struktur som tekst.

**Enheten er den FLATE blokken** — `noteDocToFlat`, den samme oppdelingen
samskrivingen bruker: ett avsnitt, én overskrift, én skillelinje eller ETT
LISTEPUNKT per rad. Da er et listepunkt som ble lagt til én endring, ikke «hele
lista er endret».

**Tre lag, og rekkefølgen er poenget:**

1. **Blokkene** mot hverandre, med type + tekst som nøkkel — ikke markeringene,
   så et avsnitt som bare ble fett kjennes igjen som det samme avsnittet. Små
   biter sammenlignes eksakt (LCS med tabell); store ankres på blokker som
   finnes ÉN gang på hver side og deles opp der (patience-metoden). Det er dét
   som hindrer at en setning lagt til øverst skyver resten ut av takt og maler
   hele notatet som endret.
2. **Paring:** en slettet og en innsatt blokk som ligner nok på hverandre er
   ikke to blokker — det er ÉN som ble skrevet om. Likheten måles på ord; er
   den korteste siden på et par ord, måles TEGNENE i stedet, for «Melk» og
   «Melkesjokolade» deler ikke ett eneste ord. Tegnlikheten er snever med vilje
   (tegnene må dekke det meste av den korteste siden): to setninger uten noe
   med hverandre å gjøre deler likevel en mengde bokstaver.
3. **Ordene** inne i det parede. Markeringen er en egenskap ved TEGNENE, ikke
   ved kjøringen de ligger i — å gjøre ett ord fett deler én kjøring i tre uten
   å endre ett eneste tegn — så teksten sammenlignes for seg, og markeringene
   leses etterpå over de samme tegnene. Ord som står igjen på begge sider med
   ulik markering er en FORMATERINGSENDRING, ikke en omskriving.

**Flytting er det som blir igjen:** en slettet og en innsatt blokk med nøyaktig
samme innhold, i hver sin ende av notatet, er den samme blokken flyttet.

**Tittelen sammenlignes for seg**, ord for ord med den samme motoren — den er
et navn, ikke en blokk, og flettes som navn (se «Sanntids samskriving»).

**Ingen ny avhengighet.** Alt over er noen få hundre linjer i `app.js`, bygget
på dokumentmodellen som allerede fantes.

### Hva som regnes som «Nå»

**Den samme autoritative tilstanden resten av historikken bygger på**, lest med
den samme funksjonen: `noteAuthoritativeState` gir enten den ÅPNE øktens CRDT
(når frøet er avklart), eller — for et lukket notat — loggens rader PLUSS
enhetens lokale kopi PLUSS det som ennå ligger i `noteOps`-køen. Projeksjonen
(`notes.body`) brukes bare der notatet aldri er sådd. Ingen egen utregning ved
siden av den historikken selv hviler på.

Lesingen skjer hver gang modalen henter listen, rett før bildet av
nå-tilstanden tas — men som en EGEN lesing, med vilje. Bildet leser tilstanden
inne i sin egen serialiserte kjede, slik at raden som legges inn alltid er den
ferskeste; den regelen røres ikke. Og en ren LESER tar ikke noe bilde i det hele
tatt, men skal likevel kunne sammenligne.

**Og «nå» må være nå, også en stund etter at modalen åpnet.** En medforfatter
kan skrive mens historikken står oppe: da oppdaterer live-hentingen editoren
uten at noe rører modalen, og listen hentes bare på nytt av en SKRIVING
(gjenoppretting, merking) — som en ren leser ikke har. Tilstanden leses derfor
på nytt hver gang brukeren BER om sammenligningen: når «Endringer» velges, og
når en rad åpnes mens den visningen står. Er den uendret, males ingenting om;
en ommaling for ingenting ville flyttet fokus ut av kontrollen man nettopp
brukte.

Var økten uavklart da listen ble hentet, dekkes det av den samme lesingen; går
det fortsatt ikke, sier visningen det i klartekst i stedet for å vise en diff
mot noe utdatert.

**Diffen SKRIVER INGENTING.** Den leser to dokumenter og bygger noder — den
rører verken CRDT-en, projeksjonen, loggen, historikken eller synk-køen, og den
inngår ikke i en gjenoppretting: å gjenopprette gir fortsatt nøyaktig den
valgte versjonen, gjennom CRDT-en som før.

### Rettigheter og personvern

Å se en forskjell er LESING, og krever nøyaktig den lesetilgangen historikken
selv krever (`can_read_note`). En ren LESER får derfor bryteren og
sammenligningen, og fortsatt verken «Gjenopprett», «Behold denne» eller «Lagre
versjon nå» — og legger ikke igjen et eneste bilde ved å bla. Ingen nye
RPC-er, ingen nye tabeller, ingen nye grants: diffen regnes ut av det klienten
allerede har lov til å hente.

**Og den er ANONYM, som resten av historikken.** Den sier hva som er
annerledes, aldri hvem som gjorde det: `author_id` når fortsatt aldri klienten,
og det finnes verken fjernmarkører eller mer detaljert tilstedeværelse.

### Testdekning

`tests/notes-version-diff.test.js` er den autoritative testen, og den har to
halvdeler.

**Algoritmen stilles som RENE funksjonskall** — `noteDocDiff` og
`noteTitleDiff` er funksjoner av to dokumenter, så hvert randtilfelle kan felles
for seg: identiske dokumenter, tomt dokument på én og på begge sider, rent
tillegg, ren sletting, endring inne i én blokk, tittel, formatering (også når
markeringen deler en kjøring i tre uten å endre ett eneste tegn), en lenke som
peker et nytt sted, punktliste og nummerert liste, flere endringer samtidig, en
blokk som ble flyttet (og et TOMT avsnitt som ikke påstås flyttet), overskrifter,
skillelinje, en blokk som byttet type, ett ord som ble til en setning, to korte
blokker som bare deler bokstaver — og at en setning lagt til øverst i et notat
på 40 linjer lar de 40 stå urørt.

**UI-et kjøres i ekte nettleser, desktop OG mobil:** bryteren og at raden
starter på hele versjonen, endringene tegnet node for node, oppsummeringen,
merkelappen skjermleseren leser først, RETNINGEN på en formateringsendring
(lagt til, fjernet, byttet), 44 px berøringsflate, piltastene,
`tablist`-semantikken, at fokus blir stående på kontrollen man trykket og følger
VALGET ved piltast, at det ikke skrives verken i loggen, i historikken eller i
notatet av å sammenligne, at en gjenoppretting fortsatt gir nøyaktig den valgte
versjonen, og at markeringene henter fargen fra drakten i både lys og mørk.

**Og de fire tilfellene der «Nå» er det vanskelige:** historikk åpnet fra et
LUKKET notat, «Nå» med enhetens usendte kø (leveringen nektes, så køen blir
stående mens historikken kan hentes), en medforfatter som skriver MENS
sammenligningen står åpen (testen rører aldri listen — den bytter visning, som
en bruker gjør), og en ren leser som ser diffen uten å få skriverettigheter,
uten å legge igjen et bilde, og som likevel ser det som kom til etter at
modalen åpnet. Tilbakekalt tilgang midt i en sammenligning lukker historikken.

Regresjonene fra historikk-runden står uendret i `tests/notes-history.test.js`,
`tests/notes-collab.test.js` og `tests/notes-sharing.test.js`.

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

### PR 6 — Historikk: å ta tilbake noe som ble borte

**Mål:** Et notat skal kunne føres tilbake til en tidligere tilstand — også når
det var noen andre som fjernet innholdet.

Omfang: en historikk-tabell med serverhåndhevet tilgang og egen uttynning,
bilder som tas av tilstander som faktisk fantes, en modal med
forhåndsvisning, gjenoppretting gjennom CRDT-en, merking av bilder man vil
beholde, og regresjonsvern for samskrivingen selv.

Status: **gjennomført**. Hvordan det virker står i «Historikk», som er den
autoritative beskrivelsen; her er bare det som er verdt å vite om VALGENE:

- **Historikken er et ANDRE lag, ikke en utvidelse av loggen.** Loggen
  (`note_updates`) er append-only nettopp for å kunne klappes sammen, og
  komprimeringen sletter radene den folder inn. Å gjøre den om til et arkiv
  ville betydd å slutte å komprimere, altså å la den vokse uten grense i det
  ene notatet folk skriver mest i. Bildene ligger derfor i sin egen tabell, med
  sin egen opprydning.
- **Bildet er dokumentmodellen, ikke Yjs-binæret.** Det kan leses uten å laste
  CRDT-en (forhåndsvisningen er den samme rendringen som editoren bruker), det
  overlever en framtidig bytting av CRDT-bibliotek, og det gjør en
  gjenoppretting til en helt vanlig redigering: klienten skriver FORSKJELLEN
  inn i CRDT-en. Det er dét som gjør at en gjenoppretting fletter mot en som
  skriver samtidig, virker offline og kan angres.
- **Serveren eier dubletthåndteringen.** Et fingeravtrykk av tittel + dokument
  gjør skrivingen idempotent mot det ferskeste bildet. Uten den måtte klienten
  ha gjettet på når «nok» hadde endret seg — og to enheter ville lagt inn hvert
  sitt bilde av den samme tilstanden.
- **Uttynningen er serverens.** Tallene ligger i databasen, ikke i klienten: en
  klient som ber om noe annet skal ikke kunne flytte grensen. Merkede bilder
  står utenfor uttynningen, og taket på antall merker håndheves ved merkingen —
  der brukeren er til stede og kan velge hvilket som skal vike, i stedet for at
  noe forsvinner stille.
- **Historikken er anonym**, som loggen. Å vise hvem som skrev hva ville vært et
  eget produktvalg om hvem som får se hvem, ikke en detalj i denne runden.
- **En feil i frøet ble rettet i samme runde.** Et frø sådd av `body` inn i en
  logg som ALT var sådd, la hele notatet inn en gang til — en enhet som åpnet et
  delt, samskrevet notat for første gang fikk dobbelt innhold. Frøet er nå en
  foreløpig antagelse til serveren har sagt om loggen er tom, og klient-id-en
  er avledet av innholdet, slik at to ulike frø aldri kan havne i det samme
  (klient, teller)-rommet. Det LOKALE dokumentet venter aldri på svaret — bare
  publiseringen gjør det — for ellers ville et ferskt notat stått uten angre
  til raden hadde synket. Og rakk noen å skrive i vinduet, avgjør en
  sammenligning mot grunnlaget om tegnene kan flettes inn eller må legges i
  historikken; en forskjell mot serverens dokument ville ellers lest den andres
  avsnitt som en sletting. Rettelsen hører hjemme her fordi gjenopprettingen
  står på nøyaktig det fundamentet — og fordi historikken er sikkerhetsnettet
  som gjør det siste valget mulig uten å miste noe.

Dekket av `tests/notes-history.test.js` (ny: bildene ved åpning og lukking,
dubletthåndteringen, modalen, forhåndsvisningen, gjenoppretting gjennom CRDT-en
med loggen som vokser, angring fra toasten, gjenoppretting MENS en annen
skriver, en ren leser, tilbakekalling, uten nett, merking — og fem regresjoner
som hver feiler uten sin rettelse: den doblede teksten ved første åpning, det
ferske notatet uten angre, den utdaterte projeksjonen som ikke får slette den
andres avsnitt (også med lagringen av utkastet tvunget til å feile, så køen på
enheten er bevist), de 25 ubekreftede utkastene der ingen kastes, forsøket på
nytt som gir én historikkrad og ikke to, overgangen som blir stående når BÅDE
enhetens lagring og serveren sier nei — også når notatet forsøkes lukket mens
den står — den lokale kopien til et notat med usendte endringer som aldri
ryddes, den utdaterte projeksjonen som ikke får bli et falskt «Nå»,
gjenopprettingen fra et lukket kort som faktisk blir gjeldende,
gjenopprettingen som ikke skjer når bildet av tilstanden før feiler,
åpningsbildet som er tilstanden FØR redigeringen — tittelen med, både når loggen
er tom og når den har rader — «Nå» som teller enhetens egen kø, og arkiveringen
og papirkurven som ikke går utenom vakten; desktop og mobil),
`supabase/tests/test-note-versions.sql` (serverkontrakten: grants, policy,
fingeravtrykk, ren leser, utenforstående, merking og tak, alle fire lagene i
uttynningen, tilbakekalling, kaskade og kontosletting),
`supabase/tests/test-note-version-race.sh` (to ekte tilkoblinger: to enheter som
tar bilde av den samme tilstanden samtidig ender med ett bilde) og en ny
RPC-vakt i `tests/db-contract.test.js`.

### PR 7 — Versjonssammenligning: hva er annerledes nå?

**Mål:** Den som ser en historikkversjon skal ikke bare kunne LESE hva notatet
inneholdt, men tydelig se hva som er forskjellig fra notatet slik det gjelder
nå — før hen eventuelt gjenoppretter.

Omfang: en diff på dokumentmodellen, en visningsbryter i den eksisterende
historikkraden, og regresjonsvern for at «Nå» fortsatt er den autoritative
tilstanden.

Status: **gjennomført**. Hvordan det virker står i «Versjonssammenligning», som
er den autoritative beskrivelsen; her er bare det som er verdt å vite om
VALGENE:

- **Ingen ny modal og ingen ny kontrolltype.** Sammenligningen er en ANDRE
  VISNING av raden som allerede fantes, valgt med appens egen segmenterte
  bryter. En egen «sammenlign»-modal ville betydd en ny plass å navigere til,
  en ny fokusfelle og en ny måte å lukke noe på — for det samme innholdet.
- **Diffen går på dokumentmodellen, ikke på DOM eller HTML.** Modellen er den
  ene formen begge sidene finnes i, den er stabil, og den kjenner forskjell på
  struktur og tekst. En diff på markup ville lest en tom `<br>` som en endring.
- **Ingen tung avhengighet.** Tre lag — blokker, paring, ord — bygget på
  dokumentmodellen som allerede fantes. Den eksakte sammenligningen er
  kvadratisk og brukes bare på små biter; store dokumenter ankres på blokker
  som finnes én gang på hver side. Et bibliotek ville kostet mer enn det løste,
  og ville uansett ikke kjent Huskis' egen modell.
- **Markeringen er en egenskap ved TEGNENE.** Å gjøre ett ord fett deler én
  kjøring i tre uten å endre ett eneste tegn; leses markeringen som en egenskap
  ved kjøringen, blir «nøkkelen.» og «nøkkelen» + «.» to ulike ord, og en ren
  formateringsendring står som slettet og lagt til igjen. Teksten sammenlignes
  derfor for seg, og markeringene leses over de samme tegnene.
- **«Nå» leses med `noteAuthoritativeState`** — den samme funksjonen
  historikken alt hvilte på, ikke en parallell utregning, og aldri projeksjonen
  alene. Lesingen er likevel EGEN, ikke gjenbrukt fra bildet som tas: bildet må
  lese inne i sin egen serialiserte kjede for å være det ferskeste, og en ren
  leser tar ikke noe bilde i det hele tatt, men skal likevel kunne
  sammenligne.
- **Diffen er en VISNING.** Den skriver ingenting, og den inngår ikke i en
  gjenoppretting: å gjenopprette gir fortsatt nøyaktig den valgte versjonen.
- **Forfatteren er fortsatt ikke med.** Å vise HVEM som gjorde endringen er det
  samme produktvalget som før — hvem som får se hvem — og hører ikke til her.

Dekket av `tests/notes-version-diff.test.js` (ny: de elleve randtilfellene i
algoritmen som rene funksjonskall — identisk, tomt på én og begge sider, rent
tillegg, ren sletting, endring inne i en blokk, tittel, formatering, lenke,
lister, flere samtidig, flytting, overskrift, skillelinje, blokk som byttet
type, og at en endring tidlig ikke maler resten av notatet som endret — pluss
UI-et: bryteren, endringene tegnet node for node, berøringsflaten, piltastene,
fokus som overlever ommalingen, at det ikke skrives noe som helst av å
sammenligne, at gjenoppretting fortsatt gir den valgte versjonen, lys og mørk
drakt, historikk fra et lukket notat, «Nå» med enhetens usendte kø, samskriving
mens historikken står åpen, en ren leser, og tilbakekalt tilgang midt i en
sammenligning; desktop og mobil), og av regresjonene i
`tests/notes-history.test.js`, `tests/notes-collab.test.js` og
`tests/notes-sharing.test.js` som står uendret.


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
| PR 6 — Historikk | **Gjennomført** |
| PR 7 — Versjonssammenligning | **Gjennomført** |

**Leveranseplanen er gjennomført.** Notatene er en hel del av appen: de kan
deles på alle tre nivåene med den samme serverhåndhevede modellen som listene,
flere kan skrive i det samme notatet samtidig, det som ble borte kan hentes
tilbake fra historikken — og man ser hva som er annerledes før man gjør det —
de har arkiv og søppelkasse, de finnes i det felles søket, de kan kobles til
listesiden, og de oppfører seg som resten av appen på
telefon — tastatur, fokus, berøringsflater, den sikre sonen og systemets
tilbakeknapp.

**Det planlagte arbeidet med Notater er dermed FULLFØRT.** Det finnes ikke et
teknisk neste steg i denne planen — ingen halvferdig del, ingen kjent mangel som
venter på en runde til. Kommer det mer, er det fordi noen tar et nytt
PRODUKTVALG, ikke fordi noe står igjen.

**Tre ting er bevisst UTENFOR, og er ikke restarbeid:**

- `object_links` kan bære flere typer per side enn de seks som finnes i dag —
  men bare de seks er koblingsbare nå. En syvende type er et produktvalg om hva
  det gir mening å koble, ikke en manglende implementasjon.
- Samskrivingen viser AT noen andre skriver, ikke HVOR, og historikken og
  versjonssammenligningen viser HVA notatet inneholdt og hva som er annerledes
  — aldri HVEM. Å navngi noen krever en avklaring av hvem som får se hvem: et
  eget produktvalg om personvern i delte notater.
- Import/eksport av notater som FILER. Se under.

**Import/eksport av notater som filer er IKKE et neste steg.** Utklippstavlen
dekker det brukeren faktisk trenger — notatet ut i et annet program og inn igjen
— og en filflyt ville lagt til et dokumentformat, en nedlasting og en filvelger
uten å løse mer. Se «Utklippstavlen» → «Filer».
