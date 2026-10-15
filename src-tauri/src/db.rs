//! Local SQLite storage for the plan.
//!
//! The interface always works with the whole plan (people, projects, bookings),
//! exactly like the original web version. On every save the plan is written in a
//! single transaction, so the file is never left half-updated.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Plan {
    #[serde(default)]
    pub people: Vec<Person>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub allocs: Vec<Allocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub id: String,
    pub person_id: String,
    pub project_id: String,
    pub start: String,
    pub end: String,
    #[serde(default = "full_load")]
    pub load: i64,
    #[serde(default)]
    pub note: String,
}

fn full_load() -> i64 {
    100
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS people (
                id        TEXT PRIMARY KEY,
                name      TEXT NOT NULL,
                role      TEXT NOT NULL DEFAULT '',
                position  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
                id        TEXT PRIMARY KEY,
                name      TEXT NOT NULL,
                color     TEXT NOT NULL,
                position  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS allocations (
                id          TEXT PRIMARY KEY,
                person_id   TEXT NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
                project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                start_date  TEXT NOT NULL,   -- YYYY-MM-DD, inclusive
                end_date    TEXT NOT NULL,   -- YYYY-MM-DD, inclusive
                load        INTEGER NOT NULL CHECK (load BETWEEN 10 AND 100),
                note        TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS allocations_person  ON allocations(person_id);
            CREATE INDEX IF NOT EXISTS allocations_project ON allocations(project_id);
            ",
        )?;
    }
    if version < SCHEMA_VERSION {
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    Ok(())
}

pub fn load(conn: &Connection) -> rusqlite::Result<Plan> {
    let people = conn
        .prepare("SELECT id, name, role FROM people ORDER BY position")?
        .query_map([], |r| {
            Ok(Person { id: r.get(0)?, name: r.get(1)?, role: r.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let projects = conn
        .prepare("SELECT id, name, color FROM projects ORDER BY position")?
        .query_map([], |r| {
            Ok(Project { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let allocs = conn
        .prepare(
            "SELECT id, person_id, project_id, start_date, end_date, load, note
             FROM allocations ORDER BY start_date, id",
        )?
        .query_map([], |r| {
            Ok(Allocation {
                id: r.get(0)?,
                person_id: r.get(1)?,
                project_id: r.get(2)?,
                start: r.get(3)?,
                end: r.get(4)?,
                load: r.get(5)?,
                note: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Plan { people, projects, allocs })
}

/// Replaces the stored plan with `plan` in one transaction.
pub fn save(conn: &mut Connection, plan: &Plan) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM allocations", [])?;
    tx.execute("DELETE FROM people", [])?;
    tx.execute("DELETE FROM projects", [])?;
    {
        let mut ins = tx.prepare("INSERT INTO people (id, name, role, position) VALUES (?1, ?2, ?3, ?4)")?;
        for (i, p) in plan.people.iter().enumerate() {
            ins.execute(params![p.id, p.name, p.role, i as i64])?;
        }
        let mut ins = tx.prepare("INSERT INTO projects (id, name, color, position) VALUES (?1, ?2, ?3, ?4)")?;
        for (i, p) in plan.projects.iter().enumerate() {
            ins.execute(params![p.id, p.name, p.color, i as i64])?;
        }
        let mut ins = tx.prepare(
            "INSERT INTO allocations (id, person_id, project_id, start_date, end_date, load, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for a in &plan.allocs {
            ins.execute(params![a.id, a.person_id, a.project_id, a.start, a.end, a.load, a.note])?;
        }
    }
    tx.commit()
}

const PALETTE: [&str; 10] = [
    "#3366CC", "#1F9E89", "#D9822B", "#B83280", "#6B5BD6",
    "#2F855A", "#C53030", "#2B6CB0", "#B7791F", "#4A5568",
];

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Cleans up a plan coming from the interface or from an imported file:
/// drops duplicates and bookings that point at missing people/projects or have
/// bad dates, swaps reversed dates, and keeps the load between 10 and 100%.
pub fn sanitize(plan: Plan) -> Plan {
    let mut seen = HashSet::new();
    let people: Vec<Person> = plan
        .people
        .into_iter()
        .filter(|p| !p.id.is_empty() && seen.insert(p.id.clone()))
        .map(|p| {
            let name = clip(&p.name, 60);
            Person {
                id: p.id,
                name: if name.is_empty() { "Unnamed".into() } else { name },
                role: clip(&p.role, 60),
            }
        })
        .collect();

    let mut seen = HashSet::new();
    let projects: Vec<Project> = plan
        .projects
        .into_iter()
        .filter(|p| !p.id.is_empty() && seen.insert(p.id.clone()))
        .enumerate()
        .map(|(i, p)| {
            let name = clip(&p.name, 50);
            Project {
                id: p.id,
                name: if name.is_empty() { "Untitled".into() } else { name },
                color: if is_hex_color(&p.color) { p.color } else { PALETTE[i % PALETTE.len()].into() },
            }
        })
        .collect();

    let person_ids: HashSet<&str> = people.iter().map(|p| p.id.as_str()).collect();
    let project_ids: HashSet<&str> = projects.iter().map(|p| p.id.as_str()).collect();
    let mut seen = HashSet::new();
    let allocs: Vec<Allocation> = plan
        .allocs
        .into_iter()
        .filter(|a| {
            !a.id.is_empty()
                && a.id != "__ghost"
                && person_ids.contains(a.person_id.as_str())
                && project_ids.contains(a.project_id.as_str())
                && is_date(&a.start)
                && is_date(&a.end)
                && seen.insert(a.id.clone())
        })
        .map(|mut a| {
            if a.end < a.start {
                std::mem::swap(&mut a.start, &mut a.end);
            }
            a.load = a.load.clamp(10, 100);
            a.note = clip(&a.note, 500);
            a
        })
        .collect();

    Plan { people, projects, allocs }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Plan {
        Plan {
            people: vec![
                Person { id: "p1".into(), name: "Ana".into(), role: "Design".into() },
                Person { id: "p2".into(), name: "Bruno".into(), role: "".into() },
            ],
            projects: vec![Project { id: "j1".into(), name: "Checkout".into(), color: "#3366CC".into() }],
            allocs: vec![Allocation {
                id: "a1".into(),
                person_id: "p2".into(),
                project_id: "j1".into(),
                start: "2026-10-01".into(),
                end: "2026-10-16".into(),
                load: 60,
                note: "x".into(),
            }],
        }
    }

    #[test]
    fn save_and_load_round_trip_keeps_order() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        let mut plan = sample();
        plan.people.reverse();
        save(&mut conn, &plan).unwrap();
        let back = load(&conn).unwrap();
        assert_eq!(back.people[0].id, "p2");
        assert_eq!(back.allocs.len(), 1);
        assert_eq!(back.allocs[0].load, 60);
    }

    #[test]
    fn sanitize_drops_orphans_and_fixes_values() {
        let mut plan = sample();
        plan.allocs.push(Allocation {
            id: "a2".into(), person_id: "nobody".into(), project_id: "j1".into(),
            start: "2026-10-01".into(), end: "2026-10-02".into(), load: 100, note: "".into(),
        });
        plan.allocs.push(Allocation {
            id: "a3".into(), person_id: "p1".into(), project_id: "j1".into(),
            start: "2026-10-09".into(), end: "2026-10-02".into(), load: 400, note: "".into(),
        });
        plan.projects[0].color = "red".into();
        let s = sanitize(plan);
        assert_eq!(s.allocs.len(), 2);
        let a3 = s.allocs.iter().find(|a| a.id == "a3").unwrap();
        assert_eq!((a3.start.as_str(), a3.end.as_str(), a3.load), ("2026-10-02", "2026-10-09", 100));
        assert_eq!(s.projects[0].color, "#3366CC");
    }

    #[test]
    fn imports_the_web_export_format() {
        let json = r##"{"people":[{"id":"p1","name":"Ana","role":""}],
            "projects":[{"id":"j1","name":"X","color":"#112233"}],
            "allocs":[{"id":"a1","personId":"p1","projectId":"j1","start":"2026-10-01","end":"2026-10-03","load":50,"note":""}]}"##;
        let plan: Plan = serde_json::from_str(json).unwrap();
        assert_eq!(sanitize(plan).allocs.len(), 1);
    }
}
