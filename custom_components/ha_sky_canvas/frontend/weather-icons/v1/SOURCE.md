# Met Office forecast symbols

These 30 unchanged SVG assets are the forecast symbols displayed in the [Met Office forecast guide](https://weather.metoffice.gov.uk/guides/what-does-this-forecast-mean), retrieved 28 October 2026. Code 4 is unused. The adjacent manifest records each original URL, byte size and SHA-256 digest.

Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

The [Met Office website terms](https://www.metoffice.gov.uk/policies/tandc) grant reuse of public website content under OGL v3 except listed exclusions. The displayed forecast symbols have no separate ownership or licence statement in the inspected guide or SVG files. These assets are not covered by the application's MIT licence. Original gradients, view boxes and embedded PNG shadows are preserved; no palette or path edits have been made.

The files are served locally; no runtime image hotlinking to the Met Office is used. This application is independent and is not endorsed by the Met Office. Met Office logos are not included. The separate weather-data attribution remains “Powered by Met Office data”.

## Forecast colours and presentation

`palette-source.json` records the temperature and UV background colours published in the inline styles of the [official forecast page](https://weather.metoffice.gov.uk/forecast/gcpvj0v07), its retrieved HTML digest, and the selectors used. Temperature bands use the nearest whole Celsius value even when Home Assistant displays Fahrenheit or Kelvin. Values outside the published -19°C to 40°C range use the endpoint colour; their numeric value is unchanged. UV categories follow the forecast guide. Missing values receive neither a colour nor a category.

The application retains those published backgrounds and selects black or white text by measured sRGB contrast (at least 4.5:1 across the included palette). This text treatment is an accessibility adaptation, not an exact reproduction of Met Office typography. Numeric values and category labels accompany the colours. The guide's strong-gust threshold is 25 knots or 29 mph; other supported units use the equivalent of 25 knots. No Met Office fonts, site scripts or tracking code are included.

`data-periods-source.json` records the separate Global Spot API parameter timing, verified from the public DataHub glossary. Hourly precipitation accumulates over the preceding hour, probability is centred on the validity time, and the selected gust field covers the preceding ten minutes. These API periods differ from the public forecast website's presentation convention; the card preserves the API meanings without shifting or relabelling values as a different parameter.
