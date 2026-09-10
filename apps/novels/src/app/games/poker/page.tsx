"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PokerGame from "@/components/games/PokerGame";

function PokerGameContent() {
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<{ aiCount: number; chips: number; nickname: string } | null>(null);
  
  useEffect(() => {
    const ai = searchParams.get("ai");
    const chips = searchParams.get("chips");
    const name = searchParams.get("nickname");
    
    if (ai && chips && name) {
      setConfig({
        aiCount: parseInt(ai),
        chips: parseInt(chips),
        nickname: decodeURIComponent(name)
      });
    }
  }, [searchParams]);
  
  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-600 to-red-900">
        <div className="text-center text-white">
          <div className="text-6xl mb-4">🃋</div>
          <h1 className="text-2xl font-bold mb-4">德州扑克</h1>
          <p className="text-red-200 mb-6">加载中...</p>
        </div>
      </div>
    );
  }
  
  return <PokerGame config={config} />;
}

export default function PokerGamePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-600 to-red-900">
        <div className="text-center text-white">
          <div className="text-6xl mb-4">🃋</div>
          <h1 className="text-2xl font-bold mb-4">德州扑克</h1>
          <p className="text-red-200 mb-6">加载中...</p>
        </div>
      </div>
    }>
      <PokerGameContent />
    </Suspense>
  );
}