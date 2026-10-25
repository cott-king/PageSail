import type { MessageKey } from '../i18n/messages';

export type ErrorParams = Record<string, string | number>;

/**
 * A user-facing error: `code` is a translation key that explains what happened and
 * what the visitor can do about it. `detail` keeps the technical message for the
 * "technical details" disclosure.
 */
export class AppError extends Error {
  readonly code: MessageKey;
  readonly params?: ErrorParams;
  readonly detail?: string;

  constructor(code: MessageKey, params?: ErrorParams, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
    this.detail = detail;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export function isCancelled(e: unknown): boolean {
  if (e instanceof CancelledError) return true;
  const name = (e as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'RenderingCancelledException' || name === 'CancelledError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return String(e);
  } catch {
    return 'Unknown error';
  }
}

export function toAppError(e: unknown, fallback: MessageKey, params?: ErrorParams): AppError {
  if (e instanceof AppError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError' || (e instanceof RangeError && /memory|allocation|Array buffer/i.test(e.message))) {
    return new AppError('error.outOfMemory', undefined, describe(e));
  }
  return new AppError(fallback, params, describe(e));
}

/** Serializable form used to pass errors out of Web Workers. */
export interface SerializedError {
  code?: MessageKey;
  params?: ErrorParams;
  detail?: string;
  cancelled?: boolean;
}

export function serializeError(e: unknown): SerializedError {
  if (e instanceof AppError) return { code: e.code, params: e.params, detail: e.detail };
  if (isCancelled(e)) return { cancelled: true };
  return { detail: describe(e) };
}

export function deserializeError(s: SerializedError, fallback: MessageKey): Error {
  if (s.cancelled) return new CancelledError();
  return new AppError(s.code ?? fallback, s.params, s.detail);
}
