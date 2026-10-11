// Usage: SMOKE_STEPS='wait|grab:a.png|js:pageStack.currentPage.section="movies"|wait|grab:b.png' playarr-smoke
// SMOKE_ASSETS = dir holding avatars/<preset>.png. Needs QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software. HOME must hold the seeded settings.
#include <QDir>
#include <QScreen>
#include <QFontDatabase>
#include <cstdio>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlExpression>
#include <QQuickWindow>
#include <QTimer>
#include "api.h"
#include "playback.h"
#include "calendar.h"
#include "downloads.h"

// Enum namespaces Silica provides in C++.
struct PageStatus : QObject { Q_OBJECT public: enum Status { Inactive, Activating, Active, Deactivating }; Q_ENUMS(Status) };
struct Orientation : QObject { Q_OBJECT public: enum O { Portrait = 1, All = 15 }; Q_ENUMS(O) };
struct BusyIndicatorSize : QObject { Q_OBJECT public: enum S { Small, Medium, Large }; Q_ENUMS(S) };

// Stand-in for QtMultimedia's MediaPlayer (enums and the properties PlayerPage uses).
class MockPlayer : public QObject
{
    Q_OBJECT
    Q_ENUMS(Status PlaybackState)
    Q_PROPERTY(QUrl source MEMBER m_source NOTIFY sourceChanged)
    Q_PROPERTY(int position MEMBER m_position NOTIFY positionChanged)
    Q_PROPERTY(int duration MEMBER m_duration NOTIFY sourceChanged)
    Q_PROPERTY(int status MEMBER m_status NOTIFY statusChanged)
    Q_PROPERTY(int playbackState MEMBER m_state NOTIFY stateChanged)
    Q_PROPERTY(QString errorString MEMBER m_err)
public:
    enum Status { NoMedia, Loading, Loaded, Buffering, Stalled, Buffered, EndOfMedia };
    enum PlaybackState { StoppedState, PlayingState, PausedState };
    Q_INVOKABLE void play() { m_state = PlayingState; m_status = Buffered; emit stateChanged(); emit statusChanged(); }
    Q_INVOKABLE void pause() { m_state = PausedState; emit stateChanged(); }
    Q_INVOKABLE void stop() { m_state = StoppedState; emit stateChanged(); }
    Q_INVOKABLE void seek(int ms) { m_position = ms; emit positionChanged(); }
signals:
    void sourceChanged(); void positionChanged(); void statusChanged(); void stateChanged(); void error();
private:
    QUrl m_source; int m_position = 0, m_duration = 0, m_status = NoMedia, m_state = StoppedState; QString m_err;
};

int main(int argc, char *argv[])
{
    qInstallMessageHandler([](QtMsgType, const QMessageLogContext &, const QString &m) { fprintf(stderr, "%s\n", qPrintable(m)); });
    QGuiApplication app(argc, argv);
    const int fontId = QFontDatabase::addApplicationFont(QStringLiteral(SRC_ROOT "/../../docs/parity/fonts/NunitoSans-wght-web.ttf"));
    if (fontId >= 0) app.setFont(QFont(QFontDatabase::applicationFontFamilies(fontId).value(0)));
    app.setApplicationVersion(QStringLiteral(APP_VERSION));
    qmlRegisterUncreatableType<PageStatus>("Sailfish.Silica", 1, 0, "PageStatus", "enum");
    qmlRegisterUncreatableType<Orientation>("Sailfish.Silica", 1, 0, "Orientation", "enum");
    qmlRegisterUncreatableType<BusyIndicatorSize>("Sailfish.Silica", 1, 0, "BusyIndicatorSize", "enum");
    qmlRegisterType<MockPlayer>("QtMultimedia", 5, 6, "MediaPlayer");
    Api api;
    Playback playback;
    Calendar calendar;
    Downloads downloads(&api);
    QQmlApplicationEngine engine;
    engine.addImportPath(QStringLiteral(SRC_ROOT "/tests/smoke/stubs"));
    api.setEngine(&engine);
    api.setAssetBase(QUrl::fromLocalFile(QString::fromLocal8Bit(qgetenv("SMOKE_ASSETS")) + QLatin1Char('/')).toString());
    engine.rootContext()->setContextProperty(QStringLiteral("Api"), &api);
    engine.rootContext()->setContextProperty(QStringLiteral("Playback"), &playback);
    engine.rootContext()->setContextProperty(QStringLiteral("Calendar"), &calendar);
    engine.rootContext()->setContextProperty(QStringLiteral("Downloads"), &downloads);
    QObject::connect(&engine, &QQmlEngine::warnings, [](const QList<QQmlError> &w) { for (const QQmlError &e : w) fprintf(stderr, "%s\n", qPrintable(e.toString())); });
    engine.load(QUrl::fromLocalFile(QStringLiteral(SRC_ROOT "/qml/harbour-playarr.qml")));
    if (engine.rootObjects().isEmpty())
        return 2;
    QObject *root = engine.rootObjects().first();
    QStringList steps = QString::fromLocal8Bit(qgetenv("SMOKE_STEPS")).split(QLatin1Char('|'));
    int delay = 2000;
    for (const QString &s : steps) {
        QTimer::singleShot(delay, &app, [root, &engine, s]() {
            if (s.startsWith(QLatin1String("grab:")))
                { auto *w = qobject_cast<QQuickWindow *>(root); fprintf(stderr, "win %p vis=%d %dx%d exposed=%d\n", (void*)w, int(w && w->isVisible()), w ? w->width() : 0, w ? w->height() : 0, int(w && w->isExposed())); QImage img = w->grabWindow(); if (img.isNull()) img = w->screen()->grabWindow(w->winId()).toImage(); fprintf(stderr, "grab %dx%d saved=%d\n", img.width(), img.height(), int(img.save(s.mid(5)))); }
            else if (s.startsWith(QLatin1String("js:"))) {
                QQmlExpression e(engine.rootContext(), root, s.mid(3));
                e.evaluate();
                if (e.hasError()) qWarning() << "js step failed:" << e.error().toString();
            }
        });
        delay += s.startsWith(QLatin1String("wait")) ? 1500 : 500;
    }
    QTimer::singleShot(delay + 500, &app, &QCoreApplication::quit);
    return app.exec();
}

#include "main.moc"
