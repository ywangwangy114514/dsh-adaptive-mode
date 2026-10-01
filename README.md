**中文** | [English](dsh-adaptive-mode/README.md)

# dsh-adaptive-mode · 自适应模式

为 DeepSeek Harness 增加一个名为 **自适应模式** 的 Agent 模式（预设）。

它只做一件事：**解除会话的模式锁。**

DSH 里「模式」就是 Agent 预设 —— 一份决定这个任务能用哪些工具、读哪些提示词、带哪些技能的工具清单。标准模式 / PTC 模式 / 极简模式 / 创造模式都是它，第三方插件（例如 minecraft-dev 的「Minecraft 专家」）注册的也是它。

预设注册表在切换时会做一次检查：

```js
// @deepseek-ai/dsh-agent-preset-registry
if (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)
  throw new RemoteError('agent-preset/locked', 'This session has already started')
```

结果就是：**任务一旦开跑，模式就锁死了** —— AI 自己换不了，你也换不了。设置页里的模式选择器只对「以后新建的任务」生效。

装上这个插件之后：

| | |
|---|---|
| AI 自己切 | `switch_mode` 工具，**每次切换都弹窗征求你允许** |
| 你手动切 | 会话标题旁的**可点击模式控件**，或 `/mode` 命令；**老对话也能改** |
| 中文模式名 | `标准模式`、`极简`、`创造模式`… 都认得 |
| 各自独立 | 解锁状态按会话记账，子代理各算各的 |
| 第三方模式 | 模式清单实时读取，插件新增的模式自动出现 |

## 安装

```powershell
# 在 DeepSeek Harness 里让 Agent 执行，或直接说「帮我装这个插件」
plugin_manager({ action: "install_bundle", target: "D:\\path\\to\\dsh-adaptive-mode-1.0.1.tgz" })
```

也可以走侧边栏 **插件** 页。装完**完全退出 Harness 再启动**一次（客户端模块是启动时加载的），新建任务时就能选到「自适应模式」。

> 不要用绝对目录安装。传目录会让 pnpm 生成 junction，DSH 的解析器会把它当作 out-of-tree linked root，走一条会搜到旧 DSH 副本的解析路径；用 tgz 装才是 profile `node_modules` 下的真实目录，和 minecraft-dev、dsh-context 一样。

## 用法

**让 AI 自己决定** —— 新建任务时选「自适应模式」。之后它需要时会调 `switch_mode`，弹窗由你点。

**自己动手** —— 会话标题右边点那个模式控件，选一个即可。老对话一样管用。

**命令行**：

```
/mode                 查看当前模式 + 全部可用模式 + 锁定状态
/mode 极简模式         切到「极简模式」
/mode unlock          只解锁不换模式 —— 让当前会话里的 AI 也能自己切
/mode lock            恢复模式锁
```

## 文档

- [插件完整说明（中文）](dsh-adaptive-mode/README.zh.md) — 设计取舍、配置项、审批与安全、已知边界
- [Full plugin README (English)](dsh-adaptive-mode/README.md)

## 开发

```
cd dsh-adaptive-mode
node --test "test/*.test.mjs"
```

## 许可

[MIT](dsh-adaptive-mode/LICENSE)
