import SwiftUI

/// Page chrome tokens, the native copy of `clients/tv-web/web/src/styles/page-layout.css` (docs/design/page-layout.md,
/// row 13.804). Phone values; the web's tablet values clamp to the same 44 pt control.
enum PlayarrPageTokens {
    /// `--page-control-height`: Back, the period arrows and the icon action tiles.
    static let controlHeight: CGFloat = 44
    /// `--mobile-page-gutter`.
    static let gutter: CGFloat = 16
    /// Header top is `--mobile-top-inset` + 2 pt (`--page-header-top`).
    @MainActor static var headerTop: CGFloat { WM.topInset + 2 }
}

/// The one Back button: a round `controlHeight` circle (owner decision Q10). Every page uses this view, never a
/// hand-sized `WMHeaderCircleButton` arrow; `PageChromeSourceGuardTests` fails the build otherwise.
struct PlayarrBackButton: View {
    let action: () -> Void

    var body: some View {
        WMHeaderCircleButton(
            width: PlayarrPageTokens.controlHeight,
            height: PlayarrPageTokens.controlHeight,
            glyph: "\u{2190}",
            action: action
        )
        .accessibilityLabel("Back")
    }
}
