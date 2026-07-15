/**
 * GRID Bridge protokolü — MiniApp (SDK) ile host (Runtime) arasındaki
 * postMessage tabanlı RPC sözleşmesi. Her iki paket de bu tipleri paylaşır.
 */

export interface RpcRequest {
  grid: 'rpc';
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcError {
  code:
    | 'PERMISSION_DENIED'
    | 'CAPABILITY_UNAVAILABLE'
    | 'UNSUPPORTED'
    | 'GRID_KILLED'
    | 'INVALID_PARAMS'
    | 'INTERNAL';
  message: string;
}

export interface RpcResponse {
  grid: 'rpc:result';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: RpcError;
}

export interface HandshakeRequest {
  grid: 'handshake';
}

export interface HandshakeAck {
  grid: 'handshake:ack';
  hostId: string;
  appId: string;
  /** Bu MiniApp için etkin capability'ler (host ∩ manifest beyanı). */
  capabilities: string[];
  /** Manifestte beyan edilen izinler. */
  permissions: string[];
}

export type GridMessage = RpcRequest | RpcResponse | HandshakeRequest | HandshakeAck;

export function isGridMessage(v: unknown): v is GridMessage {
  return typeof v === 'object' && v !== null && 'grid' in v;
}

/** Çift yönlü mesaj kanalı soyutlaması (iframe postMessage, WebView bridge, test). */
export interface Transport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
}

/**
 * Bellek-içi bağlı transport çifti. `[a, b]` döner; a'ya gönderilen b'de alınır.
 * Testlerde ve headless demo'da SDK ↔ Runtime bağlamak için.
 */
export function createLocalTransportPair(): [Transport, Transport] {
  const handlersA: Array<(m: unknown) => void> = [];
  const handlersB: Array<(m: unknown) => void> = [];
  const a: Transport = {
    send: (m) => queueMicrotask(() => handlersB.forEach((h) => h(m))),
    onMessage: (h) => handlersA.push(h),
  };
  const b: Transport = {
    send: (m) => queueMicrotask(() => handlersA.forEach((h) => h(m))),
    onMessage: (h) => handlersB.push(h),
  };
  return [a, b];
}
