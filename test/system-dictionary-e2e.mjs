import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const flavor = process.argv[2] ?? 'chrome';
const output = path.join(root, '.output', `system-e2e-${flavor}`);
const builtManifestPath = path.join(root, '.output', flavor === 'chrome' ? 'chrome-mv3' : 'firefox-mv2', 'manifest.json');
const originalBuiltManifest = fs.readFileSync(builtManifestPath, 'utf8');
const e2eManifest = JSON.parse(originalBuiltManifest);
// ネイティブ権限 UI を操作できないヘッドレス実行でも、取得自体は実際のホスト権限下で検証します。
const fixturePermission = 'http://127.0.0.1/*';
const requiredHosts = flavor === 'chrome' ? (e2eManifest.host_permissions ??= []) : (e2eManifest.permissions ??= []);
if (!requiredHosts.includes(fixturePermission)) requiredHosts.push(fixturePermission);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'run.log'), '');
const log = (...values) => { console.log(...values); fs.appendFileSync(path.join(output, 'run.log'), values.join(' ') + '\n'); };
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const uuid = '6d19df0d-d322-4940-98aa-246c019bfa00';
const json = (words) => JSON.stringify({ copyright: 'E2E', license: 'CC0', okuri_ari: {}, okuri_nasi: words });
const fixture = (name, body) => { const file = path.join(output, name); fs.writeFileSync(file, body); return file; };
const textFile = fixture('first.skk', ';; coding: utf-8\n;; okuri-ari entries.\nかk /書;上位/[く/描;限定/]/\n;; okuri-nasi entries.\nてすと /共通;上位/第一/第三/第四/第五/第六/第七/第八/\nにほん /独自日本/\nちゅうしゃくけんしょう /重複;優先注釈/\n');
const jsonFile = fixture('second.json', json({ 'てすと': ['共通', '第二'], 'にほん': ['追加日本'], 'あくい': ['<img src=x onerror=alert(1)>'] }));
const badFile = fixture('invalid.json', '{broken');
const replacement = fixture('replacement.json', json({ 'てすと': ['更新候補', '共通'], 'にほん': ['再取込日本'] }));
const customRequests = [];
const server = http.createServer((req, res) => {
  if (req.url === '/custom-v1.txt') {
    customRequests.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(';; coding: utf-8\n;; okuri-nasi entries.\nかすたむ /URL候補/\n');
    return;
  }
  if (req.url === '/custom-v2.json') {
    customRequests.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(json({ 'かすたむ': ['URL更新候補'], 'かすたむついか': ['URL追加候補'] }));
    return;
  }
  if (req.url === '/custom-invalid.json') {
    customRequests.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end('{broken');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Set-Cookie', 'skk-e2e=private; SameSite=Lax');
  res.end('<!doctype html><meta charset="utf-8"><input id="input-test"><textarea></textarea>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
let options;
let extensionRoot;
const navigate = async (page, url) => {
  if (flavor === 'firefox' && url.startsWith('moz-extension:')) {
    await browser.connection.send('browsingContext.navigate', { context: page.mainFrame()._id, url, wait: 'none' });
    await page.waitForSelector('main');
  } else await page.goto(url);
};
const launch = async (offline = false) => {
  browser = await puppeteer.launch(flavor === 'chrome' ? {
    executablePath: process.env.CHROME_PATH ?? path.join(root, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome'),
    headless: true, enableExtensions: true, userDataDir: profile,
    args: [`--disable-extensions-except=${root}/.output/chrome-mv3`, `--load-extension=${root}/.output/chrome-mv3`, '--no-sandbox', ...(offline ? ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'] : [])],
  } : {
    browser: 'firefox', executablePath: process.env.FIREFOX_PATH ?? '/snap/firefox/current/usr/lib/firefox/firefox',
    headless: true, userDataDir: profile, args: ['--remote-allow-system-access'],
    extraPrefsFirefox: { ...(offline ? { 'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9, 'network.proxy.no_proxies_on': 'localhost,127.0.0.1' } : {}), 'extensions.webextensions.uuids': JSON.stringify({ 'skk-browser-extension@yhayase': uuid }) },
  });
  log(`[${flavor}] browser ${await browser.version()} profile ${profile}`);
  if (flavor === 'firefox') {
    await browser.installExtension(path.join(root, '.output/firefox-mv2'));
    extensionRoot = `moz-extension://${uuid}/`;
  } else {
    const worker = await browser.waitForTarget((t) => t.type() === 'service_worker');
    extensionRoot = worker.url().replace(/[^/]+$/, '');
  }
  options = await browser.newPage();
  await navigate(options, extensionRoot + 'options.html');
  assert.equal(await options.evaluate(() => { const notice = document.querySelector('#notice').textContent; return !notice.includes('リビジョン 0') || (document.querySelector('#draft-controls').disabled && document.querySelector('#import-controls').disabled && document.querySelector('#preview').disabled); }), true);
  await options.evaluate(() => (globalThis.browser ?? chrome).runtime.sendMessage({ type: 'SKK_WAIT_READY' }));
  await click(options, '#refresh');
  await options.waitForFunction(() => /リビジョン [1-9]/.test(document.querySelector('#notice').textContent));
};
const rpc = (request) => options.evaluate(async (request) => {
  const response = await (globalThis.browser ?? chrome).runtime.sendMessage(request);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}, request);
const status = () => rpc({ type: 'SKK_SYSTEM_STATUS' });
const assertConfigurationList = async (page = options) => {
  const configured = (await status()).dictionaries.map((d) => d.dictId);
  const editable = await page.$$eval('#draft-list > [data-dict-id]', (items) => items.map((item) => item.dataset.dictId));
  assert.deepEqual(editable, configured);
  assert.equal(await page.$$eval('#draft-list > [data-dict-id] .metadata', (items) => items.length), configured.length);
};
const front = async (page) => flavor === 'firefox' ? page.evaluate(async () => browser.tabs.update((await browser.tabs.getCurrent()).id, { active: true })) : page.bringToFront();
const click = async (page, selector) => flavor === 'firefox' ? page.$eval(selector, (el) => el.click()) : page.click(selector);
const fill = async (page, selector, value) => {
  await page.$eval(selector, (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
};
const upload = async (page, file) => {
  if (flavor === 'chrome') return (await page.$('#import-file')).uploadFile(file);
  await page.$eval('#import-file', (el, { bytes, name }) => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], name)); el.files = transfer.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, { bytes: [...fs.readFileSync(file)], name: path.basename(file) });
};
const saved = async (revision) => {
  await options.waitForFunction((revision) => !document.querySelector('#draft-controls').disabled && document.querySelector('#notice').textContent.includes('保存完了') && Number(document.querySelector('#notice').textContent.match(/\d+/)?.[0]) > revision, { timeout: 30000 }, revision);
  assert.equal(await options.$eval('#error', (el) => el.textContent), '');
};
const save = async () => { const before = await status(); await click(options, '#save'); await saved(before.revision); };
const preview = async (key, okuri = '', all = false) => {
  await fill(options, '#preview-key', key); await fill(options, '#preview-okuri', okuri);
  if (await options.$eval('#preview-all', (el) => el.checked) !== all) await click(options, '#preview-all');
  await click(options, '#preview');
  await options.waitForFunction(() => !document.querySelector('#preview').disabled && document.querySelector('#preview-status').textContent.startsWith('取得時点'));
  return options.$$eval('#system-candidates > li', (items) => items.map((el) => ({
    word: el.firstChild.textContent,
    annotation: el.querySelector(':scope > p')?.textContent,
    sources: [...el.querySelectorAll(':scope > ul > li')].map((source) => source.textContent),
  })));
};
const importFile = async (name, file, format, target = '') => {
  await options.select('#import-target', target); await fill(options, '#import-name', name); await options.select('#import-format', format);
  await upload(options, file);
  const before = await status(); await click(options, '#import'); await saved(before.revision);
  return (await status()).dictionaries.find((d) => d.name === name).dictId;
};
const words = (items) => items.map((item) => item.word);
const combo = async (page, modifier, key) => { await page.keyboard.down(modifier); await page.keyboard.press(key); await page.keyboard.up(modifier); };
const inputPage = async () => { const page = await browser.newPage(); await page.goto(url); await page.waitForSelector('html[data-skk-initialized="true"]'); await page.focus('#input-test'); await combo(page, 'Control', 'j'); return page; };
const convert = async (page, roman = 'tesuto') => { await page.bringToFront(); await page.focus('#input-test'); await combo(page, 'Shift', `Key${roman[0].toUpperCase()}`); await page.keyboard.type(roman.slice(1)); await page.keyboard.press(' '); await page.waitForFunction(() => !!document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-candidate')?.textContent); };
const hud = (page) => page.evaluate(() => document.querySelector('#skk-browser-ext-hud-root').shadowRoot.textContent);
const cancel = async (page) => { await combo(page, 'Control', 'g'); await combo(page, 'Control', 'g'); };
// 取得境界だけを制御し、設定操作・解析・保存は実際の拡張機能に任せます。
const transport = async (mode, body = '') => {
  const target = flavor === 'chrome' ? await (await browser.waitForTarget((t) => t.type() === 'service_worker')).worker() : options;
  await target.evaluate(async ({ mode, body }) => {
    const bg = typeof browser !== 'undefined' && browser.runtime.getBackgroundPage ? await browser.runtime.getBackgroundPage() : globalThis;
    if (mode === 'release') { bg.__e2eRelease(); return; }
    if (!bg.__e2eOriginalFetch) bg.__e2eOriginalFetch = bg.fetch.bind(bg);
    if (mode === 'restore') { bg.fetch = bg.__e2eOriginalFetch; return; }
    bg.fetch = async (input, init) => {
      if (!String(input).startsWith('https://raw.githubusercontent.com/')) return bg.__e2eOriginalFetch(input, init);
      if (mode === 'pending') await new Promise((resolve) => { bg.__e2eRelease = resolve; });
      if (mode === 'error') throw new TypeError('E2E network unavailable');
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { mode, body });
};
// ヘッドレス Chrome/Firefox では任意権限のネイティブ確認 UI を操作できないため、許可 API の応答だけを制御します。
// URL 取得、解析、IndexedDB への公開とロールバックは実際の拡張機能処理を通します。
const permission = async (mode) => options.evaluate((mode) => {
  const api = (globalThis.browser ?? chrome).permissions;
  globalThis.__e2ePermissionMode = mode;
  if (!globalThis.__e2ePermissionRequests) globalThis.__e2ePermissionRequests = [];
  if (!globalThis.__e2eOriginalPermissionRequest) {
    globalThis.__e2eOriginalPermissionRequest = api.request.bind(api);
    api.request = async (request) => {
      globalThis.__e2ePermissionRequests.push(structuredClone(request));
      return globalThis.__e2ePermissionMode === 'allow';
    };
  }
}, mode);
// Firefox の拡張機能タブは BiDi の作成イベントが欠けるため、実タブと生のコンテキストで確認します。
const verifyFirefoxPopup = async (popup) => {
  const inventory = () => popup.evaluate(async () => ({ url: browser.runtime.getURL('options.html'), tabs: await browser.tabs.query({}) }));
  const before = await inventory();
  assert.equal(before.tabs.filter((tab) => tab.url === before.url).length, 0, 'options tab exists before popup click');
  const previousIds = new Set(before.tabs.map((tab) => tab.id));
  await click(popup, '#open-options');
  const deadline = Date.now() + 30000;
  let diagnostic;
  while (Date.now() < deadline) {
    const current = await inventory();
    const matching = current.tabs.filter((tab) => tab.url === before.url && !previousIds.has(tab.id));
    const tree = await browser.connection.send('browsingContext.getTree', {});
    const contexts = tree.result.contexts.filter((context) => context.url === before.url);
    diagnostic = { tabs: matching, contexts };
    if (matching.length === 1 && matching[0].status === 'complete' && contexts.length === 1) {
      const response = await browser.connection.send('script.evaluate', {
        target: { context: contexts[0].context }, awaitPromise: true,
        expression: `JSON.stringify({ url: location.href, title: document.title, readyState: document.readyState, notice: document.querySelector('#notice')?.textContent, disabled: document.querySelector('#draft-controls')?.disabled, rows: [...document.querySelectorAll('#draft-list > [data-dict-id]')].map(el => el.dataset.dictId) })`,
      });
      diagnostic.response = response;
      if (response.result.type === 'success' && response.result.result.type === 'string') {
        const dom = JSON.parse(response.result.result.value);
        if (dom.readyState === 'complete' && dom.disabled === false && dom.rows.includes('skk-jisyo-s')) {
          assert.equal(dom.url, before.url); assert.equal(dom.title, 'SKK 辞書設定');
          assert.match(dom.notice, /リビジョン [1-9]/);
          const proof = { tabId: matching[0].id, context: contexts[0].context, dom };
          fs.writeFileSync(path.join(output, 'popup-proof.json'), JSON.stringify(proof, null, 2));
          return proof;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`popup did not create a ready options document: ${JSON.stringify(diagnostic)}`);
};
try {
  fs.writeFileSync(builtManifestPath, JSON.stringify(e2eManifest));
  await launch();
  log(`[${flavor}] revision-zero startup DOM gate`);
  const startup = await browser.newPage();
  const initializeStartup = () => {
    const install = () => {
    const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
    if (!runtime) return false;
    const original = runtime.sendMessage.bind(runtime);
    globalThis.__startupReleased = false; globalThis.__startupMutations = 0;
    runtime.sendMessage = (request, callback) => {
      if (['SKK_SYSTEM_CONFIGURE', 'SKK_SYSTEM_IMPORT', 'SKK_SYSTEM_UPDATE'].includes(request.type)) globalThis.__startupMutations++;
      const result = Promise.resolve(original(request)).then((response) => request.type === 'SKK_SYSTEM_STATUS' && !globalThis.__startupReleased
        ? { ...response, data: { ...response.data, revision: 0, dictionaries: [], operation: { state: 'updating' } } } : response);
      if (typeof callback === 'function') { result.then(callback); return; }
      return result;
    };
    return true;
    };
    if (!install()) { const observer = new MutationObserver(() => { if (install()) observer.disconnect(); }); observer.observe(document, { childList: true, subtree: true }); }
  };
  if (flavor === 'chrome') await startup.evaluateOnNewDocument(initializeStartup);
  await navigate(startup, extensionRoot + 'options.html');
  if (flavor === 'firefox') {
    await startup.waitForFunction(() => !document.querySelector('#draft-controls').disabled);
    await startup.evaluate(initializeStartup);
    await startup.evaluate(async () => { window.dispatchEvent(new Event('pagehide')); await import(document.querySelector('script[type=module]').src + '?e2e-startup'); });
  }
  await startup.waitForFunction(() => document.querySelector('#notice').textContent.includes('初期'));
  assert.equal(await startup.evaluate(() => ['draft-controls', 'import-controls', 'save', 'preview'].every((id) => document.getElementById(id).disabled)), true);
  await click(startup, '#save'); assert.equal(await startup.evaluate(() => globalThis.__startupMutations), 0);
  await startup.evaluate(() => { globalThis.__startupReleased = true; }); await click(startup, '#refresh');
  await startup.waitForFunction(() => !document.querySelector('#draft-controls').disabled && document.querySelector('#draft-list [data-dict-id="skk-jisyo-s"]'));
  await startup.close();
  log(`[${flavor}] catalog selectors and bundled format switch`);
  for (const kind of ['s', 'm', 'l', 'person', 'place', 'postal']) for (const format of ['text', 'json']) {
    await options.select('#kind', kind); await options.select('#format', format);
    assert.equal(await options.$eval('#add', (el) => el.disabled), kind === 'postal' && format === 'json');
  }
  for (const source of ['dict/SKK-JISYO.S', 'dict/SKK-JISYO.S.json']) {
    await options.select('#draft-list [data-dict-id="skk-jisyo-s"] select', source); await save();
    assert.equal((await status()).dictionaries[0].source, source);
  }
  log(`[${flavor}] custom URL permission, validation, import rollback and source edit`);
  const beforeInvalidCustom = await status();
  await fill(options, '#custom-name', '危険な URL'); await fill(options, '#custom-source', 'https://user:secret@example.test/dictionary');
  await click(options, '#add-custom');
  await options.waitForFunction(() => document.querySelector('#error').textContent.includes('認証情報'));
  assert.equal((await status()).revision, beforeInvalidCustom.revision);
  assert.equal(await options.$$eval('#draft-list [data-dict-id^="custom-"]', (items) => items.length), 0);

  await fill(options, '#custom-name', 'URL 辞書'); await fill(options, '#custom-source', url + 'custom-v1.txt');
  await permission('deny'); await options.select('#custom-format', 'text'); await click(options, '#add-custom');
  await options.waitForFunction(() => document.querySelector('#error').textContent.includes('許可されませんでした'));
  assert.equal(await options.$$eval('#draft-list [data-dict-id^="custom-"]', (items) => items.length), 0);
  await permission('allow'); await click(options, '#add-custom');
  await options.waitForSelector('#draft-list [data-dict-id^="custom-"]');
  const customId = await options.$eval('#draft-list [data-dict-id^="custom-"]', (item) => item.dataset.dictId);
  assert.deepEqual(await options.evaluate(() => globalThis.__e2ePermissionRequests.slice(-2)), [
    { origins: ['http://127.0.0.1/*'] }, { origins: ['http://127.0.0.1/*'] },
  ]);
  await save();
  assert.ok(words(await preview('かすたむ')).includes('URL候補'));
  assert.deepEqual(customRequests.at(-1), { url: '/custom-v1.txt', cookie: undefined, authorization: undefined });

  const beforeDeniedUpdate = await status(); const requestCountBeforeDeniedUpdate = customRequests.length;
  await permission('deny'); await click(options, `[data-update="${customId}"]`);
  await options.waitForFunction(() => document.querySelector('#error').textContent.includes('許可されませんでした'));
  assert.equal((await status()).revision, beforeDeniedUpdate.revision);
  assert.equal(customRequests.length, requestCountBeforeDeniedUpdate);
  await permission('allow'); await click(options, `[data-update="${customId}"]`); await saved(beforeDeniedUpdate.revision);
  assert.equal(customRequests.length, requestCountBeforeDeniedUpdate + 1);

  const beforeInvalidImport = await status();
  await fill(options, `#draft-list [data-dict-id="${customId}"] .custom-source input`, url + 'custom-invalid.json');
  await options.select(`#draft-list [data-dict-id="${customId}"] .row select`, 'json');
  await click(options, `#draft-list [data-dict-id="${customId}"] [data-apply-custom]`);
  await options.waitForFunction((id) => document.querySelector(`[data-apply-custom="${id}"]`) && !document.querySelector('#draft-controls').disabled, {}, customId);
  await click(options, '#save');
  await options.waitForFunction(() => document.querySelector('#error').textContent.length > 0 && !document.querySelector('#draft-controls').disabled);
  assert.equal((await status()).revision, beforeInvalidImport.revision);
  assert.ok(words(await preview('かすたむ')).includes('URL候補'));

  await fill(options, `#draft-list [data-dict-id="${customId}"] .custom-source input`, url + 'custom-v2.json');
  await click(options, `#draft-list [data-dict-id="${customId}"] [data-apply-custom]`);
  await options.waitForFunction((id, source) => document.querySelector(`[data-dict-id="${id}"] .metadata`).textContent.includes(source), {}, customId, url + 'custom-v2.json');
  await save();
  assert.ok(words(await preview('かすたむ')).includes('URL更新候補'));
  assert.deepEqual(customRequests.at(-1), { url: '/custom-v2.json', cookie: undefined, authorization: undefined });
  const first = await importFile('上位辞書', textFile, 'text');
  await importFile('上位辞書', fixture('first-reimport.skk', fs.readFileSync(textFile, 'utf8') + 'さいと /再取込テキスト/\n'), 'text', first);
  assert.ok(words(await preview('さいと')).includes('再取込テキスト'));
  const second = await importFile('<img src=x onerror=alert(1)>', jsonFile, 'json');
  await importFile('注釈辞書', fixture('annotations.skk', ';; coding: utf-8\n;; okuri-nasi entries.\nちゅうしゃくけんしょう /重複;別の注釈/\n'), 'text');
  await assertConfigurationList();
  assert.equal((await status()).dictionaries.length, 5);
  await click(options, '#refresh');
  await options.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await assertConfigurationList();
  if (flavor === 'firefox') {
    await options.goto('about:blank');
    await navigate(options, extensionRoot + 'options.html');
  } else await options.reload();
  await options.waitForFunction(() => !document.querySelector('#draft-controls').disabled);
  await assertConfigurationList();
  const result = await preview('てすと');
  assert.deepEqual(words(result), ['共通', '第一', '第三', '第四', '第五', '第六', '第七', '第八', '第二']);
  assert.deepEqual(result[0], {
    word: '共通',
    annotation: '表示注釈：上位 / 送り条件：指定なし',
    sources: ['システム：上位辞書 / 注釈：上位', 'システム：<img src=x onerror=alert(1)> / 注釈：なし'],
  });
  assert.deepEqual(await preview('ちゅうしゃくけんしょう'), [{
    word: '重複',
    annotation: '表示注釈：優先注釈 / 送り条件：指定なし',
    sources: ['システム：上位辞書 / 注釈：優先注釈', 'システム：注釈辞書 / 注釈：別の注釈'],
  }]);
  assert.ok((await preview('にほん')).some((c) => c.word === '日本'));
  assert.ok((await preview('にほん')).some((c) => c.word === '追加日本'));
  assert.ok((await preview('かk', 'く')).some((c) => c.word === '描'));
  assert.ok(!(await preview('かk', 'け')).some((c) => c.word === '描'));
  assert.ok((await preview('かk', '', true)).some((c) => c.word === '描'));
  await click(options, '#preview-all');
  await click(options, '#draft-list [data-dict-id="skk-jisyo-s"] [aria-label$="を下へ"]');
  await click(options, '#draft-list [data-dict-id="skk-jisyo-s"] [aria-label$="を下へ"]'); await save();
  assert.equal(words(await preview('にほん'))[0], '独自日本');
  await click(options, '#draft-list [data-dict-id="skk-jisyo-s"] [aria-label$="を上へ"]');
  await click(options, '#draft-list [data-dict-id="skk-jisyo-s"] [aria-label$="を上へ"]'); await save();
  await preview('あくい'); assert.equal(await options.$$eval('#draft-list img, #system-candidates img', (els) => els.length), 0);
  if (flavor === 'firefox') await options.goto('about:blank');
  await options.setViewport({ width: 360, height: 800 });
  if (flavor === 'firefox') { await navigate(options, extensionRoot + 'options.html'); await options.waitForFunction(() => !document.querySelector('#draft-controls').disabled); await preview('あくい'); }
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (flavor === 'chrome') await options.screenshot({ path: path.join(output, 'narrow-options.png'), fullPage: true });
  else fs.writeFileSync(path.join(output, 'narrow-options.json'), JSON.stringify(await options.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, text: document.body.innerText })), null, 2));
  if (flavor === 'firefox') await options.goto('about:blank');
  await options.setViewport({ width: 1100, height: 850 });
  if (flavor === 'firefox') { await navigate(options, extensionRoot + 'options.html'); await options.waitForFunction(() => !document.querySelector('#draft-controls').disabled); }
  log(`[${flavor}] current conversion snapshot, shared next lookup and learning`);
  const page = await inputPage(); const other = await inputPage();
  await convert(page); const beforeHud = await hud(page);
  await front(options);
  await click(options, `#draft-list [data-dict-id="${second}"] [aria-label$="を上へ"]`); await save();
  assert.equal(await hud(page), beforeHud);
  assert.deepEqual((await preview('てすと'))[0], {
    word: '共通',
    annotation: '表示注釈：なし / 送り条件：指定なし',
    sources: ['システム：<img src=x onerror=alert(1)> / 注釈：なし', 'システム：上位辞書 / 注釈：上位'],
  });
  await cancel(page); await convert(page);
  assert.ok((await hud(page)).includes('共通'));
  await page.keyboard.press(' ');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root').shadowRoot.querySelector('.skk-candidate').textContent.includes('第二'));
  await convert(other); await other.keyboard.press(' ');
  await other.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root').shadowRoot.querySelector('.skk-candidate').textContent.includes('第二')); await cancel(other);
  await page.bringToFront(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#input-test').value === '第二');
  await convert(other); assert.ok((await hud(other)).includes('第二')); await cancel(other);
  await front(options); await preview('てすと');
  assert.equal(await options.$eval('#effective-candidates > li', (el) => el.firstChild.textContent), '第二');
  await convert(other);
  for (let i = 0; i < 3; i++) await other.keyboard.press(' ');
  await other.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root').shadowRoot.textContent.includes('第三'));
  const menuBefore = await hud(other);
  const secondOptions = await browser.newPage(); await navigate(secondOptions, extensionRoot + 'options.html');
  await secondOptions.waitForFunction(() => !document.querySelector('#draft-controls').disabled);
  await click(secondOptions, `#draft-list [data-dict-id="${second}"] input`);
  const savedOptions = options; options = secondOptions; await save(); options = savedOptions;
  assert.equal(await hud(other), menuBefore);
  await cancel(other);
  await rpc({ type: 'SKK_USER_CLEAR' });
  await convert(other); await other.keyboard.press(' ');
  await other.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root').shadowRoot.querySelector('.skk-candidate').textContent.includes('第一'));
  await cancel(other);
  await front(options); await click(options, '#refresh');
  await options.waitForFunction((id) => !document.querySelector(`#draft-list [data-dict-id="${id}"] input`).checked, {}, second);
  await click(options, `#draft-list [data-dict-id="${second}"] input`); await save();
  await convert(other); await other.keyboard.press(' ');
  await other.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root').shadowRoot.querySelector('.skk-candidate').textContent.includes('第二'));
  await other.keyboard.press('Enter'); await other.waitForFunction(() => document.querySelector('#input-test').value === '第二');
  await front(options);
  log(`[${flavor}] failed local import rollback, retry, retained disabled cache`);
  const beforeFailure = await status();
  await options.select('#import-target', second); await options.select('#import-format', 'json'); await upload(options, badFile); await click(options, '#import');
  await options.waitForFunction(() => document.querySelector('#error').textContent.length > 0 && !document.querySelector('#draft-controls').disabled);
  assert.equal((await status()).revision, beforeFailure.revision);
  assert.deepEqual(words(await preview('てすと')), ['共通', '第二', '第一', '第三', '第四', '第五', '第六', '第七', '第八']);
  await importFile('再取込辞書', replacement, 'json', second);
  const beforeDisable = (await status()).dictionaries.find((d) => d.dictId === second);
  await click(options, `#draft-list [data-dict-id="${second}"] input`); await save();
  assert.ok(!words(await preview('てすと')).includes('更新候補'));
  assert.equal((await status()).dictionaries.find((d) => d.dictId === second).version, beforeDisable.version);
  await click(options, `#draft-list [data-dict-id="${second}"] input`); await save();
  assert.ok(words(await preview('てすと')).includes('更新候補'));
  log(`[${flavor}] pending remote update keeps old lookup usable; rollback and retry`);
  await transport('success', json({ 'てすと': ['遠隔旧候補'], 'えんかくてすと': ['遠隔旧専用'] }));
  await options.select('#kind', 'l'); await options.select('#format', 'json'); await click(options, '#add'); await save();
  const remoteBefore = await status();
  await transport('pending', json({ 'てすと': ['遠隔新候補'], 'えんかくてすと': ['遠隔新専用'] }));
  await click(options, '[data-update="skk-jisyo-l"]');
  await options.waitForFunction(() => document.querySelector('#operation').textContent.includes('取得・検証・保存中'));
  assert.equal((await status()).revision, remoteBefore.revision);
  assert.ok(words(await preview('てすと')).includes('遠隔旧候補'));
  const pendingInput = await inputPage(); await convert(pendingInput, 'enkakutesuto'); assert.ok((await hud(pendingInput)).includes('遠隔旧専用')); await cancel(pendingInput);
  await front(options); await transport('release'); await saved(remoteBefore.revision);
  assert.ok(words(await preview('てすと')).includes('遠隔新候補'));
  await convert(pendingInput, 'enkakutesuto'); assert.ok((await hud(pendingInput)).includes('遠隔新専用')); await cancel(pendingInput); await front(options);
  for (const [mode, body] of [['error', ''], ['success', '{invalid']]) {
    const previous = await status(); await transport(mode, body); await click(options, '[data-update="skk-jisyo-l"]');
    await options.waitForFunction(() => document.querySelector('#operation').textContent.includes('更新失敗') && !document.querySelector('#draft-controls').disabled);
    assert.equal((await status()).revision, previous.revision);
    assert.ok(words(await preview('てすと')).includes('遠隔新候補'));
  }
  await transport('success', json({ 'てすと': ['遠隔再試行'], 'えんかくてすと': ['遠隔再試行専用'] }));
  const retryRevision = (await status()).revision; await click(options, '[data-update="skk-jisyo-l"]'); await saved(retryRevision);
  for (const kind of ['person', 'place', 'postal']) {
    const format = kind === 'postal' ? 'text' : 'json';
    await transport('success', format === 'text' ? ';; coding: utf-8\n;; okuri-nasi entries.\nゆうびん /郵便試験/\n' : json({ 'かたろぐ': [kind] }));
    await options.select('#kind', kind); await options.select('#format', format); await click(options, '#add'); await save();
    assert.equal((await status()).dictionaries.find((d) => d.kind === kind).state, 'ready');
  }
  await transport('restore');
  log(`[${flavor}] content-script management RPC is denied`);
  const requests = ['SKK_SYSTEM_STATUS', 'SKK_SYSTEM_PREVIEW', 'SKK_SYSTEM_CONFIGURE', 'SKK_SYSTEM_IMPORT', 'SKK_SYSTEM_UPDATE'];
  const probe = `Promise.all(${JSON.stringify(requests)}.map(type => (globalThis.browser ?? chrome).runtime.sendMessage({ type })))`;
  if (flavor === 'chrome') {
    const session = await page.createCDPSession(); const contexts = [];
    session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
    await session.send('Runtime.enable');
    let contextId;
    for (const context of contexts) {
      const answer = await session.send('Runtime.evaluate', { contextId: context.id, expression: 'typeof chrome !== "undefined" && !!chrome.runtime?.id', returnByValue: true });
      if (answer.result.value) { contextId = context.id; break; }
    }
    assert.ok(contextId, 'extension content-script realm');
    const answer = await session.send('Runtime.evaluate', { contextId, expression: probe, awaitPromise: true, returnByValue: true });
    assert.equal(answer.result.value.length, requests.length);
    for (const response of answer.result.value) { assert.equal(response.ok, false); assert.match(response.error, /設定画面/); }
    await session.detach();
  } else {
    await options.evaluate(async (probe) => {
      globalThis.__senderProbe = await browser.contentScripts.register({ matches: ['https://raw.githubusercontent.com/*'], js: [{ code: `${probe}.then(value => document.documentElement.dataset.senderProbe = JSON.stringify(value))` }], runAt: 'document_idle' });
    }, probe);
    const probePage = await browser.newPage(); await probePage.setRequestInterception(true);
    probePage.on('request', (request) => void request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><input>' }));
    await probePage.goto('https://raw.githubusercontent.com/e2e-sender-probe');
    await probePage.waitForFunction(() => !!document.documentElement.dataset.senderProbe);
    const responses = await probePage.evaluate(() => JSON.parse(document.documentElement.dataset.senderProbe));
    assert.equal(responses.length, requests.length);
    for (const response of responses) { assert.equal(response.ok, false); assert.match(response.error, /設定画面/); }
    await probePage.close();
  }
  log(`[${flavor}] popup opens actual options`);
  await options.close(); await secondOptions.close();
  if (flavor === 'chrome') {
    assert.equal((await Promise.all((await browser.pages()).map((page) => page.evaluate(() => location.href).catch(() => '')))).filter((url) => url === extensionRoot + 'options.html').length, 0);
  }
  const popup = await browser.newPage(); await navigate(popup, extensionRoot + 'popup.html');
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('使用中の構成'));
  if (flavor === 'firefox') {
    await verifyFirefoxPopup(popup);
    // ポップアップが開いた実 DOM の検証後に、後続の永続化確認用タブを作成します。
    options = await browser.newPage(); await navigate(options, extensionRoot + 'options.html');
  } else {
    await click(popup, '#open-options');
    options = null;
    const popupDeadline = Date.now() + 30000;
    while (!options && Date.now() < popupDeadline) {
      for (const candidate of await browser.pages()) {
        if (await candidate.evaluate(() => location.href).catch(() => '') === extensionRoot + 'options.html') { options = candidate; break; }
      }
      if (!options) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(options, `popup did not open options: ${await popup.evaluate(() => document.body.innerText).catch(() => 'popup closed')}`);
  }
  await options.waitForSelector('#draft-list [data-dict-id]');
  assert.equal(await options.title(), 'SKK 辞書設定');
  if (flavor === 'chrome') await options.screenshot({ path: path.join(output, 'options.png'), fullPage: true });
  else { fs.writeFileSync(path.join(output, 'options.html'), await options.content()); await page.screenshot({ path: path.join(output, 'input.png') }); }
  log(`[${flavor}] every dictionary is removable and an empty configuration persists`);
  const configuredCount = (await status()).dictionaries.length;
  for (let index = 0; index < configuredCount; index++) await click(options, '#draft-list [aria-label$="を構成から削除"]');
  assert.equal(await options.$eval('#configuration-empty', (el) => el.hidden), false);
  await save();
  const empty = await status();
  assert.deepEqual(empty.dictionaries, []);
  await assertConfigurationList();
  assert.deepEqual(words(await preview('てすと')), ['候補なし']);
  assert.equal(await options.$$eval('#effective-candidates > li', (items) => items.some((item) => item.firstChild.textContent === '第二')), true);
  await browser.close(); browser = null;
  await launch(true);
  assert.equal((await status()).revision, empty.revision);
  assert.deepEqual((await status()).dictionaries, []);
  await assertConfigurationList();
  assert.equal(await options.$eval('#configuration-empty', (el) => el.hidden), false);
  assert.deepEqual(words(await preview('てすと')), ['候補なし']);
  assert.equal(await options.$$eval('#effective-candidates > li', (items) => items.some((item) => item.firstChild.textContent === '第二')), true);
  await options.select('#kind', 'l'); await options.select('#format', 'json'); await click(options, '#add'); await save();
  assert.ok(words(await preview('てすと')).includes('遠隔再試行'));
  const restored = await status();
  assert.equal(restored.dictionaries.length, 1);
  assert.equal(restored.dictionaries[0].state, 'ready');
  await click(options, '[data-update="skk-jisyo-l"]');
  await options.waitForFunction(() => document.querySelector('#operation').textContent.includes('更新失敗') && !document.querySelector('#draft-controls').disabled);
  assert.equal((await status()).revision, restored.revision);
  const offlineInput = await inputPage(); await convert(offlineInput, 'enkakutesuto'); assert.ok((await hud(offlineInput)).includes('遠隔再試行専用'));
  log(`[${flavor}] PASS system dictionary UI and same-profile offline restart`);
} catch (error) {
  fs.appendFileSync(path.join(output, 'run.log'), String(error.stack) + '\n');
  console.error(await options?.evaluate(() => document.body.innerText).catch(() => 'unavailable'));
  await options?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(builtManifestPath, originalBuiltManifest);
}
