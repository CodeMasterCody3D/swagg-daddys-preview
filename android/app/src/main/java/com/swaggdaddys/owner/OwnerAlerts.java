package com.swaggdaddys.owner;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.media.AudioAttributes;
import android.provider.Settings;
import java.util.LinkedHashSet;
import java.util.Set;

public final class OwnerAlerts {
    static final String CHANNEL = "service_requests";
    static final int ID = 410;
    static final int TEST_ID = 411;
    static final String PREFS = "owner_push";
    private OwnerAlerts() { }
    public static void createChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL,
                "New service requests", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts when a customer sends a service request");
        channel.enableVibration(true);
        channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static boolean allowed(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED)
                && context.getSystemService(NotificationManager.class).areNotificationsEnabled()
                && context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL)
                .getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    public static synchronized void show(Context context, String eventId) {
        if (!allowed(context) || !context.getSharedPreferences(PREFS, 0).getBoolean("enabled", false)) return;
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, 0);
        Set<String> seen = new LinkedHashSet<>(preferences.getStringSet("seen", new LinkedHashSet<>()));
        if (seen.contains(eventId)) return;
        post(context, ID, "New service request", "A customer needs help. Tap to open the owner inbox.");
        seen.add(eventId);
        while (seen.size() > 64) seen.remove(seen.iterator().next());
        preferences.edit().putStringSet("seen", seen).apply();
    }
    static void test(Context context) {
        if (allowed(context)) post(context, TEST_ID, "Swagg Daddys test alert",
                "Sound test only. New request alerts must be connected separately.");
    }
    private static void post(Context context, int id, String title, String text) {
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification alert = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_service_notification).setContentTitle(title).setContentText(text)
                .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(false)
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).build();
        context.getSystemService(NotificationManager.class).notify(id, alert);
    }

}
