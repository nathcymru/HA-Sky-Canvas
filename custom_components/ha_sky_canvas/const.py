"""HA Sky Canvas constants."""

DOMAIN = "ha_sky_canvas"
VERSION = "0.1.0"
PANEL_PATH = "ha-sky-canvas"
MODULE_URL = f"/ha_sky_canvas/sky-canvas.js?v={VERSION}"
STORAGE_VERSION = 1
SIGNAL_CONFIG = f"{DOMAIN}_config_updated"
BUILTIN_NAMES = {
    "default": "Default",
    "christmas": "Christmas",
    "halloween": "Halloween",
    "easter": "Easter",
    "rugby": "Rugby",
    "soccer": "Soccer",
}
SLOTS = tuple(
    f"{condition}_{period}"
    for condition in ("clear", "rain", "frost", "snow")
    for period in ("day", "night")
)
BUNDLED_IDS = frozenset(f"{theme}_{slot}" for theme in ("default", "christmas") for slot in SLOTS)
