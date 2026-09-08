import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(ROOT, 'public');
const GECKODRIVER_PATH =
  process.env.GECKODRIVER_PATH ||
  (fs.existsSync('/snap/bin/geckodriver') ? '/snap/bin/geckodriver' : 'geckodriver');
const FIREFOX_PATH =
  process.env.FIREFOX_PATH ||
  (fs.existsSync('/snap/firefox/current/usr/lib/firefox/firefox')
    ? '/snap/firefox/current/usr/lib/firefox/firefox'
    : undefined);

class WebDriverClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await res.json();
    if (res.status >= 400 || (data.value && data.value.error)) {
      const errMessage = data.value?.message || data.value?.error || `HTTP ${res.status}`;
      throw new Error(`WebDriver error at ${endpoint}: ${errMessage}`);
    }
    return data.value;
  }

  async startSession() {
    const caps = {
      capabilities: {
        alwaysMatch: {
          'moz:firefoxOptions': {
            ...(FIREFOX_PATH ? { binary: FIREFOX_PATH } : {}),
            args: [],
          },
        },
      },
    };
    const value = await this.request('/session', {
      method: 'POST',
      body: JSON.stringify(caps),
    });
    this.sessionId = value.sessionId;
    return this.sessionId;
  }

  async deleteSession() {
    if (this.sessionId) {
      try {
        await this.request(`/session/${this.sessionId}`, { method: 'DELETE' });
      } catch {}
      this.sessionId = null;
    }
  }

  async installAddon(addonPath) {
    return this.request(`/session/${this.sessionId}/moz/addon/install`, {
      method: 'POST',
      body: JSON.stringify({ path: addonPath, temporary: true }),
    });
  }

  async navigateTo(url) {
    return this.request(`/session/${this.sessionId}/url`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async executeScript(script, args = []) {
    const scriptStr =
      typeof script === 'function'
        ? `return (${script.toString()})(...arguments);`
        : script;
    return this.request(`/session/${this.sessionId}/execute/sync`, {
      method: 'POST',
      body: JSON.stringify({ script: scriptStr, args }),
    });
  }

  async waitFor(predicateFn, timeoutMs = 15000, intervalMs = 200, args = []) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.executeScript(predicateFn, args);
        if (result) return result;
      } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for condition: ${predicateFn.toString()}`);
  }
}

let server = null;
let geckodriverProc = null;
let client = null;
let isCleaningUp = false;

async function cleanup(exitCode = null) {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log('\n[Teardown] Cleaning up Firefox session, geckodriver, and server...');
  if (client) {
    try {
      await client.deleteSession();
    } catch {}
    client = null;
  }
  if (geckodriverProc && !geckodriverProc.killed) {
    try {
      geckodriverProc.kill('SIGTERM');
    } catch {}
    geckodriverProc = null;
  }
  if (server) {
    try {
      server.close();
    } catch {}
    server = null;
  }
  if (exitCode !== null) {
    process.exit(exitCode);
  }
}

process.on('SIGINT', async () => {
  console.log('\n[Firefox] Interrupted by SIGINT');
  await cleanup(130);
});

process.on('SIGTERM', async () => {
  console.log('\n[Firefox] Terminated by SIGTERM');
  await cleanup(143);
});

async function main() {
  const zipPath = path.resolve(ROOT, '.output/skk-browser-extension-0.0.0-firefox.zip');
  if (!fs.existsSync(zipPath)) {
    console.log('[Build] Building Firefox extension package...');
    execSync('npm run build:firefox && npm run build:firefox:zip', { cwd: ROOT, stdio: 'inherit' });
  }

  console.log('[Test Server] Starting local test server...');
  server = http.createServer((req, res) => {
    let reqUrl = req.url === '/' ? '/test.html' : req.url;
    let filePath = path.join(PUBLIC_DIR, reqUrl);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      const ext = path.extname(filePath);
      const contentType =
        ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  const port = await new Promise((resolve) => {
    server.listen(3456, '127.0.0.1', () => resolve(3456));
    server.on('error', () => {
      server = http.createServer((req, res) => {
        let reqUrl = req.url === '/' ? '/test.html' : req.url;
        let filePath = path.join(PUBLIC_DIR, reqUrl);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end('Not found');
        } else {
          const ext = path.extname(filePath);
          const contentType =
            ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain';
          res.writeHead(200, { 'Content-Type': contentType });
          fs.createReadStream(filePath).pipe(res);
        }
      });
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
  });

  console.log(`[Test Server] Serving on http://127.0.0.1:${port}/test.html`);

  console.log('[Geckodriver] Launching geckodriver on dynamic port...');
  geckodriverProc = spawn(GECKODRIVER_PATH, ['--port', '0', '-vv']);

  geckodriverProc.stderr.on('data', (d) => {
    console.error('[Geckodriver stderr]', d.toString().trim());
  });

  let geckodriverPort = null;
  geckodriverProc.stdout.on('data', (d) => {
    const text = d.toString();
    const match = text.match(/Listening on [^:]+:(\d+)/);
    if (match) {
      geckodriverPort = parseInt(match[1], 10);
    }
  });

  geckodriverProc.on('close', (code) => {
    console.log(`[Geckodriver] Process exited with code ${code}`);
    cleanup(0);
  });

  for (let i = 0; i < 50; i++) {
    if (geckodriverPort) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!geckodriverPort) {
    throw new Error('Failed to start geckodriver: port not detected');
  }
  console.log(`[Geckodriver] Listening on port ${geckodriverPort}`);

  client = new WebDriverClient(`http://127.0.0.1:${geckodriverPort}`);

  console.log('[Firefox] Starting interactive Firefox browser session...');
  const sessionId = await client.startSession();
  console.log(`[Firefox] Session created: ${sessionId}`);

  console.log(`[Firefox] Installing addon from ${zipPath}...`);
  await client.installAddon(zipPath);
  console.log('[Firefox] SKK extension installed successfully.');

  const testUrl = `http://127.0.0.1:${port}/test.html`;
  console.log(`[Firefox] Navigating to ${testUrl}...`);
  await client.navigateTo(testUrl);

  console.log('[Firefox] Waiting for SKK extension initialization on page...');
  await client.waitFor(
    () => document.documentElement.getAttribute('data-skk-initialized') === 'true',
    15000
  );
  console.log('[Firefox] SKK extension initialized and ready!');

  // Focus the first input element so user can type immediately
  await client.executeScript(() => {
    document.getElementById('input-test')?.focus();
  });

  console.log(`\n🎉 Firefox is running with SKK Extension at ${testUrl}`);
  console.log('💡 Press Ctrl+j in any input/textarea/contenteditable/monaco to toggle SKK mode [かな]');
  console.log('Close the Firefox window or press Ctrl+C to terminate.\n');

  // Keep node process alive without sending any further WebDriver commands
  // This leaves Firefox 100% free and responsive for user interaction
  await new Promise(() => {});
}

main().catch(async (err) => {
  console.error('[Firefox Launch Error]:', err);
  await cleanup(1);
});
