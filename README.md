<div align="center">

# ◤ NEWON ◢

**A modern, neon music visualizer for macOS.**
It "hears" whatever you're playing (Spotify) and paints it in flowing light —
a love letter to the Xbox 360 *Neon* visualizer, rebuilt with WebGL.

<br />

### ⬇️ [**Install Newon for macOS**](https://github.com/jomcabe/neonvisualizermodern/releases/latest)

[![Download](https://img.shields.io/badge/Download-macOS%20.dmg-16f2c8?style=for-the-badge&logo=apple&logoColor=black)](https://github.com/jomcabe/neonvisualizermodern/releases/latest)
[![Build](https://github.com/jomcabe/neonvisualizermodern/actions/workflows/build.yml/badge.svg)](https://github.com/jomcabe/neonvisualizermodern/actions/workflows/build.yml)

*Universal build · Apple Silicon & Intel · macOS 13 (Ventura) or later*

</div>

---

## What it does

Newon captures your Mac's **system audio** and turns it into a full-screen,
beat-reactive light show. No cables, no "share your screen" gymnastics — click
**Start Listening**, grant permission once, and it reacts to Spotify (or any app).

### Features

| | |
|---|---|
| 🎧 **Hears your music** | Captures system audio via macOS ScreenCaptureKit loopback — reacts to Spotify, Apple Music, YouTube, anything. Falls back to the mic if needed. |
| 🌈 **Neon ribbons + bloom** | The signature Xbox look: flowing, glowing light ribbons over black, warped by the music, with a real bloom glow pass. |
| 🌀 **Kaleidoscope tunnel** | A second mode — a beat-reactive geometric tunnel that folds and pulses on the bass. |
| 🎵 **Subtle now-playing** | Current track tucked in the corner (read straight from Spotify — no login). |
| ✨ **Synced lyrics** | When available, the current lyric line is sprinkled in at the bottom, timed to playback (via [lrclib.net](https://lrclib.net)). |
| 🎚 **Presets & sliders** | 7 neon palettes (incl. classic *Xbox Neon*), plus sensitivity, brightness, and glow sliders. Optional auto-cycle. |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `C` | Toggle the settings panel |
| `F` | Toggle fullscreen |
| `Space` | Switch visual mode |
| `Esc` | Exit fullscreen |

---

## Install

1. Download the `.dmg` from the button above (or the
   [Releases page](https://github.com/jomcabe/neonvisualizermodern/releases/latest)).
2. Open it and drag **Newon** into **Applications**.
3. Because the app is unsigned (personal build), the first launch needs a
   Gatekeeper bypass: **right-click Newon → Open → Open**.
4. Click **Start Listening**. macOS will ask for **Screen Recording** permission —
   this is what lets Newon capture system audio. Approve it, then relaunch if asked.
5. Play something in Spotify. 🎉

> **Why Screen Recording?** macOS routes system-audio capture through the same
> ScreenCaptureKit permission as screen recording. Newon never records or
> transmits your screen — it only reads the audio.

---

## Run from source / develop

```bash
git clone https://github.com/jomcabe/neonvisualizermodern.git
cd neonvisualizermodern
npm install
npm start          # launches the app in dev
```

Build your own `.dmg` locally:

```bash
npm run dist       # outputs dist/Newon-<version>-universal.dmg
```

### How a release is cut

Pushing a tag that starts with `v` triggers the GitHub Actions workflow, which
builds a universal `.dmg` on a macOS runner and attaches it to a new Release
(that's what the Download button points at):

```bash
git tag v0.1.0
git push origin v0.1.0
```

You can also run the **Build Newon (macOS)** workflow manually from the Actions
tab to produce a downloadable artifact without publishing a release.

---

## Architecture

```
src/
├── main.js       Electron main — window, system-audio loopback handler,
│                 Spotify now-playing (AppleScript), lyrics fetch (lrclib)
├── preload.js    Safe context-bridge to the renderer
├── index.html    UI: canvas, now-playing, lyrics, controls
├── renderer.js   Orchestration: audio capture, palettes, UI, lyric sync, loop
├── audio.js      Web Audio analyser → smoothed bass/mid/treble/level + beats
├── gl.js         WebGL2 pipeline: scene → bright-pass → blur → bloom composite
└── shaders.js    GLSL: ribbons, tunnel, and the bloom post shaders
```

No runtime dependencies beyond Electron — the visuals are hand-written WebGL2,
so the app stays small and starts instantly.

---

## Notes & limitations

- **macOS 13+** is required for system-audio loopback capture.
- Now-playing and lyrics are **Spotify-specific** (via AppleScript). Other
  players still drive the visuals; they just won't show track info.
- Lyrics are best-effort from a community database — not every track has them.
- The build is **unsigned**. For personal use the right-click-Open bypass is
  all you need; there's no Apple Developer certificate involved.

## License

MIT © jomcabe
