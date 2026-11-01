# Google Lens VIN connection experiment

This isolated experiment is excluded from the production build's explicit asset list. It does not replace the current scanner or implement an AI chat service.

## Prompt and response handling

`reply.mjs` supplies a prompt requesting only a complete VIN, or `UNREADABLE` when any character is uncertain. The parser accepts one complete VIN with a digit, tolerates outer whitespace and case, and rejects surrounding prose, multiple VINs, partial values, and forbidden VIN letters. It does not silently substitute characters. A well-formed answer is only a candidate; its content still needs comparison with the photo. No prompt guarantees an accurate transcription.

The preview's sample reply is fictional test input, not a live response from Google. `UNREADABLE` and rejected answers clear the sample result.

## Observations, 2026-11-01

- Earlier normal browser upload read the synthetic VIN `1HGCM82633A004352` correctly, in an existing signed-in Google session. The user separately reported a successful signed-out test.
- A local page embedded the verified Google Images URL `https://www.google.com/search?hl=en&udm=49&udf=257` and attempted an ordinary read of the frame document. No photo or VIN was transmitted by that experiment.
- The browser raised `SecurityError`: a frame from the local preview origin could not access the cross-origin document. This is the browser's same-origin boundary, independent of response formatting.
- Google also returned an unusual-traffic verification page in the frame. No CAPTCHA was attempted. Google requests stopped, and the live frame was removed from this preview to avoid retrying the block.
- No end-to-end transport from Google Lens to the public website has been implemented or verified. This experiment does not establish that server-side or native approaches are impossible.

## Human verification design constraint

The user's requested flow allows a person to complete Google's original verification when necessary. The verification page appeared inside the original Google frame in this test; it was not transplanted into the local document. Copying an isolated checkbox or treating a local CAPTCHA as Google's verification would not establish that the Google request was authorized. A future browser-session design would need to preserve Google's original session and challenge, allow the person to interact with that session, and independently implement the result return. No verification token copying, replay, or security-header removal has been implemented. This architecture remains unverified; solving a challenge alone would not remove the ordinary cross-origin boundary observed in the test.

References: [browser same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) and [cloud-browser site blocks](https://help.openai.com/articles/20001280-using-cloud-browser-in-chatgpt#when-a-website-blocks-the-task).

## Browser-service investigation

The original successful browser upload was performed by the development assistant. That session is not a production backend the website can call or share with visitors.

A possible separate architecture is an isolated, signed-out browser per visitor, an interactive viewer of that browser when needed, and a backend result channel to the original form. The source Google page and challenge would stay intact. This remains a proposal, not a tested Lens integration.

- [noVNC's official embedding documentation](https://novnc.com/noVNC/docs/EMBEDDING.html) describes a browser-based viewer backed by a VNC server and WebSocket proxy. It can supply the viewer component without a hosted-provider account; it still needs a running remote desktop/browser server. It does not implement photo uploads, Lens recognition, session isolation, or return the VIN by itself.
- [Browserless's embedding documentation](https://docs.browserless.io/baas/monitor-sessions/embedding-live-url) describes a ready-made interactive browser viewer and a backend completion relay. Its documented managed path requires an account API token. It has not been installed, connected, or used here.
- [Netlify's function configuration](https://docs.netlify.com/build/functions/configuration/) documents finite execution lifetimes, including 60 seconds for synchronous functions and 15 minutes for background functions. [Background functions](https://docs.netlify.com/build/functions/background-functions/) do not stream a response to the visitor. These constraints inform the proposal to host the persistent interactive browser separately; they do not establish that all browser processing on Netlify is impossible.
- The current project has no configured browser-server endpoint. This development container has no Docker, Podman, Chromium, Xvfb, or x11vnc executable available. No browser-service runtime has been deployed. Browser interaction here remains through the approved cloud-browser controls.

Before implementation can be verified, a host for the browser service is needed. Testing must then demonstrate visitor isolation, expiry and cleanup, private photo handling, a human completing the original Google challenge in the same session, and a correct VIN returning to that visitor's form. Verification requests must pause at a challenge; no solver, token replay, fingerprint changes, or proxy switching are part of this design.

### Correction: a browser server is required for that proposal, not proven necessary for every Lens method

Source review found [chrome-lens-ocr](https://github.com/dimdenGD/chrome-lens-ocr), whose author documents recognition without a running headless browser or Google login. The reviewed `src/core.js` directly constructs and submits a binary request to a Google Lens endpoint, sends an API-key header, and decodes text from the response. It does not read an ordinary cross-origin iframe. This is an unofficial API-based approach, so it does not meet a strict no-API requirement. No library was installed, no endpoint was called, and no Google request was retried through it. It is not verified in this project.

The prior iframe failure establishes only that direct DOM access was blocked in the tested page. It does not establish the impossibility of every other integration or prove a persistent browser server is universally necessary. A different endpoint must not be used to evade the Google verification encountered in the current browser test.

## Controller-assisted transfer iteration

The original Google result tab remained open with its earlier synthetic-image result. Using the development browser controller, a DOM-backed read of the visible recognized-text button yielded `1HGCM82633A004352`. The controller passed that extracted string (without substituting a hardcoded VIN) into this experiment's reply field and clicked Parse. Reading the destination input confirmed an exact match. This reused the retained page without a new Google upload, query, or verification attempt.

Changing the reply to `UNREADABLE` immediately cleared the prior candidate, and parsing the uncertain reply left it empty. Restoring the actual extracted reply returned the expected candidate. These browser checks passed.

This verifies a controller-assisted transfer from the existing Google page to a local test field. It does not verify fresh photo processing, an iframe-only integration, an independent website worker, a signed-out automated session, or a production feature. The development controller has not been exposed as a public website backend.

## Additional requested work

- Add a separate **Take photo** button next to the optional service-request file chooser. User asked to continue Google work first; the camera-button change has not been implemented in this experiment.

## Local preview

Use the Sites preview runner with this directory. No new dependencies are required. The small server serves only the experiment page and its parser. The parser uses the same 17-character VIN alphabet restriction as the site's VIN helpers. The production server and build have not been modified.
