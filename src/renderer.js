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

const MODES = ['flight', 'neon', 'tunnel'];

const state = {
  mode: 'flight',
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
// The banner's action button opens whichever Settings pane the current
// message is about (Screen Recording by default; Automation for Spotify).
let permHintAction = 'screen';
document.getElementById('permHint-btn').addEventListener('click', () => {
  if (!window.newon) return;
  if (permHintAction === 'automation') window.newon.openAutomationSettings();
  else window.newon.openScreenRecordingSettings();
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
  else if (e.key === ' ') { state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]; syncModeButtons(); }
  else if (e.key === 'r' || e.key === 'R') rerollGenes(); // instant new form
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
    state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
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

  // The Spotify now-playing read rides on the macOS Automation permission,
  // which (like Screen Recording) is tied to the app's code signature — an
  // update can silently revoke it. Surface the live connection state right in
  // the settings panel, and raise the banner when macOS is the blocker.
  let automationWarned = false;
  window.newon.onSpotifyStatus((status) => {
    setSpotifyState(status);
    if (status === 'denied' && !automationWarned) {
      automationWarned = true;
      permHintAction = 'automation';
      document.getElementById('permHint-msg').textContent =
        'Newon can’t read Spotify’s now-playing info — macOS revoked its ' +
        'Automation permission (this happens after updates). Open Automation ' +
        'settings, turn Spotify ON under Newon, then relaunch Newon.';
      document.getElementById('permHint').classList.remove('hidden');
    } else if (status === 'ok' && permHintAction === 'automation') {
      permHintAction = 'screen';
      document.getElementById('permHint').classList.add('hidden');
    }
  });
}

const spState = document.getElementById('spotifyState');
document.getElementById('spotifyFixBtn').addEventListener('click', () => {
  window.newon && window.newon.openAutomationSettings();
});
function setSpotifyState(status) {
  const fix = document.getElementById('spotifyFixBtn');
  fix.classList.add('hidden');
  spState.classList.remove('ok', 'bad');
  if (status === 'ok') { spState.textContent = 'connected ✓'; spState.classList.add('ok'); }
  else if (status === 'idle') { spState.textContent = 'connected · paused'; spState.classList.add('ok'); }
  else if (status === 'notrunning') spState.textContent = 'open Spotify to connect';
  else if (status === 'denied') {
    spState.textContent = 'blocked by macOS';
    spState.classList.add('bad');
    fix.classList.remove('hidden');
  } else spState.textContent = 'unavailable';
}
if (!window.newon) setSpotifyState('unavailable');

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

// ---- Visual DNA ("genes") ----
// Every ~10-20 seconds (and occasionally right on a beat) the visual DNA
// re-rolls: fold symmetry, Kali-fractal offsets, tunnel radius, twist, shape
// sizes and tumbling speed, hue behaviour, ride speed. Continuous genes ease
// toward their new targets over several seconds so the picture *morphs* into
// each new form; the fold count snaps (a new symmetry reads as a new preset,
// exactly how the original Neon jumps between forms). The result: the same
// song never looks the same twice.
function makeGenes() {
  const r = Math.random;
  return {
    folds: 2 + Math.floor(r() * 5),        // 2..6-fold kaleido symmetry
    kx: 0.45 + r() * 1.05,                 // Kali IFS offset — the fractal's
    ky: 0.45 + r() * 1.05,                 // whole character lives in these
    kz: 0.35 + r() * 0.85,
    twist: (r() * 2 - 1) * 1.4,            // corkscrew along the track
    warp: 0.2 + r() * 1.0,                 // liquid domain-warp amount
    radius: 1.15 + r() * 1.35,             // tunnel radius
    detail: 0.35 + r() * 1.05,             // fractal wall displacement
    hueSpeed: 0.06 + r() * 0.22,
    huePhase: r(),
    shapeSize: 0.24 + r() * 0.42,          // floating-shape scale
    spread: 1.9 + r() * 2.3,               // spacing between floating shapes
    spin: (r() * 2 - 1) * 2.2,             // shape tumble speed/direction
    sway: (r() * 2 - 1) * 0.55,            // extra camera roll wander
    shake: 0.25 + r() * 0.75,              // turbulence intensity
    speed: 1.6 + r() * 2.8                 // base ride speed
  };
}

const genes = makeGenes();          // eased, live values fed to the shaders
let geneTarget = makeGenes();
let nextRoll = 0;                   // silence fallback — music re-rolls first
function rerollGenes() {
  geneTarget = makeGenes();
  genes.folds = geneTarget.folds;   // symmetry snaps — reads as a new preset
  nextRoll = perfT() + 22 + Math.random() * 14;
}
function perfT() { return (performance.now() - start) / 1000; }

// ---- Main loop ----
window.addEventListener('resize', () => viz && viz.resize());

const start = performance.now();
let camDist = 0;                    // distance travelled along the ride
let lastFrameT = 0;
let rotDir = 1;                     // trail-spin direction, flipped by hi-hats
let prevTrebBeat = 0;

// ---- Motion choreography ----
// The ride is a sequence of smooth manoeuvres, not a constant forward push:
// cruises, rushes, slow drifts, brief BACKWARDS pulls, lazy barrel spins
// through the tunnel, and look-around turns where the gaze wanders off the
// track while travel continues along it. New manoeuvres are picked when the
// music changes section (or every few seconds as a fallback), and every value
// eases with ~2s time constants, so nothing ever snaps.
const motion = {
  vel: 1.5, velTarget: 1.5,         // along-track speed; negative = backwards
  spin: 0, spinVel: 0.12, spinVelTarget: 0.12,
  yaw: 0, yawTarget: 0,
  pitch: 0, pitchTarget: 0,
  next: 0
};
function chooseMove(t) {
  const r = Math.random();
  if (r < 0.14) motion.velTarget = -(0.5 + Math.random() * 0.9);   // pull back
  else if (r < 0.32) motion.velTarget = 0.35 + Math.random() * 0.5; // slow drift
  else motion.velTarget = 1.1 + Math.random() * 1.4;                // cruise/rush
  const s = Math.random();
  motion.spinVelTarget = s < 0.3 ? 0 : (Math.random() * 2 - 1) * 0.45;
  motion.yawTarget = Math.random() < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.4;
  motion.pitchTarget = Math.random() < 0.55 ? 0 : (Math.random() * 2 - 1) * 0.25;
  motion.next = t + 4.5 + Math.random() * 5;
}
function frame() {
  if (viz) {
    viz.resize();
    audio.update();
    checkAudioProbe();
    const p = PALETTES[state.palette];
    const t = (performance.now() - start) / 1000;
    const dt = Math.min(Math.max(t - lastFrameT, 0), 0.05);
    lastFrameT = t;

    if (audio.trebBeat >= 1 && prevTrebBeat < 1) rotDir = -rotDir;
    prevTrebBeat = audio.trebBeat;

    // Mutate the DNA the way projectM does hard preset cuts: when the MUSIC
    // changes character (a drop, a chorus, the beat coming in), the visuals
    // slam into a new form. The timer is only a fallback for silence.
    if (audio.section) rerollGenes();
    else if (t > nextRoll) rerollGenes();
    // Strong onsets nudge the DNA mid-form — small twist/hue mutations so the
    // picture keeps evolving with the percussion between section changes.
    if (audio.onset >= 1 && Math.random() < 0.35) {
      geneTarget.twist += (Math.random() - 0.5) * 0.5;
      geneTarget.huePhase = (geneTarget.huePhase + (Math.random() - 0.3) * 0.12) % 1;
      geneTarget.spin += (Math.random() - 0.5) * 0.6;
    }
    const ease = 1 - Math.exp(-dt * 0.5);   // ~2s half-life morph
    for (const k in genes) {
      if (k !== 'folds') genes[k] += (geneTarget[k] - genes[k]) * ease;
    }

    // Advance the choreography. The SONG still owns the pedal: tempo scales
    // the cruise, loudness opens it up, kicks punch it — but the manoeuvre
    // decides the direction and character of the motion.
    if (audio.section || t > motion.next) chooseMove(t);
    const mEase = 1 - Math.exp(-dt * 0.55);   // ~1.8s time constant
    motion.vel += (motion.velTarget - motion.vel) * mEase;
    motion.spinVel += (motion.spinVelTarget - motion.spinVel) * mEase;
    motion.yaw += (motion.yawTarget - motion.yaw) * mEase * 0.7;
    motion.pitch += (motion.pitchTarget - motion.pitch) * mEase * 0.7;
    motion.spin += motion.spinVel * dt * (0.6 + audio.level);
    const tempo = audio.bpm / 120;
    // Kicks only push when travelling forward — a backwards pull should feel
    // like being drawn back, not fought over.
    const punch = motion.vel > 0 ? audio.bass * 2.2 + audio.beat * 1.4 : 0;
    camDist += dt * (motion.vel * (0.7 + genes.speed * 0.35) * tempo
                     * (0.45 + audio.level * 1.6) + punch);

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
      dist: camDist,
      gene0: [genes.folds, genes.kx, genes.ky, genes.kz],
      gene1: [genes.twist, genes.warp, genes.radius, genes.detail],
      gene2: [genes.hueSpeed, genes.huePhase, genes.shapeSize, genes.spread],
      gene3: [genes.spin, genes.sway, genes.shake, 0],
      // The rest of the song: attenuated bands + pitch/flux/onset/hat-beat.
      aud0: [audio.subN, audio.lowMidN, audio.highMidN, audio.airN],
      aud1: [audio.centroid, audio.flux, audio.onset, audio.trebBeat],
      motion: [motion.spin, motion.yaw, motion.pitch, 0],
      // Chromatic-aberration kick in the composite — the lens smears on hits.
      shift: Math.min(audio.bass * 0.8 + audio.beat * 0.8, 1.5),
      // Feedback-warp parameters (per frame, ~60fps). This is the heart of the
      // Neon look. A slow zoom LFO makes the picture surge inward (>1, diving
      // INTO the tunnel) then pull back — the rollercoaster rush — with bass and
      // beats punching it deeper. Rotation wanders and reverses so the trails
      // corkscrew, and a strong hue drift rainbows them (60s video-feedback).
      // Flight supplies its own camera motion, so its feedback stays short and
      // near-static — just enough afterglow to melt the frames together.
      decay: state.mode === 'flight' ? 0.60 + state.trails * 0.24
           : state.mode === 'tunnel' ? 0.70 + state.trails * 0.22
           : 0.86 + state.trails * 0.11,
      // Hi-hats flip the trail-spin direction (MilkDrop's rot-on-beat trick);
      // the spin cadence itself follows the tempo.
      rot: state.mode === 'flight'
           ? (Math.sin(t * 0.11) * 0.004 + audio.beat * 0.010) * rotDir * tempo
           : (Math.sin(t * 0.06) * 0.02 + Math.sin(t * 0.017) * 0.02 + audio.beat * 0.03
             + (state.mode === 'tunnel' ? 0.012 : 0.005)) * rotDir,
      // Base < 1 (drifting outward) + a rush LFO that periodically crosses 1.0
      // to dive in; bass/beat pull you deeper still.
      zoom: state.mode === 'flight'
            ? 0.997 - audio.beat * 0.006
            : (state.mode === 'tunnel' ? 0.984 : 0.992)
              + Math.sin(t * 0.13) * 0.016 - 0.006
              - audio.bass * 0.030 - audio.beat * 0.022,
      // Trail hues melt faster when the top end sizzles.
      hueDrift: 0.02 + audio.treble * 0.06,
      colA: hex(p.a),
      colB: hex(p.b),
      colC: hex(p.c)
    });
  }
  updateLyrics();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
