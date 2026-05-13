// Provider icon badges with logo marks.
// Anthropic gets the asterisk mark; others use letter monograms (placeholders
// until proper marks land).

(function () {
  const PROVIDER_META = {
    claude: { letter: 'A', color: '#cc785c', label: 'Anthropic', mark: 'asterisk' },
    codex:  { letter: 'O', color: '#10a37f', label: 'OpenAI' },
    gemini: { letter: 'G', color: '#4285f4', label: 'Google' },
  };

  function AnthropicMark({ size = 12, color = '#fff' }) {
    // Three rounded rect spokes rotated to form a 6-pointed asterisk burst.
    return (
      <svg
        width={size} height={size}
        viewBox="0 0 24 24"
        style={{ display: 'block' }}
      >
        <g fill={color}>
          <rect x="10.7" y="2.5" width="2.6" height="19" rx="1.3" />
          <rect x="10.7" y="2.5" width="2.6" height="19" rx="1.3" transform="rotate(60 12 12)" />
          <rect x="10.7" y="2.5" width="2.6" height="19" rx="1.3" transform="rotate(120 12 12)" />
        </g>
      </svg>
    );
  }

  function ProviderIcon({ provider, size = 12, theme, variant, square }) {
    const meta = PROVIDER_META[provider] || { letter: '?', color: theme.textMuted, label: provider };
    const radius = variant && variant.allMono ? 0 : Math.max(2, Math.round(size / 4));
    return (
      <span
        title={meta.label}
        style={{
          width: size, height: size,
          borderRadius: square ? radius : '50%',
          background: meta.color,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
          fontSize: Math.round(size * 0.62),
          fontWeight: 700,
          fontFamily: '"Inter", system-ui, sans-serif',
          flexShrink: 0,
          letterSpacing: 0,
          lineHeight: 1,
        }}
      >
        {meta.mark === 'asterisk'
          ? <AnthropicMark size={Math.round(size * 0.7)} color="#fff" />
          : meta.letter}
      </span>
    );
  }

  window.ProviderIcon = ProviderIcon;
  window.PROVIDER_META = PROVIDER_META;
})();
