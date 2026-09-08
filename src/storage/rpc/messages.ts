import type { IUserJisyoSyncEvent } from "../../core/skk/jisyo/CompositeJisyoProvider";

export interface CandidateData {
    word: string;
    annotation?: string;
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
