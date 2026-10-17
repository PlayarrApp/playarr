package io.playarr.shared.data.remote

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Interceptor

/**
 * Counts Playarr API requests (not the live-events stream) so a debug parity capture can tell that a screen's
 * data has stopped loading: nothing in flight, and nothing started or finished for a quiet window.
 */
object PlayarrApiActivity {
    private val inFlight = AtomicInteger(0)
    private val completed = AtomicLong(0)
    @Volatile private var lastChangeMs = System.nanoTime() / 1_000_000

    val interceptor: Interceptor = Interceptor { chain ->
        inFlight.incrementAndGet()
        lastChangeMs = System.nanoTime() / 1_000_000
        try {
            chain.proceed(chain.request())
        } finally {
            inFlight.decrementAndGet()
            completed.incrementAndGet()
            lastChangeMs = System.nanoTime() / 1_000_000
        }
    }

    fun completedCount(): Long = completed.get()

    /** True when no request is in flight and the last start or finish is at least [quietMs] old. */
    fun isQuiet(quietMs: Long): Boolean =
        inFlight.get() == 0 && System.nanoTime() / 1_000_000 - lastChangeMs >= quietMs
}
