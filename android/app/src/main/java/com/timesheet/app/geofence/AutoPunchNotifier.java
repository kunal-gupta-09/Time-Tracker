package com.timesheet.app.geofence;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.timesheet.app.R;

/** Posts the auto punch-in / punch-out notifications. */
public final class AutoPunchNotifier {

    static final String CHANNEL_ID = "auto_punch";

    private AutoPunchNotifier() {}

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID,
            "Auto punch",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        ch.setDescription("Automatic punch-in and punch-out at your office");
        nm.createNotificationChannel(ch);
    }

    public static void notify(Context ctx, String title, String body) {
        Context app = ctx.getApplicationContext();

        // Android 13+: without the runtime grant, notify() is silently dropped.
        // Check anyway so we don't trip lint or a SecurityException.
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        ensureChannel(app);

        Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
        PendingIntent content = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            content = PendingIntent.getActivity(
                app, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(app, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_punch)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true);
        if (content != null) b.setContentIntent(content);

        try {
            // Unique id per post so a punch-in and a punch-out both stay visible.
            NotificationManagerCompat.from(app)
                .notify((int) (System.currentTimeMillis() & 0x7fffffff), b.build());
        } catch (SecurityException ignored) {
            // Permission revoked between the check and the post.
        }
    }
}
