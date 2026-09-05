"use strict";
// Deterministic real-WebGL check, run by Electron on Linux and macOS.
window.runVisualChecks = async function (capture) {
  const viz = new GLViz(document.getElementById("gl"));
  const wave = Uint8Array.from(
    { length: 512 },
    (_, i) => 128 + Math.sin(i * 0.13) * 20,
  );
  const spectrum = Uint8Array.from({ length: 256 }, (_, i) =>
    Math.max(0, 160 - i / 2),
  );
  const results = [];
  for (let i = 0; i < NewonPresets.presets.length; i++) {
    const preset = NewonPresets.presets[i];
    viz.clear();
    for (let f = 0; f < 90; f++) {
      viz.render({
        time: 12 + f / 60,
        dt: 1 / 60,
        bass: 0.45,
        mid: 0.35,
        treble: 0.25,
        level: 0.3,
        beat: 0,
        wave,
        spectrum,
        pointer: [0, 0],
        hue: 0.08,
        palette: { full: true },
        colors: [
          [0, 1, 0.5],
          [0.2, 0, 1],
          [1, 0, 0.5],
        ],
        layers: [{ preset, weight: 1 }],
        decay: preset.decay,
        zoom: preset.zoom,
        rotation: preset.rotation,
        warp: preset.warp,
        mirror: false,
        bloom: 0.85,
        brightness: 1.15,
      });
    }
    const gl = viz.gl,
      pixels = new Uint8Array(
        gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
      );
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let lit = 0,
      white = 0,
      total = 0;
    for (let p = 0; p < pixels.length; p += 4) {
      const max = Math.max(pixels[p], pixels[p + 1], pixels[p + 2]),
        min = Math.min(pixels[p], pixels[p + 1], pixels[p + 2]);
      if (max > 30) lit++;
      if (min > 240) white++;
      total++;
    }
    const result = {
      preset: preset.name,
      lit: lit / total,
      white: white / total,
      error: gl.getError(),
      hdr: viz.hdr,
    };
    if (result.lit < 0.03 || result.white > 0.3 || result.error !== 0)
      throw new Error(JSON.stringify(result));
    results.push(result);
    // Capture synchronously in the current drawing frame.
    await capture(i, document.getElementById("gl").toDataURL("image/png"));
  }
  viz.dispose();
  document.getElementById("result").textContent = JSON.stringify(
    results,
    null,
    2,
  );
  return results;
};
