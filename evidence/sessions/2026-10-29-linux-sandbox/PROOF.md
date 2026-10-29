# Linux 分支沙箱真机验证（WSL2）· 2026-10-29

目的：卡 180/183 里「POSIX 脱离进程组生命周期」这一条，之前一直被记成「只能 macOS 验」。它的内核语义 Linux 与 macOS 同源，所以在本机 WSL2 里真跑一次 Linux 分支即可覆盖这半条；只有 Seatbelt 那部分仍是 macOS 独占。

## 环境

- WSL2 发行版 `Ubuntu`，内核 `6.18.54.1-microsoft-standard-WSL2`，`node v22.22.2`，uid 1000（非 root），`sudo -n` 免密。
- 装了 `bubblewrap 0.9.0`：`sudo apt-get install -y bubblewrap`（回滚：`sudo apt-get remove bubblewrap`）。安装前 `PlatformSandboxRunner.isAvailable()` 为 `false`，装后为 `true`。
- 直接使用仓库已构建产物 `packages/tools/dist/execution/sandbox/platformSandbox.js`（`tsc -b` 于同日 exit 0），不额外改代码。

## 结果（原始输出见 `transcript.txt`）

| 用例 | 结果 |
|---|---|
| 白名单内写 `ws/in.txt` 并读回 | exit 0，`inside` |
| 写 `/tmp/vessel-escape-test.txt` | exit 2，`Read-only file system`，文件不存在 |
| 写 `/usr/local/vessel-escape-test.txt` | exit 2，`Read-only file system`，文件不存在 |
| 读 `/etc/hostname` | exit 0，`user`（`--ro-bind / /` 生效） |
| `setsid` 逃逸后代（先写白名单内、再写 `/tmp`） | 7 秒后白名单内 `late.txt` 未出现、`/tmp` 未出现、`ps` 无残留 |

tier 全程为 `bwrap-ns`，`sandboxed: true`。

## 结论与边界

- Linux 分支的**写隔离**与**逃组行为**都有真机证据：namespace + parent-death 把整个会话收掉，逃逸后代既没存活也没写出任何东西。这比文档里「POSIX 逃组后代可能继续存活」的保守表述更强。
- **未覆盖**：`/usr/bin/sandbox-exec` 能力探测、Seatbelt 配置行为（默认 deny `file-write*`、白名单 `subpath`）、逃逸后代是否仍受已继承的 Seatbelt 约束。这三条只在 macOS 分支里，本机没有 macOS，保持「单测覆盖 + 文档声明」，不作为阻塞项挂账（除非本仓要正式支持 macOS）。
- WSL2 是独立内核的虚拟机，因此本证据代表 **Linux 分支**，不能替代 macOS 分支。

## 复跑

```bash
wsl -e bash -lc 'cd /mnt/e/Code_file/Projects/Vessel_Harness/evidence/sessions/2026-10-29-linux-sandbox && bash probe-write-and-read.sh && bash probe-setsid-escape.sh'
```

两个脚本都在本目录；它们只写 `/tmp` 与仓库外的一次性目录，不改仓库、不装其它包（bubblewrap 是唯一前置）。
