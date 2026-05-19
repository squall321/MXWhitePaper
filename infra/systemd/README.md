# MXWP Boot-Time Service Auto-Start

호스트 OS reboot 후 5 인스턴스 (postgres / meili / minio / api / web) 자동 시작 설정.

## 옵션 A — systemd --user (정석, 권장)

### 1) Linger 활성화 (1회만, sudo 필요)

logout 시에도 user systemd 가 살아있게 — reboot 후 자동 시작에 필수.

```bash
sudo loginctl enable-linger koopark
# 확인
loginctl show-user koopark | grep Linger   # Linger=yes 면 OK
```

### 2) Unit 설치

```bash
cp infra/systemd/mxwp-stack.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mxwp-stack.service
```

### 3) 상태 확인

```bash
systemctl --user status mxwp-stack
journalctl --user -u mxwp-stack -f         # 실시간 로그
```

### 4) 수동 stop/start (필요 시)

```bash
systemctl --user stop mxwp-stack
systemctl --user start mxwp-stack
```

## 옵션 B — cron @reboot (간단, sudo 불필요하지만 의존성 보장 X)

```bash
crontab -e
# 추가:
@reboot /home/koopark/claude/MXWhitePaper/infra/scripts/boot.sh
```

cron @reboot 은 네트워크가 준비되기 전에 실행될 수 있어 `boot.sh` 안의 `sleep 5` + healthz 재시도가 안전망. systemd 의 `After=network-online.target` 만큼 견고하진 않음.

## 옵션 C — 수동 (개발 중)

```bash
bash infra/scripts/boot.sh
# 또는 (boot.sh 가 호출하는 것):
bash infra/scripts/start.sh
```

## 로그

`infra/logs/boot.log` — boot.sh 의 timestamped log. systemd 옵션에서도 같은 파일에 누적 (Apptainer 자체 로그는 `~/.apptainer/instances/logs/.../`).

## 트러블슈팅

| 증상 | 원인 | 대응 |
|---|---|---|
| reboot 후 인스턴스 안 떠 있음 | Linger 비활성 | `sudo loginctl enable-linger koopark` |
| `apptainer: command not found` | systemd user PATH 누락 | unit 의 `Environment=PATH=...` 확인 |
| postgres `/dev/shm` flaky | 별개 이슈 — mmap 패치 (deployment-playbook §6 하) | conf 두 줄 수정 |
| API healthz 404 | uvicorn 워밍업 중 | 10~20초 더 기다리고 재시도 |

## 관련 파일

- `infra/scripts/boot.sh` — 부팅용 wrapper (start.sh + 로깅)
- `infra/scripts/start.sh` — 멱등 멀티-인스턴스 시작 (boot.sh 가 호출)
- `infra/scripts/recover.sh` — 더 강한 청소: stop-all → clean → start → migrate → seed
