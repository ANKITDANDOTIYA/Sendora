import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Toast } from "@/components/ui/sonner";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "Sendora — Email Marketing & Campaign Automation Platform",
  description: "Sendora is an email marketing and campaign management platform.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} antialiased font-sans`}>
        {children}
        <Toast />
      </body>
    </html>
  );
}
