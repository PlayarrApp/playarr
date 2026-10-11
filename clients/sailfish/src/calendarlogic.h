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

inline QDate mondayOf(const QDate &d) { return d.addDays(1 - d.dayOfWeek()); }

// Fetch window and header label of calendar page `page` for mode "agenda" (30 days from today), "week" (Monday to
// Sunday) or "month" (the weeks that cover the month). {start, end, label}
inline QVariantMap rangeFor(const QString &mode, int page, const QDate &today, const QLocale &loc)
{
    QDate a, b;
    QString label;
    if (mode == QLatin1String("month")) {
        const QDate first = QDate(today.year(), today.month(), 1).addMonths(page);
        a = mondayOf(first);
        b = mondayOf(first.addMonths(1).addDays(-1)).addDays(6);
        label = loc.toString(first, QStringLiteral("MMM yyyy"));
    } else if (mode == QLatin1String("week")) {
        a = mondayOf(today).addDays(page * 7);
        b = a.addDays(6);
        label = a.month() == b.month() ? QStringLiteral("%1 \u2013 %2").arg(a.day()).arg(loc.toString(b, QStringLiteral("d MMM")))
                                       : loc.toString(a, QStringLiteral("d MMM")) + QStringLiteral(" \u2013 ") + loc.toString(b, QStringLiteral("d MMM"));
    } else {
        a = today.addDays(page * 30);
        b = a.addDays(29);
        label = loc.toString(a, QStringLiteral("d MMM")) + QStringLiteral(" \u2013 ") + loc.toString(b, QStringLiteral("d MMM"));
    }
    QVariantMap m;
    m[QStringLiteral("start")] = a.toString(Qt::ISODate);
    m[QStringLiteral("end")] = b.toString(Qt::ISODate);
    m[QStringLiteral("label")] = label;
    m[QStringLiteral("month")] = mode == QLatin1String("month") ? QDate(today.year(), today.month(), 1).addMonths(page).month() : 0;
    return m;
}

// Month grid rows (Monday first) for the window [start, end]: [[{date, day, month}] x 7] per week.
inline QVariantList weeks(const QString &startIso, const QString &endIso)
{
    QVariantList rows;
    QDate d = QDate::fromString(startIso, Qt::ISODate);
    const QDate end = QDate::fromString(endIso, Qt::ISODate);
    while (d.isValid() && d <= end && rows.size() < 7) {
        QVariantList row;
        for (int i = 0; i < 7; ++i, d = d.addDays(1)) {
            QVariantMap c;
            c[QStringLiteral("date")] = d.toString(Qt::ISODate);
            c[QStringLiteral("day")] = d.day();
            c[QStringLiteral("month")] = d.month();
            row.append(c);
        }
        rows.append(QVariant(row));
    }
    return rows;
}

} // namespace CalendarLogic
