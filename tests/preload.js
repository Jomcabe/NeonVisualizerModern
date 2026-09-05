"use strict";
// Model a disconnected controller in desktop integration tests. This avoids
// asking CI's virtual desktop for physical USB/udev access. Production uses
// Electron's normal preload and the real Gamepad API.
Object.defineProperty(navigator, "getGamepads", { value: () => [] });
const add = window.addEventListener.bind(window);
window.addEventListener = (type, listener, options) => {
  if (type === "gamepadconnected" || type === "gamepaddisconnected") return;
  add(type, listener, options);
};
// The renderer sees the desktop bridge; account/permission services remain
// isolated from a CI run. The production preload is packaged separately.
window.newon = {
  platform: "darwin",
  onNowPlaying() {},
  onLyrics() {},
  onSpotifyStatus() {},
  openScreenRecordingSettings() {},
  openAutomationSettings() {},
};
