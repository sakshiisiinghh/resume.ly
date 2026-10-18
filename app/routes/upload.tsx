import { type FormEvent, useState } from "react";
import { Form, data, redirect, useNavigation, useSubmit } from "react-router";
import { z } from "zod";
import FileUploader from "~/components/FileUploader";
import Navbar from "~/components/Navbar";
import { assertSameOrigin, requireUser } from "~/.server/auth";
import { enqueueAnalysis } from "~/.server/queue";
import { MAX_PDF_BYTES, submitResume, validatePdf } from "~/.server/resumes";
import { getStorage } from "~/.server/storage";
import type { Route } from "./+types/upload";

export const meta = () => [
    { title: "Resume.ly | Upload" },
    { name: "description", content: "Upload your resume for AI feedback" },
];

const fieldsSchema = z.object({
    companyName: z.string().trim().max(120),
    jobTitle: z.string().trim().max(120),
    jobDescription: z.string().trim().max(20_000),
});

export async function loader({ request }: Route.LoaderArgs) {
    await requireUser(request);
    return null;
}

export async function action({ request }: Route.ActionArgs) {
    assertSameOrigin(request);
    const user = await requireUser(request);

    // Reject oversized bodies before buffering them.
    if (Number(request.headers.get("Content-Length")) > MAX_PDF_BYTES + 100_000) {
        return data({ error: "The file is larger than 10 MB" }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get("resume");
    if (!(file instanceof File)) return data({ error: "Please select a PDF resume" }, { status: 400 });

    const fields = fieldsSchema.safeParse({
        companyName: form.get("company-name") ?? "",
        jobTitle: form.get("job-title") ?? "",
        jobDescription: form.get("job-description") ?? "",
    });
    if (!fields.success) return data({ error: "One of the fields is too long" }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const problem = validatePdf(bytes);
    if (problem) return data({ error: problem }, { status: 400 });

    const { resumeId } = await submitResume(
        { userId: user.id, fileName: file.name, bytes, ...fields.data },
        { storage: getStorage(), enqueue: enqueueAnalysis }
    );
    return redirect(`/resume/${resumeId}`);
}

export default function Upload({ actionData }: Route.ComponentProps) {
    const [file, setFile] = useState<File | null>(null);
    const [clientError, setClientError] = useState<string | null>(null);
    const navigation = useNavigation();
    const submit = useSubmit();
    const isSubmitting = navigation.state !== "idle";
    const error = clientError ?? actionData?.error;

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!file) return setClientError("Please select a PDF resume to analyze.");

        setClientError(null);
        const formData = new FormData(e.currentTarget);
        formData.set("resume", file);
        submit(formData, { method: "post", encType: "multipart/form-data" });
    };

    return (
        <main className="bg-[url('/images/bg-main.svg')] bg-cover">
            <Navbar />
            <section className="main-section">
                <div className="page-heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {isSubmitting ? (
                        <>
                            <h2>Uploading your resume...</h2>
                            <img src="/images/resume-scan.gif" className="w-full" />
                        </>
                    ) : (
                        <h2>Drop your resume for an ATS score and improvement tips</h2>
                    )}
                    {error && (
                        <div role="alert" className="w-full rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                            <p>{error}</p>
                        </div>
                    )}
                    <Form method="post" onSubmit={handleSubmit} hidden={isSubmitting} className="flex flex-col gap-4 mt-8">
                        <div className="form-div">
                            <label htmlFor="company-name">Company Name</label>
                            <input type="text" name="company-name" placeholder="Company Name" id="company-name" maxLength={120} />
                        </div>
                        <div className="form-div">
                            <label htmlFor="job-title">Job Title</label>
                            <input type="text" name="job-title" placeholder="Job Title" id="job-title" maxLength={120} />
                        </div>
                        <div className="form-div">
                            <label htmlFor="job-description">Job Description</label>
                            <textarea rows={5} name="job-description" placeholder="Job Description" id="job-description" maxLength={20000} />
                        </div>
                        <div className="form-div">
                            <label htmlFor="uploader">Upload Resume</label>
                            <FileUploader file={file} onFileSelect={(f) => { setFile(f); setClientError(null); }} />
                        </div>
                        <button className="primary-button" type="submit" disabled={isSubmitting}>
                            Analyze Resume
                        </button>
                    </Form>
                </div>
            </section>
        </main>
    );
}
