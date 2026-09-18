# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Keep the vendored copy of puzzlescript-map-editor in step with its own repo.

    uv run tools/sync_map_editor.py --check     does the copy match? (exit 1 if not)
    uv run tools/sync_map_editor.py             standalone -> vendored
    uv run tools/sync_map_editor.py --reverse   vendored -> standalone

`puzzlescript-map-editor/` inside this repository is a plain copy of the
standalone repository of the same name - not a submodule, not a subtree, just
thirty-odd tracked files that happen to be identical. That is deliberate: the
map editor's test suite reaches up into `../../src/demo` and `../../src/js` for
the real-game corpus and the palette table, which only works when it sits
*inside* this repository. A submodule would give the same layout but would not
let the copy carry its own LICENSE line, and a subtree would drag two histories
together for no gain.

What the arrangement does not do is notice when the two copies drift. The
palette drift check in `palette_test.py` compares `src/palettes.js` against
`colors.js`, which is a check on the *data*; edit `src/psgame.js` in one copy
and nothing anywhere fails. This script is that missing check.

The standalone repository is canonical. Edit it there, run this, commit both.

Dependency-free, so `uv run` needs no resolution step.
"""

import argparse
import filecmp
import os
import shutil
import sys

# Directories that are never part of the comparison: git metadata, installed
# packages, and anything either side generates.
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache"}

# Files that are *meant* to differ, with the reason. Keep this list short and
# argued - every entry is a place where the two copies say different things on
# purpose, and an entry added carelessly is drift with permission.
ALLOWED_DIFFERENCES = {
    "LICENSE": "the copyright holder line differs between the two repositories",
}


def find_roots(explicit=None):
    """(vendored, standalone). The standalone is this repo's sibling by default."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    vendored = os.path.join(here, "puzzlescript-map-editor")
    standalone = explicit or os.path.join(os.path.dirname(here),
                                          "puzzlescript-map-editor")
    return vendored, standalone


def walk(root):
    """Every file under root, as paths relative to it."""
    out = set()
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for n in names:
            rel = os.path.relpath(os.path.join(base, n), root)
            out.add(rel.replace(os.sep, "/"))
    return out


def compare(vendored, standalone):
    """(differing, only_in_vendored, only_in_standalone, allowed)."""
    v, s = walk(vendored), walk(standalone)
    differing, allowed = [], []
    for rel in sorted(v & s):
        same = filecmp.cmp(os.path.join(vendored, rel),
                           os.path.join(standalone, rel), shallow=False)
        if same:
            continue
        (allowed if rel in ALLOWED_DIFFERENCES else differing).append(rel)
    return differing, sorted(v - s), sorted(s - v), allowed


def report(differing, only_v, only_s, allowed, verbose=True):
    if verbose and allowed:
        for rel in allowed:
            print(f"  ok       {rel}  ({ALLOWED_DIFFERENCES[rel]})")
    for rel in differing:
        print(f"  DIFFERS  {rel}")
    for rel in only_v:
        print(f"  vendored only    {rel}")
    for rel in only_s:
        print(f"  standalone only  {rel}")


def copy_files(src_root, dst_root, rels):
    for rel in rels:
        src = os.path.join(src_root, rel)
        dst = os.path.join(dst_root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        print(f"  copied   {rel}")


def main():
    ap = argparse.ArgumentParser(
        description="Keep the vendored puzzlescript-map-editor in step with its repo.")
    ap.add_argument("--check", action="store_true",
                    help="report drift and exit 1 if there is any; change nothing")
    ap.add_argument("--reverse", action="store_true",
                    help="copy vendored -> standalone instead of the usual direction")
    ap.add_argument("--standalone", default=None,
                    help="path to the standalone repo (default: this repo's sibling)")
    args = ap.parse_args()

    vendored, standalone = find_roots(args.standalone)
    if not os.path.isdir(vendored):
        print(f"no vendored copy at {vendored}", file=sys.stderr)
        return 2
    if not os.path.isdir(standalone):
        # Not an error: plenty of checkouts have only this repository, and the
        # check is meant to skip in that case the way the demo-game sweep does.
        print(f"no standalone checkout at {standalone} - nothing to compare")
        return 0

    differing, only_v, only_s, allowed = compare(vendored, standalone)

    if args.check:
        report(differing, only_v, only_s, allowed)
        if differing or only_v or only_s:
            n = len(differing) + len(only_v) + len(only_s)
            print(f"\n  {n} file(s) out of step. Run one of:")
            print("    uv run tools/sync_map_editor.py            standalone -> vendored")
            print("    uv run tools/sync_map_editor.py --reverse  vendored -> standalone")
            return 1
        print("  vendored copy matches the standalone repository")
        return 0

    src, dst, label = ((vendored, standalone, "vendored -> standalone")
                       if args.reverse else
                       (standalone, vendored, "standalone -> vendored"))
    todo = list(differing) + (only_v if args.reverse else only_s)
    print(f"  {label}")
    if not todo:
        print("  already in step - nothing to do")
        return 0
    copy_files(src, dst, todo)
    missing = (only_s if args.reverse else only_v)
    if missing:
        print("\n  present only in the destination, left alone - delete by hand "
              "if they are stale:")
        for rel in missing:
            print(f"    {rel}")
    print(f"\n  {len(todo)} file(s) synced. Both repositories now need a commit.")
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
