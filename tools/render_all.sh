#!/usr/bin/env bash
# Final renders of all three formats from the same timeline, one after another.
#   tools/render_all.sh [fps=60] [workers=3] [audio=assets/audio/final_mix.wav]
# Needs the film server on :8800 (cd /home/user/JIGSAW && python3 -m http.server 8800).
set -euo pipefail
cd "$(dirname "$0")/.."
FPS="${1:-60}"; WORKERS="${2:-3}"; AUDIO="${3:-assets/audio/final_mix.wav}"
curl -sf -o /dev/null "http://localhost:8800/film/index.html" || { echo "film server on :8800 is down"; exit 1; }
for f in v s h; do
  case $f in v) name=9x16;; s) name=1x1;; h) name=16x9;; esac
  node tools/render.mjs --fmt "$f" --fps "$FPS" --start 0 --end 120 --workers "$WORKERS" \
    --audio "$AUDIO" --out "out/albion_journal_${name}_${FPS}fps.mp4"
done
