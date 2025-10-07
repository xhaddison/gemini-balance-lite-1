# 项目核心需求文档 (v2.0 - 最终版)

**版本:** 2.0
**状态:** 已批准并锁定
**核心目标:** 构建一个以数据库为中心的、具备动态管理能力和自动化容错能力的API密钥中台系统。

---

## 第一部分：科学管理 (The Management Plane)

**核心原则:** 数据库是唯一事实来源。所有密钥状态和配置必须在 Upstash Redis 中进行持久化管理。应用本身必须是无状态的。

### 1.1. 密钥的生命周期管理

- **注入 (Injection):**
  - **执行者:** Claude Code (项目经理)。
  - **机制:** 必须提供一个专用的后台CLI脚本 (例如 `scripts/import-keys.js`)。
  - **流程:** 当需要添加新密钥时，您将向Claude提供密钥列表。由Claude执行此脚本，将密钥批量、直接地写入Redis数据库。

- **存储 (Storage):**
  - **结构:** Redis中的每一个密钥都必须是一个结构化的 **Hash** 对象。
  - **核心状态字段:**
    - `apiKey` (String)
    - `status` (String): `available`, `in_use`, `disabled`
    - `reason` (String): `invalid_auth`, `quota_exceeded`, `server_error`, `manual`
    - `lastUsed` (Timestamp)
    - `lastFailure` (Timestamp)
    - `totalUses` (Integer)
    - `totalFailures` (Integer)
  - **初始化:** 新注入的密钥状态为 `status: "available"`。

- **控制 (Control):**
  - **机制:** 必须提供一个专用的后台CLI管理脚本 (例如 `scripts/manage-keys.js`)。
  - **核心功能:** “一键重置”，将所有 `reason` 为 `quota_exceeded` 的密钥的 `status` 批量更新回 `available`。

---

## 第二部分：科学使用 (The Runtime Plane)

**核心原则:** 运行时逻辑必须完全依赖数据库中的状态，实现智能、健壮、自愈的密钥使用策略。

### 2.1. 密钥的运行时逻辑

- **获取与锁定 (Acquire & Lock):**
  - 从Redis查询 `status` 为 `available` 的密钥，实现轮询。
  - 选定后，在一个原子操作中，立即将其 `status` 更新为 `in_use`。

- **成功处理 (Success & Release):**
  - 将 `status` 从 `in_use` 更新回 `available`。
  - 更新 `lastUsed` 时间戳，`totalUses` 计数器加一。

- **失败处理：分级熔断与重试策略**

  - **第一级：请求级永久失败 (400, 404, 422)**
    - **动作:** 立即终止，严禁重试，不修改密钥状态，向客户端明确报错。

  - **第二级：密钥级永久失败 (401, 403)**
    - **动作 (熔断):** `status` -> `disabled`, `reason` -> `invalid_auth` (永不自动恢复)。
    - **动作 (重试):** 立即透明地使用下一个可用密钥重试。

  - **第三级：密钥级临时失败 (429)**
    - **动作 (熔断):** `status` -> `disabled`, `reason` -> `quota_exceeded`。
    - **动作 (重试):** 立即透明地使用下一个可用密钥重试。

  - **第四级：服务器级临时失败 (5xx)**
    - **动作 (熔断):** `status` -> `disabled`, `reason` -> `server_error`。
    - **动作 (重试):** 立即透明地使用下一个可用密钥重试。

### 2.2. 状态的自动恢复 (Self-Healing)

- **机制:** 必须建立一个独立的、定时的健康检查任务 (Vercel Cron Job)。
- **逻辑:**
  - 定期扫描数据库，将 `reason` 是 `server_error` 且 `lastFailure` 已超过阈值（例如1小时）的密钥，`status` 自动重置为 `available`。
  - `reason` 为 `quota_exceeded` 或 `invalid_auth` 的密钥严禁被自动恢复。
