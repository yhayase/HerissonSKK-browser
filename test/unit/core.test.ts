import { describe, it, expect, vi } from 'vitest';
import { CompositeMap } from '../../src/core/composite-map';
import { Candidate } from '../../src/core/skk/jisyo/candidate';
import { Entry } from '../../src/core/skk/jisyo/entry';
import type { IJisyoProvider } from '../../src/core/skk/jisyo/IJisyoProvider';
import { normalizeVscodeKey, getActiveKeyContext } from '../../src/core/util/keyUtils';

describe('CompositeMap', () => {
    it('throws error when created with empty maps array', () => {
        expect(() => new CompositeMap([])).toThrow('maps must not be empty');
    });

    it('retrieves values from the first map or falls back to subsequent maps', () => {
        const map1 = new Map<string, number>([['a', 1], ['b', 2]]);
        const map2 = new Map<string, number>([['b', 20], ['c', 30]]);
        const composite = new CompositeMap([map1, map2]);

        expect(composite.get('a')).toBe(1);
        expect(composite.get('b')).toBe(2); // Map1 takes precedence
        expect(composite.get('c')).toBe(30); // Found in Map2
        expect(composite.get('d')).toBeUndefined();
    });

    it('sets values into the first map', () => {
        const map1 = new Map<string, number>();
        const map2 = new Map<string, number>([['a', 10]]);
        const composite = new CompositeMap([map1, map2]);

        composite.set('a', 100);
        expect(composite.get('a')).toBe(100);
        expect(map1.get('a')).toBe(100);
        expect(map2.get('a')).toBe(10); // Untouched in map2
    });

    it('checks key existence across maps with has()', () => {
        const map1 = new Map<string, number>([['x', 1]]);
        const map2 = new Map<string, number>([['y', 2]]);
        const composite = new CompositeMap([map1, map2]);

        expect(composite.has('x')).toBe(true);
        expect(composite.has('y')).toBe(true);
        expect(composite.has('z')).toBe(false);
    });

    it('deletes from the first map with deleteFromFirst()', () => {
        const map1 = new Map<string, number>([['x', 1]]);
        const map2 = new Map<string, number>([['x', 2]]);
        const composite = new CompositeMap([map1, map2]);

        expect(composite.deleteFromFirst('x')).toBe(true);
        expect(map1.has('x')).toBe(false);
        expect(composite.get('x')).toBe(2); // Now falls back to map2
    });

    it('calculates size without duplicate keys', () => {
        const map1 = new Map<string, number>([['a', 1], ['b', 2]]);
        const map2 = new Map<string, number>([['b', 20], ['c', 30]]);
        const composite = new CompositeMap([map1, map2]);

        expect(composite.size).toBe(3);
    });

    it('iterates entries, keys, and values correctly', () => {
        const map1 = new Map<string, string>([['k1', 'v1']]);
        const map2 = new Map<string, string>([['k1', 'dup'], ['k2', 'v2']]);
        const composite = new CompositeMap([map1, map2]);

        expect(Array.from(composite.entries())).toEqual([['k1', 'v1'], ['k2', 'v2']]);
        expect(Array.from(composite.keys())).toEqual(['k1', 'k2']);
        expect(Array.from(composite.values())).toEqual(['v1', 'v2']);
        expect(Array.from(composite)).toEqual([['k1', 'v1'], ['k2', 'v2']]);
    });

    it('calls forEach with each unique entry', () => {
        const map1 = new Map<string, number>([['a', 1]]);
        const map2 = new Map<string, number>([['a', 10], ['b', 2]]);
        const composite = new CompositeMap([map1, map2]);

        const collected: [string, number][] = [];
        composite.forEach((val, key) => {
            collected.push([key, val]);
        });

        expect(collected).toEqual([['a', 1], ['b', 2]]);
    });
});

describe('Candidate & Entry', () => {
    it('initializes Candidate with word and optional annotation', () => {
        const c1 = new Candidate('東京');
        expect(c1.word).toBe('東京');
        expect(c1.annotation).toBeUndefined();

        const c2 = new Candidate('東経', 'とうけい');
        expect(c2.word).toBe('東経');
        expect(c2.annotation).toBe('とうけい');
    });

    it('notifies jisyoProvider when candidate is selected at index > 0', () => {
        const mockProvider: IJisyoProvider = {
            lookupCandidates: vi.fn(),
            registerCandidate: vi.fn(),
            reorderCandidate: vi.fn().mockResolvedValue(true),
            deleteCandidate: vi.fn(),
        };

        const candidates = [new Candidate('東京'), new Candidate('とうきょう')];
        const entry = new Entry('とうきょう', candidates, '');

        // Index 0: no reordering needed
        entry.onCandidateSelected(mockProvider, 0);
        expect(mockProvider.reorderCandidate).not.toHaveBeenCalled();

        // Index 1: calls reorderCandidate
        entry.onCandidateSelected(mockProvider, 1);
        expect(mockProvider.reorderCandidate).toHaveBeenCalledWith('とうきょう', 1);
    });

    it('handles reorderCandidate rejection gracefully without unhandled promise rejection', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mockProvider: IJisyoProvider = {
            lookupCandidates: vi.fn(),
            registerCandidate: vi.fn(),
            reorderCandidate: vi.fn().mockRejectedValue(new Error('IndexedDB error')),
            deleteCandidate: vi.fn(),
        };

        const candidates = [new Candidate('東京'), new Candidate('とうきょう')];
        const entry = new Entry('とうきょう', candidates, '');

        entry.onCandidateSelected(mockProvider, 1);
        await Promise.resolve();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to reorder candidate for "とうきょう":',
            expect.any(Error)
        );
        consoleErrorSpy.mockRestore();
    });
});

describe('keyUtils', () => {
    describe('normalizeVscodeKey', () => {
        it('normalizes uppercase and modifier orders', () => {
            expect(normalizeVscodeKey('Shift+A')).toBe('shift+a');
            expect(normalizeVscodeKey('CTRL+J')).toBe('ctrl+j');
            expect(normalizeVscodeKey('Space')).toBe('space');
            expect(normalizeVscodeKey('ESCAPE')).toBe('escape');
            expect(normalizeVscodeKey('alt+ctrl+shift+x')).toBe('ctrl+shift+alt+x');
            expect(normalizeVscodeKey('a')).toBe('a');
        });
    });

    describe('getActiveKeyContext', () => {
        it('maps special keys and symbols to context names', () => {
            expect(getActiveKeyContext('space')).toBe('skk.activeKey.space');
            expect(getActiveKeyContext(' ')).toBe('skk.activeKey.space');
            expect(getActiveKeyContext('.')).toBe('skk.activeKey.dot');
            expect(getActiveKeyContext(',')).toBe('skk.activeKey.comma');
            expect(getActiveKeyContext('/')).toBe('skk.activeKey.slash');
            expect(getActiveKeyContext('-')).toBe('skk.activeKey.hyphen');
            expect(getActiveKeyContext('5')).toBe('skk.activeKey.num5');
            expect(getActiveKeyContext('ctrl+j')).toBe('skk.activeKey.ctrl_j');
            expect(getActiveKeyContext('shift+a')).toBe('skk.activeKey.shift_a');
            expect(getActiveKeyContext('escape')).toBe('skk.activeKey.escape');
            expect(getActiveKeyContext('_')).toBe('skk.activeKey.underscore');
            expect(getActiveKeyContext('{')).toBe('skk.activeKey.open_brace');
            expect(getActiveKeyContext('}')).toBe('skk.activeKey.close_brace');
            expect(getActiveKeyContext('|')).toBe('skk.activeKey.pipe');
        });
    });
});
