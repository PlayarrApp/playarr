#pragma once
#include <QFile>
#include <QHash>
#include <QObject>
#include <QSettings>
#include <QVariantList>

class Api;
class QNetworkReply;

// Offline copies of ready download tickets (GET /api/v1/downloads/{id}/file) in ~/Videos/Playarr, resumable.
class Downloads : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantList items READ items NOTIFY changed)
public:
    explicit Downloads(Api *api, QObject *parent = nullptr);
    // [{ticketId, title, container, path, size, received, state}], state: downloading|paused|done|failed
    QVariantList items() const;
    // Starts or resumes the file download of a ready ticket.
    Q_INVOKABLE void fetch(const QString &ticketId, const QString &title, const QString &container, double size);
    Q_INVOKABLE void pause(const QString &ticketId);
    Q_INVOKABLE void remove(const QString &ticketId);
    Q_INVOKABLE QString pathOf(const QString &ticketId) const;

signals:
    void changed();

private:
    struct Item {
        QString ticketId, title, container, path, state;
        qint64 size = 0, received = 0;
        QNetworkReply *reply = nullptr;
        QFile *file = nullptr;
        int retries = 0;
    };
    void start(Item &it);
    void finishedReply(const QString &id);
    void save();
    void load();

    Api *m_api;
    QSettings m_settings;
    QList<Item> m_items;
};
