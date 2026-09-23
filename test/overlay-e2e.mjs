import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const flavor = process.argv[2] ?? "chrome";
assert.ok(flavor === "chrome" || flavor === "firefox", "usage: node test/overlay-e2e.mjs chrome|firefox");
const output = path.join(root, ".output", `overlay-e2e-${flavor}`);
const extensionPath = path.join(root, ".output", flavor === "chrome" ? "chrome-mv3" : "firefox-mv2");
const manifestPath = path.join(extensionPath, "manifest.json");
const originalManifest = fs.readFileSync(manifestPath, "utf8");
fs.mkdirSync(output, { recursive: true });
for (const name of ["metrics.json", "failure.json", "failure-state.json", "failure.png"]) fs.rmSync(path.join(output, name), { force: true });
const profile = fs.mkdtempSync(path.join(output, "profile-"));
const words = Array.from({ length: 12 }, (_, i) => `検証候補${String(i + 1).padStart(2, "0")}`);
words[4] += "とても長い候補文字列の折り返し検証".repeat(3);
const annotations = words.map((_, i) => i === 3 ? "全文検証の長い注釈です。".repeat(160) : `候補${i + 1}の注釈`);
const previewWords = Array.from({ length: 12 }, (_, i) => `表示候補${String(i + 1).padStart(2, "0")}`);
const previewAnnotations = previewWords.map((_, i) => `候補${i + 1}の短い注釈`);
const inlineFixtureWords = ["インライン候補一", "インライン候補二", "インライン候補三"];
const shortWords = [...inlineFixtureWords, "短い候補", "小さい候補", "短語候補", "短候補"];
const mixedWords = [...inlineFixtureWords, "短語", "注釈付きの候補", "注釈なし候補", "別候補"];
const mixedAnnotations = [undefined, undefined, undefined, "短い注釈", "長さの違う候補に付く注釈", undefined, "別の注釈"];
const longWords = [...inlineFixtureWords, "非常に長い候補文字列の幅上限検証".repeat(5), "長い候補その二".repeat(7), "長候補", "長候補の追加行"];
const longAnnotations = [undefined, undefined, undefined, "非常に長い注釈文字列の幅上限検証です。".repeat(12), "別の長い注釈".repeat(20), undefined, undefined];
const pagingWords = [...inlineFixtureWords, "ページ幅を広げる長い候補文字列です", ...Array.from({ length: 20 }, (_, i) => `短語${i + 1}`)];
const entry = (words, entryAnnotations) => words.map((word, i) => entryAnnotations?.[i] ? `${word};${entryAnnotations[i]}` : word).join("/");
const dictionaryText = `;; coding: utf-8\n;; okuri-nasi entries.\n${Array.from({ length: 30 }, (_, i) => `おおばれいてすと${"あ".repeat(i)} /${words.map((word, n) => `${word};${annotations[n]}`).join("/")}/`).join("\n")}\nちゅうしゃくれい /${entry(previewWords, previewAnnotations)}/\nたんわ /${entry(shortWords)}/\nこんごう /${entry(mixedWords, mixedAnnotations)}/\nながさ /${entry(longWords, longAnnotations)}/\nはばけんしょう /${entry(pagingWords)}/\n`;
const metrics = [];
let scenario = "launch";
let readingIndex = 0;
let page;
let options;
const log = (...values) => console.log(`[overlay-${flavor}]`, ...values);
// 実際の選択 Range を測れる編集領域を、四隅へ移動して使います。
const fixture = `<!doctype html><meta charset="utf-8"><title>SKK overlay E2E</title>
<style>body{margin:0;min-height:1800px;background:#e7e7e7} #input-test{position:absolute;left:24px;top:24px;width:160px;height:28px;font:18px/28px sans-serif;white-space:pre;border:1px solid #777}</style>
<div id="input-test" contenteditable="true" spellcheck="false">|</div>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
const extensionUuid = "6d19df0d-d322-4940-98aa-246c019bfa00";

const contrast = (foreground, background) => {
  const luminance = (color) => {
    const rgb = color.match(/[\d.]+/g).map(Number);
    assert.ok(rgb.length === 3 || rgb[3] === 1, `opaque color: ${color}`);
    const linear = rgb.slice(0, 3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
const combo = async (page, modifier, key) => { await page.keyboard.down(modifier); await page.keyboard.press(key); await page.keyboard.up(modifier); };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const click = (page, selector) => flavor === "firefox" ? page.$eval(selector, el => el.click()) : page.click(selector);

async function launch() {
  if (flavor === "chrome") {
    const manifest = JSON.parse(originalManifest);
    manifest.host_permissions ??= [];
    if (!manifest.host_permissions.includes("http://127.0.0.1/*")) manifest.host_permissions.push("http://127.0.0.1/*");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH ?? path.join(root, "chrome/linux-152.0.7977.82/chrome-linux64/chrome"),
      headless: true, enableExtensions: true, userDataDir: profile,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-sandbox", "--disable-setuid-sandbox"],
    });
  } else {
    // 一時ビルドにだけ設定 API 権限を追加し、使い捨てプロファイルの実設定を切り替えます。
    const manifest = JSON.parse(originalManifest);
    manifest.permissions ??= [];
    if (!manifest.permissions.includes("browserSettings")) manifest.permissions.push("browserSettings");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    browser = await puppeteer.launch({
      browser: "firefox", executablePath: process.env.FIREFOX_PATH ?? "/snap/firefox/current/usr/lib/firefox/firefox",
      headless: true, userDataDir: profile, args: ["--remote-allow-system-access"],
      extraPrefsFirefox: { "extensions.webextensions.uuids": JSON.stringify({ "herissonskk@yhayase": extensionUuid }) },
    });
    await browser.installExtension(extensionPath);
  }
  const worker = flavor === "chrome" ? await browser.waitForTarget((target) => target.type() === "service_worker") : null;
  const extensionRoot = flavor === "chrome" ? worker.url().replace(/[^/]+$/, "") : `moz-extension://${extensionUuid}/`;
  options = await browser.newPage();
  if (flavor === "firefox") {
    await browser.connection.send("browsingContext.navigate", { context: options.mainFrame()._id, url: `${extensionRoot}options.html`, wait: "none" });
  } else await options.goto(`${extensionRoot}options.html`);
  await options.waitForFunction(() => document.querySelector("#draft-controls") && !document.querySelector("#draft-controls").disabled, { timeout: 30000 });
  const importPath = path.join(output, "overlay-fixture.skk");
  fs.writeFileSync(importPath, dictionaryText);
  await options.$eval("#import-target", (el) => { el.value = ""; });
  await options.$eval("#import-name", (el) => { el.value = "Overlay E2E"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await options.select("#import-format", "text");
  if (flavor === "chrome") await (await options.$("#import-file")).uploadFile(importPath);
  else await options.$eval("#import-file", (el, text) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([text], "overlay-fixture.skk"));
    el.files = transfer.files; el.dispatchEvent(new Event("change", { bubbles: true }));
  }, dictionaryText);
  await click(options, "#import");
  await options.waitForFunction(() => !document.querySelector("#import").disabled && document.querySelector("#notice").textContent.includes("完了"), { timeout: 30000 });
  assert.equal(await options.$eval("#error", el => el.textContent), "", "fixture import saved without error");
  if (flavor === "chrome") { await options.close(); options = null; }
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector("#skk-browser-ext-hud-root", { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.dataset.skkInitialized === "true", { timeout: 15000 });
  return page;
}

async function hudSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot;
    const visible = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden";
    const info = el => el ? { text: el.textContent, rect: el.getBoundingClientRect().toJSON(), display: getComputedStyle(el).display, visible: visible(el), font: getComputedStyle(el).fontSize, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, columnGap: getComputedStyle(el).columnGap } : null;
    const contentBox = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect(), css = getComputedStyle(el);
      const left = r.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
      const top = r.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop);
      const width = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const height = el.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      return { left, top, width, height, right: left + width, bottom: top + height };
    };
    const modal = root?.querySelector(".skk-registration-modal-dialog");
    const box = modal ?? root?.querySelector(".skk-hud-box");
    const host = document.querySelector("#input-test");
    const hostRect = host?.getBoundingClientRect();
    const hostStyle = host ? getComputedStyle(host) : null;
    const detail = box?.querySelector(".skk-candidate-detail");
    const selection = getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    range?.collapse(false);
    return {
      viewport: { width: innerWidth, height: innerHeight, left: visualViewport.offsetLeft, top: visualViewport.offsetTop, visualWidth: visualViewport.width, visualHeight: visualViewport.height, scale: visualViewport.scale },
      caret: range?.getBoundingClientRect().toJSON(), value: host?.textContent,
      host: hostRect && hostStyle ? { rect: hostRect.toJSON(), contentBox: { left: hostRect.left + parseFloat(hostStyle.borderLeftWidth), top: hostRect.top + parseFloat(hostStyle.borderTopWidth), width: host.clientWidth, height: host.clientHeight } } : null,
      list: info(box?.querySelector(".skk-candidate-list")), overlayContentBox: contentBox(box), dialogContentBox: contentBox(modal),
      box: info(box), preedit: info(box?.querySelector(modal ? ".skk-modal-status-preedit" : ".skk-preedit")), candidate: info(box?.querySelector(modal ? ".skk-modal-status-candidate" : ".skk-candidate")),
      modal: modal ? { badge: modal.querySelector(".skk-modal-badge")?.textContent, input: info([...modal.querySelectorAll(".skk-modal-input")].find(visible)), value: [...modal.querySelectorAll(".skk-modal-input")].find(visible)?.value } : null,
      rows: [...(box?.querySelectorAll(".skk-candidate-row") ?? [])].filter(visible).map(row => ({
        ...info(row), key: info(row.querySelector(".skk-candidate-key")), word: info(row.querySelector(".skk-candidate-word")), annotation: info(row.querySelector(".skk-candidate-annotation")), annotationText: row.querySelector(".skk-candidate-annotation-text")?.textContent, preview: info(row.querySelector(".skk-candidate-annotation-text")), indicator: info(row.querySelector(".skk-candidate-annotation-indicator")),
      })),
      detail: visible(detail) ? { ...info(detail), annotation: detail.querySelector(".skk-candidate-detail-annotation")?.textContent, annotationStyle: info(detail.querySelector(".skk-candidate-detail-annotation")), scrollTop: detail.scrollTop, scrollHeight: detail.scrollHeight, clientHeight: detail.clientHeight } : null,
      guidance: visible(box?.querySelector(".skk-candidate-guidance")),
    };
  });
}
async function record(name) {
  await settle(page);
  const snapshot = await hudSnapshot(page);
  metrics.push({ scenario: name, ...snapshot });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  return snapshot;
}
function inBounds(s) {
  const r = s.box.rect, v = s.viewport;
  assert.ok(r.width > 0 && r.height > 0, `${scenario}: visible overlay`);
  assert.ok(r.left >= v.left - 1 && r.right <= v.left + v.visualWidth + 1 && r.top >= v.top - 1 && r.bottom <= v.top + v.visualHeight + 1, `${scenario}: overlay inside visual viewport: ${JSON.stringify({ r, v })}`);
}
function menu(s, start, expectedWords = words, expectedAnnotations = annotations) {
  inBounds(s);
  assert.ok(s.rows.length >= 1 && s.rows.length <= 7, `${scenario}: 1..7 visible rows`);
  assert.deepEqual(s.rows.map(r => r.word.text), expectedWords.slice(start, start + s.rows.length), `${scenario}: contiguous exact candidates`);
  assert.deepEqual(s.rows.map(r => r.key.text), ["A", "S", "D", "F", "J", "K", "L"].slice(0, s.rows.length), `${scenario}: exact selection keys`);
  for (const row of s.rows) {
    assert.ok(row.rect.top >= s.box.rect.top && row.rect.bottom <= s.box.rect.bottom + 1, `${scenario}: every keyed row visible`);
    assert.equal(row.word.font, "18px");
    const expectedAnnotation = expectedAnnotations?.[expectedWords.indexOf(row.word.text)];
    if (expectedAnnotation) {
      assert.ok(row.annotation?.visible, `${scenario}: annotation node is visible when expected`);
      assert.equal(row.annotation.font, "14px");
      assert.equal(row.annotationText, expectedAnnotation);
    } else {
      assert.equal(row.annotation, null, `${scenario}: no annotation node or reserved space`);
    }
    for (const item of [row.key, row.word, ...(row.annotation ? [row.annotation] : [])]) assert.ok(contrast(item.color, s.box.background) >= 4.5, `${scenario}: contrast ${item.color} on ${s.box.background}`);
  }
}
function geometry(s) {
  inBounds(s);
  const bounds = s.dialogContentBox ?? s.overlayContentBox;
  assert.ok(s.list.rect.left >= bounds.left - 1 && s.list.rect.right <= bounds.right + 1, `${scenario}: list fits overlay content box`);
  for (let i = 0; i < s.rows.length; i++) {
    const row = s.rows[i];
    if (i) assert.ok(s.rows[i - 1].rect.bottom <= row.rect.top + 1, `${scenario}: rows do not overlap`);
    for (const item of [row.key, row.word, ...(row.annotation ? [row.annotation] : [])]) {
      assert.ok(item.rect.left >= s.list.rect.left - 1 && item.rect.right <= s.list.rect.right + 1, `${scenario}: row content fits list width`);
      assert.ok(item.rect.top >= row.rect.top - 1 && item.rect.bottom <= row.rect.bottom + 1, `${scenario}: row content fits row height`);
    }
    assert.ok(row.word.scrollWidth <= row.word.clientWidth + 1, `${scenario}: candidate text is not horizontally clipped`);
    if (row.annotation) {
      assert.equal(row.annotation.font, "14px");
      assert.ok(row.annotation.rect.width >= 14 && row.annotation.rect.height >= 14, `${scenario}: annotation remains readable`);
      const a = row.annotation.rect, w = row.word.rect;
      assert.ok(a.left >= w.right - 1 || a.top >= w.bottom - 1, `${scenario}: annotation does not overlap candidate`);
    }
  }
}
async function setTheme(theme) {
  if (flavor === "firefox") {
    await options.evaluate(async theme => {
      await browser.browserSettings.overrideContentColorScheme.set({ value: theme });
      const setting = await browser.browserSettings.overrideContentColorScheme.get({});
      if (setting.value !== theme) throw new Error(`Firefox color scheme was not applied: ${setting.value}`);
    }, theme);
  } else await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.waitForFunction(theme => matchMedia(`(prefers-color-scheme: ${theme})`).matches, {}, theme);
}
async function fresh(theme, width = 1024, height = 768, corner = "top-left", pathname = "/") {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await setTheme(theme);
  await page.goto(`${url}${pathname.replace(/^\//, "")}`);
  await page.waitForSelector('html[data-skk-initialized="true"]');
  assert.equal(await page.evaluate(theme => matchMedia(`(prefers-color-scheme: ${theme})`).matches, theme), true);
  await page.$eval("#input-test", (el, corner) => {
    el.style.left = corner.endsWith("right") ? `${innerWidth - 172}px` : "12px";
    el.style.top = corner.startsWith("bottom") ? `${innerHeight - 42}px` : "12px";
    // 右隅でも実キャレットを端へ寄せ、長い初期文字列は領域内に収めます。
    if (corner.endsWith("right")) { el.textContent = "|"; el.style.left = `${innerWidth - 24}px`; el.style.width = "12px"; }
    el.focus(); const range = document.createRange(); range.setStart(el.firstChild, el.firstChild.textContent.length); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, corner);
  await combo(page, "Control", "KeyJ");
}
async function preedit(roman) {
  await combo(page, "Shift", `Key${roman[0].toUpperCase()}`);
  await page.keyboard.type(roman.slice(1));
  await settle(page);
}
async function enterMenu(preview = false) {
  const expectedWords = preview ? previewWords : words;
  const expectedAnnotations = preview ? previewAnnotations : annotations;
  const index = readingIndex++;
  assert.ok(index < 30, "fixture reading budget");
  await preedit(preview ? "tyuusyakurei" : `oobareitesuto${"a".repeat(index)}`);
  assert.equal((await hudSnapshot(page)).preedit.font, "18px");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(" ");
    await page.waitForFunction(word => ((root) => root?.querySelector(".skk-modal-status-candidate") ?? root?.querySelector(".skk-candidate"))(document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot)?.textContent.includes(word), {}, expectedWords[i]);
    const inline = await hudSnapshot(page);
    assert.equal(inline.rows.length, 0, "first three candidates use inline conversion");
    assert.equal(inline.candidate.font, "18px");
  }
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot?.querySelectorAll(".skk-candidate-row").length > 0);
  await settle(page);
  const s = await hudSnapshot(page); menu(s, 3, expectedWords, expectedAnnotations); return s;
}
async function enterFixtureMenu(reading, expectedWords, expectedAnnotations = []) {
  await preedit(reading);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(" ");
    await page.waitForFunction(word => ((root) => root?.querySelector(".skk-modal-status-candidate") ?? root?.querySelector(".skk-candidate"))(document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot)?.textContent.includes(word), {}, expectedWords[i]);
  }
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot?.querySelectorAll(".skk-candidate-row").length > 0);
  await settle(page);
  const snapshot = await hudSnapshot(page);
  menu(snapshot, 3, expectedWords, expectedAnnotations);
  return snapshot;
}
async function changedMenu(firstWord) {
  await page.waitForFunction(word => {
    const row = document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot?.querySelector(".skk-hud-box .skk-candidate-word");
    return row && row.textContent !== word;
  }, {}, firstWord);
  await settle(page); return hudSnapshot(page);
}
async function annotationPreview(theme) {
  scenario = `${theme}-annotation-preview`;
  await fresh(theme); await enterMenu(true);
  const wide = await record(scenario); menu(wide, 3, previewWords, previewAnnotations);
  for (const row of wide.rows) {
    assert.equal(row.preview.visible, true, "ample space displays actual annotation preview");
    assert.ok(row.preview.rect.width > 0 && row.preview.rect.height > 0);
    assert.equal(row.preview.text, previewAnnotations[previewWords.indexOf(row.word.text)]);
    assert.equal(row.preview.font, "14px");
    assert.ok(contrast(row.preview.color, wide.box.background) >= 4.5);
    assert.equal(row.indicator.display, "none");
  }
  scenario = `${theme}-annotation-compact`;
  await page.setViewport({ width: 320, height: 170, deviceScaleFactor: 1 }); await settle(page);
  const compact = await record(scenario); menu(compact, 3, previewWords, previewAnnotations);
  for (let i = 1; i < compact.rows.length; i++) {
    assert.ok(compact.rows[i - 1].rect.bottom <= compact.rows[i].rect.top + 1, `${scenario}: cramped annotated rows do not overlap`);
  }
  for (const row of compact.rows) {
    assert.equal(row.preview.display, "none", "constrained layout hides preview text");
    assert.equal(row.preview.rect.width, 0); assert.equal(row.preview.rect.height, 0);
    assert.equal(row.indicator.visible, true, "constrained layout exposes annotation indicator");
    assert.ok(row.indicator.rect.width > 0 && row.indicator.rect.height > 0);
    assert.equal(row.indicator.text, "注釈あり");
    assert.equal(row.indicator.font, "14px");
    assert.ok(contrast(row.indicator.color, compact.box.background) >= 4.5);
  }
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 }); await settle(page);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  await enterMenu(true);
  const restored = await record(`${theme}-annotation-restored`); menu(restored, 3, previewWords, previewAnnotations);
  assert.ok(restored.rows.every(row => row.preview.visible), `${theme}: full-width resize restores annotation previews`);
  const restoredWidth = restored.box.rect.width;
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 }); await settle(page);
  const repeated = await hudSnapshot(page);
  assert.equal(repeated.box.rect.width, restoredWidth, `${theme}: repeated identical resize keeps full width stable`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
}
async function exercise(theme) {
  scenario = `${theme}-content-width`;
  await fresh(theme);
  const shortCandidates = await enterFixtureMenu("tanwa", shortWords);
  await record(`${theme}-content-short`);
  const shortWidth = shortCandidates.box.rect.width;
  assert.ok(shortWidth < 200, `${scenario}: short unannotated candidates shrink below the legacy 520px width`);
  assert.ok(shortCandidates.rows.every(row => row.annotation === null), `${scenario}: unannotated rows have no annotation reservation`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  await fresh(theme);
  const mixedCandidates = await enterFixtureMenu("kongou", mixedWords, mixedAnnotations);
  await record(`${theme}-content-mixed`);
  const mixedWidth = mixedCandidates.box.rect.width;
  assert.ok(mixedWidth > shortWidth + 8, `${scenario}: content with annotations changes natural width`);
  const widestContent = Math.max(...mixedCandidates.rows.map(row =>
    row.key.rect.width + row.word.rect.width + (row.annotation?.rect.width ?? 0)
      + parseFloat(row.columnGap) * (row.annotation ? 2 : 1)));
  const frameWidth = mixedWidth - mixedCandidates.overlayContentBox.width;
  assert.ok(mixedWidth <= widestContent + frameWidth + 2, `${scenario}: natural width adds no empty space beyond the widest row and overlay frame`);
  for (const row of mixedCandidates.rows) {
    const index = mixedWords.indexOf(row.word.text);
    if (mixedAnnotations[index]) {
      const gap = row.annotation.rect.left - row.word.rect.right;
      assert.ok(gap >= 0 && gap <= 12, `${scenario}: annotation has a nonnegative <=12px horizontal gap`);
      assert.ok(row.annotation.rect.top < row.word.rect.bottom && row.annotation.rect.bottom > row.word.rect.top, `${scenario}: annotation shares the candidate row line`);
    }
  }
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  await fresh(theme, 1024, 768, "top-left", "/long");
  const longCandidates = await enterFixtureMenu("nagasa", longWords, longAnnotations);
  await record(`${theme}-content-long`);
  assert.ok(longCandidates.box.rect.width <= longCandidates.viewport.visualWidth, `${scenario}: long fixture obeys viewport width cap`);
  assert.ok(longCandidates.box.rect.width <= 520, `${scenario}: long fixture obeys the product width cap`);
  assert.ok(longCandidates.box.rect.height <= longCandidates.viewport.visualHeight, `${scenario}: long fixture stays within viewport height`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  // 同じ文書とマウント済み HUD のまま、変換モードを切り替えます。
  const mountedLong = await enterFixtureMenu("nagasa", longWords, longAnnotations);
  await record(`${theme}-mounted-long`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  const mountedShort = await enterFixtureMenu("tanwa", shortWords);
  await record(`${theme}-mounted-short`);
  assert.ok(mountedShort.box.rect.width < mountedLong.box.rect.width, `${scenario}: same mounted HUD shrinks for short content`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  const mountedLongAgain = await enterFixtureMenu("nagasa", longWords, longAnnotations);
  await record(`${theme}-mounted-long-again`);
  assert.equal(mountedLongAgain.box.rect.width, mountedLong.box.rect.width, `${scenario}: same mounted HUD restores long width`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  // 同じ変換の実ページ容量で進み、履歴で長いページへ戻します。
  scenario = `${theme}-same-conversion-width`;
  const pageLong = await enterFixtureMenu("habakensyou", pagingWords);
  await record(`${scenario}-long`);
  await page.keyboard.press(" ");
  const pageShort = await changedMenu(pageLong.rows[0].word.text);
  menu(pageShort, 3 + pageLong.rows.length, pagingWords, []);
  await record(`${scenario}-short`);
  assert.ok(pageShort.box.rect.width < pageLong.box.rect.width, `${scenario}: advancing within one conversion shrinks width`);
  await page.keyboard.press("x");
  const pageBack = await changedMenu(pageShort.rows[0].word.text);
  menu(pageBack, 3, pagingWords, []);
  await record(`${scenario}-long-again`);
  assert.equal(pageBack.box.rect.width, pageLong.box.rect.width, `${scenario}: history restores natural width`);
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  scenario = `${theme}-short-preedit`;
  await fresh(theme); await preedit("a");
  const short = await record(scenario); inBounds(short);
  assert.ok(short.preedit.text.endsWith("あ"));
  assert.ok(short.box.rect.width < 240, "short preedit uses intrinsic width instead of a fixed 360px box");
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  scenario = `${theme}-wide`;
  const first = await enterMenu(); await record(scenario);
  const originalBackground = first.box.background;
  await setTheme(theme === "light" ? "dark" : "light");
  await settle(page);
  const changed = await hudSnapshot(page);
  assert.notEqual(changed.box.background, originalBackground, "live preference change updates opaque background");
  menu(changed, 3);
  await setTheme(theme);
  await settle(page);
  scenario = `${theme}-detail`;
  const value = first.value;
  await page.keyboard.press("?"); await settle(page);
  assert.equal((await hudSnapshot(page)).guidance, true);
  await page.keyboard.press("a"); await settle(page);
  let detail = await record(scenario);
  assert.equal(detail.rows.length, 0);
  assert.equal(detail.detail?.annotation, annotations[3]);
  assert.equal(detail.detail.annotationStyle.font, "14px");
  assert.equal(detail.detail.annotationStyle.visible, true);
  assert.ok(contrast(detail.detail.annotationStyle.color, detail.box.background) >= 4.5);
  assert.equal(detail.value, value, "detail selection does not commit");
  assert.ok(detail.detail.scrollHeight > detail.detail.clientHeight, "fixture requires actual detail scrolling");
  await page.keyboard.press("ArrowDown"); await settle(page);
  const down = await hudSnapshot(page); assert.ok(down.detail.scrollTop > detail.detail.scrollTop, "ArrowDown scrolls annotation");
  await page.keyboard.press("ArrowUp"); await settle(page);
  assert.ok((await hudSnapshot(page)).detail.scrollTop < down.detail.scrollTop, "ArrowUp scrolls back");
  await page.keyboard.press("Escape"); await settle(page);
  const restored = await hudSnapshot(page); menu(restored, 3);
  assert.equal(restored.detail, null, "Escape closes detail and restores the candidate list");
  metrics.push({ scenario: `${theme}-detail-restored`, originalCount: first.rows.length, ...restored });
  scenario = `${theme}-paging`;
  await page.keyboard.press(" "); const next = await changedMenu(first.rows[0].word.text); menu(next, 3 + restored.rows.length);
  await page.keyboard.press("x"); const back = await changedMenu(next.rows[0].word.text); menu(back, 3);
  metrics.push({ scenario: `${theme}-history-restored`, ...back });
  await page.keyboard.press(" "); const nextAgain = await changedMenu(back.rows[0].word.text); menu(nextAgain, 3 + back.rows.length);
  await page.keyboard.press("Backspace"); menu(await changedMenu(nextAgain.rows[0].word.text), 3);
  scenario = `${theme}-narrow`;
  await page.setViewport({ width: 320, height: 220, deviceScaleFactor: 1 }); await settle(page);
  const narrow = await record(scenario); menu(narrow, 3);
  assert.ok(narrow.rows.length < first.rows.length, "short viewport reduces candidate count");
  await page.keyboard.press(" "); const afterResize = await changedMenu(narrow.rows[0].word.text); menu(afterResize, 3 + narrow.rows.length);
  await page.keyboard.press("x"); const resizeBack = await changedMenu(afterResize.rows[0].word.text); menu(resizeBack, 3);
  const selected = resizeBack.rows.at(-1);
  await page.keyboard.press(selected.key.text.toLowerCase());
  await page.waitForFunction(expected => document.querySelector("#input-test").textContent === expected, {}, value + selected.word.text);
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    scenario = `${theme}-${corner}`;
    await fresh(theme, 1024, 768, corner); await enterMenu();
    const s = await record(scenario); menu(s, 3);
    assert.ok(s.caret.height > 0, "actual collapsed selection rectangle exists");
    assert.ok(corner.endsWith("right") ? s.caret.left > 980 : s.caret.left < 40, "actual horizontal caret placement");
    assert.ok(corner.startsWith("bottom") ? s.caret.top > 700 : s.caret.top < 40, "actual vertical caret placement");
    assert.ok(corner.startsWith("bottom") ? s.box.rect.bottom <= s.caret.top + 1 : s.box.rect.top >= s.caret.bottom - 1, "overlay avoids caret line when space fits");
  }
  scenario = `${theme}-scroll`;
  const beforeScroll = await hudSnapshot(page);
  await page.evaluate(() => scrollBy(0, 150)); await settle(page);
  const scrolled = await record(scenario); inBounds(scrolled);
  assert.ok(scrolled.caret.top < beforeScroll.caret.top - 100, "document scroll moves actual caret");
  assert.notEqual(scrolled.box.rect.top, beforeScroll.box.rect.top, "scroll repositions overlay");
  scenario = `${theme}-long-preedit`;
  await fresh(theme, 320, 420); await preedit("ka".repeat(80) + "sa");
  const long = await record(scenario); inBounds(long);
  assert.ok(long.preedit.text.endsWith("さ"));
  assert.ok(long.preedit.scrollWidth > long.preedit.clientWidth, "long reading overflows");
  assert.ok(long.preedit.scrollLeft + long.preedit.clientWidth >= long.preedit.scrollWidth - 2, "reading tail is visible");
  await combo(page, "Control", "KeyG"); await combo(page, "Control", "KeyG");
  assert.equal((await hudSnapshot(page)).value, "|", "cancel leaves host text unchanged");
}
async function narrowGeometry(theme, registrationMode) {
  for (const width of [180, 320]) {
    scenario = `${theme}-${registrationMode ? "registration" : "normal"}-long-${width}`;
    await fresh(theme, width, 900);
    if (registrationMode) {
      await preedit("mitorokuhaba");
      await page.keyboard.press(" ");
      await page.waitForFunction(() => document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot?.querySelector(".skk-modal-badge")?.textContent === "辞書登録");
    }
    await enterFixtureMenu("nagasa", longWords, longAnnotations);
    geometry(await record(scenario));
  }
}
async function registration(theme) {
  scenario = `${theme}-registration`;
  await fresh(theme);
  await preedit(`mitorokukensyou${theme === "dark" ? "a" : ""}`);
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot?.querySelector(".skk-modal-badge")?.textContent === "辞書登録");
  await enterMenu();
  const normal = await record(scenario); menu(normal, 3);
  for (const row of normal.rows) {
    // 長い候補・注釈は折り返しを許容し、短い候補の行だけ隣接を測ります。
    if (row.word.text === words[5]) {
      const gap = row.annotation.rect.left - row.word.rect.right;
      assert.ok(gap >= 0 && gap <= 12, `${scenario}: registration annotation has a nonnegative <=12px horizontal gap`);
      assert.ok(row.annotation.rect.top < row.word.rect.bottom && row.annotation.rect.bottom > row.word.rect.top, `${scenario}: registration annotation shares the candidate row line`);
    }
  }
  assert.equal(normal.modal.input.font, "18px");
  assert.ok(contrast(normal.modal.input.color, normal.modal.input.background) >= 4.5);
  await page.keyboard.press("a"); await settle(page);
  assert.equal((await hudSnapshot(page)).modal.value, words[3]);
  assert.equal((await hudSnapshot(page)).value, "|", "registration candidate stays in minibuffer");
  scenario = `${theme}-nested-registration`;
  await preedit(`sainyuukensyou${theme === "dark" ? "a" : ""}`);
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.querySelector("#skk-browser-ext-hud-root")?.shadowRoot?.querySelector(".skk-modal-badge")?.textContent.startsWith("再帰登録"));
  await enterMenu();
  const nested = await record(scenario); menu(nested, 3);
  assert.equal(nested.modal.input.font, "18px");
  assert.ok(contrast(nested.modal.input.color, nested.modal.input.background) >= 4.5);
  await page.setViewport({ width: 320, height: 420, deviceScaleFactor: 1 }); await settle(page);
  scenario = `${theme}-nested-narrow`;
  menu(await record(scenario), 3);
  await page.keyboard.press("a"); await settle(page);
  assert.equal((await hudSnapshot(page)).modal.value, words[3]);
  await page.keyboard.press("Enter"); await settle(page);
  const parent = await hudSnapshot(page);
  assert.equal(parent.modal.badge, "辞書登録");
  assert.equal(parent.modal.value, words[3] + words[3], "nested registration returns committed candidate to parent");
  await page.keyboard.press("Enter");
  await page.waitForFunction(expected => document.querySelector("#input-test").textContent === expected, {}, "|" + words[3] + words[3]);
  assert.equal((await hudSnapshot(page)).modal, null, "outer registration closes after commit");
}
let testError;
try {
  page = await launch();
  log(`browser ${await browser.version()}`);
  for (const theme of ["light", "dark"]) { await annotationPreview(theme); await exercise(theme); await registration(theme); await narrowGeometry(theme, false); await narrowGeometry(theme, true); }
  if (flavor === "chrome") {
    scenario = "chrome-page-scale-zoom";
    await fresh("light"); await enterMenu();
    const session = await page.createCDPSession();
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 }); await settle(page);
    const zoom = await record(scenario);
    assert.equal(zoom.viewport.scale, 1.5, "CDP visual viewport page scale (not browser toolbar zoom)");
    inBounds(zoom);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 }); await session.detach();
  }
} catch (error) {
  testError = error;
  try {
    if (options && !options.isClosed()) fs.writeFileSync(path.join(output, "failure-options.txt"), await options.evaluate(() => document.body.innerText));
  } catch (diagnosticError) { log(`options diagnostics unavailable: ${diagnosticError}`); }
  try {
    if (page && !page.isClosed()) {
      fs.writeFileSync(path.join(output, "failure-state.json"), JSON.stringify(await hudSnapshot(page), null, 2));
      await page.screenshot({ path: path.join(output, "failure.png") });
    }
  } catch (diagnosticError) { log(`failure diagnostics unavailable: ${diagnosticError}`); }
} finally {
  // 各後処理を独立して試し、検証失敗と後処理失敗の両方を残します。
  const cleanupErrors = [];
  try { if (browser) await browser.close(); } catch (error) { cleanupErrors.push(error); }
  try { fs.writeFileSync(manifestPath, originalManifest); } catch (error) { cleanupErrors.push(error); }
  try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) testError = new AggregateError([...(testError ? [testError] : []), ...cleanupErrors], "Overlay run cleanup failed", { cause: testError });
}
if (testError) {
  try {
    fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ scenario, error: String(testError.stack), errors: testError instanceof AggregateError ? testError.errors.map(error => String(error.stack)) : undefined, metrics }, null, 2));
  } catch (diagnosticError) { log(`failure report unavailable: ${diagnosticError}`); }
  throw testError;
}
// ブラウザ終了・manifest 復元・サーバー停止が全て成功してから PASS を公開します。
fs.writeFileSync(path.join(output, "metrics.json"), JSON.stringify({ result: "PASS", metrics, limitations: ["Android 実機は未確認です。", "Firefox のブラウザ拡大はこのランナーでは未確認です。"] }, null, 2));
log("PASS trusted keyboard overlay scenarios");
