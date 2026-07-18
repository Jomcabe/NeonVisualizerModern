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

// ---- Unified modular scene --------------------------------------------------
// Instead of one mode at a time, SEVERAL layers run simultaneously and their
// weights drift with uStyle (a continuous float, not an index). Switching mode
// or auto-cycling just eases uStyle, so every change is a smooth MORPH and there
// is always more than one thing on screen — no single centered shape, no rigid
// symmetry, constant asymmetric motion. This mirrors how the real Neon layers
// modular generators.
const FRAG_SCENE = SCENE_HEADER + `
uniform float uStyle;   // continuous style position, wraps over NSTYLES=5

// Triangular, wrapping weight for style k on the ring of 5 styles.
float styleW(float k){
  float m = mod(uStyle, 5.0);
  float d = abs(m - k);
  d = min(d, 5.0 - d);
  return smoothstep(1.0, 0.0, d);
}
// Cheap flowing direction (no fbm) so the particle loop stays fast.
vec2 flow2(float fi, float t){
  float a = sin(fi * 1.7 + t * 0.35) * 2.3 + cos(fi * 0.9 - t * 0.22) * 1.7;
  return vec2(cos(a), sin(a));
}

void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  float asp = uResolution.x / uResolution.y;
  uv.x *= asp;

  float t    = uTime;
  float bass = uBass   * uSensitivity;
  float mid  = uMid    * uSensitivity;
  float treb = uTreble * uSensitivity;
  float lvl  = uLevel  * uSensitivity;

  float wSwarm  = 0.5 + styleW(0.0);   // always some swarm — the connective tissue
  float wKaleid = styleW(1.0);
  float wTunnel = styleW(2.0);
  float wGrid   = styleW(3.0);
  float wLiquid = styleW(4.0);

  // Working coordinate: gentle continuous spin (one direction — reads as flow,
  // not rocking). Symmetry is LOOSE and only fades in for the Kaleido style, on
  // a slowly rotating axis, so it never looks like a rigid centered mirror.
  vec2 q = rot(t * 0.04) * uv;
  {
    float folds = 3.0 + mod(floor(t / 14.0), 3.0);      // 3..5
    float k  = 6.28318 / folds;
    float a  = atan(q.y, q.x) + t * 0.06;
    float rr = length(q);
    float fa = abs(mod(a, k) - k * 0.5);
    vec2 sym = vec2(cos(fa + t * 0.06), sin(fa + t * 0.06)) * rr;
    q = mix(q, sym, clamp(wKaleid, 0.0, 1.0) * 0.85);
  }

  // Liquid domain warp, centered on a DRIFTING off-center point so the motion
  // never pivots around the middle. Stronger for the Liquid style + on bass.
  vec2 c1 = vec2(sin(t * 0.11) * 0.7, cos(t * 0.09) * 0.6);
  vec2 wv2 = vec2(fbm((q + c1) * 2.1 + t * 0.15),
                  fbm((q + c1) * 2.1 - t * 0.12 + 9.0));
  q += (wv2 - 0.5) * (0.35 + bass * 0.7 + wLiquid * 0.9);

  float rad = length(q);
  vec3 col = vec3(0.0);

  // --- Plasma rainbow underlay (full frame) ---
  float pl = sin(q.x * 5.0 + t)
           + sin(q.y * 4.3 - t * 1.2)
           + sin((q.x - q.y) * 3.7 + t * 0.8)
           + fbm(q * 2.5 - t * 0.2) * 3.0;
  col += mix(pal(pl * 0.08 + t * 0.05), spectrum(pl * 0.09 + t * 0.06), 0.7)
         * (0.09 + lvl * 0.35) * (0.5 + wLiquid * 0.9 + wGrid * 0.3);

  // --- Particle swarm spread across the WHOLE frame, advected by a flow field
  // so it drifts and churns across the screen instead of orbiting a center. ---
  const int N = 52;
  for(int i = 0; i < N; i++){
    float fi = float(i);
    vec2 base = vec2(hash(vec2(fi, 1.7)), hash(vec2(fi, 4.3))) * 2.0 - 1.0;
    base.x *= asp;
    vec2 pos = base
             + flow2(fi, t) * (0.30 + 0.18 * sin(t * 0.2 + fi))
             + vec2(sin(t * 0.13 + fi * 1.3), cos(t * 0.11 + fi)) * 0.28;
    float wv = wavS(fi * 0.014 + t * 0.03);
    float d  = length(q - pos);
    float sz = 0.0045 + treb * 0.012 + uBeat * 0.004;
    float glow = sz / (d * d + sz * 0.7);
    vec3 pc = mix(pal(fi * 0.03 + t * 0.2 + rad * 0.2),
                  spectrum(fi * 0.02 + t * 0.28), 0.6);
    col += pc * glow * (0.3 + abs(wv) * 0.7 + uBeat * 0.5) * wSwarm;
  }
  col /= float(N) * 0.06;

  // --- Tunnel layer (corkscrew wormhole) ---
  if (wTunnel > 0.001) {
    float seg = 6.0 + mod(floor(t / 8.0), 4.0) * 2.0;
    float a   = atan(uv.y, uv.x) + sin(rad * 3.5 - t * (0.8 + bass * 1.5)) * 0.6 + t * 0.25;
    float kk  = 6.28318 / seg;
    float fa  = abs(mod(a, kk) - kk * 0.5);
    float wv  = wavS(fa * seg * 0.1 + t * 0.04);
    float spoke = exp(-pow(fa * seg, 2.0) * 0.6) * (0.6 + 0.8 * abs(wv));
    float rl    = length(uv);
    float rings = pow(0.5 + 0.5 * sin(rl * 20.0 - t * (3.0 + bass * 6.0)), 3.0);
    float fall  = clamp(1.0 / (rl * 1.8 + 0.25), 0.0, 1.8);
    col += spectrum(rl * 0.6 - t * 0.25 + wv * 0.3)
           * spoke * (0.4 + 0.6 * rings) * fall * wTunnel * 1.3;
  }

  // --- Grid / lattice layer (scrolling neon lines + crossing dots) ---
  if (wGrid > 0.001) {
    vec2 g  = q * 3.0 + vec2(t * 0.4, sin(t * 0.2) * 0.5);
    vec2 gf = abs(fract(g) - 0.5);
    float line = smoothstep(0.44, 0.5, max(gf.x, gf.y));
    float dot  = smoothstep(0.16, 0.0, length(gf));
    col += mix(pal(t * 0.1 + q.x * 0.2), spectrum(t * 0.15 + rad * 0.3), 0.6)
           * (line * 0.5 + dot * 0.8) * wGrid * (0.4 + lvl * 1.0 + uBeat * 0.5);
  }

  // Beat = strobing multicolour bloom of the whole field.
  col += spectrum(t * 0.4 + rad * 0.2) * uBeat * 0.3;

  col *= 0.4 + lvl * 1.3 + uBeat * 0.5;
  col *= 0.5 + uBrightness;
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
  // Saturation push — feedback mixing tends to gray the mids back out; keep the
  // neon colours electric.
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(mix(vec3(luma), c, 1.5), 0.0, 1.0);
  // Mild vignette keeps the edges reading as black.
  vec2 q = vUv * 2.0 - 1.0;
  c *= 1.0 - 0.30 * smoothstep(0.6, 1.6, dot(q, q));
  frag = vec4(c, 1.0);
}`;

window.NewonShaders = {
  VERT,
  scenes: { scene: FRAG_SCENE },
  FRAG_FEEDBACK,
  FRAG_BRIGHT,
  FRAG_BLUR,
  FRAG_COMPOSITE
};
