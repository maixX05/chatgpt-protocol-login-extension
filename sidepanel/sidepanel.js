const STEP_DEFINITIONS = Object.freeze([
  {
    key: 'session',
    title: '清理登录态',
    stages: ['clearing_session'],
  },
  {
    key: 'authorization',
    title: '建立认证会话',
    stages: ['opening_chatgpt', 'opening_auth'],
  },
  {
    key: 'password',
    title: '验证账号密码',
    stages: ['authenticating', 'password_verifying', 'password_verified'],
  },
  {
    key: 'totp',
    title: '验证 2FA',
    stages: ['totp_challenge', 'totp_verified', 'totp_skipped'],
  },
  {
    key: 'workspace',
    title: '选择工作空间',
    stages: ['workspace_selecting', 'workspace_selected', 'workspace_skipped'],
  },
  {
    key: 'callback',
    title: '完成登录回调',
    stages: ['authorization_ready', 'finishing_callback', 'completed'],
  },
]);

const STAGE_TO_STEP = new Map();
for (const [index, step] of STEP_DEFINITIONS.entries()) {
  for (const stage of step.stages) STAGE_TO_STEP.set(stage, index);
}

const elements = {
  accountCount: document.getElementById('account-count'),
  accountFile: document.getElementById('account-file'),
  accountList: document.getElementById('account-list'),
  accountSearch: document.getElementById('account-search'),
  accountText: document.getElementById('account-text'),
  accountsTab: document.getElementById('accounts-tab'),
  accountsView: document.getElementById('accounts-view'),
  cancelLogin: document.getElementById('cancel-login'),
  clearAccounts: document.getElementById('clear-accounts'),
  clearLogs: document.getElementById('clear-logs'),
  emptyState: document.getElementById('empty-state'),
  globalMessage: document.getElementById('global-message'),
  hideImport: document.getElementById('hide-import'),
  importAccounts: document.getElementById('import-accounts'),
  importErrors: document.getElementById('import-errors'),
  importPanel: document.getElementById('import-panel'),
  logCount: document.getElementById('log-count'),
  logList: document.getElementById('log-list'),
  logsSection: document.getElementById('logs-section'),
  openAccounts: document.getElementById('open-accounts'),
  runTab: document.getElementById('run-tab'),
  runView: document.getElementById('run-view'),
  showImport: document.getElementById('show-import'),
  stepList: document.getElementById('step-list'),
  stepsProgress: document.getElementById('steps-progress'),
  stepsSection: document.getElementById('steps-section'),
  taskEmail: document.getElementById('task-email'),
  taskEmpty: document.getElementById('task-empty'),
  taskMessage: document.getElementById('task-message'),
  taskPanel: document.getElementById('task-panel'),
  taskStatus: document.getElementById('task-status'),
  taskUpdated: document.getElementById('task-updated'),
};

let activeView = 'accounts';
let currentState = { accounts: [], task: null };
let initialized = false;
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

function formatTime(timestamp, includeDate = false) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return new Date(numeric).toLocaleString('zh-CN', {
    hour12: false,
    ...(includeDate ? {} : {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  });
}

async function send(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error('请通过浏览器扩展按钮打开');
  }
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(String(response?.error || '插件操作失败'));
  return response;
}

function activateView(view) {
  activeView = view === 'run' ? 'run' : 'accounts';
  const showingRun = activeView === 'run';
  elements.runTab.setAttribute('aria-selected', String(showingRun));
  elements.accountsTab.setAttribute('aria-selected', String(!showingRun));
  elements.runView.hidden = !showingRun;
  elements.accountsView.hidden = showingRun;
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

function currentStepIndex(task) {
  if (!task) return -1;
  if (STAGE_TO_STEP.has(task.stage)) return STAGE_TO_STEP.get(task.stage);
  const logs = Array.isArray(task.logs) ? task.logs : [];
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (STAGE_TO_STEP.has(logs[index]?.stage)) return STAGE_TO_STEP.get(logs[index].stage);
  }
  return 0;
}

function stepState(task, stepIndex, currentIndex) {
  if (task?.status === 'success') return 'complete';
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex > currentIndex) return 'pending';
  if (task?.status === 'error') return 'error';
  if (task?.status === 'canceled') return 'canceled';
  return 'active';
}

function stepStateLabel(state) {
  return ({
    active: '进行中',
    complete: '已完成',
    error: '失败',
    canceled: '已停止',
    pending: '等待',
  })[state] || '等待';
}

function renderSteps(task) {
  elements.stepList.replaceChildren();
  const currentIndex = currentStepIndex(task);
  const completedCount = task?.status === 'success'
    ? STEP_DEFINITIONS.length
    : Math.max(0, currentIndex);
  elements.stepsProgress.textContent = `${completedCount} / ${STEP_DEFINITIONS.length}`;

  for (const [index, step] of STEP_DEFINITIONS.entries()) {
    const state = stepState(task, index, currentIndex);
    const item = document.createElement('li');
    item.className = 'step-item';
    item.dataset.state = state;

    const marker = document.createElement('span');
    marker.className = 'step-marker';
    marker.textContent = state === 'complete' ? '✓' : String(index + 1);
    marker.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('div');
    copy.className = 'step-copy';
    const title = document.createElement('strong');
    title.className = 'step-title';
    title.textContent = step.title;
    const stateText = document.createElement('span');
    stateText.className = 'step-state';
    stateText.textContent = stepStateLabel(state);
    copy.append(title, stateText);

    item.append(marker, copy);
    elements.stepList.append(item);
  }
}

function logStepLabel(stage) {
  const stepIndex = STAGE_TO_STEP.get(String(stage || ''));
  return Number.isInteger(stepIndex) ? STEP_DEFINITIONS[stepIndex].title : '任务';
}

function renderLogs(logs) {
  const entries = Array.isArray(logs) ? logs : [];
  const distanceFromBottom = elements.logList.scrollHeight
    - elements.logList.scrollTop
    - elements.logList.clientHeight;
  const keepAtBottom = distanceFromBottom < 48;
  elements.logList.replaceChildren();
  elements.logCount.textContent = `${entries.length} 条`;
  elements.clearLogs.disabled = entries.length === 0;

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = '暂无日志';
    elements.logList.append(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.dataset.level = String(entry.level || 'info');

    const time = document.createElement('time');
    time.className = 'log-time';
    time.textContent = formatTime(entry.timestamp);

    const dot = document.createElement('span');
    dot.className = 'log-dot';
    dot.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('div');
    copy.className = 'log-copy';
    const stage = document.createElement('span');
    stage.className = 'log-step';
    stage.textContent = logStepLabel(entry.stage);
    const message = document.createElement('span');
    message.className = 'log-message';
    message.textContent = String(entry.message || '');
    copy.append(stage, message);

    row.append(time, dot, copy);
    elements.logList.append(row);
  }

  if (keepAtBottom) elements.logList.scrollTop = elements.logList.scrollHeight;
}

function renderTask(task) {
  const hasTask = Boolean(task);
  elements.taskEmpty.hidden = hasTask;
  elements.taskPanel.hidden = !hasTask;
  elements.stepsSection.hidden = !hasTask;
  elements.logsSection.hidden = !hasTask;
  if (!task) return;

  elements.taskPanel.dataset.status = task.status || '';
  elements.taskStatus.textContent = statusLabel(task.status);
  elements.taskEmail.textContent = task.email || '';
  elements.taskMessage.textContent = task.message || '';
  elements.taskUpdated.textContent = task.updatedAt
    ? `更新于 ${formatTime(task.updatedAt, true)}`
    : '';
  elements.taskUpdated.dateTime = task.updatedAt
    ? new Date(task.updatedAt).toISOString()
    : '';
  elements.cancelLogin.hidden = !taskRunning(task);
  renderSteps(task);
  renderLogs(task.logs);
}

function render(state) {
  currentState = state || { accounts: [], task: null };
  renderAccounts(currentState.accounts || [], currentState.task);
  renderTask(currentState.task);
  const running = taskRunning(currentState.task);
  elements.clearAccounts.disabled = running
    || (!(currentState.accounts || []).length && !currentState.task);
  elements.showImport.disabled = running;

  if (!initialized) {
    activateView(currentState.task ? 'run' : 'accounts');
    initialized = true;
  }
}

function setMessage(message, isError = false) {
  elements.globalMessage.textContent = String(message || '');
  elements.globalMessage.dataset.error = String(Boolean(isError));
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

async function currentTabContext() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!Number.isInteger(tab?.id)) {
    throw new Error('无法获取当前标签页');
  }
  return {
    tabId: tab.id,
    windowId: Number.isInteger(tab.windowId) ? tab.windowId : undefined,
  };
}

async function startLogin(email) {
  if (!confirm(`将清理当前 ChatGPT 登录态并登录 ${email}，是否继续？`)) return;
  setMessage('正在启动登录...');
  try {
    const tab = await currentTabContext();
    const response = await send({
      type: 'login:start',
      email,
      ...tab,
    });
    render(response.state);
    activateView('run');
    setMessage('');
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

elements.runTab.addEventListener('click', () => activateView('run'));
elements.accountsTab.addEventListener('click', () => activateView('accounts'));
elements.openAccounts.addEventListener('click', () => activateView('accounts'));

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
  if (!confirm('将删除插件中导入的邮箱、密码、2FA 密钥和任务记录。\n\n不会清除 ChatGPT Cookie 或退出当前登录。是否继续？')) return;
  try {
    const response = await send({ type: 'accounts:clear' });
    elements.accountText.value = '';
    elements.accountFile.value = '';
    elements.accountSearch.value = '';
    elements.importErrors.textContent = '';
    elements.importErrors.hidden = true;
    elements.importPanel.hidden = true;
    render(response.state);
    activateView('accounts');
    setMessage('导入数据和步骤日志已清除，ChatGPT 登录态未改变');
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

elements.clearLogs.addEventListener('click', async () => {
  try {
    const response = await send({ type: 'login:logs:clear' });
    render(response.state);
  } catch (error) {
    setMessage(error.message, true);
  }
});

globalThis.chrome?.runtime?.onMessage?.addListener((message) => {
  if (message?.type === 'state:changed') void refresh();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});

void refresh();
setInterval(() => {
  if (!document.hidden && taskRunning(currentState.task)) void refresh();
}, 5000);
