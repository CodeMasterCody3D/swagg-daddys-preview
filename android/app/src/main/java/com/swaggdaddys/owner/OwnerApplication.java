package com.swaggdaddys.owner;

import android.app.Application;
import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import org.json.JSONObject;

public final class OwnerApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        OwnerAlerts.createChannel(this);
        try {
            if (BuildConfig.PUSH_CONFIGURED) configure(this, new JSONObject()
                    .put("appId",BuildConfig.FIREBASE_APP_ID).put("apiKey",BuildConfig.FIREBASE_API_KEY)
                    .put("senderId",BuildConfig.FIREBASE_SENDER_ID).put("projectId",BuildConfig.FIREBASE_PROJECT_ID));
            else configure(this,new JSONObject(getSharedPreferences(OwnerAlerts.PREFS,0).getString("firebaseConfig","{}")));
        } catch (Exception ignored) { /* The owner can reconnect from Notifications. */ }
    }
    static boolean configured() {
        try { FirebaseApp.getInstance(); return true; } catch (IllegalStateException ignored) { return false; }
    }
    /** Called only with the same-origin authenticated session response, never page JavaScript. */
    static synchronized boolean configure(Context context, JSONObject config) {
        if (config == null) return configured();
        String appId=config.optString("appId"),apiKey=config.optString("apiKey"),
                sender=config.optString("senderId"),project=config.optString("projectId");
        if(!appId.matches("1:[0-9]+:android:[a-f0-9]+") || !apiKey.matches("AIza[\\w-]{35}")
                || !sender.matches("[0-9]+") || !project.matches("[a-z][a-z0-9-]{4,62}")
                || !appId.startsWith("1:"+sender+":"))return false;
        try {
            if(configured()) {
                FirebaseOptions options=FirebaseApp.getInstance().getOptions();
                return appId.equals(options.getApplicationId()) && project.equals(options.getProjectId());
            }
            FirebaseApp.initializeApp(context.getApplicationContext(),new FirebaseOptions.Builder()
                    .setApplicationId(appId).setApiKey(apiKey).setGcmSenderId(sender).setProjectId(project).build());
            JSONObject saved=new JSONObject().put("appId",appId).put("apiKey",apiKey).put("senderId",sender).put("projectId",project);
            context.getSharedPreferences(OwnerAlerts.PREFS,0).edit().putString("firebaseConfig",saved.toString()).apply();
            return true;
        } catch(Exception ignored) { return false; }
    }
}
