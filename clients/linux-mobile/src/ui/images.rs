//! Authenticated artwork loading with an in-memory texture cache.
use super::bg;
use crate::api::Client;
use gtk4::prelude::*;
use gtk4::{gdk, glib};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

#[derive(Clone)]
pub struct Images {
    client: Client,
    cache: Rc<RefCell<HashMap<String, gdk::Texture>>>,
}

impl Images {
    pub fn new(client: Client) -> Self {
        Images {
            client,
            cache: Rc::default(),
        }
    }

    /// Fills `pic` with the artwork at `path`; leaves it empty (placeholder shows) on any failure.
    pub fn load(&self, path: String, pic: &gtk4::Picture) {
        if let Some(t) = self.cache.borrow().get(&path) {
            pic.set_paintable(Some(t));
            return;
        }
        let (client, cache, weak) = (self.client.clone(), self.cache.clone(), pic.downgrade());
        let key = path.clone();
        bg(
            move || client.bytes(&path).ok(),
            move |bytes| {
                let Some(bytes) = bytes else { return };
                if let Ok(t) = gdk::Texture::from_bytes(&glib::Bytes::from_owned(bytes)) {
                    cache.borrow_mut().insert(key, t.clone());
                    if let Some(p) = weak.upgrade() {
                        p.set_paintable(Some(&t));
                        // GSK's cairo renderer sometimes keeps a stale frame for a picture that gets its image late.
                        let again = p.downgrade();
                        glib::idle_add_local_once(move || {
                            if let Some(p) = again.upgrade() {
                                p.set_visible(false);
                                p.set_visible(true);
                            }
                        });
                    }
                }
            },
        );
    }
}
