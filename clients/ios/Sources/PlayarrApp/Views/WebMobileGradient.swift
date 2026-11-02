import SwiftUI
import UIKit

/// A linear gradient that parity captures draw on the CPU.
///
/// The GPU gradient path rounds a level differently on each runner host, so two identical captures differ by one
/// level along every fade. In a parity capture this view fills a bitmap with integer-exact arithmetic (stops
/// interpolated premultiplied, as CSS does) and blits it; everywhere else it is the plain `LinearGradient`.
struct WMGradient: View {
    let stops: [Gradient.Stop]
    let startPoint: UnitPoint
    let endPoint: UnitPoint
    @Environment(\.self) private var environment

    init(stops: [Gradient.Stop], startPoint: UnitPoint, endPoint: UnitPoint) {
        self.stops = stops
        self.startPoint = startPoint
        self.endPoint = endPoint
    }

    init(colors: [Color], startPoint: UnitPoint, endPoint: UnitPoint) {
        let last = max(colors.count - 1, 1)
        self.init(
            stops: colors.enumerated().map { Gradient.Stop(color: $0.element, location: CGFloat($0.offset) / CGFloat(last)) },
            startPoint: startPoint, endPoint: endPoint
        )
    }

    var body: some View {
        #if DEBUG
        if ParityLaunch.zeroInsets {
            GeometryReader { proxy in
                if let image = WMGradientBitmap.image(
                    stops: stops, start: startPoint, end: endPoint, size: proxy.size, environment: environment
                ) {
                    Image(uiImage: image).resizable().frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
        } else {
            LinearGradient(stops: stops, startPoint: startPoint, endPoint: endPoint)
        }
        #else
        LinearGradient(stops: stops, startPoint: startPoint, endPoint: endPoint)
        #endif
    }
}

#if DEBUG
@MainActor
enum WMGradientBitmap {
    private static var cache: [String: UIImage] = [:]

    static func image(stops: [Gradient.Stop], start: UnitPoint, end: UnitPoint, size: CGSize, environment: EnvironmentValues) -> UIImage? {
        let scale = UIScreen.main.scale
        let width = Int((size.width * scale).rounded()), height = Int((size.height * scale).rounded())
        guard width > 0, height > 0, !stops.isEmpty else { return nil }
        struct Stop { var location: Double; var r: Double; var g: Double; var b: Double; var a: Double }
        let resolvedStops = stops.map { stop -> Stop in
            let c = stop.color.resolve(in: environment)
            let a = Double(c.opacity)
            return Stop(location: Double(stop.location), r: Double(c.red) * a, g: Double(c.green) * a, b: Double(c.blue) * a, a: a)
        }.sorted { $0.location < $1.location }
        let key = "\(width)x\(height)|\(start)|\(end)|\(resolvedStops)"
        if let cached = cache[key] { return cached }
        let sx = Double(start.x) * Double(width), sy = Double(start.y) * Double(height)
        let dx = Double(end.x) * Double(width) - sx, dy = Double(end.y) * Double(height) - sy
        let length2 = max(dx * dx + dy * dy, 1e-9)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        func level(_ v: Double) -> UInt8 { UInt8(max(0, min(255, (v * 255).rounded()))) }
        for y in 0..<height {
            for x in 0..<width {
                let t = ((Double(x) + 0.5 - sx) * dx + (Double(y) + 0.5 - sy) * dy) / length2
                var s = resolvedStops[0]
                if t >= resolvedStops[resolvedStops.count - 1].location {
                    s = resolvedStops[resolvedStops.count - 1]
                } else if t > resolvedStops[0].location {
                    for i in 1..<resolvedStops.count where t <= resolvedStops[i].location {
                        let p = resolvedStops[i - 1], q = resolvedStops[i]
                        let span = q.location - p.location
                        let f = span > 0 ? (t - p.location) / span : 1
                        s = Stop(location: t, r: p.r + (q.r - p.r) * f, g: p.g + (q.g - p.g) * f, b: p.b + (q.b - p.b) * f, a: p.a + (q.a - p.a) * f)
                        break
                    }
                }
                let o = (y * width + x) * 4
                pixels[o] = level(s.r); pixels[o + 1] = level(s.g); pixels[o + 2] = level(s.b); pixels[o + 3] = level(s.a)
            }
        }
        let image: UIImage? = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ), let cg = context.makeImage() else { return nil }
            return UIImage(cgImage: cg, scale: scale, orientation: .up)
        }
        if let image { cache[key] = image }
        return image
    }
}
#endif

/// A photo scaled to fill its box. Parity captures resample it once on the CPU and blit the result at one pixel per
/// pixel: the GPU texture filter rounds a few pixels differently on each runner host.
struct WMFillImage: View {
    let image: UIImage

    var body: some View {
        #if DEBUG
        if ParityLaunch.zeroInsets {
            GeometryReader { proxy in
                if let scaled = WMFillBitmap.image(image, size: proxy.size) {
                    Image(uiImage: scaled).resizable().frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
        } else {
            Image(uiImage: image).resizable().scaledToFill()
        }
        #else
        Image(uiImage: image).resizable().scaledToFill()
        #endif
    }
}

#if DEBUG
@MainActor
enum WMFillBitmap {
    private static var cache: [String: (source: UIImage, scaled: UIImage)] = [:]

    static func image(_ source: UIImage, size: CGSize) -> UIImage? {
        guard size.width > 0, size.height > 0, source.size.width > 0, source.size.height > 0 else { return nil }
        let key = "\(ObjectIdentifier(source).hashValue)|\(size.width)x\(size.height)"
        if let cached = cache[key], cached.source === source { return cached.scaled }
        let format = UIGraphicsImageRendererFormat()
        format.scale = UIScreen.main.scale
        format.opaque = false
        let factor = max(size.width / source.size.width, size.height / source.size.height)
        let drawn = CGSize(width: source.size.width * factor, height: source.size.height * factor)
        let rect = CGRect(x: (size.width - drawn.width) / 2, y: (size.height - drawn.height) / 2, width: drawn.width, height: drawn.height)
        let scaled = UIGraphicsImageRenderer(size: size, format: format).image { context in
            context.cgContext.interpolationQuality = .high
            source.draw(in: rect)
        }
        cache[key] = (source, scaled)
        return scaled
    }
}
#endif
