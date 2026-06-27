# Muvvy — Pre-Production Audit

**Tarih:** 2026-06-27
**Kapsam:** Sayfalar & akışlar, edge API'leri, mimari, veritabanı/RLS güvenliği, fonksiyonel doğruluk, UI/UX, erişilebilirlik (a11y), i18n, build/deploy hazırlığı.
**Yöntem:** Kod tabanının tamamı (≈90 route, ≈150 component, ~40 edge function, ~100 migration) altı paralel uzman denetimiyle tarandı; başlık (Critical/High) bulgular ayrıca elle doğrulandı (`file:line` kanıtlı).

> Bu rapor yalnızca **bulgu ve öneri** içerir; kodda değişiklik yapılmamıştır. Aşağıdaki "BLOCKER" maddeleri prod'a çıkmadan önce kapatılmalıdır.

---

## 0. Yönetici Özeti (Verdict)

Ürün mimari olarak **olgun**: RLS modeli (private-schema görünürlük yardımcıları, `has_role()` deseni, FORCE RLS, SECURITY DEFINER RPC'lerde REVOKE/GRANT), edge auth helper'ları, sign-out cache temizliği, XSS'e karşı temiz render katmanı, gerçek bir RLS senaryo testi — hepsi iyi yapılmış. **Ancak prod'a bu haliyle çıkılmamalı.** İki tanesi tek başına çekirdek işlevi/gizliliği kıran **dört blocker** ve önemli sayıda yüksek öncelikli bulgu var.

### 🚨 Prod'u durduran bulgular (BLOCKER)

> ⚠️ **DÜZELTME (2026-06-27, sonraki denetim turunda):** Aşağıdaki **C-1 GERİ ÇEKİLDİ — yanlış pozitifti.** Silinen 5 trigger **duplicate**'ti; aynı fonksiyonları çağıran orijinal trigger'lar (`on_friend_accept`, `trg_friend_accept`, `trg_messages_bump_conv`, `trg_friend_request_responded_at`, `trg_match_promote`, `trg_match_decision_guard`) hiç silinmedi. Migration `100559` duplicate yarattı, `100624` sadece onları düşürdü → taze DB'de friend-accept, chat sıralaması, cooldown, match **hepsi çalışır.** (İlk turda sadece *silinen trigger adları* arandı; fonksiyon izlenince yakalandı — bkz. `PRE_PROD_AUDIT_UX_SCALE.md`.) Gerçek blocker'lar C-2/C-3/C-4'tür.

| # | Başlık | Alan | Etki |
|---|--------|------|------|
| ~~**C-1**~~ | ~~5 çekirdek trigger migration ile silinmiş~~ → **GERİ ÇEKİLDİ (false positive)** | DB | Trigger'lar duplicate'ti; orijinaller yaşıyor, akışlar çalışıyor |
| **C-2** | `friendships` tablosuna self-insert RLS açığı | Güvenlik | Saldırgan tek satırla istediği kullanıcıyla "arkadaş" olup tüm friends-tier özel veriye erişir — "Sovereignty" sözünü çürütür |
| **C-3** | `send-transactional-email`: kimlik doğrulamasız, herhangi bir adrese Muvvy markalı e-posta gönderimi | Edge API | Phishing/spam, gönderen itibarı (sender reputation) hasarı |
| **C-4** | AI uçları kimlik doğrulamasız & kotasız → sınırsız LLM maliyeti | Edge API | Denial-of-wallet; public anon key ile sömürülebilir |

### Genel sayılar
- **Güvenlik (DB+Edge+FE):** 1 Critical privacy bypass, 2 Critical edge, +6 orta/düşük.
- **Fonksiyonel:** 3 Critical, 6 High, 7 Medium, 8 Low.
- **UI/UX/a11y/i18n:** 6 High, ~10 Medium, çok sayıda Low. En görünür: lokalizasyonun %43'ü eksik + ~89 hardcoded (çoğu Türkçe) toast.
- **Build/Deploy:** 4 High (CSP/header yok, `.env` gitignore'da değil, 3 lockfile, ölü PWA), +6 orta/düşük.

---

## 1. Güvenlik

### 1.1 Veritabanı / RLS

#### 🔴 C-2 [CRITICAL] `friendships` self-insert → tüm friends-tier gizliliği baypas
- **Kanıt:** `supabase/migrations/20260320220705_...sql:34`
  `CREATE POLICY "Users can insert friendships" ON public.friendships FOR INSERT WITH CHECK (auth.uid() = user_id);`
  Hiçbir sonraki migration bu policy'yi kaldırmıyor/sıkmıyor (doğrulandı).
- **Mekanizma:** `are_friends(a,b)` simetrik (`... = a AND ... = b) OR (... = b AND ... = a)`). Saldırgan doğrudan `/rest/v1/friendships`'e `{user_id: <ben>, friend_id: <kurban>}` POST'lar; tek satır `are_friends(ben, kurban) = true` yapar. İstek/onay/rıza gerekmez.
- **Etki:** Anında friends-tier okuma: kurbanın `ratings`, `favorites`, `diary`, `taste_preferences`, watchlist/custom_lists, friends-audience `moments`/yorum/beğeni, `activity_feed`, tam `profiles` satırı. Uygulamanın "Sovereignty"/gizlilik vaadini doğrudan çürütür. (`close_friends` tier'ı `set_close_friend` sayesinde etkilenmez; ama `friends` tier'ı çoğu özel yüzeyi kapsar.)
- **Fix:** Client INSERT grant/policy'sini kaldır. Friendship yalnızca `handle_friend_accept` trigger'ı / `send_friend_request` definer RPC ile yazılmalı. `REVOKE INSERT ON public.friendships FROM authenticated;` + INSERT policy'sini düşür veya çift yönlü accepted `friend_requests` şartına bağla.

#### 🟠 [MEDIUM] `friend_requests` UPDATE'inde `WITH CHECK` yok — alıcı her kolonu değiştirebilir
- **Kanıt:** `20260320220705_...sql:20` — `FOR UPDATE USING (auth.uid() = receiver_id)` (WITH CHECK yok).
- **Etki:** Alıcı `sender_id`/`receiver_id`/`created_at`'i de değiştirebilir; `handle_friend_accept` `AFTER UPDATE OF status` ile yeniden yazılmış taraflardan friendship üretebilir (unique index kısmen sınırlar).
- **Fix:** `WITH CHECK (auth.uid() = receiver_id AND sender_id sabit)`; sadece `status` güncellenebilsin diye BEFORE UPDATE guard trigger (mevcut `guard_match_decision` deseni).

#### 🟠 [MEDIUM] Bildirim sahteciliği — herhangi bir kullanıcıya
- **Kanıt:** `20260410062431_...sql:20-22` — `WITH CHECK (auth.uid() = from_user_id)` yalnızca göndereni sabitler; hedef `user_id` ve `type`/`content` saldırganın kontrolünde.
- **Etki:** Bildirim spam'i / phishing metni başka kullanıcının feed'ine.
- **Fix:** Geniş client INSERT policy'sini kaldır; bildirimleri yalnızca definer trigger/RPC üretsin (kod zaten beğeni/yorum/takip için bunu yapıyor). Gerekiyorsa `type` allowlist + ilişki şartı.

#### 🟠 [MEDIUM] `discussion_messages`/`discussion_rooms` tamamen public, moderasyon yok
- **Kanıt:** `20260410065154_...sql:106-119` — rooms `SELECT USING (true)`, `INSERT WITH CHECK (true)`; mesajlar `SELECT USING (true)`. Block-list uygulanmıyor, `spoiler_gated` kolonu RLS'te zorlanmıyor.
- **Fix:** Public forum kasıtlıysa en az moderatör delete policy'si (`has_role(...,'moderator')`) + blocked kullanıcı mesajlarını dışla. Prod öncesi karar netleşsin.

#### 🟡 [LOW] Hardening
- Email-queue definer fonksiyonları (`enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`) `SET search_path` pinlenmemiş (`20260620195746_email_infra.sql:137-197`). Dinamik SQL yok + sadece `service_role`'a grant → istismar düşük; yine de pinle.
- `guard_match_decision()` DEFINER değil ve search_path yok (`20260626084646_...:205`). Fonksiyonel sorun yok; tutarlılık için pinle.
- `chat_config` anon+authenticated'a world-readable (`20260626113041_...:36,40`). Bugün sadece `start_conversation_daily_cap` tutuyor; "buraya asla secret koyma" notu + ileride büyürse SELECT'i daralt.

#### ✅ DB tarafında doğru yapılanlar
Roller ayrı `user_roles` tablosunda (`profiles`'da `role`/`is_admin` yok → ayrıcalık yükseltme yok); DM'ler katılımcı-only + block-aware + pending-burst cap; görünürlük helper'ları `private` şemada (anon'a grant yok); `security_invoker=true` view'lar; e-posta PII tabloları service_role-only; `EXECUTE format()` yalnızca katalog kaynaklı `%I` (SQL injection yok); gerçek RLS testi (`supabase/tests/privacy_rls.sql`).

### 1.2 Edge Functions / API

#### 🔴 C-3 [CRITICAL] `send-transactional-email`: kimlik doğrulamasız keyfi-alıcı e-posta gönderimi
- **Kanıt:** `send-transactional-email/index.ts:28-118`. `verify_jwt=true` yalnızca **public anon key** ister; in-code kullanıcı/rol kontrolü **yok** (28-30 satırı "no in-function auth check is needed" diyor). Public anon key client bundle'da.
- **Etki:** Anon key'i olan herkes `{templateName, recipientEmail, templateData}` POST'layıp `noreply@notify.muvvy.now`'dan Muvvy markalı e-posta kuyruğa atar. `templateData` template'lere sanitize edilmeden geçiyor (`:282`) → görünür gövde içeriği kısmen saldırgan kontrolünde. Phishing-as-Muvvy, spam, sender-reputation hasarı.
- **Fix:** `requireUser`/service-role zorunlu; çağıran `recipientEmail`'in sahibi olmalı (ya da yalnızca service-role çağırabilsin — tek meşru çağıran `signup-welcome`). `templateData` ve `ctaUrl` host'unu allowlist'le.

#### 🔴 C-4 [CRITICAL/HIGH] AI uçlarında kimlik doğrulamasız & kotasız LLM maliyeti
- **Kanıt:**
  - `cinema-chat/index.ts:1110-1158` — `verifyJwt` anon'a izin veriyor; anon tam tool-loop'u (request başına 8 Gemini çağrısına kadar) tetikler.
  - `cinema-context/index.ts:128-204` — yalnızca *geçersiz* token'ı reddeder; anon geçer → Wikipedia fetch + Gemini.
  - `movie-games/index.ts:47-51` — `verifyJwt` çağırır ama **asla reddetmez** ("proceeding as anon").
  - `smart-recommend/index.ts:24-116` — anon'a izin, yine Gemini çağırır.
  - `cinema-chat-demo` rate-limit'i `x-forwarded-for`'a dayalı (`:148`) → **spoof edilebilir**, trivially baypas.
- **Etki:** Sınırsız LLM harcaması (denial-of-wallet), public anon key ile sömürülebilir.
- **Fix:** Generatif uçlar için kimlik doğrulanmış kullanıcı (veya imzalı nonce) zorunlu; server-side per-user/gün kota tablosu; kimlik için `x-forwarded-for`'a güvenme — doğrulanmış user id kullan.

#### 🟠 M [MEDIUM] `compute-taste-twin-weekly`: `CRON_SECRET` yoksa anon tetikler (fail-open)
- **Kanıt:** `compute-taste-twin-weekly/index.ts:29-33` — `if (expected && ...)`: secret env yoksa kontrol **atlanıyor**. 5000 profile tarayan service-role batch.
- **Fix:** Fail-closed — `CRON_SECRET` yoksa 503 dön (bkz. `sync-tmdb-movies`'in doğru `requireCronSecret` kullanımı).

#### 🟠 M [MEDIUM] `cowatch-remind`: in-code auth yok, service-role notification yazar
- **Kanıt:** `cowatch-remind/index.ts:7-54` — yalnızca gateway anon key; `requireCronSecret` yok.
- **Fix:** Cron işi → `requireCronSecret` ile koru.

#### 🟠 M [MEDIUM] `tmdb-proxy`: kimlik doğrulamasız açık TMDB relay
- **Kanıt:** `tmdb-proxy/index.ts:15-46` — host sabit (`api.themoviedb.org`), `..`/`://` engelli (tam SSRF yok) ama path+query tamamen client kontrolünde, server'ın `TMDB_API_TOKEN`'ı ile. Anon herkes ücretsiz TMDB relay'i / kota istismarı yapar.
- **Fix:** Endpoint prefix allowlist (`/search`, `/movie`, `/discover`, `/trending`, `/person`), yalnızca GET; user/anon-JWT iste.

#### 🟡 L [LOW]
- `og-image/index.ts:25-27,168` — `poster` param'ı `image.tmdb.org`'a doğrulanmadan ekleniyor (host sabit, etki düşük). Regex doğrulaması ekle.
- Tüm fonksiyonlarda wildcard CORS (`*`) — ama `Allow-Credentials: true` yok ve auth bearer ile → tehlikeli kombinasyon **değil**. Yine de C-4'ü besler.
- `movie-soundtrack/index.ts:29-35` — "auth" sadece Bearer header var mı diye bakıyor, geçerliliğine değil. C-4'e dahil.

#### ✅ Edge tarafında doğru yapılanlar
Secret sızıntısı yok (service-role/TMDB/LOVABLE key client'a dönmüyor, loglanmıyor); e-posta webhook'ları (`auth-email-hook`, `handle-email-suppression`) Lovable HMAC imza+timestamp replay koruması; `handle-email-unsubscribe` tahmin edilemez 32-byte token + atomik tek-kullanım (TOCTOU-safe); `process-email-queue` ek `role==service_role` claim kontrolü; service-role fonksiyonları (`delete-account`, `roulette-pick`, `taste-*`) her sorguyu doğrulanmış `user.id` ile scope'lar (client id'ye güvenmez).

> **Edge auth matrisi** için bkz. **Ek A**.

### 1.3 Frontend / Client-side authz

#### 🟠 H [HIGH] Privacy debug/dev sayfalarında sunucu-taraflı rol kontrolü yok
- **Kanıt:** `src/App.tsx:318-320` — `/settings/privacy/debug`, `/dev/privacy-audit`, `/settings/privacy/audit-log` yalnızca `<ProtectedRoute>` (login + onboarding kontrolü, rol değil). `AdminChatConfig`'in aksine bu üç sayfada `useIsAdmin()` yok.
- **Detay:** `PrivacyDebug`/`PrivacyAuditLog` sadece çağıranın kendi satırlarını sorgular (RLS sınırlı). Fakat `PrivacyAudit` (`src/pages/PrivacyAudit.tsx:36-51`) **herhangi** bir hesabı username/display_name ile çözüp `privacy_visibility_probe` çalıştırır — her kullanıcıya kullanıcı-enumerasyon/recon konsolu sunar (probe RLS'e uyar, veri sızdırmaz ama yetenek prod'a uygun değil).
- **Fix:** Üç route'u da sunucu-destekli rol kontrolüne bağla (`useIsAdmin()` deseni) veya `/dev/privacy-audit`'i prod bundle'dan çıkar.

#### 🟡 L [LOW] `src/lib/tmdb.ts:6-8` — hardcoded anon JWT fallback (public key, secret değil ama env baypas eder, rotasyona dayanır). Fallback'i kaldır, env yoksa hata ver.
#### ℹ️ INFO `Auth.tsx:151,310` `returnTo` doğrulanmıyor — React Router v6 `<Navigate>` in-app path olarak ele aldığından bugün açık-yönlendirme **değil**. Defense-in-depth: `returnTo.startsWith('/') && !startsWith('//')` doğrula.

#### ✅ Frontend tarafında doğru yapılanlar
`/admin/chat` doğru şekilde `useIsAdmin()` ile korunuyor; sign-out'ta `queryClient.clear()` + tüm user-scoped query key'leri `user.id` içeriyor (cross-account sızıntı yok); session yönetimi sağlam (`getUser()` doğrulama, `USER_DELETED`/`TOKEN_REFRESHED`, focus/45s re-validate, dead-session hard logout); **XSS sink yok** (tek `dangerouslySetInnerHTML` chart.tsx'te developer CSS; `react-markdown` v10 raw HTML escape, `rehype-raw` yok); secret yok; OAuth redirect `window.location.origin` (sabit).

---

## 2. Fonksiyonel Doğruluk

#### ~~🔴 C-1 [CRITICAL] Migration 5 çekirdek trigger'ı siler~~ → ❌ GERİ ÇEKİLDİ (FALSE POSITIVE)
> **Düzeltme (sonraki denetim turunda, elle doğrulandı):** Bu bulgu **yanlıştı.** `20260626100624` migration'ının düşürdüğü 5 trigger (`trg_handle_friend_accept`, `trg_set_friend_request_responded_at`, `trg_bump_conversation_last_message`, `trg_promote_match_suggestion`, `trg_guard_match_decision`) **duplicate**'ti — `100559` migration'ında oluşturulmuş kopyalar. Aynı fonksiyonları çağıran **orijinal trigger'lar farklı adlarla yaşıyor ve hiç silinmiyor:**
> - `handle_friend_accept()` → `on_friend_accept` (`...220705.sql:49`) + `trg_friend_accept` (`...134339.sql:10`) — ikisi de yaşıyor (idempotent `ON CONFLICT DO NOTHING`).
> - `set_friend_request_responded_at()` → `trg_friend_request_responded_at` (`...626084059.sql:30`) — yaşıyor.
> - bump last_message → `trg_messages_bump_conv` (`...084646.sql:161`) — yaşıyor.
> - match promote/guard → `trg_match_promote` / `trg_match_decision_guard` (`...084646.sql:271,232`) — yaşıyor.
>
> **Net sonuç: taze migrate edilmiş DB'de friend-accept, `conversations.last_message_at` sıralaması, `responded_at` cooldown'u ve match promote/guard HEPSİ çalışır.** `friend-request-concurrency.test.ts` de PASS eder. `100559`'un duplicate yaratıp `100624`'ün onları düşürmesi zararsız migration churn'ü (aslında çift-tetiklemeyi önlediği için faydalı).
>
> **Neden ilk turda kaçırıldı:** hem ben hem ilgili agent yalnızca *silinen trigger adlarını* aradık, aynı fonksiyona bağlı kardeş trigger'ları değil. Chat-surface denetimi fonksiyonu izleyince yakaladı. (Adversarial cross-check'in değeri.) — Detay: `PRE_PROD_AUDIT_UX_SCALE.md` "Düzeltmeler".

#### 🔴 C-2f [CRITICAL] Sohbet mesajı optimistic-insert yok; realtime gelene kadar görünmüyor
- **Kanıt:** `use-chat.ts:219-247` (`useSendMessage`) — `onMutate` yok, `["messages", conversationId]` invalidate edilmiyor (`:244`). `ChatThreadView.tsx:225,240` `optimistic-` id'li mesajı render eder ama **hiçbir yer onu üretmiyor** (ölü kod). Gönderilen mesaj yalnızca realtime INSERT geldiğinde (`:189-197`) görünür; realtime yavaş/kapalıysa kendi mesajın hiç görünmez.
- **Fix:** `onMutate` ile `optimistic-<uuid>` ekle, başarıda gerçeğiyle değiştir, hatada geri al; en azından `onSuccess`'te `["messages", conversationId]` invalidate et.

#### 🔴 C-3f [CRITICAL] Diary'de unique constraint yok → yarış koşulu duplicate satır
- **Kanıt:** `use-diary.ts:47-76` — `diary` tablosunda `UNIQUE(user_id, tmdb_id)` yok (ratings/favorites/reviews'de var). read-then-insert; iki eşzamanlı ekleme ikisi de "satır yok" görüp insert eder → duplicate, `moviesWatched` şişer.
- **Fix:** `UNIQUE(user_id, tmdb_id)` + `.upsert(..., { onConflict })`.

#### 🟠 High
- **H-1** `use-friends.ts:123-134` — accept sonrası friendship+notification insert'leri **error kontrolsüz fire-and-forget**; başarısız olursa UI "kabul edildi" der ama hiçbir şey oluşmaz. `:116`'da status update'te `.eq("status","pending")` guard'ı yok → çift tap accept→reject zaten-kabul'ü çevirir. (Not: trigger'lar yaşadığı için friendship aslında trigger ile de oluşur; bu client insert artık redundant — yine de hatayı yutmamalı.)
- **H-2** `use-polls.ts:74-77`, `use-predictions.ts:74-77` — düz `.insert()`, PK çakışması → "Oy verilemedi" (oy değiştirme yok, çift-tap generic hata). Realtime de yok → başkalarının sayıları bayat. (Ürün niyeti doğrulanmalı.)
- **H-3** `PredictionCard.tsx:16-17` — `locked` yalnızca `status==="resolved"`'a bakar, `resolves_at`'e değil → deadline sonrası tahmin yapılabilir (PollCard `ends_at`'i doğru kontrol eder).
- **H-4** `use-cached-movies.ts:65,97-120` — TMDB+DB ikisi de başarısızken fallback `null.map`/raw error fırlatır (resilience'in tersi). `res.results.slice()` null-guard yok.
- **H-5** Statik realtime kanal adları (`use-notifications.ts:16`, `use-film-duels.ts:10`, `use-discussions.ts:10`) → çift mount/StrictMode'da teardown canlı aboneliği düşürür. `crypto.randomUUID()` suffix ekle.
- **H-6** `use-co-watch.ts:69-81` status guard + `onError` yok; `use-couple.ts:46-97` `useJoinByInvite`/`useCoupleSwipes` **hiç import edilmiyor** — "partner davet et" UI'ı var olmayan multiplayer'ı ima ediyor (swipe DB'ye yazılıp hiç okunmuyor). Wire et ya da remote-join UI'ı kaldır.

#### 🟡 Medium (özet)
- **M-1** `use-social.ts:239-241` leaderboard `avgRating` yanlış (guard `ratings.length`, hesap `diary`'den).
- **M-2** `use-diary.ts:59,72` `toISOString` → **UTC** tarih, gün kayması (off-by-one).
- **M-3** `use-diary.ts:106-113` update tüm alanları yollar → `watched_at` null'lanabilir.
- **M-4** Toggle mutation'larda optimistic update yok; `23505` unique-violation generic hata olarak görünür (`use-favorites`, `use-follows`, `use-reviews`, `use-watchlist`). `use-favorite-people.ts:54-71` insert/delete error'unu **hiç** kontrol etmez (sessiz desync).
- **M-5** `use-polls.ts:38-42`, `use-predictions.ts:38-42` options-fetch error'unu yutar → "0 oy", buton yok.
- **M-6** `use-notifications.ts:94-95` `useMarkAllRead` optimistic değil, over-broad key.
- **M-7** `rate-limit.ts:33-44` `formatRetry` `locale` param'ını yok sayar (hep İngilizce), negatifi clamp'lemez; modül-global `cooldowns` Map sign-out'ta temizlenmez (aynı tab'da cross-user).

#### 🟡 Low: `use-infinite-scroll.ts:16-28` geç-mount sentinel gözlemlenmez; `Infinity` staleTime "Now Playing"/"Trending"de; `tmdb.ts:341-347` locale-fallback çift fetch; moment/view error yutma; `useDiscussions` hem realtime hem 10s poll; `PollCard`/`CoupleMode`'da hard-pinned `tr` locale; `toTMDBMovie` `runtime`/`original_language` düşürür; upload ext parse noktasız dosyada güvensiz.

---

## 3. UI/UX, Erişilebilirlik, i18n

### 3.1 i18n
- **🟠 H [HIGH] 5/7 locale %43 çevirisiz (aynı 808 anahtar eksik).** `en` 1876, `tr` 1876 (tam); `de/es/fr/it/hi` 1068 — **birebir aynı** 808 eksik key (doğrulandı: satır sayıları 2088 vs 1108). `t()` en'e fallback eder → bu kullanıcılar AI asistanı, profil, watchlist, tonight, settings, chat vb. çekirdek akışlarda **yarı-İngilizce** uygulama görür. **Fix:** 808 key'i 5 locale için backfill et (liste deterministik — en.ts ile diff).
- **🟠 H [HIGH] ~89 hardcoded toast string i18n'i baypas ediyor — çoğu Türkçe.** Örn: `use-watchlist.ts:97` `"İzleme listesine eklenemedi"`, `use-friends.ts:96` `"Arkadaşlık isteği gönderilemedi"`, `Profile.tsx:134` `"...favorilere eklendi!"`; bazıları İngilizce (`EpisodePage.tsx:57` `"Review submitted!"`). Her locale (İngilizce dahil) çekirdek aksiyonlarda **ham Türkçe** toast alıyor. **Fix:** Hepsini `t()`'ye geçir.
- **🟡 M** Hardcoded aria-label'lar (Türkçe/İngilizce karışık): `Navbar.tsx:180,491`, `WatchingStatusOnboarding.tsx:40` (`"Kapat"`), `EpisodeDiscussionButton.tsx:93,106`, `ChatThreadView.tsx:109,146`.

### 3.2 Erişilebilirlik
- **🟠 H** `AddMovieModal.tsx:79-84` ve `AddPersonModal.tsx:57-60` `PortalOverlay` üzerinde — `role="dialog"`/`aria-modal`/focus-trap/Esc **yok** (diğer modallar shadcn Dialog ile doğru). Port et.
- **🟡 M** `MomentsReels.tsx:223` tam-ekran tap katmanı play/pause+like'ın tek kontrolü, non-button → klavye yolu yok. `:332,362` Like/Share icon-only `aria-label` yok. `ShareButton.tsx:50-57` sadece `title`.
- **🟡 L** Custom popover'lar (avatar menü `Navbar.tsx:285-445`, `NotificationBell.tsx:52-206`) Esc + `aria-expanded`/`aria-haspopup` yok.

### 3.3 Loading / Empty / Error
- **🟠 H** Sonsuz spinner/skeleton riski (fetch fail'de `setLoading(false)`'a ulaşılmıyor): `PublicList.tsx:33-39` (try/catch/finally yok), `PublicProfile.tsx:47-73`, `MovieSoundtrack.tsx:49` (402/429'da 60s poll), `CinemaPersonality.tsx:52`, `CoupleMode.tsx:246-248`.
- **🟡 M** ~12 yüzeyde fetch hatası "boş/sonuç yok" gibi gösteriliyor, retry yok (`Explore`, `Search:253,277`, `Friends:35`, `Chat:73`, `Discussions:27`, `MovieReviews:77`, `ActivityFeed:52`...). `ChatUserSearch.tsx:64` error'u yutar → "kimse yok". `DiscoverPeople.tsx:24-31` `searching=true` takılır.
- **🟡 M** `CollectionPage.tsx`, `EpisodePage.tsx` geçici TMDB hatasını kalıcı (lokalize edilmemiş) "not found" gösterir.
- **🟡 L** Paylaşılan `skeletons/*`, `TmdbErrorState`, `EmptyStatePrompt` mevcut ama çok yerde el-yapımı shimmer/empty kullanılıyor; `SectionErrorBoundary` hiç mount edilmemiş (kök `ErrorBoundary` mount — iyi).

### 3.4 Responsive / Mobile / TV
- **🟠 H** TV spatial-nav arama input'unda focus'u hapseder (`ui/tv-search.tsx:40` + `useSpatialNavigation.tsx:55-70`): ok tuşları input'ta çalışmaz, Tab yok → remote'ta çıkış yok.
- **🟡 M** `SpatialNavRoot` koşulsuz mount (`App.tsx:413`); her ok tuşunu `preventDefault` eder ve `data-tv-focusable` varsa desktop/mobile'da da native scroll'u ezer. TV/coarse-pointer ile gate et.
- **🟡 M** Bottom `ui/sheet.tsx:38-40` ve `ui/drawer.tsx:44` `env(safe-area-inset-bottom)` yok → iPhone home-indicator çakışması.
- **🟡 L** `lib/tv-focusable.ts:13-22` yorumun aksine `tabIndex` eklemiyor; TV sayfaları ilk frame'de focus set etmiyor.

### 3.5 Design-system tutarlılığı
- **🟠 H** İki toast sistemi mount edilmiş (`App.tsx:410-411` `<Toaster/>` + `<Sonner/>`); **shadcn Toaster ölü kod** (~60 call site sonner kullanıyor, shadcn `useToast()` çağıran yok). Kaldır.
- **🟡 M** Sonner teması bozuk — hiçbir yerde `ThemeProvider` yok (`ui/sonner.tsx` `next-themes` `"system"` default'a düşer). OS light modda kullanıcı **koyu app üzerinde açık toast** görür. `theme="dark"` sabitle ya da ThemeProvider mount et.
- **🟡 L** react-hook-form + zod + shadcn Form kurulu ama kullanılmıyor; tüm feature form'lar el-yapımı (tutarsız doğrulama).

---

## 4. Build / Config / Deploy

- **🟠 H1** **CSP/güvenlik header'ı yok.** `netlify.toml`/`_headers`/`vercel.json` yok; `index.html`'de CSP/`X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy` yok. XSS blast-radius'unu sınırsız bırakır, clickjacking mümkün. **Fix:** `public/_headers` (Netlify) ile CSP (`self` + `*.supabase.co` + `image.tmdb.org` + R2 OG host) + nosniff + frame-ancestors none. (4 inline JSON-LD script var — hash'le.)
- **🟠 H2** **`.env` gitignore'da değil** (`.gitignore` sadece `*.local`/`dist`). İçerik bugün yalnızca public anon key → secret sızıntısı yok, ama biri service-role/SMTP eklediği an commit'lenir. **Fix:** `.env`, `.env.*` ekle (`!.env.example` hariç).
- **🟠 H3** **3 lockfile** (`bun.lock` + `bun.lockb` + `package-lock.json`), `packageManager` alanı yok → npm CI vs bun (Lovable) farklı ağaç çözer ("works on my machine" prod bug'ları). Tek pakete indir.
- **🟠 H4** **`vite-plugin-pwa` kurulu ama bağlanmamış** (`vite.config.ts:15`'te `VitePWA()` yok, SW referansı yok) — ama `index.html:14` manifest'i `standalone` PWA vaat ediyor. Service worker olmadığından stale-cache tuzağı **yok** (iyi haber). Ya gerçekten wire et (autoUpdate, Supabase/auth cache'leme) ya da plugin+manifest vaadini kaldır.
- **🟡 M1** `playwright.config.ts:1` `lovable-agent-playwright-config`'ı import eder — `package.json`'da yok → tüm e2e/visual suite temiz checkout'ta çalışmaz.
- **🟡 M2** `"ci": "typecheck && test"` — `eslint`, Playwright e2e, `verify-og-tags.ts` çalışmıyor → lint/e2e/OG regresyonları yeşil geçer. `lint`'i ekle + post-deploy e2e/OG gate.
- **🟡 M3** TS strictness kapalı (`tsconfig.app.json:24-25` `strict:false`, `noImplicitAny:false`; `strictNullChecks:false`); eslint `no-unused-vars` tamamen kapalı → typecheck gate'i göründüğünden zayıf.
- **🟡 M4** OG fallback görselleri ephemeral `*.lovable.app` R2 preview'a işaret ediyor ve `index.html:28,32` ile `SEOHead.tsx:36` **farklı** görseller kullanıyor → 404 riski + crawler tutarsızlığı. Tek canonical görseli `muvvy.now`'da host et.
- **🟡 M5** Prerender/sitemap build'de canlı TMDB-proxy fetch eder; hata non-fatal → Supabase/TMDB outage'ında sessizce SEO/OG'siz site yayınlanır. Deploy-gate'te route eşiği koy.
- **🟡 M6** `tsx` deklare dependency değil (`bunx tsx`'e dayanır) → npm-only CI'da pinlenmemiş.
- **🟡 L** `logger.ts:27-33` `warn`/`error` prod'da; `flow-telemetry.ts:69` koşulsuz `console.info` → minör bilgi gürültüsü. `public/app-icon.png` 802KB tüm icon boyutları için tek görsel. Büyük `src/data/*.ts` (movies 30KB, market-products 35KB) — analyzer yok, kritik yolda mı doğrula.

#### ✅ Build tarafında doğru yapılanlar
`lovable-tagger` yalnızca dev (`vite.config.ts:15`); source map prod'da kapalı (default false); `robots.txt` `/auth`/`/onboarding`/`/setup-username`/`/reset-password` disallow; admin/debug route'ları sitemap'te **değil**; `lazy-retry.ts` post-deploy stale-chunk 404 recovery; route'lar lazy.

---

## 5. Öncelikli Aksiyon Listesi

### Prod öncesi ZORUNLU (BLOCKER)
1. ~~**C-1** — Silinen 5 trigger'ı yeniden oluştur~~ → **GERİ ÇEKİLDİ (false positive — trigger'lar yaşıyor).**
2. **C-2** — `friendships` client INSERT policy/grant'ını kaldır; yazımı yalnızca trigger/RPC'ye bırak. **(Gerçek 1 numaralı DB blocker'ı.)**
3. **C-3** — `send-transactional-email`'e service-role/`requireUser` + recipient sahiplik kontrolü.
4. **C-4** — Generatif AI uçlarına auth + per-user/gün kota; `x-forwarded-for` kimlik kullanımını kaldır.
5. **Build H1/H2** — `public/_headers` + CSP; `.env`'i gitignore'a al.

### Yüksek (hızlı takip)
6. `friend_requests` UPDATE `WITH CHECK` + bildirim INSERT policy daraltma (Güvenlik M).
7. `compute-taste-twin-weekly` & `cowatch-remind` cron-secret fail-closed.
8. Privacy debug/dev route'larına rol gate (FE H).
9. Sohbet optimistic-send (C-2f) + diary unique constraint (C-3f) + `use-friends` accept error kontrolü (H-1).
10. TMDB fallback null-safety (H-4) + realtime kanal adları benzersizleştir (H-5).
11. i18n: 808 key × 5 locale backfill + ~89 hardcoded toast'ı `t()`'ye taşı.
12. Sonsuz-spinner ekranlarını düzelt + ölü shadcn Toaster'ı kaldır + sonner `theme="dark"`.

### Orta / Hijyen
13. Lockfile tekleştir (H3) + PWA kararı (H4) + CI'a lint/e2e (M2) + Playwright dep (M1).
14. Diary UTC tarih (M-2), leaderboard avg (M-1), poll/prediction oy doğruluğu (H-2/H-3/M-5), toggle optimistic + `23505` idempotent (M-4).
15. Modal a11y (AddMovie/AddPerson), TV focus trap, safe-area sheet/drawer.
16. `tmdb-proxy`/`og-image` endpoint allowlist; TS strict'e kademeli geçiş.

---

## Ek A — Edge Function Auth Matrisi

`config.toml`'da listelenmeyen fonksiyonlar gateway'de `verify_jwt=true` defaultuna düşer; ancak gateway **public anon key**'i geçerli sayar → "JWT=true" ≈ "anon key'i olan herhangi bir çağıran". `*` = config.toml'da yok (default true).

| Function | gateway JWT | in-code auth | service_role | dış fetch |
|---|---|---|---|---|
| send-transactional-email | true | **yok** ⚠️C-3 | yes | enqueue |
| cinema-chat | false | verifyJwt (anon OK) ⚠️C-4 | yes | AI, TMDB |
| cinema-context | false | sadece bad-token red (anon OK) ⚠️C-4 | yes | AI, Wikipedia |
| movie-games | false | verifyJwt **asla reddetmez** ⚠️C-4 | yes | AI |
| smart-recommend | true* | getUser (anon OK) ⚠️C-4 | no | AI |
| cinema-chat-demo | true* | yok (IP rate-limit, spoofable) ⚠️C-4 | yes | AI, TMDB |
| movie-soundtrack | true* | sadece Bearer var mı | yes | AI, iTunes |
| compute-taste-twin-weekly | true* | CRON_SECRET **opsiyonel** ⚠️M | yes | — |
| cowatch-remind | true* | **yok** ⚠️M | yes | — |
| tmdb-proxy | false | **yok** ⚠️M | no | TMDB (path client-kontrol) |
| editorial-feed / daily-drop | false | yok (read-only/public) | yes | TMDB |
| og-image / sitemap | true*/false | yok (public çıktı) | no/yes | TMDB img |
| weekly-curation | false | `requireUser` ✅ | no | AI |
| sync-tmdb-movies | false | `requireCronSecret` ✅ | yes | TMDB |
| roulette-pick / taste-dna / taste-twins / taste-matches / cinema-personality | true* | `getUser` anon **red** ✅ | bazıları yes | bazıları AI |
| delete-account / signup-welcome | true | `getUser` anon red ✅ | yes | — |
| process-email-queue | true | `role==service_role` ✅ | yes | email API |
| auth-email-hook / handle-email-suppression | false | Lovable HMAC imza ✅ | yes | — |
| handle-email-unsubscribe | false | imzalı tek-kullanım token ✅ | yes | — |
| preview-transactional-email | false | `Bearer==LOVABLE_API_KEY` ✅ | no | — |

---

*Bu denetim statik kod analizine dayanır; canlı ortam doğrulaması gerektiren maddeler ("needs verification" olarak işaretli) — özellikle prod'da `CRON_SECRET`'in gerçekten set olup olmadığı (M canlı mı belirler) — ops tarafında teyit edilmeli. C-1 ve C-2 elle çapraz-doğrulandı.*
