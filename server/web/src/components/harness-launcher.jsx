// Unified Launcher screen — replaces the old new-session form.
// Centered, immersive input box with provider/model/cwd/branch as inline
// dropdowns. Doubles as the home screen.

(function () {
  const { useState, useRef, useEffect, useMemo } = React;

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

  function ModeToggle({ value, onChange, theme, variant }) {
    const opts = [
      { id: 'code', label: variant.allMono ? 'code' : 'Code', icon: <window.Icons.Wrench size={11} /> },
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

  function LauncherView({ data, theme, variant, tweaks, setTweak, onCreate, onCancel, hasActiveSession }) {
    const [mode, setMode] = useState('code');
    const [text, setText] = useState('');
    const [provider, setProvider] = useState('claude');
    const [model, setModel] = useState('sonnet');
    const [cwd, setCwd] = useState('~/code/web-app');
    const [branch, setBranch] = useState('main');
    const [env, setEnv] = useState('local');
    const taRef = useRef(null);

    const environments = data.environments || [];
    const gitRepos = data.gitRepos || [];
    const isGitRepo = gitRepos.includes(cwd);

    // Translate a cwd display string based on the platform of the selected env.
    // We store paths canonically (unix-style with ~ and /), and rewrite for
    // display only when the target is Windows.
    const currentEnv = environments.find(e => e.id === env);
    const isWindowsEnv = currentEnv && currentEnv.platform === 'windows';
    function displayPath(p) {
      if (!p) return p;
      if (!isWindowsEnv) return p;
      // ~/code/web-app  →  C:\Users\you\code\web-app
      return p.replace(/^~\//, 'C:\\Users\\you\\').replace(/\//g, '\\');
    }

    const cwds = useMemo(() => Array.from(new Set(
      data.sessions.filter(s => s.cwd && s.cwd !== 'Chats').map(s => s.cwd)
    )), [data.sessions]);

    // Mock branches per cwd
    const branches = useMemo(() => {
      const all = data.sessions.filter(s => s.cwd === cwd && s.branch).map(s => s.branch);
      return Array.from(new Set([...all, 'main', 'develop']));
    }, [cwd, data.sessions]);

    useEffect(() => {
      if (taRef.current) {
        taRef.current.style.height = 'auto';
        taRef.current.style.height = Math.min(Math.max(taRef.current.scrollHeight, 90), 240) + 'px';
        taRef.current.focus();
      }
    }, [text]);

    function fire() {
      if (!text.trim()) return;
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

    const providers = window.PROVIDERS || {
      claude: { label: 'Anthropic', models: ['haiku', 'sonnet', 'opus'] },
      codex:  { label: 'OpenAI',    models: ['gpt-5.5'] },
      gemini: { label: 'Google',    models: ['pro-3-1-preview'] },
    };

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
              {mode === 'chat' ? 'ask' : 'new-session'}
            </h1>
            <ModeToggle value={mode} onChange={setMode} theme={theme} variant={variant} />
          </div>

          {/* THE input box — same DNA as chat input, just bigger */}
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

              {/* Environment — only in code mode, between model and cwd */}
              {mode === 'code' && (
                <Dropdown
                  theme={theme} variant={variant} width={260} align="left"
                  trigger={(open) => (
                    <PillTrigger
                      icon={<window.Icons.Server size={11} />}
                      value={env || 'no env'}
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
                            onClick={() => { if (!offline) { setEnv(e.id); close(); } }}
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
                      <div style={{ borderTop: `1px solid ${theme.border}`, margin: '4px 0' }} />
                      <DropdownItem
                        onClick={() => { setEnv(null); close(); }}
                        active={env == null}
                        theme={theme} variant={variant}
                        icon={<window.Icons.X size={11} />}
                        label={variant.allMono ? 'no environment' : 'No environment'}
                      />
                    </>
                  )}
                </Dropdown>
              )}

              {/* CWD — only in code mode */}
              {mode === 'code' && (
                <Dropdown
                  theme={theme} variant={variant} width={300}
                  trigger={(open) => (
                    <PillTrigger
                      icon={<window.Icons.Folder size={11} />}
                      value={displayPath(cwd)}
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
                          onClick={() => { setCwd(c); close(); }}
                          theme={theme} variant={variant}
                          icon={<window.Icons.Folder size={11} />}
                          label={
                            <span style={{ fontFamily: variant.mono, fontSize: 11.5 }}>
                              {displayPath(c)}
                            </span>
                          }
                        />
                      ))}
                      <div style={{ borderTop: `1px solid ${theme.border}`, margin: '4px 0' }} />
                      <DropdownItem
                        onClick={() => { close(); }}
                        theme={theme} variant={variant}
                        icon={<window.Icons.Plus size={11} />}
                        label={variant.allMono ? 'browse…' : 'Browse for folder…'}
                      />
                    </>
                  )}
                </Dropdown>
              )}

              {/* Branch — only if cwd is a git repo */}
              {mode === 'code' && isGitRepo && (
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
                disabled={!text.trim()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: text.trim() ? theme.accent : theme.surface2,
                  color: text.trim() ? theme.accentText : theme.textMuted,
                  border: `1px solid ${text.trim() ? theme.accent : theme.border}`,
                  borderRadius: variant.radiusSm,
                  padding: '5px 11px',
                  fontSize: 12, cursor: text.trim() ? 'pointer' : 'default',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                  fontWeight: 500,
                }}
              >
                <window.Icons.Send size={11} />
                {variant.allMono ? 'start' : (mode === 'chat' ? 'Send' : 'Start session')}
                <span style={{
                  fontSize: 10, fontFamily: variant.mono,
                  padding: '0 3px',
                  border: `1px solid ${text.trim() ? 'rgba(255,255,255,0.3)' : theme.border}`,
                  borderRadius: 3, opacity: 0.85,
                }}>⏎</span>
              </button>
            </div>
          </div>

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
