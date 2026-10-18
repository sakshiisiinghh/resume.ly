import { describe, expect, it } from "vitest";
import { extractJobTerms, matchKeywords } from "../keywords";

const names = (skills: { name: string }[]) => skills.map((s) => s.name);

describe("extractJobTerms", () => {
    it("finds skills and their canonical names", () => {
        const { required } = extractJobTerms("We use Postgres, k8s and Node.js with TypeScript.");

        expect(names(required)).toEqual(["PostgreSQL", "Kubernetes", "Node.js", "TypeScript"]);
    });

    it("splits required from nice-to-have by section heading", () => {
        const jd = ["Requirements:", "- Python and PostgreSQL", "Nice to have:", "- Kafka", "- Terraform"].join("\n");
        const { required, nice } = extractJobTerms(jd);

        expect(names(required)).toEqual(["Python", "PostgreSQL"]);
        expect(names(nice)).toEqual(["Kafka", "Terraform"]);
    });

    it("recognises inline qualifiers", () => {
        const { required, nice } = extractJobTerms("Strong Python.\nExperience with Docker is a plus.");

        expect(names(required)).toEqual(["Python"]);
        expect(names(nice)).toEqual(["Docker"]);
    });

    it("keeps a skill required if it is required anywhere", () => {
        const jd = ["Nice to have:", "- Docker", "Requirements:", "- Docker and Go"].join("\n");
        const { required, nice } = extractJobTerms(jd);

        expect(names(required)).toEqual(["Docker", "Go"]);
        expect(nice).toEqual([]);
    });

    it("returns nothing for a description with no recognised skills", () => {
        expect(extractJobTerms("We value teamwork and a growth mindset.")).toEqual({ required: [], nice: [] });
    });

    describe("word boundaries", () => {
        it.each([
            ["SQL is required", ["SQL"]],
            ["PostgreSQL and MySQL", ["PostgreSQL", "MySQL"]],
            ["NoSQL stores", ["NoSQL"]],
            ["Java and JavaScript", ["JavaScript", "Java"]],
            ["C++ or C# experience", ["C++", "C#"]],
            ["Node.js, Next.js and Vue.js", ["Node.js", "Next.js", "Vue"]],
            ["Built with ASP.NET", [".NET"]],
        ])("%s", (text, expected) => {
            expect(names(extractJobTerms(text).required).sort()).toEqual([...expected].sort());
        });
    });

    describe("ambiguous words", () => {
        it.each([
            "Go-to-market strategy and go live plans",
            "Let's go build things",
            "R&D team",
            "We swift react to customer needs",
            "The express lane and a spark of creativity",
        ])("doesn't read ordinary English as a skill: %s", (text) => {
            expect(names(extractJobTerms(text).required)).toEqual([]);
        });

        it.each([
            ["Experience with Go, Python", "Go"],
            ["Experience with golang services", "Go"],
            ["Strong React and Redux skills", "React"],
            ["Apache Spark pipelines", "Apache Spark"],
            ["Experience with Rust", "Rust"],
        ])("still finds the real skill in %s", (text, skill) => {
            expect(names(extractJobTerms(text).required)).toContain(skill);
        });
    });
});

describe("skills named inside longer ones", () => {
    const skillsIn = (text: string) => names(extractJobTerms(text).required);

    it("doesn't count CSS inside Tailwind CSS", () => {
        expect(skillsIn("Experience with Tailwind CSS")).toEqual(["Tailwind CSS"]);
    });

    it("still counts CSS when it appears on its own as well", () => {
        expect(skillsIn("HTML, CSS and Tailwind CSS").sort()).toEqual(["CSS", "HTML", "Tailwind CSS"]);
    });

    it("counts a skill once when an alias and an exact name overlap", () => {
        const result = matchKeywords("Built REST APIs and Apache Spark jobs", extractJobTerms("REST APIs, Apache Spark"))!;

        expect(result.required.matched.map((m) => [m.term, m.count])).toEqual([["REST APIs", 1], ["Apache Spark", 1]]);
    });

    it("matches a skill whose name is split by a line wrap", () => {
        const resume = "Created components with Tailwind\nCSS and wrote unit\ntests for them";
        const result = matchKeywords(resume, extractJobTerms("Tailwind CSS, CSS, unit tests"))!;

        expect(result.required.matched.map((m) => m.term)).toEqual(["Tailwind CSS", "Unit Testing"]);
        expect(result.required.missing).toEqual(["CSS"]);
    });
});

describe("words that are also skills", () => {
    const found = (text: string) => names(extractJobTerms(text).required);

    it.each([
        "React to customer feedback and update the pages",
        "Express ownership of your work from design to production.",
        "Swift response to production incidents",
        "Go to market with a clear plan",
        "Rust never sleeps",
    ])("ignores %s", (text) => {
        expect(found(text)).toEqual([]);
    });

    it.each([
        ["Built a portal with React and TypeScript", "React"],
        ["Frontend: React", "React"],
        ["Experience with Rust", "Rust"],
        ["Languages: Go, Python", "Go"],
        ["Express, Koa and Fastify", "Express.js"],
        ["Strong React", "React"],
    ])("finds the skill in %s", (text, skill) => {
        expect(found(text)).toContain(skill);
    });

    it("accepts the word when another skill on the line gives it context", () => {
        expect(found("React skills and Docker experience")).toContain("React");
    });
});

describe("required and nice-to-have sections", () => {
    const split = (jd: string) => {
        const { required, nice } = extractJobTerms(jd);
        return { required: names(required), nice: names(nice) };
    };

    it.each(["A plus:", "It would be great if you also know:", "Preferred:", "Bonus points:", "Good to have:", "Would be nice:"])("treats %s as a nice-to-have section", (heading) => {
        expect(split(`Requirements:\n- Go\n${heading}\n- Kafka`)).toEqual({ required: ["Go"], nice: ["Kafka"] });
    });

    it("returns to required after a requirements heading", () => {
        expect(split("A plus:\n- Kafka\nMust have:\n- Go")).toEqual({ required: ["Go"], nice: ["Kafka"] });
    });

    it("keeps the current section when a heading says neither", () => {
        expect(split("Nice to have:\n- Kafka\nTools:\n- Docker")).toEqual({ required: [], nice: ["Kafka", "Docker"] });
    });

    it("doesn't treat a long sentence ending in a colon as a heading", () => {
        const jd = "Requirements:\n- Go\nWe would love to hear about anything you have built, shipped or run in production that is a bonus:\n- Redis";

        expect(split(jd).required).toContain("Redis");
    });
});

describe("matchKeywords", () => {
    const resume = "Built services in Go and Python on PostgreSQL. Deployed with Docker on AWS. Wrote REST APIs.";

    it("reports matched and missing terms with evidence", () => {
        const terms = extractJobTerms("Requirements:\nGo, PostgreSQL, Kubernetes\nNice to have:\nRedis");
        const result = matchKeywords(resume, terms)!;

        expect(result.required.matched.map((m) => m.term)).toEqual(["Go", "PostgreSQL"]);
        expect(result.required.missing).toEqual(["Kubernetes"]);
        expect(result.nice.missing).toEqual(["Redis"]);
        expect(result.required.matched[0].evidence).toContain("services in Go");
    });

    it("quotes only the resume line that contains the match", () => {
        const result = matchKeywords("Intro line about nothing\nBuilt services in Go\nUnrelated closing line", extractJobTerms("Go"))!;

        expect(result.required.matched[0].evidence).toBe("Built services in Go");
    });

    it("counts mentions", () => {
        const result = matchKeywords("Python, python and PYTHON", extractJobTerms("Python"))!;

        expect(result.required.matched[0].count).toBe(3);
    });

    it("matches aliases in the resume", () => {
        const result = matchKeywords("Ran k8s on GCP with postgres and nodejs", extractJobTerms("Kubernetes, Google Cloud, PostgreSQL, Node.js"))!;

        expect(result.required.missing).toEqual([]);
    });

    it("weights required skills fully and nice-to-haves by half", () => {
        const terms = extractJobTerms("Requirements:\nGo, Kubernetes\nNice to have:\nDocker, Redis");
        const result = matchKeywords("Go and Docker", terms)!;

        // earned 1 + 0.5 out of 2 + 1
        expect(result.coverage).toBe(50);
    });

    it("scores 0 when nothing matches and 100 when everything does", () => {
        const terms = extractJobTerms("Go and Docker");

        expect(matchKeywords("Gardening", terms)!.coverage).toBe(0);
        expect(matchKeywords("Go and Docker", terms)!.coverage).toBe(100);
    });

    it("returns null when the job description has no recognised skills", () => {
        expect(matchKeywords(resume, extractJobTerms("A friendly team"))).toBeNull();
    });

    it("is case-sensitive only for ambiguous names", () => {
        const terms = extractJobTerms("Go and Docker");

        expect(matchKeywords("I like to go home, docker", terms)!.required.matched.map((m) => m.term)).toEqual(["Docker"]);
    });
});
