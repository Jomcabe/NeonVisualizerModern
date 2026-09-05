"use strict";
(() => {
  // Curated forms, not random fractal parameters. Each has its own spatial
  // rhythm, feedback transform, texture density, and palette progression.
  const presets = [
    {
      name: "Prismatic orbit",
      family: "Interwoven light",
      shape: 0,
      hue: 0.56,
      zoom: 0.007,
      rotation: 0.003,
      warp: 0.5,
      decay: 0.91,
      energy: 0.82,
      texture: 0.7,
      variation: 0.2,
    },
    {
      name: "Solar blossom",
      family: "Folded surfaces",
      shape: 1,
      hue: 0.03,
      zoom: 0.012,
      rotation: -0.003,
      warp: 0.7,
      decay: 0.92,
      energy: 0.85,
      texture: 0.8,
      variation: 0.4,
    },
    {
      name: "Silk current",
      family: "Liquid ribbons",
      shape: 2,
      hue: 0.46,
      zoom: 0.006,
      rotation: 0.002,
      warp: 1.7,
      decay: 0.94,
      energy: 0.85,
      texture: 0.9,
      variation: 0.7,
    },
    {
      name: "Chromatic passage",
      family: "Recursive tunnel",
      shape: 3,
      hue: 0.7,
      zoom: 0.022,
      rotation: 0.003,
      warp: 1.0,
      decay: 0.88,
      energy: 0.9,
      texture: 0.65,
      variation: 0.3,
    },
    {
      name: "Crystal memory",
      family: "Feedback architecture",
      shape: 4,
      hue: 0.11,
      zoom: -0.009,
      rotation: -0.005,
      warp: 0.3,
      decay: 0.9,
      energy: 0.75,
      texture: 1.7,
      variation: 0.2,
    },
    {
      name: "Electric lotus",
      family: "Radial echoes",
      shape: 5,
      hue: 0.68,
      zoom: 0.016,
      rotation: 0.004,
      warp: 0.8,
      decay: 0.95,
      energy: 0.9,
      texture: 0.75,
      variation: 0.6,
    },
    {
      name: "Aurora fold",
      family: "Floating silk",
      shape: 2,
      hue: 0.36,
      zoom: -0.005,
      rotation: -0.004,
      warp: 2.3,
      decay: 0.96,
      energy: 0.7,
      texture: 1.3,
      variation: 0.1,
    },
    {
      name: "Luminous pearl",
      family: "Nested light forms",
      shape: 0,
      hue: 0.8,
      zoom: -0.012,
      rotation: 0.007,
      warp: 1.1,
      decay: 0.93,
      energy: 0.7,
      texture: 1.5,
      variation: 0.9,
    },
  ];
  const palettes = [
    {
      name: "Neon spectrum",
      colors: ["#19ff91", "#5930ff", "#ff428d"],
      full: true,
    },
    { name: "Aurora", colors: ["#19ffaa", "#19b8ff", "#7a42ff"] },
    { name: "Solar", colors: ["#ff2a42", "#ff821e", "#ffe7a5"] },
    { name: "Ultraviolet", colors: ["#661aff", "#fb30c3", "#45d4ff"] },
    { name: "Glacier", colors: ["#125aaa", "#25ffff", "#dceeff"] },
    { name: "Phosphor", colors: ["#127155", "#4dff65", "#e8ffc8"] },
  ];
  const defaults = {
    preset: 0,
    palette: 0,
    sensitivity: 1.0,
    brightness: 1.15,
    bloom: 0.85,
    trails: 0.65,
    speed: 1,
    autoCycle: true,
    showLyrics: true,
    quality: "auto",
  };
  function settings(saved) {
    const out = { ...defaults };
    if (!saved || typeof saved !== "object") return out;
    for (const [key, min, max] of [
      ["preset", 0, 7],
      ["palette", 0, 5],
      ["sensitivity", 0.3, 2.5],
      ["brightness", 0.3, 2],
      ["bloom", 0, 2],
      ["trails", 0, 1],
      ["speed", 0.25, 2],
    ]) {
      if (Number.isFinite(saved[key]))
        out[key] = Math.max(min, Math.min(max, saved[key]));
    }
    out.preset = Math.round(out.preset);
    out.palette = Math.round(out.palette);
    for (const key of ["autoCycle", "showLyrics"])
      if (typeof saved[key] === "boolean") out[key] = saved[key];
    if (["auto", "high", "low"].includes(saved.quality))
      out.quality = saved.quality;
    return out;
  }
  const api = { presets, palettes, defaults, settings };
  if (typeof window !== "undefined") window.NewonPresets = api;
  if (typeof module !== "undefined") module.exports = api;
})();
