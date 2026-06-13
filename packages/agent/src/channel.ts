/**
 * Single-producer / single-consumer async channel. Producers push items;
 * a consumer drains them via `for await`. Closing ends the iteration after
 * buffered items are delivered.
 */
export class Channel<T> {
  private queue: T[] = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.queue.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.resolvers) resolve({ value: undefined, done: true });
    this.resolvers = [];
  }

  async *drain(): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.resolvers.push(resolve);
      });
      if (result.done) return;
      yield result.value;
    }
  }
}

/**
 * Awaitable single-value slot used to feed user messages into the SDK's
 * streaming-input generator: the generator awaits `next()`, `put()` wakes it.
 */
export class Gate<T> {
  private pending: Array<(v: T) => void> = [];
  private buffer: T[] = [];

  put(value: T): void {
    const resolve = this.pending.shift();
    if (resolve) resolve(value);
    else this.buffer.push(value);
  }

  next(): Promise<T> {
    if (this.buffer.length > 0) return Promise.resolve(this.buffer.shift()!);
    return new Promise<T>((resolve) => this.pending.push(resolve));
  }
}
