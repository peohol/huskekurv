# Arkitektur: brukere, eierskap og deling

Grunnmuren for brukerkontoer og deling i Huskis. Databasesiden er
implementert i [`supabase/users-and-sharing.sql`](../supabase/users-and-sharing.sql)
(idempotent, kjøres av Actionen «Supabase DB-oppsett»). Klientsiden er beskrevet
i [`accounts.md`](accounts.md).

## Oversikt

```
Supabase Auth (e-post + passord, bekreftelseslenke)
        │ 1:1 (trigger)
   profiles ──────────────┐
        │ owner_id = created_by (ren historikk, ingen rettigheter)
   universes ─ groups ─ cards («lister») ─ items      ← kanonisk innhold
        ▲          ▲
        └──────────┴── memberships (ROLLER: owner | member) ← all myndighet
                       share_invites (m/ rolle)             ← invitasjoner på e-post
                       tombstones                           ← mot gjenoppliving offline
```

Deling finnes på **områder og mapper** i listefanen, og på **alle tre nivåene**
i notatfanen (bokhylle, notatbok, notat). Lister, kategorier og listepunkter
arver tilgangen. Alle fem delbare typene bruker den SAMME `memberships`-tabellen
og de samme RPC-ene. `supabase/setup.sql` dropper den gamle éndoc-modellen
(`public.lists` + `get_list`/`save_list`).

Den autoritative rettighetsmodellen står i
[`rettigheter-og-deling.md`](rettigheter-og-deling.md); dette dokumentet
beskriver databasesiden.

## Identitet og registrering

- **Supabase Auth** med e-post + passord (`supabase.auth.signUp`). Med
  «Confirm email» PÅ (standard) sender Supabase bekreftelses-e-posten med
  lenke automatisk, og brukeren kan ikke logge inn før e-posten er bekreftet.
- `public.profiles` speiler `auth.users` via trigger (`handle_new_user`):
  opprettes ved registrering, e-post holdes synkron (lowercase). `display_name`
  = «Fornavn Etternavn» (fanges fra `raw_user_meta_data->>'display_name'`).
  Triggeren kobler også **ventende invitasjoner** sendt til e-posten før kontoen
  fantes. Klienten kan kun endre `display_name` (kolonne-grant), aldri e-posten.
- RLS: hver bruker ser kun sin egen profil. Medlemslister hentes via
  `get_members()` (som krever tilgang til objektet).

## Datamodell

Fire objekttabeller — `universes` > `groups` > `cards` (= «lister» i UI-et)
> `items` — med `on delete cascade` nedover. (`ideas` og de tre notattabellene
er innholdstabeller uten plass i dette treet; se «Flere tabeller hører til
BRUKEREN» under.) Hver rad har:

- `owner_id` — **oppretteren** (`created_by`). Uforanderlig (trigger-vakt), og
  gir **ingen** rettigheter. Kolonnenavnet er beholdt av migreringshensyn.
- `trashed` — søppelkasseflagget, **felles** for alle med tilgang.
- `locked`/`unlocked` (ikke på items) — lås/unntak, se «Låsing». Finnes også på
  de tre notattabellene.
- `invite_policy` — `inherit`/`allow`/`deny`. På universes/groups og på de tre
  notattabellene; ikke på cards/items.
- LWW-registre: `ts`/`org` (innhold), `pos_ts`/`pos_org` (posisjon +
  forelder-peker), `lab_ts`/`lab_org` (K/P på cards). **Håndheves på serveren**:
  BEFORE UPDATE-triggere lar en skriving med eldre register-stempel tape mot
  dataene som står. Klienten MÅ stemple registrene ved endring.
- Id-er er `uuid` og kan genereres på klienten (`crypto.randomUUID()`).
- `cards.responsible` / `items.responsible` (FK til `profiles`,
  `on delete set null`): ansvarlig bruker. Kandidatene er mappens **effektive**
  medlemsliste. Rir på innholds-registeret.

**Flere tabeller hører til BRUKEREN, ikke til treet.** De har ingen forelder å
arve tilgang fra — `user_id` ER autorisasjonen — og de deles aldri, heller ikke
for et objekt to brukere har sammen:

| Tabell | Hva den er | Klientvei |
|---|---|---|
| `ideas` | kontoens idéer og idékategorier ([`ideer.md`](ideer.md)) | RLS `owner_id = auth.uid()` |
| `object_links` | koblinger mellom notatsiden og listesiden ([`notater-plan.md`](notater-plan.md)) | RLS `owner_id = auth.uid()`; INSERT krever i tillegg at BEGGE sider er lesbare for meg |
| `notifications` | varselhistorikken | RLS `user_id = auth.uid()` |
| `notification_prefs` | de fire varselvalgene + generator-markøren | RLS `user_id = auth.uid()` |
| `push_subscriptions` | ett abonnement per nettleserkontekst, med gjenkjennelig metadata | RLS på egne rader; skrives kun av RPC-ene |
| `push_deliveries` | utboksen for web push | **låst** — ingen policy, ingen grant |
| `device_sessions` | gjenkjennelig metadata om `auth.sessions` | **låst** — ingen policy, ingen grant |

`ideas` skiller seg fra de andre her ved at den er INNHOLD: den er med i
synk-doc-et, den har de samme to LWW-registrene som objekttabellene, og den har
gravstein- og insert-vaktene deres. Det den ikke har, er et hierarki å arve
tilgang fra — derfor står den her og ikke over. Skrivevakten
(`ideas_before_update`) gjør bare det RLS ikke kan: holder registrene i orden
og hindrer at oppretteren endres. `cat_id` peker på tabellens egen id
(`on delete set null`, `deferrable initially deferred`).

**De tre notattabellene er DELBART INNHOLD**, ikke kontoens egne rader. De har
de samme to LWW-registrene, de samme gravstein- og insert-vaktene som
objekttabellene — og fra og med delingsrunden også `locked`/`unlocked`,
`invite_policy` og roller i `memberships`. Autorisasjonen er derfor RLS bygget
på de samme capability-funksjonene som listesiden bruker
([`rettigheter-og-deling.md`](rettigheter-og-deling.md) del 14). Formen er
notatenes eget tre:

| Tabell | Forelder | Merk |
|---|---|---|
| `note_projects` | ingen | notatenes øverste nivå, som et område |
| `note_folders` | `project_id` (`on delete cascade`) | mapper nøstes aldri i mapper |
| `notes` | `project_id` (cascade) + `folder_id` (`on delete set null`) | `folder_id = null` → et FRITT notat rett i prosjektet |

`archived` står ved siden av `trashed` på alle tre, og rir på det samme
INNHOLDS-registeret: arkivet er «lagt til side», søppelkassen er «slettet», og
de er uavhengige tilstander på samme rad. Skrivevaktene ruller begge tilbake
sammen når en skriving er eldre enn radens register.

Merk asymmetrien i kaskadene, og at den er tilsiktet: et notat UTEN bokhylle
finnes ikke (`project_id` er `not null`), så en slettet bokhylle tar notatene
med seg. En slettet NOTATBOK gjør det ikke — `folder_id` er `on delete set
null`, og notatene blir frie notater i bokhyllen sin. En notatbok er hylla
dokumentet sto i, ikke dokumentet.

Begge forelder-pekerne følger POSISJONSREGISTERET (som `card_id`/`cat_id` på et
listepunkt), og begge er `deferrable initially deferred` — doc-rekkefølgen er
vilkårlig. `notes.body` er editorens dokument som `jsonb`; databasen lagrer det
og tolker det ikke. Verdien rir på INNHOLDSREGISTERET som før, men rollen er
avgrenset: den er PROJEKSJONEN av dokumentet, ikke stedet konflikter avgjøres.
Det gjøres i `note_updates` (under).

### Samskrivingsloggen (`note_updates`)

Notatinnholdet har to lag. `notes.body` er projeksjonen — lesbar tekst til søk,
utdrag på kortet, utklippstavle og offline-kopi — og `note_updates` er
DOKUMENTET: én rad per Yjs-oppdatering, append-only, med `note_id` som
`on delete cascade`. To med skriverett kan derfor skrive i det samme notatet
samtidig uten at den enes tegn forsvinner; det er ikke mulig med ett felt på et
LWW-register, som velger én vinner per dokument.

| Kolonne | Betydning |
|---|---|
| `id` | klientgenerert `uuid`, slik at en push som ble sendt uten at svaret kom fram kan sendes på nytt (`on conflict do nothing`) |
| `note_id` | notatet raden hører til (`on delete cascade`) |
| `author_id` | hvem som skrev den (`on delete set null` — en slettet konto skal ikke ta tegnene ut av andres notat). ALDRI synlig for klienten |
| `payload` | selve oppdateringen, base64 |
| `xid` | `pg_current_xact_id()` — grunnlaget for hullfri inkrementell henting |
| `created_at` | sporbarhet |

**Loggen har ingen UPDATE og ingen DELETE for klienten**, og bare ÉN policy: en
lesepolicy på `can_read_note`. Den finnes fordi realtime leser tabellen direkte
på abonnentens vegne — uten den kunne hvem som helst abonnert på et notat de
ikke får lese. Grant-en er i tillegg KOLONNE-avgrenset til `id`, `note_id` og
`created_at`, så verken innholdet eller forfatteren kan leses ut av et rått
oppslag eller en realtime-hendelse.

Alt innhold går gjennom fire SECURITY DEFINER-RPC-er som sjekker myndigheten
selv (seksjon 9d i `users-and-sharing.sql`):

| RPC | Krever | Gjør |
|---|---|---|
| `note_crdt_load(note)` | `can_read_note` | hele loggen + et merke å hente videre fra |
| `note_crdt_since(note, mark)` | `can_read_note` | radene fra merket og framover |
| `note_crdt_push(note, updates)` | `can_edit_content('note', …)` | legger inn én eller flere rader i én transaksjon |
| `note_crdt_compact(note, id, snapshot, ids)` | `can_edit_content('note', …)` | legger den sammenslåtte tilstanden inn som ÉN ny rad og sletter nøyaktig de oppgitte radene, i samme transaksjon |

**Merket er `pg_snapshot_xmin(pg_current_snapshot())`**, lest i det samme
uttrykket som radene, ikke en sekvens. Sekvensverdier deles ut i
innsettingsrekkefølge, men blir synlige i COMMIT-rekkefølge, så «største jeg har
sett» kunne hoppet permanent over en rad som var underveis. Hver rad med lavere
`xid` enn merket tilhører en transaksjon som er ferdig; alt annet har
`xid >= merket` og kommer med neste henting. Å få den samme raden to ganger er
gratis — en Yjs-oppdatering er idempotent.

**Komprimeringen navngir radene den folder inn**, i stedet for å slette «alt
eldre enn». En rad som var underveis da øyeblikksbildet ble regnet ut, er ikke
med i det — og heller ikke i listen, så den overlever. To klienter som
komprimerer samtidig koster en rad for mye, ikke et tegn for lite.

`supabase/tests/test-note-collab.sql` dekker append-only-garantien,
kolonne-grantene, to samtidige skrivere, en ren leser, en utenforstående, det
hullfrie merket, komprimeringen, tilbakekalling, kontosletting og kaskaden.

### Notathistorikken (`note_versions`)

Komprimeringen over sletter radene den folder inn, og angringen er CRDT-ens egen
(den tar bare skriverens EGNE endringer). Ingen av dem er derfor et sted å hente
fra når en medforfatter fjerner et avsnitt. `note_versions` er det stedet: én rad
per ØYEBLIKKSBILDE av notatet, med `note_id` som `on delete cascade`.

| Kolonne | Betydning |
|---|---|
| `id` | klientgenerert `uuid` (`on conflict do nothing`, som loggen) |
| `note_id` | notatet bildet hører til (`on delete cascade`) |
| `author_id` | hvem som ba om bildet (`on delete set null`). ALDRI synlig for klienten |
| `title` | notatets tittel på det tidspunktet — tittelen er et navn, og ligger ikke i CRDT-en |
| `doc` | hele dokumentet som `jsonb`, i appens egen form (`{v, blocks}`) — ikke Yjs-binæret |
| `excerpt` | de første lesbare linjene, til raden i historikken |
| `chars` | antall tegn i dokumentet: raden som er MYE kortere enn den før den er den man leter etter |
| `fingerprint` | `md5(tittel ‖ dokument)` — gjør skrivingen idempotent mot det ferskeste bildet |
| `pinned` | brukerens «behold dette»: det ene feltet på raden som kan endres etterpå |
| `created_at` | tidspunktet raden viser |

**Bildet er dokumentmodellen, ikke CRDT-tilstanden.** To grunner: et bilde skal
kunne LESES uten å laste Yjs, og en gjenoppretting skal ikke være en
overskriving. Klienten skriver FORSKJELLEN mellom bildet og dokumentet inn i
CRDT-en, som en hvilken som helst annen redigering — så den fletter mot en som
skriver samtidig, den virker offline, og den kan angres.

**Klienten har INGEN grant på tabellen.** Her finnes ikke engang `note_updates`'
lille kolonne-unntak, for det er ingen realtime på historikken. RLS-policyen
(`note_versions_select` på `can_read_note`) er det innerste laget, og alt går
gjennom fire SECURITY DEFINER-RPC-er (seksjon 9e):

| RPC | Krever | Gjør |
|---|---|---|
| `note_versions_list(note)` | `can_read_note` | radene uten dokumentene — 60 bilder av et langt notat er megabyte |
| `note_version_get(note, id)` | `can_read_note` | ett bilde, med dokumentet |
| `note_version_save(note, id, tittel, doc, utdrag, tegn, merk)` | `can_edit_content('note', …)` | legger inn et bilde, og tynner |
| `note_version_pin(note, id, merk)` | `can_edit_content('note', …)` | setter eller fjerner merket |

En REN LESER kommer altså gjennom de to første — historikken er notatets eget
innhold — og får `insufficient_privilege` på de to siste. Ingen av de fire
returnerer `author_id`: historikken sier HVA notatet inneholdt, aldri hvem som
skrev det. Samme grense som loggen.

**Uttynningen (`note_versions_prune`) er serverens, ikke klientens**, og går i
fire lag: alt fra den siste timen står, det siste døgnet tynnes til ett bilde
per time, eldre til ett per døgn, og til slutt gjelder et hardt tak på antall
rader (`note_versions_keep()`). MERKEDE bilder står utenfor alle fire — det er
hele meningen med å merke ett. Taket på antall merker
(`note_versions_pin_max()`) håndheves i stedet ved MERKINGEN, der brukeren er
til stede og kan velge hvilket som skal vike.

**Skrivingen er serialisert per notat.** Fingeravtrykket sammenlignes mot det
FERSKESTE bildet, og «det ferskeste» er ikke en fast størrelse under
samtidighet: to enheter som ber om et bilde i det samme øyeblikket ser den
samme forrige raden og legger inn hver sin — med hver sin klientgenererte id,
så `on conflict (id)` fanger dem ikke. `note_version_save` tar derfor en
RÅDGIVENDE lås på notatet (`pg_advisory_xact_lock`, som `push_lock`) før den
leser «det ferskeste», og den varer transaksjonen ut. Den er rådgivende og
ikke en radlås på `notes`, slik at den ikke kommer i veien for
innholdsskrivingene.

`supabase/tests/test-note-versions.sql` dekker grantene og policyen,
fingeravtrykket, en ren leser, en utenforstående, merking og taket, alle fire
lagene i uttynningen, tilbakekalling, kaskaden og kontosletting;
`supabase/tests/test-note-version-race.sh` kjører kappløpet med to ekte
tilkoblinger, i begge rekkefølger.

At man har lov til å legge noe i bokhyllen/notatboken er en egen betingelse i
`note_folders_insert`/`notes_insert` (`can_create_child` / `can_create_note`),
ikke bare i eierskapet på raden selv: uten den kunne en bruker hekte sin egen rad
inn i en bokhylle hen ikke får skrive i — og et medlem av en LÅST bokhylle kunne
lagt inn rader ingen etterpå kunne redigere. `supabase/tests/test-notes.sql` og
`test-note-sharing.sql` prøver nettopp det, i begge retninger.

**De to forelder-pekerne på et notat kan heller ikke motsi hverandre.** RLS sier
at jeg har tilgang til både bokhyllen og notatboken, men ikke at de hører
sammen — og siden
`notes.project_id` er `on delete cascade`, ville et notat som pekte på bokhylle
A og en notatbok i bokhylle B blitt SLETTET når A forsvant, mens UI-et viste det
under notatboken i B. To triggere håndhever invarianten:

| Trigger | Gjør |
|---|---|
| `notes_parent_guard` / `notes_guard` (`notes_fix_parent`, og det samme leddet sist i `notes_before_update`) | ligger notatet i en notatbok, UTLEDES `project_id` av notatboken — ved både innsetting og oppdatering |
| `note_folders_cascade` (`note_folders_after_update`) | flyttes en notatbok til en annen bokhylle, følger notatene med |

**Koblingene** (`object_links`) er den ene tabellen som er innhold uten å ha et
register å flette: den har ingen mutable felter. Hver side er sin EGEN
fremmednøkkel — `note_project_id`/`note_folder_id`/`note_id` mot
`universe_id`/`group_id`/`card_id` — med nøyaktig én satt per side (to
check-constrainter) og `on delete cascade` på alle seks. Det er dét som gjør en
hengende kobling umulig: forsvinner målet, forsvinner koblingen, og AFTER
DELETE-triggeren (`write_link_tombstone`) skriver en gravstein av typen
`object_link` slik at en offline klient ikke kan sette den inn igjen. Tabellen
har ingen UPDATE-policy og ingen UPDATE-grant. Det finnes heller INGEN unik
indeks på paret, med vilje: to enheter som lager den samme koblingen offline
ville ellers fått den ene skrivingen permanent avvist (23505) og prøvd igjen i
det uendelige — klienten viser og fjerner koblinger PER PAR, så en dublett er
usynlig og forsvinner ved første fjerning. `supabase/tests/test-note-links.sql`
dekker begge sider, RLS mellom to brukere, kaskadene og gravsteinene.

`(pos_ts, pos_org)` er ETT UDELELIG REGISTER — `reg_newer` sammenligner
tidsstempelet først og lar `org` bryte uavgjort — så kaskaden velger HELE PARET
atomisk: er notatbokens register nyere, kopieres begge feltene; ellers beholdes
begge. Å ta tidsstempelet fra det ene og `org` fra det andre ville laget et
register som aldri har eksistert, og ved likt tidsstempel kunne det snudd hvem
som vinner en senere skriving. `project_id` følger notatbokens bokhylle uansett:
det er invarianten, ikke et register.

Utledning, ikke avvisning: klienten skriver rad for rad gjennom PostgREST, hver
skriving i sin egen transaksjon, så en avvisning ville gjort rekkefølgen mellom
to uavhengige HTTP-kall til en del av kontrakten. Utledningen gir det samme
svaret uansett rekkefølge, og er nøyaktig den samme regelen klienten leser med
(`pruneNoteParents`).

De to låste tabellene har ingen klientvei i det hele tatt: `push_deliveries`
røres kun av senderens funksjoner (`service_role`), og `device_sessions` kun av
`session_touch()`/`list_my_devices()`/`revoke_my_session()`, som alle setter
`user_id` fra `auth.uid()` selv. En direkte vei til den siste ville latt en
klient navngi en økt hen ikke eier.

Se [`varsler.md`](varsler.md) og [`accounts.md`](accounts.md).

**`auth.sessions` er Supabases, ikke vår.** Huskis bygger ingen egen
auth-modell ved siden av: øktene lever der, `session_id`-claimet i access-tokenet
peker på dem, og fjern-utlogging sletter raden der (`revoke_my_session()`,
SECURITY DEFINER). `device_sessions` er bare et sidebord med det som gjør en økt
gjenkjennelig for eieren — nettleser, plattform, vert, enhets-id. Hverken IP
eller hele user-agenten forlater databasen.

### Roller (`memberships`)

Én rad = én brukers ROLLE på ETT delbart objekt (område **eller** mappe):

| Kolonne | Betydning |
|---|---|
| `user_id` | brukeren |
| `universe_id` / `group_id` | nøyaktig én er satt (CHECK) |
| `role` | `'owner'` \| `'member'` |
| `pos` | brukerens **personlige** rekkefølge (toppnivå-områder, frie mapper) |

* Eiere **har** en rad — det er nettopp den som gjør eierskapet mutabelt.
* `card_id` er pensjonert: kolonnen står igjen for migreringens skyld, men en
  CHECK holder den `null`. Det samme gjelder `share_invites.card_id`.
* Mount-kolonnene (`parent_universe_id`, `parent_group_id`, `trashed`) er
  **droppet** — mottakeren velger ikke lenger sin egen forelder.
* `INSERT` er ikke gitt til `authenticated`: roller opprettes kun av
  SECURITY DEFINER-veiene (`accept_share_invite` og opprettelses-triggerne
  `universes_after_insert` / `groups_after_insert`).

**Siste-eier-invarianten** håndheves av `memberships_before_update` og
`memberships_before_delete` (feilkode `PT422`), altså også mot rå SQL. Kaskader
(området eller brukeren slettes) hoppes over.

## Tilgangsmodell

* `can_read_universe` = brukeren har en områderolle. Et område leses **aldri**
  av en direkte mappemottaker — navn og medlemsliste lekkes ikke.
* `can_read_group` = **effektivt** mappemedlemskap: direkte mapperolle ELLER
  en hvilken som helst områderolle på mappens kanoniske område.
* `can_read_card` / listepunkter følger mappen.

Alt håndheves med RLS-policyer bygget på SECURITY DEFINER-funksjoner (ingen
policy-rekursjon). `anon` har null tilgang.

Capabilities beregnes av `universe_caps()` / `group_caps()` og returneres til
klienten i `get_my_doc()` og `get_members().viewer.caps`.

### Tabellrettigheter (minsteprivilegium)

RLS er det innerste laget. Det ytterste er GRANT-en, og den er billigst: en
skriving klienten ikke har rettighet til avvises før noen policy trenger å
kjøre. Rettighetene følger klientauditen — hva `app.js` faktisk gjør mot
PostgREST — og ikke hva som «kunne vært nyttig»:

| Tabell | `authenticated` | Hvem skriver ellers |
|---|---|---|
| `universes`, `groups`, `cards`, `items`, `ideas`, `note_projects`, `note_folders`, `notes` | SELECT, INSERT, UPDATE, DELETE | rad-CRUD i synk-motoren |
| `profiles` | SELECT, UPDATE(`display_name`, `avatar`) | e-posten speiles fra `auth.users` av triggerne |
| `memberships` | SELECT, UPDATE | roller lages/slettes av RPC-ene og opprettelses-triggerne; UPDATE er kun den personlige `pos` |
| `share_invites` | SELECT | alt går via `create`/`accept`/`decline`/`revoke_share_invite` |
| `tombstones` | SELECT | skrives kun av `write_tombstone()`-triggerne |
| `notifications` | SELECT, UPDATE(`read_at`), DELETE | rader lages kun av `notify_record()`; DELETE er «Tøm varsler» |
| `notification_prefs` | SELECT | skrives kun av `notify_set_prefs()` og `notify_record()` (markøren) |
| `push_subscriptions` | SELECT, DELETE | rader lages/fornyes av `push_subscribe()`; DELETE er «slå av i denne nettleseren» |
| `push_deliveries` | – | låst tabell: kun `push_claim()`/`push_report()` (`service_role`) |
| `device_sessions` | – | låst tabell: kun `session_touch()`/`list_my_devices()`/`revoke_my_session()` |

SELECT på `memberships` og `share_invites` trengs også av
realtime-abonnementet, som lytter på `postgres_changes` for begge.

**Å utelate en GRANT er ikke nok.** Prosjektet har `alter default privileges in
schema public grant all on tables to anon, authenticated`, så en ny tabell får
ALL i det den opprettes. Hver rettighet klienten ikke skal ha må trekkes
tilbake med en eksplisitt `revoke` i `users-and-sharing.sql`. Matrisen står som
kommentar rett over de setningene, og både smoke-testen og SQL-suiten har
negative sjekker som slår ut hvis en `revoke` forsvinner.

**RLS-uttrykk kaller `(select auth.uid())`, ikke `auth.uid()`.** Bar
`auth.uid()` er volatil i et policy-uttrykk, og planleggeren kan kalle den PER
RAD; pakket i et skalar-subselect blir den en InitPlan som kjøres én gang per
statement. Svaret er det samme — økten er den samme gjennom hele statementet —
men kostnaden vokser med tabellen, og Supabases `auth_rls_initplan` peker på
nettopp det. Det gjelder også inne i `exists`-sjekkene for foreldre.
Notattabellenes policyer voktes av smoke-testen, som teller at hver forekomst av
`auth.uid()` i uttrykket står i et subselect.

**Det samme gjelder FUNKSJONER, og der er standarden verre**: PostgreSQL gir
hver ny funksjon EXECUTE til `public`. Triggerfunksjonene er `security definer`
og gjør privilegerte ting (vakter, gravsteiner, kaskader) uten en egen
autorisasjonssjekk — myndigheten ligger i skrivingen som utløste dem — så de
skal ALDRI kunne kalles som RPC. Låsen er derfor GENERISK og ikke en liste:
alt i `public` som returnerer `trigger` mister EXECUTE. En liste ville råtnet
neste gang noen legger til en trigger. Smoke-testen sjekker det samme settet
generisk, så en ny triggerfunksjon ikke kan komme inn ulåst. Triggerkjøringen
er upåvirket — den hviler på TRIGGER-rettigheten på TABELLEN, ikke på EXECUTE.

## Deling (invitasjon → aksept → rolle)

1. `create_share_invite(type, id, email, role)` — `type` er én av de fem i
   `shareable_types()` (`universe`, `group`, `note_project`, `note_folder`,
   `note`); `role` er `'member'` eller `'owner'`. Medlemsinvitasjoner krever
   `can_invite_to` (eier på nivået, eller et medlem når policyen tillater det);
   **eierskaps**-invitasjoner krever `can_invite_owner` (kun eiere). Mottakeren
   trenger ikke ha konto — invitasjonen kobles ved registrering. Redundante
   medlemsinvitasjoner avvises; en eierskaps-invitasjon til en som allerede har
   tilgang er gyldig (det er rolleløftet).
2. Mottakeren ser invitasjonen i `get_my_doc().invites_in` og aksepterer med
   `accept_share_invite(invite)`. **Ingen plassering velges.** Området havner
   i «Mine områder» / «Områder delt med meg» etter rolle; en mappe vises
   inne i området hvis mottakeren er områdemedlem, ellers i «Mapper delt med
   meg».
3. Aksepten oppretter (eller løfter) medlemskapsraden og legger objektet bakerst
   i mottakerens personlige rekkefølge. For en områdeinvitasjon ryddes samtidig
   redundante ordinære direkte mappemedlemskap i området.

Viktige egenskaper:

- **`set_member_role`** degraderer (eier → medlem). Rolleløft går alltid gjennom
  en invitasjon mottakeren må godta.
- **`revoke_share(type, id, user)`** krever `can_manage_members`. For et område
  fjerner den ALL underliggende direkte tilgang (`purge_universe_access`); for en
  mappe kun den direkte mapperollen. En områdearvet bruker kan ikke fjernes
  fra én enkelt mappe — RPC-en avviser med `PT409` og en forklaring.
- **`leave_share(type, id)`** er brukerens egen utgang, med samme opprydding.
  Siste områdeeier blokkeres (`PT422`). For en mappe kreves at den direkte
  mapperollen er ENESTE vei inn: har man også en rolle i mappens område,
  avvises kallet med `PT409` og en peker til området (`can_leave`) — å slette
  den overflødige raden ville sett ut som en forlatelse uten å fjerne tilgang.
- Begge nullstiller `responsible`-referanser som mister effektiv tilgang, med et
  ferskt innholds-register (`org = 'server'`) så LWW slipper endringen gjennom.
- **`move_group(group, universe, cat, pos)`** er den ENESTE veien en mappe
  bytter område. Se `rettigheter-og-deling.md` del 11 for semantikken
  (reorder / reparent / copy) — og merk at `groups_before_update` avviser en
  direkte skriving av `universe_id`.

## Låsing (med unntak for arvet lås)

> Full modell + autorisasjon: [`rettigheter-og-deling.md`](rettigheter-og-deling.md).

`locked`/`unlocked` på universes/groups/cards er **gjensidig utelukkende** per rad,
så hver node har én av tre tilstander: *låst*, *unntak (åpnet)*, eller *arv*.
`set_locked` styres av `can_manage_lock` (= `is_privileged`: områdeeier for et
område, mappeeier for mappe/liste). `set_unlocked` (unntak fra en ARVET lås)
styres av `can_manage_lock_exception`: områdeeiere alltid, og — når den arvede
låsen er satt på en MAPPE — også en eksplisitt mappeeier der. En mappeeier kan
altså ikke åpne en gren i strid med en områdelås.

Effektiv redigeringsstatus for et **vanlig medlem** = den nærmeste eksplisitte
tilstanden fra objektet og oppover (`effective_lock_source`). Eiere på nivået kan
**alltid** redigere (`can_edit_content = is_privileged OR NOT
is_effectively_locked`). Lesing påvirkes aldri av lås.

**Posisjon er skilt fra innholdslås**: retten til å endre et objekts rekkefølge i
superobjektet styres av `can_reorder_in_parent` (= innholdsredigering på
superobjektet), ikke av objektets egen lås. En låst liste kan dermed flyttes blant
søsken når mappen er åpen. Vaktene (`*_before_update`) håndhever dette
feltspesifikt.

Følger: lås på et område fryser alt under for vanlige medlemmer, MEN en autorisert
bruker kan gjøre et **unntak** for en konkret mappe/liste under (`unlocked =
true`), og et enda lavere nivå kan låses på nytt inni et unntak.
Nærmeste-eksplisitt-regelen håndterer vilkårlig nøsting. Finnes det ingen arvet
lås, er «unntak» en overflødig flaggverdi — da kan den som ellers styrer objektets
lås rydde den bort.

## Invitasjonspolicy (tretilstands dynamisk arv)

`invite_policy` (`inherit`/`allow`/`deny`) på **universes og groups** styrer om
vanlige medlemmer kan invitere flere. Effektiv verdi = nærmeste eksplisitte fra
objektet og oppover; ingen eksplisitt noe sted → tillat. Nye rader er `inherit`
(dynamisk arv). `set_invite_policy` styres av `can_manage_invite_policy`: eiere på
nivået, men under en arvet `deny` fra området kun områdeeiere. Listespesifikk
policy er fjernet — `cards.invite_policy` er pensjonert og leses aldri.
Policyen gir **aldri** rett til å invitere eiere.
Full modell: [`rettigheter-og-deling.md`](rettigheter-og-deling.md).

## Sletting, søppel og gravsteiner

- `trashed`-flagg = søppelkasse (reversibel). Den er **felles** for alle med
  tilgang — det finnes ingen egen mottaker-søppelkasse lenger. Hvem som kan sette
  den styres av `can_delete_object` (håndhevet i `*_before_update`): for et
  område kun eiere, for en mappe eiere eller et områdemedlem når mappen er
  effektivt åpen. Å **forlate** en deling er noe annet — det rører aldri
  innholdet, bare egen tilgang.
- Tømming = hard `DELETE`. AFTER DELETE-triggere skriver **gravsteiner**
  (`tombstones(resource_type, resource_id, ts)`) — én rad per slettet objekt,
  også for barna, siden `on delete cascade` sletter dem rad for rad og deres
  egne triggere fyrer.
- **Gravsteinene håndheves av databasen** (`guard_object_insert`, BEFORE INSERT
  på alle fire objekttabellene): en id med gravstein kan ikke settes inn igjen.
  Avvisningen har en distinkt SQLSTATE, `PT409`, med meldingen «gravlagt: …»,
  så klienten kan skille den fra andre feil og gravlegge raden lokalt i stedet
  for å prøve igjen. Dette er hele poenget med at regelen ligger i databasen:
  den gjelder også for en gammel klientversjon, en modifisert klient og en rå
  `INSERT`/`UPSERT` mot PostgREST. (Fram til denne runden ble tabellen skrevet,
  men aldri konsultert — en klient med utdatert lokal cache kunne sende en helt
  ordinær insert og få det slettede objektet tilbake.)
- Samme vakt validerer at **`owner_id` er den innloggede brukeren**. RLS krever
  det samme ved insert, men her ligger regelen i selve skrive-veien, uavhengig
  av policy-oppsettet: en gammel kopi av andres delte objekt kan verken
  gjenopplives eller settes inn med avsenderen som ny oppretter.
- **Gravsteinene utløper aldri.** En klient som har ligget ubrukt i et år (en
  gammel telefon, en annen nettleser, det andre domenet) har fortsatt sin gamle
  lokale kopi og skal møte gravsteinen når den endelig synker igjen. Rydding må
  ikke innføres uten en dokumentert, sikker mekanisme.
- **Eneste automatiske opprydding**: `import_doc` fjerner gravsteinene for
  nøyaktig de id-ene importen skriver (utledet av brukerens egen uid via
  `legacy_uuid`). Uten det ville insert-vakten blokkert en re-import for en
  bruker som tidligere har slettet noe permanent. En administrator som bevisst
  vil gjenopprette noe (f.eks. fra sikkerhetskopi) må slette gravsteinen manuelt
  først: `delete from public.tombstones where resource_id = '<id>';`
- Klienten leser tabellen direkte (`select resource_type, resource_id where
  resource_id in (…)`, RLS: lesbar for innloggede) når den mangler synk-base og
  må avgjøre om en lokal rad er ny eller slettet — se `docs/accounts.md`.

## Klient-API (fase 2 bygger på dette)

| Kall | Rolle |
|---|---|
| `supabase.auth.signUp/signInWithPassword/…` | registrering/innlogging (bekreftelses-e-post håndteres av Supabase) |
| `get_my_doc()` | hele brukerens datasett som ETT flatt jsonb-doc: universes/groups/cards/items + noteProjects/noteFolders/notes — begge med `role`, `free`, `personalPos`, `shared` og `caps` (`ownerKey` kun på områder) — + idéer + koblinger + invitasjoner + varsler/varselvalg |
| vanlige `insert/update/delete` på tabellene | CRUD med RLS + server-side LWW; klienten stempler `ts/org`-registrene som i dag |
| `import_doc(doc)` | engangs-migrering av lokalt/legacy doc til egne data (deterministiske id-er per bruker, idempotent) |
| `create_share_invite(type, id, email, role)` / `accept_share_invite(invite)` / `decline_share_invite` / `revoke_share_invite` | delingsflyt, medlem eller eierskap; aksept krever ingen plassering |
| `revoke_share` / `set_member_role` / `leave_share` / `set_locked` / `set_unlocked` / `set_invite_policy` / `get_members` | administrasjon (roller, låsing + unntak, invitasjonspolicy; `get_members` gir `viewer.caps`) |
| `move_group(group, universe, cat, pos)` | ATOMISK mappeflytting: reorder / reparent / kopier-og-slett med id-mapping |
| `notify_record(rows, cursor)` / `notify_set_prefs(prefs)` | varselhistorikken: logg passerte terskler idempotent (unik `(user_id, key)`) og flytt generator-markøren; de fire av/på-valgene (`varsler.md`) |
| `update memberships set pos` (egen rad) | personlig rekkefølge (toppnivå-områder + frie mapper) |
| Realtime `postgres_changes` på tabellene | live-oppdatering (tabellene ligger i `supabase_realtime`-publikasjonen) |

## Migrering fra dagens modell

1. Bruker registrerer seg / logger inn (fase 2-UI).
2. Klienten normaliserer sitt lokale doc med dagens migreringssteg
   (`migrateTabsToGroups` → `migrateGroupsToUniverses` → flatt doc) og
   kaller `import_doc(doc)`.
3. Id-mapping er `md5(uid || ':' || gammel_id) → uuid`: deterministisk per
   bruker (re-kjøring er idempotent) og to brukere som importerer samme
   gamle delte doc får hver sin uavhengige kopi (deling gjenopprettes
   eksplisitt med den nye delingsmodellen).
4. Den gamle `lists`-tabellen + mønster-låsen er pensjonert (`setup.sql`
   dropper dem); migrering av lokale data skjer ved første innlogging.
5. **Rolle-backfill + migrering av gamle listedelinger** kjøres én gang av
   `users-and-sharing.sql` (markert i `public.migration_log`). Se
   `rettigheter-og-deling.md` del 13.

## Testing

`supabase/tests/` inneholder en hermetisk testsuite (ren PostgreSQL 16,
Supabase-miljøet stubbes med `local-stub.sql` — samme
`request.jwt.claim.sub`-mekanikk som PostgREST):

```bash
# med en lokal postgres på 5433 og tom database hk_test:
PGHOST=... PGPORT=5433 PGUSER=postgres PGDATABASE=hk_test supabase/tests/run-tests.sh
```

Suiten har **to løp**: ett vanlig (nytt skjema, migreringen kjørt to ganger for
idempotens) og ett **oppgraderingsløp** der `tests/legacy-share-fixture.sql`
legger inn den GAMLE databasefasongen med data før migreringen kjøres.

Dekning: profil-trigger, RLS-isolasjon, rollemodellen (eiere/medeiere,
siste-eier-invarianten, degradering, capabilities), effektivt mappemedlemskap og
medlemslistens kategorier, invitasjoner (medlem + eierskap + avviste liste-
invitasjoner), låser og unntak, sletting/forlatelse med opprydding av ansvar,
personlig rekkefølge, mappeflytting (reorder/reparent/kopier-og-slett med
gravsteiner), server-side LWW, import (determinisme + idempotens + foreldreløse),
gravsteiner, anon-avvisning, hele migreringen av gamle listedelinger og
NOTATDELINGEN (roller og arv på tre nivåer, ren leser via lås, flytting mellom
foreldre med ulike delingsforhold, tilbakekalling, koblinger på tvers av delt og
privat, kontosletting) og SAMSKRIVINGSLOGGEN (append-only, kolonne-grantene,
to samtidige skrivere, ren leser, hullfritt merke, komprimering).

## Manuelle steg (utenfor SQL — én gang, i Supabase-dashboardet)

1. **Authentication → Sign In / Up**: «Confirm email» skal stå PÅ (standard).
2. **Authentication → URL Configuration**: *Site URL* og *Redirect URLs* skal
   kun inneholde det kanoniske originet `https://huskis.no` — de alternative
   domenene 308-redirecter dit og kjører aldri en klient. Klienten sender
   uansett alltid en eksplisitt, betrodd `redirectTo`/`emailRedirectTo`
   (`authRedirectUrl()`, se `docs/domains-and-urls.md` — autoritativ for
   domener/URL-generering).
3. (Anbefalt før mange brukere) **Authentication → Emails/SMTP**: egen
   SMTP-avsender; Supabase sin innebygde e-postutsending er strengt
   ratebegrenset (~2–4 e-poster/time) og kun ment for utvikling.
4. **E-postvarsel ved deling** (valgfritt): aktiver `pg_net` (Database →
   Extensions), legg Resend-nøkkelen i **Supabase Vault** (`vault.create_secret`)
   og avsender/app-URL i `public.app_config`. Da e-poster
   `send_invite_email`-triggeren mottakeren ved hver ny invitasjon — se
   `docs/accounts.md` og `TODO.md`.

## E-postvarsel ved deling (`send_invite_email`)

En AFTER INSERT-trigger på `share_invites` (`send_invite_email`, SECURITY
DEFINER, `search_path = public, extensions, net`) sender en profilert Huskis-
e-post via `net.http_post` (pg_net) til Resend (`api.resend.com/emails`). Kroppen
er tabellbasert HTML med inline CSS (trygg fontstakk `Arial, Helvetica, sans-
serif` — ingen webfont), PNG-logo fra `https://huskis.no/assets/email/
huskis-logo-v1.png` (kanonisk domene, uten `www` — se `docs/domains-and-urls.md`),
skifer/grønn-palett fra designsystemet, preheader-tekst,
stylet `<a>`-knapp og en `text/plain`-variant. To varianter:

- **Uregistrert mottaker** (`invitee_id is null`): «Du er invitert til Huskis» +
  lenke `<app_url>?signup=<e-post>` → registreringssiden med e-posten utfylt.
  `handle_new_user` kobler den ventende invitasjonen ved registrering.
- **Registrert mottaker**: «‹objekt› er delt med deg» + åpne-appen-lenke, MEN
  kun hvis `auth.users.raw_user_meta_data->>'email_notifications'` ikke er
  `'false'` (standard på; klienten setter flagget via `auth.updateUser`).

**Hemmelighet:** selve Resend-nøkkelen bor i **Supabase Vault** (kryptert i ro;
`vault.decrypted_secrets` er kun lesbar for eier-rollen), lagt inn via dashboard
eller Supabase-integrasjonen under secret-navnet `resend_api_key` — aldri i Git/
PR/logg/chat. Triggeren leser Vault først og faller tilbake til
`public.app_config` KUN så det hermetiske test-miljøet (uten Vault) kan kjøre; i
produksjon skal nøkkelen ikke ligge i app_config. Ikke-hemmelig konfig
(`email_from`, `app_url`) ligger i `public.app_config` (RLS på, ingen policyer/
grants, EXECUTE/SELECT revoked fra public/anon/authenticated → kun SECURITY
DEFINER-funksjoner leser den; ingen `cfg()`-RPC som kunne lekket verdien).

**Sikkerhet i kroppen:** brukerstyrt tekst (inviter-navn, objektnavn, over-
skrifter, synlig lenketekst) HTML-escapes med `html_escape`; URL-parametre
prosent-kodes med `url_encode` (byte-sikker RFC 3986, erstatter de gamle
manuelle `replace`-kjedene); JSON bygges med `jsonb_build_object`.

**Observabilitet — merk pg_net er asynkron:** `net.http_post` KØLEGGER
forespørselen og returnerer en request-id; selve HTTP-kallet til Resend skjer
først etter commit, og svaret (HTTP 2xx/4xx/5xx) lander senere i
`net._http_response`. Triggeren kan derfor bare vite om forespørselen ble kølagt,
ikke om Resend aksepterte/leverte. Kølegging logges i den låste tabellen
`public.email_send_log` (invitasjons-id, variant, `net_request_id`,
`enqueue_status` = `enqueued`/`enqueue_error`, ev. `SQLERRM` — aldri nøkkel,
Authorization-header, kropp eller mottakeradresse). `enqueued` betyr **ikke**
accepted/delivered/successful — det FAKTISKE HTTP-resultatet korreleres via
`net_request_id` mot `net._http_response` (kortvarig diagnostikk; pg_net rydder
tabellen). Uten en Resend-nøkkel returnerer triggeren umiddelbart (`return new`).
En **synkron** feil (f.eks. selve køleggingen feiler) fanges (`exception when
others`), logges som `enqueue_error` og blokkerer aldri selve invitasjonen; en
senere **asynkron** Resend-feil er ikke en trigger-exception og finnes kun i
`net._http_response`. Resend-webhooks for varig leveringsstatus er en mulig
senere forbedring, ikke implementert nå.
