"""Local follow-up store. Policy catalogues and the browser schema are separate."""
import argparse
from contextlib import closing, contextmanager
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "policy-finder.db"
LOCAL_USER_ID = "eea50495-6bd8-5bce-90e6-874e1d7b1125"
SELF_MEMBER_ID = "de732bc0-6cb8-5e28-a00c-6fed94efcc92"
APPLICATION_ID = 0x50464655  # PFFU
BUSY_SECONDS = 5
MIGRATIONS = (
    """
    CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE members (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        relationship TEXT NOT NULL,
        archived_at INTEGER,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (id, user_id)
    );
    CREATE UNIQUE INDEX members_one_self ON members(user_id) WHERE relationship = 'self';
    CREATE TABLE queries (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        actor_member_id TEXT NOT NULL,
        region TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('self', 'family')),
        structured_json TEXT NOT NULL CHECK (json_valid(structured_json)),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (member_id, user_id) REFERENCES members(id, user_id),
        FOREIGN KEY (actor_member_id, user_id) REFERENCES members(id, user_id),
        CHECK ((mode = 'self' AND member_id = actor_member_id)
            OR (mode = 'family' AND member_id <> actor_member_id)),
        UNIQUE (id, user_id, member_id, region)
    );
    CREATE INDEX queries_member ON queries(user_id, member_id, created_at);
    CREATE TABLE policy_records (
        policy_id TEXT NOT NULL,
        region TEXT NOT NULL,
        policy_version TEXT,
        policy_name TEXT NOT NULL,
        source_json TEXT NOT NULL CHECK (json_valid(source_json)),
        PRIMARY KEY (policy_id, region)
    );
    CREATE TABLE cases (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        region TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        intent TEXT NOT NULL CHECK (intent IN ('verify', 'later', 'notmatch')),
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'preparing', 'consulted', 'applicable', 'inapplicable', 'deferred', 'completed')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (member_id, user_id) REFERENCES members(id, user_id),
        FOREIGN KEY (policy_id, region) REFERENCES policy_records(policy_id, region),
        UNIQUE (user_id, member_id, region, policy_id)
    );
    CREATE TABLE case_sources (
        case_id TEXT NOT NULL REFERENCES cases(id),
        query_id TEXT NOT NULL REFERENCES queries(id),
        origin TEXT,
        conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json)),
        policy_version TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (case_id, query_id)
    );
    CREATE INDEX case_sources_query ON case_sources(query_id, case_id);
    CREATE TABLE plans (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        region TEXT NOT NULL,
        query_id TEXT,
        from_route TEXT,
        advice_json TEXT CHECK (advice_json IS NULL OR json_valid(advice_json)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (member_id, user_id) REFERENCES members(id, user_id),
        FOREIGN KEY (query_id, user_id, member_id, region)
            REFERENCES queries(id, user_id, member_id, region)
    );
    CREATE INDEX plans_member ON plans(user_id, member_id, updated_at);
    CREATE TABLE plan_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        case_id TEXT NOT NULL REFERENCES cases(id),
        requirements_json TEXT NOT NULL CHECK (json_valid(requirements_json)),
        removed_at INTEGER,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (plan_id, case_id),
        UNIQUE (id, plan_id, case_id)
    );
    CREATE INDEX plan_tasks_case ON plan_tasks(case_id, plan_id);
    CREATE TABLE case_events (
        id TEXT PRIMARY KEY NOT NULL,
        case_id TEXT NOT NULL REFERENCES cases(id),
        query_id TEXT REFERENCES queries(id),
        plan_id TEXT,
        actor_member_id TEXT REFERENCES members(id),
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (plan_id, case_id) REFERENCES plan_tasks(plan_id, case_id)
    );
    CREATE INDEX case_events_case ON case_events(case_id, created_at);
    CREATE TABLE consultations (
        id TEXT PRIMARY KEY NOT NULL,
        case_id TEXT NOT NULL REFERENCES cases(id),
        plan_id TEXT,
        task_id TEXT,
        query_id TEXT REFERENCES queries(id),
        form_json TEXT NOT NULL CHECK (json_valid(form_json)),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (plan_id, case_id) REFERENCES plan_tasks(plan_id, case_id),
        FOREIGN KEY (task_id, plan_id, case_id) REFERENCES plan_tasks(id, plan_id, case_id),
        CHECK (task_id IS NULL OR plan_id IS NOT NULL)
    );
    CREATE INDEX consultations_case ON consultations(case_id, created_at);
    CREATE INDEX consultations_plan ON consultations(plan_id, created_at);
    CREATE TABLE preparations (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES plan_tasks(id),
        evidence_key TEXT NOT NULL,
        checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (task_id, evidence_key)
    );
    CREATE TABLE operations (
        user_id TEXT NOT NULL REFERENCES users(id),
        operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL CHECK (json_valid(response_json)),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, operation_id)
    );

    CREATE VIEW verification_queue AS SELECT * FROM cases WHERE intent = 'verify';
    CREATE VIEW saved_policies AS SELECT * FROM cases WHERE intent = 'later';
    """,
    """
    ALTER TABLE case_sources ADD COLUMN policy_source_json TEXT
        CHECK (policy_source_json IS NULL OR json_valid(policy_source_json));
    """,
    """
    ALTER TABLE plan_tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'preparing', 'consulted', 'applicable', 'inapplicable', 'deferred', 'completed'));
    UPDATE plan_tasks SET status = COALESCE((
        SELECT value FROM case_events
        WHERE case_events.plan_id = plan_tasks.plan_id AND case_events.case_id = plan_tasks.case_id AND kind = 'status'
        ORDER BY created_at DESC, rowid DESC LIMIT 1
    ), 'pending');
    """,
    """
    CREATE TABLE favorites (
        user_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        region TEXT NOT NULL,
        saved_at INTEGER,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        PRIMARY KEY (user_id, member_id, region, policy_id),
        FOREIGN KEY (member_id, user_id) REFERENCES members(id, user_id),
        FOREIGN KEY (policy_id, region) REFERENCES policy_records(policy_id, region)
    );
    """,
    """
    CREATE TABLE query_history (
        query_id TEXT PRIMARY KEY REFERENCES queries(id),
        root_id TEXT NOT NULL REFERENCES queries(id),
        version INTEGER NOT NULL CHECK (version >= 1),
        CHECK ((version = 1) = (query_id = root_id)),
        UNIQUE (root_id, version)
    );
    INSERT INTO query_history SELECT id, id, 1 FROM queries;
    CREATE TRIGGER query_history_register AFTER INSERT ON queries
    BEGIN INSERT INTO query_history VALUES (NEW.id, NEW.id, 1); END;
    CREATE TRIGGER query_history_scope BEFORE UPDATE ON query_history
    WHEN NOT EXISTS (
        SELECT 1 FROM queries q JOIN queries root USING (user_id, member_id, actor_member_id, mode)
        WHERE q.id=NEW.query_id AND root.id=NEW.root_id
    )
    BEGIN SELECT RAISE(ABORT, 'Query history scope mismatch'); END;
    CREATE TABLE query_archives (
        root_id TEXT PRIMARY KEY REFERENCES query_history(query_id),
        archived_at INTEGER NOT NULL
    );
    CREATE TRIGGER query_archive_root BEFORE INSERT ON query_archives
    WHEN NOT EXISTS (SELECT 1 FROM query_history WHERE query_id=NEW.root_id AND version=1)
    BEGIN SELECT RAISE(ABORT, 'Only an original query can be archived'); END;
    CREATE TABLE query_snapshots (
        query_id TEXT PRIMARY KEY REFERENCES query_history(query_id),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        form_json TEXT NOT NULL CHECK (json_valid(form_json)),
        created_at INTEGER NOT NULL
    );
    CREATE TRIGGER query_snapshot_immutable BEFORE UPDATE ON query_snapshots
    BEGIN SELECT RAISE(ABORT, 'Query result snapshots are immutable'); END;
    CREATE TABLE query_assessments (
        query_id TEXT NOT NULL REFERENCES query_snapshots(query_id),
        attempt INTEGER NOT NULL CHECK (attempt >= 1),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (query_id, attempt)
    );
    CREATE TRIGGER query_assessment_immutable BEFORE UPDATE ON query_assessments
    BEGIN SELECT RAISE(ABORT, 'Query assessment snapshots are immutable'); END;
    CREATE TABLE query_plan_sources (
        plan_id TEXT NOT NULL REFERENCES plans(id),
        query_id TEXT NOT NULL REFERENCES queries(id),
        PRIMARY KEY (plan_id, query_id)
    );
    CREATE INDEX query_plan_sources_query ON query_plan_sources(query_id, plan_id);
    CREATE TRIGGER query_plan_source_scope BEFORE INSERT ON query_plan_sources
    WHEN NOT EXISTS (
        SELECT 1 FROM plans p JOIN queries q USING (user_id, member_id, region)
        WHERE p.id=NEW.plan_id AND q.id=NEW.query_id
    )
    BEGIN SELECT RAISE(ABORT, 'Query plan scope mismatch'); END;
    INSERT INTO query_plan_sources SELECT id, query_id FROM plans WHERE query_id IS NOT NULL;
    CREATE TRIGGER query_plan_source_register AFTER INSERT ON plans
    WHEN NEW.query_id IS NOT NULL
    BEGIN INSERT INTO query_plan_sources VALUES (NEW.id, NEW.query_id); END;
    """,
    """
    ALTER TABLE plans ADD COLUMN paused_at INTEGER;
    ALTER TABLE plans ADD COLUMN pause_reason TEXT;
    CREATE TABLE household_drafts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, member_id TEXT NOT NULL,
        scenario TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        data TEXT NOT NULL, FOREIGN KEY (member_id,user_id) REFERENCES members(id,user_id)
    );
    CREATE INDEX household_draft_scope ON household_drafts(user_id,member_id,scenario,updated_at);
    """,
)
SCHEMA_VERSION = len(MIGRATIONS)


_preview_database = None


def bind_preview_database(path):
    global _preview_database
    resolved = db_path(path)
    if not resolved.is_file() or (_preview_database is not None and _preview_database != resolved):
        raise ValueError("Preview requires one existing database for the lifetime of the process.")
    _preview_database = resolved


def db_path(path=None):
    configured = path if path is not None else _preview_database or os.environ.get("PF_FOLLOWUP_DB") or DEFAULT_DB_PATH
    resolved = Path(configured).expanduser().resolve()
    temp = Path(tempfile.gettempdir()).resolve()
    if (resolved.is_relative_to(ROOT / "frontend")
            or not (resolved.is_relative_to(ROOT) or resolved.is_relative_to(temp))
            or resolved.suffix.lower() not in {".db", ".sqlite", ".sqlite3"}):
        raise ValueError("Follow-up database files must be private SQLite files in the preview or temporary directory.")
    return resolved


@contextmanager
def connect(path=None, *, readonly=False):
    resolved = db_path(path)
    # mode=rw avoids silently creating a database in a request before startup validation.
    mode = "ro" if readonly else "rw"
    with closing(sqlite3.connect(f"{resolved.as_uri()}?mode={mode}", uri=True,
                                 timeout=BUSY_SECONDS, isolation_level=None)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        yield db


@contextmanager
def transaction(path=None, *, write=False):
    with connect(path, readonly=not write) as db:
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise


def _execute_migration(db, sql):
    # executescript can implicitly commit an open transaction in sqlite3.
    statement = ""
    for line in sql.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            db.execute(statement)
            statement = ""
    if statement.strip():
        raise ValueError("Incomplete follow-up database migration.")


def _scope_constraints(db):
    def matching_query():
        return """SELECT 1 FROM cases AS c JOIN queries AS q
                  USING (user_id, member_id, region)
                  WHERE c.id = NEW.case_id AND q.id = NEW.query_id"""

    rules = (
        ("case_sources", "case_id, query_id", f"NOT EXISTS ({matching_query()})"),
        ("plan_tasks", "case_id, plan_id", """NOT EXISTS (
            SELECT 1 FROM cases AS c JOIN plans AS p USING (user_id, member_id, region)
            WHERE c.id = NEW.case_id AND p.id = NEW.plan_id)"""),
        ("consultations", "case_id, query_id",
         f"NEW.query_id IS NOT NULL AND NOT EXISTS ({matching_query()})"),
        ("case_events", "case_id, query_id, actor_member_id", f"""
            (NEW.query_id IS NOT NULL AND NOT EXISTS ({matching_query()}))
            OR (NEW.actor_member_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM cases AS c JOIN members AS m USING (user_id)
                WHERE c.id = NEW.case_id AND m.id = NEW.actor_member_id))"""),
    )
    for table, columns, invalid in rules:
        for name, event in (("insert", "INSERT"), ("update", f"UPDATE OF {columns}")):
            db.execute(f"""
                CREATE TRIGGER {table}_scope_{name} BEFORE {event} ON {table}
                WHEN {invalid}
                BEGIN SELECT RAISE(ABORT, 'Follow-up data scope mismatch'); END
            """)


def initialize(path=None):
    """Initialize and migrate explicitly at opt-in service startup."""
    resolved = db_path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    # Create without truncating. A second process can safely converge on the same schema.
    resolved.touch(exist_ok=True)
    with transaction(resolved, write=True) as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        application_id = db.execute("PRAGMA application_id").fetchone()[0]
        journal_mode = db.execute("PRAGMA journal_mode").fetchone()[0]
        if journal_mode == "wal":
            raise ValueError("WAL is not enabled for this local preview database.")
        if version > SCHEMA_VERSION:
            raise ValueError("Follow-up database schema is newer than this preview.")
        if version == 0:
            populated = db.execute(
                "SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1"
            ).fetchone()
            if populated or application_id:
                raise ValueError("This is not an empty follow-up database.")
            db.execute(f"PRAGMA application_id = {APPLICATION_ID}")
        elif application_id != APPLICATION_ID:
            raise ValueError("This SQLite file is not a follow-up database.")
        for index in range(version, SCHEMA_VERSION):
            _execute_migration(db, MIGRATIONS[index])
            if index == 0:
                _scope_constraints(db)
                created = time.time_ns() // 1_000_000
                db.execute("INSERT INTO users VALUES (?, '本地使用者', ?)", (LOCAL_USER_ID, created))
                db.execute(
                    """INSERT INTO members(id,user_id,name,relationship,created_at,updated_at)
                       VALUES (?, ?, '本人', 'self', ?, ?)""",
                    (SELF_MEMBER_ID, LOCAL_USER_ID, created, created),
                )
            db.execute(f"PRAGMA user_version = {index + 1}")
    return resolved


def check_integrity(path=None):
    with transaction(path) as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        application_id = db.execute("PRAGMA application_id").fetchone()[0]
        journal_mode = db.execute("PRAGMA journal_mode").fetchone()[0]
        integrity = [row[0] for row in db.execute("PRAGMA integrity_check")]
        foreign_keys = [dict(row) for row in db.execute("PRAGMA foreign_key_check")]
    return {"ok": application_id == APPLICATION_ID and 1 <= version <= SCHEMA_VERSION
            and integrity == ["ok"] and not foreign_keys, "version": version,
            "journal_mode": journal_mode, "integrity": integrity, "foreign_keys": foreign_keys}


def backup(path, destination):
    """Write and verify an online backup in a new file. Never replace a backup."""
    source, target = db_path(path), db_path(destination)
    if not check_integrity(source)["ok"]:
        raise ValueError("Source database did not pass follow-up integrity checks.")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb"):
        pass
    try:
        with connect(source, readonly=True) as original, connect(target) as copy:
            original.backup(copy)
        if not check_integrity(target)["ok"]:
            raise ValueError("Backup database did not pass follow-up integrity checks.")
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return target


def restore(source, destination):
    """Restore to a verified new path, preserving the current data and backup."""
    return backup(source, destination)


def initialize_preview(path=None):
    """Keep a verified pre-upgrade copy before the preview changes an existing schema."""
    source = db_path(path)
    if source.exists() and source.stat().st_size:
        state = check_integrity(source)
        if not state["ok"]:
            raise ValueError("Follow-up database did not pass the pre-upgrade check.")
        if state["version"] < SCHEMA_VERSION:
            backup(source, source.with_name(f"{source.stem}.before-v{SCHEMA_VERSION}-{uuid4().hex}.db"))
    return initialize(source)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check, back up or restore the local follow-up database.")
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="Run integrity and foreign-key checks without writing.")
    check.add_argument("--db", help="Source database. Defaults to PF_FOLLOWUP_DB or the preview database.")
    save = commands.add_parser("backup", help="Copy a verified database into a new file.")
    save.add_argument("destination")
    save.add_argument("--db", help="Source database. Defaults to PF_FOLLOWUP_DB or the preview database.")
    recover = commands.add_parser("restore", help="Restore from a backup into a new file.")
    recover.add_argument("source")
    recover.add_argument("destination")
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            result = check_integrity(args.db)
        else:
            target = backup(args.db, args.destination) if args.command == "backup" else restore(
                args.source, args.destination
            )
            result = {"path": str(target), **check_integrity(target)}
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Follow-up database operation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
