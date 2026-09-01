importScripts(
  'shared/accounts.js',
  'shared/protocol.js',
  'background/controller.js'
);

const controller = self.ChatGPTLoginController.createLoginController({
  accountsModule: self.ChatGPTLoginAccounts,
  chrome,
  cryptoImpl: self.crypto,
  protocol: self.ChatGPTLoginProtocol,
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error('Failed to configure ChatGPT Protocol Login side panel:', error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (![
    'state:get',
    'accounts:import',
    'accounts:delete',
    'accounts:clear',
    'login:start',
    'login:cancel',
    'login:logs:clear',
    'login:progress',
  ].includes(String(message?.type || ''))) {
    return false;
  }
  controller.handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({
      ok: false,
      error: String(error?.message || '插件操作失败'),
    }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void controller.handleTabUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void controller.handleTabRemoved(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void controller.handleAlarm(alarm);
});

void controller.resume();
