# Muvvy — Pre-Production Audit (Bölüm 2): Kullanıcı Deneyimi, Akışlar & 100K Ölçek

**Tarih:** 2026-06-27
**Kapsam:** Ürünün **kullanıcı gözünden** uçtan uca incelemesi — anonim deneyim, login/OAuth, onboarding, keşif/TMDB, skeleton & loading, sayfa geçişleri, chat & AI, "birlikte izleyelim", yorumlar/anlar/anılar, düello & oyunlar, profil & gizlilik — her biri için **işlevsellik + güvenlik + responsive + UX**; ve özel olarak **"100.000 kullanıcı gelirse ne olur?"** (ölçeklenebilirlik & maliyet).
**Yöntem:** 6 paralel surface-bazlı uzman denetimi + tüm başlık bulguların elle `file:line` doğrulaması.
**İlişki:** `PRE_PROD_AUDIT.md` (Bölüm 1: teknik güvenlik/RLS/edge/build) ile tamamlayıcı. Bu belge Bölüm 1'deki bir bulguyu **düzeltir** (aşağıda "Düzeltmeler").

> Yine yalnızca **bulgu & öneri**; kod değiştirilmedi.

---

## 0. Yönetici Özeti — "100K kullanıcı gelirse ne olur abi?"

Kısa cevap: **Ürün bugünkü haliyle 100K'yı kaldıramaz; birkaç bin eşzamanlı kullanıcıda bazı parçalar topluca çöker, AI maliyeti ise kontrolsüz patlayabilir.** Mimari sağlam ve UX detaylarına gerçekten emek verilmiş (skeleton felsefesi, anonim-öncelikli akış, privacy modeli, product tour), ama prod öncesi kapatılması gereken **bir avuç gerçek blocker** ve çok sayıda "ship-a-lie" (çalışıyormuş gibi görünüp aslında çalışmayan) yüzey var.

### 🔥 İlk çöken 5 şey (ölçek altında, sırayla)

| # | Ne | Neden çöker | Etki |
|---|----|-------------|------|
| **S-1** | **TMDB tek token + detay sayfalarında cache YOK** | TMDB ~50 req/s; her detay sayfası ~2 çağrı (locale fallback). ~25 kullanıcı/sn detay açınca limit aşılır | **Tüm sitede** poster/detay topluca kırılır, token ban riski |
| **S-2** | **`cinema-chat` anonim + kotasız, istek başına 8 Gemini çağrısı** | Public anon key bundle'da; tek script unbounded harcama | **Denial-of-wallet** — AI faturası kontrolsüz |
| **S-3** | **E-posta kuyruğu ~240 e-posta/dk, auth maili 15 dk TTL** | Lansman pikinde onbinlerce kayıt → çoğu onay maili TTL'de düşer | **Kullanıcılar signup onayı alamaz** |
| **S-4** | **Realtime bağlantı tavanı + filtresiz `messages` aboneliği** | Pro default ~500 ws bağlantı < 1000 eşzamanlı; her mesaj tüm chat client'larına fan-out | Realtime tıkanır, mesajlaşma bozulur |
| **S-5** | **`diary(user_id)` indekssiz + taste-twin cron O(N×arkadaş)** | diary'de hiç indeks yok; cron 5000 kullanıcıyı sırayla tarar | DB seq-scan saturasyonu, cron tamamlanamaz |

> **Önce yapılacak en yüksek kaldıraç:** (1) TMDB cache + çoklu token, (2) `cinema-chat`/`smart-recommend`'e auth + per-user AI bütçesi, (3) `diary(user_id)` indeksi + taste-twin cron'u set-based'e çevir, (4) Realtime kota + `messages` aboneliğine `filter`, (5) auth maili TTL/throughput.

### 🚨 Kullanıcıya dokunan güvenlik blocker'ları (doğrulandı)
1. **Özel "An"ların medyası public URL'den herkese açık** (moment-photos/videos bucket `public:true`, path = `user_id/timestamp`). RLS satırı korur ama **dosyayı korumaz**. *(Bölüm 1 C-2 friendships self-insert ile birlikte en kritik gizlilik açıkları.)*
2. **Moderasyon yok:** public video feed'inde report yok, `block_user` backend'i var ama **UI'a hiç bağlanmamış** (sadece "unblock" var) → kullanıcı kimseyi engelleyemez. App-store/abuse riski.
3. **AI maliyet açıkları** (S-2) + **Roulette `consume:false` ile günlük limit baypas** + **movie-games açık uç**.

### 🎭 "Ship-a-lie" kümesi (çalışıyormuş gibi görünen, aslında boş yüzeyler)
Bunlar güvenlik değil ama **prod'da kullanıcı güvenini kırar** — ya gerçekten yap ya da dürüstçe etiketle/kaldır:
- **Couple Mode** "partneri davet et" kodu üretir ama **kimse o kodu kullanamaz** (multiplayer bağlı değil; pass-the-phone).
- **"Birlikte İzle"** "senkron başlayalım" der ama aslında sadece **takvim + .ics + normal chat** (senkron oynatma yok).
- **Polls/Predictions** sekmesi sahte `SamplePoll` (hardcoded `{a:142,b:198...}`) ve "bildir" toggle'ları sadece localStorage yazıyor (**hiç bildirim gelmez**).
- **XP/Achievements/Quests** ekonomisi tamamen kozmetik (hiçbir puan tablosuna yazılmıyor, harcanamıyor).
- **Quiz "sonucunu paylaş"** herkese **aynı generic** kişilik sayfasını paylaşıyor (kullanıcının skoru yok). Ayrıca quiz kişiliği ile `CinemaPersonality` **iki farklı** kişilik sistemi.
- **Market** puan/coin mağazası değil, **affiliate link grid'i**; üstelik **uydurma `rating`/`reviewCount`** gerçek yıldız gibi gösteriliyor.
- **Quiz/FilmGuessGame skorları** hiç kalıcı değil; FilmGuessGame **cevabı client cache'inde açık** (hile trivial).

### Düzeltmeler (Bölüm 1 ve ara bulgulara dürüst revizyon)
Doğrulama sırasında **3 başlık iddia yanlış çıktı** — bunları geri çekiyorum (adversarial cross-check'in değeri tam da bu):
- ❌ **Bölüm 1 "C-1: 5 trigger silinmiş" → YANLIŞ (geri çekildi).** Silinen trigger'lar **duplicate**'ti; aynı fonksiyonları çağıran **orijinal trigger'lar** (`on_friend_accept`, `trg_friend_accept`, `trg_messages_bump_conv`, `trg_friend_request_responded_at`, `trg_match_promote`, `trg_match_decision_guard`) hiç silinmedi. Taze DB'de friend-accept, chat sıralaması, cooldown, match — **hepsi çalışır.** `100559` migration'ı duplicate yarattı, `100624` sadece duplicate'leri düşürdü. (İlk denetimde ben de, ilgili agent de sadece *silinen trigger adlarını* aradık; chat agent fonksiyonu izleyince yakaladı.)
- ❌ **"couple_sessions herkese açık (`USING(true)`)" → YANLIŞ.** O policy iki kez düşürülmüş (`20260322102051` ve `20260620201518` dinamik drop-all) → şu an sadece creator/partner okuyabilir.
- ❌ **"PublicProfile başkasının diary/favorites'ini sızdırıyor" → SIZINTI DEĞİL.** `diary_select`/`favorites_select` RLS'i `can_view_surface` ile gerçekten zorluyor (diary=`watch_history` default **private**; favorites default **public**). Client gereksiz over-fetch yapıyor ama RLS izinsiz veri döndürmüyor. *(Not: favorites'in **public-by-default** olması ayrı bir UX/gizlilik-beklentisi konusu — aşağıda D-bölümü.)*

---

## A. Anonim Deneyim · Auth/Login · Onboarding · Session

> Düzeltme: Provider **"auth0" değil** — Supabase email/şifre + OTP + reset, ve **sadece Google/Apple OAuth için** Lovable cloud-auth (`@lovable.dev/cloud-auth-js`), token'ı `supabase.auth.setSession()` ile Supabase oturumuna çeviriyor.

### A-1 [HIGH] `/setup-username` çıkışsız tuzak (dead-end)
`UsernameSetup.tsx:187-193` "Atla & bitir" butonu bile `handleSaveAll` çağırıyor ve `disabled={!canProceedUsername}` — yani **username yoksa çıkış yok.** Önerilen handle çakışırsa veya kullanıcı beğenmezse, her `ProtectedRoute` onu buraya geri atar → **uygulamaya hiç giremez.** **Fix:** username'i ertelenebilir yap (gate zaten nullable destekliyor) veya benzersiz fallback ata.

### A-2 [HIGH] Esc'e basınca sessiz logout (LegalConsentGate)
`LegalConsentGate.tsx:89-107`: tam ekran modalde **Escape → onDecline() → signOut() → /auth**. Refleksle Esc'e basan kullanıcı **sessizce çıkış yapıp** login'e atılır, yerini kaybeder. **Fix:** Esc no-op olsun (veya decline butonuna odaklansın), destructive olmasın.

### A-3 [HIGH] Aşırı agresif session re-validation work'ü siler
`AuthContext.tsx:67-86,140-159`: `getUser()` **visibilitychange + focus + her TOKEN_REFRESHED + her 45sn**'de çağrılıyor; `auth-guard.ts:29-36` **her 401/403'ü** ölü session sayıp tüm storage'ı temizleyip `/auth`'a hard-reload ediyor. Geçici CDN 403'ü / refresh hiccup'ı / alt-tab dönüşü → **görev ortasında logout + bellekteki form/onboarding kaybı.** Toast ayrıca **sadece Türkçe** hardcoded. **Fix:** geçici-hata grace'i (1 retry, 2 ardışık fail şartı), 403'ü hariç tut, aralığı uzat, toast'ı lokalize et.

### A-4 [HIGH] Auth hata mesajları ham Supabase string'i (lokalize değil)
`Auth.tsx:213-214,282-283,298`, `ResetPassword.tsx:49`: en sık hata (yanlış şifre) dahil `setError(error.message)` → "Invalid login credentials" gibi **İngilizce ham metin** TR-öncelikli app'te. Sadece signup yolu i18n'e maplenmiş. **Fix:** Supabase auth error code'larını tek helper'da `t("auth.*")`'a maple.

### A-5 [MED] Anonim veri göçü kısmen kayıplı + ölü `taste` alanı
`anon-store.ts`: header "watchlist, favorites **ve taste**'i taşır" diyor ama (a) `state.taste` **hiçbir yere yazılmıyor/taşınmıyor** (ölü kod — yanlış vaat), (b) `migrateAnonStateTo` favorites'i **tek tek loop'ta** insert ediyor, hata yutuluyor, `finally`'de `clear()` çalışıyor → ağ koparsa **yerel kopya silinir, sadece bir kısmı sunucuya gider (sessiz veri kaybı).** Watchlist doğru (bulk upsert). **Fix:** favorites'i de `upsert(onConflict)` ile bulk yap; `clear()`'ı yalnız başarıda çağır; `taste`'i ya bağla ya sil.

### A-6 [MED] OAuth hata/loading yok + `returnTo` doğrulanmıyor
`Auth.tsx:524-561` OAuth butonlarında in-flight guard yok (çift redirect), `lovable.auth.signInWithOAuth` dönüşü **tamamen yok sayılıyor** → başarısız OAuth'ta kullanıcı sessizce `/auth`'da kalır. `Auth.tsx:151,310` `returnTo` doğrulanmadan `<Navigate>`'e veriliyor (RR v6 in-app path saydığı için bugün açık-redirect değil ama defense-in-depth: `startsWith('/') && !startsWith('//')`).

### A-7 [MED] Onboarding resumable değil + Product Tour redirect'e çarpıyor
`TasteOnboarding` tüm seçimleri local state'te tutar — reload/back/session-revalidate her şeyi siler. Product Tour (`ProductTour.tsx:196-208`) kullanıcıyı `/profile`'a `navigate` edebiliyor; onboarding'i bitmemiş kullanıcıda `ProtectedRoute` onu `/onboarding`'e bounce eder → tur spotlight'ı kırılır.

### A-8 [LOW] Reset şifre kuralı signup'tan zayıf (6 vs 8+harf+rakam); OTP countdown interval unmount'ta temizlenmiyor; ResetPassword PKCE `?code=` akışında "geçersiz link" dead-end riski (hash bekliyor — Supabase mail formatını doğrula).

✅ **İyi:** Anonim-öncelikli mimari doğru (public içerik render, aksiyon-bazlı `useAuthGate`); Product Tour rapid-nav guard'lı ve testli; cookie banner non-blocking + safe-area; OAuth redirect `window.location.origin` (sabit); session deleted/expired ayrımı var.

---

## B. Keşif · TMDB · Skeleton/Loading · Geçişler · Responsive

### B-1 [HIGH] Hiç scroll restoration yok
`PageTransition.tsx:23-26` `scrollRestoration="manual"` + her nav top'a reset. Infinite-scroll'da 80 başlık aşağı inip bir filme girip **Back**'e basan kullanıcı en tepeye düşer. Rails de `scrollLeft` korumuyor. **Fix:** RR `<ScrollRestoration>` veya pathname-keyed save/restore.

### B-2 [HIGH] "Hata" her yerde "boş sonuç" gibi gösteriliyor (cross-cutting)
`GenrePage:106-113`, `CollectionPage:29-36` ("Collection not found"), `BestOfYearGenre:259`, `StreamingPlatform:269`, `TonightSituation:266`, `Search:578`, `Category:179-182` — fetch **hatası** "sonuç yok / bulunamadı" olarak render ediliyor, retry yok. Cilalı `TmdbErrorState` (retry'lı) var ama bu liste sayfalarına bağlı değil. **Fix:** her yerde `isError → <TmdbErrorState onRetry={refetch}/>` dalı ekle (empty'den önce).

### B-3 [HIGH] MovieDetail hero backdrop'ı 3× ve `original` boyutta yüklüyor
`MovieDetail.tsx:402,415,425`: blur `w1280` + crisp `original` (CSS bg) + üçüncü `sr-only` `original` `<img>`. `original` backdrop'lar çok-MB; LCP elementinde aynı görselin 3 fetch'i. Collection/Episode hero'ları da `original`. **Fix:** tek `w1280`, sr-only original'i kaldır.

### B-4 [HIGH] Skeleton sistemi tutarsız — en yoğun sayfalar bypass ediyor
`Search.tsx:499-503` sonuçlar bare spinner (`SearchSkeleton` tanımlı ama import edilmemiş); `Explore.tsx:527-532,690-693` ve `Category.tsx:170-178` el-yapımı `animate-pulse` grid (paylaşılan `CategoryGridSkeleton` dururken); `EpisodePage`/`CollectionPage` tam sayfa bare spinner → pop-in/CLS. **Fix:** paylaşılan skeleton'ları kullan; `EpisodePageSkeleton`/`CollectionPageSkeleton` ekle.

### B-5 [HIGH] TMDB tek token + cache yok + 429 kalıcı hata gibi (ölçek = S-1)
`tmdb-proxy/index.ts:9,41-52` cache YOK, `verify_jwt=false`; `tmdb.ts:334-360` locale fallback non-EN'de **ikinci en-US fetch** (~2 çağrı/detay); `tmdb.ts:87` retry sadece 401/5xx → **429 anında kalıcı hata** ekranı. **Fix:** endpoint+param+lang ile cache (KV/tablo) + `Cache-Control: s-maxage`, 429'u `Retry-After` ile retry, locale fallback'i `translations` endpoint'ine indir.

### B-6 [HIGH] Home mount'ta ~25-50 TMDB çağrısı
`Home.tsx:110-130` ~25 hook; `useCuratedCollection` (use-collections.ts:55-92) curated film'leri **5'erli, tek tek** çekiyor. İlk boya çağrı-yoğun. Rails `SectionErrorBoundary` ile sarılı + `staleTime:Infinity` (iyi) ama soğuk edge'de seri yavaşlar.

### B-7 [MED] Mobil/responsive UX delikleri
- **Hover-only metadata touch'ta görünmez:** rating/genre chip'leri `opacity-0 group-hover:opacity-100` (TMDBMovieCard:65-71, CollectionRail, Search) → mobil kullanıcı puanları **hiç görmez.** `@media(hover:none){opacity:1}` ekle.
- **CollectionRail scroll-snap yok** (TMDBCarousel'de var) → ana sayfa rail'leri mobilde "kayık" hisseder.
- **Sub-44px tap target:** episode toggle `p-1`≈24px (TVShowDetail:76-85), 1-10 rating butonları `w-5 h-5`=20px (EpisodePage:328).
- **Broken-image handling tutarsız:** sadece TVCarousel/TMDBMovieCard `onError` fallback'i var; CollectionRail/PersonPage/Episode/hero ölü poster'da browser kırık-glyph gösterir.

### B-8 [MED] Search per-keystroke fetch + recent-search yok + AI kartlarında poster yok
`Search.tsx:253` her tuş ≥2 char'da istek (debounce yok); recent-search yok; AI öneri kartları **her zaman `posterPath:null` + statik `Film` ikonu** (`:790-794`) → "yarım/bozuk" görünüyor (oysa `tmdb_id` biliniyor).

### B-9 [MED] Infinite scroll duplicate + media toggle scroll reset etmiyor
`Category.tsx:187` `key={id-i}` cross-page TMDB duplicate ID'leri remount'la maskeliyor (öğe iki kez görünebilir); movie→tv toggle deep-scroll'da boş grid'de bırakır. **Fix:** flatten'da id-dedup.

✅ **İyi:** `PageLoader` app-shell silüeti (spinner değil); `lazy-retry` deploy sonrası stale-chunk 404'ü kurtarıyor; global `overflow-x:clip; max-width:100vw` (yatay scroll bug'ına karşı); MobileHero `100dvw` snap + eager LCP; `min-h-dvh` + safe-area tutarlı; TV detail tek `append_to_response`.

---

## C. Chat · Co-Watch · Couple · AI Chat (realtime)

### C-1 [HIGH] Mesaj göndermede optimistic-insert yok → realtime gelene kadar görünmez
`use-chat.ts:219-247`: insert var ama `["messages"]` cache'ine yazmıyor, `onMutate` yok; mesaj **sadece realtime echo** ile beliriyor (200-800ms+). `ChatThreadView.tsx:225` `optimistic-` id'li "gönderiliyor" UI'ı var ama **kimse üretmiyor** (yarım bırakılmış). En büyük "bozuk hissettiren" UX. **Fix:** `onMutate` temp row, success'te değiştir, error'da geri al.

### C-2 [HIGH] Thread pagination yok → 200+ mesajlı sohbet yanlış görünüyor
`use-chat.ts:166-181` `.order(ASC).limit(200)`, cursor yok, "eskiyi yükle" yok → aktif sohbet **en eski 200**'ü gösterir, son mesajlar eksik. Conversation list önizlemesi de global 200-row scan (`:91-97`) → çok thread'li kullanıcıda yanlış önizleme. **Fix:** DESC+limit+reverse, scroll-up cursor; liste için denormalize `last_message_*`.

### C-3 [HIGH] Realtime reconnect & statik kanal adları → sessiz mesaj kaybı
- Tüm kanallar bir kez subscribe, **reconnect'te refetch yok**; laptop uyku / mobil background / ağ değişiminde `postgres_changes` kaçan event'i replay etmez → kullanıcı uyandığında thread'de eksik mesajlar (manuel reload'a kadar). `refetchOnReconnect`/`refetchOnWindowFocus` da yok. **Fix:** reconnect'te `invalidateQueries(["messages",id])`.
- Statik kanal adları (`messages:${convId}`, `conv-list:${uid}`, `unread-shell:${uid}`) + desktop split-view **her iki tree'yi mount** ediyor (`ChatThread.tsx` md:hidden / hidden md:block) → aynı topic'te çift abone, bir unmount diğerinin canlı aboneliğini **öldürür.** **Fix:** kanal adına `useId()`/uuid suffix; `useIsMobile` ile tek tree mount.

### C-4 [HIGH] AI "streaming" sahte + kotasız (cost) + RateLimitDialog bağlı değil
- `cinema-chat/index.ts:1152` `stream:false`; tam yanıt geldikten sonra 20-char'lık parçalara bölünüp "yazılıyor" gibi gösteriliyor (`:1224`) → kullanıcı **tüm üretim + 8 tool round-trip kadar boş spinner** bekler. **Fix:** son (tool'suz) iterasyonda gerçek upstream stream.
- **Auth'lu uçta server-side rate-limit YOK** (`:1160` sadece upstream 429 relay) — oysa anon demo'da 5/gün/IP var. Her mesaj ~14 paralel DB sorgusu (`buildUserContext`) + 8 LLM + TMDB → **kullanıcı başına gerçek para/yük, tavansız.** Client `MAX_CHARS=1000` trivial baypas. **Fix:** edge'de per-user sliding-window cap; `RateLimitDialog`'a bağla (`Retry-After` döndür).
- `saveSessionSummary` her kapanışta (≥4 mesaj) **ekstra bir LLM round-trip** (`AIChatPanel.tsx:435-452`) — kazara kapanışta bile, maliyet çarpanı.
- Anon kullanıcı `cinema-chat`'e (demo değil) düşüyor, tool'lar `if(userId)` ile kapalı → butonlar görünür ama tıklayınca sessizce hiçbir şey olmaz. **Fix:** anon'u `cinema-chat-demo`'ya yönlendir / affordance'ları gizle.

### C-5 [HIGH/dürüstlük] "Birlikte İzle" senkron oynatma değil + invite'ta canlı bildirim yok
`CoWatch.tsx`: aslında **zaman planla + .ics indir + normal text chat** linki. "Senkron başlayalım" (`CoWatchInviteDialog.tsx:92`) **yanıltıcı** (paylaşılan player/presence yok). Ayrıca `useCoWatchInbox` (`use-co-watch.ts:23-38`) realtime/refetch'siz → **B davet edildiğini ancak sayfayı yenilerse görür.** `Countdown` (`:20-29`) tick etmiyor (donuk); geçmiş pending invite'lar "expired" olmuyor. **Fix:** copy'i "izleme randevusu" olarak hizala; `co_watch_invites`'a receiver-filtreli realtime + invite'ta notification.

### C-6 [HIGH/dürüstlük] Couple Mode multiplayer facade + swipe persist hatası
`useJoinByInvite`/`useCoupleSwipes` (`use-couple.ts:46,84`) **hiçbir yerde import edilmiyor**; matches **local React state**'ten (pass-the-phone). Invite kodu üretilip kopyalanıyor ama **tüketen ekran yok** → var olmayan uzak-multiplayer ima ediliyor. Ayrıca `couple_swipes` tablosunda **UPDATE policy yok** (`...220705.sql:84-87`) → re-swipe `upsert`'i RLS'e takılır, hata yutulur (sessiz persist hatası). **Fix:** ya gerçekten bağla (join ekranı + partner swipe okuma) ya da invite UI'ını kaldırıp "telefonu paylaş" oyunu olarak dürüstçe sun; `couple_swipes`'a UPDATE policy.

### C-7 [MED] Diğer chat UX: incoming mesaj her tick'te scroll-to-bottom (history okurken aşağı zıplar, `ChatThreadView.tsx:51`); attach-film hata yolunda kart kaybolur, retry yok (`:350`); 5-mesaj burst cap'i kullanıcıya görünmez (sadece ham hata toast'ı); read-receipt UPDATE storm (`use-chat.ts:277`).

### C-8 [HIGH responsive] Mesaj composer iOS klavyede gizleniyor
`ChatThreadView` AIChatPanel'in visualViewport handler'ına **sahip değil**; composer `pb-[calc(env(safe-area-inset-bottom)+88px)]` sabit offset + `h-[100dvh]` → iOS Safari'de klavye açılınca input **klavyenin arkasında.** **Fix:** `use-keyboard-open`'ı (repo'da var) composer'a uygula.

✅ **İyi (mesajlaşma RLS'i gerçekten sağlam):** block'layan birine mesaj atılamaz (`start_conversation` + insert/select policy `is_blocked` re-check); başkasının thread'i okunamaz (FORCE RLS, `auth.uid() IN (user_low,user_high)`); non-friend spam cap'i (20 pending/24s) + 5-mesaj burst; co-watch invite friendship+not-blocked şartı. Realtime cleanup (removeChannel) tüm kanallarda doğru.

---

## D. Sosyal İçerik: Yorumlar · Anlar/Anılar · Profil · Arkadaş · Gizlilik

### D-1 [CRITICAL] Özel "An" medyası public URL'den herkese açık (DOĞRULANDI)
`moment-photos` (`...113719.sql:3`) ve `moment-videos` (`...081049.sql`) bucket'ları **`public:true`**; storage SELECT policy'si **sadece** `bucket_id='moment-photos'` (`...113719.sql:64`) — sahip/audience kontrolü **yok**. Path = `${user.id}/${Date.now()}.ext` (`use-moments.ts:191`). Moment **satırı** audience-gated ama **dosya değil** → private/close-friends bir foto/video, URL'i kuran (veya user_id + ms timestamp brute-force eden) **herkese açık.** **Fix:** bucket'ları private yap, `can_view`-gated kısa-ömürlü signed URL ile sun, path'i UUID yap.

### D-2 [CRITICAL] Public UGC video feed'inde moderasyon yok + engelleme UI'a bağlı değil (DOĞRULANDI)
Moment'te report yok, NSFW tarama yok; tek aksiyon kendi moment'ini silmek. `block_user` backend'i (`use-privacy.ts`, RPC, `blocks` tablosu) **var ama UI'da hiç çağrılmıyor** — sadece `useUnblockUser` (Settings) wired. Yani kullanıcı **kimseyi engelleyemez** (sadece bir şekilde zaten engellediğini kaldırabilir). App-store reddi + abuse/CSAM sorumluluk riski. **Fix:** `useBlockUser`'ı profil/arkadaş/moment/discussion menülerine bağla; report akışı; upload'ta async moderasyon.

### D-3 [CRITICAL ölçek] Feed/grid N+1 patlaması
- Her `ReelItem`/`MomentCard` **4 ayrı sorgu** (profil+likes+comments+saves, `MomentsReels.tsx:67-82`) + yorum başına author lookup; reels feed **tüm** moment'leri virtualization'sız mount ediyor (`:548`) → yüzlerce istek.
- Her `FriendCard` → `useFriendData` = **4 unbounded `select("*")`** (`use-friends.ts:163-168`); 30 arkadaş ≈ 120 sorgu (tüm ratings/diary/favorites çekilip taste % hesaplanıyor).
- Pagination hiç yok: `useReelsFeed` 120 satır, `useMyMoments` **limitsiz**; foto grid'de full-res (thumbnail_url var ama foto'da kullanılmıyor). **Fix:** tek RPC'de aggregate count + viewer state; profilleri tek `.in()` ile batch; `useInfiniteQuery` keyset; reel listesini virtualize; thumbnail üret/sun.

### D-4 [HIGH] Yorum düzenleme formu mevcut yorumu doldurmuyor → boş üzerine yazıyor
`MovieReviews.tsx:91-93` form state'i mount'ta `myReview`'dan init ediyor ama async query çözülünce sync eden `useEffect` **yok** → "Düzenle" çoğu zaman rating 8/boş açılıyor; kaydet `upsert` (`use-reviews.ts:63`) ile **mevcut yorumu boşla ezer.** **Fix:** `useEffect` ile `myReview`'dan senkronla / `key={myReview?.id}`.

### D-5 [HIGH] Foto upload'ta boyut/format limiti yok + progress yok + orphan medya
Video 60MB+MIME whitelist'li ama **foto** bucket'ında `file_size_limit`/`allowed_mime_types` yok, `CreateMomentModal.tsx:87` her `image/*`'i alıyor (JS boyut kontrolü yok) → 25MB HEIC public bucket'a full-res. **EXIF/GPS strip edilmiyor** (private foto'da konum sızıntısı). Upload **row insert'ten önce** (`:129-176`) → insert fail'de dosya kalıcı orphan. Progress yok (60MB'da dakikalarca spinner → force-quit). **Fix:** bucket+client cap/whitelist, downscale+EXIF strip, progress+cancel, insert fail'de objeyi sil.

### D-6 [HIGH] `close_friends` tier'ı yarım: RLS destekliyor, UI'da seçilemiyor
`VisibilityPicker.tsx:15-19` sadece private/friends/public sunuyor; `CloseFriendToggle` var ama hiçbir surface close-friends'e set edilemiyor — ve zaten öyleyse picker **hiçbir aktif buton** göstermiyor (tıklayınca sessizce düşürür). **Fix:** 4. seçeneği ekle veya toggle'ı gizle.

### D-7 [HIGH] Public profil "Koleksiyon" sekmesi yanlış surface'e gate'li
`PublicProfile.tsx:84` diary shelf'i `library_visibility`'ye (default friends) gate'liyor ama `diary` RLS'i `watch_history`'ye (default **private**) gate'li → default kullanıcıda **arkadaş bile sekmeyi 0 satır/0 sayı** görür. **Fix:** client gate ile RLS aynı surface'i kullansın.

### D-8 [HIGH] Hesap silme onayı sadece Türkçe + user-enumeration delikleri
`ProfileDangerZone.tsx:17,54` literal **"SİL"** yazmayı istiyor (`lang` okunuyor ama kullanılmıyor) → Türkçe bilmeyen hesabını **silemez** (noktalı İ klavye-kırılgan). Ayrıca `DiscoverPeople.tsx:25` `safe_public_profiles`'ı doğrudan, throttle'sız per-keystroke `ilike` ile sorgulayıp `discoverable_profiles` filtresini baypas ediyor → **non-discoverable kullanıcılar aramada çıkıyor**; `PrivacyAudit.tsx:36` base `profiles`'tan isimle çözüyor. **Fix:** silme token'ını lokalize et; tüm kişi-aramasını `discoverable_profiles`'tan geçir + debounce + rate-limit.

### D-9 [HIGH] Moments search overlay raw input'tan `.or()` filtresi kuruyor
`MomentsSearchOverlay.tsx:90,104` kullanıcı girdisini escape'siz `username.ilike.%${q}%,caption.ilike...`'a gömüyor → virgül/parantez/`%` filtre gramerini kırar veya full-table scan zorlar. RLS satırı korur ama arama hata verir/tarar. **Fix:** PostgREST özel karakterlerini escape et veya FTS RPC.

### D-10 [MED] Diğerleri
- **Spoiler veil kozmetik:** tam metin DOM'da blur altında (devtools'tan okunur, `SpoilerVeil.tsx:86`); reels caption'ları (`MomentsReels.tsx:409`) ve Discussions (`:187`) `has_spoiler`'a rağmen **hiç veil'siz** plaintext.
- **Privacy defaults beklenenden açık:** favorites + taste_dna + moments **public-by-default** (`use-privacy.ts:18-24`); Sovereignty sayfası satır-başı **efektif audience'i göstermiyor** → kullanıcı "guilty pleasure" favorisini farkında olmadan açık web'e yayınlıyor. **Fix:** satır-başı "İnternetteki herkes görebilir" rozeti; favorites default'unu yeniden düşün.
- **Follow vs friend** ayrımı açıklamasız (iki ayrı graph, hangi aksiyon ne sağlıyor belirsiz). **Reviews** tamamen public, min-length yok, gizlilik opsiyonu yok ("Sovereignty" vaadiyle tutarsız). **AddFriend** gelen istekler `req.sender` okuyor ama hook `sender_profile` dolduruyor → "?" görünüyor (`AddFriend.tsx:222`). Accept/reject çift-submit guard'sız. **Own-profile** "followers/following" ikisi de `friendships.length` (`Profile.tsx:251,255`) — public profille çelişir. Activity-feed RLS arkadaşlık var/yok'a gate'li ama **per-tier setting'e değil** (private watch_history yine de arkadaşa `watched` satırı yayar — tutarlılık açığı, sızıntı değil).

✅ **İyi:** **XSS yok** (bio/caption/liste/yorum hepsi React text node, `dangerouslySetInnerHTML` yok); liste/favorites/watchlist/moments RLS'i gerçekten doğru yazılmış ve tek doğruluk kaynağı.

---

## E. Düello · Oyunlar · Roulette · Quiz · Achievements · Market

> Düzeltme: **"Düello" gerçek-zamanlı 1v1 matchmaking DEĞİL** — topluluğun oyladığı async A/B poster kartı. `DuelLobby` ayrı bir "aynı filmi izleyen arkadaşlar" listesi (sadece Message butonu). "Matchmaking/abandonment" çerçevesi geçersiz; gerçek riskler oy bütünlüğü + facade'lar.

### E-1 [CRITICAL ölçek/cost] movie-games açık AI ucu (S-2 ailesi)
`MovieGames.tsx:64` → `movie-games` (`verify_jwt=false`, anon'u **asla reddetmez**); Gemini, per-user kota yok, cache `tmdb_id`'ye keyli ama `tmdb_id` atlanarak/`lang`/`title` değiştirerek **baypas edilebilir** → tavansız harcama. **Fix:** auth + per-user günlük kota + zorunlu cache-key.

### E-2 [CRITICAL TR market] DailyQuests/DailyDrop UTC reset (saat kayması)
`DailyQuests.tsx:71` & `DailyDrop.tsx:27` `new Date().toISOString().split("T")[0]` → "bugün" **UTC**, market UTC+3 → quest/drop **03:00'te resetlenir**, akşam aksiyonları yanlış güne sayılır, streak gece izleyende kırılır. Tüm "günlük" sınırlar **cihaz saatinden** (`new Date()`) türüyor → client-tamper edilebilir. **Fix:** kullanıcı-yerel gün sınırı, server-otoriter.

### E-3 [HIGH fairness] Tahminler deadline sonrası seçilebiliyor
`PredictionCard.tsx:16-17` `locked` sadece `status==="resolved"`'a bakar, **`resolves_at`'e değil** (PollCard `ends_at`'i doğru kontrol eder). Resolve cron gecikirse kullanıcı deadline sonrası, sonuç belliyken seçer → bedava puan. **Fix:** `ended = resolves_at < now()` ekle + DB insert guard.

### E-4 [HIGH] Roulette `consume:false` ile günlük limit + cost baypas (DOĞRULANDI)
`roulette-pick/index.ts:54` `const consume = body.consume !== false` → client `consume:false` yollarsa kota kontrolü atlanır ama **Gemini+TMDB yine çalışır** (`:71,189`). Ayrıca read-then-upsert non-atomik (`:190` yarış → double-spend). **Fix:** `consume`'a güvenme; atomik `UPDATE ... WHERE spins_used < allowed`.

### E-5 [HIGH] Oy değiştirilemiyor + çift-tap PK hatası (duels/polls/predictions)
`use-film-duels.ts:57`, `use-polls.ts:74`, `use-predictions.ts:74` düz `.insert` → ikinci oy/çift-tap unique violation → generic "Oy verilemedi" (kullanıcı oyunun işlediğini görmedi, tekrar bastı). Hiçbirinde realtime yok → başkalarının sayıları bayat. **Fix:** `upsert` + optimistic + (gerekiyorsa) count trigger'ını UPDATE'e genişlet; realtime/refetchInterval.

### E-6 [HIGH] FilmGuessGame cevabı client'ta açık + skor kalıcı değil
`FilmGuessGame.tsx:26-39` tam film detayını (`id`,`title`,`poster`) tahminden **önce** cache'e çekiyor; blur sadece CSS → cevap network tab/devtools'tan trivial. Skor pure local `useState` (`:44`), persist yok. Ödülle bağlama.

### E-7 [HIGH] iOS shake izni hiç istenmiyor
`ShakeListener.tsx:33-36` `DeviceMotionEvent.requestPermission()`'ı **mount'taki useEffect'te** çağırıyor; iOS 13+ izni **kullanıcı dokunuşundan** ister → iPhone'da shake **sessizce hiç çalışmaz** (oysa UI "Sallayabilirsin" vaat ediyor). **Fix:** izni Spin butonunun onClick'inden iste.

### E-8 [HIGH ship-a-lie kümesi] (Yönetici özetinde listelendi)
Polls/Predictions sahte `SamplePoll` + localStorage "bildir" toggle (`DuelsHub.tsx:127,95-102`); XP/Achievements/Quests kozmetik (puan tablosuna yazılmıyor, `Achievements.tsx:75`); Quiz "paylaş" generic kişilik sayfası + iki ayrı kişilik sistemi; Market affiliate grid + uydurma yıldız (`market-products.ts:75-76`). `review-1` quest'i `tmdb_id=0` ile **tamamlanamaz** (`DailyQuests.tsx:67`).

### E-9 [MED] Hot-row counter trigger contention + share linkleri spesifik değil
`film_duels.votes_a/b`, `discussion_rooms.message_count`, `poll_options.vote_count`, `moments.view_count` tek satırda `col=col+1` → popüler öğede row-lock seri. Duel share linki id'siz generic `/duels`'e gider (viral döngü kırık).

✅ **İyi:** Leaderboard pre-aggregated `user_points ORDER BY ... LIMIT 20` (full-table değil) — ama puan pipeline'ı bağlı olmadığından **şu an boş/işlevsiz**. DailyDrop tek global satır (fan-out iyi) — ama cron precompute yok (00:00 UTC thundering-herd).

---

## F. Ölçeklenebilirlik & Maliyet — "100K kullanıcı" (merkez soru)

> Tahminler *(est.)* kod + standart tier limitlerinden; load-test değil. Veritabanı indeks iddiaları elle doğrulandı.

### F-1 [CRITICAL] TMDB tek token + cache yok (= S-1, B-5)
TMDB ~50 req/s. 1000 eşzamanlı detay ≈ ~2000 istek = **~40× limit** *(est.)* → anında 429, sürekli aşımda token askıya alma riski. **Tek key = tüm site için tek hata noktası.** Client retry (4×) stres altında **amplifie** eder. **Fix:** TMDB cache (KV/tablo, endpoint+param+lang TTL) + CDN `s-maxage`, çoklu token/coalescing, locale-fallback ikinci çağrıyı cache'le bastır.

### F-2 [CRITICAL] cinema-chat anonim + kotasız, 8× Gemini/istek (= S-2)
`cinema-chat/index.ts:1141` `for(i<8)`, `:1153` gemini-3-flash, auth reddetmiyor, `verify_jwt=false`, +9. özet çağrısı. `chat_usage` sadece telemetri, throttle yok. **Tek script unbounded harcama (denial-of-wallet).** **Fix:** auth zorunlu + per-user/IP rate-limit (`demo_chat_limits` deseni zaten var) + tool iterasyon cap + günlük token bütçesi.

### F-3 [HIGH] E-posta kuyruğu throughput vs signup piki (= S-3)
`email_send_state` batch=10, delay=200ms, cron 5s → **~240 mail/dk** *(est.)*. Auth maili TTL **15dk** (`:132`), aşan DLQ'ya. 10k-signup saati ≈ 20k mail vs ~4.8k/saat drain → çoğu onay maili **TTL'de düşer, kullanıcı onay alamaz.** 429 tüm run'ı durduruyor (en kötü anda). **Fix:** batch↑/delay↓, paralelleştir, **auth maili TTL'i uzat veya kuyruğu baypas edip inline gönder**, queue-depth alarmı.

### F-4 [HIGH] Realtime bağlantı tavanı + filtresiz fan-out (= S-4)
12 kanal; filtresiz global `messages` abonelikleri (`use-chat.ts:121`, `NotesRow.tsx:48`, `Chat.tsx:49` — chat kullanıcısı başına **3 ayrı** kanal, postgres filter yok) + `match_suggestions` (`use-taste-matches.ts:78`) + statik firehose `rooms-realtime`/`duels-realtime`. **1000 eşzamanlı > Pro default ~500 ws** *(est.)* — bağlantı sayısı ilk tavan. Filtresiz `messages` = her insert tüm chat client'larına değerlendiriliyor. **Fix:** Pro/Team kotasını lansman öncesi yükselt; `messages`/`match_suggestions`'a `filter`; 3 redundant kanalı birleştir; firehose'ları scope'la/poll'a çevir. (Not: `useNotificationsRealtime` sadece **hiç mount edilmeyen** `NotificationBell.tsx`'e bağlı → bildirimler sessizce 60s poll'a düşmüş — olası regresyon.)

### F-5 [HIGH] Unbounded SELECT'ler + diary indekssiz (= S-5)
`.limit()` yok: tüm conversations, tüm co-watch invites, tüm watch history, tüm moments, tüm friend graph, viral moment'in **tüm** like'ları (`use-moments.ts:114-162`). **Doğrulanmış indeks durumu:** `favorites`/`ratings`/`reviews` `UNIQUE(user_id,tmdb_id)` taşıyor → **user_id-öncelikli scan'ler indeksli (sorun değil).** Ama **`diary`'de unique de indeks de YOK** (`...215910.sql:67-78`) → her `WHERE user_id` seq-scan; diary leaderboard/taste-twin/profilde yoğun. `compute-taste-twin-weekly` O(N×arkadaş), 5000 kullanıcıyı sıralı tarıyor (`:41,70-94`) → büyüdükçe **cron tamamlanamaz.** **Fix:** `CREATE INDEX ON diary(user_id)` (+`(user_id,tmdb_id)`); taste-twin'i set-based/materialized'e çevir veya user-id aralığına shard'la; leaderboard'u server-side aggregate RPC yap; her yere pagination.

### F-6 [HIGH] Per-request pahalı AI: smart-recommend (anon, cache yok) + weekly-curation (cache yok)
`smart-recommend/index.ts` login **gerektirmiyor** (anon-key geçer), cache/throttle yok, 1 Gemini/istek; `weekly-curation` adına rağmen cache'siz, ana sayfadan çağrılıyor. **Fix:** `smart-recommend`'e `requireUser`+rate-limit; `weekly-curation`'ı `user_id+week_start` ile cache'le.

### F-7 [MED] Hot-row counter trigger contention (E-9); RLS büyük tabloda satır-başı `can_view`/`are_friends` (feed'i `created_at`+`.limit()` ile sayfa-sınırlı tut); `og-image` cache-miss başına PNG render (+ `verify_jwt` set değil→default true, **sosyal crawler'ları bloklayabilir** — doğrula); redundant polling (notifications 60s + dead realtime, discussions 10s + realtime); **service worker yok** (her yükleme ağ — ama route'lar code-split + vendor-chunk'lı, iyi).

### Kapasite & Maliyet özeti *(est.)*
**İlk tavanlar sırası:** 1) TMDB key throttle/ban (~birkaç yüz eşzamanlı detay) → site-geneli detay outage'ı; 2) AI cost blowup (cinema-chat+smart-recommend, tavansız) → tek abuser binlerce $ Gemini; 3) Realtime bağlantı (500 < 1000); 4) E-posta TTL düşmesi (>~4k/saat); 5) diary seq-scan + taste-twin cron.

**100K MAU kaba maliyet büyüklüğü** *(tahmin, load-data yok):*
- **AI (Lovable/Gemini):** baskın değişken maliyet ve tek **kontrolsüz patlama** riski. Cache'li uçlar (cinema-context/movie-games/soundtrack — tmdb_id+lang keyli) ucuz/amorti. Cache'siz set (cinema-chat 1-8 çağrı, smart-recommend, weekly-curation) trafikle lineer ve **şu an tavansız.** 100K MAU'nun %10'u ayda birkaç chat oturumu (8 çağrıya kadar) çalıştırsa → ayda milyonlarca Gemini çağrısı; muhtemelen en büyük kalem ve efektif kontrolsüz. **Önce per-user token bütçesi.**
- **Supabase:** Pro tabandan (~$25/ay) usage-billed'e (yükseltilmiş bağlantı kotası, DB compute add-on, egress) → DAU/realtime fan-out'a göre düşük-yüzler–düşük-binler $/ay.
- **TMDB:** ücret $0 ama tek key bağlayıcı kısıt → para değil cache ile çöz.
- **E-posta:** provider'a bağlı; darboğaz throughput/TTL config'i.
- **Statik dağıtım:** code-split+vendor-chunk var; tek boşluk service worker yok. TMDB görselleri client'tan `image.tmdb.org`'a direkt (senin bandwidth'in değil — iyi).

---

## G. Konsolide Öncelik Listesi

### Prod öncesi ZORUNLU (kullanıcı + ölçek blocker'ları)
1. **D-1** Özel an medyası public bucket → private + signed URL + UUID path.
2. **F-2 / E-1 / F-6** AI uçlarına (cinema-chat, movie-games, smart-recommend) auth + per-user kota/token bütçesi.
3. **F-1** TMDB cache + çoklu token (+ B-5 429 retry, locale fallback).
4. **D-2** Moderasyon: `useBlockUser`'ı UI'a bağla + report + upload moderasyonu.
5. **F-3** Auth maili TTL/throughput (kullanıcılar onay alamıyor).
6. **F-4** Realtime kota + `messages`/`match_suggestions` `filter` + redundant kanal birleştir.
7. **F-5** `diary(user_id)` indeksi + taste-twin cron set-based + pagination.
8. **A-1** `/setup-username` çıkışsız tuzak; **A-2** Esc=logout; **A-3** session-validate grace.
9. **E-4** Roulette `consume` baypas; **E-3** prediction deadline; **E-2** UTC daily reset.
10. *(Bölüm 1)* **friendships self-insert** RLS (friends-tier gizlilik baypası) — hâlâ açık.

### Yüksek (lansman kalitesi)
11. **C-1** chat optimistic-send; **C-2** thread pagination; **C-3** realtime reconnect + benzersiz kanal; **C-8** iOS composer klavye.
12. **C-4** gerçek AI streaming + RateLimitDialog bağla; **C-5/C-6** co-watch & couple dürüst etiket/wire.
13. **D-3** feed/friend N+1 → RPC+pagination+virtualize+thumbnail; **D-4** review-edit boş-üzerine-yazma; **D-5** foto upload cap+progress+EXIF.
14. **B-1** scroll restoration; **B-2** error-as-empty her yerde; **B-3** MovieDetail 3× backdrop; **B-4** skeleton tutarlılığı.
15. **D-6/D-7/D-8** close_friends picker, Koleksiyon surface uyumu, silme-onayı lokalize + people-search `discoverable` filtresi.
16. **A-4** auth hata mesajları lokalize; **A-5** anon favorites göçü kayıpsız.
17. **E-5** oy upsert+optimistic+realtime; **E-6** guess cevap leak; **E-7** iOS shake izni.

### Ship-a-lie temizliği (dürüstlük)
18. Couple multiplayer, "senkron izle" copy, Polls/Predictions facade + sahte SamplePoll, XP ekonomisi, Quiz paylaşım, Market sahte yıldız → **ya gerçekten yap ya da dürüstçe etiketle/kaldır.**

### Orta / hijyen
19. B-6 Home çağrı sayısı, B-7 mobil (hover-metadata/snap/tap-target/broken-img), B-8 search debounce+poster, B-9 infinite dedup, D-10 spoiler/privacy-default/follow-vs-friend, F-7 polling/counter/og-image, A-7 onboarding resumable + tour redirect.

---

## Ek — Doğrulama Notu (dürüstlük)
Bu denetimde **6 paralel agent** + tüm başlık bulguların elle çapraz-doğrulaması yapıldı. Doğrulama sırasında **4 iddia yanlış çıkıp geri çekildi** (Bölüm 1 C-1 dropped-triggers; couple_sessions world-read; PublicProfile PII; "favorites/ratings indeksiz" → aslında UNIQUE composite ile indeksli, yalnız `diary` indekssiz). Geri kalan tüm Critical/High bulgular `file:line` kanıtıyla teyit edildi. Canlı-ortam teyidi gereken kalemler ("needs verification" — ör. prod'da `CRON_SECRET`/`verify_jwt` gerçek değerleri, Supabase Realtime kota ayarı, e-posta provider limiti) ops tarafında doğrulanmalı; ölçek sayıları load-test değil, kod+standart-limit tahminidir.
