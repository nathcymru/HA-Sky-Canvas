# Shared weather and flood warnings

`createWeatherAlerts({resolveHost?, now?})` exposes `update(config, hass)` and
`destroy()`. The renderer owns refresh, configuration and the HA connection.
This module reads existing entities; it never requests provider data or API keys.
The banner is independent of decorative scene and dashboard selection.

The default locator is a bounded Lovelace/Energy compatibility boundary. It prepends its
own normal-flow element to `hui-view-container#view > hui-view`, requiring the established
Home Assistant shadow-root chain and the live-verified flex column layout. The
outer view container is a horizontal flex row and must not be the mount. It does not
use the decorative background or change any HA/card style. Unknown layouts return
null. Additional panel adapters require live DOM verification before use.

## Data and accessibility

- Met Office: `sensor.metoffice_direct_warning_level`, normalized `warnings[]`,
  `fetched_at`. Maximum age 10 minutes, with the provider polling every minute.
  Issued upcoming warnings remain visible; validity is evaluated locally in
  absolute time and displayed in UK local time (`Europe/London`) even if the
  Home Assistant time zone differs. Every warning's weather type, severity,
  supplied issued/updated status and Crown Copyright attribution are initially
  visible. Full headline, expectation, advice and further details are preserved
  in individual disclosures. Only the initial headline/announcement is shortened.
  A region fallback is explicitly labelled as uncertain property coverage.
- NRW: `sensor.nrw_flood_direct_warnings`, normalized active `warnings[]`,
  `fetched_at`, `stale_after_seconds`, and explicit `scope`. Maximum age 30 minutes.
  Severity 1 is severe, 2 warning, 3 alert. Cleared severity 4 is not active.
  Individual message dates never imply expiry; a fresh feed controls removal.
  A current home-polygon result outside the published areas gets an explicit
  coverage explanation, never a clear/no-risk state. Coverage metadata expires
  after its own daily refresh interval; an old offline result is not restated as
  a current location fact.
- A fresh empty list hides the relevant row. Missing, stale, malformed or
  inconsistent data produces an explicit unavailable/out-of-date row, never a
  reassuring zero. No claim is made that an empty warning list means no risk.
- Each agency keeps its own labelled row. Full category/action text accompanies
  the colour and symbol. Native details/links support keyboard use. Material
  changes use a polite live region without moving focus or repeatedly announcing
  every data fetch. Container queries support narrow dashboard columns.
- Source text is escaped by Lit. Links permit only the appropriate agency's HTTPS
  hosts. No third-party scripts, remote image loads or agency logos are included.

## Official colour provenance

Verified on 28 October 2026 from the public first-party sites. These are the
published website colours, not a claim of a separate normative agency design
standard. This component uses the exact severity colours with a white surface.
Weather warnings use text labels without weather icons; flood warnings have an
original triangle. It does not reproduce agency graphics or branding.

| Category | Exact accent | Primary source declaration |
| --- | --- | --- |
| Weather yellow | `#ffe923` | `--warning-yellow:#ffe923` |
| Weather amber | `#ff9900` | `--warning-amber:#f90` |
| Weather red | `#ca0a37` | `--warning-red:#ca0a37` |
| NRW flood alert | `#eb7100` | `.live-message--flood-alert.live-message--active:before` background |
| NRW flood warning | `#c40000` | `.live-message--flood-warning.live-message--active:before` background |
| NRW severe flood warning | `#c40000` | `.live-message--severe-flood-warning.live-message--active:before` background |

The weather custom properties are in the inline stylesheet on the
[Met Office warnings guide](https://weather.metoffice.gov.uk/guides/warnings).
The NRW rules are in the official
[live flood-warning stylesheet](https://flood-warning.naturalresources.wales/css/index.css).
That stylesheet also uses `#cf4b09` for flood-alert text; the banner uses dark text
on white and confines the brighter category colour to non-text accents.
Warning and severe flood warning intentionally share the same official red;
the full label and immediate-action/danger-to-life text distinguish them.

Guidance: [weather warning meaning and presentation](https://weather.metoffice.gov.uk/guides/warnings),
[Met Office flood warning guide](https://weather.metoffice.gov.uk/guides/flood-warnings),
[NRW actions and service limits](https://naturalresources.wales/flooding/what-to-do-in-a-flood/?lang=en).
Weather colour represents the provider's impact/likelihood assessment; the
component preserves it and does not recalculate the warning matrix.

The [NSWWS developer style guide v1.4, October 2026](https://www.metoffice.gov.uk/api/assets/file/03115NSWWSStyleGuideupdate_v5pdf)
also confirms these weather colours and defines attribution, UK time, required
warning content and timeliness. The display follows its UK attribution form.
Full source strings are preserved up to the provider's 8 MiB response bound;
unsupported content shapes fail as unavailable rather than silently losing
advice. Updated labels use supplied status/update descriptions or the documented
numeric warning version, never a guessed change in weather severity.

## Offline demonstration

`tests/preview/alerts.html` and `alerts.ts` render labelled synthetic examples for
all levels, upcoming weather warnings, clear, stale and unavailable data.
Bundle the TypeScript file to `alerts-preview.js` beside the HTML with esbuild,
then serve those two files locally. It makes no HA or weather API calls.
The demo must never be installed as a live warning entity.
