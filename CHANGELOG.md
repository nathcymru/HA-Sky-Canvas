# Changes

## 0.3.0

- Delay component imports until Home Assistant initializes its final custom-element registry, fixing missing weather-card configuration errors on fresh page loads.
- Add nine grid presets, a visual card editor, Met Office forecast styling and a saved solid/glass preference with per-card overrides.
- Keep compact condition labels accessible, normalize current-only layouts to current data and label total precipitation probability as “Chance”.
- Isolate weather-card typography from Home Assistant's inherited line height and use matching blue scrollbars for forecast panels.
- Supply a matching view theme and dashboard example; retain exact official symbols and provider data semantics.
- Treat NRW's fresh successful empty home-area selection as no matching active warnings. Reserve unavailable banners for stale, failed or unresolved data; requires NRW Flood Direct 0.1.1.

Local validation: **182 frontend tests**, **76 Python tests**, TypeScript, Ruff and the frontend build passed. The full frontend suite and TypeScript checks passed again after the final typography adjustment. Live checks covered fresh direct dashboard entry, narrow phone cards, current/hourly/daily forecasts, map playback, the nine-preset editor and saved appearance settings. Final release tracking, restart verification and backup are tracked separately in [VALIDATION.md](VALIDATION.md).
