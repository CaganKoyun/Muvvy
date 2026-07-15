# GRID

> **App2App2User** — geliştirici bir kez MiniApp yazar; GRID onu hazır kullanıcısı olan
> super app / host'ların içine tek entegrasyonla, güvenli biçimde dağıtır.
> Standart temel: **W3C MiniApp** (Manifest + Packaging + Lifecycle).

Proje ve mimari dokümanı: [`docs/GRID.md`](docs/GRID.md)

Bu depo Faz 0 kod tabanıdır: dokümandaki P0 gereksinimlerinin çalışan, test edilmiş çekirdeği.

## Paketler

| Paket | Doküman | Ne yapar |
|---|---|---|
| `@grid/manifest` | §5.2, K1 | W3C MiniApp manifest tipleri + linter; GRID uzantıları `x-grid` vendor-prefix ile |
| `@grid/pack` | §5.2 | `application/miniapp-pkg+zip` üretimi (deterministik), sha256 içerik hash'i, ed25519 imza |
| `@grid/cert` | §5.6, K5 | Sertifikasyon hattı: statik analiz → policy review (yüksek riskte insan review) → signing; sertifika doğrulama |
| `@grid/registry` | §5.1, §5.9 | GRID Core HTTP servisi (Fastify): submit → sertifikasyon, katalog, host/listing durum makinesi, kill-switch, temel iki taraflı analytics |
| `@grid/sdk` | §5.4, K4 | MiniApp içi Bridge API: `grid.core.*` (garanti), `grid.capabilities` (tespit), `grid.host.raw` (escape hatch) |
| `@grid/runtime` | §5.3, §5.5 | Host tarafı: imza + sertifika doğrulama, permission/capability enforcement, Identity Broker (pairwise pseudonym), kill-switch; `HostAdapter` arayüzü + `MockSparkAdapter` (ilk Tier-1 iskeleti) |
| `@grid/cli` | §6.1 | `grid init / validate / keygen / build / submit` |

`examples/hello-miniapp` — K4 deseninin canlı örneği: çekirdek bir kez yazılır,
World'de proof-of-personhood, Spark/bankada KYC, aksi halde core fallback.

## Hızlı başlangıç

```bash
pnpm install
pnpm test        # 69 test: birim + uçtan uca yolculuk
pnpm typecheck
```

Uçtan uca akışın tamamı `test/e2e.test.ts` içinde:
submit → sertifikasyon → katalog → listing (request/approve/live) →
paket indirme + çift imza doğrulama → SSO + capability handshake →
ödeme → analytics → **kill-switch**.

### Geliştirici akışı (CLI)

```bash
# registry'yi başlat
pnpm --filter @grid/registry build && pnpm --filter @grid/registry start

# başka bir dizinde
grid init com.acme.todo
grid validate
grid keygen
grid build
grid submit --registry http://localhost:4100
```

## Mimari kararların koddaki karşılığı

- **K1 — W3C'yi benimse:** `@grid/manifest` alan adları spec'i izler; GRID'e özgü her şey `x-grid` altında.
- **K4 — core + escape hatch:** handshake'te host capability'leri ∩ manifest beyanı MiniApp'e açılır; beyan edilmeyen süper güç *host sunsa bile* görünmez (en az yetki).
- **K5 — güven = hendek:** sürümler immutable + içerik-hash'li; paket geliştirici imzalı, sertifika GRID imzalı; runtime ikisini de launch'ta doğrular; host `kill` bastığında bir sonraki bridge çağrısı anında `GRID_KILLED` döner.
- **§5.5 — PII tutmayan broker:** MiniApp ham host kullanıcı id'sini asla görmez; `sub` host+app başına farklı bir pairwise pseudonym'dir, claim'ler capability-aware minimize edilir.

## Bilinçli Faz 0 sınırları

- Depolama bellek-içi (`RegistryStore` arayüzü arkasında) — Faz 1'de Postgres/Prisma.
- Statik analiz regex tabanlı ilk hat — AST analizi ve dinamik/sandbox tarama Faz 1 stage'i olarak eklenir.
- `MiniAppHost` transport-agnostik bridge sunucusudur; gerçek webview/iframe sandbox sarmalayıcısı (CSP, izole origin) bir sonraki adım.
- Developer/Host Console (React) ve matchmaking teklif akışı henüz yok (P0.5'in API tarafı hazır).
- Paketler dev modda `src/`'den çözülür (vitest); yayın için `pnpm build` `dist/` üretir.

## Yol haritası (dokümandan)

Faz 0 ✅ çekirdek runtime + tek adapter + sertifikasyon + registry →
Faz 1 ikinci Tier-1 host, Host Console, matchmaking, kalıcı depolama →
Faz 2 World/Telegram adapter'ları, self-serve Developer Console →
Faz 3 compile-target köprüsü (WeChat/Alipay), enterprise.
