package io.playarr.shared.designsystem.page

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The two page layouts: the 1920 x 1080 television layout and the phone layout. */
enum class PlayarrFormFactor { Tv, Phone }

/** Provided once, in `MainActivity`. */
val LocalPlayarrFormFactor = staticCompositionLocalOf { PlayarrFormFactor.Phone }

/**
 * Page chrome measurements (docs/design/page-layout.md section 3). One CSS px is one dp on the television reference.
 * Every page reads its gutters, header geometry and safe areas from here, so no screen carries a literal.
 */
@Immutable
data class PlayarrPageMetrics(
    /** `--page-header-top`: top of the header row (phone: plus the system insets). */
    val headerTop: Dp,
    /** `--page-start`: left edge of page content. TV clears the 118 dp navigation rail. */
    val start: Dp,
    /** `--page-end` for the header row (phone: clear of the profile avatar). */
    val headerEnd: Dp,
    /** `--page-end` for the body. */
    val bodyEnd: Dp,
    /** `--page-control-height`: Back, icon buttons and the clock. */
    val control: Dp,
    /** Width of Back and the period arrows. */
    val controlWidth: Dp,
    /** `--action-pill-width`. */
    val pillWidth: Dp,
    /** `--action-pill-height`. */
    val pillHeight: Dp,
    /** `--action-pill-radius`. */
    val pillRadius: Dp,
    /** `--page-header-gap`: between Back and the title. */
    val headerGap: Dp,
    /** `--page-actions-gap`: between header actions. */
    val actionsGap: Dp,
    /** `--page-header-divider-pad`: either side of the title and detail divider. */
    val dividerPad: Dp,
    /** `--page-body-top` for a panel body. */
    val bodyTop: Dp,
    /** `--page-safe-bottom`: the body never draws under the profile chip. */
    val safeBottom: Dp,
    /** `--page-focus-ring` width. */
    val focusRingWidth: Dp,
    /** `--page-focus-ring` offset. */
    val focusRingOffset: Dp,
    /** `--shell-action-column-top`: top of the shell action column (television only; phones keep the header row). */
    val shellColumnTop: Dp,
    /** `--directory-controls-edge`: gap from the right screen edge to the shell action column. */
    val shellColumnEdge: Dp,
    /** Vertical gap between stacked tiles in the shell action column (`.page-header-stack`). */
    val shellColumnGap: Dp,
    /** `.page-header-detail` font size in sp: clamp(9.92, 0.58 vw, 11.52) css px, 11.136 at 1920. */
    val subtitleSize: Float = 11.136f,
) {
    /** `--page-header-height`: the row grows to the tile (owner ruling Q9). */
    val headerHeight: Dp get() = if (pillHeight > control) pillHeight else control
}

/** The edge fade (`--page-edge-fade`): the web rail-panel glow, with the stronger scrim in the dark theme. */
object PlayarrEdgeFadeTokens {
    /** Web `--page-edge-fade-floor`: the content alpha at the very edge. */
    const val MaskFloor: Float = 0.3f
    /** Light: opacity of the radial shade (`.tv-library-grid-panel.can-scroll-*`). */
    const val LightOpacity: Float = 0.62f

    /** Dark: opacity of the page-background scrim (`--edge-scrim-opacity`). */
    const val DarkScrimOpacity: Float = 0.96f

    /** Dark: the scrim holds 60% of its opacity at 40% of its length. */
    const val DarkScrimMidStop: Float = 0.4f
    const val DarkScrimMidAlpha: Float = 0.6f

    /** Light shade colour, `rgb(31 14 20)`. */
    const val LightShadeArgb: Long = 0xFF1F0E14

    /** Light shade stops: alpha at the centre, alpha at 46%, clear at 78%. */
    const val LightCentreAlpha: Float = 0.5f
    const val LightMidAlpha: Float = 0.18f
    const val LightMidStop: Float = 0.46f
    const val LightEndStop: Float = 0.78f

    /** Light band size along the scroll axis: `clamp(38, 5.5 vu, 64)` where one viewport unit is 1% of the height. */
    const val LightBandMinDp: Float = 38f
    const val LightBandMaxDp: Float = 64f
    const val LightBandViewportPercent: Float = 5.5f

    /** Dark scrim band: `clamp(56, 8 vu, 104)`. */
    const val DarkBandMinDp: Float = 56f
    const val DarkBandMaxDp: Float = 104f
    const val DarkBandViewportPercent: Float = 8f
}

object PlayarrPageTokens {
    val Tv = PlayarrPageMetrics(
        headerTop = 56.dp,
        start = 154.dp,
        // Web `--page-end` is clamp(24px, 4vw, 96px): 76.8 at the 1920 reference.
        headerEnd = 76.8.dp,
        bodyEnd = 72.dp,
        control = 50.dp,
        controlWidth = 50.dp,
        pillWidth = 62.dp,
        pillHeight = 72.dp,
        pillRadius = 14.dp,
        headerGap = 23.dp,
        actionsGap = 16.dp,
        dividerPad = 20.dp,
        bodyTop = 122.dp,
        safeBottom = 96.dp,
        focusRingWidth = 3.dp,
        focusRingOffset = 2.dp,
        // Web at 1920x1080: clamp(116, 14 vu, 164) = 151.2; clamp(5, 0.65 vw, 14) = 12.48; clamp(10, 1.2 vu, 16) = 12.96.
        shellColumnTop = 151.2.dp,
        shellColumnEdge = 12.48.dp,
        shellColumnGap = 12.96.dp,
    )

    val Phone = PlayarrPageMetrics(
        headerTop = 2.dp,
        start = 16.dp,
        // Web phone shell action column: `right: var(--mobile-page-gutter)`, a row of 44 px tiles flush with the content grid (the avatar moved to the bottom nav).
        headerEnd = 16.dp,
        bodyEnd = 16.dp,
        control = 44.dp,
        controlWidth = 44.dp,
        pillWidth = 44.dp,
        pillHeight = 44.dp,
        pillRadius = 14.dp,
        headerGap = 10.dp,
        actionsGap = 8.dp,
        dividerPad = 20.dp,
        bodyTop = 72.dp,
        safeBottom = 72.dp,
        focusRingWidth = 2.dp,
        focusRingOffset = 3.dp,
        // Phones keep the actions in the header row, a row of tiles left of the avatar.
        shellColumnTop = 0.dp,
        shellColumnEdge = 0.dp,
        shellColumnGap = 8.dp,
    )

    fun of(formFactor: PlayarrFormFactor): PlayarrPageMetrics = if (formFactor == PlayarrFormFactor.Tv) Tv else Phone

    /**
     * The television metrics for a web viewport of [widthCss] x [heightCss] css px drawn at [scale] dp per css px
     * (a tablet draws web's 1920 px canvas scaled to its width). Web clamps these against the viewport, so a short
     * or narrow screen does not get the 1080 value scaled. At 1920 x 1080 and scale 1 this equals [Tv].
     */
    fun tvFor(widthCss: Float, heightCss: Float, scale: Float): PlayarrPageMetrics {
        val vw = widthCss / 100f
        val vu = heightCss / 100f
        fun dp(css: Float) = (css / scale).dp
        val navEdge = (2.2f * vw).coerceIn(18f, 44f)
        // `--tv-nav-clearance`: the rail's edge, its 64 px tile, both paddings, the 1 px borders and a 12 px gap.
        val navClearance = navEdge + 64f + 12.8f + 2f + 12f
        return Tv.copy(
            headerTop = dp((5.2f * vu).coerceIn(34f, 66f)),
            // Web `--page-control-height`, `--action-pill-*` and `--page-header-gap` clamp against the viewport: Back is 44 px at 1280.
            control = dp((2.8f * vw).coerceIn(44f, 50f)),
            controlWidth = dp((2.8f * vw).coerceIn(44f, 50f)),
            pillWidth = dp((3.6f * vw).coerceIn(48f, 62f)),
            pillHeight = dp((5.2f * vw).coerceIn(52f, 72f)),
            headerGap = dp((1.2f * vw).coerceIn(14f, 24f)),
            subtitleSize = (0.58f * vw).coerceIn(9.92f, 11.52f) / scale,
            start = dp(maxOf((8f * vw).coerceIn(102f, 160f), navClearance)),
            headerEnd = dp((4f * vw).coerceIn(24f, 96f)),
            shellColumnTop = dp((14f * vu).coerceIn(116f, 164f)),
            shellColumnEdge = dp((0.65f * vw).coerceIn(5f, 14f)),
            shellColumnGap = dp((1.2f * vu).coerceIn(10f, 16f)),
        )
    }

    /** The metrics for the provided [LocalPlayarrFormFactor]. */
    @Composable
    @ReadOnlyComposable
    fun current(): PlayarrPageMetrics =
        if (LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv) LocalPlayarrTvMetrics.current else Phone
}

/** The television metrics in force: [PlayarrPageTokens.Tv] on a television, [PlayarrPageTokens.tvFor] on a tablet. */
val LocalPlayarrTvMetrics = staticCompositionLocalOf { PlayarrPageTokens.Tv }

/** The page measurements for the form factor: screens read gutters and insets here and carry no literal of their own. */
@Composable
@ReadOnlyComposable
fun playarrPageMetrics(isTelevision: Boolean): PlayarrPageMetrics = if (isTelevision) LocalPlayarrTvMetrics.current else PlayarrPageTokens.Phone
