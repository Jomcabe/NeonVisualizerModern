'use strict';

// All GLSL lives here as strings so the app stays dependency-free (no build step).
// Scene shaders share a common header (uniforms + noise + palette helpers).
//
// The look is built the way the original Xbox 360 "Neon" visualizer was: a
// sparse, audio-driven "seed" image is drawn each frame, then run through a
// video-feedback loop (previous frame rotated / zoomed / blurred / faded and
// re-added) so the light melts into flowing trails. Bloom is applied on top.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SCENE_HEADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform vec2  uResolution;
uniform float uTime, uLevel, uBass, uMid, uTreble, uBeat, uSensitivity, uBrightness;
uniform vec3  uColA, uColB, uColC;
uniform sampler2D uWave;

// Live audio waveform, -1..1, sampled along 0..1 (wraps).
float wav(float x){ return texture(uWave, vec2(fract(x), 0.5)).r * 2.0 - 1.0; }
// Low-passed waveform — smooth flowing curves instead of jagged zigzags.
float wavS(float x){
  return (wav(x) + wav(x + 0.012) + wav(x - 0.012) + wav(x + 0.025) + wav(x - 0.025)) * 0.2;
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.,0.)), c = hash(i + vec2(0.,1.)), d = hash(i + vec2(1.,1.));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
vec3 pal(float t){
  t = fract(t);
  return t < 0.5 ? mix(uColA, uColB, smoothstep(0.0, 0.5, t))
                 : mix(uColB, uColC, smoothstep(0.5, 1.0, t));
}
// Full-spectrum rainbow (cosine palette) — the psychedelic colour-cycling that
// Neon lives on. Blended with the user's palette for vivid, shifting hues.
vec3 spectrum(float t){
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}
`;

// ---- Mode 1: "Neon" — a swarm of particle light-forms -----------------------
// The real Neon lightsynth builds its look from clouds of bright *point* sprites
// (not vector lines), color-cycled across the spectrum and folded through
// kaleidoscope symmetry. Each particle rides a golden-angle spiral whose radius
// is pushed by the live waveform + bass. Drawn sparse and bright on black; the
// feedback pass then pulls the points into flowing, recursive light-tunnels.
const FRAG_NEON = SCENE_HEADER + `
// Fold a point through n-fold kaleidoscope symmetry. Returns folded xy + radius.
vec3 kfold(vec2 p, float folds){
  float k = 6.28318 / folds;
  float a = atan(p.y, p.x);
  float r = length(p);
  a = abs(mod(a, k) - k * 0.5);
  return vec3(cos(a) * r, sin(a) * r, r);
}

void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float t    = uTime;
  float bass = uBass   * uSensitivity;
  float treb = uTreble * uSensitivity;
  float lvl  = uLevel  * uSensitivity;

  // Slow global spin + bass-breathing zoom so the swarm surges with the music.
  vec2 p = rot(t * 0.05 + sin(t * 0.021) * 0.6) * uv;
  p *= 0.92 - bass * 0.22 - uBeat * 0.10;

  // Kaleidoscope petal count steps every ~10s (3,4,5,6-fold), like Neon's
  // symmetry presets.
  float folds = 3.0 + mod(floor(t / 10.0), 4.0);
  vec3 fr = kfold(p, folds);
  vec2 q = fr.xy;

  // Liquid domain warp — fbm shoves the whole field around so it writhes and
  // melts like a lava lamp. Bass makes the warp heave. This is what turns the
  // clean swarm into the "on-mushrooms" molten look.
  vec2 warp = vec2(fbm(q * 2.3 + t * 0.20),
                   fbm(q * 2.3 - t * 0.15 + 7.0));
  q += (warp - 0.5) * (0.30 + bass * 0.7);
  float rad = length(q);

  vec3 col = vec3(0.0);

  // --- Plasma / moire underlay: soft rainbow interference behind everything ---
  float plasma = sin(q.x * 6.0 + t)
               + sin(q.y * 5.3 - t * 1.3)
               + sin((q.x + q.y) * 4.7 + t * 0.7)
               + fbm(q * 3.0 - t * 0.25) * 3.0;
  col += spectrum(plasma * 0.09 + t * 0.05) * (0.10 + lvl * 0.35);

  // --- Particle swarm: points of light, rainbow colour-cycled ---
  const int N = 46;
  for(int i = 0; i < N; i++){
    float fi = float(i);
    // A distinct window of the live waveform drives each particle's radius.
    float w   = wavS(fi * 0.017 + t * 0.03);
    float ang = fi * 2.399963 + t * (0.12 + 0.05 * sin(fi * 1.3)); // golden angle
    float r   = 0.12 + fract(fi * 0.1367 + t * 0.04) * 0.95;
    r += w * (0.18 + bass * 0.5);
    vec2 pos  = vec2(cos(ang), sin(ang)) * r;
    float d   = length(q - pos);
    float sz  = 0.0045 + treb * 0.012 + uBeat * 0.004;   // treble sharpens the cores
    float glow = sz / (d * d + sz * 0.7);                // bright core + soft halo
    // Blend the user's palette with the full rainbow for vivid, shifting hues.
    vec3 c = mix(pal(fi * 0.041 + t * 0.18 + r * 0.25),
                 spectrum(fi * 0.03 + t * 0.25 + r * 0.4), 0.55);
    col += c * glow * (0.35 + abs(w) * 0.7 + uBeat * 0.6);
  }
  col /= float(N) * 0.06;

  // --- A couple of waveform rings woven through the swarm ---
  for(int j = 0; j < 2; j++){
    float fj = float(j);
    float base   = 0.34 + fj * 0.22 + sin(t * (0.2 + fj * 0.13)) * 0.06;
    float ripple = wavS(fract(atan(q.y, q.x) / 6.28318) + fj * 0.5 + t * 0.05);
    float dr     = rad - (base + ripple * (0.12 + bass * 0.35));
    float ring   = exp(-dr * dr * 900.0);
    col += spectrum(rad * 0.5 + t * 0.2 + fj * 0.3) * ring * (0.6 + treb * 0.8);
  }

  // Beat = a strobing multicolour bloom of the whole field.
  col += spectrum(t * 0.4) * uBeat * 0.35;

  col *= 0.35 + lvl * 1.3 + uBeat * 0.5;
  col *= 0.5 + uBrightness;
  frag = vec4(max(col, 0.0), 1.0);
}`;

// ---- Mode 2: feedback light-tunnel -----------------------------------------
// A radial seed — bright waveform-carved spokes + concentric pulses on black.
// The strong bass-driven zoom + rotation in the feedback pass is what stretches
// this into the endless receding tunnel: Minter's signature feedback zoom.
const FRAG_TUNNEL = SCENE_HEADER + `
void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float bass = uBass   * uSensitivity;
  float treb = uTreble * uSensitivity;

  float rad = length(uv);
  // Swirl the tunnel — the angle twists with depth and time, so the whole
  // thing corkscrews as the feedback zoom rushes you down it (the rollercoaster).
  float ang = atan(uv.y, uv.x) + sin(rad * 3.5 - uTime * (0.8 + bass * 1.5)) * 0.5;

  // Spoke count steps 6..12 over time; beats twist the fold.
  float seg  = 6.0 + mod(floor(uTime / 8.0), 4.0) * 2.0;
  float k    = 6.28318 / seg;
  float fang = abs(mod(ang + uBeat * 0.2, k) - k * 0.5);

  // Spokes carved by the waveform, brightest near the axis of each fold.
  float w     = wavS(fang * seg * 0.1 + uTime * 0.04);
  float spoke = exp(-pow(fang * seg, 2.0) * 0.6) * (0.6 + 0.8 * abs(w));

  // Concentric rings rushing outward, faster on bass.
  float rings = 0.5 + 0.5 * sin(rad * 22.0 - uTime * (3.0 + bass * 6.0) + uBeat * 4.0);
  rings = pow(rings, 3.0);

  float falloff = clamp(1.0 / (rad * 1.8 + 0.25), 0.0, 1.8);
  float pat = spoke * (0.4 + 0.6 * rings) * falloff;

  vec3 col = spectrum(rad * 0.6 - uTime * 0.25 + w * 0.3) * pat;
  col += spectrum(uTime * 0.3) * uBeat * 0.4 * spoke * falloff; // beat lights it up

  col *= 0.4 + uLevel * 1.4 + bass * 0.8;
  col *= 0.55 + uBrightness;
  frag = vec4(max(col, 0.0), 1.0);
}`;

// ---- Feedback: warp + fade last frame, add the fresh seed -------------------
// This is the heart of the Neon look. Each frame the previous output is
// rotated, zoomed outward, slightly blurred, faded, hue-drifted, and the new
// seed image is added on top — bright shapes leave melting rainbow trails.
const FRAG_FEEDBACK = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uPrev;      // last frame's feedback output
uniform sampler2D uSeed;      // freshly drawn scene
uniform vec2  uResolution;
uniform float uDecay;         // trail persistence per frame
uniform float uZoom;          // <1 pushes the picture outward
uniform float uRot;           // radians per frame
uniform float uHueDrift;      // trail hue rotation, radians per frame

// Rotate color around the gray axis — cycles hue without desaturating.
vec3 hueShift(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
void main(){
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (vUv * 2.0 - 1.0) * asp;
  p = mat2(cos(uRot), -sin(uRot), sin(uRot), cos(uRot)) * p * uZoom;
  vec2 suv = (p / asp) * 0.5 + 0.5;

  // Small cross blur so trails melt smoothly instead of pixel-crawling.
  vec2 px = 1.0 / uResolution;
  vec3 prev = texture(uPrev, suv).rgb * 0.60;
  prev += texture(uPrev, suv + vec2(px.x, 0.0)).rgb * 0.10;
  prev += texture(uPrev, suv - vec2(px.x, 0.0)).rgb * 0.10;
  prev += texture(uPrev, suv + vec2(0.0, px.y)).rgb * 0.10;
  prev += texture(uPrev, suv - vec2(0.0, px.y)).rgb * 0.10;

  // Slow hue melt in the trails (classic analog-feedback rainbowing).
  prev = max(hueShift(prev, uHueDrift), 0.0);

  // Dissolve at the borders instead of smearing the edge pixels, and damp hot
  // regions harder than dim ones so the loop settles at a bounded brightness
  // instead of whiting out.
  vec2 b = smoothstep(0.0, 0.04, suv) * smoothstep(0.0, 0.04, 1.0 - suv);
  float lum = dot(prev, vec3(0.3333));
  prev *= uDecay * b.x * b.y / (1.0 + lum * 0.55);
  // Dark floor: dim energy dies to true black instead of pooling into fog.
  prev = max(prev - 0.005, 0.0);

  vec3 seed = texture(uSeed, vUv).rgb;
  frag = vec4(min(prev + seed * 0.45, vec3(4.0)), 1.0);
}`;

// ---- Post: bright-pass, separable blur, composite (bloom) -------------------
const FRAG_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex; uniform float uThreshold;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float b = max(max(c.r, c.g), c.b);
  float f = smoothstep(uThreshold, uThreshold + 0.35, b);
  frag = vec4(c * f, 1.0);
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex; uniform vec2 uDir; uniform vec2 uTexel;
void main(){
  float w0 = 0.227, w1 = 0.194, w2 = 0.121, w3 = 0.054, w4 = 0.016;
  vec3 s = texture(uTex, vUv).rgb * w0;
  vec2 o = uDir * uTexel;
  s += (texture(uTex, vUv + o * 1.5).rgb + texture(uTex, vUv - o * 1.5).rgb) * w1;
  s += (texture(uTex, vUv + o * 3.0).rgb + texture(uTex, vUv - o * 3.0).rgb) * w2;
  s += (texture(uTex, vUv + o * 4.5).rgb + texture(uTex, vUv - o * 4.5).rgb) * w3;
  s += (texture(uTex, vUv + o * 6.0).rgb + texture(uTex, vUv - o * 6.0).rgb) * w4;
  frag = vec4(s, 1.0);
}`;

const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uIntensity;
void main(){
  vec3 s = texture(uScene, vUv).rgb;
  vec3 b = texture(uBloom, vUv).rgb;
  vec3 c = s + b * uIntensity;
  c = c / (c + vec3(1.0));            // Reinhard tone map
  c = pow(c, vec3(1.0 / 2.2));         // gamma
  // Saturation push — feedback mixing tends to gray the mids back out.
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(mix(vec3(luma), c, 1.35), 0.0, 1.0);
  // Mild vignette keeps the edges reading as black.
  vec2 q = vUv * 2.0 - 1.0;
  c *= 1.0 - 0.30 * smoothstep(0.6, 1.6, dot(q, q));
  frag = vec4(c, 1.0);
}`;

window.NewonShaders = {
  VERT,
  scenes: { neon: FRAG_NEON, tunnel: FRAG_TUNNEL },
  FRAG_FEEDBACK,
  FRAG_BRIGHT,
  FRAG_BLUR,
  FRAG_COMPOSITE
};
