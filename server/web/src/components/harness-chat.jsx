// Chat log + message rendering.
// Supported kinds:
//   text         — user/assistant message
//   thinking     — collapsible dimmed block
//   tool         — expandable tool call (with diff/result/image/error)
//   attachment   — user-uploaded files/images
//   permission   — approval request with decision recorded
//   progress     — long-running tool with progress bar

(function () {
  const { useState, useRef, useEffect } = React;

  function fmtClock(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Cheap "highlight" — keyword/string/number/comment/function spans.
  function hl(code, theme) {
    const KW = /\b(import|from|export|const|let|var|function|async|await|return|if|else|new|class|extends|true|false|null|undefined|this)\b/g;
    const STR = /(['"`])(.*?)\1/g;
    const NUM = /\b(\d+(?:\.\d+)?)\b/g;
    const COM = /(\/\/[^\n]*)/g;
    const FN = /\b([a-zA-Z_$][\w$]*)(?=\()/g;
    const places = [];
    const push = (re, cls) => {
      let m;while ((m = re.exec(code)) !== null) {
        places.push({ start: m.index, end: m.index + m[0].length, text: m[0], cls });
      }
    };
    push(COM, 'com');
    push(STR, 'str');
    push(KW, 'kw');
    push(NUM, 'num');
    push(FN, 'fn');
    places.sort((a, b) => a.start - b.start);
    const clean = [];
    let lastEnd = 0;
    for (const p of places) {if (p.start >= lastEnd) {clean.push(p);lastEnd = p.end;}}
    const colors = {
      kw: theme.accent, str: '#e5c07b', num: '#d19a66', com: theme.textMuted, fn: '#61afef'
    };
    const out = [];
    let i = 0;
    clean.forEach((p, idx) => {
      if (p.start > i) out.push(<span key={'t' + idx}>{code.slice(i, p.start)}</span>);
      out.push(<span key={'p' + idx} style={{ color: colors[p.cls], fontStyle: p.cls === 'com' ? 'italic' : 'normal' }}>{p.text}</span>);
      i = p.end;
    });
    if (i < code.length) out.push(<span key="rest">{code.slice(i)}</span>);
    return out;
  }

  function DiffBlock({ diff, theme, variant, path }) {
    const colors = {
      add: { bg: 'rgba(74,222,128,0.08)', fg: '#7ee2a8', sign: '+' },
      del: { bg: 'rgba(248,113,113,0.08)', fg: '#f78b8b', sign: '-' },
      ctx: { bg: 'transparent', fg: theme.textDim, sign: ' ' }
    };
    const added = diff.filter((l) => l.type === 'add').length;
    const removed = diff.filter((l) => l.type === 'del').length;
    return (
      <div style={{
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: variant.radiusSm,
        overflow: 'hidden',
        fontFamily: variant.mono,
        fontSize: 11.5
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderBottom: `1px solid ${theme.border}`,
          background: theme.surface, fontSize: 10.5, color: theme.textDim
        }}>
          <span style={{ color: theme.text }}>{path}</span>
          <span>
            <span style={{ color: '#7ee2a8' }}>+{added}</span>
            {'  '}
            <span style={{ color: '#f78b8b' }}>−{removed}</span>
          </span>
        </div>
        <div style={{ padding: '6px 0' }}>
          {diff.map((line, i) => {
            const c = colors[line.type];
            return (
              <div key={i} style={{
                background: c.bg, color: c.fg,
                padding: '0 10px', lineHeight: 1.7,
                whiteSpace: 'pre',
                display: 'grid', gridTemplateColumns: '14px 1fr', gap: 6
              }}>
                <span style={{ opacity: 0.7 }}>{c.sign}</span>
                <span>{line.text || ' '}</span>
              </div>);

          })}
        </div>
      </div>);

  }

  function ToolCall({ msg, theme, variant }) {
    const autoOpen = msg.tool === 'edit_file' || msg.tool === 'screenshot' || msg.status === 'fail';
    const [open, setOpen] = useState(autoOpen);
    const Chev = window.Icons.ChevronDown;
    const argStr = Object.entries(msg.args || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? '"' + v + '"' : v}`).join(', ');
    const failed = msg.status === 'fail';
    const toolColor = failed ? theme.status.failed : msg.status === 'ok' ? theme.status.completed : theme.accent;
    return (
      <div style={{
        border: `1px solid ${failed ? `${theme.status.failed}55` : theme.border}`,
        borderRadius: variant.radiusSm,
        background: theme.surface,
        overflow: 'hidden'
      }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 10px', background: 'transparent', border: 'none',
            cursor: 'pointer', color: theme.text, textAlign: 'left',
            fontFamily: variant.mono, fontSize: 11.5
          }}>
          
          <span style={{
            display: 'inline-flex', transition: 'transform .15s',
            transform: open ? 'rotate(0)' : 'rotate(-90deg)',
            color: theme.textDim
          }}>
            <Chev size={10} />
          </span>
          <span style={{ color: toolColor }}>●</span>
          <span style={{ color: theme.accent }}>{msg.tool}</span>
          <span style={{ color: theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            ({argStr})
          </span>
          {msg.duration && <span style={{ color: theme.textMuted, fontSize: 10 }}>{msg.duration}</span>}
          <span style={{ color: failed ? theme.status.failed : theme.textMuted, fontSize: 10 }}>
            {failed ? variant.allMono ? '[fail]' : '✗' : msg.status === 'ok' ? variant.allMono ? '[ok]' : '✓' : msg.status}
          </span>
        </button>
        {open &&
        <div style={{ borderTop: `1px solid ${theme.border}`, padding: 10 }}>
            {msg.error &&
          <div style={{
            background: 'rgba(248,113,113,0.08)',
            border: `1px solid ${theme.status.failed}44`,
            borderRadius: variant.radiusSm,
            padding: '8px 10px', marginBottom: msg.result ? 8 : 0,
            fontSize: 11.5, color: '#f78b8b', fontFamily: variant.mono,
            whiteSpace: 'pre-wrap'
          }}>
                <span style={{ color: theme.status.failed, fontWeight: 600 }}>error:</span> {msg.error}
              </div>
          }
            {msg.diff && <DiffBlock diff={msg.diff} theme={theme} variant={variant} path={msg.args.path} />}
            {msg.result && !msg.diff && !msg.image &&
          <pre style={{
            margin: 0, padding: '8px 10px',
            background: theme.surface2,
            border: `1px solid ${theme.border}`,
            borderRadius: variant.radiusSm,
            fontFamily: variant.mono, fontSize: 11.5,
            color: theme.text, lineHeight: 1.55,
            overflow: 'auto', whiteSpace: 'pre',
            maxHeight: 280
          }}>
                <code>{hl(msg.result, theme)}</code>
              </pre>
          }
            {msg.image &&
          <div style={{
            background: theme.surface2,
            border: `1px solid ${theme.border}`,
            borderRadius: variant.radiusSm,
            aspectRatio: '16/9',
            position: 'relative', overflow: 'hidden'
          }}>
                <FakeBrowserShot theme={theme} variant={variant} />
              </div>
          }
          </div>
        }
      </div>);

  }

  function FakeBrowserShot({ theme, variant }) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 20, background: theme.surface, borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff6363' }} />
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f0b84a' }} />
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
          <span style={{
            marginLeft: 10, fontSize: 9.5, color: theme.textMuted,
            fontFamily: variant.mono
          }}>localhost:3000/dashboard</span>
        </div>
        <div style={{ flex: 1, padding: 10, display: 'grid', gridTemplateColumns: '60px 1fr', gap: 8 }}>
          <div style={{ background: theme.surface, borderRadius: 3 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 12, width: '40%', background: theme.surface, borderRadius: 3 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, flex: 1 }}>
              {[1, 2, 3].map((i) =>
              <div key={i} style={{
                background: theme.surface, borderRadius: 3,
                border: `1px solid ${theme.border}`,
                padding: 6, display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
              }}>
                  <div style={{ width: '60%', height: 4, background: theme.border, borderRadius: 2 }} />
                  <div style={{ width: '40%', height: 8, background: theme.accent, borderRadius: 2, opacity: 0.7 }} />
                </div>
              )}
            </div>
            <div style={{ flex: 1, background: theme.surface, borderRadius: 3 }} />
          </div>
        </div>
      </div>);

  }

  function ThinkingBlock({ msg, theme, variant }) {
    const [open, setOpen] = useState(!msg.collapsed);
    const Chev = window.Icons.ChevronDown;
    const Sparkle = window.Icons.Sparkle;
    return (
      <div style={{
        borderLeft: `2px solid ${theme.borderStrong}`,
        paddingLeft: 12,
        color: theme.textDim
      }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '2px 0', color: theme.textDim,
            fontSize: 11, fontStyle: variant.allMono ? 'normal' : 'italic',
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}>
          
          <Sparkle size={11} />
          <span>{variant.allMono ? '# thinking' : 'Thinking'}</span>
          <span style={{ color: theme.textMuted }}>· {msg.summary}</span>
          <span style={{ display: 'inline-flex', transform: open ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s' }}>
            <Chev size={10} />
          </span>
        </button>
        {open &&
        <div style={{
          fontSize: 12, color: theme.textDim, lineHeight: 1.6,
          fontStyle: variant.allMono ? 'normal' : 'italic',
          marginTop: 4, whiteSpace: 'pre-wrap',
          fontFamily: variant.allMono ? variant.mono : 'inherit'
        }}>
            {msg.text}
          </div>
        }
      </div>);

  }

  // ─── New chat states ───

  function AttachmentBlock({ msg, theme, variant }) {
    return (
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        paddingTop: 2
      }}>
        {msg.attachments.map((a, i) => {
          if (a.type === 'image') {
            return (
              <div key={i} style={{
                width: 160, height: 100,
                background: theme.surface2,
                border: `1px solid ${theme.border}`,
                borderRadius: variant.radiusSm,
                overflow: 'hidden', position: 'relative'
              }}>
                <FakeBrowserShot theme={theme} variant={variant} />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                  padding: '8px 8px 6px',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                  fontSize: 10, fontFamily: variant.mono, color: '#fff'
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    {a.name}
                  </span>
                  <span style={{ opacity: 0.7 }}>{a.size}</span>
                </div>
              </div>);

          }
          // file
          return (
            <div key={i} style={{
              minWidth: 180, maxWidth: 280,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: variant.radiusSm,
              padding: 10
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11.5, color: theme.text, fontFamily: variant.mono,
                marginBottom: 4
              }}>
                <window.Icons.File size={12} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                <span style={{ fontSize: 10, color: theme.textMuted }}>{a.size}</span>
              </div>
              {a.preview &&
              <pre style={{
                margin: 0, padding: '6px 8px',
                background: theme.surface2, border: `1px solid ${theme.border}`,
                borderRadius: 3, fontSize: 10.5, fontFamily: variant.mono,
                color: theme.textDim, overflow: 'hidden',
                maxHeight: 60, whiteSpace: 'pre'
              }}>{a.preview}</pre>
              }
            </div>);

        })}
      </div>);

  }

  function PermissionBlock({ msg, theme, variant }) {
    return (
      <div style={{
        border: `1px solid ${theme.accentLine}`,
        borderRadius: variant.radiusSm,
        background: theme.accentSoft,
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: variant.radiusSm,
          background: theme.surface, color: theme.accent,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          border: `1px solid ${theme.accentLine}`
        }}>
          <window.Icons.Lightning size={13} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5, color: theme.text, fontWeight: 500,
            letterSpacing: variant.letterSpacing,
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}>{msg.title}</div>
          <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2, fontFamily: variant.mono }}>
            {msg.tool} · {msg.target} · {msg.summary}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {msg.options.map((opt) => {
            const isChosen = opt === msg.decision;
            const isApprove = opt.startsWith('Approve');
            const isReject = opt === 'Reject';
            return (
              <button key={opt} style={{
                background: isChosen ? isApprove ? theme.accent : theme.status.failed : 'transparent',
                color: isChosen ? '#fff' : isReject ? theme.status.failed : theme.textDim,
                border: `1px solid ${isChosen ? isApprove ? theme.accent : theme.status.failed : theme.border}`,
                borderRadius: variant.radiusSm,
                padding: '4px 10px', fontSize: 11.5,
                cursor: 'pointer',
                fontFamily: variant.allMono ? variant.mono : 'inherit',
                fontWeight: isChosen ? 500 : 400
              }}>
                {isChosen && '✓ '}{opt}
              </button>);

          })}
        </div>
      </div>);

  }

  function ProgressBlock({ msg, theme, variant }) {
    return (
      <div style={{
        border: `1px solid ${theme.border}`,
        borderRadius: variant.radiusSm,
        background: theme.surface,
        padding: '10px 12px'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8,
          fontSize: 11.5, color: theme.text,
          fontFamily: variant.allMono ? variant.mono : 'inherit'
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: theme.accent,
              animation: 'hrnPulse 1.4s ease-in-out infinite'
            }} />
            {msg.label}
          </span>
          <span style={{ fontSize: 10.5, color: theme.textMuted, fontFamily: variant.mono }}>
            {msg.current}/{msg.total}
          </span>
        </div>
        <div style={{
          height: 4, background: theme.surface2,
          borderRadius: 2, overflow: 'hidden',
          border: `1px solid ${theme.border}`
        }}>
          <div style={{
            height: '100%', width: msg.pct + '%',
            background: theme.accent,
            transition: 'width .3s ease'
          }} />
        </div>
      </div>);

  }

  function CopyButton({ getText, theme, variant, inline }) {
    const [copied, setCopied] = useState(false);
    const tRef = useRef(null);
    function copy(e) {
      e.stopPropagation();
      const t = typeof getText === 'function' ? getText() : getText;
      try {navigator.clipboard && navigator.clipboard.writeText(t);} catch {}
      setCopied(true);
      if (tRef.current) clearTimeout(tRef.current);
      tRef.current = setTimeout(() => setCopied(false), 1200);
    }
    return (
      <button
        onClick={copy}
        title={copied ? 'Copied' : 'Copy message'}
        className="hrn-copy-btn"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22,
          background: copied ? theme.accentSoft : theme.surface,
          border: `1px solid ${copied ? theme.accentLine : theme.border}`,
          color: copied ? theme.accent : theme.textDim,
          borderRadius: variant.radiusSm, cursor: 'pointer',
          flexShrink: 0,
          opacity: copied ? 1 : inline ? 0 : 0.6,
          transition: 'opacity .12s, color .12s, background .12s'
        }}
        onMouseEnter={(e) => {if (!copied) {e.currentTarget.style.color = theme.text;e.currentTarget.style.background = theme.surfaceHover;}}}
        onMouseLeave={(e) => {if (!copied) {e.currentTarget.style.color = theme.textDim;e.currentTarget.style.background = theme.surface;}}}>
        
        {copied ? <window.Icons.Check size={10} /> : <window.Icons.Copy size={10} />}
      </button>);

  }

  function MessageBubble({ children, role, theme, variant, bubble, getCopyText }) {
    if (!bubble) {
      return (
        <div className="hrn-msg-row" style={{
          width: '100%', display: 'flex', alignItems: 'flex-start', gap: 8
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          {getCopyText &&
          <div style={{ paddingTop: 4 }}>
              <CopyButton getText={getCopyText} theme={theme} variant={variant} inline />
            </div>
          }
        </div>);

    }
    const isUser = role === 'user';
    return (
      <div className="hrn-msg-row" style={{
        display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start', gap: 8,
        width: '100%'
      }}>
        {isUser && getCopyText &&
        <div style={{ paddingTop: 4 }}>
            <CopyButton getText={getCopyText} theme={theme} variant={variant} inline />
          </div>
        }
        <div style={{
          maxWidth: '85%',
          background: isUser ? theme.accentSoft : theme.surface,
          border: `1px solid ${isUser ? theme.accentLine : theme.border}`,
          borderRadius: variant.radius,
          padding: '8px 12px',
          color: theme.text
        }}>
          {children}
        </div>
        {!isUser && getCopyText &&
        <div style={{ paddingTop: 4 }}>
            <CopyButton getText={getCopyText} theme={theme} variant={variant} inline />
          </div>
        }
      </div>);

  }

  function MessageHeader({ msg, theme, variant, session }) {
    const isUser = msg.role === 'user';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {isUser ?
        <span style={{
          fontSize: 11, fontWeight: 600, color: theme.text,
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          letterSpacing: variant.letterSpacing
        }}>
            {variant.allMono ? '$ user' : 'You'}
          </span> :

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600,
          fontFamily: variant.allMono ? variant.mono : 'inherit',
          letterSpacing: variant.letterSpacing
        }} data-comment-anchor="f2cc1615c8-span-521-11">
            <window.ProviderIcon
            provider={msg.provider || session && session.provider || 'claude'}
            size={12} theme={theme} variant={variant} square />
            <span style={{ color: theme.text }}>
              {msg.model || session && session.model || 'claude'}
            </span>
          </span>
        }
        <span style={{ fontSize: 10, color: theme.textMuted, fontFamily: variant.mono }}>
          {fmtClock(msg.time)}
        </span>
        {msg.streaming &&
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, color: theme.status.running
        }}>
            <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: theme.status.running,
            animation: 'hrnPulse 1.4s ease-in-out infinite'
          }} />
            {variant.allMono ? 'streaming' : 'Streaming'}
          </span>
        }
      </div>);

  }

  function ChatMessage({ msg, theme, variant, bubble, density, prevRole, session }) {
    const padY = density === 'compact' ? 5 : 9;
    // Continuation: assistant blocks (thinking/tool/etc) that follow another assistant block — skip header
    const showHeader = msg.kind === 'text' || msg.kind === 'attachment';

    if (msg.kind === 'thinking') {
      return <div style={{ padding: `${padY}px 0` }}><ThinkingBlock msg={msg} theme={theme} variant={variant} /></div>;
    }
    if (msg.kind === 'tool') {
      return <div style={{ padding: `${padY}px 0` }}><ToolCall msg={msg} theme={theme} variant={variant} /></div>;
    }
    if (msg.kind === 'permission') {
      return <div style={{ padding: `${padY}px 0` }}><PermissionBlock msg={msg} theme={theme} variant={variant} /></div>;
    }
    if (msg.kind === 'progress') {
      return <div style={{ padding: `${padY}px 0` }}><ProgressBlock msg={msg} theme={theme} variant={variant} /></div>;
    }

    if (msg.kind === 'attachment') {
      return (
        <div style={{ padding: `${padY}px 0` }}>
          <AttachmentBlock msg={msg} theme={theme} variant={variant} />
        </div>);

    }

    // text
    if (msg.placeholder) return null;
    const content =
    <>
        {showHeader && <MessageHeader msg={msg} theme={theme} variant={variant} session={session} />}
        <div style={{
        fontSize: 13, color: theme.text, lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        fontFamily: variant.allMono ? variant.mono : 'inherit',
        letterSpacing: variant.letterSpacing
      }}>
          {msg.text}
          {msg.streaming && <span style={{
          display: 'inline-block', width: 7, height: 13, marginLeft: 2,
          background: theme.accent, verticalAlign: 'text-bottom',
          animation: 'hrnBlink 1s steps(2) infinite'
        }} />}
        </div>
      </>;


    return (
      <div style={{ padding: `${padY}px 0` }}>
        <MessageBubble role={msg.role} theme={theme} variant={variant} bubble={bubble} getCopyText={msg.kind === 'text' ? () => msg.text : null}>
          {content}
        </MessageBubble>
      </div>);

  }

  // Build a plaintext transcript of the messages for copy-to-clipboard.
  function toPlainText(messages, sessionTitle) {
    const lines = [`# ${sessionTitle}`, ''];
    messages.forEach((m) => {
      if (m.placeholder) return;
      const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (m.kind === 'thinking') {
        lines.push(`[thinking — ${m.summary}]`);
        lines.push(m.text);
      } else if (m.kind === 'tool') {
        const argStr = Object.entries(m.args || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
        lines.push(`[tool] ${m.tool}(${argStr}) → ${m.status}${m.duration ? ' · ' + m.duration : ''}`);
        if (m.error) lines.push(`  error: ${m.error}`);
        if (m.result) lines.push(m.result.split('\n').map((l) => '  ' + l).join('\n'));
        if (m.diff) lines.push(m.diff.map((d) => (d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  ') + d.text).join('\n'));
      } else if (m.kind === 'permission') {
        lines.push(`[permission] ${m.title} — ${m.summary} → ${m.decision || 'pending'}`);
      } else if (m.kind === 'progress') {
        lines.push(`[progress] ${m.label} ${m.current}/${m.total} (${m.pct}%)`);
      } else if (m.kind === 'attachment') {
        lines.push(`[attached] ${m.attachments.map((a) => a.name).join(', ')}`);
      } else if (m.kind === 'text') {
        const role = m.role === 'user' ? 'User' : 'Claude';
        lines.push(`${role} (${time})`);
        lines.push(m.text);
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  function ViewDropdown({ value, onChange, theme, variant }) {
    const [open, setOpen] = useState(false);
    const views = [
    { id: 'transcript', label: 'Transcript', hint: 'Full rich view with tools' },
    { id: 'conversation', label: 'Conversation', hint: 'User + assistant only' },
    { id: 'flat', label: 'Flat text', hint: 'Markdown export' },
    { id: 'json', label: 'Raw JSON', hint: 'Pretty-printed objects' },
    { id: 'jsonl', label: 'JSON Lines', hint: 'One object per line' }];

    const current = views.find((v) => v.id === value) || views[0];
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(!open)}
          title="Change view"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: open ? theme.accentSoft : 'transparent',
            border: `1px solid ${open ? theme.accentLine : theme.border}`,
            color: open ? theme.accent : theme.textDim,
            padding: '4px 8px', borderRadius: variant.radiusSm,
            cursor: 'pointer', fontSize: 11,
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}
          onMouseEnter={(e) => {if (!open) {e.currentTarget.style.color = theme.text;e.currentTarget.style.borderColor = theme.borderStrong;}}}
          onMouseLeave={(e) => {if (!open) {e.currentTarget.style.color = theme.textDim;e.currentTarget.style.borderColor = theme.border;}}}>
          
          <window.Icons.Eye size={11} />
          <span>{current.label.toLowerCase()}</span>
          <window.Icons.ChevronDown size={9} />
        </button>
        {open &&
        <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            background: theme.surface2,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: variant.radius,
            padding: 4, minWidth: 220, zIndex: 51,
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)'
          }}>
              <div style={{
              padding: '5px 8px 6px', fontSize: 10, color: theme.textMuted,
              fontFamily: variant.allMono ? variant.mono : 'inherit',
              textTransform: variant.allMono ? 'none' : 'uppercase',
              letterSpacing: variant.allMono ? 0 : '0.07em',
              fontWeight: 600
            }}>
                {variant.allMono ? '# view' : 'View'}
              </div>
              {views.map((v) => {
              const active = v.id === value;
              return (
                <button key={v.id} onClick={() => {onChange(v.id);setOpen(false);}} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px',
                  background: active ? theme.accentSoft : 'transparent',
                  border: 'none', cursor: 'pointer',
                  borderRadius: variant.radiusSm,
                  textAlign: 'left',
                  fontFamily: variant.allMono ? variant.mono : 'inherit'
                }}
                onMouseEnter={(e) => {if (!active) e.currentTarget.style.background = theme.surfaceHover;}}
                onMouseLeave={(e) => {if (!active) e.currentTarget.style.background = 'transparent';}}>
                  
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: theme.text, fontWeight: active ? 500 : 400 }}>
                        {v.label}
                      </div>
                      <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 1 }}>{v.hint}</div>
                    </div>
                    {active && <span style={{ color: theme.accent, fontSize: 11 }}>●</span>}
                  </button>);

            })}
            </div>
          </>
        }
      </div>);

  }

  function SessionTitleBar({ sessionTitle, theme, variant, view, onViewChange, onCopy, copied, onRename, onArchive, onDelete }) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(sessionTitle);
    const inputRef = useRef(null);

    useEffect(() => {setTitle(sessionTitle);}, [sessionTitle]);
    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editing]);

    function commit() {
      const next = (title || '').trim();
      if (next && next !== sessionTitle && onRename) onRename(next);
      setEditing(false);
    }
    function cancel() {setTitle(sessionTitle);setEditing(false);}

    return (
      <div style={{
        flexShrink: 0,
        padding: '12px 28px 12px',
        borderBottom: `1px solid ${theme.border}`,
        background: theme.bg,
        display: 'flex', alignItems: 'center', gap: 8
      }}>
        {editing ?
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {e.preventDefault();commit();}
            if (e.key === 'Escape') {e.preventDefault();cancel();}
          }}
          style={{
            flex: 1, minWidth: 0,
            background: theme.surface2,
            border: `1px solid ${theme.accentLine}`,
            borderRadius: variant.radiusSm,
            color: theme.text,
            padding: '4px 8px',
            fontSize: 18, fontWeight: 600,
            fontFamily: variant.allMono ? variant.mono : variant.font,
            letterSpacing: variant.titleSpacing,
            outline: 'none'
          }} /> :


        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          minWidth: 0, maxWidth: '100%'
        }}>
            <h2 style={{
            margin: 0, minWidth: 0,
            fontSize: 18, fontWeight: 600, color: theme.text,
            letterSpacing: variant.titleSpacing,
            fontFamily: variant.allMono ? variant.mono : 'inherit',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
              {variant.allMono ? '# ' : ''}{title}
            </h2>
            <button
            onClick={() => setEditing(true)}
            title="Edit title"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: theme.textMuted, padding: 4, borderRadius: variant.radiusSm,
              display: 'inline-flex', flexShrink: 0
            }}
            onMouseEnter={(e) => {e.currentTarget.style.color = theme.text;e.currentTarget.style.background = theme.surfaceHover;}}
            onMouseLeave={(e) => {e.currentTarget.style.color = theme.textMuted;e.currentTarget.style.background = 'transparent';}}>
            
              <window.Icons.Pencil size={12} />
            </button>
          </div>
        }

        <div style={{ flex: 1 }} />

        {!editing &&
        <>
            <ViewDropdown value={view} onChange={onViewChange} theme={theme} variant={variant} />
            <button
            onClick={onCopy}
            title="Copy transcript"
            style={{
              background: copied ? theme.accentSoft : 'transparent',
              border: `1px solid ${copied ? theme.accentLine : theme.border}`,
              color: copied ? theme.accent : theme.textDim,
              cursor: 'pointer',
              padding: '4px 8px', borderRadius: variant.radiusSm,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11,
              fontFamily: variant.allMono ? variant.mono : 'inherit'
            }}
            onMouseEnter={(e) => {if (!copied) {e.currentTarget.style.color = theme.text;e.currentTarget.style.borderColor = theme.borderStrong;}}}
            onMouseLeave={(e) => {if (!copied) {e.currentTarget.style.color = theme.textDim;e.currentTarget.style.borderColor = theme.border;}}}>
            
              {copied ? <window.Icons.Check size={11} /> : <window.Icons.Copy size={11} />}
              {copied ? variant.allMono ? 'copied' : 'Copied' : variant.allMono ? 'copy' : 'Copy'}
            </button>

            <span style={{ width: 1, height: 18, background: theme.border, margin: '0 2px' }} />

            <button
            title="Archive session (disables on server)"
            onClick={() => onArchive && onArchive()}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              color: theme.textDim,
              cursor: 'pointer',
              padding: '4px 7px', borderRadius: variant.radiusSm,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11,
              fontFamily: variant.allMono ? variant.mono : 'inherit'
            }}
            onMouseEnter={(e) => {e.currentTarget.style.color = theme.text;e.currentTarget.style.borderColor = theme.borderStrong;}}
            onMouseLeave={(e) => {e.currentTarget.style.color = theme.textDim;e.currentTarget.style.borderColor = theme.border;}}>

              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2.5" width="11" height="2.5" rx=".5" />
                <path d="M2.5 5v6a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5" />
                <path d="M5.5 7.5h3" />
              </svg>
              {variant.allMono ? 'archive' : 'Archive'}
            </button>

            <button
            title="Delete session"
            onClick={() => {
              if (!onDelete) return;
              if (window.confirm('Delete this session? This removes it from the server and the agent.')) onDelete();
            }}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              color: theme.textDim,
              cursor: 'pointer',
              padding: '4px 7px', borderRadius: variant.radiusSm,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11,
              fontFamily: variant.allMono ? variant.mono : 'inherit'
            }}
            onMouseEnter={(e) => {e.currentTarget.style.color = theme.status.failed;e.currentTarget.style.borderColor = `${theme.status.failed}55`;}}
            onMouseLeave={(e) => {e.currentTarget.style.color = theme.textDim;e.currentTarget.style.borderColor = theme.border;}}>

              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h10M5.5 4V2.5h3V4" />
                <path d="M3.5 4v7a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V4" />
                <path d="M6 6.5v4M8 6.5v4" />
              </svg>
              {variant.allMono ? 'delete' : 'Delete'}
            </button>
          </>
        }
        {editing &&
        <button
          onClick={commit}
          title="Save title"
          style={{
            background: theme.accentSoft,
            border: `1px solid ${theme.accentLine}`,
            color: theme.accent,
            cursor: 'pointer',
            padding: '4px 8px', borderRadius: variant.radiusSm,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11,
            fontFamily: variant.allMono ? variant.mono : 'inherit'
          }}>
          
            <window.Icons.Check size={11} />
            {variant.allMono ? 'save' : 'Save'}
          </button>
        }
      </div>);

  }

  function ChatLog({ messages, theme, variant, bubble, density, sessionTitle, session, onRename, onArchive, onDelete }) {
    const scrollRef = useRef(null);
    const [view, setView] = useState('transcript');
    const [copied, setCopied] = useState(false);
    const copyTimer = useRef(null);

    useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages.length, view]);

    const visible = messages.filter((m) => !m.placeholder);

    function copyTranscript() {
      let txt;
      if (view === 'json') txt = JSON.stringify(visible, null, 2);else
      if (view === 'jsonl') txt = visible.map((m) => JSON.stringify(m)).join('\n');else
      txt = toPlainText(visible, sessionTitle);
      try {
        navigator.clipboard && navigator.clipboard.writeText(txt);
      } catch (e) {}
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    }

    function renderBody() {
      if (view === 'json' || view === 'jsonl') {
        const text = view === 'jsonl' ?
        visible.map((m) => JSON.stringify(m)).join('\n') :
        JSON.stringify(visible, null, 2);
        return (
          <pre style={{
            margin: 0,
            padding: '0 28px 28px',
            fontSize: 11.5, fontFamily: variant.mono,
            color: theme.text, lineHeight: 1.55,
            whiteSpace: view === 'jsonl' ? 'pre' : 'pre',
            overflow: 'auto'
          }}>
            <code>{text}</code>
          </pre>);

      }
      if (view === 'flat') {
        return (
          <pre style={{
            margin: 0,
            padding: '0 28px 28px',
            fontSize: 13, fontFamily: variant.font,
            color: theme.text, lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            letterSpacing: variant.letterSpacing,
            maxWidth: bubble ? 760 : 'none',
            marginInline: bubble ? 'auto' : 0
          }}>{toPlainText(visible, sessionTitle)}</pre>);

      }
      const filtered = view === 'conversation' ?
      visible.filter((m) => m.kind === 'text' || m.kind === 'attachment') :
      visible;
      return (
        <div style={{
          maxWidth: bubble ? 760 : 'none',
          margin: bubble ? '0 auto' : 0,
          display: 'flex', flexDirection: 'column', gap: 2,
          padding: '0 28px'
        }}>
          {filtered.map((m, i) =>
          <ChatMessage
            key={i} msg={m}
            theme={theme} variant={variant}
            bubble={bubble} density={density}
            session={session}
            prevRole={i > 0 ? filtered[i - 1].role : null} />
          )}
        </div>);

    }

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Frozen session title header */}
        <SessionTitleBar
          sessionTitle={sessionTitle}
          theme={theme} variant={variant}
          view={view} onViewChange={setView}
          onCopy={copyTranscript} copied={copied}
          onRename={onRename}
          onArchive={onArchive}
          onDelete={onDelete} />
        

        {/* Scrollable messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: 'auto',
          paddingTop: 16
        }}>
          {renderBody()}
        </div>
      </div>);
  }

  window.ChatLog = ChatLog;
})();