// Encrypted transport — wraps a WebSocket connection with Noise encryption.
//
// Usage from the bridge side:
//   1. Client connects via WebSocket
//   2. Bridge creates a SecureTransport with its static key
//   3. Handshake messages exchange automatically
//   4. Once complete, all subsequent messages are encrypted/decrypted transparently
//
// Wire format (JSON envelopes):
//   Handshake phase:  { phase: "handshake", payload: "<base64>" }
//   Transport phase:  { phase: "transport", payload: "<base64>" }

import {
  NoiseHandshake,
  type KeyPair,
  type NoiseSession,
  type HandshakePattern,
  type Role,
} from "./noise.ts";
import { saveTrustedPeer, bytesToHex } from "./identity.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WireMessage {
  phase: "handshake" | "transport";
  payload: string; // base64
}

export interface SecureTransportEvents {
  /** Handshake complete — transport is ready for encrypted messages. */
  onReady?: (remotePublicKey: Uint8Array) => void;
  /** Decrypted application message received. */
  onMessage?: (message: string) => void;
  /** Error during handshake or transport. */
  onError?: (error: Error) => void;
  /** Connection closed. */
  onClose?: () => void;
}

// Minimal WebSocket interface — works with both Bun.serve sockets and client WebSockets.
export interface SocketLike {
  send(data: string | Uint8Array): void;
}

// ---------------------------------------------------------------------------
// SecureTransport
// ---------------------------------------------------------------------------

export class SecureTransport {
  private handshake: NoiseHandshake;
  private session: NoiseSession | null = null;
  private socket: SocketLike;
  private events: SecureTransportEvents;
  private ready = false;

  constructor(
    socket: SocketLike,
    role: Role,
    staticKey: KeyPair,
    events: SecureTransportEvents,
    options?: {
      pattern?: HandshakePattern;
      remoteStaticKey?: Uint8Array;
      trustOnComplete?: boolean;
    },
  ) {
    this.socket = socket;
    this.events = events;

    const pattern = options?.pattern ?? "XX";
    this.handshake = new NoiseHandshake(pattern, role, staticKey, options?.remoteStaticKey);

    // If it's our turn to send first, kick off the handshake.
    if (this.handshake.isMySend()) {
      this.sendHandshakeMessage();
    }
  }

  /** Feed an incoming WebSocket message into the transport. */
  receive(raw: string | Uint8Array): void {
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const wire: WireMessage = JSON.parse(text);

      if (wire.phase === "handshake") {
        this.handleHandshakeMessage(base64ToBytes(wire.payload));
      } else if (wire.phase === "transport") {
        this.handleTransportMessage(base64ToBytes(wire.payload));
      }
    } catch (err: any) {
      this.events.onError?.(err);
    }
  }

  /** Encrypt and send an application message. */
  send(message: string): void {
    if (!this.ready || !this.session) {
      throw new Error("SecureTransport: not ready (handshake incomplete)");
    }

    const plaintext = new TextEncoder().encode(message);
    const ciphertext = this.session.encrypt(plaintext);
    const wire: WireMessage = {
      phase: "transport",
      payload: bytesToBase64(ciphertext),
    };
    this.socket.send(JSON.stringify(wire));
  }

  /** True if the handshake is complete and messages can be sent. */
  isReady(): boolean {
    return this.ready;
  }

  // ---------------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------------

  private sendHandshakeMessage(): void {
    const payload = this.handshake.writeMessage();
    const wire: WireMessage = {
      phase: "handshake",
      payload: bytesToBase64(payload),
    };
    this.socket.send(JSON.stringify(wire));

    if (this.handshake.isComplete()) {
      this.completeHandshake();
    }
  }

  private handleHandshakeMessage(message: Uint8Array): void {
    this.handshake.readMessage(message);

    if (this.handshake.isComplete()) {
      this.completeHandshake();
      return;
    }

    // Our turn to respond.
    if (this.handshake.isMySend()) {
      this.sendHandshakeMessage();
    }
  }

  private completeHandshake(): void {
    this.session = this.handshake.finalize();
    this.ready = true;

    // Save as trusted peer.
    saveTrustedPeer({
      publicKey: bytesToHex(this.session.remoteStaticKey),
      pairedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    this.events.onReady?.(this.session.remoteStaticKey);
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private handleTransportMessage(ciphertext: Uint8Array): void {
    if (!this.session) {
      this.events.onError?.(new Error("SecureTransport: received transport message before handshake"));
      return;
    }

    const plaintext = this.session.decrypt(ciphertext);
    const message = new TextDecoder().decode(plaintext);
    this.events.onMessage?.(message);
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers (using built-in btoa/atob)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
