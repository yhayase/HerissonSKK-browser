import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const flavor = process.argv[2] ?? 'chrome';
assert.ok(['chrome', 'firefox'].includes(flavor), 'usage: node test/embedded-documents-e2e.mjs chrome|firefox');
const build = path.join(root, '.output', flavor === 'chrome' ? 'chrome-mv3' : 'firefox-mv2');
assert.ok(fs.existsSync(path.join(build, 'manifest.json')), `build first: ${build}`);
const temp = fs.mkdtempSync(path.join(root, '.output', `embedded-e2e-${flavor}-`));
const extensionPath = path.join(temp, 'extension');
fs.cpSync(build, extensionPath, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
const contentScript = manifest.content_scripts.find(script => script.js.some(file => file.includes('/content.js')));
assert.equal(contentScript.all_frames, true, 'the input script must run in every frame');
assert.equal(contentScript.match_about_blank, true, 'the input script must cover about:blank and srcdoc');

const input = '<input id="input" type="text" style="width:220px;font:18px sans-serif">';
const textarea = '<textarea id="textarea" style="width:220px;height:50px;font:18px sans-serif"></textarea>';
const editable = '<div id="editable" contenteditable="true" style="width:220px;min-height:28px;font:18px sans-serif"></div>';
const frameHtml = (body = input + textarea + editable) => `<!doctype html><meta charset="utf-8"><body style="margin:4px">${body}</body>`;
let base;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, base);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (url.pathname === '/frame') res.end(frameHtml());
  else if (url.pathname === '/nested') res.end(frameHtml(`<iframe id="inner" src="/frame" style="width:350px;height:170px"></iframe>`));
  else res.end(frameHtml(`
    <iframe id="same" src="/frame" style="width:360px;height:180px"></iframe>
    <iframe id="cross" src="http://localhost:${server.address().port}/frame" style="width:360px;height:180px"></iframe>
    <iframe id="nested" src="/nested" style="width:380px;height:210px"></iframe>
    <iframe id="blank" style="width:360px;height:180px"></iframe>
    <iframe id="srcdoc" srcdoc="${frameHtml().replaceAll('"', '&quot;')}" style="width:360px;height:180px"></iframe>
    <iframe id="sandbox" sandbox="allow-scripts allow-same-origin" src="/frame" style="width:360px;height:180px"></iframe>
    <div id="shadow"></div>
    <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='${input}';document.querySelector('#blank').contentDocument.body.innerHTML='${input}';</script>`));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}/`;
const firefoxUuid = '6d19df0d-d322-4940-98aa-246c019bfa01';
let browser;
let page;
const log = (...args) => console.log(`[embedded-${flavor}]`, ...args);
const chord = async (modifier, key) => { await page.keyboard.down(modifier); await page.keyboard.press(key); await page.keyboard.up(modifier); };
const fixture = ';; coding: utf-8\n;; okuri-nasi entries.\nみどりこばこ /緑小箱/翠小函/\n';
const waitReady = frame => frame.waitForSelector('html[data-skk-initialized="true"]', { timeout: 30000 });
const hud = frame => frame.evaluate(() => {
  const root = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot;
  const box = root?.querySelector('.skk-hud-box');
  const rect = box?.getBoundingClientRect();
  return {
    badge: root?.querySelector('.skk-mode-badge')?.textContent?.trim(),
    hidden: !box || box.classList.contains('skk-hidden'),
    candidate: root?.querySelector('.skk-candidate')?.textContent?.trim(),
    preedit: root?.querySelector('.skk-preedit')?.textContent?.trim(),
    modal: root?.querySelector('.skk-modal-badge')?.textContent?.trim(),
    rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
    viewport: { width: innerWidth, height: innerHeight },
  };
});
const child = async id => {
  const handle = await page.waitForSelector(`#${id}`);
  const frame = await handle.contentFrame();
  assert.ok(frame, `${id}: frame exists`);
  await frame.waitForSelector('#input', { timeout: 30000 });
  return frame;
};
const focus = async (frame, selector) => {
  await frame.$eval(selector, el => {
    if (el.isContentEditable) el.textContent = '';
    else el.value = '';
    el.focus();
  });
  await chord('Control', 'KeyJ');
  await frame.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent?.includes('かな'));
};
const value = (frame, selector) => frame.$eval(selector, el => el.value ?? el.textContent);
const coldKana = async (frame, selector) => {
  await frame.$eval(selector, el => el.focus());
  await chord('Control', 'KeyJ');
  await page.keyboard.type('nihon');
  await page.keyboard.press('Enter');
  try {
    await frame.waitForFunction(sel => document.querySelector(sel)?.value === 'にほん', { timeout: 5000 }, selector);
  } catch (error) {
    log('cold mismatch', { actual: await value(frame, selector), hud: await hud(frame), url: frame.url() });
    throw error;
  }
  assert.equal(await value(frame, selector), 'にほん', 'first Ctrl+J and immediate keys stay in the child frame');
};
const compose = async (frame, selector, choice = 0) => {
  await focus(frame, selector);
  await chord('Shift', 'KeyM');
  await page.keyboard.type('idorikobako');
  await page.keyboard.press(' ');
  await frame.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-candidate')?.textContent?.includes('小'));
  for (let i = 0; i < choice; i++) await page.keyboard.press(' ');
  if (choice) await frame.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-candidate')?.textContent?.includes('翠小函'));
  const candidate = (await hud(frame)).candidate.replace(/^▼/, '');
  await page.keyboard.press('Enter');
  // テキストエリアでは確定後の Enter が改行を一つ挿入します。
  const expected = selector === '#textarea' ? `${candidate}\n` : candidate;
  try {
    await frame.waitForFunction((sel, text) => (document.querySelector(sel)?.value ?? document.querySelector(sel)?.textContent) === text, { timeout: 5000 }, selector, expected);
  } catch (error) {
    log('commit mismatch', { candidate, expected, actual: await value(frame, selector), hud: await hud(frame) });
    throw error;
  }
  assert.equal(await value(frame, selector), expected);
  return candidate;
};

async function importDictionary() {
  const extensionRoot = flavor === 'chrome'
    ? (await browser.waitForTarget(target => target.type() === 'service_worker')).url().replace(/[^/]+$/, '')
    : `moz-extension://${firefoxUuid}/`;
  const options = await browser.newPage();
  if (flavor === 'firefox') await browser.connection.send('browsingContext.navigate', { context: options.mainFrame()._id, url: `${extensionRoot}options.html`, wait: 'none' });
  else await options.goto(`${extensionRoot}options.html`);
  await options.waitForFunction(() => document.querySelector('#draft-controls') && !document.querySelector('#draft-controls').disabled, { timeout: 30000 });
  await options.$eval('#import-name', el => { el.value = '埋め込み試験'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await options.select('#import-format', 'text');
  if (flavor === 'chrome') {
    const file = path.join(temp, 'fixture.skk'); fs.writeFileSync(file, fixture);
    await (await options.$('#import-file')).uploadFile(file);
  } else await options.$eval('#import-file', (el, text) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([text], 'fixture.skk'));
    el.files = transfer.files; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  await options.$eval('#import', el => el.click());
  await options.waitForFunction(() => !document.querySelector('#import').disabled && document.querySelector('#notice').textContent.includes('完了'), { timeout: 30000 });
  assert.equal(await options.$eval('#error', el => el.textContent), '');
  await options.close();
}

let scenario = 'startup';
const complete = () => log('PASS', scenario);
try {
  if (flavor === 'chrome') {
    manifest.host_permissions ??= [];
    for (const host of ['http://127.0.0.1/*', 'http://localhost/*']) if (!manifest.host_permissions.includes(host)) manifest.host_permissions.push(host);
    fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? path.join(root, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome'), headless: true, enableExtensions: true, userDataDir: path.join(temp, 'profile'), args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox', '--disable-setuid-sandbox'] });
  } else {
    browser = await puppeteer.launch({ browser: 'firefox', executablePath: process.env.FIREFOX_PATH ?? '/snap/firefox/current/usr/lib/firefox/firefox', headless: true, userDataDir: path.join(temp, 'profile'), args: ['--remote-allow-system-access'], extraPrefsFirefox: { 'extensions.webextensions.uuids': JSON.stringify({ 'herissonskk@yhayase': firefoxUuid }) } });
    await browser.installExtension(extensionPath);
  }
  await importDictionary();
  page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 850 });
  await page.goto(base, { waitUntil: 'networkidle0' });
  const top = page.mainFrame();
  await waitReady(top);
  scenario = 'same-origin input';
  const untouched = await child('cross');
  assert.equal(await untouched.$('#skk-browser-ext-hud-root'), null, 'unfocused child has no eager HUD');
  const same = await child('same');
  assert.equal(await compose(same, '#input'), '緑小箱');
  complete();
  scenario = 'cross-origin textarea';
  const cross = untouched;
  await coldKana(cross, '#input');
  assert.equal(await compose(cross, '#textarea', 1), '翠小函');
  complete();
  scenario = 'cross-frame learned candidate';
  const learned = await compose(same, '#textarea');
  assert.equal(learned, '翠小函', 'learning in a cross-origin child is visible in a sibling frame');
  complete();
  scenario = 'nested contenteditable';
  const nested = await (await page.$('#nested')).contentFrame();
  await nested.waitForSelector('#inner');
  const inner = await (await nested.$('#inner')).contentFrame();
  await inner.waitForSelector('#editable');
  assert.equal(await compose(inner, '#editable'), '翠小函');
  complete();
  scenario = 'about:blank input';
  assert.equal(await compose(await child('blank'), '#input'), '翠小函');
  complete();
  scenario = 'srcdoc input';
  assert.equal(await compose(await child('srcdoc'), '#input'), '翠小函');
  complete();
  scenario = 'sandbox with same-origin';
  assert.equal(await compose(await child('sandbox'), '#input'), '翠小函');
  complete();
  scenario = 'blob/data and opaque sandbox';
  if (contentScript.match_origin_as_fallback) {
    await page.evaluate(html => {
      const add = (id, src, sandbox) => {
        const frame = document.createElement('iframe'); frame.id = id; frame.src = src;
        frame.style.cssText = 'width:360px;height:180px';
        if (sandbox) frame.sandbox = 'allow-scripts';
        document.body.append(frame);
      };
      add('blob', URL.createObjectURL(new Blob([html], { type: 'text/html' })));
      add('data', `data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      add('opaque-sandbox', '/frame', true);
    }, frameHtml());
    for (const id of ['blob', 'data', 'opaque-sandbox']) {
      const frame = await child(id);
      assert.equal(await compose(frame, '#input'), '翠小函', id);
      log('PASS', id);
    }
  } else log('SKIP blob/data/opaque sandbox: match_origin_as_fallback unavailable in this build');
  scenario = 'dynamic iframe';
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'dynamic'; frame.src = '/frame';
    frame.style.cssText = 'width:360px;height:180px'; document.body.append(frame);
  });
  const dynamic = await child('dynamic');
  assert.equal(await compose(dynamic, '#input'), '翠小函');
  complete();
  scenario = 'reloaded iframe';
  await page.$eval('#dynamic', el => { el.src = '/frame?reload=1'; });
  assert.equal(await compose(await child('dynamic'), '#input'), '翠小函');
  complete();
  scenario = 'small iframe registration';
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.id = 'small'; frame.src = '/frame';
    frame.style.cssText = 'width:300px;height:80px'; document.body.append(frame);
  });
  const small = await child('small');
  await focus(small, '#input');
  await chord('Shift', 'KeyK');
  await page.keyboard.type('obakotoku');
  await page.keyboard.press(' ');
  await small.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent?.includes('辞書登録'));
  const registration = await hud(small);
  assert.ok(registration.modal?.includes('辞書登録'));
  const modalFit = await small.evaluate(() => {
    const dialog = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-registration-modal-dialog');
    const field = dialog?.querySelector('.skk-modal-input');
    field?.scrollIntoView({ block: 'nearest' });
    const rect = dialog?.getBoundingClientRect();
    const inputRect = field?.getBoundingClientRect();
    return { rect: rect?.toJSON(), inputRect: inputRect?.toJSON(), height: dialog?.clientHeight, scrollHeight: dialog?.scrollHeight, overflow: dialog && getComputedStyle(dialog).overflowY };
  });
  assert.ok(modalFit.rect && modalFit.rect.left >= 0 && modalFit.rect.right <= 300 && modalFit.rect.top >= 0 && modalFit.rect.bottom <= 80, 'registration dialog fits the 300×80 viewport');
  assert.ok(modalFit.height > 0 && modalFit.scrollHeight > modalFit.height && modalFit.overflow === 'auto', 'registration dialog exposes scroll for hidden content');
  assert.ok(modalFit.inputRect && modalFit.inputRect.top < 80 && modalFit.inputRect.bottom > 0, 'registration input can be scrolled into view');
  await page.keyboard.type('mizuiro');
  await page.keyboard.press('Enter');
  await small.waitForFunction(() => document.querySelector('#input').value === 'みずいろ');
  assert.equal(await value(small, '#input'), 'みずいろ');
  complete();
  scenario = 'registered word shared across frames';
  await focus(cross, '#editable');
  await chord('Shift', 'KeyK');
  await page.keyboard.type('obakotoku');
  await page.keyboard.press(' ');
  await cross.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-candidate')?.textContent?.includes('みずいろ'));
  await page.keyboard.press('Enter');
  await cross.waitForFunction(() => document.querySelector('#editable').textContent === 'みずいろ');
  complete();
  scenario = 'separate frame focus';
  await same.$eval('#input', el => el.focus());
  assert.equal((await hud(same)).badge, 'かな');
  await dynamic.$eval('#input', el => el.focus());
  await same.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-hud-box')?.classList.contains('skk-hidden'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await hud(same)).hidden, true, 'unfocused frame HUD stays hidden');
  assert.equal((await hud(dynamic)).hidden, false, 'focused frame HUD remains visible');
  assert.equal(await value(same, '#input'), '緑小箱', 'focus changes preserve prior committed text');
  complete();
  scenario = 'open Shadow DOM';
  await page.evaluate(() => document.querySelector('#shadow').shadowRoot.querySelector('#input').focus());
  await chord('Control', 'KeyJ');
  await top.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent?.includes('かな'));
  await page.keyboard.type('nihon');
  await page.keyboard.press('Enter');
  await top.waitForFunction(() => document.querySelector('#shadow').shadowRoot.querySelector('#input').value === 'にほん');
  complete();
  log('PASS all embedded document scenarios');
} catch (error) {
  console.error(`[embedded-${flavor}] FAIL ${scenario}`, error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  if (!process.exitCode) fs.rmSync(temp, { recursive: true, force: true });
}
