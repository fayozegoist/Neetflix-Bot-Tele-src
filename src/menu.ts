import type { ReplyMarkup } from './telegram';

export function mainMenu(isAdmin: boolean): ReplyMarkup {
  const menuKeyboard: Array<Array<{ text: string }>> = [
    [{ text: '🔑 Generate Token' }, { text: '🎲 Generate Random' }],
    [{ text: '📁 Vault Tersimpan' }, { text: '📊 Cek Limit' }],
    [{ text: '💳 Donasi' }],
  ];
  if (isAdmin) menuKeyboard.push([{ text: '🔄 Convert Netscape' }, { text: '⚙️ Panel Admin' }]);
  return { keyboard: menuKeyboard, resize_keyboard: true };
}

export function regionMarkup(): ReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: '🌏 SEA (Asia Tenggara)', callback_data: 'random_sea' }],
      [
        { text: '🌍 Asia', callback_data: 'random_asia' },
        { text: '🌍 Europe', callback_data: 'random_europe' },
      ],
      [
        { text: '🌎 America', callback_data: 'random_america' },
        { text: '🎲 Global (Acak Semua)', callback_data: 'random_global' },
      ],
    ],
  };
}