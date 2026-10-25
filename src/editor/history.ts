/**
 * Bounded undo/redo stack of serializable snapshots. Snapshots hold object descriptions
 * (a few KB each), never bitmaps, and identical consecutive snapshots are collapsed.
 */
export class History<T> {
  private stack: { value: T; key: string }[];
  private index = 0;

  constructor(
    initial: T,
    private readonly limit: number,
  ) {
    this.stack = [{ value: initial, key: JSON.stringify(initial) }];
  }

  get current(): T {
    return this.stack[this.index].value;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** Number of steps away from the initial state (used for "unsaved changes"). */
  get depth(): number {
    return this.index;
  }

  /** Returns false when the snapshot equals the current one. */
  push(value: T): boolean {
    const key = JSON.stringify(value);
    if (key === this.stack[this.index].key) return false;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push({ value, key });
    if (this.stack.length > this.limit + 1) this.stack.splice(0, this.stack.length - (this.limit + 1));
    this.index = this.stack.length - 1;
    return true;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.index--;
    return this.current;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.index++;
    return this.current;
  }

  reset(initial: T): void {
    this.stack = [{ value: initial, key: JSON.stringify(initial) }];
    this.index = 0;
  }
}
