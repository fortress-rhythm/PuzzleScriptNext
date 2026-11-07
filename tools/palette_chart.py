# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Chart the accessibility of every palette in src/js/colors.js.

    uv run tools/palette_chart.py                 # writes palette-chart.html
    uv run tools/palette_chart.py -o chart.html
    uv run tools/palette_chart.py --table         # print the numbers, no HTML

Reads colors.js as plain text (nothing is executed) and measures all 21 slots of
every palette, stock and fork alike: low-contrast pairs (WCAG ratio < 1.3),
colourblind collapses (RGB distance > 20 normally, < 15 under a protan, deutan
or tritan matrix simulation), duplicate slots and ramp faults.

This is an independent, self-contained reading. It uses its own simulation
matrices and does not import palette_lib.py, so a colourblind count can differ
by a few from palette_analysis.py's. Use that tool for the rubric and for
anything written back; use this one to look at the whole set at once.
"""
import argparse, html, itertools, math, re, sys
from pathlib import Path

COLORS_JS = Path(__file__).resolve().parent.parent / "src" / "js" / "colors.js"
FORK_FIRST = 15          # indices below this are the inherited palettes
SLOTS = ("black white grey darkgrey lightgrey red darkred lightred brown "
         "darkbrown lightbrown orange yellow green darkgreen lightgreen blue "
         "lightblue darkblue purple pink").split()
RAMPS = ("grey", "red", "brown", "green", "blue")
# Machado 2009, severity 1.0, applied to linear RGB
CVD = {
    "prot": [[.152286, 1.052583, -.204868], [.114503, .786281, .099216], [-.003882, -.048116, 1.051998]],
    "deut": [[.367322, .860646, -.227968], [.280085, .672501, .047413], [-.011820, .042940, .968881]],
    "trit": [[1.255528, -.076749, -.178779], [-.078411, .930809, .147602], [.004733, .691367, .303900]],
}


def load(path=COLORS_JS):
    """-> {alias index: name}, {name: {slot: '#RRGGBB'}}"""
    src = Path(path).read_text()
    head, body = src.split("colorPalettes = {", 1)
    aliases = {int(i): n for i, n in re.findall(r'^\s*(\d+)\s*:\s*"(\w+)"', head, re.M)}
    pals = {}
    for m in re.finditer(r"^\s*(\w+)\s*:\s*\{(.*?)\}", body, re.S | re.M):
        cols = {k: v.upper() for k, v in re.findall(r'(\w+)\s*:\s*"(#[0-9a-fA-F]{6})"', m.group(2))}
        if cols:
            pals[m.group(1)] = cols
    return aliases, pals


def rgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def lin(c):
    c /= 255
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def enc(x):
    x = max(0, min(1, x))
    return 255 * (12.92 * x if x <= .0031308 else 1.055 * x ** (1 / 2.4) - .055)


def lum(c):
    r, g, b = map(lin, c)
    return .2126 * r + .7152 * g + .0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + .05) / (lb + .05)


def lstar(h):
    y = lum(rgb(h))
    return 116 * y ** (1 / 3) - 16 if y > .008856 else 903.3 * y


def simulate(c, m):
    l = [lin(v) for v in c]
    return [enc(sum(m[i][j] * l[j] for j in range(3))) for i in range(3)]


def measure(pal):
    cols = [rgb(pal[s]) for s in SLOTS]
    low = sum(1 for a, b in itertools.combinations(cols, 2) if contrast(a, b) < 1.3)
    sims = {k: [simulate(c, m) for c in cols] for k, m in CVD.items()}
    merged, per = set(), dict.fromkeys(CVD, 0)
    for (i, a), (j, b) in itertools.combinations(enumerate(cols), 2):
        if math.dist(a, b) > 20:
            for k in CVD:
                if math.dist(sims[k][i], sims[k][j]) < 15:
                    per[k] += 1
                    merged.add((i, j))
    faults = 0
    for n in RAMPS:
        seq = [pal.get("dark" + n), pal[n], pal.get("light" + n)]
        seq = [x for x in seq if x]
        faults += sum(1 for a, b in zip(seq, seq[1:]) if lstar(b) <= lstar(a))
    return dict(low=low, cvd=len(merged), per=per,
                dup=21 - len({pal[s] for s in SLOTS}), faults=faults)


def collect():
    aliases, pals = load()
    rows = []
    for i in sorted(aliases):
        if aliases[i] in pals:
            rows.append(dict(i=i, name=aliases[i], fork=i >= FORK_FIRST, **measure(pals[aliases[i]])))
    return rows


def ranked(rows):
    """Best first: rank-sum of the two headline measures, ties by raw counts."""
    def rank(key):
        vals = sorted({r[key] for r in rows})
        return {r["name"]: vals.index(r[key]) for r in rows}
    rl, rc = rank("low"), rank("cvd")
    return sorted(rows, key=lambda r: (rl[r["name"]] + rc[r["name"]], r["low"], r["cvd"]))


def table(rows):
    out = [f"{'#':>2} {'palette':16} {'group':6} {'lowC':>4} {'CVD':>4}   P  D  T  dup faults"]
    for r in ranked(rows):
        p = r["per"]
        out.append(f"{r['i']:>2} {r['name']:16} {'fork' if r['fork'] else 'stock':6} {r['low']:>4} {r['cvd']:>4}"
                   f" {p['prot']:>3}{p['deut']:>3}{p['trit']:>3} {r['dup']:>4} {r['faults']:>6}")
    return "\n".join(out)


# --- the chart ---------------------------------------------------------------
ROW, TOP, LEFT, COLW = 26, 78, 150, 290
MAX_LOW, MAX_CVD = 80, 12


def bar(x0, y, val, mx, fork):
    bw = val / mx * COLW
    col = "var(--cur)" if fork else "var(--stock)"
    s = ""
    if val:
        s += (f'<rect x="{x0}" y="{y}" width="{bw:.1f}" height="{ROW - 10}" rx="3" '
              f'fill="{"url(#hatch)" if fork else col}" stroke="{col}" stroke-width="1.5"/>')
    return s + f'<text x="{x0 + bw + 6:.1f}" y="{y + (ROW - 10) / 2 + 4}" class="val">{val}</text>'


def chart(rows):
    rows = ranked(rows)
    x1, x2 = LEFT, LEFT + COLW + 90
    h = TOP + ROW * len(rows) + 40
    s = [f'<svg viewBox="0 0 960 {h}" role="img" aria-label="Accessibility metrics for {len(rows)} palettes, best to worst">',
         '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
         '<rect width="6" height="6" fill="var(--surface)"/><rect width="3" height="6" fill="var(--cur)"/></pattern></defs>',
         f'<text x="{x1}" y="{TOP - 22}" class="head">Low-contrast pairs (of 210)</text>'
         f'<text x="{x1}" y="{TOP - 8}" class="sub">contrast ratio below 1.3 · lower is better</text>',
         f'<text x="{x2}" y="{TOP - 22}" class="head">Colourblind collapses</text>'
         f'<text x="{x2}" y="{TOP - 8}" class="sub">pairs that merge under simulation · lower is better</text>']
    for k, r in enumerate(rows):
        y = TOP + k * ROW
        tip = (f'{r["i"]} {r["name"]} ({"curated fork palette" if r["fork"] else "stock"}): {r["low"]} low-contrast pairs, '
               f'{r["cvd"]} colourblind collapses, {r["dup"]} duplicate slots, {r["faults"]} ramp faults')
        s.append(f'<g class="row"><title>{html.escape(tip)}</title>'
                 f'<rect x="0" y="{y - 3}" width="960" height="{ROW}" fill="transparent" class="hit"/>'
                 f'<text x="{LEFT - 10}" y="{y + (ROW - 10) / 2 + 4}" text-anchor="end" class="name">{r["name"]}</text>'
                 f'{bar(x1, y, r["low"], MAX_LOW, r["fork"])}{bar(x2, y, r["cvd"], MAX_CVD, r["fork"])}</g>')
    s.append("</svg>")
    return "\n".join(s)


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PuzzleScript Next palette accessibility</title>
<style>
:root{--surface:#fcfcfb;--ink:#1c1c1a;--ink2:#52524e;--grid:#e4e3df;--stock:#2a6fdb;--cur:#d9730d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--surface:#1a1a19;--ink:#ecebe6;--ink2:#a8a7a0;--grid:#33332f;--stock:#4f86e0;--cur:#cc7a33}}
body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px} p.lede{color:var(--ink2);margin:0 0 14px}
.legend{display:flex;gap:18px;margin:0 0 10px;color:var(--ink2);flex-wrap:wrap}
.legend i{display:inline-block;width:14px;height:12px;border-radius:2px;vertical-align:-1px;margin-right:6px;border:1.5px solid}
.scroll{overflow-x:auto} svg{min-width:760px;width:100%;height:auto}
text{fill:var(--ink)} .head{font-weight:600;font-size:13px} .sub{fill:var(--ink2);font-size:11px} .name{font-size:13px} .val{font-size:12px;fill:var(--ink2)}
.row:hover .hit{fill:var(--grid)}
details{margin-top:18px;color:var(--ink2)} table{border-collapse:collapse;margin-top:8px} td,th{padding:3px 12px 3px 0;text-align:left;color:var(--ink)} th{color:var(--ink2);font-weight:600}
.note{color:var(--ink2);font-size:12px;margin-top:12px}
</style></head><body><main>
<h1>PuzzleScript Next palettes, best to worst</h1>
<p class="lede">__LEDE__ Sorted by combined rank on the two measures; hover a row for duplicate-slot and ramp-fault counts.</p>
<div class="legend"><span><i style="background:var(--stock);border-color:var(--stock)"></i>Stock (inherited)</span><span><i style="background:repeating-linear-gradient(45deg,var(--cur) 0 3px,var(--surface) 3px 6px);border-color:var(--cur)"></i>Curated fork palette (hatched)</span></div>
<div class="scroll">__CHART__</div>
<details><summary>Table view</summary><table><tr><th>#</th><th>palette</th><th>group</th><th>low-contrast</th><th>CVD collapses</th><th>duplicate slots</th><th>ramp faults</th></tr>__ROWS__</table></details>
<p class="note">Computed from src/js/colors.js by tools/palette_chart.py (WCAG contrast; protan/deutan/tritan matrix simulation; collapse = RGB distance &gt; 20 normally but &lt; 15 simulated). Colourblind counts may differ by a few from palette_analysis.py.</p>
</main></body></html>"""


def page(rows):
    n_stock = sum(not r["fork"] for r in rows)
    lede = f"All {len(rows)} palettes: the {n_stock} stock ones and the {len(rows) - n_stock} curated fork palettes."
    trs = "".join(
        f'<tr><td>{r["i"]}</td><td>{r["name"]}</td><td>{"curated" if r["fork"] else "stock"}</td>'
        f'<td>{r["low"]}</td><td>{r["cvd"]}</td><td>{r["dup"]}</td><td>{r["faults"]}</td></tr>'
        for r in ranked(rows))
    return PAGE.replace("__LEDE__", lede).replace("__CHART__", chart(rows)).replace("__ROWS__", trs)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("-o", "--output", default="palette-chart.html", help="HTML file to write")
    ap.add_argument("--table", action="store_true", help="print the numbers instead of writing HTML")
    args = ap.parse_args(argv)
    rows = collect()
    if args.table:
        print(table(rows))
        return 0
    Path(args.output).write_text(page(rows), encoding="utf-8")
    print(f"wrote {args.output} ({len(rows)} palettes)", file=sys.stderr)
    print(Path(args.output).resolve().as_uri())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(141)
