import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_PATH = process.env.CHROME_PATH || path.join(ROOT, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome');
const FIREFOX_PATH = process.env.FIREFOX_PATH ||
  (fs.existsSync('/snap/firefox/current/usr/lib/firefox/firefox')
    ? '/snap/firefox/current/usr/lib/firefox/firefox'
    : 'firefox');
const GECKODRIVER_PATH = process.env.GECKODRIVER_PATH ||
  (fs.existsSync('/snap/bin/geckodriver') ? '/snap/bin/geckodriver' : 'geckodriver');
const BASELINE_COMMIT = 'e590f07';
const BASELINE_ORIGINAL_SHA256 = 'e79eba04b0208be699cf8bcbadd8419b84f3f5a5b83638a1be3bd163894ca8ea';
const OFFICIAL_SHA256 = '729e562f963ec06186c251c116510d6ed89aa525be78d6e2795920786741f0bc';
const HARNESS_FILES = [
  'scripts/verify-production-dictionary.mjs',
  'test/browser/production-dictionary.ts',
  'test/browser/baseline-v3-indexeddb-jisyo-store.ts',
  'src/storage/jisyo/DictionaryLoader.ts',
  'src/storage/jisyo/IndexedDbJisyoStore.ts',
  'src/storage/indexedDbSchema.ts',
];
const FIXTURE_FILES = [
  'test/fixtures/dictionary-invalid.json',
  'test/fixtures/dictionary-primary-v1.json',
  'test/fixtures/dictionary-primary-v2.json',
  'test/fixtures/dictionary-primary-v3.json',
  'test/fixtures/dictionary-secondary.txt',
];

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function sha256File(filename) {
  return sha256(fs.readFileSync(path.join(ROOT, filename)));
}

function parseArguments(argv) {
  const options = {
    browser: 'both',
    exactQueries: 48,
    prefixQueries: 24,
    measuredRounds: 3,
    prefixLimit: 20,
    batchSize: 500,
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help') {
      process.stdout.write(`Usage: node scripts/verify-production-dictionary.mjs [options]\n\n` +
        `  --browser chrome|firefox|both  対象ブラウザー（既定: both）\n` +
        `  --exact-queries N             完全一致キー数（既定: 48）\n` +
        `  --prefix-queries N            前方一致キー数（既定: 24）\n` +
        `  --measured-rounds N           warm計測反復数（既定: 3）\n` +
        `  --prefix-limit N              前方一致上限（既定: 20）\n` +
        `  --batch-size N                IDB投入バッチ数（既定: 500）\n` +
        `  --output PATH                 JSON結果の保存先\n`);
      process.exit(0);
    }
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Unknown or incomplete argument: ${key}`);
    index += 1;
    if (key === '--browser') options.browser = value;
    else if (key === '--output') options.output = path.resolve(value);
    else if (['--exact-queries', '--prefix-queries', '--measured-rounds', '--prefix-limit', '--batch-size'].includes(key)) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
      const property = {
        '--exact-queries': 'exactQueries',
        '--prefix-queries': 'prefixQueries',
        '--measured-rounds': 'measuredRounds',
        '--prefix-limit': 'prefixLimit',
        '--batch-size': 'batchSize',
      }[key];
      options[property] = parsed;
    } else throw new Error(`Unknown argument: ${key}`);
  }
  if (!['chrome', 'firefox', 'both'].includes(options.browser)) {
    throw new Error('--browser must be chrome, firefox, or both');
  }
  return options;
}

function commandVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) return '取得できませんでした';
  return `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).find(Boolean) || '取得できませんでした';
}

function gitProvenance() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  if (head.status !== 0 || status.status !== 0) throw new Error('Git provenance could not be collected');
  return { head: head.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}

async function captureInputs() {
  const response = await fetch('https://skk-dict.github.io/jisyo/json/SKK-JISYO.S.json', { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`試験用公式辞書の取得に失敗しました: HTTP ${response.status}`);
  const official = Buffer.from(await response.arrayBuffer());
  if (sha256(official) !== OFFICIAL_SHA256) throw new Error('Downloaded official SKK-JISYO.S.json hash mismatch');
  const original = spawnSync('git', ['show', `${BASELINE_COMMIT}:src/storage/jisyo/IndexedDbJisyoStore.ts`], {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (original.status !== 0 || sha256(original.stdout) !== BASELINE_ORIGINAL_SHA256) {
    throw new Error('Baseline v3 source does not match the pinned commit/hash');
  }
  const adapted = fs.readFileSync(path.join(ROOT, 'test/browser/baseline-v3-indexeddb-jisyo-store.ts'), 'utf8');
  const restored = adapted.replaceAll('../../src/core/', '../../core/');
  if (sha256(restored) !== BASELINE_ORIGINAL_SHA256) {
    throw new Error('Adapted v3 fixture differs from the baseline beyond its four import paths');
  }
  const fixtures = Object.fromEntries(FIXTURE_FILES.map((filename) => {
    const bytes = fs.readFileSync(path.join(ROOT, filename));
    return [path.basename(filename), { filename, bytes, sha256: sha256(bytes) }];
  }));
  return { official, fixtures };
}

async function bundleHarness(temporaryRoot) {
  const outputDirectory = path.join(temporaryRoot, 'bundle');
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      target: ['chrome109', 'firefox109'],
      rollupOptions: {
        input: path.join(ROOT, 'test/browser/production-dictionary.ts'),
        output: { entryFileNames: 'production-dictionary.js' },
      },
    },
  });
  const filename = path.join(outputDirectory, 'production-dictionary.js');
  const bytes = fs.readFileSync(filename);
  return { filename, bytes, sha256: sha256(bytes) };
}

function serveBytes(response, bytes, contentType) {
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
  });
  response.end(bytes);
}

async function startServer(inputs, bundle) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><script type="module" src="/production-dictionary.js"></script>');
      return;
    }
    if (pathname === '/production-dictionary.js') {
      serveBytes(response, bundle.bytes, 'text/javascript; charset=utf-8');
      return;
    }
    if (pathname === '/dict/SKK-JISYO.S.json') {
      serveBytes(response, inputs.official, 'application/json; charset=utf-8');
      return;
    }
    const fixture = pathname.match(/^\/fixtures\/([a-z0-9.-]+)$/)?.[1];
    if (fixture && inputs.fixtures[fixture]) {
      serveBytes(
        response,
        inputs.fixtures[fixture].bytes,
        fixture.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      );
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function browserConfig(options) {
  return {
    fixtureBaseUrl: 'fixtures',
    officialDictionaryPath: 'dict/SKK-JISYO.S.json',
    exactQueries: options.exactQueries,
    prefixQueries: options.prefixQueries,
    measuredRounds: options.measuredRounds,
    prefixLimit: options.prefixLimit,
    batchSize: options.batchSize,
  };
}

async function runChrome(options, port, temporaryRoot) {
  if (!fs.existsSync(CHROME_PATH)) throw new Error(`Chrome executable not found: ${CHROME_PATH}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: fs.mkdtempSync(path.join(temporaryRoot, 'chrome-profile-')),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10 * 60 * 1000);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__productionDictionaryReady === true);
    return await page.evaluate((config) => window.runProductionDictionaryVerification(config), browserConfig(options));
  } finally {
    await browser.close();
  }
}

class WebDriverClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }
  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const body = await response.json();
    if (!response.ok || body.value?.error) throw new Error(body.value?.message || body.value?.error || `HTTP ${response.status}`);
    return body.value;
  }
  async start() {
    const value = await this.request('/session', {
      method: 'POST',
      body: JSON.stringify({ capabilities: { alwaysMatch: { 'moz:firefoxOptions': {
        ...(FIREFOX_PATH ? { binary: FIREFOX_PATH } : {}), args: ['-headless'],
      } } } }),
    });
    this.sessionId = value.sessionId;
    await this.request(`/session/${this.sessionId}/timeouts`, {
      method: 'POST', body: JSON.stringify({ script: 10 * 60 * 1000, pageLoad: 10 * 60 * 1000 }),
    });
  }
  async navigate(url) {
    await this.request(`/session/${this.sessionId}/url`, { method: 'POST', body: JSON.stringify({ url }) });
  }
  async executeAsync(script, args) {
    return this.request(`/session/${this.sessionId}/execute/async`, {
      method: 'POST', body: JSON.stringify({ script, args }),
    });
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

async function waitForWebDriver(url, processHandle) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`geckodriver exited with ${processHandle.exitCode}`);
    try { if ((await fetch(`${url}/status`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for geckodriver');
}

async function runFirefox(options, port) {
  const driverPort = await unusedPort();
  const driver = spawn(GECKODRIVER_PATH, ['--host', '127.0.0.1', '--port', String(driverPort)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  driver.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-4000); });
  const url = `http://127.0.0.1:${driverPort}`;
  const client = new WebDriverClient(url);
  try {
    await waitForWebDriver(url, driver);
    await client.start();
    await client.navigate(`http://127.0.0.1:${port}/`);
    const result = await client.executeAsync(`
      const config = arguments[0];
      const done = arguments[arguments.length - 1];
      const start = () => {
        if (!window.__productionDictionaryReady) return setTimeout(start, 25);
        window.runProductionDictionaryVerification(config).then(
          value => done({ ok: true, value }),
          error => done({ ok: false, error: error?.stack || String(error) }),
        );
      };
      start();
    `, [browserConfig(options)]);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  } catch (error) {
    if (errors) process.stderr.write(errors);
    throw error;
  } finally {
    await client.close().catch(() => {});
    if (driver.exitCode === null) driver.kill('SIGTERM');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArguments(args);
  const inputs = await captureInputs();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skk-production-dictionary-'));
  let server;
  try {
    const bundle = await bundleHarness(temporaryRoot);
    server = await startServer(inputs, bundle);
    const port = server.address().port;
    const results = {};
    if (options.browser === 'chrome' || options.browser === 'both') {
      process.stderr.write('[production dictionary] Chrome\n');
      results.chrome = await runChrome(options, port, temporaryRoot);
    }
    if (options.browser === 'firefox' || options.browser === 'both') {
      process.stderr.write('[production dictionary] Firefox\n');
      results.firefox = await runFirefox(options, port);
    }
    const report = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      provenance: {
        git: gitProvenance(),
        harness: Object.fromEntries(HARNESS_FILES.map((filename) => [filename, { sha256: sha256File(filename) }])),
        executedArtifacts: {
          generatedBundle: {
            path: 'production-dictionary.js',
            byteLength: bundle.bytes.length,
            sha256: bundle.sha256,
            provenance: 'この実行でViteが生成し、ブラウザーへ配信したスナップショットです。依存するproductionコードを含みます。',
          },
          fixtures: Object.fromEntries(Object.values(inputs.fixtures).map(({ filename, bytes, sha256: digest }) => [
            filename,
            { byteLength: bytes.length, sha256: digest },
          ])),
        },
        officialDictionary: { source: 'https://skk-dict.github.io/jisyo/json/SKK-JISYO.S.json', storage: '検証プロセスのメモリーのみ', sha256: OFFICIAL_SHA256 },
        baseline: {
          commit: BASELINE_COMMIT,
          originalPath: 'src/storage/jisyo/IndexedDbJisyoStore.ts',
          originalSha256: BASELINE_ORIGINAL_SHA256,
          adaptedFixtureSha256: sha256File('test/browser/baseline-v3-indexeddb-jisyo-store.ts'),
          adaptation: 'importパス4件のみをテスト配置に合わせて変更しています。',
        },
        runtime: {
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
          osRelease: os.release(),
          cpuModel: os.cpus()[0]?.model,
          cpuCount: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
          chrome: commandVersion(CHROME_PATH),
          firefox: commandVersion(FIREFOX_PATH),
          geckodriver: commandVersion(GECKODRIVER_PATH),
        },
      },
      invocation: { ...options, output: options.output, commandArguments: args },
      measurementBoundaries: {
        storage: 'ブラウザー内のperformance.nowでproduction store呼び出しを測定します。warmは接続済み、coldはクエリごとの新規store接続を含みます。',
        baseline: 'e590f07のv3 production storeを使用し、currentと同じ解析済み公式Sレコード、クエリ、ブラウザープロセスで比較します。',
      },
      results,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized);
      process.stderr.write(`[production dictionary] result: ${options.output}\n`);
    }
    process.stdout.write(serialized);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
