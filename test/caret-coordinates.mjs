import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import puppeteer from 'puppeteer-core';

// 実際のライブラリとブラウザーのレイアウトで座標互換性を検証します。
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'herisson-caret-'));
let server;
let browser;
try {
  await build({
    configFile: false, root, logLevel: 'error',
    build: { outDir: directory, emptyOutDir: true, minify: false,
      lib: { entry: path.join(root, 'src/adapter/CaretPosition.ts'), formats: ['es'], fileName: () => 'caret.js' } },
  });
  const source = await fs.readFile(path.join(directory, 'caret.js'));
  server = http.createServer((req, res) => {
    if (req.url === '/caret.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(source);
    } else {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const name of ['chrome', 'firefox']) {
    browser = await puppeteer.launch({
      browser: name, headless: true,
      executablePath: name === 'chrome'
        ? path.join(root, 'chrome/linux-152.0.7977.82/chrome-linux64/chrome')
        : '/snap/firefox/current/usr/lib/firefox/firefox',
      args: name === 'chrome' ? ['--no-sandbox'] : [],
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const results = await page.evaluate(async () => {
      const { getActiveCaretCoordinates: measure } = await import('/caret.js');
      const checks = [];
      const check = (name, condition) => checks.push({ name, condition });
      const equal = (a, b) => ['x', 'y', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.01);
      for (const text of ['hello', 'hello\nworld\nlast', '長い文章の折り返しを確認します。'.repeat(8)]) {
        const el = document.createElement('textarea');
        el.style.cssText = 'position:absolute;top:50px;left:50px;width:180px;height:65px;font:16px monospace;line-height:normal;padding:4px;border:1px solid;';
        el.value = text; document.body.append(el); el.focus(); el.setSelectionRange(text.length, text.length);
        const style = el.getAttribute('style');
        const count = document.body.children.length;
        el.scrollTop = 0; el.scrollLeft = 0;
        const normal = measure(el);
        check('入力欄の状態と測定要素の後片付け', el.getAttribute('style') === style && el.selectionEnd === text.length && document.activeElement === el && document.body.children.length === count);
        el.style.lineHeight = '19.2px'; el.scrollTop = 0; el.scrollLeft = 0;
        check('normal の複数行・折り返し互換性', equal(normal, measure(el)));
        for (const height of [20, 20.5]) {
          el.style.lineHeight = `${height}px`; el.scrollTop = 0; el.scrollLeft = 0;
          const top = measure(el); el.scrollTop = 20;
          const scrolled = measure(el);
          check('行高と縦スクロール', scrolled.height === height && Math.abs(scrolled.y - (top.y - el.scrollTop)) < 0.01 && scrolled.x === top.x);
        }
        el.style.whiteSpace = 'pre'; el.value = 'abcdefghijklmnopqrstuvwxyz'.repeat(8);
        el.setSelectionRange(100, 100); el.scrollLeft = 0;
        const left = measure(el); el.scrollLeft = 30;
        check('横スクロール', Math.abs(measure(el).x - (left.x - el.scrollLeft)) < 0.01);
        el.remove();
      }
      const failureTarget = document.createElement('textarea');
      document.body.append(failureTarget);
      // ページ上の同名要素を消さず、例外で残ったライブラリのミラーだけを回収します。
      const existing = document.createElement('div');
      existing.id = 'input-textarea-caret-position-mirror-div'; document.body.append(existing);
      const countBeforeFailure = document.body.children.length;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
      try {
        Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { throw new Error('測定失敗'); } });
        const result = measure(failureTarget);
        check('例外時の下端配置と後片付け', result.y === failureTarget.getBoundingClientRect().bottom && document.body.children.length === countBeforeFailure && existing.isConnected);
      } finally {
        Object.defineProperty(HTMLElement.prototype, 'offsetLeft', descriptor);
        existing.remove(); failureTarget.remove();
      }
      for (const type of ['text', 'number', 'email']) {
        const el = document.createElement('input'); el.type = type; el.value = '12345'; document.body.append(el);
        const actual = measure(el); const rect = el.getBoundingClientRect();
        check(`${type} の下端配置`, actual.y === rect.bottom && Number.isFinite(actual.x)); el.remove();
      }
      return checks;
    });
    assert.deepEqual(results.filter(result => !result.condition), [], `${name}: 座標互換性`);
    console.log(`${name}: ${results.length} 件成功`);
    await browser.close(); browser = undefined;
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
