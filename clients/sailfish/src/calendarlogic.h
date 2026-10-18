// Calendar agenda helpers, unit-tested in tests/tst_util.cpp.
#pragma once
#include <QDate>
#include <QDateTime>
#include <QList>
#include <QMap>
#include <QPair>
#include <QStringList>
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

// Web's compact episode label for one day's episodes of a series: contiguous runs "S02E04\u2013E06", gaps "S02E01, E03", seasons joined by commas.
inline QString episodeCodes(const QVariantList &members)
{
    QMap<int, QList<int>> bySeason;
    for (const QVariant &v : members) {
        const QVariantMap m = v.toMap();
        if (m.value(QStringLiteral("season_number")).isNull() || m.value(QStringLiteral("episode_number")).isNull()) continue;
        QList<int> &l = bySeason[m.value(QStringLiteral("season_number")).toInt()];
        const int ep = m.value(QStringLiteral("episode_number")).toInt();
        if (!l.contains(ep)) l.append(ep);
    }
    QStringList parts;
    for (auto it = bySeason.begin(); it != bySeason.end(); ++it) {
        QList<int> eps = it.value();
        std::sort(eps.begin(), eps.end());
        QList<QPair<int, int>> runs;
        for (int ep : eps) {
            if (!runs.isEmpty() && ep == runs.last().second + 1) runs.last().second = ep;
            else runs.append({ep, ep});
        }
        for (int i = 0; i < runs.size(); ++i) {
            const QString pre = i == 0 ? QStringLiteral("S%1").arg(it.key(), 2, 10, QLatin1Char('0')) : QString();
            const QString a = QStringLiteral("E%1").arg(runs[i].first, 2, 10, QLatin1Char('0'));
            parts << pre + a + (runs[i].first == runs[i].second ? QString() : QStringLiteral("\u2013E%1").arg(runs[i].second, 2, 10, QLatin1Char('0')));
        }
    }
    return parts.join(QStringLiteral(", "));
}

// Web groups episodes of one series released the same day at the same air time into one card ("2 episodes \u00b7 S01E01\u2013E02").
// The group keeps its first member's fields plus members, group_count and group_codes; has_file holds when every member has one.
inline QVariantList groupEpisodes(const QVariantList &dayEntries)
{
    auto slot = [](const QVariantMap &m) {
        const QString r = m.value(QStringLiteral("release_at")).toString();
        return r.isEmpty() || r.contains(QStringLiteral("T00:00:00")) ? QStringLiteral("all-day") : QDateTime::fromString(r, Qt::ISODate).toLocalTime().toString(QStringLiteral("hh:mm"));
    };
    QStringList order;
    QMap<QString, QVariantList> buckets;
    for (const QVariant &v : dayEntries) {
        const QVariantMap m = v.toMap();
        const bool episode = m.value(QStringLiteral("media_kind")).toString() == QLatin1String("episode")
            && !m.value(QStringLiteral("season_number")).isNull() && !m.value(QStringLiteral("episode_number")).isNull();
        const QString key = episode ? QStringLiteral("series:") + (m.value(QStringLiteral("work_id")).toString().isEmpty() ? m.value(QStringLiteral("title")).toString() : m.value(QStringLiteral("work_id")).toString()) + QLatin1Char(':') + slot(m)
                                    : QStringLiteral("single:") + QString::number(order.size());
        if (!buckets.contains(key)) order << key;
        buckets[key].append(v);
    }
    QVariantList out;
    for (const QString &key : order) {
        QVariantList members = buckets.value(key);
        if (members.size() == 1) { out.append(members.first()); continue; }
        std::stable_sort(members.begin(), members.end(), [](const QVariant &a, const QVariant &b) {
            const QVariantMap x = a.toMap(), y = b.toMap();
            const int sx = x.value(QStringLiteral("season_number")).toInt(), sy = y.value(QStringLiteral("season_number")).toInt();
            return sx != sy ? sx < sy : x.value(QStringLiteral("episode_number")).toInt() < y.value(QStringLiteral("episode_number")).toInt();
        });
        QVariantMap g = members.first().toMap();
        bool all = true;
        for (const QVariant &v : members) all = all && v.toMap().value(QStringLiteral("has_file")).toBool();
        g[QStringLiteral("has_file")] = all;
        g[QStringLiteral("members")] = members;
        g[QStringLiteral("group_count")] = members.size();
        g[QStringLiteral("group_codes")] = episodeCodes(members);
        out.append(g);
    }
    return out;
}

// Entries grouped by `date`, days ascending; within a day by release time then title. A midnight UTC release is a date-only
// one ("All day" on web), so it sorts with the entries that have no time. [{date, entries:[...]}]
inline QVariantList groupByDate(const QVariantList &entries)
{
    QVariantList sorted = entries;
    std::stable_sort(sorted.begin(), sorted.end(), [](const QVariant &a, const QVariant &b) {
        const QVariantMap x = a.toMap(), y = b.toMap();
        const QString dx = x.value(QStringLiteral("date")).toString(), dy = y.value(QStringLiteral("date")).toString();
        if (dx != dy) return dx < dy;
        auto at = [](const QVariantMap &m) {
            const QString r = m.value(QStringLiteral("release_at")).toString();
            return r.contains(QStringLiteral("T00:00:00")) ? QString() : r;
        };
        const QString rx = at(x), ry = at(y);
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
        m[QStringLiteral("entries")] = groupEpisodes(bucket);
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
