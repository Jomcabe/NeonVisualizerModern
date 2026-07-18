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
| 🌈 **Neon light-forms + bloom** | The signature Xbox look: swarms of bright particle sprites (not vector lines), color-cycled across the spectrum, folded through kaleidoscope symmetry and driven into recursive light-tunnels by a strong bass-reactive video-feedback loop — the same feedback-zoom technique Jeff Minter's original Neon used. |
| 🌀 **Feedback tunnel** | A second mode — a radial spoke/ring seed that the feedback zoom stretches into an endless receding tunnel, rushing and twisting on the beat. |
| 🎵 **Now-playing (any device)** | Log in with your Spotify account once and Newon shows the current track — playing on desktop, web, or phone. Falls back to the Spotify desktop app via AppleScript if you don't connect. |
| ✨ **Synced lyrics** | When available, the current lyric line is sprinkled in at the bottom, timed to playback (via [lrclib.net](https://lrclib.net)). |
| 🎚 **Presets & sliders** | 7 neon palettes (incl. classic *Xbox Neon*), plus sensitivity, brightness, glow, and trail-length sliders. Optional auto-cycle. |

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
3. Because the app has no Apple Developer certificate (personal build, ad-hoc
   signed), the first launch needs a Gatekeeper bypass:
   **right-click Newon → Open → Open**.
4. Click **Start Listening**. macOS will pop the **Screen Recording** prompt —
   this is what lets Newon capture system audio. Turn **Newon** on, then **fully
   quit and relaunch** (macOS never applies the grant to an already-running app).
5. Hit **Start Listening** again and play something in Spotify. 🎉

> Newon will **not** silently switch to your microphone. If Screen Recording
> isn't granted, it shows a permission screen with a one-click shortcut to
> System Settings — using the mic is an explicit opt-in on that screen.

> **Why Screen Recording?** macOS routes system-audio capture through the same
> ScreenCaptureKit permission as screen recording. Newon never records or
> transmits your screen — it only reads the audio.

### "Newon is damaged and can't be opened"

Builds downloaded before the app was ad-hoc signed were fully unsigned, and
macOS reports quarantined unsigned apps as *damaged* (with no right-click
bypass offered) — on Apple Silicon they won't launch at all. Grab the newest
`.dmg` from Releases, or clear the quarantine flag on an already-installed
copy:

```bash
xattr -cr /Applications/Newon.app
```

Then launch with right-click → Open as usual.

### Connecting Spotify (now-playing / lyrics)

Open the settings panel (gear or **C**) and click **Spotify → Connect**. Because
Spotify requires every app to have its own **Client ID**, there's a one-time
setup the first time:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and **Create app** (any name; tick **Web API**).
2. Add this exact **Redirect URI** and save: `http://127.0.0.1:8888/callback`
3. Copy the app's **Client ID**, paste it into Newon, and click **Connect** — a
   browser tab opens to approve access, then you're done. The login persists.

Once connected, Newon reads whatever you're playing on **any** device (desktop,
web, or phone). Without connecting, it falls back to reading the Spotify desktop
app locally (which needs the app running and Automation permission).

### "It keeps using my microphone instead of Spotify"

Newon needs **Screen Recording** permission for system-audio loopback. Two
things make this trip people up on macOS, and Newon now handles both:

1. **The prompt only fires when the app actually attempts a capture.** Newon now
   always attempts the system-audio capture on **Start Listening**, so the macOS
   Screen Recording prompt actually appears and Newon gets registered under
   **System Settings → Privacy & Security → Screen Recording**.
2. **The grant never applies to a running app.** After you toggle Newon on, you
   must **fully quit and relaunch** — approving it mid-session does nothing until
   the next launch.

Newon **no longer silently redirects to the mic**. If Screen Recording isn't
granted, it shows a permission screen with a one-click shortcut to the right
Settings pane; the microphone is an explicit *"Use my microphone instead"*
opt-in on that screen. macOS also ties the grant to the app's code signature, so
**rebuilding/updating Newon can revoke it** — just re-toggle and relaunch.

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
├── audio.js      Web Audio analyser → waveform + smoothed bass/mid/treble/level + beats
├── gl.js         WebGL2 pipeline: scene → feedback trails → bright-pass → blur → bloom
└── shaders.js    GLSL: neon light-forms, tunnel, video feedback, bloom post shaders
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
