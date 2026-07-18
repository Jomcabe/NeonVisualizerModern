'use strict';

// Wraps a MediaStream in a Web Audio AnalyserNode and turns it into a rich,
// per-frame description of the music — the projectM/MilkDrop school of audio
// analysis, where every aspect of the sound gets its own signal:
//
//   level                loudness (RMS), smoothed          -> global brightness
//   sub/bass/lowMid/
//   mid/highMid/
//   treble/air           7 frequency bands, 0..1           -> each drives its own visual
//   subN/bassN/...       MilkDrop-style "attenuated" bands (band / its own
//                        running average) so quiet songs still animate fully
//   beat                 kick-drum pulse envelope           -> speed lurch / dive
//   trebBeat             hi-hat/snare pulse envelope        -> roll flicks / sparkle
//   onset                broadband spectral-flux onsets     -> twist kicks / mutations
//   flux                 smoothed spectral flux             -> writhe amount
//   centroid             spectral centroid 0..1 (pitch /    -> hue steering
//                        brightness of the sound)
//   bpm                  tempo estimate from onset spacing  -> ride speed / cadence
//   section              true for ONE frame when the song   -> visual-DNA re-roll
//                        changes character (drop, chorus…)     (projectM hard cut)

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.freq = null;
    this.stream = null;
    this.source = null;

    this.level = 0;
    this.sub = 0; this.bass = 0; this.lowMid = 0; this.mid = 0;
    this.highMid = 0; this.treble = 0; this.air = 0;
    this.subN = 0; this.bassN = 0; this.lowMidN = 0; this.midN = 0;
    this.highMidN = 0; this.trebleN = 0; this.airN = 0;
    this.beat = 0;
    this.trebBeat = 0;
    this.onset = 0;
    this.flux = 0;
    this.centroid = 0.35;
    this.bpm = 120;
    this.section = false;
    // Time-domain waveform (128 = silence) — drawn directly by the shaders.
    this.wave = new Uint8Array(2048).fill(128);

    this._avgs = new Float64Array(7);     // slow per-band running averages
    this._prevMag = null;                 // last frame's spectrum (for flux)
    this._fluxAvg = 0;
    this._trebAvg = 0;
    this._bassAvg = 0;
    this._beatCooldown = 0;
    this._trebCooldown = 0;
    this._onsetCooldown = 0;
    this._onsetTimes = [];                // recent onset timestamps for BPM
    this._profileFast = new Float64Array(3);
    this._profileSlow = new Float64Array(3);
    this._lastSection = 0;
  }

  get running() {
    return !!this.analyser;
  }

  // Attach a stream (system loopback, or mic fallback). Video tracks dropped.
  async start(stream) {
    this.stop();
    this.stream = stream;
    stream.getVideoTracks().forEach((t) => {
      t.stop();
      stream.removeTrack(t);
    });
    if (!stream.getAudioTracks().length) {
      throw new Error('No audio track in the captured stream.');
    }

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    // 4096-point FFT: ~10.8 Hz/bin at 44.1kHz, enough to separate the sub-bass
    // from the kick. Light smoothing — our own attack/release envelopes below
    // do the real shaping, and heavy analyser smoothing would blur onsets.
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.55;
    this.source.connect(this.analyser);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.fftSize).fill(128);
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
  }

  // Average a Hz range of the spectrum, normalized 0..1.
  _bandHz(lo, hi) {
    const nyq = this.ctx.sampleRate / 2;
    const n = this.freq.length;
    const a = Math.max(1, Math.floor((lo / nyq) * n));
    const b = Math.min(n, Math.ceil((hi / nyq) * n));
    let sum = 0;
    for (let i = a; i < b; i++) sum += this.freq[i];
    return sum / ((b - a) * 255);
  }

  // Call once per animation frame.
  update() {
    if (!this.analyser) { this.section = false; return this; }
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.wave);
    const now = performance.now();

    // ---- Loudness (RMS of the waveform) ----
    let rms = 0;
    for (let i = 0; i < this.wave.length; i += 4) {
      const v = (this.wave[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / (this.wave.length / 4)) * 1.8;

    // ---- 7 bands ----
    const raw = [
      this._bandHz(20, 60),      // sub
      this._bandHz(60, 250),     // bass
      this._bandHz(250, 500),    // lowMid
      this._bandHz(500, 2000),   // mid
      this._bandHz(2000, 4000),  // highMid
      this._bandHz(4000, 9000),  // treble
      this._bandHz(9000, 16000)  // air
    ];

    // Smooth (attack fast, release slow-ish) for pleasant motion.
    const smooth = (prev, next, up, down) =>
      next > prev ? prev + (next - prev) * up : prev + (next - prev) * down;
    const KEYS = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'air'];
    for (let i = 0; i < 7; i++) {
      this[KEYS[i]] = smooth(this[KEYS[i]], raw[i], 0.55, 0.15);
      // MilkDrop-style attenuation: each band relative to its own ~4s average,
      // so a quiet acoustic track drives the visuals as hard as a club mix.
      this._avgs[i] = this._avgs[i] * 0.995 + raw[i] * 0.005;
      const rel = raw[i] / (this._avgs[i] * 2 + 0.008);
      this[KEYS[i] + 'N'] = smooth(this[KEYS[i] + 'N'], Math.min(rel, 1.6) * 0.625, 0.5, 0.12);
    }
    this.level = smooth(this.level, rms, 0.5, 0.1);

    // ---- Spectral centroid: where the energy sits = perceived pitch ----
    const nyq = this.ctx.sampleRate / 2;
    let wsum = 0, msum = 0;
    for (let i = 1; i < this.freq.length; i++) {
      wsum += i * this.freq[i];
      msum += this.freq[i];
    }
    if (msum > 40) {
      const hz = (wsum / msum / this.freq.length) * nyq;
      // Log-map 110 Hz .. 7040 Hz (six octaves) onto 0..1.
      const c = Math.min(Math.max(Math.log2(Math.max(hz, 111) / 110) / 6, 0), 1);
      this.centroid = smooth(this.centroid, c, 0.15, 0.08);
    }

    // ---- Spectral flux -> onsets (any percussive/harmonic change at all) ----
    let flux = 0;
    if (this._prevMag) {
      for (let i = 1; i < this.freq.length; i += 2) {
        const d = this.freq[i] - this._prevMag[i];
        if (d > 0) flux += d;
      }
      flux /= (this.freq.length / 2) * 255;
    } else {
      this._prevMag = new Uint8Array(this.freq.length);
    }
    this._prevMag.set(this.freq);
    this._fluxAvg = this._fluxAvg * 0.97 + flux * 0.03;
    this.flux = smooth(this.flux, Math.min(flux / (this._fluxAvg * 2 + 0.004), 1.5), 0.5, 0.2);
    this._onsetCooldown++;
    if (flux > this._fluxAvg * 1.7 && flux > 0.004 && this._onsetCooldown > 7) {
      this.onset = 1;
      this._onsetCooldown = 0;
      this._onsetTimes.push(now);
      if (this._onsetTimes.length > 16) this._onsetTimes.shift();
      this._updateBpm();
    } else {
      this.onset *= 0.85;
    }

    // ---- Kick beat (bass energy spike) ----
    this._bassAvg = this._bassAvg * 0.92 + raw[1] * 0.08;
    this._beatCooldown++;
    if (raw[1] > this._bassAvg * 1.4 && raw[1] > 0.12 && this._beatCooldown > 8) {
      this.beat = 1;
      this._beatCooldown = 0;
    } else {
      this.beat *= 0.9;
    }

    // ---- Treble beat (hats / snare sizzle) ----
    this._trebAvg = this._trebAvg * 0.93 + raw[5] * 0.07;
    this._trebCooldown++;
    if (raw[5] > this._trebAvg * 1.5 && raw[5] > 0.05 && this._trebCooldown > 6) {
      this.trebBeat = 1;
      this._trebCooldown = 0;
    } else {
      this.trebBeat *= 0.85;
    }

    // ---- Section change: the song's character shifts (drop, chorus, verse).
    // Compare a fast energy profile against a slow one; a big divergence after
    // a quiet spell of agreement = the music changed shape. One-frame pulse.
    this.section = false;
    const prof = [raw[1], raw[3], raw[5]];
    let dist = 0;
    for (let i = 0; i < 3; i++) {
      this._profileFast[i] = this._profileFast[i] * 0.85 + prof[i] * 0.15;
      this._profileSlow[i] = this._profileSlow[i] * 0.992 + prof[i] * 0.008;
      dist += Math.abs(this._profileFast[i] - this._profileSlow[i]);
    }
    if (dist > 0.17 && rms > 0.05 && now - this._lastSection > 7000) {
      this.section = true;
      this._lastSection = now;
    }

    return this;
  }

  // Tempo from the spacing of recent onsets: fold intervals into one octave
  // (300-750 ms), take the median, smooth. Falls back to 120 when starved.
  _updateBpm() {
    const t = this._onsetTimes;
    if (t.length < 5) return;
    const folded = [];
    for (let i = 1; i < t.length; i++) {
      let iv = t[i] - t[i - 1];
      if (iv < 120 || iv > 3000) continue;
      while (iv < 300) iv *= 2;
      while (iv > 750) iv /= 2;
      folded.push(iv);
    }
    if (folded.length < 4) return;
    folded.sort((a, b) => a - b);
    const med = folded[folded.length >> 1];
    const bpm = 60000 / med;
    this.bpm += (Math.min(Math.max(bpm, 60), 200) - this.bpm) * 0.15;
  }
}

window.AudioEngine = AudioEngine;
