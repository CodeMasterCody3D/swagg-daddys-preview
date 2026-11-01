package com.swaggdaddys.owner;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class OwnerMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) { OwnerPushClient.registerRefreshedToken(this,token); }
    @Override public void onMessageReceived(RemoteMessage message) {
        if(!"service_request".equals(message.getData().get("type")))return;
        String eventId=message.getData().get("eventId");
        if(eventId!=null && eventId.matches("[a-f0-9-]{36}"))OwnerAlerts.show(this,eventId);
    }
}
