"""Keep the imported upstream snapshot and supplied house-image bytes intact."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_complete_upstream_animation_snapshot_matches_recorded_git_blobs():
    vendor = ROOT / "vendor/dynamic-weather-card"
    provenance = json.loads((vendor / "PROVENANCE.json").read_text())
    animation_paths = {
        str(path.relative_to(vendor)) for path in (vendor / "src/animations").rglob("*.ts")
    }
    recorded_paths = {
        item["path"] for item in provenance["files"] if item["path"].startswith("src/animations/")
    }
    assert len(animation_paths) == 21
    assert animation_paths == recorded_paths
    for item in provenance["files"]:
        content = (vendor / item["path"]).read_bytes()
        git_blob = b"blob " + str(len(content)).encode() + b"\0" + content
        assert hashlib.sha1(git_blob).hexdigest() == item["git_blob_sha"], item["path"]


def test_all_sixteen_bundled_images_match_the_original_import_manifest():
    directory = ROOT / "custom_components/ha_sky_canvas/images"
    manifest = json.loads((directory / "manifest.json").read_text())
    bundled = {str(path.relative_to(ROOT)) for path in directory.rglob("*.png")}
    assert len(bundled) == len(manifest) == 16
    assert bundled == {item["path"] for item in manifest}
    for item in manifest:
        assert hashlib.sha256((ROOT / item["path"]).read_bytes()).hexdigest() == item["sha256"], (
            item["id"]
        )
