# Host-side logic checks: scripts/sdk-build.sh test <sdk-dir> (QtCore only; the SDK target ships no QtTest headers).
QT = core
CONFIG += console c++11
CONFIG -= app_bundle
TARGET = tst_util
SOURCES += tst_util.cpp
INCLUDEPATH += ../src
