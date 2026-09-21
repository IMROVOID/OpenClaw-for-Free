import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LauncherTarget {
  name: string;
  entryTs: string;
  bundleCjs: string;
  config: string;
  blob: string;
  exe: string;
}

const isWindows = process.platform === 'win32';
const isDarwin = process.platform === 'darwin';
const ext = isWindows ? '.exe' : '';

const rootDir = path.resolve(__dirname, '..');
const binDir = path.resolve(rootDir, 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

const desktopDir = isWindows
  ? path.join(process.env.USERPROFILE || '', 'Desktop')
  : path.join(process.env.HOME || '', 'Desktop');
const nodeExe = process.execPath;
const copyToDesktop = process.argv.includes('--desktop') || process.argv.includes('-d');

const launchers: LauncherTarget[] = [
  {
    name: 'OpenClaw-Control-Panel (Unified TUI)',
    entryTs: path.join(rootDir, 'src', 'control-panel', 'index.ts'),
    bundleCjs: path.join(__dirname, 'control-panel.cjs'),
    config: 'sea-config-control-panel.json',
    blob: 'sea-prep-control-panel.blob',
    exe: `OpenClaw-Control-Panel${ext}`
  }
];

console.log('==================================================');
console.log('   Building OpenClaw Unified Control Panel SEA    ');
console.log('==================================================\n');

const targets = launchers;

for (const item of targets) {
  console.log(`\n--- Packaging ${item.name} ---`);

  // 1. Bundle TypeScript into single CommonJS file via esbuild
  console.log(`[1/4] Bundling ${path.basename(item.entryTs)} via esbuild...`);
  execSync(`npx esbuild "${item.entryTs}" --bundle --platform=node --target=node22 --outfile="${item.bundleCjs}"`, {
    cwd: rootDir,
    stdio: 'inherit'
  });

  // 2. Generate SEA blob
  console.log(`[2/4] Generating SEA blob with ${item.config}...`);
  execSync(`node --experimental-sea-config ${item.config}`, { cwd: __dirname, stdio: 'inherit' });

  // 3. Copy node binary
  const targetExe = path.join(__dirname, item.exe);
  console.log(`[3/4] Copying base node runtime to ${item.exe}...`);
  fs.copyFileSync(nodeExe, targetExe);

  // 4. Postject injection
  console.log(`[4/4] Injecting resource blob into ${item.exe}...`);
  let postjectCmd = `npx postject ${item.exe} NODE_SEA_BLOB ${item.blob} --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite`;
  if (isDarwin) {
    postjectCmd += ' --macho-segment-name NODE_SEA';
  }
  execSync(postjectCmd, {
    cwd: __dirname,
    stdio: 'inherit'
  });

  if (isDarwin) {
    try {
      execSync(`codesign --sign - ${item.exe}`, { cwd: __dirname, stdio: 'inherit' });
    } catch (_) {}
  }

  // Deploy to bin and optionally Desktop
  console.log(`Deploying ${item.exe} to bin/...`);
  fs.copyFileSync(targetExe, path.join(binDir, item.exe));

  if (copyToDesktop) {
    try {
      if (fs.existsSync(desktopDir)) {
        fs.copyFileSync(targetExe, path.join(desktopDir, item.exe));
        console.log(`[OK] Deployed to Desktop (--desktop): ${path.join(desktopDir, item.exe)}`);
      }
    } catch (err: any) {
      console.warn(`Could not copy to Desktop: ${err.message}`);
    }
  }

  // Clean blob
  try {
    fs.unlinkSync(path.join(__dirname, item.blob));
  } catch (_) {}

  console.log(`[OK] ${item.name} build complete!`);
}

console.log('\n==================================================');
console.log('All executables built and deployed successfully!');
console.log('==================================================\n');
