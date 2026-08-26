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
  return { bridgeResponses, chrome, messages, tabs };
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
  assert.equal(state.task.loggedInEmail, 'user@example.com');
  assert.equal(state.accounts[0].status, 'success');
  assert.equal(Object.hasOwn(state.task, 'deviceId'), false);
  assert.equal(Object.hasOwn(state.task, 'storeId'), false);
  assert.equal(Object.hasOwn(state.accounts[0], 'password'), false);
  assert.equal(Object.hasOwn(state.accounts[0], 'totpSecret'), false);
  assert.equal(JSON.stringify(state).includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(mock.messages[1].password, 'Password');
  assert.equal(mock.messages[1].totpSecret, 'JBSWY3DPEHPK3PXP');
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
