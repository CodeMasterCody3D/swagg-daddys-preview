package com.swaggdaddys.owner;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.widget.Toast;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

final class OwnerPushController {
    static final int PERMISSION = 720;
    private final Activity activity;
    private final SharedPreferences preferences;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private boolean resumed, destroyed, busy, signedIn, serverReady, prompted;
    private String registeredCookie="", registeredToken="";
    private final Runnable poll=new Runnable(){public void run(){sync(false);if(resumed)handler.postDelayed(this,10000);}};
    OwnerPushController(Activity activity) {
        this.activity=activity;preferences=activity.getSharedPreferences(OwnerAlerts.PREFS,0);
    }
    void resume(){resumed=true;handler.removeCallbacks(poll);handler.post(poll);}
    void pause(){resumed=false;handler.removeCallbacks(poll);}
    void destroy(){destroyed=true;pause();network.shutdownNow();}
    private void ui(Runnable action){activity.runOnUiThread(()->{if(!destroyed&&!activity.isFinishing())action.run();});}
    private void message(String text){Toast.makeText(activity,text,Toast.LENGTH_LONG).show();}
    private void sync(boolean report) {
        if(busy||destroyed)return;
        String cookie=CookieManager.getInstance().getCookie(OwnerPushClient.ORIGIN);
        if(cookie==null||!cookie.contains("__Host-swagg_session=")){signedIn=false;if(report)message("Sign in to the owner inbox first.");return;}
        busy=true;
        network.execute(()->{
            try {
                OwnerPushClient.Reply session=OwnerPushClient.request("/session","GET",cookie,null,null);
                boolean authenticated=session.status==200, ready=session.body.optBoolean("notificationsReady");
                String token=preferences.getString("token","");
                boolean enabled=preferences.getBoolean("enabled",false)&&OwnerAlerts.allowed(activity);
                boolean registered=false;
                if(authenticated && preferences.getBoolean("disablePending",false)) {
                    OwnerPushClient.Reply removed=OwnerPushClient.request("/notifications/device","DELETE",cookie,session.body.getString("csrf"),new JSONObject().put("id",OwnerPushClient.deviceId(activity)));
                    if(removed.status==200)preferences.edit().putBoolean("disablePending",false).apply();
                }
                if(authenticated && ready && enabled && !token.isEmpty()
                        && (!cookie.equals(registeredCookie)||!token.equals(registeredToken))) {
                    OwnerPushClient.Reply reply=OwnerPushClient.request("/notifications/device","POST",cookie,session.body.getString("csrf"),new JSONObject().put("id",OwnerPushClient.deviceId(activity)).put("token",token));
                    if(reply.status!=200)throw new java.io.IOException("Registration failed");
                    registered=true;
                }
                final boolean didRegister=registered;
                ui(()->{
                    signedIn=authenticated;serverReady=ready;
                    if(didRegister){registeredCookie=cookie;registeredToken=token;if(report)message("New service request alerts are enabled.");}
                    if(!authenticated){registeredCookie="";activity.getSystemService(NotificationManager.class).cancel(OwnerAlerts.ID);if(report)message("Sign in to connect notifications.");}
                    else if(report&&!ready)message("The server notification connection still needs setup.");
                    else if(!preferences.getBoolean("asked",false)&&BuildConfig.PUSH_CONFIGURED&&ready&&resumed&&!prompted){prompted=true;explain();}
                });
            } catch(Exception ignored) {if(report)ui(()->message("Could not connect notifications. Check your connection and retry."));}
            finally {ui(()->busy=false);}
        });
    }
    void settings() {
        if(!BuildConfig.PUSH_CONFIGURED){message("Notifications need Firebase setup and a configured app update.");return;}
        if(!signedIn){sync(true);return;}
        if(!serverReady){message("The server notification connection still needs setup.");return;}
        if(!preferences.getBoolean("enabled",false)){explain();return;}
        new AlertDialog.Builder(activity).setTitle("Service request notifications")
                .setMessage(OwnerAlerts.allowed(activity)?"Notifications are enabled. Alerts open your private owner inbox.":"Android is blocking notifications. Open phone settings to allow alerts.")
                .setPositiveButton("Phone settings",(d,w)->activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,activity.getPackageName())))
                .setNeutralButton("Turn off",(d,w)->disable())
                .setNegativeButton("Close",null).show();
    }
    private void explain() {
        preferences.edit().putBoolean("asked",true).apply();
        new AlertDialog.Builder(activity).setTitle("Get new request alerts?")
                .setMessage("Allow Swagg Daddys to notify you when a customer requests service, even when the inbox is closed. Tap an alert to open your private inbox.")
                .setPositiveButton("Enable alerts",(d,w)->{
                    if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                        activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},PERMISSION);
                    else enable();
                }).setNegativeButton("Not now",null).show();
    }
    void permissionResult(boolean granted){if(granted)enable();else message("Alerts stay off. You can enable them from Notifications in the app menu.");}
    private void enable() {
        if(!OwnerAlerts.allowed(activity)){message("Allow Swagg Daddys notifications in phone settings.");return;}
        preferences.edit().putBoolean("enabled",true).putBoolean("disablePending",false).apply();
        FirebaseMessaging messaging=FirebaseMessaging.getInstance();messaging.setAutoInitEnabled(true);
        messaging.getToken().addOnCompleteListener(task->{
            if(destroyed)return;
            if(!task.isSuccessful()){message("Notification setup could not finish. Try Notifications again from the app menu.");return;}
            preferences.edit().putString("token",task.getResult()).apply();registeredToken="";sync(true);
        });
    }
    private void disable() {
        preferences.edit().putBoolean("enabled",false).putBoolean("disablePending",true).apply();
        registeredCookie="";registeredToken="";
        activity.getSystemService(NotificationManager.class).cancel(OwnerAlerts.ID);
        FirebaseMessaging.getInstance().setAutoInitEnabled(false);
        sync(false);message("New request alerts are off on this phone.");
    }
}
