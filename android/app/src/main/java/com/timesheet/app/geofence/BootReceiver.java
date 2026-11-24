package com.timesheet.app.geofence;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Android removes every geofence on reboot and when the app is updated.
 * Re-register the office from the stored config so auto punch keeps working
 * without the user having to open the app.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }

        // Whatever was registered before is gone now.
        GeofenceStore.setRegisteredSignature(context, null);

        GeofenceStore.Office office = GeofenceStore.getOffice(context);
        if (office == null) return;

        PendingResult pending = goAsync();
        GeofenceRegistrar.register(context, office, false)
            .addOnFailureListener(e -> Log.w("AutoPunch", "Re-register after boot failed", e))
            .addOnCompleteListener(t -> pending.finish());
    }
}
