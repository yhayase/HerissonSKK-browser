import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = path.resolve(ROOT, '.output/chrome-mv3');
const PUBLIC_DIR = path.resolve(ROOT, 'public');
const CHROME_PATH = path.resolve(ROOT, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome');

// 1. Start local HTTP server on 127.0.0.1
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

server.listen(3456, '127.0.0.1', async () => {
  console.log('[Test Server] Serving on http://127.0.0.1:3456/test.html');
  try {
    await runVerification();
  } catch (err) {
    console.error('[Test Failed with Error]:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

async function runVerification() {
  console.log('[Puppeteer] Launching Chrome for Testing in HEADLESS mode...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true, // Completely headless
    enableExtensions: true,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768 });

  page.on('console', (msg) => {
    if (msg.text().includes('[SKK') || msg.text().includes('Monaco')) {
      console.log('  [Browser Console]:', msg.text());
    }
  });

  console.log('[Puppeteer] Navigating to http://127.0.0.1:3456/test.html');
  await page.goto('http://127.0.0.1:3456/test.html', { waitUntil: 'networkidle0' });

  // Wait for content script to inject HUD element
  console.log('[Check 1] Waiting for SKK HUD host element in DOM...');
  const hudHost = await page.waitForSelector('#skk-browser-ext-hud-root', { timeout: 5000 });
  console.log(`[Check 1] Content script HUD injected: ${!!hudHost}`);

  // --- Test 1: Standard <input> ---
  console.log('\n--- Testing Standard <input> ---');
  await page.focus('#input-test');
  // Toggle SKK mode: Ctrl+j
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // Check HUD visibility
  let hudInfo = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    const box = host?.shadowRoot?.querySelector('.skk-hud-box');
    const badge = host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent;
    return {
      badge: badge,
      hidden: box?.classList.contains('skk-hidden'),
    };
  });
  console.log(`[Input] HUD after Ctrl+j:`, hudInfo);

  // Type: nihon -> should directly convert to kana 'にほん'
  await page.keyboard.type('nihon');
  let inputValue = await page.$eval('#input-test', (el) => el.value);
  console.log(`[Input] Value after typing 'nihon': "${inputValue}"`);

  // Type: Nihon (uppercase N) -> Space -> Enter -> Kanji '日本'
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyN');
  await page.keyboard.up('Shift');
  await page.keyboard.type('ihon');

  let preedit = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-preedit')?.textContent;
  });
  console.log(`[Input] Preedit text in HUD: "${preedit}"`);

  // Space to convert
  await page.keyboard.press('Space');
  let candidate = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
  });
  console.log(`[Input] Candidate in HUD after Space: "${candidate}"`);

  // Enter to commit
  await page.keyboard.press('Enter');
  inputValue = await page.$eval('#input-test', (el) => el.value);
  console.log(`[Input] Final value after commit: "${inputValue}"`);

  // Toggle back to ASCII
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // --- Test 2: Standard <textarea> ---
  console.log('\n--- Testing Standard <textarea> ---');
  await page.focus('#textarea-test');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  await page.keyboard.type('toukyou');
  let taValue = await page.$eval('#textarea-test', (el) => el.value);
  console.log(`[Textarea] Value after typing 'toukyou': "${taValue}"`);

  // Convert: Toukyou -> Space -> Enter
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyT');
  await page.keyboard.up('Shift');
  await page.keyboard.type('oukyou');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  taValue = await page.$eval('#textarea-test', (el) => el.value);
  console.log(`[Textarea] Final value: "${taValue}"`);

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // --- Test 3: ContentEditable ---
  console.log('\n--- Testing ContentEditable ---');
  await page.focus('#contenteditable-test');
  await page.evaluate(() => {
    const el = document.getElementById('contenteditable-test');
    el.textContent = '';
  });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Shift');
  await page.keyboard.type('anji');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');

  const ceValue = await page.$eval('#contenteditable-test', (el) => el.textContent);
  console.log(`[ContentEditable] Value: "${ceValue}"`);

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // --- Test 4: Monaco Editor (VS Code for Web Core) ---
  console.log('\n--- Testing Monaco Editor (VS Code for Web Core) ---');
  await page.waitForFunction(() => window.monacoEditor !== undefined, { timeout: 15000 });
  console.log('[Monaco] Monaco Editor loaded.');

  // Focus Monaco editor and set cursor
  await page.evaluate(() => {
    window.monacoEditor.focus();
    window.monacoEditor.setPosition({ lineNumber: 3, column: 3 });
  });

  // Toggle SKK mode: Ctrl+j
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // Check HUD position tracked to Monaco cursor
  hudInfo = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    const box = host?.shadowRoot?.querySelector('.skk-hud-box');
    const rect = box?.getBoundingClientRect();
    return {
      badge: host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent,
      x: rect?.x,
      y: rect?.y,
      visible: box && !box.classList.contains('skk-hidden'),
    };
  });
  console.log(`[Monaco] HUD tracked position:`, hudInfo);

  // Type direct kana: 'ka' -> 'か'
  await page.keyboard.type('ka');

  let monacoText = await page.evaluate(() => window.monacoEditor.getValue());
  console.log(`[Monaco] Text after typing 'ka':\n${monacoText}`);

  // Convert Nihon -> 日本
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyN');
  await page.keyboard.up('Shift');
  await page.keyboard.type('ihon');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');

  monacoText = await page.evaluate(() => window.monacoEditor.getValue());
  console.log(`[Monaco] Text after converting 'Nihon' -> '日本':\n${monacoText}`);

  // Test Undo in Monaco (Ctrl+z)
  console.log('[Monaco] Testing Monaco internal Undo stack...');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  const monacoAfterUndo = await page.evaluate(() => window.monacoEditor.getValue());
  console.log(`[Monaco] Text after Undo (Ctrl+Z):\n${monacoAfterUndo}`);

  // Save screenshot
  const screenshotPath = path.resolve(ROOT, 'poc-screenshot.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`\n[Screenshot] Saved headless verification screenshot to: ${screenshotPath}`);

  await browser.close();

  // Assertions
  const inputOk = inputValue.includes('日本') && inputValue.includes('にほん');
  const taOk = taValue.includes('東京') && taValue.includes('とうきょう');
  const ceOk = ceValue.includes('漢字');
  const monacoOk = monacoText.includes('日本') && monacoText.includes('か');

  console.log('\n--- Assertion Summary ---');
  console.log(`1. Standard <input>: ${inputOk ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`2. Standard <textarea>: ${taOk ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`3. ContentEditable: ${ceOk ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`4. Monaco Editor (VS Code): ${monacoOk ? 'PASSED ✅' : 'FAILED ❌'}`);

  if (inputOk && taOk && ceOk && monacoOk) {
    console.log('\n🎉 ALL POC VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
  } else {
    throw new Error('Some verification tests failed.');
  }
}
