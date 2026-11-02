package com.swaggdaddys.owner;

import java.net.URI;
import java.util.Locale;

/** Pure routing policy, also exercised by host-side tests. */
public final class NavigationPolicy {
    public static final String HOME = "https://swaggdaddys.com/owner/";
    public enum Route { INTERNAL, CALL, TEXT, EXTERNAL, BLOCK }

    private NavigationPolicy() { }

    /** Only the owner site may ask for the phone's location (for mileage). */
    public static boolean trustedOrigin(String origin) {
        if (origin == null) return false;
        return classify(origin.endsWith("/") ? origin : origin + "/") == Route.INTERNAL;
    }

    public static Route classify(String value) {
        if (value == null || value.length() > 8192 || value.chars().anyMatch(c -> c < 32)) {
            return Route.BLOCK;
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (scheme == null) return Route.BLOCK;
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (scheme.equals("https")) {
                String host = uri.getHost();
                if (host == null || uri.getRawUserInfo() != null) return Route.BLOCK;
                boolean trusted = host.equalsIgnoreCase("swaggdaddys.com")
                        || host.equalsIgnoreCase("www.swaggdaddys.com");
                if (trusted && (uri.getPort() == -1 || uri.getPort() == 443)) {
                    return Route.INTERNAL;
                }
                return trusted ? Route.BLOCK : Route.EXTERNAL;
            }
            if (scheme.equals("tel") || scheme.equals("sms") || scheme.equals("smsto")) {
                String number = uri.getRawSchemeSpecificPart().split("\\?", 2)[0];
                if (!number.matches("\\+?[0-9][0-9().-]{2,39}")) return Route.BLOCK;
                return scheme.equals("tel") ? Route.CALL : Route.TEXT;
            }
            if (scheme.equals("geo") && !uri.getRawSchemeSpecificPart().isEmpty()) {
                return Route.EXTERNAL;
            }
        } catch (Exception ignored) {
            // A malformed, file, data, javascript, or arbitrary intent URL is never loaded.
        }
        return Route.BLOCK;
    }
}
