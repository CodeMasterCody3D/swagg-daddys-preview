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
import android.net.Uri;
import android.provider.Settings;
import android.graphics.drawable.Icon;
import java.util.LinkedHashSet;
import java.util.Set;

public final class OwnerAlerts {
    static final String CHANNEL = "service_requests";
    // Stranded/urgent requests: a three-ring sound and triple vibration. Android fixes a
    // channel's sound when it is created, so this is a separate channel.
    static final String URGENT_CHANNEL = "urgent_service_requests";
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
        NotificationChannel urgent = new NotificationChannel(URGENT_CHANNEL,
                "Stranded and urgent requests", NotificationManager.IMPORTANCE_HIGH);
        urgent.setDescription("Rings three times and repeats every 15 minutes until you open the request");
        urgent.enableVibration(true);
        urgent.setVibrationPattern(new long[]{0, 450, 250, 450, 250, 450});
        urgent.setSound(Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.urgent_triple),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        context.getSystemService(NotificationManager.class).createNotificationChannel(urgent);
    }
    static boolean allowed(Context context) { return allowed(context, CHANNEL); }
    static boolean allowed(Context context, String channel) {
        NotificationChannel settings = context.getSystemService(NotificationManager.class).getNotificationChannel(channel);
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED)
                && context.getSystemService(NotificationManager.class).areNotificationsEnabled()
                && settings != null && settings.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    public static synchronized void show(Context context, String eventId) {
        show(context,eventId,null,null);
    }
    public static synchronized void show(Context context, String eventId, String customerName, String requestSummary) {
        show(context, eventId, customerName, requestSummary, false, false);
    }
    public static synchronized void show(Context context, String eventId, String customerName, String requestSummary,
                                         boolean urgent, boolean reminder) {
        // If the owner switched the urgent channel off in Android settings, fall back to the normal one.
        String channel = urgent && allowed(context, URGENT_CHANNEL) ? URGENT_CHANNEL : CHANNEL;
        if (!allowed(context, channel) || !context.getSharedPreferences(PREFS, 0).getBoolean("enabled", false)) return;
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS, 0);
        Set<String> seen = new LinkedHashSet<>(preferences.getStringSet("seen", new LinkedHashSet<>()));
        if (seen.contains(eventId)) return;
        post(context, ID, NotificationContent.title(customerName, urgent, reminder), NotificationContent.summary(requestSummary), channel);
        seen.add(eventId);
        while (seen.size() > 64) seen.remove(seen.iterator().next());
        preferences.edit().putStringSet("seen", seen).apply();
    }
    static void test(Context context) {
        if (allowed(context)) post(context, TEST_ID, "Swagg Daddys test alert",
                "Test only — Jordan: Car will not start. Normal requests ding once and repeat hourly until opened.", CHANNEL);
    }
    // The stranded/urgent sound: three rings, repeated every 15 minutes until opened.
    static void testUrgent(Context context) {
        if (allowed(context, URGENT_CHANNEL)) post(context, TEST_ID, "URGENT · Swagg Daddys test alert",
                "Test only — stranded and urgent requests ring three times and repeat every 15 minutes until opened.", URGENT_CHANNEL);
    }
    private static void post(Context context, int id, String title, String text, String channel) {
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification publicAlert = new Notification.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_service_notification).setContentTitle("New service request")
                .setContentText("Unlock to view the customer and request.").build();
        Notification alert = new Notification.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_service_notification)
                .setLargeIcon(Icon.createWithResource(context,R.mipmap.ic_launcher))
                .setColor(0xff47edbd).setContentTitle(title).setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setPublicVersion(publicAlert)
                .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(false)
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).build();
        context.getSystemService(NotificationManager.class).notify(id, alert);
    }

}
