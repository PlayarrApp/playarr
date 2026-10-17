import UIKit

/// Splits a tablet preview title into balanced word lines within a measured width.
enum BalancedTitleLayout {
    static func lines(for title: String, font: UIFont, tracking: CGFloat, maxWidth: CGFloat) -> [String]? {
        let words = title.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty, words.count <= 64, maxWidth > 0 else { return nil }

        let attributes: [NSAttributedString.Key: Any] = [.font: font, .kern: tracking]
        func width(_ string: String) -> CGFloat {
            (string as NSString).size(withAttributes: attributes).width
        }

        let count = words.count
        var widths = Array(repeating: Array(repeating: CGFloat.infinity, count: count + 1), count: count + 1)
        for start in 0..<count {
            for end in (start + 1)...count {
                let measured = width(words[start..<end].joined(separator: " "))
                if measured <= maxWidth { widths[start][end] = measured }
            }
        }

        var minimumLines = Array(repeating: Int.max, count: count + 1)
        minimumLines[0] = 0
        for start in 0..<count where minimumLines[start] < Int.max {
            for end in (start + 1)...count where widths[start][end].isFinite {
                minimumLines[end] = min(minimumLines[end], minimumLines[start] + 1)
            }
        }
        guard minimumLines[count] < Int.max else { return nil }

        let target = width(words.joined(separator: " ")) / CGFloat(minimumLines[count])
        var costs = Array(repeating: Array(repeating: CGFloat.infinity, count: count + 1), count: count + 1)
        var previous = Array(repeating: Array(repeating: -1, count: count + 1), count: count + 1)
        costs[0][0] = 0
        for lineCount in 1...minimumLines[count] {
            for end in lineCount...count {
                for start in (lineCount - 1)..<end where costs[lineCount - 1][start].isFinite {
                    let measured = widths[start][end]
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
