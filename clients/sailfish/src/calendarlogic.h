// Calendar agenda helpers, unit-tested in tests/tst_util.cpp.
#pragma once
#include <QDate>
#include <QLocale>
#include <QVariantList>
#include <QVariantMap>
#include <algorithm>

namespace CalendarLogic {

// First day of agenda page `page` (0 = the page that starts today), pages are `days` long; ISO yyyy-MM-dd.
inline QString pageStart(const QDate &today, int page, int days) { return today.addDays(page * days).toString(Qt::ISODate); }
inline QString pageEnd(const QDate &today, int page, int days) { return today.addDays(page * days + days - 1).toString(Qt::ISODate); }

// "Saturday 10 October" in the given locale; the input is returned unchanged when it is not a date.
inline QString dayHeading(const QString &iso, const QLocale &locale)
{
    const QDate d = QDate::fromString(iso, Qt::ISODate);
    return d.isValid() ? locale.toString(d, QStringLiteral("dddd d MMMM")) : iso;
}

// Entries grouped by `date`, days ascending; within a day by release_at then title. [{date, entries:[...]}]
inline QVariantList groupByDate(const QVariantList &entries)
{
    QVariantList sorted = entries;
    std::stable_sort(sorted.begin(), sorted.end(), [](const QVariant &a, const QVariant &b) {
        const QVariantMap x = a.toMap(), y = b.toMap();
        const QString dx = x.value(QStringLiteral("date")).toString(), dy = y.value(QStringLiteral("date")).toString();
        if (dx != dy) return dx < dy;
        const QString rx = x.value(QStringLiteral("release_at")).toString(), ry = y.value(QStringLiteral("release_at")).toString();
        if (rx != ry) return rx < ry;
        return x.value(QStringLiteral("title")).toString() < y.value(QStringLiteral("title")).toString();
    });
    QVariantList days;
    QString cur;
    QVariantList bucket;
    auto flush = [&]() {
        if (cur.isEmpty()) return;
        QVariantMap m;
        m[QStringLiteral("date")] = cur;
        m[QStringLiteral("entries")] = bucket;
        days.append(m);
    };
    for (const QVariant &v : sorted) {
        const QString d = v.toMap().value(QStringLiteral("date")).toString();
        if (d != cur) { flush(); cur = d; bucket.clear(); }
        bucket.append(v);
    }
    flush();
    return days;
}

// "S03E03" for an episode entry, else empty.
inline QString episodeCode(const QVariantMap &e)
{
    if (e.value(QStringLiteral("season_number")).isNull() || e.value(QStringLiteral("episode_number")).isNull())
        return QString();
    return QStringLiteral("S%1E%2").arg(e.value(QStringLiteral("season_number")).toInt(), 2, 10, QLatin1Char('0'))
        .arg(e.value(QStringLiteral("episode_number")).toInt(), 2, 10, QLatin1Char('0'));
}

} // namespace CalendarLogic
