const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const protocol = require('../shared/protocol.js');
const totp = require('../shared/totp.js');
const { createProtocolBridge } = require('../content/protocol-bridge.js');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('begins login through same-origin ChatGPT endpoints', async () => {
  const requests = [];
  const responses = [
    jsonResponse(200, { openai: {} }),
    jsonResponse(200, { csrfToken: 'csrf-value' }),
    jsonResponse(200, { url: 'https://auth.openai.com/log-in/password' }),
  ];
  const bridge = createProtocolBridge({
    cryptoImpl: webcrypto,
    locationImpl: new URL('https://chatgpt.com/'),
    protocol,
    totp,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
  });

  const result = await bridge.beginLogin({ email: 'user@example.com', deviceId: 'device-id' });

  assert.equal(result.authUrl, 'https://auth.openai.com/log-in/password');
  assert.equal(requests.length, 3);
  assert.match(requests[2].url, /\/api\/auth\/signin\/openai\?/);
  assert.equal(requests[2].options.credentials, 'include');
  assert.equal(requests[2].options.body.includes('csrfToken=csrf-value'), true);
});

test('verifies password, TOTP and workspace before returning the callback', async () => {
  const requests = [];
  const progress = [];
  const responses = [
    jsonResponse(200, {
      page: { type: 'mfa_challenge' },
      'oai-client-auth-session': {
        mfa_challenge_factors: [{ factor_type: 'totp', id: 'factor-1' }],
      },
    }),
    jsonResponse(200, { ok: true }),
    jsonResponse(200, {
      page: { type: 'workspace' },
      'oai-client-auth-session': { workspaces: [{ id: 'workspace-1' }] },
    }),
    jsonResponse(200, { continue_url: '/authorize/resume' }),
  ];
  const bridge = createProtocolBridge({
    cryptoImpl: webcrypto,
    now: () => 5_000,
    locationImpl: new URL('https://auth.openai.com/log-in/password'),
    protocol,
    reportProgress: async (entry) => progress.push(entry),
    totp,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
  });

  const result = await bridge.authenticate({
    taskId: 'task-1',
    password: 'Password',
    totpSecret: 'JBSWY3DPEHPK3PXP',
  });

  assert.equal(result.continueUrl, 'https://auth.openai.com/authorize/resume');
  assert.equal(result.mfaVerified, true);
  assert.deepEqual(progress.map((entry) => entry.stage), [
    'password_verifying',
    'password_verified',
    'totp_challenge',
    'totp_verified',
    'workspace_selecting',
    'workspace_selected',
    'authorization_ready',
  ]);
  assert.equal(JSON.stringify(progress).includes('Password'), false);
  assert.equal(JSON.stringify(progress).includes('JBSWY3DPEHPK3PXP'), false);
  assert.deepEqual(requests.map((item) => new URL(item.url).pathname), [
    '/api/accounts/password/verify',
    '/api/accounts/mfa/issue_challenge',
    '/api/accounts/mfa/verify',
    '/api/accounts/workspace/select',
  ]);
  const mfaBody = JSON.parse(requests[2].options.body);
  assert.match(mfaBody.code, /^\d{6}$/);
});

test('rejects email OTP pages without sending credentials', async () => {
  let called = false;
  const bridge = createProtocolBridge({
    cryptoImpl: webcrypto,
    locationImpl: new URL('https://auth.openai.com/email-verification'),
    protocol,
    totp,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, {});
    },
  });

  await assert.rejects(
    bridge.authenticate({ password: 'Password', totpSecret: 'JBSWY3DPEHPK3PXP' }),
    /邮箱验证码/
  );
  assert.equal(called, false);
});
