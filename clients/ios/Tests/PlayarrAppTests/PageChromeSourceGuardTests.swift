import XCTest

/// Source-scan guard for the page anatomy (docs/design/page-layout.md, section 8, row 13.804): Back is always
/// `PlayarrBackButton`, and a filters tile is always `PlayarrHeaderPill`, never a hand-built button.
final class PageChromeSourceGuardTests: XCTestCase {
    private func viewSources() throws -> [(name: String, text: String)] {
        let views = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/PlayarrApp/Views")
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: views.path) else {
            throw XCTSkip("source tree is not readable from the test host")
        }
        return try names.filter { $0.hasSuffix(".swift") }.map { name in
            (name, try String(contentsOf: views.appendingPathComponent(name), encoding: .utf8))
        }
    }

    func testBackArrowIsAlwaysPlayarrBackButton() throws {
        let offenders = try viewSources().filter { source in
            source.name != "PlayarrPageLayout.swift"
                && (source.text.contains(#"glyph: "←""#) || source.text.contains(#"glyph: "\u{2190}""#))
        }.map(\.name)
        XCTAssertEqual(offenders, [], "use PlayarrBackButton for the page Back arrow")
    }

    func testFiltersTileIsNeverHandBuilt() throws {
        // A Filters label inside a plain Button next to the slider glyph is the hand-built tile.
        let offenders = try viewSources().filter { source in
            source.name != "PlayarrPageHeader.swift" && source.text.contains(#"Text("Filters").font(WM.font"#)
        }.map(\.name)
        XCTAssertEqual(offenders, [], "use PlayarrHeaderPill for the Filters tile")
    }
}
