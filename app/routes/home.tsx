import { Link } from "react-router";
import Navbar from "~/components/Navbar";
import ResumeCard from "~/components/ResumeCard";
import { requireUser } from "~/.server/auth";
import { listResumes } from "~/.server/resumes";
import type { Route } from "./+types/home";

const PAGE_SIZE = 12;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Resume.ly" },
    { name: "description", content: "Smart feedback for your dream job!" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);
  const { items, hasNext } = await listResumes(user.id, page, PAGE_SIZE);

  return {
    page,
    hasNext,
    resumes: items.map(({ resume, analysis }) => ({
      id: resume.id,
      companyName: resume.companyName,
      jobTitle: resume.jobTitle,
      hasThumbnail: Boolean(resume.thumbKey),
      status: analysis.status,
      score: analysis.finalScore,
    })),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { resumes, page, hasNext } = loaderData;
  const isEmpty = resumes.length === 0 && page === 1;

  return <main className="bg-[url('/images/bg-main.svg')] bg-cover">
    <Navbar />
    <section className="main-section">
      <div className="page-heading py-16">
        <h1>Track Your Applications & Resume Ratings</h1>
        {isEmpty ? (
            <h2>No resumes found. Upload your first resume to get feedback.</h2>
        ): (
            <h2>Review your submissions and check AI-powered feedback.</h2>
        )}
      </div>

      {resumes.length > 0 && (
          <div className="resumes-section">
            {resumes.map((resume) => (
                <ResumeCard key={resume.id} resume={resume} />
            ))}
          </div>
      )}

      {(page > 1 || hasNext) && (
          <div className="flex items-center gap-4">
            {page > 1 && <Link to={`/?page=${page - 1}`} className="back-button">Previous</Link>}
            {hasNext && <Link to={`/?page=${page + 1}`} className="back-button">Next</Link>}
          </div>
      )}

      {isEmpty && (
          <div className="flex flex-col items-center justify-center mt-10 gap-4">
            <Link to="/upload" className="primary-button w-fit text-xl font-semibold">
              Upload Resume
            </Link>
          </div>
      )}
    </section>
  </main>;
}
