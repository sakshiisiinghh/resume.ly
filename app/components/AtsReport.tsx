import { cn } from "~/lib/util";
import type { AtsReport as Report, Check, KeywordMatch, Severity } from "~/lib/ats";

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "ok"];

const SEVERITY_STYLE: Record<Severity, string> = {
    critical: "border-red-200 bg-red-50 text-red-700",
    warning: "border-yellow-200 bg-yellow-50 text-yellow-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
    ok: "border-green-200 bg-green-50 text-green-700",
};

const readinessStyle = (score: number) =>
    score > 69 ? { gradient: "from-green-100", icon: "/icons/ats-good.svg", label: "Great Job!" }
        : score > 49 ? { gradient: "from-yellow-100", icon: "/icons/ats-warning.svg", label: "Good Start" }
            : { gradient: "from-red-100", icon: "/icons/ats-bad.svg", label: "Needs Improvement" };

const CheckRow = ({ check }: { check: Check }) => (
    <li className={cn("flex flex-col gap-1 rounded-2xl border p-4", SEVERITY_STYLE[check.severity])}>
        <div className="flex items-center gap-2">
            <img src={check.severity === "ok" ? "/icons/check.svg" : "/icons/warning.svg"} alt="" className="size-5" />
            <p className="text-lg font-semibold">{check.title}</p>
            {check.penalty > 0 && (
                <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-sm font-medium">−{check.penalty} pts</span>
            )}
        </div>
        <p>{check.message}</p>
        {check.evidence.length > 0 && (
            <ul className="list-disc pl-6 text-sm opacity-90">
                {check.evidence.map((line) => (
                    <li key={line} className="break-words">{line}</li>
                ))}
            </ul>
        )}
    </li>
);

const Chip = ({ term, tone, match }: { term: string; tone: "found" | "missing"; match?: KeywordMatch }) => (
    <li
        title={match?.evidence}
        className={cn(
            "rounded-full border px-3 py-1 text-sm font-medium",
            tone === "found" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"
        )}
    >
        {term}
        {match && match.count > 1 && <span className="ml-1 opacity-70">×{match.count}</span>}
    </li>
);

const KeywordGroup = ({ title, group }: { title: string; group: NonNullable<Report["keywords"]>["required"] }) => {
    if (group.matched.length + group.missing.length === 0) return null;
    return (
        <div className="flex flex-col gap-2">
            <h4 className="text-lg font-semibold">{title}</h4>
            <ul className="flex flex-wrap gap-2">
                {group.matched.map((match) => (
                    <Chip key={match.term} term={match.term} tone="found" match={match} />
                ))}
                {group.missing.map((term) => (
                    <Chip key={term} term={term} tone="missing" />
                ))}
            </ul>
        </div>
    );
};

const AtsReport = ({ report }: { report: Report }) => {
    const readiness = report.scoring?.atsReadiness ?? report.parseability;
    const style = readinessStyle(readiness);
    const issues = SEVERITY_ORDER.slice(0, 3).flatMap((severity) => report.checks.filter((c) => c.severity === severity));
    const passed = report.checks.filter((c) => c.severity === "ok");

    return (
        <div className={`flex w-full flex-col gap-6 rounded-2xl bg-gradient-to-b ${style.gradient} to-white p-6 shadow-md`}>
            <div className="flex items-center gap-4">
                <img src={style.icon} alt="" className="h-12 w-12" />
                <div>
                    <h2 className="text-2xl font-bold">ATS Readiness - {readiness}/100</h2>
                    <p className="text-gray-600">{style.label}</p>
                </div>
            </div>
            <p className="text-gray-600">
                These checks are heuristics for how well software can read your resume. They aren't any employer's actual ATS.
            </p>

            {issues.length > 0 && (
                <section className="flex flex-col gap-3">
                    <h3 className="text-xl font-semibold">What to fix</h3>
                    <ul className="flex flex-col gap-3">
                        {issues.map((check) => (
                            <CheckRow key={check.id} check={check} />
                        ))}
                    </ul>
                </section>
            )}

            {report.keywords && (
                <section className="flex flex-col gap-4">
                    <h3 className="text-xl font-semibold">Job keywords - {report.keywords.coverage}% matched</h3>
                    <KeywordGroup title="Required" group={report.keywords.required} />
                    <KeywordGroup title="Nice to have" group={report.keywords.nice} />
                    <p className="text-sm text-gray-500">Hover a matched keyword to see where it appears. Only skills from a built-in list are recognised.</p>
                </section>
            )}

            {passed.length > 0 && (
                <details className="rounded-2xl bg-white/70 p-4">
                    <summary className="cursor-pointer text-lg font-semibold">{passed.length} checks passed</summary>
                    <ul className="mt-3 flex flex-col gap-3">
                        {passed.map((check) => (
                            <CheckRow key={check.id} check={check} />
                        ))}
                    </ul>
                </details>
            )}

            {report.scoring && (
                <section className="flex flex-col gap-3">
                    <h3 className="text-xl font-semibold">How your score is calculated</h3>
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-gray-200 text-sm text-gray-500">
                                <th className="py-2 font-medium">Component</th>
                                <th className="py-2 text-right font-medium">Score</th>
                                <th className="py-2 text-right font-medium">Weight</th>
                                <th className="py-2 text-right font-medium">Adds</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.scoring.components.map((component) => (
                                <tr key={component.id} className="border-b border-gray-100">
                                    <td className="py-2">{component.label}</td>
                                    <td className="py-2 text-right">{component.score}</td>
                                    <td className="py-2 text-right">{Math.round((component.weight / report.scoring!.components.reduce((sum, c) => sum + c.weight, 0)) * 100)}%</td>
                                    <td className="py-2 text-right">{component.contribution}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="font-semibold">
                                <td className="py-2" colSpan={3}>Overall score</td>
                                <td className="py-2 text-right">{report.scoring.final}</td>
                            </tr>
                        </tfoot>
                    </table>
                    {!report.keywords && <p className="text-sm text-gray-500">Keyword match isn't included because there was no usable job description.</p>}
                </section>
            )}
        </div>
    );
};

export default AtsReport;
