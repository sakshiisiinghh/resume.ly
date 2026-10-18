import {useState} from "react";
import {usePuterStore} from "~/lib/puter";
import {deleteResume} from "~/lib/deleteResume";
import {cn} from "~/lib/util";

interface DeleteResumeButtonProps {
    resume: Pick<Resume, "id" | "resumePath" | "imagePath" | "companyName" | "jobTitle">;
    onDeleted: () => void;
    className?: string;
}

const DeleteResumeButton = ({ resume, onDeleted, className }: DeleteResumeButtonProps) => {
    const { fs, kv } = usePuterStore();
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const label = resume.companyName || resume.jobTitle || "this resume";

    const handleClick = async () => {
        if (!window.confirm(`Delete ${label}? This removes the PDF and its analysis permanently.`)) return;

        setIsDeleting(true);
        setError(null);
        const result = await deleteResume(resume, { fs, kv });
        if (result.ok) {
            onDeleted();
        } else {
            setError(result.error);
            setIsDeleting(false);
        }
    };

    return (
        <div className={cn("flex flex-col items-end gap-1", className)}>
            <button
                type="button"
                onClick={handleClick}
                disabled={isDeleting}
                aria-label={`Delete ${label}`}
                className="flex items-center gap-1.5 rounded-full border border-red-200 bg-white/95 px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm cursor-pointer hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
            >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                {isDeleting ? "Deleting…" : "Delete"}
            </button>
            {error && <p role="alert" className="rounded-md bg-white/95 px-2 py-1 text-xs text-red-600">{error}</p>}
        </div>
    );
};

export default DeleteResumeButton;
