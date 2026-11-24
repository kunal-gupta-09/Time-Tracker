package com.timesheet.app.geofence;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Durable native state for auto punch. Lives in SharedPreferences because the
 * geofence receiver runs with no WebView — when the app is closed, this is the
 * only place an arrival or departure can be written down until JS drains it.
 *
 * All methods are synchronized: the receiver and the plugin can touch the
 * event list from different threads.
 */
public final class GeofenceStore {

    private static final String PREFS = "tt_geofence";
    private static final String K_OFFICE = "office";
    private static final String K_REGISTERED_SIG = "registered_sig";
    private static final String K_EVENTS = "events";
    private static final String K_LAST_TYPE = "last_type";
    private static final String K_LAST_MS = "last_ms";
    private static final String K_FIRST_IN_DATE = "first_in_date";
    private static final String K_FIRST_IN_MS = "first_in_ms";

    /** Bound so a phone that never opens the app can't grow this forever. */
    private static final int MAX_EVENTS = 500;

    private GeofenceStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------- Office config ----------------

    public static final class Office {
        public final String userId;
        public final double lat;
        public final double lng;
        public final float radius;

        public Office(String userId, double lat, double lng, float radius) {
            this.userId = userId;
            this.lat = lat;
            this.lng = lng;
            this.radius = radius;
        }

        /** Identifies a registration, so an unchanged office isn't re-registered. */
        String signature() {
            return userId + "|" + lat + "|" + lng + "|" + radius;
        }
    }

    public static synchronized void saveOffice(Context ctx, Office o) {
        try {
            JSONObject j = new JSONObject();
            j.put("userId", o.userId);
            j.put("lat", o.lat);
            j.put("lng", o.lng);
            j.put("radius", (double) o.radius);
            prefs(ctx).edit().putString(K_OFFICE, j.toString()).apply();
        } catch (JSONException ignored) {
            // Only primitives — cannot fail in practice.
        }
    }

    public static synchronized Office getOffice(Context ctx) {
        String raw = prefs(ctx).getString(K_OFFICE, null);
        if (raw == null) return null;
        try {
            JSONObject j = new JSONObject(raw);
            return new Office(
                j.getString("userId"),
                j.getDouble("lat"),
                j.getDouble("lng"),
                (float) j.getDouble("radius")
            );
        } catch (JSONException e) {
            return null;
        }
    }

    public static synchronized void clearOffice(Context ctx) {
        prefs(ctx).edit()
            .remove(K_OFFICE)
            .remove(K_REGISTERED_SIG)
            .remove(K_LAST_TYPE)
            .remove(K_LAST_MS)
            .remove(K_FIRST_IN_DATE)
            .remove(K_FIRST_IN_MS)
            .apply();
    }

    public static synchronized String getRegisteredSignature(Context ctx) {
        return prefs(ctx).getString(K_REGISTERED_SIG, null);
    }

    public static synchronized void setRegisteredSignature(Context ctx, String sig) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        if (sig == null) e.remove(K_REGISTERED_SIG);
        else e.putString(K_REGISTERED_SIG, sig);
        e.apply();
    }

    // ---------------- Last transition (dedupe + notification text) ----------------

    public static synchronized String getLastType(Context ctx) {
        return prefs(ctx).getString(K_LAST_TYPE, null);
    }

    public static synchronized long getLastMs(Context ctx) {
        return prefs(ctx).getLong(K_LAST_MS, 0L);
    }

    /**
     * Records a transition and returns the first-in time for its day — the
     * earliest ENTER on that local date, which is what the day's record keeps
     * under first-in / last-out.
     */
    public static synchronized long recordTransition(Context ctx, String type, long ms) {
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor e = p.edit();
        e.putString(K_LAST_TYPE, type);
        e.putLong(K_LAST_MS, ms);

        String day = localDate(ms);
        long firstIn = p.getLong(K_FIRST_IN_MS, 0L);
        if ("enter".equals(type) && !day.equals(p.getString(K_FIRST_IN_DATE, null))) {
            e.putString(K_FIRST_IN_DATE, day);
            e.putLong(K_FIRST_IN_MS, ms);
            firstIn = ms;
        }
        e.apply();
        return firstIn;
    }

    /** The first ENTER today, or 0 if none yet. */
    public static synchronized long getFirstInToday(Context ctx, long nowMs) {
        SharedPreferences p = prefs(ctx);
        if (!localDate(nowMs).equals(p.getString(K_FIRST_IN_DATE, null))) return 0L;
        return p.getLong(K_FIRST_IN_MS, 0L);
    }

    // ---------------- Pending events ----------------

    public static synchronized JSONObject appendEvent(Context ctx, String userId, String type, long ms) {
        JSONArray events = readEvents(ctx);
        JSONObject ev = new JSONObject();
        try {
            ev.put("id", UUID.randomUUID().toString());
            ev.put("userId", userId);
            ev.put("type", type);
            ev.put("timestampMs", ms);
        } catch (JSONException ignored) {}

        events.put(ev);
        // Drop the oldest if over the cap. A backlog this large means the app
        // hasn't been opened in months; the newest events matter most.
        while (events.length() > MAX_EVENTS) events.remove(0);
        writeEvents(ctx, events);
        return ev;
    }

    public static synchronized JSONArray readEvents(Context ctx) {
        String raw = prefs(ctx).getString(K_EVENTS, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public static synchronized void ackEvents(Context ctx, Set<String> ids) {
        JSONArray events = readEvents(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev == null) continue;
            if (!ids.contains(ev.optString("id"))) kept.put(ev);
        }
        writeEvents(ctx, kept);
    }

    private static void writeEvents(Context ctx, JSONArray events) {
        // commit(), not apply(): the receiver's process may be killed right
        // after onReceive returns, and an arrival must not be lost.
        prefs(ctx).edit().putString(K_EVENTS, events.toString()).commit();
    }

    // ---------------- Helpers ----------------

    static String localDate(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ms));
    }

    static String localTime(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(ms));
    }
}
