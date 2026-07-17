'use strict';

// electron-builder afterPack hook: ad-hoc code-sign the packed .app.
//
// The build is intentionally unsigned (no Apple Developer certificate), but a
// *completely* unsigned app is worse than an ad-hoc-signed one: macOS reports
// quarantined unsigned apps as "damaged and can't be opened" (no bypass
// offered), and unsigned arm64 binaries won't launch on Apple Silicon at all.
// An ad-hoc signature ("codesign -s -") downgrades that to the standard
// "unidentified developer" prompt, which right-click → Open bypasses.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  if (!fs.existsSync(appPath)) return;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`Ad-hoc signed ${appPath}`);
};
