# Nanobot Web 配套项目

这是一个服务于 **Nanobot** 的轻量 Web 配套项目。

## 项目定位

本项目面向 **Nanobot 用户**，核心目标是降低配置复杂度，提供更直观的 Web 配置与聊天入口。关于Nanobot的介绍和安装，请参考https://github.com/hKUDS/nanobot，我这里只是保留了原来的代码。


## 重要说明

1. 本项目是给 Nanobot 用的，重点解决“配置繁琐”问题。
2. 本项目**不会修改** Nanobot 核心源码。
3. 你可以独立升级 Nanobot，但不同版本之间可能存在兼容性问题。
4. 项目实际代码目录为：
- `nanobot-web/`（后端，FastAPI）
- `web-ui/`（前端，React + Vite）

## 快速启动

前置要求：
- Python 3.12
- Node.js 22

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

启动前端：
```bash
npm --prefix web-ui run dev
```
前端地址：`http://localhost:5173`

浏览器访问：
- `http://localhost:5173`

默认登录账号：
- 用户名：`admin`
- 密码：`Password123!`

## 兼容性说明

- Nanobot 可以独立更新。
- 若 Nanobot 发生不兼容变更，本项目可能需要同步更新。
