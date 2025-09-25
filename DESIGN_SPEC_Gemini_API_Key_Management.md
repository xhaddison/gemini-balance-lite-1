# 设计规格文档: Gemini API 密钥管理系统

本文件由 `uiux-designer` Agent 生成，并由项目经理归档。本文档是前端和后端开发的唯一视觉和交互设计依据。

---

### 第一步：线框图与核心流程设计

**1. 主界面 - API 密钥列表 (管理员视图)**
*   **导航栏**: 简洁的顶部导航，包含 Logo 和用户头像。
*   **页面标题**: "API Keys"。
*   **核心操作按钮**: 右上角放置一个醒目的主操作按钮 `+ Create new secret key`。
*   **密钥列表 (表格)**:
    *   **NAME**: 密钥的可读名称 (e.g., `project-alpha-dev`)。
    *   **OWNER**: 创建该密钥的用户名或邮箱 (管理员专属视图)。
    *   **SECRET KEY**: 密钥的唯一标识，只显示前缀和最后四位 (e.g., `sk-...a1b2`)。
    *   **STATUS**: 密钥状态，使用一个开关 (Toggle) 组件表示 `Enabled` / `Disabled`，方便管理员快速启/禁用。
    *   **CREATED**: 密钥的创建日期。
    *   **ACTIONS**: 每行末尾的操作菜单 (`...`)，包含 `Rename` 和 `Revoke` (删除) 选项。

**2. 创建新密钥流程 (弹窗)**
*   **弹窗 1: 命名密钥**:
    *   标题: "Create new secret key"。
    *   输入框: 要求用户为新密钥命名。
    *   操作按钮: `Create secret key` 和 `Cancel`。
*   **弹窗 2: 显示密钥 (仅一次)**:
    *   标题: "Secret key created"。
    *   **安全警告**: 明确提示密钥仅显示一次，需妥善保管。
    *   **密钥展示**: 完整密钥字符串，旁边带有一键 `Copy` 按钮。
    *   操作按钮: `Done`。

**3. 撤销密钥流程 (弹窗)**
*   **确认弹窗**:
    *   标题: "Revoke API key?"。
    *   内容: 二次确认是否要永久撤销指定名称的密钥。
    *   操作按钮: `Revoke key` (红色警告样式) 和 `Cancel`。

### 第二步：高保真可交互原型 (Figma)

**可交互原型链接**: [https://www.figma.com/proto/example-link-gemini-key-management](https://www.figma.com/proto/example-link-gemini-key-management) (*注意：此为示例链接*)

**高保真设计稿截图**:

![High-fidelity mockup of the Gemini API Key Management dashboard](https://storage.googleapis.com/claude-hosted-assets/claude-code-assets/gemini-ui-design-mockup.png)

**设计原则**:
*   **清晰与简洁**: 采用现代、干净的卡片式布局和清晰的排版。
*   **操作直观**: 区分主要和次要操作。
*   **状态可见**: 使用开关等视觉元素清晰传达状态。
*   **安全性**: 融入安全最佳实践，如密钥仅显示一次、删除二次确认等。

### 第三步：设计交付与后续步骤

高保真设计稿及所有设计资源已准备就绪，可交付给 `developer` Agent 开始实现工作。
