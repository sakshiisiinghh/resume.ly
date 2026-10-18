import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { aiResponse, validFeedback } from "../../../test/fixtures";

const navigate = vi.fn();
vi.mock("react-router", async (importOriginal) => ({
    ...(await importOriginal<typeof import("react-router")>()),
    useNavigate: () => navigate,
}));

const RESUME_TEXT = "Sakshi Singh\nBackend Engineer\nGo, Node.js, PostgreSQL";
const extractPdfText = vi.fn();
vi.mock("~/lib/pdfText", () => ({ extractPdfText: (...args: unknown[]) => extractPdfText(...args) }));

vi.mock("~/lib/pdf2img", () => ({
    convertPdfToImage: vi.fn(async () => ({
        file: new File(["png"], "resume.png", { type: "image/png" }),
    })),
}));

const store = {
    isLoading: false,
    auth: { isAuthenticated: true },
    fs: { upload: vi.fn() },
    ai: { feedback: vi.fn() },
    kv: { set: vi.fn() },
};
vi.mock("~/lib/puter", () => ({ usePuterStore: () => store }));

import Upload from "~/routes/upload";

const renderUpload = () =>
    render(
        <MemoryRouter>
            <Upload />
        </MemoryRouter>
    );

const selectPdfAndSubmit = async (container: HTMLElement) => {
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" }));
    await userEvent.type(screen.getByLabelText("Job Title"), "Backend Engineer");
    await userEvent.click(screen.getByRole("button", { name: "Analyze Resume" }));
};

const kvWrites = () => store.kv.set.mock.calls.map(([, value]) => JSON.parse(value as string));

describe("Upload route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.kv.set.mockResolvedValue(true);
        store.fs.upload.mockImplementation(async ([file]: File[]) => ({ path: `/files/${file.name}` }));
        extractPdfText.mockResolvedValue({ ok: true, text: RESUME_TEXT, pageCount: 1 });
    });

    it("stops before uploading anything when the PDF has no readable text", async () => {
        extractPdfText.mockResolvedValue({ ok: false, error: "This PDF has little or no selectable text" });
        const { container } = renderUpload();

        await selectPdfAndSubmit(container);

        expect(await screen.findByRole("alert")).toHaveTextContent("no selectable text");
        expect(store.fs.upload).not.toHaveBeenCalled();
        expect(store.kv.set).not.toHaveBeenCalled();
        expect(store.ai.feedback).not.toHaveBeenCalled();
    });

    it("asks for a file instead of silently doing nothing", async () => {
        renderUpload();
        await userEvent.click(screen.getByRole("button", { name: "Analyze Resume" }));

        expect(screen.getByRole("alert")).toHaveTextContent("Please select a PDF");
        expect(store.fs.upload).not.toHaveBeenCalled();
    });

    it("shows an error and restores the form when the upload fails", async () => {
        store.fs.upload.mockResolvedValue(undefined);
        const { container } = renderUpload();

        await selectPdfAndSubmit(container);

        expect(await screen.findByRole("alert")).toHaveTextContent("Failed to upload file");
        expect(screen.getByRole("button", { name: "Analyze Resume" })).toBeVisible();
        expect(screen.getByLabelText("Job Title")).toHaveValue("Backend Engineer");
        expect(store.kv.set).not.toHaveBeenCalled();
    });

    it("marks the record failed (no fake score) when the AI output stays invalid", async () => {
        store.ai.feedback.mockResolvedValue(aiResponse("not json"));
        const { container } = renderUpload();

        await selectPdfAndSubmit(container);

        expect(await screen.findByRole("alert")).toHaveTextContent("Failed to analyze resume");
        expect(store.ai.feedback).toHaveBeenCalledTimes(2);
        const writes = kvWrites();
        expect(writes[0]).toMatchObject({ status: "processing", feedback: null });
        expect(writes.at(-1)).toMatchObject({ status: "failed", feedback: null });
        expect(navigate).not.toHaveBeenCalled();
    });

    it("saves validated feedback and navigates on success", async () => {
        store.ai.feedback.mockResolvedValue(aiResponse(JSON.stringify(validFeedback)));
        const { container } = renderUpload();

        await selectPdfAndSubmit(container);

        await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/resume\//)));
        expect(store.ai.feedback).toHaveBeenCalledWith(RESUME_TEXT, expect.any(String));
        expect(kvWrites().at(-1)).toMatchObject({ status: "done", feedback: validFeedback, jobTitle: "Backend Engineer" });
    });
});
