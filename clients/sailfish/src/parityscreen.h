#pragma once
#include <QObject>
#include <QImage>
#include <QQuickItem>
#include <QQuickView>
#include <QRect>
#include <cstring>

// Parity debug hook (layout export only, reached from a PLAYARR_STEPS `js:layoutDump()` step): decides from the rendered window whether an
// item is covered. snapshot() renders the window; hide() sets an item's opacity to 0 through the C++ setter (so no QML binding is removed
// and no Behavior runs); changed() renders again and says whether any pixel of the scene rectangle differs from the snapshot.
class ParityScreen : public QObject
{
    Q_OBJECT
public:
    explicit ParityScreen(QQuickView *view, QObject *parent = nullptr) : QObject(parent), m_view(view) {}

    Q_INVOKABLE void snapshot() { m_base = m_view->grabWindow(); }
    Q_INVOKABLE double hide(QObject *object)
    {
        auto *item = qobject_cast<QQuickItem *>(object);
        if (!item) return 1;
        const double previous = item->opacity();
        item->setOpacity(0);
        return previous;
    }
    Q_INVOKABLE void restore(QObject *object, double previous)
    {
        if (auto *item = qobject_cast<QQuickItem *>(object)) item->setOpacity(previous);
    }
    Q_INVOKABLE bool changed(int x, int y, int w, int h)
    {
        const QImage now = m_view->grabWindow();
        if (now.size() != m_base.size() || now.format() != m_base.format()) return true;
        const QRect box = QRect(x, y, w, h).intersected(now.rect());
        const int bytes = box.width() * now.depth() / 8;
        for (int row = box.top(); row <= box.bottom(); ++row)
            if (std::memcmp(now.constScanLine(row) + box.left() * now.depth() / 8, m_base.constScanLine(row) + box.left() * m_base.depth() / 8, bytes) != 0) return true;
        return false;
    }

private:
    QQuickView *m_view;
    QImage m_base;
};
