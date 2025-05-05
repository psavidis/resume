(async () => {
  try {
    const res = await fetch('https://raw.githubusercontent.com/psavidis/resume/refs/heads/master/data.json');
    const data = await res.json();
    const keywords = data.project.flatMap(p => p.techUsed.map(t => t.toLowerCase()));

    const jobTextElement = document.querySelector(
        '[data-description]'
    ) || document.querySelector(
        '[class*="jobs-description-content"]'
    ) || document.querySelector(
        '[class*="description__text"]'
    );

    if (!jobTextElement) {
      console.log("❌ Couldn't find job description on this page.");
      return;
    }

    // Tokenize the job description into words
    const jobText = jobTextElement.innerText.toLowerCase();
    const jobWords = new Set(jobText.split(/\s+/)); // Split by spaces and make it a Set for unique words

    // Match keywords that are found in the job description
    const matched = keywords.filter(k => jobWords.has(k));
    const unmatched = keywords.filter(k => !jobWords.has(k));

    console.log(`✅ Matched (${matched.length}):`, matched);
    console.log(`❌ Not matched (${unmatched.length}):`, unmatched);

  } catch (e) {
    console.error("⚠️ Error fetching or processing data:", e);
  }
})();
