# Vagal Breath

A paced breathing guide that installs to the iPhone home screen and works offline.

Plain static files, no build step. Any https static host works (GitHub Pages, Netlify, Cloudflare Pages, or your own server).

## Files
- index.html, styles.css, app.js: the app
- manifest.webmanifest, icons/: home screen name and icons
- sw.js: offline cache. Bump VERSION in sw.js whenever you change a file, or phones keep the old copy.
- fonts/: Spectral and Figtree (SIL Open Font License), served locally so the app works offline

## Install on iPhone
Open the https address in Safari, tap Share, then Add to Home Screen.

## Notes
- Sound and speech start from the Begin tap, as iOS requires.
- Vibration is not available to web apps in iOS Safari, so it is left out.
- During a session the app plays a silent looping audio track. This keeps iOS on its media channel, so the breath sound plays alongside the spoken cues and is not muted by the ringer switch. It may show as playing audio in Control Center.
- The screen stays awake during a session where the browser supports it.
- Settings are saved on the phone only.
