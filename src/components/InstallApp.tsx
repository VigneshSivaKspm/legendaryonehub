import { useState } from 'react';
import { Download, Monitor, Smartphone, CheckCircle2, X, Copy } from 'lucide-react';
import { useInstallPrompt, type BrowserKind } from '../pwa';
import { useToast } from '../context/ToastContext';

/** Step-by-step install instructions for browsers that don't offer (or already used) the one-click prompt. */
function steps(browser: BrowserKind, desktop: boolean, ios: boolean): { title: string; items: string[]; unsupported?: boolean } {
  if (ios) {
    return {
      title: 'Install on iPhone / iPad',
      items: ['Open this page in Safari.', 'Tap the Share button (square with an arrow).', 'Choose "Add to Home Screen", then tap Add.'],
    };
  }
  if (!desktop) {
    if (browser === 'samsung') return { title: 'Install on Android', items: ['Tap the menu (☰) at the bottom.', 'Choose "Add page to" → "Home screen".'] };
    return { title: 'Install on Android', items: ['Tap the ⋮ menu at the top right.', 'Choose "Install app" (or "Add to Home screen").', 'Tap Install.'] };
  }
  switch (browser) {
    case 'edge':
      return {
        title: 'Install as a Windows app (Microsoft Edge)',
        items: [
          'Click the "App available" icon at the right end of the address bar, then Install.',
          'Or open the ⋯ menu → Apps → "Install this site as an app".',
          'Legendary One opens in its own window and is added to the Start menu. Right-click its taskbar icon → "Pin to taskbar" to keep it there.',
        ],
      };
    case 'chrome':
      return {
        title: 'Install as a Windows app (Google Chrome)',
        items: [
          'Click the install icon (a monitor with a down-arrow) at the right end of the address bar, then Install.',
          'Or open the ⋮ menu → "Cast, save, and share" → "Install page as app…" (older Chrome: ⋮ → "Install Legendary One…").',
          'It opens in its own window with a Start-menu and desktop shortcut. Right-click its taskbar icon → "Pin to taskbar".',
        ],
      };
    case 'safari':
      return { title: 'Install on Mac (Safari)', items: ['In the menu bar choose File → "Add to Dock" (macOS Sonoma or later).', 'Click Add. The app opens from the Dock in its own window.'] };
    case 'firefox':
      return {
        title: 'Firefox can’t install apps',
        unsupported: true,
        items: ['Firefox doesn’t support installing web apps on Windows.', 'Copy the link below and open it in Google Chrome or Microsoft Edge, then use Install App there.'],
      };
    default:
      return { title: 'Install as an app', unsupported: true, items: ['Open this page in Google Chrome or Microsoft Edge.', 'Use the install icon in the address bar, or Install App in the menu.'] };
  }
}

export function InstallDialog({ onClose }: { onClose: () => void }) {
  const installer = useInstallPrompt();
  const { showToast } = useToast();
  const ios = installer.needsIOSHelp || (!installer.desktop && installer.browser === 'safari');
  const guide = steps(installer.browser, installer.desktop, ios);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      showToast('Link copied. Paste it into Chrome or Edge.', 'success');
    } catch {
      showToast(window.location.origin, 'info');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box install-dialog" style={{ width: 480, maxWidth: '100%', padding: 26 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/icons/icon-192.png" alt="" width={48} height={48} style={{ borderRadius: 12, flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 17, color: '#1A1F36' }}>Install Legendary One</div>
              <div style={{ fontSize: 12.5, color: '#697586' }}>Runs like desktop software: own window, Start menu, taskbar.</div>
            </div>
          </div>
          <button className="m-icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {installer.installed || installer.installedThisSession ? (
          <div className="install-done">
            <CheckCircle2 size={22} />
            <div>
              <div style={{ fontWeight: 700 }}>Installed</div>
              <div style={{ fontSize: 12.5 }}>
                {installer.desktop
                  ? 'Find "Legendary One" in your Start menu or on the desktop. It opens in its own window.'
                  : 'Open it from your home screen.'}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 10px', fontWeight: 700, fontSize: 14, color: '#1A1F36' }}>
              {installer.desktop ? <Monitor size={17} color="#3B5BDB" /> : <Smartphone size={17} color="#3B5BDB" />}
              {guide.title}
            </div>
            <ol className="install-steps">
              {guide.items.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {guide.unsupported && (
              <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={copyLink}>
                <Copy size={14} /> Copy link: {window.location.host}
              </button>
            )}
            <div className="install-perks">
              <span>✓ Opens in its own window</span>
              <span>✓ Start menu & taskbar</span>
              <span>✓ Works offline</span>
              <span>✓ Updates automatically</span>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          {installer.canInstall && (
            <button className="btn-primary" onClick={() => installer.install()}>
              <Download size={15} /> Install now
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {installer.canInstall ? 'Not now' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Install button for any screen size. Uses the browser's one-click prompt when it's available
 * (Chrome / Edge on Windows, Mac, Android); otherwise shows how to install in this browser.
 * Hidden inside the installed app.
 */
export default function InstallAppButton({
  variant = 'button',
  className,
  style,
  label = 'Install App',
}: {
  variant?: 'button' | 'link';
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  const installer = useInstallPrompt();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  if (installer.installed) return null;

  const onClick = async () => {
    if (installer.canInstall) {
      const accepted = await installer.install();
      if (accepted) {
        showToast(
          installer.desktop ? 'Installed! Legendary One is now in your Start menu and opens in its own window.' : 'Installed! Find it on your home screen.',
          'success'
        );
      }
      return;
    }
    setOpen(true);
  };

  return (
    <>
      {variant === 'link' ? (
        <button type="button" className={className || 'install-link'} style={style} onClick={onClick}>
          <Download size={14} /> {label}
        </button>
      ) : (
        <button type="button" className={className || 'btn-secondary'} style={style} onClick={onClick} title="Install as an app on this computer">
          <Download size={15} /> {label}
        </button>
      )}
      {open && <InstallDialog onClose={() => setOpen(false)} />}
    </>
  );
}
