package io.playarr.mobile

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.HiltAndroidApp
import io.playarr.mobile.download.KeepUntilSweepWorker
import io.playarr.mobile.ui.newPlayarrImageLoader
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.events.LiveEventsManager
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

/** Hilt entry point for the mobile app; every `@Inject`/`@AndroidEntryPoint` site roots here. */
@HiltAndroidApp
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PlayarrMobileApp : Application(), Configuration.Provider, SingletonImageLoader.Factory {
    @Inject lateinit var tokenStore: TokenStore
    @Inject lateinit var liveEvents: LiveEventsManager
    @Inject lateinit var downloadManager: androidx.media3.exoplayer.offline.DownloadManager

    /**
     * Lets `KeepUntilSweepWorker` (a `@HiltWorker`) get its dependencies
     * Hilt-injected rather than WorkManager's default reflection-based
     * no-arg construction. Requires disabling WorkManager's own default
     * `androidx.startup` initializer in `AndroidManifest.xml` (see that
     * file) -- otherwise the default, non-Hilt-aware `WorkManager` instance
     * initializes first and this [workManagerConfiguration] is never used.
     */
    @Inject lateinit var hiltWorkerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(hiltWorkerFactory).build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun newImageLoader(context: PlatformContext): ImageLoader = newPlayarrImageLoader(context)

    override fun onCreate() {
        super.onCreate()
        bindLiveEvents(scope, liveEvents, tokenStore)
        // Media3 keeps unfinished downloads in its index but only advances them while its service runs; start it again
        // after a process restart so a queued download carries on instead of sitting at 0 MB.
        downloadManager.addListener(object : androidx.media3.exoplayer.offline.DownloadManager.Listener {
            override fun onInitialized(downloadManager: androidx.media3.exoplayer.offline.DownloadManager) {
                val pending = downloadManager.currentDownloads.any {
                    it.state == androidx.media3.exoplayer.offline.Download.STATE_QUEUED || it.state == androidx.media3.exoplayer.offline.Download.STATE_DOWNLOADING
                }
                // Not allowed from the background (a worker start); the next launch retries.
                if (pending) runCatching { androidx.media3.exoplayer.offline.DownloadService.start(this@PlayarrMobileApp, io.playarr.mobile.download.PlayarrDownloadService::class.java) }
            }
        })
        // Downloads' own notification channel is created lazily by
        // PlayarrDownloadService's DownloadService constructor (which is
        // given the channel name/description string resources directly),
        // not here.
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            KEEP_UNTIL_SWEEP_WORK_NAME,
            // KEEP: a periodic sweep already scheduled from a prior launch
            // should keep its existing schedule/next-run-time rather than
            // being reset every cold start.
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<KeepUntilSweepWorker>(
                PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS,
                TimeUnit.MILLISECONDS,
            ).build(),
        )
        if (!initialiseFirebase()) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("invite-approvals", "Invite approvals", NotificationManager.IMPORTANCE_HIGH),
        )
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        scope.launch {
            tokenStore.accessToken.filterNotNull().collect {
                FirebaseMessaging.getInstance().register()
            }
        }
    }

    private companion object {
        const val KEEP_UNTIL_SWEEP_WORK_NAME = "playarr-keep-until-sweep"
    }

    private fun initialiseFirebase(): Boolean {
        if (BuildConfig.FIREBASE_API_KEY.isBlank() || BuildConfig.FIREBASE_APPLICATION_ID.isBlank() ||
            BuildConfig.FIREBASE_PROJECT_ID.isBlank() || BuildConfig.FIREBASE_SENDER_ID.isBlank()
        ) return false
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        return true
    }
}
