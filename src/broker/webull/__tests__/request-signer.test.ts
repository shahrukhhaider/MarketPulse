import { describe, it, expect } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { signRequest, signRequestWithParams } from '../request-signer.js';
import type { SignatureInput } from '../request-signer.js';

function makeInput(overrides?: Partial<SignatureInput>): SignatureInput {
  return {
    method: 'GET',
    path: '/account/list',
    queryParams: {},
    body: null,
    appKey: 'test-app-key',
    appSecret: 'test-app-secret',
    host: 'us-oauth-open-api.webull.com',
    ...overrides,
  };
}

describe('request-signer', () => {
  describe('signRequest', () => {
    it('returns all required headers', () => {
      const headers = signRequest(makeInput());

      expect(headers['x-app-key']).toBe('test-app-key');
      expect(headers['x-signature-algorithm']).toBe('HMAC-SHA1');
      expect(headers['x-signature-version']).toBe('1.0');
      expect(headers['x-version']).toBe('v2');
      expect(headers['x-timestamp']).toBeDefined();
      expect(headers['x-signature']).toBeDefined();
      expect(headers['x-signature-nonce']).toBeDefined();
    });

    it('generates x-timestamp in ISO 8601 format without milliseconds', () => {
      const headers = signRequest(makeInput());
      // Should match pattern like 2024-01-15T12:30:00Z
      expect(headers['x-timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('generates x-signature-nonce as 32 hex characters (16 bytes)', () => {
      const headers = signRequest(makeInput());
      expect(headers['x-signature-nonce']).toMatch(/^[0-9a-f]{32}$/);
    });

    it('does not include Content-Type when body is null', () => {
      const headers = signRequest(makeInput({ body: null }));
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('includes Content-Type application/json when body is present', () => {
      const headers = signRequest(makeInput({ body: { key: 'value' } }));
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('signRequestWithParams', () => {
    const fixedTimestamp = '2024-06-15T10:30:00Z';
    const fixedNonce = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

    it('produces deterministic output for fixed inputs', () => {
      const input = makeInput();
      const headers1 = signRequestWithParams(input, fixedTimestamp, fixedNonce);
      const headers2 = signRequestWithParams(input, fixedTimestamp, fixedNonce);

      expect(headers1).toEqual(headers2);
    });

    it('uses provided timestamp and nonce in output', () => {
      const headers = signRequestWithParams(makeInput(), fixedTimestamp, fixedNonce);

      expect(headers['x-timestamp']).toBe(fixedTimestamp);
      expect(headers['x-signature-nonce']).toBe(fixedNonce);
    });

    it('produces correct signature for a known input (GET, no body)', () => {
      const input = makeInput({
        method: 'GET',
        path: '/account/list',
        queryParams: { page: '1' },
        body: null,
        appKey: 'myAppKey',
        appSecret: 'myAppSecret',
        host: 'us-oauth-open-api.webull.com',
      });

      const headers = signRequestWithParams(input, fixedTimestamp, fixedNonce);

      // Manually compute expected signature
      const signingHeaders: Record<string, string> = {
        'x-app-key': 'myAppKey',
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-version': '1.0',
        'x-signature-nonce': fixedNonce,
        'x-timestamp': fixedTimestamp,
        'host': 'us-oauth-open-api.webull.com',
      };
      const allParams = { page: '1', ...signingHeaders };
      const sortedKeys = Object.keys(allParams).sort();
      const str1 = sortedKeys.map(k => `${k}=${allParams[k]}`).join('&');
      const str3 = `/account/list&${str1}`;
      const encodedString = encodeURIComponent(str3);
      const key = 'myAppSecret&';
      const expectedSignature = createHmac('sha1', key).update(encodedString).digest('base64');

      expect(headers['x-signature']).toBe(expectedSignature);
    });

    it('produces correct signature for POST with body (includes MD5)', () => {
      const body = { ticker: 'AAPL', quantity: 1 };
      const input = makeInput({
        method: 'POST',
        path: '/trade/place_order',
        queryParams: {},
        body,
        appKey: 'myAppKey',
        appSecret: 'myAppSecret',
        host: 'us-oauth-open-api.webull.com',
      });

      const headers = signRequestWithParams(input, fixedTimestamp, fixedNonce);

      // Manually compute expected signature with body MD5
      const signingHeaders: Record<string, string> = {
        'x-app-key': 'myAppKey',
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-version': '1.0',
        'x-signature-nonce': fixedNonce,
        'x-timestamp': fixedTimestamp,
        'host': 'us-oauth-open-api.webull.com',
      };
      const allParams = { ...signingHeaders };
      const sortedKeys = Object.keys(allParams).sort();
      const str1 = sortedKeys.map(k => `${k}=${allParams[k]}`).join('&');
      const bodyStr = JSON.stringify(body);
      const str2 = createHash('md5').update(bodyStr).digest('hex').toUpperCase();
      const str3 = `/trade/place_order&${str1}&${str2}`;
      const encodedString = encodeURIComponent(str3);
      const key = 'myAppSecret&';
      const expectedSignature = createHmac('sha1', key).update(encodedString).digest('base64');

      expect(headers['x-signature']).toBe(expectedSignature);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('produces different signatures when appSecret differs', () => {
      const input1 = makeInput({ appSecret: 'secret1' });
      const input2 = makeInput({ appSecret: 'secret2' });

      const h1 = signRequestWithParams(input1, fixedTimestamp, fixedNonce);
      const h2 = signRequestWithParams(input2, fixedTimestamp, fixedNonce);

      expect(h1['x-signature']).not.toBe(h2['x-signature']);
    });

    it('produces different signatures when path differs', () => {
      const input1 = makeInput({ path: '/account/list' });
      const input2 = makeInput({ path: '/trade/orders' });

      const h1 = signRequestWithParams(input1, fixedTimestamp, fixedNonce);
      const h2 = signRequestWithParams(input2, fixedTimestamp, fixedNonce);

      expect(h1['x-signature']).not.toBe(h2['x-signature']);
    });

    it('produces different signatures when timestamp differs', () => {
      const input = makeInput();

      const h1 = signRequestWithParams(input, '2024-06-15T10:30:00Z', fixedNonce);
      const h2 = signRequestWithParams(input, '2024-06-15T10:31:00Z', fixedNonce);

      expect(h1['x-signature']).not.toBe(h2['x-signature']);
    });

    it('produces different signatures when nonce differs', () => {
      const input = makeInput();

      const h1 = signRequestWithParams(input, fixedTimestamp, 'a'.repeat(32));
      const h2 = signRequestWithParams(input, fixedTimestamp, 'b'.repeat(32));

      expect(h1['x-signature']).not.toBe(h2['x-signature']);
    });

    it('produces different signatures when body differs', () => {
      const input1 = makeInput({ body: { a: 1 } });
      const input2 = makeInput({ body: { a: 2 } });

      const h1 = signRequestWithParams(input1, fixedTimestamp, fixedNonce);
      const h2 = signRequestWithParams(input2, fixedTimestamp, fixedNonce);

      expect(h1['x-signature']).not.toBe(h2['x-signature']);
    });

    it('does not include Content-Type when body is undefined', () => {
      const headers = signRequestWithParams(
        makeInput({ body: undefined }),
        fixedTimestamp,
        fixedNonce,
      );
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('query params are included in signature computation', () => {
      const input1 = makeInput({ queryParams: { page: '1' } });
      const input2 = makeInput({ queryParams: { page: '2' } });

      const h1 = signRequestWithParams(input1, fixedTimestamp, fixedNonce);
      const h2 = signRequestWithParams(input2, fixedTimestamp, fixedNonce);

      expect(h1['x-signature']).not.toBe(h2['x-signature']);
    });
  });
});
