import type { SystemDictionaryDefinition } from "../jisyo/SystemDictionaryConfiguration";
import type { IUserJisyoSyncEvent } from "../../core/skk/jisyo/CompositeJisyoProvider";

export type { CandidateData } from "../../core/skk/jisyo/candidate";
import type { CandidateData } from "../../core/skk/jisyo/candidate";

export interface SystemDictionaryPreview {
    key: string;
    okuri?: string;
    systemCandidates: CandidateData[];
    effectiveCandidates: CandidateData[];
}

export interface EntryData {
    midashigo: string;
    candidates: CandidateData[];
}

export interface RpcResponse<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
}

export type SkkRpcRequest =
    | { type: "SKK_WAIT_READY" }
    | { type: "SKK_SYSTEM_STATUS" }
    | { type: "SKK_SYSTEM_PREVIEW"; key: string; okuri?: string }
    | { type: "SKK_SYSTEM_CONFIGURE"; dictionaries: SystemDictionaryDefinition[] }
    | { type: "SKK_SYSTEM_IMPORT"; dictionary: SystemDictionaryDefinition; bytes: number[] }
    | { type: "SKK_SYSTEM_IMPORT_BEGIN"; dictionary: SystemDictionaryDefinition; size: number }
    | { type: "SKK_SYSTEM_IMPORT_CHUNK"; token: string; offset: number; bytes: number[] }
    | { type: "SKK_SYSTEM_IMPORT_FINISH"; token: string }
    | { type: "SKK_SYSTEM_IMPORT_CANCEL"; token: string }
    | { type: "SKK_SYSTEM_UPDATE"; dictId: string }
    | { type: "SKK_JISYO_LOOKUP"; key: string }
    | { type: "SKK_JISYO_LOOKUP_PREFIX"; prefix: string; limit?: number }
    | { type: "SKK_USER_LOAD" }
    | { type: "SKK_USER_SAVE"; key: string; candidate: CandidateData; senderId?: string }
    | { type: "SKK_USER_REORDER"; key: string; candidate?: CandidateData | string; selectedIndex?: number; senderId?: string }
    | { type: "SKK_USER_DELETE"; key: string; candidate: CandidateData; senderId?: string }
    | { type: "SKK_USER_CLEAR"; senderId?: string }
    | { type: "SKK_USER_SAVE_ENTRIES"; entries: Record<string, CandidateData[]>; senderId?: string }
    | { type: "SKK_USER_SYNC_BROADCAST"; event: IUserJisyoSyncEvent };

export interface SkkUserSyncNotification {
    type: "SKK_USER_SYNC";
    event: IUserJisyoSyncEvent;
}
