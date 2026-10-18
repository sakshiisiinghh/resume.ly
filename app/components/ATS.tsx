interface Suggestion {
    type: "good" | "improve";
    tip: string;
}

const ATS = ({ suggestions }: { suggestions: Suggestion[] }) => {
    return (
        <div className="w-full rounded-2xl bg-white p-6 shadow-md">
            <h3 className="mb-4 text-xl font-semibold">AI suggestions for ATS</h3>
            <div className="space-y-3">
                {suggestions.map((suggestion, index) => (
                    <div key={index} className="flex items-start gap-3">
                        <img
                            src={suggestion.type === "good" ? "/icons/check.svg" : "/icons/warning.svg"}
                            alt={suggestion.type === "good" ? "Check" : "Warning"}
                            className="mt-1 h-5 w-5"
                        />
                        <p className={suggestion.type === "good" ? "text-green-700" : "text-amber-700"}>{suggestion.tip}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ATS;
