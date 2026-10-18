import type { Domain, Tier } from "./types";

export interface Parts {
    name: string;
    email: string;
    phone: string;
    link: string;
    education: string[];
    experience: string[];
    projects: string[];
    skills: string[];
}

// {EDU}, {JOB1} and {JOB2} are filled in by the date style a variant picks.
export interface Content {
    parts: Parts;
    mentions: string[];
}

export const DATES = {
    full: { EDU: ", 2018 - 2022", JOB1: ", July 2023 - Present", JOB2: ", June 2022 - August 2022" },
    mixed: { EDU: ", 2018 - 2022", JOB1: ", July 2023 - Present", JOB2: ", Jun 2022 - Aug 2022" },
    reversed: { EDU: ", 2018 - 2022", JOB1: ", July 2023 - Present", JOB2: ", August 2022 - June 2022" },
    none: { EDU: "", JOB1: "", JOB2: "" },
} as const;

const backend: Record<Tier, Content> = {
    strong: {
        parts: {
            name: "Aarav Mehta",
            email: "aarav.mehta@example.com",
            phone: "+91 98765 43210",
            link: "github.com/aaravmehta",
            education: ["Delhi Technological University, B.Tech in Computer Engineering{EDU}"],
            experience: [
                "Backend Engineer, Northwind Payments{JOB1}",
                "Built Go services on Postgres and Redis that process 2M payments a day with 99.95% uptime.",
                "Designed gRPC and REST APIs for 14 internal teams, cutting integration time from 3 weeks to 4 days.",
                "Moved 30 microservices to k8s on AWS and reduced infrastructure cost by 28%.",
                "Introduced Kafka event streaming that removed 1.2M daily polling requests.",
                "Software Engineering Intern, Brightside Labs{JOB2}",
                "Wrote Python tooling and CI/CD pipelines with Docker that shortened releases from 2 hours to 25 minutes.",
                "Added unit tests that raised coverage of the billing module from 40% to 85%.",
            ],
            projects: [
                "Ledger: an append-only double-entry ledger in Go with PostgreSQL and property-based tests.",
                "Queue: a Redis-backed job scheduler with retries and backoff.",
            ],
            skills: ["Languages: Go, Python, SQL", "Infrastructure: Docker, Kubernetes, AWS, Linux, Git", "Data: PostgreSQL, Redis, Kafka"],
        },
        mentions: ["Go", "Python", "SQL", "PostgreSQL", "Redis", "gRPC", "REST APIs", "Microservices", "Kubernetes", "AWS", "Kafka", "CI/CD", "Docker", "Unit Testing", "Linux", "Git"],
    },
    average: {
        parts: {
            name: "Neha Kulkarni",
            email: "neha.kulkarni@example.com",
            phone: "+91 91234 56789",
            link: "github.com/nehakulkarni",
            education: ["Pune Institute of Technology, B.E. in Information Technology{EDU}"],
            experience: [
                "Backend Engineer, Northwind Payments{JOB1}",
                "Worked on Go services using Postgres and Redis for the payments team.",
                "Developed REST APIs that other teams use for their features.",
                "Helped move some services to Kubernetes on AWS during the migration project.",
                "Took part in code reviews and sprint planning with the team.",
                "Software Engineering Intern, Brightside Labs{JOB2}",
                "Wrote Python scripts and helped maintain the CI/CD pipeline using Docker.",
                "Wrote some unit tests for the billing module and fixed bugs from the backlog.",
            ],
            projects: ["Ledger: a ledger service written in Go with PostgreSQL.", "Queue: a simple job scheduler that uses Redis."],
            skills: ["Skills: Go, Python, SQL, Docker, Kubernetes, AWS, PostgreSQL, Redis, Git"],
        },
        mentions: ["Go", "Python", "SQL", "PostgreSQL", "Redis", "REST APIs", "Kubernetes", "AWS", "CI/CD", "Docker", "Unit Testing", "Git"],
    },
    weak: {
        parts: {
            name: "Sam Verma",
            email: "sam.verma@example.com",
            phone: "+91 90000 11111",
            link: "github.com/samverma",
            education: ["State College, Bachelors in Computer Science{EDU}"],
            experience: [
                "Backend Developer, Northwind Payments{JOB1}",
                "I was responsible for backend work and fixing bugs in the code.",
                "Responsible for apis and databases in the team and also other tasks.",
                "Did deployments with the cloud team when needed.",
                "Attended meetings and worked with many people on many things.",
                "Intern, Brightside Labs{JOB2}",
                "Helped with python scripts and testing of the application.",
                "Learned about devops and attended trainings on new tools.",
                "Worked hard and was a good team player who learns quickly.",
            ],
            projects: ["Made a ledger app for a college project.", "Made a job queue app to learn more."],
            skills: ["Skills: Go, Python, SQL, Git, teamwork, communication, hard working"],
        },
        mentions: ["Go", "Python", "SQL", "Git"],
    },
};

const fullstack: Record<Tier, Content> = {
    strong: {
        parts: {
            name: "Isha Kapoor",
            email: "isha.kapoor@example.com",
            phone: "(415) 555-0172",
            link: "linkedin.com/in/ishakapoor",
            education: ["Georgia Tech, B.S. in Computer Science{EDU}"],
            experience: [
                "Full-Stack Engineer, Lumen Health{JOB1}",
                "Built a patient portal in TypeScript, React and NodeJS used by 120K patients.",
                "Replaced REST endpoints with a GraphQL API and cut mobile payload size by 45%.",
                "Moved the web app to Next.js and improved Largest Contentful Paint from 4.1s to 1.8s.",
                "Designed PostgreSQL schemas and migrations for appointments and billing.",
                "Frontend Intern, Pixel & Co{JOB2}",
                "Created a design system with Tailwind CSS and Storybook adopted by 6 product teams.",
                "Wrote Jest and Cypress tests that caught 30+ regressions before release.",
            ],
            projects: [
                "Trackr: a job-application tracker built with Next.js, Prisma and PostgreSQL.",
                "Chatly: a real-time chat app using Node.js, WebSockets and Redis.",
            ],
            skills: [
                "Languages: TypeScript, JavaScript, SQL",
                "Frontend: React, Next.js, Tailwind CSS, Redux, HTML, CSS",
                "Backend: Node.js, GraphQL, PostgreSQL, Redis, REST APIs",
                "Tools: Docker, Git, GitHub Actions, Jest, Cypress",
            ],
        },
        mentions: ["TypeScript", "React", "Node.js", "GraphQL", "REST APIs", "Next.js", "PostgreSQL", "Tailwind CSS", "Storybook", "Jest", "Cypress", "WebSockets", "Redis", "Prisma", "JavaScript", "SQL", "Redux", "HTML", "CSS", "Docker", "Git", "GitHub Actions"],
    },
    average: {
        parts: {
            name: "Kabir Sethi",
            email: "kabir.sethi@example.com",
            phone: "(212) 555-0148",
            link: "linkedin.com/in/kabirsethi",
            education: ["Ohio State University, B.S. in Computer Science{EDU}"],
            experience: [
                "Software Engineer, Lumen Health{JOB1}",
                "Developed pages for the patient portal using React and TypeScript.",
                "Worked on Node.js services that talk to a PostgreSQL database.",
                "Helped add a GraphQL endpoint for the mobile team.",
                "Took part in code reviews and planning meetings every sprint.",
                "Frontend Intern, Pixel & Co{JOB2}",
                "Helped build components with Tailwind CSS for the design system.",
                "Wrote some Jest tests for the new components.",
            ],
            projects: ["Trackr: a job tracker with Next.js and PostgreSQL.", "Chatly: a chat app using Node.js and WebSockets."],
            skills: ["Skills: TypeScript, JavaScript, React, Node.js, PostgreSQL, GraphQL, Next.js, Tailwind CSS, Jest, Git"],
        },
        mentions: ["TypeScript", "React", "Node.js", "PostgreSQL", "GraphQL", "Tailwind CSS", "Jest", "Next.js", "WebSockets", "JavaScript", "Git"],
    },
    weak: {
        parts: {
            name: "Dev Malhotra",
            email: "dev.malhotra@example.com",
            phone: "(646) 555-0190",
            link: "linkedin.com/in/devmalhotra",
            education: ["City University, Bachelors in Information Systems{EDU}"],
            experience: [
                "Web Developer, Lumen Health{JOB1}",
                "I was responsible for the website and fixing problems that people reported.",
                "React to customer feedback and update the pages when asked by the manager.",
                "Worked with the backend team on some tasks and attended all the meetings.",
                "Did many things for the team and helped wherever it was needed.",
                "Intern, Pixel & Co{JOB2}",
                "Helped with the website and learned javascript and some css.",
                "Worked hard and was a fast learner who is passionate about technology.",
            ],
            projects: ["Made a portfolio website for myself.", "Made a todo app to learn javascript."],
            skills: ["Skills: JavaScript, HTML, CSS, Git, teamwork, communication, hard working"],
        },
        mentions: ["JavaScript", "HTML", "CSS", "Git"],
    },
};

const data: Record<Tier, Content> = {
    strong: {
        parts: {
            name: "Rohan Das",
            email: "rohan.das@example.com",
            phone: "+44 7700 900123",
            link: "github.com/rohandas",
            education: ["University of Edinburgh, MSc in Data Science{EDU}"],
            experience: [
                "Data Scientist, Meridian Retail{JOB1}",
                "Built demand forecasting models in Python with PyTorch that reduced stockouts by 18%.",
                "Wrote SQL and Pandas pipelines on Snowflake that cut weekly reporting from 2 days to 3 hours.",
                "Orchestrated 40 Airflow DAGs and moved batch jobs to Apache Spark, making them 6x faster.",
                "Deployed models behind a FastAPI service on AWS with Docker.",
                "Led R&D for a new pricing model and a go-to-market pilot across 3 regions.",
                "Data Analyst Intern, Quanta Labs{JOB2}",
                "Used NumPy and scikit-learn to segment 2M customers and lifted campaign conversion by 9%.",
                "Presented findings to leadership and created dashboards used weekly.",
            ],
            projects: ["Churn: an end-to-end machine learning project with scikit-learn and TensorFlow.", "Reco: a recommender prototype evaluated with offline metrics."],
            skills: ["Languages: Python, SQL", "ML: PyTorch, scikit-learn, TensorFlow, NumPy, Pandas", "Data: Snowflake, Airflow, Apache Spark", "Cloud: AWS, Docker, Git"],
        },
        mentions: ["Python", "PyTorch", "SQL", "Pandas", "Snowflake", "Airflow", "Apache Spark", "FastAPI", "AWS", "Docker", "NumPy", "scikit-learn", "Machine Learning", "TensorFlow", "Git"],
    },
    average: {
        parts: {
            name: "Priya Nair",
            email: "priya.nair@example.com",
            phone: "+44 7700 900456",
            link: "github.com/priyanair",
            education: ["University of Leeds, MSc in Analytics{EDU}"],
            experience: [
                "Data Scientist, Meridian Retail{JOB1}",
                "Built forecasting models in Python and worked with the planning team.",
                "Used SQL and Pandas to prepare data for reports on Snowflake.",
                "Helped schedule jobs with Airflow and ran some Spark jobs.",
                "Took part in project meetings and reviews with stakeholders.",
                "Data Analyst Intern, Quanta Labs{JOB2}",
                "Used NumPy and scikit-learn to group customers for marketing.",
                "Made dashboards for the marketing team and helped with ad hoc requests.",
            ],
            projects: ["Churn: a machine learning project using scikit-learn.", "Reco: a small recommender built in Python."],
            skills: ["Skills: Python, SQL, Pandas, NumPy, scikit-learn, Snowflake, Airflow, Spark, AWS, Git"],
        },
        mentions: ["Python", "SQL", "Pandas", "Snowflake", "Airflow", "Apache Spark", "NumPy", "scikit-learn", "Machine Learning", "AWS", "Git"],
    },
    weak: {
        parts: {
            name: "Arjun Rao",
            email: "arjun.rao@example.com",
            phone: "+44 7700 900789",
            link: "github.com/arjunrao",
            education: ["Midlands University, BSc in Mathematics{EDU}"],
            experience: [
                "Analyst, Meridian Retail{JOB1}",
                "I was responsible for reports and data for the team and other tasks.",
                "Did analysis in excel and sometimes used python when needed.",
                "Attended meetings with the business and shared the numbers with them.",
                "Worked with many people on many projects and helped wherever needed.",
                "Intern, Quanta Labs{JOB2}",
                "Helped with data cleaning and made some charts for the managers.",
                "Worked hard and was a fast learner who loves data and numbers.",
            ],
            projects: ["Made a data project for college using python.", "Made a dashboard to learn about data."],
            skills: ["Skills: Python, SQL, Excel, teamwork, communication, hard working"],
        },
        mentions: ["Python", "SQL"],
    },
};

export const CONTENT: Record<Domain, Record<Tier, Content>> = { backend, fullstack, data };
