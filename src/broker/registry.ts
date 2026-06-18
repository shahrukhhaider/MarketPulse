// src/broker/registry.ts
import type { BrokerAdapter } from './types.js';

export class BrokerRegistry {
  private adapters = new Map<string, BrokerAdapter>();

  register(adapter: BrokerAdapter): void {
    this.adapters.set(adapter.brokerId, adapter);
  }

  resolve(brokerId: string): BrokerAdapter | undefined {
    return this.adapters.get(brokerId);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}

// Singleton instance, initialized at startup
export const brokerRegistry = new BrokerRegistry();
