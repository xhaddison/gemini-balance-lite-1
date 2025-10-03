# 设计文档: 文件上传批量添加密钥 UI/UX

**版本:** 1.0
**日期:** 2025-10-03
**设计师:** Claude (UI/UX Designer)

---

## 1. 设计目标

本设计旨在为管理员面板添加一个通过文件上传来批量添加API密钥的功能。设计核心目标是提升操作效率、降低手动输入错误率，并与现有`admin.html`的简洁风格保持一致，确保用户体验的连贯性。

## 2. 界面设计 (UI)

### 2.1 主界面变更

在现有的“Add New Key”表单区域，我们在“Add Key”按钮旁边新增一个“**Bulk Upload**”按钮。

- **位置**: `id="add-key-form"` 的表单内部。
- **样式**: 为了区分主次操作，新按钮采用次要按钮样式（例如，灰色背景），鼠标悬浮时变色。

**HTML 结构变更示例:**
```html
<form id="add-key-form" class="add-key-form">
    <input type="text" id="new-key-input" placeholder="Enter new Gemini API Key" required>
    <button type="submit" id="add-key-btn">Add Key</button>
    <!-- 新增的按钮 -->
    <button type="button" id="bulk-upload-btn" class="secondary-btn">Bulk Upload</button>
</form>
```

**CSS 样式补充:**
```css
/* 新增次要按钮样式 */
.secondary-btn {
    background-color: #6c757d; /* 灰色 */
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.secondary-btn:hover {
    background-color: #5a6268;
}
```

### 2.2 文件上传触发

点击“Bulk Upload”按钮将触发一个隐藏的 `<input type="file">` 元素，从而打开操作系统的文件选择对话框。

- **文件类型限制**: 对话框将只允许用户选择 `.txt` 文件。

**HTML 结构补充 (可放在页面任意位置):**
```html
<input type="file" id="key-file-input" accept=".txt" style="display: none;">
```

### 2.3 状态反馈界面

为了在不打断主界面的情况下提供反馈，我们将使用现有的 `id="message-container"` 区域来动态显示各个状态。

1.  **上传中状态**:
    - **触发**: 用户选择文件并确认后。
    - **UI表现**: 在 `message-container` 中显示一个加载提示。
    - **示例**:
        ```html
        <div class="message info">
            <div class="spinner"></div>
            <span>Uploading and processing... Please wait.</span>
        </div>
        ```
    - **CSS (Spinner)**:
        ```css
        .spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border-left-color: #007bff;
            animation: spin 1s ease infinite;
            display: inline-block;
            margin-right: 10px;
            vertical-align: middle;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .message.info { background-color: #e2e3e5; color: #383d41; }
        ```

2.  **处理完成状态 (成功/失败/部分成功)**:
    - **触发**: 后端返回处理结果。
    - **UI表现**: `message-container` 中显示最终的结果摘要。
    - **全部成功**:
        - **消息**: "Success! 98 new API keys have been added."
        - **样式**: `message success`
    - **部分成功**:
        - **消息**: "Operation complete. Successfully added: 98, Failed: 7. [Download Failure Log](#)"
        - **样式**: `message warning` (一个新的样式)
        - **交互**: "Download Failure Log" 是一个可点击的链接，用于下载包含失败详情的日志文件。
    - **全部失败**:
        - **消息**: "Upload failed. The file may be empty or all keys are invalid. Please check the file and try again."
        - **样式**: `message error`
    - **CSS (Warning)**:
        ```css
        .message.warning { background-color: #fff3cd; color: #856404; }
        ```

## 3. 交互流程 (UX)

1.  **点击**: 用户点击“Bulk Upload”按钮。
2.  **选择**: JavaScript 代码触发 `id="key-file-input"` 的点击事件，打开文件选择器。
3.  **校验**: 用户选择文件。浏览器层面通过 `accept=".txt"` 属性进行初步过滤。
4.  **上传**: JavaScript 监听文件输入框的 `change` 事件。当用户选择文件后，立即读取文件并将其发送到后端API `/api/keys/bulk-upload`。
5.  **等待**: 在上传和后端处理期间，界面显示“Uploading and processing...”的加载状态。此时所有按钮（Add Key, Bulk Upload）应被禁用，防止重复操作。
6.  **反馈**: 后端处理完毕，返回JSON结果。前端根据 `successfully_added` 和 `failed_entries` 的数量来判断并渲染对应的“全部成功”、“部分成功”或“全部失败”消息。
7.  **日志下载 (如需)**: 如果是“部分成功”状态，前端需要动态生成一个下载链接。该链接可以通过 `Blob` 对象将后端返回的失败日志（`failed_entries`）包装成一个 `.txt` 文件供用户下载。
8.  **列表刷新**: 无论结果如何，操作完成后，都应调用一次 `fetchKeys()` 函数，以刷新界面上显示的密钥列表。
9.  **消息消失**: 反馈消息在显示5-10秒后自动消失，或者用户可以手动关闭。

---
这份设计文档提供了完整的UI和UX方案，可以直接交付给 `developer` 进行开发。
