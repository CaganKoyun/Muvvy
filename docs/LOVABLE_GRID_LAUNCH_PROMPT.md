# GRID — Canlıya Çıkış Master Prompt (Lovable görev paketi, P0 sonrası → LAUNCH)

> **Ön koşul:** `LOVABLE_GRID_P0_PROMPT.md`'deki Faz 1–6 tamamlanmış olmalı (auth+roller, veri modeli+RLS, Developer Console, cert-lite edge function'ları, Host Console, tohum verisi).
> **Yapıştırma talimatı:** Fazları **SIRAYLA ve TEK TEK** yapıştır. Her fazın "Kabul" maddeleri geçmeden sonrakine geçme. Migration içeren fazlarda Lovable'ın ürettiği SQL'i onaylamadan önce oku.
> **Tasarım kuralı değişmedi:** Uber-tarzı monokrom, state-first (empty/loading/error/success/permission-denied), UI Türkçe, kartlar ~327×163.

---

## FAZ A — CONNECT: Host ↔ Developer bağlantı ve müzakere akışı (GRID §6.3, §7.6)

Şu ana kadar listing tek taraflı istekti. Şimdi gerçek **iki taraflı connect** akışı:

1. Migration:
```sql
create type public.offer_state as enum ('offered','countered','accepted','declined','expired');

create table public.listing_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id),
  take_rate_pct numeric(5,2) not null check (take_rate_pct between 0 and 50),
  duration_months int not null default 12 check (duration_months between 1 and 60),
  exclusive boolean not null default false,
  note text not null default '',
  state public.offer_state not null default 'offered',
  created_at timestamptz not null default now()
);
alter table public.listing_offers enable row level security;
-- Okuma: listing'in developer'ı ve host sahibi (P0'daki listing read politikalarıyla aynı join deseni).
-- Yazma: yalnız edge function (service_role).

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,            -- offer_received / offer_accepted / listing_live / listing_killed / version_certified / version_rejected / review_pending
  title text not null,
  body text not null default '',
  link text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "mark read" on public.notifications for update using (user_id = auth.uid());
```
2. **`negotiate-offer` edge function** (service_role yazar): aksiyonlar `offer / counter / accept / decline`. Kurallar sunucuda: yalnız listing'in iki tarafı; `counter` önceki teklifi `countered` yapıp yenisini açar; `accept` → teklif `accepted` + listing `approved`'a geçer; açık teklif varken yeni `offer` açılamaz (409). Her aksiyon karşı tarafa `notifications` satırı yazar.
3. **UI — Host tarafı:** katalog detayındaki "İste/Onayla" butonu artık **teklif formu** açar: take-rate slider (0–50), süre, exclusivity toggle, not. Listinglerim'de "Müzakere" sekmesi: teklif zaman çizelgesi (kim, ne önerdi, durum), Kabul/Karşı Teklif/Reddet aksiyonları.
4. **UI — Developer tarafı:** `/dev/apps/:id/targets`'ta gelen teklifler rozeti; teklif detayında aynı zaman çizelgesi + Kabul/Karşı Teklif/Reddet.
5. **Bildirim merkezi (her iki konsolda):** üst barda zil ikonu + okunmamış sayacı (Realtime ile canlı), açılır panel, tümünü okundu işaretle. Bildirime tıklayınca `link`'e gider.

**Kabul:** Host teklif verir → developer'a anında bildirim düşer → developer karşı teklif → host kabul → listing `approved` olur ve iki tarafta da bildirim + rozet günceller. Aynı listing'de ikinci açık teklif 409.

---

## FAZ B — STORE: Discovery Gallery (GRID §7.2 yüzey 3)

İki galeri yüzeyi — ikisi de **yalnız `live` listing'leri** gösterir:

1. **Public Gallery** (`/gallery`, auth gerektirmez):
   - Grid: MiniApp kartları (ikon, ad, kategori, hangi host'larda canlı — host rozetleri).
   - Filtre: kategori, host, capability; metin arama (ad + açıklama, `ilike`).
   - Detay sayfası `/gallery/:appSlug`: açıklama, ekran bilgileri, izin listesi (reason'larıyla — güven şeffaflığı), canlı olduğu host'lar, "Bu host'ta aç" düğmeleri (şimdilik host'un derin-link şablonuna gider, Faz C'de tanımlanır).
   - RLS için `security definer` view: `public.gallery_view` — yalnız live listing'i olan certified sürümlerin gerekli alanlarını (manifest'ten ad/kategori/izin özeti) expose eder; `anon`'a yalnız bu view'a select ver. **Ham tablolara anon erişimi asla açma.**
2. **Host-içi gömülü galeri** (`/embed/gallery/:hostSlug`):
   - Chrome'suz, iframe'e gömülebilir sade sayfa: o host'ta live olan MiniApp'ler, host'un placement sıralamasıyla (`featured` üstte, sonra placement grubu, sonra alfabetik).
   - Query param `?theme=light|dark` (ikisi de monokrom).
   - `X-Frame-Options` engellenmez; yalnız bu route iframe'e izinli olsun.
3. **Sıralama sinyali (GRID §5.7):** galeri sıralaması = placement önceliği → son 30 gün activation sayısı → yenilik. Tek bir `order by` ifadesinde çözülebilir; ölçüm için `gallery_view`'a activation sayısı join'le.

**Kabul:** Anonim kullanıcı `/gallery`'de yalnız canlı app'leri görüyor; kill edilen app galeriden anında düşüyor; `/embed/gallery/spark` iframe içinde çalışıyor; anon hiçbir ham tabloyu sorgulayamıyor.

---

## FAZ C — CONNECT: Host runtime entegrasyon yüzeyi (anahtar + derin link + webhook)

Host'un GRID'i kendi uygulamasına bağlaması için gereken her şey:

1. Migration:
```sql
create table public.host_api_keys (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.hosts(id) on delete cascade,
  key_prefix text not null,                 -- gösterim için ilk 8 karakter
  key_hash text not null,                   -- sha256(anahtar); düz anahtar ASLA saklanmaz
  label text not null default 'default',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.host_api_keys enable row level security;
create policy "host keys read" on public.host_api_keys for select
  using (exists (select 1 from public.hosts h where h.id = host_id and h.owner_id = auth.uid()));

alter table public.hosts add column deep_link_template text not null default '';
-- ör. "spark://miniapp/{app_id}" — Public Gallery "Bu host'ta aç" bunu doldurur.
alter table public.hosts add column webhook_url text not null default '';
```
2. **`issue-host-key` edge function:** yeni anahtar üretir (`grid_hk_` + 32 rasgele bayt base64url), sha256'sını yazar, **düz anahtarı yalnız bir kez** yanıtta döndürür. Revoke aksiyonu `revoked_at` set eder.
3. **`host-catalog` edge function (host'un sunucusu çağırır):** `Authorization: Bearer <anahtar>` → hash eşleşen, revoke edilmemiş anahtar → o host'un live listing'lerini JSON döndürür (app_id, ad, sürüm, package storage **signed URL** — 15 dk geçerli, manifest). Yanlış/revoked anahtar → 401. Basit rate limit: anahtar başına dakikada 60 istek (aşımda 429) — sayacı `host_api_usage(key_id, minute, calls)` tablosunda tut.
4. **Webhook bildirimi:** `transition-listing` fonksiyonunu genişlet — listing state değişince host'un `webhook_url`'ine (varsa) `POST {event:"listing.state_changed", listing_id, app_id, new_state}` at (başarısızlık akışı bozmaz, sadece loglanır). Böylece host, kill-switch'i kendi tarafında da anında uygular.
5. **UI — Host Console `/host/settings` genişler:** "Entegrasyon" sekmesi — API anahtarları (üret/kopyala-bir-kez/revoke), deep link şablonu alanı, webhook URL alanı + "Test gönder" butonu, ve kopyala-yapıştır **entegrasyon dökümanı kartı** (curl örneğiyle `host-catalog` çağrısı).

**Kabul:** Anahtar üretiliyor ve yalnız bir kez gösteriliyor; doğru anahtarla `host-catalog` canlı katalog + çalışan signed URL dönüyor; revoke sonrası 401; kill sonrası webhook düşüyor ve katalog yanıtından app kayboluyor.

---

## FAZ D — Ekran ve işlev tamamlama (konsol boşluklarını kapat)

1. **Org & üye yönetimi:** `org_members(org_owner_id, member_id, role: owner|editor)` — developer ve host hesapları e-postayla üye davet eder (davet tablosu + kabul akışı). Editor her şeyi yapar ama üye yönetemez ve API anahtarı üretemez. Tüm RLS politikaları "sahip VEYA üye" olacak şekilde güncellenir (helper: `public.is_org_member(owner_id uuid)`).
2. **Hesap ayarları (iki konsolda):** profil (ad, org adı), e-posta değiştirme, şifre sıfırlama, **hesap silme** (soft delete + 30 gün — KVKK). Oturum yönetimi: "diğer oturumları kapat".
3. **Sürüm yaşam döngüsü ekranları:** sürüm karşılaştırma (iki sürümün manifest diff'i), changelog alanı (submit'te istenir), "bu sürüme sabitle/son sürüme güncelle" tercihi listing düzeyinde (`listings.version_policy: pinned|auto`) — auto ise yeni certified sürüm geldiğinde listing otomatik yeni sürümü işaret eder ve host'a bildirim düşer.
4. **Admin paneli tamamlama (`/admin`):** review kuyruğu (P0'dan) + tüm host/developer/app listesi, arama, herhangi bir listing'i durdurabilme (platform kill), audit log görünümü (aşağıdaki Faz E tablosundan).
5. **Boş kalan tüm CRUD uçları:** MiniApp düzenleme (ad/açıklama/kategori — app_id değişmez), host profili düzenleme, listing'den çekilme (developer tarafı `remove` isteği).

**Kabul:** Davet edilen editor üyeler org'un app'lerini/listinglerini görüp yönetebiliyor ama üye ekleyemiyor; auto-update listing yeni sürümde kendini güncelleyip bildirim atıyor; admin platform-kill yapabiliyor.

---

## FAZ E — Production sertleştirme (canlı öncesi zorunlu)

1. **Audit log:** `audit_log(id, actor_id, action, entity, entity_id, meta jsonb, created_at)` — TÜM edge function'lar her yazma işleminde satır ekler. RLS: yalnız grid_admin okur.
2. **Rate limiting:** tüm public edge function'lara kullanıcı/IP başına dakika kotası (submit: 5/dk, negotiate: 20/dk, ingest-event: 120/dk); aşımda 429 + UI'da nazik hata.
3. **Girdi doğrulama taraması:** her edge function gövdesi zod ile şema-doğrulanır; manifest boyut sınırı 256 KB, zip 10 MB; storage upload MIME/uzantı kontrolü; tüm kullanıcı metinleri render'da escape (XSS).
4. **RLS denetimi:** her tablo için şunu test eden bir kontrol listesi çıkar ve uygula — (a) anon hiçbir ham tabloya erişemez, (b) rol X yalnız kendi satırlarını görür, (c) INSERT/UPDATE yolları yalnız edge function'larda. `security definer` fonksiyonlarda `set search_path = public` zorunlu.
5. **E-posta:** kritik bildirimler (teklif geldi, sürüm reddedildi, listing kill) için transactional e-posta edge function'ı; **yalnız service_role çağırabilir**; link'ler yalnız kendi domain'ine işaret eder. Günlük kullanıcı başına e-posta tavanı (10).
6. **KVKK/GDPR asgarisi:** `/privacy` aydınlatma metni sayfası, kayıt ekranında onay kutusu (+ `profiles.consented_at`), hesap silme akışı (Faz D) veriyi 30 günde temizleyen zamanlanmış fonksiyona bağlanır, `analytics_events` PII içermez (zaten içermiyor — koru).
7. **Hata ve durum:** global error boundary (tasarlanmış hata ekranı + "tekrar dene"), 404 sayfası, `/status` basit sağlık sayfası (DB'ye ping).
8. **Performans:** liste sorgularına sayfalama (20'şer, cursor), N+1 join'leri view'larla çöz, görsellere lazy-load, Lighthouse ≥ 90 hedefi.

**Kabul:** Anon kullanıcıyla yapılan agresif deneme (doğrudan tablo sorguları, başkasının id'siyle çağrılar, kota aşımı) hep 4xx ile dönüyor; audit log'da tüm yazmalar izleniyor; e-posta yalnız meşru olaylarda gidiyor.

---

## FAZ F — Launch: SEO, seed, smoke test, go-live

1. **Landing'i satışa hazırla:** hero (tek cümle: "Bir kez yaz, hazır kullanıcısı olan her host'ta yayınla"), nasıl-çalışır 3 adım (Yaz → Sertifikalan → Yayıl), canlı metrik sayaçları, host ve developer için ayrı CTA blokları, SSS (6 soru: standart, güvenlik/sertifikasyon, kill-switch, ücretlendirme, KVKK, nasıl başlarım). Meta/OG etiketleri + sitemap + favicon (monokrom G harfi).
2. **Gerçekçi seed:** 2 host + 6 MiniApp (2'si finance→review kuyruğu demo'su, 4'ü certified+live), 30 günlük sentetik analytics olayları — grafikler boş açılmasın.
3. **Smoke test senaryoları (hepsini sırayla koş, geçmeyen varsa düzelt):**
   - S1: Yeni developer → wizard → temiz zip submit → certified → host teklif → müzakere → live → galeri'de görünür.
   - S2: `eval` içeren zip → rejected + gerekçeler ekranda.
   - S3: finance app → review kuyruğu → admin onay → certified.
   - S4: KILL → ≤5 sn iki konsol + galeri + `host-catalog` API'sinden düşer + webhook.
   - S5: Editor davet → kabul → org app'ini düzenleyebilir, anahtar üretemez.
   - S6: Anon: galeri açılır, tüm konsol rotaları login'e yönlenir, ham tablo sorguları boş/403.
4. **Go-live kontrol listesi:** custom domain + SSL, Supabase prod anahtar rotasyonu (dev anahtarlarını revoke et), auth e-posta şablonları Türkçe, yedekleme (PITR) açık, `grid_admin` yalnız gerçek hesabında.

**Kabul:** 6 smoke senaryosu da geçiyor; landing OG önizlemesi doğru; checklist tamam.

---

## KAPSAM DIŞI (bilinçli — sorma, ekleme)
- Webview runtime / Bridge SDK / ed25519 sertifika kriptografisi → TypeScript monorepo'da (host'lar Faz C'deki API + webhook üzerinden bağlanır).
- Gerçek para hareketi / settlement / payout (take-rate şimdilik sözleşme kaydı; ödeme rayı sonraki sürüm).
- Compile-target (WeChat/Alipay), çoklu dil, native SDK.
