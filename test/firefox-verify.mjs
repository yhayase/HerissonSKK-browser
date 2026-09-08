import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(ROOT, 'public');
const GECKODRIVER_PATH =
  process.env.GECKODRIVER_PATH ||
  (fs.existsSync('/snap/bin/geckodriver') ? '/snap/bin/geckodriver' : 'geckodriver');
const FIREFOX_PATH =
  process.env.FIREFOX_PATH ||
  (fs.existsSync('/snap/firefox/current/usr/lib/firefox/firefox')
    ? '/snap/firefox/current/usr/lib/firefox/firefox'
    : undefined);

/**
 * Lightweight W3C WebDriver Client for Geckodriver.
 * Uses native Node.js fetch with 0 external dependencies.
 */
class WebDriverClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await res.json();
    if (res.status >= 400 || (data.value && data.value.error)) {
      const errMessage = data.value?.message || data.value?.error || `HTTP ${res.status}`;
      throw new Error(`WebDriver error at ${endpoint}: ${errMessage}`);
    }
    return data.value;
  }

  async startSession() {
    const caps = {
      capabilities: {
        alwaysMatch: {
          'moz:firefoxOptions': {
            ...(FIREFOX_PATH ? { binary: FIREFOX_PATH } : {}),
            args: ['-headless'],
          },
        },
      },
    };
    const value = await this.request('/session', {
      method: 'POST',
      body: JSON.stringify(caps),
    });
    this.sessionId = value.sessionId;
    return this.sessionId;
  }

  async deleteSession() {
    if (this.sessionId) {
      try {
        await this.request(`/session/${this.sessionId}`, { method: 'DELETE' });
      } catch {
        // ignore
      }
      this.sessionId = null;
    }
  }

  async installAddon(addonPath) {
    return this.request(`/session/${this.sessionId}/moz/addon/install`, {
      method: 'POST',
      body: JSON.stringify({ path: addonPath, temporary: true }),
    });
  }

  async navigateTo(url) {
    return this.request(`/session/${this.sessionId}/url`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async executeScript(script, args = []) {
    const scriptStr =
      typeof script === 'function'
        ? `return (${script.toString()})(...arguments);`
        : script;
    return this.request(`/session/${this.sessionId}/execute/sync`, {
      method: 'POST',
      body: JSON.stringify({ script: scriptStr, args }),
    });
  }

  async sendActions(actionList) {
    return this.request(`/session/${this.sessionId}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        actions: [
          {
            type: 'key',
            id: 'default keyboard',
            actions: actionList,
          },
        ],
      }),
    });
  }

  async pressCombo(modifierKey, charKey) {
    // modifierKey: e.g. '\uE009' for Control, '\uE008' for Shift
    return this.sendActions([
      { type: 'keyDown', value: modifierKey },
      { type: 'keyDown', value: charKey },
      { type: 'keyUp', value: charKey },
      { type: 'keyUp', value: modifierKey },
    ]);
  }

  async pressKey(key) {
    return this.sendActions([
      { type: 'keyDown', value: key },
      { type: 'keyUp', value: key },
    ]);
  }

  async type(text) {
    const actions = [];
    for (const ch of text) {
      actions.push({ type: 'keyDown', value: ch });
      actions.push({ type: 'keyUp', value: ch });
    }
    return this.sendActions(actions);
  }

  async waitFor(predicateFn, timeoutMs = 10000, intervalMs = 100, args = []) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await this.executeScript(predicateFn, args);
      if (result) return result;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for condition: ${predicateFn.toString()}`);
  }

  async takeScreenshot(destPath) {
    const base64Data = await this.request(`/session/${this.sessionId}/screenshot`);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(destPath, buffer);
  }
}

// Special keys in W3C WebDriver
const KEYS = {
  CONTROL: '\uE009',
  SHIFT: '\uE008',
  ENTER: '\uE007',
  SPACE: ' ',
  BACKSPACE: '\uE003',
  ESCAPE: '\uE00C',
};

let server = null;
let geckodriverProc = null;
let client = null;
let isCleaningUp = false;

async function cleanup(exitCode = null) {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log('\n[Teardown] Cleaning up Firefox session, geckodriver, and server...');
  if (client) {
    try {
      await client.deleteSession();
    } catch {}
    client = null;
  }
  if (geckodriverProc) {
    try {
      geckodriverProc.kill('SIGTERM');
    } catch {}
    geckodriverProc = null;
  }
  if (server) {
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch {}
    server = null;
  }
  if (exitCode !== null) {
    process.exit(exitCode);
  }
}

process.on('SIGINT', async () => {
  console.log('\n[Firefox E2E] Interrupted by SIGINT');
  await cleanup(130);
});

process.on('SIGTERM', async () => {
  console.log('\n[Firefox E2E] Terminated by SIGTERM');
  await cleanup(143);
});

async function main() {
  try {
    console.log('[Firefox E2E] Starting local test server...');
    server = http.createServer((req, res) => {
      let reqUrl = req.url === '/' ? '/test.html' : req.url;
      let filePath = path.join(PUBLIC_DIR, reqUrl);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const contentType =
        ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    console.log(`[Test Server] Serving on http://127.0.0.1:${port}/test.html`);

    console.log('[Geckodriver] Launching geckodriver on dynamic port...');
    geckodriverProc = spawn(GECKODRIVER_PATH, ['--port', '0']);

    let geckodriverPort = null;
    geckodriverProc.stdout.on('data', (d) => {
      const match = d.toString().match(/Listening on [^:]+:(\d+)/);
      if (match) {
        geckodriverPort = parseInt(match[1], 10);
      }
    });

    // Wait for geckodriver port detection
    for (let i = 0; i < 50; i++) {
      if (geckodriverPort) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!geckodriverPort) {
      throw new Error('Failed to start geckodriver: port not detected');
    }
    console.log(`[Geckodriver] Listening on port ${geckodriverPort}`);

    client = new WebDriverClient(`http://127.0.0.1:${geckodriverPort}`);

    console.log('[Firefox] Starting headless browser session...');
    const sessionId = await client.startSession();
    console.log(`[Firefox] Session created: ${sessionId}`);

    // Determine addon package path
    const zipPath = path.resolve(ROOT, '.output/skk-browser-extension-0.0.0-firefox.zip');
    const dirPath = path.resolve(ROOT, '.output/firefox-mv2');
    const addonPath = fs.existsSync(zipPath) ? zipPath : dirPath;
    console.log(`[Firefox] Installing addon from: ${addonPath}`);
    const addonId = await client.installAddon(addonPath);
    console.log(`[Firefox] Addon installed successfully: ${addonId}`);

    console.log(`[Firefox] Navigating to http://127.0.0.1:${port}/test.html`);
    await client.navigateTo(`http://127.0.0.1:${port}/test.html`);

    // Check 1: Wait for HUD root in DOM
    console.log('[Check 1] Waiting for SKK HUD host element in DOM...');
    await client.waitFor(() => !!document.getElementById('skk-browser-ext-hud-root'), 10000);
    console.log('[Check 1] Content script HUD injected: true');

    // Check 1.5: Wait for dictionary initialization
    console.log('[Check 1.5] Waiting for dictionary initialization...');
    await client.waitFor(
      () => document.documentElement.getAttribute('data-skk-initialized') === 'true',
      15000
    );
    console.log('[Check 1.5] Dictionary initialization completed.');

    // Helpers
    const waitForCandidate = async () => {
      return client.waitFor(() => {
        const host = document.getElementById('skk-browser-ext-hud-root');
        const cand = host?.shadowRoot?.querySelector('.skk-candidate')?.textContent?.trim();
        return cand && cand.length > 0;
      }, 5000);
    };

    const waitForBadge = async (expected) => {
      return client.waitFor((exp) => {
        const host = document.getElementById('skk-browser-ext-hud-root');
        const badge = host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent?.trim();
        return badge === exp;
      }, 5000, 100, [expected]);
    };

    // --- Test 1: Standard <input> ---
    console.log('\n--- Testing Standard <input> ---');
    await client.executeScript(() => {
      const el = document.getElementById('input-test');
      el.focus();
      el.value = '';
    });

    // Toggle SKK mode: Ctrl+j
    await client.pressCombo(KEYS.CONTROL, 'j');

    let hudInfo = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      const box = host?.shadowRoot?.querySelector('.skk-hud-box');
      const badge = host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent;
      return {
        badge,
        hidden: box?.classList.contains('skk-hidden'),
      };
    });
    console.log('[Input] HUD after Ctrl+j:', hudInfo);

    // Type Nihon: Shift+N, ihon
    await client.pressCombo(KEYS.SHIFT, 'N');
    await client.type('ihon');

    let preedit = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-preedit')?.textContent;
    });
    console.log(`[Input] Preedit text in HUD: "${preedit}"`);

    // Space to convert -> 日本
    await client.pressKey(KEYS.SPACE);
    await waitForCandidate();

    let candidate = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
    });
    console.log(`[Input] Candidate in HUD after Space: "${candidate}"`);

    // Enter to commit
    await client.pressKey(KEYS.ENTER);

    const inputValue = await client.executeScript(() => {
      return document.getElementById('input-test').value;
    });
    console.log(`[Input] Final value after commit: "${inputValue}"`);

    // Toggle back to ASCII
    await client.pressCombo(KEYS.CONTROL, 'j');

    // --- Test 2: Standard <textarea> (okuri-ari) ---
    console.log('\n--- Testing Standard <textarea> (okuri-ari) ---');
    await client.executeScript(() => {
      const el = document.getElementById('textarea-test');
      el.focus();
      el.value = '';
    });

    await client.pressCombo(KEYS.CONTROL, 'j');

    // Type okuri-ari 'Ik': uppercase I (gokan: い), uppercase K (okuri: k), lower u (completes く -> 行く)
    await client.pressCombo(KEYS.SHIFT, 'I');
    await client.pressCombo(KEYS.SHIFT, 'K');
    await client.type('u');

    await waitForCandidate();
    candidate = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
    });
    console.log(`[Textarea] Candidate in HUD for okuri-ari 'Ik': "${candidate}"`);

    // Enter to commit candidate
    await client.pressKey(KEYS.ENTER);

    const taValue = await client.executeScript(() => {
      return document.getElementById('textarea-test').value;
    });
    console.log(`[Textarea] Final value: "${taValue}"`);

    await client.pressCombo(KEYS.CONTROL, 'j');

    // --- Test 3: ContentEditable ---
    console.log('\n--- Testing ContentEditable (Katakana mode) ---');
    await client.executeScript(() => {
      const el = document.getElementById('contenteditable-test');
      el.focus();
      el.textContent = '';
    });

    await client.pressCombo(KEYS.CONTROL, 'j');

    // 'q' switches to Katakana mode
    await client.pressKey('q');
    await waitForBadge('カナ');

    const katakanaBadge = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent;
    });
    console.log(`[ContentEditable] HUD mode badge after 'q': "${katakanaBadge}"`);

    // Convert 'Kanji' -> '漢字' in Katakana mode
    await client.pressCombo(KEYS.SHIFT, 'K');
    await client.type('anji');

    preedit = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-preedit')?.textContent;
    });
    console.log(`[ContentEditable] Preedit in HUD: "${preedit}"`);

    await client.pressKey(KEYS.SPACE);
    await waitForCandidate();

    candidate = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
    });
    console.log(`[ContentEditable] Candidate in HUD: "${candidate}"`);

    await client.pressKey(KEYS.ENTER);

    const ceValue = await client.executeScript(() => {
      return document.getElementById('contenteditable-test').textContent;
    });
    console.log(`[ContentEditable] Final value: "${ceValue}"`);

    // Katakana mode -> Ctrl+j (Hiragana) -> Ctrl+j (Ascii)
    await client.pressCombo(KEYS.CONTROL, 'j');
    await client.pressCombo(KEYS.CONTROL, 'j');

    // --- Test 4: Monaco Editor (VS Code for Web Core) ---
    console.log('\n--- Testing Monaco Editor (VS Code for Web Core) ---');
    await client.waitFor(() => window.monacoEditor !== undefined, 15000);
    console.log('[Monaco] Monaco Editor loaded.');

    await client.executeScript(() => {
      window.monacoEditor.focus();
      window.monacoEditor.setPosition({ lineNumber: 3, column: 3 });
    });

    // Toggle SKK mode: Ctrl+j
    await client.pressCombo(KEYS.CONTROL, 'j');

    hudInfo = await client.executeScript(() => {
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
    console.log('[Monaco] HUD tracked position:', hudInfo);

    // Convert Nihon -> 日本
    await client.pressCombo(KEYS.SHIFT, 'N');
    await client.type('ihon');
    await client.pressKey(KEYS.SPACE);
    await waitForCandidate();
    await client.pressKey(KEYS.ENTER);

    const monacoText = await client.executeScript(() => window.monacoEditor.getValue());
    console.log(`[Monaco] Text after converting 'Nihon' -> '日本':\n${monacoText}`);

    // Test Undo in Monaco (Ctrl+z)
    console.log('[Monaco] Testing Monaco internal Undo stack...');
    await client.pressCombo(KEYS.CONTROL, 'z');
    await client.pressCombo(KEYS.CONTROL, 'z');
    const monacoAfterUndo = await client.executeScript(() => window.monacoEditor.getValue());
    console.log(`[Monaco] Text after Undo (Ctrl+Z):\n${monacoAfterUndo}`);

    // --- Test 5: Inline Dictionary Registration & Learning ---
    console.log('\n--- Testing Inline Dictionary Registration & Learning ---');
    await client.executeScript(() => {
      const el = document.getElementById('input-test');
      el.focus();
      el.value = '';
    });

    // Ensure Hiragana mode
    await client.pressCombo(KEYS.CONTROL, 'j');

    // Type unregistered midashigo: Kawasaki (Shift+K, awasaki) -> Space
    await client.pressCombo(KEYS.SHIFT, 'K');
    await client.type('awasaki');
    await client.pressKey(KEYS.SPACE);

    // Verify HUD badge is '辞書登録'
    await waitForBadge('辞書登録');
    const regBadge = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-mode-badge')?.textContent;
    });
    console.log(`[Registration] HUD mode badge after Space on unregistered word: "${regBadge}"`);

    // Type candidate '川崎市'
    await client.type('川崎市');

    const regPreedit = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-preedit')?.textContent;
    });
    console.log(`[Registration] HUD preedit: "${regPreedit}"`);

    // Press Enter to commit registration
    await client.pressKey(KEYS.ENTER);
    await client.waitFor(
      () => document.getElementById('input-test')?.value?.includes('川崎市'),
      5000
    );

    const registeredValue = await client.executeScript(() => {
      return document.getElementById('input-test').value;
    });
    console.log(`[Registration] Value after registration: "${registeredValue}"`);

    // Clear input and convert 'Kawasaki' a 2nd time to verify persistence & learning
    await client.executeScript(() => {
      document.getElementById('input-test').value = '';
    });
    await client.waitFor(() => document.getElementById('input-test')?.value === '', 5000);

    await client.pressCombo(KEYS.SHIFT, 'K');
    await client.type('awasaki');
    await client.pressKey(KEYS.SPACE);

    await waitForCandidate();
    const learnedCandidate = await client.executeScript(() => {
      const host = document.getElementById('skk-browser-ext-hud-root');
      return host?.shadowRoot?.querySelector('.skk-candidate')?.textContent;
    });
    console.log(`[Learning] Candidate for 'Kawasaki' on 2nd conversion: "${learnedCandidate}"`);

    await client.pressKey(KEYS.ENTER);
    await client.waitFor(() => document.getElementById('input-test')?.value === '川崎市', 5000);
    const finalLearnedValue = await client.executeScript(() => {
      return document.getElementById('input-test').value;
    });
    console.log(`[Learning] Final value after 2nd conversion: "${finalLearnedValue}"`);

    // Save verification screenshot
    const screenshotPath = path.resolve(ROOT, 'firefox-verify-screenshot.png');
    await client.takeScreenshot(screenshotPath);
    console.log(`\n[Screenshot] Saved Firefox headless verification screenshot to: ${screenshotPath}`);

    // Assertions
    const inputOk = inputValue === '日本' || inputValue.includes('日本');
    const taOk = taValue.includes('行く');
    const ceOk = ceValue.includes('漢字');
    const monacoOk = monacoText.includes('日本') && !monacoAfterUndo.includes('日本');
    const regOk =
      regBadge === '辞書登録' &&
      registeredValue.includes('川崎市') &&
      learnedCandidate?.includes('川崎市') &&
      finalLearnedValue.includes('川崎市');

    console.log('\n--- Firefox Assertion Summary ---');
    console.log(`1. Standard <input>: ${inputOk ? 'PASSED ✅' : 'FAILED ❌'}`);
    console.log(`2. Standard <textarea>: ${taOk ? 'PASSED ✅' : 'FAILED ❌'}`);
    console.log(`3. ContentEditable: ${ceOk ? 'PASSED ✅' : 'FAILED ❌'}`);
    console.log(`4. Monaco Editor (VS Code): ${monacoOk ? 'PASSED ✅' : 'FAILED ❌'}`);
    console.log(`5. Inline Registration & Learning: ${regOk ? 'PASSED ✅' : 'FAILED ❌'}`);

    if (inputOk && taOk && ceOk && monacoOk && regOk) {
      console.log('\n🎉 ALL FIREFOX (GECKO) SKK VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
    } else {
      throw new Error('Some Firefox verification tests failed.');
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('[Firefox E2E Failed]:', err);
  process.exit(1);
});
