export interface SessionRowRecord {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  metadata: string;
}

export class FakeKVNamespace {
  private store = new Map<string, string>();

  async get(key: string, type?: "text" | "json"): Promise<string | unknown | null> {
    const value = this.store.get(key) ?? null;
    if (value === null) {
      return null;
    }

    if (type === "json") {
      return JSON.parse(value) as unknown;
    }

    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class FakeDurableObjectNamespace {
  lastName: string | null = null;
  lastRequest: Request | null = null;
  response = new Response("durable-ok", { status: 200 });

  idFromName(name: string): DurableObjectId {
    this.lastName = name;
    return { toString: () => name } as DurableObjectId;
  }

  get(_id: DurableObjectId): DurableObjectStub {
    return {
      fetch: async (request: Request) => {
        this.lastRequest = request;
        return this.response;
      },
    } as DurableObjectStub;
  }
}

export class FakeD1Database {
  readonly rows: SessionRowRecord[] = [];

  prepare(sql: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, sql);
  }
}

class FakeD1PreparedStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async run(): Promise<D1Result<Record<string, never>>> {
    if (this.sql.includes("INSERT INTO amplink_sessions")) {
      const [
        id,
        userId,
        title,
        status,
        createdAt,
        updatedAt,
        lastMessageAt,
        metadata,
      ] = this.args as [
        string,
        string,
        string | null,
        string,
        string,
        string,
        string | null,
        string,
      ];

      this.db.rows.push({
        id,
        user_id: userId,
        title,
        status,
        created_at: createdAt,
        updated_at: updatedAt,
        last_message_at: lastMessageAt,
        metadata,
      });
    } else if (this.sql.includes("UPDATE amplink_sessions")) {
      const [status, updatedAt, lastMessageAt, sessionId] = this.args as [
        string,
        string,
        string | null,
        string,
      ];
      const row = this.db.rows.find((entry) => entry.id === sessionId);
      if (row) {
        row.status = status;
        row.updated_at = updatedAt;
        row.last_message_at = lastMessageAt ?? row.last_message_at;
      }
    }

    return {
      success: true,
      results: [],
      meta: {} as D1Result<Record<string, never>>["meta"],
    };
  }

  async all<T>(): Promise<D1Result<T>> {
    const [userId] = this.args as [string];
    const results = this.db.rows
      .filter((row) => row.user_id === userId)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at)) as T[];

    return { results, success: true, meta: {} as D1Result<T>["meta"] };
  }

  async first<T>(): Promise<T | null> {
    const [sessionId] = this.args as [string];
    return (this.db.rows.find((row) => row.id === sessionId) as T | undefined) ?? null;
  }
}

export function makeCloudflareEnv(
  overrides: Partial<CloudflareEnv> = {},
): CloudflareEnv {
  return {
    AI: {
      run: async () => ({ response: "{\"intent\":\"intake\",\"reply\":\"Hi\",\"shouldDispatch\":false,\"dispatchPrompt\":\"Hi\",\"confidence\":0.9}" }),
    } as unknown as Ai,
    DB: new FakeD1Database() as unknown as D1Database,
    AMPLINK_DESKTOPS: new FakeKVNamespace() as unknown as KVNamespace,
    AMPLINK_VOICE_PROFILES: new FakeKVNamespace() as unknown as KVNamespace,
    AMPLINK_SESSION: new FakeDurableObjectNamespace() as unknown as CloudflareEnv["AMPLINK_SESSION"],
    AMPLINK_CONTROL: new FakeDurableObjectNamespace() as unknown as CloudflareEnv["AMPLINK_CONTROL"],
    AMPLINK_RELAY_ROOM: new FakeDurableObjectNamespace() as unknown as CloudflareEnv["AMPLINK_RELAY_ROOM"],
    DESKTOP_DISPATCH_URL: "",
    ELEVENLABS_MODEL_ID: "eleven_multilingual_v2",
    ELEVENLABS_VOICE_ID: "CwhRBWXzGAHq8TQ4Fs17",
    AMPLINK_DEFAULT_USER: "local-dev",
    ...overrides,
  } as unknown as CloudflareEnv;
}
