//! Wire types for the subset of the Playarr Server API this client uses.
//! Shapes follow `backend/openapi/playarr.yaml`; unknown fields are ignored and optional ones default.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Image {
    pub kind: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Work {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub images: Vec<Image>,
    #[serde(default)]
    pub availability: String,
}

impl Work {
    pub fn year(&self) -> Option<&str> {
        self.release_date.as_deref().and_then(|d| d.get(..4))
    }
    pub fn has_image(&self, kind: &str) -> bool {
        self.images.iter().any(|i| i.kind == kind)
    }
    pub fn kind_label(&self) -> &'static str {
        match self.kind.as_str() {
            "movie" => "Movie",
            "series" => "Series",
            "artist" => "Artist",
            _ => "Title",
        }
    }
    /// "Movie · 2008", the meta line under a card.
    pub fn meta_line(&self) -> String {
        match self.year() {
            Some(y) => format!("{} · {y}", self.kind_label()),
            None => self.kind_label().to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rail {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub items: Vec<Work>,
    #[serde(default)]
    pub total: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HomeRails {
    #[serde(default)]
    pub rails: Vec<Rail>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogPage {
    #[serde(default)]
    pub items: Vec<Work>,
    #[serde(default)]
    pub total: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchResults {
    #[serde(default)]
    pub items: Vec<Work>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Profile {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub is_current: bool,
    #[serde(default)]
    pub pin_locked: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Episode {
    pub id: String,
    pub episode_number: i32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub runtime_minutes: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EpisodeDetail {
    pub episode: Episode,
    #[serde(default)]
    pub media_file_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Season {
    pub season_number: i32,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SeasonDetail {
    pub season: Season,
    #[serde(default)]
    pub episodes: Vec<EpisodeDetail>,
}

/// `WorkChildrenSchema` is `"Movie"` or `{"Series": [...]}` (or artist/author variants we ignore).
#[derive(Debug, Clone, Default)]
pub struct Children {
    pub seasons: Vec<SeasonDetail>,
}

impl<'de> Deserialize<'de> for Children {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        let seasons = v
            .get("Series")
            .and_then(|s| serde_json::from_value(s.clone()).ok())
            .unwrap_or_default();
        Ok(Children { seasons })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkDetail {
    pub work: Work,
    #[serde(default)]
    pub media_file_id: Option<String>,
    #[serde(default)]
    pub runtime_ms: Option<i64>,
    #[serde(default)]
    pub children: Children,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResumeOption {
    pub media_file_id: String,
    pub episode_id: String,
    pub season_number: i32,
    pub episode_number: i32,
    #[serde(default)]
    pub position_ms: i64,
    #[serde(default)]
    pub progress_percent: i32,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResumePlan {
    pub series_work_id: String,
    #[serde(default)]
    pub target: Option<ResumeOption>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WatchProgress {
    pub media_file_id: String,
    #[serde(default)]
    pub work_id: String,
    #[serde(default)]
    pub position_ms: i64,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub state: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlaybackInfo {
    pub url: String,
    pub mode: String,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub source_offset_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct ProgressUpdate {
    pub position_ms: i64,
    pub duration_ms: i64,
    pub completed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Claim {
    pub server_url: String,
    pub server_device_code: String,
    #[serde(default)]
    pub server_urls: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AvatarPref {
    #[serde(default)]
    pub preset: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_meta_line_and_unknown_fields() {
        let w: Work = serde_json::from_str(
            r#"{"id":"1","kind":"movie","title":"Test Movie A","release_date":"2008-12-01T00:00:00Z","extra":1}"#,
        )
        .unwrap();
        assert_eq!(w.meta_line(), "Movie · 2008");
        assert!(!w.has_image("poster"));
    }

    #[test]
    fn detail_children_series_and_movie() {
        let s: WorkDetail = serde_json::from_str(
            r#"{"work":{"id":"1","kind":"series","title":"S"},"children":{"Series":[{"season":{"season_number":1},"episodes":[{"episode":{"id":"e","episode_number":1},"media_file_id":"m"}]}]}}"#,
        )
        .unwrap();
        assert_eq!(s.children.seasons[0].episodes[0].media_file_id.as_deref(), Some("m"));
        let m: WorkDetail = serde_json::from_str(
            r#"{"work":{"id":"1","kind":"movie","title":"M"},"children":"Movie","media_file_id":"f"}"#,
        )
        .unwrap();
        assert!(m.children.seasons.is_empty());
    }
}
