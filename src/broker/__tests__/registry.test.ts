import { describe, it, expect, beforeEach } from 'vitest';
import { BrokerRegistry } from '../registry.js';
import type { BrokerAdapter } from '../types.js';

function makeMockAdapter(brokerId: string): BrokerAdapter {
  return {
    brokerId,
    validateCredentials: async () => ({ ok: true, data: { accounts: [] } }),
    placeBracketOrder: async () => ({ ok: true, data: {} as any }),
    getPositions: async () => ({ ok: true, data: [] }),
    getAccount: async () => ({ ok: true, data: {} as any }),
    cancelOrder: async () => ({ ok: true, data: { cancelled: true } }),
  };
}

describe('BrokerRegistry', () => {
  let registry: BrokerRegistry;

  beforeEach(() => {
    registry = new BrokerRegistry();
  });

  it('should resolve a registered adapter by brokerId', () => {
    const adapter = makeMockAdapter('webull');
    registry.register(adapter);

    expect(registry.resolve('webull')).toBe(adapter);
  });

  it('should return undefined for an unregistered brokerId', () => {
    expect(registry.resolve('unknown')).toBeUndefined();
  });

  it('should list all registered broker IDs', () => {
    registry.register(makeMockAdapter('webull'));
    registry.register(makeMockAdapter('alpaca'));

    expect(registry.list()).toEqual(['webull', 'alpaca']);
  });

  it('should return an empty list when no adapters are registered', () => {
    expect(registry.list()).toEqual([]);
  });

  it('should overwrite an adapter when registering the same brokerId', () => {
    const first = makeMockAdapter('webull');
    const second = makeMockAdapter('webull');

    registry.register(first);
    registry.register(second);

    expect(registry.resolve('webull')).toBe(second);
    expect(registry.list()).toEqual(['webull']);
  });
});
