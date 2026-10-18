import {type FormEvent, useEffect, useState} from 'react'
import Navbar from "~/components/Navbar";
import FileUploader from "~/components/FileUploader";
import {usePuterStore} from "~/lib/puter";
import {useNavigate} from "react-router";
import {prepareInstructions} from "../../constants";
import {generateUUID} from "~/lib/util";
import {convertPdfToImage} from "~/lib/pdf2img";
import {extractPdfText} from "~/lib/pdfText";
import {analyzeWithRetry} from "~/lib/analyze";

export const meta = () => ([
    { title: 'Resume.ly | Upload' },
    { name: 'description', content: 'Upload your resume for AI feedback' },
])

class UploadError extends Error {}

const Upload = () => {
    const {auth,isLoading,fs,ai,kv}=usePuterStore();
    const navigate=useNavigate();
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);

    useEffect(() => {
        if(!isLoading && !auth.isAuthenticated) navigate('/auth?next=/upload');
    }, [isLoading, auth.isAuthenticated, navigate])

    const handleFileSelect = (file: File | null) => {
        setFile(file);
        setError(null);
    }

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }: { companyName: string, jobTitle: string, jobDescription: string, file: File  }) => {
        setIsProcessing(true);
        setError(null);

        let record: Resume | null = null;

        try {
            setStatusText('Reading the resume...');
            const extracted = await extractPdfText(file);
            if (!extracted.ok) throw new UploadError(extracted.error);

            setStatusText('Uploading the file...');
            const uploadedFile = await fs.upload([file]);
            if(!uploadedFile) throw new UploadError('Failed to upload file');

            setStatusText('Converting to image...');
            const imageFile = await convertPdfToImage(file);
            if(!imageFile.file) throw new UploadError(imageFile.error || 'Failed to convert PDF to image');

            setStatusText('Uploading the image...');
            const uploadedImage = await fs.upload([imageFile.file]);
            if(!uploadedImage) throw new UploadError('Failed to upload image');

            setStatusText('Preparing data...');
            const uuid = generateUUID();
            record = {
                id: uuid,
                resumePath: uploadedFile.path,
                imagePath: uploadedImage.path,
                companyName, jobTitle, jobDescription,
                status: 'processing',
                feedback: null,
            };
            await kv.set(`resume:${uuid}`, JSON.stringify(record));

            setStatusText('Analyzing...');
            const result = await analyzeWithRetry(
                (message) => ai.feedback(extracted.text, message),
                prepareInstructions({ jobTitle, jobDescription })
            );
            if (!result.ok) throw new UploadError(`Failed to analyze resume. ${result.error}`);

            record = { ...record, status: 'done', feedback: result.feedback };
            await kv.set(`resume:${uuid}`, JSON.stringify(record));

            setStatusText('Analysis complete, redirecting...');
            navigate(`/resume/${uuid}`);
        } catch (err) {
            const message = err instanceof UploadError
                ? err.message
                : `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;

            if (record) {
                await kv.set(`resume:${record.id}`, JSON.stringify({ ...record, status: 'failed', error: message }))
                    .catch(() => {});
            }
            setError(message);
            setIsProcessing(false);
        }
    }

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        const companyName = formData.get('company-name') as string;
        const jobTitle = formData.get('job-title') as string;
        const jobDescription = formData.get('job-description') as string;
        if(!file) {
            setError('Please select a PDF resume to analyze.');
            return;
        }
        handleAnalyze({ companyName, jobTitle, jobDescription, file });
    }


    return (
        <main className="bg-[url('/images/bg-main.svg')] bg-cover">
            <Navbar/>
           <section className="main-section">
               <div className="page-heading py-16">
                   <h1>Smart feedback for your dream job</h1>
                   {isProcessing ? (
                       <>
                           <h2>{statusText}</h2>
                           <img src="/images/resume-scan.gif" className="w-full" />
                       </>
                   ) : (
                       <h2>Drop your resume for an ATS score and improvement tips</h2>
                   )}
                   {error && (
                       <div role="alert" className="w-full rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                           <p>{error}</p>
                           {file && <p className="text-sm mt-1">Your inputs are kept. Press “Analyze Resume” to try again.</p>}
                       </div>
                   )}
                   <form id="upload-form" onSubmit={handleSubmit} hidden={isProcessing} className="flex flex-col gap-4 mt-8">
                       <div className="form-div">
                           <label htmlFor="company-name">Company Name</label>
                           <input type="text" name="company-name" placeholder="Company Name" id="company-name" />
                       </div>
                       <div className="form-div">
                           <label htmlFor="job-title">Job Title</label>
                           <input type="text" name="job-title" placeholder="Job Title" id="job-title" />
                       </div>
                       <div className="form-div">
                           <label htmlFor="job-description">Job Description</label>
                           <textarea rows={5} name="job-description" placeholder="Job Description" id="job-description" />
                       </div>

                       <div className="form-div">
                           <label htmlFor="uploader">Upload Resume</label>
                           <FileUploader file={file} onFileSelect={handleFileSelect} />
                       </div>

                       <button className="primary-button" type="submit" disabled={isProcessing}>
                           Analyze Resume
                       </button>
                   </form>
               </div>
           </section>
        </main>
    )
}
export default Upload
