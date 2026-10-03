import json, sys, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
TL = json.load(open('/home/user/JIGSAW/timeline/timeline.json'))
voice = sys.argv[1]; speed = float(sys.argv[2]); out = sys.argv[3]
import os; os.makedirs(out, exist_ok=True)
k = Kokoro("/home/user/JIGSAW/tools/models/kokoro-v1.0.onnx", "/home/user/JIGSAW/tools/models/voices-v1.0.bin")
lang = "en-gb" if voice[0] == 'b' else "en-us"
vo = TL['vo']
for i, v in enumerate(vo):
    ph = k.tokenizer.phonemize(v['text'], lang)
    ph = ph.replace('keəlɪən', 'kɑːlˈiːən')  # Caerleon: kar-LEE-on
    a, sr = k.create(ph, voice=voice, speed=speed, lang=lang, is_phonemes=True)
    # trim leading/trailing silence
    env = np.abs(a) > 0.01
    idx = np.where(env)[0]; a = a[max(0, idx[0]-240): idx[-1]+2400]
    sf.write(f"{out}/{v['id']}.wav", a, sr)
    nxt = vo[i+1]['t'] if i+1 < len(vo) else 120
    d = len(a)/sr
    print(f"{v['id']:5s} {v['t']:6.2f} dur {d:5.2f} ends {v['t']+d:6.2f} next {nxt:6.2f} {'OVER' if v['t']+d > nxt-0.15 else ''}  {v['text'][:60]}")
