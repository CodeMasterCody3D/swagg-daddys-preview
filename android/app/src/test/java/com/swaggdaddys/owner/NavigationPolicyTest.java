package com.swaggdaddys.owner;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static com.swaggdaddys.owner.NavigationPolicy.Route.*;

public class NavigationPolicyTest {
    @Test public void ownerAndPrivateMediaStayInside() {
        assertEquals(INTERNAL, NavigationPolicy.classify(NavigationPolicy.HOME));
        assertEquals(INTERNAL, NavigationPolicy.classify("https://swaggdaddys.com/api/requests/123/media/456"));
        assertEquals(INTERNAL, NavigationPolicy.classify("https://www.swaggdaddys.com/owner/"));
        assertEquals(INTERNAL, NavigationPolicy.classify("https://SWAGGDADDYS.COM:443/owner/"));
    }
    @Test public void telephoneAndTextUseSystemApps() {
        assertEquals(CALL, NavigationPolicy.classify("tel:+12054928772"));
        assertEquals(TEXT, NavigationPolicy.classify("sms:+12054928772?body=Hi%20there"));
        assertEquals(TEXT, NavigationPolicy.classify("smsto:2054928772"));
    }
    @Test public void mapAndOtherHttpsLinksLeaveWebView() {
        assertEquals(EXTERNAL, NavigationPolicy.classify("https://www.google.com/maps/search/?api=1&query=33.4%2C-86.9"));
        assertEquals(EXTERNAL, NavigationPolicy.classify("geo:33.4,-86.9"));
        assertEquals(EXTERNAL, NavigationPolicy.classify("https://swaggdaddys.com.attacker.example/owner/"));
    }
    @Test public void unsafeAndMalformedUrlsAreBlocked() {
        for (String url : new String[] { null, "", "http://swaggdaddys.com/owner/",
                "javascript:alert(1)", "file:///etc/passwd", "content://example/file",
                "data:text/html,test", "intent://example", "https://swaggdaddys.com:444/owner/",
                "https://swaggdaddys.com@evil.example/", "tel:*123%23", "tel:+1205;ext=1",
                "https://swaggdaddys.com\\@evil.example/", "https://swaggdaddys.com/\n" }) {
            assertEquals(String.valueOf(url), BLOCK, NavigationPolicy.classify(url));
        }
    }
}
