import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTokenStore, MemoryTokenStore, isExpired, toStoredToken } from "../src/tokens.js";

const EXCHANGE = { access_token: "a1", refresh_token: "r1", expire_in: 14400 };

describe("toStoredToken", () => {
  it("converts expire_in into an absolute expiry", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    const stored = toStoredToken(11, EXCHANGE, now);
    expect(stored.expiresAt).toBe(now.getTime() + 14400 * 1000);
    expect(stored.accessToken).toBe("a1");
  });
});

describe("isExpired", () => {
  const stored = { shopId: 11, accessToken: "a", refreshToken: "r", expiresAt: Date.parse("2026-11-12T04:00:00Z") };

  it("is false well inside the lifetime", () => {
    expect(isExpired(stored, new Date("2026-11-12T01:00:00Z"))).toBe(false);
  });

  it("is true inside the refresh skew", () => {
    expect(isExpired(stored, new Date("2026-11-12T03:59:30Z"))).toBe(true);
  });

  it("is true after expiry", () => {
    expect(isExpired(stored, new Date("2026-11-12T05:00:00Z"))).toBe(true);
  });
});

describe("MemoryTokenStore", () => {
  it("stores, replaces and deletes by shop id", async () => {
    const store = new MemoryTokenStore();
    expect(await store.get(1)).toBeUndefined();
    await store.set({ shopId: 1, accessToken: "a", refreshToken: "r", expiresAt: 1 });
    expect((await store.get(1))?.accessToken).toBe("a");
    await store.set({ shopId: 1, accessToken: "b", refreshToken: "r2", expiresAt: 2 });
    expect((await store.get(1))?.refreshToken).toBe("r2");
    await store.delete(1);
    expect(await store.get(1)).toBeUndefined();
  });
});

describe("FileTokenStore", () => {
  it("persists across instances so a restart keeps the authorization", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shopee-tokens-"));
    const path = join(dir, "tokens.json");

    const first = new FileTokenStore(path);
    await first.set({ shopId: 11, accessToken: "a", refreshToken: "r", expiresAt: 99 });

    const second = new FileTokenStore(path);
    expect((await second.get(11))?.refreshToken).toBe("r");
  });

  it("writes mode 0600, because the file holds refresh tokens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shopee-tokens-"));
    const path = join(dir, "tokens.json");
    await new FileTokenStore(path).set({ shopId: 11, accessToken: "a", refreshToken: "r", expiresAt: 99 });
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("keeps two shops written concurrently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shopee-tokens-"));
    const path = join(dir, "tokens.json");
    const store = new FileTokenStore(path);

    await Promise.all([
      store.set({ shopId: 1, accessToken: "a1", refreshToken: "r1", expiresAt: 1 }),
      store.set({ shopId: 2, accessToken: "a2", refreshToken: "r2", expiresAt: 2 }),
      store.delete(999),
    ]);

    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, { accessToken: string }>;
    expect(raw["1"]?.accessToken).toBe("a1");
    expect(raw["2"]?.accessToken).toBe("a2");
  });

  it("returns undefined for a shop that was never authorized", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shopee-tokens-"));
    expect(await new FileTokenStore(join(dir, "missing.json")).get(5)).toBeUndefined();
  });
});
