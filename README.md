# Swagg Daddys Mobile Mechanics

Phone-first customer site at **https://swaggdaddys.com**, with a private owner inbox at `/owner/` for the future Android WebView wrapper.

The customer site keeps its logo, card artwork, large Call Now button, Text Me link, urgency selector, and explicit GPS consent. Saved requests activate only when `/api/health` confirms that owner access is configured. Until then, the form keeps its prepare/copy behavior without claiming to send requests or upload files.

## Owner inbox

- Password login with no public signup. Verification runs on the server using scrypt or PBKDF2-SHA256.
- Customer list, search, status filter, private notes, and job status: New, Contacted, Scheduled, In progress, Completed, Cancelled.
- Tap a customer's number or Call button to open a `tel:` link. Android chooses a compatible dialer; Google Voice availability depends on the device. The future wrapper must handle telephone and SMS links with Android intents, using `ACTION_DIAL` for calls rather than placing calls automatically.
- GPS links open the shared vehicle location in Maps. Customers may decline GPS and enter an area instead.
- Up to 3 supported files, including at most 1 short video, under **4 MiB combined**. This stays below Netlify's effective binary function request limit. Supported types: JPG, PNG, GIF, WebP, MP4, MOV, WebM. The server checks file signatures and type.
- Records and attachments require an authenticated owner session. Knowing the owner URL or spoofing a WebView user agent does not grant access.

## Hosting and activation

GitHub Pages serves static assets only. Netlify runs the functions and supplies private, durable Netlify Blobs storage. Production data survives deployments. Preview deployments use isolated stores. No customer data, sessions, or credentials are written to this repository or the static publish directory.

1. Connect **this repository** to the existing Netlify project for `swaggdaddys.com`, deploying `main`. Use `netlify.toml`: build `npm run build`, publish `public`, functions `netlify/functions`, Node 22. Manual static drag-and-drop alone cannot deploy the backend; use the Git integration or Netlify CLI with functions.
2. Open `/owner/password-helper.html` over HTTPS to choose a unique password of at least 14 characters. The helper derives a PBKDF2-SHA256 value with 600,000 iterations locally; the actual password is never sent by the helper. Alternatively, on a trusted computer with Node 22+, run `npm ci`, then `npm run owner-password` to produce a scrypt hash at a hidden prompt.
3. In the existing project's Netlify environment variables, set **OWNER_PASSWORD_HASH** to the complete generated value and **OWNER_USERNAME** to the desired login name (default `owner`). Scope the hash to Functions and Production where the plan supports scoping, and store it as a secret. Do not commit a real password or its hash. Redeploy to apply the variables.
4. Open `https://swaggdaddys.com/owner/`, sign in, and submit an explicitly marked test request. Verify it appears, attachments load, changes persist, and signing out blocks access. Local checks do not replace this first deployed check.

`site-config.js` contains only the public backend origin. It connects the GitHub Pages intake to the custom domain and redirects GitHub owner access to the same-origin Netlify dashboard. The production form uses its own `/api` origin. Additional customer-form origins can be supplied in the server-only PUBLIC_SITE_ORIGINS environment variable as a comma-separated allowlist.

The password is never embedded in the website or APK. Login creates a random server-stored session with an HttpOnly, Secure, SameSite=Strict cookie and 12-hour expiry. Mutations require a matching origin and per-session CSRF token. Logout revokes the session; changing the password hash revokes existing sessions. Login and intake have persistent per-IP throttling plus a Netlify edge limit. Customer responses use `no-store`. Owner edits use conditional writes to avoid silently overwriting newer changes.

This implements **owner-authenticated access**, not cryptographic proof that a request came from the Android app. A simple webpage wrapper cannot enforce app-only access. Strong app-only enforcement would need device enrollment or app attestation.

## Development and verification

```sh
npm ci
npm test
npm run build
```

`npm run dev` uses a separate local SQLite adapter; deployed Netlify functions never use local disk for persistence. Fixture configuration is ignored at `.openai/qa.json`. QA routes exist only in the local development server, never in the deployed functions. The build copies an explicit list of browser assets; server code, tests, local data, and QA configuration are excluded from the static publish directory.

Eight tests cover persistence, protected records/media, failed login, CSRF and cross-origin rejection, expiry, password rotation, logout, stale-edit conflicts, consent/GPS/phone validation, spoofed/oversize media, rate limits, cleanup after storage failure, and production/preview storage isolation. Browser checks cover the 320/390/430 px owner layout and detail/edit flow using isolated fictional customers, including a submitted request appearing in the inbox. Deployed Netlify storage and real Android dialer behavior still require live/device verification.

The APK comes after deployed backend verification. It should load `/owner/` over HTTPS, retain authentication cookies, restrict in-WebView navigation to the approved site, and open telephone, SMS, and Maps links through external Android intents.

## VIN and uploads preview

`preview/vin-uploads` adds optional VIN lookup through the free, keyless NHTSA vPIC API, manufacturer-reported specifications, and VIN-label photo/barcode reading. ZXing 0.1.5 and Tesseract.js 6.0.1 load on demand from jsDelivr; images are processed locally and not attached to the request. Review recognized VINs before lookup. Clear photos and a network connection are needed; manual vehicle entry stays available. The decoder is for standardized 17-character VINs and cannot provide ownership or external service history.

All urgency levels accept the existing limit of 3 files / 4 MiB combined / at most 1 video. Optional VIN/specifications persist with requests and appear in the private owner dashboard. VIN history is owner-authenticated, paginated, and contains this business’s requests and notes, with completed jobs distinguished. Older records without a VIN are left intact and are not guessed or matched by customer name.

Do not merge to production until approved. A preview must set `window.SWAGG_PREVIEW = true` before intake.js, so test submissions remain local copy-only and do not contact the production backend.
