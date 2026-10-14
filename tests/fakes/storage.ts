/**
 * In-memory `Storage` fake for tests. Set `failWrites` / `failReads` to make
 * setItem / getItem throw (simulating quota exceeded or private mode).
 */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  writes = 0;

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    if (this.failReads) throw new Error("SecurityError: storage disabled");
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.writes++;
    this.data.set(key, String(value));
  }
}
