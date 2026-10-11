#pragma once
#include <QObject>
#include "calendarlogic.h"

// QML face of CalendarLogic.
class Calendar : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;
    Q_INVOKABLE QVariantMap rangeFor(const QString &mode, int page) const { return CalendarLogic::rangeFor(mode, page, QDate::currentDate(), QLocale()); }
    Q_INVOKABLE QVariantList weeks(const QString &s, const QString &e) const { return CalendarLogic::weeks(s, e); }
    Q_INVOKABLE QString pageStart(int page, int days) const { return CalendarLogic::pageStart(QDate::currentDate(), page, days); }
    Q_INVOKABLE QString pageEnd(int page, int days) const { return CalendarLogic::pageEnd(QDate::currentDate(), page, days); }
    Q_INVOKABLE QString dayHeading(const QString &iso) const { return CalendarLogic::dayHeading(iso, QLocale()); }
    Q_INVOKABLE QVariantList groupByDate(const QVariantList &e) const { return CalendarLogic::groupByDate(e); }
    Q_INVOKABLE QString episodeCode(const QVariantMap &e) const { return CalendarLogic::episodeCode(e); }
};
