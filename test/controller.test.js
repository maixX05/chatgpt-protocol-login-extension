const assert = require('node:assert/strict');
const test = require('node:test');

const accountsModule = require('../shared/accounts.js');
const protocol = require('../shared/protocol.js');
const { createLoginController } = require('../background/controller.js');

function createChromeMock() {
  const storage = {};
  const tabs = new Map();
  const messages = [];
  let nextTabId = 7;
  const bridgeResponses = [];
  const chrome = {
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
    },
    alarms: {
      clear: async () => true,
      create: async () => {},
    },
    cookies: {
      getAll: async () => [],
      getAllCookieStores: async () => [{ id: 'store-1', tabIds: [...tabs.keys(), nextTabId] }],
      remove: async () => null,
    },
    runtime: {
      sendMessage: async () => {},
    },
    storage: {
      session: {
        get: async (keys) => Object.fromEntries(keys.map((key) => [key, storage[key]])),
        remove: async (keys) => keys.forEach((key) => delete storage[key]),
        set: async (updates) => Object.assign(storage, updates),
      },
    },
    tabs: {
      create: async (properties) => {
        const tab = { id: nextTabId++, status: 'complete', url: properties.url, windowId: 1 };
        tabs.set(tab.id, tab);
        return tab;
      },
      get: async (tabId) => tabs.get(tabId),
      remove: async (tabId) => tabs.delete(tabId),
      sendMessage: async (_tabId, message) => {
        messages.push(message);
        const queued = bridgeResponses.shift();
        return queued?.rawResponse || { ok: true, result: queued };
      },
      update: async (tabId, updates) => {
        const tab = { ...tabs.get(tabId), ...updates, status: 'complete' };
        tabs.set(tabId, tab);
        return tab;
      },
    },
  };
  return { bridgeResponses, chrome, messages, storage, tabs };
}

test('orchestrates ChatGPT, auth and callback stages without returning credentials', async () => {
  const mock = createChromeMock();
  const controller = createLoginController({
    accountsModule,
    chrome: mock.chrome,
    delay: async () => {},
    now: (() => {
      let value = 1_000;
      return () => value += 10;
    })(),
    protocol,
  });
  await controller.importAccounts('user@example.com----Password----JBSWY3DPEHPK3PXP');
  const started = await controller.startLogin('user@example.com', { windowId: 1 });
  const tabId = started.tabId;

  mock.bridgeResponses.push({ authUrl: 'https://auth.openai.com/log-in/password' });
  await controller.handleTabUpdated(tabId, { status: 'complete' }, {
    id: tabId,
    status: 'complete',
    url: 'https://chatgpt.com/',
  });

  mock.bridgeResponses.push({
    continueUrl: 'https://auth.openai.com/authorize/resume',
    mfaVerified: true,
  });
  await controller.handleTabUpdated(tabId, { status: 'complete' }, {
    id: tabId,
    status: 'complete',
    url: 'https://auth.openai.com/log-in/password',
  });

  mock.bridgeResponses.push({ email: 'user@example.com' });
  await controller.handleTabUpdated(tabId, { status: 'complete' }, {
    id: tabId,
    status: 'complete',
    url: 'https://chatgpt.com/',
  });

  const state = await controller.publicState();
  assert.equal(state.task.status, 'success');
  assert.equal(state.task.stage, 'completed');
  assert.deepEqual(state.task.logs.map((entry) => entry.stage), [
    'clearing_session',
    'opening_chatgpt',
    'opening_auth',
    'authenticating',
    'finishing_callback',
    'completed',
  ]);
  assert.deepEqual(state.accounts, []);
  assert.equal(JSON.stringify(state).includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(JSON.stringify(mock.storage).includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(JSON.stringify(mock.storage).includes('Password'), false);
  assert.equal(mock.messages[1].password, 'Password');
  assert.equal(mock.messages[1].totpSecret, 'JBSWY3DPEHPK3PXP');
});

test('clears imported data and task metadata without touching login cookies', async () => {
  const mock = createChromeMock();
  let cookieReads = 0;
  mock.chrome.cookies.getAll = async () => {
    cookieReads += 1;
    return [];
  };
  const controller = createLoginController({
    accountsModule,
    chrome: mock.chrome,
    now: () => 10_000,
    protocol,
  });
  await controller.importAccounts('user@example.com----Password----JBSWY3DPEHPK3PXP');
  await controller.startLogin('user@example.com');
  await controller.cancelLogin();
  const cookieReadsBeforeClear = cookieReads;

  const state = await controller.clearAccounts();

  assert.deepEqual(state, { accounts: [], task: null });
  assert.deepEqual(mock.storage, {});
  assert.equal(cookieReads, cookieReadsBeforeClear);
});

test('reuses the selected tab and does not close it when login is canceled', async () => {
  const mock = createChromeMock();
  mock.tabs.set(42, {
    id: 42,
    status: 'complete',
    url: 'https://example.com/',
    windowId: 3,
  });
  const controller = createLoginController({
    accountsModule,
    chrome: mock.chrome,
    now: () => 10_000,
    protocol,
  });
  await controller.importAccounts('user@example.com----Password----JBSWY3DPEHPK3PXP');

  const task = await controller.startLogin('user@example.com', { tabId: 42, windowId: 3 });

  assert.equal(task.tabId, 42);
  assert.equal(task.createdTab, false);
  assert.equal(mock.tabs.size, 1);
  assert.equal(mock.tabs.get(42).url, 'https://chatgpt.com/');

  await controller.cancelLogin();
  assert.equal(mock.tabs.has(42), true);
});

test('does not replay credentials after an explicit protocol rejection', async () => {
  const mock = createChromeMock();
  const controller = createLoginController({
    accountsModule,
    chrome: mock.chrome,
    delay: async () => {},
    now: () => 10_000,
    protocol,
  });
  await controller.importAccounts('user@example.com----Password----JBSWY3DPEHPK3PXP');
  const started = await controller.startLogin('user@example.com');

  mock.bridgeResponses.push({ authUrl: 'https://auth.openai.com/log-in/password' });
  await controller.handleTabUpdated(started.tabId, { status: 'complete' }, {
    id: started.tabId,
    status: 'complete',
    url: 'https://chatgpt.com/',
  });
  mock.bridgeResponses.push({
    rawResponse: {
      ok: false,
      error: { code: 'credentials_rejected', message: '密码验证失败' },
    },
  });
  await controller.handleTabUpdated(started.tabId, { status: 'complete' }, {
    id: started.tabId,
    status: 'complete',
    url: 'https://auth.openai.com/log-in/password',
  });

  const state = await controller.publicState();
  assert.equal(state.task.status, 'error');
  assert.equal(state.task.errorCode, 'credentials_rejected');
  assert.equal(mock.messages.filter((message) => message.type === 'protocol:authenticate').length, 1);
});

test('records allow-listed progress from the active login tab without accepting arbitrary log text', async () => {
  const mock = createChromeMock();
  const controller = createLoginController({
    accountsModule,
    chrome: mock.chrome,
    now: () => 10_000,
    protocol,
  });
  await controller.importAccounts('user@example.com----Password----JBSWY3DPEHPK3PXP');
  const task = await controller.startLogin('user@example.com');

  await controller.recordProgress({
    taskId: task.taskId,
    stage: 'password_verified',
    message: 'Password JBSWY3DPEHPK3PXP',
  }, { tab: { id: task.tabId } });

  const state = await controller.publicState();
  assert.equal(state.task.stage, 'password_verified');
  assert.equal(state.task.message, '账号密码验证通过');
  assert.equal(mock.storage.chatGptProtocolLoginTask.stage, 'opening_chatgpt');
  assert.equal(mock.storage.chatGptProtocolLoginTask.progressStage, 'password_verified');
  assert.equal(JSON.stringify(state.task.logs).includes('JBSWY3DPEHPK3PXP'), false);
  await assert.rejects(
    controller.recordProgress({ taskId: task.taskId, stage: 'totp_verified' }, { tab: { id: 999 } }),
    /来源标签页不匹配/
  );
  await assert.rejects(
    controller.recordProgress({ taskId: task.taskId, stage: 'custom_log' }, { tab: { id: task.tabId } }),
    /未知的登录进度阶段/
  );

  const cleared = await controller.clearTaskLogs();
  assert.deepEqual(cleared.task.logs, []);
  assert.equal(cleared.task.stage, 'password_verified');
});

test('caps persisted task logs at 200 entries', async () => {
  const mock = createChromeMock();
  let timestamp = 20_000;
  const controller = createLoginController({
    accountsModule,
    chrome: mock.chrome,
    now: () => timestamp += 1,
    protocol,
  });
  await controller.importAccounts('user@example.com----Password----JBSWY3DPEHPK3PXP');
  const task = await controller.startLogin('user@example.com');

  for (let index = 0; index < 205; index += 1) {
    await controller.recordProgress({
      taskId: task.taskId,
      stage: index % 2 ? 'password_verified' : 'password_verifying',
    }, { tab: { id: task.tabId } });
  }

  const state = await controller.publicState();
  assert.equal(state.task.logs.length, 200);
  assert.equal(mock.storage.chatGptProtocolLoginTask.logs.length, 200);
});
