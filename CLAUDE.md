# CLAUDE.md — Huskis

## Prosjekt

Huskis er en statisk vanilla-JS-app uten bundler eller rammeverk. Appen har to
hovedfaner øverst — **Lister** og **Notater** — og toppkontrollene (varsler,
kalender, søk, idéer, drakt, konto) tilhører hele appen, ikke én fane.

Listefanens innhold er hierarkisk: **Område > Mappe > Liste > Listepunkt**, der
en liste i tillegg kan ha ett nivå med **kategorier**. Notatfanen har sitt eget
tre — **Prosjekt > Mappe > Notat** — bygget av de samme komponentene og den
samme synken; autoritativt: `docs/notater-plan.md`.

De to øverste nivåene er bygget av samme komponenter som de to nederste: et
område ER et kort, en mappe ER en rad. Dra-og-slipp kjører i to scope —
`boardScope` og `navScope` — og **alle fem nivåene kjøres av dnd-kit gjennom
Smett** (`vendor/smett-0.2.0.js`). Selve gesten er dnd-kits; hva et slipp BETYR
er Huskis', og den politikken er delt mellom scopene. Autoritativt:
`docs/drag-and-drop.md`.

Notatinnholdet er et strukturert riktekstdokument (ikke HTML), redigert i en
fullskjermseditor med autosave.

`dist/` er generert output fra `node build.js` og skal aldri redigeres direkte.
Mobilskallet (Capacitor + `android/`) pakker den samme `dist/`-en inn i native
appen; webkoden har fortsatt ingen bundler. Autoritativt for mobil:
`docs/mobilapp-plan.md`.

Serversiden er `supabase/users-and-sharing.sql`, med senderen for web push i
`supabase/functions/push-send/` — den ene tingen som trenger kryptografi SQL
ikke har. Service workeren `sw.js` gjør KUN varsler, ingen caching.
Autoritativt: `docs/varsler.md`. Tilstanden ligger i `localStorage` per konto og
synkes mot Supabase (Auth + relasjonelle tabeller med RLS). Appen har ingen
anonym modus. Releaseflyten er dokumentert i
`docs/release-og-deploy.md`.

UI-et finnes på norsk og engelsk, og all brukerrettet tekst går gjennom
`i18n.js`; se `docs/sprak.md`. Lys/mørk drakt følger `docs/mork-drakt.md`.

De norske ordene i UI-et og dokumentasjonen er **område** og **mappe**;
identifikatorene i koden og databasen heter fortsatt `universe` og `group`.
Døp dem ikke om — det er databasekontrakten.

Autoritativt for hvem som får gjøre hva: `docs/rettigheter-og-deling.md`. Kart
over resten av dokumentasjonen: `docs/README.md`. Les bare dokumentene oppgaven
faktisk berører.

## Samarbeid med repo-eier

- Repo-eieren er kliniker, ikke programvarearkitekt. Anta ingen
  programvarefaglig bakgrunn når du ber om beslutninger eller forklarer arbeid.
- Ikke be eieren ta stilling til tekniske spørsmål — arkitektur,
  databasedesign, biblioteker, implementasjonsmønstre, filstruktur eller
  teststrategi — når du kan velge en forsvarlig løsning selv.
- Ved teknisk usikkerhet: velg som hovedregel den sikreste og mest reversible
  løsningen som passer eksisterende kode og dokumentasjon. Implementer den, og
  beskriv relevante tekniske avveiinger i PR-beskrivelsen for kode-review.
- Eskaler bare når avgjørelsen faktisk krever eieren: produktvalg, kostnad,
  ekstern konto/tilgang, en irreversibel eller destruktiv handling, eller noe
  som ikke kan avgjøres trygt fra repoet.
- Når du må spørre, still ett konkret spørsmål på enkelt norsk og forklar
  konsekvensen for produktet, ikke for koden.

## Kommunikasjon med repo-eier

- Skriv kort og enkelt på norsk (Bokmål). Ikke gi lange tekniske forklaringer
  med mindre eieren ber om dem.
- Unngå navn på interne komponenter, filer, databasemekanismer og teknologier
  når de ikke trengs for å forstå resultatet eller ta en beslutning.
- Oppsummer ferdig arbeid som standard under:
  - **Hva er gjort?**
  - **Hva betyr det for appen?**
  - **Kan jeg teste noe nå?**
  - **Er det noe jeg faktisk må ta stilling til?** — svar «Nei» når det ikke er
    noe reelt valg.
  - **Hva er naturlig neste steg?**
- Hvis endringen ennå ikke gir noe meningsfullt å teste i UI-et, si det
  eksplisitt.
- Ikke rapporter tekniske observasjoner som ikke krever handling fra eieren,
  som eksisterende warnings, oppryddingsmuligheter, refaktorering eller
  tooling-detaljer. Hvis noe bør gjøres senere, opprett heller en GitHub-issue
  med prefikset `[teknisk]`; hvis det er lite og hører til gjeldende oppgave,
  gjør det nå.
- Tekniske avveiinger hører hjemme i PR-beskrivelsen for reviewer, ikke i
  eieroppsummeringen.
- Unntak: sikkerhet, personvern og risiko for datatap skal alltid synliggjøres
  for eieren med en gang.

## Kommandoer

```bash
python3 -m http.server 8000   # kjør appen: http://localhost:8000
node build.js                 # produksjonsbuild → dist/ (samme steg som Vercel kjører)
tests/run-all.sh              # hele JS-suiten (starter server selv) — samme som CI

npm ci                        # kun for mobilskallet (Capacitor) — webappen trenger den ikke
npm run sync:android          # node build.js → kopier dist/ inn i android/
npm run android:debug         # samme, og bygg debug-APK (krever Android SDK)
```

- `?mock=1` bytter Supabase-klienten mot den hermetiske mock-backenden;
  `&lag=800` legger på kunstig serverforsinkelse.
- Tester: se `tests/CLAUDE.md` (nettleser + node) og `supabase/CLAUDE.md` (SQL).

## Før du endrer kode

- Finn eksisterende implementasjon og eventuell test først. `app.js` er stor og
  seksjonsinndelt — søk i den før du antar at noe ikke finnes.
- Les kun dokumentene oppgaven faktisk berører; `docs/README.md` sier hvilke.
- Trenger du å vite HVORFOR koden er som den er, bruk git-historikken
  (`git log -S '<symbol>'`, `git log -p <fil>`). Dokumentene beskriver
  nåtilstanden, ikke veien dit.

## Implementering

- Gjør den minste sammenhengende endringen som løser oppgaven. Ingen
  uvedkommende refaktorering, abstraksjon eller feature flags.
- Klient og database endres SAMMEN: et felt klienten skriver må finnes i
  `supabase/users-and-sharing.sql`, ellers avviser PostgREST hver skriving og
  synken stopper. Se `supabase/CLAUDE.md`.
- All autorisasjon håndheves serverside. Klientens gating er kun UX, og skal
  feile LUKKET: mangler capabilities fra serveren, skjul kontrollen.
- Opprettelse og flytting spør FORELDEREN om lov, ikke objektet selv —
  myndigheten ligger på nivået over (`docs/rettigheter-og-deling.md`).
- Endringer i område-/mappe-UI-et treffer liste-/listepunkt-UI-et og omvendt
  (delte klasser, delt DnD-politikk). Sjekk begge.
- Valider ved systemgrensene (brukerinput, svar fra Supabase), ikke internt.
- Endrer du en invariant, oppdater det autoritative dokumentet i `docs/` i samme
  endring. Skriv nåtilstanden, ikke endringshistorikk («siste runde» o.l.) —
  historikken hører hjemme i git og PR-en.
- Jobb autonomt når kravene kan utledes av repoet. Spør bare når det som mangler
  påvirker korrekthet, sikkerhet, destruktive handlinger eller oppgavens reelle
  omfang.

## Verifisering

Kjør den minste verifikasjonen som gir troverdig evidens for endringen:

| Endringen gjelder | Verifisering |
|---|---|
| Dokumentasjon/kommentarer | ingen nettlesertest |
| SQL i `supabase/` | SQL-testsuiten — `supabase/CLAUDE.md` |
| Avgrenset klientlogikk | de(n) relevante testen(e) i `tests/` |
| Brukerrettet UI | ekte nettleser (Playwright), + skjermbilde ved visuell endring |
| Responsiv eller pekeravhengig oppførsel | både desktop- og mobil-viewport |
| Auth, synk eller deling | mock-backend (`?mock=1`) + den relevante flerbrukerflyten |
| Varsler, planen framover eller de eksterne kanalene | `node tests/push-crypto.test.js` + `tests/notif-plan.test.js`, `tests/notif-channels.test.js`, `tests/notif-modal.test.js`, `tests/notif-native-devices.test.js` og SQL-suiten (`test-push.sql`, `test-native-notif.sql`) |
| Deploy, caching, build-output | `node build.js` og `node tests/build-version.test.js` |
| Capacitor, `android/`, npm-tooling | `node tests/capacitor-android.test.js` + `node tests/build-version.test.js`, og Android debug-APK-workflowen |
| Sikkerhetsheadere, CSP, tredjepartsressurser | `node tests/security-headers.test.js` + `node tests/csp-enforced.test.js` |
| Releaseprosessen (workflows, `vercel.json`, smoke-test) | `node tests/release-pipeline.test.js` + `node tests/db-contract.test.js`, og SQL-suiten hvis `smoke-test.sql` er endret |

Retter du en feil, skal en test fange den — ny test, eller en ny sjekk i den
filen som allerede dekker området.

Rapporter nøyaktig hvilke kommandoer og tester som ble kjørt, og hva de ga. Si
eksplisitt fra om noe ikke er verifisert; ikke påstå at noe er verifisert uten
et faktisk resultat fra økten.

## PR-er

- Utvikle på egen gren, og send lenken til PR-en når den er opprettet.
- Sjekk-inn-timer etter opprettet PR: maks 5 minutter — det tar sjelden lenger
  før tester er ferdige og reviewere har sett på den.
