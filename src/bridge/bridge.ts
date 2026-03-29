// Bridge — the local orchestrator.
//
// Runs on the user's machine.  Manages adapter instances (one per session),
// collects their Plexus events, and exposes a single WebSocket endpoint for
// the relay (or a direct phone connection) to consume.
//
// The bridge never touches API keys or provider credentials directly — those
// live inside the adapters, which run as local code on the same machine.

import type {
  Adapter,
  AdapterConfig,
  AdapterFactory,
  PlexusEvent,
  Prompt,
  Session,
} from "../protocol/index.ts";

// ---------------------------------------------------------------------------
// Bridge configuration
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  /** Port for the local WebSocket listener. */
  port?: number;
  /** Registered adapter factories, keyed by adapter type. */
  adapters: Record<string, AdapterFactory>;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class Bridge {
  private sessions = new Map<string, Adapter>();
  private adapterFactories: Record<string, AdapterFactory>;
  private listeners = new Set<(event: PlexusEvent) => void>();

  constructor(private config: BridgeConfig) {
    this.adapterFactories = config.adapters;
  }

  // -- Session management ---------------------------------------------------

  /** Create a new session with the given adapter type. */
  async createSession(
    adapterType: string,
    options?: Partial<AdapterConfig>,
  ): Promise<Session> {
    const factory = this.adapterFactories[adapterType];
    if (!factory) {
      throw new Error(`Unknown adapter type: "${adapterType}". Registered: ${Object.keys(this.adapterFactories).join(", ")}`);
    }

    const sessionId = options?.sessionId ?? crypto.randomUUID();
    const config: AdapterConfig = {
      sessionId,
      name: options?.name ?? `${adapterType} session`,
      cwd: options?.cwd ?? process.cwd(),
      env: options?.env,
      options: options?.options,
    };

    const adapter = factory(config);

    // Wire adapter events to bridge listeners.
    adapter.on("event", (e) => this.broadcast(e));
    adapter.on("error", (err) => {
      this.broadcast({
        event: "session:update",
        session: { ...adapter.session, status: "error" },
      });
      console.error(`[bridge] adapter error (${sessionId}):`, err.message);
    });

    this.sessions.set(sessionId, adapter);
    await adapter.start();

    return adapter.session;
  }

  /** Send a prompt to a session. */
  send(prompt: Prompt): void {
    const adapter = this.sessions.get(prompt.sessionId);
    if (!adapter) {
      throw new Error(`No session: ${prompt.sessionId}`);
    }
    adapter.send(prompt);
  }

  /** Interrupt the active turn in a session. */
  interrupt(sessionId: string): void {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return;
    adapter.interrupt();
  }

  /** Shut down a single session. */
  async closeSession(sessionId: string): Promise<void> {
    const adapter = this.sessions.get(sessionId);
    if (!adapter) return;
    await adapter.shutdown();
    this.sessions.delete(sessionId);
    this.broadcast({ event: "session:closed", sessionId });
  }

  /** List all active sessions. */
  listSessions(): Session[] {
    return [...this.sessions.values()].map((a) => ({ ...a.session }));
  }

  /** Shut down the bridge and all sessions. */
  async shutdown(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.closeSession(id)));
  }

  // -- Event distribution ---------------------------------------------------

  /** Subscribe to all Plexus events from all sessions. */
  onEvent(listener: (event: PlexusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(event: PlexusEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }
}
