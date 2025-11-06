import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Messenger Workflow Builder",
  description:
    "Generate n8n workflows for Facebook Messenger automation in seconds."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
