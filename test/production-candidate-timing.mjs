import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CHROME_PATH = process.env.CHROME_PATH || path.join(ROOT, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome');
const FIREFOX_PATH = process.env.FIREFOX_PATH ||
  (fs.existsSync('/snap/firefox/current/usr/lib/firefox/firefox')
    ? '/snap/firefox/current/usr/lib/firefox/firefox'
    : 'firefox');
const GECKODRIVER_PATH = process.env.GECKODRIVER_PATH ||
  (fs.existsSync('/snap/bin/geckodriver') ? '/snap/bin/geckodriver' : 'geckodriver');
const OFFICIAL_SHA256 = '729e562f963ec06186c251c116510d6ed89aa525be78d6e2795920786741f0bc';
const CHROME_OUTPUT = '.output/chrome-mv3';
const FIREFOX_ZIP = '.output/skk-browser-extension-0.0.0-firefox.zip';
const OFFICIAL_MEMBER = 'dict/SKK-JISYO.S.json';

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

function findEndOfCentralDirectory(archive) {
  if (archive.length < 22) throw new Error('Firefox ZIP is shorter than an end-of-central-directory record');
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Firefox ZIP has no end-of-central-directory record');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipMember(archive, memberPath) {
  const eocd = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocd + 6);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralDirectorySize = archive.readUInt32LE(eocd + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocd + 16);
  const commentLength = archive.readUInt16LE(eocd + 20);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || archive.readUInt16LE(eocd + 8) !== entryCount) {
    throw new Error('Multi-disk Firefox ZIP archives are not supported');
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('ZIP64 Firefox archives are not supported');
  }
  if (eocd + 22 + commentLength !== archive.length || centralDirectoryOffset + centralDirectorySize !== eocd) {
    throw new Error('Firefox ZIP central directory bounds are invalid');
  }
  let offset = centralDirectoryOffset;
  const matches = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Firefox ZIP central directory is invalid');
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const expectedCrc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const fileCommentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + fileCommentLength;
    if (nextOffset > eocd) throw new Error('Firefox ZIP central directory entry exceeds its bounds');
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === memberPath) matches.push({ flags, method, expectedCrc32, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  if (offset !== eocd || matches.length !== 1) {
    throw new Error(`Firefox ZIP must contain exactly one ${memberPath} member`);
  }
  const entry = matches[0];
  if ((entry.flags & 0x1) !== 0) throw new Error(`${memberPath} must not be encrypted`);
  if (entry.localHeaderOffset + 30 > centralDirectoryOffset || archive.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Firefox ZIP local header is invalid for ${memberPath}`);
  }
  const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6);
  const localMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
  const localNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
  if (dataOffset > centralDirectoryOffset) throw new Error(`Firefox ZIP local header exceeds its bounds: ${memberPath}`);
  const localName = archive.subarray(
    entry.localHeaderOffset + 30,
    entry.localHeaderOffset + 30 + localNameLength,
  ).toString('utf8');
  if (localName !== memberPath || localFlags !== entry.flags || localMethod !== entry.method) {
    throw new Error(`Firefox ZIP headers disagree for ${memberPath}`);
  }
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > centralDirectoryOffset) throw new Error(`Firefox ZIP member exceeds its bounds: ${memberPath}`);
  const compressed = archive.subarray(dataOffset, dataEnd);
  const bytes = entry.method === 0 ? Buffer.from(compressed)
    : entry.method === 8 ? zlib.inflateRawSync(compressed)
      : undefined;
  if (!bytes) throw new Error(`Firefox ZIP member uses unsupported compression method ${entry.method}: ${memberPath}`);
  if (bytes.length !== entry.uncompressedSize) throw new Error(`Firefox ZIP member size mismatch: ${memberPath}`);
  if (crc32(bytes) !== entry.expectedCrc32) throw new Error(`Firefox ZIP member CRC-32 mismatch: ${memberPath}`);
  return bytes;
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
    const official = manifest.files.find((file) => file.path === OFFICIAL_MEMBER);
    if (!official || official.sha256 !== OFFICIAL_SHA256) {
      throw new Error(`Chrome build output is missing the pinned official JSON: ${CHROME_OUTPUT}/${OFFICIAL_MEMBER}`);
    }
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
    const official = readZipMember(archive, OFFICIAL_MEMBER);
    const officialSha256 = sha256(official);
    if (officialSha256 !== OFFICIAL_SHA256) {
      throw new Error(`Firefox ZIP contains an unexpected ${OFFICIAL_MEMBER}`);
    }
    const snapshot = path.join(accessibleArtifactRoot, 'firefox.zip');
    fs.writeFileSync(snapshot, archive);
    artifacts.firefox = {
      executionPath: snapshot,
      report: {
        path: FIREFOX_ZIP,
        byteLength: archive.length,
        sha256: sha256(archive),
        snapshot: 'ZIP全体を読み込んでハッシュし、その同じバイト列を一時ファイルへ保存してインストールしました。',
        officialDictionaryMember: {
          path: OFFICIAL_MEMBER,
          byteLength: official.length,
          sha256: officialSha256,
          validation: 'インストール対象ZIPの中央ディレクトリとローカルヘッダーを検証し、展開したメンバーをハッシュしました。',
        },
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
    const filename = path.join(PUBLIC_DIR, pathname === '/' ? 'test.html' : pathname.slice(1));
    if (!filename.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
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
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      provenance: {
        gitHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
        gitDirty: spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0,
        harnessSha256: sha256File(fileURLToPath(import.meta.url)),
        backgroundSha256: sha256File(path.join(ROOT, 'entrypoints/background.ts')),
        officialDictionarySha256: OFFICIAL_SHA256,
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
