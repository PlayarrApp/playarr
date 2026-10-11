// Pure download helpers, unit-tested in tests/tst_util.cpp.
#pragma once
#include <QByteArray>
#include <QDateTime>
#include <QRegularExpression>
#include <QString>

namespace DownloadLogic {

// "<title> [<ticket id prefix>].<ext>" with anything outside word characters, space, dot, brackets and dash replaced.
inline QString safeName(const QString &title, const QString &ticketId, const QString &container)
{
    QString t = title;
    t.replace(QRegularExpression(QStringLiteral("[^\\w .()-]")), QStringLiteral("_"));
    t = t.simplified().left(80);
    if (t.isEmpty())
        t = QStringLiteral("download");
    const QString ext = container.toLower().remove(QRegularExpression(QStringLiteral("[^a-z0-9]")));
    return t + QStringLiteral(" [") + ticketId.left(8) + QStringLiteral("].") + (ext.isEmpty() ? QStringLiteral("bin") : ext);
}

// Range header value that resumes after `received` bytes; empty from the start.
inline QByteArray resumeRange(qint64 received) { return received > 0 ? "bytes=" + QByteArray::number(received) + "-" : QByteArray(); }

// Keep-until policy (web: downloadsDb.ts DownloadKeepUntilPolicy): {type: forever} | {type: date, date: ISO} |
// {type: after-watched, amount, unit: days|weeks}. True when the local copy should now be deleted. `watchedAtMs` is the
// first moment the title was seen as watched (0 = not watched yet).
inline bool keepExpired(const QString &type, const QString &dateIso, int amount, const QString &unit, qint64 watchedAtMs, qint64 nowMs)
{
    if (type == QLatin1String("date")) {
        const QDateTime d = QDateTime::fromString(dateIso.left(10), Qt::ISODate);
        return d.isValid() && nowMs >= d.addDays(1).toMSecsSinceEpoch(); // through the end of that day
    }
    if (type == QLatin1String("after-watched")) {
        if (watchedAtMs <= 0)
            return false;
        const qint64 days = qint64(qMax(1, amount)) * (unit == QLatin1String("weeks") ? 7 : 1);
        return nowMs >= watchedAtMs + days * 86400000LL;
    }
    return false;
}

} // namespace DownloadLogic
