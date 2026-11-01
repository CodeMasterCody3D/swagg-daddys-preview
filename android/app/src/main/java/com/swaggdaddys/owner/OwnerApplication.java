package com.swaggdaddys.owner;

import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

public final class OwnerApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        OwnerAlerts.createChannel(this);
        if (BuildConfig.PUSH_CONFIGURED) {
            FirebaseApp.initializeApp(this, new FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID).build());
        }
    }
}
