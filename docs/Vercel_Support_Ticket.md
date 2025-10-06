# Vercel Support Ticket: Edge Function Outbound Fetch Timeout

**主题:** Vercel Edge Function Outbound Fetch Timeout to Google Gemini API

**问题描述:**
我们的 Vercel Edge Function (`/api/v1/chat/completions`) 在尝试向 `https://generativelanguage.googleapis.com` 发起 `fetch` 请求时，稳定地出现 `FUNCTION_INVOCATION_TIMEOUT` 错误。

**部署 URL:** `https://gemini-balance-lite-jge8svihy-xhaddisons-projects.vercel.app`

**诊断日志与证据:**
我们的日志无可辩驳地证明，函数在 Redis 密钥成功获取后，于 `await fetch(...)` 调用向上游 Google Gemini API 发起请求的瞬间停止响应。日志从未进入 `fetch` 调用的内部逻辑，直接导致 25 秒后超时。

这清楚地表明问题并非出在我们的代码逻辑或 Redis 连接上，而是 Vercel Edge 环境的出站网络层。

**请求协助:**
我们怀疑这是 Vercel Edge 环境的出站网络连接问题（可能是防火墙、DNS 解析、或路由策略），导致无法访问 `generativelanguage.googleapis.com`。

请贵团队协助调查并解决此网络连接问题。
