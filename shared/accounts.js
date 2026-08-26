(function attachChatGptLoginAccounts(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChatGPTLoginAccounts = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createAccountsModule() {
  const SEPARATOR = '----';
  const MAX_ACCOUNTS = 1000;
  const MAX_PASSWORD_LENGTH = 4096;
  const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
  const MAX_TOTP_SOURCE_LENGTH = 2048;

  function normalizeEmail(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function isValidEmail(value = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
  }

  function normalizeTotpSecret(value = '') {
    let source = String(value || '').trim();
    if (source.length > MAX_TOTP_SOURCE_LENGTH) return '';
    if (/^otpauth:\/\//i.test(source)) {
      try {
        source = new URL(source).searchParams.get('secret') || '';
      } catch {
        return '';
      }
    }
    const normalized = source.replace(/[\s=-]+/g, '').toUpperCase();
    return /^[A-Z2-7]{16,}$/.test(normalized) ? normalized : '';
  }

  function parseAccountLine(rawLine, lineNumber) {
    const line = String(rawLine || '').trim();
    if (!line) return null;
    const pieces = line.split(SEPARATOR);
    if (pieces.length < 3) {
      return { error: { line: lineNumber, reason: '缺少邮箱、密码或 2FA 密钥' } };
    }

    const email = normalizeEmail(pieces.shift());
    const totpSecret = normalizeTotpSecret(pieces.pop());
    const password = pieces.join(SEPARATOR).trim();
    if (!isValidEmail(email)) {
      return { error: { line: lineNumber, reason: '邮箱格式无效' } };
    }
    if (!password) {
      return { error: { line: lineNumber, reason: '密码为空' } };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return { error: { line: lineNumber, reason: '密码长度超过限制' } };
    }
    if (!totpSecret) {
      return { error: { line: lineNumber, reason: '2FA 密钥不是有效的 Base32' } };
    }
    return {
      account: {
        email,
        password,
        totpSecret,
      },
    };
  }

  function parseAccountsText(value = '', options = {}) {
    const limit = Math.max(1, Math.min(MAX_ACCOUNTS, Number(options.limit) || MAX_ACCOUNTS));
    const source = String(value || '');
    if (source.length > MAX_TEXT_LENGTH) {
      throw new Error('导入文本超过 2 MB 限制');
    }
    const lines = source.replace(/\r/g, '').split('\n');
    const byEmail = new Map();
    const errors = [];
    let duplicateCount = 0;

    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].trim()) continue;
      const parsed = parseAccountLine(lines[index], index + 1);
      if (parsed?.error) {
        errors.push(parsed.error);
        continue;
      }
      if (!parsed?.account) continue;
      if (byEmail.has(parsed.account.email)) duplicateCount += 1;
      byEmail.set(parsed.account.email, parsed.account);
      if (byEmail.size > limit) {
        throw new Error(`一次最多导入 ${limit} 个账号`);
      }
    }

    return {
      accounts: [...byEmail.values()],
      errors,
      duplicateCount,
    };
  }

  function publicAccount(account = {}) {
    return {
      email: normalizeEmail(account.email),
      status: String(account.status || 'idle'),
      statusMessage: String(account.statusMessage || ''),
      lastLoginAt: Number(account.lastLoginAt || 0),
      updatedAt: Number(account.updatedAt || 0),
      hasPassword: Boolean(account.password),
      hasTotp: Boolean(account.totpSecret),
    };
  }

  return {
    MAX_ACCOUNTS,
    MAX_PASSWORD_LENGTH,
    MAX_TEXT_LENGTH,
    SEPARATOR,
    isValidEmail,
    normalizeEmail,
    normalizeTotpSecret,
    parseAccountLine,
    parseAccountsText,
    publicAccount,
  };
});
