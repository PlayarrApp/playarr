package io.playarr.mobile.ui

import io.playarr.shared.data.model.PlaybackAudioTrackOption
import io.playarr.shared.data.model.PlaybackQualityOption
import io.playarr.shared.data.model.PlaybackSubtitleTrackOption

internal data class PlayarrPlaybackControls(
    val qualityOptions: List<PlaybackQualityOption> = emptyList(),
    val activeQualityId: String = "original",
    val audioTracks: List<PlaybackAudioTrackOption> = emptyList(),
    val selectedAudioTrackId: String? = null,
    val subtitleTracks: List<PlaybackSubtitleTrackOption> = emptyList(),
    val selectedSubtitleTrackId: String? = null,
    val switching: Boolean = false,
)

internal const val playarrAndroidContainers = "mp4,webm,mkv,mp3,flac,m4a,ogg,opus,wav"
internal const val playarrAndroidVideoCodecsWithHevc = "h264,h265,hevc,vp9,av1"
internal const val playarrAndroidVideoCodecsWithoutHevc = "h264,vp9,av1"

/**
 * HEVC is claimed only when a decoder handles 4K 10-bit HEVC, the usual shape of an HEVC library file (the web
 * client probes the same way): a false claim makes the server direct-play a stream this device then fails on.
 */
internal fun playarrDecodesHevc4k(): Boolean = runCatching {
    android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
        !info.isEncoder && info.supportedTypes.any { it.equals("video/hevc", ignoreCase = true) } &&
            info.getCapabilitiesForType("video/hevc").let { caps ->
                caps.videoCapabilities?.isSizeSupported(3840, 2160) == true && caps.profileLevels.any {
                    it.profile == android.media.MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10
                }
            }
    }
}.getOrDefault(false)

internal val playarrAndroidVideoCodecs: String by lazy {
    if (playarrDecodesHevc4k()) playarrAndroidVideoCodecsWithHevc else playarrAndroidVideoCodecsWithoutHevc
}
internal const val playarrAndroidAudioCodecs = "aac,opus,mp3,flac,vorbis,pcm_s16le,pcm_s24le"
