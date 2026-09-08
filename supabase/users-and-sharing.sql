-- ============================================================
-- Huskis: brukere, roller, eierskap og deling
-- Idempotent: trygg å kjøre flere ganger.
--
-- Modell (se docs/rettigheter-og-deling.md for full design):
--
--   * Supabase Auth (e-post + passord, bekreftelseslenke på e-post)
--     står for identitet. public.profiles speiler auth.users.
--   * Relasjonelle tabeller per nivå: universes > groups > cards
--     («lister» i UI-et) > items. Hver rad har `owner_id`, som er
--     OPPRETTEREN (created_by) — ren historikk, uten myndighet.
--   * DELING skjer KUN på områder og mapper. Lister arver alltid
--     tilgang fra mappen sin; listepunkter/kategorier fra listen.
--   * MYNDIGHET ligger i MUTABLE ROLLER (public.memberships.role):
--       - universe + role 'owner'  → områdeeier (medeier når flere)
--       - universe + role 'member' → vanlig områdemedlem
--       - group    + role 'owner'  → eksplisitt mappeeier
--       - group    + role 'member' → direkte mappemedlem
--     Områdeeiere er DYNAMISKE supereiere av alle mapper/lister i
--     området og trenger ingen egne mapperader. Effektivt mappe-
--     medlemskap = deduplisert union av områdeeiere, eksplisitte
--     mappeeiere, områdemedlemmer og direkte mappemedlemmer.
--   * INVARIANT: et område har alltid minst én `owner`. Håndheves i
--     databasen (memberships_last_owner_guard) — ikke bare i RPC-ene.
--   * AUTORISASJON er capability-basert (`*_caps`-funksjonene under),
--     beregnet serverside og returnert til klienten. RLS + BEFORE
--     UPDATE-vakter håndhever; klientens flagg er kun visning.
--   * Konflikthåndtering: felt-nivå LWW-registre (ts/org for innhold,
--     pos_ts/pos_org for plassering, lab_ts/lab_org for K/P), håndhevet
--     også på serveren: en utdatert skriving taper mot nyere data.
--   * Gravsteiner (tombstones) skrives automatisk ved sletting, slik at
--     offline-klienter ikke gjenoppliver slettede objekter.
--   * PERSONLIG rekkefølge (områder på toppnivå, frie mapper) ligger
--     på medlemskapsraden (`memberships.pos`) — også for eiere. Delt
--     rekkefølge (mapper i et område, lister i en mappe, listepunkter)
--     ligger på objektraden (`pos`).
--   * get_my_doc() gir hele brukerens datasett som ETT flatt jsonb-doc
--     (universes/groups/cards/items + roller + capabilities + invitasjoner).
--   * move_group() er den ENESTE veien en mappe bytter område:
--     samme eierskapsdomene → ekte reparenting; ulikt domene → atomisk
--     kopier-og-slett med nye id-er + gravsteiner for de gamle.
--   * import_doc(p_doc) migrerer et lokalt/legacy doc inn som brukerens
--     egne data (deterministiske id-er, idempotent).
--
-- Krever (manuelt, i Supabase-dashboardet — se TODO.md):
--   * Auth: "Confirm email" PÅ (standard), Site URL + Redirect URLs
--     satt til appens adresse. Ev. egen SMTP for produksjonsvolum.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 0. MIGRERINGSLOGG — engangsjobber som IKKE skal kjøres på nytt
--    (en rolle-backfill som kjørte om igjen ville gjeninnsatt en
--    rolle eieren bevisst har fjernet).
-- ------------------------------------------------------------

create table if not exists public.migration_log (
  key    text primary key,
  ran_at timestamptz not null default now()
);
alter table public.migration_log enable row level security;
revoke all on public.migration_log from public, anon, authenticated;

-- ------------------------------------------------------------
-- 1. PROFILES — speil av auth.users
-- ------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Profilbilde: det ferdig beskårne, kvadratiske bildet som en data-URI
-- (256x256 JPEG fra klientens bilderedigering — noen få titalls kB). Lagres
-- her, ikke i Storage: raden er allerede den vi henter personen fra, og
-- get_members kan levere den sammen med navn/e-post. Størrelsen er en
-- systemgrense (klienten kan sende hva som helst), så den håndheves her.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_size;
alter table public.profiles add constraint profiles_avatar_size
  check (avatar is null or length(avatar) <= 200000);

create unique index if not exists profiles_email_key on public.profiles (lower(email));

alter table public.profiles enable row level security;

-- Opprettes/oppdateres automatisk fra auth.users. Kobler også
-- ventende invitasjoner (sendt til e-posten før brukeren fantes).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();

  update public.share_invites
     set invitee_id = new.id
   where invitee_id is null
     and lower(invitee_email) = lower(new.email)
     and status = 'pending';

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set email = lower(new.email), updated_at = now()
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ------------------------------------------------------------
-- 2. OBJEKTTABELLER — universes > groups > cards > items
--    Registre som i synk-doc-et:
--      innhold:    ts / org          (navn/tekst/trashed; K/P for kort
--                                     har eget register lab_ts/lab_org)
--      plassering: pos_ts / pos_org  (pos + forelder-peker følger
--                                     posisjonsregisteret)
--    `owner_id` = OPPRETTER (created_by). Uforanderlig, og gir INGEN
--    rettigheter — myndighet kommer utelukkende fra roller.
-- ------------------------------------------------------------

create table if not exists public.universes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,   -- redigeringslås for vanlige medlemmer
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  universe_id uuid not null references public.universes (id) on delete cascade,
  name        text not null default '',
  trashed     boolean not null default false,
  locked      boolean not null default false,
  ts          bigint not null default 0,
  org         text   not null default '',
  pos         double precision not null default 0,
  pos_ts      bigint not null default 0,
  pos_org     text   not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.cards (      -- «lister» i UI-et
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  title      text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,
  k          boolean not null default true,    -- merkelapp K
  p          boolean not null default true,    -- merkelapp P
  ts         bigint not null default 0,
  org        text   not null default '',
  lab_ts     bigint not null default 0,        -- eget register for K/P
  lab_org    text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  card_id    uuid not null references public.cards (id) on delete cascade,
  text       text not null default '',
  trashed    boolean not null default false,
  done       boolean not null default false,
  responsible uuid references public.profiles (id) on delete set null,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Avkryssing av listepunkter (gjort/ikke gjort): rir på innholds-registeret
-- (ts/org), som text/trashed. Idempotent for databaser opprettet før feltet.
alter table public.items add column if not exists done boolean not null default false;
-- Ansvarlig bruker for et listepunkt (den som «tar oppgaven» i en delt liste).
-- Peker på en profil med effektiv tilgang til mappen. Rir på innholds-
-- registeret (ts/org). `on delete set null` så en slettet konto bare nullstiller
-- ansvaret. Idempotent for eldre databaser.
alter table public.items add column if not exists responsible uuid references public.profiles (id) on delete set null;

-- Tidsplanlegging (start/frist) + ansvarlig for HELE lister. Tidsverdiene er
-- klientens lokale «vegg-tid» som tekst ('YYYY-MM-DD' eller 'YYYY-MM-DDTHH:MM',
-- klokkeslett valgfritt) — bevisst IKKE timestamptz: en frist «14. juli» skal
-- bety 14. juli på alle enheter uansett tidssone, og klienten trenger å vite
-- om et klokkeslett faktisk er definert. `cards.lock_times` låser listens
-- tider til listepunktene (de kan da ikke ha egne). Alt rir på innholds-
-- registeret (ts/org). Idempotent for eldre databaser.
alter table public.cards add column if not exists start_at text;
alter table public.cards add column if not exists due_at text;
alter table public.cards add column if not exists lock_times boolean not null default false;
alter table public.cards add column if not exists responsible uuid references public.profiles (id) on delete set null;
alter table public.items add column if not exists start_at text;
alter table public.items add column if not exists due_at text;

-- Kategorier: en kategori er en nivå-1-«rad» i en liste som grupperer listepunkter
-- (nivå 2) under en felles overskrift. Den lagres SOM et listepunkt (samme tabell),
-- markert `is_cat = true`; leaf-rader peker på kategorien sin via `cat_id`
-- (null = ukategorisert). `on delete set null` løsner radene om kategori-raden
-- slettes. `lock_times` (som cards) låser kategoriens tider til medlemmene.
-- `cat_id` følger posisjonsregisteret (som `card_id`); `is_cat`/`lock_times` rir
-- på innholds-registeret (ts/org). Idempotent for eldre databaser.
-- `deferrable initially deferred`: import_doc kan sette inn et listepunkt FØR
-- kategori-raden det peker på (doc-rekkefølgen er vilkårlig) — FK-en sjekkes
-- da først ved commit, når alle radene finnes.
alter table public.items add column if not exists cat_id uuid references public.items (id) on delete set null deferrable initially deferred;
alter table public.items add column if not exists is_cat boolean not null default false;
alter table public.items add column if not exists lock_times boolean not null default false;

-- Unntak fra arvet lås: et objekt under et låst område/mappe er automatisk
-- låst for vanlige medlemmer, men rett autoritet kan sette `unlocked = true` for
-- NETTOPP dette objektet så det likevel kan redigeres (og alt under det, med
-- mindre et enda lavere nivå låses på nytt). `locked` og `unlocked` er gjensidig
-- utelukkende per rad. Idempotent for eldre databaser.
alter table public.universes add column if not exists unlocked boolean not null default false;
alter table public.groups    add column if not exists unlocked boolean not null default false;
alter table public.cards     add column if not exists unlocked boolean not null default false;

-- Lukketilstand for lister (rullgardin-kollaps i UI-et): en visnings-preferanse
-- per liste som lagres og synkes som annet innhold. Rir på innholds-registeret.
alter table public.cards     add column if not exists collapsed boolean not null default false;

-- Lukketilstand for kategorier (samme rullgardin-kollaps som lister). En kategori
-- lagres som et listepunkt, så feltet bor på `items` (kun meningsfullt for
-- is_cat-rader). Rir på innholds-registeret (ts/org).
alter table public.items     add column if not exists collapsed boolean not null default false;

-- Områder og mapper vises med NØYAKTIG samme oppsett som lister og
-- listepunkter (navigasjonsmodalen): et område er et kort som kan kollapses, og
-- mappene i det er rader som kan ligge i MAPPEKATEGORIER. Speiler derfor
-- kategori-modellen fra `items`. Idempotent for eldre databaser.
alter table public.groups    add column if not exists cat_id uuid references public.groups (id) on delete set null deferrable initially deferred;
alter table public.groups    add column if not exists is_cat boolean not null default false;
alter table public.groups    add column if not exists collapsed boolean not null default false;
alter table public.universes add column if not exists collapsed boolean not null default false;

-- Invitasjonspolicy (tretilstand: 'inherit' | 'allow' | 'deny') — styrer om
-- VANLIGE medlemmer (ikke eiere) kan invitere flere til objektet. DYNAMISK ARV:
-- den effektive tilstanden er den NÆRMESTE eksplisitte ('allow'/'deny') fra
-- objektet og oppover; ingen eksplisitt noe sted → tillat. Finnes KUN på
-- områder og mapper (lister deles ikke). `cards.invite_policy` er pensjonert:
-- kolonnen beholdes for eldre databaser, men leses aldri.
do $$ begin
  alter table public.universes add column if not exists invite_policy text not null default 'inherit';
  alter table public.groups    add column if not exists invite_policy text not null default 'inherit';
exception when others then null;
end $$;
do $$ begin
  alter table public.universes add constraint universes_invite_policy_chk check (invite_policy in ('inherit','allow','deny'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.groups    add constraint groups_invite_policy_chk    check (invite_policy in ('inherit','allow','deny'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 2b. IDÉER — kontoens egen hurtigblokk (docs/ideer.md)
--
--    En idé hører til KONTOEN, ikke til et område eller en mappe: den samme
--    listen vises uansett hvor i hierarkiet man står. Derfor ingen `card_id`,
--    ingen medlemskap, ingen capabilities — eierskapet ER autorisasjonen, og
--    RLS er `owner_id = auth.uid()` på alle fire operasjonene.
--
--    Formen er ellers listepunktets: to nivåer i én tabell (`is_cat` markerer
--    en kategori, `cat_id` peker fra en idé til kategorien sin), samme to
--    registre (innhold `ts/org`, posisjon `pos_ts/pos_org`) og samme
--    gravstein-/insert-vakt. Det som IKKE finnes her er med vilje: ingen
--    frister, ingen ansvarlig, ingen avkryssing — en idé skrives ned og
--    slettes, den planlegges ikke.
--
--    `deferrable initially deferred` på `cat_id` av samme grunn som på items:
--    doc-rekkefølgen er vilkårlig, så en idé kan settes inn før kategorien den
--    peker på.
-- ------------------------------------------------------------

create table if not exists public.ideas (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  cat_id     uuid references public.ideas (id) on delete set null deferrable initially deferred,
  text       text not null default '',
  is_cat     boolean not null default false,
  collapsed  boolean not null default false,
  trashed    boolean not null default false,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists universes_owner_idx on public.universes (owner_id);
create index if not exists groups_owner_idx    on public.groups (owner_id);
create index if not exists groups_universe_idx on public.groups (universe_id);
create index if not exists cards_owner_idx     on public.cards (owner_id);
create index if not exists cards_group_idx     on public.cards (group_id);
create index if not exists items_owner_idx     on public.items (owner_id);
create index if not exists items_card_idx      on public.items (card_id);
create index if not exists ideas_owner_idx     on public.ideas (owner_id);
create index if not exists ideas_cat_idx       on public.ideas (cat_id);

alter table public.universes enable row level security;
alter table public.groups    enable row level security;
alter table public.cards     enable row level security;
alter table public.items     enable row level security;
alter table public.ideas     enable row level security;

-- ------------------------------------------------------------
-- 2c. NOTATER — Prosjekt > Mappe > Notat (docs/notater-plan.md)
--
--    Notater er Huskis' ANDRE hoveddel, ved siden av listene. Hierarkiet er
--    Prosjekt > Mappe > Notat, og formen er listenes: samme to registre
--    (innhold `ts/org`, posisjon `pos_ts/pos_org`), samme gravstein- og
--    insert-vakt, samme 3-veis fletting i klienten.
--
--    EIERSKAPET ER AUTORISASJONEN, som for idéene: ingen medlemskap, ingen
--    roller, ingen låser, og RLS er `owner_id = auth.uid()` på alle fire
--    operasjonene. Deling av notater er et senere steg; modellen sperrer den
--    ikke (rader med eier og forelder er nøyaktig det medlemskapstabellen
--    allerede henger på for områder og mapper).
--
--    ET NOTAT HAR TO FORELDRE-PEKERE. `project_id` er alltid satt; `folder_id`
--    er null for et FRITT notat som ligger rett i prosjektet. Mapper nøstes
--    aldri i mapper, så to nivåer er hele treet. Begge pekerne rir på
--    posisjonsregisteret (som `card_id`/`cat_id` på et listepunkt).
--
--    INNHOLDET ER STRUKTURERT, IKKE HTML. `body` er editorens dokument som
--    jsonb: en blokkliste med inline-kjøringer. Det kan redigeres videre uten
--    formattap, gjøres om til lesbar tekst for søk, og rendres trygt (klienten
--    bygger noder, den setter aldri rå HTML). Konflikter løses per DOKUMENT
--    (innholdsregisteret), ikke per tegn.
--
--    `deferrable initially deferred` på forelder-pekerne av samme grunn som på
--    items: doc-rekkefølgen er vilkårlig, så et notat kan settes inn før
--    mappen eller prosjektet det peker på.
-- ------------------------------------------------------------

create table if not exists public.note_projects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '',
  collapsed  boolean not null default false,
  trashed    boolean not null default false,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.note_folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.note_projects (id) on delete cascade deferrable initially deferred,
  name       text not null default '',
  trashed    boolean not null default false,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.note_projects (id) on delete cascade deferrable initially deferred,
  folder_id  uuid references public.note_folders (id) on delete set null deferrable initially deferred,
  title      text not null default '',
  -- Editorens dokument. Formen er klientens (`{v, blocks:[…]}`); databasen
  -- lagrer den som jsonb og tolker den ikke.
  body       jsonb not null default '{"v":1,"blocks":[]}'::jsonb,
  trashed    boolean not null default false,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists note_projects_owner_idx on public.note_projects (owner_id);
create index if not exists note_folders_owner_idx  on public.note_folders (owner_id);
create index if not exists note_folders_project_idx on public.note_folders (project_id);
create index if not exists notes_owner_idx         on public.notes (owner_id);
create index if not exists notes_project_idx       on public.notes (project_id);
create index if not exists notes_folder_idx        on public.notes (folder_id);

alter table public.note_projects enable row level security;
alter table public.note_folders  enable row level security;
alter table public.notes         enable row level security;

-- ARKIVERING (docs/notater-plan.md). Et arkivert objekt er levende innhold som
-- er lagt til side: det vises ikke i normalvisningen, men det ligger ikke i
-- søppelkassen og kan hentes fram igjen uten å ha vært innom den. Flagget rir
-- på INNHOLDS-registeret (ts/org), akkurat som `trashed` — det er en egenskap
-- ved objektet, ikke ved plasseringen. De to er uavhengige: et arkivert objekt
-- kan legges i søppelkassen, og et objekt kan gjenopprettes fra søppelkassen
-- tilbake til arkivet det lå i. Idempotent for eldre databaser.
alter table public.note_projects add column if not exists archived boolean not null default false;
alter table public.note_folders  add column if not exists archived boolean not null default false;
alter table public.notes         add column if not exists archived boolean not null default false;

-- ------------------------------------------------------------
-- 2c. KOBLINGER MELLOM NOTATER OG LISTER — public.object_links
--
--    En kobling er en RELASJON, ikke en plassering: den flytter ingenting og
--    eier ingenting. Notatsiden (bokhylle/notatbok/notat) og listesiden
--    (område/mappe/liste) beholder sine vanlige foreldre, og et objekt kan
--    inngå i vilkårlig mange koblinger — mange-til-mange begge veier.
--
--    HVER SIDE ER SIN EGEN FREMMEDNØKKEL, ikke et (type, id)-par i tekst.
--    Det koster tre nullbare kolonner per side, men gir til gjengjeld det et
--    tekstpar aldri kan gi: databasen selv garanterer at et koblingsmål
--    finnes. `on delete cascade` betyr at en kobling forsvinner i samme
--    øyeblikk som objektet den peker på slettes PERMANENT — det finnes ingen
--    hengende koblinger å rydde etter, verken her eller i klienten. En ny
--    koblingsbar type senere er én kolonne til og ett ledd i sjekken, ikke en
--    ombygging.
--
--    Nøyaktig ÉN kolonne per side er satt (sjekkene under). Koblingen har
--    ingen mutable felter: den finnes eller den finnes ikke. Konflikter løses
--    derfor av gravsteinene, som for et permanent slettet objekt — en
--    innsetting av en id som er gravlagt avvises (PT409), så en klient som
--    fortsatt har koblingen lokalt får vite at den er borte for godt.
--    `ts`/`org` bæres med for sporbarhet og for at klientens fletting skal ha
--    et register å lese, men ingen skriving endrer dem: raden oppdateres
--    aldri.
--
--    INGEN UNIK INDEKS på paret, med vilje: to enheter som lager den SAMME
--    koblingen offline ville ellers fått den ene skrivingen permanent avvist
--    (23505) og prøvd igjen i det uendelige. Klienten viser og fjerner
--    koblinger PER PAR, så en dublett er usynlig og forsvinner ved første
--    fjerning.
-- ------------------------------------------------------------

create table if not exists public.object_links (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  -- Notatsiden: nøyaktig én av de tre.
  note_project_id uuid references public.note_projects (id) on delete cascade deferrable initially deferred,
  note_folder_id  uuid references public.note_folders (id)  on delete cascade deferrable initially deferred,
  note_id         uuid references public.notes (id)         on delete cascade deferrable initially deferred,
  -- Listesiden: nøyaktig én av de tre.
  universe_id uuid references public.universes (id) on delete cascade deferrable initially deferred,
  group_id    uuid references public.groups (id)    on delete cascade deferrable initially deferred,
  card_id     uuid references public.cards (id)     on delete cascade deferrable initially deferred,
  ts         bigint not null default 0,
  org        text   not null default '',
  created_at timestamptz not null default now()
);

-- Sjekkene settes med `drop … add` så de også kommer på en EKSISTERENDE
-- database (der `create table if not exists` er en no-op).
do $$ begin
  alter table public.object_links drop constraint if exists object_links_one_note_side;
  alter table public.object_links add constraint object_links_one_note_side
    check ((note_project_id is not null)::int + (note_folder_id is not null)::int
           + (note_id is not null)::int = 1);
  alter table public.object_links drop constraint if exists object_links_one_list_side;
  alter table public.object_links add constraint object_links_one_list_side
    check ((universe_id is not null)::int + (group_id is not null)::int
           + (card_id is not null)::int = 1);
exception when others then null; end $$;

create index if not exists object_links_owner_idx    on public.object_links (owner_id);
create index if not exists object_links_np_idx       on public.object_links (note_project_id);
create index if not exists object_links_nf_idx       on public.object_links (note_folder_id);
create index if not exists object_links_note_idx     on public.object_links (note_id);
create index if not exists object_links_universe_idx on public.object_links (universe_id);
create index if not exists object_links_group_idx    on public.object_links (group_id);
create index if not exists object_links_card_idx     on public.object_links (card_id);

alter table public.object_links enable row level security;

-- ------------------------------------------------------------
-- 3. ROLLER/MEDLEMSKAP og INVITASJONER
-- ------------------------------------------------------------

-- Én rad = én brukers ROLLE på ETT delbart objekt (område eller mappe).
-- Nøyaktig én av universe_id/group_id er satt.
--   * role 'owner'  → eier/medeier (områdeeier hhv. eksplisitt mappeeier)
--   * role 'member' → vanlig medlem (områdemedlem hhv. direkte mappemedlem)
--   * pos           → brukerens PERSONLIGE rekkefølge (områder på toppnivå,
--                     frie mapper i «Mapper delt med meg»). Endrer aldri
--                     hva andre ser.
-- Eiere HAR en rad (i motsetning til den gamle modellen) — det er nettopp
-- den raden som gjør eierskapet mutabelt (degradering/overføring).
-- `card_id` er PENSJONERT (lister deles ikke lenger); kolonnen står igjen for
-- eldre databaser, men en CHECK holder den null. Se migreringen i del 11.
create table if not exists public.memberships (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  universe_id        uuid references public.universes (id) on delete cascade,
  group_id           uuid references public.groups (id) on delete cascade,
  card_id            uuid references public.cards (id) on delete cascade,
  parent_universe_id uuid references public.universes (id) on delete set null,
  parent_group_id    uuid references public.groups (id) on delete set null,
  pos                double precision not null default 0,
  trashed            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.memberships add column if not exists role text not null default 'member';
do $$ begin
  alter table public.memberships add constraint memberships_role_chk check (role in ('owner','member'));
exception when duplicate_object then null; end $$;

create unique index if not exists memberships_universe_user_key
  on public.memberships (universe_id, user_id) where universe_id is not null;
create unique index if not exists memberships_group_user_key
  on public.memberships (group_id, user_id) where group_id is not null;
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_universe_role_idx on public.memberships (universe_id, role);
create index if not exists memberships_group_role_idx on public.memberships (group_id, role);

alter table public.memberships enable row level security;

-- Invitasjon til et område eller en mappe, adressert til en e-post (mottakeren
-- trenger ikke ha konto ennå; kobles ved registrering). `role` avgjør om det er
-- en MEDLEMS- eller EIERSKAPS-invitasjon; begge må aksepteres av mottakeren.
-- Aksept krever ingen plassering — objektet havner i riktig seksjon av seg selv.
create table if not exists public.share_invites (
  id            uuid primary key default gen_random_uuid(),
  inviter_id    uuid not null references public.profiles (id) on delete cascade,
  invitee_email text not null,
  invitee_id    uuid references public.profiles (id) on delete cascade,
  universe_id   uuid references public.universes (id) on delete cascade,
  group_id      uuid references public.groups (id) on delete cascade,
  card_id       uuid references public.cards (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);

alter table public.share_invites add column if not exists role text not null default 'member';
do $$ begin
  alter table public.share_invites add constraint share_invites_role_chk check (role in ('owner','member'));
exception when duplicate_object then null; end $$;

create unique index if not exists share_invites_universe_pending_key
  on public.share_invites (universe_id, lower(invitee_email))
  where status = 'pending' and universe_id is not null;
create unique index if not exists share_invites_group_pending_key
  on public.share_invites (group_id, lower(invitee_email))
  where status = 'pending' and group_id is not null;
create index if not exists share_invites_invitee_idx
  on public.share_invites (lower(invitee_email)) where status = 'pending';

alter table public.share_invites enable row level security;

-- ------------------------------------------------------------
-- 4. GRAVSTEINER — hindrer at offline-klienter gjenoppliver
--    hardslettede objekter ved neste synk.
--
--    Gravsteinene er AUTORITATIVE og håndheves av databasen selv
--    (guard_object_insert under): en permanent slettet id kan ikke
--    settes inn igjen — heller ikke av en gammel klientversjon, en
--    modifisert klient eller en rå INSERT/UPSERT mot PostgREST.
--
--    De UTLØPER ALDRI. En klient som har ligget ubrukt i et år har
--    fortsatt sin gamle lokale kopi, og skal møte gravsteinen når
--    den endelig synker igjen. Se docs/trash.md.
-- ------------------------------------------------------------

create table if not exists public.tombstones (
  resource_type text not null check (resource_type in ('universe', 'group', 'card', 'item', 'idea',
                                                       'note_project', 'note_folder', 'note')),
  resource_id   uuid not null,
  ts            bigint not null default 0,   -- HLC-tid for slettingen
  deleted_at    timestamptz not null default now(),
  primary key (resource_type, resource_id)
);

-- Idé- og notattypene kom til etter at tabellen fantes: sjekk-vilkåret må
-- utvides på en EKSISTERENDE database også, ikke bare i `create table`-formen
-- over. Idempotent: constrainten droppes og settes tilbake med samme navn.
do $$ begin
  alter table public.tombstones drop constraint if exists tombstones_resource_type_check;
  alter table public.tombstones add constraint tombstones_resource_type_check
    check (resource_type in ('universe', 'group', 'card', 'item', 'idea',
                             'note_project', 'note_folder', 'note',
                             'object_link'));
exception when others then null; end $$;

create index if not exists tombstones_resource_idx on public.tombstones (resource_id);

alter table public.tombstones enable row level security;

create or replace function public.write_tombstone()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rtype text := case tg_table_name
                  when 'universes' then 'universe'
                  when 'groups'    then 'group'
                  when 'cards'     then 'card'
                  when 'items'     then 'item'
                  when 'ideas'     then 'idea'
                  when 'note_projects' then 'note_project'
                  when 'note_folders'  then 'note_folder'
                  when 'notes'         then 'note'
                end;
begin
  insert into public.tombstones (resource_type, resource_id, ts)
  values (rtype, old.id, greatest(old.ts, old.pos_ts, (extract(epoch from now()) * 1000)::bigint))
  on conflict (resource_type, resource_id)
    do update set ts = excluded.ts, deleted_at = now();
  return old;
end;
$$;

drop trigger if exists universes_tombstone on public.universes;
create trigger universes_tombstone after delete on public.universes
  for each row execute function public.write_tombstone();
drop trigger if exists groups_tombstone on public.groups;
create trigger groups_tombstone after delete on public.groups
  for each row execute function public.write_tombstone();
drop trigger if exists cards_tombstone on public.cards;
create trigger cards_tombstone after delete on public.cards
  for each row execute function public.write_tombstone();
drop trigger if exists items_tombstone on public.items;
create trigger items_tombstone after delete on public.items
  for each row execute function public.write_tombstone();
drop trigger if exists ideas_tombstone on public.ideas;
create trigger ideas_tombstone after delete on public.ideas
  for each row execute function public.write_tombstone();
drop trigger if exists note_projects_tombstone on public.note_projects;
create trigger note_projects_tombstone after delete on public.note_projects
  for each row execute function public.write_tombstone();
drop trigger if exists note_folders_tombstone on public.note_folders;
create trigger note_folders_tombstone after delete on public.note_folders
  for each row execute function public.write_tombstone();
drop trigger if exists notes_tombstone on public.notes;
create trigger notes_tombstone after delete on public.notes
  for each row execute function public.write_tombstone();

-- Koblingene har ingen posisjon, og dermed heller ikke `pos_ts` — de får sin
-- egen, ellers identiske, gravsteinsskriver. Gravsteinen er det ENESTE som
-- avgjør en konflikt for en kobling: raden har ingen felter å flette.
create or replace function public.write_link_tombstone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tombstones (resource_type, resource_id, ts)
  values ('object_link', old.id, greatest(old.ts, (extract(epoch from now()) * 1000)::bigint))
  on conflict (resource_type, resource_id)
    do update set ts = excluded.ts, deleted_at = now();
  return old;
end;
$$;

drop trigger if exists object_links_tombstone on public.object_links;
create trigger object_links_tombstone after delete on public.object_links
  for each row execute function public.write_link_tombstone();

-- BEFORE INSERT-vakt på de fire objekttabellene. To ting, og begge må ligge i
-- DATABASEN for å være noe verdt — en klient kan byttes ut, databasen ikke:
--   1. GJENOPPLIVING. Har id-en gravstein, avvises innsettingen (PT409), så
--      klienten kan gravlegge raden lokalt og slutte å prøve.
--   2. OPPRETTER. `owner_id` valideres mot den innloggede brukeren, uavhengig
--      av policy-oppsettet.
-- auth.uid() is null = psql/vedlikehold: owner_id sjekkes ikke, men gravsteinen
-- gjelder også der.
create or replace function public.guard_object_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rtype text := case tg_table_name
                  when 'universes' then 'universe'
                  when 'groups'    then 'group'
                  when 'cards'     then 'card'
                  when 'items'     then 'item'
                  when 'ideas'     then 'idea'
                  when 'note_projects' then 'note_project'
                  when 'note_folders'  then 'note_folder'
                  when 'notes'         then 'note'
                  when 'object_links'  then 'object_link'
                end;
begin
  if exists (select 1 from public.tombstones t
              where t.resource_type = rtype and t.resource_id = new.id) then
    raise exception using
      errcode = 'PT409',
      message = 'gravlagt: ' || rtype || ' ' || new.id || ' er permanent slettet',
      hint    = 'Objektet er slettet for godt. En utdatert klient kan ikke sette det inn igjen.';
  end if;
  if uid is not null and new.owner_id is distinct from uid then
    raise exception using
      errcode = '42501',
      message = 'oppretter (owner_id) må være den innloggede brukeren';
  end if;
  return new;
end;
$$;

drop trigger if exists universes_insert_guard on public.universes;
create trigger universes_insert_guard before insert on public.universes
  for each row execute function public.guard_object_insert();
drop trigger if exists groups_insert_guard on public.groups;
create trigger groups_insert_guard before insert on public.groups
  for each row execute function public.guard_object_insert();
drop trigger if exists cards_insert_guard on public.cards;
create trigger cards_insert_guard before insert on public.cards
  for each row execute function public.guard_object_insert();
drop trigger if exists items_insert_guard on public.items;
create trigger items_insert_guard before insert on public.items
  for each row execute function public.guard_object_insert();
drop trigger if exists ideas_insert_guard on public.ideas;
create trigger ideas_insert_guard before insert on public.ideas
  for each row execute function public.guard_object_insert();
drop trigger if exists note_projects_insert_guard on public.note_projects;
create trigger note_projects_insert_guard before insert on public.note_projects
  for each row execute function public.guard_object_insert();
drop trigger if exists note_folders_insert_guard on public.note_folders;
create trigger note_folders_insert_guard before insert on public.note_folders
  for each row execute function public.guard_object_insert();
drop trigger if exists notes_insert_guard on public.notes;
create trigger notes_insert_guard before insert on public.notes
  for each row execute function public.guard_object_insert();
drop trigger if exists object_links_insert_guard on public.object_links;
create trigger object_links_insert_guard before insert on public.object_links
  for each row execute function public.guard_object_insert();

-- ------------------------------------------------------------
-- 4b. VARSLER — per-bruker varselhistorikk og preferanser
--
--    Varsler er IKKE innhold. De hører til én bruker, deles aldri, og ligger
--    derfor utenfor synk-doc-ets 3-veis fletting: `notifications` er en flat
--    logg av hendelser klienten har OBSERVERT, og `notification_prefs` er
--    brukerens fire av/på-valg pluss generator-markøren. Autoritativt:
--    docs/varsler.md.
--
--    IDENTITET. `key` er varselets logiske identitet — varseltype, objekttype,
--    objekt-id og den planlagte tidsverdien slått sammen av klienten. Den
--    unike indeksen (user_id, key) er det som gjør generatoren idempotent:
--    to enheter som regner ut det samme varselet skriver den samme raden, og
--    den andre skrivingen faller stille bort (`on conflict do nothing`).
--
--    RADENE SKRIVES KUN AV notify_record(). Klienten har ingen INSERT-rett;
--    den kan lese sine egne rader, sette `read_at` på dem og slette dem.
--    Preferansene skrives kun av notify_set_prefs().
-- ------------------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  type       text not null check (type in ('dueOver', 'dueSoon', 'startNow', 'startSoon')),
  obj_type   text not null check (obj_type in ('card', 'category', 'item')),
  obj_id     uuid,
  -- Navn og sti er et ØYEBLIKKSBILDE fra genereringstidspunktet: historikken skal
  -- kunne vises også etter at objektet er slettet eller tilgangen er borte.
  -- Navigasjonen slår derimot alltid opp objektet på nytt på `obj_id`.
  name       text not null default '',
  path       text not null default '',
  value      text,                                  -- objektets egen tidsverdi (lokal veggtid som tekst)
  at         bigint not null,                       -- hendelsens tidspunkt (terskelen), ms
  snoozed    boolean not null default false,        -- bestilt på nytt via «Utsett»
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  read_at    bigint
);

create unique index if not exists notifications_user_key_idx on public.notifications (user_id, key);
create index if not exists notifications_user_at_idx on public.notifications (user_id, at desc);

alter table public.notifications enable row level security;

create table if not exists public.notification_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- De fire typene. Standard PÅ: in-app-historikken er en badge, ikke en
  -- avbrytelse, og en funksjon som er av fra første stund blir aldri sett.
  -- Eksterne kanaler (PR 3B) har sin egen opt-in på toppen av dette.
  due_over   boolean not null default true,
  due_soon   boolean not null default true,
  start_now  boolean not null default true,
  start_soon boolean not null default true,
  -- Generator-markøren: siste tidspunkt terskler er vurdert til og med. Alt som
  -- passeres etter den — og bare det — kan bli et varsel. Den er per BRUKER, så
  -- en enhet som har vært av i ti dager tar igjen nøyaktig de tersklene ingen
  -- annen enhet allerede har logget.
  cursor_at  bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

-- Planens TIDSSONE (IANA, f.eks. 'Europe/Oslo') og når den sist ble hevdet.
-- Terskeltidene i `notifications.at` er ABSOLUTTE millisekunder, regnet ut av
-- klienten fra lokal veggtid — de hører derfor til ÉN sone. Feltene er ikke en
-- inngang til serverside-beregning (serveren regner ingen terskler); de sier
-- hvilken sone planen tilhører, og de er dempingen som hindrer to enheter i
-- ulike soner fra å planlegge om hverandre hver eneste synk-runde.
-- Autoritativt: docs/varsler.md, «Tidssonen planen tilhører».
alter table public.notification_prefs add column if not exists tz text;
alter table public.notification_prefs add column if not exists tz_at bigint not null default 0;

-- ------------------------------------------------------------
-- 4c. WEB PUSH — abonnementer og leveringskø
--
--    Den EKSTERNE leveringskanalen for nettleseren. Ingen ny varselmodell:
--    en push er en LEVERING av en rad som allerede ligger i `notifications`
--    (planlagt fram i tid av den samme generatoren), aldri en egen generator.
--    Serveren tolker ingen terskler — den sender det klienten alt har logget,
--    når radens `at` er nådd. Autoritativt: docs/varsler.md.
--
--    push_subscriptions — ett abonnement per nettleserprofil. `endpoint` er
--      globalt unikt (det ER nettleserinstansen), så en ny innlogging i samme
--      nettleser flytter abonnementet til den nye brukeren i stedet for å lage
--      en dublett. `labels` er de fire typenavnene i BRUKERENS språk, hentet
--      fra ordboken idet abonnementet ble skrevet: uten dem måtte enten SQL-en
--      eller service workeren hatt sin egen kopi av i18n.
--
--    push_deliveries — utboksen: én rad per (varsel, abonnement). Den unike
--      indeksen er idempotensen: det samme logiske varselet kan ikke sendes to
--      ganger til det samme abonnementet, uansett hvor mange ganger
--      notify_record() kjører. Kaskaden fra `notifications` er avlysningen:
--      forsvinner raden (objektet slettet, fullført, tiden endret), forsvinner
--      leveringen med den.
--
--    Utboksen er en LÅST tabell: RLS på, ingen policyer, ingen grants. Verken
--    anon eller authenticated når den gjennom PostgREST. Den leses og skrives
--    kun av push_claim()/push_report(), som er avgrenset til service_role.
-- ------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null,
  -- Nøklene fra PushSubscription.getKey(), base64url uten padding. De er
  -- nettleserens OFFENTLIGE mottakernøkler: de gjør det mulig å KRYPTERE til
  -- abonnementet (RFC 8291), ikke å lese noe.
  p256dh      text not null,
  auth        text not null,
  -- De fire typenavnene i klartekst på brukerens språk: {"dueOver": "…", …}.
  labels      jsonb  not null default '{}'::jsonb,
  tz          text,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  seen_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,
  -- Satt når push-tjenesten svarer 404/410: endepunktet finnes ikke lenger.
  -- Raden blir stående som et spor, men får aldri en ny levering.
  disabled_at bigint
);

create unique index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);

/* GJENKJENNELIG METADATA. Et abonnement er en NETTLESERKONTEKST, ikke en
   fysisk maskin: den samme telefonen kan ha ett abonnement på www.huskis.no og
   ett på en forhåndsvisning, og de er to uavhengige mottakere. Uten noe å
   kjenne dem igjen på er «På her og på 2 andre enheter» det eneste appen kan
   si — og en liste med bare tall er ikke noe man kan rydde i.

   Feltene er derfor det MINSTE som gjør en rad gjenkjennelig for eieren, og
   ikke ett tegn mer: en klassifikasjon av nettleseren («Chrome»), en av
   plattformen («Android»), vertsnavnet abonnementet ble laget på og enhetens
   egen lokale id. Hele user-agenten lagres ALDRI — den er en signatur, og vi
   trenger et navn. Ingen IP, ingen skjermmål, ingenting som kan settes sammen
   til et fingeravtrykk. Klienten sender verdiene selv (docs/varsler.md). */
alter table public.push_subscriptions add column if not exists browser   text;
alter table public.push_subscriptions add column if not exists platform  text;
alter table public.push_subscriptions add column if not exists origin    text;
alter table public.push_subscriptions add column if not exists device_id text;

/* TO MÅTER Å VÆRE AV PÅ, og de betyr ikke det samme:

     disabled_at  push-tjenesten svarte 404/410 — endepunktet finnes ikke
                  lenger. En nettleser som melder seg på igjen har nettopp
                  BEVIST at endepunktet lever, og raden våkner av seg selv.

     revoked_at   BRUKEREN slo av varslene for denne nettleseren fra en annen
                  enhet. Da er det et valg, ikke en feil, og det skal ikke
                  kunne omgjøres av at den avslåtte nettleseren fornyer
                  abonnementet sitt i neste synk-runde. Bare et EKSPLISITT
                  «slå på varsler» på nettopp den klienten tar det tilbake
                  (`push_subscribe(..., p_explicit => true)`).

   Begge er «ikke aktiv»: hverken utboksen, senderen eller telleren i
   get_my_doc() ser en rad som har en av dem satt. */
alter table public.push_subscriptions add column if not exists revoked_at bigint;

-- Indeksen dekker det aktive settet, og «aktiv» har fått et ledd til.
-- Definisjonen endret seg, så den gamle må vekk: `create index if not exists`
-- ville latt den stå med det gamle predikatet.
drop index if exists public.push_subscriptions_user_idx;
create index if not exists push_subscriptions_active_idx
  on public.push_subscriptions (user_id)
  where disabled_at is null and revoked_at is null;

/* … og en til for SPORENE. `push_subscribe()` spør hver gang om denne
   klientkonteksten er slått av (`user_id` + `device_id` + `origin`), og det
   kallet kommer fra hver enhet minst hvert kvarter. Uten en indeks ville det
   spørsmålet lest hele tabellen — alle brukeres rader — for å finne et fåtall
   spor. Predikatet holder indeksen liten: bare de tilbakekalte er med. */
create index if not exists push_subscriptions_revoked_idx
  on public.push_subscriptions (user_id, device_id, origin)
  where revoked_at is not null;

alter table public.push_subscriptions enable row level security;

create table if not exists public.push_deliveries (
  id              bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  due_at          bigint not null,
  status          text   not null default 'pending'
                    check (status in ('pending', 'sent', 'failed', 'gone')),
  attempts        smallint not null default 0,
  claimed_at      bigint,
  done_at         bigint,
  -- Kort feilkode/statuslinje fra push-tjenesten. ALDRI kroppen, aldri
  -- endepunktet, aldri noe av varselets innhold.
  error           text
);

create unique index if not exists push_deliveries_once_idx
  on public.push_deliveries (notification_id, subscription_id);
create index if not exists push_deliveries_due_idx
  on public.push_deliveries (due_at) where status = 'pending';

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4d. INNLOGGEDE ØKTER — gjenkjennelig metadata om `auth.sessions`
--
--    Supabase Auth eier øktene selv: hver innlogging gir en rad i
--    `auth.sessions`, og hvert access-token bærer `session_id`-claimet som
--    peker på den. Vi bygger ALDRI en egen auth-modell ved siden av — det
--    ville vært to sannheter om hvem som er logget inn.
--
--    Det `auth.sessions` ikke har, er noe brukeren kan KJENNE IGJEN. Den har
--    hele user-agenten og IP-adressen, og ingen av delene skal ut til
--    klienten: den første er en signatur, den andre er posisjon. Denne
--    tabellen er derfor et lite sidebord med nøyaktig det som gjør en linje
--    lesbar for eieren — «Chrome · Android, www.huskis.no» — skrevet av
--    klienten selv gjennom `session_touch()`.
--
--    Tabellen er LÅST på samme måte som utboksen: RLS på, ingen policyer,
--    ingen grants. Alt går gjennom RPC-ene under, som setter `user_id` fra
--    `auth.uid()` og slår opp økten i `auth.sessions` selv. Ingen
--    fremmednøkkel til `auth.sessions` — den tabellen ryddes av Supabase på
--    sin egen rytme, og en FK dit ville bundet migreringen vår til et skjema
--    vi ikke eier. En rad uten en levende økt er allerede USYNLIG (listen
--    leses fra `auth.sessions` og venstre-joiner hit), og `session_touch()`
--    luker den bort i forbifarten.
-- ------------------------------------------------------------

create table if not exists public.device_sessions (
  -- Primærnøkkelen ER Supabase-øktens id (`session_id`-claimet).
  session_id uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Klassifikasjoner, aldri råtekst: «Chrome», «Android», «www.huskis.no».
  browser    text,
  platform   text,
  origin     text,
  -- Enhetens egen lokale id (`mine-lister-device`). Den er ORIGIN-avgrenset,
  -- så den identifiserer en nettleserkontekst — ikke en fysisk maskin.
  device_id  text,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  seen_at    bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists device_sessions_user_idx
  on public.device_sessions (user_id);

alter table public.device_sessions enable row level security;
revoke all on public.device_sessions from public, anon, authenticated;

/* ØKTEN KALLEREN STÅR I. Supabase legger `session_id` i access-tokenet, og
   PostgREST gir oss de verifiserte claimene. Begge formene leses: den
   samlede `request.jwt.claims` (produksjon) og den enkeltvise
   `request.jwt.claim.session_id` (eldre form, og den testene setter).

   `null` betyr «ukjent økt», ikke «ingen økt»: et token uten claimet skal
   aldri kunne leses som en tilbakekalt økt. Alle kallerne under feiler
   ÅPENT på null (ingen utlogging), og lukket på alt annet. */
create or replace function public.current_session_id()
returns uuid language plpgsql stable set search_path = public as $$
declare raw text;
begin
  begin
    raw := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
  exception when others then raw := null;
  end;
  if raw is null or raw = '' then
    raw := nullif(current_setting('request.jwt.claim.session_id', true), '');
  end if;
  if raw is null or raw = '' then return null; end if;
  begin
    return raw::uuid;
  exception when others then return null;
  end;
end;
$$;

-- ------------------------------------------------------------
-- 4e. NATIVE VARSELENHETER — Android-appens egen varselkanal
--
--    «Enheter med varsler» skal beskrive ALLE Huskis-klienter som faktisk
--    varsler utenfor appen. Web push har `push_subscriptions`; Android har
--    ingenting der, og skal ikke ha det: appen planlegger LOKALE alarmer på
--    telefonen (`@capacitor/local-notifications`), ingen server er involvert,
--    og det finnes ikke noe endepunkt å registrere. Uten denne tabellen ville
--    listen bare hett «enheter med varsler» — den ville betydd «nettlesere med
--    web push», og en telefon som varslet helt korrekt var usynlig fra
--    huskis.no.
--
--    RADEN ER EN KLIENTKONTEKST, ikke en økt: `user_id` + `device_id` +
--    `origin`, nøyaktig den samme trekanten `push_subscribe()` kjenner en
--    avslått nettleser igjen på. Det er ikke en detalj — det er det som gjør
--    at én telefon blir ÉN rad selv om den har logget inn flere ganger, og at
--    en fjern-avslåing overlever en ny innlogging. Ingen måling av maskinen:
--    `device_id` er et tilfeldig tall Huskis selv skrev i `localStorage`.
--
--    `enabled` er klientens egen rapport om at kanalen er PÅ der (bryteren på
--    OG tillatelsen gitt), skrevet av `native_notif_touch()` ved innlogging,
--    ved hvert på/av og ellers hvert kvarter. `revoked_at` er det samme som på
--    et abonnement: brukeren slo av varslene for DENNE klienten fra en annen
--    enhet, og bare et EKSPLISITT «slå på varsler» på nettopp den klienten tar
--    det tilbake.
--
--    LEVENDE ØKT er porten. En rad er ikke i seg selv en aktiv varselenhet —
--    en app som er logget ut skal ikke stå igjen som «enhet med varsler» selv
--    om den aldri fikk sagt fra. Listen krever derfor at klientkonteksten
--    fortsatt har en levende økt (`device_sessions` → `auth.sessions`), og da
--    faller lokal utlogging, fjern-utlogging og kontosletting ut av seg selv.
--
--    Tabellen er LÅST som utboksen og sidebordet: RLS på, ingen policyer,
--    ingen grants. Alt går gjennom RPC-ene, som setter `user_id` fra
--    `auth.uid()`.
-- ------------------------------------------------------------

create table if not exists public.native_notif_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Klientkonteksten: enhetens egen lokale id og verten appen kjører på.
  device_id   text not null,
  origin      text not null,
  -- Klassifikasjoner, aldri råtekst: «Huskis», «Android».
  browser     text,
  platform    text,
  -- Er den native kanalen PÅ der akkurat nå? Klientens egen rapport.
  enabled     boolean not null default false,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  seen_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,
  -- Brukeren slo av varslene for denne klienten fra en annen enhet.
  revoked_at  bigint
);

-- ÉN RAD PER KLIENTKONTEKST. Uten den unike indeksen ville en app som logger
-- inn på nytt (eller har to økter) blitt to rader — og «Enheter med varsler»
-- hadde vist den samme telefonen to ganger.
create unique index if not exists native_notif_devices_ctx_idx
  on public.native_notif_devices (user_id, device_id, origin);

-- Det aktive settet: det listen og telleren i get_my_doc() leser.
create index if not exists native_notif_devices_active_idx
  on public.native_notif_devices (user_id)
  where enabled and revoked_at is null;

alter table public.native_notif_devices enable row level security;
revoke all on public.native_notif_devices from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. ROLLER, LÅSER og CAPABILITIES
--
-- ============================================================================
-- TERMINOLOGI (se docs/rettigheter-og-deling.md for full modell):
--   * OPPRETTER  = `owner_id` på objektraden. REN HISTORIKK — gir ingen
--                  rettigheter. (Kolonnenavnet er beholdt teknisk; semantisk
--                  er det `created_by`.)
--   * OMRÅDEEIER = memberships(universe_id, role 'owner'). Flere er likestilte
--                  («Medeiere»). Det finnes ALLTID minst én.
--   * MAPPEEIER = memberships(group_id, role 'owner') — «eksplisitt» —
--                  ELLER en områdeeier, som er dynamisk supereier av alle
--                  mapper i området.
--   * EFFEKTIVT MAPPEMEDLEMSKAP = deduplisert union av områdeeiere,
--                  eksplisitte mappeeiere, områdemedlemmer og direkte
--                  mappemedlemmer.
-- Autorisasjonen er CAPABILITY-basert; alt håndheves SERVERSIDE (RLS + BEFORE
-- UPDATE-vakter + SECURITY DEFINER-RPC-er), aldri kun i klienten.
-- ============================================================================
-- ------------------------------------------------------------

-- Policyene avhenger av tilgangsfunksjonene, så de må vike før funksjonene som
-- endrer signatur/semantikk kan droppes. Alle gjenopprettes i del 7.
drop policy if exists universes_select on public.universes;
drop policy if exists universes_insert on public.universes;
drop policy if exists universes_update on public.universes;
drop policy if exists universes_delete on public.universes;
drop policy if exists groups_select on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
drop policy if exists groups_delete on public.groups;
drop policy if exists cards_select on public.cards;
drop policy if exists cards_insert on public.cards;
drop policy if exists cards_update on public.cards;
drop policy if exists cards_delete on public.cards;
drop policy if exists items_select on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
drop policy if exists ideas_select on public.ideas;
drop policy if exists ideas_insert on public.ideas;
drop policy if exists ideas_update on public.ideas;
drop policy if exists ideas_delete on public.ideas;
drop policy if exists note_projects_select on public.note_projects;
drop policy if exists note_projects_insert on public.note_projects;
drop policy if exists note_projects_update on public.note_projects;
drop policy if exists note_projects_delete on public.note_projects;
drop policy if exists note_folders_select on public.note_folders;
drop policy if exists note_folders_insert on public.note_folders;
drop policy if exists note_folders_update on public.note_folders;
drop policy if exists note_folders_delete on public.note_folders;
drop policy if exists notes_select on public.notes;
drop policy if exists notes_insert on public.notes;
drop policy if exists notes_update on public.notes;
drop policy if exists notes_delete on public.notes;
drop policy if exists object_links_select on public.object_links;
drop policy if exists object_links_insert on public.object_links;
drop policy if exists object_links_delete on public.object_links;
drop policy if exists memberships_select on public.memberships;
drop policy if exists memberships_update on public.memberships;
drop policy if exists memberships_delete on public.memberships;

-- Pensjonerte funksjoner fra oppretter-modellen. «Administrator» finnes ikke
-- lenger som begrep: full myndighet kommer utelukkende fra eierroller.
drop function if exists public.can_admin_resource(text, uuid, uuid);
drop function if exists public.resource_owner(text, uuid);
drop function if exists public.resource_creator(text, uuid);
drop function if exists public.resource_universe_owner(text, uuid);
drop function if exists public.can_edit_universe(uuid, uuid);
drop function if exists public.can_edit_group(uuid, uuid);
drop function if exists public.can_edit_card(uuid, uuid);
drop function if exists public.effective_lock_source(text, uuid);
drop function if exists public.inherited_lock_source(text, uuid);
drop function if exists public.effective_invite_source(text, uuid);
drop function if exists public.inherited_invite_source(text, uuid);
-- Invitasjoner har fått en ROLLE-parameter. Den gamle 3-argumentsvarianten må
-- vekk, ellers blir et 3-argumentskall tvetydig (og ville sluppet unna
-- rolle-autorisasjonen).
drop function if exists public.create_share_invite(text, uuid, text);

-- Intern «privilegert operasjon»-kontekst: settes KUN av SECURITY DEFINER-
-- RPC-ene under (rolleendring, mappeflytting, import) og leses av vaktene, så
-- kolonner som ellers er uforanderlige for klienter kan skrives der reglene
-- allerede ER kontrollert. Transaksjonslokal (`set_config(..., true)`), så den
-- kan ikke lekke til neste forespørsel i samme tilkobling.
create or replace function public.in_privileged_op()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('huskis.privileged_op', true), '') = '1';
$$;

-- ---- Roller ----

create or replace function public.universe_role(p_universe uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
   where m.universe_id = p_universe and m.user_id = p_uid;
$$;

-- DIREKTE rolle på mappen (arvet områderolle telles ikke med her).
create or replace function public.group_role(p_group uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
   where m.group_id = p_group and m.user_id = p_uid;
$$;

create or replace function public.group_universe(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select universe_id from public.groups where id = p_group;
$$;

create or replace function public.is_universe_owner(p_universe uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.universe_id = p_universe and m.user_id = p_uid and m.role = 'owner');
$$;

create or replace function public.is_universe_member(p_universe uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.universe_id = p_universe and m.user_id = p_uid);
$$;

-- EFFEKTIV mappeeier: eksplisitt mappeeierrolle ELLER områdeeier (dynamisk
-- supereier — trenger ingen egen mapperad).
create or replace function public.is_group_owner(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.group_id = p_group and m.user_id = p_uid and m.role = 'owner')
      or public.is_universe_owner(public.group_universe(p_group), p_uid);
$$;

-- EFFEKTIVT mappemedlemskap: direkte mapperolle ELLER en hvilken som helst
-- områderolle på mappens kanoniske område.
create or replace function public.is_group_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                  where m.group_id = p_group and m.user_id = p_uid)
      or public.is_universe_member(public.group_universe(p_group), p_uid);
$$;

-- Antall områdeeiere — grunnlaget for siste-eier-invarianten og for om
-- rollen heter «Eier» eller «Medeiere».
create or replace function public.universe_owner_count(p_universe uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.memberships m
   where m.universe_id = p_universe and m.role = 'owner';
$$;

-- Eierskapsdomenet til et område: det NÅVÆRENDE, dedupliserte settet av
-- områdeeiere, sortert så to områder kan sammenlignes direkte. To områder
-- er i samme domene når settene er identiske (se move_group).
create or replace function public.universe_owner_set(p_universe uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
    from public.memberships m
   where m.universe_id = p_universe and m.role = 'owner';
$$;

-- ---- Lesetilgang ----
-- Området leses KUN av områdemedlemmer: en direkte mappemottaker uten
-- områderolle skal aldri se områdets navn eller medlemsliste.

create or replace function public.can_read_universe(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_universe_member(p_id, p_uid);
$$;

create or replace function public.can_read_group(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = p_id)
     and public.is_group_member(p_id, p_uid);
$$;

create or replace function public.can_read_card(p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_group((select group_id from public.cards where id = p_id), p_uid);
$$;

create or replace function public.can_read(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'universe' then public.can_read_universe(p_id, p_uid)
    when 'group'    then public.can_read_group(p_id, p_uid)
    when 'card'     then public.can_read_card(p_id, p_uid)
    when 'item'     then public.can_read_card((select card_id from public.items where id = p_id), p_uid)
  end, false);
$$;

-- Området et objekt av vilkårlig type hører til.
create or replace function public.resource_universe(p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then p_id
    when 'group'    then (select universe_id from public.groups where id = p_id)
    when 'card'     then (select g.universe_id from public.cards c
                          join public.groups g on g.id = c.group_id where c.id = p_id)
    when 'item'     then (select g.universe_id from public.items i
                          join public.cards c on c.id = i.card_id
                          join public.groups g on g.id = c.group_id where i.id = p_id)
  end;
$$;

-- Mappen et objekt av vilkårlig type hører til (null for områder).
create or replace function public.resource_group(p_type text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_type
    when 'group' then p_id
    when 'card'  then (select group_id from public.cards where id = p_id)
    when 'item'  then (select c.group_id from public.items i
                       join public.cards c on c.id = i.card_id where i.id = p_id)
  end;
$$;

-- PRIVILEGERT = eier på det nivået som styrer objektet: områdeeier for et
-- område, mappeeier (eksplisitt eller områdeeier) for mappe/liste/listepunkt.
-- Privilegerte påvirkes ALDRI av en lås for egen redigering.
create or replace function public.is_privileged(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then public.is_universe_owner(p_id, p_uid)
    else coalesce(public.is_group_owner(public.resource_group(p_type, p_id), p_uid), false)
  end;
$$;

-- ---- Låser (tretilstand: eksplisitt låst / eksplisitt unntak / arv) ----
-- Nærmeste eksplisitte tilstand fra objektet og oppover avgjør. 0 rader = åpen.
-- Listepunkter har ingen egen lås → følger listen sin.

create or replace function public.effective_lock_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, is_locked boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_card uuid; v_group uuid; v_universe uuid;
  r record; vlocked boolean; vunlocked boolean;
begin
  if p_type = 'item' then select card_id into v_card from public.items where id = p_id;
  elsif p_type = 'card' then v_card := p_id;
  elsif p_type = 'group' then v_group := p_id;
  elsif p_type = 'universe' then v_universe := p_id;
  end if;
  if v_card is not null then select group_id into v_group from public.cards where id = v_card; end if;
  if v_group is not null then select universe_id into v_universe from public.groups where id = v_group; end if;

  for r in
    select * from (values (1, 'card', v_card), (2, 'group', v_group), (3, 'universe', v_universe))
      as ch(depth, t, id)
    where ch.id is not null order by ch.depth
  loop
    if r.t = 'card' then select locked, unlocked into vlocked, vunlocked from public.cards where id = r.id;
    elsif r.t = 'group' then select locked, unlocked into vlocked, vunlocked from public.groups where id = r.id;
    else select locked, unlocked into vlocked, vunlocked from public.universes where id = r.id;
    end if;
    if vlocked or vunlocked then
      src_type := r.t; src_id := r.id; is_locked := vlocked;
      return next; return;
    end if;
  end loop;
  return;
end;
$$;

create or replace function public.is_effectively_locked(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.is_locked from public.effective_lock_source(p_type, p_id) s), false);
$$;

-- Nærmeste eksplisitte lås blant objektets STRENGE superobjekter — grunnlaget
-- for «hvem kan gjøre unntak fra en ARVET lås».
create or replace function public.inherited_lock_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, is_locked boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_pt text; v_pid uuid;
begin
  if p_type = 'card' then v_pt := 'group'; select group_id into v_pid from public.cards where id = p_id;
  elsif p_type = 'group' then v_pt := 'universe'; select universe_id into v_pid from public.groups where id = p_id;
  elsif p_type = 'item' then v_pt := 'card'; select card_id into v_pid from public.items where id = p_id;
  else return; end if;
  return query select * from public.effective_lock_source(v_pt, v_pid);
end;
$$;

-- Hvem kan opprette/fjerne et UNNTAK fra en ARVET lås:
--   * områdeeiere alltid (også fra en områdelås — bare de kan åpne den);
--   * er den arvede låsen satt på en MAPPE, kan også en EKSPLISITT mappeeier
--     der styre unntaket for lister under mappen.
-- En mappeeier kan altså ikke åpne grenen for andre i strid med en områdelås.
-- Finnes det INGEN arvet lås, er «unntak» bare en overflødig flaggverdi (den
-- gjør ingenting) — da kan den som ellers styrer objektets lås rydde den bort,
-- f.eks. etter at låsen over er fjernet.
create or replace function public.can_manage_lock_exception(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_universe_owner(public.resource_universe(p_type, p_id), p_uid)
      or exists (
        select 1 from public.inherited_lock_source(p_type, p_id) s
        join public.memberships m on m.group_id = s.src_id and m.user_id = p_uid and m.role = 'owner'
        where s.is_locked and s.src_type = 'group')
      or (not exists (select 1 from public.inherited_lock_source(p_type, p_id) s where s.is_locked)
          and public.is_privileged(p_type, p_id, p_uid));
$$;

-- ---- Invitasjonspolicy (kun områder og mapper) ----

create or replace function public.effective_invite_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, pol text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_group uuid; v_universe uuid; r record; vpol text;
begin
  if p_type = 'group' then v_group := p_id;
  elsif p_type = 'universe' then v_universe := p_id;
  else return; end if;
  if v_group is not null then select universe_id into v_universe from public.groups where id = v_group; end if;

  for r in
    select * from (values (1, 'group', v_group), (2, 'universe', v_universe))
      as ch(depth, t, id)
    where ch.id is not null order by ch.depth
  loop
    if r.t = 'group' then select invite_policy into vpol from public.groups where id = r.id;
    else select invite_policy into vpol from public.universes where id = r.id;
    end if;
    if vpol in ('allow', 'deny') then
      src_type := r.t; src_id := r.id; pol := vpol; return next; return;
    end if;
  end loop;
  return;
end;
$$;

create or replace function public.effective_invite_policy(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.pol = 'allow' from public.effective_invite_source(p_type, p_id) s), true);
$$;

create or replace function public.inherited_invite_source(p_type text, p_id uuid)
returns table(src_type text, src_id uuid, pol text)
language plpgsql stable security definer set search_path = public as $$
declare v_pid uuid;
begin
  if p_type <> 'group' then return; end if;
  select universe_id into v_pid from public.groups where id = p_id;
  return query select * from public.effective_invite_source('universe', v_pid);
end;
$$;

-- ---- Capabilities ----

-- Endre objektets INNHOLD (navn/tekst/tidsplan/avkryssing/trashed …).
-- Lesetilgang + (privilegert ELLER ikke effektivt låst).
create or replace function public.can_edit_content(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read(p_type, p_id, p_uid)
     and (public.is_privileged(p_type, p_id, p_uid)
          or not public.is_effectively_locked(p_type, p_id));
$$;

-- Opprette subobjekter (mappe i område, liste i mappe, listepunkt i liste):
-- samme rett som å endre forelderens innhold.
create or replace function public.can_create_child(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_content(p_type, p_id, p_uid);
$$;

-- Endre objektets POSISJON blant søsken. Posisjonen tilhører FORELDERENS
-- organisering, så den styres av retten til å redigere forelderens innhold —
-- ikke av objektets egen lås. Områdets toppnivåposisjon er PERSONLIG
-- (memberships.pos) og krever bare medlemskap.
create or replace function public.can_reorder_in_parent(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'universe' then public.is_universe_member(p_id, p_uid)
    when 'group'    then public.can_edit_content('universe', (select universe_id from public.groups where id = p_id), p_uid)
    when 'card'     then public.can_edit_content('group',    (select group_id    from public.cards  where id = p_id), p_uid)
    when 'item'     then public.can_edit_content('card',     (select card_id     from public.items  where id = p_id), p_uid)
  end, false);
$$;

-- Slette objektet FOR ALLE (felles søppel / permanent tømming).
--   * område: kun områdeeiere
--   * mappe:  mappeeiere, ELLER et områdeMEDLEM når mappen er effektivt åpen
--              (et rent direkte mappemedlem kan aldri slette mappen)
--   * liste/listepunkt: mappeeiere, ELLER enhver med lesetilgang når objektet
--              er effektivt åpent
create or replace function public.can_delete_object(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'universe' then public.is_universe_owner(p_id, p_uid)
    when 'group' then public.is_group_owner(p_id, p_uid)
      or (public.is_universe_member(public.group_universe(p_id), p_uid)
          and not public.is_effectively_locked('group', p_id))
    else public.is_privileged(p_type, p_id, p_uid)
      or (public.can_read(p_type, p_id, p_uid)
          and not public.is_effectively_locked(p_type, p_id))
  end, false);
$$;

-- Forlate objektet (fjerner KUN egen tilgang, aldri innhold).
--   * område: må ha en rolle; siste eier kan ikke forlate
--   * mappe:  den direkte mapperollen må være ENESTE vei inn. Har man i
--              tillegg en rolle i mappens område, mister man ingen tilgang av
--              å gi fra seg mapperaden — områdetilgangen forlates i OMRÅDET,
--              ikke i mappen, og en overflødig mappeeierrolle gis fra seg med
--              «Tre av som medeier» i mappens delemodal. Uten dette leddet fikk
--              en områdeeier med en gammel eksplisitt mappeeierrad (f.eks. fra
--              rolle-backfill-en, som gjorde mappens oppretter til mappeeier
--              før vedkommende ble områdeeier) en forlat-knapp som ikke
--              forlot noe: raden ble slettet, tilgangen besto, og mappen kom
--              rett tilbake ved neste synk.
create or replace function public.can_leave(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then public.universe_role(p_id, p_uid) is not null
      and (public.universe_role(p_id, p_uid) <> 'owner' or public.universe_owner_count(p_id) > 1)
    when 'group' then public.group_role(p_id, p_uid) is not null
      and public.universe_role(public.group_universe(p_id), p_uid) is null
    else false
  end;
$$;

-- Administrere DIREKTE medlemmer (kaste ut) og EIERSKAP (invitere/degradere/
-- fjerne eiere), samt innstillinger, lås og invitasjonspolicy på nivået.
create or replace function public.can_manage_members(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'universe' then public.is_universe_owner(p_id, p_uid)
    when 'group'    then public.is_group_owner(p_id, p_uid)
    else false
  end;
$$;

-- Invitere VANLIGE medlemmer: eier på nivået, ELLER et effektivt medlem når
-- effektiv invitasjonspolicy tillater det.
create or replace function public.can_invite_to(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_members(p_type, p_id, p_uid)
      or (public.can_read(p_type, p_id, p_uid)
          and p_type in ('universe', 'group')
          and public.effective_invite_policy(p_type, p_id));
$$;

-- Invitere til EIERSKAP — aldri gjennom invitasjonspolicy; kun eiere på nivået.
create or replace function public.can_invite_owner(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_members(p_type, p_id, p_uid);
$$;

-- Låse/åpne objektet for andre. Området: områdeeiere. Mappe/liste:
-- mappeeiere (eksplisitte + områdeeiere).
create or replace function public.can_manage_lock(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_privileged(p_type, p_id, p_uid);
$$;

-- Endre objektets eksplisitte invitasjonspolicy. Under en arvet 'deny' fra
-- området kan bare områdeeiere gjøre et 'allow'-unntak på mappen.
create or replace function public.can_manage_invite_policy(p_type text, p_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.inherited_invite_source(p_type, p_id) s where s.pol = 'deny')
      then public.is_universe_owner(public.resource_universe(p_type, p_id), p_uid)
    else public.can_manage_members(p_type, p_id, p_uid)
  end;
$$;

-- Flytte mappen ut av området sitt: destruktiv myndighet i KILDEN. Ren
-- redigeringsrett holder ikke (se move_group, som i tillegg krever
-- opprettelsesrett i MÅLET).
create or replace function public.can_move_group(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_delete_object('group', p_group, p_uid);
$$;

-- ---- Delingsstatus ----
-- «Aktivt delt» = mer enn ÉN bruker har effektiv tilgang. Ventende invitasjoner
-- teller ikke. For en mappe er det den DEDUPLISERTE unionen av områderoller
-- og direkte mapperoller.

create or replace function public.universe_member_count(p_universe uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.memberships m where m.universe_id = p_universe;
$$;

create or replace function public.group_member_count(p_group uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from (
    select m.user_id from public.memberships m where m.universe_id = public.group_universe(p_group)
    union
    select m.user_id from public.memberships m where m.group_id = p_group
  ) s;
$$;

-- ---- Capability-pakker til klienten ----
-- Serveren er autoritativ; klienten gate-r kontroller på nøyaktig disse.

create or replace function public.universe_caps(p_id uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'read',              public.can_read_universe(p_id, p_uid),
    'editContent',       public.can_edit_content('universe', p_id, p_uid),
    'createGroup',       public.can_create_child('universe', p_id, p_uid),
    'reorderGroups',     public.can_edit_content('universe', p_id, p_uid),
    'manageSettings',    public.can_manage_members('universe', p_id, p_uid),
    'delete',            public.can_delete_object('universe', p_id, p_uid),
    'leave',             public.can_leave('universe', p_id, p_uid),
    'invite',            public.can_invite_to('universe', p_id, p_uid),
    'inviteOwner',       public.can_invite_owner('universe', p_id, p_uid),
    'manageMembers',     public.can_manage_members('universe', p_id, p_uid),
    'manageOwners',      public.can_manage_members('universe', p_id, p_uid),
    'manageLock',        public.can_manage_lock('universe', p_id, p_uid),
    'lockException',     public.can_manage_lock_exception('universe', p_id, p_uid),
    'managePolicy',      public.can_manage_invite_policy('universe', p_id, p_uid),
    'locked',            public.is_effectively_locked('universe', p_id));
$$;

create or replace function public.group_caps(p_id uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'read',              public.can_read_group(p_id, p_uid),
    'editContent',       public.can_edit_content('group', p_id, p_uid),
    'createList',        public.can_create_child('group', p_id, p_uid),
    'reorderInParent',   public.can_reorder_in_parent('group', p_id, p_uid),
    'manageSettings',    public.can_manage_members('group', p_id, p_uid),
    'delete',            public.can_delete_object('group', p_id, p_uid),
    'move',              public.can_move_group(p_id, p_uid),
    'leave',             public.can_leave('group', p_id, p_uid),
    'invite',            public.can_invite_to('group', p_id, p_uid),
    'inviteOwner',       public.can_invite_owner('group', p_id, p_uid),
    'manageMembers',     public.can_manage_members('group', p_id, p_uid),
    'manageOwners',      public.can_manage_members('group', p_id, p_uid),
    'manageLock',        public.can_manage_lock('group', p_id, p_uid),
    'lockException',     public.can_manage_lock_exception('group', p_id, p_uid),
    'managePolicy',      public.can_manage_invite_policy('group', p_id, p_uid),
    'locked',            public.is_effectively_locked('group', p_id));
$$;

-- ------------------------------------------------------------
-- 6. VAKT- OG LWW-TRIGGERE (BEFORE INSERT/UPDATE/DELETE)
--    * owner_id (oppretter) er uforanderlig og gir ingen rettigheter.
--    * locked/unlocked/invite_policy er priviligerte kolonner — endres kun av
--      rett autoritet, ellers RAISES (aldri via rå PostgREST av uvedkommende).
--    * INNHOLDS-felt reverteres uten can_edit_content ELLER med eldre register.
--    * POSISJON (pos + forelder-peker) reverteres uten can_reorder_in_parent
--      ELLER med eldre register — skilt fra innholdslåsen.
--    * `groups.universe_id` kan IKKE endres med en vanlig skriving: mappeflytting
--      går gjennom move_group() (atomisk, med domenekontroll).
--    * Et område har alltid minst én eier (memberships-vaktene).
--    * auth.uid() is null = admin/psql (vedlikehold) → hopper over autorisasjon
--      (kun LWW gjelder).
-- ------------------------------------------------------------

create or replace function public.reg_newer(a_ts bigint, a_org text, b_ts bigint, b_org text)
returns boolean language sql immutable as $$
  select coalesce(a_ts, 0) > coalesce(b_ts, 0)
      or (coalesce(a_ts, 0) = coalesce(b_ts, 0) and coalesce(a_org, '') > coalesce(b_org, ''));
$$;

-- ---- Eierrolle ved opprettelse ----
-- Den som oppretter et område blir områdeeier; den som oppretter en mappe blir
-- eksplisitt mappeeier — MEN ikke hvis vedkommende allerede er områdeeier
-- (da er rollen arvet og en egen rad ville bare duplisert medlemslisten).
create or replace function public.universes_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (user_id, universe_id, role, pos)
  values (new.owner_id, new.id, 'owner', coalesce(new.pos, 0))
  on conflict (universe_id, user_id) where universe_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists universes_owner_seed on public.universes;
create trigger universes_owner_seed after insert on public.universes
  for each row execute function public.universes_after_insert();

create or replace function public.groups_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_universe_owner(new.universe_id, new.owner_id) then return new; end if;
  insert into public.memberships (user_id, group_id, role, pos)
  values (new.owner_id, new.id, 'owner', coalesce(new.pos, 0))
  on conflict (group_id, user_id) where group_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists groups_owner_seed on public.groups;
create trigger groups_owner_seed after insert on public.groups
  for each row execute function public.groups_after_insert();

-- ---- Objekt-vakter ----

create or replace function public.universes_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  -- Oppretteren er uforanderlig for klienter. Unntaket er en privilegert
  -- operasjon: kontosletting lar en gjenværende eier ARVE oppretterfeltet, for
  -- FK-en er `on delete cascade` og ville ellers tatt andres innhold med seg.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('universe', old.id, uid);
    can_reorder := public.can_reorder_in_parent('universe', old.id, uid);
  end if;
  if new.locked is distinct from old.locked and uid is not null
     and not public.can_manage_lock('universe', old.id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null
     and not public.can_manage_lock_exception('universe', old.id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if new.invite_policy is distinct from old.invite_policy and uid is not null
     and not public.can_manage_invite_policy('universe', old.id, uid) then
    raise exception 'mangler myndighet til å endre invitasjonspolicy';
  end if;
  -- Sletting/gjenoppretting av HELE området (felles søppel) er en eierhandling.
  if new.trashed is distinct from old.trashed and uid is not null
     and not public.can_delete_object('universe', old.id, uid) then
    raise exception 'mangler myndighet til å slette området';
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed;
    new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists universes_guard on public.universes;
create trigger universes_guard before update on public.universes
  for each row execute function public.universes_before_update();

create or replace function public.groups_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('group', old.id, uid);
    can_reorder := public.can_reorder_in_parent('group', old.id, uid);
  end if;
  if new.locked is distinct from old.locked and uid is not null
     and not public.can_manage_lock('group', old.id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null
     and not public.can_manage_lock_exception('group', old.id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if new.invite_policy is distinct from old.invite_policy and uid is not null
     and not public.can_manage_invite_policy('group', old.id, uid) then
    raise exception 'mangler myndighet til å endre invitasjonspolicy';
  end if;
  -- Å slette en mappe FOR ALLE krever destruktiv myndighet (mappeeier, eller
  -- et områdemedlem når mappen er effektivt åpen) — ikke bare redigeringsrett.
  if new.trashed is distinct from old.trashed and uid is not null
     and not public.can_delete_object('group', old.id, uid) then
    raise exception 'mangler myndighet til å slette mappen';
  end if;
  -- Mappen bytter område KUN via move_group(): den avgjør eierskapsdomene,
  -- kontrollerer rettigheter i både kilde og mål, og gjør alt i én transaksjon.
  if new.universe_id is distinct from old.universe_id and not public.in_privileged_op() then
    raise exception using
      errcode = '42501',
      message = 'mapper flyttes mellom områder med move_group()';
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed;
    new.is_cat := old.is_cat; new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.universe_id := old.universe_id;   -- forelder følger posisjonsregisteret
    new.cat_id := old.cat_id;             -- … og mappekategori-medlemskapet
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists groups_guard on public.groups;
create trigger groups_guard before update on public.groups
  for each row execute function public.groups_before_update();

create or replace function public.cards_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  -- Se universes_before_update: kun kontosletting arver oppretterfeltet.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('card', old.id, uid);
    can_reorder := public.can_reorder_in_parent('card', old.id, uid);
  end if;
  if new.locked is distinct from old.locked and uid is not null
     and not public.can_manage_lock('card', old.id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if new.unlocked is distinct from old.unlocked and uid is not null
     and not public.can_manage_lock_exception('card', old.id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if new.group_id is distinct from old.group_id and uid is not null then
    -- Flytting av en liste mellom mapper krever rettigheter i BÅDE kilde og mål.
    if not public.can_edit_content('group', old.group_id, uid) then
      raise exception 'mangler tilgang til kilde-mappen';
    end if;
    if not public.can_create_child('group', new.group_id, uid) then
      raise exception 'mangler tilgang til mål-mappen';
    end if;
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.title := old.title; new.trashed := old.trashed;
    new.responsible := old.responsible;
    new.start_at := old.start_at; new.due_at := old.due_at; new.lock_times := old.lock_times;
    new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.lab_ts, new.lab_org, old.lab_ts, old.lab_org) then
    new.k := old.k; new.p := old.p;
    new.lab_ts := old.lab_ts; new.lab_org := old.lab_org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.group_id := old.group_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cards_guard on public.cards;
create trigger cards_guard before update on public.cards
  for each row execute function public.cards_before_update();

create or replace function public.items_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); can_content boolean := true; can_reorder boolean := true;
begin
  -- Se universes_before_update: kun kontosletting arver oppretterfeltet.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if uid is not null then
    can_content := public.can_edit_content('item', old.id, uid);
    can_reorder := public.can_reorder_in_parent('item', old.id, uid);
  end if;
  if new.card_id is distinct from old.card_id and uid is not null then
    if not public.can_edit_content('card', old.card_id, uid) then
      raise exception 'mangler tilgang til kilde-listen';
    end if;
    if not public.can_create_child('card', new.card_id, uid) then
      raise exception 'mangler tilgang til mål-listen';
    end if;
  end if;
  if (uid is not null and not can_content and not public.in_privileged_op())
     or not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.text := old.text; new.trashed := old.trashed; new.done := old.done;
    new.responsible := old.responsible;
    new.start_at := old.start_at; new.due_at := old.due_at;
    new.is_cat := old.is_cat; new.lock_times := old.lock_times; new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if (uid is not null and not can_reorder and not public.in_privileged_op())
     or not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.card_id := old.card_id; new.cat_id := old.cat_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_guard on public.items;
create trigger items_guard before update on public.items
  for each row execute function public.items_before_update();

-- Idéer: samme felt-nivå-LWW som listepunkter, men uten capability-spørsmål —
-- RLS har allerede avgjort at raden er MIN. Igjen står bare registrene: en
-- eldre skriving skal aldri kunne overskrive en nyere fra en annen enhet.
create or replace function public.ideas_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Se universes_before_update: kun kontosletting arver oppretterfeltet.
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.text := old.text; new.trashed := old.trashed;
    new.is_cat := old.is_cat; new.collapsed := old.collapsed;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.cat_id := old.cat_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ideas_guard on public.ideas;
create trigger ideas_guard before update on public.ideas
  for each row execute function public.ideas_before_update();

-- Notater: samme felt-nivå-LWW som idéene, og av samme grunn uten
-- capability-spørsmål — RLS har allerede avgjort at raden er MIN. Igjen står
-- registrene: en eldre skriving skal aldri kunne overskrive en nyere fra en
-- annen enhet. Forelder-pekerne (`project_id`/`folder_id`) rir på
-- posisjonsregisteret, som `card_id`/`cat_id` på et listepunkt.
create or replace function public.note_projects_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed; new.collapsed := old.collapsed;
    new.archived := old.archived;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.note_folders_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.name := old.name; new.trashed := old.trashed; new.archived := old.archived;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.project_id := old.project_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- Notatets to forelder-pekere kan ikke motsi hverandre ----
-- `notes` har to uavhengige fremmednøkler: `project_id` (bokhyllen) og
-- `folder_id` (notatboken). RLS sier at BEGGE er mine, men ikke at de hører
-- sammen — uten dette kunne den samme brukeren lagre et notat som peker på
-- bokhylle A og en notatbok som står i bokhylle B. Det er ikke bare rotete:
-- `project_id` har ON DELETE CASCADE, så en slik rad ville blitt SLETTET når
-- bokhylle A forsvant, selv om notatet vises under en notatbok i bokhylle B.
--
-- INVARIANTEN: ligger notatet i en notatbok, er bokhyllen notatbokens.
-- Den HÅNDHEVES ved å utlede `project_id`, ikke ved å avvise: klienten skriver
-- rad for rad gjennom PostgREST (hver skriving sin egen transaksjon), så en
-- avvisning ville gjort rekkefølgen mellom to uavhengige HTTP-kall til en del
-- av kontrakten. Utledningen gir det samme svaret uansett rekkefølge, og er
-- nøyaktig den samme regelen klienten leser med (`pruneNoteParents`: mappens
-- prosjekt vinner). Et notat UTEN notatbok beholder sin egen bokhylle.
create or replace function public.notes_fix_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  if new.folder_id is null then
    return new;
  end if;
  select f.project_id into v_project from public.note_folders f where f.id = new.folder_id;
  if v_project is null then
    -- Fremmednøkkelen er DEFERRABLE, så notatboken kan komme senere i samme
    -- transaksjon. Da er det ingenting å utlede av ennå, og fremmednøkkelen
    -- tar den ved commit.
    return new;
  end if;
  new.project_id := v_project;
  return new;
end;
$$;

create or replace function public.notes_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  if new.owner_id is distinct from old.owner_id and not public.in_privileged_op() then
    raise exception 'owner_id (oppretter) kan ikke endres';
  end if;
  if not public.reg_newer(new.ts, new.org, old.ts, old.org) then
    new.title := old.title; new.body := old.body; new.trashed := old.trashed;
    new.archived := old.archived;
    new.ts := old.ts; new.org := old.org;
  end if;
  if not public.reg_newer(new.pos_ts, new.pos_org, old.pos_ts, old.pos_org) then
    new.project_id := old.project_id; new.folder_id := old.folder_id;
    new.pos := old.pos; new.pos_ts := old.pos_ts; new.pos_org := old.pos_org;
  end if;
  -- SIST, på den ferdige raden: LWW-vakten over kan ha rullet tilbake den ene
  -- av de to pekerne, og invarianten gjelder resultatet.
  if new.folder_id is not null then
    select f.project_id into v_project from public.note_folders f where f.id = new.folder_id;
    if v_project is not null then new.project_id := v_project; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Flyttes en NOTATBOK til en annen bokhylle, følger notatene med. Klienten gjør
-- det samme lokalt (noteFolderMoved), men serveren kan ikke stole på at den
-- rekker det: enheten kan miste nettet mellom de to skrivingene, og da ville
-- notatene blitt liggende igjen i den gamle bokhyllen — og forsvunnet med den.
--
-- `(pos_ts, pos_org)` ER ETT UDELELIG REGISTER: `reg_newer` sammenligner
-- tidsstempelet først og lar `org` bryte uavgjort. Halvdelene kan derfor ikke
-- plukkes hver for seg — et notat med nyere `pos_ts` enn notatboken ville ellers
-- endt med sitt eget tidsstempel og notatbokens `org`, en kombinasjon som aldri
-- har eksistert, og som kan snu hvem som vinner en senere skriving med likt
-- tidsstempel. Hele paret velges derfor atomisk: er notatbokens register nyere,
-- kopieres BEGGE feltene; ellers beholdes BEGGE. `project_id` følger
-- notatbokens bokhylle uansett — det er invarianten, ikke et register.
create or replace function public.note_folders_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    update public.notes n
       set project_id = new.project_id,
           pos_ts  = case when public.reg_newer(new.pos_ts, new.pos_org, n.pos_ts, n.pos_org)
                          then new.pos_ts else n.pos_ts end,
           pos_org = case when public.reg_newer(new.pos_ts, new.pos_org, n.pos_ts, n.pos_org)
                          then new.pos_org else n.pos_org end
     where n.folder_id = new.id
       and n.project_id is distinct from new.project_id;
  end if;
  return null;
end;
$$;

drop trigger if exists note_projects_guard on public.note_projects;
create trigger note_projects_guard before update on public.note_projects
  for each row execute function public.note_projects_before_update();
drop trigger if exists note_folders_guard on public.note_folders;
create trigger note_folders_guard before update on public.note_folders
  for each row execute function public.note_folders_before_update();
drop trigger if exists notes_guard on public.notes;
create trigger notes_guard before update on public.notes
  for each row execute function public.notes_before_update();
-- Navnet er valgt slik at den kjører ETTER `notes_insert_guard` (BEFORE-
-- triggere fyrer i navnerekkefølge): gravsteinsvakten skal få avvise en
-- gjenoppstanden rad før vi begynner å utlede foreldre for den.
drop trigger if exists notes_parent_guard on public.notes;
create trigger notes_parent_guard before insert on public.notes
  for each row execute function public.notes_fix_parent();
drop trigger if exists note_folders_cascade on public.note_folders;
create trigger note_folders_cascade after update on public.note_folders
  for each row execute function public.note_folders_after_update();

-- ---- Medlemskaps-/rolle-vakter ----
-- Rollen er MUTABEL, men kun gjennom set_member_role()/accept_share_invite()
-- (som setter privilegert kontekst etter å ha kontrollert myndigheten). En rå
-- PostgREST-oppdatering kan bare endre sin EGEN personlige posisjon.
create or replace function public.memberships_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id      is distinct from old.user_id
     or new.universe_id is distinct from old.universe_id
     or new.group_id    is distinct from old.group_id then
    raise exception 'medlemskapets objekt/bruker kan ikke endres';
  end if;
  if new.role is distinct from old.role then
    if not public.in_privileged_op() then
      raise exception 'roller endres kun via set_member_role()';
    end if;
    -- SISTE-EIER-INVARIANTEN: et område må alltid ha minst én eier.
    if old.universe_id is not null and old.role = 'owner' and new.role <> 'owner'
       and public.universe_owner_count(old.universe_id) <= 1 then
      raise exception using
        errcode = 'PT422',
        message = 'området må ha minst én eier';
    end if;
  end if;
  if auth.uid() is not null and not public.in_privileged_op()
     and new.user_id <> auth.uid() then
    raise exception 'kan bare endre egen plassering';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists memberships_guard on public.memberships;
create trigger memberships_guard before update on public.memberships
  for each row execute function public.memberships_before_update();

-- Siste-eier-invarianten gjelder også sletting (forlat/kast ut/rå DELETE).
-- Kaskader hoppes over: forsvinner selve området eller brukeren, er det ingen
-- invariant igjen å beskytte.
create or replace function public.memberships_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.universe_id is not null and old.role = 'owner'
     and exists (select 1 from public.universes u where u.id = old.universe_id)
     and exists (select 1 from public.profiles p where p.id = old.user_id)
     and public.universe_owner_count(old.universe_id) <= 1 then
    raise exception using
      errcode = 'PT422',
      message = 'området må ha minst én eier';
  end if;
  return old;
end;
$$;

drop trigger if exists memberships_last_owner_guard on public.memberships;
create trigger memberships_last_owner_guard before delete on public.memberships
  for each row execute function public.memberships_before_delete();

-- ------------------------------------------------------------
-- 7. RLS-POLICYER
-- ------------------------------------------------------------

-- profiles: kun egen rad (medlemslister hentes via get_members-RPC).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- universes
create policy universes_select on public.universes
  for select using (public.can_read_universe(id, auth.uid()));
create policy universes_insert on public.universes
  for insert with check (owner_id = auth.uid());
create policy universes_update on public.universes
  for update using (public.can_edit_content('universe', id, auth.uid())
                    or public.can_reorder_in_parent('universe', id, auth.uid()));
create policy universes_delete on public.universes
  for delete using (public.can_delete_object('universe', id, auth.uid()));

-- groups: opprettelse krever opprettelsesrett i området.
create policy groups_select on public.groups
  for select using (public.can_read_group(id, auth.uid()));
create policy groups_insert on public.groups
  for insert with check (owner_id = auth.uid()
                         and public.can_create_child('universe', universe_id, auth.uid()));
-- Oppdatering tillates når brukeren kan endre INNHOLD ELLER bare POSISJON.
-- Vakten håndhever så feltnivået, så en reorder-only-tilgang ikke kan snike
-- inn låste innholdsfelt.
create policy groups_update on public.groups
  for update using (public.can_edit_content('group', id, auth.uid())
                    or public.can_reorder_in_parent('group', id, auth.uid()));
create policy groups_delete on public.groups
  for delete using (public.can_delete_object('group', id, auth.uid()));

-- cards («lister»)
create policy cards_select on public.cards
  for select using (public.can_read_card(id, auth.uid()));
create policy cards_insert on public.cards
  for insert with check (owner_id = auth.uid()
                         and public.can_create_child('group', group_id, auth.uid()));
create policy cards_update on public.cards
  for update using (public.can_edit_content('card', id, auth.uid())
                    or public.can_reorder_in_parent('card', id, auth.uid()));
create policy cards_delete on public.cards
  for delete using (public.can_delete_object('card', id, auth.uid()));

-- items
create policy items_select on public.items
  for select using (public.can_read_card(card_id, auth.uid()));
create policy items_insert on public.items
  for insert with check (owner_id = auth.uid()
                         and public.can_create_child('card', card_id, auth.uid()));
create policy items_update on public.items
  for update using (public.can_edit_content('item', id, auth.uid())
                    or public.can_reorder_in_parent('item', id, auth.uid()));
create policy items_delete on public.items
  for delete using (public.can_delete_object('item', id, auth.uid()));

-- ideas: kontoens egne idéer og idékategorier. INGEN deling, ingen roller,
-- ingen låser — eierskapet er hele autorisasjonen, og det samme vilkåret
-- gjelder alle fire operasjonene. Skrivevakten (`ideas_before_update`) tar
-- LWW-en; her holder eierskapet.
create policy ideas_select on public.ideas
  for select using (owner_id = auth.uid());
create policy ideas_insert on public.ideas
  for insert with check (owner_id = auth.uid());
create policy ideas_update on public.ideas
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ideas_delete on public.ideas
  for delete using (owner_id = auth.uid());

-- note_projects/note_folders/notes: kontoens egne notater. Som idéene — ingen
-- deling, ingen roller, ingen låser — så eierskapet er hele autorisasjonen, og
-- det samme vilkåret gjelder alle fire operasjonene. Skrivevaktene
-- (`*_before_update`) tar LWW-en; her holder eierskapet. At forelderen er MIN
-- følger av det samme vilkåret på forelderraden: en bruker kan ikke skrive en
-- rad som peker inn i et prosjekt hen ikke eier uten selv å eie raden, og
-- forelderen er uansett usynlig for hen.
-- `(select auth.uid())`, IKKE `auth.uid()`. Bar `auth.uid()` er en volatil
-- funksjon i policy-uttrykket, og planleggeren kan da kalle den PER RAD; pakket
-- i et skalar-subselect blir den en InitPlan som kjøres ÉN gang per statement.
-- Svaret er det samme (økten er den samme gjennom hele statementet), men
-- kostnaden vokser med tabellen — det er nettopp dette Supabases
-- `auth_rls_initplan` peker på. Det gjelder også inne i `exists`-sjekkene.
create policy note_projects_select on public.note_projects
  for select using (owner_id = (select auth.uid()));
create policy note_projects_insert on public.note_projects
  for insert with check (owner_id = (select auth.uid()));
create policy note_projects_update on public.note_projects
  for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy note_projects_delete on public.note_projects
  for delete using (owner_id = (select auth.uid()));

-- Forelderen må være MIN. Uten det kunne en rad hektes inn i et prosjekt/en
-- mappe som tilhører noen andre: raden ville vært usynlig for eieren av
-- forelderen (RLS filtrerer på `owner_id`), men fremmednøkkelen ville bundet
-- forelderen til en rad hen ikke kan se. Vilkåret gjelder både insert og
-- update, slik at en flytting heller ikke kan krysse kontogrensen.
create policy note_folders_select on public.note_folders
  for select using (owner_id = (select auth.uid()));
create policy note_folders_insert on public.note_folders
  for insert with check (owner_id = (select auth.uid())
                         and exists (select 1 from public.note_projects p
                                      where p.id = project_id
                                        and p.owner_id = (select auth.uid())));
create policy note_folders_update on public.note_folders
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.note_projects p
                           where p.id = project_id
                             and p.owner_id = (select auth.uid())));
create policy note_folders_delete on public.note_folders
  for delete using (owner_id = (select auth.uid()));

create policy notes_select on public.notes
  for select using (owner_id = (select auth.uid()));
create policy notes_insert on public.notes
  for insert with check (owner_id = (select auth.uid())
                         and exists (select 1 from public.note_projects p
                                      where p.id = project_id
                                        and p.owner_id = (select auth.uid()))
                         and (folder_id is null
                              or exists (select 1 from public.note_folders f
                                          where f.id = folder_id
                                            and f.owner_id = (select auth.uid()))));
create policy notes_update on public.notes
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.note_projects p
                           where p.id = project_id
                             and p.owner_id = (select auth.uid()))
              and (folder_id is null
                   or exists (select 1 from public.note_folders f
                               where f.id = folder_id
                                 and f.owner_id = (select auth.uid()))));
create policy notes_delete on public.notes
  for delete using (owner_id = (select auth.uid()));

/* object_links: koblingene mine mellom notatsiden og listesiden.

   EIERSKAPET er hele autorisasjonen for å SE og FJERNE en kobling — den er
   min egen krysshenvisning, ikke delt innhold. Å OPPRETTE en krever i tillegg
   to ting av innsettingen, og begge håndheves her fordi klienten kan byttes
   ut:

     1. NOTATSIDEN må være min. Notatene deles ikke, så en kobling fra noen
        andres notat ville vært en peker inn i en konto jeg ikke har noe i.
     2. LISTESIDEN må være LESBAR for meg (`can_read`). En kobling er en
        snarvei, og en snarvei til noe jeg ikke har tilgang til er enten
        støy eller en lekkasje av at objektet finnes.

   Det finnes ingen UPDATE-policy: en kobling har ingen mutable felter. Den
   opprettes og fjernes, og fjerningen etterlater en gravstein.

   `(select auth.uid())` også her, av samme grunn som for notattabellene:
   InitPlan én gang per statement i stedet for ett kall per rad. */
create policy object_links_select on public.object_links
  for select using (owner_id = (select auth.uid()));
create policy object_links_insert on public.object_links
  for insert with check (
    owner_id = (select auth.uid())
    and (note_project_id is null or exists (select 1 from public.note_projects p
                                             where p.id = note_project_id
                                               and p.owner_id = (select auth.uid())))
    and (note_folder_id is null or exists (select 1 from public.note_folders f
                                            where f.id = note_folder_id
                                              and f.owner_id = (select auth.uid())))
    and (note_id is null or exists (select 1 from public.notes n
                                     where n.id = note_id
                                       and n.owner_id = (select auth.uid())))
    and (universe_id is null or public.can_read('universe', universe_id, (select auth.uid())))
    and (group_id is null or public.can_read('group', group_id, (select auth.uid())))
    and (card_id is null or public.can_read('card', card_id, (select auth.uid()))));
create policy object_links_delete on public.object_links
  for delete using (owner_id = (select auth.uid()));

-- memberships: egen rad (personlig posisjon, forlate) + eiere som administrerer
-- medlemslisten. Opprettelse skjer KUN via SECURITY DEFINER-veiene (aksept av
-- invitasjon, opprettelses-triggerne) — INSERT er ikke gitt til authenticated.
create policy memberships_select on public.memberships
  for select using (
    user_id = auth.uid()
    or (universe_id is not null and public.can_manage_members('universe', universe_id, auth.uid()))
    or (group_id is not null and public.can_manage_members('group', group_id, auth.uid()))
  );
create policy memberships_update on public.memberships
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy memberships_delete on public.memberships
  for delete using (
    user_id = auth.uid()
    or (universe_id is not null and public.can_manage_members('universe', universe_id, auth.uid()))
    or (group_id is not null and public.can_manage_members('group', group_id, auth.uid()))
  );

-- share_invites: avsender ser sine; mottaker ser sine (på id eller e-post).
-- Opprettelse/respons kun via RPC-ene.
drop policy if exists share_invites_select on public.share_invites;
create policy share_invites_select on public.share_invites
  for select using (
    inviter_id = auth.uid()
    or invitee_id = auth.uid()
    or lower(invitee_email) = (select lower(email) from public.profiles where id = auth.uid())
  );
drop policy if exists share_invites_delete on public.share_invites;
create policy share_invites_delete on public.share_invites
  for delete using (inviter_id = auth.uid());

-- tombstones: lesbare for innloggede (id-ene er ugjettbare uuid-er);
-- skrives kun av delete-triggerne.
drop policy if exists tombstones_select on public.tombstones;
create policy tombstones_select on public.tombstones
  for select using (auth.uid() is not null);

-- notifications: KUN egne rader — hele veien. Ingen insert-policy: rader lages
-- utelukkende av notify_record() (security definer, som selv setter user_id fra
-- auth.uid()). `with check` på update-en er det som hindrer at en rad kan
-- skyves over på en annen bruker.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- notification_prefs: egen rad, lesbar. Skrives kun av notify_set_prefs()/
-- notify_record() — ingen insert-/update-policy for klienten.
drop policy if exists notification_prefs_select on public.notification_prefs;
create policy notification_prefs_select on public.notification_prefs
  for select using (user_id = auth.uid());

-- push_subscriptions: KUN egne rader, og kun lesing + sletting. Å opprette og
-- fornye et abonnement går gjennom push_subscribe() (security definer, som
-- setter user_id fra auth.uid() selv) — ellers kunne en klient skrevet et
-- abonnement på en annens bruker-id og fått den brukerens varsler sendt til seg.
-- Sletting er «slå av i denne nettleseren», og treffer bare mine egne rader.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 8. DELINGS-RPC-ER (security definer)
--    Deling finnes KUN på områder og mapper. Alt som gjelder lister,
--    listepunkter og kategorier arves.
-- ------------------------------------------------------------

-- Fjerner ALL tilgang en bruker har UNDER et område: områderollen, alle
-- direkte mapperoller i området, ventende invitasjoner til området og
-- mappene, og ansvarstildelinger som peker på brukeren. Brukes av både
-- «forlat» og «kast ut» — en bruker skal aldri sitte igjen med skjult tilgang
-- til en enkeltmappe etter å ha forlatt området.
create or replace function public.purge_universe_access(p_universe uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  perform set_config('huskis.privileged_op', '1', true);
  delete from public.memberships m
   where m.user_id = p_user
     and m.group_id in (select g.id from public.groups g where g.universe_id = p_universe);
  delete from public.memberships m
   where m.user_id = p_user and m.universe_id = p_universe;

  update public.share_invites s
     set status = 'revoked', responded_at = now()
   where s.status = 'pending'
     and (s.invitee_id = p_user
          or lower(s.invitee_email) = (select lower(email) from public.profiles where id = p_user))
     and (s.universe_id = p_universe
          or s.group_id in (select g.id from public.groups g where g.universe_id = p_universe));

  update public.cards c
     set responsible = null, ts = now_ms, org = 'server'
   where c.responsible = p_user
     and c.group_id in (select g.id from public.groups g where g.universe_id = p_universe);
  update public.items i
     set responsible = null, ts = now_ms, org = 'server'
   where i.responsible = p_user
     and i.card_id in (select c.id from public.cards c
                       join public.groups g on g.id = c.group_id
                       where g.universe_id = p_universe);
end;
$$;

-- Fjerner en DIREKTE mapperolle (og ansvarstildelinger, hvis brukeren mister
-- den effektive tilgangen). Rører aldri områdemedlemskap: en områdearvet
-- bruker kan ikke fjernes fra én enkelt mappe.
create or replace function public.purge_group_access(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  perform set_config('huskis.privileged_op', '1', true);
  delete from public.memberships m where m.user_id = p_user and m.group_id = p_group;

  update public.share_invites s
     set status = 'revoked', responded_at = now()
   where s.status = 'pending' and s.group_id = p_group
     and (s.invitee_id = p_user
          or lower(s.invitee_email) = (select lower(email) from public.profiles where id = p_user));

  if not public.is_group_member(p_group, p_user) then
    update public.cards c
       set responsible = null, ts = now_ms, org = 'server'
     where c.responsible = p_user and c.group_id = p_group;
    update public.items i
       set responsible = null, ts = now_ms, org = 'server'
     where i.responsible = p_user
       and i.card_id in (select c.id from public.cards c where c.group_id = p_group);
  end if;
end;
$$;

-- Inviterer en e-postadresse til et OMRÅDE eller en MAPPE.
--   * p_role = 'member' → vanlig medlemsinvitasjon: eier på nivået, ELLER et
--     effektivt medlem når invitasjonspolicyen tillater videreinvitasjon.
--   * p_role = 'owner'  → EIERSKAPS-invitasjon: kun eiere på nivået. En vanlig
--     invitasjonspolicy gir aldri rett til å invitere eiere.
-- Mottakeren trenger ikke ha konto ennå. Redundante MEDLEMS-invitasjoner
-- (mottakeren har allerede effektiv tilgang) avvises; en EIER-invitasjon til en
-- som allerede har tilgang er derimot gyldig — det er nettopp rolleløftet.
create or replace function public.create_share_invite(
  p_type text, p_id uuid, p_email text, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  em     text := lower(trim(p_email));
  target uuid;
  inv    public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then
    raise exception 'kun områder og mapper kan deles (fikk: %)', p_type;
  end if;
  if p_role not in ('member', 'owner') then raise exception 'ugyldig rolle: %', p_role; end if;
  if em = '' or position('@' in em) = 0 then
    raise exception 'ugyldig e-postadresse';
  end if;
  if p_role = 'owner' then
    if not public.can_invite_owner(p_type, p_id, uid) then
      raise exception 'bare eiere kan invitere til eierskap';
    end if;
  elsif not public.can_invite_to(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å invitere til dette objektet';
  end if;
  if em = (select lower(email) from public.profiles where id = uid) then
    raise exception 'kan ikke dele med deg selv';
  end if;

  select id into target from public.profiles where lower(email) = em;

  if target is not null then
    if p_role = 'member' and public.can_read(p_type, p_id, target) then
      raise exception 'brukeren har allerede tilgang';
    end if;
    if p_role = 'owner' and
       ((p_type = 'universe' and public.is_universe_owner(p_id, target))
        or (p_type = 'group' and public.is_group_owner(p_id, target))) then
      raise exception 'brukeren er allerede eier';
    end if;
  end if;

  -- Finnes det alt en VENTENDE invitasjon til samme person og objekt, er den
  -- riktige handlingen å oppdatere den, ikke å feile: å invitere et vanlig
  -- medlem til eierskap går nettopp via en (ny) invitasjon, og den samme
  -- personen kan allerede ha en ventende medlemsinvitasjon liggende. Vi lar
  -- rollen bare gå OPP (member → owner), så en ny medlemsinvitasjon ikke
  -- stille degraderer en eierinvitasjon som ligger og venter.
  -- `inviter_id` er ikke bare sporingsdata: den gir rett til å trekke tilbake
  -- invitasjonen (`revoke_share_invite`, og delete-policyen på tabellen). Et
  -- vanlig medlem som har lov til å invitere MEDLEMMER skal derfor ikke kunne
  -- overta en ventende EIER-invitasjon ved å sende en medlemsinvitasjon til den
  -- samme adressen — da ville det fått makt over en invitasjon det aldri kunne
  -- opprettet. Avsenderen overtas bare når kalleren selv er autorisert for
  -- rollen invitasjonen ender opp med.
  if p_type = 'universe' then
    insert into public.share_invites (inviter_id, invitee_email, invitee_id, universe_id, role)
    values (uid, em, target, p_id, p_role)
    on conflict (universe_id, lower(invitee_email)) where status = 'pending' and universe_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.share_invites.role end,
                    inviter_id = case
                      when excluded.role = 'owner' or public.share_invites.role <> 'owner'
                        then excluded.inviter_id
                      else public.share_invites.inviter_id end,
                    invitee_id = coalesce(excluded.invitee_id, public.share_invites.invitee_id)
    returning * into inv;
  else
    insert into public.share_invites (inviter_id, invitee_email, invitee_id, group_id, role)
    values (uid, em, target, p_id, p_role)
    on conflict (group_id, lower(invitee_email)) where status = 'pending' and group_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.share_invites.role end,
                    inviter_id = case
                      when excluded.role = 'owner' or public.share_invites.role <> 'owner'
                        then excluded.inviter_id
                      else public.share_invites.inviter_id end,
                    invitee_id = coalesce(excluded.invitee_id, public.share_invites.invitee_id)
    returning * into inv;
  end if;

  return to_jsonb(inv);
end;
$$;

-- Neste ledige PERSONLIGE toppnivåposisjon for en bruker (områder og frie
-- mapper deler samme personlige rekkefølgerom-per-seksjon; ny tilgang legges
-- alltid bakerst).
create or replace function public.next_personal_pos(p_user uuid)
returns double precision language sql stable security definer set search_path = public as $$
  select coalesce(max(m.pos), 0) + 1 from public.memberships m where m.user_id = p_user;
$$;

-- Mottakeren aksepterer. Ingen plassering å velge: et område havner i «Mine
-- områder»/«Områder delt med meg» etter rolle, og en mappe enten inne i
-- området (hvis mottakeren er områdemedlem) eller i «Mapper delt med meg».
create or replace function public.accept_share_invite(
  p_invite uuid, p_parent uuid default null, p_pos double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.share_invites;
  mem public.memberships;
  newpos double precision;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  select * into inv from public.share_invites where id = p_invite for update;
  if inv.id is null then raise exception 'invitasjonen finnes ikke'; end if;
  if inv.status <> 'pending' then raise exception 'invitasjonen er ikke lenger åpen'; end if;
  if coalesce(inv.invitee_id, uid) <> uid
     or (inv.invitee_id is null
         and lower(inv.invitee_email) <> (select lower(email) from public.profiles where id = uid)) then
    raise exception 'invitasjonen er ikke til deg';
  end if;

  newpos := coalesce(p_pos, public.next_personal_pos(uid));
  perform set_config('huskis.privileged_op', '1', true);

  if inv.universe_id is not null then
    insert into public.memberships (user_id, universe_id, role, pos)
    values (uid, inv.universe_id, inv.role, newpos)
    on conflict (universe_id, user_id) where universe_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.memberships.role end
    returning * into mem;
    -- Områdemedlemskapet gjør ordinære DIREKTE mappemedlemskap i området
    -- redundante; eksplisitte mappeeierroller beholdes (de gir ekstra myndighet).
    delete from public.memberships m
     where m.user_id = uid and m.role = 'member'
       and m.group_id in (select g.id from public.groups g where g.universe_id = inv.universe_id);
  else
    insert into public.memberships (user_id, group_id, role, pos)
    values (uid, inv.group_id, inv.role, newpos)
    on conflict (group_id, user_id) where group_id is not null
      do update set role = case when excluded.role = 'owner' then 'owner'
                                else public.memberships.role end
    returning * into mem;
  end if;

  update public.share_invites
     set status = 'accepted', invitee_id = uid, responded_at = now()
   where id = inv.id;

  perform set_config('huskis.privileged_op', '', true);
  return to_jsonb(mem);
end;
$$;

create or replace function public.decline_share_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  select * into inv from public.share_invites where id = p_invite for update;
  if inv.id is null or inv.status <> 'pending' then
    raise exception 'invitasjonen er ikke åpen';
  end if;
  if coalesce(inv.invitee_id, uid) <> uid
     or (inv.invitee_id is null
         and lower(inv.invitee_email) <> (select lower(email) from public.profiles where id = uid)) then
    raise exception 'invitasjonen er ikke til deg';
  end if;
  update public.share_invites
     set status = 'declined', invitee_id = uid, responded_at = now()
   where id = inv.id;
end;
$$;

-- Trekker tilbake en ventende invitasjon: sin egen, eller (som eier på nivået)
-- en hvilken som helst.
create or replace function public.revoke_share_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv public.share_invites;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  select * into inv from public.share_invites where id = p_invite and status = 'pending' for update;
  if inv.id is null then raise exception 'fant ingen ventende invitasjon'; end if;
  if inv.inviter_id <> uid
     and not public.can_manage_members(
       case when inv.universe_id is not null then 'universe' else 'group' end,
       coalesce(inv.universe_id, inv.group_id), uid) then
    raise exception 'mangler myndighet til å trekke tilbake denne invitasjonen';
  end if;
  update public.share_invites set status = 'revoked', responded_at = now() where id = inv.id;
end;
$$;

-- Kaster ut et medlem (eller en medeier) fra et område / en mappe. Krever
-- eierrolle på nivået. Områdeeiere og områdemedlemmer kan IKKE fjernes fra én
-- enkelt mappe — de må fjernes fra området (RPC-en avviser forsøket, så
-- feilen forklarer hvorfor i stedet for å bli en stille no-op).
create or replace function public.revoke_share(p_type text, p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if not public.can_manage_members(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å fjerne medlemmer';
  end if;
  perform set_config('huskis.privileged_op', '1', true);
  if p_type = 'universe' then
    if public.universe_role(p_id, p_user) is null then
      raise exception 'brukeren er ikke medlem av området';
    end if;
    perform public.purge_universe_access(p_id, p_user);
  else
    if public.group_role(p_id, p_user) is null then
      if public.is_group_member(p_id, p_user) then
        raise exception using
          errcode = 'PT409',
          message = 'brukeren har tilgang via området og må fjernes der';
      end if;
      raise exception 'brukeren er ikke medlem av mappen';
    end if;
    perform public.purge_group_access(p_id, p_user);
  end if;
  perform set_config('huskis.privileged_op', '', true);
end;
$$;

-- Endrer en eksisterende rolle NEDOVER (eier → vanlig medlem). Rolleløft går
-- alltid gjennom en eierskapsINVITASJON mottakeren må akseptere.
create or replace function public.set_member_role(p_type text, p_id uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur text;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if p_role not in ('member', 'owner') then raise exception 'ugyldig rolle: %', p_role; end if;
  if not public.can_manage_members(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å endre roller';
  end if;
  cur := case p_type when 'universe' then public.universe_role(p_id, p_user)
                     else public.group_role(p_id, p_user) end;
  if cur is null then raise exception 'brukeren har ingen rolle her'; end if;
  if p_role = 'owner' and cur <> 'owner' then
    raise exception 'eierskap gis via en eierskapsinvitasjon mottakeren må godta';
  end if;
  if cur = p_role then return; end if;
  perform set_config('huskis.privileged_op', '1', true);
  if p_type = 'universe' then
    update public.memberships set role = p_role where universe_id = p_id and user_id = p_user;
  else
    -- En degradert mappeeier som ellers ikke har tilgang, blir vanlig direkte
    -- mappemedlem; er vedkommende områdemedlem, er raden overflødig.
    if public.is_universe_member(public.group_universe(p_id), p_user) then
      delete from public.memberships where group_id = p_id and user_id = p_user;
    else
      update public.memberships set role = p_role where group_id = p_id and user_id = p_user;
    end if;
  end if;
  perform set_config('huskis.privileged_op', '', true);
end;
$$;

-- Brukeren forlater selv. Innholdet røres aldri — kun egen tilgang.
create or replace function public.leave_share(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if p_type = 'universe' then
    if public.universe_role(p_id, uid) is null then
      raise exception 'du er ikke medlem av dette området';
    end if;
    if not public.can_leave('universe', p_id, uid) then
      raise exception using
        errcode = 'PT422',
        message = 'du er siste eier — gi eierskap til noen andre først';
    end if;
    perform set_config('huskis.privileged_op', '1', true);
    perform public.purge_universe_access(p_id, uid);
  else
    -- Samme svar enten mapperaden mangler eller bare er overflødig ved siden av
    -- en områderolle: tilgangen kommer fra området, og det er der man
    -- forlater. Å slette den overflødige raden ville sett ut som en forlatelse
    -- uten å være det.
    if not public.can_leave('group', p_id, uid) then
      if public.is_group_member(p_id, uid) then
        raise exception using
          errcode = 'PT409',
          message = 'du har tilgang via området — forlat området i stedet';
      end if;
      raise exception 'du er ikke medlem av denne mappen';
    end if;
    perform set_config('huskis.privileged_op', '1', true);
    perform public.purge_group_access(p_id, uid);
  end if;
  perform set_config('huskis.privileged_op', '', true);
end;
$$;

-- Låser/åpner objektet for vanlige medlemmer. En lavere eksplisitt lås vinner
-- over et høyere unntak (nærmeste-eksplisitt-semantikken).
create or replace function public.set_locked(p_type text, p_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group', 'card') then raise exception 'ugyldig type: %', p_type; end if;
  if not public.can_manage_lock(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å låse/åpne';
  end if;
  if p_type = 'universe' then update public.universes set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  elsif p_type = 'group' then update public.groups set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  else update public.cards set locked = p_locked, unlocked = (unlocked and not p_locked) where id = p_id;
  end if;
end;
$$;

-- Gjør/opphever et UNNTAK fra en ARVET lås. Kun områdeeiere (alltid), eller —
-- når den arvede låsen er satt på en MAPPE — en eksplisitt mappeeier der.
create or replace function public.set_unlocked(p_type text, p_id uuid, p_unlocked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group', 'card') then raise exception 'ugyldig type: %', p_type; end if;
  if not public.can_manage_lock_exception(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å endre unntak';
  end if;
  if p_type = 'universe' then update public.universes set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  elsif p_type = 'group' then update public.groups set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  else update public.cards set unlocked = p_unlocked, locked = (locked and not p_unlocked) where id = p_id;
  end if;
end;
$$;

-- Setter objektets eksplisitte INVITASJONSPOLICY (tretilstand). Kun område og
-- mappe — lister deles ikke og har ingen policy.
create or replace function public.set_invite_policy(p_type text, p_id uuid, p_policy text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then raise exception 'ugyldig type: %', p_type; end if;
  if p_policy not in ('inherit', 'allow', 'deny') then raise exception 'ugyldig policy: %', p_policy; end if;
  if not public.can_manage_invite_policy(p_type, p_id, uid) then
    raise exception 'mangler myndighet til å endre invitasjonspolicy';
  end if;
  if p_type = 'universe' then update public.universes set invite_policy = p_policy where id = p_id;
  else update public.groups set invite_policy = p_policy where id = p_id;
  end if;
end;
$$;
-- ------------------------------------------------------------
-- 8b. E-postvarsel ved deling (valgfritt — krever konfig)
-- ------------------------------------------------------------
-- Når en invitasjon opprettes sendes en e-post via pg_net → Resend:
--   • UREGISTRERT mottaker  → «du er invitert, registrer deg» med en lenke
--     til appen (?signup=<e-post>) som åpner registreringssiden med e-posten
--     utfylt. Etter registrering kobles invitasjonen automatisk (handle_new_user)
--     og mottakeren godtar den i appen.
--   • REGISTRERT mottaker   → «X delte Y med deg» med lenke til appen, MEN kun
--     hvis mottakeren har e-postvarsler på (user_metadata.email_notifications,
--     standard på). Ellers vises delingen kun i appen (rød ring + innboks).
--
-- HEMMELIGHETER: selve Resend-API-nøkkelen foretrekkes lagret i **Supabase
-- Vault** (kryptert i ro; `vault.decrypted_secrets` er kun lesbar for
-- eier-rollen, aldri for anon/authenticated). Trigger-funksjonen leser Vault
-- først og faller tilbake til `public.app_config` KUN så det hermetiske
-- test-miljøet (uten Vault) fortsatt kan kjøre. Ikke-hemmelig konfig (avsender,
-- app-URL) ligger i app_config. Oppsettet (Vault via dashboard/integrasjon,
-- app_config-verdiene) er dokumentert i `TODO.md` — IKKE lim nøkkelen inn i
-- en versjonert fil, PR, logg eller chat.
--
-- app_config er en LÅST tabell — RLS på, ingen policyer, ingen grants → verken
-- anon eller authenticated kan lese den via PostgREST. Verdiene leses KUN inne
-- i trigger-funksjonen (SECURITY DEFINER, ikke kallbar som RPC), aldri via en
-- egen hjelpefunksjon — en slik ville Postgres gitt EXECUTE til PUBLIC og
-- dermed lekket nøkkelen. (Pensjoner en ev. tidligere `cfg`-variant.)
--
-- Uten en Resend-nøkkel (verken i Vault eller app_config) gjør triggeren
-- ingenting, så delingen fungerer som før.
--
-- pg_net er ASYNKRON: `net.http_post` legger forespørselen i en kø og returnerer
-- en request-id; selve HTTP-kallet til Resend skjer FØRST etter at transaksjonen
-- committer. Triggeren kan derfor bare vite om forespørselen ble KØLAGT — den
-- kan ikke se en senere Resend-respons (HTTP 2xx/4xx/5xx) som en trigger-
-- exception. Faktisk HTTP-resultat leses fra `net._http_response` via
-- `net_request_id` (kortvarig diagnostikk — pg_net rydder responstabellen etter
-- en stund). «enqueued» betyr altså IKKE accepted/delivered/successful.

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then null;  -- ikke tilgjengelig i test-/lokalmiljø
end $$;

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
-- Ingen RLS-policyer + ingen grants → verken anon eller authenticated kan lese
-- verdiene via PostgREST. Leses KUN inne i trigger-funksjonen under (SECURITY
-- DEFINER, ikke kallbar som RPC), aldri via en egen hjelpefunksjon. Eksplisitt
-- REVOKE også fra PUBLIC som ekstra forsvar.
revoke all on public.app_config from public, anon, authenticated;
drop function if exists public.cfg(text);

-- Minimal, LÅST loggtabell for observabilitet på KØLEGGINGEN av e-posten. Lagrer
-- ALDRI API-nøkkelen, Authorization-headeren, e-postkroppen eller mottaker-
-- adressen — kun invitasjons-id, variant, pg_net-request-id og en ev. synkron
-- kø-feilmelding. `enqueue_status` gjelder BARE om forespørselen ble lagt i
-- pg_net-køen (`enqueued`) eller feilet synkront før kølegging (`enqueue_error`)
-- — det sier INGENTING om Resend faktisk aksepterte/leverte e-posten. Det
-- faktiske HTTP-resultatet korreleres via `net_request_id` mot
-- `net._http_response` (kortvarig diagnostikk). Samme lås som app_config.
create table if not exists public.email_send_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  invite_id      uuid,
  variant        text   check (variant in ('unregistered', 'existing')),
  net_request_id bigint,        -- pg_net request-id (korreleres mot net._http_response)
  enqueue_status text not null  check (enqueue_status in ('enqueued', 'enqueue_error')),
  error          text           -- SQLERRM ved synkron kø-feil (ingen nøkkel/header/kropp/adresse)
);
alter table public.email_send_log enable row level security;
revoke all on public.email_send_log from public, anon, authenticated;

-- Enkel HTML-escaping for brukerstyrt tekst (navn) i e-postkroppen — hindrer at
-- et navn med markup rendres i mottakerens e-postklient. Ren/immutabel.
create or replace function public.html_escape(p text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(
    coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

-- Robust prosent-koding (RFC 3986) for URL-parametre — byte-sikker (UTF-8), så
-- den håndterer `+`, `@`, `&`, mellomrom osv. korrekt uten manuelle replace-
-- kjeder. Ren/immutabel; leser ingen hemmeligheter, så trygg som PUBLIC.
create or replace function public.url_encode(p text)
returns text language plpgsql immutable set search_path = public as $$
declare
  bytes bytea := convert_to(coalesce(p, ''), 'UTF8');
  out   text  := '';
  b     int;
  i     int;
begin
  for i in 0 .. length(bytes) - 1 loop
    b := get_byte(bytes, i);
    if (b between 48 and 57)   -- 0-9
       or (b between 65 and 90)  -- A-Z
       or (b between 97 and 122) -- a-z
       or b in (45, 46, 95, 126) then  -- - . _ ~  (unreserved)
      out := out || chr(b);
    else
      out := out || '%' || upper(lpad(to_hex(b), 2, '0'));
    end if;
  end loop;
  return out;
end;
$$;

create or replace function public.send_invite_email()
returns trigger language plpgsql security definer
set search_path = public, extensions, net as $$
declare
  -- Fast produksjons-URL for logoen (PNG i repoet, serveres statisk). Ikke
  -- brukerstyrt → trenger ingen escaping. Kanonisk domene (uten www) — se
  -- docs/domains-and-urls.md.
  logo_url    constant text := 'https://huskis.no/assets/email/huskis-logo-v1.png';
  api_key     text;
  from_addr   text;
  app_url     text;
  inviter     text;   -- rått inviter-navn (brukerstyrt)
  obj_name    text;   -- rått objektnavn (brukerstyrt)
  inv_e       text;   -- HTML-escaped inviter-navn
  obj_e       text;   -- HTML-escaped objektnavn
  subject     text;
  heading     text;   -- ren tekst; escapes ved HTML-innsetting
  explanation text;   -- ren tekst; escapes ved HTML-innsetting
  action_text text;   -- ren tekst; escapes ved HTML-innsetting
  variant     text;   -- 'unregistered' | 'existing' (til loggen)
  -- SPRÅK: e-posten skrives på MOTTAKERENS språk (`user_metadata.lang`, satt av
  -- språkvelgeren i appen). En uregistrert mottaker har ikke noe språk ennå —
  -- da brukes inviterens, som er den beste gjetningen vi har. Ukjent/manglende
  -- verdi faller til norsk, appens standard. Se ../docs/sprak.md.
  lang        text;
  is_en       boolean;
  html_lang   text;
  label_txt   text;   -- etiketten i versaler over overskriften
  intro_txt   text;   -- «X har delt noe med deg:» (inviter-navnet er escapet)
  fallback_lb text;   -- «Virker ikke knappen? …»
  footer_txt  text;   -- bunnteksten i HTML-en
  auto_txt    text;   -- den samme beskjeden i text/plain-varianten
  shared_line text;   -- «X har delt «Y» med deg på Huskis.» (råtekst)
  preheader   text;   -- samme setning, escapet, som forhåndsvisningstekst
  link        text;
  body_html   text;
  body_text   text;
  net_req     bigint;
begin
  -- API-nøkkel: foretrekk Supabase Vault (kryptert i ro; kun eier-rollen kan
  -- dekryptere), fall tilbake til app_config. Vault-skjemaet finnes ikke i
  -- test-/lokalmiljø → fanges her uten å velte funksjonen.
  begin
    select decrypted_secret into api_key
      from vault.decrypted_secrets where name = 'resend_api_key';
  exception when others then
    api_key := null;
  end;
  if api_key is null or api_key = '' then
    select value into api_key from public.app_config where key = 'resend_api_key';
  end if;
  -- Ikke konfigurert → ingen e-post (delingen fungerer likevel via appen).
  if api_key is null or api_key = '' then return new; end if;

  select value into from_addr from public.app_config where key = 'email_from';
  from_addr := coalesce(nullif(from_addr, ''), 'Huskis <noreply@huskis.no>');
  select value into app_url from public.app_config where key = 'app_url';
  app_url := coalesce(nullif(app_url, ''), 'https://huskis.no/');

  select display_name into inviter from public.profiles where id = new.inviter_id;
  inviter := coalesce(inviter, 'Noen');
  obj_name := coalesce(
    (select name from public.universes where id = new.universe_id),
    (select name from public.groups    where id = new.group_id),
    'noe');
  -- Brukerstyrt tekst escapes før den settes inn i HTML-kroppen (subject er ren
  -- tekst i e-post og trenger ingen escaping).
  inv_e := public.html_escape(inviter);
  obj_e := public.html_escape(obj_name);

  -- Mottakerens språk, med inviterens som fallback for en uregistrert mottaker.
  select nullif(raw_user_meta_data ->> 'lang', '') into lang
    from auth.users where id = coalesce(new.invitee_id, new.inviter_id);
  if lang is null or lang not in ('no', 'en') then lang := 'no'; end if;
  is_en := lang = 'en';
  html_lang := lang;

  subject := format(
    case when is_en then '%1$s shared “%2$s” with you on Huskis'
         else            '%1$s har delt «%2$s» med deg på Huskis' end,
    inviter, obj_name);
  shared_line := format(
    case when is_en then '%1$s shared “%2$s” with you on Huskis.'
         else            '%1$s har delt «%2$s» med deg på Huskis.' end,
    inviter, obj_name);
  preheader := format(
    case when is_en then '%1$s shared “%2$s” with you on Huskis.'
         else            '%1$s har delt «%2$s» med deg på Huskis.' end,
    inv_e, obj_e);
  label_txt   := case when is_en then 'SHARING INVITATION' else 'DELINGSINVITASJON' end;
  intro_txt   := case when is_en then '<strong>' || inv_e || '</strong> shared something with you:'
                      else            '<strong>' || inv_e || '</strong> har delt noe med deg:' end;
  fallback_lb := case when is_en then 'Button not working? Copy this address:'
                      else            'Virker ikke knappen? Kopier denne adressen:' end;
  footer_txt  := case when is_en then
                        'This message was sent automatically because someone shared content ' ||
                        'with you in Huskis. The sender address is not monitored and cannot receive replies.'
                      else
                        'Denne meldingen ble sendt automatisk fordi noen delte innhold med deg i ' ||
                        'Huskis. Avsenderadressen overvåkes ikke og kan ikke motta svar.' end;
  auto_txt    := case when is_en then
                        'This message was sent automatically because someone shared content with ' ||
                        'you in Huskis. You cannot reply to this address.'
                      else
                        'Denne meldingen ble sendt automatisk fordi noen delte innhold med deg i ' ||
                        'Huskis. Du kan ikke svare på denne adressen.' end;

  if new.invitee_id is null then
    -- Uregistrert mottaker → inviter til å registrere seg. E-posten går til
    -- invitee_email selv (self-targeted), men vi prosent-koder likevel korrekt.
    variant     := 'unregistered';
    link        := app_url || '?signup=' || public.url_encode(new.invitee_email);
    heading     := case when is_en then 'You have been invited to Huskis'
                        else            'Du er invitert til Huskis' end;
    explanation := case when is_en then
                          'Create an account with this email address (' || new.invitee_email ||
                          '), and the share will show up in the app for you to accept.'
                        else
                          'Opprett en konto med denne e-postadressen (' || new.invitee_email ||
                          '), så dukker delingen opp i appen og du kan godta den.' end;
    action_text := case when is_en then 'Create an account and join'
                        else            'Opprett konto og bli med' end;
  else
    -- Registrert mottaker → respekter e-postvarsel-innstillingen (standard på).
    variant := 'existing';
    if (select coalesce(raw_user_meta_data ->> 'email_notifications', 'true')
          from auth.users where id = new.invitee_id) = 'false' then
      return new;
    end if;
    link        := app_url;
    heading     := case when is_en then obj_name || ' has been shared with you'
                        else            obj_name || ' er delt med deg' end;
    explanation := case when is_en then 'Open Huskis to see and accept the invitation.'
                        else            'Åpne Huskis for å se og godta invitasjonen.' end;
    action_text := case when is_en then 'Open Huskis' else 'Åpne Huskis' end;
  end if;

  -- text/plain-variant (leveres sammen med HTML for maks kompatibilitet).
  body_text :=
    heading || E'\n\n' ||
    shared_line || E'\n\n' ||
    explanation || E'\n\n' ||
    action_text || ': ' || link || E'\n\n' ||
    auto_txt || E'\n\n' ||
    'Huskis — https://huskis.no/';

  -- Tabellbasert, inline-stylet HTML for e-postklienter (Outlook m/ bgcolor).
  -- Trygg fontstakk (ingen webfont), maks 600px, avrundede flater, ingen JS.
  body_html :=
    '<!DOCTYPE html>' ||
    '<html lang="' || html_lang || '" xmlns="http://www.w3.org/1999/xhtml">' ||
    '<head>' ||
      '<meta charset="utf-8" />' ||
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' ||
      '<meta http-equiv="X-UA-Compatible" content="IE=edge" />' ||
      '<meta name="color-scheme" content="light only" />' ||
      '<title>' || public.html_escape(subject) || '</title>' ||
    '</head>' ||
    '<body style="margin:0;padding:0;background-color:#667788;">' ||
      -- Preheader / forhåndsvisningstekst (skjult, men fanges opp av innboksen).
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#667788;opacity:0;">' ||
        preheader ||
        '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' ||
      '</div>' ||
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#667788" style="width:100%;background-color:#667788;">' ||
        '<tr><td align="center" style="padding:28px 14px;">' ||
          '<table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:600px;">' ||
            -- Toppbånd: logo + ordmerke på skifer-bakgrunn.
            '<tr><td bgcolor="#667788" style="background-color:#667788;padding:8px 8px 20px 8px;">' ||
              '<table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>' ||
                '<td width="56" style="width:56px;vertical-align:middle;">' ||
                  '<img src="' || logo_url || '" width="52" height="52" alt="Huskis" border="0" style="display:block;border:0;width:52px;height:52px;" />' ||
                '</td>' ||
                '<td width="12" style="width:12px;font-size:1px;line-height:1px;">&nbsp;</td>' ||
                '<td style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:30px;font-weight:700;color:#ffffff;vertical-align:middle;">Huskis</td>' ||
              '</tr></table>' ||
            '</td></tr>' ||
            -- Hvitt innholdskort.
            '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:18px;">' ||
              '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;">' ||
                '<tr><td style="padding:34px 34px 8px 34px;font-family:Arial,Helvetica,sans-serif;">' ||
                  '<p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:16px;font-weight:700;letter-spacing:1.2px;color:#4d664d;">' || label_txt || '</p>' ||
                  '<h1 style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:33px;font-weight:700;color:#37343f;">' || public.html_escape(heading) || '</h1>' ||
                  '<p style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:26px;color:#37343f;">' || intro_txt || '</p>' ||
                  -- Objekt-kort (lys grønn flate, grønn venstrekant).
                  '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#eef3ee" style="width:100%;background-color:#eef3ee;border-radius:12px;border-left:5px solid #668866;">' ||
                    '<tr><td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:25px;font-weight:700;color:#37343f;">' || obj_e || '</td></tr>' ||
                  '</table>' ||
                  '<p style="margin:22px 0 26px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#37343f;">' || public.html_escape(explanation) || '</p>' ||
                  -- Handlingsknapp: stylet <a> på grønn flate (Outlook: bgcolor).
                  '<table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>' ||
                    '<td bgcolor="#4d664d" style="background-color:#4d664d;border-radius:12px;">' ||
                      '<a href="' || public.html_escape(link) || '" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">' || public.html_escape(action_text) || '</a>' ||
                    '</td>' ||
                  '</tr></table>' ||
                  -- Fallback-lenke for klienter som ikke rendrer knappen.
                  '<p style="margin:24px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b6577;">' || public.html_escape(fallback_lb) || '<br /><a href="' || public.html_escape(link) || '" style="color:#4d664d;text-decoration:underline;word-break:break-all;">' || public.html_escape(link) || '</a></p>' ||
                '</td></tr>' ||
                -- Bunntekst.
                '<tr><td style="padding:22px 34px 30px 34px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b6577;border-top:1px solid #e3e7e3;">' ||
                  public.html_escape(footer_txt) ||
                '</td></tr>' ||
              '</table>' ||
            '</td></tr>' ||
          '</table>' ||
        '</td></tr>' ||
      '</table>' ||
    '</body></html>';

  -- pg_net er asynkron: http_post legger forespørselen i køen og returnerer en
  -- request-id NÅ; selve HTTP-kallet skjer etter commit, og Resend-svaret lander
  -- senere i net._http_response. Vi logger request-id-en for korrelasjon dit.
  -- «enqueued» betyr KUN kølagt — ikke at Resend har akseptert/levert.
  select net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type',  'application/json'),
    body    := jsonb_build_object(
      'from',    from_addr,
      'to',      new.invitee_email,
      'subject', subject,
      'html',    body_html,
      'text',    body_text)
  ) into net_req;

  insert into public.email_send_log(invite_id, variant, net_request_id, enqueue_status)
  values (new.id, variant, net_req, 'enqueued');
  return new;
exception when others then
  -- E-post er en bieffekt; en SYNKRON feil her (f.eks. kølegging feiler) skal
  -- ALDRI blokkere selve delingen. Vi logger den (uten nøkkel/header/kropp/
  -- adresse) så problemet kan diagnostiseres. Merk: dette fanger IKKE en senere
  -- asynkron Resend-feil — den finnes bare i net._http_response.
  begin
    insert into public.email_send_log(invite_id, variant, enqueue_status, error)
    values (new.id, variant, 'enqueue_error', left(sqlerrm, 500));
  exception when others then null;  -- logging skal heller aldri velte delingen
  end;
  return new;
end;
$$;

-- Trigger-funksjoner er ikke kallbare via PostgREST, men vi fjerner uansett
-- PUBLIC-EXECUTE som ekstra forsvar (funksjonen leser Resend-nøkkelen).
revoke all on function public.send_invite_email() from public, anon, authenticated;

drop trigger if exists on_share_invite_created on public.share_invites;
create trigger on_share_invite_created
  after insert on public.share_invites
  for each row execute function public.send_invite_email();

-- ------------------------------------------------------------
-- 8c. SLETT EGEN KONTO
--
-- `delete_account()` sletter kontoen og alle spor av den i ÉN transaksjon.
-- Det vanskelige er ikke slettingen, men grensen mot ANDRES innhold:
--
--   * Områder som blir stående UTEN EIER når jeg er borte (typisk: der jeg
--     er eneste eier) slettes HELT — kaskaden tar mapper/lister/listepunkter,
--     og AFTER DELETE-triggerne skriver gravstein for hver rad. Også for dem
--     jeg har delt med: innholdet er mitt, og det følger kontoen.
--   * Områder/mapper med andre eiere står igjen; jeg fjernes bare som
--     medlem, nøyaktig som «Forlat».
--   * `owner_id` (OPPRETTER) på rader som overlever ARVES av en gjenværende
--     områdeeier. Feltet er ren historikk uten rettigheter, men FK-en er
--     `on delete cascade` — uten arven ville profilslettingen revet vekk
--     innhold i andres delte områder (et listepunkt jeg la inn i en felles
--     liste er de andres innhold like mye som mitt).
--   * `responsible` som peker på meg nulles med et stempel som er nyere enn
--     BÅDE klokka og radens eget register. `on delete set null` alene ville
--     ikke holdt: en annen enhet med det gamle valget i cachen ville vunnet
--     LWW-en og skrevet den slettede brukeren tilbake — en rad som deretter er
--     umulig å skrive (FK).
--
-- I tillegg: invitasjoner begge veier (også de som bare er adressert til
-- e-postadressen min), e-postloggen for dem, rollene mine, profilraden og til
-- slutt selve auth-brukeren. Gravsteinene blir stående — de er id-er uten
-- personopplysninger, og de er nettopp det som hindrer at en gammel klient
-- legger innholdet inn igjen ved neste synk (docs/trash.md).
--
-- Alt skjer i én transaksjon: feiler siste steg, rulles ALT tilbake. En konto
-- uten data hadde vært verre enn en sletting som ikke gikk gjennom.
-- ------------------------------------------------------------

-- En gjenværende eier av området (aldri p_uid). Deterministisk — eldste
-- medlemskap først — så arven blir den samme hver gang.
create or replace function public.surviving_universe_owner(p_universe uuid, p_uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.user_id from public.memberships m
   where m.universe_id = p_universe and m.role = 'owner' and m.user_id <> p_uid
   order by m.created_at, m.user_id
   limit 1;
$$;

create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  em     text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  select lower(p.email) into em from public.profiles p where p.id = uid;
  if em is null then raise exception 'fant ingen profil for kontoen'; end if;

  perform set_config('huskis.privileged_op', '1', true);

  -- 1. Invitasjoner begge veier (også de som bare er adressert til e-posten min)
  --    og e-postloggen for dem. FØRST, fordi en invitasjon til et område som
  --    slettes i neste steg forsvinner med kaskaden — da ville loggraden dens
  --    ikke lenger vært mulig å finne.
  delete from public.email_send_log l
   where l.invite_id in (select s.id from public.share_invites s
                          where s.inviter_id = uid or s.invitee_id = uid
                             or lower(s.invitee_email) = em);
  delete from public.share_invites s
   where s.inviter_id = uid or s.invitee_id = uid or lower(s.invitee_email) = em;

  -- 2. Områder jeg er knyttet til som ikke har noen eier igjen etter meg.
  delete from public.universes u
   where public.surviving_universe_owner(u.id, uid) is null
     and (u.owner_id = uid
          or exists (select 1 from public.memberships m
                      where m.universe_id = u.id and m.user_id = uid));

  -- 3. Oppretter-arv på alt som overlever (området har nå alltid en eier).
  update public.universes u
     set owner_id = public.surviving_universe_owner(u.id, uid)
   where u.owner_id = uid;
  update public.groups g
     set owner_id = public.surviving_universe_owner(g.universe_id, uid)
   where g.owner_id = uid;
  update public.cards c
     set owner_id = public.surviving_universe_owner(public.resource_universe('card', c.id), uid)
   where c.owner_id = uid;
  update public.items i
     set owner_id = public.surviving_universe_owner(public.resource_universe('item', i.id), uid)
   where i.owner_id = uid;

  -- 4. Ansvarstildelinger som peker på meg, og rollene mine.
  --    Stempelet må slå radens EGET register, ikke bare klokka: vaktene
  --    (`*_before_update`) hopper over autorisasjonen under en privilegert
  --    operasjon, men ALDRI over `reg_newer`. En rad skrevet av en enhet med
  --    klokka foran serverens ville derfor rullet skrivingen tilbake, og
  --    FK-ens `on delete set null` hadde nullet feltet UTEN nytt stempel —
  --    hvorpå den gamle verdien vinner LWW-en ved neste synk og gjør raden
  --    uskrivbar (FK-en peker på en slettet profil).
  update public.cards set responsible = null, ts = greatest(now_ms, ts + 1), org = 'server'
   where responsible = uid;
  update public.items set responsible = null, ts = greatest(now_ms, ts + 1), org = 'server'
   where responsible = uid;
  delete from public.memberships where user_id = uid;
  -- Idéene er MINE ALENE — de deles aldri, så det finnes ingen grense mot
  -- andres innhold her: de skal bort, ikke arves. Kaskaden fra profilraden
  -- ville tatt dem uansett, men ryddingen skal være lesbar. AFTER DELETE-
  -- triggeren skriver gravstein per rad, som for alt annet innhold.
  delete from public.ideas where owner_id = uid;
  -- Notatene er MINE ALENE på nøyaktig samme måte (docs/notater-plan.md).
  -- Rekkefølgen er nedenfra og opp så kaskadene ikke må rydde etter oss.
  -- Koblingene FØRST: de peker på notatradene under (og på listesiden), og
  -- kaskaden ville tatt dem uansett — men da uten at rekkefølgen er lesbar.
  delete from public.object_links where owner_id = uid;
  delete from public.notes where owner_id = uid;
  delete from public.note_folders where owner_id = uid;
  delete from public.note_projects where owner_id = uid;
  -- Varselhistorikken og preferansene er mine alene. Kaskaden fra auth.users
  -- ville tatt dem uansett; de står her fordi ryddingen skal være lesbar.
  delete from public.notifications where user_id = uid;
  delete from public.notification_prefs where user_id = uid;
  -- Web push-abonnementene og det som ennå ligger i utboksen. Kaskaden ville
  -- tatt dem uansett; de står her fordi ryddingen skal være lesbar — og fordi
  -- et abonnement som ble stående ville sendt en push til en slettet konto.
  delete from public.push_deliveries where user_id = uid;
  delete from public.push_subscriptions where user_id = uid;
  -- Den gjenkjennelige metadataen om øktene mine, og statusen til de native
  -- varselkanalene. Kaskaden ville tatt begge uansett (auth.users), men
  -- ryddingen skal være lesbar — og en native rad som ble stående ville vært
  -- en «enhet med varsler» for en konto som ikke finnes.
  delete from public.device_sessions where user_id = uid;
  delete from public.native_notif_devices where user_id = uid;

  -- 5. Profilen og selve kontoen.
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;

  perform set_config('huskis.privileged_op', '', true);
end;
$$;


-- ------------------------------------------------------------
-- 8d. VARSEL-RPC-ER
--
--    To innganger, begge SECURITY DEFINER fordi de setter `user_id` selv:
--
--    notify_record(rows, cursor)  — logg terskler klienten har sett passere,
--      og flytt generator-markøren. Idempotent gjennom (user_id, key): to
--      enheter som regner ut det samme varselet gir én rad. Markøren kan bare
--      gå FRAMOVER, og aldri forbi serverens klokke — en enhet med feil klokke
--      skal ikke kunne blende varslene for de andre. `p_cursor = 0` (standard)
--      lar markøren stå: det er «Utsett»-veien, som legger inn en rad uten å
--      ha vurdert noen terskler.
--
--    notify_set_prefs(prefs)      — de fire av/på-valgene. Et bytte flytter
--      markøren til NÅ: en terskel som passerte mens typen var AV skal ikke
--      komme veltende inn i det den slås på igjen.
--
--    Historikken har TO grenser, og begge ryddes ved hver logging:
--      • et tak på 200 rader per bruker — de eldste utover det ryddes bort;
--      • en levetid på 30 døgn (notify_max_age_ms()). Den er ikke valgfri, og
--        den gjelder også en historikk som er langt under taket: et varsel som
--        har ligget en måned ber ikke lenger om oppmerksomhet.
--
--    LEVETIDEN TELLER FRA DET ØYEBLIKKET RADEN BLE HISTORIKK, altså fra det
--    SENESTE av `created_at` og `at`. Ingen av de to duger alene:
--      • bare `at` ville slettet en rad i den samme operasjonen som skrev den.
--        En app som har vært lukket lenge logger terskler som passerte for
--        lenge siden (docs/varsler.md, «Markøren er hele idempotensen»), og de
--        skal vises når de kommer — ikke forsvinne før de er sett;
--      • bare `created_at` ville tatt en PLANLAGT rad i det den ringte. Planen
--        legges opp til en måned fram, så en rad ved horisontens ytterkant er
--        allerede en måned gammel når `at` passerer.
--    Med det seneste av de to lever hver rad en måned ETTER at den ble
--    relevant, uansett hvilken vei den kom.
--
--    Radene FRAM i tid røres dermed heller ikke: for dem er `at` det seneste,
--    og det ligger foran nå. Planen og «Utsett» er ikke historikk, og skal
--    aldri ryddes bort før de har fått ringt.
-- ------------------------------------------------------------

/* Levetiden for en varselrad, ett sted. Brukes både av opprydningen i
   notify_record() og av get_my_doc(), som ikke skal kunne komme i utakt: en
   rad doc-et leverer, skal være en rad som fortsatt finnes neste logging.
   Speiles i mock-backend.js (NOTIF_MAX_AGE_MS) og i klientens egen vakt. */
create or replace function public.notify_max_age_ms()
returns bigint language sql immutable as $$
  select (30::bigint * 24 * 60 * 60 * 1000);
$$;

create or replace function public.notify_prefs_row(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_prefs (user_id) values (p_uid)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.notify_record(p_rows jsonb default '[]'::jsonb,
                                                p_cursor bigint default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  lagt   integer := 0;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  perform public.notify_prefs_row(uid);

  insert into public.notifications
    (user_id, key, type, obj_type, obj_id, name, path, value, at, snoozed)
  select uid, r.key, r.type, r.obj_type, r.obj_id,
         coalesce(r.name, ''), coalesce(r.path, ''), r.value, r.at,
         coalesce(r.snoozed, false)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
           key text, type text, obj_type text, obj_id uuid,
           name text, path text, value text, at bigint, snoozed boolean)
   where r.key is not null and r.at is not null
     and r.type in ('dueOver', 'dueSoon', 'startNow', 'startSoon')
     and r.obj_type in ('card', 'category', 'item')
  /* En rad som alt finnes røres ikke — MED ETT UNNTAK: en PLANLAGT rad (ennå
     ikke forfalt, ikke utsatt) skal bære et ferskt øyeblikksbilde av navn og
     sti. Det er den teksten web push leverer når raden forfaller, kanskje en
     måned senere, og et objekt som er døpt om i mellomtiden skal varsle med
     det navnet det HAR. Historikk skrives aldri om: en forfalt rad beskriver
     hva som het hva da det skjedde, og `where`-en under er hele forskjellen.

     Merk at `at` ikke oppdateres her. En endret terskeltid betyr at PLANEN er
     en annen, ikke bare teksten — og den ryddes av opprydningen i klienten,
     som måler hver planlagt rad mot planen og sletter den som ikke lenger står
     der (docs/varsler.md). Å flytte tiden i en rad utenom den regelen ville
     omgått den vurderingen. */
  on conflict (user_id, key) do update
     set name = excluded.name,
         path = excluded.path
   where notifications.at > now_ms
     and not notifications.snoozed
     and (notifications.name is distinct from excluded.name
          or notifications.path is distinct from excluded.path);
  get diagnostics lagt = row_count;

  update public.notification_prefs
     set cursor_at  = greatest(cursor_at, least(coalesce(p_cursor, 0), now_ms)),
         updated_at = now()
   where user_id = uid;

  /* LEVETIDEN først: en rad som ble historikk for lenger siden enn levetiden
     slettes, uansett hvor kort historikken er. Målt fra det SENESTE av
     `created_at` og `at` — se blokken over: en planlagt rad ved horisontens
     ytterkant er allerede en måned gammel når den ringer, og en fersk rad om
     en gammel terskel er ikke gammel. En rad som ennå ikke har ringt har `at`
     foran nå og røres derfor ikke. Kaskaden tar leveringene i utboksen med
     seg. */
  delete from public.notifications n
   where n.user_id = uid
     and greatest(n.created_at, n.at) < now_ms - public.notify_max_age_ms();

  delete from public.notifications n
   where n.user_id = uid
     and n.id in (select x.id from public.notifications x
                   where x.user_id = uid
                   order by x.created_at desc, x.id desc
                  offset 200);

  -- PLANLAGTE rader (`at` fram i tid) er det web push leverer. Utboksen fylles
  -- her, i den samme operasjonen som logget raden: en push er en levering av en
  -- rad som allerede finnes, aldri en egen generator.
  perform public.push_enqueue(uid);

  /* Hvor mange rader som FAKTISK ble lagt inn. Klienten trenger tallet: en
     kandidat som allerede finnes faller stille bort her, og uten svaret ville
     den ikke visst forskjell på «det kom noe nytt» og «alt var alt logget» —
     og planlagt en ny runde i det uendelige. */
  return lagt;
end;
$$;

create or replace function public.notify_set_prefs(p_prefs jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  perform public.notify_prefs_row(uid);
  update public.notification_prefs
     set due_over   = coalesce((p_prefs ->> 'dueOver')::boolean, due_over),
         due_soon   = coalesce((p_prefs ->> 'dueSoon')::boolean, due_soon),
         start_now  = coalesce((p_prefs ->> 'startNow')::boolean, start_now),
         start_soon = coalesce((p_prefs ->> 'startSoon')::boolean, start_soon),
         cursor_at  = greatest(cursor_at, now_ms),
         updated_at = now()
   where user_id = uid;
end;
$$;

/* Hevder TIDSSONEN planen tilhører. Terskeltidene er absolutte millisekunder
   regnet ut fra lokal veggtid, så de gjelder én sone; en enhet i en annen sone
   ville regnet ut andre tider for de samme datoene. Klienten hevder sonen sin
   FØR den planlegger, og bare når den forrige hevdelsen er blitt gammel — det
   er dempingen som hindrer to enheter i ulike soner fra å planlegge om
   hverandre i det uendelige (docs/varsler.md). Serveren håndhever ventetiden,
   ikke bare klienten: to enheter kan ellers hevde i samme øyeblikk.
   Returnerer sonen som gjelder ETTER kallet. */
create or replace function public.notify_claim_tz(p_tz text, p_min_age_ms bigint default 0)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  gjeldende text;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_tz is null or p_tz = '' or length(p_tz) > 64 then raise exception 'ugyldig tidssone'; end if;
  perform public.notify_prefs_row(uid);
  update public.notification_prefs
     set tz    = p_tz,
         tz_at = now_ms
   where user_id = uid
     and (tz is null or tz = p_tz or now_ms - tz_at >= coalesce(p_min_age_ms, 0));
  select tz into gjeldende from public.notification_prefs where user_id = uid;
  return gjeldende;
end;
$$;

-- ------------------------------------------------------------
-- 8e. WEB PUSH-RPC-ER
--
--    To innganger for klienten (begge SECURITY DEFINER, begge setter user_id
--    fra auth.uid() selv), og to for SENDEREN (avgrenset til service_role):
--
--    push_subscribe(endpoint, p256dh, auth, labels, tz)
--      Registrerer ELLER fornyer denne nettleserens abonnement. Idempotent på
--      `endpoint`: den samme nettleseren som melder seg på nytt (etter en
--      `pushsubscriptionchange`, en ny innlogging eller bare en ny økt) får den
--      samme raden oppdatert, ikke en ny. Et endepunkt som var slått av
--      (404/410) våkner igjen — nettleseren har nettopp sagt at det virker.
--      Etterpå fylles utboksen med de allerede planlagte varslene, så en helt
--      ny enhet ikke må vente på neste generator-runde.
--
--    push_unsubscribe(endpoint)  — «slå av i denne nettleseren».
--
--    push_revoke(id)             — «slå av varslene på DEN andre enheten».
--      Fjern-avslåing: brukeren står på én nettleser og slår av en annen.
--      Setter `revoked_at`, avslutter køen til abonnementet og lar raden bli
--      stående som et spor. Den avslåtte klienten kan ikke fornye seg tilbake
--      til på — bare et eksplisitt «slå på varsler» der tar det tilbake.
--
--    push_revoke_others(endpoint) — det samme for alle unntatt denne.
--
--    push_claim(limit)   — senderen henter og LÅSER forfalte leveringer.
--    push_report(results)— senderen melder tilbake hva som skjedde.
--
--    Selve sendingen skjer utenfor databasen (Supabase Edge Function
--    `push-send`): Web Push krever ES256-signering og RFC 8291-kryptering, som
--    ikke finnes i SQL. Databasen eier køen, rekkefølgen og idempotensen;
--    funksjonen eier HTTP-kallet. Se docs/varsler.md.
-- ------------------------------------------------------------

/* Er kalleren senderen? Rollen leses av det VERIFISERTE JWT-et PostgREST
   legger i `request.jwt.claims` — ikke av `current_user`, som inne i en
   SECURITY DEFINER-funksjon alltid er funksjonens eier og dermed ikke sier
   noe om hvem som ringte. Grantene er det første laget; denne er det andre. */
create or replace function public.is_service_role()
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    '') = 'service_role';
$$;

/* Fyller utboksen for én bruker: én rad per (planlagt varsel, aktivt
   abonnement). Bare rader med `at` FRAM I TID — en rad som logges etter at
   terskelen passerte, ble observert av en app som sto åpen, og da har brukeren
   allerede fått den i appen. Idempotent gjennom den unike indeksen.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.push_enqueue(p_uid uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  lagt   integer := 0;
begin
  if p_uid is null then return 0; end if;
  insert into public.push_deliveries (notification_id, subscription_id, user_id, due_at)
  select n.id, s.id, p_uid, n.at
    from public.notifications n
    join public.push_subscriptions s
      on s.user_id = p_uid and s.disabled_at is null and s.revoked_at is null
   where n.user_id = p_uid and n.at > now_ms
  on conflict (notification_id, subscription_id) do nothing;
  get diagnostics lagt = row_count;
  return lagt;
end;
$$;

/* SERIALISERINGEN AV ÉN BRUKERS ABONNEMENTER.

   Invarianten er ikke lenger en rad, men en KLIENTKONTEKST: slår brukeren av
   varslene for en nettleser, skal ingen rad i den konteksten være aktiv
   etterpå. `for update` på endepunktets egen rad holder ikke for det, av to
   grunner:

     · raden det gjelder finnes kanskje ikke ennå. Nettleseren kan ha rullert
       endepunktet, og fornyelsen er i ferd med å OPPRETTE `E2` mens avslåingen
       tar `E1`. To ulike rader — ingen felles lås;
     · «slå av på alle andre enheter» spenner over flere kontekster på én gang,
       og en samtidig registrering fra en av dem ville sneket seg inn etter at
       løkken leste listen sin.

   Låsen tas derfor på BRUKEREN, ikke på raden: hver operasjon som kan endre
   hvilke abonnementer som er aktive (`push_subscribe`, `push_revoke`,
   `push_revoke_others`) tar den først, og holder den ut transaksjonen.
   Granulariteten koster ingenting — en bruker har en håndfull nettlesere, og
   hver av dem rører dette hvert kvarter — og den gjør rekkefølgen mellom to
   samtidige kall til et avgjort spørsmål i stedet for et kappløp.

   `pg_advisory_xact_lock` og ikke en radlås: låsen skal finnes også når det
   ikke er noen rad å låse. Kollisjoner mellom to brukeres hashverdier er
   ufarlige — da serialiseres to brukere som ikke hadde noe med hverandre å
   gjøre, og ingen av dem merker det.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.push_lock(p_uid uuid)
returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('huskis.push:' || coalesce(p_uid::text, ''), 0));
$$;

/* Hvor mange aktive abonnementer én bruker får ha. Tallet står som en funksjon
   og ikke som et magisk tall inne i push_subscribe(), slik at testene kan lese
   det samme tallet som regelen bruker. */
create or replace function public.push_sub_max()
returns integer language sql immutable set search_path = public as $$ select 20 $$;

/* Hvor lenge et spor som døde av seg selv blir liggende. Et endepunkt
   push-tjenesten svarte 404/410 på finnes ikke lenger, og raden er da bare
   historikk — etter dette er den en rad som vokser.

   To ting regelen IKKE gjelder, og begge er invarianter:

     · et AKTIVT abonnement. En enhet skal kunne motta varsler selv om Huskis
       ikke har vært åpnet der på et år — det er nettopp da et varsel er verdt
       mest;
     · et abonnement BRUKEREN har slått av (`revoked_at`). Det sporet er selve
       håndhevelsen av valget, ikke historikk, og det blir stående for godt.
       Se `push_revoke()` og docs/varsler.md.

   Se docs/varsler.md. */
create or replace function public.push_keep_days()
returns integer language sql immutable set search_path = public as $$ select 90 $$;

/* Signaturen utvides med metadata og med `p_explicit`, og den GAMLE må
   droppes: PostgREST velger overlast ut fra navngitte argumenter, og to
   varianter av samme funksjon ville gjort valget tvetydig. */
drop function if exists public.push_subscribe(text, text, text, jsonb, text);

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text,
                                                 p_auth text, p_labels jsonb default '{}'::jsonb,
                                                 p_tz text default null,
                                                 p_browser text default null,
                                                 p_platform text default null,
                                                 p_origin text default null,
                                                 p_device_id text default null,
                                                 p_explicit boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid     uuid   := auth.uid();
  now_ms  bigint := (extract(epoch from now()) * 1000)::bigint;
  sub_id  uuid;
  forrige uuid;
  tilbake bigint;
  mitt    boolean;
  avslatt boolean := false;
  vert    text;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_endpoint is null or p_endpoint = '' then raise exception 'mangler endepunkt'; end if;
  /* HVA ET ENDEPUNKT ER. Verdien her blir målet for et HTTP-kall senderen gjør
     på vegne av serveren, med brukerens konto som eneste inngangsbillett. Den
     skal derfor se ut som en push-tjeneste, ikke som hva som helst.

     Ingen liste over Google, Mozilla og Apple: Web Push har ingen fast
     tjenesteliste, og en slik liste ville låst appen ute fra enhver nettleser
     som ikke sto på den. Kravene under er dem standarden selv setter — https,
     et vertsnavn, ingen kontrolltegn — pluss ett til: verten skal være et
     NAVN. En bar IP-adresse eller `localhost` er ingen push-tjeneste; det er
     en måte å be serveren banke på en dør på innsiden. */
  if p_endpoint !~ '^https://[A-Za-z0-9._~%-]+(:[0-9]{1,5})?([/?#]|$)'
     or p_endpoint ~ '[[:space:][:cntrl:]]'
     or length(p_endpoint) > 2000 then
    raise exception 'ugyldig endepunkt';
  end if;
  vert := lower(split_part(substring(p_endpoint from '^https://([^/?#]+)'), ':', 1));
  if vert ~ '^[0-9.]+$' or vert = 'localhost' or vert like '%.localhost'
     or vert like '%.local' then
    raise exception 'ugyldig endepunkt';
  end if;
  if p_p256dh is null or p_auth is null then raise exception 'mangler nøkler'; end if;
  /* NØKLENE har en fast form i RFC 8291: `p256dh` er et ukomprimert P-256-punkt
     (65 byte) og `auth` er 16 byte, begge base64url fra `PushSubscription.
     getKey()`. Grensene under er romsligere enn det — de skal ikke kunne låse
     ute en nettleser som koder litt annerledes (padding) — men de holder
     søppel og fyllmasse ute av en tabell senderen leser fra. */
  if p_p256dh !~ '^[A-Za-z0-9_-]+=*$' or length(p_p256dh) not between 80 and 200
     or p_auth !~ '^[A-Za-z0-9_-]+=*$' or length(p_auth) not between 16 and 40 then
    raise exception 'ugyldige nøkler';
  end if;

  /* Hvem eide endepunktet FØR dette kallet, og hadde brukeren slått det av?
     Det første avgjør om køen som ligger der fortsatt er ment for den som nå
     bruker nettleseren; det andre om raden i det hele tatt får våkne.

     `for update` LÅSER raden, og det er ikke pynt. Uten låsen kan en helt
     vanlig bakgrunnsfornyelse spise et «Slå av» brukeren nettopp gjorde:

       A (fornyelsen)  leser `revoked_at = null`
       B (avslåingen)  setter `revoked_at` og committer
       A               skriver videre, og UPSERT-en setter `revoked_at = null`

     Da er valget borte, og ingen gjorde noe galt. Med låsen kan de to ikke
     passere hverandre: kommer fornyelsen først, venter avslåingen på den og
     vinner til slutt; kommer avslåingen først, venter fornyelsen og LESER DEN
     NYE verdien når låsen slippes (`for update` leser raden på nytt). Begge
     rekkefølgene ender med AV, som er det brukeren ba om. */
  /* Låsen på BRUKEREN først (se `push_lock()`): den dekker også det `for
     update` ikke kan se — en samtidig avslåing av en ANNEN rad i den samme
     klientkonteksten, eller av en rad som ikke finnes ennå. */
  perform public.push_lock(uid);

  select id, user_id, revoked_at into sub_id, forrige, tilbake
    from public.push_subscriptions where endpoint = p_endpoint
    for update;

  /* Er raden min i det hele tatt? Et EIERSKIFTE er unntaket fra alt under:
     tilbakekallingen var forrige brukers valg om forrige brukers varsler, og
     den skal ikke følge nettleseren over til neste konto. */
  mitt := (forrige is null or forrige = uid);

  /* ER DENNE PÅMELDINGEN AVSLÅTT? To spørsmål, ikke ett.

     1. ENDEPUNKTET. Det vanlige tilfellet: den samme nettleseren melder seg på
        igjen med det samme endepunktet, og raden sier at brukeren slo den av.

     2. KLIENTKONTEKSTEN. Et push-endepunkt er ikke evig — nettleseren eller
        push-tjenesten kan rullere det (`pushsubscriptionchange`), og en klient
        som lå ubrukt mens den ble slått av oppdager det aldri lokalt. Åpnes den
        da med et NYTT endepunkt, ville et spor som bare kjente det gamle vært
        blindt, og den automatiske fornyelsen hadde slått varslene på igjen uten
        at brukeren rørte noe.

        Konteksten er `user_id` + `device_id` + `origin`: kontoen, Huskis' egen
        tilfeldige id for denne nettleserkonteksten, og verten. Ingen måling av
        maskinen — `device_id` er et tall vi selv skrev i `localStorage`, og en
        bruker som tømmer nettleserdataene sine får med rette en ny kontekst.
        `user_id` er med nettopp fordi den SKAL avgrense: logger noen andre inn
        i den samme nettleseren, arver de ikke forrige brukers valg.

        En klient som ikke sender kontekst (en eldre versjon) får bare spørsmål
        1. Sporet er en robusthet mot rullerte endepunkter, ikke en
        sikkerhetsgrense — grensen er `user_id`, og den håndheves i begge. */
  if mitt then
    avslatt := tilbake is not null;
    if not avslatt and p_device_id is not null and p_origin is not null then
      avslatt := exists (select 1 from public.push_subscriptions s
                          where s.user_id = uid and s.revoked_at is not null
                            and s.device_id = p_device_id and s.origin = p_origin);
      /* Konteksten er avslått, altså skal ingen rad i den være aktiv — heller
         ikke et rullert endepunkt som rakk å bli registrert før sporet ble
         lest. Det følger med her, så invarianten reparerer seg selv. */
      if avslatt and sub_id is not null then perform public.push_revoke(sub_id); end if;
    end if;
  end if;

  if avslatt and not coalesce(p_explicit, false) then
    return jsonb_build_object('id', sub_id, 'revoked', true);
  end if;

  /* ET EKSPLISITT «SLÅ PÅ VARSLER» GJELDER KLIENTEN, ikke bare endepunktet.
     Brukeren står ved nettopp denne nettleseren og har sagt fra; da skal ikke
     et gammelt spor fra et rullert endepunkt i den samme konteksten avvise den
     neste fornyelsen. Sporene slettes — de har gjort jobben sin. Raden for
     endepunktet selv tas av UPSERT-en under, som skriver ferske nøkler. */
  if coalesce(p_explicit, false) and p_device_id is not null and p_origin is not null then
    delete from public.push_subscriptions
     where user_id = uid and revoked_at is not null
       and device_id = p_device_id and origin = p_origin
       and endpoint <> p_endpoint;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, labels, tz,
                                         browser, platform, origin, device_id)
  values (uid, p_endpoint, p_p256dh, p_auth, coalesce(p_labels, '{}'::jsonb), p_tz,
          p_browser, p_platform, p_origin, p_device_id)
  on conflict (endpoint) do update
     set user_id     = uid,
         p256dh      = excluded.p256dh,
         auth        = excluded.auth,
         labels      = excluded.labels,
         tz          = excluded.tz,
         browser     = coalesce(excluded.browser, public.push_subscriptions.browser),
         platform    = coalesce(excluded.platform, public.push_subscriptions.platform),
         origin      = coalesce(excluded.origin, public.push_subscriptions.origin),
         device_id   = coalesce(excluded.device_id, public.push_subscriptions.device_id),
         seen_at     = now_ms,
         disabled_at = null,
         revoked_at  = null
  returning id into sub_id;

  /* EIERSKIFTE. Endepunktet er nettleseren, og raden flyttes til den som
     logger inn i den — men køen som lå der er den FORRIGE brukerens, og hver
     av de leveringene bærer et objektnavn. Uten denne slettingen ville den nye
     brukerens nettleser vist forrige brukers varsler i det de forfalt. Køen
     tømmes derfor i den SAMME operasjonen som flytter raden. */
  if forrige is not null and forrige <> uid then
    delete from public.push_deliveries where subscription_id = sub_id;
  end if;

  /* TAKET. En bruker har en håndfull nettlesere, ikke tusen. Uten et tak kan
     en innlogget konto registrere vilkårlig mange endepunkter, og hvert av dem
     multipliserer BÅDE utboksen (én levering per planlagt varsel per
     abonnement) og antallet HTTP-kall senderen gjør. Det er en forsterker med
     en konto som eneste inngangsbillett, og den lukkes her.

     Taket kaster ut den ELDST SETTE, ikke den nyeste: den som nettopp meldte
     seg på er alltid den brukeren står med i hånden, og en bruker med mange
     nettlesere skal miste den de sluttet å bruke — ikke bli stengt ute fra
     den de bruker nå. Kaskaden tar utboksen til den som ryker med seg.

     TAKET GJELDER DET AKTIVE SETTET, og det følger av hva taket er til for.
     Forsterkeren er sendingen: bare et aktivt abonnement får en utbokslinje og
     et HTTP-kall. En rad som er død (404/410) eller slått av av brukeren
     koster ingenting der — og for den siste ville det vært direkte galt å telle
     den med, for da kunne tjue nye påmeldinger ha kastet ut nettopp det sporet
     som håndhever en avslåing. */
  delete from public.push_subscriptions s
   where s.user_id = uid
     and s.id <> sub_id                     -- den som nettopp meldte seg på ryker aldri
     and s.disabled_at is null and s.revoked_at is null
     and s.id not in (select x.id from public.push_subscriptions x
                       where x.user_id = uid and x.id <> sub_id
                         and x.disabled_at is null and x.revoked_at is null
                       order by x.seen_at desc, x.created_at desc, x.id desc
                       limit greatest(public.push_sub_max() - 1, 0));

  /* OPPRYDNING av brukerens EGNE døde spor, mens vi likevel er inne på
     radene hans. Ingen global feiing og ingen egen kjøreplan: den som melder
     seg på rydder etter seg selv.

     REGELEN TREFFER KUN 404/410-spor. Et abonnement brukeren har slått av fra
     en annen enhet blir stående for godt, og det er ikke en detalj — det er
     hele håndhevelsen. Ryddet vi det bort, ville en nettleser som ikke ble
     åpnet innen fristen møtt en database uten noe spor av avslåingen, og den
     automatiske fornyelsen hadde meldt den på igjen uten at brukeren gjorde
     noe. Valget ville altså hatt en utløpsdato ingen ba om.

     Et aktivt abonnement røres aldri (se `push_keep_days()`). */
  delete from public.push_subscriptions s
   where s.user_id = uid
     and s.id <> sub_id
     and s.revoked_at is null
     and s.disabled_at is not null
     and s.disabled_at < now_ms - public.push_keep_days() * 86400000::bigint;

  perform public.push_enqueue(uid);
  return jsonb_build_object('id', sub_id, 'revoked', false);
end;
$$;

/* Avslutter det som ligger i kø til ett abonnement. Egen funksjon fordi to
   veier trenger nøyaktig den samme avslutningen, og fordi «ventende for
   alltid» er arbeid `push_tick()` ellers våkner av hvert minutt.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.push_end_queue(p_sub uuid, p_now bigint, p_why text)
returns integer language plpgsql security definer set search_path = public as $$
declare rørt integer;
begin
  update public.push_deliveries
     set status = 'gone', done_at = coalesce(p_now, (extract(epoch from now()) * 1000)::bigint),
         error = coalesce(nullif(error, ''), p_why)
   where subscription_id = p_sub and status = 'pending';
  get diagnostics rørt = row_count;
  return rørt;
end;
$$;

/* FJERN-AVSLÅING. Brukeren står på én nettleser og slår av en annen.

   RADEN BLIR STÅENDE FOR GODT, og det er ikke historikk — det er selve
   håndhevelsen. Den avslåtte nettleseren fornyer abonnementet sitt hver gang
   den åpnes, og `push_subscribe()` kjenner igjen endepunktet og lar være.
   Forsvant sporet, ville den samme fornyelsen meldt nettleseren på igjen uten
   at brukeren gjorde noe: avslåingen ville hatt en utløpsdato. Derfor rører
   verken taket eller opprydningen en rad med `revoked_at` satt.

   NØKLENE TØMMES samtidig. `p256dh`/`auth` er mottakernøklene som gjør det
   mulig å KRYPTERE til nettleseren, og et abonnement brukeren har slått av
   skal ikke bli liggende med dem i det uendelige. Raden trenger bare
   endepunktet — det er identiteten fornyelsen kjennes igjen på — og
   `push_subscribe()` skriver ferske nøkler den dagen brukeren slår varslene
   på igjen der.

   Ellers er raden inert: utboksen får ingen nye rader, senderen plukker ingen
   opp, og det som allerede lå i kø AVSLUTTES her — ellers ville et varsel
   brukeren nettopp slo av kommet fram noen minutter senere.

   Autorisasjonen er hele poenget: `user_id = auth.uid()`. En id som ikke er
   min treffer ingen rad, og svaret er `false` — ikke en feil som ville
   fortalt at raden finnes. */
create or replace function public.push_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  d      text;
  o      text;
  r      record;
  traff  integer := 0;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_id is null then return false; end if;
  /* Finnes raden, og er den min? Et fremmed id svarer `false` og røper ikke at
     raden finnes. Konteksten leses her fordi den avgjør HVOR LANGT
     avslåingen rekker; låsen tas rett etter, og da leses radene på nytt. */
  select device_id, origin into d, o
    from public.push_subscriptions where id = p_id and user_id = uid;
  if not found then return false; end if;

  perform public.push_lock(uid);

  /* HANDLINGEN GJELDER ENHETEN, IKKE URL-EN. Brukeren trykker «Slå av» på en
     rad som sier «Chrome · Android», og mener nettleseren — ikke det tekniske
     endepunktet raden tilfeldigvis bærer nå. Forskjellen er ikke akademisk:
     ruller nettleseren endepunktet sitt, kan den SAMME klienten i en periode ha
     to rader (`E1` fra før, `E2` fra fornyelsen). Slo vi bare av den ene, ville
     enheten fortsatt fått varsler etter at brukeren slo den av.

     Derfor slås hele klientkonteksten av: `user_id` + `device_id` + `origin`.
     For en eldre rad uten kontekst (klienten sendte den ikke) faller vi tilbake
     til nettopp den raden — det er alt vi vet om den.

     IDEMPOTENT: `coalesce` holder det opprinnelige tidspunktet, og en rad som
     alt er tilbakekalt svarer `true`. To faner som slår av den samme enheten
     samtidig har begge fått viljen sin — det er ingen feil å melde.

     MOTTAKERNØKLENE tømmes: ingen rad skal bli liggende med det som gjør det
     mulig å kryptere til nettleseren. `endpoint`, `device_id` og `origin` blir
     derimot stående — det er dem `push_subscribe()` kjenner sporet igjen på,
     og tømte vi dem, ville avslåingen sluttet å gjelde et rullert endepunkt. */
  for r in select s.id from public.push_subscriptions s
            where s.user_id = uid
              and (s.id = p_id
                   or (d is not null and o is not null
                       and s.device_id = d and s.origin = o
                       /* de andre i konteksten: bare de AKTIVE. En rad som alt
                          er død (404/410) skal ikke gjøres om til et
                          brukerinitiert, permanent spor. */
                       and s.revoked_at is null and s.disabled_at is null))
  loop
    update public.push_subscriptions
       set revoked_at = coalesce(revoked_at, now_ms),
           p256dh = '', auth = '', labels = '{}'::jsonb, tz = null
     where id = r.id;
    perform public.push_end_queue(r.id, now_ms, 'slått av av brukeren');
    traff := traff + 1;
  end loop;
  return traff > 0;
end;
$$;

/* «Slå av varsler på alle andre enheter.» Endepunktet som skal BLI stående er
   nettleserens eget — den brukeren står med i hånden. Uten et endepunkt slås
   alle av, som er den riktige tolkningen fra en klient som ikke har et.

   Bare de AKTIVE slås av — det er dem listen viser, og det er dem handlingen
   heter. En rad som alt er død (404/410) skal ikke gjøres om til et
   brukerinitiert, permanent spor av en handling brukeren mente om noe annet.

   DET SOM BLIR STÅENDE ER KLIENTEN, ikke bare URL-en. Kjenner vi konteksten
   til endepunktet som ringte (`device_id` + `origin`), spares HELE den — ellers
   ville en helt vanlig endepunktrullering på nettopp denne nettleseren slått av
   brukerens egen enhet mens hun trykket «alle andre». Uten kontekst faller vi
   tilbake til endepunktet, som før.

   Låsen tas FØR listen leses. Uten den kunne en samtidig fornyelse fra en av de
   andre kontekstene ha opprettet en ny, aktiv rad rett etter at løkken leste
   listen sin — og enheten brukeren nettopp slo av hadde stått igjen som på. */
create or replace function public.push_revoke_others(p_endpoint text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  antall integer := 0;
  d      text;
  o      text;
  r      record;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  perform public.push_lock(uid);
  if p_endpoint is not null then
    select device_id, origin into d, o
      from public.push_subscriptions where user_id = uid and endpoint = p_endpoint;
  end if;
  for r in select id from public.push_subscriptions s
            where s.user_id = uid and s.revoked_at is null and s.disabled_at is null
              and (p_endpoint is null or s.endpoint <> p_endpoint)
              and (d is null or o is null
                   or s.device_id is distinct from d or s.origin is distinct from o)
  loop
    /* Tallet er ENHETER, ikke rader: slo avslåingen av forrige rad allerede av
       hele konteksten denne raden hører til (et rullert endepunkt), er den
       enheten alt talt. */
    if exists (select 1 from public.push_subscriptions
                where id = r.id and revoked_at is null)
       and public.push_revoke(r.id) then
      antall := antall + 1;
    end if;
  end loop;
  return antall;
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  delete from public.push_subscriptions where user_id = uid and endpoint = p_endpoint;
end;
$$;

/* SENDERENS side. Begge er avgrenset til service_role — de leser andres rader
   og må derfor aldri være kallbare med anon-nøkkelen (se grants nederst). Rolle-
   sjekken står i tillegg til grantene: et bom i en senere grant-runde skal ikke
   åpne dem stille.

   push_claim() LÅSER det den leverer: `claimed_at` settes, og en levering
   plukkes ikke opp igjen før låsen er blitt eldre enn p_lock_ms. Dermed kan to
   samtidige kjøringer ikke sende det samme varselet to ganger, og en kjøring
   som dør halvveis blir hentet inn igjen av den neste i stedet for å bli
   stående. `for update skip locked` gjør det samme innenfor ett øyeblikk. */
create or replace function public.push_claim(p_limit integer default 50,
                                             p_lock_ms bigint default 300000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  result jsonb;
begin
  if not public.is_service_role() then raise exception 'kun service_role'; end if;

  with forfalt as (
    select d.id
      from public.push_deliveries d
     where d.status = 'pending'
       and d.due_at <= now_ms
       and (d.claimed_at is null or now_ms - d.claimed_at >= coalesce(p_lock_ms, 300000))
       /* Abonnementet må fortsatt gjelde: eid av den samme brukeren, og ikke
          slått av. Eierskiftet er andre lag — push_subscribe() tømmer køen —
          så en rad som likevel skulle bli hengende igjen blir INERT i stedet
          for å bli levert til feil bruker. `disabled_at` er svaret fra
          push-tjenesten selv: 404/410 betyr at endepunktet er borte, og da er
          resten av køen til det endepunktet like usendbar som den første. */
       and exists (select 1 from public.push_subscriptions s
                    where s.id = d.subscription_id
                      and s.user_id = d.user_id
                      and s.disabled_at is null
                      and s.revoked_at is null)
     order by d.due_at
     limit greatest(coalesce(p_limit, 50), 1)
       for update skip locked
  ), tatt as (
    update public.push_deliveries d
       set claimed_at = now_ms, attempts = d.attempts + 1
      from forfalt f
     where d.id = f.id
    returning d.id, d.notification_id, d.subscription_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'endpoint', s.endpoint,
           'p256dh', s.p256dh,
           'auth', s.auth,
           /* Kroppen service workeren viser. Navnet på objektet og
              varseltypen i klartekst på brukerens språk — ingen sti, ingen
              kontekst, ingen token, ingen id-er utover pekeren klikket
              trenger. Kroppen krypteres ende-til-ende (RFC 8291), så
              push-tjenesten ser den aldri. */
           'payload', jsonb_build_object(
             'k', n.key, 't', n.type, 'n', n.name,
             'b', coalesce(s.labels ->> n.type, ''),
             'ot', n.obj_type, 'oi', n.obj_id, 'at', n.at)
         )), '[]'::jsonb)
    into result
    from tatt t
    join public.notifications n on n.id = t.notification_id
    join public.push_subscriptions s on s.id = t.subscription_id;

  return result;
end;
$$;

/* Resultatet av forsøket, per levering:
     { "id": 12, "ok": true }                → sendt
     { "id": 12, "gone": true }              → 404/410: abonnementet er dødt,
                                               og slås av for godt
     { "id": 12, "error": "503" }            → midlertidig; prøves igjen til
                                               forsøkene er brukt opp
   Et abonnement som er dødt slås av HER, ikke i senderen: da er avgjørelsen
   ett sted, og en senere sender arver den uten å vite noe om HTTP. */
create or replace function public.push_report(p_results jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  now_ms bigint  := (extract(epoch from now()) * 1000)::bigint;
  rørt   integer := 0;
begin
  if not public.is_service_role() then raise exception 'kun service_role'; end if;

  with r as (
    select x.id, coalesce(x.ok, false) as ok, coalesce(x.gone, false) as gone,
           left(coalesce(x.error, ''), 200) as error
      from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb))
        as x(id bigint, ok boolean, gone boolean, error text)
     where x.id is not null
  ), oppdatert as (
    update public.push_deliveries d
       set status  = case when r.ok then 'sent'
                          when r.gone then 'gone'
                          when d.attempts >= 5 then 'failed'
                          else 'pending' end,
           done_at = case when r.ok or r.gone or d.attempts >= 5 then now_ms else null end,
           error   = nullif(r.error, ''),
           -- En midlertidig feil skal kunne plukkes opp igjen med en gang.
           claimed_at = case when r.ok or r.gone then d.claimed_at else null end
      from r
     where d.id = r.id
    returning d.subscription_id, r.gone
  )
  update public.push_subscriptions s
     set disabled_at = now_ms
    from oppdatert o
   where s.id = o.subscription_id and o.gone and s.disabled_at is null;

  /* … og køen til et dødt endepunkt AVSLUTTES, den blir ikke bare liggende.
     `push_claim()` ville aldri plukket den opp igjen (se der), men en rad som
     står som `pending` i det uendelige er arbeid `push_tick()` våkner av hvert
     minutt uten at noe kan lykkes. Her tar den slutt, eksplisitt.

     Sveipet går over ALLE døde abonnementer, ikke bare det som nettopp ble
     slått av: da rydder den også opp etter en rad som skulle ha blitt hengende
     igjen fra før. */
  update public.push_deliveries d
     set status  = 'gone',
         done_at = now_ms,
         error   = coalesce(nullif(d.error, ''), 'abonnementet er dødt')
   where d.status = 'pending'
     and exists (select 1 from public.push_subscriptions s
                  where s.id = d.subscription_id
                    and (s.disabled_at is not null or s.revoked_at is not null));

  select count(*) into rørt from jsonb_array_elements(coalesce(p_results, '[]'::jsonb));
  return rørt;
end;
$$;

/* KJØREPLANEN: pg_cron kaller denne, og den dytter Edge-funksjonen i gang med
   pg_net — nøyaktig det samme oppsettet e-postvarselet allerede bruker
   (8b), med hemmeligheten i Vault og adressen i app_config.

   Uten konfigurasjon gjør den INGENTING og feiler ikke: web push er en
   valgfri kanal, og en database uten nøkkel skal fungere som før. Den er
   dessuten en ren dytt — all tilstand ligger i utboksen, så et tapt tikk
   koster forsinkelse, ikke leveranser. Neste tikk tar det samme arbeidet. */
/* Hvor mye arbeid som FAKTISK kan sendes akkurat nå. Ikke bare «pending og
   forfalt»: en levering til et abonnement som er slått av (404/410) eller som
   har byttet eier kan aldri lykkes, og skal derfor ikke vekke senderen. Står
   som en egen funksjon fordi `push_tick()` og testene må måle det SAMME.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.push_due_count()
returns bigint language sql stable set search_path = public as $$
  select count(*)
    from public.push_deliveries d
    join public.push_subscriptions s on s.id = d.subscription_id
   where d.status = 'pending'
     and d.due_at <= (extract(epoch from now()) * 1000)::bigint
     and s.user_id = d.user_id
     and s.disabled_at is null
     and s.revoked_at is null;
$$;

/* HEADERNE tikket sender. Egen funksjon av samme grunn som `push_due_count()`:
   `push_tick()` og testene må se det SAMME — og dette er lett å få galt.

   De to nøkkeltypene skal IKKE ha like headere:

     sb_secret_…    De nye API-nøklene er ikke JWT-er. Supabase dokumenterer at
                    de sendes på `apikey`, og at en nøkkel som SAMTIDIG ligger
                    på `Authorization: Bearer` blir forsøkt tolket som JWT og
                    avvist med «Invalid JWT». Å sende begge for sikkerhets
                    skyld ødelegger altså nettopp den veien vi vil bruke.

     service_role   Den gamle nøkkelen ER et JWT, og pg_net har alltid sendt
                    den på `Authorization`. Den får begge, uendret.

   Kjennetegnet er formen: tre base64url-segmenter med punktum mellom er et
   JWT. Signaturen sjekkes ikke — spørsmålet er bare om plattformen kommer til
   å prøve å tolke verdien som et token.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.push_headers(p_key text)
returns jsonb language sql immutable as $$
  select case
    when p_key ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      then jsonb_build_object('Content-Type', 'application/json',
                              'apikey', p_key,
                              'Authorization', 'Bearer ' || p_key)
    else jsonb_build_object('Content-Type', 'application/json',
                            'apikey', p_key)
  end;
$$;

create or replace function public.push_tick()
returns bigint language plpgsql security definer
set search_path = public, extensions, net as $$
declare
  fn_url  text;
  svc_key text;
  ventende bigint;
  req_id  bigint;
begin
  ventende := public.push_due_count();
  if ventende = 0 then return null; end if;

  select value into fn_url from public.app_config where key = 'push_function_url';
  if fn_url is null or fn_url = '' then return null; end if;

  begin
    select decrypted_secret into svc_key from vault.decrypted_secrets
     where name = 'push_service_key' limit 1;
  exception when others then svc_key := null;
  end;
  if svc_key is null then
    select value into svc_key from public.app_config where key = 'push_service_key';
  end if;
  if svc_key is null or svc_key = '' then return null; end if;

  select net.http_post(
      url := fn_url,
      headers := public.push_headers(svc_key),
      body := jsonb_build_object('reason', 'cron'),
      timeout_milliseconds := 20000)
    into req_id;
  return req_id;
exception when others then
  -- Aldri kast: tikket er en dytt, ikke en transaksjon noen venter på.
  return null;
end;
$$;

/* KJØREPLANEN, hvis pg_cron er skrudd på i prosjektet. Ett tikk i minuttet er
   den oppløsningen varslene trenger: tersklene er «frist utløpt» og «innen en
   uke», ikke alarmer på sekundet, og et forsinket tikk taper ingenting —
   utboksen står der til den er tømt.

   Hoppes over uten pg_cron (lokal PostgreSQL, testsuiten). Idempotent:
   `cron.schedule` med samme navn erstatter den forrige planen. */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('huskis-push-tick', '* * * * *', 'select public.push_tick()');
  end if;
exception when others then null;   -- manglende rettighet skal ikke velte migreringen
end $$;

-- ------------------------------------------------------------
-- 8e2. NATIVE VARSEL-RPC-ER — Android-appens plass i «Enheter med varsler»
--
--    Android varsler LOKALT: alarmene ligger på telefonen, og ingen server
--    leverer dem. Det som mangler er derfor ikke en leveringskanal, men en
--    STATUS — serveren må vite at kanalen er på der, ellers kan ingen annen
--    enhet se den eller slå den av.
--
--    native_notif_touch(enabled, browser, platform, origin, device_id, explicit)
--      Klienten rapporterer sin egen kanalstatus for sin egen klientkontekst
--      (aldri en annens — `user_id` settes fra `auth.uid()`). Svarer om
--      konteksten er fjern-avslått, som er måten en åpen app OPPDAGER at en
--      annen enhet slo den av.
--
--    native_notif_revoke(id)
--      Fjern-avslåing av ÉN native klient. Samme semantikk som
--      `push_revoke()`: valget blir stående, og bare et eksplisitt «slå på
--      varsler» på nettopp den klienten tar det tilbake.
--
--    notif_revoke_others(endpoint, device_id, origin)
--      «Slå av varsler på alle andre enheter», nå for BEGGE kanaltypene:
--      `push_revoke_others()` for nettleserne, og de native klientene som ikke
--      er kalleren selv. Gjeldende klient beholdes uansett hvilken type den er.
--
--    HVA DENNE MODELLEN IKKE KAN: en LUKKET Android-app. Alarmene er allerede
--    lagt i operativsystemets alarmkø, og uten en pushkanal (FCM) har serveren
--    ingen vei inn til å avlyse dem. Avslåingen registreres derfor umiddelbart
--    her, og gjennomføres på telefonen neste gang appen er i bruk og får
--    kontakt. Autoritativt: docs/varsler.md.
-- ------------------------------------------------------------

/* DE AKTIVE NATIVE VARSELENHETENE for én bruker.

   Tre ledd, og det tredje er det som gjør listen sann: kanalen er på
   (`enabled`), brukeren har ikke slått den av fra en annen enhet
   (`revoked_at`), OG klientkonteksten har fortsatt en levende økt. Uten det
   siste ville en app som ble logget ut — lokalt, fra en annen enhet, eller ved
   at kontoen ble slettet — blitt stående som en «enhet med varsler» helt til
   den ble åpnet igjen og rakk å si fra selv. Utloggingen skal ikke være
   avhengig av at den utloggede klienten samarbeider.

   Feiler oppslaget i `auth.sessions` (rettigheten mangler i et prosjekt),
   svarer vi ÅPENT — de samme radene uten øktkravet. Det er det samme valget
   som `session_alive()` tar: en manglende opplysning skal ikke kunne skjule en
   enhet brukeren faktisk har.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.native_notif_active(p_uid uuid)
returns setof public.native_notif_devices
language plpgsql stable security definer set search_path = public as $$
begin
  if p_uid is null then return; end if;
  begin
    return query
      select n.* from public.native_notif_devices n
       where n.user_id = p_uid and n.enabled and n.revoked_at is null
         and exists (select 1 from public.device_sessions d
                      join auth.sessions x on x.id = d.session_id
                     where d.user_id = n.user_id
                       and d.device_id = n.device_id and d.origin = n.origin);
  exception when others then
    return query
      select n.* from public.native_notif_devices n
       where n.user_id = p_uid and n.enabled and n.revoked_at is null;
  end;
end;
$$;

/* KLIENTEN MELDER FRA om sin egen native varselkanal.

   `p_explicit` er hele forskjellen på en RAPPORT og et VALG, nøyaktig som i
   `push_subscribe()`: den automatiske runden (innlogging, hvert kvarter) skal
   aldri kunne oppheve at brukeren slo av varslene her fra en annen enhet. Bare
   et trykk på bryteren på nettopp denne klienten gjør det.

   Låsen er den samme som abonnementene bruker (`push_lock()`): «slå av varsler
   på alle andre enheter» spenner over begge kanaltypene, og de to må derfor
   serialiseres mot hverandre. Uten den kunne en helt vanlig statusrunde fra
   telefonen sneket seg inn etter at løkken leste listen sin, og enheten
   brukeren nettopp slo av hadde stått igjen som på. */
create or replace function public.native_notif_touch(p_enabled boolean,
                                                     p_browser text default null,
                                                     p_platform text default null,
                                                     p_origin text default null,
                                                     p_device_id text default null,
                                                     p_explicit boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid     uuid   := auth.uid();
  now_ms  bigint := (extract(epoch from now()) * 1000)::bigint;
  dev     text   := left(p_device_id, 60);
  org     text   := left(p_origin, 120);
  rad_id  uuid;
  tilbake bigint;
  vil     boolean := coalesce(p_enabled, false);
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  /* Uten en klientkontekst finnes det ingen rad å skrive: raden ER konteksten,
     og en rad uten den ville verken kunne slås av eller kjennes igjen. */
  if dev is null or dev = '' or org is null or org = '' then
    raise exception 'mangler klientkontekst';
  end if;

  perform public.push_lock(uid);

  select id, revoked_at into rad_id, tilbake
    from public.native_notif_devices
   where user_id = uid and device_id = dev and origin = org
   for update;

  /* FJERN-AVSLÅTT, og runden er ikke et eksplisitt «slå på». Da står valget:
     raden blir liggende avslått, og svaret sier fra slik at appen kan rigge
     ned sin egen ende (avlyse alarmene, sette bryteren av). */
  if tilbake is not null and not coalesce(p_explicit, false) then
    update public.native_notif_devices
       set enabled  = false,
           browser  = coalesce(left(p_browser, 40), browser),
           platform = coalesce(left(p_platform, 40), platform),
           seen_at  = now_ms
     where id = rad_id;
    return jsonb_build_object('id', rad_id, 'revoked', true, 'enabled', false);
  end if;

  /* EN KLIENT SOM ALDRI HAR HATT VARSLER PÅ TRENGER INGEN RAD. Runden går fra
     hver innlogging på hver Android-enhet, også de som aldri slår varslene på;
     uten denne linjen ville tabellen fylt seg med rader som bare sier «av».
     Utloggingens egen avmelding er det samme tilfellet — finnes det ingen rad,
     er det ingenting å slå av. */
  if rad_id is null and not vil then
    return jsonb_build_object('id', null, 'revoked', false, 'enabled', false);
  end if;

  insert into public.native_notif_devices (user_id, device_id, origin, browser, platform, enabled)
  values (uid, dev, org, left(p_browser, 40), left(p_platform, 40), vil)
  on conflict (user_id, device_id, origin) do update
     set browser  = coalesce(left(p_browser, 40), public.native_notif_devices.browser),
         platform = coalesce(left(p_platform, 40), public.native_notif_devices.platform),
         enabled  = vil,
         seen_at  = now_ms,
         /* Bare et eksplisitt «slå PÅ» opphever en fjern-avslåing. Et
            eksplisitt «slå av» trenger ikke gjøre det — raden er av uansett,
            og sporet koster ingenting. */
         revoked_at = case when coalesce(p_explicit, false) and vil
                           then null else public.native_notif_devices.revoked_at end
  returning id into rad_id;

  return jsonb_build_object('id', rad_id, 'revoked', false, 'enabled', vil);
end;
$$;

/* FJERN-AVSLÅING av ÉN native klient. Speiler `push_revoke()`: raden blir
   stående som sporet som HÅNDHEVER valget, og bare et eksplisitt «slå på
   varsler» der tar det tilbake. Ingen løkke over konteksten — den unike
   indeksen gjør at én kontekst ER én rad.

   `false` når id-en ikke er min: samme svar som for en id som ikke finnes, for
   en feilmelding ville i seg selv fortalt at raden eksisterte.

   Alarmene ligger på telefonen. Serveren kan derfor ikke avlyse dem her — den
   registrerer valget, og appen gjennomfører det i sin neste synk-runde. */
create or replace function public.native_notif_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  traff  integer;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_id is null then return false; end if;
  if not exists (select 1 from public.native_notif_devices
                  where id = p_id and user_id = uid) then
    return false;
  end if;
  perform public.push_lock(uid);
  -- Idempotent: en rad som alt er avslått beholder tidspunktet sitt, og svarer
  -- `true`. To faner som slår av den samme enheten har begge fått viljen sin.
  update public.native_notif_devices
     set revoked_at = coalesce(revoked_at, now_ms), enabled = false
   where id = p_id and user_id = uid;
  get diagnostics traff = row_count;
  return traff > 0;
end;
$$;

/* «SLÅ AV VARSLER PÅ ALLE ANDRE ENHETER» — på tvers av begge kanaltypene.

   Nettleserne tas av `push_revoke_others()`, som eier hele den semantikken fra
   før (klientkonteksten til endepunktet som ringte spares, ikke bare URL-en).
   Her legges de native klientene til, med den samme regelen: alle unntatt
   kallerens egen kontekst.

   Kalleren sender sin egen kontekst inn. En nettleser har ingen native rad å
   spare, og en telefon har ikke noe endepunkt — begge sender likevel det de
   har, og det som ikke treffer noe er et no-op.

   Låsen tas FØR listen leses, av samme grunn som i `push_revoke_others()`: en
   samtidig statusrunde fra en av de andre klientene skal ikke kunne melde seg
   på igjen rett etter at løkken leste listen sin. */
create or replace function public.notif_revoke_others(p_endpoint text default null,
                                                      p_device_id text default null,
                                                      p_origin text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  antall integer := 0;
  dev    text := left(p_device_id, 60);
  org    text := left(p_origin, 120);
  r      record;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  perform public.push_lock(uid);
  antall := public.push_revoke_others(p_endpoint);
  for r in select n.id from public.native_notif_devices n
            where n.user_id = uid and n.enabled and n.revoked_at is null
              and (dev is null or dev = '' or org is null or org = ''
                   or n.device_id is distinct from dev
                   or n.origin is distinct from org)
  loop
    if public.native_notif_revoke(r.id) then antall := antall + 1; end if;
  end loop;
  return antall;
end;
$$;

-- ------------------------------------------------------------
-- 8f. ØKT-RPC-ER — «hvor er jeg logget inn?» og fjern-utlogging
--
--    Supabase Auth eier øktene. Disse tre legger bare et lesbart lag over
--    dem, og all autorisasjon er den samme setningen tre ganger:
--    `user_id = auth.uid()`. En økt-id som ikke er min treffer ingen rad.
--
--    session_touch(browser, platform, origin, device_id)
--      Klienten melder seg levende og skriver den gjenkjennelige metadataen
--      for SIN EGEN økt (aldri en annens — id-en tas fra claimet, ikke fra
--      et argument). Svaret sier også om økten fortsatt finnes; en klient som
--      er fjern-utlogget lærer det her.
--
--    list_my_devices(endpoint)
--      Én runde som svarer på begge spørsmålene UI-et stiller: hvor er
--      kontoen innlogget, og hvilke nettlesere har varsler på. Endepunktet er
--      klientens eget og brukes KUN til å merke «denne enheten» — det er
--      derfor ingen endepunkter går den andre veien.
--
--    revoke_my_session(session_id)
--      Fjern-utlogging av ÉN økt. Sletter raden i `auth.sessions`, som er det
--      som faktisk avslutter økten hos Supabase: refresh-tokenet virker ikke
--      lenger, og klienten kan ikke fornye seg. Et allerede utstedt
--      access-token lever til `exp` — det er Supabases egen semantikk, og
--      Huskis bygger ikke et nytt auth-lag for å omgå den. I praksis oppdager
--      klienten tilstanden i neste synk-runde (`get_my_doc().session_ok`).
--
--    «Logg ut på alle andre enheter» finnes IKKE her: supabase-js har
--    `signOut({ scope: 'others' })`, som er plattformens egen støttede vei.
--    Autoritativt: docs/accounts.md.
-- ------------------------------------------------------------

/* Finnes økten fortsatt hos Supabase, og er den min? `null` inn (ukjent
   claim) svarer `true`: en manglende opplysning skal aldri kunne leses som
   en tilbakekalling og logge noen ut. */
create or replace function public.session_alive(p_session uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); finnes boolean;
begin
  if uid is null or p_session is null then return true; end if;
  begin
    select exists (select 1 from auth.sessions x
                    where x.id = p_session and x.user_id = uid) into finnes;
  exception when others then
    /* `auth.sessions` er Supabase Auth sin tabell, ikke vår. Skulle rettigheten
       dit mangle i et prosjekt, er svaret «vi vet ikke» — og det leses som
       LEVENDE. `get_my_doc()` kaller denne hver eneste synk-runde: en feil her
       ville ellers veltet hele doc-et og tatt appen ned for alle, for en
       opplysning som bare gjelder én knapp. */
    return true;
  end;
  return finnes;
end;
$$;

/* Rader uten en levende økt. Supabase rydder `auth.sessions` på sin egen
   rytme (utløpte økter slettes en stund etter at de gikk ut), og et sidebord
   uten fremmednøkkel må derfor luke selv. Kjøres av `session_touch()` — bundet
   til ÉN bruker, aldri som en global feiing, og aldri fra listingen, som en
   åpen skuff kaller hver synk-runde.
   INTERN: ingen EXECUTE til klientroller (se grants nederst). */
create or replace function public.prune_device_sessions(p_uid uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare rørt integer;
begin
  if p_uid is null then return 0; end if;
  delete from public.device_sessions d
   where d.user_id = p_uid
     and not exists (select 1 from auth.sessions x where x.id = d.session_id);
  get diagnostics rørt = row_count;
  return rørt;
end;
$$;

create or replace function public.session_touch(p_browser text default null,
                                                p_platform text default null,
                                                p_origin text default null,
                                                p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid    uuid   := auth.uid();
  sid    uuid   := public.current_session_id();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  -- Er økten borte, skal ingenting skrives: en rad for en død økt ville stått
  -- igjen i listen som en enhet brukeren ikke kan logge ut.
  if not public.session_alive(sid) then
    return jsonb_build_object('ok', false, 'session', sid);
  end if;
  if sid is not null then
    insert into public.device_sessions (session_id, user_id, browser, platform, origin, device_id)
    values (sid, uid, left(p_browser, 40), left(p_platform, 40),
            left(p_origin, 120), left(p_device_id, 60))
    on conflict (session_id) do update
       set user_id   = uid,
           browser   = coalesce(left(p_browser, 40), public.device_sessions.browser),
           platform  = coalesce(left(p_platform, 40), public.device_sessions.platform),
           origin    = coalesce(left(p_origin, 120), public.device_sessions.origin),
           device_id = coalesce(left(p_device_id, 60), public.device_sessions.device_id),
           seen_at   = now_ms;
  end if;
  perform public.prune_device_sessions(uid);
  return jsonb_build_object('ok', true, 'session', sid);
end;
$$;

/* Signaturen utvides med klientkonteksten (den native halvdelen av listen
   trenger den for å merke «denne enheten»), og den GAMLE må droppes:
   PostgREST velger overlast ut fra navngitte argumenter, og to varianter av
   samme funksjon ville gjort valget tvetydig. En eldre klient som bare sender
   `p_endpoint` treffer fortsatt denne — de to nye har default. */
drop function if exists public.list_my_devices(text);

create or replace function public.list_my_devices(p_endpoint text default null,
                                                  p_device_id text default null,
                                                  p_origin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  sid  uuid := public.current_session_id();
  res  jsonb;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  /* Ingen luking her. Listen leses fra `auth.sessions` og venstre-joiner
     sidebordet, så en foreldreløs rad er allerede usynlig — og en åpen skuff
     kaller denne hver synk-runde. En DELETE hvert femte sekund ville vært
     skriving uten en eneste ny opplysning. `session_touch()` luker, hvert
     tiende minutt. */

  select jsonb_build_object(
    /* ØKTENE. Sannheten er `auth.sessions`; sidebordet gir bare navnene. En
       økt uten en `device_sessions`-rad er en ekte økt (den kan være
       opprettet av en eldre klient) og skal med — uten navn, men med tid.
       `seenAt` tar det ferskeste av de to kildene: Supabase stempler
       `refreshed_at` når tokenet fornyes, klienten stempler `seen_at` når den
       er i bruk. Hverken IP eller user-agent forlater databasen. */
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id,
               'current', (sid is not null and x.id = sid),
               'browser', d.browser, 'platform', d.platform, 'origin', d.origin,
               'createdAt', least(
                  coalesce(d.created_at, (extract(epoch from x.created_at) * 1000)::bigint),
                  (extract(epoch from x.created_at) * 1000)::bigint),
               'seenAt', greatest(
                  coalesce(d.seen_at, 0),
                  (extract(epoch from coalesce(x.refreshed_at, x.updated_at, x.created_at)) * 1000)::bigint))
             order by (sid is not null and x.id = sid) desc,
                      greatest(coalesce(d.seen_at, 0),
                        (extract(epoch from coalesce(x.refreshed_at, x.updated_at, x.created_at)) * 1000)::bigint) desc,
                      x.id)
        from auth.sessions x
        left join public.device_sessions d on d.session_id = x.id
       where x.user_id = uid), '[]'::jsonb),

    /* VARSELENHETENE — begge kanaltypene i ÉN liste, fordi det er ETT
       spørsmål: hvor kommer varslene også når Huskis er lukket? Skilte vi dem,
       ville UI-et fått to seksjoner brukeren ikke kan skille fra hverandre
       («nettlesere med web push» og «apper med lokale alarmer» er en teknisk
       forskjell, ikke en forskjell hun har bedt om).

       WEB: bare de AKTIVE abonnementene. En rad som er død (404/410) eller
       tilbakekalt er ikke en enhet brukeren kan slå av, den er et spor. Og
       aldri endepunktet — det er adressen varslene sendes til, og den har
       ingenting i et UI å gjøre. «Denne enheten» avgjøres av at klientens eget
       endepunkt matcher, altså uten at endepunktet går ut.

       NATIVE: Android-appene med kanalen på og en levende økt
       (`native_notif_active`). `origin` er `null` med vilje: verten er
       appens interne (`localhost`), og den er en KONTEKSTNØKKEL her, ikke en
       adresse brukeren har vært på. En rad som sier «Huskis · Android» er
       allerede så navngitt den kan bli.

       `kind` er det klienten dispatcher på når raden slås av: et abonnement og
       en native klient slås av på hver sin måte. */
    'push', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'current', e.current,
               'browser', e.browser, 'platform', e.platform, 'origin', e.origin,
               'createdAt', e.created_at, 'seenAt', e.seen_at)
             order by e.current desc, e.seen_at desc, e.id)
        from (
          select s.id, 'web'::text as kind,
                 (p_endpoint is not null and s.endpoint = p_endpoint) as current,
                 s.browser, s.platform, s.origin, s.created_at, s.seen_at
            from public.push_subscriptions s
           where s.user_id = uid and s.disabled_at is null and s.revoked_at is null
          union all
          select n.id, 'native'::text,
                 (p_device_id is not null and p_device_id <> ''
                  and p_origin is not null and p_origin <> ''
                  and n.device_id = p_device_id and n.origin = p_origin),
                 n.browser, n.platform, null::text, n.created_at, n.seen_at
            from public.native_notif_active(uid) n
        ) e), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;

/* FJERN-UTLOGGING av én økt. Sletter raden i `auth.sessions` — det er den som
   holder refresh-tokenet i live, og uten den kan klienten ikke fornye seg.
   Refresh-tokenene slettes eksplisitt først: kaskaden i auth-skjemaet gjør
   det samme, men vi eier ikke det skjemaet og skal ikke anta fasongen på det.

   `false` når id-en ikke er min — samme svar som for en id som ikke finnes.
   En feilmelding ville i seg selv fortalt at raden eksisterte. */
create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); traff integer;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_session_id is null then return false; end if;
  if not exists (select 1 from auth.sessions x
                  where x.id = p_session_id and x.user_id = uid) then
    return false;
  end if;
  /* Refresh-tokenene først. Kaskaden i auth-skjemaet gjør det samme, men vi
     eier ikke det skjemaet og skal ikke anta fasongen på det. At vi mangler
     rettighet nettopp der er derimot ingen grunn til å la økten leve videre:
     slettingen under er den som teller, og kaskaden rydder resten. */
  if to_regclass('auth.refresh_tokens') is not null then
    begin
      execute 'delete from auth.refresh_tokens where session_id = $1' using p_session_id;
    exception when insufficient_privilege then null;
    end;
  end if;
  delete from auth.sessions where id = p_session_id and user_id = uid;
  get diagnostics traff = row_count;
  delete from public.device_sessions where session_id = p_session_id and user_id = uid;
  return traff > 0;
end;
$$;

-- ------------------------------------------------------------
-- 9. MEDLEMSLISTE — deduplisert, kategorisert og med capabilities
--
--    Kategori-presedens (en bruker vises ALDRI to ganger):
--      1 områdeeier  2 eksplisitt mappeeier  3 områdemedlem  4 mappemedlem
--    Områdeeiere/-medlemmer vises også i MAPPERS medlemsliste, men kan ikke
--    fjernes der (`removable = false` + forklaring) — de må fjernes fra
--    området. Ventende invitasjoner er en EGEN seksjon og teller ikke som
--    medlemmer.
-- ------------------------------------------------------------

create or replace function public.get_members(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  uni  uuid;
  rows jsonb;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  if p_type not in ('universe', 'group') then
    raise exception 'kun områder og mapper har medlemslister (fikk: %)', p_type;
  end if;
  if not public.can_read(p_type, p_id, uid) then raise exception 'ingen tilgang'; end if;
  uni := public.resource_universe(p_type, p_id);

  with acc as (
    select m.user_id,
           case when m.role = 'owner' then 1 else 3 end as prec,
           case when m.role = 'owner' then 'universeOwner' else 'universeMember' end as category,
           m.role as role,
           'universe'::text as source,
           (p_type = 'universe') as direct
      from public.memberships m
     where m.universe_id = uni
    union all
    select m.user_id,
           case when m.role = 'owner' then 2 else 4 end,
           case when m.role = 'owner' then 'groupOwner' else 'groupMember' end,
           m.role, 'group'::text, true
      from public.memberships m
     where p_type = 'group' and m.group_id = p_id
  ),
  best as (
    select distinct on (user_id) * from acc order by user_id, prec
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id, 'email', pr.email, 'display_name', pr.display_name,
           'avatar', pr.avatar,
           'category', b.category, 'role', b.role, 'source', b.source,
           'direct', b.direct,
           -- Kan denne brukeren fjernes HER? Arvede områdemedlemmer i en
           -- mappes liste kan det aldri; siste områdeeier heller ikke.
           'removable', b.direct
             and public.can_manage_members(p_type, p_id, uid)
             and not (p_type = 'universe' and b.role = 'owner'
                      and public.universe_owner_count(p_id) <= 1),
           -- `removeHint` er norsk tekst og blir stående av hensyn til eldre
           -- klienter; `removeHintCode` er den språknøytrale koden dagens
           -- klient oversetter selv (docs/sprak.md). Additivt, som alt annet
           -- her: en klient som ikke kjenner koden bruker teksten som før.
           'removeHint', case
             when not b.direct then 'Har tilgang via området og må fjernes der'
             when p_type = 'universe' and b.role = 'owner'
                  and public.universe_owner_count(p_id) <= 1
               then 'Siste eier kan ikke fjernes'
             else null end,
           'removeHintCode', case
             when not b.direct then 'inherited'
             when p_type = 'universe' and b.role = 'owner'
                  and public.universe_owner_count(p_id) <= 1
               then 'lastOwner'
             else null end,
           -- Kan degraderes fra eier til vanlig medlem?
           'demotable', b.direct and b.role = 'owner'
             and public.can_manage_members(p_type, p_id, uid)
             and not (p_type = 'universe' and public.universe_owner_count(p_id) <= 1),
           -- Kan LØFTES til eier? Rolleløft settes aldri direkte — det går via
           -- en invitasjon mottakeren må godta — så flagget speiler retten til
           -- å invitere til eierskap, ikke retten til å skrive rollen.
           'promotable', b.direct and b.role = 'member'
             and public.can_invite_owner(p_type, p_id, uid)
             and not exists (select 1 from public.share_invites s
                              where s.status = 'pending' and s.role = 'owner'
                                and lower(s.invitee_email) = lower(pr.email)
                                and ((p_type = 'universe' and s.universe_id = p_id)
                                  or (p_type = 'group'    and s.group_id    = p_id)))
         ) order by b.prec, lower(coalesce(pr.display_name, pr.email))), '[]'::jsonb)
    into rows
    from best b join public.profiles pr on pr.id = b.user_id;

  return jsonb_build_object(
    'type', p_type,
    'ownerCount', case when p_type = 'universe' then public.universe_owner_count(p_id)
                       else (select count(*)::int from public.memberships m
                              where m.group_id = p_id and m.role = 'owner') end,
    'memberCount', case when p_type = 'universe' then public.universe_member_count(p_id)
                        else public.group_member_count(p_id) end,
    -- Betrakterens EFFEKTIVE rettigheter (serverautoritativt) — klienten viser
    -- invitasjonsfelt/administrative kontroller ut fra disse, ikke ut fra gjetting.
    'viewer', jsonb_build_object(
      'id', uid,
      'role', case when p_type = 'universe' then public.universe_role(p_id, uid)
                   else public.group_role(p_id, uid) end,
      'caps', case when p_type = 'universe' then public.universe_caps(p_id, uid)
                   else public.group_caps(p_id, uid) end),
    'invitePolicy', case when p_type = 'universe'
                         then (select invite_policy from public.universes where id = p_id)
                         else (select invite_policy from public.groups where id = p_id) end,
    'inviteEffective', public.effective_invite_policy(p_type, p_id),
    'members', rows,
    'pendingInvites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'email', s.invitee_email, 'role', s.role,
               'created_at', s.created_at, 'by', s.inviter_id,
               'by_name', (select display_name from public.profiles where id = s.inviter_id),
               'mine', s.inviter_id = uid) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending'
        and ((p_type = 'universe' and s.universe_id = p_id)
          or (p_type = 'group'    and s.group_id    = p_id))
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- 9b. get_my_doc() — hele brukerens datasett som ett flatt doc
--     * områder brukeren har en rolle i (eier ELLER medlem)
--     * mapper i disse områdene PLUSS direkte delte mapper med hele
--       undertreet — også når det kanoniske området IKKE er lesbart
--       (`free = true`; områdets navn/medlemsliste lekkes aldri)
--     * personlig rekkefølge, roller, capabilities og invitasjoner
-- ------------------------------------------------------------

create or replace function public.get_my_doc()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  with my_universes as (
    select u.*, m.role as my_role, m.pos as personal_pos
    from public.universes u
    join public.memberships m on m.universe_id = u.id and m.user_id = uid
  ),
  my_groups as (
    select g.*, gm.role as direct_role, gm.pos as personal_pos,
           (mu.id is null) as free
    from public.groups g
    left join my_universes mu on mu.id = g.universe_id
    left join public.memberships gm on gm.group_id = g.id and gm.user_id = uid
    where mu.id is not null or gm.id is not null
  ),
  my_cards as (
    select c.* from public.cards c where c.group_id in (select id from my_groups)
  ),
  my_items as (
    select i.* from public.items i where i.card_id in (select id from my_cards)
  ),
  -- Idéer henger på KONTOEN, ikke på hierarkiet: ingen join, bare eierskap.
  my_ideas as (
    select d.* from public.ideas d where d.owner_id = uid
  ),
  -- Notatene likeså (docs/notater-plan.md): tre flate uttrekk på eierskap.
  my_note_projects as (
    select np.* from public.note_projects np where np.owner_id = uid
  ),
  my_note_folders as (
    select nf.* from public.note_folders nf where nf.owner_id = uid
  ),
  my_notes as (
    select n.* from public.notes n where n.owner_id = uid
  ),
  -- Koblingene mine (docs/notater-plan.md). De hentes på EIERSKAP alene, også
  -- når listesiden ligger i et område jeg har mistet tilgangen til: raden
  -- finnes, og klienten skal kunne vise at koblingen er der uten å kunne åpne
  -- den. Fremmednøklene garanterer at målet ikke er SLETTET.
  my_links as (
    select l.* from public.object_links l where l.owner_id = uid
  )
  select jsonb_build_object(
    'user', (select jsonb_build_object('id', pr.id, 'email', pr.email,
                                       'display_name', pr.display_name)
             from public.profiles pr where pr.id = uid),
    'universes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', u.id, 'creator', u.owner_id, 'createdByMe', u.owner_id = uid,
        'role', u.my_role, 'personalPos', u.personal_pos,
        'name', u.name, 'trashed', u.trashed, 'locked', u.locked, 'unlocked', u.unlocked,
        'collapsed', u.collapsed,
        'invitePolicy', u.invite_policy,
        'ts', u.ts, 'org', u.org,
        'pos', u.pos, 'posTs', u.pos_ts, 'posOrg', u.pos_org,
        'ownerCount', public.universe_owner_count(u.id),
        -- Eierskapsdomenet som én sammenlignbar nøkkel: klienten bruker den til å
        -- vite OM en mappeflytting krysser domenegrensen (og dermed må bekreftes)
        -- før den kaller move_group. Ingen ny informasjon — medlemslisten er
        -- allerede synlig for alle med tilgang.
        'ownerKey', array_to_string(public.universe_owner_set(u.id), ','),
        'memberCount', public.universe_member_count(u.id),
        'shared', public.universe_member_count(u.id) > 1,
        'caps', public.universe_caps(u.id, uid))) from my_universes u), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'creator', g.owner_id, 'createdByMe', g.owner_id = uid,
        'uni', g.universe_id, 'free', g.free,
        'role', g.direct_role, 'personalPos', g.personal_pos,
        'name', g.name, 'trashed', g.trashed, 'locked', g.locked, 'unlocked', g.unlocked,
        'cat', g.cat_id, 'isCat', g.is_cat, 'collapsed', g.collapsed,
        'invitePolicy', g.invite_policy,
        'ts', g.ts, 'org', g.org,
        'pos', g.pos, 'posTs', g.pos_ts, 'posOrg', g.pos_org,
        'memberCount', public.group_member_count(g.id),
        'shared', public.group_member_count(g.id) > 1,
        'caps', public.group_caps(g.id, uid))) from my_groups g), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'creator', c.owner_id, 'createdByMe', c.owner_id = uid,
        'group', c.group_id,
        'title', c.title, 'trashed', c.trashed, 'locked', c.locked, 'unlocked', c.unlocked,
        'k', c.k, 'p', c.p, 'labTs', c.lab_ts, 'labOrg', c.lab_org,
        'responsible', c.responsible,
        'start', c.start_at, 'due', c.due_at, 'lockTimes', c.lock_times,
        'collapsed', c.collapsed,
        'ts', c.ts, 'org', c.org,
        'pos', c.pos, 'posTs', c.pos_ts, 'posOrg', c.pos_org)) from my_cards c), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'creator', i.owner_id, 'createdByMe', i.owner_id = uid,
        'home', i.card_id, 'cat', i.cat_id, 'isCat', i.is_cat, 'lockTimes', i.lock_times,
        'collapsed', i.collapsed,
        'text', i.text, 'trashed', i.trashed, 'done', i.done,
        'responsible', i.responsible,
        'start', i.start_at, 'due', i.due_at,
        'ts', i.ts, 'org', i.org,
        'pos', i.pos, 'posTs', i.pos_ts, 'posOrg', i.pos_org)) from my_items i), '[]'::jsonb),
    'ideas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'creator', d.owner_id, 'createdByMe', true,
        'cat', d.cat_id, 'isCat', d.is_cat, 'collapsed', d.collapsed,
        'text', d.text, 'trashed', d.trashed,
        'ts', d.ts, 'org', d.org,
        'pos', d.pos, 'posTs', d.pos_ts, 'posOrg', d.pos_org)) from my_ideas d), '[]'::jsonb),
    'noteProjects', coalesce((select jsonb_agg(jsonb_build_object(
        'id', np.id, 'creator', np.owner_id, 'createdByMe', true,
        'name', np.name, 'collapsed', np.collapsed, 'trashed', np.trashed,
        'archived', np.archived,
        'ts', np.ts, 'org', np.org,
        'pos', np.pos, 'posTs', np.pos_ts, 'posOrg', np.pos_org)) from my_note_projects np), '[]'::jsonb),
    'noteFolders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', nf.id, 'creator', nf.owner_id, 'createdByMe', true,
        'project', nf.project_id, 'name', nf.name, 'trashed', nf.trashed,
        'archived', nf.archived,
        'ts', nf.ts, 'org', nf.org,
        'pos', nf.pos, 'posTs', nf.pos_ts, 'posOrg', nf.pos_org)) from my_note_folders nf), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'creator', n.owner_id, 'createdByMe', true,
        'project', n.project_id, 'folder', n.folder_id,
        'title', n.title, 'body', n.body, 'trashed', n.trashed,
        'archived', n.archived,
        'ts', n.ts, 'org', n.org,
        'pos', n.pos, 'posTs', n.pos_ts, 'posOrg', n.pos_org)) from my_notes n), '[]'::jsonb),
    /* Koblingene. Typen står som ETT ord per side i stedet for tre kolonner,
       fordi det er den formen klienten faktisk bruker — hvilken kolonne som
       bærer id-en er databasens sak, ikke klientens. */
    'links', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'creator', l.owner_id, 'createdByMe', true,
        'noteType', case when l.note_project_id is not null then 'noteProject'
                         when l.note_folder_id is not null then 'noteFolder'
                         else 'note' end,
        'noteId', coalesce(l.note_project_id, l.note_folder_id, l.note_id),
        'listType', case when l.universe_id is not null then 'universe'
                         when l.group_id is not null then 'group'
                         else 'card' end,
        'listId', coalesce(l.universe_id, l.group_id, l.card_id),
        'ts', l.ts, 'org', l.org)) from my_links l), '[]'::jsonb),
    'invites_in', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'type', case when s.universe_id is not null then 'universe' else 'group' end,
        'role', s.role,
        'name', coalesce((select name from public.universes where id = s.universe_id),
                         (select name from public.groups    where id = s.group_id)),
        'from', (select email from public.profiles where id = s.inviter_id),
        'from_name', (select display_name from public.profiles where id = s.inviter_id),
        'created_at', s.created_at) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending'
        and (s.universe_id is not null or s.group_id is not null)
        and (s.invitee_id = uid
             or lower(s.invitee_email) = (select lower(email) from public.profiles where id = uid))), '[]'::jsonb),
    'invites_out', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'type', case when s.universe_id is not null then 'universe' else 'group' end,
        'role', s.role,
        'target_id', coalesce(s.universe_id, s.group_id),
        'email', s.invitee_email, 'created_at', s.created_at) order by s.created_at)
      from public.share_invites s
      where s.status = 'pending' and s.inviter_id = uid
        and (s.universe_id is not null or s.group_id is not null)), '[]'::jsonb),
    -- Varsler: brukerens EGNE rader (docs/varsler.md). De hører ikke til
    -- innholds-doc-et og flettes ikke — klienten bare viser dem. Nyeste først,
    -- med de samme to grensene som notify_record() rydder etter — taket på 200
    -- (så en lang historikk ikke gjør hver eneste synk-runde tyngre) og
    -- levetiden på 30 døgn. Filteret her er ikke en dublett av opprydningen:
    -- det er det som gjør at en rad ALDRI vises for gammel, uansett hvor lenge
    -- det er siden forrige logging ryddet. Regnestykket er det samme — det
    -- seneste av `created_at` og `at`, altså da raden ble historikk.
    'notifications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'key', n.key, 'type', n.type,
        'objType', n.obj_type, 'objId', n.obj_id,
        'name', n.name, 'path', n.path, 'value', n.value,
        'at', n.at, 'snoozed', n.snoozed,
        'createdAt', n.created_at, 'readAt', n.read_at)
        order by n.at desc, n.created_at desc, n.id desc)
      from (select * from public.notifications
             where user_id = uid
               and greatest(created_at, at) >=
                     (extract(epoch from now()) * 1000)::bigint - public.notify_max_age_ms()
             order by at desc, created_at desc, id desc
             limit 200) n), '[]'::jsonb),
    -- Preferansene + generator-markøren. `null` betyr «ingen rad ennå», og da
    -- er dette brukerens FØRSTE runde: klienten setter markøren til nå i stedet
    -- for å logge hver terskel som noen gang er passert.
    'notify_prefs', (select jsonb_build_object(
        'dueOver', p.due_over, 'dueSoon', p.due_soon,
        'startNow', p.start_now, 'startSoon', p.start_soon,
        'cursor', p.cursor_at,
        -- Tidssonen planen tilhører, og når den sist ble hevdet. Klienten
        -- planlegger kun når den holder sonen (docs/varsler.md).
        'tz', p.tz, 'tzAt', p.tz_at)
      from public.notification_prefs p where p.user_id = uid),
    /* Hvor mange ENHETER som har varsler på akkurat nå — nettlesere med web
       push OG Android-apper med den native kanalen på. Ett tall, ikke
       endepunktene: innstillingen skal kunne si «og 2 andre» uten at doc-et
       bærer adresser en annen fane kunne lest. Listen (uten adresser) hentes
       av list_my_devices() når brukeren faktisk åpner den.

       Begge kanaltypene teller, og det er ikke kosmetikk: tallet er også
       SIGNALET klientene bruker. Faller det, går statusrunden med én gang i
       stedet for å vente ut vinduet sitt — og det er slik en fjern-avslått
       klient oppdager valget innen en synk-runde i stedet for innen et
       kvarter. */
    'push_devices', (select count(*) from public.push_subscriptions
                      where user_id = uid and disabled_at is null
                        and revoked_at is null)
                  + (select count(*) from public.native_notif_active(uid)),
    /* ER DENNE KLIENTENS NATIVE VARSELKANAL SLÅTT AV fra en annen enhet?

       Et PRESIST signal, og ikke bare fordi det er penere: telleren over er et
       AGGREGAT. Den faller når noen slår av en enhet — men bare hvis ingen
       annen enhet slo sine PÅ i det samme vinduet. Skjer begge deler mellom to
       runder, står tallet stille, og en åpen Android-app ville ventet ut
       kvarteret sitt med alarmer brukeren nettopp slo av. Her ser den det i
       neste runde, uansett hva de andre enhetene gjorde.

       To indeksoppslag: øktens egen rad i sidebordet (primærnøkkel), og
       klientkonteksten dens i statusbordet (unik indeks). `false` når økt-
       claimet mangler eller klienten aldri har meldt en status — en manglende
       opplysning skal aldri kunne lese seg som en avslåing.

       KUN den native kanalen. En nettleser kjenner igjen sitt eget abonnement
       på ENDEPUNKTET, og det har doc-et ikke — og skal ikke ha: det er
       adressen varslene sendes til. Der er telleren fortsatt signalet. */
    'notif_revoked', (select exists (
        select 1 from public.device_sessions d
          join public.native_notif_devices n
            on n.user_id = d.user_id and n.device_id = d.device_id
           and n.origin = d.origin
         where d.user_id = uid and d.session_id = public.current_session_id()
           and n.revoked_at is not null)),
    /* LEVER ØKTEN ENNÅ? Ett indeksoppslag på primærnøkkelen i `auth.sessions`,
       og den ene grunnen til at det står i det pollede doc-et: et allerede
       utstedt access-token er gyldig til det utløper, så en fjern-utlogget
       klient ville ellers ha stått igjen med kontoens innhold på skjermen i
       opptil en time. Her ser den det i neste runde (5 s) og går til
       innloggingssiden selv. `true` når claimet mangler — en manglende
       opplysning er ikke en tilbakekalling. Se docs/accounts.md. */
    'session_ok', public.session_alive(public.current_session_id())
  ) into result;

  return result;
end;
$$;

-- ------------------------------------------------------------
-- 9c. move_group() — ATOMISK flytting av en mappe
--
--   * samme område        → ren omplassering (delt posisjon + mappekategori)
--   * samme EIERSKAPSDOMENE (identisk sett områdeeiere) → ekte REPARENTING:
--     alle id-er, roller, direkte medlemmer, invitasjoner, innhold og låser
--     består; kun universe_id/kategori/posisjon endres.
--   * ULIKT domene        → KOPIER-OG-SLETT: nytt undertre med NYE id-er i
--     målområdet (aktøren blir oppretter og eksplisitt mappeeier), gamle
--     roller/medlemmer/invitasjoner følger IKKE med, og det gamle treet slettes
--     permanent i samme transaksjon (gravsteiner for hver eneste gamle id).
--
--   Rettigheter kontrolleres på nytt inne i transaksjonen: destruktiv myndighet
--   i KILDEN (can_move_group) + opprettelsesrett i MÅLET (can_create_child).
--   Radene låses (`for update`) så to samtidige flyttinger/slettinger
--   serialiseres. Returnerer { mode, group, mapping } — mappingen lar klienten
--   bytte den optimistiske visningen uten flimring.
-- ------------------------------------------------------------

create or replace function public.move_group(
  p_group uuid, p_universe uuid, p_cat uuid default null,
  p_pos double precision default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  g        public.groups;
  src_uni  uuid;
  now_ms   bigint := (extract(epoch from now()) * 1000)::bigint;
  mapping  jsonb := '{}'::jsonb;
  new_gid  uuid;
  src_card record;
  src_item record;
  new_cid  uuid;
  new_iid  uuid;
  mode     text;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;

  select * into g from public.groups where id = p_group for update;
  if g.id is null then raise exception 'mappen finnes ikke'; end if;
  if g.is_cat then raise exception 'en mappekategori kan ikke flyttes til et annet område'; end if;
  src_uni := g.universe_id;

  if not exists (select 1 from public.universes where id = p_universe) then
    raise exception 'målområdet finnes ikke';
  end if;
  -- Lås begge områdene i stabil rekkefølge (unngår vranglås ved to samtidige
  -- flyttinger i motsatt retning).
  perform 1 from public.universes u where u.id in (src_uni, p_universe)
    order by u.id for update;

  if p_cat is not null and not exists (
    select 1 from public.groups gc where gc.id = p_cat and gc.is_cat and gc.universe_id = p_universe) then
    raise exception 'ugyldig mappekategori for målområdet';
  end if;

  -- ---- Samme område: ren omplassering (delt posisjon), ikke en flytting ----
  if src_uni = p_universe then
    if not public.can_reorder_in_parent('group', p_group, uid) then
      raise exception 'mangler myndighet til å endre rekkefølgen i området';
    end if;
    update public.groups
       set cat_id = p_cat, pos = p_pos, pos_ts = now_ms, pos_org = 'server'
     where id = p_group;
    return jsonb_build_object('mode', 'reorder', 'group', p_group, 'mapping', mapping);
  end if;

  if not public.can_move_group(p_group, uid) then
    raise exception 'mangler myndighet til å flytte mappen ut av området';
  end if;
  if not public.can_create_child('universe', p_universe, uid) then
    raise exception 'mangler myndighet til å opprette mapper i målområdet';
  end if;

  -- ---- Samme eierskapsdomene: ekte reparenting ----
  if public.universe_owner_set(src_uni) = public.universe_owner_set(p_universe) then
    perform set_config('huskis.privileged_op', '1', true);
    update public.groups
       set universe_id = p_universe, cat_id = p_cat,
           pos = p_pos, pos_ts = now_ms, pos_org = 'server'
     where id = p_group;
    -- Ansvarstildelinger til noen som ikke lenger har effektiv tilgang nullstilles.
    update public.cards set responsible = null, ts = now_ms, org = 'server'
     where group_id = p_group and responsible is not null
       and not public.is_group_member(p_group, responsible);
    update public.items set responsible = null, ts = now_ms, org = 'server'
     where responsible is not null
       and card_id in (select id from public.cards where group_id = p_group)
       and not public.is_group_member(p_group, responsible);
    perform set_config('huskis.privileged_op', '', true);
    return jsonb_build_object('mode', 'reparent', 'group', p_group, 'mapping', mapping);
  end if;

  -- ---- Ulikt eierskapsdomene: kopier-og-slett ----
  mode := 'copy';
  new_gid := gen_random_uuid();
  mapping := mapping || jsonb_build_object(p_group::text, new_gid::text);

  insert into public.groups (id, owner_id, universe_id, cat_id, is_cat, name, trashed,
                             locked, unlocked, collapsed, invite_policy,
                             ts, org, pos, pos_ts, pos_org)
  values (new_gid, uid, p_universe, p_cat, false, g.name, g.trashed,
          g.locked, g.unlocked, g.collapsed, g.invite_policy,
          now_ms, 'server', p_pos, now_ms, 'server');

  for src_card in select * from public.cards where group_id = p_group order by pos loop
    new_cid := gen_random_uuid();
    mapping := mapping || jsonb_build_object(src_card.id::text, new_cid::text);
    insert into public.cards (id, owner_id, group_id, title, trashed, locked, unlocked,
                              k, p, responsible, start_at, due_at, lock_times, collapsed,
                              ts, org, lab_ts, lab_org, pos, pos_ts, pos_org)
    values (new_cid, uid, new_gid, src_card.title, src_card.trashed, src_card.locked, src_card.unlocked,
            src_card.k, src_card.p,
            case when src_card.responsible is not null and public.is_group_member(new_gid, src_card.responsible)
                 then src_card.responsible end,
            src_card.start_at, src_card.due_at, src_card.lock_times, src_card.collapsed,
            now_ms, 'server', now_ms, 'server', src_card.pos, now_ms, 'server');
  end loop;

  -- Kategorier først, så leaf-radene: `cat_id` peker på en kategori i SAMME
  -- tabell, og mappingen må være kjent når leaf-raden settes inn.
  for src_item in select * from public.items
            where card_id in (select id from public.cards where group_id = p_group)
            order by is_cat desc, pos loop
    new_iid := gen_random_uuid();
    mapping := mapping || jsonb_build_object(src_item.id::text, new_iid::text);
    insert into public.items (id, owner_id, card_id, cat_id, is_cat, lock_times, collapsed,
                              text, trashed, done, responsible, start_at, due_at,
                              ts, org, pos, pos_ts, pos_org)
    values (new_iid, uid,
            (mapping ->> src_item.card_id::text)::uuid,
            case when src_item.cat_id is null then null else (mapping ->> src_item.cat_id::text)::uuid end,
            src_item.is_cat, src_item.lock_times, src_item.collapsed,
            src_item.text, src_item.trashed, src_item.done,
            case when src_item.responsible is not null and public.is_group_member(new_gid, src_item.responsible)
                 then src_item.responsible end,
            src_item.start_at, src_item.due_at,
            now_ms, 'server', src_item.pos, now_ms, 'server');
  end loop;

  -- Det gamle treet slettes PERMANENT: kaskaden fjerner lister, listepunkter,
  -- roller og ventende invitasjoner, og AFTER DELETE-triggerne skriver gravstein
  -- for hver eneste gamle id — så en gammel offline-klient aldri kan gjenopplive
  -- innholdet i det gamle domenet.
  delete from public.groups where id = p_group;

  return jsonb_build_object('mode', mode, 'group', new_gid, 'mapping', mapping);
end;
$$;
-- ------------------------------------------------------------
-- 10. import_doc(p_doc) — migrering av dagens (lokale) doc inn som
--     den innloggede brukerens egne data. Klienten normaliserer
--     doc-et først (samme migreringssteg som i dag) og sender
--     { universes, groups, cards, items } med gamle tekst-id-er.
--     Id-ene mappes deterministisk per bruker
--     (md5(uid || ':' || gammel_id) -> uuid), så re-kjøring er
--     idempotent og to brukere som importerer samme delte doc får
--     hver sin uavhengige kopi. Foreldreløse hopper over (som i
--     applyDoc). Gjenkjøring oppdaterer via LWW-triggerne.
-- ------------------------------------------------------------

create or replace function public.legacy_uuid(p_uid uuid, p_old text)
returns uuid language sql immutable as $$
  select md5(p_uid::text || ':' || p_old)::uuid;
$$;

create or replace function public.import_doc(p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb;
  n_uni int := 0; n_grp int := 0; n_card int := 0; n_item int := 0;
begin
  if uid is null then raise exception 'ikke innlogget'; end if;
  -- Importen skriver forelder-pekere direkte; move_group-vakten skal ikke slå
  -- inn på brukerens egen migrering av lokale data.
  perform set_config('huskis.privileged_op', '1', true);

  -- Importen er en EKSPLISITT handling fra brukeren selv, på id-er som er
  -- utledet av brukerens egen uid (legacy_uuid) — altså ingen andres data. Har
  -- brukeren tidligere slettet noe av dette permanent, ville insert-vakten
  -- blokkert hele importen; vi fjerner derfor gravsteinene for nøyaktig de
  -- id-ene importen skriver, og bare dem. (Dette er den ENESTE veien en
  -- gravstein fjernes automatisk — synken kan det aldri.)
  delete from public.tombstones t
   using (
     select public.legacy_uuid(uid, x ->> 'id') as id
       from jsonb_array_elements(coalesce(p_doc -> 'universes', '[]'::jsonb)) x
     union all
     select public.legacy_uuid(uid, x ->> 'id')
       from jsonb_array_elements(coalesce(p_doc -> 'groups', '[]'::jsonb)) x
     union all
     select public.legacy_uuid(uid, x ->> 'id')
       from jsonb_array_elements(coalesce(p_doc -> 'cards', '[]'::jsonb)) x
     union all
     select public.legacy_uuid(uid, x ->> 'id')
       from jsonb_array_elements(coalesce(p_doc -> 'items', '[]'::jsonb)) x
   ) imported
   where t.resource_id = imported.id;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'universes', '[]'::jsonb)) loop
    insert into public.universes as t (id, owner_id, name, trashed, collapsed, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid,
            coalesce(r ->> 'name', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set name = excluded.name, trashed = excluded.trashed, collapsed = excluded.collapsed,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_uni := n_uni + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'groups', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.universes u
      where u.id = public.legacy_uuid(uid, r ->> 'uni')
        and public.is_universe_owner(u.id, uid));
    insert into public.groups as t (id, owner_id, universe_id, cat_id, is_cat, name, trashed,
                                    collapsed, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'uni'),
            case when r ->> 'cat' is null then null else public.legacy_uuid(uid, r ->> 'cat') end,
            coalesce((r ->> 'isCat')::boolean, false),
            coalesce(r ->> 'name', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set universe_id = excluded.universe_id, cat_id = excluded.cat_id,
          is_cat = excluded.is_cat, name = excluded.name,
          trashed = excluded.trashed, collapsed = excluded.collapsed,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_grp := n_grp + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'cards', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.groups g
      where g.id = public.legacy_uuid(uid, r ->> 'group')
        and public.is_group_owner(g.id, uid));
    insert into public.cards as t (id, owner_id, group_id, title, trashed, k, p,
                                   start_at, due_at, lock_times, collapsed,
                                   ts, org, lab_ts, lab_org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'group'),
            coalesce(r ->> 'title', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'k')::boolean, true), coalesce((r ->> 'p')::boolean, true),
            r ->> 'start', r ->> 'due', coalesce((r ->> 'lockTimes')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'labTs')::bigint, 0), coalesce(r ->> 'labOrg', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set group_id = excluded.group_id, title = excluded.title,
          trashed = excluded.trashed, k = excluded.k, p = excluded.p,
          start_at = excluded.start_at, due_at = excluded.due_at,
          lock_times = excluded.lock_times, collapsed = excluded.collapsed,
          ts = excluded.ts, org = excluded.org,
          lab_ts = excluded.lab_ts, lab_org = excluded.lab_org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_card := n_card + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'items', '[]'::jsonb)) loop
    continue when not exists (
      select 1 from public.cards c
      where c.id = public.legacy_uuid(uid, r ->> 'home') and c.owner_id = uid);
    insert into public.items as t (id, owner_id, card_id, cat_id, is_cat, lock_times, collapsed, text, trashed, done,
                                   start_at, due_at, ts, org, pos, pos_ts, pos_org)
    values (public.legacy_uuid(uid, r ->> 'id'), uid, public.legacy_uuid(uid, r ->> 'home'),
            case when r ->> 'cat' is null then null else public.legacy_uuid(uid, r ->> 'cat') end,
            coalesce((r ->> 'isCat')::boolean, false), coalesce((r ->> 'lockTimes')::boolean, false),
            coalesce((r ->> 'collapsed')::boolean, false),
            coalesce(r ->> 'text', ''), coalesce((r ->> 'trashed')::boolean, false),
            coalesce((r ->> 'done')::boolean, false),
            r ->> 'start', r ->> 'due',
            coalesce((r ->> 'ts')::bigint, 0), coalesce(r ->> 'org', ''),
            coalesce((r ->> 'pos')::double precision, 0),
            coalesce((r ->> 'posTs')::bigint, 0), coalesce(r ->> 'posOrg', ''))
    on conflict (id) do update
      set card_id = excluded.card_id, cat_id = excluded.cat_id,
          is_cat = excluded.is_cat, lock_times = excluded.lock_times, collapsed = excluded.collapsed,
          text = excluded.text,
          trashed = excluded.trashed, done = excluded.done,
          start_at = excluded.start_at, due_at = excluded.due_at,
          ts = excluded.ts, org = excluded.org,
          pos = excluded.pos, pos_ts = excluded.pos_ts, pos_org = excluded.pos_org
      where t.owner_id = uid;
    n_item := n_item + 1;
  end loop;

  perform set_config('huskis.privileged_op', '', true);
  return jsonb_build_object('universes', n_uni, 'groups', n_grp,
                            'cards', n_card, 'items', n_item);
end;
$$;

-- ------------------------------------------------------------
-- 11. MIGRERING AV EKSISTERENDE DATA
--
--   11a. ROLLER: oppretteren av et område blir områdeeier; oppretteren av en
--        mappe blir eksplisitt mappeeier (med mindre vedkommende allerede er
--        områdeeier). Eksisterende direkte medlemskap blir vanlige roller.
--        Kjøres ÉN gang (migration_log): en re-kjøring ville gjeninnsatt en
--        rolle som senere er fjernet med vilje.
--
--   11b. LISTEDELINGER: direkte deling av lister finnes ikke lenger. Hver liste
--        med direkte medlemmer/invitasjoner migreres slik at NØYAKTIG den
--        tidligere effektive tilgangen bevares — uten at noen får tilgang til
--        søskenlister de ikke kunne lese før. Trinnene følger
--        docs/rettigheter-og-deling.md. Naturlig idempotent: etter kjøringen
--        finnes ingen rader med card_id, så en re-kjøring gjør ingenting.
-- ------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.migration_log where key = 'roles_backfill_v1') then return; end if;
  perform set_config('huskis.privileged_op', '1', true);

  -- Områdeeier = områdets oppretter.
  insert into public.memberships (user_id, universe_id, role, pos)
  select u.owner_id, u.id, 'owner', u.pos from public.universes u
  on conflict (universe_id, user_id) where universe_id is not null
    do update set role = 'owner';

  -- Eksplisitt mappeeier = mappens oppretter, med mindre rollen alt er arvet
  -- som områdeeier (da ville raden bare duplisert medlemslisten).
  insert into public.memberships (user_id, group_id, role, pos)
  select g.owner_id, g.id, 'owner', g.pos from public.groups g
   where not exists (select 1 from public.memberships m
                      where m.universe_id = g.universe_id
                        and m.user_id = g.owner_id and m.role = 'owner')
  on conflict (group_id, user_id) where group_id is not null
    do update set role = 'owner';

  -- Dedupliser: et direkte mappemedlemskap er overflødig når brukeren allerede
  -- har en områderolle (tilgangen er da arvet).
  delete from public.memberships m
   where m.group_id is not null and m.role = 'member'
     and exists (select 1 from public.memberships um
                 join public.groups g on g.id = m.group_id
                 where um.universe_id = g.universe_id and um.user_id = m.user_id);

  insert into public.migration_log(key) values ('roles_backfill_v1');
  perform set_config('huskis.privileged_op', '', true);
end $$;

do $$
declare
  c        record;
  g        public.groups;
  u        uuid;
  target   uuid;
  n_active int;
  new_gid  uuid;
  base_nm  text;
  nm       text;
  k        int;
  now_ms   bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not exists (select 1 from public.memberships where card_id is not null)
     and not exists (select 1 from public.share_invites where card_id is not null) then
    return;
  end if;
  perform set_config('huskis.privileged_op', '1', true);

  for c in
    select ca.* from public.cards ca
     where exists (select 1 from public.memberships m where m.card_id = ca.id)
        or exists (select 1 from public.share_invites s where s.card_id = ca.id and s.status = 'pending')
     order by ca.id
  loop
    select * into g from public.groups where id = c.group_id;
    continue when g.id is null;
    u := g.universe_id;

    -- (1+2) Redundante listetilganger: mottakeren har allerede mappetilgang.
    delete from public.memberships m
     where m.card_id = c.id and public.is_group_member(g.id, m.user_id);
    update public.share_invites s set status = 'revoked', responded_at = now()
     where s.card_id = c.id and s.status = 'pending'
       and s.invitee_id is not null and public.is_group_member(g.id, s.invitee_id);

    if not exists (select 1 from public.memberships where card_id = c.id)
       and not exists (select 1 from public.share_invites where card_id = c.id and status = 'pending') then
      continue;
    end if;

    -- Finnes det en ANNEN aktiv liste i mappen? Det — ikke antallet aktive
    -- lister — avgjør om promotering er trygt: er `c` selv i søpla mens en annen
    -- liste er aktiv, ville promotering gitt mottakerne tilgang til nettopp den
    -- søskenlista de ikke kunne lese før.
    select count(*) into n_active
      from public.cards where group_id = g.id and not trashed and id <> c.id;

    if n_active = 0 then
      -- (3) Ingen andre aktive lister i mappen: løft mottakerne til DIREKTE
      --     mappemedlemmer. Lista blir liggende, og framtidige lister i mappen
      --     deles etter den nye modellen med de samme folkene.
      target := g.id;
    else
      -- (4) Det finnes andre aktive lister: splitt ut en ny søskenmappe for
      --     NØYAKTIG denne lista, så mottakerne ikke får se søsknene. Samme
      --     område, samme mappekategori, rett ved siden av den gamle mappen.
      base_nm := coalesce(nullif(btrim(c.title), ''), 'Delt liste');
      nm := base_nm; k := 1;
      while exists (select 1 from public.groups x
                     where x.universe_id = u and x.name = nm and not x.is_cat) loop
        k := k + 1; nm := base_nm || ' (' || k || ')';
      end loop;
      new_gid := gen_random_uuid();
      insert into public.groups (id, owner_id, universe_id, cat_id, is_cat, name,
                                 ts, org, pos, pos_ts, pos_org)
      values (new_gid, c.owner_id, u, g.cat_id, false, nm,
              now_ms, 'migration', g.pos + 0.5, now_ms, 'migration');
      update public.cards set group_id = new_gid, pos_ts = now_ms, pos_org = 'migration'
       where id = c.id;
      -- De som hadde tilgang til den gamle mappen DIREKTE (ikke via området)
      -- beholder tilgangen til lista — med samme rolle som før.
      insert into public.memberships (user_id, group_id, role, pos)
      select m.user_id, new_gid, m.role, m.pos
        from public.memberships m
       where m.group_id = g.id
         and not exists (select 1 from public.memberships um
                          where um.universe_id = u and um.user_id = m.user_id)
      on conflict (group_id, user_id) where group_id is not null do nothing;
      target := new_gid;
    end if;

    -- Direkte listemedlemmer → direkte mappemedlemmer i målmappen.
    insert into public.memberships (user_id, group_id, role, pos)
    select m.user_id, target, 'member', m.pos
      from public.memberships m where m.card_id = c.id
    on conflict (group_id, user_id) where group_id is not null do nothing;

    -- Ventende listeinvitasjoner → mappeinvitasjoner. En adresse som allerede
    -- har en ventende invitasjon til målmappen ville brutt unik-indeksen, så
    -- den trekkes tilbake i stedet (invitasjonen finnes jo allerede).
    update public.share_invites s set status = 'revoked', responded_at = now()
     where s.card_id = c.id and s.status = 'pending'
       and exists (select 1 from public.share_invites t
                    where t.group_id = target and t.status = 'pending'
                      and lower(t.invitee_email) = lower(s.invitee_email));
    update public.share_invites s set group_id = target, card_id = null
     where s.card_id = c.id and s.status = 'pending';

    delete from public.memberships where card_id = c.id;
  end loop;

  -- Rester: ikke-ventende listeinvitasjoner (avslått/tilbaketrukket/akseptert)
  -- og eventuelle medlemskap på lister uten mappe. `card_id` skal være tomt
  -- overalt etter migreringen.
  delete from public.memberships where card_id is not null;
  update public.share_invites
     set card_id = null,
         status = case when status = 'pending' then 'revoked' else status end,
         responded_at = coalesce(responded_at, now())
   where card_id is not null;

  perform set_config('huskis.privileged_op', '', true);
end $$;

-- Mount-kolonnene er pensjonert: mottakeren velger ikke lenger sin egen
-- forelder for delt innhold (en mappe har alltid ett kanonisk område), og
-- «forlat» erstatter mottakerens egen søppelkasse for selve delingen.
alter table public.memberships drop column if exists parent_universe_id;
alter table public.memberships drop column if exists parent_group_id;
alter table public.memberships drop column if exists trashed;

-- Lister deles ikke: databasen avviser nye medlemskap og invitasjoner på
-- listenivå — også fra en gammel klient, en modifisert klient eller et rått
-- PostgREST-kall. (Kolonnen står igjen så migreringen over er re-kjørbar.)
do $$ begin
  alter table public.memberships add constraint memberships_no_card_chk check (card_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.share_invites add constraint share_invites_no_card_chk check (card_id is null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.memberships add constraint memberships_target_chk
    check (num_nonnulls(universe_id, group_id) = 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.share_invites add constraint share_invites_target_chk
    check (num_nonnulls(universe_id, group_id) = 1);
exception when duplicate_object then null; end $$;

drop index if exists public.memberships_card_user_key;
drop index if exists public.share_invites_card_pending_key;

-- ------------------------------------------------------------
-- 12. RETTIGHETER — alt er kun for innloggede (authenticated);
--     anon har ingen tilgang.
-- ------------------------------------------------------------

revoke all on public.profiles, public.universes, public.groups, public.cards,
              public.items, public.ideas, public.note_projects, public.note_folders,
              public.notes, public.object_links, public.memberships, public.share_invites,
              public.tombstones, public.notifications,
              public.notification_prefs, public.push_subscriptions,
              public.device_sessions, public.native_notif_devices from anon;

-- profiles: e-posten speiles KUN fra auth.users (triggerne over) og er
-- skrivebeskyttet for klienter — ellers kunne en bruker kapre ventende
-- invitasjoner (aksept sammenligner mot profiles.email) eller blokkere
-- andres registrering via unik-indeksen. Kun display_name og avatar kan endres.
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar) on public.profiles to authenticated;
grant select, insert, update, delete on public.universes, public.groups,
                                        public.cards, public.items,
                                        public.ideas, public.note_projects,
                                        public.note_folders, public.notes to authenticated;
-- object_links: koblingene har ingen mutable felter, så UPDATE trekkes
-- tilbake — en kobling opprettes og fjernes, den endres aldri. Grant-en er
-- det ytterste laget; RLS-policyene (som ikke HAR en update-variant) er det
-- innerste.
grant select, insert, delete on public.object_links to authenticated;
revoke update on public.object_links from authenticated;
-- Å UTELATE en grant er ikke nok i Supabase: prosjektet har
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated`, så en ny tabell får ALL — inkludert INSERT — i det den
-- opprettes. Hver rettighet klienten ikke skal ha må trekkes tilbake
-- EKSPLISITT, ellers står intensjonen bare i en kommentar. RLS ville som
-- regel avvist skrivingen uansett, men grant-en er laget som skal si nei
-- først: to lag, og det ytterste er billigst.
--
-- MATRISEN under er klientauditen — hva app.js faktisk gjør mot PostgREST:
--
--   tabell         | S | I | U | D | hvem som ellers skriver
--   ---------------+---+---+---+---+---------------------------------------
--   universes …    | ✓ | ✓ | ✓ | ✓ | rad-CRUD i synk-motoren (opQueue)
--   items, ideas,  |   |   |   |   |
--   note_projects, |   |   |   |   |
--   note_folders,  |   |   |   |   |
--   notes          |   |   |   |   |
--   object_links   | ✓ | ✓ | – | ✓ | en kobling finnes eller finnes ikke;
--                  |   |   |   |   |  den har ingen felter å oppdatere
--   profiles       | ✓ | – | ✓*| – | *kun display_name/avatar; e-post speiles
--                  |   |   |   |   |  fra auth.users av triggerne
--   memberships    | ✓ | – | ✓*| – | *kun `pos` (personlig rekkefølge).
--                  |   |   |   |   |  Roller lages/slettes av RPC-ene og
--                  |   |   |   |   |  opprettelses-triggerne (SECURITY
--                  |   |   |   |   |  DEFINER). SELECT trengs også av
--                  |   |   |   |   |  realtime-abonnementet.
--   share_invites  | ✓ | – | – | – | ALT går via RPC-ene (create/accept/
--                  |   |   |   |   |  decline/revoke_share_invite). SELECT
--                  |   |   |   |   |  trengs av realtime-abonnementet.
--   tombstones     | ✓ | – | – | – | skrives KUN av write_tombstone()-
--                  |   |   |   |   |  triggerne. Klienten leser dem i
--                  |   |   |   |   |  fetchServerTombs().
--   notifications  | ✓ | – | ✓*| ✓ | *kun `read_at` (kolonne-grant). Rader
--                  |   |   |   |   |  lages av notify_record(); DELETE er
--                  |   |   |   |   |  «Tøm varsler» (docs/varsler.md).
--   notification_  | ✓ | – | – | – | skrives kun av notify_set_prefs(),
--     prefs        |   |   |   |   |  notify_record() (markøren) og
--                  |   |   |   |   |  notify_claim_tz() (tidssonen).
--   push_subscrip- | ✓ | – | – | ✓ | rader lages/fornyes av push_subscribe();
--     tions        |   |   |   |   |  DELETE er «slå av i denne nettleseren».
--   push_          | – | – | – | – | LÅST tabell: ingen policy, ingen grant.
--     deliveries   |   |   |   |   |  Kun push_claim()/push_report()
--                  |   |   |   |   |  (service_role).
--   device_        | – | – | – | – | LÅST tabell: ingen policy, ingen grant.
--     sessions     |   |   |   |   |  Kun session_touch()/list_my_devices()/
--                  |   |   |   |   |  revoke_my_session(), som alle setter
--                  |   |   |   |   |  user_id fra auth.uid() selv.
--   native_notif_  | – | – | – | – | LÅST tabell: ingen policy, ingen grant.
--     devices      |   |   |   |   |  Kun native_notif_touch()/_revoke()/
--                  |   |   |   |   |  notif_revoke_others()/list_my_devices(),
--                  |   |   |   |   |  som alle setter user_id fra auth.uid().
--
-- Kolonnene uten ✓ er trukket tilbake under. `tests/db-contract.test.js` og
-- smoke-testen holder matrisen og virkeligheten i takt.
revoke insert, delete on public.memberships from authenticated;
grant select, update on public.memberships to authenticated;
-- share_invites muteres utelukkende gjennom RPC-ene. `share_invites_delete`-
-- policyen står igjen som det innerste laget (og for psql/vedlikehold); ingen
-- klient kommer forbi grant-en til å utløse den.
revoke insert, update, delete on public.share_invites from authenticated;
grant select on public.share_invites to authenticated;
revoke insert, update, delete on public.tombstones from authenticated;
grant select on public.tombstones to authenticated;
-- notifications: klienten leser sine egne rader, merker dem lest og sletter
-- dem («Tøm varsler»). Den skal ALDRI kunne skrive en ny rad — den veien går
-- gjennom notify_record(), som setter user_id selv. Update er kolonne-avgrenset
-- til `read_at`: lest/ulest er det eneste klienten eier på en eksisterende rad.
revoke all on public.notifications from authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- notification_prefs leses direkte, men skrives kun av notify_set_prefs().
revoke all on public.notification_prefs from authenticated;
grant select on public.notification_prefs to authenticated;
-- push_subscriptions: klienten ser sine egne abonnementer og kan slette dem
-- («slå av i denne nettleseren»). Å OPPRETTE eller fornye et abonnement går
-- gjennom push_subscribe(): uten den avgrensningen kunne en klient skrevet en
-- rad med en annen bruker-id og fått den brukerens varsler sendt til seg.
revoke all on public.push_subscriptions from authenticated;
grant select, delete on public.push_subscriptions to authenticated;
-- push_deliveries er utboksen og har ingen klientvei i det hele tatt.
revoke all on public.push_deliveries from public, anon, authenticated;
-- device_sessions er sidebordet til auth.sessions. Klienten ser det gjennom
-- list_my_devices() og skriver det gjennom session_touch() — begge setter
-- user_id fra auth.uid(). En direkte vei ville latt en klient skrive en rad
-- for en annen brukers økt-id, og dermed navngi en økt hen ikke eier.
revoke all on public.device_sessions from public, anon, authenticated;
-- native_notif_devices er det samme for Android-appens varselkanal: klienten
-- ser den gjennom list_my_devices() og skriver den gjennom
-- native_notif_touch(). En direkte vei ville latt en klient skrive en rad for
-- en annen brukers enhet — eller slå av varslene på en enhet hen ikke eier.
revoke all on public.native_notif_devices from public, anon, authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
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
    'public.get_my_doc()',
    'public.move_group(uuid, uuid, uuid, double precision)',
    'public.import_doc(jsonb)',
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
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- Interne hjelpere skal ikke kunne kalles som RPC (de utfører privilegerte
-- opprydninger uten egen autorisasjonssjekk — kallerne kontrollerer myndighet).
revoke all on function public.purge_universe_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_group_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.notify_prefs_row(uuid) from public, anon, authenticated;
revoke all on function public.notify_max_age_ms() from public, anon, authenticated;
revoke all on function public.push_enqueue(uuid) from public, anon, authenticated;
revoke all on function public.push_due_count() from public, anon, authenticated;
revoke all on function public.push_end_queue(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.push_lock(uuid) from public, anon, authenticated;
revoke all on function public.prune_device_sessions(uuid) from public, anon, authenticated;
-- native_notif_active() leser hele brukerens sett uten en egen
-- autorisasjonssjekk — kallerne (list_my_devices/get_my_doc) sender sin egen
-- `auth.uid()` inn. Den er en byggekloss, ikke en RPC.
revoke all on function public.native_notif_active(uuid) from public, anon, authenticated;
-- session_alive()/current_session_id() svarer bare om KALLERENS egen økt, men
-- de er byggeklosser inne i RPC-ene — ikke en RPC klienten skal kalle selv.
revoke all on function public.session_alive(uuid) from public, anon, authenticated;
revoke all on function public.current_session_id() from public, anon, authenticated;

-- TRIGGERFUNKSJONENE er ikke RPC-er. Alle er `security definer` og gjør
-- privilegerte ting (vakter, gravsteiner, kaskader) uten en egen
-- autorisasjonssjekk — myndigheten ligger i skrivingen som utløste triggeren.
-- PostgreSQL gir hver ny funksjon EXECUTE til `public` som standard, og
-- Supabases Security Advisor flagger dem derfor som direkte kallbare.
--
-- Regelen er GENERISK, ikke en liste: alt i `public` som returnerer `trigger`
-- mister EXECUTE. En liste ville råtnet neste gang noen legger til en trigger;
-- dette dekker også den. Selve triggerkjøringen er upåvirket — den sjekker
-- TRIGGER-rettigheten på TABELLEN, ikke EXECUTE på funksjonen
-- (smoke-testens seksjon 6 og hele SQL-suiten kjører triggerne etterpå).
do $$
declare fn text;
begin
  for fn in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- SENDERENS to funksjoner leser og skriver ANDRE brukeres leveringer. De skal
-- derfor ikke kunne kalles med anon-nøkkelen eller av en innlogget bruker —
-- kun av service_role, som bare senderen har. Rollesjekken inne i funksjonene
-- er det andre laget; dette er det første.
revoke all on function public.push_claim(integer, bigint) from public, anon, authenticated;
revoke all on function public.push_report(jsonb) from public, anon, authenticated;
revoke all on function public.push_headers(text) from public, anon, authenticated;
revoke all on function public.push_tick() from public, anon, authenticated;
do $$ begin
  grant execute on function public.push_claim(integer, bigint) to service_role;
  grant execute on function public.push_report(jsonb) to service_role;
  grant execute on function public.push_headers(text) to service_role;
  grant execute on function public.push_tick() to service_role;
exception when undefined_object then null;  -- ingen service_role utenfor Supabase
end $$;

-- ------------------------------------------------------------
-- 13. REALTIME — legg tabellene i supabase_realtime-publikasjonen.
--     Hoppes over utenfor Supabase (ingen slik publikasjon).
-- ------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['universes', 'groups', 'cards', 'items', 'ideas',
                             'note_projects', 'note_folders', 'notes',
                             'object_links',
                             'memberships', 'share_invites'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. ENGANGS-SEED: navn på de to første kontoene
--     Navn (fornavn + etternavn) ble innført etter at disse to kontoene
--     allerede fantes; nye brukere legger inn navn ved registrering.
--     Setter KUN navnet hvis det fortsatt er auto-standarden (e-post-
--     prefiksen eller tomt), så en manuelt endret display_name aldri
--     overskrives ved re-kjøring, og hopper stille over hvis kontoen
--     ikke finnes ennå.
-- ------------------------------------------------------------

update public.profiles set display_name = 'Karin Falch', updated_at = now()
 where lower(email) = 'kvfalch@gmail.com'
   and coalesce(display_name, '') in ('', split_part(email, '@', 1));
update public.profiles set display_name = 'Peder Holman', updated_at = now()
 where lower(email) = 'peder.holman@gmail.com'
   and coalesce(display_name, '') in ('', split_part(email, '@', 1));
