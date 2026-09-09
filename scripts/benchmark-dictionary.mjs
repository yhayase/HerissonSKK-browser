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
const CHROME_PATH = process.env.CHROME_BIN ||
  path.resolve(ROOT, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome');
const GECKODRIVER_PATH = process.env.GECKODRIVER_PATH ||
  (fs.existsSync('/snap/bin/geckodriver') ? '/snap/bin/geckodriver' : 'geckodriver');
const FIREFOX_PATH = process.env.FIREFOX_PATH ||
  (fs.existsSync('/snap/firefox/current/usr/lib/firefox/firefox')
    ? '/snap/firefox/current/usr/lib/firefox/firefox'
    : undefined);

const HARNESS_FILES = [
  'scripts/benchmark-dictionary.mjs',
  'scripts/dictionary-benchmark/browser.ts',
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000 });
  if (result.error || result.status !== 0) return undefined;
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /Chrome|Firefox|geckodriver/i.test(line)) || lines[0];
}
function resolveExecutable(configuredPath) {
  const candidate = configuredPath || 'firefox';
  let invocationPath = candidate;
  if (!path.isAbsolute(candidate) && !candidate.includes(path.sep)) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) invocationPath = found.stdout.trim();
  } else {
    invocationPath = path.resolve(candidate);
  }
  let realPath = invocationPath;
  try {
    realPath = fs.realpathSync(invocationPath);
  } catch {}
  return {
    invocationPath,
    realPath,
    version: commandOutput(invocationPath, ['--version']) || '取得できませんでした',
  };
}
function gitProvenance() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (head.status !== 0 || status.status !== 0) {
    throw new Error('Git provenance could not be collected');
  }
  return {
    head: head.stdout.trim(),
    dirty: status.stdout.trim().length > 0,
  };
}

function executionProvenance(argv) {
  const cpus = os.cpus();
  return {
    harness: Object.fromEntries(HARNESS_FILES.map((filename) => [
      filename,
      { sha256: sha256File(path.join(ROOT, filename)) },
    ])),
    git: gitProvenance(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      cpuModel: cpus[0]?.model || '取得できませんでした',
      cpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
    },
    executables: {
      chrome: resolveExecutable(CHROME_PATH),
      firefox: resolveExecutable(FIREFOX_PATH),
      geckodriver: resolveExecutable(GECKODRIVER_PATH),
    },
    commandArguments: [...argv],
    repetitionIsolation: {
      database: '反復ごとに新規データベースを作成して削除します。',
      browser: 'ブラウザーごとに同じプロセスと一時プロファイルでS/Lと全反復を実行します。',
    },
  };
}

const DATASETS = {
  S: {
    filename: 'SKK-JISYO.S.json',
    bytes: 93963,
    sha256: '729e562f963ec06186c251c116510d6ed89aa525be78d6e2795920786741f0bc',
    source: 'https://skk-dict.github.io/jisyo/json/SKK-JISYO.S.json',
  },
  L: {
    filename: 'SKK-JISYO.L.json',
    bytes: 6450342,
    sha256: '6ae463c99442ba5d09a58a3b5fd68f1e179e25c117d9696de930e881039d2f41',
    source: 'https://skk-dict.github.io/jisyo/json/SKK-JISYO.L.json',
  },
};

function positiveInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseArguments(argv) {
  const options = {
    browser: 'both',
    dataset: 'all',
    dataDir: process.env.DICTIONARY_BENCH_DATA_DIR || '/tmp/skk-phase31',
    runs: 3,
    exactQueries: 96,
    prefixQueries: 48,
    warmupRounds: 1,
    measuredRounds: 3,
    prefixLimit: 20,
    batchSize: 2000,
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--help') {
      console.log(`Usage: npm run bench:dictionary -- [options]

  --browser chrome|firefox|both  対象ブラウザー（既定: both）
  --dataset S|L|all             対象辞書（既定: all）
  --data-dir PATH               公式JSONのディレクトリ
  --runs N                      fresh DB反復数（既定: 3）
  --exact-queries N             反復ごとの完全一致クエリ数（既定: 96）
  --prefix-queries N            反復ごとの前方一致クエリ数（既定: 48）
  --warmup-rounds N             ウォームアップ回数（既定: 1）
  --measured-rounds N           ウォーム計測回数（既定: 3）
  --prefix-limit N              前方一致の上限（既定: 20）
  --batch-size N                IndexedDB投入バッチ数（既定: 2000）
  --output PATH                 JSON結果の保存先（省略時は標準出力のみ）`);
      process.exit(0);
    }
    if (!argument.startsWith('--') || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    index += 1;
    if (argument === '--browser') options.browser = value;
    else if (argument === '--dataset') options.dataset = value;
    else if (argument === '--data-dir') options.dataDir = path.resolve(value);
    else if (argument === '--runs') options.runs = positiveInteger(argument, value);
    else if (argument === '--exact-queries') options.exactQueries = positiveInteger(argument, value);
    else if (argument === '--prefix-queries') options.prefixQueries = positiveInteger(argument, value);
    else if (argument === '--warmup-rounds') options.warmupRounds = nonNegativeInteger(argument, value);
    else if (argument === '--measured-rounds') options.measuredRounds = positiveInteger(argument, value);
    else if (argument === '--prefix-limit') options.prefixLimit = positiveInteger(argument, value);
    else if (argument === '--batch-size') options.batchSize = positiveInteger(argument, value);
    else if (argument === '--output') options.output = path.resolve(value);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!['chrome', 'firefox', 'both'].includes(options.browser)) {
    throw new Error('--browser must be chrome, firefox, or both');
  }
  if (!['S', 'L', 'all'].includes(options.dataset)) {
    throw new Error('--dataset must be S, L, or all');
  }
  return options;
}

function verifyDataset(dataDir, datasetId) {
  const metadata = DATASETS[datasetId];
  const filePath = path.join(dataDir, metadata.filename);
  const contents = fs.readFileSync(filePath);
  const digest = crypto.createHash('sha256').update(contents).digest('hex');
  if (contents.byteLength !== metadata.bytes || digest !== metadata.sha256) {
    throw new Error(
      `${metadata.filename} does not match the pinned artifact: bytes=${contents.byteLength} sha256=${digest}`,
    );
  }
  return { ...metadata, filePath };
}

async function bundleBrowserHarness(temporaryRoot) {
  const outputDirectory = path.join(temporaryRoot, 'bundle');
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      target: ['chrome109', 'firefox109'],
      rollupOptions: {
        input: path.join(ROOT, 'scripts/dictionary-benchmark/browser.ts'),
        output: { entryFileNames: 'benchmark.js' },
      },
    },
  });
  return path.join(outputDirectory, 'benchmark.js');
}

function startServer(bundlePath, datasets) {
  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>SKK dictionary benchmark</title></head>' +
    '<body><script type="module" src="/benchmark.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (request.url === '/benchmark.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      fs.createReadStream(bundlePath).pipe(response);
      return;
    }
    const match = request.url?.match(/^\/data\/(S|L)$/);
    if (match && datasets[match[1]]) {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      fs.createReadStream(datasets[match[1]].filePath).pipe(response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function benchmarkConfig(options, datasetId, port) {
  return {
    datasetId,
    datasetUrl: `http://127.0.0.1:${port}/data/${datasetId}`,
    runs: options.runs,
    exactQueries: options.exactQueries,
    prefixQueries: options.prefixQueries,
    warmupRounds: options.warmupRounds,
    measuredRounds: options.measuredRounds,
    prefixLimit: options.prefixLimit,
    batchSize: options.batchSize,
  };
}

async function runChrome(options, datasetIds, port, temporaryRoot) {
  if (!fs.existsSync(CHROME_PATH)) throw new Error(`Chrome executable not found: ${CHROME_PATH}`);
  const profilePath = fs.mkdtempSync(path.join(temporaryRoot, 'chrome-profile-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: profilePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const results = [];
    for (const datasetId of datasetIds) {
      console.error(`[dictionary benchmark] Chrome / SKK-JISYO.${datasetId}`);
      const page = await browser.newPage();
      page.setDefaultTimeout(30 * 60 * 1000);
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.__dictionaryBenchmarkReady === true);
      const result = await page.evaluate(
        (config) => window.runDictionaryBenchmark(config),
        benchmarkConfig(options, datasetId, port),
      );
      results.push(result);
      await page.close();
    }
    return results;
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
    const data = await response.json();
    if (!response.ok || data.value?.error) {
      throw new Error(data.value?.message || data.value?.error || `WebDriver HTTP ${response.status}`);
    }
    return data.value;
  }

  async start() {
    const value = await this.request('/session', {
      method: 'POST',
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            'moz:firefoxOptions': {
              ...(FIREFOX_PATH ? { binary: FIREFOX_PATH } : {}),
              args: ['-headless'],
            },
          },
        },
      }),
    });
    this.sessionId = value.sessionId;
    await this.request(`/session/${this.sessionId}/timeouts`, {
      method: 'POST',
      body: JSON.stringify({ script: 30 * 60 * 1000, pageLoad: 30 * 60 * 1000 }),
    });
  }

  async navigate(url) {
    await this.request(`/session/${this.sessionId}/url`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async executeAsync(script, args = []) {
    return this.request(`/session/${this.sessionId}/execute/async`, {
      method: 'POST',
      body: JSON.stringify({ script, args }),
    });
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await this.request(`/session/${this.sessionId}`, { method: 'DELETE' });
    } finally {
      this.sessionId = null;
    }
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

async function waitForWebDriver(baseUrl, processHandle) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`geckodriver exited with code ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for geckodriver');
}

async function runFirefox(options, datasetIds, port) {
  const driverPort = await unusedPort();
  const driver = spawn(
    GECKODRIVER_PATH,
    ['--host', '127.0.0.1', '--port', String(driverPort)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let driverErrors = '';
  driver.stderr.on('data', (chunk) => { driverErrors = (driverErrors + chunk).slice(-4000); });
  const baseUrl = `http://127.0.0.1:${driverPort}`;
  const client = new WebDriverClient(baseUrl);
  try {
    await waitForWebDriver(baseUrl, driver);
    await client.start();
    const results = [];
    for (const datasetId of datasetIds) {
      console.error(`[dictionary benchmark] Firefox / SKK-JISYO.${datasetId}`);
      await client.navigate(`http://127.0.0.1:${port}/`);
      const result = await client.executeAsync(`
        const config = arguments[0];
        const done = arguments[arguments.length - 1];
        const waitUntilReady = () => {
          if (window.__dictionaryBenchmarkReady) {
            window.runDictionaryBenchmark(config).then(
              (value) => done({ ok: true, value }),
              (error) => done({ ok: false, error: error?.stack || String(error) }),
            );
          } else {
            setTimeout(waitUntilReady, 25);
          }
        };
        waitUntilReady();
      `, [benchmarkConfig(options, datasetId, port)]);
      if (!result.ok) throw new Error(result.error);
      results.push(result.value);
    }
    return results;
  } catch (error) {
    if (driverErrors) console.error(driverErrors);
    throw error;
  } finally {
    await client.close().catch(() => {});
    if (driver.exitCode === null) driver.kill('SIGTERM');
  }
}

async function main() {
  const commandArguments = process.argv.slice(2);
  const options = parseArguments(commandArguments);
  const execution = executionProvenance(commandArguments);
  const datasetIds = options.dataset === 'all' ? ['S', 'L'] : [options.dataset];
  const datasets = Object.fromEntries(datasetIds.map((id) => [id, verifyDataset(options.dataDir, id)]));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skk-dictionary-benchmark-'));
  let server;
  try {
    const bundlePath = await bundleBrowserHarness(temporaryRoot);
    server = await startServer(bundlePath, datasets);
    const port = server.address().port;
    const results = {};
    if (options.browser === 'chrome' || options.browser === 'both') {
      results.chrome = await runChrome(options, datasetIds, port, temporaryRoot);
    }
    if (options.browser === 'firefox' || options.browser === 'both') {
      results.firefox = await runFirefox(options, datasetIds, port);
    }
    const report = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      provenance: {
        datasets: Object.fromEntries(datasetIds.map((id) => {
          const { filename, bytes, sha256, source } = datasets[id];
          return [id, { filename, bytes, sha256, source }];
        })),
        execution,
      },
      invocation: {
        browser: options.browser,
        dataset: options.dataset,
        runs: options.runs,
        exactQueries: options.exactQueries,
        prefixQueries: options.prefixQueries,
        warmupRounds: options.warmupRounds,
        measuredRounds: options.measuredRounds,
        prefixLimit: options.prefixLimit,
        batchSize: options.batchSize,
      },
      results,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized);
      console.error(`[dictionary benchmark] result: ${options.output}`);
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
