import "./globals.css";

export const metadata = {
  title: "ONEKEY — Digital Memory for Physical Things",
  description: "Give anything a persistent digital memory.",
  manifest: "/manifest.json",
};

function Logo() {
  return (
    <a className="logo" href="/" aria-label="ONEKEY home">
      <span className="logo-mark" aria-hidden="true" />
      <span className="logo-word">ONEKEY</span>
    </a>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="onekey-shell">
          <header className="onekey-container onekey-header">
            <Logo />
            <span className="eyebrow">THING / MEMORY / PROVENANCE</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
