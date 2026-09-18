"""
Shared colour machinery for the palette tools.

`palette_analysis.py` (the three shipped palettes, their derivation and the
generators) and `palette_curate.py` (rating arbitrary candidates) both import
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

# Fallback source, used verbatim wherever a candidate cannot supply a slot, and
# the anchor set the fitter aims at: arnecolors is what PuzzleScript means by
# each of these names, so it defines each slot's *role* even when a candidate
# palette expresses that role in a completely different register.
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


def lab_to_hex(L):
    ll, aa, bb = L
    fy = (ll + 16) / 116
    fx, fz = fy + aa / 500, fy - bb / 200

    def finv(t):
        return t ** 3 if t ** 3 > 216 / 24389 else (t - 4 / 29) * 108 / 841
    x, y, z = finv(fx) * 0.95047, finv(fy) * 1.0, finv(fz) * 1.08883
    r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
    g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
    b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252

    def enc(c):
        c = max(0.0, min(1.0, c))
        c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
        return c * 255
    return hexof((enc(r), enc(g), enc(b)))


def relight(h, target_L):
    """The same colour at a different Lab lightness. Used to derive a ramp step
    a source palette does not contain: the result keeps the palette's own hue
    and chroma, so it reads as a member of the palette rather than a graft."""
    ll, aa, bb = lab(h)
    return lab_to_hex((max(0.0, min(100.0, target_L)), aa, bb))


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


def find_colors_js(start=None):
    """Locate src/js/colors.js from wherever the tool was invoked."""
    here = os.path.abspath(start or os.path.dirname(os.path.abspath(__file__)))
    for _ in range(5):
        cand = os.path.join(here, "src", "js", "colors.js")
        if os.path.exists(cand):
            return cand
        here = os.path.dirname(here)
    return "src/js/colors.js"


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
    """Every palette under the given files and directories."""
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
    for f in files:
        try:
            out.append(parse_palette(f))
        except (OSError, ValueError, json.JSONDecodeError) as e:
            errors.append((f, str(e)))
    return out, errors
