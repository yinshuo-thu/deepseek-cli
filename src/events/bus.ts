// src/events/bus.ts
import { EventEmitter } from 'node:events';

export type BusEventMap = {
  'ExitPlanModeRequest': { toolName: string; resolve: (action: 'exit-plan' | 'cancel') => void };
  'McpStatusChanged': { name: string; status: 'connecting' | 'connected' | 'error' | 'disabled' };
  'PermissionPersisted': { toolName: string; projectKey: string };
};

type BusListener<K extends keyof BusEventMap> = (payload: BusEventMap[K]) => void;

class TypedBus {
  private ee = new EventEmitter();
  constructor() { this.ee.setMaxListeners(50); }
  publish<K extends keyof BusEventMap>(event: K, payload: BusEventMap[K]): void {
    this.ee.emit(event, payload);
  }
  subscribe<K extends keyof BusEventMap>(event: K, cb: BusListener<K>): () => void {
    this.ee.on(event, cb as any);
    return () => this.ee.off(event, cb as any);
  }
}

export const bus = new TypedBus();
