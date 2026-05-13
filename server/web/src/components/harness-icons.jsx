// Minimal stroke icons for the harness. All 14×14 viewBox by default,
// stroked with currentColor. Pass size + color via props.
// In "Console" variant we substitute icons with ASCII glyphs.

(function () {
  const svg = (path, vb = '0 0 14 14') => ({ size = 14, ascii, asciiVariant, ...rest }) => {
    if (asciiVariant && ascii) {
      return <span style={{ fontFamily: 'inherit', display: 'inline-block', width: size, textAlign: 'center', fontSize: size - 1, lineHeight: 1 }}>{ascii}</span>;
    }
    return (
      <svg width={size} height={size} viewBox={vb} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>
        {path}
      </svg>
    );
  };

  window.Icons = {
    Server: svg(<><rect x="2" y="2.5" width="10" height="3.5" rx="1" /><rect x="2" y="8" width="10" height="3.5" rx="1" /><circle cx="4" cy="4.25" r=".55" fill="currentColor" stroke="none" /><circle cx="4" cy="9.75" r=".55" fill="currentColor" stroke="none" /></>),
    Chat: svg(<><path d="M2 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6l-3 2.5V10H4a2 2 0 0 1-2-2V5z" /></>),
    Folder: svg(<><path d="M1.5 4a1 1 0 0 1 1-1H5l1.5 1.5h5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4z" /></>),
    Chevron: svg(<><path d="M5 3.5 8.5 7 5 10.5" /></>),
    ChevronDown: svg(<><path d="M3.5 5 7 8.5 10.5 5" /></>),
    Settings: svg(<><circle cx="7" cy="7" r="2" /><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.76 2.76l1.06 1.06M10.18 10.18l1.06 1.06M2.76 11.24l1.06-1.06M10.18 3.82l1.06-1.06" /></>),
    Sun: svg(<><circle cx="7" cy="7" r="2.5" /><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.76 2.76l1.06 1.06M10.18 10.18l1.06 1.06M2.76 11.24l1.06-1.06M10.18 3.82l1.06-1.06" /></>),
    Moon: svg(<><path d="M11.5 7.8A5 5 0 1 1 6.2 2.5a4 4 0 0 0 5.3 5.3z" /></>),
    Plus: svg(<><path d="M7 2.5v9M2.5 7h9" /></>),
    Search: svg(<><circle cx="6" cy="6" r="3.5" /><path d="m9 9 2.5 2.5" /></>),
    Send: svg(<><path d="m2 7 10-4.5L9.5 12 7 8 2 7z" /></>),
    Paperclip: svg(<><path d="M11 6.5 6.8 10.7a2.5 2.5 0 0 1-3.5-3.5L7.7 2.8a1.7 1.7 0 0 1 2.4 2.4L5.7 9.6a.9.9 0 0 1-1.2-1.2L8 5" /></>),
    Mic: svg(<><rect x="5" y="2" width="4" height="7" rx="2" /><path d="M3 7a4 4 0 0 0 8 0M7 11v2" /></>),
    Slash: svg(<><path d="M9 2.5 5 11.5" /></>),
    Dot: ({ size = 6, color = 'currentColor' }) => <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />,
    Brain: svg(<><path d="M5.5 2.5A1.5 1.5 0 0 0 4 4v.5A1.5 1.5 0 0 0 2.5 6v1A1.5 1.5 0 0 0 4 8.5V9a1.5 1.5 0 0 0 1.5 1.5h0V2.5zM8.5 2.5h0A1.5 1.5 0 0 1 10 4v.5A1.5 1.5 0 0 1 11.5 6v1A1.5 1.5 0 0 1 10 8.5V9a1.5 1.5 0 0 1-1.5 1.5" /></>),
    Wrench: svg(<><path d="M9.5 2 7 4.5l2 2L11.5 4a3 3 0 0 1-4.4 3.9L3 12 2 11l4.1-4.1A3 3 0 0 1 9.5 2z" /></>),
    File: svg(<><path d="M3 1.5h5L11 4.5V12a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 3 12V2a.5.5 0 0 1 .5-.5z M8 1.5V4a.5.5 0 0 0 .5.5H11" /></>),
    Image: svg(<><rect x="1.5" y="2.5" width="11" height="9" rx="1" /><circle cx="5" cy="5.5" r=".75" fill="currentColor" stroke="none" /><path d="m1.5 9 3-2.5 4 3.5 1.5-1 2.5 2.5" /></>),
    Check: svg(<><path d="m2.5 7.5 2.5 2.5L11.5 4" /></>),
    X: svg(<><path d="m3 3 8 8M11 3l-8 8" /></>),
    Refresh: svg(<><path d="M11.5 3v3h-3M2.5 11V8h3M3 7a4 4 0 0 1 7.3-2.3L11.5 6M11 7a4 4 0 0 1-7.3 2.3L2.5 8" /></>),
    Branch: svg(<><circle cx="3.5" cy="3" r="1.2" /><circle cx="3.5" cy="11" r="1.2" /><circle cx="10.5" cy="6" r="1.2" /><path d="M3.5 4.2v5.6M3.5 7c0-1.5 1-2 2.5-2h2.8" /></>),
    Lightning: svg(<><path d="M7.5 1.5 3 8h3.5L5.5 12.5 10 6H6.5l1-4.5z" /></>),
    Grid: svg(<><rect x="2" y="2" width="3.5" height="3.5" rx=".5" /><rect x="8.5" y="2" width="3.5" height="3.5" rx=".5" /><rect x="2" y="8.5" width="3.5" height="3.5" rx=".5" /><rect x="8.5" y="8.5" width="3.5" height="3.5" rx=".5" /></>),
    Sidebar: svg(<><rect x="1.5" y="2.5" width="11" height="9" rx="1" /><path d="M5 2.5v9" /></>),
    Stop: svg(<><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" /></>),
    Pencil: svg(<><path d="M2.5 11.5 4 8l5.5-5.5 2 2L6 10l-3.5 1.5z" /><path d="M8 3.5l2 2" /></>),
    Copy: svg(<><rect x="4" y="4" width="7.5" height="7.5" rx="1" /><path d="M9.5 4V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h1" /></>),
    Eye: svg(<><path d="M1.5 7s2-3.5 5.5-3.5S12.5 7 12.5 7s-2 3.5-5.5 3.5S1.5 7 1.5 7z" /><circle cx="7" cy="7" r="1.5" /></>),
    Sparkle: svg(<><path d="M7 2v3M7 9v3M2 7h3M9 7h3M3.5 3.5l2 2M8.5 8.5l2 2M3.5 10.5l2-2M8.5 5.5l2-2" /></>),
  };
})();
