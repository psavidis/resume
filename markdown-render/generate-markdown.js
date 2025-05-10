const fs = require('fs');

// Read data from the data.json file
const data = require('../data.json');

function getExperience(data) {
    const totalXP = getTotalExperience(data.workExperience);
    return formatTotalExperienceIntoYears(totalXP);
}

function getTotalExperience(workExperience) {
    let totalExperienceMonths = 0;

    workExperience.forEach(job => {

        if (job.company === 'Hellenic Army') {
            return;
        }

        totalExperienceMonths += calculateExperience(job.startDate, job.endDate);
    });

    // Convert the total experience to years and months
    const years = Math.floor(totalExperienceMonths / 12);
    const months = totalExperienceMonths % 12;

    return {years, months};
}

function calculateExperience(startDate, endDate) {
    const start = parseMonthYearString(startDate);
    const end = (endDate === 'Present') ? new Date() : new parseMonthYearString(endDate);  // Handle 'Present' as current date

    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function parseMonthYearString(monthYearString) {
    const [monthName, yearString] = monthYearString.split(' ');
    const year = parseInt(yearString, 10);

    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const monthIndex = monthNames.indexOf(monthName);

    if (monthIndex === -1 || isNaN(year)) {
        throw new Error(`Invalid date string: ${monthYearString}`);
    }

    return new Date(Date.UTC(year, monthIndex, 1)); // Always safe
}

function formatTotalExperienceIntoYears(totalExperience) {
    const years = totalExperience.years;
    const months = totalExperience.months;

    // Format the output
    if (months > 0) {
        return `${years}+ years`; // If there are months, show a +
    } else {
        return `${years} years`; // If no months, show only years with a "+"
    }
}

// Function to generate the contact section
function generateContact(data) {
    return `
## Contact Information
- **Email**: ${data.email}
- **Location**: ${data.addressLocation}
- **LinkedIn**: [${data.linkedInURL}](${data.linkedInURL})
`;
}

// Function to generate the summary section
function generateSummary(summary) {
    return `
${summary}

## Summary
Passionate Software Engineer with ${getExperience(data)} of proven experience in all aspects of the software development life cycle, including requirement analysis, design, development and production support. Interested in Software Architecture & Design.

You can find my Dynamic | Git-powered | Code-driven resume here:

https://psavidis.github.io/resume/
`;
}

function getProjectsByCompany(data, company) {
    const projects = data.project;
    return projects.filter(project => project.company === company);
}

function generateWorkExperience(data) {
    let workExperienceMarkdown = '## Work Experience\n';
    const workExperience = data.workExperience;

    workExperience.forEach(exp => {
        workExperienceMarkdown += `
### ${exp.title}
${exp.company} · ${exp.employmentType}<br>
${exp.startDate} – ${exp.endDate}  
${exp.location}
`;

        const projects = getProjectsByCompany(data, exp.company);

        if (projects.length > 0) {
            workExperienceMarkdown += `\n#### Projects:\n`;

            projects.forEach(project => {
                workExperienceMarkdown += `
- **${project.name}**
    - **Description:** ${project.description}
    - **Tech Used**: ${project.techUsed.join(', ')}  
                `;
            });

            workExperienceMarkdown += '\n';
        }

        workExperienceMarkdown += '\n';
    });

    return workExperienceMarkdown;
}

// Function to generate education section
function generateEducation(education) {
    let educationMarkdown = '## Education\n';

    education.forEach(edu => {
        educationMarkdown += `
- **${edu.degree} in ${edu.fieldOfStudy}**
    - ${edu.school}
    - ${edu.startYear} - ${edu.endYear}
    `;
    });

    return educationMarkdown;
}

// Function to generate languages section
function generateLanguages(languages) {
    let languagesMarkdown = '## Languages\n';

    languages.forEach(lang => {
        languagesMarkdown += `
- **${lang}**
    `;
    });

    return languagesMarkdown;
}

// Main function to generate the complete Markdown
function generateResume(data) {
    const contactMarkdown = generateContact(data);
    const summaryMarkdown = generateSummary(data.summary);
    const workExperienceMarkdown = generateWorkExperience(data);
    const educationMarkdown = generateEducation(data.education);
    const languagesMarkdown = generateLanguages(data.languages);

    const markdown = `
# ${data.name}

${summaryMarkdown}

${contactMarkdown}

${workExperienceMarkdown}

${educationMarkdown}

${languagesMarkdown}
`;

    return markdown;
}

// Write the generated resume to a markdown file
const resumeMarkdown = generateResume(data);

// Save the resume to a file
fs.writeFileSync('../resume-petros_savidis.md', resumeMarkdown, 'utf8');
console.log('Resume generated successfully: resume.md');
