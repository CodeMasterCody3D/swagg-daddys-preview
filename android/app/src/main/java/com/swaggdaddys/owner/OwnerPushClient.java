package com.swaggdaddys.owner;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;

/** Same-origin API requests reuse the private WebView cookie; no password is copied. */
final class OwnerPushClient {
    static final String ORIGIN = "https://swaggdaddys.com";
    static final class Reply {
        final int status; final JSONObject body;
        Reply(int status, JSONObject body) { this.status=status; this.body=body; }
    }
    static Reply request(String path, String method, String cookie, String csrf, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + "/api" + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Cookie", cookie == null ? "" : cookie);
            connection.setRequestProperty("Cache-Control", "no-store");
            if (body != null) {
                connection.setRequestProperty("Origin", ORIGIN);
                connection.setRequestProperty("X-CSRF-Token", csrf);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int status=connection.getResponseCode();
            java.io.InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            String text="{}";
            if(input!=null)try(java.io.InputStream stream=input){
                java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
                byte[] chunk=new byte[2048]; int count;
                while((count=stream.read(chunk))!=-1){out.write(chunk,0,count);if(out.size()>16384)throw new java.io.IOException("Oversized API response");}
                text=new String(out.toByteArray(),StandardCharsets.UTF_8);
            }
            return new Reply(status,new JSONObject(text));
        } finally { connection.disconnect(); }
    }
    static synchronized String deviceId(Context context) {
        SharedPreferences prefs=context.getSharedPreferences(OwnerAlerts.PREFS,0);
        String id=prefs.getString("deviceId",null);
        if(id==null){id=UUID.randomUUID().toString();prefs.edit().putString("deviceId",id).apply();}
        return id;
    }
    static void registerRefreshedToken(Context context, String token) {
        SharedPreferences prefs=context.getSharedPreferences(OwnerAlerts.PREFS,0);
        prefs.edit().putString("token",token).apply();
        if(!prefs.getBoolean("enabled",false)||!OwnerAlerts.allowed(context))return;
        try {
            String cookie=CookieManager.getInstance().getCookie(ORIGIN);
            Reply session=request("/session","GET",cookie,null,null);
            if(session.status==200 && session.body.optBoolean("notificationsReady")) {
                request("/notifications/device","POST",cookie,session.body.getString("csrf"),
                        new JSONObject().put("id",deviceId(context)).put("token",token));
            }
        } catch(Exception ignored) { /* The next foreground sync retries registration. */ }
    }
}
