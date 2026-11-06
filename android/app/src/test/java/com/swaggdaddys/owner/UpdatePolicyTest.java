package com.swaggdaddys.owner;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    private static final String APK = "https://github.com/CodeMasterCody3D/swagg-daddys-preview/releases/download/v1.0.4/Swagg-Daddys-Owner-1.0.4.apk";
    @Test public void officialDirectAssetDownloadsInsideApp() {
        assertTrue(UpdatePolicy.isApk(APK));
    }
    @Test public void pagesOtherRepositoriesAndMalformedLinksAreNotDownloads() {
        for (String url : new String[] { null, "", APK.replace("https:", "http:"),
                APK.replace("github.com", "github.com.attacker.example"),
                APK.replace("github.com/", "user@github.com/"),
                APK.replace("/CodeMasterCody3D/", "/another/"),
                APK.replace("/download/", "/tag/"), APK + "?redirect=evil", APK + "#fragment",
                APK.replace("/v1.0.4/", "/../v1.0.4/"), APK.replace(".apk", ".exe"),
                APK.replace("Swagg-Daddys", "%2Fetc%2FSwagg-Daddys") }) assertFalse(String.valueOf(url), UpdatePolicy.isApk(url));
    }
    @org.junit.Test public void installedDownloadsDoNotOfferAnotherUpdate() {
        org.junit.Assert.assertTrue(UpdatePolicy.installedVersionCoversDownload(10, 10));
        org.junit.Assert.assertTrue(UpdatePolicy.installedVersionCoversDownload(9, 10));
        org.junit.Assert.assertFalse(UpdatePolicy.installedVersionCoversDownload(11, 10));
        org.junit.Assert.assertFalse(UpdatePolicy.installedVersionCoversDownload(0, 10));
    }
}
