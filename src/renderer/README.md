# Renderer API and compatibility boundary

`bootstrapSkyCanvas()` discovers the current authenticated HA frontend, subscribes to
`ha_sky_canvas/subscribe`, fetches `ha_sky_canvas/config`, and creates a scene only on
selected Lovelace dashboard routes. It returns an idempotent `destroy()` handle. The
adapter owns page lifecycle cleanup; the entry module should call it once and should
not add an unconditional `pagehide` destructor, which would break browser back/forward
cache restoration.

`new SkyScene(host, { seed?, now?: () => Date, motion?: boolean })` provides an isolated
scene for embedding and visual verification. Supply `update(config, hass)` when inputs
change. `motion: false` produces a still without scheduling RAF. `destroy()` cancels
requests and frames, disconnects observers/listeners, revokes object URLs, and removes
the scene. `WeatherEngine` and `AnimationRuntime` support deterministic rendering
without HA or a scheduler.

The three descendants are sky canvas (`data-layer="3"`, z=0), whole house image
(`data-layer="2"`, z=1), and transparent weather canvas (`data-layer="1"`, z=2). The
scene is decorative, inert and inaccessible to pointer/keyboard input. The house
uses `object-fit: contain; object-position: center bottom`; its transparent sky lets
the background remain visible. No image artwork is cropped or stretched.

In Home Assistant's effective Light appearance, the adapter composites the entire
scene at 15% opacity over the theme's primary background color. This keeps native
headings readable without changing card styles or individual images; Dark appearance
retains the original scene. The live test palette (`#e6e9ef` background, `#4c4f69`
primary text and `#5c5f77` secondary text) has worst-case black-scene contrast ratios
of 4.67:1 and 3.66:1 respectively. This is a bounded result for that palette, not an
accessibility guarantee for arbitrary themes or all small secondary text. Appearance
switches, including Auto, take effect on the next renderer refresh.

The adapter uses this **private frontend structure**, not an official HA background
extension API:

`home-assistant` → shadow → `home-assistant-main` → shadow →
`ha-panel-lovelace` (directly or through `partial-panel-resolver`) → shadow →
`hui-root` → shadow → `hui-view-container#view > hui-view-background`.

It mounts only inside the existing decorative background's shadow root. It does not
rewrite card layout, intercept history, or install global selectors. The background
opacity override is restored on exit. If the structure or Canvas 2D is unavailable,
the scene is omitted and HA keeps its own dashboard. A two-second, visibility-aware
poll handles HA panel mounting, reconnects, and date boundaries, alongside navigation
events. Read-only source inspection matched Home Assistant frontend tag `20260930.5`,
which HA Core 2026.10.4 pins in its frontend manifest, on 2026-10-28; this is not a substitute for live tests on the installed HA version.

Themes are evaluated using Home Assistant's configured timezone. Annual cross-year
ranges and one-off ranges include both endpoints. Explicit priority resolves overlaps;
missing seasonal slots fall back to the same Default slot, and an empty Default slot
shows no house. `sun.sun` selects day/night. Rain and snow/hail image selection takes
precedence over an optional frost boolean; fog/cloud/wind can share the clear house
image while retaining distinct animations. Unknown weather draws a neutral sky and
does not render the sun.

## Upstream refactor

All 21 upstream animation modules from Dynamic Weather Card v2026.10.2 have a working
copy under `animations/`; the original archive remains under `vendor/`. Copyright
(c) 2026 Teuchezh Nurbiy, MIT; the full licence is retained here in `LICENSE`. Each
derived module carries attribution. The sky palette and sun geometry are also derived
from that release; unrelated card UI and clock heuristics are excluded.

The refactor replaces effect-local wall clocks and nondeterministic random calls with
one injected monotonic clock and seeded stream, passes that runtime through nested
effects, bounds particles independently of viewport area, and separates celestial
objects from foreground clouds. Modern rain, snow, hail, fog, clouds, wind, sun/moon,
stars and opt-in lightning drive the scene. Classic variants, aurora and glass drops
remain available as source modules; no unsupported weather state or new settings are
invented to activate those optional effects.

Per-canvas pixel budgets are 0.9/1.8/3 million for low/medium/high, with a maximum DPR
of 2. Frames are capped at 20/30/60 FPS. Rain/snow/hail cap each depth layer at
60/110/180 particles. Cloud counts cap at 60 per layer; wind particle counts are
bounded. Hidden tabs pause and reduced-motion renders a static frame. The adapter,
model, actual effects, frame lifecycle, and image-request cancellation have unit
coverage. Device smoothness and real dashboard control reachability still require
browser acceptance checks.
