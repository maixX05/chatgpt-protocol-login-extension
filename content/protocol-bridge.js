(function attachChatGptProtocolBridge(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChatGPTProtocolBridge = api;
  }

  if (root?.chrome?.runtime?.onMessage && root?.fetch && root?.location) {
    const bridge = api.createProtocolBridge({
      cryptoImpl: root.crypto,
      fetchImpl: root.fetch.bind(root),
      locationImpl: root.location,
      protocol: root.ChatGPTLoginProtocol,
      totp: root.ChatGPTLoginTotp,
    });
    root.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!String(message?.type || '').startsWith('protocol:')) return false;
      bridge.handleMessage(message)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({
          ok: false,
          error: {
            code: String(error?.code || 'protocol_failed'),
            message: String(error?.message || 'ChatGPT 协议登录失败'),
          },
        }));
      return true;
    });
  }
})(typeof self !== 'undefined' ? self : globalThis, function createProtocolBridgeModule() {
  class BridgeError extends Error {
    constructor(message, code = 'protocol_failed') {
      super(message);
      this.name = 'BridgeError';
      this.code = code;
    }
  }

  function createProtocolBridge(deps = {}) {
    const {
      cryptoImpl = globalThis.crypto,
      delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      fetchImpl = globalThis.fetch?.bind(globalThis),
      locationImpl = globalThis.location,
      now = () => Date.now(),
      protocol = globalThis.ChatGPTLoginProtocol,
      totp = globalThis.ChatGPTLoginTotp,
    } = deps;
    if (!fetchImpl || !locationImpl || !protocol || !totp) {
      throw new Error('ChatGPT 协议执行器缺少运行依赖');
    }

    function currentOrigin() {
      return String(locationImpl.origin || new URL(locationImpl.href).origin);
    }

    function requestId() {
      return cryptoImpl?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    async function requestJson(path, options = {}) {
      const url = new URL(path, currentOrigin());
      if (url.origin !== currentOrigin()) {
        throw new BridgeError('拒绝执行跨域协议请求', 'untrusted_request');
      }
      const headers = {
        Accept: 'application/json',
        ...(options.headers || {}),
      };
      const response = await fetchImpl(url.toString(), {
        cache: 'no-store',
        credentials: 'include',
        redirect: 'follow',
        ...options,
        headers,
      });
      const rawText = await response.text();
      let payload = {};
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new BridgeError(`登录接口返回了无效 JSON（HTTP ${response.status}）`, 'invalid_response');
      }
      if (!response.ok) {
        const detail = String(payload?.message || payload?.error?.message || payload?.error || '').trim();
        throw new BridgeError(
          detail ? `登录接口返回 HTTP ${response.status}：${detail}` : `登录接口返回 HTTP ${response.status}`,
          response.status === 400 || response.status === 401 ? 'credentials_rejected' : 'http_error'
        );
      }
      return payload;
    }

    function authHeaders() {
      return {
        'Content-Type': 'application/json',
        'x-access-flow-invocation-id': requestId(),
      };
    }

    async function authStep(path, body) {
      return requestJson(path, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
    }

    async function beginLogin(message = {}) {
      if (protocol.hostKind(locationImpl.href) !== 'chatgpt') {
        throw new BridgeError('协议登录必须从 ChatGPT 页面开始', 'wrong_origin');
      }
      const email = String(message.email || '').trim().toLowerCase();
      const deviceId = String(message.deviceId || '').trim();
      if (!email || !deviceId) {
        throw new BridgeError('协议登录缺少邮箱或设备标识', 'invalid_input');
      }

      await requestJson('/api/auth/providers');
      const csrf = await requestJson('/api/auth/csrf');
      const csrfToken = String(csrf?.csrfToken || '').trim();
      if (!csrfToken) {
        throw new BridgeError('ChatGPT 登录没有返回 CSRF Token', 'csrf_missing');
      }

      const query = new URLSearchParams({
        prompt: 'login',
        'ext-oai-did': deviceId,
        auth_session_logging_id: requestId(),
        screen_hint: 'login_or_signup',
        login_hint: email,
      });
      const form = new URLSearchParams({
        callbackUrl: 'https://chatgpt.com/',
        csrfToken,
        json: 'true',
      });
      const signIn = await requestJson(`/api/auth/signin/openai?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!signIn?.url) {
        throw new BridgeError('ChatGPT 登录没有返回认证地址', 'auth_url_missing');
      }
      return {
        authUrl: protocol.resolveTrustedUrl(signIn.url, 'https://chatgpt.com/', protocol.AUTH_HOSTS),
      };
    }

    async function authenticate(message = {}) {
      if (String(locationImpl.hostname || '').toLowerCase() !== 'auth.openai.com') {
        const kind = protocol.authPageKind(locationImpl.href);
        if (kind === 'email_otp') {
          throw new BridgeError('本次登录需要邮箱验证码，当前版本未自动处理', 'email_otp_required');
        }
        throw new BridgeError('OpenAI 认证没有进入受支持的密码登录页', 'unsupported_auth_page');
      }
      const pageKind = protocol.authPageKind(locationImpl.href);
      if (pageKind === 'email_otp') {
        throw new BridgeError('本次登录需要邮箱验证码，当前版本未自动处理', 'email_otp_required');
      }
      if (pageKind !== 'password') {
        throw new BridgeError('OpenAI 认证没有进入密码登录页', 'unsupported_auth_page');
      }

      const password = String(message.password || '');
      if (!password) {
        throw new BridgeError('账号密码为空', 'password_missing');
      }
      let payload = await authStep('/api/accounts/password/verify', { password });
      let mfaVerified = false;

      if (protocol.isMfaChallenge(payload)) {
        const factor = protocol.totpFactor(payload);
        if (!factor) {
          throw new BridgeError('账号要求 2FA，但没有可用的 TOTP 验证方式', 'totp_unavailable');
        }
        const secret = String(message.totpSecret || '').trim();
        if (!secret) {
          throw new BridgeError('账号缺少 2FA 密钥', 'totp_missing');
        }
        await authStep('/api/accounts/mfa/issue_challenge', {
          type: 'totp',
          id: factor.id,
          force_fresh_challenge: false,
        });
        const remainingWindowMs = 30_000 - (now() % 30_000);
        if (remainingWindowMs <= 3_000) {
          await delay(remainingWindowMs + 75);
        }
        const code = await totp.generateTotp(secret, {
          cryptoImpl,
          timestamp: now(),
        });
        payload = await authStep('/api/accounts/mfa/verify', {
          type: 'totp',
          id: factor.id,
          code,
        });
        mfaVerified = true;
      }

      if (protocol.isWorkspaceSelection(payload)) {
        const workspaceId = protocol.workspaceId(payload);
        if (!workspaceId) {
          throw new BridgeError('登录响应中没有可选择的工作空间', 'workspace_missing');
        }
        payload = await authStep('/api/accounts/workspace/select', {
          workspace_id: workspaceId,
        });
      }

      const nextUrl = protocol.continueUrl(payload);
      if (!nextUrl) {
        throw new BridgeError('登录响应缺少完成跳转地址', 'continue_url_missing');
      }
      return {
        continueUrl: protocol.resolveTrustedUrl(nextUrl, 'https://auth.openai.com/'),
        mfaVerified,
      };
    }

    async function verifySession(message = {}) {
      if (protocol.hostKind(locationImpl.href) !== 'chatgpt') {
        throw new BridgeError('登录回调没有返回 ChatGPT', 'callback_incomplete');
      }
      const expectedEmail = String(message.email || '').trim().toLowerCase();
      const session = await requestJson('/api/auth/session');
      const email = String(session?.user?.email || '').trim().toLowerCase();
      if (!session?.accessToken || !email) {
        throw new BridgeError('ChatGPT 页面没有有效登录态', 'session_missing');
      }
      if (expectedEmail && email !== expectedEmail) {
        throw new BridgeError(`登录邮箱不匹配，当前为 ${email}`, 'email_mismatch');
      }
      return { email };
    }

    async function handleMessage(message = {}) {
      if (message.type === 'protocol:begin') return beginLogin(message);
      if (message.type === 'protocol:authenticate') return authenticate(message);
      if (message.type === 'protocol:verify') return verifySession(message);
      throw new BridgeError('未知的协议登录命令', 'unknown_command');
    }

    return {
      authenticate,
      beginLogin,
      handleMessage,
      verifySession,
    };
  }

  return {
    BridgeError,
    createProtocolBridge,
  };
});
