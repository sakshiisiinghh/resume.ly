const escapePdf = (text: string) => text.replace(/[\\()]/g, "\\$&");

export interface PdfText {
    text: string;
    x: number;
    y: number;
    size?: number;
}

export interface PdfPage {
    items?: PdfText[];
    image?: boolean;
    width?: number;
    height?: number;
}

const IMAGE = "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream";

export function buildPdf(pages: PdfPage[]): Buffer {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body) && objects.length;

    const catalog = add("");
    const pagesRoot = add("");
    const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const image = pages.some((p) => p.image) ? add(IMAGE) : null;

    const pageIds = pages.map((page) => {
        const width = page.width ?? 612;
        const height = page.height ?? 792;
        const ops = [
            ...(page.items ?? []).map((i) => `BT /F1 ${i.size ?? 11} Tf ${i.x} ${i.y} Td (${escapePdf(i.text)}) Tj ET`),
            ...(page.image ? [`q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`] : []),
        ].join("\n");

        const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
        const xobject = page.image ? ` /XObject << /Im1 ${image} 0 R >>` : "";
        return add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >>${xobject} >> >>`);
    });

    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
    objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(Buffer.byteLength(pdf, "latin1"));
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefAt = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
}

/** Lines stacked top to bottom in one column. */
export function columnItems(lines: string[], { x = 50, top = 750, step = 15, size = 11 } = {}): PdfText[] {
    return lines.map((text, i) => ({ text, x, y: top - i * step, size }));
}

export function makePdf(lines: string[]): Buffer {
    return buildPdf([{ items: columnItems(lines, { step: 14, size: 12 }) }]);
}

export const resumeLines = [
    "Sakshi Singh",
    "Backend Engineer",
    "Built idempotent settlement services in Go for an EV charging platform.",
    "Designed a push based synchronization pipeline with pull based recovery.",
    "Skills: Go, Node.js, PostgreSQL, Redis, Docker, TypeScript, React.",
    "Education: B.Tech in Electronics and Communication Engineering.",
];

export const cleanResumeLines = [
    "Jane Doe",
    "+1 415 555 0123 | jane.doe@example.com | github.com/janedoe",
    "Education",
    "State University, B.Sc. in Computer Science, 2018 - 2022",
    "Experience",
    "Backend Engineer, Acme Payments, July 2023 - Present",
    "Built Go services on PostgreSQL and Redis that process 2M payments a day.",
    "Designed REST APIs and gRPC services deployed with Kubernetes on AWS.",
    "Cut p95 latency from 480ms to 190ms by adding Redis caching and batching.",
    "Software Intern, Beta Labs, June 2022 - August 2022",
    "Wrote Python tooling and CI/CD pipelines with Docker and GitHub Actions.",
    "Added unit tests that raised coverage of the billing module from 40% to 85%.",
    "Projects",
    "Chat app: real-time messaging with Node.js, WebSockets, React and PostgreSQL.",
    "Job tracker: full-stack TypeScript app with a REST API and Docker deployment.",
    "Skills",
    "Languages: Go, Python, TypeScript, SQL. Tools: Docker, Kubernetes, Git, Linux.",
];

const LEFT = ["Skills", "Go, Python, SQL", "Docker, Kubernetes", "PostgreSQL, Redis", "AWS, Linux, Git", "Education", "State University", "B.Sc. Computer Science", "2018 - 2022", "Contact", "jane.doe@example.com", "+1 415 555 0123"];
const RIGHT = ["Experience", "Backend Engineer, Acme Payments, July 2023 - Present", "Built Go services on PostgreSQL and Redis for payments.", "Designed REST APIs and gRPC services on Kubernetes.", "Cut p95 latency from 480ms to 190ms with Redis caching.", "Software Intern, Beta Labs, June 2022 - August 2022", "Wrote Python tooling and CI/CD pipelines with Docker.", "Added unit tests, raising billing coverage to 85%.", "Projects", "Chat app with Node.js, WebSockets and React.", "Job tracker with a REST API and Docker.", "Open source contributions to Go libraries."];

/** A two-column resume. The content stream lists the left column, then the right (how most generators write it). */
export function twoColumnItems(): PdfText[] {
    return [...columnItems(LEFT, { x: 40, size: 10 }), ...columnItems(RIGHT, { x: 300, size: 10 })];
}

/** The same layout, but the stream alternates between the columns line by line. */
export function interleavedTwoColumnItems(): PdfText[] {
    const left = columnItems(LEFT, { x: 40, size: 10 });
    const right = columnItems(RIGHT, { x: 300, size: 10 });
    return left.flatMap((item, i) => [item, right[i]]);
}
