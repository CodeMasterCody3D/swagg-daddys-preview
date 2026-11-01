package com.swaggdaddys.owner;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NotificationSmokeTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final NotificationManager notifications=context.getSystemService(NotificationManager.class);
    @After public void clear() {
        notifications.cancel(OwnerAlerts.ID);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().clear().commit();
    }
    @Test public void allowedAlertAppearsInAndroidAndRetryDoesNotDuplicateIt() throws Exception {
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .grantRuntimePermission(context.getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putBoolean("enabled",true).commit();
        OwnerAlerts.createChannel(context);
        OwnerAlerts.show(context,"11111111-1111-1111-1111-111111111111");
        long deadline=System.currentTimeMillis()+3000;
        while(notifications.getActiveNotifications().length==0&&System.currentTimeMillis()<deadline)Thread.sleep(50);
        assertEquals(1,notifications.getActiveNotifications().length);
        Notification alert=notifications.getActiveNotifications()[0].getNotification();
        assertEquals("New service request",alert.extras.getString(Notification.EXTRA_TITLE));
        assertNotNull(alert.contentIntent);
        OwnerAlerts.show(context,"11111111-1111-1111-1111-111111111111");
        assertEquals(1,notifications.getActiveNotifications().length);
        assertEquals(NotificationManager.IMPORTANCE_HIGH,notifications.getNotificationChannel(OwnerAlerts.CHANNEL).getImportance());
    }
    @Test public void disabledOwnerAlertsDoNotPostEvenWhenAndroidPermissionIsAllowed() {
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .grantRuntimePermission(context.getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putBoolean("enabled",false).commit();
        OwnerAlerts.show(context,"22222222-2222-2222-2222-222222222222");
        assertEquals(0,notifications.getActiveNotifications().length);
    }
}
