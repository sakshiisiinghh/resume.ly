import {useEffect, useState} from 'react'
import {Link} from "react-router";
import ScoreCircle from "~/components/ScoreCircle";
import {usePuterStore} from "~/lib/puter";
import {getResumeStatus} from "~/lib/util";
import DeleteResumeButton from "~/components/DeleteResumeButton";

const ResumeCard = ({resume, onDeleted} : {resume : Resume; onDeleted: (id: string) => void}) => {
    const { id, companyName, jobTitle, feedback, imagePath } = resume;
    const { fs } = usePuterStore();
    const [resumeUrl, setResumeUrl] = useState('');
    const status = getResumeStatus(resume);

    useEffect(() => {
        let url: string | null = null;
        let cancelled = false;

        const loadResume = async () => {
            const blob = await fs.read(imagePath);
            if(cancelled || !blob) return;
            url = URL.createObjectURL(blob);
            setResumeUrl(url);
        }

        loadResume();

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [imagePath, fs]);

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
                    {status === 'done' && feedback ? (
                        <ScoreCircle score={feedback.overallScore}/>
                    ) : (
                        <span className={status === 'failed'
                            ? "px-3 py-1 rounded-full bg-badge-red text-red-600 text-sm font-medium"
                            : "px-3 py-1 rounded-full bg-badge-yellow text-yellow-600 text-sm font-medium"}>
                            {status === 'failed' ? 'Analysis failed' : 'Analyzing…'}
                        </span>
                    )}
                </div>
            </div>
            {resumeUrl && (
           <div className="gradient-border animate-in fade-in duration-1000">
               <div className="w-full h-full">
                   <img
                       src={resumeUrl}
                       alt="resume"
                       className="w-full h-[350px] max-sm:h-[200px] object-cover object-top"
                   />
               </div>
           </div>
            )}
        </Link>
            <DeleteResumeButton
                resume={resume}
                onDeleted={() => onDeleted(id)}
                className="absolute bottom-6 right-6"
            />
        </div>
    )
}
export default ResumeCard
