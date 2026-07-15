# Synapse Sandbox Worker

`runTerminal` uses this image to execute confirmed commands inside an isolated Docker container.

Build on the server:

```bash
cd /home/deploy/synap
docker build -t synapse-sandbox:latest docker/synapse-sandbox
```

Runtime defaults:

- Mounts only the current user's Synapse workspace at `/workspace`.
- Runs without network by default.
- Drops Linux capabilities and enables `no-new-privileges`.
- Limits CPU, memory, and process count through PM2 environment variables.
- Uses a read-only container filesystem, with `/workspace` and `/tmp` writable.

Useful environment variables:

- `SYNAPSE_SANDBOX_RUNTIME=docker`
- `SYNAPSE_SANDBOX_IMAGE=synapse-sandbox:latest`
- `SYNAPSE_SANDBOX_NETWORK=none`
- `SYNAPSE_SANDBOX_MEMORY=512m`
- `SYNAPSE_SANDBOX_CPUS=1`
- `SYNAPSE_SANDBOX_PIDS_LIMIT=128`
- `SYNAPSE_SANDBOX_READ_ONLY=1`

