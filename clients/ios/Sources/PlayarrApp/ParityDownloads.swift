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
               let seq = cmd["seq"] as? Int, seq > done,
               let file = (cmd["file"] as? String).flatMap(UUID.init(uuidString:)) {
                done = seq
                switch cmd["action"] as? String {
                case "start":
                    if let work = (cmd["work"] as? String).flatMap(UUID.init(uuidString:)) {
                        repository.enqueue(
                            candidates: [DownloadCandidate(mediaFileID: file, workID: work, title: cmd["title"] as? String ?? "Parity")],
                            profile: "original", keepUntil: .forever
                        )
                    }
                case "pause": repository.pause(mediaFileID: file)
                case "resume": repository.resume(mediaFileID: file)
                case "cancel", "delete": repository.cancel(mediaFileID: file)
                default: break
                }
            }
            repository.refresh()
            ParityLaunch.record("downloads", repository.records.map {
                ["file": $0.mediaFileID.uuidString, "state": $0.state.rawValue, "progress": $0.progressFraction, "bytes": $0.bytesWritten, "error": $0.errorMessage ?? ""] as [String: Any]
            })
            ParityLaunch.record("downloadsAck", done)
            try? await Task.sleep(for: .milliseconds(500))
        }
    }
}
#endif
