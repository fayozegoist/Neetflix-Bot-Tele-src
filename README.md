# MEDIAFAIRY Netflix Token Bot (Cloudflare Worker)

Bot Telegram untuk membuat **token auto-login Netflix** dari cookie `NetflixId`.
Berjalan sebagai Cloudflare Worker (tanpa server). Konfigurasi & sesi user di
Cloudflare KV, **Vault akun di Cloudflare D1** (SQLite) supaya tetap cepat sampai
ribuan akun.

- **Worker:** `neetflix-bot-v2`
- **URL:** https://neetflix-bot-v2.panel-fairy.workers.dev
- **Webhook:** `/webhook`

## Fitur

| Fitur | Keterangan |
|---|---|
| 🎲 Generate Token | tombol menu → pilih negara → token dikirim |
| 🌍 Daftar negara | 60 negara urut **A–Z**, tombol beremoji bendera, **3 halaman** (@20) |
| 📁 Vault | penyimpanan akun, dipaginasi |
| 📊 Cek Limit | status kuota + sisa cooldown |
| 🔄 Convert (admin) | `/conv <teks>` atau kirim file `.txt` (single & bulk) |
| 🧹 Auto-validasi | cron **tiap menit**: antrean dulu, lalu rotasi akun aktif |
| 🖥️ Dashboard `/admin` | upload massal (sampai 5000 akun), rekap, validasi manual |
| 📢 Broadcast (admin) | `/broadcast <pesan>`, bertahap agar aman free plan |

## Aturan yang berlaku

- **Kuota: unlimited.** Cooldown **60 detik** antar generate, dan **hanya terpakai kalau
  generate berhasil**. Gagal karena stok habis, cookie mati, atau input salah **tidak**
  menghabiskan jeda. Admin bebas cooldown.
  (Set `FREE_DAILY_LIMIT=0` untuk mode unlimited. Nilai > 0 mengaktifkan batas harian.)
- **Generate hanya lewat tombol menu.** Command `/gen` sudah **dihapus** — tidak ada lagi
  input cookie manual. Alurnya: tekan **🎲 Generate Token** → pilih negara → token dikirim.
  Yang masih mengetik `/gen` akan diarahkan ke menu.
- **Wajib join channel** `@MediafairyCh` lalu tekan **Verifikasi**. Admin dikecualikan.
- **Sapaan `/start` dibedakan 3 versi:** belum join → pesan terkunci + tombol Verifikasi;
  baru join → *"Selamat datang"* + status terverifikasi; user lama → *"Selamat datang
  kembali"*; admin → sapaan admin (bebas cooldown). Baris *"wajib join channel"* tidak
  lagi muncul untuk user yang sudah lolos verifikasi.
- **Daftar negara urut A–Z** berdasarkan nama negara (Argentina … Vietnam), dibagi
  3 halaman berisi 20 negara, plus tombol **🎲 Semua Negara**.
- **Stiker loading saat generate.** Saat menekan tombol negara, bot mengirim satu stiker
  acak dari [set `mfload`](https://t.me/addstickers/mfload) sebagai penanda proses, lalu
  **menghapusnya** tepat sebelum token dikirim — jadi chat tetap bersih. Loading ini
  **hanya pada generate**: convert, menu, `/start`, dan pesan lain tetap instan. Bila stok
  kosong, balasan tetap instan tanpa stiker. Bila stiker gagal terkirim, bot otomatis
  kembali memakai teks *"🔄 Memverifikasi…"*. Atur durasi lewat `LOADING_MS`, matikan
  dengan `LOADING_MS=0`.
- **Convert otomatis menyaring:**
  1. cookie mati (gagal ambil token) → dibuang
  2. cookie hidup tapi `Next Billing` sudah lewat → dibuang
  3. hanya akun aktif & billing aman → masuk Vault
  4. field `• Expires:` **diabaikan** — itu masa berlaku *link login*, bukan cookie.
     Cookie bisa tetap hidup walau link login-nya sudah basi.
  5. mendukung file berisi 1 akun maupun puluhan akun sekaligus
- **Auto-validasi tahan salah hapus.** Hanya kegagalan yang **pasti** yang membuat akun
  dibuang: respons `ok` + JSON valid tetapi tanpa node token (`reason: cookie_mati`).
  Rate-limit (429), error server (5xx), timeout, dan body non-JSON dianggap **ambigu** →
  akun **tidak dihapus**, dan **circuit breaker** (`validate_state` di KV) menjeda
  validasi sementara.
  - Laju adaptif: mulai **12 akun/menit**, naik bertahap ke **25/menit** setelah **100
    hasil meyakinkan** berturut-turut tanpa yang ambigu.
  - **5** hasil ambigu berturut-turut → jeda **30 menit**. **3×** jeda dalam 1 jam →
    **hard pause** (hanya bisa dilanjutkan manual dari `/admin`).
- **Baris mati di-soft-delete** (`status='dead'` + alasan) supaya `/admin` masih bisa
  melaporkannya; cron menghapus permanen setelah `DEAD_RETENTION_MS` (default 7 hari).
  `/del` tetap menghapus permanen.
- **Upload ulang file yang sama tidak menggandakan akun.** Dedupe memakai
  `cookie_hash` (128 bit pertama SHA-256 dari `NetflixId`) dengan UNIQUE index.
- **Catatan generate ke grup RecordBot.** Setiap generate oleh user biasa dikirim ke
  grup [@MFrecordbot](https://t.me/MFrecordbot) (`GROUP_ID`): user, id, email
  **disamarkan**, region, dan plan — **tanpa token maupun link login**, jadi grup itu
  tidak bisa dipakai mengambil token orang. Generate oleh admin **tidak** dicatat supaya
  grup tidak terisi hasil uji coba. Kosongkan `GROUP_ID` untuk mematikan.
- **Login: `/admin`** (kunci `ADMIN_WEB_KEY`, lewat `?key=` atau header `x-admin-key`).
  Halaman ini untuk **upload massal** file akun (klien memotong file per 30 KB lalu
  mengirim berkali-kali, jadi file besar pun aman), melihat rekap per negara, memicu
  validasi manual, dan melanjutkan breaker yang hard-paused. Halaman dikirim dengan
  `X-Robots-Tag: noindex, nofollow` dan tanpa cache.

## Kuota D1 (free plan: 5 juta baris-baca/hari)

Cron berjalan **1440×/hari**, jadi satu pindai tabel per tick akan langsung melewati
kuota. Karena itu jalur panas dibuat menyempit, dan diukur langsung di D1 produksi
(`scratch/d1cost.mjs`):

| Operasi | Baris dibaca |
|---|---|
| Cek antrean tiap menit (`hasPending`) | **1** |
| Generate, per negara (`pickRandom`) | **~11** |
| Satu halaman Vault | **11** |
| Rekap `/admin` (hanya saat cache basi) | ~9.500 |

Sebagai pembanding, pendekatan lama: `countAll()` tiap tick = 4999 baris × 1440 =
**7,2 juta/hari** (melewati batas), dan `ORDER BY RANDOM()` = ~3000–9000 baris **per
generate**. Rekap di-cache di KV (`vault_stats`, 10 menit) sehingga polling `/admin`
tidak menyentuh D1.

## Konfigurasi

Non-rahasia ada di `wrangler.toml` (`[vars]`). Rahasia disimpan sebagai Worker secret.

| Variabel | Default | Catatan |
|---|---|---|
| `ADMIN_ID` | `6968439759` | Telegram user id admin |
| `ADMIN_USERNAME` | `iMediafairy` | |
| `CHANNEL_ID` | `-1002952378946` | channel wajib join |
| `CHANNEL_URL` | `https://t.me/MediafairyCh` | |
| `FREE_DAILY_LIMIT` | `0` | `0` = unlimited |
| `COOLDOWN_MS` | `60000` | jeda antar generate |
| `BATCH_SIZE` | `25` | akun divalidasi per cron (maks 25) |
| `CONVERT_BATCH` | `25` | akun diproses per file convert (maks 25) |
| `BROADCAST_BATCH` | `25` | user per run broadcast (maks 25) |
| `LOADING_MS` | `10000` | durasi stiker loading saat generate (ms), `0` = mati |
| `LOADING_STICKERS` | `mfload` | nama set stiker dari `t.me/addstickers/<nama>` |
| `DEAD_RETENTION_MS` | `604800000` | simpan baris mati selama ini sebelum dihapus permanen (7 hari) |
| `GROUP_ID` | `-1003744140971` | grup **RecordBot** (@MFrecordbot): catatan tiap generate user biasa. Kosong = mati |
| `WEBHOOK_PATH` | `/webhook` | |
| `BOT_TOKEN`, `SECRET_TOKEN`, `SETUP_KEY`, `ADMIN_WEB_KEY` | — | **secret**, jangan commit |

> **Kenapa maksimal 25?** Tiap akun butuh satu request ke Netflix (~600 ms). Cloudflare
> free plan membatasi **50 subrequest per eksekusi Worker**. Batch 25 (±19 s) aman;
> batch 40 (±35 s) berisiko kena limit/waktu. Cron juga dibuat broadcast **XOR** validasi
> supaya dua proses berat tidak jalan bersamaan.

## Deploy

```bash
npm ci
npx wrangler secret put BOT_TOKEN      # token dari @BotFather
npx wrangler secret put SECRET_TOKEN   # string acak, mis. openssl rand -hex 24
npx wrangler secret put SETUP_KEY      # string acak, mis. openssl rand -hex 16
npx wrangler secret put ADMIN_WEB_KEY  # string acak, kunci halaman /admin
npm run deploy                         # build + obfuscate + deploy

# siapkan skema Vault di D1 (sekali):
npx wrangler d1 execute neetflix-vault --remote --file=schema.sql

# daftarkan webhook (sekali):
curl "https://neetflix-bot-v2.panel-fairy.workers.dev/setwebhook?key=<SETUP_KEY>"
```

Buka dashboard upload: `https://neetflix-bot-v2.panel-fairy.workers.dev/admin?key=<ADMIN_WEB_KEY>`

Cek hasil: `curl .../getWebhookInfo` → `url` harus berisi `.../webhook`, `pending_update_count: 0`.

### Deploy otomatis (GitHub Actions)

`.github/workflows/deploy.yml` menjalankan typecheck → build → obfuscate → deploy pada
setiap push ke `main`. Siapkan repository secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN`, `SECRET_TOKEN`, `SETUP_KEY`,
dan opsional `ADMIN_WEB_KEY` (kalau kosong, secret yang sudah ada tidak ditimpa).

## Perintah admin

| Perintah | Fungsi |
|---|---|
| `/admin` *(web)* | upload massal, rekap, validasi manual, lanjutkan breaker |
| `/clearvault` | kosongkan seluruh Vault |
| `/del <id>` | hapus 1 akun dari Vault |
| `/resetcooldown <user_id>` | reset cooldown user |
| `/broadcast <pesan>` | kirim pengumuman ke semua user |
| `/stats` | statistik server |
| `/conv <teks>` / kirim `.txt` | convert cookie ke Vault |

## Struktur

```
src/
  index.ts           entry Worker: routing webhook + cron + /admin
  config.ts          baca Env -> Config
  parse.ts           pemecah teks multi-akun (HIT & netscape)
  dateparse.ts       parser "Next Billing" ES/PT/EN
  countries.ts       60 negara + resolver region -> ISO2 + emoji bendera
  netflix.ts         extractMetadata / extractCookieDict / fetchNfToken + klasifikasi error
  hash.ts            cookieHash (SHA-256 -> 128 bit) untuk dedupe
  convert.ts         pipeline convert + aturan buang
  generate.ts        generate token + random by negara + cooldown
  validate.ts        auto-validasi cron (antrean + rotasi) + breaker
  breaker.ts         laju adaptif + jeda/hard-pause
  admin.ts           halaman /admin + API upload massal
  vaultstats.ts      cache rekap vault di KV
  gate.ts            verifikasi join channel
  menu.ts            keyboard menu & menu negara
  handlers/          message.ts, callback.ts
  vaultstore.ts      antarmuka VaultStore
  vaultrepo.ts       implementasi D1 (SQL)
  kv.ts, bot.ts, telegram.ts, vault.ts, broadcast.ts, donation.ts, stats.ts
schema.sql           skema tabel + index D1
```

## Lisensi

Lihat `LICENSE`.
