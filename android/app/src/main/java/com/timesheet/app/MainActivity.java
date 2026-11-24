package com.timesheet.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.timesheet.app.geofence.GeofencePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) plugins must be registered before the bridge starts.
        registerPlugin(GeofencePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
