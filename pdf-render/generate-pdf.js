const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Replace with your local or hosted resume URL
    await goToPage(page, 'https://psavidis.github.io/resume?no-track=true');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // await debugScreenshotPage(page);

    // Wait for critical elements to be present before manipulating them
    await waitForSelector('#pdfEmailHeader', page);

    console.log('Waiting for live-resume...');
    await page.waitForSelector('.live-resume');     // Make sure this selector exists

    console.log('Waiting for live-resume-url...')
    await page.waitForSelector('.live-resume-url'); // Make sure this selector exists

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

        configureResumeVersion(true);
    });

    // Create the PDF
    await page.pdf({
        path: '../resume-petros_savidis.pdf',
        format: 'A4',
        printBackground: false,
        preferCSSPageSize: true
    });

    await browser.close();
})();

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
