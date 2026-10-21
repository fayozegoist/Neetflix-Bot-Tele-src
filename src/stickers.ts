import type { Bot } from './bot';

/** Cache daftar stiker di KV: 7 hari. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StickerCache {
  ids: string[];
  at: number;
}

interface TgSticker {
  file_id?: string;
}

interface TgStickerSet {
  name?: string;
  stickers?: TgSticker[];
}

/**
 * Ambil daftar `file_id` stiker loading dari set `LOADING_STICKERS`.
 *
 * Hasilnya di-cache di KV karena tiap panggilan `getStickerSet` memakan satu
 * dari jatah 50 subrequest per eksekusi (free plan).
 *
 * Tidak pernah melempar error: kegagalan apa pun hanya menghasilkan daftar
 * kosong, sehingga fitur generate tetap jalan tanpa stiker.
 */
export async function getStickerIds(bot: Bot): Promise<string[]> {
  const setName = bot.cfg.LOADING_STICKERS;
  if (!setName) return [];
  const cacheKey = `stickers_${setName}`;

  let cached: StickerCache | null = null;
  try {
    cached = await bot.kv.getJson<StickerCache>(cacheKey);
  } catch {
    cached = null;
  }

  const ids = cached && Array.isArray(cached.ids) ? cached.ids.filter(Boolean) : [];
  if (ids.length > 0 && Date.now() - (cached?.at || 0) < CACHE_TTL_MS) return ids;

  try {
    const res = await bot.api<TgStickerSet>('getStickerSet', { name: setName });
    const fresh = (res.result?.stickers || []).map((s) => s.file_id || '').filter(Boolean);
    if (fresh.length > 0) {
      await bot.kv.put(cacheKey, { ids: fresh, at: Date.now() });
      return fresh;
    }
  } catch {
    // abaikan — pakai cache basi bila ada
  }

  // Cache basi (atau kosong) sebagai upaya terakhir.
  return ids;
}

/** Pilih satu `file_id` stiker acak. `null` bila tidak ada yang tersedia. */
export async function randomStickerId(bot: Bot): Promise<string | null> {
  const ids = await getStickerIds(bot);
  if (ids.length === 0) return null;
  return ids[Math.floor(Math.random() * ids.length)];
}
