import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  unlink,
  stat,
  access,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { MarkdownPreviewConfig } from '../config/markdownPreview';

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface MarkdownSource {
  filename: string;
  postedAt: string;
  guildId: string;
  channelId: string;
  messageId: string;
  attachmentId: string;
}
export interface MarkdownRecord extends MarkdownSource {
  id: string;
  markdown: string;
  createdAt: number;
  expiresAt: number;
  replyId?: string;
}

/** 単一Botプロセス用。各ファイルは本文・メタデータをまとめて原子的に保存。 */
export class MarkdownPreviewStore {
  private readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private config: MarkdownPreviewConfig,
    private now = Date.now
  ) {
    this.directory = resolve(config.storePath);
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private path(id: string): string {
    if (!ID.test(id)) throw new Error('invalid_preview_id');
    return join(this.directory, `${id}.json`);
  }

  private async read(id: string): Promise<MarkdownRecord | undefined> {
    try {
      const record = JSON.parse(
        await readFile(this.path(id), 'utf8')
      ) as MarkdownRecord;
      if (
        record.id !== id ||
        typeof record.markdown !== 'string' ||
        typeof record.filename !== 'string' ||
        !Number.isFinite(record.expiresAt)
      ) {
        throw new Error('invalid_preview_record');
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async scan(): Promise<{ records: MarkdownRecord[]; bytes: number }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await access(this.directory, constants.W_OK);
    const records: MarkdownRecord[] = [];
    let bytes = 0;
    for (const filename of await readdir(this.directory)) {
      const filePath = join(this.directory, filename);
      // 起動時に残った原子書込用ファイルも回収する（同じキュー内でのみ実行）。
      if (/^[0-9a-f-]{36}\.json\.tmp$/.test(filename)) {
        await unlink(filePath);
        continue;
      }
      if (!filename.endsWith('.json') || !ID.test(filename.slice(0, -5)))
        continue;
      const record = await this.read(filename.slice(0, -5));
      if (!record) continue;
      if (record.expiresAt <= this.now()) {
        await unlink(filePath);
      } else {
        records.push(record);
        bytes += (await stat(filePath)).size;
      }
    }
    return { records, bytes };
  }

  private async write(record: MarkdownRecord): Promise<void> {
    const path = this.path(record.id);
    try {
      await writeFile(`${path}.tmp`, JSON.stringify(record), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } finally {
      await unlink(`${path}.tmp`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  cleanup(): Promise<void> {
    return this.exclusive(async () => {
      await this.scan();
    });
  }

  find(source: MarkdownSource): Promise<MarkdownRecord | undefined> {
    return this.exclusive(async () =>
      (await this.scan()).records.find(
        (record) =>
          record.guildId === source.guildId &&
          record.channelId === source.channelId &&
          record.messageId === source.messageId &&
          record.attachmentId === source.attachmentId
      )
    );
  }

  save(source: MarkdownSource, markdown: string): Promise<MarkdownRecord> {
    return this.exclusive(async () => {
      if (Buffer.byteLength(markdown, 'utf8') > this.config.maxFileBytes)
        throw new Error('file_too_large');
      const { records, bytes } = await this.scan();
      const existing = records.find(
        (record) =>
          record.guildId === source.guildId &&
          record.channelId === source.channelId &&
          record.messageId === source.messageId &&
          record.attachmentId === source.attachmentId
      );
      if (existing) return existing;
      const record: MarkdownRecord = {
        ...source,
        filename: source.filename.slice(0, 255),
        markdown,
        id: randomUUID(),
        createdAt: this.now(),
        expiresAt: this.now() + this.config.ttlMs,
      };
      // replyId用領域と原子更新の一時ファイル1個分を予約する。
      const size = Buffer.byteLength(JSON.stringify(record)) + 128;
      const largest = Math.max(
        size,
        ...records.map((item) => Buffer.byteLength(JSON.stringify(item)) + 128)
      );
      if (
        records.length >= this.config.maxFiles ||
        bytes + size + largest > this.config.maxTotalBytes
      ) {
        throw new Error('storage_full');
      }
      await this.write(record);
      return record;
    });
  }

  markReplied(id: string, replyId: string): Promise<void> {
    return this.exclusive(async () => {
      const record = await this.read(id);
      if (!record) throw new Error('preview_not_found');
      await this.write({ ...record, replyId });
    });
  }

  get(
    id: string
  ): Promise<
    | { status: 'found'; record: MarkdownRecord }
    | { status: 'missing' | 'expired' }
  > {
    if (!ID.test(id)) return Promise.resolve({ status: 'missing' });
    return this.exclusive(async () => {
      const record = await this.read(id);
      if (!record) return { status: 'missing' };
      if (record.expiresAt <= this.now()) {
        await unlink(this.path(id));
        return { status: 'expired' };
      }
      return { status: 'found', record };
    });
  }
}
