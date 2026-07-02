/**
 * Registry veri modeli (doküman §5.9) ve bellek-içi store.
 * Kalıcı depolama (Postgres/Prisma) Faz 1'de bu arayüzün arkasına takılır.
 */
import type { CertificationResult } from '@grid/cert';
import type { MiniAppManifest } from '@grid/manifest';

export type CertStatus = 'certified' | 'rejected' | 'pending_human_review';

export interface StoredVersion {
  id: string;
  appId: string;
  versionName: string;
  versionCode: number;
  packageHash: string;
  /** Geliştirici imzası (base64). */
  developerSignature: string;
  developerPublicKey: string;
  certStatus: CertStatus;
  certification: CertificationResult;
  manifest: MiniAppManifest;
  packageBytes: Uint8Array;
  submittedAt: string;
}

export type HostTier = 1 | 2 | 3;
export type HostType = 'bank' | 'telco' | 'civic' | 'super_app' | 'wallet';

export interface StoredHost {
  id: string;
  name: string;
  tier: HostTier;
  type: HostType;
  capabilities: string[];
}

export type ListingState = 'requested' | 'approved' | 'live' | 'paused' | 'removed';

export interface StoredListing {
  id: string;
  appId: string;
  versionId: string;
  hostId: string;
  state: ListingState;
  placement: string[];
  updatedAt: string;
}

export type AnalyticsEventType = 'activation' | 'usage' | 'transaction';

export interface AnalyticsEvent {
  listingId: string;
  type: AnalyticsEventType;
  at: string;
}

export class RegistryStore {
  private versions = new Map<string, StoredVersion>();
  private hosts = new Map<string, StoredHost>();
  private listings = new Map<string, StoredListing>();
  private events: AnalyticsEvent[] = [];
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36).padStart(6, '0')}`;
  }

  putVersion(v: StoredVersion): void {
    this.versions.set(v.id, v);
  }

  getVersion(id: string): StoredVersion | undefined {
    return this.versions.get(id);
  }

  findVersion(appId: string, versionCode: number): StoredVersion | undefined {
    return [...this.versions.values()].find(
      (v) => v.appId === appId && v.versionCode === versionCode
    );
  }

  versionsOf(appId: string): StoredVersion[] {
    return [...this.versions.values()]
      .filter((v) => v.appId === appId)
      .sort((a, b) => a.versionCode - b.versionCode);
  }

  findByHash(hash: string): StoredVersion | undefined {
    return [...this.versions.values()].find((v) => v.packageHash === hash);
  }

  /** Sertifikalı sürümlerin host kataloğu görünümü. */
  catalog(): StoredVersion[] {
    const latest = new Map<string, StoredVersion>();
    for (const v of this.versions.values()) {
      if (v.certStatus !== 'certified') continue;
      const cur = latest.get(v.appId);
      if (!cur || v.versionCode > cur.versionCode) latest.set(v.appId, v);
    }
    return [...latest.values()];
  }

  putHost(h: StoredHost): void {
    this.hosts.set(h.id, h);
  }

  getHost(id: string): StoredHost | undefined {
    return this.hosts.get(id);
  }

  putListing(l: StoredListing): void {
    this.listings.set(l.id, l);
  }

  getListing(id: string): StoredListing | undefined {
    return this.listings.get(id);
  }

  listingsOf(filter: { appId?: string; hostId?: string }): StoredListing[] {
    return [...this.listings.values()].filter(
      (l) =>
        (filter.appId === undefined || l.appId === filter.appId) &&
        (filter.hostId === undefined || l.hostId === filter.hostId)
    );
  }

  recordEvent(e: AnalyticsEvent): void {
    this.events.push(e);
  }

  eventsFor(listingIds: Set<string>): AnalyticsEvent[] {
    return this.events.filter((e) => listingIds.has(e.listingId));
  }
}
