/// Resolves the library preview in the same order as the web focus and action surfaces.
enum LibraryOverlayParity {
    static func previewWork<Item>(actionsWork: Item?, focusedWork: Item?, works: [Item]) -> Item? {
        actionsWork ?? focusedWork ?? works.first
    }
}
