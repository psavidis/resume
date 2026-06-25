const { execSync } = require("child_process");
const path = require("path");

const isDryRun = process.argv.includes("--dry");

// repo root = one level above /scripts
const REPO_ROOT = path.resolve(__dirname, "..");

function run(cmd, options = {}) {
    console.log(`> ${cmd}`);
    execSync(cmd, {
        stdio: "inherit",
        ...options
    });
}

function runRoot(cmd) {
    run(cmd, { cwd: REPO_ROOT });
}

function getLatestTag() {
    runRoot("git fetch --tags");

    const tags = execSync(
        "git tag --list 'v*' --sort=-v:refname",
        { encoding: "utf-8", cwd: REPO_ROOT }
    )
        .split("\n")
        .filter(Boolean);

    return tags[0] || null;
}

// v4.9 → v5.0 (rollover after 9)
function bumpVersion(version) {
    if (!version) return "v1.0";

    const clean = version.replace(/^v/, "");
    let [major, minor] = clean.split(".").map(Number);

    if (Number.isNaN(major) || Number.isNaN(minor)) {
        throw new Error(`Invalid version format: ${version}`);
    }

    minor += 1;

    if (minor > 9) {
        major += 1;
        minor = 0;
    }

    return `v${major}.${minor}`;
}

const latestTag = getLatestTag();
const nextVersion = bumpVersion(latestTag);

console.log(`🚀 Latest tag: ${latestTag || "none"}`);
console.log(`📦 Next version: ${nextVersion}`);

if (isDryRun) {
    console.log("🧪 DRY RUN MODE ENABLED");
}

try {
    // 1. Generate PDF (must run in /scripts)
    run(`node generate-pdf.js ${nextVersion}`, {
        cwd: __dirname
    });

    console.log(`📄 PDF generated for ${nextVersion}`);

    if (isDryRun) {
        console.log("\n🧪 DRY RUN COMPLETE");
        console.log("✔ PDF generated");
        console.log("❌ No git commit");
        console.log("❌ No tag created");
        console.log("❌ No push executed");

        process.exit(0);
    }

    // 2. Stage ALL changes (safe default for your project)
    runRoot("git add resume-petros_savidis.pdf");

    // 3. Commit
    runRoot(`git commit -m "chore(release): ${nextVersion}"`);

    // 4. Annotated tag
    // runRoot(`git tag -a ${nextVersion} -m "Release version ${nextVersion}"`);

    // 5. Push (optional but enabled here)
    // runRoot("git push origin main");
    // runRoot(`git push origin ${nextVersion}`);

    console.log("✅ Release complete");
} catch (err) {
    console.error("❌ Release failed");
    process.exit(1);
}