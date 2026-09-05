const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AudioAnalysis } = require("../src/audio");
const { settings } = require("../src/presets");
const wave = Uint8Array.from(
  { length: 2048 },
  (_, i) => 128 + Math.sin((i * Math.PI) / 32) * 40,
);
function spectrum(lo, hi, n = 1024, sampleRate = 44100) {
  const f = new Uint8Array(n);
  for (
    let i = Math.floor((lo / (sampleRate / 2)) * n);
    i < Math.ceil((hi / (sampleRate / 2)) * n);
    i++
  )
    f[i] = 190;
  return f;
}
test("silence stays silent even with a noisy frequency buffer", () => {
  const a = new AudioAnalysis();
  for (let i = 0; i < 300; i++)
    a.analyze(
      new Uint8Array(2048).fill(128),
      new Uint8Array(1024).fill(30),
      44100,
      1 / 60,
    );
  assert.equal(a.level, 0);
  assert.equal(a.bassN, 0);
  assert.equal(a.beat, 0);
  assert.equal(a.onset, 0);
});
test("bass and high-frequency signals drive different bands", () => {
  const low = new AudioAnalysis(),
    high = new AudioAnalysis();
  for (let i = 0; i < 120; i++) {
    low.analyze(wave, spectrum(60, 220), 44100, 1 / 60);
    high.analyze(wave, spectrum(5000, 8500), 44100, 1 / 60);
  }
  assert.ok(low.bassN > 0.4);
  assert.ok(low.trebleN < 0.01);
  assert.ok(high.trebleN > 0.4);
  assert.ok(high.bassN < 0.01);
  assert.ok(high.centroid > low.centroid);
});
test("attack and release remain consistent across refresh rates", () => {
  const run = (fps) => {
    const a = new AudioAnalysis();
    for (let i = 0; i < fps * 2; i++)
      a.analyze(wave, spectrum(60, 220), 44100, 1 / fps);
    for (let i = 0; i < fps / 2; i++)
      a.analyze(
        new Uint8Array(2048).fill(128),
        new Uint8Array(1024),
        44100,
        1 / fps,
      );
    return a;
  };
  const slow = run(30),
    fast = run(120);
  assert.ok(Math.abs(slow.level - fast.level) < 0.005);
  assert.ok(Math.abs(slow.bassN - fast.bassN) < 0.015);
});
test("low sample rates and FFT size changes never produce NaN", () => {
  const a = new AudioAnalysis();
  for (const n of [512, 2048, 1024])
    a.analyze(wave, new Uint8Array(n).fill(150), 8000, 1 / 60);
  for (const key of [
    "bass",
    "mid",
    "treble",
    "air",
    "level",
    "centroid",
    "bpm",
  ])
    assert.ok(Number.isFinite(a[key]), key);
});
test("reset clears old input, waveform, and beat history", () => {
  const a = new AudioAnalysis();
  a.analyze(wave, spectrum(60, 220), 44100, 1 / 60);
  a.reset();
  assert.equal(a.level, 0);
  assert.equal(a.beat, 0);
  assert.equal(a.previous, null);
  assert.equal(a.onsetTimes.length, 0);
  assert.ok(a.wave.every((x) => x === 128));
});
test("saved settings cannot select missing scenes or invalid render values", () => {
  const s = settings({
    preset: 900,
    palette: -2,
    brightness: NaN,
    trails: 99,
    quality: "unknown",
    autoCycle: "false",
  });
  assert.equal(s.preset, 7);
  assert.equal(s.palette, 0);
  assert.equal(s.brightness, 1.15);
  assert.equal(s.trails, 1);
  assert.equal(s.quality, "auto");
  assert.equal(s.autoCycle, true);
});
