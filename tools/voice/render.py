#!/usr/bin/env python3
"""Turn an episode script into the mp3 that gets published (jwildfire/obot.roadmap#280).

This is the local half of the audio lane, and it is here because until 2026-08-20 it was
nowhere: the three decision episodes published on 2026-08-18 were rendered by a
hand-written script that lived only in one job's scratch directory, one cleanup away from
having to be reinvented by whoever wrote the next episode. Everything below is that
script's behaviour, unchanged where it mattered — same voice, same speed, same silence
between paragraphs — so an episode rendered today sounds like the ones he has already
heard.

Usage, from anywhere:

    /Users/jwildfire/.config/save-to-spotify/kokoro-env/bin/python3 \\
        obot.agent/tools/voice/render.py <script.txt> <out.mp3>

The interpreter matters. Kokoro's dependencies live in that venv and nowhere else on this
machine — the system python has no `kokoro_onnx`, no `numpy` and no `soundfile`. The
canonical way to find it is the `kokoro_python` field of `save-to-spotify --json tts
status`; it is hard-coded in the usage line above only because that is what it has been
since 2026-08-18.

BLANK LINES ARE THE CHUNK BOUNDARY. Each paragraph is synthesised on its own and 0.35s of
silence is inserted between them, which is what gives the published episodes their pacing.
A script written as one wall of text renders as one breathless block.

Synthesis is local and offline: it costs no tokens and no money, and it needs no network.
It runs at roughly five times real time, so a five-minute episode takes about a minute.
"""
import glob
import os
import re
import subprocess
import sys

VOICE = "af_heart"
SPEED = 1.0
GAP_SECONDS = 0.35
CONFIG = os.path.expanduser("~/.config/save-to-spotify")


def find(pattern):
    """The newest model file matching a glob, looked for where `tts setup` puts them."""
    for d in (os.path.join(CONFIG, "kokoro-env"), CONFIG):
        hits = glob.glob(os.path.join(d, pattern))
        if hits:
            return sorted(hits)[-1]
    raise FileNotFoundError(
        f"{pattern} not found under {CONFIG} — run `save-to-spotify tts setup --engine kokoro`"
    )


def main(argv):
    if len(argv) < 3:
        sys.stderr.write(f"usage: {argv[0]} <script.txt> <out.mp3|out.wav>\n")
        return 2
    src, out = argv[1], argv[2]

    # Imported here rather than at the top so the usage error above works under any
    # interpreter, instead of failing with an import error that says nothing useful.
    from kokoro_onnx import Kokoro  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    import soundfile as sf  # noqa: PLC0415

    with open(src) as fh:
        text = fh.read().strip()
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    words = len(text.split())
    print(f"{words} words in {len(paragraphs)} paragraphs", flush=True)

    kokoro = Kokoro(find("kokoro-v*.onnx"), find("voices-v*.bin"))
    chunks, rate = [], None
    for i, para in enumerate(paragraphs):
        samples, rate = kokoro.create(para, voice=VOICE, speed=SPEED)
        chunks.append(samples)
        chunks.append(np.zeros(int(rate * GAP_SECONDS)))
        if i % 5 == 0:
            print(f"  {i + 1}/{len(paragraphs)}", flush=True)

    combined = np.concatenate(chunks)
    wav = out if out.endswith(".wav") else f"{os.path.splitext(out)[0]}.wav"
    sf.write(wav, combined, rate)
    seconds = len(combined) / rate

    if not out.endswith(".wav"):
        # 128k mp3, the same encode the published episodes use. `check=True` because a
        # silently missing mp3 next to a perfectly good wav is the kind of half-success
        # that gets published as a broken episode.
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "128k", out],
            check=True,
        )

    # The measured rate, printed every time, because the constant in speech.mjs was wrong
    # for two days on the strength of nobody ever checking one against the other.
    print(
        f"wrote {out}  {seconds / 60:.1f} min ({seconds:.1f}s)  "
        f"= {words / (seconds / 60):.0f} words per minute",
        flush=True,
    )
    if seconds > 5 * 60:
        print("  OVER the five minute guideline — say why in the episode, or cut it.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
