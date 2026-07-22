import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata = {
  title: "AI Video Assistant - Synthesis & QA Engine",
  description: "Advanced vector similarity QA and automatic meeting summarization engine.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
