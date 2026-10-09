# Transceiver — tasarım

Tarih: 2026-10-09 · Durum: grill-me iki turu onaylandı (Q1–Q23), tasarım ekranları Claude Design'da.

## Amaç

Claude Code kullanıcıları, yalnızca Claude'un içinden ve ek bir servis kurmadan arkadaşlarıyla mesajlaşır. Ortak bir GitHub reposunda collaborator olan kişilerin agent'ları o proje hakkında bilgi alışverişi yapar ve birlikte çalışır. Bunun için hiçbir veri izinsiz dışarı çıkmaz ve taşıma katmanı model tokeni harcamaz.

## Kapsam dışı (v1)

Grup sohbeti, uçtan uca şifreleme, görsel/ek dosya, "yazıyor…" göstergesi, mobilde mod içinden yazma, gist ile kimlik ispatı.

## Mimari

```
 Claude Code (Emre)                    claude.ai                      Claude Code (Alperen)
 ┌───────────────────┐   ArtifactData   ┌───────────────────────┐   ArtifactData   ┌───────────────────┐
 │ transceiver modu  │ ───────────────▶ │ Oda artifact'i (db)   │ ◀─────────────── │ transceiver modu  │
 │  pane · araçlar   │ ◀─── yoklama ─── │  outbox/{self}/msgs   │ ─── yoklama ───▶ │  pane · araçlar   │
 │  responder · kapı │                  │  outbox/{self} (head) │                  │  responder · kapı │
 └───────────────────┘                  │  outbox/{self}/claims │                  └───────────────────┘
                                         │  sayfa: web sohbet    │ ◀── telefon / tarayıcı (onSnapshot)
                                         └───────────────────────┘
```

- **Relay:** Her oda ayrı bir Claude Artifact'i ve `db` + `user` yeteneklerine sahip. Kurallar `outbox` (okuma `view`, yazma `owner`) ve `outbox/{self}` (yazma `interact`). Herkes yalnızca kendi kutusuna yazabilir, bu kural sunucu tarafında uygulanır. Spike ile doğrulandı: başkasının kutusuna yazma `interact` seviyesinde reddediliyor.
- **Oda türleri:** Her kişi çifti için bir DM odası, her ortak repo için bir proje odası. Odalar birbirini göremez.
- **Mod:** `~/Projects/transceiver` (MODZ'un kardeşi, kendi repo ve marketplace'i `partalemre/transceiver`), `~/.claude/skills/transceiver` symlink'iyle bağlanır. Kendi pane'i (`transceiver`), kendi `$.state` ad alanı, kendi `$.store`'u var. Diğer modların band, pane ya da state'ine dokunmaz. Yalnızca kendi status girdisini ve toast'larını kullanır.
- **Taşıma:** Mod `$.tool.call({ tool: 'ArtifactData', ... })` ile çağrı yapar. Bu çağrılar model turu değildir, 0 token harcar.

## Veri modeli

| Yol | Tür | Yazan | Alanlar |
| --- | --- | --- | --- |
| `outbox/{uid}` | head dokümanı | yalnızca uid | `{v:1, head, headTs, seenUpTo, readUpTo, readTs, gh?, label?}` |
| `outbox/{uid}/msgs/{ulid}` | mesaj | yalnızca uid | `{v:1, id, ts, kind, text, replyTo?, query?, answer?}` |
| `outbox/{uid}/claims/{qid}` | iş sahiplenme | yalnızca uid | `{v:1, at}`; yalnızca oluşturulur (create-only) |
| `outbox/{uid}/days/{yyyy-mm-dd}` | sıkıştırılmış gün | yalnızca uid | `{v:1, msgs: Message[]}` |
| `meta/room` | oda bilgisi | yalnızca owner | `{v:1, kind:'dm'\|'project', repo?, createdAt}` |

`kind` alanı: `human | agent | query | answer | system`.

- **`query`:** `{type:'status'|'log'|'branch'|'diff'|'file'|'tests'|'plan'|'ask', repo, path?, question?}`
- **`answer`:** `{qid, ok, body, tokens}`. `ok:false` olduğunda gövde her zaman tam olarak `erişim yok` olur.

Her dokümanın sürümü `v:1`. Doğrulama elle yazılmış guard'larla `protocol.ts` içinde yapılır. Doğrulamadan geçemeyen doküman "okunamayan mesaj" olarak gösterilir.

## Hız ("WhatsApp kadar hızlı")

- Gönderilen mesaj anında yerelde görünür (optimistic UI). Mesajla head birlikte tek bir atomik `batch` ile yazılır. Spike ile doğrulandı.
- Her yoklama tek bir `list outbox` çağrısıdır: tüm üyelerin head dokümanları gelir. Yalnızca `head` alanı değişen üye için `query msgs where ts > imleç` çağrısı yapılır.
- Yoklama aralığı pane açıkken 1 saniye, kapalıyken 5 saniye. Hata olursa bekleme 2 kat artar, üst sınır 30 saniye.
- Mesaj durumu: ✓ yazıldı, ✓✓ karşının `seenUpTo` imleci geçti, mavi ✓✓ `readUpTo` geçti. Okundu bilgisi kapatılabilir ve WhatsApp'taki gibi karşılıklıdır.
- Gerçek anlık bağlantı (push) yalnızca oda sayfasında var (`onSnapshot`), telefon ve web için.

## Akışlar

1. **Ekleme:**
   - `/transceiver ekle` oda sayfasını `Artifact publish` ile yayınlar, `meta/room` dokümanını yazar ve paylaşım sayfasını açar.
   - Kullanıcı claude.ai'de Paylaş → e-posta adımını yapar. Bu tek elle adım, çünkü platformun paylaşım API'si yok.
2. **Keşif:** Karşı tarafın modu 60 saniyede bir `Artifact list scope:'shared'` çağırır. Başlığı `Transceiver ·` ile başlayan ve `meta/room` dokümanı geçerli olan artifact'ler için pane'de Kabul / Reddet sorar.
3. **GitHub eşleşmesi:** Odaya katılan kişi head dokümanına `gh` alanını yazar. Diğer taraf "X GitHub'da Y mi?" sorusunu bir kez onaylar. Onay `$.store`'da tutulur.
4. **Kapı:** Agent trafiği yalnızca şu dört koşulun hepsi doğruysa açılır:
   - Kişi onaylı.
   - Kişi o reponun collaborator'ü. Kontrol GitHub MCP `list_repository_collaborators` ile, yoksa `gh api repos/o/r/collaborators/<login>` ile yapılır. Sonuç 10 dakika önbelleğe alınır.
   - Oturumun repo'su sorgunun repo'su ile aynı.
   - Oda bir proje odası ve repo'su eşleşiyor.

   Kontrol başarısız olursa ya da GitHub'a ulaşılamazsa sonuç kapalı sayılır (fail-closed). Her ret aynı metinle döner.
5. **Cevaplama:**
   - Gelen `query` önce `claims/{qid}` dokümanını oluşturmayı dener (create-only). Oluşturamayan oturum işi bırakır. Böylece aynı makinedeki ya da farklı makinelerdeki birden fazla oturum aynı sorguyu yalnızca bir kez cevaplar.
   - Tipli sorgular modelsiz cevaplanır.
   - `ask` sorgusu Haiku'ya gider, oda başına günde 10 soru sınırıyla. Sınır dolunca soru taslak olarak kullanıcının onayına düşer.
6. **Agent araçları:** `transceiver_send`, `transceiver_inbox` ve `transceiver_ask` (cevabı en fazla 20 saniye bekler, sonra `pending:<id>` döner).
7. **Canlı mod:** Oda başına bir anahtar, varsayılan olarak kapalı. Açıkken gelen agent mesajı, o repodaki boşta oturumu `$.session.send` ile uyandırır. Bu token harcar.
8. **Çıkış:** `/transceiver çık <oda>` yoklamayı durdurur. Kendi mesajlarını silmek istersen ikinci bir onay sorulur.

## Güvenlik

- Gelen her metin dış veri olarak işlenir. Agent'a verilirken nonce'lu "untrusted data" çitleri içine alınır.
- Varsayılan olarak hiçbir oturum adı, klasör yolu, model adı ya da repo listesi yazılmaz. Repo adı yalnızca kapı açık bir proje odasında görünür.
- `file` sorgusu:
  - Yol `realpath` ile repo kökünün içinde kalmak zorunda.
  - Reddedilenler: `.env*`, `*.pem`, `*.key`, `*.p12`, `id_*`, `*.keystore`, `.git/`, `git check-ignore` kapsamındakiler.
  - En fazla 256 KB.
- Giden her cevap ve agent mesajı `findSecrets` taramasından geçer. Bu tarama `secret-guard` modundan kopyalanmıştır (vendored). Bulgu varsa gönderilmez ve "erişim yok" döner.
- Limitler: mesaj 16 KB, `diff` 64 KB, oda başına dakikada 60 sorgu.
- Kalıcı ayar değişikliği (izin kuralı) yalnızca kullanıcının pane'deki onayıyla yapılır.

## Saklama

- 7 günden eski mesajlar her gece kişi başına tek bir `days/{tarih}` paketine sıkıştırılır.
- Oda 20.000 dokümana ulaşınca yeni bir oda artifact'ine devredilir. Eski oda salt okunur kalır.

## Yüzeyler

- **Terminal ve masaüstü Code sekmesi:** tam destek.
- **Mobil:** salt okunur.
- **Oda sayfası:** claude.ai'de ve telefonda açılan tam bir web sohbeti.

## Görsel tasarım

Claude Design tuvali: https://claude.ai/artifact/QJAYV1gwXXsEhX9cYopTU8. Altı pano var: DM, proje odası, terminal, davet ve kapı durumları, telefon, token'lar.

- **Token'lar:** MODZ kit paleti (`kit/tokens.ts`) ve yeni bir `signal` rolü.
  - Koyu: `#5CC8B8`, tint `#1A2E2B`, kenar `#2E5650`.
  - Açık: `#0E6F66`, tint `#E3F3F0`, kenar `#A9D8CF`.
- **Rol eşlemesi:** agent mesajları kit `run`, okundu bilgisi kit `read`, açık kapı kit `ok`, taslak ve limit kit `warn`, ret kit `danger` renginde.

## Doğrulanmış gerçekler (spike, 2026-10-09)

Test artifact'i: https://claude.ai/artifact/WY6LgKgyskkYWeg16kuUrb

- `outbox/{self}` kuralı başkasının kutusuna yazmayı reddediyor, kendi kutusuna yazmaya izin veriyor.
- `batch` (mesaj + head) atomik olarak işleniyor.
- `list outbox` çağrısı head dokümanlarını döndürüyor.
- `query where ts > n order_by ts` `view` seviyesinde çalışıyor.
- Artifact başına sınır 25.000 doküman.
- ArtifactData metin çıktısı her dokümanı tek satırlık bir JSON (`{"id","data","version","updatedAt"}`) olarak, `BEGIN ARTIFACT DB` / `END ARTIFACT DB` işaretleri arasında veriyor.
- `me` kısaltması yalnızca `data/users/me` yolunda çözülüyor. Kullanıcı id'si o okumanın son satırında `u_…` olarak dönüyor.

## Açık riskler (Faz 0 kapatır)

1. Mod içinden `$.tool.call('ArtifactData')` çağrısında izin diyaloğu çıkıyor mu, sonuç `text` alanında mı geliyor, gecikme ne kadar?
2. Başka bir hesaptan davet edilen kişi (guest, `interact`) kendi Claude Code'undan `ArtifactData` ile yazabiliyor mu?
3. `Artifact list scope:'shared'` daveti gösteriyor mu?
4. `$.session.send` kendi oturumunu uyandırıyor mu? (Canlı mod buna bağlı.)

Bir risk tutmazsa ne yapılacağı: plandaki Faz 0 görevinde her sonuç için hangi dosyanın nasıl değişeceği yazılı.
