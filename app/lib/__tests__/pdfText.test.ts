import { describe, expect, it } from "vitest";
import { textFromItems } from "~/lib/pdfText";

describe("textFromItems", () => {
    it("joins items and breaks lines at hasEOL", () => {
        const text = textFromItems([
            { str: "Sakshi", hasEOL: false },
            { str: " Singh", hasEOL: true },
            { str: "Backend   Engineer", hasEOL: true },
        ]);
        expect(text).toBe("Sakshi Singh\nBackend Engineer");
    });

    it("skips marked-content items and blank lines", () => {
        const text = textFromItems([{ str: "A", hasEOL: true }, {}, { str: "   ", hasEOL: true }, { str: "B" }]);
        expect(text).toBe("A\nB");
    });

    it("returns empty text for an image-only page", () => {
        expect(textFromItems([])).toBe("");
    });
});
