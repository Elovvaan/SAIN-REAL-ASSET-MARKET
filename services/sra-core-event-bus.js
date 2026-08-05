import { EventEmitter } from 'node:events';

export class SraCoreEventBus extends EventEmitter {
  constructor({ maxListeners = 64 } = {}) {
    super();
    this.setMaxListeners(maxListeners);
  }

  publish(eventType, payload = {}) {
    const event = Object.freeze({
      eventType,
      occurredAt: new Date().toISOString(),
      payload,
    });
    this.emit(eventType, event);
    this.emit('*', event);
    return event;
  }

  subscribe(eventType, handler) {
    this.on(eventType, handler);
    return () => this.off(eventType, handler);
  }
}
