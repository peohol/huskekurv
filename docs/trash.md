# Søppelkasser (områder / mapper / lister / listepunkter / idéer / notater)

Les denne når oppgaven berører sletting, gjenoppretting, eller tømming på et
hvilket som helst av de fire nivåene — eller for idéene og notatene.

Åtte kasser, samme knapp (`.trashcan`: hvit beholder, søppelkasse-SVG + antall i
grå sirkel) og samme oppførsel; **alle vises kun når de har innhold** (`hidden`)
— ELLER, for hierarkinivåene og de tre notatnivåene, når et drag på det nivået
pågår (se under):

- **Områder**: i nav-modalens egen, faste fot (`#uni-trash-btn`).
- **Mapper**: i hvert OMRÅDE-KORT i nav-modalen (`.group-trash-btn`) — akkurat
  som listepunkt-søppelkassen ligger i lista si. Én kasse per område.
- **Lister**: i en FAST FOT nederst på siden (`.drop-dock#lists-dock`), per
  aktiv mappe.
- **Listepunkter**: midtstilt nederst i hvert listekort (`ICONS.trash`, samme
  SVG som de statiske knappene — aldri emoji).
- **Notater**: i notatfanens egen faste fot (`.drop-dock#notes-dock`), ved
  siden av arkivet — per aktiv plassering.
- **Notatbøker**: i hvert BOKHYLLEKORT i notat-nav-modalen
  (`.note-folder-trash-btn`) — som mappe-kassen i et områdekort.
- **Bokhyller**: i notat-nav-modalens egen fot (`#note-project-trash-btn`) —
  som område-kassen.
- **Idéer**: i idémodalens fot (`#idea-trash-btn`) — én kasse for hele kontoen,
  siden idéene ikke ligger i noe hierarki ([`ideer.md`](ideer.md)). Den er den
  ene som **ikke er et slippmål**: idéer slettes med sletteknappen på raden, så
  kassen er bare veien tilbake. Den vises derfor utelukkende når den har
  innhold.

Kassene som ligger INNE i en beholder (`.item-trash`-innpakningen i listekortet
og i områdekortet) **bygges alltid**, men står `hidden` når de er tomme. Noden
må finnes for at et drag skal kunne vise den fram — se under.

## Kassene som ikke ligger i et kort står i en FAST FOT

Hovedsidens to faner har hver sin `.drop-dock` nederst i viewportet — listenes
kasse i den ene, notatenes arkiv OG kasse i den andre — og modalene har sin
`.nav-foot`. De deler oppskrift: feltet er festet i bunnen, det er så bredt som
skjermen, og det ligger der ingenting annet kan treffes.

Grunnen er treffsikkerheten. En kasse som deler knapperad med ＋-knappen er
~48 px bred og ligger inntil noe annet man kan trykke på; en finger som drar et
objekt dekker dessuten sitt eget mål. I foten har kassen hele bredden for seg
selv. Er det TO kasser der — arkivet og søppelkassen på notatsiden — deler de
bredden likt, med luft rundt og mellom seg, på både mobil og desktop.

Foten **finnes bare når en kasse i den er synlig** (`:has()` i `styles.css`), og
board-et holder av høyden dens nederst (`--dock-reserve`) så den aldri legger
seg over det siste kortet. Det samme leddet flytter toasten, synk-pillen og
oppdateringsbanneret opp: de bor i det samme hjørnet av viewportet, og en toast
oppå søppelkassen ville dekket nøyaktig det man nettopp brukte.

Reserven gjelder **ikke mens notat-editoren står åpen**: bildet dekker foten, så
det er ingenting å holde klar av — og en pille løftet for en fot ingen ser ville
svevd midt oppi notatteksten i stedet for å ligge i klaringen nederst. Editoren
holder til gjengjeld av plass til selve pillen (`--sync-pill-h`), som ligger
over bildet og skal bli der: den er det eneste stedet «frakoblet» sier fra, og
det er nettopp mens man skriver man trenger å vite det.

## Slett ved å DRA objektet i kassen

**Dette er den ene slettegesten** på de fire hierarkinivåene og de tre
notatnivåene, og den er lik på desktop og mobil (idéene er unntaket — se over:
der er sletteknappen på raden den ene veien). Objektmenyens «Slett …» går til
nøyaktig den samme funksjonen:

1. Løft objektet (trykk-og-hold på touch, dra på mus — samme motor som all annen
   flytting, `docs/drag-and-drop.md`). Kassen for NIVÅET dukker opp med én gang
   (`armDragTrash`), også når den er tom — og den er **dobbelt så høy** mens
   draget står på (se under).
2. Sikt på den: kassen markeres (`.drop-target`, samme markering som
   📁-breadcrumben), det løftede objektet skifter farge (`.to-trash`), og en
   ETIKETT over objektet sier hva slippet betyr — «Slett», eller «Arkiver» på
   notatsiden (se under).
3. Slipp: objektet havner i kassen — samme vei som objektmenyens «Slett», med
   fly-i-kassen-animasjonen og den samlende angre-toasten.
4. Deretter tømmes den SAMME kassen permanent med hold-og-sveip, som før.

**Kassen dobler høyden mens draget varer.** En kasse er det ene stedet i appen
der et bom betyr at handlingen ikke skjer, og fingeren som drar noe dekker selv
målet sitt. Veksten er momentan — dnd-kit måler sonen ÉN gang, idet draget
starter — og den går OPPOVER, mot fingeren, både i foten (som er festet i
bunnen) og i et kort. I et kort tas den ekstra høyden av en negativ toppmarg, så
KORTET er like høyt som før: kasseraden som dukker opp og forsvinner er allerede
en høydeendring dra-ankeret må sette av, og en kasse som ga kortet enda en
knapperad ville flyttet både ekstraher-terskelen og alt under kortet midt under
fingeren. ＋-raden under kassen skjules imens (`visibility`, plassen består) —
den ligger uansett bak kassen, og to knapper som skinner gjennom et slippmål
leser som noe man kan treffe.

**Etiketten sier hva slippet betyr.** Fargeendringen alene forutsetter at man
kjenner fargen fra før. Teksten males på det LØFTEDE OBJEKTET
(`data-drop-label`, satt av `setDragTrashTarget`/`setDragArchiveTarget`), ikke på
kassen: objektet ligger i top layer og kan ikke dekkes av noe, mens en etikett på
kassen ville havnet under både fingeren og det man drar.

Detaljer som er lette å bryte:

- **Kassen er bundet til draget, og den FØLGER raden.** For et listepunkt/en
  mappe står kassen i containeren raden svever over NÅ (`drag.trashHost`,
  flyttet av `retargetDragTrash`) — men aldri i en container som ikke tar imot
  raden, som en låst liste eller et låst område: der blir slippet avvist, og en
  kasse som foldet seg ut ville gjort et bom på noen piksler til en sletting.
  Det gjelder også når verten blir låst ETTER at kassen flyttet dit — da faller
  kassen hjem til kilden. Slettingen legger uansett raden i KILDENS kasse;
  verten er bare hvor knappen sto mens man dro.
- **Slippet SLETTER, det flytter ikke.** Draget rulles tilbake som et avbrutt
  drag (ingen ny `pos`, ingen lagring, ingen flytte-velger) før slettingen
  kjøres, så objektet ikke også blir omrokkert eller overført.
- **Uten slette-rett vises ingen kasse, og uten redigeringsrett intet arkiv.**
  `draggedCanBeTrashed()` og `draggedCanBeArchived()` bruker de samme
  capabilities som objektmenyens «Slett»- og «Arkiver»-rader og feiler LUKKET —
  man kan ikke sikte på noe serveren ville avvist. Det gjelder også notatsiden,
  som nå har roller og låser som resten
  ([`rettigheter-og-deling.md`](rettigheter-og-deling.md) del 14): en ren leser
  får ingen av dem å sikte på, en redaktør uten sletterett får bare arkivet, og
  den virtuelle «Delt med meg»-bokhyllen kan verken arkiveres eller slettes.
- **Kassen må ligge under board-ets ROT for å bli registrert som sone.** Både
  liste-kassen og notat-kassene står i den FASTE FOTEN, utenfor selve board-et,
  så de to board-ene har `document.body` som rot (selektorene er fortsatt
  scopet). Ligger roten for trangt, måles sonen aldri, og slippet blir en helt
  vanlig omrokkering uten et eneste signal.
- **KATEGORIER har ingen kasse.** En kategori slettes ikke, den LØSES OPP
  (listepunktene blir stående), og det gjøres fra objektmenyen. Et kategori-drag
  armer derfor ingenting.
- **Kassen skjules igjen** når draget ender uten å treffe den. `finishDrag()`
  kaller `disarmDragTrash()`, som bare re-skjuler de kassene draget selv
  avdekket (`data-drag-revealed`).
- En kasse som draget avdekket er per definisjon tom, så antallet («0») skjules
  mens den er armert — der er den et MÅL, ikke en beholder.
- **Kassen blir stående i synsfeltet etter slippet** (`keepTrashInView`). Neste
  steg er som regel å tømme den, og slettingen rendrer på nytt — i nav-modalen
  har draget dessuten kollapset kortene underveis, så listen krymper og vokser
  igjen. Uten dette havner man et stykke OVER kassen og må scrolle ned igjen.
  `renderNav()` bevarer i tillegg scrollposisjonen i modalen over en ombygging,
  og pinner til bunnen hvis man sto der.

Regresjonstest: `tests/dnd-trash.test.js`.

## Notatene har BÅDE et arkiv og en søppelkasse

Notatsiden ([`notater-plan.md`](notater-plan.md)) har to bortleggingsmåter på
alle tre nivåene — bokhylle, notatbok og notat:

| | Hva det betyr | Vei tilbake | Vei videre |
|---|---|---|---|
| **Arkiver** (`archived`) | lagt til side; fortsatt levende innhold | «Hent ut av arkivet» | «Slett» → søppelkassen |
| **Slett** (`trashed`) | i søppelkassen | «Gjenopprett» | hold-og-sveip → borte for godt |

De to er UAVHENGIGE tilstander på den samme raden, begge på innholdsregisteret:
et arkivert notat kan legges i søppelkassen og komme tilbake til arkivet det lå
i. Arkivet er ikke destruktivt, så det har verken angre-toast, buffer eller
hold-og-sveip — veien tilbake er arkivknappen som står rett ved siden av.

**Arkivet er også et slippmål.** Drar man et notat, en notatbok eller en
bokhylle, foldes BEGGE kassene ut — også de tomme — og et slipp i arkivet
arkiverer akkurat som et slipp i kassen sletter. Det er det samme maskineriet
(`armDragArchive` ved siden av `armDragTrash`, samme sone-oppsett, samme
opprydding på alle veier ut av draget); bare fargen og betydningen skiller dem.
Uten dette var arkivet den ene bortleggingsmåten man ikke kunne dra til.
Se [`drag-and-drop.md`](drag-and-drop.md).

**Men RETTEN er ikke den samme.** Arkivering er reversibelt innhold og krever
redigeringsrett (`draggedCanBeArchived`); sletting er destruktivt og krever
sletterett (`draggedCanBeTrashed`). Nå som notatene deles, spriker de to: et
medlem som lovlig kan redigere et delt notat, men ikke slette det for alle, får
arkivmålet foldet ut og søppelkassen ikke. Det er den samme forskjellen
objektmenyens to rader gjør, og de to spørsmålene stilles hver for seg.

**Arkivet låner søppelkassens modal.** Det er den samme `showTrashModal`, den
samme raden og den samme foten — bare et annet ikon i hodet, en «Slett»-knapp
ved siden av «Hent ut av arkivet» på hver rad, og en fot som legger ALT i
søppelkassen i stedet for å slette for godt (og derfor ikke er rød). En egen
arkivmodal ville vært en ny modaltype for nøyaktig den samme interaksjonen.

**Flaggene arves ikke nedover.** Legges en bokhylle bort, forsvinner
notatbøkene og notatene med henne uten å bli flagget — akkurat som listene
forsvinner med en slettet mappe — og de kommer tilbake slik de sto. Derfor er
hver kasse og hvert arkiv SCOPET til en levende forelder (notat-kassen til
plasseringen man står i, notatbok-kassen til bokhyllen sin), så en
gjenoppretting alltid gjør objektet synlig igjen. Et notat i en bortlagt
notatbok blir heller ikke et fritt notat: det følger notatboken ut av
visningen.

**Tømmingen er det ene stedet hierarkiet er rekursivt**, og den følger
databasens kaskader nøyaktig:

- **Bokhylle** → gravstein på bokhyllen, notatbøkene OG notatene
  (`notes.project_id` er `on delete cascade`; et notat uten bokhylle finnes
  ikke).
- **Notatbok** → gravstein på notatboken ALENE. Notatene blir frie notater i
  bokhyllen (`notes.folder_id` er `on delete set null`), og en toast sier fra.
  Et notat er et dokument brukeren har skrevet; notatboken er hylla det sto i,
  og den skal ikke kunne rive med seg noe som aldri ble slettet.
- **Notat** → gravstein på notatet.

Koblingene til det som tømmes ([`notater-plan.md`](notater-plan.md)) går med i
samme slengen — både lokalt og på serveren, der fremmednøklene kaskaderer dem
bort med hver sin gravstein.

Regresjonstest: `tests/notes-lifecycle-links.test.js` og
`supabase/tests/test-note-links.sql`.

## Slette-animasjonen («pakk sammen og fly i søpla»)

Når et objekt slettes (listepunkt/liste/mappe/område) kjøres `ghostFrom` +
`flyGhost` (app.js): en klone av DOM-elementet tas FØR re-render, deretter
oppdateres state og `render()`/`refreshCard()` kjøres — slik at søppelkasse-
knappen **finnes/er synlig FØR animasjonen starter** — og til slutt animeres
klonen (`FLY_MS` = 600 ms, WAAPI): innholdet fader ut (første ~30 %), boksen
krymper til en sirkel (bare de avrundede hjørnene igjen, ved halvveis) og
svever inn i tilhørende søppelkasse-knapp og fader rett før den er fremme.
Varigheten er bevisst romslig (600 ms) så den er godt synlig også for store
listekort. Poenget er å vise HVOR det slettede havnet (og at det kan
gjenopprettes derfra). Ingen bekreftelses-dialog — sletting er reversibel.
Hopper over ved `prefersReducedMotion()`.

## Delete-buffer (optimistisk sletting + angre)

Sletting skriver **ikke** til databasen med en gang. Objektet får et lokalt
`_pendingDelete`-flagg (`_`-prefiks → strippes av `stateReplacer`, ikke i synk-
doc'et) og en **angre-toast** («Lagt i søppelkassen: «X» — Angre», 5 s).
Angrer man innen vinduet (`undoDelete(id)`), fjernes flagget lokalt — **ingen
databasetrafikk, umiddelbart**. Ellers committes slettingen når timeren (`DELETE_BUFFER_MS`,
5 s) utløper — eller når fanen skjules (`visibilitychange`/`pagehide`) —:
`trashed = true` + stempling (`commitDelete`). Søpla er FELLES for alle med
tilgang.

Mens objektet er buffret:
- Det er **skjult** fra board/menyer (`activeCards`/`visibleGroups`/… ekskluderer
  `_pendingDelete`) men **vises i søppel-visningen** (`trashedCards`/… inkluderer
  det) — som en helt vanlig rad. **Ingenting i søppel-flyten venter på
  bufferet** (ingen spinnere/deaktiverte knapper):
  - «Gjenopprett» på en buffret rad = angre bufferet (`undoBufferedDelete`):
    flagget fjernes og raden pilles ut av samle-toasten (`pruneDeleteToast`,
    som oppdaterer antallet i toasten / rydder den når den blir tom) —
    umiddelbart, null databasetrafikk.
  - «Slett … for godt» / sveipe-tømming committer buffrede rader i sitt omfang
    FØRST (`commitBufferedFor`) og tømmer så — brukeren merker ingen forskjell
    på en buffret og en committet rad.

ALT går via **id-oppslag** (`findAnyById`), aldri fangede objekt-referanser, så
det tåler at synken bygger state-treet på nytt underveis — `reapplyPendingDeletes()`
gjenpåfører flagget etter hver `applyDoc`/`applyMyDoc`. Dette løste også en bug
der «Angre»/«Gjenopprett» mutere en foreldet referanse (etter at synken hadde
bygget treet på nytt) og dermed ikke virket før noen sekunder hadde gått.

### Samle-toast (`pushDeleteToast`)

Én felles «Angre»-toast eier timeren for en bunke slettinger (ikke per objekt):

- Slettes flere objekter av **samme** kategori mens toasten er åpen, **slås de
  sammen** (`deleteToast.ids`) og timeren startes på nytt — meldingen blir
  «Slettet N listepunkter/lister/mapper/områder», og én «Angre» angrer alle.
- Slettes et objekt av en **annen** kategori, antas den forrige toasten
  unødvendig: den forrige bunken **committes straks**, og en fersk toast
  starter for den nye kategorien.
- Toasten er «sticky» (`showToast(..., { sticky: true })`) — den felles timeren
  (`armDeleteTimer`) styrer både commit og skjuling. `commitDeleteOne`/
  `undoDeleteOne` gjør én-objekt-jobben uten å tegne board-et på nytt (commit er
  visuelt en no-op siden objektet allerede var skjult); bunke-angre tegner én
  gang til slutt.
- **Sveipes toasten bort** (til høyre, se `docs/design-system.md`) er det et
  «jeg er ferdig med denne»: `onDismiss: commitDeleteToastNow` committer bunken
  **umiddelbart** — samme utfall som når timeren utløper, bare uten ventingen.
  `commitDeleteToastNow` er den delte commit-veien (timeren, kategori-byttet i
  `pushDeleteToast` og sveipet bruker alle den).

«Angre» (og «Gjenopprett» for committede) bruker de delte
`restoreUniverse/Group/Card/Item`-hjelperne (samme kode begge steder). Også
disse slår opp objektet på nytt via `findAnyById(id)` FØR de muterer det —
aldri referansen som ble sendt inn (se «Foreldede referanser i modalen» under).

Sveipefeltets tekst er «Tøm» + en pil som fyller resten av feltet (symmetrisk
padding, satt i JS).

### Foreldede referanser i modalen (listepunkt-søppelkassen)

Søppel-modalen kan stå åpen mens synken bygger hele state-treet på nytt
(`applyDoc`/`applyMyDoc` gjør `state.universes = [...ferske objekter]` hver
sky-runde — poll hvert 5. sekund + realtime-ekko i kontomodus). Da blir enhver
fanget objekt-referanse fra da modalen ble åpnet, foreldreløs.

De tre andre søppelkassene (`openUniversesTrash`/`openGroupsTrash`/
`openCardsTrash`) leser allerede ferskt fra `state` i hver `rows()`-kall
(`trashedUniverses()`/`trashedGroups()`/`trashedCards()`). **Listepunkt-modalen
(`openItemsTrash`) gjorde det ikke** — den fanget `cardData` én gang og lot
`rows()` lese `trashedItemsOf(cardData)` fra den. Etter en tre-rebuild pekte
den på et foreldreløst kort, som ga to symptomer (kun listepunkter, ikke mapper/
områder):

1. **Spinner som aldri ga seg**: åpnet man modalen rett etter en listepunkt-
   sletting og en rebuild traff mens den sto åpen, ryddet commit `_pendingDelete`
   på det LEVENDE objektet, mens modalens foreldreløse kort beholdt flagget →
   spinner for alltid, tøm-knappen aldri aktiv.
2. **«Gjenopprett» som ikke festet seg**: klikket satte `trashed = false` på den
   foreldreløse kopien → modalen så tom ut, men det levende treet hadde listepunktet
   fortsatt slettet; ved neste åpning var det der igjen.

Fiks: `openItemsTrash` slår opp kortet på nytt via `findAnyById(cardId)` i hver
`rows()`/`empty()`-kall (som de andre gjør mot `state`), og `restore` går via
`restoreItem(it)` som re-slår opp listepunktet på id. Restore-hjelperne for alle
fire nivåene er samtidig gjort id-baserte, så samme klasse feil ikke kan ramme
mappe-/område-gjenoppretting hvis en rebuild treffer mellom render og klikk.

## Interaksjon (`attachTrashHold`)

Kort trykk → felles modal (`showTrashModal`: gjenopprett enkeltvis / tøm alt —
**uten ekstra bekreftelse**, samme som sveipe-tømming; modalen åpnes utsatt og
ignorerer overlay-klikk de første ~450 ms).

Tøm-knappen **navngir nivået den sletter** — `cfg.emptyLabel`: «Slett
områdene / mappene / listene / listepunktene / idéene for godt». Kassene deler
én knapp, så uten navnet sa den ingenting om hva som forsvant. Notatet og
knappen stables i `.modal-foot` (`.modal-note` tar hele linjen): ved siden av
hverandre ville den lengste knappeteksten presset notatet ned i en smal søyle.
Sveipefeltet har ikke plass til nivånavnet og sier «Slett alt».

### Radene: navnet har et gulv, resten bryter rundt det

En rad (`.trash-row`, lik for alle kassene) er `[prikk] [navn (+ metadata)]
[Gjenopprett]`. Prikken, metadataen og knappen har fast bredde; navnet er det
eneste som kan gi etter — og på en smal skjerm var «resten» omtrent ingenting.
Navnet fikk derfor ikke en fast bredde, men et **gulv**: navneblokka
(`.trash-main` = navn + metadata) har en flex-basis, og når den ikke får plass
bryter raden i stedet for å presse. Knappen faller ned på sin egen linje
(fortsatt høyrestilt, uendret berøringsflate), og metadataen legger seg under
navnet. Er det plass til alt, ligger raden på én linje som før — gulvet måles
mot radens FAKTISKE bredde, som er modalens, så det trengs ingen breakpoint.

**Metadataen er derimot kort, og skal være det.** Den sier hva slags rad dette
er («3 lister», «Mappekategori»), ikke hva som står i den. Notatene er det ene
nivået der metadataen er et UTDRAG av innholdet, og der klippes det kortere enn
på kortet: med kortets lengde ble raden fire linjer høy på en telefon, og
arkivets to knapper havnet midt i teksten.

Navnet vises alltid i sin helhet, aldri kappet med ellipsis: raden er nettopp
der brukeren skal kjenne igjen hva som ble slettet (samme grunn som toasten, se
`docs/design-system.md`). Det brytes mellom ord der det går
(`overflow-wrap: break-word`), og bare midt i ordet når ordet alene er bredere
enn raden. `word-break: break-word` er IKKE det samme: den gjør navnets
min-content-bredde til ett tegn, og da har flex ingen nedre grense å stoppe på —
det var årsaken til at et langt navn ble en loddrett bokstavsøyle på mobil mens
knappen ble dyttet ut av modalen. Geometrien er målt i
`tests/trash-modal-layout.test.js` (desktop, mobil og smal mobil).

Klikk-og-hold (> `HOLD_EXPAND_MS`) → **sveipefeltet**: feltet starter med
knappens EKSAKTE geometri (posisjon/størrelse/radius, og ikonet står nøyaktig
der knappens ikon står — samme visuelle størrelse) mens selve knappen skjules
(`visibility`), og vokser så i bredden mot høyre — det ser ut som knappen selv
utvider seg, ikke som en popover. Venstre kant og høyde ligger fast (ingen
vertikal asymmetri). Sveip helt til høyre roterer ikonet opp-ned og **tømmer**
(rist 500 ms, kollaps tilbake til knappebredden før knappen tar over igjen);
slipp før enden = avbryt + kollaps. Feltet er ETT delt listepunkt — eierskap og
kollaps-timer er delt (`swipeOwnerBtn`/`swipeCollapseTimer`) så en ventende
kollaps fra én knapp aldri skjuler feltet for en annen.

Bredden stopper ved den BRUKBARE høyre kanten (`safeInsets().right`), ikke ved
viewportkanten: i landskap med et hakk i høyre side ville etiketten og pilen
havnet under hakket — og sveipe-strekket, som regnes ut fra bredden, ville endt
et sted fingeren ikke når. 0 i en nettleser
([`design-system.md`](design-system.md), «Den sikre sonen»); vakt i
`tests/safe-area.test.js`.

Søppelkasse-ikonet i sveipefeltet (`ICONS.trashSwipe`, se `icons.js`) har kun
**to bevegelige deler**: hele ikonet (kasse-kropp + ribbene, urørt — de er
alltid synlige og roterer bare med resten) og `.swipe-icon-lid` (topp-strek +
hank), som roteres separat rundt venstre hengsel. `setProgress(p)` i
`attachTrashHold` (app.js) styrer begge via inline `transform`, i takt med
selve kassens 0→180°-rotasjon: lokket svinger **stadig lenger opp gjennom
hele sveipet og går aldri tilbake til lukket** (lineær, `-95° · p`), slik at
det henger tydelig løst av når kassen er helt opp-ned (p=1) — ikke smekket
igjen på nytt. Scrubbart (ikke en løkke-animasjon).

**ViewBox-en er kvadratisk og senter-symmetrisk rundt kassens midtpunkt**
(`-9.5 -9.5 43 43`): halvbredden er ≥ største avstand fra midtpunktet til noen
del av tegningen i noen kombinasjon av rotasjon og lokk-sving — hele kassen og
hele lokket er derfor ALLTID synlige, ingenting klippes. Kassen tegner ~40 %
av boksen; `.swipe-icon`s font-size (34px) er skalert opp tilsvarende slik at
kassen visuelt matcher knappens ikon (19px), og `SWIPE_ICON_BOX` i app.js
holder posisjoneringen i takt. Endres viewBox-en: regn ut `.swipe-icon-lid`s
transform-origin (hengselet 4.5,7.5) og `SWIPE_ICON_BOX` på nytt. Ikke fjern
`.swipe-icon-lid`-klassen uten å oppdatere `setProgress`/`collapseField`
tilsvarende.

Tømming setter **gravsteiner** rekursivt (område → mapper → lister →
listepunkter: `emptyUniversesTrash`/`emptyGroupsTrash`/`emptyCardsTrash`/
`emptyItemsTrash`). Idéene har ingen rekursjon å gjøre — de er flate — men
`emptyIdeasTrash` løsner idéer som pekte på en kategori som ble tømt bort, slik
`on delete set null` gjør i databasen. Destruktivt er alltid reversibelt frem
til tømming.

### Gravsteiner: hva de faktisk gjør

Gravsteinene finnes to steder, og BEGGE håndheves nå (fram til denne runden ble
de skrevet, men aldri konsultert — derfor kunne en klient med utdatert lokal
cache gjenopplive et permanent slettet objekt ved neste synk):

- **Lokalt** (`state._tomb`, id → tidsstempel, per bruker i cachen). Synk-motoren
  slår opp i det i BEGGE retninger: en gravlagt id settes aldri inn, og ligger
  raden fortsatt på serveren (slettingen rakk aldri fram, eller synk-basen gikk
  tapt før den ble pushet) fullføres slettingen i stedet for at fjern-raden får
  gjenopplive den lokalt. Se `reconcile` i `docs/accounts.md`.
- **På serveren** (`tombstones`-tabellen). AFTER DELETE-triggere skriver dem, og
  en BEFORE INSERT-vakt (`guard_object_insert`) AVVISER en insert med en
  gravlagt id — også fra en gammel klientversjon eller en rå `INSERT` mot
  PostgREST. Klienten kjenner igjen avvisningen (`PT409`, «gravlagt: …»),
  gravlegger raden lokalt og slutter å prøve. Se
  `docs/arkitektur-brukere-deling.md`.

Gravsteiner **utløper aldri**: en enhet som har ligget ubrukt i et år har
fortsatt sin gamle kopi. Den eneste automatiske oppryddingen er `import_doc`,
som fjerner gravsteinene for nøyaktig de id-ene importen skriver.

Vanlig sletting til papirkurven setter derimot INGEN gravstein — den er bare et
`trashed`-flagg, og «Gjenopprett» er en helt vanlig innholds-endring.

**Kontosletting** går utenom papirkurven: `delete_account()` sletter områdene
brukeren var eneste eier av permanent med en gang (kaskade + gravstein for hver
rad, akkurat som en tømming), for det finnes ingen konto igjen til å angre fra.
Gravsteinene fra en slettet konto blir stående som alle andre — de er id-er uten
personopplysninger, og de er nettopp det som hindrer at en annen enhet med gammel
cache legger innholdet inn igjen. Se `docs/rettigheter-og-deling.md` del 10.

Alle tekster/titler sier «hold og sveip for å slette dem for godt» (ikke «hold i
3 sekunder»).

## Feltet henger igjen hvis knappen forsvinner midt i et sveip

Listepunkt-søppelknappen bygges på nytt hver gang kortet re-renders
(`buildCard`/`refreshCard`, f.eks. via en synk-oppdatering mens brukeren
holder inne). Da fjernes DEN GAMLE knapp-DOM-noden midt i gesten, og
pekerfangsten (`setPointerCapture`) frigis implisitt — men verken
`pointerup` eller `pointercancel` fyres på den frakoblede knappen i så fall,
kun `lostpointercapture`, og den leveres på `document` (ikke på selve
knappen). `attachTrashHold` lytter derfor på `document` i fangst-fasen,
filtrert på `pointerId`, koblet til/fra PER TRYKK (ikke i selve
`attachTrashHold`-oppsettet) — ellers ville hver kort-ombygging lagt igjen en
varig `document`-lytter (én per listepunkt-søppelknapp som noensinne bygges).

## Tømming venter aldri på bufferet

`emptyXTrash()` starter med `commitBufferedFor(ids)`: alle buffrede rader i
tømmingens omfang committes umiddelbart (uten å vente på angre-vinduet) og
pilles ut av samle-toasten, før selve tømmingen kjører over hele lista.
Sveipefeltet og tøm-knappen er derfor **aldri sperret**; badge-tellerne viser
bare antallet. (Tidligere var begge deaktivert med spinnere til bufferet
var committet — det er borte.)

Commit-stedene som treffes av timeren/kategoribyttet (`armDeleteTimer`,
`pushDeleteToast`, `commitAllPending`) rydder fortsatt badge-tellerne bevisst
UTEN en full `render()`: `DELETE_BUFFER_MS`-timeren kan utløpe mens brukeren
har et usagret inline-redigeringsfelt åpent (`editText()` sitt `.edit-input`),
og en full board-rebuild ville slettet den uferdige redigeringen. `commitDeleteOne`
returnerer hva slags objekt som ble committet (`{ kind, obj, card? }`), og
`refreshTrashBadgesAfterCommit()` oppdaterer kun de relevante badgene
(`updateTrashCount`/`updateGroupsTrash`/`updateUniversesTrash`/
`updateItemsTrashBadge`).

`commitAllPending()` (ved `visibilitychange`/`pagehide`) rydder også modalen
hvis den står åpen (`renderTrashModalBody()`), så radene alltid speiler
faktisk tilstand.

**Forlate i stedet for å tømme**: kan man ikke slette objektet for alle
(`cap(obj, 'delete')` er usann — f.eks. et område man bare er medlem av, eller
en fri mappe man er vanlig medlem i), betyr «tøm» at man FORLATER det.
`emptyXTrash` splicer objektet lokalt og kaller `cloudLeave`, som legger
`leave_share` i bakgrunns-operasjonskøen og undertrykker raden fra synk-pullene
til den har landet (`suppressedRows`, se `docs/accounts.md`) — så den verken
gjenoppstår lokalt eller trigger delete-push mot andres rader. Forlatelse rører
ALDRI innholdet; det består for de andre.

## Søpla er felles, myndigheten er personlig

En søppelkasse kan inneholde objekter man ikke rår over: en liste slettet FØR
mappen ble låst, eller et delt område eieren har slettet for alle. Både
«Gjenopprett» og «Tøm» er derfor gatet per rad (`manage` / `purge` i
`showTrashModal`-konfigurasjonen):

- **`manage` → «Gjenopprett».** Å gjenopprette er å skrive `trashed = false`, og
  vakten krever nøyaktig samme myndighet som å slette (`can_delete_object`).
  Områder/mapper bruker serverens `caps.delete`; lister og listepunkter har
  ingen egne caps, og der er `!frozen(obj)` samme regel. Uten myndighet er
  knappen **avskrudd** med en forklarende tooltip, ikke skjult — raden skal
  fortsatt kunne ses og forstås.
- **`purge` → tøm-knappen.** Samme svar, men et område/en mappe man kan
  FORLATE teller også med (se over). Er ingenting i kassen tømbart, er knappen
  avskrudd; er kassen blandet, tømmes det tømbare og en toast sier fra om resten
  («Låst innhold ligger fortsatt i søppelkassen»). Sveipefeltet går utenom
  modalen, så toasten er nødvendig der.

Forlat-veien krever i tillegg at man FAKTISK kan forlate (`cap(obj, 'leave')`).
Er grunnen til at man ikke kan slette en LÅS — ikke at objektet er andres —
finnes det ingen rolle å gi fra seg, og raden blir stående i kassen i stedet for
å bli fjernet lokalt av en `leave_share` serveren ville avvist. Det samme gjelder
en mappe der den direkte mapperollen bare er overflødig ved siden av en
områderolle: da forlater man i området, ikke i mappen (se
`docs/rettigheter-og-deling.md`).

**Filtreringen må skje FØR `commitBufferedFor`.** Buffrede slettinger ligger i
kassen som vanlige rader (`live()` teller `_pendingDelete` som slettet), så en
naiv `commitBufferedFor(alle.map(id))` committer også raden tømmingen straks
etter hopper over. Rekker en mappe å bli låst inne i angre-vinduet (en annen
eier låser den mens toasten står), ville commit-en stemplet en `trashed = true`
serveren avviser — og samtidig kastet angre-muligheten. Alle fire
`emptyXTrash` filtrerer derfor med samme predikat de senere hopper over på
(`canPurgeGroup`/`canPurgeUniverse`/`!frozen`), og `emptyItemsTrash` returnerer
før commit-en når hele lista er frossen. Dekket av punkt 7b i
`tests/locked-group-creation.test.js`.

Uten disse sjekkene forsvant objektet lokalt (permanent gravstein) mens raden
levde videre for alle andre, og klienten forsøkte en `DELETE` RLS filtrerte bort
ved hver eneste synk-runde.

## Knappen svarer alltid på et lite bevegelig trykk

`openField()` kan avvise et sveipeforsøk FØR `mode` rekker å bli `'swiping'`
(tom kasse). Et ekte trykk har alltid litt bevegelse (fingerskjelving/
mus-jitter) — og `onUp` krevde tidligere BÅDE `mode === 'pending'` OG at
pekeren ikke hadde beveget seg (`!moved`) for å tolke slippet som et kort
trykk (åpne modalen). Da kunne et avvist forsøk med litt bevegelse ende med
at knappen ikke gjorde noenting ved slipp. Siden `mode` fortsatt `'pending'`
betyr at INGENTING visuelt åpnet seg, er det alltid trygt å tolke et slipp i
den tilstanden som et kort trykk — `onUp` åpner modalen uansett liten
bevegelse.
