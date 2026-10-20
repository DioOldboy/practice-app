"""Drive sync and register import against a mocked Google (sign-in, Drive v3, Sheets v4)."""
import json, re, time, urllib.parse, os, pathlib
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8765/")
SHOTS = str(pathlib.Path(__file__).resolve().parent.parent / "test-shots") + "/"
os.makedirs(SHOTS, exist_ok=True)
results, errors = [], []
def check(name, cond): results.append(("PASS" if cond else "FAIL", name))

DRIVE = {}          # id -> {name, mimeType, parents, trashed, data}
UPLOADS = {}
counter = [0]
def nid(): counter[0] += 1; return "f%d" % counter[0]
SHEET_ROWS = [["ΜΑΡΚ", "Ημερομηνία", "Επωνυμία", "ΑΦΜ", "Σύνολο", "Παρατηρήσεις"],
              ["500001", "05/10/2026", "ΑΝΤΩΝΙΟΥ ΠΕΤΡΟΣ", "111222333", "70,00", ""],
              ["500002", "06/10/2026", "ΙΑΤΡΙΚΟ ΚΕΝΤΡΟ ΒΗΤΑ Α.Ε.", "999888777", "900,00", "Χειρουργείο ασθενούς Αντωνίου Πέτρου"],
              ["500003", "07/10/2026", "ΓΕΩΡΓΙΟΥ ΕΛΕΝΗ", "", "50,00", ""]]
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Expose-Headers": "Location"}

def jresp(route, obj, status=200, extra=None):
    h = dict(CORS); h["Content-Type"] = "application/json"
    if extra: h.update(extra)
    route.fulfill(status=status, headers=h, body=json.dumps(obj))

def google(route):
    req = route.request
    u = urllib.parse.urlparse(req.url); q = urllib.parse.parse_qs(u.query)
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    auth = req.headers.get("authorization", "")
    if "/upload/session/" in u.path:
        UPLOADS_id = u.path.rsplit("/", 1)[1]; meta = UPLOADS.pop(UPLOADS_id)
        fid = nid(); DRIVE[fid] = dict(meta, data=req.post_data_buffer, trashed=False, createdTime=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()))
        return jresp(route, {"id": fid})
    if auth != "Bearer tok-123": return jresp(route, {"error": {"message": "unauthorized"}}, 401)
    if u.netloc == "sheets.googleapis.com":
        if u.path.endswith("/values/" + urllib.parse.quote("'Τιμολόγια'", safe="")) or "/values/" in u.path:
            return jresp(route, {"values": SHEET_ROWS})
        return jresp(route, {"properties": {"title": "Μητρώο τιμολογίων"}, "sheets": [{"properties": {"title": "Τιμολόγια"}}]})
    if u.path == "/upload/drive/v3/files" and q.get("uploadType") == ["resumable"]:
        sid = nid(); UPLOADS[sid] = json.loads(req.post_data)
        h = dict(CORS); h["Location"] = "https://www.googleapis.com/upload/session/" + sid
        return route.fulfill(status=200, headers=h, body="")
    m = re.match(r"^/drive/v3/files/([^/]+)$", u.path)
    if m:
        f = DRIVE.get(m.group(1))
        if not f: return jresp(route, {"error": {"message": "not found"}}, 404)
        if req.method == "PATCH": f.update(json.loads(req.post_data)); return jresp(route, {"id": m.group(1)})
        if q.get("alt") == ["media"]:
            h = dict(CORS); h["Content-Type"] = "application/octet-stream"; return route.fulfill(status=200, headers=h, body=f["data"])
        return jresp(route, {"id": m.group(1), "trashed": f["trashed"]})
    if u.path == "/drive/v3/files":
        if req.method == "POST":
            meta = json.loads(req.post_data); fid = nid(); DRIVE[fid] = dict(meta, trashed=False, parents=[], data=b""); return jresp(route, {"id": fid})
        qs = q.get("q", [""])[0]
        if "folder" in qs:
            hits = [k for k, f in DRIVE.items() if f.get("mimeType") == "application/vnd.google-apps.folder" and not f["trashed"]]
        else:
            parent = re.search(r"'([^']+)' in parents", qs).group(1)
            hits = [k for k, f in DRIVE.items() if parent in (f.get("parents") or []) and not f["trashed"]]
            hits.sort(key=lambda k: DRIVE[k]["createdTime"], reverse=True)
        return jresp(route, {"files": [{"id": k, "name": DRIVE[k]["name"], "size": str(len(DRIVE[k]["data"])), "createdTime": DRIVE[k].get("createdTime", "")} for k in hits]})
    jresp(route, {"error": {"message": "unmocked " + req.method + " " + u.path}}, 500)

def oauth(route):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)
    assert q["scope"] == ["https://www.googleapis.com/auth/drive.file"], q["scope"]
    loc = q["redirect_uri"][0] + "#" + urllib.parse.urlencode({"access_token": "tok-123", "expires_in": "3600", "scope": q["scope"][0], "state": q["state"][0], "token_type": "Bearer"})
    route.fulfill(status=302, headers={"Location": loc})

CONFIG = 'window.PRACTICE_CONFIG = { googleClientId: "test.apps.googleusercontent.com", googleApiKey: "k", googleProjectNumber: "1" };'

def setup(ctx):
    ctx.route("**/config.js", lambda r: r.fulfill(status=200, headers={"Content-Type": "application/javascript"}, body=CONFIG))
    ctx.route("https://accounts.google.com/**", oauth)
    ctx.route("https://www.googleapis.com/**", google)
    ctx.route("https://sheets.googleapis.com/**", google)

def backups(): return [f for f in DRIVE.values() if f.get("name", "").endswith(".apb") and not f["trashed"]]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, service_workers="block")
    setup(ctx)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(BASE); pg.wait_for_selector(".week")
    pg.click('[data-tab="settings"]')
    check("drive section shows not connected", "Μη συνδεδεμένο" in pg.inner_text("main"))
    pg.click('[data-action="driveConnect"]'); pg.wait_for_selector("#pp2")
    pg.fill("#pp1", "δοκιμαστική φράση 2026"); pg.fill("#pp2", "δοκιμαστική φράση 2026"); pg.click(".sheet [data-ok]")
    pg.wait_for_selector("text=Συνδεδεμένο", timeout=20000)
    check("sign-in round trip connects Drive", True)
    for _ in range(40):
        if backups(): break
        pg.wait_for_timeout(250)
    check("first encrypted copy uploaded to Drive folder", len(backups()) == 1)
    folder = [k for k, f in DRIVE.items() if f.get("mimeType") == "application/vnd.google-apps.folder"]
    check("app folder created once", len(folder) == 1 and backups()[0]["parents"] == folder)
    check("Drive copy is ciphertext", b"APBK" == backups()[0]["data"][:4] and "ΑΝΤΩΝΙΟΥ".encode() not in backups()[0]["data"])
    # register import from Google Sheets
    pg.evaluate("window.__practice.setMeta('registerFile', {id: 'sheet1', name: 'Μητρώο τιμολογίων'})")
    pg.click('[data-tab="agenda"]'); pg.click('[data-tab="settings"]')
    pg.click('[data-action="registerUpdate"]'); pg.wait_for_selector("#map_name", timeout=10000)
    pg.screenshot(path=SHOTS + "20-import-preview.png", full_page=True)
    txt = pg.inner_text("main")
    check("sheet columns auto-mapped", pg.input_value("#map_name") == "Επωνυμία" and pg.input_value("#map_ref") == "ΜΑΡΚ" and pg.input_value("#map_amount") == "Σύνολο")
    check("preview: 2 patients, 3 visits, 1 hospital", re.search(r"Νέοι ασθενείς\s+2", txt) and re.search(r"Νέες επισκέψεις\s+3", txt) and re.search(r"Νοσοκομεία / κλινικές\s+1", txt))
    pg.click('[data-action="importDo"]'); pg.wait_for_selector("text=Μητρώο τιμολογίων")
    pg.click('[data-tab="patients"]')
    lst = pg.inner_text("#patientList")
    check("imported patients listed", "Αντωνιου Πετρος" in lst and "Γεωργιου Ελενη" in lst)
    pg.fill("#patientSearch", "111222333")
    check("search by tax ID", "Αντωνιου" in pg.inner_text("#patientList"))
    pg.click("#patientList .row"); pg.wait_for_selector(".timeline")
    check("hospital invoice became surgery visit at the clinic", "Χειρουργείο" in pg.inner_text(".timeline") and "Ιατρικο Κεντρο Βητα" in pg.inner_text(".timeline"))
    pg.screenshot(path=SHOTS + "21-imported-patient.png", full_page=True)
    # second import: nothing new
    pg.go_back(); pg.wait_for_selector("#patientSearch"); pg.click('[data-tab="settings"]'); pg.click('[data-action="registerUpdate"]'); pg.wait_for_selector("#map_name")
    check("second import finds nothing new", pg.locator('[data-action="importDo"][disabled]').count() == 1 and re.search(r"Ήδη εισηγμένα\s+3", pg.inner_text("main")))
    pg.go_back()
    # automatic copy after changes (15 s debounce)
    n0 = len(backups())
    for _ in range(80):
        if len(backups()) > n0: break
        pg.wait_for_timeout(250)
    check("import triggered automatic Drive copy", len(backups()) > n0)
    # CSV import path
    csv = "Αρ.;Ημ/νία;Πελάτης;Ποσό\n900;12/10/2026;ΔΗΜΑ ΑΝΝΑ;40\n"
    pg.click('[data-tab="settings"]')
    pg.set_input_files("#csvInput", files=[{"name": "register.csv", "mimeType": "text/csv", "buffer": csv.encode("utf-8")}])
    pg.wait_for_selector("#map_name")
    check("csv import maps columns", pg.input_value("#map_name") == "Πελάτης" and pg.input_value("#map_date") == "Ημ/νία")
    pg.click('[data-action="importDo"]'); pg.wait_for_timeout(300)
    # new phone: restore from Drive
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, service_workers="block")
    setup(ctx2)
    q = ctx2.new_page(); q.on("pageerror", lambda e: errors.append("[phone2] " + str(e)))
    pg.wait_for_timeout(16500)  # let the last change sync
    q.goto(BASE); q.wait_for_selector(".week"); q.click('[data-tab="settings"]')
    q.click('[data-action="driveRestore"]')
    q.wait_for_selector("[data-pick]", timeout=20000)
    q.screenshot(path=SHOTS + "22-restore-pick.png")
    q.click("[data-pick] >> nth=0"); q.wait_for_selector("#pp1", timeout=20000)
    q.fill("#pp1", "δοκιμαστική φράση 2026"); q.click(".sheet [data-ok]")
    q.wait_for_selector("text=Επαναφορά από αντίγραφο;", timeout=20000); q.click(".sheet .btn.danger")
    q.wait_for_selector(".week"); q.click('[data-tab="patients"]')
    lst2 = q.inner_text("#patientList")
    check("new phone restored from Drive, incl. latest CSV import", "Αντωνιου" in lst2 and "Δημα Αννα" in lst2)
    q.click('[data-tab="settings"]')
    check("new phone is connected and keeps the register link", "Συνδεδεμένο" in q.inner_text("main") and "Μητρώο τιμολογίων" in q.inner_text("main"))
    b.close()

for s_, n in results: print(s_, n)
print("drive files:", len(DRIVE), "backups:", len(backups()))
print("errors:", errors or "none")
