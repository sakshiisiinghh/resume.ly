import {Link, useNavigate, useParams} from "react-router";
import {usePuterStore} from "~/lib/puter";
import {useEffect, useState} from "react";
import Summary from "~/components/Summary";
import ATS from "~/components/ATS";
import Details from "~/components/Details";
import {getResumeStatus} from "~/lib/util";
import DeleteResumeButton from "~/components/DeleteResumeButton";

export const meta = () => ([
    { title: 'Resume.ly | Review ' },
    { name: 'description', content: 'Detailed overview of your resume' },
])

const Resume = () => {
    const {id}=useParams();
    const { auth, isLoading, fs, kv } = usePuterStore();
    const [imageUrl, setImageUrl] = useState('');
    const [resumeUrl, setResumeUrl] = useState('');
    const [resume, setResume] = useState<Resume | null>(null);
    const [notFound, setNotFound] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        if(!isLoading && !auth.isAuthenticated) navigate(`/auth?next=/resume/${id}`);
    }, [isLoading, auth.isAuthenticated, id, navigate])

    useEffect(() => {
        if (!auth.isAuthenticated) return;

        const created: string[] = [];
        let cancelled = false;

        const loadResume = async () => {
            const stored = await kv.get(`resume:${id}`);
            if (cancelled) return;
            if(!stored) {
                setNotFound(true);
                return;
            }

            const data = JSON.parse(stored) as Resume;
            setResume(data);

            const resumeBlob = await fs.read(data.resumePath);
            if (cancelled || !resumeBlob) return;
            const pdfUrl = URL.createObjectURL(new Blob([resumeBlob], { type: 'application/pdf' }));
            created.push(pdfUrl);
            setResumeUrl(pdfUrl);

            const imageBlob = await fs.read(data.imagePath);
            if (cancelled || !imageBlob) return;
            const imgUrl = URL.createObjectURL(imageBlob);
            created.push(imgUrl);
            setImageUrl(imgUrl);
        }

        loadResume();

        return () => {
            cancelled = true;
            created.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [id, auth.isAuthenticated]);

    const status = resume ? getResumeStatus(resume) : null;
    const feedback = status === 'done' ? resume?.feedback : null;

    return (
       <main className="!pt-0">
           <nav className="resume-nav">
               <Link to="/" className="back-button">
                   <img src="/icons/back.svg" alt="logo" className="w-2.5 h-2.5" />
                   <span className="text-gray-800 text-sm font-semibold">Back to Homepage</span>
               </Link>
               {resume && (
                   <DeleteResumeButton resume={resume} onDeleted={() => navigate('/')} />
               )}
           </nav>
           <div className="flex flex-row w-full max-lg:flex-col-reverse">
               <section className="feedback-section bg-[url('/images/bg-small.svg')] bg-cover h-[100vh] sticky top-0 items-center justify-center">
                   {imageUrl && resumeUrl && (
                       <div className="animate-in fade-in duration-1000 gradient-border max-sm:m-0 h-[90%] max-wxl:h-fit w-fit">
                           <a href={resumeUrl} target="_blank" rel="noopener noreferrer">
                               <img
                                   src={imageUrl}
                                   className="w-full h-full object-contain rounded-2xl"
                                   title="resume"
                               />
                           </a>
                       </div>
                   )}
               </section>
               <section className="feedback-section">
                   <h2 className="text-4xl !text-black font-bold">Resume Review</h2>
                   {notFound ? (
                       <p className="text-gray-600">This resume could not be found.</p>
                   ) : status === 'failed' ? (
                       <div role="alert" className="flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                           <p>The analysis for this resume failed{resume?.error ? `: ${resume.error}` : '.'}</p>
                           <Link to="/upload" className="primary-button w-fit">Try another upload</Link>
                       </div>
                   ) : feedback ? (
                       <div className="flex flex-col gap-8 animate-in fade-in duration-1000">
                           <Summary feedback={feedback} />
                           <ATS score={feedback.ATS.score} suggestions={feedback.ATS.tips} />
                           <Details feedback={feedback} />
                       </div>
                   ) : (
                       <img src="/images/resume-scan-2.gif" className="w-full" />
                   )}
               </section>
           </div>
       </main>
    )
}
export default Resume
