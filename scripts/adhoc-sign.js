'use strict';

// Ad-hoc sign the finished app. This personal build is not notarized.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // electron-builder 25 calls afterPack for both intermediate architectures,
  // then again after merging. Signing an intermediate app creates different
  // CodeResources manifests, which prevents @electron/universal from merging.
  if (/-universal-(?:x64|arm64)-temp$/.test(context.appOutDir)) {
    console.log('Deferring ad-hoc signing until the universal app is merged.');
    return;
  }
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  if (!fs.existsSync(appPath)) return;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`Ad-hoc signed ${appPath}`);
};
