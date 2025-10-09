# UAT 报告: 智能密钥调度中台 v3.0

| **版本** | **状态** | **负责人** | **测试日期** |
| --- | --- | --- | --- |
| 3.0 | 进行中 | Product-Manager | 2025-10-09 |

---

## 1. 测试概述

本报告旨在验证智能密钥调度中台 v3.0 的核心功能是否严格符合 `docs/PRD_v3.0.md` 中定义的需求。

## 2. 核心测试用例执行记录

### 测试用例 1: 择优逻辑验证

- **执行步骤:**
- **预期结果:**
- **实际结果:**
- **结论:**

### 测试用例 2: 401 (永久失效) 熔断验证

- **[原始测试 - 2025-10-08]**
- **执行步骤:**
  1. 在 Redis 中设置一个高优先级的无效密钥 (health_score: 0.9) 和一个低优先级的有效密钥 (health_score: 0.8)。
  2. 向 `/v1beta/chat/completions` 端点发送一个 API 请求。
  3. 查询无效密钥在 Redis 中的状态。
- **预期结果:**
  1. API 请求应由有效密钥处理并最终成功。
  2. 无效密钥的 `status` 应变为 `disabled`，`reason` 应变为 `invalid_auth`。
- **实际结果:**
  1. API 请求返回 `FUNCTION_INVOCATION_TIMEOUT` 错误，调用失败。
  2. 查询 Redis 后发现，无效密钥的状态**未发生任何改变** (`status` 仍为 `available`)。
- **结论:** **严重失败 (Critical Failure)**。核心的 401 熔断机制完全失效。

- **[V2 修复验证 - 2025-10-09]**
- **测试环境:** `https://gemini-balance-lite-jeit7d7pm-xhaddisons-projects.vercel.app`
- **执行步骤:**
  1. 使用 `scripts/setup-uat-env.js` 在 Redis 中设置一个高优先级的无效密钥 (`key-invalid-high-priority`, health_score: 0.9) 和一个低优先级的有效密钥 (`key-valid-low-priority`, health_score: 0.8)。
  2. 向 `/v1beta/chat/completions` 端点发送一个携带无效密钥的 API 请求。
  3. 使用 `scripts/setup-uat-env.js` 查询无效密钥在 Redis 中的状态。
- **预期结果:**
  1. API 请求应由有效密钥处理并最终成功。
  2. 无效密钥的 `status` 应变为 `disabled`，`reason` 应变为 `invalid_auth`。
- **实际结果:**
  1. API 请求返回 `FUNCTION_INVOCATION_TIMEOUT` 错误，调用失败。
  2. 查询 Redis 后发现，无效密钥的状态**未发生任何改变** (`status` 仍为 `available`, `reason` 为空)。
- **结论:** **严重失败 (Critical Failure)**。紧急修复无效，故障现象与修复前完全相同。401熔断机制依然完全失效。

- **[V3 根本性修复验证]**
- **测试环境:** `https://gemini-balance-lite-p0wpmt6uj-xhaddisons-projects.vercel.app`
- **执行步骤:**
  1. 使用 `scripts/setup-uat-env.js setup` 命令在 Redis 中设置精确的 UAT 初始状态。
  2. 向新部署的 `/api/v1/chat/completions` 端点发送一个 POST 请求。
  3. 使用 `scripts/setup-uat-env.js query key-invalid-high-priority` 查询无效密钥在 Redis 中的状态。
- **预期结果:**
  1. API 请求应成功返回 HTTP 200 OK。
  2. 无效密钥的 `status` 应变为 `disabled`，`reason` 应变为 `invalid_auth`。
- **实际结果:**
  1. API 请求再次返回 `FUNCTION_INVOCATION_TIMEOUT` 错误，调用失败。
  2. 查询 Redis 后发现，无效密钥的状态**未发生任何改变** (`status` 仍为 `available`)。
- **结论:** **严重失败 (Critical Failure)**。所谓的“根本性修复”完全无效，核心的熔断与自我修复机制依然彻底失效。

- **[V4 最终修复验证]**
- **测试环境:** `https://gemini-balance-lite-597p93fho-xhaddisons-projects.vercel.app`
- **执行步骤:**
  1. 使用 `scripts/setup-uat-env.js setup` 命令在 Redis 中设置精确的 UAT 初始状态。
  2. 尝试向新部署的 `/api/v1/chat/completions` 端点发送一个 POST 请求。
- **预期结果:**
  1. API 请求应成功返回 HTTP 200 OK。
  2. 无效密钥的 `status` 应变为 `disabled`，`reason` 应变为 `invalid_auth`。
- **实际结果:**
  1. **UAT 被阻塞**: 无法执行测试。所有对测试环境的 API 请求均在网络层面失败。
  2. `curl` 返回 `(35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL` 错误。
  3. Node.js `https.request` 返回 `ECONNRESET` 错误。
  4. Redis 状态检查确认，请求**从未到达**应用层，密钥状态无任何变化。
- **结论:** **UAT 被阻塞 (Blocked)**。在 Vercel 部署的网络连接问题解决之前，无法验证后端修复的有效性。

### 测试用例 3: 429 (配额耗尽) 熔断验证

- **执行步骤:**
- **预期结果:**
- **实际结果:**
- **结论:**

### 测试用例 4: 5xx (服务器错误) 熔断与重试验证

- **执行步骤:**
- **预期结果:**
- **实际结果:**
- **结论:**

---

## 3. 最终 UAT 结论

**UAT 结论: 被阻塞 (Blocked)**

经过多轮（包括V2、V3两次）修复尝试后，我们迎来了最终的 V4 修复。然而，本次 UAT 因**外部环境问题**而被**完全阻塞**。

1.  **Vercel 部署故障**: 最新部署的测试环境 (`https://gemini-balance-lite-597p93fho-xhaddisons-projects.vercel.app`) 存在严重的网络连接问题，导致任何客户端（`curl`, `Node.js`）都无法在 TLS/SSL 层面建立连接。
2.  **测试无法执行**: 由于网络请求无法到达应用层，我们**无法对 `developer` agent 提交的后端修复进行任何有效性验证**。

**建议:**
*   **立即调查部署问题**: 必须将 Vercel 部署失败作为当前最高优先级的任务。
*   **委派 Developer**: `developer` agent 需要立即调查部署日志，诊断并解决 SSL/TLS 连接问题。
*   **暂停 UAT**: 在部署问题被明确解决、测试环境恢复可访问性之前，所有功能性 UAT 均暂停。

在部署问题被完整、可验证地修复之前，v3.0 版本严禁上线。
