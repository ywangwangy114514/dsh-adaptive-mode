/**
 * Guard the one thing a hand-copied preset child list gets wrong: a dropped
 * config key.
 *
 * 自适应模式's child list is a copy of the shipped 标准模式 list. A required
 * config key that is dropped with it does not degrade quietly — the row fails
 * to activate, the registry rejects the whole mount, and the mode shows up as
 * 「加载失败」 in the picker. `@deepseek-ai/dsh-plan-mode` is exactly that case:
 * it throws `PlanModeConfig needs a string 'section'`, and 标准模式 always
 * supplies one.
 *
 * This test therefore diffs the two lists field by field — id, module, disabled,
 * isolate and config — and only exempts the `persona`, which is the one row
 * this bundle deliberately rewrites. It skips when the shipped list cannot be
 * located, so it never fails a checkout without a DSH installation.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
/**
 * The shipped 标准模式 declaration. A packaged DSH keeps it inside `app.asar`,
 * which a bare Node test cannot read, so set `DSH_STANDARD_PRESET` to an
 * extracted copy to run this guard there; without either path the test skips
 * rather than failing.
 */
const STANDARD = process.env.DSH_STANDARD_PRESET
  ?? join(HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml')
const YAML_ANCHOR = join(HOME, 'profiles', 'node_modules', 'yaml', 'package.json')
const MINE = new URL('../cordis.patch.yml', import.meta.url)

/** The `!!js` tag, parsed into the loader's own `{ __jsExpr }` marker shape. */
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => ({ __jsExpr: value }) }

/**
 * Read one `insert` row out of a patch file.
 * @param {string | URL} file - patch path.
 * @param {string} rowId - the row id to return.
 * @param {import('yaml')} yaml - the parser.
 * @returns {any} the row.
 */
function readRow(file, rowId, yaml) {
  const doc = yaml.parse(readFileSync(file, 'utf8'), { customTags: [JS_TAG] })
  for (const layer of doc ?? []) {
    for (const row of layer?.insert ?? []) if (row.id === rowId) return row
  }
  throw new Error(`row ${rowId} not found in ${String(file)}`)
}

const available = existsSync(STANDARD) && existsSync(YAML_ANCHOR)

test('the adaptive child list stays field-identical to the shipped 标准模式 list', { skip: available ? false : `no shipped preset at ${STANDARD}` }, () => {
  const yaml = createRequire(YAML_ANCHOR)('yaml')
  const mine = readRow(MINE, 'preset-adaptive', yaml).config.plugins
  const theirs = readRow(STANDARD, 'preset-standard', yaml).config.plugins

  const keyOf = (row) => row.id ?? row.name
  const json = (value) => JSON.stringify(value ?? null)

  assert.deepEqual(mine.map(keyOf), theirs.map(keyOf), 'child row ids and order must match 标准模式')

  const index = new Map(theirs.map((row) => [keyOf(row), row]))
  for (const row of mine) {
    const other = index.get(keyOf(row))
    assert.equal(row.name, other.name, `${keyOf(row)} module`)
    assert.equal(json(row.disabled), json(other.disabled), `${keyOf(row)} disabled`)
    assert.equal(json(row.isolate), json(other.isolate), `${keyOf(row)} isolate`)
    // The persona is the one row this bundle rewrites on purpose.
    if (keyOf(row) === 'persona') continue
    assert.equal(json(row.config), json(other.config), `${keyOf(row)} config`)
  }
})

test('every plan-mode row carries a non-empty section', () => {
  const text = readFileSync(MINE, 'utf8')
  const rows = text.split('- id: plan-mode').slice(1)
  assert.ok(rows.length > 0, 'no plan-mode row found')
  for (const row of rows) {
    const section = row.split('\n').find((line) => line.trim().startsWith('section:'))
    assert.ok(section !== undefined, 'plan-mode row has no section (dsh-plan-mode rejects that config)')
    assert.ok(/section:\s*\S/.test(section) || /section:\s*\|/.test(section), 'section must be non-empty')
  }
})
