(function attachChatGptLoginProtocol(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChatGPTLoginProtocol = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createProtocolModule() {
  const CHATGPT_HOSTS = Object.freeze(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);
  const AUTH_HOSTS = Object.freeze(['auth.openai.com', 'auth0.openai.com', 'accounts.openai.com']);
  const TRUSTED_HOSTS = Object.freeze([...CHATGPT_HOSTS, ...AUTH_HOSTS]);

  function pageType(payload = {}) {
    return payload?.page && typeof payload.page === 'object'
      ? String(payload.page.type || '')
      : '';
  }

  function continueUrl(payload = {}) {
    if (typeof payload?.continue_url === 'string' && payload.continue_url.trim()) {
      return payload.continue_url.trim();
    }
    const value = payload?.page?.payload?.url;
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  function pathOf(value = '') {
    try {
      return new URL(String(value), 'https://auth.openai.com').pathname;
    } catch {
      return '';
    }
  }

  function isMfaChallenge(payload = {}) {
    return pageType(payload) === 'mfa_challenge'
      || pathOf(continueUrl(payload)).startsWith('/mfa-challenge/');
  }

  function totpFactor(payload = {}) {
    const session = payload?.['oai-client-auth-session'];
    if (!session || typeof session !== 'object') return null;
    const factors = [
      ...(Array.isArray(session.mfa_challenge_factors) ? session.mfa_challenge_factors : []),
      ...(Array.isArray(session.mfa_factors) ? session.mfa_factors : []),
    ];
    return factors.find((factor) => (
      factor && factor.factor_type === 'totp' && typeof factor.id === 'string' && factor.id
    )) || null;
  }

  function isWorkspaceSelection(payload = {}) {
    return pageType(payload) === 'workspace' || pathOf(continueUrl(payload)) === '/workspace';
  }

  function workspaceId(payload = {}) {
    const workspaces = payload?.['oai-client-auth-session']?.workspaces;
    if (!Array.isArray(workspaces)) return '';
    const workspace = workspaces.find((item) => item && typeof item.id === 'string' && item.id);
    return workspace?.id || '';
  }

  function resolveTrustedUrl(value, baseUrl, allowedHosts = TRUSTED_HOSTS) {
    let parsed;
    try {
      parsed = new URL(String(value || ''), baseUrl);
    } catch {
      throw new Error('登录接口返回了无效跳转地址');
    }
    if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
      throw new Error('登录接口返回了不受信任的跳转地址');
    }
    return parsed.toString();
  }

  function authPageKind(value = '') {
    let parsed;
    try {
      parsed = new URL(String(value));
    } catch {
      return 'unknown';
    }
    if (!AUTH_HOSTS.includes(parsed.hostname.toLowerCase())) return 'unknown';
    if (/^\/log-in\/password\/?$/i.test(parsed.pathname)) return 'password';
    if (/^\/email-verification\/?$/i.test(parsed.pathname)) return 'email_otp';
    if (/^\/mfa-challenge(?:\/|$)/i.test(parsed.pathname)) return 'mfa';
    return 'unknown';
  }

  function hostKind(value = '') {
    try {
      const host = new URL(String(value)).hostname.toLowerCase();
      if (CHATGPT_HOSTS.includes(host)) return 'chatgpt';
      if (AUTH_HOSTS.includes(host)) return 'auth';
    } catch {
      return 'unknown';
    }
    return 'unknown';
  }

  return {
    AUTH_HOSTS,
    CHATGPT_HOSTS,
    TRUSTED_HOSTS,
    authPageKind,
    continueUrl,
    hostKind,
    isMfaChallenge,
    isWorkspaceSelection,
    pageType,
    resolveTrustedUrl,
    totpFactor,
    workspaceId,
  };
});
