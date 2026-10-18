interface Job {
    title: string;
    description: string;
    location: string;
    requiredSkills: string[];
}

// Derived from the Zod schema so the runtime validator and the types can't drift.
type Feedback = import("~/lib/schemas").Feedback;

type ResumeStatus = "processing" | "done" | "failed";

interface Resume {
    id: string;
    companyName?: string;
    jobTitle?: string;
    jobDescription?: string;
    imagePath: string;
    resumePath: string;
    status?: ResumeStatus; // missing on records created before statuses existed
    feedback: Feedback | null;
    error?: string;
}
