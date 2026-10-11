import Foundation
// notify <command>: posts app.playarr.macos.debug to the Playarr macOS debug build (see clients/apple-tv/macOS/MacDebugRemote.swift).
DistributedNotificationCenter.default().postNotificationName(Notification.Name("app.playarr.macos.debug"), object: CommandLine.arguments[1], userInfo: nil, deliverImmediately: true)
