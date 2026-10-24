import type { Bot } from './bot';
import type { VaultStats } from './vaultstore';

/**
 * Cache rekap vault di KV.
 *
 * `statsSnapshot()` memindai SELURUH tabel. Pada 5000 akun itu ~5000 baris
 * terbaca, dan free plan D1 hanya memberi 5 juta baris/hari. Kalau halaman
 * /admin memanggilnya setiap 5 detik, kuota habis dalam hitungan jam.
 *
 * Karena itu rekap dihitung paling sering sekali per `STATS_TTL_MS`, lalu
 * disajikan dari KV. Pemanggil bisa memaksa hitung ulang dengan `fresh`.
 */
export const STATS_KEY = 'vault_stats';
export const STATS_TTL_MS = 10 * 60 * 1000;

/**
 * Umur maksimum rekap yang boleh dipakai menu negara.
 *
 * Menu negara dibuka jauh lebih sering daripada halaman /admin, jadi menu
 * TIDAK boleh memicu pemindaian tabel D1 tiap kali dibuka. Dengan batas 6 jam:
 * selama cache masih ada (umur berapa pun sampai 6 jam) menu memakainya tanpa
 * menyentuh D1 sama sekali; hanya kalau cache kosong/hilang rekap dihitung
 * sekali. Halaman Vault & /admin tetap menyegarkan cache tiap <=10 menit, jadi
 * dalam praktiknya angka yang tampil selalu segar.
 */
export const STATS_MENU_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * `byCountry[]` -> `{ kode: jumlah }` untuk label tombol menu.
 * Bucket `??` (baris tanpa kode negara) dibuang karena tidak punya tombol.
 */
export function countMap(stats: VaultStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of stats.byCountry) {
    if (!row.country || row.country === '??') continue;
    out[row.country] = row.count;
  }
  return out;
}

export interface CachedStats extends VaultStats {
  /** Kapan rekap ini dihitung (epoch ms). */
  at: number;
  /** `true` bila diambil dari cache, bukan dihitung ulang. */
  cached: boolean;
}

interface StoredStats extends VaultStats {
  at: number;
}

export async function readStats(bot: Bot, opts: { fresh?: boolean; maxAgeMs?: number } = {}): Promise<CachedStats> {
  const maxAgeMs = opts.maxAgeMs ?? STATS_TTL_MS;
  const now = Date.now();

  if (!opts.fresh) {
    let cached: StoredStats | null = null;
    try {
      cached = await bot.kv.getJson<StoredStats>(STATS_KEY);
    } catch {
      cached = null;
    }
    if (cached && typeof cached.at === 'number' && now - cached.at < maxAgeMs && cached.counts) {
      return { ...cached, cached: true };
    }
  }

  const snapshot = await bot.vault.statsSnapshot();
  const stored: StoredStats = { ...snapshot, at: now };
  try {
    await bot.kv.put(STATS_KEY, stored);
  } catch {
    // Gagal menulis cache bukan masalah: hasilnya tetap dikembalikan.
  }
  return { ...stored, cached: false };
}

/** Paksa hitung ulang (dipakai setelah import / validasi manual). */
export function refreshStats(bot: Bot): Promise<CachedStats> {
  return readStats(bot, { fresh: true });
}
