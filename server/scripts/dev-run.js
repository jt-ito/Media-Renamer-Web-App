#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function runBuildAndStart() {
  console.log('Running build...');
  const build = spawn('pnpm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  build.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Build failed with exit code ${code}`);
      process.exit(code);
      return;
    }
    console.log('Starting compiled server...');
    const proc = spawn(process.execPath, [path.join('dist', 'server.js')], { cwd: ROOT, stdio: 'inherit', shell: true });
    proc.on('exit', (c) => process.exit(c));
  });
}

runBuildAndStart();
