"use strict";
(() => {
  const BANDS = [
    ["sub", 20, 60],
    ["bass", 60, 250],
    ["lowMid", 250, 500],
    ["mid", 500, 2000],
    ["highMid", 2000, 4000],
    ["treble", 4000, 9000],
    ["air", 9000, 16000],
  ];
  const approach = (a, b, dt, attack, release) =>
    a + (b - a) * (1 - Math.exp(-dt / (b > a ? attack : release)));
  class AudioAnalysis {
    constructor() {
      this.reset();
    }
    reset() {
      for (const [name] of BANDS) {
        this[name] = 0;
        this[name + "N"] = 0;
      }
      this.level = 0;
      this.beat = 0;
      this.trebBeat = 0;
      this.onset = 0;
      this.flux = 0;
      this.centroid = 0.35;
      this.bpm = 120;
      this.section = false;
      this.wave = new Uint8Array(2048).fill(128);
      this.freq = new Uint8Array(1024);
      this.averages = new Float64Array(7);
      this.previous = null;
      this.bassAverage = 0;
      this.fluxAverage = 0;
      this.trebleAverage = 0;
      this.time = 0;
      this.lastBeat = -1;
      this.lastTreble = -1;
      this.lastOnset = -1;
      this.onsetTimes = [];
      this.profile = 0;
      this.lastSection = 0;
    }
    analyze(wave, freq, sampleRate, delta) {
      const dt = Math.min(0.1, Math.max(0.001, delta));
      this.time += dt;
      this.wave = wave;
      this.freq = freq;
      this.section = false;
      let rms = 0;
      for (let i = 0; i < wave.length; i++) rms += ((wave[i] - 128) / 128) ** 2;
      rms = Math.sqrt(rms / Math.max(1, wave.length));
      const audible = rms > 0.0015;
      this.level = approach(this.level, Math.min(1, rms * 3), dt, 0.045, 0.28);
      const raw = BANDS.map(([, lo, hi]) => {
        const a = Math.max(
          1,
          Math.floor((lo / (sampleRate / 2)) * freq.length),
        );
        const b = Math.min(
          freq.length,
          Math.ceil((hi / (sampleRate / 2)) * freq.length),
        );
        if (b <= a || !audible) return 0;
        let sum = 0;
        for (let i = a; i < b; i++) sum += freq[i] / 255;
        return sum / (b - a);
      });
      for (let i = 0; i < BANDS.length; i++) {
        const name = BANDS[i][0];
        this[name] = approach(this[name], raw[i], dt, 0.045, 0.22);
        this.averages[i] = approach(this.averages[i], raw[i], dt, 3.0, 5.0);
        const relative = audible
          ? Math.min(1, raw[i] / Math.max(0.08, this.averages[i] * 1.9))
          : 0;
        this[name + "N"] = approach(
          this[name + "N"],
          relative,
          dt,
          0.055,
          0.25,
        );
      }
      let flux = 0,
        weight = 0,
        total = 0;
      if (!this.previous || this.previous.length !== freq.length)
        this.previous = new Uint8Array(freq.length);
      for (let i = 1; i < freq.length; i++) {
        const magnitude = freq[i] / 255;
        flux += Math.max(0, (freq[i] - this.previous[i]) / 255);
        weight += i * magnitude;
        total += magnitude;
      }
      this.previous.set(freq);
      flux = audible ? flux / freq.length : 0;
      this.flux = approach(this.flux, Math.min(1, flux * 20), dt, 0.06, 0.22);
      this.beat *= Math.exp(-dt / 0.22);
      this.trebBeat *= Math.exp(-dt / 0.12);
      this.onset *= Math.exp(-dt / 0.16);
      if (
        audible &&
        raw[1] > Math.max(0.14, this.bassAverage * 1.35) &&
        this.time - this.lastBeat > 0.24
      ) {
        this.beat = 1;
        this.lastBeat = this.time;
      }
      if (
        audible &&
        raw[5] > Math.max(0.1, this.trebleAverage * 1.4) &&
        this.time - this.lastTreble > 0.13
      ) {
        this.trebBeat = 1;
        this.lastTreble = this.time;
      }
      if (
        audible &&
        flux > Math.max(0.006, this.fluxAverage * 1.6) &&
        this.time - this.lastOnset > 0.16
      ) {
        this.onset = 1;
        this.lastOnset = this.time;
        this.onsetTimes.push(this.time);
        if (this.onsetTimes.length > 16) this.onsetTimes.shift();
        this.updateTempo();
      }
      this.bassAverage = approach(this.bassAverage, raw[1], dt, 0.55, 0.8);
      this.trebleAverage = approach(this.trebleAverage, raw[5], dt, 0.55, 0.8);
      this.fluxAverage = approach(this.fluxAverage, flux, dt, 0.5, 1.0);
      if (total > 0 && audible) {
        const hz = ((weight / total / freq.length) * sampleRate) / 2;
        // Spectral centroid describes brightness, not fundamental pitch.
        const centroid = Math.max(
          0,
          Math.min(1, Math.log2(Math.max(110, hz) / 110) / 6),
        );
        this.centroid = approach(this.centroid, centroid, dt, 0.6, 1.0);
      }
      const energy = raw[1] + raw[3] + raw[5];
      if (
        audible &&
        Math.abs(energy - this.profile) > 0.55 &&
        this.time - this.lastSection > 12
      ) {
        this.section = true;
        this.lastSection = this.time;
      }
      this.profile = approach(this.profile, energy, dt, 4, 4);
      return this;
    }
    updateTempo() {
      if (this.onsetTimes.length < 6) return;
      const intervals = [];
      for (let i = 1; i < this.onsetTimes.length; i++) {
        let gap = this.onsetTimes[i] - this.onsetTimes[i - 1];
        if (gap < 0.16 || gap > 2) continue;
        while (gap < 0.33) gap *= 2;
        while (gap > 0.85) gap /= 2;
        intervals.push(gap);
      }
      if (intervals.length < 4) return;
      intervals.sort((a, b) => a - b);
      this.bpm += (60 / intervals[intervals.length >> 1] - this.bpm) * 0.15;
    }
  }
  class AudioEngine extends AudioAnalysis {
    constructor() {
      super();
      this.ctx = null;
      this.analyser = null;
      this.stream = null;
      this.source = null;
      this.kind = "ambient";
    }
    get running() {
      return !!this.analyser;
    }
    async attach(stream, kind = "system") {
      this.stop();
      if (!stream.getAudioTracks().some((t) => t.readyState === "live")) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("The source did not provide an audio track.");
      }
      try {
        this.stream = stream;
        const Context = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Context();
        await this.ctx.resume();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 4096;
        this.analyser.smoothingTimeConstant = 0.2;
        this.source = this.ctx.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        // Captured system/mic audio is never routed to speakers.
        this.wave = new Uint8Array(this.analyser.fftSize).fill(128);
        this.freq = new Uint8Array(this.analyser.frequencyBinCount);
        this.kind = kind;
      } catch (error) {
        this.stop();
        throw error;
      }
    }
    async start(stream) {
      return this.attach(stream);
    }
    async playFile(file) {
      this.stop();
      const Context = window.AudioContext || window.webkitAudioContext;
      const context = (this.ctx = new Context());
      try {
        await context.resume();
        const bytes = await file.arrayBuffer();
        if (this.ctx !== context) return;
        const buffer = await context.decodeAudioData(bytes);
        if (this.ctx !== context) return;
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = 4096;
        this.analyser.smoothingTimeConstant = 0.2;
        this.source = context.createBufferSource();
        this.source.buffer = buffer;
        this.source.connect(this.analyser);
        this.analyser.connect(context.destination);
        this.wave = new Uint8Array(this.analyser.fftSize).fill(128);
        this.freq = new Uint8Array(this.analyser.frequencyBinCount);
        this.kind = "file";
        this.source.onended = () => {
          if (this.ctx === context) {
            this.stop();
            this.onended?.();
          }
        };
        this.source.start();
      } catch (error) {
        if (this.ctx === context) this.stop();
        throw error;
      }
    }
    update(dt = 1 / 60) {
      if (!this.analyser) return this;
      this.analyser.getByteFrequencyData(this.freq);
      this.analyser.getByteTimeDomainData(this.wave);
      return this.analyze(this.wave, this.freq, this.ctx.sampleRate, dt);
    }
    stop() {
      if (this.source) {
        this.source.onended = null;
        try {
          this.source.stop?.();
          this.source.disconnect();
        } catch {}
      }
      this.stream?.getTracks().forEach((t) => t.stop());
      this.ctx?.close().catch(() => {});
      this.ctx = null;
      this.analyser = null;
      this.source = null;
      this.stream = null;
      this.kind = "ambient";
      this.reset();
    }
  }
  const api = { AudioAnalysis, AudioEngine };
  if (typeof window !== "undefined") Object.assign(window, api);
  if (typeof module !== "undefined") module.exports = api;
})();
