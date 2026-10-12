# Vessel Web UI 界面截图与功能导览

本目录归档了 Vessel Web 混合交互工作台在**中文版 (zh)** 与 **英文版 (en)** 两种语言环境下的全量界面预览与功能截图。

---

## 目录结构

```
docs/screenshots/
├── zh/                               # 中文版高清截图
│   ├── 01-workbench-overview.png     # 工作台全景预览图（双模态布局、侧边栏、状态栏）
│   ├── 02-provider-settings.png      # 多模型接入中枢（Card 215 模型拉取、协议与 API Key）
│   ├── 03-command-palette.png        # 全局极客命令面板（Ctrl+K 快捷动作与搜索）
│   ├── 04-new-session.png            # 新建会话面板（权限预设、动态模型发现、工作区）
│   ├── 05-customize-modules.png      # 模块自定义配置（Swarm、Cognition、Team 显隐）
│   └── 06-mobile-responsive-800px.png # 移动端 / 紧凑视口自适应布局
├── en/                               # 英文版高清截图（与中文版完全对称）
│   ├── 01-workbench-overview.png
│   ├── 02-provider-settings.png
│   ├── 03-command-palette.png
│   ├── 04-new-session.png
│   ├── 05-customize-modules.png
│   └── 06-mobile-responsive-800px.png
└── README.md                         # 本导览说明文档
```

---

## 核心界面功能说明

### 1. 工作台全景 (01-workbench-overview.png)
- **多会话侧边栏**：左侧展示项目工作区、历史会话主题列表、归档管理与子代理状态；
- **顶部控制台**：实时显示本地服务状态（版本 0.10.0）、模型设置入口、提示音开关、命令面板、模块定制与中英文切换；
- **双模态工作区**：对话主轴与模块扩展区清晰排布。

### 2. 模型与供应商接入中枢 (02-provider-settings.png - Card 215 核心)
- **快捷模板预设**：开箱即用支持 DeepSeek、OpenAI、Claude、Ollama 及自定义端点；
- **协议标准化**：规范命名为 `OpenAI 兼容 (OpenAI Compatible)` 与 `Anthropic (Claude)`；
- **一键拉取模型**：Card 215 新增「拉取模型」按钮，自动真实探测端点支持的模型列表并回填；
- **凭据安全**：API Key 保存在本机，支持删除供应商时的自动凭据清理与孤儿修复。

### 3. 全局极客命令面板 (03-command-palette.png - Ctrl+K)
- 键盘流一键呼出，支持模糊搜索最近会话、新建会话、切换权限模式（只读 / 工作区读写）、打开模型配置等操作。

### 4. 新建会话与模型选择 (04-new-session.png)
- 支持从已配置供应商中动态选择可用模型；
- 提供「只读探索」与「工作区读写」安全权限预设。

### 5. 模块定制面板 (05-customize-modules.png)
- 自由开关蜂群拓扑 (Swarm)、认知规则 (CognitiveRules)、团队任务 (Team) 等可视化功能区。

### 6. 移动端与紧凑视口 (06-mobile-responsive-800px.png)
- 在 800px 宽度下自适应折叠布局，侧边栏与主工作区自适应排版，保证便携设备与窄分屏体验。
