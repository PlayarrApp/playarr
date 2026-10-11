//! Offline QR rendering with the pairing tile look (white plate, black modules, 2-module quiet zone).
use gtk4::{gdk, glib};
use qrcode::{Color, QrCode};

/// RGBA pixels of the QR (quiet zone included) at `scale` pixels per module, plus the side length in pixels.
pub fn render_rgba(data: &str, scale: usize) -> Option<(Vec<u8>, usize)> {
    let code = QrCode::with_error_correction_level(data, qrcode::EcLevel::M).ok()?;
    let n = code.width();
    let quiet = 2;
    let side = (n + 2 * quiet) * scale;
    let mut px = vec![255u8; side * side * 4];
    let colors = code.to_colors();
    for y in 0..n {
        for x in 0..n {
            if colors[y * n + x] == Color::Dark {
                for dy in 0..scale {
                    for dx in 0..scale {
                        let i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
                        px[i..i + 3].copy_from_slice(&[0, 0, 0]);
                    }
                }
            }
        }
    }
    Some((px, side))
}

pub fn texture(data: &str, scale: usize) -> Option<gdk::Texture> {
    let (px, side) = render_rgba(data, scale)?;
    let bytes = glib::Bytes::from_owned(px);
    Some(gdk::MemoryTexture::new(side as i32, side as i32, gdk::MemoryFormat::R8g8b8a8, &bytes, side * 4).upcast())
}

use gtk4::prelude::Cast;

#[cfg(test)]
mod tests {
    #[test]
    fn renders_square_plate_with_dark_modules() {
        let (px, side) = super::render_rgba("https://example.com/link?user_code=ABCD-2345", 4).unwrap();
        assert_eq!(px.len(), side * side * 4);
        assert_eq!(&px[..4], &[255, 255, 255, 255], "quiet zone is white");
        assert!(px.chunks(4).any(|p| p[0] == 0), "has dark modules");
    }
}
