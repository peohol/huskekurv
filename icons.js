/* ============================================================
   Huskis — ikonsett brukt fra app.js (SVG som strenger)
   ------------------------------------------------------------
   Kun ikonene som bygges dynamisk fra JS ligger her (badges, lås-knapp,
   auth-heading, sveipefeltet, søppelkasse-ikonet i element-knappen og
   antall-pillene, tom-tilstander). De rent statiske ikonene (trash/logout/
   globe/share/logo) er limt direkte inn i index.html — se den for resten av
   ikonsettet fra design-handoffen.

   FARGELAGT IKONSETT: alle streker er SVARTE (`stroke="#111"`, konsekvent —
   ikke lenger currentColor), og flater fylles med hvit + egne motivfarger der
   motivet tilsier det (se docs/design-system.md → «Fargelagte ikoner» for
   fargekartet og reglene). Rene funksjons-glyfer på massive fargeknapper
   (avkryssing/utlogging) beholder currentColor. Fyllfargene er hardkodet hex
   valgt PER MOTIV (manilamappe-tan, blyantgul, messing-bjelle, glødende
   lyspære, lås-rødt/-grønt osv.) — IKKE lenger palettens seks kortfarger. To
   unntak beholder en delt farge med vilje: kontoikonet (person) og alt som
   speiler DET (kamera-linsa, hånd-opp-personen) bruker fortsatt palettens
   blågrønne `#85adad`, fordi `--accent`/`--grad-accent` i styles.css er
   avledet av nettopp den fargen (se «Kontrast-kontrakt» i styles.css) —
   endres den, mister knappesystemet sin forankring. Grå (søppel/menyprikker)
   = `#c0c4c9`, uendret. Størrelse styres av .icon-klassen i styles.css
   (width/height: 1em).

   trashSwipe har to bevegelige deler: `.swipe-icon-lid` (lokk+hank) roteres
   separat av app.js sin sveip-for-å-tømme-motor (se attachTrashHold/
   setProgress i app.js og .swipe-icon-lid i styles.css) — resten (kasse-kropp
   + ribbene) er statisk og roterer kun med hele ikonet. ViewBox-en er
   KVADRATISK og senter-symmetrisk rundt kassens midtpunkt (12,12):
   -9.5 -9.5 43 43 — halvbredden (21.5) er ≥ største avstand fra midtpunktet
   til noen del av tegningen i NOEN kombinasjon av helikon-rotasjon (0–180°)
   og lokk-sving (0–-95°), målt til lokktuppen fullt åpen (~21.3). Dermed
   klippes ALDRI noe av kassen/lokket under rotasjon, uansett fase. Endres
   viewBox-en, må .swipe-icon-lid sin transform-origin (32.56 % 39.53 % =
   hengselet 4.5,7.5) i styles.css og SWIPE_ICON_BOX i app.js regnes ut på
   nytt. Ikke fjern `.swipe-icon-lid`-klassen uten å oppdatere setProgress
   tilsvarende.
   ============================================================ */
window.ICONS = {
  trashSwipe: '<svg class="icon swipe-icon" viewBox="-9.5 -9.5 43 43" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11" fill="#c0c4c9" stroke="none"></path>' +
    '<g class="swipe-icon-lid">' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '</g>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path>' +
    '<path d="M12 11v6"></path>' +
    '<path d="M14.3 11v6"></path>' +
    '</svg>',

  trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11" fill="#c0c4c9" stroke="none"></path>' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path>' +
    '<path d="M12 11v6"></path>' +
    '<path d="M14.3 11v6"></path>' +
    '</svg>',

  // Globus (område): de seks feltene i kula fylles med palettens seks første
  // farger. Feltene er skjæringene mellom ekvatorlinja og meridian-vesicaen —
  // tre soner over (venstre halvmåne / midtlinse / høyre halvmåne) og tre under.
  globe: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 12A9 9 0 0 1 12 3A14 14 0 0 0 8.2 12Z" fill="#ad8585" stroke="none"></path>' +
    '<path d="M8.2 12A14 14 0 0 1 12 3A14 14 0 0 1 15.8 12Z" fill="#adad85" stroke="none"></path>' +
    '<path d="M15.8 12A14 14 0 0 0 12 3A9 9 0 0 1 21 12Z" fill="#85ad85" stroke="none"></path>' +
    '<path d="M3 12A9 9 0 0 0 12 21A14 14 0 0 1 8.2 12Z" fill="#85adad" stroke="none"></path>' +
    '<path d="M8.2 12A14 14 0 0 0 12 21A14 14 0 0 0 15.8 12Z" fill="#8585ad" stroke="none"></path>' +
    '<path d="M15.8 12A14 14 0 0 1 12 21A9 9 0 0 0 21 12Z" fill="#ad85ad" stroke="none"></path>' +
    '<circle cx="12" cy="12" r="9"></circle>' +
    '<path d="M3 12h18"></path>' +
    '<path d="M12 3a14 14 0 0 1 3.8 9 14 14 0 0 1-3.8 9 14 14 0 0 1-3.8-9A14 14 0 0 1 12 3Z"></path>' +
    '</svg>',

  // Språk: en ENSFARGET klode med ekvator og meridian. Bevisst ulik `globe`
  // (område), som har seks fargefelt — de to skal ikke kunne forveksles. Blå-
  // grønn «verdenshav»-tone, egen fra kontoikonets blågrønne (se fargekartet
  // i docs/design-system.md).
  language: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.5" fill="#4a94a3"></circle>' +
    '<path d="M3.5 12h17"></path>' +
    '<path d="M12 3.5a13 13 0 0 1 3.6 8.5 13 13 0 0 1-3.6 8.5 13 13 0 0 1-3.6-8.5A13 13 0 0 1 12 3.5Z"></path>' +
    '</svg>',

  /* Draktknappen (`#theme-toggle-btn`): viser hvilken drakt som ER aktiv, ikke
     hvilken man bytter TIL — sol i lys drakt, måne i mørk. Skiven er varm
     sol-oransje (#f0a83a), halvmånen kjølig himmelblå (#9db3d9) — to egne
     motivfarger i stedet for samme palettone, så de to ikke kan forveksles på
     et blikk. Begge står stille i begge drakter (kun én vises om gangen).
     paintThemeToggle() i app.js velger hvilken av de to som vises. */
  sun: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="5" fill="#f0a83a"></circle>' +
    '<path d="M12 1.5v2.2"></path>' +
    '<path d="M12 20.3v2.2"></path>' +
    '<path d="M4.22 4.22l1.56 1.56"></path>' +
    '<path d="M18.22 18.22l1.56 1.56"></path>' +
    '<path d="M1.5 12h2.2"></path>' +
    '<path d="M20.3 12h2.2"></path>' +
    '<path d="M4.22 19.78l1.56-1.56"></path>' +
    '<path d="M18.22 5.78l1.56-1.56"></path>' +
    '</svg>',
  moon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="#9db3d9"></path>' +
    '</svg>',

  // Øye (Vis): hornhinnen (mandelen) hvit, pupillen (indre sirkel) svart.
  eye: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="#ffffff"></path>' +
    '<circle cx="12" cy="12" r="3" fill="#111" stroke="none"></circle>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>',

  // Øye med skråstrek (Skjul): samme øye som over + en strek tvers over.
  // Brukes av passord-knappen når passordet vises («trykk for å skjule»).
  eyeOff: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="#ffffff"></path>' +
    '<circle cx="12" cy="12" r="3" fill="#111" stroke="none"></circle>' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M4.4 19.6 19.6 4.4"></path>' +
    '</svg>',

  // Fotoapparat (profilbilde): huset hvitt, linsa farge 4 (som person-ikonet).
  camera: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.8 7.4 9.9 5.3h4.2l1.1 2.1h4.3a2.2 2.2 0 0 1 2.2 2.2v7.2a2.2 2.2 0 0 1-2.2 2.2H4.5a2.2 2.2 0 0 1-2.2-2.2V9.6a2.2 2.2 0 0 1 2.2-2.2Z" fill="#ffffff"></path>' +
    '<circle cx="12" cy="13.4" r="3.7" fill="#85adad"></circle>' +
    '</svg>',

  // Dør + pil inn (logg inn): dørfeltet hvitt, pila svart.
  login: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 3h3a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 18 21h-3" fill="#ffffff"></path>' +
    '<path d="M3 12h11"></path>' +
    '<path d="M10.5 8.5 14 12l-3.5 3.5"></path>' +
    '</svg>',

  // Personsiluett (Mine lister): hode + kropp fylt med farge 4 (blågrønn).
  profile: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="8" r="3.4" fill="#85adad"></circle>' +
    '<path d="M5.5 20a6.5 6.5 0 0 1 13 0" fill="#85adad"></path>' +
    '</svg>',

  // Personsiluett som rekker opp hånden («jeg tar oppgaven») — ansvarsknappen
  // på elementer i delte lister. Samme grunnform som `profile` (hode + skuldre),
  // men med én arm hevet opp til en hånd over hodet — fylt med farge 4.
  handRaise: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="8" r="3.2" fill="#85adad"></circle>' +
    '<path d="M4.7 20a5.9 5.9 0 0 1 11.3-2.4" fill="#85adad"></path>' +
    '<path d="M15.3 14.5 18 8.2"></path>' +
    '<circle cx="18.4" cy="6.7" r="1.3" fill="#85adad"></circle>' +
    '</svg>',

  // Tre personer (Delte lister): hver person (hode + kropp) fylt med farge 1–3.
  // Sidepersonene tegnes FØRST (bak) med en fylt skulder-kuppel hver, så
  // senterpersonen oppå — da får sidene ekte fyll som titter fram på utsidene.
  people: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="4.7" cy="10.3" r="1.95" fill="#adad85"></circle>' +
    '<path d="M2.1 17.6a2.6 2.6 0 0 1 5.2 0" fill="#adad85"></path>' +
    '<circle cx="19.3" cy="10.3" r="1.95" fill="#85ad85"></circle>' +
    '<path d="M16.7 17.6a2.6 2.6 0 0 1 5.2 0" fill="#85ad85"></path>' +
    '<circle cx="12" cy="7.8" r="3.1" fill="#ad8585"></circle>' +
    '<path d="M6.7 18.6a5.3 5.2 0 0 1 10.6 0" fill="#ad8585"></path>' +
    '</svg>',

  // Hengelås: LÅST fylles med et klart rødt (restriksjon), ÅPEN med et klart
  // grønt (fritt fram) — bøyle + nøkkelhull svart. Mer signalrent enn de
  // desaturerte kortfargene, som passer bedre til flater enn til et
  // sikkerhetssymbol.
  lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="#c15c56"></rect>' +
    '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"></path>' +
    '<circle cx="12" cy="14.6" r="1.2" fill="#111" stroke="none"></circle>' +
    '<path d="M12 15.8v1.9"></path>' +
    '</svg>',

  unlock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="#5da172"></rect>' +
    '<path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.9"></path>' +
    '<circle cx="12" cy="14.6" r="1.2" fill="#111" stroke="none"></circle>' +
    '<path d="M12 15.8v1.9"></path>' +
    '</svg>',

  // Mappe: fylt med en varm manila-tan (#c9a06a) — den klassiske
  // mappefargen, egen fra pengegul/bjelle/lyspære (se fargekartet).
  folder: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3.5 19V6.5a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" fill="#c9a06a"></path>' +
    '</svg>',

  // Liste: kortflaten hvit, punkter + linjer svarte.
  list: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="4.5" fill="#ffffff"></rect>' +
    '<circle cx="8" cy="8.5" r="0.7" fill="#111" stroke="none"></circle>' +
    '<circle cx="8" cy="12" r="0.7" fill="#111" stroke="none"></circle>' +
    '<circle cx="8" cy="15.5" r="0.7" fill="#111" stroke="none"></circle>' +
    '<path d="M11.5 8.5h5.5"></path>' +
    '<path d="M11.5 12h5.5"></path>' +
    '<path d="M11.5 15.5h5.5"></path>' +
    '</svg>',

  // Listepunkt: ÉN rad — den lyse platen et listepunkt tegnes på, med punktet
  // og linjen fra `list`-ikonet. Motivet er bevisst det samme som listens, bare
  // én rad i stedet for tre: i søketreffene skal en liste og et listepunkt
  // kunne skilles på et blikk uten å være to urelaterte tegninger.
  item: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="8" width="18" height="8" rx="3" fill="#ffffff"></rect>' +
    '<circle cx="7.5" cy="12" r="0.7" fill="#111" stroke="none"></circle>' +
    '<path d="M10.5 12h7"></path>' +
    '</svg>',

  // Notat: et ark med skrevne linjer og et brettet hjørne. Hvit flate som
  // liste-ikonet, så de to hoveddelene leses som samme familie — men motivet er
  // et DOKUMENT, ikke en rad med punkter (docs/notater-plan.md).
  note: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 3h7.5L19 8.5V21H6Z" fill="#ffffff"></path>' +
    '<path d="M13.5 3v5.5H19"></path>' +
    '<path d="M8.8 12.5h6.4"></path>' +
    '<path d="M8.8 15.5h6.4"></path>' +
    '<path d="M8.8 18.5h3.6"></path>' +
    '</svg>',

  // Bokhylle: notatenes ØVERSTE nivå, slik området er listenes. Reolen er hvit
  // som liste-/notatflatene, og bøkene bærer motivfargene fra settet — en
  // hylle med flere fargede rygger leses som «her står bøkene mine» på et par
  // titalls piksler, slik globusen leses som «område».
  noteProject: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3.5" width="18" height="17" rx="2" fill="#ffffff"></rect>' +
    '<path d="M5.9 6.1h2v5.1h-2Z" fill="#c15c56"></path>' +
    '<path d="M8.6 6.9h1.8v4.3H8.6Z" fill="#6fa8e0"></path>' +
    '<path d="M11.1 6.1h2v5.1h-2Z" fill="#e8bd3e"></path>' +
    '<path d="M13.8 7.3h2.1v3.9h-2.1Z" fill="#5da172"></path>' +
    '<path d="M3 11.9h18"></path>' +
    '<path d="M5.9 13.6h2v4.6h-2Z" fill="#85adad"></path>' +
    '<path d="M8.6 14.3h1.8v3.9H8.6Z" fill="#c9a06a"></path>' +
    '<path d="M11.1 13.6h2v4.6h-2Z" fill="#ad85ad"></path>' +
    '<path d="M13.8 14.9h2.1v3.3h-2.1Z" fill="#c96b45"></path>' +
    '<path d="M3 18.4h18"></path>' +
    '<rect x="3" y="3.5" width="18" height="17" rx="2"></rect>' +
    '</svg>',

  // Notatbok: bokhyllens innhold og notatets forelder. Rød perm med de hvite
  // sidene stikkende fram til høyre — det ene motivet som sier «bok» uten å
  // kunne forveksles med et ark (`note`) eller en hylle (`noteProject`).
  noteFolder: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4.5 5A1.5 1.5 0 0 1 6 3.5h13A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19Z" fill="#c15c56"></path>' +
    '<path d="M8.5 3.5h10.5A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H8.5Z" fill="#ffffff"></path>' +
    '<path d="M8.5 3.5v17"></path>' +
    '<path d="M11 8.4h6.4"></path>' +
    '<path d="M11 12h6.4"></path>' +
    '<path d="M11 15.6h4"></path>' +
    '<path d="M4.5 5A1.5 1.5 0 0 1 6 3.5h13A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19Z"></path>' +
    '</svg>',

  // Kryss (×) for lukk-/slett-knapper: egen SVG med samme strek (1.05) og runde
  // ender som resten av settet. Bruker currentColor så CSS styrer farge (svart i
  // hvile, rød ved hover på slett-knappene — se .icon-btn/-delete i styles.css).
  xmark: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6.5 6.5 17.5 17.5"></path><path d="M17.5 6.5 6.5 17.5"></path></svg>',

  // ＋ for alle «legg til»-knapper (element/liste/mappe/område): egen SVG med
  // samme strek (1.05) og runde ender som resten av settet, i stedet for
  // tekst-glyfen ＋ (som har annen linjestil/tykkelse enn ikonsettet). Svart
  // strek (#111) som resten av ikonsettet, også på de fargede knappene.
  plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4.5v15"></path><path d="M4.5 12h15"></path></svg>',

  // Kalender (starttid): hovedflaten hvit, det øverste feltet (over topplinja)
  // en varm terrakotta-rød (#c96b45) — som en veggkalenders røde topp, egen
  // tone fra hengelåsens rødt så de to ikke leser identisk. Flaten tegnes uten
  // strek først, så det røde feltet, så rammen på nytt med strek: rekkefølgen
  // er den samme som i `trash` (fyll uten strek → strek oppå), slik at det
  // røde ikke spiser den indre halvdelen av rammestreken. `.icon-pin-light`
  // (styles.css) holder papiret hvitt og streken svart i BEGGE drakter — papir
  // er hvitt uansett hvor mørkt rommet er, så kalenderen skal ikke bli en mørk
  // klatt i mørk drakt slik de andre hvite ikonflatene gjør.
  calendar: '<svg class="icon icon-pin-light" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.5" y="5" width="17" height="16" rx="2.5" fill="#ffffff" stroke="none"></rect>' +
    '<path d="M3.5 9.5V7.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V9.5Z" fill="#c96b45" stroke="none"></path>' +
    '<rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect>' +
    '<path d="M8 3v4"></path><path d="M16 3v4"></path>' +
    '<path d="M3.5 9.5h17"></path>' +
    '</svg>',

  // Kalender med utropstegn (frist) — samme flate/rød topp som `calendar`,
  // samme `.icon-pin-light`-pinning.
  calendarDue: '<svg class="icon icon-pin-light" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.5" y="5" width="17" height="16" rx="2.5" fill="#ffffff" stroke="none"></rect>' +
    '<path d="M3.5 9.5V7.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V9.5Z" fill="#c96b45" stroke="none"></path>' +
    '<rect x="3.5" y="5" width="17" height="16" rx="2.5"></rect>' +
    '<path d="M8 3v4"></path><path d="M16 3v4"></path>' +
    '<path d="M3.5 9.5h17"></path>' +
    '<path d="M12 12v3.4"></path>' +
    '<circle cx="12" cy="18.1" r="0.7" fill="#111" stroke="none"></circle>' +
    '</svg>',

  // Varseltrekant (frist som haster eller er oversittet, i «Kommende
  // hendelser»): trekant hvit, utropstegn svart — samme papir/strek-par som
  // resten, så den snur riktig i mørk drakt.
  alert: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4.3 L21 19.7 L3 19.7 Z" fill="#ffffff"></path>' +
    '<path d="M12 10v4"></path>' +
    '<circle cx="12" cy="17" r="0.7" fill="#111" stroke="none"></circle>' +
    '</svg>',

  // Start/påbegynt (i «Kommende hendelser»): urskive hvit med en trekant —
  // bevisst IKKE en hake, som ville lest som «utført».
  play: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.5" fill="#ffffff"></circle>' +
    '<path d="M10.3 8.7 L15.9 12 L10.3 15.3 Z"></path>' +
    '</svg>',

  // Klokke (tidspunkt i dag): urskive hvit, visere svarte.
  clock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.5" fill="#ffffff"></circle>' +
    '<path d="M12 7.5V12l3 2.2"></path>' +
    '</svg>',

  /* «Utsett» i varselraden: klokka med en pil rundt seg — samme motiv som
     `clock`, men med retningen som skiller «vent litt» fra «klokkeslett».
     Streken følger drakten (currentColor): den står på selve raden, ikke på en
     kontraktsflate (docs/mork-drakt.md). */
  snooze: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 12a8 8 0 1 1-2.4-5.7"></path>' +
    '<path d="M20 4v3.4h-3.4"></path>' +
    '<path d="M12 7.6V12l2.9 2.1"></path>' +
    '</svg>',

  // Kategori (venstre klamme rundt en liten liste): brukes i navne-seksjonen i
  // kategoriens innstillingsmodal — svarte streker, ingen egen fyllflate.
  category: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H8.5"></path>' +
    '<circle cx="12.5" cy="8" r="0.8" fill="#111" stroke="none"></circle>' +
    '<path d="M15 8h4.5"></path>' +
    '<circle cx="12.5" cy="12" r="0.8" fill="#111" stroke="none"></circle>' +
    '<path d="M15 12h4.5"></path>' +
    '<circle cx="12.5" cy="16" r="0.8" fill="#111" stroke="none"></circle>' +
    '<path d="M15 16h4.5"></path>' +
    '</svg>',

  // Mappekategori (nav-modalen): samme venstre-klamme som `category`, men med
  // MAPPE-ikonet (mappe) i stedet for lista — «en klamme rundt mapper». Mappa
  // er den samme tegningen som `folder`, skalert ned og skjøvet inn i klammen
  // med en <g transform>; stroke-width kompenseres (1.05 / 0.55 = 1.909) så
  // streken blir like tykk som resten av ikonsettet etter skaleringen.
  groupCategory: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.5 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H8.5"></path>' +
    '<g transform="translate(8.5 5) scale(0.55)" stroke-width="1.909">' +
    '<path d="M3.5 19V6.5a2 2 0 0 1 2-2h3.3a2 2 0 0 1 1.6.8l1.1 1.5a2 2 0 0 0 1.6.8H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" fill="#c9a06a"></path>' +
    '</g>' +
    '</svg>',

  // Gjenopprett alle utførte (⟲): en åpen sirkel som retter seg ut i en rett
  // tangent og ender i en pilspiss som peker mot klokka — «rull tilbake».
  //
  // GEOMETRIEN (r=6.9 om (12,12); buen går fra θ=38° med klokka rundt til θ=305°,
  // altså et gap på 93°; θ måles med klokka fra toppen):
  //   - Sirkelen KUTTES ved θ=38° → (16.248, 6.563).
  //   - Derfra går et rett stykke på 3.4 langs TANGENTEN (38.01°) ut til spissen
  //     (13.569, 4.469). Stubben er nødvendig: legger man spissen rett på buen,
  //     vokser den indre haken ut av selve buen (klaring 0.74 mot en strek på
  //     1.05 — de smelter sammen), og hodet leser som skjevt uansett hvor
  //     symmetrisk det er regnet ut. Med stubben står begge hakene fritt.
  //   - Hakene er 3.1 lange og står på NØYAKTIG ±44° fra tangenten (målt på den
  //     ferdige banen: +44.00° / −44.01°), altså speilsymmetrisk om den.
  // Endres noe av dette, regn ut punktene på nytt — ikke flytt dem for hånd.
  //
  // Ren funksjons-glyf uten fyll (som bubbleBurst), med SVART strek (#111) som
  // resten av ikonsettet — knappen har sin egen hvite flate (se .done-restore).
  restoreArrow: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M13.569 4.469 16.248 6.563A6.9 6.9 0 1 1 6.348 8.042"></path>' +
    '<path d="M14 7.539 13.569 4.469 16.652 4.145"></path>' +
    '</svg>',

  // Oppløs kategori: en enkel sirkel med stiplet kant (boble som er i ferd med å
  // briste) — ingen stråler ut fra midten (unngår sol-uttrykket). Ingen fyll.
  bubbleBurst: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 4"></circle>' +
    '</svg>',
  // «Forlat deling» bruker samme dør-ut-ikon som «Logg ut» (samme handling for
  // brukeren: gå ut av noe). Det TILGJENGELIGE navnet settes på knappen, så
  // skjermlesere aldri forveksler de to.
  logout: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 3H6a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 6 21h3"></path>' +
    '<path d="M21 12H10"></path><path d="M17.5 8.5 21 12l-3.5 3.5"></path>' +
    '</svg>',
  // Objektmenyen (tre prikker loddrett): ÉN knapp per objekt — område, mappe,
  // mappekategori, liste, listepunkt og kategori — i stedet for tannhjul, ×,
  // del- og forlat-knapper. Fylte prikker med samme svarte strek som resten av
  // settet, så knappen leser like tydelig på farget korthode som på listeflaten.
  menuDots: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="5.2" r="2.05" fill="#c0c4c9"></circle>' +
    '<circle cx="12" cy="12" r="2.05" fill="#c0c4c9"></circle>' +
    '<circle cx="12" cy="18.8" r="2.05" fill="#c0c4c9"></circle>' +
    '</svg>',

  // Vinkel til høyre — trekkspillets utslagspil i objektmenyen. Roteres 90° av
  // CSS når undermenyen er åpen, så den peker ned.
  chevron: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9.5 5.5 16 12l-6.5 6.5"></path></svg>',

  // Blyant (endre navn) — skaft med fylt kropp og spiss ned mot venstre, i den
  // klassiske skarpe blyantgule (#e8bd3e) — mer mettet enn mappas tan og
  // bjellas messing, så de tre gulnyansene ikke smelter sammen.
  pencil: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15.6 4.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L9 19H5v-4Z" fill="#e8bd3e"></path>' +
    '<path d="M14.2 5.8 18.2 9.8"></path>' +
    '<path d="M5 15 9 19"></path>' +
    '</svg>',

  // Fire piler ut fra midten (flytt) — tastaturets/menyens motstykke til draget.
  moveArrows: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3.5v17"></path><path d="M3.5 12h17"></path>' +
    '<path d="M9.4 6.1 12 3.5l2.6 2.6"></path>' +
    '<path d="M9.4 17.9 12 20.5l2.6-2.6"></path>' +
    '<path d="M6.1 9.4 3.5 12l2.6 2.6"></path>' +
    '<path d="M17.9 9.4 20.5 12l-2.6 2.6"></path>' +
    '</svg>',

  // Pil opp/ned — «Flytt opp»/«Flytt ned» inne i flytte-undermenyen.
  arrowUp: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20V4.5"></path><path d="M6.5 10 12 4.5 17.5 10"></path></svg>',
  arrowDown: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 4v15.5"></path><path d="M6.5 14 12 19.5 17.5 14"></path></svg>',

  // Søppelkassen som REN GLYF (.btn-glyph): ingen grå fyllflate, kun streker i
  // currentColor, så den blir hvit på en massiv fargeknapp. Samme tegning som
  // «Slett konto» har inline i index.html — endrer du motivet, endre BEGGE.
  // Brukes av de røde «Slett … for alle»-knappene i del-modalen, som bygges i JS.
  trashGlyph: '<svg class="icon btn-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4.5 7.5h15"></path>' +
    '<path d="M9.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5"></path>' +
    '<path d="M6.3 7.5l.9 11a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.9-11"></path>' +
    '<path d="M9.7 11v6"></path><path d="M12 11v6"></path><path d="M14.3 11v6"></path>' +
    '</svg>',

  /* ARKIVKASSEN (docs/notater-plan.md). Motivet er en kasse med lokk — noe
     som er lagt bort, ikke kastet: den skal ikke kunne forveksles med
     søppelkassen ved siden av. Egne motivfarger som resten av ikonene
     (docs/mork-drakt.md, «Ikonfargene»): tre i lokket, papp i kroppen. */
  archive: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3.2" y="4" width="17.6" height="4.4" rx="1.2" fill="#c9a06a"></rect>' +
    '<path d="M4.8 8.4h14.4V19a1.6 1.6 0 0 1-1.6 1.6H6.4A1.6 1.6 0 0 1 4.8 19Z" fill="#e6d3b3"></path>' +
    '<rect x="3.2" y="4" width="17.6" height="4.4" rx="1.2"></rect>' +
    '<path d="M4.8 8.4h14.4V19a1.6 1.6 0 0 1-1.6 1.6H6.4A1.6 1.6 0 0 1 4.8 19Z"></path>' +
    '<path d="M9.8 12.2h4.4"></path>' +
    '</svg>',

  /* KOBLINGEN mellom en liste og et notat: to ledd som griper i hverandre.
     Samme tegning som lenkeverktøyet i notat-editoren, men med Huskis'
     ikonstrek og uten `currentColor` — den står i chips og menyrader, ikke i
     en verktøylinje. */
  link: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10 13.5a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1L11.4 7"></path>' +
    '<path d="M14 10.5a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1L12.6 17"></path>' +
    '</svg>',
};
