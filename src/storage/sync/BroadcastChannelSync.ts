import type {
    IUserJisyoSyncNotifier,
    IUserJisyoSyncEvent,
    UserJisyoSyncEventType,
} from "../../core/skk/jisyo/CompositeJisyoProvider";

export type { UserJisyoSyncEventType as UserJisyoSyncMessageType };

/**
 * Message payload sent over the BroadcastChannel.
 */
export interface UserJisyoSyncMessage extends IUserJisyoSyncEvent {
    type: UserJisyoSyncEventType;
    senderId: string;
    key?: string;
    candidate?: { word: string; annotation?: string };
    selectedIndex?: number;
}

export type { IUserJisyoSyncNotifier };

/**
 * Options for configuring BroadcastChannelSync.
 */
export interface BroadcastChannelSyncOptions {
    /**
     * BroadcastChannel channel name. Defaults to "skk_user_jisyo_sync".
     */
    channelName?: string;

    /**
     * Optional custom channel factory (useful for tests or mocking).
     */
    channelFactory?: (name: string) => BroadcastChannel;

    /**
     * Unique identifier for this instance/tab to ignore self-broadcasts.
     */
    senderId?: string;
}

/**
 * Multi-tab synchronization utility using standard BroadcastChannel.
 * Safely ignores self-broadcast messages and falls back gracefully when BroadcastChannel is unavailable.
 */
export class BroadcastChannelSync implements IUserJisyoSyncNotifier {
    private readonly senderId: string;
    private readonly channelName: string;
    private channel: BroadcastChannel | null = null;
    private handlers: Set<(event: IUserJisyoSyncEvent) => void> = new Set();
    private isClosed = false;

    constructor(options?: BroadcastChannelSyncOptions) {
        this.channelName = options?.channelName ?? "skk_user_jisyo_sync";
        this.senderId = options?.senderId ?? this.generateSenderId();

        const hasBroadcastChannel =
            options?.channelFactory !== undefined || typeof BroadcastChannel !== "undefined";

        if (hasBroadcastChannel) {
            try {
                this.channel = options?.channelFactory
                    ? options.channelFactory(this.channelName)
                    : new BroadcastChannel(this.channelName);

                this.channel.onmessage = (event: MessageEvent<UserJisyoSyncMessage>) => {
                    const data = event.data;
                    if (!data || data.senderId === this.senderId) {
                        return; // Ignore self messages
                    }
                    for (const handler of this.handlers) {
                        try {
                            handler(data);
                        } catch (err) {
                            console.error("Error in BroadcastChannelSync listener:", err);
                        }
                    }
                };
            } catch {
                this.channel = null;
            }
        }
    }

    private generateSenderId(): string {
        return (
            Math.random().toString(36).substring(2, 10) +
            "_" +
            Date.now().toString(36)
        );
    }

    /**
     * Returns the unique sender ID of this sync instance.
     */
    public getSenderId(): string {
        return this.senderId;
    }

    /**
     * Whether the channel connection is currently open.
     */
    public get isOpen(): boolean {
        return this.channel !== null && !this.isClosed;
    }

    /**
     * Broadcasts a general mutation event to other tabs.
     */
    public broadcastMutation(event?: IUserJisyoSyncEvent): void {
        if (!this.channel || this.isClosed) {
            return;
        }

        const msg: UserJisyoSyncMessage = {
            type: event?.type ?? "MUTATED",
            senderId: this.senderId,
            ...(event?.key ? { key: event.key } : {}),
            ...(event?.candidate ? { candidate: event.candidate } : {}),
            ...(event?.selectedIndex !== undefined ? { selectedIndex: event.selectedIndex } : {}),
        };

        try {
            this.channel.postMessage(msg);
        } catch (err) {
            console.warn("Failed to broadcast message:", err);
        }
    }

    /**
     * Broadcasts that a candidate was saved / registered.
     */
    public broadcastCandidateSaved(key: string, candidate: { word: string; annotation?: string }): void {
        this.broadcastMutation({
            type: "CANDIDATE_SAVED",
            key,
            candidate,
        });
    }

    /**
     * Broadcasts that a candidate was reordered.
     */
    public broadcastCandidateReordered(key: string, selectedIndex: number): void {
        this.broadcastMutation({
            type: "CANDIDATE_REORDERED",
            key,
            selectedIndex,
        });
    }

    /**
     * Broadcasts that a candidate was deleted.
     */
    public broadcastCandidateDeleted(key: string, candidate: { word: string; annotation?: string }): void {
        this.broadcastMutation({
            type: "CANDIDATE_DELETED",
            key,
            candidate,
        });
    }

    /**
     * Registers a listener for remote mutation events from other tabs.
     * @param handler Function to handle incoming remote mutation
     * @returns Unsubscribe function
     */
    public onRemoteMutation(handler: (event: IUserJisyoSyncEvent) => void): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    /**
     * Closes the broadcast channel and unregisters all handlers.
     */
    public close(): void {
        if (this.channel) {
            this.channel.close();
            this.channel = null;
        }
        this.handlers.clear();
        this.isClosed = true;
    }
}
