#!/usr/bin/env python3
"""Record the Vagal Breath guide lines with your own text-to-speech tool.

Run this from the repo root, on the machine that hosts the voice tool (or any machine that can reach it).
Needs Python 3 and ffmpeg. No other packages.

Two ways to use it:

1) Your tool has an OpenAI-style speech endpoint (most self-hosted TTS servers do):

     python3 tools/make_voice.py --id mine --name "My voice" \
         --url http://localhost:8880/v1/audio/speech --model tts-1 --voice af_heart --speed 0.9

2) Your tool is something else. Generate one audio file per line yourself, named after the
   line id in voice/lines.json (intro.wav, in1.wav, ...), put them in a folder, then:

     python3 tools/make_voice.py --id mine --name "My voice" --from-dir /path/to/wavs

Either way the script trims silence, evens out loudness, writes voice/<id>/<line>.mp3, and adds the
voice to voice/voices.json so it shows up in the app's Voice list. Commit and push, then bump
VERSION in sw.js and APP_VERSION in index.html so phones pick up the change.
"""
import argparse, json, pathlib, subprocess, sys, tempfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOICE = ROOT / "voice"
FILTER = ("silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
          "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
          "loudnorm=I=-18:TP=-2,afade=t=in:d=0.02")

def synth(url, model, voice, speed, text, key):
    body = json.dumps({"model": model, "input": text, "voice": voice,
                       "response_format": "wav", "speed": speed}).encode()
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    with urllib.request.urlopen(urllib.request.Request(url, body, headers), timeout=300) as r:
        return r.read()

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True, help="folder name for this voice, letters/digits/underscore")
    ap.add_argument("--name", required=True, help="name shown in the app")
    ap.add_argument("--url", help="OpenAI-style endpoint, e.g. http://localhost:8880/v1/audio/speech")
    ap.add_argument("--model", default="tts-1")
    ap.add_argument("--voice", default="alloy", help="voice name your tool expects")
    ap.add_argument("--speed", type=float, default=0.9)
    ap.add_argument("--api-key", default="")
    ap.add_argument("--from-dir", help="folder of ready-made audio files named <line id>.<wav|mp3|flac|m4a|ogg>")
    a = ap.parse_args()
    if not a.url and not a.from_dir:
        sys.exit("Give either --url or --from-dir.")

    lines = json.loads((VOICE / "lines.json").read_text())
    out = VOICE / a.id
    out.mkdir(parents=True, exist_ok=True)
    made = 0
    with tempfile.TemporaryDirectory() as tmp:
        for lid, text in lines.items():
            if a.from_dir:
                found = [p for p in pathlib.Path(a.from_dir).glob(f"{lid}.*")]
                if not found:
                    print(f"  missing {lid} (\"{text}\"), skipped"); continue
                src = found[0]
            else:
                src = pathlib.Path(tmp) / f"{lid}.wav"
                src.write_bytes(synth(a.url, a.model, a.voice, a.speed, text, a.api_key))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", FILTER,
                            "-ac", "1", "-ar", "44100", "-b:a", "80k", str(out / f"{lid}.mp3")], check=True)
            made += 1
            print(f"  {lid}: {text}")
    cfg_path = VOICE / "voices.json"
    cfg = json.loads(cfg_path.read_text())
    cfg["voices"] = [v for v in cfg["voices"] if v["id"] != a.id]
    cfg["voices"].insert(0, {"id": a.id, "name": a.name})  # first in the list is the default for new users
    cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")
    print(f"Wrote {made} of {len(lines)} lines to {out}. Listed as \"{a.name}\" in voices.json.")

if __name__ == "__main__":
    main()
