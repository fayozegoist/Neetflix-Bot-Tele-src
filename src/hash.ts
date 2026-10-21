/**
 * Hash NetflixId untuk dedupe di Vault.
 *
 * Dipakai sebagai kolom `cookie_hash` ber-UNIQUE, jadi mengirim ulang file yang
 * sama tidak menggandakan akun (dan tidak membuang kuota validasi dua kali).
 * 128 bit pertama SHA-256 sudah lebih dari cukup: peluang tabrakan pada
 * puluhan ribu akun praktis nol.
 */
export async function cookieHash(netflixId: string): Promise<string> {
  const data = new TextEncoder().encode(netflixId);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < 16; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
