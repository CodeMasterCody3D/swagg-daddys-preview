package com.swaggdaddys.owner;

import java.net.URI;

/** Public release assets only; never pass owner cookies to the download service. */
public final class UpdatePolicy {
    private UpdatePolicy() { }
    public static boolean installedVersionCoversDownload(long downloaded, long installed) {
        return downloaded > 0 && installed > 0 && downloaded <= installed;
    }
    public static boolean isApk(String value) {
        if (value == null || value.contains("..")) return false;
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost())
                    && uri.getPort() == -1 && uri.getUserInfo() == null
                    && uri.getQuery() == null && uri.getFragment() == null
                    && uri.getRawPath().matches("/CodeMasterCody3D/swagg-daddys-preview/releases/download/[A-Za-z0-9_-][A-Za-z0-9._-]*/[A-Za-z0-9_-][A-Za-z0-9._-]*\\.apk");
        } catch (Exception ignored) { return false; }
    }
}
