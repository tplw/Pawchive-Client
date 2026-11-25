package pw.pawchive.client

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder

private const val DOWNLOAD_CHANNEL_ID = "pawchive-downloads"
private const val DOWNLOAD_SERVICE_ID = 1001
private const val DOWNLOAD_COMPLETE_ID = 1002

/**
 * Keeps the process alive while Rust workers are downloading media. The
 * notification is intentionally quiet; the Downloads page carries the real
 * progress.
 */
class DownloadService : Service() {
  override fun onCreate() {
    super.onCreate()
    ensureDownloadChannel(this)
    startForeground(
      DOWNLOAD_SERVICE_ID,
      buildNotification(this, "Downloading media…", ongoing = true).build(),
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(true)
    super.onDestroy()
  }
}

object DownloadServiceController {
  @JvmStatic
  fun start(context: Context) {
    val intent = Intent(context, DownloadService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  @JvmStatic
  fun stop(context: Context) {
    context.stopService(Intent(context, DownloadService::class.java))
  }

  @JvmStatic
  fun requestNotificationPermission() {
    val activity = MainActivity.current ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    activity.runOnUiThread {
      activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 200)
    }
  }

  @JvmStatic
  fun notifyComplete(context: Context, completed: Int, failed: Int) {
    ensureDownloadChannel(context)
    val text =
      when {
        failed > 0 && completed > 0 -> "$completed downloaded, $failed failed."
        failed > 0 -> "$failed downloads failed."
        else -> "$completed file${if (completed == 1) "" else "s"} downloaded."
      }
    val manager = context.getSystemService(NotificationManager::class.java)
    try {
      manager.notify(
        DOWNLOAD_COMPLETE_ID,
        buildNotification(context, text, ongoing = false).build(),
      )
    } catch (_: SecurityException) {
      // Notification permission can be denied; the download still succeeded.
    }
  }
}

private fun ensureDownloadChannel(context: Context) {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
  val manager = context.getSystemService(NotificationManager::class.java)
  manager.createNotificationChannel(
    NotificationChannel(
      DOWNLOAD_CHANNEL_ID,
      "Downloads",
      NotificationManager.IMPORTANCE_LOW,
    ),
  )
}

private fun buildNotification(
  context: Context,
  text: String,
  ongoing: Boolean,
): Notification.Builder {
  val builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, DOWNLOAD_CHANNEL_ID)
    } else {
      Notification.Builder(context)
    }
  return builder
    .setContentTitle("Pawchive")
    .setContentText(text)
    .setSmallIcon(R.drawable.splash_logo)
    .setOngoing(ongoing)
    .setAutoCancel(!ongoing)
}
