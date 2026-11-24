package com.timesheet.app.geofence;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Fired by ConnectivityManager (registered with a PendingIntent in
 * GeofenceRegistrar) whenever the phone connects to a Wi-Fi network — even
 * with the app closed. In Wi-Fi mode, joining the office network while inside
 * the office geofence is the arrival; see PresenceGate for the full rules.
 */
public class WifiReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofenceStore.Office office = GeofenceStore.getOffice(context);
        if (office == null || office.wifiSsid == null) return;

        long now = System.currentTimeMillis();
        String today = GeofenceStore.localDate(now);

        PresenceGate.State state = GeofenceStore.getPresence(context);
        PresenceGate.Action action =
            PresenceGate.onWifiJoined(state, office.wifiSsid, WifiUtil.currentSsid(context), today);
        GeofenceStore.savePresence(context, state);

        AutoPunchEvents.apply(context, office, action, now);
    }
}
