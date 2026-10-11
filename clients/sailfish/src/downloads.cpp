#include "downloads.h"
#include "api.h"
#include "downloadlogic.h"

#include <QDir>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTimer>

namespace {
QString dir()
{
    const QString d = QStandardPaths::writableLocation(QStandardPaths::MoviesLocation) + QStringLiteral("/Playarr");
    QDir().mkpath(d);
    return d;
}
}

Downloads::Downloads(Api *api, QObject *parent)
    : QObject(parent), m_api(api)
    , m_settings(QSettings::NativeFormat, QSettings::UserScope, QStringLiteral("harbour-playarr"), QStringLiteral("harbour-playarr-downloads"))
{
    load();
}

void Downloads::load()
{
    const int n = m_settings.beginReadArray(QStringLiteral("items"));
    for (int i = 0; i < n; ++i) {
        m_settings.setArrayIndex(i);
        Item it;
        it.ticketId = m_settings.value(QStringLiteral("ticketId")).toString();
        it.title = m_settings.value(QStringLiteral("title")).toString();
        it.container = m_settings.value(QStringLiteral("container")).toString();
        it.path = m_settings.value(QStringLiteral("path")).toString();
        it.size = m_settings.value(QStringLiteral("size")).toLongLong();
        it.state = m_settings.value(QStringLiteral("state")).toString();
        it.received = QFileInfo(it.path).size();
        if (it.state == QLatin1String("downloading"))
            it.state = QStringLiteral("paused"); // the app was closed mid-download
        if (!it.ticketId.isEmpty())
            m_items.append(it);
    }
    m_settings.endArray();
}

void Downloads::save()
{
    m_settings.beginWriteArray(QStringLiteral("items"), m_items.size());
    for (int i = 0; i < m_items.size(); ++i) {
        m_settings.setArrayIndex(i);
        const Item &it = m_items.at(i);
        m_settings.setValue(QStringLiteral("ticketId"), it.ticketId);
        m_settings.setValue(QStringLiteral("title"), it.title);
        m_settings.setValue(QStringLiteral("container"), it.container);
        m_settings.setValue(QStringLiteral("path"), it.path);
        m_settings.setValue(QStringLiteral("size"), it.size);
        m_settings.setValue(QStringLiteral("state"), it.state);
    }
    m_settings.endArray();
    m_settings.sync();
}

QVariantList Downloads::items() const
{
    QVariantList out;
    for (const Item &it : m_items) {
        QVariantMap m;
        m[QStringLiteral("ticketId")] = it.ticketId;
        m[QStringLiteral("title")] = it.title;
        m[QStringLiteral("container")] = it.container;
        m[QStringLiteral("path")] = it.path;
        m[QStringLiteral("size")] = double(it.size);
        m[QStringLiteral("received")] = double(it.received);
        m[QStringLiteral("state")] = it.state;
        out.append(m);
    }
    return out;
}

QString Downloads::pathOf(const QString &ticketId) const
{
    for (const Item &it : m_items)
        if (it.ticketId == ticketId && it.state == QLatin1String("done"))
            return it.path;
    return QString();
}

void Downloads::fetch(const QString &ticketId, const QString &title, const QString &container, double size)
{
    for (Item &it : m_items)
        if (it.ticketId == ticketId) {
            if (it.state != QLatin1String("downloading") && it.state != QLatin1String("done"))
                start(it);
            return;
        }
    Item it;
    it.ticketId = ticketId;
    it.title = title;
    it.container = container;
    it.size = qint64(size);
    it.path = dir() + QLatin1Char('/') + DownloadLogic::safeName(title, ticketId, container);
    m_items.append(it);
    start(m_items.last());
}

void Downloads::start(Item &it)
{
    const QString id = it.ticketId;
    it.received = QFileInfo(it.path).size();
    it.file = new QFile(it.path, this);
    if (!it.file->open(QIODevice::WriteOnly | QIODevice::Append)) {
        it.state = QStringLiteral("failed");
        delete it.file;
        it.file = nullptr;
        save();
        emit changed();
        return;
    }
    QNetworkRequest req(QUrl(m_api->url(QStringLiteral("/api/v1/downloads/%1/file").arg(id))));
    req.setRawHeader("Authorization", m_api->bearerFor(req.url()));
    if (it.received > 0)
        req.setRawHeader("Range", DownloadLogic::resumeRange(it.received));
    it.reply = m_api->network()->get(req);
    it.state = QStringLiteral("downloading");
    QNetworkReply *reply = it.reply;
    connect(reply, &QNetworkReply::readyRead, this, [this, id, reply]() {
        for (Item &x : m_items)
            if (x.ticketId == id && x.reply == reply) {
                const QByteArray b = reply->readAll();
                x.file->write(b);
                x.received += b.size();
            }
        emit changed();
    });
    connect(reply, &QNetworkReply::finished, this, [this, id]() { finishedReply(id); });
    save();
    emit changed();
}

void Downloads::finishedReply(const QString &id)
{
    for (Item &it : m_items) {
        if (it.ticketId != id || !it.reply)
            continue;
        QNetworkReply *reply = it.reply;
        it.reply = nullptr;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool ok = reply->error() == QNetworkReply::NoError && (status == 200 || status == 206);
        const QByteArray rest = reply->readAll();
        it.file->write(rest);
        it.received += rest.size();
        it.file->close();
        it.file->deleteLater();
        it.file = nullptr;
        reply->deleteLater();
        if (ok && (it.size <= 0 || it.received >= it.size)) {
            it.state = QStringLiteral("done");
        } else if (it.state == QLatin1String("paused")) {
            // paused by the user
        } else if (status == 401 || status == 0 || (ok && it.received < it.size)) {
            // token expired or connection dropped: refresh through a normal request, then resume with Range.
            it.state = QStringLiteral("paused");
            if (it.retries++ < 5) {
                m_api->request(QStringLiteral("GET"), QStringLiteral("/api/v1/users/me/capabilities"), QVariant(), QJSValue());
                QTimer::singleShot(3000, this, [this, id]() {
                    for (Item &x : m_items)
                        if (x.ticketId == id && x.state == QLatin1String("paused") && !x.reply)
                            start(x);
                });
            }
        } else {
            it.state = QStringLiteral("failed");
            QFile::remove(it.path);
            it.received = 0;
        }
        save();
        emit changed();
        return;
    }
}

void Downloads::pause(const QString &ticketId)
{
    for (Item &it : m_items)
        if (it.ticketId == ticketId && it.reply) {
            it.state = QStringLiteral("paused");
            it.reply->abort();
        }
}

void Downloads::remove(const QString &ticketId)
{
    for (int i = 0; i < m_items.size(); ++i) {
        if (m_items.at(i).ticketId != ticketId)
            continue;
        Item it = m_items.at(i);
        m_items.removeAt(i);
        if (it.reply) {
            it.reply->disconnect(this);
            it.reply->abort();
            it.reply->deleteLater();
        }
        if (it.file) {
            it.file->close();
            it.file->deleteLater();
        }
        QFile::remove(it.path);
        break;
    }
    save();
    emit changed();
}
