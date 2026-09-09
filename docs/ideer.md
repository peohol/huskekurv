# Idéer

Les denne når oppgaven berører idémodalen, `state.ideas`, `ideas`-tabellen
eller idéenes søppelkasse.

Idéer er stedet man kaster ned en tanke før den rekker å bli borte. De hører til
**kontoen**, ikke til et område eller en mappe: den samme listen står i modalen
uansett hvor i hierarkiet man er. De deles aldri, låses aldri og planlegges
aldri — en idé har ett felt (teksten) og én knapp (slett).

## Veien inn

**Idéknappen** (`.corner-btn.ideas-btn`, `#ideas-btn`) står i
toppkontrollgruppen, rett til venstre for draktknappen
([`menus.md`](menus.md)). Ikonet er lyspæren — den samme tegningen «Tips» har i
konto-modalen ([`design-system.md`](design-system.md)). Knappen åpner
`#ideas-modal`, som ligger i den felles Escape-/tilbake-stigen
(`closeTopLayer`) som alle andre modaler.

## Formen er listas

En idéliste har nøyaktig **to nivåer**, som en liste har:

- **Idé** — en rad (`.item.idea-row`). Klikk på TEKSTEN redigerer den
  (flerlinjet, se under); klikk-og-dra løfter raden.
- **Idékategori** — en overskrift med en hylle under (`.category.idea-cat` +
  `.cat-items`). Klikk på NAVNET omdøper; klikk ellers på overskriftslinjen
  folder hylla opp og ned. Kategorier nøstes ALDRI.

Derfor er det heller ikke skrevet noe eget her: radene, kategoriene,
skillelinjene, kollaps-tellerne og hele dra-og-slipp-motoren er listenivåets,
gjenbrukt gjennom `ideaScope` ([`drag-and-drop.md`](drag-and-drop.md)).

**Kategoriene bærer palettfarge etter POSISJON**, som listene og områdene: den
øverste er alltid den første fargen, og en omrokkering deler ut på nytt
(`reindexIdeaCatColors`, som `reindexContainerColors`). Fargen lagres ikke og
synkes ikke — den utledes av rekkefølgen, og rekkefølgen synkes, så alle enheter
kommer fram til den samme. Idébeholderen selv (`.ideas-card`) har ingen
palettfarge: den er ikke et av kortene i board-ets rekke.

Kategoriflaten gjelder **kun i hvile**. Regelen er like spesifikk som de delte
dra-reglene og står etter dem i `styles.css`, så den er eksplisitt holdt utenfor
`[data-dnd-placeholder]` og `[data-dnd-dragging]`. Ellers slo den dem: hullet
ble et lite kategorikort med aksentstripe i stedet for et hull — og et hull skal
se likt ut uansett om det er en idé eller en kategori som skal lande i det — og
det løftede objektet mistet den halvgjennomsiktige løfteflaten og den kompakte
polstringen klonen måles mot.

**Tom-tilstanden er ren CSS** (`.items-container:empty + .ideas-empty`), slik at
den ikke kan komme i utakt med listen — heller ikke midt i et drag, der dnd-kits
klone gjør beholderen «ikke tom». Og er beholderen tom, er det ingenting å
slippe i den heller: den legges flat, og kortet blir en ren tekstboks med LIK
luft hele veien rundt. Kortets vanlige polstring er 10 px opp/ned og 0 til
sidene (radene bærer sitt eget innrykk), så teksten sto ellers 34 px fra toppen
— kortets 10 + den tomme beholderens minstehøyde 14 + hyllegapet 10 — og klint
mot venstrekanten.

**Knappene** står i modalens FOT (`.modal-foot.ideas-foot`), utenfor det
rullende feltet: er listen lengre enn modalen, blir de stående. Kassen står i
det samme feltet. Ellers er de listas — men med idéikonet i stedet for ＋:

| Knapp | Gjør |
|---|---|
| grønn, lyspære (`#add-idea-btn`) | ny UKATEGORISERT idé |
| gul, kategori-ikon (`#add-idea-cat-btn`) | ny idékategori |
| grønn, lyspære nederst i en kategori (`.cat-add-btn`) | ny idé DIREKTE i kategorien |

Begge idé-knappene **kjeder seg selv**: bekrefter man et navn, står neste
blanke idé klar med det samme, og et felt man forlater uten å skrive noe
fjernes igjen (`nameNewRow`). Det er hele poenget med funksjonen — fem idéer
skal koste fem setninger og ingen klikk imellom.

Objektene har ingen objektmeny. En idé har **slett** (`.idea-del-btn`), en
kategori har **oppløs** (`.idea-dissolve-btn`) — og oppløsning ER kategoriens
sletting: medlemmene blir stående som ukategoriserte idéer på samme plass
(`dissolveCategory`, delt med listekategoriene).

## Flerlinjet redigering

Både idéer og listepunkter redigeres i et **`<textarea>` som vokser med
teksten** (`editText`, `opts.multiline` → `.edit-input-multi`). Et enlinjes felt
rullet resten av teksten ut av syne nettopp når man skulle lese den.

Feltet arver ikke skriftstørrelsen fra raden: `editText` leser `font-size` og
`line-height` av elementet som byttes ut, FØR det tas ut av dokumentet (en
`getComputedStyle`-referanse svarer tomt etterpå). Da bryter feltet på samme ord
som teksten gjorde, og raden hopper ikke i høyden i det redigeringen starter.

Teksten er fortsatt ÉN linje som data: Enter avslutter redigeringen (det lager
ikke et linjeskift), akkurat som i enlinjefeltet. Bryting er visuell.

## Dra-og-slipp

Gesten og politikken er delt med de andre nivåene
([`drag-and-drop.md`](drag-and-drop.md)); to ting er verdt å merke seg:

- **Draget er låst til den vertikale aksen, og males uten rotasjon.** Lista er én
  smal kolonne uten et eneste vannrett slippmål, så en vannrett komponent kunne
  bare bomme. Låsen er den delte (`dndLockAxis`, «Én akse» i
  [`drag-and-drop.md`](drag-and-drop.md)) — den slår inn av seg selv fordi
  idéscopet er `singleColumn`.
- **Kassen er ikke et slippmål.** Se under. Dette er idémodalens eget.

## Søppelkassen

Idéene har sin **egen** kasse (`#idea-trash-btn`), i modalens fot, og den virker
som de fire andre ([`trash.md`](trash.md)): skjult når den er tom, kort trykk
åpner søppel-modalen (gjenoppretting per rad), hold-og-sveip tømmer permanent.
En slettet idé ligger der til kassen tømmes; tømming setter gravstein, og en idé
som pekte på en kategori som ble tømt bort løsner til nivå 1.

**Men den er IKKE et slippmål.** De andre nivåene kan i tillegg slette ved å
slippe i kassen; der er kassen ett sted per liste/mappe, og draget er uansett
den eneste veien mellom containere. En idé har bare én container, og
sletteknappen står på selve raden — å sikte den ned i en kasse er flere
bevegelser for det samme utfallet. Boardet har derfor ingen `zoneSelector`, og
kassen viser seg ikke fram for et drag.

En idékategori havner aldri i kassen — den løses opp.

## Datamodellen

```js
state.ideas = [
  { id, text, cat, isCat, collapsed, trashed,
    ts, org,                 // innholdsregister: text/trashed/isCat/collapsed
    pos, posTs, posOrg },    // posisjonsregister: rekkefølge + `cat`
]
```

Flat, ikke nøstet: det finnes bare én beholder. `cat` peker fra en idé til
kategorien sin (null = ukategorisert, nivå 1) og rir på POSISJONSREGISTERET —
et kategorimedlemskap er en forelder-endring, som `home` på et listepunkt. En
idé hvis `cat` peker på en kategori som ikke finnes (oppløst på en annen enhet)
rendres som ukategorisert. Nivå 1 og nivå 2 deler samme `pos`-rom, filtrert til
søskenrekka før sortering.

Det som IKKE finnes er med vilje: ingen `home` (én beholder), ingen `done`,
ingen `responsible`, ingen `start`/`due`, ingen lås.

`state._tomb.ideas` er gravsteinsbøtta, som for de fire andre nivåene.

Serversiden dekkes av `supabase/tests/test-ideas.sql` (RLS mot en annen konto,
felt-nivå-LWW på begge registrene, uforanderlig oppretter, gravstein +
insert-vakt, kontosletting, rettigheter).

## Synken

Idéene er den **femte radtypen** i synk-doc-et, ved siden av områder, mapper,
lister og listepunkter ([`accounts.md`](accounts.md)): samme 3-veis fletting,
samme felt-nivå-LWW (`mergeIdea`), samme gravsteiner, samme operasjonskø.
`TABLE.idea = 'ideas'`, og `get_my_doc()` leverer dem under nøkkelen `ideas`.

Serversiden er tabellen `public.ideas`
([`arkitektur-brukere-deling.md`](arkitektur-brukere-deling.md)):

- `owner_id` er hele autorisasjonen. RLS er `owner_id = auth.uid()` på alle
  fire operasjonene — ingen medlemskap, ingen capabilities, ingen låsevakter.
  Idéer kan ikke deles, og det er ikke en mangel: de er kladdeboka.
- `ideas_before_update` gjør bare det RLS ikke kan: holder registrene i orden
  (en eldre skriving overskriver aldri en nyere fra en annen enhet) og hindrer
  at oppretteren endres.
- `cat_id` er en fremmednøkkel til tabellens egen id, `on delete set null` og
  `deferrable initially deferred` — doc-rekkefølgen er vilkårlig, så en idé kan
  settes inn før kategorien den peker på. En slettet kategori tar ALDRI
  medlemmene med seg, men pekeren kan bli hengende igjen: fremmednøkkelens egen
  `set null` har intet register-stempel, og skrivevakten forsvarer posisjonen
  mot en ustemplet oppdatering. Nøyaktig som `items.cat_id`, og klienten er
  bygget for det — en `cat` som ikke treffer en kategori rendres som
  ukategorisert, og `pruneDanglingCats` nuller den før den skrives.
- Gravstein- og insert-vakten er de samme triggerne som de fire andre
  tabellene bruker (`write_tombstone`, `guard_object_insert`); `tombstones`
  kjenner nå typen `idea`.
- `delete_account()` sletter idéene direkte: de er mine alene, så det finnes
  ingen grense mot andres innhold å ta hensyn til.

Mock-backenden (`mock-backend.js`) speiler alt dette, som for de andre
tabellene.

## Tester

`tests/ideas-modal.test.js` dekker knappen, opprettelsen, redigeringen (også at
den er flerlinjet), omdøping og oppløsning av kategorier, sletting og
gjenoppretting, dra-og-slipp på begge nivåene (inkludert akselåsen, at kassen
IKKE tar imot et slipp, at hullet males og at en løftet kategori er en
ugjennomsiktig rad uten skillelinje), kategorifargene etter posisjon, at
knappene står stille mens listen ruller, og at idéene følger KONTOEN og skrives
til `ideas`-tabellen. Flerlinjeredigering av LISTEPUNKTER dekkes av
`tests/item-creation.test.js` (7b).
