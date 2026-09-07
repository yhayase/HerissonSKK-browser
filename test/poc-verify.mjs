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
    headless: true,
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
  page.on('pageerror', (err) => {
    console.log('  [Browser PageError]:', err);
  });

  console.log('[Puppeteer] Navigating to http://127.0.0.1:3456/test.html');
  await page.goto('http://127.0.0.1:3456/test.html', { waitUntil: 'networkidle0' });

  // Wait for content script to inject HUD element
  console.log('[Check 1] Waiting for SKK HUD host element in DOM...');
  const hudHost = await page.waitForSelector('#skk-browser-ext-hud-root', { timeout: 5000 });
  console.log(`[Check 1] Content script HUD injected: ${!!hudHost}`);


  // --- Test 1: Standard <input> ---
  // Ctrl+j -> type Nihon -> Space -> 日本 -> Enter (verify value: '日本')
  console.log('\n--- Testing Standard <input> ---');
  await page.focus('#input-test');
  await page.$eval('#input-test', (el) => (el.value = ''));

  // Toggle SKK mode: Ctrl+j
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // Check HUD visibility & mode
  let hudInfo = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    const box = host?.shadowRoot?.querySelector('.skk-hud-box');
    const badge = host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent;
    return {
      badge,
      hidden: box?.classList.contains('skk-hidden'),
    };
  });
  console.log(`[Input] HUD after Ctrl+j:`, hudInfo);

  // Type: Nihon (uppercase N to enter MidashigoMode, ihon for にほん)
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyN');
  await page.keyboard.up('Shift');
  await page.keyboard.type('ihon');

  let preedit = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-preedit')?.textContent;
  });
  console.log(`[Input] Preedit text in HUD: "${preedit}"`);

  // Space to convert -> 日本
  await page.keyboard.press('Space');
  let candidate = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
  });
  console.log(`[Input] Candidate in HUD after Space: "${candidate}"`);

  // Enter to commit
  await page.keyboard.press('Enter');
  const inputValue = await page.$eval('#input-test', (el) => el.value);
  console.log(`[Input] Final value after commit: "${inputValue}"`);

  // Toggle back to ASCII
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // --- Test 2: Standard <textarea> ---
  // Ctrl+j -> type Ik (okuri-ari) -> Space -> 行く -> Enter (verify value: '行く')
  console.log('\n--- Testing Standard <textarea> (okuri-ari) ---');
  await page.focus('#textarea-test');
  await page.$eval('#textarea-test', (el) => (el.value = ''));

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // Type okuri-ari 'Ik': uppercase I (gokan: い), uppercase K (okuri: k), lower u (completes く -> 行く)
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyI');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Shift');
  await page.keyboard.type('u');

  candidate = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
  });
  console.log(`[Textarea] Candidate in HUD for okuri-ari 'Ik': "${candidate}"`);

  // Space & Enter to commit candidate
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');

  const taValue = await page.$eval('#textarea-test', (el) => el.value);
  console.log(`[Textarea] Final value: "${taValue}"`);

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // --- Test 3: ContentEditable ---
  // Ctrl+j -> type q (Katakana mode) -> type kanji -> Space -> 漢字
  console.log('\n--- Testing ContentEditable (Katakana mode) ---');
  await page.focus('#contenteditable-test');
  await page.evaluate(() => {
    const el = document.getElementById('contenteditable-test');
    el.textContent = '';
  });

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // 'q' switches to Katakana mode
  await page.keyboard.press('KeyQ');

  const katakanaBadge = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent;
  });
  console.log(`[ContentEditable] HUD mode badge after 'q': "${katakanaBadge}"`);

  // Convert 'Kanji' -> '漢字' in Katakana mode
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Shift');
  await page.keyboard.type('anji');

  preedit = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-preedit')?.textContent;
  });
  console.log(`[ContentEditable] Preedit in HUD: "${preedit}"`);

  await page.keyboard.press('Space');

  candidate = await page.evaluate(() => {
    const host = document.getElementById('skk-browser-ext-hud-root');
    return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
  });
  console.log(`[ContentEditable] Candidate in HUD: "${candidate}"`);

  await page.keyboard.press('Enter');

  const ceValue = await page.$eval('#contenteditable-test', (el) => el.textContent);
  console.log(`[ContentEditable] Final value: "${ceValue}"`);

  // In SKK: Katakana mode -> Ctrl+j transitions to Hiragana mode -> Ctrl+j transitions to Ascii mode
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyJ');
  await page.keyboard.up('Control');

  // --- Test 4: Monaco Editor (VS Code for Web Core) ---
  // Ctrl+j -> type Nihon -> Space -> 日本 -> Enter -> test Monaco Undo
  console.log('\n--- Testing Monaco Editor (VS Code for Web Core) ---');
  await page.waitForFunction(() => window.monacoEditor !== undefined, { timeout: 15000 });
  console.log('[Monaco] Monaco Editor loaded.');

  // Focus Monaco editor and set cursor position
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

  // Convert Nihon -> 日本
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyN');
  await page.keyboard.up('Shift');
  await page.keyboard.type('ihon');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');

  const monacoText = await page.evaluate(() => window.monacoEditor.getValue());
  console.log(`[Monaco] Text after converting 'Nihon' -> '日本':\n${monacoText}`);

  // Test Undo in Monaco (Ctrl+z)
  console.log('[Monaco] Testing Monaco internal Undo stack...');
  // In SKK, Enter fixates the candidate and inserts a newline.
  // Undo reverts newline then candidate cleanly back to initial state.
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  const monacoAfterUndo = await page.evaluate(() => window.monacoEditor.getValue());
  console.log(`[Monaco] Text after Undo (Ctrl+Z):\n${monacoAfterUndo}`);

  // Save verification screenshot
  const screenshotPath = path.resolve(ROOT, 'poc-screenshot.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`\n[Screenshot] Saved headless verification screenshot to: ${screenshotPath}`);

  await browser.close();

  // Assertions
  const inputOk = inputValue === '日本' || inputValue.includes('日本');
  const taOk = taValue.includes('行く');
  const ceOk = ceValue.includes('漢字');
  const monacoOk = monacoText.includes('日本') && !monacoAfterUndo.includes('日本');

  console.log('\n--- Assertion Summary ---');
  console.log(`1. Standard <input>: ${inputOk ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`2. Standard <textarea>: ${taOk ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`3. ContentEditable: ${ceOk ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`4. Monaco Editor (VS Code): ${monacoOk ? 'PASSED ✅' : 'FAILED ❌'}`);

  if (inputOk && taOk && ceOk && monacoOk) {
    console.log('\n🎉 ALL SKK ENGINE VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
  } else {
    throw new Error('Some verification tests failed.');
  }
}
