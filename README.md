# Petros Savidis Resume

## What's this ?
This is the github repository for my official resume. The code is used by a Github page which hosts my resume online.

## Why the heck you coded your resume ?
- **Format complexity**: I've used different templates each time I've been after a new business opportunity and it was a pain to keep them up to date.
- **Template limitations**: Free resume templates have content imitations which didn't work as my resume grew in size
- **Lack of Version control**: I couldn't keep track of changes in my resume and I had to copy paste the content from one template to another.
- **Format dependency**: I have always been dependent on different tools to generate my resume. I wanted to have a single source of truth for my resume. 

But the best reasons of all are

- Because I _can_ and 
- Why not 🤘

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
  - The search mode is not perfect. It uses a simple regex to find the keywords and highlight them. 
  - It doesn't support complex queries like "find all projects that contain the word 'python' and 'javascript'". 
  - The limitation of the current implementation works is acceptable for my project.
- **Download PDF**: The resume can be downloaded as a PDF file
- **Keyboard Shortcuts**: For big screens, the user can use keyboard shortcuts to trigger the buttons.
  - The keyboard shortcuts can be found at the end of the resume only for big screens. For smaller screens, the shortcuts are not visible.

### Libraries

- [html2pdf](https://ekoopmans.github.io/html2pdf.js/)
- [Google Fonts](https://fonts.google.com/)
- [Font Awesome](https://fontawesome.com/)