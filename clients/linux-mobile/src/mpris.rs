//! MPRIS (org.mpris.MediaPlayer2) so the shell's media controls and lock screen show what is playing and can
//! play, pause and seek it. Control goes through callbacks the player page installs.
use gtk4::gio;
use gtk4::glib::{self, variant::ToVariant, Variant};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

const ROOT_XML: &str = r#"<node>
 <interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/><method name="Quit"/>
  <property name="CanQuit" type="b" access="read"/><property name="CanRaise" type="b" access="read"/>
  <property name="HasTrackList" type="b" access="read"/><property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
  <property name="SupportedUriSchemes" type="as" access="read"/><property name="SupportedMimeTypes" type="as" access="read"/>
 </interface>
 <interface name="org.mpris.MediaPlayer2.Player">
  <method name="Next"/><method name="Previous"/><method name="Pause"/><method name="PlayPause"/>
  <method name="Stop"/><method name="Play"/>
  <method name="Seek"><arg type="x" direction="in"/></method>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <method name="OpenUri"><arg type="s" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/><property name="LoopStatus" type="s" access="readwrite"/>
  <property name="Rate" type="d" access="readwrite"/><property name="Shuffle" type="b" access="readwrite"/>
  <property name="Metadata" type="a{sv}" access="read"/><property name="Volume" type="d" access="readwrite"/>
  <property name="Position" type="x" access="read"/><property name="MinimumRate" type="d" access="read"/>
  <property name="MaximumRate" type="d" access="read"/><property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/><property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/><property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
 </interface>
</node>"#;

const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";

/// What a remote control asks for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Cmd {
    Play,
    Pause,
    PlayPause,
    Stop,
    /// Relative seek in microseconds.
    Seek(i64),
    /// Absolute position in microseconds.
    SetPosition(i64),
    Next,
    Previous,
}

pub type Control = Rc<dyn Fn(Cmd)>;

#[derive(Default)]
struct State {
    status: &'static str,
    title: String,
    art_url: Option<String>,
    length_us: i64,
    control: Option<Control>,
    position: Option<Rc<dyn Fn() -> i64>>,
    can_next: bool,
    can_previous: bool,
}

/// Handle to the registered MPRIS service; cheap to clone.
#[derive(Clone)]
pub struct Mpris {
    conn: Rc<RefCell<Option<gio::DBusConnection>>>,
    state: Rc<RefCell<State>>,
}

pub fn metadata(title: &str, art_url: Option<&str>, length_us: i64) -> HashMap<String, Variant> {
    let mut m: HashMap<String, Variant> = HashMap::new();
    m.insert(
        "mpris:trackid".into(),
        glib::variant::ObjectPath::try_from("/app/playarr/track/1")
            .unwrap()
            .to_variant(),
    );
    m.insert("xesam:title".into(), title.to_variant());
    if length_us > 0 {
        m.insert("mpris:length".into(), length_us.to_variant());
    }
    if let Some(a) = art_url {
        m.insert("mpris:artUrl".into(), a.to_variant());
    }
    m
}

impl Mpris {
    /// Owns `org.mpris.MediaPlayer2.playarr` on the session bus; quietly does nothing without a bus.
    pub fn start() -> Mpris {
        let me = Mpris {
            conn: Rc::default(),
            state: Rc::new(RefCell::new(State {
                status: "Stopped",
                ..Default::default()
            })),
        };
        let me2 = me.clone();
        gio::bus_own_name(
            gio::BusType::Session,
            "org.mpris.MediaPlayer2.playarr",
            gio::BusNameOwnerFlags::NONE,
            move |conn, _| me2.register(&conn),
            |_, _| {},
            |_, _| {},
        );
        me
    }

    fn register(&self, conn: &gio::DBusConnection) {
        let Ok(info) = gio::DBusNodeInfo::for_xml(ROOT_XML) else {
            return;
        };
        for iface in ["org.mpris.MediaPlayer2", PLAYER] {
            let Some(ii) = info.lookup_interface(iface) else {
                continue;
            };
            let (st_get, st_call, st_set) = (self.state.clone(), self.state.clone(), self.state.clone());
            let conn2 = conn.clone();
            let this = self.clone();
            let _ = conn
                .register_object(PATH, &ii)
                .method_call(move |_, _, _, interface, method, params, inv| {
                    if interface == Some(PLAYER) {
                        let ctl = st_call.borrow().control.clone();
                        let cmd = match method {
                            "Play" => Some(Cmd::Play),
                            "Pause" => Some(Cmd::Pause),
                            "PlayPause" => Some(Cmd::PlayPause),
                            "Stop" => Some(Cmd::Stop),
                            "Next" => Some(Cmd::Next),
                            "Previous" => Some(Cmd::Previous),
                            "Seek" => params.child_value(0).get::<i64>().map(Cmd::Seek),
                            "SetPosition" => params.child_value(1).get::<i64>().map(Cmd::SetPosition),
                            _ => None,
                        };
                        if let (Some(c), Some(ctl)) = (cmd, ctl) {
                            ctl(c);
                            if let Cmd::Seek(_) | Cmd::SetPosition(_) = c {
                                this.emit_seeked();
                            }
                        }
                    }
                    inv.return_value(None);
                })
                .property(move |_, _, _, interface, prop| property(&st_get.borrow(), interface, prop))
                .set_property(move |_, _, _, _, _, _| {
                    let _ = &st_set;
                    false
                })
                .build();
            let _ = &conn2;
        }
        self.conn.replace(Some(conn.clone()));
    }

    fn emit_seeked(&self) {
        if let (Some(c), Some(pos)) = (self.conn.borrow().as_ref(), self.state.borrow().position.clone()) {
            let _ = c.emit_signal(None, PATH, PLAYER, "Seeked", Some(&(pos(),).to_variant()));
        }
    }

    fn changed(&self, props: &[&str]) {
        let Some(c) = self.conn.borrow().clone() else { return };
        let s = self.state.borrow();
        let changed: HashMap<String, Variant> =
            props.iter().map(|p| (p.to_string(), property(&s, PLAYER, p))).collect();
        let args = (PLAYER, changed, Vec::<String>::new()).to_variant();
        let _ = c.emit_signal(
            None,
            PATH,
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
            Some(&args),
        );
    }

    /// A title started playing; `control` handles remote commands, `position` returns microseconds.
    pub fn set_playing(
        &self,
        title: &str,
        art_url: Option<String>,
        length_us: i64,
        control: Control,
        position: Rc<dyn Fn() -> i64>,
    ) {
        {
            let mut s = self.state.borrow_mut();
            s.status = "Playing";
            s.title = title.to_string();
            s.art_url = art_url;
            s.length_us = length_us;
            s.control = Some(control);
            s.position = Some(position);
        }
        self.changed(&[
            "PlaybackStatus",
            "Metadata",
            "CanPlay",
            "CanPause",
            "CanSeek",
            "CanControl",
        ]);
    }

    /// Whether the queue has a next and a previous entry (episodes of a series, tracks of an album).
    pub fn set_queue_nav(&self, next: bool, previous: bool) {
        {
            let mut s = self.state.borrow_mut();
            s.can_next = next;
            s.can_previous = previous;
        }
        self.changed(&["CanGoNext", "CanGoPrevious"]);
    }

    pub fn set_status(&self, status: &'static str) {
        self.state.borrow_mut().status = status;
        self.changed(&["PlaybackStatus"]);
    }

    pub fn set_art(&self, art_url: Option<String>) {
        self.state.borrow_mut().art_url = art_url;
        self.changed(&["Metadata"]);
    }

    pub fn clear(&self) {
        *self.state.borrow_mut() = State {
            status: "Stopped",
            ..Default::default()
        };
        self.changed(&[
            "PlaybackStatus",
            "Metadata",
            "CanPlay",
            "CanPause",
            "CanSeek",
            "CanControl",
        ]);
    }
}

fn property(s: &State, interface: &str, prop: &str) -> Variant {
    let active = s.control.is_some();
    if interface == "org.mpris.MediaPlayer2" {
        return match prop {
            "CanQuit" | "CanRaise" | "HasTrackList" => false.to_variant(),
            "Identity" => "Playarr".to_variant(),
            "DesktopEntry" => "app.playarr.Mobile".to_variant(),
            _ => Vec::<String>::new().to_variant(),
        };
    }
    match prop {
        "PlaybackStatus" => s.status.to_variant(),
        "LoopStatus" => "None".to_variant(),
        "Rate" | "MinimumRate" | "MaximumRate" | "Volume" => 1.0f64.to_variant(),
        "CanGoNext" => (active && s.can_next).to_variant(),
        "CanGoPrevious" => (active && s.can_previous).to_variant(),
        "Shuffle" => false.to_variant(),
        "Metadata" => {
            if active {
                metadata(&s.title, s.art_url.as_deref(), s.length_us).to_variant()
            } else {
                HashMap::<String, Variant>::new().to_variant()
            }
        }
        "Position" => s.position.as_ref().map(|p| p()).unwrap_or(0).to_variant(),
        "CanPlay" | "CanPause" | "CanSeek" | "CanControl" => active.to_variant(),
        _ => false.to_variant(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_has_title_length_and_art() {
        let m = metadata("Test Movie A", Some("file:///tmp/a.jpg"), 5_000_000);
        assert_eq!(m["xesam:title"].get::<String>().as_deref(), Some("Test Movie A"));
        assert_eq!(m["mpris:length"].get::<i64>(), Some(5_000_000));
        assert!(m.contains_key("mpris:artUrl") && m.contains_key("mpris:trackid"));
        assert!(!metadata("x", None, 0).contains_key("mpris:length"));
    }

    #[test]
    fn idle_player_cannot_be_controlled() {
        let s = State {
            status: "Stopped",
            ..Default::default()
        };
        assert_eq!(property(&s, PLAYER, "CanControl").get::<bool>(), Some(false));
        assert_eq!(
            property(&s, PLAYER, "PlaybackStatus").get::<String>().as_deref(),
            Some("Stopped")
        );
    }

    #[test]
    fn next_and_previous_follow_the_queue() {
        let mut s = State {
            status: "Playing",
            control: Some(Rc::new(|_| {})),
            can_next: true,
            ..Default::default()
        };
        assert_eq!(property(&s, PLAYER, "CanGoNext").get::<bool>(), Some(true));
        assert_eq!(property(&s, PLAYER, "CanGoPrevious").get::<bool>(), Some(false));
        s.control = None;
        assert_eq!(property(&s, PLAYER, "CanGoNext").get::<bool>(), Some(false));
    }

    #[test]
    fn xml_parses_with_both_interfaces() {
        let info = gio::DBusNodeInfo::for_xml(ROOT_XML).unwrap();
        assert!(info.lookup_interface(PLAYER).is_some() && info.lookup_interface("org.mpris.MediaPlayer2").is_some());
    }
}
