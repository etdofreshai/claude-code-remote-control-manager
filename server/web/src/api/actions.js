// Thin wrappers around the session/agent endpoints. Each function returns
// the parsed JSON response (or null for 204). Pass `refresh` to opt into an
// immediate refetch of useHarnessData after a successful mutation so the UI
// updates without waiting for the 10 s polling tick.

import { apiFetch } from './client.js';

export function makeActions({ refresh } = {}) {
  function after(promise) {
    return promise.then(
      (r) => { refresh && refresh(); return r; },
      (e) => { refresh && refresh(); throw e; },
    );
  }

  return {
    sendMessage(clientName, sessionId, text) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/message`,
        { method: 'POST', body: { text } },
      ));
    },

    sendContent(clientName, sessionId, content) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/message`,
        { method: 'POST', body: { content } },
      ));
    },

    setEnabled(clientName, sessionId, enabled) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/enabled`,
        { method: 'POST', body: { enabled: !!enabled } },
      ));
    },

    refreshSession(clientName, sessionId) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/refresh`,
        { method: 'POST' },
      ));
    },

    rename(clientName, sessionId, name) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/rename`,
        { method: 'POST', body: { name } },
      ));
    },

    switchSession(clientName, sessionId, { provider, model, effort } = {}) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/switch`,
        { method: 'POST', body: { provider, model, effort } },
      ));
    },

    deleteSession(clientName, sessionId) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      ));
    },

    createSession(clientName, { workingDirectory, name, provider, model, effort, text }) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/new`,
        { method: 'POST', body: { workingDirectory, name, provider, model, effort, text } },
      ));
    },

    bindSession(clientName, { workingDirectory, sessionId, name, provider, model, effort }) {
      return after(apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/sessions/bind`,
        { method: 'POST', body: { workingDirectory, sessionId, name, provider, model, effort } },
      ));
    },

    listAgentSessions(clientName, { workingDirectory, page, pageSize, query } = {}) {
      return apiFetch(
        `/api/clients/${encodeURIComponent(clientName)}/list`,
        { method: 'POST', body: { workingDirectory, page, pageSize, query } },
      );
    },

    // Ask any (or a specific) online client to re-poll its upstream APIs for
    // current model lists. Server merges results into the client's in-memory
    // provider config and re-registers — the next /api/clients tick (and
    // the immediate refresh below) will show the new list.
    pollModels(clientName) {
      return after(apiFetch(
        '/api/clients/poll-models',
        { method: 'POST', body: clientName ? { name: clientName } : {} },
      ));
    },
  };
}
