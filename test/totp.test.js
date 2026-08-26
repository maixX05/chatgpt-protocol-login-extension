const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const totp = require('../shared/totp.js');

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('generates RFC 6238 SHA-1 vectors', async () => {
  assert.equal(await totp.generateTotp(RFC_SECRET, {
    cryptoImpl: webcrypto,
    digits: 8,
    timestamp: 59_000,
  }), '94287082');
  assert.equal(await totp.generateTotp(RFC_SECRET, {
    cryptoImpl: webcrypto,
    digits: 8,
    timestamp: 1_111_111_109_000,
  }), '07081804');
});

test('rejects malformed Base32 secrets', async () => {
  await assert.rejects(
    totp.generateTotp('not-valid-0189', { cryptoImpl: webcrypto }),
    /Base32/
  );
});
