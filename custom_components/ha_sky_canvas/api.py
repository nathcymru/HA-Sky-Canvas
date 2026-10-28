"""Authenticated settings, subscriptions and image endpoints."""

from typing import Any

import probatio
from aiohttp import web
from homeassistant.components import websocket_api
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.components.http.decorators import require_admin
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .assets import MAX_UPLOAD_BYTES
from .const import DOMAIN, SIGNAL_CONFIG
from .model import InvalidConfig, RevisionConflict
from .store import SkyStore


def _store(hass: HomeAssistant) -> SkyStore:
    store: SkyStore | None = hass.data.get(DOMAIN, {}).get("store")
    if store is None or not store.active:
        raise ValueError("HA Sky Canvas is not configured")
    return store


@websocket_api.websocket_command({"type": f"{DOMAIN}/config"})
@callback
def ws_config(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Every authenticated dashboard user can read rendering settings."""
    connection.send_result(msg["id"], _store(hass).snapshot())


@websocket_api.websocket_command({"type": f"{DOMAIN}/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    _store(hass)

    @callback
    def changed(config: dict) -> None:
        connection.send_event(msg["id"], config)

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_CONFIG, changed)
    connection.send_result(msg["id"])


async def _change(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
    operation: str,
    value: Any,
) -> None:
    try:
        result = await _store(hass).change(msg["revision"], operation, value)
    except RevisionConflict as err:
        connection.send_error(msg["id"], "revision_conflict", str(err))
    except InvalidConfig as err:
        connection.send_error(msg["id"], "invalid_config", str(err))
    else:
        connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        "type": f"{DOMAIN}/save_theme",
        probatio.Required("revision"): int,
        probatio.Required("theme"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_theme(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    await _change(hass, connection, msg, "save_theme", msg["theme"])


@websocket_api.websocket_command(
    {
        "type": f"{DOMAIN}/delete_theme",
        probatio.Required("revision"): int,
        probatio.Required("theme_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_theme(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    await _change(hass, connection, msg, "delete_theme", msg["theme_id"])


@websocket_api.websocket_command(
    {
        "type": f"{DOMAIN}/save_settings",
        probatio.Required("revision"): int,
        probatio.Required("settings"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    await _change(hass, connection, msg, "save_settings", msg["settings"])


class UploadView(HomeAssistantView):
    url = "/api/ha_sky_canvas/upload"
    name = "api:ha_sky_canvas:upload"
    requires_auth = True

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        try:
            store = _store(request.app[KEY_HASS])
        except ValueError as err:
            raise web.HTTPServiceUnavailable(text=str(err)) from err
        if request.content_length and request.content_length > MAX_UPLOAD_BYTES + 65536:
            raise web.HTTPRequestEntityTooLarge(
                max_size=MAX_UPLOAD_BYTES, actual_size=request.content_length
            )
        try:
            reader = await request.multipart()
            field = await reader.next()
            if field is None or field.name != "file":
                raise web.HTTPBadRequest(text="Upload one image in the file field")
            data = bytearray()
            while chunk := await field.read_chunk(65536):
                data.extend(chunk)
                if len(data) > MAX_UPLOAD_BYTES:
                    raise web.HTTPRequestEntityTooLarge(
                        max_size=MAX_UPLOAD_BYTES, actual_size=len(data)
                    )
            if await reader.next() is not None:
                raise web.HTTPBadRequest(text="Upload only one image at a time")
            image_id = await store.upload(bytes(data))
        except InvalidConfig as err:
            raise web.HTTPBadRequest(text=str(err)) from err
        except (ValueError, AssertionError) as err:
            raise web.HTTPBadRequest(text="Invalid image upload") from err
        return self.json({"id": image_id})


class ImageView(HomeAssistantView):
    url = "/api/ha_sky_canvas/image/{image_id}"
    name = "api:ha_sky_canvas:image"
    requires_auth = True

    async def get(self, request: web.Request, image_id: str) -> web.FileResponse:
        try:
            store = _store(request.app[KEY_HASS])
            target = await store.image(image_id, request.query.get("thumbnail") == "1")
        except FileNotFoundError as err:
            raise web.HTTPNotFound from err
        except ValueError as err:
            raise web.HTTPServiceUnavailable(text=str(err)) from err
        return web.FileResponse(
            target,
            headers={
                "Content-Type": "image/png",
                "Cache-Control": "private, max-age=86400",
                "X-Content-Type-Options": "nosniff",
                "Vary": "Authorization",
            },
        )


@callback
def register_api(hass: HomeAssistant) -> None:
    for handler in (ws_config, ws_subscribe, ws_save_theme, ws_delete_theme, ws_save_settings):
        websocket_api.async_register_command(hass, handler)
    hass.http.register_view(UploadView())
    hass.http.register_view(ImageView())
