// Skyline Ring Rush — make.fun "best-flight-game-20261126-0057" entry builder.
//
// Node 22, standard library only. Verifies the static game in game/,
// copies game/ + screenshots/ to the output directory and writes
// dossier.json — the summary the judge reads (screenshots, first-load
// files and bytes, and the source outline).
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// NOTE: this bounty kit ships vendor/makefun-game.ts, which is NOT in this
// directory (the kit tarball was not downloaded in this build session).
// Until that file is copied in from the kit, the dossier records
// vendor/makefun-game.ts as MISSING and this script still exits 0, so the
// entry can be inspected and screenshotted; the kit's own buildDossier
// (which requires the vendored file) is the step that must run at submit
// time. Nothing here fabricates the vendored file's contents.
//
// Determinism: dossier.json contains no timestamps and no absolute paths;
// file lists are sorted and every file is hashed, so two runs of this
// script over the same entry produce byte-identical output.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? join(here, 'out');
const SLUG = 'best-flight-game-20261126-0057';
const WALLET = 'FzRPdDzEX93zyAkQ32UVy26HjjY5CGUM8qJDXREzx6pP';

const REQUIRED_GAME = ['index.html', 'game.js', 'styles.css'];
const REQUIRED_SHOTS = ['1-takeoff.png', '2-ring-chase.png', '3-cockpit.png', '4-valley.png'];
const VENDOR_FILE = join(here, 'vendor', 'makefun-game.ts');

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p));
  }
  return out.sort();
}
function countLines(text) { return text.split('\n').length; }
function topLevelFunctions(text) {
  const names = new Set();
  for (const m of text.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/gm)) {
    names.add(m[1] || m[2]);
  }
  return [...names].sort();
}

const errors = [];
const warnings = [];

// ---- 1. required files -------------------------------------------------
for (const f of REQUIRED_GAME) {
  if (!existsSync(join(here, 'game', f))) errors.push(`missing game/${f}`);
}
for (const f of REQUIRED_SHOTS) {
  if (!existsSync(join(here, 'screenshots', f))) errors.push(`missing screenshots/${f}`);
}
if (!existsSync(join(here, '.makefun', 'owner.json'))) errors.push('missing .makefun/owner.json');
if (!existsSync(join(here, 'README.md'))) errors.push('missing README.md');
if (!existsSync(join(here, 'LICENSE'))) errors.push('missing LICENSE');

// ---- 2. offline check: no network references anywhere in game/ --------
const NETWORK_RE = /(https?:\/\/|src\s*=\s*["']https?:|url\(\s*["']?https?:|@import\s+["']https?:|fetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon)/;
const networkHits = [];
for (const f of listFiles(join(here, 'game'))) {
  const text = readFileSync(join(here, 'game', f), 'utf8');
  if (NETWORK_RE.test(text)) networkHits.push(`game/${f}`);
}
if (networkHits.length) errors.push(`network references found in: ${networkHits.join(', ')}`);

// ---- 3. owner.json exact contents --------------------------------------
let ownerOk = false;
const ownerPath = join(here, '.makefun', 'owner.json');
if (existsSync(ownerPath)) {
  const raw = readFileSync(ownerPath, 'utf8');
  ownerOk = raw === JSON.stringify({ wallet: WALLET });
  if (!ownerOk) errors.push('.makefun/owner.json contents do not match the required wallet exactly');
}

// ---- 4. vendor file from the kit (expected missing in a build-only run) -
const vendorPresent = existsSync(VENDOR_FILE);
if (!vendorPresent) {
  warnings.push('vendor/makefun-game.ts MISSING — copy it unchanged from the bounty kit before submit; it is the only file not built here');
}

// ---- 5. copy to output --------------------------------------------------
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// ---- 6. dossier ---------------------------------------------------------
function fileRecord(relDir, rel) {
  const buf = readFileSync(join(here, relDir, rel));
  return { path: `${relDir}/${rel}`, bytes: buf.length, sha256: sha256(buf) };
}
const gameFiles = listFiles(join(here, 'game')).map(f => fileRecord('game', f));
const shotFiles = listFiles(join(here, 'screenshots')).map(f => fileRecord('screenshots', f));
const sourceOutline = {};
for (const f of listFiles(join(here, 'game'))) {
  const text = readFileSync(join(here, 'game', f), 'utf8');
  sourceOutline[`game/${f}`] = {
    lines: countLines(text),
    bytes: Buffer.byteLength(text),
    ...(f.endsWith('.js') ? { functions: topLevelFunctions(text) } : {}),
  };
}
const dossier = {
  competition: SLUG,
  title: 'Skyline Ring Rush',
  wallet: WALLET,
  game: 'A complete original 3D flight game: take off from a valley runway, fly eight glowing rings over a lake and mountain valley, land. Chase and cockpit cameras, lit instruments, HUD (altitude, speed, heading). Keyboard + mouse, 100% offline static files.',
  checks: {
    required_files_present: errors.length === 0,
    no_network_requests: networkHits.length === 0,
    owner_json_exact: ownerOk,
    vendor_file: vendorPresent ? 'present' : 'MISSING (from kit)',
    screenshots: REQUIRED_SHOTS.map(f => ({ file: `screenshots/${f}`, present: existsSync(join(here, 'screenshots', f)) })),
  },
  warnings,
  errors,
  files: [...gameFiles, ...shotFiles],
  source_outline: sourceOutline,
  totals: {
    game_files: gameFiles.length,
    game_bytes: gameFiles.reduce((s, f) => s + f.bytes, 0),
    screenshots: shotFiles.length,
    screenshot_bytes: shotFiles.reduce((s, f) => s + f.bytes, 0),
  },
};
writeFileSync(join(out, 'dossier.json'), JSON.stringify(dossier, null, 2) + '\n');

console.log(`competition: ${SLUG}`);
console.log(`output: ${out}`);
console.log(`game files: ${dossier.totals.game_files} (${dossier.totals.game_bytes} bytes)`);
console.log(`screenshots: ${dossier.totals.screenshots} (${dossier.totals.screenshot_bytes} bytes)`);
for (const w of warnings) console.log(`WARNING: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
if (errors.length) {
  console.log('dossier.json written, but verification FAILED.');
  process.exit(1);
}
console.log('dossier.json written. Verification passed (vendor file still to be added from the kit).');
