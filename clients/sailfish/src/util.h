// Pure helpers (no network, no QML), unit-tested in tests/tst_util.cpp.
#pragma once
#include <QByteArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>
#include <QUrl>

namespace Util {

// Claim from a JWT payload; empty when the token is malformed.
inline QString jwtClaim(const QString &jwt, const QString &key)
{
    const QStringList parts = jwt.split(QLatin1Char('.'));
    if (parts.size() != 3)
        return QString();
    const QByteArray raw = QByteArray::fromBase64(parts.at(1).toLatin1(),
                                                  QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals);
    const QJsonDocument doc = QJsonDocument::fromJson(raw);
    return doc.isObject() ? doc.object().value(key).toString() : QString();
}

// Deterministic default avatar; matches clients/tv-web profileAvatar.ts (hash * 31 + unit, mod 6).
inline QString defaultAvatarPreset(const QString &userId)
{
    static const char *const ids[] = {"astronaut", "cat", "dinosaur", "robot", "pirate", "alien"};
    quint32 hash = 0;
    for (const QChar c : userId)
        hash = hash * 31u + c.unicode();
    return QString::fromLatin1(ids[hash % 6]);
}

// "https://host:8484" + "/api/x"; tolerates a trailing slash on the base. Empty for a non-http(s) base.
inline QString joinUrl(const QString &base, const QString &path)
{
    const QUrl u(base);
    if (u.scheme() != QLatin1String("http") && u.scheme() != QLatin1String("https"))
        return QString();
    QString b = base;
    while (b.endsWith(QLatin1Char('/')))
        b.chop(1);
    return b + path;
}

// scheme://host:port, used to decide where a bearer token may be sent.
inline QString originOf(const QUrl &url)
{
    return url.scheme() + QLatin1String("://") + url.authority();
}

// Width the web asks the artwork endpoint for by kind (clients/tv-web lib/artwork.tsx defaultArtworkWidth); `hero`
// is the full-width backdrop (1280). The server snaps these up to its own set.
inline int artworkWidth(const QString &kind, bool hero)
{
    if (kind == QLatin1String("poster")) return 360;
    if (kind == QLatin1String("backdrop")) return hero ? 1280 : 780;
    if (kind == QLatin1String("banner")) return 780;
    return 540; // thumb, logo, anything else
}

// Same token the web derives from the artwork source URL (FNV-1a over UTF-16 units, 8 hex digits).
inline QString artworkVersion(const QString &sourceUrl)
{
    quint32 h = 0x811c9dc5u;
    for (const QChar c : sourceUrl) {
        h ^= c.unicode();
        h *= 0x01000193u;
    }
    return QStringLiteral("%1").arg(h, 8, 16, QLatin1Char('0'));
}

} // namespace Util
