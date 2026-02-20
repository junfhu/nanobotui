# nanobot: 超轻量级个人AI助手

<div align="center">
  <img src="nanobot_logo.png" alt="nanobot" width="500">
  <p>
    <a href="https://pypi.org/project/nanobot-ai/"><img src="https://img.shields.io/pypi/v/nanobot-ai" alt="PyPI"></a>
    <a href="https://pepy.tech/project/nanobot-ai"><img src="https://static.pepy.tech/badge/nanobot-ai" alt="Downloads"></a>
    <img src="https://img.shields.io/badge/python-≥3.11-blue" alt="Python">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  </p>
</div>

## 项目概述

**nanobot** 是一个受 [OpenClaw](https://github.com/openclaw/openclaw) 启发的**超轻量级**个人AI助手框架。

核心代理代码仅约 **4,000 行** — 比 Clawdbot 的 430k+ 行代码小 **99%**。

### 核心特点

- 🪶 **超轻量级**: 核心代理代码仅约4000行，易于理解和修改
- 🔬 **研究友好**: 清晰、可读的代码，便于研究、修改和扩展
- ⚡️ **极速响应**: 最小化占用意味着更快的启动、更低的资源消耗
- 💎 **易于使用**: 一键部署，开箱即用

---

## 项目架构

```
nanobot/
├── agent/          # 🧠 核心代理逻辑
│   ├── loop.py     #    代理循环 (LLM ↔ 工具执行)
│   ├── context.py  #    提示词构建器
│   ├── memory.py   #    持久化记忆
│   ├── skills.py   #    技能加载器
│   ├── subagent.py #    后台任务执行
│   └── tools/      #    内置工具集
├── skills/         # 🎯 内置技能 (github, weather, tmux...)
├── channels/       # 📱 聊天渠道集成
├── bus/            # 🚌 消息路由
├── cron/           # ⏰ 定时任务
├── heartbeat/      # 💓 主动唤醒
├── providers/      # 🤖 LLM 提供商
├── session/        # 💬 会话管理
├── config/         # ⚙️ 配置管理
└── cli/            # 🖥️ 命令行接口
```

---

## 核心模块详解

### 1. Agent 模块 (`nanobot/agent/`)

核心代理逻辑，是整个框架的大脑。

#### `loop.py` - 代理循环引擎

**类: `AgentLoop`**

代理循环是核心处理引擎，负责:
1. 从消息总线接收消息
2. 构建上下文（历史、记忆、技能）
3. 调用LLM
4. 执行工具调用
5. 发送响应

| 方法 | 功能描述 |
|------|----------|
| `__init__()` | 初始化代理循环，注册默认工具集 |
| `run()` | 运行代理循环，持续处理消息 |
| `stop()` | 停止代理循环 |
| `_process_message()` | 处理单条入站消息 |
| `_process_system_message()` | 处理系统消息（如子代理通知） |
| `_consolidate_memory()` | 将旧消息压缩到 MEMORY.md + HISTORY.md |
| `process_direct()` | 直接处理消息（用于CLI或定时任务） |

**工作流程:**
```
入站消息 → 构建上下文 → LLM调用 → 工具执行 → 响应输出
                ↑                    ↓
                └──── 循环迭代 ←──────┘
```

#### `context.py` - 上下文构建器

**类: `ContextBuilder`**

构建代理的系统提示词和消息列表，将引导文件、记忆、技能和对话历史组装成完整的LLM提示。

| 方法 | 功能描述 |
|------|----------|
| `build_system_prompt()` | 从引导文件、记忆和技能构建系统提示词 |
| `_get_identity()` | 获取核心身份信息（时间、运行环境、工作空间） |
| `_load_bootstrap_files()` | 加载工作空间的引导文件 (AGENTS.md, SOUL.md 等) |
| `build_messages()` | 构建完整的LLLM调用消息列表 |
| `_build_user_content()` | 构建用户消息内容（支持Base64图片） |
| `add_tool_result()` | 添加工具执行结果到消息列表 |
| `add_assistant_message()` | 添加助手消息到消息列表 |

**引导文件列表:**
- `AGENTS.md` - 代理指令
- `SOUL.md` - 代理个性/价值观
- `USER.md` - 用户信息
- `TOOLS.md` - 工具说明
- `IDENTITY.md` - 身份定义

#### `memory.py` - 记忆系统

**类: `MemoryStore`**

双层记忆系统：MEMORY.md（长期事实）+ HISTORY.md（可搜索日志）。

| 方法 | 功能描述 |
|------|----------|
| `read_long_term()` | 读取长期记忆文件内容 |
| `write_long_term()` | 写入长期记忆 |
| `append_history()` | 追加历史条目 |
| `get_memory_context()` | 获取记忆上下文用于提示词 |

#### `skills.py` - 技能加载器

**类: `SkillsLoader`**

加载和管理代理技能。技能是教会代理使用特定工具或执行特定任务的Markdown文件。

| 方法 | 功能描述 |
|------|----------|
| `list_skills()` | 列出所有可用技能 |
| `load_skill()` | 按名称加载技能 |
| `load_skills_for_context()` | 加载特定技能用于代理上下文 |
| `build_skills_summary()` | 构建技能摘要（用于渐进式加载） |
| `get_always_skills()` | 获取标记为always=true的技能 |
| `get_skill_metadata()` | 获取技能的frontmatter元数据 |

#### `subagent.py` - 子代理管理器

**类: `SubagentManager`**

管理后台子代理执行。子代理是轻量级代理实例，在后台运行处理特定任务。

| 方法 | 功能描述 |
|------|----------|
| `spawn()` | 生成子代理执行后台任务 |
| `_run_subagent()` | 执行子代理任务并通知结果 |
| `_announce_result()` | 向主代理通知子代理结果 |
| `_build_subagent_prompt()` | 构建子代理专用系统提示词 |
| `get_running_count()` | 获取当前运行的子代理数量 |

---

### 2. Tools 模块 (`nanobot/agent/tools/`)

内置工具集，定义代理可以执行的操作。

#### `base.py` - 工具基类

**类: `Tool` (抽象基类)**

所有工具的基类，定义工具接口。

| 属性/方法 | 功能描述 |
|-----------|----------|
| `name` | 工具名称（用于函数调用） |
| `description` | 工具功能描述 |
| `parameters` | 工具参数的JSON Schema |
| `execute()` | 执行工具（抽象方法） |
| `validate_params()` | 验证参数是否符合Schema |
| `to_schema()` | 转换为OpenAI函数Schema格式 |

#### `registry.py` - 工具注册表

**类: `ToolRegistry`**

动态注册和管理工具。

| 方法 | 功能描述 |
|------|----------|
| `register()` | 注册工具 |
| `unregister()` | 注销工具 |
| `get()` | 按名称获取工具 |
| `has()` | 检查工具是否已注册 |
| `get_definitions()` | 获取所有工具定义（OpenAI格式） |
| `execute()` | 执行指定工具 |

#### `filesystem.py` - 文件系统工具

| 类 | 功能描述 |
|----|----------|
| `ReadFileTool` | 读取文件内容 |
| `WriteFileTool` | 写入文件（自动创建父目录） |
| `EditFileTool` | 编辑文件（查找替换） |
| `ListDirTool` | 列出目录内容 |

**安全特性:** 支持目录限制，防止路径遍历攻击。

#### `shell.py` - Shell执行工具

**类: `ExecTool`**

执行Shell命令并返回输出。

| 特性 | 描述 |
|------|------|
| 超时控制 | 默认60秒超时 |
| 危险命令拦截 | 阻止 rm -rf, format, dd 等危险命令 |
| 工作目录限制 | 可限制在工作空间内执行 |
| 输出截断 | 超长输出自动截断 |

#### `web.py` - Web工具

| 类 | 功能描述 |
|----|----------|
| `WebSearchTool` | 使用Brave Search API搜索网络 |
| `WebFetchTool` | 获取URL内容并提取可读文本 |

**特性:**
- HTML转Markdown
- JSON响应支持
- URL安全验证
- 重定向限制

#### `message.py` - 消息工具

**类: `MessageTool`**

向用户发送消息到聊天渠道。

| 方法 | 功能描述 |
|------|----------|
| `set_context()` | 设置当前消息上下文 |
| `execute()` | 发送消息到指定渠道 |

#### `spawn.py` - 子代理工具

**类: `SpawnTool`**

生成后台子代理处理任务。

#### `cron.py` - 定时任务工具

**类: `CronTool`**

管理定时提醒和任务。

| 操作 | 功能描述 |
|------|----------|
| `add` | 添加定时任务 |
| `list` | 列出所有任务 |
| `remove` | 移除任务 |

---

### 3. Bus 模块 (`nanobot/bus/`)

消息总线，实现渠道与代理核心的解耦通信。

#### `events.py` - 事件类型

| 类 | 功能描述 |
|----|----------|
| `InboundMessage` | 从聊天渠道接收的消息 |
| `OutboundMessage` | 发送到聊天渠道的消息 |

**InboundMessage 属性:**
- `channel` - 渠道名称 (telegram, discord等)
- `sender_id` - 发送者标识
- `chat_id` - 聊天/频道标识
- `content` - 消息文本
- `media` - 媒体URL列表
- `metadata` - 渠道特定数据

#### `queue.py` - 消息队列

**类: `MessageBus`**

异步消息总线，解耦聊天渠道与代理核心。

| 方法 | 功能描述 |
|------|----------|
| `publish_inbound()` | 发布入站消息 |
| `consume_inbound()` | 消费入站消息（阻塞） |
| `publish_outbound()` | 发布出站消息 |
| `consume_outbound()` | 消费出站消息（阻塞） |
| `subscribe_outbound()` | 订阅出站消息 |
| `dispatch_outbound()` | 分发出站消息到订阅者 |

---

### 4. Providers 模块 (`nanobot/providers/`)

LLM提供商抽象层。

#### `base.py` - 提供商基类

**类: `LLMProvider` (抽象基类)**

| 方法 | 功能描述 |
|------|----------|
| `chat()` | 发送聊天完成请求 |
| `get_default_model()` | 获取默认模型 |

**数据类:**
- `ToolCallRequest` - LLM工具调用请求
- `LLMResponse` - LLM响应（内容、工具调用、使用量）

#### `registry.py` - 提供商注册表

**类: `ProviderSpec`**

定义单个LLM提供商的元数据。

| 字段 | 描述 |
|------|------|
| `name` | 配置字段名 |
| `keywords` | 模型名关键词（用于自动匹配） |
| `env_key` | LiteLLM环境变量名 |
| `litellm_prefix` | 模型名前缀 |
| `is_gateway` | 是否为网关（如OpenRouter） |
| `is_local` | 是否为本地部署 |

**支持的提供商:**
- OpenRouter (网关)
- AiHubMix (网关)
- Anthropic
- OpenAI
- DeepSeek
- Gemini
- Zhipu (智谱)
- DashScope (阿里云通义)
- Moonshot (Kimi)
- MiniMax
- vLLM (本地)
- Groq

#### `litellm_provider.py` - LiteLLM实现

**类: `LiteLLMProvider`**

使用LiteLLM实现多提供商支持。

| 方法 | 功能描述 |
|------|----------|
| `_setup_env()` | 设置环境变量 |
| `_resolve_model()` | 解析模型名（添加前缀） |
| `_apply_model_overrides()` | 应用模型特定参数覆盖 |
| `chat()` | 发送聊天请求 |
| `_parse_response()` | 解析LiteLLM响应 |

---

### 5. Channels 模块 (`nanobot/channels/`)

聊天渠道集成。

#### `base.py` - 渠道基类

**类: `BaseChannel` (抽象基类)**

| 方法 | 功能描述 |
|------|----------|
| `start()` | 启动渠道，开始监听消息 |
| `stop()` | 停止渠道 |
| `send()` | 发送消息 |
| `is_allowed()` | 检查发送者是否被允许 |
| `_handle_message()` | 处理入站消息 |

#### `manager.py` - 渠道管理器

**类: `ChannelManager`**

管理所有聊天渠道。

| 方法 | 功能描述 |
|------|----------|
| `_init_channels()` | 根据配置初始化渠道 |
| `start_all()` | 启动所有渠道 |
| `stop_all()` | 停止所有渠道 |
| `_dispatch_outbound()` | 分发出站消息 |
| `get_status()` | 获取所有渠道状态 |

**支持的渠道:**
- Telegram
- Discord
- WhatsApp
- Feishu (飞书)
- Mochat
- DingTalk (钉钉)
- Email
- Slack
- QQ

#### `telegram.py` - Telegram渠道

**类: `TelegramChannel`**

使用python-telegram-bot实现的Telegram渠道。

| 特性 | 描述 |
|------|------|
| 长轮询模式 | 无需公网IP |
| Markdown转HTML | 自动转换Markdown为Telegram HTML |
| 打字指示器 | 处理消息时显示"正在输入" |
| 语音转文字 | 支持Groq Whisper转录语音 |
| 媒体下载 | 支持图片、语音、文档 |

---

### 6. Config 模块 (`nanobot/config/`)

配置管理。

#### `schema.py` - 配置Schema

使用Pydantic定义的配置模型。

| 配置类 | 描述 |
|--------|------|
| `Config` | 根配置 |
| `ProvidersConfig` | LLM提供商配置 |
| `ChannelsConfig` | 聊天渠道配置 |
| `AgentsConfig` | 代理配置 |
| `ToolsConfig` | 工具配置 |
| `GatewayConfig` | 网关配置 |

**关键方法:**
- `get_provider()` - 获取匹配的提供商配置
- `get_api_key()` - 获取API密钥
- `get_api_base()` - 获取API基础URL

#### `loader.py` - 配置加载器

| 函数 | 功能描述 |
|------|----------|
| `get_config_path()` | 获取配置文件路径 |
| `load_config()` | 加载配置 |
| `save_config()` | 保存配置 |
| `convert_keys()` | camelCase转snake_case |
| `convert_to_camel()` | snake_case转camelCase |

---

### 7. Session 模块 (`nanobot/session/`)

会话管理。

#### `manager.py` - 会话管理器

**类: `Session`**

单个会话，存储消息历史。

| 方法 | 功能描述 |
|------|----------|
| `add_message()` | 添加消息 |
| `get_history()` | 获取LLM格式的消息历史 |
| `clear()` | 清空会话 |

**类: `SessionManager`**

管理所有会话。

| 方法 | 功能描述 |
|------|----------|
| `get_or_create()` | 获取或创建会话 |
| `save()` | 保存会话到磁盘 |
| `delete()` | 删除会话 |
| `list_sessions()` | 列出所有会话 |

---

### 8. Cron 模块 (`nanobot/cron/`)

定时任务服务。

#### `types.py` - 类型定义

| 类 | 描述 |
|----|------|
| `CronSchedule` | 调度定义（at/every/cron） |
| `CronPayload` | 任务负载 |
| `CronJobState` | 任务运行状态 |
| `CronJob` | 定时任务 |
| `CronStore` | 持久化存储 |

#### `service.py` - Cron服务

**类: `CronService`**

定时任务管理服务。

| 方法 | 功能描述 |
|------|----------|
| `start()` | 启动服务 |
| `stop()` | 停止服务 |
| `list_jobs()` | 列出任务 |
| `add_job()` | 添加任务 |
| `remove_job()` | 移除任务 |
| `enable_job()` | 启用/禁用任务 |
| `run_job()` | 手动运行任务 |

---

### 9. Heartbeat 模块 (`nanobot/heartbeat/`)

主动唤醒服务。

#### `service.py` - 心跳服务

**类: `HeartbeatService`**

定期唤醒代理检查任务。

| 方法 | 功能描述 |
|------|----------|
| `start()` | 启动心跳服务 |
| `stop()` | 停止服务 |
| `trigger_now()` | 手动触发心跳 |

**工作原理:**
1. 定期（默认30分钟）读取工作空间的 HEARTBEAT.md
2. 如果有可执行任务，发送给代理处理
3. 代理完成后回复 HEARTBEAT_OK

---

### 10. CLI 模块 (`nanobot/cli/`)

命令行接口。

#### `commands.py` - CLI命令

使用Typer实现的命令行工具。

| 命令 | 功能描述 |
|------|----------|
| `nanobot onboard` | 初始化配置和工作空间 |
| `nanobot agent` | 与代理交互 |
| `nanobot gateway` | 启动网关服务 |
| `nanobot status` | 显示状态 |
| `nanobot channels status` | 显示渠道状态 |
| `nanobot channels login` | WhatsApp设备链接 |
| `nanobot cron list` | 列出定时任务 |
| `nanobot cron add` | 添加定时任务 |
| `nanobot cron remove` | 移除定时任务 |

**agent命令选项:**
- `-m, --message` - 发送单条消息
- `-s, --session` - 会话ID
- `--markdown/--no-markdown` - Markdown渲染
- `--logs/--no-logs` - 显示运行日志

---

### 11. Utils 模块 (`nanobot/utils/`)

工具函数。

#### `helpers.py` - 辅助函数

| 函数 | 功能描述 |
|------|----------|
| `ensure_dir()` | 确保目录存在 |
| `get_data_path()` | 获取数据目录 (~/.nanobot) |
| `get_workspace_path()` | 获取工作空间路径 |
| `get_sessions_path()` | 获取会话存储目录 |
| `get_skills_path()` | 获取技能目录 |
| `timestamp()` | 获取ISO格式时间戳 |
| `truncate_string()` | 截断字符串 |
| `safe_filename()` | 转换为安全文件名 |
| `parse_session_key()` | 解析会话键 |

---

## 数据流图

```
用户消息
    ↓
[聊天渠道] (Telegram/Discord/...)
    ↓
[MessageBus] → publish_inbound()
    ↓
[AgentLoop] → consume_inbound()
    ↓
[ContextBuilder] → 构建提示词
    ↓
[LiteLLMProvider] → 调用LLM
    ↓
[ToolRegistry] → 执行工具
    ↓
[MessageBus] → publish_outbound()
    ↓
[ChannelManager] → dispatch_outbound()
    ↓
[聊天渠道] → send()
    ↓
用户收到响应
```

---

## 快速开始

### 安装

```bash
# 从源码安装（推荐开发使用）
git clone https://github.com/HKUDS/nanobot.git
cd nanobot
pip install -e .

# 或从PyPI安装
pip install nanobot-ai
```

### 初始化

```bash
nanobot onboard
```

### 配置

编辑 `~/.nanobot/config.json`:

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "sk-or-v1-xxx"
    }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-opus-4-5"
    }
  }
}
```

### 使用

```bash
# 单条消息
nanobot agent -m "你好！"

# 交互模式
nanobot agent

# 启动网关（连接聊天渠道）
nanobot gateway
```

---

## 许可证

MIT License

---

## 贡献

欢迎提交PR！代码库设计得小巧且可读，便于贡献。

## 致谢

- 受 [OpenClaw](https://github.com/openclaw/openclaw) 启发
- 使用 [LiteLLM](https://github.com/BerriAI/litellm) 实现多提供商支持
