"use strict";

// An independent light synthesizer, inspired by Neon's textured 3D forms and
// recursive image processing. All geometry and textures are generated here.
(() => {
  const FULLSCREEN = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const COMMON = `
precision highp float;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
uniform vec2 uResolution, uPointer;
uniform float uTime, uBass, uMid, uTreble, uLevel, uBeat, uHue, uVariation;
uniform float uShape, uPalette, uEnergy, uTexture;
uniform vec3 uColA, uColB, uColC;
uniform sampler2D uWave, uSpectrum, uHistory;
mat2 turn(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float wave(float p) { return texture(uWave,vec2(fract(p),0.5)).r*2.0-1.0; }
float band(float p) { return texture(uSpectrum,vec2(clamp(p,0.0,1.0),0.5)).r; }
vec3 ink(float h) {
  vec3 rainbow=clamp(abs(fract(h+vec3(0.,0.66667,0.33333))*6.0-3.0)-1.0,0.0,1.0);
  rainbow=pow(rainbow,vec3(0.7));
  float p=fract(h)*3.0;
  vec3 chosen=p<1.0?mix(uColA,uColB,p):p<2.0?mix(uColB,uColC,p-1.0):mix(uColC,uColA,p-2.0);
  return mix(rainbow,chosen,uPalette);
}
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
`;

  const BACKGROUND =
    "#version 300 es\n" +
    COMMON +
    `
in vec2 vUv; out vec4 frag;
void main() {
  vec2 p=(vUv*2.0-1.0)*vec2(uResolution.x/uResolution.y,1.0);
  p-=uPointer*0.08;
  float t=uTime*0.12, r=length(p), a=atan(p.y,p.x);
  float mist=sin(p.x*2.1+t)+sin(p.y*2.7-t*0.8)+sin(r*3.0-t);
  vec3 col=ink(mist*0.09+uHue+0.6)*0.012*(1.0+uLevel);
  if (uShape>2.5 && uShape<3.5) {
    // A textured tunnel, with a moving vanishing point and bands on its walls.
    vec2 q=p+vec2(sin(t*0.72),cos(t*0.81))*0.12;
    float radius=max(length(q),0.025), angle=atan(q.y,q.x);
    float z=1.8/radius;
    float twist=angle+z*0.22+sin(z*0.55-t)*0.5;
    vec2 uv=vec2(twist/TAU,z*0.16-uTime*0.12);
    float flutes=pow(0.5+0.5*cos(twist*10.0+z*0.15),8.0);
    float ribs=pow(0.5+0.5*cos(z*5.0-uTime*1.4+sin(twist*5.0)),18.0);
    float lace=pow(0.5+0.5*sin(twist*17.0+z*6.0),18.0);
    float fade=smoothstep(0.03,0.30,radius)*exp(-radius*0.38);
    vec3 echo=texture(uHistory,fract(uv*vec2(1.0,0.8))).rgb;
    col+=ink(twist/TAU+z*0.035+uHue)*(flutes*0.24+ribs*0.15+lace*0.06)*fade;
    col+=echo*0.07*fade*uTexture;
    col+=ink(uHue+0.1)*0.06/(1.0+radius*radius*60.0);
  } else {
    // Soft, irregular light sheets behind the foreground, not a starfield.
    for(int i=0;i<3;i++) {
      float fi=float(i);
      float curve=sin(p.x*(1.5+fi*0.5)+t+fi*2.0)*0.32
                 +sin(p.x*3.3-t*0.7)*0.12;
      float d=abs(p.y-curve+(fi-1.0)*0.46);
      float beam=0.005/(d*d*130.0+0.025);
      col+=ink(uHue+fi*0.27+p.x*0.07)*beam*0.12;
    }
  }
  frag=vec4(col*uEnergy,1.0);
}`;

  const MESH_VERTEX =
    "#version 300 es\n" +
    COMMON +
    `
layout(location=0) in vec2 aUV;
out vec2 vSurface;
out vec3 vNormal, vPosition;
out float vInstance, vDepth;
vec3 surface(vec2 uv, float id) {
  float a=uv.x*TAU, b=uv.y*TAU;
  float t=uTime*0.16, variation=uVariation;
  float audio=wave(uv.x)*0.13+band(uv.x)*uMid*0.09;
  vec3 p;
  if(uShape<0.5) {
    // Interwoven torus-knot tubes. Audio changes the cross-section.
    float r=1.05+(0.22+variation*0.25)*cos(3.0*a+t);
    vec3 c=vec3(r*cos(2.0*a),r*sin(2.0*a),(0.3+variation*0.35)*sin(3.0*a+t));
    vec3 radial=normalize(vec3(c.xy,0.0));
    float tube=0.10+0.05*uBass+audio;
    p=c+tube*(radial*cos(b)+vec3(0,0,sin(b)));
    p.xy=turn(id*TAU/3.0+t*0.32)*p.xy;
    p.yz=turn(id*0.72+t*0.45)*p.yz;
    p*=0.80+id*0.18;
  } else if(uShape<1.5) {
    // A folded, translucent flower. The petal count stays stable within a look.
    float petals=5.0+floor(variation*4.0);
    float v=uv.y;
    float r=0.12+v*(1.2+0.36*cos(a*petals+t));
    p=vec3(cos(a)*r,sin(a)*r,
      0.60*sin(v*PI+a*2.0+t)+0.22*cos(a*petals-t)*v);
    p.xy=turn(t*0.25+id*0.21)*p.xy;
    p.z+=(id-1.0)*0.25;
    p*=1.0+0.18*uBass+audio;
  } else if(uShape<2.5) {
    // Broad silk strips with a moving edge and a readable surface.
    float x=(uv.x-0.5)*5.0;
    float y=(uv.y-0.5)*0.62;
    p=vec3(x,y+0.45*sin(x*1.45+t+id*1.4),
      (0.3+variation*0.45)*cos(x*1.05-t+id*1.1));
    p.yz=turn(x*0.65+t+id)*p.yz;
    p.y+=(id-1.0)*0.28;
    p.xy=turn(sin(t*0.36)*0.3+id*0.55)*p.xy;
    p.z+=audio*2.0;
  } else if(uShape<3.5) {
    // A set of helixes inside the tunnel.
    float z=(uv.x-0.5)*8.0;
    float ang=z*1.6+id*TAU/3.0+t;
    float r=1.20+0.2*sin(z+t)+uBass*0.18;
    p=vec3(cos(ang)*(r+0.055*cos(b)),sin(ang)*(r+0.055*cos(b)),z+0.055*sin(b));
  } else if(uShape<4.5) {
    // Six faces of a cube: recursive images become a real moving 3D object.
    vec2 q=(uv*2.0-1.0)*0.95;
    p=id<0.5?vec3(q,0.95):id<1.5?vec3(q,-0.95):
      id<2.5?vec3(0.95,q):id<3.5?vec3(-0.95,q):
      id<4.5?vec3(q.x,0.95,q.y):vec3(q.x,-0.95,q.y);
    p*=1.0+0.07*sin(q.x*5.0+q.y*4.0+t)+uBass*0.12;
    p.xy=turn(t*0.57)*p.xy; p.yz=turn(t*0.71)*p.yz;
  } else {
    // Nested rings become a lobed mandala in the feedback field.
    float petals=6.0+floor(variation*4.0);
    float r=0.68+0.15*cos(a*petals+t)+id*0.22+audio;
    p=vec3(cos(a)*(r+cos(b)*0.06),sin(a)*(r+cos(b)*0.06),
      sin(a*3.0-t)*0.2+sin(b)*0.06);
    p.xy=turn(id*0.20-t*0.3)*p.xy;
  }
  return p;
}
vec3 camera(vec3 p) {
  float t=uTime*0.085;
  float tilt=uShape>4.5?0.25:0.58;
  p.xz=turn(sin(t*0.71)*tilt+uPointer.x*1.4)*p.xz;
  p.yz=turn(cos(t*0.57)*tilt+uPointer.y*1.0)*p.yz;
  p.xy=turn(sin(t*0.3)*0.24)*p.xy;
  return p;
}
void main() {
  float id=float(gl_InstanceID);
  vec3 p=surface(aUV,id);
  vec3 dx=surface(aUV+vec2(0.0005,0),id)-p;
  vec3 dy=surface(aUV+vec2(0,0.0005),id)-p;
  vec3 n=normalize(cross(dx,dy)+vec3(0.000001));
  vNormal=camera(n); p=camera(p); vPosition=p;
  float distance=uShape>2.5&&uShape<3.5?6.0:4.5;
  float z=max(0.4,distance-p.z);
  float focal=2.15;
  gl_Position=vec4(p.x*focal/(uResolution.x/uResolution.y),p.y*focal,z-0.2,z);
  vSurface=aUV; vInstance=id; vDepth=clamp(3.5/z,0.35,1.4);
}`;

  const MESH_FRAGMENT =
    "#version 300 es\n" +
    COMMON +
    `
in vec2 vSurface; in vec3 vNormal, vPosition;
in float vInstance, vDepth; out vec4 frag;
void main() {
  vec2 uv=vSurface;
  vec3 n=normalize(vNormal);
  float face=abs(dot(n,normalize(vec3(0.2,0.3,1.0))));
  float rim=pow(1.0-face,2.2);
  float t=uTime*0.04;
  // Fine bands and small repeated cells are characteristic of the references.
  float stripes=pow(0.5+0.5*cos(uv.x*TAU*64.0+sin(uv.y*TAU*3.0+t)*2.0),18.0);
  float across=pow(0.5+0.5*cos(uv.y*TAU*10.0),22.0);
  float fine=pow(0.5+0.5*sin(uv.x*TAU*144.0),28.0);
  float edge=pow(abs(uv.y*2.0-1.0),18.0);
  if(uShape>3.5&&uShape<4.5) {
    vec2 cell=abs(fract(uv*7.0)-0.5);
    stripes=smoothstep(0.39,0.45,max(cell.x,cell.y));
    across=smoothstep(0.46,0.49,max(cell.x,cell.y));
    edge=smoothstep(0.91,0.97,max(abs(uv.x*2.0-1.0),abs(uv.y*2.0-1.0)));
  }
  float h=uHue+uv.x*0.85+uv.y*0.15+vInstance*0.17+vPosition.z*0.10;
  vec3 color=ink(h);
  vec2 echoUV=fract(uv*vec2(1.,1.)+n.xy*0.08+vec2(t*0.15,0));
  vec3 echo=texture(uHistory,echoUV).rgb;
  float detail=0.16+stripes*0.6+across*0.35+fine*0.08+edge*0.7;
  float light=0.13+0.60*face+rim*0.65;
  color*=detail*light*(0.75+0.35*uBass+0.20*uMid);
  color+=echo*(0.12+rim*0.18)*uTexture;
  color+=ink(h+0.13)*rim*0.11;
  // Narrow pearly highlights leave most of the image saturated.
  float spec=pow(abs(dot(n,normalize(vec3(-0.4,0.7,1.0)))),40.0);
  color+=vec3(0.55,0.63,0.72)*spec*(0.25+0.35*uTreble);
  frag=vec4(color*vDepth*uEnergy,1.0);
}`;

  const FEEDBACK = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uPrev, uSeed;
uniform vec2 uResolution, uCenter;
uniform float uTime, uDt, uDecay, uZoom, uRotation, uWarp, uMirror, uTint, uInjection;
mat2 turn(float a) { return mat2(cos(a),-sin(a),sin(a),cos(a)); }
void main() {
  float step=uDt*60.0, aspect=uResolution.x/uResolution.y;
  vec2 p=(vUv-0.5-uCenter)*vec2(aspect,1.0);
  float radius=length(p);
  float twist=uRotation+sin(radius*4.0-uTime*0.18)*uWarp*0.0015;
  p=turn(twist*step)*p;
  p*=exp(-uZoom*step);
  p+=vec2(sin(p.y*4.0+uTime*0.17),sin(p.x*3.5-uTime*0.19))*uWarp*0.0008*step;
  vec2 tc=p/vec2(aspect,1.0)+0.5+uCenter;
  if(uMirror>0.5) tc=mix(tc,abs(tc-0.5)+0.5,0.018*step);
  float inside=step==0.0?1.0:smoothstep(0.0,0.025,tc.x)*smoothstep(0.0,0.025,tc.y)
    *smoothstep(0.0,0.025,1.0-tc.x)*smoothstep(0.0,0.025,1.0-tc.y);
  vec3 history=texture(uPrev,clamp(tc,0.0,1.0)).rgb;
  history=mix(history,history.gbr,clamp(uTint*step,0.0,0.08));
  history*=pow(uDecay,step)*inside;
  vec3 seed=texture(uSeed,vUv).rgb;
  // Frame-time compensated injection and bounded feedback prevent white-outs.
  float inject=1.0-exp(-uInjection*step);
  vec3 col=history+seed*inject*(1.0-clamp(history*0.48,0.0,0.96));
  frag=vec4(min(col,vec3(5.0)),1);
}`;

  const BLUR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uImage;
uniform vec2 uDirection;
uniform float uExtract;
vec3 sampleLight(vec2 uv) {
  vec3 c=texture(uImage,uv).rgb;
  return c*mix(1.0,smoothstep(0.22,0.95,max(c.r,max(c.g,c.b))),uExtract);
}
void main() {
  vec3 c=sampleLight(vUv)*0.227027;
  c+=(sampleLight(vUv+uDirection*1.384615)+sampleLight(vUv-uDirection*1.384615))*0.316216;
  c+=(sampleLight(vUv+uDirection*3.230769)+sampleLight(vUv-uDirection*3.230769))*0.070270;
  frag=vec4(c,1);
}`;

  const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uImage, uBloom, uSeed;
uniform float uGlow, uBrightness;
void main() {
  // A fresh surface layer keeps the fine ribs readable through the trails.
  vec3 trail=texture(uImage,vUv).rgb;
  vec3 seed=texture(uSeed,vUv).rgb;
  vec3 c=max(trail*0.86,seed*0.95)+seed*0.20+texture(uBloom,vUv).rgb*uGlow*0.46;
  c*=uBrightness;
  // Luminance-preserving shoulder keeps bright red/green/blue from bleaching.
  float peak=max(c.r,max(c.g,c.b));
  c/=1.0+peak*0.55;
  float vignette=1.0-0.22*pow(length((vUv-0.5)*1.3),2.0);
  c=pow(max(c*vignette,vec3(0)),vec3(0.92));
  frag=vec4(c,1);
}`;
  window.NewonShaders = {
    FULLSCREEN,
    BACKGROUND,
    MESH_VERTEX,
    MESH_FRAGMENT,
    FEEDBACK,
    BLUR,
    COMPOSITE,
  };
})();
