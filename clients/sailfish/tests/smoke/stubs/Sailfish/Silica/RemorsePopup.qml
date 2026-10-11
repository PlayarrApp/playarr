import QtQuick 2.6
QtObject { property string text; signal clicked(); function execute(t, f) { f() } }
