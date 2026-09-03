# ChatGPT Protocol Login

独立的 Manifest V3 浏览器扩展。扩展在 Chrome 或 Chromium 内核浏览器中运行，通过 `chatgpt.com` 与 `auth.openai.com` 的同源登录协议完成认证，使登录 Cookie 由浏览器自然写入当前 Cookie Store。

## 安装

1. 下载或克隆源码，确认目录根部包含 `manifest.json`。
2. 在浏览器地址栏打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展”，选择包含 `manifest.json` 的目录。

## 支持的账号格式

插件仅支持已经设置登录密码和 TOTP 2FA 的账号。导入时每行一个账号，并严格使用以下三段格式：

```text
账号----密码----2FA密钥
```

账号必须是登录邮箱，三项均不能为空，字段之间使用四个连续连字符 `----` 分隔。2FA 密钥支持 Base32，或带 `secret` 参数的 `otpauth://` 地址。

不支持仅账号密码、邮箱验证码、第三方单点登录、Cookie、Session JSON、Access Token、CSV 或 JSON 等其他导入和认证方式。文档不提供任何真实或可用的账号凭据示例。

## 使用

1. 点击浏览器工具栏中的扩展图标，打开右侧面板。
2. 在“账号”页粘贴符合格式的账号数据并完成导入。
3. 选择一个账号并点击“开始登录”。
4. 在“运行”页查看当前步骤和脱敏日志。

## 登录流程

```text
ChatGPT CSRF
  -> OpenAI signin
  -> 密码验证
  -> TOTP challenge/verify
  -> 工作空间选择
  -> ChatGPT callback
  -> /api/auth/session 邮箱校验
```

## 数据与安全

账号凭据只保存在 `chrome.storage.session`。浏览器关闭后会自动清除，不会写入 `chrome.storage.local`。单个账号登录成功后，插件会立即删除导入账号中的账号、密码和 2FA 密钥，只在当前浏览器会话中保留脱敏后的任务结果与步骤日志。

“清除导入数据”会删除所有剩余的导入账号、任务结果和步骤日志，但不会清理 ChatGPT Cookie，也不会退出当前已登录账号。开始一次新登录时，插件会复用当前活动标签页，并清理当前 Cookie Store 中与 ChatGPT/OpenAI 登录相关的 Cookie。

如果认证流程要求邮箱验证码或其他未支持的安全挑战，任务会停止并保留当前标签页，不会尝试绕过或降级为页面元素自动填写。

该扩展复用了 ChatGPT Web 当前使用的内部认证端点。这些端点不属于 OpenAI 官方公开 API 的稳定性承诺，页面登录协议变化后可能需要同步更新扩展。

## 测试

```bash
npm test
```
