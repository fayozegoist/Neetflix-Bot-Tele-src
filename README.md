# MEDIAFAIRY Netflix Token Bot (Cloudflare Worker)

Bot Telegram untuk membuat **token auto-login Netflix** dari cookie `NetflixId`.
Berjalan sebagai Cloudflare Worker (tanpa server), data disimpan di Cloudflare KV.

- **Worker:** `neetflix-bot-v2`
- **URL:** https://neetflix-bot-v2.panel-fairy.workers.dev
- **Webhook:** `/webhook`

## Fitur

| Fitur | Keterangan |
|---|---|
| 🔑 Generate Token | tombol menu → pilih negara → token dikirim |
| 🎲 Generate Random | tombol menu → pilih negara → token dikirim |
| 🌍 Daftar negara | 60 negara urut **A–Z**, tombol beremoji bendera, **3 halaman** (@20) |
| 📁 Vault | penyimpanan akun, dipaginasi |
| 📊 Cek Limit | status kuota + sisa cooldown |
| 🔄 Convert (admin) | `/conv <teks>` atau kirim file `.txt` (single & bulk) |
| 🧹 Auto-validasi | cron tiap 30 menit membuang cookie mati |
| 📢 Broadcast (admin) | `/broadcast <pesan>`, bertahap agar aman free plan |

## Aturan yang berlaku

- **Kuota: unlimited.** Cooldown **60 detik** antar generate, dan **hanya terpakai kalau
  generate berhasil**. Gagal karena stok habis, cookie mati, atau input salah **tidak**
  menghabiskan jeda. Admin bebas cooldown.
  (Set `FREE_DAILY_LIMIT=0` untuk mode unlimited. Nilai > 0 mengaktifkan batas harian.)
- **Generate hanya lewat tombol menu.** Command `/gen` sudah **dihapus** — tidak ada lagi
  input cookie manual. Alurnya: tekan **🔑 Generate Token** (atau **🎲 Generate Random**)
  → pilih negara → token dikirim. Yang masih mengetik `/gen` akan diarahkan ke menu.
- **Wajib join channel** `@MediafairyCh` lalu tekan **Verifikasi**. Admin dikecualikan.
- **Daftar negara urut A–Z** berdasarkan nama negara (Argentina … Vietnam), dibagi
  3 halaman berisi 20 negara, plus tombol **🎲 Semua Negara**.
- **Convert otomatis menyaring:**
  1. cookie mati (gagal ambil token) → dibuang
  2. cookie hidup tapi `Next Billing` sudah lewat → dibuang
  3. hanya akun aktif & billing aman → masuk Vault
  4. field `• Expires:` **diabaikan** — itu masa berlaku *link login*, bukan cookie.
     Cookie bisa tetap hidup walau link login-nya sudah basi.
  5. mendukung file berisi 1 akun maupun puluhan akun sekaligus

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
| `GROUP_ID` | *(kosong)* | isi bila ingin notifikasi generate ke grup |
| `WEBHOOK_PATH` | `/webhook` | |
| `BOT_TOKEN`, `SECRET_TOKEN`, `SETUP_KEY` | — | **secret**, jangan commit |

> **Kenapa maksimal 25?** Tiap akun butuh satu request ke Netflix (~600 ms). Cloudflare
> free plan membatasi **50 subrequest per eksekusi Worker**. Batch 25 (±19 s) aman;
> batch 40 (±35 s) berisiko kena limit/waktu. Cron juga dibuat broadcast **XOR** validasi
> supaya dua proses berat tidak jalan bersamaan.

## Deploy

```bash
npm ci
npx wrangler secret put BOT_TOKEN     # token dari @BotFather
npx wrangler secret put SECRET_TOKEN  # string acak, mis. openssl rand -hex 24
npx wrangler secret put SETUP_KEY     # string acak, mis. openssl rand -hex 16
npm run deploy                        # build + obfuscate + deploy

# daftarkan webhook (sekali):
curl "https://neetflix-bot-v2.panel-fairy.workers.dev/setwebhook?key=<SETUP_KEY>"
```

Cek hasil: `curl .../getWebhookInfo` → `url` harus berisi `.../webhook`, `pending_update_count: 0`.

### Deploy otomatis (GitHub Actions)

`.github/workflows/deploy.yml` menjalankan typecheck → build → obfuscate → deploy pada
setiap push ke `main`. Siapkan repository secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN`, `SECRET_TOKEN`, `SETUP_KEY`.

## Perintah admin

| Perintah | Fungsi |
|---|---|
| `/clearvault` | kosongkan seluruh Vault |
| `/del <id>` | hapus 1 akun dari Vault |
| `/resetcooldown <user_id>` | reset cooldown user |
| `/broadcast <pesan>` | kirim pengumuman ke semua user |
| `/stats` | statistik server |
| `/conv <teks>` / kirim `.txt` | convert cookie ke Vault |

## Struktur

```
src/
  index.ts           entry Worker: routing webhook + cron
  config.ts          baca Env -> Config
  parse.ts           pemecah teks multi-akun (HIT & netscape)
  dateparse.ts       parser "Next Billing" ES/PT/EN
  countries.ts       60 negara + resolver region -> ISO2 + emoji bendera
  netflix.ts         extractMetadata / extractCookieDict / fetchNfToken
  convert.ts         pipeline convert + aturan buang
  generate.ts        generate token + random by negara + cooldown
  validate.ts        auto-validasi cron
  gate.ts            verifikasi join channel
  menu.ts            keyboard menu & menu negara
  handlers/          message.ts, callback.ts
  kv.ts, bot.ts, telegram.ts, vault.ts, broadcast.ts, donation.ts, stats.ts
```

## Lisensi

Lihat `LICENSE`.
