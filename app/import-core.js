/* Register import: pure functions with no access to app state, so they can be tested on their own.
   Turns spreadsheet rows (first row = headers) into patients, visits and hospital locations. */
(function () {
  "use strict";

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  const words = (s) => norm(s).replace(/[.,;:()«»"'\/\\-]/g, " ").split(" ").filter(Boolean);

  /* ---- CSV (comma or semicolon, quoted fields, BOM) ---- */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : (firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",");
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }

  /* ---- cell parsing ---- */
  function parseDate(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if (/^\d{5}(\.\d+)?$/.test(s)) { // spreadsheet serial day number
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5);
      y = dt.getUTCFullYear(); mo = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    } else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return null;
    return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function parseAmount(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return v;
    let s = String(v).replace(/[^\d,.\-]/g, "");
    if (!s) return null;
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (lc > -1) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  }
  function titleCase(s) {
    return String(s || "").trim().toLocaleLowerCase("el")
      .replace(/(^|[\s\-.])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase("el"))
      .replace(/σ(?=$|[\s\-.,])/g, "ς");
  }
  function splitName(name, order) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { lastName: "", firstName: "" };
    if (parts.length === 1) return { lastName: titleCase(parts[0]), firstName: "" };
    return order === "first-last"
      ? { firstName: titleCase(parts[0]), lastName: titleCase(parts.slice(1).join(" ")) }
      : { lastName: titleCase(parts[0]), firstName: titleCase(parts.slice(1).join(" ")) };
  }

  /* ---- hospital / company detection ---- */
  const COMPANY_WORDS = ["αε", "επε", "ικε", "οε", "εε", "μικε", "sa", "ltd", "llc", "inc", "gmbh", "κλινικη", "νοσοκομειο", "υγεια", "θεραπευτηριο", "θεραπευτηρια", "hospital", "clinic"];
  const COMPANY_PARTS = ["κλινικ", "νοσοκομ", "hospital", "clinic", "θεραπευτηρ", "διαγνωστικ", "μαιευτ", "ιατρικο κεντρο", "ιατρικη εταιρ", "ιατρικα κεντρα", "μονοπροσωπ", "εταιρει"];
  function looksLikeHospital(name) {
    const n = norm(name);
    const compact = n.replace(/\./g, "");
    if (COMPANY_PARTS.some((p) => n.includes(p))) return true;
    return words(compact).some((w) => COMPANY_WORDS.includes(w));
  }

  /* ---- column guessing ---- */
  const FIELDS = ["ref", "date", "name", "afm", "amount", "remarks"];
  const GUESS = {
    ref: [/^mark$/, /^μαρκ$/, /mark/, /μαρκ/, /αριθμ/, /\bαρ\b/, /παραστατικ/, /number/, /\bno\b/, /σειρα/],
    date: [/ημερομην/, /ημ\/νια/, /date/],
    name: [/επωνυμ/, /πελατ/, /αντισυμβαλ/, /ονοματεπων/, /customer/, /ονομα/, /name/],
    afm: [/αφμ/, /\bvat\b/, /tax/],
    amount: [/συνολ/, /total/, /πληρωτε/, /ποσο/, /amount/, /αξια/],
    remarks: [/παρατηρ/, /σχολ/, /remark/, /note/, /σημειωσ/, /αιτιολογ/]
  };
  function guessMap(header, saved) {
    const H = header.map((h) => String(h || "").trim());
    if (saved && saved.cols && Object.values(saved.cols).every((c) => !c || H.includes(c))) {
      return { cols: Object.assign({}, saved.cols), nameOrder: saved.nameOrder || "last-first" };
    }
    const used = new Set(), cols = {};
    FIELDS.forEach((f) => {
      for (const re of GUESS[f]) {
        const hit = H.find((h) => h && !used.has(h) && re.test(norm(h)));
        if (hit) { cols[f] = hit; used.add(hit); break; }
      }
      if (!cols[f]) cols[f] = "";
    });
    return { cols, nameOrder: "last-first" };
  }

  /* ---- the analysis ----
     existing: { patients: [...], visits: [...], locations: [...], importedRefs: [...] }
     overrides: { [norm(customerName)]: "hospital" | "patient" } */
  function analyze(rows, map, existing, overrides, today) {
    overrides = overrides || {};
    const header = rows[0].map((h) => String(h || "").trim());
    const idx = {};
    FIELDS.forEach((f) => { idx[f] = map.cols[f] ? header.indexOf(map.cols[f]) : -1; });
    const cell = (r, f) => (idx[f] > -1 && r[idx[f]] != null ? String(r[idx[f]]).trim() : "");
    const imported = new Set(existing.importedRefs || []);
    const out = { invoices: 0, newPatients: [], newVisits: [], newLocations: [], hospitalNames: [], patientNames: [], linked: 0, hospitalOnly: 0,
      skipped: { already: 0, noName: 0, badDate: 0 }, processedRefs: [], amountTotal: 0 };

    // 1. group rows into invoices (line items share an invoice number)
    const groups = new Map();
    rows.slice(1).forEach((r, i) => {
      const ref = cell(r, "ref") || "row-" + (i + 2);
      if (!groups.has(ref)) groups.set(ref, { ref, rows: [] });
      groups.get(ref).rows.push(r);
    });
    const invoices = [];
    groups.forEach((g) => {
      const first = g.rows.find((r) => cell(r, "name")) || g.rows[0];
      const amounts = g.rows.map((r) => parseAmount(cell(r, "amount"))).filter((a) => a != null);
      // repeated identical totals on each line → it is the invoice total; otherwise sum the lines
      const amount = !amounts.length ? null : amounts.every((a) => a === amounts[0]) ? amounts[0] : Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
      const remarks = [...new Set(g.rows.map((r) => cell(r, "remarks")).filter(Boolean))].join(" · ");
      invoices.push({ ref: g.ref, date: parseDate(cell(first, "date")), name: cell(first, "name"), afm: cell(first, "afm").replace(/\D/g, ""), amount, remarks, real: !g.ref.startsWith("row-") });
    });
    out.invoices = invoices.length;
    invoices.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // 2. indexes of what already exists
    const byAfm = new Map(), byName = new Map();
    const indexPatient = (p) => {
      if (p.afm) byAfm.set(p.afm, p);
      const a = norm((p.lastName || "") + " " + (p.firstName || "")), b = norm((p.firstName || "") + " " + (p.lastName || ""));
      if (a) byName.set(a, p);
      if (b) byName.set(b, p);
    };
    existing.patients.forEach(indexPatient);
    const hasVisits = new Set(existing.visits.map((v) => v.patientId));
    const knownVisitRefs = new Set(existing.visits.map((v) => v.invoiceRef).filter(Boolean));
    const locByName = new Map(existing.locations.map((l) => [norm(l.name), l]));
    const practice = existing.locations.find((l) => l.type === "practice") || existing.locations[0];
    const allPatients = existing.patients.slice();
    const hospitalSeen = new Map(), patientSeen = new Map();

    const findInRemarks = (remarks) => {
      if (!remarks) return null;
      // Remarks often carry the name in the genitive ("Αντωνίου Πέτρου" for "Αντωνίου Πέτρος"),
      // so a name word matches a remark word that shares all but its last two letters (at least 4).
      const w = words(remarks);
      const same = (a, b) => { if (a === b) return true; const n = Math.max(4, Math.max(a.length, b.length) - 2); return a.length >= n && b.length >= n && a.slice(0, n) === b.slice(0, n); };
      const hits = allPatients.filter((p) => {
        const parts = words((p.lastName || "") + " " + (p.firstName || "")).filter((x) => x.length >= 3);
        return parts.length >= 2 && parts.every((x) => w.some((y) => same(x, y)));
      });
      return hits.length === 1 ? hits[0] : null;
    };

    for (const inv of invoices) {
      if ((inv.real && imported.has(inv.ref)) || (inv.real && knownVisitRefs.has(inv.ref))) { out.skipped.already++; continue; }
      if (!inv.name) { out.skipped.noName++; continue; } // left for a later run, when the name is filled in
      if (!inv.date) { out.skipped.badDate++; continue; }
      const key = norm(inv.name);
      const kind = overrides[key] || (looksLikeHospital(inv.name) ? "hospital" : "patient");
      if (inv.real) out.processedRefs.push(inv.ref);
      if (inv.amount) out.amountTotal += inv.amount;

      if (kind === "hospital") {
        let loc = locByName.get(key);
        if (!loc) {
          loc = { id: "imp-loc-" + (out.newLocations.length + 1) + "-" + Date.now().toString(36), name: titleCase(inv.name), type: "hospital", address: "" };
          locByName.set(key, loc); out.newLocations.push(loc);
        }
        if (!hospitalSeen.has(key)) { hospitalSeen.set(key, { key, name: inv.name, isNew: out.newLocations.includes(loc), count: 0 }); }
        hospitalSeen.get(key).count++;
        const p = findInRemarks(inv.remarks);
        if (p) {
          out.linked++;
          out.newVisits.push(visitFrom(inv, p, loc, "surgery"));
          hasVisits.add(p.id);
        } else out.hospitalOnly++;
        continue;
      }

      let p = (inv.afm && byAfm.get(inv.afm)) || byName.get(key);
      const isNew = !p;
      if (!p) {
        const nm = splitName(inv.name, map.nameOrder);
        p = { id: "imp-pat-" + (out.newPatients.length + 1) + "-" + Date.now().toString(36), lastName: nm.lastName, firstName: nm.firstName, afm: inv.afm || "",
          notes: "", createdFromImport: true };
        out.newPatients.push(p); indexPatient(p); allPatients.push(p);
      }
      if (!patientSeen.has(key)) patientSeen.set(key, { key, name: inv.name, isNew, count: 0 });
      patientSeen.get(key).count++;
      out.newVisits.push(visitFrom(inv, p, practice, hasVisits.has(p.id) ? "followup" : "first"));
      hasVisits.add(p.id);
    }
    out.hospitalNames = [...hospitalSeen.values()];
    out.patientNames = [...patientSeen.values()];
    out.amountTotal = Math.round(out.amountTotal * 100) / 100;
    return out;

    function visitFrom(inv, p, loc, type) {
      return { id: "imp-vis-" + Math.random().toString(36).slice(2) + Date.now().toString(36), patientId: p.id, date: inv.date, time: "", locationId: loc ? loc.id : "",
        type, status: inv.date > (today || "9999") ? "scheduled" : "completed", region: "", side: "none", complaint: "", findings: "", diagnosis: "", plan: "", followUp: "",
        fee: inv.amount != null ? String(inv.amount) : "", notes: inv.remarks || "", invoiceRef: inv.real ? inv.ref : "" };
    }
  }

  window.PracticeImport = { parseCSV, parseDate, parseAmount, titleCase, splitName, looksLikeHospital, guessMap, analyze, FIELDS, norm };
})();
