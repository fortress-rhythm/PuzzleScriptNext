# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Palette analysis for the palette-set extension.

Reads the curated palettes in `palettes/`, runs the three checks from the
rubric on each - WCAG contrast, colourblindness collapse, duplicate-hex
counting - beside the raw hue-clustering pass that a human overrode, and
generates every file derived from them.

Run:  uv run tools/palette_analysis.py             the report
      uv run tools/palette_analysis.py --write     regenerate the derived files
      uv run tools/palette_analysis.py --check     has anything drifted?
      uv run tools/palette_analysis.py --json      machine-readable mappings

See doc/palette-folder.md for the folder, doc/palette-set.md for the palettes.

Deliberately dependency-free so `uv run` needs no resolution step.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from palette_lib import (  # noqa: E402
    ALIAS_OF, CVD, SLOTS, analyse, contrast, dist, hsl, load_palette_dir,
    luminance, load_builtins, rgb, simulate,
)

# ------------------------------------------------------------------- palettes
#
# The palettes themselves live in `palettes/`, one JSON file each, and this
# script is the thing that reads them. They used to be two Python dicts here,
# which meant the only way to add a palette was to edit a tool, and the only
# way to read one was to read a tool. `doc/palette-folder.md` describes the
# format; `palette_lib.load_palette_dir()` is the reader.
#
# Derivation, unchanged: every source palette was converted to HSL and
# hue-clustered per the rubric, then the clustering pass was read against the
# slot list by hand, and the result is the `slots` table in the file.
# `first_pass()` still runs the raw clustering so the report can show where
# judgement overrode it and why - the algorithm gets the ramps right but has no
# way to know that, say, a pale cream is a better `white` than a `darkbrown`.
#
# Provenance per slot is one of:
#   sourced  - taken directly from the source palette
#   added    - not present in the source; hand-picked to match its tone, and
#              called out in the docs as an addition rather than a quotation
# No slot is ever left silently wrong: a hue the palette does not contain is
# either added deliberately or the palette is reported as a poor fit.

PALETTES = load_palette_dir()

# Kept under their old names because everything downstream - the report, the
# emitters, the checks - was written against them, and because they are still
# the right shape: what the source palette is, and what this fork made of it.
SOURCES = {
    name: {"title": p["title"], "author": p["author"], "url": p["url"],
           "note": p["note"], "hex": [c.lstrip("#") for c in p["colors"]]}
    for name, p in PALETTES.items()
}
CURATED = {
    name: {slot: tuple(v) for slot, v in p["slots"].items()}
    for name, p in PALETTES.items()
}


def curated(name):
    table = CURATED[name]
    mapping = {s: table[s][0] for s in SLOTS}
    prov = {s: table[s][1] for s in SLOTS}
    used = {v.lower() for v in mapping.values()}
    spares = ["#" + c.lower() for c in SOURCES[name]["hex"]
              if "#" + c.lower() not in used]
    return mapping, prov, spares


# Hue families, per the rubric. Reds wrap through 0.
FAMILIES = [
    ("red",    lambda hu: hu >= 340 or hu < 20),
    ("orange", lambda hu: 20 <= hu < 45),
    ("yellow", lambda hu: 45 <= hu < 65),
    ("green",  lambda hu: 80 <= hu < 150),
    ("blue",   lambda hu: 150 <= hu < 230),
    ("purple", lambda hu: 260 <= hu < 340),
]

NEUTRAL_SAT = 0.18


def first_pass(hexes):
    """Raw hue-clustering, kept so the report can show what judgement changed."""
    colors = ["#" + c.lower() for c in hexes]
    fam = {}
    for c in colors:
        hu, sa, li = hsl(c)
        key = "neutral"
        if sa >= NEUTRAL_SAT:
            for n, test in FAMILIES:
                if test(hu):
                    key = n
                    break
            else:
                key = "other"
        fam.setdefault(key, []).append(c)
    for k in fam:
        fam[k].sort(key=lambda c: hsl(c)[2])
    return fam


# -------------------------------------------------------------------- report

def report(name, src, mapping, prov, spares, res):
    print(f"\n{'=' * 74}\n{src['title']}  ({name})  —  {src['author']}\n{src['url']}\n{'=' * 74}")

    print(f"\n21-slot mapping  ({len(src['hex'])} source colours)")
    for slot in SLOTS:
        tag = "" if prov[slot] == "sourced" else f"   <- {prov[slot]}"
        print(f"  {slot:<11} {mapping[slot]}{tag}")

    gaps = [s for s in SLOTS if prov[s] != "sourced"]
    print(f"\n  sourced: {21 - len(gaps)}/21"
          + (f"   hand-picked additions: {', '.join(gaps)}" if gaps else ""))
    print(f"  spares (unused source colours): {', '.join(spares) if spares else 'none'}")

    print(f"\ndistinct hex values: {res['unique']}/21")
    if res["dupes"]:
        for c, names in res["dupes"].items():
            print(f"  {c} shared by: {', '.join(names)}")

    print(f"\ncontrast pairs below 1.3: {len(res['low_contrast'])}")
    for a, b, r in res["low_contrast"][:12]:
        print(f"  {a:<11} vs {b:<11} ratio {r}")
    if len(res["low_contrast"]) > 12:
        print(f"  ... and {len(res['low_contrast']) - 12} more")

    total_cvd = sum(len(v) for v in res["cvd"].values())
    print(f"\ncolourblind collapses (normal distance >20, simulated <15): {total_cvd}")
    for kind, flags in res["cvd"].items():
        if not flags:
            continue
        print(f"  {kind}: {len(flags)}")
        for a, b, n, s in flags[:6]:
            print(f"    {a:<11} vs {b:<11} normal {n:>6}  sim {s:>5}")
        if len(flags) > 6:
            print(f"    ... and {len(flags) - 6} more")


def baseline():
    """The inherited palettes, as the yardstick the candidates are read against.

    The fork's own are excluded - every palette in palettes/, however many
    that is. They live in colors.js too, so a plain read of the file returns
    all of them and the "shipped range" quietly widens to include the very
    palettes being measured against it, which would make the comparison
    meaningless in exactly the direction that flatters this work. Fourteen is
    the number that means anything here.
    """
    builtins = load_builtins(exclude=tuple(SOURCES))
    if not builtins:
        return
    print(f"\n{'=' * 74}\nBASELINE - the {len(builtins)} inherited palettes, "
          f"identical checks\n{'=' * 74}")
    print(f"  {'palette':<16} {'unique':>6} {'contrast<1.3':>13} {'cvd collapses':>14}")
    rows = []
    for name, mapping in builtins.items():
        r = analyse(mapping)
        rows.append((name, r["unique"], len(r["low_contrast"]),
                     sum(len(v) for v in r["cvd"].values())))
    for name, u, lc, cv in rows:
        print(f"  {name:<16} {u:>4}/21 {lc:>13} {cv:>14}")
    lo = min(r[2] for r in rows)
    hi = max(r[2] for r in rows)
    print(f"\n  inherited range: {lo}-{hi} low-contrast pairs, "
          f"{min(r[3] for r in rows)}-{max(r[3] for r in rows)} CVD collapses")


# Emitters. Every derived file comes from palettes/, so the palette can never
# drift between what the engine uses, what the copy-paste block says and what
# the map editor draws.

# Key order and padding copied from the existing entries in colors.js so the
# new block is indistinguishable in style from the 14 it sits beside.
JS_ORDER = [
    "black", "white", "grey", "darkgrey", "lightgrey",
    "gray", "darkgray", "lightgray",
    "red", "darkred", "lightred", "brown", "darkbrown", "lightbrown",
    "orange", "yellow", "green", "darkgreen", "lightgreen",
    "blue", "lightblue", "darkblue", "purple", "pink",
]
JS_PAD = {
    "black": "black   \t\t", "white": "white\t\t\t", "grey": "grey\t\t\t",
    "darkgrey": "darkgrey\t\t", "lightgrey": "lightgrey\t\t",
    "gray": "gray\t\t\t", "darkgray": "darkgray\t\t", "lightgray": "lightgray\t\t",
    "red": "red\t\t\t\t", "darkred": "darkred\t\t\t", "lightred": "lightred\t\t",
    "brown": "brown\t\t\t", "darkbrown": "darkbrown\t\t", "lightbrown": "lightbrown\t\t",
    "orange": "orange\t\t\t", "yellow": "yellow \t\t\t", "green": "green\t\t\t",
    "darkgreen": "darkgreen\t\t", "lightgreen": "lightgreen\t\t", "blue": "blue\t\t\t",
    "lightblue": "lightblue\t\t", "darkblue": "darkblue\t\t", "purple": "purple\t\t\t",
    "pink": "pink\t\t\t",
}


def emit_js():
    out = []
    for name in SOURCES:
        src, (mapping, prov, spares) = SOURCES[name], curated(name)
        added = [s for s in SLOTS if prov[s] == "added"]
        out.append(f"\t// {src['title']} - {src['author']} - {src['url']}")
        out.append(f"\t// {src['note']}.")
        if added:
            out.append(f"\t// Not in the source, added to fill PuzzleScript's fixed slots: "
                       + ", ".join(added) + ".")
        if spares:
            out.append("\t// Source colours with no slot to occupy: " + ", ".join(spares) + ".")
        out.append(f"\t{name} : {{")
        for k in JS_ORDER:
            v = mapping[ALIAS_OF.get(k, k)]
            out.append(f'\t{JS_PAD[k]}: "{v}",')
        out[-1] = out[-1].rstrip(",")
        out.append("\t},")
    return "\n".join(out)


def emit_refs():
    """Per-game override blocks: the same palettes, usable on stock PuzzleScript."""
    out = [
        "(  Palette reference blocks - palette-set extension",
        "",
        "   Each block below defines one curated palette entirely inline, as overrides",
        "   on top of arnecolors. Paste one into a game's prelude and it works on any",
        "   PuzzleScript build, including stock PuzzleScript and PuzzleScript Plus,",
        "   which have never heard of these palette names.",
        "",
        "   In this fork you can instead write just `color_palette bentenpond`. The",
        "   inline form is what you distribute; the short form is what you author with.",
        "   The editor's Palettes panel will generate either on demand.",
        "",
        "   These blocks are generated by tools/palette_analysis.py - edit that, not this.",
        ")",
        "",
    ]
    for name in SOURCES:
        src, (mapping, prov, spares) = SOURCES[name], curated(name)
        added = [s for s in SLOTS if prov[s] == "added"]
        # Every key, aliases included. Omitting gray/darkgray/lightgray would
        # leave a game that spells them the American way pulling those three
        # colours from arnecolors while everything else came from here.
        pairs = " ".join(f"{k} {mapping[ALIAS_OF.get(k, k)]}" for k in JS_ORDER)
        out.append(f"({src['title']} - {src['author']}")
        out.append(f" {src['url']}")
        out.append(f" {src['note']}.")
        if added:
            out.append(" Original additions, not from the source palette: " + ", ".join(added) + ".")
        out.append(")")
        out.append(f"color_palette arnecolors {pairs}")
        out.append("")
    return "\n".join(out)


def emit_aliases():
    """The `colorPalettesAliases` entries, so the index table is generated too.

    It was the one hand-maintained list left, and the one most likely to go
    wrong: an index typed twice is not a syntax error, it is a palette that
    silently cannot be reached by number.
    """
    lines = [f'\t{p["index"]} : "{name}",' for name, p in PALETTES.items()]
    lines[-1] = lines[-1].rstrip(",")
    return "\n".join(lines)


def emit_block(name):
    """One palette as the portable prelude block, ready to paste into a game.

    The same text `--emit-refs` puts in src/demo/palette-refs.txt, for when you
    want one palette rather than the file of all of them.
    """
    p = PALETTES[name]
    mapping, prov, _ = curated(name)
    added = [s for s in SLOTS if prov[s] == "added"]
    pairs = " ".join(f"{k} {mapping[ALIAS_OF.get(k, k)]}" for k in JS_ORDER)
    out = [f"({p['title']} - {p['author']}", f" {p['url']}"]
    if p["note"]:
        out.append(f" {p['note']}.")
    if added:
        out.append(" Original additions, not from the source palette: "
                   + ", ".join(added) + ".")
    out.append(")")
    out.append(f"color_palette arnecolors {pairs}")
    return "\n".join(out)


# ------------------------------------------------------------- the map editor
#
# puzzlescript-map-editor carries its own copy of the palette table so it can
# run standalone. It used to be copied across by hand, which is a step that
# gets skipped: the map editor then draws a game in arnecolors and says the
# palette is unknown, and only its own test suite notices, and only when both
# repositories happen to be checked out together.

ME_ORDER = JS_ORDER


def emit_mapeditor():
    out = []
    for name, p in PALETTES.items():
        mapping, _, _ = curated(name)
        out.append(f'    "{name}": {{')
        for k in ME_ORDER:
            out.append(f'        "{k}": "{mapping[ALIAS_OF.get(k, k)]}",')
        out[-1] = out[-1].rstrip(",")
        out.append("    },")
    # Last entry in the object, so no trailing comma.
    out[-1] = out[-1].rstrip(",")
    return "\n".join(out)


def emit_mapeditor_aliases():
    lines = [f'    "{p["index"]}": "{name}",' for name, p in PALETTES.items()]
    lines[-1] = lines[-1].rstrip(",")
    return "\n".join(lines)


# ---------------------------------------------------------------- writing out

GENERATED_BY = ("generated from palettes/ by tools/palette_analysis.py --write"
                " - do not edit by hand")


def _replace_block(text, start_marker, end_marker, body, path, nth=0):
    """Swap the text between two comment markers, leaving the markers alone.

    `nth` picks which pair when the same markers appear more than once, which
    they do in colors.js: the alias table and the palette bodies are two blocks
    in two different objects, labelled the same way.
    """
    starts, i = [], text.find(start_marker)
    while i >= 0:
        starts.append(i)
        i = text.find(start_marker, i + 1)
    if len(starts) <= nth:
        raise SystemExit(f"{path}: expected {nth + 1} "
                         f"'{start_marker.strip()}' markers, found {len(starts)}"
                         " - cannot write into it safely")

    head_end = text.index("\n", starts[nth]) + 1
    # The marker's own explanatory comment stays; only the data below it is
    # replaced. The header is the unbroken run of comment lines under the
    # marker - a blank line ends it, which is what keeps the per-palette credit
    # comments inside the generated body from looking like header and
    # surviving a rewrite that should have replaced them.
    while True:
        line_end = text.index("\n", head_end) + 1
        if not text[head_end:line_end].lstrip().startswith("//"):
            break
        head_end = line_end

    b = text.find(end_marker, head_end)
    if b < 0:
        raise SystemExit(f"{path}: '{start_marker.strip()}' is never closed")
    return text[:head_end] + body + "\n" + text[b:]


def write_generated(root=None, dry_run=False):
    """Regenerate every file that is derived from palettes/.

    Each one is written between comment markers that are already in the file,
    so nothing outside the fork's own block is ever touched and an upstream
    merge still sees a clean diff. Files that are not there are skipped rather
    than created - this writes into a checkout, it does not lay one out.
    """
    root = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    written, unchanged = [], []

    def put(path, new):
        rel = os.path.relpath(path, root)
        if not os.path.exists(path):
            return
        if open(path, encoding="utf-8").read() == new:
            unchanged.append(rel)
            return
        if not dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new)
        written.append(rel)

    colors_js = os.path.join(root, "src", "js", "colors.js")
    if os.path.exists(colors_js):
        text = open(colors_js, encoding="utf-8").read()
        start = "// --- palette-set extension (fork-original, not upstream)"
        end = "// --- end palette-set extension"
        # Two blocks, same markers: the alias table first, the palette bodies
        # second. The second one loses its final comma - it is the last entry
        # in colorPalettes and a trailing comma there is a syntax error in the
        # older browsers this engine still runs in.
        text = _replace_block(text, start, end, emit_aliases(), colors_js, nth=0)
        body = "\n" + emit_js().rstrip().rstrip(",")
        text = _replace_block(text, start, end, body, colors_js, nth=1)
        put(colors_js, text)

    refs = os.path.join(root, "src", "demo", "palette-refs.txt")
    put(refs, emit_refs().rstrip("\n") + "\n")

    for me in (os.path.join(root, "..", "puzzlescript-map-editor", "src", "palettes.js"),
               os.path.join(root, "puzzlescript-map-editor", "src", "palettes.js")):
        me = os.path.normpath(me)
        if not os.path.exists(me):
            continue
        text = open(me, encoding="utf-8").read()
        text = _replace_block(text, "// --- palette-set extension: palettes",
                              "// --- end palette-set extension: palettes",
                              emit_mapeditor(), me)
        text = _replace_block(text, "// --- palette-set extension: aliases",
                              "// --- end palette-set extension: aliases",
                              emit_mapeditor_aliases(), me)
        put(me, text)

    return written, unchanged


def main():
    ap = argparse.ArgumentParser(
        description="Report on, and generate from, the palettes in palettes/.",
        epilog="""\
palettes/ is the source; everything else is generated from it:

  palette_analysis.py --write        regenerate colors.js, palette-refs.txt and
                                     the map editor's copy, in place
  palette_analysis.py --check        say what --write would change, change
                                     nothing, exit 1 if anything has drifted
  palette_analysis.py --block NAME   one palette as a prelude block to paste

With no arguments it prints the derivation report and the checks, with the
fourteen inherited palettes underneath as a baseline.
""",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="emit mappings as JSON")
    ap.add_argument("--emit-js", action="store_true", help="colorPalettes entries for colors.js")
    ap.add_argument("--emit-aliases", action="store_true", help="colorPalettesAliases entries")
    ap.add_argument("--emit-refs", action="store_true", help="per-game override blocks")
    ap.add_argument("--emit-mapeditor", action="store_true",
                    help="the same entries in the map editor's format")
    ap.add_argument("--block", metavar="NAME",
                    help="one palette as a portable prelude block")
    ap.add_argument("--write", action="store_true",
                    help="regenerate every derived file in place")
    ap.add_argument("--check", action="store_true",
                    help="report drift between palettes/ and the generated files")
    args = ap.parse_args()

    if not PALETTES:
        print("no palettes found - expected JSON files in palettes/",
              file=sys.stderr)
        return 1

    if args.emit_js:
        print(emit_js())
        return
    if args.emit_aliases:
        print(emit_aliases())
        return
    if args.emit_refs:
        print(emit_refs())
        return
    if args.emit_mapeditor:
        print(emit_mapeditor())
        print()
        print(emit_mapeditor_aliases())
        return
    if args.block:
        if args.block not in PALETTES:
            print(f"no palette called {args.block!r}; there is "
                  + ", ".join(PALETTES), file=sys.stderr)
            return 1
        print(emit_block(args.block))
        return
    if args.write or args.check:
        written, unchanged = write_generated(dry_run=args.check)
        verb = "would rewrite" if args.check else "wrote"
        for f in written:
            print(f"{verb} {f}")
        for f in unchanged:
            print(f"unchanged {f}")
        if args.check and written:
            print("\nrun: uv run tools/palette_analysis.py --write",
                  file=sys.stderr)
            return 1
        return 0

    out = {}
    for name, src in SOURCES.items():
        mapping, prov, spares = curated(name)
        res = analyse(mapping)
        out[name] = {
            "meta": {k: src[k] for k in ("title", "author", "url", "note")},
            "mapping": mapping, "provenance": prov, "spares": spares,
            "analysis": {k: v for k, v in res.items() if k != "cvd"},
            "cvd_counts": {k: len(v) for k, v in res["cvd"].items()},
        }
        if not args.json:
            report(name, src, mapping, prov, spares, res)

    if args.json:
        json.dump(out, sys.stdout, indent=2)
        print()
    else:
        baseline()


def _run(fn):
    """Run a main() and die quietly when a pipe closes early.

    Without this, `score candidates/ | head` prints a BrokenPipeError traceback
    and exits 1, because Python flushes stdout at shutdown and the flush hits
    the closed pipe. Every one of these tools is meant to be piped into `head`,
    `grep` and `less`, so every one of them needs it. 141 is what a shell
    reports for a process killed by SIGPIPE, which is what a C program doing
    the same thing would give you.
    """
    try:
        code = fn()
    except BrokenPipeError:
        code = 141
    try:
        sys.stdout.flush()
    except BrokenPipeError:
        code = 141
    if code == 141:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
    sys.exit(code)


if __name__ == "__main__":
    _run(main)
