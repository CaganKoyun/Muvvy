/**
 * @grid/registry — GRID Core servisinin HTTP yüzü.
 * Submit → sertifikasyon → katalog → listing (request/approve/live) →
 * kill-switch → temel iki taraflı analytics akışını taşır (§5.1, §6).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { runCertification } from '@grid/cert';
import { readPackage, sha256, verifyBytes, MINIAPP_MIME } from '@grid/pack';
import {
  RegistryStore,
  type AnalyticsEventType,
  type CertStatus,
  type HostTier,
  type HostType,
  type ListingState,
  type StoredListing,
  type StoredVersion,
} from './store.js';

export * from './store.js';

export interface RegistryOptions {
  /** GRID sertifika imza anahtarı (PEM pkcs8). */
  gridPrivateKey: string;
  /** Host'ların sertifika doğrulamak için kullanacağı public key (PEM spki). */
  gridPublicKey: string;
  store?: RegistryStore;
  now?: () => Date;
}

interface SubmitBody {
  package: string; // base64 miniapp-pkg+zip
  signature: string; // base64 geliştirici imzası
  developerPublicKey: string; // PEM
  /** Yüksek riskli kategoride insan review onayı (Faz 0'da manuel bayrak). */
  humanApproved?: boolean;
}

function versionSummary(v: StoredVersion) {
  return {
    id: v.id,
    app_id: v.appId,
    name: v.manifest.name,
    version: { name: v.versionName, code: v.versionCode },
    package_hash: v.packageHash,
    cert_status: v.certStatus,
    category: v.manifest['x-grid']?.category ?? null,
    capabilities: v.manifest['x-grid']?.capabilities ?? {},
    submitted_at: v.submittedAt,
  };
}

export function createRegistryServer(opts: RegistryOptions): FastifyInstance {
  const store = opts.store ?? new RegistryStore();
  const now = opts.now ?? (() => new Date());
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });

  app.get('/health', async () => ({ ok: true, service: 'grid-registry' }));

  /** GRID public key — host runtime'ları sertifika doğrulamak için çeker. */
  app.get('/v1/keys/grid', async () => ({ publicKey: opts.gridPublicKey }));

  /** 6.1: Developer submit → sertifikasyon tetiklenir. */
  app.post<{ Params: { appId: string }; Body: SubmitBody }>(
    '/v1/miniapps/:appId/versions',
    async (req, reply) => {
      const { appId } = req.params;
      const body = req.body;
      if (!body?.package || !body.signature || !body.developerPublicKey) {
        return reply
          .code(400)
          .send({ error: 'package, signature ve developerPublicKey zorunludur.' });
      }

      const bytes = new Uint8Array(Buffer.from(body.package, 'base64'));

      if (!verifyBytes(bytes, body.signature, body.developerPublicKey)) {
        return reply.code(400).send({ error: 'Geliştirici imzası paketi doğrulamıyor.' });
      }

      let manifest;
      try {
        ({ manifest } = readPackage(bytes));
      } catch (e) {
        return reply.code(400).send({ error: `Paket geçersiz: ${(e as Error).message}` });
      }
      if (manifest.app_id !== appId) {
        return reply
          .code(400)
          .send({ error: `Manifest app_id ("${manifest.app_id}") URL ile eşleşmiyor ("${appId}").` });
      }
      if (store.findVersion(appId, manifest.version.code)) {
        return reply
          .code(409)
          .send({ error: `Sürüm kodu ${manifest.version.code} zaten yayınlandı — sürümler immutable'dır.` });
      }

      const certification = runCertification(bytes, {
        gridPrivateKey: opts.gridPrivateKey,
        humanApproved: body.humanApproved,
        now: now(),
      });

      const certStatus: CertStatus = certification.passed
        ? 'certified'
        : certification.requiresHumanReview
          ? 'pending_human_review'
          : 'rejected';

      const version: StoredVersion = {
        id: store.nextId('ver'),
        appId,
        versionName: manifest.version.name,
        versionCode: manifest.version.code,
        packageHash: sha256(bytes),
        developerSignature: body.signature,
        developerPublicKey: body.developerPublicKey,
        certStatus,
        certification,
        manifest,
        packageBytes: bytes,
        submittedAt: now().toISOString(),
      };
      store.putVersion(version);

      return reply.code(certification.passed ? 201 : 422).send({
        version: versionSummary(version),
        certification: {
          passed: certification.passed,
          requires_human_review: certification.requiresHumanReview,
          stages: certification.stages,
          certificate: certification.certificate ?? null,
        },
      });
    }
  );

  app.get<{ Params: { appId: string } }>('/v1/miniapps/:appId/versions', async (req) => ({
    versions: store.versionsOf(req.params.appId).map(versionSummary),
  }));

  /** Host Console kataloğu: yalnızca sertifikalı son sürümler (§5.7). */
  app.get('/v1/catalog', async () => ({
    miniapps: store.catalog().map(versionSummary),
  }));

  /** Paket indirme — host runtime launch sırasında çeker. */
  app.get<{ Params: { hash: string } }>('/v1/packages/:hash', async (req, reply) => {
    const version = store.findByHash(req.params.hash);
    if (!version) return reply.code(404).send({ error: 'Paket bulunamadı.' });
    return reply
      .header('content-type', MINIAPP_MIME)
      .header('x-grid-signature', version.developerSignature)
      .send(Buffer.from(version.packageBytes));
  });

  app.post<{ Body: { id: string; name: string; tier: HostTier; type: HostType; capabilities?: string[] } }>(
    '/v1/hosts',
    async (req, reply) => {
      const b = req.body;
      if (!b?.id || !b.name || !b.tier || !b.type) {
        return reply.code(400).send({ error: 'id, name, tier ve type zorunludur.' });
      }
      store.putHost({ id: b.id, name: b.name, tier: b.tier, type: b.type, capabilities: b.capabilities ?? [] });
      return reply.code(201).send({ ok: true });
    }
  );

  /** 6.3: Host bir MiniApp'i ister (requested) → onaylar → canlıya alır. */
  app.post<{ Body: { appId: string; versionId: string; hostId: string } }>(
    '/v1/listings',
    async (req, reply) => {
      const b = req.body;
      const version = b?.versionId ? store.getVersion(b.versionId) : undefined;
      if (!version || version.appId !== b.appId) {
        return reply.code(404).send({ error: 'Sürüm bulunamadı.' });
      }
      if (version.certStatus !== 'certified') {
        return reply.code(422).send({ error: 'Yalnızca sertifikalı sürümler listelenebilir.' });
      }
      if (!store.getHost(b.hostId)) {
        return reply.code(404).send({ error: 'Host bulunamadı.' });
      }
      const listing: StoredListing = {
        id: store.nextId('lst'),
        appId: b.appId,
        versionId: b.versionId,
        hostId: b.hostId,
        state: 'requested',
        placement: [],
        updatedAt: now().toISOString(),
      };
      store.putListing(listing);
      return reply.code(201).send({ listing });
    }
  );

  const transitions: Record<string, { from: ListingState[]; to: ListingState }> = {
    approve: { from: ['requested'], to: 'approved' },
    live: { from: ['approved', 'paused'], to: 'live' },
    // Kill-switch: canlı MiniApp saniyeler içinde erişilmez olur (P0.3).
    kill: { from: ['live', 'approved'], to: 'paused' },
    remove: { from: ['requested', 'approved', 'live', 'paused'], to: 'removed' },
  };

  app.post<{ Params: { id: string; action: string }; Body: { placement?: string[] } }>(
    '/v1/listings/:id/:action',
    async (req, reply) => {
      const listing = store.getListing(req.params.id);
      if (!listing) return reply.code(404).send({ error: 'Listing bulunamadı.' });
      const t = transitions[req.params.action];
      if (!t) return reply.code(404).send({ error: `Bilinmeyen aksiyon: ${req.params.action}` });
      if (!t.from.includes(listing.state)) {
        return reply
          .code(409)
          .send({ error: `"${listing.state}" durumundan "${t.to}" durumuna geçilemez.` });
      }
      listing.state = t.to;
      if (req.body?.placement) listing.placement = req.body.placement;
      listing.updatedAt = now().toISOString();
      store.putListing(listing);
      return { listing };
    }
  );

  app.get<{ Params: { id: string } }>('/v1/listings/:id', async (req, reply) => {
    const listing = store.getListing(req.params.id);
    if (!listing) return reply.code(404).send({ error: 'Listing bulunamadı.' });
    return { listing };
  });

  app.get<{ Querystring: { appId?: string; hostId?: string } }>('/v1/listings', async (req) => ({
    listings: store.listingsOf(req.query),
  }));

  /** P0.6: temel analytics — runtime aktivasyon/kullanım olayı yollar. */
  app.post<{ Body: { listingId: string; type: AnalyticsEventType } }>(
    '/v1/events',
    async (req, reply) => {
      const b = req.body;
      if (!b?.listingId || !store.getListing(b.listingId)) {
        return reply.code(404).send({ error: 'Listing bulunamadı.' });
      }
      if (!['activation', 'usage', 'transaction'].includes(b.type)) {
        return reply.code(400).send({ error: 'Geçersiz olay tipi.' });
      }
      store.recordEvent({ listingId: b.listingId, type: b.type, at: now().toISOString() });
      return reply.code(201).send({ ok: true });
    }
  );

  function summarize(listings: StoredListing[]) {
    const ids = new Set(listings.map((l) => l.id));
    const events = store.eventsFor(ids);
    const count = (type: AnalyticsEventType) => events.filter((e) => e.type === type).length;
    return {
      listings: listings.length,
      live_listings: listings.filter((l) => l.state === 'live').length,
      activations: count('activation'),
      usage_events: count('usage'),
      transactions: count('transaction'),
    };
  }

  /** Developer görünümü: app'im hangi host'larda ne üretiyor (§5.8). */
  app.get<{ Params: { appId: string } }>('/v1/analytics/apps/:appId', async (req) => {
    const listings = store.listingsOf({ appId: req.params.appId });
    return {
      app_id: req.params.appId,
      total: summarize(listings),
      by_host: Object.fromEntries(
        [...new Set(listings.map((l) => l.hostId))].map((hostId) => [
          hostId,
          summarize(listings.filter((l) => l.hostId === hostId)),
        ])
      ),
    };
  });

  /** Host görünümü: kataloğum ne üretiyor (§5.8). */
  app.get<{ Params: { hostId: string } }>('/v1/analytics/hosts/:hostId', async (req) => {
    const listings = store.listingsOf({ hostId: req.params.hostId });
    return {
      host_id: req.params.hostId,
      total: summarize(listings),
      by_app: Object.fromEntries(
        [...new Set(listings.map((l) => l.appId))].map((appId) => [
          appId,
          summarize(listings.filter((l) => l.appId === appId)),
        ])
      ),
    };
  });

  return app;
}
