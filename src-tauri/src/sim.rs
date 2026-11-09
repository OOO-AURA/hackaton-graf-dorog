//! Micro level: runs SUMO on the current graph and returns vehicle positions over time (FCD)
//! plus trip statistics, so the app can play the simulation back on the map.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::check::{run, sumo_bin, sumo_home, tail};

/// Vehicle types of the micro level. Order matters: the index is sent to the front end.
const VTYPES: &[(&str, &str, f64)] = &[
    ("car", r#"<vType id="car" vClass="passenger" length="4.5" accel="2.6" decel="4.5" tau="1.0" minGap="2.5" maxSpeed="27.8" probability="0.78"/>"#, 0.78),
    ("van", r#"<vType id="van" vClass="delivery" length="5.5" accel="2.2" decel="4.5" tau="1.0" minGap="2.5" maxSpeed="25" probability="0.08"/>"#, 0.08),
    ("truck", r#"<vType id="truck" vClass="truck" length="9" accel="1.3" decel="4.0" tau="1.2" minGap="3" maxSpeed="22.2" probability="0.06"/>"#, 0.06),
    ("trailer", r#"<vType id="trailer" vClass="trailer" length="16.5" accel="1.0" decel="3.5" tau="1.3" minGap="3" maxSpeed="22.2" probability="0.03"/>"#, 0.03),
    ("bus", r#"<vType id="bus" vClass="bus" length="12" accel="1.2" decel="4.0" tau="1.2" minGap="3" maxSpeed="19.4" probability="0.04"/>"#, 0.04),
    ("bus18", r#"<vType id="bus18" vClass="bus" length="18" accel="1.0" decel="4.0" tau="1.2" minGap="3" maxSpeed="19.4" probability="0.01"/>"#, 0.01),
];

const FCD_PERIOD_S: &str = "2";

#[derive(Serialize)]
pub struct Frame {
    t: f64,
    /// Flat list, six numbers per vehicle: id index, lon, lat, angle, speed m/s, type index.
    v: Vec<f64>,
}

#[derive(Serialize)]
pub struct SimResult {
    frames: Vec<Frame>,
    types: Vec<&'static str>,
    vehicles: usize,
    finished: usize,
    mean_duration_s: f64,
    mean_time_loss_s: f64,
    mean_waiting_s: f64,
    mean_speed_kmh: f64,
    traffic_lights: usize,
    teleports: f64,
    log_tail: String,
}

fn attr<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let start = line.find(&key)? + key.len();
    let end = line[start..].find('"')? + start;
    Some(&line[start..end])
}

fn num(line: &str, name: &str) -> f64 {
    attr(line, name).and_then(|v| v.parse().ok()).unwrap_or(0.0)
}

/// Reads `--fcd-output` written with `--fcd-output.geo`, so x/y are lon/lat.
pub fn parse_fcd(xml: &str) -> (Vec<Frame>, usize) {
    let mut frames = Vec::new();
    let mut ids: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for line in xml.lines() {
        let l = line.trim_start();
        if l.starts_with("<timestep") {
            frames.push(Frame { t: num(l, "time"), v: Vec::new() });
        } else if l.starts_with("<vehicle") {
            let Some(frame) = frames.last_mut() else { continue };
            let id = attr(l, "id").unwrap_or_default().to_string();
            let next = ids.len();
            let idx = *ids.entry(id).or_insert(next);
            let ty = attr(l, "type").and_then(|t| VTYPES.iter().position(|(n, _, _)| *n == t)).unwrap_or(0);
            frame.v.extend([idx as f64, num(l, "x"), num(l, "y"), num(l, "angle"), num(l, "speed"), ty as f64]);
        }
    }
    (frames, ids.len())
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() { 0.0 } else { values.iter().sum::<f64>() / values.len() as f64 }
}

pub fn simulate(osm_text: &str, minutes: u32) -> Result<SimResult, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = env::temp_dir().join(format!("graf-dorog-sim-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let osm = dir.join("map.osm");
    fs::write(&osm, osm_text).map_err(|e| e.to_string())?;
    run_in(&dir, &osm, minutes.clamp(2, 30))
}

fn run_in(dir: &Path, osm: &Path, minutes: u32) -> Result<SimResult, String> {
    let net = dir.join("map.net.xml");
    let (out, log) = run(Command::new(sumo_bin("netconvert"))
        .arg("--osm-files").arg(osm).arg("-o").arg(&net)
        .args(["--geometry.remove", "--ramps.guess", "--junctions.join", "--tls.guess-signals", "--tls.discard-simple",
            "--tls.join", "--tls.default-type", "actuated", "--roundabouts.guess"]))
        .map_err(|e| format!("{e}. Установите SUMO или задайте GRAF_SUMO_BIN."))?;
    if !out.status.success() || !net.exists() {
        return Err(format!("netconvert не собрал сеть:\n{}", tail(&log, 15)));
    }
    let net_xml = fs::read_to_string(&net).unwrap_or_default();
    let traffic_lights = net_xml.matches("<tlLogic ").count();

    let vtypes = dir.join("vtypes.add.xml");
    let body: String = VTYPES.iter().map(|(_, xml, _)| format!("    {xml}\n")).collect();
    fs::write(&vtypes, format!("<additional>\n  <vTypeDistribution id=\"mix\">\n{body}  </vTypeDistribution>\n</additional>\n"))
        .map_err(|e| e.to_string())?;

    let sh = sumo_home().ok_or("Не найден SUMO_HOME, randomTrips.py недоступен")?;
    let python = sumo_bin("python");
    let python = if python.exists() { python } else { PathBuf::from(if cfg!(windows) { "python" } else { "python3" }) };
    let end = (minutes * 60).to_string();
    let insert_end = (minutes * 60 * 2 / 3).to_string();
    let routes = dir.join("map.rou.xml");
    let (_, tlog) = run(Command::new(&python).env("SUMO_HOME", &sh)
        .arg(sh.join("tools/randomTrips.py")).arg("-n").arg(&net).arg("-o").arg(dir.join("map.trips.xml"))
        .arg("-r").arg(&routes).arg("--additional-files").arg(&vtypes)
        .args(["-e", &insert_end, "-p", "1.2", "--validate", "--fringe-factor", "5", "--seed", "42", "--trip-attributes", "type=\"mix\""]))?;
    if !routes.exists() {
        return Err(format!("randomTrips не построил маршруты:\n{}", tail(&tlog, 15)));
    }

    // randomTrips copies the vehicle types into the route file, so they are not passed to sumo again.
    let fcd = dir.join("fcd.xml");
    let trips = dir.join("tripinfo.xml");
    let (_, slog) = run(Command::new(sumo_bin("sumo")).env("SUMO_HOME", &sh)
        .arg("-n").arg(&net).arg("-r").arg(&routes)
        .arg("--fcd-output").arg(&fcd).arg("--fcd-output.geo").arg("true").arg("--device.fcd.period").arg(FCD_PERIOD_S)
        .arg("--tripinfo-output").arg(&trips)
        .args(["--end", &end, "--no-step-log", "--duration-log.statistics", "--time-to-teleport", "300", "--collision.action", "warn"]))?;
    let fcd_xml = fs::read_to_string(&fcd).map_err(|_| format!("SUMO не записал траектории:\n{}", tail(&slog, 15)))?;
    let (frames, vehicles) = parse_fcd(&fcd_xml);

    let trip_xml = fs::read_to_string(&trips).unwrap_or_default();
    let lines: Vec<&str> = trip_xml.lines().filter(|l| l.trim_start().starts_with("<tripinfo ")).collect();
    let pick = |name: &str| lines.iter().map(|l| num(l, name)).collect::<Vec<_>>();
    let durations = pick("duration");
    let lengths = pick("routeLength");
    let speeds: Vec<f64> = durations.iter().zip(&lengths).filter(|(d, _)| **d > 0.0).map(|(d, l)| l / d * 3.6).collect();

    Ok(SimResult {
        frames,
        types: VTYPES.iter().map(|(n, _, _)| *n).collect(),
        vehicles,
        finished: lines.len(),
        mean_duration_s: mean(&durations),
        mean_time_loss_s: mean(&pick("timeLoss")),
        mean_waiting_s: mean(&pick("waitingTime")),
        mean_speed_kmh: mean(&speeds),
        traffic_lights,
        teleports: crate::check::number_after(&slog, "Teleports").unwrap_or(0.0),
        log_tail: tail(&slog, 12),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_geo_fcd() {
        let xml = r#"<fcd-export>
  <timestep time="0.00">
    <vehicle id="a" x="104.26" y="52.26" angle="90.00" type="truck" speed="5.00" pos="1" lane="e_0" slope="0.00"/>
  </timestep>
  <timestep time="2.00">
    <vehicle id="b" x="104.27" y="52.27" angle="0.00" type="car" speed="10.00" pos="1" lane="e_0" slope="0.00"/>
    <vehicle id="a" x="104.261" y="52.26" angle="90.00" type="truck" speed="6.00" pos="1" lane="e_0" slope="0.00"/>
  </timestep>
</fcd-export>"#;
        let (frames, n) = parse_fcd(xml);
        assert_eq!(n, 2);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].v, vec![0.0, 104.26, 52.26, 90.0, 5.0, 2.0]);
        assert_eq!(frames[1].v[0], 1.0);
        assert_eq!(frames[1].v[6], 0.0);
    }
}

#[cfg(test)]
mod local_run {
    /// Needs SUMO installed; run with `cargo test -- --ignored simulates_example`.
    #[test]
    #[ignore]
    fn simulates_example() {
        let text = std::fs::read_to_string("../public/example.osm").unwrap();
        let r = super::simulate(&text, 5).unwrap();
        assert!(r.vehicles > 10, "vehicles: {}", r.vehicles);
        println!("frames {} vehicles {} finished {} loss {:.1} speed {:.1} tls {}", r.frames.len(), r.vehicles, r.finished, r.mean_time_loss_s, r.mean_speed_kmh, r.traffic_lights);
    }
}
