package com.timesheet.app.geofence;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.Set;

/**
 * Bridge between the web app and Android geofencing for auto punch.
 *
 * The receiver records events natively (it may run with the app closed); JS
 * drains them with getPendingEvents / ackEvents and writes them to Supabase.
 */
@CapacitorPlugin(
    name = "Geofence",
    permissions = {
        @Permission(
            alias = GeofencePlugin.LOCATION,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(
            alias = GeofencePlugin.BACKGROUND,
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(
            alias = GeofencePlugin.NOTIFICATIONS,
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        ),
    }
)
public class GeofencePlugin extends Plugin {

    static final String LOCATION = "location";
    static final String BACKGROUND = "backgroundLocation";
    static final String NOTIFICATIONS = "notifications";

    private static WeakReference<GeofencePlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    /** Called by the receiver; delivers live to JS if the app is running. */
    static void emitEvent(JSONObject ev) {
        GeofencePlugin p = instance.get();
        if (p == null) return;
        try {
            p.notifyListeners("geofenceEvent", JSObject.fromJSONObject(ev));
        } catch (JSONException ignored) {
            // The event is still in the store; the next drain picks it up.
        }
    }

    // ---------------- Permissions ----------------

    private String locationState() {
        return getPermissionState(LOCATION).toString();
    }

    private String backgroundState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return locationState();
        return getPermissionState(BACKGROUND).toString();
    }

    private String notificationState() {
        if (Build.VERSION.SDK_INT < 33) return PermissionState.GRANTED.toString();
        return getPermissionState(NOTIFICATIONS).toString();
    }

    private JSObject permissionsObject() {
        JSObject o = new JSObject();
        o.put("location", locationState());
        o.put("backgroundLocation", backgroundState());
        o.put("notifications", notificationState());
        return o;
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (getPermissionState(LOCATION) == PermissionState.GRANTED) {
            call.resolve(permissionsObject());
            return;
        }
        requestPermissionForAlias(LOCATION, call, "permissionCallback");
    }

    /**
     * Must be asked separately from, and after, foreground location. On Android
     * 11+ the system takes the user to Settings to choose "Allow all the time".
     */
    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || getPermissionState(BACKGROUND) == PermissionState.GRANTED) {
            call.resolve(permissionsObject());
            return;
        }
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            call.reject("Grant location access first.");
            return;
        }
        requestPermissionForAlias(BACKGROUND, call, "permissionCallback");
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(permissionsObject());
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(permissionsObject());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // ---------------- Location ----------------

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getCurrentLocation(PluginCall call) {
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            call.reject("Location permission not granted.");
            return;
        }
        CurrentLocationRequest req = new CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(0) // A cached fix from elsewhere would set the wrong office.
            .setDurationMillis(30_000)
            .build();

        LocationServices.getFusedLocationProviderClient(getContext())
            .getCurrentLocation(req, null)
            .addOnSuccessListener((Location loc) -> {
                if (loc == null) {
                    call.reject("Couldn't get a GPS fix. Make sure location is on and try again.");
                    return;
                }
                JSObject o = new JSObject();
                o.put("lat", loc.getLatitude());
                o.put("lng", loc.getLongitude());
                o.put("accuracy", (double) loc.getAccuracy());
                call.resolve(o);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage()));
    }

    /**
     * The Wi-Fi the phone is on now, for "Use current Wi-Fi". Resolves
     * {ssid, bssid}, or {} when not on Wi-Fi or Android hides the name
     * (location permission missing or location off).
     */
    @PluginMethod
    public void getCurrentWifi(PluginCall call) {
        JSObject o = new JSObject();
        if (getPermissionState(LOCATION) == PermissionState.GRANTED) {
            String[] w = WifiUtil.current(getContext());
            if (w != null) {
                o.put("ssid", w[0]);
                if (w[1] != null) o.put("bssid", w[1]);
            }
        }
        call.resolve(o);
    }

    // ---------------- Office geofence ----------------

    /**
     * Saves the office and registers its geofence. No-op if this exact office
     * is already registered, so calling it on every app open is cheap.
     *
     * Options: userId, lat, lng, radius, wifiSsid (null = GPS only),
     * initialEnter (default false).
     */
    @PluginMethod
    public void setOffice(PluginCall call) {
        String userId = call.getString("userId");
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        Double radius = call.getDouble("radius", 200.0);
        String wifiSsid = call.getString("wifiSsid", null);
        boolean initialEnter = Boolean.TRUE.equals(call.getBoolean("initialEnter", false));
        if (userId == null || lat == null || lng == null) {
            call.reject("userId, lat and lng are required.");
            return;
        }
        if (!GeofenceRegistrar.wifiSupported()) wifiSsid = null;

        GeofenceStore.Office office =
            new GeofenceStore.Office(userId, lat, lng, radius.floatValue(), wifiSsid);
        GeofenceStore.saveOffice(getContext(), office);

        if (office.signature().equals(GeofenceStore.getRegisteredSignature(getContext()))) {
            JSObject o = new JSObject();
            o.put("registered", true);
            call.resolve(o);
            return;
        }

        GeofenceRegistrar.register(getContext(), office, initialEnter)
            .addOnSuccessListener(v -> {
                JSObject o = new JSObject();
                o.put("registered", true);
                call.resolve(o);
            })
            .addOnFailureListener(e -> {
                // Office is saved; BootReceiver / the next app open retries once
                // permissions are in place.
                JSObject o = new JSObject();
                o.put("registered", false);
                o.put("reason", e.getMessage());
                call.resolve(o);
            });
    }

    @PluginMethod
    public void clearOffice(PluginCall call) {
        GeofenceStore.clearOffice(getContext());
        GeofenceRegistrar.unregister(getContext())
            .addOnCompleteListener(t -> call.resolve());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("supported", true);
        o.put("permissions", permissionsObject());

        GeofenceStore.Office office = GeofenceStore.getOffice(getContext());
        if (office != null) {
            JSObject of = new JSObject();
            of.put("userId", office.userId);
            of.put("lat", office.lat);
            of.put("lng", office.lng);
            of.put("radius", (double) office.radius);
            if (office.wifiSsid != null) of.put("wifiSsid", office.wifiSsid);
            o.put("office", of);
        }
        o.put("wifiSupported", GeofenceRegistrar.wifiSupported());
        o.put("registered", office != null
            && office.signature().equals(GeofenceStore.getRegisteredSignature(getContext())));

        String lastType = GeofenceStore.getLastType(getContext());
        if (lastType != null) {
            JSObject last = new JSObject();
            last.put("type", lastType);
            last.put("timestampMs", GeofenceStore.getLastMs(getContext()));
            o.put("lastEvent", last);
        }
        call.resolve(o);
    }

    // ---------------- Event drain ----------------

    @PluginMethod
    public void getPendingEvents(PluginCall call) {
        JSONArray events = GeofenceStore.readEvents(getContext());
        JSArray arr = new JSArray();
        for (int i = 0; i < events.length(); i++) {
            JSONObject ev = events.optJSONObject(i);
            if (ev != null) arr.put(ev);
        }
        JSObject o = new JSObject();
        o.put("events", arr);
        call.resolve(o);
    }

    @PluginMethod
    public void ackEvents(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<String> set = new HashSet<>();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, null);
                if (id != null) set.add(id);
            }
        }
        GeofenceStore.ackEvents(getContext(), set);
        call.resolve();
    }

    /** Lets JS post follow-ups such as "auto punch-in skipped". */
    @PluginMethod
    public void showNotification(PluginCall call) {
        String title = call.getString("title", "Time Tracker");
        String body = call.getString("body", "");
        AutoPunchNotifier.notify(getContext(), title, body);
        call.resolve();
    }
}
