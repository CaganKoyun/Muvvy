# Muvvy — Güvenlik & Kalite Sertleştirme (Lovable görev paketi)

Bu bir **pre-prod güvenlik + kalite sertleştirme** turu. Aşağıdaki düzeltmeleri uygula. **Mevcut akışları bozma**; her şey Supabase migration'ları + edge function düzenlemeleri + küçük client değişiklikleri. **Fazları SIRAYLA uygula** (her fazı ayrı çalıştırırsan daha güvenli). Her madde gerçek, doğrulanmış bir bulguya dayanıyor.

> Notlar: `friendships` ve `notifications` satırları zaten `SECURITY DEFINER` trigger'larla yazılıyor, bu yüzden client INSERT yetkisini kaldırmak bu akışları bozmaz. Anket/tahmin sayıları `poll_options.vote_count` / `prediction_options`'ta tutuluyor, ham `*_votes`/`*_picks` okumasını kısıtlamak UI'ı bozmaz.

---

## FAZ 1 — KRİTİK GÜVENLİK

### 1.1 `friendships` self-insert açığını kapat (rızasız "arkadaş" olup özel veri okuma)
Yeni migration:
```sql
DROP POLICY IF EXISTS "Users can insert friendships" ON public.friendships;
REVOKE INSERT ON public.friendships FROM anon, authenticated;
-- friendships yalnız handle_friend_accept (SECURITY DEFINER) trigger'ı ile yazılır.
```
Ayrıca client'taki **gereksiz** savunmacı insert'i kaldır — `src/hooks/use-friends.ts` içinde `useRespondFriendRequest`'te `from("friendships").insert(...)` çağrısını sil (trigger zaten oluşturuyor). Sadece `friend_requests` status update'i kalsın ve hatasını kontrol et.

### 1.2 `send-transactional-email` — kimlik doğrulamasız e-posta gönderimini kapat
`supabase/functions/send-transactional-email/index.ts`: İstek gövdesini işlemeden ÖNCE çağıranın **service_role** olduğunu doğrula (tek meşru çağıran sunucu tarafı). `process-email-queue`'daki desenle:
```ts
// JWT claim'inden role oku (gateway zaten imzayı doğruladı)
function jwtRole(req: Request): string | null {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try { return JSON.parse(atob(m[1].split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).role ?? null; }
  catch { return null; }
}
// handler başında:
if (jwtRole(req) !== "service_role") {
  return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: cors });
}
```
Ve `signup-welcome` bu fonksiyonu çağırırken **service role key** ile invoke etsin (Authorization: Bearer SERVICE_ROLE_KEY). `templateData.ctaUrl` gibi alanları yalnız `https://muvvy.now/...` ile sınırla.

### 1.3 AI uçlarına auth + günlük kota (denial-of-wallet'i kapat)
Önce ortak kota altyapısı — yeni migration:
```sql
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant all on public.ai_usage to service_role;

create or replace function public.bump_ai_usage(p_user uuid, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into public.ai_usage(user_id, day, calls) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into c;
  return c <= p_limit;   -- false => limit aşıldı
end $$;
revoke all on function public.bump_ai_usage(uuid,int) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid,int) to service_role;
```
Sonra her generatif edge fonksiyonunda (`cinema-chat`, `cinema-context`, `movie-games`, `smart-recommend`, `roulette-pick`, `movie-soundtrack`): `_shared/auth.ts`'teki **`requireUser`** ile anon'u REDDET, sonra service-role client ile kotayı kontrol et:
```ts
import { requireUser } from "../_shared/auth.ts";
const auth = await requireUser(req);
if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: cors });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const { data: ok } = await admin.rpc("bump_ai_usage", { p_user: auth.userId, p_limit: 50 }); // gün/kullanıcı
if (ok === false) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: cors });
```
`cinema-chat`'te tool döngüsünü de düşür: `for (i<8)` → `for (i<4)`. `movie-games`'in cache'ini zorunlu kıl (tmdb_id yoksa reddet).

### 1.4 Özel "An" medyasını gerçekten gizle (public bucket sızıntısı)
Bucket'lar `public:true` + client `getPublicUrl` → URL'i olan herkes private foto/video'yu çeker. Düzelt:
```sql
-- 1) Bucket'ları private yap
update storage.buckets set public = false where id in ('moment-photos','moment-videos');
-- 2) Public read policy'lerini kaldır
drop policy if exists "Public can read moment photos" on storage.objects;
drop policy if exists "Public can read moment videos" on storage.objects;
-- 3) Yalnız sahip + moment audience'ı izin verenler okuyabilsin
--    (moments.photo_url/video_url path'ini içeriyorsa join ile; basit sürüm: sahip + can_view)
create policy "moment media gated read" on storage.objects for select to authenticated
using (
  bucket_id in ('moment-photos','moment-videos')
  and (
    (storage.foldername(name))[1] = auth.uid()::text  -- sahibi
    or exists (
      select 1 from public.moments m
      where (m.photo_url like '%'||name or m.video_url like '%'||name)
        and private.can_view(auth.uid(), m.user_id, m.audience)
    )
  )
);
```
Client değişikliği — `src/hooks/use-moments.ts`: `getPublicUrl` yerine **signed URL** kullan (okuma anında, kısa ömürlü):
```ts
const { data } = await supabase.storage.from("moment-photos").createSignedUrl(path, 3600);
// upload sonrası DB'ye PATH kaydet (public URL değil); okurken signed URL üret.
```
Ayrıca upload path'ini `crypto.randomUUID()` yap (timestamp yerine, brute-force'a karşı) ve foto upload'ında EXIF/GPS strip + boyut limiti ekle (`moment-photos` bucket'ına `file_size_limit` + `allowed_mime_types`).

---

## FAZ 2 — YÜKSEK GÜVENLİK

### 2.1 Doğrudan-API veri sızıntılarını kapat (follows, oy gizliliği, probe)
```sql
-- Sosyal graf: anon'a kapat
REVOKE SELECT ON public.follows FROM anon;
-- Oy gizliliği: ham oylar yalnız kendi satırın (sayılar poll_options/prediction_options'ta)
DROP POLICY IF EXISTS "poll_votes read all" ON public.poll_votes;
CREATE POLICY "poll_votes select own" ON public.poll_votes FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE SELECT ON public.poll_votes FROM anon;
DROP POLICY IF EXISTS "prediction_picks read all" ON public.prediction_picks;
CREATE POLICY "prediction_picks select own" ON public.prediction_picks FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE SELECT ON public.prediction_picks FROM anon;
```
(UI'da "kendi oyun" gösterimi `user_id = self` ile çalışmaya devam eder; toplam yüzdeler sayaç kolonlarından gelir.)

### 2.2 `privacy_visibility_probe` enumerasyon oracle'ını kapat
Fonksiyonun gövdesinin EN BAŞINA (BEGIN'den hemen sonra) ekle ve `CREATE OR REPLACE` ile yeniden tanımla:
```sql
  if viewer is distinct from auth.uid() and owner is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
```
(Frontend zaten `viewer=self` çağırıyor; kısıt onu bozmaz, başkalarının ilişki/blok/gizlilik ayarını sorgulamayı engeller.)

### 2.3 Bildirim sahteciliği + discussion moderasyonu
```sql
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
REVOKE INSERT ON public.notifications FROM anon, authenticated; -- trigger'lar (definer) üretir
-- discussion: en az moderatör silme + blok-aware (public forum kalacaksa)
CREATE POLICY "mods delete messages" ON public.discussion_messages FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));
```

### 2.4 Username squatting / kimlik taklidini engelle
```sql
create or replace function public.validate_username() returns trigger language plpgsql as $$
begin
  if new.username is not null then
    if lower(new.username) = any (array['admin','muvvy','support','root','official','moderator','help','mod','staff','api','www','muvvy_official']) then
      raise exception 'reserved username';
    end if;
    if new.username !~ '^[a-z0-9_]{3,20}$' then raise exception 'invalid username'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validate_username on public.profiles;
create trigger trg_validate_username before insert or update of username on public.profiles
  for each row execute function public.validate_username();
-- profiles UPDATE'e WITH CHECK ekle (user_id mutasyonunu engelle)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### 2.5 Cron uçlarını fail-closed yap
`supabase/functions/cowatch-remind/index.ts` ve `compute-taste-twin-weekly/index.ts` başına `_shared/auth.ts`'ten `requireCronSecret`:
```ts
import { requireCronSecret } from "../_shared/auth.ts";
const g = requireCronSecret(req);
if (!g.ok) return new Response(JSON.stringify({ error: g.error }), { status: g.status ?? 401, headers: cors });
```
(`compute-taste-twin-weekly`'deki `if (expected && ...)` koşulunu kaldır — secret yoksa 503 dön.)

### 2.6 `tmdb-proxy` — endpoint allowlist + sadece GET
`supabase/functions/tmdb-proxy/index.ts`'te endpoint doğrulamasına ekle:
```ts
const ALLOW = ["/search","/movie","/tv","/person","/discover","/trending","/genre","/collection","/configuration","/find","/keyword","/company","/network"];
if (req.method !== "GET" && req.method !== "POST") return new Response("method", { status: 405, headers: cors });
if (!ALLOW.some(p => endpoint.startsWith(p))) return new Response(JSON.stringify({ error: "endpoint not allowed" }), { status: 400, headers: cors });
```

### 2.7 Güvenlik header'ları (CSP vb.) — `public/_headers` dosyası oluştur
```
/*
  Content-Security-Policy: default-src 'self'; img-src 'self' https://image.tmdb.org https://*.r2.dev data: blob:; media-src 'self' https://*.supabase.co blob:; connect-src 'self' https://*.supabase.co https://ldoebitsncavgwcenxju.supabase.co; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()
```

### 2.8 `.env`'i gitignore'a al + `x-forwarded-for` / `consume` güvenini kaldır
- `.gitignore`'a ekle: `.env` ve `.env.*` (`!.env.example` hariç).
- `cinema-chat-demo`: rate-limit'i `x-forwarded-for` yerine doğrulanmış kullanıcıya/`bump_ai_usage`'a bağla.
- `roulette-pick/index.ts:54`: `const consume = body.consume !== false;` → `const consume = true;` (client flag'ine güvenme) ve kotayı atomik yap: `UPDATE roulette_spins SET spins_used = spins_used + 1 WHERE user_id = $1 AND spin_date = current_date AND spins_used < allowed RETURNING ...`.

---

## FAZ 3 — KULLANICIYI ETKİLEYEN FONKSİYONEL HATALAR

### 3.1 Sohbet: optimistic gönderim + doğru cache invalidation
`src/hooks/use-chat.ts` `useSendMessage`: `onMutate` ile `["messages", conversationId]` cache'ine geçici mesaj ekle (`id: "optimistic-"+crypto.randomUUID()`, `created_at: new Date().toISOString()`), `onSuccess`'te gerçek satırla değiştir, `onError`'da geri al. Ayrıca `onSuccess`'te `["messages", conversationId]` invalidate et. Reconnect'te de `invalidateQueries(["messages", conversationId])` (realtime kopması için).

### 3.2 Diary: unique constraint + upsert (duplicate satır yarışı)
```sql
delete from public.diary a using public.diary b
  where a.ctid < b.ctid and a.user_id = b.user_id and a.tmdb_id = b.tmdb_id; -- mevcut duplicate temizliği
alter table public.diary add constraint diary_user_tmdb_key unique (user_id, tmdb_id);
create index if not exists idx_diary_user on public.diary(user_id);
```
`src/hooks/use-diary.ts`: read-then-insert yerine `.upsert(..., { onConflict: "user_id,tmdb_id" })`; `watched_at`'i UTC değil **yerel** tarihle yaz (`date-fns` `format(new Date(),'yyyy-MM-dd')`).

### 3.3 Yorum düzenleme: formu mevcut yorumla doldur (boş-üzerine-yazmayı önle)
`src/components/movie/MovieReviews.tsx`: `myReview` async geldiğinde form state'ini senkronla:
```ts
useEffect(() => {
  if (myReview) { setRating(myReview.rating ?? 8); setShortComment(myReview.short_comment ?? ""); setHasSpoiler(!!myReview.has_spoiler); }
}, [myReview?.id]);
```

### 3.4 "Hata" ekranlarını "boş sonuç"tan ayır (her yerde)
`isError` dalını ekleyip `<TmdbErrorState onRetry={refetch} />` göster: `GenrePage`, `CollectionPage`, `EpisodePage`, `Category`, `Search`, `BestOfYearGenre`, `StreamingPlatform`, `TonightSituation`. Sonsuz-spinner ekranlarına try/catch+finally / `isError`: `PublicList`, `PublicProfile`, `MovieSoundtrack`, `CinemaPersonality`, `CoupleMode`.

### 3.5 Tahmin deadline kilidi + günlük reset (TR saat)
- `src/components/duels/PredictionCard.tsx`: `const ended = resolves_at && Date.parse(resolves_at) < Date.now(); const locked = !!pickedOptionId || resolved || ended;`
- `src/components/DailyQuests.tsx` ve `DailyDrop.tsx`: `new Date().toISOString().split("T")[0]` → kullanıcı-yerel tarih (`format(new Date(),'yyyy-MM-dd')`).
- `use-polls.ts`/`use-predictions.ts`: oy `.insert` → `.upsert(onConflict)`; options-fetch hatasını yut(ma).

### 3.6 İki toast sistemi + sonner teması
`src/App.tsx`: `<Toaster/>` (shadcn) satırını kaldır (ölü kod); `src/components/ui/sonner.tsx`'te `theme="dark"` sabitle (ThemeProvider yok).

---

## FAZ 4 — ÖLÇEK (100K)

### 4.1 TMDB cache (tek token throttle'ını önle)
`tmdb-proxy`'de cache ekle: `(endpoint+lang)` anahtarıyla bir `tmdb_cache` tablosu (TTL'li) ya da response'a `Cache-Control: public, s-maxage=3600` header'ı (CDN absorbe etsin). `src/lib/tmdb.ts:334-360` locale-fallback ikinci en-US çağrısını yalnız gerçekten boş alanlarda yap (veya `translations` endpoint'ine indir).

### 4.2 Realtime aboneliklerini filtrele + benzersiz kanal
`messages`/`match_suggestions` aboneliklerine postgres `filter` ekle (kullanıcının konuşmaları). Statik kanal adlarına (`use-notifications.ts`, `use-film-duels.ts`, `use-discussions.ts`, `use-chat.ts`) `crypto.randomUUID()` suffix. (Supabase Realtime bağlantı kotasını da Pro/Team'de yükselt.)

### 4.3 Pagination + auth-email TTL
Sınırsız SELECT'lere `.limit()/.range()`: `use-chat` (conversations/messages), `use-moments` (feed/grid), `use-co-watch`, `use-watching-status`. Supabase Auth: signup-onay e-postası TTL'ini uzat (veya kuyruğu baypas edip inline gönder) ve **"Confirm email" AÇIK** olsun + CAPTCHA ekle.

---

## Bu turda DÜZELTMEYE GEREK OLMAYAN (savunma zaten tutuyor) — dokunma:
JWT forge, profiles/diary/messages PII anon-read, admin yükseltme (`user_roles`), cross-user write IDOR, **puan/skor forgery** (zaten service-role RPC'lere taşınmış), delete-account IDOR, storage upload IDOR, realtime snooping (default-deny), SQLi, XSS, e-posta webhook/queue auth, og-image SSRF. Bunlar SAFE.

## i18n (ayrı, büyük iş)
`src/i18n/translations/de|es|fr|it|hi.ts` `en.ts`'e göre **808 anahtar eksik** — backfill et. `src/hooks/*` ve `src/pages/*`'teki ~89 hardcoded (çoğu Türkçe) `toast.*("...")` çağrısını `t("...")`'ye taşı.
