# dsh-git-sidebar

[English](README.md) | 简体中文

用于 DeepSeek Harness Web 的可拖拽右侧 Git 侧栏。跟随当前工作区、列出变更文件、用你正在使用的模型生成提交信息，并支持提交 / 推送 / 拉取。

## 功能

- **跟随当前工作区**——面板自动切换到你选中的会话所属项目，自动解析 Git 仓库根目录（从工作区向上查找，找不到再向下扫一级子目录）。
- **可拖拽的右侧入口**——窗口右边缘的竖条按钮，可沿边缘上下拖动位置，点击开合面板。
- **变更列表**——按已暂存 / 未暂存分组，带状态徽标（M/A/D/R/?），点击文件即可暂存或取消暂存，支持一键全部暂存。
- **分支切换**——分支下拉框列出本地与远程分支；切换前若工作区有未提交变更会弹出警告。
- **AI 生成提交信息**——✨ 按钮基于 `git status` + `git diff HEAD`，调用当前会话默认模型（走 harness `llm` 服务）生成 Conventional Commits 风格的中文提交信息，并填入注释框供你编辑。
- **操作按钮**——提交（可选包含全部更改）、推送、拉取、刷新。

## 安装

```sh
dsh plugin --profile web add dsh-git-sidebar
```

或从本仓库安装：

```sh
dsh plugin --profile web add "github:adamaik/dsh-git-sidebar#main"
```

## 使用

窗口右边缘出现 Git 竖条按钮：点击打开面板，按住可上下拖动。在左侧栏选择某工作区的会话，面板即切换到该项目的 git 状态。

## 原理

- **宿主半**（`lib/index.js`）：通过 `webServer` 服务注册 JSON 路由，用 `shell` 服务执行 git 命令；AI 生成提交信息的接口通过 `llm.stream` 调用当前默认模型。
- **浏览器半**（`lib/client.js`）：一个注册到 `shell.overlay` 的 `dsh.client` 模块，通过 fetch 调用宿主路由并渲染 React UI。

## 开发

```sh
node --check lib/index.js
node --check lib/client.js
```

## License

MIT