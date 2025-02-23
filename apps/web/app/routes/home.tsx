import { useState } from "react";
import type { Route } from "./+types/home";
import type { Station } from '@schema/stations'
import { Link } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Commute" }
  ];
}

export default function Home() {
  const [stations, setStations] = useState<Station[]>([]);

  return (
    <main className="bg-gray-100 w-screen min-h-screen">
      <nav className="fixed bottom-0 py-4 flex gap-4">
        <Link to="/search" className="ml-4 bg-white block p-4 rounded-xl shadow w-screen h-screen max-w-40 max-h-28 border-2 border-gray-200">
          <b>Cari</b>
        </Link>
      </nav>
      <div className="p-4">
      </div>
    </main>
  );
}
