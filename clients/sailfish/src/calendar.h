#pragma once
#include <QDateTime>
#include <QObject>
#include "calendarlogic.h"

// QML face of CalendarLogic.
class Calendar : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;
    // The real date, or the date of PLAYARR_PARITY_CLOCK (ISO instant) so parity captures show the fixture's "today".
    static QDate today()
    {
        const QDateTime pinned = QDateTime::fromString(qEnvironmentVariable("PLAYARR_PARITY_CLOCK"), Qt::ISODate);
        return pinned.isValid() ? pinned.toLocalTime().date() : QDate::currentDate();
    }
    Q_INVOKABLE QString todayIso() const { return today().toString(Qt::ISODate); }
    Q_INVOKABLE QVariantMap rangeFor(const QString &mode, int page) const { return CalendarLogic::rangeFor(mode, page, today(), QLocale()); }
    Q_INVOKABLE QVariantList weeks(const QString &s, const QString &e) const { return CalendarLogic::weeks(s, e); }
    Q_INVOKABLE QString pageStart(int page, int days) const { return CalendarLogic::pageStart(today(), page, days); }
    Q_INVOKABLE QString pageEnd(int page, int days) const { return CalendarLogic::pageEnd(today(), page, days); }
    Q_INVOKABLE QString dayHeading(const QString &iso) const { return CalendarLogic::dayHeading(iso, QLocale()); }
    Q_INVOKABLE QVariantList groupByDate(const QVariantList &e) const { return CalendarLogic::groupByDate(e); }
    Q_INVOKABLE QString episodeCode(const QVariantMap &e) const { return CalendarLogic::episodeCode(e); }
};
