# HA-Sky-Canvas

Weather and seasonal house scenes behind your Home Assistant dashboards. A locally rendered sky, a transparent house image and animated weather form three decorative layers beneath the dashboard controls.

Default and Christmas house scenes are included so you can see it working immediately. Replace them with your own house, choose the dashboards where they appear, and schedule additional themes from the **Sky Canvas** settings page.

> Development preview. Home Assistant Core 2026.10.4 is the current test target. Live installation and visual acceptance are recorded separately from automated checks.

![Sky Canvas theme settings with the bundled day and night house images](docs/settings-preview.jpg)

Theme settings shown in the local development preview with demonstration data and the included Default images.

## Features

- Standard Home Assistant weather entity and `sun.sun` for conditions and day/night.
- Eight fixed house slots per theme: Clear, Rain, Frost and Snow, each Day/Night. More weather animations share those slots.
- Default, Christmas, Halloween, Easter, Rugby and Soccer tabs, plus custom themes. Default and Christmas are populated; other themes start blank.
- Christmas annually from **1 December through 5 January**, inclusive in Home Assistant's timezone. Other themes support annual or one-off dates, enable switches and explicit priority for overlapping schedules.
- Selected dashboards, initially Overview, or all Lovelace dashboards. Energy, Map and other non-dashboard panels retain their own presentation.
- Explicit saves, with Save/Discard/Stay when changing tabs with edits. Separate browser sessions cannot silently overwrite a newer revision.
- Reduced motion support, hidden-page animation pause and bounded rendering work for tablets. Lightning flashes are off by default.

Missing seasonal images fall back to the matching Default slot. Empty Default slots show no house. Rain and snow take precedence over the optional frost image. Unknown weather produces a neutral sky rather than pretending conditions are clear.

## Install

Requires HACS and Home Assistant 2026.10.2 or newer. This is an **integration**, not a Lovelace card.

1. In HACS, add `https://github.com/nathcymru/HA-Sky-Canvas` as a custom repository, category **Integration**.
2. Download HA Sky Canvas and restart Home Assistant.
3. Open **Settings → Devices & services → Add integration → HA Sky Canvas** and choose your weather entity.
4. Open **Sky Canvas** in the sidebar. Under Settings, select all dashboards or choose individual dashboards in the Dashboards tab, then save.
5. Open a selected dashboard. Refresh the browser after an update if it retains the previous frontend module.

For manual installation, copy `custom_components/ha_sky_canvas` into your Home Assistant configuration, then follow steps 2–5. No separate frontend resource or external image service is required.

## Images and themes

Use **Replace** on a populated slot or **Upload image** on a blank slot to upload a PNG, JPEG or WebP. A transparent sky in a PNG or WebP lets the animation show through. The house is contained, centred horizontally and anchored at the bottom; a 16:9 transparent composition works well. Dashboard cards can cover portions of the background.

Uploads are limited to 12 MiB, 16 megapixels and 8,192 pixels on either side. Animated uploads are rejected. Images are decoded, stripped of metadata and stored as PNGs; previews are generated locally. Uploads remain staged until that tab's **Save Changes** is pressed. Unused uploads are removed after 24 hours, with a 512 MiB upload-storage limit.

Settings and custom images live outside the integration folder, so integration updates preserve them. Include `.storage/ha_sky_canvas` and `ha_sky_canvas/images` in recovery backups. Image access requires Home Assistant authentication; changes and uploads require an administrator.

The bundled AI-generated house images are included with the owner's permission. Original bytes and source manifest are retained. The source set has small framing/alignment differences and tiny source markers at the extreme upper right; these are preserved rather than silently edited.

## Optional frost display

Choose a binary sensor representing **current frost risk** under Settings. An overnight prediction should be a separate warning. The renderer itself does not request forecasts or calculate frost.

The [Met Office example](examples/README.md) supplies a Home Assistant package and shared template for a sun-synchronised estimate: air temperature ≤4°C, wind <8 km/h, `clear-night`, and temperature/dew-point spread ≤3°C. It calculates dew point from the same period's temperature and humidity. This is a heuristic, not a measurement of ground temperature or a guarantee that frost will or will not occur.

## Met Office forecast map

An optional Lovelace card plays the direct Met Office integration's cached precipitation frames. It shows actual published forecast times, the model run, a time slider and Play/Pause controls. It starts paused, stops when hidden, supports keyboard controls and follows Home Assistant's timezone. Failed or outdated data is labelled explicitly.

Register `/ha_sky_canvas/sky-canvas.js?v=0.1.0-3` as a **JavaScript Module** in **Settings → Dashboards → Resources** before adding the card. Use the same URL as the installed integration's frontend module. This ordinary Lovelace resource ensures a fresh direct dashboard load can discover the card.

```yaml
type: custom:ha-sky-canvas-forecast-map
entity: sensor.metoffice_direct_forecast_map
title: Precipitation forecast
```

This requires the separate [Met Office Direct integration](https://github.com/nathcymru/ha-metoffice-direct) and a configured Map Images precipitation order. It is a forecast, not live radar. The backend discovers valid frames, selects one consistent model run, enforces the shared API allowance and serves authenticated local images. Opening additional dashboards or playing the animation does not make more Met Office requests. No WMS endpoint or browser-visible API key is used.

## Development

Node.js 24 and Python 3.14 are used for the current Home Assistant target.

```sh
npm ci
npm run typecheck
npm test
npm run build
python -m pip install homeassistant==2026.10.4 pytest==9.2.0 pytest-asyncio==1.4.1 ruff==0.17.0 Pillow==12.3.0
python -m pytest
ruff check custom_components tests/python
ruff format --check custom_components tests/python
```

The committed browser bundle is built from `src/`; runtime assets are contained within the integration folder for HACS distribution. Tests cover schedules, timezone boundaries, image fallback, dashboard filtering, draft conflicts, rendering cleanup, access control, upload validation, persistent storage and frost boundary/missing-data cases.

The dashboard adapter depends on Home Assistant frontend structure. It stops mounting if the expected structure is absent, leaving dashboard controls available. Frontend upgrades require live compatibility checks; unit tests do not establish visual acceptance on every device.

## Credits and licence

MIT licensed. The animation engine derives from [Teuchezh Nurbiy's Dynamic Weather Card](https://github.com/teuchezh/dynamic-weather-card/tree/v2026.10.2/src/animations), version `v2026.10.2`. The full original animation snapshot, original licence and pinned provenance are retained in [`vendor/dynamic-weather-card`](vendor/dynamic-weather-card); the production refactor is in [`src/renderer`](src/renderer). Original copyright notices are retained in the distribution.

The frontend also bundles Lit under BSD-3-Clause. Exact package versions and full licence terms are included in [`THIRD-PARTY-NOTICES.txt`](custom_components/ha_sky_canvas/THIRD-PARTY-NOTICES.txt), inside the HACS integration distribution.

Weather data comes from your selected Home Assistant integration. The separate Met Office example uses **Powered by Met Office data** attribution. Sky Canvas includes no API keys, location-specific configuration, remote telemetry or paid service requirement.
