import QtQuick 2.6
import QtTest 1.1
import "../../../../clients/sailfish/qml/components/LayoutDump.js" as LayoutDump

TestCase {
    name: "LayoutDumpGeometry"
    when: windowShown
    visible: true

    Item {
        id: viewport
        width: 100
        height: 100
        x: 37
        y: 29

        Item {
            id: rotatedClip
            x: 40
            y: 40
            width: 20
            height: 20
            rotation: 45
            transformOrigin: Item.TopLeft
            clip: true

            Item { id: diamondInside; x: 8; y: 8; width: 3; height: 3 }
            Item { id: diamondAabbCorner; x: -4; y: -4; width: 3; height: 3 }
        }

        Item {
            id: offscreenParent
            x: 140
            y: 20
            width: 10
            height: 10
            Item { id: visibleChild; x: -140; y: 5; width: 12; height: 8 }
        }

        Item {
            id: scaledParent
            x: 5
            y: 7
            width: 40
            height: 40
            transform: Scale { xScale: 2; yScale: 3; origin.x: 0; origin.y: 0 }
            Item { id: scaledChild; x: 4; y: 2; width: 10; height: 5 }
        }

        Item {
            id: centredRotation
            x: 20
            y: 20
            width: 10
            height: 10
            rotation: 90
        }

        Item {
            id: reflected
            x: 70
            y: 10
            width: 10
            height: 10
            transform: Scale { xScale: -1; yScale: 1; origin.x: 0; origin.y: 0 }
        }

        Item {
            id: dumpTarget
            x: 72
            y: 4
            width: 6
            height: 8
            property bool navigationFocusable: true
            Accessible.name: "dump-target"; Accessible.role: Accessible.Button
        }
    }

    function test_rootLocalCoordinatesExcludeWindowOrigin() {
        var p = visibleChild.mapToItem(viewport, 0, 0)
        compare(Math.round(p.x), 0)
        compare(Math.round(p.y), 25)
    }

    function test_defaultCentreRotationMapsAllCorners() {
        var p = centredRotation.mapToItem(viewport, 0, 0)
        compare(Math.round(p.x), 30)
        compare(Math.round(p.y), 20)
    }

    function test_rotatedClipUsesItsPolygon() {
        verify(LayoutDump.clippedItemPolygon(diamondInside, viewport, 0, 0, 3, 3).length > 0)
        compare(LayoutDump.clippedItemPolygon(diamondAabbCorner, viewport, 0, 0, 3, 3).length, 0)
    }

    function test_offscreenUnclippedParentDoesNotPruneVisibleChild() {
        var poly = LayoutDump.clippedItemPolygon(visibleChild, viewport, 0, 0, visibleChild.width, visibleChild.height)
        var box = LayoutDump.polygonBounds(poly)
        compare(Math.round(box.x), 0)
        compare(Math.round(box.y), 25)
        compare(Math.round(box.w), 12)
        compare(Math.round(box.h), 8)
    }

    function test_inheritedNonuniformScaleMapsAllCorners() {
        var poly = LayoutDump.mappedRect(scaledChild, viewport, 0, 0, scaledChild.width, scaledChild.height)
        var box = LayoutDump.polygonBounds(poly)
        compare(Math.round(box.x), 13)
        compare(Math.round(box.y), 13)
        compare(Math.round(box.w), 20)
        compare(Math.round(box.h), 15)
    }

    function test_negativeScaleKeepsReflectedBounds() {
        var box = LayoutDump.polygonBounds(LayoutDump.mappedRect(reflected, viewport, 0, 0, reflected.width, reflected.height))
        compare(Math.round(box.x), 60)
        compare(Math.round(box.y), 10)
        compare(Math.round(box.w), 10)
        compare(Math.round(box.h), 10)
    }

    function test_dumpWalksRealQtItems() {
        var lines = []
        LayoutDump.dump(viewport, 1, ({}), function(line) { lines.push(line) }, function(item) { return { name: item.Accessible.name, role: item.Accessible.role } }, { width: 1, color: Qt.rgba(0, 0, 0, 1) })
        var elements = []
        for (var i = 0; i < lines.length; ++i) {
            if (lines[i].indexOf("LAYOUTEL|") === 0) elements = elements.concat(JSON.parse(lines[i].slice(9)))
        }
        compare(elements.length, 1)
        compare(elements[0].text, "dump-target")
        compare(elements[0].rect.x, 72)
        compare(elements[0].rect.y, 4)
        compare(elements[0].rect.w, 6)
        compare(elements[0].rect.h, 8)
    }
}
