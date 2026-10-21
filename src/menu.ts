import type { ReplyMarkup } from './telegram';
import type { InlineButton } from './telegram';
import { COUNTRY_CODES, COUNTRY_NAMES, flagEmoji } from './countries';

export const COUNTRY_PAGE_SIZE = 20;

export function mainMenu(isAdmin: boolean): ReplyMarkup {
  const menuKeyboard: Array<Array<{ text: string }>> = [
    [{ text: '🔑 Generate Token' }, { text: '🎲 Generate Random' }],
    [{ text: '📁 Vault Tersimpan' }, { text: '📊 Cek Limit' }],
    [{ text: '💳 Donasi' }],
  ];
  if (isAdmin) menuKeyboard.push([{ text: '🔄 Convert Netscape' }, { text: '⚙️ Panel Admin' }]);
  return { keyboard: menuKeyboard, resize_keyboard: true };
}

/**
 * Menu tombol negara. 60 negara dibagi per halaman, 2 tombol per baris,
 * tiap tombol memakai emoji bendera + nama negara.
 */
export function countryMarkup(page: number): ReplyMarkup {
  const totalPages = Math.max(1, Math.ceil(COUNTRY_CODES.length / COUNTRY_PAGE_SIZE));
  const p = Math.max(0, Math.min(page, totalPages - 1));

  const slice = COUNTRY_CODES.slice(p * COUNTRY_PAGE_SIZE, (p + 1) * COUNTRY_PAGE_SIZE);

  const rows: InlineButton[][] = [];
  for (let i = 0; i < slice.length; i += 2) {
    const row: InlineButton[] = [];
    for (const code of slice.slice(i, i + 2)) {
      row.push({
        text: `${flagEmoji(code)} ${COUNTRY_NAMES[code]}`,
        callback_data: `rc_${code}`,
      });
    }
    rows.push(row);
  }

  const nav: InlineButton[] = [];
  if (p > 0) nav.push({ text: '⬅️ Back', callback_data: `rcpage_${p - 1}` });
  nav.push({ text: '🎲 Semua Negara', callback_data: 'rc_global' });
  if (p < totalPages - 1) nav.push({ text: 'Next ➡️', callback_data: `rcpage_${p + 1}` });
  rows.push(nav);

  return { inline_keyboard: rows };
}

export function countryPageCount(): number {
  return Math.max(1, Math.ceil(COUNTRY_CODES.length / COUNTRY_PAGE_SIZE));
}
