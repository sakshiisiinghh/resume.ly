interface Job {
    title: string;
    description: string;
    location: string;
    requiredSkills: string[];
}

// Derived from the Zod schema so the runtime validator and the types can't drift.
type Feedback = import("~/lib/schemas").Feedback;
