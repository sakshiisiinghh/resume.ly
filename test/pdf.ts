const escapePdf = (text: string) => text.replace(/[\\()]/g, "\\$&");

export function makePdf(lines: string[]): Buffer {
    const content = ["BT", "/F1 12 Tf", "14 TL", "50 750 Td", ...lines.map((l) => `(${escapePdf(l)}) Tj T*`), "ET"].join("\n");
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];

    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefAt = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
}

export const resumeLines = [
    "Sakshi Singh",
    "Backend Engineer",
    "Built idempotent settlement services in Go for an EV charging platform.",
    "Designed a push based synchronization pipeline with pull based recovery.",
    "Skills: Go, Node.js, PostgreSQL, Redis, Docker, TypeScript, React.",
    "Education: B.Tech in Electronics and Communication Engineering.",
];
