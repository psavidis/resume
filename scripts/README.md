# Scripts Guide

## A. Prerequisites

### 1. Install Node on MacOS

`brew install node`

Then run `node --version`. You should be able to see the latest version of node installed on your system.

**Note**: The pdf generation has been tested with `node.js v25.3.0`.

### 2. Install Puppeteer

`npm install puppeteer`

## B. Scripts execution

### 1. PDF Creation Using Puppeteer

- `cd scripts`
- `node generate-pdf.js`

A new pdf is created in the root of the directory called `resume-petros-savidis.pdf`.

**Note**: Puppeteer needs to execute the script within the scripts target folder otherwise pdf generation doesn't work.

### 2. Release New Version

#### 1. Dry Run Mode

If you want to test the release and observe the generated pdf with the latest version before proceeding to pushing tags to production
you can run the following command on the root of the repo in dry run mode:

```bash
node scripts/release.js --dry
```

#### 2. Release Mode

If you want to release a new version of the resume, you can run the following command on the root of the repo:

```bash
node scripts/release.js
```

## 3. Development

### generate-pdf.js

#### Local Mode

The node app fetches the content from the live hosted resume. If you want to make changes locally, you need to replace the fetching URL with the local one during changes (L12).

#### Debugging

If you want to enable screenshots during rendering, uncomment L16.

### Git Tag Version Update

To push a git version for the resume manually, use `git tag -a {version} -m "Release version ${version}"`.