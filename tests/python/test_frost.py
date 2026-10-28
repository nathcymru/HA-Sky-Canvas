"""Render the shipped macros in Home Assistant's real template environment."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from shutil import copyfile

import pytest
import pytest_asyncio

pytest.importorskip("homeassistant")

import yaml
from homeassistant.components.automation.config import PLATFORM_SCHEMA
from homeassistant.core import Context, HomeAssistant, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.script import Script
from homeassistant.helpers.template import (
    Template,
    TemplateEnvironment,
    async_load_custom_templates,
)
from homeassistant.util import dt as dt_util
from jinja2 import FileSystemLoader

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def macros():
    env = TemplateEnvironment(None)
    env.loader = FileSystemLoader(ROOT / "examples/custom_templates")
    module = env.get_template("sky_canvas_frost.jinja").module
    return {
        name: env.filters["as_function"](getattr(module, name))
        for name in ("metrics", "fresh", "night_assessment")
    }


def test_exact_baseline_boundaries_and_magnus_dew_point(macros):
    evaluate = macros["metrics"]
    result = evaluate(4, 90, 7.999, "°C", "km/h", "clear-night")
    assert result["risk"] is True
    assert result["dew_point"] == pytest.approx(2.50987, abs=1e-5)
    assert evaluate(4.001, 90, 7, "°C", "km/h", "clear-night")["risk"] is False
    assert evaluate(4, 90, 8, "°C", "km/h", "clear-night")["risk"] is False
    assert evaluate(4, 50, 7, "°C", "km/h", "clear-night")["risk"] is False
    assert evaluate(-2, 90, 7, "°C", "km/h", "partlycloudy")["risk"] is False
    assert evaluate(-2, 90, 7, "°C", "km/h", "sunny")["risk"] is False


def test_wind_threshold_converts_units_exactly(macros):
    evaluate = macros["metrics"]
    assert evaluate(39.2, 90, 4.9, "°F", "mph", "clear-night")["risk"] is True
    # Five mph is 8.04672 km/h, above the user's strict eight km/h baseline.
    assert evaluate(39.2, 90, 5, "°F", "mph", "clear-night")["risk"] is False
    assert evaluate(277.15, 90, 2, "K", "m/s", "clear-night")["risk"] is True
    assert evaluate(4, 90, 4, "°C", "kn", "clear-night")["risk"] is True


@pytest.mark.parametrize(
    "temperature,humidity,wind,tu,wu,condition",
    [
        (None, 90, 1, "°C", "km/h", "clear-night"),
        (0, None, 1, "°C", "km/h", "clear-night"),
        (0, 0, 1, "°C", "km/h", "clear-night"),
        (0, 101, 1, "°C", "km/h", "clear-night"),
        (0, 90, -1, "°C", "km/h", "clear-night"),
        ("nan", 90, 1, "°C", "km/h", "clear-night"),
        (0, "inf", 1, "°C", "km/h", "clear-night"),
        (0, 90, "unavailable", "°C", "km/h", "clear-night"),
        (0, 90, 1, "C", "km/h", "clear-night"),
        (0, 90, 1, "°C", "bogus", "clear-night"),
        (0, 90, 1, "°C", "km/h", "unknown"),
    ],
)
def test_invalid_inputs_remain_unknown(macros, temperature, humidity, wind, tu, wu, condition):
    assert macros["metrics"](temperature, humidity, wind, tu, wu, condition)["risk"] is None


def test_freshness_checks_each_source_clock(macros):
    stamp = datetime(2026, 12, 1, 20, tzinfo=UTC).timestamp()

    def fresh(current, model, fetched, now):
        values = [
            datetime.fromtimestamp(v, UTC).isoformat() if v is not None else None
            for v in (current, model, fetched)
        ]
        return macros["fresh"](*values, now)

    assert fresh(stamp - 1800, stamp - 7200, stamp - 60, stamp)
    assert not fresh(stamp - 5401, stamp - 7200, stamp - 60, stamp)
    assert not fresh(stamp - 1800, stamp - 21601, stamp - 60, stamp)
    assert not fresh(stamp - 1800, stamp - 7200, stamp - 5401, stamp)
    assert not fresh(stamp + 3600, stamp - 7200, stamp - 60, stamp)
    assert not fresh(None, stamp - 7200, stamp - 60, stamp)


def forecast_row(when, temperature=8, humidity=90):
    return dict(
        datetime=when.isoformat(),
        temperature=temperature,
        humidity=humidity,
        wind_speed=2,
        condition="clear-night",
    )


def test_long_winter_night_includes_risk_after_fourteen_hours(macros):
    start = datetime(2026, 12, 1, 15, 45, tzinfo=UTC)
    end = start + timedelta(hours=16, minutes=30)
    rows = [forecast_row(start.replace(minute=0) + timedelta(hours=h)) for h in range(18)]
    rows[16]["temperature"] = 3
    result = macros["night_assessment"](rows, start.timestamp(), end.timestamp(), "°C", "km/h")
    assert result["status"] == "risk"
    assert result["first_risk"] > start.timestamp() + 14 * 3600


def test_complete_negative_forecast_differs_from_missing_or_gapped_data(macros):
    start = datetime(2026, 12, 1, 16, 30, tzinfo=UTC)
    end = start + timedelta(hours=12)
    rows = [forecast_row(start.replace(minute=0) + timedelta(hours=h)) for h in range(13)]

    def assess(data):
        return macros["night_assessment"](data, start.timestamp(), end.timestamp(), "°C", "km/h")

    assert assess(rows)["status"] == "not_indicated"
    assert assess([])["status"] == "unknown"
    assert assess(rows[2:])["status"] == "unknown"
    assert assess(rows[1:])["status"] == "unknown"  # The first partial hour is missing.
    assert assess(rows[:4] + rows[6:])["status"] == "unknown"
    shifted = [dict(row) for row in rows]
    shifted[4]["datetime"] = (
        datetime.fromisoformat(shifted[4]["datetime"]) + timedelta(minutes=30)
    ).isoformat()
    assert assess(shifted)["status"] == "unknown"  # Do not bridge a half-hour gap.
    rows[2]["humidity"] = None
    assert assess(rows)["status"] == "unknown"
    rows[-1]["temperature"] = 3
    assert assess(rows)["status"] == "risk"  # Known risk is useful despite another missing hour.


def test_forecast_filters_previous_night_and_uses_same_hour_humidity(macros):
    start = datetime(2026, 12, 1, 16, tzinfo=UTC)
    rows = [forecast_row(start + timedelta(hours=h), 3, 50) for h in range(-12, 13)]
    rows[0]["humidity"] = 95  # Yesterday's moist air must not supply tonight's dew point.
    result = macros["night_assessment"](
        rows, start.timestamp(), (start + timedelta(hours=12)).timestamp(), "°C", "km/h"
    )
    assert result["status"] == "not_indicated"


@pytest.mark.asyncio
async def test_package_schema_and_all_embedded_templates_compile(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    package = yaml.safe_load((ROOT / "examples/packages/sky_canvas_frost.yaml").read_text())
    try:
        PLATFORM_SCHEMA(package["automation"][0])
    finally:
        await hass.async_stop()
    env = TemplateEnvironment(None)

    def visit(value):
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str) and ("{{" in value or "{%" in value):
            env.parse(value)

    visit(package)


class FrostScriptHarness:
    """Execute the shipped actions in HA; helper/provider service I/O is controlled."""

    def __init__(self, hass, package, now):
        self.hass = hass
        self.package = package
        self.now = now
        self.forecasts = []
        self.fail_forecast = False
        self.notifications = {}
        self.forecast_calls = 0
        self.script = Script(
            hass,
            cv.SCRIPT_SCHEMA(package["automation"][0]["actions"]),
            "frost_example_test",
            "automation",
            script_mode="queued",
        )

    async def service(self, call):
        if call.domain == "weather":
            self.forecast_calls += 1
            if self.fail_forecast:
                raise HomeAssistantError("Forecast service unavailable")
            return {"weather.metoffice_direct": {"forecast": self.forecasts}}
        if call.domain == "persistent_notification":
            if call.service == "create":
                self.notifications[call.data["notification_id"]] = dict(call.data)
            else:
                self.notifications.pop(call.data["notification_id"], None)
            return
        targets = call.data["entity_id"]
        if isinstance(targets, str):
            targets = [targets]
        for entity_id in targets:
            if call.domain == "input_boolean":
                self.hass.states.async_set(entity_id, "on" if call.service == "turn_on" else "off")
            elif call.domain == "input_select":
                self.hass.states.async_set(entity_id, call.data["option"])
            elif call.domain == "input_datetime":
                stamp = float(call.data["timestamp"])
                self.hass.states.async_set(
                    entity_id,
                    datetime.fromtimestamp(stamp, UTC).isoformat(),
                    {"timestamp": stamp},
                )

    def source(self, temperature=8, humidity=90, condition="clear-night", stale=False):
        self.hass.states.async_set(
            "weather.metoffice_direct",
            condition,
            {
                "temperature": temperature,
                "humidity": humidity,
                "wind_speed": 2,
                "temperature_unit": "°C",
                "wind_speed_unit": "km/h",
                "current_time": (self.now - timedelta(hours=2 if stale else 0)).isoformat(),
                "model_run": self.now.isoformat(),
                "fetched_at": self.now.isoformat(),
            },
        )
        state = self.package["template"][0]["sensor"][0]["state"]
        self.hass.states.async_set(
            "sensor.sky_canvas_frost_conditions", Template(state, self.hass).async_render()
        )

    def sun(self, state="below_horizon", sunrise=None, sunset=None):
        self.hass.states.async_set(
            "sun.sun",
            state,
            {
                "next_rising": (sunrise or self.now + timedelta(hours=12)).isoformat(),
                "next_setting": (sunset or self.now + timedelta(hours=20)).isoformat(),
            },
        )

    def latch_current(self, expiry):
        for entity in ("frost_warning", "sky_canvas_frost_current"):
            self.hass.states.async_set(f"input_boolean.{entity}", "on")
        self.hass.states.async_set(
            "input_datetime.sky_canvas_frost_display_expires",
            expiry.isoformat(),
            {"timestamp": expiry.timestamp()},
        )

    async def run(self, trigger):
        result = await self.script.async_run({"trigger": {"id": trigger}}, Context())
        assert result is not None

    def state(self, entity):
        return self.hass.states.get(entity).state


@pytest_asyncio.fixture
async def frost_script(tmp_path, monkeypatch):
    hass = HomeAssistant(str(tmp_path))
    package = yaml.safe_load((ROOT / "examples/packages/sky_canvas_frost.yaml").read_text())
    harness = FrostScriptHarness(hass, package, datetime(2026, 12, 1, 20, tzinfo=UTC))
    monkeypatch.setattr(dt_util, "utcnow", lambda: harness.now)
    monkeypatch.setattr(
        dt_util, "now", lambda time_zone=None: harness.now.astimezone(time_zone or UTC)
    )
    templates = tmp_path / "custom_templates"
    templates.mkdir()
    copyfile(
        ROOT / "examples/custom_templates/sky_canvas_frost.jinja",
        templates / "sky_canvas_frost.jinja",
    )
    await async_load_custom_templates(hass)
    for domain, actions in {
        "input_boolean": ["turn_on", "turn_off"],
        "input_datetime": ["set_datetime"],
        "input_select": ["select_option"],
        "persistent_notification": ["create", "dismiss"],
    }.items():
        for action in actions:
            hass.services.async_register(domain, action, harness.service)
    hass.services.async_register(
        "weather", "get_forecasts", harness.service, supports_response=SupportsResponse.ONLY
    )
    hass.states.async_set("input_boolean.frost_warning", "off")
    hass.states.async_set("input_boolean.sky_canvas_frost_current", "off")
    hass.states.async_set("input_select.sky_canvas_overnight_frost", "unknown")
    harness.sun()
    harness.source()
    try:
        yield harness
    finally:
        await hass.async_stop()


@pytest.mark.asyncio
async def test_actual_script_prediction_warns_without_changing_current_house(frost_script):
    h = frost_script
    h.forecasts = [forecast_row(h.now + timedelta(hours=i), temperature=3) for i in range(12)]
    await h.run("refresh")
    assert h.state("input_boolean.frost_warning") == "on"
    assert h.state("input_boolean.sky_canvas_frost_current") == "off"
    assert h.state("input_select.sky_canvas_overnight_frost") == "risk"
    assert "not a measurement" in h.notifications["sky_canvas_frost"]["message"]
    h.source(temperature=3)
    await h.run("current_changed")
    assert h.state("input_boolean.sky_canvas_frost_current") == "on"
    assert (
        h.hass.states.get("input_datetime.sky_canvas_frost_display_expires").attributes["timestamp"]
        == (h.now + timedelta(hours=14)).timestamp()
    )


@pytest.mark.asyncio
async def test_actual_script_evening_prediction_does_not_treat_daytime_as_current_frost(
    frost_script,
):
    h = frost_script
    h.now = h.now.replace(hour=14)
    sunset = h.now + timedelta(minutes=90)
    h.sun(state="above_horizon", sunset=sunset, sunrise=h.now + timedelta(hours=18))
    h.source(temperature=3, condition="sunny")
    h.forecasts = [forecast_row(sunset + timedelta(hours=i), temperature=3) for i in range(18)]
    await h.run("evening_check")
    assert h.state("sensor.sky_canvas_frost_conditions") == "not_indicated"
    assert h.state("input_select.sky_canvas_overnight_frost") == "risk"
    assert h.state("input_boolean.frost_warning") == "on"
    assert h.state("input_boolean.sky_canvas_frost_current") == "off"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "temperature,humidity,clears", [(5, 50, False), (4, 99, False), (5, 90, True)]
)
async def test_actual_script_warm_clear_requires_temperature_and_dew_point(
    frost_script, temperature, humidity, clears
):
    h = frost_script
    h.now = h.now.replace(hour=9)
    h.sun(state="above_horizon")
    h.latch_current(h.now + timedelta(hours=1))
    h.source(temperature=temperature, humidity=humidity, condition="sunny")
    await h.run("current_changed")
    expected = "off" if clears else "on"
    assert h.state("input_boolean.sky_canvas_frost_current") == expected
    assert h.state("input_boolean.frost_warning") == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("trigger", ["display_expiry", "recovery"])
async def test_actual_script_expiry_and_restart_clear_display_without_asserting_thaw(
    frost_script, trigger
):
    h = frost_script
    h.now = h.now.replace(hour=11)
    h.sun(state="above_horizon")
    h.latch_current(h.now - timedelta(minutes=1))
    h.source(temperature=1, humidity=90, condition="cloudy")
    await h.run(trigger)
    assert h.state("input_boolean.sky_canvas_frost_current") == "off"
    assert h.state("input_select.sky_canvas_overnight_frost") == "expired"
    assert h.state("sensor.sky_canvas_frost_conditions") == "not_indicated"


@pytest.mark.asyncio
async def test_actual_script_forecast_service_failure_retains_warning_and_unknown(frost_script):
    h = frost_script
    h.hass.states.async_set("input_boolean.frost_warning", "on")
    h.fail_forecast = True
    await h.run("refresh")
    assert h.forecast_calls == 1
    assert h.state("input_boolean.frost_warning") == "on"
    assert h.state("input_boolean.sky_canvas_frost_current") == "off"
    assert h.state("input_select.sky_canvas_overnight_frost") == "unknown"
    assert "retained" in h.notifications["sky_canvas_frost"]["message"]


@pytest.mark.asyncio
async def test_actual_script_stale_data_cannot_create_a_false_negative_or_clear_warning(
    frost_script,
):
    h = frost_script
    h.hass.states.async_set("input_boolean.frost_warning", "on")
    h.source(temperature=9, stale=True)
    h.forecasts = [forecast_row(h.now + timedelta(hours=i), temperature=9) for i in range(12)]
    await h.run("refresh")
    assert h.state("sensor.sky_canvas_frost_conditions") == "unknown"
    assert h.state("input_select.sky_canvas_overnight_frost") == "unknown"
    assert h.state("input_boolean.frost_warning") == "on"
    availability = h.package["template"][0]["binary_sensor"][0]["availability"]
    assert Template(availability, h.hass).async_render() is False


@pytest.mark.asyncio
async def test_current_frost_is_unknown_without_valid_sun_state(frost_script):
    h = frost_script
    h.hass.states.async_set("sun.sun", "unavailable")
    h.source(temperature=3)
    assert h.state("sensor.sky_canvas_frost_conditions") == "unknown"
    availability = h.package["template"][0]["binary_sensor"][0]["availability"]
    assert Template(availability, h.hass).async_render() is False


@pytest.mark.asyncio
async def test_actual_script_restart_during_dawn_retains_current_latch(frost_script):
    h = frost_script
    h.now = h.now.replace(hour=9)
    h.sun(state="above_horizon")
    h.latch_current(h.now + timedelta(hours=1))
    h.source(temperature=1, humidity=90, condition="cloudy")
    await h.run("recovery")
    assert h.state("input_boolean.sky_canvas_frost_current") == "on"
    assert h.state("input_boolean.frost_warning") == "on"
    assert h.forecast_calls == 0
