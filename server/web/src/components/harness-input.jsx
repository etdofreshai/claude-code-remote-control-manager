// Input area: textarea + below controls.
// Layout: attach (bottom-left) · slash + model + budget (center)
//         · char count + mic + send/stop/steer (bottom-right)
// Send button states:
//   idle → "Send"  (when not streaming)
//   streaming → "Stop"  (turns red, halts response)
//   streaming + user typed → "Steer"  (sends a redirect mid-stream)

(function () {
  const { useState, useRef, useEffect, useMemo } = React;

  // Provider labels — model lists come from the live client registration
  // passed in as a `providers` prop. This map is just a cosmetic name lookup.
  const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };

  function Pill({ active, onClick, children, theme, variant, kbd, color }) {
    const dim = color || theme.textDim;
    return (
      <button
        onClick={onClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: active ? theme.surfaceHover : 'transparent',
          border: `1px solid ${active ? theme.borderStrong : theme.border}`,
          borderRadius: variant.radiusSm,
          color: dim,
          padding: '4px 7px',
          fontSize: 11.5,
          cursor: 'pointer',
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          whiteSpace: 'nowrap'
        }}
        onMouseEnter={(e) => {e.currentTarget.style.color = theme.text;e.currentTarget.style.background = theme.surfaceHover;}}
        onMouseLeave={(e) => {if (!active) {e.currentTarget.style.color = dim;e.currentTarget.style.background = 'transparent';}}}>
        
        {children}
        {kbd && <span style={{
          fontSize: 9.5, color: theme.textMuted, fontFamily: variant.mono,
          padding: '0 3px', border: `1px solid ${theme.border}`, borderRadius: 3,
          marginLeft: 2
        }}>{kbd}</span>}
      </button>);

  }

  function Menu({ items, onPick, theme, variant, onClose, align = 'left' }) {
    // Anchor to the popover's parent (the position: relative wrapper that
    // also holds the trigger). The Menu mounts on open, so a one-time
    // measurement on mount is enough.
    const ref = useRef(null);
    const [pos, setPos] = useState({ dir: 'up', maxHeight: 320 });
    useEffect(() => {
      const anchor = ref.current?.parentElement?.parentElement; // <fragment>'s wrapper
      const parentWrapper = ref.current?.offsetParent || anchor;
      setPos(window.HarnessPopover.placePopover(parentWrapper, { preferred: 'up' }));
    }, []);
    return (
      <>
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
        <div ref={ref} style={{
          position: 'absolute', [align]: 0,
          ...window.HarnessPopover.popoverStyle(pos),
          background: theme.surface2,
          border: `1px solid ${theme.borderStrong}`,
          borderRadius: variant.radius,
          padding: 4, minWidth: 200, zIndex: 51,
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)'
        }}>
          {items.map((it, i) =>
          <button key={i} onClick={() => {onPick(it);onClose();}} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '6px 8px', background: 'transparent', border: 'none',
            cursor: 'pointer', color: theme.text, fontSize: 12, textAlign: 'left',
            borderRadius: variant.radiusSm,
            fontFamily: variant.allMono ? variant.mono : 'inherit',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = theme.surfaceHover}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>

              {it.iconNode}
              {!it.iconNode && it.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: it.dot, flexShrink: 0 }} />}
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
              {it.hint && <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono, flexShrink: 0 }}>{it.hint}</span>}
              {it.active && <span style={{ color: theme.accent, fontSize: 11, flexShrink: 0 }}>●</span>}
            </button>
          )}
        </div>
      </>);

  }

  function ModelPicker({ provider, model, onChange, theme, variant, providers }) {
    const [open, setOpen] = useState(false);
    const items = [];
    Object.entries(providers || {}).forEach(([pId, p]) => {
      const label = p.label || PROVIDER_LABELS[pId] || pId;
      (p.models || []).forEach((m) => {
        items.push({
          label: (
            <span>
              <span style={{ color: theme.textDim }}>{label}</span>
              <span style={{ color: theme.textMuted, margin: '0 5px' }}>/</span>
              <span>{m}</span>
            </span>
          ),
          iconNode: <window.ProviderIcon provider={pId} size={12} theme={theme} variant={variant} square />,
          active: pId === provider && m === model,
          provider: pId,
          model: m
        });
      });
    });
    return (
      <div style={{ position: 'relative' }}>
        <Pill active={open} onClick={() => setOpen(!open)} theme={theme} variant={variant}>
          <window.ProviderIcon provider={provider} size={12} theme={theme} variant={variant} square />
          <span style={{ color: theme.text }}>{model}</span>
          <window.Icons.ChevronDown size={10} />
        </Pill>
        {open && <Menu items={items} theme={theme} variant={variant} onClose={() => setOpen(false)} onPick={(it) => onChange(it.provider, it.model)} />}
      </div>);

  }

  function BudgetPicker({ value, onChange, theme, variant }) {
    const [open, setOpen] = useState(false);
    const opts = [
    { id: 'low', label: 'Low', hint: '4k', dot: theme.status.completed },
    { id: 'medium', label: 'Medium', hint: '16k', dot: theme.status.awaiting },
    { id: 'high', label: 'High', hint: '64k', dot: theme.accent },
    { id: 'xhigh', label: 'X-High', hint: '128k', dot: theme.accent },
    { id: 'max', label: 'Max', hint: '256k', dot: theme.accent }];

    const cur = opts.find((o) => o.id === value) || opts[1];
    return (
      <div style={{ position: 'relative' }}>
        <Pill active={open} onClick={() => setOpen(!open)} theme={theme} variant={variant}>
          <window.Icons.Brain size={12} />
          <span>{cur.label}</span>
        </Pill>
        {open && <Menu items={opts.map((o) => ({ ...o, active: o.id === value }))} theme={theme} variant={variant} onClose={() => setOpen(false)} onPick={(it) => onChange(it.id)} />}
      </div>);

  }

  function SlashMenu({ onPick, theme, variant, query }) {
    const cmds = [
    {
      name: 'rename',
      desc: 'Rename this session (Harness)',
      detail: 'Renames the session locally in the Harness sidebar — does not call the model. Use the chat input rather than the pencil icon if you prefer typing.',
      usage: '/rename <new name>',
      flags: [{ f: '<new name>', d: 'The new session title' }]
    },
    {
      name: 'clear',
      desc: 'Clear conversation',
      detail: 'Removes all messages from the current session context. The session remains open but starts fresh from the next message.',
      usage: '/clear',
      flags: []
    },
    {
      name: 'compact',
      desc: 'Compact context to summary',
      detail: 'Summarizes the conversation so far into a dense context block, freeing up token budget for the next phase of work.',
      usage: '/compact [--keep <n>]',
      flags: [{ f: '--keep <n>', d: 'Keep the last n messages verbatim' }]
    },
    {
      name: 'cwd',
      desc: 'Change working directory',
      detail: 'Switches the session\'s working directory. File tools (read, edit, bash) will resolve paths relative to the new root.',
      usage: '/cwd <path>',
      flags: [{ f: '<path>', d: 'Absolute or ~ path to new root' }]
    },
    {
      name: 'tools',
      desc: 'Toggle available tools',
      detail: 'Enable or disable individual tools for this session. By default filesystem, shell and test-runner are active.',
      usage: '/tools [list | enable <name> | disable <name>]',
      flags: [
      { f: 'list', d: 'Show current tool status' },
      { f: 'enable <name>', d: 'Turn a tool on' },
      { f: 'disable <name>', d: 'Turn a tool off' }]

    },
    {
      name: 'undo',
      desc: 'Revert last file change',
      detail: 'Reverts the most recent file edit made by the model. Safe to run multiple times — each call walks back one edit.',
      usage: '/undo [--all]',
      flags: [{ f: '--all', d: 'Revert all edits since session start' }]
    },
    {
      name: 'export',
      desc: 'Export session as markdown',
      detail: 'Writes the full session transcript — messages, tool calls and diffs — to a .md file in the working directory.',
      usage: '/export [--path <file>] [--no-diffs]',
      flags: [
      { f: '--path <file>', d: 'Output path (default: ./session.md)' },
      { f: '--no-diffs', d: 'Omit file diffs from the export' }]

    }];


    const [hovered, setHovered] = useState(null);
    const filtered = cmds.filter((c) => c.name.startsWith(query.toLowerCase()));
    if (filtered.length === 0) return null;
    const active = hovered != null ? filtered[hovered] : filtered[0];

    return (
      <div style={{
        position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 8,
        background: theme.surface2,
        border: `1px solid ${theme.borderStrong}`,
        borderRadius: variant.radius,
        boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        zIndex: 30,
        overflow: 'hidden'
      }}>
        {/* Command list */}
        <div style={{ padding: 4 }}>
          <div style={{ padding: '4px 8px', fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>
            slash commands
          </div>
          {filtered.map((c, i) =>
          <button key={c.name} onClick={() => onPick(c)}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '6px 8px',
            background: hovered === i || hovered === null && i === 0 ? theme.surfaceHover : 'transparent',
            border: 'none', cursor: 'pointer', color: theme.text, fontSize: 12,
            textAlign: 'left', borderRadius: variant.radiusSm,
            fontFamily: variant.mono
          }}>
                <span style={{ color: theme.accent }}>/{c.name}</span>
                <span style={{ color: theme.textDim, fontSize: 11 }}>{c.desc}</span>
              </button>
          )}
          </div>

          {/* Detail panel — appears between list and input box */}
          <div style={{
          borderTop: `1px solid ${theme.border}`,
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '8px 20px',
          alignItems: 'start'
        }}>
            {/* Left: description + usage */}
            <div style={{ minWidth: 0 }}>
              <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5
            }}>
                <span style={{ fontFamily: variant.mono, fontSize: 12.5, color: theme.accent, fontWeight: 600 }}>
                  /{active.name}
                </span>
                <span style={{ fontSize: 11.5, color: theme.textDim, letterSpacing: variant.letterSpacing }}>
                  {active.desc}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: theme.textDim, lineHeight: 1.55, marginBottom: active.flags.length ? 8 : 0 }}>
                {active.detail}
              </div>
              {active.flags.length > 0 &&
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {active.flags.map((f) =>
              <div key={f.f} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <code style={{
                  fontFamily: variant.mono, fontSize: 10.5, color: theme.text,
                  background: theme.surface, border: `1px solid ${theme.border}`,
                  borderRadius: variant.radiusSm, padding: '1px 5px',
                  flexShrink: 0, whiteSpace: 'nowrap'
                }}>{f.f}</code>
                      <span style={{ fontSize: 11, color: theme.textMuted }}>{f.d}</span>
                    </div>
              )}
                </div>
            }
            </div>

            {/* Right: usage line */}
            <div style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: variant.radiusSm,
            padding: '5px 9px',
            fontFamily: variant.mono,
            fontSize: 11,
            color: theme.textDim,
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}>
              {active.usage}
            </div>
          </div>
      </div>);

  }

  function SendButton({ mode, onClick, theme, variant }) {
    // mode: 'send' | 'stop' | 'steer'
    const configs = {
      send: {
        bg: theme.accent, fg: theme.accentText, border: theme.accent,
        label: variant.allMono ? 'send' : 'Send',
        icon: <window.Icons.Send size={11} />,
        kbd: '⏎'
      },
      stop: {
        bg: theme.status.failed, fg: '#fff', border: theme.status.failed,
        label: variant.allMono ? 'stop' : 'Stop',
        icon: <window.Icons.Stop size={9} />,
        kbd: 'Esc'
      },
      steer: {
        bg: theme.status.awaiting, fg: '#1a1a1a', border: theme.status.awaiting,
        label: variant.allMono ? 'steer' : 'Steer',
        icon: <window.Icons.Lightning size={11} />,
        kbd: '⏎'
      }
    };
    const c = configs[mode] || configs.send;
    return (
      <button onClick={onClick} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
        borderRadius: variant.radiusSm,
        padding: '4px 10px',
        fontSize: 12, cursor: 'pointer',
        fontFamily: variant.allMono ? variant.mono : 'inherit',
        fontWeight: 500,
        transition: 'background .12s'
      }}>
        {c.icon}
        {c.label}
        <span style={{
          fontSize: 10, fontFamily: variant.mono,
          padding: '0 3px', border: `1px solid rgba(255,255,255,0.3)`,
          borderRadius: 3, opacity: 0.85
        }}>{c.kbd}</span>
      </button>);

  }

  function IconBtn({ onClick, theme, variant, active, color, title, children }) {
    return (
      <button
        onClick={onClick}
        title={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26,
          background: active ? theme.surfaceHover : 'transparent',
          border: `1px solid ${active ? theme.borderStrong : theme.border}`,
          borderRadius: variant.radiusSm,
          color: color || theme.textDim,
          cursor: 'pointer'
        }}
        onMouseEnter={(e) => {e.currentTarget.style.color = color || theme.text;e.currentTarget.style.background = theme.surfaceHover;}}
        onMouseLeave={(e) => {if (!active) {e.currentTarget.style.color = color || theme.textDim;e.currentTarget.style.background = 'transparent';}}}>
        
        {children}
      </button>);

  }

  function InputBox({ onSend, onStop, onSteer, onSwitchModel, theme, variant, session, isStreaming, environments }) {
    const [text, setText] = useState('');
    const [provider, setProvider] = useState(session.provider);
    const [model, setModel] = useState(session.model);
    const [effort, setEffort] = useState(session.effort || 'medium');
    const [voice, setVoice] = useState(false);
    const taRef = useRef(null);

    // Sync provider/model/effort with the session when it changes.
    useEffect(() => {
      setProvider(session.provider);
      setModel(session.model);
      setEffort(session.effort || 'medium');
    }, [session.id]);

    // Build the model picker list from the live client registration. Prefer
    // the environment matching this session's clientName; if none matches
    // (mid-restart, say), aggregate across all known environments. Then
    // filter by the user's enable toggles from Settings → Providers.
    // Crucially: restrict to the session's own provider — switching
    // providers mid-session means rebuilding the runner against a
    // different SDK / auth stack, which is more "start a new session"
    // than "switch model", so we don't surface cross-provider choices.
    const enabledMap = window.HarnessEnabled.useEnabledMap();
    const providers = useMemo(() => {
      const out = {};
      const envs = environments || [];
      const matching = envs.find((e) => e.id === session.clientName) || envs.find((e) => e.id === session.env);
      const pool = matching ? [matching] : envs;
      for (const e of pool) {
        for (const [pId, info] of Object.entries(e.providers || {})) {
          if (session.provider && pId !== session.provider) continue;
          if (!out[pId]) out[pId] = { label: PROVIDER_LABELS[pId] || pId, models: [] };
          for (const m of info.models || []) {
            if (!out[pId].models.includes(m)) out[pId].models.push(m);
          }
        }
      }
      return window.HarnessEnabled.filterProviders(out, enabledMap);
    }, [environments, session.clientName, session.env, session.provider, enabledMap]);

    const showSlash = text.startsWith('/');
    const slashQuery = text.startsWith('/') ? text.slice(1).split(' ')[0] : '';

    const mode = isStreaming ? text.trim() ? 'steer' : 'stop' : 'send';
    const canFire = mode === 'stop' || text.trim();

    useEffect(() => {
      if (taRef.current) {
        taRef.current.style.height = 'auto';
        taRef.current.style.height = Math.min(taRef.current.scrollHeight, 180) + 'px';
      }
    }, [text]);

    // Picker changes are staged locally — apply them just-in-time before
    // the next user message, so flipping the dropdown is silent until the
    // user actually decides to send. Returns a short "▾ effort: high"
    // (or similar) prefix that fire() folds into the user's message so
    // the change is visible in the transcript, same shape as the
    // bootstrap merge in startQuery.
    async function maybeSwitchFirst() {
      const sessionEffort = session.effort || 'medium';
      const parts = [];
      if (provider !== session.provider || model !== session.model) {
        const slug = model ? `${provider}/${model}` : provider;
        parts.push(`model: ${slug}`);
      }
      if (effort !== sessionEffort) parts.push(`effort: ${effort}`);
      if (!parts.length) return '';
      if (onSwitchModel) {
        try { await onSwitchModel(provider, model, effort); }
        catch (err) { console.error('switch failed', err); }
      }
      return `▾ ${parts.join(', ')}`;
    }

    function composeText(prefix, body) {
      return prefix ? `${prefix}\n\n${body}` : body;
    }

    async function fire() {
      if (mode === 'stop') {onStop && onStop();return;}
      if (mode === 'steer') {
        if (!text.trim()) return;
        const prefix = await maybeSwitchFirst();
        onSteer && onSteer(composeText(prefix, text));setText('');return;
      }
      if (!text.trim()) return;
      const prefix = await maybeSwitchFirst();
      onSend(composeText(prefix, text));
      setText('');
    }

    function onKey(e) {
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault();onStop && onStop();return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();fire();
      }
    }

    return (
      <div style={{
        padding: '0 28px 16px',
        position: 'relative'
      }} data-comment-anchor="9c1e2b1fd1-div-393-7">
        <div style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
          {showSlash &&
          <SlashMenu
            query={slashQuery}
            theme={theme} variant={variant}
            onPick={(c) => setText('/' + c.name + ' ')} />

          }
          <div style={{
            background: theme.surface,
            border: `1px solid ${mode === 'steer' ? theme.status.awaiting : theme.borderStrong}`,
            borderRadius: variant.radius,
            boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 24px rgba(0,0,0,0.18)',
            transition: 'border-color .15s'
          }}>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={
              isStreaming ?
              variant.allMono ? 'type to steer mid-response…' : 'Type to steer the response, or hit Esc to stop…' :
              variant.allMono ? 'type a message or / for commands…' : 'Reply to Claude — / for commands, ⇧⏎ for newline'
              }
              rows={2}
              style={{
                width: '100%',
                background: 'transparent', border: 'none', outline: 'none',
                color: theme.text, fontSize: 13,
                fontFamily: variant.font,
                padding: '12px 14px 8px',
                resize: 'none', minHeight: 56,
                letterSpacing: variant.letterSpacing
              }} />
            
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 8px 8px',
              borderTop: `1px solid ${theme.border}`
            }}>
              {/* Bottom-left: attach */}
              <IconBtn title="Attach file or image" theme={theme} variant={variant}>
                <window.Icons.Paperclip size={13} />
              </IconBtn>

              {/* Center: pickers. Changes here just stage the new value
                  locally — the actual switchSession call happens on the
                  next user message (see fire() / maybeSwitchFirst). */}
              <ModelPicker provider={provider} model={model} theme={theme} variant={variant} providers={providers}
              onChange={(p, m) => { setProvider(p); setModel(m); }} />
              <BudgetPicker value={effort} onChange={(e) => setEffort(e)} theme={theme} variant={variant} />
              <Pill theme={theme} variant={variant} onClick={() => setText('/')}>
                <window.Icons.Slash size={12} />
                <span style={{ color: theme.textMuted }}>commands</span>
              </Pill>

              <div style={{ flex: 1 }} />

              {/* Bottom-right cluster */}
              <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono, marginRight: 2 }}>
                {text.length > 0 ? text.length + ' chars' : ''}
              </span>
              <IconBtn
                title={voice ? 'Stop recording' : 'Voice input'}
                theme={theme} variant={variant} active={voice}
                color={voice ? theme.status.failed : undefined}
                onClick={() => setVoice(!voice)}>
                
                {voice ?
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: theme.status.failed,
                    animation: 'hrnPulse 1.4s ease-in-out infinite'
                  }} />
                    <window.Icons.Mic size={13} />
                  </span> :

                <window.Icons.Mic size={13} />
                }
              </IconBtn>
              <SendButton mode={mode} onClick={fire} theme={theme} variant={variant} />
            </div>
          </div>
        </div>
      </div>);

  }

  window.InputBox = InputBox;
})();