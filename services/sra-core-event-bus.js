import { EventEmitter } from 'node:events';

export class SraCoreEventBus extends EventEmitter {
  constructor({ maxListeners = 64, onDeliveryError = null } = {}) {
    super();
    this.setMaxListeners(maxListeners);
    this.onDeliveryError = typeof onDeliveryError === 'function' ? onDeliveryError : null;
  }

  deliver(eventType, event) {
    const errors = [];
    for (const listener of this.listeners(eventType)) {
      try {
        const result = listener(event);
        if (result && typeof result.catch === 'function') {
          result.catch((error) => this.onDeliveryError?.({ eventType, event, error }));
        }
      } catch (error) {
        errors.push({ eventType, message: error?.message || String(error) });
        this.onDeliveryError?.({ eventType, event, error });
      }
    }
    return errors;
  }

  publish(eventType, payload = {}) {
    const event = Object.freeze({
      eventType,
      occurredAt: new Date().toISOString(),
      payload,
    });
    const deliveryErrors = [
      ...this.deliver(eventType, event),
      ...this.deliver('*', event),
    ];
    return Object.freeze({ ...event, deliveryErrors });
  }

  subscribe(eventType, handler) {
    this.on(eventType, handler);
    return () => this.off(eventType, handler);
  }
}
