Production deployment notes

1) Build
- Server: pnpm -C server install && pnpm -C server run build
- Web: pnpm -C web install && pnpm -C web run build

2) Run with PM2
- Install pm2 globally: pnpm i -g pm2
- Start: pm2 start pm2.ecosystem.config.js
- View logs: pm2 logs media-renamer

3) Systemd (example)
Create file `/etc/systemd/system/media-renamer.service` with the following content:

```
[Unit]
Description=Media Renamer
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/media-renamer
Environment=PORT=8787
ExecStart=/usr/bin/node /srv/media-renamer/dist/server.js
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Reload systemd: `systemctl daemon-reload` then `systemctl enable --now media-renamer`.

4) Docker
- Use `docker compose up --build` to build and run a container with the static `web/dist` served by the server.

5) TLS
- Put a reverse proxy (nginx/caddy) in front for TLS and HTTP/2. Avoid exposing the server directly to the internet.
