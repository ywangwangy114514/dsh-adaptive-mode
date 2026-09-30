# dsh-adaptive-mode · 自适应模式

为 DeepSeek Harness 增加一个名为 **自适应模式** 的 Agent 模式（预设），它的作用只有一件事：

> **解除会话的模式锁，让 AI 在工作中按需自行切换模式 —— 每次切换都会弹窗征求你的允许；你随时可以手动改回去。**

- 版本：**1.0.1**
- 模式 id：`adaptive`
- 模式描述：`让ai自己决定用什么模式`
- 平台：桌面端 / Web 端（DSH 0.2.x 的 `dsh-agent-preset` 预设模型）

### v1.0.1 变更

1. **工具与请求文案全部中文。** `switch_mode` 的工具描述、参数说明、审批弹窗理由、返回结果、`/mode` 输出都是中文。
2. **中文模式名可识别。** 出厂的 `standard` / `ptc` / `minimal` / `cordis` 四个预设在**宿主侧根本没有名字** —— 「标准模式」这些中文名只存在于客户端语言包里，所以 `/mode 标准模式`、以及模型直接传 `标准模式`，以前必然找不到。现在宿主侧目录会补上这些名字，并额外接受简称与「模式 / Mode」后缀：`标准`、`标准模式`、`standard`、`standard 模式`、`PTC MODE` 都各指向正确的那一行。
3. **老对话也能改模式，而且可以直接点。** 会话标题右边的模式标签旁多了一个可点击的模式控件（同一个 header 槽位，紧跟出厂标签），点开就是实时模式清单，选中即切换当前会话 —— 不再受「会话已开始就锁死」的限制。

---

## 1. 它解决了什么问题

DSH 里「模式」就是 **Agent 预设**：一份决定这个任务能用哪些工具、读哪些提示词、带哪些技能的清单。标准模式 / PTC 模式 / 极简模式 / 创造模式都是它，第三方插件（例如 minecraft-dev）注册的「Minecraft 专家」也是它。

预设注册表在切换模式时会做一次检查：

```js
// @deepseek-ai/dsh-agent-preset-registry
if (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)
  throw new RemoteError('agent-preset/locked', 'This session has already started')
```

也就是说：**任务一旦开始跑，模式就被锁死了**。会话创建时选了哪个模式，之后就一直是谁，AI 自己换不了，你也换不了（设置页里的模式选择器只对「以后新建的任务」生效）。

自适应模式把这个锁解开：

| 你的要求 | 实现方式 |
|---|---|
| 解除 AI 模式锁定 | 会话进入自适应模式即解锁；解锁状态对该 Agent 粘滞，之后来回切换都有效 |
| 允许 AI 按需自行切换模式 | 新增 `switch_mode` 工具，挂在**宿主层**，切走之后依然留在工具列表里 |
| 每次弹窗征求允许 | 每次切换都走 `ctx.approval.request()`，即 UI 上那个允许/拒绝弹窗 |
| 支持用户手动更改 | 新增 `/mode` 命令：列出模式、切换模式、解锁/上锁 |
| 支持不同 agent 不同模式 | 解锁状态、模式绑定都按 Agent（会话）记账；子代理各算各的 |
| 支持第三方插件新增的模式 | 模式清单每次调用时实时读 `agentPresets.list()`，第三方注册的模式自动出现 |
| 桌面端可用 | 就是一个普通 profile bundle，装在 `desktop` profile 里 |

---

## 2. 装了什么

bundle 补丁插入了两行，分处两个平面：

```
- id: adaptive-mode            # 宿主层运行时（工具 + 命令）
- id: preset-adaptive          # 模式本体：@deepseek-ai/dsh-agent-preset
```

**为什么工具要放在宿主层？**
如果 `switch_mode` 由自适应模式这个预设自己挂载，那么 AI 一旦切到别的模式，预设被换掉，工具跟着消失 —— AI 就被锁死在刚切过去的模式里，等于白做。放在宿主层，工具在所有会话的工具表里都在，只是**在解锁前会拒绝执行并告诉你怎么办**。

**模式本体是什么？**
是「标准模式」的完整子行清单 + 一段自适应模式的行为说明（persona）。所以它是一个能力完整的编码模式，不是残废版。代价是这份清单是抄来的副本：将来 DSH 更新标准模式时不会自动同步。抄而不是推导，是因为注册表只把预设子行渲染成 YAML 文本，把 `!!js` 条件再解析回 loader 表达式不是受支持的往返。

---

## 3. 安装

包目录：`D:\deepseek\dsh-adaptive-mode`。**用打包文件（tgz）安装**，不要传绝对目录：

```powershell
cd D:\deepseek\dsh-adaptive-mode
pnpm pack        # 改过源码后重新执行一次，生成 dsh-adaptive-mode-1.0.0.tgz
```

```
plugin_manager({ action: "install_bundle",
                 target: "D:\\deepseek\\dsh-adaptive-mode\\dsh-adaptive-mode-1.0.0.tgz" })
```

或者用侧边栏 Plugins 页。安装会把它写进 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`（追加在末尾，配置优先级最低，不会覆盖你已有的 patch）。

> **为什么不用绝对目录安装。** `install_bundle` 传目录会写成 `link:`，pnpm 生成的是 **junction**。DSH 的模块解析器把「profile 的 `node_modules` 里指向外部目录的链接」视为 out-of-tree **linked root**，走的是另一条不设边界的解析路径（会一路搜到 `<DSH_HOME>/profiles/node_modules` 那个旧副本）；tgz 安装则和 minecraft-dev、dsh-context 等插件一样，是 profile `node_modules` 下的**真实目录**，走标准路径。这条差异是实际踩出来的，所以这里固定用 tgz。
>
> 另外：**不要对它用 `Remove-Item -Recurse`**。如果它恰好是 junction，PowerShell 会顺着链接把目标目录的内容一起删掉。

### 3.1 装完必须重启 DeepSeek Harness

**完全退出再启动**（只关窗口不算）。两个原因：

1. Harness 的模块解析表在进程启动时建立，一个「本次进程里才进入 profile manifest」的 bundle 不在表里，它自己的模块导入不进来；
2. 预设的挂载失败是终局的 —— 已经失败的那份修订不会自己重试。

重启后两件事一起生效：「自适应模式」不再显示加载失败；运行时行（`switch_mode` 工具与 `/mode` 命令）启动。

### 3.2 验证

1. 设置 → 通用，模式卡片上「自适应模式」不再有红色「加载失败」角标。
2. 新建任务时模式选择器能选到它。
3. 会话里输入 `/mode`，能看到当前模式与全部可用模式（包括 Minecraft 专家等第三方模式）。
4. 让 Agent 调一次 `switch_mode`（不带参数），应返回同一份模式清单。

---

## 4. 怎么用

### 4.1 让 AI 自己决定（推荐）

新建任务时选「**自适应模式**」。之后 AI 需要时会自己调用 `switch_mode`：

- `switch_mode()` —— 不带参数，列出全部可用模式。
- `switch_mode({ mode: "minecraft", reason: "接下来要做 Minecraft 插件" })` —— 请求切换。

请求会先弹窗，你点允许才真的切。切换后工具表、提示词、技能从**下一步**开始变。你拒绝也没关系，AI 会留在当前模式继续。

### 4.2 用户手动改：点一下就行

**老对话直接点。** 会话标题栏（对话界面左上角）标题右边的模式标签旁，有一个可点击的模式控件：点开是**实时**模式清单（含第三方插件贡献的模式、含不可用标记），选中某项即以用户身份切换当前会话 —— 不弹审批框，也不受「会话已开始」限制。

> 出厂的那个模式标签本身是只读的（它的源码注释写明：那里放控件会「承诺一个宿主会拒绝的切换」）。本插件正是让宿主不再拒绝的那部分，所以旁边这个控件才是真的能用的入口；两个挨在一起，左边显示当前模式，右边点开切换。

也可以走命令，在任意会话里（不需要先进自适应模式）：

```
/mode                     查看当前模式 + 全部可用模式 + 锁定状态
/mode 极简模式            手动切到「极简模式」（用户发起的切换不弹窗）
/mode adaptive            切到自适应模式（同时解除模式锁）
/mode unlock              只解锁，不换模式 —— 让当前会话里的 AI 也能自己切
/mode lock                恢复模式锁
/mode help                用法
```

`/mode` 与 `switch_mode` 都接受：模式 id（`standard`、`ptc`、`minimal`、`cordis`、`adaptive`…）、中文模式名（`标准模式`、`极简模式`、`创造模式`、`自适应模式`、`Minecraft 专家`…）、以及省略「模式」二字的简称（`标准`、`极简`、`创造`）。大小写与空格不敏感。

### 4.3 每个 Agent 各自独立

解锁状态按会话 id 记账：你在 A 会话 `/mode unlock`，不影响 B 会话；某个子代理被切换了模式，父会话不变。

---

## 5. 审批与安全

每次 **AI 发起** 的切换都会走 DSH 的审批通道（`ctx.approval.request`），也就是工具执行许可那个弹窗；用户发起的 `/mode <目标>` 不弹窗（本来就是你在操作）。

- 结果是 `allowed-once` 才切换；`rejected` / `cancelled` / `unavailable` 一律留在原模式（fail closed）。
- **审批策略是 `never` 时不会弹窗**，请求会被自动拒绝。此时：
  - 默认（`onApprovalNever: deny`）：工具会带着解释拒绝，并建议你把权限预设切到带 `ask` 的一档（如「工作区写入」）。
  - 想在这种权限下也能切：把插件配置改成 `onApprovalNever: allow`，或者直接用 `/mode`。
- 批准只对那一次切换有效，没有「总是允许」。

**一个如实的说明**：`switch_mode` 在宿主层注册，所以它会出现在**每个**会话的工具表里，哪怕那个会话并没有解锁。这是为了保证「切走之后还能切回来」必须付的代价。未解锁时它只会返回一句带操作指引的拒绝，不会做任何事。

---

## 6. 配置

补丁行可以带 config，全部字段都有默认值：

```yaml
- id: adaptive-mode
  name: dsh-adaptive-mode/runtime
  config:
    presetId: adaptive          # 自适应模式的预设 id
    toolName: switch_mode       # 模型侧工具名
    commandName: mode           # 用户侧命令名（不带斜杠）
    requireApproval: true       # AI 发起的切换是否弹窗
    unlockScope: session        # session: 进入自适应模式后整个会话解锁
                                # mode:    只在身处自适应模式时解锁
    onApprovalNever: deny       # 审批策略为 never 时：deny 拒绝 / allow 直接切
```

---

## 7. 已知边界

- **模式锁是绕过而非移除。** 注册表的 `select()` 仍然会对已开始的会话抛 `agent-preset/locked`；本插件走的是 `recompose()` + 追加 `agent-preset/selected` —— 和 `select()` 在锁检查之后的写路径完全一致，但锁检查被有意跳过。UI 里的模式选择器行为不变。
- **解锁状态是进程内 + 日志重建。** 显式 `unlock` 的授权存在内存里，DSH 重启后丢失；但「会话以自适应模式创建」和「日志里出现过 `agent-preset/selected: adaptive`」都能从会话记录里重建，所以正常路径不受重启影响。
- **会话头控件是加装件，不是替换。** 出厂那个只读模式标签由 `@deepseek-ai/dsh-client-ui-agent-preset` 渲染，插件改不了它；本插件的可点控件排在同一个 header 槽位、紧挨其右侧。客户端模块是页面加载时注入的，所以升级后要**重启并刷新页面**才会出现。
- **模式清单是副本，且必须逐字段对齐。** 见第 2 节。预设挂载是「一行失败、整体拒绝」：子行少一个必填 config，整份预设就变成「加载失败」而无法选择。开发时踩过的具体坑是 `@deepseek-ai/dsh-plan-mode` 要求非空 `section`（`PlanModeConfig needs a string 'section'`），标准模式一直显式提供它。`test/preset-parity.test.mjs` 现在会逐字段比对两份清单，并要求每个 `plan-mode` 行都有非空 `section`。
- **切换发生在步骤之间才安全。** 工具表在下一步才会重新组装，所以 AI 被要求只在阶段边界切换。
- 第三方模式如果自身加载失败（`broken`），会被列出来但拒绝切换，并显示诊断。

---

## 8. 开发

```
node --test "test/*.test.mjs"
```

- `lib/core.js` 是零依赖的纯决策逻辑（模式匹配、解锁判定、审批结论、文案），上面这套测试直接跑它。
- `lib/index.js` 是 Cordis 接线层，负责注册工具与命令、读注册表、发审批、执行切换。
- `test/preset-parity.test.mjs` 比对 `cordis.patch.yml` 与出厂「标准模式」声明。打包版 DSH 把 `presets/standard.patch.yml` 放在 `app.asar` 里，普通 Node 测试读不到；要在这类环境里跑这个守护，把该文件解出来并指向它：

  ```powershell
  $env:DSH_STANDARD_PRESET = "C:\path\to\standard.patch.yml"
  node --test "test/*.test.mjs"
  ```

  找不到文件时该测试会跳过，不会误报失败。
