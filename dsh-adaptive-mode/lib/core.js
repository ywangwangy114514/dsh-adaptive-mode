/**
 * Pure decision logic for `dsh-adaptive-mode`.
 *
 * This module deliberately imports nothing — not even a DSH package — so the
 * rules that decide "may this agent switch its own mode" and "which mode did the
 * user mean" can be unit-tested outside a running Harness. `lib/index.js` owns
 * every Cordis and DSH touch and calls into here.
 *
 * Vocabulary used throughout:
 *
 * - **mode** — the user-facing name for an Agent preset (`@deepseek-ai/dsh-agent-preset`).
 *   The shipped roster calls them 标准模式 / PTC 模式 / 极简模式 / 创造模式; third-party
 *   bundles add more, and this plugin adds 自适应模式.
 * - **unlock** — permission for one agent to change its own mode. The registry's
 *   `agentPresets.select()` refuses once a session has started a turn
 *   (`agent-preset/locked`, "This session has already started"). Removing that
 *   refusal for one agent is the whole point of adaptive mode.
 *
 * @module dsh-adaptive-mode/core
 */

/** The unlock scopes this plugin understands. */
export const UNLOCK_SCOPES = ['session', 'mode']

/** The behaviours this plugin understands when the approval policy is `never`. */
export const NEVER_POLICIES = ['deny', 'allow']

/**
 * Display labels for presets that ship without a `name`.
 *
 * The four built-in declarations (`standard`, `ptc`, `minimal`, `cordis`) carry
 * `id` and `plugins` only — 「标准模式」 and friends live in the *client* locale
 * dictionary, so the host roster has no name for them at all. That is exactly why
 * `/mode 标准模式`, and a model passing `标准模式`, used to miss: there was no
 * string to match. These labels restore a name to the host-side catalog, and the
 * shorter entries are accepted aliases on top of it.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const BUILTIN_MODE_LABELS = Object.freeze({
  standard: Object.freeze(['标准模式', '标准']),
  ptc: Object.freeze(['PTC 模式', 'PTC']),
  minimal: Object.freeze(['极简模式', '极简']),
  cordis: Object.freeze(['创造模式', '创造']),
  adaptive: Object.freeze(['自适应模式', '自适应']),
})

/**
 * Fold a mode reference into the key used for tolerant matching: lowercase, with
 * whitespace and a trailing 「模式」/「Mode」 removed. `PTC 模式`, `ptc`, and `ptc mode`
 * all fold to `ptc`.
 * @param {string} value - raw reference.
 * @returns {string} the folded key.
 */
export function modeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/gu, '')
    .replace(/(模式|mode)$/u, '')
}

/**
 * The canonical, JSON-safe mode catalog entry.
 * @typedef {object} ModeEntry
 * @property {string} id - preset identity recorded by sessions.
 * @property {string} name - display name (never empty).
 * @property {string | undefined} description - display description.
 * @property {string | undefined} broken - activation diagnostic; present means unusable.
 * @property {readonly string[]} aliases - other strings this mode answers to.
 */

/**
 * Project `agentPresets.list()` rows onto the catalog this plugin reasons about.
 *
 * The registry returns display metadata *including* activation failures, and a
 * failed preset stays listed so the user can read its diagnostic. Entries are
 * kept in registry order — that order is the roster order the user sees. A row
 * without a `name` inherits its built-in label, and `<id> 模式` is always accepted
 * as an alias, so a Chinese display name reaches the same row its id does.
 * @param {unknown} presets - whatever the registry returned.
 * @returns {ModeEntry[]} one entry per usable row, malformed rows dropped.
 */
export function normalizeModes(presets) {
  if (!Array.isArray(presets)) return []
  const modes = []
  for (const preset of presets) {
    if (preset === null || typeof preset !== 'object') continue
    const id = typeof preset.id === 'string' ? preset.id.trim() : ''
    if (id === '') continue
    const declared = typeof preset.name === 'string' && preset.name.trim() !== '' ? preset.name : undefined
    const builtin = BUILTIN_MODE_LABELS[id] ?? []
    const name = declared ?? builtin[0] ?? id
    const description = typeof preset.description === 'string' && preset.description.trim() !== ''
      ? preset.description
      : undefined
    const broken = typeof preset.broken === 'string' && preset.broken.trim() !== '' ? preset.broken : undefined
    const aliases = [...new Set([...builtin, `${id} 模式`, `${id} mode`])]
      .filter((alias) => alias !== name)
    modes.push({ id, name, description, broken, aliases })
  }
  return modes
}

/**
 * Resolve a user- or model-supplied mode reference against the catalog.
 *
 * Exact matches win in the order id → name → alias, each case-sensitively before
 * its case-insensitive pass; a folded comparison last, so `PTC 模式`, `ptc` and
 * `PTC` all land on the same row and a trailing 「模式」 may be omitted.
 * @param {readonly ModeEntry[]} modes - current catalog.
 * @param {string} query - raw reference.
 * @returns {ModeEntry | undefined} the matched entry, or undefined.
 */
export function resolveMode(modes, query) {
  const q = typeof query === 'string' ? query.trim() : ''
  if (q === '') return undefined
  const lower = q.toLowerCase()
  const exact = modes.find((mode) => mode.id === q)
    ?? modes.find((mode) => mode.name === q)
    ?? modes.find((mode) => mode.aliases.includes(q))
    ?? modes.find((mode) => mode.id.toLowerCase() === lower)
    ?? modes.find((mode) => mode.name.toLowerCase() === lower)
    ?? modes.find((mode) => mode.aliases.some((alias) => alias.toLowerCase() === lower))
  if (exact !== undefined) return exact

  const folded = modeKey(q)
  if (folded === '') return undefined
  return modes.find((mode) => modeKey(mode.id) === folded)
    ?? modes.find((mode) => modeKey(mode.name) === folded)
    ?? modes.find((mode) => mode.aliases.some((alias) => modeKey(alias) === folded))
}

/**
 * Decide whether one agent may change its own mode.
 *
 * Four independent facts can grant the unlock, checked strongest first:
 *
 * 1. `granted` — an explicit in-memory grant (`/mode unlock`, or a grant made
 *    earlier in this process). Always sticky.
 * 2. `current` — the agent's live preset *is* the adaptive preset.
 * 3. `header` — the session was created with the adaptive preset. Durable: it
 *    survives a restart, which the in-memory grant does not.
 * 4. `history` — some earlier `agent-preset/selected` event in this session
 *    named the adaptive preset. Also durable.
 *
 * Under `unlockScope: 'mode'` only (2) counts, and no fact is sticky: the agent
 * may switch only while it is actually sitting in adaptive mode. Under
 * `unlockScope: 'session'` (the default) entering adaptive mode lifts the lock
 * for the rest of that agent's session, which is what "解除 ai 模式锁定" means.
 * @param {object} facts - resolved facts about one agent.
 * @param {string} facts.presetId - the adaptive preset's id.
 * @param {'session' | 'mode'} facts.unlockScope - configured scope.
 * @param {string | undefined} facts.currentPreset - live preset id.
 * @param {string | undefined} facts.headerPreset - preset the session was created with.
 * @param {boolean} facts.historyPreset - whether the session log ever selected presetId.
 * @param {boolean} facts.granted - whether an explicit grant is already held.
 * @returns {{ unlocked: boolean, because: 'granted' | 'current' | 'header' | 'history' | 'locked', sticky: boolean }}
 *   the decision, plus whether the caller should remember it.
 */
export function unlockDecision(facts) {
  const scope = facts.unlockScope === 'mode' ? 'mode' : 'session'
  if (facts.granted === true && scope === 'session') {
    return { unlocked: true, because: 'granted', sticky: true }
  }
  if (facts.currentPreset !== undefined && facts.currentPreset === facts.presetId) {
    return { unlocked: true, because: 'current', sticky: scope === 'session' }
  }
  if (scope === 'mode') return { unlocked: false, because: 'locked', sticky: false }
  if (facts.headerPreset !== undefined && facts.headerPreset === facts.presetId) {
    return { unlocked: true, because: 'header', sticky: true }
  }
  if (facts.historyPreset === true) return { unlocked: true, because: 'history', sticky: true }
  return { unlocked: false, because: 'locked', sticky: false }
}

/**
 * Whether a durable event list ever recorded a selection of `presetId`.
 *
 * Reading the session log is what makes the unlock survive a Harness restart
 * when the session was resumed rather than created in this process.
 * @param {unknown} events - `session.snapshotEvents()` output, or anything else.
 * @param {string} presetId - the adaptive preset's id.
 * @returns {boolean} true when one recorded selection names it.
 */
export function historySelected(events, presetId) {
  if (!Array.isArray(events)) return false
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'agent-preset/selected') continue
    const data = event.data
    if (data !== null && typeof data === 'object' && data.agentPreset === presetId) return true
  }
  return false
}

/**
 * Human-readable catalog, one mode per line.
 * @param {readonly ModeEntry[]} modes - current catalog.
 * @param {string | undefined} currentPreset - the calling agent's live preset id.
 * @returns {string} multi-line text for a tool result or command result.
 */
export function renderModeList(modes, currentPreset) {
  const lines = [`当前模式: ${currentPreset ?? '(未知)'}`, '可用模式:']
  for (const mode of modes) {
    const label = mode.name === mode.id ? mode.id : `${mode.name}（${mode.id}）`
    const broken = mode.broken === undefined ? '' : ` [不可用: ${mode.broken}]`
    const description = mode.description === undefined ? '' : `\n    ${mode.description}`
    lines.push(`  - ${label}${broken}${description}`)
  }
  return lines.join('\n')
}

/**
 * The message a locked agent receives when it tries to switch.
 *
 * It must be actionable: the agent cannot unlock itself, so it has to tell the
 * user exactly which two things they can do.
 * @param {object} input - message inputs.
 * @param {string} input.presetId - the adaptive preset's id.
 * @param {string | undefined} input.currentPreset - the calling agent's preset.
 * @param {string} input.commandName - the configured `/mode` command name.
 * @returns {string} the refusal text.
 */
export function lockedMessage(input) {
  return [
    `本会话的模式锁尚未解除，无法切换模式（当前模式: ${input.currentPreset ?? '未知'}）。`,
    `自适应模式用「${input.presetId}」这个模式 id 表示：请用户新建任务时选择「自适应模式」，`,
    `或直接执行 /${input.commandName} ${input.presetId} 切到该模式，也可以执行 /${input.commandName} unlock 直接解锁。`,
    '解锁后本会话（含其后续切换）不再被锁定。',
  ].join('')
}

/**
 * The message a switch reports when the approval prompt is impossible.
 * @param {string} commandName - the configured `/mode` command name.
 * @param {'deny' | 'allow'} onApprovalNever - configured behaviour.
 * @returns {string | undefined} an explanation, or undefined when not applicable.
 */
export function approvalNeverMessage(commandName, onApprovalNever) {
  if (onApprovalNever !== 'deny') return undefined
  return [
    '当前会话的审批策略是 never：审批弹窗被自动拒绝，无法征求用户允许。',
    '请把权限预设切换到带 ask 的一档（例如「工作区写入」），',
    `或在插件配置里设置 onApprovalNever: allow 以在 never 下直接切换。也可以用 /${commandName} <模式> 手动切换。`,
  ].join('')
}

/**
 * Map one approval outcome onto a switch decision.
 * @param {'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'} outcome - approval result.
 * @returns {{ allowed: boolean, message: string }} decision and refusal text.
 */
export function approvalVerdict(outcome) {
  switch (outcome) {
    case 'allowed-once':
      return { allowed: true, message: '用户已允许切换模式。' }
    case 'rejected':
      return { allowed: false, message: '用户拒绝了本次模式切换，继续留在当前模式。' }
    case 'cancelled':
      return { allowed: false, message: '本次模式切换的授权请求被取消，继续留在当前模式。' }
    case 'unavailable':
      return { allowed: false, message: '没有可用的审批通道，模式切换被拒绝（fail closed）。继续留在当前模式。' }
    /* c8 ignore next 2 -- ApprovalOutcome is a closed union; the default is a backstop. */
    default:
      return { allowed: false, message: `未知的审批结果 ${JSON.stringify(outcome)}，按拒绝处理。` }
  }
}
