// Per-provider / per-model enable map, persisted to localStorage.
// Default is "everything enabled" — entries only exist for the ones the user
// has explicitly turned off. Pickers and Settings → Providers consult this
// to decide what to show.
//
// Keys:
//   <providerId>                — false hides the whole provider
//   <providerId>/<modelId>      — false hides one model within a provider
//
// React consumers subscribe via useEnabledMap() so toggling in Settings
// updates the pickers without a full reload.

(function () {
  const { useState, useEffect } = React;

  const STORAGE_KEY = 'hrn:enabledMap';
  const listeners = new Set();

  function load() {
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function save(map) {
    try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
    for (const fn of listeners) {
      try { fn(map); } catch {}
    }
  }

  function isProviderEnabled(map, providerId) {
    return map[providerId] !== false;
  }

  function isModelEnabled(map, providerId, modelId) {
    if (map[providerId] === false) return false;
    if (map[`${providerId}/${modelId}`] === false) return false;
    return true;
  }

  function setProvider(providerId, enabled) {
    const cur = load();
    if (enabled) delete cur[providerId];
    else cur[providerId] = false;
    save(cur);
  }

  function setModel(providerId, modelId, enabled) {
    const cur = load();
    const k = `${providerId}/${modelId}`;
    if (enabled) delete cur[k];
    else cur[k] = false;
    save(cur);
  }

  function useEnabledMap() {
    const [map, setMap] = useState(load);
    useEffect(() => {
      const fn = (next) => setMap(next);
      listeners.add(fn);
      // Cross-tab — localStorage changes from other windows fire a 'storage'
      // event; in-page changes don't, hence the listener Set above.
      const onStorage = (e) => { if (e.key === STORAGE_KEY) setMap(load()); };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(fn);
        window.removeEventListener('storage', onStorage);
      };
    }, []);
    return map;
  }

  // Convenience: take a providers object ({pId: {label, models}}) and strip
  // disabled providers + disabled models. Returns a new object; doesn't
  // mutate the input.
  function filterProviders(providers, map) {
    if (!providers) return {};
    const out = {};
    for (const [pId, p] of Object.entries(providers)) {
      if (!isProviderEnabled(map, pId)) continue;
      const models = (p.models || []).filter((m) => isModelEnabled(map, pId, m));
      if (!models.length) continue;
      out[pId] = { ...p, models };
    }
    return out;
  }

  window.HarnessEnabled = {
    load, save,
    isProviderEnabled, isModelEnabled,
    setProvider, setModel,
    useEnabledMap,
    filterProviders,
  };
})();
