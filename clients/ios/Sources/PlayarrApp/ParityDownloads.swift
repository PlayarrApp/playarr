import Foundation
import PlayarrKit

#if DEBUG
/// Download cases of the shared parity suite (scripts/parity/suite.json `downloads`). The simulator driver writes
/// Documents/parity-cmd.json ({seq, action: start|pause|resume|cancel|delete, file, work, title}); this loop runs each new
/// command on the app's own DownloadRepository and publishes every record under "downloads" in parity-state.json.
enum ParityDownloads {
    @MainActor static func run(_ repository: DownloadRepository) async {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let command = docs.appendingPathComponent("parity-cmd.json")
        var done = -1
        while !Task.isCancelled {
            if let data = try? Data(contentsOf: command),
               let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let seq = cmd["seq"] as? Int, seq > done {
                done = seq
                let work = (cmd["work"] as? String).flatMap(UUID.init(uuidString:))
                let file = (cmd["file"] as? String).flatMap(UUID.init(uuidString:))
                if cmd["action"] as? String == "group", let work {
                    // A whole series or season, through the repository calls the page's group buttons make.
                    let season = cmd["season"] as? Int
                    let ids = repository.records.filter { $0.workID == work && (season == nil || $0.seasonNumber == season) }.map(\.mediaFileID)
                    switch cmd["op"] as? String {
                    case "pause": repository.pause(mediaFileIDs: ids)
                    case "resume": repository.resume(mediaFileIDs: ids)
                    case "delete": repository.cancel(mediaFileIDs: ids)
                    default: break
                    }
                } else if let file {
                    switch cmd["action"] as? String {
                    case "start":
                        if let work {
                            repository.enqueue(
                                candidates: [DownloadCandidate(
                                    mediaFileID: file, workID: work, title: cmd["title"] as? String ?? "Parity",
                                    workKind: cmd["kind"] as? String, seriesTitle: cmd["series"] as? String,
                                    seasonNumber: cmd["season"] as? Int, episodeNumber: cmd["episode"] as? Int
                                )],
                                profile: "original", keepUntil: .forever
                            )
                        }
                    case "pause": repository.pause(mediaFileID: file)
                    case "resume": repository.resume(mediaFileID: file)
                    case "cancel", "delete": repository.cancel(mediaFileID: file)
                    case "keep": // edit keep-until: forever, or after watched N days
                        repository.updateKeepUntil(mediaFileID: file, (cmd["days"] as? Int).map { .afterWatched(amount: $0, unit: .days) } ?? .forever)
                    case "quality": repository.changeQuality(mediaFileID: file, profile: cmd["profile"] as? String)
                    default: break
                    }
                }
            }
            repository.refresh()
            ParityLaunch.record("downloads", repository.records.map {
                ["file": $0.mediaFileID.uuidString, "state": $0.state.rawValue, "progress": $0.progressFraction, "bytes": $0.bytesWritten,
                 "error": $0.errorMessage ?? "", "profile": $0.profile ?? "original", "keep": "\($0.keepUntil)",
                 "kind": $0.workKind ?? "", "season": $0.seasonNumber ?? -1] as [String: Any]
            })
            ParityLaunch.record("downloadsAck", done)
            try? await Task.sleep(for: .milliseconds(500))
        }
    }
}
#endif
