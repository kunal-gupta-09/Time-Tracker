package com.timesheet.app.geofence;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofenceStatusCodes;
import com.google.android.gms.location.GeofencingEvent;

/**
 * Receives office ENTER / EXIT transitions, even when the app is closed.
 *
 * This runs without a WebView, so it cannot write to Supabase. PresenceGate
 * decides whether the transition is an arrival/departure (in Wi-Fi mode, an
 * ENTER alone is only "in the building"); AutoPunchEvents records it for JS to
 * apply on the next open/resume, notifies, and pings a running app.
 */
public class GeofenceBroadcastReceiver extends BroadcastReceiver {

    private static final String TAG = "AutoPunch";

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError()) {
            Log.w(TAG, "Geofence error: " + (event == null ? "null event" : event.getErrorCode()));
            // Location was switched off: Android has dropped our geofence.
            // Forget the registration so the next app open re-adds it.
            if (event != null
                && event.getErrorCode() == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                GeofenceStore.setRegisteredSignature(context, null);
            }
            return;
        }

        int transition = event.getGeofenceTransition();
        boolean inside;
        if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) inside = true;
        else if (transition == Geofence.GEOFENCE_TRANSITION_EXIT) inside = false;
        else return;

        GeofenceStore.Office office = GeofenceStore.getOffice(context);
        if (office == null) return; // Signed out / disabled since registration.

        // Prefer the fix that triggered the transition: with batched delivery it
        // can be a minute or more older than "now", and it's the truer time.
        long now = System.currentTimeMillis();
        long ms = now;
        Location loc = event.getTriggeringLocation();
        if (loc != null && loc.getTime() > 0 && loc.getTime() <= now) ms = loc.getTime();

        String currentSsid = office.wifiSsid == null ? null : WifiUtil.currentSsid(context);

        PresenceGate.State state = GeofenceStore.getPresence(context);
        PresenceGate.Action action = PresenceGate.onFence(
            state, inside, office.wifiSsid, currentSsid, GeofenceStore.localDate(ms));
        GeofenceStore.savePresence(context, state);

        AutoPunchEvents.apply(context, office, action, ms);
    }
}
