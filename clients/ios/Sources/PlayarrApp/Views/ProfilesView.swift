import Observation
import PlayarrKit
import SwiftUI
import UIKit

@MainActor
@Observable
private final class ProfilesViewModel {
    enum State { case idle, loading, loaded, failed(String) }
    var state: State = .idle
    var profiles: [AvailableProfile] = []
    var currentAvatar: ProfileAvatarPreference?
    var switching = false
    var errorMessage: String?
    let environment: AppEnvironment

    init(environment: AppEnvironment) { self.environment = environment }

    func load() async {
        state = .loading
        do {
            profiles = try await environment.apiClient.listProfiles()
            state = .loaded
            currentAvatar = (try? await environment.apiClient.getProfileAvatar())?.preference
        } catch let error as APIError {
            state = .failed(error.displayMessage)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func switchTo(_ profile: AvailableProfile, pin: String?) async -> Bool {
        switching = true
        errorMessage = nil
        defer { switching = false }
        do {
            try await environment.switchProfile(profile, pin: pin)
            return true
        } catch let error as APIError {
            errorMessage = error.displayMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        return false
    }
}

struct ProfilesView: View {
    @State private var viewModel: ProfilesViewModel
    @State private var pinProfile: AvailableProfile?
    @State private var pin = ""
    @AppStorage("com.playarr.ios.appearance") private var appearance = "system"
    @AppStorage("com.playarr.ios.language") private var language = "system"
    let onOpenSettings: () -> Void
    let onHome: () -> Void

    init(environment: AppEnvironment, onOpenSettings: @escaping () -> Void, onHome: @escaping () -> Void) {
        _viewModel = State(initialValue: ProfilesViewModel(environment: environment))
        self.onOpenSettings = onOpenSettings
        self.onHome = onHome
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading:
                PlayarrLoadingView(title: "Loading profiles…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load profiles", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                content
            }
        }
        .task {
            if case .idle = viewModel.state { await viewModel.load() }
        }
        .parityScreenLoad(parityLoadState)
        .alert("Enter profile PIN", isPresented: Binding(
            get: { pinProfile != nil },
            set: { if !$0 { pinProfile = nil; pin = "" } }
        )) {
            SecureField("4-digit PIN", text: $pin)
                .keyboardType(.numberPad)
            Button("Cancel", role: .cancel) { pinProfile = nil; pin = "" }
            Button("Continue") {
                guard let profile = pinProfile else { return }
                Task {
                    if await viewModel.switchTo(profile, pin: pin) { onHome() }
                    pinProfile = nil
                    pin = ""
                }
            }
            .disabled(pin.count != 4)
        } message: {
            Text("This profile is protected.")
        }
        .navigationBarHidden(true)
    }

    private var parityLoadState: ParityScreenLoad {
        switch viewModel.state {
        case .loaded: .ready
        case .failed: .failed
        case .idle, .loading: .loading
        }
    }

    private var content: some View {
        GeometryReader { proxy in
            if PlayarrLayout.isPhone(proxy.size) {
                phoneContent
            } else {
                stageContent(proxy: proxy)
            }
        }
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    private func dropdown<Items: View>(
        x: CGFloat, y: CGFloat = 14, width: CGFloat = 112, height: CGFloat = 48,
        icon: String, label: String, @ViewBuilder items: () -> Items
    ) -> some View {
        Menu {
            items()
        } label: {
            ZStack {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(WM.muted)
                    .offset(x: 27 - width / 2)
                WMText(label, 11.52, 720, lh: 17.28).offset(x: 2)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(WM.muted)
                    .offset(x: width / 2 - 25)
            }
            .frame(width: width, height: height)
            .background(WM.shell)
            .overlay(Rectangle().stroke(WM.line.opacity(0.28), lineWidth: 1))
        }
        .offset(x: x, y: y)
    }

    private var themeLabel: String {
        switch appearance {
        case "light": "Light"
        case "dark": "Dark"
        default: "System"
        }
    }

    private var languageLabel: String {
        Self.languages.first(where: { $0.0 == language })?.1 ?? "Auto"
    }

    private static let languages: [(String, String)] = [
        ("system", "Auto"), ("en", "English"), ("es", "Spanish"), ("fr", "French"), ("de", "German"),
        ("it", "Italian"), ("pt", "Portuguese"), ("ja", "Japanese"), ("ko", "Korean"), ("zh", "Chinese"),
        ("hi", "Hindi"), ("ar", "Arabic"), ("th", "Thai"),
    ]

    /// Web mobile profile picker (numbers from the web layout): theme and language dropdowns,
    /// a centred heading and the profile avatars with the "Sign in" tile.
    private var phoneContent: some View {
        ZStack(alignment: .topLeading) {
            WM.shell.ignoresSafeArea()
            RadialGradient(
                colors: [WM.pink.opacity(0.1), WM.pink.opacity(0)],
                center: UnitPoint(x: 0.5, y: 0.5),
                startRadius: 0,
                endRadius: 300
            )
            .frame(width: 600, height: 600)
            .offset(x: -105, y: 120)
            .allowsHitTesting(false)

            PlayarrLogo(size: 30).offset(x: 21, y: 20)
            WMText("PROFILES", 7.36, 820, color: WM.pink, lh: 11.04, ls: 0.9568)
                .frame(width: 358).offset(x: 0, y: 72)
            WMText("Who\u{2019}s watching?", 42.9, 500, lh: 40.755, ls: -3.0888)
                .frame(width: 358).offset(x: 0, y: 90)
            dropdown(x: 144, icon: "sun.max", label: themeLabel) {
                Button("System") { appearance = "system" }
                Button("Light") { appearance = "light" }
                Button("Dark") { appearance = "dark" }
            }
            dropdown(x: 264, icon: "globe", label: languageLabel) {
                ForEach(Array(Self.languages.enumerated()), id: \.offset) { _, entry in
                    Button(entry.1) { language = entry.0 }
                }
            }

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 19) {
                    ForEach(Array(viewModel.profiles.enumerated()), id: \.element.id) { index, profile in
                        phoneProfile(profile)
                    }
                    phoneSignIn()
                }
                .padding(.leading, 24)
                .padding(.trailing, 24)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .frame(width: 390, height: 300, alignment: .topLeading)
            .offset(x: 0, y: 169)

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(WM.font(11, 650)).foregroundStyle(PlayarrStyle.danger)
                    .offset(x: 24, y: 470)
            }

            Button {
                if let url = URL(string: "https://playarr.app/clients") {
                    UIApplication.shared.open(url)
                }
            } label: {
                HStack(spacing: 8) {
                    WMText("Clients", 7.68, 720, color: WM.inkSoft, lh: 11.52).fixedSize()
                    WMText("\u{2192}", 7.68, 720, color: WM.inkSoft, lh: 11.52).fixedSize()
                }
                .frame(width: 76, height: 44)
                .background(WM.chip, in: Capsule())
                .overlay(Capsule().stroke(WM.line.opacity(0.08), lineWidth: 1))
                .wmChipShadow()
            }
            .buttonStyle(.plain)
            .offset(x: 295, y: 782)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func phoneProfile(
        _ profile: AvailableProfile, selectedSize: CGFloat = 169, otherSize: CGFloat = 163,
        column: CGFloat = 163, namePad: CGFloat = 10, centredActions: Bool = false
    ) -> some View {
        let selected = profile.isCurrent
        return VStack(spacing: 0) {
            Button { choose(profile) } label: {
                ZStack {
                    PlayarrProfileAvatar(
                        preference: profile.isCurrent ? viewModel.currentAvatar : nil,
                        userID: profile.isCurrent ? viewModel.environment.currentUserID : profile.id,
                        userName: profile.displayName,
                        size: selected ? selectedSize : otherSize
                    )
                    .overlay {
                        if selected {
                            Circle().stroke(WM.pink.opacity(0.42), lineWidth: 4).padding(-2)
                        }
                    }
                }
                .frame(width: column, height: column)
            }
            .buttonStyle(.plain)
            .disabled(viewModel.switching)
            WMText(profile.displayName, 13.12, 680, lh: 19.68)
                .frame(width: column).padding(.top, namePad)
            WMText(
                profile.isCurrent ? "WATCHING NOW" : profile.pinLocked ? "PIN REQUIRED" : "READY",
                6.72, 690, color: WM.muted, lh: 10.08, ls: 0.3024
            )
            .frame(width: column).padding(.top, 11)
            if selected {
                HStack(spacing: 9) {
                    Button(action: onOpenSettings) {
                        Image(systemName: "gearshape")
                            .font(.system(size: 14))
                            .foregroundStyle(WM.pink)
                            .frame(width: 44, height: 44)
                            .background(WM.chip, in: Circle())
                            .overlay(Circle().stroke(WM.line.opacity(0.08), lineWidth: 1))
                            .wmChipShadow()
                    }
                    .buttonStyle(.plain)
                    Button {
                        Task { try? await viewModel.environment.signOut() }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .font(.system(size: 9)).foregroundStyle(WM.inkSoft)
                            WMText("Sign out", 7.68, 720, color: WM.inkSoft, lh: 11.52).fixedSize()
                        }
                        .frame(width: 92, height: 44)
                        .background(WM.chip, in: Capsule())
                        .overlay(Capsule().stroke(WM.line.opacity(0.08), lineWidth: 1))
                        .wmChipShadow()
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 24.7).padding(.leading, centredActions ? 0 : 9)
                .frame(width: column, alignment: centredActions ? .center : .leading)
            }
        }
        .frame(width: column, alignment: .top)
    }

    private func phoneSignIn(size: CGFloat = 156, top: CGFloat = 13) -> some View {
        Button {
            Task { try? await viewModel.environment.signOut() }
        } label: {
            VStack(spacing: 0) {
                ZStack {
                    Circle().fill(
                        LinearGradient(
                            colors: [
                                WM.adaptive(light: (233, 185, 196), dark: (96, 36, 56)),
                                WM.adaptive(light: (190, 85, 115), dark: (146, 39, 76)),
                            ],
                            startPoint: UnitPoint(x: 0.2, y: 0.06),
                            endPoint: UnitPoint(x: 0.8, y: 0.94)
                        )
                    )
                    Circle().stroke(WM.line.opacity(0.08), style: StrokeStyle(lineWidth: 1, dash: [3, 3])).padding(5)
                    WMText("+", 38.4, 300, color: WM.inkSoft, lh: 57.6)
                }
                .frame(width: size, height: size)
                WMText("Sign in", 13.12, 680, color: WM.inkSoft, lh: 19.68).frame(width: size).padding(.top, 9)
                WMText("ADD ANOTHER PROFILE", 6.72, 690, color: WM.muted, lh: 10.08, ls: 0.3024)
                    .frame(width: size).padding(.top, 10)
            }
            .frame(width: size, alignment: .top)
        }
        .buttonStyle(.plain)
        .padding(.top, top)
    }

    /// Web tablet profile picker (positions in points from the 1366x1024 web capture): theme and language
    /// dropdowns, a centred heading, the avatar row with the "Sign in" tile and the update chip.
    private func stageContent(proxy: GeometryProxy) -> some View {
        ZStack(alignment: .topLeading) {
            profileBackground
            PlayarrLogo(size: 30).offset(x: 55, y: 59)
            WMText("PROFILES", 7.36, 820, color: WM.pink, lh: 11.04, ls: 0.9568)
                .frame(width: proxy.size.width).offset(x: 0, y: 152)
            WMText("Who\u{2019}s watching?", 58, 500, lh: 55.1, ls: -4.18)
                .frame(width: proxy.size.width).offset(x: 0, y: 170)
            dropdown(x: 1013, y: 47, width: 143, height: 47, icon: "sun.max", label: themeLabel) {
                Button("System") { appearance = "system" }
                Button("Light") { appearance = "light" }
                Button("Dark") { appearance = "dark" }
            }
            dropdown(x: 1169, y: 47, width: 166, height: 47, icon: "globe", label: languageLabel) {
                ForEach(Array(Self.languages.enumerated()), id: \.offset) { _, entry in
                    Button(entry.1) { language = entry.0 }
                }
            }

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 20) {
                    ForEach(Array(viewModel.profiles.enumerated()), id: \.element.id) { _, profile in
                        phoneProfile(profile, selectedSize: 198, otherSize: 190, column: 198, namePad: 1, centredActions: true)
                    }
                    phoneSignIn(size: 178, top: 19)
                }
                .frame(minWidth: proxy.size.width, alignment: .center)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .frame(width: proxy.size.width, height: 340, alignment: .top)
            .offset(x: -5, y: 350)

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(WM.font(11, 650)).foregroundStyle(PlayarrStyle.danger)
                    .offset(x: 41, y: 900)
            }

            Button {
                if let url = URL(string: "https://playarr.app/clients") {
                    UIApplication.shared.open(url)
                }
            } label: {
                WMText("Check for updates", 8.6, 720, color: WM.inkSoft, lh: 12).fixedSize()
                    .frame(width: 98, height: 43)
                    .background(WM.chip, in: Capsule())
                    .overlay(Capsule().stroke(WM.line.opacity(0.08), lineWidth: 1))
                    .wmChipShadow()
            }
            .buttonStyle(.plain)
            .offset(x: 41, y: 949)
        }
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
    }

    private var profileBackground: some View {
        ZStack {
            LinearGradient(
                colors: [PlayarrStyle.surface, PlayarrStyle.background],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [PlayarrStyle.pink.opacity(0.13), .clear],
                center: .center,
                startRadius: 0,
                endRadius: 360
            )
            LinearGradient(
                colors: [PlayarrStyle.background.opacity(0.9), .clear, PlayarrStyle.background.opacity(0.82)],
                startPoint: .bottomLeading,
                endPoint: .topTrailing
            )
        }
        .ignoresSafeArea()
    }

    private func choose(_ profile: AvailableProfile) {
        if profile.isCurrent {
            onHome()
        } else if profile.pinLocked {
            pinProfile = profile
        } else {
            Task {
                if await viewModel.switchTo(profile, pin: nil) { onHome() }
            }
        }
    }
}
