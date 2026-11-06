package com.swaggdaddys.owner;

import android.app.UiAutomation;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CameraSmokeTest {
    @Rule public ActivityScenarioRule<MainActivity> activity = new ActivityScenarioRule<>(MainActivity.class);
    private WebView findWeb(android.view.View view) {
        if (view instanceof WebView) return (WebView)view;
        if (view instanceof ViewGroup) {
            ViewGroup group=(ViewGroup)view;
            for(int i=0;i<group.getChildCount();i++){WebView web=findWeb(group.getChildAt(i));if(web!=null)return web;}
        }
        return null;
    }
    private String title() throws Exception {
        AtomicReference<String> title=new AtomicReference<>("");CountDownLatch done=new CountDownLatch(1);
        activity.getScenario().onActivity(owner->{findWeb(owner.getWindow().getDecorView()).evaluateJavascript("document.title",value->{title.set(value);done.countDown();});});
        assertTrue(done.await(5,TimeUnit.SECONDS));return title.get();
    }
    private void allowCameraPrompt() {
        UiAutomation automation=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        AccessibilityNodeInfo root=automation.getRootInActiveWindow();if(root==null)return;
        for(String prefix:new String[]{"com.android.permissioncontroller","com.google.android.permissioncontroller"}) {
            for(AccessibilityNodeInfo button:root.findAccessibilityNodeInfosByViewId(prefix+":id/permission_allow_foreground_only_button"))
                if(button.isEnabled())button.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
    }
    @Test public void liveCameraRequestsAndroidPermissionAndReceivesFrames() throws Exception {
        UiAutomation automation=InstrumentationRegistry.getInstrumentation().getUiAutomation();
        android.accessibilityservice.AccessibilityServiceInfo info=automation.getServiceInfo();
        info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        automation.setServiceInfo(info);
        // Exercise the shipped scanner and native permission bridge. Replace only the VIN readers
        // so the emulator frame never goes to Google or a vehicle lookup service.
        String html="<!doctype html><meta name='viewport' content='width=device-width'><title>loading</title><div id='host'></div>"
            +"<script type='module'>import{mountVinScanner}from'https://swaggdaddys.com/vin-controller.js';"
            +"import{vinWidget}from'https://swaggdaddys.com/vin-widget.js';import{createLiveVinScanner}from'https://swaggdaddys.com/vin-live.js';"
            +"const host=document.getElementById('host');host.innerHTML=vinWidget+\"<input id='vehicle' type='hidden'><div id='request-result' hidden></div>\";"
            +"mountVinScanner(host,{createScanner:options=>createLiveVinScanner({...options,prepare:()=>{},readFrame:async()=>({candidates:[]}),textAfterMisses:100000,lens:null})});"
            +"host.querySelector('video').addEventListener('loadeddata',()=>{document.title='camera-ready'});document.title='scanner-ready';</script>";
        activity.getScenario().onActivity(owner->findWeb(owner.getWindow().getDecorView()).loadDataWithBaseURL(NavigationPolicy.HOME,html,"text/html","UTF-8",null));
        long deadline=System.currentTimeMillis()+45000;
        while(System.currentTimeMillis()<deadline&&!title().contains("scanner-ready"))Thread.sleep(100);
        assertTrue("Scanner fixture did not load",title().contains("scanner-ready"));
        activity.getScenario().onActivity(owner->findWeb(owner.getWindow().getDecorView()).evaluateJavascript("document.getElementById('vin-photo-button').click()",null));
        deadline=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<deadline) {
            allowCameraPrompt();
            if(title().contains("camera-ready")) {
                activity.getScenario().onActivity(owner->{
                    assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED,owner.checkSelfPermission(android.Manifest.permission.CAMERA));
                    findWeb(owner.getWindow().getDecorView()).evaluateJavascript("document.getElementById('vin-live-stop').click()",null);
                });
                return;
            }
            Thread.sleep(100);
        }
        AtomicReference<String> error=new AtomicReference<>("");CountDownLatch done=new CountDownLatch(1);
        activity.getScenario().onActivity(owner->findWeb(owner.getWindow().getDecorView()).evaluateJavascript("document.getElementById('vin-live-status').textContent",value->{error.set(value);done.countDown();}));
        done.await(5,TimeUnit.SECONDS);fail("Camera did not deliver frames: "+error.get());
    }
}
