import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const flavor = process.argv[2] ?? 'chrome';
assert.ok(['chrome', 'firefox'].includes(flavor), 'usage: node test/candidate-deletion-e2e.mjs chrome|firefox');
const build = path.join(root, '.output', flavor === 'chrome' ? 'chrome-mv3' : 'firefox-mv2');
assert.ok(fs.existsSync(path.join(build, 'manifest.json')), `build first: ${build}`);
const temp = fs.mkdtempSync(path.join(root, '.output', `deletion-e2e-${flavor}-`));
const artifacts = path.join(root, '.output', `deletion-e2e-${flavor}`);
fs.mkdirSync(artifacts, { recursive: true });
for (const name of ['failure.png', 'failure.txt']) fs.rmSync(path.join(artifacts, name), { force: true });
const extensionPath = path.join(temp, 'extension');
fs.cpSync(build, extensionPath, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
const permission = 'http://127.0.0.1/*';
const hosts = flavor === 'chrome' ? (manifest.host_permissions ??= []) : (manifest.permissions ??= []);
if (!hosts.includes(permission)) hosts.push(permission);
fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest));

const fixture = ';; coding: utf-8\n;; okuri-nasi entries.\nたんご /単語/既定/\n';
let base;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (req.url?.startsWith('/frame')) res.end('<!doctype html><meta charset="utf-8"><input id="frame-input">');
  else res.end('<!doctype html><meta charset="utf-8"><input id="input"><input id="other"><iframe id="child" src="/frame"></iframe>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}/`;
const uuid = '6d19df0d-d322-4940-98aa-246c019bfa03';
let browser;
let page;
let scenario = 'launch';
const log = (...args) => console.log(`[deletion-${flavor}]`, ...args);
const chord = async (modifier, key) => {
  await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  await page.keyboard.up(modifier);
};
const snapshot = frame => frame.evaluate(() => {
  const root = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot;
  const visible = element => !!element && getComputedStyle(element).display !== 'none' && !!element.getClientRects().length;
  const modal = root?.querySelector('.skk-registration-modal-dialog');
  const surface = visible(modal) ? modal : root?.querySelector('.skk-hud-box');
  const text = selector => {
    const element = surface?.querySelector(selector);
    return visible(element) ? element.textContent.trim() : '';
  };
  return {
    prompt: text('.skk-deletion-confirmation'),
    warning: text('.skk-deletion-warning'),
    error: text('.skk-deletion-error'),
    preedit: text('.skk-modal-status-preedit') || text('.skk-preedit'),
    candidate: text('.skk-modal-status-candidate') || text('.skk-candidate'),
    modal: visible(modal),
    modalValue: modal?.querySelector('.skk-modal-input:not([style*="display: none"])')?.value ?? '',
    input: document.querySelector('#input')?.value ?? document.querySelector('#frame-input')?.value ?? '',
  };
});
const waitPrompt = frame => frame.waitForFunction(() => {
  const root = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot;
  return [...(root?.querySelectorAll('.skk-deletion-confirmation') ?? [])]
    .some(element => element.getClientRects().length);
}, { timeout: 15000 });
const waitNoPrompt = frame => frame.waitForFunction(() => {
  const root = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot;
  return [...(root?.querySelectorAll('.skk-deletion-confirmation') ?? [])]
    .every(element => !element.getClientRects().length);
}, { timeout: 15000 });
const waitVisibleMessage = (frame, selector) => frame.waitForFunction(selector => {
  const root = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot;
  return [...(root?.querySelectorAll(selector) ?? [])]
    .some(element => element.getClientRects().length && element.textContent?.trim());
}, { timeout: 15000 }, selector);
const waitCandidate = (frame, word) => frame.waitForFunction(word => {
  const root = document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot;
  return [...(root?.querySelectorAll('.skk-candidate, .skk-modal-status-candidate') ?? [])]
    .some(element => element.getClientRects().length && element.textContent.includes(word));
}, { timeout: 15000 }, word);
const fresh = async () => {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('html[data-skk-initialized="true"]', { timeout: 30000 });
  await page.focus('#input');
  await chord('Control', 'KeyJ');
};
const reading = async (frame, roman) => {
  await chord('Shift', `Key${roman[0].toUpperCase()}`);
  await page.keyboard.type(roman.slice(1));
  await page.keyboard.press(' ');
};
const deletion = async (frame, roman, yomi, word) => {
  await reading(frame, roman);
  await waitCandidate(frame, word);
  await chord('Shift', 'KeyX');
  await waitPrompt(frame);
  const state = await snapshot(frame);
  assert.match(state.prompt, /読み/);
  assert.match(state.prompt, /候補/);
  assert.match(state.prompt, /Y/);
  assert.match(state.prompt, /N/);
  assert.ok(state.prompt.includes(yomi), `${scenario}: reading remains visible: ${JSON.stringify(state)}`);
  assert.ok(state.prompt.includes(word), `${scenario}: target remains visible: ${JSON.stringify(state)}`);
  assert.equal(state.warning, '', `${scenario}: warning initially absent`);
  return state;
};
const checkRestored = async (frame, word) => {
  await waitNoPrompt(frame);
  const state = await snapshot(frame);
  assert.ok(state.candidate.includes(word), `${scenario}: candidate restored: ${JSON.stringify(state)}`);
  assert.equal(state.warning, '', `${scenario}: warning cleared`);
  assert.equal(state.error, '', `${scenario}: error cleared`);
};

async function importDictionary() {
  const extensionRoot = flavor === 'chrome'
    ? (await browser.waitForTarget(target => target.type() === 'service_worker')).url().replace(/[^/]+$/, '')
    : `moz-extension://${uuid}/`;
  const options = await browser.newPage();
  if (flavor === 'firefox') await browser.connection.send('browsingContext.navigate', { context: options.mainFrame()._id, url: `${extensionRoot}options.html`, wait: 'none' });
  else await options.goto(`${extensionRoot}options.html`);
  await options.waitForFunction(() => document.querySelector('#draft-controls') && !document.querySelector('#draft-controls').disabled, { timeout: 30000 });
  await options.$eval('#import-name', el => { el.value = '削除試験'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await options.select('#import-format', 'text');
  if (flavor === 'chrome') {
    const file = path.join(temp, 'fixture.skk');
    fs.writeFileSync(file, fixture);
    await (await options.$('#import-file')).uploadFile(file);
  } else await options.$eval('#import-file', (el, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'fixture.skk'));
    el.files = transfer.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  await options.$eval('#import', el => el.click());
  await options.waitForFunction(() => !document.querySelector('#import').disabled && document.querySelector('#notice').textContent.includes('完了'), { timeout: 30000 });
  assert.equal(await options.$eval('#error', el => el.textContent), '');
  await options.close();
}

try {
  if (flavor === 'chrome') {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH ?? path.join(root, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome'),
      headless: true, enableExtensions: true, userDataDir: path.join(temp, 'profile'),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox', '--disable-setuid-sandbox'],
    });
  } else {
    browser = await puppeteer.launch({
      browser: 'firefox', executablePath: process.env.FIREFOX_PATH ?? '/snap/firefox/current/usr/lib/firefox/firefox',
      headless: true, userDataDir: path.join(temp, 'profile'), args: ['--remote-allow-system-access'],
      extraPrefsFirefox: { 'extensions.webextensions.uuids': JSON.stringify({ 'herissonskk@yhayase': uuid }) },
    });
    await browser.installExtension(extensionPath);
  }
  await importDictionary();
  page = await browser.newPage();
  await fresh();

  scenario = 'normal cancel and warning';
  await deletion(page.mainFrame(), 'tango', 'たんご', '単語');
  await page.screenshot({ path: path.join(artifacts, 'normal-confirm.png') });
  await page.keyboard.press('KeyZ');
  await waitVisibleMessage(page.mainFrame(), '.skk-deletion-warning');
  assert.match((await snapshot(page.mainFrame())).warning, /Y|N/);
  await page.screenshot({ path: path.join(artifacts, 'normal-warning.png') });
  await chord('Shift', 'KeyN');
  await checkRestored(page.mainFrame(), '単語');
  assert.equal((await snapshot(page.mainFrame())).input, '');
  log('PASS', scenario);

  for (const [name, cancel] of [['Ctrl+G', () => chord('Control', 'KeyG')], ['Escape', () => page.keyboard.press('Escape')]]) {
    scenario = `normal ${name} cancellation`;
    await chord('Shift', 'KeyX');
    await waitPrompt(page.mainFrame());
    await page.keyboard.press('KeyZ');
    await cancel();
    await checkRestored(page.mainFrame(), '単語');
    log('PASS', scenario);
  }

  scenario = 'system-only candidate cannot be falsely deleted';
  await chord('Shift', 'KeyX');
  await waitPrompt(page.mainFrame());
  await chord('Shift', 'KeyY');
  await waitVisibleMessage(page.mainFrame(), '.skk-deletion-error');
  let state = await snapshot(page.mainFrame());
  assert.ok(state.prompt.includes('単語') && state.error, `${scenario}: ${JSON.stringify(state)}`);
  await chord('Shift', 'KeyN');
  await checkRestored(page.mainFrame(), '単語');
  log('PASS', scenario);

  scenario = 'register personal candidate';
  await fresh();
  await reading(page.mainFrame(), 'keshigo');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent === '辞書登録');
  await page.keyboard.type('kojin');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#input').value === 'こじん');
  log('PASS', scenario);

  scenario = 'focus change cancels pending deletion';
  await fresh();
  await deletion(page.mainFrame(), 'keshigo', 'けしご', 'こじん');
  const child = await (await page.$('#child')).contentFrame();
  await child.waitForSelector('#frame-input');
  await child.$eval('#frame-input', element => element.focus());
  await chord('Shift', 'KeyY');
  await page.focus('#input');
  await waitNoPrompt(page.mainFrame());
  assert.equal(await page.$eval('#input', element => element.value), '', 'Y after focus move does not insert text into old field');
  await fresh();
  await reading(page.mainFrame(), 'keshigo');
  await waitCandidate(page.mainFrame(), 'こじん');
  log('PASS', scenario);

  scenario = 'delete personal candidate';
  await chord('Shift', 'KeyX');
  await waitPrompt(page.mainFrame());
  await page.keyboard.press('KeyZ');
  await waitVisibleMessage(page.mainFrame(), '.skk-deletion-warning');
  await chord('Shift', 'KeyY');
  await waitNoPrompt(page.mainFrame());
  state = await snapshot(page.mainFrame());
  assert.equal(state.preedit, '', `${scenario}: reading cleared`);
  assert.equal(state.candidate, '', `${scenario}: candidate cleared`);
  assert.equal(state.warning, '', `${scenario}: warning cleared`);
  assert.equal(state.error, '', `${scenario}: error cleared`);
  assert.equal(state.input, '', `${scenario}: no text inserted`);
  await fresh();
  await reading(page.mainFrame(), 'keshigo');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent === '辞書登録');
  assert.equal((await snapshot(page.mainFrame())).modal, true, 'deleted personal candidate is absent on next lookup');
  log('PASS', scenario);

  scenario = 'register personal candidate for minibuffer';
  await fresh();
  await reading(page.mainFrame(), 'minikouho');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent === '辞書登録');
  await page.keyboard.type('kojin');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#input').value === 'こじん');
  log('PASS', scenario);

  scenario = 'registration minibuffer successful deletion';
  await fresh();
  await reading(page.mainFrame(), 'tankengai');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent === '辞書登録');
  await page.keyboard.type('akai');
  await page.waitForFunction(() => [...document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelectorAll('.skk-modal-input') ?? []]
    .some(element => element.getClientRects().length && element.value === 'あかい'));
  await deletion(page.mainFrame(), 'minikouho', 'みにこうほ', 'こじん');
  assert.equal((await snapshot(page.mainFrame())).modalValue, 'あかい');
  await chord('Shift', 'KeyY');
  await waitNoPrompt(page.mainFrame());
  state = await snapshot(page.mainFrame());
  assert.equal(state.modal, true, 'outer registration remains open');
  assert.equal(state.modalValue, 'あかい', 'committed minibuffer prefix is preserved');
  assert.equal(state.preedit, '', 'minibuffer reading is cleared');
  assert.equal(state.candidate, '', 'minibuffer candidate is cleared');
  assert.equal(state.warning, '', 'minibuffer warning is cleared');
  assert.equal(state.error, '', 'minibuffer error is cleared');
  assert.equal(state.input, '', 'host input is unchanged');
  log('PASS', scenario);

  scenario = 'registration minibuffer cancellation';
  await deletion(page.mainFrame(), 'tango', 'たんご', '単語');
  state = await snapshot(page.mainFrame());
  assert.equal(state.modal, true);
  await page.screenshot({ path: path.join(artifacts, 'registration-confirm.png') });
  await page.keyboard.press('KeyZ');
  await waitVisibleMessage(page.mainFrame(), '.skk-deletion-warning');
  await chord('Shift', 'KeyN');
  await checkRestored(page.mainFrame(), '単語');
  assert.equal((await snapshot(page.mainFrame())).modalValue, 'あかい', 'minibuffer prefix remains after cancellation');
  assert.equal((await snapshot(page.mainFrame())).input, '', 'minibuffer conversion does not touch host input');
  log('PASS', scenario);

  scenario = 'register personal candidate for modal focus guard';
  await fresh();
  await reading(page.mainFrame(), 'mikonin');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent === '辞書登録');
  await page.keyboard.type('kojin');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#input').value === 'こじん');
  log('PASS', scenario);

  scenario = 'external focus cancels modal deletion';
  await fresh();
  await reading(page.mainFrame(), 'tankengai');
  await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.querySelector('.skk-modal-badge')?.textContent === '辞書登録');
  await deletion(page.mainFrame(), 'mikonin', 'みこにん', 'こじん');
  await page.$eval('#other', element => element.focus());
  await waitNoPrompt(page.mainFrame());
  await chord('Shift', 'KeyY');
  assert.equal(await page.$eval('#other', element => element.value), 'Y', 'Y belongs to the newly focused input');
  await fresh();
  await reading(page.mainFrame(), 'mikonin');
  await waitCandidate(page.mainFrame(), 'こじん');
  log('PASS', scenario);

  log('PASS all candidate deletion scenarios');
} catch (error) {
  console.error(`[deletion-${flavor}] FAIL ${scenario}`, error);
  try {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png') });
    fs.writeFileSync(path.join(artifacts, 'failure.txt'), `${scenario}\n${String(error?.stack ?? error)}\n`);
  } catch {}
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  if (!process.exitCode) fs.rmSync(temp, { recursive: true, force: true });
}
