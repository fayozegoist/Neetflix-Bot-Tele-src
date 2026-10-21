import type { Bot } from './bot';
import type { VaultEntry } from './types';
import type { InlineButton, ReplyMarkup } from './telegram';
import { escapeHtml } from './telegram';
import { flagEmoji } from './countries';
import { readStats } from './vaultstats';

const VAULT_PAGE_SIZE = 10;

/**
 * Kirim satu halaman daftar akun aktif di Vault.
 *
 * Hanya membaca 10 baris dari D1, jadi tetap murah walau Vault berisi ribuan
 * akun (dulu ini membaca + JSON.parse seluruh vault).
 */
export async function sendVaultPage(
  bot: Bot,
  targetId: number,
  page: number,
  messageId?: number
): Promise<void> {
  // Total diambil dari rekap ter-cache (murah). Menghitungnya langsung dari D1
  // akan memindai seluruh tabel setiap kali halaman dibuka.
  const stats = await readStats(bot);
  const total = stats.counts.active;

  if (total === 0) {
    await bot.api('sendMessage', {
      chat_id: targetId,
      text: '📁 <b>Vault Kosong</b>\nSaat ini belum ada akun yang tersedia di dalam Vault Global.',
      parse_mode: 'HTML',
    });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / VAULT_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const result = await bot.vault.listActivePage(safePage * VAULT_PAGE_SIZE, VAULT_PAGE_SIZE);

  let msg =
    `📁 <b>Data Cookie Global Tersimpan:</b>\n` +
    `<i>Halaman ${safePage + 1} dari ${totalPages} (Total: ${total} Akun)</i>\n\n`;

  result.entries.forEach((v: VaultEntry) => {
    const region = v.region || 'Tidak diketahui';
    const plan = v.plan || 'Tidak diketahui';
    const memberSince = v.memberSince || 'Tidak diketahui';
    const nextBilling = v.nextBilling || 'Tidak diketahui';
    const flag = v.country ? `${flagEmoji(v.country)} ` : '';
    msg +=
      `<b>ID:</b> <code>${v.id}</code>\n` +
      `📧 <code>${escapeHtml(v.email)}</code>\n` +
      `${flag}🌍 Region: ${escapeHtml(region)} | 💎 Plan: ${escapeHtml(plan)}\n` +
      `🗓 Member: ${escapeHtml(memberSince)} | ⏳ Next Bill: ${escapeHtml(nextBilling)}\n\n`;
  });

  const buttons: InlineButton[] = [];
  if (safePage > 0) buttons.push({ text: '⬅️ Back', callback_data: `vault_${safePage - 1}` });
  if (safePage < totalPages - 1) buttons.push({ text: 'Next ➡️', callback_data: `vault_${safePage + 1}` });
  const payload: Record<string, unknown> = {
    chat_id: targetId,
    text: msg,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (buttons.length > 0) payload.reply_markup = { inline_keyboard: [buttons] } satisfies ReplyMarkup;

  if (messageId) {
    payload.message_id = messageId;
    await bot.api('editMessageText', payload);
  } else {
    await bot.api('sendMessage', payload);
  }
}
