import { withOverlayDOM } from "./mocks/OverlayDOM";
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

let SkkContentEngine: any;

const mockDocument = {
  getElementById: (_id: string) => null,
  createElement: (_tag: string) => withOverlayDOM({
    attachShadow: () => ({ appendChild: () => {}, querySelector: () => null }),
    appendChild: () => {},
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: (_sel: string) => null,
  querySelectorAll: (_sel: string) => [],
  fullscreenElement: null,
  documentElement: null,
  body: {
    appendChild: () => {},
  },
  execCommand: () => false,
  activeElement: null as any,
};

beforeAll(async () => {
  if (typeof (globalThis as any).document === "undefined") {
    (globalThis as any).document = mockDocument;
  } else {
    Object.assign((globalThis as any).document, mockDocument);
  }
  if (typeof (globalThis as any).defineContentScript === "undefined") {
    (globalThis as any).defineContentScript = (def: any) => def;
  }
  const mod = await import("../../entrypoints/content");
  SkkContentEngine = mod.SkkContentEngine;
});

import { AsciiMode } from "../../src/core/skk/input-mode/AsciiMode";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { KatakanaMode } from "../../src/core/skk/input-mode/KatakanaMode";
import { ZeneiMode } from "../../src/core/skk/input-mode/ZeneiMode";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { Entry } from "../../src/core/skk/jisyo/entry";
import { RegistrationModal } from "../../src/hud/RegistrationModal";

import type { SkkContentEngine as TSkkContentEngine } from "../../entrypoints/content";

describe("SkkContentEngine verified findings", () => {
  let engine: TSkkContentEngine;

  beforeEach(() => {
    (globalThis as any).document.activeElement = null;
    engine = new SkkContentEngine();
  });

  it("削除待機中の二度目の Y を処理後の入力状態へ転送しない", async () => {
    const target = {
      tagName: "INPUT", type: "text", readOnly: false, disabled: false,
      value: "", selectionStart: 0, selectionEnd: 0,
      setSelectionRange: vi.fn(), dispatchEvent: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }),
    } as any;
    (globalThis as any).document.activeElement = target;
    engine.adapter.setTargetElement(target);
    engine.isInitializedPromise = Promise.resolve();
    const kana = new HiraganaMode(engine.adapter);
    engine.adapter.setInputMode(kana);
    const provider = engine.adapter.getJisyoProvider();
    vi.spyOn(provider, "lookupCandidates").mockResolvedValue(new Entry("てすと", [new Candidate("テスト")], ""));
    let finishDelete!: (deleted: boolean) => void;
    let deleting!: () => void;
    const started = new Promise<void>(resolve => { deleting = resolve; });
    const deleteCandidate = vi.spyOn(provider, "deleteCandidate").mockImplementation(
      () => new Promise<boolean>(resolve => { finishDelete = resolve; deleting(); })
    );
    await kana.upperAlphabetInput("T");
    for (const char of "esuto") await kana.lowerAlphabetInput(char);
    await kana.spaceInput();

    const key = (value: string) => ({
      isTrusted: true, isComposing: false, keyCode: 0, key: value, code: `Key${value}`,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: true,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
    } as any);
    await engine.handleKeyDown(key("X"));
    const first = engine.handleKeyDown(key("Y"));
    await started;
    const second = key("Y");
    await engine.handleKeyDown(second);
    expect(second.preventDefault).toHaveBeenCalledOnce();
    finishDelete(true);
    await first;

    expect(deleteCandidate).toHaveBeenCalledOnce();
    expect(kana.getContextualName()).toBe("hiragana:kakutei");
    expect(engine.adapter.getMidashigo()).toBe("");
    expect(engine.adapter.getCurrentCandidate()).toBeUndefined();
    expect(target.value).toBe("");
  });

  it("ウィンドウ離脱時は削除確認だけを破棄し、通常の変換は保つ", async () => {
    const target = { tagName: "INPUT", type: "text", readOnly: false, disabled: false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 30 }) } as any;
    (globalThis as any).document.activeElement = target;
    engine.adapter.setTargetElement(target);
    const kana = new HiraganaMode(engine.adapter);
    engine.adapter.setInputMode(kana);
    await kana.upperAlphabetInput("T");
    await kana.lowerAlphabetInput("e");
    const cancel = vi.spyOn(engine.adapter, "cancelComposition");
    engine.cancelDeletionOnWindowBlur();
    expect(cancel).not.toHaveBeenCalled();
    expect(engine.adapter.getMidashigo()).toBe("て");

    vi.spyOn(engine.adapter.getJisyoProvider(), "lookupCandidates")
      .mockResolvedValue(new Entry("てすと", [new Candidate("テスト")], ""));
    for (const char of "suto") await kana.lowerAlphabetInput(char);
    await kana.spaceInput();
    await kana.upperAlphabetInput("X");
    expect(kana.getContextualName()).toBe("hiragana:candidateDeletion");
    engine.cancelDeletionOnWindowBlur();
    await cancel.mock.results[0]?.value;
    expect(cancel).toHaveBeenCalledOnce();
    expect(kana.getContextualName()).toBe("hiragana:kakutei");
    expect(engine.adapter.getCurrentCandidate()).toBeUndefined();
  });

  it("登録画面外へフォーカスが移ったときは Tab を奪わない", async () => {
    const outside = { tagName: "INPUT", type: "text", readOnly: false, disabled: false } as any;
    (globalThis as any).document.activeElement = outside;
    const activeInput = { tagName: "INPUT", type: "text" } as any;
    const modal = { isOpen: () => true, getActiveInputElement: () => activeInput } as any;
    const activeModal = vi.spyOn(RegistrationModal, "getActiveModal").mockReturnValue(modal);
    const event = { key: "Tab", isTrusted: true, isComposing: false, keyCode: 0,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() } as any;
    try {
      await engine.handleKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    } finally {
      activeModal.mockRestore();
    }
  });

  describe("isTargetEditable", () => {
    it("returns false for null", () => {
      expect(engine.isTargetEditable(null)).toBe(false);
    });

    it("returns false for disabled or readOnly input elements", () => {
      const inputReadOnly = { tagName: "INPUT", type: "text", readOnly: true, disabled: false } as any;
      expect(engine.isTargetEditable(inputReadOnly)).toBe(false);

      const inputDisabled = { tagName: "INPUT", type: "text", readOnly: false, disabled: true } as any;
      expect(engine.isTargetEditable(inputDisabled)).toBe(false);

      const inputEditable = { tagName: "INPUT", type: "text", readOnly: false, disabled: false } as any;
      expect(engine.isTargetEditable(inputEditable)).toBe(true);
    });

    it("returns false for disabled or readOnly textarea elements", () => {
      const taReadOnly = { tagName: "TEXTAREA", readOnly: true, disabled: false } as any;
      expect(engine.isTargetEditable(taReadOnly)).toBe(false);

      const taDisabled = { tagName: "TEXTAREA", readOnly: false, disabled: true } as any;
      expect(engine.isTargetEditable(taDisabled)).toBe(false);

      const taEditable = { tagName: "TEXTAREA", readOnly: false, disabled: false } as any;
      expect(engine.isTargetEditable(taEditable)).toBe(true);
    });

    it("returns false for non-text input types", () => {
      const button = { tagName: "INPUT", type: "button", readOnly: false, disabled: false } as any;
      expect(engine.isTargetEditable(button)).toBe(false);

      const checkbox = { tagName: "INPUT", type: "checkbox", readOnly: false, disabled: false } as any;
      expect(engine.isTargetEditable(checkbox)).toBe(false);
    });

    it("returns true for contentEditable elements", () => {
      const ce = { tagName: "DIV", isContentEditable: true } as any;
      expect(engine.isTargetEditable(ce)).toBe(true);
    });

    it("returns true for elements inside monaco-editor", () => {
      const monacoChild = {
        tagName: "DIV",
        isContentEditable: false,
        closest: (selector: string) => (selector === ".monaco-editor" ? {} : null),
      } as any;
      expect(engine.isTargetEditable(monacoChild)).toBe(true);
    });
  });

  it("注釈ヘルプの Escape と矢印を候補 UI に渡し、変換を中止しない", async () => {
    const target = { tagName: "INPUT", type: "text", readOnly: false, disabled: false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 30 }) } as any;
    (globalThis as any).document.activeElement = target;
    const mode = new HiraganaMode(engine.adapter);
    engine.adapter.setInputMode(mode);
    const cancel = vi.spyOn(mode, "ctrlGInput");
    const special = vi.spyOn(engine.adapter, "handleCandidateListKey").mockReturnValue(true);
    vi.spyOn(engine.adapter, "isAnnotationHelpActive").mockReturnValue(true);
    for (const key of ["Escape", "ArrowDown"]) {
      const event = { key, isTrusted: true, isComposing: false, keyCode: 0,
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() } as any;
      await engine.handleKeyDown(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(special).toHaveBeenCalledWith(key);
    }
    expect(cancel).not.toHaveBeenCalled();
  });

  describe("handleKeyDown - Security isTrusted guard & IME composition guard", () => {
    it("ignores synthetic/untrusted keydown when e.isTrusted is false", async () => {
      const setTargetSpy = vi.spyOn(engine.adapter, "setTargetElement");
      const event = {
        isTrusted: false,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
      } as any;

      await engine.handleKeyDown(event);
      expect(setTargetSpy).not.toHaveBeenCalled();
    });

    it("ignores synthetic/untrusted keydown when e.isTrusted is undefined", async () => {
      const setTargetSpy = vi.spyOn(engine.adapter, "setTargetElement");
      const event = {
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
      } as any;

      await engine.handleKeyDown(event);
      expect(setTargetSpy).not.toHaveBeenCalled();
    });

    it("ignores keydown when e.isComposing is true", async () => {
      const setTargetSpy = vi.spyOn(engine.adapter, "setTargetElement");
      const event = {
        isTrusted: true,
        isComposing: true,
        keyCode: 0,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
      } as any;

      await engine.handleKeyDown(event);
      expect(setTargetSpy).not.toHaveBeenCalled();
    });

    it("ignores keydown when e.keyCode is 229", async () => {
      const setTargetSpy = vi.spyOn(engine.adapter, "setTargetElement");
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 229,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
      } as any;

      await engine.handleKeyDown(event);
      expect(setTargetSpy).not.toHaveBeenCalled();
    });
  });

  describe("handleKeyDown - Shift modifier guards (Ctrl+Shift+J and Ctrl+Shift+G)", () => {
    let mockInput: any;

    beforeEach(() => {
      mockInput = {
        tagName: "INPUT",
        type: "text",
        readOnly: false,
        disabled: false,
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        setSelectionRange: vi.fn(),
        dispatchEvent: vi.fn(),
        getBoundingClientRect: () => ({ left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 }),
      };
      (globalThis as any).document.activeElement = mockInput;
    });

    it("does not intercept Ctrl+Shift+J (DevTools console shortcut)", async () => {
      const preventDefault = vi.fn();
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        key: "J",
        code: "KeyJ",
        preventDefault,
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
    });

    it("does not intercept Ctrl+Shift+G (Find Previous shortcut)", async () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      const preventDefault = vi.fn();
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 71,
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        key: "G",
        code: "KeyG",
        preventDefault,
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
    });
  });

  describe("handleKeyDown - Ctrl+J mode transitions", () => {
    let mockInput: any;

    beforeEach(() => {
      mockInput = {
        tagName: "INPUT",
        type: "text",
        readOnly: false,
        disabled: false,
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        setSelectionRange: vi.fn(),
        dispatchEvent: vi.fn(),
        getBoundingClientRect: () => ({ left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 }),
      };
      (globalThis as any).document.activeElement = mockInput;
    });

    it("switches from AsciiMode to HiraganaMode", async () => {
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
    });

    it("辞書の起動待ちでも最初の Ctrl+J に続く文字をかな入力として受け付ける", async () => {
      let completeDictionary!: () => void;
      engine.isInitializedPromise = new Promise<void>((resolve) => { completeDictionary = resolve; });
      const key = (value: string, ctrlKey = false) => ({
        isTrusted: true,
        isComposing: false,
        keyCode: value.toLowerCase().charCodeAt(0),
        key: value,
        code: `Key${value.toUpperCase()}`,
        ctrlKey,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any);

      const toggle = key("j", true);
      const consonant = key("k");
      const vowel = key("a");
      await engine.handleKeyDown(toggle);
      const first = engine.handleKeyDown(consonant);
      const second = engine.handleKeyDown(vowel);

      expect(toggle.preventDefault).toHaveBeenCalled();
      expect(consonant.preventDefault).toHaveBeenCalled();
      expect(vowel.preventDefault).toHaveBeenCalled();
      expect(mockInput.value).toBe("");

      completeDictionary();
      await Promise.all([first, second]);
      expect(mockInput.value).toBe("か");
    });

    it("先行する入力処理があるとき Ctrl+J と後続文字を順番に処理する", async () => {
      let completeDictionary!: () => void;
      engine.isInitializedPromise = new Promise<void>((resolve) => { completeDictionary = resolve; });
      const pending = engine.enqueueKeyAction(async () => {
        engine.adapter.setInputMode(AsciiMode.getInstance(engine.adapter));
      });
      const key = (value: string, ctrlKey = false) => ({
        isTrusted: true, isComposing: false, keyCode: value.toLowerCase().charCodeAt(0),
        key: value, code: `Key${value.toUpperCase()}`, ctrlKey, altKey: false, shiftKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      } as any);
      const toggle = key("j", true);
      const consonant = key("k");
      const vowel = key("a");
      const tasks = [engine.handleKeyDown(toggle), engine.handleKeyDown(consonant), engine.handleKeyDown(vowel)];

      expect(consonant.preventDefault).toHaveBeenCalled();
      expect(vowel.preventDefault).toHaveBeenCalled();
      completeDictionary();
      await Promise.all([pending, ...tasks]);
      expect(mockInput.value).toBe("か");
    });

    it("辞書待機中に移動した別の入力欄では無効になった Ctrl+J を引き継がない", async () => {
      let completeDictionary!: () => void;
      engine.isInitializedPromise = new Promise<void>((resolve) => { completeDictionary = resolve; });
      const pending = engine.enqueueKeyAction(async () => {});
      const event = (value: string, ctrlKey = false) => ({
        isTrusted: true, isComposing: false, keyCode: value.toLowerCase().charCodeAt(0),
        key: value, code: `Key${value.toUpperCase()}`, ctrlKey, altKey: false, shiftKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      } as any);
      const toggle = engine.handleKeyDown(event("j", true));
      const nextInput = { ...mockInput, value: "" };
      engine.invalidateQueuedKeys();
      (globalThis as any).document.activeElement = nextInput;
      const letter = event("k");
      await engine.handleKeyDown(letter);
      expect(letter.preventDefault).not.toHaveBeenCalled();

      completeDictionary();
      await Promise.all([pending, toggle]);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
    });

    it("maintains HiraganaMode when idle upon pressing Ctrl+J", async () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
      expect(engine.hud.getVisible()).toBe(true);
    });

    it("calls ctrlJInput() in HiraganaMode when composition/midashigo is active", async () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      const mode = engine.adapter.getCurrentInputMode();
      const ctrlJSpy = vi.spyOn(mode, "ctrlJInput");

      // Enter midashigo
      engine.adapter.setMidashigoStartToCurrentPosition();
      expect(engine.adapter.isInMidashigo()).toBe(true);

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(ctrlJSpy).toHaveBeenCalled();
    });

    it("カタカナ待機中の Ctrl+J はモードを維持する", async () => {
      engine.adapter.setInputMode(KatakanaMode.getInstance());
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(KatakanaMode);
    });

    it.each([
      ["待機中", "", ""],
      ["未完のローマ字", "k", ""],
      ["見出し語", "Ka", "カ"],
      ["候補選択中", "Ka ", "蚊"],
    ])("カタカナの%sで Ctrl+J を押した後もカタカナを入力する", async (_state, input, committed) => {
      mockInput.setSelectionRange.mockImplementation((start: number, end: number) => {
        mockInput.selectionStart = start;
        mockInput.selectionEnd = end;
      });
      engine.adapter.setInputMode(KatakanaMode.getInstance(engine.adapter));
      vi.spyOn(engine.adapter.getJisyoProvider(), "lookupCandidates")
        .mockResolvedValue(new Entry("か", [new Candidate("蚊")], ""));
      const key = (value: string, ctrlKey = false) => ({
        isTrusted: true, isComposing: false, keyCode: value.charCodeAt(0),
        key: value, code: `Key${value.toUpperCase()}`, ctrlKey, altKey: false, shiftKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(),
      } as any);
      for (const char of input) await engine.handleKeyDown(key(char));
      await engine.handleKeyDown(key("j", true));
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(KatakanaMode);
      expect(engine.adapter.isInMidashigo()).toBe(false);
      expect(engine.adapter.getCurrentCandidate()).toBeUndefined();
      expect(engine.adapter.getRemainingRomaji()).toBe("");
      expect(mockInput.value).toBe(committed);
      await engine.handleKeyDown(key("a"));
      expect(mockInput.value).toBe(`${committed}ア`);
    });

    it("calls ctrlJInput() in KatakanaMode when composition is active", async () => {
      engine.adapter.setInputMode(KatakanaMode.getInstance());
      const mode = engine.adapter.getCurrentInputMode();
      const ctrlJSpy = vi.spyOn(mode, "ctrlJInput");

      engine.adapter.setMidashigoStartToCurrentPosition();
      expect(engine.adapter.isInMidashigo()).toBe(true);

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(ctrlJSpy).toHaveBeenCalled();
    });

    it("switches from ZeneiMode to HiraganaMode when idle", async () => {
      engine.adapter.setInputMode(ZeneiMode.getInstance());
      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
    });
  });

  describe("handleKeyDown - Error handling", () => {
    it("catches and logs errors without throwing unhandled rejection", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(engine, "isTargetEditable").mockImplementation(() => {
        throw new Error("Unexpected error during editability check");
      });

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 65,
        key: "a",
      } as any;

      await expect(engine.handleKeyDown(event)).resolves.not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith("[SKK] Keydown error:", expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe("handleKeyDown - Enter pass-through vs intercept", () => {
    let mockInput: any;

    beforeEach(() => {
      mockInput = {
        tagName: "INPUT",
        type: "text",
        readOnly: false,
        disabled: false,
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        setSelectionRange: vi.fn(),
        dispatchEvent: vi.fn(),
        getBoundingClientRect: () => ({ left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 }),
      };
      (globalThis as any).document.activeElement = mockInput;
      engine.adapter.setInputMode(HiraganaMode.getInstance());
    });

    it("passes through Enter when not composing (does NOT call preventDefault)", async () => {
      const mode = engine.adapter.getCurrentInputMode();
      const enterSpy = vi.spyOn(mode, "enterInput");
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const stopImmediatePropagation = vi.fn();

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 13,
        key: "Enter",
        code: "Enter",
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
      } as any;

      await engine.handleKeyDown(event);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(stopPropagation).not.toHaveBeenCalled();
      expect(stopImmediatePropagation).not.toHaveBeenCalled();
      expect(enterSpy).not.toHaveBeenCalled();
    });

    it("intercepts Enter when midashigo composition is active", async () => {
      engine.adapter.setMidashigoStartToCurrentPosition();
      expect(engine.adapter.isInMidashigo()).toBe(true);

      const mode = engine.adapter.getCurrentInputMode();
      const enterSpy = vi.spyOn(mode, "enterInput");
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const stopImmediatePropagation = vi.fn();

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 13,
        key: "Enter",
        code: "Enter",
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
      } as any;

      await engine.handleKeyDown(event);
      expect(preventDefault).toHaveBeenCalled();
      expect(stopPropagation).toHaveBeenCalled();
      expect(stopImmediatePropagation).toHaveBeenCalled();
      expect(enterSpy).toHaveBeenCalled();
    });

    it("intercepts Enter when candidate conversion is active", async () => {
      await engine.adapter.showCandidate(new Candidate("テスト"), "", "");
      expect(engine.adapter.getCurrentCandidate()).toBeDefined();

      const mode = engine.adapter.getCurrentInputMode();
      const enterSpy = vi.spyOn(mode, "enterInput");
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const stopImmediatePropagation = vi.fn();

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 13,
        key: "Enter",
        code: "Enter",
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
      } as any;

      await engine.handleKeyDown(event);
      expect(preventDefault).toHaveBeenCalled();
      expect(stopPropagation).toHaveBeenCalled();
      expect(stopImmediatePropagation).toHaveBeenCalled();
      expect(enterSpy).toHaveBeenCalled();
    });

    it("intercepts Enter when remaining romaji is active", async () => {
      engine.adapter.showRemainingRomaji("k", false, 0);
      expect(engine.adapter.getRemainingRomaji()).toBe("k");

      const mode = engine.adapter.getCurrentInputMode();
      const enterSpy = vi.spyOn(mode, "enterInput");
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const stopImmediatePropagation = vi.fn();

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 13,
        key: "Enter",
        code: "Enter",
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
      } as any;

      await engine.handleKeyDown(event);
      expect(preventDefault).toHaveBeenCalled();
      expect(stopPropagation).toHaveBeenCalled();
      expect(stopImmediatePropagation).toHaveBeenCalled();
      expect(enterSpy).toHaveBeenCalled();
    });
  });

  describe("HUD auto-hide on AsciiMode", () => {
    let mockInput: any;

    beforeEach(() => {
      mockInput = {
        tagName: "INPUT",
        type: "text",
        readOnly: false,
        disabled: false,
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        setSelectionRange: vi.fn(),
        dispatchEvent: vi.fn(),
        getBoundingClientRect: () => ({ left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 }),
      };
      (globalThis as any).document.activeElement = mockInput;
    });

    it("automatically hides HUD when switching to AsciiMode via setInputMode", () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      expect(engine.hud.getVisible()).toBe(true);

      engine.adapter.setInputMode(AsciiMode.getInstance());
      expect(engine.hud.getVisible()).toBe(false);
    });

    it("automatically hides HUD when typing 'l' to switch to AsciiMode", async () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      expect(engine.hud.getVisible()).toBe(true);

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 76,
        key: "l",
        code: "KeyL",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
      expect(engine.hud.getVisible()).toBe(false);
    });

    it("maintains HUD visible when pressing Ctrl+J while idle in HiraganaMode", async () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      expect(engine.hud.getVisible()).toBe(true);

      const event = {
        isTrusted: true,
        isComposing: false,
        keyCode: 74,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        key: "j",
        code: "KeyJ",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as any;

      await engine.handleKeyDown(event);
      expect(engine.adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
      expect(engine.hud.getVisible()).toBe(true);
    });
  });

  describe("enqueueKeyAction - serialized execution without dropping keystrokes", () => {
    it("processes all enqueued keystrokes in order even when composition session resets internally", async () => {
      const mockInput = {
        tagName: "INPUT",
        type: "text",
        readOnly: false,
        disabled: false,
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        setSelectionRange: vi.fn(),
        dispatchEvent: vi.fn(),
        getBoundingClientRect: () => ({ left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 }),
      };
      (globalThis as any).document.activeElement = mockInput;
      engine.adapter.setInputMode(HiraganaMode.getInstance());

      const createKey = (key: string, keyCode: number, code?: string) =>
        ({
          isTrusted: true,
          isComposing: false,
          keyCode,
          key,
          code: code ?? `Key${key.toUpperCase()}`,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          stopImmediatePropagation: vi.fn(),
        } as any);

      // Rapid typing: 'A' (enter midashigo "▽あ"), 'Backspace' (clear midashigo), 'k', 'a'
      const p1 = engine.handleKeyDown(createKey("A", 65));
      const p2 = engine.handleKeyDown(createKey("Backspace", 8, "Backspace"));
      const p3 = engine.handleKeyDown(createKey("k", 75));
      const p4 = engine.handleKeyDown(createKey("a", 65));

      await Promise.all([p1, p2, p3, p4]);

      // 'k' and 'a' must NOT be dropped, resulting in "か" inserted into the document
      expect(mockInput.value).toBe("か");
    });
  });
});
