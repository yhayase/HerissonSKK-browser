import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'assets/store');
await fs.mkdir(output, { recursive: true });
const html = await fs.readFile(path.join(root, 'scripts/store/demo.html'));
const promo = await fs.readFile(path.join(root, 'scripts/store/promo.html'));
const icon = await fs.readFile(path.join(root, 'assets/brand/HerissonSKK-512.png'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/icon.png' ? 'image/png' : 'text/html; charset=utf-8');
  res.end(req.url === '/icon.png' ? icon : req.url === '/promo' ? promo : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const records = [];
let browser;
try {
  for (const flavor of ['chrome', 'firefox']) {
    const uuid = '6287871a-a1fe-4190-a0d4-5497f59aa728';
    browser = await puppeteer.launch(flavor === 'chrome' ? {
      executablePath: process.env.CHROME_PATH ?? path.join(root, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome'),
      headless: true, enableExtensions: true,
      args: [`--disable-extensions-except=${root}/.output/chrome-mv3`, `--load-extension=${root}/.output/chrome-mv3`, '--no-sandbox'],
    } : {
      browser: 'firefox', executablePath: process.env.FIREFOX_PATH ?? '/snap/firefox/current/usr/lib/firefox/firefox',
      headless: true, args: ['--remote-allow-system-access'],
      extraPrefsFirefox: { 'extensions.webextensions.uuids': JSON.stringify({ 'herissonskk@yhayase': uuid }) },
    });
    let extensionRoot;
    if (flavor === 'firefox') {
      await browser.installExtension(path.join(root, '.output/firefox-mv2'));
      extensionRoot = `moz-extension://${uuid}/`;
    } else {
      const worker = await browser.waitForTarget(t => t.type() === 'service_worker');
      extensionRoot = worker.url().replace(/[^/]+$/, '');
    }
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('html[data-skk-initialized="true"]', { timeout: 150000 });
    await page.evaluate(() => document.fonts.ready);
    const combo = async (modifier, key) => { await page.keyboard.down(modifier); await page.keyboard.press(key); await page.keyboard.up(modifier); };
    const capture = async name => {
      await page.screenshot({ path: path.join(output, `${flavor}-${name}.png`), omitBackground: false });
    };
    // 入力デモの背景文だけを設定し、変換・登録は実際のキー入力で操作します。
    await page.$eval('#note', el => { el.value = '今日のメモ\n'; el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
    await combo('Control', 'KeyJ');
    await combo('Shift', 'KeyN'); await page.keyboard.type('ihon'); await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.textContent.includes('日本'));
    await capture('01-conversion');
    await combo('Control', 'KeyG'); await combo('Control', 'KeyG');
    await page.$eval('#note', el => { el.value = ''; el.focus(); });
    await page.evaluate(() => {
      document.querySelector('#heading').textContent = '使う言葉を、その場で登録。';
      document.querySelector('#description').textContent = '辞書にない言葉は入力中に登録。登録語と候補の学習は同じブラウザーに保存します。';
    });
    await combo('Shift', 'KeyE'); await page.keyboard.type('rison'); await page.keyboard.press(' ');
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(el => el.shadowRoot?.querySelector('.skk-modal-input')));
    await page.keyboard.press('l');
    await page.keyboard.type('HerissonSKK');
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(el => el.shadowRoot?.querySelector('.skk-modal-input')?.value === 'HerissonSKK'));
    await capture('02-registration');
    await page.goto('https://vscode.dev', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('.monaco-workbench', { timeout: 120000 });
    await page.waitForSelector('html[data-skk-initialized="true"]', { timeout: 150000 });
    await combo('Control', 'KeyN');
    await page.waitForSelector('.monaco-editor textarea');
    await page.keyboard.type('// HerissonSKK — ブラウザー内の VS Code でも日本語入力\n\n');
    await combo('Control', 'KeyJ');
    await combo('Shift', 'KeyN'); await page.keyboard.type('ihon'); await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('#skk-browser-ext-hud-root')?.shadowRoot?.textContent.includes('日本'));
    await capture('04-vscode');
    if (flavor === 'firefox') {
      await browser.connection.send('browsingContext.navigate', { context: page.mainFrame()._id, url: extensionRoot + 'options.html', wait: 'none' });
    } else await page.goto(extensionRoot + 'options.html');
    await page.waitForFunction(() => document.querySelector('#draft-list [data-dict-id="skk-jisyo-s"]') && !document.querySelector('#draft-controls').disabled);
    await page.evaluate(() => document.fonts.ready);
    // Firefox の BiDi は拡張機能ページの撮影に対応しないため、設定画面は Chrome で撮影します。
    if (flavor === 'chrome') await capture('03-dictionaries');
    if (flavor === 'chrome') {
      await page.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${server.address().port}/promo`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, 'promo-440x280.png'), omitBackground: false });
    }
    records.push({ browser: flavor, version: await browser.version(), viewport: { width: 1280, height: 800 }, dictionary: '初回に公式配信先から取得した基本辞書 S' });
    await browser.close(); browser = undefined;
  }
  await fs.writeFile(path.join(output, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2) + '\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
