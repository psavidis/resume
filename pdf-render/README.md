# PDF Guide

## Install Node on MacOS

`brew install node`

Then run `node --version`. You should be able to see the latest version of node installed on your system.

**Note**: The pdf generation has been tested with `node.js v25.3.0`.

## Install Puppeteer

`npm install puppeteer`

## PDF Creation Using Puppeteer

- `cd pdf-render`
- `node generate-pdf.js`

A new pdf is created in the root of the directory called `resume-petros-savidis.pdf`.

## Development

### Local Mode

The node app fetches the content from the live hosted resume. If you want to make changes locally, you need to replace the fetching URL with the local one during changes (L12).

### Debugging

If you want to enable screenshots during rendering, uncomment L16.

### Resume Version Update

To push a git version for the resume, use `git tag -a {version} -m "Release version ${version}"`.