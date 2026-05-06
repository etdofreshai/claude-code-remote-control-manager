const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let selected = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

function showResult(text) {
  const el = $("#result");
  el.textContent = text;
  el.classList.remove("hidden");
}

async function loadClients() {
  const list = await api("/api/clients");
  const ul = $("#clients");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = "<li class=empty>No clients connected.</li>";
    return;
  }
  for (const c of list) {
    const li = document.createElement("li");
    li.className = c.name === selected ? "active" : "";
    li.innerHTML = `<span><span class="dot ${c.online ? "up" : "down"}"></span>${c.name}<br><small>${c.hostname ?? ""} · ${c.sessions?.length ?? 0} sessions</small></span>`;
    li.onclick = () => {
      selected = c.name;
      renderSessions(c);
      loadClients();
    };
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
  const ul = $("#sessions");
  ul.innerHTML = "";
  const sessions = (c?.sessions ?? [])
    .slice()
    .sort((a, b) => (b.lastMessageAt ?? b.addedAt).localeCompare(a.lastMessageAt ?? a.addedAt));
  if (!sessions.length) {
    ul.innerHTML = "<li class=empty>No remote sessions yet.</li>";
    return;
  }
  for (const s of sessions) {
    const li = document.createElement("li");
    const title = s.name ? `<strong>${s.name}</strong><br>` : "";
    li.innerHTML = `<span>${title}<code>${s.sessionId}</code><br><small>${s.workingDirectory}</small><br><small>${s.status ?? "—"} · last ${fmtTime(s.lastMessageAt)}</small></span>`;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.className = "btn-danger";
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove session ${s.sessionId}?`)) return;
      btn.disabled = true;
      try {
        const r = await api(
          `/api/clients/${encodeURIComponent(selected)}/sessions/${encodeURIComponent(s.sessionId)}`,
          { method: "DELETE" },
        );
        showResult(JSON.stringify(r, null, 2));
        loadClients();
      } catch (err) {
        showResult(String(err));
        btn.disabled = false;
      }
    };
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function send(form, route) {
  if (!selected) {
    alert("Select a client first.");
    return;
  }
  const body = Object.fromEntries(new FormData(form));
  if (body.name === "") delete body.name;
  showResult("…sending");
  try {
    const r = await api(`/api/clients/${encodeURIComponent(selected)}/sessions/${route}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showResult(JSON.stringify(r, null, 2));
    form.reset();
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
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/login";
});

loadClients();
setInterval(loadClients, 5000);
