import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccessToken } from "@congminh1254/shopee-sdk";

/**
 * What is worth persisting from a token exchange. `expiresAt` is absolute
 * milliseconds so a restarted process does not need to remember the exchange
 * time, and refresh tokens are single use, so the stored value is always the
 * newest pair.
 */
export interface StoredToken {
  shopId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TokenStore {
  get(shopId: number): Promise<StoredToken | undefined>;
  set(token: StoredToken): Promise<void>;
  delete(shopId: number): Promise<void>;
}

export function toStoredToken(shopId: number, token: AccessToken, now: Date = new Date()): StoredToken {
  return {
    shopId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: now.getTime() + token.expire_in * 1000,
  };
}

/** Four hours is Shopee's usual `expire_in`; refresh before it lapses. */
export function isExpired(token: StoredToken, now: Date = new Date(), skewMs = 60_000): boolean {
  return token.expiresAt - skewMs <= now.getTime();
}

export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<number, StoredToken>();

  async get(shopId: number): Promise<StoredToken | undefined> {
    return this.tokens.get(shopId);
  }

  async set(token: StoredToken): Promise<void> {
    this.tokens.set(token.shopId, token);
  }

  async delete(shopId: number): Promise<void> {
    this.tokens.delete(shopId);
  }
}

/**
 * One JSON object on disk, written through a temporary file and renamed, so a
 * crash mid-write cannot leave a truncated store. The file holds access and
 * refresh tokens for every authorized shop, which makes it as sensitive as the
 * partner key: it is created with mode 0600.
 */
export class FileTokenStore implements TokenStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async read(): Promise<Record<string, StoredToken>> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Record<string, StoredToken>;
      return parsed ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(data: Record<string, StoredToken>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.path);
    await chmod(this.path, 0o600);
  }

  /** Serialised so two concurrent shops cannot overwrite each other's write. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async get(shopId: number): Promise<StoredToken | undefined> {
    const data = await this.read();
    return data[String(shopId)];
  }

  async set(token: StoredToken): Promise<void> {
    await this.enqueue(async () => {
      const data = await this.read();
      data[String(token.shopId)] = token;
      await this.write(data);
    });
  }

  async delete(shopId: number): Promise<void> {
    await this.enqueue(async () => {
      const data = await this.read();
      delete data[String(shopId)];
      await this.write(data);
    });
  }
}
