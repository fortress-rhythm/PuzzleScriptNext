# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Palette curation for the palette-set extension.

`palette_analysis.py` documents and generates the palettes that were *already*
chosen. This tool is the stage before that: point it at a pile of candidate
palettes and it fits each one to PuzzleScript's 21 slots, rates it against the
fourteen inherited palettes, and lays the results out for a human to judge.

It does not decide anything. The rating exists to order a reading queue and to
make the failure modes visible - a ramp that runs backwards, a slot with no
plausible source colour, two objects that vanish into each other under
deuteranopia. The choice stays yours, and `verdict` is where you record it.

    uv run tools/palette_curate.py score  candidates/          rank them
    uv run tools/palette_curate.py compare candidates/          both modes at once
    uv run tools/palette_curate.py show   candidates/foo.hex   one in detail
    uv run tools/palette_curate.py sheet  candidates/ -o s.html   look at them
    uv run tools/palette_curate.py combos candidates/          who fills whose gaps
    uv run tools/palette_curate.py audit                       check what ships
    uv run tools/palette_curate.py anchors                     the slot-name lexicon
    uv run tools/palette_curate.py verdict foo accept -m "..."  record a decision
    uv run tools/palette_curate.py emit-curated candidates/foo.hex

Accepts .hex, .gpl, .pal, .json and any text file with hex codes in it, which
between them covers what Lospec, Coolors, GIMP and Aseprite export.

Dependency-free, so `uv run` needs no resolution step.
"""

import argparse
import html
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from palette_lib import (  # noqa: E402
    ALIAS_OF, ANCHOR, ANCHOR_SOURCE, ARNE, RAMPS, SINGLETS, SLOTS, CVD,
    NEUTRAL_CHROMA, SLOT_FAMILY, analyse, chroma, classify, contrast, delta_e,
    derive_anchors, dist, family, find_colors_js, hsl, lab, lab_mix,
    lab_to_hex, load_builtins,
    load_candidates, relight, rgb, simulate,
)

VERDICT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "palette_verdicts.json")

# The fork's own palettes live in colors.js now, so they have to be kept out of
# the calibration corpus - grading a candidate against a corpus that contains
# this work would be grading it against itself.
FORK_PALETTES = ("bentenpond", "dungeon20", "oekakinl")


# ----------------------------------------------------------------------- fitting
#
# The fitter's one rule is that it never silently invents. Every slot comes back
# labelled with where it came from:
#
#   sourced  - a colour the palette actually contains
#   derived  - built from the palette's own colours: a midpoint between two of
#              them, or one of them relit to a different lightness
#   standin  - a colour the palette contains, deliberately used for a slot it
#              does not match: `green` filled with a teal (fit-palette only)
#   added    - the palette has nothing in this family at all, so the slot is
#              synthesised at the ANCHOR hue and the palette's own chroma
#
# `derived` is the interesting middle case. A palette with two greens can carry
# three green slots honestly; a palette with no green at all cannot, and saying
# so is more useful than quietly producing a green.
#
# ------------------------------------------------------------------ two modes
#
# `standin` exists because "does this palette fit" is really two questions, and
# which one you want depends on what you are going to do with the palette.
#
# The two modes are named for what they fit TO, and they differ in exactly one
# place: what happens when a hue family is absent from the source AND no
# neighbouring family is within BORROW_HUE_MAX of it. Everything else - family
# classification, interpolating short ramps, relighting, the hue-capped borrow -
# is identical. The names deliberately claim nothing about quality, because
# quality is what the six axes are for, and they frequently disagree.
#
#   fit-colourname  - the slot name wins. `green` is green; a missing green is
#                     synthesised at the anchor hue and marked `added`. The
#                     palette is extended to satisfy the names.
#
#   fit-palette     - the palette wins. Only the source's own colours are used,
#                     so a missing green becomes another family renamed and
#                     marked `standin`. The names are reinterpreted to fit the
#                     palette.
#
# Neither is "verbatim": both still interpolate and relight within a family
# that exists, so fit-palette is not a promise that nothing was touched.
#
# The distinction is not academic: slot names are PuzzleScript's *authoring*
# surface. Someone writing a sprite legend types `green` because the grass is
# green. Under fit-palette the board still renders coherently, but the author's
# mental model no longer matches the screen - so fit-palette suits a palette you
# author with from the start, and fit-colourname suits one you drop into a game
# already written against arnecolors. A palette can be excellent under one
# reading and a poor fit under the other, which is why `role` is reported in
# both modes and only *scored* under fit-colourname.

# Where a family may borrow from when it is empty. Borrowing is a real curation
# move - a dark orange genuinely is a brown - but it is always recorded.
FALLBACK = {
    "brown":  ["orange", "yellow", "red"],
    "orange": ["brown", "yellow", "red"],
    "yellow": ["orange", "brown", "green"],
    "pink":   ["red", "purple"],
    "purple": ["pink", "blue", "red"],
    "red":    ["orange", "pink", "purple"],
    "blue":   ["purple", "green"],
    "green":  [],          # nothing else reads as green; see dungeon20
}

MIN_STEP = 4.0    # Lab L units a ramp must climb per step to read as a step


def register(hexes):
    """The palette's own character: the chroma a synthesised colour must have
    to belong here. A muted palette gets muted additions."""
    chromatic = [c for c in hexes if chroma(c) >= 12]
    if not chromatic:
        return 20.0
    vals = sorted(chroma(c) for c in chromatic)
    return vals[len(vals) // 2]


def synth(slot, reg):
    """A colour for a slot the palette cannot supply: the anchor's hue and
    lightness, the candidate's own saturation, so the addition sits inside the
    palette's range instead of shouting."""
    L, a, b = lab(ANCHOR[slot])
    c = (a * a + b * b) ** 0.5
    if c < 1e-6:
        return lab_to_hex((L, 0.0, 0.0))
    scale = reg / c
    return lab_to_hex((L, a * scale, b * scale))


def hue_gap(a, b):
    d = abs(hsl(a)[0] - hsl(b)[0]) % 360
    return min(d, 360 - d)


def pick_nearest(pool, slot, used=()):
    """The pool member that best plays this slot: mostly hue, partly lightness.

    Colours already spoken for are skipped rather than penalised. Two slots
    sharing a hex is not automatically wrong - three of the fourteen inherited
    palettes do it - but it should be a decision somebody made, not a thing the
    fitter did because it never looked.
    """
    free = [c for c in pool if c not in used]
    if not free:
        return None
    anchor = ANCHOR[slot]
    aL = lab(anchor)[0]
    return min(free, key=lambda c: hue_gap(c, anchor) + 0.5 * abs(lab(c)[0] - aL))


def spread(colors, k):
    """k colours spanning a sorted pool, evenly spaced by lightness.

    Spacing by *position* in the pool is the obvious implementation and it is
    wrong: a palette with four dark blues and one pale one would hand back four
    darks and a jump. Spacing by lightness value picks the colours that land
    nearest an even ramp, which is what the eye is actually reading.
    """
    n = len(colors)
    if n <= k:
        return list(colors)
    lo, hi = lab(colors[0])[0], lab(colors[-1])[0]
    out, taken = [], set()
    for i in range(k):
        target = lo + (hi - lo) * i / (k - 1)
        free = [c for c in colors if c not in taken]
        pick = min(free, key=lambda c: abs(lab(c)[0] - target))
        out.append(pick)
        taken.add(pick)
    out.sort(key=lambda c: lab(c)[0])
    return out


def enforce_monotonic(chosen):
    """Force a ramp to climb. Returns (colours, indices it had to change).

    The pickers already order by lightness, so this only fires on a palette
    with two colours at the same L - but when it fires, the alternative is a
    ramp with an invisible step in it.

    Two passes, because one is not enough. Pushing each step up to clear the
    one below it fails at the top: if the ramp is already near L 100 there is
    no headroom, the push clamps, and the ramp still does not climb. So a
    second pass walks back down and makes room underneath instead. A ramp that
    cannot rise at the top must descend at the bottom.

    Which indices changed matters to the caller: a colour that has been relit
    is no longer the source's colour, and calling it `sourced` would overstate
    every "sourced 17/21" figure in the reports.
    """
    out = list(chosen)
    changed = set()
    for i in range(1, len(out)):
        target = lab(out[i - 1])[0] + MIN_STEP
        if lab(out[i])[0] < target and target <= 100.0:
            out[i] = relight(out[i], target)
            changed.add(i)
    for i in range(len(out) - 2, -1, -1):
        target = lab(out[i + 1])[0] - MIN_STEP
        if lab(out[i])[0] > target and target >= 0.0:
            out[i] = relight(out[i], target)
            changed.add(i)
    return out, changed


def farthest(pool, assigned, k=1):
    """The k pool members that sit furthest from everything already assigned.

    Greedy farthest-point selection. Under fit-palette this is the whole game:
    if a slot cannot have the right hue, the next best thing it can have is a
    hue nothing else is using, because what a player actually needs is to tell
    two objects apart.
    """
    chosen, taken = [], list(assigned)
    free = [c for c in pool]
    for _ in range(min(k, len(free))):
        pick = max(free, key=lambda c: min((delta_e(c, a) for a in taken),
                                           default=1e9))
        chosen.append(pick)
        taken.append(pick)
        free.remove(pick)
    return chosen


def standin_family(fams, used, assigned, want):
    """Under fit-palette, the source family that best stands in for a missing one.

    Picking the individually most-distinct colours is the obvious thing and it
    produces nonsense: a "green" ramp of cyan, orange and pale yellow is three
    slots that are easy to tell apart and is not a ramp, so a game shading one
    object across darkgreen/green/lightgreen gets three unrelated hues. A
    stand-in has to be a *family* - one coherent hue with the wrong name - so
    the ramp still ramps. Candidates are scored on lightness range, how many
    colours they have spare, and how far they sit from what is already placed.
    """
    best, best_score, best_name = None, -1.0, None
    for name, pool in fams.items():
        free = [c for c in pool if c not in used]
        if len(free) < 2:
            continue
        sep = (min(delta_e(c, a) for c in free for a in assigned)
               if assigned else 100.0)
        score = span(free) + len(free) * 4 + sep
        if score > best_score:
            best, best_score, best_name = free, score, name
    return best, best_name


def fit_ramp(slots, pool, reg, donor_note=None, standin_note=None):
    """Fill a ramp's slots from a pool, dark to light, monotonic by construction."""
    k = len(slots)
    prov, notes = {}, {}

    if not pool:
        # Synthesising each slot from its own arnecolors anchor looks right and
        # is not: arnecolors' `darkgreen` is a slate and its `darkblue` is
        # near-black, so a ramp built that way changes hue as it climbs. Take
        # the hue from the ramp's middle slot and vary only lightness, so the
        # three steps are at least recognisably the same colour.
        base = slots[len(slots) // 2]
        seed = synth(base, reg)
        # Endpoints from the anchors, spacing even between them. The anchors are
        # medoids picked per slot independently, so they are monotonic but not
        # evenly spaced - the corpus's typical `green` (L 70) sits close to its
        # typical `lightgreen` (L 77). Inheriting that would invent a ramp with
        # two near-identical steps, which is the very thing ramp_evenness exists
        # to catch. When the ramp is being invented outright there is no reason
        # to reproduce the corpus's crowding, only its range.
        lo = lab(ANCHOR[slots[0]])[0]
        hi = lab(ANCHOR[slots[-1]])[0]
        chosen = [relight(seed, lo + (hi - lo) * i / (k - 1)) for i in range(k)]
        for s in slots:
            prov[s] = "added"
            notes[s] = "no colour of this family in the source"
        fixed, _ = enforce_monotonic(chosen)
        return dict(zip(slots, fixed)), prov, notes

    if len(pool) >= k:
        chosen = spread(pool, k)
        for s in slots:
            prov[s] = "sourced"
            if standin_note:
                prov[s] = "standin"
                notes[s] = standin_note
            elif donor_note:
                prov[s] = "derived"
                notes[s] = donor_note
    elif len(pool) == 1:
        base = pool[0]
        L = lab(base)[0]
        # One colour has to carry the whole ramp: keep it in the middle and
        # build the ends off it so the hue stays the palette's own. Each step
        # moves a fixed *fraction* of the remaining distance to black or white
        # rather than a fixed amount, so neither end can be driven to L 0 or
        # L 100, where every hue collapses to the same colour.
        mid = k // 2
        chosen = []
        for i in range(k):
            if i == mid:
                chosen.append(base)
            elif i < mid:
                chosen.append(relight(base, L * (0.55 ** (mid - i))))
            else:
                chosen.append(relight(base, L + (100 - L) * (1 - 0.55 ** (i - mid))))
        for i, s in enumerate(slots):
            prov[s] = "sourced" if i == mid else "derived"
            if i != mid:
                notes[s] = f"relit from {base}"
            elif donor_note:
                prov[s], notes[s] = "derived", donor_note
    else:
        # Anchor the source colours at their lightness rank and interpolate the
        # gaps, so every slot is either a real colour or strictly between two.
        idx = [round(i * (k - 1) / (len(pool) - 1)) for i in range(len(pool))]
        chosen = [None] * k
        for c, i in zip(pool, idx):
            chosen[i] = c
        for i in range(k):
            if chosen[i] is not None:
                continue
            lo = max(j for j in idx if j < i) if any(j < i for j in idx) else None
            hi = min(j for j in idx if j > i) if any(j > i for j in idx) else None
            if lo is not None and hi is not None:
                chosen[i] = lab_mix(chosen[lo], chosen[hi], (i - lo) / (hi - lo))
            elif hi is not None:
                base = chosen[hi]
                chosen[i] = relight(base, lab(base)[0] * (0.55 ** (hi - i)))
            else:
                base = chosen[lo]
                bL = lab(base)[0]
                chosen[i] = relight(base, bL + (100 - bL) * 0.45 * (i - lo))
        for i, s in enumerate(slots):
            if i in idx:
                prov[s] = "standin" if standin_note else (
                    "derived" if donor_note else "sourced")
                if standin_note or donor_note:
                    notes[s] = standin_note or donor_note
            else:
                prov[s] = "derived"
                notes[s] = "interpolated between the source's own steps"

    fixed, nudged = enforce_monotonic(chosen)
    # A relit colour is not the source's colour any more, whatever it was a
    # moment ago, so it stops counting as sourced.
    for i in nudged:
        s = slots[i]
        if prov[s] in ("sourced", "standin"):
            prov[s] = "derived"
            notes[s] = (f"relit from {chosen[i]} so the ramp keeps climbing"
                        + (f"; {notes[s]}" if s in notes else ""))
    return dict(zip(slots, fixed)), prov, notes


NEUTRAL_RAMP_CHROMA = 22.0   # muted enough to serve as a grey
HUE_CLUSTER = 35.0           # degrees within which colours read as one ramp


def span(colors):
    Ls = [lab(c)[0] for c in colors]
    return max(Ls) - min(Ls) if Ls else 0.0


def neutral_pool(hexes, fams):
    """The greys, or the nearest thing the palette has to greys.

    Plenty of good palettes contain no true neutral at all - their darks and
    lights are tinted olive or blue. A tinted neutral still reads as neutral
    once it is the only neutral on screen, so rather than declare five gaps,
    the fitter looks for the palette's most grey-ish *ramp*.

    Picking the five least saturated colours outright is the obvious approach
    and it fails badly: on a palette whose muted colours are scattered across
    teal, olive and green it returns five colours of three different hues
    bunched at the dark end, which is neither neutral nor a ramp. What the eye
    wants is one hue family, low chroma, spanning as much lightness as
    possible - so candidate ramps are scored on exactly that, with true
    neutrals joining every cluster since they belong to no hue.
    """
    true_neutral = fams.get("neutral", [])
    if len(true_neutral) >= 4 and span(true_neutral) >= 45:
        return true_neutral, None

    muted = [c for c in hexes if chroma(c) <= NEUTRAL_RAMP_CHROMA]
    if not muted:
        muted = sorted(hexes, key=chroma)[:5]

    best, best_score = None, -1.0
    for seed in muted:
        if chroma(seed) < NEUTRAL_CHROMA:
            continue                       # neutrals seed nothing; they join
        cluster = [c for c in muted
                   if chroma(c) < NEUTRAL_CHROMA or hue_gap(c, seed) <= HUE_CLUSTER]
        # Lightness range is what makes a ramp usable; member count breaks ties,
        # damped so a crowded but short cluster cannot beat a long one.
        score = span(cluster) * len(cluster) ** 0.5
        if score > best_score:
            best, best_score = cluster, score
    if true_neutral and span(true_neutral) * len(true_neutral) ** 0.5 > best_score:
        best = true_neutral

    if not best:
        best = sorted(hexes, key=chroma)[:5]
    best = sorted(set(best), key=lambda c: lab(c)[0])
    hues = [round(hsl(c)[0]) for c in best if chroma(c) >= NEUTRAL_CHROMA]
    note = ("no true neutral ramp in the source; using its most muted "
            + (f"hue-{min(hues)}-{max(hues)} " if hues else "")
            + "colours as the black-to-white ramp")
    return best, note


RELIGHT_SLACK = 15.0   # Lab L a singlet may drift from its slot before correction

# How far round the hue circle a borrowed colour may sit from the slot it is
# standing in for. Past this it stops being a substitute and starts being a
# misnomer: relighting a mid green does not produce a yellow, it produces a
# pale green called `yellow`, which is worse than admitting the gap and
# synthesising one. This is the guard against the failure the derivation notes
# warned about - the clusterer cheerfully making a pale cream your `darkbrown`.
BORROW_HUE_MAX = 45.0


def fit(hexes, mode="fit-colourname"):
    """Propose a 21-slot mapping. Returns (mapping, provenance, notes, spares).

    Slots are filled in order of how constrained they are - the grey ramp first,
    since it needs five colours and a palette rarely has a second candidate for
    it, then the three-step ramps, then the singles. Each stage claims the
    colours it uses, so a later stage sees what is genuinely left.

    `mode` is fit-colourname or fit-palette; see the note at the top of this
    section.
    """
    fams = classify(hexes)
    reg = register(hexes)
    mapping, prov, notes = {}, {}, {}
    used = set()

    def standins():
        return [c for c in hexes if c not in used] if mode == "fit-palette" else None

    pool, neutral_note = neutral_pool(hexes, fams)
    m, p, n = fit_ramp(RAMPS["grey"], pool, reg)
    mapping.update(m); prov.update(p); notes.update(n)
    used.update(c for s, c in m.items() if p[s] == "sourced")
    if neutral_note:
        for s in RAMPS["grey"]:
            notes.setdefault(s, neutral_note)

    # Two passes. A ramp whose own family exists must claim it before any
    # stand-in runs, or a missing `green` will help itself to the blues and
    # leave `blue` deriving from the leftovers - the palette loses a real ramp
    # to fill a fictional one.
    ramp_families = ("red", "brown", "green", "blue")
    deferred = []
    for fam_name in ramp_families:
        pool, donor_note = fams.get(fam_name, []), None
        free = [c for c in pool if c not in used]
        if free:
            pool = free
        elif not pool:
            for donor in FALLBACK[fam_name]:
                donor_free = [c for c in fams.get(donor, []) if c not in used]
                if not donor_free:
                    continue
                if min(hue_gap(c, ANCHOR[fam_name]) for c in donor_free) > BORROW_HUE_MAX:
                    continue
                pool = donor_free
                donor_note = f"borrowed from the source's {donor}s"
                break
        if not pool and mode == "fit-palette":
            deferred.append(fam_name)
            continue
        m, p, n = fit_ramp(RAMPS[fam_name], pool, reg, donor_note)
        mapping.update(m); prov.update(p); notes.update(n)
        used.update(c for s, c in m.items() if p[s] in ("sourced", "standin"))

    for fam_name in deferred:
        pool, donor_fam = standin_family(fams, used, list(mapping.values()),
                                         fam_name)
        standin_note = None
        if pool:
            standin_note = (f"the source has no {fam_name}; this ramp is "
                            f"its {donor_fam}s, renamed")
        m, p, n = fit_ramp(RAMPS[fam_name], pool or [], reg, None, standin_note)
        mapping.update(m); prov.update(p); notes.update(n)
        used.update(c for s, c in m.items() if p[s] in ("sourced", "standin"))

    for slot in SINGLETS:
        pool, donor_note = fams.get(slot, []), None
        pick = pick_nearest(pool, slot, used) if pool else None
        if pick is None:
            for donor in FALLBACK[slot]:
                cand = pick_nearest(fams.get(donor, []), slot, used)
                if cand is not None and hue_gap(cand, ANCHOR[slot]) <= BORROW_HUE_MAX:
                    pick, donor_note = cand, f"borrowed from the source's {donor}s"
                    break
        if pick is None:
            spare = standins()
            if spare:
                stand = farthest(spare, list(mapping.values()), 1)[0]
                mapping[slot] = stand
                prov[slot] = "standin"
                notes[slot] = (f"the source has no {slot}; this is one of its "
                               f"{family(stand)}s, renamed")
                used.add(stand)
                continue
            mapping[slot] = synth(slot, reg)
            prov[slot] = "added"
            notes[slot] = ("no colour of this family in the source"
                           if not pool else
                           "the source's only candidates are already spoken for")
            continue

        # A hue can be right and the slot still wrong: a pale cream is the only
        # orange in some palettes, and using it raw makes `orange` unusable for
        # anything an orange is for. Relighting keeps the palette's own hue and
        # chroma while putting the colour where the slot needs it.
        drift = lab(pick)[0] - lab(ANCHOR[slot])[0]
        if abs(drift) > RELIGHT_SLACK:
            fixed = relight(pick, lab(ANCHOR[slot])[0])
            mapping[slot] = fixed
            prov[slot] = "derived"
            notes[slot] = ((donor_note + "; " if donor_note else "")
                           + f"relit from {pick}, which is "
                           + f"{abs(drift):.0f} L too "
                           + ("light" if drift > 0 else "dark") + " for this slot")
        else:
            mapping[slot] = pick
            prov[slot] = "derived" if donor_note else "sourced"
            if donor_note:
                notes[slot] = donor_note
            used.add(pick)

    taken = {v.lower() for v in mapping.values()}
    spares = [c for c in hexes if c.lower() not in taken]
    return mapping, prov, notes, spares


# ----------------------------------------------------------------------- rating
#
# Six axes, each 0-100 and higher-is-better, plus a weighted composite. The
# composite is a reading order, not a verdict: two of the three palettes already
# shipped would not top this list, and they were still the right calls.
#
# Contrast and CVD are scored as percentiles against the fourteen inherited
# palettes rather than against an absolute ideal, because the absolute numbers
# are meaningless on their own - the rubric's 1.3 floor flags 26 pairs in
# famicom, which has shipped since 1983.

WEIGHTS = {
    # The slot names have to mean something, so role is weighted and a palette
    # that cannot supply a hue is marked down for it.
    "fit-colourname": {"source": 20, "role": 15, "ramps": 20,
                "contrast": 20, "cvd": 15, "distinct": 10, "separation": 0},
    # The names are labels, so role is reported and not scored, and what
    # replaces it is separation - the thing that actually has to hold if
    # `green` is allowed to be a teal.
    "fit-palette": {"source": 20, "role": 0, "ramps": 15,
                "contrast": 20, "cvd": 15, "distinct": 10, "separation": 20},
}

# A stand-in is a real colour from the source palette, so it counts as fully
# sourced: fit-palette's whole claim is that it invents no new colours.
PROV_VALUE = {"sourced": 1.0, "standin": 1.0, "derived": 0.5, "added": 0.0}


def percentile(value, corpus, lower_is_better=True):
    """Where `value` falls among the corpus, 0-100, higher always better."""
    if not corpus:
        return 50.0
    better = sum(1 for c in corpus if (c > value if lower_is_better else c < value))
    ties = sum(1 for c in corpus if c == value)
    return round(100.0 * (better + 0.5 * ties) / len(corpus), 1)


def role_score(mapping):
    """How much each slot still means what PuzzleScript thinks it means.

    Chromatic slots are judged on hue drift from arnecolors; neutral slots on
    how tinted they are. A palette can score well here and still be a bad fit -
    dungeon20's greens are perfectly green, they are just not Dungeon-20's.
    """
    pen = []
    for slot in SLOTS:
        c = mapping[slot]
        if slot in ("black", "white", "grey", "darkgrey", "lightgrey"):
            pen.append(min(chroma(c), 40) / 40 * 100)
        else:
            pen.append(min(hue_gap(c, ANCHOR[slot]), 90) / 90 * 100)
    return round(100 - sum(pen) / len(pen), 1)


def ramp_score(res):
    steps = sum(len(s) - 1 for s in RAMPS.values())
    clean = 1 - len(res["ramp_faults"]) / steps
    even = sum(res["ramp_evenness"].values()) / len(res["ramp_evenness"])
    return round(70 * clean + 30 * even, 1)


def min_separation(mapping):
    """The closest any two of the 21 slots come to each other, perceptually.

    The single number that decides whether a fit-palette mapping works: if the
    smallest gap between any pair is large, every object on the board can be
    told from every other, whatever the slots are called.
    """
    values = [mapping[s] for s in SLOTS]
    best = 1e9
    for i, a in enumerate(values):
        for b in values[i + 1:]:
            best = min(best, delta_e(a, b))
    return best


def rate(mapping, prov, corpus_stats, mode="fit-colourname"):
    weights = WEIGHTS[mode]
    res = analyse(mapping)
    axes = {
        "source": round(100 * sum(PROV_VALUE[prov[s]] for s in SLOTS) / len(SLOTS), 1),
        "role": role_score(mapping),
        "ramps": ramp_score(res),
        "contrast": percentile(len(res["low_contrast"]), corpus_stats["contrast"]),
        "cvd": percentile(res["cvd_total"], corpus_stats["cvd"]),
        "distinct": round(100 * res["unique"] / len(SLOTS), 1),
        "separation": percentile(min_separation(mapping),
                                 corpus_stats["separation"],
                                 lower_is_better=False),
    }
    total = sum(weights.values())
    composite = round(sum(axes[k] * weights[k] for k in axes) / total, 1)
    return composite, axes, res


def corpus_stats(colors_js=None):
    builtins = load_builtins(colors_js or find_colors_js(), exclude=FORK_PALETTES)
    stats = {"contrast": [], "cvd": [], "separation": [], "names": list(builtins)}
    for name, mapping in builtins.items():
        r = analyse(mapping)
        stats["contrast"].append(len(r["low_contrast"]))
        stats["cvd"].append(r["cvd_total"])
        stats["separation"].append(min_separation(mapping))
    return stats, builtins


# ------------------------------------------------------------------- verdicts

def load_verdicts():
    try:
        with open(VERDICT_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_verdicts(v):
    with open(VERDICT_FILE, "w", encoding="utf-8") as f:
        json.dump(v, f, indent=2, sort_keys=True)
        f.write("\n")


# --------------------------------------------------------------------- reports

def evaluate(cands, stats, mode="fit-colourname"):
    rows = []
    for c in cands:
        mapping, prov, notes, spares = fit(c["hex"], mode)
        composite, axes, res = rate(mapping, prov, stats, mode)
        rows.append({**c, "mapping": mapping, "prov": prov, "notes": notes,
                     "spares": spares, "score": composite, "axes": axes,
                     "res": res, "mode": mode})
    rows.sort(key=lambda r: -r["score"])
    return rows


def cmd_score(rows, stats):
    verdicts = load_verdicts()
    mode = rows[0]["mode"] if rows else "fit-colourname"
    print(f"\n{len(rows)} candidates in {mode} mode, rated against "
          f"{len(stats['names'])} inherited palettes\n")
    head = (f"  {'':<3}{'palette':<22}{'score':>6}  {'src':>5}{'role':>6}"
            f"{'ramp':>6}{'cntr':>6}{'cvd':>6}{'dist':>6}{'sep':>6}   "
            f"{'sourced':>8}  verdict")
    print(head)
    print("  " + "-" * (len(head) - 2))
    for i, r in enumerate(rows, 1):
        a = r["axes"]
        srcd = sum(1 for s in SLOTS if r["prov"][s] in ("sourced", "standin"))
        v = verdicts.get(r["slug"], {}).get("verdict", "")
        print(f"  {i:<3}{r['name'][:21]:<22}{r['score']:>6}  {a['source']:>5}"
              f"{a['role']:>6}{a['ramps']:>6}{a['contrast']:>6}{a['cvd']:>6}"
              f"{a['distinct']:>6}{a['separation']:>6}   {srcd:>5}/21  {v}")
    print("\n  src  how much of the mapping is really the source's "
          "(derived counts half)")
    print("  role how well each slot still means what PuzzleScript means by it")
    print("  ramp dark->base->light actually gets lighter, and evenly")
    print("  cntr percentile against the inherited palettes, higher is better")
    print("  cvd  same, for colourblind collapses")
    print("  dist distinct hex values out of 21")
    print("  sep  how far apart the closest pair of slots is, as a percentile")
    if mode == "fit-palette":
        print("\n  fit-palette: only the source's own colours are used, so role is")
        print("  shown but not scored and separation is scored instead.")
    else:
        print("\n  fit-colourname: slot names must mean what they say, so role is")
        print("  scored. --mode fit-palette instead reuses a source colour under a")
        print("  name it does not match, and scores separation in role's place.")


def cmd_show(r, stats):
    src, res = r, r["res"]
    print(f"\n{'=' * 74}\n{src['name']}"
          + (f"  -  {src['author']}" if src.get("author") else "")
          + f"\n{src.get('source_file', '')}\n{'=' * 74}")
    print(f"\nsource: {len(src['hex'])} colours")
    for i in range(0, len(src["hex"]), 9):
        print("  " + " ".join(src["hex"][i:i + 9]))

    print(f"\nproposed mapping                       score {r['score']}")
    for ramp, slots in RAMPS.items():
        print(f"  {ramp}:")
        for s in slots:
            tag = "" if r["prov"][s] == "sourced" else f"  <- {r['prov'][s]}"
            note = f"   ({r['notes'][s]})" if s in r["notes"] else ""
            print(f"    {s:<11} {r['mapping'][s]}  L{lab(r['mapping'][s])[0]:>5.1f}{tag}{note}")
    print("  singles:")
    for s in SINGLETS:
        tag = "" if r["prov"][s] == "sourced" else f"  <- {r['prov'][s]}"
        note = f"   ({r['notes'][s]})" if s in r["notes"] else ""
        print(f"    {s:<11} {r['mapping'][s]}  L{lab(r['mapping'][s])[0]:>5.1f}{tag}{note}")

    counts = {k: sum(1 for s in SLOTS if r["prov"][s] == k)
              for k in ("sourced", "standin", "derived", "added")}
    print(f"\n  sourced {counts['sourced']}/21   "
          f"standin {counts['standin']}   derived {counts['derived']}   "
          f"added {counts['added']}")
    print(f"  spares (source colours with no slot): "
          f"{', '.join(r['spares']) if r['spares'] else 'none'}")

    print("\naxes")
    for k, v in r["axes"].items():
        bar = "#" * int(v / 5)
        print(f"  {k:<10} {v:>5}  {bar}")

    print(f"\ndistinct hex values: {res['unique']}/21")
    for c, names in res["dupes"].items():
        print(f"  {c} shared by: {', '.join(names)}")

    if res["ramp_faults"]:
        print(f"\nramp faults: {len(res['ramp_faults'])}")
        for ramp, lo, hi, d in res["ramp_faults"]:
            print(f"  {ramp}: {hi} is {abs(d)} L darker than {lo}")
    else:
        print("\nramp faults: none - every ramp climbs")
    print("  evenness: " + "  ".join(f"{k} {v}" for k, v in
                                     res["ramp_evenness"].items()))

    print(f"\ncontrast pairs below 1.3: {len(res['low_contrast'])}"
          f"   (inherited range {min(stats['contrast'])}-{max(stats['contrast'])})")
    for a, b, ratio in res["low_contrast"][:10]:
        print(f"  {a:<11} vs {b:<11} ratio {ratio}")
    if len(res["low_contrast"]) > 10:
        print(f"  ... and {len(res['low_contrast']) - 10} more")

    print(f"\ncolourblind collapses: {res['cvd_total']}"
          f"   (inherited range {min(stats['cvd'])}-{max(stats['cvd'])})")
    for kind, flags in res["cvd"].items():
        if flags:
            print(f"  {kind}: {len(flags)}")
            for a, b, n, s in flags[:5]:
                print(f"    {a:<11} vs {b:<11} normal {n:>6}  sim {s:>5}")
            if len(flags) > 5:
                print(f"    ... and {len(flags) - 5} more")


def cmd_audit(stats, builtins, colors_js):
    """Run the ramp checks over the palettes that already ship.

    Worth doing before trusting the ramp axis at all: if the inherited palettes
    broke the rule routinely, the rule would be wrong rather than they.
    """
    print(f"\n{'=' * 74}\nAUDIT - palettes already in {colors_js}\n{'=' * 74}")
    everything = load_builtins(colors_js)
    print(f"\n  {'palette':<16}{'faults':>7}{'even':>7}{'uniq':>7}"
          f"{'cntr':>7}{'cvd':>6}")
    for name, mapping in everything.items():
        res = analyse(mapping)
        even = sum(res["ramp_evenness"].values()) / len(res["ramp_evenness"])
        mark = " *" if name in FORK_PALETTES else ""
        print(f"  {name:<16}{len(res['ramp_faults']):>7}{even:>7.2f}"
              f"{res['unique']:>5}/21{len(res['low_contrast']):>7}"
              f"{res['cvd_total']:>6}{mark}")
    print("\n  * fork addition, excluded from the calibration corpus")
    faulty = {n: analyse(m)["ramp_faults"] for n, m in everything.items()}
    faulty = {n: f for n, f in faulty.items() if f}
    if faulty:
        print(f"\n  ramps that run backwards, in palettes that ship:")
        for n, f in faulty.items():
            for ramp, lo, hi, d in f:
                print(f"    {n:<16} {ramp}: {hi} is {abs(d)} L darker than {lo}")
    else:
        print("\n  every shipped palette's ramps climb")


def cmd_compare(cands, stats):
    """Both modes side by side.

    Which mode a palette scores better under is a finding about the palette,
    not a general rule: one with a true hue gap is usually better off renaming
    a spare family than having three colours invented for it, and one that is
    merely lopsided is usually the other way round. Running both and reading
    the gap is the only way to tell, so it should not require running the tool
    twice and holding two tables in your head.
    """
    by_mode = {m: {r["slug"]: r for r in evaluate(cands, stats, m)}
               for m in WEIGHTS}
    print(f"\n{'=' * 74}\nCOMPARE - the same candidates fitted both ways\n{'=' * 74}\n")
    print(f"  {'palette':<22}{'colourname':>11}{'palette':>9}{'gap':>7}   "
          f"{'prefers':<12}why")
    print("  " + "-" * 82)
    rows = sorted(by_mode["fit-colourname"].values(), key=lambda r: -r["score"])
    for r in rows:
        a = by_mode["fit-colourname"][r["slug"]]
        b = by_mode["fit-palette"][r["slug"]]
        gap = b["score"] - a["score"]
        prefers = "palette" if gap > 0 else "colourname"
        added = sum(1 for s in SLOTS if a["prov"][s] == "added")
        stand = sum(1 for s in SLOTS if b["prov"][s] == "standin")
        # A palette with no gaps at all is fitted identically both ways - there
        # is no decision to make, so the whole difference is that role is
        # weighted under one mode and separation under the other. Reporting
        # that as a preference would be inventing a reason for an artefact.
        if a["mapping"] == b["mapping"]:
            prefers = "either"
            why = "same mapping both ways; the gap is only the axis weighting"
        elif abs(gap) < 1.0:
            why = f"{added} invented vs {stand} renamed, and it barely matters"
        elif gap > 0:
            why = (f"{added} slots would have to be invented; "
                   f"renaming {stand} costs less")
        else:
            why = f"renaming {stand} slots cannibalises ramps it was using"
        print(f"  {r['name'][:21]:<22}{a['score']:>11}{b['score']:>9}"
              f"{gap:>+7.1f}   {prefers:<12}{why}")
    print("\n  A palette with a true hue gap is usually better off renaming.")
    print("  One that is merely lopsided is usually better off inventing.")
    print("  Neither is a rule - the gap is the finding.")


def cmd_anchors(colors_js):
    """Show the slot-name lexicon, and re-derive it to check for drift.

    ANCHOR is frozen in palette_lib.py rather than computed at import, so it is
    visible in a diff and does not silently move every score when a palette is
    added to colors.js. This command is how you check the frozen table still
    matches the corpus it came from.
    """
    print(f"\n{'=' * 74}\nANCHORS - what each slot NAME denotes\n{'=' * 74}")
    print("\n  The medoid of the 14 inherited palettes: for each slot, the one")
    print("  real shipped colour with the smallest total distance to the rest.")
    print("  Nothing here is idealised - every anchor is a colour some palette")
    print("  actually ships for that name. `spread` is how much the corpus")
    print("  disagrees about the name at all.\n")
    print(f"  {'slot':<11}{'anchor':<9}{'from':<15}{'spread':>7}   "
          f"{'arnecolors':<11}{'dE':>4}")
    builtins = load_builtins(colors_js, exclude=FORK_PALETTES)
    fresh = derive_anchors(builtins) if builtins else {}
    drift = []
    for slot in SLOTS:
        hexv, src, spread = ANCHOR_SOURCE[slot]
        d = delta_e(hexv, ARNE[slot])
        note = "" if d < 12 else ("   <- arnecolors is an outlier here"
                                  if d > 25 else "")
        print(f"  {slot:<11}{hexv:<9}{src:<15}{spread:>7}   "
              f"{ARNE[slot].lower():<11}{d:>4.0f}{note}")
        if fresh and fresh[slot][0] != hexv:
            drift.append((slot, hexv, fresh[slot][0], fresh[slot][1]))

    same = sum(1 for s in SLOTS if delta_e(ANCHOR_SOURCE[s][0], ARNE[s]) < 1)
    print(f"\n  arnecolors is the medoid for {same} of {len(SLOTS)} slots.")
    print("  Where it is not, it is a palette with opinions, not a dictionary:")
    print("  its darkgreen is a slate, its darkblue near-black, its purple")
    print("  blue-violet, its lightbrown a golden yellow. Anchoring the rating")
    print("  on those meant marking a palette down for being correct.")

    if not fresh:
        print(f"\n  (no corpus at {colors_js}; cannot check for drift)")
    elif drift:
        print(f"\n  DRIFT - the frozen table no longer matches the corpus:")
        for slot, old, new, src in drift:
            print(f"    {slot:<11} frozen {old}  corpus now {new} ({src})")
        print("\n  Update ANCHOR_SOURCE in palette_lib.py deliberately, and")
        print("  expect every score to move when you do.")
    else:
        print("\n  Frozen table matches the corpus - no drift.")


def cmd_combos(rows, stats, limit=8):
    """Pairs of candidates that fit the slots better together than apart.

    Grafting a donor colour into each of the host's gaps one at a time is the
    obvious way to do this and it produces broken ramps: filling `green` and
    `lightgreen` from the same donor independently can easily leave lightgreen
    the darker of the two. So a combination is done properly - pool both
    palettes' colours and run the whole fitter over the union - which is also
    what "combining two palettes" means to anyone looking at the result.

    Only pairs that actually raise the score are worth showing, and the cost is
    reported as graft distance: a donor from a different register will fill the
    slot and wreck the palette's coherence.
    """
    print(f"\n{'=' * 74}\nCOMBOS - two palettes pooled and re-fitted\n{'=' * 74}")
    if len(rows) < 2:
        print("\n  need at least two candidates")
        return

    pairs = []
    for base in rows:
        base_set = set(base["hex"])
        for donor in rows:
            if donor is base:
                continue
            extra = [c for c in donor["hex"] if c not in base_set]
            if not extra:
                continue
            union = base["hex"] + extra
            mapping, prov, notes, _ = fit(union, base["mode"])
            score, axes, res = rate(mapping, prov, stats, base["mode"])
            from_donor = [s for s in SLOTS
                          if mapping[s] in set(extra) and base["prov"][s] != "sourced"]
            if score <= base["score"] or not from_donor:
                continue
            drift = [min(delta_e(mapping[s], c) for c in base["hex"])
                     for s in from_donor]
            pairs.append((base, donor, score, from_donor, mapping,
                          sum(drift) / len(drift), res))

    pairs.sort(key=lambda p: -(p[2] - p[0]["score"]))
    if not pairs:
        print("\n  no pair scores better than either palette alone")
        return

    for base, donor, score, from_donor, mapping, drift, res in pairs[:limit]:
        gain = score - base["score"]
        print(f"\n  {base['name']}  +  {donor['name']}"
              f"    {base['score']} -> {score}  (+{gain:.1f})")
        print(f"    {len(from_donor)} slots now come from {donor['name']}, "
              f"mean graft distance {drift:.1f}"
              + ("  (close - the two share a register)" if drift < 30 else
                 "  (far - the graft will read as foreign)"))
        print(f"    ramp faults {len(res['ramp_faults'])}, "
              f"distinct {res['unique']}/21, "
              f"contrast pairs {len(res['low_contrast'])}, "
              f"CVD {res['cvd_total']}")
        for slot in from_donor:
            print(f"      {slot:<11} {base['mapping'][slot]} -> {mapping[slot]}")


def cmd_emit_curated(r):
    """A CURATED block for palette_analysis.py, ready to be argued with.

    This is step 3 of the five-step process in doc/palette-set.md made cheap:
    the tool drafts, you correct. Every non-sourced slot carries its reason as
    a comment, because those are precisely the lines that need a human.
    """
    src = r
    print(f'    "{src["slug"]}": {{')
    for ramp, slots in list(RAMPS.items()) + [("singles", SINGLETS)]:
        gaps = [s for s in slots if r["prov"][s] != "sourced"]  # incl. stand-ins
        if gaps:
            print(f"        # {ramp}: " + "; ".join(
                f"{s} {r['prov'][s]} - {r['notes'].get(s, '')}" for s in gaps))
        line = "        " + " ".join(
            f'"{s}": ("{r["mapping"][s]}", '
            f'"{"sourced" if r["prov"][s] in ("sourced", "standin") else "added"}"),'
            for s in slots)
        print(line)
    print("    },")
    print(f'\n# SOURCES entry:\n    "{src["slug"]}": {{')
    print(f'        "title": "{src["name"]}",')
    print(f'        "author": "{src.get("author") or "TODO"}",')
    print(f'        "url": "{src.get("url") or "TODO"}",')
    print(f'        "note": "TODO",')
    print(f'        "hex": """{" ".join(c.lstrip("#") for c in src["hex"])}""".split(),')
    print("    },")


def cmd_block(r):
    """The portable prelude block, same shape palette_analysis.py emits."""
    order = ["black", "white", "grey", "darkgrey", "lightgrey",
             "gray", "darkgray", "lightgray",
             "red", "darkred", "lightred", "brown", "darkbrown", "lightbrown",
             "orange", "yellow", "green", "darkgreen", "lightgreen",
             "blue", "lightblue", "darkblue", "purple", "pink"]
    pairs = " ".join(f"{k} {r['mapping'][ALIAS_OF.get(k, k)]}" for k in order)
    added = [s for s in SLOTS if r["prov"][s] not in ("sourced", "standin")]
    stand = [s for s in SLOTS if r["prov"][s] == "standin"]
    print(f"({r['name']}" + (f" - {r['author']}" if r.get("author") else ""))
    if stand:
        print(" Source colours used for slots they do not match: "
              + ", ".join(stand) + ".")
    if added:
        print(" Not from the source palette: " + ", ".join(added) + ".")
    print(")")
    print(f"color_palette arnecolors {pairs}")


# ------------------------------------------------------------------ the sheet

def swatch(c, label="", cls=""):
    fg = "#000" if lab(c)[0] > 55 else "#fff"
    return (f'<div class="sw {cls}" style="background:{c};color:{fg}">'
            f'<span class="n">{html.escape(label)}</span>'
            f'<span class="h">{c}</span></div>')


def sheet_html(rows, stats, verdicts):
    """One self-contained page. No network, no build step: open the file.

    The point of the sheet is that the numbers above are an index, not an
    answer - you cannot tell whether a palette is worth using without looking
    at it, and looking at 21 chips in a grid is the whole job.
    """
    css = """
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;
 background:#14161a;color:#e8e6e1}
header{padding:20px 28px;border-bottom:1px solid #2a2e35}
h1{margin:0 0 4px;font-size:19px}
.sub{color:#8b929e;font-size:13px}
.card{border-bottom:1px solid #2a2e35;padding:22px 28px}
.card h2{margin:0 0 2px;font-size:16px}
.meta{color:#8b929e;font-size:12px;margin-bottom:12px}
.cols{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}
.sw{width:74px;height:52px;border-radius:4px;display:flex;flex-direction:column;
 justify-content:space-between;padding:4px 5px;font-size:10px;box-sizing:border-box}
.sw .n{font-weight:600}
.sw .h{opacity:.72;font-family:ui-monospace,monospace;font-size:9px}
.strip{display:flex;gap:3px;flex-wrap:wrap;max-width:470px}
.cvd .strip{max-width:306px}
.strip .sw{width:40px;height:34px}
.ramp{display:flex;gap:3px;align-items:center;margin-bottom:4px}
.ramp b{width:52px;font-size:11px;color:#8b929e;font-weight:500}
.derived{outline:2px dashed #c9a227;outline-offset:-2px}
.added{outline:2px solid #d2553d;outline-offset:-2px}
.standin{outline:2px dotted #5aa9c9;outline-offset:-2px}
.fault{box-shadow:0 0 0 3px #d2553d}
.axes{min-width:230px}
.ax{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px}
.ax b{width:62px;color:#8b929e;font-weight:500}
.bar{height:7px;background:#2a2e35;border-radius:4px;flex:1;overflow:hidden}
.bar i{display:block;height:100%;background:#5a9;border-radius:4px}
.score{font-size:30px;font-weight:700;line-height:1}
.flags{font-size:12px;color:#9aa3b0;margin-top:10px;max-width:520px}
.flags code{color:#e3b04b}
pre{background:#0d0f12;border:1px solid #2a2e35;border-radius:5px;padding:9px 11px;
 font-size:11px;overflow-x:auto;color:#a8b4c4;max-width:760px;white-space:pre-wrap}
.v{display:inline-block;padding:1px 8px;border-radius:9px;font-size:11px;
 background:#2a2e35;color:#9aa3b0}
.v.accept{background:#1f4432;color:#6ed49f}
.v.reject{background:#43222a;color:#e88}
.v.maybe{background:#43391f;color:#e3b04b}
.legend{font-size:11px;color:#8b929e;margin-top:6px}
"""
    out = [f"<!doctype html><meta charset=utf-8><title>palette candidates</title>",
           f"<style>{css}</style>",
           "<header><h1>Palette candidates</h1>",
           f"<div class=sub>{len(rows)} candidates in "
           f"<b>{rows[0]['mode'] if rows else 'fit-colourname'}</b> mode, fitted to "
           f"PuzzleScript's 21 slots and rated against "
           f"{len(stats['names'])} inherited palettes. "
           "Dashed gold = derived from the source's own colours; "
           "dotted blue = a source colour standing in for a slot it does not "
           "match; solid red = added, the source has nothing in that "
           "family.</div></header>"]

    for r in rows:
        v = verdicts.get(r["slug"], {})
        vclass = v.get("verdict", "")
        res = r["res"]
        out.append("<div class=card>")
        out.append(f"<h2>{html.escape(r['name'])}"
                   + (f' <span class="v {vclass}">{vclass}</span>' if vclass else "")
                   + "</h2>")
        out.append(f"<div class=meta>"
                   + (html.escape(r["author"]) + " &middot; " if r.get("author") else "")
                   + f"{len(r['hex'])} source colours &middot; "
                   + html.escape(os.path.basename(r.get("source_file", "")))
                   + (" &middot; " + html.escape(v["note"]) if v.get("note") else "")
                   + "</div>")

        out.append("<div class=cols>")

        out.append("<div><div class=meta>source</div><div class=strip>"
                   + "".join(swatch(c) for c in r["hex"]) + "</div>")
        faults = {(f[1], f[2]) for f in res["ramp_faults"]}
        faulted = {s for pair in faults for s in pair}
        out.append("<div style='margin-top:14px'><div class=meta>mapping</div>")
        for ramp, slots in list(RAMPS.items()) + [("other", SINGLETS)]:
            out.append(f"<div class=ramp><b>{ramp}</b>")
            for s in slots:
                cls = r["prov"][s] if r["prov"][s] != "sourced" else ""
                if s in faulted:
                    cls += " fault"
                out.append(swatch(r["mapping"][s], s, cls))
            out.append("</div>")
        out.append("</div></div>")

        out.append("<div class=axes><div class=score>"
                   f"{r['score']}</div><div class=meta>composite</div>")
        for k, val in r["axes"].items():
            out.append(f"<div class=ax><b>{k}</b><span class=bar>"
                       f"<i style='width:{val}%'></i></span>"
                       f"<span style='width:30px;text-align:right'>{val:g}</span></div>")
        counts = {k: sum(1 for s in SLOTS if r["prov"][s] == k)
                  for k in ("sourced", "standin", "derived", "added")}
        out.append(f"<div class=flags>sourced {counts['sourced']}/21, "
                   f"stand-in {counts['standin']}, "
                   f"derived {counts['derived']}, added {counts['added']}<br>"
                   f"contrast pairs &lt;1.3: <code>{len(res['low_contrast'])}</code> "
                   f"(inherited {min(stats['contrast'])}&ndash;{max(stats['contrast'])})<br>"
                   f"CVD collapses: <code>{res['cvd_total']}</code> "
                   f"(inherited {min(stats['cvd'])}&ndash;{max(stats['cvd'])})<br>"
                   f"ramp faults: <code>{len(res['ramp_faults'])}</code>, "
                   f"distinct <code>{res['unique']}/21</code></div>")
        gaps = [s for s in SLOTS if r["prov"][s] != "sourced"]
        if gaps:
            out.append("<div class=flags style='margin-top:8px'>"
                       + "<br>".join(f"<code>{s}</code> {r['prov'][s]} "
                                     f"&mdash; {html.escape(r['notes'].get(s, ''))}"
                                     for s in gaps) + "</div>")
        out.append("</div>")

        out.append("<div class=cvd><div class=meta>deuteranopia</div><div class=strip>"
                   + "".join(
                       f'<div class="sw" style="background:'
                       f'{"#%02x%02x%02x" % tuple(int(x) for x in simulate(r["mapping"][s], CVD["deuteranopia"]))}"></div>'
                       for s in SLOTS) + "</div>"
                   "<div class=meta style='margin-top:10px'>protanopia</div><div class=strip>"
                   + "".join(
                       f'<div class="sw" style="background:'
                       f'{"#%02x%02x%02x" % tuple(int(x) for x in simulate(r["mapping"][s], CVD["protanopia"]))}"></div>'
                       for s in SLOTS) + "</div></div>")

        out.append("</div>")

        order = ["black", "white", "grey", "darkgrey", "lightgrey",
                 "gray", "darkgray", "lightgray",
                 "red", "darkred", "lightred", "brown", "darkbrown", "lightbrown",
                 "orange", "yellow", "green", "darkgreen", "lightgreen",
                 "blue", "lightblue", "darkblue", "purple", "pink"]
        pairs = " ".join(f"{k} {r['mapping'][ALIAS_OF.get(k, k)]}" for k in order)
        out.append("<div style='margin-top:14px'><div class=meta>portable prelude block</div>"
                   f"<pre>color_palette arnecolors {html.escape(pairs)}</pre></div>")
        out.append("</div>")
    return "\n".join(out)


# --------------------------------------------------------------------- fetching

LOSPEC_JSON = "https://lospec.com/palette-list/{slug}.json"


def cmd_fetch(slugs, outdir):
    """Pull palettes straight from Lospec, when the network allows it.

    Lospec serves every palette as JSON at a predictable URL, so "open up the
    palette browser" is one GET per palette and no scraping. Whether it works
    depends entirely on the sandbox's egress policy, which is why the manual
    path - download the .hex from the site into a folder - stays supported and
    is what the docs lead with.
    """
    import urllib.error
    import urllib.request
    os.makedirs(outdir, exist_ok=True)
    ok = 0
    for slug in slugs:
        url = LOSPEC_JSON.format(slug=slug)
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                body = resp.read().decode("utf-8")
        except Exception as e:                       # noqa: BLE001 - report, don't raise
            print(f"  {slug}: FAILED  {type(e).__name__}: {e}", file=sys.stderr)
            continue
        dest = os.path.join(outdir, f"{slug}.json")
        with open(dest, "w", encoding="utf-8") as f:
            f.write(body)
        print(f"  {slug}: saved to {dest}")
        ok += 1
    if ok == 0:
        print("\n  Nothing fetched. If this is a network policy block rather than a\n"
              "  bad slug, download the palette by hand instead - Lospec's page has\n"
              "  .hex, .gpl and .pal download buttons - drop the files in a folder\n"
              "  and point `score` at the folder. The tool reads all three.",
              file=sys.stderr)
        return 1
    return 0


# ------------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(
        description="Rate and curate candidate palettes for PuzzleScript's 21 slots.",
        epilog="""\
the usual run, from the repository root:

  mkdir -p tools/candidates             put .hex / .gpl / .pal / .json in here
  palette_curate.py score   tools/candidates/
  palette_curate.py compare tools/candidates/
  palette_curate.py sheet   tools/candidates/ -o tools/candidates/sheet.html
  palette_curate.py show    tools/candidates/best.hex
  palette_curate.py verdict best accept -m "why"
  palette_curate.py emit-curated tools/candidates/best.hex

then continue at step 4 of doc/palette-set.md.

Everything prints to stdout except `sheet` (-o) and `verdict`, which writes
tools/palette_verdicts.json. Nothing is written to src/ - emit-curated prints a
draft for you to correct and paste.

The score orders a reading queue; it cannot tell you a palette is good. Look at
the sheet. Full notes in doc/palette-curation.md.
""",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name, helptext in [("score", "rank candidates"),
                           ("compare", "both modes side by side"),
                           ("show", "one candidate in full"),
                           ("combos", "which candidate fills another's gaps"),
                           ("emit-curated", "draft a CURATED block"),
                           ("block", "portable color_palette block")]:
        p = sub.add_parser(name, help=helptext)
        p.add_argument("paths", nargs="+", help="palette files or directories")
        p.add_argument("--colors-js", default=None)
        p.add_argument("--mode", choices=["fit-colourname", "fit-palette"], default="fit-colourname",
                       help="fit-colourname: slot names must mean what they "
                            "say, and a missing hue is synthesised. fit-palette: "
                            "only the source's own colours are used, and a "
                            "missing hue becomes another family renamed")

    p = sub.add_parser("sheet", help="HTML contact sheet for human review")
    p.add_argument("paths", nargs="+")
    p.add_argument("-o", "--out", default="palette-sheet.html")
    p.add_argument("--colors-js", default=None)
    p.add_argument("--mode", choices=["fit-colourname", "fit-palette"], default="fit-colourname")

    p = sub.add_parser("audit", help="check the palettes that already ship")
    p.add_argument("--colors-js", default=None)

    p = sub.add_parser("anchors", help="the slot-name lexicon, and any drift")
    p.add_argument("--colors-js", default=None)

    p = sub.add_parser("verdict", help="record a curation decision")
    p.add_argument("slug")
    p.add_argument("verdict", choices=["accept", "reject", "maybe", "clear"])
    p.add_argument("-m", "--note", default="")

    p = sub.add_parser("fetch", help="download palettes from Lospec by slug")
    p.add_argument("slugs", nargs="+")
    p.add_argument("-o", "--outdir", default="candidates")

    args = ap.parse_args()

    if args.cmd == "verdict":
        v = load_verdicts()
        if args.verdict == "clear":
            v.pop(args.slug, None)
            print(f"cleared {args.slug}")
        else:
            v[args.slug] = {"verdict": args.verdict, "note": args.note}
            print(f"{args.slug}: {args.verdict}"
                  + (f"  ({args.note})" if args.note else ""))
        save_verdicts(v)
        return 0

    if args.cmd == "fetch":
        return cmd_fetch(args.slugs, args.outdir)

    colors_js = args.colors_js or find_colors_js()
    stats, builtins = corpus_stats(colors_js)
    if not stats["names"]:
        print(f"warning: no calibration corpus found at {colors_js}; "
              "contrast and cvd axes will read 50", file=sys.stderr)

    if args.cmd == "audit":
        cmd_audit(stats, builtins, colors_js)
        return 0

    if args.cmd == "anchors":
        cmd_anchors(colors_js)
        return 0

    cands, errors = load_candidates(args.paths)
    for f, e in errors:
        print(f"{os.path.basename(f)}: {e}", file=sys.stderr)
    if not cands:
        print("no candidate palettes found", file=sys.stderr)
        return 1

    rows = evaluate(cands, stats, getattr(args, "mode", "fit-colourname"))

    if args.cmd == "compare":
        cmd_compare(cands, stats)
    elif args.cmd == "score":
        cmd_score(rows, stats)
    elif args.cmd == "show":
        for r in rows:
            cmd_show(r, stats)
    elif args.cmd == "combos":
        cmd_combos(rows, stats)
    elif args.cmd == "emit-curated":
        for r in rows:
            cmd_emit_curated(r)
    elif args.cmd == "block":
        for r in rows:
            cmd_block(r)
    elif args.cmd == "sheet":
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(sheet_html(rows, stats, load_verdicts()))
        print(f"wrote {args.out}  ({len(rows)} candidates)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
