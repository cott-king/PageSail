import type { LayoutOptions } from '../features/image-to-pdf/layout';
import type { ImageToPdfItem } from '../features/image-to-pdf/buildPdf';
import type { AssembleOutputSpec, AssembleSource, AssembledFile } from '../features/pdf-pages/assemble';
import type { AnnotationExportInput } from '../features/pdf-annotate/model';
import type { InspectResult } from '../lib/pdf/pdfLibLoad';
import type { SerializedError } from '../lib/errors';

/** Typed contract between the UI thread and the processing worker. */
export interface JobMap {
  imagesToPdf: { input: { items: ImageToPdfItem[]; options: LayoutOptions }; output: Uint8Array };
  inspectPdf: { input: { bytes: Uint8Array }; output: InspectResult };
  assemblePdfs: { input: { sources: AssembleSource[]; outputs: AssembleOutputSpec[] }; output: AssembledFile[] };
  exportAnnotations: { input: AnnotationExportInput; output: Uint8Array };
}

export type JobName = keyof JobMap;

export interface JobRequest<K extends JobName = JobName> {
  type: K;
  input: JobMap[K]['input'];
}

export type JobMessage = { kind: 'progress'; done: number; total: number } | { kind: 'result'; result: unknown } | { kind: 'error'; error: SerializedError };
