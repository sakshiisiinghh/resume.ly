import { Link } from "react-router";
import DeleteResumeButton from "~/components/DeleteResumeButton";
import ScoreCircle from "~/components/ScoreCircle";

export interface ResumeCardData {
    id: string;
    companyName: string;
    jobTitle: string;
    hasThumbnail: boolean;
    status: "queued" | "processing" | "done" | "failed";
    score: number | null;
}

const ResumeCard = ({ resume }: { resume: ResumeCardData }) => {
    const { id, companyName, jobTitle, hasThumbnail, status, score } = resume;
    const label = companyName || jobTitle || "this resume";

    return (
        <div className="relative">
            <Link to={`/resume/${id}`} className="resume-card animate-in fade-in duration-1000">
                <div className="resume-card-header">
                    <div className="flex flex-col gap-2">
                        {companyName && <h2 className="!text-black font-bold break-words">{companyName}</h2>}
                        {jobTitle && <h3 className="text-lg break-words text-gray-500">{jobTitle}</h3>}
                        {!companyName && !jobTitle && <h2 className="!text-black font-bold">Resume</h2>}
                    </div>
                    <div className="flex-shrink-0">
                        {status === "done" && score !== null ? (
                            <ScoreCircle score={score} />
                        ) : (
                            <span
                                className={
                                    status === "failed"
                                        ? "px-3 py-1 rounded-full bg-badge-red text-red-600 text-sm font-medium"
                                        : "px-3 py-1 rounded-full bg-badge-yellow text-yellow-600 text-sm font-medium"
                                }
                            >
                                {status === "failed" ? "Analysis failed" : "Analyzing…"}
                            </span>
                        )}
                    </div>
                </div>
                {hasThumbnail && (
                    <div className="gradient-border animate-in fade-in duration-1000">
                        <div className="w-full h-full">
                            <img
                                src={`/files/${id}/thumb`}
                                alt="resume"
                                loading="lazy"
                                className="w-full h-[350px] max-sm:h-[200px] object-cover object-top"
                            />
                        </div>
                    </div>
                )}
            </Link>
            <DeleteResumeButton resumeId={id} label={label} className="absolute bottom-6 right-6" />
        </div>
    );
};

export default ResumeCard;
