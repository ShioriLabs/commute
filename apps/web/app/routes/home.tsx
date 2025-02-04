import { useState } from "react";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Commute" }
  ];
}

export default function Home() {
  const [stations, setStations] = useState<any>([]);

  return (
    <div className="p-4">
      <h2 className="font-bold text-2xl">Stasiun Tersimpan</h2>
      {stations.length === 0 && (
        <>
          <p className="mt-4">Belum ada stasiun yang disimpan nih</p>
          <a href="/add-station" className="inline-block rounded py-2 px-4 mt-2 bg-blue-400 text-white">
            Tambah Stasiun
          </a>
        </>
      )}
    </div>
  );
}
