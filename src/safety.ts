/**
 * Pembaca "kesehatan" akun Netflix dari halaman /account/membership.
 *
 * Halaman itu memuat blok JSON `growthAccount` yang berisi status penahanan
 * pembayaran (`growthHoldMetadata.isUserOnHold`) plus banyak detail akun yang
 * jauh lebih akurat daripada teks berkas yang diunggah (plan, negara, tanggal
 * tagihan, metode bayar, jumlah profil).
 *
 * Biaya: satu request + satu `indexOf` lalu seluruh pembacaan dilakukan pada
 * potongan kecil (~16 KB), jadi CPU-nya tetap di bawah 1 ms — penting karena
 * free plan hanya memberi 10 ms per eksekusi.
 *
 * ATURAN UTAMA: hasil apa pun selain HTTP 200 yang memuat penanda hold
 * dikembalikan sebagai `null` ("tidak tahu"). Pemanggil TIDAK BOLEH menghapus
 * akun berdasarkan `null`; gangguan jaringan tidak boleh dianggap bukti.
 */

const ACCOUNT_URL = 'https://www.netflix.com/account/membership';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;
/** Cukup untuk menampung seluruh blok growthAccount (~8-12 KB). */
const BLOCK_CHARS = 16000;

export interface AccountSnapshot {
  /** true = ditahan karena pembayaran (tidak bisa dipakai). */
  onHold: boolean;
  /** Alasan penahanan dari Netflix, mis. SERVICE_END_PAYMENT_FAILURE. */
  holdReason: string | null;
  /** Email pemilik akun apa adanya (belum disamarkan). */
  email: string | null;
  emailVerified: boolean | null;
  plan: string | null;
  /** Kode ISO2 negara pendaftaran akun. */
  country: string | null;
  nextBilling: string | null;
  memberSince: string | null;
  /** Metode bayar siap tampil, mis. "VISA •••• 1639" atau "Airtel". */
  paymentMethod: string | null;
  /** Nomor HP yang SUDAH disamarkan (mis. +91951014xxxx). */
  phone: string | null;
  profileCount: number | null;
}

/** Ambil nilai `"value":"..."` pertama di dalam potongan. */
function grab(seg: string, re: RegExp): string | null {
  const m = seg.match(re);
  return m && m[1] ? m[1] : null;
}

function grabBool(seg: string, re: RegExp): boolean | null {
  const m = seg.match(re);
  return m ? m[1] === 'true' : null;
}

/** Potongan sepanjang `len` mulai dari kemunculan pertama `key`. */
function windowAfter(seg: string, key: string, len: number): string | null {
  const i = seg.indexOf(key);
  return i < 0 ? null : seg.slice(i, i + len);
}

/**
 * Netflix kadang mengirim spasi sebagai escape `\x20` / NBSP. Diseragamkan
 * supaya tanggal tidak tampil aneh.
 */
export function normalizeText(value: string): string {
  return value.replace(/\\x20/g, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Samarkan nomor HP: 4 digit terakhir jadi `x`, sisanya utuh (termasuk `+`).
 * `+919510147382` -> `+91951014xxxx`; nomor <=4 digit -> `xxxx`.
 */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digitsOnly = value.replace(/\D/g, '');
  if (digitsOnly.length <= 4) return 'xxxx';
  let left = 4;
  let out = value;
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    const ch = out[i];
    if (ch >= '0' && ch <= '9') {
      out = out.slice(0, i) + 'x' + out.slice(i + 1);
      left--;
    }
  }
  return out;
}

/** Epoch ISO dari Netflix -> "Agustus 2026" (locale Indonesia). */
export function formatMonthYear(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s && s !== 'Invalid Date' ? s : null;
}

/** Metode bayar siap tampil dari blok `growthPaymentMethods`. */
export function parsePaymentMethod(seg: string): string | null {
  const win = windowAfter(seg, 'growthPaymentMethods":', 420);
  if (!win) return null;
  if (/^\s*\[\s*\]/.test(win)) return null; // tidak ada metode bayar
  const display = grab(win, /"displayText":"([^"]+)"/);
  const logo = grab(win, /"paymentOptionLogo":\{[^}]*"paymentOptionLogo":"([^"]+)"/);
  if (logo && display) {
    return /^\d+$/.test(display) ? `${logo} •••• ${display}` : `${logo} ${display}`;
  }
  return display ? normalizeText(display) : null;
}

/**
 * Baca detail akun dari HTML halaman /account/membership.
 * `null` = tidak tahu (halaman login, blok tidak ada, atau penanda hold hilang).
 */
export function parseAccountPage(body: string): AccountSnapshot | null {
  const at = body.indexOf('growthAccount');
  if (at < 0) return null;
  const seg = body.slice(at, at + BLOCK_CHARS);

  const holdWin = windowAfter(seg, 'growthHoldMetadata', 300);
  if (!holdWin) return null;
  const holdFlag = grabBool(holdWin, /"isUserOnHold":(true|false)/);
  if (holdFlag === null) return null; // tanpa penanda -> jangan ambil kesimpulan

  const emailWin = windowAfter(seg, 'growthEmail', 260);
  const email = emailWin ? grab(emailWin, /"email":\{[^}]*"value":"([^"]+)"/) : null;
  const emailVerified = emailWin ? grabBool(emailWin, /"isVerified":(true|false)/) : null;

  const planWin = windowAfter(seg, 'currentPlan', 420);
  const plan = planWin ? grab(planWin, /"localizedPlanName":\{[^}]*"value":"([^"]+)"/) : null;

  const country = grab(seg, /"countryOfSignUp":\{[^}]*"code":"([A-Z]{2})"/);

  const memberIso = grab(seg, /"memberSince":"(\d{4}-\d{2}-\d{2}T[^"]+)"/);
  const memberSince = memberIso ? formatMonthYear(memberIso) : null;

  const phoneRaw = grab(
    seg,
    /"growthLocalizablePhoneNumber":\{.{0,400}?"phoneNumberDigits":\{[^}]*"value":"([^"]*)"/
  );

  let profileCount: number | null = null;
  const profAt = seg.indexOf('"profiles":[');
  if (profAt >= 0) {
    const end = seg.indexOf(']', profAt);
    if (end > profAt) profileCount = (seg.slice(profAt, end).match(/"__ref":"Profile:/g) || []).length;
  }

  // `nextBillingDate` di blok growthAccount selalu null; nilai aslinya ada di
  // blok tengah halaman. Satu indexOf pada seluruh body masih jauh di bawah
  // anggaran CPU.
  let nextBilling: string | null = null;
  const nbAt = body.indexOf('"nextBillingDate":{"fieldType":"String"');
  if (nbAt >= 0) {
    const v = grab(body.slice(nbAt, nbAt + 200), /"value":"([^"]+)"/);
    if (v) nextBilling = normalizeText(v);
  }

  return {
    onHold: holdFlag,
    holdReason: grab(holdWin, /"serviceEndReason":"([A-Z_]+)"/),
    email: email ? normalizeText(email) : null,
    emailVerified,
    plan: plan ? normalizeText(plan) : null,
    country,
    nextBilling,
    memberSince,
    paymentMethod: parsePaymentMethod(seg),
    phone: maskPhone(phoneRaw),
    profileCount,
  };
}

/**
 * Ambil snapshot akun. `null` = tidak tahu (jaringan/halaman tidak sesuai) dan
 * pemanggil harus memperlakukan akun sebagai tetap layak.
 */
export async function fetchAccountSnapshot(netflixId: string): Promise<AccountSnapshot | null> {
  try {
    const res = await fetch(ACCOUNT_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: `NetflixId=${netflixId}`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res || res.status !== 200) return null;
    if (typeof res.text !== 'function') return null;
    return parseAccountPage(await res.text());
  } catch {
    return null;
  }
}
