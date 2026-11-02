package com.swaggdaddys.owner;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationContentTest {
    @Test public void customerNameAndMessageAreReadableSingleLines() {
        assertEquals("Jordan Smith · Service request",NotificationContent.title(" Jordan\nSmith "));
        assertEquals("Car will not start.",NotificationContent.summary(" Car\nwill not\tstart. "));
        assertEquals("Jordan Smith · Service request",NotificationContent.title("Jordan\u202eSmith"));
    }
    @Test public void olderMessagesKeepTheirGenericFallback() {
        assertEquals("New service request",NotificationContent.title(null));
        assertEquals("A customer needs help. Tap to open the owner inbox.",NotificationContent.summary(" "));
    }
    @Test public void urgentAndReminderAlertsSaySoInTheTitle() {
        assertTrue(NotificationContent.urgent("urgent"));
        assertFalse(NotificationContent.urgent("normal"));
        assertFalse(NotificationContent.urgent(null));
        assertEquals("URGENT · Jordan · Service request",NotificationContent.title("Jordan",true,false));
        assertEquals("Still waiting · Jordan · Service request",NotificationContent.title("Jordan",false,true));
        assertEquals("URGENT · Still waiting · New service request",NotificationContent.title(null,true,true));
        assertEquals("Jordan · Service request",NotificationContent.title("Jordan",false,false));
    }
    @Test public void shortPreviewsDoNotSplitEmoji() {
        String result=NotificationContent.summary("🚗".repeat(200));
        assertEquals(160,result.codePointCount(0,result.length()));
        assertTrue(result.endsWith("🚗…"));
    }
}
