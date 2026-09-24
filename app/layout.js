import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "./globals.css";

export const metadata = { title: "Clearbid: kill the quote spreadsheet", description: "AI-first RFx drafting, quote reading and award analysis" };

export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
