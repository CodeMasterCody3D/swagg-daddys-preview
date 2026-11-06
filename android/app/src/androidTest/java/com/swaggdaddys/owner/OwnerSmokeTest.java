package com.swaggdaddys.owner;

import android.webkit.CookieManager;
import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OwnerSmokeTest {
    @Rule public ActivityScenarioRule<MainActivity> activity =
            new ActivityScenarioRule<>(MainActivity.class);

    private WebView findWeb(android.view.View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView match = findWeb(group.getChildAt(i));
                if (match != null) return match;
            }
        }
        return null;
    }

    @Test public void webViewUsesTrustedOwnerPageAndRestrictedSettings() {
        activity.getScenario().onActivity(owner -> {
            WebView web = findWeb(owner.getWindow().getDecorView());
            assertNotNull(web);
            assertEquals(NavigationPolicy.HOME, web.getUrl());
            assertTrue(web.getSettings().getJavaScriptEnabled());
            assertFalse(web.getSettings().getAllowFileAccess());
            assertTrue(web.getSettings().getAllowContentAccess()); // System-picked VIN photos.
            assertFalse(CookieManager.getInstance().acceptThirdPartyCookies(web));
        });
    }

    @Test public void appReportsItsVersionAndCanVerifyItsOwnSignedPackage() {
        activity.getScenario().onActivity(owner -> {
            WebView web = findWeb(owner.getWindow().getDecorView());
            try {
                android.content.pm.PackageInfo installed = owner.getPackageManager().getPackageInfo(owner.getPackageName(), 0);
                String expected = "SwaggDaddysOwner/" + installed.versionName + " (build:" + installed.getLongVersionCode() + ")";
                assertTrue(web.getSettings().getUserAgentString().contains(expected));
            } catch (android.content.pm.PackageManager.NameNotFoundException error) { throw new AssertionError(error); }
            java.io.File installedApk = new java.io.File(owner.getApplicationInfo().sourceDir);
            assertNull(OwnerUpdateController.validatePackage(owner, installedApk));
            assertTrue(OwnerUpdateController.installedVersionCoversDownload(owner, installedApk));
            assertFalse(OwnerUpdateController.installedVersionCoversDownload(owner, new java.io.File("/missing.apk")));
            try {
                String[] permissions = owner.getPackageManager().getPackageInfo(owner.getPackageName(), android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions;
                assertTrue(java.util.Arrays.asList(permissions).contains("android.permission.REQUEST_INSTALL_PACKAGES"));
                assertTrue(java.util.Arrays.asList(permissions).contains("android.permission.CAMERA"));
                assertFalse(java.util.Arrays.asList(permissions).contains("android.permission.RECORD_AUDIO"));
            } catch (Exception error) { throw new AssertionError(error); }
        });
    }

    @Test public void deployedLoginLoadsWithoutSigningInOrViewingCustomers() throws Exception {
        long deadline = System.currentTimeMillis() + 60000;
        while (System.currentTimeMillis() < deadline) {
            AtomicReference<String> result = new AtomicReference<>("");
            CountDownLatch done = new CountDownLatch(1);
            activity.getScenario().onActivity(owner -> {
                WebView web = findWeb(owner.getWindow().getDecorView());
                web.evaluateJavascript("Boolean(document.getElementById('signin') && !document.getElementById('signin').hidden && document.getElementById('login-form'))", value -> {
                    result.set(value); done.countDown();
                });
            });
            assertTrue(done.await(5, TimeUnit.SECONDS));
            if ("true".equals(result.get())) return;
            Thread.sleep(500);
        }
        fail("The deployed owner sign-in form did not become visible within 60 seconds.");
    }
}
