"""Validate persisted configuration independently of the Home Assistant runtime."""

import re
from copy import deepcopy
from datetime import date
from typing import Any

from .const import BUILTIN_NAMES, BUNDLED_IDS, SLOTS

ASSET_PATTERN = re.compile(r"uploaded_[a-f0-9]{32}")
CUSTOM_PATTERN = re.compile(r"custom_[a-z0-9_]{1,48}")
ROUTE_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,100}")
ENTITY_PATTERN = re.compile(r"[a-z_][a-z0-9_]*\.[a-z0-9_]+")
SETTING_KEYS = {
    "weatherEntity",
    "frostEntity",
    "applyToAll",
    "dashboards",
    "priority",
    "quality",
    "lightning",
}


class InvalidConfig(ValueError):
    """The proposed configuration is invalid."""


class RevisionConflict(ValueError):
    """Another client saved a newer revision."""


def default_config(weather_entity: str) -> dict[str, Any]:
    """Create populated starter themes and empty optional themes."""
    themes = []
    for theme_id, name in BUILTIN_NAMES.items():
        themes.append(
            {
                "id": theme_id,
                "name": name,
                "enabled": theme_id in ("default", "christmas"),
                "schedule": {"start": "12-01", "end": "01-05", "annual": True}
                if theme_id == "christmas"
                else None,
                "images": {
                    slot: f"{theme_id}_{slot}" if theme_id in ("default", "christmas") else None
                    for slot in SLOTS
                },
            }
        )
    return {
        "revision": 0,
        "weatherEntity": weather_entity,
        "frostEntity": None,
        "applyToAll": False,
        "dashboards": ["dashboard-overview"],
        "priority": list(BUILTIN_NAMES)[1:],
        "quality": "medium",
        "lightning": False,
        "themes": themes,
    }


def _boolean(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise InvalidConfig(f"{name} must be true or false")
    return value


def validate_theme(value: Any) -> dict[str, Any]:
    """Validate fixed slots, dates and immutable built-in identities."""
    if not isinstance(value, dict) or set(value) != {"id", "name", "enabled", "schedule", "images"}:
        raise InvalidConfig("A theme needs id, name, enabled, schedule and eight images")
    theme = deepcopy(value)
    theme_id = theme["id"]
    if not isinstance(theme_id, str) or not (
        theme_id in BUILTIN_NAMES or CUSTOM_PATTERN.fullmatch(theme_id)
    ):
        raise InvalidConfig("Invalid theme identifier")
    name = theme["name"]
    if (
        not isinstance(name, str)
        or not 1 <= len(name.strip()) <= 60
        or any(ord(c) < 32 for c in name)
    ):
        raise InvalidConfig("Theme name must contain 1 to 60 printable characters")
    theme["name"] = BUILTIN_NAMES.get(theme_id, name.strip())
    _boolean(theme["enabled"], "Theme enabled")
    images = theme["images"]
    if not isinstance(images, dict) or set(images) != set(SLOTS):
        raise InvalidConfig("Each theme has exactly eight fixed image slots")
    for asset in images.values():
        if asset is not None and (
            not isinstance(asset, str)
            or not (asset in BUNDLED_IDS or ASSET_PATTERN.fullmatch(asset))
        ):
            raise InvalidConfig("Invalid image identifier")
    schedule = theme["schedule"]
    if theme_id == "default":
        if not theme["enabled"] or schedule is not None:
            raise InvalidConfig("Default is always enabled without a schedule")
    elif schedule is None:
        if theme["enabled"]:
            raise InvalidConfig("Choose a date range before enabling this theme")
    else:
        if not isinstance(schedule, dict) or set(schedule) != {"start", "end", "annual"}:
            raise InvalidConfig("Invalid theme schedule")
        annual = _boolean(schedule["annual"], "Annual schedule")
        parsed = []
        for key in ("start", "end"):
            item = schedule[key]
            pattern = r"\d{2}-\d{2}" if annual else r"\d{4}-\d{2}-\d{2}"
            if not isinstance(item, str) or not re.fullmatch(pattern, item):
                raise InvalidConfig("Choose valid schedule dates")
            try:
                parsed.append(date.fromisoformat(f"2000-{item}" if annual else item))
            except ValueError as err:
                raise InvalidConfig("Choose valid schedule dates") from err
        if not annual and parsed[1] < parsed[0]:
            raise InvalidConfig("The end date must be on or after the start date")
    return theme


def validate_settings(settings: Any, theme_ids: set[str]) -> dict[str, Any]:
    """Validate global preferences without making network requests."""
    if not isinstance(settings, dict) or set(settings) != SETTING_KEYS:
        raise InvalidConfig("Unexpected or missing settings")
    result = deepcopy(settings)
    entity = result["weatherEntity"]
    if (
        not isinstance(entity, str)
        or not ENTITY_PATTERN.fullmatch(entity)
        or not entity.startswith("weather.")
    ):
        raise InvalidConfig("Select a weather entity")
    frost = result["frostEntity"]
    if frost is not None and (
        not isinstance(frost, str)
        or not ENTITY_PATTERN.fullmatch(frost)
        or frost.split(".")[0] not in {"binary_sensor", "input_boolean"}
    ):
        raise InvalidConfig("Frost input must be a boolean or binary sensor")
    _boolean(result["applyToAll"], "Apply to all")
    _boolean(result["lightning"], "Lightning")
    routes = result["dashboards"]
    if (
        not isinstance(routes, list)
        or len(routes) > 100
        or any(not isinstance(route, str) or not ROUTE_PATTERN.fullmatch(route) for route in routes)
    ):
        raise InvalidConfig("Invalid dashboard routes")
    result["dashboards"] = list(dict.fromkeys(routes))
    priority = result["priority"]
    if (
        not isinstance(priority, list)
        or any(not isinstance(item, str) for item in priority)
        or len(priority) != len(set(priority))
        or set(priority) != theme_ids - {"default"}
    ):
        raise InvalidConfig("Priority must include every non-Default theme exactly once")
    if not isinstance(result["quality"], str) or result["quality"] not in {"low", "medium", "high"}:
        raise InvalidConfig("Invalid animation quality")
    return result


def validate_config(config: Any) -> dict[str, Any]:
    """Reject corrupt or incompatible persisted data without silently overwriting it."""
    if not isinstance(config, dict) or set(config) != SETTING_KEYS | {"revision", "themes"}:
        raise InvalidConfig("Invalid stored configuration")
    if type(config["revision"]) is not int or config["revision"] < 0:
        raise InvalidConfig("Invalid configuration revision")
    if not isinstance(config["themes"], list) or not 6 <= len(config["themes"]) <= 32:
        raise InvalidConfig("Keep between six and 32 themes")
    themes = [validate_theme(theme) for theme in config["themes"]]
    ids = {theme["id"] for theme in themes}
    if len(ids) != len(themes) or not set(BUILTIN_NAMES) <= ids:
        raise InvalidConfig("Built-in themes are required and identifiers must be unique")
    settings = validate_settings({key: config[key] for key in SETTING_KEYS}, ids)
    return {**settings, "themes": themes, "revision": config["revision"]}


def apply_change(
    config: dict[str, Any], revision: int, operation: str, value: Any
) -> dict[str, Any]:
    """Produce an isolated validated revision; the caller persists it atomically."""
    if type(revision) is not int or revision != config["revision"]:
        raise RevisionConflict("Settings changed in another window. Reload before saving.")
    next_config = deepcopy(config)
    if operation == "save_theme":
        theme = validate_theme(value)
        existing = next(
            (i for i, old in enumerate(next_config["themes"]) if old["id"] == theme["id"]), None
        )
        if existing is None:
            next_config["themes"].append(theme)
            next_config["priority"].append(theme["id"])
        else:
            next_config["themes"][existing] = theme
    elif operation == "delete_theme":
        if (
            not isinstance(value, str)
            or value in BUILTIN_NAMES
            or value not in next_config["priority"]
        ):
            raise InvalidConfig("Only existing custom themes can be deleted")
        next_config["themes"] = [theme for theme in next_config["themes"] if theme["id"] != value]
        next_config["priority"].remove(value)
    elif operation == "save_settings":
        next_config.update(
            validate_settings(value, {theme["id"] for theme in next_config["themes"]})
        )
    else:
        raise InvalidConfig("Unknown operation")
    next_config["revision"] += 1
    return validate_config(next_config)
