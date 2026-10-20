# Practice app

An installable, offline-first web app (PWA) for a private orthopedic practice: patients, visit history, locations, notes and attached files. Interface in Greek and English.

## Where the data lives

- **No patient data is in this repository, ever.** The code is public; the data is not.
- All records stay on the phone, in the browser's IndexedDB for this site.
- Backups are single encrypted files (`.apb`), made from **Settings → Backups** and saved through the Android share sheet (e.g. to Google Drive).
  - AES-256-GCM, key derived from the user's passphrase with PBKDF2-SHA-256 (600,000 iterations).
  - The file header (salt, IV, date) is authenticated together with the ciphertext.
  - Without the passphrase a backup cannot be opened. There is no recovery path by design.
- Sample patients exist only in the preview build (`tools/build.py` → `preview/preview.html`) and are fictional.

## Layout

| Path | What it is |
|---|---|
| `app/` | The app exactly as published (no build step) |
| `app/sw.js` | Offline cache of the app shell. Bump `VERSION` on every release |
| `.github/workflows/pages.yml` | Publishes `app/` to GitHub Pages on every push to `main` |
| `tools/build.py` | Builds `dist/` and the single-file preview with sample data |
| `tools/test_app.py` | End-to-end checks in headless Chromium at phone size |

## Releasing a change

1. Edit files under `app/`.
2. Bump `APP_VERSION` in `app/app.js` and `VERSION` in `app/sw.js`.
3. Push to `main`. The workflow publishes within a minute or two; installed copies pick up the new version on their next launch.

## Security notes

- Strict Content Security Policy in `index.html`: scripts only from this site, no third-party code.
- All user text is escaped before rendering.
- Keep two-factor authentication on the GitHub account: whoever can push to `main` controls the code that runs on the phone.
