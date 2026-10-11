#pragma once
#include <QDBusAbstractAdaptor>
#include "downloads.h"

// Session-bus face of Downloads for the notification's Pause, Resume and Cancel actions (Nemo remote actions call it).
class DownloadsAdaptor : public QDBusAbstractAdaptor
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "com.playarr.Downloads")
public:
    explicit DownloadsAdaptor(Downloads *d) : QDBusAbstractAdaptor(d), m_d(d) {}
public slots:
    void pause(const QString &ticketId) { m_d->pause(ticketId); }
    void resume(const QString &ticketId) { m_d->resume(ticketId); }
    // Cancel keeps the ticket on the server like the Downloads tab's remove does for the local copy only.
    void cancel(const QString &ticketId) { m_d->remove(ticketId); }
private:
    Downloads *m_d;
};
