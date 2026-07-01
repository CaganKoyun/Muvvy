# Muvvy — GA4/Analytics Event Wiring (Lovable görev paketi, yapıştır-çalıştır)

> **Bu neden ayrı bir prompt?** Muvvy'nin uygulama kaynağı (React + Supabase) Lovable projesinde yaşıyor; bağlı GitHub reposu yalnızca audit/pentest dokümanlarını tutuyor (`src/` yok). Bu yüzden GA4 event bağlama işi **Lovable içinde** yapılmalı. Aşağıdaki prompt'u Lovable'a olduğu gibi yapıştır.
>
> **Görev tipi:** plumbing/analytics. Yeni UI yok, consent banner'ına dokunma. Saf kod bağlama: taxonomy'de tanımlı olup component'e bağlanmamış eventleri doğru kullanıcı aksiyonuna bağla — consent-aware ve PII-sızıntısız.

---

## 0. İHLAL EDİLEMEZ KURALLAR

1. **Yeni event ismi/taxonomy uydurma.** Mevcut helper + taxonomy tek doğru kaynak. Eksik olanı *bağla*, yenisini *icat etme*. Gerçekten yeni event gerekiyorsa öner ve dur — sen bağlama.
2. **PII GA4'e gitmez.** Email, username, ad-soyad, mesaj içeriği, özel kütüphane/liste başlığı, karşı kullanıcının kimliği → dataLayer'a **asla**. Yalnızca acting user'ın pseudonymous `auth.uid()` ve public film metadata (TMDB id / tür / public film adı). Sosyal olayda kişi yerine **boolean/sayı**.
3. **Tek kaynak.** Her event `trackEvent()`'ten geçer. Component'ten doğrudan `gtag` / `dataLayer.push` **YASAK**.
4. **Consent gate `trackEvent()` içinde** — onay yoksa yazılmaz. Bu davranışı bypass eden hiçbir kod ekleme.
5. **Kanıt zorunlu.** Her tespit `file:line` ile. Self-attestation yok.
6. **İki faz karışmaz.** Faz 1 sadece tespit (kod değişmez). Faz 2 sadece onaylanan eksikleri bağlar.

---

## FAZ 1 — VERIFY ONLY (kod DEĞİŞMEZ)

Sırayla çıkar, her maddeyi `file:line` ile kanıtla. **Bu projede muhtemel konumlar:** analytics helper `src/lib/flow-telemetry.ts` veya `src/lib/analytics.ts` / `src/lib/track*.ts` civarında; `logger.ts` ile karıştırma. Önce `trackEvent`, `dataLayer`, `gtag`, `GTM`, `gtag('event'`, `flow-telemetry` string'lerini repo genelinde ara.

1. **Helper konumu ve imzası:** `trackEvent()` nerede tanımlı, parametre şeması ne (`name`, `params`, `surface`, `value`…?), PII `sanitize()`/allowlist katmanı hangi alanları düşürüyor/hangilerine izin veriyor. GTM/GA4 yükleme noktası (`index.html` veya bir provider component) nerede, consent gate nerede okunuyor.
2. **Taxonomy envanteri:** Tanımlı tüm event isimleri + beklenen parametreleri (surface, item_id, item_type, method, value…). Nereden tanımlıysa (const/enum/type/dosya) oradan çıkar. Tanım yoksa bunu açıkça yaz (o zaman "taxonomy" = helper çağrılarındaki fiili isimler).
3. **Bağlılık matrisi:** Her event için → component'te gerçekten fire ediliyor mu, nerede. Üç kova:
   - ✅ **BAĞLI** — fire ediliyor, `file:line`.
   - 🔲 **TANIMLI AMA BAĞLI DEĞİL** — taxonomy'de var, hiçbir yerde çağrılmıyor. **(Bu görevin asıl hedefi.)**
   - ⚠️ **YANLIŞ BAĞLI** — fire ediliyor ama yanlış surface/param, optimistic (gerçek success değil), ya da PII sızdırıyor.
4. **Her 🔲 için önerilen bağlanma noktası:** hangi hook/component, hangi kullanıcı aksiyonu (onClick / `onSuccess` / mutation callback), hangi PII-güvenli param seti. **Henüz yazma.**
5. **PII risk taraması:** Mevcut fire noktalarından biri sanitize'ı baypas edip ham kimlik/başlık/mesaj/email/username gönderiyor mu.

**Faz 1 çıktısı:** matris + her 🔲/⚠️ için tek satırlık fix planı. Sonunda **DUR ve onay iste.** Hiçbir dosya değişmeyecek.

### Muvvy'de aday event yüzeyleri (bunlar taxonomy'de VARSA bağla — yoksa icat etme, listele)
Aşağıdaki hook/component'ler audit'te doğrulanmış gerçek aksiyon noktaları. Faz 1'de taxonomy'de karşılığı olan eventi eşle:

| Kullanıcı aksiyonu | Gerçek success noktası (audit'ten) | PII-güvenli param önerisi |
|---|---|---|
| Filmi diary'e ekleme | `use-diary.ts` (`useAddDiary` onSuccess) | `item_id`=tmdb_id, `item_type`='movie' |
| Watchlist'e ekleme/çıkarma | `use-watchlist.ts` (toggle onSuccess) | `item_id`=tmdb_id, `method`='add'/'remove' |
| Favori ekleme | `use-favorites.ts` / `use-favorite-people.ts` | `item_id`=tmdb_id/person_id, `item_type` |
| Rating/review gönderme | `use-reviews.ts`, `EpisodePage.tsx` | `item_id`=tmdb_id, `value`=rating (sayı), **review metni YOK** |
| Follow/unfollow | `use-follows.ts` (onSuccess) | `method`='follow'/'unfollow'; **hedef kullanıcı kimliği YOK** (sadece boolean/sayı) |
| Arkadaşlık isteği / kabul | `use-friends.ts` (`:116`,`:123-134`) | `method`='request'/'accept'; **karşı taraf uid YOK** |
| Poll oyu | `use-polls.ts:74-77` (gerçek insert success) | `item_id`=poll_id, `item_type`='poll'; **seçenek metni YOK** |
| Prediction pick | `use-predictions.ts:74-77` | `item_id`=prediction_id; deadline sonrası fire etme |
| Co-watch / couple davet | `use-co-watch.ts`, `use-couple.ts` | `method`; **partner kimliği YOK**, boolean/sayı |
| Moment/Reel like & share | `MomentsReels.tsx:332,362`, `ShareButton.tsx` | `item_id`=tmdb_id, `method`=share target türü |
| Bildirim tıklama | `use-notifications.ts` / `NotificationBell.tsx` | `item_type`=notification türü (enum), **içerik YOK** |
| SPA sayfa görüntüleme | Router (App.tsx route change) | `page_view` — route path (query string'siz), **çift sayım yok** |

> Not: Yukarıdaki tablo **öneri**dir. Taxonomy'de bu eventlerin ismi yoksa **bağlama** — Faz 1 raporunda "taxonomy'de yok, öneri" olarak ayrı listele.

---

## FAZ 2 — FIX ONLY (yalnızca onaydan sonra)

Onaylanan 🔲 ve ⚠️ maddelerini, Faz 1'de önerdiğin bağlanma noktalarına göre bağla:

- Fire çağrısı **doğru aksiyon callback'inde** — mutation `onSuccess` (gerçek server success), **optimistic `onMutate` değil**. Hatada fire etme.
- Param seti **PII-güvenli**: sosyal event'te karşı taraf yerine boolean/sayı; film için TMDB id + tür. `value` sayısal olmalı.
- Sadece `trackEvent()` üzerinden. Yeni GTM tag'i gerekmez (generic `{{Event}}` yakalar).
- SPA `page_view`: route değişiminde **tek** fire; StrictMode double-mount'ta çift sayma (guard/ref).
- Bir event **key event (conversion)** olacaksa veya yeni parametre **custom dimension** olarak raporlanacaksa → bunu **ayrı bir listede bildir** (GA4 Admin işi, kodda değil).
- `tsc` temiz geçmeli, SSR/prerender kırılmamalı (`flow-telemetry`/track çağrıları `window` guard'lı olmalı — bu projede prerender var, `PRE_PROD_AUDIT.md:205`).

Yeni event *icat etme*; taxonomy dışı ihtiyaç görürsen bağlama, listele.

---

## DOĞRULAMA (kabul kriteri — "bitti" demeden önce)

1. Her yeni bağlanan event, aksiyon yapıldığında **GA4 DebugView**'da doğru isim + parametrelerle görünüyor.
2. **PII sızıntı testi:** email/username/mesaj içeren bir aksiyon tetikle → DebugView'da bu değerler **GÖRÜNMEMELİ**. Görünüyorsa **S0, dur.**
3. **Consent testi:** banner reddedilmişken **hiçbir event yazılmıyor**.
4. **Çift sayım yok:** SPA route değişiminde tek `page_view`.
5. Kabul listesi `file:line` + DebugView kanıtıyla raporlanır. Test edilmemiş = doğrulanmamış.

---

### Ek not (Mixpanel?)
Projede Mixpanel MCP bağlı görünüyor. Eğer analytics fiilen **Mixpanel** üzerinden gidiyorsa (GA4 değil), Faz 1'de bunu tespit et ve helper'ın hangi backend'e (GA4 dataLayer vs Mixpanel `track()`) yazdığını `file:line` ile netleştir. Aynı kurallar (tek kaynak, consent gate, PII allowlist) her iki backend için de geçerli — sadece hedef değişir.
