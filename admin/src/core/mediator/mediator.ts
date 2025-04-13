import Event from "../events/event";

export type Subscription = {
  unsubscribe: () => void;
}

export default class Mediator {
  private handlers: Map<string, Set<Function>>;

  constructor () {
    this.handlers = new Map();
  }

  subscribe(event: string, callback: Function): Subscription {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)?.add(callback);
    return {
      unsubscribe: () => this.unsubscribe(event, callback)
    }
  }

  unsubscribe(event: string, callback: Function): void {
    this.handlers.get(event)?.delete(callback);
  }

  async notify(event: Event) {
    this.handlers.get(event.id)?.forEach(callback => callback(event.data));
  }
}

