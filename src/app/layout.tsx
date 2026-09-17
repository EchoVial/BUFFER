import type { Metadata } from "next";
import { Google_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const googleSans = Google_Sans({
  subsets: ["latin"],
  variable: "--font-google-sans",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Buffer — chat that syncs to your calendar",
  description:
    "WhatsApp-style work-life chat. Subscribe Google, Apple, Android, or Outlook to a live Buffer calendar feed.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${googleSans.variable} ${googleSans.className} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#202c33" />
        {/* Apply the saved appearance before first paint so the theme never flashes. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var a=JSON.parse(localStorage.getItem('buffer.appearance')||'{}');var m=a.mode==='light'?'light':a.mode==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):'dark';document.documentElement.dataset.theme=m;document.documentElement.dataset.wall=a.wall||'default';document.documentElement.style.colorScheme=m;}catch(e){}`,
          }}
        />
      </head>
      <body className={`${googleSans.className} flex min-h-full flex-col`}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
