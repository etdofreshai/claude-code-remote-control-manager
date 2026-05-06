const $ = (s) => document.querySelector(s);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

async function loadClients() {
  const list = await api("/api/clients");
  const ul = $("#clients");
  const sel = $("#client-select");
  ul.innerHTML = "";
  sel.innerHTML = "";
  for (const c of list) {
    const li = document.createElement("li");
    const status = c.reachable ? "up" : c.reachable === false ? "down" : "";
    li.innerHTML = `<span><span class="dot ${status}"></span>${c.name}<br><small>${c.baseUrl}</small></span>`;
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.style.width = "auto";
    btn.onclick = async () => {
      await api(`/api/clients/${encodeURIComponent(c.name)}`, { method: "DELETE" });
      loadClients();
    };
    li.appendChild(btn);
    ul.appendChild(li);

    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
}

$("#add-client").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await api("/api/clients", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(fd)),
  });
  e.target.reset();
  loadClients();
});

$("#prompt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const name = fd.client;
  const body = {
    workingDirectory: fd.workingDirectory,
    prompt: fd.prompt,
  };
  if (fd.sessionId) body.sessionId = fd.sessionId;
  $("#response").textContent = "…running";
  try {
    const r = await api(`/api/clients/${encodeURIComponent(name)}/prompt`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    $("#response").textContent = JSON.stringify(r, null, 2);
    if (r.sessionId) e.target.sessionId.value = r.sessionId;
  } catch (err) {
    $("#response").textContent = String(err);
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/login";
});

loadClients();
