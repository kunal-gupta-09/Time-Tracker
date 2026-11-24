package com.timesheet.app.geofence;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;

import java.util.Collections;

/**
 * Adds / removes the single office geofence. Shared by the plugin (user set or
 * changed their office) and BootReceiver (Android drops all geofences on reboot
 * and on app update).
 */
public final class GeofenceRegistrar {

    static final String GEOFENCE_ID = "office";

    private GeofenceRegistrar() {}

    public static boolean hasForegroundLocation(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Pre-Android 10 there is no separate background grant; foreground covers it. */
    public static boolean hasBackgroundLocation(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasForegroundLocation(ctx);
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    static PendingIntent pendingIntent(Context ctx) {
        Intent intent = new Intent(ctx, GeofenceBroadcastReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // Geofencing fills in the transition extras, so the intent must be
        // mutable on Android 12+ — FLAG_IMMUTABLE here silently breaks delivery.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(ctx, 0, intent, flags);
    }

    /**
     * Registers the office geofence.
     *
     * @param initialEnter fire ENTER immediately if the phone is already inside.
     *     True only when the user has just set or changed the office; false on
     *     reboot / app-open re-registration, where an immediate ENTER would
     *     reopen a day the user had deliberately punched out of.
     */
    @SuppressLint("MissingPermission")
    public static Task<Void> register(Context ctx, GeofenceStore.Office office, boolean initialEnter) {
        Context app = ctx.getApplicationContext();
        if (!hasForegroundLocation(app) || !hasBackgroundLocation(app)) {
            return Tasks.forException(new SecurityException(
                "Location permission \"Allow all the time\" is required for auto punch."));
        }

        Geofence fence = new Geofence.Builder()
            .setRequestId(GEOFENCE_ID)
            .setCircularRegion(office.lat, office.lng, office.radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
            // Lets Android batch fixes; a minute of latency is fine for a timesheet
            // and noticeably cheaper on battery.
            .setNotificationResponsiveness(60_000)
            .build();

        GeofencingRequest request = new GeofencingRequest.Builder()
            .setInitialTrigger(initialEnter ? GeofencingRequest.INITIAL_TRIGGER_ENTER : 0)
            .addGeofence(fence)
            .build();

        GeofencingClient client = LocationServices.getGeofencingClient(app);
        // Replace, not add alongside: remove first so a changed radius takes effect.
        return client.removeGeofences(Collections.singletonList(GEOFENCE_ID))
            .continueWithTask(t -> client.addGeofences(request, pendingIntent(app)))
            .addOnSuccessListener(v -> GeofenceStore.setRegisteredSignature(app, office.signature()))
            .addOnFailureListener(e -> GeofenceStore.setRegisteredSignature(app, null));
    }

    public static Task<Void> unregister(Context ctx) {
        Context app = ctx.getApplicationContext();
        GeofenceStore.setRegisteredSignature(app, null);
        return LocationServices.getGeofencingClient(app)
            .removeGeofences(Collections.singletonList(GEOFENCE_ID));
    }
}
