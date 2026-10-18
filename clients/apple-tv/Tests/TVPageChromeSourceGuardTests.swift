import XCTest

/// Source-scan guard for the page anatomy (docs/design/page-layout.md, section 8, row 13.805): a header action tile is
/// always `TVHeaderPill` at the shell action column width, never a literal, and the Back disc is drawn only by
/// `TVPageHeader` (the pre-auth pages are exempt and use `TVBackButtonStyle`).
final class TVPageChromeSourceGuardTests: XCTestCase {
    private func sources() throws -> [(name: String, text: String)] {
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Sources")
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else {
            throw XCTSkip("source tree is not readable from the test host")
        }
        return try names.filter { $0.hasSuffix(".swift") }.map { name in
            (name, try String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8))
        }
    }

    func testHeaderPillsUseTheActionColumnWidth() throws {
        let literal = try NSRegularExpression(pattern: #"TVHeaderPill\(label: "(Filters|Calendar link|Create)"[^)]*width: \d"#)
        let offenders = try sources().filter { source in
            literal.firstMatch(in: source.text, range: NSRange(source.text.startIndex..., in: source.text)) != nil
        }.map(\.name)
        XCTAssertEqual(offenders, [], "use TVShellActionColumn.width for header action tiles")
    }

    func testBackButtonStyleStaysOnPreAuthPages() throws {
        let offenders = try sources().filter { $0.text.contains("TVBackButtonStyle(") && $0.name != "TVRootView.swift" }.map(\.name)
        XCTAssertEqual(offenders, [], "page Back is drawn by TVPageHeader; TVBackButtonStyle is for the pre-auth chrome only")
    }
}
