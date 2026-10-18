import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Details from "~/components/Details";
import { validFeedback } from "../../../test/fixtures";

describe("Details", () => {
    it("shows a tip's explanation when there is one", async () => {
        render(<Details feedback={validFeedback} />);

        await userEvent.click(screen.getByRole("button", { name: /Tone & Style/ }));

        expect(screen.getAllByText("Sections are easy to scan.").length).toBeGreaterThan(0);
    });

    it("shows just the tip when the model left the explanation out", async () => {
        const feedback = {
            ...validFeedback,
            structure: { score: 70, tips: [{ type: "improve" as const, tip: "Add a short summary", explanation: "" }] },
        };
        const { container } = render(<Details feedback={feedback} />);

        await userEvent.click(screen.getByRole("button", { name: /Structure/ }));

        expect(screen.getAllByText("Add a short summary").length).toBeGreaterThan(0);
        expect(container.querySelectorAll("p:empty")).toHaveLength(0);
    });
});
