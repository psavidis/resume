(async () => {

  // Utility: sleep until an element is available
  const waitForElementWithContent = (selector, minLength = 100, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        const content = el?.innerText?.trim() ?? '';

        if (el && content.length >= minLength && content.toLowerCase() !== 'about the job') {
          return resolve(el);
        }

        if (Date.now() - start > timeout) {
          return reject("❌ Job description element with sufficient content not found");
        }

        requestAnimationFrame(check);
      };
      check();
    });
  };


  async function geyKeywords() {
    const CACHE_KEY = 'projectKeywords';
    const CACHE_TIMESTAMP_KEY = 'projectKeywordsTimestamp';
    const ONE_DAY = 24 * 60 * 60 * 1000; // in milliseconds

    const now = Date.now();
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);

    if (cached && cachedTimestamp && now - Number(cachedTimestamp) < ONE_DAY) {
      return JSON.parse(cached); // Use cached version
    }

    // Fetch from network
    const res = await fetch('https://raw.githubusercontent.com/psavidis/resume/refs/heads/master/data.json');
    const data = await res.json();
    const keywords = data.project.flatMap(p => p.techUsed.map(t => t.toLowerCase()));

    // Store in localStorage with current timestamp
    localStorage.setItem(CACHE_KEY, JSON.stringify(keywords));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, String(now));

    return keywords;
  }

  try {
    // Load keywords
    const keywords = await geyKeywords();
    // console.log(keywords);

    // Wait for job description to load
    const jobTextElement = await waitForElementWithContent('[data-description], [class*="jobs-description-content"], [class*="description__text"]');

    const jobText = jobTextElement.innerText.toLowerCase();

    // console.log(`JobText: ${jobText}`);

    const jobWords = jobText
        .split(/\s+/)
        .map(w => w.trim().replace(/\W/g, ''));

    const jobWordsArray = Array.from(jobWords);
    const jobWordsSet = new Set(jobWordsArray);

    // console.log(`keywordSet: ${jobWordsSet}`);

    const matched = keywords.filter(keyword => jobWordsSet.has(keyword));

    // console.log(`Matched keywords: ${matched.join(', ')}`);

    const pattern = new RegExp(`\\b(${matched.join('|')})\\b`, 'gi');

    // Walk through nodes and highlight text
    const highlightNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE && pattern.test(node.nodeValue)) {
        const span = document.createElement('span');
        span.innerHTML = node.nodeValue.replace(pattern, (match) =>
            `<span style="background-color: yellow; font-weight: bold;">${match}</span>`
        );
        node.replaceWith(...span.childNodes);
      } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE'].includes(node.tagName)) {
        [...node.childNodes].forEach(highlightNode);
      }
    };

    highlightNode(jobTextElement);
    console.log("✨ Highlighting complete:", matched);
  } catch (err) {
    console.error(err);
  }
})();
