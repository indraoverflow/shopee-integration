#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { loadConfig } from "./config.js";

/**
 * Answers one question: is the partner key the reason the server says
 * "Wrong sign"?
 *
 * It signs the same request with every candidate key you list, and reports the
 * error code the server answered, never the key itself. It also compares the
 * host clock with the server's Date header, because a clock more than five
 * minutes off invalidates every signature.
 *
 *   CANDIDATE_KEYS_FILE=./candidate-keys.txt npm run diagnose
 *
 * The file is one key per line, blanks and lines starting with # ignored.
 */

interface ProbeResult {
  error: string;
  message: string;
}

const PATH_TOKEN = "/api/v2/auth/token/get";
const PATH_AUTH = "/api/v2/shop/auth_partner";

function sign(partnerId: string, key: string, path: string, timestamp: number): string {
  return createHmac("sha256", key).update(`${partnerId}${path}${timestamp}`).digest("hex");
}

async function probeTokenExchange(baseUrl: string, partnerId: string, key: string, timestamp: number): Promise<ProbeResult> {
  const sign_ = sign(partnerId, key, PATH_TOKEN, timestamp);
  const url = `${baseUrl}${PATH_TOKEN}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign_}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "diagnose-probe", shop_id: 0, partner_id: Number(partnerId) }),
  });
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return { error: parsed.error ?? `http_${response.status}`, message: parsed.message ?? "" };
  } catch {
    return { error: `http_${response.status}`, message: text.slice(0, 120) };
  }
}

async function probeAuthPage(baseUrl: string, partnerId: string, key: string, timestamp: number): Promise<ProbeResult> {
  const sign_ = sign(partnerId, key, PATH_AUTH, timestamp);
  const url = `${baseUrl}${PATH_AUTH}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign_}&redirect=${encodeURIComponent("https://example.test/cb")}`;
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return { error: parsed.error ?? `http_${response.status}`, message: parsed.message ?? "" };
  } catch {
    // A valid signature returns HTML, an invalid one returns a JSON error.
    return { error: `html_${response.status}`, message: "HTML page, the signature was not rejected" };
  }
}

async function clockSkewSeconds(baseUrl: string): Promise<number | undefined> {
  try {
    // The host root redirects to a page that may not resolve here, so read the
    // Date header from the redirect itself instead of following it.
    const response = await fetch(baseUrl, { method: "GET", redirect: "manual" });
    const date = response.headers.get("date");
    if (!date) return undefined;
    return Math.round((Date.now() - Date.parse(date)) / 1000);
  } catch {
    return undefined;
  }
}

function mask(key: string): string {
  return `${key.slice(0, 3)}... len ${key.length}`;
}

async function candidates(primary: string): Promise<Array<{ label: string; key: string }>> {
  const list = [{ label: "PARTNER_KEY", key: primary }];
  const file = process.env.CANDIDATE_KEYS_FILE;
  if (!file) return list;
  const raw = await readFile(file, "utf8");
  raw.split("\n").forEach((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith("#")) return;
    list.push({ label: `candidate #${index + 1}`, key: value });
  });
  return list;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const partnerId = String(config.partnerId);
  const timestamp = Math.floor(Date.now() / 1000);

  console.log(`environment : ${config.env} (${config.baseUrl})`);
  console.log(`partner id  : ${partnerId}`);

  const skew = await clockSkewSeconds(config.baseUrl);
  if (skew !== undefined) {
    const verdict = Math.abs(skew) > 300 ? "TOO FAR, signatures expire after five minutes" : "fine";
    console.log(`clock skew  : ${skew}s (${verdict})`);
  }

  for (const candidate of await candidates(config.partnerKey)) {
    const token = await probeTokenExchange(config.baseUrl, partnerId, candidate.key, timestamp);
    const auth = await probeAuthPage(config.baseUrl, partnerId, candidate.key, timestamp);
    console.log(
      `${candidate.label.padEnd(14)} ${mask(candidate.key).padEnd(14)} token/get: ${token.error.padEnd(18)} auth_partner: ${auth.error}`,
    );
  }

  console.log("");
  console.log("error_sign on both endpoints means the key does not belong to this partner id.");
  console.log("invalid_partner_id means the id does not exist in this environment.");
  console.log("anything else means the signature was accepted and the request failed for its own reason.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
