module.exports = {
  apps: [{
    name: 'media-renamer',
    script: './dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      PORT: process.env.PORT || 8787,
      NODE_ENV: 'production'
    }
  }]
};
