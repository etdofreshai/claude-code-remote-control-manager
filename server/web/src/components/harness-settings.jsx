// Settings screen — sub-nav on the left, content on the right.
// Sections: Providers (with API key fields per provider), Appearance,
// Tools, Keyboard shortcuts, MCP servers, About.

(function () {
  const { useState } = React;

  function NavItem({ active, onClick, theme, variant, icon, label, count }) {
    return (
      <button
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: active ? theme.accentSoft : 'transparent',
          border: 'none', borderRadius: variant.radiusSm,
          padding: '6px 10px', margin: '1px 0',
          color: active ? theme.text : theme.textDim,
          fontSize: 12.5, fontWeight: active ? 500 : 400,
          textAlign: 'left', cursor: 'pointer',
          letterSpacing: variant.letterSpacing,
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          borderLeft: active && !variant.allMono ? `2px solid ${theme.accent}` : '2px solid transparent',
          marginLeft: -2,
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = theme.surfaceHover; e.currentTarget.style.color = theme.text; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textDim; } }}
      >
        {icon}
        <span style={{ flex: 1 }}>{label}</span>
        {count != null && <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>{count}</span>}
      </button>
    );
  }

  function SectionHeader({ title, subtitle, theme, variant }) {
    return (
      <div style={{ marginBottom: 18 }}>
        <h2 style={{
          margin: 0, fontSize: 18, fontWeight: 600, color: theme.text,
          letterSpacing: variant.titleSpacing,
          fontFamily: variant.allMono ? variant.mono : 'inherit',
        }}>
          {variant.allMono ? '# ' : ''}{title}
        </h2>
        {subtitle && (
          <p style={{
            margin: '4px 0 0', fontSize: 12, color: theme.textDim,
            letterSpacing: variant.letterSpacing,
          }}>{subtitle}</p>
        )}
      </div>
    );
  }

  function SettingRow({ label, hint, children, theme, variant, full }) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: full ? '1fr' : '180px 1fr',
        gap: full ? 8 : 16, alignItems: 'start',
        padding: '14px 0',
        borderBottom: `1px solid ${theme.border}`,
      }}>
        <div>
          <div style={{
            fontSize: 12.5, color: theme.text, fontWeight: 500,
            letterSpacing: variant.letterSpacing,
            fontFamily: variant.allMono ? variant.mono : 'inherit',
          }}>{label}</div>
          {hint && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 3, letterSpacing: variant.letterSpacing }}>{hint}</div>}
        </div>
        <div>{children}</div>
      </div>
    );
  }

  function MonoInput({ value, onChange, placeholder, theme, variant, secret }) {
    return (
      <input
        type={secret ? 'password' : 'text'}
        value={value || ''}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: theme.surface2,
          border: `1px solid ${theme.border}`,
          borderRadius: variant.radiusSm,
          color: theme.text,
          padding: '7px 10px',
          fontSize: 12.5,
          fontFamily: variant.mono,
          outline: 'none',
        }}
        onFocus={(e) => e.currentTarget.style.borderColor = theme.accentLine}
        onBlur={(e) => e.currentTarget.style.borderColor = theme.border}
      />
    );
  }

  function ToggleSwitch({ value, onChange, theme }) {
    return (
      <button
        onClick={() => onChange && onChange(!value)}
        style={{
          position: 'relative',
          width: 30, height: 17,
          borderRadius: 9, padding: 0,
          background: value ? theme.accent : theme.surface2,
          border: `1px solid ${value ? theme.accent : theme.borderStrong}`,
          cursor: 'pointer',
          transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 1, left: value ? 14 : 1,
          width: 13, height: 13, borderRadius: '50%',
          background: value ? '#fff' : theme.text,
          transition: 'left .15s',
        }} />
      </button>
    );
  }
  window.ToggleSwitch = ToggleSwitch;

  function StatusPill({ kind, theme, variant, children }) {
    const colors = {
      ok: { fg: theme.status.completed, bg: 'rgba(74,222,128,0.10)' },
      warn: { fg: theme.status.awaiting, bg: 'rgba(240,184,74,0.10)' },
      none: { fg: theme.textMuted, bg: theme.surface2 },
    };
    const c = colors[kind] || colors.none;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 7px', borderRadius: 99,
        background: c.bg, color: c.fg,
        fontSize: 10.5, fontWeight: 500,
        fontFamily: variant.mono,
        border: `1px solid ${c.fg}33`,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.fg }} />
        {children}
      </span>
    );
  }

  // ─────────── Sections ───────────

  function ProvidersSection({ theme, variant }) {
    const [provs, setProvs] = useState([
      { id: 'claude', label: 'Anthropic', enabled: true,
        models: [
          { name: 'haiku', on: true, hint: 'Fast' },
          { name: 'sonnet', on: true, hint: 'Balanced' },
          { name: 'opus', on: true, hint: 'Max' },
        ], custom: [] },
      { id: 'codex', label: 'OpenAI', enabled: true,
        models: [
          { name: 'gpt-5.5', on: true, hint: 'General' },
        ], custom: [] },
      { id: 'gemini', label: 'Google', enabled: false,
        models: [
          { name: 'pro-3-1-preview', on: true, hint: 'Long ctx' },
        ], custom: [] },
    ]);
    const [addingFor, setAddingFor] = useState(null);
    const [draft, setDraft] = useState('');

    function setProvEnabled(id, on) {
      setProvs(provs.map(p => p.id === id ? { ...p, enabled: on } : p));
    }
    function setModelOn(pId, name, on) {
      setProvs(provs.map(p => p.id === pId ? {
        ...p,
        models: p.models.map(m => m.name === name ? { ...m, on } : m),
        custom: p.custom.map(m => m.name === name ? { ...m, on } : m),
      } : p));
    }
    function addCustom(pId) {
      if (!draft.trim()) { setAddingFor(null); return; }
      setProvs(provs.map(p => p.id === pId ? {
        ...p,
        custom: [...p.custom, { name: draft.trim(), on: true, custom: true }],
      } : p));
      setDraft('');
      setAddingFor(null);
    }
    function removeCustom(pId, name) {
      setProvs(provs.map(p => p.id === pId ? {
        ...p, custom: p.custom.filter(m => m.name !== name),
      } : p));
    }

    function ModelRow({ pId, m, isCustom }) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 10px 7px 12px',
          borderTop: `1px solid ${theme.border}`,
        }}>
          <window.Icons.Dot size={5} color={m.on ? theme.accent : theme.textMuted} />
          <span style={{
            fontSize: 12.5, color: theme.text,
            fontFamily: variant.mono, letterSpacing: 0,
          }}>
            {m.name}
          </span>
          {isCustom && (
            <span style={{
              fontSize: 9.5, color: theme.textMuted, fontFamily: variant.mono,
              padding: '1px 5px', border: `1px solid ${theme.border}`, borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>custom</span>
          )}
          {m.hint && !isCustom && (
            <span style={{ fontSize: 10.5, color: theme.textMuted, fontFamily: variant.mono }}>
              {m.hint}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {isCustom && (
            <button
              onClick={() => removeCustom(pId, m.name)}
              title="Remove custom model"
              style={{
                background: 'transparent', border: 'none',
                color: theme.textMuted, cursor: 'pointer',
                padding: 3, borderRadius: 3,
                display: 'inline-flex',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = theme.status.failed}
              onMouseLeave={(e) => e.currentTarget.style.color = theme.textMuted}
            >
              <window.Icons.X size={11} />
            </button>
          )}
          <ToggleSwitch value={m.on} onChange={(v) => setModelOn(pId, m.name, v)} theme={theme} />
        </div>
      );
    }

    return (
      <>
        <SectionHeader
          title="Providers"
          subtitle="Toggle which providers are available, and which models show up in the picker."
          theme={theme} variant={variant}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {provs.map(p => {
            const allModels = [...p.models, ...p.custom];
            return (
              <div key={p.id} style={{
                border: `1px solid ${theme.border}`,
                borderRadius: variant.radius,
                background: theme.surface,
                opacity: p.enabled ? 1 : 0.6,
                transition: 'opacity .15s',
                overflow: 'hidden',
              }}>
                {/* Provider header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                }}>
                  <window.ProviderIcon provider={p.id} size={26} theme={theme} variant={variant} square />
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 13.5, fontWeight: 600, color: theme.text,
                      letterSpacing: variant.letterSpacing,
                      fontFamily: variant.allMono ? variant.mono : 'inherit',
                    }}>{p.label}</div>
                    <div style={{ fontSize: 10.5, color: theme.textMuted, fontFamily: variant.mono, marginTop: 2 }}>
                      {allModels.filter(m => m.on).length}/{allModels.length} models enabled
                    </div>
                  </div>
                  <ToggleSwitch value={p.enabled} onChange={(v) => setProvEnabled(p.id, v)} theme={theme} />
                </div>

                {/* Models list — only shown when provider is enabled */}
                {p.enabled && (
                  <div>
                    {p.models.map(m => <ModelRow key={m.name} pId={p.id} m={m} />)}
                    {p.custom.map(m => <ModelRow key={m.name} pId={p.id} m={m} isCustom />)}

                    {/* Add custom model */}
                    <div style={{
                      borderTop: `1px solid ${theme.border}`,
                      padding: '8px 10px',
                    }}>
                      {addingFor === p.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addCustom(p.id);
                              if (e.key === 'Escape') { setAddingFor(null); setDraft(''); }
                            }}
                            autoFocus
                            placeholder={`e.g. ${p.id}-3.5-preview`}
                            style={{
                              flex: 1,
                              background: theme.surface2,
                              border: `1px solid ${theme.accentLine}`,
                              borderRadius: variant.radiusSm,
                              color: theme.text, padding: '5px 8px',
                              fontSize: 12, fontFamily: variant.mono, outline: 'none',
                            }}
                          />
                          <button onClick={() => addCustom(p.id)} style={{
                            background: theme.accent, color: theme.accentText,
                            border: `1px solid ${theme.accent}`,
                            padding: '5px 10px', borderRadius: variant.radiusSm,
                            fontSize: 11.5, cursor: 'pointer',
                            fontFamily: variant.allMono ? variant.mono : 'inherit',
                          }}>Add</button>
                          <button onClick={() => { setAddingFor(null); setDraft(''); }} style={{
                            background: 'transparent', color: theme.textDim,
                            border: `1px solid ${theme.border}`,
                            padding: '5px 9px', borderRadius: variant.radiusSm,
                            fontSize: 11.5, cursor: 'pointer',
                            fontFamily: variant.allMono ? variant.mono : 'inherit',
                          }}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingFor(p.id)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: 'transparent', border: 'none',
                            color: theme.textDim, padding: '3px 4px',
                            fontSize: 11.5, cursor: 'pointer',
                            fontFamily: variant.allMono ? variant.mono : 'inherit',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = theme.accent}
                          onMouseLeave={(e) => e.currentTarget.style.color = theme.textDim}
                        >
                          <window.Icons.Plus size={11} />
                          {variant.allMono ? 'add custom model' : 'Add custom model'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function AppearanceSection({ theme, variant, tweaks, setTweak }) {
    return (
      <>
        <SectionHeader title="Appearance" subtitle="How Harness looks across the entire app." theme={theme} variant={variant} />
        <SettingRow label="Theme" hint="Use dark or light surfaces." theme={theme} variant={variant}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['light', 'dark'].map(m => {
              const isDark = m === 'dark';
              const active = tweaks.dark === isDark;
              return (
                <button key={m} onClick={() => setTweak('dark', isDark)} style={{
                  background: active ? theme.accentSoft : theme.surface2,
                  border: `1px solid ${active ? theme.accentLine : theme.border}`,
                  borderRadius: variant.radiusSm,
                  color: theme.text, padding: '6px 12px',
                  fontSize: 12, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                  textTransform: 'capitalize',
                }}>
                  {isDark ? <window.Icons.Moon size={11} /> : <window.Icons.Sun size={11} />}
                  {m}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow label="Visual variant" hint="Try a different aesthetic — same product, three personalities." theme={theme} variant={variant}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Eclipse', 'Ember', 'Console'].map(v => {
              const active = tweaks.variant === v;
              return (
                <button key={v} onClick={() => setTweak('variant', v)} style={{
                  background: active ? theme.accentSoft : theme.surface2,
                  border: `1px solid ${active ? theme.accentLine : theme.border}`,
                  borderRadius: variant.radiusSm,
                  color: theme.text, padding: '6px 12px',
                  fontSize: 12, cursor: 'pointer',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                }}>
                  {v}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow label="Density" hint="Affects spacing in sessions and chat." theme={theme} variant={variant}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['compact', 'comfy'].map(d => {
              const active = tweaks.density === d;
              return (
                <button key={d} onClick={() => setTweak('density', d)} style={{
                  background: active ? theme.accentSoft : theme.surface2,
                  border: `1px solid ${active ? theme.accentLine : theme.border}`,
                  borderRadius: variant.radiusSm,
                  color: theme.text, padding: '6px 12px',
                  fontSize: 12, cursor: 'pointer',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                  textTransform: 'capitalize',
                }}>
                  {d}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow label="Message layout" hint="Chat-bubble or flat document." theme={theme} variant={variant}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{id: false, label: 'Flat'}, {id: true, label: 'Bubble'}].map(o => {
              const active = tweaks.bubble === o.id;
              return (
                <button key={o.label} onClick={() => setTweak('bubble', o.id)} style={{
                  background: active ? theme.accentSoft : theme.surface2,
                  border: `1px solid ${active ? theme.accentLine : theme.border}`,
                  borderRadius: variant.radiusSm,
                  color: theme.text, padding: '6px 12px',
                  fontSize: 12, cursor: 'pointer',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow label="Sidebar" hint="Show the sessions sidebar by default." theme={theme} variant={variant}>
          <ToggleSwitch value={tweaks.sidebar} onChange={(v) => setTweak('sidebar', v)} theme={theme} />
        </SettingRow>
      </>
    );
  }

  function ToolsSection({ theme, variant }) {
    const [tools, setTools] = useState([
      { id: 'fs', label: 'Filesystem', desc: 'Read, write, edit files in the working directory.', on: true, kbd: 'r/w' },
      { id: 'shell', label: 'Shell', desc: 'Run arbitrary commands in a subprocess.', on: true, kbd: 'exec' },
      { id: 'web', label: 'Web fetch', desc: 'Fetch URLs and follow links.', on: false, kbd: 'http' },
      { id: 'search', label: 'Web search', desc: 'Search the public web.', on: false, kbd: 'search' },
      { id: 'screenshot', label: 'Screenshot', desc: 'Capture browser screenshots via Playwright.', on: true, kbd: 'visual' },
      { id: 'tests', label: 'Test runner', desc: 'Run project test suites and capture output.', on: true, kbd: 'jest' },
    ]);
    function toggle(id) {
      setTools(tools.map(t => t.id === id ? { ...t, on: !t.on } : t));
    }
    return (
      <>
        <SectionHeader title="Tools" subtitle="Capabilities available to every new session by default." theme={theme} variant={variant} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tools.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 0',
              borderBottom: `1px solid ${theme.border}`,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: variant.radiusSm,
                background: t.on ? theme.accentSoft : theme.surface2,
                border: `1px solid ${t.on ? theme.accentLine : theme.border}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: t.on ? theme.accent : theme.textMuted,
                flexShrink: 0,
              }}>
                <window.Icons.Wrench size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, color: theme.text, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 6,
                  letterSpacing: variant.letterSpacing,
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                }}>
                  {t.label}
                  <span style={{
                    fontSize: 10, color: theme.textMuted, fontFamily: variant.mono,
                    padding: '0 4px', border: `1px solid ${theme.border}`, borderRadius: 3,
                  }}>{t.kbd}</span>
                </div>
                <div style={{ fontSize: 11.5, color: theme.textDim, marginTop: 2, letterSpacing: variant.letterSpacing }}>
                  {t.desc}
                </div>
              </div>
              <ToggleSwitch value={t.on} onChange={() => toggle(t.id)} theme={theme} />
            </div>
          ))}
        </div>
      </>
    );
  }

  function KeyboardSection({ theme, variant }) {
    const shortcuts = [
      ['Navigate', [
        ['⌘K', 'Quick switcher / search'],
        ['⌘N', 'New session'],
        ['⌘⇧N', 'Fork current session'],
        ['⌘,', 'Open settings'],
        ['⌘B', 'Toggle sidebar'],
      ]],
      ['Session', [
        ['⏎', 'Send message'],
        ['⇧⏎', 'New line'],
        ['Esc', 'Stop current response'],
        ['⌘L', 'Clear context'],
        ['/', 'Open slash commands'],
      ]],
      ['Editing', [
        ['⌘⇧K', 'Kill process'],
        ['⌘⇧R', 'Re-run last tool'],
        ['⌘E', 'Edit last message'],
      ]],
    ];
    return (
      <>
        <SectionHeader title="Keyboard shortcuts" theme={theme} variant={variant} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {shortcuts.map(([group, items]) => (
            <div key={group}>
              <div style={{
                fontSize: 10.5, color: theme.textDim, marginBottom: 8,
                textTransform: variant.allMono ? 'none' : 'uppercase',
                letterSpacing: variant.allMono ? 0 : '0.06em',
                fontFamily: variant.allMono ? variant.mono : 'inherit',
                fontWeight: 600,
              }}>{group}</div>
              <div style={{
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: variant.radiusSm,
                overflow: 'hidden',
              }}>
                {items.map(([kbd, label], i) => (
                  <div key={kbd} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderTop: i === 0 ? 'none' : `1px solid ${theme.border}`,
                    fontSize: 12,
                  }}>
                    <span style={{ color: theme.text, letterSpacing: variant.letterSpacing }}>{label}</span>
                    <kbd style={{
                      fontFamily: variant.mono, fontSize: 11, color: theme.textDim,
                      padding: '2px 6px', background: theme.surface2,
                      border: `1px solid ${theme.border}`, borderRadius: 3,
                    }}>{kbd}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function MCPSection({ theme, variant }) {
    const [servers, setServers] = useState([
      { id: 'filesystem', name: 'filesystem', cmd: 'npx @modelcontextprotocol/server-filesystem', status: 'ok', tools: 4 },
      { id: 'github', name: 'github', cmd: 'npx @modelcontextprotocol/server-github', status: 'ok', tools: 12 },
      { id: 'postgres', name: 'postgres', cmd: 'npx @modelcontextprotocol/server-postgres', status: 'fail', tools: 0, error: 'Connection refused on :5432' },
    ]);
    return (
      <>
        <SectionHeader
          title="MCP servers"
          subtitle="Model Context Protocol servers add tools to every session."
          theme={theme} variant={variant}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {servers.map(s => (
            <div key={s.id} style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: variant.radius,
              padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <window.StatusDot status={s.status === 'ok' ? 'running' : 'failed'} theme={theme} size={7} />
                <span style={{
                  fontSize: 13, color: theme.text, fontWeight: 500,
                  fontFamily: variant.mono, letterSpacing: 0,
                }}>{s.name}</span>
                <span style={{
                  fontSize: 10.5, color: theme.textMuted, fontFamily: variant.mono,
                }}>
                  {s.tools} tools
                </span>
                <div style={{ flex: 1 }} />
                <ToggleSwitch value={s.status === 'ok'} onChange={() => {}} theme={theme} />
              </div>
              <div style={{
                fontSize: 11.5, color: theme.textDim, fontFamily: variant.mono,
                background: theme.surface2, padding: '6px 10px',
                borderRadius: variant.radiusSm, border: `1px solid ${theme.border}`,
              }}>
                <span style={{ color: theme.textMuted }}>$ </span>{s.cmd}
              </div>
              {s.error && (
                <div style={{ fontSize: 11, color: theme.status.failed, marginTop: 6, fontFamily: variant.mono }}>
                  ⚠ {s.error}
                </div>
              )}
            </div>
          ))}
          <button style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'transparent', border: `1px dashed ${theme.borderStrong}`,
            color: theme.textDim, padding: '10px',
            borderRadius: variant.radius, fontSize: 12, cursor: 'pointer',
            fontFamily: variant.allMono ? variant.mono : 'inherit',
          }}>
            <window.Icons.Plus size={12} />
            Add MCP server
          </button>
        </div>
      </>
    );
  }

  function AboutSection({ theme, variant }) {
    return (
      <>
        <SectionHeader title="About" theme={theme} variant={variant} />
        <div style={{
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: variant.radius,
          padding: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{
              width: 36, height: 36, borderRadius: variant.allMono ? 0 : 8,
              background: theme.accent, color: theme.accentText,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, fontFamily: variant.mono,
            }}>{variant.allMono ? '$' : 'H'}</span>
            <div>
              <div style={{
                fontSize: 16, fontWeight: 600, color: theme.text,
                letterSpacing: variant.titleSpacing,
                fontFamily: variant.allMono ? variant.mono : 'inherit',
              }}>Harness</div>
              <div style={{ fontSize: 11.5, color: theme.textMuted, fontFamily: variant.mono }}>
                v0.1.0 · build 2026.05.13
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: theme.textDim, lineHeight: 1.6, letterSpacing: variant.letterSpacing }}>
            A multi-provider AI session orchestrator. One interface, every model, every working directory.
          </div>
        </div>
      </>
    );
  }

  function EnvironmentsSection({ theme, variant, data }) {
    const envs = data.environments || [];
    function fmtAgo(ts) {
      const m = Math.floor((Date.now() - ts) / 60000);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    }
    function envState(e) {
      if (!e.connected) return 'disconnected';
      return e.enabled ? 'enabled' : 'disabled';
    }
    function stateColor(s, theme) {
      if (s === 'enabled') return theme.status.completed;
      if (s === 'disabled') return theme.textMuted;
      return theme.status.failed; // disconnected
    }
    return (
      <>
        <SectionHeader
          title="Environments"
          subtitle="Hosts running the Harness client connect here and register themselves. New sessions can run in any enabled, connected environment."
          theme={theme} variant={variant}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {envs.length === 0 && (
            <div style={{
              border: `1px dashed ${theme.borderStrong}`,
              borderRadius: variant.radius,
              padding: '20px 16px',
              textAlign: 'center',
              color: theme.textDim, fontSize: 12.5,
              letterSpacing: variant.letterSpacing,
            }}>
              No environments connected yet.
              <div style={{ marginTop: 6, fontSize: 11.5, color: theme.textMuted }}>
                Run <code style={{ fontFamily: variant.mono, color: theme.text }}>harness connect</code> on any host to register it here.
              </div>
            </div>
          )}
          {envs.map(e => {
            const state = envState(e);
            const color = stateColor(state, theme);
            const isDisconnected = state === 'disconnected';
            return (
              <div key={e.id} style={{
                border: `1px solid ${theme.border}`,
                borderRadius: variant.radius,
                background: theme.surface,
                padding: '12px 14px',
                opacity: isDisconnected ? 0.78 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: color, flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 13, color: theme.text, fontWeight: 500,
                    fontFamily: variant.mono, letterSpacing: 0,
                  }}>{e.name}</span>
                  {e.default && (
                    <span style={{
                      fontSize: 9.5, color: theme.textMuted, fontFamily: variant.mono,
                      padding: '1px 5px', border: `1px solid ${theme.border}`, borderRadius: 3,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>default</span>
                  )}
                  <span style={{
                    fontSize: 10, color, fontFamily: variant.mono,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '1px 6px', border: `1px solid ${color}55`, borderRadius: 3,
                    background: `${color}10`,
                  }}>
                    {state}
                  </span>
                  <span style={{ fontSize: 10.5, color: theme.textMuted, fontFamily: variant.mono }}>
                    {e.connected ? `connected · ${fmtAgo(e.connectedAt)}` : `last seen ${fmtAgo(e.connectedAt)}`}
                  </span>
                  <div style={{ flex: 1 }} />
                  {isDisconnected ? (
                    <button style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'transparent', border: `1px solid ${theme.border}`,
                      color: theme.textDim, padding: '3px 9px',
                      borderRadius: variant.radiusSm, fontSize: 10.5, cursor: 'pointer',
                      fontFamily: variant.allMono ? variant.mono : 'inherit',
                    }}>
                      <window.Icons.X size={9} /> Remove
                    </button>
                  ) : (
                    <ToggleSwitch value={e.enabled} onChange={() => {}} theme={theme} />
                  )}
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 8, fontFamily: variant.mono, fontSize: 10.5,
                  paddingTop: 8, borderTop: `1px solid ${theme.border}`,
                }}>
                  <Cell label="Host" value={e.host} theme={theme} />
                  <Cell label="OS" value={e.os} theme={theme} />
                  <Cell label="CPU" value={e.cpu} theme={theme} />
                  <Cell label="Memory" value={e.mem} theme={theme} />
                </div>
              </div>
            );
          })}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: theme.surface2,
            border: `1px solid ${theme.border}`,
            borderRadius: variant.radius,
            padding: '12px 14px',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: variant.radiusSm,
              background: theme.surface, color: theme.accent,
              border: `1px solid ${theme.accentLine}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <window.Icons.Server size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, color: theme.text, fontWeight: 500,
                letterSpacing: variant.letterSpacing,
                fontFamily: variant.allMono ? variant.mono : 'inherit',
              }}>Connect a new host</div>
              <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 1 }}>
                Run this on the host you want to register:
              </div>
            </div>
          </div>
          <pre style={{
            margin: 0,
            background: theme.surface2,
            border: `1px solid ${theme.border}`,
            borderRadius: variant.radiusSm,
            padding: '10px 12px',
            fontFamily: variant.mono, fontSize: 11.5,
            color: theme.text, overflowX: 'auto',
          }}>
            <span style={{ color: theme.textMuted }}>$ </span>
            curl -fsSL https://harness.dev/install | sh && harness connect --server https://your.harness.app --token &lt;your-token&gt;
          </pre>

          {/* Access tokens for inbound client connections */}
          <ApiTokens theme={theme} variant={variant} />
        </div>
      </>
    );
  }

  function ApiTokens({ theme, variant }) {
    const [tokens, setTokens] = useState([
      { id: 't1', name: 'staging-vm', masked: 'hrn_•••••••••••••••YQ4z', created: '2026-04-12', lastUsed: '14m ago' },
      { id: 't2', name: 'mac-mini',   masked: 'hrn_•••••••••••••••K8nP', created: '2026-03-30', lastUsed: '3d ago' },
      { id: 't3', name: 'laptop',     masked: 'hrn_•••••••••••••••f29B', created: '2026-05-01', lastUsed: 'never' },
    ]);
    const [creating, setCreating] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [newToken, setNewToken] = useState(null); // {name, value} after creation
    const [copied, setCopied] = useState(false);

    function genToken() {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      let s = 'hrn_';
      for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    }
    function create() {
      const name = draftName.trim();
      if (!name) return;
      const value = genToken();
      setNewToken({ name, value });
      setTokens([...tokens, {
        id: 't' + Date.now(),
        name, masked: 'hrn_•••••••••••••••' + value.slice(-4),
        created: new Date().toISOString().slice(0, 10),
        lastUsed: 'never',
      }]);
      setDraftName('');
      setCreating(false);
    }
    function copyNew() {
      try { navigator.clipboard && navigator.clipboard.writeText(newToken.value); } catch {}
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    function revoke(id) {
      setTokens(tokens.filter(t => t.id !== id));
    }

    return (
      <div style={{ marginTop: 22 }}>
        <div style={{
          fontSize: 10.5, color: theme.textDim, fontWeight: 600,
          textTransform: variant.allMono ? 'none' : 'uppercase',
          letterSpacing: variant.allMono ? 0 : '0.06em',
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          marginBottom: 6,
        }}>
          {variant.allMono ? '# access tokens' : 'Access tokens'}
        </div>
        <div style={{ fontSize: 11.5, color: theme.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
          Clients pass <code style={{ fontFamily: variant.mono, color: theme.textDim }}>--token</code> when running <code style={{ fontFamily: variant.mono, color: theme.textDim }}>harness connect</code>. Tokens are shown once at creation — store them somewhere safe.
        </div>

        {/* Just-created token reveal */}
        {newToken && (
          <div style={{
            border: `1px solid ${theme.accentLine}`,
            background: theme.accentSoft,
            borderRadius: variant.radius,
            padding: '12px 14px', marginBottom: 12,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 6,
            }}>
              <div style={{
                fontSize: 12, color: theme.text, fontWeight: 500,
                fontFamily: variant.allMono ? variant.mono : 'inherit',
              }}>
                Token created for "{newToken.name}"
              </div>
              <button onClick={() => setNewToken(null)} style={{
                background: 'transparent', border: 'none',
                color: theme.textDim, padding: 2, cursor: 'pointer',
                display: 'inline-flex',
              }}>
                <window.Icons.X size={11} />
              </button>
            </div>
            <div style={{
              fontSize: 11, color: theme.textDim, marginBottom: 8,
            }}>
              Copy this now — it won't be shown again.
            </div>
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center',
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: variant.radiusSm,
              padding: '6px 10px',
            }}>
              <code style={{
                flex: 1, fontFamily: variant.mono, fontSize: 12,
                color: theme.text, overflowX: 'auto', whiteSpace: 'nowrap',
              }}>{newToken.value}</code>
              <button onClick={copyNew} style={{
                background: copied ? theme.accent : 'transparent',
                color: copied ? theme.accentText : theme.textDim,
                border: `1px solid ${copied ? theme.accent : theme.border}`,
                padding: '3px 9px', borderRadius: variant.radiusSm,
                fontSize: 11, cursor: 'pointer',
                fontFamily: variant.allMono ? variant.mono : 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                flexShrink: 0,
              }}>
                {copied ? <window.Icons.Check size={10} /> : <window.Icons.Copy size={10} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Token list */}
        <div style={{
          border: `1px solid ${theme.border}`,
          borderRadius: variant.radius,
          background: theme.surface,
          overflow: 'hidden',
        }}>
          {tokens.length === 0 && (
            <div style={{
              padding: '14px', textAlign: 'center',
              color: theme.textMuted, fontSize: 11.5,
            }}>
              No tokens yet.
            </div>
          )}
          {tokens.map((t, i) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              borderTop: i === 0 ? 'none' : `1px solid ${theme.border}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, color: theme.text, fontWeight: 500,
                  letterSpacing: variant.letterSpacing,
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                }}>{t.name}</div>
                <div style={{
                  fontSize: 10.5, color: theme.textMuted,
                  fontFamily: variant.mono, marginTop: 2,
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span>{t.masked}</span>
                  <span>·</span>
                  <span>created {t.created}</span>
                  <span>·</span>
                  <span>last used {t.lastUsed}</span>
                </div>
              </div>
              <button
                onClick={() => revoke(t.id)}
                title="Revoke token"
                style={{
                  background: 'transparent', border: `1px solid ${theme.border}`,
                  color: theme.textDim, padding: '4px 9px',
                  borderRadius: variant.radiusSm, fontSize: 11, cursor: 'pointer',
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = theme.status.failed; e.currentTarget.style.borderColor = `${theme.status.failed}55`; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.borderColor = theme.border; }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>

        {/* Add token */}
        {creating ? (
          <div style={{
            display: 'flex', gap: 6, marginTop: 8,
            padding: '6px',
            background: theme.surface2,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: variant.radius,
          }}>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
                if (e.key === 'Escape') { setCreating(false); setDraftName(''); }
              }}
              placeholder="Token name (e.g. ci-runner)"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: theme.text, fontSize: 12, fontFamily: variant.mono,
                padding: '4px 8px',
              }}
            />
            <button onClick={create} style={{
              background: theme.accent, color: theme.accentText,
              border: 'none', borderRadius: variant.radiusSm, padding: '4px 11px',
              fontSize: 11.5, cursor: 'pointer',
              fontFamily: variant.allMono ? variant.mono : 'inherit',
            }}>Generate</button>
            <button onClick={() => { setCreating(false); setDraftName(''); }} style={{
              background: 'transparent', color: theme.textDim,
              border: 'none', padding: '4px 8px',
              fontSize: 11.5, cursor: 'pointer',
              fontFamily: variant.allMono ? variant.mono : 'inherit',
            }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'transparent', border: `1px dashed ${theme.border}`,
            color: theme.textDim, padding: '7px 12px',
            borderRadius: variant.radiusSm, fontSize: 11.5,
            cursor: 'pointer', marginTop: 8,
            fontFamily: variant.allMono ? variant.mono : 'inherit',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; e.currentTarget.style.borderColor = theme.borderStrong; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.borderColor = theme.border; }}
          >
            <window.Icons.Plus size={11} />
            {variant.allMono ? 'create access token' : 'Create access token'}
          </button>
        )}
      </div>
    );
  }

  function Cell({ label, value, theme }) {
    return (
      <div>
        <div style={{ color: theme.textMuted, marginBottom: 2 }}>{label}</div>
        <div style={{ color: theme.text }}>{value}</div>
      </div>
    );
  }

  function SettingsView({ theme, variant, tweaks, setTweak, onBack, data }) {
    const [section, setSection] = useState('providers');
    const nav = [
      { id: 'providers', label: 'Providers', icon: <window.Icons.Settings size={12} />, count: 3 },
      { id: 'environments', label: 'Environments', icon: <window.Icons.Server size={12} />, count: (data && data.environments ? data.environments.length : 0) },
      { id: 'appearance', label: 'Appearance', icon: <window.Icons.Sun size={12} /> },
      { id: 'keyboard', label: 'Keyboard', icon: <window.Icons.Lightning size={12} /> },
      { id: 'about', label: 'About', icon: null },
    ];
    return (
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <nav style={{
          width: 200, flexShrink: 0,
          background: theme.bg,
          borderRight: `1px solid ${theme.border}`,
          padding: '20px 12px',
          overflowY: 'auto',
        }}>
          <button
            onClick={onBack}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none',
              color: theme.textDim, padding: '4px 6px',
              fontSize: 11.5, cursor: 'pointer', marginBottom: 12,
              fontFamily: variant.allMono ? variant.mono : 'inherit',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = theme.text}
            onMouseLeave={(e) => e.currentTarget.style.color = theme.textDim}
          >
            <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><window.Icons.Chevron size={11} /></span>
            Back
          </button>
          <div style={{
            fontSize: 10, color: theme.textMuted, padding: '4px 8px', marginBottom: 4,
            textTransform: variant.allMono ? 'none' : 'uppercase',
            letterSpacing: variant.allMono ? 0 : '0.07em', fontWeight: 600,
            fontFamily: variant.allMono ? variant.mono : 'inherit',
          }}>
            {variant.allMono ? '# settings' : 'Settings'}
          </div>
          {nav.map(n => (
            <NavItem
              key={n.id}
              active={section === n.id}
              onClick={() => setSection(n.id)}
              theme={theme} variant={variant}
              icon={n.icon} label={n.label} count={n.count}
            />
          ))}
        </nav>
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: theme.bg }}>
          <div style={{ maxWidth: 640 }}>
            {section === 'providers' && <ProvidersSection theme={theme} variant={variant} />}
            {section === 'environments' && <EnvironmentsSection theme={theme} variant={variant} data={data} />}
            {section === 'appearance' && <AppearanceSection theme={theme} variant={variant} tweaks={tweaks} setTweak={setTweak} />}
            {section === 'keyboard' && <KeyboardSection theme={theme} variant={variant} />}
            {section === 'about' && <AboutSection theme={theme} variant={variant} />}
          </div>
        </div>
      </div>
    );
  }

  window.SettingsView = SettingsView;
})();
