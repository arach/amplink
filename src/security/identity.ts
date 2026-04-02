// Identity management for Amplink.
//
// Each bridge has a persistent static key pair (its identity).  This module
// handles generation, persistence (~/.amplink/identity.json), and QR payload
// creation for pairing with a phone.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { generateKeyPair, type KeyPair } from "./noise.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AMPLINK_DIR = join(homedir(), ".amplink");
const IDENTITY_FILE = join(AMPLINK_DIR, "identity.json");
const TRUSTED_PEERS_FILE = join(AMPLINK_DIR, "trusted-peers.json");

// ---------------------------------------------------------------------------
// Identity — the bridge's long-term key pair
// ---------------------------------------------------------------------------

export interface SerializedIdentity {
  publicKey: string;   // hex
  privateKey: string;  // hex
  createdAt: string;   // ISO-8601
}

export function loadOrCreateIdentity(): KeyPair {
  if (existsSync(IDENTITY_FILE)) {
    return loadIdentity();
  }
  return createAndSaveIdentity();
}

function loadIdentity(): KeyPair {
  const data: SerializedIdentity = JSON.parse(readFileSync(IDENTITY_FILE, "utf8"));
  return {
    publicKey: hexToBytes(data.publicKey),
    privateKey: hexToBytes(data.privateKey),
  };
}

function createAndSaveIdentity(): KeyPair {
  const keyPair = generateKeyPair();
  mkdirSync(AMPLINK_DIR, { recursive: true });

  const data: SerializedIdentity = {
    publicKey: bytesToHex(keyPair.publicKey),
    privateKey: bytesToHex(keyPair.privateKey),
    createdAt: new Date().toISOString(),
  };

  writeFileSync(IDENTITY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  return keyPair;
}

// ---------------------------------------------------------------------------
// Trusted peers — phones that have completed a handshake
// ---------------------------------------------------------------------------

export interface TrustedPeer {
  publicKey: string;   // hex
  name?: string;
  pairedAt: string;    // ISO-8601
  lastSeen?: string;
}

export function loadTrustedPeers(): Map<string, TrustedPeer> {
  if (!existsSync(TRUSTED_PEERS_FILE)) return new Map();
  const raw = readFileSync(TRUSTED_PEERS_FILE, "utf8");
  const sanitized = sanitizeTrustedPeersJson(raw);

  try {
    const data: TrustedPeer[] = JSON.parse(sanitized);
    return new Map(data.map((p) => [p.publicKey, p]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[identity] failed to parse trusted peers file; ignoring corrupted data: ${message}`);
    return new Map();
  }
}

export function saveTrustedPeer(peer: TrustedPeer): void {
  const peers = loadTrustedPeers();
  peers.set(peer.publicKey, peer);
  mkdirSync(AMPLINK_DIR, { recursive: true });
  writeFileSync(TRUSTED_PEERS_FILE, `${JSON.stringify([...peers.values()], null, 2)}\n`, { mode: 0o600 });
}

export function isTrustedPeer(publicKeyHex: string): boolean {
  return loadTrustedPeers().has(publicKeyHex);
}

// ---------------------------------------------------------------------------
// QR pairing payload — everything the phone needs to connect
// ---------------------------------------------------------------------------

export interface QRPayload {
  /** Protocol version. */
  v: number;
  /** Relay WebSocket URL. */
  relay: string;
  /** Room ID on the relay. */
  room: string;
  /** Bridge's static public key (hex). */
  publicKey: string;
  /** Expiry timestamp (ms since epoch). */
  expiresAt: number;
  /** Matching Cloudflare voice backend for this bridge session. */
  cloudflareBaseUrl?: string;
}

const QR_VERSION = 1;
const QR_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function createQRPayload(
  bridgePublicKey: Uint8Array,
  relayUrl: string,
  cloudflareBaseUrl?: string,
): QRPayload {
  return {
    v: QR_VERSION,
    relay: relayUrl,
    room: crypto.randomUUID(),
    publicKey: bytesToHex(bridgePublicKey),
    expiresAt: Date.now() + QR_EXPIRY_MS,
    cloudflareBaseUrl: cloudflareBaseUrl?.trim() || undefined,
  };
}

export function validateQRPayload(payload: QRPayload): boolean {
  if (payload.v !== QR_VERSION) return false;
  if (Date.now() > payload.expiresAt) return false;
  if (!payload.relay || !payload.room || !payload.publicKey) return false;
  if (payload.cloudflareBaseUrl) {
    try {
      const url = new URL(payload.cloudflareBaseUrl);
      if (url.protocol !== "https:") return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sanitizeTrustedPeersJson(raw: string): string {
  const withoutNuls = raw.replace(/\u0000+$/g, "").trim();
  const lastArrayClose = withoutNuls.lastIndexOf("]");
  if (lastArrayClose === -1) {
    return withoutNuls;
  }

  return withoutNuls.slice(0, lastArrayClose + 1);
}
