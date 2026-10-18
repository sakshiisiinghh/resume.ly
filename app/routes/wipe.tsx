import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { usePuterStore } from "~/lib/puter";

const WipeApp = () => {
    const { auth, isLoading, error, fs, kv } = usePuterStore();
    const navigate = useNavigate();
    const [files, setFiles] = useState<FSItem[]>([]);
    const [isWiping, setIsWiping] = useState(false);
    const [wipeError, setWipeError] = useState<string | null>(null);

    const loadFiles = useCallback(async () => {
        const files = (await fs.readDir("./")) as FSItem[] | undefined;
        setFiles(files ?? []);
    }, [fs]);

    useEffect(() => {
        if (!isLoading && !auth.isAuthenticated) {
            navigate("/auth?next=/wipe");
        }
    }, [isLoading, auth.isAuthenticated, navigate]);

    useEffect(() => {
        if (auth.isAuthenticated) loadFiles();
    }, [auth.isAuthenticated, loadFiles]);

    const handleDelete = async () => {
        setIsWiping(true);
        setWipeError(null);
        try {
            const results = await Promise.allSettled(files.map((file) => fs.delete(file.path)));
            const failed = results.filter((r) => r.status === "rejected").length;

            await kv.flush();
            if (failed > 0) setWipeError(`${failed} file(s) could not be deleted. Try again.`);
        } catch (err) {
            setWipeError(err instanceof Error ? err.message : "Failed to wipe app data");
        } finally {
            await loadFiles();
            setIsWiping(false);
        }
    };

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error {error}</div>;
    }

    return (
        <div>
            Authenticated as: {auth.user?.username}
            <div>Existing files:</div>
            <div className="flex flex-col gap-4">
                {files.map((file) => (
                    <div key={file.id} className="flex flex-row gap-4">
                        <p>{file.name}</p>
                    </div>
                ))}
            </div>
            <div>
                <button
                    className="bg-blue-500 text-white px-4 py-2 rounded-md cursor-pointer disabled:opacity-50"
                    onClick={handleDelete}
                    disabled={isWiping}
                >
                    {isWiping ? "Wiping..." : "Wipe App Data"}
                </button>
                {wipeError && <p className="text-red-500 mt-2">{wipeError}</p>}
            </div>
        </div>
    );
};

export default WipeApp;
