"use client";

// src/components/admin/logs-tab.tsx

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Terminal } from "lucide-react";
import { useEffect, useRef } from "react";

export function LogsTab({
  lines,
  autoRefresh,
  setAutoRefresh,
  onRefresh,
}: {
  lines: string[];
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  onRefresh: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-zinc-200">
          <Terminal className="h-4 w-4 text-emerald-400" /> server.log tail
        </CardTitle>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="logs-auto" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="logs-auto" className="text-xs text-zinc-400">自动刷新（3 秒）</Label>
          </div>
          <Button size="sm" variant="outline" onClick={onRefresh} className="border-zinc-700 bg-transparent hover:bg-zinc-800">
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={boxRef}
          className="max-h-[460px] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-zinc-600">— 暂无日志输出 —</p>
          ) : (
            lines.map((l, i) => (
              <p key={i} className="whitespace-pre-wrap break-all text-zinc-400">
                {l.includes("[Pool") || l.includes("[Session]") ? (
                  <span className="text-emerald-400/90">{l}</span>
                ) : l.includes("error") || l.includes("ERROR") || l.includes("FATAL") ? (
                  <span className="text-red-400/90">{l}</span>
                ) : (
                  l
                )}
              </p>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
