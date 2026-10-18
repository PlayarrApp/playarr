#include <QGuiApplication>
#include <time.h>
#include <QDebug>
#include <QQuickItem>
#include <QQuickWindow>
#include <QTimer>
#include <QNetworkDiskCache>
#include <QNetworkReply>
#include <QQmlContext>
#include <QQmlExpression>
#include <QQmlEngine>
#include <QQmlNetworkAccessManagerFactory>
#include <QQuickView>
#include <QStandardPaths>
#include <sailfishapp.h>

#include "api.h"
#include "playback.h"
#include "calendar.h"
#include "downloads.h"
#include "downloadsdbus.h"
#include <QDBusConnection>

// QML Image/Video requests to the signed-in server get the bearer token and an on-disk artwork cache.
class AuthNam : public QNetworkAccessManager
{
public:
    AuthNam(Api *api, QObject *parent) : QNetworkAccessManager(parent), m_api(api)
    {
        auto *cache = new QNetworkDiskCache(this);
        cache->setCacheDirectory(QStandardPaths::writableLocation(QStandardPaths::CacheLocation) + QStringLiteral("/artwork"));
        cache->setMaximumCacheSize(200 * 1024 * 1024);
        setCache(cache);
        setNetworkAccessible(QNetworkAccessManager::Accessible);
    }

protected:
    QNetworkReply *createRequest(Operation op, const QNetworkRequest &req, QIODevice *dev) override
    {
        QNetworkRequest r(req);
        const QByteArray bearer = m_api->bearerFor(req.url());
        if (!bearer.isEmpty())
            r.setRawHeader("Authorization", bearer);
        r.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::PreferCache);
        return QNetworkAccessManager::createRequest(op, r, dev);
    }

private:
    Api *m_api;
};

class NamFactory : public QQmlNetworkAccessManagerFactory
{
public:
    explicit NamFactory(Api *api) : m_api(api) {}
    QNetworkAccessManager *create(QObject *parent) override { return new AuthNam(m_api, parent); }

private:
    Api *m_api;
};

int main(int argc, char *argv[])
{
    // Parity captures only: PLAYARR_PARITY_CLOCK pins "today" (see Calendar::today), and the suite's timezone is UTC.
    if (qEnvironmentVariableIsSet("PLAYARR_PARITY_CLOCK")) {
        qputenv("TZ", "UTC");
        tzset();
    }
    QScopedPointer<QGuiApplication> app(SailfishApp::application(argc, argv));
    app->setApplicationVersion(QStringLiteral(APP_VERSION));
    Api api;
    Playback playback;
    Calendar calendar;
    Downloads downloads(&api);
    new DownloadsAdaptor(&downloads);
    QDBusConnection::sessionBus().registerService(QStringLiteral("com.playarr.app"));
    QDBusConnection::sessionBus().registerObject(QStringLiteral("/downloads"), &downloads, QDBusConnection::ExportAdaptors);
    QScopedPointer<QQuickView> view(SailfishApp::createView());
    api.setEngine(view->engine());
    QString base = SailfishApp::pathTo(QString()).toString(); // no trailing slash on some releases
    if (!base.endsWith(QLatin1Char('/')))
        base += QLatin1Char('/');
    api.setAssetBase(base);
    view->engine()->setNetworkAccessManagerFactory(new NamFactory(&api));
    view->rootContext()->setContextProperty(QStringLiteral("Api"), &api);
    view->rootContext()->setContextProperty(QStringLiteral("Playback"), &playback);
    view->rootContext()->setContextProperty(QStringLiteral("Calendar"), &calendar);
    view->rootContext()->setContextProperty(QStringLiteral("Downloads"), &downloads);
    view->setSource(SailfishApp::pathToMainQml());
    view->showFullScreen();
    // Developer smoke runs (set by whoever launches the app, no runtime channel): PLAYARR_STEPS is a '|' list of
    // `wait`, `js:<expression in the root QML context>` and `grab:<file.png>`, 1.5 s apart.
    const QStringList steps = QString::fromLocal8Bit(qgetenv("PLAYARR_STEPS")).split(QLatin1Char('|'), QString::SkipEmptyParts);
    int delay = 4000;
    for (const QString &step : steps) {
        QTimer::singleShot(delay, app.data(), [&view, step]() {
            if (step.startsWith(QLatin1String("grab:"))) {
                view->grabWindow().save(step.mid(5));
            } else if (step.startsWith(QLatin1String("js:"))) {
                QQmlExpression e(view->rootContext(), view->rootObject(), step.mid(3));
                e.evaluate();
                if (e.hasError())
                    qWarning() << "PLAYARR_STEPS:" << e.error().toString();
            }
        });
        delay += 1500;
    }
    return app->exec();
}
