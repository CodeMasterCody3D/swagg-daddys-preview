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
            assertFalse(web.getSettings().getAllowContentAccess());
            assertFalse(CookieManager.getInstance().acceptThirdPartyCookies(web));
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
