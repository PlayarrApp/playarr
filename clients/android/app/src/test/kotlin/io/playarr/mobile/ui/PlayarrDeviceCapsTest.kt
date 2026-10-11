package io.playarr.mobile.ui

import io.playarr.mobile.playback.DeviceMediaCaps
import io.playarr.mobile.playback.playbackCapsQuery
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull

class PlayarrDeviceCapsTest {
    private val hdrPhone = DeviceMediaCaps(
        hdr = setOf("hdr10", "dolby_vision"), dvProfiles = setOf(5, 8), maxBitDepth = 10,
        videoProfiles = setOf("hevc:main 10"), maxWidth = 3840, maxHeight = 2160, maxChannels = 6, passthrough = setOf("eac3"),
    )

    @Test
    fun `an HDR display lists its formats and Dolby Vision profiles`() {
        val q = playbackCapsQuery(hdrPhone, forceDirectVideo = false, forceDirectAudio = false)
        assertEquals("dolby_vision,hdr10", q["hdr"])
        assertEquals("5,8", q["dv_profiles"])
        assertEquals("10", q["max_bit_depth"])
        assertEquals("6", q["max_channels"])
        assertEquals("eac3", q["passthrough"])
    }

    @Test
    fun `an SDR display sends an empty hdr list so the server tone-maps and no DV profiles`() {
        val q = playbackCapsQuery(hdrPhone.copy(hdr = emptySet()), false, false)
        assertEquals("", q["hdr"])
        assertEquals("10", q["max_bit_depth"])
        assertNull(q["dv_profiles"])
    }

    @Test
    fun `profile 5 is only listed when the display and decoder both do Dolby Vision`() {
        val q = playbackCapsQuery(hdrPhone.copy(hdr = setOf("hdr10")), false, false)
        assertFalse("dv_profiles" in q)
    }

    @Test
    fun `force flags map to query parameters only when on`() {
        assertEquals(emptyMap<String, String>(), playbackCapsQuery(null, false, false))
        assertEquals(mapOf("force_direct_video" to "true"), playbackCapsQuery(null, true, false))
        assertEquals(mapOf("force_direct_audio" to "true"), playbackCapsQuery(null, false, true))
    }
}
