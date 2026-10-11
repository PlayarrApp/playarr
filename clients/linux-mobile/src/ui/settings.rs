//! Settings basics: theme, account, about.
use super::App;
use crate::api::Client;
use crate::{store, theme};
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;
use std::rc::Rc;

const THEMES: [(&str, &str); 3] = [("dark", "Dark"), ("light", "Light"), ("system", "Follow system")];

pub fn build(app: Rc<App>, client: Client) -> gtk4::Widget {
    let page = adw::PreferencesPage::new();

    let look = adw::PreferencesGroup::builder().title("Appearance").build();
    let names: Vec<&str> = THEMES.iter().map(|t| t.1).collect();
    let row = adw::ComboRow::builder()
        .title("Theme")
        .model(&gtk4::StringList::new(&names))
        .build();
    let current = store::load_settings().theme;
    row.set_selected(THEMES.iter().position(|t| t.0 == current).unwrap_or(0) as u32);
    row.connect_selected_notify(|r| {
        let theme_name = THEMES[r.selected() as usize].0;
        store::save_settings(&store::Settings {
            theme: theme_name.into(),
        });
        theme::apply(theme_name);
    });
    look.add(&row);
    page.add(&look);

    let account = adw::PreferencesGroup::builder().title("Account").build();
    account.add(
        &adw::ActionRow::builder()
            .title("Server")
            .subtitle(client.base())
            .subtitle_selectable(true)
            .build(),
    );
    let out = adw::ActionRow::builder().title("Sign out").activatable(true).build();
    out.add_prefix(&gtk4::Image::from_icon_name("system-log-out-symbolic"));
    {
        let app = app.clone();
        out.connect_activated(move |_| {
            app.nav.pop_to_page(
                &app.nav
                    .navigation_stack()
                    .item(0)
                    .and_downcast::<adw::NavigationPage>()
                    .unwrap(),
            );
            app.sign_out();
        });
    }
    account.add(&out);
    page.add(&account);

    let about = adw::PreferencesGroup::builder().title("About").build();
    about.add(
        &adw::ActionRow::builder()
            .title("Playarr for Linux phones")
            .subtitle(env!("CARGO_PKG_VERSION"))
            .build(),
    );
    page.add(&about);
    page.upcast()
}
