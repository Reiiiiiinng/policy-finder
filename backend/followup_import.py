"""Inspect and stage explicit legacy browser exports without binding or changing live rows."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
MAX_EXPORT = 32 * 1024 * 1024
FORMAT = "policy-finder-legacy-export-v1"
APP_ID = 0x50464D35
FOLLOWUP_PREFIX = "pf_phase4_followup_v1_b:"
ALLOWED = {
    "local": re.compile(r"(?:pf_phase4_followup_v1_b:.+|pf_saved_b)"),
    "session": re.compile(r"(?:policy_finder_session|pf_verify_records_v1_b|pf_prep_v1_b(?:_.+)?|pf_fs_b_.+)"),
    "history": re.compile(r"(?:pfQuery|pfSemanticResult|pfPolicyBatch)"),
}
CATALOGUES = (
    ROOT / "data" / "guangzhou_elderly_policy_v1.1.json",
    ROOT / "data" / "foshan_medical_assistance_v1.json",
)


class MigrationError(Exception):
    """A rejected backup or staging operation."""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def utf16(text):
    return text.encode("utf-16le", errors="surrogatepass")


def distinct_fields(pairs):
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError("JSON contains a repeated property")
    return value


def parse(raw):
    return json.loads(raw, object_pairs_hook=distinct_fields)


@dataclass(frozen=True)
class Bundle:
    fingerprint: str
    file_hash: str
    source: bytes
    metadata: dict


def load_bundle(path):
    with path.open("rb") as stream:
        source = stream.read(MAX_EXPORT + 1)
    if len(source) > MAX_EXPORT:
        raise MigrationError("Export is larger than 32 MiB. Preserve the original for manual handling.")
    try:
        metadata = parse(source)
        if not isinstance(metadata, dict) or metadata.get("format") != FORMAT:
            raise ValueError("Invalid format")
        origin = urlsplit(metadata["origin"])
        if (origin.scheme not in ("http", "https") or origin.hostname not in ("localhost", "127.0.0.1", "::1")
                or origin.username is not None or origin.password is not None
                or origin.path or origin.query or origin.fragment or origin.port == 0):
            raise ValueError("Invalid source origin")
        if not all(isinstance(metadata.get(key), str) and 0 < len(metadata[key]) <= 160
                   for key in ("label", "captured_at")):
            raise ValueError("Invalid export metadata")
        entries = metadata["entries"]
        if not isinstance(entries, list) or not entries:
            raise ValueError("No exported entries")
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"area", "key", "raw", "sha256"}:
                raise ValueError("Invalid export entry")
            area, key, raw, digest = (entry[field] for field in ("area", "key", "raw", "sha256"))
            if not all(isinstance(field, str) for field in (area, key, raw, digest)):
                raise ValueError("Invalid export entry type")
            if (area not in ALLOWED or not ALLOWED[area].fullmatch(key) or (area, key) in seen
                    or digest != sha256(utf16(raw))):
                raise ValueError("Unknown, repeated or corrupt export entry")
            seen.add((area, key))
    except (KeyError, TypeError, ValueError, RecursionError) as error:
        raise MigrationError("Invalid export manifest or checksum. Preserve the original file.") from error
    keys = sorted((entry["area"], entry["key"], entry["sha256"]) for entry in entries)
    fingerprint = sha256(json_text([metadata["origin"], metadata["label"], keys]).encode())
    return Bundle(fingerprint, sha256(source), source, metadata)


def rows(value):
    return value if isinstance(value, list) else []


def fields(value):
    return value if isinstance(value, dict) else {}


def catalogues():
    policy_regions = {}
    hashes = {}
    for path in CATALOGUES:
        raw = path.read_bytes()
        catalogue = parse(raw)
        hashes[path.name] = sha256(raw)
        for policy in catalogue["policies"]:
            policy_regions[policy["policy_id"]] = catalogue["region"]
    return policy_regions, hashes


class Inventory:
    def __init__(self, policy_regions):
        self.policy_regions = policy_regions
        self.counts = Counter()
        self.issues = Counter()
        self.references = []
        self.index = defaultdict(set)
        self.bundle = ""

    def add(self, kind, identifier=None, *, query=None, plan=None, policy=None, relation=None, region=None):
        self.counts[kind] += 1
        if not isinstance(identifier, str) and identifier is not None:
            self.issues["invalid_identifier"] += 1
        if isinstance(identifier, str):
            identity = (kind, identifier)
            self.index[identity].add(self.bundle)
        if isinstance(policy, str) and policy not in self.policy_regions:
            self.issues["unknown_policy_id"] += 1
        elif isinstance(policy, str) and region and self.policy_regions[policy] != region:
            self.issues["policy_region_mismatch"] += 1
        self.references.append({
            "bundle": self.bundle, "kind": kind, "id": identifier, "query_id": query,
            "plan_id": plan, "policy_id": policy, "legacy_relation": relation,
        })

    def followup(self, key_query, value):
        if not isinstance(value, dict):
            self.issues["invalid_followup_document_preserved"] += 1
            return
        value = fields(value)
        query = value.get("queryId")
        region = value.get("region")
        relation = value.get("member")
        self.add("followup_query", query, query=key_query, relation=relation)
        self.issues["member_mapping_required"] += 1
        if key_query != query:
            self.issues["query_link_mismatch"] += 1
        for policy, item in fields(value.get("items")).items():
            item = fields(item)
            self.add("intent", policy, query=query, policy=policy, relation=relation, region=region)
            if item.get("id") != policy:
                self.issues["policy_link_mismatch"] += 1
            for event in rows(item.get("changes")):
                self.add("verification_event", query=query, plan=fields(event).get("planId"), policy=policy, relation=relation)
        for plan_id, plan in fields(value.get("plans")).items():
            plan = fields(plan)
            self.add("plan", plan_id, query=query, plan=plan_id, relation=relation)
            if plan.get("id") != plan_id or plan.get("queryId") != query:
                self.issues["plan_link_mismatch"] += 1
            policy_ids = {pid for pid in rows(plan.get("ids")) if isinstance(pid, str)}
            task_rows = rows(plan.get("tasks"))
            task_ids = {fields(task).get("policyId") for task in task_rows
                        if isinstance(fields(task).get("policyId"), str)}
            if policy_ids != task_ids or len(task_rows) != len(task_ids):
                self.issues["plan_task_mismatch"] += 1
            for task in task_rows:
                self.add("task", query=query, plan=plan_id, policy=fields(task).get("policyId"), region=region)
            for entry in rows(plan.get("consultations")):
                entry = fields(entry)
                pid = entry.get("pid")
                self.add("consultation", entry.get("id"), query=query, plan=plan_id, policy=pid, region=region)
                if (entry.get("planId") != plan_id or entry.get("queryId") != query
                        or not isinstance(pid, str) or pid not in policy_ids):
                    self.issues["consultation_link_mismatch"] += 1
            for pid in fields(plan.get("prepared")):
                self.add("policy_preparation", query=query, plan=plan_id, policy=pid, region=region)
            for pid, checks in fields(plan.get("preparation")).items():
                for _ in fields(checks):
                    self.add("task_preparation", query=query, plan=plan_id, policy=pid, region=region)

    def capture(self, bundle):
        self.bundle = bundle.fingerprint
        for entry in bundle.metadata["entries"]:
            key, raw, area = entry["key"], entry["raw"], entry["area"]
            if key.startswith("pf_fs_b_"):
                pid, marker, relation = key.removeprefix("pf_fs_b_").partition("@")
                self.add("legacy_checklist_marker", policy=pid, relation=relation if marker else None)
                continue
            try:
                value = parse(raw)
            except (ValueError, RecursionError):
                self.issues["unparsed_value_preserved"] += 1
                continue
            if key.startswith(FOLLOWUP_PREFIX):
                if "pending" in fields(value):
                    self.issues["legacy_pending_preserved"] += 1
                self.followup(key.removeprefix(FOLLOWUP_PREFIX), fields(value).get("data"))
            elif key == "policy_finder_session":
                value = fields(value)
                for name in ("profile", "selfProfile"):
                    profile = fields(value.get(name))
                    if profile:
                        query = fields(profile.get("uiForm")).get("followupQueryId")
                        self.add("query_profile", query, query=query, relation=value.get("beneficiary") if name == "profile" else None)
                for query, snapshot in fields(value.get("phase4Followup")).items():
                    self.followup(query, snapshot)
            elif key == "pf_verify_records_v1_b":
                for entry in rows(value):
                    entry = fields(entry)
                    self.add("legacy_verification", entry.get("rid"), policy=entry.get("pid"), relation=entry.get("benKey"))
                    self.issues["member_mapping_required"] += 1
                    self.counts["legacy_verification_history"] += len(rows(entry.get("history")))
            elif key == "pf_saved_b":
                for entry in rows(value):
                    self.add("legacy_favorite", policy=fields(entry).get("id"))
            elif key.startswith("pf_prep_v1_b"):
                self.add("legacy_preparation", relation=key.removeprefix("pf_prep_v1_b").removeprefix("_") or None)
            elif area == "history":
                self.add("history_projection", key)

    def report(self, bundles, policy_hashes):
        for bundle in bundles:
            self.capture(bundle)
        repetitions = Counter(kind for (kind, _), snapshots in self.index.items() if len(snapshots) > 1)
        return {
            "source_bundles": len(bundles), "source_entries": sum(len(b.metadata["entries"]) for b in bundles),
            "counts": dict(self.counts), "issues": dict(self.issues), "id_seen_in_multiple_exports": dict(repetitions),
            "references": self.references, "catalogue_sha256": policy_hashes,
            "authority_imported": 0, "cutover_allowed": False,
        }


def report_for(bundles):
    policy_regions, policy_hashes = catalogues()
    return Inventory(policy_regions).report(bundles, policy_hashes)


def private_destination(path):
    path = path.resolve()
    if path.is_relative_to(ROOT / "frontend"):
        raise MigrationError("Backup and staging output must be outside the public frontend directory.")
    return path


def write_report(path, report):
    with private_destination(path).open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=True, indent=2)


def verify_backup(database, backup_path, restore_path):
    from followup_db import backup, check_integrity, restore

    if not database.is_file():
        raise MigrationError("The existing authority database was not found.")
    for path in (backup_path, restore_path):
        if path.exists():
            raise MigrationError("Backup and rehearsal restore must use new paths.")
    backup(database, backup_path)
    restore(backup_path, restore_path)
    if not all(check_integrity(path)["ok"] for path in (backup_path, restore_path)):
        raise MigrationError("Backup or rehearsal restore failed the integrity and foreign-key checks.")
    fingerprints = []
    for path in (backup_path, restore_path):
        digest = hashlib.sha256()
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as connection:
            for line in connection.iterdump():
                digest.update(line.encode())
                digest.update(b"\n")
        fingerprints.append(digest.hexdigest())
    if fingerprints[0] != fingerprints[1]:
        raise MigrationError("The rehearsal restore does not match the backup contents.")
    return {"sqlite_logical_sha256": fingerprints[0], "backup_sha256": sha256(backup_path.read_bytes())}


def archive(path, bundles, report, gate):
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        app_id = connection.execute("PRAGMA application_id").fetchone()[0]
        if not app_id:
            if connection.execute("SELECT 1 FROM sqlite_schema LIMIT 1").fetchone():
                raise MigrationError("The staging path points to a database with other data.")
            connection.execute(f"PRAGMA application_id = {APP_ID}")
            connection.execute("PRAGMA user_version = 1")
            connection.execute("""CREATE TABLE exports(
                fingerprint TEXT PRIMARY KEY, file_sha256 TEXT NOT NULL, payload BLOB NOT NULL
            )""")
            connection.execute("""CREATE TABLE rehearsals(
                run_id TEXT PRIMARY KEY, report_json TEXT NOT NULL, backup_json TEXT NOT NULL
            )""")
        if (app_id and app_id != APP_ID) or connection.execute("PRAGMA user_version").fetchone()[0] != 1:
            raise MigrationError("Unrecognized staging database.")
        for bundle in bundles:
            connection.execute("INSERT INTO exports VALUES(?,?,?) ON CONFLICT(fingerprint) DO NOTHING",
                               (bundle.fingerprint, bundle.file_hash, bundle.source))
            file_hash, payload = connection.execute("SELECT file_sha256,payload FROM exports WHERE fingerprint=?",
                                                    (bundle.fingerprint,)).fetchone()
            if sha256(payload) != file_hash:
                raise MigrationError("An archived export failed read-back verification.")
        report_json, gate_json = json_text(report), json_text(gate)
        run_id = sha256((report_json + gate_json).encode())
        connection.execute("INSERT INTO rehearsals VALUES(?,?,?) ON CONFLICT(run_id) DO NOTHING",
                           (run_id, report_json, gate_json))
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise MigrationError("Staging integrity check failed.")


def stage(database, backup_path, restore_path, staging_path, bundles, report):
    database = database.resolve()
    outputs = tuple(map(private_destination, (backup_path, restore_path, staging_path)))
    backup_path, restore_path, staging_path = outputs
    if len({database, *outputs}) != 4:
        raise MigrationError("Database, backup, restore, and staging paths must be distinct.")
    if database.exists() and any(path.exists() and path.samefile(database) for path in outputs):
        raise MigrationError("An output path aliases the existing database.")
    gate = verify_backup(database, backup_path, restore_path)
    archive(staging_path, bundles, report, gate)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("dry-run", "stage"):
        subparser = commands.add_parser(name)
        subparser.add_argument("exports", type=Path, nargs="+")
        subparser.add_argument("--report", type=Path)
        if name == "stage":
            for flag in ("database", "backup", "restore-check", "staging"):
                subparser.add_argument("--" + flag, type=Path, required=True)
    args = parser.parse_args()
    try:
        bundles = [load_bundle(path) for path in args.exports]
        bundles = list({bundle.fingerprint: bundle for bundle in bundles}.values())
        report = report_for(bundles)
        if args.command == "stage":
            stage(args.database, args.backup, args.restore_check, args.staging, bundles, report)
        if args.report:
            write_report(args.report, report)
        print(json_text({key: value for key, value in report.items() if key != "references"}))
    except (MigrationError, OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f"Migration stopped: {error}\n")


if __name__ == "__main__":
    main()
