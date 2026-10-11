package io.playarr.mobile.download

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.playarr.shared.download.DownloadRepository
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Scheduler
import dagger.hilt.android.AndroidEntryPoint
import io.playarr.mobile.R
import javax.inject.Inject

/**
 * The real, live Media3 `DownloadService` -- lives in `:app` (not
 * `core-download`) because a `DownloadService` is a manifest-registered
 * Android component with app-owned notification/icon resources
 * (`R.string`/`R.drawable`), not because of any Hilt limitation. It hosts
 * exactly the same [DownloadManager] singleton [io.playarr.mobile.di.DownloadModule]
 * provides everywhere else in the app -- Media3 requires the service and
 * any direct `DownloadManager` reads (see `core-download`'s
 * `DefaultDownloadRepository`) to share one instance.
 *
 * Declared as a foreground service in `AndroidManifest.xml` with
 * `foregroundServiceType="dataSync"`; [DownloadService] itself promotes to
 * the foreground while any download is active and demotes when idle.
 */
@AndroidEntryPoint
@UnstableApi
class PlayarrDownloadService : DownloadService(
    NOTIFICATION_ID,
    FOREGROUND_NOTIFICATION_UPDATE_INTERVAL_MS,
    DOWNLOAD_NOTIFICATION_CHANNEL_ID,
    R.string.download_channel_name,
    R.string.download_channel_description,
) {

    @Inject lateinit var downloadManagerSingleton: DownloadManager

    override fun getDownloadManager(): DownloadManager = downloadManagerSingleton

    /**
     * No [Scheduler]: auto-resuming downloads after a device reboot or a
     * requirements change while this app isn't running needs
     * `android.permission.RECEIVE_BOOT_COMPLETED` plus Media3's
     * `PlatformScheduler`, deliberately left out of this pass -- a
     * paused/interrupted download simply resumes the next time this
     * service is started (the app reopening, or another download being
     * queued), which is an acceptable simplification for a first pass at
     * this feature.
     */
    override fun getScheduler(): Scheduler? = null

    @Inject lateinit var downloadRepository: DownloadRepository

    private val terminalListener = object : DownloadManager.Listener {
        override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) {
            val manager = NotificationManagerCompat.from(this@PlayarrDownloadService)
            val id = TERMINAL_ID_BASE + download.request.id.hashCode()
            val notification = when (download.state) {
                Download.STATE_COMPLETED -> { downloadRepository.acknowledgeComplete(download.request.id); terminal(download, R.string.download_notification_completed) }
                Download.STATE_FAILED -> terminal(download, R.string.download_notification_failed)
                // Media3 drops its foreground notification once everything is stopped, so a paused download needs its own.
                Download.STATE_STOPPED -> pausedNotification(download)
                else -> { runCatching { manager.cancel(id) }; return }
            }
            // A user who declined POST_NOTIFICATIONS gets a SecurityException here; the download itself carries on.
            @android.annotation.SuppressLint("MissingPermission")
            val posted = runCatching { manager.notify(id, notification) }
            posted.onFailure { android.util.Log.w("PlayarrDl", "notification not posted", it) }
        }

        override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) {
            runCatching { NotificationManagerCompat.from(this@PlayarrDownloadService).cancel(TERMINAL_ID_BASE + download.request.id.hashCode()) }
        }
    }

    private fun terminal(download: Download, text: Int) = NotificationCompat.Builder(this, DOWNLOAD_NOTIFICATION_CHANNEL_ID)
        .setSmallIcon(R.drawable.playarr_mark).setContentTitle(titleOf(download)).setContentText(getString(text))
        .setAutoCancel(true).build()

    private fun percentOf(download: Download) = if (download.contentLength > 0) (download.bytesDownloaded * 100 / download.contentLength).toInt() else 0

    private fun pausedNotification(download: Download): Notification {
        val id = download.request.id
        return NotificationCompat.Builder(this, DOWNLOAD_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.playarr_mark).setContentTitle(titleOf(download))
            .setContentText(getString(R.string.download_notification_paused, percentOf(download)))
            .setProgress(100, percentOf(download), false).setOngoing(false).setOnlyAlertOnce(true)
            .addAction(action(R.string.download_action_resume, id, buildSetStopReasonIntent(this, PlayarrDownloadService::class.java, id, 0, false), id.hashCode()))
            .addAction(action(R.string.download_action_cancel, id, Intent(this, PlayarrDownloadService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, id), id.hashCode() + 1))
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        downloadManagerSingleton.addListener(terminalListener)
    }

    override fun onDestroy() {
        downloadManagerSingleton.removeListener(terminalListener)
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            intent.getStringExtra(EXTRA_ID)?.let(downloadRepository::cancel)
            return START_STICKY
        }
        return super.onStartCommand(intent, flags, startId)
    }

    private fun titleOf(download: Download) = String(download.request.data, Charsets.UTF_8).ifBlank { getString(R.string.download_notification_title) }

    private fun action(label: Int, id: String, intent: Intent, requestCode: Int) = NotificationCompat.Action.Builder(
        0, getString(label),
        PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
    ).build()

    /** One live notification: a single download names its title with percent, size and Pause/Resume and Cancel; several are summarised. */
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
        val active = downloads.filter { it.state == Download.STATE_DOWNLOADING || it.state == Download.STATE_QUEUED || it.state == Download.STATE_STOPPED || it.state == Download.STATE_RESTARTING }
        val builder = NotificationCompat.Builder(this, DOWNLOAD_NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.playarr_mark).setOngoing(true).setOnlyAlertOnce(true)
        val single = active.singleOrNull()
        val total = active.sumOf { it.contentLength.coerceAtLeast(0L) }
        val done = active.sumOf { it.bytesDownloaded }
        val percent = if (total > 0) (done * 100 / total).toInt() else 0
        fun mb(b: Long) = "%.0f MB".format(b / 1_048_576.0)
        if (single != null) {
            val paused = single.state == Download.STATE_STOPPED
            val id = single.request.id
            builder.setContentTitle(titleOf(single))
                .setContentText(
                    if (paused) getString(R.string.download_notification_paused, percent)
                    else if (total > 0) getString(R.string.download_notification_progress, percent, mb(done), mb(total)) else getString(R.string.download_notification_title),
                )
                .setProgress(100, percent, total <= 0)
                .setOngoing(!paused)
            val toggle = if (paused) buildSetStopReasonIntent(this, PlayarrDownloadService::class.java, id, 0, false)
            else buildSetStopReasonIntent(this, PlayarrDownloadService::class.java, id, 1, false)
            builder.addAction(action(if (paused) R.string.download_action_resume else R.string.download_action_pause, id, toggle, id.hashCode()))
            builder.addAction(action(R.string.download_action_cancel, id, Intent(this, PlayarrDownloadService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, id), id.hashCode() + 1))
        } else {
            builder.setContentTitle(getString(R.string.download_notification_many, active.size))
                .setContentText(if (total > 0) getString(R.string.download_notification_progress, percent, mb(done), mb(total)) else getString(R.string.download_notification_title))
                .setProgress(100, percent, total <= 0)
        }
        return builder.build()
    }

    private companion object {
        const val NOTIFICATION_ID = 4200
        const val TERMINAL_ID_BASE = 4300
        const val GROUP = "playarr_downloads"
        const val ACTION_CANCEL = "io.playarr.mobile.download.CANCEL"
        const val EXTRA_ID = "media_file_id"
        const val DOWNLOAD_NOTIFICATION_CHANNEL_ID = "playarr_downloads"

        /** Media3's own documented default foreground-notification refresh cadence. */
        const val FOREGROUND_NOTIFICATION_UPDATE_INTERVAL_MS = 1000L
    }
}
