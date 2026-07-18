'use strict';

// ---- Palettes (three neon stops each; sampled by the shaders) ----
function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255
  ];
}
const PALETTES = [
  { name: 'Hyper', a: '#ff00e6', b: '#00e5ff', c: '#ffe600' },
  { name: 'Xbox Neon', a: '#00e5ff', b: '#7b5cff', c: '#ff3ea5' },
  { name: 'Acid', a: '#39ff14', b: '#ff00ff', c: '#00ffff' },
  { name: 'Candy', a: '#ff3ea5', b: '#8a5cff', c: '#22e0ff' },
  { name: 'Aurora', a: '#16f2c8', b: '#3ad1ff', c: '#8a5cff' },
  { name: 'Sunset', a: '#ff6b3d', b: '#ff2d78', c: '#ffd24c' },
  { name: 'Vaporwave', a: '#ff71ce', b: '#01cdfe', c: '#b967ff' },
  { name: 'Emerald', a: '#00ffa3', b: '#00d4ff', c: '#0affef' },
  { name: 'Inferno', a: '#ff2200', b: '#ff9500', c: '#ffe600' },
  { name: 'Ice', a: '#7ee8fa', b: '#eec0c6', c: '#4a90e2' }
];

// The five layers the modular scene morphs between (see shaders.js).
const STYLES = ['Swarm', 'Kaleido', 'Tunnel', 'Grid', 'Liquid'];

const state = {
  style: 0,        // current (continuous, eased) style position
  styleTarget: 0,  // style we're morphing toward
  palette: 0,
  sensitivity: 1.1,
  brightness: 0.35,
  bloom: 1.1,
  trails: 0.7,
  autoCycle: true,
  showLyrics: true
};

// Eased palette colours — the live values morph toward the selected palette so
// palette (and auto-cycle) changes cross-fade instead of snapping.
const curCol = { a: hex(PALETTES[0].a), b: hex(PALETTES[0].b), c: hex(PALETTES[0].c) };

const canvas = document.getElementById('gl');
let viz, audio;
try {
  viz = new GLViz(canvas);
} catch (e) {
  showGateError(e.message);
}
audio = new AudioEngine();

// ---- Start / audio capture -------------------------------------------------
// macOS only shows the Screen Recording prompt when the app *actually attempts*
// a capture, and only reports "granted" AFTER approval + relaunch. The old flow
// checked the status first and skipped the capture unless already granted — so
// on a fresh install the prompt never fired and Start dropped straight to the
// mic. Now we always attempt the system-audio capture first (which fires the
// prompt and registers Newon in System Settings), and the mic is an explicit
// opt-in — never a silent surprise.
const startBtn = document.getElementById('startBtn');
const gate = document.getElementById('gate');
const gateStart = document.getElementById('gateStart');
const gatePerm = document.getElementById('gatePerm');

startBtn.addEventListener('click', () => beginListening({ allowMic: false }));
document.getElementById('permRetryBtn').addEventListener('click', () => beginListening({ allowMic: false }));
document.getElementById('micFallbackBtn').addEventListener('click', () => beginListening({ allowMic: true }));
document.getElementById('permOpenBtn').addEventListener('click', () => {
  window.newon && window.newon.openScreenRecordingSettings();
});

async function beginListening({ allowMic }) {
  startBtn.disabled = true;
  startBtn.textContent = 'Connecting…';
  hideGateError();

  // getMediaAccessStatus('screen') is INFORMATIONAL ONLY. It is unreliable for
  // ad-hoc-signed apps — it can read non-"granted" even when Screen Recording is
  // actually on and loopback works — so it must NEVER gate a working capture.
  // Trusting it (and a track's momentary `muted` flag) is exactly what made a
  // genuinely granted permission look broken.
  const access = window.newon ? await window.newon.checkScreenAccess() : 'granted';

  // ALWAYS attempt the system-audio (loopback) capture — main.js supplies the
  // screen source + audio:'loopback'. This also triggers the macOS Screen
  // Recording prompt on first run.
  let sysStream = null;
  try {
    sysStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    sysStream = null;
  }
  const sysTrack = sysStream && sysStream.getAudioTracks()[0];

  // Accept ANY live loopback audio track. Whether audio *actually flows* is
  // decided empirically by the probe below — not by the flaky permission API.
  if (sysTrack && sysTrack.readyState === 'live') {
    try {
      await audio.start(sysStream);
      succeed();
      startAudioProbe();
      return;
    } catch (err) {
      stopStream(sysStream);
    }
  } else if (sysStream) {
    stopStream(sysStream);
  }

  // getDisplayMedia gave us nothing usable (threw, or no audio track at all).
  // Only touch the microphone if the user explicitly asked for it.
  if (allowMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await audio.start(micStream);
      succeed();
      showMicNotice();
      return;
    } catch (err) {
      showStartCard();
      resetStartBtn();
      showGateError('Could not access the microphone. (' + err.message + ')');
      return;
    }
  }

  // Show the Screen Recording gate (with an explicit mic opt-in) instead of
  // silently redirecting to the microphone.
  showPermGate();
  resetStartBtn();
}

function succeed() {
  gate.classList.add('hidden');
  pinGearBriefly();
}
function stopStream(s) { s.getTracks().forEach((t) => t.stop()); }
function resetStartBtn() { startBtn.disabled = false; startBtn.textContent = 'Start Listening'; }
function showStartCard() { gatePerm.classList.add('hidden'); gateStart.classList.remove('hidden'); }
function showPermGate() { gateStart.classList.add('hidden'); gatePerm.classList.remove('hidden'); }
function hideGateError() { document.getElementById('gate-error').classList.add('hidden'); }

function showGateError(msg) {
  const el = document.getElementById('gate-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// After starting a loopback stream, verify audio ACTUALLY flows. macOS can show
// Newon's Screen Recording checkbox as ON yet send pure silence: the grant goes
// stale whenever the app's ad-hoc code signature changes on a rebuild/update,
// and toggling it off/on reuses the same stale entry. REMOVING Newon from the
// list (the "–" button) and re-adding it is what actually fixes it. If no audio
// arrives within a few seconds, say so plainly instead of pretending it worked.
let probe = null;
function startAudioProbe() {
  hidePermHint();
  probe = { start: performance.now(), seen: false };
}
function checkAudioProbe() {
  if (!probe) return;
  if (audio.level > 0.01) {                 // real signal — it's working
    probe = null;
    hidePermHint();
  } else if (performance.now() - probe.start > 6000) {
    probe = null;
    showStalePermBanner();
  }
}
function showStalePermBanner() {
  document.getElementById('permHint-msg').textContent =
    'No system audio is coming through. If you just enabled Screen Recording, ' +
    'fully quit and relaunch Newon. If it already shows enabled, the grant went ' +
    'stale after an update — REMOVE Newon with the “–” button (toggling off/on ' +
    'will NOT fix it), then relaunch and add it back when prompted.';
  document.getElementById('permHint').classList.remove('hidden');
}
function hidePermHint() {
  document.getElementById('permHint').classList.add('hidden');
}

// The mic is a deliberate opt-in; show a dismissible banner so it's never a
// surprise, with a shortcut to fix Screen Recording for full system audio.
function showMicNotice() {
  probe = null;
  document.getElementById('permHint-msg').textContent =
    'Using your microphone. For Spotify audio directly, grant Newon Screen Recording and relaunch.';
  document.getElementById('permHint').classList.remove('hidden');
}
document.getElementById('permHint-btn').addEventListener('click', () => {
  window.newon && window.newon.openScreenRecordingSettings();
});
document.getElementById('permHint-close').addEventListener('click', () => {
  document.getElementById('permHint').classList.add('hidden');
});

// ---- Controls panel ----
const panel = document.getElementById('panel');
const gear = document.getElementById('gear');
gear.addEventListener('click', () => panel.classList.toggle('hidden'));

document.querySelectorAll('#modeSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    state.styleTarget = +b.dataset.style;
    syncModeButtons();
  });
});
function syncModeButtons() {
  const active = Math.round(state.styleTarget) % STYLES.length;
  document.querySelectorAll('#modeSeg button').forEach((x) =>
    x.classList.toggle('active', +x.dataset.style === active)
  );
}

const paletteSel = document.getElementById('paletteSel');
PALETTES.forEach((p, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = p.name;
  paletteSel.appendChild(opt);
});
paletteSel.addEventListener('change', () => (state.palette = +paletteSel.value));

bindSlider('sensitivity');
bindSlider('brightness');
bindSlider('bloom');
bindSlider('trails');
function bindSlider(id) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => (state[id] = +el.value));
}

document.getElementById('autoCycle').addEventListener('change', (e) => (state.autoCycle = e.target.checked));
document.getElementById('showLyrics').addEventListener('change', (e) => {
  state.showLyrics = e.target.checked;
  if (!state.showLyrics) lyricEl.classList.remove('show');
});
document.getElementById('fsBtn').addEventListener('click', toggleFullscreen);

// ---- Spotify (Web API login) ----
const spotifyBtn = document.getElementById('spotifyBtn');
const spotifyGate = document.getElementById('spotifyGate');
let spotifyConnected = false;

function renderSpotifyBtn() {
  spotifyBtn.textContent = spotifyConnected ? 'Connected ✓' : 'Connect';
  spotifyBtn.classList.toggle('connected', spotifyConnected);
}

async function refreshSpotifyState() {
  if (!window.newon || !window.newon.spotifyGetState) { spotifyBtn.style.display = 'none'; return; }
  const s = await window.newon.spotifyGetState();
  spotifyConnected = !!s.connected;
  renderSpotifyBtn();
}

if (window.newon && window.newon.spotifyGetState) {
  refreshSpotifyState();
  if (window.newon.onSpotifyState) {
    window.newon.onSpotifyState((s) => { spotifyConnected = !!s.connected; renderSpotifyBtn(); });
  }

  spotifyBtn.addEventListener('click', async () => {
    if (spotifyConnected) {
      await window.newon.spotifyDisconnect();
      spotifyConnected = false;
      renderSpotifyBtn();
      return;
    }
    const s = await window.newon.spotifyGetState();
    if (!s.hasClientId) { showSpotifyGate(); return; }
    connectSpotify();
  });

  document.getElementById('spCancelBtn').addEventListener('click', () => spotifyGate.classList.add('hidden'));
  document.getElementById('spDashBtn').addEventListener('click', () =>
    window.newon.openExternal('https://developer.spotify.com/dashboard'));
  document.getElementById('spCopyBtn').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText('http://127.0.0.1:8888/callback');
    document.getElementById('spCopyBtn').textContent = 'copied';
  });
  document.getElementById('spConnectBtn').addEventListener('click', async () => {
    const id = document.getElementById('spClientId').value.trim();
    if (!id) { showSpotifyError('Paste your Client ID first.'); return; }
    await window.newon.spotifySetClient(id);
    spotifyGate.classList.add('hidden');
    connectSpotify();
  });
} else {
  spotifyBtn.style.display = 'none';
}

function showSpotifyGate() {
  document.getElementById('spError').classList.add('hidden');
  spotifyGate.classList.remove('hidden');
}
function showSpotifyError(msg) {
  const el = document.getElementById('spError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
async function connectSpotify() {
  spotifyBtn.textContent = 'Connecting…';
  const r = await window.newon.spotifyConnect();
  if (r && r.ok) {
    spotifyConnected = true;
    renderSpotifyBtn();
  } else {
    renderSpotifyBtn();
    if (r && r.error === 'no-client-id') showSpotifyGate();
    else { showSpotifyGate(); showSpotifyError('Connection failed (' + (r && r.error || 'unknown') + '). Check the Client ID and that the Redirect URI is saved exactly.'); }
  }
}

// ---- Keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') panel.classList.toggle('hidden');
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === ' ') { state.styleTarget = (Math.round(state.styleTarget) + 1) % STYLES.length; syncModeButtons(); }
  else if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
});
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// ---- Idle cursor / gear hiding ----
let idleTimer;
function pinGearBriefly() {
  gear.classList.add('pinned');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => gear.classList.remove('pinned'), 2500);
}
window.addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  pinGearBriefly();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    document.body.classList.add('idle');
    gear.classList.remove('pinned');
  }, 2800);
});

// ---- Auto-cycle: advance the style + palette TARGETS; the per-frame easing
// (see frame()) morphs toward them, so every transition is a smooth cross-fade
// rather than a hard cut. ----
setInterval(() => {
  if (!state.autoCycle) return;
  state.styleTarget = (Math.round(state.styleTarget) + 1) % STYLES.length;
  syncModeButtons();
  state.palette = (state.palette + 1) % PALETTES.length;
  paletteSel.value = state.palette;
}, 13000);

// ---- Now playing ----
const npEl = document.getElementById('nowplaying');
const npArt = document.getElementById('np-art');
const npTitle = document.getElementById('np-title');
const npArtist = document.getElementById('np-artist');

let playback = { position: 0, ts: 0, playing: false, duration: 0 };

if (window.newon) {
  window.newon.onNowPlaying((info) => {
    if (!info || !info.name) {
      npEl.classList.remove('show');
      playback.playing = false;
      return;
    }
    npTitle.textContent = info.name;
    npArtist.textContent = info.artist || '';
    if (info.artUrl) {
      npArt.src = info.artUrl;
      npArt.style.display = '';
    } else {
      npArt.style.display = 'none';
    }
    npEl.classList.remove('hidden');
    npEl.classList.add('show');
    playback = {
      position: info.position,
      ts: info.ts,
      playing: info.state === 'playing',
      duration: info.duration
    };
  });

  window.newon.onLyrics((data) => {
    setLyrics(data && data.synced ? parseLRC(data.synced) : null);
  });
}

// ---- Lyrics (synced) ----
const lyricEl = document.getElementById('lyric');
let lyrics = null; // sorted [{ t, text }]
let lyricIdx = -1;

function parseLRC(lrc) {
  const out = [];
  const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  lrc.split('\n').forEach((line) => {
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
      if (text) out.push({ t, text });
    }
  });
  out.sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}

function setLyrics(parsed) {
  lyrics = parsed;
  lyricIdx = -1;
  lyricEl.classList.remove('show');
}

// Interpolate Spotify position between 1s polls for smooth lyric timing.
function currentPosition() {
  if (!playback.ts) return 0;
  let pos = playback.position;
  if (playback.playing) pos += (Date.now() - playback.ts) / 1000;
  return pos;
}

function updateLyrics() {
  if (!state.showLyrics || !lyrics || !playback.playing) {
    if (lyricEl.classList.contains('show') && !state.showLyrics) lyricEl.classList.remove('show');
    return;
  }
  const pos = currentPosition();
  let idx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].t <= pos + 0.15) idx = i;
    else break;
  }
  if (idx !== lyricIdx) {
    lyricIdx = idx;
    if (idx >= 0) {
      const line = lyrics[idx].text;
      // Skip blank gaps; hide during long instrumental stretches.
      const next = lyrics[idx + 1];
      const gap = next ? next.t - lyrics[idx].t : 4;
      if (line && gap < 20) {
        lyricEl.textContent = line;
        lyricEl.classList.remove('hidden');
        lyricEl.classList.add('show');
      } else {
        lyricEl.classList.remove('show');
      }
    } else {
      lyricEl.classList.remove('show');
    }
  }
}

// ---- Smooth morphing: ease the continuous style + palette colours toward
// their targets every frame, so mode/palette switches (and auto-cycle) glide. ----
function easeStyle() {
  let diff = state.styleTarget - state.style;
  // Take the shortest way around the ring of 5 styles (so 4 -> 0 morphs through
  // the short edge, not all the way back).
  if (diff > STYLES.length / 2) diff -= STYLES.length;
  if (diff < -STYLES.length / 2) diff += STYLES.length;
  state.style += diff * 0.04;
  state.style = ((state.style % STYLES.length) + STYLES.length) % STYLES.length;
}
function easeColors() {
  const p = PALETTES[state.palette];
  const tgt = { a: hex(p.a), b: hex(p.b), c: hex(p.c) };
  const k = 0.05;
  ['a', 'b', 'c'].forEach((ch) => {
    for (let i = 0; i < 3; i++) curCol[ch][i] += (tgt[ch][i] - curCol[ch][i]) * k;
  });
}

// ---- Main loop ----
window.addEventListener('resize', () => viz && viz.resize());

const start = performance.now();
function frame() {
  if (viz) {
    viz.resize();
    audio.update();
    checkAudioProbe();
    easeStyle();
    easeColors();
    const t = (performance.now() - start) / 1000;
    viz.render('scene', {
      time: t,
      level: audio.level,
      bass: audio.bass,
      mid: audio.mid,
      treble: audio.treble,
      beat: audio.beat,
      wave: audio.wave,
      style: state.style,
      sensitivity: state.sensitivity,
      brightness: state.brightness,
      bloom: state.bloom,
      // Feedback-warp parameters (per frame, ~60fps). Kept STEADY on purpose:
      // the picture drifts gently outward (zoom just under 1) with a slow
      // one-way rotation, so trails flow continuously outward — a sense of
      // travel, not the back-and-forth rocking a zoom LFO produced. Bass/beats
      // pull you deeper; the scene layers themselves supply the churn and chaos.
      decay: 0.85 + state.trails * 0.12,
      rot: 0.006 + Math.sin(t * 0.02) * 0.008 + audio.beat * 0.02,
      zoom: 0.990 - audio.bass * 0.020 - audio.beat * 0.015,
      hueDrift: 0.03,
      colA: curCol.a,
      colB: curCol.b,
      colC: curCol.c
    });
  }
  updateLyrics();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
