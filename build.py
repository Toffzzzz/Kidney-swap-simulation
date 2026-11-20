"""Build the single-file simulator: inlines src/engine.js into src/ui.html -> index.html.

Run:  python3 build.py
Open index.html in any web browser (no internet or installs needed).
"""
from pathlib import Path

root = Path(__file__).parent
ui = (root / "src" / "ui.html").read_text(encoding="utf-8")
engine = (root / "src" / "engine.js").read_text(encoding="utf-8")
assert "/*__ENGINE__*/" in ui
(root / "index.html").write_text(ui.replace("/*__ENGINE__*/", engine), encoding="utf-8")
print("Built index.html")
