//! Line icons copied from the web client's nav icon set (clients/tv-web/web/src/components/NavIcons.tsx and
//! shell/icons.tsx): 24 px viewBox, 1.8 stroke, rendered from SVG at the size and colour asked for, and
//! re-coloured when the theme flips.
use gtk4::prelude::*;
use gtk4::{gdk, gdk_pixbuf, gio, glib};
use libadwaita as adw;
use std::cell::RefCell;

/// Inner SVG markup per icon name.
pub fn markup(name: &str) -> &'static str {
    match name {
        "home" => r#"<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-6h4v6"/>"#,
        "search" => r#"<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>"#,
        "search-minus" => r#"<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/><path d="M8 10.5h5"/>"#,
        "movies" => {
            r#"<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 5 2-3M13 5l2-3M19 5l2-3"/><path d="m10 10 5 2.5-5 2.5z" fill="currentColor" stroke="none"/>"#
        }
        "series" => {
            r#"<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/><path d="m10 1 2 3 2-3"/>"#
        }
        "music" => {
            r#"<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M9 10l10-2"/>"#
        }
        "downloads" => {
            r#"<path d="M12 3v12"/><path d="m7 10.5 5 4.5 5-4.5"/><path d="M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5"/>"#
        }
        "playlists" => {
            r#"<path d="M5 6h10M5 10h10M5 14h6"/><path d="M17 13.5v6"/><path d="m17 13.5 4-1.5v5.5"/><circle cx="15.5" cy="19.5" r="1.5"/><circle cx="19.5" cy="17.5" r="1.5"/>"#
        }
        "watchlist" => {
            r#"<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"/><path d="M12 7.5v5M9.5 10h5"/>"#
        }
        "requests" => r#"<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M10.5 17.5h3"/>"#,
        "calendar" => r#"<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>"#,
        "filters" => {
            r#"<path d="M4 6h16M7 12h10m-7 6h4"/><circle cx="8" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/>"#
        }
        "bell" => r#"<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0"/>"#,
        "add" => r#"<path d="M12 5v14M5 12h14"/>"#,
        "settings" => {
            r#"<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>"#
        }
        "back" => r#"<path d="M19 12H5M11 6l-6 6 6 6"/>"#,
        "logout" => r#"<path d="M10 5H5v14h5"/><path d="M13 8l4 4-4 4M8 12h9"/>"#,
        "sun" => {
            r#"<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>"#
        }
        "moon" => r#"<path d="M20.25 15.35A8.5 8.5 0 0 1 8.65 3.75 8.5 8.5 0 1 0 20.25 15.35Z"/>"#,
        "globe" => {
            r#"<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"/>"#
        }
        "chevron" => r#"<path d="m6 9 6 6 6-6"/>"#,
        "play" => r#"<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>"#,
        "check" => r#"<path d="m5 12.5 4.5 4.5L19 7.5"/>"#,
        "close" => r#"<path d="M6 6l12 12M18 6 6 18"/>"#,
        "list" => r#"<path d="M5 7h14M5 12h14M5 17h14"/>"#,
        _ => r#"<circle cx="12" cy="12" r="8"/>"#,
    }
}

pub fn svg(name: &str, color: &str) -> String {
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{}</svg>"#,
        markup(name).replace("currentColor", color)
    )
}

pub fn texture(name: &str, color: &str, px: i32) -> Option<gdk::Texture> {
    let bytes = glib::Bytes::from_owned(svg(name, color).into_bytes());
    let stream = gio::MemoryInputStream::from_bytes(&bytes);
    let pb = gdk_pixbuf::Pixbuf::from_stream_at_scale(&stream, px * 2, px * 2, true, gio::Cancellable::NONE).ok()?;
    Some(gdk::Texture::for_pixbuf(&pb))
}

/// The brand mark (the web's playarr-icon.svg), drawn at `px` css pixels.
pub fn brand_mark(px: i32) -> gtk4::Image {
    let bytes = glib::Bytes::from_static(include_bytes!("../data/playarr-mark.svg"));
    let stream = gio::MemoryInputStream::from_bytes(&bytes);
    let img = gtk4::Image::builder().pixel_size(px).build();
    if let Ok(pb) = gdk_pixbuf::Pixbuf::from_stream_at_scale(&stream, px * 2, px * 2, true, gio::Cancellable::NONE) {
        img.set_paintable(Some(&gdk::Texture::for_pixbuf(&pb)));
    }
    img
}

/// Which colour an icon takes; resolved against the current theme.
#[derive(Clone, Copy, PartialEq)]
pub enum Tone {
    /// Idle nav and header icons.
    Soft,
    /// Body ink.
    Ink,
    /// On the active (filled) nav tile.
    OnAccent,
    /// Brand tint.
    Brand,
    /// Always white (on the black player stage).
    White,
}

pub fn color(tone: Tone) -> &'static str {
    if tone == Tone::White {
        return "#ffffff";
    }
    let dark = adw::StyleManager::default().is_dark();
    match (tone, dark) {
        (Tone::Soft, true) => "#cdc1c6",
        (Tone::Soft, false) => "#443a40",
        (Tone::Ink, true) => "#f4f0f1",
        (Tone::Ink, false) => "#382621",
        (Tone::OnAccent, true) => "#211d21",
        (Tone::OnAccent, false) => "#ffffff",
        (Tone::Brand, true) => "#eaa6b6",
        (Tone::Brand, false) => "#821e36",
        (Tone::White, _) => "#ffffff",
    }
}

type Registered = (glib::WeakRef<gtk4::Image>, String, i32, Tone);

thread_local! {
    static REGISTRY: RefCell<Vec<Registered>> = const { RefCell::new(Vec::new()) };
}

/// An icon image that follows the theme; `set_tone` swaps its role (for example the active nav tile).
pub fn image(name: &str, px: i32, tone: Tone) -> gtk4::Image {
    let img = gtk4::Image::builder().pixel_size(px).build();
    img.set_paintable(texture(name, color(tone), px).as_ref());
    REGISTRY.with(|r| r.borrow_mut().push((img.downgrade(), name.to_string(), px, tone)));
    img
}

pub fn set_tone(img: &gtk4::Image, tone: Tone) {
    REGISTRY.with(|r| {
        for (w, name, px, t) in r.borrow_mut().iter_mut() {
            if w.upgrade().as_ref() == Some(img) {
                *t = tone;
                img.set_paintable(texture(name, color(tone), *px).as_ref());
            }
        }
    });
}

/// Re-colours every registered icon; call when the theme flips.
pub fn refresh() {
    REGISTRY.with(|r| {
        r.borrow_mut().retain(|(w, ..)| w.upgrade().is_some());
        for (w, name, px, tone) in r.borrow().iter() {
            if let Some(img) = w.upgrade() {
                img.set_paintable(texture(name, color(*tone), *px).as_ref());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn svg_is_wellformed_and_recoloured() {
        let s = super::svg("movies", "#112233");
        assert!(s.starts_with("<svg") && s.ends_with("</svg>"));
        assert!(s.contains("fill=\"#112233\""), "currentColor replaced");
        assert!(!s.contains("currentColor"));
    }

    #[test]
    fn every_icon_has_markup() {
        for n in [
            "home",
            "search",
            "search-minus",
            "movies",
            "series",
            "music",
            "downloads",
            "playlists",
            "watchlist",
            "requests",
            "calendar",
            "filters",
            "back",
        ] {
            assert!(super::markup(n).contains('<'), "{n}");
        }
    }
}
