import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileUploader from "~/components/FileUploader";

const pdf = () => new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" });

describe("FileUploader", () => {
    it("shows the selected file from props", () => {
        render(<FileUploader file={pdf()} onFileSelect={() => {}} />);
        expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    });

    it("remove button clears the file without submitting the surrounding form", async () => {
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
        const onFileSelect = vi.fn();
        render(
            <form onSubmit={onSubmit}>
                <FileUploader file={pdf()} onFileSelect={onFileSelect} />
            </form>
        );

        await userEvent.click(screen.getByRole("button", { name: "Remove file" }));

        expect(onFileSelect).toHaveBeenCalledWith(null);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("passes a dropped PDF to the parent", async () => {
        const onFileSelect = vi.fn();
        const { container } = render(<FileUploader file={null} onFileSelect={onFileSelect} />);
        const input = container.querySelector("input[type=file]") as HTMLInputElement;

        const file = pdf();
        await userEvent.upload(input, file);

        expect(onFileSelect).toHaveBeenCalledWith(file);
    });
});
