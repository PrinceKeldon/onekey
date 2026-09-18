export const metadata = {
  title: "ONEKEY",
  description: "Give anything a persistent digital memory.",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0e0e10", color: "#f2f2f2" }}>
        {children}
      </body>
    </html>
  );
}
