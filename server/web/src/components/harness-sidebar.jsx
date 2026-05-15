// Sidebar: sessions grouped by working directory (default), date, or provider.
// Compact dense list with always-visible row actions (leave/archive/trash)
// and per-group "+" buttons to start a new session in that directory.

(function () {
  const { useState, useMemo, useEffect, useRef } = React;

  function fmtTime(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  function StatusDot({ status, theme, size = 6 }) {
    const color = theme.status[status] || theme.textMuted;
    if (status === 'running') {
      return (
        <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, animation: 'hrnPulse 1.6s ease-in-out infinite' }} />
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color }} />
        </span>
      );
    }
    return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0, opacity: status === 'idle' ? 0.6 : 1 }} />;
  }
  window.StatusDot = StatusDot;

  function ProviderBadge({ provider, model, theme, variant, mini, hideModel }) {
    if (variant.allMono) {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontFamily: variant.mono, fontSize: 10, color: theme.textDim, whiteSpace: 'nowrap',
        }}>
          <window.ProviderIcon provider={provider} size={10} theme={theme} variant={variant} square />
          {!hideModel && model}
        </span>
      );
    }
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 10.5, color: theme.textDim, whiteSpace: 'nowrap',
      }}>
        <window.ProviderIcon provider={provider} size={12} theme={theme} variant={variant} />
        {!hideModel && <span>{model}</span>}
      </span>
    );
  }
  window.ProviderBadge = ProviderBadge;

  // Simple SVG row-action icons (12px stroked).
  function ActionIcon({ kind, size = 12 }) {
    const stroke = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'leave') {
      // exit / log-out arrow
      return (
        <svg width={size} height={size} viewBox="0 0 14 14" {...stroke}>
          <path d="M7.5 2.5h-4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h4" />
          <path d="M10 4.5 12 7l-2 2.5M5.5 7H12" />
        </svg>
      );
    }
    if (kind === 'archive') {
      return (
        <svg width={size} height={size} viewBox="0 0 14 14" {...stroke}>
          <rect x="1.5" y="2.5" width="11" height="2.5" rx=".5" />
          <path d="M2.5 5v6a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5" />
          <path d="M5.5 7.5h3" />
        </svg>
      );
    }
    if (kind === 'trash') {
      return (
        <svg width={size} height={size} viewBox="0 0 14 14" {...stroke}>
          <path d="M2 4h10M5.5 4V2.5h3V4" />
          <path d="M3.5 4v7a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V4" />
          <path d="M6 6.5v4M8 6.5v4" />
        </svg>
      );
    }
    return null;
  }

  function RowAction({ kind, title, onClick, theme, danger }) {
    return (
      <button
        title={title}
        onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
        style={{
          background: 'transparent', border: 'none',
          padding: 3, borderRadius: 3,
          color: theme.textMuted, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = theme.surfaceHover; e.currentTarget.style.color = danger ? theme.status.failed : theme.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textMuted; }}
      >
        <ActionIcon kind={kind} />
      </button>
    );
  }

  function MenuItem({ label, hint, onClick, theme, variant, danger }) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          width: '100%', textAlign: 'left',
          padding: '5px 8px', background: 'transparent', border: 'none',
          cursor: 'pointer', borderRadius: variant.radiusSm,
          fontSize: 11.5, color: theme.text,
          fontFamily: variant.allMono ? variant.mono : 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = theme.surfaceHover; e.currentTarget.style.color = danger ? theme.status.failed : theme.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.text; }}
      >
        <span>{label}</span>
        <span style={{
          fontSize: 9.5, color: theme.textMuted, fontFamily: variant.mono,
          padding: '0 4px', border: `1px solid ${theme.border}`, borderRadius: 3,
        }}>{hint}</span>
      </button>
    );
  }

  // Compact-row context menu — a ⋮ button opening Rename / Archive / Delete.
  // While the menu is open, R / A / D trigger the actions and Esc closes it.
  // The popover is position:fixed so the sidebar's scroll container can't
  // clip it; it flips above the button when there's no room below.
  function RowMenu({ session, onRename, onArchive, onDelete, theme, variant, forceVisible }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const btnRef = useRef(null);

    const close = () => setOpen(false);
    const openMenu = () => {
      const r = btnRef.current && btnRef.current.getBoundingClientRect();
      if (r) {
        const right = Math.max(8, window.innerWidth - r.right);
        const MENU_H = 112;
        if (r.bottom + 4 + MENU_H > window.innerHeight) {
          setPos({ bottom: window.innerHeight - r.top + 4, right });
        } else {
          setPos({ top: r.bottom + 4, right });
        }
      }
      setOpen(true);
    };
    const doRename = () => {
      close();
      if (!onRename) return;
      const next = window.prompt('Rename session', session.title);
      if (next != null && next.trim() && next.trim() !== session.title) onRename(session, next.trim());
    };
    const doArchive = () => { close(); onArchive && onArchive(session); };
    const doDelete = () => {
      close();
      if (!onDelete) return;
      if (window.confirm(`Delete "${session.title}"? This removes it from the server and the agent.`)) onDelete(session);
    };

    useEffect(() => {
      if (!open) return;
      // Closures capture the actions from this render; the menu is transient
      // so any staleness across a poll is harmless (same session id).
      const onKey = (e) => {
        const k = (e.key || '').toLowerCase();
        if (k === 'r') { e.preventDefault(); doRename(); }
        else if (k === 'a') { e.preventDefault(); doArchive(); }
        else if (k === 'd') { e.preventDefault(); doDelete(); }
        else if (k === 'escape') { e.preventDefault(); close(); }
      };
      const dismiss = () => setOpen(false);
      document.addEventListener('keydown', onKey);
      window.addEventListener('scroll', dismiss, true);
      window.addEventListener('resize', dismiss);
      return () => {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('scroll', dismiss, true);
        window.removeEventListener('resize', dismiss);
      };
    }, [open]);

    return (
      <div style={{ display: 'inline-flex', flexShrink: 0 }}>
        <button
          ref={btnRef}
          title="Session actions"
          onClick={(e) => { e.stopPropagation(); open ? close() : openMenu(); }}
          style={{
            background: open ? theme.surfaceHover : 'transparent',
            border: 'none', padding: 3, borderRadius: 3,
            color: open ? theme.text : theme.textMuted, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center',
            opacity: (forceVisible || open) ? 1 : 0,
            transition: 'opacity .12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.surfaceHover; e.currentTarget.style.color = theme.text; }}
          onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textMuted; } }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="7" cy="3" r="1.25" />
            <circle cx="7" cy="7" r="1.25" />
            <circle cx="7" cy="11" r="1.25" />
          </svg>
        </button>
        {open && pos && (
          <>
            <div onClick={(e) => { e.stopPropagation(); close(); }}
                 style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
                right: pos.right,
                background: theme.surface2, border: `1px solid ${theme.borderStrong}`,
                borderRadius: variant.radius, padding: 4, minWidth: 160,
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)', zIndex: 61,
              }}
            >
              <MenuItem label={variant.allMono ? 'rename' : 'Rename'} hint="R" onClick={doRename} theme={theme} variant={variant} />
              <MenuItem label={variant.allMono ? 'archive' : 'Archive'} hint="A" onClick={doArchive} theme={theme} variant={variant} />
              <MenuItem label={variant.allMono ? 'delete' : 'Delete'} hint="D" onClick={doDelete} theme={theme} variant={variant} danger />
            </div>
          </>
        )}
      </div>
    );
  }

  function SessionRow({ session, active, onClick, theme, variant, density, onRename, onArchive, onDelete }) {
    const compact = density === 'compact';
    const padY = compact ? 5 : 8;
    const [hovered, setHovered] = useState(false);

    if (compact) {
      // One-line dense view: status · title · provider · time
      return (
        <div
          onClick={onClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: `${padY}px 10px ${padY}px 12px`,
            margin: '0 6px',
            borderRadius: variant.radiusSm,
            background: active ? theme.accentSoft : 'transparent',
            borderLeft: active && !variant.allMono ? `2px solid ${theme.accent}` : '2px solid transparent',
            cursor: 'pointer',
            position: 'relative',
          }}
          onMouseEnter={(e) => { setHovered(true); if (!active) e.currentTarget.style.background = theme.surfaceHover; }}
          onMouseLeave={(e) => { setHovered(false); if (!active) e.currentTarget.style.background = 'transparent'; }}
        >
          <StatusDot status={session.status} theme={theme} />
          <window.ProviderIcon provider={session.provider} size={11} theme={theme} variant={variant} square />
          <div style={{
            flex: 1, minWidth: 0,
            fontSize: 12, color: theme.text,
            fontWeight: active ? 500 : 400,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            letterSpacing: variant.letterSpacing,
          }}>
            {variant.allMono && active && '> '}{session.title}
          </div>
          <span style={{
            fontSize: 10, color: theme.textMuted, fontFamily: variant.mono,
            flexShrink: 0,
          }}>{fmtTime(session.updated)}</span>
          <RowMenu
            session={session}
            onRename={onRename} onArchive={onArchive} onDelete={onDelete}
            theme={theme} variant={variant}
            forceVisible={hovered}
          />
        </div>
      );
    }

    // Two-line comfy view: title + actions, then provider/model + time
    return (
      <div
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `${padY}px 8px ${padY}px 12px`,
          margin: '0 6px',
          borderRadius: variant.radiusSm,
          background: active ? theme.accentSoft : 'transparent',
          borderLeft: active && !variant.allMono ? `2px solid ${theme.accent}` : '2px solid transparent',
          cursor: 'pointer',
          position: 'relative',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.surfaceHover; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        <StatusDot status={session.status} theme={theme} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: theme.text,
            fontWeight: active ? 500 : 400,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            letterSpacing: variant.letterSpacing,
          }}>
            {variant.allMono && active && '> '}{session.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <ProviderBadge provider={session.provider} model={session.model} theme={theme} variant={variant} mini />
            <span style={{ fontSize: 10, color: theme.textMuted }}>·</span>
            <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>{fmtTime(session.updated)}</span>
          </div>
        </div>
        {/* Row actions — only in comfy view */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
          <RowAction kind="archive" title="Archive" theme={theme} onClick={() => onArchive && onArchive(session)} />
          <RowAction kind="trash" title="Delete" theme={theme} danger onClick={() => {
            if (!onDelete) return;
            if (window.confirm(`Delete "${session.title}"? This removes it from the server and the agent.`)) onDelete(session);
          }} />
        </div>
      </div>
    );
  }

  function GroupHeader({ label, count, collapsed, onToggle, theme, variant, groupBy, onAdd,
                        onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, isDragging, isDropTarget }) {
    const Chevron = window.Icons.ChevronDown;
    const showAdd = (groupBy === 'cwd' || groupBy === 'cwd+env') && label !== 'Chats';
    const isChats = label === 'Chats';
    // Render compound labels with monospace separators.
    function renderLabel() {
      if (typeof label !== 'string') return label;
      if (isChats) return 'Chats';
      // strip ~/code/ prefix for legibility in non-mono variants
      const cleaned = variant.allMono ? label : label.replace(/~\/code\//g, '');
      return cleaned;
    }
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 8px 8px 6px',
          margin: '6px 8px 4px 8px',
          background: theme.surface2,
          border: `1px solid ${theme.border}`,
          cursor: isDragging ? 'grabbing' : 'pointer',
          fontSize: 10,
          color: theme.textDim,
          textTransform: variant.allMono ? 'none' : 'uppercase',
          letterSpacing: variant.allMono ? '0' : '0.06em',
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          fontWeight: 600,
          opacity: isDragging ? 0.4 : 1,
          borderRadius: variant.radiusSm,
          borderTopWidth: isDropTarget ? 2 : 1,
          borderTopColor: isDropTarget ? theme.accent : theme.border,
          transition: 'background .12s, opacity .12s',
          position: 'relative',
        }}
      >
        <span
          className="hrn-group-grip"
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 12, color: theme.textMuted,
            cursor: 'grab', opacity: 0,
            transition: 'opacity .12s',
          }}
          onMouseDown={(e) => e.currentTarget.style.cursor = 'grabbing'}
          onMouseUp={(e) => e.currentTarget.style.cursor = 'grab'}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="2" cy="3" r=".6" fill="currentColor" />
            <circle cx="6" cy="3" r=".6" fill="currentColor" />
            <circle cx="2" cy="6" r=".6" fill="currentColor" />
            <circle cx="6" cy="6" r=".6" fill="currentColor" />
            <circle cx="2" cy="9" r=".6" fill="currentColor" />
            <circle cx="6" cy="9" r=".6" fill="currentColor" />
          </svg>
        </span>
        <span style={{
          display: 'inline-flex', transition: 'transform .15s',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)',
        }}>
          <Chevron size={10} />
        </span>
        {isChats && (
          <span style={{ display: 'inline-flex', color: theme.accent }}>
            <window.Icons.Chat size={11} />
          </span>
        )}
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {renderLabel()}
        </span>
        <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>{count}</span>
        {showAdd && (
          <button
            title="New session in this directory"
            onClick={(e) => { e.stopPropagation(); onAdd && onAdd(label); }}
            style={{
              background: 'transparent', border: 'none',
              padding: 2, borderRadius: 3, marginLeft: 2,
              color: theme.textMuted, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.surfaceHover; e.currentTarget.style.color = theme.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textMuted; }}
          >
            <window.Icons.Plus size={11} />
          </button>
        )}
      </div>
    );
  }

  function PickerPill({ label, value, options, onChange, theme, variant, hideLabel }) {
    const [open, setOpen] = useState(false);
    const current = options.find(o => o.id === value);
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 11, color: theme.textDim, padding: '2px 4px',
            borderRadius: variant.radiusSm,
            fontFamily: variant.allMono ? variant.mono : 'inherit',
          }}
        >
          {!hideLabel && <>{label}: </>}<span style={{ color: theme.text }}>{current.label}</span>
          <window.Icons.ChevronDown size={10} />
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: theme.surface2, border: `1px solid ${theme.borderStrong}`,
              borderRadius: variant.radius, padding: 4, minWidth: 180,
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              zIndex: 51,
            }}>
              {options.map(o => (
                <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 8px', background: 'transparent', border: 'none',
                  cursor: 'pointer', fontSize: 11, color: theme.text,
                  borderRadius: variant.radiusSm,
                  fontFamily: variant.allMono ? variant.mono : 'inherit',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = theme.surfaceHover}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {o.id === value ? '• ' : '  '}{o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  function GroupBySelector({ value, onChange, theme, variant, hideLabel }) {
    const opts = [
      { id: 'cwd', label: 'directory' },
      { id: 'env', label: 'environment' },
      { id: 'cwd+env', label: 'directory / env' },
      { id: 'env+cwd', label: 'env / directory' },
      { id: 'date', label: 'date' },
      { id: 'provider', label: 'provider' },
    ];
    return <PickerPill label="group" value={value} options={opts} onChange={onChange} theme={theme} variant={variant} hideLabel={hideLabel} />;
  }

  function SortBySelector({ value, onChange, theme, variant, hideLabel }) {
    const opts = [
      { id: 'latest', label: 'latest message' },
      { id: 'created', label: 'created date' },
      { id: 'title', label: 'session title' },
    ];
    return <PickerPill label="sort" value={value} options={opts} onChange={onChange} theme={theme} variant={variant} hideLabel={hideLabel} />;
  }

  function Sidebar({ sessions, activeId, onSelect, theme, variant, density, width, onNewSession, onRenameSession, onArchiveSession, onDeleteSession }) {
    const [groupBy, setGroupBy] = useState('cwd');
    const [sortBy, setSortBy] = useState('latest');
    const [collapsed, setCollapsed] = useState({});
    const [search, setSearch] = useState('');
    // User-defined order of groups per groupBy mode. null = default (insertion) order.
    const [groupOrder, setGroupOrder] = useState({});
    const [dragKey, setDragKey] = useState(null);
    const [overKey, setOverKey] = useState(null);

    const filtered = useMemo(() => {
      const q = search.toLowerCase();
      const base = !q ? sessions : sessions.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q) ||
        (s.env || '').toLowerCase().includes(q)
      );
      const sorted = [...base];
      if (sortBy === 'latest') sorted.sort((a, b) => b.updated - a.updated);
      else if (sortBy === 'created') sorted.sort((a, b) => (b.created || b.updated) - (a.created || a.updated));
      else if (sortBy === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
      return sorted;
    }, [sessions, search, sortBy]);

    const groups = useMemo(() => {
      const map = new Map();
      const envOf = (s) => s.env || (s.cwd === 'Chats' ? null : 'none');
      const key = (s) => {
        if (groupBy === 'cwd') return s.cwd;
        if (groupBy === 'provider') return s.provider;
        if (groupBy === 'env') return envOf(s) || 'Chats';
        if (groupBy === 'cwd+env') return s.cwd === 'Chats' ? 'Chats' : `${s.cwd}  ·  ${envOf(s) || '—'}`;
        if (groupBy === 'env+cwd') return s.cwd === 'Chats' ? 'Chats' : `${envOf(s) || '—'}  ·  ${s.cwd}`;
        if (groupBy === 'date') {
          const d = Date.now() - s.updated;
          if (d < 3600000) return 'Last hour';
          if (d < 86400000) return 'Today';
          if (d < 7 * 86400000) return 'This week';
          return 'Older';
        }
        return 'all';
      };
      filtered.forEach(s => {
        const k = key(s);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(s);
      });
      const entries = Array.from(map.entries());
      // Apply user's drag order (falls back to default for unseen keys).
      const order = groupOrder[groupBy];
      if (order && order.length) {
        entries.sort(([a], [b]) => {
          const ai = order.indexOf(a);
          const bi = order.indexOf(b);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      } else if (groupBy === 'cwd' || groupBy === 'cwd+env' || groupBy === 'env+cwd' || groupBy === 'env') {
        // Pin "Chats" group to the top when there's no user order yet.
        entries.sort(([a], [b]) => (a === 'Chats' ? -1 : b === 'Chats' ? 1 : 0));
      }
      return entries;
    }, [filtered, groupBy, groupOrder]);

    const Search = window.Icons.Search;
    const Plus = window.Icons.Plus;

    // Are all groups currently collapsed? Used to flip the collapse-all toggle.
    const allCollapsed = useMemo(() => {
      if (!groups.length) return false;
      return groups.every(([k]) => collapsed[k]);
    }, [groups, collapsed]);

    return (
      <aside style={{
        width,
        background: theme.surface,
        borderRight: `1px solid ${theme.border}`,
        display: 'flex', flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}>
        {/* Top controls — prominent New, search, then group/sort row */}
        <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: density === 'compact' ? 6 : 8 }}>
          {/* New session — prominent button */}
          <button
            title="New session"
            onClick={() => onNewSession && onNewSession(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: theme.accentSoft,
              border: `1px solid ${theme.accentLine}`,
              color: theme.accent,
              padding: density === 'compact' ? '5px 10px' : '6px 10px',
              borderRadius: variant.radiusSm,
              fontSize: 12, cursor: 'pointer',
              fontFamily: variant.allMono ? variant.mono : 'inherit',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.accent; e.currentTarget.style.color = theme.accentText; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = theme.accentSoft; e.currentTarget.style.color = theme.accent; }}
          >
            <Plus size={11} /> {variant.allMono ? 'new session' : 'New session'}
          </button>

          {/* Search — in compact, the group/sort/collapse controls inline to its right */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: theme.surface2,
            border: `1px solid ${theme.border}`,
            borderRadius: variant.radiusSm,
            padding: '5px 8px',
          }}>
            <Search size={12} style={{ color: theme.textMuted }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={variant.allMono ? 'grep sessions' : 'Search sessions'}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: theme.text, fontSize: 12, fontFamily: variant.font,
                minWidth: 0,
              }}
            />
            <span style={{
              fontSize: 10, color: theme.textMuted, fontFamily: variant.mono,
              padding: '1px 4px', border: `1px solid ${theme.border}`,
              borderRadius: 3,
            }}>⌘K</span>
          </div>

          {/* Group + sort row — muted, sits under search like a meta bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: density === 'compact' ? 4 : 6,
            paddingTop: density === 'compact' ? 0 : 2,
            flexWrap: 'wrap',
            fontSize: density === 'compact' ? 10.5 : 11,
          }}>
            <GroupBySelector value={groupBy} onChange={setGroupBy} theme={theme} variant={variant} hideLabel={density === 'compact'} />
            <span style={{ color: theme.textMuted, fontSize: 10 }}>·</span>
            <SortBySelector value={sortBy} onChange={setSortBy} theme={theme} variant={variant} hideLabel={density === 'compact'} />
            <div style={{ flex: 1, minWidth: 0 }} />
            <button
              title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
              onClick={() => {
                if (allCollapsed) {
                  setCollapsed({});
                } else {
                  const all = {};
                  groups.forEach(([k]) => { all[k] = true; });
                  setCollapsed(all);
                }
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: theme.textMuted, padding: 3, borderRadius: 3,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; e.currentTarget.style.background = theme.surfaceHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = theme.textMuted; e.currentTarget.style.background = 'transparent'; }}
            >
              {allCollapsed ? (
                /* expand all — two chevrons pointing outward */
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5.5 7 2.5l3 3" />
                  <path d="M4 8.5 7 11.5l3-3" />
                </svg>
              ) : (
                /* collapse all — two chevrons pointing inward */
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 3 7 6l3-3" />
                  <path d="M4 11 7 8l3 3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Groups */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
          {groups.map(([groupKey, items], idx) => {
            const isCollapsed = collapsed[groupKey];
            return (
              <div key={groupKey} style={{
                borderBottom: idx < groups.length - 1 ? `1px solid ${theme.border}` : 'none',
                paddingBottom: 6,
                marginBottom: 2,
              }}>
                <GroupHeader
                  label={groupKey}
                  count={items.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed({ ...collapsed, [groupKey]: !isCollapsed })}
                  theme={theme}
                  variant={variant}
                  groupBy={groupBy}
                  onAdd={(cwd) => onNewSession && onNewSession(cwd)}
                  isDragging={dragKey === groupKey}
                  isDropTarget={overKey === groupKey && dragKey !== groupKey}
                  onDragStart={(e) => {
                    setDragKey(groupKey);
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', groupKey); } catch {}
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (overKey !== groupKey) setOverKey(groupKey);
                  }}
                  onDragLeave={(e) => {
                    if (overKey === groupKey) setOverKey(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragKey;
                    const to = groupKey;
                    if (from && to && from !== to) {
                      const keys = groups.map(([k]) => k);
                      const fromIdx = keys.indexOf(from);
                      const toIdx = keys.indexOf(to);
                      const reordered = keys.slice();
                      reordered.splice(fromIdx, 1);
                      reordered.splice(toIdx, 0, from);
                      setGroupOrder({ ...groupOrder, [groupBy]: reordered });
                    }
                    setDragKey(null); setOverKey(null);
                  }}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                />
                {!isCollapsed && items.map(s => (
                  <SessionRow
                    key={s.id} session={s}
                    active={s.id === activeId}
                    onClick={() => onSelect(s.id)}
                    theme={theme} variant={variant} density={density}
                    onRename={onRenameSession}
                    onArchive={onArchiveSession}
                    onDelete={onDeleteSession}
                  />
                ))}
              </div>
            );
          })}
          {groups.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: theme.textMuted, fontSize: 11 }}>
              No matches
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${theme.border}`,
          padding: '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 10, color: theme.textMuted,
          fontFamily: variant.allMono ? variant.mono : 'inherit',
        }}>
          <span>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
          <span>{sessions.filter(s => s.status === 'running').length} active</span>
        </div>
      </aside>
    );
  }

  window.Sidebar = Sidebar;
})();
