# Sikkerhetsheadere og innholdssikkerhetspolicy

Huskis er en statisk app uten server-side rendering: hele forsvaret mot injisert
kode, innramming og eksfiltrering ligger i responsheaderne og i hvilke
tredjeparter appen i det hele tatt har lov til å snakke med. Filene:
`vercel.json` (headerne i produksjon), `index.html` (den samme policyen som
`<meta>`), `styles.css` + `assets/fonts/` (den selvhostede webfonten),
`vendor/` (de lokale kopiene av Supabase, Smett og Yjs), `build.js` (fjerner testmodusen fra
deployen), `tests/security-headers.test.js` + `tests/csp-enforced.test.js`.

## Hvorfor policyen står to steder

| Sted | Gjelder | Innhold |
|---|---|---|
| `vercel.json` → `source: "/(.*)"` | produksjon og preview-deployer | hele policyen, inkludert `frame-ancestors` |
| `<meta http-equiv="Content-Security-Policy">` i `index.html` | ALLE miljøer, også `python3 -m http.server` og nettlesertestene | samme policy, uten `frame-ancestors` |

Den lokale serveren sender ingen HTTP-headere. Sto policyen bare i `vercel.json`,
ville den først blitt håndhevet i produksjon — der en feil koster en hvit skjerm
for alle. Meta-taggen gjør at hver eneste nettlesertest kjører under den ekte
policyen. `frame-ancestors` virker kun som header og utelates derfor fra
meta-taggen (den ignoreres der uansett).

De to må være **nøyaktig samme policy**: produksjon får begge, og to policyer
håndheves som snittet av dem, så en utakt gir en strengere policy enn noen har
bestemt. `tests/security-headers.test.js` sammenligner dem direktiv for direktiv.

Meta-taggen står **før den første `<script>`** — ellers ville guarden for
kanonisk origin kjørt utenfor policyen. Kun `<meta charset>` står foran, og den
kjører ikke kode.

## Policyen, direktiv for direktiv

```
default-src 'none';
base-uri 'none';
object-src 'none';
script-src 'self' 'sha256-…';
style-src 'self' 'sha256-…';
font-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://<prosjekt>.supabase.co wss://<prosjekt>.supabase.co https://huskis.no;
worker-src 'self';
form-action 'self';
frame-ancestors 'none'          ← kun som HTTP-header
```

`default-src 'none'` er bunnplaten: alt som ikke er nevnt eksplisitt, er
blokkert. Policyen inneholder verken `'unsafe-inline'`, `'unsafe-eval'`,
`'strict-dynamic'` eller `*`.

### De dokumenterte unntakene

Hvert unntak fra `'self'` står her fordi appen faktisk trenger det:

| Unntak | Hvorfor | Hva som skal til for å fjerne det |
|---|---|---|
| `script-src 'sha256-…'` | Guarden for kanonisk origin i `index.html` MÅ kjøre inline, før alt annet — se [`domains-and-urls.md`](domains-and-urls.md). En ekstern fil ville kostet en rundtur før redirecten. | flytte guarden til en egen fil og godta forsinkelsen |
| `style-src 'sha256-…'` | Dra-og-slipp-motoren (dnd-kit, gjennom Smett) injiserer ETT stilark mens et drag pågår: reglene som løfter objektet inn i top layer og posisjonerer det. Uten dem ligger det løftede objektet i normal flyt og følger ikke fingeren. Arket lages i kjøretid, så en fil er ikke et alternativ — en hash av nøyaktig det arket er. Se under. | at dnd-kit slutter å injisere stil (upstream) |
| `img-src data:` | Avatarbilder lagres som `data:image/jpeg`-URL-er på brukerens profil. | flytte avatarene til Supabase Storage |
| `img-src blob:` | Avatarredigereren tegner den valgte filen via `URL.createObjectURL` i nettlesere uten `createImageBitmap`. | droppe reserveløsningen |
| `connect-src wss://…` | Realtime (`postgres_changes`) går over WebSocket. | — (kreves) |
| `connect-src https://huskis.no` | OTA-manifestet ([`mobilapp-plan.md`](mobilapp-plan.md), fase 5): inne i APK-en er `'self'` det INNEBYGDE originet (`https://localhost`), og web-laget leser `/ota/android/<versionCode>.json` fra det kanoniske originet. I browseren, der appen alt kjører på `https://huskis.no`, er verten allerede dekket av `'self'` — tillegget endrer ingenting der. | fjerne OTA-flyten |

Appen laster altså ingenting fra en tredjepart: skriptene, stilarket og
fontfilene ligger alle på eget origin, og de eneste adressene i hele policyen
utover eget origin er Supabase og appens eget kanoniske origin — begge står kun
i `connect-src`.

`connect-src 'self'` dekker oppdateringssjekkens `GET /version.json`
([`auto-update.md`](auto-update.md)). `form-action 'self'` er med fordi
skjemaene i appen (innlogging, navn, e-post, passord) sendes med JavaScript og
`preventDefault()`; en injisert `<form action="https://…">` kommer ingen vei.

`worker-src 'self'` er skrevet ut selv om `script-src` ville dekket det gjennom
CSP-ens tilbakefallskjede. Direktivet gjelder én ting og bare én: service
workeren `sw.js`, som registreres når brukeren slår på varsler i nettleseren
([`varsler.md`](varsler.md)). Skrevet ut står regelen der noen som leter etter
den ser den, i stedet for å måtte utlede den fra en fallback — og en senere
endring i `script-src` kan ikke stille åpne eller stenge for arbeidere.

Service workeren gjør ingen forespørsler: den har ingen `fetch`-lytter, ingen
cache og ingen nettverkskall, bare `showNotification` og `clients`. Den utvider
altså ikke policyen med noe som helst. Selve pushen kommer INN gjennom
nettleserens egen pushtjeneste og er ikke en forespørsel siden gjør, så den er
ikke CSP-ens bord; avsendernøkkelen i `config.js` er en offentlig VAPID-nøkkel og
ikke en adresse ([`varsler.md`](varsler.md), «Nøkkelparet»).

### OTA-manifestet leses på tvers av origin — derfor har det en CORS-header

CSP-verten over er bare den ene halvdelen av at APK-en får lese manifestet.
Lesningen er en cross-origin-forespørsel (`https://localhost` →
`https://huskis.no`), og da krever nettleseren i tillegg at SVARET eksplisitt
tillater det: uten `Access-Control-Allow-Origin` slipper forespørselen ut
gjennom CSP-en, men svaret blokkeres av CORS — samme stille feil, ett lag
lenger ut. `vercel.json` setter derfor `Access-Control-Allow-Origin: *` på
nøyaktig `/ota/android/(.*)`:

- manifestet er offentlige, ukredensierte, statiske data — det navngir den
  releasen alle skal på, og `*` gir ingen tilgang noen ikke allerede har ved å
  hente URL-en selv;
- `*` sender aldri cookies eller andre credentials med (nettlesere avviser
  kombinasjonen), så headeren kan ikke gjøre en autentisert forespørsel mulig;
- ingen andre stier får headeren. Bundlene (`/ota/bundles/`) trenger den ikke:
  nedlastingen skjer i NATIV kode (OkHttp i pluginen), utenfor både WebView-ens
  CSP og CORS ([`mobilapp-plan.md`](mobilapp-plan.md), fase 5).

`tests/release-pipeline.test.js` låser headeren sammen med cache-reglene for de
samme stiene.

### Stilarket dra-og-slipp-motoren injiserer

dnd-kit legger et `<style>`-element først i `<head>` idet et drag starter, og
tar det bort igjen etterpå. Innholdet er reglene for `[data-dnd-dragging]` og
`[data-dnd-placeholder]` — `position: fixed`, `top`/`left` fra egne
custom-properties, top layer via `popover`. Det er selve posisjoneringen av det
løftede objektet, og blokkeres arket, blir objektet liggende i flyten uten at
noe annet feiler: draget «virker», men ingenting følger fingeren.

To ting gjør at det bare er ÉN hash der, ikke tre:

- `Cursor` og `PreventSelection` — to dnd-kit-plugins som injiserer hvert sitt
  lille ark (`* { cursor: grabbing }` og `* { user-select: none }`) — er meldt
  av i `app.js`. Huskis maler begge deler selv, fra `body.is-dragging`.
- Den vendorede kopien av Smett er byte for byte låst (se over), så teksten i
  arket er den samme hver gang.

Hashen kan ikke regnes ut fra kildekoden: teksten settes sammen inne i
biblioteket. `tests/csp-enforced.test.js` gjør det i stedet i en ekte nettleser
— den kjører et EKTE nav-drag, fanger arket motoren injiserte, regner ut
SHA-256 og krever at akkurat den står i `style-src`. Driver teksten (en ny
Smett-kopi, en ny dnd-kit-versjon), er det den testen som sier fra. Ny hash
kommer fra den samme testen; verdien skal inn **begge** steder, meta-taggen i
`index.html` og `Content-Security-Policy` i `vercel.json`.

`tests/security-headers.test.js` vokter formen: `style-src` skal være eget
origin pluss nøyaktig én hash, og ingenting annet.

### Endrer du guarden

Hash-en i `script-src` er SHA-256 av innholdet i inline-blokken, nøyaktig som den
står — også blanktegnene. Endres guarden uten at hash-en oppdateres, slutter
appen å laste. `tests/security-headers.test.js` regner hash-en ut på nytt fra
`index.html` og sammenligner, så feilen kommer i CI i stedet for i produksjon.
Ny hash:

```bash
node -e 'const f=require("fs"),c=require("crypto");const m=/<script>([\s\S]*?)<\/script>/.exec(f.readFileSync("index.html","utf8"));console.log("sha256-"+c.createHash("sha256").update(m[1],"utf8").digest("base64"))'
```

Verdien skal inn **begge** steder: meta-taggen i `index.html` og
`Content-Security-Policy` i `vercel.json`.

## De øvrige headerne

Alle settes på `source: "/(.*)"`, altså på hver eneste respons.

| Header | Verdi | Hvorfor |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | nettleseren skal aldri gjette innholdstype — en opplastet fil kan ikke bli til et skript |
| `Referrer-Policy` | `no-referrer` | adressene i appen kan inneholde invitasjons- og auth-parametere; ingenting av det skal følge med en lenke ut |
| `Permissions-Policy` | tom allowlist `()` for kamera, mikrofon, posisjon, betaling, USB, MIDI, sensorer m.m. | appen ber aldri om noen av dem; alt som ikke er nevnt beholder nettleserens standard |
| `X-Frame-Options` | `DENY` | samme vern som `frame-ancestors 'none'`, for nettlesere som ikke kan CSP-en |

Framing er altså umulig: `frame-ancestors 'none'` i CSP-en, med `X-Frame-Options:
DENY` som reserve. Ingen del av Huskis er ment å vises inne i en annen side.

## Bibliotekene i `vendor/`: lokale kopier, eksakte versjoner

Appen har tre tredjepartsbiblioteker, og alle ligger i repoet, ikke på et CDN:

```html
<script src="vendor/supabase-js-2.111.0.js"></script>
<script src="vendor/smett-0.2.0.js"></script>
<script src="vendor/yjs-13.6.32.js"></script>
```

Supabase-filen er en **uendret kopi** av `dist/umd/supabase.js` fra npm-pakken
`@supabase/supabase-js`, og versjonen står i filnavnet. Det gir tre ting på én
gang: `script-src` trenger ingen eksterne kilder (`'self'` og guard-hash-en er
hele direktivet), appen laster like godt om et CDN er nede, og
tredjepartskoden endrer seg bare i en commit her — et flytende `@2` fra et CDN
kunne gitt hver deploy, og hver reload hos brukeren, en annen versjon enn den
som ble testet.

Smett-filen — dra-og-slipp-laget, se [`drag-and-drop.md`](drag-and-drop.md) — er
det samme opplegget med én forskjell som betyr noe for guarden: **Smett er ikke
publisert på npm.** Kopien er derfor ikke «det npm leverte», men *det
`npm run build:iife` gir i `peohol/smett` på en bestemt commit*, og den commit-en
er en del av påstanden. Uten den finnes det ingen kilde å regne bytene ut fra på
nytt. Smett pinner esbuild til en eksakt versjon nettopp for at påstanden skal
holde over tid — en minifiserer kan endre output i en patch-utgivelse, og et
`^`-spenn ville latt samme kildekode gi en annen fil.

Yjs-filen — samskrivingen i notatene, se [`notater-plan.md`](notater-plan.md) —
er publisert på npm, men bare som ESM og CommonJS: det finnes ingen ferdig
IIFE-bygg å kopiere. Kopien er derfor esbuild-bunten av pakken, laget av ett
inngangspunkt som re-eksporterer HELE biblioteket (`export * from 'yjs'`) med
flaggene som står i guarden. Hele pakken med vilje: en håndplukket
eksportliste ville gjort bytene avhengige av hvilke navn Huskis tilfeldigvis
brukte den dagen, og en ny bruk senere ville endret fila uten at biblioteket
hadde endret seg. Som for Smett er esbuild-versjonen en del av påstanden.

Smett og Yjs MÅ lastes som klassiske skript FØR `app.js`: de definerer de
globale `Smett` og `Yjs`, og app.js leser dem mens den kjører. Å gjøre `app.js`
til et modulskript i stedet er ikke et alternativ — et modulskript kjører etter
ALLE klassiske skript på siden, altså også etter `update-check.js`.

`vercel.json` gir `/vendor/(.*)` langtidscache (`immutable`). Filene der får
ikke `?b=<build-ID>` som resten av JS-en: versjonen står allerede i navnet, så
URL-en endrer seg av seg selv når innholdet gjør det.

`tests/security-headers.test.js` regner ut SHA-384 av hver innsjekket fil og
sammenligner med sjekksummen for den versjonen (`VENDORED`, der hver oppføring
også sier hvor bytene kommer fra). En redigert, byttet eller uregistrert kopi
feiler i CI. Testen slår også fast at `script-src` ikke har noen eksterne
kilder, at `index.html` ikke laster skript fra en fremmed vert, at Smett og Yjs
lastes før `app.js`, og at ingen av skriptene er `type="module"`.

**Oppgradering av Supabase** er fire steg:

```bash
V=2.222.0
curl -fsSL "https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-$V.tgz" -o /tmp/sb.tgz
# Sammenlign med `dist.integrity` fra https://registry.npmjs.org/@supabase/supabase-js/$V
openssl dgst -sha512 -binary /tmp/sb.tgz | base64 -w0
tar xzf /tmp/sb.tgz -O package/dist/umd/supabase.js > "vendor/supabase-js-$V.js"
git rm "vendor/supabase-js-<gammel versjon>.js"
openssl dgst -sha384 -binary "vendor/supabase-js-$V.js" | base64 -w0   # → VENDOR_SHA384
```

1. Hent tarballen fra npm og verifiser den mot `dist.integrity` i
   registeret — kopien skal komme fra kilden, ikke fra en CDN-speiling.
2. Legg `dist/umd/supabase.js` inn som `vendor/supabase-js-<versjon>.js`, uendret,
   og slett den gamle.
3. Pek `<script>`-taggen i `index.html` på den nye filen.
4. Legg den nye sjekksummen inn i `VENDOR_SHA384` i
   `tests/security-headers.test.js` (en versjon som mangler der, feiler).

Kjør deretter `node tests/security-headers.test.js` og
`node tests/csp-enforced.test.js`, og verifiser i en preview-deploy at
`window.supabase.createClient` finnes — en feilstavet sti gir en app som ikke
kommer forbi innloggingsskjermen.

**Oppgradering av Smett** er de samme stegene, men bytene bygges i stedet for å
hentes:

```bash
git -C ../smett fetch && git -C ../smett checkout <commit>
(cd ../smett && npm ci && npm run build:iife)
cp ../smett/dist/smett.iife.js "vendor/smett-$V.js"
git rm "vendor/smett-<gammel versjon>.js"
openssl dgst -sha384 -binary "vendor/smett-$V.js" | base64 -w0   # → VENDORED.smett.sha384
```

Både `version` (som må stemme med filnavnet), `origin` (commit-en) og `sha384`
oppdateres i `VENDORED` i `tests/security-headers.test.js`. `origin` er ikke
pynt: den er den eneste anvisningen på hvordan sjekksummen kan regnes ut på nytt
av noen andre enn den som la den inn.

## Webfonten: selvhostet, ikke Google Fonts

Atkinson Hyperlegible Next — appens lesevennlige skrift
([`design-system.md`](design-system.md)) — ligger i repoet, ikke på Googles
CDN. `@font-face`-erklæringene står øverst i `styles.css` og peker på to filer:

```
assets/fonts/atkinson-hyperlegible-next-v7-latin.woff2
assets/fonts/atkinson-hyperlegible-next-v7-latin-ext.woff2
```

Det er de samme to `woff2`-utsnittene Google Fonts selv leverte, uendret. Hvert
utsnitt er det **variable** snittet av fonten (akse `wght`), så én fil dekker
hele vektspennet appen bruker (400–700) — nøyaktig som før, da alle fire
vektene i `css2`-URL-en pekte på den samme fila. `unicode-range` er beholdt fra
Googles stilark: `latin` lastes alltid, `latin-ext` bare når en tekst faktisk
trenger et tegn derfra.

Gevinsten er den samme som for Supabase-kopien, pluss én til: `style-src` og
`font-src` er begge `'self'`, så appen har ingen tredjepartsvert i det hele
tatt; teksten vises like raskt om Google er nede eller blokkert; og ingen
adresse fra appen når en tredjepart under lasting. Filnavnet bærer versjonen
(`v7` = Google Fonts' utgave), så `/assets/fonts/(.*)` kan ha langtidscache
(`immutable`) uten `?b=<build-ID>` — URL-en endrer seg når innholdet gjør det.

`font-display: swap` står i begge erklæringene: teksten tegnes med
reservefonten med én gang og byttes når fila er inne. En font som ikke laster
skal aldri gi tom skjerm.

`tests/security-headers.test.js` regner ut SHA-384 av hver innsjekket fontfil og
sammenligner med sjekksummen for den versjonen — en redigert eller uregistrert
fil feiler i CI. Testen slår også fast at `styles.css` ikke henter fonter fra en
fremmed vert, at `index.html` verken laster stilark eller `preconnect`-er dit,
og at produksjonsbygget faktisk publiserer fontfilene.

Fonten er lisensiert under SIL Open Font License 1.1; lisensteksten følger med i
`assets/fonts/OFL.txt`.

**Oppdatering** er de samme stegene som for `vendor/`: hent Googles stilark med
en moderne `User-Agent` (ellers får du `ttf`, ikke `woff2`), last ned filene
stilarket peker på, legg dem inn under nye navn med den nye versjonen, oppdater
`url()`-ene og `unicode-range` i `styles.css`, og legg de nye sjekksummene inn i
`FONT_SHA384` i `tests/security-headers.test.js`.

```bash
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
curl -sS -A "$UA" 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400..700&display=swap'
openssl dgst -sha384 -binary assets/fonts/<fil>.woff2 | base64 -w0   # → FONT_SHA384
```

## Testmodus finnes ikke i produksjon

`?mock=1` bytter Supabase-klienten mot `mock-backend.js` — en in-memory-«database»
uten autorisasjon, laget for testing ([`tests/CLAUDE.md`](../tests/CLAUDE.md)).
Den skal ikke kunne nås fra produksjon, og gjør det heller ikke: `build.js`
fjerner den i tre lag.

**Unntaket er preview-deployer.** En preview peker på det samme
Supabase-prosjektet som produksjon, så `?mock=1` er nettopp måten å se en endring
uten å røre ekte data på ([`release-og-deploy.md`](release-og-deploy.md)). Fjernet
vi mock-backenden der, ville `?mock=1` stille falt tilbake til den ekte
databasen — det motsatte av det man ba om. `keepTestMode()` beholder derfor
testmodusen når `VERCEL_ENV === 'preview'`, og bare da. Regelen er **fail
closed**: et lokalt `node build.js`, et CI-bygg og enhver deploy uten variabelen
fjerner testmodusen. Produksjonsdeployen er `VERCEL_ENV=production` og treffer
aldri unntaket.

1. **Filene deployes ikke.** `dev-mock.js` og `mock-backend.js` hoppes over i
   `build.js` og kopieres aldri til `dist/`.
2. **Taggen fjernes.** Blokken i `index.html` er merket
   `<!-- huskis:kun-dev:start -->` … `<!-- huskis:kun-dev:slutt -->`, og hele
   blokken rives ut av `stripDevOnly()`. Finner den ikke markørene, **kaster**
   builden — en stille no-op ville deployet testmodusen uten at noe sa fra.
3. **Klienten feiler lukket.** `useMock()` i `app.js` krever at `window.HK_MOCK`
   FAKTISK er lastet. Uten backenden gjør `?mock=1` ingenting i det hele tatt.

I kildetreet — lokal utvikling og nettlesertestene — er alt uendret: `?mock=1`
laster `dev-mock.js`, som laster `mock-backend.js` før `app.js` starter.

`tests/security-headers.test.js` kjører en ekte build og sjekker at ordet «mock»
ikke forekommer noe sted i `dist/index.html`, og at ingen av de to filene ble
publisert.

## Hva som IKKE dekkes her

Autorisasjon håndheves serverside med RLS og RPC-er
([`rettigheter-og-deling.md`](rettigheter-og-deling.md),
[`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md)). Headerne her
begrenser hva en nettleser får lov til å laste og sende — de erstatter ikke ett
eneste serverside-vern, og en CSP stopper ikke en angriper som allerede har en
gyldig sesjon.
