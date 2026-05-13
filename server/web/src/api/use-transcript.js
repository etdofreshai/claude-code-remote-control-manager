// Fetches a paginated, role-filterable, in-session-searchable transcript for
// one session. The latest page is loaded on mount; `loadMore()` prepends an
// older page; a 5 s poll fetches the newest page so new messages from the
// agent stream in without manual refresh.

import { apiFetch } from './client.js';

const { useState, useEffect, useRef, useCallback } = React;

const PAGE_LIMIT = 50;
const POLL_MS = 5000;

function buildUrl(clientName, sessionId, { cursor, limit, roles, search }) {
  const params = new URLSearchParams();
  params.set('cursor', String(cursor ?? 0));
  params.set('limit', String(limit ?? PAGE_LIMIT));
  if (roles && roles.length) params.set('role', roles.join(','));
  if (search) params.set('search', search);
  return `/api/clients/${encodeURIComponent(clientName)}/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`;
}

export function useTranscript(clientName, sessionId, { roles, search } = {}) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const rolesKey = roles ? roles.slice().sort().join(',') : '';

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Initial load (and reload when session/filter changes).
  useEffect(() => {
    if (!clientName || !sessionId) {
      setMessages([]); setHasMore(false); setTotal(0); setCursor(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch(buildUrl(clientName, sessionId, { cursor: 0, roles, search }))
      .then((r) => {
        if (cancelled || !aliveRef.current) return;
        setMessages(r.messages || []);
        setHasMore(!!r.hasMore);
        setTotal(r.total || 0);
        setCursor(r.cursor || 0);
        setError(null);
      })
      .catch((err) => {
        if (cancelled || !aliveRef.current) return;
        setError(err);
        setMessages([]);
      })
      .finally(() => {
        if (!cancelled && aliveRef.current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [clientName, sessionId, rolesKey, search]);

  // Polling: refetch the newest page; if `total` grew, replace the latest
  // chunk in our list. We deliberately don't try to merge byte-for-byte —
  // for a chat-style UI, just refreshing the tail keeps things simple and
  // reliable.
  useEffect(() => {
    if (!clientName || !sessionId) return;
    const id = setInterval(async () => {
      try {
        const r = await apiFetch(buildUrl(clientName, sessionId, { cursor: 0, roles, search }));
        if (!aliveRef.current) return;
        if ((r.total || 0) !== total) {
          setTotal(r.total || 0);
          setHasMore(!!r.hasMore);
          // Replace the latest page; keep any older pages already loaded.
          setMessages((prev) => {
            const olderCount = Math.max(0, prev.length - (r.messages?.length || 0));
            const older = prev.slice(0, olderCount);
            return [...older, ...(r.messages || [])];
          });
          setCursor(r.cursor || 0);
        }
      } catch {
        // ignore transient errors; next tick will retry
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [clientName, sessionId, rolesKey, search, total]);

  const loadMore = useCallback(async () => {
    if (!clientName || !sessionId || loading || !hasMore) return;
    setLoading(true);
    try {
      const r = await apiFetch(buildUrl(clientName, sessionId, { cursor, roles, search }));
      if (!aliveRef.current) return;
      setMessages((prev) => [...(r.messages || []), ...prev]);
      setHasMore(!!r.hasMore);
      setTotal(r.total || 0);
      setCursor(r.cursor || 0);
    } catch (err) {
      setError(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [clientName, sessionId, cursor, rolesKey, search, hasMore, loading]);

  return { messages, hasMore, total, loading, error, loadMore };
}
