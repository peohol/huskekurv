/* ============================================================
   Huskis — hermetisk mock-backend (KUN for testing, ?mock=1)
   ------------------------------------------------------------
   Etterligner den delmengden av Supabase-klienten appen bruker
   (auth, from().insert/update/delete, rpc, channel), med en
   «database» delt mellom faner via localStorage. Realtime
   simuleres med `storage`-hendelser. Sesjonen er PER FANE
   (sessionStorage), så to faner = to innloggede brukere.

   Fidelitet: nok til å kjøre hele rolle-/delingsmodellen (invitasjon →
   aksept → rolle, medeierskap, capabilities, effektivt mappemedlemskap,
   låser, forlat/utkast, mappeflytting med reparenting og kryssdomene-
   kopiering) + server-side felt-LWW og get_my_doc-synligheten.
   IKKE en full RLS-implementasjon.
   ============================================================ */
(function () {
  'use strict';
  var DB_KEY = 'hk-mock-db';
  var PING_KEY = 'hk-mock-ping';

  // Kunstig «server»-forsinkelse (ms) på alle RPC-/tabell-kall: ?mock=1&lag=800.
  // Brukes i tester for å bevise at UI-et er umiddelbart og operasjonskøen
  // serialiserer riktig selv når operasjonene er trege. 0 (av) uten parameter.
  var LAG = (function () {
    var m = /[?&]lag=(\d+)/.exec(location.search);
    return m ? Math.min(parseInt(m[1], 10) || 0, 10000) : 0;
  })();
  /* Kunstig forsinkelse på AUTH-initialiseringen alene: ?mock=1&authlag=3000.
     Modellerer det ekte supabase-js gjør offline med et token nær utløp —
     `__loadSession()` fornyer tokenet FØR sesjonen leveres, og retry-løkka kan
     bruke opptil 30 000 ms (docs/mobilapp-plan.md, «Hvorfor flymodus er det
     harde tilfellet»). Derfor forsinkes BEGGE veiene sesjonen kommer ut:
     `getSession()` og den første `INITIAL_SESSION`. Brukes til å måle at
     readiness-punktet ikke ligger bak den ventingen. */
  var AUTH_LAG = (function () {
    var m = /[?&]authlag=(\d+)/.exec(location.search);
    return m ? Math.min(parseInt(m[1], 10) || 0, 30000) : 0;
  })();
  function afterAuthLag(fn) {
    if (!AUTH_LAG) return setTimeout(fn, 0);
    return setTimeout(fn, AUTH_LAG);
  }

  // Utfør et «server»-kall: run() kjøres ETTER forsinkelsen (som om forespørselen
  // var underveis), og resultatet leveres asynkront. Kastede feil → { error }.
  function serverCall(run) {
    function attempt() {
      try { return run(); } catch (e) { return { data: null, error: { message: e.message } }; }
    }
    if (!LAG) return Promise.resolve(attempt());
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(attempt()); }, LAG);
    });
  }

  function loadDB() {
    var db = null;
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (e) {}
    if (!db) {
      db = {
        profiles: [], passwords: {},
        universes: [], groups: [], cards: [], items: [],
        // Idéene (docs/ideer.md): kontoens egne rader, uten forelder i
        // hierarkiet — eierskapet er hele autorisasjonen.
        ideas: [],
        // Notatene (docs/notater-plan.md): kontoens egne rader, Prosjekt >
        // Mappe > Notat. Ingen deling, ingen roller — eierskapet er hele
        // autorisasjonen, som for idéene.
        note_projects: [], note_folders: [], notes: [],
        memberships: [], share_invites: [], tombstones: [],
        notifications: [], notification_prefs: [],
        push_subscriptions: [], push_deliveries: [],
        // Supabase Auth eier `auth.sessions`; mocken må ha noe å eie den MED,
        // ellers kan ikke fjern-utlogging testes i det hele tatt. Sidebordet
        // (`device_sessions`) er vårt eget, som i users-and-sharing.sql.
        auth_sessions: [], device_sessions: [],
        // Android-appens varselkanal: statusen som gjør «Enheter med varsler»
        // sann også for native (docs/varsler.md).
        native_notif_devices: [],
      };
    }
    // En seedet eller eldre mock-database har ikke idé-tabellen; klienten leser
    // den ved hver runde, så den må alltid finnes.
    if (!Array.isArray(db.ideas)) db.ideas = [];
    // Samme grunn: en seedet eller eldre database har ikke notattabellene.
    if (!Array.isArray(db.note_projects)) db.note_projects = [];
    if (!Array.isArray(db.note_folders)) db.note_folders = [];
    if (!Array.isArray(db.notes)) db.notes = [];
    return migrateRoles(db);
  }
  // Speiler rolle-backfillen i users-and-sharing.sql: en database fra FØR
  // rolle-omleggingen har objekter uten roller (og kanskje medlemskap/
  // invitasjoner på listenivå). Vi utleder rollene av oppretteren én gang og
  // markerer det, så en senere fjernet rolle aldri kommer tilbake.
  function migrateRoles(db) {
    db.memberships = db.memberships || [];
    db.share_invites = db.share_invites || [];
    // Varseltabellene kom til etter at testene begynte å seede `hk-mock-db`;
    // en seedet database uten dem skal virke som en tom (som `add column if
    // not exists` i users-and-sharing.sql).
    db.notifications = db.notifications || [];
    db.notification_prefs = db.notification_prefs || [];
    db.push_subscriptions = db.push_subscriptions || [];
    db.push_deliveries = db.push_deliveries || [];
    db.auth_sessions = db.auth_sessions || [];
    db.device_sessions = db.device_sessions || [];
    db.native_notif_devices = db.native_notif_devices || [];
    if (db._rolesBackfilled) return db;
    db._rolesBackfilled = true;
    var has = function (uid, col, id) {
      return db.memberships.some(function (m) { return m.user_id === uid && m[col] === id; });
    };
    (db.universes || []).forEach(function (u) {
      var row = db.memberships.find(function (m) { return m.user_id === u.owner_id && m.universe_id === u.id; });
      if (row) row.role = 'owner';
      else db.memberships.push({ id: newId('mem'), user_id: u.owner_id, universe_id: u.id,
        group_id: null, role: 'owner', pos: u.pos || 0, created_at: Date.now() });
    });
    (db.groups || []).forEach(function (g) {
      var isUniOwner = db.memberships.some(function (m) {
        return m.user_id === g.owner_id && m.universe_id === g.universe_id && m.role === 'owner';
      });
      if (isUniOwner) return;
      var row = db.memberships.find(function (m) { return m.user_id === g.owner_id && m.group_id === g.id; });
      if (row) row.role = 'owner';
      else db.memberships.push({ id: newId('mem'), user_id: g.owner_id, group_id: g.id,
        universe_id: null, role: 'owner', pos: g.pos || 0, created_at: Date.now() });
    });
    // Eksisterende medlemskap uten rolle er vanlige medlemmer; dedupliser dem
    // som allerede har arvet tilgang via området.
    db.memberships.forEach(function (m) { if (!m.role) m.role = 'member'; });
    db.memberships = db.memberships.filter(function (m) {
      if (m.card_id) return false;                 // lister deles ikke lenger
      if (!m.group_id || m.role !== 'member') return true;
      var g = (db.groups || []).find(function (x) { return x.id === m.group_id; });
      return !(g && has(m.user_id, 'universe_id', g.universe_id));
    });
    db.share_invites = db.share_invites.filter(function (s) { return !s.card_id; });
    db.share_invites.forEach(function (s) { if (!s.role) s.role = 'member'; });
    return db;
  }
  function saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    localStorage.setItem(PING_KEY, String(Math.random()) + ':' + (window.__pingc = (window.__pingc || 0) + 1));
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function hash(str) {
    var h = 0; str = String(str);
    for (var i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
  function uidFor(email) { return 'u-' + hash('user:' + String(email).toLowerCase()); }
  function newId(pfx) { return (pfx || 'id') + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }
  // Objekt-id-er må være ekte UUID-er (som i Postgres) — brukes av move_group.
  function newUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }
  function legacyId(uid, old) { return 'imp-' + hash(uid + ':' + old); }

  function regNewer(aTs, aOrg, bTs, bOrg) {
    aTs = aTs || 0; bTs = bTs || 0;
    if (aTs !== bTs) return aTs > bTs;
    return String(aOrg || '') > String(bOrg || '');
  }

  /* ---------------- Sesjon (per fane) ----------------
     Som ekte Supabase har hver innlogging en ØKT med sin egen id
     (`session_id`-claimet i access-tokenet), og den lever i den delte
     «databasen» — ikke bare i fanen. Det er nettopp fordi den er delt at
     fjern-utlogging kan testes: én fane sletter øktraden, og den andre fanen
     oppdager det i sin neste synk-runde (docs/accounts.md). */
  var SESS_KEY = 'hk-mock-session';
  function getSess() {
    try { return JSON.parse(sessionStorage.getItem(SESS_KEY) || 'null'); } catch (e) { return null; }
  }
  function setSess(user) {
    if (user) sessionStorage.setItem(SESS_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(SESS_KEY);
  }
  /* Øktens id for DENNE fanen. En seedet sesjon uten `session_id` (testene fra
     før øktlaget) får en når den først brukes, så gamle fiksturer virker.

     Raden opprettes KUN i det øyeblikket id-en er ny. En økt som er slettet —
     fjern-utlogget fra en annen fane — skal ikke våkne igjen av at fanen
     ringer serveren; det er nettopp den situasjonen appen må oppdage. */
  function sessionId(db, u) {
    if (!u || u.session_id) return u ? u.session_id : null;
    u.session_id = newUuid();
    setSess(u);
    if (db) {
      db.auth_sessions.push({
        id: u.session_id, user_id: u.id,
        created_at: Date.now(), refreshed_at: Date.now(),
        // Ekte auth.sessions har begge. De ligger her nettopp fordi de ALDRI
        // skal komme ut igjen gjennom list_my_devices().
        user_agent: String(navigator.userAgent || ''), ip: '203.0.113.1',
      });
    }
    return u.session_id;
  }
  function sessionAlive(db, u) {
    if (!u) return false;
    if (!u.session_id) return true;   // ukjent økt er ikke en tilbakekalt økt
    return db.auth_sessions.some(function (x) {
      return x.id === u.session_id && x.user_id === u.id;
    });
  }

  /* ---------------- Rolle- og tilgangsmodell (speiler users-and-sharing.sql) ----------------
     Deling finnes KUN på områder og mapper. Myndighet kommer fra MUTABLE
     ROLLER i `memberships` (role 'owner' | 'member'); `owner_id` på objektradene
     er ren oppretter-historikk uten rettigheter. Områdeeiere er dynamiske
     supereiere av alle mapper i området. */
  function findU(db, id) { return db.universes.find(function (x) { return x.id === id; }) || null; }
  function findG(db, id) { return db.groups.find(function (x) { return x.id === id; }) || null; }
  function findC(db, id) { return db.cards.find(function (x) { return x.id === id; }) || null; }
  function findI(db, id) { return db.items.find(function (x) { return x.id === id; }) || null; }

  function uniMembership(db, uid, id) {
    return db.memberships.find(function (m) { return m.user_id === uid && m.universe_id === id; }) || null;
  }
  function grpMembership(db, uid, id) {
    return db.memberships.find(function (m) { return m.user_id === uid && m.group_id === id; }) || null;
  }
  function universeRole(db, id, uid) { var m = uniMembership(db, uid, id); return m ? m.role : null; }
  function groupRole(db, id, uid) { var m = grpMembership(db, uid, id); return m ? m.role : null; }
  function groupUniverse(db, id) { var g = findG(db, id); return g ? g.universe_id : null; }
  function isUniverseOwner(db, id, uid) { return universeRole(db, id, uid) === 'owner'; }
  function isUniverseMember(db, id, uid) { return universeRole(db, id, uid) !== null; }
  function isGroupOwner(db, id, uid) {
    return groupRole(db, id, uid) === 'owner' || isUniverseOwner(db, groupUniverse(db, id), uid);
  }
  function isGroupMember(db, id, uid) {
    return groupRole(db, id, uid) !== null || isUniverseMember(db, groupUniverse(db, id), uid);
  }
  function universeOwnerCount(db, id) {
    return db.memberships.filter(function (m) { return m.universe_id === id && m.role === 'owner'; }).length;
  }
  // En gjenværende eier av området (aldri uid) — speiler
  // public.surviving_universe_owner(). Null = området står uten eier når
  // brukeren er borte, og skal slettes med kontoen (se delete_account).
  function survivingOwner(db, id, uid) {
    var m = db.memberships.filter(function (x) {
      return x.universe_id === id && x.role === 'owner' && x.user_id !== uid;
    }).sort(function (a, b) { return (a.created_at || 0) - (b.created_at || 0); })[0];
    return m ? m.user_id : null;
  }
  function universeOwnerSet(db, id) {
    return db.memberships.filter(function (m) { return m.universe_id === id && m.role === 'owner'; })
      .map(function (m) { return m.user_id; }).sort().join(',');
  }
  function universeMemberCount(db, id) {
    return db.memberships.filter(function (m) { return m.universe_id === id; }).length;
  }
  function groupMemberCount(db, id) {
    var seen = {};
    db.memberships.forEach(function (m) {
      if (m.universe_id && m.universe_id === groupUniverse(db, id)) seen[m.user_id] = 1;
      if (m.group_id === id) seen[m.user_id] = 1;
    });
    return Object.keys(seen).length;
  }

  // Området leses KUN av områdemedlemmer — en direkte mappemottaker skal
  // aldri se områdets navn eller medlemsliste.
  function canReadUniverse(db, id, uid) { return isUniverseMember(db, id, uid); }
  function canReadGroup(db, id, uid) { return !!findG(db, id) && isGroupMember(db, id, uid); }
  function canReadCard(db, id, uid) {
    var c = findC(db, id);
    return !!c && canReadGroup(db, c.group_id, uid);
  }
  function canReadAny(db, type, id, uid) {
    if (type === 'universe') return canReadUniverse(db, id, uid);
    if (type === 'group') return canReadGroup(db, id, uid);
    if (type === 'card') return canReadCard(db, id, uid);
    if (type === 'item') { var i = findI(db, id); return !!i && canReadCard(db, i.card_id, uid); }
    return false;
  }
  function resourceGroup(db, type, id) {
    if (type === 'group') return id;
    if (type === 'card') { var c = findC(db, id); return c ? c.group_id : null; }
    if (type === 'item') { var i = findI(db, id); var c2 = i && findC(db, i.card_id); return c2 ? c2.group_id : null; }
    return null;
  }
  function resourceUniverse(db, type, id) {
    if (type === 'universe') return id;
    return groupUniverse(db, resourceGroup(db, type, id));
  }
  // PRIVILEGERT = eier på nivået som styrer objektet. Privilegerte påvirkes
  // aldri av en lås for egen redigering.
  function isPrivileged(db, type, id, uid) {
    if (type === 'universe') return isUniverseOwner(db, id, uid);
    var g = resourceGroup(db, type, id);
    return !!g && isGroupOwner(db, g, uid);
  }

  // Ordnet kjede nærmeste-først [liste?, mappe?, område?].
  function lockChain(db, type, id) {
    var vCard = null, vGroup = null, vUniverse = null, r, chain = [];
    if (type === 'item') { r = findI(db, id); vCard = r ? r.card_id : null; }
    else if (type === 'card') vCard = id;
    else if (type === 'group') vGroup = id;
    else if (type === 'universe') vUniverse = id;
    if (vCard) { r = findC(db, vCard); vGroup = r ? r.group_id : null; }
    if (vGroup) { r = findG(db, vGroup); vUniverse = r ? r.universe_id : null; }
    if (vCard) { r = findC(db, vCard); if (r) chain.push({ type: 'card', row: r }); }
    if (vGroup) { r = findG(db, vGroup); if (r) chain.push({ type: 'group', row: r }); }
    if (vUniverse) { r = findU(db, vUniverse); if (r) chain.push({ type: 'universe', row: r }); }
    return chain;
  }
  function effectiveLockSource(db, type, id) {
    var chain = lockChain(db, type, id);
    for (var k = 0; k < chain.length; k++) {
      var n = chain[k].row;
      if (n.locked || n.unlocked) return { type: chain[k].type, id: n.id, isLocked: !!n.locked };
    }
    return null;
  }
  function isEffectivelyLocked(db, type, id) { var s = effectiveLockSource(db, type, id); return !!(s && s.isLocked); }
  function inheritedLockSource(db, type, id) {
    var pt = null, pid = null, r;
    if (type === 'card') { pt = 'group'; r = findC(db, id); pid = r ? r.group_id : null; }
    else if (type === 'group') { pt = 'universe'; r = findG(db, id); pid = r ? r.universe_id : null; }
    else if (type === 'item') { pt = 'card'; r = findI(db, id); pid = r ? r.card_id : null; }
    else return null;
    return pid ? effectiveLockSource(db, pt, pid) : null;
  }
  // Unntak fra en ARVET lås: områdeeiere alltid; er låsen satt på en MAPPE,
  // også en EKSPLISITT mappeeier der. Uten arvet lås er «unntak» bare en
  // overflødig flaggverdi som objektets lås-eier kan rydde bort.
  function canManageLockException(db, type, id, uid) {
    if (isUniverseOwner(db, resourceUniverse(db, type, id), uid)) return true;
    var s = inheritedLockSource(db, type, id);
    if (s && s.isLocked && s.type === 'group') return groupRole(db, s.id, uid) === 'owner';
    if (!(s && s.isLocked)) return isPrivileged(db, type, id, uid);
    return false;
  }

  // Invitasjonspolicy (tretilstand med dynamisk arv) — kun område og mappe.
  function effectiveInviteSource(db, type, id) {
    var chain = [], r;
    if (type === 'group') {
      r = findG(db, id); if (r) chain.push({ type: 'group', row: r });
      var u = r && findU(db, r.universe_id); if (u) chain.push({ type: 'universe', row: u });
    } else if (type === 'universe') {
      r = findU(db, id); if (r) chain.push({ type: 'universe', row: r });
    }
    for (var k = 0; k < chain.length; k++) {
      var pol = chain[k].row.invite_policy;
      if (pol === 'allow' || pol === 'deny') return { type: chain[k].type, id: chain[k].row.id, pol: pol };
    }
    return null;
  }
  function effectiveInvitePolicy(db, type, id) {
    var s = effectiveInviteSource(db, type, id); return s ? s.pol === 'allow' : true;
  }
  function inheritedInviteSource(db, type, id) {
    if (type !== 'group') return null;
    var g = findG(db, id);
    return g ? effectiveInviteSource(db, 'universe', g.universe_id) : null;
  }

  /* ---- Capabilities ---- */
  function canEditContent(db, type, id, uid) {
    return canReadAny(db, type, id, uid) &&
      (isPrivileged(db, type, id, uid) || !isEffectivelyLocked(db, type, id));
  }
  function canCreateChild(db, type, id, uid) { return canEditContent(db, type, id, uid); }
  // Posisjonen tilhører FORELDERENS organisering. Områdets toppnivåposisjon
  // er PERSONLIG (memberships.pos) og krever bare medlemskap.
  function canReorderInParent(db, type, id, uid) {
    var r;
    if (type === 'universe') return isUniverseMember(db, id, uid);
    if (type === 'group') { r = findG(db, id); return !!r && canEditContent(db, 'universe', r.universe_id, uid); }
    if (type === 'card') { r = findC(db, id); return !!r && canEditContent(db, 'group', r.group_id, uid); }
    if (type === 'item') { r = findI(db, id); return !!r && canEditContent(db, 'card', r.card_id, uid); }
    return false;
  }
  function canDeleteObject(db, type, id, uid) {
    if (type === 'universe') return isUniverseOwner(db, id, uid);
    if (type === 'group') {
      return isGroupOwner(db, id, uid) ||
        (isUniverseMember(db, groupUniverse(db, id), uid) && !isEffectivelyLocked(db, 'group', id));
    }
    return isPrivileged(db, type, id, uid) ||
      (canReadAny(db, type, id, uid) && !isEffectivelyLocked(db, type, id));
  }
  function canLeave(db, type, id, uid) {
    if (type === 'universe') {
      var r = universeRole(db, id, uid);
      return r !== null && (r !== 'owner' || universeOwnerCount(db, id) > 1);
    }
    // En direkte mapperolle gir bare forlat-rett når den er ENESTE vei inn:
    // med en områderolle i tillegg forlater man i området (se can_leave).
    if (type === 'group') {
      return groupRole(db, id, uid) !== null &&
        universeRole(db, groupUniverse(db, id), uid) === null;
    }
    return false;
  }
  function canManageMembers(db, type, id, uid) {
    if (type === 'universe') return isUniverseOwner(db, id, uid);
    if (type === 'group') return isGroupOwner(db, id, uid);
    return false;
  }
  function canInviteTo(db, type, id, uid) {
    return canManageMembers(db, type, id, uid) ||
      (canReadAny(db, type, id, uid) && (type === 'universe' || type === 'group') &&
       effectiveInvitePolicy(db, type, id));
  }
  function canInviteOwner(db, type, id, uid) { return canManageMembers(db, type, id, uid); }
  function canManageLock(db, type, id, uid) { return isPrivileged(db, type, id, uid); }
  function canManageInvitePolicy(db, type, id, uid) {
    var s = inheritedInviteSource(db, type, id);
    if (s && s.pol === 'deny') return isUniverseOwner(db, resourceUniverse(db, type, id), uid);
    return canManageMembers(db, type, id, uid);
  }
  function canMoveGroup(db, id, uid) { return canDeleteObject(db, 'group', id, uid); }

  function universeCaps(db, id, uid) {
    return {
      read: canReadUniverse(db, id, uid),
      editContent: canEditContent(db, 'universe', id, uid),
      createGroup: canCreateChild(db, 'universe', id, uid),
      reorderGroups: canEditContent(db, 'universe', id, uid),
      manageSettings: canManageMembers(db, 'universe', id, uid),
      delete: canDeleteObject(db, 'universe', id, uid),
      leave: canLeave(db, 'universe', id, uid),
      invite: canInviteTo(db, 'universe', id, uid),
      inviteOwner: canInviteOwner(db, 'universe', id, uid),
      manageMembers: canManageMembers(db, 'universe', id, uid),
      manageOwners: canManageMembers(db, 'universe', id, uid),
      manageLock: canManageLock(db, 'universe', id, uid),
      lockException: canManageLockException(db, 'universe', id, uid),
      managePolicy: canManageInvitePolicy(db, 'universe', id, uid),
      locked: isEffectivelyLocked(db, 'universe', id),
    };
  }
  function groupCaps(db, id, uid) {
    return {
      read: canReadGroup(db, id, uid),
      editContent: canEditContent(db, 'group', id, uid),
      createList: canCreateChild(db, 'group', id, uid),
      reorderInParent: canReorderInParent(db, 'group', id, uid),
      manageSettings: canManageMembers(db, 'group', id, uid),
      delete: canDeleteObject(db, 'group', id, uid),
      move: canMoveGroup(db, id, uid),
      leave: canLeave(db, 'group', id, uid),
      invite: canInviteTo(db, 'group', id, uid),
      inviteOwner: canInviteOwner(db, 'group', id, uid),
      manageMembers: canManageMembers(db, 'group', id, uid),
      manageOwners: canManageMembers(db, 'group', id, uid),
      manageLock: canManageLock(db, 'group', id, uid),
      lockException: canManageLockException(db, 'group', id, uid),
      managePolicy: canManageInvitePolicy(db, 'group', id, uid),
      locked: isEffectivelyLocked(db, 'group', id),
    };
  }

  function emailOf(db, uid) {
    var p = db.profiles.find(function (x) { return x.id === uid; });
    return p ? p.email : null;
  }
  function nameOf(db, uid) {
    var p = db.profiles.find(function (x) { return x.id === uid; });
    return p ? (p.display_name || null) : null;
  }

  /* ---- Opprydding ved forlat/utkast (purge_*_access i SQL) ---- */
  function purgeUniverseAccess(db, uniId, userId) {
    var groupIds = db.groups.filter(function (g) { return g.universe_id === uniId; })
      .map(function (g) { return g.id; });
    db.memberships = db.memberships.filter(function (m) {
      if (m.user_id !== userId) return true;
      if (m.universe_id === uniId) return false;
      return groupIds.indexOf(m.group_id) === -1;
    });
    var em = emailOf(db, userId);
    db.share_invites.forEach(function (s) {
      if (s.status !== 'pending') return;
      var mine = s.invitee_id === userId || (em && String(s.invitee_email).toLowerCase() === em);
      if (!mine) return;
      if (s.universe_id === uniId || groupIds.indexOf(s.group_id) > -1) s.status = 'revoked';
    });
    var cardIds = db.cards.filter(function (c) { return groupIds.indexOf(c.group_id) > -1; })
      .map(function (c) { return c.id; });
    db.cards.forEach(function (c) {
      if (c.responsible === userId && groupIds.indexOf(c.group_id) > -1) { c.responsible = null; c.ts = Date.now(); c.org = 'server'; }
    });
    db.items.forEach(function (i) {
      if (i.responsible === userId && cardIds.indexOf(i.card_id) > -1) { i.responsible = null; i.ts = Date.now(); i.org = 'server'; }
    });
  }
  function purgeGroupAccess(db, gid, userId) {
    db.memberships = db.memberships.filter(function (m) {
      return !(m.user_id === userId && m.group_id === gid);
    });
    var em = emailOf(db, userId);
    db.share_invites.forEach(function (s) {
      if (s.status === 'pending' && s.group_id === gid &&
          (s.invitee_id === userId || (em && String(s.invitee_email).toLowerCase() === em))) s.status = 'revoked';
    });
    if (isGroupMember(db, gid, userId)) return;
    var cardIds = db.cards.filter(function (c) { return c.group_id === gid; }).map(function (c) { return c.id; });
    db.cards.forEach(function (c) {
      if (c.responsible === userId && c.group_id === gid) { c.responsible = null; c.ts = Date.now(); c.org = 'server'; }
    });
    db.items.forEach(function (i) {
      if (i.responsible === userId && cardIds.indexOf(i.card_id) > -1) { i.responsible = null; i.ts = Date.now(); i.org = 'server'; }
    });
  }

  /* ---------------- Varsler (docs/varsler.md) ----------------
     Speiler notify_record()/notify_set_prefs() i users-and-sharing.sql:
     radene skrives KUN her (klienten har ingen insert-rett), identiteten er
     (user_id, key), og markøren går bare framover — aldri forbi «serverens»
     klokke. Taket er det samme som get_my_doc() leverer. */
  var NOTIF_KEEP = 200;
  /* Levetiden for en varselrad — speiler notify_max_age_ms() i SQL-en. Målt fra
     det SENESTE av `created_at` og `at`, altså fra da raden ble historikk: en
     planlagt rad ved horisontens ytterkant er allerede en måned gammel når den
     ringer, og en fersk rad om en gammel terskel er ikke gammel. En rad som
     ennå ikke har ringt (planen, «Utsett») har `at` foran nå og røres aldri. */
  var NOTIF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  function notifUtløpt(n, now) {
    return Math.max(n.at, n.created_at || 0) < now - NOTIF_MAX_AGE_MS;
  }
  var NOTIF_TYPES = { dueOver: 1, dueSoon: 1, startNow: 1, startSoon: 1 };
  var NOTIF_OBJ_TYPES = { card: 1, category: 1, item: 1 };
  function notifPrefsRow(db, uid) {
    var row = db.notification_prefs.find(function (x) { return x.user_id === uid; });
    if (row) return row;
    row = { user_id: uid, due_over: true, due_soon: true, start_now: true, start_soon: true,
            cursor_at: 0, tz: null, tz_at: 0, updated_at: Date.now() };
    db.notification_prefs.push(row);
    return row;
  }
  function notifRecord(db, uid, rows, cursor) {
    var prefs = notifPrefsRow(db, uid);
    var now = Date.now();
    var lagt = 0;
    (rows || []).forEach(function (r) {
      if (!r || !r.key || r.at == null) return;
      if (!NOTIF_TYPES[r.type] || !NOTIF_OBJ_TYPES[r.obj_type]) return;
      var finnes = db.notifications.find(function (n) {
        return n.user_id === uid && n.key === r.key;
      });
      if (finnes) {
        /* Som serveren: en PLANLAGT rad (ennå ikke forfalt, ikke utsatt) skal
           bære et ferskt øyeblikksbilde av navn og sti — det er den teksten web
           push leverer når den forfaller. Historikk skrives aldri om. */
        if (finnes.at > now && !finnes.snoozed &&
            (finnes.name !== (r.name || '') || finnes.path !== (r.path || ''))) {
          finnes.name = r.name || '';
          finnes.path = r.path || '';
          lagt++;
        }
        return;
      }
      lagt++;
      db.notifications.push({
        id: newUuid(), user_id: uid, key: String(r.key), type: r.type,
        obj_type: r.obj_type, obj_id: r.obj_id || null,
        name: r.name || '', path: r.path || '', value: r.value == null ? null : r.value,
        at: r.at, snoozed: !!r.snoozed, created_at: now, read_at: null,
      });
    });
    prefs.cursor_at = Math.max(prefs.cursor_at || 0, Math.min(cursor || 0, now));
    prefs.updated_at = now;
    // LEVETIDEN først, som serveren: en rad som ble historikk for lenger siden
    // enn levetiden ryddes uansett hvor kort historikken er. Deretter taket.
    db.notifications = db.notifications.filter(function (n) {
      return n.user_id !== uid || !notifUtløpt(n, now);
    });
    var mine = db.notifications.filter(function (n) { return n.user_id === uid; })
      .sort(function (a, b) { return (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1); });
    var doomed = {};
    mine.slice(NOTIF_KEEP).forEach(function (n) { doomed[n.id] = 1; });
    if (mine.length > NOTIF_KEEP) {
      db.notifications = db.notifications.filter(function (n) { return !doomed[n.id]; });
    }
    pushEnqueue(db, uid);
    return lagt;   // som serveren: hvor mange rader som FAKTISK ble lagt inn
  }

  /* ---------------- Web push (docs/varsler.md) ----------------
     Speiler push_enqueue()/push_subscribe()/push_unsubscribe(): utboksen får
     én rad per (PLANLAGT varsel, aktivt abonnement), og den unike paret er
     idempotensen. Serveren tolker ingen terskler — den leverer det klienten
     alt har logget. Selve sendingen finnes ikke i mock-backenden: det er en
     Edge-funksjon, og nettlesertestene har ingen pushtjeneste å sende til. */
  function pushEnqueue(db, uid) {
    var now = Date.now();
    var lagt = 0;
    db.notifications.forEach(function (n) {
      if (n.user_id !== uid || !(n.at > now)) return;
      db.push_subscriptions.forEach(function (sub) {
        if (sub.user_id !== uid || !pushActive(sub)) return;
        var finnes = db.push_deliveries.some(function (d) {
          return d.notification_id === n.id && d.subscription_id === sub.id;
        });
        if (finnes) return;
        lagt++;
        db.push_deliveries.push({
          id: db.push_deliveries.length + 1, notification_id: n.id,
          subscription_id: sub.id, user_id: uid, due_at: n.at,
          status: 'pending', attempts: 0, claimed_at: null, done_at: null, error: null,
        });
      });
    });
    return lagt;
  }
  /* Som serveren: en bruker får ha en håndfull nettlesere, ikke tusen. Uten
     taket multipliserer hvert endepunkt både utboksen og antallet HTTP-kall
     senderen gjør. */
  var PUSH_SUB_MAX = 20;
  // … og hvor lenge et spor som døde AV SEG SELV (404/410) blir liggende. Et
  // spor brukeren satte (`revoked_at`) ryddes aldri — se pushSubscribe().
  var PUSH_KEEP_DAYS = 90;
  var pushActive = function (x) { return !x.disabled_at && !x.revoked_at; };
  function pushSubscribe(db, uid, p) {
    var e = p.p_endpoint;
    /* Endepunktet blir målet for et HTTP-kall senderen gjør. Kravene er
       standardens egne — https, et vertsnavn, ingen kontrolltegn — pluss ett:
       verten skal være et NAVN. En bar IP eller `localhost` er ingen
       push-tjeneste. Ingen liste over pushleverandører: Web Push har ingen. */
    if (!e || !/^https:\/\/[A-Za-z0-9._~%-]+(:[0-9]{1,5})?([/?#]|$)/.test(e) ||
        /[\s\u0000-\u001f\u007f]/.test(e) || e.length > 2000) {
      throw new Error('ugyldig endepunkt');
    }
    var vert = (/^https:\/\/([^/?#]+)/.exec(e)[1] || '').split(':')[0].toLowerCase();
    if (/^[0-9.]+$/.test(vert) || vert === 'localhost' ||
        /\.(localhost|local)$/.test(vert)) throw new Error('ugyldig endepunkt');
    if (p.p_p256dh == null || p.p_auth == null) throw new Error('mangler nøkler');
    // RFC 8291-formen, romslig nok til padding: 65 byte og 16 byte, base64url.
    if (!/^[A-Za-z0-9_-]+=*$/.test(p.p_p256dh) || p.p_p256dh.length < 80 || p.p_p256dh.length > 200 ||
        !/^[A-Za-z0-9_-]+=*$/.test(p.p_auth) || p.p_auth.length < 16 || p.p_auth.length > 40) {
      throw new Error('ugyldige nøkler');
    }
    var row = db.push_subscriptions.find(function (x) { return x.endpoint === p.p_endpoint; });
    var mitt = !row || !row.user_id || row.user_id === uid;
    /* TILBAKEKALT AV BRUKEREN (som serveren): den automatiske fornyelsen skal
       ikke kunne oppheve et valg tatt på en annen enhet. Bare et EKSPLISITT
       «slå på varsler» på nettopp denne klienten tar det tilbake — og et
       eierskifte, siden tilbakekallingen var forrige brukers valg.

       To spørsmål, ikke ett: er ENDEPUNKTET slått av, eller er hele
       KLIENTKONTEKSTEN (`user_id` + `device_id` + `origin`) det? Det andre
       fanger et endepunkt nettleseren har rullert mens klienten lå ubrukt. */
    var avslatt = false;
    if (mitt) {
      avslatt = !!(row && row.revoked_at);
      if (!avslatt && p.p_device_id != null && p.p_origin != null) {
        avslatt = db.push_subscriptions.some(function (x) {
          return x.user_id === uid && x.revoked_at &&
                 x.device_id === p.p_device_id && x.origin === p.p_origin;
        });
        // Konteksten er avslått → ingen rad i den skal være aktiv.
        if (avslatt && row) pushRevoke(db, uid, row.id);
      }
    }
    if (avslatt && !p.p_explicit) {
      return { id: row ? row.id : null, revoked: true };
    }
    /* Et eksplisitt «slå på» gjelder KLIENTEN: gamle spor fra rullerte
       endepunkter i den samme konteksten har gjort jobben sin og slettes. */
    if (p.p_explicit && p.p_device_id != null && p.p_origin != null) {
      var vekk2 = {};
      db.push_subscriptions = db.push_subscriptions.filter(function (x) {
        if (x.user_id === uid && x.revoked_at && x.device_id === p.p_device_id &&
            x.origin === p.p_origin && x.endpoint !== p.p_endpoint) {
          vekk2[x.id] = 1; return false;
        }
        return true;
      });
      db.push_deliveries = db.push_deliveries.filter(function (d) { return !vekk2[d.subscription_id]; });
      row = db.push_subscriptions.find(function (x) { return x.endpoint === p.p_endpoint; });
    }
    if (!row) {
      row = { id: newUuid(), endpoint: p.p_endpoint, created_at: Date.now() };
      db.push_subscriptions.push(row);
    }
    /* EIERSKIFTE (som serveren): endepunktet ER nettleseren, så en ny
       innlogging flytter abonnementet i stedet for å lage en dublett — og et
       endepunkt som var slått av våkner, siden nettleseren nettopp sa at det
       virker. Men køen som lå der er den FORRIGE brukerens, og hver levering
       bærer et objektnavn. Den tømmes i samme operasjon. */
    if (row.user_id && row.user_id !== uid) {
      db.push_deliveries = db.push_deliveries.filter(function (d) { return d.subscription_id !== row.id; });
    }
    row.user_id = uid;
    row.p256dh = p.p_p256dh;
    row.auth = p.p_auth;
    row.labels = p.p_labels || {};
    row.tz = p.p_tz || null;
    // Gjenkjennelig metadata — aldri hele user-agenten (docs/accounts.md).
    if (p.p_browser != null) row.browser = p.p_browser;
    if (p.p_platform != null) row.platform = p.p_platform;
    if (p.p_origin != null) row.origin = p.p_origin;
    if (p.p_device_id != null) row.device_id = p.p_device_id;
    row.seen_at = Date.now();
    row.disabled_at = null;
    row.revoked_at = null;
    /* TAKET, som serveren: den eldst sette ryker, og den som NETTOPP meldte
       seg på ryker aldri — den er den brukeren står med i hånden. Det måles på
       de AKTIVE: forsterkeren er sendingen, og et tilbakekalt spor koster
       ingenting der. Telte vi det med, kunne tjue nye påmeldinger kastet ut
       nettopp raden som håndhever en avslåing. */
    var mine = db.push_subscriptions.filter(function (x) {
      return x.user_id === uid && x.id !== row.id && pushActive(x);
    }).sort(function (a, b) { return (b.seen_at || 0) - (a.seen_at || 0) ||
        (b.created_at || 0) - (a.created_at || 0); });
    if (mine.length > PUSH_SUB_MAX - 1) {
      var vekk = {};
      mine.slice(PUSH_SUB_MAX - 1).forEach(function (x) { vekk[x.id] = 1; });
      db.push_subscriptions = db.push_subscriptions.filter(function (x) { return !vekk[x.id]; });
      db.push_deliveries = db.push_deliveries.filter(function (d) { return !vekk[d.subscription_id]; });
    }
    /* OPPRYDNING, som serveren: kun 404/410-spor eldre enn horisonten. Et spor
       BRUKEREN satte blir stående for godt — ryddet vi det, ville den avslåtte
       nettleseren meldt seg på igjen av seg selv den dagen den ble åpnet. */
    var grense = Date.now() - PUSH_KEEP_DAYS * 86400000;
    var ryddet = {};
    db.push_subscriptions = db.push_subscriptions.filter(function (x) {
      if (x.user_id === uid && x.id !== row.id && !x.revoked_at &&
          x.disabled_at && x.disabled_at < grense) { ryddet[x.id] = 1; return false; }
      return true;
    });
    // Kaskaden fra `push_deliveries.subscription_id`, som i Postgres.
    db.push_deliveries = db.push_deliveries.filter(function (d) { return !ryddet[d.subscription_id]; });
    pushEnqueue(db, uid);
    return { id: row.id, revoked: false };
  }
  /* FJERN-AVSLÅING (push_revoke/push_revoke_others): raden blir stående som et
     spor, men er ikke aktiv — og det som lå i kø til den AVSLUTTES, ellers
     kom et varsel brukeren nettopp slo av fram noen minutter senere. */
  function pushEndQueue(db, subId) {
    db.push_deliveries.forEach(function (d) {
      if (d.subscription_id === subId && d.status === 'pending') {
        d.status = 'gone'; d.done_at = Date.now();
        d.error = d.error || 'slått av av brukeren';
      }
    });
  }
  /* Er de to radene den SAMME klienten? Konteksten er `user_id` + `device_id`
     + `origin` (serveren avgjør det samme spørsmålet i `push_revoke()`). En rad
     uten kontekst — en eldre klient sendte den ikke — er bare seg selv. */
  function sammeKlient(a, b) {
    return !!(a && b && a.user_id === b.user_id &&
      a.device_id != null && a.origin != null &&
      a.device_id === b.device_id && a.origin === b.origin);
  }
  function pushRevokeRad(db, row) {
    // Idempotent, som serveren: en rad som alt er tilbakekalt beholder
    // tidspunktet sitt.
    row.revoked_at = row.revoked_at || Date.now();
    /* Nøklene tømmes, som serveren: et abonnement brukeren har slått av skal
       ikke bli liggende med mottakernøklene sine i det uendelige. `endpoint`,
       `device_id` og `origin` blir stående — det er dem sporet kjennes igjen
       på, også når nettleseren har rullert endepunktet. */
    row.p256dh = ''; row.auth = ''; row.labels = {}; row.tz = null;
    pushEndQueue(db, row.id);
  }
  /* «Slå av» gjelder ENHETEN, ikke URL-en (som serveren). Etter en
     endepunktrullering kan den samme klienten ha to rader en stund; slo vi bare
     av den listen tilfeldigvis pekte på, ville nettleseren fortsatt fått
     varsler. Ingen lås her: mock-backenden kjører ett kall om gangen i én
     nettlesertråd, mens serveren må ta `push_lock()` for den samme garantien. */
  function pushRevoke(db, uid, id) {
    var row = db.push_subscriptions.find(function (x) { return x.id === id && x.user_id === uid; });
    if (!row) return false;      // en fremmed id røper aldri at raden finnes
    pushRevokeRad(db, row);
    db.push_subscriptions.forEach(function (x) {
      // De andre i konteksten: bare de AKTIVE. En rad som alt er død (404/410)
      // skal ikke gjøres om til et brukerinitiert, permanent spor.
      if (x.id !== row.id && pushActive(x) && sammeKlient(row, x)) pushRevokeRad(db, x);
    });
    return true;
  }
  function pushRevokeOthers(db, uid, endpoint) {
    var n = 0;
    /* Det som BLIR STÅENDE er klienten, ikke bare adressen den ringte fra:
       ellers ville en helt vanlig endepunktrullering på brukerens egen
       nettleser slått av hennes egen enhet. */
    var min = endpoint ? db.push_subscriptions.find(function (x) {
      return x.user_id === uid && x.endpoint === endpoint; }) : null;
    db.push_subscriptions.slice().forEach(function (x) {
      if (x.user_id !== uid || !pushActive(x)) return;
      if (endpoint && x.endpoint === endpoint) return;
      if (min && sammeKlient(min, x)) return;
      // Tallet er ENHETER, ikke rader: en rad som alt ble slått av sammen med
      // konteksten sin er allerede talt.
      if (pushActive(x) && pushRevoke(db, uid, x.id)) n++;
    });
    return n;
  }
  /* ---------------- Native varselenheter (docs/varsler.md) ----------------
     Speiler native_notif_touch()/_revoke()/notif_revoke_others(): Android
     planlegger LOKALE alarmer og har intet abonnement, så det serveren har er
     en STATUS per klientkontekst (`user_id` + `device_id` + `origin`) — den
     samme trekanten et avslått abonnement kjennes igjen på. */
  var nativeCtx = function (x, dev, org) {
    return !!(dev && org && x.device_id === dev && x.origin === org);
  };
  /* DE AKTIVE. Tre ledd, og det tredje er det som gjør listen sann: kanalen er
     på, brukeren har ikke slått den av fra en annen enhet, OG konteksten har
     fortsatt en levende økt. Uten det siste ville en app som ble logget ut
     blitt stående som en «enhet med varsler» til den ble åpnet igjen. */
  function nativeNotifActive(db, uid) {
    var levende = {};
    db.auth_sessions.forEach(function (x) { levende[x.id] = 1; });
    return db.native_notif_devices.filter(function (n) {
      if (n.user_id !== uid || !n.enabled || n.revoked_at) return false;
      return db.device_sessions.some(function (d) {
        return d.user_id === uid && levende[d.session_id] &&
               nativeCtx(d, n.device_id, n.origin);
      });
    });
  }
  function nativeNotifTouch(db, uid, p) {
    var dev = p.p_device_id, org = p.p_origin;
    if (!dev || !org) throw new Error('mangler klientkontekst');
    var vil = !!p.p_enabled;
    var row = db.native_notif_devices.find(function (x) {
      return x.user_id === uid && nativeCtx(x, dev, org);
    });
    /* FJERN-AVSLÅTT, og runden er ikke et eksplisitt «slå på». Da står valget:
       raden blir liggende avslått, og svaret sier fra slik at appen kan rigge
       ned sin egen ende (avlyse alarmene, sette bryteren av). */
    if (row && row.revoked_at && !p.p_explicit) {
      row.enabled = false;
      if (p.p_browser != null) row.browser = p.p_browser;
      if (p.p_platform != null) row.platform = p.p_platform;
      row.seen_at = Date.now();
      return { id: row.id, revoked: true, enabled: false };
    }
    // En klient som aldri har hatt varsler på trenger ingen rad (som serveren).
    if (!row && !vil) return { id: null, revoked: false, enabled: false };
    if (!row) {
      row = { id: newUuid(), user_id: uid, device_id: dev, origin: org,
              created_at: Date.now(), revoked_at: null };
      db.native_notif_devices.push(row);
    }
    if (p.p_browser != null) row.browser = p.p_browser;
    if (p.p_platform != null) row.platform = p.p_platform;
    row.enabled = vil;
    row.seen_at = Date.now();
    // Bare et eksplisitt «slå PÅ» opphever en fjern-avslåing.
    if (p.p_explicit && vil) row.revoked_at = null;
    return { id: row.id, revoked: false, enabled: vil };
  }
  /* Fjern-avslåing av ÉN native klient — som pushRevoke(), men uten løkke over
     konteksten: én kontekst ER én rad her (den unike indeksen i SQL-en).
     Idempotent: en rad som alt er avslått beholder tidspunktet sitt. */
  function nativeNotifRevoke(db, uid, id) {
    var row = db.native_notif_devices.find(function (x) {
      return x.id === id && x.user_id === uid;
    });
    if (!row) return false;   // en fremmed id røper aldri at raden finnes
    row.revoked_at = row.revoked_at || Date.now();
    row.enabled = false;
    return true;
  }
  /* «Slå av varsler på alle andre enheter» — begge kanaltypene i én handling.
     Nettleserne tas av pushRevokeOthers(), som eier hele den semantikken fra
     før; her legges de native klientene til, alle unntatt kallerens egen. */
  function notifRevokeOthers(db, uid, p) {
    var n = pushRevokeOthers(db, uid, p && p.p_endpoint);
    var dev = p && p.p_device_id, org = p && p.p_origin;
    db.native_notif_devices.slice().forEach(function (x) {
      if (x.user_id !== uid || !x.enabled || x.revoked_at) return;
      if (nativeCtx(x, dev, org)) return;   // gjeldende klient beholdes
      if (nativeNotifRevoke(db, uid, x.id)) n++;
    });
    return n;
  }

  function pushUnsubscribe(db, uid, endpoint) {
    var doomed = {};
    db.push_subscriptions = db.push_subscriptions.filter(function (x) {
      if (x.user_id === uid && x.endpoint === endpoint) { doomed[x.id] = 1; return false; }
      return true;
    });
    db.push_deliveries = db.push_deliveries.filter(function (d) { return !doomed[d.subscription_id]; });
    return null;
  }

  function getMyDoc(db, uid) {
    var myUni = db.universes.filter(function (u) { return isUniverseMember(db, u.id, uid); });
    var myUniIds = {}; myUni.forEach(function (u) { myUniIds[u.id] = 1; });
    var myGroups = db.groups.filter(function (g) {
      return myUniIds[g.universe_id] || grpMembership(db, uid, g.id);
    });
    var myGroupIds = {}; myGroups.forEach(function (g) { myGroupIds[g.id] = 1; });
    var myCards = db.cards.filter(function (c) { return myGroupIds[c.group_id]; });
    var myCardIds = {}; myCards.forEach(function (c) { myCardIds[c.id] = 1; });
    var myItems = db.items.filter(function (i) { return myCardIds[i.card_id]; });
    // Idéer henger på KONTOEN, ikke på hierarkiet: ingen join, bare eierskap.
    var myIdeas = (db.ideas || []).filter(function (d) { return d.owner_id === uid; });
    // Notatene likeså (docs/notater-plan.md).
    var myNoteProjects = (db.note_projects || []).filter(function (p) { return p.owner_id === uid; });
    var myNoteFolders = (db.note_folders || []).filter(function (f) { return f.owner_id === uid; });
    var myNotes = (db.notes || []).filter(function (n) { return n.owner_id === uid; });

    var email = emailOf(db, uid);
    var selfProf = db.profiles.find(function (x) { return x.id === uid; }) || {};
    return {
      user: { id: uid, email: email, display_name: selfProf.display_name || (email || '').split('@')[0] },
      universes: myUni.map(function (u) {
        var m = uniMembership(db, uid, u.id);
        return {
          id: u.id, creator: u.owner_id, createdByMe: u.owner_id === uid,
          role: m ? m.role : null, personalPos: m ? m.pos : 0,
          name: u.name, collapsed: !!u.collapsed,
          trashed: !!u.trashed, locked: !!u.locked, unlocked: !!u.unlocked,
          invitePolicy: u.invite_policy || 'inherit', ts: u.ts, org: u.org,
          pos: u.pos, posTs: u.pos_ts, posOrg: u.pos_org,
          ownerCount: universeOwnerCount(db, u.id),
          ownerKey: universeOwnerSet(db, u.id),
          memberCount: universeMemberCount(db, u.id),
          shared: universeMemberCount(db, u.id) > 1,
          caps: universeCaps(db, u.id, uid),
        };
      }),
      groups: myGroups.map(function (g) {
        var m = grpMembership(db, uid, g.id);
        return {
          id: g.id, creator: g.owner_id, createdByMe: g.owner_id === uid,
          uni: g.universe_id, free: !myUniIds[g.universe_id],
          role: m ? m.role : null, personalPos: m ? m.pos : 0,
          name: g.name, cat: g.cat_id || null, isCat: !!g.is_cat, collapsed: !!g.collapsed,
          trashed: !!g.trashed, locked: !!g.locked, unlocked: !!g.unlocked,
          invitePolicy: g.invite_policy || 'inherit', ts: g.ts, org: g.org,
          pos: g.pos, posTs: g.pos_ts, posOrg: g.pos_org,
          memberCount: groupMemberCount(db, g.id),
          shared: groupMemberCount(db, g.id) > 1,
          caps: groupCaps(db, g.id, uid),
        };
      }),
      cards: myCards.map(function (c) {
        return {
          id: c.id, creator: c.owner_id, createdByMe: c.owner_id === uid, group: c.group_id, title: c.title,
          trashed: !!c.trashed, locked: !!c.locked, unlocked: !!c.unlocked,
          k: c.k !== false, p: c.p !== false,
          responsible: c.responsible || null,
          start: c.start_at || null, due: c.due_at || null, lockTimes: !!c.lock_times,
          collapsed: !!c.collapsed,
          labTs: c.lab_ts, labOrg: c.lab_org, ts: c.ts, org: c.org,
          pos: c.pos, posTs: c.pos_ts, posOrg: c.pos_org,
        };
      }),
      items: myItems.map(function (i) {
        return {
          id: i.id, creator: i.owner_id, createdByMe: i.owner_id === uid, home: i.card_id, text: i.text,
          cat: i.cat_id || null, isCat: !!i.is_cat, lockTimes: !!i.lock_times, collapsed: !!i.collapsed,
          trashed: !!i.trashed, done: !!i.done, responsible: i.responsible || null,
          start: i.start_at || null, due: i.due_at || null,
          ts: i.ts, org: i.org, pos: i.pos, posTs: i.pos_ts, posOrg: i.pos_org,
        };
      }),
      ideas: myIdeas.map(function (d) {
        return {
          id: d.id, creator: d.owner_id, createdByMe: true, text: d.text,
          cat: d.cat_id || null, isCat: !!d.is_cat, collapsed: !!d.collapsed,
          trashed: !!d.trashed,
          ts: d.ts, org: d.org, pos: d.pos, posTs: d.pos_ts, posOrg: d.pos_org,
        };
      }),
      noteProjects: myNoteProjects.map(function (p) {
        return {
          id: p.id, creator: p.owner_id, createdByMe: true, name: p.name,
          collapsed: !!p.collapsed, trashed: !!p.trashed,
          ts: p.ts, org: p.org, pos: p.pos, posTs: p.pos_ts, posOrg: p.pos_org,
        };
      }),
      noteFolders: myNoteFolders.map(function (f) {
        return {
          id: f.id, creator: f.owner_id, createdByMe: true, project: f.project_id,
          name: f.name, trashed: !!f.trashed,
          ts: f.ts, org: f.org, pos: f.pos, posTs: f.pos_ts, posOrg: f.pos_org,
        };
      }),
      notes: myNotes.map(function (n) {
        return {
          id: n.id, creator: n.owner_id, createdByMe: true,
          project: n.project_id, folder: n.folder_id || null,
          title: n.title, body: n.body, trashed: !!n.trashed,
          ts: n.ts, org: n.org, pos: n.pos, posTs: n.pos_ts, posOrg: n.pos_org,
        };
      }),
      invites_in: db.share_invites.filter(function (s) {
        return s.status === 'pending' && (s.universe_id || s.group_id) && (s.invitee_id === uid ||
          (email && String(s.invitee_email).toLowerCase() === email.toLowerCase()));
      }).map(function (s) {
        var type = s.universe_id ? 'universe' : 'group';
        var name = s.universe_id ? (findU(db, s.universe_id) || {}).name : (findG(db, s.group_id) || {}).name;
        return { id: s.id, type: type, role: s.role || 'member', name: name,
                 from: emailOf(db, s.inviter_id), from_name: nameOf(db, s.inviter_id),
                 created_at: s.created_at };
      }),
      invites_out: db.share_invites.filter(function (s) {
        return s.status === 'pending' && s.inviter_id === uid && (s.universe_id || s.group_id);
      }).map(function (s) {
        return { id: s.id, type: s.universe_id ? 'universe' : 'group', role: s.role || 'member',
                 target_id: s.universe_id || s.group_id,
                 email: s.invitee_email, created_at: s.created_at };
      }),
      // Varsler: KUN mine egne rader, nyeste først og med de samme to grensene
      // som serveren — taket på antall OG levetiden (docs/varsler.md). RLS-en i
      // produksjon gjør det samme.
      notifications: db.notifications.filter(function (n) {
        return n.user_id === uid && !notifUtløpt(n, Date.now());
      })
        .sort(function (a, b) {
          return (b.at - a.at) || (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1);
        }).slice(0, NOTIF_KEEP).map(function (n) {
          return { id: n.id, key: n.key, type: n.type, objType: n.obj_type, objId: n.obj_id,
                   name: n.name, path: n.path, value: n.value, at: n.at,
                   snoozed: !!n.snoozed, createdAt: n.created_at, readAt: n.read_at == null ? null : n.read_at };
        }),
      notify_prefs: (function () {
        var p = db.notification_prefs.find(function (x) { return x.user_id === uid; });
        return p ? { dueOver: !!p.due_over, dueSoon: !!p.due_soon,
                     startNow: !!p.start_now, startSoon: !!p.start_soon,
                     cursor: p.cursor_at, tz: p.tz || null, tzAt: p.tz_at || 0 } : null;
      })(),
      /* Antall ENHETER med varsler på — nettlesere med web push OG
         Android-apper med den native kanalen på. Ett tall, ikke endepunktene.
         Begge teller, og det er ikke kosmetikk: tallet er også SIGNALET
         klientene bruker til å oppdage at noen slo dem av. */
      push_devices: db.push_subscriptions.filter(function (x) {
        return x.user_id === uid && !x.disabled_at && !x.revoked_at;
      }).length + nativeNotifActive(db, uid).length,
      /* Er DENNE klientens native varselkanal slått av fra en annen enhet? Et
         presist signal per klient, ikke et aggregat: telleren over står stille
         hvis én enhet slås av mens en annen slås på i det samme vinduet, og en
         åpen app hadde ventet ut kvarteret sitt med alarmer brukeren nettopp
         slo av. Kun den native kanalen — en nettleser kjenner igjen sitt eget
         abonnement på endepunktet, som doc-et ikke har. */
      notif_revoked: (function () {
        var u = getSess();
        var sid = u && u.session_id;
        var d = sid && db.device_sessions.find(function (x) {
          return x.session_id === sid && x.user_id === uid;
        });
        if (!d) return false;
        return db.native_notif_devices.some(function (n) {
          return n.user_id === uid && n.revoked_at && nativeCtx(n, d.device_id, d.origin);
        });
      })(),
      /* Lever økten vår ennå? Som serveren legger vi svaret i det pollede
         doc-et: det er slik en fjern-utlogget fane oppdager tilstanden uten å
         vente på at tokenet utløper (docs/accounts.md). */
      session_ok: sessionAlive(db, getSess()),
    };
  }

  /* ---------------- Enheter og økter (docs/accounts.md) ----------------
     Speiler list_my_devices()/session_touch()/revoke_my_session(): to lister,
     «denne enheten» satt av serveren, og ALDRI et endepunkt, en IP eller en
     hel user-agent den andre veien. */
  function sessionTouch(db, uid, p) {
    var u = getSess();
    var sid = u && u.session_id;
    if (!sessionAlive(db, u)) return { ok: false, session: sid };
    if (sid) {
      var row = db.device_sessions.find(function (x) { return x.session_id === sid; });
      if (!row) {
        row = { session_id: sid, user_id: uid, created_at: Date.now() };
        db.device_sessions.push(row);
      }
      row.user_id = uid;
      if (p.p_browser != null) row.browser = p.p_browser;
      if (p.p_platform != null) row.platform = p.p_platform;
      if (p.p_origin != null) row.origin = p.p_origin;
      if (p.p_device_id != null) row.device_id = p.p_device_id;
      row.seen_at = Date.now();
    }
    pruneDeviceSessions(db, uid);
    return { ok: true, session: sid };
  }
  function pruneDeviceSessions(db, uid) {
    var levende = {};
    db.auth_sessions.forEach(function (x) { levende[x.id] = 1; });
    db.device_sessions = db.device_sessions.filter(function (d) {
      return d.user_id !== uid || levende[d.session_id];
    });
  }
  function listMyDevices(db, uid, p) {
    var endpoint = p && p.p_endpoint;
    // Ingen luking her (som serveren): listen leses fra «auth.sessions», så en
    // foreldreløs sidebordsrad er allerede usynlig. session_touch() luker.
    var u = getSess();
    var sid = u && u.session_id;
    var sessions = db.auth_sessions.filter(function (x) { return x.user_id === uid; })
      .map(function (x) {
        var d = db.device_sessions.find(function (y) { return y.session_id === x.id; }) || {};
        return {
          id: x.id, current: !!sid && x.id === sid,
          browser: d.browser || null, platform: d.platform || null,
          origin: d.origin || null,
          createdAt: Math.min(d.created_at || x.created_at, x.created_at),
          seenAt: Math.max(d.seen_at || 0, x.refreshed_at || x.created_at || 0),
        };
      })
      .sort(function (a, b) {
        return (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.seenAt - a.seenAt) ||
          (a.id < b.id ? -1 : 1);
      });
    /* VARSELENHETENE — begge kanaltypene i ÉN liste, som serveren. `origin` er
       `null` på en native rad: appens vert er en KONTEKSTNØKKEL, ikke en
       adresse brukeren har vært på. `kind` er det klienten dispatcher på når
       raden slås av. */
    var push = db.push_subscriptions
      .filter(function (x) { return x.user_id === uid && !x.disabled_at && !x.revoked_at; })
      .map(function (x) {
        return {
          id: x.id, kind: 'web', current: !!endpoint && x.endpoint === endpoint,
          browser: x.browser || null, platform: x.platform || null,
          origin: x.origin || null,
          createdAt: x.created_at || 0, seenAt: x.seen_at || 0,
        };
      })
      .concat(nativeNotifActive(db, uid).map(function (x) {
        return {
          id: x.id, kind: 'native',
          current: nativeCtx(x, p && p.p_device_id, p && p.p_origin),
          browser: x.browser || null, platform: x.platform || null, origin: null,
          createdAt: x.created_at || 0, seenAt: x.seen_at || 0,
        };
      }))
      .sort(function (a, b) {
        return (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.seenAt - a.seenAt) ||
          (a.id < b.id ? -1 : 1);
      });
    return { sessions: sessions, push: push };
  }
  function revokeMySession(db, uid, id) {
    var finnes = db.auth_sessions.some(function (x) { return x.id === id && x.user_id === uid; });
    if (!finnes) return false;   // en fremmed id svarer det samme som en ukjent
    db.auth_sessions = db.auth_sessions.filter(function (x) { return x.id !== id; });
    db.device_sessions = db.device_sessions.filter(function (d) { return d.session_id !== id; });
    return true;
  }

  // Deduplisert, kategorisert medlemsliste. Presedens:
  //   1 områdeeier  2 eksplisitt mappeeier  3 områdemedlem  4 mappemedlem
  function getMembers(db, type, id, uid) {
    if (!canReadAny(db, type, id, uid)) throw new Error('ingen tilgang');
    var uni = resourceUniverse(db, type, id);
    var acc = [];
    db.memberships.forEach(function (m) {
      if (m.universe_id && m.universe_id === uni) {
        acc.push({ user_id: m.user_id, prec: m.role === 'owner' ? 1 : 3,
          category: m.role === 'owner' ? 'universeOwner' : 'universeMember',
          role: m.role, source: 'universe', direct: type === 'universe' });
      }
      if (type === 'group' && m.group_id === id) {
        acc.push({ user_id: m.user_id, prec: m.role === 'owner' ? 2 : 4,
          category: m.role === 'owner' ? 'groupOwner' : 'groupMember',
          role: m.role, source: 'group', direct: true });
      }
    });
    var best = {};
    acc.forEach(function (a) { if (!best[a.user_id] || a.prec < best[a.user_id].prec) best[a.user_id] = a; });
    var canManage = canManageMembers(db, type, id, uid);
    var ownerCount = type === 'universe' ? universeOwnerCount(db, id)
      : db.memberships.filter(function (m) { return m.group_id === id && m.role === 'owner'; }).length;
    var members = Object.keys(best).map(function (k) { return best[k]; }).map(function (b) {
      var pr = db.profiles.find(function (x) { return x.id === b.user_id; }) || {};
      var lastOwner = type === 'universe' && b.role === 'owner' && ownerCount <= 1;
      return {
        id: b.user_id, email: pr.email, display_name: pr.display_name,
        avatar: pr.avatar || null,
        category: b.category, role: b.role, source: b.source, direct: b.direct,
        removable: b.direct && canManage && !lastOwner,
        removeHint: !b.direct ? 'Har tilgang via området og må fjernes der'
          : (lastOwner ? 'Siste eier kan ikke fjernes' : null),
        // Språknøytral kode ved siden av teksten — klienten oversetter selv.
        removeHintCode: !b.direct ? 'inherited' : (lastOwner ? 'lastOwner' : null),
        demotable: b.direct && b.role === 'owner' && canManage && !lastOwner,
        // Rolleløft går via en invitasjon mottakeren må godta — flagget speiler
        // retten til å invitere til eierskap, ikke retten til å skrive rollen.
        promotable: b.direct && b.role === 'member' && canInviteOwner(db, type, id, uid) &&
          !db.share_invites.some(function (s) {
            return s.status === 'pending' && s.role === 'owner' &&
              String(s.invitee_email).toLowerCase() === String(pr.email || '').toLowerCase() &&
              ((type === 'universe' && s.universe_id === id) || (type === 'group' && s.group_id === id));
          }),
        prec: b.prec,
      };
    }).sort(function (a, b) {
      if (a.prec !== b.prec) return a.prec - b.prec;
      return String(a.display_name || a.email || '').toLowerCase()
        .localeCompare(String(b.display_name || b.email || '').toLowerCase());
    });
    var self = type === 'universe' ? findU(db, id) : findG(db, id);
    return {
      type: type,
      ownerCount: ownerCount,
      memberCount: type === 'universe' ? universeMemberCount(db, id) : groupMemberCount(db, id),
      viewer: {
        id: uid,
        role: type === 'universe' ? universeRole(db, id, uid) : groupRole(db, id, uid),
        caps: type === 'universe' ? universeCaps(db, id, uid) : groupCaps(db, id, uid),
      },
      invitePolicy: (self && self.invite_policy) || 'inherit',
      inviteEffective: effectiveInvitePolicy(db, type, id),
      members: members,
      pendingInvites: db.share_invites.filter(function (s) {
        return s.status === 'pending' &&
          ((type === 'universe' && s.universe_id === id) || (type === 'group' && s.group_id === id));
      }).map(function (s) {
        return { id: s.id, email: s.invitee_email, role: s.role || 'member', created_at: s.created_at,
          by: s.inviter_id, by_name: nameOf(db, s.inviter_id), mine: s.inviter_id === uid };
      }),
    };
  }

  /* ---------------- Tabell-CRUD (med server-side LWW + vakter) ---------------- */
  // Ett sted for «passer raden filtrene?», så .eq() og .in() oppfører seg likt
  // i update, delete og select.
  function matches(row, filters) {
    for (var k in filters) {
      var f = filters[k];
      if (f.op === 'in') { if (f.val.indexOf(row[k]) === -1) return false; }
      else if (row[k] !== f.val) return false;
    }
    return true;
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // `items.cat_id`/`groups.cat_id` er fremmednøkler til sin egen tabell. Ekte
  // Postgres avviser en rad som peker på en kategori som ikke finnes — og det
  // er nettopp den avvisningen som en gang låste synken i en usynlig
  // retry-løkke, så mocken må håndheve den for at testene skal være ekte.
  function catFkError(db, table, payload) {
    if (table !== 'items' && table !== 'groups' && table !== 'ideas') return null;
    var cat = payload && payload.cat_id;
    if (!cat) return null;
    var rows = db[table] || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id === cat) return null;
    return { code: '23503', message: 'insert or update on table "' + table +
      '" violates foreign key constraint "' + table + '_cat_id_fkey"' };
  }
  var TYPE_OF_TABLE = { universes: 'universe', groups: 'group', cards: 'card', items: 'item', ideas: 'idea',
    note_projects: 'note_project', note_folders: 'note_folder', notes: 'note' };
  // Speiler guard_object_insert: en gravlagt id kan ikke settes inn igjen.
  // Returneres som en feil (ikke et kast), med samme distinkte kode som
  // PostgREST gir for PT409, slik at klientens isTombstoneReject treffer.
  function tombstoneError(db, table, payload) {
    var type = TYPE_OF_TABLE[table];
    if (!type) return null;
    var rows = Array.isArray(payload) ? payload : [payload];
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < db.tombstones.length; j++) {
        if (db.tombstones[j].resource_type === type && db.tombstones[j].resource_id === rows[i].id) {
          return { code: 'PT409', message: 'gravlagt: ' + type + ' ' + rows[i].id + ' er permanent slettet' };
        }
      }
    }
    return null;
  }
  function applyInsert(db, table, uid, payload) {
    var rows = Array.isArray(payload) ? payload : [payload];
    // Objekt-tabellene har uuid-kolonner (som ekte Postgres): avvis ugyldige
    // id-er slik at klienten faktisk må generere UUID-er.
    var OBJ = { universes: 1, groups: 1, cards: 1, items: 1, ideas: 1,
      note_projects: 1, note_folders: 1, notes: 1 };
    if (OBJ[table]) {
      for (var i = 0; i < rows.length; i++) {
        if (!UUID_RE.test(String(rows[i].id || ''))) {
          throw new Error('invalid input syntax for type uuid: "' + rows[i].id + '"');
        }
        for (var k = 0; k < db[table].length; k++) {
          if (db[table][k].id === rows[i].id) {
            throw new Error('duplicate key value violates unique constraint "' + table + '_pkey"');
          }
        }
      }
    }
    // Roller opprettes KUN av SECURITY DEFINER-veiene (aksept av invitasjon +
    // opprettelses-triggerne) — klienten har ingen INSERT-rett på memberships.
    if (table === 'memberships') throw new Error('permission denied for table memberships');
    rows.forEach(function (r) {
      var row = clone(r);
      row.owner_id = uid;
      // Opprettelse av subobjekt krever opprettelsesrett i forelderen.
      if (table === 'groups' && findU(db, row.universe_id) && !canCreateChild(db, 'universe', row.universe_id, uid))
        throw new Error('mangler tilgang til området');
      if (table === 'cards' && findG(db, row.group_id) && !canCreateChild(db, 'group', row.group_id, uid))
        throw new Error('mangler tilgang til mappen');
      if (table === 'items' && findC(db, row.card_id) && !canCreateChild(db, 'card', row.card_id, uid))
        throw new Error('mangler tilgang til listen');
      /* Notatene: forelderen må være MIN. Speiler `with check`-vilkåret i
         note_folders_insert/notes_insert — uten det kunne en rad hektes inn i
         et prosjekt som tilhører noen andre. */
      if (table === 'note_folders' || table === 'notes') {
        var eier = (db.note_projects || []).find(function (p) { return p.id === row.project_id; });
        if (!eier || eier.owner_id !== uid) throw new Error('mangler tilgang til notatprosjektet');
      }
      if (table === 'notes' && row.folder_id) {
        var mappe = (db.note_folders || []).find(function (f) { return f.id === row.folder_id; });
        if (!mappe || mappe.owner_id !== uid) throw new Error('mangler tilgang til notatmappen');
        /* Bokhyllen UTLEDES av notatboken (notes_fix_parent i
           users-and-sharing.sql): de to forelder-pekerne kan ikke motsi
           hverandre, ellers ville en kaskade fra feil bokhylle tatt notatet. */
        row.project_id = mappe.project_id;
      }
      // Nye objekter arver invitasjonspolicy dynamisk → lagres som 'inherit'.
      if (table === 'universes' || table === 'groups') { if (!row.invite_policy) row.invite_policy = 'inherit'; }
      db[table].push(row);
      // Opprettelses-triggerne: områdeoppretteren blir områdeeier, mappe-
      // oppretteren eksplisitt mappeeier (med mindre rollen alt er arvet).
      if (table === 'universes') seedRole(db, uid, { universe_id: row.id }, row.pos);
      if (table === 'groups' && !isUniverseOwner(db, row.universe_id, uid))
        seedRole(db, uid, { group_id: row.id }, row.pos);
    });
  }
  function seedRole(db, uid, target, pos) {
    var dup = db.memberships.find(function (m) {
      return m.user_id === uid && m.universe_id === (target.universe_id || null) &&
             m.group_id === (target.group_id || null);
    });
    if (dup) return;
    db.memberships.push({
      id: newId('mem'), user_id: uid,
      universe_id: target.universe_id || null, group_id: target.group_id || null,
      role: 'owner', pos: pos || 0, created_at: Date.now(),
    });
  }

  function applyUpdate(db, table, uid, patch, filters) {
    var list = db[table];
    list.forEach(function (row) {
      if (!matches(row, filters)) return;
      if (table === 'profiles') {
        // Som RLS-policyen: kun egen rad, og kun display_name/avatar kan endres
        // (e-post går via auth.updateUser).
        if (row.id !== uid) return;
        if ('display_name' in patch) row.display_name = patch.display_name;
        if ('avatar' in patch) row.avatar = patch.avatar;
        return;
      }
      if (table === 'notifications') {
        // Som kolonne-granten + RLS: kun mine egne rader, og kun `read_at`.
        if (row.user_id !== uid) return;
        if ('read_at' in patch) row.read_at = patch.read_at;
        return;
      }
      if (table === 'memberships') {
        // Kun egen rad, og kun den PERSONLIGE posisjonen. Roller endres via RPC.
        if (row.user_id !== uid) return;
        if ('role' in patch && patch.role !== row.role) throw new Error('roller endres kun via set_member_role()');
        if ('pos' in patch) row.pos = patch.pos;
        return;
      }
      if (table === 'ideas') {
        // Idéer deles aldri: RLS er `owner_id = auth.uid()`, og da står bare
        // registrene igjen (ideas_before_update i users-and-sharing.sql).
        if (row.owner_id !== uid) return;
        if ('owner_id' in patch && patch.owner_id !== row.owner_id) throw new Error('owner_id (oppretter) kan ikke endres');
        if (regNewer(patch.ts, patch.org, row.ts, row.org)) {
          if ('text' in patch) row.text = patch.text;
          if ('is_cat' in patch) row.is_cat = patch.is_cat;
          if ('collapsed' in patch) row.collapsed = patch.collapsed;
          if ('trashed' in patch) row.trashed = patch.trashed;
          row.ts = patch.ts; row.org = patch.org;
        }
        if (regNewer(patch.pos_ts, patch.pos_org, row.pos_ts, row.pos_org)) {
          if ('pos' in patch) row.pos = patch.pos;
          if ('cat_id' in patch) row.cat_id = patch.cat_id;
          row.pos_ts = patch.pos_ts; row.pos_org = patch.pos_org;
        }
        return;
      }
      /* Notatene: samme felt-LWW som idéene, og av samme grunn uten
         capability-oppslag — RLS har alt avgjort at raden er min
         (*_before_update i users-and-sharing.sql). Forelder-pekerne rir på
         posisjonsregisteret. */
      if (table === 'note_projects' || table === 'note_folders' || table === 'notes') {
        if (row.owner_id !== uid) return;
        if ('owner_id' in patch && patch.owner_id !== row.owner_id) throw new Error('owner_id (oppretter) kan ikke endres');
        if (regNewer(patch.ts, patch.org, row.ts, row.org)) {
          ['name', 'title', 'body', 'collapsed', 'trashed'].forEach(function (k) {
            if (k in patch) row[k] = patch[k];
          });
          row.ts = patch.ts; row.org = patch.org;
        }
        if (regNewer(patch.pos_ts, patch.pos_org, row.pos_ts, row.pos_org)) {
          ['pos', 'project_id', 'folder_id'].forEach(function (k) {
            if (k in patch) row[k] = patch[k];
          });
          row.pos_ts = patch.pos_ts; row.pos_org = patch.pos_org;
        }
        /* SIST, på den ferdige raden — som notes_before_update: et notat i en
           notatbok ligger i notatbokens bokhylle, uansett hva klienten skrev. */
        if (table === 'notes' && row.folder_id) {
          var bok = (db.note_folders || []).find(function (f) { return f.id === row.folder_id; });
          if (bok) row.project_id = bok.project_id;
        }
        /* … og flyttes en NOTATBOK, følger notatene med (note_folders_cascade). */
        if (table === 'note_folders') {
          (db.notes || []).forEach(function (n) {
            if (n.folder_id !== row.id || n.project_id === row.project_id) return;
            n.project_id = row.project_id;
            n.pos_ts = Math.max(n.pos_ts || 0, row.pos_ts || 0);
            n.pos_org = row.pos_org;
          });
        }
        return;
      }
      var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group'
               : table === 'cards' ? 'card' : 'item';
      var canContent = canEditContent(db, type, row.id, uid);
      var canReorder = canReorderInParent(db, type, row.id, uid);
      // Oppretter (owner_id) er uforanderlig og gir ingen rettigheter.
      if ('owner_id' in patch && patch.owner_id !== row.owner_id) throw new Error('owner_id (oppretter) kan ikke endres');
      // Priviligerte kolonner — endres kun av rett autoritet.
      if ('locked' in patch && patch.locked !== row.locked && !canManageLock(db, type, row.id, uid)) throw new Error('mangler myndighet til å låse/åpne');
      if ('unlocked' in patch && patch.unlocked !== row.unlocked && !canManageLockException(db, type, row.id, uid)) throw new Error('mangler myndighet til å endre unntak');
      if ('invite_policy' in patch && patch.invite_policy !== row.invite_policy && !canManageInvitePolicy(db, type, row.id, uid)) throw new Error('mangler myndighet til å endre invitasjonspolicy');
      // Sletting til felles søppel krever destruktiv myndighet.
      if ('trashed' in patch && patch.trashed !== row.trashed && !canDeleteObject(db, type, row.id, uid))
        throw new Error('mangler myndighet til å slette objektet');
      // Mappen bytter område KUN via move_group().
      if (type === 'group' && 'universe_id' in patch && patch.universe_id !== row.universe_id)
        throw new Error('mapper flyttes mellom områder med move_group()');
      // Flytting av liste/listepunkt til ny forelder: rettigheter i BÅDE kilde og mål.
      var pcol = type === 'card' ? 'group_id' : type === 'item' ? 'card_id' : null;
      var ptype = type === 'card' ? 'group' : type === 'item' ? 'card' : null;
      if (pcol && pcol in patch && patch[pcol] !== row[pcol]) {
        if (!canEditContent(db, ptype, row[pcol], uid)) throw new Error('mangler tilgang til kilde-' + ptype);
        if (!canCreateChild(db, ptype, patch[pcol], uid)) throw new Error('mangler tilgang til mål-' + ptype);
      }
      // content-register: kun ved can_edit_content OG nyere register.
      if (canContent && regNewer(patch.ts, patch.org, row.ts, row.org)) {
        if ('name' in patch) row.name = patch.name;
        if ('title' in patch) row.title = patch.title;
        if ('text' in patch) row.text = patch.text;
        if ('done' in patch) row.done = patch.done;
        if ('responsible' in patch) row.responsible = patch.responsible;
        if ('start_at' in patch) row.start_at = patch.start_at;
        if ('due_at' in patch) row.due_at = patch.due_at;
        if ('lock_times' in patch) row.lock_times = patch.lock_times;
        if ('collapsed' in patch) row.collapsed = patch.collapsed;
        if ('is_cat' in patch) row.is_cat = patch.is_cat;
        if ('trashed' in patch) row.trashed = patch.trashed;
        row.ts = patch.ts; row.org = patch.org;
      }
      // label-register (cards): også innhold → can_edit_content.
      if (table === 'cards' && canContent && regNewer(patch.lab_ts, patch.lab_org, row.lab_ts, row.lab_org)) {
        if ('k' in patch) row.k = patch.k;
        if ('p' in patch) row.p = patch.p;
        row.lab_ts = patch.lab_ts; row.lab_org = patch.lab_org;
      }
      // pos-register (+ forelder følger posisjon): kun ved can_reorder OG nyere.
      if (canReorder && regNewer(patch.pos_ts, patch.pos_org, row.pos_ts, row.pos_org)) {
        if ('pos' in patch) row.pos = patch.pos;
        if ('group_id' in patch) row.group_id = patch.group_id;
        if ('card_id' in patch) row.card_id = patch.card_id;
        if ('cat_id' in patch) row.cat_id = patch.cat_id;
        row.pos_ts = patch.pos_ts; row.pos_org = patch.pos_org;
      }
    });
  }
  // Gravstein (write_tombstone-triggeren). Idempotent, som `on conflict do update`.
  function writeTombstone(db, type, id) {
    for (var i = 0; i < db.tombstones.length; i++) {
      if (db.tombstones[i].resource_type === type && db.tombstones[i].resource_id === id) {
        db.tombstones[i].ts = Date.now();
        return;
      }
    }
    db.tombstones.push({ resource_type: type, resource_id: id, ts: Date.now() });
  }
  function applyDelete(db, table, uid, filters) {
    // «Tøm varsler»: en ren sletting av MINE egne rader — ingen gravstein, og
    // ingen annen brukers historikk kan røres (RLS i produksjon).
    if (table === 'notifications') {
      var borte = {};
      db.notifications = db.notifications.filter(function (row) {
        if (row.user_id === uid && matches(row, filters)) { borte[row.id] = 1; return false; }
        return true;
      });
      // Som fremmednøkkelens kaskade: en avlyst plan tar leveringen med seg.
      db.push_deliveries = db.push_deliveries.filter(function (d) { return !borte[d.notification_id]; });
      return;
    }
    // «Slå av i denne nettleseren» — kun mine egne rader (RLS i produksjon).
    if (table === 'push_subscriptions') {
      var vekk = {};
      db.push_subscriptions = db.push_subscriptions.filter(function (row) {
        if (row.user_id === uid && matches(row, filters)) { vekk[row.id] = 1; return false; }
        return true;
      });
      db.push_deliveries = db.push_deliveries.filter(function (d) { return !vekk[d.subscription_id]; });
      return;
    }
    // Idéer: mine egne, uten capability-oppslag. `cat_id`-en er `on delete set
    // null` mot sin egen tabell — en oppløst kategori løsner medlemmene sine.
    if (table === 'ideas') {
      db.ideas = db.ideas.filter(function (row) {
        if (!matches(row, filters)) return true;
        if (row.owner_id !== uid) return true;
        writeTombstone(db, 'idea', row.id);
        db.ideas.forEach(function (d) { if (d.cat_id === row.id) d.cat_id = null; });
        return false;
      });
      return;
    }
    /* Notatene: mine egne, uten capability-oppslag. `note_folders.project_id`
       og `notes.project_id` er `on delete cascade` (et notat uten prosjekt
       finnes ikke), mens `notes.folder_id` er `on delete set null` — en
       slettet mappe etterlater FRIE notater, den sletter dem ikke. */
    if (table === 'note_projects' || table === 'note_folders' || table === 'notes') {
      var kaskade = [];
      db[table] = db[table].filter(function (row) {
        if (!matches(row, filters)) return true;
        if (row.owner_id !== uid) return true;
        writeTombstone(db, TYPE_OF_TABLE[table], row.id);
        kaskade.push(row.id);
        return false;
      });
      kaskade.forEach(function (id) {
        if (table === 'note_projects') {
          db.note_folders = db.note_folders.filter(function (f) {
            if (f.project_id !== id) return true;
            writeTombstone(db, 'note_folder', f.id);
            return false;
          });
          db.notes = db.notes.filter(function (n) {
            if (n.project_id !== id) return true;
            writeTombstone(db, 'note', n.id);
            return false;
          });
        } else if (table === 'note_folders') {
          db.notes.forEach(function (n) { if (n.folder_id === id) n.folder_id = null; });
        }
      });
      return;
    }
    var type = table === 'universes' ? 'universe' : table === 'groups' ? 'group' : table === 'cards' ? 'card' : 'item';
    if (table === 'memberships') {
      db.memberships = db.memberships.filter(function (row) {
        if (!matches(row, filters)) return true;
        var mayManage = row.universe_id ? canManageMembers(db, 'universe', row.universe_id, uid)
                      : canManageMembers(db, 'group', row.group_id, uid);
        if (row.user_id !== uid && !mayManage) return true;
        // Siste-eier-invarianten gjelder også en rå sletting.
        if (row.universe_id && row.role === 'owner' && universeOwnerCount(db, row.universe_id) <= 1)
          throw new Error('området må ha minst én eier');
        return false;
      });
      return;
    }
    db[table] = db[table].filter(function (row) {
      if (!matches(row, filters)) return true;
      if (!canDeleteObject(db, type, row.id, uid)) return true; // behold (blokkert)
      writeTombstone(db, type, row.id);
      cascadeDelete(db, type, row.id);
      return false;
    });
  }
  // `on delete cascade` i ekte Postgres sletter barna RAD FOR RAD, så deres egen
  // AFTER DELETE-trigger fyrer og skriver gravstein for hvert enkelt barn.
  function cascadeDelete(db, type, id) {
    if (type === 'universe') {
      db.groups.filter(function (g) { return g.universe_id === id; }).forEach(function (g) { cascadeDelete(db, 'group', g.id); });
      db.groups = db.groups.filter(function (g) {
        if (g.universe_id !== id) return true;
        writeTombstone(db, 'group', g.id); return false;
      });
    } else if (type === 'group') {
      db.cards.filter(function (c) { return c.group_id === id; }).forEach(function (c) { cascadeDelete(db, 'card', c.id); });
      db.cards = db.cards.filter(function (c) {
        if (c.group_id !== id) return true;
        writeTombstone(db, 'card', c.id); return false;
      });
    } else if (type === 'card') {
      db.items = db.items.filter(function (i) {
        if (i.card_id !== id) return true;
        writeTombstone(db, 'item', i.id); return false;
      });
    }
    db.memberships = db.memberships.filter(function (m) {
      return !((type === 'universe' && m.universe_id === id) || (type === 'group' && m.group_id === id));
    });
    db.share_invites = db.share_invites.filter(function (s) {
      return !((type === 'universe' && s.universe_id === id) || (type === 'group' && s.group_id === id));
    });
  }

  /* ---------------- RPC-er ---------------- */
  function nextPersonalPos(db, uid) {
    return db.memberships.filter(function (m) { return m.user_id === uid; })
      .reduce(function (a, m) { return Math.max(a, m.pos || 0); }, 0) + 1;
  }

  function rpcHandlers(db, uid) {
    return {
      get_my_doc: function () { return getMyDoc(db, uid); },
      notify_record: function (p) { return notifRecord(db, uid, p.p_rows || [], p.p_cursor || 0); },
      push_subscribe: function (p) { return pushSubscribe(db, uid, p); },
      push_unsubscribe: function (p) { return pushUnsubscribe(db, uid, p.p_endpoint); },
      push_revoke: function (p) { return pushRevoke(db, uid, p.p_id); },
      push_revoke_others: function (p) { return pushRevokeOthers(db, uid, p.p_endpoint); },
      native_notif_touch: function (p) { return nativeNotifTouch(db, uid, p); },
      native_notif_revoke: function (p) { return nativeNotifRevoke(db, uid, p.p_id); },
      notif_revoke_others: function (p) { return notifRevokeOthers(db, uid, p); },
      session_touch: function (p) { return sessionTouch(db, uid, p); },
      list_my_devices: function (p) { return listMyDevices(db, uid, p); },
      revoke_my_session: function (p) { return revokeMySession(db, uid, p.p_session_id); },
      /* Tidssonen planen tilhører. Som serveren: hevdelsen går bare gjennom når
         sonen er tom, er vår egen, eller den forrige er gammel nok — det er den
         som hindrer to enheter i ulike soner fra å planlegge om hverandre. */
      notify_claim_tz: function (p) {
        var row = notifPrefsRow(db, uid);
        var tz = p.p_tz;
        if (!tz || tz.length > 64) throw new Error('ugyldig tidssone');
        var now = Date.now();
        if (row.tz == null || row.tz === tz || now - (row.tz_at || 0) >= (p.p_min_age_ms || 0)) {
          row.tz = tz;
          row.tz_at = now;
        }
        return row.tz;
      },
      notify_set_prefs: function (p) {
        var row = notifPrefsRow(db, uid);
        var want = p.p_prefs || {};
        if ('dueOver' in want) row.due_over = !!want.dueOver;
        if ('dueSoon' in want) row.due_soon = !!want.dueSoon;
        if ('startNow' in want) row.start_now = !!want.startNow;
        if ('startSoon' in want) row.start_soon = !!want.startSoon;
        // Som serveren: et bytte flytter markøren til nå, så en terskel som
        // passerte mens typen var av ikke velter inn når den slås på igjen.
        row.cursor_at = Math.max(row.cursor_at || 0, Date.now());
        row.updated_at = Date.now();
        return null;
      },
      import_doc: function (p) {
        var doc = p.p_doc || {};
        var imported = {};
        ['universes', 'groups', 'cards', 'items'].forEach(function (k) {
          (doc[k] || []).forEach(function (r) { imported[legacyId(uid, r.id)] = 1; });
        });
        db.tombstones = db.tombstones.filter(function (t) { return !imported[t.resource_id]; });
        function up(list, table, mapRow) {
          (list || []).forEach(function (r) {
            var id = legacyId(uid, r.id);
            var existing = db[table].find(function (x) { return x.id === id && x.owner_id === uid; });
            var row = mapRow(r, id);
            if (existing) Object.assign(existing, row);
            else {
              db[table].push(row);
              if (table === 'universes') seedRole(db, uid, { universe_id: id }, row.pos);
              if (table === 'groups' && !isUniverseOwner(db, row.universe_id, uid))
                seedRole(db, uid, { group_id: id }, row.pos);
            }
          });
        }
        up(doc.universes, 'universes', function (r, id) {
          return { id: id, owner_id: uid, name: r.name || '', trashed: !!r.trashed, locked: false, invite_policy: 'inherit',
            collapsed: !!r.collapsed,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.groups, 'groups', function (r, id) {
          return { id: id, owner_id: uid, universe_id: legacyId(uid, r.uni), name: r.name || '', trashed: !!r.trashed,
            cat_id: r.cat ? legacyId(uid, r.cat) : null, is_cat: !!r.isCat, collapsed: !!r.collapsed,
            locked: false, invite_policy: 'inherit', ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.cards, 'cards', function (r, id) {
          return { id: id, owner_id: uid, group_id: legacyId(uid, r.group), title: r.title || '', trashed: !!r.trashed,
            locked: false, k: r.k !== false, p: r.p !== false, lab_ts: r.labTs || 0, lab_org: r.labOrg || '',
            responsible: r.responsible || null,
            start_at: r.start || null, due_at: r.due || null, lock_times: !!r.lockTimes,
            collapsed: !!r.collapsed,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        up(doc.items, 'items', function (r, id) {
          return { id: id, owner_id: uid, card_id: legacyId(uid, r.home),
            cat_id: r.cat ? legacyId(uid, r.cat) : null, is_cat: !!r.isCat, lock_times: !!r.lockTimes,
            collapsed: !!r.collapsed,
            text: r.text || '', trashed: !!r.trashed,
            done: !!r.done, responsible: r.responsible || null,
            start_at: r.start || null, due_at: r.due || null,
            ts: r.ts || 0, org: r.org || '', pos: r.pos || 0, pos_ts: r.posTs || 0, pos_org: r.posOrg || '' };
        });
        return { universes: (doc.universes || []).length, groups: (doc.groups || []).length,
                 cards: (doc.cards || []).length, items: (doc.items || []).length };
      },
      create_share_invite: function (p) {
        var role = p.p_role || 'member';
        if (['universe', 'group'].indexOf(p.p_type) < 0)
          throw new Error('kun områder og mapper kan deles (fikk: ' + p.p_type + ')');
        if (['member', 'owner'].indexOf(role) < 0) throw new Error('ugyldig rolle: ' + role);
        var em = String(p.p_email).toLowerCase().trim();
        if (em === '' || em.indexOf('@') < 0) throw new Error('ugyldig e-postadresse');
        if (role === 'owner') {
          if (!canInviteOwner(db, p.p_type, p.p_id, uid)) throw new Error('bare eiere kan invitere til eierskap');
        } else if (!canInviteTo(db, p.p_type, p.p_id, uid)) {
          throw new Error('mangler myndighet til å invitere til dette objektet');
        }
        if (em === emailOf(db, uid)) throw new Error('kan ikke dele med deg selv');
        var target = (db.profiles.find(function (x) { return x.email === em; }) || {}).id || null;
        if (target) {
          if (role === 'member' && canReadAny(db, p.p_type, p.p_id, target))
            throw new Error('brukeren har allerede tilgang');
          if (role === 'owner' &&
              ((p.p_type === 'universe' && isUniverseOwner(db, p.p_id, target)) ||
               (p.p_type === 'group' && isGroupOwner(db, p.p_id, target))))
            throw new Error('brukeren er allerede eier');
        }
        var col = p.p_type === 'universe' ? 'universe_id' : 'group_id';
        // Som serveren: en ventende invitasjon oppdateres i stedet for å feile,
        // og rollen kan bare gå OPP (member → owner).
        var dup = db.share_invites.find(function (s) {
          return s.status === 'pending' && String(s.invitee_email).toLowerCase() === em && s[col] === p.p_id;
        });
        if (dup) {
          // Avsenderen overtas bare når kalleren selv er autorisert for rollen
          // invitasjonen ender opp med — `inviter_id` gir rett til å trekke den
          // tilbake, og den retten skal ikke kunne kapres med en
          // medlemsinvitasjon til en ventende eierinvitasjon.
          if (role === 'owner' || dup.role !== 'owner') dup.inviter_id = uid;
          if (role === 'owner') dup.role = 'owner';
          if (target) dup.invitee_id = target;
          return dup;
        }
        var inv = { id: newId('inv'), inviter_id: uid, invitee_email: em, invitee_id: target,
          universe_id: p.p_type === 'universe' ? p.p_id : null,
          group_id: p.p_type === 'group' ? p.p_id : null,
          role: role, status: 'pending', created_at: Date.now() };
        db.share_invites.push(inv);
        return inv;
      },
      accept_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite; });
        if (!inv || inv.status !== 'pending') throw new Error('invitasjonen er ikke lenger åpen');
        var em = emailOf(db, uid);
        if (inv.invitee_id && inv.invitee_id !== uid) throw new Error('invitasjonen er ikke til deg');
        if (!inv.invitee_id && String(inv.invitee_email).toLowerCase() !== String(em).toLowerCase())
          throw new Error('invitasjonen er ikke til deg');
        var role = inv.role || 'member';
        var col = inv.universe_id ? 'universe_id' : 'group_id';
        var targetId = inv.universe_id || inv.group_id;
        var existing = db.memberships.find(function (m) { return m.user_id === uid && m[col] === targetId; });
        var mem;
        if (existing) {
          if (role === 'owner') existing.role = 'owner';
          mem = existing;
        } else {
          mem = { id: newId('mem'), user_id: uid, universe_id: inv.universe_id || null,
            group_id: inv.group_id || null, role: role,
            pos: p.p_pos != null ? p.p_pos : nextPersonalPos(db, uid), created_at: Date.now() };
          db.memberships.push(mem);
        }
        if (inv.universe_id) {
          // Områdemedlemskapet gjør ordinære DIREKTE mappemedlemskap i
          // området redundante; eksplisitte mappeeierroller beholdes.
          var gids = db.groups.filter(function (g) { return g.universe_id === inv.universe_id; })
            .map(function (g) { return g.id; });
          db.memberships = db.memberships.filter(function (m) {
            return !(m.user_id === uid && m.role === 'member' && gids.indexOf(m.group_id) > -1);
          });
        }
        inv.status = 'accepted'; inv.invitee_id = uid;
        return mem;
      },
      decline_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite; });
        if (inv) { inv.status = 'declined'; inv.invitee_id = uid; }
        return null;
      },
      revoke_share_invite: function (p) {
        var inv = db.share_invites.find(function (s) { return s.id === p.p_invite && s.status === 'pending'; });
        if (!inv) throw new Error('fant ingen ventende invitasjon');
        var it = inv.universe_id ? 'universe' : 'group';
        var iid = inv.universe_id || inv.group_id;
        if (inv.inviter_id !== uid && !canManageMembers(db, it, iid, uid))
          throw new Error('mangler myndighet til å trekke tilbake denne invitasjonen');
        inv.status = 'revoked';
        return null;
      },
      revoke_share: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (!canManageMembers(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å fjerne medlemmer');
        if (p.p_type === 'universe') {
          if (universeRole(db, p.p_id, p.p_user) === null) throw new Error('brukeren er ikke medlem av området');
          if (universeRole(db, p.p_id, p.p_user) === 'owner' && universeOwnerCount(db, p.p_id) <= 1)
            throw new Error('området må ha minst én eier');
          purgeUniverseAccess(db, p.p_id, p.p_user);
        } else {
          if (groupRole(db, p.p_id, p.p_user) === null) {
            if (isGroupMember(db, p.p_id, p.p_user))
              throw new Error('brukeren har tilgang via området og må fjernes der');
            throw new Error('brukeren er ikke medlem av mappen');
          }
          purgeGroupAccess(db, p.p_id, p.p_user);
        }
        return null;
      },
      set_member_role: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (['member', 'owner'].indexOf(p.p_role) < 0) throw new Error('ugyldig rolle: ' + p.p_role);
        if (!canManageMembers(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre roller');
        var cur = p.p_type === 'universe' ? universeRole(db, p.p_id, p.p_user) : groupRole(db, p.p_id, p.p_user);
        if (cur === null) throw new Error('brukeren har ingen rolle her');
        if (p.p_role === 'owner' && cur !== 'owner')
          throw new Error('eierskap gis via en eierskapsinvitasjon mottakeren må godta');
        if (cur === p.p_role) return null;
        if (p.p_type === 'universe') {
          if (universeOwnerCount(db, p.p_id) <= 1) throw new Error('området må ha minst én eier');
          uniMembership(db, p.p_user, p.p_id).role = p.p_role;
        } else if (isUniverseMember(db, groupUniverse(db, p.p_id), p.p_user)) {
          db.memberships = db.memberships.filter(function (m) {
            return !(m.user_id === p.p_user && m.group_id === p.p_id);
          });
        } else {
          grpMembership(db, p.p_user, p.p_id).role = p.p_role;
        }
        return null;
      },
      leave_share: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (p.p_type === 'universe') {
          if (universeRole(db, p.p_id, uid) === null) throw new Error('du er ikke medlem av dette området');
          if (!canLeave(db, 'universe', p.p_id, uid))
            throw new Error('du er siste eier — gi eierskap til noen andre først');
          purgeUniverseAccess(db, p.p_id, uid);
        } else {
          if (!canLeave(db, 'group', p.p_id, uid)) {
            if (isGroupMember(db, p.p_id, uid))
              throw new Error('du har tilgang via området — forlat området i stedet');
            throw new Error('du er ikke medlem av denne mappen');
          }
          purgeGroupAccess(db, p.p_id, uid);
        }
        return null;
      },
      set_locked: function (p) {
        if (['universe', 'group', 'card'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (!canManageLock(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å låse/åpne');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) { r.locked = p.p_locked; if (p.p_locked) r.unlocked = false; }
        return null;
      },
      set_unlocked: function (p) {
        if (['universe', 'group', 'card'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (!canManageLockException(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre unntak');
        var t = p.p_type === 'universe' ? db.universes : p.p_type === 'group' ? db.groups : db.cards;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) { r.unlocked = p.p_unlocked; if (p.p_unlocked) r.locked = false; }
        return null;
      },
      set_invite_policy: function (p) {
        if (['universe', 'group'].indexOf(p.p_type) < 0) throw new Error('ugyldig type: ' + p.p_type);
        if (['inherit', 'allow', 'deny'].indexOf(p.p_policy) < 0) throw new Error('ugyldig policy');
        if (!canManageInvitePolicy(db, p.p_type, p.p_id, uid)) throw new Error('mangler myndighet til å endre invitasjonspolicy');
        var t = p.p_type === 'universe' ? db.universes : db.groups;
        var r = t.find(function (x) { return x.id === p.p_id; });
        if (r) r.invite_policy = p.p_policy;
        return null;
      },
      get_members: function (p) { return getMembers(db, p.p_type, p.p_id, uid); },
      // Sletter kontoen og alle spor av den — speiler public.delete_account()
      // steg for steg (rekkefølgen betyr noe: invitasjonene ryddes FØR
      // områdene, som ellers ville tatt dem med i kaskaden).
      delete_account: function () {
        var me = db.profiles.find(function (x) { return x.id === uid; });
        if (!me) throw new Error('fant ingen profil for kontoen');
        var em = String(me.email).toLowerCase();
        var now = Date.now();
        var heir = function (uni) { return survivingOwner(db, uni, uid); };

        // 1. invitasjoner begge veier (også de som bare er adressert til e-posten)
        db.share_invites = db.share_invites.filter(function (s) {
          return !(s.inviter_id === uid || s.invitee_id === uid ||
                   String(s.invitee_email).toLowerCase() === em);
        });
        // 2. områder jeg er knyttet til som står uten eier etter meg
        db.universes.filter(function (u) {
          return heir(u.id) === null && (u.owner_id === uid || isUniverseMember(db, u.id, uid));
        }).map(function (u) { return u.id; }).forEach(function (id) {
          writeTombstone(db, 'universe', id);
          cascadeDelete(db, 'universe', id);
          db.universes = db.universes.filter(function (x) { return x.id !== id; });
        });
        // 3. oppretter-arv på alt som overlever
        db.universes.forEach(function (u) { if (u.owner_id === uid) u.owner_id = heir(u.id); });
        db.groups.forEach(function (g) { if (g.owner_id === uid) g.owner_id = heir(g.universe_id); });
        db.cards.forEach(function (c) {
          if (c.owner_id === uid) c.owner_id = heir(groupUniverse(db, c.group_id));
        });
        db.items.forEach(function (i) {
          if (i.owner_id !== uid) return;
          var c = findC(db, i.card_id);
          i.owner_id = heir(c ? groupUniverse(db, c.group_id) : null);
        });
        // 4. ansvarstildelinger + rollene mine. Stempelet slår radens EGET
        //    register, ikke bare klokka (som i SQL-en: en rad fra en enhet med
        //    klokka foran serverens ville ellers vunnet LWW-en tilbake).
        var stamp = function (r) { r.ts = Math.max(now, (r.ts || 0) + 1); r.org = 'server'; };
        db.cards.forEach(function (c) {
          if (c.responsible === uid) { c.responsible = null; stamp(c); }
        });
        db.items.forEach(function (i) {
          if (i.responsible === uid) { i.responsible = null; stamp(i); }
        });
        db.memberships = db.memberships.filter(function (m) { return m.user_id !== uid; });
        // 4a. idéene er MINE ALENE — de deles aldri, så de skal bort, ikke arves.
        db.ideas = db.ideas.filter(function (d) {
          if (d.owner_id !== uid) return true;
          writeTombstone(db, 'idea', d.id);
          return false;
        });
        // 4a2. notatene — mine alene, som idéene (docs/notater-plan.md).
        [['notes', 'note'], ['note_folders', 'note_folder'], ['note_projects', 'note_project']]
          .forEach(function (par) {
            db[par[0]] = (db[par[0]] || []).filter(function (r) {
              if (r.owner_id !== uid) return true;
              writeTombstone(db, par[1], r.id);
              return false;
            });
          });
        // 4b. varselhistorikken, preferansene, push-abonnementene og utboksen —
        //     alt sammen mitt alene (som kaskaden i delete_account()).
        db.notifications = db.notifications.filter(function (n) { return n.user_id !== uid; });
        db.notification_prefs = db.notification_prefs.filter(function (n) { return n.user_id !== uid; });
        db.push_deliveries = db.push_deliveries.filter(function (d) { return d.user_id !== uid; });
        db.push_subscriptions = db.push_subscriptions.filter(function (x) { return x.user_id !== uid; });
        // … og statusen til de native varselkanalene: en rad som ble stående
        // ville vært en «enhet med varsler» for en konto som ikke finnes.
        db.native_notif_devices = db.native_notif_devices.filter(function (x) { return x.user_id !== uid; });
        // 4c. øktene og den gjenkjennelige metadataen om dem.
        db.auth_sessions = db.auth_sessions.filter(function (x) { return x.user_id !== uid; });
        db.device_sessions = db.device_sessions.filter(function (x) { return x.user_id !== uid; });
        // 5. profilen og selve kontoen (mocken har ingen auth.users-tabell —
        //    profilen + passordet ER kontoen her)
        db.profiles = db.profiles.filter(function (x) { return x.id !== uid; });
        delete db.passwords[em];
        return null;
      },
      // Den ENESTE veien en mappe bytter område. Samme domene → reparenting;
      // ulikt domene → kopier-og-slett med nye id-er + gravsteiner.
      move_group: function (p) {
        var g = findG(db, p.p_group);
        if (!g) throw new Error('mappen finnes ikke');
        if (g.is_cat) throw new Error('en mappekategori kan ikke flyttes til et annet område');
        if (!findU(db, p.p_universe)) throw new Error('målområdet finnes ikke');
        var cat = p.p_cat || null;
        if (cat) {
          var cg = findG(db, cat);
          if (!cg || !cg.is_cat || cg.universe_id !== p.p_universe)
            throw new Error('ugyldig mappekategori for målområdet');
        }
        var now = Date.now();
        var mapping = {};
        if (g.universe_id === p.p_universe) {
          if (!canReorderInParent(db, 'group', p.p_group, uid))
            throw new Error('mangler myndighet til å endre rekkefølgen i området');
          g.cat_id = cat; g.pos = p.p_pos || 0; g.pos_ts = now; g.pos_org = 'server';
          return { mode: 'reorder', group: p.p_group, mapping: mapping };
        }
        if (!canMoveGroup(db, p.p_group, uid))
          throw new Error('mangler myndighet til å flytte mappen ut av området');
        if (!canCreateChild(db, 'universe', p.p_universe, uid))
          throw new Error('mangler myndighet til å opprette mapper i målområdet');

        if (universeOwnerSet(db, g.universe_id) === universeOwnerSet(db, p.p_universe)) {
          g.universe_id = p.p_universe; g.cat_id = cat;
          g.pos = p.p_pos || 0; g.pos_ts = now; g.pos_org = 'server';
          db.cards.filter(function (c) { return c.group_id === g.id; }).forEach(function (c) {
            if (c.responsible && !isGroupMember(db, g.id, c.responsible)) { c.responsible = null; c.ts = now; c.org = 'server'; }
            db.items.filter(function (i) { return i.card_id === c.id; }).forEach(function (i) {
              if (i.responsible && !isGroupMember(db, g.id, i.responsible)) { i.responsible = null; i.ts = now; i.org = 'server'; }
            });
          });
          return { mode: 'reparent', group: p.p_group, mapping: mapping };
        }

        // Kryssdomene: nytt undertre med nye id-er, aktøren som oppretter/eier,
        // og det gamle treet permanent slettet (gravsteiner) i samme operasjon.
        var newG = newUuid();
        mapping[g.id] = newG;
        db.groups.push({
          id: newG, owner_id: uid, universe_id: p.p_universe, cat_id: cat, is_cat: false,
          name: g.name, trashed: !!g.trashed, locked: !!g.locked, unlocked: !!g.unlocked,
          collapsed: !!g.collapsed, invite_policy: g.invite_policy || 'inherit',
          ts: now, org: 'server', pos: p.p_pos || 0, pos_ts: now, pos_org: 'server',
        });
        if (!isUniverseOwner(db, p.p_universe, uid)) seedRole(db, uid, { group_id: newG }, p.p_pos || 0);
        var srcCards = db.cards.filter(function (c) { return c.group_id === g.id; });
        srcCards.forEach(function (c) {
          var nc = newUuid();
          mapping[c.id] = nc;
          db.cards.push(Object.assign({}, c, {
            id: nc, owner_id: uid, group_id: newG, ts: now, org: 'server',
            lab_ts: now, lab_org: 'server', pos_ts: now, pos_org: 'server',
            responsible: c.responsible && isGroupMember(db, newG, c.responsible) ? c.responsible : null,
          }));
        });
        var srcItems = db.items.filter(function (i) { return mapping[i.card_id]; })
          .slice().sort(function (a, b) { return (b.is_cat ? 1 : 0) - (a.is_cat ? 1 : 0); });
        srcItems.forEach(function (i) {
          var ni = newUuid();
          mapping[i.id] = ni;
          db.items.push(Object.assign({}, i, {
            id: ni, owner_id: uid, card_id: mapping[i.card_id],
            cat_id: i.cat_id ? mapping[i.cat_id] : null,
            ts: now, org: 'server', pos_ts: now, pos_org: 'server',
            responsible: i.responsible && isGroupMember(db, newG, i.responsible) ? i.responsible : null,
          }));
        });
        writeTombstone(db, 'group', g.id);
        cascadeDelete(db, 'group', g.id);
        db.groups = db.groups.filter(function (x) { return x.id !== g.id; });
        return { mode: 'copy', group: newG, mapping: mapping };
      },
    };
  }

  /* ---------------- Klient-fabrikk ---------------- */
  function createClient() {
    var authListeners = [];
    function emitAuth(event, session) { authListeners.forEach(function (cb) { try { cb(event, session); } catch (e) {} }); }
    function sessionObj() { var u = getSess(); return u ? { user: u } : null; }

    var channels = [];
    function fireChannels() { channels.forEach(function (ch) { ch._handlers.forEach(function (h) { try { h(); } catch (e) {} }); }); }
    /* Som i supabase-js: å fjerne en kanal går via `unsubscribe()`, og den
       melder `CLOSED` tilbake. Klienten svarer på det med å subscribe på nytt
       (`startCloudRealtime`), så en mock som bare tømmer lista ville skjult at
       realtime kommer TILBAKE etter at noen har tatt den bort. */
    function closed(list) {
      list.forEach(function (ch) {
        if (ch._statusCb) setTimeout(function () { ch._statusCb('CLOSED'); }, 0);
      });
    }
    window.addEventListener('storage', function (ev) {
      if (ev.key === PING_KEY) fireChannels();
    });

    function thenable(fn) {
      // Awaitbar builder som utfører fn() ved await (etter ev. ?lag=-forsinkelse);
      // .eq()/.in() kjeder filtre (.in = «kolonnen er én av disse verdiene»,
      // brukt av gravsteins-oppslaget i synken).
      var filters = {};
      var builder = {
        eq: function (col, val) { filters[col] = { op: 'eq', val: val }; return builder; },
        in: function (col, vals) { filters[col] = { op: 'in', val: vals || [] }; return builder; },
        then: function (resolve, reject) {
          return serverCall(function () { return fn(filters); }).then(resolve, reject);
        },
      };
      return builder;
    }

    var client = {
      auth: {
        signUp: function (opts) {
          var db = loadDB();
          var email = String(opts.email).toLowerCase();
          var uid = uidFor(email);
          // Unikhet på E-POST, ikke bare uidFor-id: en bruker som har ENDRET
          // e-post beholder sin gamle id, og adressen må fortsatt regnes som
          // opptatt — ellers kunne en ny registrering overskrive passordet
          // (db.passwords[email]) og «overta» den eksisterende kontoen.
          if (!db.profiles.some(function (p) { return p.email === email; })) {
            // Navn (display_name) fra registrerings-metadata (handle_new_user).
            var meta = (opts.options && opts.options.data) || {};
            var dn = (meta.display_name && String(meta.display_name).trim()) || email.split('@')[0];
            db.profiles.push({ id: uid, email: email, display_name: dn, user_metadata: clone(meta) });
            db.passwords[email] = opts.password;
            // koble ventende invitasjoner (handle_new_user)
            db.share_invites.forEach(function (s) {
              if (s.status === 'pending' && !s.invitee_id && String(s.invitee_email).toLowerCase() === email) s.invitee_id = uid;
            });
            saveDB(db);
          }
          // Simuler «bekreft e-post»: ingen sesjon returneres (bruker må «logge inn»).
          return Promise.resolve({ data: { user: { id: uid, email: email }, session: null }, error: null });
        },
        signInWithPassword: function (opts) {
          var db = loadDB();
          var email = String(opts.email).toLowerCase();
          // Slå opp på E-POST (ikke uidFor): e-posten kan være endret etter
          // registrering (auth.updateUser({ email })), mens id-en består.
          var p = db.profiles.find(function (x) { return x.email === email; });
          if (!p || db.passwords[email] !== opts.password) {
            return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
          }
          var user = { id: p.id, email: email, user_metadata: clone(p.user_metadata) || {} };
          setSess(user);
          // Innloggingen ER en ny økt, som hos Supabase.
          sessionId(db, user);
          saveDB(db);
          setTimeout(function () { emitAuth('SIGNED_IN', { user: user }); }, 0);
          return Promise.resolve({ data: { user: user, session: { user: user } }, error: null });
        },
        resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: null }); },
        updateUser: function (attrs) {
          var u = getSess();
          if (u && (attrs.password || attrs.data || attrs.email)) {
            var db = loadDB();
            if (attrs.password) db.passwords[u.email] = attrs.password;
            if (attrs.data) {
              // Supabase MERGER `data` inn i metadataen brukeren har NÅ, og den
              // levende brukeren er sesjonen — ikke profilraden. Flettet vi fra
              // profilen, ville felter sesjonen bærer men profilen ennå ikke har
              // sett (en seedet test, en annen fane som skrev) forsvunnet ved
              // neste skriving: en `updateUser({ data: { lang } })` kunne da
              // stryke `onboarding` og starte demoen midt i noe.
              u.user_metadata = Object.assign({}, u.user_metadata, attrs.data);
              var p = db.profiles.find(function (x) { return x.id === u.id; });
              if (p) p.user_metadata = clone(u.user_metadata);
              setSess(u); // hold denne fanens sesjon i takt
            }
            if (attrs.email) {
              // E-postendring — ekte Supabase sender bekreftelseslenke; mocken
              // endrer direkte (som handle_user_email_change etter bekreftelse).
              var ne = String(attrs.email).toLowerCase().trim();
              var mine = db.profiles.find(function (x) { return x.id === u.id; });
              var taken = db.profiles.some(function (x) { return x.email === ne && x.id !== u.id; });
              if (!mine || taken) {
                return Promise.resolve({ data: null, error: { message: 'E-postadressen er allerede i bruk' } });
              }
              db.passwords[ne] = db.passwords[mine.email];
              delete db.passwords[mine.email];
              mine.email = ne;
              u.email = ne;
              setSess(u);
            }
            saveDB(db);
          }
          return Promise.resolve({ data: { user: u }, error: null });
        },
        /* SCOPE, som i supabase-js: `local` avslutter BARE denne økten,
           `others` alle de andre og lar denne stå, `global` (standarden i
           biblioteket) alle. Huskis kaller alltid `local` fra «Logg ut», og
           `others` fra «Logg ut på alle andre enheter» — og at de to faktisk
           gjør forskjellig ting er noe testene skal kunne bevise. */
        signOut: function (opts) {
          var scope = (opts && opts.scope) || 'global';
          var db = loadDB();
          var u = getSess();
          var sid = u && u.session_id;
          if (u) {
            db.auth_sessions = db.auth_sessions.filter(function (x) {
              if (x.user_id !== u.id) return true;
              if (scope === 'local') return x.id !== sid;
              if (scope === 'others') return x.id === sid;
              return false;   // global
            });
            var levende = {};
            db.auth_sessions.forEach(function (x) { levende[x.id] = 1; });
            db.device_sessions = db.device_sessions.filter(function (d) { return levende[d.session_id]; });
            saveDB(db);
          }
          // `others` logger IKKE ut her — det er hele forskjellen fra global.
          if (scope === 'others') return Promise.resolve({ error: null });
          setSess(null);
          setTimeout(function () { emitAuth('SIGNED_OUT', null); }, 0);
          return Promise.resolve({ error: null });
        },
        getSession: function () {
          if (!AUTH_LAG) return Promise.resolve({ data: { session: sessionObj() }, error: null });
          return new Promise(function (resolve) {
            afterAuthLag(function () { resolve({ data: { session: sessionObj() }, error: null }); });
          });
        },
        onAuthStateChange: function (cb) {
          authListeners.push(cb);
          afterAuthLag(function () { cb('INITIAL_SESSION', sessionObj()); });
          return { data: { subscription: { unsubscribe: function () {} } } };
        },
      },
      from: function (table) {
        return {
          insert: function (payload) {
            return thenable(function () {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB();
              var tomb = tombstoneError(db, table, payload);
              if (tomb) return { data: null, error: tomb };
              var fk = catFkError(db, table, payload);
              if (fk) return { data: null, error: fk };
              applyInsert(db, table, u.id, payload); saveDB(db);
              return { data: null, error: null };
            });
          },
          update: function (payload) {
            return thenable(function (filters) {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB();
              var fk = catFkError(db, table, payload);
              if (fk) return { data: null, error: fk };
              applyUpdate(db, table, u.id, clone(payload), filters); saveDB(db);
              return { data: null, error: null };
            });
          },
          delete: function () {
            return thenable(function (filters) {
              var u = getSess(); if (!u) return { data: null, error: { message: 'ikke innlogget' } };
              var db = loadDB(); applyDelete(db, table, u.id, filters); saveDB(db);
              return { data: null, error: null };
            });
          },
          select: function () {
            return thenable(function (filters) {
              var db = loadDB(); var rows = db[table].filter(function (r) {
                return matches(r, filters);
              });
              return { data: clone(rows), error: null };
            });
          },
        };
      },
      rpc: function (name, params) {
        return serverCall(function () {
          var u = getSess();
          if (!u) return { data: null, error: { message: 'ikke innlogget' } };
          // Databasen leses FØRST når kallet «når serveren» (etter forsinkelsen),
          // så serialiserte kall ser hverandres skrivinger — som ekte Postgres.
          var db = loadDB();
          /* Økten registreres når den først RØRER serveren. En test som seedet
             `hk-mock-session` selv (tests/CLAUDE.md) har ingen `session_id`;
             her får den en, slik at «Innloggede enheter» virker uten at hver
             eneste fikstur må kjenne øktlaget. */
          sessionId(db, u);
          var h = rpcHandlers(db, u.id)[name];
          if (!h) return { data: null, error: { message: 'ukjent rpc: ' + name } };
          var data = h(params || {});
          saveDB(db);
          return { data: data, error: null };
        });
      },
      channel: function (nm) {
        var ch = { _handlers: [], _statusCb: null,
          on: function () { var cb = arguments[arguments.length - 1]; ch._handlers.push(cb); return ch; },
          subscribe: function (statusCb) { ch._statusCb = statusCb || null; channels.push(ch); if (statusCb) setTimeout(function () { statusCb('SUBSCRIBED'); }, 0); return ch; },
        };
        return ch;
      },
      removeChannel: function (ch) { channels = channels.filter(function (c) { return c !== ch; }); closed([ch]); },
      // Samme flate som supabase-js: den er det en feilsøkingsøkt tar realtime
      // ut av bildet med (docs/mobilapp-plan.md, «Sonden»).
      getChannels: function () { return channels.slice(); },
      removeAllChannels: function () { var old = channels; channels = []; closed(old); },
    };
    return client;
  }

  window.HK_MOCK = { createClient: createClient, _loadDB: loadDB, _saveDB: saveDB };
})();
