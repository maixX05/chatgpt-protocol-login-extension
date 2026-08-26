const assert = require('node:assert/strict');
const test = require('node:test');

const accounts = require('../shared/accounts.js');

test('parses email, password and Base32 TOTP records without exposing raw lines in errors', () => {
  const result = accounts.parseAccountsText([
    'user@example.com----Password----JBSWY3DPEHPK3PXP',
    'invalid-line',
  ].join('\n'));

  assert.deepEqual(result.accounts, [{
    email: 'user@example.com',
    password: 'Password',
    totpSecret: 'JBSWY3DPEHPK3PXP',
  }]);
  assert.deepEqual(result.errors, [{ line: 2, reason: '缺少邮箱、密码或 2FA 密钥' }]);
  assert.equal(JSON.stringify(result.errors).includes('Password'), false);
});

test('keeps separators inside passwords and accepts otpauth URIs', () => {
  const result = accounts.parseAccountsText(
    'USER@EXAMPLE.COM----part----part----otpauth://totp/OpenAI?secret=JBSWY3DPEHPK3PXP'
  );

  assert.equal(result.accounts[0].email, 'user@example.com');
  assert.equal(result.accounts[0].password, 'part----part');
  assert.equal(result.accounts[0].totpSecret, 'JBSWY3DPEHPK3PXP');
});

test('deduplicates accounts by normalized email with the last value winning', () => {
  const result = accounts.parseAccountsText([
    'user@example.com----old----JBSWY3DPEHPK3PXP',
    'USER@example.com----new----JBSWY3DPEHPK3PXP',
  ].join('\n'));

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].password, 'new');
  assert.equal(result.duplicateCount, 1);
});

test('rejects oversized imports before parsing credentials', () => {
  assert.throws(
    () => accounts.parseAccountsText('x'.repeat(accounts.MAX_TEXT_LENGTH + 1)),
    /2 MB/
  );
});
