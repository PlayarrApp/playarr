import QtQuick 2.6
import Sailfish.Silica 1.0

// A Label that keeps the line boxes Qt lays out (Text.lineLaidOut), for the parity layout export (LayoutDump.js).
Label {
    property var laidLines: []
    onLineLaidOut: {
        if (line.number === 0) laidLines.length = 0
        laidLines.push({ x: line.x, y: line.y, w: line.width, h: line.height })
    }
}
