// Pure download helpers, unit-tested in tests/tst_util.cpp.
#pragma once
#include <QByteArray>
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

} // namespace DownloadLogic
