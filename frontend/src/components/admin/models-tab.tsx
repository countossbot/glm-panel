"use client";

// src/components/admin/models-tab.tsx

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ModelInfo } from "./types";
import { RefreshCw, Eye, MessageSquare } from "lucide-react";

export function ModelsTab({
  models,
  loading,
  error,
  onRefresh,
}: {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base text-zinc-200">
          Live model catalog{" "}
          <span className="ml-1 text-xs font-normal text-zinc-500">
            （通过 Bridge 从 Z.AI 获取，上游缓存 5 分钟）
          </span>
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
          className="border-zinc-700 bg-transparent hover:bg-zinc-800"
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="rounded-md border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">{error}</p>
        ) : null}
        {!error && models.length === 0 && !loading ? (
          <p className="text-sm text-zinc-500">尚未加载模型——点击“刷新”。</p>
        ) : null}
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {models.map((m) => {
            const vision = m.architecture?.input_modalities?.includes("image");
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-emerald-300">{m.id}</p>
                  {m.display_name || m.description ? (
                    <p className="truncate text-xs text-zinc-500">
                      {m.display_name ? `${m.display_name} — ` : ""}
                      {m.description ?? ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {vision ? (
                    <Badge variant="outline" className="border-emerald-800 text-emerald-400">
                      <Eye className="mr-1 h-3 w-3" /> vision
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                      <MessageSquare className="mr-1 h-3 w-3" /> text
                    </Badge>
                  )}
                  {m.architecture?.modality ? (
                    <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
                      {m.architecture.modality}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
