package com.swaggdaddys.owner;

import java.net.URI;

/** Only the trusted owner page may request video. Never grant microphone access. */
public final class CameraPolicy {
    public static final String VIDEO = "android.webkit.resource.VIDEO_CAPTURE";
    private CameraPolicy() { }
    public static boolean allowed(String origin, String page, String[] resources) {
        if (!NavigationPolicy.trustedOrigin(origin) || !NavigationPolicy.trustedOrigin(page)
                || resources == null || resources.length != 1 || !VIDEO.equals(resources[0])) return false;
        try { return new URI(origin).getHost().equalsIgnoreCase(new URI(page).getHost()); }
        catch (Exception ignored) { return false; }
    }
}
