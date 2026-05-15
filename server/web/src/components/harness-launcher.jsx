// Unified Launcher screen — replaces the old new-session form.
// Centered, immersive input box with provider/model/cwd/branch as inline
// dropdowns. Doubles as the home screen.

(function () {
  const { useState, useRef, useEffect, useMemo } = React;

  // Per-client last-used cwd, persisted to localStorage. So flipping back to
  // an environment auto-fills the directory you were on last time. Falls
  // back to null when nothing's stored or localStorage is unavailable.
  const LAST_CWD_KEY = 'hrn:lastCwd';
  function loadLastCwds() {
    try {
      const raw = typeof window !== 'undefined' && window.localStorage?.getItem(LAST_CWD_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveLastCwd(envId, cwd) {
    if (!envId || !cwd) return;
    try {
      const all = loadLastCwds();
      all[envId] = cwd;
      window.localStorage?.setItem(LAST_CWD_KEY, JSON.stringify(all));
    } catch {}
  }
  function rememberedCwd(envId) {
    if (!envId) return null;
    return loadLastCwds()[envId] || null;
  }

  function Dropdown({ trigger, children, theme, variant, align = 'left', width = 220 }) {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ position: 'relative' }}>
        <div onClick={() => setOpen(!open)} style={{ display: 'inline-flex' }}>
          {trigger(open)}
        </div>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{
              position: 'absolute', bottom: '100%', [align]: 0, marginBottom: 6,
              background: theme.surface2,
              border: `1px solid ${theme.borderStrong}`,
              borderRadius: variant.radius,
              padding: 4, minWidth: width, zIndex: 51,
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
              maxHeight: 320, overflowY: 'auto',
            }}>
              {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
            </div>
          </>
        )}
      </div>
    );
  }

  function DropdownItem({ active, onClick, theme, variant, icon, label, hint }) {
    return (
      <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 8px', background: 'transparent', border: 'none',
        cursor: 'pointer', color: theme.text, fontSize: 12, textAlign: 'left',
        borderRadius: variant.radiusSm,
        fontFamily: variant.allMono ? variant.mono : 'inherit',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = theme.surfaceHover}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {icon}
        <span style={{ flex: 1 }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>{hint}</span>}
        {active && <span style={{ color: theme.accent, fontSize: 11 }}>●</span>}
      </button>
    );
  }

  function PillTrigger({ icon, value, sub, open, theme, variant, accent }) {
    return (
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: open ? theme.surfaceHover : 'transparent',
        border: `1px solid ${open ? theme.borderStrong : theme.border}`,
        borderRadius: variant.radiusSm,
        color: theme.text,
        padding: '5px 8px',
        fontSize: 11.5, cursor: 'pointer',
        fontFamily: variant.allMono ? variant.mono : 'inherit',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = theme.surfaceHover}
      onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {icon}
        <span>{value}</span>
        {sub && <span style={{ color: theme.textMuted, fontSize: 10.5, fontFamily: variant.mono }}>{sub}</span>}
        <window.Icons.ChevronDown size={9} style={{ color: theme.textMuted }} />
      </button>
    );
  }

  function IconBtn({ onClick, theme, variant, active, color, title, children }) {
    return (
      <button onClick={onClick} title={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          background: active ? theme.surfaceHover : 'transparent',
          border: `1px solid ${active ? theme.borderStrong : theme.border}`,
          borderRadius: variant.radiusSm,
          color: color || theme.textDim,
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = color || theme.text; e.currentTarget.style.background = theme.surfaceHover; }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = color || theme.textDim; e.currentTarget.style.background = 'transparent'; } }}
      >
        {children}
      </button>
    );
  }

  // Bind glyph — two interlocking chain links.
  function BindIcon({ size = 11 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 8.5a3 3 0 0 0 4.243 0l1.414-1.414a3 3 0 0 0-4.243-4.243L5.5 4.257" />
        <path d="M8.5 5.5a3 3 0 0 0-4.243 0L2.843 6.914a3 3 0 0 0 4.243 4.243L8.5 9.743" />
      </svg>
    );
  }

  // Bind-mode session table — lists *untracked* on-disk sessions for the
  // selected environment + directory (fetched via the `list` agent command),
  // each with a Bind button that adopts it via the real bindSession API.
  // Paginated client-side so a long list doesn't run off the screen.
  function BindSessionTable({ env, cwd, onListSessions, trackedIds, onBind, theme, variant }) {
    const PAGE_SIZE = 8;
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);

    useEffect(() => {
      setPage(0);
      if (!env || !cwd || !onListSessions) { setItems([]); setError(null); return; }
      let cancelled = false;
      setLoading(true);
      setError(null);
      Promise.resolve(onListSessions(env, cwd))
        .then((list) => {
          if (cancelled) return;
          setItems((list || []).filter((it) => !trackedIds.has(it.sessionId)));
        })
        .catch((err) => { if (!cancelled) setError(err); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
      // onListSessions is identity-unstable across renders; env+cwd drive refetch.
    }, [env, cwd]);

    const note = (txt) => (
      <div style={{
        padding: '32px 0', textAlign: 'center', color: theme.textMuted,
        fontSize: 12, fontFamily: variant.allMono ? variant.mono : 'inherit',
      }}>{txt}</div>
    );
    if (!env || !cwd) {
      return note(variant.allMono
        ? '# pick a client + directory above'
        : 'Pick a client and directory above to list sessions');
    }
    if (loading) return note(variant.allMono ? '# loading…' : 'Loading sessions…');
    if (error) return note(`Could not list sessions: ${error && error.message ? error.message : error}`);
    if (items.length === 0) {
      return note(variant.allMono
        ? '# no untracked sessions here'
        : 'No untracked sessions found in this directory');
    }

    const fmtTime = (iso) => {
      const t = Date.parse(iso);
      if (!t) return '—';
      const d = new Date(t);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    const COLS = '1fr 116px 72px';
    const pageCount = Math.ceil(items.length / PAGE_SIZE);
    const safePage = Math.min(page, pageCount - 1);
    const start = safePage * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    const pageBtn = (label, onClick, disabled) => (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          background: 'transparent', border: `1px solid ${theme.border}`,
          borderRadius: variant.radiusSm,
          color: disabled ? theme.textMuted : theme.textDim,
          padding: '3px 9px', fontSize: 11,
          cursor: disabled ? 'default' : 'pointer',
          fontFamily: variant.allMono ? variant.mono : 'inherit',
        }}
        onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.color = theme.text; e.currentTarget.style.borderColor = theme.borderStrong; } }}
        onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.borderColor = theme.border; } }}
      >{label}</button>
    );

    return (
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: variant.radius, overflow: 'hidden', background: theme.surface }}>
        <div style={{
          display: 'grid', gridTemplateColumns: COLS, columnGap: 12, padding: '7px 14px',
          borderBottom: `1px solid ${theme.border}`, background: theme.surface2,
          fontSize: 10, color: theme.textMuted, alignItems: 'center',
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          textTransform: variant.allMono ? 'none' : 'uppercase',
          letterSpacing: variant.allMono ? 0 : '0.06em', fontWeight: 600,
        }}>
          <span>Session</span>
          <span>Last activity</span>
          <span></span>
        </div>
        {pageItems.map((s, i) => (
          <div
            key={s.sessionId}
            style={{
              display: 'grid', gridTemplateColumns: COLS, columnGap: 12, padding: '10px 14px',
              borderTop: i === 0 ? 'none' : `1px solid ${theme.border}`,
              alignItems: 'center', transition: 'background .1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.surfaceHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, color: theme.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                letterSpacing: variant.letterSpacing,
              }}>
                {s.title && s.title !== s.sessionId ? (
                  <>
                    {s.title}
                    <span style={{ color: theme.textMuted, fontFamily: variant.mono, fontSize: 11, marginLeft: 6 }}>
                      {s.sessionId}
                    </span>
                  </>
                ) : s.sessionId}
              </div>
              <div style={{
                fontSize: 10, color: theme.textMuted, fontFamily: variant.mono, marginTop: 2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{s.lastText || s.sessionId}</div>
            </div>
            <div style={{ fontSize: 10.5, color: theme.textDim, fontFamily: variant.mono }}>
              {fmtTime(s.lastMessageAt)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => onBind(s)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'transparent', color: theme.textDim,
                  border: `1px solid ${theme.border}`,
                  borderRadius: variant.radiusSm, padding: '3px 9px',
                  fontSize: 11, cursor: 'pointer',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = theme.accentSoft; e.currentTarget.style.color = theme.accent; e.currentTarget.style.borderColor = theme.accentLine; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textDim; e.currentTarget.style.borderColor = theme.border; }}
              >
                <BindIcon size={10} />
                {variant.allMono ? 'bind' : 'Bind'}
              </button>
            </div>
          </div>
        ))}
        {pageCount > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 14px', borderTop: `1px solid ${theme.border}`,
            background: theme.surface2,
          }}>
            <span style={{ fontSize: 10.5, color: theme.textMuted, fontFamily: variant.mono }}>
              {start + 1}–{start + pageItems.length} of {items.length}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {pageBtn(variant.allMono ? 'prev' : 'Prev', () => setPage((p) => Math.max(0, p - 1)), safePage <= 0)}
              {pageBtn(variant.allMono ? 'next' : 'Next', () => setPage((p) => Math.min(pageCount - 1, p + 1)), safePage >= pageCount - 1)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Custom-path text entry for Bind mode — replaces the directory dropdown
  // when the user picks "custom path". Keeps a local draft and only commits
  // (Enter / blur / the ▾ button) so the session table doesn't refetch on
  // every keystroke. The ▾ flips back to the directory list.
  function CustomPathInput({ value, onCommit, onPickList, theme, variant }) {
    const [draft, setDraft] = useState(value || '');
    const commit = () => onCommit(draft.trim());
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: theme.surface2,
        border: `1px solid ${theme.borderStrong}`,
        borderRadius: variant.radiusSm,
        padding: '0 0 0 8px',
      }}>
        <window.Icons.Folder size={11} style={{ color: theme.textMuted, flexShrink: 0 }} />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); onPickList(); }
          }}
          placeholder={variant.allMono ? 'path…' : 'Enter a path…'}
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: theme.text, fontSize: 11.5, width: 210,
            fontFamily: variant.mono, padding: '5px 4px',
          }}
        />
        <button
          onClick={() => { commit(); onPickList(); }}
          title="Pick from the list instead"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: theme.textMuted, padding: '6px 7px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = theme.textMuted; }}
        >
          <window.Icons.ChevronDown size={9} />
        </button>
      </div>
    );
  }

  function ModeToggle({ value, onChange, theme, variant }) {
    const opts = [
      { id: 'code', label: variant.allMono ? 'code' : 'Code', icon: <window.Icons.Wrench size={11} /> },
      { id: 'bind', label: variant.allMono ? 'bind' : 'Bind', icon: <BindIcon size={11} /> },
      { id: 'chat', label: variant.allMono ? 'chat' : 'Chat', icon: <window.Icons.Sparkle size={11} /> },
    ];
    return (
      <div style={{
        display: 'inline-flex', gap: 2,
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: variant.radius,
        padding: 2,
      }}>
        {opts.map(o => {
          const active = o.id === value;
          return (
            <button key={o.id} onClick={() => onChange(o.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: active ? theme.surface : 'transparent',
              border: 'none',
              borderRadius: variant.radiusSm,
              color: active ? theme.text : theme.textDim,
              padding: '4px 10px',
              fontSize: 11.5, cursor: 'pointer',
              fontWeight: active ? 500 : 400,
              fontFamily: variant.allMono ? variant.mono : 'inherit',
              boxShadow: active ? `0 1px 2px rgba(0,0,0,0.15)` : 'none',
            }}>
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  function LauncherView({ data, theme, variant, tweaks, setTweak, onCreate, onListSessions, onBind, onCancel, hasActiveSession }) {
    const [mode, setMode] = useState('code');
    const [text, setText] = useState('');
    const [provider, setProvider] = useState('claude');
    const [model, setModel] = useState('sonnet');
    const [cwd, setCwd] = useState(null);
    const [branch, setBranch] = useState('main');
    const [env, setEnv] = useState(null);
    const [cwdCustom, setCwdCustom] = useState(false);
    // Bind mode keeps its own client/directory selection, separate from Code
    // mode's env/cwd: the client defaults to none (nothing else shows until
    // one is picked), the directory list is scoped to the chosen client, and
    // the directory can be a custom typed path.
    const [bindEnv, setBindEnv] = useState(null);
    const [bindCwd, setBindCwd] = useState(null);
    const [bindCwdCustom, setBindCwdCustom] = useState(false);
    const taRef = useRef(null);

    const environments = data.environments || [];
    const gitRepos = data.gitRepos || [];
    const isGitRepo = gitRepos.includes(cwd);

    // Code mode — directories scoped to the selected client (host); same
    // shape as bindCwds. Feeds the directory dropdown once a client is picked.
    const cwds = useMemo(() => Array.from(new Set(
      data.sessions
        .filter(s => s.clientName === env && s.cwd && s.cwd !== 'Chats')
        .map(s => s.cwd)
    )), [data.sessions, env]);

    // Bind mode — directories and tracked-session ids scoped to the chosen
    // client. `bindCwds` feeds the directory dropdown (the client's known
    // dirs); `trackedIds` lets the table hide already-tracked sessions.
    const bindCwds = useMemo(
      () => Array.from(new Set(
        data.sessions
          .filter(s => s.clientName === bindEnv && s.cwd && s.cwd !== 'Chats')
          .map(s => s.cwd)
      )),
      [data.sessions, bindEnv],
    );
    const trackedIds = useMemo(
      () => new Set(data.sessions.filter(s => s.clientName === bindEnv).map(s => s.sessionId)),
      [data.sessions, bindEnv],
    );

    // Mock branches per cwd
    const branches = useMemo(() => {
      const all = data.sessions.filter(s => s.cwd === cwd && s.branch).map(s => s.branch);
      return Array.from(new Set([...all, 'main', 'develop']));
    }, [cwd, data.sessions]);

    useEffect(() => {
      if (taRef.current && mode !== 'bind') {
        taRef.current.style.height = 'auto';
        taRef.current.style.height = Math.min(Math.max(taRef.current.scrollHeight, 90), 240) + 'px';
        taRef.current.focus();
      }
    }, [text, mode]);

    // Code mode needs a host + directory before it can start; chat mode just
    // needs text. (Bind mode doesn't use the input box at all.)
    const canFire = mode === 'code' ? !!(text.trim() && env && cwd) : !!text.trim();

    function fire() {
      if (!canFire) return;
      onCreate && onCreate({ mode, text, provider, model,
        cwd: mode === 'code' ? cwd : null,
        branch: mode === 'code' ? branch : null,
        env: mode === 'code' ? env : null });
      setText('');
    }

    function onKey(e) {
      if (e.key === 'Escape' && hasActiveSession) { e.preventDefault(); onCancel && onCancel(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); }
    }

    // Aggregate providers/models across every connected client (same source
    // as Settings → Providers). Falls back to an empty map if nothing's
    // registered yet.
    const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
    const providers = useMemo(() => {
      const byProvider = new Map();
      for (const e of environments) {
        for (const [pId, info] of Object.entries(e.providers || {})) {
          if (!byProvider.has(pId)) byProvider.set(pId, { label: PROVIDER_LABELS[pId] || pId, models: new Set() });
          for (const m of info.models || []) byProvider.get(pId).models.add(m);
        }
      }
      const out = {};
      for (const [pId, p] of byProvider.entries()) {
        out[pId] = { label: p.label, models: Array.from(p.models) };
      }
      return out;
    }, [environments]);

    // Snap default provider/model to the first real one once data arrives,
    // and re-snap if the currently selected pair vanishes from the list.
    useEffect(() => {
      const ids = Object.keys(providers);
      if (!ids.length) return;
      const pId = providers[provider] ? provider : ids[0];
      const models = providers[pId]?.models || [];
      if (!models.length) return;
      const m = models.includes(model) ? model : models[0];
      if (pId !== provider) setProvider(pId);
      if (m !== model) setModel(m);
    }, [providers, provider, model]);

    // Recent sessions to continue
    const recents = data.sessions.slice(0, 4);

    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 32px', position: 'relative',
        background: theme.bg, minHeight: 0, overflowY: 'auto',
      }}>
        {/* Center stack — purposely loose vertical rhythm */}
        <div style={{
          width: '100%', maxWidth: 720,
          display: 'flex', flexDirection: 'column', gap: 18,
        }}>
          {/* Title + mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 500, color: theme.text,
              letterSpacing: variant.titleSpacing,
              fontFamily: variant.mono,
            }}>
              <span style={{ color: theme.textMuted }}>#</span>{' '}
              {mode === 'chat' ? 'ask' : mode === 'bind' ? 'bind-session' : 'new-session'}
            </h1>
            <ModeToggle value={mode} onChange={setMode} theme={theme} variant={variant} />
          </div>

          {/* Code / Chat mode — the big input box */}
          {mode !== 'bind' && (
          <div style={{
            background: theme.surface,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: variant.radius,
            boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset, 0 16px 48px rgba(0,0,0,0.28)',
          }}>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              autoFocus
              placeholder={
                mode === 'chat'
                  ? (variant.allMono ? 'ask anything…' : 'Ask anything — explanations, debugging, brainstorming…')
                  : (variant.allMono ? 'what should we build?' : 'What should we build? Describe the task or paste a stack trace…')
              }
              rows={3}
              style={{
                width: '100%',
                background: 'transparent', border: 'none', outline: 'none',
                color: theme.text, fontSize: 14,
                fontFamily: variant.font,
                padding: '16px 18px 10px',
                resize: 'none', minHeight: 90,
                letterSpacing: variant.letterSpacing,
                boxSizing: 'border-box',
              }}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 10px',
              borderTop: `1px solid ${theme.border}`,
              flexWrap: 'wrap',
            }}>
              {/* Attach (bottom-left) */}
              <IconBtn title="Attach file or image" theme={theme} variant={variant}>
                <window.Icons.Paperclip size={13} />
              </IconBtn>

              {/* Provider/Model — one dropdown */}
              <Dropdown
                theme={theme} variant={variant} width={240}
                trigger={(open) => (
                  <PillTrigger
                    icon={<window.ProviderIcon provider={provider} size={12} theme={theme} variant={variant} square />}
                    value={model}
                    open={open} theme={theme} variant={variant}
                  />
                )}
              >
                {({ close }) => {
                  // Flat list — each item is "<provider> / <model>"
                  const flat = [];
                  Object.entries(providers).forEach(([pId, p]) => {
                    p.models.forEach(m => flat.push({ pId, model: m, providerLabel: p.label }));
                  });
                  return flat.map(({ pId, model: m, providerLabel }) => (
                    <DropdownItem
                      key={pId + ':' + m}
                      active={pId === provider && m === model}
                      onClick={() => { setProvider(pId); setModel(m); close(); }}
                      theme={theme} variant={variant}
                      icon={<window.ProviderIcon provider={pId} size={12} theme={theme} variant={variant} square />}
                      label={
                        <span>
                          <span style={{ color: theme.textDim }}>{providerLabel}</span>
                          <span style={{ color: theme.textMuted, margin: '0 5px' }}>/</span>
                          <span>{m}</span>
                        </span>
                      }
                    />
                  ));
                }}
              </Dropdown>

              {/* Client / host — only in code mode; defaults to none, and the
                  directory + Start stay gated until one is chosen. */}
              {mode === 'code' && (
                <Dropdown
                  theme={theme} variant={variant} width={260} align="left"
                  trigger={(open) => (
                    <PillTrigger
                      icon={<window.Icons.Server size={11} />}
                      value={env || (variant.allMono ? 'select client' : 'Select a client…')}
                      open={open} theme={theme} variant={variant}
                    />
                  )}
                >
                  {({ close }) => (
                    <>
                      <div style={{
                        padding: '5px 8px', fontSize: 10, color: theme.textMuted,
                        fontFamily: variant.mono,
                      }}>
                        registered clients
                      </div>
                      {environments.map(e => {
                        const offline = !e.connected || !e.enabled;
                        const stateLabel = !e.connected ? 'disconnected' : !e.enabled ? 'disabled' : null;
                        return (
                          <DropdownItem
                            key={e.id}
                            active={e.id === env}
                            onClick={() => { if (!offline) { setEnv(e.id); const last = rememberedCwd(e.id); setCwd(last); setCwdCustom(false); setBranch('main'); close(); } }}
                            theme={theme} variant={variant}
                            icon={<span style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: offline ? theme.textMuted : theme.status.completed,
                              display: 'inline-block', flexShrink: 0,
                            }} />}
                            label={
                              <span>
                                {e.name}
                                <span style={{ color: theme.textMuted, marginLeft: 8, fontSize: 10.5 }}>
                                  {e.os}
                                </span>
                              </span>
                            }
                            hint={stateLabel}
                          />
                        );
                      })}
                      {environments.length === 0 && (
                        <div style={{ padding: '6px 8px', fontSize: 11, color: theme.textMuted, fontFamily: variant.allMono ? variant.mono : 'inherit' }}>
                          no registered clients
                        </div>
                      )}
                    </>
                  )}
                </Dropdown>
              )}

              {/* Directory — only once a client is chosen; scoped to that
                  client's known dirs, with a custom-path escape hatch. */}
              {mode === 'code' && env && !cwdCustom && (
                <Dropdown
                  theme={theme} variant={variant} width={300}
                  trigger={(open) => (
                    <PillTrigger
                      icon={<window.Icons.Folder size={11} />}
                      value={cwd || (variant.allMono ? 'select directory' : 'Select a directory…')}
                      open={open} theme={theme} variant={variant}
                    />
                  )}
                >
                  {({ close }) => (
                    <>
                      {cwds.map(c => (
                        <DropdownItem
                          key={c}
                          active={c === cwd}
                          onClick={() => { setCwd(c); saveLastCwd(env, c); close(); }}
                          theme={theme} variant={variant}
                          icon={<window.Icons.Folder size={11} />}
                          label={<span style={{ fontFamily: variant.mono, fontSize: 11.5 }}>{c}</span>}
                        />
                      ))}
                      {cwds.length === 0 && (
                        <div style={{ padding: '6px 8px', fontSize: 11, color: theme.textMuted, fontFamily: variant.allMono ? variant.mono : 'inherit' }}>
                          no known directories
                        </div>
                      )}
                      <div style={{ borderTop: `1px solid ${theme.border}`, margin: '4px 0' }} />
                      <DropdownItem
                        onClick={() => { setCwdCustom(true); close(); }}
                        theme={theme} variant={variant}
                        icon={<window.Icons.Plus size={11} />}
                        label={variant.allMono ? 'custom path…' : 'Enter a custom path…'}
                      />
                    </>
                  )}
                </Dropdown>
              )}

              {/* Directory — custom typed path; the ▾ flips back to the list. */}
              {mode === 'code' && env && cwdCustom && (
                <CustomPathInput
                  value={cwd}
                  onCommit={(p) => { setCwd(p); saveLastCwd(env, p); }}
                  onPickList={() => setCwdCustom(false)}
                  theme={theme} variant={variant}
                />
              )}

              {/* Branch — only once host + directory are picked and it's a git repo */}
              {mode === 'code' && env && cwd && isGitRepo && (
                <Dropdown
                  theme={theme} variant={variant} width={220}
                  trigger={(open) => (
                    <PillTrigger
                      icon={<window.Icons.Branch size={11} />}
                      value={branch}
                      open={open} theme={theme} variant={variant}
                    />
                  )}
                >
                  {({ close }) => (
                    <>
                      {branches.map(b => (
                        <DropdownItem
                          key={b}
                          active={b === branch}
                          onClick={() => { setBranch(b); close(); }}
                          theme={theme} variant={variant}
                          icon={<window.Icons.Branch size={11} />}
                          label={b}
                        />
                      ))}
                    </>
                  )}
                </Dropdown>
              )}

              <div style={{ flex: 1 }} />

              {/* Voice (bottom-right) */}
              <IconBtn title="Voice input" theme={theme} variant={variant}>
                <window.Icons.Mic size={13} />
              </IconBtn>

              {/* Send */}
              <button
                onClick={fire}
                disabled={!canFire}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: canFire ? theme.accent : theme.surface2,
                  color: canFire ? theme.accentText : theme.textMuted,
                  border: `1px solid ${canFire ? theme.accent : theme.border}`,
                  borderRadius: variant.radiusSm,
                  padding: '5px 11px',
                  fontSize: 12, cursor: canFire ? 'pointer' : 'default',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                  fontWeight: 500,
                }}
              >
                <window.Icons.Send size={11} />
                {variant.allMono ? 'start' : (mode === 'chat' ? 'Send' : 'Start session')}
                <span style={{
                  fontSize: 10, fontFamily: variant.mono,
                  padding: '0 3px',
                  border: `1px solid ${canFire ? 'rgba(255,255,255,0.3)' : theme.border}`,
                  borderRadius: 3, opacity: 0.85,
                }}>⏎</span>
              </button>
            </div>
          </div>
          )}

          {/* Bind mode — environment + directory pills, then a table of
              untracked on-disk sessions to adopt via the real bindSession API. */}
          {mode === 'bind' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                padding: '10px 14px',
                background: theme.surface,
                border: `1px solid ${theme.borderStrong}`,
                borderRadius: variant.radius,
                boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 20px rgba(0,0,0,0.18)',
              }}>
                <span style={{ fontSize: 11, color: theme.textMuted, fontFamily: variant.mono, marginRight: 2 }}>
                  {variant.allMono ? 'client:' : 'Connect to:'}
                </span>

                {/* Client / host — defaults to none; the directory picker and
                    the session table stay hidden/empty until one is chosen. */}
                <Dropdown
                  theme={theme} variant={variant} width={260} align="left"
                  trigger={(open) => (
                    <PillTrigger
                      icon={<window.Icons.Server size={11} />}
                      value={bindEnv || (variant.allMono ? 'select client' : 'Select a client…')}
                      open={open} theme={theme} variant={variant}
                    />
                  )}
                >
                  {({ close }) => (
                    <>
                      <div style={{ padding: '5px 8px', fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>
                        registered clients
                      </div>
                      {environments.map(e => {
                        const offline = !e.connected || !e.enabled;
                        const stateLabel = !e.connected ? 'disconnected' : !e.enabled ? 'disabled' : null;
                        return (
                          <DropdownItem
                            key={e.id}
                            active={e.id === bindEnv}
                            onClick={() => { if (!offline) { setBindEnv(e.id); setBindCwd(rememberedCwd(e.id)); setBindCwdCustom(false); close(); } }}
                            theme={theme} variant={variant}
                            icon={<span style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: offline ? theme.textMuted : theme.status.completed,
                              display: 'inline-block', flexShrink: 0,
                            }} />}
                            label={
                              <span>
                                {e.name}
                                <span style={{ color: theme.textMuted, marginLeft: 8, fontSize: 10.5 }}>{e.os}</span>
                              </span>
                            }
                            hint={stateLabel}
                          />
                        );
                      })}
                      {environments.length === 0 && (
                        <div style={{ padding: '6px 8px', fontSize: 11, color: theme.textMuted, fontFamily: variant.allMono ? variant.mono : 'inherit' }}>
                          no registered clients
                        </div>
                      )}
                    </>
                  )}
                </Dropdown>

                {/* Directory — only once a client is chosen; scoped to that
                    client's known dirs, with a custom-path escape hatch. */}
                {bindEnv && !bindCwdCustom && (
                  <Dropdown
                    theme={theme} variant={variant} width={320} align="left"
                    trigger={(open) => (
                      <PillTrigger
                        icon={<window.Icons.Folder size={11} />}
                        value={bindCwd || (variant.allMono ? 'select directory' : 'Select a directory…')}
                        open={open} theme={theme} variant={variant}
                      />
                    )}
                  >
                    {({ close }) => (
                      <>
                        {bindCwds.map(c => (
                          <DropdownItem
                            key={c}
                            active={c === bindCwd}
                            onClick={() => { setBindCwd(c); saveLastCwd(bindEnv, c); close(); }}
                            theme={theme} variant={variant}
                            icon={<window.Icons.Folder size={11} />}
                            label={<span style={{ fontFamily: variant.mono, fontSize: 11.5 }}>{c}</span>}
                          />
                        ))}
                        {bindCwds.length === 0 && (
                          <div style={{ padding: '6px 8px', fontSize: 11, color: theme.textMuted, fontFamily: variant.allMono ? variant.mono : 'inherit' }}>
                            no known directories
                          </div>
                        )}
                        <div style={{ borderTop: `1px solid ${theme.border}`, margin: '4px 0' }} />
                        <DropdownItem
                          onClick={() => { setBindCwdCustom(true); close(); }}
                          theme={theme} variant={variant}
                          icon={<window.Icons.Plus size={11} />}
                          label={variant.allMono ? 'custom path…' : 'Enter a custom path…'}
                        />
                      </>
                    )}
                  </Dropdown>
                )}

                {/* Directory — custom typed path; the ▾ flips back to the list. */}
                {bindEnv && bindCwdCustom && (
                  <CustomPathInput
                    value={bindCwd}
                    onCommit={(p) => { setBindCwd(p); saveLastCwd(bindEnv, p); }}
                    onPickList={() => setBindCwdCustom(false)}
                    theme={theme} variant={variant}
                  />
                )}
              </div>

              <BindSessionTable
                env={bindEnv}
                cwd={bindCwd}
                onListSessions={onListSessions}
                trackedIds={trackedIds}
                onBind={(s) => onBind && onBind({ env: bindEnv, cwd: bindCwd, sessionId: s.sessionId })}
                theme={theme} variant={variant}
              />
            </div>
          )}

          {/* Recents — only if we have history */}
          {recents.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                fontSize: 10, color: theme.textMuted,
                fontFamily: variant.allMono ? variant.mono : 'inherit',
                textTransform: variant.allMono ? 'none' : 'uppercase',
                letterSpacing: variant.allMono ? 0 : '0.07em',
                fontWeight: 600,
                marginBottom: 8,
              }}>
                {variant.allMono ? '# recent' : 'Continue recent'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {recents.map(s => (
                  <button
                    key={s.id}
                    onClick={() => onCreate && onCreate({ continueId: s.id })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: theme.surface,
                      border: `1px solid ${theme.border}`,
                      borderRadius: variant.radiusSm,
                      padding: '9px 12px', cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: variant.allMono ? variant.mono : 'inherit',
                      transition: 'background .12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.surfaceHover; e.currentTarget.style.borderColor = theme.borderStrong; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = theme.surface; e.currentTarget.style.borderColor = theme.border; }}
                  >
                    <window.StatusDot status={s.status} theme={theme} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12.5, color: theme.text, fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        letterSpacing: variant.letterSpacing,
                      }}>{s.title}</div>
                      <div style={{
                        fontSize: 10.5, color: theme.textMuted,
                        fontFamily: variant.mono, marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{s.cwd}{s.branch ? ' · ' + s.branch : ''}</div>
                    </div>
                    <window.ProviderIcon provider={s.provider} size={14} theme={theme} variant={variant} square />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  window.LauncherView = LauncherView;
})();
