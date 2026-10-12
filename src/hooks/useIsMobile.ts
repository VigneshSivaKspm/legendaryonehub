import { useEffect, useState } from 'react';

/** Phones and portrait tablets get the mobile shell (bottom nav + drawer). Matches the CSS breakpoint in index.css. */
export const MOBILE_QUERY = '(max-width: 900px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
