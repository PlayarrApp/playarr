import SwiftUI

/// The web stylesheet's sizes at the 1920 x 1080 stage, evaluated here the way Blink evaluates them: `clamp()`, `vw`, `rem`
/// and `calc()` resolved in floating point, then laid-out lengths snapped down to Blink's 1/64 px `LayoutUnit`.
/// Every value names the CSS it comes from (`clients/tv-web/web/src/styles/page-layout.css` unless said otherwise).
/// Nothing in this file is fitted to a score: change the CSS, change the expression.
enum TVWeb {
    /// `--vw: 1vw` and `--viewport-unit: 1vh` on the 1920 x 1080 stage; `1rem` is 16 px.
    static let stageWidth: CGFloat = 1920
    static let stageHeight: CGFloat = 1080
    static let vw: CGFloat = stageWidth / 100
    static let vh: CGFloat = stageHeight / 100
    static let rem: CGFloat = 16

    /// CSS `clamp(lo, value, hi)`.
    static func clamp(_ lo: CGFloat, _ value: CGFloat, _ hi: CGFloat) -> CGFloat { max(lo, min(value, hi)) }

    /// Blink `LayoutUnit`: laid-out lengths are kept in 1/64 px, rounded toward zero.
    static func layoutUnit(_ value: CGFloat) -> CGFloat { (value * 64).rounded(.towardZero) / 64 }

    /// CSS `color-mix(in srgb, a p%, b)` on two opaque 0xRRGGBB colours, each channel rounded to the nearest integer.
    static func mix(_ a: UInt32, _ percent: CGFloat, _ b: UInt32) -> UInt32 {
        func channel(_ shift: UInt32) -> UInt32 {
            let x = CGFloat((a >> shift) & 0xff), y = CGFloat((b >> shift) & 0xff)
            return UInt32((x * percent / 100 + y * (100 - percent) / 100).rounded())
        }
        return channel(16) << 16 | channel(8) << 8 | channel(0)
    }

    // MARK: Page panel

    /// `--stage-rail-vw: 62` and `--stage-rail-width: calc(62 * 1%)`: the right-hand column (Home rails, library panel).
    static let railWidth: CGFloat = layoutUnit(stageWidth * 62 / 100)
    /// The panel's left edge: the stage minus the rail (729.6).
    static let railLeft: CGFloat = stageWidth - railWidth

    // MARK: Poster card (the one card size)

    /// `--library-rail-left: max(clamp(28px, 2.8 * var(--vw), 54px), var(--safe-left))`; `--card-pad-left` is the same.
    static let cardPadLeft: CGFloat = layoutUnit(clamp(28, 2.8 * vw, 54))
    /// `--directory-controls-edge: max(clamp(5px, 0.65 * var(--vw), 14px), var(--safe-right))`.
    static let controlsEdge: CGFloat = clamp(5, 0.65 * vw, 14)
    /// `--directory-controls-width: clamp(48px, 3.6 * var(--vw), 62px)`.
    static let controlsWidth: CGFloat = clamp(48, 3.6 * vw, 62)
    /// `--directory-controls-gap: clamp(18px, 1.5 * var(--vw), 30px)`.
    static let controlsGap: CGFloat = clamp(18, 1.5 * vw, 30)
    /// `--directory-alphabet-width: 56px`.
    static let alphabetWidth: CGFloat = 56
    /// `--library-rail-right = edge + max(controls width, alphabet width) + gap`; `--card-pad-right` is the same.
    static let cardPadRight: CGFloat = controlsEdge + max(controlsWidth, alphabetWidth) + controlsGap
    /// `--card-grid-gap: clamp(14px, 1.35 * var(--vw), 28px)` (thumbnails) and `--card-grid-gap-cover: clamp(12px, 1 * var(--vw), 20px)`.
    static let cardGap: CGFloat = clamp(14, 1.35 * vw, 28)
    static let cardGapCover: CGFloat = clamp(12, 1 * vw, 20)

    /// The grid's content width: `62 * vw - --card-pad-left - --card-pad-right` (1033.44), also a list row's width.
    static let cardContentWidth: CGFloat = layoutUnit(62 * vw - cardPadLeft - cardPadRight)

    /// `--card-w: calc((62 * vw - pad-left - pad-right - (cols - 1) * gap) / cols)`; `cols` is `3 + --card-size-step`.
    static func cardWidth(columns: Int) -> CGFloat {
        layoutUnit((62 * vw - cardPadLeft - cardPadRight - CGFloat(columns - 1) * cardGap) / CGFloat(columns))
    }
    /// `--card-w-cover`, the 2:3 view (`5 + --card-size-step` columns).
    static func cardWidthCover(columns: Int) -> CGFloat {
        layoutUnit((62 * vw - cardPadLeft - cardPadRight - CGFloat(columns - 1) * cardGapCover) / CGFloat(columns))
    }
    /// The medium artwork size (`--card-size-step: 0`): 327.17.
    static let cardWidthMedium: CGFloat = cardWidth(columns: 3)
    /// Column pitch of the grid track: the card plus the gap, each a LayoutUnit (353.08 at medium).
    static func cardPitch(columns: Int = 3) -> CGFloat { cardWidth(columns: columns) + layoutUnit(cardGap) }
    /// The first column's left edge: the rail's left plus the card padding (783.36).
    static let gridLeft: CGFloat = railLeft + cardPadLeft
    /// Left edge of column `index` at medium.
    static func gridColumnLeft(_ index: Int) -> CGFloat { gridLeft + CGFloat(index) * cardPitch() }
    /// `--card-radius: clamp(8px, 0.65 * var(--vw), 13px)`.
    static let cardRadius: CGFloat = clamp(8, 0.65 * vw, 13)
    /// `--card-title-size: clamp(0.55rem, 0.62 * var(--vw), 0.78rem)` and `--card-title-weight: 610`.
    static let cardTitleSize: CGFloat = clamp(0.55 * rem, 0.62 * vw, 0.78 * rem)
    static let cardTitleWeight: CGFloat = 610
    /// `--card-meta-size: clamp(0.43rem, 0.46 * var(--vw), 0.56rem)`.
    static let cardMetaSize: CGFloat = clamp(0.43 * rem, 0.46 * vw, 0.56 * rem)

    // MARK: Details panel (global.css `.details-panel`)

    /// `.details-panel .tv-preview-meta { font-size: clamp(0.62rem, 0.68 * var(--vw), 0.86rem); font-weight: 600 }`.
    static let detailsMetaSize: CGFloat = clamp(0.62 * rem, 0.68 * vw, 0.86 * rem)
    /// `.details-panel .tv-preview-overview { font-size: clamp(0.64rem, 0.72 * var(--vw), 0.92rem) }`.
    static let detailsOverviewSize: CGFloat = clamp(0.64 * rem, 0.72 * vw, 0.92 * rem)
    /// `.details-panel .tv-preview-meta, .tv-preview-overview { font-weight: 600 }`.
    static let detailsTextWeight: CGFloat = 600
    /// `.details-panel .tv-provider { font-weight: 860 }`; the kicker size is `clamp(0.58rem, 0.64 * var(--vw), 0.78rem)` with `letter-spacing: 0.08em` (global.css `.tv-provider`).
    static let detailsKickerWeight: CGFloat = 860
    static let kickerSize: CGFloat = clamp(0.58 * rem, 0.64 * vw, 0.78 * rem)
    static let kickerTracking: CGFloat = 0.08 * kickerSize

    // MARK: Page header

    /// The back arrow is a `.btn` link: `font-weight: 720` (global.css `.btn`); its size is `.tv-page-back { font-size: clamp(0.8rem, 0.9 * var(--vw), 1.1rem) }`.
    static let backArrowWeight: CGFloat = 720
    static let backArrowSize: CGFloat = clamp(0.8 * rem, 0.9 * vw, 1.1 * rem)
}
