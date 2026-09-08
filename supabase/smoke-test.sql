-- ============================================================
-- Huskis: SMOKE-TEST etter migrering
--
-- Kjøres mot den LEVENDE databasen rett etter at `setup.sql` +
-- `users-and-sharing.sql` er kjørt, og FØR produksjonsdeployen på Vercel
-- slippes gjennom (.github/workflows/release.yml). Feiler den, blir den nye
-- frontenden aldri publisert — det er hele poenget.
--
-- Den svarer på ett spørsmål: «finnes og virker alt den deployede klienten
-- trenger?». Kontrakten er derfor hentet fra klienten, ikke fra skjemafila:
--
--   * tabellene i `TABLE`-mappingen og realtime-abonnementet i app.js
--   * kolonnene `insertPayload()` / `updatePayload()` faktisk sender
--     (PostgREST avviser HVER skriving for radtypen hvis én mangler — det var
--     nettopp cards/items.collapsed-hendelsen)
--   * RPC-ene klienten kaller med `.rpc(...)`, med riktig signatur OG
--     execute-rettighet for `authenticated`
--   * at RLS er PÅ, at policyene finnes, og at `anon` ikke kommer til
--
-- `tests/db-contract.test.js` holder listene her i takt med app.js.
--
-- TRYGGHET: hele fila kjører i ÉN read-only-transaksjon som avsluttes med
-- rollback. Den kan ikke skrive, ikke låse noe tyngre enn ACCESS SHARE, og
-- kan derfor kjøres mot produksjon mens brukerne er innlogget.
--
-- Kjør:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/smoke-test.sql
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin transaction read only;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

-- Feil samles opp underveis (i en session-GUC, siden en read-only-transaksjon
-- ikke får lage temp-tabeller) og rapporteres SAMLET til slutt. Én runde skal
-- vise alt som mangler, ikke bare det første.
--
-- Oppsamlingen bruker `array_append(feil, …)`, ALDRI `feil || '…'`: mot en
-- `text[]` er `||` tvetydig, og PostgreSQL velger `anyarray || anyarray` for en
-- bar strengliteral — den prøver da å tolke meldingen som en array-literal og
-- kaster «malformed array literal». Feilen ville bare vist seg i det øyeblikket
-- en sjekk FAKTISK feilet, altså nøyaktig når testen trengs.
select set_config('huskis.smoke_feil', '', false);

\echo '──────── 1. Tabeller ────────'
do $$
declare
  feil text[] := '{}';
  t text;
begin
  foreach t in array array[
    'profiles', 'universes', 'groups', 'cards', 'items', 'ideas',
    'note_projects', 'note_folders', 'notes',
    'memberships', 'share_invites', 'tombstones',
    'notifications', 'notification_prefs',
    'push_subscriptions', 'push_deliveries', 'device_sessions',
    'native_notif_devices',
    'migration_log', 'app_config', 'email_send_log'
  ] loop
    if to_regclass('public.' || t) is null then
      feil := array_append(feil, 'tabell public.' || t || ' mangler');
    else
      raise notice '  ✓ public.%', t;
    end if;
  end loop;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  end if;
end $$;

\echo '──────── 2. Kolonner klienten skriver ────────'
do $$
declare
  feil text[] := '{}';
  spec text; tbl text; col text; n int;
begin
  -- Nøyaktig de feltene insertPayload()/updatePayload() i app.js sender, pluss
  -- feltene get_my_doc() leser tilbake. Mangler én av dem, stopper synken for
  -- HELE radtypen.
  foreach spec in array array[
    'universes:id', 'universes:owner_id', 'universes:name', 'universes:trashed',
    'universes:locked', 'universes:unlocked', 'universes:collapsed',
    'universes:invite_policy', 'universes:ts', 'universes:org',
    'universes:pos', 'universes:pos_ts', 'universes:pos_org',

    'groups:id', 'groups:owner_id', 'groups:universe_id', 'groups:name',
    'groups:trashed', 'groups:locked', 'groups:unlocked', 'groups:collapsed',
    'groups:cat_id', 'groups:is_cat', 'groups:invite_policy',
    'groups:ts', 'groups:org', 'groups:pos', 'groups:pos_ts', 'groups:pos_org',

    'cards:id', 'cards:owner_id', 'cards:group_id', 'cards:title',
    'cards:trashed', 'cards:locked', 'cards:unlocked', 'cards:collapsed',
    'cards:k', 'cards:p', 'cards:lab_ts', 'cards:lab_org',
    'cards:responsible', 'cards:start_at', 'cards:due_at', 'cards:lock_times',
    'cards:ts', 'cards:org', 'cards:pos', 'cards:pos_ts', 'cards:pos_org',

    'items:id', 'items:owner_id', 'items:card_id', 'items:text',
    'items:trashed', 'items:done', 'items:collapsed',
    'items:cat_id', 'items:is_cat', 'items:lock_times',
    'items:responsible', 'items:start_at', 'items:due_at',
    'items:ts', 'items:org', 'items:pos', 'items:pos_ts', 'items:pos_org',

    -- Idéer (docs/ideer.md): kontoens egne rader, uten forelder i hierarkiet.
    'ideas:id', 'ideas:owner_id', 'ideas:text', 'ideas:trashed',
    'ideas:cat_id', 'ideas:is_cat', 'ideas:collapsed',
    'ideas:ts', 'ideas:org', 'ideas:pos', 'ideas:pos_ts', 'ideas:pos_org',

    -- Notater (docs/notater-plan.md): Prosjekt > Mappe > Notat, kontoens egne
    -- rader. `folder_id` er null for et fritt notat rett i prosjektet.
    'note_projects:id', 'note_projects:owner_id', 'note_projects:name',
    'note_projects:collapsed', 'note_projects:trashed',
    'note_projects:ts', 'note_projects:org',
    'note_projects:pos', 'note_projects:pos_ts', 'note_projects:pos_org',

    'note_folders:id', 'note_folders:owner_id', 'note_folders:project_id',
    'note_folders:name', 'note_folders:trashed', 'note_folders:ts', 'note_folders:org',
    'note_folders:pos', 'note_folders:pos_ts', 'note_folders:pos_org',

    'notes:id', 'notes:owner_id', 'notes:project_id', 'notes:folder_id',
    'notes:title', 'notes:body', 'notes:trashed', 'notes:ts', 'notes:org',
    'notes:pos', 'notes:pos_ts', 'notes:pos_org',

    'memberships:id', 'memberships:user_id', 'memberships:universe_id',
    'memberships:group_id', 'memberships:role', 'memberships:pos',

    'profiles:id', 'profiles:email', 'profiles:display_name', 'profiles:avatar',

    'share_invites:id', 'share_invites:inviter_id', 'share_invites:invitee_id',
    'share_invites:invitee_email', 'share_invites:universe_id',
    'share_invites:group_id', 'share_invites:role', 'share_invites:status',
    'share_invites:created_at',

    'tombstones:resource_type', 'tombstones:resource_id', 'tombstones:ts',

    -- Varsler (docs/varsler.md): klienten skriver `read_at` direkte og leser
    -- resten gjennom get_my_doc(); notify_record() fyller radene.
    'notifications:id', 'notifications:user_id', 'notifications:key',
    'notifications:type', 'notifications:obj_type', 'notifications:obj_id',
    'notifications:name', 'notifications:path', 'notifications:value',
    'notifications:at', 'notifications:snoozed',
    'notifications:created_at', 'notifications:read_at',

    'notification_prefs:user_id', 'notification_prefs:due_over',
    'notification_prefs:due_soon', 'notification_prefs:start_now',
    'notification_prefs:start_soon', 'notification_prefs:cursor_at',
    'notification_prefs:tz', 'notification_prefs:tz_at',

    -- Web push (docs/varsler.md): klienten leser sine egne abonnementer og
    -- sletter dem; rader lages av push_subscribe(). Utboksen er serverens.
    'push_subscriptions:id', 'push_subscriptions:user_id',
    'push_subscriptions:endpoint', 'push_subscriptions:p256dh',
    'push_subscriptions:auth', 'push_subscriptions:labels',
    'push_subscriptions:tz', 'push_subscriptions:created_at',
    'push_subscriptions:seen_at', 'push_subscriptions:disabled_at',
    -- Gjenkjennelig metadata + brukerens EGEN avslåing (skilt fra 404/410).
    'push_subscriptions:browser', 'push_subscriptions:platform',
    'push_subscriptions:origin', 'push_subscriptions:device_id',
    'push_subscriptions:revoked_at',

    -- Innloggede økter: sidebordet til auth.sessions (docs/accounts.md).
    'device_sessions:session_id', 'device_sessions:user_id',
    'device_sessions:browser', 'device_sessions:platform',
    'device_sessions:origin', 'device_sessions:device_id',
    'device_sessions:created_at', 'device_sessions:seen_at',

    -- Android-appens varselkanal: statusen som gjør «Enheter med varsler»
    -- sann også for native (docs/varsler.md).
    'native_notif_devices:id', 'native_notif_devices:user_id',
    'native_notif_devices:device_id', 'native_notif_devices:origin',
    'native_notif_devices:browser', 'native_notif_devices:platform',
    'native_notif_devices:enabled', 'native_notif_devices:created_at',
    'native_notif_devices:seen_at', 'native_notif_devices:revoked_at',

    'push_deliveries:id', 'push_deliveries:notification_id',
    'push_deliveries:subscription_id', 'push_deliveries:user_id',
    'push_deliveries:due_at', 'push_deliveries:status',
    'push_deliveries:attempts', 'push_deliveries:claimed_at',
    'push_deliveries:done_at', 'push_deliveries:error'
  ] loop
    tbl := split_part(spec, ':', 1);
    col := split_part(spec, ':', 2);
    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = tbl and column_name = col;
    if n = 0 then
      feil := array_append(feil, 'kolonne public.' || tbl || '.' || col || ' mangler');
    end if;
  end loop;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ alle kolonnene klienten skriver finnes';
  end if;
end $$;

\echo '──────── 3. RLS er på ────────'
do $$
declare
  feil text[] := '{}';
  t text; paa boolean;
begin
  foreach t in array array[
    'profiles', 'universes', 'groups', 'cards', 'items', 'ideas',
    'note_projects', 'note_folders', 'notes',
    'memberships', 'share_invites', 'tombstones',
    'notifications', 'notification_prefs',
    'push_subscriptions', 'push_deliveries', 'device_sessions',
    'native_notif_devices',
    'migration_log', 'app_config', 'email_send_log'
  ] loop
    select relrowsecurity into paa from pg_class
     where oid = to_regclass('public.' || t);
    if paa is distinct from true then
      feil := array_append(feil, 'RLS er IKKE på for public.' || t);
    end if;
  end loop;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ RLS på alle tabellene';
  end if;
end $$;

\echo '──────── 4. RLS-policyer ────────'
do $$
declare
  feil text[] := '{}';
  p text; n int;
begin
  foreach p in array array[
    'profiles:profiles_select', 'profiles:profiles_update',
    'universes:universes_select', 'universes:universes_insert',
    'universes:universes_update', 'universes:universes_delete',
    'groups:groups_select', 'groups:groups_insert',
    'groups:groups_update', 'groups:groups_delete',
    'cards:cards_select', 'cards:cards_insert',
    'cards:cards_update', 'cards:cards_delete',
    'items:items_select', 'items:items_insert',
    'items:items_update', 'items:items_delete',
    'ideas:ideas_select', 'ideas:ideas_insert',
    'ideas:ideas_update', 'ideas:ideas_delete',
    'note_projects:note_projects_select', 'note_projects:note_projects_insert',
    'note_projects:note_projects_update', 'note_projects:note_projects_delete',
    'note_folders:note_folders_select', 'note_folders:note_folders_insert',
    'note_folders:note_folders_update', 'note_folders:note_folders_delete',
    'notes:notes_select', 'notes:notes_insert',
    'notes:notes_update', 'notes:notes_delete',
    'memberships:memberships_select', 'memberships:memberships_update',
    'memberships:memberships_delete',
    'share_invites:share_invites_select', 'share_invites:share_invites_delete',
    'tombstones:tombstones_select',
    'notifications:notifications_select', 'notifications:notifications_update',
    'notifications:notifications_delete',
    'notification_prefs:notification_prefs_select',
    'push_subscriptions:push_subscriptions_select',
    'push_subscriptions:push_subscriptions_delete'
  ] loop
    select count(*) into n from pg_policies
     where schemaname = 'public'
       and tablename = split_part(p, ':', 1)
       and policyname = split_part(p, ':', 2);
    if n = 0 then
      feil := array_append(feil, 'policy ' || split_part(p, ':', 2) || ' mangler på public.' || split_part(p, ':', 1));
    end if;
  end loop;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ alle 34 policyene finnes';
  end if;
end $$;

\echo '──────── 5. RPC-er: signatur + execute-rettigheter ────────'
do $$
declare
  feil text[] := '{}';
  fn text; oid_ oid;
begin
  -- Nøyaktig signaturene klienten kaller via .rpc(...). Feil signatur er like
  -- ille som ingen funksjon: PostgREST finner den ikke.
  foreach fn in array array[
    'public.get_my_doc()',
    'public.import_doc(jsonb)',
    'public.create_share_invite(text, uuid, text, text)',
    'public.accept_share_invite(uuid, uuid, double precision)',
    'public.decline_share_invite(uuid)',
    'public.revoke_share_invite(uuid)',
    'public.revoke_share(text, uuid, uuid)',
    'public.set_member_role(text, uuid, uuid, text)',
    'public.leave_share(text, uuid)',
    'public.set_locked(text, uuid, boolean)',
    'public.set_unlocked(text, uuid, boolean)',
    'public.set_invite_policy(text, uuid, text)',
    'public.get_members(text, uuid)',
    'public.move_group(uuid, uuid, uuid, double precision)',
    'public.delete_account()',
    'public.notify_record(jsonb, bigint)',
    'public.notify_set_prefs(jsonb)',
    'public.notify_claim_tz(text, bigint)',
    'public.push_subscribe(text, text, text, jsonb, text, text, text, text, text, boolean)',
    'public.push_unsubscribe(text)',
    'public.push_revoke(uuid)',
    'public.push_revoke_others(text)',
    'public.native_notif_touch(boolean, text, text, text, text, boolean)',
    'public.native_notif_revoke(uuid)',
    'public.notif_revoke_others(text, text, text)',
    'public.session_touch(text, text, text, text)',
    'public.list_my_devices(text, text, text)',
    'public.revoke_my_session(uuid)'
  ] loop
    oid_ := to_regprocedure(fn);
    if oid_ is null then
      feil := array_append(feil, 'RPC ' || fn || ' mangler');
    else
      if not has_function_privilege('authenticated', oid_, 'EXECUTE') then
        feil := array_append(feil, 'RPC ' || fn || ': authenticated mangler EXECUTE');
      end if;
      if has_function_privilege('anon', oid_, 'EXECUTE') then
        feil := array_append(feil, 'RPC ' || fn || ': anon HAR EXECUTE (skal være trukket tilbake)');
      end if;
    end if;
  end loop;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ alle RPC-ene finnes med riktig signatur og rettigheter';
  end if;
end $$;

\echo '──────── 6. Interne funksjoner + triggere ────────'
do $$
declare
  feil text[] := '{}';
  fn text; oid_ oid; tg text; n int;
begin
  -- Capability-funksjonene: get_my_doc() kaller dem for HVER rad. Halvmigrert
  -- produksjon 2026-08-01 hadde tabellene, men ikke disse.
  foreach fn in array array[
    'public.universe_caps(uuid, uuid)', 'public.group_caps(uuid, uuid)',
    'public.universe_role(uuid, uuid)', 'public.group_role(uuid, uuid)',
    'public.can_edit_content(text, uuid, uuid)',
    'public.can_create_child(text, uuid, uuid)',
    'public.can_delete_object(text, uuid, uuid)',
    'public.can_move_group(uuid, uuid)',
    'public.is_effectively_locked(text, uuid)',
    'public.effective_invite_policy(text, uuid)',
    'public.universe_member_count(uuid)', 'public.group_member_count(uuid)',
    'public.universe_owner_count(uuid)', 'public.universe_owner_set(uuid)',
    'public.write_tombstone()', 'public.guard_object_insert()',
    'public.handle_new_user()', 'public.send_invite_email()',
    -- Taket på antall abonnementer per bruker. push_subscribe() kaller den for
    -- hver påmelding; mangler den, feiler hver eneste påmelding.
    'public.push_sub_max()',
    -- Hvor lenge et dødt/tilbakekalt spor blir liggende. push_subscribe()
    -- kaller den for hver påmelding.
    'public.push_keep_days()'
  ] loop
    oid_ := to_regprocedure(fn);
    if oid_ is null then feil := array_append(feil, 'funksjon ' || fn || ' mangler'); end if;
  end loop;

  -- Interne hjelpere skal IKKE kunne kalles som RPC.
  foreach fn in array array[
    'public.purge_universe_access(uuid, uuid)',
    'public.purge_group_access(uuid, uuid)',
    'public.notify_prefs_row(uuid)',
    -- Levetiden for en varselrad. notify_record() rydder etter den og
    -- get_my_doc() filtrerer på den; mangler den, feiler begge.
    'public.notify_max_age_ms()',
    -- Senderens kø-teller: leser ALLE brukeres leveringer.
    'public.push_due_count()',
    -- Headerne tikket sender. Tar imot selve secret key-en som argument.
    'public.push_headers(text)',
    -- Avslutter køen til ett abonnement — skriver i utboksen.
    'public.push_end_queue(uuid, bigint, text)',
    -- Serialiserer én brukers abonnementer (advisory lock). En klient som kunne
    -- kalle den, kunne holdt sine egne synk-runder i kø.
    'public.push_lock(uuid)',
    -- Øktlaget: byggeklosser, ikke RPC-er. `session_alive` og
    -- `current_session_id` leser KALLERENS eget claim, men skal likevel ikke
    -- være en inngang klienten kan kalle direkte.
    'public.session_alive(uuid)',
    'public.current_session_id()',
    'public.prune_device_sessions(uuid)',
    -- Det aktive native settet for én bruker. Kallerne sender sin egen
    -- auth.uid() inn; funksjonen har ingen egen autorisasjonssjekk.
    'public.native_notif_active(uuid)'
  ] loop
    oid_ := to_regprocedure(fn);
    if oid_ is null then
      feil := array_append(feil, 'funksjon ' || fn || ' mangler');
    elsif has_function_privilege('authenticated', oid_, 'EXECUTE') then
      feil := array_append(feil, fn || ' er eksponert for authenticated (skal være intern)');
    end if;
  end loop;

  /* TRIGGERFUNKSJONENE ER IKKE RPC-ER. Alle er `security definer` og gjør
     privilegerte ting uten en egen autorisasjonssjekk, og PostgreSQL gir hver
     ny funksjon EXECUTE til `public` som standard. Sjekken er GENERISK — alt i
     `public` som returnerer `trigger` — så en ny trigger ikke kan komme inn
     uten låsen (users-and-sharing.sql, seksjon 12). */
  for tg in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'))
  loop
    feil := array_append(feil, 'triggerfunksjonen ' || tg || ' er kallbar som RPC (skal være intern)');
  end loop;

  -- Vaktene og gravsteinstriggerne: uten dem er skjemaet på plass, men
  -- reglene håndheves ikke.
  foreach tg in array array[
    'universes:universes_guard', 'groups:groups_guard',
    'cards:cards_guard', 'items:items_guard', 'ideas:ideas_guard',
    'note_projects:note_projects_guard', 'note_folders:note_folders_guard',
    'notes:notes_guard',
    'universes:universes_tombstone', 'groups:groups_tombstone',
    'cards:cards_tombstone', 'items:items_tombstone', 'ideas:ideas_tombstone',
    'note_projects:note_projects_tombstone', 'note_folders:note_folders_tombstone',
    'notes:notes_tombstone',
    'universes:universes_insert_guard', 'groups:groups_insert_guard',
    'cards:cards_insert_guard', 'items:items_insert_guard',
    'ideas:ideas_insert_guard',
    'note_projects:note_projects_insert_guard',
    'note_folders:note_folders_insert_guard', 'notes:notes_insert_guard',
    'notes:notes_parent_guard', 'note_folders:note_folders_cascade',
    'universes:universes_owner_seed', 'groups:groups_owner_seed',
    'memberships:memberships_guard', 'memberships:memberships_last_owner_guard',
    'share_invites:on_share_invite_created'
  ] loop
    select count(*) into n from pg_trigger
     where tgrelid = to_regclass('public.' || split_part(tg, ':', 1))
       and tgname = split_part(tg, ':', 2)
       and not tgisinternal;
    if n = 0 then
      feil := array_append(feil, 'trigger ' || split_part(tg, ':', 2) || ' mangler på public.' || split_part(tg, ':', 1));
    end if;
  end loop;

  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ capability-funksjoner, vakter og triggere på plass';
  end if;
end $$;

\echo '──────── 7. Tabellrettigheter ────────'
do $$
declare
  feil text[] := '{}';
  t text;
begin
  foreach t in array array['universes', 'groups', 'cards', 'items', 'ideas',
                           'note_projects', 'note_folders', 'notes'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE') then
      feil := array_append(feil, 'authenticated mangler CRUD på public.' || t);
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    feil := array_append(feil, 'authenticated mangler SELECT på public.profiles');
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') then
    feil := array_append(feil, 'authenticated mangler UPDATE(display_name) på public.profiles');
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE') then
    feil := array_append(feil, 'authenticated KAN skrive profiles.email (skal være speilet fra auth)');
  end if;
  /* MINSTEPRIVILEGIUM. Klienten leser disse tabellene, men muterer dem aldri
     direkte — roller og invitasjoner går via RPC-ene, gravsteiner skrives av
     delete-triggerne. Supabases standardprivilegier gir ALL på en ny tabell,
     så hver av dem må være EKSPLISITT trukket tilbake; en glemt REVOKE gir
     ingen rød test noe annet sted. Matrisen står i users-and-sharing.sql. */
  if not has_table_privilege('authenticated', 'public.memberships', 'SELECT, UPDATE') then
    feil := array_append(feil, 'authenticated mangler SELECT/UPDATE på memberships (personlig rekkefølge + realtime)');
  end if;
  foreach t in array array['INSERT', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.memberships', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på memberships (roller skal kun endres av RPC-ene)');
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.share_invites', 'SELECT') then
    feil := array_append(feil, 'authenticated mangler SELECT på share_invites (innboksen + realtime)');
  end if;
  foreach t in array array['INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.share_invites', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på share_invites (skal kun gå via RPC-ene)');
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.tombstones', 'SELECT') then
    feil := array_append(feil, 'authenticated mangler SELECT på tombstones (fetchServerTombs)');
  end if;
  foreach t in array array['INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.tombstones', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på tombstones (skrives kun av delete-triggerne)');
    end if;
  end loop;

  -- Varsler: SELECT + DELETE, UPDATE kun på `read_at`, og ALDRI INSERT —
  -- rader lages av notify_record(), som setter user_id selv (docs/varsler.md).
  if not has_table_privilege('authenticated', 'public.notifications', 'SELECT, DELETE') then
    feil := array_append(feil, 'authenticated mangler SELECT/DELETE på notifications (historikk + «Tøm varsler»)');
  end if;
  if not has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE') then
    feil := array_append(feil, 'authenticated mangler UPDATE(read_at) på notifications (lest/ulest)');
  end if;
  if has_table_privilege('authenticated', 'public.notifications', 'INSERT') then
    feil := array_append(feil, 'authenticated KAN INSERT på notifications (skal kun gå via notify_record())');
  end if;
  foreach t in array array['key', 'type', 'at', 'user_id'] loop
    if has_column_privilege('authenticated', 'public.notifications', t, 'UPDATE') then
      feil := array_append(feil, 'authenticated KAN skrive notifications.' || t || ' (kun read_at skal være skrivbar)');
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.notification_prefs', 'SELECT') then
    feil := array_append(feil, 'authenticated mangler SELECT på notification_prefs');
  end if;
  foreach t in array array['INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.notification_prefs', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på notification_prefs (skal kun gå via notify_set_prefs())');
    end if;
  end loop;

  -- Web push: SELECT + DELETE på egne abonnementer, aldri INSERT/UPDATE (den
  -- veien går gjennom push_subscribe(), som setter user_id selv). Utboksen har
  -- ingen klientvei i det hele tatt, og senderens to funksjoner må være stengt
  -- for både anon og authenticated — de leser ANDRE brukeres leveringer.
  if not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT, DELETE') then
    feil := array_append(feil, 'authenticated mangler SELECT/DELETE på push_subscriptions');
  end if;
  foreach t in array array['INSERT', 'UPDATE'] loop
    if has_table_privilege('authenticated', 'public.push_subscriptions', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på push_subscriptions (skal kun gå via push_subscribe())');
    end if;
  end loop;
  foreach t in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.push_deliveries', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på push_deliveries (utboksen er serverens)');
    end if;
    -- Sidebordet til auth.sessions er like låst som utboksen: en direkte vei
    -- ville latt en klient navngi en økt hen ikke eier.
    if has_table_privilege('authenticated', 'public.device_sessions', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på device_sessions (skal kun gå via session_touch())');
    end if;
    -- Android-appens varselstatus er like låst: en direkte vei ville latt en
    -- klient slå av varslene på en enhet hen ikke eier.
    if has_table_privilege('authenticated', 'public.native_notif_devices', t) then
      feil := array_append(feil, 'authenticated KAN ' || t || ' på native_notif_devices (skal kun gå via native_notif_touch())');
    end if;
  end loop;
  foreach t in array array['public.push_claim(integer, bigint)', 'public.push_report(jsonb)',
                           'public.push_tick()', 'public.push_enqueue(uuid)'] loop
    if to_regprocedure(t) is null then
      feil := array_append(feil, 'funksjon ' || t || ' mangler');
    else
      if has_function_privilege('authenticated', to_regprocedure(t), 'EXECUTE') then
        feil := array_append(feil, t || ': authenticated HAR EXECUTE (skal være trukket tilbake)');
      end if;
      if has_function_privilege('anon', to_regprocedure(t), 'EXECUTE') then
        feil := array_append(feil, t || ': anon HAR EXECUTE (skal være trukket tilbake)');
      end if;
    end if;
  end loop;

  -- anon skal ikke se noe som helst.
  foreach t in array array[
    'profiles', 'universes', 'groups', 'cards', 'items', 'ideas',
    'note_projects', 'note_folders', 'notes',
    'memberships', 'share_invites', 'tombstones',
    'notifications', 'notification_prefs', 'push_subscriptions', 'push_deliveries',
    'device_sessions', 'native_notif_devices'
  ] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      feil := array_append(feil, 'anon har SELECT på public.' || t);
    end if;
  end loop;

  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ rettighetene er som forventet for authenticated og anon';
  end if;
end $$;

\echo '──────── 8. Realtime-publikasjon ────────'
do $$
declare
  feil text[] := '{}';
  t text; n int;
begin
  -- Klienten abonnerer på postgres_changes for disse (app.js:
  -- startCloudRealtime). Utenfor Supabase finnes ikke publikasjonen — da
  -- hoppes sjekken over, akkurat som i users-and-sharing.sql.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '  – ingen supabase_realtime-publikasjon (ikke Supabase) — hoppet over';
    return;
  end if;
  foreach t in array array[
    'universes', 'groups', 'cards', 'items', 'ideas',
    'note_projects', 'note_folders', 'notes', 'memberships', 'share_invites'
  ] loop
    select count(*) into n from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t;
    if n = 0 then
      feil := array_append(feil, 'public.' || t || ' er ikke med i supabase_realtime');
    end if;
  end loop;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ alle ti tabellene er i supabase_realtime';
  end if;
end $$;

\echo '──────── 8b. Rekker vi auth.sessions? ────────'
/* Fjern-utlogging virker bare hvis EIEREN av `revoke_my_session()` faktisk kan
   lese og slette i `auth.sessions`. Den tabellen tilhører Supabase Auth, ikke
   oss, og rettigheten der er den ENE forutsetningen ingen annen test kan se:
   funksjonen finnes, granten ser riktig ut, og likevel ville hvert kall feilet.

   Dette er en ADVARSEL, ikke en port. Grunnen er hva som faktisk ryker: appen
   kjører uansett — `session_alive()` svarer «levende» om den ikke får lese, og
   klienten viser en feil på selve knappen — så det er ÉN funksjon som mangler,
   ikke en halvmigrert database. Å stanse hele releasen for det ville vært
   uforholdsmessig, og verre for brukeren enn den knappen den gjelder.

   Sjekken kjøres som migreringsrollen — den samme som eier funksjonene, siden
   det er den som kjørte `create function`. */
do $$
declare mangler text[] := '{}'; n bigint;
begin
  if to_regclass('auth.sessions') is null then
    mangler := array_append(mangler, 'auth.sessions finnes ikke (ingen Supabase Auth?)');
  else
    begin
      execute 'select count(*) from auth.sessions' into n;
    exception when others then
      mangler := array_append(mangler, 'kan ikke LESE auth.sessions (' || sqlerrm || ')');
    end;
    if not has_table_privilege(current_user, 'auth.sessions', 'DELETE') then
      mangler := array_append(mangler, 'mangler DELETE på auth.sessions');
    end if;
  end if;
  if array_length(mangler, 1) > 0 then
    raise warning E'«Innloggede enheter» virker ikke fullt ut som %: %\n  Resten av appen er upåvirket. Se docs/accounts.md.',
      current_user, array_to_string(mangler, '; ');
  else
    raise notice '  ✓ auth.sessions er lesbar og slettbar for %', current_user;
  end if;
end $$;

\echo '──────── 9. Virker det? (get_my_doc som innlogget bruker) ────────'
-- En uuid som aldri kan tilhøre en ekte konto (auth.users bruker v4).
-- Kallet er `stable` og leser kun; transaksjonen er read-only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true);
set local role authenticated;

do $$
declare
  feil text[] := '{}';
  doc jsonb;
  k text;
begin
  begin
    doc := public.get_my_doc();
  exception when others then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) ||
      'get_my_doc() KASTET: ' || sqlerrm || E'\n', false);
    return;
  end;

  foreach k in array array['user', 'universes', 'groups', 'cards', 'items',
                           'invites_in', 'invites_out',
                           -- Signalet en Android-app leser hver synk-runde for å
                           -- oppdage at en annen enhet slo varslene av her.
                           'notif_revoked'] loop
    if not (doc ? k) then feil := array_append(feil, 'get_my_doc(): mangler nøkkelen «' || k || '»'); end if;
  end loop;

  -- En ukjent bruker skal få et TOMT doc. Får den rader, lekker RLS/joinene.
  foreach k in array array['universes', 'groups', 'cards', 'items',
                           'invites_in', 'invites_out'] loop
    if jsonb_array_length(coalesce(doc -> k, '[]'::jsonb)) <> 0 then
      feil := array_append(feil, 'get_my_doc(): «' || k || '» er ikke tom for en ukjent bruker — LEKKASJE');
    end if;
  end loop;

  -- Capability-funksjonene svarer uten å kaste (get_my_doc kaller dem per rad).
  if public.universe_caps('00000000-0000-0000-0000-000000000000',
                          '00000000-0000-0000-0000-000000000000') is null then
    feil := array_append(feil, 'universe_caps() returnerte null');
  end if;
  if public.group_caps('00000000-0000-0000-0000-000000000000',
                       '00000000-0000-0000-0000-000000000000') is null then
    feil := array_append(feil, 'group_caps() returnerte null');
  end if;

  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ get_my_doc() svarer med et tomt, komplett doc for en ukjent bruker';
  end if;
end $$;

reset role;

\echo '──────── 10. Virker RLS? (anon slipper ikke inn) ────────'
set local role anon;
do $$
declare feil text[] := '{}';
begin
  begin
    perform 1 from public.universes limit 1;
    feil := array_append(feil, 'anon fikk lese public.universes');
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.profiles limit 1;
    feil := array_append(feil, 'anon fikk lese public.profiles');
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_my_doc();
    feil := array_append(feil, 'anon fikk kalle get_my_doc()');
  exception when insufficient_privilege then null;
           when others then null;  -- «ikke innlogget» er også avvisning
  end;
  if array_length(feil, 1) > 0 then
    perform set_config('huskis.smoke_feil',
      current_setting('huskis.smoke_feil', true) || array_to_string(feil, E'\n') || E'\n', false);
  else
    raise notice '  ✓ anon avvises på tabeller og RPC';
  end if;
end $$;
reset role;

\echo '──────── Resultat ────────'
do $$
declare f text := coalesce(current_setting('huskis.smoke_feil', true), '');
begin
  if f <> '' then
    raise exception E'Smoke-testen FEILET — databasen er ikke klar for den nye klienten:\n%', f;
  end if;
  raise notice '✅ Smoke-test grønn: skjema, rettigheter, policyer, triggere og RPC-er er på plass og svarer.';
end $$;

rollback;
