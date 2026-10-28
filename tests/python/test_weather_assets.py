"""Verify the locally bundled official symbols and their source provenance."""

import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree


def test_all_official_symbols_are_pinned_passive_and_local():
    directory = (
        Path(__file__).parents[2] / "custom_components/ha_sky_canvas/frontend/weather-icons/v1"
    )
    manifest = json.loads((directory / "manifest.json").read_text())
    expected = set(range(31)) - {4}
    assert {asset["code"] for asset in manifest["assets"]} == expected
    assert len(manifest["assets"]) == len(expected)
    assert {path.name for path in directory.glob("*.svg")} == {f"{code}.svg" for code in expected}
    for asset in manifest["assets"]:
        assert asset["file"] == f"{asset['code']}.svg"
        assert asset["source_url"] == (
            f"https://www.metoffice.gov.uk/api/images/file/{asset['code']}svg?prefix=images"
        )
        content = (directory / asset["file"]).read_bytes()
        assert len(content) == asset["bytes"]
        assert hashlib.sha256(content).hexdigest() == asset["sha256"]
        # The official files contain gradients and some embedded PNG shadows.
        # Preserve those bytes, while refusing active SVG and remote resources.
        for element in ElementTree.fromstring(content).iter():
            name = element.tag.rsplit("}", 1)[-1].lower()
            assert name not in {"script", "foreignobject", "animate", "animatetransform", "set"}
            for key, value in element.attrib.items():
                attribute = key.rsplit("}", 1)[-1].lower()
                assert not attribute.startswith("on")
                if attribute in {"href", "src"}:
                    assert value.startswith(("#", "data:image/png;base64,"))
        assert not re.search(rb"url\(\s*['\"]?(?:https?:|//)", content, re.I)
    provenance = (directory / "SOURCE.md").read_text()
    assert "Open Government Licence v3.0" in provenance
    assert manifest["terms"] == "https://www.metoffice.gov.uk/policies/tandc"
    assert manifest["licence"] == (
        "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
    )
