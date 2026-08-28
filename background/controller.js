(function attachChatGptLoginController(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChatGPTLoginController = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createControllerModule() {
  const ACCOUNTS_KEY = 'chatGptProtocolLoginAccounts';
  const TASK_KEY = 'chatGptProtocolLoginTask';
  const TIMEOUT_ALARM = 'chatGptProtocolLoginTimeout';
  const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;
  const CHATGPT_URL = 'https://chatgpt.com/';
  const COOKIE_ORIGINS = Object.freeze([
    'https://chatgpt.com',
    'https://www.chatgpt.com',
    'https://chat.openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
  ]);
  const TERMINAL_STATUSES = new Set(['success', 'error', 'canceled']);

  function createLoginController(deps = {}) {
    const {
      accountsModule = globalThis.ChatGPTLoginAccounts,
      chrome: chromeApi = globalThis.chrome,
      cryptoImpl = globalThis.crypto,
      delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now = () => Date.now(),
    } = deps;
    if (!accountsModule || !chromeApi?.storage?.session) {
      throw new Error('ChatGPT 登录控制器缺少运行依赖');
    }
    const inflightTabs = new Set();

    function taskId() {
      return cryptoImpl?.randomUUID?.() || `${now()}-${Math.random().toString(16).slice(2)}`;
    }

    async function readStorage() {
      return chromeApi.storage.session.get([ACCOUNTS_KEY, TASK_KEY]);
    }

    async function getAccounts() {
      const state = await readStorage();
      return Array.isArray(state[ACCOUNTS_KEY]) ? state[ACCOUNTS_KEY] : [];
    }

    async function setAccounts(accounts) {
      await chromeApi.storage.session.set({ [ACCOUNTS_KEY]: accounts });
    }

    async function getTask() {
      const state = await readStorage();
      const task = state[TASK_KEY];
      return task && typeof task === 'object' ? task : null;
    }

    async function setTask(task) {
      await chromeApi.storage.session.set({ [TASK_KEY]: task });
      chromeApi.runtime?.sendMessage?.({ type: 'state:changed' }).catch?.(() => {});
      return task;
    }

    async function publicState() {
      const [accounts, task] = await Promise.all([getAccounts(), getTask()]);
      return {
        accounts: accounts.map(accountsModule.publicAccount),
        task: task ? {
          taskId: task.taskId,
          email: task.email,
          status: task.status,
          stage: task.stage,
          message: task.message,
          errorCode: task.errorCode || null,
          loggedInEmail: task.loggedInEmail || null,
          mfaVerified: Boolean(task.mfaVerified),
          removedCookies: Number(task.removedCookies || 0),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          finishedAt: task.finishedAt || null,
        } : null,
      };
    }

    async function importAccounts(text) {
      const parsed = accountsModule.parseAccountsText(text);
      const current = await getAccounts();
      const byEmail = new Map(current.map((account) => [account.email, account]));
      let updatedCount = 0;
      for (const account of parsed.accounts) {
        const previous = byEmail.get(account.email);
        if (previous) updatedCount += 1;
        byEmail.set(account.email, {
          ...(previous || {}),
          ...account,
          status: previous?.status === 'running' ? 'idle' : (previous?.status || 'idle'),
          statusMessage: previous?.statusMessage || '',
          updatedAt: now(),
        });
      }
      const accounts = [...byEmail.values()].sort((left, right) => left.email.localeCompare(right.email));
      await setAccounts(accounts);
      return {
        importedCount: parsed.accounts.length - updatedCount,
        updatedCount,
        duplicateCount: parsed.duplicateCount,
        errors: parsed.errors,
        state: await publicState(),
      };
    }

    async function patchAccount(email, updates) {
      const accounts = await getAccounts();
      const normalized = accountsModule.normalizeEmail(email);
      const next = accounts.map((account) => (
        account.email === normalized ? { ...account, ...updates, updatedAt: now() } : account
      ));
      await setAccounts(next);
    }

    async function deleteAccount(email) {
      const task = await getTask();
      const normalized = accountsModule.normalizeEmail(email);
      if (task && !TERMINAL_STATUSES.has(task.status) && task.email === normalized) {
        throw new Error('当前账号正在登录，不能删除');
      }
      const accounts = await getAccounts();
      await setAccounts(accounts.filter((account) => account.email !== normalized));
      return publicState();
    }

    async function clearAccounts() {
      const task = await getTask();
      if (task && !TERMINAL_STATUSES.has(task.status)) {
        throw new Error('协议登录运行中，不能清除导入数据');
      }
      await chromeApi.alarms?.clear?.(TIMEOUT_ALARM);
      await chromeApi.storage.session.remove([ACCOUNTS_KEY, TASK_KEY]);
      await chromeApi.action?.setBadgeText?.({ text: '' });
      chromeApi.runtime?.sendMessage?.({ type: 'state:changed' }).catch?.(() => {});
      return publicState();
    }

    async function cookieStoreIdForTab(tabId) {
      try {
        const stores = await chromeApi.cookies.getAllCookieStores?.() || [];
        return stores.find((store) => store.tabIds?.includes(tabId))?.id;
      } catch {
        return undefined;
      }
    }

    async function clearLoginCookies(storeId) {
      const cookies = new Map();
      for (const origin of COOKIE_ORIGINS) {
        const details = { url: `${origin}/` };
        if (storeId) details.storeId = storeId;
        const batch = await chromeApi.cookies.getAll(details);
        for (const cookie of batch || []) {
          const key = [
            cookie.storeId || storeId || '',
            cookie.domain || '',
            cookie.path || '/',
            cookie.name || '',
            cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
          ].join('|');
          if (!cookies.has(key)) cookies.set(key, { cookie, origin });
        }
      }
      let removedCount = 0;
      for (const { cookie, origin } of cookies.values()) {
        const path = String(cookie.path || '/').startsWith('/') ? String(cookie.path || '/') : '/';
        const details = {
          url: `${origin}${path}`,
          name: cookie.name,
        };
        if (cookie.storeId || storeId) details.storeId = cookie.storeId || storeId;
        if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
        if (await chromeApi.cookies.remove(details)) removedCount += 1;
      }
      return removedCount;
    }

    async function bridge(tabId, message) {
      let lastError = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const response = await chromeApi.tabs.sendMessage(tabId, message);
          if (!response?.ok) {
            const error = new Error(String(response?.error?.message || '同源协议请求失败'));
            error.code = String(response?.error?.code || 'protocol_failed');
            error.protocolResponse = true;
            throw error;
          }
          return response.result || {};
        } catch (error) {
          lastError = error;
          if (error?.protocolResponse) break;
          if (attempt < 9) await delay(250);
        }
      }
      throw lastError || new Error('无法连接 ChatGPT 协议执行器');
    }

    async function finishTask(task, updates) {
      await chromeApi.alarms?.clear?.(TIMEOUT_ALARM);
      const next = await setTask({
        ...task,
        ...updates,
        updatedAt: now(),
        finishedAt: now(),
      });
      if (next.status === 'success') {
        // Credentials are single-use in this extension and must not remain after login succeeds.
        await deleteAccount(next.email);
        await chromeApi.storage.session.remove([TASK_KEY]);
        chromeApi.runtime?.sendMessage?.({ type: 'state:changed' }).catch?.(() => {});
        await chromeApi.action?.setBadgeText?.({ text: 'OK' });
        await chromeApi.action?.setBadgeBackgroundColor?.({ color: '#18794e' });
      } else {
        await patchAccount(next.email, {
          status: next.status,
          statusMessage: next.message,
        });
        await chromeApi.action?.setBadgeText?.({ text: '!' });
        await chromeApi.action?.setBadgeBackgroundColor?.({ color: '#b42318' });
      }
      return next;
    }

    async function failTask(task, error) {
      return finishTask(task, {
        status: 'error',
        stage: 'failed',
        message: String(error?.message || 'ChatGPT 协议登录失败'),
        errorCode: String(error?.code || 'protocol_failed'),
      });
    }

    async function startLogin(email, options = {}) {
      const activeTask = await getTask();
      if (activeTask && !TERMINAL_STATUSES.has(activeTask.status)) {
        throw new Error('已有账号正在登录');
      }
      const normalized = accountsModule.normalizeEmail(email);
      const account = (await getAccounts()).find((item) => item.email === normalized);
      if (!account?.password || !account?.totpSecret) {
        throw new Error('账号缺少密码或 2FA 密钥');
      }

      const requestedTabId = Number(options.tabId);
      const useCurrentTab = Number.isInteger(requestedTabId);
      let tab;
      if (useCurrentTab) {
        tab = await chromeApi.tabs.get(requestedTabId).catch(() => null);
        if (!tab) throw new Error('当前标签页已不存在');
      } else {
        const createProperties = { url: 'about:blank', active: true };
        if (Number.isInteger(Number(options.windowId))) createProperties.windowId = Number(options.windowId);
        tab = await chromeApi.tabs.create(createProperties);
      }
      const storeId = await cookieStoreIdForTab(tab.id);
      const createdAt = now();
      let task = {
        taskId: taskId(),
        email: normalized,
        tabId: tab.id,
        createdTab: !useCurrentTab,
        storeId: storeId || null,
        status: 'running',
        stage: 'clearing_session',
        message: '正在清理当前 ChatGPT 登录态',
        deviceId: taskId(),
        createdAt,
        updatedAt: createdAt,
        deadlineAt: createdAt + LOGIN_TIMEOUT_MS,
      };
      await setTask(task);
      await patchAccount(normalized, { status: 'running', statusMessage: task.message });
      try {
        const removedCookies = await clearLoginCookies(storeId);
        task = await setTask({
          ...task,
          removedCookies,
          stage: 'opening_chatgpt',
          message: '正在建立 ChatGPT 同源登录会话',
          updatedAt: now(),
        });
        await chromeApi.alarms?.create?.(TIMEOUT_ALARM, { when: task.deadlineAt });
        await chromeApi.tabs.update(tab.id, { url: CHATGPT_URL, active: true });
        return task;
      } catch (error) {
        await failTask(task, error);
        throw error;
      }
    }

    async function advance(tabId, providedTab = null) {
      if (inflightTabs.has(tabId)) return;
      inflightTabs.add(tabId);
      try {
        let task = await getTask();
        if (!task || task.tabId !== tabId || TERMINAL_STATUSES.has(task.status)) return;
        if (task.deadlineAt <= now()) {
          await failTask(task, new Error('ChatGPT 协议登录超时'));
          return;
        }
        const tab = providedTab || await chromeApi.tabs.get(tabId);
        const url = String(tab?.url || '');
        const protocol = deps.protocol || globalThis.ChatGPTLoginProtocol;
        const hostKind = protocol?.hostKind?.(url) || 'unknown';
        const accounts = await getAccounts();
        const account = accounts.find((item) => item.email === task.email);
        if (!account) {
          await failTask(task, new Error('登录账号已经不存在'));
          return;
        }

        if (task.stage === 'opening_chatgpt') {
          if (hostKind !== 'chatgpt') return;
          const result = await bridge(tabId, {
            type: 'protocol:begin',
            email: account.email,
            deviceId: task.deviceId,
          });
          task = await setTask({
            ...task,
            stage: 'opening_auth',
            message: '正在进入 OpenAI 密码认证',
            updatedAt: now(),
          });
          await chromeApi.tabs.update(tabId, { url: result.authUrl });
          return;
        }

        if (task.stage === 'opening_auth') {
          if (hostKind !== 'auth') return;
          task = await setTask({
            ...task,
            stage: 'authenticating',
            message: '正在验证密码和 2FA',
            updatedAt: now(),
          });
          const result = await bridge(tabId, {
            type: 'protocol:authenticate',
            password: account.password,
            totpSecret: account.totpSecret,
          });
          task = await setTask({
            ...task,
            stage: 'finishing_callback',
            message: '正在完成 ChatGPT 登录回调',
            mfaVerified: Boolean(result.mfaVerified),
            updatedAt: now(),
          });
          await chromeApi.tabs.update(tabId, { url: result.continueUrl });
          return;
        }

        if (task.stage === 'finishing_callback') {
          if (hostKind !== 'chatgpt') return;
          const result = await bridge(tabId, {
            type: 'protocol:verify',
            email: account.email,
          });
          await finishTask(task, {
            status: 'success',
            stage: 'completed',
            message: `已登录 ${result.email}`,
            loggedInEmail: result.email,
          });
        }
      } catch (error) {
        const task = await getTask();
        if (task && task.tabId === tabId && !TERMINAL_STATUSES.has(task.status)) {
          await failTask(task, error);
        }
      } finally {
        inflightTabs.delete(tabId);
      }
    }

    async function handleTabUpdated(tabId, changeInfo = {}, tab = null) {
      if (changeInfo.status !== 'complete') return;
      await advance(tabId, tab);
    }

    async function handleTabRemoved(tabId) {
      const task = await getTask();
      if (task?.tabId === tabId && !TERMINAL_STATUSES.has(task.status)) {
        await finishTask(task, {
          status: 'canceled',
          stage: 'canceled',
          message: '登录标签页已关闭',
        });
      }
    }

    async function cancelLogin() {
      const task = await getTask();
      if (!task || TERMINAL_STATUSES.has(task.status)) return publicState();
      await finishTask(task, {
        status: 'canceled',
        stage: 'canceled',
        message: '已停止登录',
      });
      if (task.createdTab) {
        await chromeApi.tabs.remove(task.tabId).catch(() => {});
      }
      return publicState();
    }

    async function handleAlarm(alarm) {
      if (alarm?.name !== TIMEOUT_ALARM) return;
      const task = await getTask();
      if (task && !TERMINAL_STATUSES.has(task.status)) {
        await failTask(task, new Error('ChatGPT 协议登录超时'));
      }
    }

    async function resume() {
      const task = await getTask();
      if (!task || TERMINAL_STATUSES.has(task.status)) return;
      const tab = await chromeApi.tabs.get(task.tabId).catch(() => null);
      if (!tab) {
        await finishTask(task, {
          status: 'canceled',
          stage: 'canceled',
          message: '登录标签页已不存在',
        });
        return;
      }
      if (tab.status === 'complete') await advance(task.tabId, tab);
    }

    async function handleMessage(message = {}, sender = {}) {
      if (message.type === 'state:get') return { state: await publicState() };
      if (message.type === 'accounts:import') return importAccounts(message.text);
      if (message.type === 'accounts:delete') return { state: await deleteAccount(message.email) };
      if (message.type === 'accounts:clear') return { state: await clearAccounts() };
      if (message.type === 'login:start') {
        const task = await startLogin(message.email, {
          tabId: message.tabId ?? sender?.tab?.id,
          windowId: message.windowId ?? sender?.tab?.windowId,
        });
        return { task, state: await publicState() };
      }
      if (message.type === 'login:cancel') return { state: await cancelLogin() };
      throw new Error('未知的插件命令');
    }

    return {
      advance,
      cancelLogin,
      clearAccounts,
      clearLoginCookies,
      deleteAccount,
      handleAlarm,
      handleMessage,
      handleTabRemoved,
      handleTabUpdated,
      importAccounts,
      publicState,
      resume,
      startLogin,
    };
  }

  return {
    ACCOUNTS_KEY,
    CHATGPT_URL,
    COOKIE_ORIGINS,
    LOGIN_TIMEOUT_MS,
    TASK_KEY,
    TIMEOUT_ALARM,
    createLoginController,
  };
});
