import { EventEmitter } from 'events';
import type { SessionEvent } from '../types/index';

class GatewayEventEmitter extends EventEmitter {
  emitEvent(event: SessionEvent): void {
    this.emit(event.type, event);
    // wildcard channel — lets server.ts forward every event to the Control Backend
    this.emit('*', event);
  }
}

export const gatewayEmitter = new GatewayEventEmitter();
