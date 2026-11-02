# Swagg Daddys Mobile Mechanics

Phone-first customer site at **https://swaggdaddys.com**, with a private owner inbox at `/owner/` for the future Android WebView wrapper.

The customer site keeps its logo, card artwork, large Call Now button, Text Me link, urgency selector, and explicit GPS consent. Saved requests activate only when `/api/health` confirms that owner access is configured. Until then, the form keeps its prepare/copy behavior without claiming to send requests or upload files.

## Owner inbox

- VINs now appear prominently on request cards and at the top of request details, including the original entered value when different. A clickable VIN opens an owner-authenticated resolver for CHARM manuals using year, make, model, cylinder count, displacement and drive. The VIN is decoded independently through NHTSA when the manual link is opened, including for older requests without saved specifications. The VIN and customer information are not sent to CHARM. An exact engine match opens its listed manual; ambiguous matches offer choices, and unavailable manuals show an explicit browse fallback. This does not connect registration, owner databases, or CARFAX records.
- Each request has tool-planning guidance with a suggested basic kit, relevant oil/brake/transmission prompts, and the vehicle-specific manual link. These suggestions are not a verified job tool inventory; exact sizes and manufacturer tools must be confirmed in the selected repair procedure. Registration, CARFAX integration, and an embedded AI chat are not implemented.

- Password login with no public signup. Verification runs on the server using scrypt or PBKDF2-SHA256.
- Customer list, search, status filter, private notes, and job status: New, Contacted, Scheduled, In progress, Completed, Cancelled.
- Tap a customer's number or Call button to open a `tel:` link. Android chooses a compatible dialer; Google Voice availability depends on the device. The future wrapper must handle telephone and SMS links with Android intents, using `ACTION_DIAL` for calls rather than placing calls automatically.
- GPS links open the shared vehicle location in Maps. Customers may decline GPS and enter an area instead.
- Up to 3 supported files, including at most 1 short video, under **4 MiB combined after automatic photo preparation**. Original photos may be up to 25 MiB each. This stays below Netlify's effective binary function request limit. Supported types: JPG, PNG, GIF, WebP, MP4, MOV, WebM. The server checks file signatures and type.
- Records and attachments require an authenticated owner session. Knowing the owner URL or spoofing a WebView user agent does not grant access.

## Remaining requested work

- In-page AI chat on both the customer form and private owner dashboard. The requested integration must stay inside the page, use no paid AI API, and support manual conversation; automatic hints/autofill are optional. It is not implemented. Duck.ai currently sends `X-Frame-Options: SAMEORIGIN` and a CSP `frame-ancestors` restricted to DuckDuckGo domains, so an ordinary embed on this domain is blocked. A supported embedded provider or local model remains to be selected; do not represent an external chat link as this feature.
- Background Android request alerts still require Firebase configuration and an end-to-end phone test. The native notification code and a standalone phone sound test are included in the owner app update described below.

## Android owner alerts

The owner app's three-dot menu includes **Notifications**, with **Enable alerts**, **Test sound**, and **Phone settings**. Test sound posts a local notification without enrolling the phone for customer alerts. New request alerts require owner sign-in, the Firebase server connection, and Android notification permission. The sound and vibration follow the phone's notification settings.

The server reads `FIREBASE_SERVICE_ACCOUNT_JSON` for FCM authorization and `FIREBASE_ANDROID_CONFIG_JSON` for the `com.swaggdaddysmobile` client. The authenticated session returns only validated public client options; service-account credentials remain server-only. The app can obtain those options after installation, so connecting Firebase does not require embedding a server key or rebuilding the APK. Missing configuration leaves incoming alerts unavailable and is explained in the Notifications menu.

A saved customer request queues a generic alert containing an event ID, without customer details. Delivery failures remain in a durable outbox for scheduled retries, and the app deduplicates received event IDs. Turning alerts off, signing out, changing the owner password, or an expired/revoked device registration stops delivery for that device. Tapping an alert opens the owner inbox, where normal authentication still applies.

Android checks validate local notification posting, the sound-test channel, duplicate-event handling, disabled alerts, invalid Firebase options, and the deployed sign-in page. They do not establish real FCM delivery to a physical phone. Release APK updates must retain the existing signing certificate.

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

Automated tests cover persistence, protected records/media, failed login, CSRF and cross-origin rejection, expiry, password rotation, logout, stale-edit conflicts, best-effort customer fields, consent, spoofed/oversize media, rate limits, cleanup after storage failure, VIN history, trash/restore, and production/preview storage isolation. Browser checks cover the 320/390/430 px owner layout and detail/edit flow using isolated fictional customers, including a submitted request appearing in the inbox. Deployed Netlify storage and real Android dialer behavior still require live/device verification.

The APK comes after deployed backend verification. It should load `/owner/` over HTTPS, retain authentication cookies, restrict in-WebView navigation to the approved site, and open telephone, SMS, and Maps links through external Android intents.

## VIN and uploads preview

`preview/vin-uploads` adds optional VIN lookup through the free, keyless NHTSA vPIC API, manufacturer-reported specifications, and VIN-label photo/barcode reading. ZXing-WASM 3.1.6 reads VIN barcodes locally. When enabled, Google Lens automatically reads photos without a complete barcode VIN; otherwise Tesseract.js 6.0.1 reads the printed text locally. VIN photos are not attached to the request. A scan that finds a single complete VIN automatically applies it and looks up vehicle details. Multiple candidates remain selectable; manual edits remain available. Clear photos and a network connection are needed; manual vehicle entry stays available. The decoder is for standardized 17-character VINs and cannot provide ownership or external service history.

All urgency levels accept the existing limit of 3 files / 4 MiB combined / at most 1 video. Optional VIN/specifications persist with requests and appear in the private owner dashboard. VIN history is owner-authenticated, paginated, and contains this business’s requests and notes, with completed jobs distinguished. Older records without a VIN are left intact and are not guessed or matched by customer name.

Do not merge to production until approved. A preview must set `window.SWAGG_PREVIEW = true` before intake.js, so test submissions remain local copy-only and do not contact the production backend.

Owner requests can be moved to Trash and restored. Delete requires confirmation in the dashboard and a current revision; authentication, same-origin checks, and CSRF protection apply. Trashed records disappear from active lists and VIN history. Notes, status, completion dates, and attachments remain recoverable. This is soft deletion, not permanent data erasure.

## Self-hosted VIN photo recognition

Upstream projects: https://github.com/naptha/tesseract.js (OCR), https://github.com/Sec-ant/zxing-wasm (ZXing-C++ barcode engine), and https://github.com/naptha/tessdata (English recognition data). Exact npm versions and integrity hashes are pinned in package-lock.json. `npm run build` copies scripts, WebAssembly engines, language data, and bundled notices into public/vendor; no CDN is needed by the default photo reader. These are served by Netlify. Barcode recognition runs on the customer's device. The Google Lens fallback described below sends the selected VIN image to Google only when enabled and no complete barcode VIN was found; local text recognition is used when Google is not enabled or its availability check fails.

Barcode decoding supports Code 39, Code 128, Code 93, PDF417, Data Matrix, and QR. A door label can have several barcodes; only one containing a complete VIN is useful for VIN entry. When Google is unavailable, local printed-text recognition uses multiple segmentation/preparation passes. One complete VIN is applied automatically and starts vehicle lookup. Customers can crop and retry, inspect recognized text, choose between multiple candidates, and edit the applied VIN. Automatically applied VINs remain editable before the customer submits the request. When multiple candidates require a choice, possible O/Q-to-0 and I-to-1 substitutions are explicitly marked. No guaranteed success on every photo; the customer's failed source image is still needed to reproduce that specific failure.

## Forgiving intake and large photos

Customer vehicle/contact fields are best-effort: unknown or partial VINs and failed decoder results do not block a request. The original VIN and contact text remain visible to the owner; only well-formed 17-character VINs link to vehicle history, and only dialable numbers become Call/Text links. The service-request disclosure is still required. Bad GPS values or malformed decoder metadata are ignored rather than rejecting the request.

Original photos may be up to 25 MiB each. media.js opens browser-readable formats (including AVIF, BMP, ICO, SVG, and HEIC where supported by the visitor's browser), converts alternate formats to JPEG, and resizes/compresses large images automatically before sending. Up to 3 selected files are prepared within the existing 4 MiB server payload budget. A file that cannot be prepared is explicitly marked as not attached; the request can still be sent. Video compression is not implemented; the existing limit of at most one short video remains. Files that bypass browser preparation still undergo server signature checks and size enforcement.

Blocking form or send errors use a large red alert directly beneath the submit button, explain the next action, and preserve entered fields. Informational VIN lookup failures do not prevent sending the service request.

## Optional Google Lens experiment

The `preview/google-lens-feasibility` branch connects the camera/photo picker through `POST /api/vin/photo` to `chrome-lens-ocr` 4.1.1 and returns complete VIN candidates to the existing form. A single candidate fills the VIN field and starts the existing NHTSA lookup. This uses an unofficial Google endpoint, not an iframe. The library documents operation without a Google account or a user-provided API key. On November 1, 2026, the user tested a real VIN photo on the deployed preview, compared the returned VIN against the image, and confirmed it matched; vehicle lookup also filled the car information. This is user-reported live verification.

The feature is disabled unless the Functions environment sets `GOOGLE_LENS_ENABLED=true`. The preview and production have this flag enabled after the November 1, 2026 production release. Every photo first goes through the existing local barcode reader. A complete barcode VIN (including multiple candidates awaiting review) finishes locally without sending the image to Google. If there is no complete barcode VIN, Google Lens is selected automatically when available; otherwise the existing local text reader is used. There is no reader-selection checkbox. A prominent notice beside the photo buttons explains the Google fallback before the visitor chooses an image. Photos are cropped/resized in the browser, converted to JPEG, limited to 2 MiB, and processed without saving the image or Google's raw reply. Recognition is independent of owner-login setup. Netlify must deploy the functions and their `sharp`/`chrome-lens-ocr` dependencies; a static GitHub Pages upload alone cannot provide this backend.

Verification responses, rate limits, and unexpected HTML stop the request without an automatic retry. This endpoint does not have an interactive browser session in which a visitor could complete Google's checkbox. The earlier browser verification must not be worked around through alternate endpoints, cookies, or network changes.

Validation on November 1, 2026: all 49 tests and the static build pass. Routing tests verify that barcode success never invokes Google, barcode misses automatically invoke Google, ambiguous barcode VINs remain review choices, unavailable Google uses local text, and Google verification errors do not retry. Protocol integration tests still simulate Google's response; the real recognition confirmation above came from the user's manual test on the deployed preview.

The optional service attachments also have a separate **Take photo** button alongside **Choose Files**. It uses native rear-camera capture where the browser supports it, preserves previously selected attachments, and uses the same photo preparation and upload limits.


### Barcode scaling follow-up

A supplied Honda door-label image reproduced a barcode miss: default bilinear enlargement returned only an unrelated small Data Matrix containing `VB`, while higher-quality enlargement decoded the long Code 39 VIN barcode. The reader now retains its original barcode pass and adds a high-quality scaling pass before Google fallback. An unrelated barcode does not stop that second pass. A persistent message identifies whether the applied VIN came from a barcode, Google Lens, or local text recognition. The supplied photo is used only for local diagnosis and is not included in this repository.

The enhanced pass now uses an explicit cubic pixel resampler, rather than the browser-dependent canvas quality hint. Direct tests of both supplied low-resolution copies and the higher-resolution working image recover their VINs. The image files are not included in the repository. Barcode check details retain image dimensions, completed passes, barcode payloads, and any engine-start failure so a Google fallback is distinguishable from a missed barcode.

### Full-screen camera controls, flashlight and guide-box reading

The live scanner is a full-screen camera with every control on top of the picture, so nothing needs scrolling in portrait or landscape: Close, **Light** (steady flashlight) and **Zoom** at the top; **Take photo** and **Phone camera** at the bottom (a right-hand column when the phone is sideways). Pinching the picture zooms the camera, not the page: the scanner sets `touch-action: none`, blocks iOS gesture zoom, and caps page zoom at 1 while open (restored on close). Zoom uses the camera's own zoom where the browser offers it (Chrome on Android) and otherwise scales the preview. The Zoom button steps 1×/2×/3×. The flashlight button appears only when the camera reports torch support; iPhone browsers currently do not, so it stays hidden there. Continuous autofocus is requested when available. Logic lives in `vin-camera.js`.

Each live read now starts with the band across the screen at the guide box, at native camera pixels, then the whole frame, then the existing enhanced passes. In Node with the bundled ZXing engine on a 1920×1080 frame, the guide area read in 20–55 ms versus 49–185 ms for the whole frame, and it found a 760 px-wide barcode the whole-frame read missed. In browser replay (synthetic portrait 1080×1920 camera stream, Code 39 VIN label, three runs each), time from the barcode appearing to the VIN filling: before 1,566 / 2,147 / 1,851 ms, after 563 / 587 / 602 ms. Desktop replay is not a phone measurement; camera focus, torch and zoom still need a physical-device check.

## Owner vehicle research

Requests and Tools are separate owner sections. The existing Requests search still filters saved tickets by name, phone, vehicle and VIN. Tools offers an independent VIN lookup and the existing CHARM repair manuals. Opening a saved request with a valid VIN automatically loads public vehicle research and the first page of that VIN’s Swagg Daddys service history. Customer descriptions remain above the report. Both research endpoints and saved history require an owner session.

Built-in sources: NHTSA vPIC extended manufacturer specifications and VIN check-digit advice; NHTSA model-level recall campaigns, the 20 most recent safety complaints, and selectable NCAP rating configurations; FuelEconomy.gov EPA engine/transmission options with selectable MPG details. A provider failure stays unavailable and does not become a clean-history result. Public provider responses are cached in bounded server memory for one hour; browser responses are no-store.

External checks: NICB VINCheck (theft/salvage, manual provider check with its limits), NMVTIS approved providers (title/odometer/brands; fees generally apply), CARFAX and AutoCheck (paid coverage), and TheBurnsy’s Vehicle OSINT collection. VIN copy is user-triggered; these links do not embed customer details or automatically query history providers. Theft and title/accident sections start as Not checked. No paid report is purchased automatically.

The requested OSINTCabal/VIN-Number-OSINT wrapper and idlesign/vininfo library were reviewed: their decoding and checksum roles are covered by the direct government integration and local checksum calculation, without an additional Python runtime. BelNaruto/free-vin-decoder could not be verified at the supplied repository URL. wanerllubbse/carfax-com-scraper contains a promotional README, not an executable scraper, so it is not installed or presented as a data feed. The free endpoints do not provide previous owners’ identities or a comprehensive accident history.

Validation: 55 automated tests pass, including authenticated-only research, partial provider failures, configuration selection, VIN checksums and all existing scanner/intake tests. Direct live-provider checks on the supplied 2018 Honda VIN returned specs, recalls, complaints, an NCAP configuration and EPA options.

## In-page live VIN camera

Live scan VIN opens a rear-camera video preview inside the customer page after the user grants camera permission. Barcode frames stay local, one decode at a time, and two matching complete VIN readings confirm the result before stopping all camera tracks and filling the VIN. Every fourth missed frame can use the existing enhanced barcode scaling. Camera access is restricted to the website origin; audio is never requested. Stop, page hiding/leaving, manual VIN input, choosing another image, form submission/reset, camera interruption and a confirmed match all release the camera. Pending permission or decoder results are invalidated when the scanner stops.

The live view has a Take photo button. It captures the current frame, stops the stream, and runs the existing barcode-first photo pipeline; when no barcode VIN is found, enabled Google Lens reads that single captured image. Live video is not uploaded. Saved-photo selection and an optional native phone-camera fallback remain available.

Live-camera checks cover two-frame confirmation, no audio permission, late permission grants, stale decoder results after stopping, ambiguous/invalid barcodes, recoverable errors, bounded frame capture, and captured-photo handoff to Google. Physical Android/iPhone camera focus and permissions still require a real-device test; desktop cloud-browser results are not a substitute.

### Live confirmation follow-up

An enhanced-only VIN read could never confirm: enhancement ran every fourth frame, and the next raw-frame miss reset the required consecutive match. The controller now keeps enhanced scanning enabled for the next confirmation frame after finding a VIN. A regression test fails against the old cadence and passes with the fix. Live barcode details also show frame count, camera dimensions, passes and recognized symbols for diagnosis. All 63 tests and the static build pass. This confirms the control-flow repair; the user's laptop camera image still needs a fresh live test. Google remains available only through the photo pipeline after local barcode attempts.

### Lower-rate sampling and closer barcode inspection

Live mode now samples locally every 500 ms and decodes only the clearest of each three-frame group, about once every 1.5 seconds plus processing time. A relative Laplacian edge-variance score selects a recent frame; it never substitutes for actual VIN barcode decoding. Each attempt runs the enhanced local passes, including 60% and 40% center crops before giving up on a barcode. The captured-photo path uses the same closer local crops before Google fallback. Explicit user-selected crop rectangles remain authoritative. The live panel exposes sample and barcode-attempt counts, and a camera that produces no frames stops with an explicit error.

Validation: all 66 tests and the static build pass. Browser QA feeds supplied images through a synthetic camera stream using the real production controller and ZXing engine, with no Google. Both native-size supplied labels read automatically. A moving/rotating small label that grows into a steady readable view also confirms its VIN automatically. A severely downsampled 480-pixel-wide label inside a 1280-pixel-wide frame still cannot be decoded reliably; software enlargement cannot guarantee recovery of lost bar detail. This is not a successful physical laptop-camera verification. No QA harness, supplied image, or alternate-decoder dependency is published.

### Real camera frames and local printed-text fallback

The supplied camera captures reproduce barcode failures with both ZXing and a separate Quagga comparison. The live barcode retries now include a full-width band that preserves both ends of a long label. After three barcode misses, the camera can read printed VIN text locally with the already-bundled Tesseract engine. Native-size frames use automatic-page and text-block recognition; scaling the supplied frames up made their text less reliable. No image is sent to Google from this live fallback.

Only exact, uncorrected text candidates with a matching VIN check digit qualify, and two matching fresh readings are still required before auto-fill. The UI identifies a printed-text result as text, never as a successful barcode decode. Barcode success takes precedence and does not load the text worker. There is one reader operation at a time; the text worker is reused for the session and closed on stop or match. A text-worker failure leaves barcode scanning available. Cancellation prevents late text results from changing the form. The captured-photo/Google Lens route is unchanged.

Validation: 71 automated checks and the build pass. In browser replay, a supplied 959×512 camera frame confirms `5J6YH287X8L000133` automatically from local printed text after two readings, without a photo-button click or Google. The existing barcode control confirms `1HGCV2F62JA012802` directly from the barcode with zero text checks. These checks do not prove that the unreadable bars were recovered or replace a physical-camera retest. Supplied photos and local QA routes are excluded from published assets.

### Faster live VIN recognition

The live reader now prepares its barcode engine while the camera opens, reads the first available frame immediately, and checks a candidate against the next fresh camera frame after 100 ms. After a miss, it chooses the sharpest of three samples 100 ms apart instead of waiting 1.5 seconds per reading. Unchanged video timestamps cannot count as separate confirmations. Only one decode runs at a time; camera startup retains its 10-second no-frame timeout. Cubic image preparation skips interpolation when the source and target dimensions already match, preserving the same pixels.

Barcode passes, the three-miss threshold for local text, exact text/check-digit rules, two matching readings, cancellation, and the captured-photo Google Lens route are preserved. Faster polling does more work per second while searching; mobile performance and camera focus still need an actual-device check.

Validation: 74 automated tests and the static build pass. Three browser replay runs per case, using the same images and real production readers, returned the same VINs before and after:

| Saved-frame case | Before, median | After, median |
| --- | ---: | ---: |
| Readable barcode, 1440×1920 | 3,258 ms | 331 ms |
| Printed-text fallback, 959×512 | 12,136 ms | 6,050 ms |

Timing runs from starting the replay scanner through the second confirmed VIN reading. It excludes physical camera permission/focus, mobile network loading, Google response time, and the subsequent vehicle lookup. The browser and dependencies were reused across runs, so these are controlled replay measurements rather than a cold-start or physical-phone speed guarantee. Supplied images and the temporary timing page are not published.
