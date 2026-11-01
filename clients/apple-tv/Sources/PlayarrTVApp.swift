import SwiftUI

@main
struct PlayarrTVApp: App {
    @State private var environment = TVAppEnvironment()
    @State private var displayPreferences = TVDisplayPreferences()

    var body: some Scene {
        WindowGroup {
            // Always production native SwiftUI. Apple platforms never use
            // WebView/WKWebView (or web-ref paint) for parity — simctl captures
            // of this shell vs Playwright SPA refs only (`-PlayarrParityScreen`).
            TVRootView()
                .environment(environment)
                .environment(displayPreferences)
                .preferredColorScheme(TVParityLaunch.theme ?? displayPreferences.colorScheme)
                // A parity capture shows the settled screen: no animation frame (focus fades, drawer slides, text opacity) may be
                // caught part-way, which moved glyph edges by one level between two identical runs.
                .transaction { transaction in
                    if TVParityLaunch.isParityRun { transaction.disablesAnimations = true }
                }
        }
    }
}
