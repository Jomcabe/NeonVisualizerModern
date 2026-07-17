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
`;

// ---- Mode 1: "Neon" — mirrored live-waveform filaments ----------------------
// Draws the actual audio waveform as thin glowing filaments, folded through a
// kaleidoscope mirror and slowly rotating. Kept sparse and bright on black —
// the feedback pass turns these into the flowing, melting Neon light-forms.
const FRAG_RIBBONS = SCENE_HEADER + `
void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float bass = uBass * uSensitivity;
  float mid  = uMid  * uSensitivity;
  float treb = uTreble * uSensitivity;
  float t = uTime;

  // Slow, wandering global rotation so the feedback trails swirl.
  vec2 p = rot(t * 0.11 + sin(t * 0.047) * 0.9) * uv;

  // Kaleidoscope fold — the Neon radial symmetry.
  float k = 6.28318 / 4.0;
  float ang = atan(p.y, p.x);
  float rad = length(p);
  ang = abs(mod(ang, k) - k * 0.5);
  p = vec2(cos(ang), sin(ang)) * rad;

  vec3 col = vec3(0.0);
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    // Each filament reads a different shifted window of the live waveform.
    float x = p.x * 0.30 + fi * 0.37 + t * 0.035;
    float amp = 0.16 + bass * 0.55 + uBeat * 0.18;
    float y = wavS(x) * amp
            + sin(t * (0.33 + fi * 0.13) + fi * 2.1) * 0.34;   // slow drift
    float d = p.y - y;
    float core = exp(-d * d * (1500.0 + treb * 2500.0));  // thin bright core
    float halo = exp(-d * d * 70.0) * 0.10;               // soft aura
    // Hue cycles slowly and globally (per-filament offsets stay small) so
    // overlapping trails reinforce one color instead of averaging to gray.
    col += pal(x * 0.15 + t * 0.045 + fi * 0.09) * (core * (0.8 + treb * 0.8) + halo);
  }

  // Audio drives the energy fed into the feedback loop.
  col *= 0.22 + uLevel * 1.2 + uBeat * 0.5;
  col *= 0.5 + uBrightness;
  frag = vec4(max(col, 0.0), 1.0);
}`;

// ---- Mode 2: kaleidoscope tunnel -------------------------------------------
const FRAG_TUNNEL = SCENE_HEADER + `
void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float bass = uBass * uSensitivity;
  float mid  = uMid  * uSensitivity;

  float ang = atan(uv.y, uv.x);
  float rad = length(uv);

  // Fixed segment count (a varying count pops as the beat envelope decays);
  // beats twist the fold instead.
  float seg = 8.0;
  float k = 6.2831 / seg;
  ang = abs(mod(ang + uBeat * 0.25, k) - k * 0.5);

  float depth = 1.0 / (rad + 0.14) + uTime * (0.55 + bass * 0.8);
  float rings  = sin(depth * 6.0 - uTime * 4.0 + uBeat * 3.0);
  float spokes = sin(ang * seg * 2.0 + uTime + mid * 6.0);

  // Gate rings and spokes to sharp, bright structures with black gaps between.
  float ring  = pow(max(0.0, rings), 3.0);
  float spoke = pow(max(0.0, spokes), 2.0);
  float pat   = ring * (0.35 + 0.65 * spoke);
  float falloff = clamp(1.0 / (rad * 1.6 + 0.35), 0.0, 1.6); // clamp center blowout

  vec3 col = pal(depth * 0.1 + uTime * 0.05) * pat * falloff;
  col *= 0.35 + uLevel * 1.4 + bass * 0.9;
  col += pal(depth * 0.2) * uBeat * 0.5 * pat; // beat only lights the structure

  col *= 0.6 + uBrightness;
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
  scenes: { ribbons: FRAG_RIBBONS, tunnel: FRAG_TUNNEL },
  FRAG_FEEDBACK,
  FRAG_BRIGHT,
  FRAG_BLUR,
  FRAG_COMPOSITE
};
