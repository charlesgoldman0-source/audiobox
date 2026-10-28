// electron-builder hook. On macOS the app is not signed with an Apple certificate (that
// needs a paid developer account), but Apple Silicon refuses to run a binary with no
// signature at all, so the app is given an ad-hoc one. People still right-click and choose
// Open the first time, as the README says.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log('ad-hoc signed', appPath);
};
