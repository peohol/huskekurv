# Domener og URL-generering

Les denne når oppgaven berører produksjonsdomener, redirecten til det
kanoniske originet, Supabase Auth-redirects (registrering/glemt
passord/e-postendring), Resend-e-postenes lenker, eksterne lenker ut av appen,
skillet mellom produksjon og preview i klienten, eller det pensjonerte domenet
`huskekurv.vercel.app`. Dette er det
**autoritative** stedet for domenekonfigurasjon — andre dokumenter
(`docs/accounts.md`, `docs/arkitektur-brukere-deling.md`,
`docs/auto-update.md`) lenker hit i stedet for å gjenta detaljene.

## Domenene

`https://huskis.no` er det **eneste kanoniske originet**: det eneste appen
kjører på, og det eneste Huskis selv genererer URL-er til.

| Domene | Rolle |
|---|---|
| `https://huskis.no` | **Kanonisk.** Appen kjører her; alt Huskis genererer (auth-redirects, Resend-lenker) peker hit |
| `https://www.huskis.no` | Svarer **308** til `https://huskis.no` — kjører aldri appen |
| `https://huskis.vercel.app` | Svarer **308** til `https://huskis.no` — kjører aldri appen |
| `https://huskekurv.vercel.app` | **Pensjonert.** Svarer 308 som de to over, og står i begge redirect-lagene som KILDE. Skal ALDRI genereres av aktiv kode. Se «Det gamle domenet» |
| `https://huskis-*-peohols-projects.vercel.app` | Vercels egne deploy-/preview-adresser. **Urørt** — en preview skal testes der den ligger |

## Redirect til det kanoniske originet

To lag, med hvert sitt formål. Begge navngir de alternative domenene
eksplisitt: alt annet (localhost, preview-deployer, ukjente verter) røres
ikke.

**1. `vercel.json` → HTTP 308 på Vercels kant.** Den virkelige mekanismen.
Én regel per domene:

```json
{
  "source": "/:path*",
  "has": [{ "type": "host", "value": "www.huskis.no" }],
  "destination": "https://huskis.no/:path*",
  "statusCode": 308
}
```

- **308**, ikke 301/302: metode og kropp beholdes, og nettleseren cacher
  redirecten permanent.
- `/:path*` → `/:path*` beholder hele pathen, så eksisterende lenker til
  undersider overlever.
- Query-parametere videreføres automatisk så lenge destinasjonen ikke selv
  har en query — derfor står det ingen `?` i `destination`. `#`-fragmentet
  legger nettleseren på igjen selv. Begge deler er auth-kritisk: PKCE-
  callbacken kommer som `?code=…`, den eldre implicit-varianten som
  `#access_token=…&type=recovery`.
- Skjer FØR noe av appen lastes — 308-en er svaret på selve
  dokumentforespørselen.

**2. Guarden øverst i `index.html` → `location.replace()`.** Dekker NØYAKTIG de
samme hostene som 308-reglene (også det pensjonerte domenet — en fane som
fortsatt kjører der skal også hentes hjem). Første kode som
kjører i dokumentet (kun `<meta charset>` står foran, den må ligge innenfor
de første 1024 bytene) — altså før stilark, før `config.js`/`app.js`, før noe
leser `localStorage` eller registrerer en service worker. Den fanger den ene
situasjonen 308-en ikke ser: en fane som ble lastet fra et alternativt domene
FØR redirecten fantes (bfcache, en HTML-kopi i cache) og derfor aldri sender
en ny dokumentforespørsel. `location.replace()` fordi det gamle domenet ikke
skal bli en historikk-oppføring brukeren kan trykke «tilbake» inn i.

Guarden eksponerer `window.__huskisCanonical` (`origin`, `redirectHosts`,
`redirectUrlFor(href)`) for testing.

**Hvorfor redirecten må ligge før appen:** både `localStorage` og PKCE-
verifikatoren er origin-avgrensede. Startet en bruker registreringen på
`www.huskis.no`, ble verifikatoren lagret der — mens e-postlenken alltid
peker til `huskis.no`, som da ikke fant den. Med 308-en kan ingen bruker
lenger STARTE en auth-flyt på et alternativt domene, og hele flyten skjer på
ett origin med én lokal tilstand.

## To separate e-postsystemer

Huskis sender e-post fra to helt uavhengige systemer — ikke bland dem sammen:

1. **Supabase Auth** sender registreringsbekreftelse, tilbakestilling av
   passord og bekreftelse av endret e-postadresse. Avsender/utseende styres
   av Supabase (innebygd mailer eller egen SMTP) + malene i **Supabase
   Dashboard → Authentication → Email Templates** — malene ligger IKKE i
   dette repoet (se «Auth-e-postmalene» under).
2. **Resend** sender Huskis' egne formaterte e-poster (delingsinvitasjoner,
   varsler) fra `noreply@huskis.no`, trigget av `send_invite_email()` i
   `supabase/users-and-sharing.sql` (pg_net → `api.resend.com`). Se
   `docs/arkitektur-brukere-deling.md` og `docs/accounts.md` for
   funksjonaliteten; denne fila dekker kun URL-ene malen bygger inn.

## Hvor auth-returadressen konfigureres

`config.js` setter `window.HUSKIS_CONFIG = { canonicalAppUrl }` — den ENE
kilden i frontend som navngir et Huskis-domene. Det finnes ingen liste over
sidestilte produksjonsdomener; de alternative domenene er ikke origins appen
kjører på, kun hoster som redirecter (se over). `app.js` bygger to små,
testbare hjelpefunksjoner over konfigurasjonen (nær auth-koden, søk
`authRedirectUrl`):

```js
canonicalAppUrl()       // → 'https://huskis.no/' (trailing slash normalisert)
authRedirectUrl(origin) // origin er valgfri og KUN til testing — appen kaller
                         // den alltid uten argument, som da bruker location.origin
```

`authRedirectUrl()` sin regel er bevisst enkel — ingen generell «sanitiser en
vilkårlig URL»-funksjon, kun et eksplisitt valg mellom to betrodde utfall:

- `location.origin` er `http://localhost:<port>` eller `http://127.0.0.1:<port>`
  (lokal utvikling, `python3 -m http.server 8000`) → behold den originen.
- Alt annet → **alltid** `canonicalAppUrl()`.

Regelen feiler altså lukket, og gjør det fortsatt selv om en klient mot
formodning skulle kjøre på en annen host enn den kanoniske (en gammel fane
som ennå ikke har møtt redirecten).

**Mobilappen er ikke lokal utvikling.** Android-appen serverer de samme filene
fra WebView-ens egen innebygde server på `https://localhost` — https, uten
port ([`mobilapp-plan.md`](mobilapp-plan.md)). Formen over treffer den derfor
ikke, og en registrering eller passordgjenoppretting gjort *i appen* får den
kanoniske adressen i lenken, ikke en `localhost`-adresse som bare finnes inne
i appen. Lenken åpner Huskis i telefonens nettleser, ikke i appen — hvorfor, og
hva som skulle til for å endre det, står under «Auth-lenkene i e-post».

Brukes av de tre Supabase Auth-kallene som tar en returadresse:

| Kall | Sted | Opsjon |
|---|---|---|
| `auth.signUp` | registrering | `options.emailRedirectTo` |
| `auth.resetPasswordForEmail` | glemt passord | `options` (2. argument) → `redirectTo` |
| `auth.updateUser({ email })` | endre e-post (konto-modalen) | `options` (2. argument) → `emailRedirectTo` |

Innlogging (`auth.signInWithPassword`) tar ingen returadresse, og appen
bruker ikke magic links (`auth.signInWithOtp`) eller
`auth.admin.inviteUserByEmail` i det hele tatt — de tre kallene over er
uttømmende. `window.__huskis.authRedirectUrl`/`canonicalAppUrl` er eksponert
for nettlesertesting (`tests/auth-redirect.test.js`), som også verifiserer at
alle tre kallene faktisk sender riktig verdi — ikke bare at hjelpefunksjonen
regner riktig i isolasjon.

## Hvor Resend-mailenes base-URL konfigureres

Server-side, i `public.app_config` (Supabase SQL editor — ikke-hemmelig,
RLS-låst uten policyer/grants, kun lesbar for `send_invite_email()`):

```sql
insert into public.app_config(key, value) values
  ('email_from', 'Huskis <noreply@huskis.no>'),
  ('app_url',    'https://huskis.no/')
on conflict (key) do update set value = excluded.value;
```

`send_invite_email()` i `supabase/users-and-sharing.sql` leser `app_url`
derfra (faller tilbake til det hardkodede, kanoniske `https://huskis.no/`
hvis raden mangler — aldri en frontend-verdi, aldri en klientforespørsels
`Host`/`Origin`/`Referer`). Logo-URL-en (`https://huskis.no/assets/email/
huskis-logo-v1.png`) er en konstant i samme funksjon. Filnavnet bærer et
versjonsnummer med samme begrunnelse som `vendor/` og `assets/fonts/` (se
`docs/sikkerhetsheadere.md`): e-postklienter (særlig Gmails egen bilde-proxy)
cacher et bilde permanent per URL, også en mislykket henting — en ny fil under
samme filnavn kan derfor forbli «ødelagt» hos mottakere lenge etter at kilden
er fikset. Endres logoen, bytt filnavn (`-v2`, `-v3`, …) og oppdater alle fem
stedene URL-en er hardkodet (se under). Se `docs/arkitektur-
brukere-deling.md` for resten av e-postoppsettet (Vault, `email_send_log`,
escaping/prosentkoding).

## Supabase Auth: URL Configuration (Dashboard)

**Authentication → URL Configuration** hører til det kanoniske originet
alene:

- *Site URL*: `https://huskis.no` — fallback når et kall ikke sender en egen
  returadresse.
- *Redirect URLs*: kun `https://huskis.no/**` (+ `http://localhost:8000/**`
  hvis man tester ekte Supabase-e-post lokalt). Ingen oppføringer for
  `www.huskis.no` eller `huskis.vercel.app` — ingen klient kan kjøre der, og
  hver ekstra oppføring utvider bare listen over adresser en auth-lenke kan
  sendes til.

Dette er dashboard-konfigurasjon; den kan ikke leses eller skrives fra dette
repoet. Hele kjeden er kontrollert mot produksjon 2026-08-02 med en
midlertidig testbruker: registrering med `emailRedirectTo` → bekreftelses-
lenken svarer `303` til det kanoniske originet med `#access_token=…` og
`type=signup` i fragmentet → innlogging gir en gyldig sesjon. Auth-callbacken
lander altså kanonisk, med tokens i behold.

## Auth-e-postmalene (Supabase Dashboard)

Selve HTML-malene ligger KUN i Supabase Dashboard (Authentication → Email
Templates); ingen tilgjengelig verktøy kan lese eller skrive dem herfra.
Utkast med riktig utseende og riktige variabler er versjonert i
`supabase/email-templates/` — se
[README-en der](../supabase/email-templates/README.md) for hvilken fil som
hører til hvilket felt, og hvilke variabler hver mal faktisk har. Malene tas i
bruk ved å lime dem inn, ett felt om gangen.

**Handling og varsel er to forskjellige ting**, og forskjellen er ikke
kosmetisk:

| Type | Maler | Krav |
|---|---|---|
| *Authentication* (noen skal gjøre noe) | Confirm signup, Reset password, Change email address | **må** ha `{{ .ConfirmationURL }}` |
| *Security notification* (noe har skjedd) | Email address changed m.fl. | ingen lenke; sendes kun hvis sikkerhetsvarsler er på |

Havner varselteksten i en handlings-mal, mister den lenken — og da kan flyten
ikke fullføres i det hele tatt. Se README-en for detaljene.

Sjekkliste (Peder):

- [ ] Ingen mal hardkoder `huskekurv.vercel.app` (eller noe annet enn
      `{{ .ConfirmationURL }}`/`{{ .SiteURL }}`) som lenke.
- [ ] Standardlenken i hver *authentication*-mal bruker `{{ .ConfirmationURL }}`
      — IKKE en manuelt sammensatt `{{ .SiteURL }}«/noe»`, som ville overstyrt
      den `redirectTo`/`emailRedirectTo` klienten faktisk sender (se over).
- [ ] **Invite user** og **Magic link** er ikke i bruk (appen kaller verken
      `auth.admin.inviteUserByEmail` eller `auth.signInWithOtp` — bekreftet
      ved søk i `app.js`) — disse malene er irrelevante og kan ignoreres.
- [ ] Alle malene i bruk er **stilt likt** de formaterte Resend-e-postene:
      lim inn utkastene fra `supabase/email-templates/` i tilsvarende felt.
- [ ] Etter at alle fire feltene peker på `huskis-logo-v1.png`: fjern den
      uversjonerte `assets/email/huskis-logo.png` i en egen commit — den ligger
      der kun som kompatibilitet til Dashboard er oppdatert, se
      «Logo-filnavnet er versjonert» i `supabase/email-templates/README.md`.

En auth-lenke som mot formodning skulle peke til et alternativt domene, blir
uansett 308-et videre til `huskis.no` med `?code=`/`#access_token=` i behold
— redirecten er også et sikkerhetsnett for gamle e-poster i innboksene.

## Preview mot produksjon i klienten

To ting i appen må vite hvilken DEPLOY de kjører i — ikke bare hvilken vert. Én
kilde svarer på begge: `build.js` stempler `<meta name="huskis-deploy">` med
`VERCEL_ENV`, samme sted og samme steg som build-ID-en og release-ID-en
([`auto-update.md`](auto-update.md)):

| `VERCEL_ENV` | Stempel | Hva det betyr |
|---|---|---|
| `preview` | `preview` | en PR-/gren-deploy på sin egen flyktige adresse |
| `production` | `production` | produksjonsdeployen |
| (ikke satt) | `dev` | ubygget kildekode, et lokalt bygg eller CI |

Regelen er den samme som for testmodusen: **eksplisitt eller ikke i det hele
tatt.** Et miljø som ikke sier `preview` blir aldri lest som en preview.

**Web push leser stempelet** (`pushDeployAllowed()` i `app.js`). Et
push-abonnement hører til en nettleserkontekst på ET ORIGIN, så hver
preview-deploy kan legge igjen sitt eget abonnement på den ekte kontoen —
«enheter» i produksjonens liste som brukeren aldri har bedt om. Porten er derfor
stengt der, og åpen bare for:

- det kanoniske originet (`huskis.no`),
- de hostene som redirecter dit (`www.huskis.no`, `huskis.vercel.app`, det
  pensjonerte domenet) — de kjører aldri appen, men skal ikke være en
  spesialtilfelle-felle om noen en gang lander der,
- `localhost`/`127.0.0.1` — den lokale serveren og mobilappens WebView.

Alt annet er nei; regelen **feiler lukket**. Hostlisten skrives ikke opp på
nytt: den leses fra guardens `window.__huskisCanonical` (over), som er den ene
kilden. Semantikken for hva brukeren ser i varselpanelet ligger i
[`varsler.md`](varsler.md).

Porten rydder også opp etter seg: en forhåndsvisning som ble åpnet FØR porten
fantes, kan ha et abonnement og en service worker liggende, og det abonnementet
ville stått som en enhet i produksjonskontoens liste. Det rigges ned ved
oppstart, best effort. Semantikken ligger i [`varsler.md`](varsler.md)
(«Hvilke deployer som får melde seg på»).

`?mock=1` er upåvirket — preview-deployer BEHOLDER testmodusen, og
nettlesertestene kjører på `localhost`.

## Lokal utvikling

`python3 -m http.server 8000` → `location.origin` er `http://localhost:8000`,
som `authRedirectUrl()` eksplisitt gjenkjenner og beholder (se regelen over),
og som guarden i `index.html` aldri rører. Registrerings-/gjenopprettings-
lenker i en LOKAL Supabase-e-post peker altså til den lokale serveren, ikke
til `huskis.no` — forutsatt at Supabase-prosjektets Redirect URLs også
tillater `http://localhost:8000` (kun nødvendig hvis man faktisk tester ekte
Supabase-e-post lokalt; `?mock=1` trenger det ikke, se `docs/accounts.md`).

## Mobilappen

Android-appen kjører de innebygde filene fra `https://localhost`
([`mobilapp-plan.md`](mobilapp-plan.md)). Det originet er ikke navngitt noe
sted i frontend, og skal ikke være det:

- guarden i `index.html` rører kun de tre hostene den lister opp, så appen
  navigeres aldri ut av seg selv og over til `huskis.no`;
- `authRedirectUrl()` gjenkjenner den ikke som lokal utvikling, så auth-lenker
  fra appen peker på den kanoniske adressen (se regelen over);
- `update-check.js` henter `/version.json` rot-relativt, altså appens egen
  innebygde fil med appens egen build-ID ([`auto-update.md`](auto-update.md)).

## Eksterne lenker

**Huskis' UI genererer ingen utgående lenker.** Det finnes ikke én `<a>`-tagg
med en absolutt adresse og ikke ett `target="_blank"` i web-kildekoden.
Adressen i en notatlenke er den ENE tingen som kan sendes ut av appen, og den
går gjennom nøyaktig ett kall — se «Lenker i notater» under. De eneste
adressene utenfor eget origin som i det hele tatt står HARDKODET i frontend er
to, og ingen av dem er en navigasjon:

- **Supabase-endepunktet** (`config.js`) — data over `fetch`/WebSocket,
  navngitt i `connect-src` ([`sikkerhetsheadere.md`](sikkerhetsheadere.md));
- **`canonicalAppUrl`** (`config.js`) — bygges inn i returadressen Supabase
  Auth legger i e-postlenkene (se over). Klienten navigerer aldri dit.

Appen navigerer seg selv nøyaktig **ett** sted: `location.replace(target)` i
guarden øverst i `index.html`, og bare til det kanoniske originet, og bare fra
en av de tre navngitte redirect-hostene (se «Redirect til det kanoniske
originet»). I mobilappen er verten `localhost`, som ikke står på den lista, så
guarden gjør ingenting der — appen kan ikke navigere seg selv ut på nett.

### Lenker i notater

Notat-editoren har en **lenkeknapp** ([`notater-plan.md`](notater-plan.md)), og
den bryter ikke regelen over: en lenke i et notat er MERKET TEKST, ikke et
anker. Adressen bæres i `data-url` på et `<span class="note-link">`, vises i
`title`, og kan leses, endres, åpnes, kopieres og fjernes i lenke-panelet. Det
finnes altså fortsatt ikke én `<a href>` med en absolutt adresse i noe Huskis
rendrer, og `tests/external-links.test.js` — som ser i det FERDIGE DOM-et —
står urørt.

Adressen NORMALISERES når den lagres, i to lag: `safeNoteUrl()` fjerner
kontrolltegn, gir en adresse uten skjema `https:`, og slipper bare gjennom
`http:`, `https:` og `mailto:`. Alt annet — `javascript:`, `data:`, `blob:` —
blir tom streng, både på vei inn i tilstanden og igjen når dokumentet rendres.

#### Ankeret som forlater appen: clipboard-HTML-en

«Kopier alt» skriver notatet til utklippstavlen som `text/html`, og DER er
lenken et vanlig `<a href>` — ellers ville Word, Outlook og Google Docs fått
tekst uten lenke ([`notater-plan.md`](notater-plan.md), «Utklippstavlen»).
Regelen over står likevel: den strengen settes ALDRI inn i Huskis' eget DOM,
den går rett til utklippstavlen. Appens egne noder bærer fortsatt adressen i
`data-url`.

Ankeret skrives ett sted — `noteHtmlAnchor()` i `app.js` — og adressen går
gjennom `safeNoteUrl()` først, så en adresse med et skjema som kan kjøre kode
aldri forlater appen som en klikkbar lenke. Tekstvakten i
`tests/capacitor-android.test.js` fritar nøyaktig denne ene forekomsten, på
dette ene stedet, og KREVER at den finnes — som fritaket for `window.open`.
`tests/external-links.test.js` ser fra den andre kanten: DOM-et er fortsatt
uten `<a href>`, også etter en kopiering.

#### Å åpne en lenke: `openExternalUrl()`

Å åpne lenken går gjennom **ÉN funksjon i `app.js`**, og det er den eneste
veien ut av appen som finnes:

```js
openExternalUrl(raw)   // safeNoteUrl(raw)  →  window.open(url, '_blank', 'noopener')
```

- **Adressen normaliseres på nytt**, uansett hvor den kommer fra. En lagret
  `data-url` har alt vært gjennom `safeNoteUrl`, men en vakt som bare gjelder
  én vei inn er ingen vakt. `javascript:` blir tom streng og åpnes ikke.
- **Samme mekanisme i begge kjøremiljøene.** I nettleseren åpnes en ny fane,
  og `noopener` gjør at siden som åpnes ikke har noen referanse til Huskis'
  vindu. I mobilskallet står WebView-en med `supportMultipleWindows = false`
  (Capacitors standard), så `window.open` blir en vanlig navigasjon som går
  gjennom `shouldOverrideUrlLoading` → `Bridge.launchIntent()` — altså akkurat
  regelen under ([`mobilapp-plan.md`](mobilapp-plan.md)).
- **Returverdien sier ingenting.** Med `noopener` svarer `window.open` alltid
  `null` (HTML-standarden), så den kan ikke brukes til å oppdage en
  popup-blokkering. Å felle en feilmelding på den ville løyet hver gang.

**Veiene inn dit** er tre, og alle tre gir den samme normaliseringen:
lenke-panelets «Åpne», `Cmd`/`Ctrl`-klikk på en lenke i et redigerbart notat,
og et vanlig klikk (eller `Enter`) i et SKRIVEBESKYTTET notat, der det ikke er
noe å redigere og lenkene derfor er tabbstopp
([`tilgjengelighet.md`](tilgjengelighet.md)).

**Vakten er justert, ikke fjernet.** `tests/capacitor-android.test.js` del 12
forbød `open()` i enhver form. Nå har den ett unntak, og unntaket er knyttet
til STEDET: nøyaktig én forekomst, i `app.js`, skrevet nøyaktig
`window.open(url, '_blank', 'noopener')`, inne i `openExternalUrl`, med
`safeNoteUrl` foran seg. Testen KREVER dessuten at unntaket ble brukt — én
gang i kilden, én gang i `dist/`, én gang i den synkede builden — så åpningen
kan verken forsvinne eller få selskap uten at noen tar beslutningen om igjen.

### Regelen

Regelen gjelder uansett hvem som en gang måtte legge inn en lenke, og er
bevisst kort:

| Adresse | Hvor den åpnes |
|---|---|
| Appens eget origin — `https://huskis.no` i browseren, `https://localhost` (de innebygde filene) i mobilappen | **i appen** |
| Alt annet | **ut av appen** — aldri inne i WebView-en |

«Ut av appen» og ikke «i systembrowseren», fordi Android sender adressen til
telefonens standardapp FOR DEN adressen: browseren for `http(s):`, men
e-postklienten for `mailto:`, telefonappen for `tel:`, kartappen for `geo:`.
Poenget er det samme uansett hvilken app som svarer — siden lastes ikke inne i
Huskis.

Tre ting faller utenfor det «alt», og de er listet under «Tre unntak» —
`<iframe>`, POST-skjemaer og `data:`/`blob:`.

Ingen fremmed adresse skal lastes inne i mobilappens WebView. Faren er ikke at
den ville lest Huskis' data: Web Storage er origin-skilt, så en side lastet fra
`example.com` får sitt eget `localStorage` og når hverken vårt eller
Supabase-sesjonen — å dele WebView gir ingen tilgang på tvers av origin. Det som
derimot følger med, er **Capacitor-broen**. Den injiseres i WebView-en, ikke i
et bestemt origin, så en fremmed side som lastes der kan kalle de native
plugin-ene appen har. Derfor er en side som lastes der ikke et «faneskifte»,
den er innsiden av appen.

**«Eget origin» med ett forbehold.** Capacitors sammenligning er skjema + vert,
ikke fullt origin: PORTEN teller ikke. `https://localhost:8443` ville derfor
blitt liggende inne i WebView-en, selv om det er et annet origin enn appens
`https://localhost`. Det er teoretisk i dag — appen navngir ingen slik adresse,
og vakten flagger enhver ny — men regelen skal ikke love mer enn mekanismen
holder.

**Hvem som håndhever det.** Ingen — i betydningen: ingen Huskis-kode.
Capacitors egen `BridgeWebViewClient.shouldOverrideUrlLoading()` sender hver
navigasjon videre til `Bridge.launchIntent()`, som slipper `data:`/`blob:` og
adresser med appens eget skjema+vert gjennom til WebView-en, og sender alt
annet ut som en `Intent.ACTION_VIEW` — altså til telefonens standardapp for
adressen, normalt systembrowseren. Det er nøyaktig regelen over, og den er
gratis: ingen native plugin, ingen gate i webkoden, ingen linje å vedlikeholde.
Web-laget kjenner derfor fortsatt native-runtimen på bare ÉN linje (broen for
tilbakeknappen, [`mobilapp-plan.md`](mobilapp-plan.md)).

**Det ene som kan slå regelen av** er `server.allowNavigation` i
`capacitor.config.json`: hver oppføring der er en vert `launchIntent()` slipper
INN i WebView-en i stedet for ut. Feltet skal stå tomt.
`tests/capacitor-android.test.js` vokter både det og at web-kildekoden ikke
begynner å produsere utgående lenker.

**Tre unntak fra ordet «alt».** Rutingen avgjør bare det WebView-en spør den
om, og `launchIntent()` slipper dessuten én kategori gjennom med vilje. Regelen
over ville vært for bastant uten disse tre:

| Unntak | Hva som faktisk skjer | Hvem som dekker det |
|---|---|---|
| **`<iframe>`** | Rutingen ser aldri en innramming | `default-src 'none'` uten `frame-src` ⇒ ingen ramme kan laste noe |
| **Skjema sendt med POST** | En POST-innsending rapporteres ikke å nå `shouldOverrideUrlLoading` — svaret ville lastet inne i WebView-en | `form-action 'self'` ⇒ et skjema kan bare sendes til eget origin, POST som GET |
| **`data:` og `blob:`** | `launchIntent()` returnerer eksplisitt `false` for disse: de BLIR i WebView-en | Appen navigerer aldri til en slik adresse — den bruker dem bare til bilder. Vakten flagger et hvilket som helst skjema i `href`/`action`, `data:` inkludert. Se under: at vi lagde URL-en gjør ikke innholdet trygt |

De to første står i policyen
([`sikkerhetsheadere.md`](sikkerhetsheadere.md)) og er voktet av
`tests/security-headers.test.js`. Poenget er hvem som dekker hva: for disse tre
er det ikke Capacitors ruting.

`data:`/`blob:` er verdt et ord til, siden appen faktisk BRUKER dem — avatarbilder
lages som blob/data-URL-er, og `img-src 'self' data: blob:` tillater nettopp
det. Et **bilde** er en ressurs, ikke en navigasjon, og det er hele dagens bruk.

At Huskis lager adressen gjør derimot IKKE innholdet trygt. En `data:`- eller
`blob:`-URL bygget av tekst brukeren har skrevet, eller av noe hentet fra
nettet, er fremmed innhold i appens innpakning — og siden `launchIntent()`
slipper begge gjennom, ville et slikt dokument blitt det aktive dokumentet inne
i WebView-en, med Capacitor-broen tilgjengelig (en `blob:`-URL beholder dessuten
originet til den som lagde den). Skulle appen en gang NAVIGERE til en slik
adresse, er kravet derfor at nyttelasten er uavhengig etterprøvd — ikke at vi
lagde URL-en.

(At POST ikke når `shouldOverrideUrlLoading` er lest, ikke observert på en
enhet. Det endrer ingenting så lenge `form-action` står — men skulle det
direktivet noen gang løsnes, er dette hullet det slipper løs.)

### Auth-lenkene i e-post

De kommer fra utsiden og røres ikke av regelen over: brukeren trykker i
e-postklienten, og telefonen gir adressen til standardappen for DEN adressen.
Hvilken app det blir avgjøres av **verten i lenken brukeren faktisk trykker
på** — og den er ikke `huskis.no` i tre av de fire e-postene Huskis sender:

| E-post | Verten i lenken | Hva som skjer på telefonen |
|---|---|---|
| Bekreft registrering (`signUp`) | `<prosjekt>.supabase.co/auth/v1/verify?…&redirect_to=https://huskis.no/` | browseren åpner, tokenet verifiseres, og svaret er 303 til `huskis.no/#access_token=…&type=signup`. Kontoen ER bekreftet; sesjonen havner i browseren, og appen står igjen ulogget. Brukeren går tilbake og logger inn med passordet sitt. |
| Tilbakestill passord (`resetPasswordForEmail`) | samme verify-adresse, `type=recovery` | browseren åpner, `PASSWORD_RECOVERY` fyrer DER, og det nye passordet settes i browseren. Appen merker ingenting; neste innlogging i appen bruker det nye passordet. |
| Bekreft ny e-postadresse (`updateUser({ email })`) | samme verify-adresse, `type=email_change` | adressen byttes serverside, i browseren. Appens sesjon fortsetter uendret. |
| Delingsinvitasjon (Resend, `send_invite_email()`) | `https://huskis.no/` til en REGISTRERT mottaker, `https://huskis.no/?signup=<e-post>` til en uregistrert | peker rett på det kanoniske originet, men bærer ingen sesjon. Til en registrert mottaker er dette det ene tilfellet der App Links ville gitt mer enn en spart innlogging: er brukeren logget inn i APPEN og ikke i browseren, åpner lenken i dag en utlogget browser, mens appen har sesjonen som faktisk kan vise og godta invitasjonen. |
| Varsel om endret adresse (*Email address changed*) | ingen handlingslenke — men fotnoten i begge språkseksjonene ankrer `https://huskis.no/` | et varsel, ikke en handling: den skal bare ta en bruker som ikke kjenner seg igjen til innloggingssiden, der «Glemt passord?» står. |

De to nederste er altså de eneste som peker rett på `huskis.no`, og ingen av
dem bærer en sesjon. «Ingen lenke» om varselet i «Auth-e-postmalene» under
betyr ingen HANDLINGSlenke (`{{ .ConfirmationURL }}`) — fotnotens anker er noe
annet.

**Ingen av de tre første er ødelagt av å havne i browseren.** Hele handlingen
fullføres der. For registrering og passordgjenoppretting er det appen mangler
sesjonen, og prisen er én ekstra innlogging. Adressebyttet koster ikke engang
det: det starter fra en app som allerede er innlogget, og den sesjonen
fortsetter uendret. At det ikke er verre henger på flyttypen: klienten lar
`flowType` stå på supabase-js' standard `implicit`
(`ensureClient()` i `app.js` setter den ikke), så tokenene kommer i
FRAGMENTET. Var flyten PKCE, ville lenken båret en `?code=` som må byttes inn
med en verifikator lagret i originet som STARTET flyten — og en registrering
startet i appen (`https://localhost`) kunne da ikke fullføres i browseren
(`huskis.no`) i det hele tatt. Skrus PKCE på, er det denne seksjonen som må
leses først.

#### Android App Links: hvorfor ikke ennå

App Links ville latt telefonen sende lenken til Huskis i stedet for til
browseren. Mekanismen har to halvdeler i hvert sitt system, pluss en tredje som
er lett å overse:

1. **manifestet** — et `<intent-filter android:autoVerify="true">` på
   `MainActivity` med `VIEW`/`BROWSABLE` og `<data android:scheme="https"
   android:host="huskis.no">`;
2. **originet** — `https://huskis.no/.well-known/assetlinks.json`, som må
   navngi `no.huskis.app` og **SHA-256 av signeringsnøkkelen**. Fila er
   repo-eid på samme måte som redirect-reglene: Vercel serverer `dist/`, og
   `dist/` er det `build.js` kopierer (se «Vercel-konfigurasjonen»);
3. **at fila faktisk blir publisert** — `copyDir()` i `build.js` hopper over
   hvert navn som starter med punktum, så en `.well-known/`-katalog i repoet
   havner i dag ikke i `dist/`. Den dagen halvdelene innføres, må `build.js`
   slippe katalogen gjennom i samme endring.

**Hvem 303-en havner hos, er et ÅPENT spørsmål.** Verten i lenken brukeren
trykker på er `*.supabase.co`, og der kan vi ikke legge et statement — det
originet er ikke vårt. Et intent-filter for `huskis.no` ser altså ikke selve
tappet. Men lenken ENDER på `https://huskis.no/#access_token=…`, og en verifisert
App Link kan bli plukket opp der: det er nøyaktig mekanismen native
OAuth-klienter på Android bygger på (RFC 8252/AppAuth bruker en `https`-
redirect-URI som er en App Link, og leverandøren redirecter til den). Om
Chrome faktisk leverer fra seg på slutten av en redirect-kjede startet av et
tapp i e-postklienten — og om fragmentet følger med — kan ikke avgjøres herfra.
Det avhenger av browser og av brukerens «åpne som standard»-innstilling, og
skal PRØVES på telefon i fase 6 før noe bygges rundt svaret.

Konsekvensen av svaret er stor nok til å si eksplisitt: **holder redirect-veien,
trengs verken nye maler eller `verifyOtp()`** — `{{ .ConfirmationURL }}` og
dagens implicit-fragment kan stå som de er, og det som gjenstår er lytteren,
statementet og nøkkelen. Holder den ikke, må lenken flyttes til `huskis.no`
allerede i e-posten, og da kommer de to første punktene under i tillegg.

De to nederste radene i tabellen — delingsinvitasjonen og fotnoten i varselet —
blir fanget uansett hvordan det spørsmålet faller ut, siden de peker rett på
`huskis.no`. De er også de to som ikke bærer noen sesjon: appen ville åpnet på
startsiden sin, som er det browseren gjør i dag.

Endringene App Links krever er altså **fire sikre og to betingede**:

- intent-filteret på `MainActivity` (de tre punktene over: `autoVerify`,
  `VIEW`/`DEFAULT`/`BROWSABLE`, `https` + `huskis.no` uten sti- eller
  portbegrensning);
- statementet på originet;
- unntaket i `copyDir()` som faktisk får det publisert — selektivt, ellers
  følger `.gitignore` og hver annen skjult fil med ut;
- lytteren som leser den innkommende adressen (punktet under);
- *betinget* — malene måtte bygge lenken selv av `{{ .TokenHash }}` i stedet for
  `{{ .ConfirmationURL }}` — det motsatte av regelen i
  [`supabase/email-templates/README.md`](../supabase/email-templates/README.md),
  og malene ligger i Supabase Dashboard;
- *betinget* — klienten måtte løse inn tokenet selv
  (`verifyOtp({ token_hash, type })`) i stedet for å la supabase-js lese
  fragmentet;
- appen måtte fange den innkommende adressen — og i BEGGE retninger.
  `@capacitor/android` tar vare på intent-URI-en (`Bridge.getIntentUri()`) og
  varsler plugins ved `onNewIntent`, men INGEN kjerneplugin leser den: uten
  `@capacitor/app` åpner en App Link bare Huskis på startsiden, og hele
  adressen forsvinner. Merk at en `appUrlOpen`-lytter ALENE ikke er nok: tappes
  lenken mens appen er stoppet — det vanlige når man kommer fra e-post — ligger
  adressen i aktivitetens FØRSTE intent, ikke i en ny. Kaldstarten må leses for
  seg (`App.getLaunchUrl()`). Det ville
  kostet en native plugin og **en gate til** i web-koden. Uten den biten er et
  intent-filter dessuten et TAP mot i dag, ikke bare en uteblitt gevinst:
  delingsinvitasjonen lenker til `/?signup=<e-post>`, og `applySignupInvite()`
  i `app.js` leser den verdien fra `location.search` — en invitert bruker ville
  mistet registreringsflyten sin til en app som åpner på startsiden;
- signeringsnøkkelen måtte finnes for en RELEASE. Debug-APK-en er signert med
  Androids automatisk genererte debugnøkkel, og CI-runnerne er flyktige, så det
  finnes ikke ett fingeravtrykk som er stabilt på tvers av bygg
  ([`mobilapp-plan.md`](mobilapp-plan.md)).

  Det betyr derimot IKKE at ingenting kan prøves før fase 6: debugkeystoren på
  ÉN maskin er stabil, og fingeravtrykket derfra kan publiseres midlertidig i
  statementet, slik at verifiseringen faktisk kjøres på en telefon. Prisen er at
  `huskis.no` da offentlig autoriserer en debugnøkkel så lenge fila står der —
  et bevisst, tidsavgrenset eksperiment, ikke noe som skal bli stående. Det er
  denne veien det åpne redirect-spørsmålet over kan besvares, om svaret trengs
  før fase 6.

**Beslutningen: App Links utsettes til fase 6**, sammen med signeringsnøkkelen.
De fire sikre endringene er uansett bundet til den fasen, og det åpne
redirect-spørsmålet avgjøres best der det kan prøves: på en telefon. Da vurderes
gevinsten (én spart innlogging i de to auth-flytene som koster en, pluss
invitasjonen til en registrert mottaker) mot fire eller seks koblede endringer,
alt etter hvordan spørsmålet faller ut. iOS Universal Links har nøyaktig den
samme strukturen (`apple-app-site-association` i stedet for `assetlinks.json`)
og hører til fase 7.

Inntil da er regelen at halvdelene aldri innføres hver for seg — og det er verre
enn stille:

Verifiseringen av `autoVerify` mot originet har fantes siden Android 6; det
Android 12 endret er KONSEKVENSEN av at den slår feil:

- **fra Android 12** blir appen ikke tilbudt i det hele tatt når verifiseringen
  feiler. Lenken åpner browseren nøyaktig som før, uten at noe sier fra;
- **på Android 7–11** (appens `minSdk` er 24) faller et feilet filter tilbake
  til vanlig dyplenke-oppslag. Brukeren kan da få en app-velger, eller ha satt
  Huskis som standard for domenet — og da BLIR lenken åpnet i appen. Uten
  lytteren forsvinner `?signup=`, altså en synlig regresjon for de brukerne,
  ikke bare en uteblitt gevinst.

`tests/capacitor-android.test.js` (del 13) er vakten, og den dekker de fire
sikre punktene over.

### URL-er i brukerens egen tekst

Skriver noen `https://…` i navnet på et listepunkt, vises det som ren tekst.
Det er **ikke** klikkbart, og det forblir det inntil videre: å gjøre det
klikkbart er en produktendring med egne spørsmål (autolinking-heuristikk,
hvordan det spiller med inline-redigering og dra-og-slipp, `rel`-attributter),
ikke en native integrasjon. Beslutningen her er bare hvor en slik lenke ville
havnet den dagen den lages — systembrowseren, etter tabellen over, uten ny
native kode. Vakten i `tests/capacitor-android.test.js` feiler hvis noen legger
inn en utgående lenke uten å komme innom denne seksjonen.

## Vercel-konfigurasjonen

Redirect-reglene er **repo-eid**: de ligger i `vercel.json` og deployes med
appen, ikke i dashbordet. Endres de, endres de her.

Det samme gjelder alt `huskis.no` SERVERER: Vercel publiserer `outputDirectory`
= `dist/`, og `dist/` er nøyaktig det `build.js` kopierer. Skal originet svare
på en ny sti — for eksempel `/.well-known/assetlinks.json` — er det `build.js`
som må legge fila der, ikke en dashbord-innstilling.

Domenene må være koblet til `huskis`-prosjektet for at reglene skal gjelde —
en regel i et prosjekts `vercel.json` virker kun for prosjektets egne
domener. Prosjektet `huskis` har `huskis.no`, `www.huskis.no`,
`huskis.vercel.app`, `huskekurv.vercel.app` + to interne
`-peohols-projects.vercel.app`-aliaser. Alle domenene reglene navngir peker
altså hit.

### `huskis.no` må servere, ikke redirecte

Vercel har et redirect-lag FORAN deployen: hvert domene i prosjektet kan settes
opp til å redirecte til et annet (Settings → Domains → *Redirect to*). Det laget
treffer før `vercel.json` i det hele tatt leses.

**`huskis.no` skal derfor stå på «No Redirect».** Settes apex opp til å
redirecte til `www.huskis.no` — standardvalget når `www` er primærdomene — får
man en evig løkke: apex sender til `www` på domenenivå, og `www` sender tilbake
til apex via regelen i `vercel.json`. Nettleseren gir
`ERR_TOO_MANY_REDIRECTS`, og HELE appen er nede.

Ingen test kan fange dette: domenekonfigurasjonen ligger i Vercel, ikke i
repoet. Endrer noen primærdomene, må `www`-regelen i `vercel.json` fjernes i
samme slengen (eller apex settes tilbake til «No Redirect»). `www` kan gjerne
stå på «Redirect to huskis.no» i tillegg til regelen her — samme retning,
ingen løkke.

### Verifisere

Med Vercel CLI (krever `vercel login`):

```bash
vercel domains ls --scope peohols-projects      # hvilke domener prosjektet har
vercel deploy --prod                            # deployer vercel.json med appen
```

Selve redirecten sjekkes med en vanlig HTTP-forespørsel — statuslinjen og
`location` er hele svaret:

```bash
curl -sI "https://huskis.no/version.json"           # HTTP/2 200   ← apex SERVERER
curl -sI "https://www.huskis.no/en/side?a=1"        # HTTP/2 308 → https://huskis.no/en/side?a=1
curl -sI "https://huskis.vercel.app/?code=x"        # HTTP/2 308 → https://huskis.no/?code=x
curl -sI "https://huskekurv.vercel.app/"            # HTTP/2 308 → https://huskis.no/
```

Alle fire er kontrollert mot produksjon 2026-08-02: apex serverer, de tre andre
svarer 308 med path og query i behold — også `?code=`.

Produksjonsdeployen kjøres normalt ikke manuelt: `.github/workflows/release.yml`
gjør `vercel deploy --prod` etter migrering + smoke-test
(`docs/release-og-deploy.md`).

## Det gamle domenet (`huskekurv.vercel.app`)

**Bakgrunn:** Huskis-prosjektet på Vercel het opprinnelig `huskekurv` og ble
senere omdøpt til `huskis`. Et Vercel-prosjekts `<navn>.vercel.app`-alias
følger gjeldende prosjektnavn — det gamle aliaset frigis normalt ved
omdøping, det flyttes ikke automatisk.

Domenet er koblet til `huskis`-prosjektet igjen, og 308-regelen for det er
aktiv på samme måte som for de to andre — kontrollert mot produksjon
2026-08-02: `https://huskekurv.vercel.app/en/liste?code=abc123` svarer 308 til
`https://huskis.no/en/liste?code=abc123`.

## Testene

- `tests/devices-sessions.test.js` — preview-porten for web push, KJØRT i den
  ekte appen: produksjonsdomenet og `huskis.vercel.app` slipper gjennom, en
  flyktig `huskis-*-peohols-projects.vercel.app` gjør det ikke, `localhost` er
  åpen, og et `preview`-stempel stenger porten uansett host. Stempelet settes
  ved å skrive om HTML-en i transporten — nøyaktig slik `build.js` gjør det —
  ikke i DOM-et etterpå, som ville kappløpt med parseren. Del 12 dekker
  opprydningen av et abonnement som lå der fra før.
- `tests/build-version.test.js` — at `build.js` stempler `huskis-deploy` med
  `VERCEL_ENV`, og at et ukjent miljø blir `dev`.
- `tests/canonical-origin.test.js` — 308-reglene i `vercel.json` (én per
  domene, path bevart, ingen løkke, preview-adresser urørt), at guarden i
  `index.html` står før alt som kjører, at de to lagene navngir de samme
  domenene, `redirectUrlFor()` for path/query/fragment (inkl. auth-parametere)
  og en ekte navigasjon fra `www.huskis.no` som lander kanonisk uten
  historikk-oppføring.
- `tests/auth-redirect.test.js` — `authRedirectUrl()`/`canonicalAppUrl()`
  for kjente og ukjente origins (inkl. det gamle domenet som negativt
  testtilfelle), trailing-slash-normalisering, at `window.HUSKIS_CONFIG` kun
  navngir det kanoniske domenet, og at
  `signUp`/`resetPasswordForEmail`/`updateUser({ email })` faktisk sender den
  beregnede verdien.
- `supabase/tests/test-email-sharing.sql` — genererte Resend-e-poster
  bruker kanonisk `huskis.no` (ikke `www`) og inneholder aldri det gamle
  domenet.
- `tests/external-links.test.js` — den KJØRENDE vakten: appen lastes i en ekte
  nettleser, og det ferdige DOM-et sjekkes for destinasjoner utenfor eget
  origin. Der spiller stavemåten ingen rolle, så den fanger også markup satt
  sammen av strengbiter — det en tekstvakt aldri kan love. Den bekrefter også
  at en URL i et listepunkt forblir ren tekst.
- `tests/capacitor-android.test.js` — eksterne lenker: `allowNavigation` står
  tomt (ingen fremmed vert kan lastes INNE i WebView-en), det native skallet
  overtar ikke navigasjonsrutingen fra Capacitor, web-kildekoden produserer
  ingen utgående lenke — i markup `href`/`action`/`formaction` med et hvilket
  som helst skjema eller protokoll-relativ verdi, pluss `target="_blank"` og
  `window.open()`; fra JS er en destinasjon satt gjennom DOM-et
  (`setAttribute('href', …)`, `el.href = …`) forbudt UANSETT verdi, siden appen
  ikke setter én eneste i dag og en variabel ellers ville sluppet forbi. Den ENE
  navigasjonen appen gjør er guardens `location.replace(target)` — alle former
  for tilordning teller, også `location = …` og `document.location = …`. Den
  låser dessuten hvilke fremmede adresser frontend hardkoder til nøyaktig to
  (Supabase-endepunktet og det kanoniske originet), slik at en ny utgående
  adresse må innom denne seksjonen uansett hvilket API den brukes gjennom.
  Skanningen dekker beviselig alle produksjonskildene: lista over filer låses
  mot det `index.html` faktisk laster. Del 13 vokter App Links-halvdelene:
  intent-filteret i manifestet og `assetlinks.json` på originet innføres sammen
  eller ikke i det hele tatt, og et statement som ikke havner i `dist/` felles
  som det det er — en påstand `huskis.no` aldri kommer til å svare på.
- `tests/no-legacy-domain.test.js` — repo-vid tekstvakt: feiler dersom
  `huskekurv` dukker opp utenfor en eksplisitt, begrunnet unntaksliste
  (negative tester, denne fila, `TODO.md`, og de to redirect-kildene
  `vercel.json` + `index.html`). At navnet i `index.html` kun står inne i
  guardens hostliste — som redirect-kilde, aldri som en lenke — sjekkes av
  `tests/canonical-origin.test.js`.
