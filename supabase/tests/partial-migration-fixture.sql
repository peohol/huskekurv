-- ============================================================
-- PRODUKSJONENS MELLOMTILSTAND: PR 3A-migreringen som stoppet MIDTVEIS.
--
-- Filene i dette repoet kjøres mot en LEVENDE database uten transaksjon rundt
-- (psql, ikke `begin`/`commit`), så en feil et stykke ned i fila etterlater
-- alt over feilpunktet COMMITTET. 2026-09-09 var feilpunktet backfillen av
-- bokhylleeiere: de nye policyene, de nye kolonnene og den nye mål-sjekken var
-- installert, mens ingen bokhylle hadde fått en eneste rolle — og eierne så
-- derfor ikke sine egne notater.
--
-- Fila skrur en FERDIG migrert testdatabase tilbake til nøyaktig den
-- tilstanden, så hotfixen kan bevises mot den og ikke bare mot de to enkle
-- ytterpunktene (gammel database / ferdig migrert database).
--
-- Brukes KUN av run-tests.sh. Skal ALDRI kjøres mot Supabase.
-- ============================================================

-- 1. Ingen roller på notatsiden — backfillen rakk aldri å kjøre.
--    Siste-eier-vakten står i veien for nettopp denne slettingen, og det er
--    meningen: den beskytter en invariant vi her har til hensikt å bryte for å
--    gjenskape feilen.
alter table public.memberships disable trigger memberships_last_owner_guard;
delete from public.memberships
 where note_project_id is not null or note_folder_id is not null or note_id is not null;
alter table public.memberships enable trigger memberships_last_owner_guard;

-- 2. Den gamle, anonyme mål-sjekken tilbake på plass, ved siden av den nye.
--    Slik STO produksjon: `memberships_check` fra den aller første
--    `create table` hadde aldri blitt fjernet, og den kjenner ikke
--    notatnivåene. Navnene er de PostgreSQL selv ville gitt dem.
do $$ begin
  alter table public.memberships add constraint memberships_check
    check (num_nonnulls(universe_id, group_id, card_id) = 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.share_invites add constraint share_invites_check
    check (num_nonnulls(universe_id, group_id, card_id) = 1);
exception when duplicate_object then null; end $$;
