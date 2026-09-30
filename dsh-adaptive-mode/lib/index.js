/**
 * `dsh-adaptive-mode` — the 自适应模式 runtime half.
 *
 * The mode (Agent preset) itself is declared by this bundle's
 * `cordis.patch.yml`. This row is the part a preset cannot own:
 *
 * - The `switch_mode` tool is registered on the **host plane**, so it stays in
 *   the calling agent's catalog after the agent has switched *away* from
 *   adaptive mode. A tool mounted by the preset would vanish with the preset,
 *   and the agent would be locked into whatever it switched to — exactly the
 *   lock adaptive mode exists to remove.
 * - The `/mode` command is registered globally for the same reason: the user
 *   must be able to change a live session's mode, and that is the one action the
 *   shipped UI does not offer (its mode picker only sets the default for tasks
 *   created later).
 *
 * Both entry points route through the same path: resolve the target against the
 * live `agentPresets` roster (so third-party modes are picked up), ask the user
 * where an ask is possible, then `recompose` the calling agent and record
 * `agent-preset/selected` — the same durable write `agentPresets.select()`
 * performs after its own "session already started" refusal.
 *
 * @module dsh-adaptive-mode
 */

import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  approvalNeverMessage,
  approvalVerdict,
  historySelected,
  lockedMessage,
  normalizeModes,
  renderModeList,
  resolveMode,
  unlockDecision,
} from './core.js'

/** Cordis plugin name. */
export const name = 'adaptive-mode'

/**
 * Hard dependencies.
 *
 * `agentPresets` is injected rather than read with `ctx.get` because the
 * registry row is inserted at the end of the web patch and initializes
 * asynchronously: injecting holds this row until the real service exists, which
 * is also what makes a capability probe meaningful.
 */
export const inject = ['tools', 'agentPresets']

/** Package version, mirroring `package.json`. */
export const version = '1.0.0'

/** Deployment configuration. Every field has a default, so the row needs no config. */
export const Config = Schema.object({
  /** Preset id of the adaptive mode declared by this bundle. */
  presetId: Schema.string().default('adaptive'),
  /** Name of the model-facing switching tool. */
  toolName: Schema.string().default('switch_mode'),
  /** Name of the human `/mode` command (without the slash). */
  commandName: Schema.string().default('mode'),
  /** Ask the user through the approval dialog before every agent-initiated switch. */
  requireApproval: Schema.boolean().default(true),
  /** `session`: entering adaptive mode unlocks the agent for the rest of its session. `mode`: only while it is in adaptive mode. */
  unlockScope: Schema.string().default('session'),
  /** Behaviour when the approval policy is `never`: `deny` refuses with an explanation, `allow` switches without asking. */
  onApprovalNever: Schema.string().default('deny'),
})

const TOOL_DESCRIPTION = [
  '切换本 Agent 会话的模式（Agent 预设），或列出当前部署提供的全部模式。',
  '只有会话进入「自适应模式」之后才可用；在此之前调用会被拒绝，并返回如何解锁的说明。',
  '不带参数调用：列出全部模式，包括第三方插件贡献的模式。',
  '带 `mode` 调用：切换到指定的模式。`mode` 可以用模式 id（如 standard、ptc、minimal、cordis、adaptive），也可以用中文模式名（如「标准模式」「极简模式」「创造模式」「自适应模式」）；只写「标准」「极简」这类简称也认。',
  '切换前会弹窗征求用户允许，用户拒绝则留在当前模式。请在 `reason` 里写清楚为什么要切换，用户会先看到这段理由再决定。',
  '切换会替换你的工具表、提示词段与技能，从下一步开始生效；请在阶段边界处切换，不要在一步中间切换。',
].join('')

/** Schema of one catalog entry, shared by the tool output and the tool result render. */
const MODE_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    broken: { type: 'string' },
  },
}

/**
 * Project a catalog entry onto the declared tool-output shape.
 *
 * `normalizeModes` keeps `aliases` for matching only; the output schema is
 * closed, so the extra field must not reach the wire.
 * @param {readonly { id: string, name: string, description?: string, broken?: string }[]} modes - catalog.
 * @returns {object[]} wire-shaped entries.
 */
function publicModes(modes) {
  return modes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    ...mode.description === undefined ? {} : { description: mode.description },
    ...mode.broken === undefined ? {} : { broken: mode.broken },
  }))
}

/**
 * Register the adaptive-mode tool and command.
 * @param {import('@deepseek-ai/cordis').Context} ctx - registrant context, on the host plane.
 * @param {object} config - resolved {@link Config}.
 */
export function apply(ctx, config) {
  const presetId = config.presetId
  const toolName = config.toolName
  const commandName = config.commandName
  const requireApproval = config.requireApproval
  const unlockScope = config.unlockScope === 'mode' ? 'mode' : 'session'
  const onApprovalNever = config.onApprovalNever === 'allow' ? 'allow' : 'deny'
  const logger = ctx.logger ?? console

  /** Explicit in-memory unlocks, keyed by agent (session) id. */
  const granted = new Set()

  /** Read the live mode catalog. */
  const catalog = async () => normalizeModes(await ctx.agentPresets.list())

  /** Read the preset a live agent is bound to, tolerating an older registry. */
  const currentModeOf = (agent) => {
    try {
      return typeof ctx.agentPresets.composedPreset === 'function'
        ? ctx.agentPresets.composedPreset(agent.ctx)
        : undefined
    } catch (error) {
      logger.warn?.(`adaptive-mode: could not read the composed preset: ${String(error)}`)
      return undefined
    }
  }

  /**
   * Whether this agent may change its own mode, remembering a sticky grant.
   *
   * The session log is scanned only when the cheap facts are inconclusive, so
   * the steady state (already unlocked) costs one lookup in `granted`.
   */
  const unlockedFor = (agent) => {
    const facts = {
      presetId,
      unlockScope,
      granted: granted.has(agent.id),
      currentPreset: currentModeOf(agent),
      headerPreset: agent.session?.header?.agentPreset,
      historyPreset: false,
    }
    const decision = unlockDecision(facts)
    if (decision.unlocked) {
      if (decision.sticky) granted.add(agent.id)
      return decision
    }
    if (!historySelected(readEvents(agent), presetId)) return decision
    const viaHistory = unlockDecision({ ...facts, historyPreset: true })
    if (viaHistory.sticky) granted.add(agent.id)
    return viaHistory
  }

  /** Read the session log defensively; a partial session must not break the gate. */
  function readEvents(agent) {
    try {
      return typeof agent.session?.snapshotEvents === 'function' ? agent.session.snapshotEvents() : []
    } catch {
      return []
    }
  }

  /** The effective approval policy for one agent, as far as this plugin can see it. */
  const policyOf = (agent) => {
    try {
      return ctx.get('approval')?.overrideOf?.(agent.session)
    } catch {
      return undefined
    }
  }

  /**
   * Rebind the calling agent to another mode and record the durable selection.
   *
   * This mirrors the registry's own `select()` write path after its lock check;
   * the lock check is precisely what adaptive mode is allowed to skip.
   */
  const switchAgent = async (agent, target, source) => {
    await ctx.agentPresets.recompose(agent.ctx, target)
    agent.session.append('agent-preset/selected', { agentPreset: target })
    logger.info?.(`adaptive-mode: ${source} switched session ${String(agent.id)} to mode '${target}'`)
  }

  /**
   * Resolve the target and, when the caller is the model, ask the user first.
   * @returns {Promise<string>} the refusal text when the switch did not happen.
   */
  const performSwitch = async ({ agent, modes, target, reason, ask, exec }) => {
    if (target.broken !== undefined) {
      throw new Error(`模式「${target.name}」(${target.id}) 当前不可用：${target.broken}`)
    }
    const current = currentModeOf(agent)
    if (current === target.id) return { kind: 'unchanged', current, message: `已经处于「${target.name}」模式，无需切换。` }

    if (ask) {
      if (policyOf(agent) === 'never') {
        const explanation = approvalNeverMessage(commandName, onApprovalNever)
        if (explanation !== undefined) throw new Error(explanation)
      } else if (requireApproval) {
        const approval = ctx.get('approval')
        if (approval === undefined) {
          throw new Error('没有可用的审批服务（approval），无法征求用户允许；本次模式切换被拒绝（fail closed）。')
        }
        const outcome = await approval.request({
          agent,
          toolName,
          callId: exec?.callId,
          reason: typeof reason === 'string' && reason.trim() !== ''
            ? `切换到「${target.name}」模式：${reason.trim()}`
            : `切换到「${target.name}」模式`,
          displayReason: {
            en: `Switch this session to "${target.name}" mode?${reason ? ` Reason: ${reason}` : ''}`,
            'zh-CN': `要把本会话切换到「${target.name}」模式吗？${reason ? `理由：${reason}` : ''}`,
          },
          signal: exec?.signal,
        })
        const verdict = approvalVerdict(outcome)
        if (!verdict.allowed) throw new Error(verdict.message)
      }
    }

    await switchAgent(agent, target.id, ask ? 'agent' : 'user')
    return { kind: 'switched', previous: current, current: target.id, message: `已切换到「${target.name}」模式（${target.id}），新的工具与提示词从下一步开始生效。` }
  }

  // ── the model-facing tool ────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: toolName,
    description: TOOL_DESCRIPTION,
    parameters: {
      mode: {
        type: 'string',
        description: '目标模式：id（standard / ptc / minimal / cordis / adaptive 等）或中文模式名（标准模式、极简模式、创造模式、自适应模式，也接受「标准」这类简称）。省略则只列出全部模式，不切换。',
      },
      reason: {
        type: 'string',
        description: '切换原因（简短一句），弹窗里会展示给用户。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['list', 'switched', 'unchanged'] },
          message: { type: 'string', required: true },
          previous: { type: 'string' },
          current: { type: 'string' },
          modes: { type: 'array', items: MODE_ENTRY_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('switch_mode 需要属于某个 Agent 会话。')
      const decision = unlockedFor(agent)
      const modes = await catalog()

      if (typeof args.mode !== 'string' || args.mode.trim() === '') {
        return {
          kind: 'list',
          current: currentModeOf(agent),
          modes: publicModes(modes),
          message: decision.unlocked
            ? renderModeList(modes, currentModeOf(agent))
            : `${renderModeList(modes, currentModeOf(agent))}\n\n(当前会话尚未解锁模式切换：${lockedMessage({ presetId, currentPreset: currentModeOf(agent), commandName })})`,
        }
      }

      if (!decision.unlocked) {
        throw new Error(lockedMessage({ presetId, currentPreset: currentModeOf(agent), commandName }))
      }

      const target = resolveMode(modes, args.mode)
      if (target === undefined) {
        throw new Error(`找不到模式「${args.mode}」。\n${renderModeList(modes, currentModeOf(agent))}`)
      }

      const result = await performSwitch({
        agent,
        modes,
        target,
        reason: args.reason,
        ask: true,
        exec,
      })
      return { kind: result.kind, message: result.message, previous: result.previous, current: result.current }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.mode ? `切换模式 → ${args.mode}` : '列出可用模式',
      kind: 'other',
      rawInput: args,
    }),
  }))

  // ── the human command ────────────────────────────────────────────────────

  const commands = ctx.get('commands')
  if (commands === undefined) {
    logger.warn?.(`adaptive-mode: no command registry is composed; /${commandName} is unavailable.`)
    return
  }

  const usage = `用法: /${commandName} [<模式id或名称> | unlock | lock | list | help]`

  const renderCurrent = async (agent) => {
    const modes = await catalog()
    const decision = unlockedFor(agent)
    return [
      renderModeList(modes, currentModeOf(agent)),
      `模式切换: ${decision.unlocked ? `已解除锁定（${decision.because}）` : '已锁定'}`,
      usage,
    ].join('\n')
  }

  const runModeCommand = async (invocation) => {
    const agent = invocation.agent
    const input = invocation.rawInput.trim()
    const control = input.toLowerCase()

    try {
      if (input === '' || control === 'list') {
        return { kind: 'success', text: await renderCurrent(agent) }
      }
      if (control === 'help') {
        return {
          kind: 'success',
          text: [
            usage,
            `  /${commandName}           查看当前模式与全部可用模式`,
            `  /${commandName} <模式>    手动切换（用户发起的切换不需要审批弹窗）`,
            `  /${commandName} unlock    解除本会话的模式锁（等价于先进入自适应模式）`,
            `  /${commandName} lock      恢复本会话的模式锁`,
          ].join('\n'),
        }
      }
      if (control === 'unlock') {
        granted.add(agent.id)
        const current = currentModeOf(agent)
        return {
          kind: 'success',
          text: `已解除本会话的模式锁，Agent 现在可以通过 ${toolName} 自行切换模式（每次切换仍会弹窗征求你的允许）。当前模式: ${current ?? '未知'}。`,
        }
      }
      if (control === 'lock') {
        granted.delete(agent.id)
        const current = currentModeOf(agent)
        return {
          kind: 'success',
          text: current === presetId
            ? `本会话目前正处于自适应模式，锁仍会因该模式而解除；先用 /${commandName} <其他模式> 切走再执行 lock。`
            : `已恢复本会话的模式锁，Agent 不能再自行切换模式。当前模式: ${current ?? '未知'}。`,
        }
      }

      const modes = await catalog()
      const target = resolveMode(modes, input)
      if (target === undefined) {
        return {
          kind: 'error',
          text: `找不到模式「${input}」。\n${renderModeList(modes, currentModeOf(agent))}`,
        }
      }
      const result = await performSwitch({ agent, modes, target, ask: false })
      if (target.id === presetId) granted.add(agent.id)
      return { kind: 'success', text: result.message }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  }

  ctx.effect(() => commands.register({
    definitionId: '@dsh-adaptive-mode/mode',
    name: commandName,
    description: '查看或切换当前会话的 Agent 模式（自适应模式可解除模式锁）',
    input: { hint: '[<模式id或名称> | unlock | lock | list | help]' },
    handler: runModeCommand,
  }))
}
