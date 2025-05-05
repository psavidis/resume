(async () => {

  // Utility: sleep until an element is available
  const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return reject("❌ Job description element not found");
        requestAnimationFrame(check);
      };
      check();
    });
  };

  try {
    // Load keywords
    const res = await fetch('https://raw.githubusercontent.com/psavidis/resume/refs/heads/master/data.json');
    const data = await res.json();
    const keywords = data.project.flatMap(p => p.techUsed.map(t => t.toLowerCase()));

    // Wait for job description to load
    const jobTextElement = await waitForElement('[data-description], [class*="jobs-description-content"], [class*="description__text"]');

    const jobText = jobTextElement.innerText.toLowerCase();
    const jobWords = new Set(jobText.split(/\s+/).map(w => w.trim().replace(/[^\w]/g, '')));
    const matched = keywords.filter(k => jobWords.has(k));
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
