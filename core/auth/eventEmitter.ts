export type Unsubscribe = () => void;

export class AuthEventEmitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
}
