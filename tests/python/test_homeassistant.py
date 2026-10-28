"""Exercise HA's real authorization decorators and versioned storage implementation."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

pytest.importorskip("homeassistant")

from aiohttp.test_utils import make_mocked_request
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import Unauthorized
from homeassistant.util.file import WriteError

import custom_components.ha_sky_canvas as integration
from custom_components.ha_sky_canvas import api
from custom_components.ha_sky_canvas.model import InvalidConfig, RevisionConflict
from custom_components.ha_sky_canvas.store import SkyStore


@pytest.mark.asyncio
async def test_non_admin_cannot_upload_even_if_panel_visibility_is_bypassed():
    request = make_mocked_request("POST", "/api/ha_sky_canvas/upload")
    request["hass_user"] = SimpleNamespace(is_admin=False)
    with pytest.raises(Unauthorized):
        await api.UploadView().post(request)
    assert api.ImageView.requires_auth is True


@pytest.mark.parametrize(
    "handler,payload",
    [
        (api.ws_save_theme, {"revision": 0, "theme": {}}),
        (api.ws_save_settings, {"revision": 0, "settings": {}}),
        (api.ws_delete_theme, {"revision": 0, "theme_id": "custom_test"}),
    ],
)
def test_non_admin_cannot_mutate_via_websocket(handler, payload):
    connection = SimpleNamespace(user=SimpleNamespace(is_admin=False))
    with pytest.raises(Unauthorized):
        handler(Mock(), connection, {"id": 1, **payload})


@pytest.mark.asyncio
async def test_real_store_survives_reload_and_rejects_two_simultaneous_writers(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    try:
        store = SkyStore(hass)
        await store.load("weather.met_office")
        theme = store.snapshot()["themes"][1]
        theme["enabled"] = False
        results = await asyncio.gather(
            store.change(0, "save_theme", theme),
            store.change(0, "save_theme", theme),
            return_exceptions=True,
        )
        assert sum(isinstance(result, RevisionConflict) for result in results) == 1
        restored = SkyStore(hass)
        await restored.load("weather.different_provider")
        assert restored.config["weatherEntity"] == "weather.met_office"
        assert restored.config["revision"] == 1
        assert restored.config["themes"][1]["enabled"] is False
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_legacy_appearance_default_does_not_write_until_explicit_save(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    try:
        store = SkyStore(hass)
        await store.load("weather.met_office")
        legacy = store.snapshot()
        del legacy["weatherCardSurface"]
        legacy["revision"] = 23
        legacy["themes"][0]["images"]["clear_day"] = "christmas_clear_day"
        await store.store.async_save(legacy)
        path = Path(store.store.path)
        original_bytes = path.read_bytes()

        migrated = SkyStore(hass)
        await migrated.load("weather.different_provider")
        assert migrated.snapshot()["weatherCardSurface"] == "solid"
        assert migrated.snapshot()["revision"] == 23
        assert path.read_bytes() == original_bytes
        settings = {
            key: value
            for key, value in migrated.snapshot().items()
            if key not in ("revision", "themes")
        }
        settings["weatherCardSurface"] = "glass"
        assert path.read_bytes() == original_bytes
        await migrated.change(23, "save_settings", settings)
        saved = json.loads(path.read_text())["data"]
        assert saved["weatherCardSurface"] == "glass" and saved["revision"] == 24
        assert saved["themes"] == legacy["themes"]
        restored = SkyStore(hass)
        await restored.load("weather.different_provider")
        assert restored.snapshot() == saved
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_failed_disk_save_never_changes_active_settings(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    try:
        store = SkyStore(hass)
        await store.load("weather.met_office")
        original = store.snapshot()
        theme = store.snapshot()["themes"][1]
        theme["enabled"] = False
        store.store.async_save = AsyncMock(side_effect=OSError("disk full"))
        with pytest.raises(OSError):
            await store.change(0, "save_theme", theme)
        assert store.snapshot() == original
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_unload_waits_for_save_and_cannot_be_undone_by_queued_updates(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    try:
        store = SkyStore(hass)
        await store.load("weather.met_office")
        started = asyncio.Event()
        finish = asyncio.Event()
        original_save = store.store.async_save

        async def delayed_save(value):
            started.set()
            await finish.wait()
            await original_save(value)

        store.store.async_save = delayed_save
        theme = store.snapshot()["themes"][1]
        theme["enabled"] = False
        saving = asyncio.create_task(store.change(0, "save_theme", theme))
        await started.wait()
        closing = asyncio.create_task(store.close())
        await asyncio.sleep(0)
        assert not closing.done()
        finish.set()
        await saving
        await closing
        assert store.active is False
        with pytest.raises(InvalidConfig):
            await store.change(1, "save_theme", theme)
        assert store.config["revision"] == 1
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_homeassistant_swallowed_write_error_does_not_report_saved(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    try:
        store = SkyStore(hass)
        await store.load("weather.met_office")
        original = store.snapshot()
        await store.store.async_save(original)
        store.store._async_write_data = AsyncMock(side_effect=WriteError("disk full"))
        theme = store.snapshot()["themes"][1]
        theme["enabled"] = False
        with pytest.raises(OSError):
            await store.change(0, "save_theme", theme)
        assert store.snapshot() == original
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_failed_panel_setup_does_not_leave_mutation_api_active(tmp_path, monkeypatch):
    hass = HomeAssistant(str(tmp_path))
    try:
        hass.data["ha_sky_canvas"] = {}
        monkeypatch.setattr(
            integration.panel_custom,
            "async_register_panel",
            AsyncMock(side_effect=RuntimeError("failed")),
        )
        entry = SimpleNamespace(data={"weather_entity": "weather.met_office"})
        with pytest.raises(RuntimeError):
            await integration.async_setup_entry(hass, entry)
        assert hass.data["ha_sky_canvas"]["store"].active is False
        with pytest.raises(ValueError):
            api._store(hass)
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_unloading_disables_banners_without_changing_saved_preferences(tmp_path, monkeypatch):
    hass = HomeAssistant(str(tmp_path))
    try:
        store = SkyStore(hass)
        await store.load("weather.metoffice_direct")
        settings = {
            key: value
            for key, value in store.snapshot().items()
            if key not in ("revision", "themes")
        }
        settings["alerts"] = {
            "enabled": True,
            "weatherEntity": "sensor.metoffice_direct_warning_level",
            "floodEntity": None,
        }
        await store.change(0, "save_settings", settings)
        sent = Mock()
        monkeypatch.setattr("custom_components.ha_sky_canvas.store.async_dispatcher_send", sent)
        await store.close()
        disabled = sent.call_args.args[2]
        assert disabled["alerts"]["enabled"] is False
        assert disabled["dashboards"] == [] and disabled["applyToAll"] is False
        restored = SkyStore(hass)
        await restored.load("weather.metoffice_direct")
        assert restored.snapshot()["alerts"] == settings["alerts"]
    finally:
        await hass.async_stop()
