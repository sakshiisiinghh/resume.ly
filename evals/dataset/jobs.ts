import type { JobCase } from "./types";

export const JOBS: JobCase[] = [
    {
        id: "backend-go",
        domain: "backend",
        title: "Backend Engineer",
        required: ["Go", "Concurrency", "PostgreSQL", "Redis", "Docker", "Kubernetes", "REST APIs", "gRPC", "Microservices"],
        nice: ["Kafka", "Terraform", "AWS", "ClickHouse"],
        description: `Backend Engineer, Payments Platform

You will build and run the services that move money for millions of customers. You'll partner with product on go-to-market launches and with the R&D team on new rails.

Requirements:
- Strong Go experience, including concurrency
- PostgreSQL and Redis in production
- Docker and Kubernetes
- Designing REST APIs and gRPC services
- A microservices mindset and comfort with on-call

Nice to have:
- Kafka or another event streaming system
- Terraform and AWS
- ClickHouse for analytics`,
    },
    {
        id: "backend-java",
        domain: "backend",
        title: "Java Platform Engineer",
        required: ["Java", "Spring Boot", "PostgreSQL", "Hibernate", "Kafka", "Microservices", "AWS", "CI/CD"],
        nice: ["Kubernetes", "Terraform", "Redis", "Elasticsearch"],
        description: `Java Platform Engineer

Join the platform team that powers our order and billing systems.

What you'll need:
- Java and Spring Boot
- PostgreSQL with Hibernate
- Kafka for event-driven microservices
- AWS and a CI/CD pipeline you trust

Preferred qualifications:
- Kubernetes and Terraform
- Redis caching
- Elasticsearch for search`,
    },
    {
        id: "fullstack-ts",
        domain: "fullstack",
        title: "Full-Stack Engineer",
        required: ["TypeScript", "React", "Node.js", "PostgreSQL", "REST APIs", "Git"],
        nice: ["GraphQL", "Next.js", "Tailwind CSS", "Jest", "Docker", "Prisma", "tRPC"],
        description: `Full-Stack Engineer

We are a small team shipping a scheduling product used by clinics. Express ownership of your work from design to production.

You have:
- TypeScript and React on the front end
- Node.js services backed by PostgreSQL
- Experience building REST APIs
- Git and code review habits

Bonus points:
- GraphQL, Next.js and Tailwind CSS
- Jest and Docker
- Prisma or tRPC`,
    },
    {
        id: "fullstack-frontend",
        domain: "fullstack",
        title: "Frontend Engineer",
        required: ["JavaScript", "React", "HTML", "CSS", "TypeScript", "Jest", "Unit Testing"],
        nice: ["Redux", "Cypress", "Storybook", "Webpack", "Figma"],
        description: `Frontend Engineer

Own the interface of our analytics product.

Requirements:
- JavaScript, HTML and CSS fundamentals
- React and TypeScript
- Unit tests with Jest

A plus:
- Redux for state management
- Cypress end-to-end tests and Storybook
- Webpack tuning and working from Figma designs`,
    },
    {
        id: "data-ml",
        domain: "data",
        title: "Machine Learning Engineer",
        required: ["Python", "SQL", "Pandas", "NumPy", "scikit-learn", "Machine Learning"],
        nice: ["PyTorch", "TensorFlow", "Docker", "AWS", "MLflow"],
        description: `Machine Learning Engineer

Turn messy retail data into models that ship.

Requirements:
- Python, SQL, Pandas and NumPy
- scikit-learn and solid machine learning fundamentals

Nice to have:
- PyTorch or TensorFlow
- Docker and AWS
- MLflow for experiment tracking`,
    },
    {
        id: "data-eng",
        domain: "data",
        title: "Data Engineer",
        required: ["Python", "SQL", "Airflow", "Snowflake", "Apache Spark", "AWS"],
        nice: ["Kafka", "Terraform", "dbt", "Docker"],
        description: `Data Engineer

Build the pipelines our analysts and models depend on.

Must have:
- Python and SQL
- Airflow to orchestrate batch jobs
- Snowflake and Apache Spark
- AWS

It would be great if you also know:
- Kafka, Terraform, dbt and Docker`,
    },
];

export const job = (id: string): JobCase => {
    const found = JOBS.find((j) => j.id === id);
    if (!found) throw new Error(`Unknown job ${id}`);
    return found;
};
