package com.timesheet.app.geofence;

import android.content.Context;

import org.json.JSONObject;

/**
 * Turns a PresenceGate decision into the durable event + notification. Shared
 * by the geofence receiver and the Wi-Fi receiver so both paths record,
 * dedupe, and notify identically.
 */
final class AutoPunchEvents {

    /** A repeat of the same transition inside this window is GPS / Wi-Fi noise. */
    private static final long DUPLICATE_WINDOW_MS = 2 * 60_000L;

    private AutoPunchEvents() {}

    static void apply(Context context, GeofenceStore.Office office, PresenceGate.Action action, long ms) {
        switch (action) {
            case EMIT_ENTER:
                record(context, office, "enter", ms);
                break;
            case EMIT_EXIT:
                record(context, office, "exit", ms);
                break;
            case HINT:
                hint(context, office, ms);
                break;
            case NONE:
            default:
                break;
        }
    }

    private static void record(Context context, GeofenceStore.Office office, String type, long ms) {
        // Android occasionally re-delivers, or the fence flickers at its edge.
        // Same transition again shortly after adds nothing: first-in/last-out
        // is unchanged by a second ENTER, and the next EXIT carries the later time.
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

    /**
     * In the building but not on office Wi-Fi. Only before the first punch-in
     * of the day and at most once a day — after that, walking through the lobby
     * at lunch shouldn't nag.
     */
    private static void hint(Context context, GeofenceStore.Office office, long ms) {
        if (office.wifiSsid == null) return;
        if (GeofenceStore.getFirstInToday(context, ms) != 0) return;
        if (!GeofenceStore.claimHintForDay(context, GeofenceStore.localDate(ms))) return;
        AutoPunchNotifier.notify(context, "You're near the office",
            "Connect to \"" + office.wifiSsid + "\" Wi-Fi to punch in automatically.");
    }
}
