#!/usr/bin/env python3
"""DCS 1b.08: manual proofs for the revision generator and the promotion trigger.

Two things a pgTAP file cannot prove, run by hand against the LOCAL stack:

  python3 scripts/revision-proofs.py red          # every control goes red when broken
  python3 scripts/revision-proofs.py concurrency  # the two locks, with real parallel sessions

WHY THIS EXISTS. pgTAP runs in one transaction on one connection, and a
transaction never races itself. So the two locks — the advisory lock in
dcs.next_revision_code() and the row lock in public.promote_new_revision() — are
asserted in the test files only as text in the function body. That is a shape
check, not a proof. `concurrency` is the proof, and it found two real bugs in
1b.08 that a green pgTAP run had let through (both explained in full in
supabase/migrations/20260920134800_revisions_promote_current.sql):

  * FOR UPDATE on the document row deadlocked two concurrent revisions, because
    the INSERT's own foreign-key check already holds FOR KEY SHARE on that row.
  * A join in the locking SELECT made the row vanish after waiting on the lock,
    because the winning session had changed the column the join used.

NOT WIRED INTO CI, deliberately, like the browser proofs (docs/03-conventions.md):
it needs the local stack and a `docker` binary, and `concurrency` COMMITS rows.

LOCAL ONLY. It talks to the database through `docker exec` into the local
container below, so it cannot reach scl-dev or prod — there is no connection
string in it. Do not "generalise" that.

AFTER `concurrency`, RUN `supabase db reset`. It deletes its documents (and so
their revisions), but public.audit_log keeps the entries the triggers wrote, and
rls_document_register.test.sql counts audit_log rows for project SC2602 — a
polluted database makes its assertion 77 fail (61 rows where it expects 4).
docs/deferred-tasks.md (ss) is the general form of this. `red` leaves nothing
behind: every mutation runs inside the test file's own transaction, which ends
in a ROLLBACK, and the script checks that dcs.revisions is empty afterwards.

HOW `red` WORKS. For each row of MUTATIONS it opens a transaction, applies ONE
deliberately broken variant of a function (its live definition, edited) or
disables a trigger or changes a grant, then runs the named pgTAP file inside that
same transaction. The file's own `rollback` undoes the mutation. A control passes
the proof when the file goes red: at least one `not ok`, or it stops before its
plan is complete (a statement outside pgTAP raised). It exits non-zero if any
mutation leaves its file green — that would mean a control nothing tests.

WHAT `red` DOES NOT PROVE, said so it is not quoted as more than it is:
  * the two locks and the SECURITY DEFINER / INVOKER choice on
    promote_new_revision are caught by shape assertions only. The locks are
    proved by `concurrency`; the DEFINER choice cannot be proved behaviourally
    today (see the migration comment).
  * a mutation is one way to break a control, not all of them.
"""
import re
import subprocess
import sys
import threading
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONTAINER = "supabase_db_Seaclouds_management_system"  # the LOCAL stack, by name
DB = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-tA", "-q"]
GEN = "scl_revision_generator.test.sql"
PROMO = "revision_promotion.test.sql"
PEJ = "6c0909ce-9b74-4bda-8e92-10811ff5a0fc"  # seed project SC2602


def psql(sql):
    r = subprocess.run(DB + ["-c", sql], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


def apply(sql):
    r = subprocess.run(DB + ["-v", "ON_ERROR_STOP=1"], input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"could not apply SQL: {r.stderr.strip()[:400]}")


def fdef(sig):
    out = psql(f"select pg_get_functiondef('{sig}'::regprocedure)")
    if not out.startswith("CREATE OR REPLACE FUNCTION"):
        sys.exit(f"could not read {sig} from the local database ({out[:200]}). Is the stack up and migrated?")
    return out


FUNCS = {
    "next": "dcs.next_revision_code(uuid,uuid)",
    "assign": "public.assign_scl_revision()",
    "void": "public.refuse_revision_on_void_document()",
    "promote": "public.promote_new_revision()",
    "pattern": "dcs.revision_series_pattern(text)",
}
ORIG = {}


def load():
    for k, sig in FUNCS.items():
        ORIG[k] = fdef(sig)


def mutate(key, old, new="", regex=False):
    """The live definition of one function with `old` replaced by `new`, as SQL."""
    body = ORIG[key]
    if regex:
        out, n = re.subn(old, new, body, count=1, flags=re.S)
    else:
        n = body.count(old)
        out = body.replace(old, new, 1)
    if n < 1:
        sys.exit(f"mutation does not match {key}: {old[:70]!r} — the function changed; update this script")
    return out.rstrip() + ";\n"


# (name, setup SQL, test file). The setup is the ONLY difference from the green run.
def mutations():
    N, A, V, P = "next", "assign", "void", "promote"
    lock = r"perform pg_advisory_xact_lock\(.*?::bigint\);"
    return [
        ("next_revision_code: advisory lock removed", mutate(N, lock, "", True), GEN),
        ("next_revision_code: finals count per STEP, not one shared counter",
         mutate(N, "v_steps := array['IFC', 'IFI', 'IFB']", "v_steps := array[v_step_code]"), GEN),
        ("next_revision_code: counter ignores the step",
         mutate(N, "and s.code = any (v_steps)", "and true"), GEN),
        ("next_revision_code: shape filter removed (other formats are counted)",
         mutate(N, "and r.scl_revision ~ v_pattern", ""), GEN),
        ("next_revision_code: IDC ceiling moved past Z",
         mutate(N, "coalesce(v_max, 0) >= 26", "coalesce(v_max, 0) >= 27"), GEN),
        ("next_revision_code: IFR ceiling removed", mutate(N, "if v_max >= 99 then", "if false then"), GEN),
        ("next_revision_code: RETCOM block removed",
         mutate(N, r"if v_step_code = 'RETCOM' then.*?end if;", "", True), GEN),
        ("next_revision_code: SECURITY DEFINER instead of INVOKER",
         "alter function dcs.next_revision_code(uuid,uuid) security definer;", GEN),
        ("next_revision_code: EXECUTE revoked from authenticated",
         "revoke execute on function dcs.next_revision_code(uuid,uuid) from authenticated;", GEN),
        ("next_revision_code: EXECUTE granted to anon",
         "grant execute on function dcs.next_revision_code(uuid,uuid) to anon;", GEN),
        ("revisions_assign_scl_revision trigger disabled",
         "alter table dcs.revisions disable trigger revisions_assign_scl_revision;", GEN),
        ("assign_scl_revision: any signed-in user may supply a code (Document Controller check removed)",
         mutate(A, r"if not public\.is_doc_controller\(new\.project_id\) then.*?end if;", "", True), GEN),
        ("assign_scl_revision: the second factor is not required to supply a code",
         mutate(A, r"if \(\(select auth\.jwt\(\)\) ->> 'aal'\) is distinct from 'aal2' then.*?end if;", "", True), GEN),
        ("assign_scl_revision: a Document Controller's code is not checked against the series",
         mutate(A, "if v_pattern is null or new.scl_revision !~ v_pattern then", "if false then"), GEN),
        ("assign_scl_revision: nobody may supply a code, the DC included (the wrong first version)",
         mutate(A, "  if not public.is_doc_controller(new.project_id) then", "  if true then"), GEN),
        ("revision_series_pattern: IDC accepts two letters",
         mutate("pattern", "'^[A-Z]$'", "'^[A-Z]{1,2}$'"), GEN),
        ("assign_scl_revision: session-less bypass removed",
         mutate(A, r"if auth\.uid\(\) is null then\s+return new;\s+end if;", "", True), GEN),
        ("assign_scl_revision: RETCOM refusal removed",
         mutate(A, r"if v_step_code = 'RETCOM' and not v_import then.*?end if;", "", True), GEN),
        ("assign_scl_revision: RETCOM refused even under import_mode",
         mutate(A, "and not v_import then", "then"), GEN),
        ("assign_scl_revision: SECURITY INVOKER instead of DEFINER",
         "alter function public.assign_scl_revision() security invoker;", GEN),
        ("revisions_refuse_void_document trigger disabled",
         "alter table dcs.revisions disable trigger revisions_refuse_void_document;", GEN),
        ("refuse_revision_on_void_document: import_mode exemption removed",
         mutate(V, r"if coalesce\(current_setting\('dcs\.import_mode', true\), ''\) = 'on' then\s+return new;\s+end if;",
                "", True), GEN),
        ("revisions_promote_current trigger disabled",
         "alter table dcs.revisions disable trigger revisions_promote_current;", PROMO),
        ("promote_new_revision: previous revision is not superseded",
         mutate(P, r"update dcs\.revisions\s+set status_id = v_superseded\s+where id = v_previous\s+and status_id <> v_superseded;",
                "", True), PROMO),
        ("promote_new_revision: every document moves to STARTED, not only NOT_STARTED",
         mutate(P, "if v_status_code = 'NOT_STARTED' then", "if true then"), PROMO),
        ("promote_new_revision: current_revision_id is not set",
         mutate(P, "set current_revision_id = new.id,", "set current_revision_id = current_revision_id,"), PROMO),
        ("promote_new_revision: missing SUPERSEDED row skipped silently",
         mutate(P, r"if v_superseded is null then\s+raise exception.*?end if;",
                "if v_superseded is null then v_previous := null; end if;", True), PROMO),
        ("promote_new_revision: missing STARTED row skipped silently",
         mutate(P, r"if v_started is null then\s+raise exception.*?end if;", "", True), PROMO),
        ("promote_new_revision: SECURITY INVOKER instead of DEFINER [shape assertion only]",
         "alter function public.promote_new_revision() security invoker;", PROMO),
        ("promote_new_revision: document row lock removed [shape assertion only; see `concurrency`]",
         mutate(P, "for no key update;", ";"), PROMO),
    ]


def run_test(setup, testfile):
    sql = "begin;\n" + setup + "\n" + (REPO / "supabase/tests" / testfile).read_text()
    r = subprocess.run(DB, input=sql, capture_output=True, text=True)
    lines = r.stdout.splitlines()
    red = [ln for ln in lines if ln.startswith("not ok")]
    ok = sum(1 for ln in lines if ln.startswith("ok"))
    plan = next((int(ln[3:]) for ln in lines if re.match(r"^1\.\.\d+$", ln)), None)
    died = [ln for ln in (r.stderr + r.stdout).splitlines() if "ERROR:" in ln and "current transaction is aborted" not in ln]
    return ok, red, plan, died


def cmd_red():
    load()
    ok, red, plan, died = run_test("", GEN)
    ok2, red2, plan2, _ = run_test("", PROMO)
    print(f"GREEN control: {GEN} ok={ok} not_ok={len(red)} plan={plan}; {PROMO} ok={ok2} not_ok={len(red2)} plan={plan2}")
    if red or red2 or ok != plan or ok2 != plan2:
        sys.exit("the unmutated run is not green — fix that first, a red proof against a red baseline proves nothing")
    survivors = []
    for name, setup, testfile in mutations():
        ok, red, plan, died = run_test(setup, testfile)
        complete = plan is not None and (ok + len(red)) == plan
        is_red = bool(red) or not complete
        how = f"{len(red)} assertion(s) red" if red else "file stopped before its plan completed"
        print(f"\n### {name}\n    [{testfile}] {'RED — ' + how if is_red else 'STILL GREEN  <<<<<<'}")
        for ln in red[:6]:
            print("      " + ln[:200])
        if len(red) > 6:
            print(f"      … and {len(red) - 6} more")
        if not red and died:
            print("      stopped at: " + died[0][:200])
        if not is_red:
            survivors.append(name)
        left = psql("select count(*) from dcs.revisions")
        if left != "0":
            sys.exit(f"the local database is not clean after a mutation (dcs.revisions has {left} rows)")
    print("\n" + "=" * 60)
    if survivors:
        print("MUTATIONS THAT LEFT THEIR FILE GREEN (an untested control):")
        for s in survivors:
            print("  - " + s)
        sys.exit(1)
    print("every mutation turned its file red")


# ---------------------------------------------------------------- concurrency
def new_doc(title):
    return psql(f"""insert into dcs.documents (project_id,title,doc_type_id,discipline_id,area_id,language_id,workflow_status_id)
      select '{PEJ}','{title}',
        (select id from dcs.dictionaries where dict_type='doc_type' and code='RA'),
        (select id from dcs.dictionaries where dict_type='discipline' and code='A00'),
        (select id from dcs.dictionaries where dict_type='area' and code='00'),
        (select id from dcs.dictionaries where dict_type='language' and code='EN'),
        (select id from dcs.dictionaries where dict_type='workflow_status' and code='NOT_STARTED') returning id;""").split()[0]


def ins(doc, step):
    return (f"insert into dcs.revisions (document_id, project_id, step_id, status_id) select '{doc}', d.project_id,"
            f"(select id from dcs.dictionaries where dict_type='workflow_step' and code='{step}'),"
            f"(select id from dcs.dictionaries where dict_type='workflow_status' and code='{step}') "
            f"from dcs.documents d where d.id='{doc}' returning scl_revision;")


def parallel(jobs):
    out = [None] * len(jobs)

    def work(i, sql):
        out[i] = psql(sql)

    ts = [threading.Thread(target=work, args=(i, s)) for i, s in enumerate(jobs)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return out


def live_check(doc):
    return psql(f"""select 'revisions='||count(*)||'  live(not SUPERSEDED)='||count(*) filter (where s.code<>'SUPERSEDED')||
      '  the live one is the current one='||(count(*) filter (where s.code<>'SUPERSEDED' and r.id=d.current_revision_id) = 1)
      from dcs.revisions r join dcs.dictionaries s on s.id=r.status_id join dcs.documents d on d.id=r.document_id
     where r.document_id='{doc}' group by d.id, d.current_revision_id""")


def cmd_concurrency():
    load()
    sleep_next = mutate("next", "if v_series = 'idc' then", "perform pg_sleep(0.4);\n  if v_series = 'idc' then")
    sleep_next_nolock = re.sub(r"perform pg_advisory_xact_lock\(.*?::bigint\);", "", sleep_next, flags=re.S)
    sleep_promo = mutate("promote", "if v_previous is not null and v_previous <> new.id then",
                         "perform pg_sleep(0.4);\n  if v_previous is not null and v_previous <> new.id then")
    sleep_promo_nolock = sleep_promo.replace("for no key update;", ";")
    if "for no key update" in sleep_promo_nolock:
        sys.exit("could not strip the row lock from the mutated promote function")
    failed = False
    try:
        n = 12
        print(f"=== NUMBERING: {n} parallel sessions, each inserting an IFC revision (scl_revision NULL) on ONE document ===")
        for label, fn, expect_dups in [("real function", None, False),
                                       ("lock PRESENT, 0.4s sleep between the read and the return", sleep_next, False),
                                       ("lock REMOVED, 0.4s sleep between the read and the return", sleep_next_nolock, True)]:
            if fn:
                apply(fn)
            doc = new_doc("conc-num " + label)
            outs = parallel([ins(doc, "IFC")] * n)
            errs = [o for o in outs if "ERROR" in o]
            codes = sorted((o.split()[0] for o in outs if "ERROR" not in o), key=int)
            print(f"- {label}: {len(codes)} inserted, {len(errs)} refused by UNIQUE(document_id, scl_revision); codes={codes}")
            print("    " + live_check(doc))
            if bool(errs) != expect_dups:
                failed = True
                print("    <<<<<< UNEXPECTED: " + ("no duplicate was attempted" if expect_dups else "the lock did not hold"))
            apply(ORIG["next"].rstrip() + ";")
        print("\n=== PROMOTION: 3 rounds x 3 parallel sessions (IDC, IFR, IFC: different series, so the numbering lock "
              "does not serialise them) on ONE document ===")
        for label, fn, expect_bad in [("real function", None, False),
                                      ("row lock PRESENT, 0.4s sleep between reading the current revision and superseding it", sleep_promo, False),
                                      ("row lock REMOVED, 0.4s sleep between reading the current revision and superseding it", sleep_promo_nolock, True)]:
            if fn:
                apply(fn)
            doc = new_doc("conc-promo " + label)
            errs = []
            for _ in range(3):
                outs = parallel([ins(doc, "IDC"), ins(doc, "IFR"), ins(doc, "IFC")])
                errs += [o.split("\n")[0][:120] for o in outs if "ERROR" in o]
            res = live_check(doc)
            print(f"- {label}: {res}" + (f"\n    insert errors: {errs}" if errs else ""))
            bad = "live(not SUPERSEDED)=1 " not in res or errs
            if bool(bad) != expect_bad:
                failed = True
                print("    <<<<<< UNEXPECTED: " + ("the race did not show up" if expect_bad else "the lock did not hold"))
            apply(ORIG["promote"].rstrip() + ";")
    finally:
        apply(ORIG["next"].rstrip() + ";")
        apply(ORIG["promote"].rstrip() + ";")
        psql("delete from dcs.documents where title like 'conc-%'")
        print("\noriginal functions restored, test documents deleted. NOW RUN `supabase db reset` "
              "(audit_log rows were committed; see the header).")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("red", "concurrency"):
        sys.exit(__doc__.split("\n\n")[0] + "\n\nusage: revision-proofs.py red | concurrency")
    {"red": cmd_red, "concurrency": cmd_concurrency}[sys.argv[1]]()
