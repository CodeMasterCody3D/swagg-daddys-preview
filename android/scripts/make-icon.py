"""Size the existing brand artwork for an Android adaptive launcher icon."""
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[2]
source = root / "assets/swagg-daddys-logo-transparent.webp"
art = Image.open(source).convert("RGBA")
canvas = Image.new("RGBA", (432, 432))
logo = ImageOps.contain(art, (280, 260), Image.Resampling.LANCZOS)
canvas.alpha_composite(logo, ((432 - logo.width) // 2, (432 - logo.height) // 2))
destination = root / "android/app/src/main/res/drawable/launcher_foreground.png"
destination.parent.mkdir(parents=True, exist_ok=True)
canvas.save(destination)
