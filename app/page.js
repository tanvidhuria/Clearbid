"use client";
import dynamic from "next/dynamic";
const App = dynamic(() => import("../components/App.jsx"), { ssr: false });
export default function Page() { return <App />; }
