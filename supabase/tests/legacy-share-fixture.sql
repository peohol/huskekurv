-- ============================================================
-- LEGACY-FIXTUR: databasen slik den så ut FØR rolle-omleggingen.
--
-- Brukes KUN av migrerings-testen (se run-tests.sh): den lager tabellene i
-- den gamle fasongen (memberships/share_invites med `card_id`, uten `role`;
-- mount-kolonner; ingen roller) og fyller dem med de fire situasjonene
-- docs/rettigheter-og-deling.md beskriver for migrering av listedelinger.
-- Deretter kjøres users-and-sharing.sql OVENPÅ, og testen sjekker at den
-- tidligere EFFEKTIVE tilgangen er bevart uten at noen har fått tilgang til
-- søskenlister.
--
-- NOTATSIDEN er med av samme grunn, i sin EGEN gamle fasong: bokhylle,
-- notatbok og notat slik de så ut da `owner_id` var hele autorisasjonen og
-- det ikke fantes en eneste medlemskapsrad for dem. Uten den delen tester
-- fixturen en database som aldri har eksistert — og nettopp det slapp
-- produksjonsfeilen gjennom: backfillen av bokhylleeiere hadde ingen rader å
-- sette inn, så den gamle, anonyme mål-sjekken ble aldri utfordret.
--
-- Skal ALDRI kjøres mot Supabase.
-- ============================================================

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.universes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,
  ts         bigint not null default 0,
  org        text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
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

create table public.cards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  title      text not null default '',
  trashed    boolean not null default false,
  locked     boolean not null default false,
  k          boolean not null default true,
  p          boolean not null default true,
  ts         bigint not null default 0,
  org        text   not null default '',
  lab_ts     bigint not null default 0,
  lab_org    text   not null default '',
  pos        double precision not null default 0,
  pos_ts     bigint not null default 0,
  pos_org    text   not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.items (
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

-- Den GAMLE mount-modellen: eieren hadde aldri medlemskapsrad, og mottakeren
-- valgte selv hvor det delte objektet skulle ligge.
create table public.memberships (
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
  updated_at         timestamptz not null default now(),
  -- ANONYM CHECK, akkurat som i produksjon: PostgreSQL navngir den
  -- `memberships_check`. Den er selve fellen migreringen må rydde bort før
  -- notatnivåene kan få medlemskapsrader.
  check (num_nonnulls(universe_id, group_id, card_id) = 1)
);

create table public.share_invites (
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
  responded_at  timestamptz,
  -- Produksjons tvilling til `memberships_check`: PostgreSQL kaller den
  -- `share_invites_check`, og den kjenner heller ikke notatnivåene.
  check (num_nonnulls(universe_id, group_id, card_id) = 1)
);

-- NOTATSIDEN slik den var FØR PR 3A: `owner_id` var hele autorisasjonen.
-- Ingen `locked`/`unlocked`/`invite_policy` (de kom med delingen), og ingen
-- medlemskapsrader i det hele tatt. users-and-sharing.sql legger på de nye
-- kolonnene selv — det er nettopp den additive veien som skal bevises.
create table public.note_projects (
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

create table public.note_folders (
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

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.note_projects (id) on delete cascade deferrable initially deferred,
  folder_id  uuid references public.note_folders (id) on delete set null deferrable initially deferred,
  title      text not null default '',
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

-- ------------------------------------------------------------
-- Data: fire situasjoner fra migreringsregelen
--   O  = eier av området          M  = områdemedlem
--   X  = direkte LISTE-mottaker (én-liste-mappe)   → skal bli mappemedlem
--   Y  = direkte LISTE-mottaker (flerliste-mappe)  → skal få en NY mappe
--   W  = direkte MAPPE-medlem i flerliste-mappen  → skal følge med til den nye
--   Z  = direkte LISTE-mottaker av en TRASHET liste, i en mappe som har en
--        ANNEN aktiv liste → må IKKE promoteres inn i mappen (da ville Z fått
--        se søskenlista); lista skal splittes ut som før.
--
-- I tillegg: O har en EKSISTERENDE bokhylle med en notatbok, et notat i
-- notatboken og et FRITT notat (uten notatbok). Ingen av dem har en
-- medlemskapsrad — backfillen skal gi O eierrollen på bokhyllen, og de to
-- nivåene under skal arve.
-- ------------------------------------------------------------

insert into auth.users (id, email) values
  ('01000000-3333-0000-0000-00000000000a', 'mig-o@example.com'),
  ('01000000-3333-0000-0000-00000000000b', 'mig-m@example.com'),
  ('01000000-3333-0000-0000-00000000000c', 'mig-x@example.com'),
  ('01000000-3333-0000-0000-00000000000d', 'mig-y@example.com'),
  ('01000000-3333-0000-0000-00000000000e', 'mig-w@example.com'),
  ('01000000-3333-0000-0000-00000000000f', 'mig-z@example.com');
insert into public.profiles (id, email, display_name)
  select id, email, split_part(email, '@', 1) from auth.users;

insert into public.universes (id, owner_id, name, pos) values
  ('11000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a', 'Legacy', 1);

insert into public.groups (id, owner_id, universe_id, name, pos) values
  -- G1: ÉN liste, delt direkte med X
  ('12000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '11000000-3333-0000-0000-000000000001', 'Én liste', 1),
  -- G2: TO lister; den ene delt med Y, den andre delt med M (redundant)
  ('12000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '11000000-3333-0000-0000-000000000001', 'Flere lister', 2),
  -- G3: en TRASHET delt liste + en aktiv søskenliste
  ('12000000-3333-0000-0000-000000000003', '01000000-3333-0000-0000-00000000000a',
   '11000000-3333-0000-0000-000000000001', 'Med søppel', 3);

insert into public.cards (id, owner_id, group_id, title, pos) values
  ('13000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000001', 'Alenelista', 1),
  ('13000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000002', 'Y-lista', 1),
  ('13000000-3333-0000-0000-000000000003', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000002', 'Søskenlista', 2),
  ('13000000-3333-0000-0000-000000000005', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000003', 'Z sin aktive søsken', 2);
insert into public.cards (id, owner_id, group_id, title, pos, trashed) values
  ('13000000-3333-0000-0000-000000000004', '01000000-3333-0000-0000-00000000000a',
   '12000000-3333-0000-0000-000000000003', 'Z-lista (i søpla)', 1, true);

insert into public.items (id, owner_id, card_id, text, pos) values
  ('14000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '13000000-3333-0000-0000-000000000002', 'Y ser denne', 1),
  ('14000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '13000000-3333-0000-0000-000000000003', 'Y skal IKKE se denne', 1);

-- M er områdemedlem (gammel modell: medlemskapsrad på området)
insert into public.memberships (user_id, universe_id, pos) values
  ('01000000-3333-0000-0000-00000000000b', '11000000-3333-0000-0000-000000000001', 1);
-- W er direkte mappemedlem i flerliste-mappen, montert i sitt eget syn
insert into public.memberships (user_id, group_id, pos) values
  ('01000000-3333-0000-0000-00000000000e', '12000000-3333-0000-0000-000000000002', 1);
-- X og Y er direkte LISTE-mottakere; M har en REDUNDANT listedeling
insert into public.memberships (user_id, card_id, pos) values
  ('01000000-3333-0000-0000-00000000000c', '13000000-3333-0000-0000-000000000001', 1),
  ('01000000-3333-0000-0000-00000000000d', '13000000-3333-0000-0000-000000000002', 2),
  ('01000000-3333-0000-0000-00000000000b', '13000000-3333-0000-0000-000000000003', 3),
  -- Z er mottaker av den TRASHEDE lista
  ('01000000-3333-0000-0000-00000000000f', '13000000-3333-0000-0000-000000000004', 4);

-- Ventende invitasjon på Y-lista til en adresse uten konto ennå
insert into public.share_invites (inviter_id, invitee_email, card_id, status) values
  ('01000000-3333-0000-0000-00000000000a', 'mig-ny@example.com',
   '13000000-3333-0000-0000-000000000002', 'pending');

-- Notatsiden: en bokhylle O opprettet den gangen `owner_id` var alt som
-- fantes. Ingen medlemskapsrader — nøyaktig som produksjon før PR 3A.
insert into public.note_projects (id, owner_id, name, pos) values
  ('15000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   'Gammel bokhylle', 1);
insert into public.note_folders (id, owner_id, project_id, name, pos) values
  ('16000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '15000000-3333-0000-0000-000000000001', 'Gammel notatbok', 1);
insert into public.notes (id, owner_id, project_id, folder_id, title, body, pos) values
  ('17000000-3333-0000-0000-000000000001', '01000000-3333-0000-0000-00000000000a',
   '15000000-3333-0000-0000-000000000001', '16000000-3333-0000-0000-000000000001',
   'Gammelt notat', '{"v":1,"blocks":[{"t":"p","s":"Skrevet før delingen fantes"}]}'::jsonb, 1),
  -- FRITT notat: ligger rett i bokhyllen. Arven går en annen vei enn for et
  -- notat i en notatbok, så begge må være med.
  ('17000000-3333-0000-0000-000000000002', '01000000-3333-0000-0000-00000000000a',
   '15000000-3333-0000-0000-000000000001', null,
   'Gammelt fritt notat', '{"v":1,"blocks":[]}'::jsonb, 2);
