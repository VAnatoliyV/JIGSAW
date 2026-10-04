#!/usr/bin/env bash
# Delivery copies from the masters in out/:
#   delivery/albion_journal_<fmt>_web.mp4   full resolution, 2-pass x264, under GitHub's 100 MB file limit
#   out/preview/albion_journal_<fmt>_preview.mp4   small preview under 30 MiB (chat attachments)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p delivery out/preview
enc() { # in out vf vbitrate maxrate
  local in=$1 out=$2 vf=$3 br=$4 mx=$5 log; log="out/preview/pass_$(basename "$out" .mp4)"
  ffmpeg -v error -y -i "$in" -vf "$vf" -c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -b:v "$br" -pass 1 -passlogfile "$log" -an -f mp4 /dev/null
  ffmpeg -v error -y -i "$in" -vf "$vf" -c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -b:v "$br" -maxrate "$mx" -bufsize "$mx" -pass 2 -passlogfile "$log" \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 192k -movflags +faststart "$out"
  rm -f "$log"*
  printf '%-60s %6.1f MB  %s\n' "$out" "$(echo "$(stat -c %s "$out") / 1000000" | bc -l)" "$(ffprobe -v error -show_entries stream=width,height,r_frame_rate,nb_frames -of csv=p=0 -select_streams v "$out")"
}
for f in 9x16 1x1 16x9; do
  M="out/albion_journal_${f}_60fps.mp4"
  case $f in 9x16) web=5800k; pv="scale=720:1280:flags=lanczos";; 1x1) web=4600k; pv="scale=900:900:flags=lanczos";; 16x9) web=5800k; pv="scale=1280:720:flags=lanczos";; esac
  enc "$M" "delivery/albion_journal_${f}_web.mp4" "null" "$web" "9000k"
  enc "$M" "out/preview/albion_journal_${f}_preview.mp4" "$pv" "1600k" "3000k"
done
