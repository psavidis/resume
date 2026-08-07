const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const LIVE_URL = 'https://psavidis.github.io/resume?no-track=true';

// Pass --local to render your local files instead of the hosted resume
const isLocal = process.argv.includes('--local');

(async () => {
    // In local mode the repo is served over HTTP under a /resume/ path, because index.html
    // uses absolute /resume/... asset URLs and fetches data.json: file:// breaks the fetch
    // (CORS), and serving from the repo root 404s every asset.
    const server = isLocal ? await startLocalServer() : null;
    const url = isLocal
        ? `http://localhost:${server.address().port}/resume/index.html?no-track=true`
        : LIVE_URL;

    console.log(isLocal ? 'Mode: local' : 'Mode: live');

    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Surface page-side failures instead of letting them hang the run silently
    page.on('pageerror', err => console.error('Page error:', err.message));

    page.on('console', msg => {
        if (msg.type() === 'error') console.error('Page console error:', msg.text());
    });

    await goToPage(page, url);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // await debugScreenshotPage(page);

    // Wait for critical elements to be present before manipulating them
    await waitForSelector('#pdfEmailHeader', page);

    console.log('Waiting for live-resume...');
    await page.waitForSelector('.live-resume');     // Make sure this selector exists

    console.log('Waiting for live-resume-url...')
    await page.waitForSelector('.live-resume-url'); // Make sure this selector exists

    // The above are static markup, so they resolve even when data.json failed to load.
    // Wait on a data-driven element to prove the resume actually populated.
    console.log('Waiting for work-experience (data-driven)...');
    await page.waitForSelector('.work-experience');

    console.log("Printing screenshot before evaluate")

    // Inject your logic to prepare the page for printing
    await page.evaluate(() => {
        // 👇 Paste your full preparation code here
        showProfileInfo();
        hideFormContainer();
        hideSearchContainer();
        hideButtonContainer();
        hideTooltip();
        showPdfSummary();

        const resume = document.querySelector('#page-top');
        if (!resume) {
            console.error("Resume container not found!");
            return;
        }

        resume.classList.add('pdf-mode');

        const projectItems = document.querySelectorAll('.project-li');
        const workExperience = document.querySelectorAll('.work-experience');
        customizeWorkExperiencePageBreaks(workExperience);

        const techUsed = document.querySelectorAll('.project-tech');
        const projectDescriptions = document.querySelectorAll('.project-description');
        const projectPoints = document.querySelectorAll('.project-points');
        const projectButtons = document.querySelectorAll('.project-button');
        const projectNotification = document.querySelectorAll('.project-notification');

        makeVisible(projectItems);
        makeVisible(techUsed);
        makeVisible(projectDescriptions);
        makeVisible(projectPoints);
        makeButtonsVisible(projectButtons);
        makeButtonsVisible(projectNotification, 'flex');

        makeBadgesVisible();
        hideShortcuts();

        const container = document.querySelector('.container');
        container.style.height = 'auto';
        container.style.maxHeight = 'none';
        container.style.overflow = 'visible';

        configureResumeVersion(useNextTag=true);
    });

    // Create the PDF
    await page.pdf({
        path: '../resume-petros_savidis.pdf',
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true
    });

    await browser.close();
    if (server) server.close();
    console.log('PDF created: resume-petros_savidis.pdf');
})();

// Serves the repo so that index.html is reachable at /resume/index.html
function startLocalServer() {
    const types = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
    };

    const server = http.createServer((req, res) => {
        const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\/resume\/?/, '');
        const file = path.join(REPO_ROOT, relative || 'index.html');

        // Keep the server confined to the repo
        if (!file.startsWith(REPO_ROOT)) {
            res.writeHead(403).end();
            return;
        }

        fs.readFile(file, (err, content) => {
            if (err) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
            res.end(content);
        });
    });

    // Port 0 lets the OS pick a free port, so repeated runs never collide
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function debugScreenshotPage(page) {
    console.log("Printing screenshot before evaluate");
    await page.screenshot({path: 'debug.png', fullPage: true});
}

async function waitForSelector(selector, page) {
    console.log(`Waiting for selector: ${selector}`);
    await page.waitForSelector(selector);
    console.log(`Selector loaded: ${selector}`);
}

async function goToPage(page, url) {
    console.log(`Going to page: ${url}`);
    await page.goto(url, {
        waitUntil: 'networkidle0'  // Wait for dynamic content to load
    });
    console.log(`Page: ${url} loaded`);
}
