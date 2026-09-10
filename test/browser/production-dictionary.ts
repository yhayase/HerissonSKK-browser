import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { CompositeJisyoProvider } from "../../src/core/skk/jisyo/CompositeJisyoProvider";
import { iterateJsonJisyoEntries, parseJsonJisyo } from "../../src/core/skk/jisyo/JsonJisyoParser";
import type { JisyoEntry } from "../../src/core/skk/jisyo/JisyoParser";
import { DictionaryLoader, type DictionaryDefinition } from "../../src/storage/jisyo/DictionaryLoader";
import { IndexedDbJisyoStore } from "../../src/storage/jisyo/IndexedDbJisyoStore";
import { IndexedDbUserStore } from "../../src/storage/user-jisyo/IndexedDbUserStore";
import { IndexedDbJisyoStore as BaselineV3Store } from "./baseline-v3-indexeddb-jisyo-store";

interface VerificationConfig {
    fixtureBaseUrl: string;
    officialDictionaryPath: string;
    exactQueries: number;
    prefixQueries: number;
    measuredRounds: number;
    prefixLimit: number;
    batchSize: number;
}

interface CandidateView {
    word: string;
    annotation?: string;
}

declare global {
    interface Window {
        __productionDictionaryReady?: boolean;
        runProductionDictionaryVerification?: (config: VerificationConfig) => Promise<unknown>;
    }
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function candidates(entry: Awaited<ReturnType<IndexedDbJisyoStore["lookup"]>>): CandidateView[] {
    return entry?.getCandidateList().map((candidate) => ({
        word: candidate.word,
        ...(candidate.annotation ? { annotation: candidate.annotation } : {}),
    })) ?? [];
}

function prefixResults(
    entries: Awaited<ReturnType<IndexedDbJisyoStore["lookupPrefix"]>>,
): Array<{ key: string; candidates: CandidateView[] }> {
    return entries.map((entry) => ({
        key: entry.getMidashigo(),
        candidates: candidates(entry),
    }));
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    assert(actualJson === expectedJson, `${message}: expected ${expectedJson}, received ${actualJson}`);
}

function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${name}`));
        request.onblocked = () => reject(new Error(`Database deletion was blocked: ${name}`));
    });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
}

async function seedLegacyDatabase(name: string, version: 1 | 2 | 3, completed = true): Promise<void> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore("system_jisyo", { keyPath: "key" });
            if (version >= 2) db.createObjectStore("user_jisyo", { keyPath: "key" });
            if (version >= 3) db.createObjectStore("system_metadata", { keyPath: "dictId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Failed to seed v${version} database`));
    });
    const stores = ["system_jisyo"];
    if (version >= 2) stores.push("user_jisyo");
    if (version >= 3) stores.push("system_metadata");
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore("system_jisyo").put({
        key: "れがしー",
        candidates: [{ word: "旧候補", annotation: "旧注釈" }],
    });
    if (version >= 2) {
        transaction.objectStore("user_jisyo").put({
            key: "がくしゅう",
            candidates: [
                { word: "第二候補", annotation: "二" },
                { word: "第一候補", annotation: "一" },
            ],
            updatedAt: 12345,
        });
    }
    if (version >= 3) {
        transaction.objectStore("system_metadata").put({
            dictId: "dict/SKK-JISYO.S",
            version: "1.0.0",
            completed,
            entryCount: 1,
            timestamp: 12345,
        });
    }
    await transactionComplete(transaction);
    database.close();
}

function definition(dictId: string, path: string, version: string, format: "json" | "text"): DictionaryDefinition {
    return { dictId, dictPath: path, version, format };
}

async function verifyMixedDictionaries(config: VerificationConfig, databaseNames: string[]): Promise<unknown> {
    const databaseName = `phase31-mixed-${crypto.randomUUID()}`;
    databaseNames.push(databaseName);
    const definitionsV1 = [
        definition("json-primary", `${config.fixtureBaseUrl}/dictionary-primary-v1.json`, "1", "json"),
        definition("text-secondary", `${config.fixtureBaseUrl}/dictionary-secondary.txt`, "1", "text"),
    ] as const;
    let systemStore = new IndexedDbJisyoStore({
        dbName: databaseName,
        dictionaryIds: definitionsV1.map(({ dictId }) => dictId),
    });
    let userStore = new IndexedDbUserStore({ dbName: databaseName });
    const progress: Array<{ dictId: string; count: number }> = [];
    const initial = await DictionaryLoader.ensureDictionaries(systemStore, definitionsV1, {
        batchSize: 2,
        onProgress: (dictId, count) => progress.push({ dictId, count }),
    });
    assertJsonEqual(initial.map(({ status }) => status), ["imported", "imported"], "Initial mixed import status");
    assert(progress.some(({ dictId }) => dictId === "json-primary"), "JSON import did not report progress");
    assert(progress.some(({ dictId }) => dictId === "text-secondary"), "Text import did not report progress");
    assertJsonEqual(candidates(await systemStore.lookup("きょうつう")), [
        { word: "JSON先頭" },
        { word: "共通候補" },
        { word: "テキスト候補", annotation: "テキスト注釈" },
    ], "Mixed dictionary priority and deduplication");
    assertJsonEqual(candidates(await systemStore.lookup("てきすと")), [
        { word: "テキスト専用", annotation: "外部注釈" },
    ], "Text annotation retention");

    const provider = new CompositeJisyoProvider(userStore, [systemStore]);
    await provider.init();
    await provider.registerCandidate("きょうつう", new Candidate("学習候補", "ユーザー注釈"));
    assertJsonEqual(candidates(await provider.lookupCandidates("きょうつう")), [
        { word: "学習候補", annotation: "ユーザー注釈" },
        { word: "JSON先頭" },
        { word: "共通候補" },
        { word: "テキスト候補", annotation: "テキスト注釈" },
    ], "User dictionary priority");

    const generationV1 = (await systemStore.getActiveDictionary("json-primary"))?.activeGeneration;
    systemStore.close();
    userStore.close();
    systemStore = new IndexedDbJisyoStore({
        dbName: databaseName,
        dictionaryIds: definitionsV1.map(({ dictId }) => dictId),
    });
    userStore = new IndexedDbUserStore({ dbName: databaseName });
    const reopened = await DictionaryLoader.ensureDictionaries(systemStore, definitionsV1);
    assertJsonEqual(reopened.map(({ status }) => status), ["current", "current"], "Reopen status");
    assert((await userStore.loadUserEntries()).get("きょうつう")?.[0]?.word === "学習候補", "Learning was lost on reopen");

    const definitionsV2 = [
        definition("json-primary", `${config.fixtureBaseUrl}/dictionary-primary-v2.json`, "2", "json"),
        definitionsV1[1],
    ] as const;
    const updated = await DictionaryLoader.ensureDictionaries(systemStore, definitionsV2);
    assertJsonEqual(updated.map(({ status }) => status), ["imported", "current"], "Selective update status");
    const generationV2 = (await systemStore.getActiveDictionary("json-primary"))?.activeGeneration;
    assert(generationV1 !== generationV2, "JSON update did not publish a new generation");
    assert(candidates(await systemStore.lookup("きょうつう"))[0]?.word === "JSON更新", "Updated JSON was not active");

    const failedDefinitions = [
        definition("json-primary", `${config.fixtureBaseUrl}/dictionary-invalid.json`, "3", "json"),
        definitionsV1[1],
    ] as const;
    let failureMessage = "";
    try {
        await DictionaryLoader.ensureDictionaries(systemStore, failedDefinitions);
    } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error);
    }
    assert(failureMessage.length > 0, "Invalid update unexpectedly succeeded");
    assert((await systemStore.getActiveDictionary("json-primary"))?.activeGeneration === generationV2,
        "Failed update replaced the active generation");
    assert(candidates(await systemStore.lookup("きょうつう"))[0]?.word === "JSON更新",
        "Failed update changed lookup results");

    const definitionsV3 = [
        definition("json-primary", `${config.fixtureBaseUrl}/dictionary-primary-v3.json`, "3", "json"),
        definitionsV1[1],
    ] as const;
    await DictionaryLoader.ensureDictionaries(systemStore, definitionsV3);
    assert(candidates(await systemStore.lookup("きょうつう"))[0]?.word === "JSON再試行", "Retry did not publish v3");
    assert((await userStore.loadUserEntries()).get("きょうつう")?.[0]?.word === "学習候補",
        "Dictionary update removed user learning");
    systemStore.close();
    userStore.close();
    return { initial, reopened, updated, failureMessage, generationChanged: generationV1 !== generationV2 };
}

async function verifyMigrations(databaseNames: string[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const version of [1, 2, 3] as const) {
        const name = `phase31-migration-v${version}-${crypto.randomUUID()}`;
        databaseNames.push(name);
        await seedLegacyDatabase(name, version);
        const system = new IndexedDbJisyoStore({ dbName: name });
        const user = new IndexedDbUserStore({ dbName: name });
        await system.init();
        await user.init();
        assertJsonEqual(candidates(await system.lookup("れがしー")), [
            { word: "旧候補", annotation: "旧注釈" },
        ], `v${version} legacy lookup`);
        const learned = (await user.loadUserEntries()).get("がくしゅう") ?? [];
        if (version >= 2) {
            assertJsonEqual(learned.map(({ word, annotation }) => ({ word, annotation })), [
                { word: "第二候補", annotation: "二" },
                { word: "第一候補", annotation: "一" },
            ], `v${version} user migration`);
        } else {
            assert(learned.length === 0, "v1 unexpectedly contained a user store");
        }
        results.push({ version, storage: (await system.getActiveDictionary("skk-jisyo-s"))?.storage, learned: learned.length });
        system.close();
        user.close();
    }

    const incompleteName = `phase31-migration-v3-incomplete-${crypto.randomUUID()}`;
    databaseNames.push(incompleteName);
    await seedLegacyDatabase(incompleteName, 3, false);
    const incomplete = new IndexedDbJisyoStore({ dbName: incompleteName });
    assert(await incomplete.lookup("れがしー") === undefined, "Incomplete v3 import was activated");
    incomplete.close();
    results.push({ version: 3, completed: false, activated: false });
    return results;
}

function percentile(values: number[], ratio: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(values: number[]): { medianMs: number; p95Ms: number } {
    return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

async function measure<T>(action: () => Promise<T>): Promise<{ elapsedMs: number; value: T }> {
    const start = performance.now();
    const value = await action();
    return { elapsedMs: performance.now() - start, value };
}

function sample<T>(values: T[], count: number): T[] {
    const chosen: T[] = [];
    for (let index = 0; index < Math.min(count, values.length); index += 1) {
        chosen.push(values[Math.floor(index * values.length / Math.min(count, values.length))]!);
    }
    return chosen;
}

async function verifyOfficialAndMeasure(config: VerificationConfig, databaseNames: string[]): Promise<unknown> {
    const source = await (await fetch(`/${config.officialDictionaryPath}`)).text();
    const document = parseJsonJisyo(source);
    const records = [...iterateJsonJisyoEntries(document)].filter(({ key, candidates }) => key && candidates.length > 0);
    assert(records.length === 3379, `Official S entry count changed: ${records.length}`);

    const loaderDb = `phase31-official-loader-${crypto.randomUUID()}`;
    databaseNames.push(loaderDb);
    const loaderDefinition = definition("official-json", config.officialDictionaryPath, "official-s-729e562f963e", "json");
    const loaderStore = new IndexedDbJisyoStore({ dbName: loaderDb, dictionaryIds: [loaderDefinition.dictId] });
    const officialLoad = await measure(() => DictionaryLoader.ensureDictionaries(loaderStore, [loaderDefinition], {
        batchSize: config.batchSize,
    }));
    assert(officialLoad.value[0]?.entryCount === 3379, "Official JSON loader count mismatch");
    assert(candidates(await loaderStore.lookup("にほん"))[0]?.word === "日本", "Official JSON conversion lookup failed");
    loaderStore.close();

    const baselineDb = `phase31-baseline-v3-${crypto.randomUUID()}`;
    const currentDb = `phase31-current-v4-${crypto.randomUUID()}`;
    databaseNames.push(baselineDb, currentDb);
    const baseline = new BaselineV3Store({ dbName: baselineDb });
    const current = new IndexedDbJisyoStore({ dbName: currentDb, dictionaryIds: ["official-json"] });
    const baselineImport = await measure(() => baseline.importEntries(records, config.batchSize));
    const generation = `measurement-${crypto.randomUUID()}`;
    const currentImport = await measure(async () => {
        const entryCount = await current.stageGeneration("official-json", generation, records, config.batchSize);
        const published = await current.publishGeneration({
            dictId: "official-json",
            version: "measurement",
            activeGeneration: generation,
            entryCount,
        }, 0);
        assert(published, "Production generation was not published");
        return entryCount;
    });
    assert(baselineImport.value === currentImport.value, "Baseline/current import counts differ");

    const exactKeys = sample(records.map(({ key }) => key), config.exactQueries);
    const prefixKeys = sample([...new Set(records.map(({ key }) => key.slice(0, Math.min(2, key.length))))], config.prefixQueries);
    for (const key of exactKeys) {
        assertJsonEqual(candidates(await current.lookup(key)), candidates(await baseline.lookup(key)), `Exact parity for ${key}`);
    }
    for (const prefix of prefixKeys) {
        const baselineResults = await baseline.lookupPrefix(prefix, config.prefixLimit);
        const currentResults = await current.lookupPrefix(prefix, config.prefixLimit);
        assert(baselineResults.length <= config.prefixLimit, `Baseline prefix limit for ${prefix}`);
        assert(currentResults.length <= config.prefixLimit, `Current prefix limit for ${prefix}`);
        assertJsonEqual(prefixResults(currentResults), prefixResults(baselineResults), `Prefix parity for ${prefix}`);
    }

    const warm = { baselineExact: [] as number[], currentExact: [] as number[], baselinePrefix: [] as number[], currentPrefix: [] as number[] };
    for (let round = 0; round < config.measuredRounds; round += 1) {
        const stores = round % 2 === 0 ? ["baseline", "current"] as const : ["current", "baseline"] as const;
        for (const selected of stores) {
            for (const key of exactKeys) {
                const result = selected === "baseline"
                    ? await measure(() => baseline.lookup(key))
                    : await measure(() => current.lookup(key));
                warm[selected === "baseline" ? "baselineExact" : "currentExact"].push(result.elapsedMs);
            }
            for (const prefix of prefixKeys) {
                const result = selected === "baseline"
                    ? await measure(() => baseline.lookupPrefix(prefix, config.prefixLimit))
                    : await measure(() => current.lookupPrefix(prefix, config.prefixLimit));
                warm[selected === "baseline" ? "baselinePrefix" : "currentPrefix"].push(result.elapsedMs);
            }
        }
    }
    baseline.close();
    current.close();

    const cold = { baselineExact: [] as number[], currentExact: [] as number[], baselinePrefix: [] as number[], currentPrefix: [] as number[] };
    for (const key of exactKeys) {
        const oldStore = new BaselineV3Store({ dbName: baselineDb });
        const oldResult = await measure(() => oldStore.lookup(key));
        oldStore.close();
        cold.baselineExact.push(oldResult.elapsedMs);
        const newStore = new IndexedDbJisyoStore({ dbName: currentDb, dictionaryIds: ["official-json"] });
        const newResult = await measure(() => newStore.lookup(key));
        newStore.close();
        cold.currentExact.push(newResult.elapsedMs);
    }
    for (const prefix of prefixKeys) {
        const oldStore = new BaselineV3Store({ dbName: baselineDb });
        const oldResult = await measure(() => oldStore.lookupPrefix(prefix, config.prefixLimit));
        oldStore.close();
        cold.baselinePrefix.push(oldResult.elapsedMs);
        const newStore = new IndexedDbJisyoStore({ dbName: currentDb, dictionaryIds: ["official-json"] });
        const newResult = await measure(() => newStore.lookupPrefix(prefix, config.prefixLimit));
        newStore.close();
        cold.currentPrefix.push(newResult.elapsedMs);
    }

    return {
        official: { entryCount: records.length, loaderElapsedMs: officialLoad.elapsedMs },
        import: {
            boundary: "解析済みの同一レコードをIndexedDBへ保存し、currentはgenerationのpublishを含みます。",
            baselineV3Ms: baselineImport.elapsedMs,
            currentV4Ms: currentImport.elapsedMs,
        },
        queries: { exactKeys, prefixKeys, prefixLimit: config.prefixLimit },
        warm: { rawMs: warm, summary: Object.fromEntries(Object.entries(warm).map(([key, value]) => [key, summarize(value)])) },
        cold: {
            boundary: "各クエリでproduction storeを新規生成し、DB接続開始から結果生成までを測ります。",
            rawMs: cold,
            summary: Object.fromEntries(Object.entries(cold).map(([key, value]) => [key, summarize(value)])),
        },
    };
}

async function run(config: VerificationConfig): Promise<unknown> {
    const databaseNames: string[] = [];
    try {
        return {
            behavior: await verifyMixedDictionaries(config, databaseNames),
            migrations: await verifyMigrations(databaseNames),
            measurement: await verifyOfficialAndMeasure(config, databaseNames),
        };
    } finally {
        for (const name of databaseNames) await deleteDatabase(name);
    }
}

window.runProductionDictionaryVerification = run;
window.__productionDictionaryReady = true;
