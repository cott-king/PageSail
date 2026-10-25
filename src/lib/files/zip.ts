import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { uniqueNames } from './names';

/**
 * Incremental ZIP writer. Entries are appended as soon as they are produced, so the
 * caller can drop each page's Blob right away instead of holding every result twice.
 * PNG/JPG/PDF data is already compressed, so entries are stored without deflate by default.
 */
export class ZipBuilder {
  private readonly chunks: Uint8Array[] = [];
  private readonly zip: Zip;
  private readonly usedNames: string[] = [];
  private failure: Error | null = null;
  private done: Promise<void>;
  private resolveDone!: () => void;
  private rejectDone!: (e: Error) => void;

  constructor() {
    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.zip = new Zip((err, data, final) => {
      if (err) {
        this.failure = err;
        this.rejectDone(err);
        return;
      }
      this.chunks.push(data);
      if (final) this.resolveDone();
    });
  }

  add(name: string, data: Uint8Array, compress = false): void {
    if (this.failure) throw this.failure;
    const [unique] = uniqueNames([...this.usedNames, name]).slice(-1);
    this.usedNames.push(unique);
    const entry = compress ? new ZipDeflate(unique, { level: 6 }) : new ZipPassThrough(unique);
    this.zip.add(entry);
    entry.push(data, true);
  }

  get size(): number {
    return this.usedNames.length;
  }

  async finish(): Promise<Blob> {
    this.zip.end();
    await this.done;
    const parts = this.chunks.map((c) => {
      const copy = new Uint8Array(c.byteLength);
      copy.set(c);
      return copy.buffer;
    });
    this.chunks.length = 0;
    return new Blob(parts, { type: 'application/zip' });
  }

  abort(): void {
    try {
      this.zip.terminate();
    } catch {
      // ignore
    }
    this.chunks.length = 0;
  }
}
