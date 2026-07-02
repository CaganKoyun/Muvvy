/**
 * @grid/sdk — MiniApp'in içinde çalışan GRID Bridge API'si.
 *
 * K4 "core + escape hatch" deseni:
 *   grid.core.*        → her host'ta garanti (auth, storage, routing, pay)
 *   grid.capabilities  → handshake'te tespit edilen host süper güçleri
 *   grid.host.raw      → host'un ham SDK'sına geçiş (gelişmiş)
 */
import {
  createLocalTransportPair,
  isGridMessage,
  type HandshakeAck,
  type RpcError,
  type RpcRequest,
  type RpcResponse,
  type Transport,
} from './protocol.js';

export * from './protocol.js';

export interface GridUser {
  /** Pairwise pseudonymous id — host+app başına farklı (privacy-preserving, §5.5). */
  sub: string;
  name?: string;
  /** Scoped, minimize claim seti; içerik host capability'lerine göre değişir. */
  claims: Record<string, unknown>;
}

export interface PayRequest {
  amount: number;
  currency: string;
  description?: string;
}

export interface PayResult {
  status: 'approved' | 'declined';
  transactionId?: string;
}

/** Handshake'ten gelen düz capability listesi ağaca açılır: "identity.kyc" → identity.kyc = true */
export interface CapabilityTree {
  identity: { basic: boolean; kyc: boolean; proofOfPersonhood: boolean };
  social: { graph: boolean };
  pay: { native: boolean };
}

export function toCapabilityTree(capabilities: string[]): CapabilityTree {
  const has = (c: string) => capabilities.includes(c);
  return {
    identity: {
      basic: has('identity.basic'),
      kyc: has('identity.kyc'),
      proofOfPersonhood: has('identity.proof_of_personhood'),
    },
    social: { graph: has('social.graph') },
    pay: { native: has('pay.native') },
  };
}

export class GridRpcError extends Error {
  constructor(
    public readonly code: RpcError['code'],
    message: string
  ) {
    super(message);
    this.name = 'GridRpcError';
  }
}

export interface Grid {
  hostId: string;
  appId: string;
  core: {
    auth: { getUser(): Promise<GridUser> };
    storage: {
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown): Promise<void>;
      remove(key: string): Promise<void>;
    };
    routing: {
      navigate(page: string): Promise<void>;
      currentPage(): Promise<string>;
    };
    pay: { request(req: PayRequest): Promise<PayResult> };
  };
  capabilities: CapabilityTree;
  /** Manifestte beyan edilip host tarafından onaylanan izinler. */
  permissions: string[];
  host: { raw(method: string, params?: unknown): Promise<unknown> };
}

/**
 * Transport üzerinden host ile handshake yapar ve Grid API nesnesini kurar.
 * Gerçek webview'de transport window.postMessage'a bağlanır; testte
 * `createLocalTransportPair` kullanılır.
 */
export async function createGrid(transport: Transport, opts: { timeoutMs?: number } = {}): Promise<Grid> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let ackResolve: ((ack: HandshakeAck) => void) | undefined;

  transport.onMessage((raw) => {
    if (!isGridMessage(raw)) return;
    if (raw.grid === 'handshake:ack') {
      ackResolve?.(raw);
      return;
    }
    if (raw.grid === 'rpc:result') {
      const res = raw as RpcResponse;
      const entry = pending.get(res.id);
      if (!entry) return;
      pending.delete(res.id);
      if (res.ok) {
        entry.resolve(res.result);
      } else {
        entry.reject(new GridRpcError(res.error?.code ?? 'INTERNAL', res.error?.message ?? 'RPC hatası'));
      }
    }
  });

  const ack = await new Promise<HandshakeAck>((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const timer = setTimeout(
      () => reject(new Error(`GRID handshake ${timeoutMs}ms içinde tamamlanmadı.`)),
      timeoutMs
    );
    ackResolve = (a) => {
      clearTimeout(timer);
      resolve(a);
    };
    transport.send({ grid: 'handshake' });
  });

  function rpc<T>(method: string, params?: unknown): Promise<T> {
    const id = nextId++;
    const req: RpcRequest = { grid: 'rpc', id, method, params };
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      transport.send(req);
    });
  }

  return {
    hostId: ack.hostId,
    appId: ack.appId,
    permissions: ack.permissions,
    capabilities: toCapabilityTree(ack.capabilities),
    core: {
      auth: {
        getUser: () => rpc<GridUser>('core.auth.getUser'),
      },
      storage: {
        get: (key) => rpc('core.storage.get', { key }),
        set: (key, value) => rpc('core.storage.set', { key, value }),
        remove: (key) => rpc('core.storage.remove', { key }),
      },
      routing: {
        navigate: (page) => rpc('core.routing.navigate', { page }),
        currentPage: () => rpc<string>('core.routing.currentPage'),
      },
      pay: {
        request: (req) => rpc<PayResult>('core.pay.request', req),
      },
    },
    host: {
      raw: (method, params) => rpc('host.raw', { method, params }),
    },
  };
}

export { createLocalTransportPair };
