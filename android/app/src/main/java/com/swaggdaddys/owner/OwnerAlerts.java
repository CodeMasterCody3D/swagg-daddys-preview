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
import java.util.LinkedHashSet;
import java.util.Set;

public final class OwnerAlerts {
    static final String CHANNEL = "service_requests";
    static final int ID = 410;
    static final String PREFS = "owner_push";
    private OwnerAlerts() { }
    public static void createChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL,
                "New service requests", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts when a customer sends a service request");
        channel.enableVibration(true);
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
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, ID, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification alert = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_service_notification)
                .setContentTitle("New service request")
                .setContentText("A customer needs help. Tap to open the owner inbox.")
                .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(false)
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE)
                .build();
        context.getSystemService(NotificationManager.class).notify(ID, alert);
        seen.add(eventId);
        while (seen.size() > 64) seen.remove(seen.iterator().next());
        preferences.edit().putStringSet("seen", seen).apply();
    }
}
