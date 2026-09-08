#!/usr/bin/env node
/* ============================================================
   Holder deploy-smoke-testen (supabase/smoke-test.sql) i takt med klienten.

   Smoke-testen er porten produksjonsdeployen må gjennom: den sjekker at alt
   den nye frontenden trenger faktisk finnes i databasen. Den er bare verdt noe
   hvis listene i den ER klientens faktiske kontrakt. Legger noen til en kolonne
   i insertPayload() eller en ny .rpc(...) uten å utvide smoke-testen, slipper
   nettopp den endringen gjennom porten som skulle stoppe den — og synken
   stopper i produksjon (cards/items.collapsed-hendelsen om igjen).

   Denne testen leser derfor app.js og krever at:

     1. hver tabell i TABLE-mappingen sjekkes av smoke-testen
     2. hver tabell klienten abonnerer på med postgres_changes er med i
        realtime-sjekken
     3. hver kolonne insertPayload()/updatePayload() sender har en
        «tabell:kolonne»-oppføring
     4. hver .rpc('...') klienten kaller står i RPC-listen
     5. hver RPC som er execute-grantet i users-and-sharing.sql står der også
        (så en ny serverside-RPC ikke blir usjekket)

   Ren node-test — ingen server, ingen nettleser.

   Kjør:
     node tests/db-contract.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const smoke = fs.readFileSync(path.join(ROOT, 'supabase', 'smoke-test.sql'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'users-and-sharing.sql'), 'utf8');

let pass = 0, fail = 0;
function check(navn, ok, evidens) {
  if (ok) { pass++; console.log('PASS — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
  else { fail++; console.log('FAIL — ' + navn + (evidens ? '  [' + evidens + ']' : '')); }
}

/* ---- Hjelpere: klipp ut balanserte {…}-blokker fra app.js ---- */
function balansert(kilde, fra) {
  const start = kilde.indexOf('{', fra);
  if (start === -1) return null;
  let dybde = 0;
  for (let i = start; i < kilde.length; i++) {
    if (kilde[i] === '{') dybde++;
    else if (kilde[i] === '}') { dybde--; if (dybde === 0) return kilde.slice(start, i + 1); }
  }
  return null;
}
function funksjonskropp(navn, kilde) {
  const start = kilde.indexOf('function ' + navn + '(');
  return start === -1 ? null : balansert(kilde, start);
}
function nøkler(objekt) {
  return [...objekt.matchAll(/(?:^|[{,]\s*)([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

/* ---- 1. Tabeller i TABLE-mappingen ---- */
const tableMatch = app.match(/const TABLE = \{([^}]*)\}/);
check('fant TABLE-mappingen i app.js', !!tableMatch);
const tabeller = tableMatch
  ? [...tableMatch[1].matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1])
  : [];
// Ni radtyper: de fire hierarkinivåene, idéene (docs/ideer.md), de tre
// notatnivåene og koblingene mellom de to hoveddelene (docs/notater-plan.md).
// Alt annet enn hierarkinivåene henger på kontoen, ikke i treet.
check('TABLE-mappingen har ni radtyper', tabeller.length === 9, tabeller.join(', '));
for (const t of tabeller) {
  check("smoke-testen sjekker tabellen «" + t + "»",
    new RegExp("'" + t + "'").test(smoke));
}

/* ---- 2. Realtime-abonnementet ---- */
const rtMatch = app.match(/\[([^\]]*)\]\.forEach\(\(t\) => \{\s*cloudChan\.on\('postgres_changes'/);
check('fant realtime-tabellisten i app.js', !!rtMatch);
const rtTabeller = rtMatch ? [...rtMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
check('realtime-listen har elleve tabeller', rtTabeller.length === 11, rtTabeller.join(', '));

const rtSeksjon = smoke.slice(smoke.indexOf('8. Realtime-publikasjon'),
                              smoke.indexOf('9. Virker det?'));
for (const t of rtTabeller) {
  check("realtime-sjekken dekker «" + t + "»", new RegExp("'" + t + "'").test(rtSeksjon));
}

/* ---- 3. Kolonner klienten skriver, PER TABELL ---- */
// insertPayload()/updatePayload() bygger `base` (felles for alle fire nivåene)
// og legger radtypens egne felter oppå med Object.assign. Nøklene er NØYAKTIG
// kolonnenavnene PostgREST får — mangler én i databasen, avvises hver eneste
// skriving for den radtypen.
//
// Kravet må sjekkes per tabell, ikke bare per kolonnenavn: `collapsed` finnes
// på alle fire, og en smoke-test som bare nevner «universes:collapsed» ville
// ellers se komplett ut mens cards.collapsed sto usjekket — som er akkurat den
// kolonnen som stoppet synken sist.
const NIVA_TABELL = { universe: 'universes', group: 'groups', card: 'cards', idea: 'ideas',
  note_project: 'note_projects', note_folder: 'note_folders', note: 'notes', item: 'items' };
const kontrakt = { universes: new Set(), groups: new Set(), cards: new Set(), ideas: new Set(),
  note_projects: new Set(), note_folders: new Set(), notes: new Set(), items: new Set() };

for (const fn of ['insertPayload', 'updatePayload']) {
  const kropp = funksjonskropp(fn, app);
  check('fant ' + fn + '() i app.js', !!kropp);
  if (!kropp) continue;

  // `base` gjelder alle tabellene.
  const base = balansert(kropp, kropp.indexOf('const base'));
  check(fn + '(): fant base-objektet', !!base);
  if (base) for (const t of Object.keys(kontrakt)) nøkler(base).forEach((k) => kontrakt[t].add(k));

  // …og så én gren per radtype. Grenen uten `if` er listepunkt-grenen (fall-through).
  const grener = [...kropp.matchAll(
    /(?:if \(t === '(universe|group|card|idea|note_project|note_folder|note)'\) )?return Object\.assign\(base, /g)];
  check(fn + '(): fant åtte grener (én per radtype)', grener.length === 8, grener.length + ' grener');
  for (const g of grener) {
    const tabell = NIVA_TABELL[g[1] || 'item'];
    const objekt = balansert(kropp, g.index + g[0].length);
    if (objekt) nøkler(objekt).forEach((k) => kontrakt[tabell].add(k));
  }
}

const kolonneSeksjon = smoke.slice(smoke.indexOf('2. Kolonner klienten skriver'),
                                   smoke.indexOf('3. RLS er på'));
for (const [tabell, felter] of Object.entries(kontrakt)) {
  check('fant feltene klienten skriver til ' + tabell,
    felter.size >= 10, felter.size + ' felter');
  const manglende = [...felter].filter((k) => !kolonneSeksjon.includes("'" + tabell + ':' + k + "'"));
  check('smoke-testen dekker alle ' + felter.size + ' feltene på ' + tabell,
    manglende.length === 0,
    manglende.length ? 'mangler: ' + manglende.map((k) => tabell + '.' + k).join(', ')
                     : [...felter].sort().join(', '));
}

/* ---- 4. RPC-er klienten kaller ---- */
const rpcKlient = [...new Set([...app.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
check('fant RPC-kallene i app.js', rpcKlient.length >= 15, rpcKlient.length + ' RPC-er');

const rpcSeksjon = smoke.slice(smoke.indexOf('5. RPC-er:'), smoke.indexOf('6. Interne funksjoner'));
const rpcMangler = rpcKlient.filter((r) => !new RegExp("public\\." + r + "\\(").test(rpcSeksjon));
check('alle RPC-ene klienten kaller er med i smoke-testen',
  rpcMangler.length === 0,
  rpcMangler.length ? 'mangler: ' + rpcMangler.join(', ') : rpcKlient.join(', '));

/* ---- 5. RPC-er serveren eksponerer ---- */
// Grant-løkken nederst i users-and-sharing.sql er fasiten for hva som ER en
// RPC. En ny oppføring der uten en tilsvarende linje i smoke-testen ville
// betydd en usjekket inngang til databasen.
const grantBlokk = sql.slice(sql.indexOf("'public.create_share_invite("));
const grantSlutt = grantBlokk.indexOf('] loop');
const grantet = [...grantBlokk.slice(0, grantSlutt).matchAll(/'(public\.[a-z_]+\([^)]*\))'/g)]
  .map((m) => m[1]);
check('fant grant-løkken i users-and-sharing.sql', grantet.length >= 15, grantet.length + ' funksjoner');

const signaturMangler = grantet.filter((s) => !rpcSeksjon.includes("'" + s + "'"));
check('alle grantede RPC-signaturer står i smoke-testen med samme signatur',
  signaturMangler.length === 0,
  signaturMangler.length ? 'mangler: ' + signaturMangler.join(', ') : grantet.length + ' signaturer');

// …og motsatt: smoke-testen skal ikke sjekke en signatur som ikke er grantet
// (da ville den feile mot en riktig database).
const smokeSignaturer = [...rpcSeksjon.matchAll(/'(public\.[a-z_]+\([^)]*\))'/g)].map((m) => m[1]);
const overflødige = smokeSignaturer.filter((s) => !grantet.includes(s));
check('smoke-testen sjekker ingen RPC som ikke er grantet',
  overflødige.length === 0,
  overflødige.length ? 'ukjente: ' + overflødige.join(', ') : smokeSignaturer.length + ' signaturer');

console.log('\n==== ' + pass + '/' + (pass + fail) + ' PASS ====');
process.exit(fail === 0 ? 0 : 1);
