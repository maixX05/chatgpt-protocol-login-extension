const elements = {
  accountCount: document.getElementById('account-count'),
  accountFile: document.getElementById('account-file'),
  accountList: document.getElementById('account-list'),
  accountSearch: document.getElementById('account-search'),
  accountText: document.getElementById('account-text'),
  cancelLogin: document.getElementById('cancel-login'),
  clearAccounts: document.getElementById('clear-accounts'),
  emptyState: document.getElementById('empty-state'),
  globalMessage: document.getElementById('global-message'),
  hideImport: document.getElementById('hide-import'),
  importAccounts: document.getElementById('import-accounts'),
  importErrors: document.getElementById('import-errors'),
  importPanel: document.getElementById('import-panel'),
  showImport: document.getElementById('show-import'),
  taskEmail: document.getElementById('task-email'),
  taskMessage: document.getElementById('task-message'),
  taskPanel: document.getElementById('task-panel'),
  taskStatus: document.getElementById('task-status'),
};

let currentState = { accounts: [], task: null };
let refreshing = false;

function taskRunning(task) {
  return Boolean(task && task.status === 'running');
}

function statusLabel(status) {
  return ({
    running: '运行中',
    success: '完成',
    error: '失败',
    canceled: '已停止',
  })[status] || '待登录';
}

function accountStatus(account) {
  if (account.status === 'success' && account.lastLoginAt) {
    return `上次登录 ${new Date(account.lastLoginAt).toLocaleString('zh-CN', { hour12: false })}`;
  }
  return account.statusMessage || statusLabel(account.status);
}

async function send(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error('请通过浏览器扩展按钮打开');
  }
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(String(response?.error || '插件操作失败'));
  return response;
}

function createButton(label, className, handler, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${className}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', handler);
  return button;
}

function renderAccounts(accounts, task) {
  elements.accountList.replaceChildren();
  elements.accountCount.textContent = String(accounts.length);
  const search = String(elements.accountSearch.value || '').trim().toLowerCase();
  const visibleAccounts = search
    ? accounts.filter((account) => account.email.includes(search))
    : accounts;
  elements.emptyState.hidden = visibleAccounts.length > 0;
  elements.emptyState.querySelector('strong').textContent = accounts.length ? '没有匹配账号' : '暂无账号';
  const running = taskRunning(task);
  for (const account of visibleAccounts) {
    const item = document.createElement('li');
    item.className = 'account-row';

    const copy = document.createElement('div');
    copy.className = 'account-copy';
    const email = document.createElement('strong');
    email.className = 'account-email';
    email.textContent = account.email;
    const meta = document.createElement('span');
    meta.className = 'account-meta';
    meta.textContent = accountStatus(account);
    copy.append(email, meta);

    const actions = document.createElement('div');
    actions.className = 'account-actions';
    actions.append(
      createButton('登录', 'button-primary', () => void startLogin(account.email), running),
      createButton('删除', 'button-danger', () => void deleteAccount(account.email), running)
    );
    item.append(copy, actions);
    elements.accountList.append(item);
  }
}

function renderTask(task) {
  elements.taskPanel.hidden = !task;
  if (!task) return;
  elements.taskPanel.dataset.status = task.status || '';
  elements.taskStatus.textContent = statusLabel(task.status);
  elements.taskEmail.textContent = task.email || '';
  elements.taskMessage.textContent = task.message || '';
  elements.cancelLogin.hidden = !taskRunning(task);
}

function render(state) {
  currentState = state || { accounts: [], task: null };
  renderAccounts(currentState.accounts || [], currentState.task);
  renderTask(currentState.task);
  const running = taskRunning(currentState.task);
  elements.clearAccounts.disabled = running || !(currentState.accounts || []).length;
  elements.showImport.disabled = running;
}

function setMessage(message, isError = false) {
  elements.globalMessage.textContent = String(message || '');
  elements.globalMessage.style.color = isError ? 'var(--danger)' : '';
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await send({ type: 'state:get' });
    render(response.state);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    refreshing = false;
  }
}

async function currentWindowId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return Number.isInteger(tabs?.[0]?.windowId) ? tabs[0].windowId : undefined;
}

async function startLogin(email) {
  if (!confirm(`将清理当前 ChatGPT 登录态并登录 ${email}，是否继续？`)) return;
  setMessage('正在启动登录...');
  try {
    const response = await send({
      type: 'login:start',
      email,
      windowId: await currentWindowId(),
    });
    render(response.state);
    window.close();
  } catch (error) {
    setMessage(error.message, true);
    await refresh();
  }
}

async function deleteAccount(email) {
  try {
    const response = await send({ type: 'accounts:delete', email });
    render(response.state);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function submitImport() {
  elements.importErrors.hidden = true;
  const text = elements.accountText.value;
  if (!text.trim()) {
    elements.importErrors.textContent = '没有可导入的账号';
    elements.importErrors.hidden = false;
    return;
  }
  elements.importAccounts.disabled = true;
  try {
    const response = await send({ type: 'accounts:import', text });
    render(response.state);
    const summary = `新增 ${response.importedCount}，更新 ${response.updatedCount}`;
    setMessage(summary);
    if (response.errors?.length) {
      elements.importErrors.textContent = response.errors
        .map((item) => `第 ${item.line} 行：${item.reason}`)
        .join('；');
      elements.importErrors.hidden = false;
    } else {
      elements.importPanel.hidden = true;
      elements.accountText.value = '';
      elements.accountFile.value = '';
    }
  } catch (error) {
    elements.importErrors.textContent = error.message;
    elements.importErrors.hidden = false;
  } finally {
    elements.importAccounts.disabled = false;
  }
}

elements.showImport.addEventListener('click', () => {
  elements.importPanel.hidden = false;
  elements.accountText.focus();
});

elements.hideImport.addEventListener('click', () => {
  elements.importPanel.hidden = true;
  elements.importErrors.hidden = true;
});

elements.accountFile.addEventListener('change', async () => {
  const file = elements.accountFile.files?.[0];
  if (file) elements.accountText.value = await file.text();
});

elements.importAccounts.addEventListener('click', () => void submitImport());

elements.accountSearch.addEventListener('input', () => {
  renderAccounts(currentState.accounts || [], currentState.task);
});

elements.clearAccounts.addEventListener('click', async () => {
  if (!confirm('确认清空当前浏览器会话中的全部账号？')) return;
  try {
    const response = await send({ type: 'accounts:clear' });
    render(response.state);
    setMessage('账号已清空');
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.cancelLogin.addEventListener('click', async () => {
  try {
    const response = await send({ type: 'login:cancel' });
    render(response.state);
  } catch (error) {
    setMessage(error.message, true);
  }
});

globalThis.chrome?.runtime?.onMessage?.addListener((message) => {
  if (message?.type === 'state:changed') void refresh();
});

void refresh();
setInterval(() => void refresh(), 1000);
