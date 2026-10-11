# Host-side logic checks: scripts/sdk-build.sh test <sdk-dir> (QtCore only; the SDK target ships no QtTest headers).
QT = core network
CONFIG += console c++11
CONFIG -= app_bundle
TARGET = tst_util
SOURCES += tst_util.cpp ../src/mediaproxy.cpp
HEADERS += ../src/downloadlogic.h ../src/mediaproxy.h ../src/playbacklogic.h ../src/calendarlogic.h
INCLUDEPATH += ../src
