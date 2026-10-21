import type { Bot } from './bot';
import type { VaultEntry } from './types';
import type { InlineButton, ReplyMarkup } from './telegram';
import { escapeHtml } from './telegram';
import { flagEmoji } from './countries';

const VAULT_PAGE_SIZE = 10;

export async function sendVaultPage(
  bot: Bot,
  targetId: number,
  vault: VaultEntry[],
  page: number,
  messageId?: number
): Promise<void> {
  const totalPages = Math.ceil(vault.length / VAULT_PAGE_SIZE) || 1;
  page = Math.max(0, Math.min(page, totalPages - 1));

  if (vault.length === 0) {
    await bot.api('sendMessage', {
      chat_id: targetId,
      text: '📁 <b>Vault Kosong</b>\nSaat ini belum ada akun yang tersedia di dalam Vault Global.',
      parse_mode: 'HTML',
    });
    return;
  }

  const startIndex = page * VAULT_PAGE_SIZE;
  const pageData = vault.slice(startIndex, startIndex + VAULT_PAGE_SIZE);

  let msg = `📁 <b>Data Cookie Global Tersimpan:</b>\n<i>Halaman ${page + 1} dari ${totalPages} (Total: ${vault.length} Akun)</i>\n\n`;
  pageData.forEach((v) => {
    const region = v.region || 'Tidak diketahui';
    const plan = v.plan || 'Tidak diketahui';
    const memberSince = v.memberSince || 'Tidak diketahui';
    const nextBilling = v.nextBilling || 'Tidak diketahui';
    const flag = v.country ? `${flagEmoji(v.country)} ` : '';
    msg += `<b>ID:</b> <code>${v.id}</code>\n📧 <code>${escapeHtml(v.email)}</code>\n${flag}🌍 Region: ${escapeHtml(region)} | 💎 Plan: ${escapeHtml(plan)}\n🗓 Member: ${escapeHtml(memberSince)} | ⏳ Next Bill: ${escapeHtml(nextBilling)}\n\n`;
  });

  const buttons: InlineButton[] = [];
  if (page > 0) buttons.push({ text: '⬅️ Back', callback_data: `vault_${page - 1}` });
  if (page < totalPages - 1) buttons.push({ text: 'Next ➡️', callback_data: `vault_${page + 1}` });

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