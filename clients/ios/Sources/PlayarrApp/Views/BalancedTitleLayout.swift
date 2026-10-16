import UIKit

/// Splits a tablet preview title into the most even word lines that fit its CSS-sized measure.
enum BalancedTitleLayout {
    static func lines(for title: String, font: UIFont, tracking: CGFloat, maxWidth: CGFloat) -> [String]? {
        let words = title.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty, words.count <= 64, maxWidth > 0 else { return nil }

        let attributes: [NSAttributedString.Key: Any] = [.font: font, .kern: tracking]
        func width(_ string: String) -> CGFloat {
            (string as NSString).size(withAttributes: attributes).width
        }

        let wordWidths = words.map(width)
        // Leave long unbroken tokens to SwiftUI's normal wrapping instead of clipping them.
        guard wordWidths.allSatisfy({ $0 <= maxWidth }) else { return nil }

        let count = words.count
        var lineWidths = Array(repeating: Array(repeating: CGFloat.infinity, count: count + 1), count: count + 1)
        for start in 0..<count {
            for end in (start + 1)...count {
                let text = words[start..<end].joined(separator: " ")
                let measured = width(text)
                if measured <= maxWidth {
                    lineWidths[start][end] = measured
                }
            }
        }

        // Find the smallest line count that fits before optimising balance.
        var minimumLines = Array(repeating: Int.max, count: count + 1)
        minimumLines[0] = 0
        for start in 0..<count where minimumLines[start] < Int.max {
            for end in (start + 1)...count where lineWidths[start][end].isFinite {
                minimumLines[end] = min(minimumLines[end], minimumLines[start] + 1)
            }
        }
        guard minimumLines[count] < Int.max else { return nil }

        // With a fixed line count, minimise squared deviation from one constant target width.
        // This gives balanced wraps without narrowing the CSS 9ch measure.
        let totalWidth = width(words.joined(separator: " "))
        var costs = Array(repeating: Array(repeating: CGFloat.infinity, count: count + 1), count: count + 1)
        var previous = Array(repeating: Array(repeating: -1, count: count + 1), count: count + 1)
        costs[0][0] = 0
        let target = totalWidth / CGFloat(minimumLines[count])
        for lineCount in 1...minimumLines[count] {
            for end in lineCount...count {
                for start in (lineCount - 1)..<end where costs[lineCount - 1][start].isFinite {
                    let measured = lineWidths[start][end]
                    guard measured.isFinite else { continue }
                    let deviation = measured - target
                    let candidate = costs[lineCount - 1][start] + deviation * deviation
                    if candidate < costs[lineCount][end] {
                        costs[lineCount][end] = candidate
                        previous[lineCount][end] = start
                    }
                }
            }
        }
        guard costs[minimumLines[count]][count].isFinite else { return nil }
        var result: [String] = []
        var end = count
        for line in stride(from: minimumLines[count], through: 1, by: -1) {
            let start = previous[line][end]
            guard start >= 0 else { return nil }
            result.append(words[start..<end].joined(separator: " "))
            end = start
        }
        return Array(result.reversed())
    }
}
