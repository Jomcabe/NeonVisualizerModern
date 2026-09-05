"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const { presets, palettes, defaults, settings } = window.NewonPresets;
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem("newon:4") || "null");
  } catch {}
  const state = settings(saved);
  const audio = new AudioEngine(),
    demo = new AudioAnalysis();
  const canvas = $("gl");
  let viz = null,
    failed = false,
    busy = false,
    source = "ambient",
    paused = false,
    dirty = true;
  let sceneTime = 0,
    elapsed = 0,
    lastFrame = performance.now(),
    nextScene = 32,
    hue = 0;
  let weights = presets.map((_, i) => (i === state.preset ? 1 : 0)),
    fadeFrom = weights.slice(),
    fadeTime = 4;
  let variation = 0,
    targetVariation = 0,
    mirror = false,
    probe = null;
  let noticeAction = "screen",
    welcome = true,
    lastInteraction = performance.now(),
    dragging = false;
  let pointer = [0, 0],
    pointerTarget = [0, 0],
    pointerStart = [0, 0],
    dragStart = [0, 0];
  let frames = 0,
    fpsTime = performance.now(),
    slowWindows = 0,
    visualAvailable = true;
  const demoWave = new Uint8Array(2048),
    demoFreq = new Uint8Array(1024);
  const drawWave = new Uint8Array(512).fill(128),
    spectrum = new Uint8Array(256);
  const hex = (h) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const colorStops = palettes.map((p) => p.colors.map(hex));
  const save = () => {
    try {
      localStorage.setItem("newon:4", JSON.stringify(state));
    } catch {}
  };
  function notice(text, action) {
    $("noticeText").textContent = text;
    noticeAction = action || "screen";
    $("noticeSettings").classList.toggle("hidden", !action || !window.newon);
    $("notice").classList.remove("hidden");
  }
  function fatal(error) {
    failed = true;
    visualAvailable = false;
    $("fatal").textContent = error.message || String(error);
    $("fatal").classList.remove("hidden");
    $("welcome").classList.add("hidden");
    console.error(error);
  }
  function initViz() {
    try {
      viz = new GLViz(canvas);
      viz.quality = state.quality;
      viz.resize();
      failed = false;
      $("fatal").classList.add("hidden");
    } catch (error) {
      fatal(error);
    }
  }
  initViz();
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    visualAvailable = false;
    if (viz) viz.lost = true;
    notice(
      "The graphics device paused. Newon will restore the picture when it becomes available.",
    );
  });
  canvas.addEventListener("webglcontextrestored", () => {
    initViz();
    visualAvailable = !failed;
    dirty = true;
    if (!failed) $("notice").classList.add("hidden");
  });
  function active() {
    lastInteraction = performance.now();
    document.body.classList.remove("immersed");
  }
  function dismissWelcome() {
    welcome = false;
    $("welcome").classList.add("hidden");
    active();
  }
  function setPanel(open) {
    $("panel").classList.toggle("hidden", !open);
    $("gear").setAttribute("aria-expanded", String(open));
    active();
    if (open) $("closePanel").focus();
    else $("gear").focus();
  }
  function selectScene(index, manual = true) {
    state.preset = (index + presets.length) % presets.length;
    fadeFrom = weights.slice();
    fadeTime = 0;
    nextScene = elapsed + 32;
    if (manual) {
      state.autoCycle = false;
      syncAuto();
    }
    if (paused) {
      weights = presets.map((_, i) => (i === state.preset ? 1 : 0));
      fadeFrom = weights.slice();
      fadeTime = 4;
    }
    syncScene();
    save();
    dirty = true;
    if (manual) active();
  }
  function syncScene() {
    const p = presets[state.preset];
    $("sceneNumber").textContent =
      String(state.preset + 1).padStart(2, "0") + " / 08";
    $("sceneName").textContent = p.name;
    $("sceneFamily").textContent = p.family;
    $("sceneCount").textContent = state.preset + 1 + " / " + presets.length;
    $("presetSel").value = state.preset;
  }
  function syncAuto() {
    $("autoCycle").checked = state.autoCycle;
    $("autoBtn").setAttribute("aria-pressed", String(state.autoCycle));
  }
  function toggleAuto() {
    state.autoCycle = !state.autoCycle;
    nextScene = elapsed + 32;
    syncAuto();
    save();
    active();
  }
  function changeVariation() {
    targetVariation = Math.random();
    mirror = Math.random() > 0.5;
    dirty = true;
    active();
  }
  function setPaused(value) {
    paused = value;
    $("pauseBtn").textContent = paused ? "▷" : "Ⅱ";
    $("pauseBtn").setAttribute(
      "aria-label",
      paused ? "Resume motion" : "Pause motion",
    );
    active();
  }
  function setSource(kind, label) {
    source = kind;
    probe = null;
    const names = {
      ambient: "Ambient",
      demo: "Demo",
      system: "System audio",
      mic: "Microphone",
      file: "Audio file",
    };
    $("sourceStatus").textContent = names[kind];
    $("audioLabel").textContent = label || names[kind];
    $("stopBtn").classList.toggle("hidden", kind === "ambient");
    for (const k of ["system", "file", "mic", "ambient"])
      $(k + "Btn").classList.toggle(
        "active",
        k === "ambient" ? kind === "demo" : k === kind,
      );
    if (kind !== "system") {
      $("nowplaying").classList.add("hidden");
      $("lyric").classList.add("hidden");
    }
  }
  function stop() {
    audio.stop();
    demo.reset();
    setSource("ambient", "Ambient motion · no audio input");
    dirty = true;
  }
  function explore() {
    stop();
    setSource("demo", "Generated rhythm · no audio input");
    dismissWelcome();
    setPaused(false);
  }
  async function listen(kind) {
    if (busy || failed) return;
    busy = true;
    const buttons = [
      "startBtn",
      "systemBtn",
      "micBtn",
      "fileBtn",
      "ambientBtn",
      "demoBtn",
      "stopBtn",
    ];
    buttons.forEach((id) => ($(id).disabled = true));
    $("notice").classList.add("hidden");
    let stream = null;
    try {
      if (!navigator.mediaDevices)
        throw new Error(
          "Audio capture is unavailable here. Use an audio file or the demo.",
        );
      if (kind === "mic")
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      else
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 320, height: 180, frameRate: 1 },
          audio: true,
        });
      if (!stream.getAudioTracks().length)
        throw new Error(
          window.newon
            ? "No system audio arrived. Check Screen & System Audio Recording permission, then try again."
            : "Choose a browser tab and enable “Share tab audio,” or open an audio file.",
        );
      await audio.attach(stream, kind);
      // Keep the display track alive: stopping it can end the audio track on
      // some platforms. No video is rendered, recorded, or sent anywhere.
      setSource(
        kind,
        kind === "mic"
          ? "Microphone · speakers are not monitored"
          : "Listening to system audio",
      );
      const current = stream;
      stream.getAudioTracks()[0].addEventListener("ended", () => {
        if (audio.stream === current) {
          stop();
          notice("Audio sharing stopped. Choose a source to reconnect.");
        }
      });
      dismissWelcome();
      setPaused(false);
      probe = { started: performance.now(), heard: false };
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      if (!audio.running && source !== "demo")
        setSource("ambient", "Ambient motion · no audio input");
      const message =
        error.name === "NotAllowedError"
          ? kind === "mic"
            ? "Microphone access was not granted. You can still use a file or the demo."
            : "Audio sharing was cancelled or permission was not granted. Try again when you are ready."
          : error.message;
      notice(message, kind === "system" && window.newon ? "screen" : null);
    } finally {
      busy = false;
      buttons.forEach((id) => ($(id).disabled = false));
      active();
    }
  }
  async function loadFile(file) {
    if (!file || busy || failed) return;
    if (file.size > 250 * 1024 * 1024) {
      notice("Choose an audio file smaller than 250 MB.");
      return;
    }
    busy = true;
    try {
      await audio.playFile(file);
      setSource("file", file.name);
      dismissWelcome();
      setPaused(false);
      $("nowplaying").classList.remove("hidden");
      $("np-art").classList.add("hidden");
      $("np-title").textContent = file.name;
      $("np-artist").textContent = "Local audio";
    } catch (error) {
      stop();
      notice("Could not decode this audio file. Try MP3, WAV, or M4A.");
    } finally {
      busy = false;
      $("audioFile").value = "";
    }
  }
  audio.onended = () => {
    setSource("ambient", "Track finished · choose another file");
    $("nowplaying").classList.add("hidden");
  };
  $("startBtn").onclick = () => listen("system");
  $("systemBtn").onclick = () => listen("system");
  $("micBtn").onclick = () => listen("mic");
  $("demoBtn").onclick = explore;
  $("ambientBtn").onclick = () => {
    if (!busy) explore();
  };
  $("stopBtn").onclick = () => {
    if (!busy) stop();
  };
  for (const id of ["fileBtn", "welcomeFile"])
    $(id).onclick = () => {
      if (!busy) $("audioFile").click();
    };
  $("audioFile").onchange = () => loadFile($("audioFile").files[0]);
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });
  $("gear").onclick = () => setPanel($("panel").classList.contains("hidden"));
  $("closePanel").onclick = () => setPanel(false);
  $("noticeClose").onclick = () => $("notice").classList.add("hidden");
  $("noticeSettings").onclick = () =>
    window.newon?.[
      noticeAction === "automation"
        ? "openAutomationSettings"
        : "openScreenRecordingSettings"
    ]();
  $("spotifyFixBtn").onclick = () => window.newon?.openAutomationSettings();
  $("prevBtn").onclick = () => selectScene(state.preset - 1);
  $("nextBtn").onclick = () => selectScene(state.preset + 1);
  $("pauseBtn").onclick = () => setPaused(!paused);
  $("autoBtn").onclick = toggleAuto;
  $("autoCycle").onchange = toggleAuto;
  $("fsBtn").onclick = toggleFullscreen;
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else
      document.documentElement
        .requestFullscreen()
        .catch(() => notice("Fullscreen is unavailable in this window."));
  }
  presets.forEach((p, i) =>
    $("presetSel").add(
      new Option(String(i + 1).padStart(2, "0") + "  " + p.name, i),
    ),
  );
  palettes.forEach((p, i) => $("paletteSel").add(new Option(p.name, i)));
  $("presetSel").onchange = () => selectScene(Number($("presetSel").value));
  $("paletteSel").onchange = () => {
    state.palette = Number($("paletteSel").value);
    save();
    dirty = true;
  };
  for (const key of ["sensitivity", "brightness", "bloom", "trails", "speed"]) {
    $(key).oninput = () => {
      state[key] = Number($(key).value);
      $(key + "Value").textContent = state[key].toFixed(2);
      save();
      dirty = true;
      active();
    };
  }
  $("showLyrics").onchange = () => {
    state.showLyrics = $("showLyrics").checked;
    save();
    updateLyrics();
  };
  $("quality").onchange = () => {
    state.quality = $("quality").value;
    if (viz) {
      viz.quality = state.quality;
      viz.resolutionScale = 1;
      viz.resize();
    }
    slowWindows = 0;
    save();
    dirty = true;
  };
  function syncControls() {
    syncScene();
    syncAuto();
    $("paletteSel").value = state.palette;
    $("quality").value = state.quality;
    $("showLyrics").checked = state.showLyrics;
    for (const key of [
      "sensitivity",
      "brightness",
      "bloom",
      "trails",
      "speed",
    ]) {
      $(key).value = state[key];
      $(key + "Value").textContent = state[key].toFixed(2);
    }
  }
  $("resetBtn").onclick = () => {
    Object.assign(state, defaults);
    targetVariation = 0;
    mirror = false;
    pointerTarget = [0, 0];
    paused = false;
    selectScene(0, false);
    syncControls();
    setPaused(false);
    save();
    if (viz) {
      viz.quality = "auto";
      viz.resolutionScale = 1;
      viz.resize();
    }
    dirty = true;
  };
  syncControls();
  if (!window.newon) {
    $("startBtn").firstChild.textContent = "Share tab audio ";
    $("welcomeHint").textContent =
      "The Mac app listens to system audio. In a browser, share a tab or open a file.";
  }
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName) &&
      event.key !== "Escape"
    )
      return;
    if (event.target.tagName === "BUTTON" && [" ", "Enter"].includes(event.key))
      return;
    const key = event.key.toLowerCase();
    if ([" ", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key))
      event.preventDefault();
    if (key === "c") setPanel($("panel").classList.contains("hidden"));
    else if (key === "f") toggleFullscreen();
    else if (key === "arrowright") selectScene(state.preset + 1);
    else if (key === "arrowleft") selectScene(state.preset - 1);
    else if (key === "r") changeVariation();
    else if (key === "a") toggleAuto();
    else if (key === " ") setPaused(!paused);
    else if (key === "escape") {
      setPanel(false);
      pointerTarget = [0, 0];
    }
    active();
  });
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStart = [e.clientX, e.clientY];
    pointerStart = pointerTarget.slice();
    canvas.setPointerCapture(e.pointerId);
    active();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      pointerTarget = [
        Math.max(
          -1,
          Math.min(1, pointerStart[0] + (e.clientX - dragStart[0]) / 400),
        ),
        Math.max(
          -1,
          Math.min(1, pointerStart[1] + (e.clientY - dragStart[1]) / 400),
        ),
      ];
      dirty = true;
    }
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });
  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });
  canvas.addEventListener("dblclick", () => {
    pointerTarget = [0, 0];
    dirty = true;
  });
  window.addEventListener("pointermove", active, { passive: true });
  window.addEventListener("resize", () => {
    if (viz && !failed && visualAvailable) viz.resize();
    dirty = true;
  });
  document.addEventListener("visibilitychange", () => {
    lastFrame = performance.now();
    fpsTime = lastFrame;
    frames = 0;
  });
  const gamepadButtons = new Map();
  function gamepad(dt) {
    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad || pad.mapping !== "standard") continue;
      const old = gamepadButtons.get(pad.index) || [];
      const pressed = (i) => pad.buttons[i]?.pressed && !old[i];
      if (pressed(4) || pressed(14)) selectScene(state.preset - 1);
      if (pressed(5) || pressed(15)) selectScene(state.preset + 1);
      if (pressed(0)) changeVariation();
      if (pressed(1)) setPanel($("panel").classList.contains("hidden"));
      if (pressed(2)) {
        $("paletteSel").value = state.palette =
          (state.palette + 1) % palettes.length;
        save();
      }
      if (pressed(3)) toggleAuto();
      if (pressed(9)) setPaused(!paused);
      const axis = (i) => (Math.abs(pad.axes[i] || 0) > 0.12 ? pad.axes[i] : 0);
      if (axis(0) || axis(1)) {
        pointerTarget = [
          Math.max(-1, Math.min(1, pointerTarget[0] + axis(0) * dt)),
          Math.max(-1, Math.min(1, pointerTarget[1] + axis(1) * dt)),
        ];
        active();
      }
      if (axis(2) || axis(3)) {
        hue += axis(2) * dt * 0.08;
        targetVariation = Math.max(
          0,
          Math.min(1, targetVariation + axis(3) * dt * 0.3),
        );
      }
      gamepadButtons.set(
        pad.index,
        pad.buttons.map((b) => b.pressed),
      );
    }
  }
  window.addEventListener("gamepaddisconnected", (e) =>
    gamepadButtons.delete(e.gamepad.index),
  );

  // Spotify remains a native integration. Ignore metadata while using another source.
  let playback = null,
    lyrics = [],
    automationWarned = false;
  if (window.newon) {
    window.newon.onNowPlaying((info) => {
      playback = info && info.name ? info : null;
      if (source !== "system") return;
      const playing = playback && playback.state === "playing";
      $("nowplaying").classList.toggle("hidden", !playing);
      if (playing) {
        $("np-title").textContent = playback.name;
        $("np-artist").textContent = playback.artist || "";
        const url = playback.artUrl || "";
        $("np-art").classList.toggle("hidden", !/^https?:/.test(url));
        if (/^https?:/.test(url)) $("np-art").src = url;
      }
      updateLyrics();
    });
    window.newon.onLyrics((data) => {
      lyrics = parseLyrics(data?.synced || "");
      updateLyrics();
    });
    window.newon.onSpotifyStatus((status) => {
      $("spotifyState").textContent =
        {
          ok: "Connected",
          idle: "Paused",
          notrunning: "Open Spotify",
          denied: "Permission needed",
        }[status] || "Unavailable";
      $("spotifyFixBtn").classList.toggle("hidden", status !== "denied");
      if (status === "denied" && !automationWarned && source === "system") {
        automationWarned = true;
        notice(
          "Allow Newon to read Spotify in macOS Automation settings to show the current track and lyrics.",
          "automation",
        );
      }
    });
  }
  function parseLyrics(text) {
    const parsed = [];
    for (const line of text.split("\n")) {
      const words = line.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g))
        parsed.push({ time: Number(m[1]) * 60 + Number(m[2]), text: words });
    }
    return parsed.sort((a, b) => a.time - b.time);
  }
  function updateLyrics() {
    if (
      !state.showLyrics ||
      source !== "system" ||
      playback?.state !== "playing" ||
      !lyrics.length
    ) {
      $("lyric").classList.add("hidden");
      return;
    }
    const pos =
      (playback.position || 0) + Math.max(0, (Date.now() - playback.ts) / 1000);
    let current = null;
    for (const line of lyrics) {
      if (line.time > pos) break;
      current = line;
    }
    const text = current && pos - current.time < 12 ? current.text : "";
    $("lyric").textContent = text;
    $("lyric").classList.toggle("hidden", !text);
  }
  function demoSignal(dt) {
    const t = elapsed,
      pulse = Math.exp(-(((t * 104) / 60) % 1) * 9),
      hat = Math.exp(-(((t * 104) / 30) % 1) * 18);
    for (let i = 0; i < demoWave.length; i++) {
      const a = (i / demoWave.length) * Math.PI * 2;
      demoWave[i] =
        128 +
        Math.sin(a * 8) * pulse * 42 +
        Math.sin(a * 29 + t) * 14 +
        Math.sin(a * 63) * hat * 8;
    }
    for (let i = 0; i < demoFreq.length; i++) {
      const b = Math.exp(-(((i - 5) / 5) ** 2)) * pulse * 200;
      const m =
        Math.exp(-(((i - 45 - 10 * Math.sin(t)) / 30) ** 2)) *
        (80 + 25 * Math.sin(t * 0.7));
      const h = Math.exp(-(((i - 270) / 150) ** 2)) * hat * 100;
      demoFreq[i] = Math.min(255, b + m + h);
    }
    return demo.analyze(demoWave, demoFreq, 44100, dt);
  }
  function prepareTextures(signal) {
    const wave = signal.wave,
      freq = signal.freq;
    let start = 0;
    for (let i = 1; i < Math.min(256, wave.length - 1024); i++)
      if (wave[i - 1] < 128 && wave[i] >= 128) {
        start = i;
        break;
      }
    for (let i = 0; i < 512; i++) {
      const j = Math.min(wave.length - 2, start + i * 2);
      drawWave[i] = (wave[j] + wave[j + 1]) * 0.5;
    }
    for (let i = 0; i < 256; i++) {
      const hz = 30 * Math.pow(16000 / 30, i / 255),
        index = Math.round(
          (hz / ((audio.ctx?.sampleRate || 44100) / 2)) * freq.length,
        );
      spectrum[i] = freq[Math.min(freq.length - 1, index)] || 0;
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    if (document.hidden) return;
    audio.update(dt);
    const signal = source === "demo" ? demoSignal(dt) : audio;
    if (probe) {
      if (audio.level > 0.012) probe = null;
      else if (now - probe.started > 9000) {
        probe = null;
        notice(
          "No audio is arriving yet. Start some music and check the selected source. If it stays silent, reconnect or check macOS audio permissions.",
          source === "system" && window.newon ? "screen" : null,
        );
      }
    }
    if (!paused) elapsed += dt;
    gamepad(dt);
    if (!paused && state.autoCycle && elapsed >= nextScene)
      selectScene((state.preset + 1) % presets.length, false);
    if (
      !paused &&
      state.autoCycle &&
      signal.section &&
      elapsed > nextScene - 10
    )
      selectScene((state.preset + 1) % presets.length, false);
    if (
      !paused &&
      now - lastInteraction > 3500 &&
      !welcome &&
      $("panel").classList.contains("hidden") &&
      $("notice").classList.contains("hidden") &&
      !document.querySelector("button:focus-visible")
    )
      document.body.classList.add("immersed");
    for (const [id, value] of [
      ["meterBass", signal.bassN],
      ["meterMid", signal.midN],
      ["meterTreble", signal.trebleN],
    ])
      $(id).style.setProperty("--level", Math.round(value * 100) + "%");
    updateLyrics();
    if (!viz || failed || !visualAvailable || (paused && !dirty)) return;
    const advance = paused ? 0 : dt;
    sceneTime += advance * state.speed * (0.82 + signal.level * 0.35);
    hue += advance * 0.012;
    variation += (targetVariation - variation) * (1 - Math.exp(-advance * 0.6));
    for (let i = 0; i < 2; i++)
      pointer[i] += (pointerTarget[i] - pointer[i]) * (1 - Math.exp(-dt * 4));
    fadeTime = Math.min(4, fadeTime + advance);
    const mix = fadeTime / 4,
      fade = mix * mix * (3 - 2 * mix);
    weights = fadeFrom.map(
      (w, i) => w * (1 - fade) + (i === state.preset ? fade : 0),
    );
    const blend = (key) =>
      presets.reduce((sum, p, i) => sum + p[key] * weights[i], 0);
    prepareTextures(signal);
    const gain = state.sensitivity;
    try {
      viz.render({
        time: sceneTime,
        dt,
        bass: Math.min(1, signal.bassN * gain),
        mid: Math.min(1, signal.midN * gain),
        treble: Math.min(1, signal.trebleN * gain),
        beat: signal.beat,
        level: signal.level,
        wave: drawWave,
        spectrum,
        pointer,
        hue,
        palette: palettes[state.palette],
        colors: colorStops[state.palette],
        layers: presets.map((p, i) => ({
          preset: { ...p, variation: (p.variation + variation) % 1 },
          weight: weights[i],
        })),
        decay: Math.min(0.978, blend("decay") + (state.trails - 0.65) * 0.075),
        zoom: blend("zoom") * (0.7 + signal.bassN * gain * 0.45),
        rotation: blend("rotation") * (0.8 + signal.midN * gain * 0.3),
        warp: blend("warp") * (0.8 + signal.flux * gain * 0.4),
        mirror,
        bloom: state.bloom,
        brightness: state.brightness,
      });
      dirty = false;
    } catch (error) {
      fatal(error);
      return;
    }
    frames++;
    if (now - fpsTime >= 2000) {
      const fps = Math.round((frames * 1000) / (now - fpsTime));
      fpsTime = now;
      frames = 0;
      $("fpsLabel").textContent =
        fps + " fps · " + canvas.width + " × " + canvas.height;
      if (state.quality === "auto" && fps < 36 && !paused) slowWindows++;
      else slowWindows = 0;
      if (slowWindows >= 3 && viz.resolutionScale > 0.62) {
        viz.resolutionScale *= 0.82;
        viz.resize();
        slowWindows = 0;
      }
    }
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    setPaused(true);
  requestAnimationFrame(frame);
  window.addEventListener("beforeunload", () => {
    audio.stop();
    viz?.dispose();
  });
})();
