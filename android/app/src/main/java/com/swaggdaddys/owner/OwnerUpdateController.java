package com.swaggdaddys.owner;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;
import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** User-requested APK download, kept in the app until the Android installer opens. */
final class OwnerUpdateController {
    private final Activity activity;
    private final DownloadManager downloads;
    private final SharedPreferences state;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AlertDialog dialog;
    private boolean active;
    private long announced = -1;
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!active) return;
            refresh(false);
            int status = status();
            if (active && (status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_RUNNING
                    || status == DownloadManager.STATUS_PAUSED)) handler.postDelayed(this, 1500);
        }
    };

    OwnerUpdateController(Activity activity) {
        this.activity = activity;
        downloads = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        state = activity.getSharedPreferences("ownerUpdates", Context.MODE_PRIVATE);
    }
    boolean hasDownload() { return state.getLong("id", -1) != -1; }
    void resume() { active = true; handler.removeCallbacks(poll); handler.post(poll); }
    void pause() { active = false; handler.removeCallbacks(poll); }
    void destroy() { pause(); if (dialog != null) dialog.dismiss(); }

    void start(String url) {
        if (!UpdatePolicy.isApk(url)) return;
        int existing = status();
        if (existing == DownloadManager.STATUS_PENDING || existing == DownloadManager.STATUS_RUNNING
                || existing == DownloadManager.STATUS_PAUSED) { show(); return; }
        try {
            if (hasDownload()) downloads.remove(state.getLong("id", -1));
            String name = Uri.parse(url).getLastPathSegment();
            String localName = "owner-update-" + System.currentTimeMillis() + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(name).setDescription("Swagg Daddys owner app update")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, localName);
            long id = downloads.enqueue(request);
            state.edit().putLong("id", id).putString("name", name).putString("file", localName).apply();
            announced = -1;
            Toast.makeText(activity, "Downloading APK from GitHub…", Toast.LENGTH_SHORT).show();
            show(); resume();
        } catch (RuntimeException error) {
            state.edit().clear().apply();
            message("Download could not start", "Check your connection and available storage, then tap Download APK again.");
        }
    }

    void show() {
        if (!hasDownload()) { message("No downloaded update", "Choose a version in Updates to download its APK."); return; }
        refresh(true);
    }
    private int status() {
        if (!hasDownload()) return -1;
        try (Cursor row = downloads.query(new DownloadManager.Query().setFilterById(state.getLong("id", -1)))) {
            return row != null && row.moveToFirst() ? row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) : -1;
        } catch (RuntimeException error) { return -1; }
    }
    private void refresh(boolean force) {
        if (!hasDownload() || activity.isFinishing()) return;
        long id = state.getLong("id", -1);
        try (Cursor row = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (row == null || !row.moveToFirst()) {
                state.edit().clear().apply();
                if (force || dialog != null) message("Download unavailable", "Download the APK again from Updates.");
                return;
            }
            int status = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                if (!force && announced == id) return;
                announced = id;
                File file = localFile();
                String problem = validatePackage(activity, file);
                if (problem != null) { message("Cannot install this APK", problem); return; }
                closeDialog();
                dialog = new AlertDialog.Builder(activity).setTitle("Update downloaded")
                        .setMessage(state.getString("name", "Owner app APK") + " is ready. Android will ask you to confirm installation.")
                        .setPositiveButton("Install", (ignored, which) -> install())
                        .setNegativeButton("Later", null).create();
                showDialog();
            } else if (status == DownloadManager.STATUS_FAILED) {
                if (!force && announced == id) return;
                announced = id;
                message("Download failed", "Check your connection and storage, then choose Download APK again in Updates.");
            } else {
                long bytes = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                String progress = status == DownloadManager.STATUS_PAUSED ? "Waiting for a connection…"
                        : total > 0 ? "Downloading from GitHub: " + (bytes * 100 / total) + "%" : "Starting download from GitHub…";
                if (force) {
                    closeDialog();
                    dialog = new AlertDialog.Builder(activity).setTitle("Downloading owner app")
                            .setMessage(progress + "\nYou can close this and keep using the inbox.")
                            .setNegativeButton("Close", null).create(); showDialog();
                } else if (dialog != null) dialog.setMessage(progress + "\nYou can close this and keep using the inbox.");
            }
        } catch (RuntimeException error) {
            if (force) message("Download unavailable", "Please try downloading the APK again from Updates.");
        }
    }
    private File localFile() {
        File directory = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        String name = state.getString("file", "");
        return directory == null || !name.matches("owner-update-[0-9]+\\.apk") ? null : new File(directory, name);
    }

    @SuppressWarnings("deprecation")
    static String validatePackage(Context context, File file) {
        if (file == null || !file.isFile()) return "The download is no longer available. Download it again from Updates.";
        try {
            PackageManager pm = context.getPackageManager();
            PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
            PackageInfo installed = pm.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES);
            if (archive == null || !context.getPackageName().equals(archive.packageName)) return "This file is not the Swagg Daddys owner app.";
            Set<Signature> actual = new HashSet<>(Arrays.asList(archive.signatures == null ? new Signature[0] : archive.signatures));
            Set<Signature> expected = new HashSet<>(Arrays.asList(installed.signatures == null ? new Signature[0] : installed.signatures));
            if (actual.isEmpty() || !actual.equals(expected)) return "The APK signature does not match this installed app. Download an official release signed with the original key.";
            long next = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
            long current = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
            if (next < current) return "This APK is older than your installed app. Android cannot install it as an update. Your current app has been kept.";
            return null;
        } catch (Exception error) { return "The APK could not be verified. Download it again from Updates."; }
    }

    private void install() {
        String problem = validatePackage(activity, localFile());
        if (problem != null) { message("Cannot install this APK", problem); return; }
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                closeDialog();
                dialog = new AlertDialog.Builder(activity).setTitle("Allow this app to install its update")
                        .setMessage("In Android settings, enable Allow from this source, then return here and tap Install.")
                        .setPositiveButton("Open settings", (ignored, which) -> {
                            announced = -1;
                            try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
                            catch (RuntimeException error) { message("Settings unavailable", "Enable installation for Swagg Daddys in Android settings, then open Downloaded update from the app menu."); }
                        }).setNegativeButton("Cancel", null).create(); showDialog(); return;
            }
            Uri uri = downloads.getUriForDownloadedFile(state.getLong("id", -1));
            if (uri == null) { message("Download unavailable", "Download the APK again from Updates."); return; }
            Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(install);
        } catch (RuntimeException error) { message("Installer unavailable", "Android could not open the downloaded APK. Try again from Downloaded update in the app menu."); }
    }
    private void closeDialog() { if (dialog != null) dialog.dismiss(); dialog = null; }
    private void showDialog() {
        AlertDialog showing = dialog;
        showing.setOnDismissListener(ignored -> { if (dialog == showing) dialog = null; }); showing.show();
    }
    private void message(String title, String text) {
        if (activity.isFinishing()) return;
        closeDialog(); dialog = new AlertDialog.Builder(activity).setTitle(title).setMessage(text).setPositiveButton("OK", null).create(); showDialog();
    }
}
