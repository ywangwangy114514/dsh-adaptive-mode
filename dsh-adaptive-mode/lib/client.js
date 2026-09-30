/**
 * `dsh-adaptive-mode` — the browser half.
 *
 * The host half already offers two ways to change a live session's mode: the
 * `switch_mode` tool and the `/mode` command. Neither is a *control* the user can
 * reach by hand, and the shipped header label is read-only by construction — its
 * own comment says a control there "would promise a switch the host refuses".
 * This plugin is what makes the host stop refusing, so this half adds the control
 * the user asked for: a clickable mode chip in the session header, immediately
 * right of the shipped label, that lists the live roster and switches the session
 * by running `/mode <id>` through the ordinary command channel.
 *
 * Loaded as a client module bundle: the kernel hands the factory a `require`
 * resolving `react`, `react-dom`, `react/jsx-runtime` and the client UI
 * primitives. Only `react` is used here — the popover is plain inline-styled
 * markup so this half depends on no primitive whose API could drift.
 *
 * @module dsh-adaptive-mode/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-adaptive-mode',
  factory: (require) => {
    /** React runtime from the kernel's module table. */
    const React = require('react')

    /** Shortcut for the non-JSX build this file is served as. */
    const h = React.createElement

    /** The shipped header slot; the read-only preset label sits in it at order -10. */
    const HEADER_SLOT = 'conversation.session.header.actions'

    /** Where this chip places itself: directly after the shipped label. */
    const HEADER_ORDER = -9

    const chipStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      maxWidth: '200px',
      minHeight: '28px',
      padding: '0 8px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, inherit)',
      font: 'inherit',
      fontSize: '13px',
      fontWeight: '500',
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }

    const menuStyle = {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: '0',
      zIndex: '60',
      minWidth: '240px',
      maxHeight: '320px',
      overflowY: 'auto',
      padding: '4px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
      borderRadius: 'var(--dsw-radius-md, 8px)',
      background: 'var(--dsw-alias-bg-base, #1f1f1f)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
    }

    const itemStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      width: '100%',
      padding: '6px 8px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
    }

    const itemNameStyle = { fontSize: '13px', lineHeight: '20px' }
    const itemMetaStyle = { fontSize: '12px', lineHeight: '16px', opacity: '0.65', whiteSpace: 'normal' }
    const noteStyle = { padding: '4px 8px', fontSize: '12px', lineHeight: '16px', opacity: '0.65', whiteSpace: 'normal' }

    /**
     * Build the host-side helpers the chip needs, all defensively: a missing
     * store or namespace must degrade the chip, never break the session header.
     * @param {object} ctx - the client plugin context.
     * @param {string} commandName - the configured `/mode` command name.
     * @returns {object} the props the chip receives.
     */
    function makeApi(ctx, commandName) {
      const sessions = ctx.get('sessions')

      /** The live mode id recorded for one session, when the store can answer. */
      const currentMode = (sessionId) => {
        try {
          const value = sessions?.list?.getSnapshot?.()?.byId?.[sessionId]?.projectionValues?.agentPreset
          return typeof value === 'string' && value !== '' ? value : undefined
        } catch {
          return undefined
        }
      }

      /** Subscribe to session-store changes; returns a disposer. */
      const subscribeSessions = (listener) => {
        try {
          const unsubscribe = sessions?.list?.subscribe?.(listener)
          return typeof unsubscribe === 'function' ? unsubscribe : () => {}
        } catch {
          return () => {}
        }
      }

      /** The live roster, including third-party and broken entries. */
      const list = async () => {
        const roster = await ctx.remote.agentPresets.list()
        const presets = Array.isArray(roster?.presets) ? roster.presets : []
        return presets
          .filter((preset) => typeof preset?.id === 'string')
          .map((preset) => ({
            id: preset.id,
            name: typeof preset.name === 'string' && preset.name !== '' ? preset.name : preset.id,
            broken: typeof preset.broken === 'string' ? preset.broken : undefined,
          }))
      }

      /** Run the host command that performs the unlocked switch. */
      const switchTo = async (sessionId, id) => {
        const line = `/${commandName} ${id}`
        const result = await ctx.remote.commands.execute(sessionId, line, [])
        const settled = result?.result ?? result
        return settled?.kind === 'error'
          ? { ok: false, text: settled.text ?? '切换失败' }
          : { ok: true, text: settled?.text ?? `已切换到「${id}」` }
      }

      return { currentMode, subscribeSessions, list, switchTo }
    }

    /**
     * The clickable mode control.
     * @param {object} props - composed slot props plus this plugin's `api`.
     * @returns {object} the rendered element.
     */
    function ModeSwitch(props) {
      const { sessionId, api } = props
      const [open, setOpen] = React.useState(false)
      const [modes, setModes] = React.useState([])
      const [note, setNote] = React.useState('')
      const [mode, setMode] = React.useState(() => api.currentMode(sessionId))

      React.useEffect(() => {
        setMode(api.currentMode(sessionId))
        return api.subscribeSessions(() => setMode(api.currentMode(sessionId)))
      }, [sessionId])

      React.useEffect(() => {
        let live = true
        api.list()
          .then((next) => { if (live) setModes(next) })
          .catch(() => { if (live) setModes([]) })
        return () => { live = false }
      }, [sessionId])

      const label = modes.find((entry) => entry.id === mode)?.name ?? mode ?? '模式'

      /**
       * Switch this session and report the outcome in the popover.
       * @param {string} id - target preset id.
       */
      const choose = async (id) => {
        setOpen(false)
        setNote('')
        try {
          const outcome = await api.switchTo(sessionId, id)
          setNote(outcome.text)
        } catch (error) {
          setNote(error instanceof Error ? error.message : String(error))
        }
      }

      return h('span', { style: { position: 'relative', display: 'inline-flex' } }, [
        h('button', {
          key: 'chip',
          type: 'button',
          style: chipStyle,
          title: '点击切换本会话的 Agent 模式',
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen((value) => !value),
        }, [
          h('span', { key: 'label', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
          h('span', { key: 'caret', style: { opacity: '0.6' } }, '▾'),
        ]),
        !open ? null : h('div', { key: 'menu', style: menuStyle, role: 'menu' }, [
          ...modes.map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            role: 'menuitem',
            style: itemStyle,
            disabled: entry.broken !== undefined,
            title: entry.broken === undefined ? entry.id : `不可用：${entry.broken}`,
            onClick: () => { void choose(entry.id) },
          }, [
            h('span', { key: 'name', style: itemNameStyle }, entry.name),
            h('span', { key: 'meta', style: itemMetaStyle }, entry.broken === undefined ? entry.id : `${entry.id} · 不可用`),
          ])),
          note === '' ? null : h('div', { key: 'note', style: noteStyle }, note),
        ]),
      ])
    }

    /**
     * Register the chip.
     * @param {object} ctx - the client plugin context.
     */
    function apply(ctx) {
      const api = makeApi(ctx, 'mode')
      ctx.effect(() => ctx.slots.register({
        name: HEADER_SLOT,
        id: 'adaptive-mode-switch',
        order: HEADER_ORDER,
        inject: (sessionId) => ({ sessionId, api }),
      }, ModeSwitch), 'dsh-adaptive-mode: session header mode switch')
    }

    const plugin = {
      name: 'dsh-adaptive-mode',
      inject: ['slots', 'sessions', 'remote.agentPresets', 'remote.commands'],
      apply,
    }

    const module = { exports: plugin }
    return module.exports
  },
})
