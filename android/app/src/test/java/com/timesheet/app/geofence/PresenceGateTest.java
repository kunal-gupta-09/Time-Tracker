package com.timesheet.app.geofence;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.timesheet.app.geofence.PresenceGate.Action;
import com.timesheet.app.geofence.PresenceGate.State;

import org.junit.Test;

public class PresenceGateTest {

    private static final String OFFICE = "AcmeCorp";
    private static final String D1 = "2026-11-24";
    private static final String D2 = "2026-11-25";

    // ---------------- Wi-Fi mode ----------------

    @Test
    public void enterThenJoinWifi_arrivesOnWifi() {
        State s = new State();
        assertEquals(Action.HINT, PresenceGate.onFence(s, true, OFFICE, null, D1));
        assertFalse(s.atOffice);
        assertEquals(Action.EMIT_ENTER, PresenceGate.onWifiJoined(s, OFFICE, "\"AcmeCorp\"", D1));
        assertTrue(s.atOffice);
    }

    @Test
    public void wifiThenEnter_arrivesOnEnter() {
        State s = new State();
        // Wi-Fi joined before the geofence reported ENTER: can't count yet.
        assertEquals(Action.NONE, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D1));
        assertEquals(Action.EMIT_ENTER, PresenceGate.onFence(s, true, OFFICE, OFFICE, D1));
    }

    @Test
    public void enterWithoutWifi_hintsOnly() {
        State s = new State();
        assertEquals(Action.HINT, PresenceGate.onFence(s, true, OFFICE, "CafeteriaGuest", D1));
        assertFalse(s.atOffice);
    }

    @Test
    public void lookalikeHotspotOutsideFence_ignored() {
        State s = new State();
        assertEquals(Action.NONE, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D1));
        assertFalse(s.atOffice);
    }

    @Test
    public void roamingAndReconnecting_singleArrival() {
        State s = new State();
        PresenceGate.onFence(s, true, OFFICE, null, D1);
        assertEquals(Action.EMIT_ENTER, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D1));
        assertEquals(Action.NONE, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D1));
        assertEquals(Action.NONE, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D1));
        // A duplicate geofence ENTER while already counted is also nothing.
        assertEquals(Action.NONE, PresenceGate.onFence(s, true, OFFICE, OFFICE, D1));
    }

    @Test
    public void exitThenReturn_reEnters() {
        State s = new State();
        PresenceGate.onFence(s, true, OFFICE, OFFICE, D1);
        assertEquals(Action.EMIT_EXIT, PresenceGate.onFence(s, false, OFFICE, null, D1));
        assertFalse(s.atOffice);
        assertFalse(s.insideFence);
        PresenceGate.onFence(s, true, OFFICE, null, D1);
        assertEquals(Action.EMIT_ENTER, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D1));
    }

    @Test
    public void lobbyVisitWithoutReachingOffice_noPunchOut() {
        State s = new State();
        PresenceGate.onFence(s, true, OFFICE, null, D1); // hint
        assertEquals(Action.NONE, PresenceGate.onFence(s, false, OFFICE, null, D1));
    }

    @Test
    public void overnightExit_stillPunchesOut() {
        State s = new State();
        PresenceGate.onFence(s, true, OFFICE, OFFICE, D1);
        assertEquals(Action.EMIT_EXIT, PresenceGate.onFence(s, false, OFFICE, null, D2));
    }

    @Test
    public void staleAtOfficeFromMissedExit_doesNotBlockNextDay() {
        // Arrived yesterday; Android never delivered the EXIT.
        State s = new State(true, true, D1);
        assertEquals(Action.EMIT_ENTER, PresenceGate.onWifiJoined(s, OFFICE, OFFICE, D2));
        assertEquals(D2, s.atOfficeDay);
    }

    // ---------------- GPS-only mode (unchanged behaviour) ----------------

    @Test
    public void gpsOnly_everyEnterAndExitEmits() {
        State s = new State();
        assertEquals(Action.EMIT_ENTER, PresenceGate.onFence(s, true, null, null, D1));
        assertEquals(Action.EMIT_EXIT, PresenceGate.onFence(s, false, null, null, D1));
        assertEquals(Action.EMIT_ENTER, PresenceGate.onFence(s, true, null, null, D1));
    }

    @Test
    public void gpsOnly_wifiEventsIgnored() {
        State s = new State();
        PresenceGate.onFence(s, true, null, null, D1);
        assertEquals(Action.NONE, PresenceGate.onWifiJoined(s, null, OFFICE, D1));
    }

    // ---------------- SSID matching ----------------

    @Test
    public void ssidMatching_ignoresQuotesAndCase() {
        assertTrue(PresenceGate.ssidMatches("AcmeCorp", "\"acmecorp\""));
        assertTrue(PresenceGate.ssidMatches("\"AcmeCorp\"", " AcmeCorp "));
        assertFalse(PresenceGate.ssidMatches("AcmeCorp", "AcmeCorp-Guest"));
        assertFalse(PresenceGate.ssidMatches("AcmeCorp", null));
        assertFalse(PresenceGate.ssidMatches(null, "AcmeCorp"));
    }

    @Test
    public void unknownSsid_neverMatches() {
        assertNull(PresenceGate.normalizeSsid("<unknown ssid>"));
        assertFalse(PresenceGate.ssidMatches("AcmeCorp", "<unknown ssid>"));
    }
}
