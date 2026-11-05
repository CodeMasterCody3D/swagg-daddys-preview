# Swagg Daddys Owner for Android

A lightweight native WebView wrapper for https://swaggdaddys.com/owner/.

## Use

Install the signed APK on Android 8.0 or later. Sign in using the existing owner account and the password chosen on the website. Server sessions expire after 12 hours; signing out or changing the password invalidates them. No password, password hash, customer record, API token, or signing key is embedded in the APK or repository.

Request photos load automatically using the deployed owner's page. Video playback stays inside the request. Calling a customer opens Android's dialer with the number ready, without placing a call or requesting call permissions. SMS and Maps links open compatible installed apps. Android Back closes an open service-request dialog before leaving the screen. Use the three-dot menu to refresh, open the browser, or text the service upload link. The text option pre-fills the selected customer's number, or lets the owner enter a caller's number, then opens the SMS composer with the website link; the owner sends it. Saving a private blob attachment uses the browser and its own owner login.

The app uses HTTPS, checks the exact permitted host, disables local-file access and permits system-picked image content, disallows mixed content and third-party cookies, and does not expose a JavaScript-to-native bridge. It retains the website's session cookie in the app's private WebView storage and excludes it from backups. The owner app requests location only for mileage estimates and camera only when starting a live VIN scan on the trusted website. VIN photo uploads use Android’s image picker without storage permission. Microphone, contacts and phone permissions are not requested; customer GPS and media arrive through the website.

Owner authentication protects the backend. A simple wrapper is not app attestation and does not make the server cryptographically app-only.

## Build

Use JDK 17, Gradle 8.11.1, Android SDK 36, build-tools 36.0.0, and Android Gradle Plugin 8.9.2. From the repository root, run `python android/scripts/make-icon.py` with Pillow installed, then run these commands in `android/`:

```sh
gradle testDebugUnitTest bundleRelease assembleRelease
gradle connectedDebugAndroidTest
```

The GitHub Actions workflow builds an unsigned release AAB and APK, tests navigation rules, validates the AAB with Google's checksum-verified bundletool, and runs Android 16 emulator checks against an APK generated from the release bundle. The device test never signs in or submits a customer request. The generated test APK uses the disposable Android debug certificate; it is not a distribution artifact.

For Google Play, sign `app/build/outputs/bundle/release/app-release.aab` with the retained private key using JDK `jarsigner`, then verify its signature and validate it with bundletool. Upload the signed **.aab** in Play Console's App bundles section. An **.apk** is for direct installation and is not an app-bundle upload. The current bundle targets API 36 and uses version code 5 (version 1.0.4). Its application ID is `com.swaggdaddysmobile`, matching the package required by the existing Play Console app. The Java namespace remains `com.swaggdaddys.owner`.

For direct installation, sign the unsigned release APK with Android's `apksigner`. Reuse the retained key and increase versionCode for future updates. Do not commit any signing keys or passwords. Google Play App Signing can use a different distribution certificate from the upload certificate; an APK installed directly can only update in place when its signing certificate matches the distributed update.

The app loads the live website, so ordinary inbox improvements do not require reinstalling the APK. A physical-device check of the phone's chosen dialer/SMS/Maps applications remains necessary after installation.

## Direct GitHub updates

After owner sign-in, the top-right Updates button lists public APK assets from GitHub Releases in this repository. The app adds its actual versionName/versionCode to its WebView user agent; the page compares the installed version with the latest stable APK release and shows an update badge. Ordinary browsers only show downloads. Checks run on sign-in and returning to the page (at most once every five minutes); Check again retries immediately. Older releases are paginated. GitHub API failures do not interrupt the inbox.

Publish version tags such as `v1.0.4` with the original-key-signed `Swagg-Daddys-Owner-1.0.4.apk`. Draft, incomplete, unsigned and debug assets are excluded. Netlify serves only release metadata UI; the APK is downloaded directly from GitHub's asset URL, without proxying the binary through Netlify.

The Android wrapper intercepts only direct APK asset links for this repository. DownloadManager saves the APK in this app's external files directory without owner cookies or storage permission. The app verifies package name, signing certificate and version before offering Install. Android's per-source permission and installer confirmation remain required. Closing the download dialog keeps the download running; the three-dot menu's Downloaded update action reopens it. Older builds without the version/download handler need a one-time manual installation of 1.0.4 or later.
