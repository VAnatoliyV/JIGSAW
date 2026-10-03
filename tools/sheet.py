# contact sheet: python3 tools/sheet.py out.png cols cellW img1 img2 ...  (each frame fit into a cellW x cellW box, aspect kept)
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
ch = max(int(cw * im.height / im.width) if im.height > im.width else cw for im in ims)
ch = min(ch, int(cw * 16 / 9))
rows = (len(ims) + cols - 1) // cols
pad, lab = 8, 26
sheet = Image.new('RGB', (cols * (cw + pad) + pad, rows * (ch + pad + lab) + pad), (20, 20, 24))
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', 16)
except Exception: font = None
for i, (im, f) in enumerate(zip(ims, files)):
    k = min(cw / im.width, ch / im.height); tw, th = int(im.width * k), int(im.height * k)
    x = pad + (i % cols) * (cw + pad); y = pad + (i // cols) * (ch + pad + lab)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x + (cw - tw) // 2, y + lab + (ch - th) // 2))
    d.text((x, y + 4), f.split('/')[-1].rsplit('.', 1)[0], fill=(230, 200, 120), font=font)
sheet.save(out)
print(out, sheet.size)
