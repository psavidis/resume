const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Replace with your local or hosted resume URL
    await goToPage(page, 'https://psavidis.github.io/resume');

    await new Promise(resolve => setTimeout(resolve, 1000));

    await debugScreenshotPage(page);

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

        // Functions
        function showProfileInfo() {
            const emailHeader = document.querySelector('#pdfEmailHeader');
            if (emailHeader) emailHeader.style.display = 'block';

            const liveResume = document.querySelector('.live-resume');
            if (liveResume) liveResume.style.display = 'block';

            const liveResumeUrl = document.querySelector('.live-resume-url');
            if (liveResumeUrl) liveResumeUrl.style.visibility = 'visible';

            const liveResumeQr = document.querySelector('.live-resume-qr');
            if (liveResumeQr) liveResumeQr.style.visibility = 'visible';
        }

        function hideFormContainer() {
            const formContainer = document.getElementById('contact-form-container');
            if (formContainer) {
                formContainer.classList.remove('show');
                formContainer.style.display = 'none';
            }
        }

        function hideSearchContainer() {
            const searchContainer = document.querySelector('.search-container');
            if (searchContainer) searchContainer.style.visibility = 'hidden';
        }

        function hideButtonContainer() {
            const buttonContainer = document.querySelector('.button-container');
            if (buttonContainer) buttonContainer.style.visibility = 'hidden';
        }

        function hideTooltip() {
            const tooltips = document.querySelectorAll('.tooltip');
            tooltips.forEach(item => item.style.display = 'none');
        }

        function showPdfSummary() {
            const liveSummaryElements = document.querySelectorAll('.liveSummary');
            liveSummaryElements.forEach(element => element.classList.add('hidden'));

            const pdfSummaryElements = document.querySelectorAll('.pdfSummary');
            pdfSummaryElements.forEach(element => element.classList.remove('hidden'));
        }

        function customizeWorkExperiencePageBreaks(workExperienceItems) {
            if (workExperienceItems.length > 5) {
                workExperienceItems[5].style.marginTop = '10mm';
            }
        }

        function makeVisible(elements) {
            elements.forEach(item => {
                item.style.height = 'auto';
                item.style.display = 'block';
                item.style.overflow = 'visible';
                item.style.transition = 'none';
            });
        }

        function makeButtonsVisible(buttons, display = 'inline-block') {
            buttons.forEach(button => {
                button.style.height = 'auto';
                button.style.display = display;
                button.style.overflow = 'visible';
                button.style.transition = 'none';
            });
        }

        function makeBadgesVisible() {
            const projectBadges = document.querySelectorAll('.project-badges-list');
            const badges = document.querySelectorAll('.project-badge');
            makeButtonsVisible(projectBadges, 'flex');
            makeButtonsVisible(badges, 'flex-inline');
        }

        function hideShortcuts() {
            const shortcuts = document.querySelector('#shortcuts');
            if (shortcuts) shortcuts.style.display = 'none';

            const shortcutHint = document.querySelector('#shortcut-hint');
            if (shortcutHint) shortcutHint.style.display = 'none';
        }
    });

    // Create the PDF
    await page.pdf({
        path: 'resume-petros-savvidis.pdf',
        format: 'A4',
        printBackground: true,
        margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' }
    });

    await browser.close();
})();

async function debugScreenshotPage(page) {
    console.log("Printing screenshot before evaluate");
    await page.screenshot({ path: 'debug.png', fullPage: true });
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
