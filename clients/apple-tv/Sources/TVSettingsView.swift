import SwiftUI

enum TVSettingsAppearanceLayout {
    static let railWidth: CGFloat = 470.4
    static let appearanceDetailWidth: CGFloat = 1041.6
    static let otherDetailWidth: CGFloat = 995
    static let controlHeight: CGFloat = 56
    static let controlCornerRadius: CGFloat = 12
    static let selectedScale: CGFloat = 1.025
    static let sectionGap: CGFloat = 30.24
    static let controlGap: CGFloat = 16.2

    static func equalSegmentWidths(count: Int, in width: CGFloat = appearanceDetailWidth) -> [CGFloat] {
        guard count > 0 else { return [] }
        return Array(repeating: width / CGFloat(count), count: count)
    }
}

struct TVSettingsView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @Environment(TVDisplayPreferences.self) private var displayPreferences
    @State private var serverError: String?
    @State private var pairingTask: Task<Void, Never>?
    @State private var selectedSection = TVParityLaunch.liveSettingsSection ?? 0
    @FocusState private var focusedSection: Int?

    private let sections: [(number: String, title: String, description: String, width: CGFloat)] = [
        ("01", "Appearance", "Choose this device's theme and home screen artwork.", 369.2),
        ("02", "Profile avatar", "Choose how your profile appears on this device.", 334.4),
        ("03", "Language", "Follow this device or keep a language fixed.", 303),
        ("04", "Player", "Choose how Playarr should start quality, subtitles and audio.", 436.7),
        ("05", "Server connection", "Combine libraries from multiple servers in one Playarr interface.", 445.8),
        ("06", "Profile lock", "Require a four-digit PIN before switching profiles.", 344),
        ("07", "Invite a friend", "Ask your Playarr Server admin for one friend-invite QR code.", 416.8),
        ("08", "Request latency", "Per-route HTTP request latency for admins.", 299.7),
        ("09", "Phone remote", "Control this device from your phone, or control another device.", 449.8),
        ("10", "Your data", "Export your watch progress, playlists and preferences, or import them from another Playarr Server.", 702.8),
    ]

    var body: some View {
        @Bindable var environment = environment

        ZStack(alignment: .topLeading) {
            DesignTokens.Color.backgroundElevated.ignoresSafeArea()
            // Web `.tv-library-grid-panel`: 65% frosted panel on the right.
            TVRailPanelGradient(width: 1248)

            // Web: the selected section is the page subtitle (shared small style), nothing else under the title.
            TVPageHeader(title: "Preferences", detail: sections[selectedSection].title, backFocused: true)

            // `.settings-option` rows: x 153.6, y 162, 470.4 x 91.9, pitch 91.9.
            ForEach(Array(sections.enumerated()), id: \.offset) { index, section in
                let selected = selectedSection == index
                let top = 162 + CGFloat(index) * 91.9
                Button {
                    selectedSection = index
                } label: {
                    ZStack(alignment: .topLeading) {
                        Rectangle()
                            .fill(selected ? DesignTokens.Color.backgroundRaised : Color.clear)
                            .frame(width: TVSettingsAppearanceLayout.railWidth, height: 91.9)
                        Text(section.number)
                            .font(TVTheme.font(size: 9.92, weight: .bold))
                            .foregroundStyle(DesignTokens.Color.textDisabled)
                            .placed(x: 32, y: 23.8, w: 32, h: 18.4)
                        Text(section.title)
                            .font(TVTheme.font(size: 29.6, weight: .regular))
                            .tracking(-1.04)
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .lineLimit(1)
                            .placed(x: 92, y: 23.8, w: 307.6, h: 44.4)
                        Text("\u{2192}")
                            .font(TVTheme.font(size: 20.8, weight: .regular))
                            .foregroundStyle(selected ? DesignTokens.Color.textPrimary : DesignTokens.Color.textDisabled)
                            .placed(x: selected ? 432.6 : 427.6, y: 30.3, w: 20.8, h: 31.2)
                    }
                    .frame(width: TVSettingsAppearanceLayout.railWidth, height: 91.9, alignment: .topLeading)
                    .modifier(TVNavItemFocusFill(fill: DesignTokens.Color.backgroundRaised, cornerRadius: 0))
                }
                // Web settings menu: the focused row gets the selected fill and opens its panel; no system platter.
                .buttonStyle(TVFocusableCardButtonStyle())
                .focused($focusedSection, equals: index)
                .disabled(TVParityLaunch.frozen) // not .focusable: on a Button it adds a second, inert focus target
                .focusEffectDisabled()
                .pinned(x: 153.6, y: top, w: TVSettingsAppearanceLayout.railWidth, h: 91.9)
            }

            Color.clear.frame(width: 0, height: 0)
                .onChange(of: focusedSection) { _, index in if let index { selectedSection = index } }

            // Focus sections: Right from any row enters the panel even where no control sits level with the row.
            if selectedSection != 0, selectedSection != 4 || TVParityLaunch.frozen {
                TVSettingsPanel(section: selectedSection)
                    .focusSection()
            }

            // Detail panel at x 773.8 (`.settings-detail-panel`, captured web position).
            VStack(alignment: .leading, spacing: 22) {
                if selectedSection == 0 || (selectedSection == 4 && !TVParityLaunch.frozen) {
                    sectionDetail
                }
            }
            .frame(width: selectedSection == 0 ? TVSettingsAppearanceLayout.appearanceDetailWidth : TVSettingsAppearanceLayout.otherDetailWidth, alignment: .topLeading)
            .pinned(x: 773.8, y: selectedSection == 0 ? 0 : 210, w: selectedSection == 0 ? TVSettingsAppearanceLayout.appearanceDetailWidth : TVSettingsAppearanceLayout.otherDetailWidth, alignment: .topLeading)
            .focusSection()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
        }
    }

    @ViewBuilder
    private var sectionDetail: some View {
        @Bindable var environment = environment
        switch selectedSection {
        case 0:
            ZStack(alignment: .topLeading) {
                Text("Colour theme")
                    .font(TVTheme.font(size: 26.4, weight: .medium))
                    .tracking(-0.92)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .placed(x: 0, y: 210, w: TVSettingsAppearanceLayout.appearanceDetailWidth, h: 39.6)
                choice(["System", "Light", "Dark"], selected: displayPreferences.themePreference == .system ? 0 : (displayPreferences.themePreference == .light ? 1 : 2), widths: TVSettingsAppearanceLayout.equalSegmentWidths(count: 3), y: 265.8) { index in
                    displayPreferences.themePreference = [.system, .light, .dark][index]
                }
                Rectangle()
                    .fill(DesignTokens.Color.borderDefault.opacity(0.35))
                    .frame(width: TVSettingsAppearanceLayout.appearanceDetailWidth, height: 1)
                    .offset(y: 210 + 39.6 + TVSettingsAppearanceLayout.controlGap + TVSettingsAppearanceLayout.controlHeight + TVSettingsAppearanceLayout.sectionGap)
                Text("Home screen artwork")
                    .font(TVTheme.font(size: 26.4, weight: .medium))
                    .tracking(-0.92)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .placed(x: 0, y: 383.28, w: TVSettingsAppearanceLayout.appearanceDetailWidth, h: 39.6)
                Text("Show portrait covers instead of wide media thumbnails on the home screen.")
                    .font(TVTheme.font(size: 13.12, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: 0, y: 428.48, w: TVSettingsAppearanceLayout.appearanceDetailWidth, h: 20.3)
                choice(["Thumbnails", "Covers"], selected: displayPreferences.homeCovers ? 1 : 0, widths: TVSettingsAppearanceLayout.equalSegmentWidths(count: 2), y: 464.98) { index in
                    displayPreferences.homeCovers = index == 1
                }
                Rectangle()
                    .fill(DesignTokens.Color.borderDefault.opacity(0.35))
                    .frame(width: TVSettingsAppearanceLayout.appearanceDetailWidth, height: 1)
                    .offset(y: 551.22)
                // Web Appearance > Artwork size: one size for all artwork (Home, Library, Search and more).
                Text("Artwork size")
                    .font(TVTheme.font(size: 26.4, weight: .medium))
                    .tracking(-0.92)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .placed(x: 0, y: 582.46, w: TVSettingsAppearanceLayout.appearanceDetailWidth, h: 39.6)
                Text("Sets the size of posters and thumbnails everywhere: Home, Library, Search and more.")
                    .font(TVTheme.font(size: 13.12, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
                    .placed(x: 0, y: 627.66, w: TVSettingsAppearanceLayout.appearanceDetailWidth, h: 20.3)
                choice(["Small", "Medium", "Large"],
                       selected: TVDisplayPreferences.ArtworkSize.allCases.firstIndex(of: displayPreferences.artworkSize) ?? 1,
                       widths: TVSettingsAppearanceLayout.equalSegmentWidths(count: 3), y: 664.16) { index in
                    displayPreferences.artworkSize = TVDisplayPreferences.ArtworkSize.allCases[index]
                }
            }
            .frame(width: TVSettingsAppearanceLayout.appearanceDetailWidth, height: 760, alignment: .topLeading) // real height: controls outside a 1-pt frame cannot take focus
        case 4:
            Text("Playarr Server")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            TextField("Server address", text: $environment.serverAddress)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .padding(DesignTokens.Spacing.md)
                .frame(maxWidth: 520)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(DesignTokens.Color.backgroundElevated)
                )
                .textContentType(.URL)
                .autocorrectionDisabled()
            Button("Save server") {
                serverError = environment.saveServerAddress()
                    ? nil
                    : "Enter a valid HTTP or HTTPS server address."
            }
            .font(TVTheme.bodyFont(emphasis: true))
            .foregroundStyle(DesignTokens.Color.brandPrimary)
            if let serverError {
                Text(serverError)
                    .font(TVTheme.captionFont())
                    .foregroundStyle(DesignTokens.Color.stateError)
            }
            pairingContent
        default:
            Text(sections[selectedSection].title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Text(sections[selectedSection].description)
                .font(TVTheme.bodyFont())
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .frame(maxWidth: 480, alignment: .leading)
        }
    }

    /// Web Appearance controls are 56px high with a 12px radius; each segment is a real, focusable choice.
    private func choice(_ labels: [String], selected: Int, widths: [CGFloat], y: CGFloat, onSelect: ((Int) -> Void)? = nil) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                Button { onSelect?(index) } label: {
                    Text(label)
                        .font(TVTheme.font(size: 11.52, weight: .bold))
                        .foregroundStyle(index == selected ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textDisabled)
                        .frame(width: widths[index], height: TVSettingsAppearanceLayout.controlHeight)
                        .background(index == selected ? DesignTokens.Color.textPrimary : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: TVSettingsAppearanceLayout.controlCornerRadius, style: .continuous))
                        .scaleEffect(index == selected ? TVSettingsAppearanceLayout.selectedScale : 1)
                }
                .buttonStyle(TVRingButtonStyle(cornerRadius: TVSettingsAppearanceLayout.controlCornerRadius))
                .focusEffectDisabled()
                .disabled(onSelect == nil || TVParityLaunch.frozen)
            }
        }
        .overlay(Rectangle().stroke(DesignTokens.Color.borderDefault.opacity(0.35), lineWidth: 1))
        .pinned(x: 0, y: y, h: TVSettingsAppearanceLayout.controlHeight)
    }

    private func themeChip(_ label: String, selected: Bool) -> some View {
        // SPA segmented chips: compact, selected = white fill / dark label.
        Text(label)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(selected ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textSecondary)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(selected ? DesignTokens.Color.textPrimary : Color.clear)
            )
    }

    @ViewBuilder
    private var pairingContent: some View {
        switch environment.pairingState {
        case .signedOut:
            TVPrimaryButton(label: "Pair this Apple TV") { beginPairing() }
        case .requestingCode:
            ProgressView("Requesting a pairing code…")
                .tint(DesignTokens.Color.brandPrimary)
        case .awaitingApproval(let pending):
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
                Text(pending.verificationUri)
                    .font(TVTheme.bodyFont())
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text(pending.userCode)
                    .font(.system(size: 42, weight: .bold, design: .monospaced))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Button("Cancel pairing", role: .cancel) {
                    pairingTask?.cancel()
                    pairingTask = nil
                    environment.signOut()
                }
                .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        case .signedIn:
            Label("Paired", systemImage: "checkmark.circle.fill")
                .foregroundStyle(DesignTokens.Color.stateSuccess)
            Button("Sign out", role: .destructive) { environment.signOut() }
                .foregroundStyle(DesignTokens.Color.stateError)
        case .failed(let message):
            Text(message).foregroundStyle(DesignTokens.Color.stateError)
            TVPrimaryButton(label: "Try pairing again") { beginPairing() }
        }
    }

    private func beginPairing() {
        pairingTask?.cancel()
        pairingTask = Task { await environment.startPairing() }
    }
}
