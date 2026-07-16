/**
 * 通知の重複処理を防ぐためのローカル永続ストア
 *
 * 単一GCE上の単一botコンテナでの利用を前提とする。
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export type IdempotencyState = 'processing' | 'completed';

interface IdempotencyEntry {
  key: string;
  state: IdempotencyState;
  claimId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface IdempotencyFile {
  version: 1;
  entries: IdempotencyEntry[];
}

export type IdempotencyBeginResult =
  | { state: 'new'; entry: IdempotencyEntry; claimId: string }
  | { state: 'processing' | 'completed'; entry: IdempotencyEntry };

export type ClaimMutationResult =
  | { state: 'updated' }
  | { state: 'missing' }
  | { state: 'ownership_lost' };

export class IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly completedTtlMs: number,
    private readonly processingTtlMs: number,
    private readonly now: () => number = Date.now
  ) {
    this.load();
  }

  async begin(key: string): Promise<IdempotencyBeginResult> {
    this.pruneExpired();

    const existing = this.entries.get(key);
    if (existing) {
      return { state: existing.state, entry: { ...existing } };
    }

    const claimId = randomUUID();
    const now = new Date(this.now()).toISOString();
    const entry: IdempotencyEntry = {
      key,
      state: 'processing',
      claimId,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(key, entry);
    try {
      await this.enqueuePersist();
    } catch (error) {
      this.entries.delete(key);
      throw new Error('Idempotencyストアへの保存に失敗しました。', {
        cause: error,
      });
    }

    return { state: 'new', entry: { ...entry }, claimId };
  }

  async complete(key: string, claimId: string): Promise<ClaimMutationResult> {
    const entry = this.entries.get(key);
    if (!entry) {
      return { state: 'missing' };
    }
    if (entry.claimId !== claimId) {
      return { state: 'ownership_lost' };
    }

    const now = new Date(this.now()).toISOString();
    entry.state = 'completed';
    entry.updatedAt = now;
    entry.completedAt = now;
    await this.enqueuePersist();
    return { state: 'updated' };
  }

  async release(key: string, claimId: string): Promise<ClaimMutationResult> {
    const entry = this.entries.get(key);
    if (!entry) {
      return { state: 'missing' };
    }
    if (entry.claimId !== claimId) {
      return { state: 'ownership_lost' };
    }

    this.entries.delete(key);
    await this.enqueuePersist();
    return { state: 'updated' };
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<IdempotencyFile>;

      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        console.warn(
          JSON.stringify({
            event: 'idempotency_store_ignored',
            reason: 'invalid_file_format',
            filePath: this.filePath,
          })
        );
        return;
      }

      for (const entry of parsed.entries) {
        if (!this.isValidEntry(entry)) continue;
        this.entries.set(entry.key, entry);
      }
      this.pruneExpired();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'idempotency_store_load_failed',
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  private isValidEntry(entry: unknown): entry is IdempotencyEntry {
    if (!entry || typeof entry !== 'object') return false;

    const candidate = entry as Partial<IdempotencyEntry>;
    return (
      typeof candidate.key === 'string' &&
      candidate.key.length > 0 &&
      (candidate.state === 'processing' || candidate.state === 'completed') &&
      (candidate.claimId === undefined ||
        (typeof candidate.claimId === 'string' &&
          candidate.claimId.length > 0)) &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string'
    );
  }

  private pruneExpired(): void {
    const now = this.now();
    let removed = false;

    for (const [key, entry] of this.entries) {
      const updatedAt = Date.parse(entry.updatedAt);
      const ttlMs =
        entry.state === 'completed'
          ? this.completedTtlMs
          : this.processingTtlMs;

      if (Number.isNaN(updatedAt) || now - updatedAt >= ttlMs) {
        this.entries.delete(key);
        removed = true;
      }
    }

    if (removed) {
      void this.enqueuePersist().catch((error) => {
        console.error(
          JSON.stringify({
            event: 'idempotency_store_prune_failed',
            filePath: this.filePath,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      });
    }
  }

  private enqueuePersist(): Promise<void> {
    const persistTask = this.writeQueue
      .catch(() => undefined)
      .then(() => this.persist());
    this.writeQueue = persistTask;
    return persistTask;
  }

  private async persist(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });

    const file: IdempotencyFile = {
      version: 1,
      entries: [...this.entries.values()],
    };
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;

    await writeFile(
      temporaryPath,
      `${JSON.stringify(file, null, 2)}\n`,
      'utf8'
    );
    await rename(temporaryPath, this.filePath);
  }
}
