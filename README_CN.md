# Nanobot Web 配套项目

为 [Nanobot](https://github.com/hKUDS/nanobot) 提供现代化的浏览器界面，支持聊天、配置和管理。

**内置 Nanobot 核心版本：v0.1.4.post6**

## 功能特性

### 聊天
- **实时流式输出** — 逐 token 输出，带打字光标动画（ChatGPT 风格）
- **Markdown 渲染** — 代码高亮、表格、GFM 支持，一键复制代码块
- **文件上传** — 附加文件供 AI 分析
- **语音输入** — 浏览器语音识别 & 录音后端转写
- **会话管理** — 新建、重命名、删除对话
- **会话搜索** — 按标题过滤会话（Ctrl+K）
- **聊天导出** — 导出为 Markdown 或 JSON 格式
- **虚拟滚动** — 长对话也能流畅滚动

### 配置
- **Agent 设置** — 模型、提供商、温度、上下文窗口、最大工具迭代次数、推理力度、时区
- **渠道管理** — Telegram、微信、企业微信、Matrix 等
- **MCP 服务** — 添加/删除 Model Context Protocol 服务
- **Skills 管理** — 查看和管理 Agent 技能
- **备份与恢复** — 配置导出/导入到本机
- **热重启** — 配置变更后在界面内重启后端

### 系统
- 健康监控与服务状态面板
- 登录认证与密码管理

### 快捷键
| 快捷键 | 功能 |
|---|---|
| Ctrl+N | 新建会话 |
| Ctrl+K | 聚焦会话搜索 |
| Escape | 关闭弹窗 / 清除搜索 |
| Enter | 发送消息 |
| Shift+Enter | 消息内换行 |

## 项目结构

```
nanobotui/
  nanobot/         # Nanobot 核心 (v0.1.4.post6) — Anthropic + OpenAI 提供商
  nanobot-web/     # 后端 — FastAPI，SSE 流式推送，会话/配置 API
  web-ui/          # 前端 — React 19, Vite, Ant Design, Zustand, 国际化 (en/zh-CN)
```

## 快速启动

前置要求：
- Python >= 3.11
- Node.js >= 18

安装依赖：
```bash
pip install -r nanobot-web/requirements.txt
npm --prefix web-ui install
```

启动后端：
```bash
python nanobot-web/main.py
```
后端地址：`http://localhost:8080`

启动前端（开发模式）：
```bash
npm --prefix web-ui run dev
```
前端地址：`http://localhost:5173`

生产构建：
```bash
npm --prefix web-ui run build
# 用任意静态文件服务器托管 web-ui/dist/，或让 nanobot-web 直接提供服务
```

默认登录账号：
- 用户名：`admin`
- 密码：`Password123!`

## 兼容性说明

- Nanobot 核心位于 `nanobot/` 目录，可独立更新。
- 若 Nanobot 引入不兼容的 API 变更，本项目可能需要同步更新。

## 许可证

MIT
