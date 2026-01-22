# Petros Savidis - My Ultimate Interactive Developer Resume ![Version](https://img.shields.io/github/v/tag/psavidis/resume?label=version)

<div id="welcome-text">
  Welcome to my resume! This README can be read in <a href="https://psavidis.github.io/resume/blog.html">blog</a> format as well 🙃
</div>

## Live Resume

You can find my live resume [here](https://psavidis.github.io/resume/).

## What's This ?

This is the Github repository of my official resume. The code is used by a Github page which hosts my resume online.

## Why the Heck You Coded Your Resume ?

- **Format Complexity**: I've used different templates each time I've been after a new business opportunity and it was a pain to keep them up to date.
- **Template Limitations**: Free resume templates have content restrictions which didn't work well as my resume grew in size.
- **Lack of Version Control**: Repetitive copy-pasting of content across multiple templates and versions of my resume has been a big pain.
- **Format Dependency**: I have always been dependent on different tools to generate my resume. I wanted to have a single source of truth which i can maintain autonomously. 

But the best reasons of all are

- Because I _can_ 😎 
- Why not 🙃

The above made me contemplate of requirements for my project.

## Requirements

My resume should support:

- Easy Updates when new experience is added
- Free Hosting
- Easy Editing
- Data Separation: Data has to be updated individually without affecting the presentation
- Collapsible Cards for modelling my experience

## Technical Requirements

- Git Support
- Frontend Application using JS without a Backend
- Github Pages Hosting
- All Resume Data will be loaded by a JSON file

## Features

### For My Users

- **Responsive Design**: The resume can be loaded on any device
  - For smaller screens, there is a toggle button which can be clicked to unfold all buttons to save space.
- **Skeleton Loading**: When the page is loading, a skeleton UI appears to the user.
  - **Why**
    - To enhance UX while loading
    - Cause it's beautiful ❤️
- **Search Mode**: The resume can search simple keywords in my projects and highlight them
  - It works with multiple keywords separated by space.
  - A simple regex is used to find the keywords and highlight them.
  - The user can also use navigate between the highlighted results using next / previous arrows.
- **Project Badges**: Each project contains badges to present to the user important highlights that describe the working experience.
- **Download PDF**: The resume can be downloaded as a PDF file
- **Keyboard Shortcuts**: Users can access the features using keyboard shortcuts!
  - **Note**: The feature is only available for Desktop clients.
- **Built-in Messaging**
  - The resume can send email messages to me using the web client for large screens and desktop setups.
    - **Why**: The mailto directive prompts the user to open the default email client. 
    - This is not a good experience in case the user hasn't setup a native email client.
  - For mobile devices, the resume uses the mailto directive to open the default email client which serves a good user experience.
- **Dark Mode**
  - The resume supports a dark theme as well ❤️
- **Voice Commands**
  - You can interact with the features of my resume with voice commands if your browser supports them! 🗣
    - E.g. you can say "Search Java️" and you make a search for the keyword java in my projects 🤘
- **QR Code + URL in the PDF**
  - Enables people access the live version even if links are stripped

### For Me as a Developer

- **Git Integration**: The resume is versioned using git 🤘
- **Data Separation**: The data is loaded from a JSON file and presented dynamically.
  - Even my total experience is calculated on the fly 🙃
- **Push Notifications**: I get push notifications for page views on my phone.
- **Analytics**: I can track the user activity of my resume.

## Issues & Decisions

### PDF Handling

My official resume cannot afford to malfunction. Thus, the download PDF function for production always points to the latest
static PDF rendered. If `productionMode` is set to `false`, the resume renders the PDF on the fly.

**Note**: This was identified to be problematic for Apple devices and thus a static PDF is used for production.

### Social Platform PDF Processing

There are platforms which perform link processing for security reasons. This is a problem for my resume as the links are not clickable.
To mitigate this issue, I've included a QR code for pdf-first user journeys and a clear visible link that can be copy-pasted.

## Libraries
- [Puppeteer](https://pptr.dev/)
- [Google Fonts](https://fonts.google.com/)
- [Font Awesome](https://fontawesome.com/)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)

## For Me

- See Analytics [here](https://clarity.microsoft.com/projects/view/ri7umniw4o/project)
- [Ntfy.sh](https://ntfy.sh/) is used to push notifications to my phone of page views

## Final Thoughts

I'm thrilled with how this project evolved. What began as a common frustration—unwieldy, traditional resumes—has transformed into a dynamic digital showcase of my professional journey.

The process of creating this digital profile has been both challenging and rewarding. Each line of code and design choice was made with the intent to showcase not just what I've done, but who I am as a professional.

It's a living project that evolves with me, reflecting my journey in a creative way while at the same time expressing my taste in software.

## Copyright

Copyright © 2026 Petros Savidis. All rights reserved.

This repo is public for sharing/viewing only. Not open source. Please don’t copy or reuse without permission.

Thank you for respecting the creative effort behind this project.
