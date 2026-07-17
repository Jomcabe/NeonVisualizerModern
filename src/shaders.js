'use strict';

// All GLSL lives here as strings so the app stays dependency-free (no build step).
// Scene shaders share a common header (uniforms + noise + palette helpers).

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

// ---- Mode 1: flowing neon ribbons (the signature Xbox "Neon" look) ----------
const FRAG_RIBBONS = SCENE_HEADER + `
void main(){
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float t    = uTime * 0.14;
  float bass = uBass * uSensitivity;
  float mid  = uMid  * uSensitivity;
  float treb = uTreble * uSensitivity;

  // Two-stage domain warp for organic, liquid motion.
  vec2 q = vec2(fbm(uv * 1.5 + t), fbm(uv * 1.5 - t + 5.0));
  vec2 r = vec2(fbm(uv * 2.0 + q * 2.0 + t * 0.7),
                fbm(uv * 2.0 + q * 2.0 - t * 0.5));
  float flow = fbm(uv * 2.4 + r * (2.0 + bass * 3.5) + vec2(0.0, t * 2.0));

  vec3 col = vec3(0.0);
  for(int i = 0; i < 3; i++){
    float fi   = float(i);
    float phase = flow * 6.2831 + t * 3.0 + fi * 2.094 + mid * 3.0;
    float line = abs(sin(phase + uv.y * 3.0));
    // High exponent => thin, bright filaments with black gaps between them.
    float glow = pow(1.0 - line, 18.0 + treb * 22.0);
    col += pal(flow + fi * 0.33 + t * 0.1) * glow;
  }

  // Audio drives filament brightness; beats sparkle *on* the filaments only,
  // so the black stays black instead of the whole field flashing.
  col *= 0.55 + uLevel * 1.7 + bass * 0.6;
  col += pal(fract(flow + 0.5)) * uBeat * 0.6 * pow(1.0 - abs(sin(flow * 6.2831)), 8.0);

  // Gentle vignette keeps the neon reading against the black.
  col *= 1.0 - 0.4 * dot(uv, uv) * 0.3;
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

  // Kaleidoscope folding; segment count breathes with the beat.
  float seg = 6.0 + floor(uBeat * 4.0);
  float k = 6.2831 / seg;
  ang = abs(mod(ang, k) - k * 0.5);

  float depth = 1.0 / (rad + 0.14) + uTime * (0.55 + bass * 0.8);
  float rings  = sin(depth * 6.0 - uTime * 4.0 + uBeat * 5.0);
  float spokes = sin(ang * seg * 2.0 + uTime + mid * 6.0);

  // Gate rings and spokes to sharp, bright structures with black gaps between.
  float ring  = pow(max(0.0, rings), 3.0);
  float spoke = pow(max(0.0, spokes), 2.0);
  float pat   = ring * (0.35 + 0.65 * spoke);
  float falloff = clamp(1.0 / (rad * 1.6 + 0.35), 0.0, 1.6); // clamp center blowout

  vec3 col = pal(depth * 0.1 + uTime * 0.05) * pat * falloff;
  col *= 0.5 + uLevel * 1.6 + bass * 1.1;
  col += pal(depth * 0.2) * uBeat * 0.5 * pat; // beat only lights the structure

  col *= 0.6 + uBrightness;
  frag = vec4(max(col, 0.0), 1.0);
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
  frag = vec4(c, 1.0);
}`;

window.NewonShaders = {
  VERT,
  scenes: { ribbons: FRAG_RIBBONS, tunnel: FRAG_TUNNEL },
  FRAG_BRIGHT,
  FRAG_BLUR,
  FRAG_COMPOSITE
};
