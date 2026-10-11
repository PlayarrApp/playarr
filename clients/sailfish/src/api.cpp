#include "api.h"
#include "util.h"

#include <QBuffer>
#include <QCoreApplication>
#include <QDateTime>
#include <QJSEngine>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrlQuery>

namespace {
// Compatibility identity until the server and broker accept "sailfish" (same approach as the Roku client).
const char kPlatform[] = "web";
const char kHosted[] = "https://playarr.app";
const char kGrant[] = "urn:ietf:params:oauth:grant-type:device_code";

QNetworkRequest baseRequest(const QUrl &url)
{
    QNetworkRequest r(url);
    r.setRawHeader("Accept", "application/json");
    r.setRawHeader("X-Playarr-Client-Platform", kPlatform);
    r.setRawHeader("X-Playarr-Client-Version", QCoreApplication::applicationVersion().toUtf8());
    r.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    return r;
}

QJsonObject toObject(const QByteArray &raw)
{
    return QJsonDocument::fromJson(raw).object();
}
} // namespace

Api::Api(QObject *parent)
    : QObject(parent)
    , m_proxy(&m_nam, [this]() { return serverUrl(); }, [this](const QUrl &u) { return bearerFor(u); }, this)
    , m_settings(QSettings::NativeFormat, QSettings::UserScope, QStringLiteral("harbour-playarr"), QStringLiteral("harbour-playarr"))
{
    // Qt 5.6 on Sailfish reports "not accessible" until connman says online (never on the emulator); do not let that block requests.
    m_nam.setNetworkAccessible(QNetworkAccessManager::Accessible);
    load();
    QTimer::singleShot(0, this, &Api::refreshFlags);
    m_linkTimer.setSingleShot(true);
    connect(&m_linkTimer, &QTimer::timeout, this, &Api::linkStep);
}

// shortcut: tokens live in the app's config file (per-user, mode 0600 by QSettings); move to Sailfish Secrets when it is open to Harbour apps.
void Api::load()
{
    m_theme = m_settings.value(QStringLiteral("theme"), QStringLiteral("system")).toString();
    const int n = m_settings.beginReadArray(QStringLiteral("profiles"));
    for (int i = 0; i < n; ++i) {
        m_settings.setArrayIndex(i);
        Profile p;
        p.userId = m_settings.value(QStringLiteral("userId")).toString();
        p.name = m_settings.value(QStringLiteral("name")).toString();
        p.deviceId = m_settings.value(QStringLiteral("deviceId")).toString();
        p.access = m_settings.value(QStringLiteral("access")).toString();
        p.refresh = m_settings.value(QStringLiteral("refresh")).toString();
        p.server = m_settings.value(QStringLiteral("server")).toString();
        p.avatar = m_settings.value(QStringLiteral("avatar")).toString();
        p.pinLocked = m_settings.value(QStringLiteral("pinLocked")).toBool();
        p.expiresAt = m_settings.value(QStringLiteral("expiresAt")).toLongLong();
        if (!p.userId.isEmpty() && !p.refresh.isEmpty())
            m_profiles.append(p);
    }
    m_settings.endArray();
    const QString active = m_settings.value(QStringLiteral("active")).toString();
    for (int i = 0; i < m_profiles.size(); ++i)
        if (m_profiles.at(i).userId == active)
            m_active = i;
}

void Api::save()
{
    m_settings.setValue(QStringLiteral("theme"), m_theme);
    m_settings.setValue(QStringLiteral("active"), m_active >= 0 ? m_profiles.at(m_active).userId : QString());
    m_settings.beginWriteArray(QStringLiteral("profiles"), m_profiles.size());
    for (int i = 0; i < m_profiles.size(); ++i) {
        m_settings.setArrayIndex(i);
        const Profile &p = m_profiles.at(i);
        m_settings.setValue(QStringLiteral("userId"), p.userId);
        m_settings.setValue(QStringLiteral("name"), p.name);
        m_settings.setValue(QStringLiteral("deviceId"), p.deviceId);
        m_settings.setValue(QStringLiteral("access"), p.access);
        m_settings.setValue(QStringLiteral("refresh"), p.refresh);
        m_settings.setValue(QStringLiteral("server"), p.server);
        m_settings.setValue(QStringLiteral("avatar"), p.avatar);
        m_settings.setValue(QStringLiteral("pinLocked"), p.pinLocked);
        m_settings.setValue(QStringLiteral("expiresAt"), p.expiresAt);
    }
    m_settings.endArray();
    m_settings.sync();
}

QString Api::serverUrl() const { return m_active >= 0 ? m_profiles.at(m_active).server : QString(); }
QString Api::profileId() const { return m_active >= 0 ? m_profiles.at(m_active).userId : QString(); }
QString Api::profileName() const { return m_active >= 0 ? m_profiles.at(m_active).name : QString(); }
QString Api::profileAvatar() const
{
    return m_active >= 0 ? avatarSource(m_profiles.at(m_active).avatar.isEmpty() ? Util::defaultAvatarPreset(profileId())
                                                                                  : m_profiles.at(m_active).avatar)
                         : QString();
}

QVariantList Api::profilesModel() const
{
    QVariantList out;
    for (int i = 0; i < m_profiles.size(); ++i) {
        const Profile &p = m_profiles.at(i);
        QVariantMap m;
        m[QStringLiteral("userId")] = p.userId;
        m[QStringLiteral("name")] = p.name.isEmpty() ? tr("Profile") : p.name;
        m[QStringLiteral("avatar")] = avatarSource(p.avatar.isEmpty() ? Util::defaultAvatarPreset(p.userId) : p.avatar);
        m[QStringLiteral("active")] = i == m_active;
        m[QStringLiteral("pinLocked")] = p.pinLocked;
        out.append(m);
    }
    return out;
}

// Preset id -> bundled plate; a "data:" URL (custom JPEG) is used as is.
QString Api::avatarSource(const QString &avatar) const
{
    if (avatar.startsWith(QLatin1String("data:")))
        return avatar;
    return m_assetBase + QStringLiteral("avatars/") + avatar + QStringLiteral(".png");
}

void Api::setAssetBase(const QString &b)
{
    m_assetBase = b;
    emit assetBaseChanged();
    emit sessionChanged();
}

void Api::setThemeMode(const QString &mode)
{
    if (mode == m_theme)
        return;
    m_theme = mode;
    save();
    emit themeModeChanged();
}

QString Api::url(const QString &path) const { return Util::joinUrl(serverUrl(), path); }

QString Api::artwork(const QString &workId, const QVariantList &images, const QStringList &kinds) const
{
    for (const QString &kind : kinds)
        for (const QVariant &v : images)
            if (v.toMap().value(QStringLiteral("kind")).toString() == kind)
                return url(QStringLiteral("/api/v1/artwork/work/%1/%2").arg(workId, kind));
    return QString();
}

// The media player talks to the loopback proxy (see mediaproxy.h); the proxy adds the bearer token.
QString Api::playbackUrl(const QString &infoUrl, const QString &sessionId) const
{
    QUrl u(infoUrl.startsWith(QLatin1String("http")) ? infoUrl : url(infoUrl));
    QUrlQuery q(u);
    if (!q.hasQueryItem(QStringLiteral("playback_session_id")))
        q.addQueryItem(QStringLiteral("playback_session_id"), sessionId);
    u.setQuery(q);
    const QString base = const_cast<MediaProxy &>(m_proxy).base();
    if (base.isEmpty() || Util::originOf(u) != Util::originOf(QUrl(serverUrl())))
        return u.toString();
    return base + u.path() + QLatin1Char('?') + u.query();
}

QByteArray Api::bearerFor(const QUrl &u) const
{
    if (m_active < 0 || Util::originOf(u) != Util::originOf(QUrl(serverUrl())))
        return QByteArray();
    return "Bearer " + m_profiles.at(m_active).access.toUtf8();
}

// ---- authenticated requests -------------------------------------------------

void Api::request(const QString &method, const QString &path, const QVariant &body, const QJSValue &cb)
{
    Req r;
    r.method = method.toUpper();
    r.path = path;
    r.cb = cb;
    if (body.isValid() && !body.isNull())
        r.body = QJsonDocument::fromVariant(body).toJson(QJsonDocument::Compact);
    send(r);
}

void Api::requestText(const QString &path, const QJSValue &cb)
{
    Req r;
    r.method = QStringLiteral("GET");
    r.cb = cb;
    r.text = true;
    const QUrl u(path);
    r.path = u.scheme().isEmpty() ? path : u.path() + (u.hasQuery() ? QStringLiteral("?") + u.query() : QString());
    if (!u.scheme().isEmpty() && Util::originOf(u) != Util::originOf(QUrl(serverUrl()))) {
        finish(r, 0, QVariant()); // never send the token to another host
        return;
    }
    send(r);
}

QVariant Api::setting(const QString &key, const QVariant &fallback) const
{
    return m_settings.value(QStringLiteral("app/") + key, fallback);
}

void Api::setSetting(const QString &key, const QVariant &value)
{
    m_settings.setValue(QStringLiteral("app/") + key, value);
    m_settings.sync();
}

void Api::finish(const Req &r, int status, const QVariant &data)
{
    if (r.cb.isCallable() && m_engine) {
        QJSValue cb = r.cb;
        cb.call(QJSValueList() << QJSValue(status) << m_engine->toScriptValue(data));
    }
}

void Api::send(const Req &r)
{
    if (m_active < 0) {
        finish(r, 401, QVariant());
        return;
    }
    if (m_refreshing || m_profiles.at(m_active).expiresAt - QDateTime::currentMSecsSinceEpoch() < 30000) {
        m_waiting.append(r);
        refresh();
        return;
    }
    const Profile &p = m_profiles.at(m_active);
    QNetworkRequest req = baseRequest(QUrl(Util::joinUrl(p.server, r.path)));
    req.setRawHeader("Authorization", "Bearer " + p.access.toUtf8());
    QNetworkReply *reply;
    if (r.method == QLatin1String("GET"))
        reply = m_nam.get(req);
    else if (r.method == QLatin1String("DELETE"))
        reply = m_nam.deleteResource(req);
    else if (r.method == QLatin1String("POST"))
        reply = m_nam.post(req, r.body);
    else if (r.method == QLatin1String("PUT"))
        reply = m_nam.put(req, r.body);
    else { // Qt 5.6's custom verbs need a device for the body.
        auto *buf = new QBuffer;
        buf->setData(r.body);
        buf->open(QIODevice::ReadOnly);
        reply = m_nam.sendCustomRequest(req, r.method.toLatin1(), buf);
        buf->setParent(reply);
    }
    const QString user = p.userId;
    connect(reply, &QNetworkReply::finished, this, [this, reply, r, user]() {
        reply->deleteLater();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status == 401 && !r.retried && profileId() == user) {
            Req again = r;
            again.retried = true;
            m_waiting.append(again);
            refresh();
            return;
        }
        const QByteArray raw = reply->readAll();
        finish(r, status, r.text ? QVariant(QString::fromUtf8(raw)) : raw.isEmpty() ? QVariant() : QJsonDocument::fromJson(raw).toVariant());
    });
}

void Api::refresh()
{
    if (m_refreshing || m_active < 0)
        return;
    m_refreshing = true;
    const Profile p = m_profiles.at(m_active);
    QJsonObject body;
    body[QStringLiteral("device_id")] = p.deviceId;
    body[QStringLiteral("refresh_token")] = p.refresh;
    QNetworkReply *reply = post(QUrl(Util::joinUrl(p.server, QStringLiteral("/api/v1/auth/refresh"))), body);
    connect(reply, &QNetworkReply::finished, this, [this, reply, p]() {
        reply->deleteLater();
        m_refreshing = false;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = toObject(reply->readAll());
        const int idx = [&]() { for (int i = 0; i < m_profiles.size(); ++i) if (m_profiles.at(i).userId == p.userId) return i; return -1; }();
        QList<Req> queue = m_waiting;
        m_waiting.clear();
        if (status == 200 && idx >= 0) {
            Profile &q = m_profiles[idx];
            q.access = o.value(QStringLiteral("access_token")).toString();
            q.refresh = o.value(QStringLiteral("refresh_token")).toString();
            q.expiresAt = QDateTime::currentMSecsSinceEpoch() + qint64(o.value(QStringLiteral("expires_in")).toDouble(3600) * 1000);
            save();
            for (const Req &r : queue)
                send(r);
            return;
        }
        if (status == 400 || status == 401) { // refresh token revoked or expired: forget this profile
            if (idx >= 0) {
                m_profiles.removeAt(idx);
                m_active = m_profiles.isEmpty() ? -1 : 0;
                save();
                emit sessionChanged();
            }
        }
        for (const Req &r : queue)
            finish(r, status, QVariant());
    });
}

QNetworkReply *Api::post(const QUrl &url, const QJsonObject &body, bool auth)
{
    QNetworkRequest req = baseRequest(url);
    if (auth && m_active >= 0)
        req.setRawHeader("Authorization", "Bearer " + m_profiles.at(m_active).access.toUtf8());
    return m_nam.post(req, QJsonDocument(body).toJson(QJsonDocument::Compact));
}

// ---- profiles ---------------------------------------------------------------

void Api::selectProfile(const QString &userId)
{
    for (int i = 0; i < m_profiles.size(); ++i)
        if (m_profiles.at(i).userId == userId) {
            m_active = i;
            save();
            emit sessionChanged();
            refreshFlags();
            return;
        }
}

void Api::removeProfile(const QString &userId)
{
    const QString active = profileId();
    for (int i = 0; i < m_profiles.size(); ++i)
        if (m_profiles.at(i).userId == userId) {
            m_profiles.removeAt(i);
            break;
        }
    m_active = -1;
    for (int i = 0; i < m_profiles.size(); ++i)
        if (m_profiles.at(i).userId == active)
            m_active = i;
    save();
    emit sessionChanged();
}

void Api::refreshFlags()
{
    if (m_active >= 0)
        learnProfile(m_profiles.at(m_active).userId);
}

void Api::unlockProfile(const QString &userId, const QString &pin, const QJSValue &cb)
{
    int idx = -1;
    for (int i = 0; i < m_profiles.size(); ++i)
        if (m_profiles.at(i).userId == userId)
            idx = i;
    Req r;
    r.cb = cb;
    if (idx < 0) {
        finish(r, 404, QVariant());
        return;
    }
    const Profile p = m_profiles.at(idx);
    QJsonObject body;
    body[QStringLiteral("device_id")] = p.deviceId;
    body[QStringLiteral("refresh_token")] = p.refresh;
    body[QStringLiteral("pin")] = pin;
    QNetworkReply *reply = post(QUrl(Util::joinUrl(p.server, QStringLiteral("/api/v1/auth/unlock"))), body);
    connect(reply, &QNetworkReply::finished, this, [this, reply, r, userId]() {
        reply->deleteLater();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = toObject(reply->readAll());
        QVariantMap out;
        out[QStringLiteral("retryAfter")] = o.value(QStringLiteral("retry_after_seconds")).toInt();
        if (status == 200) {
            for (int i = 0; i < m_profiles.size(); ++i) {
                if (m_profiles.at(i).userId != userId)
                    continue;
                Profile &q = m_profiles[i];
                q.access = o.value(QStringLiteral("access_token")).toString();
                q.refresh = o.value(QStringLiteral("refresh_token")).toString();
                q.expiresAt = QDateTime::currentMSecsSinceEpoch() + qint64(o.value(QStringLiteral("expires_in")).toDouble(3600) * 1000);
                m_active = i;
            }
            save();
            emit sessionChanged();
        }
        finish(r, status, out);
    });
}

void Api::signOut() { removeProfile(profileId()); }

// Name and avatar of the freshly linked profile.
void Api::learnProfile(const QString &userId)
{
    // Direct requests (not QML callbacks) so the data lands in the profile record.
    QNetworkRequest req = baseRequest(QUrl(url(QStringLiteral("/api/v1/users/profiles"))));
    req.setRawHeader("Authorization", "Bearer " + m_profiles.at(m_active).access.toUtf8());
    QNetworkReply *reply = m_nam.get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply, userId]() {
        reply->deleteLater();
        const QJsonArray arr = QJsonDocument::fromJson(reply->readAll()).array();
        for (const QJsonValue &v : arr) {
            const QJsonObject o = v.toObject();
            for (Profile &p : m_profiles) {
                if (p.userId != o.value(QStringLiteral("id")).toString())
                    continue;
                p.pinLocked = o.value(QStringLiteral("pin_locked")).toBool();
                if (o.value(QStringLiteral("is_current")).toBool() || p.name.isEmpty())
                    p.name = o.value(QStringLiteral("display_name")).toString(o.value(QStringLiteral("username")).toString());
            }
        }
        save();
        emit sessionChanged();
    });
    QNetworkRequest areq = baseRequest(QUrl(url(QStringLiteral("/api/v1/users/me/profile-avatar"))));
    areq.setRawHeader("Authorization", "Bearer " + m_profiles.at(m_active).access.toUtf8());
    QNetworkReply *ar = m_nam.get(areq);
    connect(ar, &QNetworkReply::finished, this, [this, ar, userId]() {
        ar->deleteLater();
        const QJsonObject pref = toObject(ar->readAll()).value(QStringLiteral("preference")).toObject();
        if (pref.isEmpty())
            return;
        for (Profile &p : m_profiles)
            if (p.userId == userId)
                p.avatar = pref.value(QStringLiteral("value")).toString();
        save();
        emit sessionChanged();
    });
}

// ---- hosted device link (QR) -------------------------------------------------
// Flow: broker code -> user approves on another device -> broker returns the server + a server device code ->
// poll the server token endpoint. Codes renew silently; the user never types a server address.

void Api::linkSetState(const QString &s)
{
    if (m_linkState == s)
        return;
    m_linkState = s;
    emit linkChanged();
}

void Api::startLink()
{
    cancelLink();
    linkRequestCode();
}

void Api::cancelLink()
{
    ++m_linkGen;
    m_linkTimer.stop();
    linkSetState(QStringLiteral("idle"));
}

void Api::linkRequestCode()
{
    const int gen = ++m_linkGen;
    linkSetState(QStringLiteral("requesting"));
    QJsonObject body;
    body[QStringLiteral("client_platform")] = QString::fromLatin1(kPlatform);
    QNetworkReply *reply = post(QUrl(QString::fromLatin1(kHosted) + QStringLiteral("/api/link/code")), body);
    connect(reply, &QNetworkReply::finished, this, [this, reply, gen]() {
        reply->deleteLater();
        if (gen != m_linkGen)
            return;
        const QJsonObject o = toObject(reply->readAll());
        if (reply->error() != QNetworkReply::NoError || !o.contains(QStringLiteral("device_code"))) {
            m_linkTimer.start(5000); // transient: try again, no error screen
            m_linkError = QStringLiteral("retry");
            return;
        }
        m_linkDevice = o.value(QStringLiteral("device_code")).toString();
        m_linkCode = o.value(QStringLiteral("user_code")).toString();
        m_linkUrl = o.value(QStringLiteral("verification_uri_complete")).toString();
        m_linkQr = QString::fromLatin1(kHosted) + QStringLiteral("/api/link/qr?value=")
            + QString::fromLatin1(QUrl::toPercentEncoding(m_linkUrl));
        m_linkInterval = qMax(2, o.value(QStringLiteral("interval")).toInt(2));
        m_linkExpires = QDateTime::currentMSecsSinceEpoch() + qint64(o.value(QStringLiteral("expires_in")).toInt(300)) * 1000;
        m_linkServers.clear();
        m_linkError.clear();
        linkSetState(QStringLiteral("waiting"));
        m_linkTimer.start(m_linkInterval * 1000);
    });
}

void Api::linkStep()
{
    if (m_linkState == QLatin1String("requesting") && m_linkError == QLatin1String("retry"))
        linkRequestCode();
    else if (QDateTime::currentMSecsSinceEpoch() > m_linkExpires)
        linkRequestCode(); // expired: silently show a fresh code
    else if (m_linkState == QLatin1String("waiting"))
        linkPollHosted();
    else if (m_linkState == QLatin1String("approved"))
        linkPollServer();
}

void Api::linkPollHosted()
{
    const int gen = m_linkGen;
    QNetworkRequest req = baseRequest(QUrl(QString::fromLatin1(kHosted) + QStringLiteral("/api/link/code/")
                                           + QString::fromLatin1(QUrl::toPercentEncoding(m_linkDevice))));
    QNetworkReply *reply = m_nam.get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply, gen]() {
        reply->deleteLater();
        if (gen != m_linkGen)
            return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status == 200) {
            const QJsonObject o = toObject(reply->readAll());
            m_linkServers.clear();
            m_linkServers << o.value(QStringLiteral("server_url")).toString();
            for (const QJsonValue &v : o.value(QStringLiteral("server_urls")).toArray())
                if (!m_linkServers.contains(v.toString()))
                    m_linkServers << v.toString();
            m_linkServerCode = o.value(QStringLiteral("server_device_code")).toString();
            m_linkServerIdx = 0;
            m_linkExpires = QDateTime::currentMSecsSinceEpoch() + 5 * 60 * 1000;
            linkSetState(QStringLiteral("approved"));
            m_linkTimer.start(1000);
        } else if (status == 404) {
            linkRequestCode();
        } else {
            m_linkTimer.start(m_linkInterval * 1000); // 202 pending or a network blip
        }
    });
}

void Api::linkPollServer()
{
    const int gen = m_linkGen;
    const QString server = m_linkServers.value(m_linkServerIdx);
    QJsonObject body;
    body[QStringLiteral("grant_type")] = QString::fromLatin1(kGrant);
    body[QStringLiteral("device_code")] = m_linkServerCode;
    QNetworkReply *reply = post(QUrl(Util::joinUrl(server, QStringLiteral("/api/v1/oauth/token"))), body);
    connect(reply, &QNetworkReply::finished, this, [this, reply, gen, server]() {
        reply->deleteLater();
        if (gen != m_linkGen)
            return;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = toObject(reply->readAll());
        if (status == 200 && o.contains(QStringLiteral("access_token"))) {
            linkAdopt(o, server);
            return;
        }
        const QString err = o.value(QStringLiteral("error")).toString();
        if (status == 0) { // unreachable address: try the next one the broker listed
            m_linkServerIdx = (m_linkServerIdx + 1) % qMax(1, m_linkServers.size());
        } else if (err == QLatin1String("access_denied")) {
            linkSetState(QStringLiteral("denied"));
            return;
        } else if (err == QLatin1String("expired_token")) {
            linkRequestCode();
            return;
        } else if (err == QLatin1String("slow_down")) {
            m_linkTimer.start(6000);
            return;
        }
        m_linkTimer.start(1000);
    });
}

void Api::linkAdopt(const QJsonObject &o, const QString &server)
{
    Profile p;
    p.access = o.value(QStringLiteral("access_token")).toString();
    p.refresh = o.value(QStringLiteral("refresh_token")).toString();
    p.userId = Util::jwtClaim(p.access, QStringLiteral("sub"));
    p.deviceId = Util::jwtClaim(p.access, QStringLiteral("device_id"));
    p.server = server;
    p.expiresAt = QDateTime::currentMSecsSinceEpoch() + qint64(o.value(QStringLiteral("expires_in")).toDouble(3600) * 1000);
    if (p.userId.isEmpty() || p.deviceId.isEmpty()) {
        linkRequestCode();
        return;
    }
    for (int i = 0; i < m_profiles.size(); ++i)
        if (m_profiles.at(i).userId == p.userId && m_profiles.at(i).server == p.server)
            m_profiles.removeAt(i--);
    m_profiles.append(p);
    m_active = m_profiles.size() - 1;
    save();
    ++m_linkGen;
    linkSetState(QStringLiteral("idle"));
    emit sessionChanged();
    learnProfile(p.userId);
    emit linkFinished();
}
