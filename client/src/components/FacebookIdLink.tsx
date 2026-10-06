import { ExternalLink } from "lucide-react";

interface FacebookIdLinkProps {
  facebookId: string;
}

export default function FacebookIdLink({ facebookId }: FacebookIdLinkProps) {
  const profileUrl = `https://www.facebook.com/profile.php?id=${encodeURIComponent(facebookId)}`;

  return (
    <div className="flex flex-col gap-1.5">
      <span>{facebookId}</span>
      <a
        href={profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-fuchsia-300/30 bg-fuchsia-300/10 px-2.5 py-1.5 text-xs font-semibold text-fuchsia-200 transition hover:border-fuchsia-300/50 hover:bg-fuchsia-300/20"
        aria-label={`פתח פרופיל Facebook עבור ${facebookId}`}
      >
        פתח פרופיל Facebook
        <ExternalLink size={12} className="shrink-0" aria-hidden="true" />
      </a>
    </div>
  );
}
