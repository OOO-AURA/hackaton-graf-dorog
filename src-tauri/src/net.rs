//! HTTP for downloading map data (Overpass, Nominatim) from the desktop app.
//!
//! Requests go through the system `curl` (built into macOS and Windows 10+) instead of the web view:
//! public Overpass mirrors reject browser requests that carry an Origin header, and the main server
//! refuses clients without a proper User-Agent. No extra Rust HTTP dependency is needed.

use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};

const USER_AGENT: &str = "hackaton-graf-dorog/0.1 (OSM road graph editor)";
const TIMEOUT_S: &str = "300";
const STATUS_MARK: &str = "\n@@status@@";

#[derive(Serialize)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

/// Splits curl output into the body and the HTTP status written by `-w`.
fn split_status(out: &str) -> Result<HttpReply, String> {
    let at = out.rfind(STATUS_MARK).ok_or("curl не вернул код ответа")?;
    let status = out[at + STATUS_MARK.len()..].trim().parse::<u16>().map_err(|e| format!("Неверный код ответа: {e}"))?;
    Ok(HttpReply { status, body: out[..at].to_string() })
}

/// GET when `form` is None, otherwise POST of an urlencoded form body.
pub fn request(url: &str, form: Option<&str>) -> Result<HttpReply, String> {
    if !url.starts_with("https://") {
        return Err("Разрешены только адреса https".into());
    }
    let mut cmd = Command::new("curl");
    cmd.args(["-sS", "-L", "-m", TIMEOUT_S, "-A", USER_AGENT, "-w", &format!("{STATUS_MARK}%{{http_code}}")]);
    if form.is_some() {
        cmd.args(["-H", "Content-Type: application/x-www-form-urlencoded", "--data-binary", "@-"]);
    }
    cmd.arg(url).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить curl: {e}"))?;
    if let Some(body) = form {
        child.stdin.take().ok_or("Нет stdin у curl")?.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Сеть недоступна: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    split_status(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_body_and_status() {
        let r = split_status("<osm/>\n@@status@@200").unwrap();
        assert_eq!((r.status, r.body.as_str()), (200, "<osm/>"));
        assert!(split_status("no status").is_err());
    }

    #[test]
    fn refuses_plain_http() {
        assert!(request("http://example.com", None).is_err());
    }

    /// Real request to the public servers; run with `cargo test -- --ignored` when online.
    #[test]
    #[ignore]
    fn downloads_from_overpass_and_nominatim() {
        let query = "data=%5Bout%3Axml%5D%3Bnode%28286122970%29%3Bout%20meta%3B";
        let mirrors = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        ];
        let ok = mirrors.iter().find_map(|url| request(url, Some(query)).ok().filter(|r| r.status == 200));
        let reply = ok.expect("no Overpass mirror answered 200");
        assert!(reply.body.contains("286122970"), "unexpected body: {}", &reply.body[..reply.body.len().min(200)]);

        let place = request("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=Shelekhov", None).unwrap();
        assert_eq!(place.status, 200);
        assert!(place.body.contains("boundingbox"));
    }
}
