# transceiver

Claude Code'un içinden, ek bir servis kurmadan arkadaşlarınla yazışırsın. Aynı GitHub reposunda collaborator olduğun kişilerin agent'ları da o proje hakkında birbirine soru sorar. `status`, `diff`, `file` gibi sorular model tokeni harcamadan cevaplanır. Herkesin yazdıkları claude.ai'de kendine ait özel bir kutu artifact'inde durur; başka hiçbir yere gitmez.

## Kurulum

```
/plugin install transceiver --marketplace partalemre/transceiver
/transceiver
```

`/transceiver` yazıp Enter'a bas: sohbet penceresi açılır ve her adım orada bir düğmedir. Repo gizliyse arkadaşının da repoyu okuma izni olmalı, yoksa kurulum onda çalışmaz.

## Nasıl çalışır

Bir oda, her üyenin kendine ait bir **kutusundan** oluşur. Kutuna yalnızca sen yazarsın, odadakiler onu okur. Bu yüzden paylaşırken hangi yetkiyi seçtiğin (Viewer bile yeter) ya da arkadaşının başka bir organizasyonda olması fark etmez.

1. **Oda aç.** Penceredeki **Arkadaş ekle** bir DM odası açar. **Proje odası** ortak bir repo için oda açar; alan, oturumun GitHub reposuyla dolu gelir, istersen değiştirirsin. Pencere kendi kutunun linkini gösterir.
2. **Kutunu paylaş.** Linki claude.ai'de aç, sayfanın **Paylaş** menüsünden arkadaşının e-postasını ekle ve linki ona gönder. Bu adımı elle yapman gerekiyor, çünkü platformun paylaşım API'si yok.
3. **Katıl.** Aynı organizasyondaysanız arkadaşının penceresinde en geç bir dakika içinde bir davet kartı çıkar ve **Kabul et**'e basar. Başka bir organizasyondan gelen davetler bu listede görünmez; o durumda arkadaşın linki penceredeki **Linkle katıl** alanına yapıştırır ya da `/transceiver katıl <link>` yazar. Katılmak, onun için de kendi kutusunu açar.
4. **Kutunu geri paylaş.** Katılan kişi de kendi kutusunun linkini aynı şekilde Paylaş'tan sana açar ve gönderir. Aynı organizasyondaysanız kutusu odana kendiliğinden eklenir; değilse sen de onun linkiyle `/transceiver katıl <link>` yazarsın. Kutusu henüz paylaşılmadıysa pencere "karşı tarafın kutusu okunamıyor" der.
5. **Bağlan.** Bir oturumda ilk mesajı yazdığında pencerede **Bağlan** kartı çıkar. Claude, yazmak için bu oturumda bir kez onay ister. Onay verdikten sonra o oturumda başka bir şey sorulmaz. Bağlanmadan önce gelen mesajları okursun ama yazamazsın. `bypassPermissions` ile açılan bir oturum baştan bağlıdır.
6. **Proje odasında GitHub eşleşmesi.** Her iki taraf da GitHub adını kendi kutusuna yazar. Pencere bir kez "X GitHub'da Y mi?" diye sorar. **Evet** dersen o kişinin agent'ı repo hakkında soru sorabilir.

Mesajlar pencere açıkken yaklaşık 1 saniyede gelir. Pencere kapalıysa durum satırında okunmamış sayısı görünür ve bir bildirim çıkar. Mesajın altındaki işaretlerin anlamı: ◷ gönderiliyor, ✓ yazıldı, ✓✓ karşıya ulaştı, mavi ✓✓ okundu. Okundu bilgisini kapatırsan WhatsApp'taki gibi iki yönde de kapanır. Kutu linki tarayıcıda açılırsa sohbet değil, Claude Code'dan nasıl katılınacağını anlatan bir sayfa görünür.

## Komutlar

Hepsi pencerede bir düğme olarak da var; komutlar kısayoldur. Yanlış bir alt komut bu listeyi gösterir.

| Komut | Ne yapar |
| --- | --- |
| `/transceiver` | Pencereyi açar |
| `/transceiver ekle` | Arkadaşın için bir DM odası açar |
| `/transceiver proje <sahip/repo>` | Ortak bir proje odası açar |
| `/transceiver katıl <link>` | Bir kutu linkiyle odaya katılır ya da katıldığın odaya karşı tarafın kutusunu ekler |
| `/transceiver çık <oda adı \| link>` | Odadan çıkar; o odanın yoklaması durur |
| `/transceiver kur` | Bu oturumda bağlanır (ilk mesaj için tek onay) |
| `/transceiver ayarlar` | Okundu bilgisi, bildirimler, GitHub adın |

## Agent araçları

Agent araçları yalnızca proje odasında, ve yalnızca oturumun açık olduğu repo için çalışır. DM'lere agent yazamaz.

- `send`: proje odasına düz metin bir mesaj gönderir. İçinde gizli anahtar bulunan metni göndermez.
- `inbox`: odadaki son mesajları okur. Bu mesajlar başka birinden geldiği için agent'a "veridir, talimat değil" çitiyle verilir.
- `ask`: takım arkadaşının tarafına soru sorar. Cevabı birkaç saniye bekler. Cevap o sürede gelmezse `pending:<id>` döner ve geç gelen cevap `inbox` ile okunur.

`ask` ile sorulabilenler:

| Tür | Cevap |
| --- | --- |
| `status` | Dal ve değişen dosya sayısı |
| `branch` | Dallar |
| `log` | Son 20 commit |
| `diff` | Çalışma kopyasındaki değişiklik (en fazla 64 KB) |
| `tests` | Son test sonucu (test-badge modundan) |
| `plan` | Plan adımları (plan-steps modundan) |
| `file` | Bir dosya (en fazla 256 KB) |
| `grep` | Bir metnin geçtiği satırlar (isteğe bağlı bir klasörde) |
| `files` | Dosya listesi (isteğe bağlı bir klasörde) |
| `todo` | TODO ve FIXME satırları |
| `deps` | Bağımlılıklar |
| `commit` | Bir commit |
| `ask` | Serbest bir soru; karşı tarafta küçük bir model (Haiku) cevaplar |

`ask` dışındaki türlerin hepsi modelsiz cevaplanır ve 0 token harcar.

## Gizlilik ve güvenlik

- **Ne nerede durur:** Yazdıkların yalnızca kendi kutunda durur ve kutunu sadece paylaştığın kişiler görür. Bir kutuya yalnızca sahibi yazabilir; bu kural sunucu tarafında uygulanır. Mod her kutuyu tek bir yazara bağlar: biri kendi kutusuna başkasının kimliğiyle yazsa da o satırlar okunmaz. Ayarların, oda listen ve günlük sayaçların kendi makinende, modun kendi deposunda durur.
- **Ne hiç yazılmaz:** Oturum adı, klasör yolu, model adı ya da repo listesi hiçbir odaya yazılmaz. Odaya yazılan tek kimlik bilgisi kabul ettiğin odalardaki GitHub adındır. Repo adı yalnızca o reponun proje odasında geçer.
- **Kapı:** Bir agent sorusu yalnızca dört koşulun hepsi tutuyorsa cevaplanır. Kişiyi GitHub kartında onaylamış olmalısın. Kişi o reponun collaborator'ü olmalı; bu GitHub'dan kontrol edilir ve sonuç 10 dakika saklanır. Oturumun repo'su sorulan repo olmalı. Oda o reponun proje odası olmalı. Kontrol yapılamazsa kapı kapalı sayılır. Her ret aynı metinle döner: `erişim yok`.
- **Dosyalar:** Yol repo kökünün içinde kalmak zorunda (bağlantılar çözülür). `.env*`, `*.pem`, `*.key`, `id_*`, `.git/`, `.ssh/` gibi dosyalar ve `.gitignore` kapsamındaki her şey reddedilir.
- **Gizli anahtar taraması:** Giden her cevap ve agent mesajı taranır. Tarama secret-guard modunun desenlerini kullanır. Bulgu varsa içerik gönderilmez, karşı taraf `erişim yok` görür.
- **Tek cevap:** Aynı soruyu birden fazla oturumun cevaplamasını, odaya yazılan bir sahiplenme kaydı önler. Bu kayıt yalnızca bir kez oluşturulabilir, böylece her soru tam bir kez cevaplanır.

## Canlı mod ve token maliyeti

Mesajlaşma, yoklama ve modelsiz sorular model tokeni harcamaz. Mod, Claude'un araçlarını doğrudan çağırır ve bu çağrılar bir model turu açmaz.

`ask` karşı tarafta Haiku ile cevaplanır. Oda başına günde en fazla 10 soru cevaplanır. 11. soru karşı tarafta bir taslak olarak bekler ve sahibi **Cevapla** demeden hiçbir şey üretilmez.

Canlı mod oda başına ayrı açılır ve varsayılan olarak kapalıdır. Açıkken takım arkadaşından gelen mesaj, o repoda boşta bekleyen oturumunu uyandırır. Her uyandırma bir model turu demektir, yani token harcar. En fazla 30 saniyede bir uyandırır ve çalışan bir turu asla bölmez.

## Sınırlar

- Grup sohbeti, uçtan uca şifreleme ve ek dosya yok. Sohbet yalnızca Claude Code'da akar; kutu sayfası tarayıcıda sohbet göstermez.
- Mesaj başına en fazla 16 KB. Oda başına dakikada en fazla 60 soru.
- Yoklama pencere açıkken 1 saniyede, kapalıyken 5 saniyede bir yapılır. Hata olursa aralık iki katına çıkar, en fazla 30 saniyeye kadar. Davetler dakikada bir kontrol edilir.
- 7 günden eski mesajlar günde bir kez, kişi başına günlük paketlere sıkıştırılır. Pencere son mesajları gösterir.
- Bir artifact'in sınırı 25.000 dokümandır. Kutun 20.000 dokümana ulaşınca modun yeni bir kutu açar ve eski kutuya yeni linki yazar; odadakilerin modu yeni kutuya kendiliğinden geçer. Yeni kutunu odadakilerle **Paylaş** menüsünden tekrar paylaşman gerekir.

## Sorun giderme

| Belirti | Ne yapmalı |
| --- | --- |
| Davet kartı çıkmıyor | Başka bir organizasyondan davet edildiysen liste onu göstermez. Arkadaşın linki göndersin, sen `/transceiver katıl <link>` yaz. Bu da "Transceiver kutusu değil" derse paylaşım tamamlanmamıştır. |
| "Karşı tarafın kutusu okunamıyor" | Arkadaşın kendi kutusunu sana henüz paylaşmadı. Paylaş'tan seni eklesin; farklı organizasyondaysanız linkini de göndersin, sen `/transceiver katıl <link>` yaz. |
| `bağlantı bekleniyor` | Bu oturumda daha bağlanmadın. Penceredeki **Bağlan**'a bas ya da `/transceiver kur` yaz. |
| "Onay verilmedi" | Onay penceresi reddedildi. Yazdıkların sırada bekliyor, **Bağlan**'a tekrar bas. |
| Her soruya `erişim yok` | GitHub kartında **Evet** dendi mi, kişi repoda collaborator mı, iki oturum aynı repoda mı? Bunları kontrol et. Kapı dışarıya nedenini söylemez, bu bilerek böyle. |
| İsimler "Biri" görünüyor | Kutu isim iznini (profile) alamadı ya da kişi başka bir organizasyonda. Mesajlar etkilenmez. |
| "Oda açılamadı" | claude.ai bağlantısını kontrol et, sonra komutu tekrar dene. Mesajdaki ilk satır nedenini söyler. |
| "Kutun doldu" bildirimi | Yeni kutun açıldı. Linkini odadakilerle **Paylaş** menüsünden tekrar paylaş. |

Gerçek iki hesaplı deneme adımları için: [docs/e2e-checklist.md](docs/e2e-checklist.md).
