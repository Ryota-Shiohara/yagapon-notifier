import { setTimeout as sleep } from 'node:timers/promises';

// 内容を表示してよい、このツール自身が生成した設定エラー。
export class ExportSetupError extends Error {}

export class ExportInterruptedError extends Error {
  constructor() {
    super('取得を中断しました。保存済みのページから再開できます。');
  }
}

export class DiscordExportHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly route: string,
    code?: number
  ) {
    super(
      `Discord API: HTTP ${status}${code ? ` / code ${code}` : ''} (${route})`
    );
  }
}

export interface ExportApi {
  get<T>(
    route: string,
    query?: Record<string, string | number | undefined>
  ): Promise<T>;
}

interface ClientOptions {
  delayMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

// この一覧以外への通信、POST/PATCH/DELETE、リダイレクトは許可しない。
const READ_ROUTES =
  /^\/(?:users\/@me(?:\/guilds)?|applications\/@me|guilds\/\d+(?:\/channels|\/threads\/active|\/members\/\d+)?|channels\/\d+\/(?:messages|threads\/archived\/(?:public|private)|users\/@me\/threads\/archived\/private))$/;

export class DiscordExportClient implements ExportApi {
  private readonly fetchFn: typeof fetch;
  private readonly pause: NonNullable<ClientOptions['sleep']>;

  constructor(
    private readonly token: string,
    private readonly options: ClientOptions = {}
  ) {
    if (!token.trim() || /\s/.test(token)) {
      throw new ExportSetupError(
        'DISCORD_TOKENには接頭辞や空白を含まないBotトークンを設定してください。'
      );
    }
    this.fetchFn = options.fetch ?? fetch;
    this.pause =
      options.sleep ??
      (async (ms, signal) => {
        if (ms > 0) await sleep(ms, undefined, { signal });
      });
  }

  private checkInterrupted(): void {
    if (this.options.signal?.aborted) throw new ExportInterruptedError();
  }

  private async wait(ms: number): Promise<void> {
    this.checkInterrupted();
    try {
      await this.pause(ms, this.options.signal);
    } catch {
      this.checkInterrupted();
      throw new Error('API待機処理に失敗しました。');
    }
    this.checkInterrupted();
  }

  async get<T>(
    route: string,
    query: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    if (!READ_ROUTES.test(route))
      throw new Error('許可されていないAPI経路です。');
    const url = new URL(`https://discord.com/api/v10${route}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; attempt <= 5; attempt++) {
      await this.wait(this.options.delayMs ?? 350);
      const controller = new AbortController();
      const abort = () => controller.abort();
      this.options.signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 30_000);
      let response: Response;
      let body: unknown;
      try {
        this.checkInterrupted();
        response = await this.fetchFn(url, {
          method: 'GET',
          headers: { Authorization: `Bot ${this.token}` },
          redirect: 'error',
          signal: controller.signal,
        });
        body = await response.json().catch(() => null);
      } catch {
        this.checkInterrupted();
        if (attempt === 5)
          throw new Error(`Discordへの接続に失敗しました (${route})。`);
        await this.wait(1000 * 2 ** attempt);
        continue;
      } finally {
        clearTimeout(timeout);
        this.options.signal?.removeEventListener('abort', abort);
      }

      const details = body as { retry_after?: unknown; code?: unknown } | null;
      const retryAfter = Number(
        details?.retry_after ?? response.headers.get('retry-after')
      );
      if (response.status === 429 && attempt < 5) {
        await this.wait(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000 + 100
            : 1000
        );
        continue;
      }
      if (response.status >= 500 && attempt < 5) {
        await this.wait(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        // 応答本文・例外オブジェクト・リクエストヘッダーをログへ出さない。
        throw new DiscordExportHttpError(
          response.status,
          route,
          typeof details?.code === 'number' ? details.code : undefined
        );
      }
      if (body === null)
        throw new Error(`DiscordのJSON応答を読み取れません (${route})。`);
      const resetAfter = Number(
        response.headers.get('x-ratelimit-reset-after')
      );
      if (
        response.headers.get('x-ratelimit-remaining') === '0' &&
        resetAfter > 0 &&
        Number.isFinite(resetAfter)
      ) {
        await this.wait(resetAfter * 1000 + 100);
      }
      return body as T;
    }
    throw new Error('Discord APIの再試行回数を超えました。');
  }
}
