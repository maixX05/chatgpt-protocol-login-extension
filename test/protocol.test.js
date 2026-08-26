const assert = require('node:assert/strict');
const test = require('node:test');

const protocol = require('../shared/protocol.js');

test('extracts MFA and workspace state from OpenAI auth payloads', () => {
  const mfaPayload = {
    page: { type: 'mfa_challenge' },
    'oai-client-auth-session': {
      mfa_challenge_factors: [{ factor_type: 'totp', id: 'factor-1' }],
    },
  };
  assert.equal(protocol.isMfaChallenge(mfaPayload), true);
  assert.equal(protocol.totpFactor(mfaPayload).id, 'factor-1');

  const workspacePayload = {
    continue_url: '/workspace',
    'oai-client-auth-session': { workspaces: [{ id: 'workspace-1' }] },
  };
  assert.equal(protocol.isWorkspaceSelection(workspacePayload), true);
  assert.equal(protocol.workspaceId(workspacePayload), 'workspace-1');
});

test('only accepts HTTPS OpenAI and ChatGPT continuation URLs', () => {
  assert.equal(
    protocol.resolveTrustedUrl('/authorize/resume', 'https://auth.openai.com/'),
    'https://auth.openai.com/authorize/resume'
  );
  assert.throws(
    () => protocol.resolveTrustedUrl('https://example.com/steal', 'https://auth.openai.com/'),
    /不受信任/
  );
  assert.throws(
    () => protocol.resolveTrustedUrl('http://auth.openai.com/insecure', 'https://auth.openai.com/'),
    /不受信任/
  );
});
