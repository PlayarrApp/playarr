//! Web design tokens (clients/tv-web/web/src/styles/global.css) as GTK CSS, dark and light.
use libadwaita as adw;
use std::cell::RefCell;

struct Tokens {
    bg: &'static str,
    surface: &'static str,
    surface_strong: &'static str,
    surface_soft: &'static str,
    ink: &'static str,
    ink_soft: &'static str,
    ink_muted: &'static str,
    line: &'static str,
    line_strong: &'static str,
    brand: &'static str,
    brand_ink: &'static str,
    /// The web's `--card-glow-color`: strong brand in light, brand ink in dark.
    focus_glow: &'static str,
    on_accent: &'static str,
    accent: &'static str,
    /// Shadow under floating panels and the top of the key-art wash.
    shadow: &'static str,
    wash: &'static str,
}

const DARK: Tokens = Tokens {
    bg: "#1b181b",
    surface: "#1b181b",
    surface_strong: "#211d21",
    surface_soft: "#312a30",
    ink: "#f4f0f1",
    ink_soft: "#cdc1c6",
    ink_muted: "#c2b5bb",
    line: "rgba(223, 220, 221, 0.11)",
    line_strong: "rgba(223, 220, 221, 0.23)",
    brand: "#cf3157",
    brand_ink: "#eaa6b6",
    focus_glow: "#eaa6b6",
    on_accent: "#211d21",
    accent: "#dfdcdd",
    shadow: "rgba(0, 0, 0, 0.35)",
    wash: "rgba(27, 24, 27, 0.15)",
};

const LIGHT: Tokens = Tokens {
    bg: "#fbfaf9",
    surface: "#fbfaf9",
    surface_strong: "#ffffff",
    surface_soft: "#dfdcdd",
    ink: "#382621",
    ink_soft: "#443a40",
    ink_muted: "#4d4248",
    line: "rgba(56, 38, 33, 0.14)",
    line_strong: "rgba(56, 38, 33, 0.28)",
    brand: "#cf3157",
    brand_ink: "#821e36",
    focus_glow: "#a52745",
    on_accent: "#ffffff",
    accent: "#4d4248",
    shadow: "rgba(56, 38, 33, 0.12)",
    wash: "rgba(251, 250, 249, 0.85)",
};

pub fn css(dark: bool) -> String {
    let t = if dark { &DARK } else { &LIGHT };
    let defs = format!(
        "@define-color pa_bg {}; @define-color pa_surface {}; @define-color pa_surface_strong {}; @define-color pa_soft {};\n\
         @define-color pa_ink {}; @define-color pa_ink_soft {}; @define-color pa_muted {}; @define-color pa_line {}; @define-color pa_line_strong {};\n\
         @define-color pa_brand {}; @define-color pa_brand_ink {}; @define-color pa_focus_glow {}; @define-color pa_on_accent {}; @define-color pa_accent {}; @define-color pa_shadow {}; @define-color pa_wash {}; @define-color pa_ring {};\n",
        t.bg, t.surface, t.surface_strong, t.surface_soft, t.ink, t.ink_soft, t.ink_muted, t.line, t.line_strong, t.brand, t.brand_ink,
        t.focus_glow, t.on_accent, t.accent, t.shadow, t.wash,
        // The web's dark focus ring is pure white (page-layout.css); light keeps the ink.
        if dark { "#ffffff" } else { t.ink }
    );
    // The detail hero's opacity and filter come from the web references: dark .5 and darkened, light .16 and lightened.
    // Bottom of the art: a soft fade from about 150 px; once the page is scrolled over it, dark has the web's hard edge
    // at 183 px (web references).
    let hard = if dark {
        ".pa-khero-root.scrolled .pa-khero-fade { background: linear-gradient(0deg, @pa_bg 18%, alpha(@pa_bg, 0) 18%); }\n"
    } else {
        ""
    };
    // Soft fade up the whole art when unscrolled (the web shows its film art dissolving into the page).
    let edge = if dark {
        "linear-gradient(0deg, @pa_bg 4%, alpha(@pa_bg, 0.55) 55%, alpha(@pa_bg, 0.3) 100%)"
    } else {
        "linear-gradient(0deg, @pa_bg 8%, alpha(@pa_bg, 0) 45%)"
    };
    // The dark web page covers the top 68 px of the art, then lets it ramp in over 18 px (web reference).
    let cover = if dark {
        ".pa-khero-cover { opacity: 1; background: linear-gradient(180deg, @pa_bg 68px, alpha(@pa_bg, 0) 86px); }\n.pa-khero-root.scrolled .pa-khero-cover { background: @pa_bg; }\n.pa-key-art.soft { opacity: 0.13; }\n"
    } else {
        ""
    };
    let hero = format!(
        ".pa-khero-fade {{ background: {edge}; }}\n{hard}.pa-key-art.pa-khero {{ opacity: {}; filter: {}; }}\n",
        if dark { "0.5" } else { "0.16" },
        if dark {
            "grayscale(1) contrast(0.82) brightness(0.6)"
        } else {
            "grayscale(1) contrast(0.88) brightness(1.1)"
        }
    );
    // Light agenda availability is the web's dark green (dark keeps the mint of style.css).
    let have = if dark {
        ""
    } else {
        "button.pa-entry.have { border-left-color: #224c3a; }\n.pa-dot.have { background: #224c3a; }\n.pa-chip-status.ok { color: @pa_ink; border-color: alpha(#224c3a, 0.65); background: alpha(#224c3a, 0.16); }\n"
    };
    defs + &hero + include_str!("../data/style.css") + have + cover
}

thread_local! {
    static PROVIDER: RefCell<Option<gtk4::CssProvider>> = const { RefCell::new(None) };
}

/// Applies `"dark"`, `"light"` or `"system"`: the libadwaita scheme plus the matching token CSS.
pub fn apply(theme: &str) {
    // Text as Chromium draws it: unhinted outlines and metrics, grayscale anti-aliasing.
    if let Some(st) = gtk4::Settings::default() {
        st.set_gtk_hint_font_metrics(false);
        st.set_gtk_xft_hinting(0);
        st.set_gtk_xft_hintstyle(Some("hintnone"));
        st.set_gtk_xft_antialias(1);
        st.set_gtk_xft_rgba(Some("none"));
    }
    let mgr = adw::StyleManager::default();
    mgr.set_color_scheme(match theme {
        "light" => adw::ColorScheme::ForceLight,
        "system" => adw::ColorScheme::Default,
        _ => adw::ColorScheme::ForceDark,
    });
    let Some(display) = gtk4::gdk::Display::default() else {
        return;
    };
    PROVIDER.with(|p| {
        let mut p = p.borrow_mut();
        if p.is_none() {
            let provider = gtk4::CssProvider::new();
            gtk4::style_context_add_provider_for_display(
                &display,
                &provider,
                gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
            let provider2 = provider.clone();
            // "system" follows the desktop, so reload when libadwaita flips its dark state.
            mgr.connect_dark_notify(move |m| {
                provider2.load_from_data(&css(m.is_dark()));
                crate::icons::refresh();
            });
            *p = Some(provider);
        }
        p.as_ref().unwrap().load_from_data(&css(mgr.is_dark()));
        crate::icons::refresh();
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn both_themes_define_every_token_the_stylesheet_uses() {
        for dark in [true, false] {
            let css = super::css(dark);
            for name in ["pa_bg", "pa_ink", "pa_brand", "pa_surface", "pa_soft"] {
                assert!(css.contains(&format!("@define-color {name} ")), "{name} missing");
            }
            let used = include_str!("../data/style.css");
            for tok in used.split('@').skip(1) {
                let name: String = tok.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                if name.starts_with("pa_") {
                    assert!(
                        css.contains(&format!("@define-color {name} ")),
                        "{name} used but undefined"
                    );
                }
            }
        }
    }
}
