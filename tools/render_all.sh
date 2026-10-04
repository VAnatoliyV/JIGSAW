#!/usr/bin/env bash
# Final renders of all three formats from the same timeline AND the same frozen film version.
#   tools/render_all.sh [fps=60] [workers=2] [audio=assets/audio/final_mix.wav]
#
# One snapshot of film/ + assets/ (minus audio) is taken first and all three formats are rendered
# from it (render.mjs serves it itself; the :8800 server is not used), so edits other agents make
# during the ~50 min run cannot leak into some formats or chunks.  The film sha1 + git rev are
# written into each mp4 (format tag "comment"/"description").
#
# Env: SNAP=<dir>     reuse that snapshot (to resume an interrupted run with the identical film);
#                     default: a new out/.snapshot_<timestamp>, deleted after success.
#      DELIVER=1      also write capped social-upload copies (tools/deliver.mjs) next to the masters.
#      X264_THREADS=2 per-chunk encoder threads.   WORKERS=3 only when the other agents are idle.
#      END=120        (shorter test runs of the whole flow, e.g. END=1)
set -euo pipefail
cd "$(dirname "$0")/.."
FPS="${1:-60}"; WORKERS="${2:-2}"; AUDIO="${3:-assets/audio/final_mix.wav}"
NEW_SNAP=0
if [ -z "${SNAP:-}" ]; then SNAP="out/.snapshot_$(date +%Y%m%d_%H%M%S)"; NEW_SNAP=1; fi
mkdir -p out
T0=$(date +%s)
for f in v s h; do
  case $f in v) name=9x16;; s) name=1x1;; h) name=16x9;; esac
  OUT="out/albion_journal_${name}_${FPS}fps.mp4"
  # skip a format already rendered from this very snapshot (resume with SNAP=...)
  if [ -f "$OUT" ] && [ -f "$SNAP/SNAPSHOT.json" ]; then
    H=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['hash'])" "$SNAP/SNAPSHOT.json")
    TAGS=$(ffprobe -v error -show_entries format_tags=comment,description -of csv=p=0 "$OUT" || true)
    if grep -q "$H" <<<"$TAGS" && grep -q "t=0-${END:-120} ${FPS}fps" <<<"$TAGS"; then
      echo "== $OUT already rendered from snapshot ${H:0:12}, skipping"; continue
    fi
  fi
  echo "== $OUT"
  if ! node tools/render.mjs --fmt "$f" --fps "$FPS" --start 0 --end "${END:-120}" --workers "$WORKERS" \
      --x264-threads "${X264_THREADS:-2}" --snapshot "$SNAP" --audio "$AUDIO" --out "$OUT"; then
    echo "!! $OUT failed. Fix the cause, then resume with the identical film:  SNAP=$SNAP $0 $*"
    exit 1
  fi
  if [ "${DELIVER:-0}" = 1 ]; then
    node tools/deliver.mjs --in "$OUT" --audio "$AUDIO" --start 0 --out "${OUT%.mp4}_social.mp4"
  fi
done
echo "all formats done in $(( ($(date +%s) - T0) / 60 )) min from snapshot $SNAP ($(python3 -c "import json; m=json.load(open('$SNAP/SNAPSHOT.json')); print(m['hash'][:12], m['git'], m['created'])"))"
if [ "$NEW_SNAP" = 1 ]; then rm -rf "$SNAP"; fi
