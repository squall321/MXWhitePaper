# update.sh 의 재기동이 이 스택의 인스턴스 여섯(위키 워커 mxwp_wiki 포함)만 내리는지 — `instance stop --all` 이 이 계정의 인스턴스 전부를 내렸다(10-17 HWAX 결정 16)
#
# 재기동 구획을 원문 그대로 떼어 가짜 apptainer(받은 인자를 적는다)로 돌린다. 앱을 import 하지 않아 호스트 pytest 로도 돈다.
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
UPDATE = (REPO / "infra/scripts/update.sh").read_text(encoding="utf-8")
COMMON = (REPO / "infra/scripts/_common.sh").read_text(encoding="utf-8")


def _restart_block() -> str:
    i = UPDATE.index('if [ "$RESTART" = 1 ]; then')
    return UPDATE[i:UPDATE.index("\nfi\n", i) + 4]


def test_재기동은_이_스택의_인스턴스만_내린다(tmp_path):
    fake = tmp_path / "apptainer"
    fake.write_text('#!/usr/bin/env bash\necho "$*" >> "$CALLS"\n')
    fake.chmod(0o755)
    (tmp_path / "infra/scripts").mkdir(parents=True)
    (tmp_path / "infra/scripts/start.sh").write_text('#!/usr/bin/env bash\necho started\n')
    (tmp_path / "infra/scripts/start.sh").chmod(0o755)
    names = dict(re.findall(r"^(INST_[A-Z]+)=(\S+)$", COMMON, flags=re.M))
    assert len(names) == 6 and names["INST_WIKI"] == "mxwp_wiki", names
    env_lines = "\n".join(f"{k}={v}" for k, v in names.items())
    script = (f"set -euo pipefail\nAPPTAINER={fake}\nREPO_ROOT={tmp_path}\nENV_MARK={tmp_path}/mark\n"
              f"RESTART=1\nREBUILT_ANY=1\nCHANGED=\nENV_CHANGED_SINCE_RESTART=0\n{env_lines}\n{_restart_block()}\necho END\n")
    calls = tmp_path / "calls"
    r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                       env={"PATH": "/usr/bin:/bin", "CALLS": str(calls)})
    assert r.returncode == 0 and "END" in r.stdout, r.stdout + r.stderr
    got = calls.read_text().splitlines()
    assert all("--all" not in c for c in got), got
    assert sorted(c.split()[-1] for c in got) == sorted(names.values()), got
    assert all(c.startswith("instance stop ") for c in got), got
