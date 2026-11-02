package com.swaggdaddys.owner;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NotificationSmokeTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final NotificationManager notifications=context.getSystemService(NotificationManager.class);
    @Before public void reset() throws Exception { clear(); }
    @After public void clear() throws Exception {
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().clear().commit();
        notifications.cancelAll();
        // Android removes posted notifications asynchronously. Wait before the
        // next case so an old sound-test alert cannot satisfy its appearance check.
        long deadline=SystemClock.elapsedRealtime()+3000;
        while(notifications.getActiveNotifications().length!=0&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(50);
        assertEquals("Previous test notifications must be removed",0,notifications.getActiveNotifications().length);
    }
    private Notification awaitAlert(int id) throws Exception {
        long deadline=SystemClock.elapsedRealtime()+3000;
        do {
            for(StatusBarNotification posted:notifications.getActiveNotifications()) {
                if(posted.getId()==id)return posted.getNotification();
            }
            Thread.sleep(50);
        } while(SystemClock.elapsedRealtime()<deadline);
        throw new AssertionError("Expected notification ID "+id+" was not posted");
    }
    @Test public void allowedAlertAppearsInAndroidAndRetryDoesNotDuplicateIt() throws Exception {
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .grantRuntimePermission(context.getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putBoolean("enabled",true).commit();
        OwnerAlerts.createChannel(context);
        OwnerAlerts.show(context,"11111111-1111-1111-1111-111111111111");
        Notification alert=awaitAlert(OwnerAlerts.ID);
        assertEquals(1,notifications.getActiveNotifications().length);
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
    @Test public void requestAlertShowsCustomerPreviewAndBrandLogoWithPrivateLockScreenText() throws Exception {
        android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        ui.grantRuntimePermission(context.getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putBoolean("enabled",true).commit();
        OwnerAlerts.createChannel(context);
        OwnerAlerts.show(context,"33333333-3333-3333-3333-333333333333","Jordan Smith","Car will not start. Clicking sound when I turn the key.");
        Notification alert=awaitAlert(OwnerAlerts.ID);
        assertEquals("Jordan Smith · Service request",alert.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("Car will not start. Clicking sound when I turn the key.",alert.extras.getString(Notification.EXTRA_TEXT));
        assertEquals(R.drawable.ic_service_notification,alert.getSmallIcon().getResId());
        assertNotNull(alert.getLargeIcon());
        assertEquals(R.mipmap.ic_launcher,alert.getLargeIcon().getResId());
        assertEquals(Notification.VISIBILITY_PRIVATE,alert.visibility);
        assertNotNull(alert.publicVersion);
        assertEquals("New service request",alert.publicVersion.extras.getString(Notification.EXTRA_TITLE));
        assertNotNull(alert.contentIntent);
        ui.executeShellCommand("cmd statusbar expand-notifications").close();
        SystemClock.sleep(400);
        android.graphics.Bitmap picture=ui.takeScreenshot();
        assertNotNull(picture);
        try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getExternalFilesDir(null),"notification-preview.png"))) {
            assertTrue(picture.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out));
        } finally { picture.recycle(); ui.executeShellCommand("cmd statusbar collapse").close(); }
    }
    @Test public void explicitSoundTestWorksWithoutServerEnrollment() throws Exception {
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .grantRuntimePermission(context.getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putBoolean("enabled",false).commit();
        OwnerAlerts.createChannel(context);
        OwnerAlerts.test(context);
        Notification alert=awaitAlert(OwnerAlerts.TEST_ID);
        assertEquals(1,notifications.getActiveNotifications().length);
        assertEquals("Swagg Daddys test alert",alert.extras.getString(Notification.EXTRA_TITLE));
        assertNotNull(notifications.getNotificationChannel(OwnerAlerts.CHANNEL).getSound());
        assertFalse(context.getSharedPreferences(OwnerAlerts.PREFS,0).getBoolean("enabled",false));
    }
    @Test public void urgentRequestsUseTheThreeRingChannelAndSayUrgent() throws Exception {
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .grantRuntimePermission(context.getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putBoolean("enabled",true).commit();
        OwnerAlerts.createChannel(context);
        OwnerAlerts.show(context,"44444444-4444-4444-4444-444444444444","Jordan Smith","Stuck on I-65.",true,true);
        Notification alert=awaitAlert(OwnerAlerts.ID);
        assertEquals(OwnerAlerts.URGENT_CHANNEL,alert.getChannelId());
        assertEquals("URGENT · Still waiting · Jordan Smith · Service request",alert.extras.getString(Notification.EXTRA_TITLE));
        android.app.NotificationChannel urgent=notifications.getNotificationChannel(OwnerAlerts.URGENT_CHANNEL);
        assertEquals(NotificationManager.IMPORTANCE_HIGH,urgent.getImportance());
        assertTrue(urgent.getSound().toString().endsWith("/"+R.raw.urgent_triple));
        assertEquals(6,urgent.getVibrationPattern().length);
    }
    @Test public void malformedServerConfigurationCannotInitializeFirebase() throws Exception {
        assertFalse(OwnerApplication.configure(context,new org.json.JSONObject()
                .put("appId","wrong").put("apiKey","invalid").put("senderId","123").put("projectId","example-project")));
        assertEquals("",context.getSharedPreferences(OwnerAlerts.PREFS,0).getString("firebaseConfig",""));
    }

}
