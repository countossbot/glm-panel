"use client";

// src/components/admin/playground-tab.tsx

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send } from "lucide-react";
import type { ModelInfo } from "./types";

export function PlaygroundTab({
  models,
  model,
  setModel,
  prompt,
  setPrompt,
  response,
  loading,
  error,
  onSend,
}: {
  models: ModelInfo[];
  model: string;
  setModel: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  response: string;
  loading: boolean;
  error: string | null;
  onSend: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-zinc-200">聊天测试台</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">模型 — 请求将通过本面板自己的 /v1 代理</p>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-200">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
                {models.length === 0 ? (
                  <SelectItem value="glm-4.7" className="font-mono">glm-4.7</SelectItem>
                ) : (
                  models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-mono">
                      {m.id}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">提示词</p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="Say something to GLM…"
              className="resize-none border-zinc-800 bg-zinc-950 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
          <Button
            onClick={onSend}
            disabled={loading || prompt.trim().length === 0}
            className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send via /v1/chat/completions
          </Button>
          {error ? (
            <p className="rounded-md border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-300">{error}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-zinc-200">响应</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[380px] min-h-[240px] overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {response || <span className="text-zinc-600">— 回复将在此处显示 —</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
