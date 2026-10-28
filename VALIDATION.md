# Validation record

## 0.3.0 — 28 October 2026

This record separates automated checks, deployment evidence and remaining live acceptance. It describes the tested Home Assistant Core 2026.10.4 deployment; it does not establish compatibility with every frontend version or device.

### Local checks completed

| Check | Recorded result |
| --- | --- |
| Frontend tests | 182 passed |
| Python tests | 76 passed |
| TypeScript | `npm run typecheck` passed |
| Python lint and formatting | Ruff checks passed |
| Frontend build | `npm run build` completed |
| Weather regression checks after typography adjustment | 31 passed |

Frontend regressions cover the [custom-element registry startup boundary](docs/frontend-loading.md), including the production esbuild output, forecast subscriptions and cleanup, stale/missing data, native grid presets, editor configuration, accessible condition labels, saved appearance preferences and warning-feed semantics. Python checks cover configuration migration, storage validation and the existing integration behavior.

The standalone layout preview uses explicitly simulated data. Its containing page now applies a 1.6 line height, reproducing Home Assistant's inherited typography; weather cards set their own line height. Responsive fitting checks in that preview are supporting evidence, not a substitute for the live dashboard checks below.

### Live deployment checkpoint

The post-restart check at **12:46 UTC on 28 October 2026** recorded:

- Home Assistant Core **2026.10.4**, Sky Canvas **0.3.0** and NRW Flood Direct **0.1.1** running.
- Native configuration validation returned valid, with no errors or warnings.
- All seven configured Met Office API status entities and the NRW API status were available; the precipitation forecast map reported ready.
- The existing Home Assistant forecast action returned **49 hourly** and **7 daily** periods. These are the supplied periods at that check, not guaranteed future forecast lengths.
- **103 runtime file hashes matched** the staged deployment, with no mismatches; five saved dashboard configurations matched the intended updates and existing scene settings were preserved.
- NRW's fresh home selection reported zero active warnings. Its separate area-selection diagnostic no longer forces the warning state to unavailable.

A fresh first dashboard load after restart rendered weather cards, confirming recovery from the previously reproduced “Custom element not found” error. Subsequent live visual inspection identified inherited line height affecting fixed-height cards. The final typography, narrow-layout and scrollbar corrections passed all 182 frontend tests and TypeScript checks again.

### Final presentation checks

The final frontend candidate was checked in the live deployment with these bounded results:

- Three fresh direct loads into Weather, Overview and Kiosk rendered the custom weather cards without configuration errors; navigation to the 3D dashboard also worked.
- At a 320 px phone viewport, the 304 px overview and forecast cards displayed current temperature, feels-like temperature and the condition label without overflow. Desktop cards also fitted after the typography correction.
- Hourly, seven-day Outlook and Simple views displayed provider data. Forecast lengths and current values depend on the provider response.
- The precipitation map loaded 25 frames; play, next-frame and pause controls worked.
- The native visual editor showed all nine presets, updated the layout including the 3 × 1 preset, and preserved the saved configuration when cancelled.
- The global glass preference saved and survived reload. The unsaved-tab prompt worked. The test restored the solid appearance afterwards.

These checks establish the inspected routes, controls and viewport sizes only. They do not establish every device or frontend version.

### Remaining release checkpoint

The final release's HACS tracking, coordinated restart and runtime read-back, and encrypted backup are still pending in the deployment workflow. No backup restore drill or broad device acceptance is claimed.

Earlier 0.1.0 scene/upload/save checks and 0.2.0 presentation checks remain historical evidence. They do not replace acceptance of the 0.3.0 changes.
