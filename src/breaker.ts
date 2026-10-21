import type { Bot } from './bot';

/**
 * Circuit breaker untuk validasi massal.
 *
 * Tujuan: bila Netflix mulai membalas rate-limit / error server, validasi
 * BERHENTI dulu — supaya akun sehat tidak ikut terhapus karena kesalahan yang
 * sebenarnya hanya sementara.
 */
export interface BreakerState {
  /** Jumlah akun divalidasi per run (naik otomatis kalau aman). */
  perRun: number;
  /** Hasil pasti (hidup/mati) berturut-turut tanpa satu pun ambigu. */
  okStreak: number;
  /** Kegagalan ambigu berturut-turut. */
  ambiguousStreak: number;
  /** Validasi dijeda sampai timestamp ini. */
  pausedUntil?: number;
  /** Berhenti total, hanya bisa dilanjutkan manual oleh admin. */
  hardPaused?: boolean;
  /** Waktu-waktu trip dalam 1 jam terakhir. */
  trips?: number[];
  /** Sudah pernah memberi tahu admin soal hard-pause. */
  notifiedHardPause?: boolean;
  /** Terakhir kali admin menekan Resume. */
  resumedAt?: number;
}

export const BREAKER_KEY = 'validate_state';
export const START_PER_RUN = 12;
export const MIN_PER_RUN = 4;
export const MAX_PER_RUN = 25;
export const AMBIGUOUS_TRIP = 5;
export const OK_STREAK_TO_RAMP = 100;
export const RAMP_STEP = 4;
export const PAUSE_MS = 30 * 60 * 1000;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

export async function loadBreaker(bot: Bot): Promise<BreakerState> {
  let raw: BreakerState | null = null;
  try {
    raw = await bot.kv.getJson<BreakerState>(BREAKER_KEY);
  } catch {
    raw = null;
  }
  const st = raw || ({} as BreakerState);
  return {
    perRun: clamp(Number(st.perRun) || START_PER_RUN, MIN_PER_RUN, MAX_PER_RUN),
    okStreak: Number(st.okStreak) || 0,
    ambiguousStreak: Number(st.ambiguousStreak) || 0,
    pausedUntil: st.pausedUntil,
    hardPaused: !!st.hardPaused,
    trips: Array.isArray(st.trips) ? st.trips.slice(-9) : [],
    notifiedHardPause: !!st.notifiedHardPause,
  };
}

export async function saveBreaker(bot: Bot, st: BreakerState): Promise<void> {
  await bot.kv.put(BREAKER_KEY, st);
}

export interface BreakerDecision {
  run: boolean;
  reason: 'ok' | 'paused' | 'hard-paused';
  perRun: number;
}

export function decide(state: BreakerState, now = Date.now()): BreakerDecision {
  if (state.hardPaused) return { run: false, reason: 'hard-paused', perRun: 0 };
  if (state.pausedUntil && now < state.pausedUntil) return { run: false, reason: 'paused', perRun: 0 };
  return { run: true, reason: 'ok', perRun: state.perRun };
}

export interface BatchOutcome {
  /** Akun yang terbukti mati / billing lewat. */
  dead: number;
  /** Akun yang terbukti hidup. */
  alive: number;
  /** Kegagalan ambigu (rate-limit, 5xx, timeout). */
  ambiguous: number;
}

export type BreakerAction = 'none' | 'ramp' | 'pause' | 'hard-pause';

/**
 * Hitung state berikutnya setelah satu batch validasi.
 *
 * - `ambiguous >= AMBIGUOUS_TRIP` -> jeda 30 menit + laju dipotong separuh.
 * - 3 trip dalam 1 jam -> berhenti total (butuh resume manual).
 * - 100 hasil pasti berturut-turut -> laju naik bertahap sampai MAX_PER_RUN.
 */
export function nextBreakerState(
  state: BreakerState,
  o: BatchOutcome,
  now = Date.now()
): { state: BreakerState; action: BreakerAction } {
  const next: BreakerState = { ...state };
  const conclusive = o.dead + o.alive;

  if (o.ambiguous > 0) {
    next.ambiguousStreak = (next.ambiguousStreak || 0) + o.ambiguous;
    next.okStreak = 0;
  } else {
    next.ambiguousStreak = 0;
    next.okStreak = (next.okStreak || 0) + conclusive;
  }

  if ((next.ambiguousStreak || 0) >= AMBIGUOUS_TRIP) {
    const trips = (next.trips || []).filter((t) => now - t < 60 * 60 * 1000);
    trips.push(now);
    next.trips = trips;
    next.ambiguousStreak = 0;

    if (trips.length >= 3) {
      next.hardPaused = true;
      return { state: next, action: 'hard-pause' };
    }
    next.perRun = clamp(Math.floor((next.perRun || START_PER_RUN) / 2), MIN_PER_RUN, MAX_PER_RUN);
    next.pausedUntil = now + PAUSE_MS;
    return { state: next, action: 'pause' };
  }

  if (!next.ambiguousStreak && (next.okStreak || 0) >= OK_STREAK_TO_RAMP && (next.perRun || 0) < MAX_PER_RUN) {
    next.okStreak = 0;
    next.perRun = clamp((next.perRun || START_PER_RUN) + RAMP_STEP, MIN_PER_RUN, MAX_PER_RUN);
    return { state: next, action: 'ramp' };
  }

  return { state: next, action: 'none' };
}

/** Lepas circuit breaker atas permintaan admin (tombol Resume di /admin). */
export function resume(state: BreakerState, now = Date.now()): BreakerState {
  return {
    ...state,
    hardPaused: false,
    pausedUntil: undefined,
    trips: [],
    ambiguousStreak: 0,
    okStreak: 0,
    perRun: Math.max(MIN_PER_RUN, Math.min(state.perRun || START_PER_RUN, MAX_PER_RUN)),
    notifiedHardPause: false,
    resumedAt: now,
  };
}
