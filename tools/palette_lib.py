"""
Shared colour machinery for the palette tools.

`palette_analysis.py` (the shipped palettes in `palettes/`, their derivation
and the generators) and `palette_curate.py` (rating arbitrary candidates) both import
from here. The point is that there is exactly one copy of the CVD matrices, the
slot list and the WCAG maths: two tools that disagreed about what "contrast" or
"deuteranopia" meant would produce numbers that could not be compared, which
would defeat the whole idea of scoring a candidate against the shipped corpus.

Dependency-free, like the tools that use it, so `uv run` needs no resolution
step.
"""

import colorsys
import json
import os
import re

# --------------------------------------------------------------------- slots

# PuzzleScript's 21 real slots. gray/darkgray/lightgray are spelling aliases and
# are emitted alongside their grey twins, not treated as extra colours.
SLOTS = [
    "black", "white", "grey", "darkgrey", "lightgrey",
    "red", "darkred", "lightred",
    "brown", "darkbrown", "lightbrown",
    "orange", "yellow",
    "green", "darkgreen", "lightgreen",
    "blue", "lightblue", "darkblue",
    "purple", "pink",
]

ALIAS_OF = {"gray": "grey", "darkgray": "darkgrey", "lightgray": "lightgrey"}

# Fallback source, used verbatim wherever a candidate cannot supply a slot.
#
# This is a *compatibility* table, not a lexicon. It is what the engine actually
# substitutes, so it must stay exactly arnecolors. What each slot NAME denotes
# is a separate question with a separate answer - see ANCHOR below.
ARNE = {
    "black": "#000000", "white": "#FFFFFF", "grey": "#9d9d9d",
    "darkgrey": "#697175", "lightgrey": "#cccccc",
    "red": "#be2633", "darkred": "#732930", "lightred": "#e06f8b",
    "brown": "#a46422", "darkbrown": "#493c2b", "lightbrown": "#eeb62f",
    "orange": "#eb8931", "yellow": "#f7e26b",
    "green": "#44891a", "darkgreen": "#2f484e", "lightgreen": "#a3ce27",
    "blue": "#1d57f7", "lightblue": "#B2DCEF", "darkblue": "#1B2632",
    "purple": "#342a97", "pink": "#de65e2",
}

# What each slot NAME denotes - the lexicon the fitter aims at and the rating
# measures drift from. Kept separate from ARNE because those are two different
# jobs that were conflated at first, with measurable consequences.
#
# Using arnecolors as the lexicon is the obvious move and it is wrong, because
# arnecolors is a palette with its own opinions rather than a dictionary. Five
# of its twenty-one colours do not classify as their own name under family()
# above: its `darkgreen` #2f484e is a slate (hue 192, chroma 10), its `darkblue`
# is near-black, its `purple` #342a97 is blue-violet, its `pink` is magenta, its
# `lightbrown` #eeb62f is a golden yellow. Anchoring on that table meant a
# candidate palette whose `darkgreen` was *actually dark green* scored a 75
# degree hue error and lost most of the `role` axis for being correct.
#
# So the anchors are derived instead of invented: for each slot, the MEDOID of
# what the fourteen inherited palettes put there - the one real, shipped colour
# with the smallest total distance to all the others. Nothing is idealised and
# nothing is mine; every anchor below is a colour some palette actually ships
# for that name, and the third field is the mean distance from it to the rest,
# which is how much the corpus disagrees about that name at all.
#
# arnecolors turns out to be the medoid for seven slots - two of them black and
# white, which every palette agrees on - and an outlier by more than 25 dE for
# five: lightbrown, darkgreen, blue, darkblue and purple. That is the honest
# summary: a good lexicon for most names, and quite wrong for a few.
#
# Frozen deliberately rather than recomputed at import, so it is visible in the
# diff, reproducible, and does not silently move every score when somebody adds
# a palette to colors.js. `palette_curate.py anchors` re-derives it and reports
# any drift.
ANCHOR_SOURCE = {
    "black":      ("#000000", "mastersystem", 6.7),
    "white":      ("#ffffff", "mastersystem", 4.6),
    "grey":       ("#7c7c7c", "famicom", 16.8),
    "darkgrey":   ("#444444", "c64", 17.8),
    "lightgrey":  ("#b0b0b0", "atari", 14.4),
    "red":        ("#be2633", "arnecolors", 31.7),
    "darkred":    ("#700014", "atari", 27.2),
    "lightred":   ("#e06f8b", "arnecolors", 34.4),
    "brown":      ("#805020", "atari", 30.7),
    "darkbrown":  ("#493c2b", "arnecolors", 29.7),
    "lightbrown": ("#b58c53", "pastel", 36.3),
    "orange":     ("#eb792d", "pastel", 37.4),
    "yellow":     ("#f7e26b", "arnecolors", 27.6),
    "green":      ("#75bc54", "proteus_rich", 31.0),
    "darkgreen":  ("#2b732c", "pastel", 27.0),
    "lightgreen": ("#90cf5c", "proteus_rich", 31.5),
    "blue":       ("#3f62c6", "whitingjp", 34.5),
    "lightblue":  ("#b2dcef", "arnecolors", 27.3),
    "darkblue":   ("#352879", "c64", 33.6),
    "purple":     ("#6f3d86", "c64", 40.7),
    "pink":       ("#cd88e5", "proteus_rich", 42.3),
}

ANCHOR = {k: v[0] for k, v in ANCHOR_SOURCE.items()}


def derive_anchors(builtins):
    """Re-derive ANCHOR from a corpus. Returns {slot: (hex, palette, spread)}."""
    names = list(builtins)
    out = {}
    for s in SLOTS:
        cands = [(n, builtins[n][s]) for n in names]
        best = min(cands, key=lambda nc: sum(delta_e(nc[1], o[1]) for o in cands))
        spread = sum(delta_e(best[1], o[1]) for o in cands) / max(1, len(cands) - 1)
        out[s] = (best[1].lower(), best[0], round(spread, 1))
    return out


# The ramps, dark -> light. This is the "template of what success looks like":
# within a ramp, luminance must increase, monotonically, every step. A palette
# whose `lightred` is darker than its `red` is not a stylistic choice, it is a
# mapping error, and it is the single most common way a hand-written mapping
# goes wrong. The fitter builds ramps monotonic by construction; `ramp_faults`
# is what checks a mapping somebody else wrote.
RAMPS = {
    "grey":  ["black", "darkgrey", "grey", "lightgrey", "white"],
    "red":   ["darkred", "red", "lightred"],
    "brown": ["darkbrown", "brown", "lightbrown"],
    "green": ["darkgreen", "green", "lightgreen"],
    "blue":  ["darkblue", "blue", "lightblue"],
}

# Slots that are not part of any ramp, and so are judged only on hue fit.
SINGLETS = ["orange", "yellow", "purple", "pink"]

# Which family a slot belongs to, by name.
#
# This has to come from the slot's *name*, never from classifying arnecolors'
# colour for it: arnecolors' `darkgreen` is #2f484e, a slate that classifies as
# a neutral, and its `darkblue` is near-black. Asking "what family is
# ARNE[slot]" therefore answers the wrong question for exactly the dark slots
# that are hardest to fill.
SLOT_FAMILY = {s: fam for fam, slots in RAMPS.items() for s in slots}
SLOT_FAMILY.update({s: s for s in SINGLETS})
SLOT_FAMILY.update({s: "neutral" for s in RAMPS["grey"]})


# ------------------------------------------------------------------- colour ops

def rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def hexof(t):
    r, g, b = (max(0, min(255, int(round(c)))) for c in t)
    return "#%02x%02x%02x" % (r, g, b)


def hsl(h):
    r, g, b = (c / 255 for c in rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, ss, ll


def luminance(h):
    def chan(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(h)
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


CVD = {
    "protanopia": [[0.152286, 1.052583, -0.204868],
                   [0.114503, 0.786281, 0.099216],
                   [-0.003882, -0.048116, 1.051998]],
    "deuteranopia": [[0.367322, 0.860646, -0.227968],
                     [0.280085, 0.672501, 0.047413],
                     [-0.011820, 0.042940, 0.968881]],
    "tritanopia": [[1.255528, -0.076749, -0.178779],
                   [-0.078411, 0.930809, 0.147602],
                   [0.004733, 0.691367, 0.303900]],
}


def simulate(h, matrix):
    r, g, b = rgb(h)
    return tuple(
        max(0, min(255, row[0] * r + row[1] * g + row[2] * b)) for row in matrix
    )


# ----------------------------------------------------------------------- CIELab
#
# HSL is what the original derivation clustered on, and it is fine for "which
# family is this". It is bad at "which of these two is a better `brown`",
# because HSL lightness is not perceptual - a saturated yellow and a saturated
# blue at the same HSL L look nothing alike in brightness. Lab is used wherever
# the tool has to compare two candidate colours for the same slot.

def lab(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb(h))
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29
    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(a, b):
    """CIE76. Not the most accurate metric, but monotonic in the way that
    matters here and short enough to read, which CIEDE2000 is not."""
    return dist(lab(a), lab(b))


def lab_mix(a, b, t):
    """Interpolate in Lab, so a midpoint between two ramp steps lands where the
    eye expects it rather than where sRGB arithmetic puts it."""
    la, lb = lab(a), lab(b)
    mixed = tuple(x + (y - x) * t for x, y in zip(la, lb))
    return lab_to_hex(mixed)


def lab_to_linear(L):
    """Lab -> linear sRGB, unclamped, so callers can test for gamut."""
    ll, aa, bb = L
    fy = (ll + 16) / 116
    fx, fz = fy + aa / 500, fy - bb / 200

    def finv(t):
        return t ** 3 if t ** 3 > 216 / 24389 else (t - 4 / 29) * 108 / 841
    x, y, z = finv(fx) * 0.95047, finv(fy) * 1.0, finv(fz) * 1.08883
    return (x * 3.2404542 + y * -1.5371385 + z * -0.4985314,
            x * -0.9692660 + y * 1.8760108 + z * 0.0415560,
            x * 0.0556434 + y * -0.2040259 + z * 1.0572252)


def in_gamut(L, eps=1e-4):
    return all(-eps <= c <= 1 + eps for c in lab_to_linear(L))


def lab_to_hex(L):
    def enc(c):
        c = max(0.0, min(1.0, c))
        c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
        return c * 255
    return hexof(tuple(enc(c) for c in lab_to_linear(L)))


def relight(h, target_L):
    """The same colour at a different Lab lightness. Used to derive a ramp step
    a source palette does not contain: the result keeps the palette's own hue,
    so it reads as a member of the palette rather than a graft.

    Chroma is reduced until the result fits in sRGB rather than letting the
    conversion clip channels. Clipping is the obvious implementation and it
    silently changes the hue - relighting #7bda1e, a yellow-green, down to L 25
    clips to #006900, a pure green 40 degrees away. A relight that does not
    preserve hue is not a relight, so the chroma gives way instead: a dark
    yellow-green is duller than a bright one, which is true of real pigments
    too and is what the eye expects.
    """
    ll, aa, bb = lab(h)
    target_L = max(0.0, min(100.0, target_L))
    if in_gamut((target_L, aa, bb)):
        return lab_to_hex((target_L, aa, bb))
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        if in_gamut((target_L, aa * mid, bb * mid)):
            lo = mid
        else:
            hi = mid
    return lab_to_hex((target_L, aa * lo, bb * lo))


# ------------------------------------------------------------------- families
#
# Hue windows, widened from the original derivation's FAMILIES so that every
# hue lands somewhere rather than falling into "other". Brown is the awkward
# one: it is not a hue, it is dark low-chroma orange, so it has to be carved
# out of the orange/yellow band by lightness before the rest of the test runs.

NEUTRAL_CHROMA = 12.0   # Lab chroma below this reads as a grey, whatever its hue


def chroma(h):
    _, aa, bb = lab(h)
    return (aa * aa + bb * bb) ** 0.5


def family(h):
    """The slot family a colour could plausibly serve. One of:
    neutral, red, orange, yellow, brown, green, blue, purple, pink."""
    if chroma(h) < NEUTRAL_CHROMA:
        return "neutral"
    hu, sa, li = hsl(h)
    L = lab(h)[0]
    # Brown first: it steals the dark, dull end of the orange/yellow band.
    if 12 <= hu < 55 and L < 62 and sa < 0.85:
        return "brown"
    if hu >= 345 or hu < 12:
        # Pale desaturated reds read as pink, which is a slot of its own.
        return "pink" if L > 70 and sa < 0.75 else "red"
    if 12 <= hu < 42:
        return "orange"
    if 42 <= hu < 70:
        return "yellow"
    if 70 <= hu < 165:
        return "green"
    if 165 <= hu < 255:
        return "blue"
    if 255 <= hu < 310:
        return "purple"
    return "pink" if L > 55 else "purple"


def classify(hexes):
    """Bucket a source palette by family, each bucket sorted dark -> light."""
    out = {}
    for c in hexes:
        out.setdefault(family(c), []).append(c)
    for k in out:
        out[k].sort(key=lambda c: lab(c)[0])
    return out


# --------------------------------------------------------------------- checks

def ramp_faults(mapping):
    """Ramp steps that do not get lighter. Returns (ramp, lower, upper, dL)
    for every adjacent pair whose luminance fails to increase.

    This is the check the rubric was missing: contrast and CVD both measure pairs in
    isolation and neither notices that a ramp runs backwards."""
    faults = []
    for name, slots in RAMPS.items():
        for lo, hi in zip(slots, slots[1:]):
            a, b = lab(mapping[lo])[0], lab(mapping[hi])[0]
            if b <= a:
                faults.append((name, lo, hi, round(b - a, 1)))
    return faults


def ramp_evenness(mapping):
    """How evenly each ramp is spaced, 0..1 per ramp (1 = perfectly even).

    A ramp of #000, #111, #fff is monotonic and still bad: two steps are
    indistinguishable and the third does all the work. Evenness is the ratio of
    the smallest step to the largest, which punishes exactly that."""
    out = {}
    for name, slots in RAMPS.items():
        steps = [lab(mapping[b])[0] - lab(mapping[a])[0]
                 for a, b in zip(slots, slots[1:])]
        if any(s <= 0 for s in steps):
            out[name] = 0.0
        else:
            out[name] = round(min(steps) / max(steps), 3)
    return out


def analyse(mapping, contrast_floor=1.3, cvd_normal=20, cvd_sim=15):
    """The rubric's three original checks plus the two ramp checks."""
    values = [(s, mapping[s]) for s in SLOTS]

    low_contrast = []
    for i, (sa, ca) in enumerate(values):
        for sb, cb in values[i + 1:]:
            r = contrast(ca, cb)
            if r < contrast_floor:
                low_contrast.append((sa, sb, round(r, 3)))

    cvd_flags = {k: [] for k in CVD}
    for i, (sa, ca) in enumerate(values):
        for sb, cb in values[i + 1:]:
            normal = dist(rgb(ca), rgb(cb))
            if normal <= cvd_normal:
                continue
            for kind, matrix in CVD.items():
                sim = dist(simulate(ca, matrix), simulate(cb, matrix))
                if sim < cvd_sim:
                    cvd_flags[kind].append(
                        (sa, sb, round(normal, 1), round(sim, 1)))

    seen = {}
    for s, c in values:
        seen.setdefault(c.lower(), []).append(s)
    dupes = {c: names for c, names in seen.items() if len(names) > 1}

    return {
        "unique": len(seen),
        "low_contrast": sorted(low_contrast, key=lambda t: t[2]),
        "cvd": cvd_flags,
        "cvd_total": sum(len(v) for v in cvd_flags.values()),
        "dupes": dupes,
        "ramp_faults": ramp_faults(mapping),
        "ramp_evenness": ramp_evenness(mapping),
    }


# -------------------------------------------------------------- the built-ins

def load_builtins(path="src/js/colors.js", exclude=()):
    """The shipped palettes, parsed straight out of colors.js.

    `exclude` exists because the fork's own palettes now live in colors.js too.
    Scoring a candidate against a corpus that already contains the fork's
    additions would quietly grade this work against itself; the calibration
    corpus has to stay the fourteen inherited palettes.
    """
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return {}
    body = text[text.index("colorPalettes = {"):]
    out = {}
    for m in re.finditer(r"(\w+)\s*:\s*\{(.*?)\}", body, re.S):
        name, block = m.group(1), m.group(2)
        if name in exclude:
            continue
        pairs = dict(re.findall(r"(\w+)\s*:\s*\"(#[0-9a-fA-F]{6})\"", block))
        if all(s in pairs for s in SLOTS):
            out[name] = {s: pairs[s] for s in SLOTS}
    return out


FORK_START = "--- palette-set extension"
FORK_END = "--- end palette-set extension"


def fork_palettes(path="src/js/colors.js"):
    """The names of the fork's own palettes, read from colors.js's own markers.

    Keeping this as a hardcoded tuple in the curation tool was a small trap: it
    is the list that has to change on exactly the occasion nobody is thinking
    about it, the moment a palette is added. colors.js already brackets the
    fork's entries with comment markers so an upstream merge stays a clean
    diff, so the file can answer the question itself.
    """
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return ()
    names = []
    idx = 0
    while True:
        a = text.find(FORK_START, idx)
        if a < 0:
            break
        b = text.find(FORK_END, a)
        if b < 0:
            break
        block = text[a:b]
        for m in re.finditer(r"(?:^|\n)\s*(?:\d+\s*:\s*\"(\w+)\"|(\w+)\s*:\s*\{)", block):
            names.append(m.group(1) or m.group(2))
        idx = b + 1
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return tuple(out)


def find_colors_js(start=None):
    """Locate src/js/colors.js from wherever the tool was invoked."""
    here = os.path.abspath(start or os.path.dirname(os.path.abspath(__file__)))
    for _ in range(5):
        cand = os.path.join(here, "src", "js", "colors.js")
        if os.path.exists(cand):
            return cand
        here = os.path.dirname(here)
    return "src/js/colors.js"


def find_palette_dir(start=None):
    """Locate the `palettes/` folder from wherever the tool was invoked."""
    here = os.path.abspath(start or os.path.dirname(os.path.abspath(__file__)))
    for _ in range(5):
        cand = os.path.join(here, "palettes")
        if os.path.isdir(cand):
            return cand
        here = os.path.dirname(here)
    return "palettes"


PALETTE_KEYS = ("name", "index", "title", "author", "url", "note",
                "commentary", "slot_notes", "colors", "slots")


def read_palette_file(path):
    """One curated palette file, validated.

    The validation is here rather than in a checker because a malformed file
    would otherwise reach the emitters and be discovered as a broken colors.js,
    which is a much worse place to find out. Everything it rejects is something
    that cannot be rendered: a missing slot, a colour that is not a colour, a
    provenance word nothing downstream understands.
    """
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)

    # A misspelled key is silent otherwise: "colours" instead of "colors"
    # leaves the source colour list empty, and the only symptom is every
    # sourced slot failing the check below for a reason that is not the reason.
    strange = [k for k in doc if k not in PALETTE_KEYS]
    if strange:
        raise ValueError(f"{path}: {', '.join(strange)} is not a palette key; "
                         "expected " + ", ".join(PALETTE_KEYS))

    stem = os.path.splitext(os.path.basename(path))[0]
    name = doc.get("name") or stem
    if name != stem:
        raise ValueError(f"{path}: 'name' is {name!r} but the file is {stem}.json")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
        raise ValueError(f"{path}: {name!r} is not usable as a color_palette name")
    if not isinstance(doc.get("index"), int):
        raise ValueError(f"{path}: 'index' must be the integer alias number")

    slots = doc.get("slots") or {}
    missing = [s for s in SLOTS if s not in slots]
    if missing:
        raise ValueError(f"{path}: no colour for {', '.join(missing)}")
    extra = [s for s in slots if s not in SLOTS]
    if extra:
        raise ValueError(f"{path}: {', '.join(extra)} is not one of the 21 slots")

    clean = {}
    for slot, v in slots.items():
        if isinstance(v, str):
            v = [v, "sourced"]
        hexval, prov = (list(v) + ["sourced"])[:2]
        if not re.fullmatch(r"#[0-9a-f]{6}", str(hexval).lower()):
            raise ValueError(f"{path}: {slot} is {hexval!r}, not a #rrggbb colour")
        if prov not in ("sourced", "added"):
            raise ValueError(f"{path}: {slot} is marked {prov!r}; "
                             "it is either 'sourced' or 'added'")
        clean[slot] = (str(hexval).lower(), prov)

    colors = ["#" + str(c).lstrip("#").lower() for c in (doc.get("colors") or [])]
    for c in colors:
        if not re.fullmatch(r"#[0-9a-f]{6}", c):
            raise ValueError(f"{path}: {c!r} in 'colors' is not a #rrggbb colour")

    # A slot claiming to be the source's must actually be in it. This is the
    # check that keeps "sourced 17/21" an honest number rather than a hope.
    lied = sorted(s for s, (h, p) in clean.items()
                  if p == "sourced" and h not in colors)
    if lied:
        raise ValueError(f"{path}: {', '.join(lied)} claim to be sourced but are "
                         "not in 'colors' - mark them 'added' or add the colour")

    return {
        "name": name,
        "index": doc["index"],
        "title": doc.get("title") or name,
        "author": doc.get("author") or "",
        "url": doc.get("url") or "",
        "note": doc.get("note") or "",
        "commentary": list(doc.get("commentary") or []),
        "slot_notes": dict(doc.get("slot_notes") or {}),
        "colors": colors,
        "slots": clean,
        "path": path,
    }


def load_palette_dir(path=None):
    """Every curated palette, ordered by the alias index it ships under.

    Ordering by `index` rather than by filename is what keeps colors.js, the
    reference blocks and the alias table in one order. They were in three
    different orders before this folder existed, because each was generated
    from a different traversal.
    """
    path = path or find_palette_dir()
    if not os.path.isdir(path):
        return {}
    out = []
    for n in sorted(os.listdir(path)):
        if n.endswith(".json") and not n.startswith("."):
            out.append(read_palette_file(os.path.join(path, n)))
    seen = {}
    for p in out:
        if p["index"] in seen:
            raise ValueError(f"{p['name']} and {seen[p['index']]} both claim "
                             f"alias index {p['index']}")
        seen[p["index"]] = p["name"]
    return {p["name"]: p for p in sorted(out, key=lambda p: p["index"])}



# ------------------------------------------------------------------- ingestion
#
# The formats a "lightweight palette browser" will hand you. Lospec exports
# .hex, .gpl and .pal among others; every one of them is a list of colours with
# at most a name attached, so parsing is deliberately forgiving - if a file
# contains six-digit hex tokens and nothing else makes sense of it, take them.

HEX_TOKEN = re.compile(r"(?<![0-9a-zA-Z])#?([0-9a-fA-F]{6})(?![0-9a-zA-Z])")


def _dedupe(colors):
    seen, out = set(), []
    for c in colors:
        c = "#" + c.lstrip("#").lower()
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def parse_gpl(text):
    """GIMP palette: a header, optional Name:/Columns:, then `R G B  name`."""
    name = author = None
    colors = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            if line.lower().startswith("#author"):
                author = line.split(":", 1)[-1].strip() or None
            continue
        if line.lower().startswith("gimp palette"):
            continue
        if line.lower().startswith("name:"):
            name = line.split(":", 1)[1].strip()
            continue
        if line.lower().startswith("columns:"):
            continue
        parts = line.split()
        if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
            colors.append(hexof(tuple(int(p) for p in parts[:3])))
    return name, author, colors


def parse_jasc(text):
    """JASC-PAL: magic line, version, count, then `R G B` per line."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    colors = []
    for line in lines[3:]:
        parts = line.split()
        if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
            colors.append(hexof(tuple(int(p) for p in parts[:3])))
    return None, None, colors


def parse_json(text):
    """Lospec's JSON shape, and anything close enough to it.

    Lospec serves https://lospec.com/palette-list/<slug>.json as
    {"name": ..., "author": ..., "colors": ["rrggbb", ...]}. Other exporters
    nest the list under "palette" or "swatches", or give objects with a "hex"
    key, so all of those are accepted.
    """
    data = json.loads(text)
    if isinstance(data, list):
        return None, None, _scrape(json.dumps(data))
    name = data.get("name") or data.get("title")
    author = data.get("author") or data.get("creator")
    raw = (data.get("colors") or data.get("palette")
           or data.get("swatches") or [])
    colors = []
    for item in raw:
        if isinstance(item, str):
            colors.append(item)
        elif isinstance(item, dict):
            v = item.get("hex") or item.get("color") or item.get("value")
            if v:
                colors.append(v)
    if not colors:
        colors = _scrape(text)
    return name, author, ["#" + c.lstrip("#").lower() for c in colors]


def _scrape(text):
    return ["#" + m.group(1).lower() for m in HEX_TOKEN.finditer(text)]


def parse_palette(path):
    """Read one palette file in whatever format it happens to be.

    Returns {name, author, url, note, hex}. `hex` is deduplicated and ordered
    as the file ordered it, which for most exports is the author's own ordering
    and is worth preserving for display.
    """
    text = open(path, encoding="utf-8", errors="replace").read()
    ext = os.path.splitext(path)[1].lower()
    stem = os.path.splitext(os.path.basename(path))[0]

    name = author = None
    if ext == ".gpl" or text.lower().lstrip().startswith("gimp palette"):
        name, author, colors = parse_gpl(text)
    elif ext == ".pal" or text.lower().lstrip().startswith("jasc-pal"):
        name, author, colors = parse_jasc(text)
    elif ext == ".json":
        name, author, colors = parse_json(text)
    else:
        colors = _scrape(text)

    colors = _dedupe(colors)
    if not colors:
        raise ValueError(f"no colours found in {path}")
    return {
        "name": name or stem,
        "author": author,
        "url": None,
        "note": None,
        "hex": colors,
        "source_file": path,
        "slug": re.sub(r"[^a-z0-9]+", "", stem.lower()) or "palette",
    }


def load_candidates(paths):
    """Every palette under the given files and directories.

    Returns (candidates, errors). Two things are cleaned up here because both
    happen the moment you download real palettes rather than construct test
    ones, and both corrupt the results quietly rather than loudly:

    Duplicate slugs. Verdicts are keyed by slug, and the slug comes from the
    filename, so `benten-pond.hex` and `benten-pond.gpl` - which is exactly
    what you get if you click two download buttons on one Lospec page - would
    share a verdict and overwrite each other's.

    Duplicate palettes. The same colours arriving twice under two filenames
    would be fitted, rated and ranked twice, which inflates the candidate count
    and puts the same palette in two places in the reading queue. The second
    copy is dropped and reported, rather than silently merged.
    """
    exts = {".hex", ".gpl", ".pal", ".json", ".txt", ".css"}
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, names in os.walk(p):
                for n in sorted(names):
                    if os.path.splitext(n)[1].lower() in exts:
                        files.append(os.path.join(root, n))
        else:
            files.append(p)

    out, errors = [], []
    by_colours, slugs = {}, {}
    for f in files:
        try:
            cand = parse_palette(f)
        except (OSError, ValueError, json.JSONDecodeError) as e:
            errors.append((f, str(e)))
            continue

        key = tuple(sorted(cand["hex"]))
        if key in by_colours:
            errors.append((f, "same colours as "
                           + os.path.basename(by_colours[key]) + "; skipped"))
            continue
        by_colours[key] = f

        slug = cand["slug"]
        if slug in slugs:
            n = 2
            while f"{slug}{n}" in slugs:
                n += 1
            cand["slug"] = f"{slug}{n}"
            errors.append((f, f"slug '{slug}' already used by "
                           + os.path.basename(slugs[slug])
                           + f"; filed as '{cand['slug']}'"))
        slugs[cand["slug"]] = f
        out.append(cand)
    return out, errors
