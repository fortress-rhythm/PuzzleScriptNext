#!/bin/sh
# Serve this checkout locally, the way runserver.bat does on Windows.
#
#   ./runserver.sh            http://localhost:8020/
#   PORT=8080 ./runserver.sh
#
# Needed for EXPORT and SHARE in the editor and for "Try the example" in the
# map editor, which fetch files and so cannot run from a file:// page. Everything
# else works by double-clicking the .html files.
#
# Uses Node if it is installed (the same zero-dependency server the map editor
# ships), otherwise Python's built-in server. One of the two is on nearly every
# machine; neither needs anything installed with npm or pip.
cd "$(dirname "$0")"
PORT="${PORT:-8020}"
if command -v node >/dev/null 2>&1; then
    exec env PORT="$PORT" node puzzlescript-map-editor/src/serve.js --root .
elif command -v python3 >/dev/null 2>&1; then
    echo "Serving http://localhost:$PORT/ (python)"
    exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
    echo "Serving http://localhost:$PORT/ (python)"
    exec python -m http.server "$PORT"
else
    echo "Need node or python3 on the PATH to serve the site." >&2
    exit 1
fi
