/**
 * Discord通知処理のエラー分類
 */

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'ERR_NETWORK',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TRANSIENT_ERROR_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'RateLimitError',
]);

const MAX_ERROR_CHAIN_DEPTH = 8;
function isTransientErrorName(name: string): boolean {
  return TRANSIENT_ERROR_NAMES.has(name) || name.startsWith('RateLimitError[');
}

interface ErrorInspection {
  names: Set<string>;
  codes: Set<string>;
  statuses: Set<number>;
  retryAfterMilliseconds?: number;
  retryAfterSeconds?: number;
}

export class NotificationTransientError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds = 5,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'NotificationTransientError';
  }
}

export class NotificationPermanentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NotificationPermanentError';
  }
}

function isObjectLike(value: unknown): value is object {
  return (
    value !== null && (typeof value === 'object' || typeof value === 'function')
  );
}

function getErrorProperty(error: unknown, property: string): unknown {
  if (!isObjectLike(error)) return undefined;

  try {
    return (error as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}

function getStringProperty(
  error: unknown,
  property: string
): string | undefined {
  const value = getErrorProperty(error, property);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getNumericProperty(
  error: unknown,
  property: string
): number | undefined {
  return toFiniteNumber(getErrorProperty(error, property));
}

function inspectErrorChain(error: unknown): ErrorInspection {
  const inspection: ErrorInspection = {
    names: new Set<string>(),
    codes: new Set<string>(),
    statuses: new Set<number>(),
  };
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CHAIN_DEPTH; depth += 1) {
    if (!isObjectLike(current) || visited.has(current)) break;
    visited.add(current);

    const name = getStringProperty(current, 'name');
    if (name) inspection.names.add(name);

    const code = getStringProperty(current, 'code');
    if (code) inspection.codes.add(code);

    const status = getNumericProperty(current, 'status');
    if (status !== undefined) inspection.statuses.add(status);

    const statusCode = getNumericProperty(current, 'statusCode');
    if (statusCode !== undefined) inspection.statuses.add(statusCode);

    if (inspection.retryAfterMilliseconds === undefined) {
      const retryAfter = getNumericProperty(current, 'retryAfter');
      if (retryAfter !== undefined && retryAfter > 0) {
        inspection.retryAfterMilliseconds = retryAfter;
      }
    }

    if (inspection.retryAfterSeconds === undefined) {
      const retryAfter = getNumericProperty(current, 'retry_after');
      if (retryAfter !== undefined && retryAfter > 0) {
        inspection.retryAfterSeconds = retryAfter;
      }
    }

    current = getErrorProperty(current, 'cause');
  }

  return inspection;
}

function getRetryAfterSeconds(inspection: ErrorInspection): number {
  if (inspection.retryAfterMilliseconds !== undefined) {
    return Math.ceil(inspection.retryAfterMilliseconds / 1000);
  }

  if (inspection.retryAfterSeconds !== undefined) {
    return Math.ceil(inspection.retryAfterSeconds);
  }

  return 5;
}

export function toNotificationError(
  error: unknown,
  operation: string
): NotificationTransientError | NotificationPermanentError {
  const inspection = inspectErrorChain(error);
  const message = error instanceof Error ? error.message : String(error);

  const isTransient =
    [...inspection.statuses].some(
      (status) =>
        status === 408 || status === 429 || (status >= 500 && status < 600)
    ) ||
    [...inspection.names].some((name) => isTransientErrorName(name)) ||
    [...inspection.codes].some((code) => TRANSIENT_ERROR_CODES.has(code));

  if (isTransient) {
    return new NotificationTransientError(
      `${operation}中に一時的なDiscordエラーが発生しました: ${message}`,
      getRetryAfterSeconds(inspection),
      { cause: error }
    );
  }

  return new NotificationPermanentError(
    `${operation}に失敗しました: ${message}`,
    { cause: error }
  );
}
