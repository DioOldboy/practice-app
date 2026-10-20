/* Practice app — single-page, offline-first. All data stays in this browser's IndexedDB; backups are encrypted files. */
(function () {
  "use strict";

  const APP_VERSION = "1.0.0";
  const DEMO = !!window.PRACTICE_DEMO;
  const DB_NAME = DEMO ? "practice-demo" : "practice";
  const BACKUP_MAGIC = [0x41, 0x50, 0x42, 0x4b]; // "APBK"
  const KDF_ITERATIONS = 600000;
  const MAX_FILE = 25 * 1024 * 1024;
  const BACKUP_REMIND_DAYS = 7;

  /* ---------------- text, escaping, small helpers ---------------- */
  const RAW = Symbol("raw");
  const raw = (s) => ({ [RAW]: true, s: String(s) });
  function esc(v) {
    if (v == null || v === false) return "";
    if (Array.isArray(v)) return v.map(esc).join("");
    if (typeof v === "object" && v[RAW]) return v.s;
    return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += esc(vals[i]) + strings[i + 1];
    return raw(out);
  }

  let lang = "el";
  try { lang = localStorage.getItem("practice.lang") || "el"; } catch (e) { /* storage unavailable */ }
  function t(key, vars) {
    const table = window.STRINGS[lang] || window.STRINGS.el;
    let s = table[key] != null ? table[key] : (window.STRINGS.el[key] != null ? window.STRINGS.el[key] : key);
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  const locale = () => (lang === "el" ? "el-GR" : "en-GB");

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayISO = () => isoDate(new Date());
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function fmtDate(s, opts) { if (!s) return ""; return new Intl.DateTimeFormat(locale(), opts || { day: "numeric", month: "numeric", year: "numeric" }).format(parseISO(s)); }
  function fmtDateTime(ms) { return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)); }
  function age(dob) {
    if (!dob) return null;
    const b = parseISO(dob), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }
  /* Accent- and case-insensitive matching for Greek and Latin text ("Παπαδοπουλου" finds "Παπαδοπούλου"). */
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").trim();
  }
  const fullName = (p) => [p.lastName, p.firstName].filter(Boolean).join(" ");
  const initials = (p) => ((p.lastName || "")[0] || "").toUpperCase() + ((p.firstName || "")[0] || "").toUpperCase();
  const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 010 6.4M18 14.8c1.9.7 3 2.4 3.5 5.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3"/></svg>'
  };
  const icon = (n) => raw(ICON[n]);

  /* ---------------- storage ---------------- */
  const STORES = ["patients", "visits", "locations", "attachments", "meta"];
  let idb = null;
  let persistent = null; // true | false | null
  const mem = { patients: new Map(), visits: new Map(), locations: new Map(), meta: new Map(), attachments: new Map() };
  // In-memory caches: everything except attachment blobs (those load on demand).
  const S = { patients: new Map(), visits: new Map(), locations: new Map(), files: new Map(), meta: {} };

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no indexedDB"));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("patients", { keyPath: "id" });
        const v = d.createObjectStore("visits", { keyPath: "id" });
        v.createIndex("patientId", "patientId");
        v.createIndex("date", "date");
        d.createObjectStore("locations", { keyPath: "id" });
        const a = d.createObjectStore("attachments", { keyPath: "id" });
        a.createIndex("patientId", "patientId");
        d.createObjectStore("meta", { keyPath: "key" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("blocked"));
    });
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function txDone(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("aborted")); }); }

  async function dbAll(store) {
    if (!idb) return [...mem[store].values()];
    return req(idb.transaction(store).objectStore(store).getAll());
  }
  async function dbGet(store, key) {
    if (!idb) return mem[store].get(key);
    return req(idb.transaction(store).objectStore(store).get(key));
  }
  async function dbPut(store, obj) {
    const key = store === "meta" ? obj.key : obj.id;
    if (!idb) { mem[store].set(key, obj); return; }
    const tx = idb.transaction(store, "readwrite");
    tx.objectStore(store).put(obj);
    await txDone(tx);
    askPersistence();
  }
  async function dbDel(store, keys) {
    keys = [].concat(keys);
    if (!idb) { keys.forEach((k) => mem[store].delete(k)); return; }
    const tx = idb.transaction(store, "readwrite");
    keys.forEach((k) => tx.objectStore(store).delete(k));
    await txDone(tx);
  }
  async function dbReplaceAll(data) {
    if (!idb) {
      STORES.forEach((s) => mem[s].clear());
      for (const s of STORES) (data[s] || []).forEach((o) => mem[s].set(s === "meta" ? o.key : o.id, o));
      return;
    }
    const tx = idb.transaction(STORES, "readwrite");
    STORES.forEach((s) => tx.objectStore(s).clear());
    for (const s of STORES) (data[s] || []).forEach((o) => tx.objectStore(s).put(o));
    await txDone(tx);
  }

  async function loadCaches() {
    S.patients = new Map((await dbAll("patients")).map((o) => [o.id, o]));
    S.visits = new Map((await dbAll("visits")).map((o) => [o.id, o]));
    S.locations = new Map((await dbAll("locations")).map((o) => [o.id, o]));
    S.meta = {};
    (await dbAll("meta")).forEach((m) => { S.meta[m.key] = m.value; });
    // File list without blobs, so lists render without loading every image.
    S.files = new Map();
    (await dbAll("attachments")).forEach((a) => { const { blob, ...rest } = a; S.files.set(a.id, rest); });
  }
  async function setMeta(key, value) { S.meta[key] = value; await dbPut("meta", { key, value }); }

  async function askPersistence() {
    if (persistent !== null || !navigator.storage || !navigator.storage.persist) return;
    try {
      persistent = await navigator.storage.persisted();
      if (!persistent) persistent = await navigator.storage.persist();
    } catch (e) { persistent = false; }
  }

  async function savePatient(p) { p.updatedAt = Date.now(); if (!p.createdAt) p.createdAt = p.updatedAt; S.patients.set(p.id, p); await dbPut("patients", p); }
  async function saveVisit(v) { v.updatedAt = Date.now(); if (!v.createdAt) v.createdAt = v.updatedAt; S.visits.set(v.id, v); await dbPut("visits", v); }
  async function saveLocation(l) { S.locations.set(l.id, l); await dbPut("locations", l); }
  async function saveFile(rec) { const { blob, ...rest } = rec; S.files.set(rec.id, rest); await dbPut("attachments", rec); }
  async function deleteFiles(ids) { ids.forEach((id) => S.files.delete(id)); await dbDel("attachments", ids); }
  async function deleteVisit(id) {
    S.visits.delete(id);
    await dbDel("visits", id);
    // keep files, but unlink them from the deleted visit
    for (const f of [...S.files.values()].filter((f) => f.visitId === id)) {
      const full = await dbGet("attachments", f.id);
      if (full) { full.visitId = null; await saveFile(full); }
    }
  }
  async function deletePatient(id) {
    const vids = [...S.visits.values()].filter((v) => v.patientId === id).map((v) => v.id);
    const fids = [...S.files.values()].filter((f) => f.patientId === id).map((f) => f.id);
    vids.forEach((v) => S.visits.delete(v));
    S.patients.delete(id);
    await dbDel("visits", vids);
    await deleteFiles(fids);
    await dbDel("patients", id);
  }

  const visitsOf = (pid) => [...S.visits.values()].filter((v) => v.patientId === pid).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
  const filesOf = (pid) => [...S.files.values()].filter((f) => f.patientId === pid).sort((a, b) => b.createdAt - a.createdAt);
  const visitsOn = (day) => [...S.visits.values()].filter((v) => v.date === day).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const locationsSorted = () => [...S.locations.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, locale()) : a.type === "practice" ? -1 : 1));
  const defaultLocationId = () => { const l = locationsSorted()[0]; return l ? l.id : ""; };

  /* ---------------- navigation ---------------- */
  // Each screen is a history entry, so Android's back gesture moves between screens.
  let route = { view: "agenda" };
  const ui = { day: todayISO(), q: "" };
  function go(view, params, replace) {
    const depth = (history.state && history.state.depth) || 0;
    route = Object.assign({ view }, params || {});
    try {
      if (replace) history.replaceState({ route, depth }, "");
      else history.pushState({ route, depth: depth + 1 }, "");
    } catch (e) { /* ignore */ }
    render(true);
  }
  function goBack() {
    if (history.state && history.state.depth > 0) history.back();
    else go(route.from || "agenda", {}, true);
  }
  window.addEventListener("popstate", (e) => {
    closeOverlays();
    route = (e.state && e.state.route) || { view: "agenda" };
    render(true);
    if (route.view === "visitForm") restoreVisitForm();
  });

  /* ---------------- rendering ---------------- */
  const app = () => document.getElementById("app");
  function render(scrollTop) {
    const v = VIEWS[route.view] || VIEWS.agenda;
    const out = v();
    app().innerHTML = esc(out);
    document.documentElement.lang = lang;
    if (scrollTop) window.scrollTo(0, 0);
    const af = app().querySelector("[autofocus]");
    if (af && route.view === "patientForm" && !route.id) af.focus();
    onScroll();
    hydrateThumbs();
  }
  function onScroll() { const tb = document.querySelector(".topbar"); if (tb) tb.classList.toggle("scrolled", window.scrollY > 4); }
  window.addEventListener("scroll", onScroll, { passive: true });

  function topbar(title, opts) {
    opts = opts || {};
    return html`<header class="topbar">
      ${opts.back ? html`<button class="iconbtn" data-action="back" aria-label="${t("back")}">${icon("back")}</button>` : ""}
      <h1 class="${opts.back ? "" : "lg"}">${title}</h1>
      ${opts.right || ""}
    </header>`;
  }
  function demoRibbon() { return DEMO ? html`<div class="demo-ribbon">${t("demoRibbon")}</div>` : ""; }
  function tabbar() {
    const tab = ["agenda", "patients", "settings"].includes(route.view) ? route.view : route.from || "";
    const b = (id, ic, label) => html`<button data-action="tab" data-tab="${id}" ${tab === id ? raw('aria-current="page"') : ""}><span class="pill">${icon(ic)}</span>${label}</button>`;
    return html`<nav class="tabbar" aria-label="${t("appName")}">${b("agenda", "cal", t("tabAgenda"))}${b("patients", "people", t("tabPatients"))}${b("settings", "gear", t("tabSettings"))}</nav>`;
  }
  function locChip(locId) {
    const l = S.locations.get(locId);
    if (!l) return "";
    return html`<span class="chip ${l.type === "hospital" ? "hospital" : "practice"}">${l.name}</span>`;
  }
  function statusChip(s) {
    if (!s || s === "completed") return "";
    const cls = { scheduled: "ok", cancelled: "danger", noshow: "warn" }[s] || "";
    return html`<span class="chip ${cls}">${t("st_" + s)}</span>`;
  }
  function regionText(v) {
    if (!v.region) return "";
    const side = v.side && v.side !== "none" ? " " + t("sdShort_" + v.side) : "";
    return t("rg_" + v.region) + side;
  }
  function backupBanner() {
    if (!S.patients.size) return "";
    const last = S.meta.lastBackupAt;
    if (last && Date.now() - last < BACKUP_REMIND_DAYS * 864e5) return "";
    return html`<div class="banner">${icon("shield")}<div class="grow">${last ? t("backupDue") : t("backupNever")}</div><button class="btn" data-action="backup">${t("backupNow")}</button></div>`;
  }

  const VIEWS = {};

  VIEWS.agenda = function () {
    const day = ui.day, today = todayISO();
    const weekStart = (() => { const d = parseISO(day); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return isoDate(d); })();
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const dayNames = days.map((d) => new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(parseISO(d)).replace(".", ""));
    const list = visitsOn(day);
    // group by location, practice first
    const groups = [];
    locationsSorted().forEach((l) => { const vs = list.filter((v) => v.locationId === l.id); if (vs.length) groups.push({ l, vs }); });
    const orphan = list.filter((v) => !S.locations.has(v.locationId));
    if (orphan.length) groups.push({ l: null, vs: orphan });

    const visitRow = (v) => {
      const p = S.patients.get(v.patientId);
      return html`<button class="row" data-action="openVisit" data-id="${v.id}">
        <div class="time">${v.time || "—"}</div>
        <div class="grow">
          <div class="title">${p ? fullName(p) : "?"}</div>
          <div class="sub">${[t("ty_" + (v.type || "followup")), regionText(v), v.diagnosis || v.complaint].filter(Boolean).join(" · ")}</div>
          ${statusChip(v.status) ? html`<div class="chips">${statusChip(v.status)}</div>` : ""}
        </div><span class="chev">${icon("chev")}</span></button>`;
    };

    let upcoming = "";
    if (day === today) {
      const ahead = [...S.visits.values()].filter((v) => v.date > today && v.date <= addDays(today, 14) && v.status === "scheduled")
        .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
      const byDay = {};
      ahead.forEach((v) => { (byDay[v.date] = byDay[v.date] || []).push(v); });
      upcoming = html`<section class="section">
        <div class="section-head"><h2>${t("upcoming")}</h2></div>
        ${ahead.length ? Object.keys(byDay).map((d) => html`<div class="daygroup-title">${fmtDate(d, { weekday: "long", day: "numeric", month: "long" })}</div>
          <div class="card list">${byDay[d].map((v) => html`${visitRow(v)}`)}</div>`) : html`<div class="card"><div class="empty">${t("noUpcoming")}</div></div>`}
      </section>`;
    }

    const label = day === today ? t("today") : fmtDate(day, { weekday: "long" });
    return html`${demoRibbon()}${topbar(t("tabAgenda"), { right: day !== today ? html`<button class="linkbtn" data-action="today">${t("today")}</button>` : "" })}
      <main class="content">
        ${backupBanner()}
        <section class="section">
          <div class="daynav">
            <button class="iconbtn" data-action="dayShift" data-n="-1" aria-label="${t("prevDay")}">${icon("back")}</button>
            <div class="day"><button class="daybtn" data-action="pickDay" aria-label="${t("pickDate")}"><strong>${label}</strong>
              <span class="num">${fmtDate(day, { day: "numeric", month: "long", year: "numeric" })}</span></button>
              <input type="date" id="dayPicker" value="${day}" tabindex="-1" aria-hidden="true"></div>
            <button class="iconbtn" data-action="dayShift" data-n="1" aria-label="${t("nextDay")}">${icon("chev")}</button>
          </div>
          <div class="week" role="group">
            ${days.map((d, i) => html`<button data-action="setDay" data-day="${d}" aria-pressed="${d === day}" class="${[d === today ? "today" : "", visitsOn(d).length ? "has" : ""].join(" ")}">${dayNames[i]}<b>${parseISO(d).getDate()}</b><i></i></button>`)}
          </div>
        </section>
        <section class="section">
          <div class="section-head"><h2>${list.length === 1 ? t("dayCount1") : t("dayCount", { n: list.length })}</h2></div>
          ${list.length ? groups.map((g) => html`
            <div class="loc-label"><span class="loc-dot ${g.l && g.l.type === "hospital" ? "hospital" : ""}"></span>${g.l ? g.l.name : "—"}</div>
            <div class="card list">${g.vs.map(visitRow)}</div>`)
            : html`<div class="card"><div class="empty">${t("noVisitsDay")}</div></div>`}
        </section>
        ${upcoming}
      </main>
      <button class="fab" data-action="newVisit" data-date="${day}">${icon("plus")}${t("newAppointment")}</button>
      ${tabbar()}`;
  };

  function patientMatches(q) {
    const nq = norm(q);
    const all = [...S.patients.values()];
    const filtered = !nq ? all : all.filter((p) => {
      const hay = norm([p.lastName, p.firstName, p.fatherName, p.phone, p.amka, p.email].join(" "));
      return nq.split(/\s+/).every((part) => hay.includes(part));
    });
    return filtered.sort((a, b) => fullName(a).localeCompare(fullName(b), "el"));
  }
  function lastVisitDate(pid) { let m = ""; S.visits.forEach((v) => { if (v.patientId === pid && v.status !== "cancelled" && v.date > m && v.date <= todayISO()) m = v.date; }); return m; }
  function patientRows(list, q) {
    if (!S.patients.size) return html`<div class="card"><div class="empty">${t("noPatients")}<button class="btn primary" data-action="newPatient">${icon("plus")}${t("newPatient")}</button></div></div>`;
    if (!list.length) return html`<div class="card"><div class="empty">${t("noMatches", { q })}</div></div>`;
    let letter = "";
    const out = [];
    let chunk = [];
    const flush = () => { if (chunk.length) out.push(html`<div class="letter">${letter}</div><div class="list">${chunk}</div>`); chunk = []; };
    list.forEach((p) => {
      const L = norm(p.lastName || "?")[0].toUpperCase();
      if (!q && L !== letter) { flush(); letter = L; }
      const a = age(p.dob), lv = lastVisitDate(p.id);
      chunk.push(html`<button class="row" data-action="openPatient" data-id="${p.id}">
        <span class="avatar">${initials(p)}</span>
        <div class="grow"><div class="title">${fullName(p)}</div>
          <div class="sub num">${[a != null ? t("years", { n: a }) : "", p.phone, lv ? t("lastVisit", { d: fmtDate(lv) }) : ""].filter(Boolean).join(" · ")}</div></div>
        <span class="chev">${icon("chev")}</span></button>`);
    });
    flush();
    return html`<div class="card">${out}</div>`;
  }

  VIEWS.patients = function () {
    const list = patientMatches(ui.q);
    return html`${demoRibbon()}${topbar(t("tabPatients"))}
      <main class="content">
        <div class="search">${icon("search")}<input id="patientSearch" type="search" inputmode="search" autocomplete="off" placeholder="${t("searchPatients")}" value="${ui.q}" aria-label="${t("searchPatients")}"></div>
        <div class="section"><div class="count" id="patientCount">${list.length === 1 ? t("patientsCount1") : t("patientsCount", { n: list.length })}</div>
        <div id="patientList">${patientRows(list, ui.q)}</div></div>
      </main>
      <button class="fab" data-action="newPatient">${icon("plus")}${t("newPatient")}</button>
      ${tabbar()}`;
  };

  function fact(k, v, wide) { if (!v) return null; return { k, v, wide }; }
  function factsGrid(items) {
    items = items.filter(Boolean);
    if (!items.length) return "";
    const half = items.filter((i) => !i.wide);
    // A lone half-width fact at the end stretches, so the grid never shows an empty cell.
    let halfSeen = 0;
    return html`<div class="card facts">${items.map((i) => {
      let wide = i.wide;
      if (!wide) { halfSeen++; if (halfSeen === half.length && half.length % 2 === 1) wide = true; }
      return html`<div class="fact ${wide ? "wide" : ""}"><div class="k">${i.k}</div><div class="v">${i.v}</div></div>`;
    })}</div>`;
  }

  VIEWS.patient = function () {
    const p = S.patients.get(route.id);
    if (!p) { setTimeout(() => go("patients", {}, true)); return ""; }
    const a = age(p.dob);
    const vs = visitsOf(p.id), fs = filesOf(p.id);
    const meta = [a != null ? t("years", { n: a }) : "", p.sex ? t(p.sex === "F" ? "female" : "male") : "", p.dob ? fmtDate(p.dob) : ""].filter(Boolean).join(" · ");
    const tel = p.phone ? html`<a href="tel:${p.phone.replace(/[^\d+]/g, "")}">${p.phone}</a>` : "";
    const mail = p.email ? html`<a href="mailto:${p.email}">${p.email}</a>` : "";
    return html`${demoRibbon()}${topbar(t("patient"), { back: true, right: html`<button class="iconbtn" data-action="editPatient" data-id="${p.id}" aria-label="${t("edit")}">${icon("edit")}</button>` })}
      <main class="content noform">
        <div class="ph"><h2>${fullName(p)}</h2>${meta ? html`<div class="meta num">${meta}</div>` : ""}</div>
        ${p.allergies ? html`<div class="alert-box"><div class="k">${t("allergies")}</div><div class="v">${p.allergies}</div></div>` : ""}
        ${factsGrid([fact(t("phone"), tel), fact(t("amka"), p.amka), fact(t("insurance"), p.insurance), fact(t("occupation"), p.occupation),
          fact(t("referredBy"), p.referredBy), fact(t("email"), mail, true), fact(t("address"), p.address, true),
          fact(t("history"), p.history, true), fact(t("notes"), p.notes, true)])}
        <section class="section">
          <div class="section-head"><h2>${t("visits")} · ${vs.length}</h2><button class="linkbtn" data-action="newVisit" data-patient="${p.id}">+ ${t("newVisit")}</button></div>
          ${vs.length ? html`<div class="card list timeline">${vs.map((v) => {
            const d = parseISO(v.date);
            return html`<button class="row" data-action="openVisit" data-id="${v.id}">
              <div class="tdate"><b>${d.getDate()}</b><span>${new Intl.DateTimeFormat(locale(), { month: "short" }).format(d).replace(".", "")} ${String(d.getFullYear()).slice(2)}</span></div>
              <div class="grow"><div class="title">${t("ty_" + (v.type || "followup"))}${regionText(v) ? " · " + regionText(v) : ""}</div>
                ${v.diagnosis || v.complaint ? html`<div class="sub">${v.diagnosis || v.complaint}</div>` : ""}
                <div class="chips">${locChip(v.locationId)}${statusChip(v.status)}</div></div>
              <span class="chev">${icon("chev")}</span></button>`;
          })}</div>` : html`<div class="card"><div class="empty">${t("noVisits")}</div></div>`}
        </section>
        <section class="section">
          <div class="section-head"><h2>${t("files")} · ${fs.length}</h2></div>
          <div class="files">${fileTiles(fs)}<button class="file add" data-action="addFile" data-patient="${p.id}">${icon("upload")}${t("addFile")}</button></div>
        </section>
        <p class="note num">${p.consentDate ? t("consent") + ": " + fmtDate(p.consentDate) : ""}</p>
      </main>`;
  };

  function fileTiles(fs) {
    return fs.map((f) => html`<button class="file" data-action="openFile" data-id="${f.id}" aria-label="${f.caption || f.name}">
      ${f.mime && f.mime.startsWith("image/") ? html`<img data-thumb="${f.id}" alt="">` : icon("file")}
      <span class="cap">${f.caption || f.name}</span></button>`);
  }
  // Thumbnails load after render from IndexedDB blobs.
  const thumbURLs = new Map();
  async function hydrateThumbs() {
    for (const img of document.querySelectorAll("img[data-thumb]")) {
      const id = img.dataset.thumb;
      let url = thumbURLs.get(id);
      if (!url) {
        const rec = await dbGet("attachments", id);
        if (!rec || !rec.blob) continue;
        url = URL.createObjectURL(rec.blob);
        thumbURLs.set(id, url);
      }
      img.src = url;
    }
  }

  VIEWS.visit = function () {
    const v = S.visits.get(route.id);
    if (!v) { setTimeout(() => goBack()); return ""; }
    const p = S.patients.get(v.patientId);
    const l = S.locations.get(v.locationId);
    const fs = [...S.files.values()].filter((f) => f.visitId === v.id);
    const when = fmtDate(v.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + (v.time ? " · " + v.time : "");
    return html`${demoRibbon()}${topbar(t("visit"), { back: true, right: html`<button class="iconbtn" data-action="editVisit" data-id="${v.id}" aria-label="${t("edit")}">${icon("edit")}</button>` })}
      <main class="content noform">
        <div class="ph">
          <h2>${t("ty_" + (v.type || "followup"))}${regionText(v) ? " · " + regionText(v) : ""}</h2>
          <div class="meta num">${when}</div>
          <div class="chips">${locChip(v.locationId)}${statusChip(v.status)}</div>
        </div>
        ${p ? html`<div class="card list"><button class="row" data-action="openPatient" data-id="${p.id}"><span class="avatar">${initials(p)}</span>
          <div class="grow"><div class="title">${fullName(p)}</div><div class="sub num">${[age(p.dob) != null ? t("years", { n: age(p.dob) }) : "", p.phone].filter(Boolean).join(" · ")}</div></div><span class="chev">${icon("chev")}</span></button></div>` : ""}
        ${p && p.allergies ? html`<div class="alert-box"><div class="k">${t("allergies")}</div><div class="v">${p.allergies}</div></div>` : ""}
        ${factsGrid([fact(t("complaint"), v.complaint, true), fact(t("findings"), v.findings, true), fact(t("diagnosis"), v.diagnosis, true),
          fact(t("plan"), v.plan, true), fact(t("followUp"), v.followUp ? fmtDate(v.followUp) : ""), fact(t("fee"), v.fee ? "€ " + v.fee : ""),
          fact(t("location"), l ? l.name + (l.address ? "\n" + l.address : "") : "", true), fact(t("visitNotes"), v.notes, true)])}
        <section class="section">
          <div class="section-head"><h2>${t("files")} · ${fs.length}</h2></div>
          <div class="files">${fileTiles(fs)}<button class="file add" data-action="addFile" data-patient="${v.patientId}" data-visit="${v.id}">${icon("upload")}${t("addFile")}</button></div>
        </section>
      </main>`;
  };

  /* ---------------- forms ---------------- */
  function field(id, label, value, opts) {
    opts = opts || {};
    const type = opts.type || "text";
    const input = type === "textarea"
      ? html`<textarea id="${id}" name="${id}" rows="${opts.rows || 3}">${value || ""}</textarea>`
      : html`<input id="${id}" name="${id}" type="${type}" value="${value || ""}" ${opts.inputmode ? raw('inputmode="' + esc(opts.inputmode) + '"') : ""} ${opts.autocomplete ? raw('autocomplete="' + esc(opts.autocomplete) + '"') : raw('autocomplete="off"')} ${opts.autofocus ? raw("autofocus") : ""} ${opts.step ? raw('step="' + esc(opts.step) + '"') : ""}>`;
    return html`<div class="field" data-field="${id}"><label for="${id}">${label}${opts.required ? " *" : ""}</label>${input}${opts.hint ? html`<div class="hint">${opts.hint}</div>` : ""}</div>`;
  }
  function select(id, label, value, options) {
    return html`<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${id}">${options.map(([v, l]) => html`<option value="${v}" ${v === (value || "") ? raw("selected") : ""}>${l}</option>`)}</select></div>`;
  }
  function seg(name, label, value, options) {
    return html`<div class="field"><span class="label" style="font-size:13.5px;font-weight:600">${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${options.map(([v, l]) =>
      html`<label><input type="radio" name="${name}" value="${v}" ${v === (value || "") ? raw("checked") : ""}><span>${l}</span></label>`)}</div></div>`;
  }

  VIEWS.patientForm = function () {
    const p = route.id ? S.patients.get(route.id) : { lastName: route.prefill || "" };
    if (route.id && !p) { setTimeout(() => goBack()); return ""; }
    return html`${topbar(route.id ? t("editPatient") : t("newPatient"), { back: true, right: html`<button class="savebtn" form="patientForm">${t("save")}</button>` })}
      <main class="content noform">
        <form class="form" id="patientForm" data-form="patient" novalidate>
          <fieldset><legend>${t("secIdentity")}</legend>
            ${field("lastName", t("lastName"), p.lastName, { required: true, autofocus: !route.id })}
            ${field("firstName", t("firstName"), p.firstName, { required: true })}
            <div class="grid2">${field("fatherName", t("fatherName"), p.fatherName)}${field("dob", t("dob"), p.dob, { type: "date" })}</div>
            ${seg("sex", t("sex"), p.sex, [["F", t("female")], ["M", t("male")]])}
            <div class="grid2">${field("amka", t("amka"), p.amka, { inputmode: "numeric" })}${field("insurance", t("insurance"), p.insurance, { hint: t("insuranceHint") })}</div>
          </fieldset>
          <fieldset><legend>${t("secContact")}</legend>
            ${field("phone", t("phone"), p.phone, { type: "tel", inputmode: "tel" })}
            ${field("email", t("email"), p.email, { type: "email", inputmode: "email" })}
            ${field("address", t("address"), p.address)}
          </fieldset>
          <fieldset><legend>${t("secMedical")}</legend>
            ${field("allergies", t("allergies"), p.allergies)}
            ${field("history", t("history"), p.history, { type: "textarea", hint: t("historyHint") })}
            ${field("occupation", t("occupation"), p.occupation)}
          </fieldset>
          <fieldset><legend>${t("secAdmin")}</legend>
            ${field("referredBy", t("referredBy"), p.referredBy)}
            ${field("consentDate", t("consent"), p.consentDate, { type: "date", hint: t("consentHint") })}
            ${field("notes", t("notes"), p.notes, { type: "textarea" })}
          </fieldset>
          ${route.id ? html`<button type="button" class="btn danger block" data-action="deletePatient" data-id="${p.id}">${icon("trash")}${t("deletePatient")}</button>` : ""}
        </form>
      </main>`;
  };

  VIEWS.visitForm = function () {
    const editing = !!route.id;
    const v = editing ? S.visits.get(route.id) : null;
    if (editing && !v) { setTimeout(() => goBack()); return ""; }
    const date = v ? v.date : route.date || todayISO();
    const d = v || { date, time: "", locationId: defaultLocationId(), status: date > todayISO() ? "scheduled" : "completed", type: "followup", region: "", side: "none", patientId: route.patient || "" };
    const pid = ui.pickedPatient !== undefined ? ui.pickedPatient : d.patientId;
    const p = pid ? S.patients.get(pid) : null;
    const locs = locationsSorted();
    return html`${topbar(editing ? t("editVisit") : t("newVisit"), { back: true, right: html`<button class="savebtn" form="visitForm">${t("save")}</button>` })}
      <main class="content noform">
        <form class="form" id="visitForm" data-form="visit" novalidate>
          <input type="hidden" name="patientId" id="patientId" value="${pid || ""}">
          <fieldset><legend>${t("patient")}</legend>
            <div class="field" data-field="patientId" id="patientPicker">${p
              ? html`<div class="picked"><span class="avatar">${initials(p)}</span><span class="grow">${fullName(p)}</span>${editing || route.patient ? "" : html`<button type="button" class="linkbtn" data-action="unpickPatient">${t("changePatient")}</button>`}</div>`
              : html`<input id="pickerInput" type="search" autocomplete="off" placeholder="${t("choosePatient")}" aria-label="${t("choosePatient")}"><div class="picker-results card list" id="pickerResults" hidden></div>`}</div>
          </fieldset>
          <fieldset><legend>${t("secWhen")}</legend>
            <div class="grid2">${field("date", t("date"), d.date, { type: "date" })}${field("time", t("time"), d.time, { type: "time", step: "300" })}</div>
            ${select("locationId", t("location"), d.locationId, locs.map((l) => [l.id, l.name]))}
            <div class="grid2">${select("type", t("type"), d.type, ["first", "followup", "trauma", "procedure", "surgery", "postop"].map((k) => [k, t("ty_" + k)]))}
              ${select("status", t("status"), d.status, ["scheduled", "completed", "cancelled", "noshow"].map((k) => [k, t("st_" + k)]))}</div>
          </fieldset>
          <fieldset><legend>${t("secClinical")}</legend>
            <div class="grid2">${select("region", t("region"), d.region, [["", t("rg_none")]].concat(["knee", "hip", "shoulder", "elbow", "hand", "foot", "spine", "other"].map((k) => [k, t("rg_" + k)])))}
              ${select("side", t("side"), d.side, ["none", "R", "L", "B"].map((k) => [k, t("sd_" + k)]))}</div>
            ${field("complaint", t("complaint"), d.complaint, { type: "textarea", rows: 2 })}
            ${field("findings", t("findings"), d.findings, { type: "textarea" })}
            ${field("diagnosis", t("diagnosis"), d.diagnosis)}
            ${field("plan", t("plan"), d.plan, { type: "textarea" })}
          </fieldset>
          <fieldset><legend>${t("secOther")}</legend>
            <div class="grid2">${field("followUp", t("followUp"), d.followUp, { type: "date" })}${field("fee", t("fee"), d.fee, { type: "number", inputmode: "decimal", step: "0.01" })}</div>
            ${field("notes", t("visitNotes"), d.notes, { type: "textarea", rows: 2 })}
          </fieldset>
          ${editing ? html`<button type="button" class="btn danger block" data-action="deleteVisit" data-id="${v.id}">${icon("trash")}${t("deleteVisit")}</button>` : ""}
        </form>
      </main>`;
  };

  function formValues(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = typeof v === "string" ? v.trim() : v; });
    return o;
  }
  function markInvalid(form, name, msg) {
    const f = form.querySelector('[data-field="' + name + '"]');
    if (!f) return;
    f.classList.add("invalid");
    if (!f.querySelector(".err")) f.insertAdjacentHTML("beforeend", '<div class="err">' + esc(msg) + "</div>");
  }

  async function submitPatient(form) {
    const v = formValues(form);
    form.querySelectorAll(".invalid").forEach((e) => { e.classList.remove("invalid"); const er = e.querySelector(".err"); if (er) er.remove(); });
    let ok = true;
    if (!v.lastName) { markInvalid(form, "lastName", t("required")); ok = false; }
    if (!v.firstName) { markInvalid(form, "firstName", t("required")); ok = false; }
    if (!ok) { const first = form.querySelector(".invalid input"); if (first) first.focus(); return; }
    const existing = route.id ? S.patients.get(route.id) : null;
    const p = Object.assign({}, existing || { id: uid() }, {
      lastName: v.lastName, firstName: v.firstName, fatherName: v.fatherName, dob: v.dob, sex: v.sex || "", amka: v.amka, insurance: v.insurance,
      phone: v.phone, email: v.email, address: v.address, allergies: v.allergies, history: v.history, occupation: v.occupation,
      referredBy: v.referredBy, consentDate: v.consentDate, notes: v.notes
    });
    await savePatient(p);
    toast(t("patientSaved"));
    if (existing) history.back();
    else if (route.returnToVisit) { ui.pickedPatient = p.id; history.back(); }
    else go("patient", { id: p.id }, true);
  }

  async function submitVisit(form) {
    const v = formValues(form);
    form.querySelectorAll(".invalid").forEach((e) => { e.classList.remove("invalid"); const er = e.querySelector(".err"); if (er) er.remove(); });
    if (!v.patientId) { markInvalid(form, "patientId", t("patientRequired")); return; }
    if (!v.date) { markInvalid(form, "date", t("required")); return; }
    const existing = route.id ? S.visits.get(route.id) : null;
    const rec = Object.assign({}, existing || { id: uid() }, {
      patientId: v.patientId, date: v.date, time: v.time, locationId: v.locationId, type: v.type, status: v.status, region: v.region, side: v.side,
      complaint: v.complaint, findings: v.findings, diagnosis: v.diagnosis, plan: v.plan, followUp: v.followUp, fee: v.fee, notes: v.notes
    });
    await saveVisit(rec);
    ui.pickedPatient = undefined;
    toast(t("visitSaved"));
    if (existing) history.back();
    else go("visit", { id: rec.id }, true);
  }

  function renderPicker() {
    const input = document.getElementById("pickerInput"), box = document.getElementById("pickerResults");
    if (!input || !box) return;
    const q = input.value.trim();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const list = patientMatches(q).slice(0, 6);
    box.innerHTML = esc(html`${list.map((p) => html`<button type="button" class="row" data-action="pickPatient" data-id="${p.id}"><span class="avatar">${initials(p)}</span>
      <div class="grow"><div class="title">${fullName(p)}</div><div class="sub num">${[age(p.dob) != null ? t("years", { n: age(p.dob) }) : "", p.phone].filter(Boolean).join(" · ")}</div></div></button>`)}
      <button type="button" class="row" data-action="createFromPicker"><span class="avatar">${icon("plus")}</span><div class="grow"><div class="title">${t("createPatient", { q })}</div></div></button>`);
    box.hidden = false;
  }

  /* ---------------- settings ---------------- */
  VIEWS.settings = function () {
    const pp = !!S.meta.keyCheck;
    const last = S.meta.lastBackupAt;
    const st = persistent === true ? t("storagePersistent") : persistent === false ? t("storageBestEffort") : t("storageUnknown");
    return html`${demoRibbon()}${topbar(t("settings"))}
      <main class="content">
        <section class="section">
          <div class="section-head"><h2>${t("language")}</h2></div>
          <div class="seg" role="radiogroup" aria-label="${t("language")}">
            <label><input type="radio" name="lang" value="el" data-action="lang" ${lang === "el" ? raw("checked") : ""}><span>Ελληνικά</span></label>
            <label><input type="radio" name="lang" value="en" data-action="lang" ${lang === "en" ? raw("checked") : ""}><span>English</span></label>
          </div>
        </section>
        <section class="section">
          <div class="section-head"><h2>${t("locations")}</h2><button class="linkbtn" data-action="editLocation">+ ${t("addLocation")}</button></div>
          <div class="card list">${locationsSorted().map((l) => html`<button class="row" data-action="editLocation" data-id="${l.id}">
            <span class="loc-dot ${l.type === "hospital" ? "hospital" : ""}"></span>
            <div class="grow"><div class="title">${l.name}</div><div class="sub">${[l.type === "hospital" ? t("locHospital") : t("locPractice"), l.address].filter(Boolean).join(" · ")}</div></div>
            <span class="chev">${icon("chev")}</span></button>`)}</div>
        </section>
        <section class="section">
          <div class="section-head"><h2>${t("backup")}</h2></div>
          <div class="card">
            <div class="kv"><span class="k">${t("passphraseState")}</span><span class="v">${pp ? t("passphraseSet") : t("passphraseNotSet")}</span></div>
            <div class="kv"><span class="k">${t("lastBackup")}</span><span class="v num">${last ? fmtDateTime(last) : t("never")}</span></div>
          </div>
          <div class="stack">
            <button class="btn primary block" data-action="backup">${icon("shield")}${t("makeBackup")}</button>
            <p class="note">${t("makeBackupHint")}</p>
            <button class="btn block" data-action="restore">${icon("download")}${t("restore")}</button>
            <p class="note">${t("restoreHint")}</p>
            <button class="btn block" data-action="passphrase">${pp ? t("changePassphrase") : t("setPassphrase")}</button>
          </div>
          <input type="file" id="restoreInput" accept=".apb,application/octet-stream" hidden>
        </section>
        <section class="section">
          <div class="card">
            <div class="kv"><span class="k">${t("counts")}</span><span class="v num">${t("countsValue", { p: S.patients.size, v: S.visits.size, f: S.files.size })}</span></div>
            <div class="kv"><span class="k">${t("storage")}</span><span class="v">${st}</span></div>
            <div class="kv"><span class="k">${t("version")}</span><span class="v num">${APP_VERSION}${DEMO ? " · demo" : ""}</span></div>
          </div>
          ${DEMO ? html`<button class="btn block" data-action="demoReset">${t("demoReset")}</button>` : ""}
        </section>
      </main>
      ${tabbar()}`;
  };

  /* ---------------- overlays: sheets, toast, viewer ---------------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }
  function closeOverlays() { document.querySelectorAll(".scrim, .viewer").forEach((e) => e.remove()); }
  // A bottom sheet. `build(sheetEl, done)` wires its own controls; resolves with whatever done() receives.
  function sheet(inner, build) {
    return new Promise((resolve) => {
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + esc(inner) + "</div>";
      document.body.appendChild(scrim);
      const el = scrim.firstElementChild;
      let finished = false;
      const done = (val) => { if (finished) return; finished = true; scrim.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      scrim.addEventListener("click", (e) => { if (e.target === scrim) done(null); });
      el.querySelectorAll("[data-sheet-cancel]").forEach((b) => b.addEventListener("click", () => done(null)));
      build && build(el, done);
      const f = el.querySelector("input:not([type=hidden]), button.primary");
      if (f) setTimeout(() => f.focus(), 30);
    });
  }
  function confirmSheet(title, body, okLabel, danger) {
    return sheet(html`<h3>${title}</h3>${body ? html`<p>${body}</p>` : ""}<div class="btns"><button class="btn" data-sheet-cancel>${t("cancel")}</button>
      <button class="btn ${danger ? "danger" : "primary"}" data-ok>${okLabel}</button></div>`,
      (el, done) => el.querySelector("[data-ok]").addEventListener("click", () => done(true))).then((v) => v === true);
  }

  async function openViewer(id) {
    const rec = await dbGet("attachments", id);
    if (!rec) return;
    const url = URL.createObjectURL(rec.blob);
    const v = document.createElement("div");
    v.className = "viewer";
    const isImg = rec.mime && rec.mime.startsWith("image/");
    v.innerHTML = esc(html`<div class="vbar"><button class="iconbtn" data-v="close" aria-label="${t("close")}">${icon("close")}</button>
      <div class="grow">${rec.caption || rec.name}<br><small style="opacity:.7">${fmtDate(isoDate(new Date(rec.createdAt)))} · ${fmtBytes(rec.size || rec.blob.size)}</small></div>
      <button class="iconbtn" data-v="delete" aria-label="${t("delete")}">${icon("trash")}</button></div>
      <div class="vbody">${isImg ? html`<img src="${url}" alt="${rec.caption || rec.name}">` : html`<a class="btn" href="${url}" target="_blank" rel="noopener">${icon("file")}${t("openPdf")}</a>`}</div>`);
    document.body.appendChild(v);
    const close = () => { v.remove(); URL.revokeObjectURL(url); };
    v.querySelector('[data-v="close"]').addEventListener("click", close);
    v.querySelector('[data-v="delete"]').addEventListener("click", async () => {
      if (!(await confirmSheet(t("deleteFileQ"), rec.caption || rec.name, t("delete"), true))) return;
      await deleteFiles([id]);
      close();
      toast(t("fileDeleted"));
      render();
      hydrateThumbs();
    });
  }

  /* ---------------- attachments ---------------- */
  async function shrinkImage(file) {
    // Phone photos are 3–8 MB; 2000 px JPEG keeps X-ray detail legible at a fraction of the size.
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5e6) { bmp.close && bmp.close(); return file; }
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close && bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; }
  }
  function addFileFlow(patientId, visitId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > MAX_FILE) { toast(t("fileTooBig")); return; }
      const vs = visitsOf(patientId);
      const res = await sheet(html`<h3>${t("addFileTitle")}</h3><p>${file.name} · ${fmtBytes(file.size)}</p>
        ${field("fileCaption", t("fileCaption"), "", { hint: t("fileCaptionHint") })}
        ${select("fileVisit", t("linkToVisit"), visitId || "", [["", t("noVisitLink")]].concat(vs.map((v) => [v.id, fmtDate(v.date) + " · " + t("ty_" + (v.type || "followup"))])))}
        <div class="btns"><button class="btn" data-sheet-cancel>${t("cancel")}</button><button class="btn primary" data-ok>${t("save")}</button></div>`,
        (el, done) => el.querySelector("[data-ok]").addEventListener("click", () => done({ caption: el.querySelector("#fileCaption").value.trim(), visitId: el.querySelector("#fileVisit").value || null })));
      if (!res) return;
      const stored = await shrinkImage(file);
      await saveFile({ id: uid(), patientId, visitId: res.visitId, name: file.name, caption: res.caption, mime: stored.type || "application/octet-stream", size: stored.size, createdAt: Date.now(), blob: stored });
      toast(t("fileSaved"));
      render();
      hydrateThumbs();
    });
    input.click();
  }

  /* ---------------- encrypted backup ---------------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let sessionKey = null; // CryptoKey for this app session; never stored

  async function deriveKey(pass, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function makeKeyCheck(key, salt, iterations) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode("practice-key-check")));
    return { salt: b64(salt), iterations, iv: b64(iv), ct: b64(ct) };
  }
  async function verifyKey(key, kc) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(kc.iv) }, key, unb64(kc.ct));
      return dec.decode(pt) === "practice-key-check";
    } catch (e) { return false; }
  }
  function passFields(withConfirm) {
    return html`<div class="field" data-field="pp1"><label for="pp1">${t("ppLabel")}</label><input id="pp1" type="password" autocomplete="${withConfirm ? "new-password" : "current-password"}">
      ${withConfirm ? html`<div class="hint">${t("ppHint")}</div>` : ""}</div>
      ${withConfirm ? html`<div class="field" data-field="pp2"><label for="pp2">${t("ppConfirm")}</label><input id="pp2" type="password" autocomplete="new-password"></div>` : ""}`;
  }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>' + esc(t("working")); } else if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  function sheetError(el, name, msg) { const f = el.querySelector('[data-field="' + name + '"]'); el.querySelectorAll(".err").forEach((e) => e.remove()); el.querySelectorAll(".invalid").forEach((e) => e.classList.remove("invalid")); if (f) { f.classList.add("invalid"); f.insertAdjacentHTML("beforeend", '<div class="err">' + esc(msg) + "</div>"); } }

  // New or changed passphrase: two entries, minimum length, then a fresh salt.
  function setPassphraseFlow(changing) {
    return sheet(html`<h3>${changing ? t("changePassphrase") : t("ppTitleNew")}</h3><p>${changing ? t("ppChangeBody") : t("ppBodyNew")}</p>${passFields(true)}
      <div class="btns"><button class="btn" data-sheet-cancel>${t("cancel")}</button><button class="btn primary" data-ok>${t("save")}</button></div>`,
      (el, done) => {
        const ok = el.querySelector("[data-ok]");
        const submit = async () => {
          const a = el.querySelector("#pp1").value, b = el.querySelector("#pp2").value;
          if (a.length < 12) return sheetError(el, "pp1", t("ppTooShort"));
          if (a !== b) return sheetError(el, "pp2", t("ppMismatch"));
          busy(ok, true);
          const salt = crypto.getRandomValues(new Uint8Array(16));
          const key = await deriveKey(a, salt, KDF_ITERATIONS);
          await setMeta("keyCheck", await makeKeyCheck(key, salt, KDF_ITERATIONS));
          sessionKey = key;
          done(true);
        };
        ok.addEventListener("click", submit);
        el.querySelectorAll("input").forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));
      }).then((r) => { if (r) toast(t("ppSaved")); return !!r; });
  }
  // Ask for the existing passphrase once per session.
  async function unlockKey() {
    if (sessionKey) return sessionKey;
    const kc = S.meta.keyCheck;
    if (!kc) return (await setPassphraseFlow(false)) ? sessionKey : null;
    return sheet(html`<h3>${t("ppEnter")}</h3><p>${t("ppEnterBody")}</p>${passFields(false)}
      <div class="btns"><button class="btn" data-sheet-cancel>${t("cancel")}</button><button class="btn primary" data-ok>${t("continue")}</button></div>`,
      (el, done) => {
        const ok = el.querySelector("[data-ok]");
        const submit = async () => {
          busy(ok, true);
          const key = await deriveKey(el.querySelector("#pp1").value, unb64(kc.salt), kc.iterations);
          if (await verifyKey(key, kc)) { sessionKey = key; done(key); }
          else { busy(ok, false); sheetError(el, "pp1", t("ppWrong")); }
        };
        ok.addEventListener("click", submit);
        el.querySelector("#pp1").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      });
  }

  async function gzip(u8) {
    if (!window.CompressionStream) return null;
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function gunzip(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const readU32 = (u8, off) => new DataView(u8.buffer, u8.byteOffset + off, 4).getUint32(0, true);
  function concat(parts) { const len = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(len); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; }

  /* File layout: "APBK" | version(1) | headerLen(u32 LE) | header JSON | AES-GCM ciphertext.
     The header (KDF salt and iterations, IV, date) is bound to the ciphertext as additional data, so it cannot be altered.
     Plaintext: jsonLen(u32 LE) | JSON (records + attachment offsets) | attachment bytes, gzip-compressed when the browser supports it. */
  async function buildBackup(key, kc) {
    const atts = await dbAll("attachments");
    const blobs = [];
    let offset = 0;
    const attMeta = [];
    for (const a of atts) {
      const bytes = new Uint8Array(await a.blob.arrayBuffer());
      const { blob, ...rest } = a;
      attMeta.push(Object.assign(rest, { offset, length: bytes.length }));
      blobs.push(bytes);
      offset += bytes.length;
    }
    const meta = (await dbAll("meta")).filter((m) => !["keyCheck", "lastBackupAt"].includes(m.key));
    const body = {
      format: "practice-backup", schema: 1, appVersion: APP_VERSION, createdAt: Date.now(),
      patients: await dbAll("patients"), visits: await dbAll("visits"), locations: await dbAll("locations"), meta, attachments: attMeta
    };
    const json = enc.encode(JSON.stringify(body));
    let plain = concat([u32(json.length), json].concat(blobs));
    const gz = await gzip(plain);
    const compression = gz ? "gzip" : "none";
    if (gz) plain = gz;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header = enc.encode(JSON.stringify({ kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kc.iterations, salt: kc.salt }, cipher: "AES-256-GCM", iv: b64(iv), compression, createdAt: body.createdAt }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, key, plain));
    return { bytes: concat([Uint8Array.from(BACKUP_MAGIC), Uint8Array.of(1), u32(header.length), header, ct]), createdAt: body.createdAt };
  }
  function parseBackupHeader(u8) {
    if (u8.length < 9 || BACKUP_MAGIC.some((b, i) => u8[i] !== b) || u8[4] !== 1) throw new Error("format");
    const hl = readU32(u8, 5);
    const headerBytes = u8.subarray(9, 9 + hl);
    return { header: JSON.parse(dec.decode(headerBytes)), headerBytes, ct: u8.subarray(9 + hl) };
  }
  async function openBackup(u8, key, parsed) {
    let plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parsed.header.iv), additionalData: parsed.headerBytes }, key, parsed.ct));
    if (parsed.header.compression === "gzip") plain = await gunzip(plain);
    const jl = readU32(plain, 0);
    const body = JSON.parse(dec.decode(plain.subarray(4, 4 + jl)));
    if (body.format !== "practice-backup") throw new Error("format");
    const base = 4 + jl;
    body.attachments = body.attachments.map((a) => {
      const { offset, length, ...rest } = a;
      return Object.assign(rest, { blob: new Blob([plain.slice(base + offset, base + offset + length)], { type: a.mime || "application/octet-stream" }) });
    });
    return body;
  }

  async function backupFlow(btn) {
    const key = await unlockKey();
    if (!key) return;
    busy(btn, true);
    try {
      const { bytes, createdAt } = await buildBackup(key, S.meta.keyCheck);
      const d = new Date(createdAt);
      const name = "practice-backup-" + isoDate(d) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".apb";
      const file = new File([bytes], name, { type: "application/octet-stream" });
      let shared = false;
      // Android share sheet: lets her pick Drive directly.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); shared = true; }
        catch (e) { if (e && e.name === "AbortError") { busy(btn, false); return; } }
      }
      if (!shared) {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      await setMeta("lastBackupAt", createdAt);
      toast(shared ? t("backupShared") : t("backupMade"));
      render();
    } catch (e) {
      toast(t("backupFailed", { e: e && e.message ? e.message : String(e) }));
      busy(btn, false);
    }
  }

  async function restoreFlow(file) {
    let u8, parsed;
    try { u8 = new Uint8Array(await file.arrayBuffer()); parsed = parseBackupHeader(u8); }
    catch (e) { toast(t("restoreBadFile")); return; }
    const h = parsed.header;
    const body = await sheet(html`<h3>${t("ppEnter")}</h3><p>${file.name}</p>${passFields(false)}
      <div class="btns"><button class="btn" data-sheet-cancel>${t("cancel")}</button><button class="btn primary" data-ok>${t("restoreDo")}</button></div>`,
      (el, done) => {
        const ok = el.querySelector("[data-ok]");
        const submit = async () => {
          busy(ok, true);
          try {
            const key = await deriveKey(el.querySelector("#pp1").value, unb64(h.kdf.salt), h.kdf.iterations);
            const b = await openBackup(u8, key, parsed);
            b._key = key;
            done(b);
          } catch (e) { busy(ok, false); sheetError(el, "pp1", t("restoreWrong")); }
        };
        ok.addEventListener("click", submit);
        el.querySelector("#pp1").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      });
    if (!body) return;
    const sure = await confirmSheet(t("restoreQ"), t("restoreBody", { d: fmtDateTime(body.createdAt), p: body.patients.length, v: body.visits.length }), t("restoreDo"), true);
    if (!sure) return;
    const key = body._key;
    const salt = unb64(h.kdf.salt);
    const meta = (body.meta || []).concat([{ key: "keyCheck", value: await makeKeyCheck(key, salt, h.kdf.iterations) }, { key: "lastBackupAt", value: body.createdAt }]);
    await dbReplaceAll({ patients: body.patients, visits: body.visits, locations: body.locations, attachments: body.attachments, meta });
    sessionKey = key;
    thumbURLs.forEach((u) => URL.revokeObjectURL(u)); thumbURLs.clear();
    await loadCaches();
    toast(t("restored"));
    go("agenda", {}, true);
  }

  /* ---------------- locations ---------------- */
  async function editLocationFlow(id) {
    const l = id ? S.locations.get(id) : { name: "", type: "hospital", address: "" };
    const inUse = id ? [...S.visits.values()].filter((v) => v.locationId === id).length : 0;
    const res = await sheet(html`<h3>${id ? t("editLocation") : t("addLocation")}</h3>
      ${field("locName", t("locName"), l.name)}
      ${seg("locType", t("locType"), l.type, [["practice", t("locPractice")], ["hospital", t("locHospital")]])}
      ${field("locAddress", t("locAddress"), l.address)}
      <div class="btns">${id ? html`<button class="btn danger" data-del style="margin-right:auto">${t("delete")}</button>` : ""}
        <button class="btn" data-sheet-cancel>${t("cancel")}</button><button class="btn primary" data-ok>${t("save")}</button></div>`,
      (el, done) => {
        el.querySelector("[data-ok]").addEventListener("click", () => {
          const name = el.querySelector("#locName").value.trim();
          if (!name) return sheetError(el, "locName", t("required"));
          done({ name, type: (el.querySelector('input[name="locType"]:checked') || {}).value || "hospital", address: el.querySelector("#locAddress").value.trim() });
        });
        const del = el.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => { if (inUse) sheetError(el, "locName", t("locInUse", { n: inUse })); else done({ del: true }); });
      });
    if (!res) return;
    if (res.del) {
      if (!(await confirmSheet(t("locDeleteQ"), l.name, t("delete"), true))) return;
      S.locations.delete(id); await dbDel("locations", id);
    } else {
      await saveLocation(Object.assign({}, l, res, { id: id || uid() }));
      toast(t("locSaved"));
    }
    render();
  }

  /* ---------------- events ---------------- */
  const ACTIONS = {
    back: () => goBack(),
    tab: (el) => { ui.pickedPatient = undefined; go(el.dataset.tab, {}, true); },
    today: () => { ui.day = todayISO(); render(); },
    setDay: (el) => { ui.day = el.dataset.day; render(); },
    dayShift: (el) => { ui.day = addDays(ui.day, Number(el.dataset.n)); render(); },
    pickDay: () => { const i = document.getElementById("dayPicker"); if (i && i.showPicker) { try { i.showPicker(); } catch (e) { i.click(); } } else if (i) i.click(); },
    openPatient: (el) => go("patient", { id: el.dataset.id, from: route.from || route.view }),
    newPatient: () => go("patientForm", { from: "patients" }),
    editPatient: (el) => go("patientForm", { id: el.dataset.id, from: route.from }),
    deletePatient: async (el) => {
      const p = S.patients.get(el.dataset.id);
      const ok = await confirmSheet(t("deletePatientQ", { name: fullName(p) }), t("deletePatientBody", { v: visitsOf(p.id).length, f: filesOf(p.id).length }), t("delete"), true);
      if (!ok) return;
      await deletePatient(p.id);
      toast(t("patientDeleted"));
      go("patients", {}, true);
    },
    openVisit: (el) => go("visit", { id: el.dataset.id, from: route.from || route.view }),
    newVisit: (el) => { ui.pickedPatient = undefined; go("visitForm", { patient: el.dataset.patient || "", date: el.dataset.date || (route.view === "agenda" ? ui.day : todayISO()), from: route.from || route.view }); },
    editVisit: (el) => { ui.pickedPatient = undefined; go("visitForm", { id: el.dataset.id, from: route.from }); },
    deleteVisit: async (el) => {
      if (!(await confirmSheet(t("deleteVisitQ"), t("deleteVisitBody"), t("delete"), true))) return;
      const v = S.visits.get(el.dataset.id);
      await deleteVisit(el.dataset.id);
      toast(t("visitDeleted"));
      // leave the form and the (now deleted) visit screen
      if (v) go("patient", { id: v.patientId, from: route.from }, true); else go("agenda", {}, true);
    },
    pickPatient: (el) => { snapshotVisitForm(); ui.pickedPatient = el.dataset.id; render(); restoreVisitForm(); },
    unpickPatient: () => { snapshotVisitForm(); ui.pickedPatient = ""; render(); restoreVisitForm(); const i = document.getElementById("pickerInput"); if (i) i.focus(); },
    createFromPicker: () => { snapshotVisitForm(); const q = (document.getElementById("pickerInput") || {}).value || ""; go("patientForm", { prefill: q.trim(), returnToVisit: true, from: route.from }); },
    addFile: (el) => addFileFlow(el.dataset.patient, el.dataset.visit || null),
    openFile: (el) => openViewer(el.dataset.id),
    lang: (el) => { lang = el.value; try { localStorage.setItem("practice.lang", lang); } catch (e) { /* ignore */ } render(); },
    editLocation: (el) => editLocationFlow(el.dataset.id),
    backup: (el) => backupFlow(el),
    restore: () => { const i = document.getElementById("restoreInput"); if (i) { i.value = ""; i.click(); } },
    passphrase: async () => { if (S.meta.keyCheck) { const k = await unlockKey(); if (!k) return; } await setPassphraseFlow(!!S.meta.keyCheck); render(); },
    demoReset: async () => { await seedDemo(true); toast(t("demoResetDone")); go("agenda", {}, true); }
  };
  // Keep typed visit-form values when the patient picker re-renders the form.
  let visitDraft = null;
  function snapshotVisitForm() { const f = document.getElementById("visitForm"); visitDraft = f ? formValues(f) : null; }
  function restoreVisitForm() {
    const f = document.getElementById("visitForm");
    if (!f || !visitDraft) return;
    Object.entries(visitDraft).forEach(([k, v]) => { if (k === "patientId") return; const el = f.elements[k]; if (el && "value" in el) el.value = v; });
    visitDraft = null;
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || !app().contains(el) || el.tagName === "INPUT") return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.action === "lang") ACTIONS.lang(el);
    if (el.id === "dayPicker" && el.value) { ui.day = el.value; render(); }
    if (el.id === "restoreInput" && el.files && el.files[0]) restoreFlow(el.files[0]);
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "patientSearch") {
      ui.q = e.target.value;
      const list = patientMatches(ui.q);
      document.getElementById("patientList").innerHTML = esc(patientRows(list, ui.q));
      document.getElementById("patientCount").textContent = list.length === 1 ? t("patientsCount1") : t("patientsCount", { n: list.length });
    }
    if (e.target.id === "pickerInput") renderPicker();
  });
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === "patient") submitPatient(f);
    if (f.dataset.form === "visit") submitVisit(f);
  });

  /* ---------------- sample data (preview build only) ---------------- */
  async function seedDemo(force) {
    if (!DEMO) return;
    if (!force && S.patients.size) return;
    const today = todayISO();
    const L = [
      { id: "loc-practice", name: "Ιατρείο Αγ. Παρασκευής", type: "practice", address: "Δημητρίου Γούναρη 38Α, Αγία Παρασκευή" },
      { id: "loc-clinic", name: "Κλινική Α (παράδειγμα)", type: "hospital", address: "" }
    ];
    const P = [
      ["Παπαδοπούλου", "Μαρία", "1961-03-14", "F", "6971234567", "ΕΟΠΥΥ", "Πενικιλίνη", "Υπέρταση, υπό αγωγή. Οστεοπενία.", "Συνταξιούχος"],
      ["Κωνσταντίνου", "Γιώργος", "1988-07-02", "M", "6944555123", "Ιδιωτική ασφάλιση", "", "", "Μπάσκετ (ερασιτεχνικά)"],
      ["Αλεξίου", "Ελένη", "1975-11-23", "F", "6932221100", "ΕΟΠΥΥ", "", "Υποθυρεοειδισμός", "Εκπαιδευτικός"],
      ["Δημητρίου", "Νίκος", "1952-01-30", "M", "6977001122", "ΕΟΠΥΥ", "", "Σακχαρώδης διαβήτης τύπου 2, αντιπηκτική αγωγή.", ""],
      ["Ιωάννου", "Σοφία", "2001-05-09", "F", "6955443322", "", "", "", "Χορός"],
      ["Μιχαηλίδης", "Πέτρος", "1969-09-17", "M", "6981234000", "Ιδιωτική ασφάλιση", "Ιώδιο", "", "Οδηγός"],
      ["Βασιλείου", "Άννα", "1983-02-11", "F", "6948889990", "ΕΟΠΥΥ", "", "", ""],
      ["Σταθόπουλος", "Άρης", "1995-12-01", "M", "6970101010", "", "", "", "Ποδόσφαιρο"]
    ].map((r, i) => ({ id: "pat-" + i, lastName: r[0], firstName: r[1], dob: r[2], sex: r[3], phone: r[4], insurance: r[5], allergies: r[6], history: r[7], occupation: r[8],
      amka: r[2].replace(/-/g, "").slice(2) + String(10000 + i * 137).slice(-5), consentDate: addDays(today, -40 - i * 9), createdAt: Date.now() - (60 - i) * 864e5, updatedAt: Date.now() }));
    const V = [];
    const add = (pi, dayOff, time, loc, type, status, region, side, complaint, diagnosis, plan, fee) =>
      V.push({ id: "vis-" + V.length, patientId: "pat-" + pi, date: addDays(today, dayOff), time, locationId: loc, type, status, region, side, complaint, diagnosis, plan, fee: fee || "", findings: "", notes: "", followUp: "", createdAt: Date.now(), updatedAt: Date.now() });
    add(0, -62, "10:00", "loc-practice", "first", "completed", "knee", "R", "Πόνος δεξιού γόνατος 6 μήνες, χειρότερος στη σκάλα", "Οστεοαρθρίτιδα γόνατος ΙΙΙ βαθμού", "Ακτινογραφία φορτιστική, φυσικοθεραπεία, επανεξέταση", "70");
    add(0, -30, "11:30", "loc-practice", "followup", "completed", "knee", "R", "Χωρίς βελτίωση με φυσικοθεραπεία", "Οστεοαρθρίτιδα γόνατος ΙΙΙ βαθμού", "Συζήτηση ολικής αρθροπλαστικής", "50");
    add(0, -9, "08:00", "loc-clinic", "surgery", "completed", "knee", "R", "", "Ολική αρθροπλαστική δεξιού γόνατος", "Κινητοποίηση την 1η ημέρα, αντιθρομβωτική αγωγή 4 εβδομάδες");
    add(0, 0, "18:30", "loc-practice", "postop", "scheduled", "knee", "R", "Αφαίρεση ραμμάτων", "", "");
    add(1, -5, "19:00", "loc-practice", "trauma", "completed", "foot", "L", "Διάστρεμμα αριστερής ποδοκνημικής σε αγώνα", "Διάστρεμμα ΙΙ βαθμού έξω πλαγίων συνδέσμων", "Νάρθηκας, πάγος, ανάρροπη θέση", "60");
    add(1, 0, "19:30", "loc-practice", "followup", "scheduled", "foot", "L", "Επανεξέταση διαστρέμματος", "", "");
    add(2, -20, "17:00", "loc-practice", "first", "completed", "hand", "R", "Μουδιάσματα δακτύλων τη νύχτα", "Σύνδρομο καρπιαίου σωλήνα", "Νάρθηκας νυκτός, ΗΜΓ", "70");
    add(2, 3, "17:30", "loc-practice", "followup", "scheduled", "hand", "R", "Αποτελέσματα ΗΜΓ", "", "");
    add(3, -2, "09:00", "loc-clinic", "trauma", "completed", "hip", "L", "Πτώση στο σπίτι", "Περιτροχαντήριο κάταγμα αριστερού ισχίου", "Οστεοσύνθεση με ενδομυελικό ήλο");
    add(3, 12, "18:00", "loc-practice", "postop", "scheduled", "hip", "L", "Έλεγχος 2 εβδομάδων", "", "");
    add(4, -1, "20:00", "loc-practice", "first", "completed", "shoulder", "R", "Πόνος ώμου στις άρσεις", "Σύνδρομο υπακρωμιακής προστριβής", "Φυσικοθεραπεία 10 συνεδρίες", "70");
    add(5, 0, "17:00", "loc-practice", "first", "scheduled", "spine", "none", "Οσφυαλγία", "", "");
    add(6, 1, "18:00", "loc-practice", "followup", "scheduled", "elbow", "R", "Επικονδυλίτιδα, έλεγχος", "", "");
    add(7, -14, "19:30", "loc-practice", "trauma", "completed", "knee", "L", "Στροφή γόνατος σε αγώνα", "Υποψία ρήξης ΠΧΣ", "MRI γόνατος", "60");
    add(7, 2, "20:00", "loc-practice", "followup", "scheduled", "knee", "L", "Αποτελέσματα MRI", "", "");
    add(6, -3, "18:30", "loc-practice", "followup", "noshow", "elbow", "R", "", "", "");
    await dbReplaceAll({ patients: P, visits: V, locations: L, attachments: [], meta: [] });
    sessionKey = null;
    await loadCaches();
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    try { idb = await openDB(); }
    catch (e) { idb = null; if (!DEMO) setTimeout(() => toast(t("errLoad")), 400); }
    try { await loadCaches(); } catch (e) { idb = null; await loadCaches(); }
    if (DEMO) await seedDemo(false);
    if (!S.locations.size) {
      await saveLocation({ id: uid(), name: lang === "el" ? "Ιατρείο" : "Practice", type: "practice", address: "Δημητρίου Γούναρη 38Α, Αγία Παρασκευή" });
    }
    if (navigator.storage && navigator.storage.persisted) { try { persistent = await navigator.storage.persisted(); } catch (e) { /* ignore */ } }
    try { history.replaceState({ route, depth: 0 }, ""); } catch (e) { /* ignore */ }
    render(true);
    if (!DEMO && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
    }
  }
  // test hook (used by the automated checks only)
  window.__practice = { S, norm, buildBackup, parseBackupHeader, openBackup, deriveKey, makeKeyCheck };
  boot();
})();
