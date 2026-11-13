# Vagal Breath

A paced breathing guide that runs as a Home Screen app on an iPhone. Plain HTML and JavaScript, no build step, no server code.

## Put it online (GitHub Pages)

GitHub Pages serves the `main` branch from the repo root. Push to `main` and the update is live a minute or so later at `https://cloudytech1.github.io/vagal-breath/`.

## Put it on an iPhone

Send the link. They open it in Safari, tap Share, then Add to Home Screen. After the first open it works offline.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app |
| `sw.js` | Offline cache. Bump `VERSION` here and `APP_VERSION` in `index.html` on every release |
| `manifest.webmanifest`, `icons/`, `fonts/` | Home Screen name and icon, and the typefaces |
| `voice/lines.json` | The text of every spoken line |
| `voice/voices.json` | The voices offered in Settings |
| `voice/<id>/*.mp3` | The recordings for each voice |
| `tools/make_voice.py` | Records the lines with your own text-to-speech tool |

## Voices

The three bundled voices were generated with Kokoro (Apache 2.0 license). To add a voice from your own tool, see the notes at the top of `tools/make_voice.py`.

## How the sound works

The spoken guide is recorded clips, played through the same Web Audio graph as the breath sound and bells. The app never uses the phone's built-in speech. That is what stops the voice and the breath sound from cutting each other off on iOS.
