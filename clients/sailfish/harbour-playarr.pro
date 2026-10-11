TARGET = harbour-playarr
CONFIG += sailfishapp
QT += network

DEFINES += APP_VERSION=\\\"0.1.0\\\"

SOURCES += src/main.cpp src/api.cpp src/mediaproxy.cpp src/downloads.cpp
HEADERS += src/api.h src/mediaproxy.h src/downloads.h src/downloadlogic.h src/util.h src/playback.h src/playbacklogic.h src/calendar.h src/calendarlogic.h

OTHER_FILES += qml/*.qml qml/pages/*.qml qml/components/* rpm/harbour-playarr.spec harbour-playarr.desktop

# Avatar plates and the UI font come from the shared sources (scripts/sdk-build.sh stages them under assets/).
AVATARS = $$PWD/assets/avatars
!exists($$AVATARS): AVATARS = $$PWD/../shared/profile-avatars/plates
FONT = $$PWD/assets/fonts/NunitoSans-wght-web.ttf
!exists($$FONT): FONT = $$PWD/../../docs/parity/fonts/NunitoSans-wght-web.ttf
avatars.files = $$AVATARS/*.png
avatars.path = /usr/share/$${TARGET}/avatars
INSTALLS += avatars

fonts.files = $$FONT $$PWD/fonts/*.ttf
fonts.path = /usr/share/$${TARGET}/fonts
INSTALLS += fonts

DISTFILES += qml/harbour-playarr.qml

SAILFISHAPP_ICONS = 86x86 108x108 128x128 172x172
