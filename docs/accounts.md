# Brukerkontoer og deling — klienten

Les denne når oppgaven berører innlogging med e-post/passord, innloggede økter
og fjern-utlogging, synk mot de relasjonelle tabellene, rolle-/capability-
rendring, delings-UI, e-postvarsel eller innboks. Databasesiden: `docs/arkitektur-brukere-deling.md`. All koden
ligger i `app.js`, seksjonen «BRUKERKONTOER OG DELING».

Appen kjører KUN på ekte kontoer — mønster-låsen og synk-doc v1 er fjernet.
`?mock=1` bytter backend til `mock-backend.js` (hermetisk in-memory, for testing;
se under). Supabase-klienten lages av `acli()`.

## Auth-UI

Ett skjema (`#auth-screen`) med tre modi (`login`/`register`/`forgot`):

- **Registrering**: `supabase.auth.signUp`. Krever **fornavn + etternavn**
  (egne felt, kun i register-modus) → `display_name = «Fornavn Etternavn»`
  sendes som `options.data.display_name` og fanges av `handle_new_user`-
  triggeren (`docs/arkitektur-brukere-deling.md`). Med «Confirm email» på
  returneres ingen sesjon → «sjekk innboksen»-visning (`#auth-sent`).
- **Innlogging**: `signInWithPassword`.
- **Glemt passord**: `resetPasswordForEmail` → «sjekk innboksen». Retur via
  e-postlenken gir en `PASSWORD_RECOVERY`-hendelse → prompt om nytt passord.
- **Logg ut**: `signOut({ scope: 'local' })` (i konto-modalen) — se
  «Enheter og økter» under for hvorfor scopet står der.

Alle tre Supabase Auth-kall som tar en returadresse (`signUp`,
`resetPasswordForEmail`, og `updateUser({ email })` i konto-modalen) sender
`authRedirectUrl()` — ALDRI `location.origin` direkte. Se
`docs/domains-and-urls.md` (autoritativ for domener/URL-generering) for
hvorfor og hvordan.

**«Vis passordet»**: hvert passordfelt har en øye-knapp inni seg
(`.pass-wrap` + `.pass-toggle`, `data-pass-toggle="<felt-id>"`) som bytter
`input.type` mellom `password` og `text` — øyet i hvile, øyet med strek
(`ICONS.eyeOff`) når passordet vises. Én delt handler i app.js kobler alle
knappene ved oppstart, så et nytt passordfelt trenger bare markupen.
`clearPassFields()` tømmer OG skjuler igjen (konto-modalen åpnes, endring
lagret, utlogging).

**Bytte passord** (konto-modalen, `#account-pass-form`): to felt — nåværende og
nytt. Det nåværende bekreftes med en ny `signInWithPassword` FØR
`auth.updateUser({ password })`; samme bruker-id, så `onAuthStateChange` lar
appen stå (`authUser.id === user.id` → returnerer tidlig) og ingenting lastes
på nytt. Uten den sjekken kunne hvem som helst med tilgang til en åpen fane
overtatt kontoen. Feltet har ikke `minlength` — lengdekravet meldes i skjemaets
egen melding (`#account-msg`), ikke i en native valideringsboble som ville
blokkert submit-hendelsen.

**Slette kontoen** (konto-modalen, `#delete-account-btn` → `#delete-account-modal`):
den røde knappen står i høyre ende av samme linje som «Logg ut», som er GUL — to
handlinger med helt ulik konsekvens skal ikke se like ut.

Slettingen er endelig, så bekreftelsen er en **gest**, ikke en knapp: modalen
lister hva som forsvinner (og hva som blir stående hos andre, se
`docs/rettigheter-og-deling.md` del 10) og har ingen OK-knapp — bare «Avbryt» og
et sveipefelt som må dras helt til høyre. Feltet (`.confirm-swipe`) gjenbruker
søppelkassenes sveipe-formspråk (roterende kasse, fylling som følger sveipet) i
faresonens farger. Sveipet måles fra der fingeren gikk NED, ikke fra feltets
venstrekant: et trykk i høyre ende skal ikke i seg selv være en bekreftelse.
`role="slider"` + piltastene gir tastaturbrukere samme vei inn (fem trykk på pil
høyre), Home nullstiller.

Selve slettingen er ett RPC-kall (`delete_account`) som gjør alt serverside i én
transaksjon. Klienten gjør etterpå bare sitt eget: avbestiller en ventende
cache-skriving (nøkkelen fanges når skrivingen bestilles, så en skriving i lufta
ville lagt posten inn igjen 120 ms senere), fjerner brukerens cache-post og
`hk-migrated:<uid>`, og kaller `logout()` → innloggingssiden. Feiler RPC-en står
kontoen som før, og feilen vises i modalen så feltet kan sveipes på nytt.

Kvitteringen («Kontoen din er slettet.») settes i `authNotice` FØR utloggingen,
ikke som en toast: toasten ligger under auth-skjermen (z-index 300 mot 400).
`authNotice` males av `setAuthMode` i stedet for det vanlige `authMsg('')`, fordi
en utlogging gir TO runder med `setAuthMode('login')` — én synkron fra `logout()`
og én fra `SIGNED_OUT`-hendelsen — som begge ville tømt feltet. Den nullstilles
så snart brukeren gjør noe selv (bytter modus eller sender skjemaet).

Sesjonen styres av `supabase.auth.onAuthStateChange` (erstatter
`mine-lister-auth`): `SIGNED_IN` → `cloudStart()`, `SIGNED_OUT` →
`cloudStop()`. En eksisterende sesjon hentes ved oppstart med `getSession()`.
`authUser` bærer `{ id, email, meta }` der `meta` = `user.user_metadata`.

### Den låste oppstarten

Den som ikke er innlogget skal ALDRI se noe annet enn innloggingsskjermen.
Gaten er `body.no-auth`, som skjuler toppmenyen, board-et og hjørnekontrollene
(regelen ligger i `styles.css`).

Klassen står på `<body>` i `index.html`, altså fra FØRSTE MALING — ikke fra
`initAccounts()`. Stilarket lastes i `<head>` og er dermed på plass før noe
males, mens `app.js` er over 1 MB: settes gaten først derfra, rekker toppmenyen,
breadcrumben og hjørnekontrollene å bli malt bak innloggingsmuren så lenge fila
er underveis. Bakgrunnen bak gaten er den samme fargen som innloggingsskjermens,
så ventingen ser ut som en innloggingsskjerm som ennå ikke er ferdig — aldri som
appen.

`cloudStart()` er det ENESTE som fjerner klassen, og den kjører bare med en
innlogget bruker: gaten feiler LUKKET. Det gjelder også mens sesjonen hentes —
med et token nær utløp på en enhet uten nett kan `getSession()` bruke opptil 30
sekunder, og appen skal ikke vises i påvente av svaret. `cloudStop()` setter
klassen tilbake ved utlogging.

Vokter: `tests/auth-gate.test.js`.

**Demonstrasjonen på kontoen**: om den er fullført eller avsluttet, og med
hvilken versjon (`user_metadata.onboarding`) — og hvilke gest-tips som er vist
(`user_metadata.tips`) lagres på samme måte som posisjonen under — se
`docs/introduksjon.md` (autoritativ).

**Aktiv posisjon på kontoen**: hvilket område/mappe man står i lagres i
`user_metadata.nav = {u,g,np,nf}` via `auth.updateUser({ data })` — `u`/`g` er
listefanens område og mappe, `np`/`nf` notatfanens bokhylle og notatbok (debouncet,
`saveNavPref`), og gjenopprettes ved første pull (`restoreNavPref`). Se
`docs/data-model.md` for semantikken. Mock-backenden speiler dette:
`user_metadata` ligger på profilen i den delte «databasen», settes av
`updateUser`, og leses inn i sesjonsbrukeren ved `signInWithPassword` — så to
faner (= to enheter) deler den huskede posisjonen.

### Hva som ligger i enhetens lagring

Alt Huskis legger igjen på en enhet ligger i `localStorage` på appens eget
origin, i klartekst. De to øverste postene er de tunge:

| Post | Innhold | Levetid |
|---|---|---|
| `sb-<prosjekt-ref>-auth-token` | hele sesjonen: `access_token` (kortlevd JWT), **`refresh_token`**, og brukeren | skrives av supabase-js selv (`persistSession` og `autoRefreshToken` står på klientens standard `true`). Fornyer seg selv så lenge posten finnes; forsvinner ved utlogging |
| `mine-lister-v1:<uid>` (`cacheKey()`) | offline-bufferen: HELE brukerens innhold, pluss synk-basen og gravsteinene | til utlogging/kontosletting rydder den. Den usuffikserte `mine-lister-v1` kan ligge igjen fra tiden før kontoer, og leses bare av migreringsflyten nederst |
| `mine-lister-device` | enhetens `deviceId` — `org`/`posOrg` i LWW-stemplingen | permanent på enheten |
| `huskis-lang`, `huskis-theme` | språk og drakt, bevisst PER ENHET (`docs/sprak.md`, `docs/mork-drakt.md`) | permanent på enheten |
| `hk-migrated:<uid>` | engangsflagg for v1-migreringen | permanent på enheten |

**Denne lagringen skal bli på enheten.** Refresh-tokenet er en levende
legitimasjon: den som har posten, er innlogget som brukeren uten å ha logget
inn — og bufferen ved siden av er innholdet i lesbar form. `deviceId` hører
dessuten til ÉN enhet; en kopi av den gir to enheter samme LWW-opphav, slik at
uavgjort-bryteren i `newer()` ikke lenger bryter noe.

Nettleseren har ingen vei ut: `localStorage` er per origin og per nettleser, og
appen eksporterer den ingen steder. Android-appen har én, og den er slått av —
`android:allowBackup="false"` pluss regelfila for datauttrekk holder
WebView-lagringen utenfor både skykopien og enhet-til-enhet-overføringen. Hvorfor
det er valgt slik, og hvorfor det ikke koster noe: `docs/mobilapp-plan.md`
(«Sikker lagring og sikkerhetskopi»).

Serveren er kanonisk. En ny enhet trenger derfor ingenting med seg: brukeren
logger inn, og `get_my_doc()` fyller den.

## Enheter og økter

Kontoen kan være innlogget flere steder, og flere nettlesere kan ha varsler på.
Det er **to ulike ting**, og appen sier dem hver for seg — i konto-modalens
skuff «Enheter og økter», som to seksjoner med samme form:

| Seksjon | Spørsmålet den svarer på | Sannheten ligger i |
|---|---|---|
| **Innloggede enheter** | hvor har Huskis-kontoen min tilgang nå? | `auth.sessions` hos Supabase |
| **Enheter med varsler** | hvor kommer varslene også når Huskis er lukket? | `push_subscriptions` (nettlesere) + `native_notif_devices` (Android-appen) |

De er ikke slått sammen til én rad per «enhet», og det er et valg. Man kan være
innlogget uten varsler, og et push-abonnement kan overleve en økt. Den eneste
måten å binde dem sikkert sammen på ville vært å MÅLE enheten — altså
fingerprinting. To tydelige seksjoner er det ærlige svaret.

**Én rad er en klientkontekst, ikke en maskin.** Både `localStorage` og et
push-abonnement er origin-avgrensede: den samme telefonen kan ha én rad på
`huskis.no` og én på en gammel adresse, og de er to uavhengige ting. Derfor
står **verten** på hver rad — det er den som skiller dem. Unntaket er
Android-appen: dens vert er appens interne (`localhost`), altså en
kontekstnøkkel og ikke en adresse brukeren har vært på, og den vises ikke.

**«Enheter med varsler» dekker BEGGE kanaltypene.** En nettleser med web push og
Android-appen med sine lokale alarmer svarer på det samme spørsmålet, og står
derfor i den samme listen — semantikken (og hva en fjern-avslåing av en app kan
love) ligger i [`varsler.md`](varsler.md), «Enhetene med varsler».

### Hva som lagres, og hva som ikke gjør det

`auth.sessions` har både hele user-agenten og IP-adressen. Ingen av delene
forlater databasen: den første er en signatur, den andre er posisjon, og ingen
av dem trengs for å kjenne igjen en økt. Sidebordet `public.device_sessions`
bærer i stedet nøyaktig det som gjør en linje lesbar for eieren:

- en klassifikasjon av nettleseren («Chrome») og av plattformen («Android») —
  et fast, lite ordforråd, aldri råtekst;
- vertsnavnet økten ble opprettet på;
- enhetens egen lokale id (`mine-lister-device`);
- opprettet og sist sett.

Klienten sender dem selv (`session_touch`, maks hvert 10. minutt — `seen_at` er
«sist brukt», ikke en puls). Tabellen er LÅST på samme måte som push-utboksen:
RLS på, ingen policyer, ingen grants. Alt går gjennom RPC-er som setter
`user_id` fra `auth.uid()` og slår opp økten selv, så ingen klient kan navngi en
økt hen ikke eier.

### De fire utloggingene

| Handling | Hva den gjør | Mekanisme |
|---|---|---|
| **Logg ut** (konto-modalen) | avslutter BARE denne økten | `signOut({ scope: 'local' })` |
| **Logg ut** på en rad | avslutter én bestemt annen økt | `revoke_my_session(session_id)` |
| **Logg ut på alle andre enheter** | avslutter alle unntatt denne | `signOut({ scope: 'others' })` |
| Kontosletting | tar kontoen, og dermed alle øktene | `delete_account()` |

**Scopet på den vanlige utloggingen er ikke en detalj.** supabase-js har
`global` som standard, og global betyr ALLE brukerens økter — telefonen,
jobbmaskinen, nettbrettet. Knappen sier «Logg ut», og det brukeren mener med
den er «logg ut her». En knapp som stille også kastet ut de andre enhetene ville
vært en helt annen handling enn den den heter.

`revoke_my_session()` sletter raden i `auth.sessions` (og refresh-tokenene til
den) i en SECURITY DEFINER-funksjon: det er det som faktisk avslutter økten hos
Supabase, og klienten kan ikke fornye seg etterpå. En økt-id som ikke er min
treffer ingen rad og svarer `false` — samme svar som en id som ikke finnes, for
en feilmelding ville i seg selv fortalt at raden eksisterte.

`auth.sessions` er Supabase Auth sin tabell, og funksjonene som rører den kjører
som EIEREN sin (migreringsrollen). Skulle rettigheten dit mangle i et prosjekt,
faller ingenting annet: `session_alive()` svarer «levende» når den ikke får
lese — `get_my_doc()` kaller den hver synk-runde, og en feil der ville tatt hele
appen ned for en opplysning som gjelder én knapp — og klienten viser en feil på
selve knappen. Smoke-testen advarer om det ved deploy
([`release-og-deploy.md`](release-og-deploy.md), punkt 8).

### Et allerede utstedt access-token lever til det utløper

Det er Supabases egen semantikk, og Huskis bygger ikke et nytt auth-lag for å
omgå den. Men en fane som står åpen skal ikke bli stående med kontoens innhold
på skjermen i opptil en time: `get_my_doc()` bærer derfor `session_ok`, ett
indeksoppslag på økt-id-en fra tokenet. Er den `false`, går klienten samme vei
som en vanlig utlogging — i praksis innen én synk-runde (5 s).

**Fjern-utlogging er ikke datatap.** Nedriggingen er NØYAKTIG `logout()`:
synken stoppes, minnet tømmes, og den brukerspesifikke bufferen på disken blir
liggende. Lokale endringer som ennå ikke er synket ligger i den posten og kommer
tilbake ved neste innlogging. Beskjeden («Du ble logget ut fra en annen enhet.»)
males på innloggingssiden via `authNotice`, som kontoslettingens kvittering.

`session_ok` er `true` når økt-claimet mangler. En manglende opplysning er ikke
en tilbakekalling, og skal aldri kunne logge noen ut.

### Varsler per enhet

«Enheter med varsler» er den andre halvdelen, og semantikken ligger i
[`varsler.md`](varsler.md) («Enhetene med varsler»). Herfra er det verdt å vite
tre ting: listen kommer fra den samme RPC-en (`list_my_devices`),
**endepunktene forlater aldri serveren** — «denne enheten» avgjøres ved at
klientens eget endepunkt og klientkontekst sendes INN og sammenlignes der — og
raden bærer en `kind` (`web` eller `native`), som er det «Slå av» dispatcher på.

**En utlogging skal ikke etterlate en falsk varselenhet.** Android-appens
varselstatus meldes av (`enabled = false`) i utloggingen, men listen er ikke
avhengig av at det kallet kom fram: den krever at klientkonteksten fortsatt har
en levende økt. Lokal utlogging, fjern-utlogging og kontosletting fjerner derfor
raden fra listen av seg selv.

Begge listene sorteres likt: denne enheten først, resten etter `seen_at` med
nyeste øverst. En åpen skuff følger synk-runden (`refreshOpenDevices`), som
del-modalen gjør, så en rad som forsvinner et annet sted forsvinner her også.

## Synk-motor v2

Kanonisk innhold ligger nå relasjonelt (ikke ett jsonb-doc). Klienten holder
samme nested `state` som før; synken går slik (`cloudCycle`):

1. **Pull**: `get_my_doc()` → ett flatt doc (universes/groups/cards/items —
   pluss `ideas`, kontoens egne rader uten forelder i hierarkiet, se
   [`ideer.md`](ideer.md), `noteProjects`/`noteFolders`/`notes`, notatenes
   eget tre, og `links`, koblingene mellom de to hoveddelene — se
   [`notater-plan.md`](notater-plan.md)), med
   ekstra felt per rad: `creator`/`role`/`free`/`caps`/`locked`/`shared`/
   `personalPos`/`ownerKey`, samt
   `invites_in`/`invites_out`. Rader med en optimistisk forlatt deling
   (`suppressedRows`, se operasjonskøen under) filtreres bort — inkludert hele
   undertreet — i `contentDocFromMy`, så reconcile verken gjenoppliver dem
   lokalt eller pusher delete på eierens rader mens `leave_share` er underveis.
2. **3-veis fletting** (`reconcile(base, local, remote, opts)`) mot en
   base-snapshot (forrige serverkjente doc): felt-nivå LWW (gjenbruker
   `merge*Scalar`/`mergeItem` fra v1, `mergeIdea` for idéene og
   `mergeNoteProject`/`mergeNoteFolder`/`mergeNote` for notatene) for rader som
   finnes begge steder; et NOTATDOKUMENT flettes som ÉN verdi på
   innholdsregisteret — konflikten avgjøres per dokument, ikke per tegn; en
   KOBLING har ingen felter å flette (`mergeLink` tar serverens rad uendret),
   så den skriver aldri en update — der er det gravsteinene som avgjør;
   eksistens avgjøres 3-veis (base skiller «lokalt slettet» fra
   «fjern-opprettet»). `opts` bærer de tre vaktene under (gravsteiner, kjent
   base, fremmede rader).
3. **Push**: rad-CRUD (`insert`/`update`/`delete`) mot tabellene for radene der
   vår tilstand vant. Serveren håndhever RLS + felt-LWW (BEFORE UPDATE-
   triggere), så klienten stempler bare registrene som før og lar serveren
   avvise utdaterte/uautoriserte skrivinger. Etter en push kjøres straks en
   bekreftelses-pull (`cloudAgain = true`) — den frisker opp `lastMy`, så
   køede delings-operasjoner som venter på en nypushet rad
   (`rowKnownToServer`) slipper å vente på neste poll. Bekreftelses-pullen
   planlegges KUN når hele pushen landet (`pushOps` returnerer
   `{ rejected, netFailed }` — antall ops som ikke landet, og om minst én av
   dem aldri kom fram): en skriving som avvises permanent regenereres av
   reconcile hver runde,
   og med en ubetinget `cloudAgain` ble det en varm løkke som hamret
   `get_my_doc` + den samme avvisningen ~1 gang i sekundet. Blir noe avvist,
   overlates neste forsøk til det vanlige pollet.

   Notatradene sorteres inn i den samme foreldre-før-barn-rekkefølgen
   (bokhylle → notatbok → notat), og `pruneNoteParents` gjør for dem det
   `pruneDanglingCats` gjør for kategoriene: en notatbok-peker som ikke treffer
   nulles (notatet blir fritt), og en rad uten lesbar bokhylle tas ut av
   doc-en i stedet for å bli hengende i en usynlig retry-løkke. Peker notatet
   på en notatbok som FINNES, vinner notatbokens bokhylle — den samme regelen
   serveren håndhever (`notes_fix_parent`), så de to kan ikke bli uenige.

   **Unntaket er notatbøker og notater som er DELT DIREKTE med meg**
   ([`rettigheter-og-deling.md`](rettigheter-og-deling.md) del 14): for dem er
   «forelderen finnes ikke i mitt doc» normaltilstanden, ikke en hengende peker.
   De vises i den virtuelle «Delt med meg»-bokhyllen, bærer den kanoniske
   plasseringen i `_canonProject`/`_canonFolder`, og `pruneNoteParents` lar dem
   stå — en prune ville tatt dem ut av mitt doc, hvorpå fletteren leste dem som
   «slettet lokalt» og pushet DELETE på EIERENS rader.

   **Rekkefølge innen en tabell**: `items.cat_id`/`groups.cat_id` er
   fremmednøkler til SIN EGEN tabell, så `pushOps` sorterer kategorier FØR
   medlemmene sine (i tillegg til foreldre-før-barn på radtype). Kategorier
   nøstes aldri, så ett nivå holder. `docFromMyState` kjører i tillegg
   `pruneDanglingCats`: en `cat` som ikke treffer en kategori i doc-en nulles,
   for en slik rad er umulig å skrive (FK) og ville låst synken for godt.
   Prunet skjer på VÅR side av flettingen, ikke bare i payloaden — ellers ville
   lokal state fortsatt påstått den døde kategorien, og fletteren sett en
   forskjell mot serveren hver runde. Visningen behandler allerede en hengende
   `cat` som nivå 1, så dette skriver bare ned det brukeren ser.

   **Skrivefeil forblir bevisst stille — UNNTATT skjema-avvik.** Supabase-
   klienten kaster ikke på en avvist skriving; feilen kommer i `result.error`.
   De aller fleste er forventet og skal ikke støye: RLS-avvisninger (en mottaker
   skriver på eierens rad) og transiente konflikter/FK er selv-legende. Men et
   **skjema-avvik** — appen sender en kolonne databasen ikke har fordi en
   migrering henger etter deployen — får PostgREST til å avvise HVER insert/
   update for radtypen. Det stoppet en gang all liste-/listepunkt-synk usynlig
   (cards/items.collapsed-hendelsen). `reportWriteResult`/`isSchemaMismatch`
   (i `pushOps`) fanger derfor KUN den klassen (`PGRST204`/`PGRST205`/`42703` +
   «could not find … column»/«schema cache»/«column … does not exist»): logger
   detaljene deduplisert i konsollen og melder tabellen inn som en AVVISNING i
   lagringsstatusen (under). At en migrering i det hele tatt KAN henge etter, er
   lukket i releaseprosessen: ved merge til `main` kjøres migreringen og en
   smoke-test FØR frontenden publiseres, og Vercels egen git-deploy for `main`
   er slått av så de to ikke kan løpe om kapp — se
   [`release-og-deploy.md`](release-og-deploy.md).

   De øvrige feilene er fortsatt stille, men ikke lenger *usynlige*: avviser
   serveren SAMME rad `PERSISTENT_REJECTS` (3) ganger på rad, logges detaljene
   og raden meldes inn i lagringsstatusen (`noteReject`). Telleren nullstilles
   så snart raden går gjennom, så en forbigående konflikt aldri når terskelen.
   Det var nettopp en usynlig, evig avvist skriving (et listepunkt som pekte på
   en kategori serveren ikke hadde) som låste synken i praksis — se
   rekkefølge-/prune-avsnittet over og `tests/sync-dangling-category.test.js`.
   **Varslene rir på den samme runden.** Doc-et bærer to per-bruker-grener
   (`notifications`, `notify_prefs`) som IKKE er innhold og ikke flettes:
   `applyNotifications(my)` tar dem rått imot, og deretter kjører
   `runNotifications()` generatoren og logger tersklene som er passert siden
   markøren. Runden kaster aldri på det — en generering som ikke når fram lar
   markøren stå, og vinduet er fortsatt åpent neste gang. Se
   [`varsler.md`](varsler.md). Varselhistorikken nullstilles
   sammen med resten av den lokale synk-tilstanden — både ved utlogging og i
   `cloudStart`s gren for et kontobytte UTEN `SIGNED_OUT`, siden den nye
   brukerens første pull kan utebli helt offline.

4. **Det som starter en runde** (`scheduleCloud`, 300 ms debounce): en lokal
   endring (`save()`), **realtime** `postgres_changes` på de seks tabellene,
   **pollet** (5 s — det hopper over runder mens siden er skjult, så en app i
   bakgrunnen synker ikke), **`online`**, og **gjenopptakelsen**
   (`visibilitychange` → synlig igjen).

   `online` er en snarvei forbi en timer, ikke en bærebjelke, og det er med
   vilje: pollet henter inn etterslepet uansett, og frakoblet-terskelen i
   lagringsstatusen ser et brutt nett uten å spørre `navigator.onLine`. Derfor
   tåler synken en runtime der `online` aldri fyrer
   (`tests/sync-foreground.test.js`).

   Gjenopptakelsen er derimot bærende, og deler jobben med pollet etter hvor
   lenge appen var borte. Mens siden er skjult er pollet blindt, og hvor lenge
   «til neste tikk» varer eier vi ikke — en skjult side får timerne sine
   strupet. Lever prosessen, er retur en HENDELSE, og lytteren starter runden
   der og da. Men fryser OS-et prosessen — målt på Android — snur synligheten
   mens den står stille, og hendelsen blir aldri levert; da er det pollets
   forfalte tikk som starter runden, som første handling etter opptiningen.
   Derfor må guarden i pollet lese `document.hidden` på tikket, ikke et flagg en
   synlighetslytter setter ([`mobilapp-plan.md`](mobilapp-plan.md), fase 3).

Offline-buffer: `state` caches per bruker (`mine-lister-v1:<uid>`), uten intern
metadata (`stateReplacer` hopper over `_`-felt for å unngå sykliske refs — med
unntak av `_createdByMe`, `_tomb`, `_hlc` og `_base`/`_baseV`).

### Lagringsstatus (`syncStatus`, `#sync-status`)

Én diskret, **vedvarende** status nede til venstre er alt brukeren får se om
synken — ingen forbigående synk-toaster. Formen er beskrevet i
[`design-system.md`](design-system.md); her ligger semantikken.

Statusen har ingen egen «tror vi er lagret»-variabel: den regnes ut av den
faktiske operasjonstilstanden hver gang den males, av tre uavhengige signaler:

| Signal | Sant når | Vises som |
|---|---|---|
| **ventende** (`pending`) | den debouncede cache-skrivingen venter MED BRUKERENS endringer (`cacheDirty`), `opQueue` har noe på gang, serveren ikke har svart én eneste gang (`!lastMy`), eller `saveSeq !== syncedSeq` | «Lagrer …» |
| **frakoblet** (`offline`) | `navigator.onLine === false`, eller `OFFLINE_AFTER_FAILURES` (2) kall på rad som aldri nådde fram (`isNetworkError`) | «Frakoblet – endringene lagres på denne enheten» |
| **avvist** (`rejected`) | en skriving ble sagt nei til. Serverside: skjema-avvik (per tabell) eller en rad avvist `PERSISTENT_REJECTS` ganger. Lokalt: `localStorage.setItem` som kaster (full kvote, blokkerte nettsteddata) — `kind: 'cache'` | «Noen endringer kunne ikke lagres på kontoen din.» + «Prøv igjen» |

Avvist har **to tekster**, fordi de to kildene rammer hver sin lagringsplass.
Er ALLE avvisningene `kind: 'cache'`, sier statusen «Endringene lagres ikke på
denne enheten.»: serveren kan godt ha tatt imot endringen, det er localStorage
som ikke tok den. Er én av dem serverside, vinner «Noen endringer kunne ikke
lagres på kontoen din.» — det er den alvorligste. `data-state` er `rejected` i
begge tilfeller (rød prikk + «Prøv igjen»), og `state()`/`snapshot()` skiller
dem via `kind`.

Rekkefølgen er **avvist → frakoblet → ventende → lagret**: en avvisning er et
uløst problem selv om vi akkurat nå også er frakoblet, og skal ikke skjules av
en tilstand som løser seg selv. Er alle tre tomme — og først da — står det
«Lagret».

Sju ting følger av at statusen skal være til å stole på:

- **En synk-RUNDE er ikke «ventende arbeid».** Runder kjører hele tiden (poll
  hvert 5. sekund, hver realtime-hendelse fra en annen enhet). Teller vi dem,
  blinker statusen mellom «Lagrer …» og «Lagret» i det uendelige uten at
  brukeren har gjort noe. `saveSeq !== syncedSeq` fanger uansett enhver lokal
  endring en runde ikke har fått pushet — det er det påstanden gjelder.
- **Synkens egne buffer-skrivinger er heller ikke ventende arbeid.** Synken
  skriver til den samme `localStorage`-bufferen som brukeren, men på vei NED fra
  serveren: fletteresultatet (`render()` under `applyingRemote`), basen
  (`persistBase`) og gravsteiner går alle gjennom `saveLocal()`. Bare `save()`
  setter `cacheDirty`, og bare en `cacheDirty`-skriving teller som ventende.
  Uten det skillet blinket statusen «Lagrer …» → «Lagret» → «Lagrer …» →
  «Lagret» etter hver eneste lagring — én ekstra blink per runde som rørte
  bufferen. Flagget nullstilles først når `setItem` faktisk gikk gjennom: feiler
  den, ligger endringene fortsatt bare i minnet. Merk at `updateSafety()` (er en
  automatisk reload trygg?) fortsatt ser på HELE `saveTimer` — der er spørsmålet
  om bufferen er i takt med minnet, ikke om brukeren har noe utestående.
- **Terskelen på 2 for «frakoblet»** gjør at ett enkelt nettverksglipp ikke
  blinker; pollet henter det inn igjen. En runde som får svar fra serveren
  nullstiller tellingen (`noteReachable`), også når svaret er en feil — da er vi
  jo tilkoblet.
- **Verdikten om å ha nådd fram felles per RUNDE, ikke når pull-en er ferdig.**
  `pushOps` returnerer `{ rejected, netFailed }`, og `cloudCycle` holder
  `reached` åpen til `finally`. Meldte vi «tilkoblet» straks `get_my_doc` gikk
  gjennom, ville en runde der pull-en lykkes men hver SKRIVING dør i
  transporten nullstilt tellingen hver gang: terskelen ble aldri nådd, og
  statusen sto på «Lagrer …» i det uendelige i stedet for å si at endringene
  ikke kommer fram. `netFailed` er boolsk og ikke en teller — ti rader som ikke
  kom fram i samme runde er ÉN nettverksfeil, ellers er terskelen meningsløs.
- **Avvisninger tømmes aldri på antakelse.** Enten kvitterer serveren for
  nettopp den raden/tabellen (`reportWriteResult`), eller så finner fletteren
  ingen divergens igjen (`ops.length === 0` i `cloudCycle`) — altså ligger alt
  vi har lokalt også på serveren. Derfor sier UI-et heller aldri at «resten er
  lagret»: det er ikke verifisert. Buffer-avvisningen (`kind: 'cache'`) er
  unntatt fra den siste veien (`clearServerRejections`): at vi er i takt med
  serveren sier ingenting om hvorvidt `localStorage` tok imot, så den ryddes
  kun av en skriving som faktisk gikk gjennom.
- **En feilet lokal buffer-skriving svelges ikke.** Kaster `setItem` (kvote
  full, privat modus, blokkerte nettsteddata), ligger endringene bare i minnet i
  denne fanen — da ville både «Lagret» og «endringene lagres på denne enheten»
  vært løgn. Feilen logges og meldes som en avvisning, og «Prøv igjen»
  bestiller en ny skriving.
- **«Prøv igjen»** (`retrySyncNow`) napper `opQueue` og synk-runden i gang med
  én gang — backoffen ventes ikke ut, men fjernes ikke: den automatiske retryen
  går som før. Knappen rører ikke avvisningslisten. Mens forsøket pågår står
  statusen på «Lagrer …»; feiler det, kommer avvisningen tilbake av seg selv.

Teknikken (tabell, rad, feilkode, meldingstekst) går KUN til konsollen og til
`__huskis.syncStatus.snapshot()` — aldri inn i statusteksten. Ved utlogging
tømmes hele statusen (`syncStatus.stop()`): den skal ikke stå igjen og påstå noe
om en konto som ikke er logget inn lenger. Dekkes av
`tests/sync-status.test.js`.

### Gjenoppstandelse: hvorfor basen lagres og gravsteinene håndheves

`cloudBase` levde tidligere bare i minnet. Hver oppstart begynte derfor med en
TOM base, og første synk var i praksis `reconcile(emptyDoc(), local, remote)` —
der kombinasjonen «finnes lokalt, ikke på serveren, ikke i base» leses som en
**lokal nyopprettelse**. En klient med utdatert cache (en annen enhet, en annen
nettleser eller en gammel fane — `localStorage` er per origin og per nettleser)
satte da inn igjen alt den hadde og serveren ikke hadde,
inkludert permanent slettede objekter. `state._tomb` og `tombstones`-tabellen
fantes begge, men ingen av dem ble konsultert. Fire lag løser det:

1. **Basen overlever omstart.** Den lagres i den brukerspesifikke cachen, i
   SAMME `localStorage`-post som innholdet (én skriving → base og innhold kan
   ikke komme i utakt), med et versjonsnummer (`_baseV`, `BASE_VERSION`) så en
   framtidig endring av doc-fasongen forkaster gamle baser i stedet for å
   mistolke dem. Basen rykker fram KUN når fletteresultatet faktisk er tatt i
   bruk i `state` — ellers ville den beskrevet rader staten ikke har, og neste
   runde lest dem som «slettet lokalt» → push `DELETE` på gyldige rader. Og så
   lenge historikken er UAVKLART (se 2), skrives ingen gyldig base til disk i det
   hele tatt: tvilen lever bare i minnet, så en gyldig base på disk ville fått
   neste oppstart til å tro at den visste hva serveren hadde.
2. **Manglende base = ukjent historikk, ikke nyopprettelse** (`unknownHistory`,
   satt av `loadCache` til id-ene i en cache uten gyldig base). Bare DE radene er
   tvilsomme; de samles i `unverified` i stedet for å bli pushet. Klienten slår
   dem opp mot serverens `tombstones` (direkte tabell-select på
   `resource_id in (…)`, i porsjoner à 100, RLS: lesbar for innloggede),
   gravlegger treffene lokalt og fletter på nytt. De som overlever er ekte lokale
   nyopprettelser og pushes i samme runde — så en genuint ny liste blir ikke
   forsinket. Oppslaget skjer kun når det finnes tvilstilfeller, altså aldri i
   steady state. Alt brukeren lager ETTER at cachen ble lest er utvilsomt nytt og
   skrives som før, så et midlertidig feilende oppslag ikke kan stoppe vanlig
   bruk.
3. **Gravsteiner konsulteres i begge retninger** (`opts.tombs` = `tombIds()`,
   union av `state._tomb`). En gravlagt id havner aldri i `merged` og får aldri
   en insert; ligger den fortsatt på serveren, sendes en `delete` i stedet.
4. **Fremmede rader gjenskapes aldri** (`opts.foreign`): tvilsomme rader der
   cachen sier `_createdByMe === false`. Forsvinner en slik rad fra serveren, er
   delingen opphørt eller eieren har slettet den — begge veier skal den slippes,
   for `insertPayload` ville satt OSS som `owner_id` og dermed gjort en gammel
   kopi av andres innhold til vår. Settet fryses for HELE runden (`doubted` i
   `cloudCycle`): den andre flettingen, etter gravsteins-oppslaget, må ta samme
   avgjørelse som den første — leste den `foreign` av det da-tømte tvilssettet,
   ville en tilbaketrukket deling glidd gjennom som en «lokal nyopprettelse».

Siste forsvarslag ligger i databasen: `guard_object_insert` avviser en insert
med gravlagt id (`PT409`, «gravlagt: …»). `pushOps` kjenner igjen svaret
(`isTombstoneReject`), gravlegger raden lokalt og regner det IKKE som en feilet
skriving — så bekreftelses-pullen går som normalt og raden forsvinner fra
visningen med det samme. Det fanger både en klient som ikke rakk å hente
gravsteinen og kappløpet der en annen enhet sletter i samme øyeblikk som vi
skriver. Se `docs/arkitektur-brukere-deling.md` og `docs/trash.md`.

Ved **utlogging** tømmes innhold, gravsteiner og base sammen (`resetLocalSync`),
og ved **innlogging** leses alle tre fra den nye brukerens egen cache-post (eller
nullstilles hvis den ikke finnes) — ingen del av forrige brukers synk-tilstand
kan leses som historikk for den neste.

**Og SKJERMEN ryddes med.** `body.no-auth` skjuler bare toppmenyen, board-et og
hjørneknappene; en modal er en overlay OVER innloggingsskjermen, og en som ble
stående igjen viste den utloggede kontoens innhold til noen lukket den.
`cloudStop()` tømmer derfor HELE lag-stigen (`closeTopLayer` i løkke), ikke en
håndplukket liste modaler — et nytt lag er dekket av å ligge i stigen. Idélisten
(`docs/ideer.md`) tegnes i tillegg tom, siden den ellers først bygges på nytt
når modalen åpnes igjen.

**Render-vakt (`viewSignature`/`lastViewSig`)**: `applyMyDoc` river ned og
bygger hele board-DOM-en (`render()`). `cloudCycle` kaller den derfor KUN når
visningen faktisk endrer seg — en signatur over (flettet innhold + server-
metadata + optimistiske overlays) sammenlignes mot forrige anvendte. Uten denne
vakta tegnet hvert poll (hvert 5. s) board-et på nytt og nullstilte hover-
tilstanden (synlig «blink»); verre: hvis en push aldri lander (f.eks. en kolonne
mangler i basen så PostgREST avviser hver insert), genererer reconcile samme
op hver runde → `cloudAgain` → en rask retry-løkke som uten vakta ga konstant
flimmer. Motstykket til v1-synkens `mergedCanon !== localCanon`. Nullstilles ved
inn-/utlogging så en fersk sesjon alltid tegner første gang.

Vakta har en konsekvens for BASEN: blir fletteresultatet ikke tatt i bruk (aktiv
redigering/draging), rykker `cloudBase` heller ikke fram. Ellers ville basen
beskrevet rader `state` ikke har, og neste runde lest dem som «slettet lokalt» —
en liste en annen enhet nettopp opprettet ville blitt SLETTET på serveren fordi
den kom mens brukeren skrev. Basen er per definisjon «fjern-doc'et vi har flettet
mot», og skal bare oppdateres når vi faktisk har flettet mot det.

## Bakgrunns-operasjonskøen (`opQueue`)

Delings-operasjonene går ikke gjennom doc-synken, og ventet tidligere i UI-et
(deaktiverte knapper, spinnere, «Laster …») til de hadde landet. Nå utføres de
**optimistisk** i UI-et og legges i én **seriell kø** i bakgrunnen — brukeren
kan alltid gjøre neste operasjon umiddelbart, uansett hvor treg forrige er:

- **Serialisering**: neste operasjon starter først når forrige er ferdig, så to
  skrivinger på samme rad aldri lander i feil rekkefølge.
- **Koalescering** (`key` + `merge`): en operasjon med samme nøkkel som en som
  VENTER i køen slås sammen med den (siste tilstand vinner) — lås-spam blir én
  `set_locked` med sluttilstanden, gjentatt omrokkering én `memberships.pos`-skriving.
- **Kjeding** (`op.value`): resultatet av en ferdig operasjon er tilgjengelig
  for senere køede — «Trekk tilbake» på en invitasjon som ennå ikke er
  opprettet, køes bak opprettelsen og bruker invitasjons-id-en fra dens svar.
  Ligger opprettelsen fortsatt i kø, avbrytes den i stedet (`opQueue.cancel`) —
  kontrollert avbrudd, ingen server-trafikk.
- **Forutsetninger** (`waitFor`): en operasjon som avhenger av at doc-synken
  har pushet en rad først (inviter/lås et NYOPPRETTET objekt), blir stående
  fremst i køen til `rowKnownToServer(id)` er sann (raden finnes i `lastMy`).
  Gir opp med rollback etter ~60 s, så en rad som aldri dukker opp ikke låser
  køen evig.
- **Nettverksfeil** (offline): operasjonen legges fremst igjen og prøves med
  backoff (maks 15 s); `online`-hendelsen og «Prøv igjen» napper køen i gang
  (`retryNow`, som også nullstiller backoffen). Rekkefølgen bevares — alt bak
  venter, akkurat som doc-synken selv. Feilen meldes som FRAKOBLET til
  lagringsstatusen, ikke som en avvisning.
- **Serveravvisning**: operasjonens `onError` ruller UI-et tilbake (fjerner den
  optimistiske raden / resynker) og viser feilen — sluttilstanden blir som om
  operasjonen aldri var mulig. Teknikken logges (`console.warn`). Slike
  operasjoner havner IKKE i lagringsstatusens avvisningsliste: de er rullet
  tilbake, så det finnes ingenting igjen å prøve om igjen.
- Ved utlogging (`cloudStop`) tømmes køen og overlayene (operasjonene tilhørte
  den gamle sesjonen). En operasjon som allerede er I LUFTA kan ikke avbrytes,
  men en epoke-teller gjør at resultatet forkastes når den lander — ingen
  callbacks og ingen nettverks-retry, så arbeid fra forrige konto aldri kjører
  videre under en ny innlogging.

**Optimistiske overlays** holder lokal visning stabil over synk-rebuilds til
operasjonen har landet (applyMyDoc bygger ellers fra serverens metadata, som
ennå ikke vet om endringen): `lockOverrides` (ønsket lås-status),
`posOverrides` (personlig posisjon i kø) og `pendingGroupMoves` (mappeflytting
i kø — mappen vises optimistisk på det nye stedet selv før
patchen har landet), `suppressedRows` (forlatte delinger, filtreres fra pull),
`suppressedInvites` (besvarte invitasjoner, filtreres fra innboksen). Ryddes
av operasjonens onDone/onError når køen ikke har flere operasjoner for samme
nøkkel, fulgt av en resynk.

Avveining: køen lever i minnet. Lukkes fanen FØR en køet operasjon har landet,
er den borte (samme vindu som et vanlig RPC-kall hadde; doc-synkede endringer
overlever derimot via localStorage-cachen). Operasjoner committes ikke ved
`pagehide` — det finnes ingen synkron flush for autentiserte RPC-er.

## Rolle- og capability-rendring (delt innhold)

Delt innhold er FELLES; det som er per bruker er **rollen** og den **personlige
rekkefølgen** — begge på medlemskapsraden. I `applyMyDoc`:

- Metadata legges på objektene: `_type`/`_parent`/`_creator`/`_createdByMe`/
  `_role`/`_free`/`_caps`/`_shared`/`_locked`/`_unlocked`/`_invitePolicy`/
  `_ownerKey`/`_memberCount`/`_ownerCount`.
- **Personlig posisjon**: for områder (alltid) og FRIE mapper settes `.pos` fra
  medlemskapsraden, mens den kanoniske verdien tas vare på i `_canon` og skrives
  tilbake uendret (`canonRow`). En personlig omrokkering kan dermed aldri endre
  hva andre ser. Skrivingen går via `cloudPersonalPos` (koalescert kø-operasjon
  mot `memberships.pos`, med `posOverrides` som optimistisk overlay).
- **Tre seksjoner**: områder med `_role === 'owner'` → «Mine områder»;
  `'member'` → «Områder delt med meg»; mapper med `free = true` samles i en
  **virtuell beholder** (`FREE_UNI_ID`, `_virtual: true`) → «Mapper delt med
  meg». Beholderen pushes aldri (`flattenNested` hopper over den), og mappene i
  den beholder sitt kanoniske `uni` i doc-et.
- `frozen(obj)` = nærmeste eksplisitte lås-tilstand oppover sier låst, og jeg er
  ikke eier på nivået (`privilegedLocal`). Serveren blokkerer uansett.
- `cap(obj, navn, fallback)` leser serverens `_caps`; et lokalt nyopprettet
  objekt (ennå ikke synket) faller tilbake på `fallback` — brukeren laget det
  nettopp selv.
- `attachMeta` legger de optimistiske overlayene (`lockOverrides`/
  `unlockOverrides`/`policyOverrides`/`posOverrides`/`pendingGroupMoves`) OVER
  serverens metadata, så en endring med skrivingen fortsatt i kø ikke visuelt
  hopper tilbake når en pull rekker å kjøre først.
- **Tap av tilgang**: forsvinner det aktive området/mappen fra doc-et, lukker
  `noteAccessLoss` åpne modaler, `validateActive` velger nærmeste gyldige
  fallback, og en toast forklarer hva som skjedde.

### Mappeflytting (`move_group`)

`groups.universe_id` kan ikke skrives direkte — databasen avviser det. En mappe
som dras til et annet område flyttes optimistisk lokalt og registreres i
`pendingGroupMoves`; doc-et beholder den GAMLE plasseringen til RPC-en har
landet, så synken aldri forsøker en skriving serveren uansett avviser.

`commitGroupMove` sammenligner områdenes `ownerKey` (eierskapsdomenet). Er de
ulike, vises en eksplisitt bekreftelse først — flyttingen er da semantisk «slett
hos de gamle, opprett hos de nye». Avbryter brukeren, ruller `revertGroupMove`
mappen tilbake. Lander RPC-en med `mode: 'copy'`, bytter `applyIdMapping` de
gamle id-ene mot de nye i hele det lokale treet og gravlegger de gamle, så
visningen glir over uten flimmer.

## Delings-UI

> Rettighetsmodellen (hvem ser hvilke kontroller) er definert i
> [`rettigheter-og-deling.md`](rettigheter-og-deling.md). Del-UI-et er
> **capability-gated** ut fra `get_members().viewer.caps`, med `obj._caps` fra
> `get_my_doc` som umiddelbart anslag.

- **Én visning for alle.** `renderShareModal` erstatter det gamle eier/mottaker-
  skillet: medlemslisten er synlig for enhver med tilgang, mens invitasjonsfelt,
  rollevelger, medlemsadministrasjon, lås, «Forlat» og «Slett for alle» vises
  etter capabilities.
- **Åpning**: områder og mapper deles fra «Deling og medlemmer» i objektmenyen i
  nav-modalen — knappene er synlige for ALLE med tilgang (medlemslisten er åpen).
  Begge sender `openNavModal` som `backTo`. **Lister har ingen deling** — og
  ingen delerad i menyen sin: at mappen er delt vises med `.share-badge` i
  listekortets hode, og delingen endres fra MAPPENS meny.
- **Medlemslisten** grupperes etter kategori med overskrifter («Eier»/«Medeiere»,
  «Eier av mappen»/«Medeiere av mappen», «Medlemmer av området»,
  «Medlemmer av mappen»); tomme kategorier utelates. Hver rad viser rollen, og
  for den som administrerer medlemmer også en forklaring når brukeren ikke kan
  fjernes her («Har tilgang via området og må fjernes der» / «Siste eier kan
  ikke fjernes»). Ventende invitasjoner står i en egen seksjon.
- **Modalen er levende, ikke et øyeblikksbilde.** `refreshMembers` kalles ved
  åpning, etter egne handlinger OG fra hver `cloudCycle` (`refreshOpenShare`),
  slik at en invitasjon som blir godtatt — eller et medlem, en rolle, en policy
  eller en lås som endres av noen andre — slår inn i den ÅPNE modalen.
  Realtime-hendelsen på `memberships`/`share_invites` gir oppdateringen med én
  gang, pollet er fallback. To vakter holder det rolig: listen tegnes bare om
  når svaret faktisk er et ANNET enn det radene står med nå (samme grep som
  `lastViewSig` i synken — ellers ville radene blitt revet ut av DOM-en midt i
  et klikk), og det går én runde av gangen. En optimistisk endring — fjernet
  rad, deaktivert knapp — nullstiller signaturen (`optimisticEdit`), slik at et
  AVVIST kall faktisk blir rullet tilbake: da er jo serversvaret identisk med
  det forrige. Modalen slår samtidig opp objektet på nytt
  (`findAnyById`), siden hver anvendte pull bygger `state` på nytt og kopien
  modalen ble åpnet med dermed er forlatt. Lukking kobler oppdatereren fra.
- **Inviter** (`create_share_invite`): e-postfelt + rollevelger («Som medlem» /
  «Som medeier»). Velgeren vises kun ved `caps.inviteOwner`. Raden («Invitert
  som …») vises straks og feltet tømmes; flere invitasjoner køes. Feiler den,
  fjernes raden og feilen vises. Kvitteringen «Invitasjon sendt til …» gjelder
  en VENTENDE invitasjon: er den besvart — godtatt eller avslått — forsvinner
  den sammen med den ventende raden.
- **Degradering** (`set_member_role`): «Gjør til medlem» på en medeier, med
  bekreftelse. Rolleløft finnes ikke som knapp — det krever en invitasjon.
- **Fjern** (`revoke_share`) / **Trekk tilbake** (`revoke_share_invite`): raden
  forsvinner straks; `refreshMembers` gjenoppretter ved avvisning.
- **Invitasjonspolicy** (`set_invite_policy`, overlay `policyOverrides`): en
  avmerkingsboks under e-postfeltet, interaktiv kun ved `caps.managePolicy`,
  ellers en lesbar status.
- **Lås/åpne** (`set_locked`) og **unntak fra arvet lås** (`set_unlocked`):
  som før, men gatet av `caps.manageLock` / `caps.lockException`.
- **Forlat** (`caps.leave`, `leave_share`) og **Slett for alle** (`caps.delete`)
  står sammen nederst — begge kan være aktuelle samtidig for en medeier. Er man
  eneste eier, forklarer en linje hvorfor «Forlat» mangler.
- **Innboks** (i konto-modalen, badge på kontoknappen): godta
  (`accept_share_invite` — **ingen plassering å velge**) eller avslå fjerner raden
  umiddelbart (`suppressedInvites`) med RPC-en i køen; innholdet dukker opp når
  neste pull ser rollen. Eierskaps-invitasjoner merkes «som medeier, fra …».
  Hver rad viser inviterendes **navn**, ikke e-posten.

## Varsling ved deling (i appen + e-post)

Mottakeren varsles på to måter når noe deles med hen:

- **I appen (alltid)**: `updateInbox(my)` (kalt hver `cloudCycle`) setter en rød
  ring med antall (`#account-badge`) på kontoknappen — summen av `invites_in` (ikke
  besvarte) — og fyller «Invitasjoner»-innboksen i konto-
  modalen. Dette dekker **registrerte** mottakere fullt ut (de trenger ikke
  e-post).
- **På e-post (valgfritt)**: en `share_invites`-insert-trigger i databasen
  (`send_invite_email`, pg_net → Resend, `docs/arkitektur-brukere-deling.md`)
  sender en profilert Huskis-e-post (branded tabell-HTML + `text/plain`, PNG-
  logo, skifer/grønn-palett, escaping + `url_encode`). **Uregistrerte**
  mottakere får «Du er invitert» med lenke `<app_url>?signup=<e-post>`;
  **registrerte** får «‹objekt› er delt med deg» + åpne-appen-lenke, men kun
  hvis de har e-postvarsel PÅ. Resend-nøkkelen ligger i **Supabase Vault**
  (`app_config` er kun fallback for lokale tester); triggeren gjør ingenting uten
  nøkkel, og køleggingen logges i den låste `email_send_log` (`enqueue_status`,
  ikke leveringsstatus) — se `docs/arkitektur-brukere-deling.md`
  og `TODO.md`.
- **`?signup=<e-post>`-dyplenke** (`applySignupInvite`, i `initAccounts`): åpner
  auth-skjermen i **register**-modus med e-posten utfylt + en «du er invitert»-
  melding, så en uregistrert mottaker oppretter konto direkte. `handle_new_user`
  kobler den ventende invitasjonen på e-post ved registrering, og den dukker opp
  i innboksen straks mottakeren logger inn.
- **Språk** (`user_metadata.lang`): språkvelgeren i konto-modalen skriver
  valget både til enheten (`localStorage['huskis-lang']`) og til kontoen, og
  laster appen på nytt. Kontoens verdi vinner ved innlogging
  (`adoptAccountLanguage()` i `cloudStart`). Serveren leser den samme verdien
  når den skriver delings-e-poster. Autoritativt: `docs/sprak.md`.
- **E-postvarsel-innstilling** (registrerte): en toggle i konto-modalen
  (`#email-pref-toggle`) lagrer `user_metadata.email_notifications` via
  `auth.updateUser({ data })` (optimistisk, `emailPrefOn`/`paintEmailPref`).
  Standard PÅ (manglende flagg → på). E-post-triggeren respekterer flagget for
  registrerte mottakere. Mock-backenden speiler `user_metadata` (samme vei som
  `nav`), så toggelen persisterer på tvers av «faner» i test.

## Profilbilde

Bildet lagres i `profiles.avatar` som en **data-URI**: ett kvadratisk JPEG på
**256×256** (`AVATAR_SIZE`, kvalitet 0.82) — nok til at den største sirkelen i
appen (56 px) er skarp også på 3x-skjermer, lite nok til at raden blir noen få
titalls kB. Ikke Supabase Storage: raden er allerede den vi henter personen fra,
og `get_members` kan levere bildet sammen med navn/e-post. Størrelsen håndheves
i databasen (`profiles_avatar_size`, ≤ 200 000 tegn) fordi klienten er en
systemgrense; `grant update (display_name, avatar)` er utvidet tilsvarende.

- **Henting**: eget kall (`loadMyAvatar`, `select avatar from profiles` ved
  `cloudStart`), IKKE via `get_my_doc` — doc-et pollet hvert 5. sekund skal ikke
  bære et bilde. Andres bilder kommer med `get_members` (lat + cachet i
  `shareGroupCache`).
- **Visning**: `paintAvatar(el, avatar, initialer)` fyller enhver avatar-sirkel
  med et `<img>` når personen har bilde, ellers initialene — delt av
  `paintAccountAvatar` (konto-modalen), `avatarFor` (delings-medlemmer) og
  `respAvatar` (ansvarssirkler). `paintAccountAvatar` maler kun når (bilde,
  initialer) faktisk er endret, siden `updateInbox` kjører hver synk-runde.
- **Skriving** (`storeAvatar`): konto-sirkelen males umiddelbart (den males
  direkte fra `myAvatar`, ikke fra cachen), og serveravvisning ruller tilbake.
  `shareGroupCache` tømmes derimot FØRST når skrivingen har landet
  (`refreshAvatarViews`): en render før det ville startet en `get_members` som
  kappløper med skrivingen, og et svar med det GAMLE bildet ville blitt liggende
  i cachen til neste innlogging. En henting som allerede var i lufta fanges av
  `shareGroupEpoch` — den bumpes ved tømming, og et svar fra en eldre epoke
  forkastes i stedet for å fylle den nettopp tømte cachen. «Fjern bilde» er
  samme sti med `null`, bak en `askConfirm`.
- **Bilderedigereren** (`#avatar-modal`): scenen ER det kvadratiske utsnittet
  som lagres, og sirkelmasken over den viser hva appen faktisk tegner.
  Tilstanden er tre tall (`avEdit`): zoom (1 = bildets korteste side fyller
  utsnittet), rotasjon og forskyvning i andeler av utsnittets side. Samme
  `drawAvatar` tegner både forhåndsvisningen og det lagrede bildet — bare ulik
  oppløsning, så det man ser er det man får. To geometriske regler holder
  utsnittet helt dekket: minste zoom = `|cos θ| + |sin θ|` (en akse-justert
  firkant trenger så mye av et rotert bilde), og forskyvningen klemmes i
  BILDETS eget roterte koordinatsystem (`clampAvatarOffset`) — så det kan aldri
  bli tomme hjørner. Gester: dra = flytt, knip = zoom, hjul = zoom, pluss
  glidebrytere for zoom/rotasjon og en «roter 90°»-knapp (neste kvarte
  omdreining, retter samtidig opp en skjev vinkel). Filen dekodes med
  `createImageBitmap(..., { imageOrientation: 'from-image' })` så EXIF-rotasjon
  fra mobilkameraer følger med (`<img>` er reserven for eldre nettlesere).

## Navn, initialer og ansvarlig

- **Navn/initialer**: `display_name` = «Fornavn Etternavn». `initialsFromName`
  gir initialene (første bokstav i fornavn + etternavn), `personName` gir
  navnet (faller tilbake på e-post for uregistrerte/ventende invitasjoner).
  Del-modalen viser en avatar-sirkel + navn for hver person i medlemslisten
  (`avatarFor`, rollen `owner` grønn / `member` grå). Konto-modalens
  konto-avatar bruker samme navn/initialer (`my.user.display_name`). Har
  personen et profilbilde, viser sirkelen bildet i stedet for initialene (se
  over).
- **Ansvarlig** (`item.responsible` OG `card.responsible`): objekter i delt
  kontekst (liste under en delt mappe eller et delt område — delegruppen er
  alltid MAPPEN, `shareRootFor`) kan få en ansvarlig — både hvert listepunkt
  og hele listen.
  Settes fra objektmenyens «Ansvarlig»-skuff eller ansvarlig-chipen i
  meta-raden (`docs/scheduling.md`); begge åpner ansvarlig-velgeren
  (`openResponsible(target, …)`, target = `{ kind: 'card'|'item', obj, card }`)
  — popover (desktop) / modal (mobil) på `.switcher-*`-skallet. Radene viser
  hver i «delegruppen» (eier + medlemmer av nærmeste delte forelder, hentet med
  `get_members` og cachet i `shareGroupCache`) alfabetisk, som en farget
  initial-sirkel (`respAvatar`, palett via alfabetisk indeks — `colorForIndex`)
  + fullt navn, pluss «Ingen ansvarlig» når noen er valgt. `responsible` synkes
  som innhold, så alle med redigeringstilgang kan endre den. Delegruppen er
  nærmeste delte forelder (ett get_members-kall), ikke unionen av flere
  overlappende delinger — bevisst forenkling.
- **Umiddelbart og fritt bytte** (ingen venting): valget vises i samme øyeblikk
  (ansvarssirkelen males fra state) og kan byttes igjen med en gang — også mens
  forrige endring fortsatt er i lufta. Korrektheten ligger i synk-motoren, ikke
  i UI-låsing: `setResponsible` slår opp det *levende* item-objektet på id
  (`findAnyById`, så et foreldet objekt fanget av popoveren aldri muteres) og
  stempler innholds-registeret med et nytt `ts` per valg; den serielle
  `cloudCycle`-en + felt-LWW gjør at det siste valget alltid vinner, både
  lokalt og på serveren. (Den gamle `pendingResp`-spinneren/-låsen er fjernet.)
  Popoveren åpner også umiddelbart: cachet delegruppe males straks
  (stale-while-revalidate), en fersk `get_members` bygger radene om når den
  lander (ansvaret re-leses live på id, og panelet reposisjoneres aldri mot en
  anker-knapp en rebuild har revet ut av DOM-en).

## Søppel-semantikk for delinger

Søpla er **felles**: `trashed` er et vanlig innholdsfelt som gjelder for alle med
tilgang. Å **forlate** er noe helt annet — det rører aldri innholdet, bare egen
tilgang (`leave_share` via operasjonskøen med `suppressedRows`-undertrykking, se
`docs/trash.md`). Delete-/empty-stiene forgrener derfor på CAPABILITY, ikke på
eierskap: kan man ikke slette objektet for alle (`cap(obj, 'delete')`), forlater
man det i stedet. Serveren håndhever reglene uansett (RLS + `can_delete_object`
i `*_before_update`).

## Migreringsflyt

Ved første innlogging med tom konto men lokale data (legacy `mine-lister-v1`)
tilbys import (`import_doc(legacyFlatDoc())`); flagg `hk-migrated:<uid>` hindrer
gjentatt spørring.

## Testing: mock-backend

`mock-backend.js` (kun ved `?mock=1`) etterligner den delmengden av Supabase-
klienten appen bruker (auth, `from().insert/update/delete`, `rpc`, `channel`),
med en «database» delt mellom faner via `localStorage` og realtime simulert med
`storage`-hendelser. Sesjonen er per fane (`sessionStorage`) → to faner = to
brukere. Nok fidelitet til å kjøre hele delingsflyten, server-LWW, lås og
forlat/utkast, uten ekte backend eller e-postbekreftelse. Ikke en full RLS-
implementasjon; produksjon bruker ekte Supabase.

Fire skranker håndhever mocken bevisst, fordi en slapp mock ville sluppet
regresjonene gjennom: **id-er må være UUID-er** (`UUID_RE` i `applyInsert` —
testrader trenger derfor ekte UUID-er, ikke `'card-1'`), **`items.cat_id`/
`groups.cat_id` må peke på en kategori som finnes** (`catFkError`, avviser med
`23503` som ekte Postgres), **samme id kan ikke settes inn to ganger**
(primærnøkkel), og **gravsteiner blokkerer gjeninnsetting** (`tombstoneError`,
avviser med `PT409` som `guard_object_insert`). Kaskade-sletting skriver
gravstein for HVER slettet rad, ikke bare toppen — akkurat som `on delete
cascade` + AFTER DELETE-triggerne i Postgres.

`?mock=1&lag=800` legger en kunstig «server»-forsinkelse (ms) på alle RPC-/
tabell-kall (ikke auth) — brukes til å bevise at UI-et er umiddelbart og at
operasjonskøen serialiserer riktig når operasjonene er trege.

Verifisert med Playwright: registrering→«sjekk innboksen»→innlogging, CRUD +
buffer over reload, to-bruker-deling (inviter→godta uten plassering→kryss-
bruker-synk→lås/frys→forlat), rollemodellen og de tre seksjonene
(`tests/roles-and-sections.test.js`), del-modalen som følger serveren mens den
står åpen (`tests/share-modal-live.test.js`), mappeflytting med bekreftelse og
id-mapping (`tests/group-move.test.js`), migrering, og desktop+mobil.
Operasjonskøen er verifisert med `lag=800`: umiddelbar del-modal, køede
invitasjoner m/ tilbaketrekking, lås-spam→koalescert sluttilstand, umiddelbar
aksept, fritt ansvars-bytte med LWW-sluttilstand, gjenopprett/tøm under buffret
sletting, og forlat uten resurrect-blink.
