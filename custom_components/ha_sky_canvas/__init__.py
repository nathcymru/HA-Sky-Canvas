"""Configurable layered weather scenery for Home Assistant dashboards."""

from datetime import timedelta
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval

from .api import register_api
from .const import DOMAIN, MODULE_URL, PANEL_PATH, SIGNAL_CONFIG
from .store import SkyStore

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("registered"):
        register_api(hass)
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    "/ha_sky_canvas/sky-canvas.js",
                    str(Path(__file__).parent / "frontend" / "sky-canvas.js"),
                    cache_headers=True,
                )
            ]
        )
        data["registered"] = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = SkyStore(hass)
    await store.load(entry.data["weather_entity"])
    hass.data[DOMAIN]["store"] = store
    registered = False
    try:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_PATH,
            webcomponent_name="ha-sky-canvas-settings",
            sidebar_title="Sky Canvas",
            sidebar_icon="mdi:weather-partly-cloudy",
            module_url=MODULE_URL,
            require_admin=True,
            config_panel_domain=DOMAIN,
        )
        registered = True
        frontend.add_extra_js_url(hass, MODULE_URL)
    except Exception:
        await store.close()
        if registered:
            frontend.async_remove_panel(hass, PANEL_PATH)
        raise
    entry.async_on_unload(async_track_time_interval(hass, store.cleanup, timedelta(hours=1)))
    async_dispatcher_send(hass, SIGNAL_CONFIG, store.snapshot())
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store: SkyStore = hass.data[DOMAIN]["store"]
    await store.close()
    frontend.remove_extra_js_url(hass, MODULE_URL)
    frontend.async_remove_panel(hass, PANEL_PATH)
    return True
