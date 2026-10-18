import {type ClassValue, clsx} from "clsx";
import {twMerge} from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    // Determine the appropriate unit by calculating the log
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);

    // Format with 2 decimal places and round
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const generateUUID = () => crypto.randomUUID();

export function safeRedirect(target: string | null | undefined, fallback = "/"): string {
    if (!target || !target.startsWith("/")) return fallback;
    if (target.startsWith("//") || target.startsWith("/\\")) return fallback;
    return target;
}

// Records saved before statuses existed have no `status`.
export function getResumeStatus(resume: Pick<Resume, "status" | "feedback">): ResumeStatus {
    if (resume.status) return resume.status;
    return resume.feedback && typeof resume.feedback === "object" ? "done" : "failed";
}
