import { imagesToPdf } from '../features/image-to-pdf/buildPdf';
import { assemblePdfs } from '../features/pdf-pages/assemble';
import { exportAnnotatedPdf } from '../features/pdf-annotate/exportPdf';
import { inspectPdf } from '../lib/pdf/pdfLibLoad';
import { serializeError } from '../lib/errors';
import type { JobMap, JobMessage, JobName, JobRequest } from './jobs';

/**
 * Off-main-thread PDF writing (pdf-lib). One worker is created per job and terminated
 * afterwards, so cancelling a job really stops the work and frees its memory.
 */
type Handler<K extends JobName> = (input: JobMap[K]['input'], progress: (done: number, total: number) => void) => Promise<JobMap[K]['output']>;

const handlers: { [K in JobName]: Handler<K> } = {
  imagesToPdf: (input, progress) => imagesToPdf(input.items, input.options, progress),
  inspectPdf: (input) => inspectPdf(input.bytes),
  assemblePdfs: (input, progress) => assemblePdfs(input.sources, input.outputs, progress),
  exportAnnotations: (input, progress) => exportAnnotatedPdf(input, progress),
};

// Typed locally: the app's tsconfig uses the DOM lib, which conflicts with the WebWorker lib.
const scope = self as unknown as {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<JobRequest>) => void) | null;
};

function post(msg: JobMessage, transfer: Transferable[] = []) {
  scope.postMessage(msg, transfer);
}

function collectTransfer(result: unknown): Transferable[] {
  const out: Transferable[] = [];
  const visit = (v: unknown) => {
    if (v instanceof Uint8Array) {
      if (v.byteOffset === 0 && v.byteLength === v.buffer.byteLength && v.buffer instanceof ArrayBuffer) out.push(v.buffer);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(result);
  return [...new Set(out)];
}

scope.onmessage = async (event: MessageEvent<JobRequest>) => {
  const { type, input } = event.data;
  try {
    const handler = handlers[type] as Handler<JobName>;
    if (!handler) throw new Error(`Unknown job ${type}`);
    const result = await handler(input as never, (done, total) => post({ kind: 'progress', done, total }));
    post({ kind: 'result', result }, collectTransfer(result));
  } catch (e) {
    post({ kind: 'error', error: serializeError(e) });
  }
};
