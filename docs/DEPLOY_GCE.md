# Deploying WARZONE 2D to one Google Compute Engine VM

> **Status: written, not yet performed.** These steps have not been executed or verified by the author.
> Do not call the deployment "complete" until you have finished the checklist in section 8.

Architecture: one VM, one container (`warzone2d`). The Node server serves the web client and the
Socket.IO endpoint on the same port, so only **one public port (80)** is needed. Traffic is plain HTTP.

Pick the zone nearest your players (examples use `asia-south1-a`, Mumbai). Replace `PROJECT_ID`.

## 1. Create and configure the VM

```bash
gcloud auth login
gcloud config set project PROJECT_ID
gcloud services enable compute.googleapis.com

gcloud compute instances create warzone2d-vm \
  --zone=asia-south1-a \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --tags=warzone-http
```

`e2-small` (2 shared vCPU, 2 GB) is ample for a handful of 2-4 player rooms.

## 2. Firewall: open only what is needed

```bash
gcloud compute firewall-rules create warzone-allow-http \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=warzone-http
```

SSH (tcp:22) is already allowed by the `default-allow-ssh` rule on the default network. Do **not** open 3000:
the container is published on port 80 of the host.

## 3. Install Docker and the Compose plugin (on the VM)

```bash
gcloud compute ssh warzone2d-vm --zone=asia-south1-a
```
then, on the VM:
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
 | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
exit            # log out and back in so the group change applies
```
If Docker's install page has changed, follow https://docs.docker.com/engine/install/debian/ instead.

## 4. Transfer the project

From your own computer, in the folder that contains `warzone2d/`:
```bash
tar czf warzone2d-src.tar.gz --exclude=node_modules --exclude=dist warzone2d
gcloud compute scp warzone2d-src.tar.gz warzone2d-vm:~ --zone=asia-south1-a
gcloud compute ssh warzone2d-vm --zone=asia-south1-a --command="tar xzf warzone2d-src.tar.gz"
```
(Or push to a private Git repository and `git clone` it on the VM.)

## 5. Configure environment variables

```bash
cd ~/warzone2d
cp .env.example .env
nano .env        # set HOST_PORT=80  (leave the gameplay values at their defaults)
```
There are no secrets in this project. `.env` is git-ignored regardless.

## 6. Build and start

```bash
docker compose up -d --build     # first build takes a few minutes
docker compose ps                # STATUS should become "healthy"
```

Day-to-day commands:

| Task | Command |
|---|---|
| Start / rebuild | `docker compose up -d --build` |
| Stop (keep container) | `docker compose stop` |
| Stop and remove | `docker compose down` |
| Live logs | `docker compose logs -f game` |
| Health | `curl -s localhost/health` |

## 7. Verify browser access and multiplayer

```bash
# from your own computer:
gcloud compute instances describe warzone2d-vm --zone=asia-south1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```
Open `http://EXTERNAL_IP` in two browsers (ideally on two different devices/networks) and run
`docs/MANUAL_TEST.md`. The external IP is *ephemeral*: it changes if the VM is stopped and started.
Reserve a static IP only if you need a stable address (`gcloud compute addresses create ...`); an
unattached static IP is billed.

## 8. Completion checklist (tick only after you have actually seen it)

- [ ] `docker compose ps` shows `healthy`
- [ ] `curl http://EXTERNAL_IP/health` returns `{"status":"ok",...}`
- [ ] The game loads in a browser at `http://EXTERNAL_IP`
- [ ] Two devices can create/join a room and play a match
- [ ] Logs visible with `docker compose logs game`
- [ ] A CPU graph is visible in Cloud Monitoring (section 10)

## 9. Application logs

The server writes one JSON object per line (`ts`, `level`, `msg`, fields) for: server start, room created,
player joined/left, match started, rooms closed, handler errors, abusive clients, shutdown.
```bash
docker compose logs --tail=100 game
docker compose logs -f game | grep '"level":"error"'
```
Docker rotates these logs (10 MB x 3 files). **Optional, for Cloud Logging:** install the Ops Agent
(section 10) and add a `files` receiver for `/var/lib/docker/containers/*/*-json.log`
(see Google's Ops Agent "logging" configuration docs). That config is not included or tested here.

## 10. Basic cloud resource metrics

- **No setup needed:** Cloud Console -> *Monitoring* -> *Metrics Explorer* -> metric
  `Compute Engine VM Instance > Instance > CPU utilization` (also network bytes in/out, disk I/O),
  filtered to `warzone2d-vm`. Screenshot this while a match is running as evidence.
- **Memory (needs the Ops Agent on the VM):**
  ```bash
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  sudo bash add-google-cloud-ops-agent-repo.sh --also-install
  ```
  Then chart `agent.googleapis.com/memory/percent_used`.
- Quick look from the VM itself: `docker stats --no-stream`.

## 11. Controlling cost

```bash
gcloud compute instances stop warzone2d-vm --zone=asia-south1-a      # stops VM billing (disk still billed)
gcloud compute instances delete warzone2d-vm --zone=asia-south1-a    # removes VM and boot disk
gcloud compute firewall-rules delete warzone-allow-http
gcloud compute addresses list                                        # delete any static IP you reserved
```
Check Billing -> Reports a day later to confirm nothing is still running.

## Known limits of this deployment
- HTTP only (no TLS). Fine for a demo; for HTTPS put Caddy or a Google load balancer in front (WebSocket support required).
- One VM, in-memory matches: restarting the container ends all live matches (by design, per the BRD scope).
