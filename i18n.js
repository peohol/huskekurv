/* ============================================================
   Huskis — i18n.js

   Språket i UI-et: norsk (`no`) eller engelsk (`en`). Hele språkmodellen —
   hvor valget lagres, hvem som vinner, og hvordan e-postene følger etter — er
   beskrevet i docs/sprak.md, som er autoritativ.

   Fila er ren data + noen få funksjoner, og lastes FØR app.js. Den har ingen
   avhengigheter og rører ingen tilstand utenom `<html lang>` og
   `localStorage['huskis-lang']`.

   ORDBOKEN (`T`) har én nøkkel per tekst, med begge språkene på samme linje:

     'key': ['norsk tekst', 'english text']

   Rekkefølgen er [no, en] — den samme som `LANGS`. Begge MÅ være med;
   tests/i18n.test.js feiler på en rad som mangler et språk, på en nøkkel ingen
   bruker, og på et `{felt}` som bare finnes i det ene språket.

   Tekst med innsatte verdier bruker `{navn}`-felt, aldri strengaddisjon:
   ordstillingen er ikke den samme på de to språkene, så bitene MÅ kunne bytte
   plass inne i oversettelsen.
   ============================================================ */
(function () {
  'use strict';

  // Rekkefølgen her er rekkefølgen i språkvelgeren, og indeksen i ordboken.
  var LANGS = [
    { code: 'no', label: 'Norsk',   html: 'no' },
    { code: 'en', label: 'English', html: 'en' },
  ];
  // Norsk er standard, ikke nettleserens språk: appen har vært norsk for alle
  // som allerede bruker den, og et automatisk bytte ville endret språket under
  // føttene på dem uten at de ba om det. Valget er brukerens — og det ligger
  // både på innloggingsskjermen og i konto-modalen.
  var DEFAULT = 'no';
  var STORAGE_KEY = 'huskis-lang';

  /* ---------------- Ordboken ---------------- */
  var T = {
    /* ==== HUSKIS_I18N_DICT_START ==== */

    /* ---- Felles ---- */
    'common.close':   ['Lukk', 'Close'],
    'common.cancel':  ['Avbryt', 'Cancel'],
    'common.save':    ['Lagre', 'Save'],
    'common.ok':      ['OK', 'OK'],
    'common.back':    ['Tilbake', 'Back'],
    'common.confirm': ['Bekreft', 'Confirm'],
    'common.retry':   ['Prøv igjen', 'Try again'],
    'common.remove':  ['Fjern', 'Remove'],
    'common.done':    ['Ferdig', 'Done'],
    // Anførselstegn rundt et objektnavn — ulike tegn på de to språkene.
    'common.quoted':  ['«{name}»', '“{name}”'],
    'common.unnamed': ['uten navn', 'unnamed'],
    'common.noName':  ['Uten navn', 'Untitled'],
    'common.noNameParen': ['(uten navn)', '(no name)'],

    /* ---- Objekttyper ---- */
    'kind.universe':    ['Område', 'Workspace'],
    'kind.group':       ['Mappe', 'Folder'],
    'kind.card':        ['Liste', 'List'],
    'kind.item':        ['Listepunkt', 'Item'],
    'kind.category':    ['Kategori', 'Category'],
    'kind.groupcat':    ['Mappekategori', 'Folder category'],
    'kind.idea':        ['Idé', 'Idea'],
    'kind.ideacat':     ['Idékategori', 'Idea category'],
    'kind.noteProject': ['Bokhylle', 'Bookshelf'],
    'kind.noteFolder':  ['Notatbok', 'Notebook'],
    'kind.note':        ['Notat', 'Note'],
    // Samme seks typene i bestemt form, slik de leses inne i en setning.
    'kindDef.universe': ['området', 'the workspace'],
    'kindDef.group':    ['mappen', 'the folder'],
    'kindDef.card':     ['listen', 'the list'],
    'kindDef.item':     ['listepunktet', 'the item'],
    'kindDef.category': ['kategorien', 'the category'],
    'kindDef.groupcat': ['mappekategorien', 'the folder category'],
    'kindDef.idea':     ['idéen', 'the idea'],
    'kindDef.ideacat':  ['idékategorien', 'the idea category'],
    'kindDef.noteProject': ['bokhyllen', 'the bookshelf'],
    'kindDef.noteFolder':  ['notatboken', 'the notebook'],
    'kindDef.note':        ['notatet', 'the note'],

    /* ---- Toppmeny og breadcrumb ---- */
    'crumb.youAreHere': ['Du er her', 'You are here'],
    'crumb.navTitle':   ['Områder og mapper – bytt, rediger og del',
                         'Workspaces and folders – switch, edit and share'],
    'nav.titleA':       ['Områder og', 'Workspaces and'],
    'nav.titleB':       ['mapper', 'folders'],
    'board.newList':    ['Ny liste', 'New list'],

    /* ---- Legg til / meny / redigering ---- */
    'add.group':      ['Legg til mappe', 'Add folder'],
    'add.groupCat':   ['Legg til mappekategori', 'Add folder category'],
    'add.groupInCat': ['Legg til mappe i kategorien', 'Add folder to the category'],
    'add.item':       ['Legg til listepunkt', 'Add item'],
    'add.cat':        ['Legg til kategori', 'Add category'],
    'add.itemInCat':  ['Legg til listepunkt i kategorien', 'Add item to the category'],
    'add.idea':       ['Legg til idé', 'Add idea'],
    'add.ideaCat':    ['Legg til idékategori', 'Add idea category'],
    'add.ideaInCat':  ['Legg til idé i kategorien', 'Add idea to the category'],
    'menu.menu':         ['Meny', 'Menu'],
    'menu.forUniverse':  ['Meny for området', 'Menu for the workspace'],
    'menu.forGroup':     ['Meny for mappen', 'Menu for the folder'],
    'menu.forGroupCat':  ['Meny for mappekategorien', 'Menu for the folder category'],
    'menu.forCard':      ['Meny for listen', 'Menu for the list'],
    'menu.forItem':      ['Meny for listepunktet', 'Menu for the item'],
    'menu.forCat':       ['Meny for kategorien', 'Menu for the category'],
    'menu.rename':       ['Endre navn', 'Rename'],
    'edit.clickToRename': ['Klikk for å endre navn', 'Click to rename'],
    'edit.clickToEdit':   ['Klikk for å redigere', 'Click to edit'],
    'item.markDone':      ['Merk som gjort', 'Mark as done'],
    'card.done':          ['Utført', 'Done'],
    'card.restoreAllDone': ['Gjenopprett alle utførte listepunkter', 'Restore all completed items'],
    'card.deleteAllDone': ['Slett alle utførte listepunkter', 'Delete all completed items'],

    /* ---- Idéer (docs/ideer.md) ---- */
    'ideas.title':      ['Idéer', 'Ideas'],
    'ideas.open':       ['Åpne idéene', 'Open the ideas'],
    'ideas.empty':      ['Ingen idéer ennå. Trykk på den grønne knappen for å skrive ned den første.',
                         'No ideas yet. Tap the green button to write down the first one.'],
    'idea.delete':      ['Slett idéen', 'Delete the idea'],
    'ideaCat.dissolve': ['Løs opp kategorien', 'Dissolve the category'],

    /* ---- Hovedfaner og Notater (docs/notater-plan.md) ---- */
    'tabs.aria':        ['Hoveddeler', 'Main sections'],
    'tabs.lists':       ['Lister', 'Lists'],
    'tabs.notes':       ['Notater', 'Notes'],
    'notes.crumbTitle': ['Bokhyller og notatbøker – bytt og gi nytt navn',
                         'Bookshelves and notebooks – switch and rename'],
    'notes.navTitleA':  ['Bokhyller og', 'Bookshelves and'],
    'notes.navTitleB':  ['notatbøker', 'notebooks'],
    'notes.freeNotes':  ['Frie notater', 'Loose notes'],
    'notes.newNote':    ['Nytt notat', 'New note'],
    'notes.newProject': ['Ny bokhylle', 'New bookshelf'],
    'notes.newFolder':  ['Ny notatbok', 'New notebook'],
    'notes.addProject': ['Ny bokhylle', 'New bookshelf'],
    'notes.addFolder':  ['Ny notatbok', 'New notebook'],
    'notes.emptyNoProjects': ['Ingen bokhyller ennå.', 'No bookshelves yet.'],
    'notes.emptyNoProjectsHint': ['Åpne {nav} og lag den første bokhyllen.',
                                  'Open {nav} and create the first bookshelf.'],
    'notes.emptyNoNotes': ['Ingen notater i {name} ennå.', 'No notes in {name} yet.'],
    'notes.emptyNoNotesHint': ['Trykk {plus} for å skrive det første.',
                               'Tap {plus} to write the first one.'],
    'notes.back':       ['Tilbake', 'Back'],
    'notes.toolbar':    ['Formatering', 'Formatting'],
    'notes.title':      ['Tittel', 'Title'],
    'notes.titlePlaceholder': ['Tittel', 'Title'],
    'notes.body':       ['Notatets innhold', 'Note content'],
    'notes.saving':     ['Lagrer …', 'Saving …'],
    'notes.saved':      ['Lagret', 'Saved'],
    'notes.savedDevice': ['Lagret på denne enheten', 'Saved on this device'],
    'notes.readOnly':   ['Kun lesing', 'Read only'],
    'notes.othersEditing': ['Andre redigerer nå', 'Others are editing'],
    'notes.h1':         ['Overskrift 1', 'Heading 1'],
    'notes.h2':         ['Overskrift 2', 'Heading 2'],
    'notes.h3':         ['Overskrift 3', 'Heading 3'],
    'notes.bold':       ['Fet (Ctrl+B)', 'Bold (Ctrl+B)'],
    'notes.italic':     ['Kursiv (Ctrl+I)', 'Italic (Ctrl+I)'],
    'notes.underline':  ['Understrek (Ctrl+U)', 'Underline (Ctrl+U)'],
    'notes.superscript': ['Hevet skrift', 'Superscript'],
    'notes.subscript':  ['Senket skrift', 'Subscript'],
    'notes.link':       ['Lenke (Ctrl+K)', 'Link (Ctrl+K)'],
    'notes.linkAddress': ['Lenkeadresse', 'Link address'],
    'notes.linkPlaceholder': ['eksempel.no/side', 'example.com/page'],
    'notes.linkApply':  ['Bruk', 'Apply'],
    'notes.linkOpen':   ['Åpne', 'Open'],
    'notes.linkCopy':   ['Kopier', 'Copy'],
    'notes.linkRemove': ['Fjern lenke', 'Remove link'],
    'notes.linkCopied': ['Adressen er kopiert.', 'The address was copied.'],
    'notes.linkCopyFailed': ['Kunne ikke kopiere adressen.', 'Could not copy the address.'],
    'notes.linkOpenFailed': ['Kunne ikke åpne adressen. Kopier den i stedet.',
                             'Could not open the address. Copy it instead.'],
    'notes.linkInvalid': ['Adressen kan ikke brukes.', 'That address cannot be used.'],
    'notes.linkNeedsSelection': ['Marker teksten lenken skal ligge på først.',
                                 'Select the text the link should cover first.'],
    'notes.noteMenu':   ['Notatmeny', 'Note menu'],

    /* Utklippstavlen (docs/notater-plan.md). «Kopier alt» legger notatet på
       utklippstavlen med formatering der plattformen støtter det, og som ren
       tekst der den ikke gjør det — tilbakemeldingen sier hvilken av delene
       som faktisk skjedde. */
    'notes.copyAll':    ['Kopier alt', 'Copy everything'],
    'notes.copyAllHint': ['Hele notatet, med formatering', 'The whole note, with formatting'],
    'notes.copyMarkdown': ['Kopier som Markdown', 'Copy as Markdown'],
    'notes.copyMarkdownHint': ['Ren tekst med Markdown-koder', 'Plain text with Markdown codes'],
    'notes.copied':     ['Notatet er kopiert.', 'The note was copied.'],
    'notes.copiedMarkdown': ['Markdown er kopiert.', 'The Markdown was copied.'],
    'notes.copiedPlain': ['Notatet er kopiert som ren tekst — denne nettleseren kopierer ikke formatering.',
                          'The note was copied as plain text — this browser cannot copy formatting.'],
    'notes.copyFailed': ['Kunne ikke kopiere notatet.', 'Could not copy the note.'],

    /* Livssyklus: arkiv og søppelkasse for alle tre nivåene
       (docs/notater-plan.md). «Arkiver» legger til side; «Slett» legger i
       søppelkassen, som fortsatt kan hentes fra. */
    'notes.archive':    ['Arkiver', 'Archive'],
    'notes.unarchive':  ['Hent ut av arkivet', 'Take out of the archive'],
    'notes.archiveHint': ['Legges til side, ikke slettet', 'Set aside, not deleted'],
    'notes.archived':   ['{name} er lagt i arkivet.', '{name} was moved to the archive.'],
    'notes.unarchived': ['{name} er hentet ut av arkivet.', '{name} was taken out of the archive.'],
    'notes.archiveNote': ['Hent tilbake det du vil bruke igjen. Resten kan du legge i søppelkassen — derfra kan det fortsatt hentes.',
                          'Bring back what you want to use again. The rest can go to the trash — you can still get it back from there.'],
    'notes.archiveEmptyAll': ['Legg alt i søppelkassen', 'Move everything to the trash'],
    'notes.delete.note':        ['Slett notatet', 'Delete the note'],
    'notes.delete.noteFolder':  ['Slett notatboken', 'Delete the notebook'],
    'notes.delete.noteProject': ['Slett bokhyllen', 'Delete the bookshelf'],
    'notes.deleteAria': ['Slett {name}', 'Delete {name}'],
    'notes.foldersPurgedFreed': ['{count} notater ligger nå som frie notater i bokhyllen.',
                                 '{count} notes are now loose notes in the bookshelf.'],
    'notes.trashNotesIn':   ['Slettede notater – {name}', 'Deleted notes – {name}'],
    'notes.trashFoldersIn': ['Slettede notatbøker – {name}', 'Deleted notebooks – {name}'],
    'notes.trashProjects':  ['Slettede bokhyller', 'Deleted bookshelves'],
    'notes.purgeNotes':     ['Slett notatene for godt', 'Delete the notes for good'],
    'notes.purgeFolders':   ['Slett notatbøkene for godt', 'Delete the notebooks for good'],
    'notes.purgeProjects':  ['Slett bokhyllene for godt', 'Delete the bookshelves for good'],
    'notes.noTrashedNotes':   ['Ingen slettede notater.', 'No deleted notes.'],
    'notes.noTrashedFolders': ['Ingen slettede notatbøker.', 'No deleted notebooks.'],
    'notes.noTrashedProjects': ['Ingen slettede bokhyller.', 'No deleted bookshelves.'],
    'notes.archiveNotesIn':   ['Arkiverte notater – {name}', 'Archived notes – {name}'],
    'notes.archiveFoldersIn': ['Arkiverte notatbøker – {name}', 'Archived notebooks – {name}'],
    'notes.archiveProjects':  ['Arkiverte bokhyller', 'Archived bookshelves'],
    'notes.noArchivedNotes':   ['Ingen arkiverte notater.', 'No archived notes.'],
    'notes.noArchivedFolders': ['Ingen arkiverte notatbøker.', 'No archived notebooks.'],
    'notes.noArchivedProjects': ['Ingen arkiverte bokhyller.', 'No archived bookshelves.'],
    'notes.trashNotesTitle':  ['Slettede notater – trykk for å åpne, hold og sveip for å slette dem for godt',
                               'Deleted notes – tap to open, hold and swipe to delete them for good'],
    'notes.archiveNotesTitle': ['Arkiverte notater – trykk for å åpne arkivet',
                                'Archived notes – tap to open the archive'],
    'notes.trashFoldersTitle': ['Slettede notatbøker – trykk for å åpne, hold og sveip for å slette dem for godt',
                                'Deleted notebooks – tap to open, hold and swipe to delete them for good'],
    'notes.archiveFoldersTitle': ['Arkiverte notatbøker – trykk for å åpne arkivet',
                                  'Archived notebooks – tap to open the archive'],
    'notes.trashProjectsTitle': ['Slettede bokhyller – trykk for å åpne, hold og sveip for å slette dem for godt',
                                 'Deleted bookshelves – tap to open, hold and swipe to delete them for good'],
    'notes.archiveProjectsTitle': ['Arkiverte bokhyller – trykk for å åpne arkivet',
                                   'Archived bookshelves – tap to open the archive'],
    'notes.trashCount':   ['{count} slettede notater', '{count} deleted notes'],
    'notes.archiveCount': ['{count} arkiverte notater', '{count} archived notes'],
    'notes.trashFoldersCount':   ['{count} slettede notatbøker i {name}', '{count} deleted notebooks in {name}'],
    'notes.archiveFoldersCount': ['{count} arkiverte notatbøker i {name}', '{count} archived notebooks in {name}'],
    'notes.trashProjectsCount':   ['{count} slettede bokhyller', '{count} deleted bookshelves'],
    'notes.archiveProjectsCount': ['{count} arkiverte bokhyller', '{count} archived bookshelves'],

    /* Koblinger mellom Lister og Notater (docs/notater-plan.md). */
    'links.menuRow':    ['Koblinger', 'Links'],
    'links.forObject':  ['Koblinger for {name}', 'Links for {name}'],
    'links.existing':   ['Koblet til', 'Linked to'],
    'links.none':       ['Ingen koblinger ennå.', 'No links yet.'],
    'links.add':        ['Legg til kobling', 'Add a link'],
    'links.pickLabel':  ['Søk etter det du vil koble til', 'Search for what you want to link to'],
    'links.pickPlaceholder': ['Skriv for å søke', 'Type to search'],
    'links.added':      ['Koblingen er laget.', 'The link was created.'],
    'links.remove':     ['Fjern koblingen', 'Remove the link'],
    'links.removeAria': ['Fjern koblingen til {name}', 'Remove the link to {name}'],
    'links.count':      ['{count} koblinger', '{count} links'],
    'links.openAria':   ['Åpne de {count} koblingene', 'Open the {count} links'],
    'links.unavailable': ['Dette er ikke tilgjengelig lenger.', 'This is no longer available.'],
    'links.unavailableName': ['Ikke tilgjengelig', 'Not available'],

    'notes.symbol':     ['Spesialtegn', 'Special characters'],
    'notes.bullets':    ['Punktliste', 'Bulleted list'],
    'notes.numbers':    ['Nummerert liste', 'Numbered list'],
    'notes.hr':         ['Skillelinje', 'Divider'],
    'notes.undo':       ['Angre (Ctrl+Z)', 'Undo (Ctrl+Z)'],
    'notes.redo':       ['Gjør om igjen (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)'],

    /* ---- Søppelkasse ---- */
    'trash.title':             ['Søppelkasse', 'Trash'],
    'trash.purge':             ['Slett for godt', 'Delete for good'],
    'trash.cards':             ['Slettede lister', 'Deleted lists'],
    'trash.cardsBtnTitle':     ['Slettede lister – trykk for å åpne, hold og sveip for å slette dem for godt',
                                'Deleted lists – tap to open, press and swipe to delete them for good'],
    'trash.universes':         ['Slettede områder', 'Deleted workspaces'],
    'trash.universesBtnTitle': ['Slettede områder – trykk for å åpne, hold og sveip for å slette dem for godt',
                                'Deleted workspaces – tap to open, press and swipe to delete them for good'],

    /* ---- Del, flytt, tid, ansvarlig ---- */
    'share.title': ['Del', 'Share'],
    'place.title': ['Flytt listen til', 'Move the list to'],
    'time.edit':   ['Endre tid', 'Edit time'],
    'resp.pick':   ['Velg ansvarlig', 'Choose an assignee'],

    /* ---- Språk ---- */
    /* Etiketten står på BEGGE språk i begge ordbøkene: den som havner i feil
       språk skal kjenne igjen ordet uten å kunne lese resten av menyen. */
    'lang.label': ['Språk · Language', 'Språk · Language'],
    'lang.aria':  ['Språk i appen og i e-postene', 'Language in the app and in emails'],

    /* ---- Drakt (lys/mørk) ---- */
    /* To valg, ingen «følg systemet» — se docs/mork-drakt.md. Draktknappen
       (headeren og innloggingsskjermen deler samme knapp) har ingen synlig
       tekst — `theme.toLight`/`theme.toDark` er tittel/aria-label alene: de
       sier hvilken handling ETT trykk utfører (samme mønster som
       auth.showPassword). */
    'theme.toLight': ['Bytt til lys drakt', 'Switch to light appearance'],
    'theme.toDark':  ['Bytt til mørk drakt', 'Switch to dark appearance'],

    /* ---- Konto ---- */
    'account.title':            ['Konto', 'Account'],
    'account.open':             ['Åpne kontoen', 'Open your account'],
    /* Overskriftene på de tre trekkspill-skuffene (docs/menus.md). */
    'account.sectionProfile':   ['Rediger kontoopplysninger', 'Edit account details'],
    'account.sectionTips':      ['Tips', 'Tips'],
    'account.sectionSession':   ['Logg ut / slett konto', 'Sign out / delete account'],
    'account.photo':            ['Bilde', 'Picture'],
    'account.changePhoto':      ['Endre profilbilde', 'Change profile picture'],
    'account.changePhotoShort': ['Endre bilde', 'Change picture'],
    'account.removePhotoShort': ['Fjern bilde', 'Remove picture'],
    'account.name':             ['Navn', 'Name'],
    'account.namePlaceholder':  ['Fornavn Etternavn', 'First name Last name'],
    'account.email':            ['E-post', 'Email'],
    'account.password':         ['Passord', 'Password'],
    'account.currentPassword':  ['Nåværende passord', 'Current password'],
    'account.newPassword':      ['Nytt passord (minst 6 tegn)', 'New password (at least 6 characters)'],
    'account.emailPrefLabel':   ['Varsle meg på e-post når noe deles med meg',
                                 'Email me when something is shared with me'],
    'account.emailPrefAria':    ['E-postvarsler ved deling', 'Email notifications for sharing'],
    'account.tourLabel':        ['Demonstrasjon av Huskis', 'Huskis demo'],
    'account.tourRestart':      ['Vis på nytt', 'Show again'],
    'account.keyboard':         ['Tastatursnarveier', 'Keyboard shortcuts'],
    'account.keyMove':          ['Flytt det valgte objektet ett hakk', 'Move the selected object one step'],
    'account.keyMoveTo':        ['Flytt til en annen liste, mappe eller område',
                                 'Move to another list, folder or workspace'],
    'account.keyEsc':           ['Lukk – eller avbryt en navneendring', 'Close – or cancel a rename'],
    'account.invites':          ['Invitasjoner', 'Invitations'],
    'account.logout':           ['Logg ut', 'Sign out'],
    'account.delete':           ['Slett konto', 'Delete account'],
    'account.deleteMsg':        ['Dette sletter kontoen din for godt. Det kan ikke angres.',
                                 'This deletes your account for good. It cannot be undone.'],
    'account.deleteBullet1':    ['Områder du er eneste eier av slettes med alt innholdet — også for dem du har delt med.',
                                 'Workspaces you are the only owner of are deleted with all their content — for everyone you have shared them with too.'],
    'account.deleteBullet2':    ['Du fjernes fra alt som er delt med deg. Innhold du har laget i andres områder blir stående hos dem.',
                                 'You are removed from everything shared with you. Content you created in other people’s workspaces stays with them.'],
    'account.deleteBullet3':    ['Navnet ditt, e-postadressen, profilbildet og invitasjonene dine slettes fra databasen.',
                                 'Your name, email address, profile picture and invitations are deleted from the database.'],
    'account.deleteSwipeHint':  ['Sveip helt til høyre for å bekrefte.', 'Swipe all the way right to confirm.'],
    'account.deleteSwipeAria':  ['Sveip helt til høyre for å slette kontoen',
                                 'Swipe all the way right to delete the account'],

    /* ---- Profilbilde ---- */
    'avatar.title':    ['Profilbilde', 'Profile picture'],
    'avatar.hint':     ['Dra bildet for å flytte det. Sirkelen viser hvordan det blir seende ut.',
                        'Drag the picture to move it. The circle shows how it will look.'],
    'avatar.zoom':     ['Zoom', 'Zoom'],
    'avatar.rotation': ['Rotasjon', 'Rotation'],
    'avatar.rotate90': ['Roter 90°', 'Rotate 90°'],
    'avatar.use':      ['Bruk bildet', 'Use this picture'],

    /* ---- Innlogging ---- */
    'auth.login':               ['Logg inn', 'Sign in'],
    'auth.firstName':           ['Fornavn', 'First name'],
    'auth.lastName':            ['Etternavn', 'Last name'],
    'auth.emailPlaceholder':    ['deg@eksempel.no', 'you@example.com'],
    'auth.passwordPlaceholder': ['Minst 6 tegn', 'At least 6 characters'],
    'auth.showPassword':        ['Vis passordet', 'Show password'],
    'auth.hidePassword':        ['Skjul passordet', 'Hide password'],
    'auth.toRegister':          ['Ny bruker? Registrer deg', 'New here? Create an account'],
    'auth.toForgot':            ['Glemt passord?', 'Forgot your password?'],
    'auth.backToLogin':         ['Tilbake til innlogging', 'Back to sign in'],

    /* ---- Demonstrasjonen ---- */
    'tour.progress': ['Framdrift i demonstrasjonen', 'Demo progress'],
    'tour.start':    ['Kom i gang', 'Get started'],
    'tour.close':    ['Avslutt demonstrasjonen', 'End the demo'],

    /* ---- Eksempeldata (kun når skyen ikke er konfigurert) ---- */
    'seed.chores':    ['Ukens gjøremål', 'This week’s chores'],
    'seed.garage':    ['Rydde garasjen', 'Tidy the garage'],
    'seed.dentist':   ['Ringe tannlegen', 'Call the dentist'],
    'seed.flowers':   ['Vanne blomstene', 'Water the flowers'],
    'seed.packing':   ['Pakke til tur', 'Packing for a trip'],
    'seed.raincoat':  ['Regnjakke', 'Rain jacket'],
    'seed.charger':   ['Ladekabel', 'Charging cable'],
    'seed.bottle':    ['Drikkeflaske', 'Water bottle'],
    'seed.map':       ['Kart', 'Map'],
    'seed.ideas':     ['Ideer', 'Ideas'],
    'seed.fence':     ['Male gjerdet', 'Paint the fence'],
    'seed.coffeeBar': ['Prøve ny kaffebar', 'Try the new coffee bar'],
    'seed.groceries': ['Dagligvarer', 'Groceries'],
    'seed.milk':      ['Melk', 'Milk'],
    'seed.bread':     ['Brød', 'Bread'],
    'seed.eggs':      ['Egg', 'Eggs'],
    'seed.butter':    ['Smør', 'Butter'],
    'seed.coffee':    ['Kaffe', 'Coffee'],
    'seed.dinner':    ['Middag i kveld', 'Dinner tonight'],
    'seed.chicken':   ['Kyllingfilet', 'Chicken breast'],
    'seed.rice':      ['Ris', 'Rice'],
    'seed.broccoli':  ['Brokkoli', 'Broccoli'],
    'seed.soy':       ['Soyasaus', 'Soy sauce'],
    'seed.pharmacy':  ['Apotek', 'Pharmacy'],
    'seed.plaster':   ['Plaster', 'Plasters'],
    'seed.sunscreen': ['Solkrem', 'Sunscreen'],

    /* ---- Opplesning (aria-live) ---- */
    'a11y.cannotReorder': ['Kan ikke endre rekkefølgen på {name} her.',
                           'Cannot reorder {name} here.'],
    'a11y.alreadyFirst':  ['{name} står allerede først.', '{name} is already first.'],
    'a11y.alreadyLast':   ['{name} står allerede sist.', '{name} is already last.'],
    'a11y.cannotSwap':    ['Kan ikke bytte plass med {name}.', 'Cannot swap places with {name}.'],
    'a11y.movedUp':       ['{name} flyttet opp til plass {pos} av {total}.',
                           '{name} moved up to position {pos} of {total}.'],
    'a11y.movedDown':     ['{name} flyttet ned til plass {pos} av {total}.',
                           '{name} moved down to position {pos} of {total}.'],
    'a11y.cannotMoveOutOfGroup': ['Du kan ikke flytte {name} ut av denne mappen.',
                                  'You cannot move {name} out of this folder.'],
    'a11y.noOtherGroup':  ['Det finnes ingen annen mappe å flytte {name} til.',
                           'There is no other folder to move {name} to.'],
    'a11y.listLocked':    ['Listen er låst.', 'The list is locked.'],
    'a11y.noOtherListOrCategory': ['Det finnes ingen annen liste eller kategori å flytte til.',
                                   'There is no other list or category to move to.'],
    'a11y.movedToList':   ['Flyttet {name} til listen {dest}.', 'Moved {name} to the list {dest}.'],
    'a11y.movedIntoCategory':  ['Flyttet {name} inn i en kategori.', 'Moved {name} into a category.'],
    'a11y.movedOutOfCategory': ['Flyttet {name} ut av kategorien.', 'Moved {name} out of the category.'],
    'a11y.cannotMoveToOtherUniverse': ['Du kan ikke flytte {name} til et annet område.',
                                       'You cannot move {name} to another workspace.'],
    'a11y.noOtherUniverse': ['Det finnes ikke noe annet område å flytte til.',
                             'There is no other workspace to move to.'],
    'a11y.movedToUniverse': ['Flyttet {name} til området {dest}.', 'Moved {name} to the workspace {dest}.'],
    'a11y.universeIsTop':   ['Et område er øverste nivå og kan ikke flyttes.',
                             'A workspace is the top level and cannot be moved.'],
    'a11y.categoryCannotMove': ['En kategori kan ikke flyttes til en annen forelder.',
                                'A category cannot be moved to another parent.'],
    'a11y.wentTo':        ['Gikk til {kind} {name}.', 'Went to {kind} {name}.'],

    /* ---- Globalt søk (docs/sok-og-navigering.md) ---- */
    'search.title':        ['Søk', 'Search'],
    'search.placeholder':  ['Skriv for å søke', 'Type to search'],
    'search.inputLabel':   ['Søketekst', 'Search text'],
    'search.resultsLabel': ['Søkeresultater', 'Search results'],
    'search.scopeLabel':   ['Hva det søkes i', 'What to search'],
    'search.scope.all':    ['Alt', 'All'],
    'search.scope.lists':  ['Lister', 'Lists'],
    'search.scope.notes':  ['Notater', 'Notes'],
    'search.hint.all':     ['Søket dekker alt du har tilgang til — i både Lister og Notater.',
                            'Search covers everything you have access to — in both Lists and Notes.'],
    'search.hint.lists':   ['Søket dekker områder, mapper, lister, kategorier og listepunkter.',
                            'Search covers workspaces, folders, lists, categories and items.'],
    'search.hint.notes':   ['Søket dekker bokhyller, notatbøker, notattitler og selve notatteksten.',
                            'Search covers bookshelves, notebooks, note titles and the note text itself.'],
    'search.noHits':       ['Ingen treff på {q}.', 'No matches for {q}.'],
    'search.hits.one':     ['{n} treff.', '{n} match.'],
    'search.hits.other':   ['{n} treff.', '{n} matches.'],
    'search.more':         ['Viser de {shown} første av {total} treff. Skriv mer for å snevre inn.',
                            'Showing the first {shown} of {total} matches. Type more to narrow it down.'],
    'search.gone':         ['Objektet finnes ikke lenger.', 'That object no longer exists.'],

    /* ---- Kommende hendelser (docs/kommende-hendelser.md) ---- */
    'events.title':        ['Kommende hendelser', 'Upcoming events'],
    'events.empty':        ['Ingen kommende frister eller starttider.',
                            'No upcoming deadlines or start times.'],
    // Tomt fordi tidshorisonten tok alt — noe brukeren selv kan gjøre om på.
    'events.emptyHorizon': ['Ingen hendelser innenfor denne tidshorisonten.',
                            'No events within this time horizon.'],
    'events.dueTitle':     ['Tidsfrister', 'Deadlines'],
    'events.dueOver':      ['Frist utløpt', 'Overdue'],
    'events.dueSoon':      ['Frist innen en uke', 'Due within a week'],
    'events.dueMonth':     ['Frist innen en måned', 'Due within a month'],
    'events.dueFar':       ['Frist om mer enn en måned', 'Due in more than a month'],
    'events.startTitle':   ['Starttider', 'Start times'],
    'events.startStarted': ['Har begynt', 'Has started'],
    'events.startSoon':    ['Begynner innen en uke', 'Starts within a week'],
    'events.startMonth':   ['Begynner innen en måned', 'Starts within a month'],
    'events.startFar':     ['Begynner om mer enn en måned', 'Starts in more than a month'],
    /* Tidshorisonten: bryteren over listen. «Alle» er standard, og de to andre
       er de samme grensene gruppene deler tiden på. */
    'events.horizonTitle': ['Tidshorisont', 'Time horizon'],
    'events.horizonWeek':  ['1 uke', '1 week'],
    'events.horizonMonth': ['1 måned', '1 month'],
    'events.horizonAll':   ['Alle', 'All'],
    // Radens opplesning: navnet først, så type, tid og sti.
    'events.rowLabel':     ['{name}, {kind}. {when}. {path}', '{name}, {kind}. {when}. {path}'],
    /* Avstanden i tid, vist over datoen på radens høyre side — kun innenfor sju
       døgn. Enheten er egen nøkkel: «t» heter «h» på engelsk. */
    'events.relIn':        ['Om {n} {unit}', 'In {n} {unit}'],
    'events.relAgo':       ['{n} {unit} siden', '{n} {unit} ago'],
    'events.unitDay':      ['d', 'd'],
    'events.unitHour':     ['t', 'h'],
    // Tid + avstand i ÉN opplesning («Frist: 5. jan — om 3 d»).
    'events.whenRel':      ['{when} — {rel}', '{when} — {rel}'],
    'events.count.one':    ['{n} hendelse.', '{n} event.'],
    'events.count.other':  ['{n} hendelser.', '{n} events.'],

    /* ---- Varsler (docs/varsler.md) ---- */
    'notif.title':          ['Varsler', 'Notifications'],
    // Ulest-antallet hører til knappens NAVN, ikke bare til badgen.
    'notif.titleUnread':    ['Varsler, {n} uleste', 'Notifications, {n} unread'],
    'notif.empty':          ['Ingen varsler ennå.', 'No notifications yet.'],
    'notif.count.one':      ['{n} varsel, {unread} ulest.', '{n} notification, {unread} unread.'],
    'notif.count.other':    ['{n} varsler, {unread} uleste.', '{n} notifications, {unread} unread.'],
    'notif.read':           ['Lest', 'Read'],
    'notif.unread':         ['Ulest', 'Unread'],
    // De fire typene — også overskriftene i preferansepanelet.
    'notif.type.dueOver':   ['Frist utløpt', 'Deadline passed'],
    'notif.type.dueSoon':   ['Frist om mindre enn en uke', 'Deadline in less than a week'],
    'notif.type.startNow':  ['Begynner nå', 'Starting now'],
    'notif.type.startSoon': ['Begynner om mindre enn en uke', 'Starts in less than a week'],
    /* Selve meldingen i raden. `{time}` er objektets egen frist/starttid, og de
       tre nærmeste døgnene skrives med navn («i dag kl. 09:00»). */
    'notif.msg.dueOver':    ['Fristen er utløpt – den var {time}.',
                             'The deadline has passed – it was {time}.'],
    'notif.msg.dueSoon':    ['Fristen utløper {time}.', 'The deadline is {time}.'],
    'notif.msg.startNow':   ['Begynte {time}.', 'Started {time}.'],
    'notif.msg.startSoon':  ['Begynner {time}.', 'Starts {time}.'],
    'notif.rowGoneMeta':    ['{msg} Objektet er ikke tilgjengelig lenger.',
                             '{msg} That object is no longer available.'],
    'notif.rowLabel':       ['{state}. {name}, {kind}. {msg} {when}. {path}',
                             '{state}. {name}, {kind}. {msg} {when}. {path}'],
    'notif.gone':           ['Objektet er ikke tilgjengelig lenger.',
                             'That object is no longer available.'],
    // Datooverskriftene som samler varslene som kom samme døgn.
    'notif.day.today':      ['I dag', 'Today'],
    'notif.day.yesterday':  ['I går', 'Yesterday'],
    // «Tøm varsler» + angre-vinduet (nedtelling i sekunder).
    'notif.clear':          ['Tøm varsler', 'Clear notifications'],
    'notif.undo':           ['Angre · {n}', 'Undo · {n}'],
    'notif.clearFailed':    ['Varslene ble ikke slettet. Prøv igjen.',
                             'The notifications were not deleted. Try again.'],
    /* «Utsett» — be om det samme varselet igjen senere. Valgene ligger i en
       popover ved knappen, under en overskrift som bærer «om», så selve valgene
       er rene varigheter. */
    'notif.snooze':         ['Utsett varselet om {name}', 'Snooze the notification about {name}'],
    'notif.snoozeTitle':    ['Varsle på nytt om', 'Notify me again in'],
    'notif.snooze.hour':    ['1 time', '1 hour'],
    'notif.snooze.sixHours': ['6 timer', '6 hours'],
    'notif.snooze.day':     ['1 døgn', '1 day'],
    'notif.snooze.custom':  ['Egendefinert', 'Custom'],
    'notif.snoozeDate':     ['Dato for neste varsel', 'Date of the next notification'],
    'notif.snoozeClock':    ['Klokkeslett for neste varsel', 'Time of the next notification'],
    'notif.snoozeOk':       ['Varsle meg da', 'Notify me then'],
    'notif.snoozePast':     ['Velg et tidspunkt fram i tid.', 'Choose a time in the future.'],
    'notif.snoozedTo':      ['Varsler deg igjen {time}.', 'You will be notified again {time}.'],
    'notif.snoozeFailed':   ['Varselet ble ikke utsatt. Prøv igjen.',
                             'The notification was not snoozed. Try again.'],
    /* Er et nytt varsel alt bestilt, sier knappen det — og popoveren tilbyr da
       ikke ett til, men forteller når det kommer og lar deg avbryte det. */
    'notif.snoozeArmed':    ['Et nytt varsel om {name} er planlagt',
                             'A new notification about {name} is scheduled'],
    'notif.snoozedFor':     ['Du vil bli varslet igjen kl. {clock}.',
                             'You will be notified again at {clock}.'],
    'notif.snoozedForDate': ['Du vil bli varslet igjen kl. {clock}, {date}.',
                             'You will be notified again at {clock}, {date}.'],
    'notif.snoozeCancel':   ['Avbryt det planlagte varselet', 'Cancel the scheduled notification'],
    'notif.snoozeCancelled': ['Det planlagte varselet er avbrutt.',
                              'The scheduled notification is cancelled.'],
    // Slett ÉN rad (mot «Tøm varsler», som tar bunken).
    'notif.delete':         ['Slett varselet om {name}', 'Delete the notification about {name}'],
    'notif.deleteFailed':   ['Varselet ble ikke slettet. Prøv igjen.',
                             'The notification was not deleted. Try again.'],
    // Tilbake fra innstillingene til selve varslene.
    'notif.backToList':     ['Tilbake til varslene', 'Back to the notifications'],
    // Preferansene: de styrer om hendelsen i det hele tatt blir til.
    'notif.settings':       ['Varselinnstillinger', 'Notification settings'],
    'notif.prefFailed':     ['Innstillingen ble ikke lagret. Prøv igjen.',
                             'The setting was not saved. Try again.'],
    /* Varsel-toasten: samme hendelse som raden, men kortere — den skal leses i
       forbifarten, ikke studeres. `{when}` er avstanden i hele døgn. */
    'notif.toast.dueOver':   ['Fristen er utløpt', 'The deadline has passed'],
    'notif.toast.dueSoon':   ['Fristen utløper {when}', 'The deadline is {when}'],
    'notif.toast.startNow':  ['Starter nå', 'Starting now'],
    'notif.toast.startSoon': ['Starter {when}', 'Starts {when}'],
    'notif.toastLabel':      ['{kind}: {name}. {msg}. Åpne varselet.',
                              '{kind}: {name}. {msg}. Open the notification.'],

    /* ---- De EKSTERNE kanalene: Android-varsler og web push ----
       Kanalen er per ENHET (nettleser eller app-installasjon), mens de fire
       typene over er per BRUKER. Teksten under bryteren forklarer hvorfor
       tillatelsen trengs FØR systemdialogen utløses — den skal aldri komme
       som et overraskelsesangrep ved første sidevisning. */
    'notif.channel.title':   ['Varsler på denne enheten', 'Notifications on this device'],
    'notif.channel.lead':    ['Få de samme varslene som systemvarsler, også når Huskis er lukket. Enheten spør om tillatelse når du slår det på.',
                              'Get the same notifications as system notifications, also when Huskis is closed. Your device will ask for permission when you turn this on.'],
    'notif.channel.on':      ['På. Varslene kommer også når Huskis er lukket.',
                              'On. Notifications arrive even when Huskis is closed.'],
    'notif.channel.onMore.one':   ['På her og på {n} annen enhet.', 'On here and on {n} other device.'],
    'notif.channel.onMore.other': ['På her og på {n} andre enheter.', 'On here and on {n} other devices.'],
    'notif.channel.denied':  ['Blokkert. Slå på varsler for Huskis i enhetens innstillinger, og prøv igjen.',
                              'Blocked. Allow notifications for Huskis in your device settings, then try again.'],
    'notif.channel.unsupported': ['Denne enheten kan ikke vise varsler utenfor Huskis. Varslene står fortsatt i listen her.',
                                  'This device cannot show notifications outside Huskis. They are still listed here.'],
    /* Forhåndsvisninger er ikke produksjon: hver av dem har sin egen adresse,
       og et varsel-abonnement derfra ville dukket opp som en enhet du aldri
       har bedt om. Se docs/domains-and-urls.md. */
    'notif.channel.preview': ['Eksterne varsler er slått av i forhåndsvisninger. Varslene står fortsatt i listen her.',
                              'External notifications are off in previews. They are still listed here.'],
    'notif.channel.failed':  ['Varslene ble ikke slått på. Prøv igjen.',
                              'Notifications were not turned on. Try again.'],
    /* ---- Enheter og økter (konto-modalen, docs/accounts.md) ----
       To lister med hver sin betydning, og ordene skal holde dem fra
       hverandre: «innlogget» er tilgang til kontoen, «varsler på» er at
       varslene også kommer utenfor appen. */
    'devices.section':      ['Enheter og økter', 'Devices and sessions'],
    'devices.sessions':     ['Innloggede enheter', 'Signed-in devices'],
    'devices.sessionsLead': ['Her har Huskis-kontoen din tilgang nå.',
                             'Your Huskis account is signed in here right now.'],
    'devices.push':         ['Enheter med varsler', 'Devices with notifications'],
    'devices.pushLead':     ['Her kommer varslene også når Huskis er lukket.',
                             'These get notifications even when Huskis is closed.'],
    'devices.showPush':     ['Vis enheter', 'Show devices'],
    'devices.thisDevice':   ['Denne enheten', 'This device'],
    'devices.unknown':      ['Ukjent enhet', 'Unknown device'],
    'devices.loading':      ['Henter …', 'Loading …'],
    'devices.activeNow':    ['Aktiv nå', 'Active now'],
    'devices.lastActive':   ['Sist aktiv {when}', 'Last active {when}'],
    'devices.seenNow':      ['Sist sett nå', 'Last seen just now'],
    'devices.seen':         ['Sist sett {when}', 'Last seen {when}'],
    'devices.noSessions':   ['Ingen andre innlogginger.', 'No other sign-ins.'],
    'devices.noPush':       ['Ingen enheter har varsler på.', 'No devices have notifications on.'],
    'devices.turnOff':      ['Slå av', 'Turn off'],
    'devices.logOutDevice': ['Logg ut denne enheten?', 'Log out this device?'],
    'devices.logOutDeviceMsg': ['{name} blir logget ut av Huskis. Enheten kan logge inn igjen når som helst.',
                                '{name} will be signed out of Huskis. It can sign in again at any time.'],
    'devices.loggedOutDevice': ['Enheten er logget ut.', 'That device is signed out.'],
    'devices.logOutOthers': ['Logg ut på alle andre enheter', 'Log out on all other devices'],
    'devices.logOutOthersMsg': ['Alle andre innlogginger avsluttes. Denne enheten blir stående innlogget.',
                                'Every other sign-in ends. This device stays signed in.'],
    'devices.loggedOutOthers': ['De andre enhetene er logget ut.', 'The other devices are signed out.'],
    'devices.pushOffOthers': ['Slå av på alle andre enheter',
                              'Turn off on all other devices'],
    'devices.pushOffOthersAria': ['Slå av varsler på alle andre enheter',
                                  'Turn off notifications on all other devices'],
    'devices.pushOffOthersMsg': ['De andre enhetene slutter å få varsler utenfor Huskis. Denne enheten beholder sine.',
                                 'The other devices stop getting notifications outside Huskis. This device keeps its own.'],
    'devices.turnedOff':    ['Varslene er slått av på den enheten.',
                             'Notifications are off on that device.'],
    /* Android-appen planlegger alarmene sine LOKALT, og en server uten
       pushkanal kan ikke avlyse dem i en app som ikke kjører. Kvitteringen
       lover derfor ikke mer enn den kan holde (docs/varsler.md). */
    'devices.turnedOffApp':  ['Slått av. Huskis-appen tar ned varslene neste gang den er i bruk.',
                              'Turned off. The Huskis app removes its notifications the next time it is used.'],
    'devices.turnedOffOthersApp': ['Slått av på de andre enhetene. Huskis-appen tar ned sine neste gang den er i bruk.',
                              'Turned off on the other devices. The Huskis app removes its own the next time it is used.'],
    'devices.turnedOffOthers': ['Varslene er slått av på de andre enhetene.',
                                'Notifications are off on the other devices.'],
    'devices.loadFailed':   ['Fikk ikke hentet listen. Den kan være utdatert.',
                             'Could not load the list. It may be out of date.'],
    'devices.actionFailed': ['Det gikk ikke. Prøv igjen.', 'That did not work. Try again.'],
    'devices.signedOutRemotely': ['Du ble logget ut fra en annen enhet.',
                                  'You were signed out from another device.'],

    'notif.channel.offFailed': ['Varslene ble ikke slått av. Prøv igjen.',
                                'Notifications were not turned off. Try again.'],

    /* ---- «Flytt til …» ---- */
    'move.outOfCategory': ['Ut av kategorien (i «{list}»)', 'Out of the category (in “{list}”)'],
    'move.toCategory':    ['Kategorien «{name}»', 'The category “{name}”'],
    'move.toList':        ['Listen «{name}»', 'The list “{name}”'],
    'move.itemPrompt':    ['{name} flyttes dit du velger.', '{name} will be moved where you choose.'],
    'move.groupPrompt':   ['{name} flyttes til området du velger.',
                           '{name} will be moved to the workspace you choose.'],
    'move.movedTo':       ['Flyttet {name} til {dest}', 'Moved {name} to {dest}'],

    /* ---- Dra og slipp ---- */
    'dnd.listLocked':     ['Listen er låst – du kan ikke flytte noe hit',
                           'The list is locked – you cannot move anything here'],
    'dnd.universeLocked': ['Området er låst – du kan ikke flytte noe hit',
                           'The workspace is locked – you cannot move anything here'],
    /* Opplesningene under et drag. Dra-og-slipp-motoren (Smett/dnd-kit) bygger
       setningene selv, men av DISSE byggerne — ikke av sine egne engelske. */
    'dnd.a11yPickedUp':   ['Løftet {name}. {position}.', 'Picked up {name}. {position}.'],
    'dnd.a11yMoving':     ['{name}. {position}.', '{name}. {position}.'],
    'dnd.a11yDropped':    ['Slapp {name}. {position}.', 'Dropped {name}. {position}.'],
    'dnd.a11yMoved':      ['Flyttet {name}. {position}.', 'Moved {name}. {position}.'],
    'dnd.a11yCancelled':  ['Flyttingen av {name} ble avbrutt.', 'Move cancelled for {name}.'],
    'dnd.a11yFailed':     ['Flyttingen mislyktes. {name} ble lagt tilbake.',
                           'Move failed. {name} was restored.'],
    'dnd.a11yPosition':   ['plass {pos} av {total}', 'position {pos} of {total}'],
    'dnd.a11yPositionIn': ['plass {pos} av {total} i {name}',
                           'position {pos} of {total} in {name}'],
    'dnd.a11yOverTrash':  ['over søppelkassen', 'over the trash'],
    'dnd.a11yOverCrumb':  ['over «flytt til mappe»', 'over “move to folder”'],
    'dnd.a11yOffBoard':   ['utenfor', 'off the board'],

    /* ---- Tomtilstander ---- */
    'empty.noGroups':     ['Ingen mapper ennå.', 'No folders yet.'],
    'empty.noGroupsHint': ['Trykk {nav} øverst og deretter {plus} i et område for å komme i gang.',
                           'Tap {nav} at the top, then {plus} inside a workspace to get started.'],
    'empty.noCards':      ['Ingen lister i {name} ennå.', 'No lists in {name} yet.'],
    'empty.noCardsHint':  ['Trykk {plus} for å komme i gang.', 'Tap {plus} to get started.'],
    'empty.groupLocked':  ['Mappen er låst, så du kan ikke opprette lister i den.',
                           'The folder is locked, so you cannot create lists in it.'],

    /* ---- Seksjonene i nav-modalen ---- */
    'section.mine':             ['Mine områder', 'My workspaces'],
    'section.sharedUniverses':  ['Områder delt med meg', 'Workspaces shared with me'],
    'section.sharedGroups':     ['Mapper delt med meg', 'Folders shared with me'],
    'section.freeGroups':       ['Delte mapper', 'Shared folders'],
    'section.sharedNotes':      ['Delt med meg', 'Shared with me'],
    'share.withOthers':         ['Delt med andre', 'Shared with others'],
    'share.withYou':            ['Delt med deg', 'Shared with you'],

    /* ---- Nav-modalen ---- */
    'empty.noOwnUniverses':    ['Ingen egne områder ennå.', 'No workspaces of your own yet.'],
    'empty.noSharedUniverses': ['Ingen områder er delt med deg.', 'No workspaces have been shared with you.'],
    'nav.newUniverse':         ['Nytt område', 'New workspace'],
    'nav.newGroup':            ['Ny mappe', 'New folder'],

    /* ---- Presise navn på ikonknapper (aria-label) ---- */
    'label.universe':       ['Området {name}', 'The workspace {name}'],
    'label.group':          ['Mappen {name}', 'The folder {name}'],
    'label.card':           ['Listen {name}', 'The list {name}'],
    'label.note':           ['Notatet {name}', 'The note {name}'],
    'label.noteEdited':     ['Sist endret {when}', 'Last edited {when}'],
    'label.category':       ['Kategorien {name}', 'The category {name}'],
    'label.groupcat':       ['Mappekategorien {name}', 'The folder category {name}'],
    'label.menuUniverse':   ['Meny for området {name}', 'Menu for the workspace {name}'],
    'label.menuGroup':      ['Meny for mappen {name}', 'Menu for the folder {name}'],
    'label.menuCard':       ['Meny for listen {name}', 'Menu for the list {name}'],
    'label.menuNoteProject': ['Meny for bokhyllen {name}', 'Menu for the bookshelf {name}'],
    'label.menuNoteFolder':  ['Meny for notatboken {name}', 'Menu for the notebook {name}'],
    'label.menuNote':        ['Meny for notatet {name}', 'Menu for the note {name}'],
    'label.menuItem':       ['Meny for listepunktet {name}', 'Menu for the item {name}'],
    'label.menuCategory':   ['Meny for kategorien {name}', 'Menu for the category {name}'],
    'label.menuGroupCat':   ['Meny for mappekategorien {name}', 'Menu for the folder category {name}'],
    'label.addGroupIn':     ['Legg til mappe i {name}', 'Add folder to {name}'],
    'label.addGroupCatIn':  ['Legg til mappekategori i {name}', 'Add folder category to {name}'],
    'label.addItemIn':      ['Legg til listepunkt i {name}', 'Add item to {name}'],
    'label.addCatIn':       ['Legg til kategori i {name}', 'Add category to {name}'],
    'label.addGroupInCat':  ['Legg til mappe i kategorien {name}', 'Add folder to the category {name}'],
    'label.addItemInCat':   ['Legg til listepunkt i kategorien {name}', 'Add item to the category {name}'],
    'label.ideacat':        ['Idékategorien {name}', 'The idea category {name}'],
    'label.deleteIdea':     ['Slett idéen {name}', 'Delete the idea {name}'],
    'label.dissolveIdeaCat': ['Løs opp idékategorien {name}', 'Dissolve the idea category {name}'],
    'label.addIdeaInCat':   ['Legg til idé i kategorien {name}', 'Add idea to the category {name}'],
    'label.restoreDoneIn':  ['Gjenopprett alle utførte listepunkter i {name}',
                             'Restore all completed items in {name}'],
    'label.deleteDoneIn':   ['Slett alle utførte listepunkter i {name}',
                             'Delete all completed items in {name}'],
    'label.markDone':       ['Merk {name} som gjort', 'Mark {name} as done'],
    'label.unmarkDone':     ['Fjern merket gjort på {name}', 'Unmark {name} as done'],

    /* ---- Objektmenyens slett-rader ---- */
    'menu.deleteUniverseForAll': ['Slett området for alle', 'Delete the workspace for everyone'],
    'menu.deleteGroupForAll':    ['Slett mappen for alle', 'Delete the folder for everyone'],
    'menu.deleteCard':           ['Slett listen', 'Delete the list'],
    'menu.deleteItem':           ['Slett listepunktet', 'Delete the item'],
    'menu.dissolveCategory':     ['Løs opp kategorien', 'Dissolve the category'],
    'menu.dissolveGroupCat':     ['Løs opp mappekategorien', 'Dissolve the folder category'],

    /* ---- Søppelkassene på de andre nivåene ---- */
    'trash.groupsBtnTitle': ['Slettede mapper – trykk for å åpne, hold og sveip for å slette dem for godt',
                             'Deleted folders – tap to open, press and swipe to delete them for good'],
    'trash.groupsCountIn':  ['{count} slettede mapper i {name}', '{count} deleted folders in {name}'],
    'trash.itemsBtnTitle':  ['Slettede listepunkter – trykk for å åpne, hold og sveip for å slette dem for godt',
                             'Deleted items – tap to open, press and swipe to delete them for good'],
    'trash.itemsCountIn':   ['{count} slettede listepunkter i {name}', '{count} deleted items in {name}'],
    'trash.ideasBtnTitle':  ['Slettede idéer – trykk for å åpne, hold og sveip for å slette dem for godt',
                             'Deleted ideas – tap to open, press and swipe to delete them for good'],
    'trash.ideasCount':     ['{count} slettede idéer', '{count} deleted ideas'],

    /* ---- Forlat en deling ---- */
    'common.theObject': ['objektet', 'the object'],
    'leave.title':   ['Forlat {kind}', 'Leave {kind}'],
    'leave.message': ['Du mister tilgangen til {name}, men innholdet består for de andre.',
                      'You lose access to {name}, but the content stays for everyone else.'],
    'leave.ok':      ['Forlat', 'Leave'],
    'share.groupWithOthers': ['Mappen er delt med andre', 'The folder is shared with others'],
    'share.groupWithYou':    ['Mappen er delt med deg', 'The folder is shared with you'],

    /* ---- Dato og klokkeslett ---- */
    // Tolv forkortede månedsnavn, atskilt med mellomrom, i kalenderrekkefølge.
    'date.monthsShort':  ['jan feb mar apr mai jun jul aug sep okt nov des',
                          'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'],
    // … og de fulle, til datooverskriftene i varselmodalen. Samme form: én
    // streng med mellomrom mellom, tolv nøkler ville vært tolv å glemme.
    'date.monthsLong':   ['januar februar mars april mai juni juli august september oktober november desember',
                          'January February March April May June July August September October November December'],
    // Ukedagene i JS-rekkefølge (0 = søndag). Store forbokstaver: de brukes
    // KUN som overskrift, aldri midt i en setning.
    'date.weekdays':     ['Søndag Mandag Tirsdag Onsdag Torsdag Fredag Lørdag',
                          'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'],
    'date.dayMonth':     ['{d}. {mon}', '{d} {mon}'],
    'date.dayMonthYear': ['{d}. {mon} {y}', '{d} {mon} {y}'],
    // Ukedag foran den fulle datoen — datooverskriften i varselmodalen.
    'date.weekdayDate':     ['{wd} {d}. {mon}', '{wd} {d} {mon}'],
    'date.weekdayDateYear': ['{wd} {d}. {mon} {y}', '{wd} {d} {mon} {y}'],
    'date.at':           ['{date} kl. {clock}', '{date} at {clock}'],
    /* De tre nærmeste døgnene har NAVN i stedet for en dato. Små forbokstaver:
       disse står midt i en setning («Begynte i dag kl. 07:00»). Overskriftene
       i varselmodalen har sine egne, store, under `notif.day.*`. */
    'date.today':        ['i dag', 'today'],
    'date.yesterday':    ['i går', 'yesterday'],
    'date.tomorrow':     ['i morgen', 'tomorrow'],
    // Avstand i hele døgn — varsel-toastene sier hvor langt unna noe er.
    'date.inDays':       ['om {n} dager', 'in {n} days'],
    'date.daysAgo':      ['for {n} dager siden', '{n} days ago'],

    /* ---- Indikator-chips ---- */
    'time.startLabel':  ['Start: {time}', 'Start: {time}'],
    'time.dueLabel':    ['Frist: {time}', 'Due: {time}'],
    'chip.tapToChange': ['{text}. Trykk for å endre', '{text}. Tap to change'],
    'resp.label':       ['Ansvarlig: {name}', 'Assignee: {name}'],
    'resp.chosen':      ['Ansvarlig valgt', 'Assignee chosen'],

    /* ---- Antall + objekttype ---- */
    'count.universe.one':   ['{n} område', '{n} workspace'],
    'count.universe.other': ['{n} områder', '{n} workspaces'],
    'count.group.one':      ['{n} mappe', '{n} folder'],
    'count.group.other':    ['{n} mapper', '{n} folders'],
    'count.card.one':       ['{n} liste', '{n} list'],
    'count.card.other':     ['{n} lister', '{n} lists'],
    'count.item.one':       ['{n} listepunkt', '{n} item'],
    'count.item.other':     ['{n} listepunkter', '{n} items'],
    'count.idea.one':       ['{n} idé', '{n} idea'],
    'count.idea.other':     ['{n} idéer', '{n} ideas'],
    'count.note.one':       ['{n} notat', '{n} note'],
    'count.note.other':     ['{n} notater', '{n} notes'],
    'count.noteFolder.one':   ['{n} notatbok', '{n} notebook'],
    'count.noteFolder.other': ['{n} notatbøker', '{n} notebooks'],
    'count.noteProject.one':   ['{n} bokhylle', '{n} bookshelf'],
    'count.noteProject.other': ['{n} bokhyller', '{n} bookshelves'],

    'trash.movedOne':  ['Lagt i søppelkassen: {name}', 'Moved to the trash: {name}'],
    'trash.movedMany': ['Lagt i søppelkassen: {what}', 'Moved to the trash: {what}'],
    'move.cardPrompt': ['{name} flyttes til mappen du velger.',
                        '{name} will be moved to the folder you choose.'],
    'dnd.groupNeedsUniverse':    ['En mappe kan ikke flyttes hit — den må ligge i et område',
                                  'A folder cannot be moved here — it has to live in a workspace'],
    'dnd.cannotCreateGroupHere': ['Du kan ikke opprette mapper i dette området',
                                  'You cannot create folders in this workspace'],
    'move.otherOwnersTitle': ['Flytte mappen til et område med andre eiere?',
                              'Move the folder to a workspace with other owners?'],
    'move.otherOwnersMsg':   ['{name} flyttes til et område med andre eiere. De som har tilgang i dag mister den — direkte mappemedlemmer og medeiere følger ikke med. Medlemmene i det nye området får tilgang i stedet.',
                              '{name} will be moved to a workspace with other owners. Everyone who has access today loses it — direct folder members and co-owners do not come along. The members of the new workspace get access instead.'],
    'move.otherOwnersOk':    ['Flytt likevel', 'Move anyway'],

    /* ---- Søppelkasse-modalen ---- */
    'trash.note': ['Hent tilbake det du vil beholde. Resten kan du slette for godt — da er det borte. Tips: hold inne søppelkasse-knappen og sveip mot høyre for å slette alt med én gang.',
                   'Restore what you want to keep. The rest you can delete for good — then it is gone. Tip: press and hold the trash button and swipe right to delete everything at once.'],
    'trash.lockedRemains':    ['Låst innhold ligger fortsatt i søppelkassen',
                               'Locked content is still in the trash'],
    'trash.lockedRestore':    ['Låst – du kan ikke hente dette tilbake',
                               'Locked – you cannot restore this'],
    'trash.restoreAria':       ['Gjenopprett {name}', 'Restore {name}'],
    'trash.restoreLockedAria': ['Gjenopprett {name} – låst, du kan ikke hente dette tilbake',
                                'Restore {name} – locked, you cannot restore this'],
    'trash.purgeUniverses': ['Slett områdene for godt', 'Delete the workspaces for good'],
    'trash.noUniverses':    ['Ingen slettede områder.', 'No deleted workspaces.'],
    'trash.groupsIn':       ['Slettede mapper – {name}', 'Deleted folders – {name}'],
    'trash.purgeGroups':    ['Slett mappene for godt', 'Delete the folders for good'],
    'trash.noGroups':       ['Ingen slettede mapper.', 'No deleted folders.'],
    'trash.cardsIn':        ['Slettede lister – {name}', 'Deleted lists – {name}'],
    'trash.purgeCards':     ['Slett listene for godt', 'Delete the lists for good'],
    'trash.noCards':        ['Ingen slettede lister.', 'No deleted lists.'],
    'trash.itemsIn':        ['Slettede listepunkter – {name}', 'Deleted items – {name}'],
    'trash.purgeItems':     ['Slett listepunktene for godt', 'Delete the items for good'],
    'trash.noItems':        ['Ingen slettede listepunkter.', 'No deleted items.'],
    'trash.ideas':          ['Slettede idéer', 'Deleted ideas'],
    'trash.purgeIdeas':     ['Slett idéene for godt', 'Delete the ideas for good'],
    'trash.noIdeas':        ['Ingen slettede idéer.', 'No deleted ideas.'],
    'trash.swipeDeleteAll': ['Slett alt', 'Delete all'],
    'resp.none':             ['Ingen ansvarlig', 'No assignee'],
    'share.noMembers':       ['Ingen medlemmer ennå.', 'No members yet.'],
    'share.membersFailed':   ['Fikk ikke hentet medlemmene – prøv igjen',
                              'Could not load the members – try again'],
    'share.loadingMembers':  ['Henter medlemmer …', 'Loading members …'],

    /* ---- Objektmenyen ---- */
    'menu.forObject':   ['Meny for {kind} {name}', 'Menu for {kind} {name}'],
    'menu.responsible': ['Ansvarlig', 'Assignee'],
    'menu.schedule':    ['Tidsplan', 'Schedule'],
    'menu.move':        ['Flytt', 'Move'],
    'menu.moveUp':      ['Flytt opp', 'Move up'],
    'menu.moveDown':    ['Flytt ned', 'Move down'],
    'menu.moveTo':      ['Flytt til …', 'Move to …'],
    'menu.sharing':     ['Deling og medlemmer', 'Sharing and members'],
    'menu.delete':      ['Slett', 'Delete'],

    /* ---- Lås ---- */
    'lock.removeException':      ['Fjern unntaket fra låsen', 'Remove the exception from the lock'],
    'lock.makeException':        ['Gjør unntak fra låsen', 'Make an exception to the lock'],
    'lock.openForEditing':       ['Åpne for redigering', 'Open for editing'],
    'lock.lockForEditing':       ['Lås for redigering', 'Lock for editing'],
    'lock.exemptFromInherited':  ['Unntatt fra en arvet lås', 'Exempt from an inherited lock'],
    'lock.lockedByParent':       ['Låst av en forelder', 'Locked by a parent'],
    'lock.othersCanView':        ['Andre kan se, men ikke redigere', 'Others can view, but not edit'],
    'lock.everyoneCanEdit':      ['Alle med tilgang kan redigere', 'Everyone with access can edit'],

    /* ---- Tidsplan (start/frist) ---- */
    'time.start':           ['Starttid', 'Start'],
    'time.due':             ['Tidsfrist', 'Due'],
    'time.startDate':       ['Startdato', 'Start date'],
    'time.dueDate':         ['Fristdato', 'Due date'],
    'time.datePlaceholder': ['dd.mm.åååå', 'dd/mm/yyyy'],
    'time.clockOptional':   ['Klokkeslett (valgfritt)', 'Time of day (optional)'],
    'time.clear':           ['Fjern tiden', 'Clear the time'],
    'time.clearStart':      ['Fjern starttiden', 'Clear the start time'],
    'time.clearDue':        ['Fjern fristen', 'Clear the due time'],
    'time.controlledBy':    ['Tidene styres av {kind} {name}.', 'The times are controlled by {kind} {name}.'],
    'time.bothOutside':     ['Starttiden og fristen er utenfor tidsrommet.',
                             'The start time and the deadline are outside the time span.'],
    'time.startOutside':    ['Starttiden er utenfor tidsrommet.', 'The start time is outside the time span.'],
    'time.dueOutside':      ['Fristen er utenfor tidsrommet.', 'The deadline is outside the time span.'],
    /* Den harde fristinvarianten (docs/scheduling.md): et barn kan aldri ha en
       senere frist enn en forelder som selv har frist. To avvisninger og én
       beskjed om eldre data som allerede bryter regelen. */
    'time.dueAfterParent':  ['Fristen kan ikke være senere enn {kind} {name}, som har frist {time}.',
                             'The deadline cannot be later than {kind} {name}, which is due {time}.'],
    'time.dueBeforeChild':  ['Fristen kan ikke flyttes foran {kind} {name}, som har frist {time}.',
                             'The deadline cannot be moved ahead of {kind} {name}, which is due {time}.'],
    'time.dueConflict':     ['Fristen ligger etter {kind} {name} ({time}). Neste endring må bringe den innenfor.',
                             'This deadline is later than {kind} {name} ({time}). The next change must bring it back inside.'],
    'time.lockInCard':      ['Lås tidene også til listepunktene i listen',
                             'Apply these times to the items in the list too'],
    'time.lockInCategory':  ['Lås tidene til listepunktene i kategorien',
                             'Apply these times to the items in the category'],
    'account.logoutMsg':        ['Listene dine beholdes på kontoen når du logger ut.',
                                 'Your lists stay on your account when you sign out.'],
    'account.deleteSwipeLabel': ['Slett kontoen', 'Delete the account'],
    'account.deleted':          ['Kontoen din er slettet.', 'Your account has been deleted.'],

    /* ---- Innlogging: moduser, meldinger og feil ---- */
    'auth.register':      ['Registrer deg', 'Create an account'],
    'auth.createAccount': ['Opprett konto', 'Create account'],
    'auth.forgot':        ['Glemt passord', 'Forgot password'],
    'auth.sendLink':      ['Send lenke', 'Send link'],
    'auth.toLogin':       ['Har du konto? Logg inn', 'Already have an account? Sign in'],
    'auth.unavailable':   ['Innlogging er ikke tilgjengelig akkurat nå. Prøv igjen senere.',
                           'Signing in is not available right now. Try again later.'],
    'auth.enterEmail':    ['Skriv inn e-postadressen din.', 'Enter your email address.'],
    'auth.enterFullName': ['Skriv inn både fornavn og etternavn.', 'Enter both your first and last name.'],
    'auth.sentConfirm':   ['Vi har sendt en bekreftelseslenke til {email}. Åpne den for å fullføre registreringen, så kan du logge inn.',
                           'We have sent a confirmation link to {email}. Open it to finish creating your account, then you can sign in.'],
    'auth.sentReset':     ['Hvis {email} har en konto, har vi sendt en lenke for å velge nytt passord. Sjekk innboksen.',
                           'If {email} has an account, we have sent a link for choosing a new password. Check your inbox.'],
    'auth.chooseNewPassword': ['Velg et nytt passord (minst 6 tegn):',
                               'Choose a new password (at least 6 characters):'],
    'auth.inviteSignup':  ['Du er invitert til Huskis! Fullfør registreringen for å bli med.',
                           'You have been invited to Huskis! Finish signing up to join.'],

    'error.generic':               ['Noe gikk galt', 'Something went wrong'],
    'error.badCredentials':        ['Feil e-post eller passord.', 'Wrong email or password.'],
    'error.emailNotConfirmed':     ['E-posten er ikke bekreftet ennå – sjekk innboksen.',
                                    'The email is not confirmed yet – check your inbox.'],
    'error.emailTaken':            ['Denne e-posten er allerede registrert.',
                                    'This email is already registered.'],
    'error.passwordTooShort':      ['Passordet må ha minst 6 tegn.', 'The password must be at least 6 characters.'],
    'error.passwordTooShortShort': ['Passordet må ha minst 6 tegn', 'The password must be at least 6 characters'],
    'error.passwordSameAsOld':     ['Det nye passordet må være et annet enn det gamle.',
                                    'The new password must be different from the old one.'],
    'error.rateLimited':           ['For mange forsøk – vent litt og prøv igjen.',
                                    'Too many attempts – wait a moment and try again.'],

    /* ---- Lagringsstatus og tilgang ---- */
    'sync.saved':         ['Lagret', 'Saved'],
    'sync.saving':        ['Lagrer …', 'Saving …'],
    'sync.offline':       ['Frakoblet – endringene lagres på denne enheten',
                           'Offline – your changes are saved on this device'],
    'sync.rejected':      ['Noen endringer kunne ikke lagres på kontoen din.',
                           'Some changes could not be saved to your account.'],
    'sync.rejectedCache': ['Endringene lagres ikke på denne enheten.',
                           'Changes are not being saved on this device.'],
    'sync.notSaved':      ['Endringen ble ikke lagret. Sjekk forbindelsen og prøv igjen.',
                           'The change was not saved. Check your connection and try again.'],
    'sync.orderNotSaved': ['Den nye rekkefølgen ble ikke lagret – prøv igjen',
                           'The new order was not saved – try again'],
    'access.lostGroup':    ['Du har ikke lenger tilgang til mappen',
                            'You no longer have access to the folder'],
    'access.lostUniverse': ['Du har ikke lenger tilgang til området',
                            'You no longer have access to the workspace'],
    'access.lostNote':        ['Du har ikke lenger tilgang til notatet',
                               'You no longer have access to the note'],
    'access.lostNoteFolder':  ['Du har ikke lenger tilgang til notatboken',
                               'You no longer have access to the notebook'],
    'access.lostNoteProject': ['Du har ikke lenger tilgang til bokhyllen',
                               'You no longer have access to the bookshelf'],

    /* ---- Import av gamle lokale lister ---- */
    'import.title':   ['Legg listene til på kontoen din', 'Add the lists to your account'],
    'import.message': ['Vi fant {what} som ligger lagret på denne enheten. Vil du legge dem til på kontoen din, så du får dem på alle enhetene dine?',
                       'We found {what} stored on this device. Do you want to add them to your account so you have them on all your devices?'],
    'import.ok':      ['Legg til', 'Add'],
    'import.done':    ['Listene ligger nå på kontoen din', 'The lists are now on your account'],
    'import.failed':  ['Listene ble ikke lagt til. Prøv igjen senere.',
                       'The lists were not added. Try again later.'],

    /* ---- Konto: navn, e-post og passord ---- */
    'account.nameEmpty':           ['Navnet kan ikke være tomt.', 'The name cannot be empty.'],
    'account.nameUpdated':         ['Navnet er oppdatert.', 'Your name has been updated.'],
    'account.emailUpdated':        ['E-postadressen er oppdatert.', 'Your email address has been updated.'],
    'account.emailConfirmPending': ['Nesten ferdig – bekreft endringen via lenken vi har sendt på e-post.',
                                    'Almost there – confirm the change using the link we sent by email.'],
    'account.enterCurrentPassword': ['Skriv inn det nåværende passordet.', 'Enter your current password.'],
    'account.newPasswordTooShort':  ['Det nye passordet må ha minst 6 tegn.',
                                     'The new password must be at least 6 characters.'],
    'account.wrongCurrentPassword': ['Feil nåværende passord.', 'Wrong current password.'],
    'account.passwordUpdated':      ['Passordet er oppdatert.', 'Your password has been updated.'],
    'account.passwordUpdatedShort': ['Passordet er oppdatert', 'Your password has been updated'],
    'avatar.readFailed': ['Kunne ikke lese bildefilen', 'Could not read the image file'],
    'avatar.updated':    ['Profilbildet er oppdatert.', 'Your profile picture has been updated.'],
    'avatar.removeTitle': ['Fjern profilbilde', 'Remove profile picture'],
    'avatar.removeMsg':  ['Bildet slettes fra kontoen din, og initialene vises igjen.',
                          'The picture is deleted from your account, and your initials show again.'],
    'avatar.removed':    ['Profilbildet er fjernet.', 'Your profile picture has been removed.'],

    /* ---- Invitasjoner i innboksen ---- */
    'invite.from':        ['fra {from}', 'from {from}'],
    'invite.asOwnerFrom': ['som medeier, fra {from}', 'as co-owner, from {from}'],
    'invite.accept':      ['Godta', 'Accept'],
    'invite.decline':     ['Avslå', 'Decline'],
    'invite.shareAccepted':     ['Deling godtatt', 'Share accepted'],
    'invite.ownershipAccepted': ['Eierskap godtatt', 'Ownership accepted'],

    /* ---- Del-modalen ---- */
    'share.settingsSuffix': [' — Innstillinger for deling', ' — Sharing settings'],
    'share.owner':          ['Eier', 'Owner'],
    'share.coOwners':       ['Medeiere', 'Co-owners'],
    'share.members':        ['Medlemmer', 'Members'],
    'share.ownerUniverse':    ['Eier av området', 'Owner of the workspace'],
    'share.coOwnersUniverse': ['Medeiere av området', 'Co-owners of the workspace'],
    'share.ownerGroup':       ['Eier av mappen', 'Owner of the folder'],
    'share.coOwnersGroup':    ['Medeiere av mappen', 'Co-owners of the folder'],
    'share.membersUniverse':  ['Medlemmer av området', 'Members of the workspace'],
    'share.membersGroup':     ['Medlemmer av mappen', 'Members of the folder'],
    'share.ownerShelf':       ['Eier av bokhyllen', 'Owner of the bookshelf'],
    'share.coOwnersShelf':    ['Medeiere av bokhyllen', 'Co-owners of the bookshelf'],
    'share.membersShelf':     ['Medlemmer av bokhyllen', 'Members of the bookshelf'],
    'share.ownerNotebook':    ['Eier av notatboken', 'Owner of the notebook'],
    'share.coOwnersNotebook': ['Medeiere av notatboken', 'Co-owners of the notebook'],
    'share.membersNotebook':  ['Medlemmer av notatboken', 'Members of the notebook'],
    'share.ownerNote':        ['Eier av notatet', 'Owner of the note'],
    'share.coOwnersNote':     ['Medeiere av notatet', 'Co-owners of the note'],
    'share.membersNote':      ['Medlemmer av notatet', 'Members of the note'],
    'share.invitePlaceholder': ['E-post å invitere', 'Email to invite'],
    'share.inviteAria':        ['E-postadresse å invitere', 'Email address to invite'],
    'share.roleAria':          ['Rolle for den inviterte', 'Role for the invitee'],
    'share.asMember':          ['Som medlem', 'As member'],
    'share.asCoOwner':         ['Som medeier', 'As co-owner'],
    'share.asCoOwnerGroup':    ['Som medeier av mappen', 'As co-owner of the folder'],
    'share.invite':            ['Inviter', 'Invite'],
    'share.inviteSent':        ['Invitasjon sendt til {email}', 'Invitation sent to {email}'],
    'share.policyLabel': ['Tillat andre medlemmer å invitere folk til {kind}',
                          'Let other members invite people to {kind}'],
    'share.policyOn':    ['Andre medlemmer kan invitere folk hit.', 'Other members can invite people here.'],
    'share.policyOff':   ['Bare eiere kan invitere folk hit.', 'Only owners can invite people here.'],
    'share.you':         ['{name} (deg)', '{name} (you)'],
    'share.roleOwner':   ['Eier', 'Owner'],
    'share.roleMember':  ['Medlem', 'Member'],
    'share.promote':     ['Gjør til medeier', 'Make co-owner'],
    'share.promoteTitle': ['Invitere til medeierskap', 'Invite to co-ownership'],
    'share.promoteMsg':  ['{name} får en invitasjon til å bli medeier av {kind}. Eierskapet gjelder først når invitasjonen er godtatt, og en medeier har de samme rettighetene som deg.',
                          '{name} will get an invitation to become a co-owner of {kind}. The ownership only takes effect once the invitation is accepted, and a co-owner has exactly the same rights as you.'],
    'share.promoteOk':   ['Send invitasjon', 'Send invitation'],
    'share.promoteSent': ['Invitasjon til medeierskap sendt til {name}.',
                          'Co-ownership invitation sent to {name}.'],
    'share.demote':      ['Gjør til medlem', 'Make member'],
    'share.demoteTitle': ['Fjerne medeierskap', 'Remove co-ownership'],
    'share.demoteMsg':   ['{name} blir vanlig medlem og mister eier-rettighetene.',
                          '{name} becomes an ordinary member and loses the owner rights.'],
    'share.stepDown':    ['Tre av som medeier', 'Step down as co-owner'],
    'share.stepDownOk':  ['Tre av', 'Step down'],
    'share.stepDownMsg': ['Du blir vanlig medlem og mister eier-rettighetene. Du beholder tilgangen, men kan ikke lenger administrere medlemmer, lås eller sletting.',
                          'You become an ordinary member and lose the owner rights. You keep your access, but can no longer manage members, locks or deletion.'],
    'share.removeMemberTitle': ['Fjerne medlem', 'Remove member'],
    'share.removeMemberMsg':   ['Fjerne {name} fra {kind}? All tilgang under det forsvinner også.',
                                'Remove {name} from {kind}? All access below it disappears too.'],
    'share.pendingInvites':  ['Ventende invitasjoner', 'Pending invitations'],
    'share.invitedAsOwner':  ['Invitert som medeier', 'Invited as co-owner'],
    'share.invitedAsMember': ['Invitert som medlem', 'Invited as member'],
    'share.withdraw':        ['Trekk tilbake', 'Withdraw'],
    'share.deleteForAllLabel': ['Slett {kind} for alle', 'Delete {kind} for everyone'],
    'share.deleteForAll':      ['Slett for alle', 'Delete for everyone'],
    'share.deleteForAllMsg':   ['Dette sletter {kind} og alt innholdet for ALLE med tilgang.',
                                'This deletes {kind} and all its content for EVERYONE with access.'],
    'share.onlyOwnerNote':     ['Du er eneste eier. Gi eierskap til noen andre før du kan forlate området.',
                                'You are the only owner. Give ownership to someone else before you can leave the workspace.'],
    'leave.messageShort':      ['Du mister tilgangen, men innholdet består for de andre.',
                                'You lose your access, but the content stays for everyone else.'],

    /* ---- Låsetilstand i del-modalen ---- */
    'lock.lockedForEditing':     ['Låst for redigering', 'Locked for editing'],
    'lock.openForEditingState':  ['Åpent for redigering', 'Open for editing'],
    'lock.lockNow':              ['Lås nå', 'Lock now'],
    'lock.openNow':              ['Åpne nå', 'Open now'],
    'lock.exceptionLabel':       ['Unntak: andre kan redigere {kind}',
                                  'Exception: others can edit {kind}'],
    'lock.autoLocked':           ['Automatisk låst for redigering', 'Automatically locked for editing'],
    'lock.becausePrefix':        ['Fordi ', 'Because '],
    'lock.isLocked':             [' er låst', ' is locked'],
    'lock.isLockedExempt':       [' er låst — denne er unntatt', ' is locked — this one is exempt'],
    'lock.removeExceptionShort': ['Fjern unntak', 'Remove exception'],
    'lock.makeExceptionShort':   ['Gjør unntak', 'Make exception'],

    /* ---- Demonstrasjonen (stegene) ----
       `{list}`, `{folder}`, `{globe}` og `{category}` er ikoner (SVG-markup)
       som settes inn i teksten — de skal stå der de gir mening i setningen. */
    'tour.welcomeTitle': ['Velkommen til Huskis', 'Welcome to Huskis'],
    'tour.welcome': ['<p>Her kan du lage</p><ul class="tour-list"><li>{list}<span><b>huskelister</b> for å holde styr på livet ditt</span></li><li>{folder}<span><b>mapper</b> for å holde styr på listene dine</span></li><li>{globe}<span><b>områder</b> for å holde styr på mappene dine</span></li></ul><p>Innad i listene kan listepunktene sorteres i {category} <b>kategorier</b> – hvis du vil.</p>',
                     '<p>Here you can make</p><ul class="tour-list"><li>{list}<span><b>lists</b> to keep track of your life</span></li><li>{folder}<span><b>folders</b> to keep track of your lists</span></li><li>{globe}<span><b>workspaces</b> to keep track of your folders</span></li></ul><p>Inside a list, the items can be sorted into {category} <b>categories</b> – if you like.</p>'],
    'tour.welcomeNote': ['Nå får du en guidet tur gjennom appens viktigste funksjoner.',
                         'You are about to get a guided tour of what the app can do.'],
    'tour.openNav': ['<p>Denne knappen viser {globe} <b>området</b> og {folder} <b>mappen</b> du er i.</p><p>Trykk på den for å komme til oversikten der du oppretter områder og mapper.</p>',
                     '<p>This button shows the {globe} <b>workspace</b> and the {folder} <b>folder</b> you are in.</p><p>Tap it to open the overview where you create workspaces and folders.</p>'],
    'tour.createArea': ['<p>Trykk på denne knappen for å opprette et {globe} <b>område</b>.</p>',
                        '<p>Tap this button to create a {globe} <b>workspace</b>.</p>'],
    'tour.nameArea': ['<p>Gi området et navn.</p><p>Bekreft med <span class="hint-chip">Enter</span>-tasten eller ved å klikke utenfor navnefeltet.</p>',
                      '<p>Give the workspace a name.</p><p>Confirm with the <span class="hint-chip">Enter</span> key, or by clicking outside the name field.</p>'],
    'tour.createFolder': ['<p>Trykk på den grønne knappen for å opprette en {folder} <b>mappe</b>.</p>',
                          '<p>Tap the green button to create a {folder} <b>folder</b>.</p>'],
    'tour.nameFolder': ['<p>Gi mappen et navn.</p>', '<p>Give the folder a name.</p>'],
    'tour.openFolder': ['<p>Trykk på feltet til mappen du nettopp opprettet for å navigere til mappen.</p>',
                        '<p>Tap the row of the folder you just made to go into it.</p>'],
    'tour.createList': ['<p>Trykk her for å opprette en {list} <b>liste</b>.</p>',
                        '<p>Tap here to create a {list} <b>list</b>.</p>'],
    'tour.nameList': ['<p>Gi listen et navn.</p>', '<p>Give the list a name.</p>'],
    'tour.createItem': ['<p>Trykk her for å opprette et <b>listepunkt</b>.</p>',
                        '<p>Tap here to create an <b>item</b>.</p>'],
    'tour.nameItem': ['<p>Gi listepunktet et navn.</p>', '<p>Give the item a name.</p>'],
    'tour.createItem2': ['<p>Opprett et listepunkt til.</p>', '<p>Create one more item.</p>'],
    'tour.dragItem': ['<p>Trekk det nederste listepunktet oppover for å endre rekkefølgen på listepunktene.</p><p>Hold fingeren (eller museknappen) inne på punktet til det løfter seg, og dra.</p>',
                      '<p>Drag the bottom item upwards to change the order of the items.</p><p>Press and hold on the item (finger or mouse button) until it lifts, then drag.</p>'],
    'tour.createList2': ['<p>Opprett en liste til.</p>', '<p>Create one more list.</p>'],
    'tour.nameList2': ['<p>Gi den nye listen et navn.</p>', '<p>Give the new list a name.</p>'],
    'tour.dragList': ['<p>Trekk listen du nettopp lagde forbi den andre for å bytte rekkefølge på de to listene.</p><p>Ta tak i listens overskrift, hold inne, og dra.</p>',
                      '<p>Drag the list you just made past the other one to swap the order of the two.</p><p>Grab the list by its heading, press and hold, then drag.</p>'],
    'tour.createCat': ['<p>Trykk på den gule knappen for å opprette en {category} <b>kategori</b> i listen.</p>',
                       '<p>Tap the yellow button to create a {category} <b>category</b> in the list.</p>'],
    'tour.nameCat': ['<p>Gi kategorien et navn.</p>', '<p>Give the category a name.</p>'],
    'tour.dragIntoCat': ['<p>Trekk et listepunkt inn i kategorien.</p>', '<p>Drag an item into the category.</p>'],
    'tour.createCatItem': ['<p>Opprett et listepunkt direkte i kategorien med ＋-knappen inne i den.</p>',
                           '<p>Create an item straight inside the category with the ＋ button in it.</p>'],
    'tour.nameCatItem': ['<p>Gi listepunktet et navn.</p>', '<p>Give the item a name.</p>'],
    'tour.dissolveCat': ['<p>Åpne menyen på kategorien og velg «Løs opp kategorien». Listepunktene blir stående der de er — bare overskriften forsvinner.</p>',
                         '<p>Open the menu on the category and choose “Dissolve the category”. The items stay where they are — only the heading disappears.</p>'],
    'tour.deleteItem': ['<p>Hvert objekt har én menyknapp til høyre. Åpne menyen på et listepunkt og velg «Slett listepunktet».</p><p>Du kan også dra objektet rett i søppelkassen — den dukker opp så snart du løfter noe.</p>',
                        '<p>Every object has one menu button on the right. Open the menu on an item and choose “Delete the item”.</p><p>You can also drag the object straight into the trash — it appears as soon as you lift something.</p>'],
    'tour.openItemTrash': ['<p>Trykk på søppelkassen nederst i listen for å se hva som ligger i den.</p>',
                           '<p>Tap the trash at the bottom of the list to see what is in it.</p>'],
    'tour.restoreItem': ['<p>Gjenopprett listepunktet.</p>', '<p>Restore the item.</p>'],
    'tour.closeItemTrash': ['<p>Lukk søppelkassen.</p>', '<p>Close the trash.</p>'],
    'tour.deleteItem2': ['<p>Slett et listepunkt igjen.</p>', '<p>Delete an item once more.</p>'],
    'tour.emptyItemTrash': ['<p>Tøm søppelkassen: hold inne knappen og sveip til høyre.</p><p>Da er listepunktet borte for godt.</p>',
                            '<p>Empty the trash: press and hold the button, then swipe right.</p><p>Now the item is gone for good.</p>'],
    'tour.deleteList': ['<p>Slett listen fra menyen i korthodet.</p>',
                        '<p>Delete the list from the menu in its heading.</p>'],
    'tour.emptyCardTrash': ['<p>Tøm mappens søppelkasse: hold inne knappen i toppmenyen og sveip til høyre.</p>',
                            '<p>Empty the folder’s trash: press and hold the button in the top bar, then swipe right.</p>'],
    'tour.openNav2': ['<p>Gå til «Områder og mapper».</p>', '<p>Go to “Workspaces and folders”.</p>'],
    'tour.deleteArea': ['<p>Slett området fra menyen i korthodet. Mappen og alt i den følger med.</p>',
                        '<p>Delete the workspace from the menu in its heading. The folder and everything in it goes too.</p>'],
    'tour.emptyUniTrash': ['<p>Tøm områdenes søppelkasse: hold inne knappen og sveip til høyre.</p>',
                           '<p>Empty the workspaces’ trash: press and hold the button, then swipe right.</p>'],
    'tour.closeNav': ['<p>Da er alt ryddet bort igjen. Lukk oversikten.</p>',
                      '<p>That clears everything away again. Close the overview.</p>'],
    'tour.finishTitle': ['Takk for turen!', 'Thanks for coming along!'],
    'tour.finish': ['<p>Turen er over, og du er nå i din egen Huskis. Du kan ta turen igjen ved å gå til kontosiden din.</p>',
                    '<p>The tour is over, and you are now in your own Huskis. You can take it again from your account page.</p>'],
    'tour.typeNameHint': ['Skriv navnet og trykk Enter.', 'Type the name and press Enter.'],

    /* ---- Kontekstuelle tips ---- */
    'tip.drag':      ['Tips: hold på en tittel for å flytte den.',
                      'Tip: press and hold a heading to move it.'],
    'tip.trash':     ['Tips: hold på søppelkassen og sveip for å slette alt i den.',
                      'Tip: press and hold the trash, then swipe to delete everything in it.'],
    'tip.moveList':  ['Tips: dra en liste opp på navigasjonsknappen for å flytte den.',
                      'Tip: drag a list onto the navigation button to move it.'],
    'tip.dragTrash': ['Tips: dra et objekt i søppelkassen for å slette det.',
                      'Tip: drag an object into the trash to delete it.'],
    'tip.gotIt':     ['Skjønner', 'Got it'],

    /* ---- Automatisk klientoppdatering (update-check.js) ---- */
    'update.available': ['En ny versjon av Huskis er tilgjengelig.', 'A new version of Huskis is available.'],
    'update.waiting':   ['Siden oppdateres når endringene dine er lagret.',
                         'The page will update once your changes are saved.'],
    'update.now':       ['Oppdater nå', 'Update now'],
    'dnd.shelfLocked': ['Bokhyllen er låst — du kan ikke legge notatbøker i den',
                        'The bookshelf is locked — you cannot put notebooks in it'],
    'dnd.notebookNeedsShelf': ['En notatbok må ligge i en bokhylle',
                               'A notebook must live in a bookshelf'],
    'dnd.cannotCreateNotebookHere': ['Du kan ikke opprette notatbøker i denne bokhyllen',
                                     'You cannot create notebooks in this bookshelf'],
    'share.removeHintInheritedShelf': ['Har tilgang via bokhyllen og må fjernes der',
                                       'Has access via the bookshelf and must be removed there'],
    'share.removeHintInheritedNotebook': ['Har tilgang via notatboken og må fjernes der',
                                          'Has access via the notebook and must be removed there'],
    'share.removeHintInherited': ['Har tilgang via området og må fjernes der',
                                  'Has access through the workspace and must be removed there'],
    'share.removeHintLastOwner': ['Siste eier kan ikke fjernes', 'The last owner cannot be removed'],
    'lang.notOnAccount': ['Språket er endret på denne enheten, men kunne ikke lagres på kontoen din.',
                          'The language was changed on this device, but could not be saved to your account.'],
    'lang.notStored':    ['Språket er endret, men denne enheten kan ikke huske valget.',
                          'The language was changed, but this device cannot remember the choice.'],
    'theme.notStored':   ['Drakten er endret, men denne enheten kan ikke huske valget.',
                          'The appearance was changed, but this device cannot remember the choice.'],
    /* ==== HUSKIS_I18N_DICT_END ==== */
  };

  /* ---------------- Kjøretid ---------------- */

  function entry(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return null;
  }
  // Alt ukjent (null, en gammel verdi, noe en annen fane skrev) blir standarden:
  // språket er en visningsdetalj, og skal aldri kunne velte oppstarten.
  function normalize(code) { return entry(code) ? code : DEFAULT; }

  var current = DEFAULT;
  var explicit = false;   // har enheten et valg brukeren faktisk har tatt?
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    explicit = !!entry(saved);
    current = normalize(saved);
  } catch (e) { /* privat modus */ }

  function lang() { return current; }
  // Har enheten et valg BRUKEREN har tatt, eller står den bare på standarden?
  // Forskjellen avgjør om valget skal løftes opp på kontoen ved innlogging.
  function chosen() { return explicit; }

  /* Setter språket for DENNE fanen: `<html lang>` + den lagrede verdien.
     Rendrer IKKE på nytt — den som bytter språk laster appen på nytt (app.js →
     setLanguage()), som er det eneste som garantert treffer hver eneste tekst.

     RETURNERER om valget faktisk ble LAGRET. Det er avgjørende for kalleren:
     i privat modus (eller med blokkerte nettsteddata) kaster `setItem`, og da
     starter en omlasting på standardspråket igjen. Kombinert med en konto som
     står på et annet språk ville det gitt en evig omlastingsløkke — appen kom
     aldri opp. Kalleren bytter derfor i minnet i stedet når dette er `false`. */
  function setLang(code) {
    current = normalize(code);
    explicit = true;
    var saved = false;
    try { localStorage.setItem(STORAGE_KEY, current); saved = true; } catch (e) { /* privat modus */ }
    applyHtmlLang();
    return saved;
  }

  function applyHtmlLang() {
    var e = entry(current) || LANGS[0];
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', e.html);
  }

  /* Slår opp en tekst. Ukjent nøkkel gir nøkkelen tilbake — synlig i UI-et,
     men ikke en krasj; tests/i18n.test.js er det som stopper den før den når
     noen. `vars` fyller `{felt}`. */
  function t(key, vars) {
    var row = T[key];
    var s = row ? (row[current === 'en' ? 1 : 0] || row[0]) : key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  /* Statisk tekst i index.html. Attributtene sier hvor teksten skal:

       data-i18n              → textContent
       data-i18n-html         → innerHTML (kun tekst vi selv eier, aldri brukerinput)
       data-i18n-title        → title
       data-i18n-aria-label   → aria-label
       data-i18n-placeholder  → placeholder

     Kjøres én gang ved oppstart. Maler (`<template>`) må kjøres gjennom hver
     gang en klon bygges — app.js gjør det i `fromTemplate()`. */
  var ATTRS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'],
  ];
  function translateEl(el) {
    var key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
    key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
    for (var a = 0; a < ATTRS.length; a++) {
      key = el.getAttribute(ATTRS[a][0]);
      if (key) el.setAttribute(ATTRS[a][1], t(key));
    }
  }
  function applyStatic(root) {
    var scope = root || document;
    // `querySelectorAll` treffer bare etterkommere — en klonet malrot bærer
    // ofte attributtene selv, og må derfor oversettes for seg.
    if (scope.nodeType === 1) translateEl(scope);
    var list = scope.querySelectorAll(
      '[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]');
    for (var i = 0; i < list.length; i++) translateEl(list[i]);
    // Malene (`<template>`) ligger i document, men innholdet deres er et eget
    // fragment `querySelectorAll` ikke går inn i: de oversettes når app.js
    // kloner dem, ikke her.
    return scope;
  }

  applyHtmlLang();

  window.HUSKIS_I18N = {
    LANGS: LANGS,
    DEFAULT: DEFAULT,
    STORAGE_KEY: STORAGE_KEY,
    T: T,
    t: t,
    lang: lang,
    chosen: chosen,
    setLang: setLang,
    applyStatic: applyStatic,
  };
})();
