import { useFetcher } from "react-router";
import { cn } from "~/lib/util";

interface DeleteResumeButtonProps {
    resumeId: string;
    label: string;
    className?: string;
}

const DeleteResumeButton = ({ resumeId, label, className }: DeleteResumeButtonProps) => {
    const fetcher = useFetcher();
    const isDeleting = fetcher.state !== "idle";

    return (
        <fetcher.Form
            method="post"
            action={`/resume/${resumeId}`}
            className={cn(className)}
            onSubmit={(e) => {
                if (!window.confirm(`Delete ${label}? This removes the PDF and its analysis permanently.`)) e.preventDefault();
            }}
        >
            <input type="hidden" name="intent" value="delete" />
            <button
                type="submit"
                disabled={isDeleting}
                aria-label={`Delete ${label}`}
                className="flex items-center gap-1.5 rounded-full border border-red-200 bg-white/95 px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm cursor-pointer hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
            >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                {isDeleting ? "Deleting…" : "Delete"}
            </button>
        </fetcher.Form>
    );
};

export default DeleteResumeButton;
