"""Persistence boundary tests: lost updates, invalid schedules and fixed slot safety."""

from copy import deepcopy

import pytest

from custom_components.ha_sky_canvas.model import (
    SETTING_KEYS,
    InvalidConfig,
    RevisionConflict,
    apply_change,
    default_config,
    validate_config,
    validate_theme,
)


def test_one_tab_save_cannot_overwrite_another_tab_and_rejects_stale_window():
    original = default_config("weather.met_office")
    christmas = deepcopy(original["themes"][1])
    christmas["enabled"] = False
    saved = apply_change(original, 0, "save_theme", christmas)
    assert original["themes"][1]["enabled"] is True
    assert saved["themes"][0] == original["themes"][0]
    assert saved["revision"] == 1
    with pytest.raises(RevisionConflict):
        apply_change(saved, 0, "save_theme", original["themes"][2])


def test_partial_and_extra_image_slots_are_rejected_without_mutating_input():
    theme = default_config("weather.met_office")["themes"][0]
    original = deepcopy(theme)
    del theme["images"]["snow_night"]
    with pytest.raises(InvalidConfig):
        validate_theme(theme)
    theme = deepcopy(original)
    theme["images"]["unknown_day"] = None
    with pytest.raises(InvalidConfig):
        validate_theme(theme)
    assert len(original["images"]) == 8


def test_default_cannot_be_disabled_or_deleted():
    config = default_config("weather.met_office")
    theme = deepcopy(config["themes"][0])
    theme["enabled"] = False
    with pytest.raises(InvalidConfig):
        apply_change(config, 0, "save_theme", theme)
    with pytest.raises(InvalidConfig):
        apply_change(config, 0, "delete_theme", "default")


def test_annual_christmas_crosses_year_but_reversed_one_off_dates_fail():
    theme = default_config("weather.met_office")["themes"][1]
    assert validate_theme(theme)["schedule"]["end"] == "01-05"
    theme["schedule"] = {"start": "2026-12-01", "end": "2026-01-05", "annual": False}
    with pytest.raises(InvalidConfig):
        validate_theme(theme)
    theme["schedule"] = {"start": "02-30", "end": "03-01", "annual": True}
    with pytest.raises(InvalidConfig):
        validate_theme(theme)


def test_new_theme_preserves_builtin_tabs_and_gets_unique_priority():
    config = default_config("weather.met_office")
    theme = deepcopy(config["themes"][2])
    theme.update(id="custom_birthday", name="Birthday")
    saved = apply_change(config, 0, "save_theme", theme)
    assert len(saved["themes"]) == 7
    assert saved["priority"][-1] == "custom_birthday"
    assert saved["themes"][:6] == config["themes"]


@pytest.mark.parametrize(
    "asset", ["../../secrets.yaml", "https://example.com/image.svg", "uploaded_x", 7]
)
def test_image_references_are_ids_not_paths(asset):
    theme = default_config("weather.met_office")["themes"][0]
    theme["images"]["clear_day"] = asset
    with pytest.raises(InvalidConfig):
        validate_theme(theme)


def test_corrupt_storage_is_not_silently_replaced_with_defaults():
    config = default_config("weather.met_office")
    config["themes"].pop()
    with pytest.raises(InvalidConfig):
        validate_config(config)


def test_invalid_settings_and_routes_fail_before_save():
    config = default_config("weather.met_office")
    settings = {key: config[key] for key in SETTING_KEYS}
    settings["dashboards"] = ["../../config"]
    with pytest.raises(InvalidConfig):
        apply_change(config, 0, "save_settings", settings)
    assert config["revision"] == 0


def test_legacy_storage_adds_disabled_banners_without_changing_user_scenes():
    legacy = default_config("weather.metoffice_direct")
    del legacy["alerts"]
    legacy["revision"] = 23
    legacy["dashboards"] = ["dashboard-kiosk"]
    legacy["themes"][1]["enabled"] = False
    migrated = validate_config(legacy)
    assert migrated["alerts"] == {"enabled": False, "weatherEntity": None, "floodEntity": None}
    assert {key: value for key, value in migrated.items() if key != "alerts"} == legacy
    assert "alerts" not in legacy
    del legacy["quality"]
    with pytest.raises(InvalidConfig):
        validate_config(legacy)


@pytest.mark.parametrize("source", ["https://example.com", "weather.home", "sensor.a/../b", 3])
def test_banner_source_rejects_urls_and_non_sensor_entities(source):
    config = default_config("weather.metoffice_direct")
    config["alerts"]["floodEntity"] = source
    with pytest.raises(InvalidConfig):
        validate_config(config)


def test_old_client_cannot_silently_erase_saved_banner_sources():
    config = default_config("weather.metoffice_direct")
    config["alerts"] = {"enabled": True, "weatherEntity": "sensor.warnings", "floodEntity": None}
    settings = {key: config[key] for key in SETTING_KEYS - {"alerts"}}
    with pytest.raises(InvalidConfig):
        apply_change(config, 0, "save_settings", settings)
    assert config["alerts"]["enabled"]
