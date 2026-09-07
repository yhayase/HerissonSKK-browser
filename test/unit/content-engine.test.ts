import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

let SkkContentEngine: any;

const mockDocument = {
  getElementById: (_id: string) => null,
  createElement: (_tag: string) => ({
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

import type { SkkContentEngine as TSkkContentEngine } from "../../entrypoints/content";

describe("SkkContentEngine verified findings", () => {
  let engine: TSkkContentEngine;

  beforeEach(() => {
    (globalThis as any).document.activeElement = null;
    engine = new SkkContentEngine();
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

  describe("handleKeyDown - IME composition guard", () => {
    it("ignores keydown when e.isComposing is true", async () => {
      const setTargetSpy = vi.spyOn(engine.adapter, "setTargetElement");
      const event = {
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

    it("maintains HiraganaMode when idle upon pressing Ctrl+J", async () => {
      engine.adapter.setInputMode(HiraganaMode.getInstance());
      const event = {
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

    it("switches from KatakanaMode to HiraganaMode when idle (does NOT switch to AsciiMode)", async () => {
      engine.adapter.setInputMode(KatakanaMode.getInstance());
      const event = {
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

    it("calls ctrlJInput() in KatakanaMode when composition is active", async () => {
      engine.adapter.setInputMode(KatakanaMode.getInstance());
      const mode = engine.adapter.getCurrentInputMode();
      const ctrlJSpy = vi.spyOn(mode, "ctrlJInput");

      engine.adapter.setMidashigoStartToCurrentPosition();
      expect(engine.adapter.isInMidashigo()).toBe(true);

      const event = {
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
});
