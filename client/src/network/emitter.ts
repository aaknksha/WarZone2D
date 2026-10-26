type Fn<T> = (payload: T) => void;

/** Minimal typed event emitter. `on` returns an unsubscribe function. */
export class Emitter<M extends object> {
  private listeners = new Map<keyof M, Set<Fn<never>>>();

  on<K extends keyof M>(event: K, fn: Fn<M[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as Fn<never>);
    return () => set.delete(fn as Fn<never>);
  }

  protected emit<K extends keyof M>(event: K, payload: M[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as Fn<M[K]>)(payload));
  }
}
