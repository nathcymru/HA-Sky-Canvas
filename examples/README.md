# Sun-synchronised Met Office frost example

These files target `weather.metoffice_direct`, supplied by the separate direct Met Office integration. They require standard current temperature, relative humidity and wind attributes; hourly `weather.get_forecasts` rows with temperature, humidity, wind speed and condition; and `current_time`, `model_run`, `fetched_at` ISO timestamps on the weather entity. Adapt every entity reference if Home Assistant assigned a different ID.

1. Copy `custom_templates/sky_canvas_frost.jinja` into your Home Assistant `custom_templates` directory.
2. Copy `packages/sky_canvas_frost.yaml` into your packages directory. Enable packages if necessary; do not overwrite your existing `homeassistant:` section.
3. Run Home Assistant's configuration check and restart, or reload the relevant helpers, custom templates, template entities and automations.
4. Select `binary_sensor.sky_canvas_current_frost_risk` as Sky Canvas's Frost entity. Keep `input_boolean.frost_warning` for warnings, not image selection.

The single automation evaluates the upcoming sunset-to-sunrise window 90 minutes before sunset, reassesses 45 minutes before sunrise, and recovers after restarts. Cached checks every 30 minutes during the night catch changing forecasts without additional provider requests. Changes in current conditions update the separate current-risk display.

The exact baseline is temperature ≤4°C, wind strictly <8 km/h, `clear-night`, and temperature minus calculated dew point ≤3°C. Magnus constants are 17.27 and 237.7. Units are converted first: five mph is slightly above eight km/h and fails the strict wind threshold. Missing/invalid inputs stay unknown. No cloud percentage is invented.

Hourly periods cover the actual upcoming night, including long winter nights. A complete negative forecast is `not_indicated`; missing periods, including an uncovered part of the first hour, are `unknown`. A valid risk period can raise a warning despite another missing hour. Source freshness limits are 90 minutes for the current period/fetch and six hours for the model run. These are explicit conservative defaults, not provider guarantees.

Current risk latches the house display through dawn. It clears during daytime when **both** air temperature >4°C and dew point >2°C, or expires two hours after sunrise. Expiry is a display rule, not evidence that shaded ground has thawed. An unavailable source or sun state makes the display sensor unavailable. A failed prediction retains any previous warning and posts a data-unavailable notification.

Warnings use Home Assistant persistent notifications. No phone, email or external recipient is selected. Official severe-weather warnings remain independent of this frost estimate.
