import {
    iterateJsonJisyoEntries,
    parseJsonJisyo,
    type JsonJisyoSection,
} from "../../src/core/skk/jisyo/JsonJisyoParser";

type StoredCandidate = { word: string; annotation?: string };
type StoredRecord = { key: string; candidates: StoredCandidate[] };
type Layout = "single" | "split";

interface BenchmarkConfig {
    datasetId: "S" | "L";
    datasetUrl: string;
    runs: number;
    exactQueries: number;
    prefixQueries: number;
    warmupRounds: number;
    measuredRounds: number;
    prefixLimit: number;
    batchSize: number;
}

interface ParsedRecords {
    unified: StoredRecord[];
    okuriAri: StoredRecord[];
    okuriNasi: StoredRecord[];
    parseMs: number;
}

interface MemorySnapshot {
    measureUserAgentSpecificMemory?: { bytes?: number; error?: string };
    chromiumPerformanceMemory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
    };
}

interface LayoutRun {
    run: number;
    layout: Layout;
    importedRecords: number;
    importMs: number;
    storageEstimateDeltaBytes?: number;
    exactColdMs: number[];
    exactWarmMs: number[];
    prefixColdMs: number[];
    prefixWarmMs: number[];
    prefixColdRecordsRead: number[];
    prefixWarmRecordsRead: number[];
    memoryAfterQueries: MemorySnapshot;
}

interface BenchmarkWindow extends Window {
    runDictionaryBenchmark?: (config: BenchmarkConfig) => Promise<unknown>;
    __dictionaryBenchmarkReady?: boolean;
}

const STORE_SINGLE = "system_jisyo";
const STORE_OKURI_ARI = "okuri_ari";
const STORE_OKURI_NASI = "okuri_nasi";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
}

function openDatabase(name: string, layout: Layout): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (layout === "single") {
                database.createObjectStore(STORE_SINGLE, { keyPath: "key" });
            } else {
                database.createObjectStore(STORE_OKURI_ARI, { keyPath: "key" });
                database.createObjectStore(STORE_OKURI_NASI, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB database open failed"));
        request.onblocked = () => reject(new Error("IndexedDB database open was blocked"));
    });
}

function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("IndexedDB database delete failed"));
        request.onblocked = () => reject(new Error("IndexedDB database delete was blocked"));
    });
}

function prefixRange(prefix: string): IDBKeyRange | undefined {
    if (prefix.length === 0) return undefined;
    const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
    if (lastCodeUnit < 0xffff) {
        const upper = prefix.slice(0, -1) + String.fromCharCode(lastCodeUnit + 1);
        return IDBKeyRange.bound(prefix, upper, false, true);
    }
    return IDBKeyRange.lowerBound(prefix, false);
}

async function importBatch(database: IDBDatabase, storeName: string, records: StoredRecord[]): Promise<void> {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const record of records) store.put(record);
    await transactionComplete(transaction);
}

async function importRecords(
    database: IDBDatabase,
    layout: Layout,
    parsed: ParsedRecords,
    batchSize: number,
): Promise<number> {
    const sections: Array<[string, StoredRecord[]]> = layout === "single"
        ? [[STORE_SINGLE, parsed.unified]]
        : [[STORE_OKURI_ARI, parsed.okuriAri], [STORE_OKURI_NASI, parsed.okuriNasi]];
    let count = 0;
    for (const [storeName, records] of sections) {
        for (let offset = 0; offset < records.length; offset += batchSize) {
            const batch = records.slice(offset, offset + batchSize);
            await importBatch(database, storeName, batch);
            count += batch.length;
        }
    }
    return count;
}

async function exactLookup(database: IDBDatabase, layout: Layout, key: string): Promise<StoredRecord | undefined> {
    if (layout === "single") {
        const transaction = database.transaction(STORE_SINGLE, "readonly");
        return requestResult(transaction.objectStore(STORE_SINGLE).get(key)) as Promise<StoredRecord | undefined>;
    }

    const transaction = database.transaction([STORE_OKURI_ARI, STORE_OKURI_NASI], "readonly");
    const [okuriAri, okuriNasi] = await Promise.all([
        requestResult(transaction.objectStore(STORE_OKURI_ARI).get(key)) as Promise<StoredRecord | undefined>,
        requestResult(transaction.objectStore(STORE_OKURI_NASI).get(key)) as Promise<StoredRecord | undefined>,
    ]);
    if (okuriAri && okuriNasi && JSON.stringify(okuriAri) !== JSON.stringify(okuriNasi)) {
        throw new Error("Split stores returned conflicting records for one key");
    }
    return okuriAri ?? okuriNasi;
}

function mergeRecords(left: StoredRecord[], right: StoredRecord[], limit: number): StoredRecord[] {
    const result: StoredRecord[] = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (result.length < limit && (leftIndex < left.length || rightIndex < right.length)) {
        if (leftIndex >= left.length) {
            result.push(right[rightIndex++]!);
        } else if (rightIndex >= right.length) {
            result.push(left[leftIndex++]!);
        } else if (indexedDB.cmp(left[leftIndex]!.key, right[rightIndex]!.key) <= 0) {
            result.push(left[leftIndex++]!);
        } else {
            result.push(right[rightIndex++]!);
        }
    }
    return result;
}

async function prefixLookup(
    database: IDBDatabase,
    layout: Layout,
    prefix: string,
    limit: number,
): Promise<{ value: StoredRecord[]; recordsRead: number }> {
    const range = prefixRange(prefix);
    if (layout === "single") {
        const transaction = database.transaction(STORE_SINGLE, "readonly");
        const records = await requestResult(transaction.objectStore(STORE_SINGLE).getAll(range, limit)) as StoredRecord[];
        return { value: records.filter((record) => record.key.startsWith(prefix)), recordsRead: records.length };
    }

    const transaction = database.transaction([STORE_OKURI_ARI, STORE_OKURI_NASI], "readonly");
    const [okuriAri, okuriNasi] = await Promise.all([
        requestResult(transaction.objectStore(STORE_OKURI_ARI).getAll(range, limit)) as Promise<StoredRecord[]>,
        requestResult(transaction.objectStore(STORE_OKURI_NASI).getAll(range, limit)) as Promise<StoredRecord[]>,
    ]);
    const filteredAri = okuriAri.filter((record) => record.key.startsWith(prefix));
    const filteredNasi = okuriNasi.filter((record) => record.key.startsWith(prefix));
    return {
        value: mergeRecords(filteredAri, filteredNasi, limit),
        recordsRead: okuriAri.length + okuriNasi.length,
    };
}

async function verifyEquivalent(
    single: IDBDatabase,
    split: IDBDatabase,
    exactKeys: string[],
    prefixes: string[],
    limit: number,
): Promise<void> {
    for (const key of exactKeys) {
        const [a, b] = await Promise.all([exactLookup(single, "single", key), exactLookup(split, "split", key)]);
        if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
            throw new Error(`Exact lookup mismatch for ${JSON.stringify(key)}`);
        }
    }
    for (const prefix of prefixes) {
        const [a, b] = await Promise.all([
            prefixLookup(single, "single", prefix, limit),
            prefixLookup(split, "split", prefix, limit),
        ]);
        if (JSON.stringify(a.value) !== JSON.stringify(b.value)) {
            throw new Error(`Prefix lookup mismatch for ${JSON.stringify(prefix)}`);
        }
    }
}

function evenlySpaced<T>(items: T[], count: number): T[] {
    if (count <= 0 || items.length === 0) return [];
    if (count >= items.length) return [...items];
    return Array.from({ length: count }, (_, index) => items[Math.floor(index * items.length / count)]!);
}

function unique(items: string[]): string[] {
    return [...new Set(items)];
}

function buildExactQueries(parsed: ParsedRecords, count: number): string[] {
    const ambiguousNasi = parsed.okuriNasi
        .filter((record) => /[a-z]$/.test(record.key))
        .slice(0, Math.min(8, count))
        .map((record) => record.key);
    const hitCount = Math.max(1, Math.floor(count * 0.8));
    const ordinaryHits = evenlySpaced(parsed.unified, Math.max(0, hitCount - ambiguousNasi.length))
        .map((record) => record.key);
    const hits = unique([...ambiguousNasi, ...ordinaryHits]).slice(0, hitCount);
    const missSeeds = evenlySpaced(parsed.unified, Math.max(0, count - hits.length));
    const misses = missSeeds.map((record, index) => `${record.key}\u{10ffff}benchmark-miss-${index}`);
    return [...hits, ...misses];
}

function buildPrefixQueries(records: StoredRecord[], count: number): string[] {
    return evenlySpaced(records, Math.min(count, records.length)).map((record, index) => {
        const maxLength = Math.min(4, record.key.length);
        return record.key.slice(0, 1 + index % maxLength);
    });
}

function parseRecords(text: string): ParsedRecords {
    const start = performance.now();
    const document = parseJsonJisyo(text);
    const okuriAri: StoredRecord[] = [];
    const okuriNasi: StoredRecord[] = [];
    for (const entry of iterateJsonJisyoEntries(document)) {
        const record: StoredRecord = {
            key: entry.key,
            candidates: entry.candidates.map((candidate) => ({
                word: candidate.word,
                ...(candidate.annotation ? { annotation: candidate.annotation } : {}),
            })),
        };
        (entry.section === "okuri_ari" ? okuriAri : okuriNasi).push(record);
    }
    okuriAri.sort((a, b) => indexedDB.cmp(a.key, b.key));
    okuriNasi.sort((a, b) => indexedDB.cmp(a.key, b.key));
    const unified = [...okuriAri, ...okuriNasi].sort((a, b) => indexedDB.cmp(a.key, b.key));
    return { unified, okuriAri, okuriNasi, parseMs: performance.now() - start };
}

function serializeRepresentation(parsed: ParsedRecords, order: Layout[]) {
    const result = {
        order: [...order],
        singleMs: 0,
        splitMs: 0,
        singleBytes: 0,
        splitBytes: 0,
    };
    for (const layout of order) {
        const start = performance.now();
        const serialized = layout === "single"
            ? JSON.stringify(parsed.unified)
            : JSON.stringify({ okuri_ari: parsed.okuriAri, okuri_nasi: parsed.okuriNasi });
        const elapsed = performance.now() - start;
        if (layout === "single") {
            result.singleMs = elapsed;
            result.singleBytes = new Blob([serialized]).size;
        } else {
            result.splitMs = elapsed;
            result.splitBytes = new Blob([serialized]).size;
        }
    }
    return result;
}

async function memorySnapshot(): Promise<MemorySnapshot> {
    const snapshot: MemorySnapshot = {};
    const extended = performance as Performance & {
        measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    };
    if (extended.measureUserAgentSpecificMemory) {
        try {
            snapshot.measureUserAgentSpecificMemory = {
                bytes: (await extended.measureUserAgentSpecificMemory()).bytes,
            };
        } catch (error) {
            snapshot.measureUserAgentSpecificMemory = {
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    if (extended.memory) {
        snapshot.chromiumPerformanceMemory = {
            usedJSHeapSize: extended.memory.usedJSHeapSize,
            totalJSHeapSize: extended.memory.totalJSHeapSize,
            jsHeapSizeLimit: extended.memory.jsHeapSizeLimit,
        };
    }
    return snapshot;
}

async function storageUsage(): Promise<number | undefined> {
    if (!navigator.storage?.estimate) return undefined;
    return (await navigator.storage.estimate()).usage;
}

async function timeExactBatch(database: IDBDatabase, layout: Layout, keys: string[]): Promise<number[]> {
    const samples: number[] = [];
    for (const key of keys) {
        const start = performance.now();
        await exactLookup(database, layout, key);
        samples.push(performance.now() - start);
    }
    return samples;
}

async function timePrefixBatch(
    database: IDBDatabase,
    layout: Layout,
    prefixes: string[],
    limit: number,
): Promise<{ times: number[]; recordsRead: number[] }> {
    const times: number[] = [];
    const recordsRead: number[] = [];
    for (const prefix of prefixes) {
        const start = performance.now();
        const result = await prefixLookup(database, layout, prefix, limit);
        times.push(performance.now() - start);
        recordsRead.push(result.recordsRead);
    }
    return { times, recordsRead };
}

async function runQueries(
    database: IDBDatabase,
    layout: Layout,
    exactKeys: string[],
    prefixes: string[],
    config: BenchmarkConfig,
) {
    const exactColdMs = await timeExactBatch(database, layout, exactKeys);
    const prefixCold = await timePrefixBatch(database, layout, prefixes, config.prefixLimit);
    for (let round = 0; round < config.warmupRounds; round += 1) {
        await timeExactBatch(database, layout, exactKeys);
        await timePrefixBatch(database, layout, prefixes, config.prefixLimit);
    }
    const exactWarmMs: number[] = [];
    const prefixWarmMs: number[] = [];
    const prefixWarmRecordsRead: number[] = [];
    for (let round = 0; round < config.measuredRounds; round += 1) {
        exactWarmMs.push(...await timeExactBatch(database, layout, exactKeys));
        const prefix = await timePrefixBatch(database, layout, prefixes, config.prefixLimit);
        prefixWarmMs.push(...prefix.times);
        prefixWarmRecordsRead.push(...prefix.recordsRead);
    }
    return {
        exactColdMs,
        exactWarmMs,
        prefixColdMs: prefixCold.times,
        prefixWarmMs,
        prefixColdRecordsRead: prefixCold.recordsRead,
        prefixWarmRecordsRead,
    };
}

async function prepareLayout(
    databaseName: string,
    layout: Layout,
    parsed: ParsedRecords,
    config: BenchmarkConfig,
) {
    await deleteDatabase(databaseName);
    const storageBefore = await storageUsage();
    const database = await openDatabase(databaseName, layout);
    const start = performance.now();
    const importedRecords = await importRecords(database, layout, parsed, config.batchSize);
    const importMs = performance.now() - start;
    database.close();
    const storageAfter = await storageUsage();
    return {
        database: await openDatabase(databaseName, layout),
        importedRecords,
        importMs,
        ...(storageBefore !== undefined && storageAfter !== undefined
            ? { storageEstimateDeltaBytes: storageAfter - storageBefore }
            : {}),
    };
}

function percentile(values: number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}

function summary(values: number[]) {
    if (values.length === 0) return { count: 0, min: null, median: null, p95: null, max: null };
    return {
        count: values.length,
        min: Math.min(...values),
        median: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        max: Math.max(...values),
    };
}

function summarizeLayoutRuns(runs: LayoutRun[]) {
    return {
        importMs: summary(runs.map((run) => run.importMs)),
        storageEstimateDeltaBytes: summary(runs.flatMap((run) =>
            run.storageEstimateDeltaBytes === undefined ? [] : [run.storageEstimateDeltaBytes])),
        exactColdMs: summary(runs.flatMap((run) => run.exactColdMs)),
        exactWarmMs: summary(runs.flatMap((run) => run.exactWarmMs)),
        prefixColdMs: summary(runs.flatMap((run) => run.prefixColdMs)),
        prefixWarmMs: summary(runs.flatMap((run) => run.prefixWarmMs)),
        prefixColdRecordsRead: summary(runs.flatMap((run) => run.prefixColdRecordsRead)),
        prefixWarmRecordsRead: summary(runs.flatMap((run) => run.prefixWarmRecordsRead)),
    };
}

function numericMedian(values: number[]): number {
    return percentile(values, 0.5) ?? Number.NaN;
}

function ratioRange(singleRuns: LayoutRun[], splitRuns: LayoutRun[], select: (run: LayoutRun) => number) {
    const ratios = singleRuns.map((single, index) => select(splitRuns[index]!) / select(single));
    return { ...summary(ratios), values: ratios };
}

async function runDictionaryBenchmark(config: BenchmarkConfig) {
    const response = await fetch(config.datasetUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dictionary fetch failed: HTTP ${response.status}`);
    const sourceText = await response.text();
    const parseSamples: number[] = [];
    const serializationSingleMs: number[] = [];
    const serializationSplitMs: number[] = [];
    const serializationSingleBytes: number[] = [];
    const serializationSplitBytes: number[] = [];
    const serializationRuns: Array<ReturnType<typeof serializeRepresentation> & { run: number }> = [];
    const singleRuns: LayoutRun[] = [];
    const splitRuns: LayoutRun[] = [];
    const memoryBefore = await memorySnapshot();

    for (let run = 0; run < config.runs; run += 1) {
        const parsed = parseRecords(sourceText);
        parseSamples.push(parsed.parseMs);
        const serializationOrder: Layout[] = run % 2 === 0 ? ["single", "split"] : ["split", "single"];
        const serialized = serializeRepresentation(parsed, serializationOrder);
        serializationRuns.push({ run, ...serialized });
        serializationSingleMs.push(serialized.singleMs);
        serializationSplitMs.push(serialized.splitMs);
        serializationSingleBytes.push(serialized.singleBytes);
        serializationSplitBytes.push(serialized.splitBytes);
        const exactKeys = buildExactQueries(parsed, config.exactQueries);
        const prefixes = buildPrefixQueries(parsed.unified, config.prefixQueries);
        const names = {
            single: `skk_dictionary_benchmark_${config.datasetId}_${run}_single`,
            split: `skk_dictionary_benchmark_${config.datasetId}_${run}_split`,
        };
        const prepared = new Map<Layout, Awaited<ReturnType<typeof prepareLayout>>>();
        const layoutOrder: Layout[] = run % 2 === 0 ? ["single", "split"] : ["split", "single"];
        try {
            for (const layout of layoutOrder) {
                prepared.set(layout, await prepareLayout(names[layout], layout, parsed, config));
            }
            await verifyEquivalent(
                prepared.get("single")!.database,
                prepared.get("split")!.database,
                exactKeys,
                prefixes,
                config.prefixLimit,
            );
            for (const item of prepared.values()) item.database.close();

            for (const layout of layoutOrder) {
                const previous = prepared.get(layout)!;
                const database = await openDatabase(names[layout], layout);
                const queries = await runQueries(database, layout, exactKeys, prefixes, config);
                const result: LayoutRun = {
                    run,
                    layout,
                    importedRecords: previous.importedRecords,
                    importMs: previous.importMs,
                    storageEstimateDeltaBytes: previous.storageEstimateDeltaBytes,
                    ...queries,
                    memoryAfterQueries: await memorySnapshot(),
                };
                database.close();
                (layout === "single" ? singleRuns : splitRuns).push(result);
            }
        } finally {
            for (const item of prepared.values()) item.database.close();
            await deleteDatabase(names.single);
            await deleteDatabase(names.split);
        }
    }

    singleRuns.sort((a, b) => a.run - b.run);
    splitRuns.sort((a, b) => a.run - b.run);
    const exactRatio = ratioRange(singleRuns, splitRuns, (run) => numericMedian(run.exactWarmMs));
    const prefixRatio = ratioRange(singleRuns, splitRuns, (run) => numericMedian(run.prefixWarmMs));
    const importRatio = ratioRange(singleRuns, splitRuns, (run) => run.importMs);
    const splitConsistentlyFaster = [exactRatio, prefixRatio, importRatio]
        .every((metric) => metric.max !== null && metric.max < 1);

    return {
        schemaVersion: 1,
        datasetId: config.datasetId,
        config,
        repetitionIsolation: {
            database: "反復ごとに新規データベースを作成して削除します。",
            browser: "同じブラウザープロセスと一時プロファイル内で反復し、ブラウザー内部キャッシュは共有します。",
        },
        environment: {
            userAgent: navigator.userAgent,
            crossOriginIsolated,
            memoryBefore,
            memoryQualification: {
                measureUserAgentSpecificMemory: "対応ブラウザーで取得できたページ全体の推定値です。IndexedDBのディスク使用量ではありません。",
                chromiumPerformanceMemory: "Chromium固有のJSヒープ概算値です。GC時点を固定していないため、実行間の参考値です。",
            },
        },
        sourceBytes: new Blob([sourceText]).size,
        entryCounts: {
            unified: singleRuns[0]?.importedRecords ?? 0,
        },
        equivalence: {
            verifiedBeforeTiming: true,
            exactQueries: config.exactQueries,
            ambiguousOkuriNasiKeysIncluded: true,
            prefixQueries: config.prefixQueries,
            prefixLimit: config.prefixLimit,
        },
        parsing: summary(parseSamples),
        serialization: {
            singleMs: summary(serializationSingleMs),
            splitMs: summary(serializationSplitMs),
            singleBytes: summary(serializationSingleBytes),
            splitBytes: summary(serializationSplitBytes),
            runs: serializationRuns,
            qualification: "直前計測の影響を均すため、反復ごとにsingle/splitの実行順を交互にしています。",
        },
        layouts: {
            single: summarizeLayoutRuns(singleRuns),
            split: summarizeLayoutRuns(splitRuns),
        },
        pairedRatiosSplitOverSingle: {
            exactWarmMedian: exactRatio,
            prefixWarmMedian: prefixRatio,
            import: importRatio,
            qualification: "各反復のB/A比の範囲です。信頼区間ではありません。1未満はBが速いことを表します。",
        },
        storageLayoutAssessment: {
            recommendation: splitConsistentlyFaster ? "split" : "single",
            rule: "exact、prefix、importのB/A比が全反復で1未満の場合だけBを選び、それ以外はAを選びます。",
        },
        rawRuns: {
            single: singleRuns,
            split: splitRuns,
        },
    };
}

const benchmarkWindow = window as BenchmarkWindow;
benchmarkWindow.runDictionaryBenchmark = runDictionaryBenchmark;
benchmarkWindow.__dictionaryBenchmarkReady = true;
