(function attachChatGptLoginTotp(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChatGPTLoginTotp = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createTotpModule() {
  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function normalizeSecret(value = '') {
    const normalized = String(value || '').replace(/[\s=-]+/g, '').toUpperCase();
    if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
      throw new Error('2FA 密钥不是有效的 Base32');
    }
    return normalized;
  }

  function decodeBase32(value = '') {
    const secret = normalizeSecret(value);
    let buffer = 0;
    let bits = 0;
    const output = [];
    for (const character of secret) {
      buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        output.push((buffer >>> bits) & 0xff);
      }
    }
    return new Uint8Array(output);
  }

  function counterBytes(counter) {
    let value = BigInt(counter);
    const output = new Uint8Array(8);
    for (let index = output.length - 1; index >= 0; index -= 1) {
      output[index] = Number(value & 0xffn);
      value >>= 8n;
    }
    return output;
  }

  async function generateTotp(secret, options = {}) {
    const cryptoImpl = options.cryptoImpl || globalThis.crypto;
    if (!cryptoImpl?.subtle) {
      throw new Error('当前浏览器不支持 Web Crypto');
    }
    const timestamp = Number(options.timestamp ?? Date.now());
    const stepSeconds = Math.max(1, Number(options.stepSeconds) || 30);
    const digits = Math.max(6, Math.min(8, Number(options.digits) || 6));
    const counter = Math.floor(timestamp / 1000 / stepSeconds);
    const key = await cryptoImpl.subtle.importKey(
      'raw',
      decodeBase32(secret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const digest = new Uint8Array(await cryptoImpl.subtle.sign('HMAC', key, counterBytes(counter)));
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (
      ((digest[offset] & 0x7f) << 24)
      | ((digest[offset + 1] & 0xff) << 16)
      | ((digest[offset + 2] & 0xff) << 8)
      | (digest[offset + 3] & 0xff)
    ) >>> 0;
    return String(binary % (10 ** digits)).padStart(digits, '0');
  }

  return {
    decodeBase32,
    generateTotp,
    normalizeSecret,
  };
});
