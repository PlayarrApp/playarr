# Host (Qt 5.15) layout/data-flow smoke of the QML against Silica stubs. Not a Silica render: see README.
QT += quick qml network
CONFIG += c++11
TARGET = playarr-smoke
SOURCES += main.cpp ../../src/api.cpp ../../src/mediaproxy.cpp ../../src/downloads.cpp
HEADERS += ../../src/api.h ../../src/mediaproxy.h ../../src/downloads.h ../../src/downloadlogic.h ../../src/util.h ../../src/playback.h ../../src/playbacklogic.h ../../src/calendar.h ../../src/calendarlogic.h
INCLUDEPATH += ../../src
DEFINES += APP_VERSION=\\\"smoke\\\" SRC_ROOT=\\\"$$PWD/../..\\\"
