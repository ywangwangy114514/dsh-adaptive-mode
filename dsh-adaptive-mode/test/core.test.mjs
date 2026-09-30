/**
 * Unit tests for the pure decision logic of `dsh-adaptive-mode`.
 *
 * `lib/core.js` imports nothing, so these run with a bare `node --test` and no
 * Harness around them. The Cordis wiring in `lib/index.js` is verified in a live
 * session instead (see README, "验证").
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  approvalNeverMessage,
  approvalVerdict,
  historySelected,
  lockedMessage,
  normalizeModes,
  renderModeList,
  resolveMode,
  unlockDecision,
} from '../lib/core.js'

const PRESET = 'adaptive'

/** Facts helper: locked unless a test says otherwise. */
function facts(overrides = {}) {
  return {
    presetId: PRESET,
    unlockScope: 'session',
    granted: false,
    currentPreset: 'standard',
    headerPreset: 'standard',
    historyPreset: false,
    ...overrides,
  }
}

test('normalizeModes keeps registry order and drops malformed rows', () => {
  const modes = normalizeModes([
    { id: 'standard', name: '标准模式', description: '标准' },
    { id: 'ptc', name: 'PTC 模式' },
    { id: 'broken', name: '坏的', broken: 'activation failed' },
    { name: 'no id' },
    null,
    'nonsense',
    { id: '  ' },
  ])
  assert.deepEqual(modes.map((mode) => mode.id), ['standard', 'ptc', 'broken'])
  assert.equal(modes[0].name, '标准模式')
  assert.equal(modes[1].description, undefined)
  assert.equal(modes[2].broken, 'activation failed')
  assert.deepEqual(normalizeModes(undefined), [])
})

test('normalizeModes falls back to the id when a display name is missing', () => {
  assert.deepEqual(normalizeModes([{ id: 'unheard-of' }]), [
    {
      id: 'unheard-of',
      name: 'unheard-of',
      description: undefined,
      broken: undefined,
      aliases: ['unheard-of 模式', 'unheard-of mode'],
    },
  ])
})

test('normalizeModes gives built-in presets the Chinese name the host roster lacks', () => {
  const modes = normalizeModes([{ id: 'standard' }, { id: 'ptc' }, { id: 'minimal' }, { id: 'cordis' }])
  assert.deepEqual(
    modes.map((mode) => mode.name),
    ['标准模式', 'PTC 模式', '极简模式', '创造模式'],
  )
  assert.deepEqual(modes[0].aliases, ['标准', 'standard 模式', 'standard mode'])
})

test('resolveMode accepts Chinese display names, short forms, and a trailing 模式', () => {
  const modes = normalizeModes([{ id: 'standard' }, { id: 'ptc' }, { id: 'minimal' }, { id: 'cordis' }])
  assert.equal(resolveMode(modes, '标准模式').id, 'standard')
  assert.equal(resolveMode(modes, '标准').id, 'standard')
  assert.equal(resolveMode(modes, '极简模式').id, 'minimal')
  assert.equal(resolveMode(modes, '极简').id, 'minimal')
  assert.equal(resolveMode(modes, '创造').id, 'cordis')
  assert.equal(resolveMode(modes, 'ptc 模式').id, 'ptc')
  assert.equal(resolveMode(modes, 'PTC MODE').id, 'ptc')
  assert.equal(resolveMode(modes, 'standard 模式').id, 'standard')
  assert.equal(resolveMode(modes, '不存在'), undefined)
})

test('resolveMode matches a third-party mode by its registered Chinese name', () => {
  const modes = normalizeModes([{ id: 'minecraft', name: 'Minecraft 专家' }])
  assert.equal(resolveMode(modes, 'Minecraft 专家').id, 'minecraft')
  assert.equal(resolveMode(modes, 'minecraft 专家').id, 'minecraft')
  assert.equal(resolveMode(modes, 'minecraft').id, 'minecraft')
})

test('resolveMode matches id, then name, case-insensitively', () => {
  const modes = normalizeModes([
    { id: 'standard', name: '标准模式' },
    { id: 'adaptive', name: '自适应模式' },
  ])
  assert.equal(resolveMode(modes, 'adaptive').id, 'adaptive')
  assert.equal(resolveMode(modes, 'ADAPTIVE').id, 'adaptive')
  assert.equal(resolveMode(modes, '自适应模式').id, 'adaptive')
  assert.equal(resolveMode(modes, '  自适应模式  ').id, 'adaptive')
  assert.equal(resolveMode(modes, 'minecraft'), undefined)
  assert.equal(resolveMode(modes, ''), undefined)
  assert.equal(resolveMode(modes, undefined), undefined)
})

test('resolveMode prefers an exact id over a display-name collision', () => {
  const modes = normalizeModes([
    { id: 'a', name: '标准模式' },
    { id: '标准模式', name: 'b' },
  ])
  assert.equal(resolveMode(modes, '标准模式').id, '标准模式')
})

test('unlockDecision is locked for a plain session', () => {
  assert.deepEqual(unlockDecision(facts()), { unlocked: false, because: 'locked', sticky: false })
})

test('unlockDecision unlocks while the agent sits in adaptive mode', () => {
  assert.deepEqual(
    unlockDecision(facts({ currentPreset: PRESET })),
    { unlocked: true, because: 'current', sticky: true },
  )
})

test('unlockDecision honours a session created with adaptive mode (durable header)', () => {
  assert.deepEqual(
    unlockDecision(facts({ headerPreset: PRESET })),
    { unlocked: true, because: 'header', sticky: true },
  )
})

test('unlockDecision honours a recorded selection in the session log', () => {
  assert.deepEqual(
    unlockDecision(facts({ historyPreset: true })),
    { unlocked: true, because: 'history', sticky: true },
  )
})

test('unlockDecision honours an explicit grant first', () => {
  assert.deepEqual(
    unlockDecision(facts({ granted: true, currentPreset: 'minecraft', headerPreset: 'minecraft' })),
    { unlocked: true, because: 'granted', sticky: true },
  )
})

test("unlockScope 'mode' unlocks only while the agent is in adaptive mode, and never sticks", () => {
  assert.deepEqual(
    unlockDecision(facts({ unlockScope: 'mode', currentPreset: PRESET })),
    { unlocked: true, because: 'current', sticky: false },
  )
  assert.deepEqual(
    unlockDecision(facts({ unlockScope: 'mode', headerPreset: PRESET, historyPreset: true, granted: true })),
    { unlocked: false, because: 'locked', sticky: false },
  )
})

test('historySelected reads only agent-preset/selected events', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'agent-preset/selected', data: { agentPreset: 'standard' } },
    { type: 'agent-preset/selected', data: { agentPreset: PRESET } },
  ]
  assert.equal(historySelected(events, PRESET), true)
  assert.equal(historySelected(events, 'minecraft'), false)
  assert.equal(historySelected([{ type: 'agent-preset/selected' }], PRESET), false)
  assert.equal(historySelected(undefined, PRESET), false)
})

test('approvalVerdict allows exactly one outcome', () => {
  assert.equal(approvalVerdict('allowed-once').allowed, true)
  for (const outcome of ['rejected', 'cancelled', 'unavailable']) {
    assert.equal(approvalVerdict(outcome).allowed, false, outcome)
  }
})

test('approvalNeverMessage only refuses under the deny policy', () => {
  assert.equal(approvalNeverMessage('mode', 'allow'), undefined)
  assert.match(approvalNeverMessage('mode', 'deny'), /never/)
})

test('renderModeList names the current mode and marks unusable ones', () => {
  const modes = normalizeModes([
    { id: 'standard', name: '标准模式', description: '标准' },
    { id: 'adaptive', name: '自适应模式' },
    { id: 'broken', name: '坏的', broken: 'boom' },
  ])
  const text = renderModeList(modes, 'adaptive')
  assert.match(text, /当前模式: adaptive/)
  assert.match(text, /标准模式（standard）/)
  assert.match(text, /\[不可用: boom\]/)
})

test('lockedMessage tells the user both ways out', () => {
  const text = lockedMessage({ presetId: PRESET, currentPreset: 'standard', commandName: 'mode' })
  assert.match(text, /\/mode adaptive/)
  assert.match(text, /\/mode unlock/)
})
