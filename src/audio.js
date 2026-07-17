'use strict';

// Wraps a MediaStream in a Web Audio AnalyserNode and exposes smoothed
// bass/mid/treble/level plus a simple beat-detection envelope.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.freq = null;
    this.stream = null;
    this.source = null;

    this.level = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.beat = 0;

    this._bassAvg = 0;      // running average of bass energy
    this._beatCooldown = 0; // frames since last beat
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
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.source.connect(this.analyser);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
  }

  // Average a slice of the frequency data, normalized 0..1.
  _band(lo, hi) {
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += this.freq[i];
    return sum / ((hi - lo) * 255);
  }

  // Call once per animation frame. Returns smoothed metrics.
  update() {
    if (!this.analyser) return this;
    this.analyser.getByteFrequencyData(this.freq);
    const n = this.freq.length; // 1024 bins over ~0..22kHz

    const bass = this._band(1, Math.floor(n * 0.06));      // ~20-260 Hz
    const mid = this._band(Math.floor(n * 0.06), Math.floor(n * 0.25));
    const treble = this._band(Math.floor(n * 0.25), Math.floor(n * 0.7));
    let level = 0;
    for (let i = 0; i < n; i++) level += this.freq[i];
    level /= n * 255;

    // Smooth (attack fast, release slow-ish) for pleasant motion.
    const smooth = (prev, next, up, down) =>
      next > prev ? prev + (next - prev) * up : prev + (next - prev) * down;
    this.bass = smooth(this.bass, bass, 0.5, 0.12);
    this.mid = smooth(this.mid, mid, 0.5, 0.15);
    this.treble = smooth(this.treble, treble, 0.6, 0.2);
    this.level = smooth(this.level, level, 0.5, 0.1);

    // Beat detection on bass: spike above running average triggers a pulse.
    this._bassAvg = this._bassAvg * 0.92 + bass * 0.08;
    this._beatCooldown++;
    if (bass > this._bassAvg * 1.4 && bass > 0.14 && this._beatCooldown > 8) {
      this.beat = 1;
      this._beatCooldown = 0;
    } else {
      this.beat *= 0.9; // decay envelope
    }
    return this;
  }
}

window.AudioEngine = AudioEngine;
