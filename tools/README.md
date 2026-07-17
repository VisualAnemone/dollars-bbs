# Gravity Runner toolchain

Development tools for `public/gravity-guy.html`. The game ships as a single
self-contained file; these tools author, prove, and test it.

## leveldev/
- `author.py` — level content as structured specs (solid ranges + orb
  positions per lane). Generates the row strings and asserts geometry
  invariants (equal widths, solid outer-rail boundaries, orbs never inside
  platforms). `python3 author.py > levels.json`
- `solver.py` — physics-accurate route search using the game's exact
  constants. Proves every beat AND every composed passage is traversable
  at 450 & 660 px/s, entering on floor or ceiling, in both vertical
  orientations. Run after any level change; nothing ships unsolved.
- `levels.json` — generated, solver-proven level data. The CHUNKS block in
  the game file must match it exactly.

## test/
- `dom-stub.js` — minimal browser stub for running the real game headless.
- `harness-solo.js` — solo + daily flows: countdown, autopsy, retry cycles,
  ghost recording, pause, title navigation.
- `harness-versus.js` — full 2P and 4P matches to completion + overtime.
- `render-shots.js` — renders real gameplay frames to PNG via
  @napi-rs/canvas (`npm i @napi-rs/canvas` under /tmp, see require path).
