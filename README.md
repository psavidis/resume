# Petros Savidis' Resume

## Live Resume

You can find my live resume [here](https://psavidis.github.io/resume/).

## What's This ?
This is the Github repository for my official resume. The code is used by a Github page which hosts my resume online.

## Why the Heck You Coded Your Resume ?
- **Format Complexity**: I've used different templates each time I've been after a new business opportunity and it was a pain to keep them up to date.
- **Template Limitations**: Free resume templates have content restrictions which didn't work well as my resume grew in size.
- **Lack of Version Control**: Repetitive copy-pasting of content across multiple templates and versions of my resume has been a big pain.
- **Format Dependency**: I have always been dependent on different tools to generate my resume. I wanted to have a single source of truth which i can maintain autonomously. 

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
  - The limitation of the current implementation is acceptable for the needs of my project as the user can fallback to single keyword search to assist him in browsing through my projects.
- **Download PDF**: The resume can be downloaded as a PDF file
- **Keyboard Shortcuts**: For big screens, the user can use keyboard shortcuts to trigger the buttons.
  - The keyboard shortcuts can be found at the end of the resume only for big screens.
  - For smaller screens, the shortcuts are not visible.
- **Built-in Messaging**
  - The resume can send email messages to me using the web client for large screens and desktop setups.
    - **Why**: The mailto directive prompts the user to open the default email client. 
    - This is not a good experience in case the user hasn't setup a native email client.
  - For mobile devices, the resume uses the mailto directive to open the default email client which serves a good user experience.
- **Dark Mode**
  - The resume supports a dark theme as well ❤️ 

### Libraries

- [html2pdf](https://ekoopmans.github.io/html2pdf.js/)
- [Google Fonts](https://fonts.google.com/)
- [Font Awesome](https://fontawesome.com/)

### PDF Rendering Issues

My official resume cannot afford to malfunction. Thus, the download PDF function for production always points to the latest
static PDF rendered. If `productionMode` is set to `false`, the resume renders the PDF on the fly.

**Note**: This was identified to be problematic for Apple devices and thus a static PDF is used for production.

### Business Social Platform Issues

There are platforms which perform link processing for security reasons. This is a problem for my resume as the links are not clickable.
To mitigate this issue, I've included a QR code for pdf-first user journeys and a clear visible link that can be copy-pasted.

### For Me

See Analytics [here](See Analytics https://statcounter.com/p13118834/summary/)
)