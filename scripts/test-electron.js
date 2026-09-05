"use strict";
// Native Electron integration checks. No cloud browser or remote debugging.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const output =
  process.env.NEWON_TEST_OUTPUT ||
  path.join(os.tmpdir(), "newon-visual-checks");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "newon-test-")));
if (process.env.NEWON_SOFTWARE_GL === "1") {
  app.commandLine.appendSwitch("use-gl", "angle");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
let win;
const timeout = setTimeout(() => {
  console.error("Electron checks timed out");
  app.exit(1);
}, 180000);
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({
      width: 960,
      height: 600,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, "../tests/preload.js"),
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) console.error(message);
    });
    if (!process.env.NEWON_UI_ONLY) {
      await win.loadFile(path.join(__dirname, "../tests/visual.html"));
      ipcMain.handle("test-capture", (_e, index, url) => {
        fs.writeFileSync(
          path.join(output, "scene-" + index + ".png"),
          Buffer.from(url.split(",")[1], "base64"),
        );
      });
      const result = await win.webContents.executeJavaScript(
        "runVisualChecks((i,data)=>require('electron').ipcRenderer.invoke('test-capture',i,data))",
      );
      console.log(JSON.stringify(result, null, 2));
      fs.writeFileSync(
        path.join(output, "results.json"),
        JSON.stringify(result, null, 2),
      );
    }
    await win.loadFile(path.join(__dirname, "../src/index.html"));
    win.focus();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(1200);
    const error = await win.webContents.executeJavaScript(
      "document.getElementById('fatal').classList.contains('hidden') ? '' : document.getElementById('fatal').textContent",
    );
    if (error) throw new Error(error);
    fs.writeFileSync(
      path.join(output, "welcome.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.getElementById('demoBtn').click();document.getElementById('gear').click();document.getElementById('nextBtn').click()",
    );
    await sleep(1500);
    const ui = await win.webContents.executeJavaScript(
      "({scene:document.getElementById('sceneName').textContent,source:document.getElementById('sourceStatus').textContent,auto:document.getElementById('autoCycle').checked,panel:!document.getElementById('panel').classList.contains('hidden')})",
    );
    if (
      ui.scene !== "Solar blossom" ||
      ui.source !== "Demo" ||
      ui.auto ||
      !ui.panel
    )
      throw new Error(JSON.stringify(ui));
    fs.writeFileSync(
      path.join(output, "controls.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.getElementById('pauseBtn').click();document.getElementById('nextBtn').click();document.getElementById('stopBtn').click()",
    );
    const stopped = await win.webContents.executeJavaScript(
      "({paused:document.getElementById('pauseBtn').getAttribute('aria-label')==='Resume motion',source:document.getElementById('sourceStatus').textContent,scene:document.getElementById('sceneName').textContent})",
    );
    if (!stopped.paused || stopped.source !== "Ambient" || stopped.scene !== "Silk current") throw new Error(JSON.stringify(stopped));
    await win.webContents.executeJavaScript(
      "navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('denied','NotAllowedError')};navigator.mediaDevices.getUserMedia=async()=>{throw new Error('Microphone must not be requested by System')};document.getElementById('systemBtn').click()",
    );
    await sleep(100);
    const denied = await win.webContents.executeJavaScript(
      "({message:document.getElementById('noticeText').textContent,enabled:!document.getElementById('systemBtn').disabled,source:document.getElementById('sourceStatus').textContent})",
    );
    if (!denied.enabled || denied.source !== "Ambient" || !denied.message.includes("cancelled")) throw new Error(JSON.stringify(denied));
    console.log("Native renderer and controls passed. Captures: " + output);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
});
