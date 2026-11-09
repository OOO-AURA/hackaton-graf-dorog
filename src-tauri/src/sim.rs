//! Micro level: runs SUMO on the current graph and returns vehicle positions over time (FCD)
//! plus trip statistics, so the app can play the simulation back on the map.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

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

/// Demand from the macro model: zone centroids (lon, lat) and an OD matrix in vehicles per hour.
#[derive(Deserialize)]
pub struct Demand {
    zones: Vec<[f64; 2]>,
    od: Vec<Vec<f64>>,
}

/// Aggregated micro statistics of one OSM way over the whole run.
#[derive(Serialize, Default, Clone)]
pub struct WayStat {
    way: String,
    entered: f64,
    /// Mean speed, km/h, weighted by time spent on the way.
    speed_kmh: f64,
    /// Mean time loss per vehicle, seconds.
    delay_s: f64,
    /// Mean waiting (standing) time per vehicle, seconds.
    waiting_s: f64,
}

/// Traffic light with one signal head per incoming lane and its state changes.
#[derive(Serialize)]
pub struct Signal {
    id: String,
    lon: f64,
    lat: f64,
    /// Link index, lon, lat for each head.
    heads: Vec<(usize, f64, f64)>,
    /// (time, state string) whenever the state changes.
    states: Vec<(f64, String)>,
}

#[derive(Serialize)]
pub struct SimResult {
    frames: Vec<Frame>,
    types: Vec<&'static str>,
    demand: &'static str,
    trips: usize,
    vehicles: usize,
    finished: usize,
    mean_duration_s: f64,
    mean_time_loss_s: f64,
    mean_waiting_s: f64,
    mean_speed_kmh: f64,
    traffic_lights: usize,
    teleports: f64,
    ways: Vec<WayStat>,
    signals: Vec<Signal>,
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

pub fn simulate(osm_text: &str, minutes: u32, demand: Option<Demand>) -> Result<SimResult, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = env::temp_dir().join(format!("graf-dorog-sim-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let osm = dir.join("map.osm");
    fs::write(&osm, osm_text).map_err(|e| e.to_string())?;
    let result = run_in(&dir, &osm, minutes.clamp(2, 30), demand.as_ref());
    let _ = fs::remove_dir_all(&dir);
    result
}

/// Way id of a SUMO edge built from OSM: "-123#4" and "123#0" both belong to way 123.
fn way_of(edge: &str) -> Option<&str> {
    let id = edge.trim_start_matches('-');
    let id = id.split('#').next()?;
    (!id.is_empty() && id.bytes().all(|b| b.is_ascii_digit() || b == b'-')).then_some(id)
}

/// Sums `--edgedata-output` per OSM way.
pub fn parse_edgedata(xml: &str) -> Vec<WayStat> {
    let mut acc: std::collections::BTreeMap<String, (f64, f64, f64, f64, f64)> = Default::default();
    for l in xml.lines().map(str::trim_start).filter(|l| l.starts_with("<edge ")) {
        let Some(way) = attr(l, "id").and_then(way_of) else { continue };
        let a = acc.entry(way.to_string()).or_default();
        let secs = num(l, "sampledSeconds");
        a.0 += num(l, "entered");
        a.1 += num(l, "speed") * secs;
        a.2 += secs;
        a.3 += num(l, "timeLoss");
        a.4 += num(l, "waitingTime");
    }
    acc.into_iter()
        .filter(|(_, a)| a.0 > 0.0)
        .map(|(way, (entered, sv, secs, loss, wait))| WayStat {
            way,
            entered,
            speed_kmh: if secs > 0.0 { sv / secs * 3.6 } else { 0.0 },
            delay_s: loss / entered,
            waiting_s: wait / entered,
        })
        .collect()
}

/// Reads SaveTLSStates output, keeping only state changes per light.
pub fn parse_tls_states(xml: &str) -> std::collections::HashMap<String, Vec<(f64, String)>> {
    let mut out: std::collections::HashMap<String, Vec<(f64, String)>> = Default::default();
    for l in xml.lines().map(str::trim_start).filter(|l| l.starts_with("<tlsState ")) {
        let (Some(id), Some(state)) = (attr(l, "id"), attr(l, "state")) else { continue };
        let list = out.entry(id.to_string()).or_default();
        if list.last().map_or(true, |(_, s)| s != state) {
            list.push((num(l, "time"), state.to_string()));
        }
    }
    out
}

/// Turns the OD matrix (veh/h) into trips between the edges that serve each zone,
/// spread evenly over the insertion window. Returns the trips XML and their count.
fn od_trips(demand: &Demand, edges: &[(Option<String>, Option<String>)], insert_end: f64) -> (String, usize) {
    let mut trips: Vec<(f64, &str, &str)> = Vec::new();
    for (i, row) in demand.od.iter().enumerate() {
        for (j, q) in row.iter().enumerate() {
            let (Some((Some(from), _)), Some((_, Some(to)))) = (edges.get(i), edges.get(j)) else { continue };
            if i == j || from == to || *q <= 0.0 {
                continue;
            }
            let n = (q * insert_end / 3600.0).round() as usize;
            for k in 0..n {
                // Offset each pair a little so departures from one zone do not bunch up.
                let t = (k as f64 + ((i * 7 + j * 13) % 10) as f64 / 10.0) * insert_end / n as f64;
                trips.push((t.min(insert_end), from, to));
            }
        }
    }
    trips.sort_by(|a, b| a.0.total_cmp(&b.0));
    let body: String = trips.iter().enumerate()
        .map(|(k, (t, f, to))| format!("  <trip id=\"od{k}\" type=\"mix\" depart=\"{t:.1}\" from=\"{f}\" to=\"{to}\" departLane=\"best\" departSpeed=\"max\"/>\n"))
        .collect();
    (format!("<routes>\n{body}</routes>\n"), trips.len())
}

#[derive(Deserialize, Default)]
struct NetInfo {
    tls: Vec<TlsInfo>,
    zones: Vec<ZoneEdges>,
}
#[derive(Deserialize)]
struct TlsInfo {
    id: String,
    lon: f64,
    lat: f64,
    heads: Vec<(usize, f64, f64)>,
}
#[derive(Deserialize)]
struct ZoneEdges {
    from: Option<String>,
    to: Option<String>,
}

fn run_in(dir: &Path, osm: &Path, minutes: u32, demand: Option<&Demand>) -> Result<SimResult, String> {
    let net = dir.join("map.net.xml");
    let (out, log) = run(Command::new(sumo_bin("netconvert"))
        .arg("--osm-files").arg(osm).arg("-o").arg(&net)
        .args(["--geometry.remove", "--ramps.guess", "--junctions.join", "--tls.guess-signals", "--tls.discard-simple",
            "--tls.join", "--tls.default-type", "actuated", "--roundabouts.guess"]))
        .map_err(|e| format!("{e}. Установите SUMO или задайте GRAF_SUMO_BIN."))?;
    if !out.status.success() || !net.exists() {
        return Err(format!("netconvert не собрал сеть:\n{}", tail(&log, 15)));
    }

    let sh = sumo_home().ok_or("Не найден SUMO_HOME, инструменты SUMO недоступны")?;
    let python = sumo_bin("python");
    let python = if python.exists() { python } else { PathBuf::from(if cfg!(windows) { "python" } else { "python3" }) };

    // Signal heads and zone edges come from sumolib, which knows the network projection.
    let script = dir.join("netinfo.py");
    fs::write(&script, include_str!("py/netinfo.py")).map_err(|e| e.to_string())?;
    let info_path = dir.join("netinfo.json");
    let mut cmd = Command::new(&python);
    cmd.env("SUMO_HOME", &sh).arg(&script).arg(&net);
    if let Some(d) = demand {
        let zones = dir.join("zones.json");
        fs::write(&zones, serde_json::to_string(&d.zones).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        cmd.arg(zones);
    }
    let (_, ilog) = run(cmd.arg(&info_path))?;
    let info: NetInfo = match fs::read_to_string(&info_path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string())?,
        Err(_) if demand.is_none() => NetInfo::default(),
        Err(_) => return Err(format!("Не удалось сопоставить зоны с сетью SUMO:\n{}", tail(&ilog, 15))),
    };

    let vtypes = dir.join("vtypes.add.xml");
    let body: String = VTYPES.iter().map(|(_, xml, _)| format!("    {xml}\n")).collect();
    let events: String = info.tls.iter()
        .map(|t| format!("  <timedEvent type=\"SaveTLSStates\" source=\"{}\" dest=\"tls.xml\"/>\n", xml_escape(&t.id)))
        .collect();
    fs::write(&vtypes, format!("<additional>\n  <vTypeDistribution id=\"mix\">\n{body}  </vTypeDistribution>\n{events}</additional>\n"))
        .map_err(|e| e.to_string())?;

    let end = (minutes * 60).to_string();
    let insert_end = minutes * 60 * 2 / 3;
    let routes = dir.join("map.rou.xml");
    let trips;
    let label;
    if let Some(d) = demand {
        let edges: Vec<_> = info.zones.into_iter().map(|z| (z.from, z.to)).collect();
        let (xml, n) = od_trips(d, &edges, insert_end as f64);
        if n == 0 {
            return Err("Матрица корреспонденций не дала ни одной поездки: пересчитайте потоки или увеличьте число поездок.".into());
        }
        fs::write(&routes, xml).map_err(|e| e.to_string())?;
        trips = n;
        label = "od";
    } else {
        let (_, tlog) = run(Command::new(&python).env("SUMO_HOME", &sh)
            .arg(sh.join("tools/randomTrips.py")).arg("-n").arg(&net).arg("-o").arg(dir.join("map.trips.xml"))
            .arg("-r").arg(&routes).arg("--additional-files").arg(&vtypes)
            .args(["-e", &insert_end.to_string(), "-p", "1.2", "--validate", "--fringe-factor", "5", "--seed", "42", "--trip-attributes", "type=\"mix\""]))?;
        if !routes.exists() {
            return Err(format!("randomTrips не построил маршруты:\n{}", tail(&tlog, 15)));
        }
        trips = fs::read_to_string(&routes).unwrap_or_default().matches("<vehicle ").count();
        label = "random";
    }

    let fcd = dir.join("fcd.xml");
    let tripinfo = dir.join("tripinfo.xml");
    let edgedata = dir.join("edges.xml");
    let mut sumo = Command::new(sumo_bin("sumo"));
    sumo.current_dir(dir).env("SUMO_HOME", &sh).arg("-n").arg(&net).arg("-r").arg(&routes);
    // randomTrips copies the vehicle types into its route file; OD trips need them, signals need the events.
    if demand.is_some() {
        sumo.arg("-a").arg(&vtypes);
    } else if !info.tls.is_empty() {
        let events_only = dir.join("events.add.xml");
        fs::write(&events_only, format!("<additional>\n{events}</additional>\n")).map_err(|e| e.to_string())?;
        sumo.arg("-a").arg(&events_only);
    }
    let (_, slog) = run(sumo
        .arg("--fcd-output").arg(&fcd).arg("--fcd-output.geo").arg("true").arg("--device.fcd.period").arg(FCD_PERIOD_S)
        .arg("--tripinfo-output").arg(&tripinfo).arg("--edgedata-output").arg(&edgedata)
        .args(["--end", &end, "--no-step-log", "--duration-log.statistics", "--time-to-teleport", "300",
            "--collision.action", "warn", "--ignore-route-errors", "true"]))?;
    let fcd_xml = fs::read_to_string(&fcd).map_err(|_| format!("SUMO не записал траектории:\n{}", tail(&slog, 15)))?;
    let (frames, vehicles) = parse_fcd(&fcd_xml);

    let trip_xml = fs::read_to_string(&tripinfo).unwrap_or_default();
    let lines: Vec<&str> = trip_xml.lines().filter(|l| l.trim_start().starts_with("<tripinfo ")).collect();
    let pick = |name: &str| lines.iter().map(|l| num(l, name)).collect::<Vec<_>>();
    let durations = pick("duration");
    let lengths = pick("routeLength");
    let speeds: Vec<f64> = durations.iter().zip(&lengths).filter(|(d, _)| **d > 0.0).map(|(d, l)| l / d * 3.6).collect();

    let mut states = parse_tls_states(&fs::read_to_string(dir.join("tls.xml")).unwrap_or_default());
    let signals = info.tls.into_iter()
        .map(|t| Signal { states: states.remove(&t.id).unwrap_or_default(), id: t.id, lon: t.lon, lat: t.lat, heads: t.heads })
        .collect::<Vec<_>>();

    Ok(SimResult {
        frames,
        types: VTYPES.iter().map(|(n, _, _)| *n).collect(),
        demand: label,
        trips,
        vehicles,
        finished: lines.len(),
        mean_duration_s: mean(&durations),
        mean_time_loss_s: mean(&pick("timeLoss")),
        mean_waiting_s: mean(&pick("waitingTime")),
        mean_speed_kmh: mean(&speeds),
        traffic_lights: signals.len(),
        teleports: crate::check::number_after(&slog, "Teleports").unwrap_or(0.0),
        ways: parse_edgedata(&fs::read_to_string(&edgedata).unwrap_or_default()),
        signals,
        log_tail: tail(&slog, 12),
    })
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;")
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
        let r = super::simulate(&text, 5, None).unwrap();
        assert!(r.vehicles > 10, "vehicles: {}", r.vehicles);
        println!("frames {} vehicles {} finished {} loss {:.1} speed {:.1} tls {}", r.frames.len(), r.vehicles, r.finished, r.mean_time_loss_s, r.mean_speed_kmh, r.traffic_lights);
        println!("ways {} signals {:?}", r.ways.len(), r.signals.iter().map(|s| (s.heads.len(), s.states.len())).collect::<Vec<_>>());
        let od = super::Demand { zones: vec![[104.258, 52.252], [104.266, 52.268], [104.262, 52.260]], od: vec![vec![0.0, 300.0, 200.0], vec![300.0, 0.0, 200.0], vec![200.0, 200.0, 0.0]] };
        let r = super::simulate(&text, 5, Some(od)).unwrap();
        println!("od trips {} vehicles {} finished {}", r.trips, r.vehicles, r.finished);
        assert!(r.trips > 10);
    }
}
