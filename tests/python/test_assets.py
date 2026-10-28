"""Image decoding and storage tests using actual PNG/JPEG bytes."""

import os
from io import BytesIO

import pytest
from PIL import Image

from custom_components.ha_sky_canvas.assets import MAX_UPLOAD_BYTES, Assets
from custom_components.ha_sky_canvas.model import InvalidConfig


def png_bytes(size=(100, 50), color=(240, 100, 20, 0)):
    image = Image.new("RGBA", size, color)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_uploaded_image_preserves_transparency_and_has_small_preview(tmp_path):
    assets = Assets(tmp_path / "store", tmp_path / "bundled")
    asset_id = assets.save_upload(png_bytes((1920, 1080)))
    with Image.open(assets.resolve(asset_id)) as image:
        assert image.size == (1920, 1080)
        assert image.getpixel((0, 0))[3] == 0
    with Image.open(assets.resolve(asset_id, True)) as image:
        assert image.size == (384, 216)


@pytest.mark.parametrize(
    "data",
    [
        b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        b"invalid",
        b"",
        b"x" * (MAX_UPLOAD_BYTES + 1),
    ],
)
def test_bad_payload_never_becomes_an_asset(tmp_path, data):
    assets = Assets(tmp_path / "store", tmp_path / "bundled")
    with pytest.raises(InvalidConfig):
        assets.save_upload(data)
    assert not list((tmp_path / "store").glob("*.png"))


def test_path_traversal_is_never_resolved(tmp_path):
    secret = tmp_path / "secrets.yaml"
    secret.write_text("private")
    assets = Assets(tmp_path / "store", tmp_path / "bundled")
    with pytest.raises(FileNotFoundError):
        assets.resolve("../secrets.yaml")


def test_cleanup_preserves_saved_and_recent_drafts(tmp_path):
    assets = Assets(tmp_path / "store", tmp_path / "bundled")
    saved = assets.save_upload(png_bytes())
    old = assets.save_upload(png_bytes())
    recent = assets.save_upload(png_bytes())
    now = 2_000_000_000
    for asset_id in (saved, old):
        os.utime(assets.resolve(asset_id), (now - 90000, now - 90000))
    os.utime(assets.resolve(recent), (now, now))
    assets.cleanup({saved}, now)
    assert assets.resolve(saved).is_file()
    assert assets.resolve(recent).is_file()
    with pytest.raises(FileNotFoundError):
        assets.resolve(old)
