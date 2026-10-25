import { AppError, CancelledError, deserializeError } from '../lib/errors';
import type { MessageKey } from '../i18n/messages';
import type { JobMap, JobMessage, JobName } from './jobs';

export interface JobOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Buffers to transfer (not copy) to the worker. They become unusable in the caller. */
  transfer?: Transferable[];
  fallbackError?: MessageKey;
}

/**
 * Runs one processing job in a fresh Web Worker. Aborting the signal terminates the
 * worker immediately; a cancelled job never resolves with a (stale) result.
 */
export function runJob<K extends JobName>(type: K, input: JobMap[K]['input'], opts: JobOptions = {}): Promise<JobMap[K]['output']> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module', name: `pagesail-${type}` });
    } catch (e) {
      reject(new AppError('error.workerFailed', undefined, e instanceof Error ? e.message : String(e)));
      return;
    }
    let settled = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(new CancelledError());
    };
    opts.signal?.addEventListener('abort', onAbort);

    worker.onmessage = (event: MessageEvent<JobMessage>) => {
      if (settled) return;
      const msg = event.data;
      if (msg.kind === 'progress') {
        opts.onProgress?.(msg.done, msg.total);
      } else if (msg.kind === 'result') {
        finish();
        resolve(msg.result as JobMap[K]['output']);
      } else {
        finish();
        reject(deserializeError(msg.error, opts.fallbackError ?? 'error.processingFailed'));
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      finish();
      event.preventDefault();
      reject(new AppError('error.workerFailed', undefined, event.message || 'Worker error'));
    };
    worker.onmessageerror = () => {
      if (settled) return;
      finish();
      reject(new AppError('error.workerFailed', undefined, 'Message could not be deserialized'));
    };
    worker.postMessage({ type, input }, opts.transfer ?? []);
  });
}
