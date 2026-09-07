import type {
    IUserJisyoSyncNotifier,
    IUserJisyoSyncEvent,
} from "../../core/skk/jisyo/CompositeJisyoProvider";
import { isRuntimeAvailable, sendRuntimeMessage } from "../rpc/runtimeClient";

/**
 * Options for configuring RuntimeMessageSync.
 */
export interface RuntimeMessageSyncOptions {
    /**
     * Unique identifier for this instance/tab to ignore self-broadcasts.
     */
    senderId?: string;
}

/**
 * Multi-tab synchronization utility using WebExtension runtime messaging.
 * Replaces BroadcastChannel in Content Scripts to prevent leaking user dictionary data
 * into the host page's origin and to allow cross-origin tab synchronization.
 */
export class RuntimeMessageSync implements IUserJisyoSyncNotifier {
    private readonly senderId: string;
    private handlers: Set<(event: IUserJisyoSyncEvent) => void> = new Set();
    private messageListener: ((message: any, sender: any, sendResponse?: any) => void) | null = null;
    private isClosed = false;

    constructor(options?: RuntimeMessageSyncOptions) {
        this.senderId = options?.senderId ?? this.generateSenderId();
        this.setupListener();
    }

    private generateSenderId(): string {
        return (
            Math.random().toString(36).substring(2, 10) +
            "_" +
            Date.now().toString(36)
        );
    }

    public getSenderId(): string {
        return this.senderId;
    }

    private setupListener(): void {
        const g = globalThis as any;

        this.messageListener = (message: any) => {
            if (this.isClosed) return;
            if (message?.type === "SKK_USER_SYNC" && message.event) {
                const event = message.event as IUserJisyoSyncEvent;
                // Ignore self-broadcasts from the same content script
                if (event.senderId && event.senderId === this.senderId) {
                    return;
                }
                for (const handler of this.handlers) {
                    try {
                        handler(event);
                    } catch (err) {
                        console.error("[RuntimeMessageSync] Error in mutation listener:", err);
                    }
                }
            }
        };

        try {
            if (typeof g.browser !== "undefined" && g.browser.runtime?.onMessage?.addListener) {
                g.browser.runtime.onMessage.addListener(this.messageListener);
            } else if (typeof g.chrome !== "undefined" && g.chrome.runtime?.onMessage?.addListener) {
                g.chrome.runtime.onMessage.addListener(this.messageListener);
            }
        } catch {
            // In Node / non-extension testing environments, ignore listener attachment
        }
    }

    /**
     * Broadcasts a mutation event to other tabs via the background script.
     */
    public broadcastMutation(event?: IUserJisyoSyncEvent): void {
        if (this.isClosed || !isRuntimeAvailable()) {
            return;
        }

        const syncEvent: IUserJisyoSyncEvent = {
            type: event?.type ?? "MUTATED",
            senderId: this.senderId,
            ...(event?.key ? { key: event.key } : {}),
            ...(event?.candidate ? { candidate: event.candidate } : {}),
            ...(event?.selectedIndex !== undefined ? { selectedIndex: event.selectedIndex } : {}),
        };

        sendRuntimeMessage({
            type: "SKK_USER_SYNC_BROADCAST",
            event: syncEvent,
        }).catch(() => {
            // Ignore broadcast failure if background is not listening
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
     * Closes the sync notifier and removes event listeners.
     */
    public close(): void {
        this.isClosed = true;
        const g = globalThis as any;
        if (this.messageListener) {
            try {
                if (typeof g.browser !== "undefined" && g.browser.runtime?.onMessage?.removeListener) {
                    g.browser.runtime.onMessage.removeListener(this.messageListener);
                } else if (typeof g.chrome !== "undefined" && g.chrome.runtime?.onMessage?.removeListener) {
                    g.chrome.runtime.onMessage.removeListener(this.messageListener);
                }
            } catch {
                // ignore
            }
            this.messageListener = null;
        }
        this.handlers.clear();
    }
}
