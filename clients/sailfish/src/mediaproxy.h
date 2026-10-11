#pragma once
#include <QByteArray>
#include <QHash>
#include <QObject>
#include <QTcpServer>
#include <functional>

class QNetworkAccessManager;
class QNetworkReply;
class QTcpSocket;

// Loopback HTTP proxy for the platform media player. QtMultimedia's GStreamer backend cannot attach an Authorization
// header and drops the query string on relative HLS segment URIs, so the player talks to this proxy and the proxy
// talks to the Playarr server with the bearer token. GET/HEAD only, 127.0.0.1 only, a random path token guards it.
class MediaProxy : public QTcpServer
{
    Q_OBJECT
public:
    // serverUrl() gives the active server base, bearer(url) the current Authorization value (empty when none).
    MediaProxy(QNetworkAccessManager *nam, std::function<QString()> serverUrl, std::function<QByteArray(const QUrl &)> bearer,
               QObject *parent = nullptr);
    // Starts listening on demand and returns "http://127.0.0.1:<port>/<token>" (no trailing slash); empty on failure.
    QString base();

    // Parsed request line + the headers we forward; exposed for tests.
    struct Request { QByteArray method, target, range; bool ok = false; };
    static Request parse(const QByteArray &head);
    // The server-side path for a proxied target "/<token>/rest" or an empty string when the token does not match.
    static QString upstreamPath(const QByteArray &target, const QByteArray &token);

private slots:
    void onConnection();

private:
    void handle(QTcpSocket *sock, const QByteArray &head);
    QNetworkAccessManager *m_nam;
    std::function<QString()> m_server;
    std::function<QByteArray(const QUrl &)> m_bearer;
    QByteArray m_token;
};
