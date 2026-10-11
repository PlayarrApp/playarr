package io.playarr.mobile.playback

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.view.Display
import androidx.core.content.getSystemService
import io.playarr.shared.domain.repository.PlaybackDeviceCaps

/** What the phone can really decode and show; the pure input of [playbackCapsQuery]. */
internal data class DeviceMediaCaps(
    /** Subset of `hdr10`, `hlg`, `dolby_vision` that both the display and a decoder handle. */
    val hdr: Set<String>,
    /** Dolby Vision profiles a decoder lists (5 and 8 matter to the server). */
    val dvProfiles: Set<Int>,
    val maxBitDepth: Int,
    /** For example `hevc:main 10`. */
    val videoProfiles: Set<String>,
    val maxWidth: Int?,
    val maxHeight: Int?,
    val maxChannels: Int?,
    /** Subset of `eac3`, `ac3`, `dts`, `truehd` the audio output takes bit-exact. */
    val passthrough: Set<String>,
)

/** Persisted advanced player overrides (Settings > Player > Advanced); both default off. */
internal class ForceDirectSettings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("playarr_player_advanced", Context.MODE_PRIVATE)
    var video: Boolean
        get() = prefs.getBoolean("force_direct_video", false)
        set(value) { prefs.edit().putBoolean("force_direct_video", value).apply() }
    var audio: Boolean
        get() = prefs.getBoolean("force_direct_audio", false)
        set(value) { prefs.edit().putBoolean("force_direct_audio", value).apply() }
}

/**
 * The flat playback query fields of the media-caps contract. Sending `max_bit_depth` declares video caps (and `hdr=`, empty
 * when nothing is detected, so the server tone-maps), sending `max_channels` declares audio caps; a field that cannot be
 * detected is omitted. The force flags are sent only when on. Dolby Vision profiles are listed only when `dolby_vision` is.
 */
internal fun playbackCapsQuery(caps: DeviceMediaCaps?, forceDirectVideo: Boolean, forceDirectAudio: Boolean): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (caps != null) {
        query["hdr"] = caps.hdr.sorted().joinToString(",")
        if ("dolby_vision" in caps.hdr && caps.dvProfiles.isNotEmpty()) query["dv_profiles"] = caps.dvProfiles.sorted().joinToString(",")
        query["max_bit_depth"] = caps.maxBitDepth.toString()
        if (caps.videoProfiles.isNotEmpty()) query["video_profiles"] = caps.videoProfiles.sorted().joinToString(",")
        caps.maxWidth?.let { query["max_width"] = it.toString() }
        caps.maxHeight?.let { query["max_height"] = it.toString() }
        caps.maxChannels?.let { query["max_channels"] = it.toString() }
        if (caps.passthrough.isNotEmpty()) query["passthrough"] = caps.passthrough.sorted().joinToString(",")
    }
    if (forceDirectVideo) query["force_direct_video"] = "true"
    if (forceDirectAudio) query["force_direct_audio"] = "true"
    return query
}

/** Reads the real decoder, display and audio-output capabilities of this device. */
internal fun detectDeviceMediaCaps(context: Context, display: Display?): DeviceMediaCaps? = runCatching {
    val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
    fun decodersFor(mime: String) = decoders.filter { info -> info.supportedTypes.any { it.equals(mime, true) } }

    val hevc = decodersFor(MediaFormat.MIMETYPE_VIDEO_HEVC)
    val hevcMain10 = hevc.any { info ->
        info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_HEVC).profileLevels.any { it.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 }
    }
    val dvProfiles = buildSet {
        decodersFor("video/dolby-vision").forEach { info ->
            info.getCapabilitiesForType("video/dolby-vision").profileLevels.forEach {
                when (it.profile) {
                    MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheStn -> add(5)
                    MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheSt -> add(8)
                }
            }
        }
    }
    val displayHdr = hdrTypes(display)
    val hdr = buildSet {
        if (hevcMain10 && "hdr10" in displayHdr) add("hdr10")
        if (hevcMain10 && "hlg" in displayHdr) add("hlg")
        if (dvProfiles.isNotEmpty() && "dolby_vision" in displayHdr) add("dolby_vision")
    }
    val best = hevc.firstOrNull() ?: decodersFor(MediaFormat.MIMETYPE_VIDEO_AVC).firstOrNull()
    val bestVideo = best?.let { info ->
        val mime = info.supportedTypes.first { it.startsWith("video/") }
        info.getCapabilitiesForType(mime).videoCapabilities
    }
    val audio = context.getSystemService<AudioManager>()
    DeviceMediaCaps(
        hdr = hdr,
        dvProfiles = dvProfiles,
        maxBitDepth = if (hevcMain10) 10 else 8,
        videoProfiles = if (hevcMain10) setOf("hevc:main 10") else emptySet(),
        maxWidth = bestVideo?.supportedWidths?.upper,
        maxHeight = bestVideo?.supportedHeights?.upper,
        maxChannels = audio?.let(::maxOutputChannels),
        passthrough = audio?.let(::passthroughFormats).orEmpty(),
    )
}.getOrNull()

@Suppress("DEPRECATION")
private fun hdrTypes(display: Display?): Set<String> {
    val types = display?.hdrCapabilities?.supportedHdrTypes ?: return emptySet()
    return types.toList().mapNotNull {
        when (it) {
            Display.HdrCapabilities.HDR_TYPE_HDR10, Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS -> "hdr10"
            Display.HdrCapabilities.HDR_TYPE_HLG -> "hlg"
            Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> "dolby_vision"
            else -> null
        }
    }.toSet()
}

private fun maxOutputChannels(audio: AudioManager): Int? {
    val widest = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        .filter { it.type != AudioDeviceInfo.TYPE_TELEPHONY }
        .flatMap { it.channelCounts.toList() }.maxOrNull() ?: return null
    return when { widest >= 8 -> 8; widest >= 6 -> 6; else -> 2 }
}

@Suppress("UNUSED_PARAMETER")
private fun passthroughFormats(audio: AudioManager): Set<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return emptySet()
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build()
    fun direct(encoding: Int) = runCatching {
        android.media.AudioTrack.isDirectPlaybackSupported(
            AudioFormat.Builder().setEncoding(encoding).setSampleRate(48_000).setChannelMask(AudioFormat.CHANNEL_OUT_5POINT1).build(),
            attributes,
        )
    }.getOrDefault(false)
    return buildSet {
        if (direct(AudioFormat.ENCODING_E_AC3)) add("eac3")
        if (direct(AudioFormat.ENCODING_AC3)) add("ac3")
        if (direct(AudioFormat.ENCODING_DTS)) add("dts")
        if (direct(AudioFormat.ENCODING_DOLBY_TRUEHD)) add("truehd")
    }
}

/** Installs the provider the playback repository reads on every negotiation; the force flags are read each time. */
internal fun installPlaybackCaps(context: Context, display: Display?) {
    val settings = ForceDirectSettings(context)
    val detected by lazy { detectDeviceMediaCaps(context, display) }
    PlaybackDeviceCaps.provider = { playbackCapsQuery(detected, settings.video, settings.audio) }
}
