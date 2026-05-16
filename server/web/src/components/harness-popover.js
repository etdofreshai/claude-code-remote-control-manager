// Shared popover-placement helper. Looks at how much room sits above vs
// below a trigger element and returns the direction the popover should
// open plus the max-height it can use without spilling off-screen. The
// caller spreads the resulting positioning into the popover's style and
// applies overflow-y:auto so long lists scroll internally.
//
// Caller passes the trigger's anchor element — usually the
// `position: relative` wrapper that contains both the trigger button and
// the popover. Its viewport rect is what we measure.
//
// `preferred` biases the choice when both sides fit: 'up', 'down', or
// 'auto' (default — prefer down if it fits, else flip).

(function () {
  const { useState, useEffect } = React;

  function placePopover(anchor, opts) {
    const { preferred = 'auto', minComfortable = 160, max = 320, margin = 8 } = opts || {};
    if (!anchor) return { dir: 'down', maxHeight: max };
    const rect = anchor.getBoundingClientRect();
    const above = Math.max(0, rect.top - margin);
    const below = Math.max(0, window.innerHeight - rect.bottom - margin);
    let dir;
    if (preferred === 'up') {
      dir = above >= minComfortable || above >= below ? 'up' : 'down';
    } else if (preferred === 'down') {
      dir = below >= minComfortable || below >= above ? 'down' : 'up';
    } else {
      dir = below >= minComfortable ? 'down' : (above > below ? 'up' : 'down');
    }
    const maxHeight = Math.max(120, Math.min(max, dir === 'up' ? above : below));
    return { dir, maxHeight };
  }

  // React hook: re-measure on `open` going truthy, on window resize, and on
  // scroll (in case a parent scrolled the trigger). Returns positioning
  // ready to spread into the popover's style.
  function usePopoverPlacement(open, anchorRef, opts) {
    const [pos, setPos] = useState(() => placePopover(null, opts));
    useEffect(() => {
      if (!open) return;
      const recalc = () => setPos(placePopover(anchorRef.current, opts));
      recalc();
      window.addEventListener('resize', recalc);
      window.addEventListener('scroll', recalc, true); // capture nested scrollers
      return () => {
        window.removeEventListener('resize', recalc);
        window.removeEventListener('scroll', recalc, true);
      };
      // We intentionally don't re-run on opts changes — callers should pass
      // a stable opts object or accept the initial preference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    return pos;
  }

  // Convenience: build the style fragment from a `{dir, maxHeight}` result.
  function popoverStyle(pos, gap) {
    const g = gap == null ? 6 : gap;
    return pos.dir === 'up'
      ? { bottom: '100%', marginBottom: g, maxHeight: pos.maxHeight, overflowY: 'auto' }
      : { top: '100%', marginTop: g, maxHeight: pos.maxHeight, overflowY: 'auto' };
  }

  window.HarnessPopover = { placePopover, usePopoverPlacement, popoverStyle };
})();
