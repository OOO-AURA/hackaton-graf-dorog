//! Local copy of the organisers' pipeline: the saved .osm goes through the same
//! adapters the check server uses (netconvert + sumo, MATSim OsmNetworkReader,
//! the Webots OSM importer). Each stage reports numbers and concrete problems so
//! the file can be fixed before spending a server run on it.
//!
//! Tool locations can be overridden with environment variables:
//! GRAF_SUMO_BIN, GRAF_JAVA, GRAF_MATSIM_DIR, GRAF_WEBOTS_IMPORTER, GRAF_WEBOTS_PYTHON.

use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_PROBLEMS: usize = 40;
const SIM_END_S: &str = "1200";
const TRIPS_END_S: &str = "900";
const TRIPS_PERIOD_S: &str = "1.5";

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warn,
    Fail,
    Skipped,
}

#[derive(Serialize)]
pub struct Stage {
    name: &'static str,
    status: Status,
    seconds: f64,
    /// (label, value) pairs shown as a small table.
    metrics: Vec<(String, String)>,
    problems: Vec<String>,
    log_tail: String,
}

#[derive(Serialize)]
pub struct Report {
    work_dir: String,
    stages: Vec<Stage>,
}

impl Stage {
    fn new(name: &'static str) -> Self {
        Stage { name, status: Status::Ok, seconds: 0.0, metrics: vec![], problems: vec![], log_tail: String::new() }
    }
    fn metric(&mut self, label: &str, value: impl ToString) {
        self.metrics.push((label.to_string(), value.to_string()));
    }
    fn problem(&mut self, text: impl Into<String>) {
        if self.problems.len() < MAX_PROBLEMS {
            self.problems.push(text.into());
        }
    }
    fn warn(&mut self) {
        if self.status == Status::Ok {
            self.status = Status::Warn;
        }
    }
    fn fail(mut self, why: impl Into<String>) -> Self {
        self.status = Status::Fail;
        self.problems.insert(0, why.into());
        self
    }
    fn skip(mut self, why: impl Into<String>) -> Self {
        self.status = Status::Skipped;
        self.problems.push(why.into());
        self
    }
}

fn home() -> PathBuf {
    env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

/// First candidate that exists on disk, else the bare program name (resolved via PATH).
fn locate(var: &str, candidates: &[PathBuf], fallback: &str) -> PathBuf {
    if let Some(p) = env::var_os(var) {
        return PathBuf::from(p);
    }
    candidates.iter().find(|p| p.exists()).cloned().unwrap_or_else(|| PathBuf::from(fallback))
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn sumo_bin(name: &str) -> PathBuf {
    let dir = locate("GRAF_SUMO_BIN", &[home().join("tools/sumo-venv/bin"), PathBuf::from("/tools/sumo-venv/bin")], "");
    if dir.as_os_str().is_empty() { PathBuf::from(exe(name)) } else { dir.join(exe(name)) }
}

fn sumo_home() -> Option<PathBuf> {
    if let Some(p) = env::var_os("SUMO_HOME") {
        return Some(PathBuf::from(p));
    }
    let lib = home().join("tools/sumo-venv/lib");
    fs::read_dir(&lib).ok()?.flatten().map(|e| e.path().join("site-packages/sumo")).find(|p| p.exists())
}

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

fn run(cmd: &mut Command) -> Result<(Output, String), String> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    let out = cmd.output().map_err(|e| format!("Не удалось запустить {program}: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok((out, text))
}

/// Number after `key` on the first line that contains it, e.g. "Inserted: 600".
fn number_after(text: &str, key: &str) -> Option<f64> {
    text.lines().find_map(|l| {
        let rest = l.split_once(key)?.1.trim_start_matches([':', ' ']);
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        num.parse().ok()
    })
}

/// SUMO prints each warning a few times, then "Warning: N total messages of type: ...".
fn count_messages(log: &str, needle: &str) -> f64 {
    let total = log.lines().filter(|l| l.contains(needle) && l.contains("total messages")).find_map(|l| {
        l.trim_start_matches("Warning: ").split_whitespace().next()?.parse::<f64>().ok()
    });
    total.unwrap_or_else(|| log.lines().filter(|l| l.contains(needle)).count() as f64)
}

pub fn matsim_source(app: &tauri::AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("matsim-check/OsmCheck.java"));
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools/matsim-check/OsmCheck.java");
    bundled.filter(|p| p.exists()).unwrap_or(dev)
}

pub fn run_all(osm_text: &str, matsim_java: PathBuf) -> Result<Report, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = env::temp_dir().join(format!("graf-dorog-check-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать {}: {e}", dir.display()))?;
    let osm = dir.join("map.osm");
    fs::write(&osm, osm_text).map_err(|e| e.to_string())?;

    let stages = vec![timed(|| sumo_stage(&dir, &osm)), timed(|| matsim_stage(&dir, &osm, &matsim_java)), timed(|| webots_stage(&dir, &osm))];
    Ok(Report { work_dir: dir.display().to_string(), stages })
}

fn timed(f: impl FnOnce() -> Stage) -> Stage {
    let start = Instant::now();
    let mut stage = f();
    stage.seconds = (start.elapsed().as_secs_f64() * 10.0).round() / 10.0;
    stage
}

fn sumo_stage(dir: &Path, osm: &Path) -> Stage {
    let mut st = Stage::new("SUMO");
    let net = dir.join("map.net.xml");
    // Same switches as OSM WebWizard uses for its network.
    let netconvert = run(Command::new(sumo_bin("netconvert"))
        .arg("--osm-files").arg(osm).arg("-o").arg(&net)
        .args(["--geometry.remove", "--ramps.guess", "--junctions.join", "--tls.guess-signals", "--tls.discard-simple",
            "--tls.join", "--tls.default-type", "actuated", "--roundabouts.guess", "--output.street-names"]));
    let (out, log) = match netconvert {
        Ok(r) => r,
        Err(e) => return st.skip(format!("{e}. Установите SUMO или задайте GRAF_SUMO_BIN.")),
    };
    if !out.status.success() || !net.exists() {
        st.log_tail = tail(&log, 30);
        return st.fail("netconvert не собрал сеть");
    }
    let warnings: Vec<&str> = log.lines().filter(|l| l.starts_with("Warning")).collect();
    st.metric("Предупреждений netconvert", warnings.len());
    for w in &warnings {
        st.problem(w.trim_start_matches("Warning: ").to_string());
    }
    if let Ok(xml) = fs::read_to_string(&net) {
        let edges = xml.matches("<edge id=\"").count() - xml.matches("function=\"internal\"").count();
        st.metric("Рёбер", edges);
        st.metric("Перекрёстков", xml.matches("<junction id=").count() - xml.matches("type=\"internal\"").count());
        st.metric("Светофоров", xml.matches("<tlLogic ").count());
        let dead = xml.matches("type=\"dead_end\"").count();
        st.metric("Тупиков", dead);
    }

    let Some(sh) = sumo_home() else { return st.skip("Не найден SUMO_HOME, randomTrips.py недоступен") };
    let python = sumo_bin("python");
    let python = if python.exists() { python } else { PathBuf::from(if cfg!(windows) { "python" } else { "python3" }) };
    let routes = dir.join("map.rou.xml");
    let trips = run(Command::new(&python).env("SUMO_HOME", &sh)
        .arg(sh.join("tools/randomTrips.py")).arg("-n").arg(&net).arg("-o").arg(dir.join("map.trips.xml"))
        .arg("-r").arg(&routes)
        .args(["-e", TRIPS_END_S, "-p", TRIPS_PERIOD_S, "--validate", "--fringe-factor", "5", "--seed", "42"]));
    let (_, tlog) = match trips {
        Ok(r) => r,
        Err(e) => return st.skip(e),
    };
    let unroutable = count_messages(&tlog, "has no valid route");
    st.metric("Поездок без маршрута", unroutable);
    if unroutable > 0.0 {
        st.warn();
        st.problem(format!("{unroutable} случайных поездок не нашли маршрут: в сети есть рёбра, из которых нельзя доехать до других"));
    }
    if !routes.exists() {
        st.log_tail = tail(&tlog, 30);
        return st.fail("randomTrips не построил маршруты");
    }

    let sim = run(Command::new(sumo_bin("sumo")).env("SUMO_HOME", &sh)
        .arg("-n").arg(&net).arg("-r").arg(&routes)
        .args(["--end", SIM_END_S, "--no-step-log", "--duration-log.statistics", "--time-to-teleport", "300", "--collision.action", "warn"]));
    let (_, slog) = match sim {
        Ok(r) => r,
        Err(e) => return st.skip(e),
    };
    let teleports = number_after(&slog, "Teleports").unwrap_or(0.0);
    let collisions = number_after(&slog, "Collisions").unwrap_or(0.0);
    st.metric("Машин выпущено", number_after(&slog, "Inserted").unwrap_or(0.0));
    st.metric("Телепортаций", teleports);
    st.metric("Столкновений", collisions);
    if let Some(v) = number_after(&slog, "Speed") {
        st.metric("Средняя скорость, км/ч", format!("{:.1}", v * 3.6));
    }
    if let Some(v) = number_after(&slog, "WaitingTime") {
        st.metric("Среднее ожидание, с", format!("{v:.1}"));
    }
    for l in slog.lines().filter(|l| l.contains("Teleporting vehicle") || l.contains("collision")) {
        st.problem(l.trim_start_matches("Warning: ").to_string());
    }
    if teleports > 0.0 || collisions > 0.0 {
        st.warn();
    }
    st.log_tail = tail(&slog, 20);
    st
}

fn matsim_stage(dir: &Path, osm: &Path, source: &Path) -> Stage {
    let mut st = Stage::new("MATSim");
    let mdir = locate("GRAF_MATSIM_DIR", &[home().join("tools/matsim/matsim-2026.0")], "");
    let jar = mdir.join("matsim-2026.0.jar");
    if !jar.exists() {
        return st.skip("Не найден MATSim 2026.0. Задайте GRAF_MATSIM_DIR.");
    }
    let java = locate("GRAF_JAVA", &[PathBuf::from("/opt/homebrew/opt/openjdk/bin/java")], "java");
    let sep = if cfg!(windows) { ";" } else { ":" };
    let cp = format!("{}{sep}{}", jar.display(), mdir.join("libs").join("*").display());
    let res = run(Command::new(&java).arg("-cp").arg(cp).arg(source).arg(osm).arg(dir.join("matsim-network.xml")));
    let (_, log) = match res {
        Ok(r) => r,
        Err(e) => return st.skip(format!("{e}. Нужна Java 25+, задайте GRAF_JAVA.")),
    };
    let Some(json) = log.lines().find_map(|l| l.strip_prefix("RESULT ")) else {
        st.log_tail = tail(&log, 30);
        return st.fail("OsmNetworkReader не построил сеть");
    };
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(e) => return st.fail(format!("Неожиданный вывод MATSim: {e}")),
    };
    st.metric("Узлов", &v["nodes"]);
    st.metric("Линков", &v["links"]);
    st.metric("Длина сети, км", v["lengthKm"].as_f64().unwrap_or(0.0));
    let removed = v["removedByCleaner"].as_array().map(Vec::len).unwrap_or(0);
    st.metric("Отрезано NetworkCleaner", removed);
    if removed > 0 {
        st.warn();
        st.problem(format!(
            "{removed} линков не входят в сильно связную часть сети: агенты MATSim по ним не поедут. Обычно это тупик или неверный oneway."
        ));
    }
    for key in ["zeroCapacity", "zeroSpeed"] {
        if v[key].as_u64().unwrap_or(0) > 0 {
            st.warn();
            st.problem(format!("Линков с нулевой {}: {}", if key == "zeroSpeed" { "скоростью" } else { "пропускной способностью" }, v[key]));
        }
    }
    st
}

fn webots_stage(dir: &Path, osm: &Path) -> Stage {
    let mut st = Stage::new("Webots");
    let importer = locate(
        "GRAF_WEBOTS_IMPORTER",
        &[
            PathBuf::from("/Applications/Webots.app/Contents/Resources/osm_importer/importer.py"),
            PathBuf::from(r"C:\Program Files\Webots\resources\osm_importer\importer.py"),
        ],
        "",
    );
    if !importer.exists() {
        return st.skip("Не найден импортёр Webots. Задайте GRAF_WEBOTS_IMPORTER.");
    }
    let python = locate("GRAF_WEBOTS_PYTHON", &[home().join("tools/webots-venv/bin/python")], if cfg!(windows) { "python" } else { "python3" });
    let world = dir.join("map.wbt");
    let res = run(Command::new(&python)
        .current_dir(importer.parent().unwrap_or(Path::new(".")))
        .arg(&importer).arg("--input").arg(osm).arg("--output").arg(&world));
    let (out, log) = match res {
        Ok(r) => r,
        Err(e) => return st.skip(e),
    };
    if !out.status.success() || !world.exists() {
        st.log_tail = tail(&log, 30);
        let hint = if log.contains("ModuleNotFoundError") { " (не хватает модулей Python: pyproj, shapely, webcolors)" } else { "" };
        return st.fail(format!("Импортёр Webots завершился с ошибкой{hint}"));
    }
    for (label, key) in [("Дорог", "roads generated"), ("Перекрёстков", "crossroads generated"), ("Зданий", "buildings generated")] {
        let n = log.lines().find(|l| l.contains(key)).and_then(|l| l.split_whitespace().nth(1)).unwrap_or("0");
        st.metric(label, n);
    }
    for l in log.lines().filter(|l| l.to_lowercase().contains("error") || l.contains("Traceback")) {
        st.warn();
        st.problem(l.to_string());
    }
    st.log_tail = tail(&log, 12);
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_after_reads_sumo_statistics() {
        let log = "Statistics (avg of 599):\n Speed: 11.51\n Teleports: 3 (Jam: 2)\n Inserted: 600";
        assert_eq!(number_after(log, "Speed"), Some(11.51));
        assert_eq!(number_after(log, "Teleports"), Some(3.0));
        assert_eq!(number_after(log, "Inserted"), Some(600.0));
        assert_eq!(number_after(log, "Collisions"), None);
        let trips = "Warning: The vehicle 'a' has no valid route.\nWarning: 134 total messages of type: The vehicle '%' has no valid route.";
        assert_eq!(count_messages(trips, "has no valid route"), 134.0);
    }

    /// Runs the real tools on the task example; skipped when they are not installed.
    #[test]
    #[ignore]
    fn example_passes_pipeline() {
        let osm = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/test/example.osm")).unwrap();
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools/matsim-check/OsmCheck.java");
        let report = run_all(&osm, src).unwrap();
        for s in &report.stages {
            println!("{} {:?} {:?} {:?}", s.name, s.seconds, s.metrics, s.problems.first());
            assert!(s.status != Status::Fail, "{} failed: {:?}\n{}", s.name, s.problems, s.log_tail);
        }
    }
}
