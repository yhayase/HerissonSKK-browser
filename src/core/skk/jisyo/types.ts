import type { Candidate } from "./candidate";
import type { JisyoEntry } from "./JisyoParser";
import type { IJisyoStorage, IUserJisyoStorage } from "./IJisyoStorage";

export type Jisyo = Map<string, Candidate[]>;
export type CacheMetadata = { expiry: number };
export type { JisyoEntry, IJisyoStorage, IUserJisyoStorage };

