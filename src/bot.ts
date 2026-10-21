import type { Config } from './types';
import type { KVStore } from './kv';
import type { VaultStore } from './vaultstore';
import type { SendOptions, TgResult } from './telegram';
import { sendMessage, tg } from './telegram';

export class Bot {
  constructor(
    readonly cfg: Config,
    readonly kv: KVStore,
    readonly vault: VaultStore
  ) {}

  send(chatId: number, text: string, options?: SendOptions): Promise<TgResult> {
    return sendMessage(this.cfg, chatId, text, options);
  }

  api<T = unknown>(method: string, payload: Record<string, unknown>): Promise<TgResult<T>> {
    return tg(this.cfg, method, payload) as Promise<TgResult<T>>;
  }

  isAdmin(userId: number): boolean {
    return userId === this.cfg.ADMIN_ID;
  }
}