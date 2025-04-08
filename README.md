# Petros Savidis' Resume

## Live Resume

You can find my live resume [here](https://psavidis.github.io/resume/).

## What's This ?
This is the Github repository for my official resume. The code is used by a Github page which hosts my resume online.

## Why the Heck You Coded Your Resume ?
- **Format complexity**: I've used different templates each time I've been after a new business opportunity and it was a pain to keep them up to date.
- **Template limitations**: Free resume templates have content restrictions which didn't work well as my resume grew in size.
- **Lack of Version control**: Repetitive copy-pasting of content across multiple templates and versions of my resume has been a big pain.
- **Format dependency**: I have always been dependent on different tools to generate my resume. I wanted to have a single source of truth which i can maintain autonomously. 

But the best reasons of all are

- Because I _can_ 😎 
- Why not 🙃

The above reasons made me contemplate of requirements for my project.

### Functional Requirements:

My resume should support:

- Easy Updates when new experience is added
- Free Hosting
- Easy Editing
- Data Separation: Data has to be updated individually without affecting the presentation
- Collapsible Cards for modelling my experience

### Technical Requirements:
- Git Support
- Frontend Application using JS without a Backend
- Github Pages Hosting
- All Resume Data will be loaded by a JSON file

### Features

- **Responsive Design**: The resume can be loaded on any device
  - For smaller screens, there is a little compromise with the buttons appearing at the top of the screen. This is an acceptable trait for my project.
- **Search Mode**: The resume can search simple keywords in my projects and highlight them
  - It works with single keywords or some of them separated with space.
  - A simple regex is used to find the keywords and highlight them.
  - The limitation of the current implementation is acceptable for the needs of my project.
- **Download PDF**: The resume can be downloaded as a PDF file
- **Keyboard Shortcuts**: For big screens, the user can use keyboard shortcuts to trigger the buttons.
  - The keyboard shortcuts can be found at the end of the resume only for big screens.
  - For smaller screens, the shortcuts are not visible.

### Libraries

- [html2pdf](https://ekoopmans.github.io/html2pdf.js/)
- [Google Fonts](https://fonts.google.com/)
- [Font Awesome](https://fontawesome.com/)