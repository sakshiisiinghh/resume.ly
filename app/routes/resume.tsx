import { useEffect } from "react";
import { Link, data, redirect, useRevalidator } from "react-router";
import ATS from "~/components/ATS";
import AtsReport from "~/components/AtsReport";
import DeleteResumeButton from "~/components/DeleteResumeButton";
import Details from "~/components/Details";
import Summary from "~/components/Summary";
import { assertSameOrigin, requireUser } from "~/.server/auth";
import { enqueueAnalysis } from "~/.server/queue";
import { deleteResume, getResume, retryAnalysis } from "~/.server/resumes";
import { getStorage } from "~/.server/storage";
import { atsReportSchema } from "~/lib/ats";
import { FeedbackSchema } from "~/lib/schemas";
import type { Route } from "./+types/resume";

export const meta = () => [
    { title: "Resume.ly | Review" },
    { name: "description", content: "Detailed overview of your resume" },
];

const STAGE_LABELS: Record<string, string> = {
    extracting: "Reading your resume...",
    checking: "Checking ATS compatibility...",
    analyzing: "Analyzing with AI...",
    scoring: "Scoring...",
};

export async function loader({ request, params }: Route.LoaderArgs) {
    const user = await requireUser(request);
    const found = await getResume(user.id, params.id);
    if (!found) throw new Response("Not found", { status: 404 });

    const { resume, analysis } = found;
    const feedback = analysis.status === "done" ? FeedbackSchema.safeParse(analysis.llmFeedback) : null;
    const report = analysis.status === "done" ? atsReportSchema.safeParse(analysis.atsReport) : null;

    return {
        id: resume.id,
        title: [resume.companyName, resume.jobTitle].filter(Boolean).join(" · ") || resume.fileName,
        hasThumbnail: Boolean(resume.thumbKey),
        status: analysis.status,
        stage: analysis.stage,
        error: analysis.errorMessage,
        feedback: feedback?.success ? feedback.data : null,
        report: report?.success ? report.data : null,
        score: analysis.finalScore,
    };
}

export async function action({ request, params }: Route.ActionArgs) {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const intent = (await request.formData()).get("intent");

    if (intent === "delete") {
        await deleteResume(user.id, params.id, getStorage());
        return redirect("/");
    }

    if (intent === "retry") {
        const found = await getResume(user.id, params.id);
        if (!found) throw new Response("Not found", { status: 404 });
        await retryAnalysis(found.analysis.id, enqueueAnalysis);
        return null;
    }

    return data({ error: "Unknown action" }, { status: 400 });
}

export default function Resume({ loaderData }: Route.ComponentProps) {
    const { id, title, hasThumbnail, status, stage, error, feedback, report, score } = loaderData;
    const revalidator = useRevalidator();
    const inFlight = status === "queued" || status === "processing";

    useEffect(() => {
        if (!inFlight) return;

        let poll: ReturnType<typeof setInterval> | undefined;
        const source = new EventSource(`/api/resumes/${id}/events`);
        source.onmessage = () => revalidator.revalidate();
        source.onerror = () => {
            source.close();
            poll ??= setInterval(() => revalidator.revalidate(), 3000);
        };

        return () => {
            source.close();
            clearInterval(poll);
        };
    }, [inFlight, id]);

    return (
        <main className="!pt-0">
            <nav className="resume-nav">
                <Link to="/" className="back-button">
                    <img src="/icons/back.svg" alt="" className="w-2.5 h-2.5" />
                    <span className="text-gray-800 text-sm font-semibold">Back to Homepage</span>
                </Link>
                <DeleteResumeButton resumeId={id} label={title} />
            </nav>
            <div className="flex flex-row w-full max-lg:flex-col-reverse">
                <section className="feedback-section bg-[url('/images/bg-small.svg')] bg-cover h-[100vh] sticky top-0 items-center justify-center">
                    {hasThumbnail && (
                        <div className="animate-in fade-in duration-1000 gradient-border max-sm:m-0 h-[90%] max-wxl:h-fit w-fit">
                            <a href={`/files/${id}/pdf`} target="_blank" rel="noopener noreferrer">
                                <img src={`/files/${id}/thumb`} className="w-full h-full object-contain rounded-2xl" title="resume" />
                            </a>
                        </div>
                    )}
                </section>
                <section className="feedback-section">
                    <h2 className="text-4xl !text-black font-bold">Resume Review</h2>
                    {status === "done" && feedback ? (
                        <div className="flex flex-col gap-8 animate-in fade-in duration-1000">
                            <Summary feedback={feedback} overallScore={score ?? feedback.overallScore} />
                            {report && <AtsReport report={report} />}
                            <ATS suggestions={feedback.ATS.tips} />
                            <Details feedback={feedback} />
                        </div>
                    ) : status === "failed" || status === "done" ? (
                        <div role="alert" className="flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                            <p>The analysis for this resume failed{error ? `: ${error}` : "."}</p>
                            <form method="post">
                                <input type="hidden" name="intent" value="retry" />
                                <button type="submit" className="primary-button w-fit">Retry analysis</button>
                            </form>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-4">
                            <p className="text-gray-600">{(stage && STAGE_LABELS[stage]) || "Waiting in the queue..."}</p>
                            <img src="/images/resume-scan-2.gif" className="w-full" />
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
