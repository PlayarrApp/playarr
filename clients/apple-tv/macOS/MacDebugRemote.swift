#if DEBUG
import AppKit

/// Debug builds only: drives the app for parity captures and keyboard checks, the macOS analogue of `simctl`.
/// It renders the app's own window (never the screen) and posts keys into the app's own event queue, so it works
/// while the Mac is locked. Send a distributed notification `app.playarr.macos.debug` whose object is one of:
/// `snapshot:<path.png>` (the window content at 1920x1080), `key:<keyCode>[:shift]`, `tap:<x>,<y>` or `hold:<x>,<y>`
/// (a stage point).
@MainActor
enum MacDebugRemote {
    static func install(window: NSWindow) {
        // `-PlayarrMacSnapshot <path.png> [-PlayarrMacSnapshotDelay <seconds>]`: one snapshot once settled.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-PlayarrMacSnapshot"), args.indices.contains(i + 1) {
            let delay = args.firstIndex(of: "-PlayarrMacSnapshotDelay").flatMap { args.indices.contains($0 + 1) ? Double(args[$0 + 1]) : nil } ?? 10
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                snapshot(window: window, to: URL(fileURLWithPath: args[i + 1]))
            }
        }
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("app.playarr.macos.debug"), object: nil, queue: .main
        ) { note in
            let command = note.object as? String ?? ""
            NSLog("PlayarrMac debug: command %@", command)
            MainActor.assumeIsolated { run(command, window: window) }
        }
    }

    private static func run(_ command: String, window: NSWindow) {
        let parts = command.split(separator: ":", maxSplits: 2).map(String.init)
        switch parts.first {
        case "snapshot" where parts.count > 1:
            snapshot(window: window, to: URL(fileURLWithPath: parts[1]))
        case "key" where parts.count > 1:
            guard let code = UInt16(parts[1]) else { return }
            let flags: NSEvent.ModifierFlags = parts.count > 2 && parts[2] == "shift" ? [.shift] : []
            let chars = [36: "\r", 49: " ", 53: "\u{1b}", 51: "\u{7f}"][Int(code)] ?? ""
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags,
                                                timestamp: ProcessInfo.processInfo.systemUptime,
                                                windowNumber: window.windowNumber, context: nil,
                                                characters: chars, charactersIgnoringModifiers: chars,
                                                isARepeat: false, keyCode: code) {
                    NSApp.postEvent(event, atStart: false)
                }
            }
        case "tap" where parts.count > 1, "hold" where parts.count > 1:
            // A stage point (1920x1080): runs the target's action (tap) or long press (hold), as a click would.
            let xy = parts[1].split(separator: ",").compactMap { Double($0) }
            guard xy.count == 2, let target = MacFocusEngine.shared.target(at: CGPoint(x: xy[0], y: xy[1])) else {
                NSLog("PlayarrMac debug: no target at %@", parts[1])
                return
            }
            target.focus()
            if parts[0] == "hold" { target.secondary?() } else if let activate = target.activate { activate() } else {
                MacFocusEngine.click(target.frame, in: window)
            }
        case "targets":
            for t in MacFocusEngine.shared.targets.values.sorted(by: { ($0.frame.minY, $0.frame.minX) < ($1.frame.minY, $1.frame.minX) }) {
                NSLog("PlayarrMac targets: %@ layer=%d", NSStringFromRect(t.frame), t.layer)
            }
        case "focus":
            let engine = MacFocusEngine.shared
            let focused = engine.focusedID.flatMap { id in engine.targets[id].map { (id, $0) } }
            let bindings = engine.targets.filter { $0.value.isFocused() }
                .map { "\($0.key.uuidString) \(NSStringFromRect($0.value.frame))" }
                .joined(separator: ";")
            NSLog("PlayarrMac focus: engine=%@ live=[%@] key=%d top=%d targets=%d responder=%@",
                  focused.map { "\($0.0.uuidString) \(NSStringFromRect($0.1.frame))" } ?? "none",
                  bindings, window.isKeyWindow ? 1 : 0, engine.topLayer, engine.targets.count,
                  String(describing: window.firstResponder.map { type(of: $0) }))
        case "hover" where parts.count > 1, "rclick" where parts.count > 1:
            // The hover and right-click paths without moving the person's real pointer (a synthetic CGEvent would):
            // hover marks the target under a stage point as hovered and focused; rclick then runs its secondary action.
            let xy = parts[1].split(separator: ",").compactMap { Double($0) }
            let engine = MacFocusEngine.shared
            guard xy.count == 2, let target = engine.target(at: CGPoint(x: xy[0], y: xy[1])),
                  let id = engine.targets.first(where: { $0.value.frame == target.frame })?.key else {
                NSLog("PlayarrMac debug: no target at %@", parts[1])
                return
            }
            engine.didHover(id, true)
            target.focus()
            if parts[0] == "rclick" { NSLog("PlayarrMac debug: rclick handled=%d", engine.secondary(hovered: true) ? 1 : 0) }
        default:
            NSLog("PlayarrMac debug: unknown command %@", command)
        }
    }

    /// Renders the window's content layer tree at 1920x1080.
    private static func snapshot(window: NSWindow, to url: URL) {
        guard let view = window.contentView, view.bounds.width > 0 else {
            NSLog("PlayarrMac debug: snapshot skipped, window content %@", NSStringFromRect(window.contentView?.bounds ?? .zero))
            return
        }
        let width = 1920, height = 1080
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        // The stage sits at the top left, scaled to fit (MacTVStage); render just the stage at 1920x1080. AppKit draws the view
        // itself (`cacheDisplay`), so layer flips and shadow offsets come out as in a live window. `CALayer.render(in:)` into a
        // hand-flipped context mirrored every SwiftUI shadow offset in y.
        let scale = 1 / min(view.bounds.width / 1920, view.bounds.height / 1080)
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let shot = rep.cgImage else { return }
        let drawn = CGSize(width: view.bounds.width * scale, height: view.bounds.height * scale)
        ctx.interpolationQuality = .high
        ctx.draw(shot, in: CGRect(x: 0, y: CGFloat(height) - drawn.height, width: drawn.width, height: drawn.height))
        guard let image = ctx.makeImage(),
              let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { return }
        try? data.write(to: url)
        NSLog("PlayarrMac debug: snapshot %@", url.path)
    }
}
#endif
