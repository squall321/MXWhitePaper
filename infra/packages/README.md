# Offline package cache

Bundle Ubuntu 24.04 host dependencies here when the target machine has no
internet (sandbox / air-gapped server / corporate firewall).

## Layout

```
infra/packages/
├── deb/        # *.deb  — apt closure (apptainer, nodejs, python, …)
├── npm/        # *.tgz  — pnpm tarball
├── pip/        # *.whl  — datamodel-code-generator + transitive wheels
└── sif/        # *.sif  — pre-built Apptainer images (optional)
```

## Producing the cache (online machine)

On any **internet-connected Ubuntu** machine that mirrors the target architecture
(typically `x86_64`):

```bash
git clone git@github.com:squall321/MXWhitePaper.git
cd MXWhitePaper
./scripts/download-packages.sh                 # ~5 min, ~700 MB total
# (run `make build` first if you want .sif images bundled too)
```

This populates `infra/packages/`. Pack it:

```bash
tar -czf mxwp-offline-bundle.tar.gz infra/packages/
```

## Consuming the cache (air-gapped server)

Copy the bundle over (USB / SCP / NAS) and:

```bash
tar -xzf mxwp-offline-bundle.tar.gz -C /path/to/MXWhitePaper
cd /path/to/MXWhitePaper
sudo ./scripts/bootstrap-host.sh --offline    # uses local cache only
./quickstart.sh                               # builds + boots stack
```

The bootstrap script auto-detects internet availability — no flag is
strictly required, but `--offline` makes the intent explicit and fails
loudly if the cache is incomplete.

## Notes

- The **.deb closure** includes the full transitive dependency tree
  (`apt-rdepends`), so a single `dpkg -i *.deb` resolves cleanly even
  when /etc/apt is empty.
- Cached files use the **target distro's package versions** — match the
  bundling host to the deployment host (Ubuntu 24.04 → Ubuntu 24.04).
- The `sif/` directory is **optional**. If empty, `make build` on the
  target will pull base images from the registries declared in each
  `infra/apptainer/*.def`. With no internet, you must pre-stage them.
- This directory is gitignored. The cache lives outside the repo to keep
  clones small.
