// Top bar + main Harness frame with screen routing.

(function () {
  const { useState, useEffect, useRef, useMemo } = React;

  function TopBarIconBtn({ onClick, title, theme, variant, active, badge, children }) {
    return (
      <button
        onClick={onClick}
        title={title}
        style={{
          position: 'relative',
          background: active ? theme.accentSoft : 'transparent',
          border: `1px solid ${active ? theme.accentLine : theme.border}`,
          cursor: 'pointer',
          color: active ? theme.accent : theme.textDim,
          padding: '4px 6px', borderRadius: variant.radiusSm,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = theme.text; e.currentTarget.style.borderColor = theme.borderStrong; }}}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.borderColor = theme.border; }}}
      >
        {children}
        {badge && (
          <span style={{
            fontSize: 9, fontFamily: variant.mono, color: theme.textMuted,
            marginLeft: 1, fontWeight: 500, letterSpacing: 0,
            lineHeight: 1,
          }}>{badge}</span>
        )}
      </button>
    );
  }

  function VariantDropdown({ tweaks, setTweak, theme, variant }) {
    const [open, setOpen] = React.useState(false);
    const anchorRef = useRef(null);
    const pos = window.HarnessPopover.usePopoverPlacement(open, anchorRef, { preferred: 'down' });
    const variants = [
      { id: 'Eclipse', tagline: 'Dense · monochrome · indigo' },
      { id: 'Ember', tagline: 'Warm · rounded · coral' },
      { id: 'Console', tagline: 'Terminal-forward · monospace' },
    ];
    const current = tweaks.variant || 'Eclipse';
    return (
      <div ref={anchorRef} style={{ position: 'relative' }}>
        <TopBarIconBtn
          onClick={() => setOpen(!open)}
          title={`Variant: ${current}`}
          theme={theme} variant={variant}
          active={open}
          badge={current.slice(0, 3)}
        >
          <VariantGlyph />
        </TopBarIconBtn>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{
              position: 'absolute', right: 0,
              ...window.HarnessPopover.popoverStyle(pos),
              background: theme.surface2,
              border: `1px solid ${theme.borderStrong}`,
              borderRadius: variant.radius,
              padding: 4, minWidth: 240, zIndex: 51,
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            }}>
              <div style={{
                padding: '5px 8px 6px', fontSize: 10, color: theme.textMuted,
                fontFamily: variant.allMono ? variant.mono : 'inherit',
                textTransform: variant.allMono ? 'none' : 'uppercase',
                letterSpacing: variant.allMono ? 0 : '0.07em',
                fontWeight: 600,
              }}>
                {variant.allMono ? '# variant' : 'Variant'}
              </div>
              {variants.map(v => {
                const active = current === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => { setTweak('variant', v.id); setOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '7px 9px',
                      background: active ? theme.accentSoft : 'transparent',
                      border: 'none', cursor: 'pointer',
                      borderRadius: variant.radiusSm,
                      textAlign: 'left',
                      fontFamily: variant.allMono ? variant.mono : 'inherit',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.surfaceHover; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: active ? theme.accent : theme.borderStrong,
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, color: theme.text, fontWeight: active ? 500 : 400,
                        letterSpacing: variant.letterSpacing,
                      }}>{v.id}</div>
                      <div style={{ fontSize: 10.5, color: theme.textMuted, marginTop: 1, fontFamily: variant.mono }}>
                        {v.tagline}
                      </div>
                    </div>
                    {active && <span style={{ color: theme.accent, fontSize: 11 }}>●</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Variant icon: 3-dot cluster suggesting "three options".
  function VariantGlyph({ size = 13 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="3.5" r="1.6" />
        <circle cx="3.5" cy="9.5" r="1.6" />
        <circle cx="10.5" cy="9.5" r="1.6" />
      </svg>
    );
  }

  // Density icon: three horizontal lines, tightening
  function DensityGlyph({ density = 'compact', size = 13 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        {density === 'compact' ? (
          <>
            <path d="M3 4h8" />
            <path d="M3 7h8" />
            <path d="M3 10h8" />
          </>
        ) : (
          <>
            <path d="M3 3.5h8" />
            <path d="M3 7h8" />
            <path d="M3 10.5h8" />
          </>
        )}
      </svg>
    );
  }

  // Bubble vs flat icon
  function MessagesGlyph({ bubble, size = 13 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {bubble ? (
          <>
            <rect x="1.5" y="3" width="7" height="4.5" rx="1.5" />
            <rect x="5.5" y="7.5" width="7" height="4.5" rx="1.5" />
          </>
        ) : (
          <>
            <path d="M2 4h10" />
            <path d="M2 7h10" />
            <path d="M2 10h6" />
          </>
        )}
      </svg>
    );
  }

  function TopBar({ theme, variant, tweaks, setTweak, onToggleSidebar, sidebarVisible,
    onHome, onSettings, screen, breadcrumb }) {
    const SidebarIcon = window.Icons.Sidebar;
    const Sun = window.Icons.Sun;
    const Moon = window.Icons.Moon;
    const Settings = window.Icons.Settings;
    return (
      <header style={{
        height: 40,
        flexShrink: 0,
        background: theme.surface,
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex', alignItems: 'center',
        padding: '0 10px 0 14px',
        gap: 10
      }}>
        <button
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: theme.textDim, padding: 4, borderRadius: variant.radiusSm,
            display: 'inline-flex'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = theme.text}
          onMouseLeave={(e) => e.currentTarget.style.color = theme.textDim}>
          <SidebarIcon size={14} />
        </button>

        {/* Logo */}
        <button
          onClick={onHome}
          title="Home — new session"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: theme.text, padding: '4px 4px',
            fontSize: 13, fontWeight: 600,
            letterSpacing: variant.titleSpacing,
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}>
          <span style={{
            width: 16, height: 16, borderRadius: variant.allMono ? 0 : 4,
            background: theme.accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: theme.accentText, fontSize: 10, fontWeight: 700,
            fontFamily: variant.mono
          }}>
            {variant.allMono ? '$' : 'H'}
          </span>
          {variant.allMono ? 'harness' : 'Harness'}
        </button>

        {breadcrumb &&
        <>
          <span style={{ color: theme.textMuted, fontSize: 12 }}>/</span>
          <span style={{
            fontSize: 12, color: theme.textDim,
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}>
            {breadcrumb}
          </span>
        </>
        }

        <div style={{ flex: 1 }} />

        {/* 1. Theme toggle */}
        <TopBarIconBtn
          onClick={() => setTweak('dark', !tweaks.dark)}
          title={tweaks.dark ? 'Theme: Dark (click for Light)' : 'Theme: Light (click for Dark)'}
          theme={theme} variant={variant}
        >
          {tweaks.dark ? <Moon size={13} /> : <Sun size={13} />}
        </TopBarIconBtn>

        {/* 2. Visual variant dropdown */}
        <VariantDropdown tweaks={tweaks} setTweak={setTweak} theme={theme} variant={variant} />

        {/* 3. Density toggle */}
        <TopBarIconBtn
          onClick={() => setTweak('density', tweaks.density === 'compact' ? 'comfy' : 'compact')}
          title={`Density: ${tweaks.density} (click to toggle)`}
          theme={theme} variant={variant}
        >
          <DensityGlyph density={tweaks.density} />
        </TopBarIconBtn>

        {/* 4. Message layout toggle */}
        <TopBarIconBtn
          onClick={() => setTweak('bubble', !tweaks.bubble)}
          title={`Messages: ${tweaks.bubble ? 'Bubble' : 'Flat'} (click to toggle)`}
          theme={theme} variant={variant}
        >
          <MessagesGlyph bubble={tweaks.bubble} />
        </TopBarIconBtn>

        {/* 5. Settings cog */}
        <TopBarIconBtn
          onClick={onSettings}
          title="Settings"
          theme={theme} variant={variant}
          active={screen === 'settings'}
        >
          <Settings size={13} />
        </TopBarIconBtn>
      </header>
    );
  }

  function StatusBar({ session, theme, variant, isStreaming, onKill, onRevive, environments, gitRepos }) {
    const labels = {
      running: 'Running', awaiting: 'Awaiting input', completed: 'Completed',
      idle: 'Idle', failed: 'Failed', closed: 'Closed'
    };
    const isChat = session.mode === 'chat';
    const isActive = session.status === 'running' || isStreaming;
    const canRevive = session.status === 'closed' || session.status === 'failed';
    // Match the session's environment so we can format the path correctly.
    const env = (environments || []).find(e => e.id === session.env);
    const isWindows = env && env.platform === 'windows';
    function displayPath(p) {
      if (!p) return p;
      if (!isWindows) return p;
      return p.replace(/^~\//, 'C:\\Users\\you\\').replace(/\//g, '\\');
    }
    return (
      <div style={{
        flexShrink: 0,
        padding: '0 28px',
        borderTop: `1px solid ${theme.border}`,
        background: theme.surface,
      }}>
        <div style={{
          maxWidth: 760, margin: '0 auto',
          display: 'flex', alignItems: 'center', gap: 12,
          fontSize: 11, padding: '6px 0',
        }}>
        {!isChat &&
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, color: theme.textDim,
          fontFamily: variant.mono, fontSize: 10.5,
          minWidth: 0
        }}>
              <window.Icons.Folder size={11} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayPath(session.cwd)}</span>
              {session.branch && (gitRepos || []).includes(session.cwd) &&
            <>
                <window.Icons.Branch size={11} style={{ marginLeft: 4 }} />
                <span style={{ whiteSpace: 'nowrap' }}>{session.branch}</span>
              </>
            }
          </span>
        }

        <div style={{ flex: 1 }} />

        <span style={{ color: theme.textMuted, fontFamily: variant.mono, fontSize: 10.5 }}>
          {session.tokens.toLocaleString()} tok · ${session.cost.toFixed(2)}
        </span>

        <span style={{ width: 1, height: 12, background: theme.border }} />

        {/* Status indicator — paired with the kill/revive button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <window.StatusDot status={session.status} theme={theme} />
          <span style={{
            color: theme.text,
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}>
            {variant.allMono ? `[${session.status}]` : labels[session.status]}
          </span>
        </div>

        {isActive &&
        <button
          onClick={onKill}
          title="Kill process — stops the session and any in-flight tools"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'transparent',
            border: `1px solid ${theme.status.failed}55`,
            color: theme.status.failed,
            padding: '2px 7px',
            borderRadius: variant.radiusSm,
            fontSize: 10.5, cursor: 'pointer',
            fontFamily: variant.allMono ? variant.mono : 'inherit',
            fontWeight: 500
          }}
          onMouseEnter={(e) => {e.currentTarget.style.background = `${theme.status.failed}15`;}}
          onMouseLeave={(e) => {e.currentTarget.style.background = 'transparent';}}>
            <window.Icons.X size={9} />
            {variant.allMono ? 'kill' : 'Kill'}
          </button>
        }

        {canRevive && !isActive &&
        <button
          onClick={onRevive}
          title="Revive process — reopen this session"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'transparent',
            border: `1px solid ${theme.accentLine}`,
            color: theme.accent,
            padding: '2px 7px',
            borderRadius: variant.radiusSm,
            fontSize: 10.5, cursor: 'pointer',
            fontFamily: variant.allMono ? variant.mono : 'inherit',
            fontWeight: 500
          }}
          onMouseEnter={(e) => {e.currentTarget.style.background = theme.accentSoft;}}
          onMouseLeave={(e) => {e.currentTarget.style.background = 'transparent';}}>
            <window.Icons.Refresh size={10} />
            {variant.allMono ? 'revive' : 'Revive'}
          </button>
        }
        </div>
      </div>);

  }

  function ChatScreen({ session, messages, theme, variant, tweaks, onSend, onStop, onSteer, isStreaming, onKill, onRevive, environments, gitRepos, onRename, onArchive, onDelete, onSwitchModel, onLoadOlder, hasOlder, loadingOlder }) {
    return (
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: theme.bg }}>
        <window.ChatLog
          messages={messages}
          theme={theme} variant={variant}
          bubble={tweaks.bubble}
          density={tweaks.density}
          sessionTitle={session.title}
          session={session}
          onRename={onRename}
          onArchive={onArchive}
          onDelete={onDelete}
          onLoadOlder={onLoadOlder}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder} />

        {/* Status bar — directly above input box */}
        <StatusBar session={session} theme={theme} variant={variant} isStreaming={isStreaming} onKill={onKill} onRevive={onRevive} environments={environments} gitRepos={gitRepos} />
        <window.InputBox
          onSend={onSend}
          onStop={onStop}
          onSteer={onSteer}
          onSwitchModel={onSwitchModel}
          isStreaming={isStreaming}
          theme={theme} variant={variant}
          session={session}
          environments={environments} />

      </main>);

  }

  // ChatPane: self-contained chat view for one session. Owns its own
  // transcript poll, optimistic-message buffer, streaming state, and the
  // per-session action handlers. This lets Harness render N panes
  // side-by-side without sharing state between them.
  function ChatPane({ session, theme, variant, tweaks, environments, gitRepos, actions, onAfterDelete, onClose, showClose }) {
    const [localMessages, setLocalMessages] = useState([]);
    const [streaming, setStreaming] = useState(false);
    const streamTimer = useRef(null);

    const transcript = window.useTranscript(session?.clientName ?? null, session?.sessionId ?? null);
    const baseMessages = (transcript.messages || []).map((m) => ({
      ...m,
      time: typeof m.time === 'number' ? m.time : Date.parse(m.ts) || Date.now(),
    }));

    // Drop optimistic local copies that already appear in the server
    // transcript (same role + trimmed text).
    const baseKeys = new Set(
      baseMessages
        .filter((m) => m && (m.kind === 'text' || m.kind === 'system'))
        .map((m) => `${m.role}|${(m.text || '').trim()}`),
    );
    const extras = localMessages.filter((m) => !baseKeys.has(`${m.role}|${(m.text || '').trim()}`));
    const messages = [...baseMessages, ...extras];

    // Garbage-collect once every optimistic copy has a counterpart.
    useEffect(() => {
      if (!localMessages.length) return;
      if (localMessages.every((m) => baseKeys.has(`${m.role}|${(m.text || '').trim()}`))) {
        setLocalMessages([]);
      }
    }, [baseMessages, localMessages]);

    useEffect(() => () => streamTimer.current && clearTimeout(streamTimer.current), []);

    function appendOptimistic(text, role = 'user') {
      setLocalMessages((prev) => [...prev, { role, time: Date.now(), kind: 'text', text }]);
    }

    function handleSend(text) {
      if (!session || !text) return;
      appendOptimistic(text, 'user');
      setStreaming(true);
      if (streamTimer.current) clearTimeout(streamTimer.current);
      streamTimer.current = setTimeout(() => setStreaming(false), 8000);
      Promise.resolve(actions?.onSend?.(session, text)).catch((err) => {
        console.error('send failed', err);
        appendOptimistic(`[send failed: ${err?.message || err}]`, 'assistant');
        setStreaming(false);
      });
    }
    function handleStop() {
      setStreaming(false);
      if (streamTimer.current) clearTimeout(streamTimer.current);
      Promise.resolve(actions?.onStop?.(session)).catch((err) => console.error('stop failed', err));
    }
    function handleSteer(text) {
      if (!text) return;
      appendOptimistic('↪ Steer: ' + text, 'user');
      Promise.resolve(actions?.onSteer?.(session, text)).catch((err) => console.error('steer failed', err));
    }
    function handleKill() { Promise.resolve(actions?.onKill?.(session)).catch((err) => console.error('kill failed', err)); }
    function handleRevive() { Promise.resolve(actions?.onRevive?.(session)).catch((err) => console.error('revive failed', err)); }
    function handleRename(name) { if (name) Promise.resolve(actions?.onRenameSession?.(session, name)).catch((err) => console.error('rename failed', err)); }
    function handleArchive() { Promise.resolve(actions?.onArchiveSession?.(session)).catch((err) => console.error('archive failed', err)); }
    function handleDelete() {
      const sid = session.id;
      Promise.resolve(actions?.onDeleteSession?.(session))
        .then(() => { onAfterDelete && onAfterDelete(sid); })
        .catch((err) => console.error('delete failed', err));
    }
    function handleSwitchModel(provider, model, effort) {
      // Return the promise so callers (InputBox.fire → maybeSwitchFirst)
      // can `await` the switch and only send the message once the runner
      // has been respawned with the new config.
      return Promise.resolve(actions?.onSwitchModel?.(session, provider, model, effort))
        .catch((err) => { console.error('switch failed', err); });
    }

    return (
      <ChatScreen
        session={session}
        messages={messages}
        theme={theme} variant={variant}
        tweaks={tweaks}
        onSend={handleSend}
        onStop={handleStop}
        onSteer={handleSteer}
        onKill={handleKill}
        onRevive={handleRevive}
        onRename={handleRename}
        onArchive={handleArchive}
        onDelete={handleDelete}
        onSwitchModel={handleSwitchModel}
        onLoadOlder={transcript.loadMore}
        hasOlder={!!transcript.hasMore}
        loadingOlder={!!transcript.loading}
        isStreaming={streaming}
        environments={environments}
        gitRepos={gitRepos}
        onClose={showClose ? onClose : null} />
    );
  }

  // URL helpers. Routes:
  //   /                 → launcher
  //   /settings         → settings screen
  //   /s/<id>(,<id>)*   → one or more open session panes
  // Session ids contain ":" (clientName:sessionId), so each id is
  // urlencoded individually.
  function parseLocation() {
    const p = (typeof window !== 'undefined' && window.location?.pathname) || '/';
    if (p === '/settings' || p === '/settings/') return { screen: 'settings', openIds: [] };
    const m = p.match(/^\/s\/([^/]+)\/?$/);
    if (m) {
      const ids = m[1].split(',').map(decodeURIComponent).filter(Boolean);
      return { screen: ids.length ? 'chat' : 'launcher', openIds: ids };
    }
    return { screen: 'launcher', openIds: [] };
  }
  function locationFor(screen, openIds) {
    if (screen === 'settings') return '/settings';
    if (screen === 'chat' && openIds && openIds.length) {
      return '/s/' + openIds.map(encodeURIComponent).join(',');
    }
    return '/';
  }

  function Harness({ tweaks, setTweak, data, actions }) {
    const variantName = tweaks.variant || 'Eclipse';
    const variant = window.HARNESS_THEMES[variantName] || window.HARNESS_THEMES.Eclipse;
    const theme = tweaks.dark ? variant.dark : variant.light;

    // Initial state from URL — falls back to launcher.
    const initial = useMemo(() => parseLocation(), []);
    const [openIds, setOpenIds] = useState(initial.openIds);
    const [screen, setScreen] = useState(initial.screen);

    // Derived: which session objects (from data) match our open ids, in order.
    const openSessions = openIds
      .map((id) => data.sessions.find((s) => s.id === id))
      .filter(Boolean);

    // Reflect state changes back into the URL (without spamming history).
    useEffect(() => {
      const want = locationFor(screen, openIds);
      if (typeof window !== 'undefined' && window.location.pathname !== want) {
        window.history.replaceState({ screen, openIds }, '', want);
      }
    }, [screen, openIds]);

    // Honor browser back/forward.
    useEffect(() => {
      function onPop() {
        const next = parseLocation();
        setOpenIds(next.openIds);
        setScreen(next.screen);
      }
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }, []);

    // Sidebar click: plain click selects one; ctrl/meta+click toggles.
    function selectSession(id, event) {
      const toggle = event && (event.ctrlKey || event.metaKey);
      setScreen('chat');
      setOpenIds((prev) => {
        if (toggle) {
          if (prev.includes(id)) {
            const next = prev.filter((x) => x !== id);
            return next;
          }
          return [...prev, id];
        }
        return [id];
      });
    }

    function closePane(id) {
      setOpenIds((prev) => prev.filter((x) => x !== id));
    }

    function afterDelete(sid) {
      setOpenIds((prev) => prev.filter((x) => x !== sid));
    }

    function handleNewSession() { setScreen('launcher'); }
    function handleHome() { setScreen('launcher'); }
    function handleCreateSession(opts) {
      if (opts && opts.continueId) {
        setOpenIds([opts.continueId]);
        setScreen('chat');
        return;
      }
      if (!actions?.onCreateSession) {
        setScreen('chat');
        return;
      }
      Promise.resolve(actions.onCreateSession(opts))
        .then((result) => {
          if (result && result.sessionId && result.clientName) {
            const id = `${result.clientName}:${result.sessionId}`;
            setOpenIds([id]);
          }
          setScreen('chat');
        })
        .catch((err) => {
          console.error('create session failed', err);
          alert(`Could not create session: ${err?.message || err}`);
        });
    }

    function handleBindSession({ env, cwd, sessionId }) {
      if (!actions?.onBindSession) {
        setScreen('chat');
        return;
      }
      Promise.resolve(actions.onBindSession({ env, cwd, sessionId }))
        .then((result) => {
          if (result && result.sessionId && result.clientName) {
            const id = `${result.clientName}:${result.sessionId}`;
            setOpenIds([id]);
          }
          setScreen('chat');
        })
        .catch((err) => {
          console.error('bind session failed', err);
          alert(`Could not bind session: ${err?.message || err}`);
        });
    }

    // Listen for the launcher's "open settings" intent
    useEffect(() => {
      if (tweaks.__openSettings) setScreen('settings');
    }, [tweaks.__openSettings]);

    // Global keyboard shortcuts. Mod = Cmd on Mac, Ctrl elsewhere.
    useEffect(() => {
      function onKey(e) {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const target = e.target;
        const inEditable = target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        );
        if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          setTweak('sidebar', !tweaks.sidebar);
        } else if (e.key === ',') {
          e.preventDefault();
          setScreen('settings');
        } else if ((e.key === 'k' || e.key === 'K') && !inEditable) {
          e.preventDefault();
          const input = document.querySelector('aside input[placeholder*="earch sessions"], aside input[placeholder*="grep sessions"]');
          if (input) input.focus();
        } else if ((e.key === 'n' || e.key === 'N') && !inEditable) {
          e.preventDefault();
          setScreen('launcher');
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [tweaks.sidebar, setTweak]);

    const sidebarWidth = tweaks.sidebar ? tweaks.density === 'compact' ? 250 : 270 : 0;
    const breadcrumb = screen === 'settings' ? 'Settings' : null;
    const showTopBar = true;

    // Effective screen: if user explicitly opened settings, show it; else if
    // Honor the explicitly-requested screen (launcher / settings / chat).
    // The only auto-fallback is chat → launcher when there are no open
    // panes to show — clicking "New session" with sessions still open
    // should still take you back to the launcher.
    const effectiveScreen =
      screen === 'settings' ? 'settings'
      : screen === 'launcher' ? 'launcher'
      : openSessions.length === 0 ? 'launcher'
      : 'chat';

    return (
      <div style={{
        width: '100%', height: '100%',
        background: theme.bg, color: theme.text,
        display: 'flex', flexDirection: 'column',
        fontFamily: variant.font,
        letterSpacing: variant.letterSpacing,
        overflow: 'hidden'
      }}>
        {showTopBar &&
        <TopBar
          theme={theme} variant={variant}
          tweaks={tweaks} setTweak={setTweak}
          onToggleSidebar={() => setTweak('sidebar', !tweaks.sidebar)}
          sidebarVisible={tweaks.sidebar}
          onHome={handleHome}
          onSettings={() => setScreen('settings')}
          screen={effectiveScreen}
          breadcrumb={breadcrumb} />
        }
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {tweaks.sidebar &&
          <window.Sidebar
            sessions={data.sessions}
            activeId={effectiveScreen === 'chat' ? openIds : null}
            onSelect={selectSession}
            theme={theme} variant={variant}
            density={tweaks.density}
            width={sidebarWidth}
            onNewSession={handleNewSession}
            onRenameSession={(s, name) => actions?.onRenameSession?.(s, name)}
            onArchiveSession={(s) => actions?.onArchiveSession?.(s)}
            onDeleteSession={(s) => {
              const result = actions?.onDeleteSession?.(s);
              if (result && result.then) {
                result.catch((err) => console.error('delete failed', err));
              }
              if (s) afterDelete(s.id);
            }} />
          }
          {effectiveScreen === 'chat' && openSessions.length > 0 &&
            <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
              {openSessions.map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                    borderLeft: i > 0 ? `1px solid ${theme.border}` : 'none',
                  }}
                >
                  <ChatPane
                    session={s}
                    theme={theme} variant={variant}
                    tweaks={tweaks}
                    environments={data.environments}
                    gitRepos={data.gitRepos}
                    actions={actions}
                    onAfterDelete={afterDelete}
                    onClose={() => closePane(s.id)}
                    showClose={openSessions.length > 1} />
                </div>
              ))}
            </div>
          }
          {effectiveScreen === 'launcher' &&
          <window.LauncherView
            data={data}
            theme={theme} variant={variant}
            tweaks={tweaks} setTweak={setTweak}
            onCreate={handleCreateSession}
            onListSessions={actions?.onListSessions}
            onBind={handleBindSession}
            onCancel={() => setScreen('chat')}
            hasActiveSession={openSessions.length > 0} />
          }
          {effectiveScreen === 'settings' &&
          <window.SettingsView
            theme={theme} variant={variant}
            tweaks={tweaks} setTweak={setTweak}
            data={data}
            actions={actions}
            onBack={() => setScreen(openSessions.length > 0 ? 'chat' : 'launcher')} />
          }
        </div>
      </div>);
  }

  window.Harness = Harness;
})();