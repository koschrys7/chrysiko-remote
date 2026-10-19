#!/usr/bin/env python3
"""Bundle Chrysiko Remote into one self-contained HTML file (dist/ChrysikoRemote.html) for the iPhone/iPad.
Each module is wrapped in its own function scope and exposes its exports as an object, so the page is a single
inline script (no data: imports, works under strict CSPs). The Inter fonts are inlined and the demo capture embedded."""
import base64, json, re
from pathlib import Path
HERE = Path(__file__).resolve().parents[1]
b64 = lambda b: base64.b64encode(b).decode()
IMPORT = re.compile(r'^import\s*\{([^}]*)\}\s*from\s*"\./(\w+)\.js";\s*$', re.M)
EXPORT = re.compile(r'^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)', re.M)

def wrap(name, src):
    imports = [f"const {{{names.strip()}}} = __m_{mod};" for names, mod in IMPORT.findall(src)]
    body = IMPORT.sub("", src)
    exported = EXPORT.findall(body)
    body = re.sub(r"^export\s+", "", body, flags=re.M)
    return f"const __m_{name} = (() => {{\n" + "\n".join(imports) + "\n" + body + f"\nreturn {{ {', '.join(exported)} }};\n}})();\n"

order = ["ampero", "catalog", "views", "app"]
js = "".join(wrap(n, (HERE / f"{n}.js").read_text()) for n in order)
html = (HERE / "index.html").read_text()
for sub in ("latin", "greek"):
    html = html.replace(f"url(fonts/Inter-{sub}.woff2)", "url(data:font/woff2;base64," + b64((HERE / f"fonts/Inter-{sub}.woff2").read_bytes()) + ")")
demo = {"received": json.loads((HERE / "test/capture-trad-violin.json").read_text())["received"]}
inline = ("<script>window.__CHRYSIKO_DEMO__ = " + json.dumps(demo, separators=(",", ":")) + ";</script>\n"
          + "<script>\n\"use strict\";\n" + js + "</script>")
assert '<script type="module" src="./app.js"></script>' in html
html = html.replace('<script type="module" src="./app.js"></script>', inline)
out = HERE / "dist" / "ChrysikoRemote.html"; out.parent.mkdir(exist_ok=True); out.write_text(html)
print(out, f"{out.stat().st_size // 1024} KB")

# Preview build for a claude.ai artifact: no document wrapper (the host adds one), demo forced, title first.
body = html.split("<body>", 1)[1].rsplit("</body>", 1)[0]
style = html[html.index("<style>"):html.index("</style>") + len("</style>")]
preview = ('<title>Chrysiko Remote</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + style + "\n"
           + "<script>window.__CHRYSIKO_FORCE_DEMO__ = true;</script>\n" + body)
pv = HERE / "dist" / "ChrysikoRemote-preview.html"; pv.write_text(preview)
print(pv, f"{pv.stat().st_size // 1024} KB")
