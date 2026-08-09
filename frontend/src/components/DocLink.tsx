import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { getSignedKycDocUrl } from '../lib/kycDocs';

interface DocLinkProps {
  url?: string | null;
  label: string;
}

export default function DocLink({ url, label }: DocLinkProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setSignedUrl(null);
    setFailed(false);
    getSignedKycDocUrl(url)
      .then((minted) => {
        if (!cancelled) setSignedUrl(minted);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || failed) {
    return (
      <span
        title="Document unavailable"
        className="flex items-center gap-2 text-sm text-[#6B655C]"
      >
        <ExternalLink className="w-3 h-3" /> {label}
      </span>
    );
  }

  if (!signedUrl) {
    return (
      <span className="flex items-center gap-2 text-sm text-[#C9A05C]">
        <ExternalLink className="w-3 h-3" /> {label}
      </span>
    );
  }

  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm text-[#C9A05C] hover:underline"
    >
      <ExternalLink className="w-3 h-3" /> {label}
    </a>
  );
}
