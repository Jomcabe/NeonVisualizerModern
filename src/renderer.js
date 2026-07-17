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
  { name: 'Xbox Neon', a: '#00e5ff', b: '#7b5cff', c: '#ff3ea5' },
  { name: 'Aurora', a: '#16f2c8', b: '#3ad1ff', c: '#8a5cff' },
  { name: 'Sunset', a: '#ff6b3d', b: '#ff2d78', c: '#ffd24c' },
  { name: 'Vaporwave', a: '#ff71ce', b: '#01cdfe', c: '#b967ff' },
  { name: 'Emerald', a: '#00ffa3', b: '#00d4ff', c: '#0affef' },
  { name: 'Inferno', a: '#ff2200', b: '#ff9500', c: '#ffe600' },
  { name: 'Ice', a: '#7ee8fa', b: '#eec0c6', c: '#4a90e2' }
];

const state = {
  mode: 'ribbons',
  palette: 0,
  sensitivity: 1.1,
  brightness: 0.35,
  bloom: 1.1,
  trails: 0.7,
  autoCycle: true,
  showLyrics: true
};

const canvas = document.getElementById('gl');
let viz, audio;
try {
  viz = new GLViz(canvas);
} catch (e) {
  showGateError(e.message);
}
audio = new AudioEngine();

// ---- Start / audio capture ----
const startBtn = document.getElementById('startBtn');
const gate = document.getElementById('gate');

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Connecting…';
  try {
    // Ask macOS directly instead of guessing from a caught error — that way
    // a denied/not-yet-granted Screen Recording permission is reported as
    // what it is, rather than silently swapped for the microphone.
    const access = window.newon ? await window.newon.checkScreenAccess() : 'granted';
    let stream = null;
    if (access === 'granted') {
      try {
        // System-audio loopback (main.js supplies the source + audio:'loopback').
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (err) {
        // Granted but the capture itself failed (e.g. user cancelled the
        // picker) — fall through to mic below.
      }
    }
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    await audio.start(stream);
    gate.classList.add('hidden');
    pinGearBriefly();
    if (access !== 'granted') {
      showPermissionHint(access);
    }
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = 'Start Listening';
    showGateError('Could not capture any audio. (' + err.message + ')');
  }
});

function showGateError(msg) {
  const el = document.getElementById('gate-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// Persistent banner (not just the one-time gate) — Spotify audio needs
// Screen Recording, and macOS often re-revokes it after a rebuild/update,
// so this can resurface long after the first launch.
function showPermissionHint(access) {
  const el = document.getElementById('permHint');
  const msg = access === 'denied'
    ? 'Screen Recording permission is denied, so Newon is using your microphone instead of Spotify directly.'
    : 'Newon needs Screen Recording permission to hear Spotify directly. Using the microphone for now.';
  document.getElementById('permHint-msg').textContent = msg;
  el.classList.remove('hidden');
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
    document.querySelectorAll('#modeSeg button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.mode = b.dataset.mode;
  });
});

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

// ---- Keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') panel.classList.toggle('hidden');
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === ' ') { state.mode = state.mode === 'ribbons' ? 'tunnel' : 'ribbons'; syncModeButtons(); }
  else if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
});
function syncModeButtons() {
  document.querySelectorAll('#modeSeg button').forEach((x) =>
    x.classList.toggle('active', x.dataset.mode === state.mode)
  );
}
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

// ---- Auto-cycle palettes and modes (like the original Neon) ----
let cycleTick = 0;
setInterval(() => {
  if (!state.autoCycle) return;
  cycleTick++;
  state.palette = (state.palette + 1) % PALETTES.length;
  paletteSel.value = state.palette;
  // Every other tick, switch visual mode too; the feedback trails carry over,
  // so the handoff reads as a morph rather than a hard cut.
  if (cycleTick % 2 === 0) {
    state.mode = state.mode === 'ribbons' ? 'tunnel' : 'ribbons';
    syncModeButtons();
  }
}, 18000);

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

// ---- Main loop ----
window.addEventListener('resize', () => viz && viz.resize());

const start = performance.now();
function frame() {
  if (viz) {
    viz.resize();
    audio.update();
    const p = PALETTES[state.palette];
    const t = (performance.now() - start) / 1000;
    viz.render(state.mode, {
      time: t,
      level: audio.level,
      bass: audio.bass,
      mid: audio.mid,
      treble: audio.treble,
      beat: audio.beat,
      wave: audio.wave,
      sensitivity: state.sensitivity,
      brightness: state.brightness,
      bloom: state.bloom,
      // Feedback-warp parameters (per frame, ~60fps): trails persistence,
      // slow wandering rotation, and an outward zoom that surges on bass.
      // The tunnel keeps shorter trails so its ring structure stays crisp.
      decay: state.mode === 'tunnel' ? 0.62 + state.trails * 0.25 : 0.82 + state.trails * 0.16,
      rot: Math.sin(t * 0.05) * 0.006 + audio.beat * 0.002,
      zoom: 0.9945 - audio.bass * 0.006 - audio.beat * 0.004,
      hueDrift: 0.012,
      colA: hex(p.a),
      colB: hex(p.b),
      colC: hex(p.c)
    });
  }
  updateLyrics();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
