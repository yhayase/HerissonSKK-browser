import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = path.resolve(ROOT, '.output/chrome-mv3');
const PUBLIC_DIR = path.resolve(ROOT, 'public');
const CHROME_PATH = process.env.CHROME_BIN || path.resolve(ROOT, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome');
import { execSync } from 'child_process';

// Ensure .output/chrome-mv3 exists; if not, build it
if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.log('[Build] Building extension before launching...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

const PROFILE_DIR = path.resolve(ROOT, '.browser-profile');

const cleanRequested = process.argv.includes('--clean');
if (cleanRequested) {
  console.log('[Browser] Cleaning profile directory (--clean)...');
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
} else {
  // Remove stale singleton locks from previous crashed or killed Chrome processes
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = path.join(PROFILE_DIR, lock);
    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

// Ensure profile dir exists
fs.mkdirSync(PROFILE_DIR, { recursive: true });

// Start local HTTP server for test page
const server = http.createServer((req, res) => {
  let reqUrl = req.url === '/' ? '/test.html' : req.url;
  let filePath = path.join(PUBLIC_DIR, reqUrl);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(3456, '127.0.0.1', () => {
  console.log('[Test Server] Running at http://127.0.0.1:3456/test.html');

  const args = [
    '--no-sandbox',
    `--user-data-dir=${PROFILE_DIR}`,
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    'http://127.0.0.1:3456/test.html',
  ];

  console.log('[Browser] Launching Chrome for Testing with SKK Extension...');
  const chrome = spawn(CHROME_PATH, args, { stdio: 'inherit' });

  chrome.on('close', (code) => {
    console.log(`[Browser] Chrome exited with code ${code}`);
    server.close();
    process.exit(0);
  });
});
