# dsh-adaptive-mode · 自适应模式 (Adaptive Mode)

An Agent mode (preset) for DeepSeek Harness that does exactly one thing:

> **Lift the session mode lock so the agent can change its own mode while it works — every switch asks you in a dialog first — and you keep `/mode` to change it back by hand.**

- Version: **1.0.1**
- Mode id: `adaptive`
- Mode description: `让ai自己决定用什么模式` ("let the AI decide which mode to use")
- Surfaces: desktop and Web (the `dsh-agent-preset` preset model of DSH 0.2.x)

### What changed in 1.0.1

1. **Chinese throughout.** The `switch_mode` description, its parameter docs, the approval prompt, every tool result, and all `/mode` output are Chinese.
2. **Chinese mode names resolve.** The four shipped presets (`standard`, `ptc`, `minimal`, `cordis`) have **no name on the host side at all** — 「标准模式」 and friends live only in the *client* locale dictionary. That is why `/mode 标准模式`, and a model passing `标准模式`, could never match. The host-side catalog now carries those names and accepts the short forms and a trailing 「模式」/`Mode`: `标准`, `标准模式`, `standard`, `standard 模式`, `PTC MODE` each land on the right row.
3. **Running conversations can change mode, by clicking.** A clickable mode control now sits in the session header right beside the shipped mode label; it lists the live roster and switches the current session — no longer blocked by "this session has already started".

---

## 1. The problem it solves

In DSH a "mode" is an **Agent preset**: the list that decides which tools, prompt sections and skills one task gets. 标准模式 / PTC 模式 / 极简模式 / 创造模式 are all presets, and so is any mode a third-party bundle registers (minecraft-dev's "Minecraft 专家", for example).

The preset registry refuses a mode change once a session has started:

```js
// @deepseek-ai/dsh-agent-preset-registry
if (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)
  throw new RemoteError('agent-preset/locked', 'This session has already started')
```

So the mode a task was created with is the mode it keeps: the agent cannot change it, and neither can you — the Settings mode picker only sets the default for tasks created *later*.

Adaptive mode removes that lock:

| Requirement | How it is met |
|---|---|
| Lift the agent's mode lock | Entering adaptive mode unlocks the session; the unlock is sticky for that agent, so later switches keep working |
| Let the agent switch on demand | A `switch_mode` tool registered on the **host plane**, so it survives switching *away* from adaptive mode |
| Ask the user every time | Every agent-initiated switch goes through `ctx.approval.request()` — the allow/deny dialog in the UI |
| Let the user change it too | A `/mode` command: list modes, switch, unlock, lock |
| Per-agent modes | Unlock state and mode binding are keyed by agent (session); children keep their own |
| Third-party modes | The catalog is re-read from `agentPresets.list()` on every call, so plugin-contributed modes appear automatically |
| Desktop | An ordinary profile bundle, installed into the `desktop` profile |

---

## 2. What gets installed

The bundle patch inserts two rows on two different planes:

```
- id: adaptive-mode            # host-plane runtime (tool + command)
- id: preset-adaptive          # the mode itself: @deepseek-ai/dsh-agent-preset
```

**Why the tool lives on the host plane.** If `switch_mode` were mounted by the adaptive preset, the moment the agent switched away the preset would be replaced, the tool would vanish, and the agent would be locked into whatever it had switched to — the exact failure adaptive mode exists to prevent. On the host plane the tool stays in every session's catalog; until the session is unlocked it refuses, with instructions, and does nothing else.

**What the mode itself is.** The shipped 标准模式 child list plus a persona describing adaptive behaviour, so it is a fully capable coding mode rather than a reduced one. The cost is that this list is a copy: a future change to 标准模式 does not propagate here. Copying beats deriving because the registry only ever renders a preset's rows back as YAML text, and re-parsing `!!js` conditions into loader expressions is not a supported round trip.

---

## 3. Install

Package directory: `D:\deepseek\dsh-adaptive-mode`. **Install from the packed tarball**, never by absolute directory:

```powershell
cd D:\deepseek\dsh-adaptive-mode
pnpm pack        # re-run after a source change; writes dsh-adaptive-mode-1.0.0.tgz
```

```
plugin_manager({ action: "install_bundle",
                 target: "D:\\deepseek\\dsh-adaptive-mode\\dsh-adaptive-mode-1.0.0.tgz" })
```

Equivalently, the sidebar Plugins page. Installation appends the bundle to `~/.dsh/profiles/desktop/package.json`'s `dsh.profile.bundles`, so it has the lowest configuration precedence and overrides nothing you already patched.

> **Why not an absolute directory.** `install_bundle` turns a directory into `link:`, and pnpm materializes that as a **junction**. DSH's module resolver treats a link under the profile's `node_modules` that points outside as an out-of-tree **linked root**, which takes a different, unbounded resolution path — one that walks up into `<DSH_HOME>/profiles/node_modules`, where a stale DSH copy lives. A tarball install is a **real directory** under the profile's `node_modules`, exactly like minecraft-dev and dsh-context, and takes the standard path. This was found the hard way, which is why the tarball is the supported shape.
>
> Also: **never `Remove-Item -Recurse` this package.** When it is a junction, PowerShell follows the link and deletes the target's contents too.

### 3.1 Restart DeepSeek Harness afterwards

**Quit the application completely and start it again** — closing the window is not enough. Two reasons:

1. Harness builds its module-resolution table at process start, so a package that only entered the profile manifest during this process is not in it, and its own modules cannot be imported;
2. a preset mount failure is final — the failed revision is never retried on its own.

One restart brings up both the healthy 「自适应模式」 card and the runtime row (`switch_mode` + `/mode`).

### 3.2 Verify

1. Settings → General: the 「自适应模式」 card no longer carries a red 「加载失败」 badge.
2. The new-task mode picker offers it.
3. `/mode` in a session lists the current mode and every available mode, including third-party ones such as Minecraft 专家.
4. Ask the agent to call `switch_mode` with no arguments; it should return that same catalog.

---

## 4. Using it

### 4.1 Let the agent decide (the intended path)

Create the task in 「自适应模式」. When it needs to, the agent calls:

- `switch_mode()` — no arguments; lists every available mode.
- `switch_mode({ mode: "minecraft", reason: "next phase is Minecraft plugin work" })` — requests a switch.

The request opens a dialog; the switch happens only if you allow it. Your tool catalog, prompt sections and skills change from the agent's **next step**. If you refuse, the agent stays put and carries on.

### 4.2 Change it by hand

In any session (no need to be in adaptive mode first):

```
/mode                     current mode + every available mode + lock state
/mode 极简模式            switch to 「极简模式」 (user-initiated: no dialog)
/mode adaptive            switch to adaptive mode (and lift the lock)
/mode unlock              lift the lock without switching
/mode lock                restore the lock
/mode help                usage
```

Targets match mode ids (`standard`, `ptc`, `adaptive`, …) or display names (`标准模式`, `Minecraft 专家`, …), case-insensitively.

### 4.3 Per agent

Unlock state is keyed by session id: `/mode unlock` in session A does not unlock session B, and switching a subagent's mode leaves its parent untouched.

---

## 5. Approval and safety

Every **agent-initiated** switch goes through DSH's approval channel (`ctx.approval.request`) — the same dialog that guards tool execution. A user-typed `/mode <target>` does not ask, because the user is the one acting.

- Only `allowed-once` switches. `rejected`, `cancelled` and `unavailable` all stay in the current mode (fail closed).
- **Under the `never` approval policy there is no dialog**; requests are rejected deterministically. Then:
  - default (`onApprovalNever: deny`): the tool refuses with an explanation and suggests moving to a permission preset that includes `ask` (工作区写入, for instance);
  - `onApprovalNever: allow`: switch without asking; or just use `/mode`.
- A grant covers that one switch only. There is no "always allow".

**One honest caveat:** because `switch_mode` is registered on the host plane it appears in *every* session's catalog, including sessions that are not unlocked. That is the price of keeping the escape hatch alive after the agent switches away. When locked it returns a refusal with instructions and performs no action.

---

## 6. Configuration

The runtime row accepts a config; every field has a default:

```yaml
- id: adaptive-mode
  name: dsh-adaptive-mode/runtime
  config:
    presetId: adaptive          # preset id of the adaptive mode
    toolName: switch_mode       # model-facing tool name
    commandName: mode           # human command name (no slash)
    requireApproval: true       # ask before an agent-initiated switch
    unlockScope: session        # session: entering adaptive mode unlocks the whole session
                                # mode:    unlocked only while sitting in adaptive mode
    onApprovalNever: deny       # under the never policy: deny explains / allow switches
```

---

## 7. Known limits

- **The lock is bypassed, not removed.** The registry's `select()` still raises `agent-preset/locked` for a started session; this plugin uses `recompose()` plus an `agent-preset/selected` append — the same write path `select()` takes *after* its check, with the check deliberately skipped. The UI's mode picker is unchanged.
- **The unlock is in-process plus log-derived.** An explicit `/mode unlock` grant lives in memory and is lost on a Harness restart; "the session was created with adaptive mode" and "the log records `agent-preset/selected: adaptive`" are both reconstructed from the session log, so the normal paths survive a restart.
- **The mode list is a copy and must stay field-aligned.** See section 2. A preset mounts all-or-nothing: one child row short of a required config turns the whole mode into 「加载失败」 and makes it unselectable. The concrete trap hit during development is `@deepseek-ai/dsh-plan-mode`, which rejects a config without a non-empty `section` (`PlanModeConfig needs a string 'section'`) — 标准模式 has always supplied one. `test/preset-parity.test.mjs` now diffs the two lists field by field and requires every `plan-mode` row to carry a section.
- **Switching is only safe between steps.** The tool catalog is reassembled for the next model request, which is why the agent is told to switch at phase boundaries.
- A third-party mode whose own activation failed is listed but refuses switching, showing its diagnostic.

---

## 8. Development

```
node --test "test/*.test.mjs"
```

- `lib/core.js` holds the dependency-free decision logic (mode matching, unlock rules, approval verdicts, wording) and is what the core tests drive.
- `lib/index.js` is the Cordis wiring: registers the tool and command, reads the registry, requests approval, performs the switch.
- `test/preset-parity.test.mjs` diffs `cordis.patch.yml` against the shipped 标准模式 declaration. A packaged DSH keeps `presets/standard.patch.yml` inside `app.asar`, which a bare Node test cannot read; to run the guard there, extract that file and point at it:

  ```powershell
  $env:DSH_STANDARD_PRESET = "C:\path\to\standard.patch.yml"
  node --test "test/*.test.mjs"
  ```

  The test skips when the file cannot be located, so it never reports a false failure.
