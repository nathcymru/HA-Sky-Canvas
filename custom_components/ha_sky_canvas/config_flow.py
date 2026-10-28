"""Set up one dashboard scenery service using an existing weather entity."""

from typing import Any

import probatio
from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import DOMAIN


class SkyCanvasConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors = {}
        if user_input is not None:
            entity_id = user_input.get("weather_entity", "")
            if (
                not isinstance(entity_id, str)
                or not entity_id.startswith("weather.")
                or self.hass.states.get(entity_id) is None
            ):
                errors["weather_entity"] = "weather_missing"
            else:
                return self.async_create_entry(
                    title="Sky Canvas", data={"weather_entity": entity_id}
                )
        return self.async_show_form(
            step_id="user",
            data_schema=probatio.Schema(
                {
                    probatio.Required("weather_entity"): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="weather")
                    )
                }
            ),
            errors=errors,
        )
