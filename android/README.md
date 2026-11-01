# Swagg Daddys Owner for Android

A lightweight native WebView wrapper for https://swaggdaddys.com/owner/.

## Use

Install the signed APK on Android 8.0 or later. Sign in using the existing owner account and the password chosen on the website. Server sessions expire after 12 hours; signing out or changing the password invalidates them. No password, password hash, customer record, API token, or signing key is embedded in the APK or repository.

Request photos load automatically using the deployed owner's page. Video playback stays inside the request. Calling a customer opens Android's dialer with the number ready, without placing a call or requesting call permissions. SMS and Maps links open compatible installed apps. Android Back closes an open service-request dialog before leaving the screen. Use the three-dot menu to refresh, open the browser, or text the service upload link. The text option pre-fills the selected customer's number, or lets the owner enter a caller's number, then opens the SMS composer with the website link; the owner sends it. Saving a private blob attachment uses the browser and its own owner login.

The app uses HTTPS, checks the exact permitted host, disables local-file/content access, disallows mixed content and third-party cookies, and does not expose a JavaScript-to-native bridge. It retains the website's session cookie in the app's private WebView storage and excludes it from backups. The owner app does not request the owner's GPS, camera, storage, contacts, or phone permissions; customer GPS and media arrive through the website.

Owner authentication protects the backend. A simple wrapper is not app attestation and does not make the server cryptographically app-only.

## Build

Use JDK 17, Gradle 8.11.1, Android SDK 36, build-tools 36.0.0, and Android Gradle Plugin 8.9.2. From the repository root, run `python android/scripts/make-icon.py` with Pillow installed, then run these commands in `android/`:

```sh
gradle testDebugUnitTest bundleRelease assembleRelease
gradle connectedDebugAndroidTest
```

The GitHub Actions workflow builds an unsigned release AAB and APK, tests navigation rules, validates the AAB with Google's checksum-verified bundletool, and runs Android 16 emulator checks against an APK generated from the release bundle. The device test never signs in or submits a customer request. The generated test APK uses the disposable Android debug certificate; it is not a distribution artifact.

For Google Play, sign `app/build/outputs/bundle/release/app-release.aab` with the retained private key using JDK `jarsigner`, then verify its signature and validate it with bundletool. Upload the signed **.aab** in Play Console's App bundles section. An **.apk** is for direct installation and is not an app-bundle upload. The current bundle targets API 36 and uses version code 3 (version 1.0.2). Its application ID is `com.swaggdaddysmobile`, matching the package required by the existing Play Console app. The Java namespace remains `com.swaggdaddys.owner`.

For direct installation, sign the unsigned release APK with Android's `apksigner`. Reuse the retained key and increase versionCode for future updates. Do not commit any signing keys or passwords. Google Play App Signing can use a different distribution certificate from the upload certificate; an APK installed directly can only update in place when its signing certificate matches the distributed update.

The app loads the live website, so ordinary inbox improvements do not require reinstalling the APK. A physical-device check of the phone's chosen dialer/SMS/Maps applications remains necessary after installation.

## Service request notifications (1.0.3 / version code 4)

This update adds native Firebase Cloud Messaging alerts, an Android notification channel, notification permission on Android 13+, and a Notifications menu. A generic alert opens the authenticated inbox; names, VINs, locations, photos, and repair details are not included in push messages. Enrollment requires owner login and CSRF protection. Sign-out removes that session’s registered devices; changing the owner password invalidates enrolled devices. Device enrollment expires after 90 days and is renewed while the app is open. A normal 12-hour web session expiry does not stop generic alerts, but the owner must sign in again to view requests.

Activation requires a Firebase project with Android package `com.swaggdaddysmobile`. Download that app's `google-services.json` and set its entire contents as the GitHub Actions secret `FIREBASE_ANDROID_CONFIG_JSON` (or the same environment variable for local builds). This is client configuration, never the service-account private key. Builds without configuration stay usable but explicitly report that push setup is missing; they do not claim alerts are connected. Firebase Analytics is not included and messaging auto-initialization stays off until the owner opts in.

In the existing Netlify project's server-only Functions environment, set `FIREBASE_SERVICE_ACCOUNT_JSON` to a service account with permission to send FCM messages in the same project. Never place that JSON in Git, the public website, the APK, logs, or chat. Enable the FCM HTTP v1 API and redeploy. A short-lived OAuth access token is minted server-side. New requests enqueue generic events in private Netlify Blobs and attempt immediate delivery; a scheduled function retries pending deliveries every five minutes for up to 24 hours. Successful FCM acceptance does not guarantee a phone displayed the message. Force-stopping the app, disabled notifications, network loss, and OS power restrictions can prevent or delay alerts.

Install the newly signed APK, or release the updated AAB through Play using the existing signing identity. Sign in and enable alerts when prompted (or App menu → Notifications). Allow Android's notification permission. Test with the app in the background and a clearly labeled service request. Confirm sound/banner and tapping the alert opens the owner inbox. End-to-end FCM delivery remains unverified until the project is configured and that device test passes.
