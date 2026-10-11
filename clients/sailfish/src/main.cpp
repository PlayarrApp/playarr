#include <QGuiApplication>
#include <QQuickWindow>
#include <QTimer>
#include <QNetworkDiskCache>
#include <QNetworkReply>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQmlNetworkAccessManagerFactory>
#include <QQuickView>
#include <QStandardPaths>
#include <sailfishapp.h>

#include "api.h"

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
    QScopedPointer<QGuiApplication> app(SailfishApp::application(argc, argv));
    app->setApplicationVersion(QStringLiteral(APP_VERSION));
    Api api;
    QScopedPointer<QQuickView> view(SailfishApp::createView());
    api.setEngine(view->engine());
    api.setAssetBase(SailfishApp::pathTo(QString()).toString());
    view->engine()->setNetworkAccessManagerFactory(new NamFactory(&api));
    view->rootContext()->setContextProperty(QStringLiteral("Api"), &api);
    view->setSource(SailfishApp::pathToMainQml());
    view->showFullScreen();
    // Developer smoke captures (offscreen or emulator): PLAYARR_GRAB=<file.png>[:<delay ms>]
    const QString grab = QString::fromLocal8Bit(qgetenv("PLAYARR_GRAB"));
    if (!grab.isEmpty()) {
        const QStringList parts = grab.split(QLatin1Char(':'));
        QTimer::singleShot(parts.value(1, QStringLiteral("4000")).toInt(), app.data(), [&view, parts]() {
            view->grabWindow().save(parts.at(0));
            QCoreApplication::quit();
        });
    }
    return app->exec();
}
