// Serves the resume locally so pages can fetch data.json (file:// blocks it).
// Usage: node scripts/serve.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8000;

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
    const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\/resume\/?/, '');
    const file = path.join(REPO_ROOT, relative || 'index.html');

    // Keep the server confined to the repo
    if (!file.startsWith(REPO_ROOT)) {
        res.writeHead(403).end();
        return;
    }

    fs.readFile(file, (err, content) => {
        if (err) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'});
        res.end(content);
    });
}).listen(PORT, '127.0.0.1', () => {
    console.log(`Resume served at http://localhost:${PORT}/resume/index.html`);
    console.log(`3D version at    http://localhost:${PORT}/resume/resume-3d.html`);
});
