# 科学使用Key：核心需求与设计原则

本文档记录了项目API密钥管理系统的核心需求，旨在实现对上游API（如Google Gemini）密钥的“科学使用”。

## 核心目标

构建一个智能的、有状态的、能够自动从API错误中恢复的密钥路由系统，以确保在Vercel Edge环境的执行时间限制内，最大化服务可用性。

## 三大核心原则

### 1. 状态化管理 (Stateful Management)

系统必须是有状态的，能够跨越单次函数调用来跟踪和管理每个密钥的当前状态。

- **实现方式:** 使用Redis作为外部持久化存储。
- **数据结构:**
    - `gemini_keys_active` (Redis Set): 存储所有当前健康、可用的密钥。
    - `gemini_keys_cooldown:{API_KEY}` (Redis Key with TTL): 通过为每个被冷却的密钥设置一个带TTL的独立键，来模拟一个“冷却中”的集合。

### 2. 智能冷却机制 (Intelligent Cooldown)

当一个密钥返回可恢复的应用层错误（如429, 5xx）时，系统必须将其置入“冷却”状态，而不是粗暴地丢弃或无限重试。

- **触发条件:** 收到来自上游API的 `429 Too Many Requests`, `500 Internal Server Error`, `503 Service Unavailable` 等可恢复错误。
- **核心动作:**
    1.  从 `gemini_keys_active` 集合中移除该密钥。
    2.  为该密钥设置一个带有固定TTL（例如300秒）的“冷却中”记录。
    3.  立即尝试 `gemini_keys_active` 中的下一个可用密钥。

### 3. 自动恢复 (Automatic Recovery)

被“冷却”的密钥必须能够在冷却期结束后，自动返回到可用密钥池中。

- **实现方式:** 依赖Redis的TTL过期机制。一旦代表某个密钥处于“冷却中”的键过期被自动删除，该密钥即可被视为“已恢复”。
- **恢复逻辑:** 密钥管理逻辑需要定期或在需要时，将那些不再处于“冷却中”状态的密钥，重新添加回 `gemini_keys_active` 集合。
