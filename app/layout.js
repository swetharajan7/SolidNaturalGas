export const metadata = {
  title: "Solid Natural Gas",
  description: "An AI agent that tests LNG price hypotheses against live evidence and revises its own confidence — hourly, autonomously.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
