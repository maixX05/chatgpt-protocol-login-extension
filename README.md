# ChatGPT Protocol Login

独立的 Manifest V3 浏览器扩展。扩展不填写网页表单，而是在目标 ImRun 浏览器环境的 `chatgpt.com` 与 `auth.openai.com` 页面中执行同源登录协议，使登录 Cookie 由浏览器自然写入当前 Cookie Store。

## 安装

1. 在 ImRun 中打开扩展管理页面。
2. 开启开发者模式。
3. 加载已解压的扩展，选择 `plugin/ChatGPTProtocolLogin`。

## 账号格式

```text
邮箱----密码----2FA密钥
```

支持粘贴多行 TXT。2FA 密钥支持普通 Base32 和带 `secret` 参数的 `otpauth://` 地址。

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

账号凭据只保存在 `chrome.storage.session`。浏览器关闭后会自动清除，不会写入 `chrome.storage.local`。单个账号登录成功后，插件会立即删除该账号的邮箱、密码、2FA 密钥和已完成任务记录。

弹窗中的“清除导入数据”会删除所有剩余的导入账号和插件任务记录，但不会清理 ChatGPT Cookie，也不会退出当前已登录账号。开始一次新登录时，插件会复用当前活动标签页执行登录，并按原有流程清理当前 Cookie Store 中与 ChatGPT/OpenAI 登录相关的 Cookie。

如果认证流程要求邮箱 OTP、验证码或其他未支持的安全挑战，任务会停止并保留当前标签页，不会降级为页面元素自动填写。

该扩展复用了 ChatGPT Web 当前使用的内部认证端点。这些端点不属于 OpenAI 官方公开 API 的稳定性承诺，页面登录协议变化后可能需要同步更新扩展。

## 测试

```bash
node --test plugin/ChatGPTProtocolLogin/test/*.test.js
```
