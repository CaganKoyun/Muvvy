# GRID — P0 Master Prompt (Lovable görev paketi)

> **Yapıştırma talimatı:** Bu doküman fazlara bölünmüştür. Her FAZ'ı Lovable'a **ayrı ayrı, sırayla** yapıştır (tek seferde hepsini verme — migration'lar sırayla oturmalı). Her fazın sonunda "Kabul" maddelerini kontrol et, geçmeden sonraki faza geçme.

---

## BAĞLAM (her fazın başına eklenebilir kısa özet)

GRID bir **App2App2User dağıtım şebekesi**: geliştirici W3C MiniApp standardında bir paket yazar; GRID onu sertifikasyondan geçirip hazır kullanıcısı olan host'ların (super app / banka / telco / civic app) içine dağıtır. Bu Lovable projesi GRID'in **kontrol düzlemi**: iki konsol (Developer + Host) ve Supabase omurgası. Webview runtime/SDK ayrı bir TypeScript monorepo'sunda yaşıyor — Lovable'da runtime YOK; konsollar, veri modeli, sertifikasyon-lite hattı ve kill-switch VAR.

**Roller:** `developer` (MiniApp üretir, submit eder), `host_admin` (katalogdan seçer, onaylar, canlıya alır, kill-switch'e basar), `grid_admin` (insan review + her şeyi görür).

**Tasarım kuzey yıldızı — pazarlığa kapalı:**
- Uber-tarzı **monokrom minimalizm**: yalnızca siyah/beyaz + gri tonları (hsl token disiplini). Renk YOK; tek aksan foreground.
- Yüksek tipografi disiplini, bol beyaz alan, keskin köşeler (radius ≤ 8px).
- Görsel kartlar ~**327×163 yatay orana** yakın.
- **State-first:** her ekranda `empty / loading / error / success / permission-denied` durumları birinci sınıf tasarlanır (boş ekran = onboarding fırsatı).
- UI dili **Türkçe**.

---

## FAZ 1 — Temel: auth, roller, tasarım sistemi, iskelet

1. Supabase **email+password auth** kur. Kayıt akışında kullanıcı rol seçer: "Geliştiriciyim" / "Host yöneticisiyim".
2. Migration:
```sql
create type public.app_role as enum ('developer', 'host_admin', 'grid_admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  org_name text not null default '',
  role public.app_role not null default 'developer',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Rol kontrolü için SECURITY DEFINER helper (RLS içinde recursion'sız kullanım):
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;
```
   Signup trigger'ı ile `profiles` satırı otomatik oluşsun (`handle_new_user` deseni). `grid_admin` rolü UI'dan seçilemez — yalnız SQL ile atanır.
3. Route iskeleti (koruma: developer rotalarına yalnız developer, host rotalarına yalnız host_admin; yanlış rol → tasarlanmış `permission-denied` ekranı):
   - `/` — public landing: tek cümle değer önerisi ("Bir kez yaz, her host'ta yayınla"), iki CTA: "Geliştirici olarak başla" / "Host olarak başla".
   - `/dev` — Developer Console layout (sol nav: MiniApp'lerim, Yeni MiniApp, Analytics, Ayarlar)
   - `/host` — Host Console layout (sol nav: Katalog, Listinglerim, Placement, Analytics, Ayarlar)
   - `/admin` — grid_admin review kuyruğu (Faz 4'te dolacak, şimdilik boş-state)
4. Tasarım sistemi: monokrom token seti (`--background`, `--foreground`, 4 gri kademesi), tek font ailesi, kart bileşeni (327×163 oranlı), rozet bileşeni (cert durumu: `certified` dolu siyah / `pending_human_review` çizgili / `rejected` çerçeveli), durum makinesi rozeti (listing state).

**Kabul:** İki farklı rolle kayıt olunabiliyor; developer `/host`'a girince permission-denied ekranı görüyor; landing + iki boş konsol monokrom sistemle ayakta.

---

## FAZ 2 — Veri modeli + RLS + Storage (GRID §5.9 çekirdek varlıklar)

Migration:
```sql
create table public.miniapps (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.profiles(id) on delete cascade,
  app_id text not null unique,          -- ters alan adı: com.acme.todo
  name text not null,
  description text not null default '',
  category text not null default 'general',
  created_at timestamptz not null default now()
);

create type public.cert_status as enum ('certified','rejected','pending_human_review');

create table public.miniapp_versions (
  id uuid primary key default gen_random_uuid(),
  miniapp_id uuid not null references public.miniapps(id) on delete cascade,
  version_name text not null,
  version_code int not null check (version_code >= 1),
  manifest jsonb not null,
  package_path text not null,           -- storage yolu
  package_hash text not null,           -- sha256 hex
  cert_status public.cert_status not null,
  cert_findings jsonb not null default '[]'::jsonb,  -- [{severity,rule,message,file}]
  submitted_at timestamptz not null default now(),
  unique (miniapp_id, version_code)     -- sürümler immutable
);

create table public.hosts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null unique,            -- spark, istanbul-senin
  name text not null,
  tier int not null default 1 check (tier between 1 and 3),
  host_type text not null check (host_type in ('bank','telco','civic','super_app','wallet')),
  capabilities text[] not null default '{}',  -- identity.kyc, pay.native, ...
  created_at timestamptz not null default now()
);

create type public.listing_state as enum ('requested','approved','live','paused','removed');

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  miniapp_version_id uuid not null references public.miniapp_versions(id) on delete cascade,
  host_id uuid not null references public.hosts(id) on delete cascade,
  state public.listing_state not null default 'requested',
  placement text[] not null default '{}',     -- featured, search, category:x
  requested_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (miniapp_version_id, host_id)
);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  event_type text not null check (event_type in ('activation','usage','transaction')),
  created_at timestamptz not null default now()
);
```

**RLS (hepsi enable; yazma yolları Faz 3-4'teki edge function'lardan service_role ile):**
```sql
alter table public.miniapps enable row level security;
alter table public.miniapp_versions enable row level security;
alter table public.hosts enable row level security;
alter table public.listings enable row level security;
alter table public.analytics_events enable row level security;

-- Developer: kendi app'leri
create policy "dev own apps" on public.miniapps for select using (developer_id = auth.uid());
create policy "dev insert apps" on public.miniapps for insert
  with check (developer_id = auth.uid() and public.my_role() = 'developer');
create policy "dev own versions" on public.miniapp_versions for select
  using (exists (select 1 from public.miniapps m where m.id = miniapp_id and m.developer_id = auth.uid()));

-- Host: SADECE sertifikalı sürümler katalogda görünür (güven hattı!)
create policy "host catalog" on public.miniapp_versions for select
  using (public.my_role() in ('host_admin','grid_admin') and cert_status = 'certified');

create policy "hosts readable" on public.hosts for select using (auth.uid() is not null);
create policy "host insert own" on public.hosts for insert
  with check (owner_id = auth.uid() and public.my_role() = 'host_admin');

-- Listing: ilgili developer + ilgili host okur; INSERT/UPDATE yalnız edge function (service_role)
create policy "listing read dev" on public.listings for select
  using (exists (select 1 from public.miniapp_versions v join public.miniapps m on m.id = v.miniapp_id
                 where v.id = miniapp_version_id and m.developer_id = auth.uid()));
create policy "listing read host" on public.listings for select
  using (exists (select 1 from public.hosts h where h.id = host_id and h.owner_id = auth.uid()));

-- Analytics: aynı görünürlük; INSERT yalnız service_role
create policy "events read dev" on public.analytics_events for select
  using (exists (select 1 from public.listings l
                 join public.miniapp_versions v on v.id = l.miniapp_version_id
                 join public.miniapps m on m.id = v.miniapp_id
                 where l.id = listing_id and m.developer_id = auth.uid()));
create policy "events read host" on public.analytics_events for select
  using (exists (select 1 from public.listings l join public.hosts h on h.id = l.host_id
                 where l.id = listing_id and h.owner_id = auth.uid()));

-- grid_admin her şeyi okur:
create policy "admin all miniapps" on public.miniapps for select using (public.my_role() = 'grid_admin');
create policy "admin all versions" on public.miniapp_versions for select using (public.my_role() = 'grid_admin');
create policy "admin all listings" on public.listings for select using (public.my_role() = 'grid_admin');
```

**Storage:** `packages` bucket'ı (private). Upload yalnız authenticated developer, path deseni `packages/{app_id}/{version_code}.zip`; indirme yalnız signed URL ile.

**Kabul:** Tablolar + RLS oturdu; anon hiçbir tabloyu okuyamıyor; developer başka developer'ın app'ini göremiyor; host yalnız `certified` sürümleri görebiliyor.

---

## FAZ 3 — Developer Console (GRID §7.3–7.5)

1. **MiniApp'lerim** (`/dev`): kart grid'i (327×163). Boş state: "İlk MiniApp'ini 10 dakikada dağıtıma sok" + CTA. Kartta: ad, app_id, son sürüm, cert rozeti, canlı listing sayısı.
2. **Manifest Wizard** (`/dev/new`, 5 adım — elle JSON yazdırma):
   - *Kimlik:* ad, `app_id` (ters alan adı deseni `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`, canlı doğrulama), kategori (select: general/finance/health/kids/commerce/travel), açıklama.
   - *Sayfalar:* rota listesi (ör. `pages/home`), ilk satır = ana sayfa, ekle/sil/sürükle-sırala.
   - *İzinler & capability:* izin checkbox'ları (`geolocation, camera, microphone, notifications, clipboard, storage, payment, identity.basic`) + her seçili izin için zorunlu `reason` alanı; capability matrisi: `identity.kyc / identity.proof_of_personhood / social.graph / pay.native` her biri için `gerekli / opsiyonel / kullanmıyor` üçlü toggle.
   - *Monetizasyon:* `free / host_pay / user_pay / commission` + take-rate önizleme metni.
   - *Doğrulama & paket:* wizard çıktısından W3C manifest JSON'u üret ve göster (`app_id, name, version{name,code}, pages[], req_permissions[], x-grid{category, monetization, capabilities{required[],optional[]}}`), linter uyarıları listelensin; kullanıcı `.zip` paketini yükler → **submit** butonu Faz 4'teki `submit-version` edge function'ını çağırır.
3. **MiniApp detay** (`/dev/apps/:id`): sürüm listesi (immutable; en yeni üstte), her sürümde cert rozeti + **cert_findings** paneli (severity ikonlu, kural kodu + mesaj — red gerekçesi burada okunur), manifest görüntüleyici.
4. **Host hedefleme** (`/dev/apps/:id/targets`): host kartları (ad, tier rozeti, tip, capability listesi). **Uygunluk sinyali** client-side hesaplanır: manifest'in `required` capability'leri host'un `capabilities` dizisinde tamamsa "TAM", yalnız `optional` eksikse "KISITLI", `required` eksikse "UYUMSUZ" + eksik capability adı. "Listing iste" butonu (yalnız certified sürüm + TAM/KISITLI host'ta aktif) → `request-listing` edge function.
5. **Analytics** (`/dev/analytics`): host bazında tablo: listing state, activation, usage, transaction sayıları (analytics_events'ten aggregate), 30 günlük çizgi grafik (monokrom).

**Kabul:** Wizard'dan geçerli manifest üretiliyor; zip + submit çalışıyor; red gerekçeleri sürüm detayında görünüyor; uygunluk sinyali üç durumu doğru gösteriyor.

---

## FAZ 4 — Edge Functions: sertifikasyon-lite + listing durum makinesi (GRID §5.6, P0.3)

> Tüm yazma işlemleri bu fonksiyonlardan geçer (service_role). Client doğrudan INSERT/UPDATE yapmaz.

1. **`submit-version`** (auth: developer, kendi app'i):
   - Girdi: `miniapp_id`, manifest JSON, storage'a yüklenmiş zip yolu.
   - Adımlar: (a) manifest lint (zorunlu alanlar, app_id deseni, pages boş değil, version_code integer ve mevcut max'tan büyük); (b) zip'i indir, sha256 hesapla; (c) **statik analiz** — zip içindeki `.js/.html` dosyalarında şu desenler `block` bulgusu üretir:
     `eval(` · `new Function(` · `document.cookie` · `parent.location|top.location` · `<script ... src="http` (uzak script) — ve tutarlılık kuralları: kodda `navigator.geolocation` var ama manifest'te `geolocation` izni yoksa block; kodda `grid.core.pay` var ama `payment` izni yoksa block; kodda `grid.capabilities.identity.kyc` var ama capability beyanı yoksa block. `http://` (localhost hariç) yalnız `warn`.
   - Karar: block bulgusu varsa `cert_status='rejected'`; kategori `finance|health|kids` ise ve block yoksa `pending_human_review`; aksi halde `certified`. Her durumda `miniapp_versions` satırı bulgularla yazılır (immutable — aynı version_code ikinci kez 409).
2. **`review-version`** (auth: yalnız grid_admin): `pending_human_review` → `certified` ya da `rejected` (+ not). `/admin` sayfası bu kuyruk: bekleyen sürümler, manifest + bulgular, Onayla/Reddet.
3. **`request-listing`** (auth: developer): certified sürüm için `listings(state='requested')`.
4. **`transition-listing`** (auth: ilgili host'un sahibi): durum makinesi **sunucuda** doğrulanır:
   - `approve`: requested→approved · `live`: approved|paused→live (placement[] ile) · `kill`: live|approved→paused · `remove`: her durumdan→removed. Geçersiz geçiş → 409.
5. **`ingest-event`** (auth: host sahibi): `analytics_events` insert; listing `live` değilse 409 (kill sonrası olay akmaz).

**Kabul (P0.3 birebir):** `eval` içeren zip submit edilince otomatik red + gerekçeler `cert_findings`'te; finance kategorisi insan review kuyruğuna düşüyor ve `/admin`'den onaylanabiliyor; `kill` çağrısı listing'i anında `paused` yapıyor ve iki konsolda da **Supabase Realtime aboneliğiyle ≤5 sn içinde** rozet güncelleniyor (sayfa yenilemeden).

---

## FAZ 5 — Host Console (GRID §7.6)

1. **Katalog** (`/host`): certified sürümlerin kart grid'i; filtreler: kategori, capability (çoklu), metin arama. Boş state: "Katalog dolduğunda burada görünecek".
2. **MiniApp detay + güven raporu** (`/host/catalog/:versionId`): manifest özeti, izin listesi (her izin `reason` ile), capability gereksinimleri, **güven raporu**: cert rozeti, statik analiz `warn` bulguları, paket hash'i, submit tarihi, "kill-switch her an kullanılabilir" notu. Kendi host'u için uygunluk sinyali (TAM/KISITLI/UYUMSUZ). CTA: **"İste / Onayla"**.
3. **Listinglerim** (`/host/listings`): durum makinesine göre gruplu liste (requested/approved/live/paused). Her satırda duruma uygun aksiyonlar: Onayla → Canlıya al (placement seçimiyle: `featured / search / category:<slug>`) → **KILL** (kırmızı değil — monokrom; dolu siyah, onay dialog'lu) → Yeniden canlıya al.
4. **Placement yöneticisi** (`/host/placement`): live listing'ler placement grubuna göre sürükle-bırak sıralanır.
5. **Analytics** (`/host/analytics`): app bazında activation/usage/transaction tablosu + 30 günlük grafik.
6. **Host kurulumu** (`/host/settings`): host profili — ad, slug, tier, tip, capability checkbox'ları (`identity.basic, identity.kyc, identity.proof_of_personhood, social.graph, pay.native`).

**Kabul:** requested→approved→live akışı UI'dan yürüyor; KILL basınca ≤5 sn'de her iki konsolda paused görünüyor; katalogda rejected/pending sürümler ASLA görünmüyor.

---

## FAZ 6 — Cila: state-first tarama + tohum verisi

1. Tüm ekranları `empty / loading (skeleton) / error (retry butonlu) / permission-denied` durumları için tara; eksikleri tamamla.
2. Tohum verisi (SQL seed): 2 host (`spark` — super_app, tier 1, `{identity.basic, identity.kyc, pay.native}`; `istanbul-senin` — civic, tier 1, `{identity.basic}`) ve 3 örnek MiniApp (biri `finance` kategorili → review kuyruğunu göstermek için).
3. Landing'e canlı sayaçlar: bağlı host sayısı, sertifikalı MiniApp sayısı, canlı listing sayısı (GRID §11 leading metrikleri).

**Kabul:** Demo senaryosu uçtan uca oynanabiliyor: developer kaydol → wizard → submit → (finance ise admin onayı) → host kataloğunda gör → iste → onayla → canlıya al → analytics olayı → KILL → developer tarafında paused.

---

## KAPSAM DIŞI (bilinçli — sorma, ekleme)
- Webview runtime, GRID Bridge SDK, ed25519 imza/sertifika kriptografisi → ayrı TypeScript monorepo'sunda (bu konsollar ileride o registry API'sine bağlanacak; şimdilik Supabase kayıt sistemi yeterli).
- Ödeme/settlement, take-rate hesabı, müzakere/karşı-teklif akışı (Faz sonrası).
- Compile-target (WeChat/Alipay), çoklu dil (UI Türkçe tek dil).
