/** FIFO capacity gate. Queued aborts release their closures immediately. */
export class RewriteQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly capacity: number) {}
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => { signal.removeEventListener('abort', abort); this.active++; resolve(); };
      const abort = () => {
        const index = this.waiting.indexOf(start);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason);
      };
      if (this.active < this.capacity) start();
      else { this.waiting.push(start); signal.addEventListener('abort', abort, { once: true }); }
    });
    try { signal.throwIfAborted(); return await work(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
