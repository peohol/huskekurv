# Rettigheter og deling — den autoritative modellen

Denne fila er **fasiten** for hvem som får gjøre hva i Huskis. Ved motstrid
mellom dette og andre dokumenter gjelder dette.

Databasesiden ligger i
[`supabase/users-and-sharing.sql`](../supabase/users-and-sharing.sql)
(idempotent), mock-backenden speiler den (`mock-backend.js`, `?mock=1`), og
klientsiden i `app.js`. All autorisasjon håndheves **serverside** (RLS +
`BEFORE UPDATE`-vakter + SECURITY DEFINER-RPC-er); klienten viser/skjuler
kontroller for en bedre UX og kan aldri omgå reglene.

Se også [`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md)
(tabeller, søppel, LWW) og [`accounts.md`](accounts.md) (klient-UI, synk,
opQueue).

---

## 1. Hva kan deles

Huskis har to hoveddeler, og de deler modell — ikke kode ved siden av
hverandre:

| Hoveddel | Delbare nivåer | Arver tilgangen |
|---|---|---|
| **Lister** | område, mappe | liste, listepunkt, kategori |
| **Notater** | bokhylle, notatbok, **notat** | – |

På listesiden kan bare **områder** og **mapper** deles.

* En **liste** kan aldri deles direkte. Den arver tilgangen fra mappen sin.
* **Listepunkter og kategorier** arver fra listen og dermed fra mappen.

På notatsiden kan **alle tre nivåene** deles. Det er den ene bevisste
forskjellen, og grunnen er at objektene ikke er de samme: en liste er en del av
mappens struktur, mens et NOTAT er selve dokumentet — den enheten folk faktisk
vil dele. Alt annet er likt: samme rolletabell, samme invitasjonsflyt, samme
capability-funksjoner, samme delemodal.

Hierarkiene:

```
Område   > Mappe    > Liste > Listepunkt/kategori
Bokhylle > Notatbok > Notat
```

Detaljene for notatsiden står i **del 14**.

Hver mappe har **alltid ett kanonisk område**. «Mapper delt med meg» er bare
en alternativ *visning* av direkte delte mapper — ikke en reell forelder, og
aldri et gyldig flyttemål.

Serveren avviser ethvert forsøk på å dele en liste — også fra en gammel klient,
en modifisert klient eller et rått PostgREST-kall (`create_share_invite` godtar
kun de fem typene i `shareable_types()`, og `memberships`/`share_invites` har en
CHECK som holder `card_id` tom og krever nøyaktig én av de fem id-kolonnene).

---

## 2. Oppretter vs. eier

| Begrep | Hvor | Betydning |
|---|---|---|
| **Oppretter** (`created_by`) | `owner_id` på objektraden | REN HISTORIKK. Uforanderlig. Gir **ingen** rettigheter. |
| **Eier / medeier** | `memberships.role = 'owner'` | Mutabel rolle. All myndighet kommer herfra. |
| **Medlem** | `memberships.role = 'member'` | Vanlig tilgang. |

Kolonnenavnet `owner_id` er beholdt av migreringshensyn, men skal leses som
`created_by`. Fjernes rollen din, mister du myndigheten — selv om du står som
oppretter.

Det finnes **ingen egen administratorrolle**. Full administrativ myndighet gis
gjennom eierskap eller medeierskap.

### Roller på områdenivå

* `owner` — områdeeier. Alle områdeeiere er **helt likestilte**.
* `member` — vanlig områdemedlem.

Visningsnavnet følger antallet: nøyaktig én `owner` → «Eier»; minst to →
«Medeiere». Backendrollen er den samme.

Den som oppretter et område får `owner`. Aksepterer noen en eierskaps-
invitasjon, er de likestilt med de andre — den opprinnelige oppretteren har
ingen særskilt eller uoppsigelig myndighet.

**Siste-eier-invarianten:** et område har alltid minst én eier.

* siste eier kan ikke forlate
* siste eier kan ikke degraderes
* siste eier kan ikke kastes ut
* siste eier **kan** slette området for alle

Invarianten håndheves i databasen (`memberships_last_owner_guard` på både
UPDATE og DELETE), ikke bare i RPC-ene — også en rå `DELETE` blokkeres.

### Roller på mappenivå

* `owner` — **eksplisitt** mappeeier/medeier.
* `member` — direkte mappemedlem uten medlemskap i området.

Den som oppretter en mappe blir eksplisitt mappeeier — **med mindre**
vedkommende allerede er områdeeier (rollen er da arvet, og en egen rad ville
bare duplisert medlemslisten).

Alle områdeeiere er **dynamiske supereiere** av alle mapper i området. En
mappe kan derfor ha null eksplisitte mappeeiere; kategorien «Eier(e) av
mappen» utelates da fra medlemslisten.

Én eksplisitt mappeeier → «Eier av mappen»; flere → «Medeiere av mappen».

En bruker kan være eksplisitt mappeeier og områdemedlem samtidig. Rollen gir
da ekstra myndighet i mappen, men brukeren vises bare **én gang** i
medlemslisten (se presedensen i del 5).

### Ingen roller på liste- eller elementnivå

Den som oppretter en liste, kategori eller et listepunkt får **ingen**
vedvarende særrett. Dette er en bevisst endring fra den gamle oppretterbaserte
myndigheten. `created_by` der er kun historikk.

---

## 3. Capabilities

Autorisasjonen er **capability-basert**, ikke en antatt rangering av roller.
Serveren regner ut capabilities og returnerer dem til klienten
(`get_my_doc().universes[].caps` / `.groups[].caps`, og
`get_members().viewer.caps`). Klienten kan bruke lokale anslag for umiddelbar
visning, men **serverens capabilities og RLS/RPC-ene er alltid autoritative**.

Det lokale anslaget **feiler lukket**: mangler `caps` helt, følger anslaget den
lokale rollen (`privilegedLocal`) — ikke «alt er lov». Det er ikke en teoretisk
finesse: en database der migreringen ennå ikke har kjørt svarer uten `caps`, og
et optimistisk «alt er lov» viste da eier-kontroller («Lås nå», «Slett … for
alle») til vanlige medlemmer, som deretter fikk avslag fra serveren. En kontroll
brukeren ikke har lov til å bruke skal ikke være synlig; det motsatte er en
feilmelding forkledd som en knapp.

Alle capability-funksjonene tar `p_type`, og de fem delbare typene er
`universe`, `group`, `note_project`, `note_folder` og `note` (`shareable_types()`
er lista). Låser og lås-unntak finnes i tillegg på `card`.

| Capability | SQL-funksjon |
|---|---|
| lese objekt | `can_read` |
| redigere innhold | `can_edit_content` |
| opprette subobjekter | `can_create_child` |
| endre delt rekkefølge | `can_reorder_in_parent` |
| slette objektet for alle | `can_delete_object` |
| forlate objektet | `can_leave` |
| flytte mappe ut av et område | `can_move_group` |
| opprette mappe i et målområde | `can_create_child('universe', …)` |
| invitere medlemmer | `can_invite_to` |
| invitere eiere | `can_invite_owner` |
| administrere medlemmer, eierskap og innstillinger | `can_manage_members` |
| låse og låse opp | `can_manage_lock` |
| overstyre lås for egen redigering | `is_privileged` (inngår i `can_edit_content`) |
| opprette unntak fra arvet lås | `can_manage_lock_exception` |
| endre invitasjonspolicy | `can_manage_invite_policy` |

**PRIVILEGERT** (`is_privileged`) = eier på det nivået som styrer objektet:
områdeeier for et område, mappeeier (eksplisitt eller områdeeier) for
mappe/liste/listepunkt. Privilegerte påvirkes aldri av en lås for **egen**
redigering.

### Å opprette og å plassere spør FORELDEREN

Tre av capabilityene handler ikke om objektet foran deg, men om **forelderen**:

| Handling | Myndigheten ligger på | Klientens spørsmål |
|---|---|---|
| opprette en liste i en mappe | mappen | `canAddList(g)` |
| omrokkere/flytte en liste | mappen | `canAddList(g)` |
| opprette et listepunkt/en kategori | listen | `!frozen(kort)` |
| omrokkere et listepunkt | listen | `!frozen(kort)` |
| opprette/omrokkere en mappe | området | `caps.createGroup` / `caps.reorderInParent` |

`frozen(objekt)` svarer bare på ÉN ting: kan jeg redigere dette objektet selv.
Den er derfor **feil spørsmål** for opprettelse og plassering, og forskjellen er
ikke akademisk — et **lås-unntak** («Gjør unntak» på én liste i en låst mappe)
er nettopp tilfellet der de to spriker: lista kan redigeres, men det gir ingen
rett til å lage en ny liste ved siden av den eller flytte den.

Feilen dette rettet opp: «＋ Liste» spurte kun om det fantes en aktiv mappe. Et
vanlig medlem kunne gå inn i en låst mappe og opprette en liste; RLS
(`cards_insert` → `can_create_child('group', …)`) avviste skrivingen i det
stille, og siden lista arvet mappelåsen ble den umulig å redigere ELLER slette
igjen — et spøkelse som bare forsvant ved å tømme localStorage. `canAddList(g)`
(= `cap(g, 'createList', !frozen(g))`) er nå ett spørsmål, brukt av alle veiene
inn til den samme myndigheten: knappen, klikk-handleren, tomtilstandens tekst,
ekstrahering til ny liste (`S.canExtract`), listedraging og mappevelgeren ved
slipp på 📁-breadcrumben.

Å **gjenopprette** fra søpla er å skrive `trashed = false` og krever derfor
nøyaktig samme myndighet som å slette (`can_delete_object`) — se
[`trash.md`](trash.md).

### Områdeeier

* full lese-, redigerings- og administrasjonsmyndighet over området og alle subobjekter
* påvirkes ikke av låser noe sted i området
* kan opprette, redigere, flytte, slette, gjenopprette og omrokkere alle mapper, mappekategorier, lister, listekategorier og listepunkter
* kan endre områdets innstillinger, låse alt, og administrere låsunntak
* kan invitere områdemedlemmer **og** områdeeiere
* kan invitere direkte medlemmer og eiere til mapper, og fjerne direkte mappemedlemmer/-eiere
* kan kaste ut områdemedlemmer, og fjerne/degradere andre områdeeiere så lenge minst én eier blir igjen
* kan slette området for alle, og enhver mappe eller liste — også andres

### Eksplisitt mappeeier

* full myndighet over mappen og alt innhold i den
* påvirkes ikke av mappens eller listenes låser, og kan redigere mappen selv om **området** er låst
* kan administrere mappens innstillinger, låse mappen og listene
* kan invitere direkte mappemedlemmer og mappeeiere, og fjerne dem igjen
* kan slette mappen for alle, og flytte den når kildekrav + målkrav er oppfylt
* kan opprette, redigere, slette og flytte lister og listeinnhold

Kan **ikke**: redigere områdets innstillinger, invitere til området, fjerne
områdeeiere eller områdemedlemmer, ekskludere et områdemedlem fra mappen,
eller endre mappens plassering blant søskenmapper i et **låst** område.

> Et objekts posisjon blant mapper tilhører **områdets struktur**. Å
> omrokkere mapper krever derfor rett til å redigere områdets innhold — noe
> annet enn å redigere eller slette selve mappen.

### Vanlig områdemedlem

* er automatisk effektivt medlem av **alle** mapper i området
* kan lese hele området
* kan redigere innhold som er effektivt åpent
* kan opprette mapper og mappekategorier når området er effektivt åpent, og blir eksplisitt mappeeier av det de selv oppretter
* kan opprette lister når mappen er effektivt åpen
* kan redigere og slette åpne mapper og åpne lister — også andres
* kan omrokkere mapper når området er åpent, og lister når mappen er åpen
* kan invitere når effektiv invitasjonspolicy tillater det

Kan **ikke**: slette området, endre administrative innstillinger, låse/låse
opp, endre invitasjonspolicy, administrere eierskap, kaste ut medlemmer, eller
fjerne et annet områdemedlem fra en enkelt mappe.

«Redigere» betyr her ordinært innhold: navn, tekst, rekkefølge, tidsplaner og
tilsvarende. Det omfatter **ikke** medlemskap, roller, lås eller
invitasjonspolicy.

### Direkte mappemedlem uten områdemedlemskap

* kan lese mappen og alt i den
* kan redigere åpent innhold
* kan opprette, redigere, slette og omrokkere lister når mappen er effektivt åpen
* kan redigere listepunkter og kategorier når nivåene er åpne
* kan invitere til mappen når effektiv policy tillater det

Kan **ikke**: slette mappen for alle, flytte mappen, redigere mappens
administrative innstillinger, låse/låse opp, administrere eierskap eller kaste
ut medlemmer.

---

## 4. Låser

Tretilstandsmodellen består: **eksplisitt låst**, **eksplisitt åpnet unntak**,
**arv**. Effektiv lås = den nærmeste eksplisitte tilstanden fra objektet og
oppover (`effective_lock_source`).

* Områdeeiere omgår alle låser for egen redigering.
* Eksplisitte mappeeiere omgår område-, mappe- og listelåser for egen
  redigering **innenfor sin mappe**. Det gir dem ikke rett til å åpne mappen
  for andre i strid med en områdelås.
* Bare områdeeiere kan gjøre et allment unntak fra en **områdelås**.
* Områdeeiere **og** relevant eksplisitt mappeeier kan administrere unntak fra
  en **mappelås** på underliggende lister.
* Ordinære medlemmer kan aldri endre låstilstand.
* Listelåser påvirker verken mappeeiere eller områdeeiere.
* Posisjon blant søsken styres av redigeringsrett på **forelderen**, ikke av
  barnets egen lås.

Finnes det ingen arvet lås, er «unntak» bare en overflødig flaggverdi — da kan
den som ellers styrer objektets lås rydde den bort (f.eks. etter at låsen over
er fjernet).

**Invitasjonspolicy** (`inherit | allow | deny`, nærmeste eksplisitte oppover)
finnes kun på områder og mapper. Listespesifikk policy er fjernet.

---

## 5. Effektivt medlemskap

Effektivt medlemskap i en mappe er den **dedupliserte unionen** av:

1. områdeeiere
2. eksplisitte mappeeiere
3. vanlige områdemedlemmer
4. direkte mappemedlemmer

Områdeeiere og områdemedlemmer materialiseres **aldri** som mappemedlems-
rader — den arvede tilgangen beregnes dynamisk. En rolle gir i seg selv den
tilgangen den skal: områdeeierrollen gir områdemedlemskap, og en eksplisitt
mappeeierrolle gir mappetilgang selv uten medlemskap i området.

En bruker vises aldri flere ganger i samme medlemsliste. Presedensen er
rekkefølgen over (1 vinner over 2 osv.).

**Områdets medlemsliste:** «Eier»/«Medeiere», så «Medlemmer».

**Mappens medlemsliste** (tomme kategorier utelates):

1. «Eier av området» / «Medeiere av området»
2. «Eier av mappen» / «Medeiere av mappen»
3. «Medlemmer av området»
4. «Medlemmer av mappen»

Områdeeiere og områdemedlemmer vises i alle mappers medlemslister, men kan
ikke fjernes der (`removable = false` + `removeHint`: «Har tilgang via området
og må fjernes der»). Ventende invitasjoner står i en egen seksjon og teller ikke
som medlemmer.

---

## 6. Invitasjoner, roller og fjerning

### Eierskapsinvitasjoner

Å gjøre noen til områdeeier eller mappeeier er alltid en **eksplisitt
rolleinvitasjon mottakeren må akseptere** (`create_share_invite(..., 'owner')`).
Det gjelder både en eksisterende medlem som skal opp i rolle, en som ennå ikke
er medlem, og en e-postadresse uten konto. Ved aksept opprettes medlemskap og
rolle atomisk.

Vanlig invitasjonspolicy gir **aldri** rett til å invitere eiere — bare
relevante eiere kan det. `set_member_role` kan derfor bare degradere (eier →
medlem); rolleløft må gå gjennom en invitasjon.

Redundante **medlems**-invitasjoner avvises (mottakeren har allerede effektiv
tilgang). En **eierskaps**-invitasjon til samme person er derimot gyldig — det
er nettopp rolleløftet.

I medlemslisten har hver rad derfor opptil to rollehandlinger:

| Rad | Knapp | Hva den gjør |
|---|---|---|
| vanlig medlem, `promotable` | «Gjør til medeier» | sender en **eierinvitasjon**; rollen endres først ved aksept |
| eier, `demotable` | «Gjør til medlem» | `set_member_role` — trer i kraft med en gang |
| min egen rad, `demotable` | «Tre av som medeier» | samme kall på meg selv; jeg beholder tilgangen |

`promotable` regnes ut serverside: raden må være **direkte** på objektet, ha
rollen `member`, betrakteren må ha `can_invite_owner`, og det må ikke allerede
ligge en ventende eierinvitasjon til den e-postadressen (ellers ville knappen
bare gjentatt seg selv). Den ventende invitasjonen vises i stedet under
«Ventende invitasjoner» som «Invitert som medeier».

Fordi rolleløftet er en invitasjon, kan den samme personen allerede ha en
ventende medlemsinvitasjon liggende. `create_share_invite` **oppdaterer** derfor
en ventende invitasjon i stedet for å feile på unik-indeksen, og rollen kan bare
gå **opp** (`member` → `owner`) — en ny medlemsinvitasjon skal ikke stille
degradere en eierinvitasjon som ligger og venter.

**«Fjern» gjelder aldri meg selv.** Å fjerne seg selv er å forlate, og den
handlingen har sin egen knapp; to knapper for det samme, der den ene er
feilmerket, er verre enn én.

### Fjerning fra område

Når en bruker forlater eller kastes ut av et område (`purge_universe_access`):

* områderollen fjernes
* alle direkte mappemedlemskap i områdets mapper fjernes
* alle eksplisitte mappeeierroller i området fjernes
* ventende rolle- og medlemsinvitasjoner i området og mappene trekkes tilbake
* alle `responsible`-referanser i området som peker på brukeren nullstilles

Brukeren skal ikke beholde skjult tilgang til enkeltmapper — også når det
direkte mappemedlemskapet fantes før områdemedlemskapet.

En eier som **degraderes** til vanlig medlem beholder derimot områdemedlemskap,
og eksplisitte mappeeierroller består med mindre de fjernes særskilt.

### Fjerning fra mappe

Når et direkte mappemedlem eller en eksplisitt mappeeier forlater eller
fjernes (`purge_group_access`): mapperollen fjernes, ansvarstildelinger i
mappen som peker på brukeren nullstilles (kun hvis den effektive tilgangen
faktisk forsvant), og områdemedlemskap røres ikke.

En områdearvet bruker kan ikke fjernes fra mappen alene — RPC-en avviser
forsøket med en forklarende feil i stedet for å bli en stille no-op.

### «Forlat mappe» krever at mapperollen er ENESTE vei inn

`can_leave('group', …)` er sann bare når brukeren har en direkte mapperolle
**og ingen rolle i mappens område**. Har man begge deler, fjerner ikke
mappens forlat-knapp noen tilgang — den kommer også fra området — så knappen
vises ikke, og `leave_share` avviser kallet med «du har tilgang via området —
forlat området i stedet» i stedet for å slette den overflødige raden. Uten det
leddet oppførte knappen seg som en løgn: raden forsvant, tilgangen besto, og
mappen kom rett tilbake ved neste synk (klienten fjerner den optimistisk).

Den kombinasjonen oppstår helt lovlig og er ikke feil i seg selv:

* rolle-backfill-en gjorde **mappens oppretter** til eksplisitt mappeeier, og
  vedkommende kunne SENERE bli medeier av området (den historiske formen — de
  som opprettet mapper i andres område før medeierskap fantes);
* noen kan bli gjort til mappeeier først og inviteres til hele området etterpå.

Veien ut av en overflødig **mappeeierrolle** er «Tre av som medeier» i mappens
delemodal (`set_member_role`), som fjerner raden helt når brukeren er
områdemedlem — ikke «Forlat». Er man områdeEIER, er raden uansett virkningsløs
(områdeeiere er dynamiske supereiere av alle mapper i området), og den
ryddes automatisk hvis man forlater eller kastes ut av området.

---

## 7. De tre seksjonene i «Områder og mapper»

Modalen har tre klart adskilte seksjoner med overskrift og skillelinje. Et
område eller en mappe vises i **nøyaktig én** seksjon for den aktuelle
brukeren.

### 1. `[områdeikon][kontoikon] Mine områder`

Områder der brukeren nå har rollen `owner` — uansett hvem som opprettet dem.
Klassifikasjonen følger **nåværende rolle**, ikke `created_by`: degraderes en
tidligere oppretter, flyttes området til seksjon 2.

«Nytt område»-knappen står her, og bare her.

### 2. `[områdeikon][delt-ikon] Områder delt med meg`

Områder der brukeren er `member`, men ikke `owner`. Ingen «Nytt område»-knapp.

Alle medlemmer kan åpne delemodalen og se medlemslisten; invitasjonskontroller
vises kun ved `caps.invite`/`caps.inviteOwner`. Forlat-knapp for alle som kan
forlate, sletteknapp kun ved `caps.delete`, begge når begge er tillatt.

Knapper for å opprette mapper og mappekategorier vises kun ved
`caps.createGroup`. Mapperekkefølge, mappekategorier og mappeplassering inne
i området er felles for alle med tilgang.

### 3. `[mappeikon][delt-ikon] Mapper delt med meg`

Mapper der brukeren har en direkte mappe-eier- eller mappemedlemsrolle **og**
ingen rolle i mappens kanoniske område (`free = true` i `get_my_doc`).

De vises som frie mapper uten område over seg, kan omordnes med dra-og-slipp
(personlig rekkefølge), kan ikke organiseres i mappekategorier, har ingen
opprett-knapp, og har deleknapp for alle + forlat/slett etter capabilities.

Får en direkte mappemottaker senere områdemedlemskap, forsvinner mappen fra
denne seksjonen og vises inne i området — og redundante ordinære direkte
mappemedlemskap i området ryddes ved aksept (eksplisitte mappeeierroller
beholdes, men fjernes hvis brukeren senere forlater eller kastes ut av
området). En beholdt mappeeierrolle gir ingen forlat-knapp inne i området;
se «Forlat mappe krever at mapperollen er ENESTE vei inn» i del 6.

Klienten samler seksjon 3 i én **virtuell beholder** (`FREE_UNI_ID`) som aldri
pushes; mappene beholder sitt kanoniske `uni` i doc-et, og områdets navn/
medlemsliste lekkes aldri til en mottaker uten områdeadgang.

---

## 8. Ikoner og breadcrumbs

Fast rekkefølge i nav-modalens område-kort og mappe-rader:
`[ressursikon][delt-ikon ved behov] Ressursnavn`. Mappeikonet vises aldri to
ganger.

Et objekt er **aktivt delt** når mer enn én bruker har effektiv tilgang.
Ventende invitasjoner alene utløser ikke delt-ikonet. For en mappe regnes det
fra den dedupliserte effektive medlemslisten, inkludert arvede områdemedlemmer
(`group_member_count`).

```
[områdeikon][delt?] Områdenavn  ›  [mappeikon][delt?] Mappenavn   (nav-modalen)
[delt-ikon] Delte mapper         ›  [mappeikon][delt-ikon] Mappenavn
```

Første ledd i den frie varianten er en **virtuell navigasjonsrot** uten
områdeikon; den navigerer tilbake til «Mapper delt med meg».

**Breadcrumben i toppmenyen** (`#nav-crumb`) viser derimot BARE navnene, uten
noen av ikonene over — heller ikke delt-ikonet: plassen er knapp, og brukeren
trenger ikke påminnes om deling akkurat der.

```
Områdenavn  ›  Mappenavn        (breadcrumben)
Delte mapper  ›  Mappenavn
```

Alle ikoner og ikonknapper har tilgjengelige navn og tooltips.

---

## 9. Invitasjonsflyt

**Områdeinvitasjon.** Ved aksept: rollen fra invitasjonen opprettes, området
legges bakerst i mottakerens personlige rekkefølge, ingen forelder velges,
redundante ordinære direkte mappemedlemskap i området fjernes, og eksplisitte
mappeeierroller beholdes.

**Mappeinvitasjon.** Ved aksept: direkte mappe-eier- eller mappemedlemsrolle
opprettes, ingen forelder velges. Mappen vises under «Mapper delt med meg»
hvis mottakeren ikke er medlem av det kanoniske området — ellers inne i
området.

**Mappe i delt område.** Omfatter alltid minst alle områdets medlemmer. Man
kan invitere flere direkte mappemedlemmer uten å invitere dem til området;
de ser da bare mappen og dens lister. Det er aldri mulig å ekskludere et
områdemedlem fra en bestemt mappe.

**Liste.** Delingsknapp, medlemsadministrasjon, direkte invitasjoner,
listemedlemskap, mottakerspesifikke mounts og listespesifikk invitasjonspolicy
er **fjernet**. Ansvarlig-velgere i lister og listepunkter bruker mappens
effektive medlemsliste.

---

## 10. Slette og forlate

* Ordinær «Slett» legger objektet i **felles** søppel for alle med tilgang.
* Gjenoppretting gjelder for alle.
* Permanent sletting ved tømming oppretter gravsteiner.
* Bare brukere med relevant sletterett kan slette eller gjenopprette.
* **«Forlat» endrer aldri innholdet** — det fjerner kun brukerens roller og tilgang.

| Situasjon | Forlat | Slett |
|---|---|---|
| Vanlig medlem av delt område | ja | nei |
| Medeier (minst én annen eier) | ja | ja |
| Siste eier | nei | ja |
| Vanlig direkte medlem av fri mappe | ja | nei |
| Mappeeier av fri mappe | ja | ja |
| Direkte mapperolle i et område man også har rolle i | nei (forlat området) | etter rolle |

Er mappeeieren også områdemedlem, er mappen ikke fri, og områdereglene
gjelder for tilgangen — inkludert hvor man forlater (se «Forlat mappe» over).

Bekreftelsesdialog kreves for handlinger som påvirker andre: slette område eller
mappe for alle, fjerne medeier, flytte en mappe slik at medlemskretsen endres,
og kaste ut områdemedlem.

Forsvinner tilgangen mens man står i objektet (sletting, flytting, utkastelse,
rolleendring), lukkes visningen, appen navigerer til nærmeste gyldige fallback,
og en nøktern melding forklarer hva som skjedde (`noteAccessLoss`). En gammel
lokal kopi blir aldri stående redigerbar.

### Slette hele kontoen

`delete_account()` (SECURITY DEFINER, én transaksjon) er «forlat alt + slett
mitt eget» i én operasjon. Regelen er den samme som ellers i modellen: **det som
blir stående uten eier når jeg er borte, er mitt og følger med.**

| Objektet | Hva skjer |
|---|---|
| Område jeg er eneste eier av | slettes helt, med hele undertreet og gravstein for hver rad — også for dem jeg har delt med |
| Område med andre eiere | står igjen; jeg fjernes som medlem (som «Forlat») |
| Område jeg bare er medlem av | urørt; jeg fjernes som medlem |
| Mappe jeg er eneste eksplisitte mappeeier av | står igjen — områdeeierne er dynamiske supereiere |
| Innhold jeg har OPPRETTET i noe som overlever | står igjen; oppretteren arves av en gjenværende områdeeier |
| `responsible` som peker på meg | nulles, med nytt innholds-stempel |
| Roller, invitasjoner (begge veier), e-postlogg, profil, auth-bruker | slettes |
| Gravsteiner | blir stående (id-er uten personopplysninger — de er nettopp det som hindrer gjenoppstandelse) |

Oppretter-arven er ikke en omskriving av historien for moro skyld: `owner_id` gir
ingen rettigheter, men FK-en er `on delete cascade`. Uten arven ville
profilslettingen revet vekk innhold i andres delte områder — et listepunkt jeg
la inn i en felles liste er de andres innhold like mye som mitt. Arvingen er
deterministisk (`surviving_universe_owner`: eldste eiermedlemskap først).

Rekkefølgen i funksjonen er ikke tilfeldig: invitasjonene ryddes FØR områdene,
for et område som slettes tar sine egne invitasjoner med i kaskaden, og da ville
e-postlogg-radene deres ikke lenger vært mulige å finne.

Klienten kaller RPC-en fra konto-modalen bak en advarsel som må **sveipes** til
høyre (se `docs/accounts.md`), rydder sine lokale spor og lander på
innloggingssiden.

---

## 11. Flytting av mapper

All flytting mellom områder skjer gjennom **én atomisk server-RPC**,
`move_group(p_group, p_universe, p_cat, p_pos)`. Klienten gjennomfører den aldri
som en sekvens av inserts/updates/deletes. RPC-en låser radene (`for update`),
kontrollerer rettighetene på nytt inne i transaksjonen, og fullfører helt eller
ruller helt tilbake. En direkte skriving av `groups.universe_id` avvises av
`groups_before_update`.

**Tillatelser:** `can_move_group` (destruktiv myndighet) i kilden **og**
`can_create_child` i målområdet. Ren redigeringsrett holder ikke. Dra-og-slipp
viser bare gyldige mål, og serveren håndhever det samme.

### Samme område

Vanlig endring av delt posisjon/mappekategori: alle id-er, roller, medlemskap
og invitasjoner består; endringen påvirker alle områdemedlemmers visning og
krever rett til å redigere områdets struktur. (`mode: 'reorder'`)

### Eierskapsdomene

Mappens eierskapsdomene defineres av det **nåværende, dedupliserte settet av
områdeeiere** (`universe_owner_set`). To områder er i samme domene bare
dersom settene er identiske i transaksjonsøyeblikket. Det er mer robust enn
«opprettet av meg» / «delt med meg», som blir ustabilt når eierskap kan endres.

Klienten får settet som én sammenlignbar nøkkel (`ownerKey`) og kan dermed vite
om en flytting krysser domenegrensen **før** den kaller RPC-en — slik at
bekreftelsen kommer i riktige tilfeller.

### Samme domene → ekte reparenting (`mode: 'reparent'`)

Mappe-, liste-, kategori- og element-id-er består. Eksplisitte mappeeiere,
direkte mappemedlemmer, ventende direkte mappeinvitasjoner, innhold og
eksplisitte låser beholdes. `universe_id`, kategori og delt posisjon settes
atomisk.

Tilgangsendringer: de som bare arvet tilgang fra kildeområdet mister den;
målområdets medlemmer får den; direkte mappemedlemmer beholder den (og ser
mappen i fri seksjon hvis de ikke er medlem av målområdet).
Ansvarstildelinger til brukere uten effektiv tilgang etter flyttingen nullstilles.

### Ulikt domene → kopier-og-slett (`mode: 'copy'`)

Semantisk «slett den gamle mappen for alle i det gamle domenet, og opprett en
ny i det nye». Atomisk:

* ny mappe med ny UUID, og nye UUID-er for alle lister, kategorier og listepunkter
* aktøren blir `created_by` og eksplisitt mappeeier
* innhold, rekkefølge, kategorier, listeinnstillinger, tidsplaner, låstilstander og eksplisitt invitasjonspolicy kopieres
* arv fra målområdet beregnes på nytt
* gamle direkte mappemedlemmer, mappeeiere og ventende invitasjoner kopieres **ikke**
* kildeområdets navn, medlemsliste og historikk eksponeres aldri i målområdet
* ansvarstildelinger kopieres kun når den ansvarlige har effektiv tilgang i måldomenet; ellers `responsible = null`
* det gamle mappetreet slettes permanent i samme transaksjon, med gravsteiner for **samtlige** gamle id-er
* en deterministisk `mapping` (gammel id → ny id) returneres, så klientens optimistiske visning kan byttes uten flimring

For de gamle medlemmene forsvinner mappen helt; gamle offline-klienter møter
gravsteiner og kan aldri gjenopplive treet. En eksplisitt bekreftelse vises før
en slik flytting: de gamle mister tilgang, direkte mappemedlemmer og medeiere
følger ikke med, målområdets medlemmer får tilgang, og det er ikke en ordinær
omplassering.

Kryssdomene-flytting er **ikke** modellert som vanlig LWW — server-RPC-ens
transaksjon og id-mapping er autoritativ.

### Fra «Mapper delt med meg»

Et fritt mappekort kan slippes på et område bare når brukeren kan slette/flytte
mappen og opprette mappe i målområdet. Det er normalt en domenekryssing og
bruker kopier-og-slett. Et vanlig direkte mappemedlem kan ikke flytte mappen.

### Ingen flytting til den virtuelle seksjonen

En kanonisk mappe kan ikke flyttes «ut av» et område og inn i «Mapper delt med
meg». Alle mapper har alltid et kanonisk område.

---

## 12. Personlig og delt rekkefølge

**Personlig** (per bruker, på medlemskapsraden `memberships.pos` — også for
eiere):

* områdenes rekkefølge i «Mine områder»
* områdenes rekkefølge i «Områder delt med meg»
* frie mappers rekkefølge i «Mapper delt med meg»

**Felles** (på objektraden `pos`, for alle med tilgang):

* mappers rekkefølge i et område
* mappekategorier og mappenes kategoritilhørighet
* listers rekkefølge i en mappe
* listekategorier og listepunkter

Områdets kanoniske `pos` brukes ikke som felles toppnivårekkefølge. I klienten
holder `.pos` den personlige verdien og `_canon` den kanoniske, som skrives
tilbake uendret.

Ved rolleendring mellom eier og medlem flyttes området mellom seksjonene, og
plasseres sist i den nye seksjonen dersom ingen tidligere personlig posisjon
finnes der.

---

## 13. Migrering av gamle direkte listedelinger

Kjøres én gang av `users-and-sharing.sql` (naturlig idempotent: etterpå finnes
ingen rader med `card_id`). For hver liste med direkte medlemskap eller ventende
invitasjoner:

1. Beregn den effektive tilgangen før migreringen.
2. **Redundante** listetilganger (mottakeren har allerede mappetilgang) fjernes;
   listen blir liggende.
3. Finnes det ingen ANDRE aktive lister i foreldremappen: mottakerne
   **promoteres** til direkte mappemedlemmer, ventende listeinvitasjoner blir
   mappeinvitasjoner, og listedelingene fjernes. (Kriteriet er «ingen annen
   aktiv liste», ikke «antall aktive lister ≤ 1» — ligger den delte lista selv i
   søpla mens en søskenliste er aktiv, ville promotering gitt mottakerne tilgang
   til nettopp den søskenlista.)
4. Finnes det andre aktive lister: en **ny søskenmappe** opprettes i
   samme område (listetittelen som navn, «Delt liste» ved tom tittel,
   deterministisk kollisjonshåndtering med « (2)»), plassert ved siden av den
   gamle i samme mappekategori. Listen flyttes dit med uendrede id-er. Alle som
   hadde tilgang via direkte medlemskap i den gamle mappen (men ikke området)
   eller via listen, får direkte mappemedlemskap i den nye — med samme rolle
   som før. Ventende invitasjoner konverteres. Listemedlemskapene fjernes.

Resultatet bevarer den tidligere effektive tilgangen uten at noen får tilgang til
søskenlister de ikke kunne lese før. En tidligere direkte listemottaker uten
områdemedlemskap ser den nye mappen under «Mapper delt med meg».

Rollene backfilles i samme kjøring: områdets oppretter blir områdeeier,
mappens oppretter blir eksplisitt mappeeier (med mindre rollen alt er arvet),
eksisterende direkte medlemskap blir vanlige roller, og redundante rader
dedupliseres. Backfillen er markert i `public.migration_log` og kjøres **aldri**
på nytt — en rolle som senere er fjernet med vilje skal ikke komme tilbake.

---

---

## 14. Notatsiden: Bokhylle > Notatbok > Notat

Notatene har den SAMME modellen som områder og mapper — roller i
`memberships`, invitasjoner i `share_invites`, capabilities regnet ut på
serveren — i den samme tabellen og med den samme koden. Det som er notatsidens
eget står her.

### Hva som kan deles, og hvordan arven går

Alle tre nivåene kan deles direkte. **Arven går ÉN vei, nedover:**

* en rolle på **bokhyllen** gjelder notatbøkene og notatene i den;
* en rolle på **notatboken** gjelder notatene i den;
* en rolle på **notatet** gjelder notatet.

Motsatt vei gir en rolle ingenting. Den som har fått ett notat delt med seg,
ser verken notatboken, bokhyllen, navnene deres eller medlemslistene deres —
nøyaktig som en direkte mappemottaker aldri ser området mappen står i.

### Roller

`owner` og `member`, som ellers. Det finnes **ingen egen leser-rolle**: en ren
leser er et medlem av et LÅST objekt, akkurat som i listefanen. Låsen er derfor
mekanismen som skiller redaktør fra leser, og den har den samme
tretilstandsmodellen (låst / unntak / arv) langs kjeden **notat → notatbok →
bokhylle**.

* **Bokhylleeiere** er dynamiske supereiere av alle notatbøker og notater i
  bokhyllen — de trenger ingen egne rader.
* **Eksplisitte notatbokeiere** har full myndighet i notatboken og notatene i
  den.
* **Eksplisitte notateiere** har full myndighet over notatet.
* Den som oppretter noe blir eier — med mindre rollen alt er arvet ovenfra. En
  konto som jobber alene får derfor ÉN rad per bokhylle, ikke én per notat.

**Siste-eier-invarianten gjelder BOKHYLLEN** (som et område). En notatbok og et
notat kan stå uten eksplisitt eier, for bokhylleeierne dekker dem.

### Hvem får gjøre hva

| Handling | Bokhylle | Notatbok | Notat |
|---|---|---|---|
| **lese** | rolle på bokhyllen | rolle på notatboken **eller** bokhyllen | rolle på notatet, notatboken **eller** bokhyllen |
| **redigere innhold** | lesetilgang + (eier ELLER ikke effektivt låst) | ⟶ | ⟶ |
| **opprette under** | redigeringsrett på bokhyllen | redigeringsrett på notatboken | – |
| **omrokkere** | alltid (PERSONLIG rekkefølge) | redigeringsrett på bokhyllen | redigeringsrett på forelderen |
| **arkivere / hente ut av arkivet** | redigeringsrett | ⟶ | ⟶ |
| **slette / gjenopprette (felles søppel)** | kun bokhylleeiere | notatbokeiere, ELLER et bokhylle­medlem når notatboken er åpen | notateiere, ELLER et medlem ARVET ovenfra når notatet er åpent |
| **dele videre (medlem)** | eiere, ELLER medlemmer når invitasjons­policyen tillater det | ⟶ | ⟶ |
| **dele videre (eierskap)** | kun eiere på nivået | ⟶ | ⟶ |
| **låse / gjøre unntak** | bokhylleeiere | notatbokeiere; unntak fra en bokhyllelås kun av bokhylleeiere | notateiere; unntak som over |
| **forlate** | rolle på bokhyllen (siste eier kan ikke) | direkte rolle **og** ingen rolle i bokhyllen | direkte rolle **og** ingen rolle i notatboken eller bokhyllen |

**Å arkivere er INNHOLD, å slette er destruktivt.** Arkivet er reversibelt og
tar ingenting fra noen, så det krever bare redigeringsrett. Søppelkassen er
felles for alle med tilgang, så den krever sletterett. Skillet er verdt å holde
presist: et medlem skal kunne rydde uten å kunne ta noe fra alle andre.

**Et rent DIREKTE medlem kan aldri slette objektet for alle.** Samme grense som
holder et direkte mappemedlem fra å slette mappen: deler man et notat med noen,
deler man lesing og redigering — ikke retten til å ta det fra resten.

### Flytting mellom foreldre med ulike delingsforhold

Et notat eller en notatbok som flyttes til en ny forelder blir **reparentet** —
aldri kopiert og slettet. Id-ene består, innholdet består, og ingen rad
forsvinner. Kravet er destruktiv myndighet i KILDEN (`can_move_note_object` =
`can_delete_object`) og opprettelsesrett i MÅLET (`can_create_child` /
`can_create_note`); begge håndheves av vaktene (`note_folders_before_update`,
`notes_before_update`).

Tilgangen regnes om fra den nye forelderen:

* de som bare ARVET tilgang fra den gamle forelderen, mister den;
* målets medlemmer får den;
* **DIREKTE roller på objektet som flyttes, består.**

Det finnes altså ingen kryssdomene-kopiering på notatsiden, og dermed heller
ingen id-mapping å holde rede på. En notatbok som flyttes drar notatene sine med
seg (`note_folders_cascade`); den kaskaden er invarianten, ikke en flytting, og
krever derfor ingen egen myndighet på hvert notat.

### Hva som skjer når tilgang trekkes tilbake

`revoke_share` og `leave_share` rydder NEDOVER: fjernes bokhyllerollen, ryddes
også direkte roller på notatbøker og notater i bokhyllen, og ventende
invitasjoner på alle tre nivåene. Ingen skjult tilgang blir stående igjen.

Har brukeren ingen DIREKTE rolle, men likevel tilgang, kommer den ovenfra — og
da avvises kallet med `PT409` og en forklaring som peker på nivået over, i
stedet for å bli en stille no-op.

Hos mottakeren forsvinner raden fra neste `get_my_doc`. Klienten dropper den
lokalt (den står i synk-basen, så den leses ikke som «nyopprettet her»),
editoren lukkes hvis notatet var åpent, og en nøktern melding forklarer hva som
skjedde. **En gammel lokal kopi blir aldri stående redigerbar.**

### «Delt med meg» på notatsiden

En notatbok eller et notat kan være delt direkte uten at bokhyllen over er
lesbar (`free = true` i `get_my_doc`). Da finnes det ingen forelder å tegne dem
i — og bokhyllens navn skal aldri lekke. De samles derfor i ÉN virtuell
bokhylle, «Delt med meg», nøyaktig som frie mapper samles i «Mapper delt med
meg». Den finnes ikke i databasen, pushes aldri, og har verken delings- eller
opprettelseskontroller. Rekkefølgen i den er personlig, og den KANONISKE
plasseringen skrives tilbake uendret.

### Rekkefølge

* **Personlig** (`memberships.pos`): bokhyllene på toppnivå, og notatbøker/notater
  som vises i «Delt med meg».
* **Felles** (`pos` på objektraden): notatbøkene i en bokhylle, og notatene i en
  notatbok eller blant de frie notatene.

### Koblinger når notatene deles

En kobling er den ENKELTE brukerens egen krysshenvisning: `owner_id` eier den,
og bare hen ser den — også når begge objektene er delt. Det er en avgjørelse,
ikke en forglemmelse: den andre siden er ofte et privat område eller en privat
liste, og en delt kobling ville røpet både at objektet finnes og hva det heter
for alle som deler notatet.

* Å opprette en kobling krever **lesetilgang til BEGGE sider** i det øyeblikket.
* En kobling gir **aldri tilgang** i seg selv.
* Mister man tilgang til målet, blir raden stående, men kan ikke åpnes. Kommer
  tilgangen tilbake, virker den igjen.
* Permanent sletting av et objekt tar koblingene med (`on delete cascade`) og
  gravlegger dem.

### Kontosletting

Samme regel som ellers: **det som blir stående uten eier når jeg er borte, er
mitt og følger med.**

| Objektet | Hva skjer |
|---|---|
| Bokhylle jeg er eneste eier av | slettes helt, med notatbøker og notater og gravstein for hver rad — også for dem jeg har delt med |
| Bokhylle med andre eiere | står igjen; jeg fjernes som medlem |
| Bokhylle jeg bare er medlem av | urørt; jeg fjernes som medlem |
| Notatbok/notat jeg er eneste eksplisitte eier av | står igjen — bokhylleeierne er dynamiske supereiere |
| Innhold jeg har OPPRETTET i noe som overlever | står igjen; oppretteren arves av en gjenværende bokhylleeier |
| Koblingene mine | slettes (de er mine alene) |

### Migrering

Notatene var eierstyrte før denne runden. `users-and-sharing.sql` gir hver
bokhylle som ennå ikke har EN ENESTE rolle, oppretteren som eier; notatbøkene og
notatene arver. Kriteriet «ingen rader i det hele tatt» gjør backfillen naturlig
idempotent og hindrer at en bevisst fjernet rolle kommer tilbake.

---

## 15. Testdekning

* `supabase/tests/test-roles-and-sharing.sql` — roller, medlemslister,
  invitasjoner, låser, sletting/forlatelse, siste-eier-invarianten, personlig
  rekkefølge.
* `supabase/tests/test-group-moves.sql` — reorder, reparenting, kryssdomene-
  kopiering, gravsteiner, rettighetskrav, rollback.
* `supabase/tests/test-list-share-migration.sql` (+ `legacy-share-fixture.sql`)
  — oppgraderingsløpet fra den gamle databasefasongen.
* `supabase/tests/test-users-and-sharing.sql` — grunnflyten (registrering, RLS,
  deling, import, gravsteiner, anon-sperre).
* `supabase/tests/test-account-deletion.sql` — kontosletting: hva som slettes,
  hva som overlever, oppretter-arven, ansvaret, restene (fire brukere).
* `tests/delete-account.test.js` — knapperaden, advarselen, sveipet (for kort /
  fullt / tastatur) og utfallet i «databasen» (desktop + mobil).
* `tests/roles-and-sections.test.js` — de tre seksjonene, capability-styrte
  knapper, medlemskategorier, breadcrumbs, tap av tilgang (desktop + mobil).
* `supabase/tests/test-note-sharing.sql` — notatsiden: roller og arv på tre
  nivåer, ren leser via lås, sletterett, flytting mellom foreldre med ulike
  delingsforhold, tilbakekalling, uautoriserte skrivinger, koblinger på tvers av
  delt og privat, gravsteiner og kontosletting (fire brukere).
* `tests/notes-sharing.test.js` — delerad i den vanlige objektmenyen på alle
  tre nivåene, delemodalen, eier/redaktør/leser, «Delt med meg»-bokhyllen,
  tilbakekalling og samtidige endringer (desktop + mobil).
