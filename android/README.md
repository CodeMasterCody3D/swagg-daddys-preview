# Swagg Daddys Owner for Android

A lightweight native WebView wrapper for https://swaggdaddys.com/owner/.

## Use

Install the signed APK on Android 8.0 or later. Sign in using the existing owner account and the password chosen on the website. Server sessions expire after 12 hours; signing out or changing the password invalidates them. No password, password hash, customer record, API token, or signing key is embedded in the APK or repository.

Request photos load automatically using the deployed owner's page. Video playback stays inside the request. Calling a customer opens Android's dialer with the number ready, without placing a call or requesting call permissions. SMS and Maps links open compatible installed apps. Android Back closes an open service-request dialog before leaving the screen. Use the three-dot menu to refresh or open the browser. Saving a private blob attachment uses the browser and its own owner login.

The app uses HTTPS, checks the exact permitted host, disables local-file/content access, disallows mixed content and third-party cookies, and does not expose a JavaScript-to-native bridge. It retains the website's session cookie in the app's private WebView storage and excludes it from backups. The owner app does not request the owner's GPS, camera, storage, contacts, or phone permissions; customer GPS and media arrive through the website.

Owner authentication protects the backend. A simple wrapper is not app attestation and does not make the server cryptographically app-only.

## Build

Use JDK 17, Gradle 8.11.1, Android SDK 35, build-tools 35.0.0, and Android Gradle Plugin 8.9.2. From the repository root, run `python android/scripts/make-icon.py` with Pillow installed, then run these commands in `android/`:

```sh
gradle testDebugUnitTest assembleRelease
gradle connectedDebugAndroidTest
```

The GitHub Actions workflow builds an unsigned release APK, tests navigation rules, and runs Android 15 emulator checks against the logged-out live owner page. The device test never signs in or submits a customer request. Sign the unsigned release with the retained private signing key using Android's apksigner before distribution. Reuse that key and increase versionCode for future updates. Do not commit any signing keys or passwords.

The app loads the live website, so ordinary inbox improvements do not require reinstalling the APK. A physical-device check of the phone's chosen dialer/SMS/Maps applications remains necessary after installation.
