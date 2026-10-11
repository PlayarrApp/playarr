//! The six shared preset avatars (clients/shared/profile-avatars), drawn from the committed PNG plates.
use gtk4::{gdk, glib};

pub const PRESETS: [&str; 6] = ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"];

/// Web's `defaultProfileAvatarPreset`: a 31-multiplier hash of the user id picks the preset.
pub fn default_preset(user_id: &str) -> &'static str {
    let mut h: u32 = 0;
    for c in user_id.encode_utf16() {
        h = h.wrapping_mul(31).wrapping_add(c as u32);
    }
    PRESETS[(h as usize) % PRESETS.len()]
}

fn png(id: &str) -> &'static [u8] {
    match id {
        "astronaut" => include_bytes!("../../shared/profile-avatars/plates/astronaut.png"),
        "cat" => include_bytes!("../../shared/profile-avatars/plates/cat.png"),
        "dinosaur" => include_bytes!("../../shared/profile-avatars/plates/dinosaur.png"),
        "robot" => include_bytes!("../../shared/profile-avatars/plates/robot.png"),
        "pirate" => include_bytes!("../../shared/profile-avatars/plates/pirate.png"),
        _ => include_bytes!("../../shared/profile-avatars/plates/alien.png"),
    }
}

pub fn texture(id: &str) -> Option<gdk::Texture> {
    gdk::Texture::from_bytes(&glib::Bytes::from_static(png(id))).ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn default_preset_matches_web_hash() {
        // "a": hash 97, 97 % 6 = 1 -> cat
        assert_eq!(super::default_preset("a"), "cat");
        assert_eq!(super::default_preset(""), "astronaut");
    }
    #[test]
    fn every_preset_has_artwork() {
        for p in super::PRESETS {
            assert!(!super::png(p).is_empty());
        }
    }
}
