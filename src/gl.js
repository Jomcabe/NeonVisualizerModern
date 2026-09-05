"use strict";

class GLViz {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance",
    }));
    if (!gl)
      throw new Error(
        "Newon needs WebGL 2. Enable hardware acceleration and reopen the app.",
      );
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    this.locations = new Map();
    this.quality = "auto";
    this.resolutionScale = 1;
    this.targets = {};
    this.textures = {};
    this.lost = false;
    const S = window.NewonShaders;
    this.programs = {
      background: this.program(S.FULLSCREEN, S.BACKGROUND),
      mesh: this.program(S.MESH_VERTEX, S.MESH_FRAGMENT),
      feedback: this.program(S.FULLSCREEN, S.FEEDBACK),
      blur: this.program(S.FULLSCREEN, S.BLUR),
      composite: this.program(S.FULLSCREEN, S.COMPOSITE),
    };
    this.emptyVAO = gl.createVertexArray();
    this.createMesh();
    this.resize();
  }
  program(vertex, fragment) {
    const gl = this.gl,
      program = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error("The visual engine could not start: " + message);
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    const uniforms = new Map();
    for (
      let i = 0;
      i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      i++
    ) {
      const info = gl.getActiveUniform(program, i);
      uniforms.set(info.name, gl.getUniformLocation(program, info.name));
    }
    this.locations.set(program, uniforms);
    return program;
  }
  uniform(program, name, value) {
    const gl = this.gl,
      loc = this.locations.get(program).get(name);
    if (loc === undefined) return;
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      if (value.length === 2) gl.uniform2fv(loc, value);
      else if (value.length === 3) gl.uniform3fv(loc, value);
    } else gl.uniform1f(loc, value);
  }
  texture(program, name, texture, unit) {
    const gl = this.gl,
      loc = this.locations.get(program).get(name);
    if (loc === undefined) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(loc, unit);
  }
  createMesh() {
    const gl = this.gl,
      width = 224,
      height = 24;
    const uv = [],
      indices = [];
    for (let y = 0; y <= height; y++)
      for (let x = 0; x <= width; x++) uv.push(x / width, y / height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const a = y * (width + 1) + x,
          b = a + width + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    this.meshVAO = gl.createVertexArray();
    gl.bindVertexArray(this.meshVAO);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW,
    );
    this.indexCount = indices.length;
    gl.bindVertexArray(null);
  }
  target(w, h) {
    const gl = this.gl,
      tex = gl.createTexture(),
      fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.hdr ? gl.RGBA16F : gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fb);
      throw new Error(
        "Could not allocate the visual buffers. Try a smaller window.",
      );
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h };
  }
  freeTargets() {
    for (const t of Object.values(this.targets)) {
      this.gl.deleteFramebuffer(t.fb);
      this.gl.deleteTexture(t.tex);
    }
    this.targets = {};
  }
  resize() {
    const gl = this.gl;
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      this.quality === "high" ? 2 : 1.5,
    );
    let w = Math.max(2, Math.round(this.canvas.clientWidth * dpr)),
      h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    const budget =
      this.quality === "low"
        ? 750000
        : this.quality === "high"
          ? 3600000
          : 1800000;
    const scale =
      Math.min(1, Math.sqrt(budget / (w * h))) * this.resolutionScale;
    w = Math.max(2, Math.round(w * scale));
    h = Math.max(2, Math.round(h * scale));
    if (
      w === this.canvas.width &&
      h === this.canvas.height &&
      this.targets.scene
    )
      return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.freeTargets();
    try {
      this.allocate(w, h);
    } catch (error) {
      this.freeTargets();
      if (!this.hdr) throw error;
      this.hdr = false;
      this.allocate(w, h);
    }
    this.flip = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  allocate(w, h) {
    for (const key of ["scene", "a", "b"])
      this.targets[key] = this.target(w, h);
    for (const key of ["blurA", "blurB"])
      this.targets[key] = this.target(Math.max(2, w >> 2), Math.max(2, h >> 2));
  }
  upload(name, data) {
    const gl = this.gl;
    let t = this.textures[name];
    if (!t) t = this.textures[name] = { tex: gl.createTexture(), length: 0 };
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (t.length !== data.length) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        data.length,
        1,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        data,
      );
      for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
        gl.texParameteri(gl.TEXTURE_2D, axis, gl.CLAMP_TO_EDGE);
      for (const param of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_2D, param, gl.LINEAR);
      t.length = data.length;
    } else
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        data.length,
        1,
        gl.RED,
        gl.UNSIGNED_BYTE,
        data,
      );
    return t.tex;
  }
  bind(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(
      0,
      0,
      target ? target.w : this.canvas.width,
      target ? target.h : this.canvas.height,
    );
  }
  full(program) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  sceneUniforms(program, u, preset, weight, previous) {
    const gl = this.gl;
    gl.useProgram(program);
    for (const [name, value] of Object.entries({
      uResolution: [this.canvas.width, this.canvas.height],
      uPointer: u.pointer,
      uTime: u.time,
      uBass: u.bass,
      uMid: u.mid,
      uTreble: u.treble,
      uLevel: u.level,
      uBeat: u.beat,
      uShape: preset.shape,
      uVariation: preset.variation,
      uHue: preset.hue + u.hue,
      uEnergy: preset.energy * weight,
      uTexture: preset.texture,
      uPalette: u.palette.full ? 0 : 1,
      uColA: u.colors[0],
      uColB: u.colors[1],
      uColC: u.colors[2],
    }))
      this.uniform(program, name, value);
    this.texture(program, "uWave", this.textures.wave.tex, 0);
    this.texture(program, "uSpectrum", this.textures.spectrum.tex, 1);
    this.texture(program, "uHistory", previous.tex, 2);
  }
  render(u) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) return;
    const T = this.targets,
      prev = this.flip ? T.a : T.b,
      curr = this.flip ? T.b : T.a;
    this.flip = !this.flip;
    this.upload("wave", u.wave);
    this.upload("spectrum", u.spectrum);
    this.bind(T.scene);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const layer of u.layers) {
      if (layer.weight < 0.001) continue;
      const p = layer.preset;
      this.sceneUniforms(this.programs.background, u, p, layer.weight, prev);
      this.full(this.programs.background);
      this.sceneUniforms(this.programs.mesh, u, p, layer.weight, prev);
      gl.bindVertexArray(this.meshVAO);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        this.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        p.shape === 4 ? 6 : 3,
      );
    }
    gl.disable(gl.BLEND);
    const f = this.programs.feedback;
    gl.useProgram(f);
    this.bind(curr);
    this.texture(f, "uPrev", prev.tex, 0);
    this.texture(f, "uSeed", T.scene.tex, 1);
    for (const [k, v] of Object.entries({
      uResolution: [curr.w, curr.h],
      uCenter: [
        Math.sin(u.time * 0.08) * 0.035,
        Math.cos(u.time * 0.07) * 0.035,
      ],
      uTime: u.time,
      uDt: u.dt,
      uDecay: u.decay,
      uZoom: u.zoom,
      uRotation: u.rotation,
      uWarp: u.warp,
      uMirror: u.mirror ? 1 : 0,
      uTint: 0.0018,
      uInjection: 0.42,
    }))
      this.uniform(f, k, v);
    this.full(f);
    const blur = this.programs.blur;
    gl.useProgram(blur);
    for (let pass = 0; pass < 4; pass++) {
      this.bind(pass % 2 === 0 ? T.blurA : T.blurB);
      this.texture(
        blur,
        "uImage",
        pass === 0 ? curr.tex : pass % 2 === 0 ? T.blurB.tex : T.blurA.tex,
        0,
      );
      this.uniform(
        blur,
        "uDirection",
        pass % 2 === 0 ? [1.5 / T.blurA.w, 0] : [0, 1.5 / T.blurA.h],
      );
      this.uniform(blur, "uExtract", pass === 0 ? 1 : 0);
      this.full(blur);
    }
    const comp = this.programs.composite;
    gl.useProgram(comp);
    this.bind(null);
    this.texture(comp, "uImage", curr.tex, 0);
    this.texture(comp, "uBloom", T.blurB.tex, 1);
    this.texture(comp, "uSeed", T.scene.tex, 2);
    this.uniform(comp, "uGlow", u.bloom);
    this.uniform(comp, "uBrightness", u.brightness);
    this.full(comp);
  }
  clear() {
    for (const t of [this.targets.a, this.targets.b]) {
      this.bind(t);
      this.gl.clearColor(0, 0, 0, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.bind(null);
  }
  dispose() {
    const gl = this.gl;
    this.freeTargets();
    Object.values(this.textures).forEach((t) => gl.deleteTexture(t.tex));
    Object.values(this.programs).forEach((p) => gl.deleteProgram(p));
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteVertexArray(this.meshVAO);
    gl.deleteVertexArray(this.emptyVAO);
  }
}
window.GLViz = GLViz;
