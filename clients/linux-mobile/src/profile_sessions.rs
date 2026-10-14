//! Saved profile-session switching, kept separate from the active API client.
use crate::api::{self, ApiError};
use crate::store::{self, ProfileSessionStore, Session, StoreError};
use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwitchPhase {
    Idle,
    Switching,
    AwaitingPin,
}

pub fn current_profile_action_allowed(state: &Cell<SwitchPhase>) -> bool {
    state.get() == SwitchPhase::Idle
}

pub fn generation_is_current(generation: &AtomicU64, expected: u64) -> bool {
    generation.load(Ordering::SeqCst) == expected
}

/// Moves a single picker request into its network phase without consuming rejected duplicates.
pub fn begin_switch(state: &Cell<SwitchPhase>, from_pin_dialog: bool) -> bool {
    let expected = if from_pin_dialog {
        SwitchPhase::AwaitingPin
    } else {
        SwitchPhase::Idle
    };
    if state.get() != expected {
        return false;
    }
    state.set(SwitchPhase::Switching);
    true
}

pub trait TargetAuth {
    fn refresh(&self, target: &Session, user_id: &str) -> api::Result<Session>;
    fn unlock(&self, target: &Session, user_id: &str, pin: &str) -> api::Result<Session>;
    fn lock(&self, outgoing: &Session) -> api::Result<()>;
}

struct ServerAuth;

impl TargetAuth for ServerAuth {
    fn refresh(&self, target: &Session, user_id: &str) -> api::Result<Session> {
        api::refresh_target_session(target, user_id)
    }

    fn unlock(&self, target: &Session, user_id: &str, pin: &str) -> api::Result<Session> {
        api::unlock_target_session(target, user_id, pin)
    }

    fn lock(&self, outgoing: &Session) -> api::Result<()> {
        api::lock_session(outgoing)
    }
}

#[derive(Debug)]
pub enum SwitchError {
    PinRequired,
    NotSaved,
    ActiveChanged,
    Cancelled,
    Api(ApiError),
    Store(StoreError),
}

impl std::fmt::Display for SwitchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PinRequired => f.write_str("This profile needs its PIN to switch."),
            Self::NotSaved => f.write_str("This profile is not saved on this device."),
            Self::ActiveChanged => f.write_str("The active profile changed before the switch completed."),
            Self::Cancelled => f.write_str("The profile switch was cancelled."),
            Self::Api(error) => error.fmt(f),
            Self::Store(error) => write!(f, "Could not save profile sessions: {error}"),
        }
    }
}

impl From<ApiError> for SwitchError {
    fn from(error: ApiError) -> Self {
        if matches!(error, ApiError::PinRequired) {
            Self::PinRequired
        } else {
            Self::Api(error)
        }
    }
}

impl From<StoreError> for SwitchError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

pub fn save_link_session(
    session: &Session,
    generation: Arc<AtomicU64>,
    expected_generation: u64,
) -> Result<(), SwitchError> {
    save_link_session_to(
        &ProfileSessionStore::new(store::data_dir()),
        session,
        &generation,
        expected_generation,
    )
}

fn save_link_session_to(
    sessions: &ProfileSessionStore,
    session: &Session,
    generation: &AtomicU64,
    expected_generation: u64,
) -> Result<(), SwitchError> {
    api::with_session_rotation(|| {
        if generation.load(Ordering::SeqCst) != expected_generation {
            return Err(SwitchError::Cancelled);
        }
        sessions.save_active(session).map_err(SwitchError::Store)
    })
}

pub fn sign_out(generation: Arc<AtomicU64>, expected_generation: u64) -> Result<(), SwitchError> {
    sign_out_from(
        &ProfileSessionStore::new(store::data_dir()),
        &generation,
        expected_generation,
    )
}

fn sign_out_from(
    sessions: &ProfileSessionStore,
    generation: &AtomicU64,
    expected_generation: u64,
) -> Result<(), SwitchError> {
    api::with_session_rotation(|| {
        if generation.load(Ordering::SeqCst) != expected_generation {
            return Err(SwitchError::Cancelled);
        }
        sessions.remove_active().map_err(SwitchError::Store)
    })
}

pub fn switch_saved_profile(
    active: &Session,
    user_id: &str,
    pin: Option<&str>,
    generation: Arc<AtomicU64>,
    expected_generation: u64,
) -> Result<Session, SwitchError> {
    switch_with(
        &ProfileSessionStore::new(store::data_dir()),
        active,
        user_id,
        pin,
        &ServerAuth,
        &generation,
        expected_generation,
    )
}

fn switch_with(
    sessions: &ProfileSessionStore,
    active: &Session,
    user_id: &str,
    pin: Option<&str>,
    auth: &impl TargetAuth,
    generation: &AtomicU64,
    expected_generation: u64,
) -> Result<Session, SwitchError> {
    let (validated, outgoing) = api::with_session_rotation(|| {
        if generation.load(Ordering::SeqCst) != expected_generation {
            return Err(SwitchError::Cancelled);
        }
        let outgoing = sessions.active()?.ok_or(SwitchError::ActiveChanged)?;
        if session_identity(&outgoing)? != session_identity(active)? {
            return Err(SwitchError::ActiveChanged);
        }
        let target = sessions
            .get(&outgoing.server_url, user_id)?
            .ok_or(SwitchError::NotSaved)?;
        if store::jwt_claim(&target.access_token, "sub").as_deref() != Some(user_id) {
            return Err(SwitchError::Api(ApiError::Decode(
                "saved session does not match the requested profile".into(),
            )));
        }
        let validated = match pin {
            Some(pin) => auth.unlock(&target, user_id, pin)?,
            None => auth.refresh(&target, user_id)?,
        };
        if store::jwt_claim(&validated.access_token, "sub").as_deref() != Some(user_id) {
            return Err(SwitchError::Api(ApiError::Decode(
                "validated session does not match the requested profile".into(),
            )));
        }

        // Persist rotated credentials first, then activate only while both the
        // outgoing identity and UI generation remain valid.
        let mut generation_invalidated = false;
        let activated = sessions.activate_if_active(&validated, &outgoing, || {
            generation_invalidated = generation.load(Ordering::SeqCst) != expected_generation;
            !generation_invalidated
        })?;
        if !activated {
            return Err(if generation_invalidated {
                SwitchError::Cancelled
            } else {
                SwitchError::ActiveChanged
            });
        }
        Ok((validated, outgoing))
    })?;

    // Lock only after target persistence and activation. A stale outgoing token must not block a switch.
    let _ = auth.lock(&outgoing);
    Ok(validated)
}

fn session_identity(session: &Session) -> Result<String, SwitchError> {
    let subject = store::jwt_claim(&session.access_token, "sub")
        .ok_or_else(|| SwitchError::Api(ApiError::Decode("session has no profile subject".into())))?;
    store::profile_key(&session.server_url, &subject).map_err(SwitchError::Store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "playarr-switch-{}-{}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn session(user: &str, token: &str) -> Session {
        let payload = if user == "u1" {
            "eyJzdWIiOiJ1MSJ9"
        } else if user == "u2" {
            "eyJzdWIiOiJ1MiJ9"
        } else {
            "eyJzdWIiOiJ1MyJ9"
        };
        Session {
            server_url: "https://server.test/base".into(),
            access_token: format!("h.{payload}.{token}"),
            refresh_token: format!("refresh-{user}-{token}"),
            device_id: format!("device-{user}"),
        }
    }

    struct MockAuth {
        refresh_result: Result<Session, ApiError>,
        unlock_result: Result<Session, ApiError>,
        lock_fails: bool,
        calls: RefCell<Vec<String>>,
        observe_active: Option<(ProfileSessionStore, String)>,
        bump_on_refresh: Option<Arc<AtomicU64>>,
    }

    impl TargetAuth for MockAuth {
        fn refresh(&self, _target: &Session, _user_id: &str) -> api::Result<Session> {
            self.calls.borrow_mut().push("refresh".into());
            if let Some(generation) = &self.bump_on_refresh {
                generation.fetch_add(1, Ordering::SeqCst);
            }
            self.refresh_result.clone()
        }

        fn unlock(&self, _target: &Session, _user_id: &str, _pin: &str) -> api::Result<Session> {
            self.calls.borrow_mut().push("unlock".into());
            self.unlock_result.clone()
        }

        fn lock(&self, _outgoing: &Session) -> api::Result<()> {
            self.calls.borrow_mut().push("lock".into());
            if let Some((store, expected)) = &self.observe_active {
                assert_eq!(store.active().unwrap().unwrap().access_token, *expected);
            }
            if self.lock_fails {
                Err(ApiError::Http(401))
            } else {
                Ok(())
            }
        }
    }

    fn seeded_store() -> (PathBuf, ProfileSessionStore, Session, Session) {
        let dir = temp_dir();
        let store = ProfileSessionStore::new(&dir);
        let active = session("u1", "active");
        let target = session("u2", "saved");
        store.save_active(&active).unwrap();
        store.save_inactive(&target).unwrap();
        (dir, store, active, target)
    }

    #[test]
    fn superseded_link_commit_does_not_replace_active_profile() {
        let (dir, store, active, _) = seeded_store();
        let linked = session("u3", "new-link");
        let generation = AtomicU64::new(2);
        assert!(matches!(
            save_link_session_to(&store, &linked, &generation, 1),
            Err(SwitchError::Cancelled)
        ));
        assert_eq!(store.active().unwrap(), Some(active));
        assert!(store.get("https://server.test/base", "u3").unwrap().is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn superseded_signout_does_not_remove_active_profile() {
        let (dir, store, active, _) = seeded_store();
        let generation = AtomicU64::new(2);
        assert!(matches!(
            sign_out_from(&store, &generation, 1),
            Err(SwitchError::Cancelled)
        ));
        assert_eq!(store.active().unwrap(), Some(active.clone()));
        sign_out_from(&store, &generation, 2).unwrap();
        assert!(store.active().unwrap().is_none());
        assert!(store.get("https://server.test/base", "u2").unwrap().is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn duplicate_switch_does_not_consume_awaiting_pin_state() {
        let state = Cell::new(SwitchPhase::AwaitingPin);
        assert!(!begin_switch(&state, false));
        assert_eq!(state.get(), SwitchPhase::AwaitingPin);
        assert!(begin_switch(&state, true));
        assert_eq!(state.get(), SwitchPhase::Switching);
        assert!(!begin_switch(&state, true));
        assert_eq!(state.get(), SwitchPhase::Switching);
    }

    #[test]
    fn current_profile_actions_are_blocked_during_switch_and_pin_prompt() {
        let state = Cell::new(SwitchPhase::Switching);
        assert!(!current_profile_action_allowed(&state));
        state.set(SwitchPhase::AwaitingPin);
        assert!(!current_profile_action_allowed(&state));
        state.set(SwitchPhase::Idle);
        assert!(current_profile_action_allowed(&state));
    }

    #[test]
    fn stale_shell_enter_completion_is_rejected_after_generation_changes() {
        let generation = AtomicU64::new(7);
        assert!(generation_is_current(&generation, 7));
        generation.fetch_add(1, Ordering::SeqCst);
        assert!(!generation_is_current(&generation, 7));
    }

    #[test]
    fn refresh_failure_and_pin_cancellation_leave_active_and_do_not_lock() {
        let (dir, store, active, target) = seeded_store();
        let auth = MockAuth {
            refresh_result: Err(ApiError::PinRequired),
            unlock_result: Err(ApiError::Http(401)),
            lock_fails: false,
            calls: RefCell::new(Vec::new()),
            observe_active: None,
            bump_on_refresh: None,
        };
        let generation = AtomicU64::new(0);
        assert!(matches!(
            switch_with(&store, &active, "u2", None, &auth, &generation, 0),
            Err(SwitchError::PinRequired)
        ));
        // The UI's Cancel path deliberately does not call switch_with again.
        assert_eq!(store.active().unwrap(), Some(active));
        assert_eq!(store.get("https://server.test/base", "u2").unwrap(), Some(target));
        assert_eq!(&*auth.calls.borrow(), &["refresh"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unlock_failure_preserves_active_and_never_locks_outgoing_profile() {
        let (dir, store, active, _) = seeded_store();
        let auth = MockAuth {
            refresh_result: Err(ApiError::PinRequired),
            unlock_result: Err(ApiError::Http(401)),
            lock_fails: false,
            calls: RefCell::new(Vec::new()),
            observe_active: None,
            bump_on_refresh: None,
        };
        let generation = AtomicU64::new(0);
        assert!(switch_with(&store, &active, "u2", Some("bad-pin"), &auth, &generation, 0).is_err());
        assert_eq!(store.active().unwrap(), Some(active));
        assert_eq!(&*auth.calls.borrow(), &["unlock"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn target_is_durable_before_best_effort_outgoing_lock() {
        let (dir, store, active, _) = seeded_store();
        let target = session("u2", "rotated");
        let auth = MockAuth {
            refresh_result: Ok(target.clone()),
            unlock_result: Err(ApiError::Http(401)),
            lock_fails: true,
            calls: RefCell::new(Vec::new()),
            observe_active: Some((store.clone(), target.access_token.clone())),
            bump_on_refresh: None,
        };
        let generation = AtomicU64::new(0);
        assert_eq!(
            switch_with(&store, &active, "u2", None, &auth, &generation, 0).unwrap(),
            target
        );
        assert_eq!(store.active().unwrap(), Some(target));
        assert_eq!(&*auth.calls.borrow(), &["refresh", "lock"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn persistence_failure_does_not_lock_or_change_active_profile() {
        let (dir, store, active, _) = seeded_store();
        std::fs::create_dir(dir.join("sessions.json.tmp")).unwrap();
        let auth = MockAuth {
            refresh_result: Ok(session("u2", "rotated")),
            unlock_result: Err(ApiError::Http(401)),
            lock_fails: false,
            calls: RefCell::new(Vec::new()),
            observe_active: None,
            bump_on_refresh: None,
        };
        let generation = AtomicU64::new(0);
        assert!(matches!(
            switch_with(&store, &active, "u2", None, &auth, &generation, 0),
            Err(SwitchError::Store(_))
        ));
        assert_eq!(store.active().unwrap(), Some(active));
        assert_eq!(&*auth.calls.borrow(), &["refresh"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_generation_persists_target_inactive_but_does_not_switch_or_lock() {
        let (dir, store, active, _) = seeded_store();
        let generation = Arc::new(AtomicU64::new(0));
        let target = session("u2", "rotated");
        let auth = MockAuth {
            refresh_result: Ok(target.clone()),
            unlock_result: Err(ApiError::InvalidPin),
            lock_fails: false,
            calls: RefCell::new(Vec::new()),
            observe_active: None,
            bump_on_refresh: Some(generation.clone()),
        };
        assert!(matches!(
            switch_with(&store, &active, "u2", None, &auth, &generation, 0),
            Err(SwitchError::Cancelled)
        ));
        assert_eq!(store.active().unwrap(), Some(active));
        assert_eq!(store.get("https://server.test/base", "u2").unwrap(), Some(target));
        assert_eq!(&*auth.calls.borrow(), &["refresh"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn second_switch_request_with_stale_expected_active_is_rejected_before_auth() {
        let (dir, store, original_active, _) = seeded_store();
        let new_active = session("u2", "now-active");
        let target = session("u3", "saved");
        store.save_active(&new_active).unwrap();
        store.save_inactive(&target).unwrap();
        let auth = MockAuth {
            refresh_result: Ok(session("u3", "rotated")),
            unlock_result: Err(ApiError::InvalidPin),
            lock_fails: false,
            calls: RefCell::new(Vec::new()),
            observe_active: None,
            bump_on_refresh: None,
        };
        let generation = AtomicU64::new(0);
        assert!(matches!(
            switch_with(&store, &original_active, "u3", None, &auth, &generation, 0),
            Err(SwitchError::ActiveChanged)
        ));
        assert_eq!(store.active().unwrap(), Some(new_active));
        assert!(auth.calls.borrow().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
