import sys, io, struct, zlib
from playwright.sync_api import sync_playwright

import os, pathlib
SHOTS = str(pathlib.Path(__file__).resolve().parent.parent / "test-shots") + "/"
os.makedirs(SHOTS, exist_ok=True)
BASE = "http://localhost:8765/"
errors = []
results = []

def check(name, cond):
    results.append(("PASS" if cond else "FAIL", name))

def png(w=1200, h=900):
    raw = b"".join(b"\x00" + bytes([(x * 7) % 256, (y * 3) % 256, 120] * 1)[:3] * 1 for y in range(h) for x in range(1))
    # simple solid-ish image via PIL instead
    from PIL import Image
    im = Image.new("RGB", (w, h), (200, 210, 205))
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="el-GR")
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))

    # ---------- demo / preview ----------
    pg.goto(BASE + "_preview_test.html"); pg.wait_for_selector(".week")
    pg.screenshot(path=SHOTS + "01-agenda.png", full_page=True)
    check("agenda shows today's visits", pg.locator(".content .card.list .row").count() >= 3)
    pg.click('[data-tab="patients"]'); pg.wait_for_selector("#patientSearch")
    pg.screenshot(path=SHOTS + "02-patients.png", full_page=True)
    pg.fill("#patientSearch", "παπαδοπουλου")
    check("accent-insensitive search", pg.locator("#patientList .row").count() == 1 and "Παπαδοπούλου" in pg.inner_text("#patientList"))
    pg.fill("#patientSearch", "6944")
    check("phone search", "Κωνσταντίνου" in pg.inner_text("#patientList"))
    pg.fill("#patientSearch", "")
    pg.click("#patientList .row >> nth=0"); pg.wait_for_selector(".ph h2")
    pg.click('[data-tab="patients"]') if pg.locator('[data-tab="patients"]').count() else None
    pg.goto(BASE + "_preview_test.html"); pg.wait_for_selector(".week")
    pg.click('[data-tab="patients"]'); pg.fill("#patientSearch", "Παπαδοπούλου"); pg.click("#patientList .row")
    pg.wait_for_selector(".ph h2")
    pg.screenshot(path=SHOTS + "03-patient.png", full_page=True)
    check("allergy highlighted", pg.locator(".alert-box").count() == 1)
    check("visit timeline has 4", pg.locator(".timeline .row").count() == 4)
    pg.click(".timeline .row >> nth=1"); pg.wait_for_selector(".ph h2")
    pg.screenshot(path=SHOTS + "04-visit.png", full_page=True)
    pg.go_back(); pg.wait_for_selector(".timeline")
    check("back returns to patient", "Παπαδοπούλου" in pg.inner_text(".ph h2"))
    pg.click('[data-action="newVisit"]'); pg.wait_for_selector("#visitForm")
    pg.screenshot(path=SHOTS + "05-visit-form.png", full_page=True)
    pg.go_back()
    pg.goto(BASE + "_preview_test.html"); pg.wait_for_selector(".week")
    pg.click('[data-tab="settings"]'); pg.wait_for_selector(".seg")
    pg.click("text=English"); pg.wait_for_timeout(200)
    pg.screenshot(path=SHOTS + "06-settings-en.png", full_page=True)
    check("language switch", "BACKUPS" in pg.inner_text("main").upper())
    pg.click('[data-tab="agenda"]'); pg.wait_for_timeout(200)
    pg.screenshot(path=SHOTS + "07-agenda-en.png", full_page=False)
    pg.click("text=Ελληνικά") if pg.locator("text=Ελληνικά").count() else None
    # dark mode
    pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(200)
    pg.screenshot(path=SHOTS + "08-agenda-dark.png", full_page=False)
    pg.emulate_media(color_scheme="light")
    # overflow check
    for v in ["agenda", "patients", "settings"]:
        pg.click(f'[data-tab="{v}"]'); pg.wait_for_timeout(100)
        sw = pg.evaluate("document.documentElement.scrollWidth"); check(f"no horizontal scroll on {v}", sw <= 390)

    # ---------- real app ----------
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="el-GR")
    q = ctx2.new_page()
    q.on("console", lambda m: errors.append("[real] " + m.text) if m.type == "error" else None)
    q.on("pageerror", lambda e: errors.append("[real] " + str(e)))
    q.goto(BASE); q.wait_for_selector(".week")
    check("real app starts empty", "Δεν υπάρχουν επισκέψεις" in q.inner_text("main"))
    q.click('[data-tab="patients"]'); q.click(".fab"); q.wait_for_selector("#patientForm")
    q.click(".savebtn"); q.wait_for_timeout(150)
    check("required fields validated", q.locator(".field.invalid").count() == 2)
    q.fill("#lastName", "Δοκιμαστική"); q.fill("#firstName", "Ασθενής"); q.fill("#dob", "1980-04-12"); q.fill("#allergies", "Ασπιρίνη"); q.fill("#phone", "6900000000")
    q.click(".savebtn"); q.wait_for_selector(".ph h2")
    check("patient saved -> detail", "Δοκιμαστική Ασθενής" in q.inner_text(".ph h2"))
    q.click('[data-action="newVisit"]'); q.wait_for_selector("#visitForm")
    q.select_option("#region", "knee"); q.select_option("#side", "L"); q.fill("#diagnosis", "Ρήξη μηνίσκου"); q.fill("#time", "10:30")
    q.click(".savebtn"); q.wait_for_selector(".ph h2")
    check("visit saved -> detail", "Γόνατο" in q.inner_text(".ph h2"))
    # attachment
    with q.expect_file_chooser() as fc:
        q.click('[data-action="addFile"]')
    fc.value.set_files(files=[{"name": "xray.png", "mimeType": "image/png", "buffer": png()}])
    q.wait_for_selector(".sheet"); q.fill("#fileCaption", "Ακτινογραφία"); q.click(".sheet [data-ok]")
    q.wait_for_selector(".file img[src]", timeout=5000)
    check("attachment saved with thumbnail", q.locator(".file img").count() == 1)
    # persistence across reload
    q.reload(); q.wait_for_selector(".week")
    q.click('[data-tab="patients"]')
    check("data persists after reload", "Δοκιμαστική" in q.inner_text("#patientList"))
    # visit from agenda with patient picker
    q.click('[data-tab="agenda"]'); q.click(".fab"); q.wait_for_selector("#pickerInput")
    q.fill("#notes", "draft kept"); q.fill("#pickerInput", "δοκιμ"); q.wait_for_selector("#pickerResults .row")
    q.click('#pickerResults [data-action="pickPatient"]'); q.wait_for_selector(".picked")
    check("picker keeps typed fields", q.input_value("#notes") == "draft kept")
    q.click(".savebtn"); q.wait_for_selector(".ph h2")
    # backup round-trip (crypto) via test hook
    r = q.evaluate("""async () => {
      const P = window.__practice;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await P.deriveKey('σωστή κωδική φράση 2026', salt, 600000);
      const kc = await P.makeKeyCheck(key, salt, 600000);
      const { bytes } = await P.buildBackup(key, kc);
      const parsed = P.parseBackupHeader(bytes);
      const body = await P.openBackup(bytes, key, parsed);
      let wrong = false;
      try { const k2 = await P.deriveKey('λάθος φράση 123456', salt, 600000); await P.openBackup(bytes, k2, parsed); } catch (e) { wrong = true; }
      // tamper with header -> must fail
      let tamper = false;
      try { const b2 = bytes.slice(); b2[12] ^= 1; const p2 = P.parseBackupHeader(b2); await P.openBackup(b2, key, p2); } catch (e) { tamper = true; }
      const plainVisible = new TextDecoder().decode(bytes).includes('Δοκιμαστική');
      return { size: bytes.length, patients: body.patients.length, visits: body.visits.length, att: body.attachments.length, attSize: body.attachments[0] && body.attachments[0].blob.size, wrong, tamper, plainVisible, compression: parsed.header.compression };
    }""")
    print("backup:", r)
    check("backup round-trip restores records", r["patients"] == 1 and r["visits"] == 2 and r["att"] == 1 and r["attSize"] > 0)
    check("wrong passphrase rejected", r["wrong"])
    check("tampered header rejected", r["tamper"])
    check("no plaintext names in file", not r["plainVisible"])
    # full UI restore flow from a file
    data = q.evaluate("""async () => {
      const P = window.__practice; const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await P.deriveKey('σωστή κωδική φράση 2026', salt, 600000); const kc = await P.makeKeyCheck(key, salt, 600000);
      const { bytes } = await P.buildBackup(key, kc); return Array.from(bytes); }""")
    ctx3 = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    n = ctx3.new_page(); n.on("pageerror", lambda e: errors.append("[restore] " + str(e)))
    n.goto(BASE); n.wait_for_selector(".week"); n.click('[data-tab="settings"]')
    n.set_input_files("#restoreInput", files=[{"name": "practice-backup.apb", "mimeType": "application/octet-stream", "buffer": bytes(data)}])
    n.wait_for_selector("#pp1"); n.fill("#pp1", "λάθος φράση 123456"); n.click(".sheet [data-ok]"); n.wait_for_selector(".sheet .err", timeout=15000)
    check("restore UI rejects wrong passphrase", n.locator(".sheet .err").count() == 1)
    n.fill("#pp1", "σωστή κωδική φράση 2026"); n.click(".sheet [data-ok]")
    n.wait_for_selector("text=Επαναφορά από αντίγραφο;", timeout=15000)
    n.screenshot(path=SHOTS + "09-restore-confirm.png")
    n.click(".sheet .btn.danger"); n.wait_for_selector(".week")
    n.click('[data-tab="patients"]')
    check("restore on a 'new phone' brings patients back", "Δοκιμαστική" in n.inner_text("#patientList"))
    n.click('[data-tab="settings"]')
    check("restored passphrase is active", "Ορίστηκε" in n.inner_text("main"))
    # offline: service worker
    q.goto(BASE); q.wait_for_timeout(1500)
    sw = q.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))")
    check("service worker active", sw)
    ctx2.set_offline(True); q.reload(); q.wait_for_selector(".week", timeout=5000)
    check("app opens offline", q.locator(".week").count() == 1)
    ctx2.set_offline(False)
    b.close()

for s, n in results: print(s, n)
print("errors:", errors or "none")
