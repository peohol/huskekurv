# Varsler

Les denne når oppgaven berører bjelleknappen, varselmodalen, hva som blir et
varsel, eller hvordan varselhistorikken lagres og synkes.

Fire ting bor her, og de er bevisst skilt:

1. **Generatoren** — `notifThresholds()` i `app.js`, sett gjennom to vinduer:
   `collectNotifications(state, now, prefs, cursor)` ser BAKOVER (det som har
   passert) og `planNotifications(state, now, prefs)` ser FRAMOVER (det som
   kommer). Begge leser TERSKLER ut av hendelsene
   [`kommende-hendelser.md`](kommende-hendelser.md) allerede regner ut, og har
   ingen egne regler om hva som er aktivt, hva som er arvet eller hva som
   dedupliseres.
2. **Lagringen** — per-bruker-tabeller i Supabase (`notifications`,
   `notification_prefs`, `push_subscriptions`, `push_deliveries`). Varsler er
   ikke innhold: de deles aldri, de flettes ikke, og de ligger utenfor
   synk-doc-et.
3. **Flaten** — bjelleknappen med ulest-badgen, modalen `#notif-modal`, og
   **varsel-toasten** som springer ut fra knappen når et varsel dukker opp.
4. **Leveringskanalene** — native Android-varsler og web push. De er
   LEVERINGER av rader generatoren allerede har logget, aldri egne generatorer.

Tidsverdiene og semantikken for dato uten klokkeslett er beskrevet i
[`scheduling.md`](scheduling.md), som er autoritativ for dem.

## De fire varseltypene

| Type | Terskel | Ikon/flate |
|---|---|---|
| `dueOver` — frist utløpt | den effektive fristen | varseltrekant, rød |
| `dueSoon` — frist om mindre enn en uke | `frist − 7 døgn` | varseltrekant, gul |
| `startNow` — begynner nå | den effektive starttiden | start-/play-ikon, blågrønn |
| `startSoon` — begynner om mindre enn en uke | `start − 7 døgn` | klokke, lilla |

Grensene er de SAMME som «Kommende hendelser» grupperer på: `WEEK_MS` er sju
døgn à 24 timer, og `timeMs(verdi, felt)` er den eneste omregningen — en
fristdato uten klokkeslett varer ut døgnet, en startdato begynner 00:00. Det
finnes ingen egen tolkning her.

Flatene er de samme også, helt bokstavelig: raden bruker `.event-icon` med
gruppens tone, så et varsel om en utløpt frist ser ut som «Frist utløpt» gjør i
hendelsesoversikten. Pinningen følger dermed platen, ikke modalen
([`mork-drakt.md`](mork-drakt.md)), og flatene er allerede med i
kontrastkontrakten ([`tilgjengelighet.md`](tilgjengelighet.md)).

## Generatoren

```js
collectNotifications(state, now, prefs, cursor)   // → rader som skal logges (fortid)
planNotifications(state, now, prefs)              // → rader som skal logges (framtid)
```

Rene funksjoner: tilstand, tidspunkt, preferanser og markør inn — radene ut.
Ingen DOM, ingen nettverk, ingen klokkeoppslag. Begge kaller den samme
`notifThresholds()`, som kaller `collectUpcomingEvents()` og leser to terskler
ut av hver hendelse (tidspunktet selv, og uka før det). De er altså ÉN motor
sett gjennom hvert sitt vindu, ikke to nesten like motorer.

Alt annet er hendelsesmotorens svar, ikke et nytt regelsett:

- hva som er **aktivt/ufullført** (tom liste, alt avkrysset, papirkurven).
  Merk konsekvensen: **en liste uten listepunkter varsler ikke**, heller ikke
  når den har en frist — den har ingen hendelse i «Kommende hendelser» heller,
  fordi det ikke er noe igjen å rekke fristen med
  ([`kommende-hendelser.md`](kommende-hendelser.md), «Hva som er aktivt»);
- **effektiv, egen og arvet** tid — et listepunkt med rent arvet frist får ingen
  egen rad, bare forelderen;
- den **hierarkiske dedupliseringen**;
- **navigasjonsmålet** (`{ type, id }` til `navigateToObject()`).

Trenger varslene noe mer, utvides `collectUpcomingEvents` — det skal ikke finnes
to nesten like motorer.

### Markøren er hele idempotensen

`cursor` er tidspunktet terskler er vurdert **til og med**. En terskel blir et
varsel bare når den ligger i det halvåpne vinduet `(cursor, now]`.

Markøren rykker fram i den SAMME serveroperasjonen som skriver radene
(`notify_record`), og bare framover — og aldri forbi serverens egen klokke, så
en enhet med feil klokke ikke kan blende varslene for de andre. Konsekvensene er
verdt å lese sammen:

- **Catch-up er ikke et eget kodeløp.** Har appen vært lukket i ti dager, dekker
  vinduet ti døgn. En frist som først kom innenfor uka og siden gikk ut gir da
  BEGGE varslene, hver med sin egen faktiske terskeltid som hendelsestid.
  Historikken beskriver hva som skjedde, ikke bare hvor det endte.
- **Ingenting genereres to ganger.** En ny åpning, en ny enhet eller en tømt
  historikk kan ikke gjenskape et varsel: markøren står allerede foran
  terskelen. «Tøm varsler» er dermed permanent.
- **Første runde på en konto logger ingenting.** Finnes det ingen markør, settes
  den til nå. Uten det ville hver eneste frist som noen gang er gått ut blitt et
  ulest varsel i det brukeren logget inn.
- **En terskel som allerede var passert da verdien ble satt, varsler ikke.**
  Setter man en frist til i går, ligger terskelen bak markøren. Varslene handler
  om terskler appen har SETT passere.

For at det siste punktet skal være sant, må markøren rykke fram også når det
ikke er noe å logge — ellers ville den blitt stående der siste varsel ble
skrevet, kanskje uker tilbake, og alt som ble SATT til et tidspunkt i mellomtiden
hadde blitt varslet med det samme. En tom runde flytter den derfor også, men
bare når den har blitt eldre enn fem minutter (`NOTIF_CURSOR_MAX_LAG_MS`): en
app som står åpen skal ikke skrive til databasen hvert femte sekund. Prisen er
at en frist satt til de siste par minuttene fortsatt kan gi et varsel om at den
er passert — den ER passert, så det er ikke galt.

Én runde logger maksimalt `NOTIF_BATCH_MAX` (50) rader, og beholder de nyeste
tersklene: en historikk som åpner med tre hundre rader er ikke en historikk.

### Planen framover

Markøren over svarer på hva som HAR skjedd. Det som gjør at et varsel kan nå
fram når appen er **lukket**, er at generatoren også ser den andre veien.

`planNotifications()` er den samme motoren med vinduet snudd: tersklene som
ligger i `(nå, nå + 30 døgn]`, nærmest først, maksimalt
`NOTIF_PLAN_MAX` (40). De logges med `notify_record()` som alle andre rader —
med `at` FRAM I TID.

Det er hele mekanismen, og den er billig fordi den låner en form som allerede
fantes: **en rad med `at` i framtiden er usynlig og teller ikke som ulest før
den forfaller** — nøyaktig som et utsatt varsel («Utsett», under). Modalen,
badgen, vekkingen og toasten trengte derfor ingen ny regel.

Svaret på «hvor kjører generatoren når appen er lukket» er dermed: **den gjør
ikke det.** Den kjørte sist appen var åpen, og la planen fra seg. Android
planlegger sine lokale varsler fra den listen; web push leverer den fra
serveren. Ingen av kanalene tolker en terskel — de leverer rader som allerede er
logget.

**Planen har to tall, og begge koster noe.** Konsekvensen av hvert av dem:

**Horisonten (30 døgn).** En terskel lenger unna enn horisonten er ikke
planlagt, og kan derfor ikke leveres eksternt. Har appen ikke vært åpen på en
måned, er det ingenting å levere. Den dagen den åpnes, logges de passerte
tersklene som vanlig (vinduet bakover) og en ny plan legges — altså: varselet
uteblir som PUSH, ikke fra appen.

**Taket (40 rader).** Planen tar de NÆRMESTE 40 tersklene innenfor horisonten.
Ligger det flere der, rykker nummer 41 inn i planen i den samme synk-runden som
nummer 1 forfaller — planen legges på nytt hver runde, så køen er selvgående så
lenge appen brukes. Det eneste tilfellet der en terskel faktisk ikke blir
levert, er derfor: appen står lukket sammenhengende, OG det lå mer enn 40
terskler foran den i horisonten. Også da står raden i historikken neste gang
appen åpnes.

Tallet er 40 og ikke høyere fordi planen deler budsjett med historikken:
`get_my_doc()` sender de 200 nyeste varselradene sortert på `at`, og planlagte
rader har den største `at`-en — de ligger altså først i de 200, og hver plass
planen tar er en plass historikken mister. Klienten henter det doc-et hvert
femte sekund. 40 er en femtedel av budsjettet; en plan på hundre ville halvert
historikken for alle, for en gevinst bare en konto med svært mange datoer i
samme måned ville merket.

**Planen er ikke historikk.** Forskjellen er hva som gjør en rad ugyldig, og den
står under «Varsler som ikke gjelder lenger». Men den viser seg ett sted til:
**en planlagt rad bærer et FERSKT øyeblikksbilde.** Navnet og stien på en rad
er tatt da raden ble logget, og for historikk er det riktig — et varsel
beskriver hva som het hva da det skjedde. En planlagt rad kan derimot ligge en
måned før den forfaller, og det er DEN teksten web push leverer
(`push_claim()` bygger kroppen av `notifications.name`). Døpes objektet om i
mellomtiden, oppdaterer generatoren raden: `notify_record()` gjør en
`on conflict … do update` som bare treffer rader med `at` fram i tid og som ikke
er utsatt. Historikk skrives aldri om. Uten det ville nettleseren sagt det gamle
navnet mens Android sa det nye — Android bygger sin tekst av gjeldende tilstand
(«Android: lokale varsler»).

### Tidssonen planen tilhører

Terskeltidene er absolutte millisekunder, regnet ut av `timeMs()` fra **lokal
veggtid**. En frist «14. mars kl. 09:00» er derfor et annet tidspunkt i Tokyo
enn i Oslo, og en plan hører til ÉN sone.

Men det er TO spørsmål her, ikke ett, og de har hvert sitt svar:

| Spørsmål | Hvem bestemmer | Hvorfor |
|---|---|---|
| Hvem skriver SERVERPLANEN — radene i `notifications`, som web push leverer? | Én enhet av gangen, med en lease | To enheter i hver sin sone ville ellers slettet og gjenskapt hverandres plan i hver eneste synk-runde |
| Hvilke alarmer skal DENNE telefonen ha? | Telefonen selv, alltid, i sin egen sone | Ingen andre ser dem, ingen server leser dem — og en telefon skal varsle etter klokka der den faktisk er |

**Leasen** er `notification_prefs.tz` (sonen) og `tz_at` (når den sist ble
hevdet), og den har tre ledd:

- **Bare enheten som HOLDER sonen skriver planen** — og bare den rydder i
  planlagte rader. En enhet i en annen sone logger historikk som før, men lar
  serverplanen være.
- En enhet i en annen sone **hevder** sonen (`notify_claim_tz`) og skriver
  planen fra og med neste runde.
- Hevdelsen går bare gjennom når den forrige er **eldre enn seks timer**
  (`NOTIF_TZ_CLAIM_MS`), og ventetiden håndheves av serveren, ikke av klienten.
  Uten den ville de to enhetene skrevet om hverandre i hver runde.

**Leasen gjelder IKKE de lokale Android-alarmene.** `syncNotifChannel()` regner
alltid planen ut i enhetens egen sone og speiler den ut på telefonen — også når
serverplanen tilhører en annen sone. Bandt vi de to sammen, ville en telefon som
lander et nytt sted fått alarmene sine avlyst og stått uten dem til leasen løp
ut: **opptil seks timer uten varsler, som straff for å ha reist.** Nå følger
alarmene telefonen, og serverplanen følger etter når leasen kan overtas. At de
to er ulike i mellomtiden er uproblematisk: en enhet har ÉN kanal
(`notifChannel()`), aldri begge.

#### Når sonen endres mens appen ikke kjører

Det er to helt ulike tilfeller her, og de løses av hvert sitt lag.

**Appen kjører.** `syncNotifChannel()` speiler planen på nytt i enhetens egen
sone. Alarm-ID-en er en hash av signaturen (nøkkel + tid + tekst), så en alarm
som har flyttet seg er et annet tall: diffen avlyser den gamle og legger inn den
nye i samme runde.

**Appen er lukket.** Da kjører ingenting av Huskis, og alarmen står der
`@capacitor/local-notifications` satte den: `AlarmManager.RTC_WAKEUP` med et
**absolutt** millisekund. Android dokumenterer den alarmtypen som basert på
`System.currentTimeMillis()`, altså UTC — den flytter seg ikke av seg selv. Og
pluginen har ingen mekanisme for det: manifestet dens lytter bare på oppstart
(`BOOT_COMPLETED` og slektningene), ikke på `TIMEZONE_CHANGED`. Uten et ekstra
ledd ville en alarm som var ment kl. 09:00 i Oslo ringt kl. 17:00 etter en reise
til Tokyo, og først blitt rettet neste gang appen ble åpnet.

Det ekstra leddet er `no.huskis.app.TimeZoneAlarmReceiver`, og det er så lite
som det kan bli:

1. **Alarmen bærer sin egen tiltenkte veggtid.** `notifWallClock()` legger
   `extra.wall` (`«2026-09-04T09:00:00.000»`, lokal, uten sone) ved hvert
   planlagte varsel. Millisekundene er med fordi presisjonen betyr noe: en
   dato-frist uten klokkeslett har terskel 23:59:59.999.
2. **Android kringkaster `TIMEZONE_CHANGED`** — én av de få implisitte
   kringkastingene som er UNNTATT bakgrunnsbegrensningene i Android 8.0,
   nettopp for at apper skal kunne oppdatere alarmer. Systemet starter
   prosessen for å levere den; WebView-en, JS-motoren og synken kjøres ikke.
3. **`HuskisWallClock` regner om.** Veggtid + gjeldende sone → nytt absolutt
   tidspunkt. Ingen terskler, ingen frister, ingen tilstand — én
   kalenderoperasjon på ett tidspunkt. Varselmodellen er fortsatt bare
   generatoren i `app.js`.
4. **Den korrigerte tiden skrives TILBAKE til pluginens egen lagring, før
   alarmen settes.** Det er dette som gjør den robust mot en omstart: pluginens
   oppstartsgjenoppretting leser `schedule.at` fra lagringen, og ville ellers
   satt alarmen tilbake der den var.

Vi hverken forker eller kopierer pluginen: receiveren bruker dens egen
`NotificationStorage` og `LocalNotificationManager`, akkurat som dens egen
`LocalNotificationRestoreReceiver` gjør etter en omstart. Ingen ny tillatelse —
`TIMEZONE_CHANGED` krever ingen, og alarmene settes fortsatt med
`isExactNotification: false`.

To ting røres ALDRI: en alarm som allerede har ringt (å sette den på nytt ville
gitt et duplikat), og en alarm der det nye tidspunktet er det samme som det
gamle. At det nye tidspunktet kan ligge i FORTIDEN er derimot riktig — reiser
man østover, kan klokkeslettet alt være passert, og pluginen leverer da varselet
med det samme, som for et varsel som forfalt mens telefonen var avslått.

Identiteten følger med uendret: samme ID, samme tekst, samme `extra`. Neste
gang appen kjører, regner den planen ut i den nye sonen og får en ny signatur —
diffen avlyser da den korrigerte alarmen og legger inn den nye. Sluttilstanden
er den samme; brukeren merker ingenting, for varselet har hele veien stått på
riktig klokkeslett.

**Sommertid er en ANNEN sak, og trenger ingenting av dette.**
`new Date(år, måned, dag, time, minutt)` gir riktig instans for den lokale
datoen på begge sider av en overgang — en frist 4. september planlagt i februar
får sommertidens forskyvning, ikke vinterens. Overgangen endrer ikke hvilken
sone telefonen står i, så `TIMEZONE_CHANGED` fyrer ikke, og det skal den ikke:
det absolutte tidspunktet er allerede riktig. Det receiveren løser er BYTTE AV
SONE. (En endring i selve tidssonedatabasen — et land som legger om
DST-reglene — fanges ikke av noen av delene; den retter seg neste gang appen
kjører.)

**Delt innhold får hver sin tid.** En delt liste med frist kl. 09:00 varsler
hvert medlem kl. 09:00 i MEDLEMMETS egen sone — planen er per bruker, og hver
klient regner den ut i sin egen. Veggtiden er den samme for alle; øyeblikket er
det ikke.

Selve `start`/`due`-feltene er fortsatt lokal veggtid som tekst
([`scheduling.md`](scheduling.md)) og konverteres ikke til UTC. Serveren regner
ingen terskler og trenger derfor ingen sone til det; feltet er der for å si
hvilken sone planen tilhører — og for at en feil skal være mulig å se.

### Identitet

Nøkkelen er `type|objekttype|objekt-id|tidsverdi`, og den unike indeksen
`(user_id, key)` i databasen er andre lag: to enheter som regner ut det samme
varselet i samme øyeblikk skriver den samme raden, og den andre skrivingen faller
stille bort. `notify_record()` svarer med hvor mange rader som FAKTISK ble lagt
inn — klienten planlegger bare en ekstra pull når svaret er større enn null, og
luker dessuten kandidater den alt har en rad for. Uten begge deler ville en
klient med klokka foran serverens sendt de samme tersklene om igjen i det
uendelige.

**Tidsverdien er med i nøkkelen.** Flytter brukeren fristen, er det en ny
tidsplan: den nye terskelen kan varsle for seg, og det gamle varselet blir
stående i historikken (det beskriver noe som faktisk skjedde). Settes fristen
TILBAKE til en verdi det allerede er varslet om, varsles det ikke på nytt —
varselet finnes allerede.

## Preferansene

Fire brytere, én per type, bak tannhjulet i modalens hode. **Standard er PÅ for
alle fire.**

**Hodet har to tilstander, og aldri begge utgangene samtidig.** I listen står
bjellen + «Varsler» med tannhjulet til høyre; i innstillingene står tannhjulet
+ «Varselinnstillinger», tannhjul-knappen er borte, og en tilbakeknapp til
VENSTRE for overskriften er veien ut. Overskriften sier dermed selv hvor man er,
og det finnes én vei inn og én vei ut. Ingen forklaringstekst over bryterne:
navnene sier hva de gjør, og hva en avslått type betyr står her, ikke i UI-et.

Innstillingene er et NIVÅ inne i varselmodalen, ikke en egen modal: Androids
tilbakeknapp går ett nivå tilbake til varslene (samme mønster som del-modalens
← i [`menus.md`](menus.md)), mens Escape fortsatt lukker helt — «lukk = ferdig».
En badge er ingen avbrytelse, og en funksjon som er av fra første stund blir
aldri sett. De eksterne kanalene har sin egen opt-in oppå dette, som en femte
rad i det samme panelet (se «De eksterne kanalene»).

Bryterne styrer om hendelsen **genereres i det hele tatt** — ikke om den vises.
En avslått type lager ingen rad, heller ikke i historikken. Det er den regelen
som gjør in-app og eksternt varsel til to leveringskanaler for det samme valget
i stedet for to uavhengige innstillinger.

Et bytte flytter markøren til nå (både i klienten og i `notify_set_prefs`): en
terskel som passerte mens typen var av skal ikke velte inn i det den slås på
igjen.

Preferansene ligger på **brukeren**, ikke på enheten, og synkes med resten av
doc-et.

## Lagringen

Varslene ligger i to tabeller i `supabase/users-and-sharing.sql`, ikke i
synk-doc-et: de har ingen forelder å arve tilgang fra, de skal aldri flettes, og
lest/ulest skal være det samme på alle mine enheter.

| Tabell | Innhold |
|---|---|
| `notifications` | én rad per logisk varsel: `user_id`, `key`, `type`, `obj_type`/`obj_id`, `name`, `path`, `value`, `at`, `snoozed`, `created_at`, `read_at` |
| `notification_prefs` | én rad per bruker: de fire bryterne, `cursor_at` og sonen planen tilhører (`tz`, `tz_at`) |
| `push_subscriptions` | ett abonnement per nettleser: `endpoint` (globalt unikt), `p256dh`/`auth`, `labels`, `tz`, `disabled_at` |
| `push_deliveries` | utboksen: én rad per (varsel, abonnement) med `due_at`, `status`, `attempts` |

- **RLS: kun egne rader**, hele veien (select/update/delete). Andres varsler kan
  ikke leses, merkes eller slettes — heller ikke for et objekt vi deler.
- **Klienten kan ikke sette inn rader.** Det gjøres av `notify_record()`
  (security definer), som setter `user_id` fra `auth.uid()` selv. Update er
  kolonne-avgrenset til `read_at`: lest/ulest er det eneste klienten eier på en
  eksisterende rad. Preferansene skrives kun av `notify_set_prefs()`.
- **Abonnementene** leses og slettes av eieren, men skrives kun av
  `push_subscribe()` — ellers kunne en klient skrevet en rad på en annens
  bruker-id og fått den brukerens varsler sendt til seg.
- **Utboksen er låst.** RLS på, ingen policyer, ingen grants: verken `anon`
  eller `authenticated` når `push_deliveries` gjennom PostgREST. Den leses og
  skrives kun av `push_claim()`/`push_report()`, som er avgrenset til
  `service_role` — både med grants og med en rollesjekk inne i funksjonen.
- `name` og `path` er et **øyeblikksbilde** fra genereringstidspunktet, så raden
  kan vises også etter at objektet er slettet. Navigasjonen bruker dem aldri —
  den slår alltid opp `obj_id` i gjeldende tilstand.
- Historikken har **to grenser**, og begge håndheves av serveren:
  - et **tak på 200 rader per bruker** — `notify_record()` rydder de eldste
    utover det;
  - en **levetid på 30 døgn** (`notify_max_age_ms()`) — en rad som ble
    historikk for lenger siden enn det, SLETTES. Den er ikke valgfri og gjelder
    også en kort historikk: et varsel som har ligget en måned ber ikke lenger om
    oppmerksomhet.

  **Levetiden teller fra det ØYEBLIKKET raden ble historikk** — altså fra det
  SENESTE av `created_at` og `at`. Ingen av de to duger alene:

  - bare `at` ville slettet en rad i den samme operasjonen som skrev den. En app
    som har vært lukket lenge logger terskler som passerte for lenge siden (se
    «Markøren er hele idempotensen»), og de skal VISES når de kommer;
  - bare `created_at` ville tatt en PLANLAGT rad i det den ringte. Planen legges
    opp til en måned fram (`NOTIF_PLAN_HORIZON_MS`), så en rad ved horisontens
    ytterkant er allerede en måned gammel når `at` passerer.

  Med det seneste av de to lever hver rad en måned ETTER at den ble relevant,
  uansett hvilken vei den kom.

  **Rader fram i tid røres dermed aldri**: for dem er `at` det seneste, og det
  ligger foran nå. Planen framover og et utsatt varsel er ikke historikk, og
  skal ikke kunne ryddes bort før de har fått ringt.

  `get_my_doc()` filtrerer på det samme regnestykket, så en rad aldri VISES for
  gammel selv om det er lenge siden forrige logging ryddet. Klienten gjør det
  også, i `applyNotifications()`: en rad kan runde 30 døgn mens appen står åpen.
  Tallet står ett sted i hvert lag — `notify_max_age_ms()` i SQL-en,
  `NOTIF_MAX_AGE_MS` i `app.js` og i `mock-backend.js`.

Radene og preferansene kommer med `get_my_doc()` (samme runde som resten), og
generatoren kjøres sist i hver synk-runde. Skjemaendringene er additive: en
gammel klient som ikke kjenner grenene ignorerer dem.

**Historikken er serverens.** Den vises når en synk-runde har hentet den; det
finnes ingen lokal kopi i `localStorage`. En generator-runde som ikke når fram
lar markøren stå, og vinduet er fortsatt åpent ved neste forsøk — feilen er
selvlegende, ikke tapt.

## Varsler som ikke gjelder lenger

Et varsel beskriver ÉN tidsplan for ETT objekt. Forsvinner objektet, eller blir
tiden varselet gjaldt en annen, beskriver raden noe som ikke finnes — og da skal
den ikke bli stående og be om oppmerksomhet. Den **slettes**.

`purgeStaleNotifs()` kjøres rett etter hver pull (`applyNotifications`) og
sletter radene der:

| Tilstand | Gjelder | Hvorfor |
|---|---|---|
| objektet finnes ikke i `state` (slettet, i papirkurven, eller utenfor tilgangen min) | alle rader | det er ingenting igjen å varsle om |
| objektets **effektive** tid for feltet er en annen enn radens `value` | alle rader | den gamle tidsplanen finnes ikke lenger |
| raden står ikke lenger i planen, eller står der med en annen terskeltid | kun PLANLAGTE rader (`at` fram i tid, ikke utsatt) | en plan som ikke er planen lenger |

**Den siste raden er forskjellen på en plan og en historikk**, og den er det som
avlyser en framtidig levering:

- **fullføres listepunktet**, forsvinner hendelsen fra «Kommende hendelser» —
  selv om tiden på objektet står urørt. Den planlagte raden er da ikke i planen,
  og slettes. Kaskaden tar leveringene i utboksen med seg, og Android-adapteren
  kansellerer det native varselet ved neste runde;
- **byttes tidssonen**, gir den samme datoen en annen terskeltid. Raden beskriver
  da et tidspunkt planen ikke lenger har, og erstattes.

En **utsatt** rad er brukerens egen bestilling og står ikke i planen — den måles
bare mot objektet, som før. Og en enhet som ikke holder tidssonen rører ikke
planlagte rader i det hele tatt (se «Tidssonen planen tilhører»).

Merk at et varsel som ALLEREDE har forfalt ikke rammes av den siste raden: det
er historikk, og historikk beskriver noe som skjedde.

To ting gjør dette trygt å kjøre automatisk:

1. Det kjøres **kun rett etter en pull**, altså med et ferskt doc flettet inn i
   `state`. Et halvlastet tre ville sett ut som om alt var slettet.
2. Sammenligningen går på den **effektive** tiden (`effectiveTime`), samme
   presedens som resten av appen: en låst liste styrer listepunktenes tider, så
   en rad om et listepunkt måles mot den tiden som FAKTISK gjelder for det.

Feiler slettingen, står radene igjen på serveren og runden tas om igjen ved
neste pull. Ingen toast — brukeren ba ikke om dette.

**Merk hva som IKKE er ugyldig:** at et listepunkt som ALT er varslet om, krysses
av. Varselet beskriver noe som faktisk skjedde, og historikken beholdes. Det er
bare den framtidige planen fullføringen avlyser.

Konsekvensen av at markøren er permanent (se «Markøren er hele idempotensen»)
gjelder her også: gjenoppretter man objektet fra papirkurven, kommer ikke
varslene tilbake — terskelen er brukt opp. Det er det samme svaret «Tøm varsler»
gir.

## Lest/ulest

`read_at` på raden. Badgen på bjellen teller de SYNLIGE varslene som er uleste
og som ikke nettopp er sett i en åpen modal (skjult ved 0, `99+` over hundre),
og antallet står i knappens `aria-label` — badgen selv er `aria-hidden`. Uten
det siste leddet ville en pull som lander før serveren har bekreftet
lest-merkingen blinket antallet tilbake.

**Åpning av modalen markerer lest**, uten en «Sett alle som lest»-knapp.
Grensen er et **sett av ID-er**, ikke et tidspunkt: nøyaktig de varslene som sto
der da modalen ble åpnet. Et varsel som ankommer etterpå — eller et utsatt som
forfaller — forblir ulest til modalen åpnes på nytt. Operasjonen er idempotent
(bare uleste rader røres), så to enheter kan gjøre den samtidig.

De radene åpningen merket lest **beholder markeringen til modalen lukkes**. Ellers
ville hele listen blitt grå i det samme øyeblikket, og brukeren mistet nettopp
det badgen lovte: hvilke rader som var nye.

## «Tøm varsler» med angre

1. et **øyeblikksbilde** av akkurat de ID-ene som er synlige nå;
2. de skjules med én gang;
3. knappen blir `Angre · 10` og teller ned — ingen bekreftelse;
4. «Angre» gjenoppretter øyeblikksbildet;
5. etter ti sekunder committes slettingen;
6. **å lukke modalen committer med én gang** — angre-vinduet hører til den åpne
   modalen, og det samme gjør en fane som forsvinner (`visibilitychange`), som
   for den buffrede slettingen ([`trash.md`](trash.md)).

Et varsel som ankommer etter øyeblikksbildet er ikke med i settet og blir ikke
slettet med det. **Planen framover røres heller ikke:** øyeblikksbildet er de
SYNLIGE radene, og en planlagt rad er usynlig til den forfaller. Å tømme
historikken slår altså ikke av de eksterne varslene — det gjør bryteren i
innstillingene.

Går serveroperasjonen i vasken, later appen **ikke** som noe annet: radene er
fortsatt på serveren, de vises igjen straks, og en toast sier fra.

## «Utsett»

Hver rad har en liten klokke ved siden av seg. Den åpner en **popover forankret
i knappen** — ikke en rad under kortet: der lå valgene mellom to kort, og det
var ikke til å se hvilket av dem de hørte til. Popoveren har overskriften
**«Varsle på nytt om»**, og fordi overskriften bærer «om» er valgene rene
varigheter:

| Valg | Betydning |
|---|---|
| **1 time** / **6 timer** / **1 døgn** | et fast sprang fra nå |
| **Egendefinert** | folder ut en liten skuff med **dato + klokkeslett** |

Skallet er det samme som bytterne og tids-popoveren bruker (`.switcher-*`):
popover ved knappen på desktop, sentrert ark på mobil, felles fokusfelle og
felles plass i Escape-stigen (`closeTopLayer`) — den ligger over varselmodalen.
Panelet er så bredt innholdet krever, så det er smalt med bare fire varigheter
og vokser når skuffen åpnes.

**Skuffen krever begge feltene, og et tidspunkt fram i tid.** Et utsatt varsel er
ET TIDSPUNKT, ikke et døgn, og et tidspunkt som alt er passert ville forfalt med
det samme — da har «utsett» ikke betydd noe. Begge deler avvises i panelet med
en kort beskjed i stedet for å bli logget.

Valget logger det samme varselet på nytt med et tidspunkt i framtiden
(`snoozed`), og nøkkelen får utsettelsestidspunktet med seg (`<original>|s<tid>`),
så identiteten ikke kolliderer med det opprinnelige.

### Knappen er ARMERT når noe er bestilt

Nøkkelformen over er samtidig **lenken tilbake**: `pendingSnooze(row)` finner en
rad som ennå ligger i framtiden og hvis nøkkel er radens egen pluss `|s` og rene
siffer. (Sifferkravet er der for at en utsettelse av utsettelsen — `…|s1|s2` —
ikke skal armere den opprinnelige raden også.) Ingen ny kolonne trengs.

Er noe bestilt, bærer utsett-knappen aksentflaten med hvit glyf, den samme
«på»-fargen bryterne bruker — ellers var utsettelsen usynlig i det sekundet
toasten forsvant. Fargen er ikke eneste bærer: knappens navn sier det samme.

Og popoveren tilbyr da **ikke** en ny utsettelse — to varsler om det samme er
ikke det noen mente. Den sier når varselet kommer («Du vil bli varslet igjen kl.
17:00», med datoen i tillegg når det er et annet døgn), og tilbyr det ene som
gir mening: å avbryte det. Å avbryte er å slette den planlagte raden.

Et varsel med `at` i framtiden er **usynlig og teller ikke som ulest** før det
forfaller. Modalen og badgen sover fram til det første slike tidspunktet
(`scheduleNotifWake`), med samme tak og samme `visibilitychange` som
hendelsesmodalen.

**Neste midnatt er alltid en grense der også.** Datooverskriftene og
dagsnavnene i meldingene avhenger av hvilket døgn vi står i, ikke av radene:
uten den vekkingen ville en modal som står åpen over midnatt uten at noe annet
skjer — appen ligger stille, ingen synk-runde, ingen utsatte varsler — blitt
stående med gårsdagens ord. Datoen i signaturen sørger for at malingen faktisk
skjer når vekkingen kommer.

Å utsette er samtidig en kvittering: det opprinnelige varselet merkes lest.
Markøren røres ikke — ingen terskler er vurdert.

## Modalen (`#notif-modal`)

Vanlig `.modal-overlay`-skall (fokusfelle, Escape via `closeTopLayer`,
`body.modal-open`, fokus tilbake til bjellen ved lukking), med:

- **nyeste øverst**, sortert på hendelsens tidspunkt (`at`) — det er det samme
  på alle enheter — med id-en som tie-breaker, så rekkefølgen aldri hopper;
- radene samlet i **bunker per døgn**, med datoen som overskrift (under);
- raden i **tre linjer** (under);
- en tomtilstand når historikken er tom;
- «Tøm varsler» i foten;
- tannhjulet i hodet, som vender panelet til de fire preferansene.

Trykk på en rad lukker modalen og kaller `navigateToObject({ type, id })`
([`sok-og-navigering.md`](sok-og-navigering.md)).

### Datoen står over bunken, ikke på raden

Varslene som kom samme døgn ligger under ÉN datooverskrift. Datoen sies dermed
én gang der den betyr noe, i stedet for som et tidsstempel på hver eneste rad —
og raden får plassen til det den faktisk sier.

| Døgnet | Overskrift |
|---|---|
| i dag | «I dag» |
| i går | «I går» |
| eldre | ukedag + full dato: «Torsdag 27. august» (med årstall når det ikke er inneværende) |

Bunkene skilles av luft (`.notif-body`s gap), ikke av en strek — samme grep som
gruppene i «Kommende hendelser».

Datoen er en del av tilstanden malingen avhenger av, ikke bare radene: står
modalen åpen over midnatt, blir «I dag» til «I går» uten at en eneste rad har
endret seg. Dagens dato er derfor med i signaturen `refreshNotifModal()`
sammenligner på.

### Raden

Tre linjer over hverandre, med statusikonet til venstre:

```
[ikon]  Testområde › Testmappe            ← kontekststien, svært liten og dempet
        Testliste                          ← objektets navn
        Fristen er utløpt – den var i dag kl. 09:00.
```

Stien er et **øyeblikksbilde** fra genereringstidspunktet (se «Lagringen») og
plasserer objektet uten å konkurrere med navnet, som er det man leter etter.

**Meldingen navngir de tre nærmeste døgnene.** `fmtTimeRelDay()` skriver «i dag»,
«i går» og «i morgen» i stedet for datoen, og faller tilbake på den vanlige
datoen lenger ut («5. sep kl. 17:00»). Uten klokkeslett står dagen alene
(«Begynte i dag.») — en dato uten klokkeslett er et DØGN
([`scheduling.md`](scheduling.md)), og et klokkeslett vi ikke har skal ikke
finnes på.

| Type | Melding |
|---|---|
| `dueOver` | «Fristen er utløpt – den var {tid}.» |
| `dueSoon` | «Fristen utløper {tid}.» |
| `startNow` | «Begynte {tid}.» |
| `startSoon` | «Begynner {tid}.» |

Er målet borte, sier meldingen det i stedet for å la et dødt trykk forklare det
— men det er en kort tilstand: en rad uten gyldig objekt ryddes bort ved neste
synk-runde (se «Varsler som ikke gjelder lenger»).

Til høyre for raden står to knapper: **utsett** (klokka) og **slett** (✕).
Slett-knappen tar ÉN rad, uten angre-vindu — «Tøm varsler» er den som tar
bunken, og der er angre-vinduet prisen for at det er mange. Slettingen er
optimistisk lokalt og går rett på serveren; feiler den, kommer raden tilbake med
det samme og en toast sier fra.

Bjelleknappen står **først** i toppkontrollgruppen, til venstre for kalenderen
([`menus.md`](menus.md), «Toppkontrollene»).

## Varsel-toasten

Et varsel som dukker opp mens appen står åpen skal SES, ikke bare telles. En
liten toast **springer ut fra bjelleknappen** (`transform-origin` øverst til
høyre, stabelen posisjoneres i JS fra knappens faktiske plass — gruppen brytes
til flere rader på smale skjermer), står i **tre sekunder** og forsvinner.

**Formatet er et annet enn radens**, med vilje: `[ikon] **navn** · én kort
setning`. Ingen sti, ingen dato — en toast leses i forbifarten.

| Type | Toastens setning |
|---|---|
| `dueOver` | «Fristen er utløpt» |
| `dueSoon` | «Fristen utløper {avstand}» |
| `startNow` | «Starter nå» |
| `startSoon` | «Starter {avstand}» |

`{avstand}` er hele KALENDERDØGN (`fmtDaysAway()`): «i dag», «i morgen», «om 3
dager». Kalenderdøgn og ikke 24-timers bolker — «i morgen» skal bety i morgen,
også når det er tjue minutter unna.

**Flaten er varseltypens egen farge**, halvgjennomsiktig med `backdrop-filter:
blur(…)`, så toasten sier hva den gjelder før man har lest et ord. Tinten er den
MØRKESTE enden av den samme gradienten ikonet står på: en toast er en liten flate
der gradienten uansett ikke leses, og det mørke stoppet er det som bærer
tekstfargen sin med margin også når det gjennomsiktige laget legger seg over en
hvit bakgrunn. Tekstfargen pinnes per tone, som på chipene — hvit på rødt og
blågrønt, mørk på gult og lilla. Selve ikonet er den vanlige `.event-icon`-platen
med sin tone, altså det ene toasten IKKE gjør på sin egen måte.
Begge ytterpunktene (helt hvitt og helt svart bak) er med i kontrastkontrakten
([`tilgjengelighet.md`](tilgjengelighet.md)).

- **Trykk** fører til varselet: modalen åpnes, raden rulles fram og fokuseres.
- **Sveip til høyre** fjerner toasten før de tre sekundene er ute — nøyaktig
  samme gest og samme motor (`attachToastSwipe`) som den vanlige toasten
  ([`design-system.md`](design-system.md)).

### Hva som er «dukket opp»

`notifSeen` er de radene ØKTEN allerede har presentert, og det er hele regelen:

- **Første runde etter innlogging seeder settet uten å vise noe.** Ellers ville
  en innlogging gitt en vegg av toaster — historikken er opptil 200 rader.
- Et **utsatt** varsel er ikke med i settet før det FORFALLER, og toaster derfor
  når det blir synlig.
- Toaster vises ikke mens **et lag står åpent** (`body.modal-open`). Er det
  varselmodalen, er raden allerede synlig der. Er det noe annet, ville et trykk
  på toasten stablet varselmodalen oppå et lag brukeren står midt i — og
  Escape-stigen (`closeTopLayer`) hadde lukket det underste først. Runden
  oppdaterer settet likevel, så toasten ikke kommer igjen når laget lukkes.
- Å følge ÉN toast inn i modalen rydder **hele stabelen**: søsknene viser rader
  modalen nå selv har. Et lag som rakk å åpne seg etter at toasten kom, lukkes
  først, av samme grunn som over.
- Én runde viser maksimalt tre toaster (de nyeste). En catch-up-runde kan ha
  dusinvis av rader, og en kø av toaster er ingen kø — badgen og modalen har
  resten.
- Et varsel brukeren **nettopp trykket på i systemets varselpanel** toaster
  ikke. Trykket navigerte appen til objektet, og en toast om nøyaktig det
  varselet ville pekt på det brukeren allerede står i. Begge de eksterne
  kanalene sender varselets NØKKEL sammen med pekeren, og nøkkelen er varselets
  logiske identitet: bare det ene varselet holdes tilbake, mens et annet nytt
  varsel — også om det samme objektet — toaster som før. Nøkkelen holdes til
  raden faktisk er kommet ned og presentert, for ved et web push-trykk har
  fanen som regel ikke sett raden ennå. En KALDSTART fra et varsel trenger
  ingen egen regel: første runde seeder settet uten å vise noe.

## Fullførte, slettede, flyttede og omplanlagte objekter

| Hva som skjer | Følgen |
|---|---|
| listepunktet fullføres FØR terskelen | ingen hendelse, altså heller ikke noe varsel — og en PLANLAGT rad om den terskelen avlyses ved neste pull, med den eksterne leveringen |
| det fullføres ETTER at varselet finnes | historikken beholdes urørt |
| objektet slettes eller tilgangen forsvinner | raden SLETTES ved neste pull (se «Varsler som ikke gjelder lenger»). Fram til den runden står den merket i teksten sin, og et klikk gir en beskjed i stedet for en navigering |
| objektet flyttes | historikken følger objekt-ID-en, ikke stien — `navigateToObject` slår opp hvor det ligger NÅ |
| start/frist endres | raden om den GAMLE tiden slettes ved neste pull; den nye planens terskler varsler for seg (nøkkelen bar den gamle verdien, så den nye kan varsle) |

Et mål som er borte oppdages med et rent lokalt oppslag i `state`. En id vi ikke
har tilgang til finnes ikke der, så en rad kan verken navigere til eller røpe noe
om et objekt vi ikke ser.

## Tilgjengelighet

- Dialogsemantikk på modalen; fokus flyttes inn ved åpning og tilbake til
  bjellen ved lukking (unntatt når en rad ble åpnet — da eier navigeringen
  fokuset).
- Radene er vanlige knapper, så Tab og Enter virker uten særbehandling. Hver rad
  har et `aria-label` med lest/ulest, varseltypen i KLARTEKST, navnet, meldingen,
  bunkens dato og stien — eller beskjeden om at objektet er borte. Datoen står
  visuelt utenfor knappen, i overskriften over bunken, men opplesningen tar den
  med: en rad skal kunne leses alene.
- Utsett-knappen har `aria-haspopup="dialog"` og `aria-expanded`, og popoveren
  arver `.switcher-overlay`-skallets fokusfelle og Escape.
- Toastene ligger i et `role="status"`-live-område, så de også NÅR en
  skjermleser, og hver toast har et `aria-label` med typen, navnet og meldingen.
  De er dessuten ikke eneste kanal: badgen og modalen har det samme.
- Antallet og hvor mange som er uleste leses opp fra et visuelt skjult
  `role="status"` ved åpning.
- Farge er aldri eneste bærer: typen står i meldingen, ulest bæres av både en
  kant og en prikk, og et utilgjengelig mål sier det i teksten.
- Badgen er `aria-hidden`; antallet ligger i knappens navn.

Kravene er de samme som ellers — se
[`tilgjengelighet.md`](tilgjengelighet.md).

## Språk

Alle tekstene ligger i ordboken under `notif.*`. Datoformene deles med resten av
appen og ligger under `date.*` — månedsnavn (korte og fulle), ukedagene, «i dag»/
«i går»/«i morgen» (små forbokstaver, de står midt i en setning) og avstanden i
døgn. Overskriftene «I dag»/«I går» har sine egne nøkler med stor forbokstav
(`notif.day.*`), fordi de er overskrifter og ikke setningsledd.
Se [`sprak.md`](sprak.md).

To tekster står UTENFOR Huskis og følger likevel appspråket: navnet og
beskrivelsen på Androids varselkanal (`notif.android.channelName` og
`…channelDesc`), som brukeren møter i telefonens systeminnstillinger. De
skrives på nytt i den første speilingen etter et språkbytte, også når det ikke
finnes en eneste alarm å planlegge — navn og beskrivelse er det eneste
`createChannel` kan oppdatere på en kanal som allerede finnes (se
«Varselkanalen»).

## De eksterne kanalene

De fire preferansene styrer HENDELSEN, ikke visningen. De to eksterne kanalene
er derfor ikke fire nye valg, men **én bryter per enhet** oppå de samme
hendelsene:

| | Android (i appen) | Nettleser |
|---|---|---|
| Mekanisme | LOKALE varsler planlagt på selve enheten (`@capacitor/local-notifications`) | Web Push: serveren sender, service workeren viser |
| Trenger en server? | **nei** — telefonen har planen og vekker seg selv | ja, både en abonnementsrad og en sender |
| Hva som leveres | planen (`planNotifications`) | planen, gjennom utboksen |
| Tillatelse | POST_NOTIFICATIONS (Android 13+) | `Notification.requestPermission()` |

Kanalen velges av plattformen og er aldri begge: inne i APK-en finnes det ingen
pushtjeneste å melde seg på, og i en nettleser finnes det ingen native plugin.

**Valget ligger på ENHETEN** (`localStorage`, som drakten), ikke på brukeren. At
telefonen skal buzze er ikke det samme valget som at den bærbare skal det. De
fire typebryterne ligger fortsatt på brukeren og gjelder alle kanaler — det er
den ene innstillingen som gjør in-app og eksternt varsel til to leveringer av
det samme valget i stedet for to uavhengige.

### Tillatelsen spørres aldri av seg selv

Systemdialogen kommer **kun** etter et trykk på bryteren i
varselinnstillingene, og linjen under bryteren forklarer hvorfor før den
utløses. Panelet har fem tilstander, og de sier hver sin sanne ting:

| Tilstand | Bryteren | Teksten |
|---|---|---|
| ikke støttet | finnes ikke | «Denne enheten kan ikke vise varsler utenfor Huskis. Varslene står fortsatt i listen her.» |
| forhåndsvisning | finnes ikke | «Eksterne varsler er slått av i forhåndsvisninger. Varslene står fortsatt i listen her.» |
| av | av | forklaringen — hva du får, og at enheten kommer til å spørre |
| på | på | «På. Varslene kommer også når Huskis er lukket.» — eller «På her og på N andre enheter.» når varslene er på flere (nettlesere OG Android-apper), med «Vis enheter» under (se «Enhetene med varsler») |
| blokkert | av og **deaktivert** | «Blokkert. Slå på varsler for Huskis i enhetens innstillinger, og prøv igjen.» |

**Forhåndsvisning er ikke «støttes ikke».** Nettleseren kan godt vise varsler;
det er DEPLOYEN som ikke får melde seg på (se «Hvilke deployer som får melde seg
på» under). Teksten må derfor si nettopp det — den andre ville vært usann.

**Blokkert er en blindvei, ikke et nytt forsøk.** En bryter som lot seg slå på
uten å virke ville løyet, og en app som spurte igjen ville maset om noe
operativsystemet allerede har bestemt. Veien tilbake går gjennom enhetens
innstillinger, og det er det teksten sier.

Statusen leses på nytt hver gang panelet åpnes: tillatelsen kan ha blitt endret
i systeminnstillingene mens appen sto åpen.

### Teksten i et eksternt varsel

**Overskriften er objektets navn, kroppen er varseltypen i klartekst** — de
samme fire ordene som står over bryterne. Ikke radens melding, og ikke toastens:
et varsel på en låseskjerm skal si hva det gjelder og ikke mer.

Det som IKKE er med, er med vilje: ingen sti, ingen kontekst om hvem som deler
hva, ingen id-er i teksten, og aldri et token. Kroppen som sendes over nettet er
dessuten kryptert ende-til-ende (RFC 8291), så push-tjenesten ser bare et
endepunkt og en ugjennomsiktig blokk.

Pekeren i varselet (`{ objType, objId }`) er nettopp en peker — **aldri et
bevis**. Trykket kaller `navigateToObject()`, som slår id-en opp i gjeldende
tilstand; en id vi ikke har tilgang til finnes ikke der, og fører ingen steder.

### Android: lokale varsler

Adapteren speiler planen ut på enheten som en **diff** mot `getPending()`:
avlys det som ikke lenger står i planen, legg inn det som mangler. Uten diffen
ville hver synk-runde lagt inn de samme varslene på nytt, og en endret frist
blitt liggende ved siden av den nye.

**`getPending()` er pluginens LAGRING, ikke de armerte alarmene.**
`@capacitor/local-notifications` beholder raden etter at varselet har ringt —
den slettes først når brukeren sveiper varselet bort, og et `cancel()` av en
levert rad merker den bare som avlyst. Et levert varsel står altså igjen i
svaret mens alarmen er borte. Diffen tåler det: signaturen bærer terskeltiden,
så en rad som har ringt kan aldri kollidere med en alarm fram i tid.

#### Speilingen er telefonens egen, ikke serverens

Kanalen er LOKAL. Alarmene ligger på telefonen, ingen server leser dem, og
ingen server trengs for å legge dem. Speilingen kjøres derfor fra tre steder,
og de dekker hver sin vei inn:

| Utløser | Dekker |
|---|---|
| `save()` — en lokal endring | en frist som opprettes eller flyttes. Debounced (`NOTIF_CH_LOCAL_MS`), så en bunke endringer blir én speiling |
| tilbake i forgrunnen (`visibilitychange`) | terskler som har passert eller kommet innenfor horisonten mens appen lå stille |
| `applyNotifications()` — etter hver pull | alt en annen enhet gjorde |

**Bare den siste av dem trenger nett**, og det er poenget: gjorde vi som før
og speilet kun etter en VELLYKKET pull, ble en nyopprettet eller endret frist
aldri en alarm når nettet var borte eller serveren svarte feil — telefonen ble
stående med den forrige planen, helt stille, til en runde kom fram. Web push
speiles ikke slik: der ER serveren kanalen, og en lokal endring uten en
synk-runde er ingenting å levere (`local` på kanalobjektet skiller de to).

**Én speiling om gangen.** `syncNotifChannel()` serialiserer seg selv, og en
runde som kommer imens tas etterpå i stedet for ved siden av. Uten det leser to
samtidige runder `getPending()` før noen av dem har skrevet, begge tror alarmen
sin mangler, og telefonen sitter igjen med én alarm for mye — den som ble tatt
UT av planen ringer likevel. Signaturen den siste runden skriver sier da
«speilet», og den overflødige alarmen blir aldri ryddet bort.

Den køede runden kjøres uansett hvordan den foregående gikk. En runde som
feilet i broen lar signaturen stå, så «neste runde» gjør hele jobben — men
uten nett finnes det ingen neste runde, og debouncen til endringen som køet
seg har alt fyrt. Falt den køede runden bort sammen med den som feilet, kostet
ett hikst i broen nøyaktig den alarmen.

#### Én synlig varsling: appen åpen vs. appen borte

**Produktregel:** brukeren skal normalt få ÉN synlig varsling per hendelse på
en telefon — ikke en in-app-toast og et systemvarsel om det samme.

| Appen er | Varslingen er |
|---|---|
| åpen og aktiv | **in-app-toasten.** Et systemvarsel i tillegg er ikke påkrevd — og kommer normalt ikke |
| i bakgrunnen, eller prosessen er borte | **den lokale Android-alarmen.** Den er armert på forhånd og leverer uten at en eneste linje JS kjører |

Regelen faller ut av at `applyNotifications()` bruker ÉTT øyeblikk (`nå`) for
hele runden, to steder, tre linjer fra hverandre:

```js
announceNotifs(nå);      // notifVisible → radene med at <= nå   ⇒ TOASTER
syncNotifChannel(nå);    // planNotifications → tersklene med at > nå
                         //   ⇒ terskelen er UTE av planen, og diffen avlyser alarmen
```

Det samme millisekundet legger altså den nettopp passerte terskelen på hver sin
side av de to vinduene: synlig i appen, borte fra den framtidige native planen.
Neste speiling ser en armert alarm som ikke står i planen, og avlyser den — som
regel før Android har rukket å vise den, fordi alarmene er UPRESISE med vilje
mens synk-runden går hvert femte sekund i forgrunnen.

To presiseringer, fordi de er lette å lese feil:

- **Toasten «spiser» ikke alarmen.** Begge deler følger av at terskelen er
  passert mens appen kjører. Holdes toasten tilbake (varselmodalen står åpen,
  brukeren trykket seg inn via nettopp det varselet), avlyses alarmen likevel —
  raden er uansett synlig i modalen og telles i badgen.
- **Ingenting går tapt.** Raden er historikk nå, og historikk ryddes ikke bort
  av planen (se «Varsler som ikke gjelder lenger»). Varselet står i modalen og
  i badgen enten Android rakk å vise det eller ikke.

At Android likevel skulle rekke å levere før runden avlyser, er ikke en feil —
det er et kappløp vi ikke styrer, og et ekstra systemvarsel er ufarlig. Men
**et systemvarsel i forgrunnen er ikke et ferdigkriterium**, og skal ikke
tvinges fram: en ekstra levering, eller en diff som lot den passerte terskelen
stå, ville gitt nøyaktig den doble varslingen regelen finnes for å unngå.

**Hverken kanalen eller prioriteten er en slik tvang.** Begge bestemmer hvordan
Android PRESENTERER et varsel som faktisk blir levert — og et varsel som er
avlyst blir ikke levert. Regelen bæres av diffen, ikke av at varselet er
stillferdig: det er nettopp fordi systemvarselet nå er mer påtrengende at det
ikke skal komme oppå en toast om det samme.

Én felle i navnene: feltet Huskis setter for prioritet heter `foreground`, og
det er iOS-ens betydning («vis varselet selv om appen er i forgrunnen»). PÅ
ANDROID GJØR DET KUN ÉN TING — `setPriority(PRIORITY_HIGH)`. Det er ikke en
levering til, og det er ikke et valg om hva som skjer når appen er åpen.

**Web push er ikke symmetrisk her, og kan ikke være det.** Der eier SERVEREN
sendingen: leveringen ligger i utboksen med `due_at` og går ut når den
forfaller. Det finnes ingen lokal diff som kan trekke den tilbake i det appen
selv presenterer raden. En åpen fane kan derfor få både systemvarselet og
toasten. Den native kanalen har planen på enheten, og det er nettopp derfor den
kan gjøre dette.

Låst av `tests/notif-channels.test.js` 12, som lar klokka faktisk passere
terskelen: alarmen er armert mens terskelen ennå er i framtiden (bakgrunns-
kontrakten), og når den passerer med appen i forgrunnen kommer toasten, mens
terskelen forsvinner fra planen og alarmen avlyses.

Broen mellom Huskis' identitet og Androids er ren: `nativeNotifId()` er en
FNV-1a-hash klippet til et positivt 31-bits heltall (Androids varsel-ID er et
Java-`int`). Determinismen er hele poenget — det er den som gjør at den samme
planen speilet to ganger gir det samme varselet, ikke to.

Det som hashes er ikke nøkkelen, men **signaturen** (`nativeNotifSig()`):
nøkkelen, terskeltiden og teksten. Grunnen er at de tre kan skille lag.
Nøkkelen bærer objektets tidsVERDI («2026-09-02T09:00»), som er lokal veggtid,
mens terskeltiden `at` er det absolutte millisekundet den veggtiden peker på —
og det avhenger av tidssonen. Reiser telefonen til en annen sone, får det SAMME
logiske varselet et nytt `at` uten at nøkkelen rører seg. En diff på nøkkelen
alene ville da sett en alarm som «finnes allerede» og latt den bli stående og
ringe på gammelt klokkeslett. Med tiden inne i signaturen blir den flyttede
alarmen et annet tall, og diffen gjør det den skal: den gamle avlyses, den nye
legges inn. Teksten er med av samme grunn — et objekt som får nytt navn, eller
et språkbytte, endrer hva telefonen skal si uten å endre hvilket varsel det er.

Det betyr også at `getPending()` aldri trenger å levere mer enn ID-er, og på
Android er det klokt: `schedule.at` kommer tilbake derfra som en serialisert
Java-`Date`, ikke som noe man kan sammenligne på.

**Alarmene er upresise med vilje.** Hvert varsel planlegges med
`isExactNotification: false`, som gir `AlarmManager.setAndAllowWhileIdle()`:
systemet kan flytte det, men det fyrer også i dvale. Tersklene er
«fristen er utløpt» og «begynner innen en uke», ikke alarmer på sekundet, og
SCHEDULE_EXACT_ALARM er derfor **trukket tilbake** fra pluginens manifest med
`tools:node="remove"`.

Prisen står i Androids egen kvote, og den er verdt å kjenne når man tester:
en app får **én slik alarm levert per ni minutter mens telefonen er i dvale**
(skjermen av, ingen bruk). To varsler som er planlagt tett etter hverandre
kommer derfor ikke tett etter hverandre på en telefon som ligger stille — det
andre venter til kvoten løper ut. Med skjermen på og telefonen i bruk er
telefonen ikke i dvale, og alarmene fyrer som planlagt. Dette er
plattformoppførsel, ikke en feil i Huskis, og det er prisen for å slippe en
tillatelse Google Play krever et eget skjema for. En tillatelse Huskis ikke trenger — og som Google Play
krever et eget skjema for — skal appen ikke be om.

#### Varselkanalen: heads-up, og ikke mer enn det

Varslene har sin **egen Android-kanal**, og den er satt opp slik at Android
normalt viser dem som et **heads-up**: banneret som legger seg over skjermen.

| Egenskap | Verdi | Hvorfor |
|---|---|---|
| `id` | `huskis-notif-v1` | stabil og VERSJONERT; se migreringen under |
| `importance` | `4` (IMPORTANCE_HIGH) | lyd, og heads-up når Android tillater det |
| `vibration` | `true` | telefonen skal kunne ligge med lyden av |
| lyd | Androids vanlige varsellyd | ingen medbrakt lydfil |
| navn/beskrivelse | `notif.android.channelName` / `…Desc` | brukerrettet tekst, og den følger appspråket (docs/sprak.md) |

**Låseskjermen står ikke i tabellen, og det er ikke en forglemmelse.** En app
kan ikke sette kanalens `lockscreenVisibility`: Android nullstiller feltet når
det er appen som oppretter kanalen — i AOSP står linjen i
`PreferencesHelper.createNotificationChannel`, under kommentaren «Reset fields
that apps aren't allowed to set». Det gjelder også pluginens egen
PUBLIC-standard. Hva som vises på en låst skjerm er derfor brukerens egen
innstilling, med varselets `VISIBILITY_PRIVATE` (satt av pluginen) som
utgangspunkt.

Det er også den trygge veien: et Huskis-varsel bærer objektets navn, og PUBLIC
ville tvunget den teksten fram på en låst telefon. Skulle full tekst på
låseskjermen noen gang bli et produktkrav, er det en egen avgjørelse — ikke en
bieffekt av at varselet skal være synlig.

Lyden er ikke satt, og det er et VALG: pluginen rører bare kanalens lyd når et
`sound` sendes inn, og en Android-kanal har systemets vanlige varsellyd fra
fødselen. En egen lydfil ville vært en fil til å vedlikeholde uten at noen har
bedt om den.

**Hvert varsel planlegges eksplisitt med `channelId`**, og — for Android 7 —
**med høy prioritet på varselet selv**, og **kanalen opprettes før noe
planlegges** — første steg i hver speiling, ikke bare i de rundene som
har en alarm å legge inn. Rekkefølgen er et krav, ikke en detalj: pluginen
bygger hele `Notification`-objektet — kanalen inkludert — i det samme kallet
som armerer alarmen, og legger det ferdige objektet i alarmen. Uten `channelId`
havner varselet på pluginens egen `default`-kanal, som lages med
IMPORTANCE_DEFAULT og altså legger seg stille i varselpanelet.

At kallet står foran HELE runden har en grunn til: navnet og beskrivelsen er
brukerrettet tekst, og `createChannel` er det ene som kan oppdatere dem på en
kanal som finnes. Et språkbytte når dermed Androids innstillinger også på en
telefon som ikke har en eneste alarm å planlegge. Kallet er memoisert per
språk, så det koster én tur over broen per oppstart eller språkbytte.

**Android 7 (API 24–25) har ingen kanaler**, og minSdk er 24. Der er hele
kanalen uten virkning, og det er varselets EGEN prioritet som avgjør om
systemet viser det som et heads-up. Pluginen setter `PRIORITY_HIGH` bare når
notifikasjonen bærer `foreground: true`, ellers `PRIORITY_DEFAULT` — så det
feltet settes på hvert varsel. Navnet er iOS-ens, men på Android gjør feltet
KUN dette ene, og Android 8+ ser bort fra prioriteten til fordel for kanalens
viktighet. Se «Én synlig varsling» for hvorfor det ikke rører produktregelen.

To unntak, og de er begge bevisste:

- **En NEDRIGGING lager ingen kanal.** Tas planen ned — brukeren slo av
  varslene, en annen enhet slo dem av, eller en ny bruker logget inn — er en
  kanal å vise varsler i det siste den runden trenger. Den skriver heller ikke
  migreringsmerket.
- **En kanal som ikke lot seg opprette stopper runden.** Et varsel planlagt mot
  en kanal som ikke finnes blir aldri vist på Android 8+, så en svelget feil
  ville gitt stumme alarmer — og et merke og en signatur som sier «ferdig».
  Feilen kastes videre, signaturen står urørt, og neste runde gjør hele jobben.
  Det ene svaret som IKKE stopper noe er `UNAVAILABLE`/`UNIMPLEMENTED`: det er
  Android under 8, der kanaler ikke finnes og `channelId` er et felt pluginen
  ser bort fra. Varselet kommer fram som før — med prioriteten, som er det som
  gjelder der. Svaret kan ikke endre seg mens appen kjører, så det huskes.

**HIGH er en FORESPØRSEL, ikke en garanti.** Android eier presentasjonen:
brukeren kan skru kanalen ned i systeminnstillingene, «Ikke forstyrr» kan holde
den tilbake, og produsentenes egne strømsparings- og varselregler kan gjøre det
samme. Huskis ber om høy viktighet; om det faktisk blir et heads-up, er
systemets avgjørelse. Derfor finnes det heller **ingen egen Huskis-innstilling
for dette** — knappene står i Androids varselinnstillinger for appen, der
brukeren allerede leter etter dem, og de gjelder kanalen.

**Og det er med vilje bare en kanal.** Ingen `fullScreenIntent`, ingen
USE_FULL_SCREEN_INTENT, ingen TURN_SCREEN_ON, ingen wake lock, ingen ny
alarmtillatelse — og alarmene er fortsatt UPRESISE. De mekanismene hører til
alarmklokker og innkommende anrop: de eier skjermen og vekker brukeren. Huskis'
terskler er «fristen er utløpt» og «begynner innen en uke»; de skal være
synlige, ikke uunngåelige. Hver av tillatelsene koster dessuten sin egen
gjennomgang i Google Play, og en app som ikke trenger en tillatelse skal ikke be
om den.

#### Migreringen til kanalen

**Android låser en kanals viktighet i det den opprettes.** `createChannel` på en
kanal som allerede finnes oppdaterer BARE navn og beskrivelse — viktighet og
vibrasjon står som de ble laget. Det er derfor id-en er
versjonert: skal innstillingene noensinne endres, må kanalen få en NY id.

En installasjon som oppgraderes har alarmer som ble armert før kanalen fantes,
og de bærer den gamle kanalen med seg — objektet ligger ferdig bygget i
alarmen, og kan ikke endres etterpå. `getPending()` kan ikke hjelpe oss å
plukke ut nettopp dem: svaret bærer id, tekst, tidspunkt, `extra` og
exact-flaggene, men **ingen `channelId`** — pluginen lagrer det appen sendte
inn, og en eldre Huskis sendte ingen kanal i det hele tatt.

Derfor er migreringen én regel, og den gjelder HELE planen:

> Står ikke enhetens merke (`hk-notif-android-channel`) på gjeldende kanal-id,
> er ingen alarm «allerede planlagt». Hele planen planlegges på nytt, og merket
> skrives etterpå.

- **Ingen dubletter.** Alarmen har den samme id-en, og pluginen avlyser den
  gamle alarmen for den id-en selv før den armerer den nye.
- **Ingenting kan gå tapt.** Det er en ren PLANLEGGING, ikke «avlys, så
  planlegg» — den rekkefølgen ville etterlatt telefonen uten alarmen om appen
  døde imellom.
- **Idempotent.** Merket skrives først når runden har vært gjennom broen, så en
  runde som feilet gjentas i stedet for å bli hoppet over; og når merket står,
  gjør neste runde ingenting. En enhet uten alarmer er ferdig migrert med det
  samme — alt som planlegges etterpå bærer kanalen uansett.
- **Signaturen hopper ikke over den.** En enhet som skal migreres svarer `null`
  på `sig(plan)` («spør meg hver gang»): en uendret plan er ikke det samme som
  ingenting å gjøre når alarmene står på feil kanal.
- **Merket er ikke et løfte om at kanalen finnes.** Det sier bare at ingen alarm
  på enheten er eldre enn kanalen. Kanalen selv sikres av at hver runde
  begynner med å opprette den, og av at en runde som ikke fikk det til, feiler.

Låst av `tests/notif-channels.test.js` 13, som gjør begge veiene: migreringen
alene i en kjørende app, og den samme migreringen over en appoppgradering — og
som prøver de tre kantene rundt den: en kanal som ikke lot seg opprette (ingen
varsler, intet merke, og neste runde gjør jobben), et språkbytte uten en eneste
alarm, og et Android uten kanaler i det hele tatt.

#### Oppstart og brukerbytte: hvem alarmene tilhører

Alarmene ligger i telefonens egen alarmkø. De overlever både prosessen og en
appoppgradering, og de bærer **objektnavn** — som er én brukers. Når en bruker
logger inn, er spørsmålet derfor ikke bare «hva skal planlegges?», men «hvem
tilhører det som alt ligger her?».

To tilfeller ser like ut fra klienten, og de er helt ulike:

| Situasjonen | Hva som skal skje |
|---|---|
| Den SAMME brukeren starter appen på nytt (en bufret økt gjenopprettes) | ingenting. Alarmene er hennes egne, og allerede riktige |
| En ANNEN bruker overtar enheten — eller ingen gjør det (utlogging) | forrige brukers alarmer rigges ned FØR den nye planen gjelder |

Det som skiller dem er et merke på enheten, `hk-notif-android-user`: uid-en som
telefonens alarmer sist ble speilet for.

> Tar den samme brukeren over sin egen plan, røres den ikke. Ellers — en annen
> bruker, eller et merke vi ikke kan lese — rigges planen ned.

- **Merket skrives til slutt**, etter at speilingen har vært gjennom broen, og
  fjernes når planen tas ned. Det er samme regel som kanalmerket: en runde som
  feilet skal ikke etterlate et krav på eierskap den ikke gjennomførte.
- **Ukjent regnes som en annens.** Et merke som mangler kan bety to ting — en
  installasjon eldre enn merket, eller en opprydning som feilet — og de kan ikke
  skilles. Prisen for å rydde er en ekstra runde; prisen for ikke å rydde ville
  vært forrige brukers påminnelser på en ny brukers telefon.
- **En opprydning kan ikke gå tapt, bare bli utsatt.** Feiler nedriggingen i
  broen, står merket igjen og sier fortsatt «en annens» — og neste oppstart
  prøver på nytt. Den er dessuten uavhengig av kanalen: den går selv om
  tillatelsen er trukket og ingen speilingsrunde kan kjøre.
- **En runde utstedt FØR byttet speiler ikke i det hele tatt.** En speiling
  regner ut planen sin først og går så over broen (`state()`, og køen foran
  `sync()`), så en utlogging imellom gjør planen til en annen brukers.
  Identiteten leses derfor der planen ble regnet ut, og på nytt rett før broen
  røres — `notifEpoch`, den samme epoken som verner om de andre svarene som kan
  lande for sent (se «Et svar som lander for sent gjelder ikke lenger»). Har den
  endret seg, faller runden bort med signaturen urørt, og den nye brukerens egen
  runde gjør hele jobben. Uten det ville nedriggingen avlyst alarmene, og runden
  bak den lagt den utloggede brukerens alarmer inn igjen — med objektnavnene
  hennes, og uten en økt til å rydde dem. Merket skrives tilsvarende ikke av en
  runde som ble utstedt før byttet.

**Merket er nødvendig fordi en opprydning ikke kan gjøres blind.** Speilte
opprydningen bare en TOM plan inn i kanalen, ville diffen avlyst alt den fant — og
ved en vanlig oppstart «logger» appen inn fra den bufrede økten, så det den fant
var den samme brukerens egne alarmer: avlyst, og lagt inn igjen en runde senere
(`cancel:2 → schedule:2` for de samme id-ene). Vinduet imellom er kort og lukker
seg selv mens appen kjører, men det er ekte: dør prosessen der, eller feiler
runden som skal legge dem inn igjen, står telefonen uten alarmer til appen åpnes
neste gang. Kanalen er lokal nettopp for at telefonen ikke skal trenge appen for
å varsle.

**Og alt som rører alarmkøen står i ÉN kø.** Nedriggingen går rett på adapteren —
uten vilje, uten tillatelse og uten en plan — mens speilingene serialiserer seg
selv (`notifChSyncing`). Lå de to i broen samtidig, kunne nedriggingens `cancel`,
regnet ut fra et `getPending()` som svarte SENT, avlyst alarmene speilingen
nettopp la inn: den nye brukeren ville stått uten alarmer, mens signaturen sa
«speilet».

Låst av `tests/notif-channels.test.js` 14: en vanlig omstart som verken avlyser
eller planlegger noe, et reelt brukerbytte som rydder selv uten tillatelse, og de
fem kantene — en runde som feiler i broen og beholder de tidligere gyldige
alarmene, en opprydning som feiler og blir prøvd på nytt ved neste oppstart, en
treg nedrigging som ikke kan ta den nye brukerens nye alarmer, en enhet uten
merket som starter uten nett og likevel får planen tilbake, og en speiling som
ble utstedt før utloggingen og derfor ikke får planlegge noe.

#### Hva en ENHET har svart, og hva bare et øye kan svare på

Alt over er dekket av `tests/notif-channels.test.js` mot en fake pluginbro, og
omregningen av veggtid av `HuskisWallClockTest` på JVM-en. Ingen av dem ser
ANDROID. Det gjør `tests/android-device.js`: den maskinelle runden mot en ekte
telefon eller en emulator, kjørt av
`.github/workflows/android-device.yml` på hver PR som rører Android-siden.

Harnesset snakker DevTools-protokoll med appens egen WebView over `adb forward`.
Det planlegger ingenting selv — det ber ADAPTEREN om runden og leser svaret ut
av Androids egne dumper. Er enheten innlogget med varsler PÅ, er subjektet
brukerens EGEN plan; ellers planlegges tre syntetiske alarmer gjennom den samme
adapteren, og punktene som krever en økt rapporteres som hoppet over, med
grunnen.

Dette er MÅLT på enhet:

| Det som måles | Hvordan |
|---|---|
| planen ligger i Androids alarmkø | `dumpsys alarm`: én armert alarm per terskel, på tidspunktet planen sier |
| alarmene er upresise og vekkende | alarmens egen `type=RTC_WAKEUP`, og ingen SCHEDULE_EXACT_ALARM i den INSTALLERTE APK-en (`dumpsys package`) |
| kanalen finnes, med høy viktighet | pluginens `listChannels()` leser Androids egen NotificationManager |
| en vanlig appomstart rører dem ikke | samme kø før og etter, OG ingen `cancel`/`schedule` over pluginbroen (Capacitors egen logg) |
| prosessen fjernet | `am kill` — og køen står |
| telefonen restartet | `adb reboot`, og alarmene er tilbake på de samme tidspunktene |
| varselet blir levert med appen borte | `dumpsys notification`: postet på `huskis-notif-v1`, rangert HIGH |
| trykket bærer pekeren inn, også fra kaldstart | pluginens egen tapp-intent, sendt med `am start` mot en død prosess |
| brukerbyttet rydder | enhetens eiermerke settes til en annen uid, og oppstarten rigger ned |

**`am kill`, ikke `force-stop`.** De to ser like ut og er helt ulike: en
`force-stop` AVLYSER appens alarmer og setter appen i «stopped state», der den
ikke får kringkastinger i det hele tatt. Da prøver man Androids regel for en app
brukeren har stoppet — ikke Huskis' kode, og ikke det en sveip i Recents gjør. Den
ene gangen `force-stop` likevel brukes er i OPPRYDNINGEN etter en avbrutt runde
på en enhet uten innlogget bruker: der er avlysningen nettopp poenget, for
ingen speilingsrunde finnes som ville ryddet de syntetiske alarmene. På en
innlogget telefon gjøres det aldri — køen er brukerens egen, og diffen heler den
ene overflødige raden selv.

**Tapp-intenten er pluginens, ikke vår.** `contentIntent` er en
`PendingIntent.getActivity` over MAIN/LAUNCHER mot MainActivity, med
SINGLE_TOP|CLEAR_TOP og tre extras — varsel-ID-en, handlingen og hele varselet
som JSON. `am start` med nøyaktig de samme extras leverer altså det samme som et
trykk. Det ADB ikke kan, er fingeren: at varselet er SYNLIG og trykkbart er et
øyepunkt. Formene er lest ut av en pinnet pluginversjon, og
`tests/android-alarm-queue.test.js` feller et versjonsløft som ikke har vært
innom dem.

Og det enheten IKKE kan svare på maskinelt er presentasjonen, fordi Android eier
den: **heads-up-banneret, lyden/vibrasjonen og låseskjermen**. Harnesset skriver
dem ut som tre spørsmål til slutt, og de er de eneste som står igjen for et
menneske (`docs/mobilapp-plan.md`).

Ikonene står under «Ikonene i et systemvarsel».

### Nettleser: web push

Fire ledd, og alle fire må finnes for at kanalen skal eksistere:
`serviceWorker`, `PushManager`, `Notification` og en **avsendernøkkel**
(`pushPublicKey` i `config.js`). Står nøkkelen tom, finnes kanalen ikke — det er
ikke «av», for det er ingen sender å melde seg på hos.

**Nøkkelparet.** VAPID (RFC 8292) identifiserer SENDEREN overfor
push-tjenesten. Den offentlige halvdelen ligger i `config.js` og er ment å ligge
der; den private ligger i Supabase Vault og finnes ingen steder i repoet. Bare
den private kan lage en gyldig signatur, så den offentlige gir ingen tilgang til
noe. Paret lages én gang, manuelt — stegene står i [`../TODO.md`](../TODO.md).

**Abonnementet er nettleseren.** `endpoint` er globalt unikt, så en ny
innlogging i samme nettleser FLYTTER abonnementet til den nye brukeren i stedet
for å lage en dublett. `push_subscribe()` er idempotent på endepunktet og
kjøres på nytt hver synk-runde det er noe å oppdatere: et endepunkt nettleseren
har rullert, nye etiketter etter et språkbytte, eller et abonnement som ble
meldt av ved utlogging. Fornyelsen er dermed selvhelbredende og spør aldri om
tillatelse på nytt.

**Et eierskifte tømmer køen.** Flyttingen over gjelder raden — men køen som lå
på den er den FORRIGE brukerens, og hver levering bærer et objektnavn. Uten en
tømming ville den nye brukerens nettleser vist forrige brukers varsler i det de
forfalt. `push_subscribe()` sletter dem derfor i den samme operasjonen som
flytter raden, og `push_claim()` plukker aldri opp en levering der
abonnementets eier ikke lenger er leveringens: andre lag gjør en rad som
likevel skulle bli hengende igjen INERT i stedet for feillevert.

**Avmeldingen går lokalt FØRST.** Det er avmeldingen i nettleseren som faktisk
stopper et varsel: uten service worker finnes det ingen som kan vise et, og et
avmeldt endepunkt gir 410 ved neste sending — som slår raden av på serveren av
seg selv. Ble serveren spurt først og svarte feil, ville hele den lokale
nedriggingen blitt hoppet over, og en utlogging UTEN NETT hadde gitt det
motsatte av hensikten: en utlogget nettleser som fortsetter å vise varsler med
objektnavn. Serveropprydningen er derfor best effort, og skjer etterpå.

**Hva et abonnement får være.** `endpoint` blir målet for et HTTP-kall senderen
gjør på vegne av serveren, og en innlogget konto er hele inngangsbilletten.
`push_subscribe()` setter derfor tre grenser, alle på serveren:

| Grense | Regel | Hvorfor |
|---|---|---|
| Endepunktet | `https://`, et vertsNAVN (ikke en bar IP, ikke `localhost`), ingen kontrolltegn, maks 2000 tegn | En vilkårlig URL ville gjort senderen til en måte å banke på dører på innsiden |
| Nøklene | base64url, `p256dh` 80–200 tegn og `auth` 16–40 | RFC 8291 sier 65 og 16 byte; grensene er romsligere (padding), men holder søppel ute av en tabell senderen leser fra |
| Antall | maks `push_sub_max()` (20) rader per bruker | Hvert abonnement multipliserer BÅDE utboksen og antallet HTTP-kall. Uten et tak er RPC-en en forsterker |

Ingen liste over pushleverandører: Web Push har ingen fast tjenesteliste, og en
slik liste ville låst appen ute fra enhver nettleser som ikke sto på den.

Taket kaster ut den **eldst sette**, aldri den som nettopp meldte seg på — den
er den brukeren står med i hånden. Kaskaden tar utboksen til den som ryker med
seg.

**Etikettene følger med abonnementet.** De fire typetekstene lagres i
`labels`, på brukerens språk. Service workeren har ingen ordbok, og SQL skal
ikke ha en — uten dette leddet måtte i18n ha ligget to steder til.

**Utlogging melder av.** Avmeldingen kjøres FØR sesjonen slippes: et abonnement
som ble stående ville sendt varsler med objektnavn til en nettleser ingen er
logget inn i. Med en frist på tre sekunder, og den er ikke pynt — dette er det
eneste nettverkskallet som står mellom brukeren og utloggingen, og en treg
server skal ikke kunne holde noen innlogget. Den lokale nedriggingen ligger
først i rekkefølgen nettopp derfor: den er ferdig lenge før fristen kan løpe
ut.

### Hvilke deployer som får melde seg på

Et push-abonnement hører til en nettleserkontekst på ET ORIGIN, ikke til en
maskin. Hver Vercel preview-deploy har sitt eget origin, og hver av dem kan
derfor legge igjen sitt eget abonnement på den ekte kontoen — «enheter»
brukeren aldri har bedt om, i produksjonens egen liste.

`pushDeployAllowed()` lukker det, i to lag, akkurat som redirecten til det
kanoniske originet:

1. **build-stempelet.** `build.js` skriver `<meta name="huskis-deploy">` ut fra
   `VERCEL_ENV`: `preview`, `production` eller `dev`. Sier det `preview`, er
   porten stengt uansett host.
2. **verten.** Ellers må verten være en Huskis kjenner: det kanoniske originet,
   en av hostene som redirecter dit (`www.huskis.no`, `huskis.vercel.app`), eller
   den lokale serveren (`localhost`/`127.0.0.1` — som også er verten
   mobilappens WebView serverer fra). Alt annet er nei.

Regelen **feiler lukket**: en ukjent vert er nettopp det en flyktig
preview-adresse er. Domenelisten står ETT sted — guarden øverst i `index.html`
(`window.__huskisCanonical`) — og leses derfra;
[`domains-and-urls.md`](domains-and-urls.md) er autoritativ.

Testene er upåvirket: de kjører på `localhost`, og `?mock=1` bytter hele
backenden. Det trengs ingen egen testmodus for dette.

**Porten rydder også opp etter seg.** Den stopper NYE påmeldinger, men sier
ingenting om det som allerede ligger der: en forhåndsvisning som ble åpnet før
porten fantes, har en service worker og et abonnement på sitt eget origin — og
det abonnementet lever videre og teller som en enhet i produksjonskontoens
liste, mens panelet på nettopp den siden sier at varsler er slått av her. To
påstander som ikke kan være sanne samtidig.

`sweepBlockedPush()` rigger det derfor ned ved oppstart på en deploy porten
stenger: abonnementet meldes av, service workeren avregistreres, bryteren for
DETTE originet settes av, og serverraden fjernes (`push_unsubscribe`) så snart
det finnes en økt å gjøre det med — nedriggingen venter ikke på en innlogging,
men serverkallet må. Endepunktet tas vare på mellom de to skrittene; etter
`unregister()` finnes det ikke å hente lenger.

Alt er **best effort**: en forhåndsvisning skal ikke bli ubrukelig av at
opprydningen feilet, så hvert ledd står for seg. Og bare VÅRT ryddes —
`getRegistration()` uten argument gir registreringen som dekker dette
dokumentet, altså Huskis' egen på Huskis' eget origin.

**Best effort er ikke det samme som å gi opp.** PostgREST melder en avvist RPC i
`error`, ikke som et unntak, så svaret leses eksplisitt: går serverkallet galt,
BEHOLDES endepunktet, og et nytt forsøk kommer med en senere synk-runde —
tidligst etter et minutt, og med ett forsøk om gangen. Uten pausen ville hver
runde (5 s) hamret på en server som nettopp sa nei; uten at endepunktet ble
beholdt, var raden fanget for godt, siden `unregister()` allerede har fjernet
den lokale kilden.

**Å rydde krever mindre enn å lage.** Et nytt abonnement trenger en
VAPID-nøkkel og Notification-API-et; å fjerne et gammelt trenger bare service
worker-registeret. De to spørsmålene står derfor hver for seg
(`webChannel.capable()` mot `pushCleanupPossible()`) — ellers ville en build
uten avsendernøkkel gjort det umulig å bli kvitt abonnementet en tidligere
build la igjen, altså nettopp den situasjonen opprydningen finnes for.

### Enhetene med varsler

Panelet sier hvor mange enheter som har varsler på, og «Vis enheter» åpner
listen — den bor i konto-modalens skuff «Enheter og økter», sammen med de
innloggede øktene ([`accounts.md`](accounts.md) er autoritativ for den skuffen).
Brukeren skal ikke trenge å vite hva et endepunkt, en service worker eller et
origin er; raden sier «Chrome · Android», verten, og når den sist ble sett.

**Listen er ETT spørsmål, ikke to.** «Hvor kommer varslene også når Huskis er
lukket?» har to svar i Huskis — en nettleser med web push, og Android-appen med
sine lokale alarmer — og for brukeren er det den samme tingen. Listen dekker
derfor begge, og hver rad bærer en `kind` (`web` eller `native`) som avgjør
hvilken vei «Slå av» går:

| | `kind: 'web'` | `kind: 'native'` |
|---|---|---|
| Sannheten ligger i | `push_subscriptions` | `native_notif_devices` |
| Raden sier | «Chrome · Windows», og verten | «Huskis · Android», uten vert |
| Identiteten er | endepunktet | klientkonteksten (`device_id` + `origin`) |
| «Denne enheten» avgjøres av | at klientens eget endepunkt matcher | at klientens egen kontekst matcher |
| «Slå av» | `push_revoke(id)` | `native_notif_revoke(id)` |

**Den native raden bærer ingen vert.** Appens interne origin (`localhost`) er en
KONTEKSTNØKKEL, ikke en adresse brukeren har vært på — å vise den ville forvirret
uten å opplyse. «Huskis · Android» er allerede så navngitt raden kan bli.

**Metadataen er en klassifikasjon, ikke en måling.** Begge tabellene bærer
`browser`, `platform`, `origin` og `device_id` — et fast, lite ordforråd,
vertsnavnet, og enhetens egen lokale id. Hele user-agenten lagres ALDRI, og det
finnes ingen skjermmål, ingen fonter, ingenting som kan settes sammen til et
fingeravtrykk. Klienten sender verdiene selv, og runden holder dem — og
`seen_at` — ferske: `push_subscribe()` kjøres når endepunktet eller språket har
endret seg, `native_notif_touch()` når kanalstatusen har endret seg, og begge
ellers minst hvert kvarter.

**Endepunktene forlater aldri serveren.** `list_my_devices()` tar klientens eget
endepunkt og klientkontekst INN og bruker dem til å merke «denne enheten»; ingen
adresse går den andre veien.

#### Android i enhetslisten

Android har ikke noe abonnement å telle. Kanalen planlegger LOKALE alarmer, og
det er nettopp poenget med den — den virker uten server, uten sender og uten
nett. Men det som ikke finnes noe sted, kan ingen annen enhet se eller slå av,
og «Enheter med varsler» ville i praksis betydd «nettlesere med web push».

`public.native_notif_devices` er derfor et lite statusbord, og ikke mer enn det:

| Felt | Hva det er |
|---|---|
| `user_id` + `device_id` + `origin` | klientkonteksten — og en UNIK indeks, så én app er ÉN rad selv om den har logget inn flere ganger |
| `browser` / `platform` | «Huskis» / «Android», de samme klassifikasjonene som ellers |
| `enabled` | klientens egen rapport: er kanalen på her (bryteren PÅ og tillatelsen gitt)? |
| `seen_at` | sist appen sa fra |
| `revoked_at` | brukeren slo av varslene for denne appen fra en annen enhet |

Statusen meldes av `native_notif_touch()`, og den går **sjelden med vilje**:

| Utløser | Hvorfor |
|---|---|
| innlogging / `cloudStart()` | appen skal være synlig i listen fra første runde, ikke først etter et kvarter |
| brukeren slår varslene PÅ | eksplisitt (`p_explicit`) — det er den ene handlingen som opphever en fjern-avslåing |
| brukeren slår varslene AV | listen skal slutte å vise appen med det samme |
| statusen har endret seg | tillatelsen kan trekkes i systeminnstillingene mens appen står åpen |
| ellers: hvert kvarter | en puls, så metadataen ikke blir permanent foreldet |

Ingen skriving hvert femte sekund: en runde som verken har ny status eller har
ventet ut kvarteret sitt gjør ingenting — den går ikke engang over pluginbroen
for å spørre om tillatelsen, for bryteren i `localStorage` avgjør allerede at
kanalen er av. Og signalet over nullstiller bare dempingen så lenge klienten og
serveren er UENIGE; er nedriggingen alt gjort, står runden stille igjen.

**Et svar som lander for sent gjelder ikke lenger.** Statusrunden er et
nettverkskall, og tilstanden det gjaldt kan ha blitt en annen mens vi ventet. To
ting gjør et svar foreldet, og de er ikke det samme:

| Hva som endret seg | Eksempel | Hva et gammelt svar ville gjort |
|---|---|---|
| **identiteten** | utlogging, kontobytte | et `revoked` fra forrige konto avlyser den NYE kontoens alarmer |
| **viljen** | brukeren trykket «slå på» | et `revoked` utstedt før trykket river ned det hun nettopp slo på |

Begge bumper den samme epoken (`notifEpoch`), som leses FØR kallet og
sammenlignes når svaret lander. Speilingen av den lokale planen leser den også:
planen regnes ut for ÉN bruker, og en utlogging mens runden står i broen skal
ikke kunne legge den brukerens alarmer inn igjen etter nedriggingen (se
«Oppstart og brukerbytte»). Den andre halvdelen er ikke en detalj: uten den
holder det med et raskt AV/PÅ for at en gammel runde skal overstyre valget.
Epoken bumpes derfor i det bryteren trykkes — før tillatelsesdialogen, som kan
stå oppe en stund — og web push-fornyelsen leser den samme epoken. En nedrigging
etter en fjern-avslåing (`notifChannelRevokedHere()`) bumper den også: kanalen er
av her fra da av, og en runde som var på vei med «på» skal ikke sette serveren
tilbake til noe brukeren ikke har.

**Og rekkefølgen: én skriving om gangen.** Epoken verner om SVARET. Den verner
ikke om SKRIVINGEN: to statuskall som er i lufta samtidig når databasen i den
rekkefølgen nettet gir dem, og et gammelt «på» som landet etter et nytt «av»
ville latt SERVEREN stå igjen med «på» — telefonen ble stående i «Enheter med
varsler» med varsler brukeren nettopp slo av, til noe annet meldte fra.
`push_lock()` løser det ikke: den serialiserer transaksjonene, men vet ikke
hvilken av dem som bærer det nyeste valget.

Alle statusskrivinger går derfor gjennom én kø i klienten (`nativeNotifTouch()`),
utloggingens melding inkludert: et kall stiller seg bakerst og starter først når
det forrige har landet. Serverens siste skriving er dermed alltid klientens
siste valg, og et svar kan ikke lenger lande etter et nyere. En runde som har
stått i kø mens valget byttet, skriver ikke i det hele tatt — den ville skrevet
en vilje som ikke finnes lenger — og en automatisk runde som har fått en nyere
bak seg i køen droppes, så en treg server ikke gir et ras av skrivinger i det
den svarer. Det LOKALE valget venter ikke på køen: alarmene legges og avlyses på
telefonen med det samme.

**En app som ikke har varsler på, får ingen rad.** Runden går fra hver
innlogging på hver Android-enhet, også de som aldri slår varslene på; uten den
regelen ville tabellen fylt seg med rader som bare sier «av».

**En app uten en levende økt er ikke en varselenhet.** Listen krever at
klientkonteksten fortsatt har en økt i `device_sessions` → `auth.sessions`
(`native_notif_active()`). Det er utloggingsgarantien: en app som ble logget ut
— lokalt, fra en annen enhet, eller ved at kontoen ble slettet — skal ikke bli
stående som en «enhet med varsler» i påvente av at den utloggede klienten
samarbeider. Utloggingen melder i tillegg fra selv (`enabled = false`) og river
ned de planlagte alarmene, men listen er ikke avhengig av at det kallet kom
fram.

#### Fjern-avslåing av en Android-app: hva den kan love

Semantikken er den samme som for et abonnement — valget er varig, og bare et
eksplisitt «slå på varsler» i nettopp den appen tar det tilbake — men
GJENNOMFØRINGEN er en annen, og det skal ikke skjules.

Et web push-abonnement slås av på serveren, og da er det av: utboksen tømmes og
senderen plukker ingenting opp. Androids alarmer ligger derimot allerede i
telefonens egen alarmkø. Uten en pushkanal (FCM) har serveren **ingen vei inn**
til en app som ikke kjører, og Huskis innfører ikke en slik kanal for dette.

Rekkefølgen er derfor:

1. serveren registrerer avslåingen **umiddelbart** (`revoked_at`), og appen
   forsvinner fra listen med det samme;
2. en **åpen** app oppdager det i sin neste synk-runde — doc-et bærer
   `notif_revoked` for nettopp denne klienten, dempingen nullstilles,
   statusrunden går i den samme runden, serveren svarer `revoked`, og appen
   avlyser alarmene sine, setter bryteren av og oppdaterer panelet;
3. en **lukket** app gjør nøyaktig det samme neste gang den er i bruk og får
   kontakt med serveren;
4. i mellomtiden kan alarmer som allerede var planlagt fortsatt fyre.

Dette er **ikke** øyeblikkelig fjernstyring av en lukket app, og UI-et lover
ikke at det er det: kvitteringen etter et «Slå av» på en Android-rad sier
«Slått av. Huskis-appen tar ned varslene neste gang den er i bruk.» Én setning,
på det ene stedet den er relevant — ikke en advarsel som ligger i veien for alle
de andre radene.

**Automatisk synk kan aldri oppheve en fjern-avslåing.** Statusrunden sender
`p_explicit => false`, og serveren lar da raden bli liggende avslått og svarer
`revoked` i stedet. Bare bryteren i appen (`p_explicit => true`) tar valget
tilbake — nøyaktig som `push_subscribe(..., p_explicit => true)` gjør for en
nettleser.

**«Slå av varsler på alle andre enheter» dekker begge kanaltypene.**
`notif_revoke_others(endpoint, device_id, origin)` kaller `push_revoke_others()`
for abonnementene og markerer de native klientene som ikke er kalleren selv.
Gjeldende klient beholdes uansett hvilken type den er — derfor går både
endepunktet og klientkonteksten inn. Låsen (`push_lock()`) tas først, og dekker
begge tabellene: en statusrunde fra en av de andre klientene skal ikke kunne
melde seg på igjen rett etter at løkken leste listen sin.

#### Fjern-avslåing er varig

Å slå av varslene for en annen nettleser må bety noe. Var det bare en
midlertidig avslåing på serveren, ville den avslåtte nettleseren meldt seg på
igjen i neste synk-runde — og valget hadde i praksis ikke betydd noe.

Derfor har et abonnement TO måter å være av på, og de er ikke det samme:

| Felt | Hva det betyr | Hvordan det oppheves |
|---|---|---|
| `disabled_at` | push-tjenesten svarte 404/410 — endepunktet finnes ikke lenger | av seg selv: en nettleser som melder seg på igjen har nettopp bevist at endepunktet lever |
| `revoked_at` | BRUKEREN slo av varslene for denne nettleseren, fra en annen enhet | kun av et EKSPLISITT «slå på varsler» på nettopp den klienten (`push_subscribe(..., p_explicit => true)`) |

Begge betyr «ikke aktiv»: hverken utboksen, senderen eller telleren i
`get_my_doc()` ser en rad som har en av dem satt. `push_revoke(id)` og
`push_revoke_others(endpoint)` setter `revoked_at` OG avslutter det som ligger i
kø til abonnementet — ellers ville et varsel brukeren nettopp slo av kommet fram
noen minutter senere.

**Klienten får vite det.** Faller telleren i doc-et, går fornyelsen med én gang i
stedet for å vente ut vinduet sitt. Svarer `push_subscribe()` at abonnementet er
tilbakekalt, rigger klienten ned sin egen ende: service workeren avregistreres,
bryteren går av, og ingen ny påmelding skjer før brukeren selv slår den på.
Nedriggingen lar raden BLI STÅENDE på serveren (`disable({ keepRow: true })`) —
det er `revoked_at` som holder et gjenbrukt endepunkt fra å våkne som aktivt, og
sletter vi raden, kaster vi den garantien.

**Sporet er selve håndhevelsen, og det står for godt.** Den avslåtte nettleseren
har ikke lovet å bli åpnet igjen. Blir den liggende ubrukt, oppdager den aldri
tilbakekallingen lokalt — og den dagen den ÅPNES, gjør den det den alltid gjør:
fornyer abonnementet sitt. Fantes ikke raden lenger, ville den fornyelsen vært
en helt vanlig påmelding, og varslene hadde vært tilbake uten at brukeren rørte
noe. Avslåingen ville altså hatt en utløpsdato ingen ba om.

Derfor rører **verken opprydningen eller taket** en rad med `revoked_at` satt:

- opprydningen under gjelder kun 404/410-spor;
- taket (`push_sub_max()`) telles og håndheves på det AKTIVE settet. Det følger
  av hva taket er til for — forsterkeren er sendingen, og et tilbakekalt spor
  koster ingenting der. Telte det med, kunne tjue nye påmeldinger ha kastet ut
  nettopp raden som håndhever en avslåing.

**Nøklene tømmes når raden tilbakekalles.** `p256dh`/`auth` er mottakernøklene
som gjør det mulig å KRYPTERE til nettleseren, og et abonnement brukeren har
slått av skal ikke bli liggende med dem i det uendelige. Raden trenger bare
endepunktet og klientkonteksten — det er dem fornyelsen kjennes igjen på (se
under) — og `push_subscribe()` skriver ferske nøkler den dagen brukeren slår
varslene på igjen der.

**Sporet kjenner både endepunktet og klienten.** Et push-endepunkt er ikke
evig: nettleseren eller push-tjenesten kan rullere det
(`pushsubscriptionchange`), og en klient som lå ubrukt mens den ble slått av
oppdager aldri avslåingen lokalt. Åpnes den da med et NYTT endepunkt, ville et
spor som bare kjente det gamle vært blindt — og den helt vanlige, automatiske
fornyelsen hadde slått varslene på igjen uten at brukeren rørte noe.

`push_subscribe()` stiller derfor to spørsmål, ikke ett:

1. **er ENDEPUNKTET slått av?** Det vanlige tilfellet: den samme nettleseren
   melder seg på igjen med den samme adressen, og raden sier at brukeren slo
   den av.
2. **er hele KLIENTKONTEKSTEN slått av?** Konteksten er `user_id` +
   `device_id` + `origin`: kontoen, Huskis' egen tilfeldige id for denne
   nettleserkonteksten, og verten. Finnes det et tilbakekalt spor i den samme
   konteksten, avvises også et rullert endepunkt — og et endepunkt som rakk å
   bli registrert før sporet ble lest, tilbakekalles på stedet, så invarianten
   reparerer seg selv.

Dette er **ikke fingerprinting**. `device_id` er et tilfeldig tall Huskis selv
skrev i `localStorage` på dette originet; ingenting måles på maskinen. En
bruker som tømmer nettleserdataene sine får med rette en ny kontekst, og det er
greit — sporet er en robusthet mot rullerte endepunkter, ikke en
sikkerhetsgrense. Grensen er `user_id`, og den håndheves i begge spørsmålene:
logger noen andre inn i den samme nettleseren, arver de ikke forrige brukers
valg. En klient som ikke sender kontekst (en eldre versjon) får bare spørsmål 1.

Et eksplisitt «slå på varsler» gjelder tilsvarende KLIENTEN, ikke bare
endepunktet: brukeren står ved nettopp denne nettleseren og har sagt fra, og da
slettes sporene i konteksten — de har gjort jobben sin.

**«Slå av» gjelder ENHETEN, ikke URL-en.** Brukeren trykker på en rad som sier
«Chrome · Android» og mener nettleseren — ikke det tekniske endepunktet raden
tilfeldigvis bærer nå. Forskjellen er ikke akademisk: like etter en rullering
kan den samme klienten ha TO rader (`E1` fra før, `E2` fra fornyelsen), og slo
vi bare av den ene, fikk enheten fortsatt varsler etter at brukeren slo den av.
`push_revoke()` slår derfor av hele klientkonteksten: alle aktive rader med
samme `user_id` + `device_id` + `origin`, med køene deres avsluttet og nøklene
tømt. En eldre rad uten kontekst faller tilbake til seg selv — det er alt vi vet
om den. «Slå av på alle andre enheter» speiler det: den sparer HELE konteksten
til nettleseren som ringte, og slår resten av.

**De to operasjonene kan ikke passere hverandre.** En automatisk fornyelse og
et «slå av» fra en annen enhet kan treffe den samme klienten samtidig, og uten
en lås ville dette vært mulig: fornyelsen leser `revoked_at = null`, avslåingen
setter feltet og committer, fornyelsen skriver videre og UPSERT-en nullstiller
det igjen. Valget hadde vært borte, og ingen gjorde noe galt.

`push_subscribe()` låser derfor raden (`select … for update`) FØR den leser
tilstanden. Men radlåsen er ikke nok, for den farlige varianten har ikke ÉN
rad: ruller nettleseren endepunktet sitt, oppretter fornyelsen `E2` mens
avslåingen tar `E1` — to rader, ingen felles lås, og `E2` finnes kanskje ikke
ennå. «Slå av på alle andre enheter» har det samme problemet på tvers av
kontekster.

Låsen ligger derfor på BRUKEREN (`push_lock()`, en advisory lock som varer
transaksjonen ut), og tas av alle tre operasjonene som kan endre hva som er
aktivt: `push_subscribe()`, `push_revoke()` og `push_revoke_others()`. Da er
rekkefølgen et avgjort spørsmål: kommer avslåingen først, venter fornyelsen og
møter sporet; kommer fornyelsen først, venter avslåingen og tar hele konteksten
— også raden fornyelsen nettopp lagde. Alle rekkefølgene ender med AV, som er
det brukeren ba om. Granulariteten koster ingenting: en bruker har en håndfull
nettlesere, og hver av dem rører dette hvert kvarter.

Garantien ligger i databasen, ikke i klientens timing —
`supabase/tests/test-push-race.sh` kjører begge rekkefølgene i begge variantene
(samme endepunkt, og to ulike i samme kontekst) med to ekte, samtidige
databaseøkter.

#### Opprydning

Et spor som døde AV SEG SELV — push-tjenesten svarte 404/410 — blir liggende i
`push_keep_days()` (90 dager) og ryddes så bort av `push_subscribe()` mens den
likevel er inne på brukerens egne rader (ingen global feiing, ingen egen
kjøreplan).

Regelen rører **aldri et aktivt abonnement**. En enhet skal kunne motta varsler
selv om Huskis ikke har vært åpnet der på et år — det er nettopp da et varsel er
verdt mest. Og den rører **aldri et spor brukeren satte** (se over).

### Service workeren (`sw.js`)

Den finnes for én grunn: en nettleser kan ikke kjøre en timer når fanen er
lukket, så Web Push krever en service worker. Alt annet den KUNNE gjort, gjør
den ikke:

- **ingen `fetch`-lytter.** Huskis er ikke en PWA, og caching av appens egne
  filer ligger i cache-headerne og build-ID-en i URL-ene
  ([`auto-update.md`](auto-update.md)). En service worker som svarte på
  forespørsler ville lagt seg MELLOM nettleseren og de headerne, og blitt et nytt
  sted en gammel versjon kunne bli hengende. Uten `fetch`-lytteren er
  oppdateringsmodellen nøyaktig som før den ble registrert;
- ingen cache, ingen IndexedDB, ingen nettverkskall, ingen tilstand.

Den registreres først når brukeren har slått på kanalen, og avregistreres når
den slås av.

`push` viser varselet med `tag = <nøkkelen>`, så det samme varselet ERSTATTER
seg selv i stedet for å stable seg — samme regel som den unike nøkkelen i
databasen. En push uten lesbar kropp blir likevel et synlig varsel:
`userVisibleOnly: true` er et løfte til nettleseren, og brytes det, straffer den
abonnementet.

**Ikonene** (`icon` og `badge`) står under «Ikonene i et systemvarsel».

`notificationclick` **fokuserer en åpen Huskis-fane** og gir den pekeren OG
nøkkelen som en melding — fanen navigerer selv, med sin vanlige
tilgangskontroll. Finnes ingen åpen fane, åpnes appen med `?notif=<type>:<id>`;
app.js plukker den opp når den er innlogget og synket, og fjerner den fra
adressen, så en reload ikke navigerer igjen.

### Ikonene i et systemvarsel

Et systemvarsel har TO ikoner, og de er ikke det samme bildet. Begge er
rasterisert fra `favicon.svg` av `tests/lag-varselikoner.js` — merket har ÉN
kilde — men de tegnes på hver sin måte, fordi Android bruker dem på hver sin
måte:

| | Hva det er | Hvor det ligger |
|---|---|---|
| Det store, i FARGE | merket slik det ser ut | web push: `assets/notif/huskis-icon-192.png` (`icon`) · Android: `ic_huskis_notification` (`largeIcon`) |
| Det lille, som MASKE | merket som konturer, monokromt | web push: `assets/notif/huskis-badge-96.png` (`badge`) · Android: `ic_stat_huskis` (`smallIcon`) |

**Det lille er en ALFAMASKE.** Android kaster fargene og tegner formen i
statuslinjens egen — bare alfakanalen betyr noe. Brukes den fargelagte logoen
der, blir alt som ikke er gjennomsiktig hvitt, og de mørke konturene som BÆRER
motivet forsvinner: resultatet er en hvit klump. Masken er derfor en egen
tegning av det samme motivet: det fremste kortet med sine tre punkter og
linjer, og to kortHJØRNER bak det. Motivet er favicon-ens, målene er det ikke —
i favicon-en dekker de fylte kortene hverandre, mens en maske ikke har noe fyll
å dekke med. Hvert synlige ledd må derfor tegnes for seg og ha luft rundt seg,
ellers går strekene i ett ved 24 dp.

**Det store maskeres til en SIRKEL.** Android — og Samsungs One UI særlig —
runder av det store varselikonet, så et merke som fyller kvadratet får hjørnene
av kortene klippet vekk. Merket skaleres derfor ned om sitt eget sentrum til
det ligger innenfor den innskrevne sirkelen. Bakgrunnen er gjennomsiktig.

**Det store får en strek som SKALERER.** I webappen er merkets strek 1 px
uansett visningsstørrelse (`docs/design-system.md` → «Ikoner»); her tegnes det
192 px bredt, og 1 px av 192 er ikke en kontur. Generatoren skrur derfor den
regelen av for nettopp denne rasteren og bruker en strekbredde i favicon-ens
eget 24-rutenett i stedet (`IKON_STREK`). Appikonet på Android gjør det samme,
av samme grunn (`docs/mobilapp-plan.md`).

Den native `largeIcon` er en PNG og ikke en vector drawable fordi pluginen
dekoder ressursen med `BitmapFactory.decodeResource`, som ikke kan lese en
vector. `smallIcon` skal stå støtt alene uansett: et varsel i statuslinjen har
bare den.

Geometrien til masken står ETT sted — `tests/lag-varselikoner.js` — og skriver
både PNG-en og `ic_stat_huskis.xml`. Redigeres den, kjøres skriptet på nytt;
`tests/notif-channels.test.js` (10) sjekker at de to ikke har skilt lag, og at
det store ikonet fortsatt bærer favicon-ens fyllfarger.

**Native ressurser kan ikke leveres over OTA.** Ikonene ligger i binæren, ikke
i web-pakken, så en endring i dem krever et nytt Android-skall og et nytt
`versionCode` ([`mobilapp-plan.md`](mobilapp-plan.md)).

### Senderen

Databasen eier køen, rekkefølgen og idempotensen. Edge-funksjonen
`supabase/functions/push-send` eier HTTP-kallet — og bare det.

1. `notify_record()` fyller utboksen (`push_enqueue`): én rad per (planlagt
   varsel, aktivt abonnement), `due_at = varselets terskeltid`. Den unike
   indeksen `(notification_id, subscription_id)` er idempotensen: det samme
   logiske varselet kan ikke sendes to ganger til det samme abonnementet,
   uansett hvor mange ganger generatoren kjører.
2. `pg_cron` kaller `push_tick()` hvert minutt, som dytter Edge-funksjonen i
   gang med `pg_net` — nøyaktig det oppsettet e-postvarselet ved deling allerede
   bruker, med hemmeligheten i Vault og adressen i `app_config`. Uten
   konfigurasjon gjør tikket ingenting og feiler ikke. Tikket dytter bare når
   det finnes arbeid som FAKTISK kan sendes (`push_due_count()`).
3. `push_claim()` henter forfalte leveringer og LÅSER dem (`claimed_at`,
   `for update skip locked`). To samtidige kjøringer kan derfor ikke sende det
   samme, og en kjøring som dør halvveis blir hentet inn igjen av den neste i
   stedet for å bli stående.
4. Funksjonen signerer (VAPID), krypterer (RFC 8291) og sender.
5. `push_report()` tar imot utfallet: levert, **dødt** (404/410) eller
   midlertidig (prøves igjen, opptil fem forsøk).

**Et dødt endepunkt tar KØEN sin med seg.** 404/410 betyr at endepunktet ikke
finnes lenger, og da er ikke bare den ene leveringen tapt — alt som ligger i kø
til det samme endepunktet er like usendbart. `push_report()` slår derfor av
abonnementet OG avslutter resten av køen til det (`status = 'gone'`), og
`push_claim()` plukker aldri opp en levering til et avslått abonnement. To lag,
og de svarer på hver sin ting: opprydningen gjør at `push_tick()` ikke våkner
hvert minutt for arbeid som aldri kan lykkes (`push_due_count()` teller bare det
som faktisk kan sendes), og sjekken i `push_claim()` gjør en rad som likevel
skulle bli stående INERT i stedet for forsøkt igjen.

**Hvordan senderen autentiserer seg.** Kallet fra `pg_cron` er
service-to-service, ikke en brukersesjon, og Supabase har ett mønster for
nettopp det: en **secret key** på `apikey`-headeren, med plattformens
JWT-verifisering slått av (`--no-verify-jwt` i deployjobben). Porten er da
funksjonens egen sjekk, som sammenligner hele nøkkelen i konstant tid.

Nøkkelen leses av funksjonens miljø i denne rekkefølgen:

| Variabel | Hva | Status |
|---|---|---|
| `SUPABASE_SECRET_KEYS` | JSON-ordbok med de nye nøklene (`sb_secret_…`) | Den anbefalte veien |
| `SUPABASE_SERVICE_ROLE_KEY` | den gamle JWT-nøkkelen | Merket «legacy» hos Supabase, fases ut |

Begge virker, og koden foretrekker den nye — den FØRSTE nøkkelen den finner er
også den funksjonen selv bruker mot PostgREST. Et prosjekt flytter seg derfor
til den nye modellen ved å sette secrets, uten at koden røres.

**De to nøkkeltypene har IKKE de samme headerne**, og det er ikke en detalj man
kan runde av. En `sb_secret_…` er ikke et JWT: ligger den også på
`Authorization: Bearer`, prøver plattformen å tolke den som et token og avviser
HELE kallet med «Invalid JWT». Å sende begge for sikkerhets skyld ødelegger
altså nettopp den veien Supabase anbefaler.

| Nøkkelen er | `apikey` | `Authorization: Bearer` |
|---|---|---|
| `sb_secret_…` (ny) | nøkkelen | **ingenting** |
| `service_role` (legacy JWT) | nøkkelen | nøkkelen — PostgREST leser rollen der |

Avgjørelsen ligger ETT sted i hvert lag, slik at den kan kjøres av en test og
ikke bare leses: `push-send/auth.mjs` for det funksjonen tar imot og sender
videre til PostgREST, og `push_headers()` for det `push_tick()` sender. Kjenne-
tegnet er formen — tre base64url-segmenter med punktum mellom er et JWT.
Innkommende godtas en legacy-nøkkel derfor på begge headere, mens en
`sb_secret_…` på `Authorization` avvises: den veien er en feilkonfigurasjon, og
å godta den ville skjult feilen til plattformen selv begynte å si nei.

Ingen av nøklene finnes i repoet, og ingen av dem når klienten. `push_claim()`
og `push_report()` er dessuten stengt for alle andre enn `service_role` — både
med grants og med en rollesjekk inne i funksjonene — så nøkkelen er den ytre av
to porter, ikke den eneste.

Kryptografien er skrevet for hånd i `push-send/webpush.mjs`, uten npm-pakker:
Huskis har ingen avhengigheter ([`sikkerhetsheadere.md`](sikkerhetsheadere.md)),
og en pushsender som drakk inn et avhengighetstre ville vært det første stedet
den regelen sprakk. Modulen kjører uendret i Deno og i Node, og
`tests/push-crypto.test.js` kjører den mot et fast vektor regnet ut av
`http_ece` — referanseimplementasjonen `web-push` selv bruker.

Et tapt tikk koster forsinkelse, ikke leveranser: all tilstand ligger i
utboksen, og neste tikk tar det samme arbeidet.

### Flere enheter per bruker

- **Web push** fanner ut til ALLE brukerens aktive abonnementer — én
  utbokslinje per abonnement, hver med sitt eget utfall. Et dødt endepunkt slås
  av uten å røre de andre.
- **Android** trenger ingen fan-ut: hver installasjon planlegger sine egne
  lokale varsler fra den samme planen, med de samme deterministiske ID-ene.
- `get_my_doc().push_devices` teller de aktive i BEGGE kanalene og gir tallet
  til panelet, så «på» sier hvor mange enheter det gjelder — og «Vis enheter»
  åpner listen over dem (se «Enhetene med varsler»). Faller tallet, går web
  push-fornyelsen med én gang i stedet for å vente ut kvarteret sitt.
- `get_my_doc().notif_revoked` er det PRESISE signalet for den native kanalen:
  er nettopp denne klientens kanal slått av fra en annen enhet? Et aggregat
  duger ikke alene der — slår én enhet av mens en annen slår på i det samme
  vinduet, står tallet stille, og telefonen hadde ventet ut kvarteret sitt med
  alarmer brukeren nettopp slo av. Nettleseren kjenner igjen sitt eget
  abonnement på ENDEPUNKTET, som doc-et verken har eller skal ha.
- **To enheter varsler begge.** Det er normalt og forventet, som e-post på både
  telefon og laptop.
- **Planen** legges derimot av ÉN enhet av gangen — den som holder tidssonen (se
  «Tidssonen planen tilhører»).

#### Appen OG nettleseren på den samme telefonen

Slår brukeren på varsler både i Android-appen og i Chrome på den samme
telefonen, kommer det to systemvarsler per hendelse. Det er ikke en feil, og det
er heller ikke noe Huskis kan se:

- Kanalen velges av PLATTFORMEN og er aldri begge på én gang (`notifChannel()`).
  Inne i APK-en finnes det ingen pushtjeneste å melde seg på, og i en nettleser
  finnes det ingen native plugin. De to kanalene er altså allerede gjensidig
  utelukkende — per KJØRENDE app.
- Men APK-en og Chrome er to forskjellige installasjoner. De deler ingen
  lagring, intet abonnement og ingen identitet; det eneste de har felles er
  kontoen. Et web push-abonnement bærer et endepunkt hos en pushtjeneste, og
  det sier ingenting om hvilken fysisk enhet nettleseren står på.

Å deduplisere ville derfor kreve en NY, eksplisitt enhets-ID som appen og
nettleseren begge kunne skrive og kjenne igjen — en identitetsmodell Huskis
ikke har. Alternativene er verre: å gjette på enhet ut fra brukeragent eller
tidssone er fingeravtrykk og feiler både falskt positivt og falskt negativt, og
å slå av web push for hele kontoen når appen er installert ville tatt varslene
fra brukerens laptop.

Regelen er derfor den samme som for to enheter: **hver kanal brukeren
uttrykkelig har slått på, leverer.** Vil man ha bare ett varsel på telefonen,
slår man av det ene stedet — bryteren er per enhet, og i Chrome er den per
nettleser.

Merk at dette handler om TO KANALER på samme telefon. Det er noe annet enn
regelen om én synlig varsling i den native kanalen alene («Én synlig
varsling»): der er in-app-toasten varslingen når appen er åpen, og et
systemvarsel i tillegg er verken påkrevd eller forventet.

### Levert/ikke levert mot lest/ulest

De to henger sammen på nøyaktig ett punkt, og ellers ikke:

- **Leveringen er per enhet** og lever i utboksen (`push_deliveries.status`)
  eller i Androids alarmkø. **Lest/ulest er per bruker** og lever på
  varselraden (`read_at`), delt mellom alle enhetene.
- **En levert push merker ingenting som lest.** En push kan sveipes bort fra en
  låseskjerm uten at noen har lest noe. Raden blir stående ulest til
  varselmodalen åpnes — det er fortsatt den ene handlingen som markerer lest.
- **Lest/ulest gater aldri en levering**, og trenger ikke gjøre det: en rad kan
  først bli lest etter at den har forfalt, og da er den allerede levert. Det
  finnes ikke et vindu der «lest på laptopen» kunne rukket å avlyse en push som
  ennå ikke er sendt.
- **En push som ikke kommer fram, endrer ingenting.** Raden er der, ulest, og
  in-app-kanalen viser den. De eksterne kanalene er best effort; historikken i
  appen er fasiten for hva som er varslet.
- Det ene punktet de møtes i: **å utsette et varsel merker det lest** (det er en
  kvittering), og den utsatte raden er en ny, planlagt rad — som dermed også
  leveres eksternt når den forfaller.

## Voktere

- `tests/notifications.test.js` — generatoren bakover: tersklene og de eksakte
  grensene, dato uten klokkeslett, markøren, catch-up, preferansene, fullføring,
  arv, identitet, hele veien gjennom serveren, to enheter uten duplikater, og at
  en tømt historikk ikke gjenskapes.
- `tests/notif-plan.test.js` — generatoren framover: horisonten og taket, at
  planen er de samme tersklene med samme nøkkel, at den er usynlig og ikke
  teller som ulest, utboksen for web push, at fullføring og en endret frist
  avlyser den, at en PLANLAGT rad får et ferskt navn mens historikken ikke
  skrives om, og tidssone-hevdelsen med begge utfallene.
- `tests/notif-channels.test.js` — kanalene: den deterministiske native ID-en,
  at et TIDSSONEBYTTE faktisk flytter alarmen (samme varsel, ny absolutt tid,
  gammel alarm avlyst) — både når leasen kan overtas OG når den er fersk, der
  telefonen skal ha riktige alarmer med det samme mens serverplanen står
  urørt — Android-adapterens diff og upresise alarm, at tillatelsen aldri
  spørres av seg selv, web push-påmeldingen og avmeldingen, grensene for hva et
  abonnement får være (speilet i mock-backenden), blokkert tillatelse, panelets
  tilstander, service workerens push- og klikkruting, `?notif=` i
  adressen, at et trykk på et systemvarsel IKKE gir en toast for nettopp det
  varselet mens et annet nytt varsel fortsatt toaster (begge kanalene), at
  varselets TO ikoner er to ulike bilder — det store i farge, innenfor den
  innskrevne sirkelen, med favicon-ens fyllfarger, og det lille monokromt og
  tegnet som konturer — og at Androids `ic_stat_huskis` bærer nøyaktig de samme
  banene som badgen. Og til sist scenariet fra den fysiske testen: at et varsel
  som har RINGT blir stående i pluginens lagring uten å blokkere det neste, at
  en ny terskel blir en alarm SELV NÅR serveren ikke svarer og uten at noe
  manuelt kjøres, at to overlappende speilinger etterlater telefonen med
  nøyaktig planen — ikke én alarm for mye — og at en runde som står i kø bak en
  som FEILET i broen likevel blir kjørt. Og PRODUKTREGELEN «én synlig
  varsling»: klokka får faktisk passere terskelen, og testen viser at alarmen
  var armert på forhånd (bakgrunnskontrakten), at toasten kommer når terskelen
  passerer med appen i forgrunnen, at terskelen da er ute av den framtidige
  native planen, at den armerte alarmen avlyses — og at raden likevel står i
  historikken. Og VARSELKANALEN: at den opprettes med HØY viktighet, offentlig
  vibrasjon — og at den IKKE lover en låseskjermkontrakt Android ikke lar en app
  sette — at hvert varsel planlegges eksplisitt på den, at den
  finnes FØR den første alarmen armeres, at `getPending()` ikke bærer noen
  `channelId` — premisset for at migreringen tar hele planen — at en
  installasjon med alarmer fra før kanalen får dem flyttet ved å planlegges på
  nytt (ingen avlysning, ingen dubletter, ingen mistet framtid), både i en
  kjørende app og over en appoppgradering, at gjentatt synk og nye omstarter
  ikke gjør noe mer, at en kanal som ikke lot seg opprette verken gir varsler
  eller et merke — mens neste runde gjør hele jobben — at et språkbytte når
  systeminnstillingene selv uten en eneste alarm, at et Android uten kanaler får
  varslene sine likevel — med et `createChannel` som FAKTISK ble forsøkt, i en
  fersk app, så grenen ikke kan være grønn av et memo — og at ingen ny
  tillatelse har sneket seg inn: ingen fullskjerm, ingen skjerm-på, ingen
  presise alarmer. Og OPPSTARTEN: at en vanlig omstart for samme bruker verken
  avlyser eller planlegger en eneste alarm, at en ANNEN bruker som overtar
  enheten fortsatt får forrige brukers alarmer ryddet bort — også med
  tillatelsen trukket, så ingen speilingsrunde kan gjøre det for oss — at en
  runde som feiler i broen beholder de tidligere gyldige alarmene i stedet for å
  etterlate telefonen tom, at en opprydning som feiler blir prøvd på nytt ved
  neste oppstart, at en treg nedrigging ikke kan avlyse alarmene den nye
  brukerens runde nettopp la inn, at en enhet uten merket får planen tilbake selv
  uten nett, og at en speiling som ble utstedt før utloggingen ikke får legge den
  utloggede brukerens alarmer inn igjen.
- `tests/push-crypto.test.js` — VAPID-signaturen og RFC 8291-krypteringen, mot
  et fast vektor fra `http_ece` og med signaturen faktisk verifisert.
- `tests/notif-modal.test.js` — knappen og badgen, modalen, nyeste øverst,
  datooverskriftene og meldingsformene, lest/ulest-grensen, angresletting,
  «Utsett»-popoveren (inkludert den egendefinerte skuffen, at et passert
  tidspunkt avvises, den ARMERTE knappen, panelet som sier når varselet kommer
  og at det kan avbrytes), slett-knappen på raden, varsel-toastene (at
  historikken ikke toaster, tonen og teksten, at den springer ut fra bjellen,
  sveip, trykk til varselet, og at ingen toast kommer oppå et åpent lag),
  preferansepanelet og hodets to tilstander, at et varsel slettes når målet
  eller tiden forsvinner, navigering, tastatur/fokus og i18n.
- `tests/system-back.test.js` — at varselinnstillingene er et NIVÅ inne i
  modalen: tilbakeknappen går til varslene, Escape lukker helt.
- `tests/corner-controls.test.js` — at bjelleknappen ikke rørte
  toppkontrollenes geometri.
- `tests/a11y-contrast.test.js` — at modalen ikke pinner ikonfargene (den
  arver statusflatene fra `.event-icon`), og at varsel-toastenes tekst klarer
  4.5:1 mot den halvgjennomsiktige flaten over BEGGE ytterpunktene.
- `tests/capacitor-android.test.js` — varselpluginen som pinnet
  runtime-avhengighet, at pluginbroen bare leses for de kjente pluginene, og at
  SCHEDULE_EXACT_ALARM er det ENESTE merger-direktivet i manifestet.
- `tests/security-headers.test.js` + `tests/build-version.test.js` — at
  `worker-src 'self'` står likt i begge policyene, og at `sw.js` publiseres.
- `tests/release-pipeline.test.js` — at senderen deployes etter smoke-testen,
  IKKE er en port for frontenden, at Supabase-CLI-en kjøres på en måte som
  faktisk virker (`npx` med låst versjon — pakken nekter en global install), og
  at nøkkelmodellen henger sammen: `--no-verify-jwt`, begge nøkkelgenerasjonene,
  og at hverken senderen eller `push_tick()` bygger headerne utenom `auth.mjs`
  og `push_headers()`.
- `tests/notif-timezone-native.test.js` — at de to lagene henger sammen: JS
  legger veggtiden ved hver alarm i den formen Java parser, manifestet
  registrerer receiveren for `TIMEZONE_CHANGED`, den korrigerte tiden skrives
  til lagringen FØR alarmen settes, ingen ny tillatelse er kommet til, og CI
  kjører faktisk JVM-testen.
- `android/app/src/test/…/HuskisWallClockTest.java` — selve omregningen, KJØRT
  på produksjonskoden uten emulator (`./gradlew testDebugUnitTest`): Oslo →
  Tokyo gir nytt absolutt tidspunkt og samme veggtid, ID og tekst er urørt, en
  alarm som alt har ringt røres ikke, uendret sone gir ingen skriving, og
  sommertid tas av kalenderen.
- `tests/android-device.js` — den MASKINELLE runden mot en ekte enhet, kjørt av
  `.github/workflows/android-device.yml` på en emulator: at planen ligger i
  Androids alarmkø på riktig tidspunkt, at alarmene er vekkende og upresise og at
  den INSTALLERTE APK-en ikke ber om SCHEDULE_EXACT_ALARM, at kanalen finnes med
  høy viktighet, at en vanlig appomstart verken avlyser eller planlegger noe
  (lest av Capacitors egen broLOGG, ikke bare av køen), at alarmene står når
  prosessen er drept og kommer tilbake etter en ekte omstart, at et varsel
  leveres med appen borte — på Huskis-kanalen, rangert HIGH — at pluginens egen
  tapp-intent bærer pekeren inn i appen fra en KALDSTART, og at et brukerbytte
  rydder forrige brukers alarmer.
- `tests/android-alarm-queue.test.js` — de delene av enhetsrunden som kan prøves
  uten en enhet, og som ville gjort en grønn runde verdiløs om de var feil:
  lesingen av `dumpsys alarm` i alle tidsformene Android bruker (og at
  statistikkseksjonene ikke telles som framtid), sammenligningen av to tidssett,
  formen på tapp-intenten med pluginens egne nøkler, at harnesset er pinnet til
  pluginversjonen formene er lest av, at det bruker `am kill` og aldri
  `force-stop`, at appen eksponerer de to observatørene runden leser — og at CI
  faktisk kjører runden.
- `tests/push-auth.test.js` — headerne, KJØRT: en ny secret key havner kun på
  `apikey` og ingen andre steder, en legacy-nøkkel får fortsatt begge, og en
  `sb_secret_…` på `Authorization` slipper ikke inn. Testen feiler hvis noen
  gjeninnfører «send begge for sikkerhets skyld».
- `supabase/tests/test-notifications.sql` — RLS, idempotent logging, markøren,
  preferansene og kontosletting.
- `tests/devices-sessions.test.js` — de to listene i konto-modalen, KJØRT:
  preview-porten (produksjonsdomenet og `huskis.vercel.app` slipper gjennom, en
  flyktig preview-host og et `preview`-stempel gjør det ikke), at et abonnement
  som ALLEREDE lå på en forhåndsvisning ryddes når siden åpnes — meldt av,
  service workeren avregistrert, bryteren av, serverraden borte, og ingen ny
  påmelding etterpå, mens andre enheters abonnementer står urørt — at
  opprydningen tåler at SERVEREN sier nei (endepunktet beholdes, klienten
  hamrer ikke, og en senere runde rydder raden) og at den virker i en build
  UTEN avsendernøkkel, at mock-backenden avviser et rullert endepunkt akkurat
  som databasen gjør — panelets preview-tekst, «denne enheten» øverst i begge listene, fjern-utlogging av én
  økt og av alle andre, at vanlig «Logg ut» er LOKAL, at en fjern-utlogget klient
  som står åpen går til innloggingssiden uten å miste bufferen, og at et
  fjern-avslått abonnement verken teller som aktivt eller melder seg på igjen —
  før et eksplisitt «slå på varsler» på nettopp den klienten.
- `supabase/tests/test-push-race.sh` — samtidigheten, med TO ekte
  databaseøkter: en automatisk fornyelse og et «slå av» kjøres mot hverandre i
  begge rekkefølger, både på det samme endepunktet og på to ULIKE i den samme
  klientkonteksten (en rullering). Alle fire må ende med AV. Uten radlåsen slår
  fornyelsen varslene på igjen; uten brukerlåsen slipper det rullerte
  endepunktet gjennom — testen sier fra i begge tilfeller.
- `supabase/tests/test-sessions.sql` — øktlaget serverside: hvem som ser hvilke
  økter, at en annen brukers økt ikke kan termineres, at fjern-utlogging faktisk
  sletter øktraden OG refresh-tokenet, at `session_ok` melder tilstanden, og at
  hverken IP eller hele user-agenten forlater databasen.
- `supabase/tests/test-push.sql` — abonnementene og RLS-en rundt dem, utboksens
  idempotens, kaskaden som avlyser en levering, at et EIERSKIFTE tømmer køen og
  at senderen aldri plukker opp en levering som ikke hører til abonnementets
  eier, grensene for hva et abonnement får være (endepunkt, nøkkelform og taket
  på antall enheter), fjern-avslåingen (riktig rad, nøklene tømt, køen avsluttet,
  ingen automatisk gjenpåmelding, og at et eksplisitt «slå på» tar den tilbake),
  at sporet OVERLEVER både opprydningshorisonten og taket — en sovende enhet som
  våkner etter 200 dager og fornyer seg blir fortsatt avvist — at et RULLERT
  endepunkt fra den samme klientkonteksten avvises på samme måte mens en annen
  kontekst og en annen bruker er upåvirket, at et «slå av» tar HELE klienten —
  også raden fra en rullering, med køen avsluttet og nøklene tømt — mens «slå av
  alle andre» sparer hele den klienten som ringte, at en PLANLAGT rad
  får et ferskt navn mens historikken ikke skrives om, at et dødt endepunkt tar hele køen sin med seg, at senderens
  funksjoner er stengt for klienten, hent/send/meld-runden med alle tre
  utfallene, tidssone-hevdelsen, og `push_headers()` — kjørt, ikke lest: en ny
  secret key får ingen `Authorization`-header i det hele tatt.
