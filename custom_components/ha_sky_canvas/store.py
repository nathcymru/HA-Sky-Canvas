"""Atomic versioned settings and race-safe image operations."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .assets import Assets
from .const import DOMAIN, SIGNAL_CONFIG, STORAGE_VERSION
from .model import InvalidConfig, apply_change, default_config, validate_config


class SkyStore:
    """Serialize updates, persist first, then notify connected dashboards."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, DOMAIN, private=True, atomic_writes=True
        )
        self.assets = Assets(
            Path(hass.config.path(DOMAIN, "images")), Path(__file__).parent / "images"
        )
        self.lock = asyncio.Lock()
        self.config: dict[str, Any] = {}
        self.active = False

    async def load(self, weather_entity: str) -> None:
        existed = await self.hass.async_add_executor_job(Path(self.store.path).is_file)
        loaded = await self.store.async_load()
        if loaded is None and existed:
            raise InvalidConfig(
                "Stored Sky Canvas settings could not be loaded. Restore them from backup."
            )
        self.config = validate_config(
            loaded if loaded is not None else default_config(weather_entity)
        )
        self.active = True
        await self.cleanup()

    def snapshot(self) -> dict[str, Any]:
        return deepcopy(self.config)

    async def change(self, revision: int, operation: str, value: Any) -> dict[str, Any]:
        async with self.lock:
            if not self.active:
                raise InvalidConfig("Sky Canvas was unloaded; reload settings before saving")
            updated = apply_change(self.config, revision, operation, value)
            await self.hass.async_add_executor_job(self.assets.validate_references, updated)
            await self.store.async_save(updated)
            # HA Store logs some write errors instead of raising. Verify the committed
            # file before reporting success or exposing a new revision to clients.
            await self.hass.async_add_executor_job(self._verify_saved, updated)
            self.config = updated
            async_dispatcher_send(self.hass, SIGNAL_CONFIG, self.snapshot())
        return self.snapshot()

    def _verify_saved(self, expected: dict[str, Any]) -> None:
        try:
            saved = json.loads(Path(self.store.path).read_text())
        except (OSError, ValueError) as err:
            raise OSError("Sky Canvas could not verify the saved settings") from err
        if saved.get("data") != expected:
            raise OSError("Sky Canvas settings were not saved; check available storage")

    async def upload(self, data: bytes) -> str:
        async with self.lock:
            if not self.active:
                raise InvalidConfig("Sky Canvas was unloaded; upload cancelled")
            return await self.hass.async_add_executor_job(self.assets.save_upload, data)

    async def image(self, asset_id: str, thumbnail: bool) -> Path:
        async with self.lock:
            if not self.active:
                raise ValueError("Sky Canvas is not active")
            return await self.hass.async_add_executor_job(self.assets.resolve, asset_id, thumbnail)

    async def close(self) -> None:
        """Drain an in-flight save before publishing the final disabled scene."""
        async with self.lock:
            self.active = False
            disabled = self.snapshot()
            disabled.update({"applyToAll": False, "dashboards": []})
            async_dispatcher_send(self.hass, SIGNAL_CONFIG, disabled)

    async def cleanup(self, *_: Any) -> None:
        async with self.lock:
            referenced = {
                asset
                for theme in self.config["themes"]
                for asset in theme["images"].values()
                if asset
            }
            await self.hass.async_add_executor_job(self.assets.cleanup, referenced)
