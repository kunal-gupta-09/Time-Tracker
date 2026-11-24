package com.timesheet.app.geofence;

import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;

/** Reads the Wi-Fi network the phone is currently connected to. */
final class WifiUtil {

    private WifiUtil() {}

    /**
     * Current Wi-Fi as {ssid, bssid}, or null when not on Wi-Fi or the name
     * can't be read. Android only reveals the SSID with location permission
     * and location turned on — both already required for auto punch — and
     * otherwise reports "<unknown ssid>", which we treat as "not the office".
     *
     * getConnectionInfo() is deprecated on API 31+ but still returns the
     * connected network for apps holding location permission, and unlike the
     * replacement it works from a BroadcastReceiver with no callback object.
     */
    @SuppressWarnings("deprecation")
    static String[] current(Context ctx) {
        WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null || !wm.isWifiEnabled()) return null;
        WifiInfo info = wm.getConnectionInfo();
        if (info == null || info.getNetworkId() == -1) return null;
        String ssid = PresenceGate.normalizeSsid(info.getSSID());
        if (ssid == null) return null;
        return new String[] { ssid, info.getBSSID() };
    }

    static String currentSsid(Context ctx) {
        String[] w = current(ctx);
        return w == null ? null : w[0];
    }
}
