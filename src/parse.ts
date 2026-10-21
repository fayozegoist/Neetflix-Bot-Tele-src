/**
 * Pemecah teks multi-akun menjadi chunks per akun.
 *
 * Dua format yang didukung:
 *  A) Netscape cookie   -> "– Email: ..." + baris ".netflix.com ... NetflixId ..."
 *  B) File "Every day!" -> blok "🎯 HIT #N" + "• Email: ..." + "• Cookie: NetflixId=..."
 *
 * Aturan:
 *  - Setiap baris "Email:" memulai akun baru.
 *  - Teks SEBELUM baris email di dalam sebuah blok:
 *      * bila memuat sinyal trailer (baris cookie / nftoken) -> milik akun SEBELUMNYA
 *      * selain itu                                     -> header akun ini
 *  - Baris separator (═══ / ───) menjadi batas blok tersendiri.
 */

const EMAIL_LINE = /(^|\s)Email\s*:/i;

/** Isyarat konten nyambung ke akun sebelumnya (bukan header akun berikutnya). */
const TRAILER_SIGNALS = /nftoken=|NetflixId=|\.netflix\.com[\s\t]/i;

export function splitAccounts(text: string): string[] {
  let normalized = String(text).replace(/\r\n/g, '\n');
  // baris separator (═══ / ─── / ===) = batas blok tersendiri
  normalized = normalized.replace(/\n(?=[═─━═]{4,})/g, '\n\n');

  const blocks = normalized.split(/\n[ \t]*\n+/);

  const chunks: string[] = [];
  // `as` dipakai agar TS tidak men-narrow array kosong menjadi never[].
  let pendingHeader: string[] = [] as string[];
  let current: string | null = null as string | null;

  const commit = (chunkText: string): void => {
    if (current !== null) chunks.push(current);
    current = chunkText;
  };

  for (const raw of blocks) {
    const block = raw.replace(/^\n+|\n+$/g, '');
    if (!block.trim()) continue;

    const lines = block.split('\n');
    const idxs: number[] = [] as number[];
    for (let i = 0; i < lines.length; i++) {
      if (EMAIL_LINE.test(lines[i])) idxs.push(i);
    }

    if (idxs.length === 0) {
      // blok tanpa "Email:"
      if (current !== null && TRAILER_SIGNALS.test(block)) {
        current += '\n\n' + block; // trailer akun sebelumnya
      } else {
        pendingHeader.push(block); // header akun berikutnya
      }
      continue;
    }

    // baris sebelum email pertama: trailer akun sebelumnya, atau header akun ini
    const preamble = lines.slice(0, idxs[0]).join('\n');
    if (preamble.trim()) {
      if (current !== null && TRAILER_SIGNALS.test(preamble)) current += '\n' + preamble;
      else pendingHeader.push(preamble);
    }

    for (let k = 0; k < idxs.length; k++) {
      const start = idxs[k];
      const end = k + 1 < idxs.length ? idxs[k + 1] : lines.length;
      const seg = lines.slice(start, end).join('\n');
      const header = pendingHeader.join('\n\n');
      pendingHeader.length = 0;
      commit(header ? header + '\n' + seg : seg);
    }
  }

  if (current !== null) chunks.push(current);
  if (pendingHeader.length) {
    const tail = pendingHeader.join('\n\n');
    if (chunks.length) chunks[chunks.length - 1] += '\n\n' + tail;
    else chunks.push(tail);
  }

  return chunks.filter((c) => c.trim().length > 0);
}
