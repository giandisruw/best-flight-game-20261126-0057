[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/giandisruw/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/giandisruw/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

# Skyline Ring Rush — Make the Best Flight Game

[![make.fun](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![make.fun](https://img.shields.io/badge/make.fun-leaderboard-blue)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard)
[![make.fun](https://img.shields.io/badge/play-make.fun-green)](https://make.fun)

**Competition:** [best-flight-game-20261126-0057](https://make.fun/bounty/best-flight-game-20261126-0057) — "Make the best flight game"
**Prize:** $500 shared by the top 50 (top 10 playable on makefun.gg). Entries close Sat 28 Nov 2026, 07:57 WIB.

## The game

A complete, original 3D flight game that runs 100% offline in a desktop
browser from static files — no network, no assets, no accounts.

You are a pilot in a red-and-white prop plane on a valley runway. Throttle
up, lift off, and thread all eight glowing rings on a course that sweeps
over a lake, between forested hills and under snow-capped mountains — then
bring her home and land on the runway. Crash into terrain or ditch in the
lake and the valley claims another one.

- **Real 3D world:** seeded procedural terrain (valley, hills, snow
  mountains, lake), runway with centreline and hangars, 220 trees, drifting
  clouds, sun.
- **Two cameras:** chase view (C) and cockpit view (C) with lit
  instruments — attitude indicator, altimeter, airspeed, compass strip,
  throttle lever and terrain warnings.
- **HUD:** altitude (ft), speed (kt), heading (°), rings, time, score,
  throttle bar, next-ring direction arrow.
- **Controls:** W/S or ↑/↓ pitch, A/D or ←/→ bank & turn, mouse steers,
  mouse wheel / Shift / Ctrl throttle, Space airbrake, C camera, P pause,
  R restart.
- **Scoring:** 1,000 points per ring, time bonus on completion, 500 for a
  safe landing after the course.

## How to play

Serve the folder statically and open `game/index.html`, or just open the
file directly in desktop Chrome:

```
node serve.ts
```

then visit http://localhost:8080/game/index.html — click **TAKE OFF**.

## Files

- `main.ts` — Node 22 builder/verifier: checks the game is fully offline,
  copies `game/` + `screenshots/` to the output dir and writes `dossier.json`.
  Run twice: `MAKEFUN_OUTPUT_DIR=out node main.ts` (byte-identical output).
- `game/` — the static game: `index.html`, `game.js`, `styles.css`.
- `game/index.html?shot=takeoff|ring|cockpit|valley` — deterministic
  screenshot scenes (see `shots.json`).
- `game/index.html?selftest=1` — built-in self-test (terrain, projection,
  ring detection, no-network, simulation).
- `screenshots/` — 4 real renders of the game running in headless Chromium.
- `vendor/makefun-game.ts` — from the bounty kit (copied unchanged at
  submit time; not included in this build-only snapshot).

## Verification (this build)

- `node --check game/game.js` — clean.
- Self-test (`?selftest=1` in headless Chromium) — see `TEST-REPORT.md`.
- `main.ts` run twice — identical `dossier.json` sha256 (see `TEST-REPORT.md`).
- Screenshots rendered with headless Chromium from the real game code.

## Referral

Referral code: `0txwmf1m`

## License

MIT — see `LICENSE`.
