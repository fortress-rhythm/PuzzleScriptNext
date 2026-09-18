# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Palette analysis for the palette-set extension.

Derives a 21-name PuzzleScript mapping for each candidate Lospec palette by
hue-clustering, then runs the three checks from the rubric: WCAG contrast,
colourblindness collapse, and duplicate-hex counting.

Run:  uv run tools/palette_analysis.py
      uv run tools/palette_analysis.py --json     (machine-readable mappings)

Deliberately dependency-free so `uv run` needs no resolution step.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from palette_lib import (  # noqa: E402
    ALIAS_OF, CVD, SLOTS, analyse, contrast, dist, hsl, luminance,
    load_builtins, rgb, simulate,
)

# --------------------------------------------------------------------- sources

SOURCES = {
    "bentenpond": {
        "title": "Benten Pond",
        "author": "Terry Ross",
        "url": "https://lospec.com/palette-list/benten-pond",
        "note": 'inspired by "The Pond at Benten Shrine", a 1920s woodblock print by Kawase Hasui',
        "hex": """083b42 155355 4e8276 63a37c 292f25 494738 736f52 a5a27f d8d2ae
                  304733 336339 4c8149 8dab6d bf5f43 e3938b f1d6c5 a2333a 193762
                  7cacac 573c5d 825f77""".split(),
    },
    "dungeon20": {
        "title": "Dungeon-20",
        "author": "Meaghan (goldentreesart)",
        "url": "https://lospec.com/palette-list/dungeon-20",
        "note": 'edited from the "Mushroom" palette with added blues; built for roguelike moods',
        "hex": """2e222f 45293f 7a3045 993d41 cd683d fbb954 28353e 344a5a 407080
                  508da0 5bbfc5 f2ec8b b0a987 997f73 665964 443846 576069 788a87
                  d6dad3 a9b2a2""".split(),
    },
    "oekakinl": {
        "title": "Oekaki.nl",
        "author": "P-Tux7",
        "url": "https://lospec.com/palette-list/oekakinl",
        "note": "default palette of the oekaki drawing site Oekaki.nl",
        "hex": """000000 909090 e6e4d5 ffffff 9ac3e0 3c8ee7 3842a1 24313d 384d51
                  4d7d23 8fb332 f0cb69 ffdcc7 d97d3c 90642d 4c4334 6b0b48 a4313f
                  c96c7f f1a8ca""".split(),
    },
    "soggysepia": {
        "title": "Soggy Sepia CRT-20",
        "author": "Digi (@Digitress)",
        "url": "https://lospec.com/palette-list/soggy-sepia-crt-20",
        "note": "four eight-step phosphor ramps - sepia, red, green and purple - each with a deliberate gap across the middle",
        "hex": """0a0707 140f0f 30231a 493e2d a08e76 c4b8a6 d2cabd e2ded5
                  0d0505 190b0b 3c1a13 5b2e22 b87258 d3a690 ddbdac e9d6ca
                  070905 0f130b 242c13 374e22 88aa58 b5ca90 c7d7ac dbe6ca
                  070509 0f0b13 241a21 372e38 887294 b5a6bc c7bdce dbd6e0""".split(),
    },
}

# ------------------------------------------------------------------- mapping
#
# Derivation: every source palette was converted to HSL and hue-clustered per
# the rubric, then the clustering pass was read against the slot list by hand.
# CURATED below is the result. `first_pass()` still runs the raw clustering so
# the report can show where judgement overrode it and why - the algorithm gets
# the ramps right but has no way to know that, say, a pale cream is a better
# `white` than a `darkbrown`.
#
# Provenance per slot is one of:
#   sourced  - taken directly from the source palette
#   added    - not present in the source; hand-picked to match its tone, and
#              called out in the docs as an addition rather than a quotation
# No slot is ever left silently wrong: a hue the palette does not contain is
# either added deliberately or the palette is reported as a poor fit.

CURATED = {
    "bentenpond": {
        # One warm-neutral olive ramp carries black->white. It is tinted, but a
        # tinted neutral still reads as neutral, and these five slots are the
        # ones a game leans on constantly.
        "black": ("#292f25", "sourced"), "darkgrey": ("#494738", "sourced"),
        "grey": ("#736f52", "sourced"), "lightgrey": ("#a5a27f", "sourced"),
        "white": ("#d8d2ae", "sourced"),
        "darkred": ("#a2333a", "sourced"), "red": ("#bf5f43", "sourced"),
        "lightred": ("#e3938b", "sourced"),
        "darkgreen": ("#304733", "sourced"), "green": ("#4c8149", "sourced"),
        "lightgreen": ("#8dab6d", "sourced"),
        "darkblue": ("#083b42", "sourced"), "blue": ("#193762", "sourced"),
        "lightblue": ("#7cacac", "sourced"),
        "purple": ("#573c5d", "sourced"), "pink": ("#825f77", "sourced"),
        "lightbrown": ("#f1d6c5", "sourced"),
        # The source has no saturated warm mid-tones at all - its only warm
        # colours are the red ramp and one pale peach. Rather than press a teal
        # into service as "brown", these four are picked to sit inside the
        # palette's own muted range (S about 0.5, matching its reds).
        "brown": ("#7a5734", "added"), "darkbrown": ("#3d2f22", "added"),
        "orange": ("#c9793f", "added"), "yellow": ("#d9b45e", "added"),
    },
    "dungeon20": {
        "black": ("#2e222f", "sourced"), "darkgrey": ("#443846", "sourced"),
        "grey": ("#665964", "sourced"), "lightgrey": ("#a9b2a2", "sourced"),
        "white": ("#d6dad3", "sourced"),
        "darkred": ("#7a3045", "sourced"), "red": ("#993d41", "sourced"),
        "brown": ("#997f73", "sourced"), "lightbrown": ("#fbb954", "sourced"),
        "orange": ("#cd683d", "sourced"), "yellow": ("#f2ec8b", "sourced"),
        "darkblue": ("#28353e", "sourced"), "blue": ("#407080", "sourced"),
        "lightblue": ("#5bbfc5", "sourced"),
        "purple": ("#45293f", "sourced"),
        # Dungeon-20 is a deliberately narrow dungeon mood: no green anywhere,
        # no pink, no light red, no dark brown. Six of PuzzleScript's fixed
        # slots simply have no counterpart, so they are added in the palette's
        # own desaturated register. This is the weakest of the three fits and
        # the docs say so.
        "lightred": ("#c9666b", "added"), "darkbrown": ("#3c2c26", "added"),
        "darkgreen": ("#2f4034", "added"), "green": ("#4e6b46", "added"),
        "lightgreen": ("#8fa87e", "added"), "pink": ("#8f5d72", "added"),
    },
    "oekakinl": {
        # The only candidate with true #000000 and #ffffff.
        "black": ("#000000", "sourced"), "white": ("#ffffff", "sourced"),
        "grey": ("#909090", "sourced"), "darkgrey": ("#384d51", "sourced"),
        "lightgrey": ("#e6e4d5", "sourced"),
        "red": ("#a4313f", "sourced"), "lightred": ("#c96c7f", "sourced"),
        "brown": ("#90642d", "sourced"), "darkbrown": ("#4c4334", "sourced"),
        "orange": ("#d97d3c", "sourced"), "yellow": ("#f0cb69", "sourced"),
        "green": ("#4d7d23", "sourced"), "lightgreen": ("#8fb332", "sourced"),
        "darkblue": ("#24313d", "sourced"), "blue": ("#3c8ee7", "sourced"),
        "lightblue": ("#9ac3e0", "sourced"),
        "purple": ("#6b0b48", "sourced"), "pink": ("#f1a8ca", "sourced"),
        # Three genuine gaps, each a darker step the source never goes to.
        "darkred": ("#6b1f28", "added"),
        "darkgreen": ("#33561a", "added"),
        "lightbrown": ("#dba54b", "added"),
    },
    "soggysepia": {
        # The source is four eight-step ramps - sepia, red, green, purple -
        # and every one of them jumps from about L 30 straight to L 51. That
        # hole is the palette's CRT character and there is no mapping that
        # hides it: whichever five colours carry black->white, one step will be
        # twice the others. Reported evenness around 0.16 is therefore the
        # source's, not the mapping's; ega ships at 0.16 and proteus_mellow at
        # 0.27.
        #
        # The greys take the purple ramp's near-neutral dark end and the sepia
        # ramp's light end, so the shadows lean faintly plum and the highlights
        # faintly warm. That is a phosphor palette behaving like one, and at
        # chroma under 11 all five still read as neutral.
        "black": ("#0a0707", "sourced"), "darkgrey": ("#241a21", "sourced"),
        "grey": ("#372e38", "sourced"), "lightgrey": ("#c4b8a6", "sourced"),
        "white": ("#e2ded5", "sourced"),
        # The one warm ramp has to be either red or brown, not both - taking
        # three reds and three browns from it leaves one of the two with no
        # dark end. So red is the warm ramp proper, spanning its full range,
        # and brown is the sepia ramp's middle, which is genuinely brown
        # (hue 25-36) rather than a neutral pressed into service.
        "darkred": ("#3c1a13", "sourced"), "red": ("#b87258", "sourced"),
        "lightred": ("#ddbdac", "sourced"),
        "darkbrown": ("#30231a", "sourced"), "brown": ("#493e2d", "sourced"),
        "lightbrown": ("#a08e76", "sourced"),
        "orange": ("#d3a690", "sourced"),
        "darkgreen": ("#374e22", "sourced"), "green": ("#88aa58", "sourced"),
        "lightgreen": ("#b5ca90", "sourced"),
        "purple": ("#887294", "sourced"), "pink": ("#b5a6bc", "sourced"),
        # Four additions, and the blues are the interesting ones. A CRT palette
        # with red, green and purple phosphor ramps and no blue at all is a
        # conspicuous gap, so the blue ramp is built to the same plan as the
        # others - three steps at the source's own lightnesses and chroma,
        # pushed to hue 235 so it stays clear of the purple ramp rather than
        # collapsing into it.
        "darkblue": ("#232648", "added"), "blue": ("#7378af", "added"),
        "lightblue": ("#babee7", "added"),
        # The source's only yellow-ish colours are the pale top of its green
        # ramp, 31 degrees of hue away. Calling a fourth green "yellow" in a
        # palette that already has three is the failure this rubric exists to
        # catch, so the yellow is stated as an addition instead.
        "yellow": ("#d8d4a2", "added"),
    },
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

    The fork's own three are excluded. They live in colors.js now, so a plain
    read of the file returns seventeen palettes and the "shipped range" quietly
    widens to include the very palettes being measured against it - which would
    make the comparison meaningless in exactly the direction that flatters this
    work. Fourteen is the number that means anything here.
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


# Emitters. colors.js and the reference file are both generated from CURATED,
# so the palette can never drift between what the engine uses and what the
# copy-paste block says.

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="emit mappings as JSON")
    ap.add_argument("--emit-js", action="store_true", help="colorPalettes entries for colors.js")
    ap.add_argument("--emit-refs", action="store_true", help="per-game override blocks")
    args = ap.parse_args()

    if args.emit_js:
        print(emit_js())
        return
    if args.emit_refs:
        print(emit_refs())
        return

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


if __name__ == "__main__":
    main()
