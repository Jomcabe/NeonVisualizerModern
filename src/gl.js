'use strict';

// WebGL2 renderer. Pipeline per frame:
//   1) scene shader (seed shapes, driven by the live waveform) -> HDR target
//   2) feedback: warp/fade previous output + add seed -> HDR ping-pong target
//   3) bright-pass -> separable blur -> bloom
//   4) composite feedback + bloom -> screen
// The feedback loop is what produces the melting Neon light trails.

class GLViz {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not supported on this device.');
    this.gl = gl;
    this.canvas = canvas;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    const S = window.NewonShaders;
    this.quad = this._quad();
    this.programs = {
      flight: this._program(S.VERT, S.scenes.flight),
      neon: this._program(S.VERT, S.scenes.neon),
      tunnel: this._program(S.VERT, S.scenes.tunnel),
      feedback: this._program(S.VERT, S.FRAG_FEEDBACK),
      bright: this._program(S.VERT, S.FRAG_BRIGHT),
      blur: this._program(S.VERT, S.FRAG_BLUR),
      composite: this._program(S.VERT, S.FRAG_COMPOSITE)
    };
    this._locCache = new Map();
    this.fbo = {};
    this._feedbackFlip = false;
    this.waveTex = null;
    this.waveLen = 0;
    this.resize();
  }

  _quad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error: ' + gl.getShaderInfoLog(sh) + '\n' + src);
    }
    return sh;
  }

  _program(vsrc, fsrc) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fsrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  _loc(prog, name) {
    const key = prog.__id || (prog.__id = Math.random());
    const ck = key + name;
    if (this._locCache.has(ck)) return this._locCache.get(ck);
    const loc = this.gl.getUniformLocation(prog, name);
    this._locCache.set(ck, loc);
    return loc;
  }

  _createTarget(w, h, hdr) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = hdr && this.hdr ? gl.RGBA16F : gl.RGBA8;
    const type = hdr && this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  // Upload the live time-domain waveform (Uint8Array) as a 1D lookup texture.
  _updateWave(wave) {
    const gl = this.gl;
    if (!wave) return;
    if (!this.waveTex || this.waveLen !== wave.length) {
      if (this.waveTex) gl.deleteTexture(this.waveTex);
      this.waveTex = gl.createTexture();
      this.waveLen = wave.length;
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, wave.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, wave);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, wave.length, 1, gl.RED, gl.UNSIGNED_BYTE, wave);
    }
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.fbo.scene) return;
    this.canvas.width = w;
    this.canvas.height = h;

    // Free old targets.
    Object.values(this.fbo).forEach((t) => {
      if (!t) return;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    });

    const bw = Math.max(2, w >> 1);
    const bh = Math.max(2, h >> 1);
    // The scene (seed) pass renders below full resolution: the flight mode
    // raymarches a fractal per pixel, and the feedback blur + bloom re-soften
    // everything anyway, so full-res seeds only cost heat. Retina (dpr>=1.5)
    // takes half res (still >= 1x CSS pixels); plain displays get 3/4 so the
    // seed doesn't go mushy. Feedback and the composite stay full-res.
    const ss = (window.devicePixelRatio || 1) >= 1.5 ? 0.5 : 0.75;
    this.fbo = {
      scene: this._createTarget(Math.max(2, Math.floor(w * ss)), Math.max(2, Math.floor(h * ss)), true),
      feedbackA: this._createTarget(w, h, true),
      feedbackB: this._createTarget(w, h, true),
      bloomA: this._createTarget(bw, bh, true),
      bloomB: this._createTarget(bw, bh, true)
    };
    this._feedbackFlip = false;
  }

  _draw() {
    this.gl.bindVertexArray(this.quad);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  render(mode, u) {
    const gl = this.gl;
    const scene = this.fbo.scene;
    const A = this.fbo.bloomA;
    const B = this.fbo.bloomB;
    const prev = this._feedbackFlip ? this.fbo.feedbackA : this.fbo.feedbackB;
    const cur = this._feedbackFlip ? this.fbo.feedbackB : this.fbo.feedbackA;
    this._feedbackFlip = !this._feedbackFlip;
    const prog = this.programs[mode] || this.programs.neon;

    this._updateWave(u.wave);

    // 1) Seed scene pass -> offscreen HDR target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.useProgram(prog);
    gl.uniform2f(this._loc(prog, 'uResolution'), scene.w, scene.h);
    gl.uniform1f(this._loc(prog, 'uTime'), u.time);
    gl.uniform1f(this._loc(prog, 'uLevel'), u.level);
    gl.uniform1f(this._loc(prog, 'uBass'), u.bass);
    gl.uniform1f(this._loc(prog, 'uMid'), u.mid);
    gl.uniform1f(this._loc(prog, 'uTreble'), u.treble);
    gl.uniform1f(this._loc(prog, 'uBeat'), u.beat);
    gl.uniform1f(this._loc(prog, 'uSensitivity'), u.sensitivity);
    gl.uniform1f(this._loc(prog, 'uBrightness'), u.brightness);
    gl.uniform3fv(this._loc(prog, 'uColA'), u.colA);
    gl.uniform3fv(this._loc(prog, 'uColB'), u.colB);
    gl.uniform3fv(this._loc(prog, 'uColC'), u.colC);
    // Rollercoaster distance + visual DNA (unused uniforms resolve to null
    // locations, which WebGL silently ignores).
    gl.uniform1f(this._loc(prog, 'uDist'), u.dist || 0);
    gl.uniform4fv(this._loc(prog, 'uGene0'), u.gene0 || [4, 0.9, 0.8, 0.6]);
    gl.uniform4fv(this._loc(prog, 'uGene1'), u.gene1 || [0.5, 0.6, 1.6, 0.7]);
    gl.uniform4fv(this._loc(prog, 'uGene2'), u.gene2 || [0.15, 0, 0.4, 2.6]);
    gl.uniform4fv(this._loc(prog, 'uGene3'), u.gene3 || [1, 0.3, 0.5, 0]);
    gl.uniform4fv(this._loc(prog, 'uAud0'), u.aud0 || [0, 0, 0, 0]);
    gl.uniform4fv(this._loc(prog, 'uAud1'), u.aud1 || [0.35, 0, 0, 0]);
    gl.uniform4fv(this._loc(prog, 'uMotion'), u.motion || [0, 0, 0, 0]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.uniform1i(this._loc(prog, 'uWave'), 0);
    this._draw();

    // 2) Feedback: warped previous frame + seed -> current feedback target.
    const fb = this.programs.feedback;
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
    gl.viewport(0, 0, cur.w, cur.h);
    gl.useProgram(fb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(this._loc(fb, 'uPrev'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(this._loc(fb, 'uSeed'), 1);
    gl.uniform2f(this._loc(fb, 'uResolution'), cur.w, cur.h);
    gl.uniform1f(this._loc(fb, 'uDecay'), u.decay);
    gl.uniform1f(this._loc(fb, 'uZoom'), u.zoom);
    gl.uniform1f(this._loc(fb, 'uRot'), u.rot);
    gl.uniform1f(this._loc(fb, 'uHueDrift'), u.hueDrift);
    this._draw();

    // 3) Bright-pass -> bloomA (half res).
    const bright = this.programs.bright;
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
    gl.viewport(0, 0, A.w, A.h);
    gl.useProgram(bright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(this._loc(bright, 'uTex'), 0);
    gl.uniform1f(this._loc(bright, 'uThreshold'), 0.55);
    this._draw();

    // 4) Separable blur, ping-pong twice.
    const blur = this.programs.blur;
    gl.useProgram(blur);
    for (let i = 0; i < 2; i++) {
      // Horizontal A -> B
      gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb);
      gl.viewport(0, 0, B.w, B.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.uniform1i(this._loc(blur, 'uTex'), 0);
      gl.uniform2f(this._loc(blur, 'uDir'), 1, 0);
      gl.uniform2f(this._loc(blur, 'uTexel'), 1 / B.w, 1 / B.h);
      this._draw();
      // Vertical B -> A
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
      gl.viewport(0, 0, A.w, A.h);
      gl.bindTexture(gl.TEXTURE_2D, B.tex);
      gl.uniform2f(this._loc(blur, 'uDir'), 0, 1);
      this._draw();
    }

    // 5) Composite feedback + bloom -> screen.
    const comp = this.programs.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(comp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(this._loc(comp, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.uniform1i(this._loc(comp, 'uBloom'), 1);
    gl.uniform1f(this._loc(comp, 'uIntensity'), u.bloom);
    gl.uniform1f(this._loc(comp, 'uTime'), u.time);
    gl.uniform1f(this._loc(comp, 'uShift'), u.shift || 0);
    this._draw();
  }
}

window.GLViz = GLViz;
