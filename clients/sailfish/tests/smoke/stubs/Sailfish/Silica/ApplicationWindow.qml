import QtQuick 2.6
import QtQuick.Window 2.2
Window {
    id: win
    visible: true
    width: 540; height: 960
    property var initialPage
    property Component cover
    property int _defaultPageOrientations
    property int allowedOrientations
    default property alias data: host.data
    property var _stack: []
    property var pageStack: QtObject {
        property var currentPage: win._stack.length ? win._stack[win._stack.length - 1] : null
        property int depth: win._stack.length
        function _show(item) { for (var i = 0; i < win._stack.length; ++i) win._stack[i].visible = false; if (item) { item.visible = true } }
        function push(page, props) {
            var comp = typeof page === "string" ? Qt.createComponent(page) : page
            if (comp.status === Component.Error) console.warn(comp.errorString())
            var it = comp.createObject(pages, props || {})
            it.anchors.fill = pages
            win._stack.push(it); win._stack = win._stack; _show(it); return it
        }
        function pop() { var it = win._stack.pop(); it.destroy(); win._stack = win._stack; _show(win._stack[win._stack.length - 1]) }
        function replaceAbove(target, page, props) { while (win._stack.length) { win._stack.pop().destroy() } return push(page, props) }
    }
    Item { id: host; visible: false }
    Item { id: pages; anchors.fill: parent }
    Component.onCompleted: if (initialPage) pageStack.push(initialPage)
}
