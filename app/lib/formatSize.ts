export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";

  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  const formatNumber = (n: number) => {
    if (n >= 100) return Math.round(n).toString();
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, "");
    return n.toFixed(2).replace(/\.00$/, "");
  };

  if (bytes >= GB) {
    return `${formatNumber(bytes / GB)} GB`;
  }

  if (bytes >= MB) {
    return `${formatNumber(bytes / MB)} MB`;
  }

  // show KB for anything below 1 MB
  return `${formatNumber(bytes / KB)} KB`;
}

export default formatSize;
