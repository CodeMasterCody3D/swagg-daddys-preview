package com.swaggdaddys.owner;

final class NotificationContent {
    private NotificationContent() { }
    static String clean(String value, int limit) {
        String text = value == null ? "" : value.replaceAll("[\\p{Cntrl}\\u202A-\\u202E\\u2066-\\u2069]", " ")
                .replaceAll("\\s+", " ").trim();
        return text.codePointCount(0,text.length()) > limit
                ? text.substring(0,text.offsetByCodePoints(0,limit-1)) + "…" : text;
    }
    static String title(String customerName) {
        String name = clean(customerName,80);
        return name.isEmpty() ? "New service request" : name + " · Service request";
    }
    // Stranded/urgent requests and repeat reminders say so up front.
    static boolean urgent(String priority) { return "urgent".equals(priority); }
    static String title(String customerName, boolean urgent, boolean reminder) {
        return (urgent ? "URGENT · " : "") + (reminder ? "Still waiting · " : "") + title(customerName);
    }
    static String summary(String requestSummary) {
        String summary = clean(requestSummary,160);
        return summary.isEmpty() ? "A customer needs help. Tap to open the owner inbox." : summary;
    }
}
