"""Bounded image decoding and immutable image storage (executor-only methods)."""

import secrets
import time
import warnings
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .const import BUNDLED_IDS
from .model import ASSET_PATTERN, InvalidConfig

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 16_777_216
MAX_STORAGE_BYTES = 512 * 1024 * 1024
ALLOWED_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})


class Assets:
    """Store images outside integration files so upgrades preserve replacements."""

    def __init__(self, directory: Path, bundled: Path) -> None:
        self.directory = directory
        self.bundled = bundled

    def resolve(self, asset_id: str, thumbnail: bool = False) -> Path:
        """Resolve only opaque known IDs, never client-supplied paths."""
        if asset_id in BUNDLED_IDS:
            theme, slot = asset_id.split("_", 1)
            source = self.bundled / theme / f"{slot}.png"
        elif ASSET_PATTERN.fullmatch(asset_id):
            source = self.directory / f"{asset_id}.png"
        else:
            raise FileNotFoundError("Unknown image")
        if not source.is_file():
            raise FileNotFoundError("Unknown image")
        if not thumbnail:
            return source
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / f"{asset_id}.thumb.png"
        if not target.is_file():
            with Image.open(source) as image:
                image.thumbnail((384, 216), Image.Resampling.LANCZOS)
                self._atomic_save(image, target)
                if (
                    sum(path.stat().st_size for path in self.directory.glob("*.png"))
                    > MAX_STORAGE_BYTES
                ):
                    target.unlink(missing_ok=True)
                    raise InvalidConfig("The image library is full; preview could not be stored")
        return target

    def save_upload(self, data: bytes) -> str:
        """Decode and re-encode supported static raster images without metadata."""
        if not data or len(data) > MAX_UPLOAD_BYTES:
            raise InvalidConfig("Choose an image smaller than 12 MB")
        self.directory.mkdir(parents=True, exist_ok=True)
        stored = sum(path.stat().st_size for path in self.directory.glob("*.png"))
        if stored + len(data) > MAX_STORAGE_BYTES:
            raise InvalidConfig("The image library has reached its 512 MB limit")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(data)) as source:
                    if source.format not in ALLOWED_FORMATS or getattr(
                        source, "is_animated", False
                    ):
                        raise InvalidConfig("Choose a static PNG, JPEG or WebP image")
                    width, height = source.size
                    if (
                        width < 1
                        or height < 1
                        or max(width, height) > 8192
                        or width * height > MAX_PIXELS
                    ):
                        raise InvalidConfig("Image dimensions exceed the 16 megapixel limit")
                    source.load()
                    image = ImageOps.exif_transpose(source).convert("RGBA")
                    image.info.clear()
                    asset_id = f"uploaded_{secrets.token_hex(16)}"
                    target = self.directory / f"{asset_id}.png"
                    self._atomic_save(image, target)
                    if stored + target.stat().st_size > MAX_STORAGE_BYTES:
                        target.unlink()
                        raise InvalidConfig("The decoded image exceeds the image library limit")
                    return asset_id
        except (
            UnidentifiedImageError,
            OSError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ) as err:
            raise InvalidConfig("This image cannot be safely decoded") from err

    @staticmethod
    def _atomic_save(image: Image.Image, target: Path) -> None:
        temporary = target.with_name(f".{target.stem}-{secrets.token_hex(8)}.tmp")
        try:
            image.save(temporary, format="PNG")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

    def validate_references(self, config: dict) -> None:
        for theme in config["themes"]:
            for asset_id in theme["images"].values():
                if asset_id:
                    try:
                        self.resolve(asset_id)
                    except FileNotFoundError as err:
                        raise InvalidConfig(
                            "An uploaded image expired or is missing. Upload it again."
                        ) from err

    def cleanup(self, referenced: set[str], now: float | None = None) -> None:
        """Delete unreferenced staged/replaced images only after a full day."""
        cutoff = (time.time() if now is None else now) - 86400
        for path in self.directory.glob("uploaded_*.png"):
            asset_id = path.name.removesuffix(".thumb.png").removesuffix(".png")
            if (
                ASSET_PATTERN.fullmatch(asset_id)
                and asset_id not in referenced
                and path.stat().st_mtime < cutoff
            ):
                path.unlink(missing_ok=True)
