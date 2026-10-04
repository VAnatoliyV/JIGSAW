# Compare frames of a rendered mp4 with direct single-frame renders (tools/frames.mjs PNGs).
#   python3 tools/verify_frames.py <video.mp4> <fps> <start> <ref_dir> <fmt> t1 t2 ...
# For each t: frame index k = round((t - start) * fps) is decoded (exact, select by n), converted
# back to RGB (BT.709 limited) and compared with <ref_dir>/<fmt>_<t>.png.  If a reference for the
# previous frame (t - 1/fps) exists too, the decoded frame is also compared with it: the correct
# frame must be clearly closer to its own reference than to its neighbour (no stale/shifted frame).
import subprocess, sys, os
import numpy as np
from PIL import Image

video, fps, start, ref, fmt = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
ts = [float(x) for x in sys.argv[6:]]
info = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], capture_output=True, text=True).stdout.strip().split(',')
w, h = int(info[0]), int(info[1])

def decode(k):
    vf = f'select=eq(n\\,{k}),scale=in_range=tv:in_color_matrix=bt709:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24'
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(np.int16)

def refimg(t):
    p = os.path.join(ref, f'{fmt}_{f"{t:.2f}".rjust(6, "0")}.png')
    return np.asarray(Image.open(p).convert('RGB')).astype(np.int16) if os.path.exists(p) else None

def stats(a, b):
    a, b = a.astype(np.float64), b.astype(np.float64)
    d = np.abs(a - b)
    mse = np.mean((a - b) ** 2)
    return d.mean(), np.percentile(d, 99.9), (99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse))

print(f'{"t":>7} {"frame":>6} {"MAE":>6} {"p99.9":>6} {"PSNR dB":>8} | {"MAE vs prev-frame ref":>22} {"ref(t) vs ref(t-1f)":>20}  verdict')
worst = 0
for t in ts:
    k = round((t - start) * fps)
    a = decode(k)
    r = refimg(t)
    if r is None:
        print(f'{t:7.3f} missing reference'); continue
    mae, p999, psnr = stats(a, r)
    worst = max(worst, mae)
    rp = refimg(t - 1 / fps)
    prev = ''
    verdict = 'OK' if mae < 3 else 'CHECK'
    if rp is not None:
        pm = stats(a, rp)[0]
        rr = stats(r, rp)[0]
        prev = f'{pm:22.2f} {rr:20.2f}'
        if pm <= mae and rr > 2 * mae: verdict = 'STALE?'
        elif rr <= mae: verdict += ' (static: prev frame ~identical)'
    print(f'{t:7.3f} {k:6d} {mae:6.2f} {p999:6.0f} {psnr:8.2f} | {prev:>22}  {verdict}')
print(f'worst MAE {worst:.2f} (0-255 scale, all channels)')
