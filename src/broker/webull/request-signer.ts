import { createHmac, createHash, randomBytes } from 'node:crypto';

export interface SignatureInput {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  queryParams: Record<string, string>;
  body: unknown | null;
  appKey: string;
  appSecret: string;
  host: string;
}

export interface SignedHeaders {
  'x-app-key': string;
  'x-timestamp': string;
  'x-signature': string;
  'x-signature-algorithm': string;
  'x-signature-version': string;
  'x-signature-nonce': string;
  'x-version': string;
  'Content-Type'?: string;
}

/**
 * Computes HMAC-SHA1 signature per Webull OpenAPI spec.
 *
 * Algorithm:
 * 1. Merge query params + signing headers into sorted key=value pairs → str1
 * 2. If body present: MD5(body).toUpperCase() → str2
 * 3. Concatenate: path + "&" + str1 [+ "&" + str2]
 * 4. URL-encode the concatenated string
 * 5. key = app_secret + "&"
 * 6. signature = base64(HMAC-SHA1(key, encoded_string))
 */
export function signRequest(input: SignatureInput): SignedHeaders {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = randomBytes(16).toString('hex');

  return signRequestWithParams(input, timestamp, nonce);
}

/**
 * Deterministic version of signRequest that accepts timestamp and nonce as parameters.
 * Useful for testing without mocking crypto.
 */
export function signRequestWithParams(
  input: SignatureInput,
  timestamp: string,
  nonce: string,
): SignedHeaders {
  const signingHeaders: Record<string, string> = {
    'x-app-key': input.appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': nonce,
    'x-timestamp': timestamp,
    'host': input.host,
  };

  // Step 1: Merge query params and signing headers, sort by key
  const allParams = { ...input.queryParams, ...signingHeaders };
  const sortedKeys = Object.keys(allParams).sort();
  const str1 = sortedKeys.map(k => `${k}=${allParams[k]}`).join('&');

  // Step 2: MD5 of body if present
  let str3: string;
  if (input.body !== null && input.body !== undefined) {
    const bodyStr = JSON.stringify(input.body);
    const str2 = createHash('md5').update(bodyStr).digest('hex').toUpperCase();
    str3 = `${input.path}&${str1}&${str2}`;
  } else {
    str3 = `${input.path}&${str1}`;
  }

  // Step 3: URL-encode
  const encodedString = encodeURIComponent(str3);

  // Step 4: HMAC-SHA1 with key = app_secret + "&"
  const key = `${input.appSecret}&`;
  const signature = createHmac('sha1', key).update(encodedString).digest('base64');

  return {
    'x-app-key': input.appKey,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': nonce,
    'x-version': 'v2',
    ...(input.body !== null && input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
}
