#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function runBuildAndStart() {
  console.log('Running build...');
  const pnpmCmd = process.platform === 'win32' && process.env.APPDATA ? require('path').join(process.env.APPDATA, 'npm', 'pnpm.cmd') : 'pnpm';
  const build = spawn(pnpmCmd, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  build.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Build failed with exit code ${code}`);
      process.exit(code);
      return;
    }
  console.log('Starting compiled server...');
  // Before starting, ensure the configured port is free (wait a short while for previous process to exit)
  const net = require('net');
  const port = Number(process.env.PORT || 8080);
  function isPortInUse(p, cb) {
    const sock = new net.Socket();
    let called = false;
    sock.setTimeout(300);
    sock.on('connect', () => {
      called = true;
      sock.destroy();
      cb(true);
    });
    sock.on('timeout', () => {
      if (!called) {
        called = true;
        try { sock.destroy(); } catch (e) { }
        cb(false);
      }
    });
    sock.on('error', () => {
      if (!called) {
        called = true;
        try { sock.destroy(); } catch (e) { }
        cb(false);
      }
    });
    sock.connect({ port: p, host: '127.0.0.1' });
  }

  function waitForPortFree(p, attempts, delay) {
    return new Promise((resolve) => {
      let tries = 0;
      function attempt() {
        isPortInUse(p, (inUse) => {
          if (!inUse) {
            resolve(true);
            return;
          }
          tries++;
          if (tries >= attempts) {
            resolve(false);
            return;
          }
          setTimeout(attempt, delay);
        });
      }
      attempt();
    });
  }

  waitForPortFree(port, 5, 500).then((free) => {
    if (!free) {
      console.error(`Port ${port} appears to be in use. Stop the other server or set PORT to a different value and retry.`);
      process.exit(1);
      return;
    }
    // Spawn Node directly (no shell) to avoid issues with spaces in the Node executable path on Windows
    const proc = spawn(process.execPath, [path.join('dist', 'server.js')], { cwd: ROOT, stdio: 'inherit', shell: false });
    proc.on('exit', (c) => process.exit(c));
  });
  });
}

runBuildAndStart();
