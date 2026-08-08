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
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
    '.glb': 'model/gltf-binary'
};

http.createServer((req, res) => {
    const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\/resume\/?/, '');
    const file = path.join(REPO_ROOT, relative || 'index.html');

    // Keep the server confined to the repo
    if (!file.startsWith(REPO_ROOT)) {
        res.writeHead(403).end();
        return;
    }

    fs.stat(file, (statErr, stats) => {
        if (statErr) {
            res.writeHead(404).end('Not found');
            return;
        }

        const type = TYPES[path.extname(file)] || 'application/octet-stream';

        // <audio>/<video> stall waiting for range support before they'll play
        // anything, so this always advertises it and honours a Range header
        // when present — without this, mp3 playback silently never starts.
        const range = req.headers.range;
        if (range) {
            const match = /bytes=(\d*)-(\d*)/.exec(range);
            const start = match[1] ? Number(match[1]) : 0;
            const end = match[2] ? Number(match[2]) : stats.size - 1;
            res.writeHead(206, {
                'Content-Type': type,
                'Content-Length': end - start + 1,
                'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                'Accept-Ranges': 'bytes'
            });
            fs.createReadStream(file, { start, end }).pipe(res);
            return;
        }

        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': stats.size,
            'Accept-Ranges': 'bytes'
        });
        fs.createReadStream(file).pipe(res);
    });
}).listen(PORT, '127.0.0.1', () => {
    console.log(`Resume served at http://localhost:${PORT}/resume/index.html`);
    console.log(`3D version at    http://localhost:${PORT}/resume/resume-3d.html`);
});
