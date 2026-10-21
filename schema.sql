-- Vault MEDIAFAIRY di D1 (SQLite).
--
-- Menggantikan satu key KV "global_vault" yang berisi array seluruh akun.
-- Pada 5000 akun, membaca + JSON.parse + stringify blob itu memakan ~15 ms CPU
-- (terukur), sedangkan free plan hanya memberi 10 ms per invocation -> Error
-- 1102. Dengan D1, generate hanya menyentuh beberapa baris via index.
--
-- Terapkan dengan:
--   npx wrangler d1 execute neetflix-vault --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS vault (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- SHA-256 dari NetflixId (128 bit pertama). UNIQUE -> upload ulang file yang
  -- sama tidak menggandakan akun.
  cookie_hash  TEXT    NOT NULL,
  raw_text     TEXT    NOT NULL,
  email        TEXT,
  region       TEXT,
  country      TEXT,
  plan         TEXT,
  member_since TEXT,
  next_billing TEXT,
  -- pending : sudah masuk tapi BELUM lolos validasi (tidak dilayani generate)
  -- active  : terverifikasi hidup & billing aman (dilayani generate)
  -- dead    : terbukti mati / billing lewat (disimpan sebentar untuk laporan)
  status       TEXT    NOT NULL DEFAULT 'pending',
  reason       TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  checked_at   INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_cookie ON vault(cookie_hash);
-- (status, country, id): dipakai pickRandom dengan "titik awal acak" — id ikut
-- di dalam index supaya ORDER BY id bisa langsung dilayani index (tanpa baca
-- seluruh negara). Sebelumnya tanpa `id`, ORDER BY RANDOM() membaca ~9000 baris.
DROP INDEX IF EXISTS idx_vault_pick;
CREATE INDEX IF NOT EXISTS idx_vault_pick  ON vault(status, country, id);
CREATE INDEX IF NOT EXISTS idx_vault_queue ON vault(status, id);
CREATE INDEX IF NOT EXISTS idx_vault_sweep ON vault(status, checked_at);
