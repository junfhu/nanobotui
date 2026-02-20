# Nanobot Web Interface

基于 React + Zustand + Vite 构建的 Nanobot Web 用户界面，支持聊天会话管理和配置管理功能。

## 功能特性

### 1. 聊天功能
- ✅ 会话列表管理（创建、切换、删除、重命名）
- ✅ 多轮对话
- ✅ Markdown 渲染
- ✅ 消息持久化
- ✅ 错误提示

### 2. 配置功能
- ✅ Agent 配置管理
- ✅ 渠道配置管理
- ✅ 提供商配置查看
- ✅ 配置保存功能

### 3. 系统状态
- ✅ 健康检查
- ✅ 服务状态展示

## 技术栈

- **React 19** - UI 框架
- **React Router** - 路由管理
- **Zustand** - 状态管理
- **React Markdown** - Markdown 渲染
- **i18next** - 国际化支持
- **Vite** - 构建工具

## 快速开始

### 1. 启动后端服务

```bash
# 进入后端目录
cd /mnt/d/AI/nanobot/nanobot-web

# 启动后端服务
python main.py
```

后端服务将在 http://0.0.0.0:8080 启动。

### 2. 启动前端服务

```bash
# 进入前端目录
cd /mnt/d/AI/nanobot/web-ui

# 安装依赖（首次运行）
npm install

# 启动前端开发服务器
npm run dev
```

前端服务将在 http://localhost:5173 启动。

### 3. 访问 Web 界面

打开浏览器，访问 http://localhost:5173 即可使用 Nanobot Web 界面。

## 使用指南

### 聊天功能

1. **创建会话**：点击左侧会话列表上方的 "新建会话" 按钮
2. **切换会话**：点击左侧会话列表中的会话项
3. **重命名会话**：点击会话项右侧的编辑图标
4. **删除会话**：点击会话项右侧的删除图标
5. **发送消息**：在聊天输入框中输入消息，按 Enter 发送
6. **查看消息**：消息会在聊天区域显示，支持 Markdown 渲染

### 配置功能

1. **Agent 配置**：在配置页面的 "代理" 标签页中，可设置 Max Tool Iterations 和 Max Execution Time
2. **渠道配置**：在配置页面的 "渠道" 标签页中，可启用/禁用不同的渠道
3. **提供商配置**：在配置页面的 "提供商" 标签页中，可查看已配置的提供商
4. **保存配置**：修改配置后，点击 "保存" 按钮保存更改

### 系统状态

在系统页面中，可查看服务的健康状态和运行模式。

## API 接口

Web 界面通过 `/api/v1` 端点与后端通信：

- `GET /api/v1/health` - 健康检查
- `GET /api/v1/chat/sessions` - 获取会话列表
- `POST /api/v1/chat/sessions` - 创建会话
- `DELETE /api/v1/chat/sessions/{id}` - 删除会话
- `PATCH /api/v1/chat/sessions/{id}` - 重命名会话
- `GET /api/v1/chat/sessions/{id}/messages` - 获取消息
- `POST /api/v1/chat/sessions/{id}/messages` - 发送消息
- `GET /api/v1/config` - 获取配置
- `PUT /api/v1/config/agent` - 更新代理配置
- `GET /api/v1/channels` - 获取渠道配置
- `PUT /api/v1/channels` - 更新渠道配置
- `GET /api/v1/providers` - 获取提供商配置
- `POST /api/v1/providers` - 创建提供商
- `GET /api/v1/status` - 获取系统状态

## 项目结构

```
web-ui/
├── src/
│   ├── components/     # 可复用组件
│   │   └── Layout.jsx  # 主布局和导航
│   ├── pages/          # 页面组件
│   │   ├── ChatPage.jsx      # 聊天页面
│   │   ├── ConfigPage.jsx    # 配置页面
│   │   └── SystemPage.jsx    # 系统状态页面
│   ├── services/       # 服务
│   │   └── api.js      # API 客户端
│   ├── store/          # 状态管理
│   │   └── index.js    # Zustand 存储
│   ├── i18n/           # 国际化
│   │   ├── locales/    # 语言文件
│   │   └── index.js    # i18n 初始化
│   ├── App.jsx         # 根组件
│   ├── main.jsx        # 应用入口
│   └── index.css       # 全局样式
├── index.html          # HTML 模板
├── package.json        # 项目配置
├── vite.config.js      # Vite 配置
└── README.md           # 项目说明
```

## 构建生产版本

```bash
# 进入前端目录
cd /mnt/d/AI/nanobot/web-ui

# 构建生产版本
npm run build
```

构建产物将输出到 `dist/` 目录。

## 预览生产构建

```bash
# 预览生产构建
npm run preview
```

## 国际化

当前支持中英文两种语言：
- 中文（默认）
- 英文

语言文件位于 `src/i18n/locales/` 目录。

## 常见问题

### 1. 后端服务启动失败

**问题**：`Error: [Errno 98] error while attempting to bind on address ('0.0.0.0', 8080): address already in use`

**解决方案**：端口 8080 已被占用，需要停止占用该端口的进程，然后重新启动后端服务。

```bash
# 查找并停止占用端口 8080 的进程
lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9

# 重新启动后端服务
python main.py
```

### 2. 前端依赖安装失败

**问题**：`npm install` 命令执行失败

**解决方案**：检查网络连接，确保 npm 源可用。可以尝试使用淘宝 npm 源：

```bash
# 使用淘宝 npm 源
npm install --registry=https://registry.npmmirror.com
```

### 3. 前端构建失败

**问题**：`npm run build` 命令执行失败

**解决方案**：检查代码是否有语法错误，确保所有依赖都已正确安装。

## 注意事项

1. **开发环境**：当前配置适用于开发环境，生产环境部署时需要修改相关配置。
2. **API 代理**：前端开发服务器已配置代理，将 `/api` 请求代理到后端服务。
3. **数据存储**：聊天会话数据存储在 `~/.nanobot/web/sessions/` 目录中。
4. **配置文件**：配置数据存储在 `~/.nanobot/config.json` 文件中。

## 版本信息

- Web UI 版本：v0.1.0
- 后端 API 版本：v0.1.0

## 联系方式

如有问题或建议，欢迎反馈。
