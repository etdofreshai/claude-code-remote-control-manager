const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let selected = null;
let lastFillKey = null;
let lastClients = [];

// TODO(future): drop the "provider" concept from the UI entirely and
// expose a single flat model picker — opus / sonnet / haiku / glm /
// codex (and whatever else lands later). The provider→model nesting
// is plumbing that doesn't pay for itself in the UI; callers just want
// to pick a model and go. When we do this, the spawn payload still
// passes a model name, and resolveEndpoint() infers the provider from
// the model identifier.

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(`ccrcm_${key}`);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, val) {
  try {
    if (val) localStorage.setItem(`ccrcm_${key}`, val);
    else localStorage.removeItem(`ccrcm_${key}`);
  } catch {
    /* ignore */
  }
}

let sortPrimary = loadPref("sortPrimary", "lastMessage");
let sortSecondary = loadPref("sortSecondary", "");
let groupBy = loadPref("groupBy", "");

function getToken() {
  return localStorage.getItem("ccrcm_token");
}

if (!getToken()) {
  location.replace("/login");
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.body != null) headers["content-type"] = "application/json";
  const tok = getToken();
  if (tok) headers["authorization"] = `Bearer ${tok}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem("ccrcm_token");
    location.replace("/login");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  // Fallback for non-HTTPS / older browsers.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    return true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

function flashCopied(el, originalContent) {
  const original = originalContent ?? el.textContent;
  el.textContent = "✓ copied";
  el.classList.add("copied-flash");
  setTimeout(() => {
    el.textContent = original;
    el.classList.remove("copied-flash");
  }, 900);
}

function resolveSessionEndpoint(clientName, providerName, modelName) {
  const c = (lastClients ?? []).find((x) => x.name === clientName);
  const p = c?.providers?.[providerName];
  if (!p) return {};
  const ov = modelName ? p.modelOverrides?.[modelName] : undefined;
  return {
    baseUrl: ov?.baseUrl ?? p.baseUrl,
    authToken: ov?.authToken ?? p.authToken,
  };
}

/**
 * Build a paste-and-run shell snippet that resumes this session locally,
 * mirroring the env we'd spawn here. Auth token is intentionally a
 * placeholder — sensitive value never leaves the client.
 */
function buildResumeCommand(s) {
  const args = ["claude", "--resume", s.sessionId];
  if (s.workingDirectory) args.push("--add-dir", JSON.stringify(s.workingDirectory));
  if (s.effort) args.push("--effort", s.effort);
  args.push("--remote-control");
  const cmd = args.join(" ");

  const lines = [];
  if (s.provider) lines.push(`# provider: ${s.provider}`);
  if (s.model) lines.push(`# model:    ${s.model}`);

  const { baseUrl, authToken } = resolveSessionEndpoint(selected, s.provider, s.model);
  if (baseUrl) {
    lines.push(`export ANTHROPIC_BASE_URL=${JSON.stringify(baseUrl)}`);
    lines.push(
      `export ANTHROPIC_AUTH_TOKEN=${JSON.stringify(authToken ?? "<your-token>")}`,
    );
    if (s.model) {
      lines.push(`export ANTHROPIC_DEFAULT_HAIKU_MODEL=${JSON.stringify(s.model)}`);
      lines.push(`export ANTHROPIC_DEFAULT_SONNET_MODEL=${JSON.stringify(s.model)}`);
      lines.push(`export ANTHROPIC_DEFAULT_OPUS_MODEL=${JSON.stringify(s.model)}`);
    }
    lines.push(`export CLAUDE_CODE_DISABLE_1M_CONTEXT=1`);
  }

  if (s.workingDirectory) lines.push(`cd ${JSON.stringify(s.workingDirectory)}`);
  lines.push(cmd);
  return lines.join("\n");
}

function showResult(text) {
  const el = $("#result");
  el.textContent = text;
  el.classList.remove("hidden");
}

async function loadClients() {
  const list = await api("/api/clients");
  lastClients = list;
  const ul = $("#clients");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = "<li class=empty>No clients connected.</li>";
    return;
  }
  for (const c of list) {
    const li = document.createElement("li");
    li.className = c.name === selected ? "active" : "";
    const prefixLabel = c.prefix ? `<small>prefix: <code>${c.prefix.replace(/</g, "&lt;").replace(/ /g, "·")}</code></small>` : "<small><em>no prefix</em></small>";
    li.innerHTML = `<span><span class="dot ${c.online ? "up" : "down"}"></span>${c.name}<br><small>${c.hostname ?? ""} · ${c.sessions?.length ?? 0} sessions</small><br>${prefixLabel}</span>`;
    li.onclick = () => {
      selected = c.name;
      renderSessions(c);
      loadClients();
    };
    const editPrefixBtn = document.createElement("button");
    editPrefixBtn.textContent = "✎";
    editPrefixBtn.title = "Edit prefix";
    editPrefixBtn.className = "btn-secondary btn-inline";
    editPrefixBtn.onclick = async (e) => {
      e.stopPropagation();
      const next = prompt(
        `Set name prefix for "${c.name}" (e.g. "🐧 "). Whitespace is preserved exactly:`,
        c.prefix ?? "",
      );
      if (next === null) return;
      try {
        await api(`/api/clients/${encodeURIComponent(c.name)}/prefix`, {
          method: "POST",
          body: JSON.stringify({ prefix: next }),
        });
        loadClients();
      } catch (err) {
        alert(String(err));
      }
    };
    li.appendChild(editPrefixBtn);
    ul.appendChild(li);
    if (selected === c.name) renderSessions(c);
  }
  if (!selected && list[0]) {
    selected = list[0].name;
    renderSessions(list[0]);
    loadClients();
  }
}

function renderSessions(c) {
  $("#selected-name").textContent = c ? `· ${c.name}` : "";
  const def = c?.defaultWorkingDirectory ?? "";
  for (const inp of document.querySelectorAll('input[name="workingDirectory"]')) {
    inp.placeholder = def || "/home/node/workspace/repos/foo";
  }
  // Refill when client changes OR when this client's default arrives later
  // (server may not have it yet right after a restart, before the next
  // register tick from the client).
  const prefix = c?.prefix ?? "";
  const providersKey = JSON.stringify(c?.providers ?? null);
  const fillKey = c ? `${c.name}|${def}|${prefix}|${providersKey}|${c?.defaultProvider}|${c?.defaultEffort}` : null;
  if (c && lastFillKey !== fillKey) {
    populateProviderSelects(c);
    if (def) {
      for (const inp of document.querySelectorAll('input[name="workingDirectory"]')) {
        inp.value = def;
      }
    }
    const newNameInput = $("#new-form input[name='name']");
    if (newNameInput && (newNameInput.value === "" || newNameInput.value === (lastClients.find((x) => x.name === lastFillKey?.split("|")[0])?.prefix ?? ""))) {
      newNameInput.value = prefix;
    }
    lastFillKey = fillKey;
  }
  const ul = $("#sessions");
  ul.innerHTML = "";
  const sessions = (c?.sessions ?? []).slice();
  if (!sessions.length) {
    ul.innerHTML = "<li class=empty>No remote sessions yet.</li>";
    return;
  }
  applySort(sessions, sortPrimary, sortSecondary);
  const groups = groupBy ? groupSessions(sessions, groupBy) : [{ key: "", items: sessions }];
  for (const g of groups) {
    if (g.key) {
      const heading = document.createElement("li");
      heading.className = "group-heading";
      heading.textContent = g.label ?? g.key;
      ul.appendChild(heading);
    }
    for (const s of g.items) {
      renderSessionRow(ul, s);
    }
  }
}

const SORT_KEYS = {
  lastMessage: (s) => s.lastMessageAt ?? s.addedAt ?? "",
  name: (s) => (s.name ?? "").toLowerCase(),
  enabled: (s) => (s.enabled === false ? 1 : 0), // enabled (0) sorts first
  model: (s) => (s.model ?? "").toLowerCase(),
  provider: (s) => (s.provider ?? "").toLowerCase(),
};
function cmpFor(key) {
  const fn = SORT_KEYS[key];
  if (!fn) return () => 0;
  // For lastMessage we want descending; everything else ascending.
  const dir = key === "lastMessage" ? -1 : 1;
  return (a, b) => {
    const av = fn(a);
    const bv = fn(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  };
}
function applySort(arr, primary, secondary) {
  const a = cmpFor(primary);
  const b = secondary ? cmpFor(secondary) : null;
  arr.sort((x, y) => a(x, y) || (b ? b(x, y) : 0));
}
function groupSessions(arr, key) {
  const map = new Map();
  for (const s of arr) {
    let k;
    let label;
    if (key === "enabled") {
      k = s.enabled === false ? "disabled" : "enabled";
      label = k === "enabled" ? "● Enabled" : "○ Disabled";
    } else if (key === "model") {
      k = s.model ?? "(no model)";
      label = `Model: ${k}`;
    } else if (key === "provider") {
      k = s.provider ?? "(no provider)";
      label = `Provider: ${k}`;
    } else {
      k = "";
      label = "";
    }
    if (!map.has(k)) map.set(k, { key: k, label, items: [] });
    map.get(k).items.push(s);
  }
  return [...map.values()];
}

function renderSessionRow(ul, s) {
  for (const _unused of [0]) {
    const li = document.createElement("li");

    const left = document.createElement("span");
    left.className = "session-meta";

    if (s.name) {
      const titleEl = document.createElement("strong");
      titleEl.textContent = s.name;
      titleEl.className = "copyable";
      titleEl.title = "Click to copy title";
      titleEl.onclick = async (e) => {
        e.stopPropagation();
        if (await copyToClipboard(s.name)) flashCopied(titleEl, s.name);
      };
      left.appendChild(titleEl);
      left.appendChild(document.createElement("br"));
    }

    const idEl = document.createElement("code");
    idEl.textContent = s.sessionId;
    idEl.className = "copyable";
    idEl.title = "Click to copy session id";
    idEl.onclick = async (e) => {
      e.stopPropagation();
      if (await copyToClipboard(s.sessionId)) flashCopied(idEl, s.sessionId);
    };
    left.appendChild(idEl);
    left.appendChild(document.createElement("br"));

    const wdEl = document.createElement("small");
    wdEl.textContent = s.workingDirectory;
    left.appendChild(wdEl);

    const providerBits = [s.provider, s.model, s.effort && `effort:${s.effort}`]
      .filter(Boolean)
      .join(" · ");
    if (providerBits) {
      left.appendChild(document.createElement("br"));
      const provEl = document.createElement("small");
      provEl.textContent = providerBits;
      left.appendChild(provEl);
    }

    left.appendChild(document.createElement("br"));
    const statusEl = document.createElement("small");
    statusEl.textContent = `${s.status ?? "—"} · last ${fmtTime(s.lastMessageAt)}`;
    left.appendChild(statusEl);

    li.appendChild(left);

    const btns = document.createElement("div");
    btns.className = "btn-stack";

    const isDisabled = s.enabled === false;
    if (isDisabled) li.classList.add("session-disabled");

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = isDisabled ? "Enable" : "Disable";
    toggleBtn.className = isDisabled ? "btn-primary" : "btn-secondary";
    toggleBtn.title = isDisabled
      ? "Resume this session and re-attach remote control"
      : "Stop the running query but keep the entry in the list";
    toggleBtn.onclick = async (e) => {
      e.stopPropagation();
      toggleBtn.disabled = true;
      try {
        const r = await api(
          `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(s.sessionId)}/enabled`,
          { method: "POST", body: JSON.stringify({ enabled: isDisabled }) },
        );
        showResult(JSON.stringify(r, null, 2));
        loadClients();
      } catch (err) {
        showResult(String(err));
      } finally {
        toggleBtn.disabled = false;
      }
    };

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.className = "btn-secondary";
    refreshBtn.title = "Reload session state from disk (use after editing from another client)";
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      refreshBtn.disabled = true;
      try {
        const r = await api(
          `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(s.sessionId)}/refresh`,
          { method: "POST" },
        );
        showResult(JSON.stringify(r, null, 2));
        loadClients();
      } catch (err) {
        showResult(String(err));
      } finally {
        refreshBtn.disabled = false;
      }
    };

    const copyResumeBtn = document.createElement("button");
    copyResumeBtn.textContent = "Copy Resume";
    copyResumeBtn.className = "btn-secondary";
    copyResumeBtn.title = "Copy a `claude --resume` command-line for this session";
    copyResumeBtn.onclick = async (e) => {
      e.stopPropagation();
      const cmd = buildResumeCommand(s);
      if (await copyToClipboard(cmd)) {
        flashCopied(copyResumeBtn, "Copy Resume");
      }
    };

    const renameBtn = document.createElement("button");
    renameBtn.textContent = "Rename";
    renameBtn.className = "btn-secondary";
    renameBtn.onclick = async (e) => {
      e.stopPropagation();
      const newName = promptWithPrefix(
        "Rename session (leave blank to let Claude auto-name it):",
        s.name,
      );
      if (newName === null) return;
      renameBtn.disabled = true;
      try {
        const r = await api(
          `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(s.sessionId)}/rename`,
          { method: "POST", body: JSON.stringify({ name: newName }) },
        );
        showResult(JSON.stringify(r, null, 2));
        loadClients();
      } catch (err) {
        showResult(String(err));
      } finally {
        renameBtn.disabled = false;
      }
    };

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.className = "btn-danger";
    removeBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove session ${s.sessionId}?`)) return;
      removeBtn.disabled = true;
      try {
        const r = await api(
          `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(s.sessionId)}`,
          { method: "DELETE" },
        );
        showResult(JSON.stringify(r, null, 2));
        loadClients();
      } catch (err) {
        showResult(String(err));
        removeBtn.disabled = false;
      }
    };

    const switchBtn = document.createElement("button");
    switchBtn.textContent = "Switch";
    switchBtn.className = "btn-secondary";
    switchBtn.title = "Change provider/model/effort and respawn this session";
    switchBtn.onclick = (e) => {
      e.stopPropagation();
      openSwitchModal(s);
    };

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Send";
    sendBtn.className = "btn-primary";
    sendBtn.title = "Inject a user message into this session";
    sendBtn.onclick = (e) => {
      e.stopPropagation();
      openSendModal(s);
    };

    // 7 buttons → 2-col grid with one filler so Remove sits bottom-right.
    btns.appendChild(sendBtn);
    btns.appendChild(toggleBtn);
    btns.appendChild(switchBtn);
    btns.appendChild(refreshBtn);
    btns.appendChild(copyResumeBtn);
    btns.appendChild(renameBtn);
    const filler = document.createElement("span");
    filler.style.visibility = "hidden";
    btns.appendChild(filler);
    btns.appendChild(removeBtn);
    li.appendChild(btns);
    ul.appendChild(li);
  }
}

function defaultWorkingDirFor(clientName) {
  const list = lastClients ?? [];
  return list.find((c) => c.name === clientName)?.defaultWorkingDirectory ?? "";
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function populateProviderSelects(c) {
  const providers = c?.providers ?? { claude: { models: [] } };
  const providerNames = Object.keys(providers);
  if (!providerNames.length) providerNames.push("claude");
  const defaultProvider = c?.defaultProvider && providers[c.defaultProvider]
    ? c.defaultProvider
    : providerNames[0];
  const defaultEffort = EFFORTS.includes(c?.defaultEffort) ? c.defaultEffort : "low";

  for (const form of [$("#new-form"), $("#bind-form")]) {
    if (!form) continue;
    const provSel = form.querySelector('select[name="provider"]');
    const modelSel = form.querySelector('select[name="model"]');
    const effortSel = form.querySelector('select[name="effort"]');

    provSel.innerHTML = providerNames
      .map((n) => `<option value="${n}">${n}</option>`)
      .join("");
    provSel.value = defaultProvider;

    effortSel.innerHTML = EFFORTS.map(
      (e) => `<option value="${e}">${e}</option>`,
    ).join("");
    effortSel.value = defaultEffort;

    const refreshModels = () => {
      const p = providers[provSel.value] ?? { models: [] };
      const models = p.models ?? [];
      modelSel.innerHTML =
        `<option value="">(provider default)</option>` +
        models.map((m) => `<option value="${m}">${m}</option>`).join("");
    };
    provSel.onchange = refreshModels;
    refreshModels();
  }
}

function prefixFor(clientName) {
  const list = lastClients ?? [];
  return list.find((c) => c.name === clientName)?.prefix ?? "";
}

function promptWithPrefix(message, currentName) {
  const prefix = prefixFor(selected);
  const seed = currentName != null && currentName !== ""
    ? currentName
    : prefix;
  return prompt(message, seed);
}

async function send(form, route) {
  if (!selected) {
    alert("Select a client first.");
    return;
  }
  const body = Object.fromEntries(new FormData(form));
  if (body.name === "") delete body.name;
  if (body.model === "") delete body.model;
  if (body.provider === "") delete body.provider;
  if (body.effort === "") delete body.effort;
  showResult("…sending");
  try {
    const r = await api(`/api/clients/${encodeURIComponent(selected)}/sessions/${route}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showResult(JSON.stringify(r, null, 2));
    form.reset();
    // Re-fill workingDirectory + provider/model/effort selects + name
    // prefix after reset, so the next submission starts from a sensible
    // default instead of an empty form.
    const def = defaultWorkingDirFor(selected);
    for (const inp of form.querySelectorAll('input[name="workingDirectory"]')) {
      inp.value = def;
    }
    const c = lastClients.find((x) => x.name === selected);
    if (c) populateProviderSelects(c);
    const prefix = prefixFor(selected);
    if (prefix) {
      const nameInput = form.querySelector('input[name="name"]');
      if (nameInput && !nameInput.value) nameInput.value = prefix;
    }
    form.classList.add("hidden");
    loadClients();
  } catch (err) {
    showResult(String(err));
  }
}

function toggleForm(id) {
  const target = $(id);
  for (const f of $$("form.hidden, form")) {
    if (f !== target) f.classList.add("hidden");
  }
  target.classList.toggle("hidden");
}

$("#show-new").addEventListener("click", () => toggleForm("#new-form"));
$("#show-bind").addEventListener("click", () => toggleForm("#bind-form"));
$$("[data-cancel]").forEach((b) =>
  b.addEventListener("click", (e) => e.target.closest("form").classList.add("hidden")),
);
$("#new-form").addEventListener("submit", (e) => {
  e.preventDefault();
  send(e.target, "new");
});
$("#bind-form").addEventListener("submit", (e) => {
  e.preventDefault();
  send(e.target, "bind");
});

let browsePage = 0;
let browseQuery = "";
let browseSearchTimer = null;
const PAGE_SIZE = 20;

async function loadBrowsePage() {
  const wd = $("#bind-form input[name='workingDirectory']").value.trim();
  if (!wd) {
    alert("Enter a working directory first.");
    return;
  }
  $("#session-browser-title").textContent = "Loading…";
  $("#session-browser-list").innerHTML = "";
  $("#browse-page-label").textContent = "";
  try {
    const r = await api(`/api/clients/${encodeURIComponent(selected)}/list`, {
      method: "POST",
      body: JSON.stringify({
        workingDirectory: wd,
        page: browsePage,
        pageSize: PAGE_SIZE,
        query: browseQuery || undefined,
      }),
    });
    const total = r.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const matchSuffix = browseQuery ? ` matching "${browseQuery}"` : "";
    $("#session-browser-title").textContent =
      `${total} session${total === 1 ? "" : "s"}${matchSuffix} in ${wd}`;
    const ul = $("#session-browser-list");
    ul.innerHTML = "";
    if (!r.items?.length) {
      ul.innerHTML = "<li class=empty>No sessions found.</li>";
    }
    for (const s of r.items ?? []) {
      const li = document.createElement("li");
      const label = s.title || s.lastText || "(no preview)";
      const left = document.createElement("div");
      left.innerHTML = `<div><strong>${label.replace(/</g, "&lt;")}</strong></div><div><small><code>${s.sessionId}</code> · ${fmtTime(s.lastMessageAt)}</small></div>`;
      left.style.flex = "1";
      left.style.cursor = "pointer";
      left.onclick = () => {
        $("#bind-form input[name='sessionId']").value = s.sessionId;
        $("#session-browser").classList.add("hidden");
        $("#bind-form").requestSubmit();
      };

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.textContent = "Rename";
      renameBtn.className = "btn-secondary btn-inline";
      renameBtn.onclick = async (e) => {
        e.stopPropagation();
        const newName = promptWithPrefix(
          "Rename session (blank = let Claude auto-name):",
          s.title,
        );
        if (newName === null) return;
        renameBtn.disabled = true;
        try {
          await api(
            `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(s.sessionId)}/rename`,
            {
              method: "POST",
              body: JSON.stringify({ name: newName, workingDirectory: wd }),
            },
          );
          loadBrowsePage();
        } catch (err) {
          alert(String(err));
          renameBtn.disabled = false;
        }
      };

      li.style.display = "flex";
      li.style.gap = "8px";
      li.style.alignItems = "flex-start";
      li.appendChild(left);
      li.appendChild(renameBtn);
      ul.appendChild(li);
    }
    $("#browse-page-label").textContent = `Page ${browsePage + 1} / ${totalPages}`;
    $("#browse-prev").disabled = browsePage <= 0;
    $("#browse-next").disabled = browsePage >= totalPages - 1;
  } catch (err) {
    $("#session-browser-title").textContent = String(err);
  }
}

$("#browse-sessions").addEventListener("click", () => {
  browsePage = 0;
  browseQuery = "";
  $("#browse-search").value = "";
  $("#session-browser").classList.remove("hidden");
  loadBrowsePage();
});
$("#browse-search").addEventListener("input", (e) => {
  clearTimeout(browseSearchTimer);
  browseSearchTimer = setTimeout(() => {
    browseQuery = e.target.value.trim();
    browsePage = 0;
    loadBrowsePage();
  }, 250);
});
$("#browse-close").addEventListener("click", () => {
  $("#session-browser").classList.add("hidden");
});
$("#browse-prev").addEventListener("click", () => {
  if (browsePage > 0) {
    browsePage--;
    loadBrowsePage();
  }
});
$("#browse-next").addEventListener("click", () => {
  browsePage++;
  loadBrowsePage();
});
// ─── Sort/group controls ───────────────────────────────────────────
function initSortControls() {
  const p = $("#sort-primary");
  const s = $("#sort-secondary");
  const g = $("#group-by");
  if (!p) return;
  p.value = sortPrimary;
  s.value = sortSecondary;
  g.value = groupBy;
  p.onchange = () => {
    sortPrimary = p.value;
    savePref("sortPrimary", sortPrimary);
    rerender();
  };
  s.onchange = () => {
    sortSecondary = s.value;
    savePref("sortSecondary", sortSecondary);
    rerender();
  };
  g.onchange = () => {
    groupBy = g.value;
    savePref("groupBy", groupBy);
    rerender();
  };
}
function rerender() {
  const c = lastClients.find((x) => x.name === selected);
  if (c) renderSessions(c);
}
initSortControls();

// ─── Send-message modal ─────────────────────────────────────────────
let sendTarget = null;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = String(fr.result || "");
      // strip data:image/png;base64, prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function openSendModal(s) {
  sendTarget = s;
  $("#send-form textarea[name='text']").value = "";
  const fileInput = $("#send-form input[name='image']");
  if (fileInput) fileInput.value = "";
  $("#send-target").textContent =
    `To: ${s.name ?? "(unnamed)"} · ${s.sessionId}`;
  $("#send-modal").classList.remove("hidden");
  setTimeout(() => $("#send-form textarea[name='text']").focus(), 50);
}
function closeSendModal() {
  $("#send-modal").classList.add("hidden");
  sendTarget = null;
}
$("#send-cancel").addEventListener("click", closeSendModal);
$("#send-modal").addEventListener("click", (e) => {
  if (e.target.id === "send-modal") closeSendModal();
});
$("#send-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sendTarget) return;
  const text = $("#send-form textarea[name='text']").value;
  const file = $("#send-form input[name='image']")?.files?.[0];

  let body;
  if (file) {
    const b64 = await readFileAsBase64(file);
    const blocks = [];
    if (text.trim()) blocks.push({ type: "text", text });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: file.type || "image/png", data: b64 },
    });
    body = { content: blocks };
  } else {
    body = { text };
  }

  showResult("…sending");
  try {
    const r = await api(
      `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(sendTarget.sessionId)}/message`,
      { method: "POST", body: JSON.stringify(body) },
    );
    showResult(JSON.stringify(r, null, 2));
    closeSendModal();
    loadClients();
  } catch (err) {
    showResult(String(err));
  }
});

// ─── Switch modal ───────────────────────────────────────────────────
let switchTarget = null;
function openSwitchModal(s) {
  switchTarget = s;
  const c = lastClients.find((x) => x.name === selected);
  const providers = c?.providers ?? { claude: { models: [] } };
  const providerNames = Object.keys(providers);

  const provSel = $("#switch-form select[name='provider']");
  const modelSel = $("#switch-form select[name='model']");
  const effortSel = $("#switch-form select[name='effort']");

  provSel.innerHTML = providerNames.map((n) => `<option value="${n}">${n}</option>`).join("");
  effortSel.innerHTML = EFFORTS.map((e) => `<option value="${e}">${e}</option>`).join("");

  const refreshModels = () => {
    const p = providers[provSel.value] ?? { models: [] };
    modelSel.innerHTML =
      `<option value="">(provider default)</option>` +
      (p.models ?? []).map((m) => `<option value="${m}">${m}</option>`).join("");
    if (s.provider === provSel.value && s.model) modelSel.value = s.model;
  };
  provSel.onchange = refreshModels;

  provSel.value = providerNames.includes(s.provider) ? s.provider : providerNames[0];
  refreshModels();
  effortSel.value = EFFORTS.includes(s.effort) ? s.effort : "low";

  $("#switch-current").textContent =
    `Currently: ${s.provider ?? "?"}/${s.model ?? "?"} · effort ${s.effort ?? "?"}`;
  $("#switch-modal").classList.remove("hidden");
}
function closeSwitchModal() {
  $("#switch-modal").classList.add("hidden");
  switchTarget = null;
}
$("#switch-cancel").addEventListener("click", closeSwitchModal);
$("#switch-modal").addEventListener("click", (e) => {
  if (e.target.id === "switch-modal") closeSwitchModal();
});
$("#switch-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!switchTarget) return;
  const fd = Object.fromEntries(new FormData(e.target));
  const body = {
    provider: fd.provider || undefined,
    model: fd.model || "",
    effort: fd.effort || undefined,
  };
  showResult("…switching");
  try {
    const r = await api(
      `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(switchTarget.sessionId)}/switch`,
      { method: "POST", body: JSON.stringify(body) },
    );
    showResult(JSON.stringify(r, null, 2));
    closeSwitchModal();
    loadClients();
  } catch (err) {
    showResult(String(err));
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  localStorage.removeItem("ccrcm_token");
  location.href = "/login";
});

loadClients();
setInterval(loadClients, 5000);
