/**
 * Small synchronous event bus used to keep game commands separate from UI observers.
 */
export class EventBus {
  #listeners = new Map();

  on(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(listener);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  emit(type, payload) {
    for (const listener of this.#listeners.get(type) || []) listener(payload);
  }
}
