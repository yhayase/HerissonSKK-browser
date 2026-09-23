import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TEST_PAGE_DIR = path.join(ROOT, 'test/browser');
const CHROME_PATH = process.env.CHROME_PATH || path.join(ROOT, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome');
const FIREFOX_PATH = process.env.FIREFOX_PATH ||
  (fs.existsSync('/snap/firefox/current/usr/lib/firefox/firefox')
    ? '/snap/firefox/current/usr/lib/firefox/firefox'
    : 'firefox');
const GECKODRIVER_PATH = process.env.GECKODRIVER_PATH ||
  (fs.existsSync('/snap/bin/geckodriver') ? '/snap/bin/geckodriver' : 'geckodriver');
const DICTIONARY_SOURCE = 'https://raw.githubusercontent.com/skk-dev/dict/master/json/SKK-JISYO.S.json';
const CHROME_OUTPUT = '.output/chrome-mv3';
const FIREFOX_ZIP = `.output/${packageInfo.name}-${packageInfo.version}-firefox.zip`;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filename) {
  return sha256(fs.readFileSync(filename));
}

function sortedFileManifest(directory) {
  const files = [];
  function visit(currentDirectory, prefix) {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(filename, relativePath);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(filename);
        files.push({ path: relativePath, byteLength: bytes.length, sha256: sha256(bytes) });
      } else throw new Error(`Build output contains an unsupported entry: ${relativePath}`);
    }
  }
  visit(directory, '');
  const rootInput = files.map((file) => `${file.path}\0${file.sha256}\n`).join('');
  return { files, rootSha256: sha256(Buffer.from(rootInput, 'utf8')) };
}

function prepareBuildArtifacts(options, temporaryRoot, accessibleArtifactRoot) {
  const artifacts = {};
  if (options.browser === 'chrome' || options.browser === 'both') {
    const source = path.join(ROOT, CHROME_OUTPUT);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`Chrome build output is missing: ${CHROME_OUTPUT}`);
    }
    const snapshot = path.join(temporaryRoot, 'chrome-mv3');
    fs.cpSync(source, snapshot, { recursive: true, errorOnExist: true });
    const manifest = sortedFileManifest(snapshot);
    if (manifest.files.some((file) => file.path.startsWith('dict/'))) throw new Error('配布物に辞書が同梱されています。');
    artifacts.chrome = {
      executionPath: snapshot,
      report: {
        path: CHROME_OUTPUT,
        snapshot: '一時ディレクトリへコピー後にハッシュし、そのコピーをロードしました。',
        manifestRootAlgorithm: 'sorted path + NUL + file SHA-256 + LF',
        manifestRootSha256: manifest.rootSha256,
        files: manifest.files,
      },
    };
  }
  if (options.browser === 'firefox' || options.browser === 'both') {
    const source = path.join(ROOT, FIREFOX_ZIP);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`Firefox ZIP is missing: ${FIREFOX_ZIP}`);
    }
    const archive = fs.readFileSync(source);
    const snapshot = path.join(accessibleArtifactRoot, 'firefox.zip');
    fs.writeFileSync(snapshot, archive);
    artifacts.firefox = {
      executionPath: snapshot,
      report: {
        path: FIREFOX_ZIP,
        byteLength: archive.length,
        sha256: sha256(archive),
        snapshot: 'ZIP全体を読み込んでハッシュし、その同じバイト列を一時ファイルへ保存してインストールしました。',
      },
    };
  }
  return artifacts;
}

function parseArguments(argv) {
  const options = { browser: 'both', samples: 12, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help') {
      process.stdout.write('Usage: node test/production-candidate-timing.mjs [--browser chrome|firefox|both] [--samples N] [--output PATH]\n');
      process.exit(0);
    }
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Unknown or incomplete argument: ${key}`);
    index += 1;
    if (key === '--browser') options.browser = value;
    else if (key === '--output') options.output = path.resolve(value);
    else if (key === '--samples') {
      options.samples = Number(value);
      if (!Number.isInteger(options.samples) || options.samples <= 0) throw new Error('--samples must be a positive integer');
    } else throw new Error(`Unknown argument: ${key}`);
  }
  if (!['chrome', 'firefox', 'both'].includes(options.browser)) throw new Error('--browser must be chrome, firefox, or both');
  return options;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(samplesMs) {
  return { medianMs: percentile(samplesMs, 0.5), p95Ms: percentile(samplesMs, 0.95) };
}

function commandVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) return '取得できませんでした';
  return `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).find(Boolean) || '取得できませんでした';
}

async function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const filename = path.join(TEST_PAGE_DIR, pathname === '/' ? 'test.html' : pathname.slice(1));
    if (!filename.startsWith(`${TEST_PAGE_DIR}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const extension = path.extname(filename);
    const contentType = extension === '.html' ? 'text/html; charset=utf-8'
      : extension === '.js' ? 'text/javascript; charset=utf-8'
        : extension === '.json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function runChrome(sampleCount, port, temporaryRoot, extensionPath) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    enableExtensions: true,
    userDataDir: fs.mkdtempSync(path.join(temporaryRoot, 'chrome-profile-')),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/test.html`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#skk-browser-ext-hud-root', { timeout: 10000 });
    await page.waitForSelector('html[data-skk-initialized="true"]', { timeout: 30000 });
    await page.focus('#input-test');
    await page.$eval('#input-test', (element) => { element.value = ''; });
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyJ');
    await page.keyboard.up('Control');
    const samplesMs = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('KeyN');
      await page.keyboard.up('Shift');
      await page.keyboard.type('ihon');
      const start = performance.now();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => {
        const host = document.getElementById('skk-browser-ext-hud-root');
        return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent?.includes('日本');
      }, { timeout: 5000 });
      samplesMs.push(performance.now() - start);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.$eval('#input-test', (element) => { element.value = ''; });
    }
    return { browserVersion: await browser.version(), samplesMs, summary: summarize(samplesMs), candidate: '日本' };
  } finally {
    await browser.close();
  }
}

class WebDriverClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    this.capabilities = undefined;
  }
  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options,
    });
    const body = await response.json();
    if (!response.ok || body.value?.error) throw new Error(body.value?.message || body.value?.error || `HTTP ${response.status}`);
    return body.value;
  }
  async start() {
    const value = await this.request('/session', {
      method: 'POST', body: JSON.stringify({ capabilities: { alwaysMatch: { 'moz:firefoxOptions': {
        ...(FIREFOX_PATH ? { binary: FIREFOX_PATH } : {}), args: ['-headless'],
      } } } }),
    });
    this.sessionId = value.sessionId;
    this.capabilities = value.capabilities;
  }
  async installAddon(filename) {
    return this.request(`/session/${this.sessionId}/moz/addon/install`, {
      method: 'POST', body: JSON.stringify({ path: filename, temporary: true }),
    });
  }
  async navigate(url) {
    return this.request(`/session/${this.sessionId}/url`, { method: 'POST', body: JSON.stringify({ url }) });
  }
  async execute(script, args = []) {
    return this.request(`/session/${this.sessionId}/execute/sync`, {
      method: 'POST', body: JSON.stringify({ script: `return (${script.toString()})(...arguments);`, args }),
    });
  }
  async actions(actions) {
    return this.request(`/session/${this.sessionId}/actions`, {
      method: 'POST', body: JSON.stringify({ actions: [{ type: 'key', id: 'keyboard', actions }] }),
    });
  }
  async press(value) {
    return this.actions([{ type: 'keyDown', value }, { type: 'keyUp', value }]);
  }
  async combo(modifier, value) {
    return this.actions([
      { type: 'keyDown', value: modifier }, { type: 'keyDown', value },
      { type: 'keyUp', value }, { type: 'keyUp', value: modifier },
    ]);
  }
  async type(text) {
    const actions = [];
    for (const value of text) actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
    return this.actions(actions);
  }
  async waitFor(predicate, timeoutMs = 10000, intervalMs = 20) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.execute(predicate)) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timed out waiting for ${predicate}`);
  }
  async close() {
    if (!this.sessionId) return;
    try { await this.request(`/session/${this.sessionId}`, { method: 'DELETE' }); } finally { this.sessionId = null; }
  }
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function runFirefox(sampleCount, port, extensionZip) {
  const driverPort = await unusedPort();
  const driver = spawn(GECKODRIVER_PATH, ['--host', '127.0.0.1', '--port', String(driverPort)], { stdio: ['ignore', 'ignore', 'pipe'] });
  const baseUrl = `http://127.0.0.1:${driverPort}`;
  const client = new WebDriverClient(baseUrl);
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${baseUrl}/status`)).ok) break; } catch {}
      if (driver.exitCode !== null) throw new Error(`geckodriver exited with ${driver.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await client.start();
    await client.installAddon(extensionZip);
    await client.navigate(`http://127.0.0.1:${port}/test.html`);
    await client.waitFor(() => document.documentElement.getAttribute('data-skk-initialized') === 'true', 30000);
    await client.execute(() => {
      const element = document.getElementById('input-test');
      element.focus();
      element.value = '';
    });
    await client.combo('\uE009', 'j');
    const samplesMs = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      await client.combo('\uE008', 'N');
      await client.type('ihon');
      const start = performance.now();
      await client.press(' ');
      await client.waitFor(() => {
        const host = document.getElementById('skk-browser-ext-hud-root');
        return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent?.includes('日本');
      }, 5000, 20);
      samplesMs.push(performance.now() - start);
      await client.press('\uE00C');
      await client.press('\uE00C');
      await client.execute(() => { document.getElementById('input-test').value = ''; });
    }
    return { browserVersion: client.capabilities?.browserVersion, samplesMs, summary: summarize(samplesMs), candidate: '日本' };
  } finally {
    await client.close().catch(() => {});
    if (driver.exitCode === null) driver.kill('SIGTERM');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArguments(args);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skk-candidate-timing-'));
  let accessibleArtifactRoot;
  let server;
  try {
    accessibleArtifactRoot = fs.mkdtempSync(path.join(ROOT, '.output', 'candidate-artifacts-'));
    const artifacts = prepareBuildArtifacts(options, temporaryRoot, accessibleArtifactRoot);
    server = await startServer();
    const port = server.address().port;
    const results = {};
    if (artifacts.chrome) {
      results.chrome = await runChrome(options.samples, port, temporaryRoot, artifacts.chrome.executionPath);
    }
    if (artifacts.firefox) {
      results.firefox = await runFirefox(options.samples, port, artifacts.firefox.executionPath);
    }
    const report = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      provenance: {
        gitHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
        gitDirty: spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0,
        harnessSha256: sha256File(fileURLToPath(import.meta.url)),
        backgroundSha256: sha256File(path.join(ROOT, 'entrypoints/background.ts')),
        dictionary: { source: DICTIONARY_SOURCE, pinned: false, note: '初回に公式配信先から取得する辞書で測定します。辞書の内容は固定していません。' },
        executedArtifacts: Object.fromEntries(Object.entries(artifacts).map(([browser, artifact]) => [browser, artifact.report])),
        node: process.version,
        osRelease: os.release(),
        cpuModel: os.cpus()[0]?.model,
        chrome: commandVersion(CHROME_PATH),
        firefox: commandVersion(FIREFOX_PATH),
        geckodriver: commandVersion(GECKODRIVER_PATH),
      },
      invocation: { browser: options.browser, samples: options.samples, commandArguments: args },
      boundary: 'ドライバーがSpace送信を開始してから、ページ外からHUDの「日本」を観測するまでです。自動化通信と20ms以下のFirefoxポーリング待ちを含みます。純粋なユーザー入力レイテンシではありません。',
      results,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized);
      process.stderr.write(`[candidate timing] result: ${options.output}\n`);
    }
    process.stdout.write(serialized);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (accessibleArtifactRoot) fs.rmSync(accessibleArtifactRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
