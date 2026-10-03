import soundfile as sf, time
from kokoro_onnx import Kokoro
k = Kokoro("models/kokoro-v1.0.onnx", "models/voices-v1.0.bin")
print(sorted(k.get_voices()))
line = "Every city sets its own price. Every craft hides a tax. And somewhere in Albion, a profit is waiting for you."
for v in ["bm_george","bm_fable","bm_lewis","bm_daniel","am_michael","am_fenrir","am_onyx","am_puck"]:
    t=time.time()
    samples, sr = k.create(line, voice=v, speed=0.95, lang="en-gb" if v.startswith('b') else "en-us")
    sf.write(f"../scratch_vo/{v}.wav", samples, sr)
    print(v, sr, len(samples)/sr, round(time.time()-t,1))
