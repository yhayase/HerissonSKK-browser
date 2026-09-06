import * as wanakana from 'wanakana';
import { FloatingHUD } from '../hud/FloatingHUD';
import { getActiveCaretCoordinates } from '../adapter/CaretPosition';
import { insertText } from '../adapter/TextInserter';

export type InputMode = 'ascii' | 'hiragana' | 'katakana';

const POC_DICTIONARY: Record<string, string[]> = {
  'にほん': ['日本'],
  'とうきょう': ['東京'],
  'かんじ': ['漢字'],
  'へんかん': ['変換'],
  'がっこう': ['学校'],
  'すっく': ['SKK'],
  'てすと': ['テスト'],
  'ぷろじぇくと': ['プロジェクト'],
  'こーど': ['コード'],
  'えでぃた': ['エディタ'],
};

export class PocEngine {
  private mode: InputMode = 'ascii';
  private hud: FloatingHUD;
  private romBuffer: string = '';
  private isMidashigo: boolean = false;
  private candidateIndex: number = -1;
  private candidates: string[] = [];
  private lastInsertedResult: { success: boolean; method: string } | null = null;

  constructor() {
    this.hud = new FloatingHUD();
  }

  public getMode(): InputMode {
    return this.mode;
  }

  public getLastInsertResult() {
    return this.lastInsertedResult;
  }

  public isTargetEditable(el: Element | null): boolean {
    if (!el) return false;

    if (el instanceof HTMLInputElement) {
      const nonTextTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];
      return !nonTextTypes.includes(el.type.toLowerCase());
    }

    if (el instanceof HTMLTextAreaElement) {
      return true;
    }

    if ((el as HTMLElement).isContentEditable) {
      return true;
    }

    // Monaco editor inputarea
    if (el.tagName.toLowerCase() === 'textarea' && el.classList.contains('inputarea')) {
      return true;
    }

    if (el.closest('.monaco-editor')) {
      return true;
    }

    return false;
  }

  public handleKeyDown(e: KeyboardEvent) {
    const target = document.activeElement;

    // Check if target is an editable element
    if (!this.isTargetEditable(target)) {
      if (this.mode !== 'ascii') {
        this.reset();
        this.mode = 'ascii';
        this.hud.hide();
      }
      return;
    }

    // Check for toggle key: Ctrl+j
    if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J' || e.code === 'KeyJ')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (this.mode === 'ascii') {
        this.mode = 'hiragana';
        this.reset();
        this.updateHUD(target);
      } else {
        this.commitPreedit();
        this.mode = 'ascii';
        this.reset();
        this.hud.hide();
      }
      return;
    }

    // If in ASCII mode, pass through all keys
    if (this.mode === 'ascii') {
      return;
    }

    // SKK mode is active. Intercept keys:
    this.processSkkKey(e, target);
  }

  private processSkkKey(e: KeyboardEvent, target: Element | null) {
    // 1. Cancel: Ctrl+g or Escape
    if ((e.ctrlKey && (e.key === 'g' || e.key === 'G')) || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.reset();
      this.updateHUD(target);
      return;
    }

    // 2. Mode toggle: 'q' toggles Hiragana / Katakana if buffer is empty
    if (e.key === 'q' && !e.ctrlKey && !e.altKey && !e.metaKey && this.romBuffer.length === 0) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.mode = this.mode === 'hiragana' ? 'katakana' : 'hiragana';
      this.updateHUD(target);
      return;
    }

    // 3. Mode exit: 'l' returns to ASCII if buffer is empty
    if (e.key === 'l' && !e.ctrlKey && !e.altKey && !e.metaKey && this.romBuffer.length === 0) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.mode = 'ascii';
      this.reset();
      this.hud.hide();
      return;
    }

    // 4. Backspace
    if (e.key === 'Backspace') {
      if (this.candidates.length > 0) {
        // Cancel candidate, return to midashigo
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.candidates = [];
        this.candidateIndex = -1;
        this.updateHUD(target);
        return;
      }

      if (this.romBuffer.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.romBuffer = this.romBuffer.slice(0, -1);
        if (this.romBuffer.length === 0) {
          this.isMidashigo = false;
        }
        this.updateHUD(target);
        return;
      }

      // If buffer is empty, let Backspace pass through to document
      return;
    }

    // 5. Enter: commit
    if (e.key === 'Enter') {
      if (this.candidates.length > 0 && this.candidateIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const cand = this.candidates[this.candidateIndex] || '';
        this.commitText(cand);
        this.reset();
        this.updateHUD(target);
        return;
      }

      if (this.romBuffer.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.commitPreedit();
        this.reset();
        this.updateHUD(target);
        return;
      }

      // Empty buffer: Enter passes through to document
      return;
    }

    // 6. Space: conversion or candidate selection
    if (e.key === ' ' || e.code === 'Space') {
      if (this.candidates.length > 0) {
        // Cycle candidate
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.candidateIndex = (this.candidateIndex + 1) % this.candidates.length;
        this.updateHUD(target);
        return;
      }

      if (this.isMidashigo && this.romBuffer.length > 0) {
        // Start conversion
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const yomi = this.mode === 'katakana' ? wanakana.toKatakana(this.romBuffer) : wanakana.toHiragana(this.romBuffer);
        const dictCandidates = POC_DICTIONARY[yomi] || [yomi];
        this.candidates = dictCandidates;
        this.candidateIndex = 0;
        this.updateHUD(target);
        return;
      }

      if (this.romBuffer.length === 0) {
        // Insert Japanese space (full-width or half-width)
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.commitText('　');
        return;
      }
    }

    // 7. Regular character input
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // If candidates are displayed, typing any non-space key commits candidate first
      if (this.candidates.length > 0 && this.candidateIndex >= 0) {
        const cand = this.candidates[this.candidateIndex] || '';
        this.commitText(cand);
        this.reset();
      }

      const char = e.key;

      // Uppercase letter triggers Midashigo mode
      if (/^[A-Z]$/.test(char)) {
        if (!this.isMidashigo) {
          this.commitPreedit();
          this.reset();
          this.isMidashigo = true;
        }
        this.romBuffer += char.toLowerCase();
      } else {
        this.romBuffer += char;
      }

      // If not in Midashigo mode, check if we formed a complete kana
      if (!this.isMidashigo) {
        const converted = this.toKana(this.romBuffer);
        // If wanakana converted the trailing character to kana (no pending romaji consonant)
        if (!wanakana.isRomaji(converted) && !/[a-z]$/i.test(converted)) {
          this.commitText(converted);
          this.romBuffer = '';
        }
      }

      this.updateHUD(target);
      return;
    }
  }

  private toKana(romaji: string): string {
    const opts = { IMEMode: true as const };
    if (this.mode === 'katakana') {
      return wanakana.toKatakana(romaji, opts);
    }
    return wanakana.toHiragana(romaji, opts);
  }

  private commitPreedit() {
    if (this.romBuffer.length > 0) {
      const text = this.mode === 'katakana' ? wanakana.toKatakana(this.romBuffer) : wanakana.toHiragana(this.romBuffer);
      this.commitText(text);
      this.romBuffer = '';
    }
  }

  private commitText(text: string) {
    if (!text) return;
    this.lastInsertedResult = insertText(text);
  }

  private reset() {
    this.romBuffer = '';
    this.isMidashigo = false;
    this.candidateIndex = -1;
    this.candidates = [];
  }

  public updateHUD(target: Element | null) {
    const coords = getActiveCaretCoordinates(target) || {
      x: 20,
      y: window.innerHeight - 50,
      height: 20,
    };

    const modeName = this.mode === 'hiragana' ? 'かな' : this.mode === 'katakana' ? 'カナ' : '全英';

    let preeditStr = '';
    if (this.isMidashigo) {
      preeditStr = '▽' + this.toKana(this.romBuffer);
    } else if (this.romBuffer.length > 0) {
      preeditStr = this.romBuffer;
    }

    const currentCandidate = this.candidateIndex >= 0 ? this.candidates[this.candidateIndex] : undefined;

    this.hud.update({
      x: coords.x,
      y: coords.y + 4,
      mode: modeName,
      preedit: preeditStr,
      candidate: currentCandidate,
      status: this.lastInsertedResult ? `(${this.lastInsertedResult.method})` : undefined,
    });
  }
}
