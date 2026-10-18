import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const store = {
    fs: { delete: vi.fn() },
    kv: { delete: vi.fn() },
};
vi.mock("~/lib/puter", () => ({ usePuterStore: () => store }));

import DeleteResumeButton from "~/components/DeleteResumeButton";

const resume = { id: "abc", resumePath: "/r.pdf", imagePath: "/r.png", companyName: "Fluxton" };

describe("DeleteResumeButton", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.fs.delete.mockResolvedValue(undefined);
        store.kv.delete.mockResolvedValue(true);
    });
    afterEach(() => vi.restoreAllMocks());

    it("does nothing when the user cancels the confirmation", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(false);
        const onDeleted = vi.fn();
        render(<DeleteResumeButton resume={resume} onDeleted={onDeleted} />);

        await userEvent.click(screen.getByRole("button", { name: "Delete Fluxton" }));

        expect(store.kv.delete).not.toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it("deletes and notifies the parent after confirmation", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        const onDeleted = vi.fn();
        render(<DeleteResumeButton resume={resume} onDeleted={onDeleted} />);

        await userEvent.click(screen.getByRole("button", { name: "Delete Fluxton" }));

        expect(store.kv.delete).toHaveBeenCalledWith("resume:abc");
        expect(onDeleted).toHaveBeenCalledOnce();
    });

    it("shows an error and re-enables the button when deletion fails", async () => {
        vi.spyOn(window, "confirm").mockReturnValue(true);
        store.kv.delete.mockRejectedValue(new Error("network down"));
        const onDeleted = vi.fn();
        render(<DeleteResumeButton resume={resume} onDeleted={onDeleted} />);

        await userEvent.click(screen.getByRole("button", { name: "Delete Fluxton" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("network down");
        expect(screen.getByRole("button", { name: "Delete Fluxton" })).toBeEnabled();
        expect(onDeleted).not.toHaveBeenCalled();
    });
});
