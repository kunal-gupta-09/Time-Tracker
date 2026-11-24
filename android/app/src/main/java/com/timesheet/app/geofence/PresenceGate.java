package com.timesheet.app.geofence;

/**
 * Decides when a geofence transition or a Wi-Fi connection counts as
 * "arrived at / left the office". Pure Java (no Android types) so the rules are
 * unit-tested on the JVM — see PresenceGateTest.
 *
 * Two modes, chosen by whether an office Wi-Fi name is configured:
 *
 * GPS only (no Wi-Fi name) — unchanged behaviour: every geofence ENTER is an
 * arrival and every EXIT a departure.
 *
 * GPS + Wi-Fi (shared buildings) — the geofence only says "in the building";
 * arrival requires BOTH being inside the geofence AND connected to the office
 * Wi-Fi, which only reaches the office floor. Requiring both also means a
 * hotspot at home renamed to the office SSID can't fake a punch-in.
 * Departure is still the geofence EXIT: dropping Wi-Fi inside the building
 * (cafeteria, flaky signal) is ignored, which under first-in/last-out just
 * counts as time at work.
 */
public final class PresenceGate {

    public enum Action {
        /** Record an arrival (punch-in / re-entry). */
        EMIT_ENTER,
        /** Record a departure (punch-out). */
        EMIT_EXIT,
        /** In the building but not on office Wi-Fi — suggest connecting. */
        HINT,
        NONE,
    }

    /** Persisted between events (see GeofenceStore). Mutated by the methods below. */
    public static final class State {
        public boolean insideFence;
        public boolean atOffice;
        /** Local "YYYY-MM-DD" on which atOffice became true. */
        public String atOfficeDay;

        public State() {}

        public State(boolean insideFence, boolean atOffice, String atOfficeDay) {
            this.insideFence = insideFence;
            this.atOffice = atOffice;
            this.atOfficeDay = atOfficeDay;
        }
    }

    private PresenceGate() {}

    /** Android reports SSIDs wrapped in quotes and, without permission, as "<unknown ssid>". */
    public static String normalizeSsid(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length() - 1);
        }
        if (s.isEmpty() || "<unknown ssid>".equalsIgnoreCase(s)) return null;
        return s;
    }

    public static boolean ssidMatches(String configured, String actual) {
        String c = normalizeSsid(configured);
        String a = normalizeSsid(actual);
        return c != null && a != null && c.equalsIgnoreCase(a);
    }

    /**
     * Already counted as at the office today? A flag left over from an
     * earlier day (an EXIT Android never delivered) must not block today's
     * arrival.
     */
    private static boolean atOfficeToday(State s, String today) {
        return s.atOffice && today.equals(s.atOfficeDay);
    }

    private static Action arrive(State s, String today) {
        s.atOffice = true;
        s.atOfficeDay = today;
        return Action.EMIT_ENTER;
    }

    /**
     * A geofence transition.
     *
     * @param configuredSsid office Wi-Fi name, or null for GPS-only mode
     * @param currentSsid    the Wi-Fi the phone is on right now (may be null)
     * @param today          local "YYYY-MM-DD" of the event
     */
    public static Action onFence(State s, boolean inside, String configuredSsid,
                                 String currentSsid, String today) {
        boolean wasAtOffice = s.atOffice;
        s.insideFence = inside;

        if (!inside) {
            s.atOffice = false;
            s.atOfficeDay = null;
            if (normalizeSsid(configuredSsid) == null) return Action.EMIT_EXIT;
            // Wi-Fi mode: only someone who actually reached the office leaves
            // it. Walking through the lobby never punched in, so no punch-out.
            // (Deliberately not day-checked: an overnight shift exits tomorrow.)
            return wasAtOffice ? Action.EMIT_EXIT : Action.NONE;
        }

        if (normalizeSsid(configuredSsid) == null) {
            // GPS only: unchanged — every ENTER is an arrival. Duplicate
            // deliveries are filtered by the caller's time window.
            return arrive(s, today);
        }

        if (atOfficeToday(s, today)) return Action.NONE;
        if (ssidMatches(configuredSsid, currentSsid)) return arrive(s, today);
        return Action.HINT;
    }

    /** The phone connected to a Wi-Fi network. */
    public static Action onWifiJoined(State s, String configuredSsid, String joinedSsid, String today) {
        if (normalizeSsid(configuredSsid) == null) return Action.NONE; // GPS-only mode
        if (!ssidMatches(configuredSsid, joinedSsid)) return Action.NONE;
        // Same name outside the office geofence: a lookalike hotspot, or a
        // geofence state we don't know yet. Never an arrival.
        if (!s.insideFence) return Action.NONE;
        // Roaming between access points / reconnecting on the same floor.
        if (atOfficeToday(s, today)) return Action.NONE;
        return arrive(s, today);
    }
}
