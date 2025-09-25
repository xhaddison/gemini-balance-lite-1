# 技术方案文档：智能密钥调度器 (Intelligent Key Scheduler)

## 1. 问题背景

当前系统中使用的 `KeyManager` 机制在处理 Gemini API 密钥时存在明显局限性。随着请求量的增加，我们频繁遇到由速率限制 (RPM) 和每日用量限制 (QPD) 导致的 API 调用失败，主要表现为 `429 (Too Many Requests)` 错误，以及因密钥失效或权限问题引发的 `400/401/403` 系列异常。此外，`5xx` 服务端错误也缺乏有效的容错和重试机制。这些问题严重影响了服务的稳定性和可靠性，需要一套更智能、更具弹性的密钥管理和调度方案来解决。

## 2. 核心设计目标

为应对上述挑战，我们设计了“智能密钥调度器”，其核心目标如下：

*   **动态管理**: 实现对每个 API Key 健康状态的实时、精细化追踪和管理。
*   **主动规避**: 基于速率和用量数据，主动预测并规避即将到来的限制，而非被动等待失败。
*   **自动降级**: 当一个 Key 遇到可恢复的异常（如速率限制）时，能自动将其“熔断”或“降级”，并在冷却期后恢复，保证服务连续性。
*   **故障隔离**: 永久禁用已失效或被封禁的 Key，防止其影响整体服务的可用性。
*   **弹性容错**: 为服务端临时性错误（5xx）提供重试机制，提高系统的健壮性。

## 3. 数据模型

为了实现精细化管理，调度器将为池中的每一个 API Key 维护一个详细的状态对象。该对象结构如下：

```json
{
  "key_string": "AIzaSy...",
  "status": "active" | "cooling_down" | "disabled" | "expired",
  "requests_this_minute": 0,
  "minute_window_start": 1678886400000,
  "requests_today": 0,
  "last_used_time": 1678886405000,
  "last_error": {
    "code": 429,
    "timestamp": 1678886405000
  }
}
```

**字段说明:**

*   `key_string` (string): 完整的 API Key 字符串。
*   `status` (enum): Key 的当前状态。
    *   `active`: 健康可用。
    *   `cooling_down`: 因速率限制等原因临时熔断，冷却期后可恢复。
    *   `disabled`: 因认证失败等永久性问题被禁用。
    *   `expired`: 已知已过期的 Key。
*   `requests_this_minute` (number): 当前分钟窗口内的请求计数。
*   `minute_window_start` (timestamp): 当前分钟计数窗口的起始时间戳。
*   `requests_today` (number): 当日（UTC）的总请求计数。
*   `last_used_time` (timestamp): 上次使用该 Key 的时间戳。
*   `last_error` (object): 记录最近一次发生的错误信息，用于分析和状态决策。

## 4. 核心工作流程

调度器的工作流程主要分为“获取密钥”和“更新状态”两个核心环节。

### 4.1. 获取密钥 (Get Key)

当应用需要发起 API 请求时，会向调度器请求一个可用的 Key。

1.  **过滤**: 调度器首先筛选出所有 `status` 为 `active` 的 Key。
2.  **排序**:
    *   优先选择 `requests_this_minute` 最少的 Key，以实现负载均衡。
    *   在请求数相同的情况下，优先选择 `last_used_time` 最早的 Key，实现轮询。
3.  **检查**:
    *   检查选定 Key 的 `requests_this_minute` 是否已接近 RPM 阈值（例如，Pro 版免费 Key 的 60 RPM）。如果接近，则跳过此 Key，寻找下一个。
    *   检查 `requests_today` 是否已接近 QPD 阈值。如果接近，则将该 Key 状态置为 `expired` 并寻找下一个。
4.  **返回**:
    *   如果找到可用的 Key，则返回该 Key 的 `key_string`。
    *   如果没有找到任何可用的 Key，则返回一个明确的错误，告知上层服务当前无可用资源。

### 4.2. 调用后更新 (Update Key Status)

API 调用完成后，应用必须将调用结果（HTTP 状态码）和使用的 Key 一同反馈给调度器。

*   **HTTP 200 (成功)**:
    *   对应 Key 的 `requests_this_minute` 和 `requests_today` 计数加一。
    *   更新 `last_used_time`。

*   **HTTP 429 (速率限制)**:
    *   将该 Key 的 `status` 立即变更为 `cooling_down`。
    *   记录 `last_error` 信息。
    *   设置一个定时器（例如 60 秒后），时间到达后将 `status` 恢复为 `active`。

*   **HTTP 400/401/403 (认证/权限问题)**:
    *   这通常意味着 Key 本身存在问题（如格式错误、被吊销、未授权）。
    *   将该 Key 的 `status` 永久性地设置为 `disabled`。
    *   记录 `last_error` 信息，并触发告警，通知管理员检查。

*   **HTTP 5xx (服务端错误)**:
    *   不立即改变 Key 的状态，因为这通常是服务端临时问题。
    *   记录 `last_error` 信息。
    *   建议调用方进行有限次数的重试（例如，使用另一个 `active` 的 Key 进行重试）。

## 5. 后台维护任务

调度器需要一个轻量级的后台任务来执行周期性维护。

1.  **分钟级任务**: 每分钟检查一次，将所有 `minute_window_start` 超过一分钟的 Key 的 `requests_this_minute` 计数重置为 0。
2.  **每日任务**: 每天 UTC 时间零点，重置所有 Key 的 `requests_today` 计数，并将 `expired` 状态的 Key 重新激活为 `active`。
3.  **状态监控与告警**: 持续监控池中 `active` Key 的数量。如果可用 Key 的比例低于某个阈值（例如 20%），则立即触发告警。

## 6. 方案总结

下表总结了不同场景下调度器的核心行为：

| 异常场景 | HTTP 状态码 | 调度器行为 | Key 状态变化 | 后续动作 |
| :--- | :--- | :--- | :--- | :--- |
| **请求成功** | `200` | 更新分钟和每日计数 | `active` -> `active` | 无 |
| **速率限制** | `429` | 启动冷却计时器 | `active` -> `cooling_down` | 立即使用下一个可用 Key 重试 |
| **密钥无效** | `400/401/403` | 永久禁用该 Key | `active` -> `disabled` | 触发告警，使用下一个 Key 重试 |
| **服务端错误** | `5xx` | 记录错误，不改变状态 | `active` -> `active` | 建议调用方使用另一个 Key 重试 |
| **日用量耗尽** | - | 在 Get Key 阶段主动识别 | `active` -> `expired` | 第二天自动恢复 |
