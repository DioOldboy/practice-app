"""Build the deployable app (dist/) and a single-file preview with sample data (preview/preview.html)."""
import base64, pathlib, re, shutil

ROOT = pathlib.Path(__file__).parent
ROOT = ROOT.parent
SRC, DIST, PREV = ROOT / "app", ROOT / "dist", ROOT / "preview"

# 1. Deployable PWA: a straight copy of src/
if DIST.exists():
    shutil.rmtree(DIST)
shutil.copytree(SRC, DIST)

# 2. Preview: everything inline, fonts as data URIs, demo flag on, no service worker.
fonts = (SRC / "fonts.css").read_text()
def inline_font(m):
    data = base64.b64encode((SRC / m.group(1)).read_bytes()).decode()
    return f'url("data:font/woff2;base64,{data}")'
fonts = re.sub(r'url\("(fonts/[^"]+)"\)', inline_font, fonts)
css = (SRC / "app.css").read_text()
js = "\n".join((SRC / f).read_text() for f in ["strings.js", "import-core.js", "app.js"])
assert "</script" not in js.lower()
PREV.mkdir(exist_ok=True)
(PREV / "preview.html").write_text(f"""<title>Aliki Practice App</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
{fonts}
{css}
</style>
<div id="app"></div>
<script>window.PRACTICE_DEMO = true;</script>
<script>
{js}
</script>
""")
print("dist/ and preview/preview.html built")
