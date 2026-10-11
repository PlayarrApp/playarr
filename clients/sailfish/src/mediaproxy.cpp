#include "mediaproxy.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QTcpSocket>
#include <QUuid>

namespace {
const qint64 kMaxBuffered = 2 * 1024 * 1024; // bytes queued towards the player before we stop reading the server
}

MediaProxy::MediaProxy(QNetworkAccessManager *nam, std::function<QString()> serverUrl,
                       std::function<QByteArray(const QUrl &)> bearer, QObject *parent)
    : QTcpServer(parent), m_nam(nam), m_server(std::move(serverUrl)), m_bearer(std::move(bearer))
{
    m_token = QUuid::createUuid().toByteArray().mid(1, 36).replace("-", "");
    connect(this, &QTcpServer::newConnection, this, &MediaProxy::onConnection);
}

QString MediaProxy::base()
{
    if (!isListening() && !listen(QHostAddress::LocalHost, 0))
        return QString();
    return QStringLiteral("http://127.0.0.1:%1/%2").arg(serverPort()).arg(QString::fromLatin1(m_token));
}

MediaProxy::Request MediaProxy::parse(const QByteArray &head)
{
    Request r;
    const QList<QByteArray> lines = head.split('\n');
    const QList<QByteArray> first = lines.value(0).trimmed().split(' ');
    if (first.size() < 3)
        return r;
    r.method = first.at(0).toUpper();
    r.target = first.at(1);
    for (const QByteArray &l : lines.mid(1)) {
        const int c = l.indexOf(':');
        if (c > 0 && l.left(c).trimmed().toLower() == "range")
            r.range = l.mid(c + 1).trimmed();
    }
    r.ok = true;
    return r;
}

QString MediaProxy::upstreamPath(const QByteArray &target, const QByteArray &token)
{
    const QByteArray prefix = "/" + token + "/";
    if (!target.startsWith(prefix) || target.contains("..") || target.contains("//"))
        return QString();
    return QString::fromLatin1("/" + target.mid(prefix.size()));
}

void MediaProxy::onConnection()
{
    while (QTcpSocket *sock = nextPendingConnection()) {
        auto *buf = new QByteArray;
        connect(sock, &QTcpSocket::readyRead, this, [this, sock, buf]() {
            buf->append(sock->readAll());
            if (buf->size() > 16384) { sock->close(); return; }
            const int end = buf->indexOf("\r\n\r\n");
            if (end < 0)
                return;
            disconnect(sock, &QTcpSocket::readyRead, this, nullptr);
            handle(sock, buf->left(end));
        });
        connect(sock, &QTcpSocket::disconnected, sock, &QObject::deleteLater);
        connect(sock, &QObject::destroyed, [buf]() { delete buf; });
    }
}

void MediaProxy::handle(QTcpSocket *sock, const QByteArray &head)
{
    auto fail = [sock](int code, const char *text) {
        sock->write("HTTP/1.1 " + QByteArray::number(code) + " " + text + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        sock->disconnectFromHost();
    };
    const Request req = parse(head);
    if (!req.ok || (req.method != "GET" && req.method != "HEAD"))
        return fail(405, "Method Not Allowed");
    const QString path = upstreamPath(req.target, m_token);
    const QString server = m_server();
    if (path.isEmpty() || server.isEmpty())
        return fail(404, "Not Found");
    QString base = server;
    while (base.endsWith(QLatin1Char('/')))
        base.chop(1);
    const QUrl url(base + path);
    QNetworkRequest nr(url);
    const QByteArray bearer = m_bearer(url);
    if (!bearer.isEmpty())
        nr.setRawHeader("Authorization", bearer);
    if (!req.range.isEmpty())
        nr.setRawHeader("Range", req.range);
    nr.setRawHeader("X-Playarr-Client-Platform", "sailfish");
    nr.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    QNetworkReply *reply = req.method == "HEAD" ? m_nam->head(nr) : m_nam->get(nr);
    reply->setReadBufferSize(kMaxBuffered);

    QPointer<QTcpSocket> s(sock);
    auto sent = QSharedPointer<bool>::create(false);
    auto pump = [reply, s, sent]() {
        if (!s)
            return;
        if (!*sent) {
            const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            if (status == 0 && !reply->isFinished())
                return; // headers not here yet
            QByteArray head = "HTTP/1.1 " + QByteArray::number(status ? status : 502) + " "
                + reply->attribute(QNetworkRequest::HttpReasonPhraseAttribute).toByteArray() + "\r\n";
            for (const char *h : {"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"})
                if (reply->hasRawHeader(h))
                    head += QByteArray(h) + ": " + reply->rawHeader(h) + "\r\n";
            head += "Connection: close\r\n\r\n";
            s->write(head);
            *sent = true;
        }
        while (reply->bytesAvailable() > 0 && s->bytesToWrite() < kMaxBuffered)
            s->write(reply->read(64 * 1024));
        if (reply->isFinished() && reply->bytesAvailable() == 0)
            s->disconnectFromHost();
    };
    connect(reply, &QNetworkReply::readyRead, sock, pump);
    connect(reply, &QNetworkReply::finished, sock, pump);
    connect(sock, &QTcpSocket::bytesWritten, reply, [pump](qint64) { pump(); });
    connect(sock, &QTcpSocket::disconnected, reply, [reply]() { reply->abort(); });
    connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
}
