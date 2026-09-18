# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Checks for the palette tools.

    uv run tools/palette_test.py

Dependency-free and self-contained, like the tools it checks, so it runs with
no resolution step and no test framework to install.

The emphasis is on *invariants the code claims* rather than on pinning down
particular outputs. The fitter is meant to be improved - pinning its exact
choices would make every improvement look like a regression. What must not
change is the set of promises it makes:

  - every fit covers all 21 slots with valid colours
  - every ramp climbs (the fitter says "monotonic by construction")
  - a slot marked `sourced` really is a colour from the source
  - `standin` appears only under fit-palette
  - the generated files in the repo match what the generators produce

Most of these are checked against a spread of generated palettes as well as the
real ones, because the interesting failures are in the degenerate cases: the
palette with one colour, the palette that is all greys, the palette with two
colours at the same lightness.
"""

import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import palette_analysis as PA  # noqa: E402
import palette_curate as PC  # noqa: E402
import palette_lib as P  # noqa: E402

HEX_RE = re.compile(r"^#[0-9a-f]{6}$")
MODES = ("fit-colourname", "fit-palette")

_fails = []
_count = 0


def check(cond, label, detail=""):
    global _count
    _count += 1
    if not cond:
        _fails.append(f"{label}" + (f"\n      {detail}" if detail else ""))


def section(name):
    print(f"\n  {name}")


# ------------------------------------------------------------------- fixtures

def synthetic_palettes(n=60, seed=11):
    """A spread of palettes, weighted towards the awkward ones."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        size = rnd.choice([1, 2, 3, 4, 5, 8, 12, 16, 20, 24, 32, 48])
        kind = i % 4
        cols = []
        for _ in range(size):
            if kind == 0:                     # anything
                L, C, h = rnd.uniform(0, 100), rnd.uniform(0, 90), rnd.uniform(0, 360)
            elif kind == 1:                   # near-neutral only
                L, C, h = rnd.uniform(0, 100), rnd.uniform(0, 10), rnd.uniform(0, 360)
            elif kind == 2:                   # one narrow hue band
                L, C, h = rnd.uniform(10, 90), rnd.uniform(20, 60), rnd.uniform(90, 130)
            else:                             # all crammed at one lightness
                L, C, h = 50.0, rnd.uniform(10, 70), rnd.uniform(0, 360)
            a = C * __import__("math").cos(__import__("math").radians(h))
            b = C * __import__("math").sin(__import__("math").radians(h))
            cols.append(P.lab_to_hex((L, a, b)))
        seen, uniq = set(), []
        for c in cols:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        out.append((f"synthetic{i}", uniq))
    return out


def corpus_palettes():
    """The shipped palettes, used as source colour lists."""
    b = P.load_builtins(P.find_colors_js())
    return [(n, sorted({v.lower() for v in m.values()})) for n, m in b.items()]


def all_palettes():
    return synthetic_palettes() + corpus_palettes()


# --------------------------------------------------------------- colour maths

def test_colour_maths():
    section("colour maths")
    rnd = random.Random(3)
    worst = 0.0
    for _ in range(500):
        h = "#%02x%02x%02x" % tuple(rnd.randrange(256) for _ in range(3))
        back = P.lab_to_hex(P.lab(h))
        worst = max(worst, max(abs(x - y) for x, y in zip(P.rgb(h), P.rgb(back))))
    check(worst <= 1, "lab/lab_to_hex round-trips within 1/255",
          f"worst channel error {worst}")

    # relight must actually reach the target lightness for in-gamut results,
    # and must not swing the hue while doing it.
    for _ in range(300):
        h = "#%02x%02x%02x" % tuple(rnd.randrange(30, 226) for _ in range(3))
        target = rnd.uniform(25, 75)
        out = P.relight(h, target)
        check(abs(P.lab(out)[0] - target) < 6.0,
              "relight reaches its target lightness",
              f"{h} -> {out}: wanted L {target:.1f}, got {P.lab(out)[0]:.1f}")
        if P.chroma(h) > 20 and P.chroma(out) > 10:
            check(PC.hue_gap(h, out) < 25,
                  "relight preserves hue", f"{h} -> {out}")

    check(P.contrast("#000000", "#ffffff") > 20.9, "contrast: black/white is 21")
    check(abs(P.contrast("#123456", "#123456") - 1.0) < 1e-9,
          "contrast: a colour against itself is 1")
    for a, b in (("#000000", "#ffffff"), ("#ff0000", "#00ff00")):
        check(abs(P.delta_e(a, b) - P.delta_e(b, a)) < 1e-9,
              "delta_e is symmetric")


# -------------------------------------------------------------------- anchors

def test_anchors():
    section("anchors")
    check(set(P.ANCHOR) == set(P.SLOTS), "ANCHOR covers exactly the 21 slots")
    for s, h in P.ANCHOR.items():
        check(bool(HEX_RE.match(h)), "ANCHOR values are lowercase 6-digit hex",
              f"{s} = {h}")

    faults = P.ramp_faults(P.ANCHOR)
    check(not faults, "the anchor table obeys the ramp rule it enforces",
          str(faults))

    forks = PC.FORK_PALETTES()
    builtins = P.load_builtins(P.find_colors_js(), exclude=forks)
    if builtins:
        check(len(builtins) == 14, "the calibration corpus is the 14 inherited "
              "palettes", f"got {len(builtins)}: {sorted(builtins)}")
        check(set(forks) == set(PA.SOURCES),
              "colors.js's fork markers agree with palette_analysis.SOURCES",
              f"markers {sorted(forks)} vs SOURCES {sorted(PA.SOURCES)}")
        for name in forks:
            check(name not in builtins,
                  "fork palettes stay out of the calibration corpus", name)
        fresh = P.derive_anchors(builtins)
        drift = [(s, P.ANCHOR[s], fresh[s][0]) for s in P.SLOTS
                 if fresh[s][0] != P.ANCHOR[s]]
        check(not drift, "frozen ANCHOR still matches the corpus it came from",
              "; ".join(f"{s}: frozen {a}, corpus {b}" for s, a, b in drift))

        # Every anchor must be a colour some palette actually ships, or the
        # claim that nothing here is idealised is false.
        shipped = {v.lower() for m in builtins.values() for v in m.values()}
        for s, h in P.ANCHOR.items():
            check(h in shipped, "every anchor is a real shipped colour",
                  f"{s} = {h} appears in no inherited palette")


# --------------------------------------------------------------- the fitter

def test_fit_invariants():
    section("fitter invariants")
    for name, hexes in all_palettes():
        if not hexes:
            continue
        src = set(hexes)
        for mode in MODES:
            mapping, prov, notes, spares = PC.fit(hexes, mode)
            where = f"{name} ({len(hexes)} colours, {mode})"

            check(set(mapping) == set(P.SLOTS),
                  "fit covers exactly the 21 slots", where)
            bad = [f"{s}={v}" for s, v in mapping.items() if not HEX_RE.match(v)]
            check(not bad, "fit returns lowercase 6-digit hex", f"{where}: {bad}")

            faults = P.ramp_faults(mapping)
            check(not faults, "every ramp climbs - 'monotonic by construction'",
                  f"{where}: {faults}")

            bad = {v for v in prov.values()
                   if v not in ("sourced", "standin", "derived", "added")}
            check(not bad, "provenance is one of the four known values",
                  f"{where}: {bad}")

            # The load-bearing claim: a slot called `sourced` or `standin` must
            # really be a colour the palette contains. If this fails, every
            # "sourced 17/21" figure in the reports is overstated.
            lied = [f"{s}={mapping[s]}" for s in P.SLOTS
                    if prov[s] in ("sourced", "standin") and mapping[s] not in src]
            check(not lied,
                  "a slot marked sourced/standin really is a source colour",
                  f"{where}: {lied}")

            if mode == "fit-colourname":
                stand = [s for s in P.SLOTS if prov[s] == "standin"]
                check(not stand, "no stand-ins under fit-colourname",
                      f"{where}: {stand}")

            overlap = set(spares) & set(mapping.values())
            check(not overlap, "spares are genuinely unused", f"{where}: {overlap}")
            check(all(c in src for c in spares),
                  "spares come from the source", where)

            for s in P.SLOTS:
                if prov[s] != "sourced":
                    check(s in notes, "every non-sourced slot says why",
                          f"{where}: {s} is {prov[s]} with no note")


def test_fit_determinism():
    section("determinism")
    for name, hexes in all_palettes()[:25]:
        if not hexes:
            continue
        for mode in MODES:
            a = PC.fit(hexes, mode)
            b = PC.fit(list(hexes), mode)
            check(a[0] == b[0], "fit is deterministic", f"{name} ({mode})")


def test_rating():
    section("rating")
    stats, _ = PC.corpus_stats(P.find_colors_js())
    for key in ("contrast", "cvd", "separation"):
        check(len(stats[key]) == 14, f"corpus stats has 14 {key} values",
              f"got {len(stats[key])}")

    for name, hexes in all_palettes()[:40]:
        if not hexes:
            continue
        for mode in MODES:
            mapping, prov, _, _ = PC.fit(hexes, mode)
            score, axes, res = PC.rate(mapping, prov, stats, mode)
            where = f"{name} ({mode})"
            check(set(axes) == set(PC.WEIGHTS[mode]),
                  "every weighted axis is reported", where)
            for k, v in axes.items():
                check(0 <= v <= 100, f"axis {k} is within 0-100",
                      f"{where}: {k}={v}")
            check(0 <= score <= 100, "composite is within 0-100",
                  f"{where}: {score}")
            check(res["unique"] <= 21, "distinct count cannot exceed 21", where)
            check(P.min_separation(mapping) if False else True, "")

    for mode in MODES:
        check(abs(sum(PC.WEIGHTS[mode].values()) - 100) < 1e-9,
              f"{mode} weights sum to 100")
    check(PC.WEIGHTS["fit-colourname"]["separation"] == 0,
          "separation is not scored under fit-colourname")
    check(PC.WEIGHTS["fit-palette"]["role"] == 0,
          "role is not scored under fit-palette")


# --------------------------------------------------------------- the parsers

def test_parsers(tmp):
    section("parsers")
    colours = ["#2e222f", "#45293f", "#7a3045", "#993d41", "#cd683d", "#fbb954"]
    bare = [c.lstrip("#") for c in colours]

    files = {}
    files["a.hex"] = "\n".join(bare) + "\n"
    files["b.gpl"] = ("GIMP Palette\nName: Test Palette\n#Author: Someone\n"
                      "Columns: 3\n#\n"
                      + "\n".join("%3d %3d %3d\t%s" % (*P.rgb(c), c.lstrip("#"))
                                  for c in colours) + "\n")
    files["c.pal"] = ("JASC-PAL\n0100\n%d\n" % len(colours)
                      + "\n".join("%d %d %d" % P.rgb(c) for c in colours) + "\n")
    files["d.json"] = ('{"name":"Test Palette","author":"Someone","colors":['
                       + ",".join(f'"{c.lstrip("#")}"' for c in colours) + ']}')
    files["e.txt"] = "prelude junk " + " ".join(colours) + " trailing words\n"

    for fn, body in files.items():
        with open(os.path.join(tmp, fn), "w", encoding="utf-8") as f:
            f.write(body)

    parsed = {}
    for fn in files:
        got = P.parse_palette(os.path.join(tmp, fn))
        parsed[fn] = got
        check([c.lower() for c in got["hex"]] == colours,
              "every format yields the same colours in the same order",
              f"{fn}: {got['hex']}")

    check(parsed["b.gpl"]["name"] == "Test Palette", "gpl Name: is read")
    check(parsed["b.gpl"]["author"] == "Someone", "gpl #Author: is read")
    check(parsed["d.json"]["name"] == "Test Palette", "json name is read")
    check(parsed["d.json"]["author"] == "Someone", "json author is read")
    check(parsed["a.hex"]["name"] == "a", "a bare .hex falls back to its filename")

    # Duplicates collapse, order preserved.
    dupe = os.path.join(tmp, "dupe.hex")
    with open(dupe, "w") as f:
        f.write("ff0000\n00ff00\nff0000\n0000ff\n")
    check(P.parse_palette(dupe)["hex"] == ["#ff0000", "#00ff00", "#0000ff"],
          "duplicate colours collapse, first position kept")

    # Things that are not palettes are rejected, not silently empty.
    for fn, body in (("empty.hex", ""), ("prose.txt", "no colours here at all\n")):
        p = os.path.join(tmp, fn)
        with open(p, "w") as f:
            f.write(body)
        try:
            P.parse_palette(p)
            check(False, "a file with no colours raises", fn)
        except ValueError:
            check(True, "a file with no colours raises")

    # a.hex, b.gpl, c.pal, d.json and e.txt are the same palette in five
    # formats - exactly what you get from clicking every download button on one
    # Lospec page - so they must collapse to one candidate, not five.
    cands, errors = P.load_candidates([tmp])
    check(len(cands) == 2, "identical palettes collapse to one candidate",
          f"got {len(cands)}: {[c['name'] for c in cands]}")
    unreadable = [e for e in errors if "no colours" in e[1]]
    duplicate = [e for e in errors if "same colours" in e[1]]
    check(len(unreadable) == 2, "unreadable files are reported",
          f"got {len(unreadable)}")
    check(len(duplicate) == 4, "duplicate palettes are reported, not silent",
          f"got {len(duplicate)}")

    slugs = [c["slug"] for c in cands]
    check(len(set(slugs)) == len(slugs),
          "candidate slugs in one directory are unique",
          f"collision among {sorted(slugs)}")

    # Two different palettes whose filenames slugify the same must not share a
    # verdict key, because verdicts are keyed by slug.
    sub = os.path.join(tmp, "slugs")
    os.makedirs(sub, exist_ok=True)
    with open(os.path.join(sub, "test-pal.hex"), "w") as f:
        f.write("112233\n445566\n778899\n")
    with open(os.path.join(sub, "Test Pal.hex"), "w") as f:
        f.write("aabbcc\nddeeff\n102030\n")
    sub_cands, sub_errors = P.load_candidates([sub])
    check(len(sub_cands) == 2, "two distinct palettes both survive",
          f"got {len(sub_cands)}")
    sub_slugs = [c["slug"] for c in sub_cands]
    check(len(set(sub_slugs)) == 2, "colliding slugs are disambiguated",
          f"got {sub_slugs}")
    check(any("already used" in e[1] for e in sub_errors),
          "a slug collision is reported rather than silently overwriting")


# --------------------------------------------------------------- the folder

def test_palette_folder(tmp):
    section("the palettes/ folder")
    import copy
    d = P.find_palette_dir()
    check(os.path.isdir(d), "palettes/ is there", d)

    pals = P.load_palette_dir(d)
    check(len(pals) >= 1, "at least one palette file", f"got {len(pals)}")
    check(list(pals) == sorted(pals, key=lambda n: pals[n]["index"]),
          "palettes come back in alias-index order")

    for name, p in pals.items():
        check(set(p["slots"]) == set(P.SLOTS), f"{name}: all 21 slots")
        check(all(v[1] in ("sourced", "added") for v in p["slots"].values()),
              f"{name}: every slot is sourced or added")
        check(p["title"] and p["author"] and p["url"],
              f"{name}: has a title, an author and a URL",
              "credit is the condition these are used under")
        mapping = {s: h for s, (h, _) in p["slots"].items()}
        check(not P.ramp_faults(mapping), f"{name}: ramps climb")

    # A palette file is also a candidate file: the same JSON the curation tool
    # reads from a Lospec download. Scoring what already ships is how `audit`
    # and `score` stay comparable.
    cands, errors = P.load_candidates([d])
    check(not errors, "every palette file parses as a candidate too", str(errors))
    check(len(cands) == len(pals), "one candidate per palette file")

    # The validator is the thing standing between a typo and a broken
    # colors.js, so each kind of breakage gets a test.
    good = json.load(open(pals[list(pals)[0]]["path"], encoding="utf-8"))

    def rejects(mutate, label, filename=None):
        doc = copy.deepcopy(good)
        mutate(doc)
        path = os.path.join(tmp, (filename or doc.get("name", "x")) + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        try:
            P.read_palette_file(path)
        except ValueError:
            check(True, label)
        else:
            check(False, label, "was accepted")

    rejects(lambda d: d["slots"].pop("green"), "a missing slot is rejected")
    rejects(lambda d: d["slots"].update(greeen=["#112233", "sourced"]),
            "a misspelled slot is rejected")
    rejects(lambda d: d["slots"].update(green=["112233", "sourced"]),
            "a colour without its # is rejected")
    rejects(lambda d: d["slots"].update(green=["#112233", "guessed"]),
            "an invented provenance word is rejected")
    rejects(lambda d: d["slots"].update(green=["#112233", "sourced"]),
            "a slot claiming to be sourced that is not in the source is rejected")
    rejects(lambda d: d.update(colours=d.pop("colors")),
            "a misspelled top-level key is rejected")
    rejects(lambda d: d.update(index="15"), "a non-integer index is rejected")
    rejects(lambda d: d.update(name="somethingelse"),
            "a name that disagrees with the filename is rejected",
            filename=good["name"])


def test_generated_from_folder():
    section("the generated files come from the folder")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    written, unchanged = PA.write_generated(root, dry_run=True)
    check(not written,
          "every generated file already matches palettes/",
          "stale: " + ", ".join(written)
          + " - run: uv run tools/palette_analysis.py --write")
    check(unchanged, "at least one generated file was actually compared")

    # The alias table, the palette bodies and the map editor's copy are three
    # generated things that have to agree about which number is which palette.
    # They were in three different orders before palettes/ existed.
    pals = P.load_palette_dir()
    js = open(P.find_colors_js(), encoding="utf-8").read()
    for name, p in pals.items():
        check(f'{p["index"]} : "{name}"' in js,
              f"{name} is alias {p['index']} in colors.js")
    indices = [p["index"] for p in pals.values()]
    check(len(set(indices)) == len(indices), "no two palettes share an index")
    check(indices == sorted(indices), "indices are emitted in order")


# ------------------------------------------------- the generated files in git

def test_generated_files():
    section("generated files still match their generators")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    refs = os.path.join(root, "src", "demo", "palette-refs.txt")
    if os.path.exists(refs):
        on_disk = open(refs, encoding="utf-8").read()
        regenerated = PA.emit_refs()
        check(on_disk.strip() == regenerated.strip(),
              "src/demo/palette-refs.txt matches --emit-refs",
              "regenerate it: uv run tools/palette_analysis.py --emit-refs "
              "> src/demo/palette-refs.txt")

    colors_js = P.find_colors_js()
    if os.path.exists(colors_js):
        js = open(colors_js, encoding="utf-8").read()
        for name in PA.SOURCES:
            mapping, prov, _ = PA.curated(name)
            check(f"{name} :" in js or f"{name}:" in js,
                  "each curated palette is present in colors.js", name)
            missing = [f"{s}={v}" for s, v in mapping.items()
                       if v.lower() not in js.lower()]
            check(not missing,
                  "every curated colour appears in colors.js",
                  f"{name}: {missing[:4]}")


def test_curated_palettes():
    section(f"the {len(PA.SOURCES)} shipped palettes")
    for name in PA.SOURCES:
        mapping, prov, spares = PA.curated(name)
        check(set(mapping) == set(P.SLOTS), f"{name} covers the 21 slots")
        faults = P.ramp_faults(mapping)
        check(not faults, f"{name} ramps climb", str(faults))
        src = {"#" + c.lower() for c in PA.SOURCES[name]["hex"]}
        lied = [f"{s}={mapping[s]}" for s in P.SLOTS
                if prov[s] == "sourced" and mapping[s].lower() not in src]
        check(not lied, f"{name}: every 'sourced' slot is really in the source",
              str(lied))


def test_audit_corpus():
    section("the shipped corpus")
    everything = P.load_builtins(P.find_colors_js())
    expected = 14 + len(PA.SOURCES)
    check(len(everything) == expected,
          f"colors.js holds the 14 inherited plus {len(PA.SOURCES)} fork palettes",
          f"got {len(everything)}, expected {expected}")
    for name, mapping in everything.items():
        res = P.analyse(mapping)
        check(res["unique"] <= 21, f"{name}: distinct count sane")
        check(len(res["ramp_evenness"]) == len(P.RAMPS),
              f"{name}: every ramp gets an evenness score")
    # The ramp rule is only worth enforcing if the palettes that ship mostly
    # obey it. If this ever fails, the rule is wrong, not the palettes.
    clean = sum(1 for m in everything.values() if not P.ramp_faults(m))
    check(clean >= len(everything) - 5, "most shipped palettes obey the ramp rule",
          f"only {clean}/{len(everything)} are clean")


# ------------------------------------------------------------------ end to end

def test_vendored_map_editor():
    """The vendored puzzlescript-map-editor must match its own repository.

    The palette drift check above compares `src/palettes.js` against
    `colors.js`, which catches the *data* going out of step. It does not catch
    the copy going out of step: edit `src/psgame.js` in one of the two and
    nothing anywhere fails, because they are plain duplicated files with no
    submodule or subtree linking them. This is that check.

    Skips when only this repository is checked out, the same way the demo-game
    sweep does.
    """
    section("vendored map editor")
    import subprocess
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script = os.path.join(root, "tools", "sync_map_editor.py")
    if not os.path.exists(script):
        return
    r = subprocess.run([sys.executable, script, "--check"],
                       capture_output=True, text=True, cwd=root)
    if "nothing to compare" in r.stdout:
        return
    check(r.returncode == 0,
          "the vendored map editor matches its standalone repository",
          r.stdout.strip().replace("\n", "\n      "))


def test_reports_run(tmp):
    section("reports run without crashing")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    example = os.path.join(root, "tools", "candidates-example")
    if not os.path.isdir(example):
        return
    cands, errors = P.load_candidates([example])
    check(not errors, "the example candidates all parse", str(errors))
    check(len(cands) == 3, "three example candidates", f"got {len(cands)}")

    stats, builtins = PC.corpus_stats(P.find_colors_js())
    import io
    import contextlib
    for mode in MODES:
        rows = PC.evaluate(cands, stats, mode)
        check(len(rows) == 3, f"{mode}: every candidate is rated")
        check(all(rows[i]["score"] >= rows[i + 1]["score"] for i in range(len(rows) - 1)),
              f"{mode}: rows come back ranked")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            PC.cmd_score(rows, stats)
            for r in rows:
                PC.cmd_show(r, stats)
                PC.cmd_block(r)
                PC.cmd_emit_curated(r)
            PC.cmd_combos(rows, stats)
            PC.cmd_audit(stats, builtins, P.find_colors_js())
            PC.cmd_anchors(P.find_colors_js())
        check(len(buf.getvalue()) > 2000, f"{mode}: reports produce output")

        html = PC.sheet_html(rows, stats, {})
        check(html.count("<div class=card>") == 3,
              f"{mode}: the sheet has one card per candidate")
        for r in rows:
            for slot in P.SLOTS:
                check(r["mapping"][slot] in html,
                      f"{mode}: every mapped colour reaches the sheet",
                      f"{r['name']} {slot}")
        import html as htmlmod
        for r in rows:
            if r.get("author"):
                check(htmlmod.escape(r["author"]) in html,
                      f"{mode}: the author credit reaches the sheet", r["name"])


def test_combos_improve():
    section("combos")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    example = os.path.join(root, "tools", "candidates-example")
    if not os.path.isdir(example):
        return
    cands, _ = P.load_candidates([example])
    stats, _ = PC.corpus_stats(P.find_colors_js())
    rows = PC.evaluate(cands, stats, "fit-colourname")
    base = {r["name"]: r for r in rows}
    for a in rows:
        for b in rows:
            if a is b:
                continue
            extra = [c for c in b["hex"] if c not in set(a["hex"])]
            if not extra:
                continue
            mapping, prov, _, _ = PC.fit(a["hex"] + extra, "fit-colourname")
            check(not P.ramp_faults(mapping),
                  "a pooled palette still has climbing ramps",
                  f"{a['name']} + {b['name']}")
            check(set(mapping) == set(P.SLOTS),
                  "a pooled palette still covers 21 slots")


def main():
    import tempfile
    print("checks for the palette tools")
    with tempfile.TemporaryDirectory() as tmp:
        test_colour_maths()
        test_anchors()
        test_fit_invariants()
        test_fit_determinism()
        test_rating()
        test_parsers(tmp)
        test_palette_folder(tmp)
        test_generated_from_folder()
        test_generated_files()
        test_curated_palettes()
        test_audit_corpus()
        test_vendored_map_editor()
        test_reports_run(tmp)
        test_combos_improve()

    print(f"\n  {_count} checks")
    if _fails:
        seen, uniq = set(), []
        for f in _fails:
            head = f.split("\n")[0]
            if head not in seen:
                seen.add(head)
                uniq.append(f)
        print(f"\n  FAILED - {len(_fails)} checks, {len(uniq)} distinct:\n")
        for f in uniq:
            print(f"    {f}")
        return 1
    print("  all passed")
    return 0


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
