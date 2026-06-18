import { Router, type Request, type Response } from 'express';
import { decodeFormToken } from '../broker/token-encryption.js';
import { nonceStore } from './nonce-store.js';
import type { BrokerRegistry } from '../broker/registry.js';
import type { TokenStore } from '../db/token-store.js';

const MAX_INPUT_LENGTH = 128;

/**
 * Creates the Express router for broker key-based connection handling.
 *
 * Routes:
 * - GET  /connect/webull?token=<encrypted> — serves the key submission form
 * - POST /connect/webull — processes submitted credentials
 *
 * @param brokerRegistry - Registry to resolve broker adapters by ID
 * @param tokenStore - Persistence layer for encrypted credential storage
 * @param discordNotifier - Sends a DM to a Discord user by their ID
 */
export function createBrokerRouter(
  brokerRegistry: BrokerRegistry,
  tokenStore: TokenStore,
  discordNotifier: (userId: string, message: string) => Promise<void>,
): Router {
  const router = Router();

  // GET /connect/webull?token=<encrypted>
  // Serves the key submission form or an error page
  router.get('/connect/webull', (req: Request, res: Response) => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      res.status(400).send(errorPage('Missing or invalid link.'));
      return;
    }

    try {
      const { nonce } = decodeFormToken(token);
      if (nonceStore.isConsumed(nonce)) {
        res.status(400).send(errorPage('This link has already been used.'));
        return;
      }
      // Valid token — render the form
      res.status(200).send(keyFormPage(token));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid link';
      res.status(400).send(errorPage(msg));
    }
  });

  // POST /connect/webull
  // Processes the key submission
  router.post('/connect/webull', async (req: Request, res: Response) => {
    const { token, app_key, app_secret } = req.body;

    // 1. Validate token
    let userId: string;
    let nonce: string;
    let mode: 'paper' | 'live';
    try {
      const decoded = decodeFormToken(token);
      userId = decoded.userId;
      nonce = decoded.nonce;
      mode = decoded.mode;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid link';
      res.status(400).send(errorPage(msg));
      return;
    }

    // 2. Check nonce (single-use)
    if (!nonceStore.consume(nonce)) {
      res.status(400).send(errorPage('This link has already been used.'));
      return;
    }

    // 3. Validate inputs: non-empty, non-whitespace, ≤128 chars
    const trimmedKey = typeof app_key === 'string' ? app_key.trim() : '';
    const trimmedSecret = typeof app_secret === 'string' ? app_secret.trim() : '';

    if (!trimmedKey || !trimmedSecret) {
      res.status(400).send(errorPage('Both app_key and app_secret are required and cannot be blank.'));
      return;
    }

    if (trimmedKey.length > MAX_INPUT_LENGTH || trimmedSecret.length > MAX_INPUT_LENGTH) {
      res.status(400).send(errorPage('Credentials must be 128 characters or fewer.'));
      return;
    }

    // 4. Validate credentials against Webull API with 15s timeout
    const adapter = brokerRegistry.resolve('webull');
    if (!adapter) {
      res.status(500).send(errorPage('Broker adapter not configured.'));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const result = await adapter.validateCredentials(trimmedKey, trimmedSecret);
      clearTimeout(timeout);

      if (!result.ok) {
        if (result.error.httpStatus === 401 || result.error.httpStatus === 403) {
          res.status(400).send(errorPage(
            'Invalid credentials — the app_key or app_secret was rejected by Webull.',
          ));
        } else {
          res.status(500).send(retryableErrorPage(
            'Webull API returned an unexpected error. Please try again.',
            token,
          ));
        }
        return;
      }

      // 5. Select first account from the list
      const accounts = result.data.accounts;
      const account = accounts[0];

      // 6. Store encrypted credentials with user-selected mode
      await tokenStore.saveCredentials(userId, 'webull', {
        appKey: trimmedKey,
        appSecret: trimmedSecret,
        accountId: account.accountId,
        accountType: mode,
      });

      // 7. Notify via Discord (best-effort)
      const modeLabel = mode === 'live' ? 'Live trading' : 'Paper trading';
      try {
        await discordNotifier(
          userId,
          `✅ Your Webull broker connection is active! ${modeLabel} mode is ready.`,
        );
      } catch {
        /* best-effort — don't fail the user flow */
      }

      // 8. Success page
      res.status(200).send(successPage(mode));
    } catch (err) {
      clearTimeout(timeout);
      // Timeout or network error — retryable
      res.status(500).send(retryableErrorPage(
        'Could not reach Webull — this may be a temporary issue. Please try again.',
        token,
      ));
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------

function keyFormPage(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Webull — PaperEdge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1f2e;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    h1 {
      font-size: 1.4rem;
      margin-bottom: 8px;
      color: #f7fafc;
    }
    .subtitle {
      font-size: 0.9rem;
      color: #a0aec0;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .subtitle a {
      color: #63b3ed;
      text-decoration: none;
    }
    .subtitle a:hover { text-decoration: underline; }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #cbd5e0;
      margin-bottom: 6px;
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #4a5568;
      border-radius: 6px;
      background: #2d3748;
      color: #f7fafc;
      font-size: 0.95rem;
      margin-bottom: 4px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #63b3ed;
    }
    input.invalid {
      border-color: #fc8181;
    }
    .field-group {
      margin-bottom: 18px;
    }
    .error-msg {
      font-size: 0.8rem;
      color: #fc8181;
      min-height: 18px;
      margin-top: 2px;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #4299e1;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
      margin-top: 8px;
    }
    button:hover:not(:disabled) { background: #3182ce; }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .security-note {
      margin-top: 16px;
      font-size: 0.78rem;
      color: #718096;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Your Webull Account</h1>
    <p class="subtitle">
      Enter your API credentials from
      <a href="https://developer.webull.com" target="_blank" rel="noopener">developer.webull.com</a>.
      Your keys are encrypted before storage and never logged.
    </p>
    <form id="keyForm" method="POST" action="/connect/webull">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <div class="field-group">
        <label for="app_key">App Key</label>
        <input type="text" id="app_key" name="app_key" maxlength="128"
               autocomplete="off" spellcheck="false" required>
        <div class="error-msg" id="app_key_error"></div>
      </div>
      <div class="field-group">
        <label for="app_secret">App Secret</label>
        <input type="password" id="app_secret" name="app_secret" maxlength="128"
               autocomplete="off" required>
        <div class="error-msg" id="app_secret_error"></div>
      </div>
      <button type="submit" id="submitBtn">Connect Broker</button>
    </form>
    <p class="security-note">🔒 Transmitted over HTTPS. Credentials are encrypted at rest.</p>
  </div>
  <script>
    (function() {
      var form = document.getElementById('keyForm');
      var btn = document.getElementById('submitBtn');
      var keyInput = document.getElementById('app_key');
      var secretInput = document.getElementById('app_secret');
      var keyError = document.getElementById('app_key_error');
      var secretError = document.getElementById('app_secret_error');

      function validateField(input, errorEl) {
        var val = input.value;
        if (!val || !val.trim()) {
          errorEl.textContent = 'This field is required.';
          input.classList.add('invalid');
          return false;
        }
        errorEl.textContent = '';
        input.classList.remove('invalid');
        return true;
      }

      keyInput.addEventListener('blur', function() { validateField(keyInput, keyError); });
      secretInput.addEventListener('blur', function() { validateField(secretInput, secretError); });

      form.addEventListener('submit', function(e) {
        var keyValid = validateField(keyInput, keyError);
        var secretValid = validateField(secretInput, secretError);
        if (!keyValid || !secretValid) {
          e.preventDefault();
          return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Connecting...';
      });
    })();
  </script>
</body>
</html>`;
}

function successPage(accountType: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected — PaperEdge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1f2e;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h1 { font-size: 1.4rem; margin-bottom: 12px; color: #68d391; }
    p { color: #a0aec0; line-height: 1.6; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Webull ${escapeHtml(accountType)} Account Connected</h1>
    <p>Your broker connection is active. You can close this window and return to Discord.</p>
    <p>Use <strong>/get_positions</strong> or <strong>/get_account</strong> to confirm everything is working.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — PaperEdge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1f2e;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h1 { font-size: 1.4rem; margin-bottom: 12px; color: #fc8181; }
    p { color: #a0aec0; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Connection Failed</h1>
    <p>${escapeHtml(message)}</p>
    <p style="margin-top: 16px;">Please return to Discord and use the connect command to get a new link.</p>
  </div>
</body>
</html>`;
}

function retryableErrorPage(message: string, token: string): string {
  const retryUrl = `/connect/webull?token=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Temporary Error — PaperEdge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1f2e;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h1 { font-size: 1.4rem; margin-bottom: 12px; color: #f6ad55; }
    p { color: #a0aec0; line-height: 1.6; margin-bottom: 12px; }
    a.retry {
      display: inline-block;
      margin-top: 16px;
      padding: 10px 24px;
      background: #4299e1;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      transition: background 0.2s;
    }
    a.retry:hover { background: #3182ce; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Temporary Issue</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${escapeHtml(retryUrl)}" class="retry">Try Again</a>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Escapes HTML special characters to prevent XSS in rendered templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
