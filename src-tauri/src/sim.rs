//! Micro level: runs SUMO on the current graph and returns vehicle positions over time (FCD)
//! plus trip statistics, so the app can play the simulation back on the map.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::check::{command, run, sumo_bin, sumo_home, tail};

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
/// Interval of the delay timeline (heat map), seconds.
const TIMELINE_STEP_S: u32 = 60;

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

/// Optional additions to a run: route buses and so on.
#[derive(Deserialize, Default)]
pub struct Extras {
    #[serde(default)]
    pub transit: Vec<TransitLine>,
    /// Adds sidewalks, crossings and walking trips.
    #[serde(default)]
    pub pedestrians: bool,
    /// Signal timing set in the node inspector.
    #[serde(default)]
    pub signals: Vec<SignalPlan>,
}

/// Cycle length and the main direction's share of green for the signal at an OSM node.
#[derive(Deserialize, Clone)]
#[cfg_attr(test, derive(Debug))]
pub struct SignalPlan {
    pub node: String,
    pub lon: f64,
    pub lat: f64,
    pub cycle_s: f64,
    pub main_share: f64,
}

#[derive(Deserialize, Clone)]
struct TlsProgram {
    tls: String,
    xml: String,
    cycle: f64,
}

/// Signal plan of an OSM node as it went into SUMO.
#[derive(Serialize, Clone)]
pub struct AppliedPlan {
    node: String,
    tls: String,
    cycle_s: f64,
}

/// A pedestrian crossing and how many people used it over the run.
#[derive(Serialize, Clone, Debug)]
pub struct CrossingStat {
    lon: f64,
    lat: f64,
    peds: usize,
}

/// A bus route: stops in travel order and the headway in minutes.
#[derive(Deserialize, Clone)]
#[cfg_attr(test, derive(Debug))]
pub struct TransitLine {
    pub id: String,
    pub name: String,
    pub stops: Vec<[f64; 2]>,
    pub interval_min: f64,
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
    transit_lines: usize,
    pt_finished: usize,
    pt_mean_speed_kmh: f64,
    persons: usize,
    ped_finished: usize,
    /// Mean time lost per walk, mostly waiting at crossings and signals.
    ped_mean_time_loss_s: f64,
    crossings: Vec<CrossingStat>,
    plans: Vec<AppliedPlan>,
    timeline: Timeline,
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
/// Returns the frames, the number of vehicles and the number of pedestrians seen.
pub fn parse_fcd(xml: &str) -> (Vec<Frame>, usize, usize) {
    let mut frames = Vec::new();
    let mut ids: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut persons = 0;
    for line in xml.lines() {
        let l = line.trim_start();
        if l.starts_with("<timestep") {
            frames.push(Frame { t: num(l, "time"), v: Vec::new() });
            continue;
        }
        let person = l.starts_with("<person");
        if !person && !l.starts_with("<vehicle") {
            continue;
        }
        let Some(frame) = frames.last_mut() else { continue };
        let raw = attr(l, "id").unwrap_or_default();
        let id = if person { format!("p:{raw}") } else { raw.to_string() };
        let next = ids.len();
        let idx = *ids.entry(id).or_insert_with(|| {
            persons += usize::from(person);
            next
        });
        let ty = if person {
            VTYPES.len() + 1
        } else {
            match attr(l, "type") {
                Some("ptbus") => VTYPES.len(),
                Some(t) => VTYPES.iter().position(|(n, _, _)| *n == t).unwrap_or(0),
                None => 0,
            }
        };
        frame.v.extend([idx as f64, num(l, "x"), num(l, "y"), num(l, "angle"), num(l, "speed"), ty as f64]);
    }
    let total = ids.len();
    (frames, total - persons, persons)
}

/// People per pedestrian crossing (internal edges named ":node_cN"), positioned where they were first seen on it.
pub fn crossing_stats(xml: &str) -> Vec<CrossingStat> {
    let mut seen: std::collections::HashMap<String, (f64, f64, std::collections::HashSet<String>)> = std::collections::HashMap::new();
    for line in xml.lines() {
        let l = line.trim_start();
        if !l.starts_with("<person") {
            continue;
        }
        let Some(edge) = attr(l, "edge") else { continue };
        let Some((_, tail)) = edge.rsplit_once('_') else { continue };
        if !edge.starts_with(':') || !tail.starts_with('c') {
            continue;
        }
        let entry = seen.entry(edge.to_string()).or_insert_with(|| (num(l, "x"), num(l, "y"), Default::default()));
        entry.2.insert(attr(l, "id").unwrap_or_default().to_string());
    }
    let mut out: Vec<CrossingStat> = seen.into_values().map(|(lon, lat, p)| CrossingStat { lon, lat, peds: p.len() }).collect();
    out.sort_by(|a, b| b.peds.cmp(&a.peds));
    out
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() { 0.0 } else { values.iter().sum::<f64>() / values.len() as f64 }
}

pub fn simulate(osm_text: &str, minutes: u32, demand: Option<Demand>, extras: Option<Extras>) -> Result<SimResult, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = env::temp_dir().join(format!("graf-dorog-sim-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let osm = dir.join("map.osm");
    fs::write(&osm, osm_text).map_err(|e| e.to_string())?;
    let result = run_in(&dir, &osm, minutes.clamp(2, 30), demand.as_ref(), &extras.unwrap_or_default());
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

/// Delay per way and per interval of the timeline edgeData: seconds lost per vehicle on the way.
/// Keeps the `top` ways with the largest total time lost.
#[derive(Serialize, Clone, Default)]
pub struct Timeline {
    step_s: f64,
    ways: Vec<TimelineRow>,
}
#[derive(Serialize, Clone)]
pub struct TimelineRow {
    way: String,
    delay: Vec<f64>,
}

pub fn parse_timeline(xml: &str, step: f64, top: usize) -> Timeline {
    let mut cur = 0usize;
    let mut slots = 0usize;
    let mut acc: std::collections::HashMap<String, Vec<(f64, f64)>> = Default::default();
    for l in xml.lines().map(str::trim_start) {
        if l.starts_with("<interval ") {
            cur = (num(l, "begin") / step).round() as usize;
            slots = slots.max(cur + 1);
        } else if l.starts_with("<edge ") {
            let Some(way) = attr(l, "id").and_then(way_of) else { continue };
            let row = acc.entry(way.to_string()).or_default();
            if row.len() <= cur {
                row.resize(cur + 1, (0.0, 0.0));
            }
            // Vehicles that entered, or for a queue that stopped moving, the ones sitting on the edge.
            row[cur].0 += num(l, "timeLoss");
            row[cur].1 += num(l, "entered").max(num(l, "sampledSeconds") / step);
        }
    }
    let mut rows: Vec<(f64, TimelineRow)> = acc.into_iter().map(|(way, mut cells)| {
        cells.resize(slots, (0.0, 0.0));
        let total = cells.iter().map(|c| c.0).sum::<f64>();
        let delay = cells.iter().map(|(loss, n)| if *n > 0.0 { (loss / n * 10.0).round() / 10.0 } else { 0.0 }).collect();
        (total, TimelineRow { way, delay })
    }).collect();
    rows.sort_by(|a, b| b.0.total_cmp(&a.0));
    Timeline { step_s: step, ways: rows.into_iter().take(top).map(|(_, r)| r).collect() }
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
    #[serde(default)]
    stops: Vec<Option<StopLane>>,
    #[serde(default)]
    programs: Vec<Option<TlsProgram>>,
}
#[derive(Deserialize)]
struct TlsInfo {
    id: String,
    lon: f64,
    lat: f64,
    heads: Vec<(usize, f64, f64)>,
}
#[derive(Deserialize, Clone)]
struct StopLane {
    edge: String,
    lane: String,
    start: f64,
    end: f64,
}
#[derive(Deserialize)]
struct ZoneEdges {
    from: Option<String>,
    to: Option<String>,
}

const NETCONVERT_ARGS: &[&str] = &["--geometry.remove", "--ramps.guess", "--junctions.join", "--tls.guess-signals", "--tls.discard-simple",
    "--tls.join", "--tls.default-type", "actuated", "--roundabouts.guess",
    // Lane connections from turn:lanes, as the editor's junction view draws them.
    "--osm.turn-lanes"];

/// Sidewalks along urban roads and zebra crossings where OSM has them or junctions need them.
const PEDESTRIAN_ARGS: &[&str] = &["--sidewalks.guess", "--crossings.guess", "--osm.sidewalks", "--osm.crossings"];

/// What the micro run needs from the SUMO install, for the panel to explain a missing piece.
#[derive(Serialize)]
pub struct SumoStatus {
    ok: bool,
    version: Option<String>,
    bin: String,
    sumo_home: Option<String>,
    missing: Vec<&'static str>,
}

fn version_of(program: PathBuf) -> Option<String> {
    let out = command(program).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    out.status.success().then(|| text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string())
}

pub fn sumo_status() -> SumoStatus {
    status_with(sumo_bin, sumo_home())
}

fn status_with(bin: impl Fn(&str) -> PathBuf, home: Option<PathBuf>) -> SumoStatus {
    let version = version_of(bin("sumo"));
    let mut missing = Vec::new();
    if version.is_none() {
        missing.push("sumo");
    }
    if version_of(bin("netconvert")).is_none() {
        missing.push("netconvert");
    }
    let home = home.filter(|p| p.join("tools/randomTrips.py").exists());
    if home.is_none() {
        missing.push("SUMO_HOME");
    }
    let dir = bin("sumo").parent().map(|p| p.display().to_string()).unwrap_or_default();
    SumoStatus { ok: missing.is_empty(), version, bin: dir, sumo_home: home.map(|p| p.display().to_string()), missing }
}

/// Writes the SUMO network of the graph to `target`, with the same options the micro run uses.
pub fn export_net(osm_text: &str, target: &Path) -> Result<(), String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = env::temp_dir().join(format!("graf-dorog-net-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let osm = dir.join("map.osm");
    fs::write(&osm, osm_text).map_err(|e| e.to_string())?;
    let result = run(command(sumo_bin("netconvert")).arg("--osm-files").arg(&osm).arg("-o").arg(target).args(NETCONVERT_ARGS))
        .map_err(|e| format!("{e}. Установите SUMO или задайте GRAF_SUMO_BIN."))
        .and_then(|(out, log)| if out.status.success() && target.exists() { Ok(()) } else { Err(format!("netconvert не собрал сеть:\n{}", tail(&log, 15))) });
    let _ = fs::remove_dir_all(&dir);
    result
}

/// Bus stops and line flows for the transit routes. Stops matched to the same place are shared;
/// a route needs at least two matched stops. Returns the additional XML and the number of lines.
fn transit_xml(lines: &[TransitLine], stops: &[Option<StopLane>], end: f64) -> (String, usize) {
    let mut out = String::new();
    let mut ids: std::collections::HashMap<(String, i64), String> = std::collections::HashMap::new();
    let mut flows = String::new();
    let mut count = 0;
    let mut k = 0;
    for line in lines {
        let mut seq: Vec<(String, String)> = Vec::new();
        for _ in &line.stops {
            let stop = stops.get(k).cloned().flatten();
            k += 1;
            let Some(s) = stop else { continue };
            let key = (s.lane.clone(), (s.start / 10.0).round() as i64);
            let next = ids.len();
            let id = ids.entry(key).or_insert_with(|| {
                out.push_str(&format!("  <busStop id=\"bs{next}\" lane=\"{}\" startPos=\"{:.1}\" endPos=\"{:.1}\"/>\n", xml_escape(&s.lane), s.start, s.end));
                format!("bs{next}")
            }).clone();
            if seq.last().map(|(b, _)| b != &id).unwrap_or(true) {
                seq.push((id, s.edge));
            }
        }
        if seq.len() < 2 || line.interval_min <= 0.0 {
            continue;
        }
        let period = (line.interval_min * 60.0).max(60.0);
        let stops_xml: String = seq.iter().map(|(b, _)| format!("    <stop busStop=\"{b}\" duration=\"20\"/>\n")).collect();
        flows.push_str(&format!(
            "  <flow id=\"pt{}\" type=\"ptbus\" line=\"{}\" begin=\"0\" end=\"{end:.0}\" period=\"{period:.0}\" from=\"{}\" to=\"{}\" departLane=\"best\">\n{stops_xml}  </flow>\n",
            xml_escape(&line.id), xml_escape(&line.name), xml_escape(&seq[0].1), xml_escape(&seq[seq.len() - 1].1)));
        count += 1;
    }
    (format!("<additional>\n  {PT_VTYPE}\n{out}{flows}</additional>\n"), count)
}

const PT_VTYPE: &str = r#"<vType id="ptbus" vClass="bus" length="12" accel="1.2" decel="4.0" tau="1.2" minGap="3" maxSpeed="16.7" guiShape="bus"/>"#;

fn run_in(dir: &Path, osm: &Path, minutes: u32, demand: Option<&Demand>, extras: &Extras) -> Result<SimResult, String> {
    let net = dir.join("map.net.xml");
    let mut netconvert = command(sumo_bin("netconvert"));
    netconvert.arg("--osm-files").arg(osm).arg("-o").arg(&net).args(NETCONVERT_ARGS);
    if extras.pedestrians {
        netconvert.args(PEDESTRIAN_ARGS);
    }
    let (out, log) = run(&mut netconvert)
        .map_err(|e| format!("netconvert не запустился ({e}). SUMO не установлен или не найден, инструкция в панели Микро."))?;
    if !out.status.success() || !net.exists() {
        return Err(format!("netconvert не собрал сеть:\n{}", tail(&log, 15)));
    }

    let sh = sumo_home().ok_or("Не найдена папка SUMO_HOME с инструментами SUMO (randomTrips.py). Задайте переменную SUMO_HOME или поставьте SUMO через pip, инструкция в панели Микро.")?;
    let python = sumo_bin("python");
    let python = if python.exists() { python } else { PathBuf::from(if cfg!(windows) { "python" } else { "python3" }) };

    // Signal heads and zone edges come from sumolib, which knows the network projection.
    let script = dir.join("netinfo.py");
    fs::write(&script, include_str!("py/netinfo.py")).map_err(|e| e.to_string())?;
    let info_path = dir.join("netinfo.json");
    let mut cmd = command(&python);
    cmd.env("SUMO_HOME", &sh).arg(&script).arg(&net);
    let stop_points: Vec<[f64; 2]> = extras.transit.iter().flat_map(|l| l.stops.iter().copied()).collect();
    let plans: Vec<[f64; 4]> = extras.signals.iter().map(|p| [p.lon, p.lat, p.cycle_s.clamp(20.0, 240.0), p.main_share.clamp(0.1, 0.9)]).collect();
    if demand.is_some() || !stop_points.is_empty() || !plans.is_empty() {
        let request = dir.join("request.json");
        let zones = demand.map(|d| d.zones.clone()).unwrap_or_default();
        let body = serde_json::json!({ "zones": zones, "stops": stop_points, "plans": plans });
        fs::write(&request, body.to_string()).map_err(|e| e.to_string())?;
        cmd.arg(request);
    }
    let (_, ilog) = run(cmd.arg(&info_path))?;
    let info: NetInfo = match fs::read_to_string(&info_path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string())?,
        Err(_) if demand.is_none() && stop_points.is_empty() && plans.is_empty() => {
            eprintln!("netinfo.py failed, signals are not shown:\n{}", tail(&ilog, 8));
            NetInfo::default()
        }
        Err(_) => return Err(format!("Не удалось сопоставить зоны и остановки с сетью SUMO:\n{}", tail(&ilog, 15))),
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
        let (_, tlog) = run(command(&python).current_dir(&dir).env("SUMO_HOME", &sh)
            .arg(sh.join("tools/randomTrips.py")).arg("-n").arg(&net).arg("-o").arg(dir.join("map.trips.xml"))
            .arg("-r").arg(&routes).arg("--additional-files").arg(&vtypes)
            .args(["-e", &insert_end.to_string(), "-p", "1.2", "--validate", "--fringe-factor", "5", "--seed", "42", "--trip-attributes", "type=\"mix\""]))?;
        if !routes.exists() {
            return Err(format!("randomTrips не построил маршруты:\n{}", tail(&tlog, 15)));
        }
        trips = fs::read_to_string(&routes).unwrap_or_default().matches("<vehicle ").count();
        label = "random";
    }

    let mut route_files = vec![routes.display().to_string()];
    if extras.pedestrians {
        let peds = dir.join("ped.rou.xml");
        let (_, plog) = run(command(&python).current_dir(&dir).env("SUMO_HOME", &sh)
            .arg(sh.join("tools/randomTrips.py")).arg("-n").arg(&net).arg("-o").arg(&peds)
            .args(["--pedestrians", "--max-distance", "1500", "-e", &insert_end.to_string(), "-p", "1.5", "--seed", "7", "--prefix", "ped"]))?;
        if !peds.exists() {
            return Err(format!("randomTrips не построил пешеходов:\n{}", tail(&plog, 15)));
        }
        route_files.push(peds.display().to_string());
    }

    let fcd = dir.join("fcd.xml");
    let tripinfo = dir.join("tripinfo.xml");
    let edgedata = dir.join("edges.xml");
    let mut sumo = command(sumo_bin("sumo"));
    sumo.current_dir(dir).env("SUMO_HOME", &sh).arg("-n").arg(&net).arg("-r").arg(route_files.join(","));
    // randomTrips copies the vehicle types into its route file; OD trips need them, signals need the events.
    let mut additional: Vec<PathBuf> = Vec::new();
    let timeline_add = dir.join("timeline.add.xml");
    fs::write(&timeline_add, format!("<additional>\n  <edgeData id=\"timeline\" file=\"timeline.xml\" period=\"{TIMELINE_STEP_S}\" excludeEmpty=\"true\"/>\n</additional>\n"))
        .map_err(|e| e.to_string())?;
    additional.push(timeline_add);
    if demand.is_some() {
        additional.push(vtypes.clone());
    } else if !info.tls.is_empty() {
        let events_only = dir.join("events.add.xml");
        fs::write(&events_only, format!("<additional>\n{events}</additional>\n")).map_err(|e| e.to_string())?;
        additional.push(events_only);
    }
    let mut applied = Vec::new();
    let mut tl_xml = String::new();
    for (plan, prog) in extras.signals.iter().zip(&info.programs) {
        let Some(p) = prog else { continue };
        // Two OSM nodes of one joined junction map to the same SUMO light: the first one wins.
        if applied.iter().any(|a: &AppliedPlan| a.tls == p.tls) {
            continue;
        }
        tl_xml.push_str(&p.xml);
        applied.push(AppliedPlan { node: plan.node.clone(), tls: p.tls.clone(), cycle_s: p.cycle });
    }
    if !tl_xml.is_empty() {
        let tl = dir.join("signals.add.xml");
        fs::write(&tl, format!("<additional>\n{tl_xml}</additional>\n")).map_err(|e| e.to_string())?;
        additional.push(tl);
    }
    let (pt_xml, transit_lines) = transit_xml(&extras.transit, &info.stops, minutes as f64 * 60.0);
    if transit_lines > 0 {
        let pt = dir.join("transit.add.xml");
        fs::write(&pt, pt_xml).map_err(|e| e.to_string())?;
        additional.push(pt);
    }
    if !additional.is_empty() {
        let list: Vec<String> = additional.iter().map(|p| p.display().to_string()).collect();
        sumo.arg("-a").arg(list.join(","));
    }
    let (_, slog) = run(sumo
        .arg("--fcd-output").arg(&fcd).arg("--fcd-output.geo").arg("true").arg("--device.fcd.period").arg(FCD_PERIOD_S)
        .arg("--tripinfo-output").arg(&tripinfo).arg("--edgedata-output").arg(&edgedata)
        .args(["--end", &end, "--no-step-log", "--duration-log.statistics", "--time-to-teleport", "300",
            "--collision.action", "warn", "--ignore-route-errors", "true"]))?;
    if slog.contains("Quitting (on error)") {
        return Err(format!("SUMO остановился с ошибкой:\n{}", tail(&slog, 15)));
    }
    let fcd_xml = fs::read_to_string(&fcd).map_err(|_| format!("SUMO не записал траектории:\n{}", tail(&slog, 15)))?;
    let (frames, vehicles, persons) = parse_fcd(&fcd_xml);
    let crossings = if extras.pedestrians { crossing_stats(&fcd_xml) } else { Vec::new() };

    let trip_xml = fs::read_to_string(&tripinfo).unwrap_or_default();
    let all: Vec<&str> = trip_xml.lines().filter(|l| l.trim_start().starts_with("<tripinfo ")).collect();
    // Route buses are reported apart: their dwell time at stops is not delay.
    let (pt_lines, lines): (Vec<&str>, Vec<&str>) = all.into_iter().partition(|l| attr(l, "vType") == Some("ptbus"));
    let walks: Vec<&str> = trip_xml.lines().map(str::trim_start).filter(|l| l.starts_with("<walk ")).collect();
    let pt_speeds: Vec<f64> = pt_lines.iter().filter(|l| num(l, "duration") > 0.0).map(|l| num(l, "routeLength") / num(l, "duration") * 3.6).collect();
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
        types: VTYPES.iter().map(|(n, _, _)| *n).chain(["ptbus", "ped"]).collect(),
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
        transit_lines,
        pt_finished: pt_lines.len(),
        pt_mean_speed_kmh: mean(&pt_speeds),
        persons,
        ped_finished: trip_xml.matches("<personinfo ").count(),
        ped_mean_time_loss_s: mean(&walks.iter().map(|l| num(l, "timeLoss")).collect::<Vec<_>>()),
        crossings: crossings.into_iter().take(40).collect(),
        plans: applied,
        timeline: parse_timeline(&fs::read_to_string(dir.join("timeline.xml")).unwrap_or_default(), TIMELINE_STEP_S as f64, 30),
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
        let (frames, n, _) = parse_fcd(xml);
        assert_eq!(n, 2);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].v, vec![0.0, 104.26, 52.26, 90.0, 5.0, 2.0]);
        assert_eq!(frames[1].v[0], 1.0);
        assert_eq!(frames[1].v[6], 0.0);
    }
}

#[cfg(test)]
mod status_tests {
    #[test]
    fn reports_missing_sumo() {
        let dir = std::path::PathBuf::from("/nonexistent/sumo/bin");
        let s = super::status_with(|name| dir.join(name), Some(std::path::PathBuf::from("/nonexistent")));
        assert!(!s.ok);
        assert_eq!(s.missing, vec!["sumo", "netconvert", "SUMO_HOME"]);
        assert_eq!(s.bin, "/nonexistent/sumo/bin");
    }
}

#[cfg(test)]
mod timeline_tests {
    #[test]
    fn splits_delay_by_interval() {
        let xml = "<interval begin=\"0.00\" end=\"60.00\">\n<edge id=\"5#0\" timeLoss=\"20\" entered=\"2\"/>\n<edge id=\"7#1\" timeLoss=\"1\" entered=\"1\"/>\n</interval>\n<interval begin=\"60.00\" end=\"120.00\">\n<edge id=\"-5#0\" timeLoss=\"30\" entered=\"1\"/>\n</interval>";
        let t = super::parse_timeline(xml, 60.0, 10);
        assert_eq!(t.ways[0].way, "5");
        assert_eq!(t.ways[0].delay, vec![10.0, 30.0]);
        assert_eq!(t.ways[1].delay, vec![1.0, 0.0]);
    }

    #[test]
    fn stuck_queue_still_counts() {
        let xml = "<interval begin=\"0.00\" end=\"60.00\">\n<edge id=\"9#0\" timeLoss=\"240\" entered=\"0\" sampledSeconds=\"240\"/>\n</interval>";
        assert_eq!(super::parse_timeline(xml, 60.0, 10).ways[0].delay, vec![60.0]);
    }
}

#[cfg(test)]
mod local_run {
    /// Needs SUMO installed; run with `cargo test -- --ignored simulates_example`.
    #[test]
    #[ignore]
    fn finds_local_sumo() {
        let s = super::sumo_status();
        println!("sumo {:?} in {} home {:?}", s.version, s.bin, s.sumo_home);
        assert!(s.ok, "missing {:?}", s.missing);
    }

    #[test]
    #[ignore]
    fn simulates_example() {
        let text = std::fs::read_to_string("../public/example.osm").unwrap();
        let r = super::simulate(&text, 5, None, None).unwrap();
        assert!(r.vehicles > 10, "vehicles: {}", r.vehicles);
        println!("frames {} vehicles {} finished {} loss {:.1} speed {:.1} tls {}", r.frames.len(), r.vehicles, r.finished, r.mean_time_loss_s, r.mean_speed_kmh, r.traffic_lights);
        println!("ways {} signals {:?}", r.ways.len(), r.signals.iter().map(|s| (s.heads.len(), s.states.len())).collect::<Vec<_>>());
        let od = super::Demand { zones: vec![[104.258, 52.252], [104.266, 52.268], [104.262, 52.260]], od: vec![vec![0.0, 300.0, 200.0], vec![300.0, 0.0, 200.0], vec![200.0, 200.0, 0.0]] };
        let r = super::simulate(&text, 5, Some(od), None).unwrap();
        println!("od trips {} vehicles {} finished {}", r.trips, r.vehicles, r.finished);
        assert!(r.trips > 10);
        let transit: Vec<super::TransitLine> = serde_json::from_str(include_str!("testdata/transit.json")).unwrap();
        let r = super::simulate(&text, 10, None, Some(super::Extras { transit, pedestrians: false, signals: vec![] })).unwrap();
        println!("transit lines {} buses finished {} speed {:.1}", r.transit_lines, r.pt_finished, r.pt_mean_speed_kmh);
        let pt = r.frames.iter().map(|f| f.v.chunks(6).filter(|v| v[5] as usize == super::VTYPES.len()).count()).max().unwrap_or(0);
        println!("buses on the map at peak {pt}\n{}", r.log_tail);
        assert!(r.transit_lines > 0);
        let r = super::simulate(&text, 5, None, Some(super::Extras { transit: vec![], pedestrians: true, signals: vec![] })).unwrap();
        println!("persons {} walked {} loss {:.1} crossings {:?}", r.persons, r.ped_finished, r.ped_mean_time_loss_s, r.crossings.iter().take(3).collect::<Vec<_>>());
        assert!(r.persons > 10);
        let tl = r.signals.first().map(|s| (s.lon, s.lat)).unwrap();
        let plan = super::SignalPlan { node: "n".into(), lon: tl.0, lat: tl.1, cycle_s: 60.0, main_share: 0.7 };
        let r = super::simulate(&text, 5, None, Some(super::Extras { transit: vec![], pedestrians: false, signals: vec![plan] })).unwrap();
        println!("plans {:?} loss {:.1}", r.plans.iter().map(|p| (&p.tls, p.cycle_s)).collect::<Vec<_>>(), r.mean_time_loss_s);
        assert_eq!(r.plans.len(), 1);
        println!("timeline {} ways x {} min", r.timeline.ways.len(), r.timeline.ways.first().map(|w| w.delay.len()).unwrap_or(0));
        assert!(!r.timeline.ways.is_empty());
    }
}
