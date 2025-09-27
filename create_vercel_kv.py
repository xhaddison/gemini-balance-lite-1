import json
import os

def generate_puppeteer_commands():
    """
    Generates and prints a series of mcp__puppeteer JSON commands
    to automate the creation of a Vercel KV database.
    """
    # --- 1. 读取凭证 (Read Credentials) ---
    # 构建凭证文件的绝对路径
    # The script must read credentials from ~/.claude/secrets/vercel_credentials.json
    credential_path = os.path.expanduser('~/.claude/secrets/vercel_credentials.json')

    try:
        with open(credential_path, 'r') as f:
            credentials = json.load(f)
        email = credentials.get('email')
        password = credentials.get('password')
        if not email or not password:
            print(json.dumps({
                "error": "Email or password not found in credentials file.",
                "path": credential_path
            }))
            return
    except FileNotFoundError:
        print(json.dumps({
            "error": "Credentials file not found.",
            "path": credential_path
        }))
        return
    except json.JSONDecodeError:
        print(json.dumps({
            "error": "Could not decode JSON from credentials file.",
            "path": credential_path
        }))
        return

    # 定义团队和项目信息
    # Team slug and project name are provided in the prompt.
    team_slug = "addisons-team-u4znpcv"
    project_name = "gemini-balance-lite"
    storage_url = f"https://vercel.com/{team_slug}/{project_name}/storage"
    login_url = "https://vercel.com/login"

    # --- 2. 生成自动化指令 (Generate Automation Commands) ---
    # 这是一个指令列表，将按顺序执行
    commands = [
        # 步骤 1: 导航至登录页面
        # Step 1: Navigate to the login page
        {
            "tool_name": "mcp__puppeteer__navigate",
            "parameters": {
                "url": login_url,
                "options": {
                    "waitUntil": "networkidle2"
                }
            },
            "comment": "Navigate to Vercel login page."
        },
        # 步骤 2: 填充邮箱并继续
        # Step 2: Fill in the email and continue
        {
            "tool_name": "mcp__puppeteer__fill",
            "parameters": {
                "selector": "input[name='email']",
                "text": email
            },
            "comment": "Fill in the email address."
        },
        {
            "tool_name": "mcp__puppeteer__click",
            "parameters": {
                "selector": "button[type='submit']"
            },
            "comment": "Click the 'Continue with Email' button."
        },
        # 步骤 3: 填充密码并登录
        # Step 3: Fill in the password and log in
        {
            "tool_name": "mcp__puppeteer__fill",
            "parameters": {
                "selector": "input[name='password']",
                "text": password
            },
            "comment": "Fill in the password. A wait is added for the password field to appear."
        },
        {
            "tool_name": "mcp__puppeteer__click",
            "parameters": {
                "selector": "button[type='submit']"
            },
            "comment": "Click the final login button."
        },
        # 步骤 4: 导航至项目的 Storage 页面
        # Step 4: Navigate to the project's Storage page
        {
            "tool_name": "mcp__puppeteer__navigate",
            "parameters": {
                "url": storage_url,
                "options": {
                    "waitUntil": "networkidle2"
                }
            },
            "comment": "Navigate directly to the project's storage page after login."
        },
        # 步骤 5: 创建新的 KV 数据库
        # Step 5: Create the new KV database
        {
            "tool_name": "mcp__puppeteer__click",
            "parameters": {
                # This selector targets a button that specifically creates a KV store.
                "selector": "button[aria-label='Create a new KV store']"
            },
            "comment": "Click the 'Create Database -> KV' button."
        },
        # 步骤 6: 确认创建流程
        # Step 6: Go through the confirmation process
        {
            "tool_name": "mcp__puppeteer__click",
            "parameters": {
                # The 'Continue' button in the creation dialog.
                "selector": "button:contains('Continue')"
            },
            "comment": "Click 'Continue' in the creation dialog."
        },
        {
            "tool_name": "mcp__puppeteer__click",
            "parameters": {
                # The final 'Accept' or 'Create' button.
                "selector": "button:contains('Accept & Create')"
            },
            "comment": "Accept the terms and create the database."
        },
        # 步骤 7: 截取成功页面作为验证
        # Step 7: Take a screenshot as visual confirmation
        {
            "tool_name": "mcp__puppeteer__screenshot",
            "parameters": {
                "path": "/tmp/vercel_kv_creation_success.png",
                "fullPage": True
            },
            "comment": "Take a screenshot to verify successful creation."
        }
    ]

    # --- 3. 打印指令 (Print Commands) ---
    # 将每个指令字典转换为格式化的 JSON 字符串并打印
    for command in commands:
        # Adding a comment to the JSON output for clarity.
        print(f"# {command.pop('comment')}")
        print(json.dumps(command, indent=2))
        print("-" * 20)


if __name__ == "__main__":
    generate_puppeteer_commands()
