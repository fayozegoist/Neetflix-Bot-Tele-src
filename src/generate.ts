import type { Bot } from './bot';
import type { CountryFilter, VaultEntry } from './types';
import { adminContact, escapeHtml } from './telegram';
import { getStats, isUnlimited, remainingQuota } from './stats';
import { extractCookieDict, extractMetadata, fetchNfToken, maskEmail } from './netflix';
import { resolveCountry } from './countries';
import { startLoading } from './loading';
import type { Loading } from './loading';

const MAX_RANDOM_ATTEMPTS = 5;

/** Ambil kode negara dari entry vault (fallback ke resolusi region). */
export function entryCountry(v: VaultEntry): string | null {
  if (v.country) return v.country;
  return resolveCountry(v.region);
}

/** Filter vault berdasarkan kode negara. */
export function filterVaultByCountry(vault: VaultEntry[], country: CountryFilter | null): VaultEntry[] {
  if (!country || country === 'global') return vault;
  return vault.filter((v) => entryCountry(v) === country);
}

/**
 * Generate token dari Vault secara acak.
 *
 * Satu-satunya jalur generate: user menekan tombol menu -> memilih negara
 * (atau "Semua Negara") -> fungsi ini dipanggil dengan `countryFilter`.
 * Command `/gen` sudah dihapus, jadi tidak ada input cookie manual.
 */
export async function processGeneration(
  bot: Bot,
  chatId: number,
  userId: number,
  username: string,
  isAdmin: boolean,
  countryFilter: CountryFilter | null
): Promise<void> {
  const stats = await getStats(bot, userId);

  // --- Cooldown (admin bypass) ---
  if (!isAdmin && stats.lastGen) {
    const waitMs = bot.cfg.COOLDOWN_MS - (Date.now() - stats.lastGen);
    if (waitMs > 0) {
      const sec = Math.ceil(waitMs / 1000);
      const cooldownSec = Math.round(bot.cfg.COOLDOWN_MS / 1000);
      await bot.send(
        chatId,
        `⏳ <b>Mohon tunggu ${sec} detik</b> sebelum generate berikutnya.\nJeda antar generate: <b>${cooldownSec} detik</b>.`
      );
      return;
    }
  }

  // --- Limit kuota (dilewati bila unlimited) ---
  if (!isUnlimited(bot.cfg.FREE_DAILY_LIMIT) && remainingQuota(stats, bot.cfg.FREE_DAILY_LIMIT) <= 0) {
    await bot.send(
      chatId,
      `⛔ <b>Akses Ditolak: Limit Habis!</b>\nAnda telah menggunakan seluruh batas harian (${bot.cfg.FREE_DAILY_LIMIT}x).\n\nHubungi admin: ${adminContact(bot.cfg)}.`
    );
    return;
  }

  const countryLabel = countryFilter && countryFilter !== 'global' ? countryFilter.toUpperCase() : 'SEMUA NEGARA';
  const verifyMsg =
    `🔄 Memverifikasi${countryFilter ? ` dengan filter Negara: <b>${countryLabel}</b>` : ''}... mohon tunggu.`;

  // Stiker loading (hanya pada generate). Dinyalakan SETELAH cek stok lolos,
  // supaya balasan "Stock Habis" tetap instan tanpa jeda 10 detik.
  let loading: Loading | null = null;

  try {
    const vault = (await bot.kv.getVault()) || [];
    let nfToken: string | null = null;
    let expires: number | null = null;
    let meta: ReturnType<typeof extractMetadata> | null = null;

    const filteredVault = filterVaultByCountry(vault, countryFilter);

    // Cek stok DULUAN. Bila tidak ada akun, user tidak dihukum cooldown
    // karena memang tidak ada yang bisa dilayani.
    if (filteredVault.length === 0) {
      const scope = countryFilter && countryFilter !== 'global' ? countryFilter.toUpperCase() : 'SEMUA NEGARA';
      await bot.send(
        chatId,
        `⚠️ <b>Stock Habis!</b>\nTidak ditemukan akun yang sesuai dengan negara <b>${scope}</b> di Vault saat ini.\n\n` +
          `<i>Tidak ada cooldown yang terpakai — silakan coba negara lain.</i>`
      );
      return;
    }

    loading = await startLoading(bot, chatId);
    // Bila stiker gagal terkirim, pakai indikator teks seperti sebelumnya.
    if (!loading.shown) await bot.send(chatId, verifyMsg);

    let success = false;
    let accountsRemoved = 0;
    const deadIds = new Set<number>();

    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i++) {
      if (filteredVault.length === 0) break;

      const randomIdx = Math.floor(Math.random() * filteredVault.length);
      const candidate = filteredVault[randomIdx];
      const cookieDict = extractCookieDict(candidate.rawText);

      if (!cookieDict.NetflixId) {
        filteredVault.splice(randomIdx, 1);
        deadIds.add(candidate.id);
        accountsRemoved++;
        continue;
      }

      try {
        const tokenData = await fetchNfToken(cookieDict.NetflixId);
        nfToken = tokenData.token;
        expires = tokenData.expires;
        meta = extractMetadata(candidate.rawText);
        success = true;
        break;
      } catch {
        filteredVault.splice(randomIdx, 1);
        deadIds.add(candidate.id);
        accountsRemoved++;
      }
    }

    if (deadIds.size > 0) {
      await bot.kv.setVault(vault.filter((v) => !deadIds.has(v.id)));
    }

    if (!success) {
      if (loading) await loading.finish();
      await bot.send(
        chatId,
        `❌ <b>Semua Sampel Acak Mati!</b>\nSistem otomatis menguji dan <b>menghapus ${accountsRemoved} akun mati</b> dari sistem. Silakan coba lagi.\n\n` +
          `<i>Tidak ada cooldown yang terpakai.</i>`
      );
      return;
    }

    if (!nfToken || !expires || !meta) throw new Error('Gagal mengambil token.');

    // --- Cooldown HANYA dicatat setelah token benar-benar berhasil dibuat ---
    // Jadi gagal karena stok habis atau semua cookie mati TIDAK
    // menghabiskan jeda 1 menit user.
    if (!isAdmin) {
      stats.lastGen = Date.now();
      await bot.kv.setStats(userId, stats);
    }

    const loginBrowser = 'https://netflix.com/?nftoken=' + nfToken;
    const loginMobile = 'https://netflix.com/unsupported?nftoken=' + nfToken;
    const loginTv = 'https://netflix.com/tv2?nftoken=' + nfToken;
    const expDate = new Date(expires).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const maskedEmail = maskEmail(meta.email);
    const premiumOutput =
      `✅ <b>Token Netflix Berhasil Dibuat</b>\n\n` +
      `📧 <b>Email:</b> ${escapeHtml(maskedEmail)}\n` +
      `🌍 <b>Region:</b> ${escapeHtml(meta.region)}\n` +
      `💎 <b>Plan:</b> ${escapeHtml(meta.plan)}\n` +
      `🗓 <b>Member Since:</b> ${escapeHtml(meta.memberSince)}\n` +
      `⏳ <b>Next Billing:</b> ${escapeHtml(meta.nextBilling)}\n\n` +
      `💻 <b>Login Browser</b>\n<a href="${loginBrowser}">➡️ Klik disini</a>\n\n` +
      `📱 <b>Login Hp</b>\n<a href="${loginMobile}">➡️ Klik disini</a>\n\n` +
      `📺 <b>Login TV</b>\n<a href="${loginTv}">➡️ Klik disini</a>\n\n` +
      `⏳ <b>Expires:</b> <code>${expDate}</code>\n\n` +
      `<b>MEDIAFAIRY Netflix Token</b>`;

    // Stiker dihapus lebih dulu, baru token dikirim.
    if (loading) await loading.finish();
    await bot.send(chatId, premiumOutput);

    if (!isAdmin) {
      if (!isUnlimited(bot.cfg.FREE_DAILY_LIMIT)) {
        if (stats.used < bot.cfg.FREE_DAILY_LIMIT) stats.used += 1;
        else stats.extra = Math.max(0, (stats.extra || 0) - 1);
        await bot.kv.setStats(userId, stats);
      }

      if (bot.cfg.GROUP_ID) {
        try {
          const notifMsg =
            `<b>NETFLIX GENERATED</b>\n<pre><code class="language-txt">👤 User   : ${escapeHtml(username)}\n🆔 ID     : ${userId}\n📧 Email  : ${escapeHtml(maskedEmail)}\n🌍 Region : ${escapeHtml(meta.region)}\n💎 Plan   : ${escapeHtml(meta.plan)}</code></pre>`;
          await bot.api('sendMessage', { chat_id: bot.cfg.GROUP_ID, text: notifMsg, parse_mode: 'HTML' });
        } catch (e) {
          console.error('Gagal mengirim notif:', e);
        }
      }
    }
  } catch (e) {
    if (loading) await loading.finish();
    await bot.send(chatId, `❌ <b>Terjadi Kesalahan:</b>\n<code>${escapeHtml((e as Error).message)}</code>`);
  } finally {
    // Jaring pengaman untuk semua jalur `return` dini. Idempoten, jadi tidak
    // akan menghapus dua kali.
    if (loading) await loading.finish();
  }
}
