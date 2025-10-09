# PRD v3.0: 智能密钥调度中台

| **版本** | **状态** | **负责人** | **更新日期** |
| --- | --- | --- | --- |
| 3.0 | 草案 | Product-Manager | 2025-10-09 |

---

## 1. 概述

### 1.1 背景与目标

当前系统的 API 密钥管理采用简单的轮询机制，无法有效应对密钥失效、配额耗尽或服务不稳定的情况，导致服务可用性下降和资源浪费。

**核心目标:** 将现有的API密钥轮询系统，升级为一个以数据库为中心、具备主动预测和自愈能力的智能密钥调度中台。此系统将通过科学化、精细化的管理，最大化密钥使用效率和业务连续性。

### 1.2 核心设计原则

- **数据驱动:** 所有调度决策都必须基于从 Redis 读取的实时数据。
- **韧性设计:** 系统应能自动识别、隔离并尝试恢复故障密钥。
- **性能优先:** 密钥选择和更新逻辑必须在毫秒级完成，确保对业务无性能影响。

---

## 2. 第一部分：科学管理 (The Management Plane)

管理平面为整个系统提供数据基础和手动干预能力。所有密钥的元数据和状态都将集中存储于 Redis，并提供管理脚本进行维护。

### 2.1 数据结构扩展: Redis Hash

每个 API 密钥都将作为一个独立的 Hash 结构存储在 Redis 中，Key 为 `key:{apiKey}`。该结构包含以下字段：

| 字段名 | 类型 | 描述 |
| --- | --- | --- |
| `apiKey` | String | API 密钥的实际值。 |
| `status` | String | 密钥的当前状态。枚举值: `available` (可用), `in_use` (正在使用), `disabled` (已禁用)。 |
| `reason` | String | 记录状态变更的原因，特别是`disabled`状态的原因。枚举值: `invalid_auth` (永久失效), `quota_exceeded` (配额耗尽), `server_error` (上游服务错误), `manual_reset` (手动重置), `health_check_passed` (健康检查通过)。 |
| `lastUsed` | Timestamp | 上次被使用的时间戳。用于实现冷却期（Cooldown）逻辑。 |
| `lastFailure` | Timestamp | 上次失败的时间戳。用于健康检查和恢复策略。 |
| `totalUses` | Integer | 自记录以来的总使用次数。 |
| `totalFailures` | Integer | 自记录以来的总失败次数。 |
| `quota_remaining` | Integer | 从 API 响应头中获取的剩余配额。 |
| `quota_reset_time` | Timestamp | 从 API 响应头中获取的配额重置时间。 |
| `health_score` | Float | 范围在 0.0 到 1.0 之间的健康度分数，是密钥选择的核心指标。 |
| `error_rate` | Float | 动态计算的错误率 (`totalFailures` / `totalUses`)。 |

### 2.2 管理脚本: `scripts/manage-keys.js`

提供一个命令行管理脚本，用于对单个或批量密钥进行生命周期管理。核心功能包括：

- **状态重置:** 允许手动将密钥的 `status` 强制修改为 `available`, `disabled` 等。
  - **场景:** 当一个密钥被系统误判为`disabled`，或在外部确认问题已解决后，可手动恢复。
- **健康度校准:** 允许手动重置 `health_score` 到一个初始值（如 1.0）。
- **配额修正:** 允许手动修改 `quota_remaining` 的值。
  - **场景:** 当系统未能正确解析配额头，或需要紧急提升某密钥优先级时使用。

---

## 3. 第二部分：科学使用 (The Runtime Plane)

运行时平面是系统的核心，负责在每次 API 请求时，动态地选择最合适的密钥。

### 3.1 密钥选择逻辑: “择优”

彻底取代现有的简单轮询逻辑，采用三步筛选法：

1.  **过滤 (Filter):**
    - 移除 `status` 不为 `available` 的所有密钥。
    - 移除处于冷却期内的密钥（例如，`lastUsed` 在最近 1 秒内）。
2.  **排序 (Sort):**
    - 对过滤后的密钥列表，按照以下优先级进行降序排序：
        1.  `health_score` (DESC): 健康度越高的密钥越优先。
        2.  `quota_remaining` (DESC): 健康度相同时，剩余配额越多的密钥越优先。
3.  **选择 (Select):**
    - 直接选择排序后的列表中的第一个密钥。

### 3.2 动态配额感知

在每次成功的 API 调用后，系统必须解析响应头中的速率限制字段（如 `X-RateLimit-Remaining`, `X-RateLimit-Reset` 等），并将解析出的值实时更新回该密钥在 Redis 中的 `quota_remaining` 和 `quota_reset_time` 字段。

### 3.3 健康度打分机制 (`health_score`)

`health_score` 是一个动态变化的浮点数，用于量化密钥的可靠性。

- **更新算法示例:**
    - **请求成功:** `new_score = current_score + 0.05 * (1 - current_score)`。每次成功都会使其向 1.0 靠近，但增益会递减。
    - **请求失败:** `new_score = current_score * 0.75`。每次失败都会显著降低分数。
- **降权策略:**
    - 当一个密钥的 `health_score` 低于一个预设阈值（例如 `0.5`）时，即使其状态仍为 `available`，它在排序中的自然优先级也会大幅降低，从而实现动态降权，减少被选中的概率。

### 3.4 智能重试

- **触发条件:** 当 API 请求返回 5xx 系列的服务器错误时。
- **重试逻辑:**
    - 系统应采用指数退避（Exponential Backoff）策略进行重试。
    - 首次重试前等待一个随机的短时间（如 100ms - 200ms），后续每次重试的等待时间加倍，并引入随机抖动，避免流量洪峰。
    - 在重试时，应**更换**一个不同的、次优的密钥，而不是在同一个故障密钥上重复尝试。

---

## 4. 第三部分：科学恢复 (The Recovery Plane)

恢复平面负责将被禁用的密钥安全地带回服务队列，实现系统的自愈。

### 4.1 主动健康检查机制

- **执行环境:** 作为一个独立的 Vercel Cron Job 定期执行（例如，每 5 分钟一次）。
- **检查目标:** 扫描 Redis 中所有 `status: "disabled"` 且 `reason` **不为** `invalid_auth` 的密钥。永久失效的密钥不应被检查。

### 4.2 检查方法

为了最小化成本，健康检查将使用对 Gemini API 的“轻量级 `generateContent` 测试请求”。

- **请求配置:**
  - `model`: `'gemini-pro'`
  - `content`: `'x'` (或其他极短的、无意义的内容)

### 4.3 恢复逻辑

- **检查成功 (HTTP 200 OK):**
    - **原子化更新:** 必须在一次 Redis `MULTI/EXEC` 事务中完成以下操作：
        1.  将 `status` 更新为 `available`。
        2.  将 `health_score` 重置为一个较高的初始值（例如 `0.8`）。
        3.  将 `reason` 更新为 `health_check_passed`。
        4.  清空 `lastFailure` 时间戳。
- **检查失败 (Non-200):**
    - 保持 `status` 为 `disabled` 不变。
    - 更新 `lastFailure` 为当前时间戳，以确保在下一个检查周期中能被再次扫描。