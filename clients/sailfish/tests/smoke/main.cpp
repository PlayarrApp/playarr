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

// Enum namespaces Silica provides in C++.
struct PageStatus : QObject { Q_OBJECT public: enum Status { Inactive, Activating, Active, Deactivating }; Q_ENUMS(Status) };
struct Orientation : QObject { Q_OBJECT public: enum O { Portrait = 1, All = 15 }; Q_ENUMS(O) };
struct BusyIndicatorSize : QObject { Q_OBJECT public: enum S { Small, Medium, Large }; Q_ENUMS(S) };

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    const int fontId = QFontDatabase::addApplicationFont(QStringLiteral(SRC_ROOT "/../../docs/parity/fonts/NunitoSans-wght-web.ttf"));
    if (fontId >= 0) app.setFont(QFont(QFontDatabase::applicationFontFamilies(fontId).value(0)));
    app.setApplicationVersion(QStringLiteral(APP_VERSION));
    qmlRegisterUncreatableType<PageStatus>("Sailfish.Silica", 1, 0, "PageStatus", "enum");
    qmlRegisterUncreatableType<Orientation>("Sailfish.Silica", 1, 0, "Orientation", "enum");
    qmlRegisterUncreatableType<BusyIndicatorSize>("Sailfish.Silica", 1, 0, "BusyIndicatorSize", "enum");
    Api api;
    QQmlApplicationEngine engine;
    engine.addImportPath(QStringLiteral(SRC_ROOT "/tests/smoke/stubs"));
    api.setEngine(&engine);
    api.setAssetBase(QUrl::fromLocalFile(QString::fromLocal8Bit(qgetenv("SMOKE_ASSETS")) + QLatin1Char('/')).toString());
    engine.rootContext()->setContextProperty(QStringLiteral("Api"), &api);
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
