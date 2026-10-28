"""Load pure storage helpers without starting Home Assistant."""

import sys
from importlib.util import find_spec
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
if find_spec("homeassistant") is None:
    package = ModuleType("custom_components.ha_sky_canvas")
    package.__path__ = [str(ROOT / "custom_components" / "ha_sky_canvas")]
    sys.modules[package.__name__] = package
