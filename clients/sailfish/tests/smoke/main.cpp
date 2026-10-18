// Usage: SMOKE_STEPS='wait|grab:a.png|js:pageStack.currentPage.section="movies"|wait|grab:b.png' playarr-smoke
// SMOKE_ASSETS = dir holding avatars/<preset>.png. Needs QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software. HOME must hold the seeded settings.
#include <QDir>
#include <QScreen>
#include <QFontDatabase>
#include <cstdio>
#include <QGuiApplication>
#include <QCoreApplication>
#include <QKeyEvent>
#include <QQuickItem>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlExpression>
#include <QQuickWindow>
#include <QSharedPointer>
#include <QTimer>
#include <QVariant>
#include <functional>
#include "api.h"
#include "playback.h"
#include "calendar.h"
#include "downloads.h"

// Enum namespaces Silica provides in C++.
struct PageStatus : QObject { Q_OBJECT public: enum Status { Inactive, Activating, Active, Deactivating }; Q_ENUMS(Status) };
struct Orientation : QObject { Q_OBJECT public: enum O { Portrait = 1, All = 15 }; Q_ENUMS(O) };
struct BusyIndicatorSize : QObject { Q_OBJECT public: enum S { Small, Medium, Large }; Q_ENUMS(S) };

// Stand-in for Silica's EnterKey attached type (the on-screen keyboard's enter key); only the properties the QML sets.
class EnterKeyAttached : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString iconSource MEMBER m_icon)
signals:
    void clicked();
public:
    using QObject::QObject;
private:
    QString m_icon;
};
struct EnterKeyType : QObject
{
    Q_OBJECT
public:
    static EnterKeyAttached *qmlAttachedProperties(QObject *parent) { return new EnterKeyAttached(parent); }
};
QML_DECLARE_TYPEINFO(EnterKeyType, QML_HAS_ATTACHED_PROPERTIES)

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
    qmlRegisterType<EnterKeyType>("Sailfish.Silica", 1, 0, "EnterKey");
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
    QSharedPointer<int> stepIndex(new int(0));
    QSharedPointer<std::function<void ()> > runStep(new std::function<void ()>);
    *runStep = [root, &engine, &app, steps, stepIndex, runStep]() {
        if (*stepIndex >= steps.size()) { app.quit(); return; }
        const QString s = steps.at((*stepIndex)++);
        if (s.isEmpty()) { app.quit(); return; }
        const auto continueAfter = [runStep, &app](int ms) {
            QTimer::singleShot(ms, &app, [runStep]() { (*runStep)(); });
        };
        if (s.startsWith(QLatin1String("wait"))) { continueAfter(1500); return; }
        if (s.startsWith(QLatin1String("grab:"))) {
            auto *w = qobject_cast<QQuickWindow *>(root);
            fprintf(stderr, "win %p vis=%d %dx%d exposed=%d\n", (void*)w, int(w && w->isVisible()), w ? w->width() : 0, w ? w->height() : 0, int(w && w->isExposed()));
            QImage img = w->grabWindow();
            if (img.isNull()) img = w->screen()->grabWindow(w->winId()).toImage();
            fprintf(stderr, "grab %dx%d saved=%d\n", img.width(), img.height(), int(img.save(s.mid(5))));
            continueAfter(500);
            return;
        }
        if (s.startsWith(QLatin1String("js:"))) {
            QQmlExpression e(engine.rootContext(), root, s.mid(3));
            e.evaluate();
            if (e.hasError()) {
                qWarning() << "js step failed:" << e.error().toString();
                app.exit(3);
                return;
            }
            continueAfter(500);
            return;
        }
        if (s.startsWith(QLatin1String("key:")) || s.startsWith(QLatin1String("keydown:")) || s.startsWith(QLatin1String("keyup:"))) {
            auto *w = qobject_cast<QQuickWindow *>(root);
            const bool downOnly = s.startsWith(QLatin1String("keydown:"));
            const bool upOnly = s.startsWith(QLatin1String("keyup:"));
            const int prefix = downOnly ? 8 : upOnly ? 6 : 4;
            const QString name = s.mid(prefix);
            int key = 0;
            if (name == QLatin1String("Right")) key = Qt::Key_Right;
            else if (name == QLatin1String("Left")) key = Qt::Key_Left;
            else if (name == QLatin1String("Up")) key = Qt::Key_Up;
            else if (name == QLatin1String("Down")) key = Qt::Key_Down;
            else if (name == QLatin1String("Escape")) key = Qt::Key_Escape;
            else if (name == QLatin1String("Return")) key = Qt::Key_Return;
            else if (name == QLatin1String("Select")) key = Qt::Key_Select;
            else if (name == QLatin1String("Space")) key = Qt::Key_Space;
            if (!w || key == 0) {
                fprintf(stderr, "SMOKE_KEY_FAIL: %s\n", qPrintable(name));
                app.exit(5);
                return;
            }
            if (!upOnly) {
                QKeyEvent press(QEvent::KeyPress, key, Qt::NoModifier);
                QCoreApplication::sendEvent(w, &press);
            }
            if (!downOnly) {
                QKeyEvent release(QEvent::KeyRelease, key, Qt::NoModifier);
                QCoreApplication::sendEvent(w, &release);
            }
            fprintf(stderr, "SMOKE_KEY_SENT: %s %s\n", qPrintable(name), downOnly ? "down" : upOnly ? "up" : "tap");
            continueAfter(500);
            return;
        }
        if (s.startsWith(QLatin1String("focus:"))) {
            QQmlExpression e(engine.rootContext(), root, QStringLiteral("pageStack.currentPage"));
            QObject *page = e.evaluate().value<QObject *>();
            QQuickItem *target = page ? qobject_cast<QQuickItem *>(page->findChild<QObject *>(s.mid(6))) : nullptr;
            if (!target) {
                fprintf(stderr, "SMOKE_FOCUS_FAIL: %s\n", qPrintable(s.mid(6)));
                app.exit(6);
                return;
            }
            target->forceActiveFocus();
            fprintf(stderr, "SMOKE_FOCUS_SET: %s\n", qPrintable(s.mid(6)));
            continueAfter(500);
            return;
        }
        if (s.startsWith(QLatin1String("observe:"))) {
            const QString expression = s.mid(8);
            QQmlExpression e(engine.rootContext(), root, expression);
            const QVariant value = e.evaluate();
            if (e.hasError()) {
                qWarning() << "smoke observation expression failed:" << e.error().toString();
                app.exit(8);
                return;
            }
            fprintf(stderr, "SMOKE_OBSERVE: %s = %s\n", qPrintable(expression), qPrintable(value.toString()));
            continueAfter(100);
            return;
        }
        if (s.startsWith(QLatin1String("assert:"))) {
            const QString expression = s.mid(7);
            auto *poll = new QTimer(&app);
            QSharedPointer<int> attempts(new int(0));
            QObject::connect(poll, &QTimer::timeout, &app, [poll, &engine, root, &app, expression, attempts, continueAfter]() {
                QQmlExpression e(engine.rootContext(), root, expression);
                const QVariant value = e.evaluate();
                if (e.hasError()) {
                    qWarning() << "smoke assertion expression failed:" << e.error().toString();
                    poll->stop();
                    poll->deleteLater();
                    app.exit(4);
                } else if (value.toBool()) {
                    fprintf(stderr, "SMOKE_ASSERT_PASS: %s\n", qPrintable(expression));
                    poll->stop();
                    poll->deleteLater();
                    continueAfter(500);
                } else if (++(*attempts) >= 120) {
                    fprintf(stderr, "SMOKE_ASSERT_FAIL: %s\n", qPrintable(expression));
                    poll->stop();
                    poll->deleteLater();
                    app.exit(4);
                }
            });
            poll->start(100);
            return;
        }
        fprintf(stderr, "SMOKE_STEP_FAIL: %s\n", qPrintable(s));
        app.exit(7);
    };
    QTimer::singleShot(2000, &app, [runStep]() { (*runStep)(); });
    return app.exec();
}

#include "main.moc"
