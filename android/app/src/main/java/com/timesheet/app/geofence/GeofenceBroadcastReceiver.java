package com.timesheet.app.geofence;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofenceStatusCodes;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONObject;

/**
 * Receives office ENTER / EXIT transitions, even when the app is closed.
 *
 * This runs without a WebView, so it cannot write to Supabase. It records the
 * event (with its real time) for JS to apply on the next open/resume, notifies
 * the user right away, and pings the plugin in case the app is already running.
 */
public class GeofenceBroadcastReceiver extends BroadcastReceiver {

    private static final String TAG = "AutoPunch";

    /** A repeat of the same transition inside this window is GPS noise. */
    private static final long DUPLICATE_WINDOW_MS = 2 * 60_000L;

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
        String type;
        if (transition == Geofence.GEOFENCE_TRANSITION_ENTER) type = "enter";
        else if (transition == Geofence.GEOFENCE_TRANSITION_EXIT) type = "exit";
        else return;

        GeofenceStore.Office office = GeofenceStore.getOffice(context);
        if (office == null) return; // Signed out / disabled since registration.

        // Prefer the fix that triggered the transition: with batched delivery it
        // can be a minute or more older than "now", and it's the truer time.
        long now = System.currentTimeMillis();
        long ms = now;
        Location loc = event.getTriggeringLocation();
        if (loc != null && loc.getTime() > 0 && loc.getTime() <= now) ms = loc.getTime();

        // Android occasionally re-delivers, or the fence flickers at its edge.
        // Same transition again shortly after adds nothing: first-in/last-out is
        // unchanged by a second ENTER, and the next EXIT will carry the later time.
        if (type.equals(GeofenceStore.getLastType(context))
            && Math.abs(ms - GeofenceStore.getLastMs(context)) < DUPLICATE_WINDOW_MS) {
            return;
        }

        JSONObject ev = GeofenceStore.appendEvent(context, office.userId, type, ms);
        long firstIn = GeofenceStore.recordTransition(context, type, ms);

        String time = GeofenceStore.localTime(ms);
        if ("enter".equals(type)) {
            if (firstIn != 0 && firstIn != ms) {
                AutoPunchNotifier.notify(context, "Back at office",
                    "Arrived " + time + ". Still counting from your first punch-in at "
                        + GeofenceStore.localTime(firstIn) + ".");
            } else {
                AutoPunchNotifier.notify(context, "Punched in at " + time,
                    "You arrived at the office. Open the app any time to see your day.");
            }
        } else {
            AutoPunchNotifier.notify(context, "Punched out at " + time,
                "You left the office. If you come back today, your first punch-in is kept.");
        }

        GeofencePlugin.emitEvent(ev);
    }
}
