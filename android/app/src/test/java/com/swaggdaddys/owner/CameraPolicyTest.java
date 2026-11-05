package com.swaggdaddys.owner;
import org.junit.Test;
import static org.junit.Assert.*;
public class CameraPolicyTest {
    private final String[] video = {CameraPolicy.VIDEO};
    @Test public void allowsOnlyTrustedSameOriginVideo() {
        assertTrue(CameraPolicy.allowed("https://swaggdaddys.com/", NavigationPolicy.HOME, video));
        assertTrue(CameraPolicy.allowed("https://www.swaggdaddys.com/", "https://www.swaggdaddys.com/owner/", video));
        assertFalse(CameraPolicy.allowed("https://evil.example/", NavigationPolicy.HOME, video));
        assertFalse(CameraPolicy.allowed("http://swaggdaddys.com/", NavigationPolicy.HOME, video));
        assertFalse(CameraPolicy.allowed("https://www.swaggdaddys.com/", NavigationPolicy.HOME, video));
        assertFalse(CameraPolicy.allowed("https://swaggdaddys.com/", "https://evil.example/", video));
        assertFalse(CameraPolicy.allowed("https://swaggdaddys.com/", NavigationPolicy.HOME, new String[]{CameraPolicy.VIDEO,"android.webkit.resource.AUDIO_CAPTURE"}));
        assertFalse(CameraPolicy.allowed("https://swaggdaddys.com/", NavigationPolicy.HOME, new String[]{"android.webkit.resource.AUDIO_CAPTURE"}));
        assertFalse(CameraPolicy.allowed("https://swaggdaddys.com/", NavigationPolicy.HOME, null));
    }
}
